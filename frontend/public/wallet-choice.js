/* ウォレットを選んで入る（10/30 オーナーから）。

   「ウォレットではじめる」を押したら、どのウォレットで入るかを選んでもらう。
     - MetaMask：これまでどおり（ブラウザの MetaMask。スマホでは MetaMask アプリで開き直す）
     - HashPort Wallet など：WalletConnect でつなぐ。パソコンでは QR コードをスマホのウォレットで
       読み取り、スマホではウォレットのアプリに切り替わって承認する

   つないだウォレットは window.ethereum に置く。Emu はウォレットとのやりとりを
   すべて window.ethereum で行っているので（署名・残高・受け取り）、そのまま同じ流れで使える。
   スマートコントラクト型のウォレットの署名は、サーバーが Polygon に聞いて確かめる（backend/wallet-signature.js）。

   WalletConnect の部品（約2MB）は、選んだときにだけ読み込む（vendor/walletconnect/）。
   プロジェクトID は Reown（cloud.reown.com）で発行したもの。公開して使う値で、秘密ではない。 */
(function () {
  'use strict';
  var WC_PROJECT_ID = '80d72a3cd33769b8dfc50bd48b224c6a';   // Reown「Emu for SchoolPark」（2026-10-30 オーナー発行）
  var WC_SRC = '/vendor/walletconnect/ethereum-provider-2.26.0.js';
  var POLYGON = 137;

  var injected = null;       // ブラウザに元からある MetaMask（WalletConnect に置き換える前）
  var injectedSeen = false;
  var wcProvider = null;
  var wcLoading = null;

  function rememberInjected() {
    if (injectedSeen) return;
    injectedSeen = true;
    injected = (typeof window.ethereum !== 'undefined' && window.ethereum !== wcProvider) ? window.ethereum : null;
  }
  /* window.ethereum を差し替える。ブラウザの拡張機能が書き換えを禁じていることがあるので、確かめる */
  function useProvider(p) {
    try { Object.defineProperty(window, 'ethereum', { value: p, configurable: true, writable: true }); } catch (e) {}
    if (window.ethereum !== p) {
      try { window.ethereum = p; } catch (e) {}
    }
    return window.ethereum === p;
  }
  function useInjected() {
    rememberInjected();
    if (injected && window.ethereum !== injected) useProvider(injected);
    if (!injected && wcProvider && window.ethereum === wcProvider) {
      try { delete window.ethereum; } catch (e) {}
      if (window.ethereum === wcProvider) useProvider(undefined);
    }
  }

  function loadWalletConnect() {
    if (window.EmuWalletConnect) return Promise.resolve();
    if (!wcLoading) {
      wcLoading = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = WC_SRC;
        s.async = true;
        s.onload = function () { window.EmuWalletConnect ? resolve() : reject(new Error('WC_LOAD_FAILED')); };
        s.onerror = function () { wcLoading = null; reject(new Error('WC_LOAD_FAILED')); };
        document.head.appendChild(s);
      });
    }
    return wcLoading;
  }

  /* WalletConnect の窓口を作る（つなぐのは connect）。前のつなぎが端末に残っていれば、それを読み込む */
  async function initProvider() {
    await loadWalletConnect();
    if (!wcProvider) {
      wcProvider = await window.EmuWalletConnect.EthereumProvider.init({
        projectId: WC_PROJECT_ID,
        chains: [POLYGON],
        showQrModal: true,
        methods: ['eth_sendTransaction', 'personal_sign', 'eth_signTypedData_v4', 'wallet_switchEthereumChain', 'wallet_addEthereumChain'],
        events: ['chainChanged', 'accountsChanged'],
        rpcMap: { 137: 'https://polygon-bor-rpc.publicnode.com' },
        metadata: {
          name: 'Emu for SchoolPark',
          description: 'SchoolPark / Emu にウォレットで入ります',
          url: location.origin,
          icons: [location.origin + '/logo.jpg'],
          // 承認したあと、ウォレットから Emu に戻ってくる先（対応しているウォレットだけが使う）
          redirect: { universal: location.origin + '/' }
        },
        qrModalOptions: { themeMode: 'light' }
      });
      wcProvider.on('disconnect', function () {
        if (window.ethereum === wcProvider) useInjected();
        try { localStorage.removeItem(RESUME_KEY); } catch (e) {}
      });
      guideRequests(wcProvider);
    }
    return wcProvider;
  }
  async function connectWalletConnect() {
    await initProvider();
    // 前につないだぶんが残っていれば、QR を出さずにそのまま使う
    if (!wcProvider.session) {
      try { localStorage.setItem(RESUME_KEY, String(Date.now())); } catch (e) {}
      await wcProvider.connect();
    }
    if (!useProvider(wcProvider)) throw new Error('ETHEREUM_LOCKED');
    return wcProvider;
  }

  /* ───── スマホで、ウォレットのアプリと行き来するときの案内 ─────
     スマホでは「接続」と「署名」で2回、ウォレットのアプリに切り替わる。承認しても、
     ウォレットによっては Emu に自動で戻らない。戻ってきたときにブラウザがページを
     開き直すこともある（10/30 オーナー：何回もログイン画面が出る）。
       - 署名などを待つあいだは「ウォレットで承認 → Emu に戻る」を画面に出し、ウォレットを開くボタンを置く
       - 接続の途中・ログインのあとでページが開き直されたら、つなぎ（端末に残る）を使って続きから入る */
  var RESUME_KEY = 'emuWcLogin';
  var RESUME_MS = 30 * 60 * 1000;
  var NEEDS_WALLET = { personal_sign: '署名', eth_signTypedData_v4: '署名', eth_sendTransaction: '取引', wallet_switchEthereumChain: 'ネットワークの切り替え', wallet_addEthereumChain: 'ネットワークの追加' };
  var isMobile = function () { return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || ''); };
  function walletName() {
    try { return (wcProvider.session.peer.metadata.name || '').slice(0, 40) || 'ウォレット'; } catch (e) { return 'ウォレット'; }
  }
  /* ウォレットのアプリを開くリンク。WalletConnect がスマホで選んだウォレットを覚えている（WALLETCONNECT_DEEPLINK_CHOICE）。
     無ければ、ウォレットが名乗った戻り先を使う。 */
  function walletLink() {
    try {
      var c = JSON.parse(localStorage.getItem('WALLETCONNECT_DEEPLINK_CHOICE') || 'null');
      if (c && typeof c.href === 'string' && /^[a-z][a-z0-9+.-]*:/i.test(c.href)) return c.href;
    } catch (e) {}
    try {
      var r = wcProvider.session.peer.metadata.redirect || {};
      return r.native || r.universal || '';
    } catch (e) { return ''; }
  }
  function guideEl() {
    var el = document.getElementById('emuWalletGuide');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'emuWalletGuide';
    el.className = 'emu-wc-guide';
    el.setAttribute('role', 'status');
    el.hidden = true;
    el.innerHTML = '<div class="emu-wc-card"><h2 class="emu-wc-guide-title"></h2>'
      + '<ol class="emu-wc-steps"></ol>'
      + '<a class="emu-wc-open" target="_self" rel="noopener" hidden></a>'
      + '<button type="button" class="emu-wc-later" data-wc="hide-guide">この案内を閉じる</button></div>';
    el.querySelector('[data-wc="hide-guide"]').onclick = function () { el.hidden = true; };
    document.body.appendChild(el);
    return el;
  }
  function showGuide(what) {
    var el = guideEl(), name = walletName(), mobile = isMobile();
    el.querySelector('.emu-wc-guide-title').textContent = name + ' で「' + what + '」を承認してください';
    el.querySelector('.emu-wc-steps').innerHTML = mobile
      ? '<li>' + escapeText(name) + ' のアプリを開く（自動で開かなければ、下のボタン）</li>'
        + '<li>「' + escapeText(what) + '」を承認する</li>'
        + '<li>このページ（Emu）に戻ってくる。自動で戻らないときは、ブラウザのアプリに切り替える</li>'
        + '<li>戻ってきたら、そのまま待つと続きます</li>'
      : '<li>スマホの ' + escapeText(name) + ' に届いた「' + escapeText(what) + '」を承認する</li>'
        + '<li>承認すると、この画面が自動で続きます</li>';
    var link = mobile ? walletLink() : '';
    var a = el.querySelector('.emu-wc-open');
    a.hidden = !link;
    if (link) { a.href = link; a.textContent = name + ' を開く'; }
    el.hidden = false;
  }
  function hideGuide() { var el = document.getElementById('emuWalletGuide'); if (el) el.hidden = true; }
  function escapeText(s) { var d = document.createElement('span'); d.textContent = String(s); return d.innerHTML; }
  function guideRequests(p) {
    var original = p.request.bind(p);
    p.request = async function (args) {
      var what = args && NEEDS_WALLET[args.method];
      if (what) showGuide(what);
      try { return await original(args); }
      finally { if (what) hideGuide(); }
    };
  }

  /* ページが開き直されたとき：WalletConnect のつなぎが残っていれば、それを使って続きから入る。
     使えるつなぎがあれば window.ethereum に置いて true を返す（QR は出さない）。 */
  window.emuWalletConnectResume = async function () {
    if (!WC_PROJECT_ID) return false;
    var auth = null, started = 0;
    try { auth = JSON.parse(localStorage.getItem('emu_auth') || 'null'); } catch (e) {}
    try { started = Number(localStorage.getItem(RESUME_KEY) || 0); } catch (e) {}
    var connecting = started && Date.now() - started < RESUME_MS;
    var loggedIn = !!(auth && auth.type === 'wallet' && auth.provider === 'walletconnect');
    // WalletConnect で入る途中か、WalletConnect で入っていた人だけ（ほかの人には部品を読み込まない）。
    // つなぎそのものは WalletConnect が端末（IndexedDB）に持っているので、作ってみて確かめる
    if (!connecting && !loggedIn) return false;
    rememberInjected();
    try {
      await initProvider();   // QR は出さない。つなぎが無ければ何もしない
      if (!wcProvider.session) return false;
      return useProvider(wcProvider);
    } catch (e) { return false; }
  };
  /* ログインが終わった・やめたときに呼ぶ。続きから入る印を消す */
  window.emuWalletConnectDone = function () { try { localStorage.removeItem(RESUME_KEY); } catch (e) {} };

  var CLOSED = /reset|closed|rejected|cancel|denied|User disconnected/i;
  function failText(e) {
    var code = String(e && e.message || e || '');
    if (code === 'WC_LOAD_FAILED') return 'WalletConnect を読み込めませんでした。通信を確かめて、もう一度お試しください。';
    if (code === 'ETHEREUM_LOCKED') return 'このブラウザの拡張機能（ウォレット）が、ほかのウォレットとのつなぎを止めています。拡張機能をいったん止めるか、別のブラウザでお試しください。';
    return 'ウォレットにつなげませんでした。もう一度お試しください。';
  }

  /* ───── 選ぶ画面 ───── */
  function sheet() {
    var el = document.getElementById('emuWalletChoice');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'emuWalletChoice';
    el.className = 'emu-wc-sheet';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'emuWalletChoiceTitle');
    el.hidden = true;
    var ready = !!WC_PROJECT_ID;
    el.innerHTML = '<div class="emu-wc-card">'
      + '<button type="button" class="emu-wc-close" aria-label="閉じる" data-wc="close">×</button>'
      + '<h2 id="emuWalletChoiceTitle">どのウォレットで入りますか</h2>'
      + '<button type="button" class="emu-wc-option" data-wc="metamask">'
      + '<span class="emu-wc-name">🦊 MetaMask</span>'
      + '<span class="emu-wc-note">このブラウザの MetaMask で入ります。スマホでは MetaMask アプリで開き直します。</span></button>'
      + '<button type="button" class="emu-wc-option" data-wc="walletconnect"' + (ready ? '' : ' disabled') + '>'
      + '<span class="emu-wc-name">📱 HashPort Wallet など</span>'
      + '<span class="emu-wc-note">' + (ready
        ? 'WalletConnect でつなぎます。パソコンでは、出てくる QR コードをスマホのウォレットで読み取ります。'
        : '準備中です。') + '</span></button>'
      + '<p class="emu-wc-hint">前にウォレットで入ったことがある方は、そのときと同じウォレットを選んでください。別のウォレットで入ると、別のパスポートになります。</p>'
      + '<p class="emu-wc-message" role="alert" hidden></p>'
      + '</div>';
    document.body.appendChild(el);
    return el;
  }
  var pending = null;
  function finish(kind) {
    var el = document.getElementById('emuWalletChoice');
    if (el) el.hidden = true;
    var done = pending; pending = null;
    if (done) done(kind);
  }

  /* 選んでもらい、選んだウォレットを window.ethereum に置いてから、'metamask' か 'walletconnect' を返す。
     閉じたとき・つなげなかったときは null（つなげなかった理由は画面に出す）。 */
  window.emuChooseWallet = function () {
    rememberInjected();
    if (pending) finish(null);
    var el = sheet();
    var msg = el.querySelector('.emu-wc-message');
    msg.hidden = true; msg.textContent = '';
    el.querySelectorAll('button').forEach(function (b) { if (b.getAttribute('data-wc') !== 'walletconnect' || WC_PROJECT_ID) b.disabled = false; });
    el.onclick = async function (e) {
      if (e.target === el) { finish(null); return; }
      var b = e.target.closest && e.target.closest('[data-wc]');
      if (!b || b.disabled) return;
      var kind = b.getAttribute('data-wc');
      if (kind === 'close') { finish(null); return; }
      if (kind === 'metamask') { useInjected(); finish('metamask'); return; }
      // WalletConnect：つながるまで選ぶ画面は残す（失敗したら、ここで理由を出す）
      el.querySelectorAll('button[data-wc]').forEach(function (x) { x.disabled = true; });
      b.querySelector('.emu-wc-note').textContent = 'つないでいます…（ウォレットで承認してください）';
      el.hidden = true;   // QR の画面を前に出す
      try {
        await connectWalletConnect();
        finish('walletconnect');
      } catch (err) {
        window.emuWalletConnectDone();
        el.hidden = false;
        el.querySelectorAll('button[data-wc]').forEach(function (x) { x.disabled = false; });
        b.querySelector('.emu-wc-note').textContent = 'WalletConnect でつなぎます。パソコンでは、出てくる QR コードをスマホのウォレットで読み取ります。';
        if (!CLOSED.test(String(err && err.message || err))) { msg.textContent = failText(err); msg.hidden = false; }
      }
    };
    el.hidden = false;
    var first = el.querySelector('.emu-wc-option');
    if (first) first.focus();
    return new Promise(function (resolve) { pending = resolve; });
  };
  document.addEventListener('keydown', function (e) {
    var el = document.getElementById('emuWalletChoice');
    if (e.key === 'Escape' && el && !el.hidden) finish(null);
  });
  /* ログインのあとに Emu が使う：いま WalletConnect でつないでいるか */
  window.emuWalletIsWalletConnect = function () { return !!wcProvider && window.ethereum === wcProvider; };

  var css = document.createElement('style');
  css.textContent = ''
    + '.emu-wc-sheet{position:fixed;inset:0;z-index:100001;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(33,31,28,.45)}'
    + '.emu-wc-sheet[hidden]{display:none}'
    + '.emu-wc-card{position:relative;width:100%;max-width:420px;max-height:90dvh;overflow:auto;padding:22px 18px 18px;border-radius:18px;background:#fff;color:#211f1c;box-shadow:0 18px 40px rgba(0,0,0,.2);font-size:15px;line-height:1.6}'
    + '.emu-wc-card h2{font-size:18px;margin:2px 36px 14px 2px}'
    + '.emu-wc-option{display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;margin:0 0 10px;padding:12px 14px;border:1px solid #e3d9c8;border-radius:14px;background:#fffaf2;color:inherit;font:inherit;text-align:left;cursor:pointer}'
    + '.emu-wc-option:disabled{opacity:.55;cursor:default}'
    + '.emu-wc-name{font-weight:700;font-size:16px}'
    + '.emu-wc-note{color:#6b6459;font-size:13px}'
    + '.emu-wc-hint{color:#6b6459;font-size:12px;margin:6px 2px 0}'
    + '.emu-wc-message{margin:10px 0 0;padding:10px 12px;border-radius:12px;background:#fff1dc;color:#8a4b00;font-size:14px}'
    + '.emu-wc-close{position:absolute;top:8px;right:8px;width:44px;height:44px;border:0;background:transparent;font-size:24px;color:#6b6459;cursor:pointer}'
    + '.emu-wc-option:focus-visible,.emu-wc-close:focus-visible{outline:3px solid #ef7d00;outline-offset:2px}'
    + '.emu-wc-guide{position:fixed;inset:0;z-index:100002;display:flex;align-items:flex-end;justify-content:center;padding:16px;background:rgba(33,31,28,.35)}'
    + '.emu-wc-guide[hidden]{display:none}'
    + '.emu-wc-guide h2{font-size:17px;margin:0 0 8px}'
    + '.emu-wc-steps{margin:0 0 12px;padding-left:1.4em;font-size:14px}'
    + '.emu-wc-steps li{margin:4px 0}'
    + '.emu-wc-open{display:block;margin:0 0 8px;padding:12px;border-radius:12px;background:#ef7d00;color:#fff;font-weight:700;text-align:center;text-decoration:none}'
    + '.emu-wc-open[hidden]{display:none}'
    + '.emu-wc-later{width:100%;padding:10px;border:1px solid #e3d9c8;border-radius:12px;background:#fff;color:#6b6459;font:inherit;cursor:pointer}';
  document.head.appendChild(css);
})();
