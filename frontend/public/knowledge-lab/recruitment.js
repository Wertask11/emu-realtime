(() => {
  "use strict";
  const button = document.getElementById("shareWriters"),
    status = document.getElementById("shareStatus");
  if (!button) return;
  button.addEventListener("click", async () => {
    try {
      const url = new URL("/knowledge-lab-writers.html", location.origin).href;
      if (navigator.share)
        await navigator.share({
          title: "あなたの経験を、誰かの知識へ。Emu Knowledge Lab",
          url,
        });
      else {
        await navigator.clipboard.writeText(url);
        status.textContent = "募集ページのURLをコピーしました。";
      }
    } catch (error) {
      if (error.name !== "AbortError")
        status.textContent =
          "共有できませんでした。ブラウザのアドレスからURLをコピーできます。";
    }
  });
})();
