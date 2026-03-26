// ── Settings tab navigation (defined here so it works regardless of HTML version) ──
function cfgShowPane(paneId) {
  document.querySelectorAll('.cfg-pane').forEach(p => p.classList.remove('active'));
  // Support both class names (cfg-tab = new design, cfg-nav-item = legacy)
  document.querySelectorAll('.cfg-tab, .cfg-nav-item').forEach(b => b.classList.remove('active'));
  const pane = document.getElementById(paneId);
  if (pane) pane.classList.add('active');
  const tab = paneId.replace('pane-', '');
  const btn = document.getElementById('cfgNavBtn-' + tab);
  if (btn) btn.classList.add('active');
  if (paneId === 'pane-avancado' && typeof initTranslationsAdmin === 'function') {
    initTranslationsAdmin();
  }
  // Scroll active tab into view on mobile
  if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
}
window.cfgShowPane = cfgShowPane;

function _cfgApplyAdminNav() {
  const isAdmin = (typeof currentUser !== 'undefined') && currentUser?.role === 'admin';
  ['cfgNavBtn-familia','cfgNavBtn-aparencia','cfgNavBtn-avancado'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = isAdmin ? '' : 'none';
  });
}
window._cfgApplyAdminNav = _cfgApplyAdminNav;

let _appSettingsCache = null; // in-memory cache after first load

async function loadAppSettings() {
  if (!sb) return;
  try {
    const { data, error } = await sb.from('app_settings').select('key, value').limit(200);
    if (error) throw error;
    _appSettingsCache = {};
    (data || []).forEach(row => { _appSettingsCache[row.key] = row.value; });
    // Merge feature flag overrides from localStorage.
    // Regra: localStorage TRUE vence DB FALSE para flags de módulo.
    // Isso garante que ativações feitas por owners (cuja escrita no DB pode ser
    // bloqueada por RLS em app_settings) não sejam revertidas no reload.
    const _featurePrefixes = ['prices_enabled_','grocery_enabled_','investments_enabled_','ai_insights_enabled_','debts_enabled_','backup_enabled_','snapshot_enabled_'];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && _featurePrefixes.some(p => k.startsWith(p))) {
        try {
          const v = localStorage.getItem(k);
          if (v !== null) {
            const lsVal = (v === 'true' || v === true);
            // localStorage true always wins; only fill if DB didn't return true
            if (lsVal || !_appSettingsCache.hasOwnProperty(k)) {
              _appSettingsCache[k] = lsVal;
            }
          }
        } catch {}
      }
    }
    // Apply logo override (if any)
    const logo = _appSettingsCache['app_logo_url'] || '';
    if (typeof setAppLogo === 'function') setAppLogo(logo);

    // Apply menu visibility (if configured)
    try { applyMenuVisibility(_getMenuVisibilityFromCache()); } catch {}
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
  try {
    if (typeof value === 'object') {
      localStorage.setItem(key, JSON.stringify(value));
    } else {
      localStorage.setItem(key, String(value));
    }
  } catch {}
  if (!_appSettingsCache) _appSettingsCache = {};
  _appSettingsCache[key] = value;
  if (!sb) return;
  try {
    const m = String(key||'').match(/^(prices_enabled_|grocery_enabled_|backup_enabled_|snapshot_enabled_|investments_enabled_|debts_enabled_|ai_insights_enabled_)(.+)$/);
    const family_id = m ? m[2] : null;
    // Feature flags: try RPC SECURITY DEFINER first (bypasses RLS)
    if (family_id) {
      try {
        const { error: rpcErr } = await sb.rpc('set_family_feature_flag', {
          p_family_id: family_id, p_key: key, p_value: !!value
        });
        if (!rpcErr) return;
      } catch {}
    }
    // Standard upsert — no family_id column in payload for schema compatibility
    const { error } = await sb.from('app_settings')
      .upsert({ key, value }, { onConflict: 'key' });
    if (error) throw error;
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

// ── Escrita direta de feature flag — bypassa RLS e tenta todos os caminhos ──
// Usado pelo toggle de módulos. Persiste em: localStorage → _appSettingsCache →
// _familyFeaturesCache → family_preferences (se disponível) → app_settings RPC/upsert.
async function saveModuleFlag(key, value, famId) {
  // 1. localStorage — sempre funciona, sobrevive reload
  try { localStorage.setItem(key, String(value)); } catch(_) {}

  // 2. Caches em memória — efeito imediato na sessão
  if (!window._appSettingsCache) window._appSettingsCache = {};
  window._appSettingsCache[key] = value;
  if (!window._familyFeaturesCache) window._familyFeaturesCache = {};
  window._familyFeaturesCache[key] = value;

  if (!window.sb) return; // sem conexão: salvo localmente, suficiente

  const modKey = key.replace(/_enabled_.*$/, ''); // ex: "debts"

  // 3. family_preferences (tabela nova — OWNER tem write via RLS)
  if (famId) {
    try {
      const col = 'module_' + modKey; // ex: "module_debts"
      const { error } = await sb.from('family_preferences')
        .upsert({ family_id: famId, [col]: !!value, updated_at: new Date().toISOString() },
                 { onConflict: 'family_id' });
      if (!error) {
        // Também atualiza o cache do family_prefs service
        if (typeof getFamilyPreferences === 'function') {
          const p = await getFamilyPreferences().catch(() => null);
          if (p && p.modules) p.modules[modKey] = !!value;
        }
        return; // persistiu no caminho novo
      }
    } catch(_) {}
  }

  // 4. RPC set_family_feature_flag (SECURITY DEFINER — bypassa RLS)
  if (famId) {
    try {
      const { error } = await sb.rpc('set_family_feature_flag',
        { p_family_id: famId, p_key: key, p_value: !!value });
      if (!error) return;
    } catch(_) {}
  }

  // 5. RPC set_family_module (da nossa migration)
  if (famId && modKey) {
    try {
      const { error } = await sb.rpc('set_family_module',
        { p_family_id: famId, p_module: modKey, p_enabled: !!value });
      if (!error) return;
    } catch(_) {}
  }

  // 6. Upsert direto em app_settings (pode falhar por RLS — best-effort)
  try {
    await sb.from('app_settings')
      .upsert({ key, value: !!value }, { onConflict: 'key' });
  } catch(_) {}

  // Mesmo que tudo falhe no DB, o valor está no localStorage.
  // Na próxima sessão loadAppSettings faz merge de localStorage → _appSettingsCache.
}
window.saveModuleFlag = saveModuleFlag;

// Força ativação/desativação de um módulo — caminho direto, sem cascade de erros
async function forceActivateModule(modKey, enabled, label) {
  const famId = window.currentUser?.family_id;
  if (!famId) { toast('Família não identificada', 'error'); return; }

  const key = modKey + '_enabled_' + famId;
  const nowOn = (enabled !== undefined) ? !!enabled : !window._familyFeaturesCache?.[key];

  await saveModuleFlag(key, nowOn, famId);

  // Aplica imediatamente na UI
  const applyMap = {
    prices:       'applyPricesFeature',
    grocery:      'applyGroceryFeature',
    investments:  'applyInvestmentsFeature',
    ai_insights:  'applyAiInsightsFeature',
    debts:        'applyDebtsFeature',
  };
  const applyFn = applyMap[modKey];
  if (applyFn && typeof window[applyFn] === 'function') {
    await window[applyFn]().catch(() => {});
  }

  const lbl = label || modKey;
  toast(nowOn ? `✓ ${lbl} ativado` : `${lbl} desativado`, 'success');
}
window.forceActivateModule = forceActivateModule;

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
  toast(t('toast.emailjs_saved'), 'success');
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
  navigator.clipboard.writeText(val).then(()=>toast(t('toast.copied'),'success'));
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
    toast(t('toast.email_sent'), 'success');
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




  // Apply admin nav tabs
  if (typeof _cfgApplyAdminNav === 'function') _cfgApplyAdminNav();

  // Seções admin-only (new design uses *2 IDs, legacy IDs kept for JS compat)
  const adminSections = ['settingsVisibilitySection', 'userMgmtSection2', 'normalizeNamesSection',
                         'orphanScanSection', 'orphanScanSection2', 'translationsSection2', 'logoSettingsSection2'];
  adminSections.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = isAdmin ? '' : 'none';
  });

  if (isAdmin) {
    // Admin: inicializar formulários das novas seções
    initSettingsVisibilityForm();
    initServiceRoleKeySection();
    try { _loadNormalizeNamesInfo().catch(()=>{}); } catch {}
    // Translations admin (admin only)
    if (typeof initTranslationsAdmin === 'function') {
      initTranslationsAdmin();
    }
    // Show translations section for admin
    const transSection = document.getElementById('translationsSection');
    if (transSection) transSection.style.display = '';
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
  const sec = document.getElementById('logoSettingsSection2') || document.getElementById('logoSettingsSection');
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

// ── Cursor image URL settings ─────────────────────────────────────────────────
const CURSOR_IMG_SETTING = 'cursor_img_url';
const CURSOR_IMG_DEFAULT = 'logocursor.png';

async function loadCursorImgSetting() {
  const isAdmin = (currentUser?.role === 'admin' || currentUser?.role === 'owner');
  if (!isAdmin) return;
  const val = await getAppSetting(CURSOR_IMG_SETTING, CURSOR_IMG_DEFAULT);
  const el = document.getElementById('cursorImgUrl');
  if (el) el.value = val || CURSOR_IMG_DEFAULT;
}

async function saveCursorImgUrl() {
  const isAdmin = (currentUser?.role === 'admin' || currentUser?.role === 'owner');
  if (!isAdmin) { toast('Apenas administradores podem alterar esta configuração', 'warning'); return; }
  const el  = document.getElementById('cursorImgUrl');
  const val = (el?.value || '').trim() || CURSOR_IMG_DEFAULT;
  await saveAppSetting(CURSOR_IMG_SETTING, val);
  // Apply immediately to the cursor module
  if (typeof window._setCursorLogoSrc === 'function') window._setCursorLogoSrc(val);
  toast('✓ Imagem do cursor salva', 'success');
}
window.saveCursorImgUrl = saveCursorImgUrl;

async function resetCursorImgUrl() {
  const isAdmin = (currentUser?.role === 'admin' || currentUser?.role === 'owner');
  if (!isAdmin) { toast('Apenas administradores podem alterar esta configuração', 'warning'); return; }
  await saveAppSetting(CURSOR_IMG_SETTING, CURSOR_IMG_DEFAULT);
  const el = document.getElementById('cursorImgUrl');
  if (el) el.value = CURSOR_IMG_DEFAULT;
  if (typeof window._setCursorLogoSrc === 'function') window._setCursorLogoSrc(CURSOR_IMG_DEFAULT);
  toast('↺ Cursor restaurado para o padrão', 'success');
}
window.resetCursorImgUrl = resetCursorImgUrl;


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
  settings: true,
  // grocery e prices são controlados por feature flag — omitidos intencionalmente
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

  // Keys admin can toggle — querySelectorAll('[data-nav="key"]') hits
  // sidebar nav-items, topbar icon buttons, and bottom nav tabs all at once.
  const STANDARD_KEYS = [
    'dashboard', 'transactions', 'accounts', 'reports', 'budgets',
    'scheduled', 'categories', 'payees', 'import',
    'grocery', 'prices',
  ];

  STANDARD_KEYS.forEach(key => {
    const show = vis[key] !== false; // default true when not explicitly set
    document.querySelectorAll('[data-nav="' + key + '"]').forEach(el => {
      // grocery/prices são controlados por feature flag — não sobrescrever
      if (el.dataset && (el.dataset.featureControlled === '1' || el.dataset.featureControlled === 'true')) return;
      el.style.display = show ? '' : 'none';
    });
  });

  // settings/telemetry: admin-only. audit: visível para todos.
  // If currentUser is not ready yet, auth.js updateUserUI() will call us again.
  if (typeof currentUser !== 'undefined' && currentUser) {
    const isAdmin = !!(currentUser.can_admin);

    ['settings', 'telemetry'].forEach(key => {
      const wantVisible = vis[key] !== false;
      document.querySelectorAll('[data-nav="' + key + '"]').forEach(el => {
        const show = isAdmin && wantVisible;
        if (el.tagName === 'BUTTON' && el.id && el.id.includes('Topbar')) {
          el.classList.toggle('admin-visible', show);
        } else {
          el.style.display = show ? '' : 'none';
        }
      });
    });

    // audit: sempre visível para todos os autenticados
    document.querySelectorAll('[data-nav="audit"]').forEach(el => { el.style.display = ''; });

    // adminNavSection wrapper: visível se settings ou telemetry estiver visível
    const adminSec = document.getElementById('adminNavSection');
    if (adminSec) {
      const anyAdmin = ['settings', 'telemetry'].some(key => vis[key] !== false);
      adminSec.style.display = (isAdmin && anyAdmin) ? '' : 'none';
    }
  }
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
    ['audit',       'Auditoria'],
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
// ── Configurações: expand/collapse section ──────────────────────────
function toggleCfgSection(bodyId) {
  // Legacy accordion toggle — no-op in new tabbed design
  // Translations lazy-init still needed
  if (bodyId === 'cfgSec_i18n') {
    if (typeof initTranslationsAdmin === 'function') initTranslationsAdmin();
  }
}


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
// FEATURE FLAGS / VISIBILIDADE POR USUÁRIO
// ═══════════════════════════════════════════════════════════════════

function currentUserFeatureEnabled(featureKey, fallback = true) {
  return fallback;
}

async function applyUserFeatureFlags() {
  try { await applyPricesFeature?.(); } catch {}
  try { await applyGroceryFeature?.(); } catch {}
  try { await applyInvestmentsFeature?.(); } catch {}
  try { await applyAiInsightsFeature?.(); } catch {}
  try { await applyDebtsFeature?.(); } catch {}
}

// ═══════════════════════════════════════════════════════════════════
// LINK DA ESCOLA — configuração e aplicação
// ═══════════════════════════════════════════════════════════════════


// ── Standalone Funcionalidades section (cfg-section dedicated to feature toggles) ──
function initFamModulesStandalone() {
  const wrap    = document.getElementById('cfgSec_features_wrap');
  const pills   = document.getElementById('famModulesPillsStandalone');
  const msgEl   = document.getElementById('famModulesMsg');
  if (!wrap || !pills) return;

  // Mostra seção para qualquer usuário autenticado com família
  // (ativação real é feita via openModuleActivationPanel que não depende de role)
  const isOwnerOrAdmin = currentUser?.can_admin || currentUser?.can_manage_family ||
                         currentUser?.role === 'owner' || currentUser?.role === 'admin';

  const famId = currentUser?.family_id
             || (typeof window.famId === 'function' ? window.famId() : null)
             || null;

  if (!famId) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';

  const keys = [
    { key: 'prices_enabled_'      + famId, label: 'Preços',          emoji: '🏷️', applyFn: 'applyPricesFeature',       desc: 'Gestão de preços e lista de compras' },
    { key: 'grocery_enabled_'     + famId, label: 'Mercado',          emoji: '🛒', applyFn: 'applyGroceryFeature',      desc: 'Lista de mercado e compras' },
    { key: 'investments_enabled_' + famId, label: 'Investimentos',    emoji: '📈', applyFn: 'applyInvestmentsFeature',  desc: 'Carteira de investimentos (requer conta do tipo Investimentos)' },
    { key: 'ai_insights_enabled_' + famId, label: 'AI Insights',      emoji: '🤖', applyFn: 'applyAiInsightsFeature',   desc: 'Análise financeira e chat com IA Gemini (requer chave API)' },
    { key: 'debts_enabled_'       + famId, label: 'Dívidas',          emoji: '💳', applyFn: 'applyDebtsFeature',        desc: 'Controle e evolução de dívidas' },
    { key: 'backup_enabled_'      + famId, label: 'Backup',           emoji: '☁️', applyFn: null,                       desc: 'Backup automático de dados' },
    { key: 'snapshot_enabled_'    + famId, label: 'Snapshot',         emoji: '📸', applyFn: null,                       desc: 'Snapshots periódicos do estado financeiro' },
  ];

  function renderCards() {
    const fc = window._familyFeaturesCache || {};
    // Cards sempre clicáveis — openModuleActivationPanel não depende de role
    pills.innerHTML = keys.map(({ key, label, emoji, applyFn, desc }) => {
      const on = fc[key] !== undefined ? !!fc[key] : (key.includes('backup') || key.includes('snapshot'));
      return `
        <div class="inv-kpi-card" style="cursor:pointer;transition:box-shadow .15s;${on ? 'border-color:var(--accent);background:var(--accent-lt)' : ''}"
             onclick="openModuleActivationPanel()"
             title="Gerenciar módulos da família">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <span style="font-size:1.3rem">${emoji}</span>
            <span style="font-size:.7rem;font-weight:700;padding:2px 8px;border-radius:20px;
              background:${on ? 'var(--accent)' : 'var(--surface2)'};
              color:${on ? '#fff' : 'var(--muted)'}">
              ${on ? '● Ativo' : '○ Inativo'}
            </span>
          </div>
          <div style="font-size:.85rem;font-weight:700;color:var(--text);margin-bottom:3px">${label}</div>
          <div style="font-size:.72rem;color:var(--muted);line-height:1.4">${desc}</div>
        </div>`;
    }).join('');
  }

  // Load cache and render — usa family_prefs service (novo) com fallback app_settings (legado)
  (async () => {
    if (!window._familyFeaturesCache) window._familyFeaturesCache = {};
    const allModuleKeys = keys.map(k => k.key);

    try {
      // 1. Tenta carregar via centralized service (family_preferences table)
      if (typeof getFamilyPreferences === 'function') {
        const prefs = await getFamilyPreferences();
        if (prefs && prefs.modules) {
          // prefs.modules = { debts: bool, prices: bool, ... }
          // Mapeia para o formato legado de cache
          keys.forEach(({ key }) => {
            const modKey = key.replace(/_enabled_.*$/, '');
            if (modKey in prefs.modules) {
              window._familyFeaturesCache[key] = !!(prefs.modules[modKey]);
            }
          });
          renderCards();
          return; // pronto — não precisa ir ao app_settings
        }
      }
    } catch(_) {}

    // 2. Fallback: app_settings legado
    try {
      const { data } = await sb.from('app_settings')
        .select('key,value')
        .in('key', allModuleKeys);
      allModuleKeys.forEach(k => {
        const row = (data || []).find(r => r.key === k);
        if (row) {
          window._familyFeaturesCache[k] = (row.value === true || row.value === 'true');
        } else {
          const local = localStorage.getItem(k);
          window._familyFeaturesCache[k] = local === 'true' || local === true
            ? true
            : (k.includes('backup') || k.includes('snapshot'));
        }
      });
    } catch(_) {}
    renderCards();
  })();
}


// ── Módulos da família na página de Configurações ──────────────────
function initFamModulesRow() {
  const row = document.getElementById('famModulesRow');
  const pills = document.getElementById('famModulesPills');
  if (!row || !pills) return;

  const isOwnerOrAdmin = currentUser?.can_admin || currentUser?.can_manage_family ||
                         currentUser?.role === 'owner' || currentUser?.role === 'admin';
  if (!isOwnerOrAdmin) { row.style.display = 'none'; return; }

  const famId = currentUser?.family_id;
  if (!famId) { row.style.display = 'none'; return; }

  row.style.display = '';

  const keys = [
    { key: 'prices_enabled_'  + famId, label: 'Preços',       emoji: '🏷️', applyFn: 'applyPricesFeature'      },
    { key: 'grocery_enabled_' + famId, label: 'Mercado',      emoji: '🛒', applyFn: 'applyGroceryFeature'     },
    { key: 'investments_enabled_' + famId, label: 'Investimentos', emoji: '📈', applyFn: 'applyInvestmentsFeature' },
    { key: 'ai_insights_enabled_' + famId, label: 'AI Insights',  emoji: '🤖', applyFn: 'applyAiInsightsFeature'  },
    { key: 'debts_enabled_'   + famId, label: 'Dívidas', emoji: '💳', applyFn: 'applyDebtsFeature' },
    { key: 'backup_enabled_'  + famId, label: 'Backup',       emoji: '☁️', applyFn: null },
    { key: 'snapshot_enabled_'+ famId, label: 'Snapshot',     emoji: '📸', applyFn: null },
  ];

  function renderPills() {
    const fc = window._familyFeaturesCache || {}; // always read live reference
    pills.innerHTML = keys.map(({ key, label, emoji, applyFn }) => {
      const on = fc[key] !== undefined ? !!fc[key] : (key.includes('backup')||key.includes('snapshot'));
      return `<button class="fam-mod-pill ${on?'on':''}"
        onclick="_cfgToggleModule('${key}','${famId}','${label}','${applyFn||''}')"
        title="${on?'Desativar':'Ativar'} ${label}">
        ${emoji} ${label}
        <span class="fam-mod-dot">${on?'●':'○'}</span>
      </button>`;
    }).join('');
  }

  // Carrega módulos via family_prefs (novo) com fallback app_settings
  (async () => {
    if (!window._familyFeaturesCache) window._familyFeaturesCache = {};
    const allRowKeys = keys.map(k => k.key);

    try {
      if (typeof getFamilyPreferences === 'function') {
        const prefs = await getFamilyPreferences();
        if (prefs && prefs.modules) {
          keys.forEach(({ key }) => {
            const modKey = key.replace(/_enabled_.*$/, '');
            if (modKey in prefs.modules) {
              window._familyFeaturesCache[key] = !!(prefs.modules[modKey]);
            }
          });
          renderPills();
          return;
        }
      }
    } catch(_) {}

    // Fallback: app_settings legado
    try {
      const { data } = await sb.from('app_settings')
        .select('key,value')
        .in('key', allRowKeys);
      allRowKeys.forEach(k => {
        const row = (data || []).find(r => r.key === k);
        if (row) {
          window._familyFeaturesCache[k] = (row.value === true || row.value === 'true');
        } else {
          const local = localStorage.getItem(k);
          window._familyFeaturesCache[k] = local === 'true'
            ? true : (k.includes('backup') || k.includes('snapshot'));
        }
      });
    } catch {}
    renderPills();
  })();
}

async function _cfgToggleModule(key, famId, label, applyFn) {
  // Access control: apenas OWNER ou admin pode ativar/desativar módulos
  if (typeof canModifyPreferences === 'function' && !canModifyPreferences()) {
    toast(typeof t === 'function' ? t('auth.only_owners') : 'Apenas owners podem gerenciar módulos.', 'warning');
    return;
  }

  if (!window._familyFeaturesCache) window._familyFeaturesCache = {};
  const wasOn = !!window._familyFeaturesCache[key];
  const nowOn = !wasOn;

  // ── Atualização otimista SÍNCRONA (todos os caches ao mesmo tempo) ─────────
  // Garante que qualquer leitura subsequente (isDebtsEnabled, etc.) veja o
  // novo valor ANTES de qualquer await, mesmo se o DB falhar depois.
  window._familyFeaturesCache[key] = nowOn;
  if (typeof _appSettingsCache !== 'undefined' && _appSettingsCache !== null) {
    _appSettingsCache[key] = nowOn;
  }
  // localStorage: persistência garantida que sobrevive reload
  // (loadAppSettings() lê e merge isso no boot)
  try { localStorage.setItem(key, String(nowOn)); } catch(_) {}

  // Aplica imediatamente sem esperar DB (UX responsivo)
  if (applyFn && typeof window[applyFn] === 'function') {
    window[applyFn]().catch(() => {});
  }
  toast(nowOn ? `✓ ${label} ativado` : `${label} desativado`, 'success');

  // ── Persistência no banco via saveModuleFlag (tenta todos os caminhos) ──────
  saveModuleFlag(key, nowOn, famId).catch(() => {
    // Silencioso: localStorage já persistiu, UI já foi atualizada
  });
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

/* ══════════════════════════════════════════════════════════════════
   TELEMETRY DASHBOARD  (admin only)
   Página completa: abas Visão Geral / Usuários / Famílias
   Filtros: período + família + usuário (interligados)
══════════════════════════════════════════════════════════════════ */

// ── Estado interno do dashboard ───────────────────────────────────────────────
const _telDash = {
  rawRows:    [],          // todos os rows do período (sem filtro)
  filtered:   [],          // rows após aplicar filtros de família/usuário
  allUsers:   [],          // [{id, name, email}] de app_users
  allFams:    [],          // [{id, name}] de families
  userSort:   { col: 'events', dir: 'desc' },
  famSort:    { col: 'events', dir: 'desc' },
  activeTab:  'overview',
  charts:     { daily: null, pages: null },
};

// ── Entry point chamado pelo navigate() ──────────────────────────────────────
async function loadTelemetryDashboard() {
  if (!currentUser?.can_admin) return;
  if (typeof sb === 'undefined' || !sb) return;

  const days   = parseInt(document.getElementById('telPeriod')?.value || '30', 10);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const since  = cutoff.toISOString();

  // Loading state
  const kpiEl = document.getElementById('telKpis');
  if (kpiEl) kpiEl.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:24px;color:var(--muted);font-size:.82rem">Carregando…</div>';

  // ── Queries em paralelo ───────────────────────────────────────────────────
  const [telRes, usersRes, famsRes] = await Promise.all([
    sb.from('app_telemetry')
      .select('event_type,page,ts,user_id,family_id,device_type,device_browser,device_os,payload')
      .gte('ts', since)
      .order('ts', { ascending: false })
      .limit(8000),
    sb.from('app_users').select('id,name,email,role').order('name'),
    sb.from('families').select('id,name').order('name'),
  ]);

  if (telRes.error) {
    const el = document.getElementById('telKpis');
    if (el) el.innerHTML = `<div style="grid-column:1/-1;color:var(--danger);font-size:.82rem;padding:8px">Erro: ${telRes.error.message}</div>`;
    return;
  }

  _telDash.rawRows  = telRes.data  || [];
  _telDash.allUsers = usersRes.data || [];
  _telDash.allFams  = famsRes.data  || [];

  // ── Popular selects de filtro ─────────────────────────────────────────────
  _telPopulateFilterSelects();

  // ── Aplicar filtros e renderizar ──────────────────────────────────────────
  _telApplyFilters();
}
window.loadTelemetryDashboard = loadTelemetryDashboard;

// ── Popula os selects de família e usuário com os dados reais ─────────────────
function _telPopulateFilterSelects() {
  const _esc = s => String(s||'').replace(/</g,'&lt;');

  // Famílias presentes nos dados + lista completa
  const famsInData = new Set(_telDash.rawRows.filter(r => r.family_id).map(r => r.family_id));
  const famSel = document.getElementById('telFilterFamily');
  if (famSel) {
    famSel.innerHTML = '<option value="">Todas as famílias</option>' +
      _telDash.allFams
        .filter(f => famsInData.has(f.id))
        .map(f => `<option value="${f.id}">${_esc(f.name)}</option>`)
        .join('');
  }

  // Usuários presentes nos dados
  const usersInData = new Set(_telDash.rawRows.filter(r => r.user_id).map(r => r.user_id));
  const userSel = document.getElementById('telFilterUser');
  if (userSel) {
    // Build name from events for users not found in app_users
    const evtUserMap = _telBuildUserMap(_telDash.rawRows);
    const knownIds = new Set(_telDash.allUsers.map(u => u.id));
    const extraUsers = [...usersInData]
      .filter(uid => !knownIds.has(uid))
      .map(uid => ({ id: uid, name: evtUserMap[uid]?._name || null, email: evtUserMap[uid]?._email || null }))
      .filter(u => u.name || u.email);
    const allUsersForFilter = [
      ..._telDash.allUsers.filter(u => usersInData.has(u.id)),
      ...extraUsers,
    ];
    userSel.innerHTML = '<option value="">Todos os usuários</option>' +
      allUsersForFilter
        .map(u => `<option value="${u.id}">${_esc(u.name || u.email || u.id.slice(0,8))}</option>`)
        .join('');
  }
}

// ── Aplica filtros e re-renderiza tudo ────────────────────────────────────────
function _telApplyFilters() {
  const famFilter  = document.getElementById('telFilterFamily')?.value  || '';
  const userFilter = document.getElementById('telFilterUser')?.value    || '';

  // Filtrar usuários disponíveis baseado na família selecionada
  if (famFilter) {
    const usersInFam = new Set(
      _telDash.rawRows.filter(r => r.family_id === famFilter && r.user_id).map(r => r.user_id)
    );
    const userSel = document.getElementById('telFilterUser');
    if (userSel) {
      const cur = userSel.value;
      userSel.innerHTML = '<option value="">Todos os usuários</option>' +
        _telDash.allUsers
          .filter(u => usersInFam.has(u.id))
          .map(u => `<option value="${u.id}">${u.name || u.email}</option>`)
          .join('');
      if (cur && usersInFam.has(cur)) userSel.value = cur;
    }
  } else {
    _telPopulateFilterSelects();
    const userSel = document.getElementById('telFilterUser');
    if (userSel && userFilter) userSel.value = userFilter;
  }

  // Aplicar filtros aos dados
  _telDash.filtered = _telDash.rawRows.filter(r => {
    if (famFilter  && r.family_id !== famFilter)  return false;
    if (userFilter && r.user_id   !== userFilter) return false;
    return true;
  });

  // Re-renderizar aba ativa
  _telRenderCurrentTab();
}
window._telApplyFilters = _telApplyFilters;

// ── Controle de abas ──────────────────────────────────────────────────────────
function _telSetTab(tab) {
  _telDash.activeTab = tab;
  ['overview','users','families'].forEach(t => {
    const pane = document.getElementById('telPane_' + t);
    const btn  = document.getElementById('telTab_'  + t);
    if (!pane || !btn) return;
    const active = t === tab;
    pane.style.display = active ? '' : 'none';
    btn.classList.toggle('active', active);
  });
  _telRenderCurrentTab();
}
window._telSetTab = _telSetTab;

function _telRenderCurrentTab() {
  const rows = _telDash.filtered;
  if (!rows) return;
  const days = parseInt(document.getElementById('telPeriod')?.value || '30', 10);

  if (_telDash.activeTab === 'overview') {
    if (!rows.length) { _telRenderEmpty(); return; }
    _telRenderKpis(rows, days);
    _telRenderDailyChart(rows, days);
    _telRenderPagesChart(rows);
    _telRenderEventTypes(rows);
    _telRenderDevices(rows);
    _telRenderErrors(rows);
    _telRenderAiCalls(rows);
  } else if (_telDash.activeTab === 'users') {
    _telRenderUsersTable(rows);
  } else if (_telDash.activeTab === 'families') {
    _telRenderFamiliesTable(rows);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const _telEsc = s => String(s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const _telFamName   = id => _telDash.allFams.find(f => f.id === id)?.name || '—';
// _telUserName/_telUserEmail: lookup by app_users.id first, then fall back to data embedded in events
const _telUserName  = (id, evtMap) => {
  const u = _telDash.allUsers.find(u => u.id === id);
  if (u) return u.name || u.email || '—';
  const em = evtMap ? evtMap[id] : null;
  return em?._name || em?._email || '—';
};
const _telUserEmail = (id, evtMap) => {
  const u = _telDash.allUsers.find(u => u.id === id);
  if (u) return u.email || '';
  const em = evtMap ? evtMap[id] : null;
  return em?._email || '';
};

function _telRenderEmpty() {
  const kpi = document.getElementById('telKpis');
  if (kpi) kpi.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:32px;color:var(--muted);font-size:.82rem">Nenhum dado encontrado para os filtros selecionados.</div>';
  ['telEventTypes','telDevices','telErrors','telAiCalls'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<div style="color:var(--muted);font-size:.78rem;padding:4px 0">—</div>';
  });
}

// ── KPI cards ─────────────────────────────────────────────────────────────────
function _telRenderKpis(rows, days) {
  const total     = rows.length;
  const users     = new Set(rows.filter(r => r.user_id).map(r => r.user_id)).size;
  const families  = new Set(rows.filter(r => r.family_id).map(r => r.family_id)).size;
  const errors    = rows.filter(r => r.event_type === 'error' || r.event_type === 'uncaught').length;
  const aiCalls   = rows.filter(r => r.event_type === 'ai_call').length;
  const pageViews = rows.filter(r => r.event_type === 'page_view').length;
  const perDay    = days > 0 ? (total / days).toFixed(1) : '—';

  const kpiEl = document.getElementById('telKpis');
  if (!kpiEl) return;

  const s = `background:var(--surface2);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:2px;border:1px solid var(--border)`;
  const n = `font-size:1.4rem;font-weight:700;color:var(--text);line-height:1.1`;
  const l = `font-size:.68rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em`;

  kpiEl.innerHTML = [
    { v: total.toLocaleString('pt-BR'),     lb: 'Total eventos' },
    { v: pageViews.toLocaleString('pt-BR'), lb: 'Page views' },
    { v: users.toLocaleString('pt-BR'),     lb: 'Usuários únicos' },
    { v: families.toLocaleString('pt-BR'),  lb: 'Famílias ativas' },
    { v: perDay,                            lb: 'Eventos / dia' },
    { v: aiCalls.toLocaleString('pt-BR'),   lb: 'Chamadas IA' },
    { v: errors.toLocaleString('pt-BR'),    lb: 'Erros', danger: errors > 0 },
  ].map(c => `<div style="${s}">
    <span style="${n}${c.danger ? ';color:var(--danger)' : ''}">${c.v}</span>
    <span style="${l}">${c.lb}</span>
  </div>`).join('');
}

// ── Daily chart ───────────────────────────────────────────────────────────────
function _telRenderDailyChart(rows, days) {
  const canvas = document.getElementById('telDailyChart');
  if (!canvas || typeof Chart === 'undefined') return;

  const buckets = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    buckets[d.toISOString().slice(0,10)] = 0;
  }
  rows.forEach(r => { const day = (r.ts||'').slice(0,10); if (day in buckets) buckets[day]++; });

  const labels = Object.keys(buckets).map(d => { const [,m,dd] = d.split('-'); return `${dd}/${m}`; });

  if (_telDash.charts.daily) { _telDash.charts.daily.destroy(); _telDash.charts.daily = null; }
  _telDash.charts.daily = new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets: [{ data: Object.values(buckets), backgroundColor: 'rgba(59,130,246,.55)', borderColor: 'rgba(59,130,246,.9)', borderWidth: 1, borderRadius: 3 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { font: { size: 9 }, maxTicksLimit: 10, color: '#888' }, grid: { display: false } },
        y: { ticks: { font: { size: 9 }, color: '#888' }, grid: { color: 'rgba(128,128,128,.1)' }, beginAtZero: true },
      }
    }
  });
}

// ── Pages chart ───────────────────────────────────────────────────────────────
function _telRenderPagesChart(rows) {
  const canvas = document.getElementById('telPagesChart');
  if (!canvas || typeof Chart === 'undefined') return;

  const counts = {};
  rows.filter(r => r.event_type === 'page_view' && r.page)
      .forEach(r => { counts[r.page] = (counts[r.page]||0)+1; });
  const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,8);

  if (!sorted.length) { canvas.parentElement.innerHTML = '<div style="color:var(--muted);font-size:.78rem;padding:20px 0;text-align:center">—</div>'; return; }

  const palette = ['rgba(99,102,241,.7)','rgba(59,130,246,.7)','rgba(16,185,129,.7)','rgba(245,158,11,.7)','rgba(239,68,68,.7)','rgba(139,92,246,.7)','rgba(20,184,166,.7)','rgba(249,115,22,.7)'];
  if (_telDash.charts.pages) { _telDash.charts.pages.destroy(); _telDash.charts.pages = null; }
  _telDash.charts.pages = new Chart(canvas, {
    type: 'doughnut',
    data: { labels: sorted.map(([k])=>k), datasets: [{ data: sorted.map(([,v])=>v), backgroundColor: palette, borderWidth: 1 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { font: { size: 9 }, boxWidth: 10, padding: 6, color: '#888' } } } }
  });
}

// ── Event types ───────────────────────────────────────────────────────────────
function _telRenderEventTypes(rows) {
  const el = document.getElementById('telEventTypes'); if (!el) return;
  const counts = {}; rows.forEach(r => { counts[r.event_type||'unknown'] = (counts[r.event_type||'unknown']||0)+1; });
  const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
  const total = rows.length;
  const LABELS = { page_view:'📄 Page view', page_time:'⏱️ Tempo em tela', operation:'⚙️ Operação', error:'🔴 Erro', ai_call:'🤖 IA', metric:'📐 Métrica', toast:'💬 Toast', uncaught:'💥 Erro não capturado' };
  el.innerHTML = sorted.map(([type, count]) => {
    const pct = ((count/total)*100).toFixed(1);
    return `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--border)">
      <span style="flex:1;color:var(--text)">${LABELS[type]||type}</span>
      <div style="width:80px;height:6px;background:var(--border);border-radius:3px;overflow:hidden"><div style="width:${pct}%;height:100%;background:var(--accent);border-radius:3px"></div></div>
      <span style="min-width:36px;text-align:right;color:var(--muted)">${count.toLocaleString('pt-BR')}</span>
      <span style="min-width:36px;text-align:right;color:var(--muted)">${pct}%</span>
    </div>`;
  }).join('');
}

// ── Devices ───────────────────────────────────────────────────────────────────
function _telRenderDevices(rows) {
  const el = document.getElementById('telDevices'); if (!el) return;
  const byType={}, byBrowser={}, byOs={};
  rows.forEach(r => {
    if (r.device_type)    byType[r.device_type]       = (byType[r.device_type]||0)+1;
    if (r.device_browser) byBrowser[r.device_browser] = (byBrowser[r.device_browser]||0)+1;
    if (r.device_os)      byOs[r.device_os]           = (byOs[r.device_os]||0)+1;
  });
  const total = rows.length;
  const rg = (title, map) => {
    const s = Object.entries(map).sort((a,b)=>b[1]-a[1]);
    if (!s.length) return '';
    return `<div style="font-size:.7rem;font-weight:600;color:var(--muted);text-transform:uppercase;margin:8px 0 4px">${title}</div>` +
      s.map(([k,v]) => { const p=((v/total)*100).toFixed(1);
        return `<div style="display:flex;align-items:center;gap:6px;padding:3px 0">
          <span style="flex:1;color:var(--text);font-size:.78rem">${k}</span>
          <div style="width:60px;height:5px;background:var(--border);border-radius:3px;overflow:hidden"><div style="width:${p}%;height:100%;background:var(--accent);border-radius:3px"></div></div>
          <span style="min-width:30px;text-align:right;color:var(--muted);font-size:.75rem">${p}%</span>
        </div>`;
      }).join('');
  };
  el.innerHTML = rg('Tipo', byType) + rg('Navegador', byBrowser) + rg('Sistema', byOs);
}

// ── Recent errors ─────────────────────────────────────────────────────────────
function _telRenderErrors(rows) {
  const el = document.getElementById('telErrors'); if (!el) return;
  const errors = rows.filter(r => r.event_type === 'error' || r.event_type === 'uncaught' || r.event_type === 'unhandled_promise').slice(0, 30);
  if (!errors.length) { el.innerHTML = '<div style="color:var(--muted);font-size:.78rem;padding:4px 0">✅ Nenhum erro no período</div>'; return; }

  const _evtMap = _telBuildUserMap(rows);

  el.innerHTML = `<div class="tel-error-list">
    ${errors.map((r, i) => {
      const d   = (r.ts||'').slice(0,16).replace('T',' ');
      const usr = r.user_id ? _telUserName(r.user_id, _evtMap) : '—';
      const email = r.user_id ? _telUserEmail(r.user_id) : '';
      const msg = r.payload?.message || r.payload?.source || r.payload?.error_msg || '';
      const file = r.payload?.file ? ` @ ${r.payload.file}` : '';
      const line = r.payload?.line ? `:${r.payload.line}` : '';
      const shortMsg = msg.slice(0, 90) + (msg.length > 90 ? '…' : '');
      const fullPayload = JSON.stringify(r.payload || {}, null, 2);
      // Build the Claude prompt for this error
      const claudePrompt = `Encontrei este erro no app FintTrack:

**Tipo:** ${r.event_type}
**Data:** ${d}
**Usuário:** ${usr}${email ? ` (${email})` : ''}
**Página:** ${r.page || '—'}

**Mensagem:** ${msg || '—'}
**Arquivo:** ${r.payload?.file || '—'}${line}

**Payload completo:**
\`\`\`json
${fullPayload}
\`\`\`

Por favor, analise o erro e sugira a correção.`;

      return `<div class="tel-error-item" id="telErr-${i}">
        <div class="tel-error-header" onclick="_telToggleError(${i})">
          <div class="tel-error-main">
            <span class="tel-error-type">${_telEsc(r.event_type)}</span>
            <span class="tel-error-msg" title="${_telEsc(msg)}">${_telEsc(shortMsg || '(sem mensagem)')}</span>
          </div>
          <div class="tel-error-meta">
            <span class="tel-error-date">${d}</span>
            <span class="tel-error-user" title="${_telEsc(email)}">${_telEsc(usr)}</span>
            <span class="tel-error-toggle" id="telErrArrow-${i}">▼</span>
          </div>
        </div>
        <div class="tel-error-detail" id="telErrDetail-${i}" style="display:none">
          <div class="tel-error-detail-grid">
            <div><span class="tel-error-dl">Página</span><span class="tel-error-dd">${_telEsc(r.page || '—')}</span></div>
            <div><span class="tel-error-dl">Arquivo</span><span class="tel-error-dd">${_telEsc((r.payload?.file||'—') + line)}</span></div>
            <div><span class="tel-error-dl">Dispositivo</span><span class="tel-error-dd">${_telEsc([r.device_type, r.device_os, r.device_browser].filter(Boolean).join(' / ') || '—')}</span></div>
            <div><span class="tel-error-dl">Sessão</span><span class="tel-error-dd" style="font-family:monospace;font-size:.7rem">${_telEsc(r.session_id?.slice(0,12)||'—')}</span></div>
          </div>
          <div class="tel-error-payload-label">Payload completo:</div>
          <pre class="tel-error-payload">${_telEsc(fullPayload)}</pre>
          <div class="tel-error-actions">
            <button class="tel-copy-btn" onclick="event.stopPropagation();_telCopyErrorToClipboard(${i})" data-payload="${_telEsc(claudePrompt).replace(/"/g,'&quot;')}">
              📋 Copiar para o Claude
            </button>
            <span class="tel-copy-confirm" id="telCopyOk-${i}" style="display:none;color:var(--green);font-size:.75rem">✓ Copiado!</span>
          </div>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function _telToggleError(i) {
  const detail = document.getElementById('telErrDetail-' + i);
  const arrow  = document.getElementById('telErrArrow-' + i);
  if (!detail) return;
  const open = detail.style.display !== 'none';
  detail.style.display = open ? 'none' : 'block';
  if (arrow) arrow.textContent = open ? '▼' : '▲';
}

function _telCopyErrorToClipboard(i) {
  const btn = document.querySelector(`#telErr-${i} .tel-copy-btn`);
  const payload = btn?.getAttribute('data-payload') || '';
  // Decode HTML entities
  const decoded = payload.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  navigator.clipboard.writeText(decoded).then(() => {
    const ok = document.getElementById('telCopyOk-' + i);
    if (ok) { ok.style.display = 'inline'; setTimeout(() => { ok.style.display = 'none'; }, 2500); }
  }).catch(() => {
    // Fallback: select text
    const pre = document.querySelector(`#telErr-${i} .tel-error-payload`);
    if (pre) {
      const range = document.createRange();
      range.selectNode(pre);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
    }
  });
}

// ── AI calls ──────────────────────────────────────────────────────────────────
function _telRenderAiCalls(rows) {
  const el = document.getElementById('telAiCalls'); if (!el) return;
  const ai = rows.filter(r => r.event_type === 'ai_call');
  if (!ai.length) { el.innerHTML = '<div style="color:var(--muted);font-size:.78rem;padding:4px 0">Nenhuma chamada de IA registrada</div>'; return; }
  const byFeature = {};
  let totalIn=0, totalOut=0, totalMs=0, errors=0;
  ai.forEach(r => {
    const f = r.payload?.feature || 'desconhecida';
    if (!byFeature[f]) byFeature[f] = { count:0, tokensIn:0, tokensOut:0, errors:0 };
    byFeature[f].count++;
    byFeature[f].tokensIn  += r.payload?.tokens_in  || 0;
    byFeature[f].tokensOut += r.payload?.tokens_out || 0;
    if (r.payload?.success === false) { byFeature[f].errors++; errors++; }
    totalIn  += r.payload?.tokens_in  || 0;
    totalOut += r.payload?.tokens_out || 0;
    totalMs  += r.payload?.latency_ms || 0;
  });
  const avgMs = ai.length ? Math.round(totalMs/ai.length) : 0;
  const rs = 'display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--border);font-size:.78rem';
  el.innerHTML = `<div style="${rs};font-weight:600;color:var(--muted);font-size:.7rem;text-transform:uppercase">
    <span style="flex:1">Feature</span><span style="min-width:50px;text-align:right">Calls</span>
    <span style="min-width:70px;text-align:right">Tokens ↑</span><span style="min-width:70px;text-align:right">Tokens ↓</span>
    <span style="min-width:40px;text-align:right">Erros</span></div>` +
    Object.entries(byFeature).sort((a,b)=>b[1].count-a[1].count).map(([f,s]) =>
      `<div style="${rs}"><span style="flex:1;color:var(--text)">${f}</span>
      <span style="min-width:50px;text-align:right;color:var(--muted)">${s.count}</span>
      <span style="min-width:70px;text-align:right;color:var(--muted)">${s.tokensIn.toLocaleString('pt-BR')}</span>
      <span style="min-width:70px;text-align:right;color:var(--muted)">${s.tokensOut.toLocaleString('pt-BR')}</span>
      <span style="min-width:40px;text-align:right;${s.errors>0?'color:var(--danger)':'color:var(--muted)'}">${s.errors||'—'}</span></div>`
    ).join('') +
    `<div style="${rs};color:var(--muted);font-size:.72rem;margin-top:4px">
      Total: ${ai.length} calls · ${(totalIn+totalOut).toLocaleString('pt-BR')} tokens · Latência média: ${avgMs}ms · ${errors} erros</div>`;
}

/* ══════════════════════════════════════════════════════════════════
   ABA USUÁRIOS
══════════════════════════════════════════════════════════════════ */

// Constrói o mapa de dados por usuário a partir dos rows filtrados
function _telBuildUserMap(rows) {
  const map = {};
  rows.forEach(r => {
    const uid = r.user_id; if (!uid) return;
    if (!map[uid]) map[uid] = { events:0, pages:0, errors:0, ai:0, ops:0, sessions:new Set(), lastSeen:r.ts, family_id:r.family_id, pageCount:{}, opCount:{}, _name:null, _email:null };
    map[uid].events++;
    // Capture name/email from payload._u (stored since telemetry v2)
    if (!map[uid]._name  && r.payload?._u?.name)  map[uid]._name  = r.payload._u.name;
    if (!map[uid]._email && r.payload?._u?.email) map[uid]._email = r.payload._u.email;
    if (r.event_type === 'page_view')               { map[uid].pages++; map[uid].pageCount[r.page||'?'] = (map[uid].pageCount[r.page||'?']||0)+1; }
    if (r.event_type === 'error' || r.event_type === 'uncaught') map[uid].errors++;
    if (r.event_type === 'ai_call')                 map[uid].ai++;
    if (r.event_type === 'operation')               { map[uid].ops++; const op = r.payload?.operation||'?'; map[uid].opCount[op] = (map[uid].opCount[op]||0)+1; }
    if ((r.ts||'') > (map[uid].lastSeen||''))        map[uid].lastSeen = r.ts;
    // session heuristic: user_id + day
    map[uid].sessions.add(uid + (r.ts||'').slice(0,10));
  });
  return map;
}

function _telRenderUsersTable(rows) {
  const body = document.getElementById('telUsersBody'); if (!body) return;
  const map = _telBuildUserMap(rows);
  let entries = Object.entries(map).map(([id, s]) => ({ id, ...s, sessions: s.sessions.size, name: _telUserName(id, map), email: _telUserEmail(id, map), famName: _telFamName(s.family_id) }));

  // Sort
  const { col, dir } = _telDash.userSort;
  const colMap = { name:'name', family:'famName', events:'events', sessions:'sessions', pages:'pages', errors:'errors', last:'lastSeen' };
  entries.sort((a, b) => {
    const av = a[colMap[col]||col] || 0, bv = b[colMap[col]||col] || 0;
    const cmp = typeof av === 'string' ? av.localeCompare(bv) : (bv - av);
    return dir === 'desc' ? cmp : -cmp;
  });

  if (!entries.length) { body.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:28px;color:var(--muted)">Nenhum dado para os filtros selecionados</td></tr>'; return; }

  body.innerHTML = entries.map(u => `
    <tr style="border-bottom:1px solid var(--border);cursor:pointer" onclick="_telOpenUserDetail('${u.id}')" onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background=''">
      <td style="padding:8px 10px">
        <div style="font-weight:600;font-size:.82rem;color:var(--text)">${_telEsc(u.name)}</div>
        <div style="font-size:.72rem;color:var(--muted)">${_telEsc(u.email)}</div>
      </td>
      <td style="padding:8px 10px;color:var(--muted);font-size:.8rem">${_telEsc(u.famName)}</td>
      <td style="padding:8px 10px;text-align:right;font-weight:600;color:var(--text)">${u.events.toLocaleString('pt-BR')}</td>
      <td style="padding:8px 10px;text-align:right;color:var(--muted)">${u.sessions}</td>
      <td style="padding:8px 10px;text-align:right;color:var(--muted)">${u.pages}</td>
      <td style="padding:8px 10px;text-align:right;${u.errors>0?'color:var(--danger);font-weight:600':'color:var(--muted)'}">${u.errors||'—'}</td>
      <td style="padding:8px 10px;text-align:right;color:var(--muted);font-size:.78rem;white-space:nowrap">${(u.lastSeen||'').slice(0,10)}</td>
    </tr>`).join('');
}

function _telSortUsers(col) {
  if (_telDash.userSort.col === col) {
    _telDash.userSort.dir = _telDash.userSort.dir === 'desc' ? 'asc' : 'desc';
  } else {
    _telDash.userSort = { col, dir: 'desc' };
  }
  // Update sort indicators
  ['name','family','events','sessions','pages','errors','last'].forEach(c => {
    const el = document.getElementById('telUserSort_' + c);
    if (!el) return;
    el.textContent = c === col ? (_telDash.userSort.dir === 'desc' ? '↓' : '↑') : '';
  });
  _telRenderUsersTable(_telDash.filtered);
}
window._telSortUsers = _telSortUsers;

function _telFilterUsersTable(q) {
  const body = document.getElementById('telUsersBody'); if (!body) return;
  const rows = body.querySelectorAll('tr');
  const lq = q.toLowerCase();
  rows.forEach(r => {
    r.style.display = (!lq || r.textContent.toLowerCase().includes(lq)) ? '' : 'none';
  });
}
window._telFilterUsersTable = _telFilterUsersTable;

function _telOpenUserDetail(uid) {
  const map = _telBuildUserMap(_telDash.filtered);
  const u = map[uid]; if (!u) return;

  const name  = _telUserName(uid, map);
  const email = _telUserEmail(uid, map);

  document.getElementById('telUserDetailAvatar').textContent = (name||'?')[0].toUpperCase();
  document.getElementById('telUserDetailName').textContent   = name;
  document.getElementById('telUserDetailMeta').textContent   = email + (u.family_id ? ' · ' + _telFamName(u.family_id) : '');

  const s = `background:var(--surface2);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:2px;border:1px solid var(--border)`;
  const n = `font-size:1.3rem;font-weight:700;color:var(--text);line-height:1.1`;
  const l = `font-size:.68rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em`;
  document.getElementById('telUserDetailKpis').innerHTML = [
    { v: u.events,          lb: 'Eventos' },
    { v: u.sessions.size||u.sessions, lb: 'Sessões' },
    { v: u.pages,           lb: 'Page views' },
    { v: u.ai,              lb: 'Chamadas IA' },
    { v: u.errors,          lb: 'Erros', danger: u.errors > 0 },
  ].map(c => `<div style="${s}"><span style="${n}${c.danger?';color:var(--danger)':''}">${typeof c.v==='number'?c.v.toLocaleString('pt-BR'):c.v}</span><span style="${l}">${c.lb}</span></div>`).join('');

  // Pages
  const pages = Object.entries(u.pageCount).sort((a,b)=>b[1]-a[1]).slice(0,8);
  document.getElementById('telUserDetailPages').innerHTML = pages.length
    ? pages.map(([p,cnt]) => `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border);font-size:.78rem"><span style="color:var(--text)">${_telEsc(p)}</span><span style="color:var(--muted)">${cnt}</span></div>`).join('')
    : '<div style="color:var(--muted);font-size:.78rem">—</div>';

  // Ops
  const ops = Object.entries(u.opCount).sort((a,b)=>b[1]-a[1]).slice(0,8);
  document.getElementById('telUserDetailOps').innerHTML = ops.length
    ? ops.map(([op,cnt]) => `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border);font-size:.78rem"><span style="color:var(--text)">${_telEsc(op)}</span><span style="color:var(--muted)">${cnt}</span></div>`).join('')
    : '<div style="color:var(--muted);font-size:.78rem">—</div>';

  document.getElementById('telUserDetail').style.display = '';
  document.getElementById('telUserDetail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
window._telOpenUserDetail = _telOpenUserDetail;

function _telCloseUserDetail() { document.getElementById('telUserDetail').style.display = 'none'; }
window._telCloseUserDetail = _telCloseUserDetail;

/* ══════════════════════════════════════════════════════════════════
   ABA FAMÍLIAS
══════════════════════════════════════════════════════════════════ */

function _telBuildFamMap(rows) {
  const map = {};
  rows.forEach(r => {
    const fid = r.family_id; if (!fid) return;
    if (!map[fid]) map[fid] = { events:0, pages:0, errors:0, ai:0, users:new Set(), lastSeen:r.ts, pageCount:{} };
    map[fid].events++;
    if (r.event_type === 'page_view')                { map[fid].pages++; map[fid].pageCount[r.page||'?'] = (map[fid].pageCount[r.page||'?']||0)+1; }
    if (r.event_type === 'error' || r.event_type === 'uncaught') map[fid].errors++;
    if (r.event_type === 'ai_call')                  map[fid].ai++;
    if (r.user_id) map[fid].users.add(r.user_id);
    if ((r.ts||'') > (map[fid].lastSeen||''))         map[fid].lastSeen = r.ts;
  });
  return map;
}

function _telRenderFamiliesTable(rows) {
  const body = document.getElementById('telFamiliesBody'); if (!body) return;
  const map = _telBuildFamMap(rows);
  let entries = Object.entries(map).map(([id, s]) => ({ id, ...s, users: s.users.size, name: _telFamName(id) }));

  const { col, dir } = _telDash.famSort;
  const colMap = { name:'name', events:'events', users:'users', pages:'pages', errors:'errors', ai:'ai', last:'lastSeen' };
  entries.sort((a,b) => {
    const av = a[colMap[col]||col]||0, bv = b[colMap[col]||col]||0;
    const cmp = typeof av === 'string' ? av.localeCompare(bv) : (bv-av);
    return dir === 'desc' ? cmp : -cmp;
  });

  if (!entries.length) { body.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:28px;color:var(--muted)">Nenhum dado para os filtros selecionados</td></tr>'; return; }

  body.innerHTML = entries.map(f => `
    <tr style="border-bottom:1px solid var(--border);cursor:pointer" onclick="_telOpenFamilyDetail('${f.id}')" onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background=''">
      <td style="padding:8px 10px;font-weight:600;font-size:.82rem;color:var(--text)">${_telEsc(f.name)}</td>
      <td style="padding:8px 10px;text-align:right;font-weight:600;color:var(--text)">${f.events.toLocaleString('pt-BR')}</td>
      <td style="padding:8px 10px;text-align:right;color:var(--muted)">${f.users}</td>
      <td style="padding:8px 10px;text-align:right;color:var(--muted)">${f.pages.toLocaleString('pt-BR')}</td>
      <td style="padding:8px 10px;text-align:right;${f.errors>0?'color:var(--danger);font-weight:600':'color:var(--muted)'}">${f.errors||'—'}</td>
      <td style="padding:8px 10px;text-align:right;color:var(--muted)">${f.ai||'—'}</td>
      <td style="padding:8px 10px;text-align:right;color:var(--muted);font-size:.78rem;white-space:nowrap">${(f.lastSeen||'').slice(0,10)}</td>
    </tr>`).join('');
}

function _telSortFamilies(col) {
  if (_telDash.famSort.col === col) {
    _telDash.famSort.dir = _telDash.famSort.dir === 'desc' ? 'asc' : 'desc';
  } else {
    _telDash.famSort = { col, dir: 'desc' };
  }
  ['name','events','users','pages','errors','ai','last'].forEach(c => {
    const el = document.getElementById('telFamSort_' + c);
    if (!el) return;
    el.textContent = c === col ? (_telDash.famSort.dir === 'desc' ? '↓' : '↑') : '';
  });
  _telRenderFamiliesTable(_telDash.filtered);
}
window._telSortFamilies = _telSortFamilies;

function _telFilterFamiliesTable(q) {
  const body = document.getElementById('telFamiliesBody'); if (!body) return;
  const lq = q.toLowerCase();
  body.querySelectorAll('tr').forEach(r => { r.style.display = (!lq || r.textContent.toLowerCase().includes(lq)) ? '' : 'none'; });
}
window._telFilterFamiliesTable = _telFilterFamiliesTable;

function _telOpenFamilyDetail(fid) {
  const map = _telBuildFamMap(_telDash.filtered);
  const f = map[fid]; if (!f) return;

  document.getElementById('telFamilyDetailName').textContent = _telFamName(fid);
  document.getElementById('telFamilyDetailMeta').textContent = `${f.users.size||f.users} usuário(s) ativo(s) no período`;

  const s = `background:var(--surface2);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:2px;border:1px solid var(--border)`;
  const n = `font-size:1.3rem;font-weight:700;color:var(--text);line-height:1.1`;
  const l = `font-size:.68rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em`;
  document.getElementById('telFamilyDetailKpis').innerHTML = [
    { v: f.events,         lb: 'Eventos' },
    { v: f.users.size||f.users, lb: 'Usuários' },
    { v: f.pages,          lb: 'Page views' },
    { v: f.ai,             lb: 'Chamadas IA' },
    { v: f.errors,         lb: 'Erros', danger: f.errors > 0 },
  ].map(c => `<div style="${s}"><span style="${n}${c.danger?';color:var(--danger)':''}">${typeof c.v==='number'?c.v.toLocaleString('pt-BR'):c.v}</span><span style="${l}">${c.lb}</span></div>`).join('');

  // Usuários ativos
  const famRows = _telDash.filtered.filter(r => r.family_id === fid && r.user_id);
  const userCounts = {};
  famRows.forEach(r => { userCounts[r.user_id] = (userCounts[r.user_id]||0)+1; });
  const topUsers = Object.entries(userCounts).sort((a,b)=>b[1]-a[1]).slice(0,8);
  document.getElementById('telFamilyDetailUsers').innerHTML = topUsers.length
    ? topUsers.map(([uid, cnt]) => `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border);font-size:.78rem">
        <span style="color:var(--text)">${_telEsc(_telUserName(uid, map))}</span>
        <span style="color:var(--muted)">${cnt} eventos</span></div>`).join('')
    : '<div style="color:var(--muted);font-size:.78rem">—</div>';

  // Páginas
  const pages = Object.entries(f.pageCount).sort((a,b)=>b[1]-a[1]).slice(0,8);
  document.getElementById('telFamilyDetailPages').innerHTML = pages.length
    ? pages.map(([p,cnt]) => `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border);font-size:.78rem"><span style="color:var(--text)">${_telEsc(p)}</span><span style="color:var(--muted)">${cnt}</span></div>`).join('')
    : '<div style="color:var(--muted);font-size:.78rem">—</div>';

  document.getElementById('telFamilyDetail').style.display = '';
  document.getElementById('telFamilyDetail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
window._telOpenFamilyDetail = _telOpenFamilyDetail;

function _telCloseFamilyDetail() { document.getElementById('telFamilyDetail').style.display = 'none'; }
window._telCloseFamilyDetail = _telCloseFamilyDetail;


// === PERIODICITY COLORS ===
function getPeriodColor(period) {
  switch((period||'').toLowerCase()) {
    case 'daily': return '#2ecc71';
    case 'weekly': return '#3498db';
    case 'monthly': return '#f39c12';
    case 'yearly': return '#9b59b6';
    default: return '#1F6B4F';
  }
}
