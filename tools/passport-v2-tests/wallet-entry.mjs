import { SignJWT } from "../../backend/node_modules/jose/dist/webapi/index.js";
import { decodeJwt } from "../../backend/node_modules/jose/dist/webapi/index.js";
import { presentSelective } from "../../backend/passport-v2/selective.mjs";
import { deviceKey, present } from "../../backend/passport-v2/crypto.mjs";
const $ = (id) => document.getElementById(id),
  base = "/api/passport-v2";
let user,
  db,
  pending,
  busy = false;
let items = [],
  zkpPending;
const zkpSamples = new Map();
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
  if (!r.ok) {
    let code;
    try {
      code = (await r.json()).error;
    } catch (_) {}
    if (code === "RECENT_LOGIN_REQUIRED")
      throw Object.assign(Error("RECENT_LOGIN_REQUIRED"), { code });
    throw Error("PASSPORT_REQUEST_FAILED");
  }
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
  } catch (e) {
    if (e.code === "RECENT_LOGIN_REQUIRED") {
      say(
        "証明書の操作には最近のログイン確認が必要です。同じ方法でもう一度ログインしてください。",
      );
      return;
    }
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
  items = data.credentials;
  const privacy = (await keyStore("privacyPreference")) || {
    remember: false,
    fields: ["accountAccess"],
  };
  $("rememberSelections").checked = privacy.remember;
  $("credentials").replaceChildren();
  for (const item of data.credentials) {
    const c = item.credential,
      card = document.createElement("article"),
      title = document.createElement("h3"),
      p = document.createElement("p");
    const selective = item.format === "dc+sd-jwt";
    const info = selective ? decodeJwt(c.split("~")[0]) : c;
    title.textContent = selective
      ? "SchoolParkアカウント証明（選択的開示）"
      : "SchoolParkアカウント証明（全項目）";
    p.textContent =
      (item.revoked
        ? "失効済み"
        : "有効期限：" +
          new Date(
            selective ? info.exp * 1000 : c.validUntil,
          ).toLocaleDateString()) + " · 本人確認済みの証明ではありません";
    const issuer = document.createElement("p");
    issuer.textContent = "発行者：" + (selective ? info.iss : c.issuer);
    card.append(title, p, issuer);
    const trust = document.createElement("p");
    trust.textContent =
      item.issuerTrusted === false
        ? "発行者鍵を再確認できません。開発環境の再起動後は失効・再発行してください。"
        : "発行者の署名鍵が登録されています。";
    card.append(trust);
    const choices = document.createElement("fieldset");
    if (selective) {
      const legend = document.createElement("legend");
      legend.textContent = "提示する項目を選ぶ";
      choices.append(legend);
      for (const [name, label] of [
        ["accountAccess", "アカウントへのアクセス（必須）"],
        ["assurance", "確認水準"],
        ["schemaVersion", "証明の版"],
      ]) {
        const line = document.createElement("label"),
          input = document.createElement("input");
        input.type = "checkbox";
        input.name = name;
        input.checked =
          name === "accountAccess" ||
          (privacy.remember && privacy.fields?.includes(name));
        input.disabled = name === "accountAccess";
        line.append(input, document.createTextNode(label));
        choices.append(line);
      }
      choices.addEventListener("change", () => {
        if ($("rememberSelections").checked)
          keyStore("privacyPreference", {
            remember: true,
            fields: [...choices.querySelectorAll("input:checked")].map(
              (e) => e.name,
            ),
          }).catch(() => {});
      });
      card.append(choices);
    }

    if (!item.revoked) {
      const key = await keyStore(item.id);
      if (key && item.issuerTrusted !== false) {
        for (const v of data.verifiers)
          card.append(
            button(v.name + "へ提示内容を確認", async () => {
              pending = await api("/requests", {
                credentialId: item.id,
                verifierId: v.id,
                ...(selective
                  ? {
                      selected: [
                        ...choices.querySelectorAll("input:checked"),
                      ].map((e) => e.name),
                    }
                  : {}),
              });
              $("recipient").textContent =
                "提示先の登録名称：" +
                (pending.legalName || pending.recipient) +
                "（" +
                pending.client_id +
                "）";
              $("purpose").textContent = "利用目的：" + pending.purpose;
              $("trust").textContent =
                "信頼状態：" +
                (pending.trustStatus === "registered"
                  ? "登録済みの検証先（第三者認証を意味しません）"
                  : "設定済みの検証先（外部認定なし）");
              $("retention").textContent = pending.retentionNotice;
              $("hidden").textContent =
                "開示しない項目：" +
                (pending.hiddenFields?.length
                  ? pending.hiddenFields.join("、")
                  : "この形式は全項目の提示です");
              $("formatNotice").textContent = selective
                ? "選択した属性と、発行者・期限・所持者鍵・失効参照・署名を渡します。SD-JWTはZKPではなく、同じ証明書を再提示すると関連付けられます。"
                : "この通常VCは全項目を渡します。属性を選んで隠すことはできません。";
              $("claims").textContent = selective
                ? "開示する属性：" +
                  pending.selected
                    .map(
                      (k) =>
                        ({
                          accountAccess: "アカウントへのアクセス",
                          assurance: "確認水準",
                          schemaVersion: "証明の版",
                        })[k],
                    )
                    .join("、")
                : "開示する情報：アカウントへのアクセス確認、確認水準、スキーマ版、仮名の鍵ID、発行元、証明書ID、有効期間、失効情報、署名。";
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
async function issueOnDevice(configurationId) {
  return task(async () => {
    const key = await deviceKey();
    const out = await api("/offers", { configurationId });
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
        credential_configuration_id: configurationId,
        proofs: { jwt: [proof] },
      },
      token.access_token,
    );
    const c = r.credentials[0].credential;
    const credentialId =
      typeof c === "string" ? decodeJwt(c.split("~")[0]).status_id : c.id;
    try {
      await keyStore(credentialId, key);
    } catch (e) {
      await api("/revoke", { credentialId });
      throw e;
    }
    say("この端末用の証明書を発行しました。");
    await refresh();
  });
}
$("issue").onclick = () => issueOnDevice("schoolpark_account_v1");
$("issueSelective").onclick = () => issueOnDevice("schoolpark_account_sd_v1");
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
    const p =
      r.format === "dc+sd-jwt"
        ? await presentSelective(
            items.find((c) => c.id === r.credentialId).credential,
            key,
            r,
            r.selected,
          )
        : await present(r.disclosure, key, r);
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
$("rememberSelections").onchange = () =>
  task(async () => {
    await keyStore("privacyPreference", {
      remember: $("rememberSelections").checked,
      fields: ["accountAccess"],
    });
    await refresh();
  });
$("clearDevice").onclick = () =>
  task(async () => {
    for (const item of items) {
      if (await keyStore(item.id)) {
        await api("/revoke", { credentialId: item.id });
        await keyStore(item.id, null, true);
      }
    }
    say("この端末の証明を失効し、端末の鍵を削除しました。");
    await refresh();
  });
$("tryZkp").onclick = () =>
  task(async () => {
    const useCase = $("zkpCase").value;
    let sample = zkpSamples.get(useCase);
    if (!sample) {
      sample = await api("/zkp/sample", { useCase });
      zkpSamples.set(useCase, sample);
    }
    zkpPending = await api("/zkp/request", { credentialId: sample.id });
    $("zkpSummary").textContent =
      "提示先：" +
      zkpPending.recipient +
      "。目的：" +
      zkpPending.purpose +
      "。要求：" +
      zkpPending.useCase +
      "。氏名・住所・生年月日・所持者秘密・失効IDは渡しません。証明結果・公開発行者鍵・共有スキーマ・範囲条件は渡します。相手が結果を保存する可能性があります。";
    $("zkpConsent").showModal();
  });
async function denyZkp() {
  if (!zkpPending) return;
  await api("/zkp/consent", { requestId: zkpPending.id, approved: false });
  zkpPending = null;
  $("zkpConsent").close();
  say("ZKPを提示しませんでした。");
}
$("denyZkp").onclick = () => task(denyZkp);
$("zkpConsent").addEventListener("cancel", (e) => {
  e.preventDefault();
  task(denyZkp);
});
$("approveZkp").onclick = () =>
  task(async () => {
    const r = zkpPending;
    if (!r) return;
    await api("/zkp/consent", { requestId: r.id, approved: true });
    say("端末で証明を生成しています…");
    const start = performance.now(),
      before = performance.memory?.usedJSHeapSize;
    const { generateZkp } = await import("./zkp-wallet.js");
    const proof = await generateZkp(r.bundle, r);
    await api("/zkp/response", { requestId: r.id, presentation: proof });
    const ms = Math.round(performance.now() - start);
    $("zkpMetrics").textContent =
      "生成から検証完了まで " +
      ms +
      "ms。JSヒープ差分：" +
      (before === undefined
        ? "このブラウザでは測定不可"
        : Math.max(
            0,
            (performance.memory.usedJSHeapSize - before) / 1048576,
          ).toFixed(1) + " MiB（WASM全体のメモリではありません）");
    window.__passportZkpMetrics = {
      ms,
      heapDelta:
        before === undefined
          ? null
          : performance.memory.usedJSHeapSize - before,
    };
    zkpPending = null;
    $("zkpConsent").close();
    say(
      "テスト資格のZKP生成・検証が成功しました。実在の本人確認・年齢・出店資格を確認したものではありません。",
    );
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
    $("zkpSection").hidden = !c.zkpSandbox;
    await refresh();
    const authorizationId = new URLSearchParams(location.search).get(
      "authorization",
    );
    if (authorizationId && /^[\w-]{43}$/.test(authorizationId)) {
      const details = await api("/authorization/details", {
        requestId: authorizationId,
      });
      $("authorizationSection").hidden = false;
      $("authorizationDetails").textContent =
        "発行先：" +
        details.recipient +
        "（" +
        details.redirectUri +
        "）。目的：" +
        details.purpose +
        "。証明：" +
        details.configurationId +
        "。この操作では政府認証やCity権限を発行しません。";
      const decide = (approved) =>
        task(async () => {
          const result = await api("/authorization/decision", {
            requestId: authorizationId,
            approved,
          });
          parent.location.assign(result.redirectUri);
        });
      $("denyAuthorization").onclick = () => decide(false);
      $("approveAuthorization").onclick = () => decide(true);
    }
    say(
      c.zkpSandbox
        ? "開発環境です。公的本人確認は未接続です。ZKPは未監査の架空資格試験に限定しています。"
        : "開発環境です。公的本人確認は未接続です。未監査のZKP試験は無効です。",
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
