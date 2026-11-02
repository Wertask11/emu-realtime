'use strict';
// No database dependency: retirement must never mutate historical days/rewards.
function ichinichiRetired(_req,res) {
 return res.status(410).json({error:'FEATURE_RETIRED',feature:'ichinichi',next:'/?view=practice',dataRetained:true});
}
module.exports={ichinichiRetired};
