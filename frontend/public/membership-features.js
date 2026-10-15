/* Public comparison uses the same server policy as capacity enforcement. */
(() => {
  const roots = document.querySelectorAll("[data-membership-features]");
  if (!roots.length) return;
  const esc = (v) =>
    String(v).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const number = (n) =>
    n >= 1000000 ? "件数制限なし※" : n.toLocaleString("ja-JP") + "件";
  fetch("/api/billing/features")
    .then(async (r) => {
      if (!r.ok) throw new Error("UNAVAILABLE");
      const data = await r.json();
      const rows = [
        ["役割", (p) => p.role],
        [
          "公開知識を読む・探す",
          (p) => (p.key === "guest" ? "新着20件" : "公開知識全体"),
        ],
        ["公開投稿／月", (p) => number(p.post)],
        ["経験者への質問募集／月", (p) => number(p.request)],
        ["募集への回答／月", (p) => number(p.answer)],
        [
          "一日シェアの記録",
          (p) =>
            p.ichinichi === 31 ? "毎日" : p.ichinichi ? "月7日" : "閲覧のみ",
        ],
        ["議論で発言", (p) => (p.key === "guest" ? "対象外" : "利用可能")],
        ["議論を立てる／月", (p) => number(p.discussion)],
        ...[
          ["保存した知識", "saved"],
          ["下書き・自分用の経験知", "drafts"],
          ["研究ノート（保管中を含む）", "notes"],
        ].map(([label, key]) => [
          label,
          (p) =>
            number(p.storage[key]) +
            (!data.retainedLimitsActive &&
            p.storage[key] !== p.announcedStorage[key]
              ? " → 11月1日から" + number(p.announcedStorage[key])
              : ""),
        ]),
        ["研究の編集・履歴・保管復元", () => "自分の記録で利用可能"],
        ["AI分析・意味検索", () => "共通の無料枠内。利用保証なし"],
        ["書き手プロフィール", () => "登録可能。公開投稿は利用資格が必要"],
        ["月次の学びの記録", p => ["plus", "pro"].includes(p.key) ? "利用可能" : "対象外"],
        ["Passport・星空", () => "共通。実際の活動を記録"],
        [
          "人との対話・初月返金保証",
          (p) =>
            p.dialogue ? "30日で最低4回の機会。保証は規定条件あり" : "対象外",
        ],
      ];
      const html = `<p><strong>価格は税込月額。プランの変更で既存記録を削除しません。</strong></p><div style="overflow-x:auto"><table><caption>SchoolPark・Emuのプラン別利用範囲</caption><thead><tr><th scope="col">できること</th>${data.plans.map((p) => `<th scope="col">${p.key === "guest" ? "無料・見学" : esc(p.key)}<br>${esc(p.amount.toLocaleString("ja-JP"))}円</th>`).join("")}</tr></thead><tbody>${rows.map(([label, f]) => `<tr><th scope="row">${esc(label)}</th>${data.plans.map((p) => `<td>${esc(f(p))}</td>`).join("")}</tr>`).join("")}</tbody></table></div><p>11月1日0時（日本時間）から月間枠を暦月へ統一します。支払更新日は変えません。切り替え時の既存契約の未使用枠は、11月分へ一度だけ引き継ぎます。</p><p>保存・研究の新上限は11月1日からです。上限を超える既存記録も閲覧・編集・保管復元できます。保存解除で保存枠が戻ります。研究ノートは保管しても数に含まれます。※自動投稿・不正利用の制限はあります。</p><p>AIは作者の同意済み公開知識と送信確認が必要です。分析はPassportごと1日3回・全体1日10回などの共通上限があり、有料プランでも実行を保証しません。無料枠を超えて自動課金しません。</p>`;
      roots.forEach((root) => {
        const cards = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px">${data.plans.map(p => `<article data-plan-card="${esc(p.key)}" style="border:1px solid #e3d7c7;border-radius:12px;padding:14px;background:#fffaf3"><h3 style="margin:0">${p.key === "guest" ? "無料・見学" : esc(p.key)}</h3><strong>${esc(p.amount.toLocaleString("ja-JP"))}円${p.amount ? " / 月" : ""}</strong><p>${esc(p.role)}</p><p>${p.post ? "投稿 " + esc(number(p.post)) + " / 月" : "読む・研究を少し試す"}</p><small>${!data.retainedLimitsActive ? "11月1日から" : "保有枠"}：保存${esc(p.announcedStorage.saved)}・下書き${esc(p.announcedStorage.drafts)}・研究${esc(p.announcedStorage.notes)}件</small>${p.dialogue ? "<p>対話の機会：30日で最低4回<br><small>保証は規定条件あり</small></p>" : ""}</article>`).join("")}</div>`;
        root.innerHTML = cards + html.replace('<div style="overflow-x:auto">', '<details style="margin-top:20px"><summary style="cursor:pointer;min-height:44px">機能を詳しく比較する（表は横にスクロールできます）</summary><div style="overflow-x:auto">').replace('</table></div>', '</table></div></details>');
        root.dataset.loaded = "true";
      });
    })
    .catch(() =>
      roots.forEach((root) => {
        root.textContent =
          "利用範囲を取得できませんでした。再読み込みしてご確認ください。購入は最新の条件を確認してからお進みください。";
      }),
    );
})();
