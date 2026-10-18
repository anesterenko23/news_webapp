import type {PrismaClient}from '@prisma/client';
import {VALIDATOR_VERSION,validateClaim,legacyToCurrent}from './validation.js';
import {BASELINE_VERSION}from './prompt.js';
import {publicationPolicy}from './verification.js';
import {SEMANTIC_VERSION}from './semantic-contract.js';
export async function revalidateStoredClaims(db:PrismaClient){
 const claims=await db.extractedClaim.findMany({where:{run:{promptVersion:{not:SEMANTIC_VERSION}},validationHistory:{none:{validatorVersion:VALIDATOR_VERSION}}},include:{article:true,run:true}});let updated=0;
 for(const claim of claims){
  const raw=JSON.parse(claim.rawClaim),converted=claim.run.promptVersion===BASELINE_VERSION?legacyToCurrent(raw,0):raw;
  let original={title:claim.article.title,content:claim.article.content};try{original=JSON.parse(claim.article.originalJson);}catch{}
  const globalIds=new Map<string,number>();
  if(claim.run.promptVersion!==BASELINE_VERSION)try{for(const event of JSON.parse(claim.run.rawOutput??'{}').events??[])for(const q of event.evidence??[])if(typeof q.id==='string')globalIds.set(q.id,(globalIds.get(q.id)??0)+1);}catch{}
  const checks=validateClaim(converted,original.title+'\n'+original.content,claim.run.promptVersion===BASELINE_VERSION?undefined:globalIds);
  if(claim.legacyEventId&&claim.validationStatus!=='Valid'&&checks.status==='Valid'){checks.status=claim.validationStatus==='NeedsRepair'?'NeedsRepair':'Invalid';checks.warnings.push({code:'LEGACY_UNCERTAINTY',message:'Legacy technical review remains unresolved; revalidation has not established factual truth'});}
  await db.$transaction(async tx=>{
   if(await tx.claimValidationDecision.findUnique({where:{claimId_validatorVersion:{claimId:claim.id,validatorVersion:VALIDATOR_VERSION}}}))return;
   const reasons=[...checks.errors,...checks.warnings,...JSON.parse(claim.reviewReasons).filter((r:any)=>r.code==='MERGE_CANDIDATE'||r.code==='LEGACY_UNCERTAINTY')];
   const policy=publicationPolicy(checks.status);
   await tx.claimValidationDecision.create({data:{claimId:claim.id,validatorVersion:VALIDATOR_VERSION,previousStatus:claim.validationStatus,nextStatus:checks.status,beforeJson:claim.validationResults,afterJson:JSON.stringify(checks),reasons:JSON.stringify(reasons)}});
   await tx.extractedClaim.update({where:{id:claim.id},data:{...policy,validationResults:JSON.stringify({...checks,value:undefined}),reviewReasons:JSON.stringify(reasons)}});
   if(checks.status!=='Valid'){
    await tx.mergeCandidate.updateMany({where:{claimId:claim.id,status:'Pending'},data:{status:'BlockedByValidation',decisionNote:'Technical revalidation requires review; no factual refutation inferred',decidedAt:new Date()}});
    const links=await tx.canonicalEventSource.findMany({where:{claimId:claim.id,active:true}});
    for(const source of links){
     await tx.canonicalEventSource.update({where:{id:source.id},data:{active:false}});
     const remaining=await tx.canonicalEventSource.count({where:{canonicalEventId:source.canonicalEventId,active:true}});
     await tx.canonicalEvent.update({where:{id:source.canonicalEventId},data:{publicationStatus:'Blocked',...(!remaining?{archived:true}:{})}});
     await tx.eventRevision.create({data:{canonicalEventId:source.canonicalEventId,actor:'system:'+VALIDATOR_VERSION,reason:'SOURCE_BLOCKED_BY_TECHNICAL_REVALIDATION',beforeJson:JSON.stringify({claimId:claim.id,validationStatus:claim.validationStatus,sourceActive:true}),afterJson:JSON.stringify({claimId:claim.id,validationStatus:checks.status,sourceActive:false,independentVerificationNotPerformed:true})}});
    }
    await tx.extractedClaim.update({where:{id:claim.id},data:{canonicalEventId:null}});
   }
  });updated++;
 }
 return {validatorVersion:VALIDATOR_VERSION,updated};
}
