'use strict';
function normAddress(value) { return String(value || '').trim().toLowerCase(); }
function uniqueActors(list, author) {
  return [...new Set((Array.isArray(list) ? list : []).map(normAddress).filter(x => /^0x[0-9a-f]{40}$/.test(x) && x !== author))];
}
function integerCount(value) {
  const n=Number(value || 0);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
/** Verify existing counters against unique actor lists. Mismatches require review and create no reward. */
function evaluatePost(id, data) {
  const author=normAddress(data && data.address), good=integerCount(data && data.goodCount), change=integerCount(data && data.changeCount);
  const goodActors=uniqueActors(data && data.goodUsers,author), changeActors=uniqueActors(data && data.changeUsers,author);
  const reasons=[];
  if (!id) reasons.push('missing-post-id');
  if (!/^0x[0-9a-f]{40}$/.test(author)) reasons.push('invalid-author');
  if (good === null || change === null) reasons.push('invalid-counter');
  if (good !== null && good !== goodActors.length) reasons.push('good-count-actors-mismatch');
  if (change !== null && change !== changeActors.length) reasons.push('change-count-actors-mismatch');
  return {postId:String(id||''),legacyAuthorAddress:author,goodCount:good,changeCount:change,
    goodUniqueActors:goodActors.length,changeUniqueActors:changeActors.length,
    rewardEmuer:reasons.length ? 0 : good+change,status:reasons.length?'review':'ready',reasons};
}
function summarize(rows) {
  return rows.reduce((a,r)=>{a.posts++;a[r.status]++;if(r.status==='ready')a.rewardEmuer+=r.rewardEmuer;return a},{posts:0,ready:0,review:0,rewardEmuer:0});
}
module.exports={evaluatePost,summarize};
