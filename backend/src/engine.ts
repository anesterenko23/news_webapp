import type { PrismaClient } from '@prisma/client';
import { activeModel, type Config } from './config.js';
import { z } from 'zod';
import { normalizeArticle, originalText } from './normalization.js';
import { Diagnostic, type ArticleInputType } from './schemas.js';
import { PROMPT_VERSION, BASELINE_VERSION, PREVIOUS_VERSION } from './prompt.js';
import { EngineError, type Provider } from './provider.js';
import { validateClaim, legacyToCurrent, coverageDiagnostics } from './validation.js';
import { canonicalInclude, claimInclude, storeClaim } from './canonical.js';
import { claimDto, canonicalDto } from './presentation.js';
import { SEMANTIC_VERSION } from './semantic-contract.js';
import { mapSemanticEvent } from './semantic-mapper.js';
export class IntelligenceEngine {
 private tail:Promise<unknown>=Promise.resolve();
 constructor(private db:PrismaClient,private config:Config,private provider:Provider){}
 process(raw:unknown,retryOf?:string,promptVersion=SEMANTIC_VERSION){
  const normalized=normalizeArticle(raw);
  if(![SEMANTIC_VERSION,PROMPT_VERSION,BASELINE_VERSION,PREVIOUS_VERSION].includes(promptVersion))throw new EngineError('INVALID_PROMPT_VERSION','Only the current and retained baseline prompt versions are supported',400);
  const result=this.tail.then(()=>this.processOne(raw,normalized,retryOf,promptVersion));this.tail=result.catch(()=>{});return result;
 }
 private async result(id:string,cached=false){
  const run=await this.db.processingRun.findUniqueOrThrow({where:{id},include:{claims:{include:claimInclude},requests:true}});
  const ids=[...new Set(run.claims.map(c=>c.canonicalEventId).filter((id):id is string=>!!id))];
  const events=await this.db.canonicalEvent.findMany({where:{id:{in:ids}},include:canonicalInclude});
  return {articleId:run.articleId,runId:run.id,processingStatus:run.status,cached,claims:run.claims.map(claimDto),events:events.map(canonicalDto),canonicalEventIds:ids,warnings:JSON.parse(run.warnings),reviewReasons:JSON.parse(run.reviewReasons),error:run.error,rawOutput:run.rawOutput,model:run.model,promptVersion:run.promptVersion,durationMs:run.durationMs,usage:{requests:run.requests.length,inputTokens:run.requests.reduce((n,r)=>n+r.inputTokens,0),outputTokens:run.requests.reduce((n,r)=>n+r.outputTokens,0),estimatedCostUsd:run.requests.reduce((n,r)=>n+r.estimatedCostUsd,0),uncertain:run.requests.some(r=>['uncertain','reserved','pricing_exceeded'].includes(r.status))}};
 }
 private async processOne(raw:unknown,n:ReturnType<typeof normalizeArticle>,retryOf:string|undefined,promptVersion:string){
  const article=await this.db.article.upsert({where:{fingerprint:n.fingerprint},update:{},create:{fingerprint:n.fingerprint,contentFingerprint:n.contentFingerprint,title:n.title,content:(raw as ArticleInputType).content,source:n.source,url:n.url,canonicalUrl:n.canonicalUrl,publishedAt:n.publishedAt,language:n.language,primarySourceId:n.primarySourceId,normalizedText:n.normalizedText,originalJson:JSON.stringify(raw),originalSource:n.originalSource,syndicationSource:n.syndicationSource,primaryDocument:n.primaryDocument,lineageId:n.lineageId}});
  let attempt=0;
  if(retryOf){const failed=await this.db.processingRun.findUnique({where:{id:retryOf}});if(!failed||failed.articleId!==article.id||failed.status!=='failed'||failed.model!==activeModel(this.config)||failed.promptVersion!==promptVersion)throw new EngineError('INVALID_RETRY','Only a matching failed run can be explicitly retried',400);attempt=failed.attempt+1;}
  const identity={articleId:article.id,model:activeModel(this.config),promptVersion,attempt};
  const previous=await this.db.processingRun.findFirst({where:retryOf?identity:{articleId:article.id,model:activeModel(this.config),promptVersion},orderBy:{attempt:'desc'}});if(previous)return this.result(previous.id,true);
  let run;try{run=await this.db.processingRun.create({data:{...identity,retryOf}});}catch{const raced=await this.db.processingRun.findFirst({where:identity});if(raced)return this.result(raced.id,true);throw new EngineError('DATABASE_BUSY','Cannot claim processing run',503);}
  const started=Date.now();let rawOutput:string|undefined;
  try{
   rawOutput=await this.provider.extract({title:n.title,content:n.content,language:n.language,publishedAt:n.publishedAt.toISOString()},run.id);
   let decoded:unknown;try{decoded=JSON.parse(rawOutput);}catch{throw new EngineError('INVALID_MODEL_JSON','Output is not JSON');}
   const semantic=promptVersion===SEMANTIC_VERSION;
   const envelope=(semantic?z.strictObject({events:z.array(z.unknown()).max(12)}):z.strictObject({events:z.array(z.unknown()).max(12),diagnostics:z.array(z.unknown()).max(30)})).safeParse(decoded);
   if(!envelope.success)throw new EngineError('INVALID_MODEL_SCHEMA','Output envelope must contain events and diagnostics arrays');
   const reasons: {code:string;message:string}[]=('diagnostics' in envelope.data?envelope.data.diagnostics as unknown[]:[]).map(item=>{if(typeof item==='string')return {code:'MODEL_NOTE',message:item};const d=Diagnostic.safeParse(item);return d.success?d.data:{code:'INVALID_SCHEMA',message:'Malformed model diagnostic retained in raw output'};});
   const values=envelope.data.events.map((event,i)=>promptVersion===BASELINE_VERSION?legacyToCurrent(event as Record<string,unknown>,i):event);
   const globalIds=new Map<string,number>();if(!semantic)for(const value of values)for(const evidence of (Array.isArray((value as any)?.evidence)?(value as any).evidence:[]))if(typeof evidence.id==='string')globalIds.set(evidence.id,(globalIds.get(evidence.id)??0)+1);
   const checks=values.map(value=>semantic?mapSemanticEvent(value,originalText(raw as ArticleInputType)):validateClaim(value,originalText(raw as ArticleInputType),globalIds));
   reasons.push(...coverageDiagnostics(n,checks.map(c=>c.value).filter((v):v is NonNullable<typeof v>=>!!v)));
   await this.db.$transaction(async tx=>{
    for(let i=0;i<values.length;i++)await storeClaim(tx,envelope.data.events[i],values[i],checks[i],article,run.id);
    await tx.processingRun.update({where:{id:run.id},data:{status:'completed',rawOutput,warnings:JSON.stringify(reasons.map(r=>r.message)),reviewReasons:JSON.stringify(reasons),durationMs:Date.now()-started,finishedAt:new Date()}});
   },{timeout:20000});
  }catch(error){const safe=error instanceof EngineError?`${error.code}: ${error.message}`:'PROCESSING_FAILED: database or processing error; credentials not exposed';await this.db.processingRun.update({where:{id:run.id},data:{status:'failed',error:safe,rawOutput:rawOutput??(error instanceof EngineError?error.raw:undefined),warnings:JSON.stringify([safe]),reviewReasons:JSON.stringify([{code:'INVALID_SCHEMA',message:safe,...(error instanceof EngineError&&error.diagnostic?{providerDiagnostic:error.diagnostic}:{})}]),durationMs:Date.now()-started,finishedAt:new Date()}});}
  return this.result(run.id);
 }
}
