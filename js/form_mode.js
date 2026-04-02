// ── form_mode.js ─────────────────────────────────────────────────────────
// Controls "Abas por contexto" vs "Wizard passo a passo" for txModal and
// scheduledModal. Reads from user preference (localStorage + app_users).
// Exported globals: getTxFormMode(), initTxFormMode(), initScFormMode(),
//   switchTxTab(), switchScTab(), txWizardNext(), txWizardPrev(),
//   scWizardNext(), scWizardPrev(), selectFormMode()
// ─────────────────────────────────────────────────────────────────────────

// ── Preference helpers ────────────────────────────────────────────────────

function getTxFormMode() {
  try {
    // DB value (via currentUser) is authoritative — synced to localStorage on login
    if (window.currentUser?.preferred_form_mode) {
      return window.currentUser.preferred_form_mode === 'wizard' ? 'wizard' : 'tabs';
    }
    // Fallback: localStorage (covers pre-login render or missing column)
    const uid = window.currentUser?.id || 'local';
    const stored = localStorage.getItem(`pref_${uid}_global_form_mode`);
    return stored === 'wizard' ? 'wizard' : 'tabs';
  } catch(e) { return 'tabs'; }
}

function _persistFormMode(mode) {
  // localStorage sync only — DB is written by auth.js saveMyProfile via app_users column
  try {
    const uid = window.currentUser?.id || 'local';
    localStorage.setItem(`pref_${uid}_global_form_mode`, mode);
  } catch(e) {}
}

// Called from profile modal card clicks
function selectFormMode(mode) {
  const tabsBtn   = document.getElementById('formModeTabsBtn');
  const wizardBtn = document.getElementById('formModeWizardBtn');
  const hidden    = document.getElementById('myProfileFormMode');
  if (!tabsBtn || !wizardBtn) return;

  const accentBorder = '1.5px solid var(--accent)';
  const accentBg     = 'var(--accent-lt,#e8f2ee)';
  const neutralBorder= '1.5px solid var(--border)';

  if (mode === 'tabs') {
    tabsBtn.style.border      = accentBorder;
    tabsBtn.style.background  = accentBg;
    tabsBtn.querySelector('div').style.color = 'var(--accent)';
    wizardBtn.style.border    = neutralBorder;
    wizardBtn.style.background= 'transparent';
    wizardBtn.querySelector('div').style.color = 'var(--text2)';
  } else {
    wizardBtn.style.border    = accentBorder;
    wizardBtn.style.background= accentBg;
    wizardBtn.querySelector('div').style.color = 'var(--accent)';
    tabsBtn.style.border      = neutralBorder;
    tabsBtn.style.background  = 'transparent';
    tabsBtn.querySelector('div').style.color = 'var(--text2)';
  }
  if (hidden) hidden.value = mode;
}

// Called by auth.js loadMyProfile() to reflect current pref
function loadFormModeIntoProfile() {
  const mode = getTxFormMode();
  selectFormMode(mode);
}

// Hook into saveMyProfile — called after profile save succeeds
function _saveFormModeFromProfile() {
  const hidden = document.getElementById('myProfileFormMode');
  const mode   = hidden?.value || 'tabs';
  const uid    = window.currentUser?.id || 'local';
  try { localStorage.setItem(`pref_${uid}_global_form_mode`, mode); } catch(e) {}
  _persistFormMode(mode);
}

// ── Generic helpers ───────────────────────────────────────────────────────

function _showPane(paneId) {
  const el = document.getElementById(paneId);
  if (el) { el.style.display = ''; el.style.removeProperty('display'); el.style.display = 'block'; }
}
function _hidePane(paneId) {
  const el = document.getElementById(paneId);
  if (el) el.style.display = 'none';
}

function _allPanes(prefix) {
  // returns array of pane element ids belonging to a modal prefix (tx or sc)
  if (prefix === 'tx') return ['txCtxPrincipal','txCtxDetalhes','txCtxAnexo'];
  if (prefix === 'sc') return ['scCtxPrincipal','scCtxDetalhes','scCtxRecorrencia','scCtxNotificacoes'];
  return [];
}

// ── TX MODAL ─────────────────────────────────────────────────────────────

var _txCurrentStep = 0;
var _txTotalSteps  = 3; // Principal, Detalhes, Anexo

function initTxFormMode() {
  const mode    = getTxFormMode();
  const tabBar  = document.getElementById('txContextTabBar');
  const wzSteps = document.getElementById('txWizardSteps');
  const wzNav   = document.getElementById('txWizardNav');
  const saveBtn = document.getElementById('txSaveBtn');
  const panes   = _allPanes('tx');

  // Always reset to first pane
  _txCurrentStep = 0;
  panes.forEach((id, i) => {
    const el = document.getElementById(id);
    if (el) el.style.display = i === 0 ? '' : 'none';
  });

  if (mode === 'tabs') {
    if (tabBar)  tabBar.style.display = 'flex';
    if (wzSteps) wzSteps.style.display = 'none';
    if (wzNav)   wzNav.style.display  = 'none';
    if (saveBtn) saveBtn.style.display = '';
    // Reset active tab highlight
    document.querySelectorAll('#txContextTabBar .tx-ctx-tab').forEach((btn, i) => {
      btn.classList.toggle('active', i === 0);
    });
  } else {
    // Wizard
    if (tabBar)  tabBar.style.display = 'none';
    if (wzSteps) { wzSteps.style.display = ''; _txRenderWizardSteps(); }
    if (wzNav)   { wzNav.style.display = 'flex'; _txRenderWizardNav(); }
    if (saveBtn) saveBtn.style.display = 'none';
  }
}

function switchTxTab(paneId, btnEl) {
  _allPanes('tx').forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = id === paneId ? '' : 'none';
  });
  document.querySelectorAll('#txContextTabBar .tx-ctx-tab').forEach(btn => {
    btn.classList.toggle('active', btn === btnEl);
  });
}

function _txRenderWizardSteps() {
  const bar = document.getElementById('txWzStepsBar');
  if (!bar) return;
  bar.querySelectorAll('.wz-step').forEach((el, i) => {
    el.classList.remove('active','done');
    if (i < _txCurrentStep) el.classList.add('done');
    else if (i === _txCurrentStep) el.classList.add('active');
  });
}

function _txRenderWizardNav() {
  const prev  = document.getElementById('txWzPrev');
  const next  = document.getElementById('txWzNext');
  const save  = document.getElementById('txSaveBtn');
  const label = document.getElementById('txWzStepLabel');
  if (!prev || !next || !save) return;
  const labels = ['Passo 1 de 3','Passo 2 de 3','Passo 3 de 3'];
  if (label) label.textContent = labels[_txCurrentStep] || '';
  prev.style.display = _txCurrentStep > 0 ? '' : 'none';
  const isLast = _txCurrentStep >= _txTotalSteps - 1;
  next.style.display = isLast ? 'none' : '';
  save.style.display = isLast ? '' : 'none';
}

function txWizardNext() {
  if (_txCurrentStep >= _txTotalSteps - 1) return;
  // hide current
  const cur = _allPanes('tx')[_txCurrentStep];
  if (cur) document.getElementById(cur).style.display = 'none';
  _txCurrentStep++;
  // show next
  const nxt = _allPanes('tx')[_txCurrentStep];
  if (nxt) document.getElementById(nxt).style.display = '';
  _txRenderWizardSteps();
  _txRenderWizardNav();
  // scroll to top
  const body = document.querySelector('#txModal .modal-body');
  if (body) body.scrollTop = 0;
}

function txWizardPrev() {
  if (_txCurrentStep <= 0) return;
  const cur = _allPanes('tx')[_txCurrentStep];
  if (cur) document.getElementById(cur).style.display = 'none';
  _txCurrentStep--;
  const prv = _allPanes('tx')[_txCurrentStep];
  if (prv) document.getElementById(prv).style.display = '';
  _txRenderWizardSteps();
  _txRenderWizardNav();
  const body = document.querySelector('#txModal .modal-body');
  if (body) body.scrollTop = 0;
}

// ── SCHEDULED MODAL ───────────────────────────────────────────────────────

var _scCurrentStep = 0;
var _scTotalSteps  = 4; // Principal, Detalhes, Recorrência, Notificações

function initScFormMode() {
  const mode    = getTxFormMode();
  const tabBar  = document.getElementById('scContextTabBar');
  const wzSteps = document.getElementById('scWizardSteps');
  const wzNav   = document.getElementById('scWizardNav');
  const saveBtn = document.getElementById('scSaveBtn');
  const panes   = _allPanes('sc');

  _scCurrentStep = 0;
  panes.forEach((id, i) => {
    const el = document.getElementById(id);
    if (el) el.style.display = i === 0 ? '' : 'none';
  });

  if (mode === 'tabs') {
    if (tabBar)  tabBar.style.display = 'flex';
    if (wzSteps) wzSteps.style.display = 'none';
    if (wzNav)   wzNav.style.display  = 'none';
    if (saveBtn) saveBtn.style.display = '';
    document.querySelectorAll('#scContextTabBar .tx-ctx-tab').forEach((btn, i) => {
      btn.classList.toggle('active', i === 0);
    });
  } else {
    if (tabBar)  tabBar.style.display = 'none';
    if (wzSteps) { wzSteps.style.display = ''; _scRenderWizardSteps(); }
    if (wzNav)   { wzNav.style.display = 'flex'; _scRenderWizardNav(); }
    if (saveBtn) saveBtn.style.display = 'none';
  }
}

function switchScTab(paneId, btnEl) {
  _allPanes('sc').forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = id === paneId ? '' : 'none';
  });
  document.querySelectorAll('#scContextTabBar .tx-ctx-tab').forEach(btn => {
    btn.classList.toggle('active', btn === btnEl);
  });
}

function _scRenderWizardSteps() {
  const bar = document.getElementById('scWzStepsBar');
  if (!bar) return;
  bar.querySelectorAll('.wz-step').forEach((el, i) => {
    el.classList.remove('active','done');
    if (i < _scCurrentStep) el.classList.add('done');
    else if (i === _scCurrentStep) el.classList.add('active');
  });
}

function _scRenderWizardNav() {
  const prev  = document.getElementById('scWzPrev');
  const next  = document.getElementById('scWzNext');
  const save  = document.getElementById('scSaveBtn');
  const label = document.getElementById('scWzStepLabel');
  if (!prev || !next || !save) return;
  const labels = ['Passo 1 de 4','Passo 2 de 4','Passo 3 de 4','Passo 4 de 4'];
  if (label) label.textContent = labels[_scCurrentStep] || '';
  prev.style.display = _scCurrentStep > 0 ? '' : 'none';
  const isLast = _scCurrentStep >= _scTotalSteps - 1;
  next.style.display = isLast ? 'none' : '';
  save.style.display = isLast ? '' : 'none';
}

function scWizardNext() {
  if (_scCurrentStep >= _scTotalSteps - 1) return;
  const cur = _allPanes('sc')[_scCurrentStep];
  if (cur) document.getElementById(cur).style.display = 'none';
  _scCurrentStep++;
  const nxt = _allPanes('sc')[_scCurrentStep];
  if (nxt) document.getElementById(nxt).style.display = '';
  _scRenderWizardSteps();
  _scRenderWizardNav();
  const body = document.querySelector('#scheduledModal .modal-body');
  if (body) body.scrollTop = 0;
}

function scWizardPrev() {
  if (_scCurrentStep <= 0) return;
  const cur = _allPanes('sc')[_scCurrentStep];
  if (cur) document.getElementById(cur).style.display = 'none';
  _scCurrentStep--;
  const prv = _allPanes('sc')[_scCurrentStep];
  if (prv) document.getElementById(prv).style.display = '';
  _scRenderWizardSteps();
  _scRenderWizardNav();
  const body = document.querySelector('#scheduledModal .modal-body');
  if (body) body.scrollTop = 0;
}

// expose globals
window.getTxFormMode           = getTxFormMode;
window.initTxFormMode          = initTxFormMode;
window.initScFormMode          = initScFormMode;
window.switchTxTab             = switchTxTab;
window.switchScTab             = switchScTab;
window.txWizardNext            = txWizardNext;
window.txWizardPrev            = txWizardPrev;
window.scWizardNext            = scWizardNext;
window.scWizardPrev            = scWizardPrev;
window.selectFormMode          = selectFormMode;
window.loadFormModeIntoProfile = loadFormModeIntoProfile;
window._saveFormModeFromProfile= _saveFormModeFromProfile;


// ── TX Entry Mode (Manual / IA) ───────────────────────────────────────────

var _txEntryMode = 'manual'; // 'manual' | 'ai'

function setTxEntryMode(mode) {
  _txEntryMode = mode;
  const manBtn  = document.getElementById('txEntryModeManual');
  const aiBtn   = document.getElementById('txEntryModeAi');
  const aiPane  = document.getElementById('txAiEntryPane');
  const ctxBar  = document.getElementById('txContextTabBar');
  const wzBar   = document.getElementById('txWizardSteps');
  const panes   = _allPanes('tx');
  const footer  = document.getElementById('txModalFooter');

  if (mode === 'ai') {
    if (manBtn) manBtn.classList.remove('tx-entry-mode-btn--active');
    if (aiBtn)  aiBtn.classList.add('tx-entry-mode-btn--active');
    if (aiPane) aiPane.style.display = '';
    // Hide context tabs/wizard and form panes
    if (ctxBar) ctxBar.style.display = 'none';
    if (wzBar)  wzBar.style.display  = 'none';
    panes.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
    if (footer) footer.style.display = 'none';
  } else {
    if (manBtn) manBtn.classList.add('tx-entry-mode-btn--active');
    if (aiBtn)  aiBtn.classList.remove('tx-entry-mode-btn--active');
    if (aiPane) aiPane.style.display = 'none';
    if (footer) footer.style.display = '';
    // Restore tabs/wizard
    initTxFormMode();
  }
  // Persist preference
  try {
    const uid = window.currentUser?.id || 'local';
    localStorage.setItem(`pref_${uid}_tx_entry_mode`, mode);
  } catch(e) {}
}

function getTxEntryModePref() {
  try {
    const uid = window.currentUser?.id || 'local';
    return localStorage.getItem(`pref_${uid}_tx_entry_mode`) || 'manual';
  } catch(e) { return 'manual'; }
}

// Called from initTxFormMode — also restores entry mode
const _origInitTxFormMode = initTxFormMode;
initTxFormMode = function() {
  _origInitTxFormMode();
  // Restore AI/manual preference
  const pref = getTxEntryModePref();
  _txEntryMode = pref === 'ai' ? 'ai' : 'manual';
  const manBtn = document.getElementById('txEntryModeManual');
  const aiBtn  = document.getElementById('txEntryModeAi');
  if (manBtn) manBtn.classList.toggle('tx-entry-mode-btn--active', pref !== 'ai');
  if (aiBtn)  aiBtn.classList.toggle('tx-entry-mode-btn--active', pref === 'ai');
  // If AI mode was preferred, show AI pane
  if (pref === 'ai') setTxEntryMode('ai');
};

function txAiClear() {
  const prompt = document.getElementById('txAiPrompt');
  if (prompt) { prompt.value = ''; prompt.focus(); }
  const chips  = document.getElementById('txAiExtractedChips');
  const bar    = document.getElementById('txAiConfirmBar');
  const err    = document.getElementById('txAiError');
  if (chips) { chips.style.display = 'none'; chips.innerHTML = ''; }
  if (bar)   bar.style.display = 'none';
  if (err)   err.style.display = 'none';
}

async function txAiAnalyze() {
  const promptEl = document.getElementById('txAiPrompt');
  const text     = promptEl?.value?.trim();
  if (!text) { promptEl?.focus(); return; }

  const analyzeBtn = document.getElementById('txAiAnalyzeBtn');
  const errEl      = document.getElementById('txAiError');
  const chipsEl    = document.getElementById('txAiExtractedChips');
  const confirmBar = document.getElementById('txAiConfirmBar');

  if (errEl)   errEl.style.display   = 'none';
  if (chipsEl) { chipsEl.style.display = 'none'; chipsEl.innerHTML = ''; }
  if (confirmBar) confirmBar.style.display = 'none';

  if (analyzeBtn) { analyzeBtn.disabled = true; analyzeBtn.textContent = '⏳ Analisando…'; }

  try {
    const apiKey = await getAppSetting('gemini_api_key', '').catch(() => '');
    if (!apiKey || !apiKey.startsWith('AIza')) {
      throw new Error('Chave Gemini não configurada. Acesse Configurações → IA para adicionar.');
    }
    const result = await _txAiGeminiExtract(text, apiKey);
    _txAiApplyResult(result);
  } catch(e) {
    if (errEl) {
      errEl.textContent = '⚠ ' + (e.message || 'Erro ao chamar a IA');
      errEl.style.display = '';
    }
  } finally {
    if (analyzeBtn) { analyzeBtn.disabled = false; analyzeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg> Analisar com IA'; }
  }
}

async function _txAiGeminiExtract(text, apiKey) {
  const accounts  = (window.state?.accounts  || []).slice(0, 30).map(a => `${a.name} (${a.currency||'BRL'})`).join(', ');
  const payees    = (window.state?.payees    || []).slice(0, 80).map(p => p.name).join(', ');
  const cats      = (window.state?.categories|| []).filter(c => c.type !== 'transferencia').slice(0, 80).map(c => c.name).join(', ');
  const members   = (typeof getFamilyMembers === 'function' ? getFamilyMembers() : []).map(m => m.name).join(', ');
  const today     = new Date().toISOString().slice(0, 10);

  const prompt = `Você é um assistente financeiro para o app Family FinTrack. Extraia os dados da transação descrita pelo usuário.

Descrição: "${text}"

Dados disponíveis no sistema:
CONTAS: ${accounts || 'nenhuma'}
BENEFICIÁRIOS: ${payees || 'nenhum'}
CATEGORIAS: ${cats || 'nenhuma'}
MEMBROS DA FAMÍLIA: ${members || 'nenhum'}
DATA HOJE: ${today}

Regras:
- type: "expense" para despesas, "income" para receitas, "transfer" para transferências
- amount: número positivo (o tipo define se é débito/crédito)
- date: formato YYYY-MM-DD (use hoje se não mencionado)
- account: nome EXATO da lista CONTAS, ou null
- payee: nome EXATO da lista BENEFICIÁRIOS, ou null
- category: nome EXATO da lista CATEGORIAS, ou null
- member: nome EXATO da lista MEMBROS, ou null
- description: descrição limpa e concisa
- memo: detalhes extras do usuário (pessoas, observações), ou null

Responda SOMENTE com JSON válido, sem explicações:
{
  "type": "expense",
  "amount": 280.00,
  "description": "Almoço no Outback",
  "date": "2026-03-27",
  "account": "Nubank" or null,
  "payee": "Outback" or null,
  "category": "Restaurante" or null,
  "member": null,
  "memo": "com família" or null,
  "confidence": "high"
}`;

  const model = window.RECEIPT_AI_MODEL || 'gemini-2.5-flash-lite';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 300, temperature: 0.1 },
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${resp.status}`);
  }
  const data = await resp.json();
  let raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  raw = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(raw); } catch(_) { throw new Error('Resposta inválida da IA'); }
}

function _txAiApplyResult(r) {
  if (!r) return;

  // 1. Set type
  if (r.type) {
    if (typeof setTxType === 'function') setTxType(r.type);
  }

  // 2. Switch to manual pane so fields are visible for confirmation
  const mode = getTxFormMode();
  const ctxBar = document.getElementById('txContextTabBar');
  const wzBar  = document.getElementById('txWizardSteps');
  const footer = document.getElementById('txModalFooter');
  if (ctxBar) ctxBar.style.display = mode === 'tabs' ? 'flex' : 'none';
  if (footer) footer.style.display = '';
  // Show principal pane
  _allPanes('tx').forEach((id, i) => {
    const el = document.getElementById(id);
    if (el) el.style.display = i === 0 ? '' : 'none';
  });
  if (mode === 'tabs') {
    document.querySelectorAll('#txContextTabBar .tx-ctx-tab').forEach((btn, i) => btn.classList.toggle('active', i === 0));
  } else {
    if (wzBar) { wzBar.style.display = ''; _txCurrentStep = 0; _txRenderWizardSteps(); _txRenderWizardNav(); }
  }

  // 3. Fill fields
  if (r.amount) {
    const amtEl = document.getElementById('txAmount');
    if (amtEl) {
      amtEl.value = typeof r.amount === 'number' ? r.amount.toFixed(2).replace('.', ',') : r.amount;
      if (typeof onTxAmountInput === 'function') onTxAmountInput();
    }
  }
  if (r.description) {
    const descEl = document.getElementById('txDesc');
    if (descEl) descEl.value = r.description;
  }
  if (r.date) {
    const dateEl = document.getElementById('txDate');
    if (dateEl) dateEl.value = r.date;
  }
  if (r.memo) {
    const memoEl = document.getElementById('txMemo');
    if (memoEl) memoEl.value = r.memo;
  }
  // Account
  if (r.account) {
    const acctEl = document.getElementById('txAccountId');
    if (acctEl) {
      const opt = Array.from(acctEl.options).find(o => o.text.toLowerCase().includes(r.account.toLowerCase()));
      if (opt) { acctEl.value = opt.value; if (typeof _onTxSourceAccountChange === 'function') _onTxSourceAccountChange(opt.value); }
    }
  }
  // Payee — uses payee autocomplete
  if (r.payee && typeof setPayeeField === 'function') {
    const payeeObj = (window.state?.payees || []).find(p => p.name.toLowerCase() === r.payee.toLowerCase());
    if (payeeObj) setPayeeField(payeeObj.id, 'tx');
    else {
      const nameEl = document.getElementById('txPayeeName');
      if (nameEl) nameEl.value = r.payee;
    }
  }
  // Category
  if (r.category && typeof setCatPickerValue === 'function') {
    const catObj = (window.state?.categories || []).find(c => c.name.toLowerCase() === r.category.toLowerCase());
    if (catObj) setCatPickerValue(catObj.id, 'tx');
  }
  // Member
  if (r.member && typeof renderFmcMultiPicker === 'function') {
    const members = typeof getFamilyMembers === 'function' ? getFamilyMembers() : [];
    const memberObj = members.find(m => m.name.toLowerCase() === r.member.toLowerCase());
    if (memberObj) renderFmcMultiPicker('txFamilyMemberPicker', { selected: [memberObj.id] });
  }

  // 4. Build extracted chips for confirmation
  const chips = [];
  if (r.amount)       chips.push({ label: `R$ ${Number(r.amount).toLocaleString('pt-BR', {minimumFractionDigits:2})}`, icon: '💰' });
  if (r.description)  chips.push({ label: r.description, icon: '📝' });
  if (r.date)         chips.push({ label: r.date, icon: '📅' });
  if (r.account)      chips.push({ label: r.account, icon: '🏦' });
  if (r.payee)        chips.push({ label: r.payee, icon: '👤' });
  if (r.category)     chips.push({ label: r.category, icon: '🏷' });
  if (r.member)       chips.push({ label: r.member, icon: '👨‍👩‍👧' });

  const chipsEl = document.getElementById('txAiExtractedChips');
  if (chipsEl && chips.length) {
    chipsEl.innerHTML = chips.map(c =>
      `<span class="tx-ai-chip">${c.icon} ${c.label}</span>`
    ).join('');
    chipsEl.style.display = 'flex';
  }

  const confirmBar = document.getElementById('txAiConfirmBar');
  if (confirmBar) confirmBar.style.display = '';
}

// ── Profile modal tab switcher ────────────────────────────────────────────

function switchProfTab(paneId, btnEl) {
  const panes = ['profTabConta','profTabSeguranca','profTabPrefs','profTabNotif'];
  panes.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = id === paneId ? '' : 'none';
  });
  document.querySelectorAll('.prof-ctx-tab').forEach(btn => btn.classList.toggle('active', btn === btnEl));
}

// Fill the new profile fields that show name/email in the Conta tab
function _fillProfileDisplayFields() {
  const nameDisp  = document.getElementById('myProfileNameDisplay');
  const emailDisp = document.getElementById('myProfileEmailDisplay');
  const nameInput = document.getElementById('myProfileNameInput');
  if (nameDisp  && window.currentUser?.name)  nameDisp.textContent  = window.currentUser.name;
  if (emailDisp && window.currentUser?.email) emailDisp.textContent = window.currentUser.email;
  if (nameInput && window.currentUser?.name)  nameInput.value       = window.currentUser.name;
}

// Hook into loadFormModeIntoProfile to also fill display fields
const _origLoadFormModeIntoProfile = loadFormModeIntoProfile;
loadFormModeIntoProfile = function() {
  _origLoadFormModeIntoProfile();
  _fillProfileDisplayFields();
  // Ensure first tab is active when modal opens
  const firstPane = document.getElementById('profTabConta');
  const firstBtn  = document.querySelector('.prof-ctx-tab');
  if (firstPane) {
    ['profTabConta','profTabSeguranca','profTabPrefs','profTabNotif'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = id === 'profTabConta' ? '' : 'none';
    });
  }
  if (firstBtn) document.querySelectorAll('.prof-ctx-tab').forEach((b,i) => b.classList.toggle('active', i===0));
};

window.setTxEntryMode        = setTxEntryMode;
window.getTxEntryModePref    = getTxEntryModePref;
window.txAiAnalyze           = txAiAnalyze;
window.txAiClear             = txAiClear;
window.switchProfTab         = switchProfTab;
window.loadFormModeIntoProfile = loadFormModeIntoProfile;
