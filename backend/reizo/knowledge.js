'use strict';
const fs = require('node:fs');
const path = require('node:path');
const faq = require('../../frontend/public/reizo/knowledge');
// Read the actual published guide data, never user/Firestore data. Fail closed if
// the guide format changes; keep the local FAQ working independently of AI.
function loadPages() {
  const source = fs.readFileSync(path.join(__dirname, '../../frontend/public/tour/reizo-tour-pages.js'), 'utf8');
  const start = source.indexOf('  var v2 = ');
  const end = source.indexOf('\n};', start);
  if (start < 0 || end < 0) throw Error('GUIDE_DATA_UNAVAILABLE');
  const guides = JSON.parse(source.slice(start + '  var v2 = '.length, end + 2));
  const pages = Object.fromEntries(Object.entries(guides).map(([id, guide]) => [id, {
    name: guide.name,
    features: guide.steps.map(step => step.text).slice(0, 10)
  }]));
  // These detail screens already have separate native guide registrations.
  for (const [id, parent] of Object.entries({ guild: 'guild', 'quest-detail': 'quest', plaza: 'park', tasks: 'home', 'year-goals': 'home' })) {
    if (!pages[id] && pages[parent]) pages[id] = { ...pages[parent], name: { 'quest-detail': 'クエストの詳細', plaza: '公園の広場', tasks: '自分の宿題', 'year-goals': '年内目標' }[id] || pages[parent].name };
  }
  return pages;
}
let pages;
function pageContext(id) {
  pages ||= loadPages();
  return typeof id === 'string' && Object.hasOwn(pages, id) ? pages[id] : null;
}
function grounding(message, pageId) {
  const page = pageContext(pageId);
  const queries = [message.toLowerCase().replace(/\s/g, '')];
  // Small reference set from the SAME FAQ; not a second fixed product prompt.
  const essentials = ['schoolparkとは', 'emuとは', 'クエストとは', 'ギルドとは', 'パスポート', 'ショッピング', 'emuerの使い道'];
  const chosen = new Set(essentials.map(q => faq.answer(q)).filter(Boolean));
  const ranked = faq.items.map(item => ({ item, score: item.k.reduce((n, k) => n + (queries[0].includes(k.toLowerCase().replace(/\s/g, '')) ? k.length : 0), 0) })).filter(row => row.score).sort((a,b) => b.score-a.score).slice(0, 3);
  const relevant = ranked.map(row => row.item.a);
  const extra = ['passport', 'city'].map(id => pageContext(id)).map(p => p.name + ': ' + p.features.join(' '));
  const references = [...new Set([...relevant, ...chosen, ...extra])].join('\n\n').slice(0, 6500);
  return `現在画面: ${page ? page.name : '未特定（画面を推測しない）'}\n画面の確定案内: ${page ? page.features.join('\n') : 'なし'}\n\n現行FAQ（機能の根拠）:\n${references}`;
}
module.exports = { pageContext, grounding, loadPages };
