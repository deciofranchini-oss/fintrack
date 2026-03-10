function setBottomNavCollapsed(collapsed){
  const nav = document.getElementById('bottomNav');
  if(!nav) return;
  nav.classList.toggle('is-collapsed', !!collapsed);
  try{ localStorage.setItem('bottomNavCollapsed', collapsed ? '1' : '0'); }catch(e){}
}

function initBottomNav(){
  const nav = document.getElementById('bottomNav');
  const toggle = document.getElementById('bottomNavToggle');
  if(!nav || !toggle || nav.dataset.init === '1') return;
  nav.dataset.init = '1';
  try{
    const saved = localStorage.getItem('bottomNavCollapsed') === '1';
    nav.classList.toggle('is-collapsed', saved);
  }catch(e){}
  toggle.addEventListener('click', (ev)=>{
    ev.stopPropagation();
    setBottomNavCollapsed(!nav.classList.contains('is-collapsed'));
  });

  let startX = 0;
  let startY = 0;
  let tracking = false;
  const start = (x,y)=>{ startX=x; startY=y; tracking=true; };
  const end = (x,y)=>{
    if(!tracking) return;
    tracking=false;
    const dx = x - startX;
    const dy = y - startY;
    if(Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy)) return;
    if(dx > 0) setBottomNavCollapsed(true);
    else if(dx < 0) setBottomNavCollapsed(false);
  };
  nav.addEventListener('touchstart', e=>{ const t=e.changedTouches[0]; start(t.clientX, t.clientY); }, {passive:true});
  nav.addEventListener('touchend', e=>{ const t=e.changedTouches[0]; end(t.clientX, t.clientY); }, {passive:true});
  nav.addEventListener('pointerdown', e=>{ start(e.clientX, e.clientY); });
  nav.addEventListener('pointerup', e=>{ end(e.clientX, e.clientY); });
}

function openSidebar(){
  setBottomNavCollapsed(true);
  document.body.classList.add('sidebar-open');
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarOverlay').classList.add('open');
  // iOS-safe: lock scroll without overflow:hidden on body
  const scrollY = window.scrollY;
  document.body.style.position='fixed';
  document.body.style.top='-'+scrollY+'px';
  document.body.style.width='100%';
  document.body.dataset.scrollY=scrollY;
}
function toggleSidebar(){
  const isOpen = document.getElementById('sidebar').classList.contains('open');
  if (isOpen) closeSidebar(); else openSidebar();
}
function closeSidebar(){
  document.body.classList.remove('sidebar-open');
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


function getSupabaseCreds(){
  try{
    const cfgUrl = (window.SUPABASE_URL || '').toString().trim();
    const cfgKey = (window.SUPABASE_ANON_KEY || '').toString().trim();
    const lsUrl = (localStorage.getItem('sb_url') || '').toString().trim();
    const lsKey = (localStorage.getItem('sb_key') || '').toString().trim();
    const url = cfgUrl || lsUrl;
    const key = cfgKey || lsKey;
    if(!url || !key) return { url:'', key:'', source:'' };
    // Keep localStorage in sync so legacy flows keep working.
    if(cfgUrl && cfgKey && (lsUrl !== cfgUrl || lsKey !== cfgKey)){
      try{ localStorage.setItem('sb_url', cfgUrl); localStorage.setItem('sb_key', cfgKey); }catch(e){}
    }
    return { url, key, source: cfgUrl && cfgKey ? 'config' : 'localStorage' };
  }catch(e){
    return { url:'', key:'', source:'' };
  }
}


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
  const creds=getSupabaseCreds();
  const url=creds.url, key=creds.key;
  if(url&&key){
    document.getElementById('supabaseUrl').value=url;
    document.getElementById('supabaseKey').value=key;

    // ── Password recovery detection ──────────────────────────────────────────
    // HOW SUPABASE v2 PKCE RESET WORKS:
    //   1. resetPasswordForEmail() sends email with link: app.com?code=XXXX
    //   2. User clicks → app loads with ?code=XXXX in the URL query string
    //   3. createClient() detects ?code and exchanges it for a session
    //   4. onAuthStateChange fires PASSWORD_RECOVERY
    //
    // THE BUG: listener was registered after createClient, missing the event.
    // tryRestoreSession() then found the new session → bootApp() → dashboard.
    //
    // THE FIX: detect ?code BEFORE createClient, set flag, create client,
    // then wait exclusively for PASSWORD_RECOVERY before doing anything else.

    const urlParams       = new URLSearchParams(window.location.search);
    const hasCodeParam    = urlParams.has('code');
    const hasLegacyHash   = window.location.hash.includes('type=recovery');
    const mightBeRecovery = hasCodeParam || hasLegacyHash;

    // Create client FIRST — Supabase JS v2 PKCE needs ?code in
    // window.location.search at this point to exchange it for a session.
    sb = supabase.createClient(url, key);

    // Strip ?code from URL AFTER client creation so a page-refresh
    // doesn't attempt to reuse the (now spent) code.
    if (hasCodeParam) {
      history.replaceState(null, '', window.location.pathname + window.location.hash);
    }

    if (mightBeRecovery) {
      // Supabase JS v2 event order when ?code= is a recovery link:
      //   INITIAL_SESSION  ← fires first (ignore this one)
      //   PASSWORD_RECOVERY ← fires second (this is the one we want)
      //
      // If it's NOT a recovery link (e.g. magic link or OAuth):
      //   INITIAL_SESSION → SIGNED_IN  (both without PASSWORD_RECOVERY)
      //
      // Strategy: collect events for up to 6 s; resolve true only if
      // PASSWORD_RECOVERY fires. Ignore INITIAL_SESSION entirely.
      // Resolve false on SIGNED_IN (magic link) or timeout.
      const isRecovery = await new Promise(resolve => {
        const timer = setTimeout(() => { sub.unsubscribe(); resolve(false); }, 6000);
        const { data: { subscription: sub } } = sb.auth.onAuthStateChange((event) => {
          if (event === 'PASSWORD_RECOVERY') {
            clearTimeout(timer); sub.unsubscribe(); resolve(true);
          } else if (event === 'SIGNED_IN') {
            // Magic link or OAuth — not a password reset
            clearTimeout(timer); sub.unsubscribe(); resolve(false);
          }
          // INITIAL_SESSION: intentionally ignored — PASSWORD_RECOVERY follows it
        });
      });

      if (isRecovery) {
        if (typeof _showRecoveryPwdForm === 'function') _showRecoveryPwdForm();
        return; // doRecoveryPwd() calls bootApp() after saving
      }
      // Not a recovery — fall through to normal boot
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Normal boot
    const restored = await tryRestoreSession().catch(()=>false);
    try{const ps=document.getElementById('pinScreen'); if(ps) ps.style.display='none';}catch(e){}
    _pinUnlocked=true;
    // Register magic-link gate to catch passwordless SIGNED_IN events
    if(typeof _registerMagicLinkGate === 'function') _registerMagicLinkGate();
    if(restored){
      hideLoginScreen?.();
      updateUserUI?.();
      await bootApp();
    } else {
      showLoginScreen();
    }
    return;
  } else {
    // No saved credentials yet
    sb = null;
  }
  // Lock screen removed
  try{const ps=document.getElementById('pinScreen'); if(ps) ps.style.display='none';}catch(e){}
  _pinUnlocked=true;
  if(url&&key){
    ensureSupabaseClient();
    const restored = await tryRestoreSession().catch(()=>false);
    if(restored){
      hideLoginScreen?.();
      updateUserUI?.();
      await bootApp();
    } else {
      showLoginScreen();
    }
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
  // Inicializa cotações FX após contas carregadas (sabe quais moedas usar)
  initFxRates().catch(e => console.warn('[FX] boot init failed:', e.message));
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
  // Aplica visibilidade do módulo de preços conforme feature flag da família
  if (typeof applyPricesFeature === 'function') applyPricesFeature().catch(() => {});
}

const pageTitles={dashboard:'Dashboard',transactions:'Transações',accounts:'Contas',reports:'Relatórios',budgets:'Orçamentos',categories:'Categorias',payees:'Beneficiários',scheduled:'Programados',import:'Importar / Backup',settings:'Configurações',prices:'Gestão de Preços'};
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
  if((page==='settings' || page==='audit') && currentUser?.role !== 'admin') {
    toast('Acesso restrito: apenas admin/owner pode acessar Configurações.','warning');
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
  else if(page==='budgets')initBudgetsPage();
  else if(page==='categories')initCategoriesPage();
  else if(page==='payees'){_loadPayeeTxCounts().then(()=>renderPayees());}
  else if(page==='scheduled')loadScheduled();
  else if(page==='import')initImportPage();
  else if(page==='settings')loadSettings();
  else if(page==='audit')loadAuditLogs();
  else if(page==='prices')initPricesPage();
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



document.addEventListener('DOMContentLoaded', initBottomNav);
