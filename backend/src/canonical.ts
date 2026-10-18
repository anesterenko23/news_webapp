import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient, Article } from '@prisma/client';
import { ISO_CODES, ROLES } from './schemas.js';
import type { CheckResult } from './validation.js';
import { publicationPolicy } from './verification.js';
import { similarity, normalizedHeadline } from './deduplication.js';
export const claimInclude={participants:true,relationships:true,evidence:true,mergeCandidates:true,validationHistory:true,sources:{include:{article:true}}};
export const canonicalInclude={participants:true,relationships:true,sources:{include:{article:{select:{id:true,source:true,url:true,publishedAt:true,originalSource:true,syndicationSource:true,primaryDocument:true,lineageId:true,contentFingerprint:true}}}},claims:{include:claimInclude},revisions:{orderBy:{createdAt:'asc' as const}},verificationDecisions:{orderBy:{createdAt:'asc' as const}},mergeCandidates:true};
export const normalizedAction=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
const signature=(relationships:{sourceCountry:string;targetCountry:string;type:string;direction:string}[])=>relationships.map(r=>(r.direction==='bidirectional'?[r.sourceCountry,r.targetCountry].sort():[r.sourceCountry,r.targetCountry]).join(':')+':'+r.type+':'+r.direction).sort().join('|');
export function matchingRules(claim:{actionText:string;objectText:string|null;eventType:string;eventStatus:string;occurredAt:Date|null;publishedAt:Date;participants:{countryCode:string;role:string}[];relationships:{sourceCountry:string;targetCountry:string;type:string;direction:string}[]},article:{contentFingerprint:string;primaryDocument:string|null;lineageId:string|null},candidate:{actionKey:string;objectKey:string;eventType:string;eventStatus:string;occurredAt:Date|null;publishedAt:Date;participants:{countryCode:string;role:string}[];relationships:{sourceCountry:string;targetCountry:string;type:string;direction:string}[];sources:{active:boolean;article:{contentFingerprint:string;primaryDocument:string|null;lineageId:string|null}}[]}){
 const actors=(items:{countryCode:string;role:string}[])=>items.filter(p=>!['observer','commentator','mentioned'].includes(p.role)).map(p=>p.countryCode+':'+p.role).sort().join(',');
 const date=(occurredAt:Date|null,publishedAt:Date)=>occurredAt?.toISOString()??publishedAt.toISOString().slice(0,10);
 const sameActors=actors(claim.participants)===actors(candidate.participants);
 const sameEdges=signature(claim.relationships)===signature(candidate.relationships);
 const sameType=claim.eventType===candidate.eventType&&claim.eventStatus===candidate.eventStatus;
 const sameTime=date(claim.occurredAt,claim.publishedAt)===date(candidate.occurredAt,candidate.publishedAt);
 const sameAction=normalizedAction(claim.actionText)===candidate.actionKey;
 const sameObject=normalizedAction(claim.objectText??'')===candidate.objectKey;
 const incompatibleObject=!!claim.objectText&&!!candidate.objectKey&&!sameObject;
 const compatibleTime=sameTime||(!claim.occurredAt||!candidate.occurredAt)&&Math.abs((claim.occurredAt??claim.publishedAt).getTime()-(candidate.occurredAt??candidate.publishedAt).getTime())<=3*86400000;
 const countrySet=(items:{countryCode:string;role:string}[])=>items.filter(p=>!['observer','commentator','mentioned'].includes(p.role)).map(p=>p.countryCode).sort().join(',');
 const exactReprint=!!article.contentFingerprint&&candidate.sources.some(s=>s.active&&s.article.contentFingerprint===article.contentFingerprint);
 const focus=normalizedAction(claim.actionText);
 const overlappingAction=Math.min(focus.length,candidate.actionKey.length)>=30&&(focus.startsWith(candidate.actionKey)||candidate.actionKey.startsWith(focus));
 const score=similarity(claim.actionText,candidate.actionKey);
 const reasons=[claim.eventStatus!==candidate.eventStatus?'MODALITY_CONFLICT':null,!sameActors?'ACTOR_OR_ROLE_CONFLICT':null,!sameEdges?'DIRECTION_OR_RELATIONSHIP_CONFLICT':null,!sameTime?'TIME_CONFLICT':null,!sameObject?'OBJECT_CONFLICT':null,!sameAction?'ACTION_NOT_IDENTICAL':null,!exactReprint?'SOURCE_LINEAGE_UNCONFIRMED':null].filter((s):s is string=>!!s);
 const comparableAction=score>=.5||overlappingAction;
 const candidateType=claim.eventType===candidate.eventType&&(claim.eventStatus===candidate.eventStatus||exactReprint&&comparableAction);
 return {strict:sameType&&sameActors&&sameEdges&&sameTime&&sameAction&&sameObject&&exactReprint,candidate:candidateType&&countrySet(claim.participants)===countrySet(candidate.participants)&&sameEdges&&compatibleTime&&(!incompatibleObject||exactReprint&&overlappingAction)&&comparableAction,score,reasons};
}
type Tx=Prisma.TransactionClient;
async function revision(tx:Tx,eventId:string,actor:string,reason:string,before:unknown,after:unknown){return tx.eventRevision.create({data:{canonicalEventId:eventId,actor,reason,beforeJson:JSON.stringify(before),afterJson:JSON.stringify(after)}});}
async function attach(tx:Tx,claimId:string,eventId:string,article:Article,reason:string,actor='system:canonical-v1'){
 const previous=await tx.canonicalEventSource.findMany({where:{canonicalEventId:eventId,active:true},include:{article:true}});
 const dependent=previous.some(s=>(s.articleId===article.id||s.article.contentFingerprint===article.contentFingerprint||!!article.lineageId&&s.article.lineageId===article.lineageId||!!article.syndicationSource&&s.article.syndicationSource===article.syndicationSource));
 const source=await tx.canonicalEventSource.upsert({where:{canonicalEventId_claimId:{canonicalEventId:eventId,claimId}},update:{active:true,linkReason:reason},create:{canonicalEventId:eventId,claimId,articleId:article.id,publisher:article.source,originalSource:article.originalSource,syndicationSource:article.syndicationSource,primaryDocument:article.primaryDocument??article.primarySourceId,lineageId:article.lineageId,independenceStatus:dependent?'Dependent':'Unknown',linkReason:reason}});
 await tx.extractedClaim.update({where:{id:claimId},data:{canonicalEventId:eventId}});
 await revision(tx,eventId,actor,reason,{activeSourceIds:previous.map(s=>s.id)},{linkedSourceId:source.id,claimId,independenceStatus:source.independenceStatus,verificationChanged:false});
 return source;
}
async function createCanonical(tx:Tx,claim:Prisma.ExtractedClaimGetPayload<{include:typeof claimInclude}>,article:Article,id?:string){
 const event=await tx.canonicalEvent.create({data:{...(id?{id}:{}),title:claim.title,normalizedTitle:normalizedHeadline(claim.title).join(' '),summary:claim.summary,eventType:claim.eventType,eventStatus:claim.eventStatus,actionKey:normalizedAction(claim.actionText),objectKey:normalizedAction(claim.objectText??''),occurredAt:claim.occurredAt,publishedAt:claim.publishedAt,verificationStatus:'Unverified',publicationStatus:'NeedsReview',participants:{create:claim.participants.map(p=>({countryCode:p.countryCode,role:p.role}))},relationships:{create:claim.relationships.map(r=>({originClaimId:claim.id,sourceCountry:r.sourceCountry,targetCountry:r.targetCountry,type:r.type,direction:r.direction,evidenceIds:r.evidenceIds}))},verificationDecisions:{create:{assessor:'system:no-independent-verifier',method:'none',outcome:'Unverified',sourceIndependence:'Unknown',evidence:'[]',reason:'Valid extraction only. No independent source verification performed.'}}}});
 await attach(tx,claim.id,event.id,article,'CREATE_CANONICAL_EVENT');return event;
}
export async function storeClaim(tx:Tx,raw:unknown,normalized:unknown,checks:CheckResult,article:Article,runId:string,legacy?:{id:string;verificationStatus:string;warnings:string}){
 const source=raw as any; const value=checks.value;
 const id=legacy?`claim-${legacy.id}`:randomUUID();
 const policy=publicationPolicy(checks.status);
 const partialCountries=Array.isArray(source?.countries)?source.countries.filter((c:any)=>ISO_CODES.has(c.code)&&(ROLES as readonly string[]).includes(c.role)):[];
 const countries=value?.countries??partialCountries;
 const reasonList=[...checks.errors,...checks.warnings];
 const claim=await tx.extractedClaim.create({data:{id,legacyEventId:legacy?.id,runId,articleId:article.id,title:value?.title??String(source?.title??'Invalid extracted claim').slice(0,300),summary:value?.summary??String(source?.summary??'Invalid extracted claim'),eventType:value?.event_type??'unknown',eventStatus:value?.event_status??'unknown',actionText:value?.action_text??'',objectText:value?.object_text??null,occurredAt:value?.occurred_at?new Date(value.occurred_at):null,publishedAt:article.publishedAt,confidence:typeof source?.confidence==='number'&&Number.isFinite(source.confidence)?Math.min(1,Math.max(0,source.confidence)):0,rawClaim:JSON.stringify(raw),entities:JSON.stringify(value?.entities??[]),...policy,validationResults:JSON.stringify({...checks,value:undefined}),reviewReasons:JSON.stringify(reasonList),participants:{create:[...new Map(countries.map((c:any)=>[c.code,c])).values()].map((c:any)=>({countryCode:c.code,role:c.role,attributionEvidenceIds:'[]'}))}}});
 await tx.claimValidationDecision.create({data:{claimId:id,validatorVersion:checks.validatorVersion,previousStatus:'NotAssessed',nextStatus:checks.status,beforeJson:'null',afterJson:JSON.stringify(checks),reasons:JSON.stringify(reasonList)}});
 const evidenceMap=new Map<string,string>();
 for(const evidence of checks.evidence){if(evidenceMap.has(evidence.temporaryId))continue;const saved=await tx.claimEvidence.create({data:{id:randomUUID(),claimId:id,...evidence}});evidenceMap.set(evidence.temporaryId,saved.id);}
 if(value){
  for(const country of value.countries)await tx.claimParticipant.update({where:{claimId_countryCode:{claimId:id,countryCode:country.code}},data:{attributionEvidenceIds:JSON.stringify(country.attribution_evidence_ids.map(temp=>evidenceMap.get(temp)).filter(Boolean))}});
  for(const r of value.relationships){
   const resolved=r.evidence_ids.map(temp=>evidenceMap.get(temp));
   await tx.claimRelationship.create({data:{claimId:id,sourceCountry:r.source_country,targetCountry:r.target_country,type:r.type,direction:r.direction,confidence:r.confidence,evidenceIds:JSON.stringify(resolved.filter(Boolean)),referenceIntegrity:resolved.every(Boolean)?'Valid':'Invalid',evidence:{create:[...new Set(resolved.filter((x):x is string=>!!x))].map(evidenceId=>({evidenceId}))}}});
  }
 }
 if(checks.status!=='Valid')return claim;
 const full=await tx.extractedClaim.findUniqueOrThrow({where:{id},include:claimInclude});
 const candidates=await tx.canonicalEvent.findMany({where:{archived:false,eventType:full.eventType},include:{participants:true,relationships:true,sources:{include:{article:true}}},take:1000,orderBy:{createdAt:'desc'}});
 const matches=candidates.map(candidate=>({candidate,rules:matchingRules(full,article,candidate)}));
 const exact=matches.filter(m=>m.rules.strict);
 if(exact.length===1){await attach(tx,id,exact[0].candidate.id,article,'STRICT_REPRINT_MATCH: same content, action, object, actors, directions, type, time and modality');}
 else {
  const possible=matches.filter(m=>m.rules.candidate);
  if(possible.length){for(const item of possible)await tx.mergeCandidate.create({data:{claimId:id,canonicalEventId:item.candidate.id,score:item.rules.score,reasons:JSON.stringify(['MERGE_CANDIDATE',...item.rules.reasons])}});await tx.extractedClaim.update({where:{id},data:{reviewReasons:JSON.stringify([...reasonList,{code:'MERGE_CANDIDATE',message:'Ambiguous match requires explicit review; no duplicate canonical event created'}])}});}
  else await createCanonical(tx,full,article,legacy?.id);
 }
 return tx.extractedClaim.findUniqueOrThrow({where:{id}});
}
export async function resolveMerge(db:PrismaClient,candidateId:string,input:{decision:'merge'|'separate';reviewer:string;note:string}){
 return db.$transaction(async tx=>{
  const candidate=await tx.mergeCandidate.findUniqueOrThrow({where:{id:candidateId},include:{claim:{include:{...claimInclude,article:true}}}});
  if(candidate.status!=='Pending')throw new Error('Merge candidate already decided');
  if(candidate.claim.validationStatus!=='Valid'||candidate.claim.canonicalEventId)throw new Error('Only an unlinked valid claim can be resolved');
  const event=input.decision==='merge'?await tx.canonicalEvent.findUniqueOrThrow({where:{id:candidate.canonicalEventId}}):await createCanonical(tx,candidate.claim,candidate.claim.article);
  if(input.decision==='merge')await attach(tx,candidate.claimId,event.id,candidate.claim.article,`HUMAN_MERGE: ${input.note}`,input.reviewer);
  await tx.mergeCandidate.updateMany({where:{claimId:candidate.claimId,status:'Pending'},data:{status:'Dismissed',reviewer:input.reviewer,decisionNote:input.note,decidedAt:new Date()}});
  await tx.mergeCandidate.update({where:{id:candidateId},data:{status:input.decision==='merge'?'Merged':'Separate',reviewer:input.reviewer,decisionNote:input.note,decidedAt:new Date()}});return {canonicalEventId:event.id};
 });
}
export async function undoSourceLink(db:PrismaClient,sourceId:string,input:{reviewer:string;note:string}){
 return db.$transaction(async tx=>{
  const source=await tx.canonicalEventSource.findUniqueOrThrow({where:{id:sourceId},include:{claim:{include:claimInclude},article:true}});
  if(!source.active)throw new Error('Source link is already inactive');
  await tx.canonicalEventSource.update({where:{id:sourceId},data:{active:false}});
  await tx.extractedClaim.update({where:{id:source.claimId},data:{canonicalEventId:null}});
  const replacement=await createCanonical(tx,source.claim,source.article);
  const remaining=await tx.canonicalEventSource.count({where:{canonicalEventId:source.canonicalEventId,active:true}});
  if(!remaining)await tx.canonicalEvent.update({where:{id:source.canonicalEventId},data:{archived:true,publicationStatus:'Blocked'}});
  else {
   const original=await tx.canonicalEvent.findUniqueOrThrow({where:{id:source.canonicalEventId},include:{relationships:true,participants:true}});
   if(original.relationships.some(r=>r.originClaimId===source.claimId)){
    const representative=await tx.canonicalEventSource.findFirstOrThrow({where:{canonicalEventId:source.canonicalEventId,active:true},include:{claim:{include:claimInclude}}});
    const claim=representative.claim;
    await tx.eventRelationship.deleteMany({where:{canonicalEventId:original.id}});
    await tx.canonicalParticipant.deleteMany({where:{canonicalEventId:original.id}});
    await tx.canonicalEvent.update({where:{id:original.id},data:{title:claim.title,normalizedTitle:normalizedHeadline(claim.title).join(' '),summary:claim.summary,eventType:claim.eventType,eventStatus:claim.eventStatus,actionKey:normalizedAction(claim.actionText),objectKey:normalizedAction(claim.objectText??''),occurredAt:claim.occurredAt,publishedAt:claim.publishedAt,verificationStatus:'Unverified',publicationStatus:'NeedsReview',participants:{create:claim.participants.map(p=>({countryCode:p.countryCode,role:p.role}))},relationships:{create:claim.relationships.map(r=>({originClaimId:claim.id,sourceCountry:r.sourceCountry,targetCountry:r.targetCountry,type:r.type,direction:r.direction,evidenceIds:r.evidenceIds}))},verificationDecisions:{create:{assessor:input.reviewer,method:'source-unlink',outcome:'Unverified',sourceIndependence:'Unknown',evidence:'[]',reason:'Representative claim detached; independent verification must be reassessed'}}}});
    await revision(tx,original.id,input.reviewer,'REBUILD_AFTER_ORIGIN_DETACH',original,{representativeClaimId:claim.id,verificationStatus:'Unverified'});
   }
  }
  await revision(tx,source.canonicalEventId,input.reviewer,`UNDO_SOURCE_LINK: ${input.note}`,{sourceId,active:true},{sourceId,active:false,replacementEventId:replacement.id});
  return {canonicalEventId:replacement.id,previousCanonicalEventId:source.canonicalEventId};
 });
}
