let _appSettingsCache = null; // in-memory cache after first load

async function loadAppSettings() {
  if (!sb) return;
  try {
    const { data, error } = await sb.from('app_settings').select('key, value').limit(200);
    if (error) throw error;
    _appSettingsCache = {};
    (data || []).forEach(row => { _appSettingsCache[row.key] = row.value; });
    // Apply logo override (if any)
    const logo = _appSettingsCache['app_logo_url'] || '';
    if (typeof setAppLogo === 'function') setAppLogo(logo);

    // Apply menu visibility (if configured)
    try { applyMenuVisibility(_getMenuVisibilityFromCache()); } catch {}
    // Apply school link config
    try { applySchoolLink(); } catch {}
    // Apply settings visibility for non-admin users (runs after currentUser is set)
    // Will be re-applied in loadSettings() once page is open


    // Hydrate EmailJS config
    EMAILJS_CONFIG.serviceId  = _appSettingsCache['ej_service']  || localStorage.getItem('ej_service')  || '';
    EMAILJS_CONFIG.templateId = _appSettingsCache['ej_template'] || localStorage.getItem('ej_template') || '';
    EMAILJS_CONFIG.scheduledTemplateId = _appSettingsCache['ej_sched_template'] || localStorage.getItem('ej_sched_template') || '';
    EMAILJS_CONFIG.publicKey  = _appSettingsCache['ej_key']      || localStorage.getItem('ej_key')      || '';
    // Hydrate masterPin
    const dbPin = _appSettingsCache['masterPin'];
    if (dbPin) localStorage.setItem('masterPin', dbPin); // keep local in sync
    // Hydrate auto-check config
    const dbAutoCheck = _appSettingsCache[AUTO_CHECK_CONFIG_KEY];
    if (dbAutoCheck) {
      try { localStorage.setItem(AUTO_CHECK_CONFIG_KEY, JSON.stringify(dbAutoCheck)); } catch {}
    }
  } catch(e) {
    console.warn('loadAppSettings fallback to localStorage:', e.message);
    // Fallback: load from localStorage
    EMAILJS_CONFIG.serviceId  = localStorage.getItem('ej_service')  || '';
    EMAILJS_CONFIG.templateId = localStorage.getItem('ej_template') || '';
    EMAILJS_CONFIG.publicKey  = localStorage.getItem('ej_key')      || '';
  }
}

async function saveAppSetting(key, value) {
  // Always persist locally as fallback
  if (typeof value === 'object') {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  } else {
    localStorage.setItem(key, value);
  }
  if (!sb) return;
  try {
    // upsert: insert or update by key
    const { error } = await sb.from('app_settings')
      .upsert({ key, value: typeof value === 'object' ? value : value }, { onConflict: 'key' });
    if (error) throw error;
    if (!_appSettingsCache) _appSettingsCache = {};
    _appSettingsCache[key] = value;
  } catch(e) {
    console.warn('saveAppSetting DB error (saved locally):', e.message);
  }
}

async function getAppSetting(key, defaultValue = null) {
  if (_appSettingsCache && key in _appSettingsCache) return _appSettingsCache[key];
  // Fallback localStorage
  const local = localStorage.getItem(key);
  if (local !== null) {
    try { return JSON.parse(local); } catch { return local; }
  }
  return defaultValue;
}

function showEmailConfig() {
  // Populate fields with saved values
  document.getElementById('ejServiceId').value  = EMAILJS_CONFIG.serviceId;
  document.getElementById('ejTemplateId').value = EMAILJS_CONFIG.templateId;
  const stpl = document.getElementById('ejSchedTemplateId');
  if(stpl) stpl.value = EMAILJS_CONFIG.scheduledTemplateId || '';
  document.getElementById('ejPublicKey').value  = EMAILJS_CONFIG.publicKey;
  ejCheckStatus();
  openModal('emailjsModal');
}

function ejCheckStatus() {
  const svc = document.getElementById('ejServiceId').value.trim();
  const tpl = document.getElementById('ejTemplateId').value.trim();
  const schedTplEl = document.getElementById('ejSchedTemplateId');
  const stpl = schedTplEl ? schedTplEl.value.trim() : '';
  const key = document.getElementById('ejPublicKey').value.trim();
  const ok  = svc && tpl && key;
  const dot = document.getElementById('ejStatusDot');
  const txt = document.getElementById('ejStatusText');
  const sub = document.getElementById('ejSettingsSub');
  if(ok) {
    dot.className = 'ej-status-dot ej-status-ok';
    txt.textContent = '✓ Configurado — pronto para enviar';
    txt.style.color = 'var(--green)';
    if(sub) sub.textContent = `Configurado · ${svc}`;
  } else {
    dot.className = 'ej-status-dot ej-status-warn';
    txt.textContent = 'Preencha os três campos abaixo';
    txt.style.color = 'var(--muted)';
    if(sub) sub.textContent = 'Não configurado — clique para configurar';
  }
  const res = document.getElementById('ejTestResult');
  if(res) { res.className = 'ej-test-result'; res.textContent = ''; }
}

async function saveEmailJSConfig() {
  const svc = document.getElementById('ejServiceId').value.trim();
  const tpl = document.getElementById('ejTemplateId').value.trim();
  const schedTplEl = document.getElementById('ejSchedTemplateId');
  const stpl = schedTplEl ? schedTplEl.value.trim() : '';
  const key = document.getElementById('ejPublicKey').value.trim();
  if(!svc || !tpl || !key) {
    toast('Preencha todos os campos', 'error'); return;
  }
  EMAILJS_CONFIG.serviceId  = svc;
  EMAILJS_CONFIG.templateId = tpl;
  EMAILJS_CONFIG.scheduledTemplateId = stpl;
  EMAILJS_CONFIG.publicKey  = key;
  await saveAppSetting('ej_service',  svc);
  await saveAppSetting('ej_template', tpl);
  await saveAppSetting('ej_sched_template', stpl);
  await saveAppSetting('ej_key',      key);
  try { localStorage.setItem('ej_sched_template', stpl); } catch {}
  ejCheckStatus();
  closeModal('emailjsModal');
  toast('✓ EmailJS configurado e salvo no banco!', 'success');
}

function toggleEjKey() {
  const inp = document.getElementById('ejPublicKey');
  const btn = document.getElementById('ejKeyToggle');
  if(inp.type === 'password') { inp.type = 'text';     btn.textContent = '🙈'; }
  else                        { inp.type = 'password'; btn.textContent = '👁'; }
}

function copyEjField(id) {
  const val = document.getElementById(id)?.value;
  if(!val) return;
  navigator.clipboard.writeText(val).then(()=>toast('Copiado!','success'));
}

async function testEmailJSConnection() {
  const svc = document.getElementById('ejServiceId').value.trim();
  const tpl = document.getElementById('ejTemplateId').value.trim();
  const schedTplEl = document.getElementById('ejSchedTemplateId');
  const stpl = schedTplEl ? schedTplEl.value.trim() : '';
  const key = document.getElementById('ejPublicKey').value.trim();
  if(!svc || !tpl || !key) { toast('Preencha todos os campos primeiro','error'); return; }
  const btn = document.getElementById('ejTestBtn');
  const res = document.getElementById('ejTestResult');
  btn.disabled = true; btn.textContent = '⏳ Testando...';
  res.className = 'ej-test-result'; res.textContent = '';
  try {
    emailjs.init(key);
    // Send a real test email to verify credentials (uses template with minimal params)
    const testEmail = document.getElementById('ejServiceId').value.includes('@')
      ? svc : (currentUser?.email || 'teste@fintrack.app');
    await emailjs.send(svc, tpl, {
      to_email:       testEmail,
      from_name:      'J.F. Family FinTrack',
      subject:        'FinTrack — Teste de conexão ✅',
      message:        'Este é um e-mail de teste enviado pelo JF Family FinTrack para confirmar que a configuração do EmailJS está correta. Se recebeu este e-mail, está tudo funcionando!',
      report_period:  'Teste — ' + new Date().toLocaleDateString('pt-BR'),
      report_view:    'Teste de conexão',
      report_income:  'R$ 1.000,00',
      report_expense: 'R$ 800,00',
      report_balance: 'R$ 200,00',
      report_count:   '5',
      pdf_url:        'https://exemplo.com/relatorio-teste.pdf',
      pdf_name:       'FinTrack_Relatorio_Teste.pdf',
    });
    res.textContent = '✅ Conexão bem-sucedida! Verifique sua caixa de entrada.';
    res.className   = 'ej-test-result ej-test-ok';
    toast('Teste enviado com sucesso!', 'success');
  } catch(e) {
    res.textContent = '❌ Erro: ' + (e.text || e.message || JSON.stringify(e));
    res.className   = 'ej-test-result ej-test-err';
    toast('Falha no teste: ' + (e.text || e.message), 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Testar conexão';
  }
}

// Init status indicator on load
function initEmailJSStatus() {
  if(!EMAILJS_CONFIG.serviceId) return;
  const sub = document.getElementById('ejSettingsSub');
  if(sub) sub.textContent = `Configurado · ${EMAILJS_CONFIG.serviceId}`;
}


// (Lock screen removed; keep only master PIN storage for settings.)

// ── PIN Screen logic ─────────────────────────────────────────
const DEFAULT_MASTER_PIN = '191291';

function getMasterPin() {
  const v = localStorage.getItem('masterPin') || localStorage.getItem('masterpin');
  return (v && String(v).trim()) ? String(v).trim() : DEFAULT_MASTER_PIN;
}


// Ensure Supabase client is available using saved credentials.
// (Needed so the app can boot after unlocking from the PIN screen.)
function ensureSupabaseClient() {
  // Prefer an already initialized client
  if (sb) return sb;

  // Prefer bundled constants (js/config.js), fallback to previously saved credentials
  const url = (window.SUPABASE_URL || '').trim() || localStorage.getItem('sb_url');
  const key = (window.SUPABASE_ANON_KEY || '').trim() || localStorage.getItem('sb_key');

  if (!url || !key) return null;

  // Keep localStorage in sync so the rest of the app (and older code paths) keep working
  try {
    if (localStorage.getItem('sb_url') !== url) localStorage.setItem('sb_url', url);
    if (localStorage.getItem('sb_key') !== key) localStorage.setItem('sb_key', key);
  } catch (e) {
    // localStorage can fail in private mode; non-fatal
  }

  try {
    sb = supabase.createClient(url, key);
    return sb;
  } catch (e) {
    console.error('Supabase client init failed:', e);
    return null;
  }
}


function initPinScreen() {
  // Lock screen removed: always proceed without PIN
  try { const ps = document.getElementById('pinScreen'); if(ps) ps.style.display='none'; } catch(e){}
  _pinUnlocked = true;
  clearAutoLockTimer();
  // If Supabase credentials exist, boot app; otherwise show setup screen
  const url = localStorage.getItem('sb_url');
  const key = localStorage.getItem('sb_key');
  if(url && key){
    ensureSupabaseClient();
    bootApp();
  } else {
    const setup = document.getElementById('setupScreen');
    if(setup) setup.style.display='flex';
  }
}

function onPinKeyboard(e) {
  if(_pinUnlocked) {
    document.removeEventListener('keydown', onPinKeyboard);
    return;
  }
  if(e.key >= '0' && e.key <= '9') pinKey(parseInt(e.key));
  if(e.key === 'Backspace') pinDel();
}

function pinKey(digit) {
  if(_pinUnlocked) return;
  if(_pinBuffer.length >= 6) return;
  _pinBuffer += digit;
  renderPinDots();
  // Haptic feedback on mobile
  if(navigator.vibrate) navigator.vibrate(20);
  if(_pinBuffer.length === 6) {
    setTimeout(checkPin, 120);
  }
}

function pinDel() {
  if(_pinBuffer.length > 0) {
    _pinBuffer = _pinBuffer.slice(0, -1);
    renderPinDots();
  }
}

function renderPinDots() {
  for(let i = 0; i < 6; i++) {
    const dot = document.getElementById('pd'+i);
    if(dot) {
      dot.classList.toggle('filled', i < _pinBuffer.length);
      dot.classList.remove('error');
    }
  }
}

function checkPin() {
  const entered = _pinBuffer;
  const correct = getMasterPin();
  if(entered === correct) {
    // Success! Animate dots green then unlock
    for(let i = 0; i < 6; i++) {
      const dot = document.getElementById('pd'+i);
      if(dot) { dot.classList.add('filled'); dot.style.background='#7ddc9e'; }
    }
    setTimeout(unlockApp, 380);
  } else {
    // Error — shake and show message
    for(let i = 0; i < 6; i++) {
      const dot = document.getElementById('pd'+i);
      if(dot) { dot.classList.remove('filled'); dot.classList.add('error'); }
    }
    const card = document.querySelector('.pin-card');
    if(card) { card.classList.add('pin-shake'); setTimeout(()=>card.classList.remove('pin-shake'),400); }
    const msg = document.getElementById('pinErrorMsg');
    if(msg) { msg.textContent = 'PIN incorreto. Tente novamente.'; setTimeout(()=>msg.textContent='',2500); }
    if(navigator.vibrate) navigator.vibrate([60,40,60]);
    _pinBuffer = '';
    setTimeout(renderPinDots, 300);
  }
}

async function unlockApp() {
  _pinUnlocked = true;
  document.removeEventListener('keydown', onPinKeyboard);
  const pinScreen = document.getElementById('pinScreen');
  pinScreen.style.opacity = '0';
  pinScreen.style.transition = 'opacity .35s ease';
  setTimeout(() => { pinScreen.style.display = 'none'; pinScreen.style.opacity = ''; }, 350);
  // Carregar dados após PIN correto
  const client = ensureSupabaseClient();
  if(client) {
    await bootApp();
  } else {
    // Sem credenciais/supabase client — pedir configuração
    setTimeout(() => {
      document.getElementById('setupScreen').style.display = 'flex';
    }, 400);
  }
  // Iniciar timer de auto-lock
  resetAutoLockTimer();
  document.addEventListener('click', resetAutoLockTimer, { passive: true });
  document.addEventListener('touchstart', resetAutoLockTimer, { passive: true });
  document.addEventListener('keydown', resetAutoLockTimer, { passive: true });
}



// ── Change PIN modal ──────────────────────────────────────────
let _pinModalStep = 1;
let _pinModalNew = '';

function openChangePinModal() {
  _pinModalStep = 1;
  _pinModalNew = '';
  // Clear all inputs
  for(let s=1;s<=3;s++) for(let i=0;i<6;i++) {
    const el = document.getElementById(`cp${s}_${i}`);
    if(el) el.value = '';
  }
  ['pinStep1Error','pinStep3Error'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent='';});
  // Show step 1
  for(let s=1;s<=3;s++) {
    const el = document.getElementById('pinStep'+s);
    if(el) el.classList.toggle('active', s===1);
  }
  document.getElementById('pinStepBtn').textContent = 'Próximo';
  openModal('changePinModal');
  setTimeout(()=>document.getElementById('cp1_0')?.focus(), 200);
}

function pinModalInput(step, idx) {
  const el = document.getElementById(`cp${step}_${idx}`);
  if(!el) return;
  // Only allow digits
  el.value = el.value.replace(/\D/g,'').slice(-1);
  if(el.value && idx < 5) {
    const next = document.getElementById(`cp${step}_${idx+1}`);
    if(next) next.focus();
  }
  // Auto-advance when all 6 filled
  if(idx === 5 && el.value) {
    const full = Array.from({length:6},(_,i)=>document.getElementById(`cp${step}_${i}`)?.value||'').join('');
    if(full.length === 6) {
      // Brief delay so user sees last digit
      setTimeout(()=>advancePinStep(), 150);
    }
  }
}

function advancePinStep() {
  const getStepVal = s => Array.from({length:6},(_,i)=>document.getElementById(`cp${s}_${i}`)?.value||'').join('');

  if(_pinModalStep === 1) {
    const entered = getStepVal(1);
    if(entered.length < 6){toast('Digite os 6 dígitos','error');return;}
    if(entered !== getMasterPin()){
      document.getElementById('pinStep1Error').textContent = 'PIN atual incorreto.';
      for(let i=0;i<6;i++){const el=document.getElementById(`cp1_${i}`);if(el)el.value='';}
      document.getElementById('cp1_0')?.focus();
      return;
    }
    _pinModalStep = 2;
    document.getElementById('pinStep1').classList.remove('active');
    document.getElementById('pinStep2').classList.add('active');
    document.getElementById('cp2_0')?.focus();

  } else if(_pinModalStep === 2) {
    const entered = getStepVal(2);
    if(entered.length < 6){toast('Digite os 6 dígitos','error');return;}
    _pinModalNew = entered;
    _pinModalStep = 3;
    document.getElementById('pinStep2').classList.remove('active');
    document.getElementById('pinStep3').classList.add('active');
    document.getElementById('pinStepBtn').textContent = 'Salvar PIN';
    document.getElementById('cp3_0')?.focus();

  } else if(_pinModalStep === 3) {
    const confirm = getStepVal(3);
    if(confirm.length < 6){toast('Digite os 6 dígitos','error');return;}
    if(confirm !== _pinModalNew){
      document.getElementById('pinStep3Error').textContent = 'Os PINs não coincidem. Tente novamente.';
      for(let i=0;i<6;i++){const el=document.getElementById(`cp3_${i}`);if(el)el.value='';}
      document.getElementById('cp3_0')?.focus();
      return;
    }
    // Save new PIN
    localStorage.setItem('masterPin', _pinModalNew);
    localStorage.removeItem('masterpin');
    saveAppSetting('masterPin', _pinModalNew); // persist to DB
    toast('Masterpin alterado com sucesso! 🔐','success');
    closeModal('changePinModal');
  }
}

// ── Settings page ─────────────────────────────────────────────
function loadSettings() {
  loadAutoCheckConfig();
  const url = localStorage.getItem('sb_url') || '';
  const statusEl = document.getElementById('supabaseStatusLabel');
  if (statusEl && url) {
    const domain = url.replace('https://','').split('.')[0];
    statusEl.textContent = `Conectado · ${domain}.supabase.co`;
    statusEl.style.color = 'var(--green)';
  }
  const tl = document.getElementById('topbarLogoImg');
  const pt = document.getElementById('pageTitle');
  if (tl && pt) { tl.style.display='none'; pt.style.display=''; }
  if (typeof initLogoSettings === 'function') initLogoSettings();

  const isAdmin = (currentUser?.role==='admin');

  // DB Backup section — admin only
  const dbBackupSec = document.getElementById('dbBackupSection');
  if (dbBackupSec) {
    dbBackupSec.style.display = isAdmin ? '' : 'none';
    if (isAdmin) loadDbBackups();
  }

  // IA settings
  if (typeof initAiSettings === 'function') initAiSettings();

  // Seções admin-only
  const adminSections = ['settingsVisibilitySection', 'schoolLinkSection', 'userMgmtSection', 'normalizeNamesSection'];
  adminSections.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = isAdmin ? '' : 'none';
  });

  if (isAdmin) {
    // Admin: inicializar formulários das novas seções
    initSettingsVisibilityForm();
    initSchoolLinkForm();
    initServiceRoleKeySection();
    try { _loadNormalizeNamesInfo().catch(()=>{}); } catch {}
    // Mostrar menuVisibilitySection para admin sempre
    const mvSec = document.getElementById('menuVisibilitySection');
    if (mvSec) { mvSec.style.display = ''; _renderMenuVisibilityForm(); }
  } else {
    // Usuário comum: aplicar restrições de visibilidade definidas pelo admin
    applySettingsVisibility();
  }
}



/* ══════════════════════════════════════════════════════════════════
   IMPORT ENGINE v3 — Rebuilt from scratch
   Supports: MoneyWiz, Nubank, Inter, Itaú, XP, Generic CSV/XLSX
══════════════════════════════════════════════════════════════════ */


function initLogoSettings() {
  // Admin-only section: show/hide
  const isAdmin = (currentUser?.role==='admin');
  const sec = document.getElementById('logoSettingsSection');
  if(sec) sec.style.display = isAdmin ? '' : 'none';
  if(!isAdmin) return;

  const urlEl = document.getElementById('appLogoUrl');
  const fileEl = document.getElementById('appLogoFile');
  const previewEl = document.getElementById('appLogoPreview');

  const cur = getAppSetting('app_logo_url','');
  if(urlEl && cur) urlEl.value = cur;
  if(previewEl && cur) previewEl.src = cur;

  if(fileEl) {
    fileEl.onchange = async () => {
      const f = fileEl.files && fileEl.files[0];
      if(!f) return;
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result;
        if(urlEl) urlEl.value = dataUrl;
        if(previewEl) previewEl.src = dataUrl;
      };
      reader.readAsDataURL(f);
    };
  }
}

async function saveAppLogo() {
  const isAdmin = (currentUser?.role==='admin');
  if(!isAdmin) { toast('Apenas admin pode alterar o logotipo','warning'); return; }

  const urlEl = document.getElementById('appLogoUrl');
  const val = (urlEl?.value || '').trim();
  if(!val) { toast('Informe uma URL ou selecione um arquivo','warning'); return; }

  await saveAppSetting('app_logo_url', val);
  if(typeof setAppLogo === 'function') setAppLogo(val);
  const previewEl = document.getElementById('appLogoPreview');
  if(previewEl) previewEl.src = val;
  toast('Logotipo atualizado','success');
}

async function resetAppLogo() {
  const isAdmin = (currentUser?.role==='admin');
  if(!isAdmin) { toast('Apenas admin pode alterar o logotipo','warning'); return; }

  await saveAppSetting('app_logo_url', '');
  if(typeof setAppLogo === 'function') setAppLogo('');
  const urlEl = document.getElementById('appLogoUrl');
  const previewEl = document.getElementById('appLogoPreview');
  if(urlEl) urlEl.value = '';
  if(previewEl) previewEl.src = (typeof APP_LOGO_URL !== 'undefined' ? APP_LOGO_URL : (typeof DEFAULT_LOGO_URL !== 'undefined' ? DEFAULT_LOGO_URL : ''));
  toast('Logotipo restaurado','success');
}


// ─────────────────────────────────────────────
// User Preferences (per screen)
// ─────────────────────────────────────────────
function _prefKey(screen, key){
  const uid = currentUser?.id || 'local';
  return `pref_${uid}_${screen}_${key}`;
}

function getUserPreference(screen, key){
  try{
    const raw = localStorage.getItem(_prefKey(screen,key));
    if(raw===null || raw===undefined) return null;
    return raw==='true' ? true : raw==='false' ? false : raw;
  }catch(e){ return null; }
}

async function setUserPreference(screen, key, value){
  try{ localStorage.setItem(_prefKey(screen,key), String(value)); }catch(e){}
  // Best-effort persistence in DB (optional)
  try{
    if(!sb || !currentUser?.id) return;
    const prefs = {};
    prefs[key]=value;
    await sb.from('user_preferences').insert({
      user_id: currentUser.id,
      screen,
      preferences: prefs,
      created_at: new Date().toISOString()
    });
  }catch(e){
    // ignore if table missing / RLS blocks
  }
}

function loadTxCompactPreference(){
  const el = document.getElementById('txCompactToggle');
  if(!el) return;
  const pref = getUserPreference('transactions','compact_view');
  const isCompact = pref===true || pref==='true' || localStorage.getItem('tx_compact_view')==='1';
  el.checked = !!isCompact;
  const knob = document.getElementById('txCompactKnob');
  if(knob){
    knob.style.background = isCompact ? 'var(--accent)' : '#ccc';
    document.getElementById('txCompactStyle')?.remove();
    const st = document.createElement('style');
    st.id='txCompactStyle';
    st.textContent = `#txCompactKnob::before{transform:translateX(${isCompact?20:0}px)}`;
    document.head.appendChild(st);
  }
  document.body.classList.toggle('tx-compact', !!isCompact);
}

async function saveTxCompactPreference(){
  const el = document.getElementById('txCompactToggle');
  const isCompact = !!el?.checked;
  localStorage.setItem('tx_compact_view', isCompact ? '1':'0');
  await setUserPreference('transactions','compact_view', isCompact);
  loadTxCompactPreference();
  // Re-render if on transactions/dashboard
  try{
    if(state.currentPage==='transactions') renderTransactions();
    if(state.currentPage==='dashboard') loadDashboardRecent();
  }catch(e){}
}


// ── Menu Visibility (admin configurable) ───────────────────────────────
const DEFAULT_MENU_VISIBILITY = {
  dashboard: true,
  transactions: true,
  accounts: true,
  reports: true,
  budgets: true,
  scheduled: true,
  categories: true,
  payees: true,
  import: true,
  audit: true,
  settings: true
};

function _getMenuVisibilityFromCache() {
  // app_settings key
  let v = (_appSettingsCache && _appSettingsCache['menu_visibility']) || null;
  if (!v) {
    // fallback localStorage
    const raw = localStorage.getItem('menu_visibility');
    if (raw) { try { v = JSON.parse(raw); } catch {} }
  }
  if (!v || typeof v !== 'object') v = {};
  return { ...DEFAULT_MENU_VISIBILITY, ...v };
}

function applyMenuVisibility(vis) {
  if (!vis || typeof vis !== 'object') vis = _getMenuVisibilityFromCache();
  const map = {
    dashboard: 'dashboardNav',
    transactions: 'transactionsNav',
    accounts: 'accountsNav',
    reports: 'reportsNav',
    budgets: 'budgetsNav',
    scheduled: 'scheduledNav',
    categories: 'categoriesNav',
    payees: 'payeesNav',
    import: 'importNav',
    // audit and settings excluded: their visibility is managed solely by updateUserUI()
    // in auth.js. Including them here caused a race condition — applyMenuVisibility runs
    // inside bootApp() in parallel with auth loading, so currentUser may not be set yet,
    // causing the buttons to be hidden even for admin/owner users (flash then disappear).
  };
  Object.keys(map).forEach(key => {
    const el = document.getElementById(map[key]);
    if (!el) return;
    el.style.display = vis[key] ? '' : 'none';
  });
}

function _renderMenuVisibilityForm() {
  const wrap = document.getElementById('menuVisibilityForm');
  const hint = document.getElementById('menuVisibilityHint');
  if (!wrap) return;
  const vis = _getMenuVisibilityFromCache();

  const items = [
    ['dashboard',   'Dashboard'],
    ['transactions','Transações'],
    ['accounts',    'Contas'],
    ['reports',     'Relatórios'],
    ['budgets',     'Orçamentos'],
    ['scheduled',   'Programados'],
    ['categories',  'Categorias'],
    ['payees',      'Beneficiários'],
    ['import',      'Importar'],
    ['audit',       'Auditoria (admin)'],
    ['settings',    'Configurações (admin)'],
  ];

  wrap.innerHTML = items.map(([key,label]) => {
    const checked = vis[key] ? 'checked' : '';
    const disabled = (key==='audit' || key==='settings') ? '' : '';
    return `<label style="display:flex;gap:8px;align-items:center;padding:8px 10px;border:1px solid var(--border);border-radius:12px;background:var(--bg2)">
      <input type="checkbox" id="mv_${key}" ${checked} ${disabled} style="transform:scale(1.1)">
      <span style="font-size:.95rem">${label}</span>
    </label>`;
  }).join('');

  if (hint) hint.textContent = 'Dica: se você ocultar uma página, ainda poderá acessá-la via URL/atalhos internos, mas ela não aparece no menu.';
}

async function saveMenuVisibility() {
  const vis = {};
  Object.keys(DEFAULT_MENU_VISIBILITY).forEach(k => {
    const cb = document.getElementById('mv_' + k);
    if (cb) vis[k] = !!cb.checked;
  });
  await saveAppSetting('menu_visibility', vis);
  // refresh cache and apply
  if (!_appSettingsCache) _appSettingsCache = {};
  _appSettingsCache['menu_visibility'] = vis;
  applyMenuVisibility(vis);
  toast('Menu atualizado ✓', 'success');
}

async function resetMenuVisibility() {
  await saveAppSetting('menu_visibility', DEFAULT_MENU_VISIBILITY);
  if (!_appSettingsCache) _appSettingsCache = {};
  _appSettingsCache['menu_visibility'] = DEFAULT_MENU_VISIBILITY;
  _renderMenuVisibilityForm();
  applyMenuVisibility(DEFAULT_MENU_VISIBILITY);
  toast('Menu restaurado ✓', 'success');
}

// ═══════════════════════════════════════════════════════════════════
// CONTROLE DE VISIBILIDADE DAS CONFIGURAÇÕES (admin → usuários comuns)
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_SETTINGS_VISIBILITY = {
  currentUser:   true,   // Dados do usuário (sempre visível — bloqueado)
  supabase:      false,  // Conexão Supabase
  emailjs:       false,  // Configuração de e-mail
  masterPin:     false,  // PIN master
  aiSettings:    true,   // IA / Receitas
  menuItems:     false,  // Itens do menu
  autoCheck:     false,  // Automação programados
  appLogo:       false,  // Logo do app
  dbBackup:      false,  // Backup do banco
  schoolLink:    false,  // Link da escola
};

// IDs das sections no HTML indexadas pela chave
const SETTINGS_SECTION_IDS = {
  currentUser:  'currentUserSection',
  supabase:     null,   // inline — tratado à parte
  emailjs:      null,   // inline — tratado à parte
  masterPin:    null,   // inline — tratado à parte
  aiSettings:   null,   // inline — tratado à parte
  menuItems:    'menuVisibilitySection',
  autoCheck:    null,   // seção de automação — identificada pelo grupo
  appLogo:      'logoSettingsSection',
  dbBackup:     'dbBackupSection',
  schoolLink:   'schoolLinkSection',
};

const SETTINGS_VIS_LABELS = {
  currentUser:  { label: 'Perfil do usuário',         locked: true  },
  supabase:     { label: 'Conexão Supabase'                          },
  emailjs:      { label: 'Configuração de e-mail (EmailJS)'         },
  masterPin:    { label: 'PIN master de segurança'                   },
  aiSettings:   { label: 'Inteligência Artificial (receitas)'        },
  menuItems:    { label: 'Visibilidade dos itens de menu'            },
  autoCheck:    { label: 'Automação de transações programadas'       },
  appLogo:      { label: 'Logo do aplicativo'                        },
  dbBackup:     { label: 'Backup do banco de dados'                  },
  schoolLink:   { label: 'Link da escola (topbar)'                   },
};

function _getSettingsVisibility() {
  const stored = _appSettingsCache?.['settings_visibility'];
  if (stored && typeof stored === 'object') return { ...DEFAULT_SETTINGS_VISIBILITY, ...stored };
  try {
    const ls = localStorage.getItem('settings_visibility');
    if (ls) return { ...DEFAULT_SETTINGS_VISIBILITY, ...JSON.parse(ls) };
  } catch {}
  return { ...DEFAULT_SETTINGS_VISIBILITY };
}

function initSettingsVisibilityForm() {
  const wrap = document.getElementById('settingsVisibilityForm');
  if (!wrap) return;
  const vis = _getSettingsVisibility();

  wrap.innerHTML = Object.entries(SETTINGS_VIS_LABELS).map(([key, cfg]) => {
    const checked = vis[key] ? 'checked' : '';
    const locked  = cfg.locked ? 'disabled title="Sempre visível"' : '';
    return `<label style="display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid var(--border);border-radius:10px;background:var(--bg2);cursor:${cfg.locked ? 'default' : 'pointer'}">
      <input type="checkbox" id="sv_${key}" ${checked} ${locked} style="transform:scale(1.1)">
      <span style="font-size:.85rem;flex:1">${cfg.label}</span>
      ${cfg.locked ? '<span style="font-size:.72rem;color:var(--muted)">sempre</span>' : ''}
    </label>`;
  }).join('');

  const hint = document.getElementById('settingsVisibilityHint');
  if (hint) hint.textContent = 'Admins e owners sempre veem todas as configurações.';
}

async function saveSettingsVisibility() {
  const vis = {};
  Object.keys(DEFAULT_SETTINGS_VISIBILITY).forEach(k => {
    const cb = document.getElementById('sv_' + k);
    vis[k] = cb ? !!cb.checked : DEFAULT_SETTINGS_VISIBILITY[k];
  });
  vis.currentUser = true; // always locked
  await saveAppSetting('settings_visibility', vis);
  if (!_appSettingsCache) _appSettingsCache = {};
  _appSettingsCache['settings_visibility'] = vis;
  applySettingsVisibility(vis);
  toast('Configuração de acesso salva ✓', 'success');
}

async function resetSettingsVisibility() {
  await saveAppSetting('settings_visibility', DEFAULT_SETTINGS_VISIBILITY);
  if (!_appSettingsCache) _appSettingsCache = {};
  _appSettingsCache['settings_visibility'] = DEFAULT_SETTINGS_VISIBILITY;
  initSettingsVisibilityForm();
  applySettingsVisibility(DEFAULT_SETTINGS_VISIBILITY);
  toast('Visibilidade restaurada ao padrão ✓', 'success');
}

// Aplica a visibilidade das seções para usuário não-admin
function applySettingsVisibility(vis) {
  const isAdmin = (currentUser?.role === 'admin');
  if (isAdmin) return; // admins veem tudo — não aplica restrição

  vis = vis || _getSettingsVisibility();

  // Sections com ID direto
  const direct = {
    menuItems: 'menuVisibilitySection',
    appLogo:   'logoSettingsSection',
    dbBackup:  'dbBackupSection',
    schoolLink: 'schoolLinkSection',
  };
  Object.entries(direct).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el) el.style.display = vis[key] ? '' : 'none';
  });

  // Seções inline: controlar por grupo-label ou settings-section pai
  // Mapear cada settings-section pela presença de elementos-chave
  document.querySelectorAll('.settings-section').forEach(sec => {
    // Conexão Supabase
    if (sec.querySelector('#supabaseStatusLabel') && !vis.supabase)
      sec.style.display = 'none';
    // EmailJS
    if (sec.querySelector('#ejServiceId') && !vis.emailjs)
      sec.style.display = 'none';
    // PIN master
    if (sec.querySelector('#masterPin') && !vis.masterPin)
      sec.style.display = 'none';
    // IA
    if (sec.querySelector('#aiApiKeyInput, #geminiKeyInput, [id*="aiKey"], [id*="gemini"]') && !vis.aiSettings)
      sec.style.display = 'none';
    // Automação
    if (sec.querySelector('#autoCheckEnabled') && !vis.autoCheck)
      sec.style.display = 'none';
  });
}

// ═══════════════════════════════════════════════════════════════════
// LINK DA ESCOLA — configuração e aplicação
// ═══════════════════════════════════════════════════════════════════

function _getSchoolLinkConfig() {
  const stored = _appSettingsCache?.['school_link'];
  if (stored && typeof stored === 'object') return stored;
  try {
    const ls = localStorage.getItem('school_link');
    if (ls) return JSON.parse(ls);
  } catch {}
  return { enabled: true, url: 'https://deciofranchini-oss.github.io/objetivo', title: 'Gerenciamento Escola', icon: '🎓' };
}

function initSchoolLinkForm() {
  const cfg = _getSchoolLinkConfig();
  const chk = document.getElementById('schoolLinkEnabled');
  const urlEl = document.getElementById('schoolLinkUrl');
  const titleEl = document.getElementById('schoolLinkTitle');
  const iconEl = document.getElementById('schoolLinkIcon');
  const toggle = document.getElementById('schoolLinkToggle');

  if (chk) chk.checked = cfg.enabled !== false;
  if (urlEl) urlEl.value = cfg.url || '';
  if (titleEl) titleEl.value = cfg.title || 'Gerenciamento Escola';
  if (iconEl) iconEl.value = cfg.icon || '🎓';
  if (toggle) toggle.style.background = (cfg.enabled !== false) ? 'var(--accent)' : '#ccc';
  applySchoolLink(cfg);
}

async function saveSchoolLinkConfig() {
  const cfg = {
    enabled: document.getElementById('schoolLinkEnabled')?.checked ?? true,
    url:     document.getElementById('schoolLinkUrl')?.value?.trim() || '',
    title:   document.getElementById('schoolLinkTitle')?.value?.trim() || 'Gerenciamento Escola',
    icon:    document.getElementById('schoolLinkIcon')?.value?.trim() || '🎓',
  };
  const toggle = document.getElementById('schoolLinkToggle');
  if (toggle) toggle.style.background = cfg.enabled ? 'var(--accent)' : '#ccc';
  await saveAppSetting('school_link', cfg);
  if (!_appSettingsCache) _appSettingsCache = {};
  _appSettingsCache['school_link'] = cfg;
  applySchoolLink(cfg);
}

function applySchoolLink(cfg) {
  cfg = cfg || _getSchoolLinkConfig();
  const btn = document.getElementById('schoolPaymentsBtn');
  if (!btn) return;

  // Verificar permissão do usuário logado (show_school_link, default true)
  const userAllowed = typeof currentUser === 'undefined' || currentUser === null
    ? true
    : currentUser.show_school_link !== false;

  if (!cfg.enabled || !cfg.url || !userAllowed) {
    btn.style.display = 'none';
    return;
  }
  btn.style.display = 'flex';
  btn.href = cfg.url;
  btn.title = cfg.title || 'Gerenciamento Escola';
  const iconEl = btn.querySelector('span[aria-hidden]');
  if (iconEl) iconEl.textContent = cfg.icon || '🎓';
}

/* ══════════════════════════════════════════════════════════════════
   SERVICE ROLE KEY — armazenada só em localStorage, nunca no banco
   Usada para criar sbAdmin client com auth.admin.updateUserById
══════════════════════════════════════════════════════════════════ */

function initServiceRoleKeySection() {
  const isAdmin = (currentUser?.role === 'admin');
  const row = document.getElementById('serviceRoleRow');
  if (!row) return;
  row.style.display = isAdmin ? '' : 'none';
  if (!isAdmin) return;

  const saved = localStorage.getItem('sb_service_key') || '';
  const inp   = document.getElementById('serviceRoleKeyInput');
  const stat  = document.getElementById('serviceRoleKeyStatus');
  if (inp)  inp.value = saved ? '•'.repeat(20) : '';
  if (stat) {
    if (saved) {
      stat.textContent = '✓ Chave configurada — reset de senha funcionará diretamente.';
      stat.style.color = 'var(--green)';
    } else {
      stat.textContent = 'Sem chave — reset de senha usará e-mail de recuperação como fallback.';
      stat.style.color = 'var(--muted)';
    }
  }
}

function saveServiceRoleKey() {
  const inp  = document.getElementById('serviceRoleKeyInput');
  const stat = document.getElementById('serviceRoleKeyStatus');
  const val  = (inp?.value || '').trim();
  if (!val || val.includes('•')) { if (stat) { stat.textContent = 'Cole a chave completa antes de salvar.'; stat.style.color = 'var(--red)'; } return; }
  if (!val.startsWith('eyJ')) { if (stat) { stat.textContent = 'Chave inválida — deve começar com eyJ...'; stat.style.color = 'var(--red)'; } return; }
  localStorage.setItem('sb_service_key', val);
  if (inp)  inp.value = '•'.repeat(20);
  if (stat) { stat.textContent = '✓ Chave salva! Reset de senha funcionará diretamente.'; stat.style.color = 'var(--green)'; }
  toast('✓ Service Role Key salva', 'success');
  // Notificar auth.js para recriar sbAdmin
  if (typeof initSbAdmin === 'function') initSbAdmin();
}

function clearServiceRoleKey() {
  localStorage.removeItem('sb_service_key');
  const inp  = document.getElementById('serviceRoleKeyInput');
  const stat = document.getElementById('serviceRoleKeyStatus');
  if (inp)  inp.value = '';
  if (stat) { stat.textContent = 'Chave removida — reset de senha usará e-mail de recuperação.'; stat.style.color = 'var(--muted)'; }
  toast('Service Role Key removida', 'info');
  if (typeof initSbAdmin === 'function') initSbAdmin();
}

// ══════════════════════════════════════════════════════════════════════════════
// NORMALIZAÇÃO DE NOMES — admin only
// Funções: _loadNormalizeNamesInfo, openNormalizeNamesPreview, runNormalizeNames
// ══════════════════════════════════════════════════════════════════════════════

async function _loadNormalizeNamesInfo() {
  const lastRunEl = document.getElementById('normalizeNamesLastRun');
  const hintEl    = document.getElementById('normalizeNamesCronHint');
  try {
    const val = await getAppSetting('normalize_names_last_run', null);
    if (val && typeof val === 'object' && val.ran_at) {
      const d = new Date(val.ran_at);
      const fmt = d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' })
                + ' às '
                + d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
      if (lastRunEl) {
        lastRunEl.style.display = '';
        lastRunEl.innerHTML =
          `✅ Última execução: <strong>${fmt}</strong> — ` +
          `${val.payees_updated || 0} beneficiário(s) e ${val.cats_updated || 0} categoria(s) normalizados.`;
      }
    }
  } catch {}

  // Check pg_cron availability
  if (hintEl) {
    try {
      const { data } = await sb.rpc('normalize_names_cron_active').catch(() => ({ data: null }));
      hintEl.style.display = data ? 'none' : '';
    } catch { hintEl.style.display = ''; }
  }
}

async function openNormalizeNamesPreview() {
  openModal('normalizeNamesPreviewModal');
  const listEl     = document.getElementById('nnPreviewList');
  const payeeCount = document.getElementById('nnPreviewPayeeCount');
  const catCount   = document.getElementById('nnPreviewCatCount');
  if (listEl) listEl.innerHTML = '<div style="text-align:center;padding:24px;color:var(--muted)">⏳ Carregando prévia...</div>';

  try {
    const { data, error } = await sb
      .from('normalize_names_preview')
      .select('*')
      .order('tabela')
      .order('nome_atual');
    if (error) throw error;

    const rows   = data || [];
    const payees = rows.filter(r => r.tabela === 'beneficiário');
    const cats   = rows.filter(r => r.tabela === 'categoria');
    if (payeeCount) payeeCount.textContent = payees.length;
    if (catCount)   catCount.textContent   = cats.length;

    if (!rows.length) {
      listEl.innerHTML = '<div style="text-align:center;padding:24px;color:var(--muted);font-size:.85rem">✅ Todos os nomes já estão normalizados!</div>';
      return;
    }

    const rowHtml = r => `
      <div style="display:grid;grid-template-columns:90px 1fr 1fr;gap:8px;
                  padding:8px 12px;border-bottom:1px solid var(--border2);font-size:.8rem;align-items:center">
        <span style="font-size:.7rem;background:var(--surface2);border-radius:4px;
                     padding:2px 6px;text-align:center;color:var(--muted)">
          ${r.tabela === 'beneficiário' ? '👥' : '🏷️'} ${r.tabela}
        </span>
        <span style="color:var(--muted);text-decoration:line-through;
                     overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
              title="${esc(r.nome_atual)}">${esc(r.nome_atual)}</span>
        <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
              title="${esc(r.nome_normalizado)}">${esc(r.nome_normalizado)}</span>
      </div>`;

    listEl.innerHTML =
      `<div style="display:grid;grid-template-columns:90px 1fr 1fr;gap:8px;
                   padding:8px 12px;background:var(--surface2);
                   font-size:.7rem;font-weight:700;text-transform:uppercase;
                   letter-spacing:.06em;color:var(--muted)">
         <span>Tipo</span><span>Atual</span><span>Normalizado</span>
       </div>` + rows.map(rowHtml).join('');
  } catch (e) {
    if (listEl) listEl.innerHTML =
      `<div style="padding:16px;background:#fef2f2;border-radius:var(--r-sm);font-size:.82rem;color:#991b1b">
         ❌ Erro: ${esc(e.message)}<br><br>
         Execute <code>migration_normalize_names.sql</code> no Supabase primeiro.
       </div>`;
  }
}

async function runNormalizeNames() {
  if (currentUser?.role !== 'admin') {
    toast('Apenas administradores podem executar esta função.', 'error');
    return;
  }
  const btn = document.getElementById('normalizeNamesRunBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Executando...'; }
  try {
    const { data, error } = await sb.rpc('run_normalize_names');
    if (error) {
      if (error.code === '42883' || error.message?.includes('function')) {
        toast('⚠️ Execute migration_normalize_names.sql no Supabase primeiro.', 'warning');
        return;
      }
      throw error;
    }
    const p = data?.payees_updated || 0;
    const c = data?.cats_updated   || 0;
    const total = p + c;
    if (total === 0) {
      toast('✅ Todos os nomes já estão normalizados!', 'success');
    } else {
      toast(`✅ ${total} nome(s) normalizado(s): ${p} beneficiário(s), ${c} categoria(s).`, 'success');
    }
    await _loadNormalizeNamesInfo();
    if (typeof loadPayees     === 'function') await loadPayees().catch(()=>{});
    if (typeof loadCategories === 'function') await loadCategories().catch(()=>{});
    if (typeof populateSelects === 'function') populateSelects();
  } catch (e) {
    toast('Erro: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '▶ Executar agora'; }
  }
}
