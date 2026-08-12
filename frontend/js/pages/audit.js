
async function syncStoredOfflineDrafts(){
  if(!navigator.onLine)return;
  if(state.audit && ['draft','in_progress'].includes(state.audit.status)){
    try{
      const rec=await offlineGet(state.audit.id);
      if(rec?.dirty || state.offlinePendingSubmit || state.offlineLocalAudit){
        await syncOfflineSnapshot();
      }
    }catch(err){
      console.warn('Stored offline draft sync skipped',err);
    }
  }
}


function markVisitTiming(kind,visitNumber){
  if(!visitNumber)return;
  state.offlineTimings=state.offlineTimings||{};
  const timing=state.offlineTimings[visitNumber]||(state.offlineTimings[visitNumber]={});
  const now=new Date().toISOString();
  if(kind==='start'&&!timing.started_at)timing.started_at=now;
  if(kind==='end')timing.ended_at=now;
  if(typeof persistDraft==='function')persistDraft();
}

// v6.4.5 offline-first audit engine\nfunction normalizeShopCode(value){return String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'')}\nfunction draftStorageKey(id){return 'sle_draft_'+id}\nfunction isLocalAuditId(id){return String(id||'').startsWith('local-')}\nfunction cachedQuestions(){try{return asArray(JSON.parse(localStorage.getItem('sle_questions')||'[]'))}catch{return []}}\nfunction cachedRegions(){try{return asArray(JSON.parse(localStorage.getItem('sle_regions')||'[]'))}catch{return []}}\nfunction makeLocalAudit(createPayload,employee,region){\n  const id='local-'+(crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`);\n  return {id,audit_date:tashkentToday(),region_id:createPayload.region_id,region_name:region?.name||'',employee_id:createPayload.employee_id,employee_name:employee?.full_name||employee?.name||'',status:'draft',current_visit:0,current_step:0,total_score:null,total_percent:null,level:null,visits:[1,2,3,4,5].map(n=>({visit_number:n,shop_code:'',goal:'',latitude:null,longitude:null,gps_accuracy:null,comment:''})),answers:[],_offlineCreate:createPayload};\n}\nfunction draftRecord(){\n  if(!state.audit)return null;\n  return {id:state.audit.id,audit_date:state.audit.audit_date||tashkentToday(),audit:state.audit,current_visit:state.visit,current_step:state.step,pendingSubmit:!!state.offlinePendingSubmit,offlineCreate:state.audit._offlineCreate||null,timings:state.offlineTimings||{},dirty:true,ts:Date.now()};\n}\nasync function restoreLocalAudit(id){\n  let rec=await offlineGet(id);\n  if(!rec){try{const old=JSON.parse(localStorage.getItem(draftStorageKey(id))||'null');if(old)rec={id,audit:{id,status:'draft',answers:old.answers||[],visits:old.visits||[],current_visit:old.current_visit||0,current_step:old.current_step||0,audit_date:tashkentToday()},current_visit:old.current_visit||0,current_step:old.current_step||0,ts:old.ts}}catch{}}\n  if(!rec)return null;\n  const recDate=rec.audit_date||rec.audit?.audit_date||'';\n  if(recDate&&recDate!==tashkentToday()){await offlineDelete(id);localStorage.removeItem(draftStorageKey(id));return null}\n  return rec;\n}\nasync function ensureRemoteAudit(){\n  if(!state.audit||!isLocalAuditId(state.audit.id))return state.audit?.id;\n  if(!navigator.onLine)throw new Error('Нет подключения к интернету');\n  const oldId=state.audit.id;\n  const payload=state.audit._offlineCreate||{};\n  const created=await api('/audits',{method:'POST',body:JSON.stringify(payload),timeout:18000});\n  const remoteId=created.id;\n  state.audit.id=remoteId;delete state.audit._offlineCreate;state.offlineLocalAudit=false;\n  localStorage.removeItem(draftStorageKey(oldId));await offlineDelete(oldId);\n  state.audits=asArray(state.audits,'audits').map(a=>a.id===oldId?{...a,id:remoteId}:a);\n  localStorage.setItem('sle_audits_cache',JSON.stringify(state.audits));\n  persistDraft();\n  return remoteId;\n}\nasync function syncOfflineSnapshot(){\n  if(!state.audit||!navigator.onLine||state.offlineSyncing)return;\n  state.offlineSyncing=true;updateOfflineBanner();\n  try{\n    await ensureRemoteAudit();\n    const qByVisit=new Map();\n    for(const a of asArray(state.audit.answers,'answers')){if(!qByVisit.has(a.visit_number))qByVisit.set(a.visit_number,[]);qByVisit.get(a.visit_number).push({visit_number:a.visit_number,question_key:a.question_key,answer_value:a.answer_value,comment:a.comment??null})}\n    for(const visit of asArray(state.audit.visits,'visits')){\n      const answers=qByVisit.get(visit.visit_number)||[];\n      const visitPayload={shop_code:visit.shop_code||null,goal:visit.goal||null,comment:visit.comment||null,latitude:visit.latitude??null,longitude:visit.longitude??null,gps_accuracy:visit.gps_accuracy??null};\n      if(answers.length||Object.values(visitPayload).some(v=>v!==null&&v!=='')){\n        await api(`/audits/${state.audit.id}/sync`,{method:'PUT',body:JSON.stringify({answers,visit_number:visit.visit_number,visit:visitPayload,current_visit:state.visit,current_step:state.step}),timeout:20000});\n      }\n      const timing=state.offlineTimings?.[visit.visit_number];\n      if(timing?.started_at||timing?.ended_at){await api(`/extras/audit/${state.audit.id}/visit/${visit.visit_number}/offline-timing`,{method:'PUT',body:JSON.stringify(timing),timeout:15000})}\n    }\n    await api(`/audits/${state.audit.id}/sync`,{method:'PUT',body:JSON.stringify({answers:[],current_visit:state.visit,current_step:state.step}),timeout:18000});\n    state.pendingAnswers.clear();state.pendingVisit={};pendingSyncExtra={};\n    if(state.offlinePendingSubmit){\n      const r=await api(`/audits/${state.audit.id}/submit`,{method:'POST',timeout:20000});\n      state.audit={...state.audit,...r,status:'completed'};state.offlinePendingSubmit=false;\n      localStorage.removeItem(draftStorageKey(state.audit.id));await offlineDelete(state.audit.id);\n      if(document.querySelector('#app'))renderResult(state.audit);\n    }else{persistDraft();setSaving('Все данные отправлены')}\n  }finally{state.offlineSyncing=false;updateOfflineBanner();updateNextState()}\n}\nfunction markVisitTiming(kind,visitNumber){\n  if(!visitNumber)return;\n  state.offlineTimings=state.offlineTimings||{};const t=state.offlineTimings[visitNumber]||(state.offlineTimings[visitNumber]={});\n  const now=new Date().toISOString();if(kind==='start'&&!t.started_at)t.started_at=now;if(kind==='end')t.ended_at=now;persistDraft();\n}\n

function requiresAnswerComment(questionKey){
  return questionKey==='analysis_2';
}
function answerCommentIsValid(questionKey,comment){
  return !requiresAnswerComment(questionKey)||String(comment||'').trim().length>0;
}
async function getEmployees(regionId,{force=false}={}){
  const cacheKey='sle_employees_'+regionId;
  if(!force&&state.employees.has(regionId))return state.employees.get(regionId);
  if(!force){
    try{
      const cached=JSON.parse(localStorage.getItem(cacheKey)||'null');
      if(Array.isArray(cached)){
        state.employees.set(regionId,cached);
        // Фоновое обновление: старый список показывается сразу, но ID актуализируются с сервера.
        api('/audits/employees?region_id='+encodeURIComponent(regionId),{force:true}).then(list=>{
          state.employees.set(regionId,list);
          localStorage.setItem(cacheKey,JSON.stringify(list));
        }).catch(()=>{});
        return cached;
      }
    }catch{}
  }
  const list=await api('/audits/employees?region_id='+encodeURIComponent(regionId),{force:true});
  state.employees.set(regionId,list);
  localStorage.setItem(cacheKey,JSON.stringify(list));
  return list;
}
function clearEmployeeCache(regionId){
  state.employees.delete(regionId);
  localStorage.removeItem('sle_employees_'+regionId);
}
let createAuditRequestBusy=false;
async function newAuditForm(){
  // Список регионов всегда обновляем с сервера. Это предотвращает ситуацию,
  // когда после входа под другой роль в localStorage остаётся только один регион.
  let regions=[];
  try{
    regions=await api('/audits/regions',{force:true});
    state.regions=regions;
    localStorage.setItem('sle_regions',JSON.stringify(regions));
  }catch(e){
    try{regions=JSON.parse(localStorage.getItem('sle_regions')||'[]')}catch{}
    if(!regions.length)return toast(e.message);
  }
  const fixed=state.me.role==='leader';
  if(fixed&&regions.length!==1)return toast('Для руководителя должен быть назначен один регион');
  let employees=[];if(fixed){try{employees=await getEmployees(regions[0].id,{force:true})}catch{try{employees=JSON.parse(localStorage.getItem('sle_employees_'+regions[0].id)||'[]')}catch{employees=[]}}}
  shell(`<div class="card accent"><h1>Новый аудит</h1><form id="createAudit"><div class="grid two audit-create-grid"><div class="field"><label>Дата</label><input type="date" name="audit_date" value="${tashkentToday()}" readonly aria-readonly="true"></div><div class="field"><label>Регион</label>${fixed?`<input value="${esc(regions[0].name)}" disabled><input type="hidden" name="region_id" value="${regions[0].id}">`:`<select name="region_id" id="region" required><option value="">Выберите регион</option>${regions.map(r=>`<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select>`}</div><div class="field span-2"><label>Сотрудник</label><select name="employee_id" id="employee" required><option value="">Выберите сотрудника</option>${employees.map(x=>`<option value="${x.id}">${esc(x.full_name)}</option>`).join('')}</select></div></div><div class="actions top-gap"><button type="button" class="btn secondary" id="back">Назад</button><button class="btn primary">Создать аудит</button></div></form></div>`);
  $('#back').onclick=home;
  async function refreshEmployees(){const region=$('#region')?.value||regions[0]?.id||'';const list=region?await getEmployees(region):[];$('#employee').innerHTML='<option value="">Выберите сотрудника</option>'+list.map(x=>`<option value="${x.id}">${esc(x.full_name)}</option>`).join('')}
  $('#region')?.addEventListener('change',refreshEmployees);
  $('#createAudit').onsubmit=async e=>{
    e.preventDefault();
    e.stopPropagation();
    const form=e.target;
    if(createAuditRequestBusy||form.dataset.submitting==='1')return;
    createAuditRequestBusy=true;form.dataset.submitting='1';
    const p=Object.fromEntries(new FormData(form));
    const submit=form.querySelector('button[type="submit"],button:not([type])');
    const back=$('#back');
    if(submit){submit.disabled=true;submit.textContent='Создание…'}
    if(back)back.disabled=true;
    try{
      if(!navigator.onLine){
        const region=regions.find(r=>r.id===p.region_id);
        let list=state.employees.get(p.region_id)||[];
        if(!list.length){try{list=JSON.parse(localStorage.getItem('sle_employees_'+p.region_id)||'[]')}catch{}}
        const employee=list.find(x=>x.id===p.employee_id);
        if(!employee)throw new Error('Для начала аудита офлайн сначала откройте этот регион при наличии интернета, чтобы сохранить список сотрудников.');
        state.questions=cachedQuestions();if(!state.questions.length)throw new Error('Опросник ещё не сохранён на устройстве. Один раз откройте аудит при наличии интернета.');
        state.audit=makeLocalAudit(p,employee,region);state.visit=0;state.step=0;state.offlineLocalAudit=true;state.offlinePendingSubmit=false;state.offlineTimings={};
        state.audits=[{id:state.audit.id,audit_date:state.audit.audit_date,status:'draft',employee_name:state.audit.employee_name,region_name:state.audit.region_name,auditor_name:state.me?.full_name,total_percent:null,is_mine:true},...asArray(state.audits,'audits')];
        localStorage.setItem('sle_audits_cache',JSON.stringify(state.audits));persistDraft();renderWizard();toast('Аудит создан офлайн');
      }else{
        const d=await api('/audits',{method:'POST',body:JSON.stringify(p)});
        if(!d?.id)throw new Error('Сервер не вернул ID созданного аудита');
        await openAudit(d.id);
      }
    }catch(err){
      // На телефоне мог сохраниться старый employee_id после удаления/пересоздания сотрудника.
      if(/Сотрудник не найден/i.test(err.message||'')){
        clearEmployeeCache(p.region_id);
        const fresh=await getEmployees(p.region_id,{force:true}).catch(()=>[]);
        const selectedText=$('#employee')?.selectedOptions?.[0]?.textContent?.trim()||'';
        const replacement=fresh.find(x=>x.full_name===selectedText||x.name===selectedText);
        $('#employee').innerHTML='<option value="">Выберите сотрудника</option>'+fresh.map(x=>`<option value="${x.id}" data-leader="${x.leader_id||''}">${esc(x.full_name||x.name)}</option>`).join('');
        if(replacement){
          $('#employee').value=replacement.id;
          toast('Список сотрудников обновлён. Нажмите «Создать аудит» ещё раз.');
        }else{
          toast('Список сотрудников обновлён. Выберите сотрудника повторно.');
        }
      }else toast(err.message);
    }finally{
      createAuditRequestBusy=false;delete form.dataset.submitting;
      if(document.body.contains(form)){if(submit){submit.disabled=false;submit.textContent='Создать аудит'}if(back)back.disabled=false}
    }
  };
}
async function openAudit(id){
  try{
    state.questions=await api('/audits/questionnaire',{force:true});localStorage.setItem('sle_questions',JSON.stringify(state.questions));
    state.audit=await api('/audits/'+id,{force:true});
    state.offlineLocalAudit=false;state.offlinePendingSubmit=false;state.offlineTimings={};
  }catch(e){
    const rec=(typeof restoreLocalAudit==='function')?await restoreLocalAudit(id):null;
    if(rec){
      state.questions=cachedQuestions();state.audit=rec.audit;state.visit=rec.current_visit??rec.audit?.current_visit??0;state.step=rec.current_step??rec.audit?.current_step??0;
      state.offlineLocalAudit=isLocalAuditId(state.audit.id);state.offlinePendingSubmit=!!rec.pendingSubmit;state.offlineTimings=rec.timings||{};
      state.pendingAnswers=new Map(asArray(state.audit.answers,'answers').map(a=>[`${a.visit_number}:${a.question_key}`,a]));state.pendingVisit={};
      if(state.offlinePendingSubmit&&navigator.onLine)syncOfflineSnapshot().catch(err=>toast(err.message));
      if(state.audit.status==='completed')return renderResult(state.audit);renderWizard();return;
    }
    if(/прошлого дня|не найден/i.test(e.message)){localStorage.removeItem('sle_draft_'+id);await offlineDelete(id);state.audits=state.audits.filter(a=>a.id!==id);localStorage.setItem('sle_audits_cache',JSON.stringify(state.audits));toast(e.message);return home()}
    toast(e.message);return;
  }
  if(state.audit.status==='completed')return renderResult(state.audit);
  let rec=null;
  try{rec=(typeof restoreLocalAudit==='function')?await restoreLocalAudit(id):null}catch(err){console.warn('Offline restore skipped',err)}
  if(rec?.dirty){state.audit={...state.audit,answers:rec.audit?.answers||state.audit.answers,visits:rec.audit?.visits||state.audit.visits};state.offlineTimings=rec.timings||{};state.pendingAnswers=new Map(asArray(state.audit.answers,'answers').map(a=>[`${a.visit_number}:${a.question_key}`,a]));}
  state.visit=rec?.current_visit??state.audit.current_visit??0;state.step=rec?.current_step??state.audit.current_step??0;renderWizard();
  if(rec?.dirty&&navigator.onLine)syncOfflineSnapshot().catch(err=>toast(err.message));
}
function answersMap(){const m={};for(const a of state.audit.answers)m[`${a.visit_number}:${a.question_key}`]=a;return m}
function stepMeta(){if(state.step===0)return{title:'Общая информация',sub:'Заполняется один раз',screen:1};if(state.step===8)return{title:'Завершение дня',sub:'После пяти завершённых визитов',screen:37};return{title:['','Шаг №1 Подготовка','Шаг №2 Представление','Шаг №3 Осмотр','Шаг №4 Предложение','Шаг №5 Работа в точке','Шаг №6 Завершение визита','Шаг №7 Анализ визита'][state.step],sub:`Визит ${state.visit} из 5 · Шаг ${state.step} из 7`,screen:1+(state.visit-1)*7+state.step}}
function renderWizardBase(){
  const meta=stepMeta(),pct=Math.round(meta.screen/37*100),map=answersMap();let body='';
  if(state.step===0)body=questionCards(state.questions.filter(q=>q.step===0),0,map);
  else if(state.step===8)body=questionCards(state.questions.filter(q=>q.step===8),0,map)+visitCheck();
  else{
    const visit=state.audit.visits.find(v=>v.visit_number===state.visit);
    if(state.step===1){body=`<div class="card"><h2>Торговая точка</h2><div class="field"><label>Код торговой точки / код ТТ</label><input id="shopCode" value="${esc(visit?.shop_code||'')}" placeholder="Введите код ТТ"></div><div class="field top-gap"><label>Цель визита и комментарий</label><textarea id="visitGoal" placeholder="Укажите цель визита">${esc(visit?.goal||'')}</textarea></div></div><div class="card"><h2>📍 Местоположение</h2><p class="muted">${visit?.latitude!=null&&visit?.longitude!=null?`GPS сохранён: ${Number(visit.latitude).toFixed(6)}, ${Number(visit.longitude).toFixed(6)} · точность ${Math.round(visit.gps_accuracy||0)} м`:'Для каждого визита необходимо определить GPS-координаты торговой точки.'}</p><button type="button" class="btn primary full" id="gps">${visit?.latitude!=null?'Обновить местоположение':'Определить местоположение'}</button></div>`+questionCards(state.questions.filter(q=>q.step===1),state.visit,map)}
    else body=questionCards(state.questions.filter(q=>q.step===state.step),state.visit,map);
    if(state.step===7)body+=`<div class="card"><h2>Комментарий</h2><div class="field"><label>Комментарий и рекомендации</label><textarea id="visitComment">${esc(visit?.comment||'')}</textarea></div></div>`;
  }
  shell(`<div class="card"><strong>${esc(meta.title)}</strong><div class="muted">${esc(meta.sub)} · Экран ${meta.screen} из 37</div><div class="progress-wrap"><div class="progress" style="width:${pct}%"></div></div></div><div class="card accent"><h1>${esc(meta.title)}</h1><p class="muted">${esc(meta.sub)}</p></div>${body}<div class="save-state" id="saveState">Все изменения сохраняются автоматически</div><div class="bottom"><span class="actions"><button class="btn secondary" id="prev">Назад</button><button class="btn primary" id="next" disabled>${state.step===8?'Отправить':'Далее'}</button></span></div>`);bindWizard();
}
function questionCards(qs,visit,map){let out='',last='';for(const q of qs){if(q.section!==last){if(last)out+='</div>';out+=`<div class="card"><h2>${esc(q.section)}</h2>`;last=q.section}const a=map[`${visit}:${q.key}`];const allowNA=['Работа с возражениями','Обучение персонала'].includes(q.section);out+=`<div class="question" data-key="${q.key}" data-visit="${visit}"><div class="question-title">${esc(q.text)} *</div><div class="answers ${allowNA?'three-options':'two-options'}"><button class="answer ${a?.answer_value==='1'?'selected':''}" data-value="1">1 — выполнено</button><button class="answer ${a?.answer_value==='0'?'selected':''}" data-value="0">0 — не выполнено</button>${allowNA?`<button class="answer ${a?.answer_value==='NA'?'selected':''}" data-value="NA">N/A — не применимо</button>`:''}</div></div>`}if(last)out+='</div>';return out}
function visitCheck(){return`<div class="card"><h2>Проверка</h2>${state.audit.visits.map(v=>`<div class="visit-row"><span>Визит ${v.visit_number}: ${esc(v.shop_code||'—')}</span><span>${v.latitude!=null&&v.longitude!=null?esc(v.latitude+', '+v.longitude):'Координаты не указаны'}</span></div>`).join('')}</div>`}

function updateNextStateBase(){
  const b=$('#next');
  if(!b)return;
  const cooldownLeft=Math.max(0,(state.navigationCooldownUntil||0)-Date.now());
  const saved=!navigator.onLine||(!state.syncing&&!state.pendingAnswers.size&&!Object.keys(state.pendingVisit).length);updateOfflineBanner();
  b.disabled=!!state.navigationBusy||cooldownLeft>0||!(saved&&currentComplete());
  b.setAttribute('aria-busy',state.navigationBusy?'true':'false');
  if(state.navigationCooldownTimer){clearTimeout(state.navigationCooldownTimer);state.navigationCooldownTimer=null}
  if(cooldownLeft>0){state.navigationCooldownTimer=setTimeout(()=>{state.navigationCooldownTimer=null;updateNextState()},cooldownLeft+30)}
}
function setSaving(t){const s=$('#saveState');if(s)s.textContent=t;updateNextState()}
let syncDrainPromise=null;
let pendingSyncExtra={};

function updateLocalAnswer(visit,key,value){
  let found=state.audit.answers.find(a=>a.visit_number===visit&&a.question_key===key);
  if(found){found.answer_value=value;found.comment=null}
  else{found={visit_number:visit,question_key:key,answer_value:value,comment:null};state.audit.answers.push(found)}
  state.pendingAnswers.set(`${visit}:${key}`,found);
  persistDraft();
  scheduleSync(650);
  updateNextState();
}

function draftRecord(){
  if(!state.audit)return null;
  return {
    id: state.audit.id,
    audit: state.audit,
    current_visit: state.visit || state.audit.current_visit || 0,
    current_step: state.step || state.audit.current_step || 0,
    audit_date: state.audit.audit_date || tashkentToday(),
    timings: state.offlineTimings || {},
    pendingSubmit: !!state.offlinePendingSubmit,
    dirty: true,
    ts: Date.now()
  };
}

function persistDraft(){
  if(!state.audit)return;
  const record=draftRecord();
  localStorage.setItem(draftStorageKey(state.audit.id),JSON.stringify({answers:state.audit.answers,visits:state.audit.visits,current_visit:state.visit,current_step:state.step,ts:Date.now(),audit_date:state.audit.audit_date,pendingSubmit:state.offlinePendingSubmit,timings:state.offlineTimings}));
  offlinePut(record).catch(()=>{});updateOfflineBanner();
}
function scheduleSync(delay=900){
  if(!navigator.onLine){persistDraft();setSaving('Офлайн — изменения сохранены на устройстве');return}
  setSaving('Сохранение…');
  clearTimeout(state.syncTimer);
  state.syncTimer=setTimeout(()=>flushSync().catch(e=>{setSaving('Ошибка сохранения');toast(e.message)}),delay);
}
async function flushSync(extra={}){
  clearTimeout(state.syncTimer);
  if(extra&&extra.constructor===Object)Object.assign(pendingSyncExtra,extra);

  // Один общий drain на весь опросник. Если flushSync вызвали несколько обработчиков
  // одновременно, они ждут один и тот же Promise — параллельных PUT /sync не будет.
  if(syncDrainPromise)return syncDrainPromise;

  syncDrainPromise=(async()=>{
    if(isLocalAuditId(state.audit?.id)){await syncOfflineSnapshot();return}
    while(true){
      if(!navigator.onLine){setSaving('Нет сети — изменения сохранены на устройстве');return}

      const answers=[...state.pendingAnswers.values()].map(a=>({
        visit_number:a.visit_number,question_key:a.question_key,answer_value:a.answer_value,comment:null
      }));
      const visitPayload=Object.keys(state.pendingVisit||{}).length?{...state.pendingVisit}:null;
      const extraPayload={...pendingSyncExtra};
      pendingSyncExtra={};

      if(!answers.length&&!visitPayload&&!Object.keys(extraPayload).length){setSaving('Сохранено');return}

      const payload={answers,current_visit:state.visit,current_step:state.step,...extraPayload};
      if(visitPayload&&state.visit){payload.visit_number=state.visit;payload.visit=visitPayload}

      const sentAnswers=new Map(answers.map(a=>[`${a.visit_number}:${a.question_key}`,a.answer_value]));
      state.syncing=api(`/audits/${state.audit.id}/sync`,{method:'PUT',body:JSON.stringify(payload),timeout:18000});
      try{
        await state.syncing;
        for(const [key,value] of sentAnswers){
          const current=state.pendingAnswers.get(key);
          if(current&&current.answer_value===value)state.pendingAnswers.delete(key);
        }
        if(visitPayload){
          for(const [key,value] of Object.entries(visitPayload)){
            if(state.pendingVisit[key]===value)delete state.pendingVisit[key];
          }
        }
        setSaving('Сохранено');
      }finally{
        state.syncing=null;
        updateNextState();
      }
      // Цикл повторится только если во время запроса пользователь успел внести
      // новые изменения. Они уйдут следующим, единственным запросом.
    }
  })().finally(()=>{syncDrainPromise=null;updateNextState()});

  return syncDrainPromise;
}

function bindWizard(){
  updateNextState();
  if(state.visit&&state.step===1){markVisitTiming('start',state.visit);if(navigator.onLine&&!isLocalAuditId(state.audit.id))api(`/extras/audit/${state.audit.id}/visit/${state.visit}/start`,{method:'POST'}).catch(()=>{})}
  $$('.answer').forEach(b=>b.onclick=()=>{const card=b.closest('.question');updateLocalAnswer(Number(card.dataset.visit),card.dataset.key,b.dataset.value);$$('.answer',card).forEach(x=>x.classList.toggle('selected',x===b))});
  $('#shopCode')?.addEventListener('input',e=>{const normalized=normalizeShopCode(e.target.value);if(e.target.value!==normalized)e.target.value=normalized;saveVisitFields()});
  $('#gps')?.addEventListener('click',captureGps);
  $('#visitComment')?.addEventListener('input',saveVisitFields);
  $('#visitGoal')?.addEventListener('input',saveVisitFields);
  const prev=$('#prev'),next=$('#next');
  if(prev)prev.onclick=e=>{e.preventDefault();if(state.navigationBusy||Date.now()<(state.navigationCooldownUntil||0))return;prevStep()};
  if(next)next.onclick=e=>{e.preventDefault();e.stopPropagation();if(next.disabled||state.navigationBusy||Date.now()<(state.navigationCooldownUntil||0))return;nextStep()};
}
function saveVisitFields(extra={}){if(!state.visit||!state.audit)return;const visits=Array.isArray(state.audit.visits)?state.audit.visits:(state.audit.visits=[]);let visit=visits.find(v=>v&&v.visit_number===state.visit);if(!visit){visit={visit_number:state.visit,shop_code:'',goal:'',comment:'',latitude:null,longitude:null,gps_accuracy:null};visits.push(visit)}const payload={};if($('#shopCode'))payload.shop_code=normalizeShopCode($('#shopCode').value);if($('#visitGoal'))payload.goal=$('#visitGoal').value.trim();if($('#visitComment'))payload.comment=$('#visitComment').value;if(extra&&extra.constructor===Object)Object.assign(payload,extra);if(!state.pendingVisit||typeof state.pendingVisit!=='object')state.pendingVisit={};Object.assign(visit,payload);Object.assign(state.pendingVisit,payload);persistDraft();scheduleSync(1200);updateNextState()}
function captureGps(){if(!navigator.geolocation)return toast('Геолокация не поддерживается на этом устройстве');const btn=$('#gps');if(btn){btn.disabled=true;btn.textContent='Определение местоположения…'}navigator.geolocation.getCurrentPosition(async p=>{try{saveVisitFields({latitude:p.coords.latitude,longitude:p.coords.longitude,gps_accuracy:p.coords.accuracy});await flushSync();toast('GPS-координаты сохранены');renderWizard()}catch(e){toast(e.message)}},e=>{if(btn){btn.disabled=false;btn.textContent='Определить местоположение'};const messages={1:'Доступ к геолокации запрещён',2:'Местоположение недоступно',3:'Превышено время ожидания GPS'};toast(messages[e.code]||('Не удалось определить местоположение: '+e.message))},{enableHighAccuracy:true,timeout:25000,maximumAge:0})}
function currentComplete(){const map=answersMap(),qs=state.questions.filter(q=>q.step===state.step),visit=[0,8].includes(state.step)?0:state.visit;if(qs.some(q=>!map[`${visit}:${q.key}`]))return false;if(state.step===1){const v=state.audit.visits.find(x=>x.visit_number===state.visit);if(!v.shop_code||!v.goal||v.latitude==null||v.longitude==null)return false}return true}
async function saveProgress(){await flushSync({current_visit:state.visit,current_step:state.step})}
async function nextStep(){
  if(state.navigationBusy||Date.now()<(state.navigationCooldownUntil||0))return;
  const button=$('#next');
  if(button?.disabled)return;
  state.navigationBusy=true;
  if(button){button.disabled=true;button.setAttribute('aria-busy','true')}
  const fromVisit=state.visit,fromStep=state.step;
  try{
    if(!currentComplete())throw new Error('Заполните код ТТ, цель визита, определите GPS и ответьте на все вопросы');
    if(fromStep===8){
      persistDraft();
      if(!navigator.onLine){state.offlinePendingSubmit=true;persistDraft();setSaving('Офлайн — аудит ожидает отправки');return renderOfflinePendingResult()}
      await flushSync();
      try{
        const r=await api(`/audits/${state.audit.id}/submit`,{method:'POST'});
        state.audit={...state.audit,...r,status:'completed'};
        return renderResult(state.audit);
      }catch(err){
        try{state.audit=await api('/audits/'+state.audit.id)}catch{}
        throw err;
      }
    }

    // Переход вычисляется строго из снимка текущего экрана. Даже если пользователь
    // нажал несколько раз, состояние изменится только один раз.
    let nextVisit=fromVisit,nextStepValue=fromStep;
    if(fromStep===0){nextVisit=1;nextStepValue=1}
    else if(fromStep<7)nextStepValue=fromStep+1;
    else if(fromVisit<5){
      markVisitTiming('end',fromVisit);if(navigator.onLine&&!isLocalAuditId(state.audit.id))await api(`/extras/audit/${state.audit.id}/visit/${fromVisit}/end`,{method:'POST'}).catch(()=>{});
      nextVisit=fromVisit+1;nextStepValue=1;
    }else{
      markVisitTiming('end',fromVisit);if(navigator.onLine&&!isLocalAuditId(state.audit.id))await api(`/extras/audit/${state.audit.id}/visit/${fromVisit}/end`,{method:'POST'}).catch(()=>{});
      nextVisit=0;nextStepValue=8;
    }
    state.visit=nextVisit;
    state.step=nextStepValue;persistDraft();
    if(navigator.onLine)await saveProgress();else setSaving('Офлайн — шаг сохранён на устройстве');
    renderWizard();
  }catch(e){toast(e.message)}
  finally{
    state.navigationBusy=false;
    // Защита от двойного тапа и отложенного мобильного click после перерисовки.
    state.navigationCooldownUntil=Date.now()+900;
    updateNextState();
  }
}
async function prevStep(){
  if(state.navigationBusy||Date.now()<(state.navigationCooldownUntil||0))return;
  state.navigationBusy=true;
  const prev=$('#prev'),next=$('#next');
  if(prev)prev.disabled=true;if(next)next.disabled=true;
  try{
    if(state.step===0)return home();
    if(state.step===8){state.visit=5;state.step=7}
    else if(state.step>1)state.step--;
    else if(state.visit>1){state.visit--;state.step=7}
    else{state.visit=0;state.step=0}
    persistDraft();if(navigator.onLine)await saveProgress();else setSaving('Офлайн — шаг сохранён на устройстве');
    renderWizard();
  }catch(e){toast(e.message)}
  finally{
    state.navigationBusy=false;
    state.navigationCooldownUntil=Date.now()+500;
    updateNextState();
  }
}
if(!window.__sleAuditOnlineSyncBound){
  window.__sleAuditOnlineSyncBound=true;
  window.addEventListener('online',()=>{updateOfflineBanner();syncStoredOfflineDrafts();if(state.audit)syncOfflineSnapshot().catch(e=>{setSaving('Ошибка синхронизации');toast(e.message)})});
  window.addEventListener('offline',()=>{persistDraft();updateOfflineBanner()});
}
function renderOfflinePendingResult(){shell(`<div class="card accent result"><div class="saved">📴 Аудит сохранён на устройстве</div><h1>Ожидает отправки</h1><p class="muted">Когда интернет появится, данные автоматически отправятся на сервер и аудит завершится.</p><button class="btn primary" id="toHome">На главную</button></div>`);$('#toHome').onclick=home;updateOfflineBanner()}

function renderResult(a){shell(`<div class="card accent result"><div class="saved">✅ Результаты сохранены</div><div class="score">${Math.round(a.total_percent||0)}%</div><h1>${esc(a.level||'')}</h1><p class="muted">${esc(a.employee_name||'')}</p><button class="btn primary" id="toHome">На главную</button></div>`);$('#toHome').onclick=home}


function ensureRequiredAnalysisComment(){
  if(state.step!==7||!state.visit)return;
  const qKey='analysis_2';
  const card =
    document.querySelector(`[data-question-key="${qKey}"]`) ||
    document.querySelector(`[data-key="${qKey}"]`) ||
    [...document.querySelectorAll('.question-card,.question,.card')].find(el=>
      (el.textContent||'').includes('Определяет, что помогло и что помешало достижению целей — навыки')
    );
  if(!card)return;

  let box=card.querySelector('[data-required-comment="analysis_2"]');
  if(!box){
    const wrap=document.createElement('div');
    wrap.className='field top-gap required-analysis-comment';
    wrap.dataset.requiredComment='analysis_2';
    wrap.innerHTML='<label>Комментарий <span class="required-mark">*</span></label><textarea rows="3" placeholder="Обязательно укажите, что помогло и что помешало достижению целей"></textarea><small class="muted">Обязательное поле</small>';
    card.appendChild(wrap);
    box=wrap;
  }

  const ta=box.querySelector('textarea');
  const existing=asArray(state.audit?.answers,'answers').find(a=>a.visit_number===state.visit&&a.question_key===qKey);
  if(document.activeElement!==ta)ta.value=existing?.comment||'';

  if(!ta.dataset.bound){
    ta.dataset.bound='1';
    ta.addEventListener('input',()=>{
      const answer=asArray(state.audit?.answers,'answers').find(a=>a.visit_number===state.visit&&a.question_key===qKey);
      if(answer){
        answer.comment=ta.value;
        state.pendingAnswers.set(`${state.visit}:${qKey}`,answer);
      }else{
        const placeholder={visit_number:state.visit,question_key:qKey,answer_value:null,comment:ta.value};
        state.audit.answers=asArray(state.audit.answers,'answers');
        state.audit.answers.push(placeholder);
        state.pendingAnswers.set(`${state.visit}:${qKey}`,placeholder);
      }
      persistDraft();
      updateNextState();
    });
    ta.addEventListener('change',()=>{if(typeof scheduleFlush==='function')scheduleFlush();});
  }
}


const _renderWizardV642=renderWizardBase;
function renderWizard(){
  _renderWizardV642();
  queueMicrotask(()=>{ensureRequiredAnalysisComment();updateNextState();});
}

const _updateNextStateV642=updateNextStateBase;
function updateNextState(){
  _updateNextStateV642();
  if(state.step===7&&state.visit){
    const qKey='analysis_2';
    const a=asArray(state.audit?.answers,'answers').find(x=>x.visit_number===state.visit&&x.question_key===qKey);
    const next=document.querySelector('#next,.next-btn,[data-action="next"]');
    if(next && a && a.answer_value!=null && !answerCommentIsValid(qKey,a.comment)){
      next.disabled=true;
      next.title='Заполните обязательный комментарий';
    }
  }
}
