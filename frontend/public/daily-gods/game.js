
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
{name:'キャベ神',role:'胃もたれの神',atk:0,heal:8,guard:0,desc:'回復8。攻撃はしない。ピンチから一気に回復。'}];
let state;
const shuffle=()=>{const a=gods.map((_,i)=>i);for(let i=a.length-1;i>0;i--){let j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const art=id=>`<span class="art" role="img" aria-label="${gods[id].name}" style="background-position:${[0,50,100][id%3]}% ${[11,55,99][Math.floor(id/3)]}%"></span>`;
const title=id=>`<span class="role">${gods[id].role}</span><span class="cardname">${gods[id].name}</span>`;
function makePlayer(){let deck=shuffle();return {hp:24,deck,hand:deck.splice(0,3),last:0,lastHeal:0};}
function power(id,self,other){let g=gods[id],atk=g.atk;if(id===0&&other.lastHeal>0)atk+=2;if(id===3&&self.hp<other.hp)atk=8;if(id===5)atk=Math.min(8,self.last+2);return {atk,heal:g.heal,guard:g.guard,pierce:id===7,cap:id===6?2:Infinity};}
function lockCPU(){const {p,c}=state;const score=id=>{const a=power(id,c,p);return a.atk+Math.min(a.heal,24-c.hp)*.95+a.guard*.6+(id===6?2:0)+Math.random()*3;};state.cpu=c.hand.map(id=>({id,s:score(id)})).sort((a,b)=>b.s-a.s)[0].id;}
function start(){state={p:makePlayer(),c:makePlayer(),round:1,phase:'pick',selected:null,logs:[]};lockCPU();render();}
function slot(sel,id,label){$(sel).innerHTML=id==null?`<span>${label}</span><span>✦</span>`:art(id)+title(id);}
function render(){const s=state;$('#gg-round').textContent=`第${s.round} / 9 戦`;for(const [k,x] of [['p',s.p],['c',s.c]]){$(`#gg-${k}hp`).textContent=`気力 ${x.hp} / 24`;$(`#gg-${k}bar`).style.width=x.hp/24*100+'%';}
$('#gg-deck').textContent=`山札 ${s.p.deck.length}枚`;
$('#gg-hand').innerHTML=s.p.hand.map(id=>`<button class="godcard" data-id="${id}" aria-pressed="${s.selected===id}" ${s.phase!=='pick'?'disabled':''}>${art(id)}<span class="cardtext"><span class="cardname">${gods[id].name}</span><span class="tag">攻${gods[id].atk} / 回${gods[id].heal} / 防${gods[id].guard}</span><span class="desc">${gods[id].desc}</span></span></button>`).join('');
$('#gg-selected').textContent=s.selected==null?'カードをタップすると能力を確認できます。':gods[s.selected].name+'：'+gods[s.selected].desc;
$('#gg-play').hidden=s.phase!=='pick';$('#gg-play').disabled=s.selected==null;$('#gg-next').hidden=s.phase!=='result';$('#gg-restart').hidden=s.phase!=='end';
if(s.phase==='pick'){slot('#gg-pslot',s.selected,'あなたの召喚待ち');slot('#gg-cslot',null,'CPUは選択済み');$('#gg-status').textContent='どの神にお願いする？';}else{slot('#gg-pslot',s.played,'あなた');slot('#gg-cslot',s.cpu,'CPU');$('#gg-status').textContent=s.message;}
$('#gg-log').innerHTML=s.logs.map(t=>`<li>${t}</li>`).join('');
}
function play(){let s=state;if(s.phase!=='pick'||s.selected==null)return;const id=s.selected,ci=s.cpu;const a=power(id,s.p,s.c),b=power(ci,s.c,s.p);const ph=Math.min(a.heal,24-s.p.hp),ch=Math.min(b.heal,24-s.c.hp);const toC=a.pierce?a.atk:Math.min(b.cap,Math.max(0,a.atk-b.guard));const toP=b.pierce?b.atk:Math.min(a.cap,Math.max(0,b.atk-a.guard));s.p.hp=Math.max(0,s.p.hp+ph-toP);s.c.hp=Math.max(0,s.c.hp+ch-toC);s.p.last=a.atk;s.c.last=b.atk;s.p.lastHeal=ph;s.c.lastHeal=ch;s.p.hand.splice(s.p.hand.indexOf(id),1);s.c.hand.splice(s.c.hand.indexOf(ci),1);s.played=id;s.phase='result';s.message=`あなた：${ph}回復・${toP}ダメージ ／ CPU：${ch}回復・${toC}ダメージ`;
s.logs.unshift(`第${s.round}戦 ${gods[id].name} vs ${gods[ci].name} — ${s.message}`);
if(!s.p.hp||!s.c.hp||s.round===9){s.phase='end';s.message=(s.p.hp===s.c.hp?'引き分け！':s.p.hp>s.c.hp?'あなたの勝利！ 神々もご満悦。':'CPUの勝利。グヌヌ…もう一戦！')+` 気力 ${s.p.hp} 対 ${s.c.hp}`;}render();}
$('#gg-hand').addEventListener('click',e=>{const b=e.target.closest('[data-id]');if(!b||state.phase!=='pick')return;state.selected=Number(b.dataset.id);render();});
$('#gg-play').addEventListener('click',play);$('#gg-next').addEventListener('click',()=>{if(state.phase!=='result')return;for(const p of [state.p,state.c])if(p.deck.length)p.hand.push(p.deck.shift());state.round++;state.phase='pick';state.selected=null;lockCPU();render();});$('#gg-restart').addEventListener('click',start);
$('#gg-catalog').innerHTML=gods.map((g,id)=>`<div class="entry">${art(id)}${title(id)}<span>${g.desc}</span></div>`).join('');start();
})();
