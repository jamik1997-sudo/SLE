// SLE frontend performance build v2.7
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
      if(res.ok)return data;
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
function logout(){localStorage.removeItem('sle_token');localStorage.removeItem('sle_me');state.token='';state.me=null;renderLogin()}
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
      setInterval(()=>registration.update().catch(()=>{}),15*60*1000);
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
  return `<div class="nav"><button class="pill ${active==='search'?'active':''}" data-page="search">Поиск</button><button class="pill ${active==='home'?'active':''}" data-page="home">Главная</button><button class="pill ${active==='dashboard'?'active':''}" data-page="dashboard">Дашборд</button><button class="pill ${active==='history'?'active':''}" data-page="history">Отчёты</button>${admin}${['admin','manager'].includes(state.me.role)?'<button class="pill '+(active==='logs'?'active':'')+'" data-page="logs">Журнал</button>':''}${state.me.role==='admin'?'<button class="pill '+(active==='settings'?'active':'')+'" data-page="settings">Настройки</button>':''}<button class="pill '+(active==='language'?'active':'')+'" id="langToggle">RU/UZ</button></div>`;
}
function renderHome(){
  const drafts=state.audits.filter(a=>['draft','in_progress'].includes(a.status)&&a.is_mine!==false);
  shell(`${mainNav('home')}${drafts.length?`<div class="card accent"><h2>Черновики</h2>${drafts.map(d=>`<div class="visit-row"><span>${esc(d.employee_name)} · ${esc(d.region_name)}</span><span class="actions"><button class="btn primary small" data-resume="${d.id}">Продолжить</button><button class="btn danger small" data-cancel-audit="${d.id}">Отменить</button></span></div>`).join('')}</div>`:''}<div class="card"><h2>Новый аудит</h2><p class="muted">Оценка сотрудника по пяти торговым точкам</p><button class="btn primary" id="newAudit">Начать</button></div><div class="card"><h2>Последние аудиты</h2>${auditTable(state.audits.slice(0,8))}</div>`);
  bindNav();$('#newAudit')?.addEventListener('click',newAuditForm);$$('[data-resume]').forEach(b=>b.onclick=()=>openAudit(b.dataset.resume));bindCancelAuditButtons();
}
async function home(){
  if(!state.audits.length){try{state.audits=JSON.parse(localStorage.getItem('sle_audits_cache')||'[]')}catch{}}
  renderHome();
  try{
    const fresh=await api('/audits?limit=50');
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
  $$('[data-open]').forEach(r=>r.onclick=()=>openAudit(r.dataset.open));$('#langToggle')?.addEventListener('click',()=>{const l=localStorage.getItem('sle_lang')==='uz'?'ru':'uz';localStorage.setItem('sle_lang',l);toast(l==='uz'?'O‘zbek tili yoqildi':'Русский язык включён');location.reload()});
}
async function history(){
  try{state.audits=await api('/audits?limit=500')}catch(e){return toast(e.message)}
  shell(`${mainNav('history')}<div class="card"><div class="section-head"><div><h1>Отчёты</h1><p class="muted">Все доступные аудиты</p></div><input id="reportSearch" class="search" placeholder="Поиск по сотруднику или региону"></div><div class="actions"><button class="btn secondary" id="exportExcel">Excel</button><button class="btn secondary" id="printReports">Печать / PDF</button><button class="btn secondary" id="notifyBtn">Уведомления</button><button class="btn primary" id="questionnaireReport">Заполнения опросника</button><button class="btn secondary" id="exportAnswers">Выгрузить в Excel</button></div><div id="questionnaireReportBox" class="top-gap"></div><div id="reportTable" class="top-gap">${auditTable(state.audits)}</div></div>`);
  bindNav();$('#exportExcel').onclick=()=>downloadExcel('/extras/export/audits.xlsx','sle-audits.xlsx');$('#printReports').onclick=()=>window.print();$('#notifyBtn').onclick=enableNotifications;$('#questionnaireReport').onclick=loadQuestionnaireReport;$('#exportAnswers').onclick=exportQuestionnaireAnswers;$('#reportSearch').oninput=e=>{const q=e.target.value.trim().toLowerCase();const rows=state.audits.filter(a=>[a.employee_name,a.region_name,a.auditor_name,a.level].some(v=>String(v||'').toLowerCase().includes(q)));$('#reportTable').innerHTML=auditTable(rows);$$('[data-open]').forEach(r=>r.onclick=()=>openAudit(r.dataset.open))};
}
function statBar(label,value,count){return`<div class="stat-row"><div class="stat-label"><span>${esc(label)}</span><strong>${value}%</strong></div><div class="bar"><i style="width:${Math.max(0,Math.min(100,value))}%"></i></div><small>${count} ауд.</small></div>`}
async function dashboard(filters={}){
  const qs=new URLSearchParams(Object.entries(filters).filter(([,v])=>v));
  let d;try{d=await api('/audits/dashboard'+(qs.toString()?'?'+qs.toString():''))}catch(e){return toast(e.message)}
  const f=d.filters||{regions:[],auditors:[],employees:[],months:[],selected:{}};
  const sel=f.selected||{};
  const maxLevel=Math.max(1,...Object.values(d.levels));
  const filterBox=`<div class="card dashboard-filters"><h2>Фильтры</h2><div class="grid four"><div class="field"><label>Регион</label><select id="dashRegion"><option value="">Все регионы</option>${f.regions.map(x=>`<option value="${x.id}" ${sel.region_id===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div><div class="field"><label>Руководитель / менеджер</label><select id="dashAuditor"><option value="">Все</option>${f.auditors.map(x=>`<option value="${x.id}" ${sel.auditor_id===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div><div class="field"><label>Сотрудник</label><select id="dashEmployee"><option value="">Все сотрудники</option>${f.employees.map(x=>`<option value="${x.id}" data-region="${x.region_id}" ${sel.employee_id===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div><div class="field"><label>Месяц</label><select id="dashMonth"><option value="">Все месяцы</option>${f.months.map(x=>`<option value="${x}" ${sel.month===x?'selected':''}>${x}</option>`).join('')}</select></div></div><div class="actions top-gap"><button class="btn primary" id="applyDashFilters">Применить</button><button class="btn secondary" id="resetDashFilters">Сбросить</button></div></div>`;
  shell(`${mainNav('dashboard')}<div class="dashboard-head"><div><h1>Дашборд</h1><p class="muted">Статистика по завершённым аудитам</p></div></div>${filterBox}<div class="kpi-grid"><div class="kpi"><span>Завершено аудитов</span><strong>${d.total}</strong></div><div class="kpi"><span>Средний результат</span><strong>${d.average}%</strong></div><div class="kpi"><span>Мастер</span><strong>${d.levels['Мастер']||0}</strong></div><div class="kpi"><span>Уверенный</span><strong>${d.levels['Уверенный']||0}</strong></div></div><div class="card"><h2>Результаты по каждому блоку</h2>${d.blocks?.length?`<div class="table-wrap"><table class="table block-results"><thead><tr><th>Блок</th><th>Кол-во оценок</th><th>Средний результат</th></tr></thead><tbody>${d.blocks.map(x=>`<tr><td>${esc(x.name)}</td><td>${x.count}</td><td><div class="block-result-cell"><strong>${x.average}%</strong><div class="mini-bar"><i style="width:${Math.max(0,Math.min(100,x.average))}%"></i></div></div></td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">Нет данных</p>'}</div><div class="grid two"><div class="card"><h2>Уровни оценки</h2>${Object.entries(d.levels).map(([name,count])=>`<div class="level-row"><span>${esc(name)}</span><div class="mini-bar"><i style="width:${count/maxLevel*100}%"></i></div><strong>${count}</strong></div>`).join('')}</div><div class="card"><h2>Динамика по месяцам</h2>${d.months.length?d.months.map(x=>statBar(x.month,x.average,x.count)).join(''):'<p class="muted">Нет данных</p>'}</div></div><div class="grid two"><div class="card"><h2>Результаты по регионам</h2>${d.regions.length?d.regions.map(x=>statBar(x.name,x.average,x.count)).join(''):'<p class="muted">Нет данных</p>'}</div><div class="card"><h2>Топ сотрудников</h2>${d.employees.length?`<div class="table-wrap"><table class="table"><tr><th>Сотрудник</th><th>Регион</th><th>Среднее</th><th>Аудиты</th></tr>${d.employees.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.region)}</td><td><strong>${x.average}%</strong></td><td>${x.count}</td></tr>`).join('')}</table></div>`:'<p class="muted">Нет данных</p>'}</div></div><div class="card"><h2>Последние завершённые аудиты</h2>${d.recent.length?`<div class="table-wrap"><table class="table"><tr><th>Дата</th><th>Сотрудник</th><th>Регион</th><th>Руководитель/менеджер</th><th>Результат</th><th>Уровень</th></tr>${d.recent.map(x=>`<tr data-open="${x.id}" class="clickable"><td>${esc(x.audit_date)}</td><td>${esc(x.employee_name)}</td><td>${esc(x.region_name)}</td><td>${esc(x.auditor_name)}</td><td><strong>${x.total_percent}%</strong></td><td>${esc(x.level||'—')}</td></tr>`).join('')}</table></div>`:'<p class="muted">Нет данных</p>'}</div>`);
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
  const fixed=state.me.role==='leader';if(fixed&&regions.length!==1)return toast('Для руководителя должен быть назначен один регион');let employees=[];if(fixed)employees=await getEmployees(regions[0].id);
  shell(`<div class="card accent"><h1>Новый аудит</h1><form id="createAudit"><div class="grid two"><div class="field"><label>Дата</label><input type="date" name="audit_date" value="${new Date().toISOString().slice(0,10)}" required></div><div class="field"><label>Регион</label>${fixed?`<input value="${esc(regions[0].name)}" disabled><input type="hidden" name="region_id" value="${regions[0].id}">`:`<select name="region_id" id="region" required><option value="">Выберите регион</option>${regions.map(r=>`<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select>`}</div><div class="field span-2"><label>Сотрудник</label><select name="employee_id" id="employee" required><option value="">Выберите сотрудника</option>${employees.map(x=>`<option value="${x.id}">${esc(x.full_name)}</option>`).join('')}</select></div></div><div class="actions top-gap"><button type="button" class="btn secondary" id="back">Назад</button><button class="btn primary">Создать аудит</button></div></form></div>`);
  $('#back').onclick=home;$('#region')?.addEventListener('change',async e=>{const list=e.target.value?await getEmployees(e.target.value):[];$('#employee').innerHTML='<option value="">Выберите сотрудника</option>'+list.map(x=>`<option value="${x.id}">${esc(x.full_name)}</option>`).join('')});
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
    if(state.step===1){body=`<div class="card"><h2>Торговая точка</h2><div class="field"><label>Код торговой точки / код ТТ</label><div class="input-actions"><input id="shopCode" value="${esc(visit?.shop_code||'')}" placeholder="Введите код ТТ"><button type="button" class="btn secondary" id="scanQr">Сканировать QR</button></div></div><div class="field top-gap"><label>Название торговой точки</label><input id="shopName" value="${esc(visit?.shop_name||'')}" placeholder="Название ТТ"></div></div><div class="card"><h2>📍 Местоположение</h2><p class="muted">${visit?.latitude!=null&&visit?.longitude!=null?`GPS сохранён: ${Number(visit.latitude).toFixed(6)}, ${Number(visit.longitude).toFixed(6)} · точность ${Math.round(visit.gps_accuracy||0)} м`:'Для каждого визита необходимо определить GPS-координаты торговой точки.'}</p><button type="button" class="btn primary full" id="gps">${visit?.latitude!=null?'Обновить местоположение':'Определить местоположение'}</button></div>`+questionCards(state.questions.filter(q=>q.step===1),state.visit,map)}
    else body=questionCards(state.questions.filter(q=>q.step===state.step),state.visit,map);
    if(state.step===7)body+=`<div class="card"><h2>Комментарий</h2><div class="field"><label>Комментарий и рекомендации</label><textarea id="visitComment">${esc(visit?.comment||'')}</textarea></div></div>`;
  }
  shell(`<div class="card"><strong>${esc(meta.title)}</strong><div class="muted">${esc(meta.sub)} · Экран ${meta.screen} из 37</div><div class="progress-wrap"><div class="progress" style="width:${pct}%"></div></div></div><div class="card accent"><h1>${esc(meta.title)}</h1><p class="muted">${esc(meta.sub)}</p></div>${body}<div class="save-state" id="saveState">Все изменения сохраняются автоматически</div><div class="bottom"><button class="btn danger" id="cancelAudit">Отменить аудит</button><span class="actions"><button class="btn secondary" id="prev">Назад</button><button class="btn primary" id="next">${state.step===8?'Отправить':'Далее'}</button></span></div>`);bindWizard();
}
function questionCards(qs,visit,map){let out='',last='';for(const q of qs){if(q.section!==last){if(last)out+='</div>';out+=`<div class="card"><h2>${esc(q.section)}</h2>`;last=q.section}const a=map[`${visit}:${q.key}`];out+=`<div class="question" data-key="${q.key}" data-visit="${visit}"><div class="question-title">${esc(q.text)} *</div><div class="answers two-options"><button class="answer ${a?.answer_value==='1'?'selected':''}" data-value="1">1 — выполнено</button><button class="answer ${a?.answer_value==='0'?'selected':''}" data-value="0">0 — не выполнено</button></div></div>`}if(last)out+='</div>';return out}
function visitCheck(){return`<div class="card"><h2>Проверка</h2>${state.audit.visits.map(v=>`<div class="visit-row"><span>Визит ${v.visit_number}: ${esc(v.shop_name||v.shop_code||'—')}</span><span>${v.latitude!=null&&v.longitude!=null?esc(v.latitude+', '+v.longitude):'Координаты не указаны'}</span></div>`).join('')}</div>`}
function setSaving(t){const s=$('#saveState');if(s)s.textContent=t}
function updateLocalAnswer(visit,key,value){let found=state.audit.answers.find(a=>a.visit_number===visit&&a.question_key===key);if(found){found.answer_value=value;found.comment=null}else{found={visit_number:visit,question_key:key,answer_value:value,comment:null};state.audit.answers.push(found)}state.pendingAnswers.set(`${visit}:${key}`,found);persistDraft();scheduleSync()}
function persistDraft(){if(state.audit)localStorage.setItem('sle_draft_'+state.audit.id,JSON.stringify({answers:state.audit.answers,visits:state.audit.visits,current_visit:state.visit,current_step:state.step,ts:Date.now()}))}
function scheduleSync(delay=700){setSaving('Сохранение…');clearTimeout(state.syncTimer);state.syncTimer=setTimeout(()=>flushSync().catch(e=>{setSaving('Ошибка сохранения');toast(e.message)}),delay)}
async function flushSync(extra={}){if(state.syncing)return state.syncing;clearTimeout(state.syncTimer);const answers=[...state.pendingAnswers.values()].map(a=>({visit_number:a.visit_number,question_key:a.question_key,answer_value:a.answer_value,comment:null}));const visitPayload=Object.keys(state.pendingVisit).length?{...state.pendingVisit}:null;if(!answers.length&&!visitPayload&&!Object.keys(extra).length){setSaving('Сохранено');return}const payload={answers,current_visit:state.visit,current_step:state.step,...extra};if(visitPayload&&state.visit){payload.visit_number=state.visit;payload.visit=visitPayload}state.syncing=api(`/audits/${state.audit.id}/sync`,{method:'PUT',body:JSON.stringify(payload)}).then(()=>{answers.forEach(a=>state.pendingAnswers.delete(`${a.visit_number}:${a.question_key}`));if(visitPayload)for(const k of Object.keys(visitPayload))delete state.pendingVisit[k];setSaving('Сохранено')}).finally(()=>state.syncing=null);return state.syncing}
function bindWizard(){if(state.visit&&state.step===1)api(`/extras/audit/${state.audit.id}/visit/${state.visit}/start`,{method:'POST'}).catch(()=>{});$$('.answer').forEach(b=>b.onclick=()=>{const card=b.closest('.question');updateLocalAnswer(Number(card.dataset.visit),card.dataset.key,b.dataset.value);$$('.answer',card).forEach(x=>x.classList.toggle('selected',x===b))});$('#shopCode')?.addEventListener('input',saveVisitFields);$('#shopName')?.addEventListener('input',saveVisitFields);$('#gps')?.addEventListener('click',captureGps);$('#scanQr')?.addEventListener('click',scanQrCode);$('#visitComment')?.addEventListener('input',saveVisitFields);$('#prev').onclick=prevStep;$('#next').onclick=nextStep;$('#cancelAudit').onclick=()=>cancelAudit(state.audit.id)}
function saveVisitFields(extra={}){if(!state.visit)return;const visit=state.audit.visits.find(v=>v.visit_number===state.visit),payload={};if($('#shopCode'))payload.shop_code=$('#shopCode').value.trim();if($('#shopName'))payload.shop_name=$('#shopName').value.trim();if($('#visitComment'))payload.comment=$('#visitComment').value;Object.assign(payload,extra);Object.assign(visit,payload);Object.assign(state.pendingVisit,payload);persistDraft();scheduleSync()}
function captureGps(){if(!navigator.geolocation)return toast('Геолокация не поддерживается на этом устройстве');const btn=$('#gps');if(btn){btn.disabled=true;btn.textContent='Определение местоположения…'}navigator.geolocation.getCurrentPosition(async p=>{try{saveVisitFields({latitude:p.coords.latitude,longitude:p.coords.longitude,gps_accuracy:p.coords.accuracy});await flushSync();toast('GPS-координаты сохранены');renderWizard()}catch(e){toast(e.message)}},e=>{if(btn){btn.disabled=false;btn.textContent='Определить местоположение'};const messages={1:'Доступ к геолокации запрещён',2:'Местоположение недоступно',3:'Превышено время ожидания GPS'};toast(messages[e.code]||('Не удалось определить местоположение: '+e.message))},{enableHighAccuracy:true,timeout:25000,maximumAge:0})}
function currentComplete(){const map=answersMap(),qs=state.questions.filter(q=>q.step===state.step),visit=[0,8].includes(state.step)?0:state.visit;if(qs.some(q=>!map[`${visit}:${q.key}`]))return false;if(state.step===1){const v=state.audit.visits.find(x=>x.visit_number===state.visit);if(!v.shop_code||v.latitude==null||v.longitude==null)return false}return true}
async function saveProgress(){await flushSync({current_visit:state.visit,current_step:state.step})}
async function nextStep(){try{if(!currentComplete())throw new Error('Заполните код ТТ, определите GPS и ответьте на все вопросы');if(state.step===8){await flushSync();const r=await api(`/audits/${state.audit.id}/submit`,{method:'POST'});state.audit={...state.audit,...r,status:'completed'};return renderResult(state.audit)}if(state.step===0){state.visit=1;state.step=1}else if(state.step<7)state.step++;else if(state.visit<5){await api(`/extras/audit/${state.audit.id}/visit/${state.visit}/end`,{method:'POST'}).catch(()=>{});state.visit++;state.step=1}else{await api(`/extras/audit/${state.audit.id}/visit/${state.visit}/end`,{method:'POST'}).catch(()=>{});state.visit=0;state.step=8}await saveProgress();renderWizard()}catch(e){toast(e.message)}}
async function prevStep(){if(state.step===0)return home();if(state.step===8){state.visit=5;state.step=7}else if(state.step>1)state.step--;else if(state.visit>1){state.visit--;state.step=7}else{state.visit=0;state.step=0}await saveProgress();renderWizard()}
function renderResult(a){shell(`<div class="card accent result"><div class="saved">✅ Результаты сохранены</div><div class="score">${Math.round(a.total_percent||0)}%</div><h1>${esc(a.level||'')}</h1><p class="muted">${esc(a.employee_name||'')}</p><button class="btn primary" id="toHome">На главную</button></div>`);$('#toHome').onclick=home}
async function adminPage(){
  let regions=[],users=[],employees=[];try{[regions,users,employees]=await Promise.all([api('/admin/regions'),api('/admin/users'),api('/admin/employees')])}catch(e){toast(e.message)}
  shell(`${mainNav('admin')}<div class="grid two">${state.me.role==='admin'?`<div class="card"><h2>Добавить регион</h2><form id="addRegion"><div class="field"><label>Название</label><input name="name" required></div><button class="btn primary top-gap">Добавить</button></form></div>`:''}<div class="card"><h2>Добавить сотрудника</h2><form id="addEmployee"><div class="field"><label>ФИО</label><input name="full_name" required></div><div class="field"><label>Регион</label><select name="region_id" required>${regions.map(r=>`<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></div><div class="field"><label>Должность</label><input name="position"></div><button class="btn primary top-gap">Добавить</button></form></div></div><div class="card"><div class="section-head"><div><h2>Сотрудники</h2><p class="muted">Удаление скрывает сотрудника из новых аудитов, но сохраняет его старые результаты.</p></div><input id="employeeSearch" class="search" placeholder="Поиск сотрудника"></div><div id="employeeTable">${employeeTable(employees)}</div></div><div class="card"><h2>Создать пользователя</h2><form id="addUser"><div class="grid two"><div class="field"><label>ФИО</label><input name="full_name" required></div><div class="field"><label>Логин</label><input name="login" minlength="3" required></div><div class="field"><label>Пароль</label><input name="password" type="password" minlength="8" placeholder="Минимум 8 символов" required></div><div class="field"><label>Роль</label><select name="role" id="userRole"><option value="leader">Руководитель</option><option value="manager">Менеджер (вся республика)</option>${state.me.role==='admin'?'<option value="admin">Администратор</option>':''}</select></div><div class="field span-2" id="regionField"><label>Регион руководителя</label><select name="region_id" required>${regions.map(r=>`<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select><small class="muted">Руководитель работает только в одном регионе.</small></div></div><button class="btn primary top-gap">Создать</button></form></div><div class="card"><h2>Пользователи</h2><div class="table-wrap"><table class="table"><tr><th>ФИО</th><th>Логин</th><th>Роль</th><th>Доступ</th></tr>${users.map(u=>`<tr><td>${esc(u.full_name)}</td><td>${esc(u.login)}</td><td>${roleName(u.role)}</td><td>${u.role==='leader'?(u.regions.map(r=>esc(r.name)).join(', ')||'Регион не назначен'):'Вся республика'}</td></tr>`).join('')}</table></div></div>`);
  bindNav();
  const bindDelete=()=>$$('[data-delete-employee]').forEach(b=>b.onclick=async()=>{if(!confirm(`Удалить сотрудника «${b.dataset.name}»?`))return;try{await api('/admin/employees/'+b.dataset.deleteEmployee,{method:'DELETE'});state.employees.clear();Object.keys(localStorage).filter(k=>k.startsWith('sle_employees_')).forEach(k=>localStorage.removeItem(k));toast('Сотрудник удалён');adminPage()}catch(e){toast(e.message)}});bindDelete();
  $('#employeeSearch').oninput=e=>{const q=e.target.value.toLowerCase();$('#employeeTable').innerHTML=employeeTable(employees.filter(x=>[x.full_name,x.region_name,x.position].some(v=>String(v||'').toLowerCase().includes(q))));bindDelete()};
  const toggleRegion=()=>{const leader=$('#userRole').value==='leader';$('#regionField').hidden=!leader;$('#regionField select').required=leader};$('#userRole').onchange=toggleRegion;toggleRegion();
  $('#addRegion')&&($('#addRegion').onsubmit=async e=>{e.preventDefault();try{await api('/admin/regions?name='+encodeURIComponent(new FormData(e.target).get('name')),{method:'POST'});toast('Регион добавлен');adminPage()}catch(err){toast(err.message)}});
  $('#addEmployee').onsubmit=async e=>{e.preventDefault();const q=new URLSearchParams(Object.fromEntries(new FormData(e.target)));try{await api('/admin/employees?'+q,{method:'POST'});state.employees.clear();Object.keys(localStorage).filter(k=>k.startsWith('sle_employees_')).forEach(k=>localStorage.removeItem(k));toast('Сотрудник добавлен');adminPage()}catch(err){toast(err.message)}};
  $('#addUser').onsubmit=async e=>{e.preventDefault();const p=Object.fromEntries(new FormData(e.target));p.region_ids=p.role==='leader'&&p.region_id?[p.region_id]:[];delete p.region_id;try{await api('/admin/users',{method:'POST',body:JSON.stringify(p)});toast('Пользователь создан');adminPage()}catch(err){toast(err.message)}};
}
function employeeTable(rows){if(!rows.length)return'<p class="muted">Сотрудники не найдены</p>';return`<div class="table-wrap"><table class="table"><tr><th>ФИО</th><th>Регион</th><th>Должность</th><th></th></tr>${rows.map(x=>`<tr><td>${esc(x.full_name)}</td><td>${esc(x.region_name)}</td><td>${esc(x.position||'—')}</td><td><button class="btn danger small" data-delete-employee="${x.id}" data-name="${esc(x.full_name)}">Удалить</button></td></tr>`).join('')}</table></div>`}

async function searchPage(){shell(`${mainNav('search')}<div class="card"><h1>Глобальный поиск</h1><div class="field"><input id="globalSearch" placeholder="Сотрудник, регион, аудит..."></div><div id="searchResults" class="top-gap"><p class="muted">Введите минимум 2 символа</p></div></div>`);bindNav();let t;$('#globalSearch').oninput=e=>{clearTimeout(t);const q=e.target.value.trim();if(q.length<2)return;t=setTimeout(async()=>{try{const d=await api('/extras/search?q='+encodeURIComponent(q));$('#searchResults').innerHTML=`<h2>Сотрудники</h2>${d.employees.map(x=>`<button class="search-result" data-employee="${x.id}"><strong>${esc(x.name)}</strong><small>${esc(x.region)} · ${esc(x.position||'')}</small></button>`).join('')||'<p class="muted">Не найдено</p>'}<h2 class="top-gap">Аудиты</h2>${d.audits.map(x=>`<button class="search-result" data-open="${x.id}"><strong>${esc(x.employee)}</strong><small>${esc(x.region)} · ${x.date} · ${x.percent??'—'}%</small></button>`).join('')||'<p class="muted">Не найдено</p>'}`;$$('[data-employee]').forEach(b=>b.onclick=()=>employeeCard(b.dataset.employee));$$('[data-open]').forEach(b=>b.onclick=()=>openAudit(b.dataset.open))}catch(err){toast(err.message)}},350)}}
async function employeeCard(id){let d;try{d=await api('/extras/employees/'+id)}catch(e){return toast(e.message)}shell(`${mainNav('search')}<div class="card accent"><h1>${esc(d.full_name)}</h1><p>${esc(d.position||'—')} · ${esc(d.region)}</p><div class="kpi-grid"><div class="kpi"><span>Аудитов</span><strong>${d.audits}</strong></div><div class="kpi"><span>Средний балл</span><strong>${d.average}%</strong></div><div class="kpi"><span>Последний результат</span><strong>${d.last_result??'—'}${d.last_result!=null?'%':''}</strong></div></div></div><div class="card"><h2>Динамика</h2>${d.trend.map(x=>statBar(x.date,x.percent,1)).join('')||'<p class="muted">Нет данных</p>'}</div>`);bindNav()}
async function logsPage(){let rows;try{rows=await api('/extras/logs')}catch(e){return toast(e.message)}shell(`${mainNav('logs')}<div class="card"><h1>Журнал действий</h1><div class="timeline">${rows.map(x=>`<div class="timeline-item"><strong>${esc(x.user)}</strong><span>${esc(x.action)}</span><small>${new Date(x.created_at).toLocaleString()} ${x.details?'· '+esc(x.details):''}</small></div>`).join('')||'<p class="muted">Записей нет</p>'}</div></div>`);bindNav()}
async function settingsPage(){let qs,ss;try{[qs,ss]=await Promise.all([api('/extras/question-settings'),api('/extras/score-settings')])}catch(e){return toast(e.message)}shell(`${mainNav('settings')}<div class="card"><h1>Настройки оценки</h1><form id="scoreForm" class="grid two"><div class="field"><label>Уверенный от, %</label><input name="confident_min" type="number" value="${ss.confident_min}" min="1" max="99"></div><div class="field"><label>Мастер от, %</label><input name="master_min" type="number" value="${ss.master_min}" min="2" max="100"></div><button class="btn primary">Сохранить</button></form></div><div class="card"><h1>Конструктор опросника</h1><div class="table-wrap"><table class="table"><tr><th>Раздел</th><th>Вопрос</th><th>Вес</th><th>Активен</th><th></th></tr>${qs.map(q=>`<tr><td><input data-q="${q.key}" data-f="section" value="${esc(q.section)}"></td><td><textarea data-q="${q.key}" data-f="text_ru">${esc(q.text_ru)}</textarea></td><td><input data-q="${q.key}" data-f="weight" type="number" step="0.5" value="${q.weight}"></td><td><input data-q="${q.key}" data-f="is_active" type="checkbox" ${q.is_active?'checked':''}></td><td><button class="btn secondary small" data-save-q="${q.key}">Сохранить</button></td></tr>`).join('')}</table></div></div>`);bindNav();$('#scoreForm').onsubmit=async e=>{e.preventDefault();const p=Object.fromEntries(new FormData(e.target));await api('/extras/score-settings',{method:'PUT',body:JSON.stringify(p)});toast('Настройки сохранены')};$$('[data-save-q]').forEach(b=>b.onclick=async()=>{const key=b.dataset.saveQ,p={};$$(`[data-q="${key}"]`).forEach(el=>p[el.dataset.f]=el.type==='checkbox'?el.checked:el.dataset.f==='weight'?Number(el.value):el.value);await api('/extras/question-settings/'+key,{method:'PUT',body:JSON.stringify(p)});localStorage.removeItem('sle_questions');toast('Вопрос сохранён')})}
async function scanQrCode(){if(!('BarcodeDetector'in window)){const code=prompt('Сканер QR не поддерживается. Введите код ТТ:');if(code){$('#shopCode').value=code;saveVisitFields()}return}try{const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});const wrap=document.createElement('div');wrap.className='scanner';wrap.innerHTML='<video autoplay playsinline></video><button class="btn danger">Закрыть</button>';document.body.appendChild(wrap);const video=wrap.querySelector('video');video.srcObject=stream;const detector=new BarcodeDetector({formats:['qr_code']});let closed=false;const close=()=>{closed=true;stream.getTracks().forEach(t=>t.stop());wrap.remove()};wrap.querySelector('button').onclick=close;const loop=async()=>{if(closed)return;try{const codes=await detector.detect(video);if(codes[0]){$('#shopCode').value=codes[0].rawValue;saveVisitFields();toast('Код ТТ считан');close();return}}catch{}requestAnimationFrame(loop)};loop()}catch(e){toast('Не удалось открыть камеру')}
}
function exportCsv(rows,name='sle-report.csv'){const csv=['Дата;Сотрудник;Регион;Оценивающий;Статус;Результат;Уровень',...rows.map(a=>[a.audit_date,a.employee_name,a.region_name,a.auditor_name,statusName(a.status),a.total_percent??'',a.level??''].map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(';'))].join('\n');const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();URL.revokeObjectURL(a.href)}
async function changePasswordPage(){
  shell(`${mainNav('')}<div class="card narrow"><h1>Изменение пароля</h1><p class="muted">Новый пароль должен содержать не менее 8 символов.</p><form id="changePasswordForm"><div class="field"><label>Текущий пароль</label><input name="current_password" type="password" required autocomplete="current-password"></div><div class="field top-gap"><label>Новый пароль</label><input name="new_password" type="password" minlength="8" required autocomplete="new-password"></div><div class="field top-gap"><label>Повторите новый пароль</label><input name="confirm_password" type="password" minlength="8" required autocomplete="new-password"></div><div class="actions top-gap"><button type="button" class="btn secondary" id="passwordBack">Назад</button><button class="btn primary">Изменить пароль</button></div></form></div>`);
  bindNav();$('#passwordBack').onclick=home;$('#changePasswordForm').onsubmit=async e=>{e.preventDefault();const p=Object.fromEntries(new FormData(e.target));if(p.new_password!==p.confirm_password)return toast('Новые пароли не совпадают');delete p.confirm_password;try{await api('/auth/change-password',{method:'POST',body:JSON.stringify(p)});toast('Пароль успешно изменён');home()}catch(err){toast(err.message)}}
}
async function cancelAudit(id){
  if(!confirm('Отменить незавершённый аудит? Все сохранённые ответы останутся в истории со статусом «Отменён».'))return;
  try{await flushSync().catch(()=>{});await api(`/audits/${id}/cancel`,{method:'POST'});localStorage.removeItem('sle_draft_'+id);state.audit=null;toast('Аудит отменён');home()}catch(e){toast(e.message)}
}
function bindCancelAuditButtons(){$$('[data-cancel-audit]').forEach(b=>b.onclick=()=>cancelAudit(b.dataset.cancelAudit))}
function reportTableQuestions(rows){if(!rows.length)return'<p class="muted">Нет данных</p>';return `<div class="table-wrap"><table class="table"><tr><th>Раздел</th><th>Вопрос</th><th>Заполнено</th><th>Ожидалось</th><th>Заполнение</th><th>1</th><th>0</th><th>Выполнение</th></tr>${rows.map(x=>`<tr><td>${esc(x.section)}</td><td>${esc(x.text)}</td><td>${x.filled}</td><td>${x.expected}</td><td><strong>${x.completion_percent}%</strong></td><td>${x.ones}</td><td>${x.zeros}</td><td><strong>${x.success_percent}%</strong></td></tr>`).join('')}</table></div>`}
async function loadQuestionnaireReport(){const box=$('#questionnaireReportBox');box.innerHTML='<div class="card"><p class="muted">Загрузка отчёта…</p></div>';try{const d=await api('/extras/questionnaire-report');box.innerHTML=`<div class="card"><h2>Отчёт по опроснику и заполнениям</h2><div class="kpi-grid"><div class="kpi"><span>Аудитов</span><strong>${d.audit_count}</strong></div><div class="kpi"><span>Ответов</span><strong>${d.total_answers}</strong></div><div class="kpi"><span>Завершено</span><strong>${d.status_counts.completed||0}</strong></div><div class="kpi"><span>В процессе</span><strong>${(d.status_counts.draft||0)+(d.status_counts.in_progress||0)}</strong></div></div>${reportTableQuestions(d.questions)}</div>`}catch(e){box.innerHTML='';toast(e.message)}}
async function exportQuestionnaireAnswers(){await downloadExcel('/extras/export/questionnaire.xlsx','sle-questionnaire-report.xlsx')}
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
