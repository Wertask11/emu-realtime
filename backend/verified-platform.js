'use strict';
const express = require('express');
const ethers = require('ethers');
const deriveAddress = uid => ethers.utils.getAddress('0x' + ethers.utils.keccak256(ethers.utils.toUtf8Bytes('ches-wallet:v1:' + uid)).slice(-40));

// Only a verified Firebase token or this server's signature verifier supplies this input.
async function ensureVerifiedAccount(db, decoded) {
  const uid = decoded.uid;
  if (typeof uid !== 'string' || !uid || uid.includes('/')) throw new Error('INVALID_UID');
  const chesAddress = deriveAddress(uid);
  const walletLogin = uid.startsWith('wallet:');
  const ref = db.collection('ches_accounts').doc(uid);
  const trustedRef = db.collection('ches_verified_accounts').doc(uid);
  const {linkIdFor,isSchoolParkId}=require('./identity');
  const passportRef=db.collection('sp_auth_links').doc(linkIdFor('fb',uid));
  return db.runTransaction(async tx => {
    const [snap, trusted, passport] = await Promise.all([tx.get(ref), tx.get(trustedRef), tx.get(passportRef)]);
    const spid=passport.exists && isSchoolParkId(passport.data().spid) ? passport.data().spid : '';
    let walletAddress = chesAddress;
    if (walletLogin) {
      if (decoded.provider === "wallet" && decoded.address && decoded.firebase?.sign_in_provider === "custom") {
        walletAddress = ethers.utils.getAddress(decoded.address);
      } else if (trusted.exists && trusted.data().walletAddress) {
        // A linked Firebase login may no longer carry the original wallet custom claims.
        walletAddress = ethers.utils.getAddress(trusted.data().walletAddress);
      } else { throw new Error("WALLET_LOGIN_REQUIRED"); }
      if (uid !== "wallet:" + walletAddress.toLowerCase()) throw new Error("ADDRESS_MISMATCH");
    }
    const old = snap.exists ? snap.data() : {};
    const now = Date.now();
    const account = {
      ...old, ...(spid ? {spid} : {}), uid, walletAddress, chesAddress,
      /* LINE は自前の custom token で入るので、Firebase から見ると "custom"。
         そのまま書くとパスポートの「入り方」が「不明」になっていた。uid（line:…）か
         token の provider で LINE と書く。表示と記録のためだけの欄（権限には使わない）。 */
      provider: walletLogin ? 'wallet'
        : ((String(uid).indexOf('line:') === 0 || decoded.provider === 'line') ? 'line'
        : (decoded.firebase?.sign_in_provider || 'custom')),
      displayName: old.displayName || decoded.name || '', email: old.email || decoded.email || '',
      photoURL: old.photoURL || decoded.picture || '', createdAt: old.createdAt || now, lastLogin: now,
      membership: old.membership || { tier: 'free', offchain: true, issuedAt: now },
    };
    // Never use a browser-supplied wallet as an authorization source, including legacy records.
    tx.set(ref, account);
    tx.set(trustedRef, { uid, walletAddress, chesAddress, spid, passportBindingVersion:spid?1:0 });
    // Rules cannot compute an EIP-55 checksum. Preserve existing keys and add
    // server-verified lowercase aliases for legacy knowledge participant checks.
    for (const address of new Set([walletAddress, chesAddress, walletAddress.toLowerCase(), chesAddress.toLowerCase()])) {
      tx.set(db.collection('ches_wallets').doc(address), { address, uid, spid, passportBindingVersion:spid?1:0, provider: account.provider, type: walletLogin && address.toLowerCase() === walletAddress.toLowerCase() ? 'self-custody' : 'address-only', createdAt: now }, { merge: true });
    }
    return account;
  });
}

/* 11/8：Firestore の1日の上限（無料枠）を使い切ったときは「メンテナンス中」と返す。

   上限に達すると、読み書きは RESOURCE_EXHAUSTED（code 8）で断られる。
   前はここで ACCOUNT_UNAVAILABLE を返していたので、画面は保存済みの控えで入場を続け、
   何も読めないまま真っ白になっていた。

   上限が戻るのは米国太平洋時間の0時（日本時間の夕方）。その時刻を retryAt で返す。
   覚えるのはこのプロセスの中だけ（DB は読まない）。再起動すれば、次の失敗でまた気づく。 */
const quotaState = { until: 0 };
function isQuotaError(error) {
  return !!error && (error.code === 8 || error.code === 'resource-exhausted'
    || /RESOURCE_EXHAUSTED|quota exceeded/i.test(String(error.message || '')));
}
function nextQuotaReset(now = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hourCycle: 'h23',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(now)).map(p => [p.type, p.value]));
  const sinceMidnight = ((Number(parts.hour) % 24) * 3600 + Number(parts.minute) * 60 + Number(parts.second)) * 1000 + (now % 1000);
  return now - sinceMidnight + 86400000;
}
function noteQuotaError(error, now = Date.now()) {
  if (!isQuotaError(error)) return false;
  quotaState.until = Math.max(quotaState.until, nextQuotaReset(now));
  return true;
}
function quotaMaintenance(now = Date.now()) {
  return now < quotaState.until ? { maintenance: true, retryAt: quotaState.until } : { maintenance: false, retryAt: null };
}

function accountRouter({ db, firebaseAdmin, onVerified = () => {} }) {
  const router = express.Router();
  // 画面が「メンテナンス中」を出すかどうかを聞く。DB は読まない。
  router.get('/status', (req, res) => {
    res.set('Cache-Control', 'no-store').json(quotaMaintenance());
  });
  router.post('/account', async (req, res) => {
    if (!db || !firebaseAdmin) return res.status(503).json({ error: 'AUTH_UNAVAILABLE' });
    const header = String(req.headers.authorization || '');
    if (!header.startsWith('Bearer ')) return res.status(401).json({ error: 'AUTH_REQUIRED' });
    let decoded;
    try { decoded = await firebaseAdmin.auth().verifyIdToken(header.slice(7)); }
    catch { return res.status(401).json({ error: 'INVALID_AUTH_TOKEN' }); }
    try {
      const account = await ensureVerifiedAccount(db, decoded);
      onVerified(decoded.uid);
      return res.json({ account });
    } catch (error) {
      if (['WALLET_LOGIN_REQUIRED', 'ADDRESS_MISMATCH', 'INVALID_UID'].includes(error.message)) return res.status(403).json({ error: error.message });
      if (noteQuotaError(error)) return res.status(503).json({ error: 'SERVICE_MAINTENANCE', retryAt: quotaState.until });
      return res.status(503).json({ error: 'ACCOUNT_UNAVAILABLE' });
    }
  });
  return router;
}

const RANK_BADGES = { good_post: '王将', change_post: '名人', total_post: '竜王', posted: '棋聖', good_given: '棋王', change_given: '王位' };
async function awardRankingBadge(db, type, address) {
  const badge = RANK_BADGES[type];
  if (!db || !badge || !address) return;
  const ref = db.collection('rank_badges').doc(address.toLowerCase());
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const badges = snap.exists && Array.isArray(snap.data().badges) ? snap.data().badges : [];
    if (!badges.includes(badge)) tx.set(ref, { badges: [...badges, badge] }, { merge: true });
  });
}

function activityRouter({ db, requireFirebaseUser }) {
  const router = express.Router();
  router.post('/:kind', requireFirebaseUser, async (req, res) => {
    const kind = req.params.kind;
    const brand = req.body?.brand;
    const type = req.body?.type;
    if (kind !== 'entry' && kind !== 'brand') return res.status(404).json({ error: 'NOT_FOUND' });
    if (kind === 'brand' && !['heartoo', 'emu', 'schoolpark', 'camellia'].includes(brand)) return res.status(400).json({ error: 'INVALID_BRAND' });
    if (kind === 'entry' && !['tap', 'free', 'paid'].includes(type)) return res.status(400).json({ error: 'INVALID_TYPE' });
    const address = req.identity.walletAddress.toLowerCase();
    const uid = req.identity.uid;
    try {
      // Paid/free status comes from the server's pass registry, never the posted type/address.
      const pass = await db.collection('paid_users').doc(req.identity.account.walletAddress).get();
      const lowerPass = pass.exists ? pass : await db.collection('paid_users').doc(address).get();
      const actualType = type === 'tap' ? 'tap' : lowerPass.exists ? 'paid' : 'free';
      const event = kind === 'brand' ? 'brand_' + brand : actualType;
      const now = Date.now();
      const limitRef = db.collection('sp_activity_limits').doc(uid + '_' + event);
      const statsRef = db.collection('sp_stats').doc('global');
      const entrantRef = db.collection(kind === 'brand' ? 'sp_brand_entrants' : 'sp_entrants').doc(kind === 'brand' ? brand + '_' + address : address);
      const passRef = db.collection(actualType === 'paid' ? 'sp_paid_pass' : 'sp_free_pass').doc(address);
      await db.runTransaction(async tx => {
        const [limit, stats, entrant, visit] = await Promise.all([tx.get(limitRef), tx.get(statsRef), tx.get(entrantRef), tx.get(passRef)]);
        if (limit.exists && now - limit.data().at < 60000) return;
        const data = stats.exists ? stats.data() : {};
        const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
        const patch = { updated_at: new Date(now) };
        if (kind === 'brand') {
          if (!entrant.exists) {
            patch[brand + '_entrants'] = count(data[brand + '_entrants']) + 1;
            tx.set(entrantRef, { brand, address, uid, first_seen: new Date(now) });
          }
        } else {
          const field = actualType === 'tap' ? 'total_taps' : actualType + '_count';
          patch[field] = count(data[field]) + 1;
          if (actualType !== 'tap') {
            if (!entrant.exists) { patch.entrants = count(data.entrants) + 1; tx.set(entrantRef, { address, uid, first_seen: new Date(now) }); }
            const visits = count(visit.exists ? visit.data().count : 0) + 1;
            tx.set(passRef, { address, count: visits, first_seen: visit.exists ? visit.data().first_seen || new Date(now) : new Date(now), last_seen: new Date(now) });
            tx.set(db.collection('sp_pass_logs').doc(uid + '_' + actualType + '_' + Math.floor(now / 60000)), { type: actualType, address, uid, timestamp: new Date(now), visit_num: visits });
          }
        }
        tx.set(statsRef, patch, { merge: true });
        tx.set(limitRef, { at: now });
      });
      return res.json({ ok: true });
    } catch { return res.status(503).json({ error: 'ACTIVITY_UNAVAILABLE' }); }
  });
  return router;
}
module.exports = { deriveAddress, ensureVerifiedAccount, accountRouter, awardRankingBadge, activityRouter, noteQuotaError, quotaMaintenance, nextQuotaReset };
