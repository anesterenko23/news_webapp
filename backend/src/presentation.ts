import type { Prisma } from '@prisma/client';
import { canonicalInclude, claimInclude } from './canonical.js';
import { globeProjection } from './globe-projection.js';
const parse=(value:string)=>JSON.parse(value);
export function claimDto(claim:Prisma.ExtractedClaimGetPayload<{include:typeof claimInclude}>){
 const analysis=parse(claim.validationResults).semantic??null;
 return {...claim,confidence:analysis?null:claim.confidence,analysis,reason:analysis?.reason??null,globePreview:globeProjection({...claim,analysis}),entities:parse(claim.entities),validation:parse(claim.validationResults),reviewReasons:parse(claim.reviewReasons),warnings:JSON.stringify(parse(claim.reviewReasons).map((r:any)=>r.message)),duplicateCandidates:JSON.stringify(claim.mergeCandidates.map(m=>({eventId:m.canonicalEventId,score:m.score,status:m.status}))),participants:claim.participants.map(p=>({...p,attributionEvidenceIds:parse(p.attributionEvidenceIds)})),relationships:claim.relationships.map(r=>({...r,confidence:analysis?null:r.confidence,evidenceIds:parse(r.evidenceIds),evidenceRefs:r.evidenceIds})),isIndependentlyVerified:false,independenceNotice:'AI extracted this claim. This claim has not been independently verified.'};
}
export function canonicalDto(event:Prisma.CanonicalEventGetPayload<{include:typeof canonicalInclude}>){
 const active=event.sources.filter(s=>s.active);
 const validationStatus=active.length&&!event.archived&&event.publicationStatus!=='Blocked'&&event.relationships.every(r=>event.claims.some(c=>c.id===r.originClaimId&&c.validationStatus==='Valid'))?'Valid':'NeedsRepair';
 const representative=event.claims.find(c=>active.some(s=>s.claimId===c.id));
 const analysis=representative?parse(representative.validationResults).semantic??null:null;
 return {...event,analysis,reason:analysis?.reason??null,validationStatus,modelConfidence:null,confidence:null,evidence:event.claims.flatMap(c=>c.evidence),warnings:JSON.stringify(['Canonical identity does not establish truth or source independence']),sources:active,linkedSourceCount:new Set(active.map(s=>s.articleId)).size,sourceHistory:event.sources,claims:event.claims.map(claimDto),relationships:event.relationships.map(r=>({...r,evidenceIds:parse(r.evidenceIds),evidenceRefs:r.evidenceIds})),isIndependentlyVerified:validationStatus==='Valid'&&event.verificationStatus==='Verified'&&event.verificationDecisions.some(d=>d.outcome==='Verified'&&d.sourceIndependence==='Independent'&&d.method!=='none'&&parse(d.evidence).length>0),verificationHistory:event.verificationDecisions};
}
