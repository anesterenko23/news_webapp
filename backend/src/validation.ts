import { ExtractedEvent, type Extracted, type ArticleInputType } from './schemas.js';
import { anchorEvidence } from './validation-v1.js';
import { isOrganization,resolveCountry } from './entities.js';
export { anchorEvidence };
export const VALIDATOR_VERSION='world-lens-validation/4.5.1';
export interface Reason {code:string;message:string;path?:string}
export interface CheckResult {
 validatorVersion:string;status:'Valid'|'Invalid'|'NeedsRepair'; quoteMatch:'Matched'|'Mismatch'|'NotAssessed';referenceIntegrity:'Valid'|'Invalid'|'NotAssessed';semanticSupport:'NotAssessed'|'Unsupported'|'Ambiguous';sourceVerification:'NotAssessed';
 errors:Reason[];warnings:Reason[];value:Extracted|null;evidence:{temporaryId:string;text:string;kind:string;startOffset:number;endOffset:number;quoteMatch:string}[];
}
export function validateClaim(raw:unknown,original:string,globalIds?:Map<string,number>):CheckResult {
 const parsed=ExtractedEvent.safeParse(raw);
 const result:CheckResult={validatorVersion:VALIDATOR_VERSION,status:'Valid',quoteMatch:'Matched',referenceIntegrity:'Valid',semanticSupport:'NotAssessed',sourceVerification:'NotAssessed',errors:[],warnings:[],value:parsed.success?parsed.data:null,evidence:[]};
 const fail=(code:string,message:string,repair=false)=>{result.errors.push({code,message});result.status=repair&&result.status!=='Invalid'?'NeedsRepair':'Invalid';};
 if(!parsed.success){result.status='Invalid';result.quoteMatch='NotAssessed';result.referenceIntegrity='NotAssessed';result.errors=parsed.error.issues.map(issue=>({code:issue.path.includes('code')||issue.path.includes('source_country')||issue.path.includes('target_country')?'INVALID_COUNTRY':issue.path.includes('evidence_ids')?'INVALID_EVIDENCE_REFERENCE':'INVALID_SCHEMA',path:issue.path.join('.'),message:issue.message}));return result;}
 const event=parsed.data, ids=new Set<string>();
 for(const evidence of event.evidence){
  if(ids.has(evidence.id)||(globalIds?.get(evidence.id)??1)>1)fail('DUPLICATE_EVIDENCE_ID',`Duplicate temporary evidence ID ${evidence.id}`);ids.add(evidence.id);
  const {aligned,...anchored}=anchorEvidence(evidence.text,original);
  if(anchored.startOffset<0){fail('QUOTE_MISMATCH',`Evidence ${evidence.id} is absent from the original article`);result.quoteMatch='Mismatch';}
  if(aligned)result.warnings.push({code:'MODEL_NOTE',message:`Whitespace aligned for ${evidence.id}; raw model output retained`});
  result.evidence.push({temporaryId:evidence.id,kind:evidence.kind,...anchored,quoteMatch:anchored.startOffset<0?'Mismatch':'Matched'});
 }
 const refs=(values:string[],label:string)=>{for(const id of values)if(!ids.has(id)){fail('INVALID_EVIDENCE_REFERENCE',`${label} cites missing/foreign evidence ${id}`,true);result.referenceIntegrity='Invalid';}};
 const participants=new Map(event.countries.map(c=>[c.code,c.role]));
 if(participants.has('GE')&&/\bGeorgia\b/i.test(original)&&!/\b(Tbilisi|Caucasus|Republic of Georgia|country of Georgia|Georgian government)\b/i.test(original)){
  fail('AMBIGUOUS_ACTOR','Georgia may denote a country or a US state; explicit geographic disambiguation or review is required',true);result.semanticSupport='Ambiguous';
 }
 if(participants.size!==event.countries.length)fail('INVALID_ENTITY','Duplicate country participant');
 for(const country of event.countries){refs(country.attribution_evidence_ids,`Country ${country.code}`);if(!country.attribution_evidence_ids.length)fail('UNRESOLVED_REFERENCE',`Missing attribution evidence for ${country.code}`,true);}
 for(const entity of event.entities){
  refs(entity.evidence_ids,`Entity ${entity.name}`);
  if(entity.type!=='country'&&entity.country_code!==null)fail('INVALID_ENTITY','Non-country entity must not carry an ISO country code');
  if(entity.type==='country'&&(!entity.country_code||!participants.has(entity.country_code)||isOrganization(entity.name)||isOrganization(entity.identifier??'')))fail('INVALID_ENTITY','Organization/unknown entity cannot resolve to a country');
  if(entity.type==='country'&&resolveCountry(entity.name)!==entity.country_code)fail('INVALID_ENTITY','Country name/alias does not resolve to the supplied ISO code');
  if(isOrganization(entity.identifier??entity.name)&&entity.type!=='international_organization')fail('INVALID_ENTITY','Known international organization has an incompatible entity type');
  if(entity.type==='unspecified_group'&&entity.identifier!==null)fail('AMBIGUOUS_ACTOR','Unspecified group must not be assigned a concrete identifier');
 }
 if(anchorEvidence(event.action_text,original).startOffset<0)fail('QUOTE_MISMATCH','Precise action_text is not a contiguous source clause');
 if(event.object_text&&anchorEvidence(event.object_text,original).startOffset<0)fail('QUOTE_MISMATCH','object_text is not present in the original article');
 const pairs=new Set<string>();
 for(const link of event.relationships){
  refs(link.evidence_ids,'Relationship');
  const endpoints=[link.source_country,link.target_country];
  if(endpoints[0]===endpoints[1]||endpoints.some(code=>!participants.has(code)))fail('INVALID_DIRECTION','Relationship requires two distinct listed countries');
  if(endpoints.some(code=>['observer','commentator','mentioned'].includes(participants.get(code)??''))){fail('UNSUPPORTED_RELATIONSHIP','Observer/commentator/context-only country is not a relationship actor');result.semanticSupport='Unsupported';}
  if(link.direction==='bidirectional'&&endpoints.some(code=>participants.get(code)==='initiator'))fail('INVALID_DIRECTION','Mutual agreement requires partner roles, not duplicated unilateral initiators',true);
  if(link.direction==='bidirectional'&&['military_aid','sanctions','humanitarian_aid','trade_restrictions'].includes(link.type)&&endpoints.some(code=>['target','sender','recipient'].includes(participants.get(code)??'')))fail('INVALID_DIRECTION','Unilateral action is marked bilateral');
  const key=(link.direction==='bidirectional'?[...endpoints].sort():endpoints).join(':')+':'+link.type+':'+link.direction;
  if(pairs.has(key))fail('UNSUPPORTED_RELATIONSHIP','Duplicate relationship');pairs.add(key);
 }
 const actors=event.countries.filter(c=>!['observer','commentator','mentioned'].includes(c.role)).length;
 if(actors>2&&pairs.size===actors*(actors-1)/2&&new Set(event.relationships.map(r=>r.evidence_ids.join(','))).size===1)fail('UNSUPPORTED_RELATIONSHIP','Multilateral clique lacks distinct pair evidence');
 const modality:Record<string,RegExp>={planned:/\b(plan\w*|intend\w*|will|set to)\b|план|намерен/i,proposed:/\b(propos\w*|suggest\w*)\b|предлож/i,alleged:/\b(alleg\w*|reportedly|claim\w*)\b|предполож|утвержда/i,denied:/\b(den\w*|reject\w*)\b|отриц/i,speculative:/\b(may|might|could|speculat\w*)\b|возмож|может/i};
 if(modality[event.event_status]&&!modality[event.event_status].test(event.title))fail('MODALITY_CONFLICT','Title does not preserve the event modality',true);
 if(event.event_status==='completed'&&/\b(plans? to|might|proposed|denied|allegedly)\b/i.test(event.action_text))fail('MODALITY_CONFLICT','Completed status contradicts action evidence',true);
 result.warnings.push({code:'INDEPENDENT_VERIFICATION_REQUIRED',message:'QuoteMatch and reference integrity do not establish semantic support, source reliability or independent verification'});
 return result;
}
export function coverageDiagnostics(input:Pick<ArticleInputType,'content'>,events:Extracted[]):Reason[]{
 const warnings:Reason[]=[];
 const attack=/(?:Russian attacks? on Kyiv|Russia attacked Ukraine)[^\n.!?]*/i.exec(input.content);
 if(attack&&!events.some(e=>e.event_type==='conflict'&&e.countries.some(c=>c.code==='RU')&&e.countries.some(c=>c.code==='UA')))warnings.push({code:'MISSED_ACTION',message:`Potential separate conflict action not extracted: ${attack[0]}. Review timing and actor attribution; no extra attack has been created.`});
 return warnings;
}
export function legacyToCurrent(raw:Record<string,unknown>,ordinal:number){
 const e=raw as any;const prefix=`legacy-${ordinal}-`;
 const evidence=(Array.isArray(e.evidence)?e.evidence:[]).map((q:any,i:number)=>({id:prefix+i,text:q.text,kind:'action'}));
 return {...e,action_text:evidence[0]?.text??'',object_text:null,entities:[],countries:(e.countries??[]).map((c:any)=>({...c,attribution_evidence_ids:evidence.map((q:any)=>q.id)})),evidence,relationships:(e.relationships??[]).map(({evidence_refs,...link}:any)=>({...link,evidence_ids:(evidence_refs??[]).map((index:number)=>prefix+index)}))};
}
