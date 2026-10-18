// Opt-in paid evaluation of fictional fixtures against the running local API. Not run in CI.
import { FIXTURES } from './tests/fixtures.ts';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.AI_LAB_URL ?? 'http://127.0.0.1:3001';
if (!['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname)) throw new Error('Evaluation only targets a local backend');
const results=[];
for (const fixture of FIXTURES) {
  const response=await fetch(base+'/api/articles/process',{method:'POST',headers:{'Content-Type':'application/json','X-World-Lens-Client':'ai-lab',...(process.env.ADMIN_API_TOKEN?{Authorization:'Bearer '+process.env.ADMIN_API_TOKEN}:{})},body:JSON.stringify(fixture.article)});
  const data=await response.json();
  const actual=(data.events??[]).map(event=>({type:event.eventType,status:event.eventStatus,countries:event.participants.map(p=>p.countryCode).sort(),links:event.relationships.map(link=>[link.sourceCountry,link.targetCountry,link.type,link.direction]),publication:event.publicationStatus}));
  const result={scenario:fixture.id,status:data.processingStatus,expected:fixture.expected.map(event=>({type:event.event_type,status:event.event_status,countries:event.countries.map(p=>p.code).sort()})),actual,cached:data.cached,usage:data.usage,error:data.error??null};results.push(result);
  console.log(JSON.stringify(result));
  if (data.error && /BUDGET|USAGE_UNCERTAIN|PRICING|PROVIDER_HTTP_401/.test(data.error)) break;
}
await mkdir(new URL('../work/',import.meta.url),{recursive:true});
await writeFile(new URL('../work/live-evaluation.json',import.meta.url),JSON.stringify({evaluatedAt:new Date().toISOString(),results},null,2));
