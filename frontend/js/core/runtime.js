// SLE frontend build v5.0 — lazy loading and fast navigation
const API=(window.SLE_CONFIG?.API_URL||'').replace(/\/$/,'');
const app=document.getElementById('app');

const SLE_TIME_ZONE='Asia/Tashkent';
function parseServerDateTime(value){
  if(!value)return null;
  const text=String(value);
  // Backend stores timestamps in UTC without an explicit suffix.
  return new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)?text:`${text}Z`);
}
function formatTashkentDateTime(value){
  const d=parseServerDateTime(value);
  if(!d||Number.isNaN(d.getTime()))return '—';
  return new Intl.DateTimeFormat('ru-RU',{
    timeZone:SLE_TIME_ZONE,day:'2-digit',month:'2-digit',year:'numeric',
    hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false
  }).format(d);
}
function tashkentToday(){
  const parts=new Intl.DateTimeFormat('en-CA',{
    timeZone:SLE_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(new Date());
  const get=t=>parts.find(x=>x.type===t)?.value||'';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function getDeviceId(){
  let id=localStorage.getItem('sle_device_id');
  if(!id){
    id=(crypto.randomUUID?crypto.randomUUID():`sle-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    localStorage.setItem('sle_device_id',id);
  }
  return id;
}
function getDeviceName(){
  const ua=navigator.userAgent||'';
  let browser='Браузер';
  if(/Edg\//.test(ua))browser='Microsoft Edge';
  else if(/Chrome\//.test(ua))browser='Google Chrome';
  else if(/Firefox\//.test(ua))browser='Mozilla Firefox';
  else if(/Safari\//.test(ua))browser='Safari';
  let os='Устройство';
  if(/Android/.test(ua))os='Android';
  else if(/iPhone|iPad/.test(ua))os='iPhone/iPad';
  else if(/Windows/.test(ua))os='Windows';
  else if(/Mac OS/.test(ua))os='macOS';
  else if(/Linux/.test(ua))os='Linux';
  return `${os} · ${browser}`.slice(0,240);
}
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
  if(path==='/auth/me')return 10*60*1000;
  if(path==='/admin/bootstrap')return 60*1000;
  if(path==='/audits/questionnaire'||path==='/audits/regions')return 5*60*1000;
  if(path.startsWith('/audits/employees'))return 2*60*1000;
  if(path.startsWith('/audits/dashboard'))return 30*1000;
  if(path.startsWith('/audits?'))return 15*1000;
  return 0;
}
function clearRequestCache(){requestCache.clear();inflightGets.clear()}
let pageRequestId=0;
function beginPage(){return ++pageRequestId}
function isCurrentPage(id){return id===pageRequestId}
function loadingPage(active,title='Загрузка…'){
  shell(`${mainNav(active)}<div class="card"><h1>${esc(title)}</h1><p class="muted">Данные загружаются, интерфейс остаётся доступным.</p></div>`);
  bindNav();
}

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
    const retryable=method==='GET'||path==='/auth/login';
    const attempts=retryable?2:1;
    let lastError;
    for(let attempt=0;attempt<attempts;attempt++){
      const controller=new AbortController();
      const timeoutMs=opt.timeout||(attempt===0?8000:12000);
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
          await sleep(500);
          continue;
        }
        let message=`Ошибка ${res.status}`;
        if(typeof data.detail==='string')message=data.detail;
        else if(Array.isArray(data.detail))message=data.detail.map(x=>`${(x.loc||[]).slice(1).join('.')||'поле'}: ${x.msg}`).join('; ');
        else if(data.detail?.message){message=data.detail.message;if(Array.isArray(data.detail.missing_labels)&&data.detail.missing_labels.length)message+=`: ${data.detail.missing_labels.slice(0,8).join('; ')}`;else if(Array.isArray(data.detail.missing)&&data.detail.missing.length)message+=`: не заполнено ${data.detail.missing.slice(0,8).join(', ')}`;}
        else if(data.message)message=data.message;
        console.error('API error',path,data);throw new Error(message);
      }catch(e){
        lastError=e.name==='AbortError'?new Error('Сервер запускается слишком долго'):e;
        if(!retryable||attempt===attempts-1)throw lastError;
        await sleep(500);
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
async function wakeServer(){ return true }
function startKeepAlive(){}

function esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function roleName(role){return role==='admin'?'Администратор':role==='manager'?'Менеджер':role==='auditor'?'Аудитор':'Руководитель'}
function applyTheme(){document.documentElement.dataset.theme=state.theme;document.querySelector('meta[name="theme-color"]')?.setAttribute('content',state.theme==='dark'?'#111318':'#ffd400')}
function toggleTheme(){state.theme=state.theme==='dark'?'light':'dark';localStorage.setItem('sle_theme',state.theme);applyTheme();const b=$('#themeToggle');if(b)b.textContent=state.theme==='dark'?'☀️':'🌙'}
function shell(content){
  const canSelfChange=state.me&&!['leader','auditor'].includes(state.me.role);const profile=state.me?`<div class="profile"><div><strong>${esc(state.me.full_name)}</strong><small>${roleName(state.me.role)}</small></div>${canSelfChange?'<button class="pill" id="changePassword">Пароль</button>':''}<button class="icon-btn" id="themeToggle" title="Сменить тему">${state.theme==='dark'?'☀️':'🌙'}</button><button class="pill" id="logout">Выйти</button></div>`:'';
  app.innerHTML=`<div class="shell"><header class="topbar"><div class="brand"><i></i>SLE</div>${profile}</header><div class="container">${content}</div></div>`;
  $('#logout')?.addEventListener('click',logout);$('#themeToggle')?.addEventListener('click',toggleTheme);$('#changePassword')?.addEventListener('click',changePasswordPage);
}
function logout(){clearRequestCache();localStorage.removeItem('sle_token');localStorage.removeItem('sle_me');localStorage.removeItem('sle_regions');localStorage.removeItem('sle_admin_bootstrap');state.token='';state.me=null;state.regions=null;state.employees.clear();renderLogin()}
function syncStatus(){$('#offline')?.toggleAttribute('hidden',navigator.onLine)}
