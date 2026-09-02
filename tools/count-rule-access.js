/* ルールが「ほかの文書を何回見に行くか」を数える。
   Firestore の上限は、1件の書き込みにつき10回。超えると条件に関係なく断られる。
   短絡（&& や ?: で途中で止まること）は数えないので、出る数は必ず実際より多い。
   つまりここで10以下なら、確実に上限に触れない。 */
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const fns = {};
const re = /function\s+(\w+)\s*\(([^)]*)\)\s*\{([\s\S]*?)\n    \}/g;
let m;
while ((m = re.exec(src))) fns[m[1]] = m[3];

const ACC = ['exists', 'get', 'getAfter'];
/* 「.get(」は文書の中身を取り出すほうで、見に行く回数には数えない。
   数えるのは、行の頭に立つ get( / exists( / getAfter( だけ。 */
const count = (body, name) =>
  (body.match(new RegExp('(?<![.\\w])' + name + '\\s*\\(', 'g')) || []).length;

function cost(name, seen) {
  const body = fns[name];
  if (!body || seen.includes(name)) return 0;
  const s2 = seen.concat([name]);
  let n = 0;
  for (const a of ACC) n += count(body, a);
  for (const k of Object.keys(fns)) {
    if (ACC.includes(k)) continue;
    const c = count(body, k);
    if (c) n += c * cost(k, s2);
  }
  return n;
}

console.log('短絡を無視した最大値。上限は10。');
for (const k of ['mayCreate', 'mayAddToLibrary', 'canWriteAs', 'myRank',
                 'isOwner', 'canGuild', 'isMyWallet', 'libraryDecremented', 'hasPass']) {
  const n = cost(k, []);
  console.log((k + ':').padEnd(22), String(n).padStart(3), n <= 10 ? 'OK' : '← 上限超え');
}
