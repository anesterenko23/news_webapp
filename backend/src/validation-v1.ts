import { countryMetadata as countries } from './countries.js';
import { ISO_CODES, type Extracted } from './schemas-v1.js';
const nonActors = new Set(['commentator','mentioned']);
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function anchorEvidence(quote: string, original: string) {
  const exact = original.indexOf(quote);
  if (exact >= 0) return {text:quote,startOffset:exact,endOffset:exact+quote.length,aligned:false};
  // Repair only whitespace formatting, never wording, spelling, punctuation or omitted words.
  // Persist the original contiguous substring and retain the submitted quote in rawOutput.
  const pattern = quote.trim().split(/\s+/).map(escapeRegex).join('\\s+');
  const match = new RegExp(pattern,'u').exec(original);
  return match ? {text:match[0],startOffset:match.index,endOffset:match.index+match[0].length,aligned:true} : {text:quote,startOffset:-1,endOffset:-1,aligned:false};
}
export function validateEvidence(event: Extracted, text: string) {
  const warnings: string[] = [];
  let rejected = false;
  const fail = (message: string) => { warnings.push(message); rejected = true; };
  const participants = new Map(event.countries.map(country => [country.code,country.role]));
  if (participants.size !== event.countries.length) fail('Duplicate participant country');
  for (const code of participants.keys()) if (!ISO_CODES.has(code)) fail(`Invalid ISO country: ${code}`);
  const evidence = event.evidence.map((item, ordinal) => {
    const {aligned,...anchored} = anchorEvidence(item.text,text);
    if (anchored.startOffset < 0) fail(`Evidence ${ordinal} is not an exact quotation of the original article`);
    if (aligned) warnings.push(`Evidence ${ordinal}: whitespace aligned to its exact original substring; model quotation retained in raw output`);
    return {ordinal,...anchored};
  });
  const keys = new Set<string>();
  const actorCount = event.countries.filter(country => !nonActors.has(country.role)).length;
  const undirectedPairs = new Set(event.relationships.map(link => [link.source_country,link.target_country].sort().join(':')));
  if (actorCount > 2 && undirectedPairs.size === actorCount * (actorCount - 1) / 2) {
    const citations = event.relationships.map(link => link.evidence_refs.map(index => event.evidence[index]?.text).join('\n'));
    if (new Set(citations).size === 1) fail('Unsubstantiated all-to-all multilateral graph: every pair cites the same broad clause; explicit pair-specific evidence is required');
  }
  for (const link of event.relationships) {
    if (link.source_country === link.target_country) fail('Self relationship is not international');
    for (const code of [link.source_country,link.target_country]) {
      if (!participants.has(code)) fail(`Relationship endpoint ${code} is not a participant`);
      if (nonActors.has(participants.get(code) ?? '')) fail(`Commentator/mention ${code} cannot be a relationship actor`);
    }
    if (link.evidence_refs.some(index => index >= evidence.length)) fail('Relationship cites missing evidence');
    const pair = link.direction === 'bidirectional' ? [link.source_country,link.target_country].sort() : [link.source_country,link.target_country];
    const key = `${pair.join(':')}:${link.type}:${link.direction}`;
    if (keys.has(key)) fail('Duplicate relationship within event'); keys.add(key);
    if (link.direction === 'bidirectional' && ['sanctions','military_aid','humanitarian_aid','trade_restrictions'].includes(link.type) && event.countries.some(country => ['initiator','target','recipient'].includes(country.role))) fail('Unilateral roles contradict bilateral direction');
    const quote = link.evidence_refs.map(index => evidence[index]?.text ?? '').join(' ');
    for (const code of pair) {
      const country = countries.find(item => item.cca2 === code);
      const aliases = [country?.name.common,country?.name.official,...(country?.altSpellings ?? []),...(country?.capital ?? [])].filter((item): item is string => !!item && item.length >= 2);
      if (!aliases.some(alias => new RegExp(`\\b${escapeRegex(alias)}\\b`,'iu').test(quote))) warnings.push(`Check whether cited evidence supports country ${code}; name/alias was not found`);
    }
  }
  const quotes = event.evidence.map(item => item.text).join(' ');
  if (event.event_status === 'completed' && /\b(plans? to|might|may provide|proposed|denied|allegedly|speculat\w*)\b/i.test(quotes)) fail('Completed status contradicts uncertain/planned/denied evidence');
  if (event.confidence < .8 || event.relationships.some(link => link.confidence < .8)) warnings.push('Low extraction confidence; model confidence is not verification');
  if (event.event_type === 'unknown' || event.event_status === 'unknown') warnings.push('Ambiguous classification or event status');
  warnings.push('Exact quotations do not establish semantic support. Independent source verification has not been performed.');
  return { evidence, warnings, rejected };
}
