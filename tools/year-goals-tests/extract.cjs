/* HTML の中に書いた関数を、そのまま取り出して試すための道具。

   index.html と membership-admin.html は、画面と中身が1枚に入っている。
   中の関数だけを試したいので、本文から関数の字面を切り出して、
   こちらで用意した偽物（fetch や Firestore の代わり）といっしょに動かす。

   切り出しは中かっこの数を数えるだけ。ただし文字列とコメントの中の
   かっこは数えない。数えると、日本語のコメントや HTML の断片で狂う。 */
const fs = require('node:fs');
const path = require('node:path');

function readHtml(rel) {
  return fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
}

/* i 文字目から始まる { … } の、閉じかっこの次の位置を返す。 */
function endOfBlock(src, i) {
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { i = src.indexOf('\n', i); if (i < 0) return src.length; continue; }
    if (c === '/' && d === '*') { i = src.indexOf('*/', i + 2); if (i < 0) return src.length; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      i++; continue;
    }
    if (c === '{') depth++;
    if (c === '}') { depth--; if (depth === 0) return i + 1; }
    i++;
  }
  throw new Error('かっこが閉じていない');
}

/* 名前で関数を1つ取り出す。const / let / window. のどれで書かれていてもよい。 */
function grab(src, name) {
  /* async 付きを先に見る。先に 'function 名(' を探すと、
     'async function 名(' の途中に当たって async を落としてしまう。 */
  const heads = [
    'async function ' + name + '(',
    'function ' + name + '(',
    'window.' + name + ' = async function (',
    'window.' + name + ' = function (',
    'const ' + name + ' = async function (',
    'const ' + name + ' = function ('
  ];
  for (const h of heads) {
    const i = src.indexOf(h);
    if (i < 0) continue;
    const brace = src.indexOf('{', i + h.length - 1);
    const end = endOfBlock(src, brace);
    let text = src.slice(i, end);
    /* window.x = … の形は、素の宣言に直してから使う。 */
    text = text.replace(/^window\.(\w+)\s*=\s*(async\s*)?function\s*\(/, function (_, n, a) {
      return (a || '') + 'function ' + n + '(';
    });
    text = text.replace(/^const\s+(\w+)\s*=\s*(async\s*)?function\s*\(/, function (_, n, a) {
      return (a || '') + 'function ' + n + '(';
    });
    return text;
  }
  throw new Error('見つからない: ' + name);
}

/* 取り出した関数たちを、渡した入れ物（stubs）の中で動かす。 */
function build(src, names, stubs, extra) {
  const body = names.map(function (n) { return grab(src, n); }).join('\n\n');
  const keys = Object.keys(stubs);
  const fn = new Function(...keys, '"use strict";\n' + (extra || '') + '\n' + body
    + '\nreturn {' + names.join(',') + '};');
  return fn(...keys.map(function (k) { return stubs[k]; }));
}

module.exports = { readHtml, grab, build, endOfBlock };
