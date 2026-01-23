// actionSchema.js
window.createAction = function ({
  userId,
  type,
  targetId = null,
  projectId = null,
  value = null
}) {
  return {
    id: crypto.randomUUID(),
    userId,
    type, // "post" | "nft_buy" | "good" | "change" | "discussion"
    targetId,
    projectId,
    value,
    createdAt: Date.now()
  };
};