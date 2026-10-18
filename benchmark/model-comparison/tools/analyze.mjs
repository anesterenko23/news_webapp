import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { context, readJson, writeJson, ROOT, jobs, sha } from './common.mjs';
import { ISO_CODES, TAXONOMY, EVENT_STATUSES, ROLES } from '../../../backend/dist/schemas.js';
import { aggregate, summarize, prf, compareEvents, pipelinePredictions, pairedBootstrap, ratio, quantile, consistency, semanticSignature } from './metrics-lib.mjs';
export async function validateTruth(truth, ctx) {
    if (truth.status === 'adjudicated' && truth.articles.length !== 100)
        throw Error('Ground truth must cover exactly100 articles');
    if (truth.datasetVersion !== ctx.dataset.version || truth.status !== 'adjudicated')
        return { ready: false, reason: 'Ground truth is not human-adjudicated', approved: 0, total: 100 };
    const seen = new Set();
    for (const article of ctx.articles) {
        const row = truth.articles.find(r => r.articleId === article.id);
        if (!row || row.review.status !== 'adjudicated' || row.review.method !== 'human' || !row.review.annotator || !row.review.adjudicator || !row.review.reviewedAt || !row.categoryConfirmed || row.contentSha256 !== article.contentSha256 || !Array.isArray(row.expectedEvents))
            throw Error('Missing human truth/provenance for ' + article.id);
        if (seen.has(row.articleId))
            throw Error('Duplicate truth');
        seen.add(row.articleId);
        for (const variant of [row.expectedEvents, ...row.acceptableAlternatives.map(v => v.events)]) {
            const ids = new Set();
            for (const e of variant) {
                if (!e.id || ids.has(e.id) || !TAXONOMY.includes(e.event_type) || !EVENT_STATUSES.includes(e.event_status) || !Array.isArray(e.countries) || !Array.isArray(e.relationships) || (!Array.isArray(e.evidence) || !e.evidence.length))
                    throw Error('Incomplete expected event ' + article.id);
                ids.add(e.id);
                for (const c of e.countries)
                    if (!ISO_CODES.has(c.code) || !ROLES.includes(c.role))
                        throw Error('Invalid expected participant');
                for (const r of e.relationships)
                    if (!e.countries.some(c => c.code === r.source_country) || !e.countries.some(c => c.code === r.target_country) || !TAXONOMY.includes(r.type) || !['directed', 'bidirectional'].includes(r.direction))
                        throw Error('Invalid expected relationship');
                const original = article.article.title + '\n' + article.article.content;
                for (const span of e.evidence)
                    if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end <= span.start || original.slice(span.start, span.end) !== span.text)
                        throw Error('Expected evidence span mismatch ' + article.id);
            }
        }
    }
    const tags = new Set(truth.articles.flatMap(a => a.coverageTags ?? [])), coverageMissing = (ctx.config?.requiredCoverageTags ?? []).filter(t => !tags.has(t));
    return { ready: seen.size === 100 && !coverageMissing.length, approved: seen.size, total: 100, coverageMissing };
}
const costMetric = (cost, denominator) => ({ estimatedUsd: cost !== null && denominator ? cost / denominator : null, denominator, unknownCost: cost === null });
export async function analyze() {
    const ctx = await context(), directory = path.join(ROOT, 'state', ctx.planSha256), files = await fs.readdir(directory).catch(() => []);
    const runs = await Promise.all(files.filter(n => n.endsWith('.result.json')).map(n => readJson(path.join(directory, n))));
    const attempts = await Promise.all(files.filter(n => n.endsWith('.attempt.json')).map(n => readJson(path.join(directory, n))));
    for (const saved of runs) {
        const expected = jobs(ctx).find(j => j.id === saved.jobId);
        if (!expected || saved.planSha256 !== ctx.planSha256 || saved.model !== expected.model || sha(saved.input) !== sha(expected.input))
            throw Error('Saved run does not match frozen job/input: ' + saved.jobId);
    }
    const truth = await readJson(path.join(ROOT, 'ground-truth.json')), reviews = await readJson(path.join(ROOT, 'adjudication.json')), truthStatus = await validateTruth(truth, ctx);
    const rows = [], missingReviews = [];
    const unavailableRaw = [];
    if (truthStatus.ready)
        for (const run of runs.filter(r => r.phase === 'main'))
            for (const level of ['A', 'B']) {
                if (level === 'A' && !attempts.some(a => a.jobId === run.jobId && a.response?.status === 200)) {
                    unavailableRaw.push({ jobId: run.jobId, reason: 'No HTTP200 model output; provider failure is excluded from Raw semantic quality and remains an end-to-end Level B failure.' });
                    continue;
                }
                const label = truth.articles.find(t => t.articleId === run.caseId), actual = level === 'A' ? (run.raw.events ?? []) : pipelinePredictions(run);
                const review = reviews.pairs.find(r => r.articleId === run.caseId && r.model === run.model && r.level === level && r.jobId === run.jobId && r.status === 'adjudicated' && r.method === 'human' && r.reviewer);
                if (!review) {
                    missingReviews.push({ caseId: run.caseId, model: run.model, level, jobId: run.jobId });
                    continue;
                }
                const expected = review.alternativeId ? label.acceptableAlternatives.find(a => a.id === review.alternativeId)?.events : label.expectedEvents;
                if (!expected)
                    throw Error('Unapproved expected alternative');
                const article = ctx.articles.find(a => a.id === run.caseId);
                const counts = compareEvents(actual, expected, review, article.article.title + '\n' + article.article.content, ISO_CODES);
                rows.push({ caseId: run.caseId, category: run.category, model: run.model, level, jobId: run.jobId, expectedEvents: expected.length, predictedEvents: actual.length, counts, metrics: summarize(counts) });
            }
    const quality = ctx.config.models.map(model => ({ model: model.key, levels: Object.fromEntries(['A', 'B'].map(level => { const selected = rows.filter(r => r.model === model.key && r.level === level); return [level, { adjudicatedArticles: selected.length, plannedArticles: 100, metrics: summarize(aggregate(selected.map(r => r.counts))), categories: Object.fromEntries([...new Set(ctx.articles.map(a => a.category))].map(category => { const group = selected.filter(r => r.category === category); return [category, { articles: group.length, plannedArticles: ctx.articles.filter(a => a.category === category).length, metrics: summarize(aggregate(group.map(r => r.counts))) }]; })), multiEventArticles: { count: selected.filter(r => r.expectedEvents > 1).length, metrics: summarize(aggregate(selected.filter(r => r.expectedEvents > 1).map(r => r.counts))) } }]; })) }));
    const paired = {};
    for (const level of ['A', 'B']) {
        const pairs = ctx.articles.flatMap(a => { const ministral = rows.find(r => r.caseId === a.id && r.level === level && r.model === 'ministral'), gemini = rows.find(r => r.caseId === a.id && r.level === level && r.model === 'gemini'); return ministral && gemini ? [{ caseId: a.id, ministral: ministral.counts, gemini: gemini.counts }] : []; });
        const f1 = (c, k) => { const x = c[k]; return 2 * x.tp + x.fp + x.fn ? 2 * x.tp / (2 * x.tp + x.fp + x.fn) : null; };
        const verdict = p => {
            const a = summarize(p.ministral), b = summarize(p.gemini);
            if (p.ministral.relationships.fp !== p.gemini.relationships.fp)
                return p.gemini.relationships.fp < p.ministral.relationships.fp ? 'gemini' : 'ministral';
            for (const key of ['relationships', 'countries', 'roles', 'events']) {
                const av = a[key === 'events' ? 'event' : key].f1.value, bv = b[key === 'events' ? 'event' : key].f1.value;
                if (av !== null && bv !== null && av !== bv)
                    return bv > av ? 'gemini' : 'ministral';
            }
            return 'tie';
        };
        paired[level] = { articles: pairs.length, matchedSubset: { ministral: summarize(aggregate(pairs.map(p => p.ministral))), gemini: summarize(aggregate(pairs.map(p => p.gemini))) }, categories: Object.fromEntries([...new Set(ctx.articles.map(a => a.category))].map(category => { const chosen = pairs.filter(p => ctx.articles.find(a => a.id === p.caseId).category === category); return [category, { pairedArticles: chosen.length, ministral: summarize(aggregate(chosen.map(p => p.ministral))), gemini: summarize(aggregate(chosen.map(p => p.gemini))) }]; })), winTieLoss: pairs.reduce((n, p) => { n[verdict(p)]++; return n; }, { ministral: 0, gemini: 0, tie: 0 }), decisionRule: 'Descriptive lexicographic per-article comparison: fewer false relationships, then relationship/country/role F1, then event F1; not an overall significance claim.', confidenceIntervals: { eventF1Delta: pairedBootstrap(pairs, c => f1(c, 'events'), ctx.config.bootstrapSeed, ctx.config.bootstrapReplicates), relationshipF1Delta: pairedBootstrap(pairs, c => f1(c, 'relationships'), ctx.config.bootstrapSeed, ctx.config.bootstrapReplicates), falseRelationshipRateDelta: pairedBootstrap(pairs, c => c.predictedRelationships ? c.relationships.fp / c.predictedRelationships : null, ctx.config.bootstrapSeed, ctx.config.bootstrapReplicates) } };
    }
    const operational = [], costs = [], stability = [];
    for (const model of ctx.config.models) {
        const main = runs.filter(r => r.model === model.key && r.phase === 'main'), http = attempts.filter(a => a.model === model.key && a.phase === 'main'), http200 = main.filter(r => http.some(a => a.jobId === r.jobId && a.response?.status === 200)), valid = main.filter(r => r.pipeline?.processingStatus === 'completed' && r.raw.schemaValid && (r.pipeline.claims ?? []).every(c => c.validationStatus === 'Valid'));
        const latency = main.map(r => r.wallLatencyMs);
        operational.push({ model: model.key, logicalArticlesAttempted: main.length, plannedArticles: 100, httpAttempts: http.length, httpStatusCounts: Object.fromEntries([...new Set(http.map(a => a.response?.status ?? 'network'))].map(status => [status, http.filter(a => (a.response?.status ?? 'network') === status).length])), successfulHttpRequests: ratio(http.filter(a => a.response?.status === 200).length, http.length), http400: http.filter(a => a.response?.status === 400).length, http429: http.filter(a => a.response?.status === 429).length, http500_502_503: http.filter(a => [500, 502, 503].includes(a.response?.status)).length, timeouts: http.filter(a => /timeout/i.test(a.networkError ?? '')).length, otherNetworkErrors: http.filter(a => a.networkError && !/timeout/i.test(a.networkError)).length, jsonValidity: ratio(http200.filter(r => r.raw.jsonValid).length, http200.length), invalidJson: http200.filter(r => !r.raw.jsonValid).length, schemaValidationFailures: http200.filter(r => r.raw.jsonValid && !r.raw.schemaValid).length, backendValidationFailures: main.filter(r => (r.pipeline.claims ?? []).some(c => c.validationStatus !== 'Valid')).length, retryCount: main.reduce((n, r) => n + r.retryCount, 0), successfulProcessingRate: ratio(valid.length, main.length), processingDefinition: 'Completed envelope and strict schema; every extracted claim Valid (including legitimate zero-event outputs). Partial valid claims are counted separately below.', partiallyAcceptedArticles: main.filter(r => (r.pipeline.claims ?? []).some(c => c.validationStatus === 'Valid')).length, latency: { allRequests: { n: latency.length, meanMs: latency.length ? latency.reduce((a, b) => a + b, 0) / latency.length : null, medianMs: quantile(latency, .5), p95Ms: quantile(latency, .95) }, successfulHttpArticles: { n: http200.length, medianMs: quantile(http200.map(r => r.wallLatencyMs), .5), p95Ms: quantile(http200.map(r => r.wallLatencyMs), .95) } } });
        const unknown = http.filter(a => ['uncertain', 'reserved'].includes(a.status)), known = http.filter(a => a.estimatedCostUsd !== null).reduce((s, a) => s + a.estimatedCostUsd, 0), total = unknown.length ? null : known, validEvents = main.reduce((n, r) => n + pipelinePredictions(r).length, 0), correct = rows.filter(r => r.model === model.key && r.level === 'A').reduce((n, r) => n + r.counts.events.tp, 0), correctCovered = rows.filter(r => r.model === model.key && r.level === 'A').length === 100;
        costs.push({ model: model.key, scope: 'main only; smoke/consistency/reprint costs are separately in archived attempts', pricing: model, knownEstimatedSubtotalUsd: known, totalEstimatedUsd: total, unknownRequests: unknown.length, reservationLiabilityUsd: unknown.reduce((s, a) => s + a.reservedUsd, 0), inputTokens: http.reduce((s, a) => s + (a.usage?.inputTokens ?? 0), 0), outputTokensIncludingThoughts: http.reduce((s, a) => s + (a.usage?.outputTokens ?? 0), 0), providerReportedTotalTokens: http.every(a => a.usage?.totalTokens !== null && a.usage?.totalTokens !== undefined) ? http.reduce((s, a) => s + a.usage.totalTokens, 0) : null, costPerArticle: costMetric(total, main.length), costPerValidEvent: costMetric(total, validEvents), costPerCorrectEvent: costMetric(correctCovered ? total : null, correct), costPer1000ArticlesUsd: total !== null && main.length ? total / main.length * 1000 : null, projectedMonthly: { scenarioArticles: ctx.config.monthlyVolumeScenarioArticles, estimatedUsd: total !== null && main.length ? total / main.length * ctx.config.monthlyVolumeScenarioArticles : null }, retryOverheadMs: http.filter(a => Number(a.requestId.split('__').at(-1)) > 1).reduce((s, a) => s + (a.durationMs ?? 0), 0) });
        for (const id of ctx.config.consistencyArticleIds) {
            const sample = runs.filter(r => r.model === model.key && r.phase === 'consistency' && r.caseId === id).sort((a, b) => a.repeat - b.repeat), comparable = sample.length === 3 && sample.every(r => r.raw.jsonValid && Array.isArray(r.raw.events));
            stability.push({ model: model.key, caseId: id, received: sample.length, comparable, features: Object.fromEntries(['count', 'countries', 'roles', 'relationships', 'modality'].map(field => [field, comparable ? consistency(sample, r => field === 'count' ? String(r.raw.events.length) : semanticSignature(r.raw.events, field)) : { complete: false, agreement: null }])), jsonValidity: consistency(sample, r => String(r.raw.jsonValid)), allThreeJsonValid: sample.length === 3 && sample.every(r => r.raw.jsonValid), note: 'Structural feature consistency, order independent, not a semantic equivalence judgement.' });
        }
    }
    const dedupRows = [];
    for (const review of reviews.deduplication ?? []) {
        if (review.status !== 'adjudicated' || review.method !== 'human' || !review.reviewer || typeof review.expectedSame !== 'boolean')
            continue;
        const left = runs.find(r => r.jobId === review.leftJobId), right = runs.find(r => r.jobId === review.rightJobId);
        if (!left || !right || left.model !== right.model || left.model !== review.model)
            throw Error('Invalid dedup review jobs');
        const a = left.pipeline.claims.find(c => c.id === review.leftClaimId), b = right.pipeline.claims.find(c => c.id === review.rightClaimId);
        if (!a || !b) {
            if (review.extractionUnavailable) {
                dedupRows.push({ pairId: review.pairId, model: review.model, expectedSame: review.expectedSame, eligible: false, reason: 'extraction_unavailable' });
                continue;
            }
            throw Error('Missing dedup claim');
        }
        if (a.validationStatus !== 'Valid' || b.validationStatus !== 'Valid') {
            dedupRows.push({ pairId: review.pairId, model: review.model, expectedSame: review.expectedSame, eligible: false, reason: 'claims_not_valid' });
            continue;
        }
        const auto = !!a.canonicalEventId && a.canonicalEventId === b.canonicalEventId, leftIds = new Set([a.canonicalEventId, ...(a.mergeCandidates ?? []).map(c => c.canonicalEventId)].filter(Boolean)), rightIds = [b.canonicalEventId, ...(b.mergeCandidates ?? []).map(c => c.canonicalEventId)].filter(Boolean), candidate = auto || rightIds.some(id => leftIds.has(id));
        dedupRows.push({ pairId: review.pairId, model: review.model, expectedSame: review.expectedSame, eligible: true, autoLink: auto, candidate });
    }
    const dedupMetrics = ctx.config.models.map(m => { const all = dedupRows.filter(r => r.model === m.key), selected = all.filter(r => r.eligible); const binary = field => selected.reduce((c, r) => { c[r[field] ? (r.expectedSame ? 'tp' : 'fp') : (r.expectedSame ? 'fn' : 'tn')]++; return c; }, { tp: 0, fp: 0, fn: 0, tn: 0 }); return { model: m.key, adjudicatedPairs: all.length, extractionUnavailable: all.length - selected.length, eligiblePairs: selected.length, positivePairs: selected.filter(r => r.expectedSame).length, negativePairs: selected.filter(r => !r.expectedSame).length, autoLink: { ...prf(binary('autoLink')), tn: binary('autoLink').tn, precisionEstimableWithNegativeControls: selected.some(r => !r.expectedSame) }, candidate: { ...prf(binary('candidate')), tn: binary('candidate').tn, precisionEstimableWithNegativeControls: selected.some(r => !r.expectedSame) }, notice: 'No precision claim without manually judged negative controls; extraction-unavailable pairs are reported separately, never imputed as successful dedup.' }; });
    const errors = { status: runs.length ? 'observed' : 'not_run', configurationAndAdapter: attempts.filter(a => a.response?.status === 400).map(a => ({ requestId: a.requestId, phase: a.phase, response: a.response })), provider: attempts.filter(a => a.response?.status === 429 || a.response?.status >= 500 || a.networkError).map(a => ({ requestId: a.requestId, phase: a.phase, response: a.response, networkError: a.networkError })), modelStructure: runs.filter(r => r.raw.jsonValid && !r.raw.schemaValid || !r.raw.jsonValid && r.raw.text).map(r => ({ jobId: r.jobId, jsonValid: r.raw.jsonValid, schemaValid: r.raw.schemaValid })), backendValidation: runs.flatMap(r => (r.pipeline.claims ?? []).filter(c => c.validationStatus !== 'Valid').map(c => ({ jobId: r.jobId, claimId: c.id, status: c.validationStatus, reasons: c.reviewReasons }))), notice: 'Smoke/configuration failures are excluded from main quality denominators. A main adapter failure invalidates that series; do not silently rerun with changed settings.' };
    const configurationInvalidated = attempts.some(a => a.phase !== 'smoke' && a.response?.status === 400) || runs.some(r => r.modelMismatch);
    const fullAssessment = runs.length === jobs(ctx).length && rows.length === 400 - unavailableRaw.length && rows.every(r => r.counts.manualCountryCount === r.counts.predictedCountries && r.counts.manualEvidenceCount === r.counts.evidenceCount && r.counts.manualRelationshipCount === r.counts.predictedRelationships && r.counts.titleModalityCount === r.counts.events.tp + r.counts.events.fp);
    const metrics = { status: configurationInvalidated ? 'invalid_configuration_series' : truthStatus.ready && fullAssessment ? 'human_adjudicated' : 'pending_or_partial', configurationInvalidated, planSha256: ctx.planSha256, groundTruth: truthStatus, missingManualAlignments: missingReviews, unavailableRawModelOutputs: unavailableRaw, completedLogicalRuns: runs.length, plannedLogicalRuns: jobs(ctx).length, quality, paired, perArticle: rows, operational, consistency: stability, deduplication: { status: 'requires_manual_source_reprint_event_alignment', pairsPlanned: ctx.reprints.length, observedRuns: runs.filter(r => r.phase === 'deduplication').map(r => ({ jobId: r.jobId, sourceArticleId: ctx.reprints.find(p => p.id === r.caseId)?.sourceArticleId, claimCanonicalIds: (r.pipeline.claims ?? []).map(c => c.canonicalEventId), claims: (r.pipeline.claims ?? []).map(c => ({ id: c.id, canonicalEventId: c.canonicalEventId, mergeCandidates: c.mergeCandidates })) })), humanAdjudicated: dedupMetrics, perPair: dedupRows, precision: null, recall: null }, recommendation: 'No automatic winner or production provider switch. Human labels/adjudication and paired uncertainty are required. Prioritize false international relationships over cost.' };
    await writeJson(path.join(ROOT, 'metrics.json'), metrics);
    await writeJson(path.join(ROOT, 'errors.json'), errors);
    await writeJson(path.join(ROOT, 'cost-analysis.json'), { status: runs.length ? 'observed' : 'not_run', main: costs, allPhases: { knownEstimatedUsd: attempts.reduce((s, a) => s + (a.estimatedCostUsd ?? 0), 0), unknownRequests: attempts.filter(a => ['uncertain', 'reserved'].includes(a.status)).length }, notice: 'Estimated at frozen verified rates, not provider billing. Unknown cost is never treated as zero.' });
    for (const model of ctx.config.models)
        await writeJson(path.join(ROOT, 'runs-' + model.key + '.json'), { status: runs.length ? 'observed' : 'not_run', planSha256: ctx.planSha256, runs: runs.filter(r => r.model === model.key) });
    console.log(JSON.stringify({ completedRuns: runs.length, truth: truthStatus, qualityArticleLevels: rows.length, paidRequestsStarted: attempts.length }));
    return metrics;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    await analyze();
