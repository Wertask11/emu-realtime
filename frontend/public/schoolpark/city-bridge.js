/* The only adapter between City and the existing parent app. No Firebase
 * initialisation, identity issuance, Quest completion or reward logic here. */
export function createBridge(parent, app) {
  const api = 'https://emu-realtime.onrender.com/api/schoolpark/city';
  let generation = 0;
  let currentUid = parent.auth?.currentUser?.uid || '';
  let identityId = parent._spIdentity?.schoolParkId || '';
  let changed = () => {};
  function bounded(promise) {
    let timer;
    return Promise.race([Promise.resolve(promise), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('CITY_UNAVAILABLE')), 15000);
    })]).finally(() => clearTimeout(timer));
  }
  function reset() { generation++; changed(); }
  function checkSession() {
    const uid = parent.auth?.currentUser?.uid || '';
    if (uid !== currentUid) { currentUid = uid; reset(); }
    if (!uid) throw new Error('AUTH_REQUIRED');
    return generation;
  }
  function stillCurrent(version) {
    checkSession();
    if (generation !== version) throw new Error('SESSION_CHANGED');
  }
  async function jsonRequest(url, body, method) {
    const version = checkSession();
    const headers = await bounded(parent.emuAuthHeaders(body !== undefined, { interactive: false }));
    stillCurrent(version);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(url, { method: method || (body === undefined ? 'GET' : 'POST'),
        headers, body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store', signal: controller.signal });
      stillCurrent(version);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'CITY_UNAVAILABLE');
      stillCurrent(version);
      return data;
    } finally { clearTimeout(timer); }
  }
  async function allowNavigation() {
    const version = checkSession();
    const access = await bounded(parent.spEnsureSchoolParkAccess(false));
    stillCurrent(version);
    if (!access?.allowed) throw new Error('SCHOOLPARK_ACCESS_DENIED');
  }
  function leaveForExisting() { app.cityReturn = true; }
  async function guildMemberships(p) {
    const defs = await parent.spGuildDefs();
    const mine = String(p.addr || '').toLowerCase();
    if (!mine) return null;
    const rows = await Promise.all(defs.map(async g => {
      // Reuse the existing shared read cache. Do not trust an unkeyed UI label
      // that may still belong to the previous login while the parent reloads.
      const [joins, supports] = await Promise.all(['joins','supports'].map(kind =>
        parent._spReadAll('sp_guild_members/' + encodeURIComponent(g.id) + '/' + kind)));
      if (!joins || !supports) throw new Error('CITY_UNAVAILABLE');
      const label = joins.some(d => String(d.id).toLowerCase() === mine) ? '参加したい'
        : supports.some(d => String(d.id).toLowerCase() === mine) ? '応援している' : '';
      return label ? { id:g.id, name:g.name, label } : null;
    }));
    return rows.filter(Boolean);
  }
  const apiBridge = {
    getSpots: () => jsonRequest(api + '/spots'),
    getShops: () => jsonRequest(api + '/shops'),
    prepareShopCheckout: (shopId, productId) => jsonRequest(api + '/shops/checkout', {shopId,productId}),
    getCommerceShops: () => jsonRequest('https://emu-realtime.onrender.com/api/mitemiru/shops'),
    getCommerceProducts: (shopId) => jsonRequest('https://emu-realtime.onrender.com/api/mitemiru/products?shopId=' + encodeURIComponent(shopId)),
    getCommerceMe: () => jsonRequest('https://emu-realtime.onrender.com/api/mitemiru/me'),
    getCommerceOrders: () => jsonRequest('https://emu-realtime.onrender.com/api/mitemiru/orders'),
    getCommerceAdminProducts: () => jsonRequest('https://emu-realtime.onrender.com/api/mitemiru/admin/products'),
    seedReizoSticker: () => jsonRequest('https://emu-realtime.onrender.com/api/mitemiru/admin/city/reizo-sticker', {}),
    publishCommerceProduct: (id) => jsonRequest('https://emu-realtime.onrender.com/api/mitemiru/admin/products/' + encodeURIComponent(id), { status:'live' }, 'PUT'),
    /* method は emuer_ledger（ウォレットに移す前のEMUER）か emuer_chain（ウォレットのEMUER）。
       金額はサーバーが商品から決める。ここからは送らない。 */
    /* extra は物の受け取り方と配送先（{ delivery, shipping }）。物でなければ空。 */
    placeCommerceOrder: (productId, requestId, method = 'emuer_ledger', extra = {}) => jsonRequest('https://emu-realtime.onrender.com/api/mitemiru/orders',
      { productId, method: method === 'emuer_chain' ? 'emuer_chain' : 'emuer_ledger', requestId,
        ...(extra.delivery ? { delivery: extra.delivery } : {}), ...(extra.shipping ? { shipping: extra.shipping } : {}) }),
    adminShipping: (status = 'pending') => jsonRequest('https://emu-realtime.onrender.com/api/mitemiru/admin/shipping?status=' + (status === 'shipped' ? 'shipped' : 'pending')),
    shipOrder: (id) => jsonRequest('https://emu-realtime.onrender.com/api/mitemiru/admin/orders/' + encodeURIComponent(id) + '/ship', {}),
    adminMetrics: (days = 30) => jsonRequest('https://emu-realtime.onrender.com/api/mitemiru/admin/metrics?days=' + encodeURIComponent(days)),
    /* 公式ショップの見られ方（回数だけ）。 */
    trackShop: (event, productId) => jsonRequest('https://emu-realtime.onrender.com/api/mitemiru/metrics',
      { event, ...(productId ? { productId } : {}) }),
    confirmCommerceOrder: (id) => jsonRequest('https://emu-realtime.onrender.com/api/mitemiru/orders/' + encodeURIComponent(id) + '/confirm', {}),
    cancelCommerceOrder: (id) => jsonRequest('https://emu-realtime.onrender.com/api/mitemiru/orders/' + encodeURIComponent(id) + '/cancel', {}),
    exchangeAuthorization: (id) => jsonRequest('https://emu-realtime.onrender.com/api/mitemiru/orders/' + encodeURIComponent(id) + '/exchange-authorization', {}),
    /* ウォレットのEMUER（受け取り済みのぶん）。Emu のウォレットの「使えるEMUER」と同じ数字。
       読むだけなので MetaMask の許可は求めない（eth_requestAccounts は呼ばない）。
       読めないときは null（0 とは書かない）。 */
    async walletEmuer(address) {
      const eth = parent.ethereum, E = parent.ethers;
      if (!eth || !E || typeof parent.emuerV2ConfigOnce !== 'function' || !/^0x[0-9a-fA-F]{40}$/.test(String(address || ''))) return null;
      try {
        const config = await bounded(parent.emuerV2ConfigOnce());
        if (!config?.contract) return null;
        const provider = new E.providers.Web3Provider(eth);
        if (Number((await bounded(provider.getNetwork())).chainId) !== 137) return null;
        const token = new E.Contract(config.contract, ['function balanceOf(address) view returns (uint256)'], provider);
        const value = await bounded(token.balanceOf(address));
        return Number(E.utils.formatUnits(value, 18));
      } catch (_) { return null; }
    },
    /* ウォレットのEMUERで払う。サーバーの署名つきで EMUERv2.payExchange を呼ぶ（みてみると同じ）。
       払うのは、注文の宛先になっているウォレット（MetaMask で別のアカウントを開いていたら止める）。
       MetaMask の確認は人が待つので、時間で打ち切らない。 */
    async payExchange(x, expectedWallet) {
      const eth = parent.ethereum, E = parent.ethers;
      if (!eth || !E) throw new Error('WALLET_NOT_FOUND');
      const version = checkSession();
      const accounts = await eth.request({ method: 'eth_requestAccounts' });
      stillCurrent(version);
      const now = String((accounts || [])[0] || '').toLowerCase();
      if (expectedWallet && now !== String(expectedWallet).toLowerCase()) throw new Error('WALLET_MISMATCH');
      const provider = new E.providers.Web3Provider(eth);
      if (Number((await provider.getNetwork()).chainId) !== 137) {
        try { await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x89' }] }); }
        catch (_) { throw new Error('POLYGON_REQUIRED'); }
      }
      const signer = new E.providers.Web3Provider(eth).getSigner();
      const c = new E.Contract(x.contract, ['function payExchange(bytes32,bytes32,uint256,uint256,bytes)'], signer);
      const tx = await c.payExchange(x.orderId, x.productId, x.price, x.deadline, x.authorization);
      await tx.wait();
      stillCurrent(version);
      return tx.hash;
    },
    /* 交換したデジタルの品を受け取る。ファイル名はサーバーが一覧から決めたもの。 */
    async downloadDigital(orderId, fileName) {
      const version = checkSession();
      const headers = await bounded(parent.emuAuthHeaders(false, { interactive:false }));
      stillCurrent(version);
      const res = await bounded(fetch('https://emu-realtime.onrender.com/api/mitemiru/orders/' + encodeURIComponent(orderId) + '/digital',
        { headers, cache:'no-store' }));
      stillCurrent(version);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'DIGITAL_ASSET_UNAVAILABLE');
      }
      const blob = await res.blob();
      stillCurrent(version);
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = /^[A-Za-z0-9._-]{1,120}$/.test(String(fileName || '')) ? fileName : 'schoolpark-item'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    },
    getOpsOrders: (code) => jsonRequest('https://emu-realtime.onrender.com/api/mitemiru/admin/orders?code=' + encodeURIComponent(code)),
    fulfillOpsOrder: (id) => jsonRequest('https://emu-realtime.onrender.com/api/mitemiru/admin/orders/' + encodeURIComponent(id) + '/fulfill', {}),
    getEventQR: (id) => jsonRequest('https://emu-realtime.onrender.com/api/mitemiru/admin/products/' + encodeURIComponent(id) + '/event-qr'),
    getMyCity: () => jsonRequest(api + '/me'),
    checkIn: spot => jsonRequest(api + '/checkins', { spotId: spot.spotId, checkInType: spot.checkInType }),
    async achievements(expectedPassportId) {
      const version = checkSession();
      const p = await bounded(parent.spPassportLoad());
      stillCurrent(version);
      if (!p || p.uid !== currentUid || (expectedPassportId && p.spid !== expectedPassportId)) throw new Error('SESSION_CHANGED');
      const [quests, stars, guilds] = await Promise.allSettled([
        bounded(parent.spCompletedQuests(p)),
        jsonRequest('https://emu-realtime.onrender.com/api/schoolpark/quest-completions/stars/mine'),
        bounded(guildMemberships(p))
      ]);
      stillCurrent(version);
      return {
        quests: quests.status === 'fulfilled' ? quests.value : null,
        stars: stars.status === 'fulfilled' ? stars.value.stars : null,
        guilds: guilds.status === 'fulfilled' ? guilds.value : null
      };
    },
    async openQuest(id) {
      const version = checkSession();
      await allowNavigation();
      if (id && !app.state.quests.some(q => q.id === id)) await bounded(parent.spDaoLoadQuests(app));
      stillCurrent(version);
      if (id && !app.state.quests.some(q => q.id === id)) throw new Error('QUEST_UNAVAILABLE');
      leaveForExisting();
      if (id) app.openExp(id)(); else app.go('experiments')();
    },
    async openGuild(id) { await allowNavigation(); leaveForExisting(); await parent.spGuildOpen(id, app); },
    async openEmu() { await allowNavigation(); await parent.chesHubGo('emu'); },
    async openPassport() { await allowNavigation(); await parent.openSpPassport(); },
    /* お問い合わせ（出店の相談など）。Emu の画面のお問い合わせを、その種類で開く。
       入力の途中（2つ目より先の手順）なら、そのまま開くだけにする。
       次へを押すと、途中の内容を確かめて送信まで進んでしまうため。
       Emu の画面が無いときは、同じフォームを別のタブで開く。 */
    openContact(type) {
      const kind = /^[a-z]{1,20}$/.test(String(type || '')) ? String(type) : 'general';
      try {
        const doc = parent.document;
        const panel = doc.getElementById('emu-contact-panel');
        const pick = doc.querySelector('.w-cat-btn[data-type="' + kind + '"]');
        if (panel && pick && typeof parent.toggleContactPanel === 'function' && typeof parent.selectCategory === 'function') {
          if (!panel.classList.contains('open')) parent.toggleContactPanel();
          if (typeof parent.switchContactTab === 'function') parent.switchContactTab('contact');
          const back = doc.getElementById('w-back');
          const firstStep = !back || back.style.display === 'none' || back.style.display === '';
          if (firstStep) {
            parent.selectCategory(pick);
            if (typeof parent.nextStep === 'function') parent.nextStep();
          }
          return true;
        }
      } catch (_) { /* 別の場所から開かれている */ }
      window.open('https://emu-for-schoolpark.vercel.app/?contact=' + encodeURIComponent(kind), '_blank', 'noopener');
      return false;
    },
    onSessionChange(fn) {
      changed = fn;
      // Register only after City is first opened. Nothing is subscribed at app startup.
      parent.fbAuth?.onAuthStateChanged(parent.auth, user => {
        const uid = user?.uid || '';
        if (uid !== currentUid) { currentUid = uid; reset(); }
      });
      parent.addEventListener('schoolpark-id', event => {
        const id = event.detail?.schoolParkId || '';
        if (id !== identityId) { identityId = id; reset(); }
      });
    },
    // No UID, address, name, KYC, statistics or private URL in this allowlisted payload.
    sharePayload(spotNames) {
      return { title: 'MyCity · SchoolPark City',
        text: 'SchoolPark CityのDEMOを体験しました。\n'
          + spotNames.map(name => String(name).slice(0, 80)).join(' / ')
          + '\n現実も、仮想も、学びのフィールドになる。',
        url: 'https://schoolpark-emu.vercel.app/' };
    }
  };
  return apiBridge;
}
