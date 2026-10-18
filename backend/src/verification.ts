export function publicationDecision(rejected: boolean, duplicates: {eventId:string}[]) {
  return {
    verificationStatus: rejected ? 'Rejected' : 'Unverified',
    publicationStatus: rejected ? 'Rejected' : 'NeedsReview',
    reason: rejected ? 'Structural or evidence contradiction' : duplicates.length ? 'Potential duplicate requires review; no automatic merge' : 'Single manually supplied source; independent corroboration and semantic evidence review required',
  };
}
