/* クエスト1本ぶんの「EMUERの予算を公開」。

   ここが既定で出す数字は、そのまま Enter を押せば通る。
   10/2、一般 #001 のカードには総額の 12,500 EMUER が入っていて、
   それを「1人あたり」の既定にしたせいで 1人 12,500 の予算が立った。
   100人ぶんで 1,250,000 EMUER。月間の上限 416,000 を越える額が、
   取り消せない形で出た。

   なので確かめる。カードの額と段から決まる額が食い違ったら、
   既定は安いほう（段から決まる額）にすること。食い違いを文面で
   見せること。人が入れた額はそのまま通すこと。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const ADMIN = fs.readFileSync(path.join(root, 'frontend/public/membership-admin.html'), 'utf8');

const START = 'el.querySelectorAll("[data-qbudget]")';
const END = 'el.querySelectorAll("[data-qunapprove]")';
const SRC = ADMIN.slice(ADMIN.indexOf(START), ADMIN.indexOf(END));
assert.ok(SRC.indexOf('data-qbudget') >= 0 && SRC.length > 900, '1本ぶんの口が見つかりません');

/* 行の描画。ボタンに段から決まる額が乗っていないと、
   押したときに比べる相手がなくなる。 */
test('行のボタンは、カードの額と段から決まる額の両方を持つ', () => {
  const i = ADMIN.indexOf('data-qbudget="\' + esc(q.id)');
  assert.ok(i > 0, '行のボタンが見つかりません');
  const near = ADMIN.slice(i, i + 400);
  assert.ok(near.indexOf('data-qper="\' + emuPerPerson(q)') >= 0, 'カードの額が乗っていません');
  assert.ok(near.indexOf('data-qstage="\' + SP_STAGE_EMUER(q)') >= 0, '段から決まる額が乗っていません');
});

/* VM の中で作った物は prototype が違う。deepEqual がそれで落ちるので、
   中身だけ取り出して比べる。 */
const body = p => JSON.parse(JSON.stringify(p.body));

function stage(opts) {
  const o = opts || {};
  const seen = { posts: [], alerts: [], confirms: [], prompts: [], rendered: 0 };
  const button = { dataset: { qbudget: o.id || 'q1', qper: o.qper, qstage: o.qstage } };
  const answers = (o.answers || []).slice();
  const ctx = vm.createContext({
    Number, String, Math, parseInt, Array, Object, Error, JSON,
    console: { warn() {} },
    el: { querySelectorAll: () => [button] },
    prompt: (msg, def) => {
      seen.prompts.push({ msg: String(msg), def: String(def) });
      return answers.length ? answers.shift() : def;
    },
    confirm: (msg) => { seen.confirms.push(String(msg)); return o.cancel ? false : true; },
    alert: (msg) => { seen.alerts.push(String(msg)); },
    renderSchoolPark: () => { seen.rendered += 1; },
    encodeURIComponent,
    spWrite: async (fn) => fn(),
    f: {},
    ownerAddr: '0xowner',
    api: async (p, init) => {
      seen.posts.push({ path: p, body: init.body });
      if (o.fail) throw Object.assign(new Error(o.fail), { code: o.fail });
      return { ok: true };
    }
  });
  vm.runInContext(SRC, ctx);
  return { seen, fire: () => button.onclick() };
}

/* 本題。カードが総額だったとき。 */
test('カードの額と段が食い違えば、既定は段から決まる額', async () => {
  const s = stage({ qper: '12500', qstage: '100' });
  await s.fire();
  assert.equal(s.seen.prompts[0].def, '100');
  assert.equal(s.seen.posts.length, 1);
  assert.deepEqual(body(s.seen.posts[0]), { perPersonEmuer: 100, totalEmuer: 10000 });
});

test('食い違いは、聞くときの文面に両方の額を出す', async () => {
  const s = stage({ qper: '12500', qstage: '100' });
  await s.fire();
  const msg = s.seen.prompts[0].msg;
  assert.ok(msg.indexOf('12,500') >= 0, 'カードの額が文面にありません');
  assert.ok(msg.indexOf('100') >= 0, '段から決まる額が文面にありません');
  assert.ok(msg.indexOf('全体の予算') >= 0, '何が起きているのか書いてありません');
});

test('食い違っていなければ、文面は増やさない', async () => {
  const s = stage({ qper: '100', qstage: '100' });
  await s.fire();
  const msg = s.seen.prompts[0].msg;
  assert.equal(s.seen.prompts[0].def, '100');
  assert.ok(msg.indexOf('全体の予算') < 0, '食い違っていないのに警告が出ています');
});

test('カードと段が一致していれば、その額を既定にする', async () => {
  const s = stage({ qper: '200', qstage: '200' });
  await s.fire();
  assert.equal(s.seen.prompts[0].def, '200');
  assert.deepEqual(body(s.seen.posts[0]), { perPersonEmuer: 200, totalEmuer: 20000 });
});

test('カードに額が無ければ、段から決まる額を既定にする', async () => {
  const s = stage({ qper: '0', qstage: '50' });
  await s.fire();
  assert.equal(s.seen.prompts[0].def, '50');
  assert.deepEqual(body(s.seen.posts[0]), { perPersonEmuer: 50, totalEmuer: 5000 });
});

test('段も無ければ 100 にする', async () => {
  const s = stage({ qper: '0', qstage: '0' });
  await s.fire();
  assert.equal(s.seen.prompts[0].def, '100');
});

/* 人が入れた額は、そのまま通す。既定は助けであって、縛りではない。 */
test('人が入れた額は、カードや段と違ってもそのまま通す', async () => {
  const s = stage({ qper: '12500', qstage: '100', answers: ['12500', '2'] });
  await s.fire();
  assert.deepEqual(body(s.seen.posts[0]), { perPersonEmuer: 12500, totalEmuer: 25000 });
});

/* 確かめの文面。桁が読めないと、1,250,000 を見落とす。 */
test('確かめの文面は、総額を桁区切りで出す', async () => {
  const s = stage({ qper: '12500', qstage: '100', answers: ['12500', '100'] });
  await s.fire();
  assert.ok(s.seen.confirms[0].indexOf('1,250,000') >= 0,
    '総額が桁区切りになっていません：' + s.seen.confirms[0]);
  assert.ok(s.seen.confirms[0].indexOf('12,500') >= 0, '1人あたりが桁区切りになっていません');
});

test('知らせの文面も、桁区切りで出す', async () => {
  const s = stage({ qper: '12500', qstage: '100', answers: ['12500', '100'] });
  await s.fire();
  assert.ok(s.seen.alerts[0].indexOf('1,250,000') >= 0, '総額が桁区切りになっていません');
});

/* 止めたら、何も出さない。 */
test('確かめで断れば、送らない', async () => {
  const s = stage({ qper: '100', qstage: '100', cancel: true });
  await s.fire();
  assert.equal(s.seen.posts.length, 0);
  assert.equal(s.seen.alerts.length, 0);
});

test('1人あたりが数でなければ、何も聞かずに止まる', async () => {
  const s = stage({ qper: '100', qstage: '100', answers: ['なし'] });
  await s.fire();
  assert.equal(s.seen.posts.length, 0);
  assert.equal(s.seen.prompts.length, 1, '人数まで聞いています');
});

test('1人あたりが0以下なら、止まる', async () => {
  const s = stage({ qper: '100', qstage: '100', answers: ['0'] });
  await s.fire();
  assert.equal(s.seen.posts.length, 0);
});

test('人数が数でなければ、止まる', async () => {
  const s = stage({ qper: '100', qstage: '100', answers: ['100', 'たくさん'] });
  await s.fire();
  assert.equal(s.seen.posts.length, 0);
  assert.equal(s.seen.confirms.length, 0, '確かめに進んでいます');
});

/* 送り先。ここを間違えると、別のクエストに予算が付く。 */
test('送り先は、そのクエストの予算の口', async () => {
  const s = stage({ id: 'ajZRjRZAwkIn0Feu4VPF', qper: '0', qstage: '100' });
  await s.fire();
  assert.equal(s.seen.posts[0].path,
    '/api/schoolpark/quest-completions/ajZRjRZAwkIn0Feu4VPF/budget');
});

test('送れなければ、理由を出して、出せたことにしない', async () => {
  const s = stage({ qper: '100', qstage: '100', fail: 'QUEST_BUDGET_WINDOW_CLOSED' });
  await s.fire();
  assert.equal(s.seen.alerts.length, 1);
  assert.ok(s.seen.alerts[0].indexOf('QUEST_BUDGET_WINDOW_CLOSED') >= 0, '理由が出ていません');
  assert.ok(s.seen.alerts[0].indexOf('公開しました') < 0, '出せたことになっています');
  assert.equal(s.seen.rendered, 0);
});
