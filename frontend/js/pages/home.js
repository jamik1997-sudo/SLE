function escapeHtml(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\\\"":"&quot;","'":"&#039;"}[c]));}
function mainNav(active='home'){
  const admin=['admin','manager'].includes(state.me.role)?'<button class="pill" data-page="admin">Управление</button>':'';
  const compare=state.me.role==='admin'?'<button class="pill '+(active==='comparison'?'active':'')+'" data-page="comparison">Сравнение визитов</button>':'';
  return `<div class="nav"><button class="pill ${active==='home'?'active':''}" data-page="home">Главная</button><button class="pill ${active==='dashboard'?'active':''}" data-page="dashboard">Дашборд</button><button class="pill ${active==='history'?'active':''}" data-page="history">Отчёты</button>${compare}${admin}${['admin','manager'].includes(state.me.role)?'<button class="pill '+(active==='logs'?'active':'')+'" data-page="logs">Журнал</button>':''}${state.me.role==='admin'?'<button class="pill '+(active==='settings'?'active':'')+'" data-page="settings">Настройки</button>':''}</div>`;
}
let newAuditOpenBusy=false;
function renderHome(){
  state.audits=asArray(state.audits,'audits').filter(a=>a&&a.status!=='cancelled');
  const drafts=state.audits.filter(a=>['draft','in_progress'].includes(a.status)&&a.is_mine!==false);
  shell(`${mainNav('home')}${drafts.length?`<div class="card accent"><h2>Черновики</h2>${drafts.map(d=>`<div class="visit-row"><span>${esc(d.employee_name)} · ${esc(d.region_name)}</span><span class="actions"><button class="btn primary small" data-resume="${d.id}">Продолжить</button></span></div>`).join('')}</div>`:''}<div class="card"><h2>Новый аудит</h2><p class="muted">Оценка сотрудника по пяти торговым точкам</p><button class="btn primary" id="newAudit">Начать</button></div><div class="card"><h2>Последние аудиты</h2>${auditTable(state.audits.slice(0,8))}</div>`);
  bindNav();
  const newAuditButton=$('#newAudit');
  if(newAuditButton)newAuditButton.onclick=async()=>{
    if(newAuditOpenBusy||newAuditButton.disabled)return;
    newAuditOpenBusy=true;newAuditButton.disabled=true;newAuditButton.textContent='Открытие…';
    try{await newAuditForm()}finally{newAuditOpenBusy=false}
  };
  $$('[data-resume]').forEach(b=>b.onclick=()=>openAudit(b.dataset.resume));
}
async function home(){
  const pageId=beginPage();
  state.audits=asArray(state.audits,'audits');
  if(!state.audits.length)state.audits=readCachedArray('sle_audits_cache');
  try{renderHome()}catch(e){console.error('Home render error',e);state.audits=[];showPageError('Не удалось открыть главное меню','Данные аудитов имеют неверный формат. Нажмите «Повторить».');return}
  try{
    const response=await api('/audits?limit=30');
    if(!isCurrentPage(pageId))return;
    const fresh=asArray(response,'audits');
    if(!Array.isArray(response)&&!fresh.length)console.warn('Unexpected /audits payload',response);
    state.audits=fresh;
    localStorage.setItem('sle_audits_cache',JSON.stringify(fresh));
    const activeIds=new Set(fresh.filter(a=>a&&['draft','in_progress'].includes(a.status)).map(a=>a.id));
    for(let i=localStorage.length-1;i>=0;i--){
      const key=localStorage.key(i);
      if(key?.startsWith('sle_draft_')&&!activeIds.has(key.slice('sle_draft_'.length)))localStorage.removeItem(key);
    }
    try{renderHome()}catch(e){console.error('Home refresh render error',e);toast('Не удалось отобразить список аудитов')}
  }catch(e){if(!state.audits.length)toast(e.message)}
}

function auditTable(rows){
  if(!rows.length)return'<p class="muted">Аудитов пока нет</p>';
  const canDelete=state.me?.role==='admin';
  return`<div class="table-wrap"><table class="table"><thead><tr><th>Дата</th><th>Сотрудник</th><th>Регион</th><th>Оценивающий</th><th>Статус</th><th>Результат</th>${canDelete?'<th>Действие</th>':''}</tr></thead><tbody>${rows.map(a=>`<tr data-open="${a.id}" class="clickable"><td>${esc(a.audit_date)}</td><td>${esc(a.employee_name)}</td><td>${esc(a.region_name)}</td><td>${esc(a.auditor_name||'—')}</td><td><span class="badge ${a.status==='completed'?'ok':'warn'}">${statusName(a.status)}</span></td><td>${a.total_percent==null?'—':a.total_percent+'%'}</td>${canDelete?`<td><button type="button" class="btn danger small" data-delete-audit="${a.id}">Удалить</button></td>`:''}</tr>`).join('')}</tbody></table></div>`;
}

async function deleteAudit(id){
  if(state.me?.role!=='admin')return;
  if(!confirm('Удалить аудит без возможности восстановления?'))return;
  try{
    await api(`/audits/${id}`,{method:'DELETE'});
    state.audits=asArray(state.audits,'audits').filter(a=>a&&a.id!==id);
    localStorage.setItem('sle_audits_cache',JSON.stringify(state.audits));
    toast('Аудит удалён');
    const active=document.querySelector('[data-page].active')?.dataset.page;
    if(active==='history')await history();else await home();
  }catch(e){toast(e.message)}
}
function statusName(s){return({draft:'Черновик',in_progress:'В процессе',completed:'Завершён',cancelled:'Отменён'})[s]||s}
function bindNav(){
  $$('[data-page]').forEach(b=>b.onclick=()=>({home,history,dashboard,comparison:comparisonPage,admin:adminPage,logs:logsPage,settings:settingsPage}[b.dataset.page]?.()));
  $$('[data-open]').forEach(r=>r.onclick=()=>openAudit(r.dataset.open));
  $$('[data-delete-audit]').forEach(b=>b.onclick=e=>{e.stopPropagation();deleteAudit(b.dataset.deleteAudit)});
}

async function logsPage(limit=50,{append=false}={}){
  if(!['admin','manager'].includes(state.me.role))return home();
  const pageId=beginPage();
  const existing=$('#logsRoot');
  if(!existing)loadingPage('logs','Журнал действий');else existing.classList.add('section-loading');
  let rows;
  try{rows=asArray(await api(`/extras/logs?limit=${limit}`,{force:append}),'logs')}catch(e){existing?.classList.remove('section-loading');return toast(e.message)}
  if(!isCurrentPage(pageId))return;
  const table=`<div class="table-wrap"><table class="table"><tr><th>Дата</th><th>Пользователь</th><th>Действие</th><th>Детали</th></tr>${rows.map(x=>`<tr><td>${esc(formatTashkentDateTime(x.created_at))}</td><td>${esc(x.user)}</td><td>${esc(x.action)}</td><td>${esc(x.details||'—')}</td></tr>`).join('')}</table></div>`;
  if(!existing){
    shell(`${mainNav('logs')}<div class="card" id="logsRoot"><div class="section-head"><div><h1>Журнал действий</h1><p class="muted" id="logsCount">Показаны последние ${rows.length} записей</p></div><button class="btn secondary" id="loadMoreLogs" ${rows.length<limit||limit>=500?'hidden':''}>Показать ещё</button></div><div id="logsTable">${table}</div></div>`);bindNav();
  }else{
    existing.classList.remove('section-loading');$('#logsCount').textContent=`Показаны последние ${rows.length} записей`;$('#logsTable').innerHTML=table;
  }
  const more=$('#loadMoreLogs');if(more){more.hidden=rows.length<limit||limit>=500;more.disabled=false;more.onclick=()=>{more.disabled=true;logsPage(Math.min(500,limit+50),{append:true})}}
}

async function settingsPage(){
  if(state.me.role!=='admin')return home();
  try{
    let [questions,score]=await Promise.all([api('/extras/question-settings',{force:true}),api('/extras/score-settings',{force:true})]);questions=asArray(questions,'questions');
    shell(`${mainNav('settings')}<div class="card"><h1>Настройки оценки</h1><form id="scoreSettings" class="grid two"><div class="field"><label>Уверенный от, %</label><input name="confident_min" type="number" min="1" max="99" value="${score.confident_min}" required></div><div class="field"><label>Мастер от, %</label><input name="master_min" type="number" min="1" max="100" value="${score.master_min}" required></div><button class="btn primary">Сохранить уровни</button></form></div><div class="card"><h2>Вопросы</h2><div class="table-wrap"><table class="table"><tr><th>Раздел</th><th>Вопрос</th><th>Вес</th><th>Активен</th><th></th></tr>${questions.map(q=>`<tr><td>${esc(q.section)}</td><td>${esc(q.text_ru)}</td><td>${q.weight}</td><td>${q.is_active?'Да':'Нет'}</td><td><button class="btn secondary small" data-edit-question="${q.key}">Изменить</button></td></tr>`).join('')}</table></div></div>`);
    bindNav();
    $('#scoreSettings').onsubmit=async e=>{e.preventDefault();try{await api('/extras/score-settings',{method:'PUT',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});toast('Настройки сохранены')}catch(err){toast(err.message)}};
    $$('[data-edit-question]').forEach(b=>b.onclick=async()=>{const q=questions.find(x=>x.key===b.dataset.editQuestion);const text_ru=prompt('Текст вопроса',q.text_ru);if(text_ru===null)return;const weight=Number(prompt('Вес',q.weight));if(!Number.isFinite(weight))return;try{await api('/extras/question-settings/'+q.key,{method:'PUT',body:JSON.stringify({text_ru,weight})});toast('Вопрос изменён');settingsPage()}catch(err){toast(err.message)}});
  }catch(e){toast(e.message)}
}
