/* Canonical read-only destinations. No model-provided URL is opened. */
(function (root) {
  "use strict";
  const ID = /^[A-Za-z0-9_-]{1,100}$/;
  const GUIDES = Object.freeze({
    posting: "/knowledge-lab-guide.html",
    research: "/knowledge-lab-guide.html",
    navigation: "/?view=read",
    plans: "/membership.html",
    emuer_earn: "/schoolpark/tutorial.html",
    emuer_use: "/economy/index.html",
    passport: "/schoolpark/tutorial.html",
    stars: "/schoolpark/tutorial.html",
    echo: "/?view=city",
    ringo: "/?view=city",
    gods: "/?view=city",
    elevator: "/?view=city",
  });
  function target(kind, id) {
    if (!ID.test(String(id || ""))) return null;
    if (["knowledge", "knowledge_lab"].includes(kind))
      return "/?lab=library&labPost=" + id;
    if (kind === "knowledge_research") return "/?lab=research&labNote=" + id;
    if (kind === "knowledge_text")
      return "/admin/room1/index.html?contentId=" + id;
    if (kind === "guild" || kind === "quest")
      return (
        "/schoolpark/dao.html?screen=experiments&explorer" +
        (kind === "guild" ? "Guild" : "Quest") +
        "=" +
        id
      );
    if (kind === "city_product")
      return "/schoolpark/dao.html?screen=city&productId=" + id;
    if (
      [
        "service_guide",
        "emuer_guide",
        "passport_guide",
        "activity_guide",
      ].includes(kind)
    )
      return Object.hasOwn(GUIDES, id) ? GUIDES[id] : null;
    return null;
  }
  function allowed(value) {
    if (typeof value !== "string" || value.length > 260) return false;
    if (Object.values(GUIDES).includes(value)) return true;
    const patterns = [
      [/^\/\?lab=library&labPost=([A-Za-z0-9_-]{1,100})$/, "knowledge"],
      [
        /^\/\?lab=research&labNote=([A-Za-z0-9_-]{1,100})$/,
        "knowledge_research",
      ],
      [
        /^\/admin\/room1\/index\.html\?contentId=([A-Za-z0-9_-]{1,100})$/,
        "knowledge_text",
      ],
      [
        /^\/schoolpark\/dao\.html\?screen=experiments&explorerGuild=([A-Za-z0-9_-]{1,100})$/,
        "guild",
      ],
      [
        /^\/schoolpark\/dao\.html\?screen=experiments&explorerQuest=([A-Za-z0-9_-]{1,100})$/,
        "quest",
      ],
      [
        /^\/schoolpark\/dao\.html\?screen=city&productId=([A-Za-z0-9_-]{1,100})$/,
        "city_product",
      ],
    ];
    return patterns.some(([re, kind]) => {
      const m = value.match(re);
      return m && target(kind, m[1]) === value;
    });
  }
  const api = { target, allowed, GUIDES };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ReizoRequestTargets = api;
})(typeof window === "undefined" ? globalThis : window);
