"use strict";

/* 完走証明NFTの絵（11/20 オーナー：「証明NFT全部同じなのも嫌」）。

   前はどの証明書も「暗い四角に同じ星」で、ウォレットの一覧では区別がつかなかった。
   1枚ずつ違って見えるように、次の3つで描き分ける。
     ・ギルドの色      … 夜空の地平の色（LEARN 緑・WORK 砂・PLAY 橙・CONNECT 紅・WEB3 紫）
     ・クエストの番号  … まん中に大きく（#002-5 など）。一覧の小さな絵でも読める
     ・その完走だけの星座 … 証明書の鍵（completionKey）から星の並びを決める。同じクエストでも人・周ごとに違う
   名前・題名・日付・周回は下に添える。外の画像・フォントは使わない（SVG だけで完結）。 */

const crypto = require("crypto");

/* 絵に使う色。ギルドの色そのもの（WORK は #141310）だと暗い地に沈むので、明るい組を別に持つ */
const ART = {
  learn:   { glow: "#3FB57E", deep: "#0E3B2B", ink: "#CFF2DE" },
  work:    { glow: "#C9A86A", deep: "#3A2E1C", ink: "#F3E6C8" },
  play:    { glow: "#F08A4B", deep: "#4A2412", ink: "#FFE2CC" },
  connect: { glow: "#E0607F", deep: "#4A1724", ink: "#FFD9E2" },
  web3:    { glow: "#8C7CF0", deep: "#241C52", ink: "#E3DEFF" }
};
const NONE = { glow: "#A8A090", deep: "#2A2822", ink: "#EEE9DD" };

const esc = t => String(t == null ? "" : t).replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* 鍵から決まった並びの数を取り出す（同じ証明書なら、いつ描いても同じ絵） */
function seeded(key) {
  let buf = crypto.createHash("sha256").update(String(key || "")).digest();
  let i = 0;
  return function next() {
    if (i + 2 > buf.length) { buf = crypto.createHash("sha256").update(buf).digest(); i = 0; }
    const v = buf.readUInt16BE(i); i += 2;
    return v / 65535;
  };
}

/* 「一般 #002-5 実践」→ { series:"一般", number:"#002-5", stage:"実践" } */
function splitLabel(label) {
  const s = String(label || "").trim();
  const m = s.match(/^(.*?)(#[0-9A-Za-z-]+)(.*)$/);
  if (!m) return { series: "", number: s.slice(0, 10), stage: "" };
  return { series: m[1].trim(), number: m[2], stage: m[3].trim() };
}

/* 題名を2行までに折る（全角で1行14字ほど） */
function wrap(title, per = 14, lines = 2) {
  const chars = Array.from(String(title || ""));
  const out = [];
  for (let k = 0; k < lines && chars.length; k++) out.push(chars.splice(0, per).join(""));
  if (chars.length && out.length) out[out.length - 1] = out[out.length - 1].slice(0, -1) + "…";
  return out;
}

function certificateSvg({ key, guildId, guild, label, title, round, completedAt }) {
  const c = ART[guildId] || NONE;
  const rnd = seeded(key);
  const { series, number, stage } = splitLabel(label);

  /* 背景の小さな星（80個）。鍵ごとに散らばり方が変わる */
  let dust = "";
  for (let k = 0; k < 80; k++) {
    const x = (rnd() * 640).toFixed(1), y = (rnd() * 470).toFixed(1);
    const r = (0.4 + rnd() * 1.3).toFixed(2), o = (0.25 + rnd() * 0.6).toFixed(2);
    dust += '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="#fff" opacity="' + o + '"/>';
  }

  /* この完走だけの星座（6〜8個の星を線でつなぐ）。上の帯（y 70〜250）に置き、番号の文字とは重ねない */
  const count = 6 + Math.floor(rnd() * 3);
  const pts = [];
  for (let k = 0; k < count; k++) {
    const x = 70 + (k + rnd() * 0.8) * (500 / count);
    const y = 80 + rnd() * 150;
    pts.push([x, y, 2.6 + rnd() * 3.2]);
  }
  const path = pts.map((p, k) => (k ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const stars = pts.map(p =>
    '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="' + (p[2] * 3).toFixed(1) + '" fill="url(#halo)"/>'
    + '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="' + p[2].toFixed(1) + '" fill="#fff"/>').join("");

  const day = Number(completedAt) > 0 ? new Date(Number(completedAt) + 9 * 3600000).toISOString().slice(0, 10).replace(/-/g, ".") : "";
  const titleLines = wrap(title);
  const roundText = Number(round) > 1 ? "　" + Number(round) + "周目" : "";
  const numberSize = number.length > 7 ? 74 : 92;

  return '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640">'
    + '<defs>'
    + '<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#070B1C"/><stop offset=".55" stop-color="' + esc(c.deep) + '"/>'
    + '<stop offset="1" stop-color="' + esc(c.glow) + '"/></linearGradient>'
    + '<radialGradient id="halo"><stop offset="0" stop-color="' + esc(c.ink) + '" stop-opacity=".9"/>'
    + '<stop offset="1" stop-color="' + esc(c.glow) + '" stop-opacity="0"/></radialGradient>'
    + '</defs>'
    + '<rect width="640" height="640" fill="url(#sky)"/>'
    + dust
    /* 地平の丘（ギルドの色） */
    + '<path d="M0 560 Q160 500 320 530 T640 515 V640 H0z" fill="' + esc(c.deep) + '" opacity=".85"/>'
    + '<path d="' + path + '" stroke="' + esc(c.ink) + '" stroke-width="1.6" stroke-opacity=".55" fill="none"/>'
    + stars
    /* 上の帯：SchoolPark とギルドの札 */
    + '<text x="40" y="52" fill="#F4F1EA" font-size="22" font-family="sans-serif" font-weight="700" letter-spacing="2">SchoolPark</text>'
    + (guild ? '<rect x="' + (600 - (guild.length * 15 + 34)) + '" y="28" rx="16" width="' + (guild.length * 15 + 34) + '" height="32" fill="' + esc(c.glow) + '"/>'
      + '<text x="' + (600 - (guild.length * 15 + 34) / 2) + '" y="50" text-anchor="middle" fill="#0B0F1F" font-size="17" font-family="sans-serif" font-weight="800" letter-spacing="1.5">' + esc(guild) + '</text>' : '')
    /* まん中：クエストの番号を大きく */
    + (series ? '<text x="320" y="300" text-anchor="middle" fill="' + esc(c.ink) + '" font-size="24" font-family="sans-serif" letter-spacing="4">' + esc(series) + (stage ? '・' + esc(stage) : '') + '</text>' : '')
    + '<text x="320" y="' + (series ? 392 : 360) + '" text-anchor="middle" fill="#FFFFFF" font-size="' + numberSize + '" font-family="sans-serif" font-weight="800">' + esc(number) + '</text>'
    /* 下：題名・完走日・周回 */
    + titleLines.map((t, k) => '<text x="320" y="' + (450 + k * 34) + '" text-anchor="middle" fill="#F4F1EA" font-size="26" font-family="sans-serif">' + esc(t) + '</text>').join("")
    + '<text x="320" y="602" text-anchor="middle" fill="' + esc(c.ink) + '" font-size="20" font-family="sans-serif" font-weight="700" letter-spacing="1">'
    + esc((day ? day + "　完走" : "完走") + roundText) + '</text>'
    + '</svg>';
}

module.exports = { certificateSvg, splitLabel, ART };
