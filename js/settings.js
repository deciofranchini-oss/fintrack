let _appSettingsCache = null; // in-memory cache after first load

async function loadAppSettings() {
  if (!sb) return;
  try {
    const { data, error } = await sb.from('app_settings').select('key, value').limit(200);
    if (error) throw error;
    _appSettingsCache = {};
    (data || []).forEach(row => { _appSettingsCache[row.key] = row.value; });
    // Hydrate EmailJS config
    EMAILJS_CONFIG.serviceId  = _appSettingsCache['ej_service']  || localStorage.getItem('ej_service')  || '';
    EMAILJS_CONFIG.templateId = _appSettingsCache['ej_template'] || localStorage.getItem('ej_template') || '';
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
  document.getElementById('ejPublicKey').value  = EMAILJS_CONFIG.publicKey;
  ejCheckStatus();
  openModal('emailjsModal');
}

function ejCheckStatus() {
  const svc = document.getElementById('ejServiceId').value.trim();
  const tpl = document.getElementById('ejTemplateId').value.trim();
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
  const key = document.getElementById('ejPublicKey').value.trim();
  if(!svc || !tpl || !key) {
    toast('Preencha todos os campos', 'error'); return;
  }
  EMAILJS_CONFIG.serviceId  = svc;
  EMAILJS_CONFIG.templateId = tpl;
  EMAILJS_CONFIG.publicKey  = key;
  await saveAppSetting('ej_service',  svc);
  await saveAppSetting('ej_template', tpl);
  await saveAppSetting('ej_key',      key);
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
  if(sb) return sb;
  const url = localStorage.getItem('sb_url');
  const key = localStorage.getItem('sb_key');
  if(!url || !key) return null;
  try {
    sb = supabase.createClient(url, key);
    return sb;
  } catch(e) {
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

function lockApp() { /* lock screen removed */ }


// ── Auto-lock ─────────────────────────────────────────────────
function resetAutoLockTimer() { /* auto-lock removed */ }


function clearAutoLockTimer() {
  if(_autoLockTimer) { clearTimeout(_autoLockTimer); _autoLockTimer = null; }
}

function saveAutoLock() { /* auto-lock removed */ }


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
  loadAutoCheckConfig(); // Load automation settings
  // Update supabase status
  const url = localStorage.getItem('sb_url') || '';
  const statusEl = document.getElementById('supabaseStatusLabel');
  if(statusEl && url) {
    const domain = url.replace('https://','').split('.')[0];
    statusEl.textContent = `Conectado · ${domain}.supabase.co`;
    statusEl.style.color = 'var(--green)';
  }
  // Show topbar logo on mobile
  const tl = document.getElementById('topbarLogoImg');
  const pt = document.getElementById('pageTitle');
  if(tl && pt) { tl.style.display='none'; pt.style.display=''; }
}


/* ══════════════════════════════════════════════════════════════════
   IMPORT ENGINE v3 — Rebuilt from scratch
   Supports: MoneyWiz, Nubank, Inter, Itaú, XP, Generic CSV/XLSX
══════════════════════════════════════════════════════════════════ */
