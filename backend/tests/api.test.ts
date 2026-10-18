import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { readFile, readdir, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { MistralProvider } from '../src/provider.js';
import { FIXTURES } from './fixtures.js';

const dbPath=fileURLToPath(new URL(`../.test-${randomUUID()}.db`,import.meta.url));
const db=new PrismaClient({datasources:{db:{url:`file:${dbPath.replaceAll('\\','/')}`}}});
const config=loadConfig({MISTRAL_API_KEY:'test-key-never-sent',LLM_PRICING_VERIFIED_AT:new Date().toISOString().slice(0,10)});
const headers={'content-type':'application/json','x-world-lens-client':'ai-lab',host:'127.0.0.1:3001'};
beforeAll(async()=> {
  const root=new URL('../prisma/migrations/',import.meta.url);
  for(const directory of (await readdir(root,{withFileTypes:true})).filter(item=>item.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name))) {
    const migration=await readFile(new URL(directory.name+'/migration.sql',root),'utf8');
    for(const statement of migration.split(';').map(value=>value.trim()).filter(Boolean)) await db.$executeRawUnsafe(statement);
  }
});
beforeEach(async()=> {for(const table of ['reviewDecision','evidence','eventSource','relationship','eventParticipant','event','llmRequest','processingRun','article'] as const) await db[table].deleteMany();});
afterAll(async()=> {await db.$disconnect();for(const suffix of ['','-journal','-wal','-shm'])await unlink(dbPath+suffix).catch(()=>{});});
const fixture=FIXTURES[0];
function fakeProvider(events=fixture.expected) {return {extract:vi.fn(async()=>JSON.stringify({events,diagnostics:[]}))};}
async function runRecord() {
  const article=await db.article.create({data:{fingerprint:randomUUID(),title:'Test article',content:fixture.article.content,source:'Test',url:'https://example.org',canonicalUrl:'https://example.org/',publishedAt:new Date(),language:'en',normalizedText:fixture.article.content,originalJson:JSON.stringify(fixture.article)}});
  return db.processingRun.create({data:{articleId:article.id,model:config.MISTRAL_MODEL,promptVersion:'test'}});
}
describe('real SQLite pipeline and API (injected provider)',()=> {
  it('persists events, participants, evidence, sources and audit decisions atomically',async()=> {
    const provider=fakeProvider();const app=createApp(config,db,provider);
    const first=await app.inject({method:'POST',url:'/api/articles/process',headers,payload:fixture.article});
    expect(first.statusCode).toBe(200);const result=first.json();expect(result.processingStatus).toBe('completed');expect(result.events[0].publicationStatus).toBe('NeedsReview');expect(result.events[0].evidence[0].startOffset).toBeGreaterThan(0);expect(result.events[0].decisions).toHaveLength(1);
    const repeated=await app.inject({method:'POST',url:'/api/articles/process',headers,payload:fixture.article});expect(repeated.json().cached).toBe(true);expect(provider.extract).toHaveBeenCalledTimes(1);expect(await db.event.count()).toBe(1);
    expect((await app.inject({url:'/api/events?country=DE&eventType=diplomacy',headers})).json().total).toBe(1);
    expect((await app.inject({url:'/api/countries/fr/events',headers})).json().total).toBe(1);
    expect((await app.inject({url:'/api/events?country=RU',headers})).json().total).toBe(0);
    expect((await app.inject({url:'/api/events/'+result.events[0].id,headers})).json().id).toBe(result.events[0].id);
    expect((await app.inject({url:'/api/events/'+result.events[0].id,headers})).json().globePreview.countries.sort()).toEqual(['DEU','FRA']);
    expect((await app.inject({url:'/api/review-queue',headers})).json().total).toBe(1);
    expect((await app.inject({url:'/api/events/missing',headers})).statusCode).toBe(404);
    expect((await app.inject({url:'/api/ai/usage',headers})).json().processingRuns).toBe(1);
    await app.close();
  });
  it('coalesces simultaneous repeated ingestion into a single paid extraction',async()=> {
    const provider=fakeProvider();const app=createApp(config,db,provider);
    const replies=await Promise.all([1,2,3].map(()=>app.inject({method:'POST',url:'/api/articles/process',headers,payload:fixture.article})));
    expect(replies.every(reply=>reply.statusCode===200)).toBe(true);expect(provider.extract).toHaveBeenCalledTimes(1);expect(await db.processingRun.count()).toBe(1);await app.close();
  });
  it('persists every authored multi-event scenario without inventing pairwise links',async()=> {
    const multi=FIXTURES.find(item=>item.id==='multiple-events')!;const app=createApp(config,db,fakeProvider(multi.expected));
    const response=await app.inject({method:'POST',url:'/api/articles/process',headers,payload:multi.article});expect(response.json().events).toHaveLength(2);expect(await db.relationship.count()).toBe(2);await app.close();
  });
  it('keeps potential duplicates as separate review events',async()=> {
    const app=createApp(config,db,fakeProvider());
    await app.inject({method:'POST',url:'/api/articles/process',headers,payload:fixture.article});
    const response=await app.inject({method:'POST',url:'/api/articles/process',headers,payload:{...fixture.article,url:'https://other.example.org/story'}});
    expect(JSON.parse(response.json().events[0].duplicateCandidates)).toHaveLength(1);expect(await db.event.count()).toBe(2);await app.close();
  });
  it('stores rejected evidence separately and never puts it in the review queue',async()=> {
    const app=createApp(config,db,fakeProvider([{...fixture.expected[0],evidence:[{text:'Invented evidence not present in the article.'}]}]));
    const reply=await app.inject({method:'POST',url:'/api/articles/process',headers,payload:fixture.article});expect(reply.json().events[0].publicationStatus).toBe('Rejected');expect((await app.inject({url:'/api/review-queue',headers})).json().total).toBe(0);await app.close();
  });
  it('records invalid/truncated JSON runs without publishing events',async()=> {
    const app=createApp(config,db,{extract:async()=>'{"events":['});const reply=await app.inject({method:'POST',url:'/api/articles/process',headers,payload:fixture.article});expect(reply.statusCode).toBe(502);expect(reply.json().error).toContain('INVALID_MODEL_JSON');expect(await db.event.count()).toBe(0);expect((await db.processingRun.findFirst())?.rawOutput).toBe('{"events":[');await app.close();
  });
  it('validates input and query filters and blocks cross-origin writes/DNS rebinding',async()=> {
    const provider=fakeProvider();const app=createApp(config,db,provider);
    expect((await app.inject({method:'POST',url:'/api/articles/process',headers,payload:{...fixture.article,url:'ftp://example.org'}})).statusCode).toBe(400);
    expect((await app.inject({url:'/api/events?country=ZZ',headers})).statusCode).toBe(400);
    expect((await app.inject({url:'/api/events?from=2026-11-18T10:00:00Z&to=2026-10-18T10:00:00Z',headers})).statusCode).toBe(400);
    expect((await app.inject({method:'POST',url:'/api/articles/process',headers:{...headers,origin:'https://evil.example'},payload:fixture.article})).statusCode).toBe(403);
    expect((await app.inject({url:'/api/events',headers:{host:'evil.example'}})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:'/api/articles/process',headers:{host:'localhost'},payload:fixture.article})).statusCode).toBe(403);
    expect(provider.extract).not.toHaveBeenCalled();await app.close();
  });
  it('allows an explicit failed-run retry while retaining history and coalescing repeated retry clicks',async()=> {
    const provider={extract:vi.fn().mockResolvedValueOnce('{').mockResolvedValue(JSON.stringify({events:fixture.expected,diagnostics:[]}))};const app=createApp(config,db,provider);
    const first=(await app.inject({method:'POST',url:'/api/articles/process',headers,payload:fixture.article})).json();
    const second=(await app.inject({method:'POST',url:'/api/articles/process',headers,payload:{...fixture.article,retryOf:first.runId}})).json();
    expect(second.processingStatus).toBe('completed');expect(second.runId).not.toBe(first.runId);
    const repeated=(await app.inject({method:'POST',url:'/api/articles/process',headers,payload:{...fixture.article,retryOf:first.runId}})).json();expect(repeated.cached).toBe(true);expect(provider.extract).toHaveBeenCalledTimes(2);expect(await db.processingRun.count()).toBe(2);
    const invalid=await app.inject({method:'POST',url:'/api/articles/process',headers,payload:{...fixture.article,retryOf:second.runId}});expect(invalid.statusCode).toBe(400);await app.close();
  });
  it('requires a bearer token on every data endpoint in production',async()=> {
    const token='x'.repeat(32),app=createApp({...config,NODE_ENV:'production',ADMIN_API_TOKEN:token},db,fakeProvider());
    for(const url of ['/api/events','/api/countries/DE/events','/api/events/test','/api/review-queue','/api/ai/usage'])expect((await app.inject({url,headers})).statusCode).toBe(401);
    expect((await app.inject({method:'POST',url:'/api/articles/process',headers,payload:fixture.article})).statusCode).toBe(401);
    expect((await app.inject({url:'/api/ai/usage',headers:{...headers,authorization:'Bearer '+token}})).statusCode).toBe(200);
    const lab=await app.inject({url:'/dev/ai-lab',headers});expect(lab.body).toContain('Admin API token');expect(lab.body).not.toContain(token);await app.close();
  });
});
describe('Mistral request protocol, per-attempt metering and budget protection',()=> {
  const input={title:fixture.article.title,content:fixture.article.content,language:'en',publishedAt:fixture.article.publishedAt};
  function completion(raw=JSON.stringify({events:fixture.expected,diagnostics:[]}),finish='stop') {return new Response(JSON.stringify({choices:[{finish_reason:finish,message:{content:raw}}],usage:{prompt_tokens:100,completion_tokens:50}}),{status:200,headers:{'Content-Type':'application/json'}});}
  it('uses official endpoint, model, custom JSON schema and only article data',async()=> {
    const run=await runRecord(),fetcher=vi.fn(async()=>completion());
    await new MistralProvider(db,config,fetcher).extract(input,run.id);
    const [url,options]=fetcher.mock.calls[0] as unknown as [string,RequestInit];const body=JSON.parse(options.body as string);
    expect(url).toBe('https://api.mistral.ai/v1/chat/completions');expect(body.model).toBe('ministral-8b-2512');expect(body.response_format.type).toBe('json_schema');expect(body.response_format.json_schema.strict).toBe(true);expect(JSON.parse(body.messages[1].content)).toEqual(input);
    const record=await db.llmRequest.findFirst();expect(record?.inputTokens).toBe(100);expect(record?.outputTokens).toBe(50);expect(record?.estimatedCostUsd).toBeCloseTo(.0000225);expect(record?.status).toBe('completed');
  });
  it('retries only explicit rate-limit rejections with bounded exponential backoff',async()=> {
    const run=await runRecord(),fetcher=vi.fn().mockResolvedValueOnce(new Response('',{status:429})).mockResolvedValueOnce(new Response('',{status:429})).mockResolvedValueOnce(completion());const sleep=vi.fn(async()=>{});
    await new MistralProvider(db,config,fetcher,sleep).extract(input,run.id);expect(fetcher).toHaveBeenCalledTimes(3);expect(sleep.mock.calls.map(call=>(call as unknown[])[0])).toEqual([250,500]);expect(await db.llmRequest.count()).toBe(3);expect((await db.llmRequest.findMany()).filter(row=>row.status==='http_429').every(row=>row.estimatedCostUsd===0)).toBe(true);
  });
  it('limits repeated rate-limit responses',async()=> {
    const run=await runRecord(),fetcher=vi.fn(async()=>new Response('',{status:429}));await expect(new MistralProvider(db,config,fetcher,async()=>{}).extract(input,run.id)).rejects.toMatchObject({code:'PROVIDER_HTTP_429'});expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('does not retry authentication failures',async()=> {
    const run=await runRecord(),fetcher=vi.fn(async()=>new Response('',{status:401}));await expect(new MistralProvider(db,config,fetcher).extract(input,run.id)).rejects.toMatchObject({code:'PROVIDER_HTTP_401'});expect(fetcher).toHaveBeenCalledTimes(1);expect((await db.llmRequest.findFirst())?.estimatedCostUsd).toBe(0);
  });
  it('does not blindly retry a timeout and blocks later requests with uncertain charges',async()=> {
    const run=await runRecord(),fetcher=vi.fn(async()=>{throw new Error('Connection reset');});const provider=new MistralProvider(db,config,fetcher);
    await expect(provider.extract(input,run.id)).rejects.toMatchObject({code:'PROVIDER_CONNECTION'});await expect(provider.extract(input,run.id)).rejects.toMatchObject({code:'USAGE_UNCERTAIN'});expect(fetcher).toHaveBeenCalledTimes(1);expect((await db.llmRequest.findFirst())?.estimatedCostUsd).toBeGreaterThan(0);
  });
  it('retains conservative charges for 5xx responses and never retries ambiguously accepted requests',async()=> {
    const run=await runRecord(),fetcher=vi.fn(async()=>new Response('',{status:503}));await expect(new MistralProvider(db,config,fetcher).extract(input,run.id)).rejects.toMatchObject({code:'PROVIDER_HTTP_503'});expect(fetcher).toHaveBeenCalledTimes(1);expect((await db.llmRequest.findFirst())?.status).toBe('uncertain');
  });
  it('meters truncated output without issuing another paid repair call',async()=> {
    const run=await runRecord(),fetcher=vi.fn(async()=>completion('{"events":[','length'));await expect(new MistralProvider(db,config,fetcher).extract(input,run.id)).rejects.toMatchObject({code:'INCOMPLETE_OUTPUT'});expect(fetcher).toHaveBeenCalledTimes(1);expect((await db.llmRequest.findFirst())?.outputTokens).toBe(50);
  });
  it('blocks when usage is omitted',async()=> {
    const run=await runRecord(),fetcher=vi.fn(async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{}'}}]}),{status:200}));await expect(new MistralProvider(db,config,fetcher).extract(input,run.id)).rejects.toMatchObject({code:'MISSING_USAGE'});expect((await db.llmRequest.findFirst())?.status).toBe('uncertain');
  });
  it('reserves budget before a request and rejects an unaffordable call',async()=> {
    const run=await runRecord(),fetcher=vi.fn(async()=>completion());await expect(new MistralProvider(db,{...config,LLM_MONTHLY_BUDGET_USD:0},fetcher).extract(input,run.id)).rejects.toMatchObject({code:'BUDGET_EXCEEDED'});expect(fetcher).not.toHaveBeenCalled();expect(await db.llmRequest.count()).toBe(0);
  });
  it('requires confirmed pricing before sending a new model request',async()=> {
    const run=await runRecord(),fetcher=vi.fn(async()=>completion());await expect(new MistralProvider(db,{...config,MISTRAL_MODEL:'unpriced'},fetcher).extract(input,run.id)).rejects.toMatchObject({code:'PRICING_UNCONFIRMED'});expect(fetcher).not.toHaveBeenCalled();
  });
  it('counts charges against the correct UTC month',async()=> {
    const run=await runRecord();await db.llmRequest.create({data:{runId:run.id,model:config.MISTRAL_MODEL,month:'2020-01',status:'completed',estimatedCostUsd:10,inputRate:.15,outputRate:.15,pricingVerifiedAt:'2020-01-01'}});const fetcher=vi.fn(async()=>completion());await new MistralProvider(db,config,fetcher).extract(input,run.id);expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('warns as spending approaches the monthly cap',async()=> {
    const run=await runRecord();await db.llmRequest.create({data:{runId:run.id,model:config.MISTRAL_MODEL,month:new Date().toISOString().slice(0,7),status:'completed',estimatedCostUsd:8.1,inputRate:.15,outputRate:.15,pricingVerifiedAt:new Date().toISOString().slice(0,10)}});
    const app=createApp(config,db,fakeProvider());const usage=(await app.inject({url:'/api/ai/usage',headers})).json();expect(usage.budgetWarning).toBe(true);expect(usage.estimatedCostUsd).toBe(8.1);await app.close();
  });
});
