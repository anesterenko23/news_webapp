// Google accepts a subset of JSON Schema. This is only the generation wire schema.
// All outputs still pass the original strict Zod/ISO/evidence validator on the server.
const serverOnly=new Set(['$schema','minLength','maxLength','pattern','minItems','maxItems','minimum','maximum','additionalProperties']);
export function geminiJsonSchema(input:unknown):unknown {
 if(!input||typeof input!=='object'||Array.isArray(input))return input;
 const schema=input as Record<string,any>,out:Record<string,any>={};
 for(const [key,value]of Object.entries(schema)){
  if(serverOnly.has(key))continue;
  if(key==='properties'||key==='$defs'||key==='definitions')out[key]=Object.fromEntries(Object.entries(value as Record<string,unknown>).map(([name,child])=>[name,geminiJsonSchema(child)]));
  else if(['anyOf','oneOf','allOf','prefixItems'].includes(key)&&Array.isArray(value))out[key]=value.map(geminiJsonSchema);
  else if(key==='items')out[key]=geminiJsonSchema(value);
  else out[key]=value;
 }
 // Repeated 249-value country enums significantly increase schema complexity.
 if(Array.isArray(out.enum)&&out.enum.length>200&&out.enum.every((v:unknown)=>typeof v==='string'&&/^[A-Z]{2}$/.test(v))){delete out.enum;out.description='ISO 3166-1 alpha-2 country code. Validity is enforced by the server.';}
 if(Array.isArray(out.anyOf)&&out.anyOf.length===2&&out.anyOf.some((v:any)=>v.type==='null')){
  const other=out.anyOf.find((v:any)=>v.type!=='null');delete out.anyOf;Object.assign(out,other);out.type=[other.type,'null'];if(out.enum)out.enum=[...out.enum,null];
 }
 return out;
}
