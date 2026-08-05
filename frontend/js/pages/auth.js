async function boot(){
  applyTheme();state.regions=null
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
  $('#login').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const payload=Object.fromEntries(f);payload.device_id=getDeviceId();payload.device_name=getDeviceName();try{const d=await api('/auth/login',{method:'POST',body:JSON.stringify(payload)});state.token=d.access_token;localStorage.setItem('sle_token',state.token);state.me=await api('/auth/me',{force:true});state.regions=null;localStorage.removeItem('sle_regions');localStorage.setItem('sle_me',JSON.stringify(state.me));home()}catch(err){toast(err.message)}};
}
