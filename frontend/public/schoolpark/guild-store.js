/* ───── SchoolPark のギルド ─────

   ギルドは「同じ目的・活動領域に関心を持つ人が集まる場所」。
   その中で議題（Proposal）を立て、DAOで決め、必要ならQuestとして実行する。

     Quest #000  … SchoolPark の原点。どのギルドにも属さない
     5 Guild     … SchoolPark が活動する領域
     Proposal    … 何をするかを考え、DAOで決める
     Quest #001〜 … 実際に行動する

   最初はここに書いた5つだけを出す。
   ただし「5つで固定」にはしない。将来 sp_guilds に文書が増えたら、
   読むときにここへ足される（loadGuilds が両方をまとめる）。
   新しいギルドは「議題 → 投票 → 条件達成 → 誕生」で増える想定。

   一般ギルド／特殊ギルドは、ギルドの分類ではない。
   議題ごとの投票資格（kind: free / special）としてこれまでどおり残す。
   同じギルドの中に、誰でも投票できる議題と、関われる人だけの議題が並ぶ。 */
(function (root) {

  /* 色はすべて、いま SchoolPark が使っている色から採っている。
     新しい色は足さない（画面の印象を変えないため）。 */
  const OFFICIAL = [
    {
      id: 'learn', code: '01', short: 'LEARN', name: 'LEARN Guild',
      concept: '知識を、やってみるに変える。',
      body: '知識をためるだけで終わらせない。探究学習・Emuの講座・資格や学習証明を、'
          + '実際にやってみる場所につなぐ。学んだことが知恵に変わるところまでを、このギルドで扱う。',
      themes: ['探究学習', 'Emu', '知識→知恵', '学習', '企業の仕事シミュレーション',
               '資格/学習証明', '体験から学ぶ仕組み', '学びと実践の接続'],
      accent: '#0F5C3F'
    },
    {
      id: 'work', code: '02', short: 'WORK', name: 'WORK Guild',
      concept: '貢献を、仕事と次の機会へ。',
      body: '企業の実プロジェクトやコンテスト型の案件を、SchoolParkの中で引き受ける。'
          + 'つくったものが実績になり、実績が次の仕事につながる。未経験でも入口があることを大事にする。',
      themes: ['Work-Integrated Learning（WIL）', '企業の実プロジェクト', '仕事', '企業案件',
               '報酬', 'コンテスト型案件', '貢献→仕事', '制作物→実績', '未経験者の実践機会'],
      accent: '#141310'
    },
    {
      id: 'play', code: '03', short: 'PLAY', name: 'PLAY Guild',
      concept: '遊びから、挑戦と出会いを。',
      body: 'ゲーム・謎解き・宝探し・ライブ・イベント。現実の町や公園ともつながる。'
          + '遊びのつもりで始めたことが、学びや仕事につながっていく道をつくる。',
      themes: ['ゲーム', '謎解き', 'Geocaching型宝探し', 'ライブ', 'イベント', '企業イベント',
               '現実の町や公園との接続', 'ワールド探索', '遊びと学び/仕事の接続'],
      accent: '#C2703D'
    },
    {
      id: 'connect', code: '04', short: 'CONNECT', name: 'CONNECT Guild',
      concept: '孤立ではなく、つながりながら自立する。',
      body: '公園のような偶然の出会い、居場所、ファンとの交流、支え合い。'
          + '一人で立てるようになるために、まず人とつながっていられる場所をつくる。',
      themes: ['コミュニティ', '人とのつながり', '居場所', '公園のような偶然の出会い',
               '自己表現', 'ファン交流', '支え', '交流', '人と人をつなぐ活動'],
      accent: '#B0405A'
    },
    {
      id: 'web3', code: '05', short: 'WEB3', name: 'WEB3 Guild',
      concept: '信用・価値・実績を持ち運べる社会基盤をつくる。',
      body: 'SchoolPark Passport・EMUER・DAO・NFT・KYC・ZK。'
          + 'どこへ行っても持ち運べる信用と実績のしくみを、自分たちで組み立てる。',
      themes: ['SchoolPark Passport', 'EMUER', 'DAO', 'NFT/デジタル証明', '信用', '一人1ID',
               'KYC', 'ZK', 'オンチェーン', 'ウォレット', '外部サービスとのPassport連携',
               '独自経済圏', '将来的なAIエージェント決済'],
      accent: '#3B382F'
    }
  ];

  /* 古い議題・古いクエストには guildId が無い。
     どこかのギルドへ勝手に寄せず、「未分類」として別に出す。
     運営があとから割り当てられる（Rulesでも、空のときだけ入れられる）。 */
  const UNSORTED = {
    id: '', code: '—', short: '未分類', name: '未分類の議題',
    concept: 'ギルドが決まる前に出された議題',
    body: '5つのギルドができる前に出された議題です。投票はこれまでどおりできます。'
        + '運営があとからギルドを割り当てられます。',
    themes: [], accent: '#6E695C'
  };

  /* 文書のIDに使える形。将来ギルドが増えても、この形なら Rules を触らずに済む。 */
  const ID_SHAPE = /^[a-z0-9-]{1,40}$/;

  function isValidId(id) { return typeof id === 'string' && ID_SHAPE.test(id); }

  /* 記録から読んだ1件を、画面で使える形にそろえる。
     運営が sp_guilds に入れた新しいギルドも、ここを通す。 */
  function normalize(id, d) {
    d = d || {};
    return {
      id: id,
      code: String(d.code || '—'),
      short: String(d.short || id).toUpperCase(),
      name: String(d.name || id),
      concept: String(d.concept || ''),
      body: String(d.body || ''),
      themes: Array.isArray(d.themes) ? d.themes.map(String) : [],
      accent: /^#[0-9A-Fa-f]{6}$/.test(String(d.accent || '')) ? d.accent : '#0F5C3F'
    };
  }

  /* 公式の5つと、記録にある追加分を1つの並びにする。
     同じIDがあれば、記録の側で上書きする（言葉づかいを直せるように）。
     並びは code の順。 */
  function merge(extra) {
    const out = OFFICIAL.map(function (g) { return Object.assign({}, g); });
    (extra || []).forEach(function (e) {
      if (!isValidId(e.id)) return;
      const at = out.findIndex(function (g) { return g.id === e.id; });
      if (at >= 0) out[at] = Object.assign({}, out[at], normalize(e.id, e));
      else out.push(normalize(e.id, e));
    });
    return out.sort(function (a, b) { return String(a.code).localeCompare(String(b.code)); });
  }

  function byId(list, id) {
    if (!id) return null;
    return (list || []).find(function (g) { return g.id === id; }) || null;
  }

  /* 議題・クエストが、どのギルドのものか。
     知らないIDや空のときは「未分類」に落とす（画面が落ちないように）。 */
  function guildIdOf(doc, list) {
    const id = doc && typeof doc.guildId === 'string' ? doc.guildId : '';
    if (!id) return '';
    return byId(list, id) ? id : '';
  }

  const api = { OFFICIAL, UNSORTED, isValidId, normalize, merge, byId, guildIdOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpGuildStore = api;
})(typeof window !== 'undefined' ? window : this);
