if (parent !== window)
  document
    .querySelectorAll(
      'a[href="/"],a[href^="/?lab="],a[href="/knowledge-lab-writers.html"]',
    )
    .forEach((a) => (a.target = "_top"));
// Read-only launch status; do not advertise registration as live during a hold.
fetch("/api/knowledge-lab/config")
  .then((r) => (r.ok ? r.json() : { enabled: false }))
  .then((config) => {
    if (config.enabled) return;
    const status = document.getElementById("availability");
    if (status)
      status.textContent =
        "現在、公開準備中です。登録・投稿の利用開始は正式な公開後となります。";
    document.querySelectorAll("a.primary").forEach((a) => {
      a.href = "/knowledge-lab.html";
      a.textContent = "公開状況を確認する";
    });
  })
  .catch(() => {
    const status = document.getElementById("availability");
    if (status)
      status.textContent =
        "公開状況を確認できませんでした。登録・投稿の利用可否はLab画面で確認してください。";
  });
