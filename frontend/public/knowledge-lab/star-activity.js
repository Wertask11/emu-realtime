/* Separate, authenticated Lab activity history. Existing stars/NFT counts are untouched. */
(() => {
  "use strict";
  window.addEventListener("message", (event) => {
    if (
      event.origin === location.origin &&
      event.source === parent &&
      event.data?.type === "EMU_LAB_ACTIVITY_CLEAR"
    ) {
      document.getElementById("knowledgeLabActivity")?.remove();
      return;
    }
    if (
      event.origin !== location.origin ||
      event.source !== parent ||
      event.data?.type !== "EMU_LAB_ACTIVITY"
    )
      return;
    const data = event.data.data;
    if (!data?.counts || typeof data.schoolParkId !== "string") return;
    let panel = document.getElementById("knowledgeLabActivity");
    if (!panel) {
      panel = document.createElement("details");
      panel.id = "knowledgeLabActivity";
      panel.style.cssText =
        "position:fixed;left:12px;bottom:16px;z-index:120;max-width:calc(100vw - 24px);max-height:35vh;overflow:auto;background:#101827;color:#f1f5f9;padding:12px;border:1px solid #64748b;border-radius:10px;font:14px sans-serif";
      document.body.appendChild(panel);
    }
    panel.replaceChildren();
    const summary = document.createElement("summary");
    summary.textContent = "Knowledge Labでの活動";
    summary.style.cssText = "cursor:pointer;min-height:32px";
    panel.appendChild(summary);
    for (const value of Object.values(data.counts)) {
      if (
        typeof value?.label !== "string" ||
        !Number.isInteger(value.count) ||
        value.count < 0
      )
        continue;
      const line = document.createElement("p");
      line.textContent = value.label + "：" + value.count;
      panel.appendChild(line);
    }
    const note = document.createElement("p");
    note.textContent =
      "本人専用の活動履歴です。保管後も記録は残ります。星・NFT・EMUERの追加発行ではありません。";
    note.style.maxWidth = "280px";
    panel.appendChild(note);
  });
})();
