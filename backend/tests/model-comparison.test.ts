import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { compareEvents, summarize, pairedBootstrap, edge, consistency, pipelinePredictions, quantile } from '../../benchmark/model-comparison/tools/metrics-lib.mjs';
import { requireApproval, usageFrom, spent, run } from '../../benchmark/model-comparison/tools/run.mjs';
import { within, isolatedDatabase, ROOT, jobs, sha, readJson } from '../../benchmark/model-comparison/tools/common.mjs';
import { IntelligenceEngine } from '../src/engine.js';
import { PROMPT_VERSION } from '../src/prompt.js';
import { loadConfig } from '../src/config.js';
import { TREATY, AUDIT_INPUTS } from './hardening-fixtures.js';
import { validateTruth } from '../../benchmark/model-comparison/tools/analyze.mjs';
const iso = new Set(['GB', 'RU', 'FR', 'DE']);
const original = 'Britain announced sanctions against Russia.';
const expected = { id: 'e1', title: 'Sanctions', event_type: 'sanctions', event_status: 'announced', countries: [{ code: 'GB', role: 'initiator' }, { code: 'RU', role: 'target' }], relationships: [{ source_country: 'GB', target_country: 'RU', type: 'sanctions', direction: 'directed' }], evidence: [{ id: 'q', text: original }] };
const actual = () => ({ ...structuredClone(expected), evidence: [{ id: 'q', text: original }], relationships: [{ ...expected.relationships[0], evidence_ids: ['q'] }] });
const review = () => ({ matches: [{ predictionIndex: 0, expectedEventId: 'e1' }], evidence: [], relationships: [], titleModality: [] });
describe('Phase 4.6 objective metrics and manual boundaries', () => {
    it('penalizes wrong relationship type despite identical countries', () => { const a = actual(); a.relationships[0].type = 'military_aid'; const c = compareEvents([a], [expected], review(), original, iso); expect(c.events.tp).toBe(1); expect(c.relationships).toEqual({ tp: 0, fp: 1, fn: 1 }); expect(summarize(c).relationships.f1.value).toBe(0); });
    it('penalizes reversed direction and treats bilateral order as equivalent', () => { const a = actual(); [a.relationships[0].source_country, a.relationships[0].target_country] = ['RU', 'GB']; const c = compareEvents([a], [expected], review(), original, iso); expect(c.incorrectDirections).toBe(1); expect(c.relationships.fp).toBe(1); expect(edge({ ...a.relationships[0], direction: 'bidirectional' })).toBe(edge({ ...expected.relationships[0], direction: 'bidirectional' })); });
    it('separates exact quotation, local references and semantic support', () => { const a = actual(); const r = review(); r.evidence = [{ predictionIndex: 0, evidenceId: 'q', attributionCorrect: false, support: 'unsupported', quoteKind: 'exact' }]; r.relationships = [{ predictionIndex: 0, relationshipIndex: 0, support: 'unsupported', falseCause: 'co_mention' }]; const c = compareEvents([a], [expected], r, original, iso); expect(c.exactQuotes).toBe(1); expect(c.validReferences).toBe(1); expect(c.unsupportedEvidence).toBe(1); expect(c.unsupportedRelationships).toBe(1); });
    it('does not call a normalized action description a false event', () => { const a = { ...actual(), action_text: 'New British sanctions.' }; const c = compareEvents([a], [expected], review(), original, iso); expect(c.events).toEqual({ tp: 1, fp: 0, fn: 0 }); expect(c.exactQuotes).toBe(1); });
    it('counts missed events, extra claims and missing countries/roles', () => { const b = { ...structuredClone(expected), id: 'e2', countries: [{ code: 'DE', role: 'partner' }], relationships: [] }; const a = actual(); a.countries[0].role = 'target'; const c = compareEvents([a, {}], [expected, b], review(), original, iso); expect(c.events).toEqual({ tp: 1, fp: 1, fn: 1 }); expect(c.roles.fp).toBe(1); expect(c.roles.fn).toBe(2); expect(c.incorrectTargets).toBe(1); });
    it('never silently aligns events or accepts duplicate manual pairings', () => { expect(() => compareEvents([actual()], [expected], { matches: [...review().matches, ...review().matches] }, original, iso)).toThrow(); expect(compareEvents([actual()], [expected], { matches: [] }, original, iso).events).toEqual({ tp: 0, fp: 1, fn: 1 }); });
    it('rejects cross-event and duplicate evidence references', () => { const a = actual(); a.relationships[0].evidence_ids = ['other']; expect(compareEvents([a], [expected], review(), original, iso).validReferences).toBe(0); a.relationships[0].evidence_ids = ['q']; expect(compareEvents([a, actual()], [expected], review(), original, iso).validReferences).toBe(0); });
    it('does not turn missing manual semantic judgements into zero error rate', () => { const c = compareEvents([actual()], [expected], review(), original, iso); expect(summarize(c).unsupportedRelationshipRate.value).toBeNull(); expect(summarize(c).evidenceAttributionAccuracy.value).toBeNull(); expect(() => compareEvents([actual()], [expected], { ...review(), evidence: [{ predictionIndex: 0, evidenceId: 'q' }] }, original, iso)).toThrow(); });
    it('keeps pipeline-withheld claims out of Level B without deleting raw predictions', () => { expect(pipelinePredictions({ pipeline: { claims: [{ validationStatus: 'Invalid', canonicalEventId: null }] } })).toEqual([]); expect(compareEvents([actual()], [expected], review(), original, iso).events.tp).toBe(1); });
    it('handles malformed raw event records as structural failures rather than crashing scoring', () => { expect(compareEvents([null, { countries: [null], evidence: [null], relationships: [null] }], [], { matches: [] }, original, iso).events.fp).toBe(2); });
    it('uses paired resampling and refuses a confidence interval for tiny samples', () => { const c = compareEvents([actual()], [expected], review(), original, iso); const metric = (x: any) => summarize(x).relationships.f1.value; expect(pairedBootstrap([{ ministral: c, gemini: c }], metric).interval).toBeNull(); const pairs = Array.from({ length: 20 }, () => ({ ministral: c, gemini: c })); expect(pairedBootstrap(pairs, metric, 42, 100).interval).toEqual([0, 0]); expect(pairedBootstrap(pairs, metric, 42, 100)).toEqual(pairedBootstrap(pairs, metric, 42, 100)); });
    it('separates incomplete consistency groups and uses documented nearest-rank p95', () => { expect(consistency([1, 1], String).agreement).toBeNull(); expect(consistency([1, 1, 1], String).agreement).toBe(true); expect(quantile(Array.from({ length: 100 }, (_, i) => i + 1), .95)).toBe(95); });
    it('projects parsed API arrays and resolves retained temporary IDs through stored evidence mappings', () => { const a = actual(); const output = { pipeline: { claims: [{ id: 'c', validationStatus: 'Valid', canonicalEventId: 'canonical', eventType: a.event_type, eventStatus: a.event_status, title: a.title, participants: [{ countryCode: 'GB', role: 'initiator', attributionEvidenceIds: ['uuid'] }], entities: [{ evidence_ids: ['q'] }], relationships: [{ sourceCountry: 'GB', targetCountry: 'RU', type: 'sanctions', direction: 'directed', evidenceIds: ['uuid'] }], evidence: [{ id: 'uuid', temporaryId: 'q', text: original }] }] } }; const projection = pipelinePredictions(output); expect(projection[0].entities[0].evidence_ids).toEqual(['uuid']); expect(projection[0].relationships[0].evidence_ids).toEqual(['uuid']); });
    it('does not accept pending annotations as human ground truth', async () => { expect((await validateTruth({ datasetVersion: 'x', status: 'pending' }, { dataset: { version: 'x' } })).ready).toBe(false); });
});
describe('Phase 4.6 execution safety', () => {
    const ctx = { planSha256: 'frozen', config: { hardBudgetCapUsd: 10 } };
    it('requires explicit paid approval for the exact plan and budget', () => { expect(() => requireApproval([], ctx)).toThrow(); expect(() => requireApproval(['--paid', '--approve-budget=11', '--plan=frozen'], ctx)).toThrow(); expect(() => requireApproval(['--paid', '--approve-budget=10', '--plan=changed'], ctx)).toThrow(); expect(requireApproval(['--paid', '--approve-budget=10', '--plan=frozen'], ctx)).toBe(10); });
    it('does not send any network request when invoked without approval', async () => { const fetcher = vi.spyOn(globalThis, 'fetch'); await expect(run([])).rejects.toThrow('No explicit paid'); expect(fetcher).not.toHaveBeenCalled(); fetcher.mockRestore(); });
    it('accounts for thought tokens and leaves missing usage unknown', () => { expect(usageFrom('gemini', { usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3, thoughtsTokenCount: 5, totalTokenCount: 10 } })?.outputTokens).toBe(8); expect(usageFrom('gemini', {})).toBeNull(); expect(usageFrom('mistral', { usage: { prompt_tokens: 10, completion_tokens: 20 } })?.totalTokens).toBe(30); });
    it('does not allow an isolated database path to target production', async () => { expect(() => within(path.join(ROOT, 'state'), '../../../../backend/prisma/dev.db')).toThrow(); await expect(isolatedDatabase(path.join(ROOT, '../../backend/prisma/dev.db'))).rejects.toThrow('escapes'); });
    it('keeps uncertain reservations in the budget instead of treating them as free', async () => { await fs.mkdir(path.join(ROOT, 'state'), { recursive: true }); const directory = await fs.mkdtemp(path.join(ROOT, 'state', 'test-ledger-')); try {
        await fs.writeFile(path.join(directory, 'a.attempt.json'), JSON.stringify({ status: 'uncertain', estimatedCostUsd: null, reservedUsd: .4 }));
        await fs.writeFile(path.join(directory, 'b.attempt.json'), JSON.stringify({ status: 'rejected', estimatedCostUsd: 0, reservedUsd: 1 }));
        const result = await spent(directory);
        expect(result.total).toBe(.4);
        expect(result.uncertain).toBe(true);
    }
    finally {
        for (const name of await fs.readdir(directory))
            await fs.unlink(within(directory, name));
        await fs.rmdir(directory);
    } });
    it('has exactly 100 new metadata records and unlabelled human templates', async () => { const data = await readJson(path.join(ROOT, 'dataset.json')); const config = await readJson(path.join(ROOT, 'config.json')); const labels = await readJson(path.join(ROOT, 'ground-truth.template.json')); expect(data.articles).toHaveLength(100); expect(new Set(data.articles.map((a: any) => a.contentSha256)).size).toBe(100); expect(labels.articles.every((a: any) => a.expectedEvents === null && a.review.method === 'human_required')).toBe(true); const ctx = { config, articles: data.articles.map((a: any) => ({ ...a, article: { ...a.article, content: 'Placeholder for scheduling only, never sent.' } })), reprints: (await readJson(path.join(ROOT, 'deduplication-cases.json'))).cases }; const scheduled = jobs(ctx); expect(scheduled.filter((j: any) => j.phase === 'main')).toHaveLength(200); expect(scheduled.filter((j: any) => j.phase === 'consistency')).toHaveLength(120); expect(scheduled.filter((j: any) => j.phase === 'deduplication')).toHaveLength(20); expect(scheduled).toHaveLength(344); });
    it('runs actual pipeline/migrations in separate databases while retaining production idempotency', async () => { await fs.mkdir(path.join(ROOT, 'state'), { recursive: true }); const directory = await fs.mkdtemp(path.join(ROOT, 'state', 'test-pipeline-')); const provider = { extract: vi.fn(async () => JSON.stringify({ events: [TREATY], diagnostics: [] })) }; const config = loadConfig({}); const first = await isolatedDatabase(path.join(directory, 'first.db')), second = await isolatedDatabase(path.join(directory, 'second.db')); try {
        const engine = new IntelligenceEngine(first, config, provider);
        const one = await engine.process(AUDIT_INPUTS[0],undefined,PROMPT_VERSION);
        expect(one.claims[0].validationStatus).toBe('Valid');
        expect(one.claims[0].verificationStatus).toBe('Unverified');
        expect(one.claims[0].publicationStatus).toBe('NeedsReview');
        expect((await engine.process(AUDIT_INPUTS[0],undefined,PROMPT_VERSION)).cached).toBe(true);
        expect((await new IntelligenceEngine(second, config, provider).process(AUDIT_INPUTS[0],undefined,PROMPT_VERSION)).cached).toBe(false);
        expect(provider.extract).toHaveBeenCalledTimes(2);
        expect((await first.canonicalEvent.count())).toBe(1);
    }
    finally {
        await first.$disconnect();
        await second.$disconnect();
        for (const name of await fs.readdir(directory))
            await fs.unlink(within(directory, name));
        await fs.rmdir(directory);
    } });
});
