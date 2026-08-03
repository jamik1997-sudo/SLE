// SLE frontend build v2.9
const API=(window.SLE_CONFIG?.API_URL||'').replace(/\/$/,'');
const app=document.getElementById('app');
const state={
  token:localStorage.getItem('sle_token')||'',
  theme:localStorage.getItem('sle_theme')||'light',
  me:null,audits:[],questions:JSON.parse(localStorage.getItem('sle_questions')||'[]'),
  audit:null,visit:0,step:0,regions:null,employees:new Map(),
  pendingAnswers:new Map(),pendingVisit:{},syncTimer:null,syncing:null
};
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const requestCache=new Map();
const inflightGets=new Map();
function cacheTtl(path){
  if(path==='/auth/me')return 5*60*1000;
  if(path==='/audits/questionnaire'||path==='/audits/regions')return 5*60*1000;
  if(path.startsWith('/audits/employees'))return 2*60*1000;
  if(path.startsWith('/audits/dashboard'))return 30*1000;
  if(path.startsWith('/audits?'))return 15*1000;
  return 0;
}
function clearRequestCache(){requestCache.clear();inflightGets.clear()}

function toast(msg){const t=$('#toast');t.textContent=msg;t.hidden=false;setTimeout(()=>t.hidden=true,3200)}
function authHeaders(){return state.token?{'Authorization':`Bearer ${state.token}`}: {}}
let wakeRequests=0;
function setServerWake(show){
  const el=document.getElementById('serverWake');
  if(!el)return;
  if(show){wakeRequests++;el.hidden=false}else{wakeRequests=Math.max(0,wakeRequests-1);if(!wakeRequests)el.hidden=true}
}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
async function api(path,opt={}){
  const method=(opt.method||'GET').toUpperCase();
  const ttl=method==='GET'?cacheTtl(path):0;
  const cacheKey=state.token+'|'+path;
  if(ttl&&!opt.force){
    const hit=requestCache.get(cacheKey);
    if(hit&&Date.now()-hit.ts<ttl)return hit.data;
    if(inflightGets.has(cacheKey))return inflightGets.get(cacheKey);
  }
  const run=(async()=>{
    const retryable=method==='GET'||method==='PUT'||path==='/auth/login';
    const attempts=retryable?4:1;
    let lastError;
    for(let attempt=0;attempt<attempts;attempt++){
      const controller=new AbortController();
      const timeoutMs=opt.timeout||(attempt===0?12000:25000);
      const timeout=setTimeout(()=>controller.abort(),timeoutMs);
      const headers={...authHeaders(),...(opt.headers||{})};
      if(opt.body!=null)headers['Content-Type']='application/json';
      try{
        if(attempt>0)setServerWake(true);
        const res=await fetch(API+path,{...opt,headers,signal:controller.signal,cache:'no-store'});
        let data={};try{data=await res.json()}catch{}
        if(res.ok){
          if(ttl)requestCache.set(cacheKey,{ts:Date.now(),data});
          if(method!=='GET')clearRequestCache();
          return data;
        }
        if(retryable&&[502,503,504].includes(res.status)&&attempt<attempts-1){
          lastError=new Error('Сервер запускается');
          await sleep([800,1600,3000][attempt]||3000);
          continue;
        }
        let message=`Ошибка ${res.status}`;
        if(typeof data.detail==='string')message=data.detail;
        else if(Array.isArray(data.detail))message=data.detail.map(x=>`${(x.loc||[]).slice(1).join('.')||'поле'}: ${x.msg}`).join('; ');
        else if(data.detail?.message)message=data.detail.message;
        else if(data.message)message=data.message;
        console.error('API error',path,data);throw new Error(message);
      }catch(e){
        lastError=e.name==='AbortError'?new Error('Сервер запускается слишком долго'):e;
        if(!retryable||attempt===attempts-1)throw lastError;
        await sleep([800,1600,3000][attempt]||3000);
      }finally{
        clearTimeout(timeout);
        if(attempt>0)setServerWake(false);
      }
    }
    throw lastError||new Error('Сервер недоступен');
  })();
  if(ttl)inflightGets.set(cacheKey,run);
  try{return await run}finally{if(ttl)inflightGets.delete(cacheKey)}
}
async function wakeServer(){
  try{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),7000);
    await fetch(API+'/health',{signal:controller.signal,cache:'no-store'});
    clearTimeout(timer);
  }catch{}
}
function startKeepAlive(){
  if(window.__sleKeepAlive)return;
  window.__sleKeepAlive=setInterval(()=>{if(document.visibilityState==='visible'&&navigator.onLine)wakeServer()},9*60*1000);
}

function esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function roleName(role){return role==='admin'?'Администратор':role==='manager'?'Менеджер':'Руководитель'}
function applyTheme(){document.documentElement.dataset.theme=state.theme;document.querySelector('meta[name="theme-color"]')?.setAttribute('content',state.theme==='dark'?'#111318':'#ffd400')}
function toggleTheme(){state.theme=state.theme==='dark'?'light':'dark';localStorage.setItem('sle_theme',state.theme);applyTheme();const b=$('#themeToggle');if(b)b.textContent=state.theme==='dark'?'☀️':'🌙'}
function shell(content){
  const profile=state.me?`<div class="profile"><div><strong>${esc(state.me.full_name)}</strong><small>${roleName(state.me.role)}</small></div><button class="pill" id="changePassword">Пароль</button><button class="icon-btn" id="themeToggle" title="Сменить тему">${state.theme==='dark'?'☀️':'🌙'}</button><button class="pill" id="logout">Выйти</button></div>`:'';
  app.innerHTML=`<div class="shell"><header class="topbar"><div class="brand"><i></i>SLE</div>${profile}</header><div class="container">${content}</div></div>`;
  $('#logout')?.addEventListener('click',logout);$('#themeToggle')?.addEventListener('click',toggleTheme);$('#changePassword')?.addEventListener('click',changePasswordPage);
}
function logout(){clearRequestCache();localStorage.removeItem('sle_token');localStorage.removeItem('sle_me');state.token='';state.me=null;renderLogin()}
function syncStatus(){$('#offline')?.toggleAttribute('hidden',navigator.onLine)}
async function boot(){
  applyTheme();wakeServer();startKeepAlive();try{state.regions=JSON.parse(localStorage.getItem('sle_regions')||'null')}catch{}
  window.addEventListener('online',syncStatus);window.addEventListener('offline',syncStatus);syncStatus();
  if('serviceWorker' in navigator){
    try{
      const registration=await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'});
      await registration.update();

      let reloading=false;
      navigator.serviceWorker.addEventListener('controllerchange',()=>{
        if(reloading)return;
        reloading=true;
        window.location.reload();
      });

      // Check for a new version whenever the app becomes active again.
      document.addEventListener('visibilitychange',()=>{
        if(document.visibilityState==='visible')registration.update().catch(()=>{});
      });
      window.addEventListener('focus',()=>registration.update().catch(()=>{}));
      setInterval(()=>registration.update().catch(()=>{}),60*60*1000);
    }catch(error){
      console.error('Ошибка регистрации Service Worker:',error);
    }
  }
  if(!state.token)return renderLogin();
  try{
    const cachedMe=localStorage.getItem('sle_me');
    if(cachedMe){try{state.me=JSON.parse(cachedMe)}catch{}}
    if(state.me)home();
    state.me=await api('/auth/me');localStorage.setItem('sle_me',JSON.stringify(state.me));
    if(!document.querySelector('.shell'))await home();
  }catch{logout()}
}
function renderLogin(){
  app.innerHTML=`<div class="login"><div class="login-head"><div class="login-logo">SLE</div><button class="icon-btn" id="themeToggle">${state.theme==='dark'?'☀️':'🌙'}</button></div><div class="card accent"><h1>Вход</h1><p class="muted">Введите логин и пароль</p><form id="login"><div class="field"><label>Логин</label><input name="login" required autocomplete="username"></div><div class="field" style="margin-top:12px"><label>Пароль</label><input name="password" type="password" required autocomplete="current-password"></div><button class="btn primary full" style="margin-top:16px">Войти</button></form></div></div>`;
  $('#themeToggle').onclick=toggleTheme;
  $('#login').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{const d=await api('/auth/login',{method:'POST',body:JSON.stringify(Object.fromEntries(f))});state.token=d.access_token;localStorage.setItem('sle_token',state.token);state.me=await api('/auth/me');localStorage.setItem('sle_me',JSON.stringify(state.me));home()}catch(err){toast(err.message)}};
}
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
  return`<div class="table-wrap"><table class="table"><thead><tr><th>Дата</th><th>Сотрудник</th><th>Регион</th><th>Оценивающий</th><th>Статус</th><th>Результат</th></tr></thead><tbody>${rows.map(a=>`<tr data-open="${a.id}" class="clickable"><td>${esc(a.audit_date)}</td><td>${esc(a.employee_name)}</td><td>${esc(a.region_name)}</td><td>${esc(a.auditor_name||'—')}</td><td><span class="badge ${a.status==='completed'?'ok':'warn'}">${statusName(a.status)}</span></td><td>${a.total_percent==null?'—':a.total_percent+'%'}</td></tr>`).join('')}</tbody></table></div>`;
}
function statusName(s){return({draft:'Черновик',in_progress:'В процессе',completed:'Завершён',cancelled:'Отменён'})[s]||s}
function bindNav(){
  $$('[data-page]').forEach(b=>b.onclick=()=>({home,history,dashboard,admin:adminPage,search:searchPage,logs:logsPage,settings:settingsPage}[b.dataset.page]?.()));
  $$('[data-open]').forEach(r=>r.onclick=()=>openAudit(r.dataset.open));
}
async function history(){
  try{state.audits=await api('/audits?limit=500')}catch(e){return toast(e.message)}
  shell(`${mainNav('history')}<div class="card"><div class="section-head"><div><h1>Отчёты</h1><p class="muted">Все доступные аудиты</p></div><input id="reportSearch" class="search" placeholder="Поиск по сотруднику или региону"></div><div class="actions"><button class="btn primary" id="exportExcel">Отчет по аудиту</button><button class="btn secondary" id="exportAnswers">Детальный отчет</button></div><div id="reportTable" class="top-gap">${auditTable(state.audits)}</div></div>`);
  bindNav();$('#exportExcel').onclick=()=>downloadExcel('/extras/export/audit-report.xlsx','audit-report.xlsx');$('#exportAnswers').onclick=()=>downloadExcel('/extras/export/detailed-report.xlsx','detailed-audit-report.xlsx');$('#reportSearch').oninput=e=>{const q=e.target.value.trim().toLowerCase();const rows=state.audits.filter(a=>[a.employee_name,a.region_name,a.auditor_name,a.level].some(v=>String(v||'').toLowerCase().includes(q)));$('#reportTable').innerHTML=auditTable(rows);$$('[data-open]').forEach(r=>r.onclick=()=>openAudit(r.dataset.open))};
}
function statBar(label,value,count){return`<div class="stat-row"><div class="stat-label"><span>${esc(label)}</span><strong>${value}%</strong></div><div class="bar"><i style="width:${Math.max(0,Math.min(100,value))}%"></i></div><small>${count} ауд.</small></div>`}
async function dashboard(filters={}){
  const qs=new URLSearchParams(Object.entries(filters).filter(([,v])=>v));
  let d;try{d=await api('/audits/dashboard'+(qs.toString()?'?'+qs.toString():''))}catch(e){return toast(e.message)}
  const f=d.filters||{regions:[],auditors:[],employees:[],months:[],selected:{}};
  const sel=f.selected||{};
  const maxLevel=Math.max(1,...Object.values(d.levels));
  const filterBox=`<div class="card dashboard-filters"><h2>Фильтры</h2><div class="grid four"><div class="field"><label>Регион</label><select id="dashRegion"><option value="">Все регионы</option>${f.regions.map(x=>`<option value="${x.id}" ${sel.region_id===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div><div class="field"><label>Руководитель</label><select id="dashAuditor"><option value="">Все</option>${f.auditors.map(x=>`<option value="${x.id}" ${sel.auditor_id===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div><div class="field"><label>Сотрудник</label><select id="dashEmployee"><option value="">Все сотрудники</option>${f.employees.map(x=>`<option value="${x.id}" data-region="${x.region_id}" ${sel.employee_id===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div><div class="field"><label>Месяц</label><select id="dashMonth"><option value="">Все месяцы</option>${f.months.map(x=>`<option value="${x}" ${sel.month===x?'selected':''}>${x}</option>`).join('')}</select></div></div><div class="actions top-gap"><button class="btn primary" id="applyDashFilters">Применить</button><button class="btn secondary" id="resetDashFilters">Сбросить</button></div></div>`;
  shell(`${mainNav('dashboard')}<div class="dashboard-head"><div><h1>Дашборд</h1><p class="muted">Статистика по завершённым аудитам</p></div></div>${filterBox}<div class="kpi-grid"><div class="kpi"><span>Завершено аудитов</span><strong>${d.total}</strong></div><div class="kpi"><span>Средний результат</span><strong>${d.average}%</strong></div><div class="kpi"><span>Мастер</span><strong>${d.levels['Мастер']||0}</strong></div><div class="kpi"><span>Уверенный</span><strong>${d.levels['Уверенный']||0}</strong></div><div class="kpi"><span>Базовый</span><strong>${d.levels['Базовый']||0}</strong></div></div><div class="card"><h2>Результаты по каждому блоку</h2>${d.blocks?.length?`<div class="table-wrap"><table class="table block-results"><thead><tr><th>Блок</th><th>Кол-во оценок</th><th>Средний результат</th></tr></thead><tbody>${d.blocks.map(x=>`<tr><td>${esc(x.name)}</td><td>${x.count}</td><td><div class="block-result-cell"><strong>${x.average}%</strong><div class="mini-bar"><i style="width:${Math.max(0,Math.min(100,x.average))}%"></i></div></div></td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">Нет данных</p>'}</div><div class="grid two"><div class="card"><h2>Уровни оценки</h2>${Object.entries(d.levels).map(([name,count])=>`<div class="level-row"><span>${esc(name)}</span><div class="mini-bar"><i style="width:${count/maxLevel*100}%"></i></div><strong>${count}</strong></div>`).join('')}</div><div class="card"><h2>Динамика по месяцам</h2>${d.months.length?d.months.map(x=>statBar(x.month,x.average,x.count)).join(''):'<p class="muted">Нет данных</p>'}</div></div><div class="grid two"><div class="card"><h2>Результаты по регионам</h2>${d.regions.length?d.regions.map(x=>statBar(x.name,x.average,x.count)).join(''):'<p class="muted">Нет данных</p>'}</div><div class="card"><h2>Топ сотрудников</h2>${d.employees.length?`<div class="table-wrap"><table class="table"><tr><th>Сотрудник</th><th>Регион</th><th>Среднее</th><th>Аудиты</th></tr>${d.employees.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.region)}</td><td><strong>${x.average}%</strong></td><td>${x.count}</td></tr>`).join('')}</table></div>`:'<p class="muted">Нет данных</p>'}</div></div><div class="card"><h2>Последние завершённые аудиты</h2>${d.recent.length?`<div class="table-wrap"><table class="table"><tr><th>Дата</th><th>Код точки</th><th>Результат</th><th>Зона роста сотрудника</th><th>Локация точки</th></tr>${d.recent.map(x=>`<tr data-open="${x.id}" class="clickable"><td>${esc(x.audit_date)}</td><td>${esc(x.shop_codes||'—')}</td><td><strong>${x.total_percent??'—'}%</strong></td><td>${esc(x.growth_zone||'—')}</td><td>${(x.locations||[]).map(l=>l.url?`<a href="${l.url}" target="_blank" rel="noopener">${esc(l.code)}</a>`:esc(l.code)).join(', ')}</td></tr>`).join('')}</table></div>`:'<p class="muted">Нет данных</p>'}</div>`);
  bindNav();
  $('#applyDashFilters').onclick=()=>dashboard({region_id:$('#dashRegion').value,auditor_id:$('#dashAuditor').value,employee_id:$('#dashEmployee').value,month:$('#dashMonth').value});
  $('#resetDashFilters').onclick=()=>dashboard();
  $('#dashRegion').onchange=e=>{const region=e.target.value;$$('#dashEmployee option').forEach(o=>{if(!o.value)return;o.hidden=!!region&&o.dataset.region!==region});if($('#dashEmployee').selectedOptions[0]?.hidden)$('#dashEmployee').value=''};
}
async function getEmployees(regionId){
  if(state.employees.has(regionId))return state.employees.get(regionId);
  const cached=JSON.parse(localStorage.getItem('sle_employees_'+regionId)||'null');if(cached){state.employees.set(regionId,cached);return cached}
  const list=await api('/audits/employees?region_id='+encodeURIComponent(regionId));state.employees.set(regionId,list);localStorage.setItem('sle_employees_'+regionId,JSON.stringify(list));return list;
}
async function newAuditForm(){
  let regions=state.regions||[];try{if(!regions.length){regions=await api('/audits/regions');state.regions=regions;localStorage.setItem('sle_regions',JSON.stringify(regions))}}catch(e){return toast(e.message)}
  const fixed=state.me.role==='leader';if(fixed&&regions.length!==1)return toast('Для руководителя должен быть назначен один регион');
  let employees=[];if(fixed)employees=await getEmployees(regions[0].id);
  const users=['admin','manager'].includes(state.me.role)?await api('/admin/users').catch(()=>[]):[];
  const leaders=users.filter(x=>x.role==='leader');
  const leaderField=state.me.role==='manager'?`<div class="field"><label>Руководитель</label><select name="leader_id" id="auditLeader" required><option value="">Выберите руководителя</option>${leaders.map(x=>`<option value="${x.id}" data-region="${x.regions?.[0]?.id||''}">${esc(x.full_name)}</option>`).join('')}</select></div>`:'';
  shell(`<div class="card accent"><h1>Новый аудит</h1><form id="createAudit"><div class="grid two"><div class="field"><label>Дата</label><input type="date" name="audit_date" value="${new Date().toISOString().slice(0,10)}" required></div><div class="field"><label>Регион</label>${fixed?`<input value="${esc(regions[0].name)}" disabled><input type="hidden" name="region_id" value="${regions[0].id}">`:`<select name="region_id" id="region" required><option value="">Выберите регион</option>${regions.map(r=>`<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select>`}</div>${leaderField}<div class="field ${state.me.role==='manager'?'':'span-2'}"><label>Сотрудник</label><select name="employee_id" id="employee" required><option value="">Выберите сотрудника</option>${employees.map(x=>`<option value="${x.id}" data-leader="${x.leader_id||''}">${esc(x.full_name)}</option>`).join('')}</select></div></div><div class="actions top-gap"><button type="button" class="btn secondary" id="back">Назад</button><button class="btn primary">Создать аудит</button></div></form></div>`);
  $('#back').onclick=home;
  async function refreshEmployees(){const region=$('#region')?.value||regions[0]?.id||'';const list=region?await getEmployees(region):[];const leader=$('#auditLeader')?.value||'';const filtered=leader?list.filter(x=>x.leader_id===leader):list;$('#employee').innerHTML='<option value="">Выберите сотрудника</option>'+filtered.map(x=>`<option value="${x.id}" data-leader="${x.leader_id||''}">${esc(x.full_name)}</option>`).join('')}
  $('#region')?.addEventListener('change',async e=>{if($('#auditLeader')){$$('#auditLeader option').forEach(o=>{if(o.value)o.hidden=!!e.target.value&&o.dataset.region!==e.target.value});$('#auditLeader').value=''}await refreshEmployees()});
  $('#auditLeader')?.addEventListener('change',refreshEmployees);
  $('#createAudit').onsubmit=async e=>{e.preventDefault();const p=Object.fromEntries(new FormData(e.target));try{const d=await api('/audits',{method:'POST',body:JSON.stringify(p)});openAudit(d.id)}catch(err){toast(err.message)}};
}
async function openAudit(id){try{if(!state.questions.length){state.questions=await api('/audits/questionnaire');localStorage.setItem('sle_questions',JSON.stringify(state.questions))}state.audit=await api('/audits/'+id);if(state.audit.status==='completed')return renderResult(state.audit);state.visit=state.audit.current_visit||0;state.step=state.audit.current_step||0;renderWizard()}catch(e){toast(e.message)}}
function answersMap(){const m={};for(const a of state.audit.answers)m[`${a.visit_number}:${a.question_key}`]=a;return m}
function stepMeta(){if(state.step===0)return{title:'Общая информация',sub:'Заполняется один раз',screen:1};if(state.step===8)return{title:'Завершение дня',sub:'После пяти завершённых визитов',screen:37};return{title:['','Подготовка к визиту','Вступление','Осмотр','Презентация и работа с возражениями','Работа в точке и обучение персонала','Завершение визита','Анализ и комментарий'][state.step],sub:`Визит ${state.visit} из 5 · Шаг ${state.step} из 7`,screen:1+(state.visit-1)*7+state.step}}
function renderWizard(){
  const meta=stepMeta(),pct=Math.round(meta.screen/37*100),map=answersMap();let body='';
  if(state.step===0)body=questionCards(state.questions.filter(q=>q.step===0),0,map);
  else if(state.step===8)body=questionCards(state.questions.filter(q=>q.step===8),0,map)+visitCheck();
  else{
    const visit=state.audit.visits.find(v=>v.visit_number===state.visit);
    if(state.step===1){body=`<div class="card"><h2>Торговая точка</h2><div class="field"><label>Код торговой точки / код ТТ</label><div class="input-actions"><input id="shopCode" value="${esc(visit?.shop_code||'')}" placeholder="Введите код ТТ"><button type="button" class="btn secondary" id="scanQr">Сканировать QR</button></div></div></div><div class="card"><h2>📍 Местоположение</h2><p class="muted">${visit?.latitude!=null&&visit?.longitude!=null?`GPS сохранён: ${Number(visit.latitude).toFixed(6)}, ${Number(visit.longitude).toFixed(6)} · точность ${Math.round(visit.gps_accuracy||0)} м`:'Для каждого визита необходимо определить GPS-координаты торговой точки.'}</p><button type="button" class="btn primary full" id="gps">${visit?.latitude!=null?'Обновить местоположение':'Определить местоположение'}</button></div>`+questionCards(state.questions.filter(q=>q.step===1),state.visit,map)}
    else body=questionCards(state.questions.filter(q=>q.step===state.step),state.visit,map);
    if(state.step===7)body+=`<div class="card"><h2>Комментарий</h2><div class="field"><label>Комментарий и рекомендации</label><textarea id="visitComment">${esc(visit?.comment||'')}</textarea></div></div>`;
  }
  shell(`<div class="card"><strong>${esc(meta.title)}</strong><div class="muted">${esc(meta.sub)} · Экран ${meta.screen} из 37</div><div class="progress-wrap"><div class="progress" style="width:${pct}%"></div></div></div><div class="card accent"><h1>${esc(meta.title)}</h1><p class="muted">${esc(meta.sub)}</p></div>${body}<div class="save-state" id="saveState">Все изменения сохраняются автоматически</div><div class="bottom"><span class="actions"><button class="btn secondary" id="prev">Назад</button><button class="btn primary" id="next">${state.step===8?'Отправить':'Далее'}</button></span></div>`);bindWizard();
}
function questionCards(qs,visit,map){let out='',last='';for(const q of qs){if(q.section!==last){if(last)out+='</div>';out+=`<div class="card"><h2>${esc(q.section)}</h2>`;last=q.section}const a=map[`${visit}:${q.key}`];out+=`<div class="question" data-key="${q.key}" data-visit="${visit}"><div class="question-title">${esc(q.text)} *</div><div class="answers two-options"><button class="answer ${a?.answer_value==='1'?'selected':''}" data-value="1">1 — выполнено</button><button class="answer ${a?.answer_value==='0'?'selected':''}" data-value="0">0 — не выполнено</button></div></div>`}if(last)out+='</div>';return out}
function visitCheck(){return`<div class="card"><h2>Проверка</h2>${state.audit.visits.map(v=>`<div class="visit-row"><span>Визит ${v.visit_number}: ${esc(v.shop_code||'—')}</span><span>${v.latitude!=null&&v.longitude!=null?esc(v.latitude+', '+v.longitude):'Координаты не указаны'}</span></div>`).join('')}</div>`}
function setSaving(t){const s=$('#saveState');if(s)s.textContent=t}
function updateLocalAnswer(visit,key,value){let found=state.audit.answers.find(a=>a.visit_number===visit&&a.question_key===key);if(found){found.answer_value=value;found.comment=null}else{found={visit_number:visit,question_key:key,answer_value:value,comment:null};state.audit.answers.push(found)}state.pendingAnswers.set(`${visit}:${key}`,found);persistDraft();scheduleSync()}
function persistDraft(){if(state.audit)localStorage.setItem('sle_draft_'+state.audit.id,JSON.stringify({answers:state.audit.answers,visits:state.audit.visits,current_visit:state.visit,current_step:state.step,ts:Date.now()}))}
function scheduleSync(delay=700){setSaving('Сохранение…');clearTimeout(state.syncTimer);state.syncTimer=setTimeout(()=>flushSync().catch(e=>{setSaving('Ошибка сохранения');toast(e.message)}),delay)}
async function flushSync(extra={}){if(state.syncing)return state.syncing;clearTimeout(state.syncTimer);const answers=[...state.pendingAnswers.values()].map(a=>({visit_number:a.visit_number,question_key:a.question_key,answer_value:a.answer_value,comment:null}));const visitPayload=Object.keys(state.pendingVisit).length?{...state.pendingVisit}:null;if(!answers.length&&!visitPayload&&!Object.keys(extra).length){setSaving('Сохранено');return}const payload={answers,current_visit:state.visit,current_step:state.step,...extra};if(visitPayload&&state.visit){payload.visit_number=state.visit;payload.visit=visitPayload}state.syncing=api(`/audits/${state.audit.id}/sync`,{method:'PUT',body:JSON.stringify(payload)}).then(()=>{answers.forEach(a=>state.pendingAnswers.delete(`${a.visit_number}:${a.question_key}`));if(visitPayload)for(const k of Object.keys(visitPayload))delete state.pendingVisit[k];setSaving('Сохранено')}).finally(()=>state.syncing=null);return state.syncing}
function bindWizard(){if(state.visit&&state.step===1)api(`/extras/audit/${state.audit.id}/visit/${state.visit}/start`,{method:'POST'}).catch(()=>{});$$('.answer').forEach(b=>b.onclick=()=>{const card=b.closest('.question');updateLocalAnswer(Number(card.dataset.visit),card.dataset.key,b.dataset.value);$$('.answer',card).forEach(x=>x.classList.toggle('selected',x===b))});$('#shopCode')?.addEventListener('input',saveVisitFields);$('#gps')?.addEventListener('click',captureGps);$('#scanQr')?.addEventListener('click',scanQrCode);$('#visitComment')?.addEventListener('input',saveVisitFields);$('#prev').onclick=prevStep;$('#next').onclick=nextStep}
function saveVisitFields(extra={}){if(!state.visit)return;const visit=state.audit.visits.find(v=>v.visit_number===state.visit),payload={};if($('#shopCode'))payload.shop_code=$('#shopCode').value.trim();if($('#visitComment'))payload.comment=$('#visitComment').value;Object.assign(payload,extra);Object.assign(visit,payload);Object.assign(state.pendingVisit,payload);persistDraft();scheduleSync()}
function captureGps(){if(!navigator.geolocation)return toast('Геолокация не поддерживается на этом устройстве');const btn=$('#gps');if(btn){btn.disabled=true;btn.textContent='Определение местоположения…'}navigator.geolocation.getCurrentPosition(async p=>{try{saveVisitFields({latitude:p.coords.latitude,longitude:p.coords.longitude,gps_accuracy:p.coords.accuracy});await flushSync();toast('GPS-координаты сохранены');renderWizard()}catch(e){toast(e.message)}},e=>{if(btn){btn.disabled=false;btn.textContent='Определить местоположение'};const messages={1:'Доступ к геолокации запрещён',2:'Местоположение недоступно',3:'Превышено время ожидания GPS'};toast(messages[e.code]||('Не удалось определить местоположение: '+e.message))},{enableHighAccuracy:true,timeout:25000,maximumAge:0})}
function currentComplete(){const map=answersMap(),qs=state.questions.filter(q=>q.step===state.step),visit=[0,8].includes(state.step)?0:state.visit;if(qs.some(q=>!map[`${visit}:${q.key}`]))return false;if(state.step===1){const v=state.audit.visits.find(x=>x.visit_number===state.visit);if(!v.shop_code||v.latitude==null||v.longitude==null)return false}return true}
async function saveProgress(){await flushSync({current_visit:state.visit,current_step:state.step})}
async function nextStep(){try{if(!currentComplete())throw new Error('Заполните код ТТ, определите GPS и ответьте на все вопросы');if(state.step===8){await flushSync();const r=await api(`/audits/${state.audit.id}/submit`,{method:'POST'});state.audit={...state.audit,...r,status:'completed'};return renderResult(state.audit)}if(state.step===0){state.visit=1;state.step=1}else if(state.step<7)state.step++;else if(state.visit<5){await api(`/extras/audit/${state.audit.id}/visit/${state.visit}/end`,{method:'POST'}).catch(()=>{});state.visit++;state.step=1}else{await api(`/extras/audit/${state.audit.id}/visit/${state.visit}/end`,{method:'POST'}).catch(()=>{});state.visit=0;state.step=8}await saveProgress();renderWizard()}catch(e){toast(e.message)}}
async function prevStep(){if(state.step===0)return home();if(state.step===8){state.visit=5;state.step=7}else if(state.step>1)state.step--;else if(state.visit>1){state.visit--;state.step=7}else{state.visit=0;state.step=0}await saveProgress();renderWizard()}
function renderResult(a){shell(`<div class="card accent result"><div class="saved">✅ Результаты сохранены</div><div class="score">${Math.round(a.total_percent||0)}%</div><h1>${esc(a.level||'')}</h1><p class="muted">${esc(a.employee_name||'')}</p><button class="btn primary" id="toHome">На главную</button></div>`);$('#toHome').onclick=home}
async function adminPage(){
  let regions=[],users=[],employees=[];try{[regions,users,employees]=await Promise.all([api('/admin/regions'),api('/admin/users'),api('/admin/employees')])}catch(e){return toast(e.message)}
  const leaders=users.filter(x=>x.role==='leader');
  const leaderOptions=(selected='')=>leaders.map(x=>`<option value="${x.id}" ${selected===x.id?'selected':''}>${esc(x.full_name)} (${esc(x.regions?.[0]?.name||'без региона')})</option>`).join('');
  shell(`${mainNav('admin')}<div class="grid two"><div class="card"><h2>Добавить регион</h2><form id="addRegion"><div class="field"><label>Название</label><input name="name" required></div><button class="btn primary top-gap">Добавить</button></form></div><div class="card"><h2>Добавить сотрудника</h2><form id="addEmployee"><div class="field"><label>ФИО</label><input name="full_name" required></div><div class="field"><label>Регион</label><select name="region_id" required>${regions.map(r=>`<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></div><div class="field"><label>Руководитель</label><select name="leader_id" required><option value="">Выберите руководителя</option>${leaderOptions()}</select></div><div class="field"><label>Должность</label><input name="position"></div><button class="btn primary top-gap">Добавить</button></form></div></div>
  <div class="card"><div class="section-head"><div><h2>Сотрудники</h2><p class="muted">Дубликат ФИО в одном регионе создать нельзя. Каждый сотрудник закрепляется за руководителем.</p></div><input id="employeeSearch" class="search" placeholder="Поиск сотрудника"></div><div id="employeeTable">${employeeTable(employees)}</div></div>
  <div class="card"><h2>Создать пользователя</h2><form id="addUser"><div class="grid two"><div class="field"><label>ФИО</label><input name="full_name" required></div><div class="field"><label>Логин</label><input name="login" minlength="3" required></div><div class="field"><label>Пароль</label><input name="password" type="password" minlength="8" required></div><div class="field"><label>Роль</label><select name="role" id="userRole"><option value="leader">Руководитель</option><option value="manager">Менеджер</option>${state.me.role==='admin'?'<option value="admin">Администратор</option>':''}</select></div><div class="field span-2" id="regionField"><label>Регион руководителя</label><select name="region_id" required>${regions.map(r=>`<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></div></div><button class="btn primary top-gap">Создать</button></form></div>
  <div class="card"><h2>Пользователи</h2><div class="table-wrap"><table class="table"><tr><th>ФИО</th><th>Логин</th><th>Роль</th><th>Доступ</th><th></th></tr>${users.map(u=>`<tr><td>${esc(u.full_name)}</td><td>${esc(u.login)}</td><td>${roleName(u.role)}</td><td>${u.role==='leader'?(u.regions.map(r=>esc(r.name)).join(', ')||'—'):'Вся республика'}</td><td><span class="actions"><button class="btn secondary small" data-edit-user="${u.id}">Изменить</button>${u.id!==state.me.id?`<button class="btn danger small" data-delete-user="${u.id}" data-name="${esc(u.full_name)}">Удалить</button>`:''}</span></td></tr>`).join('')}</table></div></div>`);
  bindNav();
  const reload=()=>{state.employees.clear();Object.keys(localStorage).filter(k=>k.startsWith('sle_employees_')).forEach(k=>localStorage.removeItem(k));adminPage()};
  function bindEmployeeActions(){
    $$('[data-delete-employee]').forEach(b=>b.onclick=async()=>{if(!confirm(`Удалить сотрудника «${b.dataset.name}»?`))return;try{await api('/admin/employees/'+b.dataset.deleteEmployee,{method:'DELETE'});toast('Сотрудник удалён');reload()}catch(e){toast(e.message)}});
    $$('[data-edit-employee]').forEach(b=>b.onclick=async()=>{const x=employees.find(v=>v.id===b.dataset.editEmployee);if(!x)return;const full_name=prompt('ФИО сотрудника',x.full_name);if(full_name===null)return;const position=prompt('Должность',x.position||'');if(position===null)return;const region_id=prompt('ID региона',x.region_id)||x.region_id;const leader_id=prompt('ID руководителя',x.leader_id||'')||x.leader_id;try{await api('/admin/employees/'+x.id,{method:'PUT',body:JSON.stringify({full_name,position,region_id,leader_id})});toast('Сотрудник изменён');reload()}catch(e){toast(e.message)}})
  }
  bindEmployeeActions();
  $('#employeeSearch').oninput=e=>{const q=e.target.value.toLowerCase();$('#employeeTable').innerHTML=employeeTable(employees.filter(x=>[x.full_name,x.region_name,x.position,x.leader_name].some(v=>String(v||'').toLowerCase().includes(q))));bindEmployeeActions()};
  const toggleRegion=()=>{const leader=$('#userRole').value==='leader';$('#regionField').hidden=!leader;$('#regionField select').required=leader};$('#userRole').onchange=toggleRegion;toggleRegion();
  $('#addRegion').onsubmit=async e=>{e.preventDefault();try{await api('/admin/regions?name='+encodeURIComponent(new FormData(e.target).get('name')),{method:'POST'});toast('Регион добавлен');adminPage()}catch(err){toast(err.message)}};
  $('#addEmployee').onsubmit=async e=>{e.preventDefault();const q=new URLSearchParams(Object.fromEntries(new FormData(e.target)));try{await api('/admin/employees?'+q,{method:'POST'});toast('Сотрудник добавлен');reload()}catch(err){toast(err.message)}};
  $('#addUser').onsubmit=async e=>{e.preventDefault();const p=Object.fromEntries(new FormData(e.target));p.region_ids=p.role==='leader'&&p.region_id?[p.region_id]:[];delete p.region_id;try{await api('/admin/users',{method:'POST',body:JSON.stringify(p)});toast('Пользователь создан');adminPage()}catch(err){toast(err.message)}};
  $$('[data-delete-user]').forEach(b=>b.onclick=async()=>{if(!confirm(`Удалить пользователя «${b.dataset.name}»?`))return;try{await api('/admin/users/'+b.dataset.deleteUser,{method:'DELETE'});toast('Пользователь удалён');adminPage()}catch(e){toast(e.message)}});
  $$('[data-edit-user]').forEach(b=>b.onclick=async()=>{const u=users.find(x=>x.id===b.dataset.editUser);if(!u)return;const full_name=prompt('ФИО',u.full_name);if(full_name===null)return;const login=prompt('Логин',u.login);if(login===null)return;const password=prompt('Новый пароль (оставьте пустым без изменения)','');if(password===null)return;const payload={full_name,login,role:u.role,region_id:u.role==='leader'?(u.regions?.[0]?.id||''):null};if(password)payload.password=password;try{await api('/admin/users/'+u.id,{method:'PUT',body:JSON.stringify(payload)});toast('Пользователь изменён');adminPage()}catch(e){toast(e.message)}})
}
function employeeTable(rows){if(!rows.length)return'<p class="muted">Сотрудники не найдены</p>';return`<div class="table-wrap"><table class="table"><tr><th>ФИО</th><th>Регион</th><th>Руководитель</th><th>Должность</th><th></th></tr>${rows.map(x=>`<tr><td>${esc(x.full_name)}</td><td>${esc(x.region_name)}</td><td>${esc(x.leader_name||'—')}</td><td>${esc(x.position||'—')}</td><td><span class="actions"><button class="btn secondary small" data-edit-employee="${x.id}">Изменить</button><button class="btn danger small" data-delete-employee="${x.id}" data-name="${esc(x.full_name)}">Удалить</button></span></td></tr>`).join('')}</table></div>`}
function exportCsv(rows,name='sle-report.csv'){const csv=['Дата;Сотрудник;Регион;Оценивающий;Статус;Результат;Уровень',...rows.map(a=>[a.audit_date,a.employee_name,a.region_name,a.auditor_name,statusName(a.status),a.total_percent??'',a.level??''].map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(';'))].join('\n');const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();URL.revokeObjectURL(a.href)}
async function changePasswordPage(){
  shell(`${mainNav('')}<div class="card narrow"><h1>Изменение пароля</h1><p class="muted">Новый пароль должен содержать не менее 8 символов.</p><form id="changePasswordForm"><div class="field"><label>Текущий пароль</label><input name="current_password" type="password" required autocomplete="current-password"></div><div class="field top-gap"><label>Новый пароль</label><input name="new_password" type="password" minlength="8" required autocomplete="new-password"></div><div class="field top-gap"><label>Повторите новый пароль</label><input name="confirm_password" type="password" minlength="8" required autocomplete="new-password"></div><div class="actions top-gap"><button type="button" class="btn secondary" id="passwordBack">Назад</button><button class="btn primary">Изменить пароль</button></div></form></div>`);
  bindNav();$('#passwordBack').onclick=home;$('#changePasswordForm').onsubmit=async e=>{e.preventDefault();const p=Object.fromEntries(new FormData(e.target));if(p.new_password!==p.confirm_password)return toast('Новые пароли не совпадают');delete p.confirm_password;try{await api('/auth/change-password',{method:'POST',body:JSON.stringify(p)});toast('Пароль успешно изменён');home()}catch(err){toast(err.message)}}
}
function downloadCsv(head,rows,name){const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';const csv=[head.map(quote).join(';'),...rows.map(r=>r.map(quote).join(';'))].join('\n');const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}

async function downloadExcel(path,filename){
  try{
    toast('Подготовка Excel…');
    const res=await fetch(API+path,{headers:authHeaders()});
    if(!res.ok){let d={};try{d=await res.json()}catch{};throw new Error(typeof d.detail==='string'?d.detail:`Ошибка ${res.status}`)}
    const blob=await res.blob();
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href),1500);toast('Excel-файл загружен');
  }catch(e){toast(e.message)}
}

function enableNotifications(){if(!('Notification'in window))return toast('Уведомления не поддерживаются');Notification.requestPermission().then(p=>toast(p==='granted'?'Уведомления включены':'Разрешение не выдано'))}

boot();
