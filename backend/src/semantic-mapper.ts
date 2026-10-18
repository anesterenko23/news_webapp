import { randomUUID } from 'node:crypto';
import { SemanticEvent, type SemanticEventType, SEMANTIC_VERSION } from './semantic-contract.js';
import { resolveCountry, isOrganization, ORGANIZATIONS } from './entities.js';
import { countryMetadata } from './countries.js';
import { anchorEvidence, type CheckResult } from './validation.js';
import type { Extracted } from './schemas.js';

export const SEMANTIC_VALIDATOR='world-lens-semantic-validation/4.7.0';
const key=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const nonActors=new Set(['observer','commentator','mentioned','unknown']);
const escaped=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function countryMention(code:string,text:string,name:string){
 const country=countryMetadata.find(c=>c.cca2===code);
 const extras:Record<string,string[]>={GB:['UK','Britain','British','United Kingdom'],US:['USA','U.S.','United States','American'],RU:['Russia','Russian'],UA:['Ukraine','Ukrainian'],DE:['Germany','German'],FR:['France','French'],JP:['Japan','Japanese'],CN:['China','Chinese']};
 return [name,country?.name.common,country?.name.official,...country?.altSpellings??[],...extras[code]??[]].filter((s):s is string=>!!s).some(s=>new RegExp('(?<![\\p{L}\\p{N}])'+escaped(s)+'(?![\\p{L}\\p{N}])','iu').test(text));
}
const actions:Record<string,RegExp>={conflict:/attack|strike|invad|fired|bomb|clash|атак|удар|вторг/i,sanctions:/sanction|asset freeze|travel ban|санкц/i,military_aid:/military aid|military support|weapons|ammunition|missile|военн.{0,15}помощ|оруж/i,humanitarian_aid:/humanitarian|medical supplies|food supplies|relief|гуманитар/i,diplomacy:/meet|talk|discuss|consult|condemn|reject|negotiat|coordina|встреч|переговор|осуд/i,trade:/trade|export|import|tariff|торгов|экспорт|импорт/i,international_agreement:/agreement|treaty|sign|соглаш|договор|подпис/i,energy:/energy|oil|gas|энерг|нефт|газ/i,military_cooperation:/military|defen[cs]e|armed forces|военн|оборон/i,trade_restrictions:/ban|restrict|cap|tariff|огранич|запрет/i};
actions.diplomacy=/meet|\bmet\b|talk|discuss|consult|condemn|reject|negotiat|coordina|\basked\b|\burged\b|raised.{0,40}concern|встреч|переговор|осуд/i;
actions.other=/\b(cooperat|support|help|assist|meet|met|talk|trad|sign|agree|impos|sanction|attack|send|deliver|announc|commit|negotiat)\w*|сотруднич|помощ|встрет|подпис/i;
actions.unknown=actions.other;
type Resolved={name:string;type:string;role:string;countryCode:string|null;identifier:string|null;resolution:'resolved'|'unresolved'};
export interface SemanticCheck extends CheckResult {semantic:{contractVersion:string;participants:Resolved[];relationships:SemanticEventType['relationships'];reason:SemanticEventType['reason'];reasonSupport:'NotAssessed'|'NeedsReview';suppressedRelationships:{relationship:SemanticEventType['relationships'][number];reason:string}[];technicalSchema:'Valid'|'Invalid'}}
export function mapSemanticEvent(raw:unknown,original:string):SemanticCheck {
 const parsed=SemanticEvent.safeParse(raw);
 const result:SemanticCheck={validatorVersion:SEMANTIC_VALIDATOR,status:'Valid',quoteMatch:'NotAssessed',referenceIntegrity:'Valid',semanticSupport:'NotAssessed',sourceVerification:'NotAssessed',errors:[],warnings:[{code:'INDEPENDENT_VERIFICATION_REQUIRED',message:'Semantic extraction and evidence matching do not independently verify the source.'}],value:null,evidence:[],semantic:{contractVersion:SEMANTIC_VERSION,participants:[],relationships:[],reason:null,reasonSupport:'NotAssessed',suppressedRelationships:[],technicalSchema:parsed.success?'Valid':'Invalid'}};
 if(!parsed.success){result.status='Invalid';result.errors=parsed.error.issues.map(i=>({code:'INVALID_SCHEMA',message:i.path.join('.')+': '+i.message}));return result;}
 const event=parsed.data;
 const review=(code:string,message:string)=>{result.status='NeedsRepair';result.warnings.push({code,message});};
 const resolved:Resolved[]=event.participants.map(p=>{
  const knownOrg=isOrganization(p.name),country=knownOrg?undefined:resolveCountry(p.name);
  // Never let a model-supplied type override a known organization or resolve a
  // person/company/city into its surrounding country.
  const code=!['individual','company','geographic_location','unspecified_group'].includes(p.type)?country:undefined;
  const type=knownOrg?'international_organization':code?'country':p.type==='country'?'unknown':p.type;
  const identifier=knownOrg?Object.keys(ORGANIZATIONS).find(id=>key(id)===key(p.name)||key(ORGANIZATIONS[id])===key(p.name))??null:code??null;
  if(knownOrg&&p.type!=='international_organization')result.warnings.push({code:'MODEL_NOTE',message:`${p.name} resolved as organization, never ISO country.`});
  if(!code&&!knownOrg&&['country','unknown','international_organization'].includes(p.type))review('INVALID_ENTITY',`Unresolved participant preserved: ${p.name}`);
  if(code==='GE'&&/\bGeorgia\b/i.test(p.name)&&!/Tbilisi|Caucasus|Republic of Georgia|country of Georgia|Georgian government/i.test(original))review('AMBIGUOUS_ACTOR','Georgia needs country/state disambiguation.');
  return {...p,type,countryCode:code??null,identifier,resolution:code||knownOrg||!['unknown','country','international_organization'].includes(p.type)?'resolved':'unresolved'};
 });
 result.semantic.participants=resolved;result.semantic.relationships=event.relationships;result.semantic.reason=event.reason;
 const participants=new Map<string,Resolved>();for(const p of resolved){if(participants.has(key(p.name)))review('INVALID_ENTITY','Duplicate participant name: '+p.name);participants.set(key(p.name),p);}
 const eid=randomUUID();
 const evidence=event.evidence?anchorEvidence(event.evidence,original):null;
 if(!evidence||evidence.startOffset<0){result.quoteMatch=event.evidence?'Mismatch':'NotAssessed';review('MISSING_EVIDENCE','Source retained; evidence was not matched. Event requires review, not factual refutation.');}
 else {result.quoteMatch='Matched';const {aligned,...span}=evidence;result.evidence.push({temporaryId:eid,kind:'action',...span,quoteMatch:'Matched'});}
 const local=event.evidence??'';
 const statement=event.title+' '+event.summary+' '+local;
 const edges:Extracted['relationships']=[];
 const suppressed=result.semantic.suppressedRelationships;
 const nonCountryTarget=resolved.some(p=>p.type!=='country'&&['target','recipient'].includes(p.role));
 const pairs=new Set<string>();
 for(const link of event.relationships){
  const from=participants.get(key(link.from)),to=participants.get(key(link.to));
  let reason='';
  if(!from||!to)reason='Endpoint does not match a listed participant';
  else if(link.direction==='unknown')reason='Direction is unknown; no direction guessed';
  else if(!from.countryCode||!to.countryCode){
   // Organization/person edges remain available in semantic metadata, without
   // being expanded into country arcs.
   suppressed.push({relationship:link,reason:'Non-country or unresolved endpoint; retained as semantic relationship'});continue;
  }
  else if(from.countryCode===to.countryCode)reason='No international self-link';
  else if(nonActors.has(from.role)||nonActors.has(to.role))reason='Context/commentator/unknown participant is not an action actor';
  else if(result.quoteMatch!=='Matched')reason='No matched evidence for a globe arc';
  else if(!countryMention(from.countryCode!,original,from.name)||!countryMention(to.countryCode!,original,to.name))reason='Participant attribution is absent from the source; names are retained for review';
  else if(/\bbecause\b|\bin response to\b|\bdue to\b|из-за|в ответ на/i.test(local)&&!countryMention(to.countryCode!,local.split(/\bbecause\b|\bin response to\b|\bdue to\b|из-за|в ответ на/i)[0],to.name))reason='Country appears as causal background, not the action target';
  else if(nonCountryTarget&&['sanctions','military_aid','humanitarian_aid'].includes(link.type))reason='Personal/company target must not be expanded to a whole-country target';
  else if(actions[link.type]&&!actions[link.type].test(local))reason='Evidence lacks an interaction cue for the relationship type';
  else if(link.type==='conflict'&&(/condemn|denounc|осуд|засуд/i.test(event.title)||event.eventType!=='conflict'))reason='Condemnation/commentary is not a conflict initiated by the speaker';
  else if(link.direction==='bidirectional'&&['sanctions','military_aid','humanitarian_aid','trade_restrictions'].includes(link.type))reason='Unilateral aid/coercion cannot become a mutual arc';
  else if(link.direction==='bidirectional'&&[from.role,to.role].some(r=>r!=='partner'))reason='Mutual country relationship requires partner roles';
  if(reason){suppressed.push({relationship:link,reason});review('UNSUPPORTED_RELATIONSHIP',reason);continue;}
  if(!from?.countryCode||!to?.countryCode)continue;
  const pair=(link.direction==='bidirectional'?[from.countryCode,to.countryCode].sort():[from.countryCode,to.countryCode]).join(':')+':'+link.type;
  if(pairs.has(pair)){result.warnings.push({code:'MODEL_NOTE',message:'Duplicate relationship omitted'});continue;}pairs.add(pair);
  edges.push({source_country:from.countryCode,target_country:to.countryCode,type:link.type,direction:link.direction as 'directed'|'bidirectional',evidence_ids:[eid],confidence:0});
 }
 const actors=resolved.filter(p=>p.countryCode&&!nonActors.has(p.role));
 if(actors.length>2&&edges.length===actors.length*(actors.length-1)/2&&edges.every(e=>e.direction==='bidirectional')){for(const link of event.relationships)suppressed.push({relationship:link,reason:'Unsubstantiated multilateral clique'});edges.length=0;review('UNSUPPORTED_RELATIONSHIP','Collective event must not become an all-to-all country graph.');}
 if(event.status==='completed'&&/\b(will meet|plans? to|will offer|will deploy|is preparing to|reportedly)\b|планирует|запланир/i.test(local))review('MODALITY_CONFLICT','Completed classification conflicts with source modality; no automatic status correction.');
 if(event.reason){result.semantic.reasonSupport='NeedsReview';result.warnings.push({code:'MODEL_NOTE',message:'Reason attribution retained; causal support requires review and is not independently established.'});}
 if(/condolences|соболезн/i.test(statement)&&event.eventType==='humanitarian_aid')review('UNSUPPORTED_RELATIONSHIP','Condolences are not humanitarian aid.');
 const countries=new Map<string,Extracted['countries'][number]>();
 for(const p of resolved)if(p.countryCode){const prev=countries.get(p.countryCode);if(prev&&prev.role!==p.role)review('AMBIGUOUS_ACTOR','Conflicting aliases/roles for '+p.countryCode);else countries.set(p.countryCode,{code:p.countryCode,role:p.role as Extracted['countries'][number]['role'],attribution_evidence_ids:result.evidence.length?[eid]:[]});}
 const internal:Extracted={title:event.title,summary:event.summary,event_type:event.eventType,event_status:event.status,action_text:evidence?.startOffset!==undefined&&evidence.startOffset>=0?evidence.text:event.summary,object_text:null,occurred_at:null,countries:[...countries.values()],entities:resolved.filter(p=>p.type!=='country').map(p=>({type:p.type as Extracted['entities'][number]['type'],name:p.name,identifier:p.identifier,country_code:null,role:p.role as Extracted['entities'][number]['role'],evidence_ids:result.evidence.length?[eid]:[]})),relationships:edges,evidence:result.evidence.length?[{id:eid,text:result.evidence[0].text,kind:'action'}]:[],confidence:0};
 result.value=internal;
 return result;
}
