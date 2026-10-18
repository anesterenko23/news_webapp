import {readFile,writeFile}from 'node:fs/promises';
import {matchingRules,normalizedAction}from './dist/canonical.js';
import {findDuplicates}from './dist/deduplication.js';
const pairs=JSON.parse(await readFile(new URL('benchmark/duplicate-cases.json',import.meta.url),'utf8')).cases;
const counters={baseline:{tp:0,fp:0,fn:0,tn:0},hardened:{tp:0,fp:0,fn:0,tn:0}},details=[];
const ratio=(n,d)=>d?n/d:null;
for(const pair of pairs){
 const date=e=>({...e,occurredAt:new Date(e.occurredAt),publishedAt:new Date(e.publishedAt)}),left=date(pair.left),right=date(pair.right);
 const oldClaim={title:right.title,summary:right.summary,event_type:right.eventType,event_status:right.eventStatus,occurred_at:right.occurredAt.toISOString(),countries:right.participants.map(p=>({code:p.countryCode,role:p.role})),relationships:[],evidence:[],confidence:1};
 const record={id:'left',...left,sources:[]};const baseline=findDuplicates(oldClaim,right.publishedAt,undefined,[record]).length>0;
 const candidate={...left,actionKey:normalizedAction(left.actionText),objectKey:normalizedAction(left.objectText??''),sources:[{active:true,article:{contentFingerprint:left.body,primaryDocument:null,lineageId:null}}]};
 const rules=matchingRules(right,{contentFingerprint:right.body,primaryDocument:null,lineageId:null},candidate);
 for(const [name,predicted]of [['baseline',baseline],['hardened',rules.candidate]]){const key=predicted?(pair.expectedSame?'tp':'fp'):(pair.expectedSame?'fn':'tn');counters[name][key]++;}
 details.push({id:pair.id,expectedSame:pair.expectedSame,baselineFlag:baseline,hardenedFlag:rules.candidate,automaticLinkEligible:rules.strict,reasons:rules.reasons});
}
const metrics=Object.fromEntries(Object.entries(counters).map(([name,c])=>[name,{...c,duplicateCandidatePrecision:ratio(c.tp,c.tp+c.fp),duplicateCandidateRecall:ratio(c.tp,c.tp+c.fn)}]));
const result={kind:'Deterministic matching benchmark, no new LLM calls',publicationsCompared:pairs.length,methodology:'Same hand-labelled event pairs; baseline candidate detector vs hardened candidate detector. Auto-link eligibility is reported separately, not treated as evidence of independent confirmation.',metrics,details};await writeFile(new URL('../work/benchmark45/duplicate-metrics.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
