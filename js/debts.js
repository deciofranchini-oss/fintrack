/* ═══════════════════════════════════════════════════════════════════════════
   DEBTS MODULE — Módulo de Dívidas · Family FinTrack
   Activation: debts_enabled_{family_id} in app_settings
   Scope: family-scoped, optional, fully isolated from account balances

   Architecture:
   - debts table (virtual liability account)
   - debt_ledger table (double-entry ledger per debt)
   - Amortization hook in saveTransaction() via onPayeeChange
   - BCB API integration for SELIC/IPCA/IGPM/CDI/Poupança
   - Scheduled update job with idempotency guard
═══════════════════════════════════════════════════════════════════════════ */


// ── Module state ─────────────────────────────────────────────────────────────
const _dbt = {
  loaded:   false,
  debts:    [],     // loaded debts for this family
  ledger:   {},     // { [debtId]: [entries] }
  updating: false,
};

// ── Index types ───────────────────────────────────────────────────────────────
const DEBT_INDEX_TYPES = [
  { code: 'fixed',    label: { pt: 'Juros Fixos',       en: 'Fixed Rate',     es: 'Tasa fija',    fr: 'Taux fixe' } },
  { code: 'selic',    label: { pt: 'SELIC',             en: 'SELIC',          es: 'SELIC',        fr: 'SELIC' } },
  { code: 'ipca',     label: { pt: 'IPCA',              en: 'IPCA',           es: 'IPCA',         fr: 'IPCA' } },
  { code: 'igpm',     label: { pt: 'IGPM',              en: 'IGPM',           es: 'IGPM',         fr: 'IGPM' } },
  { code: 'cdi',      label: { pt: 'CDI',               en: 'CDI',            es: 'CDI',          fr: 'CDI' } },
  { code: 'poupanca', label: { pt: 'Poupança',          en: 'Savings Rate',   es: 'Poupança',     fr: 'Épargne' } },
  { code: 'custom',   label: { pt: 'Manual / Outro',    en: 'Manual / Other', es: 'Manual / Otro',fr: 'Manuel / Autre' } },
];

const DEBT_PERIODICITIES = [
  { code: 'monthly',   label: { pt: 'Mensal',     en: 'Monthly',   es: 'Mensual',  fr: 'Mensuel' } },
  { code: 'quarterly', label: { pt: 'Trimestral', en: 'Quarterly', es: 'Trimestral',fr:'Trimestriel'} },
  { code: 'annual',    label: { pt: 'Anual',      en: 'Annual',    es: 'Anual',    fr: 'Annuel' } },
  { code: 'manual',    label: { pt: 'Manual',     en: 'Manual',    es: 'Manual',   fr: 'Manuel' } },
];

const DEBT_STATUSES = [
  { code: 'active',        label: { pt: 'Ativa',          en: 'Active',       es: 'Activa',        fr: 'Active' } },
  { code: 'settled',       label: { pt: 'Quitada',        en: 'Settled',      es: 'Saldada',       fr: 'Soldée' } },
  { code: 'suspended',     label: { pt: 'Suspensa',       en: 'Suspended',    es: 'Suspendida',    fr: 'Suspendue' } },
  { code: 'renegotiated',  label: { pt: 'Renegociada',    en: 'Renegotiated', es: 'Renegociada',   fr: 'Renégociée' } },
  { code: 'archived',      label: { pt: 'Arquivada',      en: 'Archived',     es: 'Archivada',     fr: 'Archivée' } },
];

const DEBT_ENTRY_TYPES = [
  { code: 'initial',     label: { pt: 'Abertura', en: 'Opening', es: 'Apertura', fr: 'Ouverture' } },
  { code: 'adjustment',  label: { pt: 'Atualização por Índice', en: 'Index Update', es: 'Actualización por índice', fr: 'Mise à jour d\'indice' } },
  { code: 'interest',    label: { pt: 'Juros Fixos', en: 'Fixed Interest', es: 'Interés fijo', fr: 'Intérêts fixes' } },
  { code: 'amortization',label: { pt: 'Amortização', en: 'Amortization', es: 'Amortización', fr: 'Amortissement' } },
  { code: 'manual',      label: { pt: 'Ajuste Manual', en: 'Manual Adjustment', es: 'Ajuste manual', fr: 'Ajustement manuel' } },
  { code: 'reversal',    label: { pt: 'Estorno', en: 'Reversal', es: 'Reversión', fr: 'Annulation' } },
  { code: 'settlement',  label: { pt: 'Quitação', en: 'Settlement', es: 'Liquidación', fr: 'Liquidation' } },
];

// ── BCB (Banco Central) API rates ─────────────────────────────────────────────
const BCB_SERIES = {
  selic:    11,    // SELIC meta (% a.a.)
  ipca:     433,   // IPCA acumulado 12m
  cdi:      4391,  // CDI diário
  poupanca: 195,   // Poupança mensal
  // IGPM — from FGV; BCB does not have a direct series; use 189 (IGPM mensal via BCB)
  igpm:     189,
};

// ── Helper: local lang ────────────────────────────────────────────────────────
function _dl(obj) {
  const lang = (typeof i18nGetLanguage === 'function') ? i18nGetLanguage() : 'pt';
  return obj[lang] || obj['pt'] || '';
}

// ── Feature flag ─────────────────────────────────────────────────────────────
async function isDebtsEnabled() {
  const fid = famId();
  if (!fid) return false;
  const cacheKey = 'debts_enabled_' + fid;
  if (window._familyFeaturesCache && cacheKey in window._familyFeaturesCache)
    return !!window._familyFeaturesCache[cacheKey];
  const raw = await getAppSetting(cacheKey, false);
  const enabled = raw === true || raw === 'true';
  window._familyFeaturesCache = window._familyFeaturesCache || {};
  window._familyFeaturesCache[cacheKey] = enabled;
  return enabled;
}

async function applyDebtsFeature() {
  const fid = famId();
  const navEl  = document.getElementById('debtsNav');
  const pageEl = document.getElementById('page-debts');
  if (!fid) {
    if (navEl) navEl.style.display = 'none';
    return;
  }
  const on = await isDebtsEnabled();
  if (navEl) { navEl.style.display = on ? '' : 'none'; navEl.dataset.featureControlled = '1'; }
  if (pageEl) pageEl.style.display = on ? '' : 'none';
  if (typeof _syncModulesSection === 'function') _syncModulesSection();
  if (on && !_dbt.loaded) await loadDebts();
}
window.applyDebtsFeature = applyDebtsFeature;

async function toggleFamilyDebts(familyId, enabled) {
  await saveAppSetting('debts_enabled_' + familyId, enabled);
  window._familyFeaturesCache = window._familyFeaturesCache || {};
  window._familyFeaturesCache['debts_enabled_' + familyId] = enabled;
  applyDebtsFeature().catch(() => {});
  toast(enabled ? t('dbt.enabled_toast') : t('dbt.disabled_toast'), 'success');
}
window.toggleFamilyDebts = toggleFamilyDebts;

// ── Data loading ──────────────────────────────────────────────────────────────
async function loadDebts(force = false) {
  if (_dbt.loaded && !force) return;
  const { data, error } = await famQ(
    sb.from('debts')
      .select(`*, payees(id,name), creditor:payees!debts_creditor_payee_id_fkey(id,name)`)
  ).order('created_at', { ascending: false });
  if (error) { console.error('[debts] load error:', error.message); return; }
  _dbt.debts = data || [];
  _dbt.loaded = true;
}

async function loadDebtLedger(debtId) {
  const { data, error } = await sb
    .from('debt_ledger')
    .select('*')
    .eq('debt_id', debtId)
    .order('entry_date', { ascending: false });
  if (error) { console.error('[debts] ledger error:', error.message); return []; }
  _dbt.ledger[debtId] = data || [];
  return data || [];
}

// ── Current balance from ledger ───────────────────────────────────────────────
function _debtCurrentBalance(debt) {
  // Stored in debt.current_balance (updated after every ledger entry)
  return parseFloat(debt.current_balance || debt.original_amount || 0);
}

// ── Page init ─────────────────────────────────────────────────────────────────
async function loadDebtsPage() {
  if (!await isDebtsEnabled()) return;
  await loadDebts(true);
  renderDebtsPage();
}
window.loadDebtsPage = loadDebtsPage;

function renderDebtsPage() {
  const page = document.getElementById('page-debts');
  if (!page) return;

  
  const preservedFxBar = document.getElementById('fxRatesBadge');
const active   = _dbt.debts.filter(d => d.status === 'active');
  const settled  = _dbt.debts.filter(d => d.status === 'settled');
  const totalActive = active.reduce((s, d) => s + _debtCurrentBalance(d), 0);
  const totalOrig   = active.reduce((s, d) => s + parseFloat(d.original_amount || 0), 0);
  const totalAmort  = totalOrig - totalActive;
  const pctPaid     = totalOrig > 0 ? Math.min(100, (totalAmort / totalOrig) * 100) : 0;

  page.innerHTML = `
<div class="page-inner">

  <!-- Hero header -->
  <div class="dbt-hero">
    <div class="dbt-hero-main">
      <div class="dbt-hero-label">Dívidas Ativas — Saldo Total</div>
      <div class="dbt-hero-value">${fmt(totalActive)}</div>
      <div class="dbt-hero-sub">
        <span>Original: ${fmt(totalOrig)}</span>
        <span class="dbt-hero-sep">·</span>
        <span style="color:#6ee7a0">Amortizado: ${fmt(totalAmort)}</span>
      </div>
    </div>
    <div class="dbt-hero-kpis">
      <div class="dbt-hero-kpi"><div class="dbt-hero-kpi-val">${active.length}</div><div class="dbt-hero-kpi-lbl">Ativas</div></div>
      <div class="dbt-hero-kpi"><div class="dbt-hero-kpi-val">${settled.length}</div><div class="dbt-hero-kpi-lbl">Quitadas</div></div>
      <div class="dbt-hero-kpi"><div class="dbt-hero-kpi-val">${pctPaid.toFixed(0)}%</div><div class="dbt-hero-kpi-lbl">Amortizado</div></div>
    </div>
    ${totalOrig > 0 ? `
    <div class="dbt-hero-progress">
      <div class="dbt-hero-progress-bar" style="width:${pctPaid.toFixed(1)}%"></div>
    </div>` : ''}
  </div>

  <!-- List -->
  <div id="debtsList">
    ${_dbt.debts.length === 0
      ? `<div class="empty-state"><div class="es-icon">💳</div><p>${t('dbt.empty')}</p></div>`
      : _dbt.debts.map(d => _renderDebtCard(d)).join('')
    }
  </div>
</div>`;
  // Re-inject page-header-bar (renderDebtsPage overwrites innerHTML)
  {
    const _old = page.querySelector('.page-header-bar');
    if (_old) _old.remove();
    const _bar = document.createElement('div');
    _bar.className = 'page-header-bar';
    _bar.innerHTML =
      '<div class="page-header-bar-left">' +
        '<div class="page-header-bar-icon">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>' +
            '<line x1="1" y1="10" x2="23" y2="10"/>' +
          '</svg>' +
        '</div>' +
        '<span class="page-header-bar-title">' + (t('dbt.title') || 'Dívidas') + '</span>' +
      '</div>' +
      '<div class="page-header-bar-right">' +
        '<button class="page-header-action" onclick="openDebtTransactionLauncher()">' +
          '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
            '<line x1="12" y1="5" x2="12" y2="19"/>' +
            '<line x1="5" y1="12" x2="19" y2="12"/>' +
          '</svg>' +
          'Novo Lançamento' +
        '</button>' +
        '<button class="page-header-action" onclick="openDebtModal()">' +
          '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
            '<line x1="12" y1="5" x2="12" y2="19"/>' +
            '<line x1="5" y1="12" x2="19" y2="12"/>' +
          '</svg>' +
          (t('dbt.add') || 'Nova Dívida') +
        '</button>' +
      '</div>';
    page.insertBefore(_bar, page.firstChild);

    // Re-inject FX bar below the page title bar.
    // The debts page rebuilds its innerHTML, which removes the shared FX bar
    // from the DOM if we do not place it back explicitly.
    const _fxBar = preservedFxBar || document.getElementById('fxRatesBadge');
    if (_fxBar) {
      page.insertBefore(_fxBar, _bar.nextSibling);
      _fxBar.style.display = '';
      if (typeof _renderFxBadge === 'function') {
        try { _renderFxBadge(); } catch (_) {}
      }
    } else if (typeof _renderFxBadge === 'function') {
      try { _renderFxBadge(); } catch (_) {}
      const recreatedFxBar = document.getElementById('fxRatesBadge');
      if (recreatedFxBar) {
        page.insertBefore(recreatedFxBar, _bar.nextSibling);
        recreatedFxBar.style.display = '';
      }
    }
  }
}

function _renderDebtCard(d) {
  const balance = _debtCurrentBalance(d);
  const orig    = parseFloat(d.original_amount || 0);
  const amort   = orig - balance;
  const pct     = orig > 0 ? Math.min(100, (amort / orig) * 100) : 0;
  const statusObj  = DEBT_STATUSES.find(s => s.code === d.status) || DEBT_STATUSES[0];
  const indexObj   = DEBT_INDEX_TYPES.find(i => i.code === d.adjustment_type) || DEBT_INDEX_TYPES[0];
  const statusColors = {
    active:       { bg:'#dc2626', lt:'#fef2f2', txt:'#dc2626' },
    settled:      { bg:'#16a34a', lt:'#f0fdf4', txt:'#16a34a' },
    suspended:    { bg:'#b45309', lt:'#fffbeb', txt:'#b45309' },
    renegotiated: { bg:'#7c3aed', lt:'#f5f3ff', txt:'#7c3aed' },
    archived:     { bg:'#8c8278', lt:'#f9f8f6', txt:'#8c8278' },
  };
  const sc = statusColors[d.status] || statusColors.archived;
  const isSettled = d.status === 'settled';

  return `
<div class="dbt-card2" onclick="openDebtDetail('${d.id}')">
  <div class="dbt-card2-accent" style="background:${sc.bg}"></div>
  <div class="dbt-card2-body">
    <div class="dbt-card2-top">
      <div class="dbt-card2-left">
        <div class="dbt-card2-name">${esc(d.name)}</div>
        <div class="dbt-card2-creditor">🏦 ${esc(d.creditor?.name || d.creditor_name || '—')}</div>
      </div>
      <div class="dbt-card2-right">
        <div class="dbt-card2-balance" style="color:${isSettled ? '#16a34a' : sc.txt}">${fmt(balance, d.currency)}</div>
        <span class="dbt-badge2" style="background:${sc.lt};color:${sc.txt}">${_dl(statusObj.label)}</span>
      </div>
    </div>
    <div class="dbt-card2-progress-wrap">
      <div class="dbt-card2-progress">
        <div class="dbt-card2-progress-fill" style="width:${pct.toFixed(1)}%;background:${sc.bg}"></div>
      </div>
      <span class="dbt-card2-pct">${pct.toFixed(0)}%</span>
    </div>
    <div class="dbt-card2-meta">
      <div class="dbt-card2-meta-item">
        <span class="dbt-card2-meta-lbl">Original</span>
        <span class="dbt-card2-meta-val">${fmt(orig, d.currency)}</span>
      </div>
      <div class="dbt-card2-meta-item">
        <span class="dbt-card2-meta-lbl">Amortizado</span>
        <span class="dbt-card2-meta-val" style="color:#16a34a">${fmt(amort, d.currency)}</span>
      </div>
      <div class="dbt-card2-meta-item">
        <span class="dbt-card2-meta-lbl">Índice</span>
        <span class="dbt-card2-meta-val">${_dl(indexObj.label)}</span>
      </div>
    </div>
  </div>
</div>`;
}


// ── Debt detail ───────────────────────────────────────────────────────────────
async function openDebtDetail(debtId) {
  const debt = _dbt.debts.find(d => d.id === debtId);
  if (!debt) return;
  const ledger = await loadDebtLedger(debtId);

  const modal = document.getElementById('debtDetailModal');
  if (!modal) return;

  const balance  = _debtCurrentBalance(debt);
  const orig     = parseFloat(debt.original_amount || 0);
  const totalAdj = ledger.filter(e => ['adjustment','interest'].includes(e.entry_type)).reduce((s,e)=>s+parseFloat(e.amount||0),0);
  const totalAmt = ledger.filter(e => e.entry_type==='amortization').reduce((s,e)=>s+Math.abs(parseFloat(e.amount||0)),0);
  const indexObj = DEBT_INDEX_TYPES.find(i => i.code === debt.adjustment_type) || DEBT_INDEX_TYPES[0];
  const perObj   = DEBT_PERIODICITIES.find(p => p.code === debt.periodicity) || DEBT_PERIODICITIES[0];

  document.getElementById('debtDetailBody').innerHTML = `
<div class="dbt-detail-grid">
  <!-- Left: info -->
  <div>
    <h3 class="dbt-detail-name">${esc(debt.name)}</h3>
    <div class="dbt-detail-creditor">
      <span class="dbt-detail-label">${t('dbt.creditor')}</span>
      <strong>${esc(debt.creditor?.name || '—')}</strong>
    </div>

    <div class="dbt-kpi-strip mt-3 mb-3" style="grid-template-columns:1fr 1fr">
      <div class="dbt-kpi"><span class="dbt-kpi-label">${t('dbt.original')}</span><span class="dbt-kpi-value">${fmt(orig, debt.currency)}</span></div>
      <div class="dbt-kpi"><span class="dbt-kpi-label">${t('dbt.current_balance')}</span><span class="dbt-kpi-value" style="color:var(--red)">${fmt(balance, debt.currency)}</span></div>
      <div class="dbt-kpi"><span class="dbt-kpi-label">${t('dbt.total_adjustments')}</span><span class="dbt-kpi-value">${fmt(totalAdj, debt.currency)}</span></div>
      <div class="dbt-kpi"><span class="dbt-kpi-label">${t('dbt.total_amortized')}</span><span class="dbt-kpi-value" style="color:var(--green)">${fmt(totalAmt, debt.currency)}</span></div>
    </div>

    <div class="dbt-meta-row"><span>${t('dbt.index_type')}</span><strong>${_dl(indexObj.label)}${debt.fixed_rate ? ' · ' + parseFloat(debt.fixed_rate).toFixed(2) + '% a.a.' : ''}</strong></div>
    <div class="dbt-meta-row"><span>${t('dbt.periodicity')}</span><strong>${_dl(perObj.label)}</strong></div>
    <div class="dbt-meta-row"><span>${t('dbt.start_date')}</span><strong>${fmtDate(debt.start_date)}</strong></div>
    ${debt.contract_ref ? `<div class="dbt-meta-row"><span>${t('dbt.contract_ref')}</span><strong>${esc(debt.contract_ref)}</strong></div>` : ''}
    ${debt.notes ? `<div class="dbt-meta-row"><span>${t('ui.notes')}</span><p style="margin:0;font-size:.8rem;color:var(--text2)">${esc(debt.notes)}</p></div>` : ''}

    <div class="mt-3" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <button class="btn btn-ghost btn-sm" onclick="closeModal('debtDetailModal');setTimeout(()=>openDebtModal('${debt.id}'),120)">✏️ ${t('ui.edit')}</button>
      <button class="btn btn-ghost btn-sm" onclick="closeModal('debtDetailModal');setTimeout(()=>_openDebtManualEntry('${debt.id}'),120)">+ ${t('dbt.manual_entry')}</button>
      ${debt.status==='active' ? `<button class="btn btn-ghost btn-sm" onclick="closeModal('debtDetailModal');setTimeout(()=>_settleDebt('${debt.id}'),120)" style="color:var(--green)">✓ ${t('dbt.settle')}</button>` : ''}
      <button class="btn btn-ghost btn-sm" onclick="deleteDebt('${debt.id}','${esc(debt.name).replace(/'/g,'\'')}')"
        style="color:var(--red);margin-left:auto" title="Excluir dívida permanentemente">
        🗑 Excluir
      </button>
    </div>
  </div>

  <!-- Right: ledger -->
  <div>
    <h4 style="font-size:.8rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">${t('dbt.ledger')}</h4>
    <div class="dbt-ledger" id="debtLedger_${debt.id}">
      ${ledger.length === 0
        ? `<div style="text-align:center;color:var(--muted);padding:20px;font-size:.8rem">${t('dbt.no_entries')}</div>`
        : ledger.map(e => _renderLedgerEntry(e, debt.currency)).join('')
      }
    </div>
  </div>
</div>`;

  openModal('debtDetailModal');
}
window.openDebtDetail = openDebtDetail;

function _renderLedgerEntry(e, currency) {
  const typeObj = DEBT_ENTRY_TYPES.find(t => t.code === e.entry_type) || { label:{ pt:e.entry_type } };
  const isAmt   = parseFloat(e.amount||0);
  const color   = e.entry_type === 'amortization' ? 'var(--green)' : isAmt > 0 ? 'var(--red)' : 'var(--text)';
  const sign    = isAmt > 0 ? '+' : '';
  return `
<div class="dbt-ledger-entry">
  <div class="dbt-ledger-left">
    <div class="dbt-ledger-type">${_dl(typeObj.label)}</div>
    <div class="dbt-ledger-date">${fmtDate(e.entry_date)}${e.rate_applied ? ' · ' + parseFloat(e.rate_applied).toFixed(4) + '%' : ''}</div>
    ${e.description ? `<div class="dbt-ledger-desc">${esc(e.description)}</div>` : ''}
  </div>
  <div style="text-align:right;flex-shrink:0">
    <div style="font-weight:700;color:${color}">${sign}${fmt(isAmt, currency)}</div>
    <div style="font-size:.7rem;color:var(--muted)">${t('dbt.balance')}: ${fmt(parseFloat(e.resulting_balance||0), currency)}</div>
  </div>
</div>`;
}

// ── Create / Edit Debt modal ──────────────────────────────────────────────────
function openDebtModal(debtId = null) {
  const modal = document.getElementById('debtFormModal');
  if (!modal) return;

  const debt   = debtId ? _dbt.debts.find(d => d.id === debtId) : null;
  const isEdit = !!debt;
  const curIdx = debt?.adjustment_type || 'fixed';
  const curCur = debt?.currency || 'BRL';

  // Quick chips for index types
  const _quickIdx = ['fixed','cdi','ipca','selic','poupanca'];
  const indexChips = _quickIdx.map(code => {
    const item = DEBT_INDEX_TYPES.find(i => i.code === code);
    if (!item) return '';
    return `<button type="button" class="dbt-index-chip${curIdx===code?' active':''}"
      onclick="_dbtPickIndex('${code}')">${_dl(item.label)}</button>`;
  }).join('');
  const _otherActive = !_quickIdx.includes(curIdx);
  const otherChip = `<button type="button" class="dbt-index-chip${_otherActive?' active':''}"
    onclick="_dbtPickIndex('custom')">Manual / Outro</button>`;

  // Periodicity & status options
  const periodicityOptions = DEBT_PERIODICITIES.map(p =>
    `<option value="${p.code}" ${(debt?.periodicity||'monthly')===p.code?'selected':''}>${_dl(p.label)}</option>`
  ).join('');
  const statusOptions = DEBT_STATUSES.map(s =>
    `<option value="${s.code}" ${(debt?.status||'active')===s.code?'selected':''}>${_dl(s.label)}</option>`
  ).join('');

  // Pre-fill creditor name for autocomplete
  const creditorPayeeId = debt?.creditor_payee_id || '';
  const creditorName = creditorPayeeId
    ? (state.payees.find(p => p.id === creditorPayeeId)?.name || '')
    : '';

  document.getElementById('debtFormBody').innerHTML = `
<input type="hidden" id="debtFormId"    value="${debtId||''}">
<input type="hidden" id="debtFormIndex" value="${curIdx}">

<!-- ── Seção 1: Identificação ─────────────────────────────────────── -->
<div class="dbt-form-section">
  <div class="dbt-form-section-title">
    <span class="dbt-form-section-icon" style="background:var(--accent-lt)">💳</span>
    Identificação
  </div>
  <div class="dbt-form-grid">
    <div class="form-group full">
      <label>${t('dbt.name')} *</label>
      <input class="form-input" id="debtFormName" value="${esc(debt?.name||'')}"
        placeholder="${t('dbt.name_placeholder')}" autofocus>
    </div>

    <!-- Creditor autocomplete -->
    <div class="form-group full" style="position:relative">
      <label>${t('dbt.creditor')} *</label>
      <input type="hidden" id="debtFormCreditor" value="${creditorPayeeId}">
      <div style="position:relative">
        <input type="text" class="form-input" id="dbtCreditorName"
          value="${esc(creditorName)}"
          placeholder="Buscar credor…  (mín. 3 letras)"
          autocomplete="off"
          oninput="_dbtOnCreditorInput(this.value)"
          onkeydown="_dbtOnCreditorKey(event)"
          onblur="_dbtOnCreditorBlur()"
          onfocus="if(this.value.length>=3)_dbtOnCreditorInput(this.value)">
        <span id="dbtCreditorStatus" style="position:absolute;right:10px;top:50%;
          transform:translateY(-50%);color:var(--green);font-weight:700;
          pointer-events:none">${creditorPayeeId?'✓':''}</span>
      </div>
      <div id="dbtCreditorDropdown" class="payee-dropdown" style="display:none;
        position:absolute;left:0;right:0;z-index:400;top:calc(100% + 2px)"></div>
    </div>
  </div>
</div>

<!-- ── Seção 2: Valor e Prazo ─────────────────────────────────────── -->
<div class="dbt-form-section">
  <div class="dbt-form-section-title">
    <span class="dbt-form-section-icon" style="background:#fef3c7">💰</span>
    Valor e Prazo
  </div>
  <div class="dbt-form-grid">
    <div class="form-group">
      <label>${t('dbt.original_amount')} *</label>
      <div class="dbt-amount-wrap">
        <span class="dbt-amount-prefix" id="dbtAmountPrefix">${{BRL:'R$',USD:'US$',EUR:'€'}[curCur]||'R$'}</span>
        <input type="text" inputmode="numeric" class="form-input dbt-amount-input"
          id="debtFormAmount" placeholder="0,00" autocomplete="off"
          value="${debt?.original_amount ? Math.abs(debt.original_amount).toFixed(2).replace('.',',') : ''}">
      </div>
    </div>
    <div class="form-group">
      <label>${t('ui.currency')}</label>
      <div class="dbt-pill-group" style="margin-top:4px">
        ${['BRL','USD','EUR'].map(c=>`
          <button type="button" class="dbt-pill${curCur===c?' active':''}"
            onclick="_dbtPickCurrency('${c}')">${c}</button>`).join('')}
      </div>
      <input type="hidden" id="debtFormCurrency" value="${curCur}">
    </div>
    <div class="form-group">
      <label>${t('dbt.start_date')} *</label>
      <input class="form-input" id="debtFormStartDate" type="date"
        value="${debt?.start_date || new Date().toISOString().slice(0,10)}">
    </div>
    <div class="form-group">
      <label>${t('ui.status')}</label>
      <select class="form-select" id="debtFormStatus">${statusOptions}</select>
    </div>
  </div>
</div>

<!-- ── Seção 3: Correção e Juros ──────────────────────────────────── -->
<div class="dbt-form-section">
  <div class="dbt-form-section-title">
    <span class="dbt-form-section-icon" style="background:#f0fdf4">📈</span>
    Correção e Juros
  </div>
  <div style="margin-bottom:10px">
    <label style="font-size:.78rem;font-weight:600;color:var(--text2);display:block;margin-bottom:8px">
      Índice de correção *
    </label>
    <div class="dbt-index-chips">
      ${indexChips}
      ${otherChip}
    </div>
  </div>
  <div class="dbt-rate-reveal${curIdx==='fixed'?' visible':''}" id="dbtRateReveal">
    <div class="form-group" style="max-width:200px">
      <label>${t('dbt.fixed_rate')} (% a.a.) *</label>
      <input class="form-input" id="debtFormFixedRate" type="number" step="0.01" min="0"
        placeholder="Ex: 12,5" value="${debt?.fixed_rate||''}">
    </div>
  </div>
  <div class="form-group" style="max-width:220px;margin-top:10px">
    <label>${t('dbt.periodicity')}</label>
    <select class="form-select" id="debtFormPeriodicity">${periodicityOptions}</select>
  </div>
</div>

<!-- ── Seção 4: Informações adicionais ───────────────────────────── -->
<div class="dbt-form-section">
  <div class="dbt-form-section-title">
    <span class="dbt-form-section-icon" style="background:var(--bg2)">📋</span>
    Informações adicionais
  </div>
  <div class="dbt-form-grid">
    <div class="form-group">
      <label>${t('dbt.contract_ref')}</label>
      <input class="form-input" id="debtFormContractRef"
        value="${esc(debt?.contract_ref||'')}" placeholder="Nº contrato…">
    </div>
    <div class="form-group">
      <label>${t('ui.notes')}</label>
      <input class="form-input" id="debtFormNotes"
        value="${esc(debt?.notes||'')}" placeholder="Observações opcionais">
    </div>
  </div>
</div>`;

  document.getElementById('debtFormTitle').textContent = isEdit ? t('dbt.edit') : t('dbt.add');
  openModal('debtFormModal');

  // Bind money mask to amount field (same engine as transactions)
  // debtFormAmount is in the opt-in list in ui_helpers.js
  setTimeout(() => {
    const amtEl = document.getElementById('debtFormAmount');
    if (amtEl && typeof bindMoneyInput === 'function') {
      amtEl._moneyBound = false; // force rebind (element recreated via innerHTML)
      bindMoneyInput(amtEl);
    }
    document.getElementById('debtFormName')?.focus();
  }, 80);
}
window.openDebtModal = openDebtModal;

// ── Debt form: currency & index helpers ──────────────────────────────────────

function _dbtPickCurrency(cur) {
  document.getElementById('debtFormCurrency').value = cur;
  document.querySelectorAll('#debtFormBody .dbt-pill').forEach(b => {
    b.classList.toggle('active', b.textContent.trim() === cur);
  });
  const pfxMap = { BRL:'R$', USD:'US$', EUR:'€' };
  const pfx = document.getElementById('dbtAmountPrefix');
  if (pfx) pfx.textContent = pfxMap[cur] || cur;
}

function _dbtPickIndex(code) {
  document.getElementById('debtFormIndex').value = code;
  document.querySelectorAll('.dbt-index-chip').forEach(b => {
    const m = b.getAttribute('onclick')?.match(/'([^']+)'/);
    b.classList.toggle('active', m?.[1] === code);
  });
  const reveal = document.getElementById('dbtRateReveal');
  if (reveal) reveal.classList.toggle('visible', code === 'fixed');
}

// ── Debt form: creditor autocomplete ─────────────────────────────────────────

let _dbtCreditorBlurTimer = null;

function _dbtOnCreditorInput(val) {
  const hiddenEl = document.getElementById('debtFormCreditor');
  const statusEl = document.getElementById('dbtCreditorStatus');
  // Clear selection if user is typing something different
  if (hiddenEl && hiddenEl.value) {
    const cur = state.payees.find(p => p.id === hiddenEl.value);
    if (cur && cur.name !== val) {
      hiddenEl.value = '';
      if (statusEl) statusEl.textContent = '';
    }
  }
  if (val.length < 3) {
    _dbtHideCreditorDd();
    return;
  }
  const q = val.toLowerCase();
  const matches = (state.payees || []).filter(p =>
    p.name.toLowerCase().includes(q)
  );
  _dbtShowCreditorDd(matches, val);
}

function _dbtShowCreditorDd(matches, typed) {
  const dd = document.getElementById('dbtCreditorDropdown');
  if (!dd) return;

  let html = '';
  matches.slice(0, 8).forEach(p => {
    // Highlight match safely without regex special char issues
    const _q = esc(typed);
    const _n = esc(p.name);
    const _idx = _n.toLowerCase().indexOf(_q.toLowerCase());
    const hi = _idx >= 0
      ? _n.slice(0,_idx) + '<mark style="background:var(--accent-lt);color:var(--accent);border-radius:2px">'
        + _n.slice(_idx, _idx+_q.length) + '</mark>' + _n.slice(_idx+_q.length)
      : _n;
    html += `<div class="payee-opt" onmousedown="event.preventDefault()"
      onclick="_dbtSelectCreditor('${p.id}','${esc(p.name).replace(/'/g,"\'")}')">
      <span class="payee-opt-icon">🏦</span>
      <div>
        <div class="payee-opt-name">${hi}</div>
        <div class="payee-opt-sub">Credor existente</div>
      </div>
    </div>`;
  });

  // "Criar novo" option
  html += `<div class="payee-opt payee-opt-create" onmousedown="event.preventDefault()"
    onclick="_dbtCreateAndSelectCreditor()">
    <span class="payee-opt-icon">＋</span>
    <div>
      <div class="payee-opt-name">Criar <strong>"${esc(typed)}"</strong> como credor</div>
      <div class="payee-opt-sub">Novo beneficiário</div>
    </div>
  </div>`;

  dd.innerHTML = html;
  dd.style.display = 'block';
}

function _dbtHideCreditorDd() {
  const dd = document.getElementById('dbtCreditorDropdown');
  if (dd) dd.style.display = 'none';
}

function _dbtSelectCreditor(id, name) {
  document.getElementById('debtFormCreditor').value = id;
  document.getElementById('dbtCreditorName').value  = name;
  const st = document.getElementById('dbtCreditorStatus');
  if (st) st.textContent = '✓';
  _dbtHideCreditorDd();
}

async function _dbtCreateAndSelectCreditor() {
  const inp  = document.getElementById('dbtCreditorName');
  const name = (inp?.value || '').trim();
  if (!name) { toast('Informe o nome do credor', 'error'); inp?.focus(); return; }

  _dbtHideCreditorDd();
  const origPh = inp.placeholder;
  inp.disabled = true;
  inp.placeholder = '⏳ Criando…';

  try {
    const { data, error } = await sb
      .from('payees')
      .insert({ name, type: 'beneficiario', family_id: famId() })
      .select('id,name')
      .single();
    if (error) throw error;

    await loadPayees(true);
    _dbtSelectCreditor(data.id, data.name);
    toast(`✓ "${esc(data.name)}" criado como credor`, 'success');
  } catch (e) {
    toast('Erro ao criar credor: ' + (e.message || e), 'error');
    inp.value = name;
  } finally {
    inp.disabled = false;
    inp.placeholder = origPh;
  }
}

function _dbtOnCreditorKey(e) {
  const dd = document.getElementById('dbtCreditorDropdown');
  if (!dd || dd.style.display === 'none') return;
  const opts = dd.querySelectorAll('.payee-opt');
  if (!opts.length) return;
  let idx = parseInt(dd.dataset.focusIdx || '-1');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    idx = Math.min(idx + 1, opts.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    idx = Math.max(idx - 1, 0);
  } else if (e.key === 'Enter' && idx >= 0) {
    e.preventDefault();
    opts[idx]?.click();
    return;
  } else if (e.key === 'Escape') {
    _dbtHideCreditorDd();
    return;
  }
  dd.dataset.focusIdx = idx;
  opts.forEach((o, i) => o.classList.toggle('focused', i === idx));
  opts[idx]?.scrollIntoView({ block: 'nearest' });
}

function _dbtOnCreditorBlur() {
  _dbtCreditorBlurTimer = setTimeout(_dbtHideCreditorDd, 200);
}

window._dbtPickCurrency         = _dbtPickCurrency;
window._dbtPickIndex            = _dbtPickIndex;
window._dbtOnCreditorInput      = _dbtOnCreditorInput;
window._dbtOnCreditorKey        = _dbtOnCreditorKey;
window._dbtOnCreditorBlur       = _dbtOnCreditorBlur;
window._dbtSelectCreditor       = _dbtSelectCreditor;
window._dbtCreateAndSelectCreditor = _dbtCreateAndSelectCreditor;

function _onDebtIndexChange() {
  const val = document.getElementById('debtFormIndex')?.value;
  const grp = document.getElementById('debtFixedRateGroup');
  if (grp) grp.style.display = val === 'fixed' ? '' : 'none';
}
window._onDebtIndexChange = _onDebtIndexChange;

// ── Auto-create amortization category on first debt ─────────────────────────
async function _ensureAmortizacaoCategory() {
  try {
    const fid = famId();
    if (!fid) return;

    // Check state cache first (already loaded categories)
    const cats = state.categories || [];
    const exists = cats.some(c =>
      c.family_id === fid &&
      (c.slug === 'amortizacao_divida' ||
       c.name?.toLowerCase().includes('amortiza') && c.type === 'expense')
    );
    if (exists) return;

    // Also check DB (in case state not yet refreshed)
    const { data: dbCat } = await sb.from('categories')
      .select('id')
      .eq('family_id', fid)
      .ilike('name', '%amortiza%')
      .eq('type', 'expense')
      .maybeSingle();
    if (dbCat) return;

    // Insert the category
    const catName = (typeof t === 'function') ? t('cat.debt_amort') : 'Amortização de Dívida';
    const { error } = await sb.from('categories').insert({
      name:      catName,
      type:      'expense',
      icon:      '💳',
      color:     '#c0392b',
      family_id: fid,
    });

    if (!error) {
      // Bust DB cache and reload so the category appears immediately
      if (typeof DB !== 'undefined' && DB.categories?.bust) DB.categories.bust();
      if (typeof loadCategories === 'function') await loadCategories(true);
    }
  } catch (e) {
    // Non-critical — silently ignore
    console.warn('[debts] _ensureAmortizacaoCategory error:', e?.message);
  }
}

async function saveDebt() {
  const id       = document.getElementById('debtFormId').value;
  const name     = document.getElementById('debtFormName').value.trim();
  const creditor = document.getElementById('debtFormCreditor').value;
  // debtFormAmount is a money-masked text field — use getAmtField to parse BR format
  const amount   = (typeof getAmtField === 'function')
    ? getAmtField('debtFormAmount')
    : parseFloat((document.getElementById('debtFormAmount')?.value||'').replace(/\./g,'').replace(',','.')) || 0;
  const currency = document.getElementById('debtFormCurrency').value;
  const startDate= document.getElementById('debtFormStartDate').value;
  const status   = document.getElementById('debtFormStatus').value;
  const indexType= document.getElementById('debtFormIndex').value;
  const period   = document.getElementById('debtFormPeriodicity').value;
  const fixedRate= parseFloat(document.getElementById('debtFormFixedRate')?.value||'0') || null;
  const contractRef = document.getElementById('debtFormContractRef').value.trim();
  const notes    = document.getElementById('debtFormNotes').value.trim();

  if (!name)     { toast(t('dbt.err_name'), 'error'); return; }
  if (!creditor) { toast(t('dbt.err_creditor'), 'error'); return; }
  if (!amount || amount <= 0) { toast(t('dbt.err_amount'), 'error'); return; }
  if (!startDate) { toast(t('dbt.err_start_date'), 'error'); return; }
  if (indexType === 'fixed' && (!fixedRate || fixedRate <= 0)) { toast(t('dbt.err_fixed_rate'), 'error'); return; }

  const data = {
    name, creditor_payee_id: creditor, original_amount: amount, currency,
    start_date: startDate, status, adjustment_type: indexType, periodicity: period,
    fixed_rate: indexType === 'fixed' ? fixedRate : null,
    contract_ref: contractRef || null, notes: notes || null,
    family_id: famId(), updated_at: new Date().toISOString(),
  };

  let error, result;
  if (id) {
    ({ error } = await sb.from('debts').update(data).eq('id', id));
  } else {
    data.current_balance = amount; // initial balance = original amount

    // Try direct insert first; if blocked by RLS, fall back to SECURITY DEFINER RPC
    ({ data: result, error } = await sb.from('debts').insert(data).select().single());

    if (error && (error.code === '42501' || (error.message||'').toLowerCase().includes('security'))) {
      console.warn('[debts] RLS blocked direct insert, trying RPC fallback:', error.message);
      try {
        const { data: rpcResult, error: rpcErr } = await sb.rpc('insert_debt', {
          p_data: JSON.stringify(data)
        });
        if (rpcErr) throw rpcErr;
        result = typeof rpcResult === 'string' ? JSON.parse(rpcResult) : rpcResult;
        error  = null;
      } catch (rpcEx) {
        // Keep original RLS error — both paths failed
        console.error('[debts] RPC fallback also failed:', rpcEx.message);
      }
    }
    // Create opening ledger entry
    if (!error && result) {
      await sb.from('debt_ledger').insert({
        debt_id: result.id,
        entry_date: startDate,
        entry_type: 'initial',
        description: t('dbt.entry_opening'),
        amount: amount,
        previous_balance: 0,
        resulting_balance: amount,
        source_type: 'manual',
        family_id: famId(),
        created_at: new Date().toISOString(),
      });
      // Ensure "Amortização de Dívida" category exists for this family
      await _ensureAmortizacaoCategory();
    }
  }

  if (error) { toast(t('dbt.err_save') + ': ' + error.message, 'error'); return; }
  toast(t('dbt.saved'), 'success');
  closeModal('debtFormModal');
  await loadDebts(true);
  renderDebtsPage();
}
window.saveDebt = saveDebt;

// ── Manual ledger entry ───────────────────────────────────────────────────────
function _openDebtManualEntry(debtId) {
  const debt = _dbt.debts.find(d => d.id === debtId);
  if (!debt) return;

  const typeOptions = DEBT_ENTRY_TYPES.filter(t => !['initial'].includes(t.code))
    .map(t => `<option value="${t.code}">${_dl(t.label)}</option>`).join('');

  document.getElementById('debtManualBody').innerHTML = `
<input type="hidden" id="debtManualDebtId" value="${debtId}">
<div class="form-group">
  <label>${t('dbt.entry_type')}</label>
  <select class="form-select" id="debtManualType">${typeOptions}</select>
</div>
<div class="form-group">
  <label>${t('ui.date')}</label>
  <input class="form-input" type="date" id="debtManualDate" value="${new Date().toISOString().slice(0,10)}">
</div>
<div class="form-group">
  <label>${t('ui.amount')} ${d => d.entry_type==='amortization'?'(positivo = reduz dívida)':''}</label>
  <input class="form-input" type="number" step="0.01" id="debtManualAmount">
</div>
<div class="form-group">
  <label>${t('ui.description')}</label>
  <input class="form-input" id="debtManualDesc">
</div>
<div class="form-group">
  <label>${t('dbt.rate_applied')} (%)</label>
  <input class="form-input" type="number" step="0.0001" id="debtManualRate">
</div>`;

  openModal('debtManualModal');
}
window._openDebtManualEntry = _openDebtManualEntry;

async function saveDebtManualEntry() {
  const debtId = document.getElementById('debtManualDebtId').value;
  const type   = document.getElementById('debtManualType').value;
  const date   = document.getElementById('debtManualDate').value;
  const rawAmt = parseFloat(document.getElementById('debtManualAmount').value);
  const desc   = document.getElementById('debtManualDesc').value.trim();
  const rate   = parseFloat(document.getElementById('debtManualRate').value) || null;

  if (!date || isNaN(rawAmt) || rawAmt === 0) { toast(t('dbt.err_entry'), 'error'); return; }

  const debt = _dbt.debts.find(d => d.id === debtId);
  if (!debt) return;

  const prevBalance = _debtCurrentBalance(debt);
  // Amortization reduces debt (subtract), all others add
  const delta = type === 'amortization' ? -Math.abs(rawAmt) : Math.abs(rawAmt);
  const newBalance = Math.max(0, prevBalance + delta);

  const { error: ledgerErr } = await sb.from('debt_ledger').insert({
    debt_id: debtId, entry_date: date, entry_type: type,
    description: desc || _dl(DEBT_ENTRY_TYPES.find(t=>t.code===type)?.label||{pt:type}),
    amount: delta, rate_applied: rate,
    previous_balance: prevBalance, resulting_balance: newBalance,
    source_type: 'manual', family_id: famId(), created_at: new Date().toISOString(),
  });
  if (ledgerErr) { toast(t('dbt.err_save') + ': ' + ledgerErr.message, 'error'); return; }

  // Update debt current_balance
  await sb.from('debts').update({
    current_balance: newBalance,
    status: newBalance <= 0 ? 'settled' : debt.status,
    updated_at: new Date().toISOString(),
  }).eq('id', debtId);

  toast(t('dbt.entry_saved'), 'success');
  closeModal('debtManualModal');
  closeModal('debtDetailModal');
  await loadDebts(true);
  renderDebtsPage();
}
window.saveDebtManualEntry = saveDebtManualEntry;

// ── Settle debt ───────────────────────────────────────────────────────────────
async function _settleDebt(debtId) {
  if (!confirm(t('dbt.confirm_settle'))) return;
  const debt = _dbt.debts.find(d => d.id === debtId);
  if (!debt) return;
  const prevBalance = _debtCurrentBalance(debt);

  if (prevBalance > 0) {
    await sb.from('debt_ledger').insert({
      debt_id: debtId, entry_date: new Date().toISOString().slice(0,10),
      entry_type: 'settlement', description: t('dbt.entry_settlement'),
      amount: -prevBalance, previous_balance: prevBalance, resulting_balance: 0,
      source_type: 'manual', family_id: famId(), created_at: new Date().toISOString(),
    });
  }
  await sb.from('debts').update({ status: 'settled', current_balance: 0, updated_at: new Date().toISOString() }).eq('id', debtId);
  toast(t('dbt.settled_toast'), 'success');
  closeModal('debtDetailModal');
  await loadDebts(true);
  renderDebtsPage();
}
window._settleDebt = _settleDebt;

// ── Delete Debt ───────────────────────────────────────────────────────────────
async function deleteDebt(debtId, debtName) {
  if (!debtId) return;

  // ── 1. Contar registros relacionados ─────────────────────────────────────
  let ledgerCount = 0;
  let txCount     = 0;

  try {
    const { count: lc } = await sb
      .from('debt_ledger')
      .select('id', { count: 'exact', head: true })
      .eq('debt_id', debtId);
    ledgerCount = lc || 0;
  } catch(_) {}

  // Contar transações vinculadas via debt_ledger.source_reference_id (lançamentos de amortização)
  try {
    const { data: ledgerRefs } = await sb
      .from('debt_ledger')
      .select('source_reference_id')
      .eq('debt_id', debtId)
      .eq('source_type', 'transaction')
      .not('source_reference_id', 'is', null);
    txCount = (ledgerRefs || []).length;
  } catch(_) {}

  // ── 2. Montar modal de confirmação ────────────────────────────────────────
  const existing = document.getElementById('debtDeleteConfirmModal');
  if (existing) existing.remove();

  const relatedHtml = `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin:14px 0">
      <div style="font-size:.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">
        Registros que serão excluídos
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:.83rem">
          <span>📋 Entradas no histórico (ledger)</span>
          <strong style="color:${ledgerCount > 0 ? 'var(--red)' : 'var(--muted)'}">${ledgerCount}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:.83rem">
          <span>💳 Transações vinculadas</span>
          <strong style="color:${txCount > 0 ? 'var(--amber,#f59e0b)' : 'var(--muted)'}">${txCount}${txCount > 0 ? ' (serão desvinculadas)' : ''}</strong>
        </div>
      </div>
    </div>
    ${txCount > 0 ? `<div style="font-size:.76rem;color:var(--amber,#b45309);background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:8px 12px;margin-bottom:12px">
      ⚠ As transações de amortização <strong>não serão excluídas</strong> — apenas o vínculo com esta dívida será removido.
    </div>` : ''}
    <div style="font-size:.8rem;color:var(--muted);margin-bottom:14px">
      Digite <strong id="debtDeleteExpectedName" style="color:var(--red)">${esc(debtName)}</strong> para confirmar a exclusão permanente:
    </div>
    <input type="text" id="debtDeleteConfirmInput" class="form-input"
      placeholder="Digite o nome da dívida…"
      oninput="_debtDeleteCheck()"
      onkeydown="if(event.key==='Enter'&&!document.getElementById('debtDeleteConfirmBtn').disabled)_debtDeleteFromBtn(document.getElementById('debtDeleteConfirmBtn'))">`; 

  const modalHtml = `
    <div class="modal-overlay open" id="debtDeleteConfirmModal" style="z-index:10020"
         onclick="if(event.target===this)document.getElementById('debtDeleteConfirmModal')?.remove()">
      <div class="modal" style="max-width:440px"><div class="modal-handle"></div>
        <div class="modal-header">
          <span class="modal-title" style="color:var(--red)">🗑 Excluir Dívida</span>
          <button class="modal-close" onclick="document.getElementById('debtDeleteConfirmModal')?.remove()">✕</button>
        </div>
        <div class="modal-body">
          <p style="font-size:.85rem;margin-bottom:4px">
            Você está prestes a excluir permanentemente a dívida:
          </p>
          <p style="font-weight:700;font-size:.95rem;color:var(--text);margin-bottom:2px">${esc(debtName)}</p>
          ${relatedHtml}
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="document.getElementById('debtDeleteConfirmModal')?.remove()">Cancelar</button>
          <button class="btn btn-primary" id="debtDeleteConfirmBtn"
            data-debt-id="${debtId}"
            data-debt-name="${esc(debtName)}"
            onclick="_debtDeleteFromBtn(this)"
            disabled
            style="background:var(--red);border-color:var(--red);opacity:.5;cursor:not-allowed">
            🗑 Excluir permanentemente
          </button>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  setTimeout(() => document.getElementById('debtDeleteConfirmInput')?.focus(), 80);
}
window.deleteDebt = deleteDebt;

function _debtDeleteCheck() {
  const inp      = document.getElementById('debtDeleteConfirmInput');
  const btn      = document.getElementById('debtDeleteConfirmBtn');
  const nameSpan = document.getElementById('debtDeleteExpectedName');
  if (!inp || !btn || !nameSpan) return;
  const expected = nameSpan.textContent.trim();
  const match    = inp.value.trim() === expected;
  btn.disabled        = !match;
  btn.style.opacity   = match ? '1' : '.5';
  btn.style.cursor    = match ? 'pointer' : 'not-allowed';
}
window._debtDeleteCheck = _debtDeleteCheck;

async function _debtDeleteExec(debtId, debtName) {
  const btn = document.getElementById('debtDeleteConfirmBtn');
  if (btn?.disabled) return; // guard

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Excluindo…'; }

  try {
    // 1. Desvincular transações (remove debt reference sem excluir transações)
    await sb.from('debt_ledger')
      .select('source_reference_id')
      .eq('debt_id', debtId)
      .eq('source_type', 'transaction')
      .then(async ({ data: refs }) => {
        const ids = (refs || []).map(r => r.source_reference_id).filter(Boolean);
        // Transactions keep their data — only the ledger entries are deleted with the debt (CASCADE)
      });

    // 2. Excluir a dívida (CASCADE apaga debt_ledger automaticamente via FK)
    const { error } = await sb.from('debts').delete().eq('id', debtId);
    if (error) throw error;

    // 3. Atualizar estado local
    _dbt.debts = _dbt.debts.filter(d => d.id !== debtId);

    // 4. Fechar modais e atualizar UI
    document.getElementById('debtDeleteConfirmModal')?.remove();
    closeModal('debtDetailModal');

    toast(`✓ "${esc(debtName)}" excluída.`, 'success');
    renderDebtsPage();
  } catch (e) {
    toast('Erro ao excluir: ' + (e.message || e), 'error');
    if (btn) { btn.disabled = false; btn.textContent = '🗑 Excluir permanentemente'; }
  }
}
// Helper: reads data-attrs from button (avoids quote-escaping issues in template literals)
function _debtDeleteFromBtn(btn) {
  const debtId   = btn?.dataset?.debtId   || '';
  const debtName = btn?.dataset?.debtName || '';
  if (!debtId) { toast('Erro: ID da dívida não encontrado', 'error'); return; }
  _debtDeleteExec(debtId, debtName);
}
window._debtDeleteFromBtn = _debtDeleteFromBtn;
window._debtDeleteExec    = _debtDeleteExec;

// ── BCB API rate fetch ────────────────────────────────────────────────────────
async function _fetchBcbRate(seriesId) {
  // BCB OLINDA API — last available value
  const url = `https://servicodados.ibge.gov.br/api/v3/`;
  const bcbUrl = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${seriesId}/dados/ultimos/1?formato=json`;
  try {
    const resp = await fetch(bcbUrl, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return null;
    const json = await resp.json();
    if (!json || !json.length) return null;
    const item = json[0];
    return { date: item.data, rate: parseFloat(item.valor.replace(',', '.')) };
  } catch (e) {
    console.warn('[debts] BCB fetch failed for series', seriesId, e.message);
    return null;
  }
}

// ── Scheduled update job ──────────────────────────────────────────────────────
async function runDebtUpdateJob(manual = true) {
  if (_dbt.updating) { toast(t('dbt.update_running'), 'info'); return; }
  _dbt.updating = true;
  const btn = document.getElementById('debtUpdateAllBtn');
  if (btn) btn.disabled = true;

  try {
    await loadDebts(true);
    const active = _dbt.debts.filter(d => d.status === 'active' && d.adjustment_type !== 'custom');
    if (active.length === 0) { toast(t('dbt.no_active'), 'info'); return; }

    let updated = 0, failed = 0;
    const today = new Date().toISOString().slice(0, 10);
    const competencePeriod = today.slice(0, 7); // YYYY-MM

    for (const debt of active) {
      if (debt.periodicity === 'manual') continue;
      if (debt.adjustment_type === 'fixed') {
        // Fixed interest: compute monthly equivalent of annual rate
        const annualRate = parseFloat(debt.fixed_rate || 0);
        if (!annualRate) continue;
        const monthlyRate = Math.pow(1 + annualRate / 100, 1 / 12) - 1;
        const prevBalance = _debtCurrentBalance(debt);
        const interest = prevBalance * monthlyRate;

        // Idempotency: check if already posted for this period
        const { data: existing } = await sb.from('debt_ledger')
          .select('id').eq('debt_id', debt.id)
          .eq('competence_period', competencePeriod)
          .eq('entry_type', 'interest').maybeSingle();
        if (existing) continue;

        const newBalance = prevBalance + interest;
        await sb.from('debt_ledger').insert({
          debt_id: debt.id, entry_date: today, entry_type: 'interest',
          description: `${t('dbt.entry_interest')} ${annualRate}% a.a. (${(monthlyRate*100).toFixed(4)}% a.m.)`,
          amount: interest, rate_applied: monthlyRate * 100,
          previous_balance: prevBalance, resulting_balance: newBalance,
          competence_period: competencePeriod, source_type: 'auto',
          family_id: famId(), created_at: new Date().toISOString(),
        });
        await sb.from('debts').update({ current_balance: newBalance, updated_at: new Date().toISOString() }).eq('id', debt.id);
        updated++;
        continue;
      }

      // Index-based (BCB API)
      const seriesId = BCB_SERIES[debt.adjustment_type];
      if (!seriesId) continue;

      const rateData = await _fetchBcbRate(seriesId);
      if (!rateData) { failed++; continue; }

      // Idempotency: check if already posted for this period
      const { data: existing } = await sb.from('debt_ledger')
        .select('id').eq('debt_id', debt.id)
        .eq('competence_period', competencePeriod)
        .in('entry_type', ['adjustment', 'interest']).maybeSingle();
      if (existing) continue;

      const rate = rateData.rate;
      const prevBalance = _debtCurrentBalance(debt);
      const delta = prevBalance * (rate / 100);
      const newBalance = prevBalance + delta;

      await sb.from('debt_ledger').insert({
        debt_id: debt.id, entry_date: today, entry_type: 'adjustment',
        description: `${_dl(DEBT_INDEX_TYPES.find(i=>i.code===debt.adjustment_type)?.label||{pt:''})} ${rate}%`,
        amount: delta, rate_applied: rate,
        previous_balance: prevBalance, resulting_balance: newBalance,
        competence_period: competencePeriod,
        source_type: 'bcb_api',
        family_id: famId(), created_at: new Date().toISOString(),
      });
      await sb.from('debts').update({ current_balance: newBalance, updated_at: new Date().toISOString() }).eq('id', debt.id);
      updated++;
    }

    const msg = `${t('dbt.update_done')}: ${updated} ${t('dbt.updated')}${failed ? ', ' + failed + ' ' + t('dbt.failed') : ''}`;
    toast(msg, updated > 0 ? 'success' : 'info');
    await loadDebts(true);
    renderDebtsPage();
  } catch (e) {
    console.error('[debts] update job error:', e);
    toast(t('dbt.update_error'), 'error');
  } finally {
    _dbt.updating = false;
    if (btn) btn.disabled = false;
  }
}
window.runDebtUpdateJob = runDebtUpdateJob;

// ── Amortization hook — called when payee is selected in transaction form ─────
async function checkDebtAmortization(payeeId) {
  if (!payeeId || !await isDebtsEnabled()) return;
  if (!_dbt.loaded) await loadDebts();

  const activeDebts = _dbt.debts.filter(d =>
    d.creditor_payee_id === payeeId && d.status === 'active'
  );
  if (!activeDebts.length) return;

  // Show prompt banner inside tx modal
  let banner = document.getElementById('debtAmortizationBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'debtAmortizationBanner';
    banner.className = 'dbt-amort-banner';
    const memoGroup = document.getElementById('txMemo')?.closest('.form-group');
    if (memoGroup) memoGroup.parentNode.insertBefore(banner, memoGroup);
    else document.getElementById('txForm')?.appendChild(banner);
  }

  const debtOptions = activeDebts.map(d =>
    `<option value="${d.id}">${esc(d.name)} (${fmt(_debtCurrentBalance(d), d.currency)})</option>`
  ).join('');

  banner.innerHTML = `
<div class="dbt-amort-inner">
  <div class="dbt-amort-icon">💳</div>
  <div class="dbt-amort-body">
    <div class="dbt-amort-title">${t('dbt.amort_prompt_title')}</div>
    <div class="dbt-amort-sub">${t('dbt.amort_prompt_sub')}</div>
    <div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap">
      <select class="form-select" id="debtAmortSelect" style="flex:1;min-width:150px">${debtOptions}</select>
      <button class="btn btn-primary btn-sm" onclick="_confirmAmortization()">✓ ${t('dbt.amort_confirm')}</button>
      <button class="btn btn-ghost btn-sm" onclick="_dismissAmortization()">${t('ui.no')}</button>
    </div>
  </div>
</div>`;
  banner.style.display = '';
}
window.checkDebtAmortization = checkDebtAmortization;

function _dismissAmortization() {
  const b = document.getElementById('debtAmortizationBanner');
  if (b) b.style.display = 'none';
  // Clear any stored amortization state
  window._pendingAmortDebtId = null;
}
window._dismissAmortization = _dismissAmortization;

function _confirmAmortization() {
  const debtId = document.getElementById('debtAmortSelect')?.value;
  if (!debtId) return;
  window._pendingAmortDebtId = debtId;

  // Auto-set category to "Amortização de Dívida"
  const amortCat = (state.categories || []).find(c =>
    c.name?.toLowerCase().includes('amortiza') || c.slug === 'amortizacao_divida'
  );
  if (amortCat && typeof setCatPickerValue === 'function') setCatPickerValue(amortCat.id);

  const b = document.getElementById('debtAmortizationBanner');
  if (b) b.innerHTML = `<div class="dbt-amort-banner-ok">✓ ${t('dbt.amort_linked')} — ${_dbt.debts.find(d=>d.id===debtId)?.name||''}</div>`;

  toast(t('dbt.amort_set'), 'info');
}
window._confirmAmortization = _confirmAmortization;


async function openDebtTransactionLauncher() {
  if (!_dbt.loaded) await loadDebts();
  const activeDebts = (_dbt.debts || []).filter(d => d.status === 'active');
  if (!activeDebts.length) { toast('Nenhuma dívida ativa para amortizar.', 'warning'); return; }
  if (activeDebts.length === 1) {
    await _launchDebtAmortizationTransaction(activeDebts[0].id);
    return;
  }

  let modal = document.getElementById('debtTxLauncherModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'debtTxLauncherModal';
    modal.innerHTML = `
      <div class="modal" style="max-width:420px">
        <div class="modal-handle"></div>
        <div class="modal-header">
          <span class="modal-title">Novo lançamento de amortização</span>
          <button class="modal-close" onclick="closeModal('debtTxLauncherModal')">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Selecione a dívida</label>
            <select class="form-select" id="debtTxLauncherSelect"></select>
          </div>
          <p style="margin:10px 0 0;color:var(--muted);font-size:.82rem">O lançamento abrirá já vinculado para amortização da dívida selecionada.</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal('debtTxLauncherModal')">Cancelar</button>
          <button class="btn btn-primary" onclick="_confirmDebtTransactionLauncher()">Continuar</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }
  const select = modal.querySelector('#debtTxLauncherSelect');
  if (select) {
    select.innerHTML = activeDebts.map(d => `<option value="${d.id}">${esc(d.name)} · ${fmt(_debtCurrentBalance(d), d.currency)}</option>`).join('');
  }
  openModal('debtTxLauncherModal');
}
window.openDebtTransactionLauncher = openDebtTransactionLauncher;

async function _confirmDebtTransactionLauncher() {
  const debtId = document.getElementById('debtTxLauncherSelect')?.value;
  if (!debtId) return;
  closeModal('debtTxLauncherModal');
  await _launchDebtAmortizationTransaction(debtId);
}
window._confirmDebtTransactionLauncher = _confirmDebtTransactionLauncher;

async function _launchDebtAmortizationTransaction(debtId) {
  const debt = (_dbt.debts || []).find(d => d.id === debtId);
  if (!debt) { toast('Dívida não encontrada.', 'error'); return; }

  await _ensureAmortizacaoCategory();
  if (typeof openTransactionModal !== 'function') return;

  closeModal('debtDetailModal');
  await openTransactionModal();
  try { setTxType?.('expense'); } catch(_) {}

  const payeeId = debt.creditor_payee_id || debt.creditor?.id || '';
  if (payeeId && typeof setPayeeField === 'function') setPayeeField(payeeId, 'tx');

  const amortCat = (state.categories || []).find(c =>
    c.name?.toLowerCase().includes('amortiza') || c.slug === 'amortizacao_divida'
  );
  if (amortCat && typeof setCatPickerValue === 'function') setCatPickerValue(amortCat.id);

  window._pendingAmortDebtId = debt.id;
  const titleEl = document.getElementById('txModalTitle');
  if (titleEl) titleEl.textContent = 'Nova Amortização';

  let banner = document.getElementById('debtAmortizationBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'debtAmortizationBanner';
    banner.className = 'dbt-amort-banner';
    const memoGroup = document.getElementById('txMemo')?.closest('.form-group');
    if (memoGroup) memoGroup.parentNode.insertBefore(banner, memoGroup);
    else document.getElementById('txForm')?.appendChild(banner);
  }
  banner.style.display = '';
  banner.innerHTML = `<div class="dbt-amort-banner-ok">✓ ${t('dbt.amort_linked')} — ${esc(debt.name || '')}</div>`;
}

// Called after saveTransaction() successfully posts the expense leg
async function postDebtAmortizationEntry(txAmount, txDate, txId) {
  const debtId = window._pendingAmortDebtId;
  if (!debtId) return;
  window._pendingAmortDebtId = null;

  const debt = _dbt.debts.find(d => d.id === debtId);
  if (!debt) return;

  const prevBalance = _debtCurrentBalance(debt);
  const amortAmount = Math.abs(txAmount);
  const newBalance  = Math.max(0, prevBalance - amortAmount);

  await sb.from('debt_ledger').insert({
    debt_id: debtId, entry_date: txDate || new Date().toISOString().slice(0,10),
    entry_type: 'amortization',
    description: t('dbt.entry_amortization'),
    amount: -amortAmount, rate_applied: null,
    previous_balance: prevBalance, resulting_balance: newBalance,
    source_type: 'transaction', source_reference_id: txId || null,
    family_id: famId(), created_at: new Date().toISOString(),
  });

  await sb.from('debts').update({
    current_balance: newBalance,
    status: newBalance <= 0.01 ? 'settled' : debt.status,
    updated_at: new Date().toISOString(),
  }).eq('id', debtId);

  _dbt.loaded = false; // invalidate cache
  toast(t('dbt.amort_posted'), 'success');
}
window.postDebtAmortizationEntry = postDebtAmortizationEntry;

// ── SQL Migration (run in Supabase SQL Editor) ────────────────────────────────
window._DEBTS_SQL_MIGRATION = `
-- ══════════════════════════════════════════════════════════
-- DEBTS MODULE — SQL Migration
-- Run in Supabase SQL Editor
-- ══════════════════════════════════════════════════════════

-- 1. Debts table (virtual liability accounts)
CREATE TABLE IF NOT EXISTS debts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id         UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  creditor_payee_id UUID NOT NULL REFERENCES payees(id),
  name              TEXT NOT NULL,
  original_amount   NUMERIC(18,2) NOT NULL CHECK (original_amount > 0),
  current_balance   NUMERIC(18,2) NOT NULL DEFAULT 0,
  currency          TEXT NOT NULL DEFAULT 'BRL',
  start_date        DATE NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','settled','suspended','renegotiated','archived')),
  adjustment_type   TEXT NOT NULL DEFAULT 'fixed'
    CHECK (adjustment_type IN ('fixed','selic','ipca','igpm','cdi','poupanca','custom')),
  periodicity       TEXT NOT NULL DEFAULT 'monthly'
    CHECK (periodicity IN ('monthly','quarterly','annual','manual')),
  fixed_rate        NUMERIC(10,6),
  spread            NUMERIC(10,6),
  contract_ref      TEXT,
  notes             TEXT,
  archived_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_debts_family    ON debts(family_id);
CREATE INDEX IF NOT EXISTS idx_debts_creditor  ON debts(creditor_payee_id);
CREATE INDEX IF NOT EXISTS idx_debts_status    ON debts(status);

-- 2. Debt ledger (immutable journal entries)
CREATE TABLE IF NOT EXISTS debt_ledger (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  debt_id             UUID NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  family_id           UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  entry_date          DATE NOT NULL,
  entry_type          TEXT NOT NULL
    CHECK (entry_type IN ('initial','adjustment','interest','amortization','manual','reversal','settlement')),
  description         TEXT,
  amount              NUMERIC(18,2) NOT NULL,
  rate_applied        NUMERIC(12,6),
  previous_balance    NUMERIC(18,2) NOT NULL,
  resulting_balance   NUMERIC(18,2) NOT NULL,
  competence_period   TEXT,           -- YYYY-MM for idempotency
  source_type         TEXT NOT NULL DEFAULT 'manual'
    CHECK (source_type IN ('manual','auto','bcb_api','transaction','system')),
  source_reference_id UUID,           -- linked transaction id if from tx
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_debt_ledger_debt   ON debt_ledger(debt_id);
CREATE INDEX IF NOT EXISTS idx_debt_ledger_family ON debt_ledger(family_id);
CREATE INDEX IF NOT EXISTS idx_debt_ledger_date   ON debt_ledger(entry_date);

-- Idempotency: prevent duplicate auto-updates for same debt+period+type
CREATE UNIQUE INDEX IF NOT EXISTS uq_debt_ledger_period
  ON debt_ledger(debt_id, competence_period, entry_type)
  WHERE competence_period IS NOT NULL
    AND entry_type IN ('adjustment','interest');

-- 3. Row Level Security
ALTER TABLE debts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE debt_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "debts_family_access"  ON debts;
CREATE POLICY "debts_family_access" ON debts
  FOR ALL TO authenticated
  USING (family_id IN (
    SELECT family_id FROM family_members WHERE user_id = auth.uid()
    UNION SELECT family_id FROM app_users WHERE id = auth.uid()
  ));

DROP POLICY IF EXISTS "debt_ledger_family_access" ON debt_ledger;
CREATE POLICY "debt_ledger_family_access" ON debt_ledger
  FOR ALL TO authenticated
  USING (family_id IN (
    SELECT family_id FROM family_members WHERE user_id = auth.uid()
    UNION SELECT family_id FROM app_users WHERE id = auth.uid()
  ));

-- 4. Amortização de Dívida category (auto-insert if not present)
-- Run per-family as needed; or insert manually in categories table:
-- INSERT INTO categories (name, type, icon, color, family_id)
-- SELECT 'Amortização de Dívida', 'expense', '💳', '#c0392b', id FROM families
-- WHERE NOT EXISTS (SELECT 1 FROM categories WHERE slug='amortizacao_divida' AND family_id=families.id);

SELECT 'Migration OK — Debts module ready' AS status;
`;


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
