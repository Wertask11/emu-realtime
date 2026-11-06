(() => {
  "use strict";
  window.openEmuEconomy = () => {
    if (typeof window.openSpRoom === "function")
      window.openSpRoom("/economy/index.html", "EMUER・サービス");
  };
  function init() {
    const menu = document.getElementById("emuAccountMenu");
    if (menu && !document.getElementById("economyMenuEntry")) {
      const b = document.createElement("button");
      b.id = "economyMenuEntry";
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.textContent = "EMUER・サービス";
      b.onclick = () => {
        window.closeAccountMenu?.();
        window.openEmuEconomy();
      };
      menu.insertBefore(b, menu.querySelector('[onclick*="settings"]'));
    }
    const existing = document.querySelector('[onclick="openEmuShopping()"]');
    if (existing && !document.getElementById("economyWalletEntry")) {
      const b = document.createElement("button");
      b.id = "economyWalletEntry";
      b.type = "button";
      b.className = "eth-btn";
      b.textContent = "EMUER・サービス";
      b.onclick = window.openEmuEconomy;
      existing.after(b);
    }
    // Embedded Lab / Text / Guild / Quest / City use the very same account and screen.
    if (
      window.parent !== window &&
      !document.getElementById("economyContextEntry")
    ) {
      const host =
        document.querySelector("[data-economy-slot]") || document.body;
      const b = document.createElement("button");
      b.id = "economyContextEntry";
      b.type = "button";
      b.textContent = "EMUER・サービス";
      b.style.cssText =
        "min-height:44px;margin:8px;padding:8px 12px;border:1px solid #cfc5b8;border-radius:10px;background:white;color:#aa5300;font:600 14px/1.5 system-ui;box-sizing:border-box;height:44px;cursor:pointer";
      b.onclick = () => window.parent.openEmuEconomy?.();
      host.append(b);
    }
  }
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      init();
    });
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
