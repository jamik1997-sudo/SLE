
function filterDashboardEvaluatorsByEmployee(allEvaluators,allEmployees,employeeId){
  const evaluators=asArray(allEvaluators,'evaluators');
  if(!employeeId)return evaluators;
  const employee=asArray(allEmployees,'employees').find(x=>String(x.id)===String(employeeId));
  if(!employee)return evaluators;
  const ids=[employee.leader_id,employee.auditor_id,employee.evaluator_id].filter(Boolean).map(String);
  if(!ids.length)return evaluators;
  return evaluators.filter(x=>ids.includes(String(x.id)));
}


function filterDashboardEmployeesByEvaluator(allEmployees,evaluatorId){
  const list=asArray(allEmployees,'employees');
  if(!evaluatorId)return list;
  return list.filter(x=>
    String(x.leader_id||'')===String(evaluatorId) ||
    String(x.auditor_id||'')===String(evaluatorId) ||
    String(x.evaluator_id||'')===String(evaluatorId)
  );
}




async function renderDashboardLevelList(level){
  const filters=currentDashboardFilters();
  const qs=new URLSearchParams();
  if(level)qs.set('level',level);
  Object.entries(filters).forEach(([k,v])=>{if(v)qs.set(k,v)});

  const title=level||'Завершённые визиты';
  loadingPage('dashboard',title);

  let rows;
  try{
    rows=asArray(await api('/audits/dashboard/completed-audits?'+qs.toString(),{force:true}),'audits');
  }catch(e){
    toast(e.message||'Не удалось загрузить завершённые аудиты');
    return dashboard(filters);
  }

  shell(`${mainNav('dashboard')}
    <div class="dashboard-head">
      <div>
        <h1>${esc(title)}</h1>
        <p class="muted">${rows.length} завершённых аудитов</p>
      </div>
      <button class="btn secondary" id="backToDashboard">← Назад</button>
    </div>

    <div class="card">
      <div class="table-wrap">
        <table class="table completed-audits-table">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Сотрудник</th>
              <th>Регион</th>
              <th>Оценивающий</th>
              <th>Статус</th>
              <th>Результат</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length?rows.map(x=>`
              <tr class="clickable" data-open="${x.id}">
                <td><span class="nowrap">${esc(x.audit_date||'—')}</span></td>
                <td><span class="employee-nowrap">${esc(x.employee_name||'—')}</span></td>
                <td>${esc(x.region_name||'—')}</td>
                <td>${esc(x.auditor_name||'—')}</td>
                <td><span class="badge ok">${esc(x.status||'Завершён')}</span></td>
                <td><strong>${x.result!=null?`${x.result}%`:'—'}</strong></td>
              </tr>`).join(''):
              `<tr><td colspan="6" class="muted">Нет завершённых аудитов</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`);

  bindNav();
  $('#backToDashboard').onclick=()=>dashboard(filters);
  $$('[data-open]').forEach(row=>row.onclick=()=>openAudit(row.dataset.open));
}


function legacyVisitField(obj, kind) {
  if (!obj) return "—";
  const goalKeys = ["goal","visit_goal","purpose","visit_purpose","goal_text","purpose_text","target","visit_target"];
  const commentKeys = ["comment","visit_comment","goal_comment","purpose_comment","comment_text","visit_notes","notes"];
  const keys = kind === "goal" ? goalKeys : commentKeys;
  const pick = (src) => {
    if (!src || typeof src !== "object") return "";
    for (const k of keys) {
      const v = src[k];
      if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
    }
    return "";
  };
  let v = pick(obj);
  if (v) return v;
  for (const c of ["data","payload","draft","draft_data","meta","metadata","visit_data","extra"]) {
    let d = obj[c];
    if (typeof d === "string") { try { d = JSON.parse(d); } catch (_) { d = null; } }
    v = pick(d);
    if (v) return v;
    if (d && typeof d.visit === "object") {
      v = pick(d.visit);
      if (v) return v;
    }
  }
  return "—";
}


function reportAuditTable(rows){
  rows=asArray(rows,'audits');
  if(!rows.length)return '<p class="muted">Аудитов пока нет</p>';
  return `<div class="table-wrap"><table class="table"><thead><tr><th>Дата</th><th>Сотрудник</th><th>Регион</th><th>Оценивающий</th><th>Статус</th><th>Результат</th><th>Цель визита</th><th>Комментарий</th></tr></thead><tbody>${rows.map(a=>`<tr data-open="${a.id}" class="clickable"><td>${esc(a.audit_date)}</td><td>${esc(a.employee_name)}</td><td>${esc(a.region_name)}</td><td>${esc(a.auditor_name||'—')}</td><td><span class="badge ${a.status==='completed'?'ok':'warn'}">${statusName(a.status)}</span></td><td>${a.total_percent==null?'—':a.total_percent+'%'}</td><td>${esc(a.visit_goals||'—')}</td><td>${esc(a.visit_comments||'—')}</td></tr>`).join('')}</tbody></table></div>`;
}
async function history(limit=50,{append=false}={}){
  const pageId=beginPage();
  const existing=$('#historyRoot');
  if(!existing)loadingPage('history','Отчёты');
  else existing.classList.add('section-loading');
  let rows;
  try{rows=asArray(await api(`/audits?limit=${limit}`,{force:append}),'audits')}catch(e){existing?.classList.remove('section-loading');return toast(e.message)}
  if(!isCurrentPage(pageId))return;
  state.audits=asArray(rows,'audits');
  if(!existing){
    shell(`${mainNav('history')}<div class="card" id="historyRoot"><div class="section-head"><div><h1>Отчёты</h1><p class="muted" id="historyCount">Показаны последние ${state.audits.length} аудитов</p></div></div><div class="actions"><button class="btn primary" id="exportExcel">Отчет по аудиту</button><button class="btn secondary" id="exportAnswers">Детальный отчет</button><button class="btn secondary" id="loadMoreAudits" ${state.audits.length<limit||limit>=500?'hidden':''}>Показать ещё</button></div><div id="reportTable" class="top-gap">${reportAuditTable(state.audits)}</div></div>`);
    bindNav();
    $('#exportExcel').onclick=()=>downloadExcel('/extras/export/audit-report.xlsx','audit-report.xlsx');
    $('#exportAnswers').onclick=()=>downloadExcel('/extras/export/detailed-report.xlsx','detailed-audit-report.xlsx');
  }else{
    existing.classList.remove('section-loading');
    $('#historyCount').textContent=`Показаны последние ${state.audits.length} аудитов`;
    $('#reportTable').innerHTML=reportAuditTable(state.audits);
    bindNav();
  }
  const more=$('#loadMoreAudits');
  if(more){
    more.hidden=state.audits.length<limit||limit>=500;
    more.disabled=false;
    more.onclick=()=>{more.disabled=true;history(Math.min(500,limit+50),{append:true})};
  }
}

function dashboardBlockName(name){
  return ({
    'Подготовка к визиту':'Подготовка','Вступление':'Представление','Осмотр':'Осмотр',
    'Презентация':'Предложение','Работа с возражениями':'Предложение',
    'Презентация + Работа с возражениями':'Предложение','Работа в точке':'Работа в точке',
    'Обучение персонала':'Работа в точке','Работа в точке + Обучение персонала':'Работа в точке',
    'Завершение визита':'Завершение визита','Анализ визита':'Анализ визита'
  })[name]||name;
}
function statBar(label,value,count){return`<div class="stat-row"><div class="stat-label"><span>${esc(label)}</span><strong>${value}%</strong></div><div class="bar"><i style="width:${Math.max(0,Math.min(100,value))}%"></i></div><small>${count} ауд.</small></div>`}

function dashboardResults(d){
  const maxLevel=Math.max(1,...Object.values(d.levels));
  return `<div class="kpi-grid"><div class="kpi kpi-audits dashboard-level-card" data-dashboard-completed="1" role="button" tabindex="0"><div class="kpi-icon">▣</div><div><span>Завершённые визиты</span><strong>${d.total}</strong><small>в выбранном периоде</small></div></div><div class="kpi kpi-average"><div class="kpi-icon">★</div><div><span>Средний результат</span><strong>${d.average}%</strong><small>по завершённым аудитам</small></div></div><div class="kpi kpi-master dashboard-level-card" data-dashboard-level="Мастер" role="button" tabindex="0"><div class="kpi-icon">♛</div><div><span>Мастер</span><strong>${d.levels['Мастер']||0}</strong><small>${d.total?Math.round((d.levels['Мастер']||0)/d.total*100):0}% от общего числа</small></div></div><div class="kpi kpi-confident dashboard-level-card" data-dashboard-level="Уверенный" role="button" tabindex="0"><div class="kpi-icon">◆</div><div><span>Уверенный</span><strong>${d.levels['Уверенный']||0}</strong><small>${d.total?Math.round((d.levels['Уверенный']||0)/d.total*100):0}% от общего числа</small></div></div><div class="kpi kpi-basic dashboard-level-card" data-dashboard-level="Базовый" role="button" tabindex="0"><div class="kpi-icon">●</div><div><span>Базовый</span><strong>${d.levels['Базовый']||0}</strong><small>${d.total?Math.round((d.levels['Базовый']||0)/d.total*100):0}% от общего числа</small></div></div></div><div class="card"><h2>Результаты по каждому блоку</h2>${d.blocks?.length?`<div class="table-wrap"><table class="table block-results"><thead><tr><th>Блок</th><th>Кол-во оценок</th><th>Средний результат</th></tr></thead><tbody>${d.blocks.map(x=>`<tr><td>${esc(dashboardBlockName(x.name))}</td><td>${x.count}</td><td><div class="block-result-cell"><strong>${x.average}%</strong><div class="mini-bar"><i style="width:${Math.max(0,Math.min(100,x.average))}%"></i></div></div></td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">Нет данных</p>'}</div><div class="grid two"><div class="card"><h2>Уровни оценки</h2>${Object.entries(d.levels).map(([name,count])=>`<div class="level-row"><span>${esc(name)}</span><div class="mini-bar"><i style="width:${count/maxLevel*100}%"></i></div><strong>${count}</strong></div>`).join('')}</div><div class="card"><h2>Динамика по месяцам</h2>${d.months.length?d.months.map(x=>statBar(x.month,x.average,x.count)).join(''):'<p class="muted">Нет данных</p>'}</div></div><div class="grid two"><div class="card"><h2>Результаты по регионам</h2>${d.regions.length?d.regions.map(x=>statBar(x.name,x.average,x.count)).join(''):'<p class="muted">Нет данных</p>'}</div><div class="card"><h2>Топ сотрудников</h2>${d.employees.length?`<div class="table-wrap"><table class="table"><tr><th>Сотрудник</th><th>Регион</th><th>Среднее</th><th>Аудиты</th></tr>${d.employees.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.region)}</td><td><strong>${x.average}%</strong></td><td>${x.count}</td></tr>`).join('')}</table></div>`:'<p class="muted">Нет данных</p>'}</div></div><div class="card"><h2>Последние завершённые аудиты</h2>${d.recent.length?`<div class="table-wrap recent-audits-wrap"><table class="table recent-audits-table"><tr><th>Дата</th><th>Время начала</th><th>Сотрудник</th><th>Визит</th><th>Код точки</th><th>Результат точки</th><th>Зона роста сотрудника</th><th>Локация точки</th></tr>${d.recent.map(x=>`<tr data-visit-view="${x.id}" data-visit-number="${x.visit_number}" class="clickable"><td class="date-col"><span class="nowrap">${esc(x.audit_date)}</span></td><td class="time-col"><span class="nowrap">${esc(x.visit_start_time||'—')}</span></td><td class="employee-col"><span class="employee-nowrap">${esc(x.employee_name||'—')}</span></td><td class="visit-col"><span class="nowrap">Точка ${x.visit_number}</span></td><td class="shop-col"><span class="nowrap">${esc(x.shop_code||'—')}</span></td><td class="result-col"><strong class="nowrap">${x.total_percent??'—'}%</strong></td><td>${esc(x.growth_zone||'—')}</td><td>${x.latitude!=null&&x.longitude!=null?`<a class="coords-link" href="${x.location_url}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${Number(x.latitude).toFixed(6)}, ${Number(x.longitude).toFixed(6)}</a>`:'—'}</td></tr>`).join('')}</table></div>`:'<p class="muted">Нет данных</p>'}</div>`;
}

function dashboardFilterBox(f){
  const sel=f.selected||{};
  return `<div class="card dashboard-filters"><h2>Фильтры</h2><div class="grid four"><div class="field"><label>Регион</label><select id="dashRegion"><option value="">Все регионы</option>${f.regions.map(x=>`<option value="${x.id}" ${sel.region_id===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div><div class="field"><label>Оценивающий</label><select id="dashAuditor"><option value="">Все</option>${f.auditors.map(x=>`<option value="${x.id}" data-role="${esc(x.role||'')}" data-regions="${esc((x.region_ids||[]).join(','))}" ${sel.auditor_id===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div><div class="field"><label>Сотрудник</label><select id="dashEmployee"><option value="">Все сотрудники</option>${f.employees.map(x=>`<option value="${x.id}" data-region="${x.region_id}" data-leader="${esc(x.leader_id||'')}" ${sel.employee_id===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div><div class="field"><label>Месяц</label><select id="dashMonth"><option value="">Все месяцы</option>${f.months.map(x=>`<option value="${x}" ${sel.month===x?'selected':''}>${x}</option>`).join('')}</select></div></div><div class="actions top-gap"><button class="btn primary" id="applyDashFilters">Применить</button><button class="btn secondary" id="resetDashFilters">Сбросить фильтры</button><span class="muted inline-loading" id="dashLoading" hidden>Обновление…</span><span class="muted">Фильтр применяется автоматически; кнопка применяет сразу</span></div></div>`;
}

function filterDashboardDependentOptions(){
  const region=$('#dashRegion'),employee=$('#dashEmployee'),auditor=$('#dashAuditor');
  if(!region||!employee||!auditor)return;

  const rid=region.value||'';
  const employeeId=employee.value||'';
  const employeeOption=employee.selectedOptions?.[0];
  const employeeLeaderId=employeeId?(employeeOption?.dataset.leader||''):'';

  // Оценивающие:
  // выбран сотрудник -> из руководителей только его руководитель.
  // аудиторы и менеджеры остаются доступными.
  [...auditor.options].forEach((o,i)=>{
    if(i===0)return;
    const role=o.dataset.role||'';
    const regions=(o.dataset.regions||'').split(',').filter(Boolean);
    let visible=true;

    if(role==='leader'){
      if(employeeId){
        visible=!!employeeLeaderId && String(o.value)===String(employeeLeaderId);
      }else if(rid){
        visible=regions.includes(rid);
      }
    }
    o.hidden=!visible;
  });

  if(auditor.value&&auditor.selectedOptions[0]?.hidden)auditor.value='';

  // Сотрудники:
  const selectedAuditor=auditor.selectedOptions?.[0];
  const leaderId=(selectedAuditor?.dataset.role==='leader')?auditor.value:'';

  [...employee.options].forEach((o,i)=>{
    if(i===0)return;
    const regionOk=!rid||String(o.dataset.region||'')===String(rid);
    const leaderOk=!leaderId||String(o.dataset.leader||'')===String(leaderId);
    o.hidden=!(regionOk&&leaderOk);
  });

  if(employee.value&&employee.selectedOptions[0]?.hidden)employee.value='';
}

function currentDashboardFilters(){
  return {
    region_id:$('#dashRegion')?.value||'',
    auditor_id:$('#dashAuditor')?.value||'',
    employee_id:$('#dashEmployee')?.value||'',
    month:$('#dashMonth')?.value||''
  };
}
let dashboardFilterTimer=null;
function scheduleDashboardApply(delay=450){
  clearTimeout(dashboardFilterTimer);
  dashboardFilterTimer=setTimeout(()=>dashboard(currentDashboardFilters(),{partial:true}),delay);
}
async function completedVisitView(auditId,visitNumber){
  if(!auditId||!visitNumber)return;
  const pageId=beginPage();
  loadingPage('dashboard','Заполненный опросник');
  try{
    const data=await api(`/audits/${encodeURIComponent(auditId)}/visit-view?visit_number=${encodeURIComponent(visitNumber)}`,{force:true});
    if(!isCurrentPage(pageId))return;
    const rows=asArray(data?.answers,'answers');
    const grouped=new Map();
    rows.forEach((a,i)=>{
      const step=Number(a.step||0);
      const section=a.section||'Раздел';
      const key=`${step}|||${section}`;
      if(!grouped.has(key))grouped.set(key,{step,section,items:[]});
      grouped.get(key).items.push({...a,_i:i});
    });
    const answerLabel=(v)=>{
      const s=String(v??'').toUpperCase();
      if(s==='1')return '1 — выполнено';
      if(s==='0')return '0 — не выполнено';
      if(s==='NA'||s==='N/A')return 'N/A — не применимо';
      return s||'—';
    };
    const stepName=(n)=>({1:'Шаг №1 Подготовка',2:'Шаг №2 Представление',3:'Шаг №3 Осмотр',4:'Шаг №4 Предложение',5:'Шаг №5 Работа в точке',6:'Шаг №6 Завершение визита',7:'Шаг №7 Анализ визита'})[n]||`Шаг №${n}`;
    const sections=[...grouped.values()].sort((a,b)=>a.step-b.step).map(g=>`
      <div class="card questionnaire-readonly-section">
        <h2>${esc(stepName(g.step))}</h2>
        <h3>${esc(g.section)}</h3>
        <div class="table-wrap"><table class="table"><thead><tr><th style="width:52px">№</th><th>Вопрос</th><th style="width:190px">Ответ</th><th>Комментарий</th></tr></thead><tbody>
          ${g.items.map((a,i)=>`<tr><td>${i+1}</td><td>${esc(a.text||a.question_key||'—')}</td><td><strong>${esc(answerLabel(a.answer_value))}</strong></td><td>${esc(a.comment||'—')}</td></tr>`).join('')}
        </tbody></table></div>
      </div>`).join('');
    const coords=data.latitude!=null&&data.longitude!=null?`${Number(data.latitude).toFixed(6)}, ${Number(data.longitude).toFixed(6)}`:'—';
    shell(`${mainNav('dashboard')}<div class="dashboard-head"><div><h1>Заполненный опросник</h1><p class="muted">Точка ${esc(data.visit_number)} · ${esc(data.shop_code||'—')}</p></div><button class="btn secondary" id="backToDashboard">← Назад в дашборд</button></div>
      <div class="card"><div class="grid two">
        <div><b>Дата:</b> ${esc(data.audit_date||'—')}</div><div><b>Сотрудник:</b> ${esc(data.employee_name||'—')}</div>
        <div><b>Регион:</b> ${esc(data.region_name||'—')}</div><div><b>Оценивающий:</b> ${esc(data.auditor_name||'—')}</div>
        <div><b>Код ТТ:</b> ${esc(data.shop_code||'—')}</div><div><b>Результат:</b> ${data.total_percent==null?'—':esc(data.total_percent)+'%'} ${esc(data.level||'')}</div>
        <div><b>Цель визита:</b> ${esc(data.goal||'—')}</div><div><b>Комментарий:</b> ${esc(data.visit_comment||'—')}</div>
        <div><b>Локация:</b> ${esc(coords)}</div><div><b>Время начала:</b> ${esc(data.visit_started_at?formatTashkentDateTime(data.visit_started_at):'—')}</div>
      </div></div>${sections||'<div class="card"><p class="muted">Ответы по этой точке не найдены</p></div>'}`);
    bindNav();
    $('#backToDashboard').onclick=()=>dashboard(currentDashboardFilters());
  }catch(e){
    if(!isCurrentPage(pageId))return;
    toast(e.message||'Не удалось открыть заполненный опросник');
    dashboard(currentDashboardFilters());
  }
}

let completedVisitDelegationBound=false;
function bindCompletedVisitRows(root=document){
  $$('[data-visit-view]',root).forEach(row=>{
    row.style.cursor='pointer';
    row.title='Открыть заполненный опросник';
    row.onclick=(event)=>{
      if(event.target.closest('a,button,input,select,textarea'))return;
      event.preventDefault();
      event.stopPropagation();
      completedVisitView(row.dataset.visitView,Number(row.dataset.visitNumber||1));
    };
  });
  if(!completedVisitDelegationBound){
    completedVisitDelegationBound=true;
    document.addEventListener('click',(event)=>{
      const row=event.target.closest?.('[data-visit-view]');
      if(!row)return;
      if(event.target.closest('a,button,input,select,textarea'))return;
      event.preventDefault();
      event.stopPropagation();
      completedVisitView(row.dataset.visitView,Number(row.dataset.visitNumber||1));
    });
  }
}

function bindDashboardFilters(){
  const region=$('#dashRegion'),auditor=$('#dashAuditor'),employee=$('#dashEmployee'),month=$('#dashMonth');
  if(!region||!auditor||!employee||!month)return;
  filterDashboardDependentOptions();
  bindCompletedVisitRows();
  region.onchange=()=>{filterDashboardDependentOptions();scheduleDashboardApply(250)};
  auditor.onchange=()=>{filterDashboardDependentOptions();scheduleDashboardApply(250)};
  employee.onchange=()=>{
    clearTimeout(dashboardFilterTimer);
    filterDashboardDependentOptions();
    dashboard(currentDashboardFilters(),{partial:true,force:true});
  };
  month.onchange=()=>scheduleDashboardApply();
  $('#applyDashFilters').onclick=()=>{
    clearTimeout(dashboardFilterTimer);
    dashboard(currentDashboardFilters(),{partial:true,force:true});
  };
  $('#resetDashFilters').onclick=()=>{
    clearTimeout(dashboardFilterTimer);
    region.value='';auditor.value='';employee.value='';month.value='';
    filterDashboardDependentOptions();
    dashboard({}, {partial:true,force:true});
  };
}

let dashboardAbortController=null;
let dashboardSequence=0;

async function dashboard(filters={},opts={}){
  let partial=opts.partial&&!!$('#dashboardRoot');
  const pageId=beginPage();
  if(!partial&&!state.dashboardOptions){
    try{state.dashboardOptions=JSON.parse(localStorage.getItem('sle_dashboard_options')||'null')}catch{}
  }
  if(!partial&&state.dashboardOptions){
    let cached=null;try{cached=JSON.parse(localStorage.getItem('sle_dashboard_data')||'null')}catch{}
    const placeholder=cached||{total:0,average:0,levels:{'Базовый':0,'Уверенный':0,'Мастер':0},regions:[],employees:[],months:[],recent:[],blocks:[]};
    shell(`${mainNav('dashboard')}<div id="dashboardRoot"><div class="dashboard-head"><div><h1>Дашборд</h1><p class="muted">Статистика по завершённым аудитам</p></div></div>${dashboardFilterBox({...state.dashboardOptions,selected:filters})}<div id="dashboardResults" class="section-loading">${dashboardResults(placeholder)}</div></div>`);
    bindNav();bindDashboardFilters();partial=true;
  }
  const sequence=++dashboardSequence;
  dashboardAbortController?.abort();
  dashboardAbortController=new AbortController();
  if(!partial)loadingPage('dashboard','Дашборд');
  else{
    $('#dashboardResults')?.classList.add('section-loading');
    $('#dashLoading')?.removeAttribute('hidden');
    if($('#resetDashFilters'))$('#resetDashFilters').disabled=true;
    if($('#applyDashFilters'))$('#applyDashFilters').disabled=true;
  }
  const qs=new URLSearchParams(Object.entries(filters).filter(([,v])=>v));
  qs.set('include_options', state.dashboardOptions?'false':'true');
  let d;
  try{d=await api('/audits/dashboard'+(qs.toString()?'?'+qs.toString():''),{signal:dashboardAbortController.signal,force:!!opts.force})}
  catch(e){
    if(e?.name==='AbortError'||sequence!==dashboardSequence)return;
    $('#dashboardResults')?.classList.remove('section-loading');$('#dashLoading')?.setAttribute('hidden','');
    if($('#resetDashFilters'))$('#resetDashFilters').disabled=false;
    if($('#applyDashFilters'))$('#applyDashFilters').disabled=false;
    return toast(e.message);
  }
  if(!isCurrentPage(pageId)||sequence!==dashboardSequence)return;
  if(d.filters){state.dashboardOptions=d.filters;localStorage.setItem('sle_dashboard_options',JSON.stringify(d.filters));}
  state.dashboardData=d;localStorage.setItem('sle_dashboard_data',JSON.stringify(d));
  const f=d.filters||state.dashboardOptions||{regions:[],auditors:[],employees:[],months:[],selected:{}};
  if(!partial){
    shell(`${mainNav('dashboard')}<div id="dashboardRoot"><div class="dashboard-head"><div><h1>Дашборд</h1><p class="muted">Статистика по завершённым аудитам</p></div></div>${dashboardFilterBox(f)}<div id="dashboardResults">${dashboardResults(d)}</div></div>`);
    bindNav();bindDashboardFilters();
  }else{
    // Не перерисовываем фильтры: это сохраняет фокус и исключает визуальную перезагрузку.
    const results=$('#dashboardResults');
    results.innerHTML=dashboardResults(d);results.classList.remove('section-loading');
    $('#dashLoading')?.setAttribute('hidden','');if($('#resetDashFilters'))$('#resetDashFilters').disabled=false;
    if($('#applyDashFilters'))$('#applyDashFilters').disabled=false;
    $$('[data-open]',results).forEach(r=>r.onclick=()=>openAudit(r.dataset.open));
    bindCompletedVisitRows(results);
  }
}


function comparisonAnswerLabel(v){
  const s=String(v??'').toUpperCase();
  if(s==='1')return '1 — выполнено';
  if(s==='0')return '0 — не выполнено';
  if(s==='NA'||s==='N/A')return 'N/A — не применимо';
  return s||'—';
}
function comparisonDeltaBadge(delta){
  if(delta==null)return '<span class="badge">—</span>';
  if(delta>0)return `<span class="badge ok">↑ +${delta}%</span>`;
  if(delta<0)return `<span class="badge warn">↓ ${delta}%</span>`;
  return '<span class="badge">= 0%</span>';
}
function comparisonStatusLabel(s){
  return ({
    improved:'↑ Улучшено',
    worsened:'↓ Ухудшено',
    unchanged:'= Без изменений',
    changed:'Изменено'
  })[s]||s;
}

async function comparisonPage(){
  if(state.me?.role!=='admin')return home();
  const pageId=beginPage();
  loadingPage('comparison','Сравнение визитов');
  let options;
  try{options=await api('/audits/comparison/options',{force:true})}
  catch(e){return toast(e.message)}
  if(!isCurrentPage(pageId))return;

  state.comparisonOptions=options;
  shell(`${mainNav('comparison')}
    <div class="dashboard-head"><div><h1>Сравнение визитов</h1>
    <p class="muted">История и детальное сравнение посещений одной торговой точки</p></div></div>
    <div class="card">
      <div class="grid four">
        <div class="field"><label>Регион</label><select id="cmpRegion">
          <option value="">Все регионы</option>
          ${(options.regions||[]).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}
        </select></div>
        <div class="field"><label>Код ТТ</label><select id="cmpPoint"><option value="">Выберите ТТ</option></select></div>
        <div class="field"><label>Дата с</label><input id="cmpFrom" type="date"></div>
        <div class="field"><label>Дата по</label><input id="cmpTo" type="date"></div>
      </div>
      <div class="actions top-gap"><button class="btn primary" id="cmpLoad">Показать историю</button></div>
    </div>
    <div id="cmpHistory"></div>
    <div id="cmpDetail"></div>`);
  bindNav();

  const region=$('#cmpRegion'),point=$('#cmpPoint');
  const refreshPoints=()=>{
    const rid=region.value;
    const pts=(options.points||[]).filter(x=>!rid||x.region_id===rid);
    const current=point.value;
    point.innerHTML='<option value="">Выберите ТТ</option>'+pts.map(x=>`<option value="${esc(x.shop_code)}">${esc(x.shop_code)} · ${esc(x.region_name)}</option>`).join('');
    if([...point.options].some(o=>o.value===current))point.value=current;
  };
  refreshPoints();
  region.onchange=refreshPoints;
  $('#cmpLoad').onclick=()=>loadComparisonHistory();
}

async function loadComparisonHistory(){
  const shop=$('#cmpPoint')?.value||'';
  if(!shop)return toast('Выберите код ТТ');
  const qs=new URLSearchParams({shop_code:shop});
  const rid=$('#cmpRegion')?.value||'';
  const df=$('#cmpFrom')?.value||'';
  const dt=$('#cmpTo')?.value||'';
  if(rid)qs.set('region_id',rid);
  if(df)qs.set('date_from',df);
  if(dt)qs.set('date_to',dt);

  const historyRoot=$('#cmpHistory');
  historyRoot.innerHTML='<div class="card section-loading"><p class="muted">Загрузка истории…</p></div>';
  let data;
  try{data=await api('/audits/comparison/history?'+qs.toString(),{force:true})}
  catch(e){historyRoot.innerHTML='';return toast(e.message)}
  const rows=asArray(data?.visits,'visits');

  if(!rows.length){
    historyRoot.innerHTML='<div class="card"><p class="muted">По этой ТТ завершённых визитов не найдено</p></div>';
    $('#cmpDetail').innerHTML='';
    return;
  }
  state.comparisonVisits=rows;

  historyRoot.innerHTML=`<div class="card">
    <div class="section-head"><div><h2>История ТТ ${esc(data.shop_code)}</h2>
    <p class="muted">${rows.length} завершённых визитов</p></div></div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th></th><th>Дата</th><th>Сотрудник</th><th>Оценивающий</th><th>Результат ТТ</th><th>Изменение</th><th>Цель визита</th></tr></thead>
      <tbody>${rows.map((x,i)=>`<tr>
        <td><input type="checkbox" class="cmp-select" data-index="${i}" aria-label="Выбрать визит"></td>
        <td>${esc(x.audit_date)}</td><td>${esc(x.employee_name)}</td><td>${esc(x.auditor_name)}</td>
        <td><strong>${x.point_percent}%</strong></td><td>${comparisonDeltaBadge(x.delta)}</td><td>${esc(x.goal||'—')}</td>
      </tr>`).join('')}</tbody></table></div>
    <div class="actions top-gap">
      <button class="btn primary" id="cmpCompare" disabled>Сравнить выбранные</button>
      <span class="muted">Выберите ровно 2 визита</span>
    </div>
    <div class="top-gap">
      <h3>Динамика результата</h3>
      ${rows.map(x=>`<div class="stat-row"><div class="stat-label"><span>${esc(x.audit_date)} · ${esc(x.auditor_name)}</span><strong>${x.point_percent}%</strong></div><div class="bar"><i style="width:${Math.max(0,Math.min(100,x.point_percent))}%"></i></div></div>`).join('')}
    </div>
  </div>`;

  const boxes=$$('.cmp-select');
  const update=()=>{
    const checked=boxes.filter(b=>b.checked);
    if(checked.length>2){
      checked[checked.length-1].checked=false;
      return update();
    }
    $('#cmpCompare').disabled=checked.length!==2;
  };
  boxes.forEach(b=>b.onchange=update);
  $('#cmpCompare').onclick=()=>{
    const idxs=boxes.filter(b=>b.checked).map(b=>Number(b.dataset.index)).sort((a,b)=>a-b);
    if(idxs.length!==2)return;
    loadComparisonDetail(rows[idxs[0]],rows[idxs[1]]);
  };
}

async function loadComparisonDetail(left,right){
  const root=$('#cmpDetail');
  root.innerHTML='<div class="card section-loading"><p class="muted">Детальное сравнение…</p></div>';
  const qs=new URLSearchParams({
    left_audit_id:left.audit_id,left_visit_number:left.visit_number,
    right_audit_id:right.audit_id,right_visit_number:right.visit_number
  });
  let d;
  try{d=await api('/audits/comparison/detail?'+qs.toString(),{force:true})}
  catch(e){root.innerHTML='';return toast(e.message)}

  const s=d.summary||{};
  root.innerHTML=`<div class="card">
    <div class="section-head"><div><h2>Детальное сравнение · ${esc(d.shop_code)}</h2>
    <p class="muted">${esc(d.left.audit_date)} ↔ ${esc(d.right.audit_date)}</p></div></div>
    <div class="kpi-grid">
      <div class="kpi" data-dashboard-completed="1" role="button" tabindex="0"><div><span>Было</span><strong>${d.left.point_percent}%</strong><small>${esc(d.left.audit_date)}</small></div></div>
      <div class="kpi"><div><span>Стало</span><strong>${d.right.point_percent}%</strong><small>${esc(d.right.audit_date)}</small></div></div>
      <div class="kpi"><div><span>Изменение</span><strong>${s.delta>0?'+':''}${s.delta}%</strong><small>по результату ТТ</small></div></div>
      <div class="kpi"><div><span>Улучшено</span><strong>${s.improved||0}</strong><small>вопросов</small></div></div>
      <div class="kpi"><div><span>Ухудшено</span><strong>${s.worsened||0}</strong><small>вопросов</small></div></div>
      <div class="kpi"><div><span>Проблема осталась</span><strong>${s.unresolved||0}</strong><small>0 → 0</small></div></div>
    </div>
    <div class="grid two top-gap">
      <div><b>Первый визит:</b> ${esc(d.left.auditor_name)} · ${esc(d.left.employee_name)}<br><b>Цель:</b> ${esc(d.left.goal)}<br><b>Комментарий:</b> ${esc(d.left.comment)}</div>
      <div><b>Второй визит:</b> ${esc(d.right.auditor_name)} · ${esc(d.right.employee_name)}<br><b>Цель:</b> ${esc(d.right.goal)}<br><b>Комментарий:</b> ${esc(d.right.comment)}</div>
    </div>
  </div>
  <div class="card">
    <h2>Сравнение по блокам</h2>
    <div class="table-wrap"><table class="table"><thead><tr><th>Блок</th><th>${esc(d.left.audit_date)}</th><th>${esc(d.right.audit_date)}</th><th>Изменение</th></tr></thead>
    <tbody>${asArray(d.blocks,'blocks').map(x=>`<tr><td>${esc(x.name)}</td><td>${x.left_percent}%</td><td>${x.right_percent}%</td><td>${comparisonDeltaBadge(x.delta)}</td></tr>`).join('')}</tbody></table></div>
  </div>
  <div class="card">
    <div class="section-head"><div><h2>Сравнение каждого вопроса</h2></div>
      <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="cmpOnlyChanges"> Только изменения</label>
    </div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Шаг / раздел</th><th>Вопрос</th><th>${esc(d.left.audit_date)}</th><th>${esc(d.right.audit_date)}</th><th>Статус</th><th>Комментарий 1</th><th>Комментарий 2</th></tr></thead>
    <tbody id="cmpQuestionRows">${comparisonQuestionRows(d.questions,false)}</tbody></table></div>
  </div>`;
  $('#cmpOnlyChanges').onchange=e=>{
    $('#cmpQuestionRows').innerHTML=comparisonQuestionRows(d.questions,e.target.checked);
  };
}

function comparisonQuestionRows(rows,onlyChanges){
  rows=asArray(rows,'questions');
  if(onlyChanges)rows=rows.filter(x=>x.status!=='unchanged');
  if(!rows.length)return '<tr><td colspan="7" class="muted">Изменений нет</td></tr>';
  return rows.map(x=>`<tr class="cmp-${x.status}">
    <td>Шаг ${x.step}<br><span class="muted">${esc(x.section)}</span></td>
    <td>${esc(x.text)}</td>
    <td><strong>${esc(comparisonAnswerLabel(x.left_value))}</strong></td>
    <td><strong>${esc(comparisonAnswerLabel(x.right_value))}</strong></td>
    <td>${esc(comparisonStatusLabel(x.status))}</td>
    <td>${esc(x.left_comment||'—')}</td>
    <td>${esc(x.right_comment||'—')}</td>
  </tr>`).join('');
}










if(!window.__sleDashboardLevelClickBound){
  window.__sleDashboardLevelClickBound=true;

  function dashboardDrilldownTarget(target){
    const levelCard=target.closest?.('[data-dashboard-level]');
    if(levelCard)return {type:'level',level:levelCard.dataset.dashboardLevel};
    const completedCard=target.closest?.('[data-dashboard-completed]');
    if(completedCard)return {type:'completed',level:null};
    return null;
  }

  document.addEventListener('click',e=>{
    const target=dashboardDrilldownTarget(e.target);
    if(!target)return;
    e.preventDefault();
    e.stopPropagation();
    renderDashboardLevelList(target.level);
  });

  document.addEventListener('keydown',e=>{
    if(!['Enter',' '].includes(e.key))return;
    const target=dashboardDrilldownTarget(e.target);
    if(!target)return;
    e.preventDefault();
    renderDashboardLevelList(target.level);
  });
}

