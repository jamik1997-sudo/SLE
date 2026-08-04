function mainNav(active='home'){
  const admin=['admin','manager'].includes(state.me.role)?'<button class="pill" data-page="admin">Управление</button>':'';
  return `<div class="nav"><button class="pill ${active==='search'?'active':''}" data-page="search">Поиск</button><button class="pill ${active==='home'?'active':''}" data-page="home">Главная</button><button class="pill ${active==='dashboard'?'active':''}" data-page="dashboard">Дашборд</button><button class="pill ${active==='history'?'active':''}" data-page="history">Отчёты</button>${admin}${['admin','manager'].includes(state.me.role)?'<button class="pill '+(active==='logs'?'active':'')+'" data-page="logs">Журнал</button>':''}${state.me.role==='admin'?'<button class="pill '+(active==='settings'?'active':'')+'" data-page="settings">Настройки</button>':''}</div>`;
}
function renderHome(){
  state.audits=state.audits.filter(a=>a.status!=='cancelled');
  const drafts=state.audits.filter(a=>['draft','in_progress'].includes(a.status)&&a.is_mine!==false);
  shell(`${mainNav('home')}${drafts.length?`<div class="card accent"><h2>Черновики</h2>${drafts.map(d=>`<div class="visit-row"><span>${esc(d.employee_name)} · ${esc(d.region_name)}</span><span class="actions"><button class="btn primary small" data-resume="${d.id}">Продолжить</button></span></div>`).join('')}</div>`:''}<div class="card"><h2>Новый аудит</h2><p class="muted">Оценка сотрудника по пяти торговым точкам</p><button class="btn primary" id="newAudit">Начать</button></div><div class="card"><h2>Последние аудиты</h2>${auditTable(state.audits.slice(0,8))}</div>`);
  bindNav();$('#newAudit')?.addEventListener('click',newAuditForm);$$('[data-resume]').forEach(b=>b.onclick=()=>openAudit(b.dataset.resume));
}
async function home(){
  if(!state.audits.length){try{state.audits=JSON.parse(localStorage.getItem('sle_audits_cache')||'[]')}catch{}}
  renderHome();
  try{
    const fresh=await api('/audits?limit=30',{force:true});
    state.audits=fresh;localStorage.setItem('sle_audits_cache',JSON.stringify(fresh));renderHome();
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
    state.audits=state.audits.filter(a=>a.id!==id);
    localStorage.setItem('sle_audits_cache',JSON.stringify(state.audits));
    toast('Аудит удалён');
    const active=document.querySelector('[data-page].active')?.dataset.page;
    if(active==='history')await history();else await home();
  }catch(e){toast(e.message)}
}
function statusName(s){return({draft:'Черновик',in_progress:'В процессе',completed:'Завершён',cancelled:'Отменён'})[s]||s}
function bindNav(){
  $$('[data-page]').forEach(b=>b.onclick=()=>({home,history,dashboard,admin:adminPage,logs:logsPage,settings:settingsPage}[b.dataset.page]?.()));
  $$('[data-open]').forEach(r=>r.onclick=()=>openAudit(r.dataset.open));
  $$('[data-delete-audit]').forEach(b=>b.onclick=e=>{e.stopPropagation();deleteAudit(b.dataset.deleteAudit)});
}

async function searchPage(){
  shell(`${mainNav('search')}<div class="card"><h1>Поиск</h1><form id="globalSearch" class="actions"><input class="search" name="q" minlength="1" required placeholder="Сотрудник, регион или аудит"><button class="btn primary">Найти</button></form><div id="searchResults" class="top-gap"></div></div>`);
  bindNav();
  $('#globalSearch').onsubmit=async e=>{
    e.preventDefault();
    const q=new FormData(e.target).get('q').trim();
    try{
      const d=await api('/extras/search?q='+encodeURIComponent(q),{force:true});
      $('#searchResults').innerHTML=`<div class="grid two"><div><h2>Сотрудники</h2>${d.employees.length?d.employees.map(x=>`<button class="visit-row full-row" data-employee-card="${x.id}"><span><strong>${esc(x.name)}</strong><small>${esc(x.position||'')} · ${esc(x.region)}</small></span></button>`).join(''):'<p class="muted">Не найдено</p>'}</div><div><h2>Аудиты</h2>${d.audits.length?d.audits.map(x=>`<button class="visit-row full-row" data-open-audit="${x.id}"><span>${esc(x.date)} · ${esc(x.employee)} · ${esc(x.region)}</span><strong>${Math.round(x.percent||0)}%</strong></button>`).join(''):'<p class="muted">Не найдено</p>'}</div></div>`;
      $$('[data-open-audit]').forEach(b=>b.onclick=()=>openAudit(b.dataset.openAudit));
      $$('[data-employee-card]').forEach(b=>b.onclick=()=>employeeCardPage(b.dataset.employeeCard));
    }catch(err){toast(err.message)}
  };
}

async function employeeCardPage(id){
  try{
    const x=await api('/extras/employees/'+id,{force:true});
    shell(`${mainNav('search')}<div class="card accent"><h1>${esc(x.full_name)}</h1><p>${esc(x.position||'—')} · ${esc(x.region)}</p><div class="stats"><div><strong>${x.audits}</strong><small>аудитов</small></div><div><strong>${Math.round(x.average||0)}%</strong><small>средний результат</small></div><div><strong>${x.last_result==null?'—':Math.round(x.last_result)+'%'}</strong><small>последний результат</small></div></div></div><div class="card"><h2>Динамика</h2>${x.trend.length?x.trend.map(t=>statBar(t.date,Math.round(t.percent||0),1)).join(''):'<p class="muted">Нет завершённых аудитов</p>'}</div>`);
    bindNav();
  }catch(e){toast(e.message)}
}

async function logsPage(){
  if(!['admin','manager'].includes(state.me.role))return home();
  try{
    const rows=await api('/extras/logs?limit=200',{force:true});
    shell(`${mainNav('logs')}<div class="card"><h1>Журнал действий</h1><div class="table-wrap"><table class="table"><tr><th>Дата</th><th>Пользователь</th><th>Действие</th><th>Детали</th></tr>${rows.map(x=>`<tr><td>${esc(formatTashkentDateTime(x.created_at))}</td><td>${esc(x.user)}</td><td>${esc(x.action)}</td><td>${esc(x.details||'—')}</td></tr>`).join('')}</table></div></div>`);
    bindNav();
  }catch(e){toast(e.message)}
}

async function settingsPage(){
  if(state.me.role!=='admin')return home();
  try{
    const [questions,score]=await Promise.all([api('/extras/question-settings',{force:true}),api('/extras/score-settings',{force:true})]);
    shell(`${mainNav('settings')}<div class="card"><h1>Настройки оценки</h1><form id="scoreSettings" class="grid two"><div class="field"><label>Уверенный от, %</label><input name="confident_min" type="number" min="1" max="99" value="${score.confident_min}" required></div><div class="field"><label>Мастер от, %</label><input name="master_min" type="number" min="1" max="100" value="${score.master_min}" required></div><button class="btn primary">Сохранить уровни</button></form></div><div class="card"><h2>Вопросы</h2><div class="table-wrap"><table class="table"><tr><th>Раздел</th><th>Вопрос</th><th>Вес</th><th>Активен</th><th></th></tr>${questions.map(q=>`<tr><td>${esc(q.section)}</td><td>${esc(q.text_ru)}</td><td>${q.weight}</td><td>${q.is_active?'Да':'Нет'}</td><td><button class="btn secondary small" data-edit-question="${q.key}">Изменить</button></td></tr>`).join('')}</table></div></div>`);
    bindNav();
    $('#scoreSettings').onsubmit=async e=>{e.preventDefault();try{await api('/extras/score-settings',{method:'PUT',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});toast('Настройки сохранены')}catch(err){toast(err.message)}};
    $$('[data-edit-question]').forEach(b=>b.onclick=async()=>{const q=questions.find(x=>x.key===b.dataset.editQuestion);const text_ru=prompt('Текст вопроса',q.text_ru);if(text_ru===null)return;const weight=Number(prompt('Вес',q.weight));if(!Number.isFinite(weight))return;try{await api('/extras/question-settings/'+q.key,{method:'PUT',body:JSON.stringify({text_ru,weight})});toast('Вопрос изменён');settingsPage()}catch(err){toast(err.message)}});
  }catch(e){toast(e.message)}
}
