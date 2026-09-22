/* クエストの番号。

   番号は2つの系列に分かれる。

     一般（general） … ふつうのクエスト。#001 から
     特殊（special） … 特殊なクエスト。こちらも #001 から

   系列が違えば、同じ #001 が両方にある。だから番号だけでは一意にならない。

   枝番と段階もある。WORK のように、ひとつの親番号を分野で分けたいとき、
   親番号 #002 を共有したまま、分野ごとに枝番 -1〜-5 を持つ。

     #002-1 企画 ／ #002-2 営業・提案 ／ #002-3 広報・SNS運用
     #002-4 店舗運営 ／ #002-5 教育

   各枝番には段階（入門・標準・実践）の3本がある。表示は「#002-1 入門」。

   番号は自動では振らない。運営が出すときに指定する。
   自動採番だと「先に出した順」でしか番号が決まらず、
   一般 #003 を先に用意しておく、といったことができなかった。

   同じ組み合わせを二度使わないようにするのは、sp_quest_numbers の
   文書ID（予約札）。系列・番号・枝番・段階から1つの文字列を作り、
   それを文書IDにして「無ければ作る」を取引の中でやる。
   文書IDは同じものを2つ作れないので、これがそのまま重複防止になる。

   予約札のID … {系列}-{番号3桁}-{枝番}-{段階}
                 枝番なしは 0、段階なしは「なし」を入れる。
                 例：general-002-1-入門 ／ general-003-0-なし ／ special-001-0-なし

   Quest #000（founder-quest-000）は原点なので、どちらの系列にも入れない。
   番号の無い古いクエストは、番号の無いまま残す。 */
(function (root) {
  const FOUNDER_ID = 'founder-quest-000';

  /* 系列。画面に出す名前もここで持つ。 */
  const SERIES = [
    { id: 'general', name: '一般' },
    { id: 'special', name: '特殊' }
  ];
  const SERIES_IDS = SERIES.map(function (s) { return s.id; });

  /* 枝番。いまは WORK の分野分けに使っている。
     枝番を使わないクエストは 0（＝枝番なし）。 */
  const BRANCHES = [
    { n: 1, name: '企画' },
    { n: 2, name: '営業・提案' },
    { n: 3, name: '広報・SNS運用' },
    { n: 4, name: '店舗運営' },
    { n: 5, name: '教育' }
  ];
  const BRANCH_MAX = 5;

  /* 段階。3本立て。使わないクエストは空。 */
  const STAGES = ['入門', '標準', '実践'];

  const NUMBER_MAX = 999;
  const NO_STAGE_KEY = 'なし';

  function seriesName(id) {
    const s = SERIES.find(function (x) { return x.id === id; });
    return s ? s.name : '';
  }
  function branchName(n) {
    const b = BRANCHES.find(function (x) { return x.n === Number(n); });
    return b ? b.name : '';
  }

  /* 形が正しいか。画面・取引・記録の決まりで同じ答えになるように、
     判定はここ1か所にまとめる。 */
  function isValidNumber(n) {
    return Number.isSafeInteger(n) && n >= 1 && n <= NUMBER_MAX;
  }
  function isValidSeries(s) { return SERIES_IDS.indexOf(s) >= 0; }
  function isValidBranch(b) {
    return Number.isSafeInteger(b) && b >= 0 && b <= BRANCH_MAX;
  }
  function isValidStage(s) { return s === '' || STAGES.indexOf(s) >= 0; }

  /* 予約札のID。ここが記録の決まり（firestore.rules）と
     一字一句そろっていないと、書き込みが弾かれる。 */
  function numberKey(series, number, branch, stage) {
    return String(series) + '-'
      + String(number).padStart(3, '0') + '-'
      + String(Number(branch) || 0) + '-'
      + (stage ? String(stage) : NO_STAGE_KEY);
  }
  function numberKeyOf(q) {
    q = q || {};
    return numberKey(q.series, q.questNumber, q.branch || 0, q.stage || '');
  }

  function isFounder(q) {
    return q.id === FOUNDER_ID && q.kind === 'founder' && q.questNumber === 0;
  }
  function isSpecial(q) {
    return !isFounder(q) && q && q.series === 'special';
  }
  /* 系列。#000 と、番号の無い古いクエストは、どちらにも属さない。 */
  function seriesOf(q) {
    return (q && isValidSeries(q.series) && !isFounder(q)) ? q.series : '';
  }

  /* 番号の見た目。系列は付けない。
     一覧のように「いまどちらの系列を見ているか」が別に出ている場所で使う。

       #001 ／ #002-1 ／ #002-1 入門 */
  function label(q) {
    q = q || {};
    if (!Number.isSafeInteger(q.questNumber) || q.questNumber < 0) return '';
    let s = '#' + String(q.questNumber).padStart(3, '0');
    if (!isFounder(q) && Number.isSafeInteger(q.branch) && q.branch >= 1) s += '-' + q.branch;
    if (!isFounder(q) && q.stage && STAGES.indexOf(q.stage) >= 0) s += ' ' + q.stage;
    return s;
  }

  /* 系列まで込みの見た目。系列の切り替えが無い場所で使う。
     一般は今までどおり番号だけ。特殊のときだけ前に「特殊」と付ける。
     どちらにも「一般」と付けると、いままでの見た目が全部変わってしまう。

       #001 ／ 特殊 #001 ／ 特殊 #002-1 入門 */
  function fullLabel(q) {
    const l = label(q);
    if (!l) return '';
    return isSpecial(q) ? '特殊 ' + l : l;
  }
  /* HTML の中で「特殊」だけ小さく出したいとき用。特殊でなければ空。 */
  function seriesTag(q) { return isSpecial(q) ? '特殊' : ''; }

  /* #000 の全文。記録の形が崩れていても、ここで必ず配列にして返す。
     素通しにすると、欄が1つ欠けただけで画面全体が描けなくなる。 */
  function sections(q) {
    if (!isFounder(q) || !Array.isArray(q.founderSections)) return [];
    return q.founderSections.map(function (s) {
      s = s || {};
      return { title: String(s.title || ''), body: String(s.body || '') };
    });
  }

  /* すでに使われている予約札を読む。フォームで「空いていない番号は選べない」
     ようにするために使う。読めなかったときは null（＝分からない）を返す。
     0件と区別できないと、通信が届かないだけで全部空きに見えてしまう。 */
  async function takenNumbers(fb, db) {
    try {
      const snap = await fb.getDocs(fb.collection(db, 'sp_quest_numbers'));
      if (!snap.size && snap.metadata && snap.metadata.fromCache) return null;
      const out = {};
      snap.forEach(function (s) { out[s.id] = true; });
      return out;
    } catch (e) { return null; }
  }

  /* クエストを出す。番号は data に入れて渡す（series / questNumber / branch / stage）。

     クエスト本体と予約札を、1つの取引でいっしょに作る。
     取引の中で予約札を読み、無いことを確かめてから書く。
     途中で誰かが同じ番号を取ったら、取引はそこで巻き戻る。 */
  async function createQuest(fb, db, data) {
    const series = String(data.series || '');
    const number = Number(data.questNumber);
    const branch = Number(data.branch || 0);
    const stage = String(data.stage || '');

    if (!isValidSeries(series)) throw new Error('QUEST_SERIES_INVALID');
    if (!isValidNumber(number)) throw new Error('QUEST_NUMBER_INVALID');
    if (!isValidBranch(branch)) throw new Error('QUEST_BRANCH_INVALID');
    if (!isValidStage(stage)) throw new Error('QUEST_STAGE_INVALID');

    const ref = fb.doc(fb.collection(db, 'sp_quests'));
    const key = numberKey(series, number, branch, stage);
    const reserve = fb.doc(db, 'sp_quest_numbers', key);

    const body = Object.assign({}, data, {
      series: series,
      questNumber: number,
      branch: branch,
      stage: stage
    });

    return await fb.runTransaction(db, async function (tx) {
      if ((await tx.get(reserve)).exists()) throw new Error('QUEST_NUMBER_TAKEN');
      tx.set(ref, body);
      tx.set(reserve, { questId: ref.id });
      return { id: ref.id, series: series, questNumber: number, branch: branch, stage: stage };
    });
  }

  const api = {
    FOUNDER_ID, SERIES, SERIES_IDS, BRANCHES, BRANCH_MAX, STAGES, NUMBER_MAX,
    seriesName, branchName, seriesOf, isSpecial, seriesTag,
    isValidSeries, isValidNumber, isValidBranch, isValidStage,
    numberKey, numberKeyOf, takenNumbers,
    label, fullLabel, isFounder, sections, createQuest
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpQuestStore = api;
})(typeof window !== 'undefined' ? window : this);
