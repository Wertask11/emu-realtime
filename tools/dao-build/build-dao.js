/* 受け取った設計ファイル（Claude Design 形式）を、
   本番でそのまま使える1枚のHTMLに組み立てる。

   守っていること:
   ・テンプレートの中身（見た目の指定を含む）は1文字も変えない
   ・値を作る処理（データ定義・Component クラス）も変えない
   ・私が足すのは、それを解釈して画面に出す仕組みだけ

   なぜ移すのか:
   元の support.js は React・ReactDOM・Babel を unpkg から読み込む。
   合わせて3MB近くあり、スマホで開くたびに取りに行くことになる。
   外部への依存も1つ増える。中身は同じなので、依存だけ外す。 */
const fs = require('fs');

const path = require('path');
/* 元の設計ファイルはリポジトリの中に置いてある。
   一時フォルダに置いていたときは、消えると dao.html を作り直せなくなっていた。 */
const SRC = path.join(__dirname, 'handoff', 'SchoolPark DAO.dc.html');
const OUT = path.join(__dirname, '..', '..', 'frontend', 'public', 'schoolpark', 'dao.html');

const raw = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
const lines = raw.split('\n');

/* ── 元ファイルから、そのまま取り出す ── */
const helmet = lines.slice(17, 27).join('\n');          // <helmet> の中身（フォントと基本の色）
let template = lines.slice(28, 610).join('\n');         // 画面のテンプレート
let logic = lines.slice(612, 818).join('\n');           // データと Component クラス

if (!template.includes('SCHOOLPARK DAO / PREVIEW')) { console.error('テンプレートの範囲が違う'); process.exit(1); }
if (!logic.includes('class Component')) { console.error('処理の範囲が違う'); process.exit(1); }
if (!helmet.includes('fonts.googleapis.com')) { console.error('helmet の範囲が違う'); process.exit(1); }

/* ── 本番向けの2点だけ、指示にもとづいて変える ── */

/* ① 上の「SCHOOLPARK DAO / PREVIEW」と端末切替の帯を外す。
      設計を見るためのもので、利用者には要らない。 */
const BAR_START = '  <div style="position:sticky; top:0; z-index:40; background:#141310;';
const barAt = template.indexOf(BAR_START);
if (barAt < 0) { console.error('PREVIEWの帯が見つからない'); process.exit(1); }

/* 閉じタグは、字下げが2つちょうどの行を探す。
   「  </div>\\n」だけで探すと、字下げ4つの「    </div>\\n」の一部にも当たり、
   帯の閉じタグを1つ残してしまう（外側の箱がそこで閉じ、中身が押し出される）。 */
const CLOSE = '\n  </div>\n';
const closeAt = template.indexOf(CLOSE, barAt);
if (closeAt < 0) { console.error('PREVIEWの帯の終わりが見つからない'); process.exit(1); }
const bar = template.slice(barAt, closeAt + CLOSE.length);

if (!bar.includes('SCHOOLPARK DAO / PREVIEW')) { console.error('帯の範囲が違う'); process.exit(1); }
const opens = (bar.match(/<div\b/g) || []).length;
const closes = (bar.match(/<\/div>/g) || []).length;
if (opens !== closes) {
  console.error('帯の中でタグの数が合わない: 開き' + opens + ' 閉じ' + closes); process.exit(1);
}
template = template.replace(bar, '');

/* 消したあと、テンプレート全体でタグの数が合っているか確かめる */
const tOpen = (template.match(/<div\b/g) || []).length;
const tClose = (template.match(/<\/div>/g) || []).length;
if (tOpen !== tClose) {
  console.error('テンプレートのタグの数が合わない: 開き' + tOpen + ' 閉じ' + tClose); process.exit(1);
}

/* ② 開いた端末に合わせて出す。以前は常にパソコン表示だった。
      判定は元の LAYOUTS の寸法に合わせる（tablet 834 / mobile 390）。 */
const pickDevice = "(window.innerWidth < 700 ? 'mobile' : window.innerWidth < 1100 ? 'tablet' : 'pc')";
const OLD_STATE = "device:'pc',";
if (!logic.includes(OLD_STATE)) { console.error('端末の初期値が見つからない'); process.exit(1); }
logic = logic.replace(OLD_STATE, 'device:' + pickDevice + ',');

/* 画面の大きさが変わったら、端末の判定もやり直す（回転したとき用） */
const OLD_RESIZE = 'this._r = () => this.setState({vw: window.innerWidth, vh: window.innerHeight});';
if (!logic.includes(OLD_RESIZE)) { console.error('大きさの追従が見つからない'); process.exit(1); }
logic = logic.replace(OLD_RESIZE,
  'this._r = () => this.setState({vw: window.innerWidth, vh: window.innerHeight, device: '
  + pickDevice + '});');

/* ③ 枠を画面いっぱい・原寸で出す。

      設計は「端末ごとの見え方を確かめる枠」を前提にしていて、
      決まった大きさ（パソコン1440×900など）の箱を作り、
      画面に収まるよう縮小して真ん中に置いていた。
      本番ではその枠は要らないので、縮小をやめて画面いっぱいにする。
      中の配置（どの端末でどう並ぶか）は元のまま。 */
const OLD_K = 'const k = Math.min(1, (s.vw - 56) / base.frameW, (s.vh - 130) / base.frameH);';
if (!logic.includes(OLD_K)) { console.error('縮小の計算が見つからない'); process.exit(1); }
logic = logic.replace(OLD_K, 'const k = 1;   /* 本番では縮小しない */');

const OLD_L = "const L = {...base, sidebarShow:sidebarOpen ? 'flex' : 'none', sidebarToggle:hasSidebar && !sidebarOpen ? 'flex' : 'none', w: base.frameW + 'px', h: base.frameH + 'px', scale: 'scale(' + k.toFixed(4) + ')', boxH: Math.round(base.frameH * k) + 40 + 'px'};";
if (!logic.includes(OLD_L)) { console.error('枠の寸法の組み立てが見つからない'); process.exit(1); }
logic = logic.replace(OLD_L,
  "const L = {...base, sidebarShow:sidebarOpen ? 'flex' : 'none', sidebarToggle:hasSidebar && !sidebarOpen ? 'flex' : 'none', "
  + "w: '100%', h: '100%', scale: 'none', boxH: '100vh', frameR: '0'};");

/* ④ サイドバーの「SchoolPark」を、ブランドの切り替えにする。

      ・下に付いていた「D A O」の行を外す
      ・名前を押すと Camellia / Emu / SchoolPark が出る
      ・Emu を押すと Emu が開く（枠の外にいる親の chesHubGo を呼ぶ）

      親と同じ場所のファイルなので、window.parent をそのまま呼べる。
      呼べなかった場合（単体で開いたときなど）は、何もせず閉じるだけにする。 */
const OLD_LOGO = `        <div style="display:flex; flex:1; flex-direction:column; gap:6px">
          <div style="font-family:'Zen Old Mincho',serif; font-size:23px; font-weight:900; letter-spacing:.02em">SchoolPark</div>
          <div style="font-family:Inter,sans-serif; font-size:11px; letter-spacing:.28em; color:#D0E2BE">D A O</div>
        </div>`;
if (!template.includes(OLD_LOGO)) { console.error('サイドバーのロゴが見つからない'); process.exit(1); }

const NEW_LOGO = `        <div style="display:flex; flex:1; flex-direction:column; gap:6px; position:relative">
          <div onClick="{{ toggleBrand }}" title="ブランドを切り替える" style="display:flex; align-items:center; gap:8px; cursor:pointer">
            <div style="font-family:'Zen Old Mincho',serif; font-size:23px; font-weight:900; letter-spacing:.02em">SchoolPark</div>
            <div style="font-family:Inter,sans-serif; font-size:12px; color:#D0E2BE">{{ brandIcon }}</div>
          </div>
          <sc-if value="{{ brandOpen }}">
            <div style="position:absolute; top:38px; left:0; z-index:20; min-width:168px; background:#1D1B16; border:1px solid rgba(244,241,234,.16); border-radius:10px; padding:6px; display:flex; flex-direction:column; gap:2px; box-shadow:0 18px 40px -14px rgba(0,0,0,.7)">
              <sc-for list="{{ brands }}" as="b">
                <div onClick="{{ b.go }}" style="padding:9px 11px; border-radius:7px; cursor:pointer; font-size:14px; font-weight:700; background:{{ b.bg }}; color:{{ b.fg }}" style-hover="background:rgba(244,241,234,.09)">{{ b.label }}</div>
              </sc-for>
            </div>
          </sc-if>
        </div>`;
template = template.replace(OLD_LOGO, NEW_LOGO);

/* 開いているかどうかの覚え書きを1つ増やす */
const OLD_OPEN = 'sidebarOpen:false,';
if ((logic.split(OLD_OPEN).length - 1) !== 1) { console.error('sidebarOpen が1つでない'); process.exit(1); }
logic = logic.replace(OLD_OPEN, 'sidebarOpen:false, brandOpen:false,');

/* 開け閉めの処理を、サイドバーのものの隣に足す */
const OLD_TOGGLE = '  toggleSidebar = () => this.setState(s => ({sidebarOpen:!s.sidebarOpen}));';
if (!logic.includes(OLD_TOGGLE)) { console.error('toggleSidebar が見つからない'); process.exit(1); }
logic = logic.replace(OLD_TOGGLE, OLD_TOGGLE + `
  toggleBrand = () => this.setState(s => ({brandOpen:!s.brandOpen}));
  goBrand(id){ return () => {
    this.setState({brandOpen:false});
    if (id === 'schoolpark') return;              /* いま居る場所なので何もしない */
    try { window.parent.chesHubGo(id); } catch (e) {}
  }; }`);

/* 画面に渡す値に、切り替えの分を足す */
const OLD_PASS = '      toggleSidebar:this.toggleSidebar,';
if (!logic.includes(OLD_PASS)) { console.error('値の受け渡しが見つからない'); process.exit(1); }
logic = logic.replace(OLD_PASS, OLD_PASS + `
      toggleBrand:this.toggleBrand,
      brandOpen:s.brandOpen,
      brandIcon:s.brandOpen ? '▴' : '▾',
      brands: [['camellia','Camellia','#E0576F'],['emu','Emu','#F08300'],['schoolpark','SchoolPark','#D0E2BE']]
        .map(([id,label,color]) => ({label, fg:color, go:this.goBrand(id),
          bg: id==='schoolpark' ? 'rgba(244,241,234,.08)' : 'transparent'})),`);

/* ⑤ ヘッダーに冷蔵庫くんを置く。「＋ 提案する」の左どなり。
      話す中身は枠の外（親）に前からあるので、押したらそれを開くだけにする。 */
const CTA = '        <div onClick="{{ goPropose }}" style="padding:12px 18px; background:#0F5C3F;';
if (!template.includes(CTA)) { console.error('提案するボタンが見つからない'); process.exit(1); }
template = template.replace(CTA,
  '        <div onClick="{{ askReizo }}" title="冷蔵庫くんに聞く" style="width:38px; height:38px; flex:0 0 38px;'
  + ' border:1px solid rgba(20,19,16,.16); border-radius:7px; display:flex; align-items:center;'
  + ' justify-content:center; cursor:pointer; overflow:hidden" style-hover="background:#E7E2D6">'
  + '<img src="/assets/mascot.jpg" alt="冷蔵庫くん" style="width:100%; height:100%; object-fit:cover"></div>\n'
  + CTA);

/* ⑥ 公園にエレベーターを足す。「月例、リアルの集まり」の手前に置く。 */
const MONTHLY = `            <div style="display:flex; flex-direction:column; gap:18px">
              <div style="display:flex; align-items:baseline; gap:14px">
                <div style="font-size:17px; font-weight:700">月例、リアルの集まり</div>`;
if (!template.includes(MONTHLY)) { console.error('月例の集まりが見つからない'); process.exit(1); }
const ELEVATOR = `            <div style="display:flex; flex-direction:column; gap:18px">
              <div style="display:flex; align-items:baseline; gap:14px">
                <div style="font-size:17px; font-weight:700">エレベーター</div>
                <div style="flex:1; height:1px; background:rgba(20,19,16,.14)"></div>
              </div>
              <div onClick="{{ goElevator }}" style="background:#FBF9F3; border:1px solid rgba(20,19,16,.12); border-radius:12px; padding:16px 20px; display:flex; align-items:center; gap:14px; cursor:pointer" style-hover="background:#F4F1EA">
                <div style="font-size:20px">🛗</div>
                <div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:4px">
                  <div style="font-size:14px; font-weight:700; line-height:1.5">6つの階をのぼりおりする</div>
                  <div style="font-size:12px; color:#6E695C">屋上・星空ホール・ラボ・たんけん・カフェ・エントランス</div>
                </div>
                <div style="font-size:12px; font-weight:700; color:#0F5C3F; white-space:nowrap">乗る</div>
              </div>
            </div>

`;
template = template.replace(MONTHLY, ELEVATOR + MONTHLY);

/* 押したときの行き先。どちらも枠の外（親）に用意してある */
logic = logic.replace(OLD_TOGGLE + `
  toggleBrand`, OLD_TOGGLE + `
  askReizo = () => { try { window.parent.spReizoOpen(); } catch (e) {} };
  goElevator = () => { try { window.parent.openSpRoom('/schoolpark/south-elevator.html', 'エレベーター'); } catch (e) {} };
  toggleBrand`);
if (!logic.includes('askReizo =')) { console.error('冷蔵庫くんの処理を入れられなかった'); process.exit(1); }

logic = logic.replace(OLD_PASS + `
      toggleBrand`, OLD_PASS + `
      askReizo:this.askReizo,
      goElevator:this.goElevator,
      toggleBrand`);
if (!logic.includes('askReizo:this.askReizo')) { console.error('値の受け渡しに入れられなかった'); process.exit(1); }

/* ⑦ クエストのカードに「詳細」を足す。
      いまは見出しを押すと詳細に行けるが、押せることが見て分からない。
      「受ける」の左に並べる。行き先は見出しと同じ e.open。 */
const OLD_COMMIT = '                    <div onClick="{{ e.commit }}" style="padding:10px 16px; border-radius:6px; font-size:13px; font-weight:700; cursor:pointer; background:{{ e.btnBg }}; color:{{ e.btnFg }}; border:1px solid #0F5C3F">{{ e.btnLabel }}</div>';
if (!template.includes(OLD_COMMIT)) { console.error('受けるボタンが見つからない'); process.exit(1); }
template = template.replace(OLD_COMMIT,
`                    <div style="display:flex; align-items:center; gap:8px">
                      <div onClick="{{ e.open }}" style="padding:10px 16px; border-radius:6px; font-size:13px; font-weight:700; cursor:pointer; background:transparent; color:#0F5C3F; border:1px solid rgba(20,19,16,.2)" style-hover="background:#E7E2D6">詳細</div>
                      <div onClick="{{ e.commit }}" style="padding:10px 16px; border-radius:6px; font-size:13px; font-weight:700; cursor:pointer; background:{{ e.btnBg }}; color:{{ e.btnFg }}; border:1px solid #0F5C3F">{{ e.btnLabel }}</div>
                    </div>`);

/* ⑧ サイドバーと下ナビから「クエストの詳細」と「クエストを提案」を外す。
      詳細はカードの「詳細」から、提案は右上の「＋ 提案する」から行ける。
      画面そのものは残す（heads もそのまま）。番号は詰め直す。 */
const OLD_NAV = "    const navDefs = [['home','01','今週の広場'],['park','02','公園'],['experiments','03',W+'一覧'],['detail','04',W+'の詳細'],['logs','05',W+'ログ'],['library','06','知恵ライブラリ'],['members','07','メンバー・貢献'],['treasury','08','トレジャリー'],['propose','09',W+'を提案']];";
if (!logic.includes(OLD_NAV)) { console.error('サイドバーの並びが見つからない'); process.exit(1); }
logic = logic.replace(OLD_NAV,
  "    const navDefs = [['home','01','今週の広場'],['park','02','公園'],['experiments','03',W+'一覧'],['logs','04',W+'ログ'],['library','05','知恵ライブラリ'],['members','06','メンバー・貢献'],['treasury','07','トレジャリー']];");

const OLD_TABS = "      tabs: [['home','01','広場'],['park','02','公園'],['experiments','03',W],['detail','04','詳細'],['logs','05','ログ'],['library','06','知恵'],['members','07','メンバー'],['treasury','08','会計'],['propose','09','提案']].map(([id,n,label]) => ({";
if (!logic.includes(OLD_TABS)) { console.error('下ナビの並びが見つからない'); process.exit(1); }
logic = logic.replace(OLD_TABS,
  "      tabs: [['home','01','広場'],['park','02','公園'],['experiments','03',W],['logs','04','ログ'],['library','05','知恵'],['members','06','メンバー'],['treasury','07','会計']].map(([id,n,label]) => ({");

/* ⑨ サイドバー下の「名前と貢献」を押すと、SchoolPark パスポートが開く。
      新しい項目を足さずに、いまある場所へ機能を持たせる。 */
const OLD_USER = `        <div style="display:flex; align-items:center; gap:10px; padding-top:4px">`;
if ((template.split(OLD_USER).length - 1) !== 1) { console.error('サイドバーの名前欄が1つでない'); process.exit(1); }
template = template.replace(OLD_USER,
  `        <div onClick="{{ openPassport }}" title="SchoolPark パスポートを見る" style="display:flex; align-items:center; gap:10px; padding:4px 8px 6px; margin:0 -8px; border-radius:8px; cursor:pointer" style-hover="background:rgba(244,241,234,.08)">`);

logic = logic.replace(OLD_TOGGLE + `
  askReizo`, OLD_TOGGLE + `
  openPassport = () => { try { window.parent.openSpPassport(); } catch (e) {} };
  askReizo`);
if (!logic.includes('openPassport =')) { console.error('パスポートの処理を入れられなかった'); process.exit(1); }

logic = logic.replace(OLD_PASS + `
      askReizo`, OLD_PASS + `
      openPassport:this.openPassport,
      askReizo`);
if (!logic.includes('openPassport:this.openPassport')) { console.error('パスポートの受け渡しに入れられなかった'); process.exit(1); }

/* ⑩ 「クエストログ」を「ギルド」に変える。画面の中身は同じ。 */
[["['logs','04',W+'ログ']", "['logs','04','ギルド']"],
 ["['logs','04','ログ']", "['logs','04','ギルド']"],
 ["      logs:['LOGS', W+'ログ・フィード'],", "      logs:['GUILD','ギルド'],"]
].forEach(function (pair) {
  if (!logic.includes(pair[0])) { console.error('見つからない: ' + pair[0]); process.exit(1); }
  logic = logic.replace(pair[0], pair[1]);
});

/* ⑪ 見本のデータを空にする。並べ方（レイアウト）はそのまま。
      作り物の名前や金額が本番に出ないようにするため。
      STEPS は提案画面の手順そのものなので残す。 */
function emptyList(name) {
  const head = logic.indexOf('const ' + name + ' = [');
  if (head < 0) { console.error(name + ' が見つからない'); process.exit(1); }
  const end = logic.indexOf('\n];', head);
  if (end < 0) { console.error(name + ' の終わりが見つからない'); process.exit(1); }
  const cut = logic.slice(head, end + '\n];'.length);
  logic = logic.replace(cut, 'const ' + name + ' = [];');
  return cut.split('\n').length;
}
const emptied = {};
['EXPS', 'WISDOM', 'LOGS', 'MEMBERS', 'BOARD', 'DUMB', 'ROOMS', 'EVENTS', 'PEEKS']
  .forEach(function (n) { emptied[n] = emptyList(n); });

/* 見本の数字も 0 にする */
const OLD_STATS = "      stats: {newWisdom:3, running:4, people:28, myCommit:Object.values(s.committed).filter(Boolean).length, due:2, wisdomTotal:WISDOM.length+40, payout:'¥24,000', citations:412},";
if (!logic.includes(OLD_STATS)) { console.error('集計が見つからない'); process.exit(1); }
logic = logic.replace(OLD_STATS,
  "      stats: {newWisdom:0, running:exps.filter(e => e.status==='RUNNING').length, people:0, myCommit:Object.values(s.committed).filter(Boolean).length, due:0, wisdomTotal:WISDOM.length, payout:'¥0', citations:0},");

const OLD_TRE = "      treasury: {total:'1,284,000', in:'320,000', out:'186,000',";
if (!logic.includes(OLD_TRE)) { console.error('トレジャリーが見つからない'); process.exit(1); }
logic = logic.replace(OLD_TRE, "      treasury: {total:'0', in:'0', out:'0',");
const TRE_TXS = logic.indexOf('        txs:[');
const TRE_END = logic.indexOf('\n        ]},', TRE_TXS);
if (TRE_TXS < 0 || TRE_END < 0) { console.error('トレジャリーの明細が見つからない'); process.exit(1); }
logic = logic.slice(0, TRE_TXS) + '        txs:[]},' + logic.slice(TRE_END + '\n        ]},'.length);

/* 初めから「受けている」「乗ってる」ことにしていた分も外す */
logic = logic.replace("committed:{e1:true, e3:true}", 'committed:{}');
logic = logic.replace("joined:{b1:true}", 'joined:{}');
logic = logic.replace("expId:'e1'", "expId:''");

/* テンプレートに直接書かれていた作り物の名前も、本人のものに差し替える。
   ここは並べ方は変えず、入る値だけを変える。 */
const OLD_INITIAL = 'font-size:13px; font-weight:700">彩</div>';
if (!template.includes(OLD_INITIAL)) { console.error('サイドバーの丸が見つからない'); process.exit(1); }
template = template.replace(OLD_INITIAL, 'font-size:13px; font-weight:700">{{ me.initial }}</div>');

const OLD_NAME = '            <div style="font-size:13px; font-weight:500">あやか</div>';
if (!template.includes(OLD_NAME)) { console.error('サイドバーの名前が見つからない'); process.exit(1); }
template = template.replace(OLD_NAME, '            <div style="font-size:13px; font-weight:500">{{ me.name }}</div>');

const OLD_LINE = 'color:#D0E2BE">WISDOM 14 · クエスト 6</div>';
if (!template.includes(OLD_LINE)) { console.error('サイドバーの内訳が見つからない'); process.exit(1); }
template = template.replace(OLD_LINE, 'color:#D0E2BE">{{ me.line }}</div>');

logic = logic.replace("      home:['THE SQUARE / 今週の広場','おはよう、あやか'],",
  "      home:['THE SQUARE / 今週の広場','おはよう、' + s.me.name],");

logic = logic.replace(`      todos: [
        {label:'「先に名乗る」の中間ログを書く', meta:'締切まであと2日'},
        {label:'みおのログに返信する', meta:'つまずき報告 · 3件未読'},
        {label:'知恵カードの下書きを一文に削る', meta:'自動生成済み · 1件'}
      ],`, '      todos: [],');
if (logic.includes('「先に名乗る」の中間ログ')) { console.error('やることの見本を消せなかった'); process.exit(1); }

/* 本人のことは、枠の外（親）から教えてもらう。まだ分からないうちは「ゲスト」。 */
logic = logic.replace('sidebarOpen:false, brandOpen:false,',
  "sidebarOpen:false, brandOpen:false, me:{name:'ゲスト', initial:'ー', line:'WISDOM 0 · クエスト 0'},");
if (!logic.includes("me:{name:'ゲスト'")) { console.error('本人の入れ物を作れなかった'); process.exit(1); }

const OLD_MOUNT = "  componentDidMount(){ this._r = ";
if (!logic.includes(OLD_MOUNT)) { console.error('起動時の処理が見つからない'); process.exit(1); }
logic = logic.replace(OLD_MOUNT,
  "  componentDidMount(){ try { window.parent.spDaoWhoAmI(this); } catch (e) {} this._r = ");

logic = logic.replace(OLD_PASS + `
      openPassport`, OLD_PASS + `
      me:s.me,
      openPassport`);
if (!logic.includes('me:s.me,')) { console.error('本人の受け渡しに入れられなかった'); process.exit(1); }

/* ⑫ ギルドに議題と投票を足す。ログの入力欄の上に置く。
      並べ方は SchoolPark の他の画面と同じ組み方にそろえてある。
      中身（議題・票）は枠の外（親）から渡される。 */
const LOG_HEAD = `            <div style="display:flex; flex-direction:column; gap:20px">
              <div style="background:#FBF9F3; border:1px solid rgba(20,19,16,.12); border-radius:12px; padding:22px; display:flex; flex-direction:column; gap:14px">
                <div style="font-size:14px; font-weight:700">今日やったことを書く</div>`;
if (!template.includes(LOG_HEAD)) { console.error('ログの入力欄が見つからない'); process.exit(1); }
const VOTES_BLOCK = `            <div style="display:flex; flex-direction:column; gap:20px">

              <div style="display:flex; flex-direction:column; gap:16px">
                <div style="display:flex; align-items:baseline; gap:14px">
                  <div style="font-size:17px; font-weight:700">いま出ている議題</div>
                  <div style="flex:1; height:1px; background:rgba(20,19,16,.14)"></div>
                  <div onClick="{{ openVoteForm }}" style="font-size:12px; font-weight:700; color:#0F5C3F; cursor:pointer; white-space:nowrap">＋ 議題を出す</div>
                </div>
                <sc-if value="{{ noVotes }}">
                  <div style="background:#FBF9F3; border:1px solid rgba(20,19,16,.12); border-radius:12px; padding:22px; font-size:13px; line-height:1.9; color:#6E695C">まだ議題がありません。「＋ 議題を出す」から出せます。</div>
                </sc-if>
                <sc-for list="{{ votes }}" as="v" hint-placeholder-count="2">
                  <div style="background:#FBF9F3; border:1px solid rgba(20,19,16,.12); border-radius:12px; padding:22px; display:flex; flex-direction:column; gap:14px">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:12px">
                      <div style="font-family:Inter,sans-serif; font-size:10px; letter-spacing:.16em; padding:5px 10px; border-radius:4px; background:{{ v.stateBg }}; color:{{ v.stateFg }}">{{ v.stateLabel }}</div>
                      <div style="font-size:12px; color:#6E695C">{{ v.closes }}</div>
                    </div>
                    <div style="font-size:17px; font-weight:700; line-height:1.55; text-wrap:pretty">{{ v.title }}</div>
                    <div style="font-size:13px; line-height:1.9; color:#3B382F">{{ v.body }}</div>
                    <div style="display:flex; flex-direction:column; gap:8px">
                      <sc-for list="{{ v.options }}" as="o" hint-placeholder-count="2">
                        <div onClick="{{ o.go }}" style="position:relative; overflow:hidden; border:1px solid {{ o.border }}; border-radius:8px; padding:12px 14px; cursor:{{ o.cursor }}; background:#F4F1EA">
                          <div style="position:absolute; left:0; top:0; bottom:0; width:{{ o.pct }}; background:{{ o.barBg }}"></div>
                          <div style="position:relative; display:flex; justify-content:space-between; gap:12px; font-size:14px; font-weight:{{ o.weight }}; color:#141310">
                            <div>{{ o.label }}</div>
                            <div style="font-family:Inter,sans-serif; color:#0F5C3F">{{ o.countLabel }}</div>
                          </div>
                        </div>
                      </sc-for>
                    </div>
                    <div style="font-size:12px; color:#6E695C">{{ v.note }}</div>
                  </div>
                </sc-for>
              </div>

              <div style="background:#FBF9F3; border:1px solid rgba(20,19,16,.12); border-radius:12px; padding:22px; display:flex; flex-direction:column; gap:14px">
                <div style="font-size:14px; font-weight:700">今日やったことを書く</div>`;
template = template.replace(LOG_HEAD, VOTES_BLOCK);

logic = logic.replace("me:{name:'ゲスト', initial:'ー', line:'WISDOM 0 · クエスト 0'},",
  "me:{name:'ゲスト', initial:'ー', line:'WISDOM 0 · クエスト 0'}, votes:[], noVotes:true,");
if (!logic.includes('votes:[], noVotes:true,')) { console.error('議題の入れ物を作れなかった'); process.exit(1); }

logic = logic.replace('  componentDidMount(){ try { window.parent.spDaoWhoAmI(this); } catch (e) {}',
  '  componentDidMount(){ try { window.parent.spDaoWhoAmI(this); } catch (e) {} try { window.parent.spDaoLoadVotes(this); } catch (e) {}');

logic = logic.replace(OLD_PASS + `
      me:s.me,`, OLD_PASS + `
      me:s.me,
      votes:s.votes, noVotes:s.noVotes,
      openVoteForm:() => { try { window.parent.openSpVoteForm(this); } catch (e) {} },`);
if (!logic.includes('votes:s.votes,')) { console.error('議題の受け渡しに入れられなかった'); process.exit(1); }

/* ⑬ クエストを本物にする。
      見本の配列（EXPS）ではなく、枠の外（親）が Firestore から読んだものを使う。
      並べ方・絞り込み・詳細の作りはそのまま。 */
const OLD_EXPS_MAP = '    const exps = EXPS.map(e => this.decorate(e));';
if (!logic.includes(OLD_EXPS_MAP)) { console.error('クエストの組み立てが見つからない'); process.exit(1); }
logic = logic.replace(OLD_EXPS_MAP, '    const exps = (s.quests || []).map(e => this.decorate(e));');

/* 「受けている」は端末の覚え書きではなく、記録そのものから決める。
   同じ人が二重に受けられないことは、記録の作り（commits/{番号}）で守られている。 */
const OLD_DEC = '    const on = !!this.state.committed[e.id];';
if (!logic.includes(OLD_DEC)) { console.error('受けている判定が見つからない'); process.exit(1); }
logic = logic.replace(OLD_DEC, '    const on = !!e.iTook;');
const OLD_N = '    const n = e.commits + (on?1:0);';
if (!logic.includes(OLD_N)) { console.error('人数の数え方が見つからない'); process.exit(1); }
logic = logic.replace(OLD_N, '    const n = e.commits;');

/* 押したときに記録へ書きに行く */
const OLD_COMMIT_FN = '  commit(id){ return (ev) => { if(ev) ev.stopPropagation(); this.setState(s => ({committed:{...s.committed, [id]:!s.committed[id]}})); }; }';
if (!logic.includes(OLD_COMMIT_FN)) { console.error('受ける処理が見つからない'); process.exit(1); }
logic = logic.replace(OLD_COMMIT_FN,
  '  commit(id){ return (ev) => { if(ev) ev.stopPropagation(); try { window.parent.spQuestToggle(id, this); } catch (e) {} }; }');

/* 予算が0のときに「1人あたり」で0で割らないようにする */
const OLD_PER = "      perHead: (Math.round(parseInt(e.budget.replace(/,/g,''),10)/n/100)*100).toLocaleString()";
if (!logic.includes(OLD_PER)) { console.error('1人あたりの計算が見つからない'); process.exit(1); }
logic = logic.replace(OLD_PER,
  "      perHead: n > 0 ? (Math.round((parseInt(String(e.budget).replace(/,/g,''),10)||0)/n/100)*100).toLocaleString() : '0'");

/* 「＋ 提案する」からクエストを出す画面を開く */
const OLD_GOPROPOSE = "      goPropose:this.go('propose'),";
if (!logic.includes(OLD_GOPROPOSE)) { console.error('提案するの行き先が見つからない'); process.exit(1); }
logic = logic.replace(OLD_GOPROPOSE,
  "      goPropose:() => { try { window.parent.openSpQuestForm(this); } catch (e) { this.setState({screen:'propose'}); } },");

logic = logic.replace('votes:[], noVotes:true,', 'votes:[], noVotes:true, quests:[], noQuests:true,');
if (!logic.includes('quests:[], noQuests:true,')) { console.error('クエストの入れ物を作れなかった'); process.exit(1); }

logic = logic.replace('try { window.parent.spDaoLoadVotes(this); } catch (e) {}',
  'try { window.parent.spDaoLoadVotes(this); } catch (e) {} try { window.parent.spDaoLoadQuests(this); } catch (e) {}');

logic = logic.replace(`      votes:s.votes, noVotes:s.noVotes,`, `      votes:s.votes, noVotes:s.noVotes,
      noQuests:s.noQuests,`);
if (!logic.includes('noQuests:s.noQuests,')) { console.error('クエストの受け渡しに入れられなかった'); process.exit(1); }

/* クエストが1件も無いときの案内を、一覧の上に出す */
const LIST_HEAD = '            <div style="display:grid; grid-template-columns:{{ L.g2 }}; gap:18px">\n              <sc-for list="{{ shownExps }}" as="e"';
if (!template.includes(LIST_HEAD)) { console.error('クエスト一覧の並びが見つからない'); process.exit(1); }
template = template.replace(LIST_HEAD,
  '            <sc-if value="{{ noQuests }}">\n'
  + '              <div style="background:#FBF9F3; border:1px solid rgba(20,19,16,.12); border-radius:12px; padding:22px; font-size:13px; line-height:1.9; color:#6E695C">まだクエストがありません。右上の「＋ 提案する」から出せます。</div>\n'
  + '            </sc-if>\n'
  + LIST_HEAD);

/* ⑭ ギルドは SchoolPark の DAO投票の場にする。
      クエストの作業ログはここではないので、入力欄と一覧を外し、
      右の説明も投票の決まりに差し替える。並べ方（2段組み）はそのまま。 */
const LOGFORM_START = '              <div style="background:#FBF9F3; border:1px solid rgba(20,19,16,.12); border-radius:12px; padding:22px; display:flex; flex-direction:column; gap:14px">\n                <div style="font-size:14px; font-weight:700">今日やったことを書く</div>';
const LOGFEED_END = '              </sc-for>\n            </div>\n';
const s1 = template.indexOf(LOGFORM_START);
if (s1 < 0) { console.error('ログの入力欄が見つからない'); process.exit(1); }
const s2 = template.indexOf(LOGFEED_END, s1);
if (s2 < 0) { console.error('ログ一覧の終わりが見つからない'); process.exit(1); }
const logBlock = template.slice(s1, s2 + LOGFEED_END.length);
if (!logBlock.includes('{{ l.claps }}') || !logBlock.includes('知恵にする')) {
  console.error('ログの範囲が違う'); process.exit(1);
}
{
  const o = (logBlock.match(/<div\b/g) || []).length, c = (logBlock.match(/<\/div>/g) || []).length;
  /* 一覧の閉じ </div> は外側の列のものなので、閉じが1つ多いのが正しい */
  if (o + 1 !== c) { console.error('ログの範囲でタグが合わない ' + o + '/' + c); process.exit(1); }
}
template = template.replace(logBlock, '            </div>\n');

const OLD_RIGHT = `              <div style="font-size:15px; font-weight:700">ログが知恵になるまで</div>
              <div style="font-size:13px; line-height:1.95; color:#3B382F">3件以上のログが溜まった{{ word }}は、締切後に「知恵カード」の下書きが自動生成されます。書き手が一文に削り、ライブラリへ。</div>
              <div style="display:flex; flex-direction:column; gap:10px; padding-top:6px">
                <div style="display:flex; gap:12px; align-items:center; font-size:13px"><div style="font-family:Inter,sans-serif; font-size:10px; color:#0F5C3F; letter-spacing:.1em">01</div>ログを溜める</div>
                <div style="display:flex; gap:12px; align-items:center; font-size:13px"><div style="font-family:Inter,sans-serif; font-size:10px; color:#0F5C3F; letter-spacing:.1em">02</div>一文に削る</div>
                <div style="display:flex; gap:12px; align-items:center; font-size:13px"><div style="font-family:Inter,sans-serif; font-size:10px; color:#0F5C3F; letter-spacing:.1em">03</div>ライブラリに置く</div>
                <div style="display:flex; gap:12px; align-items:center; font-size:13px"><div style="font-family:Inter,sans-serif; font-size:10px; color:#0F5C3F; letter-spacing:.1em">04</div>誰かが引用する＝分配</div>
              </div>`;
if (!template.includes(OLD_RIGHT)) { console.error('ギルド右の説明が見つからない'); process.exit(1); }
template = template.replace(OLD_RIGHT,
`              <div style="font-size:15px; font-weight:700">投票の決まり</div>
              <div style="font-size:13px; line-height:1.95; color:#3B382F">議題は誰でも出せます。票は1つのパスポートにつき1票。入れた票は取り消しも書き換えもできません。</div>
              <div style="display:flex; flex-direction:column; gap:10px; padding-top:6px">
                <div style="display:flex; gap:12px; align-items:center; font-size:13px"><div style="font-family:Inter,sans-serif; font-size:10px; color:#0F5C3F; letter-spacing:.1em">01</div>議題を出す</div>
                <div style="display:flex; gap:12px; align-items:center; font-size:13px"><div style="font-family:Inter,sans-serif; font-size:10px; color:#0F5C3F; letter-spacing:.1em">02</div>締切まで投票する</div>
                <div style="display:flex; gap:12px; align-items:center; font-size:13px"><div style="font-family:Inter,sans-serif; font-size:10px; color:#0F5C3F; letter-spacing:.1em">03</div>入れたあとに結果が見える</div>
                <div style="display:flex; gap:12px; align-items:center; font-size:13px"><div style="font-family:Inter,sans-serif; font-size:10px; color:#0F5C3F; letter-spacing:.1em">04</div>結果はそのまま残る</div>
              </div>`);

/* 見出しも「ギルド・DAO投票」にする */
logic = logic.replace("      logs:['GUILD','ギルド'],", "      logs:['GUILD','ギルド — SchoolParkのDAO投票'],");

/* ⑮ 知恵ライブラリを本物にする。見本の配列ではなく、記録から読む。 */
[['      logs, wisdom: WISDOM,', '      logs, wisdom: s.wisdom || [],'],
 ['      freshWisdom: WISDOM.slice(0,3)', '      freshWisdom: (s.wisdom || []).slice(0,3)'],
 ["wisdomTotal:WISDOM.length, payout:'¥0', citations:0}", "wisdomTotal:(s.wisdom || []).length, payout:'¥0', citations:s.citations || 0}"],
 ['newWisdom:0,', 'newWisdom:(s.wisdom || []).length,']
].forEach(function (pair) {
  if (!logic.includes(pair[0])) { console.error('見つからない: ' + pair[0]); process.exit(1); }
  logic = logic.replace(pair[0], pair[1]);
});
logic = logic.replace('votes:[], noVotes:true, quests:[], noQuests:true,',
  'votes:[], noVotes:true, quests:[], noQuests:true, wisdom:[], noWisdom:true, citations:0,');
if (!logic.includes('wisdom:[], noWisdom:true,')) { console.error('知恵の入れ物を作れなかった'); process.exit(1); }
logic = logic.replace('try { window.parent.spDaoLoadQuests(this); } catch (e) {}',
  'try { window.parent.spDaoLoadQuests(this); } catch (e) {} try { window.parent.spDaoLoadWisdom(this); } catch (e) {}');
logic = logic.replace('      noQuests:s.noQuests,', '      noQuests:s.noQuests, noWisdom:s.noWisdom,');

/* 知恵が1枚も無いときの案内 */
const WLIST = '            <div style="columns:{{ L.libCols }}; column-gap:16px">';
if (!template.includes(WLIST)) { console.error('知恵の並びが見つからない'); process.exit(1); }
template = template.replace(WLIST,
  '            <sc-if value="{{ noWisdom }}">\n'
  + '              <div style="background:#FBF9F3; border:1px solid rgba(20,19,16,.12); border-radius:12px; padding:22px; font-size:13px; line-height:1.9; color:#6E695C">まだ知恵カードがありません。知恵は、クエストを完了したときに生まれます。</div>\n'
  + '            </sc-if>\n'
  + WLIST);

/* ⑯ クエストの詳細に「完了にする」を足す。出した本人だけに出す。 */
const DET_COMMIT = '                <div onClick="{{ cur.commit }}" style="text-align:center; padding:14px; border-radius:8px; font-size:15px; font-weight:700; cursor:pointer; background:{{ cur.btnBg2 }}; color:{{ cur.btnFg2 }}; border:1px solid #D0E2BE">{{ cur.btnLabel }}</div>';
if (!template.includes(DET_COMMIT)) { console.error('詳細の受けるボタンが見つからない'); process.exit(1); }
template = template.replace(DET_COMMIT, DET_COMMIT + `
                <sc-if value="{{ cur.canClose }}">
                  <div onClick="{{ cur.close }}" style="text-align:center; padding:12px; border-radius:8px; font-size:13px; font-weight:700; cursor:pointer; background:transparent; color:#D0E2BE; border:1px solid rgba(208,226,190,.45)" style-hover="background:rgba(208,226,190,.12)">完了にして知恵カードを置く</div>
                </sc-if>`);

/* 出した本人かどうかは、枠の外から渡された値で決める */
const DEC_TAIL = "      perHead: n > 0 ?";
if (!logic.includes(DEC_TAIL)) { console.error('詳細の値の組み立てが見つからない'); process.exit(1); }
logic = logic.replace(DEC_TAIL,
  "      canClose: !!e.isMine && e.status !== 'CLOSED',\n"
  + "      close: () => { try { window.parent.spQuestClose(e.id, this); } catch (err) {} },\n"
  + "      perHead: n > 0 ?");

/* ⑰ 知恵カードに「引用する」を付ける。引用が分配のもとになる。 */
const W_BY = '                  <div style="font-size:12px; color:#6E695C">by {{ w.author }}</div>';
if (!template.includes(W_BY)) { console.error('知恵カードの署名が見つからない'); process.exit(1); }
template = template.replace(W_BY,
`                  <div style="display:flex; justify-content:space-between; align-items:center; gap:12px">
                    <div style="font-size:12px; color:#6E695C">by {{ w.author }}</div>
                    <div onClick="{{ w.cite }}" style="padding:7px 13px; border-radius:6px; font-size:12px; font-weight:700; cursor:pointer; background:{{ w.citeBg }}; color:{{ w.citeFg }}; border:1px solid #0F5C3F; white-space:nowrap" style-hover="opacity:.85">{{ w.citeLabel }}</div>
                  </div>`);

/* ⑱ メンバー・貢献を、SchoolPark での活動から数える */
logic = logic.replace('      members: MEMBERS,', '      members: s.members || [],');
if (logic.includes('members: MEMBERS,')) { console.error('メンバーの受け渡しを差し替えられなかった'); process.exit(1); }
logic = logic.replace('wisdom:[], noWisdom:true, citations:0,', 'wisdom:[], noWisdom:true, citations:0, members:[], noMembers:true,');
if (!logic.includes('members:[], noMembers:true,')) { console.error('メンバーの入れ物を作れなかった'); process.exit(1); }
logic = logic.replace('try { window.parent.spDaoLoadWisdom(this); } catch (e) {}',
  'try { window.parent.spDaoLoadWisdom(this); } catch (e) {} try { window.parent.spDaoLoadMembers(this); } catch (e) {}');
logic = logic.replace('      noQuests:s.noQuests, noWisdom:s.noWisdom,', '      noQuests:s.noQuests, noWisdom:s.noWisdom, noMembers:s.noMembers,');

const M_TABLE = '            <div style="background:#FBF9F3; border:1px solid rgba(20,19,16,.12); border-radius:12px; overflow:hidden">\n              <div style="display:grid; grid-template-columns:{{ L.table }}';
if (!template.includes(M_TABLE)) { console.error('メンバーの表が見つからない'); process.exit(1); }
template = template.replace(M_TABLE,
  '            <sc-if value="{{ noMembers }}">\n'
  + '              <div style="background:#FBF9F3; border:1px solid rgba(20,19,16,.12); border-radius:12px; padding:22px; font-size:13px; line-height:1.9; color:#6E695C">まだ活動の記録がありません。クエストを受ける・知恵を残す・議題に投票すると、ここに出ます。</div>\n'
  + '            </sc-if>\n'
  + M_TABLE);

/* ⑲ トレジャリーを、クエストの記録から出す。
      設計に入っていた見本の固定値（52/26/14/8）は下の分配ルール（70/20/10）と
      食い違っていたので、実際の額から出し直す。並べ方はそのまま。 */
const OLD_TRE2 = `      treasury: {total:'0', in:'0', out:'0',
        alloc:[{label:W+'予算',pct:'52%'},{label:'完走メンバーへの分配',pct:'26%'},{label:'知恵の引用インセンティブ',pct:'14%'},{label:'運営プール',pct:'8%'}],
        txs:[]},`;
if (!logic.includes(OLD_TRE2)) { console.error('トレジャリーの値が見つからない'); process.exit(1); }
logic = logic.replace(OLD_TRE2, '      treasury: s.treasury,');
logic = logic.replace('wisdom:[], noWisdom:true, citations:0, members:[], noMembers:true,',
  "wisdom:[], noWisdom:true, citations:0, members:[], noMembers:true, noTreasury:true, treasury:{total:'0', in:'0', out:'0', alloc:[], txs:[]},");
if (!logic.includes('noTreasury:true')) { console.error('トレジャリーの入れ物を作れなかった'); process.exit(1); }
logic = logic.replace('try { window.parent.spDaoLoadMembers(this); } catch (e) {}',
  'try { window.parent.spDaoLoadMembers(this); } catch (e) {} try { window.parent.spDaoLoadTreasury(this); } catch (e) {}');
logic = logic.replace('      noQuests:s.noQuests, noWisdom:s.noWisdom, noMembers:s.noMembers,',
  '      noQuests:s.noQuests, noWisdom:s.noWisdom, noMembers:s.noMembers, noTreasury:s.noTreasury,');

/* 動きが1件も無いときの案内 */
const T_TXS = '              <div style="background:#FBF9F3; border:1px solid rgba(20,19,16,.12); border-radius:12px; overflow:hidden">\n                <sc-for list="{{ treasury.txs }}"';
if (!template.includes(T_TXS)) { console.error('トレジャリーの明細が見つからない'); process.exit(1); }
template = template.replace(T_TXS,
  '              <sc-if value="{{ noTreasury }}">\n'
  + '                <div style="background:#FBF9F3; border:1px solid rgba(20,19,16,.12); border-radius:12px; padding:22px; font-size:13px; line-height:1.9; color:#6E695C">まだお金の動きがありません。クエストに予算が付くと、ここに出ます。</div>\n'
  + '              </sc-if>\n'
  + T_TXS);

/* ⑳ トレジャリーの言葉を、中身に合わせて直す。
      外からの入出金はまだ記録していない。ここに出ているのは
      クエストに付いた予算なので、「残高」「流入」は実態と違う。 */
const T_KICKER = '<div style="font-family:Inter,sans-serif; font-size:10px; letter-spacing:.22em; color:#D0E2BE">TOTAL BALANCE</div>';
if (!template.includes(T_KICKER)) { console.error('トレジャリーの見出しが見つからない'); process.exit(1); }
template = template.replace(T_KICKER, T_KICKER.replace('TOTAL BALANCE', 'TOTAL BUDGET'));

const T_LINE = '今月の流入 ¥{{ treasury.in }} / 分配 ¥{{ treasury.out }}';
if (!template.includes(T_LINE)) { console.error('トレジャリーの内訳の行が見つからない'); process.exit(1); }
template = template.replace(T_LINE, '今月の確保 ¥{{ treasury.in }} / 分配 ¥{{ treasury.out }}');

const T_NOTE = '分配ルール：完走したメンバーに予算の70%、知恵カードの引用数に応じて20%、残り10%を次の原資にプール。';
if (!template.includes(T_NOTE)) { console.error('分配ルールの文が見つからない'); process.exit(1); }
template = template.replace(T_NOTE,
  T_NOTE + '<br>外からの入出金はまだ記録していません。ここに出ているのは、クエストに付いた予算です。');

/* ㉑ クエストの詳細に、途中報告を書く欄を足す。
      書けるのは、そのクエストを受けた人だけ（ルールでも守っている）。
      ログの一覧も、そのクエストのものだけを出す。 */
const LOG_HEAD2 = '                  <div style="font-size:12px; color:#6E695C">{{ cur.logCount }} 件</div>\n                </div>';
if (!template.includes(LOG_HEAD2)) { console.error('ログの見出しが見つからない'); process.exit(1); }
template = template.replace(LOG_HEAD2, LOG_HEAD2 + `
                <sc-if value="{{ cur.canLog }}">
                  <div style="background:#FBF9F3; border:1px solid rgba(20,19,16,.12); border-radius:12px; padding:20px; display:flex; align-items:center; gap:8px; flex-wrap:wrap">
                    <div style="font-size:13px; color:#6E695C; flex:1; min-width:160px">今日やったことを書く</div>
                    <div onClick="{{ cur.logDid }}" style="padding:8px 14px; border:1px solid rgba(20,19,16,.16); border-radius:16px; font-size:12px; cursor:pointer" style-hover="border-color:#0F5C3F; color:#0F5C3F">やってみた</div>
                    <div onClick="{{ cur.logStuck }}" style="padding:8px 14px; border:1px solid rgba(20,19,16,.16); border-radius:16px; font-size:12px; cursor:pointer" style-hover="border-color:#0F5C3F; color:#0F5C3F">つまずいた</div>
                    <div onClick="{{ cur.logFound }}" style="padding:8px 14px; border:1px solid rgba(20,19,16,.16); border-radius:16px; font-size:12px; cursor:pointer" style-hover="border-color:#0F5C3F; color:#0F5C3F">気づいた</div>
                  </div>
                </sc-if>
                <sc-if value="{{ cur.noLogs }}">
                  <div style="font-size:13px; line-height:1.9; color:#6E695C">まだ報告がありません。受けた人が書くと、ここに並びます。</div>
                </sc-if>`);

/* ログはそのクエストのものだけにする（前は他のクエストの分も後ろに足していた） */
const OLD_CURLOGS = "      curLogs: logs.filter(l => l.exp === cur.title).concat(logs.filter(l => l.exp !== cur.title)).slice(0,3),";
if (!logic.includes(OLD_CURLOGS)) { console.error('詳細のログの選び方が見つからない'); process.exit(1); }
logic = logic.replace(OLD_CURLOGS, '      curLogs: cur.logs || [],');

logic = logic.replace("      canClose: !!e.isMine && e.status !== 'CLOSED',",
  "      canClose: !!e.isMine && e.status !== 'CLOSED',\n"
  + "      canLog: !!e.iTook && e.status !== 'CLOSED',\n"
  + "      noLogs: !(e.logs && e.logs.length),\n"
  + "      logDid:   () => { try { window.parent.spQuestLog(e.id, 'やってみた', this); } catch (err) {} },\n"
  + "      logStuck: () => { try { window.parent.spQuestLog(e.id, 'つまずいた', this); } catch (err) {} },\n"
  + "      logFound: () => { try { window.parent.spQuestLog(e.id, '気づいた', this); } catch (err) {} },");

/* ㉒ 知恵ライブラリのタグを、押せるようにする。
      設計では並んでいるだけで、押しても何も起きなかった。 */
const OLD_TAG = '                <div style="padding:8px 14px; border:1px solid rgba(20,19,16,.16); border-radius:18px; font-size:12px; cursor:pointer" style-hover="border-color:#0F5C3F; color:#0F5C3F">{{ t }}</div>';
if (!template.includes(OLD_TAG)) { console.error('タグの並びが見つからない'); process.exit(1); }
template = template.replace(OLD_TAG,
  '                <div onClick="{{ t.go }}" style="padding:8px 14px; border:1px solid {{ t.border }}; border-radius:18px; font-size:12px; cursor:pointer; background:{{ t.bg }}; color:{{ t.fg }}" style-hover="border-color:#0F5C3F">{{ t.label }}</div>');

const OLD_TAGS = "      tags: ['すべて','RELATIONSHIP','MONEY','FOCUS','LEARNING','NEGOTIATION','COURAGE'],";
if (!logic.includes(OLD_TAGS)) { console.error('タグの一覧が見つからない'); process.exit(1); }
logic = logic.replace(OLD_TAGS,
  "      tags: ['すべて','RELATIONSHIP','MONEY','FOCUS','LEARNING','NEGOTIATION','COURAGE'].map(t => ({\n"
  + "        label:t, go:()=>this.setState({wtag:t}),\n"
  + "        bg: s.wtag===t ? '#141310' : 'transparent',\n"
  + "        fg: s.wtag===t ? '#F4F1EA' : '#3B382F',\n"
  + "        border: s.wtag===t ? '#141310' : 'rgba(20,19,16,.16)'})),");

/* 選ばれたタグで絞る。数の表示は全体のままにする（ライブラリ全体の規模を示すため） */
const OLD_WISDOM_PASS = '      logs, wisdom: s.wisdom || [],';
if (!logic.includes(OLD_WISDOM_PASS)) { console.error('知恵の受け渡しが見つからない'); process.exit(1); }
logic = logic.replace(OLD_WISDOM_PASS,
  "      logs, wisdom: (s.wtag && s.wtag !== 'すべて') ? (s.wisdom || []).filter(w => w.tag === s.wtag) : (s.wisdom || []),");

logic = logic.replace('noTreasury:true,', "noTreasury:true, wtag:'すべて',");
if (!logic.includes("wtag:'すべて'")) { console.error('選んだタグの入れ物を作れなかった'); process.exit(1); }

/* 絞り込んだ結果が0枚のときの案内。1枚も無いときとは文を分ける */
logic = logic.replace('      noQuests:s.noQuests, noWisdom:s.noWisdom,',
  "      noQuests:s.noQuests,\n"
  + "      noWisdom:s.noWisdom,\n"
  + "      noHit:!s.noWisdom && s.wtag !== 'すべて' && !(s.wisdom || []).some(w => w.tag === s.wtag),");

const W_EMPTY = '            <sc-if value="{{ noWisdom }}">\n              <div style="background:#FBF9F3; border:1px solid rgba(20,19,16,.12); border-radius:12px; padding:22px; font-size:13px; line-height:1.9; color:#6E695C">まだ知恵カードがありません。知恵は、クエストを完了したときに生まれます。</div>\n            </sc-if>';
if (!template.includes(W_EMPTY)) { console.error('知恵が無いときの案内が見つからない'); process.exit(1); }
template = template.replace(W_EMPTY, W_EMPTY
  + '\n            <sc-if value="{{ noHit }}">\n'
  + '              <div style="background:#FBF9F3; border:1px solid rgba(20,19,16,.12); border-radius:12px; padding:22px; font-size:13px; line-height:1.9; color:#6E695C">この分類の知恵はまだありません。</div>\n'
  + '            </sc-if>');

/* ㉓ 公園を記録から出す。並べ方はそのまま。 */
[['      board: BOARD.map(b => { const on = !!s.joined[b.id]; return {...b, join:this.joinBoard(b.id),\n        label: on ? \'✓ 乗ってる\' : \'乗る\', bg: on ? \'#C2703D\' : \'transparent\', fg: on ? \'#F4F1EA\' : \'#C2703D\'}; }),',
  '      board: s.board || [],'],
 ['      dumb: DUMB, rooms: ROOMS, events: EVENTS,', '      dumb: s.dumb || [], rooms: s.rooms || [], events: s.events || [],']
].forEach(function (pair) {
  if (!logic.includes(pair[0])) { console.error('公園の受け渡しが見つからない'); process.exit(1); }
  logic = logic.replace(pair[0], pair[1]);
});
logic = logic.replace("noTreasury:true, wtag:'すべて',",
  "noTreasury:true, wtag:'すべて', board:[], dumb:[], rooms:[], events:[], noPark:true,");
if (!logic.includes('noPark:true,')) { console.error('公園の入れ物を作れなかった'); process.exit(1); }
logic = logic.replace('try { window.parent.spDaoLoadTreasury(this); } catch (e) {}',
  'try { window.parent.spDaoLoadTreasury(this); } catch (e) {} try { window.parent.spDaoLoadPark(this); } catch (e) {}');
logic = logic.replace('      noQuests:s.noQuests,', '      noQuests:s.noQuests, noPark:s.noPark,');

const PARK_HEAD = '                <div style="font-size:17px; font-weight:700">今日ひま？ボード</div>';
if (!template.includes(PARK_HEAD)) { console.error('公園の見出しが見つからない'); process.exit(1); }
template = template.replace(PARK_HEAD,
  '                <sc-if value="{{ noPark }}"><div style="font-size:13px; line-height:1.9; color:#6E695C">公園にはまだ何もありません。</div></sc-if>\n'
  + PARK_HEAD);

/* ㉔ スマホ用のメニューをヘッダーに置く。
      スマホにはサイドバーが無く、そこにあるもの
      （パスポート・ブランドの切り替え・お問い合わせ）に手が届かない。
      冷蔵庫くんの左に、1つだけボタンを足してまとめて開く。 */
const REIZO_BTN = '        <div onClick="{{ askReizo }}" title="冷蔵庫くんに聞く"';
if (!template.includes(REIZO_BTN)) { console.error('冷蔵庫くんのボタンが見つからない'); process.exit(1); }
template = template.replace(REIZO_BTN,
  '        <div onClick="{{ openMenu }}" title="メニュー" style="display:{{ L.menuShow }}; width:38px; height:38px;'
  + ' flex:0 0 38px; border:1px solid rgba(20,19,16,.16); border-radius:7px; align-items:center;'
  + ' justify-content:center; cursor:pointer; font-family:Inter,sans-serif; font-size:16px; color:#0F5C3F"'
  + ' style-hover="background:#E7E2D6">☰</div>\n'
  + REIZO_BTN);

/* サイドバーが無い端末（スマホ）だけ出す */
const L_LINE = "const L = {...base, sidebarShow:";
if (!logic.includes(L_LINE)) { console.error('枠の寸法の組み立てが見つからない'); process.exit(1); }
logic = logic.replace(L_LINE, "const L = {...base, menuShow: hasSidebar ? 'none' : 'flex', sidebarShow:");

logic = logic.replace(OLD_PASS + `
      me:s.me,`, OLD_PASS + `
      me:s.me,
      openMenu:() => { try { window.parent.openSpMobileMenu(); } catch (e) {} },`);
if (!logic.includes('openMenu:()')) { console.error('メニューの受け渡しに入れられなかった'); process.exit(1); }

/* ㉕ ギルドを2つに分ける。
      議題ごとに「一般ギルド／特殊ギルド」を出し、
      右の説明を、いまの決まりに書き直す。 */
const V_STATE = '                      <div style="font-family:Inter,sans-serif; font-size:10px; letter-spacing:.16em; padding:5px 10px; border-radius:4px; background:{{ v.stateBg }}; color:{{ v.stateFg }}">{{ v.stateLabel }}</div>';
if (!template.includes(V_STATE)) { console.error('議題の状態表示が見つからない'); process.exit(1); }
template = template.replace(V_STATE,
  '                      <div style="display:flex; align-items:center; gap:8px">\n'
  + '                        <div style="font-family:Inter,sans-serif; font-size:10px; letter-spacing:.16em; padding:5px 10px; border-radius:4px; background:{{ v.stateBg }}; color:{{ v.stateFg }}">{{ v.stateLabel }}</div>\n'
  + '                        <div style="font-size:10px; letter-spacing:.06em; padding:5px 10px; border-radius:4px; background:{{ v.kindBg }}; color:{{ v.kindFg }}">{{ v.kindLabel }}</div>\n'
  + '                      </div>');

const G_RULE = `              <div style="font-size:15px; font-weight:700">投票の決まり</div>
              <div style="font-size:13px; line-height:1.95; color:#3B382F">議題は誰でも出せます。票は1つのパスポートにつき1票。入れた票は取り消しも書き換えもできません。</div>`;
if (!template.includes(G_RULE)) { console.error('投票の決まりが見つからない'); process.exit(1); }
template = template.replace(G_RULE,
`              <div style="font-size:15px; font-weight:700">ギルドの決まり</div>
              <div style="font-size:13px; line-height:1.95; color:#3B382F">議題を出せるのは、運営・有料の方・信用が足りている方です。<b>一般ギルド</b>の議題は誰でも投票できます。<b>特殊ギルド</b>は、関われる方だけが投票できます。票は1つのパスポートにつき1票で、入れた票は取り消しも書き換えもできません。</div>
              <div style="background:#F4F1EA; border-radius:8px; padding:14px; display:flex; flex-direction:column; gap:6px">
                <div style="font-size:12px; color:#6E695C">あなたの信用スコア</div>
                <div style="font-family:Inter,sans-serif; font-size:22px; font-weight:600; color:#0F5C3F">{{ trust.total }} <span style="font-size:12px; color:#6E695C">/ {{ trust.need }}</span></div>
                <div style="font-size:11px; line-height:1.8; color:#6E695C">{{ trust.detail }}</div>
              </div>`);

/* 手順を5段に振り直す（信用が増える → 議題 → 投票 → 結果 → 残る） */
const step = function (n, text) {
  return '                <div style="display:flex; gap:12px; align-items:center; font-size:13px">'
    + '<div style="font-family:Inter,sans-serif; font-size:10px; color:#0F5C3F; letter-spacing:.1em">'
    + n + '</div>' + text + '</div>';
};
[['01', '議題を出す'], ['02', '締切まで投票する'], ['03', '入れたあとに結果が見える'], ['04', '結果はそのまま残る']]
  .forEach(function (p) {
    if (!template.includes(step(p[0], p[1]))) { console.error('ギルドの手順が見つからない: ' + p[1]); process.exit(1); }
  });
template = template.replace(step('04', '結果はそのまま残る'), step('05', '結果はそのまま残る'));
template = template.replace(step('03', '入れたあとに結果が見える'), step('04', '入れたあとに結果が見える'));
template = template.replace(step('02', '締切まで投票する'), step('03', '締切まで投票する'));
template = template.replace(step('01', '議題を出す'),
  step('01', '完走・知恵・引用で信用が増える') + '\n' + step('02', '議題を出す'));

logic = logic.replace("noTreasury:true, wtag:'すべて',",
  "noTreasury:true, wtag:'すべて', canGuild:false, trust:{total:0, need:20, detail:'読み込んでいます…'},");
if (!logic.includes('canGuild:false')) { console.error('ギルドの入れ物を作れなかった'); process.exit(1); }
logic = logic.replace('      votes:s.votes, noVotes:s.noVotes,',
  '      votes:s.votes, noVotes:s.noVotes, canGuild:s.canGuild, trust:s.trust,');

/* クエストが1件も無いときに詳細画面が落ちないようにする。
   （cur が undefined のまま cur.title を見ていた） */
const OLD_CUR = 'const cur = exps.find(e => e.id === s.expId) || exps[0];';
if (!logic.includes(OLD_CUR)) { console.error('選ばれているクエストの決め方が見つからない'); process.exit(1); }
logic = logic.replace(OLD_CUR, 'const cur = exps.find(e => e.id === s.expId) || exps[0] || {};');

/* ㉖ 見出しの言葉を直す。 */
const H_HOME = "      home:['THE SQUARE / 今週の広場','おはよう、' + s.me.name],";
if (!logic.includes(H_HOME)) { console.error('今週の広場の見出しが見つからない'); process.exit(1); }
logic = logic.replace(H_HOME, "      home:['The week / 今週の広場','おはよう、' + s.me.name],");

const H_PARK = "      park:['THE PARK / 公園','締切のないほう'],";
if (!logic.includes(H_PARK)) { console.error('公園の見出しが見つからない'); process.exit(1); }
logic = logic.replace(H_PARK, "      park:['THE PARK / 公園','無我夢中で遊ぼう'],");

/* ㉗ 右上のボタンは「クエストを出す」。
      「提案する」だと、ギルドの「議題を出す」と同じことに見えてしまう。
      この2つは別もの:
        ＋ クエストを出す … 仕事を出す（運営）
        ＋ 議題を出す     … DAOの決めごとを出す（ギルド） */
[["ctaLabel:'＋ 提案する'", "ctaLabel:'＋ クエストを出す'"],
 ["ctaLabel:'＋ 提案'",     "ctaLabel:'＋ クエスト'"]].forEach(function (pair) {
  if (!logic.includes(pair[0])) { console.error('ボタンの文字が見つからない: ' + pair[0]); process.exit(1); }
  logic = logic.replace(pair[0], pair[1]);
});

const H_PROPOSE = "      propose:['NEW QUEST', W+'を提案する']";
if (!logic.includes(H_PROPOSE)) { console.error('提案画面の見出しが見つからない'); process.exit(1); }
logic = logic.replace(H_PROPOSE, "      propose:['NEW QUEST', W+'を出す']");

const EMPTY_Q = 'まだクエストがありません。右上の「＋ 提案する」から出せます。';
if (!template.includes(EMPTY_Q)) { console.error('クエストが無いときの案内が見つからない'); process.exit(1); }
template = template.replace(EMPTY_Q, 'まだクエストがありません。上の「＋ クエストを出す」から出せます（運営のみ）。');

/* ㉘ 「ログを書く」を「タスク管理」に。
      クエストログという画面はもう無い（ギルドになった）。
      自分の宿題の続きは、受けたクエストの一覧にある。 */
const OLD_LOGLINK = '                  <div onClick="{{ goLogs }}" style="text-align:center; font-size:13px; font-weight:700; color:#0F5C3F; cursor:pointer; padding-top:2px">ログを書く →</div>';
if (!template.includes(OLD_LOGLINK)) { console.error('「ログを書く」のリンクが見つからない'); process.exit(1); }
template = template.replace(OLD_LOGLINK,
  '                  <div onClick="{{ goExperiments }}" style="text-align:center; font-size:13px; font-weight:700; color:#0F5C3F; cursor:pointer; padding-top:2px">タスク管理 →</div>');

/* ㉙ クエストは「仕事」だと分かる書き方にする。
      公園との対比が「ひとりで試す／みんなでやる」のままだと、
      報酬のある仕事だということが伝わらない。 */
const PARK_TEXT = 'クエストが「ひとりで試す」なら、公園は「みんなでやる」。数えないし、評価もしない。';
if (!template.includes(PARK_TEXT)) { console.error('公園の説明が見つからない'); process.exit(1); }
template = template.replace(PARK_TEXT,
  'クエストが「報酬のある仕事」なら、公園は「報酬のない遊び」。数えないし、評価もしない。');

/* クエスト一覧の頭に、これが何の場所かと「＋ クエストを出す」を置く。
   ボタンはヘッダーの右上に出ていたが、どの画面にいても出ているため
   ギルドの「＋ 議題を出す」と紛らわしかった。クエストの場所にだけ置く。 */
const HEADER_CTA = '        <div onClick="{{ goPropose }}" style="padding:12px 18px; background:#0F5C3F; color:#F4F1EA; border-radius:6px; font-size:14px; font-weight:700; cursor:pointer; white-space:nowrap" style-hover="background:#0A3F2B">{{ L.ctaLabel }}</div>\n';
if (!template.includes(HEADER_CTA)) { console.error('ヘッダーのクエストボタンが見つからない'); process.exit(1); }
template = template.replace(HEADER_CTA, '');

const Q_FILTERS = '        <sc-if value="{{ isExperiments }}" hint-placeholder-val="{{ false }}">\n          <div style="display:flex; flex-direction:column; gap:24px">\n';
if (!template.includes(Q_FILTERS)) { console.error('クエスト一覧の入口が見つからない'); process.exit(1); }
template = template.replace(Q_FILTERS, Q_FILTERS
  + '            <div style="background:#E7E2D6; border-radius:12px; padding:20px 22px; display:flex; gap:18px; align-items:center; flex-wrap:wrap">\n'
  + '              <div style="flex:1 1 380px; min-width:0; font-size:13px; line-height:1.95; color:#3B382F">'
  + 'クエストは<b>仕事</b>です。SchoolPark・Emu・Camellia などの仕事を、DAOのメンバーやそれ以外の方が引き受けて動かします。<br>'
  /* 予算の出どころと、受け取ったあとの扱いを先に書いておく。
     あとから知らせるより、受ける前に見えているほうがいい。 */
  + '<b>予算は SchoolPark が決めて出します。</b>報酬は EMUER・JPYC・円 のいずれかです。<br>'
  + '受け取ったぶんは<b>雑所得</b>にあたります。ほかの所得と合わせて年20万円を超えると、確定申告が必要になります。<br>'
  + '決めごとを話し合う場所は<b>ギルド</b>です。こちらとは別ものです。'
  + '</div>\n'
  + '              <div onClick="{{ goPropose }}" style="padding:12px 18px; background:#0F5C3F; color:#F4F1EA;'
  + ' border-radius:6px; font-size:14px; font-weight:700; cursor:pointer; white-space:nowrap; flex:0 0 auto"'
  + ' style-hover="background:#0A3F2B">＋ クエストを出す</div>\n'
  + '            </div>\n');

/* ㉚ トレジャリーを「ある／約束済み／使える」の3段にして、通貨ごとに出す。

      これまでは大きな数字が1つだけで、しかもその中身は
      「クエストに付いた予算の合計」＝これから払う約束でしかなかった。
      いくら持っているかはどこにも出ていないので、
      払えない約束をしても気づけない。 */
const T_HEAD = `              <div style="display:flex; flex-direction:column; gap:10px">
                <div style="font-family:Inter,sans-serif; font-size:10px; letter-spacing:.22em; color:#D0E2BE">TOTAL BUDGET</div>
                <div style="font-family:Inter,sans-serif; font-size:{{ L.bigNum }}; font-weight:600; line-height:1">¥{{ treasury.total }}</div>
                <div style="font-size:13px; color:rgba(244,241,234,.6)">今月の確保 ¥{{ treasury.in }} / 分配 ¥{{ treasury.out }}</div>
              </div>`;
if (!template.includes(T_HEAD)) { console.error('トレジャリーの見出しが見つからない'); process.exit(1); }
template = template.replace(T_HEAD,
`              <div style="display:flex; flex-direction:column; gap:20px">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap">
                  <div style="font-family:Inter,sans-serif; font-size:10px; letter-spacing:.22em; color:#D0E2BE">TREASURY</div>
                  <div style="display:flex; gap:6px; flex-wrap:wrap">
                    <sc-for list="{{ treasury.curTabs }}" as="ct" hint-placeholder-count="3">
                      <div onClick="{{ ct.go }}" style="padding:6px 14px; border-radius:14px; font-size:12px; font-weight:600; cursor:pointer; border:1px solid rgba(244,241,234,.24); background:{{ ct.bg }}; color:{{ ct.fg }}">{{ ct.label }}</div>
                    </sc-for>
                  </div>
                </div>
                <div style="display:flex; flex-direction:column; gap:12px">
                  <div style="display:flex; gap:26px; flex-wrap:wrap">
                    <div style="display:flex; flex-direction:column; gap:4px">
                      <div style="font-size:11px; color:rgba(244,241,234,.55)">ある</div>
                      <div style="font-family:Inter,sans-serif; font-size:26px; font-weight:600; line-height:1.1">{{ treasury.card.have }}</div>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:4px">
                      <div style="font-size:11px; color:rgba(244,241,234,.55)">約束済み</div>
                      <div style="font-family:Inter,sans-serif; font-size:26px; font-weight:600; line-height:1.1">{{ treasury.card.promised }}</div>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:4px">
                      <div style="font-size:11px; color:rgba(244,241,234,.55)">使える</div>
                      <div style="font-family:Inter,sans-serif; font-size:26px; font-weight:600; line-height:1.1; color:{{ treasury.card.freeColor }}">{{ treasury.card.free }}</div>
                    </div>
                  </div>
                  <div style="font-size:11px; color:rgba(244,241,234,.5)">{{ treasury.card.month }}</div>
                  <div style="font-size:11px; color:#E08A7A">{{ treasury.card.warn }}</div>
                </div>
              </div>`);

/* ㉛ 配分の帯を、通貨ごとに切り替えられるようにする。
      1つの帯にまとめていたときは、円・JPYC・EMUER の額を足していた。
      単位が違うものを足しているので、通貨を混ぜた瞬間に意味のない数字になる。
      通貨を選んで、その通貨の中だけで割合を出す。 */
const T_ALLOC = `              <div style="display:flex; flex-direction:column; gap:14px">
                <sc-for list="{{ treasury.alloc }}" as="a" hint-placeholder-count="4">
                  <div style="display:flex; flex-direction:column; gap:8px">
                    <div style="display:flex; justify-content:space-between; font-size:13px">
                      <div style="color:rgba(244,241,234,.8)">{{ a.label }}</div>
                      <div style="font-family:Inter,sans-serif; color:#D0E2BE">{{ a.pct }}</div>
                    </div>
                    <div style="height:6px; background:rgba(244,241,234,.14); border-radius:3px; overflow:hidden"><div style="height:100%; background:#D0E2BE; width:{{ a.pct }}"></div></div>
                  </div>
                </sc-for>
              </div>`;
if (!template.includes(T_ALLOC)) { console.error('配分の帯が見つからない'); process.exit(1); }
template = template.replace(T_ALLOC,
`              <div style="display:flex; flex-direction:column; gap:14px">
                <div style="font-size:13px; font-weight:700; color:#D0E2BE">{{ treasury.allocTitle }}</div>
                <sc-for list="{{ treasury.alloc }}" as="a" hint-placeholder-count="4">
                  <div style="display:flex; flex-direction:column; gap:8px">
                    <div style="display:flex; justify-content:space-between; gap:12px; font-size:13px">
                      <div style="color:rgba(244,241,234,.8); min-width:0">{{ a.label }}</div>
                      <div style="font-family:Inter,sans-serif; color:#D0E2BE; white-space:nowrap">{{ a.amount }} · {{ a.pct }}</div>
                    </div>
                    <div style="height:6px; background:rgba(244,241,234,.14); border-radius:3px; overflow:hidden"><div style="height:100%; background:#D0E2BE; width:{{ a.pct }}"></div></div>
                  </div>
                </sc-for>
                <div style="font-size:11px; line-height:1.8; color:rgba(244,241,234,.45)">{{ treasury.allocNote }}</div>
              </div>`);

/* 最初の状態も、新しい形に合わせる。
   ここが古いままだと、読み込みが終わるまで枠が1つも出ない。 */
const T_INIT = "treasury:{total:'0', in:'0', out:'0', alloc:[], txs:[]}";
if (!logic.includes(T_INIT)) { console.error('トレジャリーの初期値が見つからない'); process.exit(1); }
logic = logic.replace(T_INIT,
  "treasury:{card:{have:'¥0', promised:'¥0', free:'¥0', freeColor:'#D0E2BE', warn:'', month:'今月 +¥0 / -¥0'},"
  + " curTabs:[], allocTitle:'内訳（円）', allocNote:'', alloc:[], txs:[]}");

/* 足もとの説明を、いまの中身に合わせる */
const T_NOTE2 = '分配ルール：完走したメンバーに予算の70%、知恵カードの引用数に応じて20%、残り10%を次の原資にプール。<br>外からの入出金はまだ記録していません。ここに出ているのは、クエストに付いた予算です。';
if (!template.includes(T_NOTE2)) { console.error('トレジャリーの注記が見つからない'); process.exit(1); }
template = template.replace(T_NOTE2,
  '<b>ある</b>は、記録された入金から支出を引いた額。<b>約束済み</b>は、まだ完了していないクエストの予算。'
  + '<b>使える</b>はその差です。ここがマイナスなら、払えない約束をしていることになります。<br>'
  /* 「集めた会費をそのまま配っている」ように読めると、
     他人のお金を右から左に流している形に見える。
     予算はSchoolParkが決めて出すものだと、はっきり書く。 */
  + 'クエストの予算は、SchoolPark が決めて出します。下の割合は、その予算の分け方です。<br>'
  + '完走したメンバーに予算の70%、知恵カードの引用数に応じて20%、残り10%を次の原資にプール。<br>'
  + '完了したクエストの分配は、実際に払ったときに支出として記録してください。');

const T_EMPTY = 'まだお金の動きがありません。クエストに予算が付くと、ここに出ます。';
if (!template.includes(T_EMPTY)) { console.error('トレジャリーの空の案内が見つからない'); process.exit(1); }
template = template.replace(T_EMPTY,
  'まだお金の動きがありません。管理画面から入金を記録するか、クエストに予算が付くと、ここに出ます。');

/* Component クラスより前に置く必要がある土台。
   元は React と DCLogic が用意していたもの。 */
const PRELUDE = `
var React = { createRef: function () { return { current: null }; } };

var DCLogic = function () {};
DCLogic.prototype.setState = function (upd) {
  var next = (typeof upd === 'function') ? upd(this.state) : upd;
  this.state = Object.assign({}, this.state, next);
  schedule();
};
`;

const RUNTIME = `
/* ───── テンプレートを解釈して画面に出す仕組み ─────

   元は React が担っていた部分。使われている記法は3つだけだった。
     {{ 参照 }}                     … 値を差し込む（211か所、すべて単純な参照）
     <sc-for list="{{ 配列 }}" as="x"> … 繰り返す
     <sc-if value="{{ 真偽 }}">        … 出す・出さない
   ほかに onClick と ref。それだけを実装する。 */

/* 「a.b.c」をたどって値を取る */
function pick(scope, path) {
  var parts = String(path).trim().split('.');
  var v = scope;
  for (var i = 0; i < parts.length; i++) {
    if (v == null) return undefined;
    v = v[parts[i]];
  }
  return v;
}

var MUSTACHE = /\\{\\{([^}]+)\\}\\}/g;

/* 文字列の中の {{ }} を置き換える */
function fill(text, scope) {
  return text.replace(MUSTACHE, function (_, path) {
    var v = pick(scope, path);
    return (v === undefined || v === null) ? '' : String(v);
  });
}

/* 属性の値がまるごと1つの参照なら、値そのもの（関数など）を返す */
function whole(text, scope) {
  var m = /^\\s*\\{\\{([^}]+)\\}\\}\\s*$/.exec(text);
  return m ? pick(scope, m[1]) : undefined;
}

function walk(node, scope, out) {
  for (var i = 0; i < node.childNodes.length; i++) {
    var n = node.childNodes[i];

    if (n.nodeType === 3) {                       // 文字
      out.appendChild(document.createTextNode(fill(n.nodeValue, scope)));
      continue;
    }
    if (n.nodeType !== 1) continue;

    var tag = n.tagName.toLowerCase();

    if (tag === 'sc-for') {
      var list = whole(n.getAttribute('list') || '', scope) || [];
      var as = n.getAttribute('as') || 'item';
      for (var j = 0; j < list.length; j++) {
        var child = Object.create(scope);
        child[as] = list[j];
        walk(n, child, out);
      }
      continue;
    }

    if (tag === 'sc-if') {
      if (whole(n.getAttribute('value') || '', scope)) walk(n, scope, out);
      continue;
    }

    var el = document.createElementNS(n.namespaceURI, tag);
    for (var a = 0; a < n.attributes.length; a++) {
      var at = n.attributes[a], name = at.name, val = at.value;

      if (name === 'ref') {                        // 要素を控えておく
        var box = whole(val, scope);
        if (box) box.current = el;
        continue;
      }
      /* onClick は、テンプレートを読み込んだ時点で onclick に小文字化される。
         大文字で判定すると空振りするので、大小を区別せずに見る。 */
      if (/^on[a-z]+$/i.test(name)) {
        var fn = whole(val, scope);
        if (typeof fn === 'function') el.addEventListener(name.slice(2).toLowerCase(), fn);
        continue;
      }
      if (name.indexOf('hint-') === 0) continue;   // 編集画面用の目印。表示には要らない

      el.setAttribute(name, fill(val, scope));
    }
    walk(n, scope, el);
    out.appendChild(el);
  }
}

/* ───── 起動 ───── */
var app = new Component();
var host = document.getElementById('dao-root');
var tpl = document.getElementById('dao-template');
var queued = false;

function draw() {
  queued = false;
  var vals = app.renderVals();
  var frag = document.createDocumentFragment();
  walk(tpl.content, vals, frag);
  host.replaceChildren(frag);
}
/* まとめて1回だけ描き直す。
   requestAnimationFrame は、画面が描画されていない状態（背景タブなど）では
   進まないため使わない。押したのに変わらない、が起きる。 */
function schedule() {
  if (queued) return;
  queued = true;
  Promise.resolve().then(draw);
}

draw();
if (app.componentDidMount) app.componentDidMount();
`;

const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SchoolPark DAO</title>
${helmet}
<style>
/* 枠のまわりの余白・角丸・影を外す。
   これらはテンプレートに直に書かれていて、「確かめるための枠」を
   見せるためのもの。本番では画面いっぱいに出すので要らない。
   入れ子はこの3段で固定されている:
     いちばん外（背景）> 枠の入れ物 > 枠 */
#dao-root > div            { padding-bottom: 0 !important; }
#dao-root > div > div      { padding: 0 !important; }
#dao-root > div > div > div{ border-radius: 0 !important; box-shadow: none !important; }
html, body                 { height: 100%; }
</style>
</head>
<body>
<div id="dao-root"></div>

<!-- 設計ファイルのテンプレート。ここは1文字も変えていない -->
<template id="dao-template">
${template}
</template>

<script>
${PRELUDE}
${logic}
${RUNTIME}
</script>
</body>
</html>
`;

fs.writeFileSync(OUT, html);
console.log('書き出し: ' + OUT);
console.log('  テンプレート ' + template.split('\n').length + '行（そのまま）');
console.log('  データと処理 ' + logic.split('\n').length + '行（そのまま）');
console.log('  足した仕組み ' + RUNTIME.split('\n').length + '行');
