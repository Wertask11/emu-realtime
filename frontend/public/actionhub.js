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