/* Owner-only data is obtained through the existing authenticated billing API. */
(function(){
  'use strict';
  const day=date=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
  window.renderCamelliaDashboard=async function({element,api,esc,fmt}){
    element.innerHTML='<div class="card"><h2>Camellia 運営Dashboard</h2><p class="hint">登録・利用・保存状態を確認します。本文は対象者の詳細を開いた時に読み込みます。</p><div data-overview>読み込み中…</div><label>利用者を探す<input data-find placeholder="名前・Camellia ID・Passport"></label><div data-users></div><div data-detail></div></div>';
    const users=element.querySelector('[data-users]'),overview=element.querySelector('[data-overview]'),detail=element.querySelector('[data-detail]');
    let data;
    try{data=await api('/api/billing/admin/camellia?summary=1');}catch(e){overview.textContent='利用者一覧を読み込めませんでした。記録なしとは判断していません。';return;}
    if(!element.isConnected)return;
    const rows=data.members||[],today=day(new Date()),week=day(new Date(Date.now()-6*86400000));
    const valid=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
    const registered=rows.filter(m=>valid(m.registeredAt)&&m.birthDate&&m.basic?.displayName);
    const usedSince=start=>rows.filter(m=>valid(m.lastActiveAt)&&day(new Date(m.lastActiveAt))>=start&&day(new Date(m.lastActiveAt))<=today).length;
    const metrics=[['登録完了',registered.length],['今日利用',usedSince(today)],['7日利用',usedSince(week)],['7日新規',registered.filter(m=>day(new Date(m.registeredAt))>=week&&day(new Date(m.registeredAt))<=today).length],['LINE',rows.filter(m=>/line/i.test(m.provider)).length],['SchoolPark / Passport連携',rows.filter(m=>m.passport).length],['読み込み・同期要確認',rows.filter(m=>m.archiveSyncInProgress||m.readErrors?.length).length]];
    overview.innerHTML='<dl style="display:flex;flex-wrap:wrap;gap:16px">'+metrics.map(([label,n])=>'<div><dt>'+esc(label)+'</dt><dd style="font-size:20px;margin:0">'+n+'</dd></div>').join('')+'</dl><p class="hint">登録完了＝同意日時・生年月日・名前がある記録。利用＝保存された最終操作／更新日（JST）。認証方法は保存済みproviderから判定し、未取得は推測しません。読込範囲 '+rows.length+'件'+(data.limited?'（上限500件・全件集計ではありません）':'')+'。PostHogの人数とは別の集計です。</p>';
    const stamp=value=>valid(value)?esc(fmt(value)):'不明';
    const state=m=>m.readErrors?.length?'読込失敗：'+m.readErrors.join('、'):m.archiveSyncInProgress?'同期途中':'保存済み（現在の端末との一致は未確認）';
    function draw(){
      const q=element.querySelector('[data-find]').value.trim().toLowerCase();
      const hit=rows.filter(m=>[m.name,m.basic?.displayName,m.camelliaId,m.passport].some(v=>String(v||'').toLowerCase().includes(q)));
      users.innerHTML='<div style="overflow-x:auto"><table style="width:100%;min-width:800px"><thead><tr>'+['名前','年齢','認証','Passport','登録日','最終利用','最終Check','Check回数','保存状態'].map(s=>'<th>'+s+'</th>').join('')+'</tr></thead><tbody>'+hit.map(m=>'<tr><td><button class="btn" data-user="'+esc(m.uid)+'">'+esc(m.basic?.displayName||m.name||'名前未設定')+'</button></td><td>'+esc(m.age??'不明')+'</td><td>'+esc(m.provider||'不明')+'</td><td>'+esc(m.passport||'未連携')+'</td><td>'+stamp(m.registeredAt)+'</td><td>'+stamp(m.lastActiveAt)+'</td><td>'+stamp(m.lastCheckAt)+'</td><td>'+esc(m.checkCount??'不明')+'</td><td>'+esc(state(m))+'</td></tr>').join('')+'</tbody></table></div>'+(hit.length?'':'<p>該当する利用者はいません。</p>');
      users.querySelectorAll('[data-user]').forEach(button=>button.onclick=()=>show(button.dataset.user));
    }
    function fields(value){
      if(value===null||value===undefined)return '<span>未保存</span>';
      if(typeof value!=='object')return '<span style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(String(value))+'</span>';
      return '<dl>'+Object.entries(value).map(([key,item])=>'<dt><b>'+esc(key)+'</b></dt><dd style="margin:0 0 12px 12px">'+(item&&typeof item==='object'?'<details><summary>内容を開く</summary>'+fields(item)+'</details>':fields(item))+'</dd>').join('')+'</dl>';
    }
    let request=0;
    async function show(uid){
      const current=++request;detail.innerHTML='<h3>利用者詳細</h3><p>読み込み中…</p>';
      let response;try{response=await api('/api/billing/admin/camellia?uid='+encodeURIComponent(uid));}catch(e){if(current===request)detail.textContent='詳細を読み込めませんでした。空の記録とは判断していません。';return;}
      if(current!==request||!element.isConnected)return;
      const m=response.members?.[0];if(!m){detail.textContent='対象の記録を確認できませんでした。';return;}
      const grouped=Object.create(null);for(const entry of m.imports||[]){if(entry.source!=='camellia-beta-localStorage'||typeof entry.kind!=='string')continue;try{(grouped[entry.kind]??=[]).push(JSON.parse(entry.content));}catch{(grouped['invalid']??=[]).push({type:entry.type,error:'アーカイブを解析できません'});}}
      const sections=[['概要',{camelliaId:m.camelliaId,passport:m.passport,provider:m.provider,registeredAt:m.registeredAt,lastActiveAt:m.lastActiveAt}],['Profile',grouped.profile||m.basic],['Check',grouped.checkin||m.daily],['Camellia会話',grouped.conversation||m.chat],['Fortune',grouped.fortune],['Action',{actions:grouped.action,feedback:grouped['action-feedback'],saved:grouped['saved-action']}],['Insight',{insights:grouped.insight,feedback:grouped['insight-feedback']}],['Memory',{explicit:grouped['personal-memory'],contextual:grouped['context-memory']}],['My Tree',grouped['tree-leaf']],['Activity',m.activity],['Data / Sync',{uid:m.uid,readErrors:m.readErrors,sync:state(m),checkCount:m.checkCount,lastCheckAt:m.lastCheckAt,archiveErrors:grouped.invalid}]];
      detail.innerHTML='<hr><h3>'+esc(m.basic?.displayName||m.name||'利用者詳細')+'</h3><p>確認が必要な項目だけを開いてください。</p>'+sections.map(([label,value])=>'<details style="padding:10px 0;border-bottom:1px solid var(--line)"><summary>'+esc(label)+'</summary>'+fields(value)+'</details>').join('');
    }
    element.querySelector('[data-find]').oninput=draw;draw();
  };
})();
