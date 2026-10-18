import Fastify from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z, ZodError } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { Config } from './config.js';
import { pricing } from './config.js';
import { IntelligenceEngine } from './engine.js';
import { canonicalInclude, claimInclude, resolveMerge, undoSourceLink } from './canonical.js';
import { claimDto, canonicalDto } from './presentation.js';
import { PROMPT_VERSION, BASELINE_VERSION, PREVIOUS_VERSION } from './prompt.js';
import { EngineError, MistralProvider, type Provider } from './provider.js';
import { EventQuery } from './schemas.js';
import { aiLabHtml } from './lab.js';
import { globeProjection } from './globe-projection.js';

const loopback = (value: string) => ['127.0.0.1','localhost','::1','[::1]','::ffff:127.0.0.1'].includes(value);
export function createApp(config: Config, db: PrismaClient, provider?: Provider) {
  const app = Fastify({logger:false,bodyLimit:150000,requestTimeout:120000,trustProxy:false});
  const engine = new IntelligenceEngine(db,config,provider ?? new MistralProvider(db,config));
  const localOnly = config.NODE_ENV === 'development' && loopback(config.HOST) && !config.ADMIN_API_TOKEN;
  let pending = 0;
  app.addHook('onRequest',async (request,reply) => {
    reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer').header('X-Frame-Options','DENY');
    if (request.url.split('?')[0] === '/health') return;
    const origin = request.headers.origin;
    const expectedOrigin = `${request.protocol}://${request.headers.host}`;
    if (origin && origin !== expectedOrigin) {
      let allowed = false;
      try { const parsed = new URL(origin); allowed = localOnly && loopback(parsed.hostname) && ['3001','5173','5174'].includes(parsed.port); } catch {}
      if (!allowed) return reply.code(403).send({error:'ORIGIN_DENIED'});
    }
    if (localOnly) {
      let host = '';
      try { host = new URL(`http://${request.headers.host}`).hostname; } catch {}
      if (!loopback(request.ip) || !loopback(host)) return reply.code(403).send({error:'LOOPBACK_ONLY'});
    }
    // The shell contains no data. All API calls still require authorization in network mode.
    if (request.method === 'GET' && request.url === '/dev/ai-lab') return;
    if (!localOnly) {
      const token = request.headers.authorization?.replace(/^Bearer /,'') ?? '';
      const digest = (value: string) => createHash('sha256').update(value).digest();
      if (!config.ADMIN_API_TOKEN || !timingSafeEqual(digest(token),digest(config.ADMIN_API_TOKEN))) return reply.code(401).send({error:'UNAUTHORIZED'});
    }
    if (!['GET','HEAD'].includes(request.method) && request.headers['x-world-lens-client'] !== 'ai-lab') return reply.code(403).send({error:'CLIENT_HEADER_REQUIRED',message:'Send X-World-Lens-Client: ai-lab'});
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({error:'INVALID_INPUT',issues:error.issues.map(issue=>({path:issue.path,message:issue.message}))});
    if (error instanceof EngineError) return reply.code(error.statusCode).send({error:error.code,message:error.message});
    if (error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode < 500) return reply.code(error.statusCode).send({error:'INVALID_REQUEST'});
    return reply.code(500).send({error:'INTERNAL_ERROR',message:'Request failed; no provider credentials are exposed'});
  });
  app.get('/health',async()=>({status:'ok',service:'world-lens-intelligence'}));
  app.get('/dev/ai-lab',async(_request,reply)=>reply.header('Content-Security-Policy',"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'").type('text/html; charset=utf-8').send(aiLabHtml(!localOnly)));
  app.post('/api/articles/process',async(request,reply)=> {
    if (pending >= 4) return reply.code(429).send({error:'QUEUE_FULL',message:'Wait for pending analysis to finish'});
    pending++;
    try {
      const {retryOf:rawRetry,promptVersion:rawVersion,...input} = z.record(z.string(),z.unknown()).parse(request.body);
      const retryOf = z.string().min(1).max(100).optional().parse(rawRetry);
      const version=z.enum([PROMPT_VERSION,BASELINE_VERSION,PREVIOUS_VERSION]).optional().parse(rawVersion);
      const result = await engine.process(input,retryOf,version);
      return reply.code(result.processingStatus === 'failed' ? (result.error?.includes('BUDGET_EXCEEDED') ? 429 : 502) : result.processingStatus === 'processing' ? 202 : 200).send(result);
    } finally { pending--; }
  });
  async function list(query: unknown, country?: string) {
    const filters = EventQuery.parse({...query as object,...(country ? {country:country.toUpperCase()} : {})});
    const where = { archived:false, ...(filters.country ? {participants:{some:{countryCode:filters.country}}} : {}),...(filters.eventType ? {eventType:filters.eventType} : {}),...(filters.verificationStatus ? {verificationStatus:filters.verificationStatus} : {}),...((filters.from || filters.to) ? {publishedAt:{...(filters.from?{gte:new Date(filters.from)}:{}),...(filters.to?{lte:new Date(filters.to)}:{})}} : {}) };
    const [events,total] = await Promise.all([db.canonicalEvent.findMany({where,include:canonicalInclude,orderBy:{publishedAt:'desc'},take:filters.limit,skip:filters.offset}),db.canonicalEvent.count({where})]);
    return {events:events.map(canonicalDto),total,limit:filters.limit,offset:filters.offset,dateFilter:'article publication time (UTC)'};
  }
  app.get('/api/events',request=>list(request.query));
  app.get<{Params:{code:string}}>('/api/countries/:code/events',request=>list(request.query,request.params.code));
  app.get<{Params:{id:string}}>('/api/events/:id',async(request,reply)=> {
    const event = await db.canonicalEvent.findUnique({where:{id:request.params.id},include:canonicalInclude});
    return event ? {...canonicalDto(event),globePreview:globeProjection(event)} : reply.code(404).send({error:'EVENT_NOT_FOUND'});
  });
  app.get<{Params:{id:string}}>('/api/claims/:id',async(request,reply)=>{
    const claim=await db.extractedClaim.findUnique({where:{id:request.params.id},include:claimInclude});
    return claim?claimDto(claim):reply.code(404).send({error:'CLAIM_NOT_FOUND'});
  });
  app.get('/api/review-queue',async request=> {
    const filters=z.object({limit:z.coerce.number().int().min(1).max(100).default(50),offset:z.coerce.number().int().min(0).default(0)}).parse(request.query);
    const where={publicationStatus:{in:['NeedsReview','Blocked']}};
    const [claims,total,mergeCandidates,runs,events]=await Promise.all([
      db.extractedClaim.findMany({where,include:claimInclude,orderBy:{createdAt:'desc'},take:filters.limit,skip:filters.offset}),db.extractedClaim.count({where}),
      db.mergeCandidate.findMany({where:{status:'Pending'},take:filters.limit}),db.processingRun.findMany({where:{status:'failed'},select:{id:true,articleId:true,reviewReasons:true,error:true},take:filters.limit}),
      db.canonicalEvent.findMany({where:{archived:false,publicationStatus:'NeedsReview'},include:canonicalInclude,take:filters.limit})
    ]);
    return {claims:claims.map(claimDto),total,events:events.map(canonicalDto),mergeCandidates:mergeCandidates.map(c=>({...c,reasons:JSON.parse(c.reasons)})),failedRuns:runs.map(r=>({...r,reviewReasons:JSON.parse(r.reviewReasons)}))};
  });
  app.post<{Params:{id:string}}>('/api/merge-candidates/:id/resolve',async(request)=>{
    const input=z.strictObject({decision:z.enum(['merge','separate']),reviewer:z.string().min(3).max(100),note:z.string().min(8).max(2000)}).parse(request.body);
    try{return await resolveMerge(db,request.params.id,input);}catch{throw new EngineError('INVALID_MERGE_DECISION','Candidate missing, already decided or claim not eligible',400);}
  });
  app.post<{Params:{id:string}}>('/api/event-sources/:id/unlink',async request=>{
    const input=z.strictObject({reviewer:z.string().min(3).max(100),note:z.string().min(8).max(2000)}).parse(request.body);
    try{return await undoSourceLink(db,request.params.id,input);}catch{throw new EngineError('INVALID_SOURCE_LINK','Source link missing, inactive or not eligible',400);}
  });
  app.get('/api/ai/usage',async()=> {
    const month = new Date().toISOString().slice(0,7);
    const [requests,articles,errors,runs] = await Promise.all([db.llmRequest.findMany({where:{month},orderBy:{createdAt:'desc'}}),db.article.count(),db.processingRun.count({where:{status:'failed'}}),db.processingRun.count()]);
    const estimatedCostUsd = requests.reduce((sum,item)=>sum+item.estimatedCostUsd,0);
    let rates = null; try { rates = pricing(config); } catch {}
    const uncertain = await db.llmRequest.count({where:{status:{in:['uncertain','pricing_exceeded']}}});
    const stale = await db.llmRequest.count({where:{status:'reserved',createdAt:{lt:new Date(Date.now()-config.LLM_TIMEOUT_MS-60000)}}});
    return {month,requests:requests.length,processedArticles:articles,processingRuns:runs,inputTokens:requests.reduce((sum,item)=>sum+item.inputTokens,0),outputTokens:requests.reduce((sum,item)=>sum+item.outputTokens,0),estimatedCostUsd,monthlyBudgetUsd:config.LLM_MONTHLY_BUDGET_USD,budgetWarning:estimatedCostUsd >= config.LLM_MONTHLY_BUDGET_USD*.8,processingErrors:errors,uncertainRequests:uncertain+stale,blocked:!rates || !!uncertain || !!stale || estimatedCostUsd>=config.LLM_MONTHLY_BUDGET_USD,pricing:rates,model:config.MISTRAL_MODEL,configured:!!config.MISTRAL_API_KEY,notice:'Local estimates and conservative reservations may differ from provider billing. No cached-token discount assumed.',recentRequests:requests.slice(0,30)};
  });
  return app;
}
