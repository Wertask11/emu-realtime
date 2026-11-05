import { SignJWT } from "../../backend/node_modules/jose/dist/webapi/index.js";
import { deviceKey, present } from "../../backend/passport-v2/crypto.mjs";
const $ = (id) => document.getElementById(id),
  base = "/api/passport-v2";
let user,
  db,
  pending,
  busy = false;
const say = (t) => {
  $("message").textContent = t;
};
async function api(path, body, token) {
  if (user && parent.auth?.currentUser?.uid !== user.uid)
    throw Error("ACCOUNT_CHANGED");
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  else if (user) headers.Authorization = "Bearer " + (await user.getIdToken());
  if (body) headers["Content-Type"] = "application/json";
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    referrerPolicy: "no-referrer",
  });
  if (!r.ok) throw Error("PASSPORT_REQUEST_FAILED");
  return r.json();
}
async function storage() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("schoolpark-passport-v2-device", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("keys");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(Error("DEVICE_STORAGE_UNAVAILABLE"));
  });
}
async function keyStore(id, value, remove = false) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
        "keys",
        value || remove ? "readwrite" : "readonly",
      ),
      s = tx.objectStore("keys"),
      name = user.uid + ":" + id;
    const r = remove
      ? s.delete(name)
      : value
        ? s.put(value, name)
        : s.get(name);
    let result;
    r.onsuccess = () => {
      result = r.result;
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(Error("DEVICE_STORAGE_UNAVAILABLE"));
  });
}
function button(label, fn) {
  const b = document.createElement("button");
  b.textContent = label;
  b.onclick = () => task(fn);
  return b;
}
async function task(fn) {
  if (busy) return;
  busy = true;
  document.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    await fn();
  } catch (_) {
    say(
      "操作を完了できませんでした。通信状態とログインを確認し、もう一度お試しください。",
    );
  } finally {
    busy = false;
    document.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }
}
async function refresh() {
  const data = await api("/credentials");
  $("credentials").replaceChildren();
  for (const item of data.credentials) {
    const c = item.credential,
      card = document.createElement("article"),
      title = document.createElement("h3"),
      p = document.createElement("p");
    title.textContent = "SchoolParkアカウント証明";
    p.textContent =
      (item.revoked
        ? "失効済み"
        : "有効期限：" + new Date(c.validUntil).toLocaleDateString()) +
      " · 本人確認済みの証明ではありません";
    card.append(title, p);
    if (!item.revoked) {
      const key = await keyStore(item.id);
      if (key) {
        for (const v of data.verifiers)
          card.append(
            button(v.name + "へ提示内容を確認", async () => {
              pending = await api("/requests", {
                credentialId: item.id,
                verifierId: v.id,
              });
              $("recipient").textContent =
                "提示先：" +
                pending.recipient +
                "（" +
                pending.client_id +
                "）";
              $("purpose").textContent = "利用目的：" + pending.purpose;
              $("claims").textContent =
                "開示する情報：アカウントへのアクセス確認、確認水準、スキーマ版、仮名の鍵ID、発行元、証明書ID、有効期間、失効情報、署名。";
              $("disclosure").textContent = JSON.stringify(
                pending.disclosure,
                null,
                2,
              );
              $("consent").showModal();
            }),
          );
      } else {
        const p = document.createElement("p");
        p.textContent =
          "この端末には鍵がありません。古い証明書を失効し、新しく発行してください。";
        card.append(p);
      }
      card.append(
        button("失効する", async () => {
          await api("/revoke", { credentialId: item.id });
          await keyStore(item.id, null, true);
          say("失効しました。");
          await refresh();
        }),
      );
    }
    card.append(
      button("証明書を削除する", async () => {
        await api("/delete", { credentialId: item.id });
        await keyStore(item.id, null, true);
        say(
          "失効して証明書を削除しました。失効確認に必要な最小記録は保持します。",
        );
        await refresh();
      }),
    );
    $("credentials").append(card);
  }
  if (!data.credentials.length) {
    $("credentials").textContent = "まだ証明書はありません。";
  }
  $("history").replaceChildren();
  const labels = {
    issuance_requested: "発行を要求",
    issued: "発行",
    approved: "提示に同意",
    denied: "提示を拒否",
    withdrawn: "同意を撤回",
    presented: "提示を完了",
    revoked: "失効",
    deleted: "削除",
  };
  for (const h of data.history) {
    const li = document.createElement("li");
    li.textContent =
      new Date(h.at).toLocaleString() +
      " " +
      (labels[h.type] || h.type) +
      (h.recipient ? " · " + h.recipient + " · " + h.purpose : "") +
      (h.disclosedFields ? " · 開示項目：" + h.disclosedFields.join("、") : "");
    $("history").append(li);
  }
}
$("issue").onclick = () =>
  task(async () => {
    const key = await deviceKey();
    const out = await api("/offers", {});
    const g =
      out.credential_offer.grants[
        "urn:ietf:params:oauth:grant-type:pre-authorized_code"
      ];
    const token = await api("/token", {
      grant_type: "urn:ietf:params:oauth:grant-type:pre-authorized_code",
      "pre-authorized_code": g["pre-authorized_code"],
      tx_code: out.tx_code,
    });
    const n = await api("/nonce", {});
    const proof = await new SignJWT({ nonce: n.c_nonce })
      .setAudience(out.credential_offer.credential_issuer)
      .setIssuedAt()
      .setProtectedHeader({
        typ: "openid4vci-proof+jwt",
        alg: "ES256",
        jwk: key.jwk,
      })
      .sign(key.privateKey);
    const r = await api(
      "/credential",
      {
        credential_configuration_id: "schoolpark_account_v1",
        proofs: { jwt: [proof] },
      },
      token.access_token,
    );
    const c = r.credentials[0].credential;
    try {
      await keyStore(c.id, key);
    } catch (e) {
      await api("/revoke", { credentialId: c.id });
      throw e;
    }
    say("この端末用の証明書を発行しました。");
    await refresh();
  });
async function deny() {
  if (!pending) return;
  const id = pending.id;
  pending = null;
  $("consent").close();
  await api("/consent", { requestId: id, approved: false });
  say("提示しませんでした。");
  await refresh();
}
$("deny").onclick = () => task(deny);
$("consent").addEventListener("cancel", (e) => {
  e.preventDefault();
  task(deny);
});
$("approve").onclick = () =>
  task(async () => {
    const r = pending;
    if (!r) return;
    await api("/consent", { requestId: r.id, approved: true });
    const key = await keyStore(r.credentialId);
    if (!key) throw Error("DEVICE_KEY_MISSING");
    const p = await present(r.disclosure, key, r);
    await api("/response", { state: r.state, vp_token: { account: [p] } });
    pending = null;
    $("consent").close();
    say("承認した内容で、この開発環境への提示・検証が完了しました。");
    await refresh();
  });
$("clear").onclick = () =>
  task(async () => {
    await api("/history/delete", {});
    say("履歴を削除し、未完了の同意を撤回しました。");
    await refresh();
  });
$("back").onclick = (e) => {
  if (parent !== window) {
    e.preventDefault();
    parent.document.getElementById("passportV2Dialog")?.close();
  }
};
(async () => {
  try {
    const c = await api("/capabilities");
    if (!c.enabled) {
      say(
        "証明書機能は公開前です。既存のPassport・ログインは引き続き使えます。",
      );
      return;
    }
    if (parent === window || !parent.auth?.currentUser) {
      say("EmuのPassportから、ログインした状態で開いてください。");
      return;
    }
    user = parent.auth.currentUser;
    db = await storage();
    $("controls").hidden = false;
    await refresh();
    say(
      "開発環境です。政府認証・ZKP・外部ウォレット認定には対応していません。",
    );
    parent.fbAuth?.onAuthStateChanged(parent.auth, (u) => {
      if (!u || u.uid !== user.uid) {
        db.close();
        location.reload();
      }
    });
  } catch (_) {
    say("証明書機能を開けませんでした。既存のPassportからやり直してください。");
  }
})();
