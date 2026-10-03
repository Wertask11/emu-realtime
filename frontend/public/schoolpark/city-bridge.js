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
  async function jsonRequest(url, body) {
    const version = checkSession();
    const headers = await bounded(parent.emuAuthHeaders(body !== undefined, { interactive: false }));
    stillCurrent(version);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(url, { method: body === undefined ? 'GET' : 'POST',
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
    goHome() { app.cityReturn = false; app.go('home')(); },
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
