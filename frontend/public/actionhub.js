// actionhub.js をこれに差し替えてください
window._actionListeners = window._actionListeners || [];

window.onAction = function (callback) {
  window._actionListeners.push(callback);
};

window.emitAction = function (action) {
  console.log("🔥 Action emitted:", action);

  // ① 自身のリスナーに通知
  window._actionListeners.forEach(fn => fn(action));

  // ② もし自分が「親」なら、中の iframe (Room2) にも転送する
  const room2Frame = document.getElementById("room2Frame");
  if (room2Frame && room2Frame.contentWindow) {
    room2Frame.contentWindow.postMessage(action, "*");
  }
};
