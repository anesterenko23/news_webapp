import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { readFile, readdir, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { MistralProvider, GeminiProvider } from '../src/provider.js';
import { legacyToCurrent } from '../src/validation.js';
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
beforeEach(async()=> {for(const table of ['claimValidationDecision','claimEvidenceLink','claimRelationship','claimEvidence','claimParticipant','mergeCandidate','canonicalEventSource','eventRevision','verificationDecision','eventRelationship','canonicalParticipant','extractedClaim','canonicalEvent','reviewDecision','evidence','eventSource','relationship','eventParticipant','event','llmRequest','processingRun','article'] as const) await db[table].deleteMany();});
afterAll(async()=> {await db.$disconnect();for(const suffix of ['','-journal','-wal','-shm'])await unlink(dbPath+suffix).catch(()=>{});});
const fixture=FIXTURES[0];
function fakeProvider(events=fixture.expected) {return {extract:vi.fn(async()=>JSON.stringify({events:events.map((event,i)=>legacyToCurrent(event as unknown as Record<string,unknown>,i)),diagnostics:[]}))};}
async function runRecord() {
  const article=await db.article.create({data:{fingerprint:randomUUID(),title:'Test article',content:fixture.article.content,source:'Test',url:'https://example.org',canonicalUrl:'https://example.org/',publishedAt:new Date(),language:'en',normalizedText:fixture.article.content,originalJson:JSON.stringify(fixture.article)}});
  return db.processingRun.create({data:{articleId:article.id,model:config.MISTRAL_MODEL,promptVersion:'test'}});
}
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


describe('Gemini transport and cost safety (mock HTTP, no real API calls)',()=>{
 const settings=()=>loadConfig({LLM_PROVIDER:'gemini',GEMINI_API_KEY:'test-gemini-key',LLM_PRICING_VERIFIED_AT:'2000-01-01',LLM_INPUT_USD_PER_MILLION:'0.15',LLM_OUTPUT_USD_PER_MILLION:'0.15'});
 const input={title:'Test',content:'France and Germany held talks.',language:'en',publishedAt:'2026-10-18T00:00:00Z'};
 const reply=(finishReason='STOP',usage=true)=>new Response(JSON.stringify({candidates:[{finishReason,content:{parts:[{text:'private reasoning',thought:true},{text:'{"events":[],"diagnostics":[]}'}]}}],...(usage?{usageMetadata:{promptTokenCount:100,candidatesTokenCount:50,thoughtsTokenCount:20}}:{})}),{status:200});
 it('uses Google header auth and schema, excludes thoughts and bills thought tokens',async()=>{
  const run=await runRecord(),fetcher=vi.fn(async()=>reply()),config=settings();const raw=await new GeminiProvider(db,config,fetcher).extract(input,run.id);
  const [url,options]=fetcher.mock.calls[0] as unknown as [string,RequestInit];const body=JSON.parse(options.body as string);
  expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');expect(url).not.toContain(config.GEMINI_API_KEY);expect((options.headers as Record<string,string>)['x-goog-api-key']).toBe(config.GEMINI_API_KEY);expect(body.generationConfig.responseMimeType).toBe('application/json');expect(body.generationConfig.responseJsonSchema.properties.events).toBeDefined();expect(JSON.parse(body.contents[0].parts[0].text)).toEqual(input);expect(raw).not.toContain('private reasoning');
  const record=await db.llmRequest.findFirstOrThrow();expect(record.model).toBe('gemini-3.8-flash');expect(record.outputTokens).toBe(70);expect(record.inputRate).toBe(.75);expect(record.outputRate).toBe(3.75);expect(record.estimatedCostUsd).toBeCloseTo(.0003375);
 });
 it('preserves reservation and blocks subsequent calls after a 503 without usage',async()=>{
  const run=await runRecord(),fetcher=vi.fn(async()=>new Response('',{status:503})),provider=new GeminiProvider(db,settings(),fetcher);
  await expect(provider.extract(input,run.id)).rejects.toMatchObject({code:'PROVIDER_HTTP_503'});expect((await db.llmRequest.findFirst())?.status).toBe('uncertain');await expect(provider.extract(input,run.id)).rejects.toMatchObject({code:'USAGE_UNCERTAIN'});expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('does not retry unsupported model errors or bill known rejection',async()=>{
  const run=await runRecord(),fetcher=vi.fn(async()=>new Response('',{status:404}));await expect(new GeminiProvider(db,settings(),fetcher).extract(input,run.id)).rejects.toMatchObject({code:'PROVIDER_HTTP_404'});expect(fetcher).toHaveBeenCalledTimes(1);expect((await db.llmRequest.findFirst())?.estimatedCostUsd).toBe(0);
 });
 it('rejects incomplete structured output after recording returned usage',async()=>{
  const run=await runRecord(),fetcher=vi.fn(async()=>reply('MAX_TOKENS'));await expect(new GeminiProvider(db,settings(),fetcher).extract(input,run.id)).rejects.toMatchObject({code:'INCOMPLETE_OUTPUT'});expect((await db.llmRequest.findFirst())?.outputTokens).toBe(70);
 });
 it('treats missing usage as uncertain instead of free',async()=>{
  const run=await runRecord(),fetcher=vi.fn(async()=>reply('STOP',false));await expect(new GeminiProvider(db,settings(),fetcher).extract(input,run.id)).rejects.toMatchObject({code:'MISSING_USAGE'});expect((await db.llmRequest.findFirst())?.status).toBe('uncertain');
 });
 it('requires Gemini-specific pricing for unknown models',async()=>{
  const run=await runRecord(),fetcher=vi.fn(async()=>reply());await expect(new GeminiProvider(db,{...settings(),GEMINI_MODEL:'unknown-model'},fetcher).extract(input,run.id)).rejects.toMatchObject({code:'PRICING_UNCONFIRMED'});expect(fetcher).not.toHaveBeenCalled();
 });
});


describe('Provider error diagnostics',()=>{
 it('preserves Google field violations and request ID while redacting credentials from saved API results',async()=>{
  const config=loadConfig({LLM_PROVIDER:'gemini',GEMINI_API_KEY:'test-secret-key'});const fetcher=vi.fn(async()=>new Response(JSON.stringify({error:{code:400,status:'INVALID_ARGUMENT',message:'Invalid schema with test-secret-key',details:[{fieldViolations:[{field:'generation_config.response_format.text.mime_type',description:'bad test-secret-key'}]}]}}),{status:400,headers:{'x-request-id':'test-google-request-id'}}));const app=createApp(config,db,new GeminiProvider(db,config,fetcher));
  const response=await app.inject({method:'POST',url:'/api/articles/process',headers,payload:fixture.article});const data=response.json();expect(response.statusCode).toBe(502);expect(JSON.stringify(data)).not.toContain(config.GEMINI_API_KEY);expect(data.error).toContain('[REDACTED]');expect(data.reviewReasons[0].providerDiagnostic.error.details[0].fieldViolations[0].field).toContain('mime_type');expect(data.reviewReasons[0].providerDiagnostic.headers['x-request-id']).toBe('test-google-request-id');expect((await db.processingRun.findUniqueOrThrow({where:{id:data.runId}})).reviewReasons).not.toContain(config.GEMINI_API_KEY);await app.close();
 });
});
