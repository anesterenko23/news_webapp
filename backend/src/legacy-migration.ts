import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { legacyToCurrent, validateClaim } from './validation.js';
import { storeClaim } from './canonical.js';
export async function backfillLegacy(db:PrismaClient){
 const articles=await db.article.findMany({where:{contentFingerprint:''}});
 for(const article of articles)await db.article.update({where:{id:article.id},data:{contentFingerprint:createHash('sha256').update(article.content.normalize('NFKC').replace(/\s+/g,' ').trim()).digest('hex')}});
 const legacy=await db.event.findMany({include:{run:{include:{article:true}},participants:true,evidence:true,relationships:true},orderBy:{createdAt:'asc'}});
 let copied=0;
 for(const event of legacy){
  if(await db.extractedClaim.findUnique({where:{legacyEventId:event.id}}))continue;
  let raw:any=null;try{raw=JSON.parse(event.run.rawOutput??'{}').events?.filter((e:any)=>e.title===event.title&&e.summary===event.summary&&e.event_type===event.eventType);if(Array.isArray(raw))raw=raw.length===1?raw[0]:null;}catch{}
  raw??={title:event.title,summary:event.summary,event_type:event.eventType,event_status:event.eventStatus,occurred_at:event.occurredAt?.toISOString()??null,confidence:event.confidence,countries:event.participants.map(p=>({code:p.countryCode,role:p.role})),evidence:[...event.evidence].sort((a,b)=>a.ordinal-b.ordinal).map(e=>({text:e.text})),relationships:event.relationships.map(r=>({source_country:r.sourceCountry,target_country:r.targetCountry,type:r.type,direction:r.direction,evidence_refs:JSON.parse(r.evidenceRefs),confidence:r.confidence}))};
  const normalized=legacyToCurrent(raw,0),article=event.run.article;
  let original={title:article.title,content:article.content};try{original=JSON.parse(article.originalJson);}catch{}
  const checks=validateClaim(normalized,original.title+'\n'+original.content);
  if(event.verificationStatus==='Rejected'&&!/Invalid ISO|missing evidence|not an exact|Self relationship|contradict|commentator|evidence reference/i.test(event.warnings)&&checks.status==='Valid'){checks.status='NeedsRepair';checks.warnings.push({code:'LEGACY_UNCERTAINTY',message:'Legacy rejection reason cannot establish factual refutation; review required'});}
  checks.warnings.push({code:'LEGACY_UNCERTAINTY',message:`Legacy snapshot retained in original tables and raw processing run ${event.runId}; no Refuted/Verified inference`});
  await db.$transaction(tx=>storeClaim(tx,raw,normalized,checks,article,event.runId,event),{timeout:20000});copied++;
 }
 return {copied,legacyRecords:legacy.length};
}
