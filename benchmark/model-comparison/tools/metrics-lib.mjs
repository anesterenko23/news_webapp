const ratio = (numerator, denominator) => ({ numerator, denominator, value: denominator ? numerator / denominator : null });
export { ratio };
export const setCounts = (predicted, expected) => { const p = new Set(predicted), e = new Set(expected); return { tp: [...p].filter(v => e.has(v)).length, fp: [...p].filter(v => !e.has(v)).length, fn: [...e].filter(v => !p.has(v)).length }; };
export const prf = c => ({ precision: ratio(c.tp, c.tp + c.fp), recall: ratio(c.tp, c.tp + c.fn), f1: ratio(2 * c.tp, 2 * c.tp + c.fp + c.fn), ...c });
export function edge(r) { const p = r.direction === 'bidirectional' ? [r.source_country, r.target_country].sort() : [r.source_country, r.target_country]; return JSON.stringify([p[0], p[1], r.type, r.direction]); }
const asArray = value => Array.isArray(value) ? value : typeof value === 'string' ? JSON.parse(value) : [];
export function pipelinePredictions(run) {
    const used = new Set();
    return (run.pipeline?.claims ?? []).filter(c => c.validationStatus === 'Valid' && c.canonicalEventId && !used.has(c.canonicalEventId) && used.add(c.canonicalEventId)).map(c => {
        const ids = new Map(c.evidence.map(q => [q.temporaryId, q.id]));
        const references = value => asArray(value).map(id => ids.get(id) ?? id);
        return { id: c.id, canonicalEventId: c.canonicalEventId, title: c.title, event_type: c.eventType, event_status: c.eventStatus, countries: c.participants.map(p => ({ code: p.countryCode, role: p.role, attribution_evidence_ids: references(p.attributionEvidenceIds) })), entities: (c.entities ?? []).map(e => ({ ...e, evidence_ids: references(e.evidence_ids) })), relationships: c.relationships.map(r => ({ source_country: r.sourceCountry, target_country: r.targetCountry, type: r.type, direction: r.direction, evidence_ids: references(r.evidenceIds) })), evidence: c.evidence.map(e => ({ id: e.id, text: e.text, startOffset: e.startOffset, endOffset: e.endOffset })) };
    });
}
export function compareEvents(actual, expected, review, original, isoCodes) {
    const obj = v => v && typeof v === 'object' ? v : {};
    const p = actual.map(value => { const e = obj(value); return { ...e, ...Object.fromEntries(['countries', 'relationships', 'evidence', 'entities'].map(key => [key, Array.isArray(e[key]) ? e[key].map(obj) : []])) }; }), e = expected;
    const matchedP = new Set(), matchedE = new Set();
    for (const m of review.matches) {
        if (!Number.isInteger(m.predictionIndex) || m.predictionIndex < 0 || m.predictionIndex >= p.length || matchedP.has(m.predictionIndex))
            throw Error('Invalid/duplicate manual predicted alignment');
        const j = e.findIndex(x => x.id === m.expectedEventId);
        if (j < 0 || matchedE.has(j))
            throw Error('Invalid/duplicate manual expected alignment');
        matchedP.add(m.predictionIndex);
        matchedE.add(j);
    }
    const c = { events: { tp: review.matches.length, fp: p.length - review.matches.length, fn: e.length - review.matches.length }, countries: { tp: 0, fp: 0, fn: 0 }, roles: { tp: 0, fp: 0, fn: 0 }, relationships: { tp: 0, fp: 0, fn: 0 }, roleCorrect: 0, roleCompared: 0, eventTypeCorrect: 0, modalityCorrect: 0, modalityCompared: review.matches.length, predictedCountries: 0, invalidIso: 0, organizationAsCountry: 0, manualCountryCount: 0, manualOrganizationAsCountry: 0, predictedInitiators: 0, incorrectInitiators: 0, predictedTargets: 0, incorrectTargets: 0, predictedRelationships: 0, incorrectDirections: 0, evidenceCount: 0, exactQuotes: 0, referenceCount: 0, validReferences: 0, manualEvidenceCount: 0, evidenceAttributionCorrect: 0, unsupportedEvidence: 0, paraphrasedQuotes: 0, manualRelationshipCount: 0, unsupportedRelationships: 0, titleModalityCount: 0, titleModalityCorrect: 0, falseRelationshipCauses: {} };
    const add = (name, values) => {
        for (const k of ['tp', 'fp', 'fn'])
            c[name][k] += values[k];
    };
    const statuses = ['completed', 'announced', 'planned', 'proposed', 'alleged', 'denied', 'speculative', 'unknown'];
    c.modalityByStatus = Object.fromEntries(statuses.flatMap(status => [[status + '_expected', e.filter(x => x.event_status === status).length], [status + '_predicted', p.filter(x => x.event_status === status).length], [status + '_correct', 0]]));
    const entries = [...review.matches.map(m => [p[m.predictionIndex], e.find(x => x.id === m.expectedEventId)]), ...p.flatMap((a, i) => matchedP.has(i) ? [] : [[a, {}]]), ...e.flatMap((a, i) => matchedE.has(i) ? [] : [[{}, a]])];
    for (const [a, b] of entries) {
        const ac = Array.isArray(a.countries) ? a.countries : [], bc = b.countries ?? [];
        const ar = Array.isArray(a.relationships) ? a.relationships : [], br = b.relationships ?? [];
        add('countries', setCounts(ac.map(x => x.code), bc.map(x => x.code)));
        add('roles', setCounts(ac.map(x => x.code + ':' + x.role), bc.map(x => x.code + ':' + x.role)));
        add('relationships', setCounts(ar.map(edge), br.map(edge)));
        for (const country of ac) {
            if (bc.some(x => x.code === country.code)) {
                c.roleCompared++;
                if (bc.some(x => x.code === country.code && x.role === country.role))
                    c.roleCorrect++;
            }
            for (const [role, count, wrong] of [['initiator', 'predictedInitiators', 'incorrectInitiators'], ['target', 'predictedTargets', 'incorrectTargets']])
                if (country.role === role) {
                    c[count]++;
                    if (!bc.some(x => x.code === country.code && x.role === role))
                        c[wrong]++;
                }
        }
        for (const link of ar) {
            c.predictedRelationships++;
            if (!br.some(r => edge(r) === edge(link)) && br.some(r => r.type === link.type && [r.source_country, r.target_country].sort().join(':') === [link.source_country, link.target_country].sort().join(':')))
                c.incorrectDirections++;
        }
    }
    for (const m of review.matches) {
        const a = p[m.predictionIndex], b = e.find(x => x.id === m.expectedEventId);
        if (a.event_type === b.event_type)
            c.eventTypeCorrect++;
        if (a.event_status === b.event_status) {
            c.modalityCorrect++;
            if (b.event_status + '_correct' in c.modalityByStatus)
                c.modalityByStatus[b.event_status + '_correct']++;
        }
    }
    const global = new Map();
    for (const a of p)
        for (const q of Array.isArray(a.evidence) ? a.evidence : [])
            global.set(q.id, (global.get(q.id) ?? 0) + 1);
    for (const a of p) {
        for (const country of Array.isArray(a.countries) ? a.countries : []) {
            c.predictedCountries++;
            if (!isoCodes.has(country.code))
                c.invalidIso++;
            if (/^(UN|EU|NATO|G7|G20|OSCE|United Nations|European Union)$/i.test(String(country.code)))
                c.organizationAsCountry++;
        }
        const evidence = Array.isArray(a.evidence) ? a.evidence : [], ids = new Set(evidence.map(q => q.id));
        for (const q of evidence) {
            c.evidenceCount++;
            if (typeof q.text === 'string' && q.text.length > 0 && original.includes(q.text))
                c.exactQuotes++;
        }
        const refs = [...(Array.isArray(a.countries) ? a.countries : []).flatMap(x => Array.isArray(x.attribution_evidence_ids) ? x.attribution_evidence_ids : []), ...(Array.isArray(a.entities) ? a.entities : []).flatMap(x => Array.isArray(x.evidence_ids) ? x.evidence_ids : []), ...(Array.isArray(a.relationships) ? a.relationships : []).flatMap(x => Array.isArray(x.evidence_ids) ? x.evidence_ids : [])];
        for (const ref of refs) {
            c.referenceCount++;
            if (typeof ref === 'string' && ids.has(ref) && global.get(ref) === 1)
                c.validReferences++;
        }
    }
    if (review.countryErrorsReviewed === true) {
        c.manualCountryCount = c.predictedCountries;
        const seen = new Set();
        for (const item of review.countryErrors ?? []) {
            const key = item.predictionIndex + ':' + item.countryIndex;
            if (seen.has(key) || !p[item.predictionIndex]?.countries?.[item.countryIndex] || !['organization_as_country', 'other'].includes(item.kind))
                throw Error('Invalid country error adjudication');
            seen.add(key);
            if (item.kind === 'organization_as_country')
                c.manualOrganizationAsCountry++;
        }
    }
    const assessedEvidence = new Set();
    for (const item of review.evidence ?? []) {
        if (typeof item.attributionCorrect !== 'boolean' || !['supported', 'unsupported', 'ambiguous'].includes(item.support) || !['exact', 'format_only', 'paraphrase', 'unrelated'].includes(item.quoteKind))
            throw Error('Incomplete manual evidence assessment');
        const key = item.predictionIndex + ':' + item.evidenceId;
        if (assessedEvidence.has(key) || !p[item.predictionIndex]?.evidence?.some(q => q.id === item.evidenceId))
            throw Error('Invalid manual evidence assessment');
        assessedEvidence.add(key);
        c.manualEvidenceCount++;
        if (item.attributionCorrect === true)
            c.evidenceAttributionCorrect++;
        if (item.support === 'unsupported')
            c.unsupportedEvidence++;
        if (item.quoteKind === 'paraphrase')
            c.paraphrasedQuotes++;
    }
    const assessedRelationships = new Set();
    for (const item of review.relationships ?? []) {
        if (!['supported', 'unsupported', 'ambiguous'].includes(item.support))
            throw Error('Incomplete relationship support assessment');
        const key = item.predictionIndex + ':' + item.relationshipIndex;
        if (assessedRelationships.has(key) || !p[item.predictionIndex]?.relationships?.[item.relationshipIndex])
            throw Error('Invalid manual relationship support assessment');
        assessedRelationships.add(key);
        c.manualRelationshipCount++;
        if (item.support === 'unsupported')
            c.unsupportedRelationships++;
        if (item.falseCause)
            c.falseRelationshipCauses[item.falseCause] = (c.falseRelationshipCauses[item.falseCause] ?? 0) + 1;
    }
    const assessedTitles = new Set();
    for (const item of review.titleModality ?? []) {
        if (typeof item.consistent !== 'boolean' || assessedTitles.has(item.predictionIndex))
            throw Error('Incomplete/duplicate title modality assessment');
        assessedTitles.add(item.predictionIndex);
        if (!p[item.predictionIndex])
            throw Error('Invalid title modality assessment');
        c.titleModalityCount++;
        if (item.consistent)
            c.titleModalityCorrect++;
    }
    return c;
}
export function aggregate(items) {
    const out = {};
    for (const row of items)
        for (const [k, value] of Object.entries(row)) {
            if (typeof value === 'number')
                out[k] = (out[k] ?? 0) + value;
            else if (value && typeof value === 'object') {
                out[k] ??= {};
                for (const [sub, n] of Object.entries(value))
                    out[k][sub] = (out[k][sub] ?? 0) + n;
            }
        }
    return out;
}
export function summarize(c) {
    if (!c.events)
        return null;
    return { event: prf(c.events), countries: prf(c.countries), roles: prf(c.roles), relationships: prf(c.relationships), missedEvents: c.events.fn, hallucinatedEvents: c.events.fp, eventTypeAccuracy: ratio(c.eventTypeCorrect, c.modalityCompared), roleAccuracy: ratio(c.roleCorrect, c.roleCompared), incorrectInitiatorRate: ratio(c.incorrectInitiators, c.predictedInitiators), incorrectTargetRate: ratio(c.incorrectTargets, c.predictedTargets), invalidIsoRate: ratio(c.invalidIso, c.predictedCountries), organizationAsCountryRate: ratio(c.manualOrganizationAsCountry, c.manualCountryCount), obviousOrganizationAsCountryLowerBound: ratio(c.organizationAsCountry, c.predictedCountries), falseRelationshipRate: ratio(c.relationships.fp, c.predictedRelationships), incorrectDirectionRate: ratio(c.incorrectDirections, c.predictedRelationships), unsupportedRelationshipRate: ratio(c.unsupportedRelationships, c.manualRelationshipCount), validReferenceRate: ratio(c.validReferences, c.referenceCount), exactQuoteMatchRate: ratio(c.exactQuotes, c.evidenceCount), evidenceAttributionAccuracy: ratio(c.evidenceAttributionCorrect, c.manualEvidenceCount), unsupportedEvidenceRate: ratio(c.unsupportedEvidence, c.manualEvidenceCount), quoteParaphrasingRate: ratio(c.paraphrasedQuotes, c.manualEvidenceCount), modalityAccuracy: ratio(c.modalityCorrect, c.modalityCompared), modalityCounts: c.modalityByStatus, titleModalityAccuracy: ratio(c.titleModalityCorrect, c.titleModalityCount), assessmentCoverage: { countries: ratio(c.manualCountryCount, c.predictedCountries), evidence: ratio(c.manualEvidenceCount, c.evidenceCount), relationships: ratio(c.manualRelationshipCount, c.predictedRelationships), titles: ratio(c.titleModalityCount, c.events.tp + c.events.fp) }, falseRelationshipCauses: c.falseRelationshipCauses };
}
export function quantile(values, q) {
    if (!values.length)
        return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
}
export function pairedBootstrap(pairs, metric, seed = 461018, replicates = 5000) {
    if (pairs.length < 20)
        return { status: 'insufficient_paired_articles', n: pairs.length, interval: null };
    let state = seed >>> 0;
    const random = () => { state = (1664525 * state + 1013904223) >>> 0; return state / 4294967296; };
    const deltas = [];
    for (let b = 0; b < replicates; b++) {
        const picked = Array.from({ length: pairs.length }, () => pairs[Math.floor(random() * pairs.length)]);
        const left = metric(aggregate(picked.map(p => p.ministral))), right = metric(aggregate(picked.map(p => p.gemini)));
        if (left !== null && right !== null)
            deltas.push(right - left);
    }
    return { status: deltas.length ? 'computed' : 'undefined_denominators', method: 'Paired article-level percentile bootstrap; micro counts reaggregated in each sample. Delta Gemini minus Ministral.', n: pairs.length, seed, replicates, validReplicates: deltas.length, confidence: .95, interval: deltas.length ? [quantile(deltas, .025), quantile(deltas, .975)] : null };
}
export function consistency(runs, project) {
    if (runs.length !== 3)
        return { complete: false, agreement: null };
    const values = runs.map(project);
    return { complete: true, agreement: values[0] === values[1] && values[1] === values[2], values };
}
export function semanticSignature(events, field) { return JSON.stringify(events.map(e => field === 'count' ? null : field === 'countries' ? (e.countries ?? []).map(c => c.code).sort() : field === 'roles' ? (e.countries ?? []).map(c => c.code + ':' + c.role).sort() : field === 'relationships' ? (e.relationships ?? []).map(edge).sort() : field === 'modality' ? [e.event_type, e.event_status] : null).map(x => JSON.stringify(x)).sort()); }
