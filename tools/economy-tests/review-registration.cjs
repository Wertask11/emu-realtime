'use strict';
// Pure configuration builder. No credentials, network, DB write or automatic consent.
const {hash}=require('../../backend/economy/config');
const {PURPOSE}=require('../../backend/economy/search/profile');
const {assertRow}=require('../../backend/economy/search/contracts');
function approval(source,review,{now,validUntilMs,consentEvidence}={}) {
  if(!Number.isSafeInteger(now)||!Number.isSafeInteger(validUntilMs)||validUntilMs<=now)throw Error('REVIEW_EXPIRED');
  if(!source||!review||!['A','B'].includes(review.category)||review.sourceKey!==source.key||review.contentHash!==hash([source.title,source.summary])||review.originHash!==(source.originHash||null)||review.piiReviewed!==true||!review.basis?.length||!review.evidenceRef?.length)throw Error('REVIEW_NOT_CONFIRMED');
  if(review.category==='A'&&!['service','emuer','passport','activities'].includes(source.domain))throw Error('OWNERSHIP_NOT_CONFIRMED');
  if(review.category==='A'&&review.evidenceRef!=='PR297-original-system-facts-20261107')throw Error('OWNERSHIP_NOT_CONFIRMED');
  if(review.category==='B'&&(source.domain!=='knowledge_lab'||source.permission?.authorAIConsent!==true||consentEvidence?.allowed!==true||consentEvidence.version!==1||consentEvidence.actorMatchesAuthor!==true||!(consentEvidence.atMs>0&&consentEvidence.atMs<=now)||review.consentVersion!==consentEvidence.version||review.consentAtMs!==consentEvidence.atMs))throw Error('AUTHOR_CONSENT_NOT_CONFIRMED');
  assertRow({...source,permission:{...source.permission,operatorReviewed:true}});
  return {purpose:PURPOSE,piiReviewed:true,aiUseApproved:true,rightsVerified:true,contentHash:review.contentHash,...(source.originHash?{originHash:source.originHash}:{}),validUntilMs,reviewedAtMs:now,reviewCategory:review.category,reviewBasis:review.basis,evidenceRef:review.evidenceRef,...(review.category==='B'?{authorConsentVersion:consentEvidence.version,authorConsentAtMs:consentEvidence.atMs}:{}),authorizationRef:'founder-cross-activation-20261107'};
}
module.exports={approval};
