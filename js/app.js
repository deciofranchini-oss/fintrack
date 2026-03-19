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

    const ua = navigator.userAgent || '';
    const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    const isWindows = /Windows/i.test(ua) || /Win/i.test(platform);

    // Windows browsers were the main source of mixed-cache shell issues and login flicker.
    // Keep them on network-only behavior by removing stale registrations/caches.
    if(isWindows){
      const regs = await navigator.serviceWorker.getRegistrations().catch(()=>[]);
      for(const reg of regs || []){
        try { await reg.unregister(); } catch(_) {}
      }
      if(window.caches?.keys){
        const keys = await caches.keys().catch(()=>[]);
        for(const key of keys || []){
          if(/^fintrack-shell-/i.test(key) || /workbox|sw-precache|vite|webpack/i.test(key)){
            try { await caches.delete(key); } catch(_) {}
          }
        }
      }
      return;
    }

    // GitHub Pages friendly path: sw.js at site root
    await navigator.serviceWorker.register('./sw.js?v=20260316c', { scope: './', updateViaCache: 'none' });
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
/**
 * _handleSupabaseEmailRedirect()
 *
 * Supabase email links (confirmation, reset, magic link) go to the URL configured
 * as "Site URL" in the Supabase Dashboard. If that URL points to the root domain
 * (e.g. https://deciofranchini-oss.github.io) but the app lives at a sub-path
 * (e.g. /fintrack/), email links land on the wrong page and the code/hash is lost.
 *
 * This function detects that situation and redirects to the correct app location,
 * preserving the original query string and hash so the auth flow can continue.
 *
 * PERMANENT FIX: Set the Supabase Dashboard "Site URL" to:
 *   https://deciofranchini-oss.github.io/fintrack/
 * and add it to "Redirect URLs" as well.
 */
function _handleSupabaseEmailRedirect() {
  try {
    const appBase    = getAppBaseUrl();
    const rootOrigin = window.location.origin + '/';

    // Are we on the root path but app lives in a subdirectory?
    const onWrongPath = (window.location.pathname === '/' || window.location.pathname === '/index.html')
      && appBase !== rootOrigin;

    // Does the URL contain a Supabase auth signal?
    const qs   = window.location.search;
    const hash = window.location.hash;
    const hasAuthCode = qs.includes('code=') || qs.includes('token=');
    const hasAuthHash = hash.includes('access_token') || hash.includes('type=recovery')
      || hash.includes('error=');

    if (onWrongPath && (hasAuthCode || hasAuthHash)) {
      // Redirect to the correct app path, preserving query + hash
      const target = appBase + 'index.html' + qs + hash;
      console.log('[auth-redirect] Redirecting from root to app path:', target);
      window.location.replace(target);
      return; // Page will reload
    }
  } catch(e) {
    console.warn('[auth-redirect]', e.message);
  }
}

/**
 * _detectAndShowAuthError()
 *
 * Supabase encodes errors in the URL hash when an email link fails:
 *   #error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+...
 *
 * Without handling this, the login screen appears with no explanation.
 * This function detects the error, shows a friendly modal, cleans the URL,
 * and returns true so tryAutoConnect() can skip the normal boot.
 */
function _detectAndShowAuthError() {
  try {
    const hash = window.location.hash;
    if (!hash.includes('error=')) return false;

    const params = Object.fromEntries(
      hash.slice(1).split('&').map(p => {
        const eq = p.indexOf('=');
        return [decodeURIComponent(p.slice(0, eq)), decodeURIComponent(p.slice(eq + 1).replace(/\+/g, ' '))];
      })
    );

    if (!params.error) return false;

    // Clean the URL so a refresh doesn't re-trigger this
    history.replaceState(null, '', window.location.pathname);

    const errorCode   = params.error_code   || params.error || 'unknown';
    const description = params.error_description || 'Ocorreu um erro de autenticação.';

    // Map Supabase error codes to user-friendly Portuguese messages
    const messages = {
      'otp_expired': {
        title: 'Link expirado',
        body:  'Este link de e-mail já expirou. Links são válidos por 1 hora.',
        hint:  'Se precisar redefinir a senha, use a opção "Esqueci minha senha" na tela de login.',
        icon:  '⏱️',
      },
      'access_denied': {
        title: 'Acesso negado',
        body:  description,
        hint:  'Tente novamente ou entre em contato com o administrador.',
        icon:  '🚫',
      },
      'email_not_confirmed': {
        title: 'E-mail não confirmado',
        body:  'Seu e-mail ainda não foi confirmado.',
        hint:  'Verifique sua caixa de entrada e clique no link de confirmação.',
        icon:  '📧',
      },
    };

    // Use specific message or fall back to generic
    const msg = messages[errorCode] || {
      title: 'Erro de autenticação',
      body:  description,
      hint:  'Tente novamente ou entre em contato com o administrador.',
      icon:  '⚠️',
    };

    // Show setup screen first (credentials may not be loaded yet)
    // then overlay the error message on top of login
    const creds = getSupabaseCreds();
    if (creds.url && creds.key) {
      // Credentials exist — show login screen with error overlay
      showLoginScreen?.();
      setTimeout(() => _showAuthErrorBanner(msg), 300);
    } else {
      // No credentials — show setup screen with error
      const setup = document.getElementById('setupScreen');
      if (setup) setup.style.display = 'flex';
      setTimeout(() => _showAuthErrorBanner(msg), 300);
    }

    return true; // Halt normal boot
  } catch(e) {
    console.warn('[auth-error-detect]', e.message);
    return false;
  }
}

function _showAuthErrorBanner(msg) {
  // Remove any existing banner
  document.getElementById('authErrorBanner')?.remove();

  const banner = document.createElement('div');
  banner.id = 'authErrorBanner';
  banner.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:19999',
    'background:linear-gradient(135deg,#fef2f2,#fff5f5)',
    'border-bottom:3px solid #dc2626',
    'padding:20px 24px', 'box-shadow:0 4px 24px rgba(220,38,38,.18)',
    'animation:slideDown .3s ease',
  ].join(';');

  banner.innerHTML = `
    <div style="max-width:560px;margin:0 auto;display:flex;align-items:flex-start;gap:14px">
      <span style="font-size:2rem;flex-shrink:0;margin-top:2px">${msg.icon}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:1rem;color:#991b1b;margin-bottom:4px">${msg.title}</div>
        <div style="font-size:.87rem;color:#7f1d1d;margin-bottom:6px">${msg.body}</div>
        <div style="font-size:.8rem;color:#92400e;background:#fef3c7;border-radius:6px;padding:6px 10px;border-left:3px solid #f59e0b">
          💡 ${msg.hint}
        </div>
      </div>
      <button onclick="this.closest('#authErrorBanner').remove()"
        style="flex-shrink:0;background:none;border:none;cursor:pointer;font-size:1.2rem;color:#9ca3af;padding:0;line-height:1;margin-top:2px">✕</button>
    </div>
    <style>@keyframes slideDown{from{transform:translateY(-100%)}to{transform:translateY(0)}}</style>`;

  document.body.insertAdjacentElement('afterbegin', banner);
}

async function tryAutoConnect(){
  const creds=getSupabaseCreds();
  const url=creds.url, key=creds.key;
  if(url&&key){
    document.getElementById('supabaseUrl').value=url;
    document.getElementById('supabaseKey').value=key;

    // ── Supabase email link cross-path redirect ───────────────────────────────
    // When Supabase Dashboard "Site URL" is set to the root (e.g. /),
    // but the app lives at /fintrack/, email links land on the wrong page.
    // We fix this by storing the canonical app URL in localStorage and
    // redirecting any stray code/hash back to the right location.
    _handleSupabaseEmailRedirect();

    // ── Error hash detection ──────────────────────────────────────────────────
    // Supabase signals OTP errors via hash fragments like:
    // #error=access_denied&error_code=otp_expired&error_description=...
    // Detect this early and show a friendly message instead of silently
    // showing the login screen with no explanation.
    if (_detectAndShowAuthError()) return;

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
    if(restored && currentUser){
      hideLoginScreen?.();
      updateUserUI?.();
      // If user has no family_id, show family creation screen before app boots
      if (!currentUser.family_id && currentUser.role !== 'admin' && currentUser.role !== 'owner') {
        if (typeof enforceFirstLoginFamilyCreation === 'function') {
          await enforceFirstLoginFamilyCreation();
          return; // createFirstFamily() calls bootApp() when done
        }
      }
      await bootApp();
    } else {
      // Session restored but context failed (e.g. family_id null) → show login
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

/**
 * Returns the canonical base URL of this app with trailing slash.
 * Works whether hosted at root (/) or a subpath (/fintrack/).
 * Always use this instead of window.location.origin + window.location.pathname
 * so that Supabase email links point to the correct location.
 *
 * Examples:
 *   https://deciofranchini-oss.github.io/fintrack/index.html → https://deciofranchini-oss.github.io/fintrack/
 *   https://localhost:5500/ → https://localhost:5500/
 */
function getAppBaseUrl() {
  const { origin, pathname } = window.location;
  // Strip filename (index.html) and ensure trailing slash
  const base = pathname.endsWith('/') ? pathname : pathname.substring(0, pathname.lastIndexOf('/') + 1);
  return origin + base;
}

const DEFAULT_LOGO_URL='logo_transparent.png';
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

  // For wizard header use logo2 variant (dark background, no filter CSS)
  const DARK_LOGO_URL = APP_LOGO_URL.replace(/\.png$/i, '2.png');

  ['sidebarLogoImg','settingsLogoImg','topbarLogoImg','loginLogoImg','authLogoImg'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.src = APP_LOGO_URL;
  });
  // Wizard header uses logo2 (dark green background, no CSS filter)
  const wzEl = document.getElementById('wzLogoImg');
  if(wzEl) wzEl.src = DARK_LOGO_URL;
}

// NOTE: txFilter is part of the app's internal contract (used across modules).
// Keep keys stable to avoid breaking filtering and saved preferences.
function _scrollTopAndHighlight(selector, ms) {
  try{window.scrollTo({top:0,behavior:'smooth'});}catch(_){}
  const pg=document.getElementById('page-'+(state.currentPage||''));
  if(pg) try{pg.scrollTop=0;}catch(_){}
  if(!selector) return;
  const seek=(n)=>{
    const el=typeof selector==='string'?document.querySelector(selector):selector;
    if(el){
      el.scrollIntoView({behavior:'smooth',block:'nearest'});
      el.classList.remove('item-new-hl'); void el.offsetWidth;
      el.classList.add('item-new-hl');
      setTimeout(()=>el.classList.remove('item-new-hl'),ms||2000);
    } else if(n>0) setTimeout(()=>seek(n-1),120);
  };
  setTimeout(()=>seek(6),100);
}
let state={accounts:[],groups:[],categories:[],payees:[],transactions:[],budgets:[],txPage:0,txPageSize:50,txTotal:0,txSortField:'date',txSortAsc:false,txFilter:{search:'',month:'',account:'',type:'',status:''},txView:'flat',currentPage:'dashboard',chartInstances:{},privacyMode:false};

async function bootApp(){
  registerServiceWorkerSafe();
  // Logos (can be overridden by app_settings)
  setAppLogo(APP_LOGO_URL);

  // Carregar dados essenciais — loadAppSettings corre em paralelo mas
  // nunca aborta o boot se falhar (RLS, tabela ausente, etc.)
  try {
    await Promise.all([
      DB.preload(),
      loadAppSettings().catch(e => console.warn('[boot] loadAppSettings (não fatal):', e?.message)),
    ]);
  } catch(e) {
    toast('Erro ao carregar dados: '+e.message,'error');
    return;
  }
  // Dados secundários em background — não bloqueiam o dashboard
  loadScheduled().catch(() => {});
  initFxRates().catch(e => console.warn('[FX] boot init failed:', e.message));
  // Load family composition (members) in background
  if (typeof loadFamilyComposition === 'function') {
    loadFamilyComposition().catch(() => {});
  }
  if (typeof runScheduledAutoRegister === 'function') {
    runScheduledAutoRegister().catch(() => {});
  }

  populateSelects();
  // Start auto-check timer if configured
  const _cfg = (typeof getAutoCheckConfig === 'function') ? getAutoCheckConfig() : {};
  if(_cfg.enabled && _cfg.method === 'browser' && typeof applyAutoCheckTimer === 'function') applyAutoCheckTimer(_cfg);
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
  // Sincronizar favoritos de categoria do servidor (após boot — userId disponível)
  if (typeof _syncCatFavsFromServer === 'function') {
    setTimeout(() => _syncCatFavsFromServer().then(() => {
      if (typeof renderCategories === 'function' && state.currentPage === 'categories') renderCategories();
      if (state.currentPage === 'dashboard' && typeof _renderDashFavCategories === 'function')
        _renderDashFavCategories(_lastDashIncome, _lastDashExpense);
    }).catch(()=>{}), 800); // delay para garantir sb inicializado
  }
  initEmailJSStatus();
  updateUserUI();
  // Aplica visibilidade do módulo de preços conforme feature flag da família
  if (typeof applyPricesFeature === 'function') applyPricesFeature().catch(() => {});
  if (typeof applyGroceryFeature === 'function') applyGroceryFeature().catch(() => {});
  if (typeof applyInvestmentsFeature === 'function') applyInvestmentsFeature().catch(() => {});
  // Setup wizard — shows for new users until accounts + categories + transactions exist
  if (typeof initWizard === 'function') setTimeout(() => initWizard().catch(()=>{}), 800);
}

const pageTitles={dashboard:'Dashboard',transactions:'Transações',accounts:'Contas',reports:'Relatórios',budgets:'Orçamentos',categories:'Categorias',payees:'Beneficiários',scheduled:'Programados',import:'Importar / Backup',settings:'Configurações',investments:'Carteira de Investimentos',prices:'Gestão de Preços',
  grocery:'🛒 Lista de Mercado'};

// SVG icons used in the mobile topbar (replaces text title on small screens)
const _pageIconsSVG = {
  dashboard:    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
  transactions: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
  accounts:     '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>',
  reports:      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
  budgets:      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  categories:   '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
  payees:       '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  scheduled:    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  import:       '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  settings:     '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  prices:       '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 1 0 0 7h5a3.5 3.5 0 1 1 0 7H6"/></svg>',
  grocery:      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
  audit:        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
};
async function togglePrivacy(){
  state.privacyMode=!state.privacyMode;
  const btn=document.getElementById('privacyToggleBtn');
  if(btn){
    btn.title=state.privacyMode?'Mostrar valores':'Ocultar valores';
    btn.innerHTML=state.privacyMode?
      `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`:
      `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  }

  const p=state.currentPage;
  try{
    if(p==='dashboard'){
      await loadDashboard?.();
    }else if(p==='transactions'){
      await loadTransactions?.();
    }else if(p==='accounts'){
      renderAccounts?.();
    }else if(p==='reports'){
      populateReportFilters?.();
      await loadCurrentReport?.();
    }else if(p==='budgets'){
      await loadBudgets?.();
    }else if(p==='scheduled'){
      await loadScheduled?.();
    }else if(p==='prices'){
      if (typeof _loadPricesData === 'function') await _loadPricesData();
      _populatePricesStoreFilter?.();
      _renderPricesPage?.();
    }else if(p==='payees'){
      renderPayees?.();
    }else if(p==='categories'){
      renderCategories?.();
    }
  }catch(e){
    console.warn('[privacy toggle]', e?.message || e);
  }
}

function _scrollActivePageToTop(page){
  const content = document.querySelector('.content');
  const pageEl = document.getElementById('page-'+page);
  const topTargets = [
    content,
    pageEl,
    document.scrollingElement,
    document.documentElement,
    document.body,
  ].filter(Boolean);

  topTargets.forEach(el => {
    try {
      if (typeof el.scrollTo === 'function') el.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      el.scrollTop = 0;
      el.scrollLeft = 0;
    } catch (_) {}
  });

  try { window.scrollTo({ top: 0, left: 0, behavior: 'auto' }); } catch (_) {}

  requestAnimationFrame(() => {
    topTargets.forEach(el => {
      try {
        if (typeof el.scrollTo === 'function') el.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        el.scrollTop = 0;
        el.scrollLeft = 0;
      } catch (_) {}
    });
    try { window.scrollTo({ top: 0, left: 0, behavior: 'auto' }); } catch (_) {}
  });
}

// ── Navigation history (Feature 5 — Botão Voltar) ─────────────────────────
const _navHistory = [];
function navigateBack() {
  if (_navHistory.length < 2) return;
  _navHistory.pop(); // remove current
  const prev = _navHistory.pop(); // will be re-pushed by navigate()
  if (prev) navigate(prev);
}
function _syncBackBtn() {
  const btn = document.getElementById('topbarBackBtn');
  if (btn) btn.style.display = _navHistory.length >= 2 ? 'flex' : 'none';
}


function _clearFamilySwitchNode(id, html='') {
  try {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  } catch(e) {}
}

function _resetFamilyScopedForms() {
  try {
    document.querySelectorAll('form').forEach(f => {
      try { f.reset(); } catch(e) {}
    });
  } catch(e) {}
}

function clearFamilyScopedUI() {
  try { closeSidebar?.(); } catch(e) {}
  try { closeUserMenu?.(); } catch(e) {}
  try {
    document.querySelectorAll('.modal-overlay.open').forEach(el => el.classList.remove('open'));
  } catch(e) {}

  _resetFamilyScopedForms();

  try {
    state.accounts = [];
    state.groups = [];
    state.categories = [];
    state.payees = [];
    state.transactions = [];
    state.scheduled = [];
    state.budgets = [];
    state.accountGroups = [];
    state.txTotal = 0;
    state.txPage = 0;
    state.txRunningBalanceMap = {};
    state.lastCategoryByPayee = {};
    state.cache = {};
    state.txFilter = { search: '', month: '', account: '', type: '', status: '' };
    state.txView = 'flat';
  } catch(e) {}

  try { DB?.bustAll?.(); } catch(e) {}
  try { _destroyForecastChart?.(); } catch(e) {}
  try { window._resetCatTxCounts?.(); } catch(e) {}
  try { window._resetPayeeTxCounts?.(); } catch(e) {}
  try {
    if (typeof _grocery !== 'undefined') {
      _grocery.lists = [];
      _grocery.items = [];
      _grocery.currentList = null;
    }
  } catch(e) {}
  try {
    if (typeof _px !== 'undefined') {
      _px.items = [];
      _px.stores = [];
      _px.activeItemId = null;
      _px.pidStoreFilter = '';
    }
  } catch(e) {}

  _clearFamilySwitchNode('txBody', '<tr><td colspan="7" class="text-muted" style="text-align:center;padding:24px;font-size:.83rem">Carregando dados da família…</td></tr>');
  _clearFamilySwitchNode('txGroupContainer', '');
  _clearFamilySwitchNode('txPagination', '');
  _clearFamilySwitchNode('txSummaryBar', '');
  _clearFamilySwitchNode('forecastAccountsContainer', '<div style="text-align:center;padding:24px;color:var(--muted)">Carregando dados da família…</div>');
  _clearFamilySwitchNode('groceryListsContainer', '');
  _clearFamilySwitchNode('groceryItemsContainer', '');
  _clearFamilySwitchNode('groceryTotals', '');
  _clearFamilySwitchNode('pricesItemList', '');
  _clearFamilySwitchNode('pricesCount', '');
  _clearFamilySwitchNode('accountsList', '');
  _clearFamilySwitchNode('groupsList', '');
  _clearFamilySwitchNode('categoriesList', '');
  _clearFamilySwitchNode('payeesList', '');
  _clearFamilySwitchNode('scheduledList', '');
  _clearFamilySwitchNode('budgetList', '');
  _clearFamilySwitchNode('reportResult', '');

  ['groceryDetailPanel','txBestCardSuggestion','txCurrencyPanel','txFxPanel','txCardPaymentBadge','pricesReceiptZone'].forEach(id => {
    try {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    } catch(e) {}
  });

  ['txCount','txTotalIncome','txTotalExpense','pricesCount','groceryDetailTitle'].forEach(id => {
    try {
      const el = document.getElementById(id);
      if (el) el.textContent = '';
    } catch(e) {}
  });

  ['txSearch','pricesSearch','groceryItemSearch','groceryNewListName','groceryNewItemName','groceryNewItemPrice','groceryNewItemStore','txDesc','txMemo','txTags','txPayeeName','txAttachName','txAttachLabel','pricesReceiptFileName','pricesAiStatus'].forEach(id => {
    try {
      const el = document.getElementById(id);
      if (!el) return;
      if ('value' in el) el.value = '';
      else el.textContent = '';
    } catch(e) {}
  });

  ['txPayeeId','txCategoryId','txId','txAttachUrl','txAttachNameHidden','groceryNewItemPriceItemId'].forEach(id => {
    try {
      const el = document.getElementById(id);
      if (el) el.value = '';
    } catch(e) {}
  });

  ['txPayeeDropdown','txPayeeSimilarBanner','groceryItemSuggestions','groceryItemForm','txAttachPreview'].forEach(id => {
    try {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    } catch(e) {}
  });

  ['txMonth','txAccount','txType','txStatusFilter','forecastAccountFilter','pricesCatFilter','pricesStoreFilter'].forEach(id => {
    try {
      const el = document.getElementById(id);
      if (el) el.value = '';
    } catch(e) {}
  });

  try {
    const on = document.getElementById('forecastIncludeScheduled');
    if (on) on.checked = true;
  } catch(e) {}

  try {
    const detailBody = document.getElementById('txDetailBody');
    if (detailBody) detailBody.innerHTML = '';
  } catch(e) {}
}

function navigate(page){
  // Guard: settings/audit são admin-only
  if((page==='settings'||page==='audit') && currentUser?.role !== 'admin'){
    toast('Acesso restrito: apenas Administradores globais podem acessar as Configurações.','warning');
    return;
  }

  // Track history — skip duplicate consecutive
  if (_navHistory[_navHistory.length-1] !== page) {
    _navHistory.push(page);
    if (_navHistory.length > 30) _navHistory.shift();
  }
  _syncBackBtn();

  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.bn-item').forEach(b=>b.classList.remove('active'));
  document.getElementById('page-'+page).classList.add('active');
  const ni=document.querySelector(`.nav-item[onclick="navigate('${page}')"]`);if(ni)ni.classList.add('active');
  const bi=document.querySelector(`.bn-item[data-page="${page}"]`);if(bi)bi.classList.add('active');
  document.getElementById('pageTitle').textContent=pageTitles[page]||page;
  const _iconEl=document.getElementById('pageIcon');
  if(_iconEl) _iconEl.innerHTML=_pageIconsSVG[page]||_pageIconsSVG['dashboard'];
  state.currentPage=page;closeSidebar();
  _scrollActivePageToTop(page);
  if(page==='dashboard' && sb) loadDashboard();
  else if(page==='transactions'){populateTxMonthFilter();loadTransactions();}
  else if(page==='accounts'){ if(typeof initAccountsPage==='function') initAccountsPage(); else renderAccounts(); }
  else if(page==='reports'){populateReportFilters();loadCurrentReport();}
  else if(page==='budgets')initBudgetsPage();
  else if(page==='categories')initCategoriesPage();
  else if(page==='payees'){_loadPayeeTxCounts().then(()=>renderPayees());}
  else if(page==='scheduled')loadScheduled();
  else if(page==='import')initImportPage();
  else if(page==='settings')loadSettings();
  else if(page==='audit')loadAuditLogs();
  else if(page==='investments')loadInvestmentsPage?.();
  else if(page==='prices')initPricesPage();
  else if(page==='grocery')initGroceryPage();

  setTimeout(() => _scrollActivePageToTop(page), 0);
  setTimeout(() => _scrollActivePageToTop(page), 120);
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
