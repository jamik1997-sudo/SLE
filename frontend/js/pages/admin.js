function statusDuration(seconds){seconds=Math.max(0,Number(seconds)||0);const d=Math.floor(seconds/86400),h=Math.floor((seconds%86400)/3600),m=Math.floor((seconds%3600)/60);return d?`${d} д ${h} ч`:h?`${h} ч ${m} мин`:`${m} мин`;}
function statusBadge(ok,a='Работает',b='Ошибка'){return `<span class="site-status-badge ${ok?'is-ok':'is-bad'}"><i></i>${ok?a:b}</span>`;}

async function adminPage(){
  const pageId=beginPage();
  let regions=[],users=[],employees=[];
  try{
    const cached=localStorage.getItem('sle_admin_bootstrap');
    let cachedAt=0;
    if(cached){
      const parsed=JSON.parse(cached);
      const data=parsed.data||parsed;
      cachedAt=parsed.ts||0;
      regions=data.regions||[];users=data.users||[];employees=data.employees||[];
    }else loadingPage('admin','Управление');
    if(!cachedAt||Date.now()-cachedAt>5*60*1000){
      const data=await api('/admin/bootstrap');
      if(!isCurrentPage(pageId))return;
      regions=data.regions||[];users=data.users||[];employees=data.employees||[];
      localStorage.setItem('sle_admin_bootstrap',JSON.stringify({ts:Date.now(),data}));
    }
  }catch(e){if(!regions.length)return toast(e.message)}
  const leaders=users.filter(x=>x.role==='leader');
  const leaderOptions=(selected='')=>leaders.map(x=>`<option value="${x.id}" ${selected===x.id?'selected':''}>${esc(x.full_name)} (${esc(x.regions?.[0]?.name||'без региона')})</option>`).join('');
  shell(`${mainNav('admin')}${state.me?.role==='admin'?`<div class="card site-status-card"><div class="section-head"><div><h2>Статус сайта</h2><p class="muted">API, база данных и нагрузка сервера</p></div><button class="btn" id="refreshSystemStatus">Обновить</button></div><div id="systemStatusBody"><div class="muted">Проверка состояния…</div></div></div>`:' '}<div class="grid two"><div class="card"><h2>Добавить регион</h2><form id="addRegion"><div class="field"><label>Название</label><input name="name" required></div><button class="btn primary top-gap">Добавить</button></form></div><div class="card"><h2>Добавить сотрудника</h2><form id="addEmployee"><div class="field"><label>ФИО</label><input name="full_name" required></div><div class="field"><label>Регион</label><select name="region_id" required>${regions.map(r=>`<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></div><div class="field"><label>Руководитель</label><select name="leader_id" required><option value="">Выберите руководителя</option>${leaderOptions()}</select></div><div class="field"><label>Должность</label><input name="position"></div><button class="btn primary top-gap">Добавить</button></form></div></div>
  <div class="card"><div class="section-head"><div><h2>Сотрудники</h2><p class="muted">Дубликат ФИО в одном регионе создать нельзя. Каждый сотрудник закрепляется за руководителем.</p></div></div><div id="employeeTable">${employeeTable(employees)}</div></div>
  <div class="card"><h2>Создать пользователя</h2><form id="addUser"><div class="grid two"><div class="field"><label>ФИО</label><input name="full_name" required></div><div class="field"><label>Логин</label><input name="login" minlength="3" required></div><div class="field"><label>Пароль</label><input name="password" type="password" minlength="8" required></div><div class="field"><label>Роль</label><select name="role" id="userRole"><option value="leader">Руководитель</option><option value="auditor">Аудитор</option><option value="manager">Менеджер</option>${state.me.role==='admin'?'<option value="admin">Администратор</option>':''}</select></div><div class="field span-2" id="regionField"><label>Регион руководителя</label><select name="region_id" required>${regions.map(r=>`<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></div></div><button class="btn primary top-gap">Создать</button></form></div>
  <div class="card"><h2>Пользователи</h2><div class="table-wrap"><table class="table"><tr><th>ФИО</th><th>Логин</th><th>Пароль</th><th>Роль</th><th>Доступ</th><th>Устройство</th><th></th></tr>${users.map(u=>`<tr><td>${esc(u.full_name)}</td><td>${esc(u.login)}</td><td>${u.can_view_password?(u.password_visible?`<span class="password-view"><code data-password-value="${esc(u.password_visible)}">••••••••</code><button type="button" class="btn secondary small" data-toggle-password="${u.id}">Показать</button></span>`:'<span class="muted">Недоступен до смены</span>'):'<span class="muted">Недоступен</span>'}</td><td>${roleName(u.role)}</td><td>${u.role==='leader'?(u.regions.map(r=>esc(r.name)).join(', ')||'—'):'Вся республика'}</td><td>${['leader','auditor'].includes(u.role)?(u.device_bound?`<span class="status ok">Привязано</span><small class="muted block">${esc(u.device_name||'Устройство')}</small>`:'<span class="status">Не привязано</span>'):'—'}</td><td><span class="actions"><button class="btn secondary small" data-edit-user="${u.id}">Изменить</button>${['leader','auditor'].includes(u.role)&&u.device_bound?`<button class="btn secondary small" data-reset-device="${u.id}" data-name="${esc(u.full_name)}">Сбросить устройство</button>`:''}${u.id!==state.me.id?`<button class="btn danger small" data-delete-user="${u.id}" data-name="${esc(u.full_name)}">Удалить</button>`:''}</span></td></tr>`).join('')}</table></div></div>`);
  bindNav();
  const reload=()=>{state.employees.clear();localStorage.removeItem('sle_admin_bootstrap');Object.keys(localStorage).filter(k=>k.startsWith('sle_employees_')).forEach(k=>localStorage.removeItem(k));adminPage()};
  function bindEmployeeActions(){
    $$('[data-delete-employee]').forEach(b=>b.onclick=async()=>{if(!confirm(`Удалить сотрудника «${b.dataset.name}»?`))return;try{await api('/admin/employees/'+b.dataset.deleteEmployee,{method:'DELETE'});toast('Сотрудник удалён');reload()}catch(e){toast(e.message)}});
    $$('[data-edit-employee]').forEach(b=>b.onclick=async()=>{const x=employees.find(v=>v.id===b.dataset.editEmployee);if(!x)return;const full_name=prompt('ФИО сотрудника',x.full_name);if(full_name===null)return;const position=prompt('Должность',x.position||'');if(position===null)return;const region_id=prompt('ID региона',x.region_id)||x.region_id;const leader_id=prompt('ID руководителя',x.leader_id||'')||x.leader_id;try{await api('/admin/employees/'+x.id,{method:'PUT',body:JSON.stringify({full_name,position,region_id,leader_id})});toast('Сотрудник изменён');reload()}catch(e){toast(e.message)}})
  }
  bindEmployeeActions();
  const toggleRegion=()=>{const leader=$('#userRole').value==='leader';$('#regionField').hidden=!leader;$('#regionField select').required=leader};$('#userRole').onchange=toggleRegion;toggleRegion();
  $('#addRegion').onsubmit=async e=>{e.preventDefault();try{await api('/admin/regions?name='+encodeURIComponent(new FormData(e.target).get('name')),{method:'POST'});localStorage.removeItem('sle_admin_bootstrap');toast('Регион добавлен');adminPage()}catch(err){toast(err.message)}};
  $('#addEmployee').onsubmit=async e=>{e.preventDefault();const q=new URLSearchParams(Object.fromEntries(new FormData(e.target)));try{await api('/admin/employees?'+q,{method:'POST'});toast('Сотрудник добавлен');reload()}catch(err){toast(err.message)}};
  $('#addUser').onsubmit=async e=>{e.preventDefault();const p=Object.fromEntries(new FormData(e.target));p.region_ids=p.role==='leader'&&p.region_id?[p.region_id]:[];delete p.region_id;try{await api('/admin/users',{method:'POST',body:JSON.stringify(p)});localStorage.removeItem('sle_admin_bootstrap');toast('Пользователь создан');adminPage()}catch(err){toast(err.message)}};
  $$('[data-toggle-password]').forEach(b=>b.onclick=()=>{const code=b.parentElement.querySelector('[data-password-value]');if(!code)return;const hidden=code.textContent==='••••••••';code.textContent=hidden?code.dataset.passwordValue:'••••••••';b.textContent=hidden?'Скрыть':'Показать'});
  $$('[data-reset-device]').forEach(b=>b.onclick=async()=>{if(!confirm(`Сбросить привязку устройства для «${b.dataset.name}»? После этого пользователь сможет войти с нового устройства.`))return;try{await api('/admin/users/'+b.dataset.resetDevice+'/reset-device',{method:'POST'});localStorage.removeItem('sle_admin_bootstrap');toast('Привязка устройства сброшена');adminPage()}catch(e){toast(e.message)}});
  $$('[data-delete-user]').forEach(b=>b.onclick=async()=>{if(!confirm(`Удалить пользователя «${b.dataset.name}»?`))return;try{await api('/admin/users/'+b.dataset.deleteUser,{method:'DELETE'});localStorage.removeItem('sle_admin_bootstrap');toast('Пользователь удалён');adminPage()}catch(e){toast(e.message)}});
  $$('[data-edit-user]').forEach(b=>b.onclick=async()=>{const u=users.find(x=>x.id===b.dataset.editUser);if(!u)return;const full_name=prompt('ФИО',u.full_name);if(full_name===null)return;const login=prompt('Логин',u.login);if(login===null)return;const password=prompt('Новый пароль (оставьте пустым без изменения)','');if(password===null)return;const payload={full_name,login,role:u.role,region_id:u.role==='leader'?(u.regions?.[0]?.id||''):null};if(password)payload.password=password;try{await api('/admin/users/'+u.id,{method:'PUT',body:JSON.stringify(payload)});localStorage.removeItem('sle_admin_bootstrap');toast('Пользователь изменён');adminPage()}catch(e){toast(e.message)}})
  if(state.me?.role==='admin')loadSystemStatus();
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


async function loadSystemStatus(){
  if(state.me?.role!=='admin')return;
  const root=$('#systemStatusBody'); if(!root)return;
  root.innerHTML='<div class="muted">Проверка состояния…</div>';
  const t=performance.now();
  try{
    const d=await api('/extras/system-status',{force:true,timeout:8000});
    const browserMs=Math.round(performance.now()-t), pool=d.pool||{};
    root.innerHTML=`<div class="site-status-grid">
      <div class="site-status-item"><span>Сайт / API</span>${statusBadge(d.api?.ok===true)}<small>Ответ из браузера: ${browserMs} мс</small></div>
      <div class="site-status-item"><span>База данных</span>${statusBadge(d.database?.ok===true)}<small>${d.database?.response_ms!=null?`Ответ БД: ${d.database.response_ms} мс`:'Нет данных'}</small></div>
      <div class="site-status-item"><span>Backend</span>${statusBadge(true,'Запущен','Остановлен')}<small>PID ${esc(d.api?.pid??'—')} · ${statusDuration(d.api?.uptime_seconds)}</small></div>
      <div class="site-status-item"><span>Пул БД</span>${statusBadge((pool.checked_out??0)<(pool.size??4),'Норма','Высокая нагрузка')}<small>Активно: ${pool.checked_out??'—'} · пул: ${pool.size??'—'} · overflow: ${pool.overflow??'—'}</small></div>
    </div>${d.load?`<div class="site-status-foot">Нагрузка сервера: 1 мин — <b>${d.load['1m']}</b>, 5 мин — <b>${d.load['5m']}</b>, 15 мин — <b>${d.load['15m']}</b></div>`:''}${d.database?.error?`<div class="site-status-error">${esc(d.database.error)}</div>`:''}`;
  }catch(e){root.innerHTML=`<div class="site-status-error"><b>Не удалось проверить сайт</b><br>${esc(e.message)}</div>`}
}
document.addEventListener('click',e=>{if(e.target?.id==='refreshSystemStatus'){e.preventDefault();loadSystemStatus();}});
