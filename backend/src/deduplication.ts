import type { Extracted } from './schemas.js';
const stop = new Set(['a','an','the','and','of','to','for','new','another','against','with','in','on']);
export function normalizedHeadline(text: string) {
  return text.toLowerCase().normalize('NFKC').replace(/\bberlin\b/g,'germany').replace(/\bmoscow\b/g,'russia').replace(/\b(announces?|announced|introduces?|introduced|imposes?|imposed)\b/g,'announce').replace(/[^\p{L}\p{N}\s]/gu,' ').split(/\s+/).filter(word => word && !stop.has(word));
}
export function similarity(a: string, b: string) {
  const left = new Set(normalizedHeadline(a)), right = new Set(normalizedHeadline(b));
  const union = new Set([...left,...right]);
  return union.size ? [...left].filter(word => right.has(word)).length / union.size : 0;
}
export interface DuplicateRecord { id: string; title: string; summary: string; eventType: string; eventStatus: string; occurredAt: Date | null; publishedAt: Date; participants: {countryCode:string;role?:string}[]; sources: {article:{primarySourceId:string|null}}[] }
export function findDuplicates(event: Extracted, publishedAt: Date, primarySourceId: string | undefined, records: DuplicateRecord[]) {
  const codes = event.countries.filter(country=>!['mentioned','commentator'].includes(country.role)).map(country => country.code).sort().join(',');
  const date = event.occurred_at ? Date.parse(event.occurred_at) : publishedAt.getTime();
  return records.flatMap(record => {
    if (record.eventType !== event.event_type || record.eventStatus !== event.event_status || record.participants.filter(item=>!['mentioned','commentator'].includes(item.role??'')).map(item => item.countryCode).sort().join(',') !== codes) return [];
    const sharedPrimary = !!primarySourceId && record.sources.some(source => source.article.primarySourceId === primarySourceId);
    if (!sharedPrimary && Math.abs((record.occurredAt ?? record.publishedAt).getTime() - date) > 3 * 86400000) return [];
    const score = Math.max(similarity(event.title,record.title),similarity(`${event.title} ${event.summary}`,`${record.title} ${record.summary}`));
    return sharedPrimary || score >= .5 ? [{ eventId: record.id, score, reason: sharedPrimary ? 'Shared primary source identifier; manual comparison required' : 'Matching countries/type/status/time and similar claims; manual comparison required' }] : [];
  }).sort((a,b) => b.score-a.score).slice(0,10);
}
