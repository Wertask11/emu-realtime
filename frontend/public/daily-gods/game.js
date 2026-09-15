
(()=>{
const root=document.getElementById('godgame');const $=s=>root.querySelector(s);
const gods=[
{name:'ア・ラーム',role:'起床の神',atk:4,heal:0,guard:0,desc:'攻撃4。前のラウンドに回復した相手には攻撃＋2。'},
{name:'イマナンテ',role:'開き直しの神',atk:3,heal:0,guard:3,desc:'攻撃3・防御3。「今なんて？」で攻撃を受け流す。'},
{name:'サロンパス',role:'鎮痛の神',atk:2,heal:4,guard:0,desc:'攻撃2・回復4。いたわりながら反撃。'},
{name:'グヌヌ',role:'言い負かされの神',atk:5,heal:0,guard:0,desc:'攻撃5。ラウンド開始時、自分の気力が相手より低ければ攻撃8。'},
{name:'ユルシタル',role:'心の広い神',atk:0,heal:5,guard:4,desc:'回復5・防御4。攻撃せず、心を立て直す。'},
{name:'カサネル',role:'重複の神',atk:2,heal:0,guard:0,desc:'前回の自分の攻撃力＋2で攻撃（最大8）。初回は攻撃2。'},
{name:'カワランテ',role:'誤差の神',atk:3,heal:0,guard:0,desc:'攻撃3。受けるダメージを最大2にする。貫通には無効。'},
{name:'シュラバトス',role:'発覚の神',atk:5,heal:0,guard:0,desc:'貫通攻撃5。相手の防御とダメージ上限を無視。'},
{name:'キャベ神',role:'胃もたれの神',atk:0,heal:8,guard:0,desc:'回復8。攻撃はしない。ピンチから一気に回復。'},

{name:'アザス',role:'感謝の神',atk:2,heal:3,guard:0,desc:'攻撃2・回復3。前回、自分が実際に回復していれば回復6。'},
{name:'サーセン',role:'謝罪の神',atk:1,heal:1,guard:5,desc:'攻撃1・回復1・防御5。深いお辞儀で受け流す。'},
{name:'オネシャス',role:'懇願の神',atk:1,heal:3,guard:1,desc:'攻撃1・防御1・回復3。開始時の気力が12以下なら回復7。'},
{name:'モノモウス',role:'異議の神',atk:4,heal:0,guard:0,desc:'攻撃4。相手のこのラウンドの回復を0にする。'},
{name:'ドセイロン',role:'王道の神',atk:6,heal:0,guard:1,desc:'攻撃6・防御1。正面から堂々と勝負。'},
{name:'アラマー',role:'驚きの神',atk:3,heal:0,guard:2,desc:'攻撃3・防御2。相手の前回の攻撃力が5以上なら攻撃6。'},
{name:'ハトバス',role:'観光の神',atk:2,heal:3,guard:2,desc:'攻撃2・回復3・防御2。旅で気分をリフレッシュ。'},
{name:'マガサス',role:'犯罪の神',atk:4,heal:2,guard:0,desc:'攻撃4・回復2。開始時の気力が相手より低ければ回復4。'},
{name:'ヒノニトン',role:'運送の神',atk:3,heal:0,guard:2,desc:'攻撃3・防御2。次のラウンドの自分の攻撃力を＋2。'},
{name:'オカーン',role:'全てを司る神',atk:3,heal:3,guard:3,desc:'攻撃3・回復3・防御3。お母さんは攻守も回復もお任せ。'}];
let state;

// 19柱の召喚演出。ゲームの計算と分離したCSSアニメーション。
const effects=[
['alarm','おはよう、起きる時間！','☀','目覚めの鐘'],
['dodge','今なんて？','？','華麗な聞き流し'],
['patch','痛いの、飛んでいけ。','✚','癒やしの湿布'],
['rage','ぐ、ぐぬぬ…！','♨','悔しさ大噴火'],
['mercy','ええんやで。','♡','すべてを許す光'],
['echo','もう一枚、重ねよう。','◇','重なる残像'],
['error','まあ、変わらんて。','≈','誤差のゆらぎ'],
['reveal','すべて、お見通しだ！','！','秘密の開封'],
['leaves','おなか、いたわろう。','🍃','キャベツの祝福'],
['thanks','アザス！ 感謝を力に。','🌸','感謝の花吹雪'],
['bow','サーセンでした！','💧','全力のお辞儀'],
['wish','どうか、オネシャス！','✦','祈りの流れ星'],
['objection','ちょっと、物申す！','！','異議ありの一撃'],
['royal','これぞ、王道。','♛','王者の光剣'],
['surprise','あらまあ！','!?','びっくり大反響'],
['tour','神々の旅へ、ご案内。','🕊','ハトバス出発'],
['shadow','ちょっと、魔が差して。','◆','忍び寄る影'],
['delivery','力を、お届け！','📦','神速の配達'],
['mother','ごはん食べて、元気出し！','☀','オカーンの大後光']
];
function summonMarkup(id,side){
 const [kind,line,particle,move]=effects[id];
 const stats=state.visual?.[side];
 return `<div class="summon summon-${kind}"><div class="summon-halo" aria-hidden="true"></div><div class="summon-portrait">${art(id)}</div><div class="summon-particles" aria-hidden="true">${Array.from({length:6},(_,i)=>`<span style="--i:${i};--x:${(i%3-1)*48}px;--y:${Math.floor(i/3)?-65:55}px">${particle}</span>`).join('')}</div><span class="summon-move">${move}</span></div>${title(id)}<span class="summon-line">「${line}」</span>${stats?`<span class="summon-numbers">回復 ＋${stats.heal} ／ 被ダメージ −${stats.damage}</span>`:''}`;
}

const shuffle=()=>{const a=gods.map((_,i)=>i);for(let i=a.length-1;i>0;i--){let j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
/* 追加10柱の絵（gods-extra.jpg / 640x1600）は、行の高さがそろっていない。
   実際の切れ目は上から 0 / 300 / 598 / 901 / 1200 で、各行の高さは
   300 / 298 / 303 / 299 / 400 px。等分（背景500%）で切ると下の行がはみ出すため、
   行ごとに background-size と background-position を出す。
   [行の開始y, 行の高さ] */
const EXTRA_IMG_H=1600;
const EXTRA_ROWS=[[0,300],[300,298],[598,303],[901,299],[1200,400]];
const extraArtStyle=n=>{
  const[y0,rh]=EXTRA_ROWS[Math.floor(n/2)];
  const sy=EXTRA_IMG_H/rh*100;
  const py=EXTRA_IMG_H===rh?0:y0/(EXTRA_IMG_H-rh)*100;
  return `background-size:200% ${sy.toFixed(3)}%;background-position:${(n%2)*100}% ${py.toFixed(3)}%`;
};
const art=id=>{const extra=id>=9;const n=extra?id-9:id;const style=extra?extraArtStyle(n):`background-position:${[0,50,100][n%3]}% ${[11,55,99][Math.floor(n/3)]}%`;return `<span class="art ${extra?'extra':''}" role="img" aria-label="${gods[id].name}" style="${style}"></span>`;};
const title=id=>`<span class="role">${gods[id].role}</span><span class="cardname">${gods[id].name}</span>`;
function makePlayer(){let deck=shuffle();return {hp:24,deck,hand:deck.splice(0,3),last:0,lastHeal:0,nextBonus:0};}
function power(id,self,other){let g=gods[id],atk=g.atk,heal=g.heal;if(id===0&&other.lastHeal>0)atk+=2;if(id===3&&self.hp<other.hp)atk=8;if(id===5)atk=Math.min(8,self.last+2);if(id===9&&self.lastHeal>0)heal=6;if(id===11&&self.hp<=12)heal=7;if(id===14&&other.last>=5)atk=6;if(id===16&&self.hp<other.hp)heal=4;atk+=self.nextBonus||0;return {atk,heal,guard:g.guard,pierce:id===7,cap:id===6?2:Infinity};}
function lockCPU(){const {p,c}=state;const score=id=>{const a=power(id,c,p);return a.atk+Math.min(a.heal,24-c.hp)*.95+a.guard*.6+(id===6?2:0)+Math.random()*3;};state.cpu=c.hand.map(id=>({id,s:score(id)})).sort((a,b)=>b.s-a.s)[0].id;}
function start(){state={p:makePlayer(),c:makePlayer(),round:1,phase:'pick',selected:null,logs:[]};lockCPU();render();}
function slot(sel,id,label){$(sel).innerHTML=id==null?`<span>${label}</span><span>✦</span>`:state.phase==='pick'?art(id)+title(id):summonMarkup(id,sel==='#gg-pslot'?'p':'c');}
function render(){const s=state;$('#gg-round').textContent=`第${s.round} / ${gods.length} 戦`;for(const [k,x] of [['p',s.p],['c',s.c]]){$(`#gg-${k}hp`).textContent=`気力 ${x.hp} / 24`;$(`#gg-${k}bar`).style.width=x.hp/24*100+'%';}
$('#gg-deck').textContent=`山札 ${s.p.deck.length}枚`;
$('#gg-hand').innerHTML=s.p.hand.map(id=>`<button class="godcard" data-id="${id}" aria-pressed="${s.selected===id}" ${s.phase!=='pick'?'disabled':''}>${art(id)}<span class="cardtext"><span class="cardname">${gods[id].name}</span><span class="tag">攻${gods[id].atk} / 回${gods[id].heal} / 防${gods[id].guard}</span><span class="desc">${gods[id].desc}</span></span></button>`).join('');
$('#gg-selected').textContent=s.selected==null?'カードをタップすると能力を確認できます。':gods[s.selected].name+'：'+gods[s.selected].desc+' 今回の攻撃力 '+power(s.selected,s.p,s.c).atk;
$('#gg-play').hidden=s.phase!=='pick';$('#gg-play').disabled=s.selected==null;$('#gg-next').hidden=s.phase!=='result';$('#gg-restart').hidden=s.phase!=='end';
if(s.phase==='pick'){slot('#gg-pslot',s.selected,'あなたの召喚待ち');slot('#gg-cslot',null,'CPUは選択済み');$('#gg-status').textContent='どの神にお願いする？';}else{slot('#gg-pslot',s.played,'あなた');slot('#gg-cslot',s.cpu,'CPU');$('#gg-status').textContent=s.message;}
$('#gg-log').innerHTML=s.logs.map(t=>`<li>${t}</li>`).join('');
}
function play(){let s=state;if(s.phase!=='pick'||s.selected==null)return;const id=s.selected,ci=s.cpu;const a=power(id,s.p,s.c),b=power(ci,s.c,s.p);const ph=ci===12?0:Math.min(a.heal,24-s.p.hp),ch=id===12?0:Math.min(b.heal,24-s.c.hp);const toC=a.pierce?a.atk:Math.min(b.cap,Math.max(0,a.atk-b.guard));const toP=b.pierce?b.atk:Math.min(a.cap,Math.max(0,b.atk-a.guard));s.p.hp=Math.max(0,s.p.hp+ph-toP);s.c.hp=Math.max(0,s.c.hp+ch-toC);s.p.nextBonus=id===17?2:0;s.c.nextBonus=ci===17?2:0;s.p.last=a.atk;s.c.last=b.atk;s.p.lastHeal=ph;s.c.lastHeal=ch;s.p.hand.splice(s.p.hand.indexOf(id),1);s.c.hand.splice(s.c.hand.indexOf(ci),1);s.played=id;s.visual={p:{heal:ph,damage:toP},c:{heal:ch,damage:toC}};s.phase='result';s.message=`あなた：${ph}回復・${toP}ダメージ ／ CPU：${ch}回復・${toC}ダメージ`;
s.logs.unshift(`第${s.round}戦 ${gods[id].name} vs ${gods[ci].name} — ${s.message}`);
if(!s.p.hp||!s.c.hp||s.round===gods.length){s.phase='end';s.message=(s.p.hp===s.c.hp?'引き分け！':s.p.hp>s.c.hp?'あなたの勝利！ 神々もご満悦。':'CPUの勝利。グヌヌ…もう一戦！')+` 気力 ${s.p.hp} 対 ${s.c.hp}`;}render();}
$('#gg-hand').addEventListener('click',e=>{const b=e.target.closest('[data-id]');if(!b||state.phase!=='pick')return;state.selected=Number(b.dataset.id);render();});
$('#gg-play').addEventListener('click',play);$('#gg-next').addEventListener('click',()=>{if(state.phase!=='result')return;for(const p of [state.p,state.c])if(p.deck.length)p.hand.push(p.deck.shift());state.round++;state.phase='pick';state.selected=null;lockCPU();render();});$('#gg-restart').addEventListener('click',start);
$('#gg-catalog').innerHTML=gods.map((g,id)=>`<div class="entry">${art(id)}${title(id)}<span>${g.desc}</span></div>`).join('');start();
})();
