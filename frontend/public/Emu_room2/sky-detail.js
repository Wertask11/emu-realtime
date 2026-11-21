/* スマホの星空：左下の「あなたの星座記録」と「Knowledge Labでの活動」を、1つの「詳細」ボタンにまとめる（11/21 オーナー）。

   スマホでは2つの札が左下に積み重なって、星空の下半分をふさいでいた。
   スマホのときだけ、左下に「詳細」のボタンを1つ置き、押したら2つをまとめた札（シート）を出す。もう一度押すと閉じる。
   札そのもの（#starInfo・#knowledgeLabActivity）は作り直さず、そのままシートの中へ移すだけ。
   中身を書き換えるのは今までどおり room2.js と /knowledge-lab/star-activity.js。
   パソコン（701px 以上）は、今までどおり左下に2つ並べる。 */
(function () {
  "use strict";
  const PHONE = window.matchMedia ? window.matchMedia("(max-width: 700px)") : { matches: false };
  let btn = null, sheet = null, open = false;

  function build() {
    btn = document.createElement("button");
    btn.type = "button";
    btn.id = "skyDetailToggle";
    btn.setAttribute("aria-controls", "skyDetailSheet");
    btn.setAttribute("aria-expanded", "false");
    btn.addEventListener("click", () => setOpen(!open));
    sheet = document.createElement("section");
    sheet.id = "skyDetailSheet";
    sheet.setAttribute("aria-label", "星空の詳細");
    sheet.hidden = true;
    document.body.appendChild(sheet);
    document.body.appendChild(btn);
    label();
  }
  function label() {
    btn.innerHTML = open ? "✕ 閉じる" : "📋 詳細";
    btn.setAttribute("aria-expanded", String(open));
  }
  function setOpen(v) {
    open = !!v && PHONE.matches;
    sheet.hidden = !open;
    document.body.classList.toggle("sky-detail-open", open);
    label();
    if (open) sheet.scrollTop = 0;
  }

  /* スマホのときはシートへ、パソコンのときは元の場所（body）へ戻す */
  function place() {
    const info = document.getElementById("starInfo");
    const lab = document.getElementById("knowledgeLabActivity");
    document.body.classList.toggle("sky-detail-phone", PHONE.matches);
    if (PHONE.matches) {
      if (info && info.parentNode !== sheet) sheet.appendChild(info);
      if (lab && lab.parentNode !== sheet) {
        sheet.appendChild(lab);
        lab.open = true;            // まとめた札の中では、最初から開いておく
      }
    } else {
      if (info && info.parentNode === sheet) document.body.insertBefore(info, document.body.firstChild);
      if (lab && lab.parentNode === sheet) document.body.appendChild(lab);
      setOpen(false);
    }
  }

  function start() {
    build();
    place();
    /* Knowledge Lab の札はあとから（親から活動が届いたときに）作られるので、出てきたらシートへ移す */
    if (typeof MutationObserver === "function") {
      new MutationObserver(() => {
        const lab = document.getElementById("knowledgeLabActivity");
        if (PHONE.matches && lab && lab.parentNode !== sheet) place();
      }).observe(document.body, { childList: true });
    }
    if (PHONE.addEventListener) PHONE.addEventListener("change", place);
    else if (PHONE.addListener) PHONE.addListener(place);
    /* 星座図鑑を開いたら閉じる（図鑑のあいだは、星座記録の札を出さない決まり） */
    document.addEventListener("click", e => {
      if (e.target.closest && e.target.closest('#zodiacModes [data-mode="book"]')) setOpen(false);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
