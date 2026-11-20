"use strict";
/* 完走証明NFTの絵（11/20 オーナー：「証明NFT全部同じなのも嫌」） */
const test = require("node:test");
const assert = require("node:assert/strict");
const { certificateSvg, splitLabel } = require("./quest-certificate-art");

const base = { key: "0x" + "1".repeat(64), guildId: "work", guild: "WORK", label: "一般 #002-5 実践",
  title: "教材1単元（授業3回分＋確認テスト）", round: 1, completedAt: Date.parse("2026-10-11T03:00:00Z") };

test("番号・ギルド・題名・完走日が絵に入る", () => {
  const svg = certificateSvg(base);
  assert.match(svg, /^<svg [^>]*width="640" height="640"/);
  assert.ok(svg.includes(">#002-5<"), "番号を大きく出す");
  assert.ok(svg.includes(">WORK<"), "ギルドの札");
  assert.ok(svg.includes("一般・実践"));
  assert.ok(svg.includes("2026.10.11　完走"));
});

test("同じ証明書は、いつ描いても同じ絵。別の証明書（人・周）は違う絵", () => {
  assert.equal(certificateSvg(base), certificateSvg(base));
  assert.notEqual(certificateSvg(base), certificateSvg({ ...base, key: "0x" + "2".repeat(64) }));
});

test("ギルドが違えば色が違う。ギルドが無くても描ける", () => {
  const learn = certificateSvg({ ...base, guildId: "learn", guild: "LEARN" });
  assert.ok(learn.includes("#3FB57E") && !learn.includes("#C9A86A"));
  const none = certificateSvg({ ...base, guildId: "", guild: "", label: "特殊 #001" });
  assert.ok(none.includes(">#001<") && !none.includes(">WORK<"));
});

test("2周目以降は、そのことを書く", () => {
  assert.ok(certificateSvg({ ...base, round: 2 }).includes("2周目"));
  assert.ok(!certificateSvg(base).includes("周目"));
});

test("題名の文字は外へ漏れない（記号は文字として書く）", () => {
  const svg = certificateSvg({ ...base, title: '<script>alert("x")</script>&' });
  assert.ok(!svg.includes("<script>"));
  assert.ok(svg.includes("&lt;script&gt;"));
});

test("番号の取り出し", () => {
  assert.deepEqual(splitLabel("一般 #001 入門"), { series: "一般", number: "#001", stage: "入門" });
  assert.deepEqual(splitLabel("特殊 #002"), { series: "特殊", number: "#002", stage: "" });
});
