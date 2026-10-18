import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { inspectReview, compareReviews } from '../../benchmark/review-preparation/check-review.mjs';

const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map(p => fs.rm(p, { recursive: true, force: true }))); });
async function fixture() {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'world-lens-review-')); folders.push(folder);
  const title = 'Bilateral talks', content = 'France and Germany held talks today.';
  await fs.writeFile(path.join(folder, 'source.txt'), content);
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  const dataset = { articles: [{ id: 'C1', article: { title }, contentFile: 'source.txt', contentSha256: hash }] };
  const event = { id: 'E1', actionDescription: 'France and Germany meet', event_type: 'diplomacy', event_status: 'completed', countries: [{ code: 'FR', role: 'partner' }, { code: 'DE', role: 'partner' }], relationships: [{ source_country: 'FR', target_country: 'DE', type: 'diplomacy', direction: 'bidirectional', supportingEvidenceIds: ['Q1'] }], evidence: [{ id: 'Q1', start: title.length + 1, end: title.length + 1 + content.length, text: content }] };
  const review = { reviewer: 'human-A', method: 'human', status: 'submitted', articles: [{ articleId: 'C1', contentSha256: hash, reviewedAt: '2026-10-18T00:00:00Z', expectedEvents: [event] }] };
  const datasetPath = path.join(folder, 'dataset.json'), reviewPath = path.join(folder, 'review.json');
  await fs.writeFile(datasetPath, JSON.stringify(dataset));
  return { folder, review, event, datasetPath, reviewPath, async check() { await fs.writeFile(reviewPath, JSON.stringify(review)); return inspectReview(datasetPath, reviewPath); } };
}
describe('independent annotation preparation', () => {
  it('accepts mechanically valid human submission without adjudicating it', async () => { const f = await fixture(); const r = await f.check(); expect(r.errors).toEqual([]); expect(r.status).toBe('mechanically_valid_requires_human_adjudication'); });
  it('rejects machine authorship even when the labels look complete', async () => { const f = await fixture(); f.review.method = 'machine_draft'; const r = await f.check(); expect(r.status).toBe('invalid_or_unsubmitted'); });
  it('catches exact quote tampering and missing relationship evidence', async () => { const f = await fixture(); f.event.evidence[0].text = 'Not the source'; f.event.relationships[0].supportingEvidenceIds = ['missing']; const r = await f.check(); expect(r.errors.some(e => e.includes('offset mismatch'))).toBe(true); expect(r.errors.some(e => e.includes('evidence reference'))).toBe(true); });
  it('blocks same-reviewer comparison and does not equate textual agreement with truth', async () => { const f = await fixture(); const a = await f.check(); expect(compareReviews(a, a).status).toBe('pending_valid_independent_submissions'); const b = { ...a, reviewer: 'human-B' }; const result = compareReviews(a, b); expect(result.differences).toEqual([]); expect(result.humanAdjudicated).toBe(false); expect(result.semanticAgreementScore).toBeNull(); });
  it('rejects changed source hashes and unexpected article IDs', async () => { const f = await fixture(); await fs.writeFile(path.join(f.folder, 'source.txt'), 'Changed source'); f.review.articles[0].articleId = 'UNKNOWN'; const r = await f.check(); expect(r.errors.some(e => e.includes('corpus hash mismatch'))).toBe(true); expect(r.errors.some(e => e.includes('Unknown review'))).toBe(true); expect(r.pending).toEqual(['C1']); });
});
