// actionSchema.js
window.createAction = function ({
  userId,
  type,
  targetId = null,
  projectId = null,
  value = null
}) {
  return {
    id: Date.now() + Math.random(),
    userId,
    type, // "post" | "nft_buy" | "good" | "change" | "discussion"
    targetId,
    projectId,
    value,
    createdAt: Date.now()
  };
};