window._actionListeners = window._actionListeners || [];

window.onAction = function (callback) {
  window._actionListeners.push(callback);
};

window.emitAction = function (action) {
  // 🛡️ メタマスクなどの無関係なメッセージを除外
  if (!action || !action.type) return; 

  console.log("🔥 Action emitted:", action);

  window._actionListeners.forEach(fn => fn(action));

  const room2Frame = document.getElementById("room2Frame");
  if (room2Frame && room2Frame.contentWindow) {
    room2Frame.contentWindow.postMessage(action, "*");
  }
};
