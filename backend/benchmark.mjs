// Explicit, paid comparison. No LLM calls occur in unit tests or CI.
import {readFile,mkdir,writeFile}from 'node:fs/promises';
const root=new URL('./',import.meta.url),data=JSON.parse(await readFile(new URL('benchmark/cases.json',root),'utf8'));
const base=process.env.AI_LAB_URL??'http://127.0.0.1:3001';if(!['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname))throw new Error('Use a local backend');
const runs=[];
for(const version of (process.env.BENCHMARK_VERSIONS??'world-lens-extraction/1.1.0,world-lens-extraction/1.2.1').split(','))for(const fixture of data.cases){
 const response=await fetch(base+'/api/articles/process',{method:'POST',headers:{'Content-Type':'application/json','X-World-Lens-Client':'ai-lab',...(process.env.ADMIN_API_TOKEN?{Authorization:'Bearer '+process.env.ADMIN_API_TOKEN}:{})},body:JSON.stringify({...fixture.article,promptVersion:version})});
 const output=await response.json();runs.push({caseId:fixture.id,promptVersion:version,httpStatus:response.status,input:fixture.article,expected:fixture.expected,output});
 console.log(JSON.stringify({caseId:fixture.id,version,status:output.processingStatus,claims:output.claims?.length,canonicalIds:output.canonicalEventIds,error:output.error,cost:output.usage?.estimatedCostUsd}));
 if(output.error&&/BUDGET|USAGE_UNCERTAIN|PRICING|PROVIDER_HTTP_401/.test(output.error))break;
}
const directory=new URL('../work/benchmark45/',import.meta.url);await mkdir(directory,{recursive:true});let previous=[];try{previous=JSON.parse(await readFile(new URL('live-runs.json',directory),'utf8')).runs;}catch{};const seen=new Set(previous.map(r=>r.caseId+':'+r.promptVersion));await writeFile(new URL('live-runs.json',directory),JSON.stringify({evaluatedAt:new Date().toISOString(),datasetVersion:data.version,runs:[...previous,...runs.filter(r=>!seen.has(r.caseId+':'+r.promptVersion))]},null,2));
