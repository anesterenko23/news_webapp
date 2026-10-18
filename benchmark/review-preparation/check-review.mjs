import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ISO_CODES, TAXONOMY, EVENT_STATUSES, ROLES } from '../../backend/dist/schemas.js';

// Mechanical validation only. This tool never grants human approval or selects
// the semantically correct event/relationship from two reviewers' answers.
export async function inspectReview(datasetPath, reviewPath) {
  const dataset = JSON.parse(await fs.readFile(datasetPath, 'utf8'));
  const review = JSON.parse(await fs.readFile(reviewPath, 'utf8'));
  const errors = [], pending = [], records = [];
  const reviewed = review.method === 'human' && review.status === 'submitted' && typeof review.reviewer === 'string' && review.reviewer.trim();
  if (!reviewed) errors.push('Reviewer identity, method=human and status=submitted required; machine drafts cannot be approved here.');
  const rows = review.articles ?? [];
  const sourceIds = new Set(dataset.articles.map(a => a.id));
  if (new Set(rows.map(r => r.articleId)).size !== rows.length) errors.push('Duplicate review article IDs');
  for (const row of rows) if (!sourceIds.has(row.articleId)) errors.push('Unknown review article ID: ' + row.articleId);
  for (const article of dataset.articles) {
    const row = rows.find(r => r.articleId === article.id);
    const relative = article.contentFile;
    const corpusRoot = path.resolve(path.dirname(datasetPath));
    const textPath = path.resolve(corpusRoot, relative);
    if (!textPath.startsWith(corpusRoot + path.sep)) throw Error('Source path escapes review package');
    const content = await fs.readFile(textPath, 'utf8');
    const digest = crypto.createHash('sha256').update(content).digest('hex');
    if (digest !== article.contentSha256) errors.push(article.id + ': corpus hash mismatch');
    if (!row || row.expectedEvents === null || row.expectedEvents === undefined) { pending.push(article.id); continue; }
    if (!Array.isArray(row.expectedEvents)) { errors.push(article.id + ': expectedEvents must be array or pending null'); continue; }
    if (row.contentSha256 !== digest) errors.push(article.id + ': review hash mismatch');
    if (!row.reviewedAt || !Number.isFinite(Date.parse(row.reviewedAt))) errors.push(article.id + ': reviewedAt required');
    const original = article.article.title + '\n' + content;
    const eventIds = new Set();
    for (const event of row.expectedEvents) {
      const prefix = article.id + '/' + event.id;
      if (!event.id || eventIds.has(event.id)) errors.push(prefix + ': missing/duplicate event ID');
      eventIds.add(event.id);
      if (!event.actionDescription?.trim() || !TAXONOMY.includes(event.event_type) || !EVENT_STATUSES.includes(event.event_status)) errors.push(prefix + ': incomplete action/type/modality');
      const countries = Array.isArray(event.countries) ? event.countries : [];
      if (!Array.isArray(event.countries) || countries.some(c => !ISO_CODES.has(c.code) || !ROLES.includes(c.role))) errors.push(prefix + ': invalid country/role');
      const evidence = event.evidence;
      if (!Array.isArray(evidence) || !evidence.length) { errors.push(prefix + ': evidence required'); continue; }
      if (new Set(evidence.map(q => q.id)).size !== evidence.length) errors.push(prefix + ': duplicate evidence IDs');
      for (const q of evidence) if (!q.id || !Number.isInteger(q.start) || !Number.isInteger(q.end) || q.start < 0 || q.end <= q.start || q.end > original.length || original.slice(q.start, q.end) !== q.text) errors.push(prefix + ': exact evidence/UTF-16 offset mismatch');
      if (!Array.isArray(event.relationships)) errors.push(prefix + ': relationships array required');
      for (const r of Array.isArray(event.relationships) ? event.relationships : []) {
        if (r.source_country === r.target_country || !countries.some(c => c.code === r.source_country) || !countries.some(c => c.code === r.target_country) || !TAXONOMY.includes(r.type) || !['directed', 'bidirectional'].includes(r.direction)) errors.push(prefix + ': invalid relationship endpoints/type/direction');
        if (!Array.isArray(r.supportingEvidenceIds) || !r.supportingEvidenceIds.length || r.supportingEvidenceIds.some(id => !evidence.some(q => q.id === id))) errors.push(prefix + ': missing relationship evidence reference');
      }
    }
    records.push({ articleId: article.id, events: row.expectedEvents });
  }
  return { status: errors.length ? 'invalid_or_unsubmitted' : pending.length ? 'incomplete' : 'mechanically_valid_requires_human_adjudication', reviewer: review.reviewer ?? null, totalArticles: dataset.articles.length, labelledArticles: records.length, pending, errors, records };
}
const sorted = values => values.map(v => JSON.stringify(v)).sort();
function signature(events) {
  return JSON.stringify(sorted(events.map(e => ({ actionDescription: e.actionDescription, type: e.event_type, status: e.event_status,
    countries: sorted(e.countries),
    relationships: sorted(e.relationships.map(r => ({ source: r.direction === 'bidirectional' ? [r.source_country, r.target_country].sort()[0] : r.source_country, target: r.direction === 'bidirectional' ? [r.source_country, r.target_country].sort()[1] : r.target_country, type: r.type, direction: r.direction }))),
    evidence: sorted(e.evidence.map(q => ({ start: q.start, end: q.end, text: q.text }))) }))));
}
export function compareReviews(left, right) {
  const eligible = !left.errors.length && !right.errors.length && left.reviewer !== right.reviewer;
  const shared = left.records.filter(a => right.records.some(b => b.articleId === a.articleId));
  return { status: eligible ? 'comparison_requires_human_resolution' : 'pending_valid_independent_submissions', independentIdentitiesDeclared: Boolean(left.reviewer && right.reviewer && left.reviewer !== right.reviewer), comparedArticles: eligible ? shared.length : 0,
    // Textually equal signatures do not prove correctness; different paraphrases
    // may also describe the same event. Never convert this output to ground truth.
    differences: eligible ? shared.filter(a => signature(a.events) !== signature(right.records.find(b => b.articleId === a.articleId).events)).map(a => ({ articleId: a.articleId, status: 'requires_human_resolution' })) : null,
    semanticAgreementScore: null, humanAdjudicated: false };
}
async function main(args) {
  const [dataset, leftPath, rightPath, output] = args;
  if (args.length !== 4) throw Error('Usage: node check-review.mjs DATASET REVIEW_A REVIEW_B OUTPUT');
  const left = await inspectReview(path.resolve(dataset), path.resolve(leftPath));
  const right = await inspectReview(path.resolve(dataset), path.resolve(rightPath));
  const result = { createdAt: new Date().toISOString(), policy: 'Mechanical checks only; no labels changed, no provider calls, no automatic adjudication.', left, right, comparison: compareReviews(left, right) };
  await fs.writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ left: left.status, right: right.status, comparison: result.comparison.status }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
