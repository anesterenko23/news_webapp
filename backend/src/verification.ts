export interface SourceAssessment {status:'NotAssessed'|'Unverified'|'Corroborated'|'Verified'|'Disputed'|'Refuted';assessor:string;method:string;independence:'Unknown'|'Dependent'|'Independent';evidence:string[];reason:string}
export interface IndependentSourceVerifier {assess(input:{claimId:string;articleIds:string[];lineageIds:string[]}):Promise<SourceAssessment>}
export const notAssessedVerifier:IndependentSourceVerifier={async assess(){return {status:'NotAssessed',assessor:'system:no-independent-verifier',method:'none',independence:'Unknown',evidence:[],reason:'No independent source verification has been performed'};}};
export function publicationPolicy(validation:'Valid'|'Invalid'|'NeedsRepair',verification:SourceAssessment['status']='NotAssessed'){
 return {validationStatus:validation,verificationStatus:validation==='Valid'?(verification==='NotAssessed'?'Unverified':verification):'NotAssessed',publicationStatus:validation==='Invalid'?'Blocked':verification==='Refuted'?'Blocked':'NeedsReview'};
}
// Compatibility helper: a duplicate or confidence value never establishes verification.
export function publicationDecision(rejected:boolean,_duplicates:{eventId:string}[]){return {...publicationPolicy(rejected?'Invalid':'Valid'),reason:rejected?'Technical validation failed; factual verification has not been assessed':'Independent verification and review required'};}
