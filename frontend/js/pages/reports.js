async function history(limit=50,{append=false}={}){
  const pageId=beginPage();
  const existing=$('#historyRoot');
  if(!existing)loadingPage('history','Отчёты');
  else existing.classList.add('section-loading');
  let rows;
  try{rows=await api(`/audits?limit=${limit}`,{force:append})}catch(e){existing?.classList.remove('section-loading');return toast(e.message)}
  if(!isCurrentPage(pageId))return;
  state.audits=rows;
  if(!existing){
    shell(`${mainNav('history')}<div class="card" id="historyRoot"><div class="section-head"><div><h1>Отчёты</h1><p class="muted" id="historyCount">Показаны последние ${state.audits.length} аудитов</p></div></div><div class="actions"><button class="btn primary" id="exportExcel">Отчет по аудиту</button><button class="btn secondary" id="exportAnswers">Детальный отчет</button><button class="btn secondary" id="loadMoreAudits" ${state.audits.length<limit||limit>=500?'hidden':''}>Показать ещё</button></div><div id="reportTable" class="top-gap">${auditTable(state.audits)}</div></div>`);
    bindNav();
    $('#exportExcel').onclick=()=>downloadExcel('/extras/export/audit-report.xlsx','audit-report.xlsx');
    $('#exportAnswers').onclick=()=>downloadExcel('/extras/export/detailed-report.xlsx','detailed-audit-report.xlsx');
  }else{
    existing.classList.remove('section-loading');
    $('#historyCount').textContent=`Показаны последние ${state.audits.length} аудитов`;
    $('#reportTable').innerHTML=auditTable(state.audits);
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
  return `<div class="kpi-grid"><div class="kpi kpi-audits"><div class="kpi-icon">▣</div><div><span>Завершено аудитов</span><strong>${d.total}</strong><small>в выбранном периоде</small></div></div><div class="kpi kpi-average"><div class="kpi-icon">★</div><div><span>Средний результат</span><strong>${d.average}%</strong><small>по завершённым аудитам</small></div></div><div class="kpi kpi-master"><div class="kpi-icon">♛</div><div><span>Мастер</span><strong>${d.levels['Мастер']||0}</strong><small>${d.total?Math.round((d.levels['Мастер']||0)/d.total*100):0}% от общего числа</small></div></div><div class="kpi kpi-confident"><div class="kpi-icon">◆</div><div><span>Уверенный</span><strong>${d.levels['Уверенный']||0}</strong><small>${d.total?Math.round((d.levels['Уверенный']||0)/d.total*100):0}% от общего числа</small></div></div><div class="kpi kpi-basic"><div class="kpi-icon">●</div><div><span>Базовый</span><strong>${d.levels['Базовый']||0}</strong><small>${d.total?Math.round((d.levels['Базовый']||0)/d.total*100):0}% от общего числа</small></div></div></div><div class="card"><h2>Результаты по каждому блоку</h2>${d.blocks?.length?`<div class="table-wrap"><table class="table block-results"><thead><tr><th>Блок</th><th>Кол-во оценок</th><th>Средний результат</th></tr></thead><tbody>${d.blocks.map(x=>`<tr><td>${esc(dashboardBlockName(x.name))}</td><td>${x.count}</td><td><div class="block-result-cell"><strong>${x.average}%</strong><div class="mini-bar"><i style="width:${Math.max(0,Math.min(100,x.average))}%"></i></div></div></td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">Нет данных</p>'}</div><div class="grid two"><div class="card"><h2>Уровни оценки</h2>${Object.entries(d.levels).map(([name,count])=>`<div class="level-row"><span>${esc(name)}</span><div class="mini-bar"><i style="width:${count/maxLevel*100}%"></i></div><strong>${count}</strong></div>`).join('')}</div><div class="card"><h2>Динамика по месяцам</h2>${d.months.length?d.months.map(x=>statBar(x.month,x.average,x.count)).join(''):'<p class="muted">Нет данных</p>'}</div></div><div class="grid two"><div class="card"><h2>Результаты по регионам</h2>${d.regions.length?d.regions.map(x=>statBar(x.name,x.average,x.count)).join(''):'<p class="muted">Нет данных</p>'}</div><div class="card"><h2>Топ сотрудников</h2>${d.employees.length?`<div class="table-wrap"><table class="table"><tr><th>Сотрудник</th><th>Регион</th><th>Среднее</th><th>Аудиты</th></tr>${d.employees.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.region)}</td><td><strong>${x.average}%</strong></td><td>${x.count}</td></tr>`).join('')}</table></div>`:'<p class="muted">Нет данных</p>'}</div></div><div class="card"><h2>Последние завершённые аудиты</h2>${d.recent.length?`<div class="table-wrap"><table class="table"><tr><th>Дата</th><th>Время начала</th><th>Визит</th><th>Код точки</th><th>Результат точки</th><th>Зона роста сотрудника</th><th>Локация точки</th></tr>${d.recent.map(x=>`<tr data-open="${x.id}" class="clickable"><td>${esc(x.audit_date)}</td><td>${esc(x.visit_start_time||'—')}</td><td>Точка ${x.visit_number}</td><td>${esc(x.shop_code||'—')}</td><td><strong>${x.total_percent??'—'}%</strong></td><td>${esc(x.growth_zone||'—')}</td><td>${x.latitude!=null&&x.longitude!=null?`<a class="coords-link" href="${x.location_url}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${Number(x.latitude).toFixed(6)}, ${Number(x.longitude).toFixed(6)}</a>`:'—'}</td></tr>`).join('')}</table></div>`:'<p class="muted">Нет данных</p>'}</div>`;
}

function dashboardFilterBox(f){
  const sel=f.selected||{};
  return `<div class="card dashboard-filters"><h2>Фильтры</h2><div class="grid four"><div class="field"><label>Регион</label><select id="dashRegion"><option value="">Все регионы</option>${f.regions.map(x=>`<option value="${x.id}" ${sel.region_id===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div><div class="field"><label>Оценивающий</label><select id="dashAuditor"><option value="">Все</option>${f.auditors.map(x=>`<option value="${x.id}" data-role="${esc(x.role||'')}" data-regions="${esc((x.region_ids||[]).join(','))}" ${sel.auditor_id===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div><div class="field"><label>Сотрудник</label><select id="dashEmployee"><option value="">Все сотрудники</option>${f.employees.map(x=>`<option value="${x.id}" data-region="${x.region_id}" ${sel.employee_id===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div><div class="field"><label>Месяц</label><select id="dashMonth"><option value="">Все месяцы</option>${f.months.map(x=>`<option value="${x}" ${sel.month===x?'selected':''}>${x}</option>`).join('')}</select></div></div><div class="actions top-gap"><button class="btn primary" id="applyDashFilters">Применить</button><button class="btn secondary" id="resetDashFilters">Сбросить фильтры</button><span class="muted inline-loading" id="dashLoading" hidden>Обновление…</span><span class="muted">Фильтр применяется автоматически; кнопка применяет сразу</span></div></div>`;
}

function filterDashboardDependentOptions(){
  const region=$('#dashRegion'), employee=$('#dashEmployee'), auditor=$('#dashAuditor');
  if(!region||!employee||!auditor)return;
  const rid=region.value;
  [...employee.options].forEach((o,i)=>{if(i===0)return;o.hidden=!!rid&&o.dataset.region!==rid});
  if(employee.selectedOptions[0]?.hidden)employee.value='';
  [...auditor.options].forEach((o,i)=>{
    if(i===0)return;
    const role=o.dataset.role;
    const regions=(o.dataset.regions||'').split(',').filter(Boolean);
    o.hidden=!!rid&&role==='leader'&&!regions.includes(rid);
  });
  if(auditor.selectedOptions[0]?.hidden)auditor.value='';
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
function bindDashboardFilters(){
  const region=$('#dashRegion'),auditor=$('#dashAuditor'),employee=$('#dashEmployee'),month=$('#dashMonth');
  if(!region||!auditor||!employee||!month)return;
  filterDashboardDependentOptions();
  region.onchange=()=>{filterDashboardDependentOptions();scheduleDashboardApply()};
  auditor.onchange=()=>scheduleDashboardApply();
  employee.onchange=()=>scheduleDashboardApply();
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
  }
}
