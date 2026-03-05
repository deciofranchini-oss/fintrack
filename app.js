function openSidebar(){
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarOverlay').classList.add('open');
  // iOS-safe: lock scroll without overflow:hidden on body
  const scrollY = window.scrollY;
  document.body.style.position='fixed';
  document.body.style.top='-'+scrollY+'px';
  document.body.style.width='100%';
  document.body.dataset.scrollY=scrollY;
}
function closeSidebar(){
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('open');
  // Restore scroll position after position:fixed unlock
  const scrollY = parseInt(document.body.dataset.scrollY||'0');
  document.body.style.position='';
  document.body.style.top='';
  document.body.style.width='';
  window.scrollTo(0, scrollY);
}

let sb=null;

// ─────────────────────────────────────────────
// Background helpers (PWA)
// ─────────────────────────────────────────────
let _dailyAutoTimer = null;

async function registerServiceWorkerSafe(){
  try{
    if(!('serviceWorker' in navigator)) return;
    // GitHub Pages friendly path: sw.js at site root
    await navigator.serviceWorker.register('./sw.js', { scope: './' });
  }catch(e){
    console.warn('[sw]', e.message);
  }
}

function scheduleDailyAutoRegister(){
  try{
    if(_dailyAutoTimer) clearTimeout(_dailyAutoTimer);
    const now = new Date();
    const next = new Date(now);
    next.setHours(24,0,5,0); // 00:00:05 next day
    const ms = next.getTime() - now.getTime();
    _dailyAutoTimer = setTimeout(async ()=>{
      try{
        if(typeof runScheduledAutoRegister === 'function') await runScheduledAutoRegister();
      }catch(e){ console.warn('[daily autorun]', e.message); }
      scheduleDailyAutoRegister(); // re-arm
    }, Math.max(5000, ms));
  }catch(e){}
}

async function initSupabase(){
  const url=document.getElementById('supabaseUrl').value.trim();
  const key=document.getElementById('supabaseKey').value.trim();
  if(!url||!key){toast('Preencha URL e Key do Supabase','error');return;}
  try{
    sb=supabase.createClient(url,key);
    const{error}=await sb.from('accounts').select('id').limit(1);
    if(error)throw error;
    localStorage.setItem('sb_url',url);localStorage.setItem('sb_key',key);
    document.getElementById('setupScreen').style.display='none';
    document.getElementById('pinScreen').style.display='none';
    _pinUnlocked=true;
    toast('Conectado ao Supabase!','success');
    await bootApp();
    resetAutoLockTimer();
  }catch(e){toast('Erro: '+e.message,'error');}
}
async function tryAutoConnect(){
  const url=localStorage.getItem('sb_url'),key=localStorage.getItem('sb_key');
  if(url&&key){
    document.getElementById('supabaseUrl').value=url;
    document.getElementById('supabaseKey').value=key;
    // Create client early so we can boot right after PIN unlock
    sb=supabase.createClient(url,key);
    // Check multi-user
    const multiUser = await isMultiUserEnabled().catch(()=>false);
    if(multiUser){
      await ensureMasterAdmin().catch(()=>{});
      const restored = await tryRestoreSession().catch(()=>false);
      if(restored){
        // Lock screen removed
        try{const ps=document.getElementById('pinScreen'); if(ps) ps.style.display='none';}catch(e){}
        _pinUnlocked=true;
        await bootApp();
        updateUserUI();
      } else {
        _pinUnlocked=true;
        document.getElementById('pinScreen').style.display='none';
        showLoginScreen();
      }
      return;
    }
  } else {
    // No saved credentials yet
    sb = null;
  }
  // Lock screen removed
  try{const ps=document.getElementById('pinScreen'); if(ps) ps.style.display='none';}catch(e){}
  _pinUnlocked=true;
  if(url&&key){
    ensureSupabaseClient();
    await bootApp();
  } else {
    const setup=document.getElementById('setupScreen');
    if(setup) setup.style.display='flex';
  }
}

const DEFAULT_LOGO_URL='https://deciofranchini-oss.github.io/fintrack/logo.png';
let APP_LOGO_URL=DEFAULT_LOGO_URL;
function setAppLogo(url){
  // Defensive: avoid accidentally assigning a Promise/thenable to img.src
  // (would become "[object Promise]" and break the logo URL).
  try {
    if (url && (typeof url === 'object' || typeof url === 'function') && typeof url.then === 'function') {
      console.warn('[logo] Ignoring Promise passed to setAppLogo(); falling back to default logo.');
      url = '';
    }
  } catch {}

  if (url && typeof url !== 'string') url = '';
  const clean = (typeof url === 'string') ? url.trim() : '';
  APP_LOGO_URL = clean || DEFAULT_LOGO_URL;

  ['sidebarLogoImg','settingsLogoImg','topbarLogoImg','loginLogoImg','authLogoImg'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.src = APP_LOGO_URL;
  });
}

// NOTE: txFilter is part of the app's internal contract (used across modules).
// Keep keys stable to avoid breaking filtering and saved preferences.
let state={accounts:[],groups:[],categories:[],payees:[],transactions:[],budgets:[],txPage:0,txPageSize:50,txTotal:0,txSortField:'date',txSortAsc:false,txFilter:{search:'',month:'',account:'',type:'',status:''},txView:'flat',currentPage:'dashboard',chartInstances:{},privacyMode:false};

async function bootApp(){
  registerServiceWorkerSafe();
  // Logos (can be overridden by app_settings)
  setAppLogo(APP_LOGO_URL);

  // Carregar dados base
  try {
    await Promise.all([loadAccounts(),loadCategories(),loadPayees(),loadAppSettings(),loadScheduled().catch(()=>{})]);
  } catch(e) {
    toast('Erro ao carregar dados: '+e.message,'error');
    return;
  }
  // Auto-register scheduled transactions (browser session)
  if (typeof runScheduledAutoRegister === 'function') { await runScheduledAutoRegister(); }

  populateSelects();
  // Start auto-check timer if configured
  const _cfg = getAutoCheckConfig();
  if(_cfg.enabled && _cfg.method === 'browser') applyAutoCheckTimer(_cfg);
  // Datas padrão
  const ym=new Date().toISOString().slice(0,7);
  populateTxMonthFilter();
  const txMonthEl=document.getElementById('txMonth');if(txMonthEl)txMonthEl.value=ym;
  const repEl=document.getElementById('reportMonth');if(repEl)repEl.value=ym;
  const budEl=document.getElementById('budgetMonth');if(budEl)budEl.value=ym;
  const budInEl=document.getElementById('budgetMonthInput');if(budInEl)budInEl.value=ym;
  state.txFilter.month=ym;
  // Navegar para dashboard
  navigate('dashboard');
  initEmailJSStatus();
  updateUserUI();
}

const pageTitles={dashboard:'Dashboard',transactions:'Transações',accounts:'Contas',reports:'Relatórios',budgets:'Orçamentos',categories:'Categorias',payees:'Beneficiários',scheduled:'Programados',import:'Importar / Backup',settings:'Configurações'};
function togglePrivacy(){
  state.privacyMode=!state.privacyMode;
  const btn=document.getElementById('privacyToggleBtn');
  if(btn){
    btn.title=state.privacyMode?'Mostrar valores':'Ocultar valores';
    btn.innerHTML=state.privacyMode?
      `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`:
      `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  }
  // Re-render current page
  const p=state.currentPage;
  if(p==='dashboard')loadDashboard();
  else if(p==='transactions')loadTransactions();
  else if(p==='accounts')renderAccounts();
  else if(p==='reports'){populateReportFilters();loadCurrentReport();}
  else if(p==='budgets')loadBudgets();
}

function navigate(page){
  // Guard: settings is admin-only
  if((page==='settings' || page==='audit') && !(currentUser?.role==='admin' || currentUser?.can_admin)) {
    toast('Acesso restrito: apenas admin pode acessar Configurações.','warning');
    return;
  }

  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.bn-item').forEach(b=>b.classList.remove('active'));
  document.getElementById('page-'+page).classList.add('active');
  const ni=document.querySelector(`.nav-item[onclick="navigate('${page}')"]`);if(ni)ni.classList.add('active');
  const bi=document.querySelector(`.bn-item[data-page="${page}"]`);if(bi)bi.classList.add('active');
  document.getElementById('pageTitle').textContent=pageTitles[page]||page;
  state.currentPage=page;closeSidebar();
  if(page==='dashboard')loadDashboard();
  else if(page==='transactions'){populateTxMonthFilter();loadTransactions();}
  else if(page==='accounts')renderAccounts();
  else if(page==='reports'){populateReportFilters();loadCurrentReport();}
  else if(page==='budgets')loadBudgets();
  else if(page==='categories')renderCategories();
  else if(page==='payees')renderPayees();
  else if(page==='scheduled')loadScheduled();
  else if(page==='import')initImportPage();
  else if(page==='settings')loadSettings();
  else if(page==='audit')loadAuditLogs();
}
// Handle SW messages (e.g., deep links from notifications)
if('serviceWorker' in navigator){
  navigator.serviceWorker.addEventListener('message', (ev)=>{
    const msg = ev.data || {};
    if(msg.type==='NAVIGATE' && msg.page){
      try{
        navigate(msg.page);
        if(msg.page==='transactions' && msg.filter?.status){
          const sel = document.getElementById('txStatusFilter');
          if(sel){ sel.value = msg.filter.status; state.txFilter = state.txFilter || {}; state.txFilter.status = sel.value; loadTransactions(); }
        }
      }catch(e){}
    }
  });
}

