/* 体験チケットの QR（11/10）。City の交換履歴の「🎫 チケットを出す」で開く。
   QR の中身は /ticket.html?o=注文ID&c=引換コード。お店の人がカメラで読むと、チケットのページが開き、
   お店の暗証番号で「使用済み」にできる（backend/shop-tickets.js）。
   QR を作る部品（qrcode-generator 1.4.4・MIT）は、押したときに初めて読み込む。 */
(function () {
  'use strict';
  var loading = null;
  function lib() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    if (!loading) loading = new Promise(function (resolve, reject) {
      var s = document.createElement('script'); s.src = '/vendor/qrcode/qrcode-generator-1.4.4.js';
      s.onload = function () { resolve(window.qrcode); }; s.onerror = reject; document.head.appendChild(s);
    });
    return loading;
  }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  async function show(order, code, name) {
    var url = location.origin + '/ticket.html?o=' + encodeURIComponent(order) + '&c=' + encodeURIComponent(code);
    var svg = '';
    try { var q = (await lib())(0, 'M'); q.addData(url); q.make(); svg = q.createSvgTag({ cellSize: 6, margin: 4, scalable: true, alt: 'チケットのQRコード' }); } catch (_) { svg = ''; }
    var old = document.getElementById('cityTicketQr'); if (old) old.remove();
    var wrap = document.createElement('div');
    wrap.id = 'cityTicketQr'; wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-label', '体験チケット');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(20,19,16,.55);display:flex;align-items:center;justify-content:center;padding:16px';
    wrap.innerHTML = '<div style="background:#fff;color:#141310;border-radius:16px;padding:20px;max-width:400px;width:100%;text-align:center">'
      + '<p style="margin:0;font-size:12px;letter-spacing:.2em;color:#C2703D">TICKET</p>'
      + '<p style="margin:4px 0 0;font-weight:800;font-size:17px;overflow-wrap:anywhere">🎫 ' + esc(name) + '</p>'
      + (svg ? '<div data-qr style="width:min(76vw,280px);margin:12px auto">' + svg + '</div>' : '<p style="color:#b3261e">QR を作れませんでした。引換コードを見せてください。</p>')
      + '<p style="margin:4px 0 0;font-size:12px;color:#6E695C">引換コード</p><p style="margin:0;font:700 24px/1.3 ui-monospace,monospace;letter-spacing:.12em">' + esc(code) + '</p>'
      + '<p style="margin:10px 0 0;font-size:13px;line-height:1.7;color:#3B382F">お店の人に、この画面を見せてください。お店の人がカメラで読んで「使用済み」にします。</p>'
      + '<button type="button" data-ticket-close style="margin-top:12px;border:0;border-radius:999px;padding:10px 22px;background:#141310;color:#fff;font:inherit;font-weight:700;cursor:pointer">閉じる</button></div>';
    wrap.addEventListener('click', function (e) { if (e.target === wrap || (e.target.closest && e.target.closest('[data-ticket-close]'))) wrap.remove(); });
    document.body.appendChild(wrap);
    var s = wrap.querySelector('[data-qr] svg'); if (s) { s.style.width = '100%'; s.style.height = 'auto'; s.style.display = 'block'; }
    wrap.querySelector('[data-ticket-close]').focus();
  }
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-ticket-order]') : null;
    if (!b) return;
    e.preventDefault();
    show(b.getAttribute('data-ticket-order'), b.getAttribute('data-ticket-code'), b.getAttribute('data-ticket-name'));
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { var w = document.getElementById('cityTicketQr'); if (w) w.remove(); } });
})();
