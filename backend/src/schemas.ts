import { z } from 'zod';
import { countryMetadata } from './countries.js';
import { resolveCountry } from './entities.js';
import { ArticleInput as LegacyArticle, TAXONOMY, EVENT_STATUSES } from './schemas-v1.js';
export { TAXONOMY, EVENT_STATUSES };
export const ISO_CODES = new Set(countryMetadata.filter(c=>c.cca2!=='XK').map(c=>c.cca2));
export const ISO_ENUM = [...ISO_CODES].sort() as [string,...string[]];
export const ROLES=['initiator','target','recipient','sender','partner','participant','mediator','observer','commentator','mentioned','unknown'] as const;
export const ENTITY_TYPES=['country','international_organization','government_body','company','individual','unspecified_group','geographic_location','unknown'] as const;
export const REASON_CODES=['INVALID_COUNTRY','INVALID_ENTITY','INVALID_SCHEMA','DUPLICATE_EVIDENCE_ID','MISSING_EVIDENCE','INVALID_EVIDENCE_REFERENCE','QUOTE_MISMATCH','OFFSET_MISMATCH','INVALID_DIRECTION','AMBIGUOUS_ACTOR','UNRESOLVED_REFERENCE','MODALITY_CONFLICT','MISSED_ACTION','UNSUPPORTED_RELATIONSHIP','MERGE_CANDIDATE','INDEPENDENT_VERIFICATION_REQUIRED','LEGACY_UNCERTAINTY','MODEL_NOTE'] as const;
export const Diagnostic=z.strictObject({code:z.enum(REASON_CODES),message:z.string().min(1).max(1000)});
export const ArticleInput=LegacyArticle.extend({originalSource:z.string().trim().min(1).max(300).optional(),syndicationSource:z.string().trim().min(1).max(300).optional(),primaryDocument:z.string().trim().min(1).max(2000).optional(),lineageId:z.string().trim().min(1).max(300).optional()});
export type ArticleInputType=z.infer<typeof ArticleInput>;
const temp=z.string().min(1).max(80);
export const ExtractedEvent=z.strictObject({
 title:z.string().min(3).max(300),summary:z.string().min(10).max(2000),action_text:z.string().min(8).max(2000),object_text:z.string().min(1).max(500).nullable(),event_type:z.enum(TAXONOMY),event_status:z.enum(EVENT_STATUSES),occurred_at:z.union([z.iso.datetime({offset:true}),z.null()]),
 countries:z.array(z.strictObject({code:z.enum(ISO_ENUM),role:z.enum(ROLES),attribution_evidence_ids:z.array(temp).max(10)})).max(30),
 entities:z.array(z.strictObject({type:z.enum(ENTITY_TYPES),name:z.string().min(1).max(200),identifier:z.string().max(100).nullable(),country_code:z.enum(ISO_ENUM).nullable(),role:z.enum(ROLES),evidence_ids:z.array(temp).max(10)})).max(30),
 relationships:z.array(z.strictObject({source_country:z.enum(ISO_ENUM),target_country:z.enum(ISO_ENUM),type:z.enum(TAXONOMY),direction:z.enum(['directed','bidirectional']),evidence_ids:z.array(temp).min(1).max(10),confidence:z.number().min(0).max(1)})).max(30),
 evidence:z.array(z.strictObject({id:temp,text:z.string().min(8).max(4000),kind:z.enum(['action','attribution','context'])})).min(1).max(15),confidence:z.number().min(0).max(1),
});
export type Extracted=z.infer<typeof ExtractedEvent>;
export const Extraction=z.strictObject({events:z.array(ExtractedEvent).max(12),diagnostics:z.array(Diagnostic).max(30)});
export const outputJsonSchema=z.toJSONSchema(Extraction,{target:'draft-7'});
export const VerificationStatus=z.enum(['NotAssessed','Unverified','Corroborated','Verified','Disputed','Refuted']);
export const EventQuery=z.object({country:z.string().transform(value=>resolveCountry(value)??value.toUpperCase()).refine(code=>ISO_CODES.has(code),'Use ISO alpha-2 or a recognized country alias').optional(),eventType:z.enum(TAXONOMY).optional(),verificationStatus:VerificationStatus.optional(),from:z.iso.datetime({offset:true}).optional(),to:z.iso.datetime({offset:true}).optional(),limit:z.coerce.number().int().min(1).max(100).default(50),offset:z.coerce.number().int().min(0).max(100000).default(0)}).refine(q=>!q.from||!q.to||Date.parse(q.from)<=Date.parse(q.to),'Invalid date range');
