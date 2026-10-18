import { z } from 'zod';
import { countryMetadata as countries } from './countries.js';
export const TAXONOMY = ['conflict','military_aid','military_cooperation','trade','trade_restrictions','sanctions','diplomacy','energy','humanitarian_aid','international_agreement','other','unknown'] as const;
export const EVENT_STATUSES = ['completed','announced','planned','proposed','alleged','denied','speculative','unknown'] as const;
export const ROLES = ['initiator','target','recipient','partner','participant','mediator','commentator','mentioned','unknown'] as const;
export const ISO_CODES = new Set(countries.filter(country => country.cca2 !== 'XK').map(country => country.cca2));
export const ArticleInput = z.strictObject({
  title: z.string().trim().min(3).max(500), content: z.string().min(20).max(30000),
  source: z.string().trim().min(2).max(200), url: z.url().max(2000).refine(value => { const url = new URL(value); return ['http:','https:'].includes(url.protocol) && !url.username && !url.password; }, 'Use an HTTP(S) URL without credentials'),
  publishedAt: z.iso.datetime({ offset: true }), language: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/).optional(),
  primarySourceId: z.string().trim().min(1).max(200).optional(),
});
export type ArticleInputType = z.infer<typeof ArticleInput>;
const iso = z.string().regex(/^[A-Z]{2}$/);
export const ExtractedEvent = z.strictObject({
  title: z.string().min(3).max(300), summary: z.string().min(10).max(2000),
  event_type: z.enum(TAXONOMY), event_status: z.enum(EVENT_STATUSES),
  occurred_at: z.union([z.iso.datetime({ offset: true }), z.null()]),
  countries: z.array(z.strictObject({ code: iso, role: z.enum(ROLES) })).max(30),
  relationships: z.array(z.strictObject({ source_country: iso, target_country: iso, type: z.enum(TAXONOMY), direction: z.enum(['directed','bidirectional']), evidence_refs: z.array(z.number().int().min(0)).min(1).max(10), confidence: z.number().min(0).max(1) })).max(30),
  evidence: z.array(z.strictObject({ text: z.string().min(8).max(4000) })).min(1).max(10),
  confidence: z.number().min(0).max(1),
});
export type Extracted = z.infer<typeof ExtractedEvent>;
export const Extraction = z.strictObject({ events: z.array(ExtractedEvent).max(12), diagnostics: z.array(z.string().max(500)).max(20) });
export const outputJsonSchema = z.toJSONSchema(Extraction, { target: 'draft-7' });
export const EventQuery = z.object({ country: z.string().toUpperCase().refine(code => ISO_CODES.has(code), 'Use ISO alpha-2').optional(), eventType: z.enum(TAXONOMY).optional(), verificationStatus: z.enum(['Unverified','Corroborated','Verified','Disputed','Rejected']).optional(), from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).max(100000).default(0) }).refine(query => !query.from || !query.to || Date.parse(query.from) <= Date.parse(query.to), 'Invalid date range');
