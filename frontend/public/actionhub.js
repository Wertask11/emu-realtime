// actionHub.js
window.emitAction = function (action) {
  console.log("🔥 Action emitted:", action);

  // Room2（星座）に通知
  if (window.handleAction) {
    window.handleAction(action);
  }

  // 将来ここに追加
  // socket.emit("action", action)
  // saveToDB(action)
};

// ===== ActionHub core =====
window.actions = [];

window.onAction = function (callback) {
  window._actionListeners = window._actionListeners || [];
  window._actionListeners.push(callback);
};

window.emitAction = function (action) {
  console.log("🔥 Action emitted:", action);

  // ① actions に蓄積
  window.actions.push(action);

  // ② 登録された全 listener に通知
  if (window._actionListeners) {
    window._actionListeners.forEach(fn => fn(action));
  }
};