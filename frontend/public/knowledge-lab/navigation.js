/* Static guide navigation stays inside the authenticated shell when embedded. */
(() => {
  "use strict";
  for (const link of document.querySelectorAll("[data-lab-return]"))
    link.addEventListener("click", (event) => {
      if (parent === window) return;
      event.preventDefault();
      location.href = "/knowledge-lab.html?view=library";
    });
  for (const link of document.querySelectorAll("[data-lab-close], .brand"))
    link.addEventListener("click", (event) => {
      if (parent === window) return;
      event.preventDefault();
      parent.postMessage(
        { type: "emu-lab-action", action: "close" },
        location.origin,
      );
    });
})();
