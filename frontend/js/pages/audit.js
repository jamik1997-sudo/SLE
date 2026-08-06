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
  let employees=[];if(fixed)employees=await getEmployees(regions[0].id,{force:true});
  shell(`<div class="card accent"><h1>Новый аудит</h1><form id="createAudit"><div class="grid two audit-create-grid"><div class="field"><label>Дата</label><input type="date" name="audit_date" value="${tashkentToday()}" readonly aria-readonly="true"></div><div class="field"><label>Регион</label>${fixed?`<input value="${esc(regions[0].name)}" disabled><input type="hidden" name="region_id" value="${regions[0].id}">`:`<select name="region_id" id="region" required><option value="">Выберите регион</option>${regions.map(r=>`<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select>`}</div><div class="field span-2"><label>Сотрудник</label><select name="employee_id" id="employee" required><option value="">Выберите сотрудника</option>${employees.map(x=>`<option value="${x.id}">${esc(x.full_name)}</option>`).join('')}</select></div></div><div class="actions top-gap"><button type="button" class="btn secondary" id="back">Назад</button><button class="btn primary">Создать аудит</button></div></form></div>`);
  $('#back').onclick=home;
  async function refreshEmployees(){const region=$('#region')?.value||regions[0]?.id||'';const list=region?await getEmployees(region):[];$('#employee').innerHTML='<option value="">Выберите сотрудника</option>'+list.map(x=>`<option value="${x.id}">${esc(x.full_name)}</option>`).join('')}
  $('#region')?.addEventListener('change',refreshEmployees);
  $('#createAudit').onsubmit=async e=>{
    e.preventDefault();
    const form=e.target;
    const p=Object.fromEntries(new FormData(form));
    const submit=form.querySelector('button[type="submit"],button:not([type])');
    if(submit)submit.disabled=true;
    try{
      const d=await api('/audits',{method:'POST',body:JSON.stringify(p)});
      openAudit(d.id);
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
    }finally{if(submit)submit.disabled=false}
  };
}
async function openAudit(id){try{state.questions=await api('/audits/questionnaire',{force:true});localStorage.setItem('sle_questions',JSON.stringify(state.questions));state.audit=await api('/audits/'+id,{force:true});if(state.audit.status==='completed')return renderResult(state.audit);state.visit=state.audit.current_visit||0;state.step=state.audit.current_step||0;renderWizard()}catch(e){if(/прошлого дня|не найден/i.test(e.message)){localStorage.removeItem('sle_draft_'+id);state.audits=state.audits.filter(a=>a.id!==id);localStorage.setItem('sle_audits_cache',JSON.stringify(state.audits));toast(e.message);return home()}toast(e.message)}}
function answersMap(){const m={};for(const a of state.audit.answers)m[`${a.visit_number}:${a.question_key}`]=a;return m}
function stepMeta(){if(state.step===0)return{title:'Общая информация',sub:'Заполняется один раз',screen:1};if(state.step===8)return{title:'Завершение дня',sub:'После пяти завершённых визитов',screen:37};return{title:['','Шаг №1 Подготовка','Шаг №2 Представление','Шаг №3 Осмотр','Шаг №4 Предложение','Шаг №5 Работа в точке','Шаг №6 Завершение визита','Шаг №7 Анализ визита'][state.step],sub:`Визит ${state.visit} из 5 · Шаг ${state.step} из 7`,screen:1+(state.visit-1)*7+state.step}}
function renderWizard(){
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
function questionCards(qs,visit,map){let out='',last='';for(const q of qs){if(q.section!==last){if(last)out+='</div>';out+=`<div class="card"><h2>${esc(q.section)}</h2>`;last=q.section}const a=map[`${visit}:${q.key}`];out+=`<div class="question" data-key="${q.key}" data-visit="${visit}"><div class="question-title">${esc(q.text)} *</div><div class="answers two-options"><button class="answer ${a?.answer_value==='1'?'selected':''}" data-value="1">1 — выполнено</button><button class="answer ${a?.answer_value==='0'?'selected':''}" data-value="0">0 — не выполнено</button></div></div>`}if(last)out+='</div>';return out}
function visitCheck(){return`<div class="card"><h2>Проверка</h2>${state.audit.visits.map(v=>`<div class="visit-row"><span>Визит ${v.visit_number}: ${esc(v.shop_code||'—')}</span><span>${v.latitude!=null&&v.longitude!=null?esc(v.latitude+', '+v.longitude):'Координаты не указаны'}</span></div>`).join('')}</div>`}

function updateNextState(){
  const b=$('#next');
  if(!b)return;
  const cooldownLeft=Math.max(0,(state.navigationCooldownUntil||0)-Date.now());
  const saved=!state.syncing&&!state.pendingAnswers.size&&!Object.keys(state.pendingVisit).length;
  b.disabled=!!state.navigationBusy||cooldownLeft>0||!(saved&&currentComplete());
  b.setAttribute('aria-busy',state.navigationBusy?'true':'false');
  if(state.navigationCooldownTimer){clearTimeout(state.navigationCooldownTimer);state.navigationCooldownTimer=null}
  if(cooldownLeft>0){state.navigationCooldownTimer=setTimeout(()=>{state.navigationCooldownTimer=null;updateNextState()},cooldownLeft+30)}
}
function setSaving(t){const s=$('#saveState');if(s)s.textContent=t;updateNextState()}
function updateLocalAnswer(visit,key,value){let found=state.audit.answers.find(a=>a.visit_number===visit&&a.question_key===key);if(found){found.answer_value=value;found.comment=null}else{found={visit_number:visit,question_key:key,answer_value:value,comment:null};state.audit.answers.push(found)}state.pendingAnswers.set(`${visit}:${key}`,found);persistDraft();scheduleSync();updateNextState()}
function persistDraft(){if(state.audit)localStorage.setItem('sle_draft_'+state.audit.id,JSON.stringify({answers:state.audit.answers,visits:state.audit.visits,current_visit:state.visit,current_step:state.step,ts:Date.now()}))}
function scheduleSync(delay=700){setSaving('Сохранение…');clearTimeout(state.syncTimer);state.syncTimer=setTimeout(()=>flushSync().catch(e=>{setSaving('Ошибка сохранения');toast(e.message)}),delay)}
async function flushSync(extra={}){
  clearTimeout(state.syncTimer);

  // Если уже идёт сохранение, ждём его завершения, затем обязательно
  // отправляем всё, что накопилось во время предыдущего запроса.
  if(state.syncing)await state.syncing;

  const answers=[...state.pendingAnswers.values()].map(a=>({
    visit_number:a.visit_number,
    question_key:a.question_key,
    answer_value:a.answer_value,
    comment:null
  }));
  const visitPayload=Object.keys(state.pendingVisit).length?{...state.pendingVisit}:null;

  if(!answers.length&&!visitPayload&&!Object.keys(extra).length){
    setSaving('Сохранено');
    return;
  }

  const payload={answers,current_visit:state.visit,current_step:state.step,...extra};
  if(visitPayload&&state.visit){payload.visit_number=state.visit;payload.visit=visitPayload}

  const sentAnswers=new Map(answers.map(a=>[`${a.visit_number}:${a.question_key}`,a.answer_value]));
  state.syncing=api(`/audits/${state.audit.id}/sync`,{
    method:'PUT',
    body:JSON.stringify(payload)
  }).then(()=>{
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
  }).finally(()=>state.syncing=null);

  await state.syncing;
  updateNextState();

  // Досохраняем изменения, которые появились пока шёл запрос.
  if(state.pendingAnswers.size||Object.keys(state.pendingVisit).length){
    return flushSync();
  }
}
function bindWizard(){
  updateNextState();
  if(state.visit&&state.step===1)api(`/extras/audit/${state.audit.id}/visit/${state.visit}/start`,{method:'POST'}).catch(()=>{});
  $$('.answer').forEach(b=>b.onclick=()=>{const card=b.closest('.question');updateLocalAnswer(Number(card.dataset.visit),card.dataset.key,b.dataset.value);$$('.answer',card).forEach(x=>x.classList.toggle('selected',x===b))});
  $('#shopCode')?.addEventListener('input',saveVisitFields);
  $('#gps')?.addEventListener('click',captureGps);
  $('#visitComment')?.addEventListener('input',saveVisitFields);
  $('#visitGoal')?.addEventListener('input',saveVisitFields);
  const prev=$('#prev'),next=$('#next');
  if(prev)prev.onclick=e=>{e.preventDefault();if(state.navigationBusy||Date.now()<(state.navigationCooldownUntil||0))return;prevStep()};
  if(next)next.onclick=e=>{e.preventDefault();e.stopPropagation();if(next.disabled||state.navigationBusy||Date.now()<(state.navigationCooldownUntil||0))return;nextStep()};
}
function saveVisitFields(extra={}){if(!state.visit||!state.audit)return;const visits=Array.isArray(state.audit.visits)?state.audit.visits:(state.audit.visits=[]);let visit=visits.find(v=>v&&v.visit_number===state.visit);if(!visit){visit={visit_number:state.visit,shop_code:'',goal:'',comment:'',latitude:null,longitude:null,gps_accuracy:null};visits.push(visit)}const payload={};if($('#shopCode'))payload.shop_code=$('#shopCode').value.trim();if($('#visitGoal'))payload.goal=$('#visitGoal').value.trim();if($('#visitComment'))payload.comment=$('#visitComment').value;if(extra&&extra.constructor===Object)Object.assign(payload,extra);if(!state.pendingVisit||typeof state.pendingVisit!=='object')state.pendingVisit={};Object.assign(visit,payload);Object.assign(state.pendingVisit,payload);persistDraft();scheduleSync();updateNextState()}
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
      await api(`/extras/audit/${state.audit.id}/visit/${fromVisit}/end`,{method:'POST'}).catch(()=>{});
      nextVisit=fromVisit+1;nextStepValue=1;
    }else{
      await api(`/extras/audit/${state.audit.id}/visit/${fromVisit}/end`,{method:'POST'}).catch(()=>{});
      nextVisit=0;nextStepValue=8;
    }
    state.visit=nextVisit;
    state.step=nextStepValue;
    await saveProgress();
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
    await saveProgress();
    renderWizard();
  }catch(e){toast(e.message)}
  finally{
    state.navigationBusy=false;
    state.navigationCooldownUntil=Date.now()+500;
    updateNextState();
  }
}
function renderResult(a){shell(`<div class="card accent result"><div class="saved">✅ Результаты сохранены</div><div class="score">${Math.round(a.total_percent||0)}%</div><h1>${esc(a.level||'')}</h1><p class="muted">${esc(a.employee_name||'')}</p><button class="btn primary" id="toHome">На главную</button></div>`);$('#toHome').onclick=home}
