import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {testDatabase} from './database.js';
import {createApp} from '../src/app.js';
import {loadConfig} from '../src/config.js';
import {mapSemanticEvent} from '../src/semantic-mapper.js';
import {SEMANTIC_VERSION,SemanticExtraction} from '../src/semantic-contract.js';
import {extractionRequest} from '../src/provider.js';
import {revalidateStoredClaims} from '../src/revalidation.js';

const fixtures=JSON.parse(readFileSync(new URL('./regressions/phase47-cases.json',import.meta.url),'utf8')).cases;
let storage:Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async()=>{storage=await testDatabase();});beforeEach(async()=>storage.clear());afterAll(async()=>storage.close());
const config=loadConfig({LLM_PROVIDER:'gemini',GEMINI_API_KEY:'fake-never-sent',LLM_MAX_OUTPUT_TOKENS:'8000'});
const headers={'x-world-lens-client':'ai-lab',host:'127.0.0.1:3001'};
const sample=()=>structuredClone(fixtures.find((c:any)=>c.id==='international-agreement').response.events[0]);
const original=(e:any)=>e.title+'\n'+e.evidence;
async function processFixture(f:any){const provider={extract:vi.fn(async()=>JSON.stringify(f.response))};const app=createApp(config,storage.db,provider);const response=await app.inject({method:'POST',url:'/api/articles/process',headers,payload:f.input});return {app,response,result:response.json(),provider};}

describe('Phase 4.7 real-source reviewed offline regression fixtures (not live model outputs)',()=>{
 for(const f of fixtures)it(f.id,async()=>{
  expect(SemanticExtraction.safeParse(f.response).success).toBe(true);
  const {app,response,result,provider}=await processFixture(f);
  expect(response.statusCode).toBe(200);expect(result.promptVersion).toBe(SEMANTIC_VERSION);
  expect(result.claims).toHaveLength(f.response.events.length);expect(result.rawOutput).toBe(JSON.stringify(f.response));
  for(const c of result.claims){expect(c.publicationStatus).toBe('NeedsReview');expect(c.verificationStatus).not.toBe('Verified');expect(c.reason).toBeNull();expect(c.confidence).toBeNull();expect(c.analysis.contractVersion).toBe(SEMANTIC_VERSION);expect(c.globePreview.previewOnly).toBe(true);expect(c.globePreview.reviewRequired).toBe(true);for(const edge of c.globePreview.relationships)expect(edge.eventStatus).toBe(c.eventStatus);}
  const source=await storage.db.article.findUniqueOrThrow({where:{id:result.articleId}});expect(source.url).toBe(f.input.url);expect(source.content).toBe(f.input.content);
  const repeated=(await app.inject({method:'POST',url:'/api/articles/process',headers,payload:f.input})).json();expect(repeated.cached).toBe(true);expect(provider.extract).toHaveBeenCalledTimes(1);
  if(f.id==='international-agreement')expect(result.claims[0].globePreview.relationships).toEqual([expect.objectContaining({from:'GBR',to:'ESP',bidirectional:true})]);
  if(f.id==='international-organization'){expect(result.claims[0].globePreview.organizations[0].name).toBe('European Union');expect(result.claims[0].globePreview.relationships).toHaveLength(0);}
  if(f.id==='planned-action'){expect(result.claims[0].eventStatus).toBe('proposed');expect(result.claims[0].globePreview.relationships).toHaveLength(1);}
  if(f.id==='diplomatic-meeting'){expect(result.events).toHaveLength(2);expect(result.claims.every((c:any)=>c.globePreview.relationships.length===1)).toBe(true);}
  if(f.id==='contradictory-claims')expect(result.claims[0].eventStatus).toBe('denied');
  await app.close();
 });
});
describe('mapper responsibility and semantic regression barriers',()=>{
 it('replays the actual captured Phase 4.7 Mistral response without a model call',async()=>{
  const fixture=JSON.parse(readFileSync(new URL('./regressions/phase47-live-mistral.json',import.meta.url),'utf8'));
  const {app,result}=await processFixture(fixture);expect(result.claims).toHaveLength(1);expect(result.claims[0].validationStatus).toBe('Valid');expect(result.events).toHaveLength(1);expect(result.claims[0].participants.map((p:any)=>p.countryCode).sort()).toEqual(['ES','GB']);expect(result.claims[0].globePreview.relationships[0]).toMatchObject({from:'GBR',to:'ESP',bidirectional:true});await app.close();
 });
 it('preserves an unmatched quotation and event for review, not refutation',async()=>{
  const f=structuredClone(fixtures.find((c:any)=>c.id==='international-agreement'));f.response.events[0].evidence='An accurate paraphrase is not necessarily a direct quotation.';
  const {app,result}=await processFixture(f);expect(result.claims[0].validationStatus).toBe('NeedsRepair');expect(result.claims[0].publicationStatus).toBe('NeedsReview');expect(result.claims[0].verificationStatus).toBe('NotAssessed');expect(result.claims[0].globePreview.relationships).toHaveLength(0);expect(result.claims[0].rawClaim).toContain(f.response.events[0].evidence);await app.close();
 });
 it('resolves a known EU organization even when mislabeled country; preserves unknown names',()=>{
  const e=sample();e.participants=[{name:'EU',type:'country',role:'participant'},{name:'Unlisted Forum',type:'international_organization',role:'participant'},{name:'Atlantis',type:'country',role:'participant'}];e.relationships=[];
  const r=mapSemanticEvent(e,original(e));expect(r.value?.countries).toEqual([]);expect(r.semantic.participants.map(p=>[p.name,p.type,p.countryCode])).toEqual([['EU','international_organization',null],['Unlisted Forum','international_organization',null],['Atlantis','unknown',null]]);expect(r.status).toBe('NeedsRepair');
 });
 it('does not turn sanctions against people into country sanctions',()=>{
  const e=sample();Object.assign(e,{title:'UK sanctions two Bosnian politicians',summary:'UK announces personal sanctions against two politicians, not Bosnia and Herzegovina.',eventType:'sanctions',status:'announced',evidence:'The UK sanctioned two politicians from Bosnia and Herzegovina.'});
  e.participants=[{name:'UK',type:'country',role:'initiator'},{name:'Bosnia and Herzegovina',type:'country',role:'target'},{name:'Named politician',type:'individual',role:'target'}];e.relationships=[{from:'UK',to:'Bosnia and Herzegovina',type:'sanctions',direction:'directed'},{from:'UK',to:'Named politician',type:'sanctions',direction:'directed'}];
  const r=mapSemanticEvent(e,original(e));expect(r.value?.relationships).toEqual([]);expect(r.semantic.participants.some(p=>p.name==='Named politician')).toBe(true);expect(r.semantic.relationships).toHaveLength(2);
 });
 it('suppresses UK to Egypt conflict from condemnation of attacks',()=>{
  const e=sample();Object.assign(e,{title:'UK condemns attacks in Egypt',summary:'The UK condemns attacks in Cairo and expresses condolences.',eventType:'conflict',evidence:'The UK condemned attacks in Egypt.'});e.participants=[{name:'UK',type:'country',role:'initiator'},{name:'Egypt',type:'country',role:'target'}];e.relationships=[{from:'UK',to:'Egypt',type:'conflict',direction:'directed'}];expect(mapSemanticEvent(e,original(e)).value?.relationships).toEqual([]);
 });
 it('does not create an interaction from co-mention, unknown direction or a causal country',()=>{
  const e=sample();Object.assign(e,{title:'Trade measures',summary:'US sanctions Russia because of the war in Ukraine.',eventType:'sanctions',evidence:'The United States imposed sanctions against Russia because of the war in Ukraine.'});e.participants=[{name:'United States',type:'country',role:'initiator'},{name:'Russia',type:'country',role:'target'},{name:'Ukraine',type:'country',role:'target'}];e.relationships=[{from:'United States',to:'Russia',type:'sanctions',direction:'unknown'},{from:'United States',to:'Ukraine',type:'sanctions',direction:'directed'}];expect(mapSemanticEvent(e,original(e)).value?.relationships).toEqual([]);
  e.eventType='other';e.evidence='The United States and Russia were mentioned in a report.';e.relationships=[{from:'United States',to:'Russia',type:'other',direction:'directed'}];expect(mapSemanticEvent(e,original(e)).value?.relationships).toEqual([]);
 });
 it('retains one-country and organization-only events without manufacturing country edges',()=>{
  const e=sample();e.title='NATO holds consultations';e.summary='NATO held consultations on regional security.';e.evidence=e.summary;e.eventType='diplomacy';e.participants=[{name:'NATO',type:'international_organization',role:'participant'}];e.relationships=[];const r=mapSemanticEvent(e,original(e));expect(r.status).toBe('Valid');expect(r.value?.countries).toHaveLength(0);expect(r.value?.entities[0].identifier).toBe('NATO');
 });
 it('retains reason attribution through persistence without inventing verification or confidence',async()=>{
  const f=structuredClone(fixtures.find((c:any)=>c.id==='international-agreement'));f.response.events[0].reason={text:'To facilitate education access',attribution:'party',statedBy:'UK government'};
  const {app,result}=await processFixture(f);expect(result.claims[0].reason).toEqual(f.response.events[0].reason);expect(result.claims[0].analysis.reasonSupport).toBe('NeedsReview');expect(result.events[0].reason).toEqual(f.response.events[0].reason);expect(result.events[0].publicationStatus).toBe('NeedsReview');await revalidateStoredClaims(storage.db);expect((await storage.db.extractedClaim.findUniqueOrThrow({where:{id:result.claims[0].id}})).validationStatus).toBe('Valid');await app.close();
 });
 it('retains canonical deduplication and source lineage with server-generated evidence IDs',async()=>{
  const f=fixtures.find((c:any)=>c.id==='international-agreement');const {app,result}=await processFixture(f);const second=(await app.inject({method:'POST',url:'/api/articles/process',headers,payload:{...f.input,url:'https://example.org/reprint',source:'Syndicated source',lineageId:'same-release'}})).json();expect(second.canonicalEventIds).toEqual(result.canonicalEventIds);expect(second.events[0].linkedSourceCount).toBe(2);expect(second.events[0].verificationStatus).toBe('Unverified');expect(second.claims[0].evidence[0].id).not.toBe(result.claims[0].evidence[0].id);await app.close();
 });
 it('retains malformed event raw payload while processing valid siblings',async()=>{
  const f=structuredClone(fixtures.find((c:any)=>c.id==='international-agreement'));f.response.events.push({title:'Malformed event retained'});const {app,result}=await processFixture(f);expect(result.claims).toHaveLength(2);expect(result.claims[0].validationStatus).toBe('Valid');expect(result.claims[1].validationStatus).toBe('Invalid');expect(result.rawOutput).toContain('Malformed event retained');await app.close();
 });
 it('sends small schemas to both retained adapters, with low thinking only on the semantic Gemini profile',()=>{
  const input={title:'Test news',content:'France and Germany held talks.',language:'en',publishedAt:'2026-10-18T00:00:00Z'};
  for(const provider of ['mistral','gemini']as const){const request=extractionRequest(input,{...config,LLM_PROVIDER:provider},SEMANTIC_VERSION);const body=JSON.parse(request.body);const schema=provider==='gemini'?body.generationConfig.responseJsonSchema:body.response_format.json_schema.schema;expect(JSON.stringify(schema)).not.toMatch(/country_code|evidence_ids|occurred_at|confidence|attribution_evidence_ids/);expect(JSON.stringify(schema)).toContain('participants');if(provider==='gemini')expect(body.generationConfig.thinkingConfig).toEqual({thinkingLevel:'low'});}
 });
});
