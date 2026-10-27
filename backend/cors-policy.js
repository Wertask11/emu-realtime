/* どのサイトの画面からなら、このサーバーを呼んでよいか。

   前は cors() を何も指定せずに使っていて、どのサイトからでも呼べた。
   ログインの証（IDトークン）はヘッダーで送るので、それだけで他人の記録が
   読めるわけではないが、知らないサイトがここを踏み台に使える状態だった。
   自分たちの画面（本番・プレビュー・Camellia・ホームページ・手元の確認）だけにする。

   Origin の無い呼び出し（サーバー同士、Stripe の webhook、curl）はそのまま通す。
   足りないときは環境変数 CORS_EXTRA_ORIGINS にカンマ区切りで足す。 */
const PATTERNS = [
  /^https:\/\/schoolpark-emu\.vercel\.app$/,
  /* 新しい名前（Emu for SchoolPark）の URL。旧 URL は移行が終わるまで残す。 */
  /^https:\/\/emu-for-schoolpark\.vercel\.app$/,
  /^https:\/\/camellia-beta\.vercel\.app$/,
  /^https:\/\/school-park-homepage\.vercel\.app$/,
  /* プレビュー。末尾がチーム名（school-park）のものだけ。
     名前の頭だけで見ると、よそのチームが似た名前の project を作れば通ってしまう。 */
  /^https:\/\/(?:emu-realtime|camellia-beta|school-park-homepage)[a-z0-9-]*-school-park\.vercel\.app$/,
  /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/
];

function extraOrigins(env) {
  return String((env || {}).CORS_EXTRA_ORIGINS || "")
    .split(",").map(s => s.trim().replace(/\/+$/, "")).filter(Boolean);
}

function originAllowed(origin, env) {
  if (!origin) return true;
  const o = String(origin);
  return PATTERNS.some(re => re.test(o)) || extraOrigins(env).includes(o);
}

function corsOptions(env) {
  return {
    origin(origin, done) { done(null, originAllowed(origin, env)); }
  };
}

module.exports = { originAllowed, corsOptions };
