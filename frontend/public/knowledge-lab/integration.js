/* Loaded before the existing login flow rewrites the return URL. No automatic writes. */
(() => {
  "use strict";
  const allowed = [
    "library",
    "research",
    "mine",
    "requests",
    "writer",
    "admin",
  ];
  const params = new URLSearchParams(location.search),
    validId = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(v);
  if (allowed.includes(params.get("lab"))) {
    try {
      sessionStorage.setItem(
        "emu-lab-return",
        JSON.stringify({
          view: params.get("lab"),
          post: validId(params.get("labPost")) ? params.get("labPost") : null,
          note: validId(params.get("labNote")) ? params.get("labNote") : null,
        }),
      );
    } catch (_) {}
  }
  let pendingLanding = null,
    openSequence = 0;
  function covered() {
    return (
      document.documentElement.classList.contains("ches-resuming") ||
      ["spLoadingOverlay", "loadingOverlay"].some((id) => {
        const el = document.getElementById(id);
        return (
          el &&
          el.getBoundingClientRect().width > 0 &&
          el.getBoundingClientRect().height > 0
        );
      })
    );
  }
  window.openEmuKnowledgeLab = (view = "library", options = {}) => {
    if (!allowed.includes(view)) view = "library";
    const p = new URLSearchParams({ view });
    if (options.compose) p.set("compose", "1");
    if (validId(options.edit)) p.set("edit", options.edit);
    if (validId(options.post)) p.set("post", options.post);
    if (validId(options.note)) p.set("note", options.note);
    const sequence = ++openSequence,
      uid = window.auth?.currentUser?.uid || null,
      until = Date.now() + 30000;
    const open = () => {
      if (
        sequence !== openSequence ||
        (uid && window.auth?.currentUser?.uid !== uid)
      )
        return;
      if (pendingLanding) {
        pendingLanding.finally(open);
        return;
      }
      if (covered()) {
        if (Date.now() < until) setTimeout(open, 150);
        return;
      }
      window.openSpRoom("/knowledge-lab.html?" + p, "Emu Knowledge Lab");
    };
    open();
  };
  let indexAvailable = null,
    indexAvailableAt = 0;
  window.emuLabSyncIndex = async (postId) => {
    if (!validId(postId)) return;
    try {
      if (Date.now() - indexAvailableAt > 60000) {
        const r = await fetch("/api/knowledge-lab/config");
        const d = await r.json();
        indexAvailable = !!d.enabled;
        indexAvailableAt = Date.now();
      }
      if (!indexAvailable) return;
      await fetch("/api/knowledge-lab/index/" + encodeURIComponent(postId), {
        method: "POST",
        headers: await window.emuAuthHeaders(true, { interactive: false }),
        body: "{}",
      });
    } catch (_) {
      /* Publishing never fails because the derived index is unavailable. Owner reconciliation repairs it. */
    }
  };
  window.emuLabSendActivity = async (frame) => {
    const uid = window.auth?.currentUser?.uid;
    if (!uid) return;
    try {
      const r = await fetch("/api/knowledge-lab/me/activity", {
        headers: await window.emuAuthHeaders(true, { interactive: false }),
      });
      if (!r.ok) return;
      const data = await r.json();
      if (
        window.auth?.currentUser?.uid !== uid ||
        frame !== document.getElementById("room2Frame")
      )
        return;
      frame.contentWindow?.postMessage(
        { type: "EMU_LAB_ACTIVITY", data },
        location.origin,
      );
    } catch (_) {
      /* Existing star counts remain available independently. */
    }
  };
  function labFrame() {
    const frame = document.getElementById("spRoomFrame");
    if (
      !frame ||
      !/^\/knowledge-lab(?:-guide)?\.html(?:[?#]|$)/.test(
        frame.getAttribute("src") || "",
      )
    )
      return null;
    return frame;
  }
  function feedback(message) {
    labFrame()?.contentWindow?.postMessage(
      { type: "emu-lab-feedback", message },
      location.origin,
    );
  }
  window.addEventListener("message", async (event) => {
    const frame = labFrame();
    if (
      !frame ||
      event.source !== frame.contentWindow ||
      event.origin !== location.origin ||
      event.data?.type !== "emu-lab-action"
    )
      return;
    const message = event.data,
      action = message.action;
    try {
      if (
        ["good", "change", "propose"].includes(action) &&
        validId(message.postId)
      ) {
        window.closeSpRoom();
        await window.emuKnowledgeReact({
          type: "emu-knowledge-react",
          action,
          postId: message.postId,
        });
        return;
      }
      if (action === "library") {
        window.closeSpRoom();
        window.emuOpenKnowledgeLibrary();
        return;
      }
      if (action === "close") {
        window.closeSpRoom();
        window.showEmuRequests();
        return;
      }
      if (action === "passport") {
        window.closeSpRoom();
        window.openSpPassport();
        return;
      }
      if (action === "schoolpark") {
        if (validId(message.noteId)) {
          const r = await fetch("/api/knowledge-lab/notes/" + message.noteId, {
              headers: await window.emuAuthHeaders(false, {
                interactive: false,
              }),
            }),
            note = await r.json();
          if (!r.ok || note.visibility !== "public")
            throw new Error(
              "公開している研究から議題にできます。まず公開範囲を確認してください。",
            );
          const first = await fetch(
              "/api/knowledge-lab/posts/" + note.sourceIds[0],
              {
                headers: await window.emuAuthHeaders(false, {
                  interactive: false,
                }),
              },
            ),
            source = await first.json();
          if (!first.ok || source.visibility !== "public")
            throw new Error("元の知識の公開状態を確認してください。");
          window.closeSpRoom();
          await window.spOpenProposalFromPost(note.sourceIds[0], note.title);
          const body = document.getElementById("spvBody");
          if (body)
            body.value = [
              note.question,
              note.hypothesis,
              "研究ノート: " +
                new URL("/knowledge-lab.html?note=" + note.id, location.origin),
              ...note.sourceIds.map(
                (id) =>
                  "元知識: " +
                  new URL("/knowledge-lab.html?post=" + id, location.origin),
              ),
            ]
              .filter(Boolean)
              .join("\n\n")
              .slice(0, 600);
          return;
        }
        window.closeSpRoom();
        await window.spDaoOpenWhenReady();
        return;
      }
      if (action === "request") {
        window.closeSpRoom();
        window.showEmuRequests();
        window.openKnowledgeRequestComposer();
        return;
      }
      if (
        ["answer", "answers"].includes(action) &&
        validId(message.requestId)
      ) {
        const snap = await window.fbLib.getDoc(
          window.fbLib.doc(window.db, "knowledge_requests", message.requestId),
        );
        if (!snap.exists()) throw new Error("募集が見つかりません。");
        const request = { id: snap.id, ...snap.data() };
        window.closeSpRoom();
        window.showEmuRequests();
        if (action === "answer") window.openKnowledgeAnswer(request);
        else window.openKnowledgeAnswers(request);
        return;
      }
      if (
        action === "discussion" &&
        (validId(message.postId) || validId(message.noteId))
      ) {
        const id = message.noteId || message.postId,
          path = message.noteId ? "notes" : "posts";
        const r = await fetch(
          "/api/knowledge-lab/" + path + "/" + encodeURIComponent(id),
          {
            headers: await window.emuAuthHeaders(false, { interactive: false }),
          },
        );
        const data = await r.json();
        if (!r.ok) throw new Error("元の知識・研究を確認できませんでした。");
        window.closeSpRoom();
        window.showEmuDiscussion();
        // Open the existing composer. The user still decides whether to create/send the topic.
        const url = new URL(
          "/knowledge-lab.html?" +
            (message.noteId ? "note" : "post") +
            "=" +
            id,
          location.origin,
        );
        const discussion = document.getElementById("emuDiscussionFrame");
        const prefill = () => {
          try {
            const input =
              discussion?.contentDocument?.getElementById("ownTopic");
            if (input) {
              input.value = (String(data.title || "") + " " + url).slice(
                0,
                120,
              );
              input.focus();
              discussion.removeEventListener("load", prefill);
              return true;
            }
          } catch (_) {}
          return false;
        };
        if (!prefill())
          discussion?.addEventListener("load", prefill, { once: true });
        return;
      }
    } catch (e) {
      feedback(e.message || "既存画面を開けませんでした。");
    }
  });
  window.addEventListener("emu-reaction-result", (e) => {
    if (e.detail?.ok) feedback("反応を保存しました。");
    else feedback(e.detail?.error || "反応を保存できませんでした。");
  });
  window.addEventListener("DOMContentLoaded", () => {
    // Track the real navigation promise; the auth flag becomes true before landing finishes.
    if (typeof window.chesLandAfterLogin === "function") {
      const original = window.chesLandAfterLogin;
      window.chesLandAfterLogin = function () {
        const result = Promise.resolve(original.apply(this, arguments));
        const tracked = result.finally(() => {
          if (pendingLanding === tracked) pendingLanding = null;
          resume();
        });
        pendingLanding = tracked;
        return tracked;
      };
    }
    // Clear iframe memory when the real Firebase session ends or changes account.
    let attempts = 0;
    const timer = setInterval(() => {
      if (++attempts > 120) {
        clearInterval(timer);
        return;
      }
      if (!window.auth || !window.fbAuth?.onAuthStateChanged) return;
      clearInterval(timer);
      let previous = window.auth.currentUser?.uid || null;
      window.fbAuth.onAuthStateChanged(window.auth, (user) => {
        const current = user?.uid || null;
        if (previous !== current) {
          try {
            document
              .getElementById("room2Frame")
              ?.contentWindow?.postMessage(
                { type: "EMU_LAB_ACTIVITY_CLEAR" },
                location.origin,
              );
          } catch (_) {}
        }
        if (current !== previous && labFrame()) window.closeSpRoom();
        previous = current;
      });
    }, 250);
    let intent = null;
    try {
      intent = JSON.parse(sessionStorage.getItem("emu-lab-return") || "null");
    } catch (_) {}
    if (!intent || !allowed.includes(intent.view)) return;
    const observer = new MutationObserver(resume);
    observer.observe(document.documentElement, {
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    function resume() {
      if (!intent) return;
      if (
        !window.auth?.currentUser ||
        !window._chesEntered ||
        pendingLanding ||
        covered() ||
        document.documentElement.classList.contains("ches-resuming") ||
        typeof window.openSpRoom !== "function"
      )
        return;
      const target = intent;
      intent = null;
      observer.disconnect();
      sessionStorage.removeItem("emu-lab-return");
      // The normal landing can be SchoolPark. An explicit Lab/recruitment URL
      // must return to Emu after that existing login promise has completed.
      if (typeof window.showEmuRequests === "function")
        window.showEmuRequests();
      window.openEmuKnowledgeLab(target.view, {
        post: target.post,
        note: target.note,
      });
    }
    resume();
  });
})();
