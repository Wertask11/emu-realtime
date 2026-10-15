        .forEach((input) => (input.checked = false));
    for (const selector of ["#searchFacets", "#excludeFacets"])
      $(selector).querySelectorAll(".facet-group").forEach(facetSelection);
    run(() => search());
  };
  bindAsync($("#moreResults"), () => search(true));
  bindAsync($("#shareSearch"), async () => {
    try {
      await navigator.clipboard.writeText(sharedURL().href);
      status("検索条件のURLをコピーしました。");
    } catch (_) {
      status("共有URL：" + sharedURL());
    }
  });
  const tour = window.ReizoTour;
  if (tour) {
    tour.register(
      "emu-lab",
      [
        {
          target: "lab-intro",
          label: "経験から、次の発見へ",
          text: "知識図書館で経験知を探し、研究所で異なる知識を比較できるよ。",
        },
        {
          target: "lab-tabs",
          label: "図書館と研究所",
          text: "分野から探すなら図書館。2〜3分野の知識から問いを考えるなら研究所へ。保存した記録はマイライブラリーに残るよ。",
        },
        {
          target: "lab-library",
          label: "まず、必要な知識へ",
          text: "キーワードや複数の分類から探してみよう。見るだけで投稿や保存は行われないよ。",
        },
      ],
      {
        label: "Knowledge Lab",
        brand: "Emu",
        isReady: () =>
          state.enabled && state.terms.length > 0 && state.view === "library",
        auto: window.parent === window,
      },
    );
    $("#guide").onclick = () => {
      const hostTour =
        window.parent !== window ? window.parent.ReizoTour : null;
      if (
        hostTour?.list?.().some((item) => item.id === "emu-knowledge-lab")
      ) {
        hostTour.start("emu-knowledge-lab", 0, $("#guide"));
        return;
      }
      run(async () => {
        await view("library");
        tour.restart("emu-lab");
      });
    };
  }
  window.addEventListener("message", (e) => {
    if (e.origin !== location.origin || e.source !== parent) return;
    if (e.data?.type === "emu-lab-feedback")
      status(e.data.message || "既存画面へ移動しました。");
  });
  async function init() {
    const initialParams = new URLSearchParams(location.search);