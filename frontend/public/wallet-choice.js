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
  var WC_PROJECT_ID = '';
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

  async function connectWalletConnect() {
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
          icons: [location.origin + '/logo.jpg']
        },
        qrModalOptions: { themeMode: 'light' }
      });
      wcProvider.on('disconnect', function () {
        if (window.ethereum === wcProvider) useInjected();
      });
    }
    // 前につないだぶんが残っていれば、QR を出さずにそのまま使う
    if (!wcProvider.session) await wcProvider.connect();
    if (!useProvider(wcProvider)) throw new Error('ETHEREUM_LOCKED');
    return wcProvider;
  }

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
    + '.emu-wc-option:focus-visible,.emu-wc-close:focus-visible{outline:3px solid #ef7d00;outline-offset:2px}';
  document.head.appendChild(css);
})();
