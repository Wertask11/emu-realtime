/* Apply the Founder-only presentation after the existing DAO transformations. */
module.exports = function founderQuest(template, logic) {
  const home = '<sc-if value="{{ isHome }}"';
  if (!template.includes(home)) throw new Error('Founder insertion point missing');
  const founder = `
        <sc-if value="{{ showFounder }}">
          <section style="background:#0F5C3F; color:#F4F1EA; border-radius:12px; padding:24px; margin-bottom:24px; overflow-wrap:anywhere">
            <div style="font-size:11px; letter-spacing:.12em; color:#D0E2BE">FOUNDER QUEST · 恒久の原点</div>
            <h2 style="font-size:24px; line-height:1.5">SchoolPark Quest #000</h2>
            <p style="line-height:1.9">目印にしてスタート、ゴールにして原点、原点にして頂点</p>
            <p style="font-size:13px; line-height:1.9">SchoolParkは何のために存在するのか。どんな社会をつくりたいのか。何を大切にするのか。その原点を記録する。</p>
            <p style="font-size:13px">報酬 0円 · Founder 1人 · 期限なし</p>
            <button onClick="{{ founder.open }}" style="font:inherit; background:#D0E2BE; color:#141310; border:0; border-radius:6px; padding:12px 18px; cursor:pointer">#000の全文を読む</button>
            <p style="font-size:12px; line-height:1.8">実際の活動・行動・検証は #001 から開始します。</p>
          </section>
        </sc-if>
        <sc-if value="{{ isFounderDetail }}">
          <article style="max-width:860px; width:100%; min-width:0; margin:0 auto; overflow-wrap:anywhere">
            <button onClick="{{ goExperiments }}" style="font:inherit; padding:10px 16px; cursor:pointer">← クエスト一覧</button>
            <p style="color:#0F5C3F; font-weight:700">FOUNDER QUEST · 恒久の原点</p>
            <h1 style="font-size:28px; line-height:1.5">SchoolPark Quest #000</h1>
            <p style="font-weight:700; line-height:1.9">目印にしてスタート、ゴールにして原点、原点にして頂点</p>
            <p style="line-height:1.9">SchoolParkは何のために存在するのか。どんな社会をつくりたいのか。何を大切にするのか。その原点を記録する。</p>
            <p style="line-height:1.9">報酬 0円 · 参加必要人数 1人（Founder） · 期限なし<br>実際の活動・行動・検証は #001 から開始します。</p>
            <sc-for list="{{ founderSections }}" as="section">
              <details style="background:#FBF9F3; border:1px solid rgba(20,19,16,.16); border-radius:10px; padding:18px; margin:16px 0; min-width:0">
                <summary style="font-size:17px; font-weight:700; line-height:1.7; cursor:pointer">{{ section.title }}</summary>
                <div style="white-space:pre-wrap; overflow-wrap:anywhere; font-size:15px; line-height:2; margin-top:20px">{{ section.body }}</div>
              </details>
            </sc-for>
            <p><a href="https://note.com/paberuuu11/n/nb4417c69b0c6" target="_blank" rel="noopener noreferrer">SchoolPark論文の出典（note）</a></p>
          </article>
        </sc-if>
        `;
  template = template.replace(home, founder + home);
  logic = logic.replace("const exps = (s.quests || []).map(e => this.decorate(e));",
    "const allQuests = (s.quests || []).map(e => this.decorate(e));\n    const founder = allQuests.find(e => e.isFounder);\n    const exps = allQuests.filter(e => !e.isFounder);");
  logic = logic.replace("const cur = exps.find(e => e.id === s.expId)", "const cur = allQuests.find(e => e.id === s.expId)");
  logic = logic.replace("isDetail:s.screen==='detail',", "isDetail:s.screen==='detail' && !cur.isFounder,\n      isFounderDetail:s.screen==='detail' && !!cur.isFounder,\n      showFounder:!!founder && (s.screen==='home' || s.screen==='experiments'),\n      founder:founder || {}, founderSections:founder ? founder.founderSections : [],");
  logic = logic.replace('noQuests:s.noQuests,', 'noQuests:exps.length === 0,');
  logic = logic.replace("canClose: !!e.isMine", "canClose: !e.isFounder && !!e.isMine");
  logic = logic.replace("canLog: !!e.iTook", "canLog: !e.isFounder && !!e.iTook");
  if (!logic.includes('showFounder:')) throw new Error('Founder logic insertion failed');
  return { template, logic };
};
