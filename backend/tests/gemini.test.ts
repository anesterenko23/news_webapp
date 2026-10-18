import {describe,it,expect}from 'vitest';
import {readFileSync}from 'node:fs';
import {geminiJsonSchema}from '../src/gemini-schema.js';
import {outputJsonSchema,Extraction}from '../src/schemas.js';
import {validateClaim}from '../src/validation.js';
const saved=JSON.parse(readFileSync(new URL('./regressions/gemini-key2.json',import.meta.url),'utf8'));
describe('Gemini schema boundary and saved real replies',()=>{
 it('preserves required fields, nullable union and datetime while leaving the strict source schema intact',()=>{
  const before=JSON.stringify(outputJsonSchema);const wire=geminiJsonSchema(outputJsonSchema) as any;const event=wire.properties.events.items;
  expect(event.required).toContain('occurred_at');expect(event.properties.entities.items.required).toContain('identifier');expect(event.properties.occurred_at.type).toEqual(['string','null']);expect(event.properties.occurred_at.format).toBe('date-time');expect(JSON.stringify(outputJsonSchema)).toBe(before);
 });
 it('accepts Google nullable syntax without weakening the server ISO, size or entity contract',()=>{
  const wire=geminiJsonSchema({type:'object',properties:{nullable:{anyOf:[{type:'string',enum:['a']},{type:'null'}]}}}) as any;expect(wire.properties.nullable.enum).toEqual(['a',null]);
  const sample=JSON.parse(saved.cases[0].rawOutput);sample.events[0].countries[0].code='UN';expect(Extraction.safeParse(sample).success).toBe(false);sample.events[0].countries[0].code='GB';sample.events[0].title='x'.repeat(301);expect(Extraction.safeParse(sample).success).toBe(false);
 });
 for(const [index,record]of saved.cases.entries())it('replays real response '+index+' through unchanged evidence/entity rules',()=>{
  const result=JSON.parse(record.rawOutput);expect(Extraction.safeParse(result).success).toBe(true);const ids=new Map<string,number>();for(const event of result.events)for(const q of event.evidence)ids.set(q.id,(ids.get(q.id)??0)+1);
  const checks=result.events.map((event:unknown)=>validateClaim(event,record.input.title+'\n'+record.input.content,ids));expect(checks.map((c:any)=>c.status)).toEqual(record.expectedValidation);if(index===1){expect(checks[0].errors[0].code).toBe('INVALID_ENTITY');expect(checks[2].sourceVerification).toBe('NotAssessed');}
 });
});
