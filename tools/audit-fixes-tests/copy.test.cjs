'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const read=file=>fs.readFileSync('frontend/public/'+file,'utf8');
test('F10: current paid feature table and gift do not offer retired public features',()=>{
 const terms=read('terms.html'),table=terms.split('<table style="margin:10px 0;">')[1].split('</table>')[0];
 assert.doesNotMatch(table,/一日シェア|議論/);
 const trade=read('tokushoho.html');assert.doesNotMatch(trade,/一日シェアの記録7日|議論の作成10件|議論への発言。/);
 assert.match(trade,/提供は終了しました/);assert.doesNotMatch(read('emu-gift-ui.js'),/回答・一日シェアができます/);
 assert.doesNotMatch(read('privacy.html'),/上位プランへ変更された場合に再表示/);
 // These corrections must not change the agreed prices or the Pro guarantee.
 for(const value of ['500円','3,000円','10,000円'])assert.ok(trade.includes(value));
 assert.match(terms,/文字のみのやりとりは本条の対話機会に含みません/);
});
test('F13/F14: language and mobile help directions match current implementation',()=>{
 for(const file of ['terms.html','tokushoho.html'])assert.doesNotMatch(read(file),/表示言語（日本語・英語・中国語・韓国語）/);
 const faq=read('reizo/knowledge.js');assert.doesNotMatch(faq,/スマホは上部の「切替」/);assert.match(faq,/スマホも右上のプロフィール/);
});
