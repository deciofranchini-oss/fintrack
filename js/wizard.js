/* ═══════════════════════════════════════════════════════════════════════════
   SETUP WIZARD — First-run onboarding for Family FinTrack
   ─────────────────────────────────────────────────────────────────────────
   Flow:
     Step 1 — Bem-vindo / Nome da família
     Step 2 — Membros da família (adultos + crianças)
     Step 3 — Convidar membros adultos
     Step 4 — Principais gastos (categorias + orçamentos) [pulável]
     Step 5 — Concluído 🎉

   Trigger: bootApp() calls _wizardShouldShow() after data loads.
   Hides when: has accounts + categories + at least 1 transaction.
═══════════════════════════════════════════════════════════════════════════ */

// ── State ─────────────────────────────────────────────────────────────────
const _wz = {
  step: 1,
  totalSteps: 9,
  familyName: '',
  adults: [],   // [{name, age, relation, invite: bool, email:''}]
  children: [], // [{name, age, relation}]
  expenses: [], // [{key, label, emoji, amount}]
  modules: { prices: false, investments: false, debts: false, aiInsights: false },
};

// ── Trigger check ─────────────────────────────────────────────────────────
async function _wizardShouldShow() {
  try {
    // Only show for owners/admins with empty setup
    if (!currentUser?.can_admin && currentUser?.role !== 'owner') return false;

    // Dismissed permanently?
    const dismissed = await getAppSetting('wizard_dismissed', false);
    if (dismissed) return false;

    // Has transactions? → setup complete
    const { count: txCount } = await famQ(
      sb.from('transactions').select('id', { count: 'exact', head: true })
    );
    if ((txCount || 0) > 0) {
      await saveAppSetting('wizard_dismissed', true);
      return false;
    }

    // Has accounts AND categories? → setup complete
    const hasAccounts = (state.accounts || []).length > 0;
    const hasCats     = (state.categories || []).length > 0;
    if (hasAccounts && hasCats) return false;

    return true;
  } catch(e) {
    console.warn('[Wizard]', e.message);
    return false;
  }
}

async function initWizard() {
  const show = await _wizardShouldShow();
  if (!show) return;
  _wzReset();
  _wzOpen();
}

/**
 * openWizardManual() — called by the admin button in Settings → Família & Usuários.
 *
 * Wizard auto-triggers on boot when ALL of these are true:
 *   1. User is admin or owner
 *   2. wizard_dismissed flag is false (not yet run or explicitly reset)
 *   3. No transactions exist for this family
 *   4. Family has no accounts OR no categories
 *
 * This function bypasses all guards and opens the wizard regardless of state.
 * It clears the wizard_dismissed flag so it can run to completion.
 * Also triggered automatically after creating a new family (via _offerFamilyWizard).
 */
async function openWizardManual() {
  // Guard: only admin/owner can launch manually
  if (!currentUser?.can_admin && currentUser?.role !== 'owner') {
    toast('Acesso restrito a administradores', 'error');
    return;
  }
  // Clear dismissed flag so wizard can save progress normally
  await saveAppSetting('wizard_dismissed', false).catch(() => {});
  _wzReset();
  // Pre-fill family name from current context
  _wz.familyName = (currentUser?.families?.find(f => f.id === currentUser.family_id)?.name || '').replace(/família|family/gi, '').trim();
  _wzOpen();
  // Update the status sub-text in settings to show wizard is active
  _updateWizardSettingsStatus();
}

/**
 * openWizardForNewUser()
 * Called when the logged-in user has no family_id yet.
 * Bypasses all guards, clears the family name, and marks the wizard as
 * running in "create" mode so _wzRunSetup() creates a new family instead
 * of just renaming the existing one.
 */
async function openWizardForNewUser() {
  _wzReset();
  _wz.familyName     = '';         // start blank — user types their family name
  _wz.creatingFamily = true;       // flag: wizard must CREATE the family in _wzRunSetup
  window._wzNeedsBoot = true;      // flag: _wzFinish must call bootApp() not navigate()
  await saveAppSetting('wizard_dismissed', false).catch(() => {});
  _wzOpen();
}

/** Update the wizard status sub-text in Settings to reflect current state. */
async function _updateWizardSettingsStatus() {
  const el = document.getElementById('wizardSettingsSub');
  if (!el) return;
  try {
    const dismissed = await getAppSetting('wizard_dismissed', false);
    const hasAccounts = (state.accounts || []).length > 0;
    const hasCats = (state.categories || []).length > 0;
    const { count: txCount } = await famQ(
      sb.from('transactions').select('id', { count: 'exact', head: true })
    );
    const hasTx = (txCount || 0) > 0;
    if (dismissed || (hasAccounts && hasCats && hasTx)) {
      el.textContent = 'Configuração concluída · Clique para refazer';
    } else if (!hasAccounts || !hasCats) {
      el.textContent = 'Pendente · Família ainda não configurada';
      el.style.color = 'var(--amber, #b45309)';
    } else {
      el.textContent = 'Configurar nome, membros e categorias da família';
    }
  } catch (_) {}
}

function _wzReset() {
  _wz.step           = 1;
  _wz.familyName     = (currentUser?.families?.[0]?.name || '').replace(/família|family/gi,'').trim();
  _wz.adults         = [];
  _wz.children       = [];
  _wz.expenses       = [];
  _wz.modules        = { prices: false, investments: false, debts: false, aiInsights: false };
  _wz.creatingFamily = false;
}

// ── Open / Close ──────────────────────────────────────────────────────────
function _wzOpen()  { const el = document.getElementById('wizardOverlay'); if (el) { el.style.display = 'flex'; _wzRenderStep(); } }
function _wzClose() { const el = document.getElementById('wizardOverlay'); if (el) el.style.display = 'none'; }

async function _wzDismiss() {
  await saveAppSetting('wizard_dismissed', true).catch(()=>{});
  _wzClose();
}

// ── Navigation ────────────────────────────────────────────────────────────
function _wzNext() {
  if (!_wzValidateStep()) return;
  if (_wz.step < _wz.totalSteps) { _wz.step++; _wzRenderStep(); }
}
function _wzBack() {
  if (_wz.step > 1) { _wz.step--; _wzRenderStep(); }
}
function _wzSkip() {
  if (_wz.step < _wz.totalSteps) { _wz.step++; _wzRenderStep(); }
}

function _wzValidateStep() {
  if (_wz.step === 1) {
    const name = document.getElementById('wzFamilyName')?.value.trim();
    if (!name) { _wzShowError('Informe o nome da família'); return false; }
    _wz.familyName = name;
  }
  if (_wz.step === 2) {
    _wzCollectMembers();
    if (_wz.adults.length === 0) { _wzShowError('Adicione pelo menos um adulto'); return false; }
  }
  if (_wz.step === 3) {
    _wzCollectInvites();
  }
  if (_wz.step === 4) {
    _wzCollectExpenses();
  }
  // Steps 5–7 are tutorial/guide steps — always valid
  _wzClearError();
  return true;
}

function _wzShowError(msg) {
  const el = document.getElementById('wzError');
  if (el) { el.textContent = msg; el.style.display = ''; }
}
function _wzClearError() {
  const el = document.getElementById('wzError');
  if (el) el.style.display = 'none';
}

// ── Step Renderer ─────────────────────────────────────────────────────────
function _wzRenderStep() {
  _wzClearError();
  const body    = document.getElementById('wzBody');
  const progress = document.getElementById('wzProgress');
  const backBtn  = document.getElementById('wzBackBtn');
  const nextBtn  = document.getElementById('wzNextBtn');
  const skipBtn  = document.getElementById('wzSkipBtn');
  const title    = document.getElementById('wzTitle');
  const subtitle = document.getElementById('wzSubtitle');

  if (!body) return;

  // Progress bar
  const pct = ((_wz.step - 1) / (_wz.totalSteps - 1)) * 100;
  if (progress) progress.style.width = pct + '%';

  // Step dots
  document.querySelectorAll('.wz-dot').forEach((d, i) => {
    d.classList.toggle('wz-dot--active',   i + 1 === _wz.step);
    d.classList.toggle('wz-dot--done',     i + 1 < _wz.step);
  });

  // Buttons
  if (backBtn)  backBtn.style.display  = _wz.step > 1 && _wz.step < _wz.totalSteps ? '' : 'none';
  if (nextBtn)  nextBtn.style.display  = _wz.step < _wz.totalSteps ? '' : 'none';
  if (skipBtn)  skipBtn.style.display  = (_wz.step >= 2 && _wz.step <= 8) ? '' : 'none';
  if (nextBtn)  nextBtn.textContent    = (_wz.step === _wz.totalSteps - 1) ? '✅ Finalizar' : 'Continuar →';

  switch (_wz.step) {
    case 1: return _wzStep1(body, title, subtitle);
    case 2: return _wzStep2(body, title, subtitle);
    case 3: return _wzStep3(body, title, subtitle);
    case 4: return _wzStep4(body, title, subtitle);
    case 5: return _wzStep5_account(body, title, subtitle);
    case 6: return _wzStep6_transaction(body, title, subtitle);
    case 7: return _wzStep7_reports(body, title, subtitle);
    case 8: return _wzStep8_modules(body, title, subtitle);
    case 9: return _wzStep9_done(body, title, subtitle);
  }
}

// ── Step 1: Família ───────────────────────────────────────────────────────
function _wzStep1(body, title, subtitle) {
  if (title) title.textContent = 'Bem-vindo ao Family FinTrack! 👋';
  if (_wz.creatingFamily) {
    if (subtitle) subtitle.textContent = 'Vamos criar sua família e configurar tudo em poucos passos.';
  } else {
    if (subtitle) subtitle.textContent = 'Vamos configurar sua família em poucos passos.';
  }
  const ownerNote = _wz.creatingFamily
    ? '<div class="wz-hint" style="margin-top:10px;padding:8px 10px;background:var(--accent-lt);border-radius:6px;color:var(--accent);font-weight:600">🔑 Você será o proprietário (Owner) desta família.</div>'
    : '';
  body.innerHTML = `
    <div class="wz-field">
      <label class="wz-label">Como se chama sua família?</label>
      <input id="wzFamilyName" class="wz-input" type="text"
             placeholder="Ex.: Família Silva, Casa dos Franchini…"
             value="${esc(_wz.familyName)}" maxlength="60"
             oninput="_wz.familyName=this.value">
      <div class="wz-hint">Este nome aparecerá no dashboard e relatórios.</div>
      ${ownerNote}
    </div>`;
  document.getElementById('wzFamilyName')?.focus();
}

// ── Step 2: Membros ───────────────────────────────────────────────────────
const _RELATIONS = ['Cônjuge/Parceiro(a)','Filho(a)','Pai/Mãe','Irmão/Irmã','Avô/Avó','Outro'];

function _wzStep2(body, title, subtitle) {
  if (title)    title.textContent    = 'Quem faz parte da família? 👨‍👩‍👧‍👦';
  if (subtitle) subtitle.textContent = 'Adicione os membros para personalizar o app.';

  body.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
      <div>
        <div class="wz-section-label">👨‍👩 Adultos (18+)</div>
        <div id="wzAdultList" class="wz-member-list">${_wzRenderAdults()}</div>
        <button class="wz-add-btn" onclick="_wzAddAdult()">+ Adicionar adulto</button>
      </div>
      <div>
        <div class="wz-section-label">👶 Crianças</div>
        <div id="wzChildList" class="wz-member-list">${_wzRenderChildren()}</div>
        <button class="wz-add-btn" onclick="_wzAddChild()">+ Adicionar criança</button>
      </div>
    </div>`;
}

function _wzRenderAdults() {
  if (!_wz.adults.length) return '<div class="wz-empty-list">Nenhum adulto adicionado</div>';
  return _wz.adults.map((a, i) => `
    <div class="wz-member-chip">
      <span class="wz-member-emoji">👤</span>
      <div class="wz-member-info">
        <strong>${esc(a.name||'—')}</strong>
        <span>${esc(a.relation||'')}</span>
      </div>
      <button class="wz-remove-btn" onclick="_wzRemoveAdult(${i})">✕</button>
    </div>`).join('');
}
function _wzRenderChildren() {
  if (!_wz.children.length) return '<div class="wz-empty-list">Nenhuma criança adicionada</div>';
  return _wz.children.map((c, i) => `
    <div class="wz-member-chip">
      <span class="wz-member-emoji">🧒</span>
      <div class="wz-member-info">
        <strong>${esc(c.name||'—')}</strong>
        <span>${esc(c.relation||'')}</span>
      </div>
      <button class="wz-remove-btn" onclick="_wzRemoveChild(${i})">✕</button>
    </div>`).join('');
}

function _wzAddAdult() {
  _wzCollectMembers();
  const rel = _RELATIONS.map(r => `<option>${r}</option>`).join('');
  _wz.adults.push({ name: '', relation: 'Cônjuge/Parceiro(a)', invite: false, email: '' });
  document.getElementById('wzAdultList').innerHTML = _wzRenderAdults() + `
    <div class="wz-member-form" id="wzAdultForm">
      <input class="wz-input" id="wzAdultName" placeholder="Nome" maxlength="50" style="margin-bottom:6px">
      <select class="wz-select" id="wzAdultRel">${rel}</select>
      <button class="wz-add-btn" style="margin-top:6px" onclick="_wzConfirmAdult()">Confirmar</button>
    </div>`;
  document.getElementById('wzAdultName')?.focus();
}
function _wzConfirmAdult() {
  const name = document.getElementById('wzAdultName')?.value.trim();
  const rel  = document.getElementById('wzAdultRel')?.value;
  if (!name) return;
  const last = _wz.adults[_wz.adults.length - 1];
  if (last) { last.name = name; last.relation = rel; }
  document.getElementById('wzAdultList').innerHTML = _wzRenderAdults();
  const addBtn = document.querySelector('[onclick="_wzAddAdult()"]');
  if (addBtn) addBtn.style.display = '';
}
function _wzRemoveAdult(i) { _wz.adults.splice(i, 1); document.getElementById('wzAdultList').innerHTML = _wzRenderAdults(); }

function _wzAddChild() {
  _wzCollectMembers();
  const rel = ['Filho(a)','Neto(a)','Sobrinho(a)','Outro'].map(r => `<option>${r}</option>`).join('');
  _wz.children.push({ name: '', relation: 'Filho(a)' });
  document.getElementById('wzChildList').innerHTML = _wzRenderChildren() + `
    <div class="wz-member-form" id="wzChildForm">
      <input class="wz-input" id="wzChildName" placeholder="Nome" maxlength="50" style="margin-bottom:6px">
      <select class="wz-select" id="wzChildRel">${rel}</select>
      <button class="wz-add-btn" style="margin-top:6px" onclick="_wzConfirmChild()">Confirmar</button>
    </div>`;
  document.getElementById('wzChildName')?.focus();
}
function _wzConfirmChild() {
  const name = document.getElementById('wzChildName')?.value.trim();
  const rel  = document.getElementById('wzChildRel')?.value;
  if (!name) return;
  const last = _wz.children[_wz.children.length - 1];
  if (last) { last.name = name; last.relation = rel; }
  document.getElementById('wzChildList').innerHTML = _wzRenderChildren();
}
function _wzRemoveChild(i) { _wz.children.splice(i, 1); document.getElementById('wzChildList').innerHTML = _wzRenderChildren(); }

function _wzCollectMembers() {
  // Remove any unfilled entries (name empty)
  _wz.adults   = _wz.adults.filter(a => a.name);
  _wz.children = _wz.children.filter(c => c.name);
}

// ── Step 3: Convites ──────────────────────────────────────────────────────
function _wzStep3(body, title, subtitle) {
  if (title)    title.textContent    = 'Convidar membros 📨';
  if (subtitle) subtitle.textContent = 'Adultos podem ter acesso ao app. Você pode convidar agora ou depois.';

  const adults = _wz.adults;
  if (!adults.length) {
    body.innerHTML = '<div class="wz-hint" style="text-align:center;padding:24px">Nenhum adulto para convidar.</div>';
    return;
  }

  body.innerHTML = `
    <div class="wz-invite-list">
      ${adults.map((a, i) => `
        <div class="wz-invite-row">
          <label class="wz-invite-toggle">
            <input type="checkbox" id="wzInv_${i}" ${a.invite?'checked':''} onchange="_wz.adults[${i}].invite=this.checked;document.getElementById('wzInvEmail_${i}').style.display=this.checked?'':'none'">
            <span class="wz-invite-name">👤 ${esc(a.name)}</span>
            <span class="wz-invite-rel">${esc(a.relation)}</span>
          </label>
          <input class="wz-input wz-invite-email" id="wzInvEmail_${i}"
                 type="email" placeholder="e-mail para convite"
                 value="${esc(a.email||'')}"
                 style="display:${a.invite?'':'none'}"
                 oninput="_wz.adults[${i}].email=this.value">
        </div>`).join('')}
    </div>
    <div class="wz-hint" style="margin-top:8px">Os convites serão enviados via EmailJS quando configurado.</div>`;
}

function _wzCollectInvites() {
  _wz.adults.forEach((a, i) => {
    const cb  = document.getElementById(`wzInv_${i}`);
    const em  = document.getElementById(`wzInvEmail_${i}`);
    if (cb)  a.invite = cb.checked;
    if (em)  a.email  = em.value.trim();
  });
}

// ── Step 4: Gastos / Categorias ───────────────────────────────────────────
const _WZ_EXPENSE_OPTIONS = [
  { key:'educacao',   label:'Educação / Escola',    emoji:'🎓', suggested: 1500 },
  { key:'saude',      label:'Saúde / Plano',         emoji:'🏥', suggested: 800  },
  { key:'viagens',    label:'Viagens',               emoji:'✈️', suggested: 1000 },
  { key:'automovel',  label:'Automóvel',             emoji:'🚗', suggested: 600  },
  { key:'lazer',      label:'Lazer & Entretenimento',emoji:'🎭', suggested: 400  },
  { key:'festas',     label:'Festas & Eventos',      emoji:'🎉', suggested: 500  },
  { key:'mercado',    label:'Supermercado',          emoji:'🛒', suggested: 2000 },
  { key:'moradia',    label:'Moradia / Aluguel',     emoji:'🏠', suggested: 2500 },
  { key:'restaurante',label:'Restaurantes',          emoji:'🍽️', suggested: 800  },
  { key:'assinaturas',label:'Assinaturas & Streaming',emoji:'📱',suggested: 200  },
];

function _wzStep4(body, title, subtitle) {
  if (title)    title.textContent    = 'Principais gastos da família 💸';
  if (subtitle) subtitle.textContent = 'Selecione e informe o valor mensal aproximado para criar orçamentos.';

  const selectedKeys = new Set(_wz.expenses.map(e => e.key));

  body.innerHTML = `
    <div class="wz-expense-grid">
      ${_WZ_EXPENSE_OPTIONS.map(opt => {
        const sel = selectedKeys.has(opt.key);
        const ex  = _wz.expenses.find(e => e.key === opt.key);
        return `
        <div class="wz-expense-card ${sel?'wz-expense-card--selected':''}" id="wzExpCard_${opt.key}" onclick="_wzToggleExpense('${opt.key}')">
          <div class="wz-expense-emoji">${opt.emoji}</div>
          <div class="wz-expense-label">${opt.label}</div>
          ${sel ? `<input class="wz-expense-amt" type="number" min="0" step="50"
                    placeholder="R$ mensal" value="${ex?.amount || opt.suggested}"
                    onclick="event.stopPropagation()"
                    onchange="_wzSetExpenseAmt('${opt.key}',this.value)"
                    oninput="_wzSetExpenseAmt('${opt.key}',this.value)">` : ''}
        </div>`;
      }).join('')}
    </div>
    <div class="wz-hint" style="margin-top:8px">As categorias e orçamentos mensais serão criados automaticamente.</div>`;
}

function _wzToggleExpense(key) {
  const idx = _wz.expenses.findIndex(e => e.key === key);
  const opt = _WZ_EXPENSE_OPTIONS.find(o => o.key === key);
  if (idx >= 0) {
    _wz.expenses.splice(idx, 1);
  } else {
    _wz.expenses.push({ key, label: opt.label, emoji: opt.emoji, amount: opt.suggested });
  }
  _wzStep4(document.getElementById('wzBody'), null, null);
}
function _wzSetExpenseAmt(key, val) {
  const ex = _wz.expenses.find(e => e.key === key);
  if (ex) ex.amount = parseFloat(val) || 0;
}
function _wzCollectExpenses() {
  // amounts already updated via oninput; just ensure all selected have amounts
  _wz.expenses.forEach(e => { if (!e.amount) e.amount = _WZ_EXPENSE_OPTIONS.find(o => o.key === e.key)?.suggested || 0; });
}

// ── Step 5: Concluído ─────────────────────────────────────────────────────


// ── Step 5: Tutorial — Criar uma Conta ───────────────────────────────────
function _wzStep5_account(body, title, subtitle) {
  if (title)    title.textContent    = 'Crie sua primeira conta 🏦';
  if (subtitle) subtitle.textContent = 'Uma conta representa um banco, carteira ou cartão. É por onde as transações passam.';
  body.innerHTML = `
    <div class="wz-guide-card">
      <div class="wz-guide-steps">
        <div class="wz-guide-step">
          <span class="wz-guide-num">1</span>
          <div><strong>Acesse Contas</strong> no menu lateral ou clique no botão abaixo</div>
        </div>
        <div class="wz-guide-step">
          <span class="wz-guide-num">2</span>
          <div>Clique em <strong>+ Nova Conta</strong></div>
        </div>
        <div class="wz-guide-step">
          <span class="wz-guide-num">3</span>
          <div>Informe nome, banco, moeda e saldo inicial</div>
        </div>
        <div class="wz-guide-step">
          <span class="wz-guide-num">4</span>
          <div>Marque como <strong>⭐ Favorita</strong> para aparecer em destaque no dashboard</div>
        </div>
      </div>
      <div class="wz-guide-tip">💡 Sugestão: comece pela conta corrente principal. Você pode adicionar mais depois.</div>
      <div style="text-align:center;margin-top:16px">
        <button class="btn btn-primary" style="gap:8px" onclick="_wzOpenAccount()">
          🏦 Criar minha primeira conta
        </button>
      </div>
    </div>`;
}

function _wzOpenAccount() {
  _wzClose();
  navigate('accounts');
  setTimeout(() => {
    if (typeof openAccountModal === 'function') openAccountModal();
  }, 400);
  // Re-show wizard after modal closes using MutationObserver
  _wzWatchModalClose('accountModal', () => {
    _wzOpen();
    if ((state.accounts||[]).length > 0) {
      // Account was created — auto-advance past this step
      if (_wz.step === 5) _wz.step = 6;
      _wzRenderStep();
    }
  });
}

// ── Step 6: Tutorial — Registrar Transação ────────────────────────────────
function _wzStep6_transaction(body, title, subtitle) {
  const hasAccounts = (state.accounts||[]).length > 0;
  if (title)    title.textContent    = 'Registre sua primeira transação 💸';
  if (subtitle) subtitle.textContent = 'Transações são entradas e saídas de dinheiro. Podem ser despesas, receitas ou transferências.';
  body.innerHTML = `
    <div class="wz-guide-card">
      <div class="wz-guide-steps">
        <div class="wz-guide-step">
          <span class="wz-guide-num">1</span>
          <div>Toque no <strong>botão ＋</strong> flutuante ou no ícone de nova transação</div>
        </div>
        <div class="wz-guide-step">
          <span class="wz-guide-num">2</span>
          <div>Escolha o <strong>tipo</strong>: Despesa, Receita ou Transferência</div>
        </div>
        <div class="wz-guide-step">
          <span class="wz-guide-num">3</span>
          <div>Preencha data, valor, conta e <strong>categoria</strong></div>
        </div>
        <div class="wz-guide-step">
          <span class="wz-guide-num">4</span>
          <div>Salve — o saldo da conta é atualizado na hora</div>
        </div>
      </div>
      <div class="wz-guide-tip">💡 Dica: use <strong>Programados</strong> para lançamentos recorrentes como aluguel, assinaturas e salário — o app registra automaticamente.</div>
      ${!hasAccounts ? '<div class="wz-guide-warn">⚠️ Crie uma conta primeiro antes de registrar transações.</div>' : `
      <div style="text-align:center;margin-top:16px">
        <button class="btn btn-primary" onclick="_wzOpenTransaction()">
          ＋ Registrar uma transação agora
        </button>
      </div>`}
    </div>`;
}

function _wzOpenTransaction() {
  _wzClose();
  navigate('transactions');
  setTimeout(() => {
    if (typeof openTransactionModal === 'function') openTransactionModal();
  }, 400);
  _wzWatchModalClose('txModal', () => {
    _wzOpen();
    if ((state.transactions||[]).length > 0 && _wz.step === 6) {
      _wz.step = 7;
      _wzRenderStep();
    }
  });
}

// ── Step 7: Tutorial — Relatórios & Orçamentos ───────────────────────────
function _wzStep7_reports(body, title, subtitle) {
  if (title)    title.textContent    = 'Acompanhe suas finanças 📊';
  if (subtitle) subtitle.textContent = 'Relatórios e orçamentos ajudam a entender para onde vai seu dinheiro.';
  body.innerHTML = `
    <div class="wz-guide-card">
      <div class="wz-guide-sections">

        <div class="wz-guide-section-block">
          <div class="wz-guide-section-title">📄 Relatórios</div>
          <div class="wz-guide-steps">
            <div class="wz-guide-step">
              <span class="wz-guide-num">1</span>
              <div>Acesse <strong>Relatórios</strong> no menu</div>
            </div>
            <div class="wz-guide-step">
              <span class="wz-guide-num">2</span>
              <div>Escolha o período e filtre por conta ou categoria</div>
            </div>
            <div class="wz-guide-step">
              <span class="wz-guide-num">3</span>
              <div>Exporte em <strong>PDF ou CSV</strong>, ou envie por e-mail</div>
            </div>
          </div>
          <div style="text-align:center;margin-top:10px">
            <button class="btn btn-ghost btn-sm" onclick="_wzGoTo('reports')">Ver Relatórios →</button>
          </div>
        </div>

        <div class="wz-guide-section-block" style="margin-top:16px">
          <div class="wz-guide-section-title">🎯 Orçamentos</div>
          <div class="wz-guide-steps">
            <div class="wz-guide-step">
              <span class="wz-guide-num">1</span>
              <div>Acesse <strong>Orçamentos</strong> no menu</div>
            </div>
            <div class="wz-guide-step">
              <span class="wz-guide-num">2</span>
              <div>Defina um limite mensal por categoria${(_wz.expenses.length > 0) ? ' — <strong>já criamos os seus!</strong>' : ''}</div>
            </div>
            <div class="wz-guide-step">
              <span class="wz-guide-num">3</span>
              <div>Acompanhe as barras de progresso em tempo real</div>
            </div>
          </div>
          <div style="text-align:center;margin-top:10px">
            <button class="btn btn-ghost btn-sm" onclick="_wzGoTo('budgets')">Ver Orçamentos →</button>
          </div>
        </div>

      </div>
      <div class="wz-guide-tip" style="margin-top:16px">💡 Dica: use <strong>Previsão</strong> em Relatórios para ver o saldo futuro com base nos lançamentos programados.</div>
    </div>`;
}

function _wzGoTo(page) {
  _wzClose();
  navigate(page);
  // Store step so re-open returns here
  setTimeout(_wzOpen, 1200);
}

// ── Shared helper: watch for modal close ─────────────────────────────────
function _wzWatchModalClose(modalId, callback) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  let prevOpen = modal.classList.contains('open') || modal.style.display !== 'none';
  const obs = new MutationObserver(() => {
    const nowOpen = modal.classList.contains('open') || modal.style.display !== 'none';
    if (prevOpen && !nowOpen) {
      obs.disconnect();
      setTimeout(callback, 300);
    }
    prevOpen = nowOpen;
  });
  obs.observe(modal, { attributes: true, attributeFilter: ['class','style'] });
}


// ── Step 8: Módulos opcionais ─────────────────────────────────────────────
const _WZ_MODULES = [
  {
    key: 'aiInsights',
    icon: '🤖',
    color: '#7c3aed',
    title: 'AI Insights',
    desc: 'Análise inteligente das suas finanças com Google Gemini. Gera relatórios em linguagem natural, detecta oportunidades de economia, projeta o futuro do seu saldo e responde perguntas sobre seus dados.',
    badge: 'Requer chave API gratuita do Google',
    badgeColor: '#7c3aed',
  },
  {
    key: 'investments',
    icon: '💹',
    color: '#16a34a',
    title: 'Investimentos',
    desc: 'Acompanhe sua carteira de ações, FIIs, ETFs, criptomoedas e renda fixa. Cotações automáticas, gráficos de performance, custo médio e histórico de movimentações.',
    badge: 'Cotações automáticas via B3, Yahoo Finance e CoinGecko',
    badgeColor: '#16a34a',
  },
  {
    key: 'debts',
    icon: '💳',
    color: '#dc2626',
    title: 'Controle de Dívidas',
    desc: 'Registre empréstimos, financiamentos e dívidas com cálculo de juros automático. Aplique estratégias de quitação (bola de neve ou avalanche) e veja o impacto no seu fluxo de caixa.',
    badge: 'Suporte a SELIC, IPCA, CDI, juros fixos e mais',
    badgeColor: '#dc2626',
  },
  {
    key: 'prices',
    icon: '🏪',
    color: '#0891b2',
    title: 'Rastreamento de Preços',
    desc: 'Crie um catálogo de produtos com histórico de preços em diferentes lojas. Integrado à Lista de Mercado: saiba sempre onde comprar mais barato e identifique a melhor época para comprar.',
    badge: 'Inclui Lista de Mercado integrada',
    badgeColor: '#0891b2',
  },
];

function _wzStep8_modules(body, title, subtitle) {
  if (title)    title.textContent    = 'Módulos opcionais 🧩';
  if (subtitle) subtitle.textContent = 'Expanda o FinTrack com funcionalidades extras. Você pode ativar ou desativar a qualquer momento em Configurações → Módulos.';

  body.innerHTML = `
    <div class="wz-modules-grid">
      ${_WZ_MODULES.map(m => {
        const on = !!_wz.modules[m.key];
        return `
        <div class="wz-module-card ${on ? 'wz-module-card--on' : ''}" id="wzMod_${m.key}" onclick="_wzToggleModule('${m.key}')">
          <div class="wz-module-card-top">
            <span class="wz-module-icon" style="background:${m.color}18;color:${m.color}">${m.icon}</span>
            <div class="wz-module-toggle-wrap">
              <div class="wz-module-toggle ${on ? 'wz-module-toggle--on' : ''}" id="wzModToggle_${m.key}">
                <div class="wz-module-toggle-knob"></div>
              </div>
            </div>
          </div>
          <div class="wz-module-title" style="color:${on ? m.color : 'var(--text)'}">${m.title}</div>
          <div class="wz-module-desc">${m.desc}</div>
          <div class="wz-module-badge" style="background:${m.color}14;color:${m.color};border-color:${m.color}30">${m.badge}</div>
        </div>`;
      }).join('')}
    </div>
    <div class="wz-hint" style="margin-top:12px;text-align:center">💡 Todos os módulos podem ser ativados/desativados depois em <strong>Configurações → Módulos</strong>.</div>`;
}

function _wzToggleModule(key) {
  _wz.modules[key] = !_wz.modules[key];
  const card   = document.getElementById('wzMod_' + key);
  const toggle = document.getElementById('wzModToggle_' + key);
  const m      = _WZ_MODULES.find(x => x.key === key);
  if (!card || !m) return;
  const on = _wz.modules[key];
  card.classList.toggle('wz-module-card--on', on);
  toggle?.classList.toggle('wz-module-toggle--on', on);
  const titleEl = card.querySelector('.wz-module-title');
  if (titleEl) titleEl.style.color = on ? m.color : 'var(--text)';
}
window._wzToggleModule = _wzToggleModule;

function _wzStep9_done(body, title, subtitle) {
  if (title)    title.textContent    = 'Tudo pronto! 🎉';
  if (subtitle) subtitle.textContent = 'Criando sua configuração inicial…';

  const nextBtn = document.getElementById('wzNextBtn');
  if (nextBtn) nextBtn.style.display = 'none';

  body.innerHTML = `
    <div id="wzFinalStatus" class="wz-status-list">
      <div class="wz-status-row" id="wzSt_family">⏳ Atualizando nome da família…</div>
      <div class="wz-status-row" id="wzSt_cats"  style="display:none">⏳ Criando categorias…</div>
      <div class="wz-status-row" id="wzSt_budgets" style="display:none">⏳ Criando orçamentos…</div>
      <div class="wz-status-row" id="wzSt_modules" style="display:none">⏳ Ativando módulos…</div>
      <div class="wz-status-row" id="wzSt_invites" style="display:none">⏳ Enviando convites…</div>
      <div class="wz-status-row" id="wzSt_modules" style="display:none">⏳ Ativando módulos…</div>
    </div>
    <div id="wzDoneBtn" style="display:none;text-align:center;margin-top:20px">
      <!-- Feedback highlight card -->
      <div style="margin:0 auto 20px;max-width:400px;background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);border:1.5px solid rgba(99,102,241,.35);border-radius:16px;padding:18px 20px;text-align:left">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <div style="width:36px;height:36px;border-radius:10px;background:rgba(99,102,241,.2);display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </div>
          <div>
            <div style="color:#e0e7ff;font-size:.88rem;font-weight:700;line-height:1.2">Sua opinião importa! 💡</div>
            <div style="color:rgba(199,210,254,.6);font-size:.72rem;margin-top:2px">Ajude a melhorar o Family FinTrack</div>
          </div>
        </div>
        <p style="color:rgba(199,210,254,.8);font-size:.8rem;line-height:1.6;margin:0 0 12px">
          Encontrou um bug? Tem uma ideia de melhoria? O botão 
          <span style="display:inline-flex;align-items:center;gap:4px;background:rgba(99,102,241,.2);border:1px solid rgba(99,102,241,.4);border-radius:6px;padding:2px 7px">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <span style="font-size:.72rem;color:#a5b4fc;font-weight:600">Feedback</span>
          </span>
          na barra superior está sempre disponível para você reportar qualquer coisa a qualquer momento.
        </p>
        <button onclick="_wzClose();setTimeout(()=>openFeedbackModal(),400)"
          style="width:100%;padding:9px;border:1px solid rgba(99,102,241,.5);border-radius:10px;background:rgba(99,102,241,.15);color:#a5b4fc;font-family:var(--font-sans);font-size:.82rem;font-weight:700;cursor:pointer;transition:all .18s"
          onmouseover="this.style.background='rgba(99,102,241,.3)'"
          onmouseout="this.style.background='rgba(99,102,241,.15)'">
          💬 Enviar meu primeiro feedback →
        </button>
      </div>
      <button class="btn btn-primary" style="padding:12px 36px;font-size:.95rem" onclick="_wzFinish()">
        Ir para o Dashboard →
      </button>
    </div>`;

  _wzRunSetup();
}

function _wzSetStatus(id, msg, done) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = '';
  el.innerHTML = done ? `✅ ${msg}` : `⏳ ${msg}`;
}

async function _wzRunSetup() {
  try {
    // 1. Create family (new user) or update existing family name
    let famId_ = currentUser?.family_id || currentUser?.families?.[0]?.id;

    if (_wz.creatingFamily && !famId_) {
      // New user has no family — create one and make them owner
      _wzSetStatus('wzSt_family', 'Criando família…', false);
      const { data: rpcData, error: rpcErr } = await sb.rpc('create_family_with_owner', {
        p_name:        _wz.familyName,
        p_description: null,
      });
      if (rpcErr) {
        // Fallback: direct insert
        const { data: fam, error: famErr } = await sb.from('families')
          .insert({ name: _wz.familyName }).select('id').single();
        if (famErr) throw famErr;
        famId_ = fam.id;
        await sb.from('family_members').insert({
          user_id: currentUser.id, family_id: famId_, role: 'owner',
        });
        await sb.from('app_users').update({
          family_id: famId_, preferred_family_id: famId_,
        }).eq('id', currentUser.id);
        currentUser.family_id = famId_;
        currentUser.families  = [{ id: famId_, name: _wz.familyName, role: 'owner' }];
      } else {
        // RPC succeeded — reload context to get family_id
        await _loadCurrentUserContext();
        famId_ = currentUser?.family_id;
      }
      _wz.creatingFamily = false;
    } else if (famId_ && _wz.familyName) {
      // Existing family — just rename it
      try { await sb.from('families').update({ name: _wz.familyName }).eq('id', famId_); } catch (_) {}
    }
    _wzSetStatus('wzSt_family', `Família "${_wz.familyName}" configurada`, true);

    // 2. Create categories
    if (_wz.expenses.length) {
      _wzSetStatus('wzSt_cats', 'Criando categorias…', false);
      const now = new Date().toISOString();
      const catResults = [];
      for (const exp of _wz.expenses) {
        const { data: cat, error } = await sb.from('categories').insert({
          name: exp.label,
          icon: exp.emoji,
          color: _wzCatColor(exp.key),
          type: 'expense',
          family_id: famId(),
          created_at: now,
        }).select('id').single();
        if (!error && cat) catResults.push({ exp, catId: cat.id });
      }
      _wzSetStatus('wzSt_cats', `${catResults.length} categoria${catResults.length !== 1 ? 's' : ''} criada${catResults.length !== 1 ? 's' : ''}`, true);

      // 3. Create budgets
      if (catResults.length) {
        _wzSetStatus('wzSt_budgets', 'Criando orçamentos…', false);
        const ym = new Date().toISOString().slice(0, 7);
        const [y, m] = ym.split('-');
        const monthStr = `${y}-${m}-01`;
        let budgetCount = 0;
        for (const { exp, catId } of catResults) {
          if (!exp.amount) continue;
          const { error } = await sb.from('budgets').upsert({
            category_id: catId,
            amount: exp.amount,
            month: monthStr,
            family_id: famId(),
          }, { onConflict: 'category_id,month' });
          if (!error) budgetCount++;
        }
        _wzSetStatus('wzSt_budgets', `${budgetCount} orçamento${budgetCount !== 1 ? 's' : ''} criado${budgetCount !== 1 ? 's' : ''}`, true);
      }
    } else {
      _wzSetStatus('wzSt_cats',    'Categorias: pulado', true);
      _wzSetStatus('wzSt_budgets', 'Orçamentos: pulado', true);
    }

    // 4. Apply selected modules
    const mods = _wz.modules || {};
    const anyMod = Object.values(mods).some(v => v);
    if (anyMod) {
      _wzSetStatus('wzSt_modules', 'Ativando módulos…', false);
      const modLabels = { prices: '🏷️ Preços', investments: '📈 Investimentos', debts: '💳 Dívidas', aiInsights: '🤖 IA Insights' };
      const NAV_MAP = { prices: '[data-nav="prices"]', investments: '[data-nav="investments"]', debts: '[data-nav="debts"]', aiInsights: '[data-nav="ai_insights"]' };
      const active = Object.entries(mods).filter(([,v]) => v).map(([k]) => modLabels[k] || k);
      Object.entries(NAV_MAP).forEach(([key, sel]) => {
        document.querySelectorAll(sel).forEach(el => { el.style.display = mods[key] ? '' : 'none'; });
      });
      if (typeof saveAppSetting === 'function') {
        await Promise.all(Object.entries(mods).map(([k, v]) => saveAppSetting('module_' + k + '_enabled', v).catch(() => {})));
      }
      _wzSetStatus('wzSt_modules', `Módulos ativos: ${active.join(', ') || 'nenhum'}`, true);
    } else {
      document.getElementById('wzSt_modules').style.display = 'none';
    }

    // 6. Send invites
    const invites = _wz.adults.filter(a => a.invite && a.email);
    if (invites.length) {
      _wzSetStatus('wzSt_invites', 'Enviando convites…', false);
      let sent = 0;
      for (const a of invites) {
        try {
          await _sendFamilyInviteEmail(a.email, a.name, _wz.familyName);
          sent++;
        } catch(e) { console.warn('[Wizard invite]', e.message); }
      }
      _wzSetStatus('wzSt_invites', `${sent} convite${sent !== 1 ? 's' : ''} enviado${sent !== 1 ? 's' : ''}`, true);
    } else {
      document.getElementById('wzSt_invites').style.display = 'none';
    }

    // 5. Save optional modules
    const modKeys = Object.entries(_wz.modules).filter(([,v]) => v).map(([k]) => k);
    if (modKeys.length) {
      const modMap = {
        aiInsights:  'module_ai_insights',
        investments: 'module_investments',
        debts:       'module_debts',
        prices:      'module_prices',
        grocery:     'module_grocery',
      };
      for (const k of modKeys) {
        if (modMap[k]) {
          await saveAppSetting(modMap[k], true).catch(() => {});
          // Also enable grocery when prices is enabled
          if (k === 'prices') await saveAppSetting('module_grocery', true).catch(() => {});
        }
      }
    }

    // 6. Mark wizard done
    await saveAppSetting('wizard_dismissed', true).catch(()=>{});

    // Reload data in background
    DB.preload().then(() => { if(typeof populateSelects==='function') populateSelects(); }).catch(()=>{});

    document.getElementById('wzDoneBtn').style.display = '';
    const sub = document.getElementById('wzSubtitle');
    if (sub) sub.textContent = 'Configuração concluída com sucesso!';

  } catch(e) {
    console.error('[Wizard setup]', e);
    const sub = document.getElementById('wzSubtitle');
    if (sub) sub.textContent = 'Erro: ' + (e.message || 'desconhecido');
  }
}

function _wzFinish() {
  _wzClose();
  // If this was a new-user creation flow, boot the app fully
  // (they never had a family_id before, so bootApp was never called)
  const needsBoot = !!(window._wzNeedsBoot);
  window._wzNeedsBoot = false;
  if (needsBoot && typeof bootApp === 'function') {
    bootApp().catch(() => {});
  } else {
    loadDashboard?.().catch(() => {});
    navigate('dashboard');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────
function _wzCatColor(key) {
  const colors = {
    educacao: '#1d4ed8', saude: '#16a34a', viagens: '#0891b2',
    automovel: '#7c3aed', lazer: '#be185d', festas: '#f59e0b',
    mercado: '#2a6049', moradia: '#c2410c', restaurante: '#b45309',
    assinaturas: '#6d28d9',
  };
  return colors[key] || '#2a6049';
}

async function _sendFamilyInviteEmail(toEmail, toName, familyName) {
  if (!EMAILJS_CONFIG?.serviceId || !EMAILJS_CONFIG?.publicKey) return;
  emailjs.init(EMAILJS_CONFIG.publicKey);
  const appUrl = window.location.origin + window.location.pathname;
  await emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, {
    to_email: toEmail,
    subject: `Convite para a família "${familyName}" no FinTrack`,
    message: `Olá ${toName}! Você foi convidado a participar da família "${familyName}" no Family FinTrack.\n\nAcesse ${appUrl} e solicite acesso com este e-mail (${toEmail}).`,
    report_content: `<p>Olá <strong>${toName}</strong>!<br><br>Você foi convidado para a família <strong>${familyName}</strong> no Family FinTrack.<br><br><a href="${appUrl}" style="background:#2a6049;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600">Acessar o app →</a></p>`,
    from_name: 'Family FinTrack',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 5-ALT: Módulos opcionais
// _wz.modules = { prices: bool, investments: bool, debts: bool, aiInsights: bool }
// Inserido como step 5 (entre orçamentos e contas)
// totalSteps permanece 8 — vamos apenas substituir step5 renderização
// ─────────────────────────────────────────────────────────────────────────────

// Injetar step de módulos entre steps 4 e 5
// Remap: antigo step5=contas agora é step6, etc.
// Para não quebrar o flow existente, sobrescrevemos _wzRenderStep para chamar
// o novo step de módulos quando step===5, e deslocar os demais.

const _wzRenderStepOrig = _wzRenderStep;

// Módulos selecionados pelo usuário
if (!_wz.modules) _wz.modules = { prices: false, investments: false, debts: false, aiInsights: false };

// Patch: adiciona step 5 de módulos e move os outros
(function() {
  window._wzRenderStep = function() {
    _wzClearError();
    const body     = document.getElementById('wzBody');
    const progress = document.getElementById('wzProgress');
    const backBtn  = document.getElementById('wzBackBtn');
    const nextBtn  = document.getElementById('wzNextBtn');
    const skipBtn  = document.getElementById('wzSkipBtn');
    const title    = document.getElementById('wzTitle');
    const subtitle = document.getElementById('wzSubtitle');
    if (!body) return;

    // totalSteps now 9 (added modules step)
    const TOTAL = 9;
    const pct = ((_wz.step - 1) / (TOTAL - 1)) * 100;
    if (progress) progress.style.width = pct + '%';

    document.querySelectorAll('.wz-dot').forEach((d, i) => {
      d.classList.toggle('wz-dot--active', i + 1 === _wz.step);
      d.classList.toggle('wz-dot--done',   i + 1 < _wz.step);
    });

    if (backBtn)  backBtn.style.display  = _wz.step > 1 && _wz.step < TOTAL ? '' : 'none';
    if (nextBtn)  nextBtn.style.display  = _wz.step < TOTAL ? '' : 'none';
    if (skipBtn)  skipBtn.style.display  = (_wz.step >= 2 && _wz.step <= TOTAL - 1) ? '' : 'none';
    if (nextBtn)  nextBtn.textContent    = (_wz.step === TOTAL - 1) ? '✅ Finalizar' : 'Continuar →';

    switch (_wz.step) {
      case 1: return _wzStep1(body, title, subtitle);
      case 2: return _wzStep2(body, title, subtitle);
      case 3: return _wzStep3(body, title, subtitle);
      case 4: return _wzStep4(body, title, subtitle);
      case 5: return _wzStep5_modules(body, title, subtitle);  // NEW
      case 6: return _wzStep5_account(body, title, subtitle);
      case 7: return _wzStep6_transaction(body, title, subtitle);
      case 8: return _wzStep7_reports(body, title, subtitle);
      case 9: return _wzStep8_done(body, title, subtitle);
    }
  };

  // Also patch _wzNext/_wzBack/_wzSkip/_wzValidateStep to use dynamic total
  const _origValidate = window._wzValidateStep || (() => true);
  window._wzValidateStep = function() {
    if (_wz.step === 1) {
      const name = document.getElementById('wzFamilyName')?.value.trim();
      if (!name) { _wzShowError('Informe o nome da família'); return false; }
      _wz.familyName = name;
    }
    if (_wz.step === 2) {
      _wzCollectMembers();
      if (_wz.adults.length === 0) { _wzShowError('Adicione pelo menos um adulto'); return false; }
    }
    if (_wz.step === 3) { _wzCollectInvites(); }
    if (_wz.step === 4) { _wzCollectExpenses(); }
    if (_wz.step === 5) { _wzCollectModules(); }
    _wzClearError();
    return true;
  };

  window._wzNext = function() {
    if (!_wzValidateStep()) return;
    if (_wz.step < 9) { _wz.step++; window._wzRenderStep(); }
  };
  window._wzBack = function() {
    if (_wz.step > 1) { _wz.step--; window._wzRenderStep(); }
  };
  window._wzSkip = function() {
    if (_wz.step < 9) { _wz.step++; window._wzRenderStep(); }
  };
  window._wzOpen = function() {
    const el = document.getElementById('wizardOverlay');
    if (el) { el.style.display = 'flex'; window._wzRenderStep(); }
  };
})();

// ── Step 5: Módulos opcionais ──────────────────────────────────────────────
function _wzStep5_modules(body, title, subtitle) {
  if (title)    title.textContent    = 'Módulos opcionais 🧩';
  if (subtitle) subtitle.textContent = 'Ative recursos adicionais conforme a sua necessidade. Você pode alterar isso depois nas configurações.';

  const m = _wz.modules;
  const MODULE_DATA = [
    {
      key: 'prices',
      icon: '🏷️',
      title: 'Rastreamento de Preços',
      color: '#0891b2',
      bgColor: '#e0f2fe',
      description: 'Monitore o histórico de preços de produtos em supermercados e lojas. Compare preços entre estabelecimentos e descubra quando comprar mais barato.',
      badge: 'Economia doméstica',
      nav: 'prices',
    },
    {
      key: 'investments',
      icon: '📈',
      title: 'Carteira de Investimentos',
      color: '#16a34a',
      bgColor: '#dcfce7',
      description: 'Acompanhe ações, FIIs, renda fixa, cripto e outros ativos. Veja rentabilidade, alocação e evolução do patrimônio ao longo do tempo.',
      badge: 'Patrimônio',
      nav: 'investments',
    },
    {
      key: 'debts',
      icon: '💳',
      title: 'Gestão de Dívidas',
      color: '#dc2626',
      bgColor: '#fee2e2',
      description: 'Controle empréstimos, parcelamentos e dívidas em geral. Veja o saldo devedor, calcule juros e acompanhe o progresso de quitação.',
      badge: 'Controle financeiro',
      nav: 'debts',
    },
    {
      key: 'aiInsights',
      icon: '🤖',
      title: 'IA Insights',
      color: '#7c3aed',
      bgColor: '#f3e8ff',
      description: 'Análise inteligente das suas finanças com Gemini AI. Receba insights personalizados, identifique padrões de gastos e obtenha sugestões para economizar mais.',
      badge: 'Inteligência artificial',
      nav: 'ai_insights',
    },
  ];

  body.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px">
      ${MODULE_DATA.map(mod => {
        const active = m[mod.key];
        return `
        <div class="wz-module-card ${active ? 'wz-module-card--active' : ''}"
             id="wzMod_${mod.key}"
             onclick="_wzToggleModule('${mod.key}')"
             style="border:2px solid ${active ? mod.color : 'var(--border)'};border-radius:12px;padding:12px 14px;cursor:pointer;background:${active ? mod.bgColor : 'var(--surface)'};transition:all .2s;user-select:none">
          <div style="display:flex;align-items:center;gap:10px">
            <div style="width:40px;height:40px;border-radius:10px;background:${mod.bgColor};display:flex;align-items:center;justify-content:center;font-size:1.3rem;flex-shrink:0;border:1.5px solid ${active ? mod.color : 'transparent'}">
              ${mod.icon}
            </div>
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <span style="font-size:.88rem;font-weight:700;color:${active ? mod.color : 'var(--text)'}">${mod.title}</span>
                <span style="font-size:.62rem;font-weight:600;padding:2px 7px;border-radius:20px;background:${mod.bgColor};color:${mod.color};border:1px solid ${mod.color}22">${mod.badge}</span>
              </div>
              <div style="font-size:.75rem;color:var(--muted);margin-top:3px;line-height:1.4">${mod.description}</div>
            </div>
            <div style="width:24px;height:24px;border-radius:50%;border:2px solid ${active ? mod.color : 'var(--border)'};background:${active ? mod.color : 'transparent'};display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .2s">
              ${active ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>
    <div class="wz-hint" style="margin-top:10px;text-align:center">💡 Você pode ativar ou desativar qualquer módulo depois em <strong>Configurações → Família</strong></div>`;
}

function _wzToggleModule(key) {
  _wz.modules[key] = !_wz.modules[key];
  // Re-render only the modules step body
  _wzStep5_modules(document.getElementById('wzBody'), null, null);
}

function _wzCollectModules() {
  // Persist module preferences to app_settings
  const mods = _wz.modules;
  // Save async (fire-and-forget)
  if (typeof saveAppSetting === 'function') {
    Object.entries(mods).forEach(([k, v]) => {
      saveAppSetting('module_' + k + '_enabled', v).catch(() => {});
    });
  }
}

// Patch _wzRunSetup to apply module nav visibility after setup
const _wzRunSetupOrig = window._wzRunSetup;
window._wzRunSetup = async function() {
  await _wzRunSetupOrig.call(this);
  // Apply module nav visibility
  const mods = _wz.modules;
  const NAV_MAP = {
    prices: '[data-nav="prices"]',
    investments: '[data-nav="investments"]',
    debts: '[data-nav="debts"]',
    aiInsights: '[data-nav="ai_insights"]',
  };
  Object.entries(NAV_MAP).forEach(([key, sel]) => {
    document.querySelectorAll(sel).forEach(el => {
      el.style.display = mods[key] ? '' : 'none';
    });
  });
  // Persist nav visibility
  if (typeof saveAppSetting === 'function') {
    Object.entries(mods).forEach(([k, v]) => {
      saveAppSetting('module_' + k + '_enabled', v).catch(() => {});
    });
  }
};

// ── Wizard restart from profile ────────────────────────────────────────────
window.restartWizardFromProfile = async function() {
  const confirmed = confirm('Isso vai reiniciar o assistente de configuração. Deseja continuar?');
  if (!confirmed) return;
  await saveAppSetting('wizard_dismissed', false).catch(() => {});
  if (typeof closeModal === 'function') closeModal('myProfileModal');
  setTimeout(() => {
    _wzReset();
    _wz.modules = { prices: false, investments: false, debts: false, aiInsights: false };
    window._wzOpen();
  }, 300);
};
