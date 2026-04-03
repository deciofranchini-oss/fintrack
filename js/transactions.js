function openTxClipboardImport() {
  _txClipItems = [];
  document.getElementById('txClipText').value = '';
  document.getElementById('txClipPreview').style.display = 'none';
  document.getElementById('txClipPreviewBody').innerHTML = '';
  document.getElementById('txClipCount').textContent = '';
  document.getElementById('txClipImportBtn').disabled = true;
  document.getElementById('txClipSelectAll').checked = true;
  document.getElementById('txClipSelectAllTh').checked = true;

  // Populate default account selector
  const sel = document.getElementById('txClipDefaultAccount');
  sel.innerHTML = '<option value="">— usar coluna conta —</option>' +
    (state.accounts || []).map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('');

  openModal('txClipboardModal');
}

async function txClipPasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    document.getElementById('txClipText').value = text;
    parseTxClipboard();
  } catch(e) {
    toast('Não foi possível acessar o clipboard. Cole manualmente.', 'warning');
  }
}

function parseTxClipboard() {
  const raw = document.getElementById('txClipText').value;
  if (!raw.trim()) {
    _txClipItems = [];
    renderTxClipPreview();
    return;
  }

  // Build lookup maps
  const accByName  = {}, catByName = {}, payByName = {};
  (state.accounts   || []).forEach(a => accByName[a.name.toLowerCase()]  = a);
  (state.categories || []).forEach(c => catByName[c.name.toLowerCase()]  = c);
  (state.payees     || []).forEach(p => payByName[p.name.toLowerCase()]  = p);

  const defaultAccId = document.getElementById('txClipDefaultAccount').value;

  _txClipItems = [];

  const lines = raw.split(/\n/).map(l => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Parse CSV line respecting quoted fields
    const cols = parseTxClipLine(line);

    const rawDate = (cols[0] || '').trim();
    const rawAmt  = (cols[1] || '').trim();
    const desc    = (cols[2] || '').trim();
    const accName = (cols[3] || '').trim();
    const catName = (cols[4] || '').trim();
    const payName = (cols[5] || '').trim();
    const memo    = (cols[6] || '').trim();

    // Validate date
    const date = parseImportDate(rawDate);
    // Validate amount
    const amount = parseImportAmt(rawAmt);

    const errors = [];
    if (!date)         errors.push('data inválida');
    if (rawAmt === '' || isNaN(amount)) errors.push('valor inválido');

    // Resolve account
    let account = null;
    if (accName) account = accByName[accName.toLowerCase()] || null;
    if (!account && defaultAccId) account = (state.accounts||[]).find(a => a.id === defaultAccId) || null;
    if (!account && !errors.length) errors.push('conta não encontrada');

    // Resolve category & payee (optional — will be null if not found)
    const category = catName ? (catByName[catName.toLowerCase()] || null) : null;
    const payee    = payName ? (payByName[payName.toLowerCase()] || null) : null;

    _txClipItems.push({
      lineNum: i + 1,
      rawLine: line,
      date, rawDate,
      amount, rawAmt,
      desc, memo,
      accName:  accName  || account?.name || '',
      catName:  catName,
      payName:  payName,
      account, category, payee,
      errors,
      selected: errors.length === 0,
    });
  }

  renderTxClipPreview();
}

// Parse a CSV line properly (handles commas inside quoted strings)
function parseTxClipLine(line) {
  const cols = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; }
    else if (c === ',' && !inQ) { cols.push(cur); cur = ''; }
    else cur += c;
  }
  cols.push(cur);
  return cols;
}

function renderTxClipPreview() {
  const preview = document.getElementById('txClipPreview');
  const body    = document.getElementById('txClipPreviewBody');
  const countEl = document.getElementById('txClipCount');
  const btn     = document.getElementById('txClipImportBtn');

  if (!_txClipItems.length) {
    preview.style.display = 'none';
    countEl.textContent = '';
    btn.disabled = true;
    return;
  }

  const ok  = _txClipItems.filter(r => r.errors.length === 0);
  const bad = _txClipItems.filter(r => r.errors.length > 0);
  const sel = _txClipItems.filter(r => r.selected);
  countEl.textContent = `${_txClipItems.length} linhas · ${ok.length} válidas · ${bad.length} com erro`;

  body.innerHTML = _txClipItems.map((row, idx) => {
    const hasErr = row.errors.length > 0;
    const rowStyle = hasErr ? 'opacity:.6;background:var(--red-lt,#fef2f2)' : '';
    const amtClass = (row.amount || 0) >= 0 ? 'amount-pos' : 'amount-neg';
    const statusHtml = hasErr
      ? `<span title="${row.errors.join(', ')}" style="font-size:.7rem;font-weight:600;color:var(--red);background:var(--red-lt);padding:2px 6px;border-radius:20px;cursor:help">⚠ ${row.errors[0]}</span>`
      : `<span style="font-size:.7rem;font-weight:600;color:var(--green);background:var(--green-lt);padding:2px 6px;border-radius:20px">✓ ok</span>`;

    return `<tr style="border-bottom:1px solid var(--border);${rowStyle}">
      <td style="padding:5px 8px;white-space:nowrap;color:var(--muted)">${row.date || row.rawDate}</td>
      <td style="padding:5px 8px;text-align:right;white-space:nowrap" class="${amtClass}">${row.amount !== undefined ? fmt(row.amount) : row.rawAmt}</td>
      <td style="padding:5px 8px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(row.desc)}">${esc(row.desc || '—')}</td>
      <td style="padding:5px 8px;font-size:.75rem;color:${row.account?'var(--text2)':'var(--red)'}">${esc(row.accName || '—')}</td>
      <td style="padding:5px 8px;font-size:.75rem;color:${row.category?'var(--text2)':'var(--muted)'}">${esc(row.catName || '—')}</td>
      <td style="padding:5px 8px;font-size:.75rem;color:${row.payee?'var(--text2)':'var(--muted)'}">${esc(row.payName || '—')}</td>
      <td style="padding:5px 8px;text-align:center">${statusHtml}</td>
      <td style="padding:5px 8px;text-align:center">
        <input type="checkbox" ${row.selected ? 'checked' : ''} ${hasErr ? 'disabled' : ''}
          onchange="_txClipItems[${idx}].selected=this.checked;_updateTxClipBtn()">
      </td>
    </tr>`;
  }).join('');

  preview.style.display = '';
  _updateTxClipBtn();

  // Sync header checkbox
  const allSelectable = _txClipItems.filter(r => r.errors.length === 0);
  const allChecked = allSelectable.length > 0 && allSelectable.every(r => r.selected);
  document.getElementById('txClipSelectAll').checked = allChecked;
  document.getElementById('txClipSelectAllTh').checked = allChecked;
}

function _updateTxClipBtn() {
  const sel = _txClipItems.filter(r => r.selected);
  const btn = document.getElementById('txClipImportBtn');
  btn.disabled = sel.length === 0;
  btn.textContent = sel.length > 0 ? `Importar ${sel.length} →` : 'Importar →';
}

function txClipToggleAll(checked) {
  _txClipItems.forEach(r => { if (r.errors.length === 0) r.selected = checked; });
  renderTxClipPreview();
}

async function confirmTxClipImport() {
  const toImport = _txClipItems.filter(r => r.selected && r.errors.length === 0);
  if (!toImport.length) { toast(t('toast.no_row_selected'), 'warning'); return; }

  const btn = document.getElementById('txClipImportBtn');
  btn.disabled = true; btn.textContent = '⏳ Importando...';

  let created = 0, errors = 0;
  try {
    // Build records
    const records = toImport.map(row => ({
      date:        row.date,
      description: row.desc || '',
      amount:      row.amount,
      account_id:  row.account.id,
      category_id: row.category?.id || null,
      payee_id:    row.payee?.id    || null,
      memo:        row.memo         || null,
      is_transfer: false,
      family_id:   famId(),
    }));

    // Insert in batches of 100
    for (let i = 0; i < records.length; i += 100) {
      const { error } = await sb.from('transactions').insert(records.slice(i, i + 100));
      if (error) {
        // Fallback: one by one
        for (const rec of records.slice(i, i + 100)) {
          const { error: e2 } = await sb.from('transactions').insert(rec);
          if (e2) { errors++; console.warn('[txClip]', e2.message, rec); }
          else created++;
        }
      } else {
        created += records.slice(i, i + 100).length;
      }
    }

    closeModal('txClipboardModal');
    await loadTransactions();
    if (state.currentPage === 'dashboard') loadDashboard();
    toast(`✓ ${created} transaç${created !== 1 ? 'ões importadas' : 'ão importada'}${errors ? ` · ${errors} erro(s)` : ''}`,
      errors ? 'warning' : 'success');
  } catch(e) {
    toast('Erro: ' + e.message, 'error');
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.textContent = `Importar ${toImport.length} →`;
  }
}

async function loadTransactions(){
  try {
    const result = await DB.transactions.load({
      filter:    state.txFilter,
      page:      state.txPage,
      pageSize:  state.txPageSize,
      sortField: state.txSortField,
      sortAsc:   state.txSortAsc,
      view:      state.txView,
    });
    state.transactions = result.data;
    state.txTotal      = result.count;
    state.txRunningBalanceMap = {};

    const singleAccId = state.txFilter?.account || '';
    if (singleAccId && state.txView === 'flat') {
      try {
        state.txRunningBalanceMap = await buildAccountRunningBalanceMap(singleAccId);
      } catch (e) {
        console.warn('running balance map failed:', e?.message || e);
        state.txRunningBalanceMap = {};
      }
    }

    renderTransactions();
  } catch(e) { toast(e.message,'error'); }
}
let _filterTxDebounceTimer = null;
function filterTransactions(immediate = false){
  state.txFilter.search=document.getElementById('txSearch').value;
  state.txFilter.month=document.getElementById('txMonth').value;
  state.txFilter.account=document.getElementById('txAccount').value;
  state.txFilter.type=document.getElementById('txType').value;
  state.txFilter.status=(document.getElementById('txStatusFilter')?.value)||'';
  state.txFilter.reconciled=(document.getElementById('txReconcileFilter')?.value)||'';
  state.txFilter.categoryId=(document.getElementById('txCategoryFilter')?.value)||'';
  // Member filter: read selected IDs from multi-picker
  // Read selected member from compact select (empty string = all members)
  const _txMemberSel = document.getElementById('txMemberPicker');
  const _txMemberVal = (_txMemberSel?.value || '').trim();
  const _txMemberUuidRx = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  state.txFilter.memberIds = (_txMemberVal && _txMemberUuidRx.test(_txMemberVal)) ? [_txMemberVal] : [];
  state.txPage=0;
  if(state.txView==='flat') document.getElementById('txSummaryBar').style.display='none';
  ['txMonth','txAccount','txType','txStatusFilter','txReconcileFilter'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('is-active', !!el.value);
  });
  // Highlight member filter wrap when active
  const wrap = document.getElementById('txMemberFilterWrap');
  if (wrap) wrap.classList.toggle('is-active', (state.txFilter.memberIds?.length || 0) > 0);
  // Update filter toggle button badge (shows active filter count)
  _txUpdateFilterBadge();
  // Debounce: typing waits 280ms; selects/chips pass immediate=true
  clearTimeout(_filterTxDebounceTimer);
  _filterTxDebounceTimer = setTimeout(() => loadTransactions(), immediate ? 0 : 280);
}

// ── Collapsible filter panel ──────────────────────────────────────────────
function _txToggleFilters() {
  const panel = document.getElementById('tx-filters-panel');
  const btn   = document.getElementById('txFilterToggle');
  if (!panel) return;
  const isOpen = panel.classList.contains('open');
  panel.classList.toggle('open', !isOpen);
  if (btn) btn.classList.toggle('active', !isOpen);
}
window._txToggleFilters = _txToggleFilters;

function _txUpdateFilterBadge() {
  const btn = document.getElementById('txFilterToggle');
  if (!btn) return;
  const activeCount = [
    state.txFilter.month, state.txFilter.account, state.txFilter.type,
    state.txFilter.status, state.txFilter.categoryId,
    ...(state.txFilter.memberIds || [])
  ].filter(Boolean).length;
  btn.classList.toggle('has-filters', activeCount > 0);
}
window._txUpdateFilterBadge = _txUpdateFilterBadge;

function populateTxMonthFilter() {
  const sel = document.getElementById('txMonth');
  if (!sel) return;
  const prev = sel.value;
  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth() + 1;
  const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

  let html = `<option value="">${t('tx.all_months')}</option>`;

  // Year options for current and 2 previous years
  for (let y = curY; y >= curY - 2; y--) {
    html += `<option value="year:${y}">${y} — Ano inteiro</option>`;
  }

  html += '<option disabled>──────────────</option>';

  // Monthly options: current year + 2 previous years
  for (let y = curY; y >= curY - 2; y--) {
    const maxM = (y === curY) ? curM : 12;
    for (let m = maxM; m >= 1; m--) {
      const val = `${y}-${String(m).padStart(2,'0')}`;
      html += `<option value="${val}">${MONTHS[m-1]}/${y}</option>`;
    }
    if (y > curY - 2) html += '<option disabled>──────────────</option>';
  }

  sel.innerHTML = html;
  // Restore previous selection if still valid
  if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
}
function sortTx(field){if(state.txSortField===field)state.txSortAsc=!state.txSortAsc;else{state.txSortField=field;state.txSortAsc=false;}loadTransactions();}

async function buildAccountRunningBalanceMap(accountId) {
  if (!accountId || !sb) return {};
  const acct = (state.accounts || []).find(a => a.id === accountId);

  // ── Query ALL confirmed transactions in the SAME sort order as the display ──
  // Display uses: date DESC, created_at DESC, id DESC
  // We fetch in that same order, then REVERSE to get chronological ASC.
  // This guarantees same-date tie-breaking is identical between map and display.
  const { data: ownRows, error: e1 } = await famQ(
    sb.from('transactions')
      .select('id,amount,date,created_at,is_transfer,linked_transfer_id,transfer_to_account_id,account_id')
      .eq('account_id', accountId)
      .eq('status', 'confirmed')
      .order('date',       { ascending: false })
      .order('created_at', { ascending: false })
      .order('id',         { ascending: false })
  );
  if (e1) throw e1;

  // Query 2: legacy single-leg inbound transfers (no paired credit row)
  const { data: legacyIn } = await famQ(
    sb.from('transactions')
      .select('id,amount,date,created_at,is_transfer,linked_transfer_id,transfer_to_account_id,account_id')
      .eq('is_transfer', true)
      .is('linked_transfer_id', null)
      .eq('transfer_to_account_id', accountId)
      .eq('status', 'confirmed')
      .order('date',       { ascending: false })
      .order('created_at', { ascending: false })
      .order('id',         { ascending: false })
  );

  // Merge in display order (DESC), then reverse to get chronological ASC.
  // This is the key: the reversed order exactly matches how rows appear
  // bottom→top on screen, so map[id] = balance after that tx reading upward.
  const displayOrder = [
    ...(ownRows  || []).map(t => ({ ...t, _legacyIn: false })),
    ...(legacyIn || []).filter(t => t.account_id !== accountId).map(t => ({ ...t, _legacyIn: true })),
  ].sort((a, b) => {
    // Sort DESC (same as display) then we'll reverse
    if (a.date !== b.date) return a.date > b.date ? -1 : 1;
    if (a.created_at !== b.created_at) return a.created_at > b.created_at ? -1 : 1;
    return a.id > b.id ? -1 : 1;
  });

  // Reverse → chronological ASC = bottom-to-top reading order
  const chronological = [...displayOrder].reverse();

  let running = parseFloat(acct?.initial_balance || 0) || 0;
  const map = {};
  chronological.forEach(t => {
    let delta = parseFloat(t.amount || 0) || 0;
    if (t._legacyIn) delta = Math.abs(delta); // legacy inbound credit
    running += delta;
    map[t.id] = running; // balance AFTER this tx, reading bottom→top
  });
  return map;
}
function txRow(t, showAccount=true, runningBalance=null) {
  const isPending = (t.status||'confirmed') === 'pending';

  // Two-line date: day number + month abbrev — renders compactly on mobile
  const d   = t.date ? new Date(t.date + 'T12:00:00') : new Date();
  const _lang = (typeof i18n !== 'undefined' && i18n.lang) ? i18n.lang : 'pt';
  const _MONS = {
    pt:['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'],
    en:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
    es:['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'],
    fr:['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'],
  };
  const MON = _MONS[_lang] || _MONS.pt;
  const dateStr = `<span class="tx-date-day">${d.getDate()}</span><span class="tx-date-mon">${MON[d.getMonth()]}</span>`;

  const _catIcon  = t.categories?.icon  || '';
  const _catColor = t.categories?.color || '#94a3b8';
  // Category icon bubble — shown inline before description
  const _catIconHtml = _catIcon
    ? `<span class="tx-v2-cat-bubble" style="background:${_catColor}22;color:${_catColor}">${_catIcon}</span>`
    : `<span class="tx-v2-cat-bubble tx-v2-cat-bubble-dot" style="background:${_catColor}33"></span>`;
  const categoryName = t.categories?.name ? esc(t.categories.name) : '';
  const payeeName = t.payees?.name ? esc(t.payees.name) : '';
  const categoryOnlyLine = categoryName
    ? `<div class="tx-v2-category">${_catIconHtml}${categoryName}</div>`
    : '';
  const flatMetaText = [categoryName, payeeName].filter(Boolean).join(' | ');
  const flatMetaLine = flatMetaText
    ? `<div class="tx-v2-mobile-meta">${flatMetaText}</div>`
    : '';
  const payeeOnlyLine = payeeName
    ? `<div class="tx-v2-payee-line">${payeeName}</div>`
    : '';

  // Amount
  const txCur = (t.currency || '').toUpperCase();
  const accountCur = (t.accounts?.currency || 'BRL').toUpperCase();
  const displayCur = txCur || accountCur || 'BRL';
  const mainAmt = fmt(t.amount, displayCur);
  const amtClass = t.amount >= 0 ? 'amount-pos' : 'amount-neg';
  let amtHtml = `<span class="tx-v2-amt ${amtClass}">${mainAmt}</span>`;

  // Secondary converted value rules:
  //  - If no single account filter is active in the flat list, show BRL conversion for foreign-currency transactions.
  //  - If a single account is filtered, only show conversion when the transaction currency differs from the account currency.
  //  - Never show a secondary line for BRL transactions.
  const hasSingleAccountFilter = !!(state?.txFilter?.account);
  const hasBrlConversion = t.brl_amount != null && !Number.isNaN(parseFloat(t.brl_amount));
  const showConvertedAmount = !!txCur && txCur !== 'BRL' && hasBrlConversion && (
    !hasSingleAccountFilter || txCur !== accountCur
  );
  if (showConvertedAmount) {
    amtHtml += `<span class="tx-v2-brl">${fmt(t.brl_amount, 'BRL')}</span>`;
  }

  // Running balance — use account's native currency (balance is stored in account currency)
  const balCur = (t.accounts?.currency || t.currency || 'BRL').toUpperCase();
  const balHtml = (runningBalance !== null)
    ? `<div class="tx-v2-bal ${runningBalance >= 0 ? '' : 'neg'}">${fmt(runningBalance, balCur)}</div>`
    : '';

  const _acctIcon = (showAccount && t.accounts?.icon && typeof renderIconEl === 'function')
    ? renderIconEl(t.accounts.icon, t.accounts.color || '#94a3b8', 12)
    : '';
  const accountLine = (showAccount && t.accounts?.name)
    ? `<div class="tx-v2-account-line"><span class="tx-v2-acct tx-v2-acct-pill">${_acctIcon}${esc(t.accounts.name)}</span></div>`
    : '';
  const isGroupView = state.txView === 'group';
  const showTitleCategoryIcon = !isGroupView;
  const titleCategoryIconHtml = showTitleCategoryIcon ? _catIconHtml : '';
  const detailLines = isGroupView
    ? `${categoryOnlyLine}${payeeOnlyLine}`
    : `${flatMetaLine}${accountLine}`;

  const attach   = t.attachment_url ? ' <span class="tx-v2-clip" title="Anexo">📎</span>' : '';
  const pendDot  = isPending ? '<span class="tx-v2-pend">⏳</span>' : '';

  const isReconciled = !!t.is_reconciled;
  const reconcileBadge = isReconciled ? '<span class="tx-reconcile-badge" title="Reconciliada">✓REC</span>' : '';

  // ── Modo Reconciliação ──
  if (state.reconcileMode) {
    const isChecked = state.reconcileChecked.has(t.id);
    const checkedCls = isChecked ? ' reconcile-checked' : '';
    const reconciledCls = isReconciled ? ' tx-reconciled' : '';
    const checkboxCell = `<td class="tx-v2-chk" onclick="event.stopPropagation()">
      <label class="reconcile-chk-label">
        <input type="checkbox" class="reconcile-chk" ${isChecked?'checked':''} ${isReconciled?'disabled title="Já reconciliada"':''}
          onchange="toggleReconcileCheck('${t.id}',this)">
      </label>
    </td>`;
    return `<tr class="tx-row-clickable${isPending?' tx-pending':''}${reconciledCls}${checkedCls}" data-tx-id="${t.id}" onclick="openTxDetail('${t.id}')">
      ${checkboxCell}
      <td class="tx-v2-date">${dateStr}${pendDot}</td>
      <td class="tx-v2-body">
        <div class="tx-v2-title">${titleCategoryIconHtml}<span class="tx-v2-desc-text">${esc(t.description||'—')}</span>${attach}${reconcileBadge}</div>
        ${detailLines}
      </td>
      <td class="tx-v2-right">
        <div class="tx-v2-amt-wrap">${amtHtml}</div>
        ${balHtml}
      </td>
    </tr>`;
  }

  // ── Modo normal ──
  return `<tr class="tx-row-clickable${isPending?' tx-pending':''}${isReconciled?' tx-reconciled':''}" data-tx-id="${t.id}" onclick="openTxDetail('${t.id}')">
    <td class="tx-v2-date">${dateStr}${pendDot}</td>
    <td class="tx-v2-body">
      <div class="tx-v2-title">${titleCategoryIconHtml}<span class="tx-v2-desc-text">${esc(t.description||'—')}</span>${attach}${reconcileBadge}</div>
      ${detailLines}
    </td>
    <td class="tx-v2-right">
      <div class="tx-v2-amt-wrap">${amtHtml}</div>
      ${balHtml}
    </td>
  </tr>`;
}


// ── Modo Reconciliação ────────────────────────────────────────────────────

function enterReconcileMode() {
  state.reconcileMode = true;
  state.reconcileChecked = new Set();
  document.body.classList.add('reconcile-mode');
  document.getElementById('page-transactions')?.classList.add('reconcile-mode');
  // Esconde botão de entrada, mostra banner
  const btn = document.getElementById('btnEnterReconcile');
  if (btn) btn.style.display = 'none';
  const banner = document.getElementById('reconcileBanner');
  if (banner) banner.style.display = 'block';
  _updateReconcileBannerStats();
  renderTransactions();
}

function exitReconcileMode(committed) {
  state.reconcileMode = false;
  state.reconcileChecked = new Set();
  document.body.classList.remove('reconcile-mode');
  document.getElementById('page-transactions')?.classList.remove('reconcile-mode');
  const btn = document.getElementById('btnEnterReconcile');
  if (btn) btn.style.display = '';
  const banner = document.getElementById('reconcileBanner');
  if (banner) banner.style.display = 'none';
  if (!committed) renderTransactions();
}

function _updateReconcileBannerStats() {
  const ids = [...(state.reconcileChecked || [])];
  const count = ids.length;
  let sum = 0;
  ids.forEach(id => {
    const t = (state.transactions || []).find(x => x.id === id);
    if (t) sum += parseFloat(t.brl_amount ?? t.amount ?? 0) || 0;
  });
  const countEl = document.getElementById('reconcileCount');
  const sumEl   = document.getElementById('reconcileSum');
  if (countEl) countEl.textContent = `${count} marcada${count !== 1 ? 's' : ''}`;
  if (sumEl)   sumEl.textContent   = fmt(sum, 'BRL');
  const confirmBtn = document.getElementById('btnConfirmReconcile');
  if (confirmBtn) confirmBtn.disabled = count === 0;
}

function toggleReconcileCheck(txId, checkbox) {
  if (!state.reconcileMode) return;
  if (checkbox.checked) {
    state.reconcileChecked.add(txId);
  } else {
    state.reconcileChecked.delete(txId);
  }
  // highlight row
  const row = document.querySelector(`[data-tx-id="${txId}"]`);
  if (row) row.classList.toggle('reconcile-checked', checkbox.checked);
  _updateReconcileBannerStats();
}

async function confirmReconcileMode() {
  const ids = [...(state.reconcileChecked || [])];
  if (!ids.length) return;
  const confirmBtn = document.getElementById('btnConfirmReconcile');
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Salvando…'; }
  try {
    // Batch: update all checked as reconciled + confirmed
    const { error } = await famQ(
      sb.from('transactions')
        .update({ is_reconciled: true, status: 'confirmed' })
        .in('id', ids)
    );
    if (error) throw error;
    toast(`✓ ${ids.length} transaç${ids.length !== 1 ? 'ões reconciliadas' : 'ão reconciliada'}`, 'success');
    exitReconcileMode(true);
    await loadTransactions();
  } catch(e) {
    toast('Erro: ' + e.message, 'error');
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = '✓ Confirmar'; }
  }
}

// ── Toggle reconciliação inline (fora do modo) ─────────────────────────────
async function toggleReconcile(txId, btn) {
  const isNow = btn?.classList.contains('reconciled');
  const newVal = !isNow;
  try {
    const { error } = await sb.from('transactions')
      .update({ is_reconciled: newVal })
      .eq('id', txId);
    if (error) throw error;
    // Update UI optimistically
    const row = document.querySelector(`[data-tx-id="${txId}"]`);
    if (row) {
      row.classList.toggle('tx-reconciled', newVal);
      if (btn) {
        btn.classList.toggle('reconciled', newVal);
        btn.textContent = newVal ? '✓ Rec' : '○ Rec';
        btn.title = newVal ? 'Desmarcar reconciliação' : 'Marcar como reconciliada';
      }
      const badge = row.querySelector('.tx-reconcile-badge');
      const titleDiv = row.querySelector('.tx-v2-title');
      if (newVal && titleDiv && !badge) {
        const b = document.createElement('span');
        b.className = 'tx-reconcile-badge'; b.title = 'Reconciliada'; b.textContent = '✓REC';
        titleDiv.appendChild(b);
      } else if (!newVal && badge) {
        badge.remove();
      }
    }
    // Update local state
    const t = (state.transactions || []).find(x => x.id === txId);
    if (t) t.is_reconciled = newVal;
    toast(newVal ? '✓ Transação reconciliada' : 'Reconciliação removida', 'success');
  } catch(e) {
    toast('Erro: ' + e.message, 'error');
  }
}


function setTxView(v) {
  state.txView = v;
  // Update all view buttons (handles both old .tx-view-btn and new .tx-fb-btn)
  document.querySelectorAll('#viewBtnFlat, #viewBtnGroup').forEach(b => {
    const isFlat  = b.id === 'viewBtnFlat';
    const isGroup = b.id === 'viewBtnGroup';
    b.classList.toggle('active', (isFlat && v==='flat') || (isGroup && v==='group'));
  });
  document.getElementById('txFlatCard').style.display = v==='flat' ? '' : 'none';
  document.getElementById('txGroupContainer').style.display = v==='group' ? '' : 'none';
  // Hide the account summary pills bar when switching back to flat view
  if (v === 'flat') {
    const bar = document.getElementById('txSummaryBar');
    if (bar) bar.style.display = 'none';
  }
  renderTransactions();
}

function renderTransactions(){
  const txs = state.transactions;
  let income=0, expense=0;
  txs.forEach(t=>{ const st=(t.status||'confirmed'); if(st==='pending') return; const brl=txToBRL(t); if(brl>0)income+=brl; else expense+=brl;});
  document.getElementById('txCount').textContent = `${state.txTotal} transações`;
  document.getElementById('txTotalIncome').textContent = income ? `+${fmt(income)}` : '';
  document.getElementById('txTotalExpense').textContent = expense ? fmt(expense) : '';

  if(state.txView === 'group') {
    renderTransactionsGrouped(txs);
    return;
  }

  // ── FLAT VIEW ──
  const body = document.getElementById('txBody');
  const colCount = state.reconcileMode ? 4 : 3;
  if(!txs.length){body.innerHTML=`<tr><td colspan="${colCount}" class="text-muted" style="text-align:center;padding:32px;font-size:.83rem">Nenhuma transação encontrada</td></tr>`;return;}
  const pending   = txs.filter(t => (t.status||'confirmed')==='pending');
  const confirmed = txs.filter(t => (t.status||'confirmed')!=='pending');
  const sep = (pending.length && confirmed.length)
    ? `<tr><td colspan="${colCount}" class="tx-v2-sep">CONFIRMADAS</td></tr>` : '';

  // Running balance: only when a single account is selected
  const singleAccId = state.txFilter?.account || '';
  const balMap = singleAccId ? (state.txRunningBalanceMap || {}) : null;

  const renderRow = (t) => {
    const runningBal = (balMap && Object.prototype.hasOwnProperty.call(balMap, t.id))
      ? balMap[t.id]
      : null;
    return txRow(t, !singleAccId, runningBal);
  };

  // Ajusta cabeçalho da tabela conforme modo e mantém número de colunas consistente
  const theadRow = document.querySelector('#txMainTable thead tr');
  if (theadRow) {
    theadRow.innerHTML = state.reconcileMode
      ? `<th class="th-chk" style="width:36px"></th>
         <th class="tx-v2-th-date" onclick="sortTx('date')" data-i18n="tx.col_date">Data ⇅</th>
         <th class="tx-v2-th-body" data-i18n="tx.col_desc">Descrição</th>
         <th class="tx-v2-th-right" onclick="sortTx('amount')">Valor ⇅</th>`
      : `<th class="tx-v2-th-date" onclick="sortTx('date')" data-i18n="tx.col_date">Data ⇅</th>
         <th class="tx-v2-th-body" data-i18n="tx.col_desc">Descrição</th>
         <th class="tx-v2-th-right" onclick="sortTx('amount')">Valor ⇅</th>`;
  }

  // ── Group confirmed rows by date with alternating date bands ──
  function renderWithDateGroups(txList, showAcc, balMapArg) {
    if (!txList.length) return '';
    let html = '';
    let lastDate = null;
    let bandIndex = 0;
    const TODAY_STR = new Date().toISOString().slice(0,10);
    const YESTERDAY_STR = new Date(Date.now()-86400000).toISOString().slice(0,10);
    // Pre-compute per-day totals for the summary
    const dayTotals = {};
    txList.forEach(tx => {
      if (!tx.date) return;
      if (!dayTotals[tx.date]) dayTotals[tx.date] = 0;
      const brl = txToBRL(tx);
      dayTotals[tx.date] += brl;
    });
    txList.forEach(tx => {
      const txDateStr = tx.date || '';
      if (txDateStr !== lastDate) {
        // Compute a human-friendly label
        const d = txDateStr ? new Date(txDateStr + 'T12:00:00') : new Date();
        const _lang = (typeof i18n !== 'undefined' && i18n.lang) ? i18n.lang : 'pt';
        const _DAY = {
          pt:['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'],
          en:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],
          es:['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'],
          fr:['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'],
        };
        const _MON = {
          pt:['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'],
          en:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
          es:['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'],
          fr:['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Août','Sep','Oct','Nov','Déc'],
        };
        const dayNames = _DAY[_lang] || _DAY.pt;
        const MON_FULL = _MON[_lang] || _MON.pt;
        const _todayLbl = typeof t === 'function' ? t('tx.date_today') : 'Hoje';
        const _yestLbl  = typeof t === 'function' ? t('tx.date_yesterday') : 'Ontem';
        let label;
        if (txDateStr === TODAY_STR)     label = `${_todayLbl} · ${d.getDate()} ${MON_FULL[d.getMonth()]}`;
        else if (txDateStr === YESTERDAY_STR) label = `${_yestLbl} · ${d.getDate()} ${MON_FULL[d.getMonth()]}`;
        else label = `${dayNames[d.getDay()]}, ${d.getDate()} ${MON_FULL[d.getMonth()]} ${d.getFullYear()}`;
        bandIndex++;
        const bandClass = bandIndex % 2 === 0 ? 'tx-date-band-alt' : 'tx-date-band';
        const colspan = colCount;
        const daySum = dayTotals[txDateStr] || 0;
        const daySumHtml = daySum !== 0
          ? `<span class="tx-date-day-total ${daySum >= 0 ? 'pos' : 'neg'}">${daySum >= 0 ? '+' : ''}${fmt(daySum)}</span>`
          : '';
        html += `<tr class="tx-date-header-row ${bandClass}"><td colspan="${colspan}" class="tx-date-header-cell"><span class="tx-date-label">${label}</span>${daySumHtml}</td></tr>`;
        lastDate = txDateStr;
      }
      const runningBal = (balMapArg && Object.prototype.hasOwnProperty.call(balMapArg, tx.id)) ? balMapArg[tx.id] : null;
      html += txRow(tx, showAcc, runningBal);
    });
    return html;
  }

  const pendingHtml   = renderWithDateGroups(pending, !singleAccId, null);
  const confirmedHtml = renderWithDateGroups(confirmed, !singleAccId, balMap);
  body.innerHTML = pendingHtml + sep + confirmedHtml;
  try{ enhanceTransactionsMobileLayout(); }catch(e){}
  const total=state.txTotal, page=state.txPage, ps=state.txPageSize;
  document.getElementById('txPagination').innerHTML=`<span>${page*ps+1}–${Math.min((page+1)*ps,total)} de ${total}</span><div style="display:flex;gap:5px"><button class="btn btn-ghost btn-sm" ${page===0?'disabled':''} onclick="changePage(-1)">${t('tx.prev_page')}</button><button class="btn btn-ghost btn-sm" ${(page+1)*ps>=total?'disabled':''} onclick="changePage(1)">${t('tx.next_page')}</button></div>`;

  try{ initTxMobileUX(); }catch(e){}
}

function renderTransactionsGrouped(txs) {
  const container = document.getElementById('txGroupContainer');
  if(!txs.length){container.innerHTML='<div class="card" style="text-align:center;padding:32px;color:var(--muted);font-size:.83rem">Nenhuma transação encontrada</div>';return;}

  // Group by account
  const groups = {};
  txs.forEach(t => {
    const key = t.account_id || '__none__';
    if(!groups[key]) groups[key] = { account: t.accounts, txs: [], income: 0, expense: 0, balance: 0 };
    groups[key].txs.push(t);
    const st=(t.status||'confirmed');
    if(st!=='pending') {
      const _brl = txToBRL(t); // converte para BRL (usa brl_amount se disponível)
      if(_brl > 0) groups[key].income += _brl;
      else groups[key].expense += _brl;
      groups[key].balance += _brl;
    }
  });

  // Sort groups by account name
  const sortedKeys = Object.keys(groups).sort((a,b) => {
    const na = groups[a].account?.name || '';
    const nb = groups[b].account?.name || '';
    return na.localeCompare(nb);
  });

  // Summary bar hidden in group view — saldos already visible in each group header
  const summaryBar = document.getElementById('txSummaryBar');
  if (summaryBar) summaryBar.style.display = 'none';
  // Render each group
  container.innerHTML = sortedKeys.map(k => {
    const g = groups[k];
    const acct = state.accounts.find(a => a.id === k) || {};
    const col = acct.color || 'var(--accent)';
    const colspan = 6;
    const acctCurrency = acct.currency || 'BRL';
    return `<div class="tx-group-card" id="txGroup-${k}">
      <div class="tx-group-card__header" onclick="toggleTxGroup('${k}')">
        <div class="tx-group-card__accent" style="background:${col}"></div>
        <div class="tx-group-card__icon" style="background:${col}22">${typeof renderIconEl==='function' ? renderIconEl(acct.icon||'', col, 24) : (acct.icon||'🏦')}</div>
        <div class="tx-group-card__info">
          <span class="tx-group-card__name">${esc(g.account?.name||'Sem conta')}</span>
          <span class="tx-group-card__count">${g.txs.length} lançamentos</span>
        </div>
        <div class="tx-group-card__totals">
          ${g.income ? `<span class="tx-grp-badge tx-grp-badge-in">+${fmt(g.income,acctCurrency)}</span>` : ''}
          ${g.expense ? `<span class="tx-grp-badge tx-grp-badge-out">${fmt(g.expense,acctCurrency)}</span>` : ''}
          <span class="tx-grp-badge ${g.balance>=0?'tx-grp-badge-bal-pos':'tx-grp-badge-bal-neg'}">${fmt(g.balance,acctCurrency)}</span>
        </div>
        <svg class="tx-group-card__arrow" id="txGroupToggle-${k}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div id="txGroupBody-${k}" class="tx-group-card__body">
        <div class="table-wrap" style="margin:0">
          <table style="border-radius:0;width:100%;table-layout:fixed">
            <colgroup>
              ${state.reconcileMode ? '<col style="width:36px">' : ''}
              <col style="width:52px">
              <col>
              <col style="width:90px">
            </colgroup>
            <thead><tr>
              ${state.reconcileMode ? '<th class="th-chk" style="width:36px"></th>' : ''}
              <th class="tx-v2-th-date" onclick="sortTx('date')">Data</th>
              <th class="tx-v2-th-body">Descrição</th>
              <th class="tx-v2-th-right" onclick="sortTx('amount')">Valor</th>
            </tr></thead>
            <tbody>${g.txs.map(t => txRow(t, false)).join('')}</tbody>
          </table>
        </div>
      </div>
    </div>`;
  }).join('');
}

function toggleTxGroup(k) {
  const body = document.getElementById('txGroupBody-'+k);
  const arrow = document.getElementById('txGroupToggle-'+k);
  const card = document.getElementById('txGroup-'+k);
  const collapsed = body.style.display === 'none';
  body.style.display = collapsed ? '' : 'none';
  if(arrow) arrow.style.transform = collapsed ? '' : 'rotate(-90deg)';
  if(card) card.classList.toggle('tx-group-card--collapsed', !collapsed);
}

function changePage(dir){state.txPage+=dir;loadTransactions();}
async function openTransactionModal(id=''){
  // Ensure family composition is loaded so the member picker renders with actual members
  if (typeof loadFamilyComposition === 'function' && typeof _fmc !== 'undefined' && !_fmc.loaded) {
    await loadFamilyComposition().catch(() => {});
  }
  resetTxModal();
  document.getElementById('txDate').value=new Date().toISOString().slice(0,10);
  document.getElementById('txModalTitle').textContent='Nova Transação';
  if(id) {
    editTransaction(id);
  } else {
    // Pre-select the account that is currently filtered (single-account filter only)
    const filteredAccId = state.txFilter?.account || '';
    if (filteredAccId) {
      const sel = document.getElementById('txAccountId');
      if (sel) {
        sel.value = filteredAccId;
        // Trigger all side-effects: IOF check, currency panel, etc.
        _onTxSourceAccountChange(filteredAccId);
      }
    }
    openModal('txModal');
  if (typeof initTxFormMode === 'function') initTxFormMode();
  }
}
function resetTxModal(){
  ['txId','txDesc','txMemo','txTags'].forEach(f=>document.getElementById(f).value='');
  const stEl=document.getElementById('txStatus'); if(stEl) stEl.value='confirmed';
  setAmtField('txAmount', 0);
  document.getElementById('txTypeField').value='expense';
  _hideTxCurrencyPanel();
  setTxType('expense');clearPayeeField('tx');hideCatSuggestion();setCatPickerValue(null);
  // Always populate full currency list on open — user can pick currency before selecting account
  _rebuildTxCurrencySelect('BRL', 'BRL');
  // Reset attachment — clear pending file AND all UI state
  window._txPendingFile = null;
  window._txPendingName = null;
  document.getElementById('txAttachUrl').value = '';
  document.getElementById('txAttachNameHidden').value = '';
  try { document.getElementById('txAttachFile').value = ''; } catch(e) {}
  document.getElementById('txAttachPreview').style.display = 'none';
  document.getElementById('txAttachArea').style.display = '';
  // Reset IA de recibo
  if (typeof resetReceiptAI === 'function') resetReceiptAI();
  const oldThumb = document.getElementById('txAttachThumb');
  if (oldThumb) oldThumb.remove();
  // Reset IOF
  const iofCb = document.getElementById('txIsInternational');
  if(iofCb) iofCb.checked = false;
  document.getElementById('txIofMirrorInfo').classList.remove('visible');
  document.getElementById('txIofGroup').style.display='none';
  // Render family member multi-picker (cleared state)
  if (typeof renderFmcMultiPicker === 'function') {
    renderFmcMultiPicker('txFamilyMemberPicker', { selected: [] });
  }
  // Reset AI payee suggestion
  _dismissAiPayeeSuggestion();
  _dismissAiAccountSuggestion();
  _dismissAiMemberSuggestion();
}
async function editTransaction(id){
  const{data,error}=await sb.from('transactions').select('*').eq('id',id).single();if(error){toast(error.message,'error');return;}
  document.getElementById('txId').value=data.id;document.getElementById('txDate').value=data.date;setAmtField('txAmount', data.amount);document.getElementById('txDesc').value=data.description||'';document.getElementById('txAccountId').value=data.account_id||'';setCatPickerValue(data.category_id||null);document.getElementById('txMemo').value=data.memo||'';document.getElementById('txTags').value=(data.tags||[]).join(', ');setPayeeField(data.payee_id||null,'tx');
  // Load attachment if exists
  if (data.attachment_url) {
    document.getElementById('txAttachUrl').value        = data.attachment_url;
    document.getElementById('txAttachNameHidden').value = data.attachment_name || '';
    showAttachmentPreview(data.attachment_url, data.attachment_name || 'Anexo');
  }
  // Check IOF config for account
  setTimeout(()=>checkAccountIofConfig(data.account_id), 50);
  const type=data.is_transfer?(data.is_card_payment?'card_payment':'transfer'):data.amount>=0?'income':'expense';setTxType(type);if(type==='transfer'||type==='card_payment')document.getElementById('txTransferTo').value=data.transfer_to_account_id||'';
  document.getElementById('txModalTitle').textContent='Editar Transação';
  // Render family member multi-picker
  if (typeof renderFmcMultiPicker === 'function') {
    const preselected = data?.family_member_ids?.length
      ? data.family_member_ids
      : (data?.family_member_id ? [data.family_member_id] : []);
    renderFmcMultiPicker('txFamilyMemberPicker', { selected: preselected });
  }
  // Restore currency panel state after DOM settles
  setTimeout(() => {
    const type = document.getElementById('txTypeField').value;
    const accId = document.getElementById('txAccountId').value;
    if (type !== 'transfer' && type !== 'card_payment') {
      _updateTxCurrencyPanel(accId);
      // If the saved transaction had a currency rate, restore it
      if (data.currency && data.currency !== 'BRL' && data.brl_amount) {
        const impliedRate = Math.abs(data.brl_amount / (data.amount || 1));
        const rateInput = document.getElementById('txCurrencyRate');
        if (rateInput && impliedRate > 0) rateInput.value = impliedRate.toFixed(6);
        updateTxCurrencyPreview();
      }
    }
  }, 80);
  // Clear any pending debt amortization state from previous modal use
  window._pendingAmortDebtId = null;
  const _dab = document.getElementById('debtAmortizationBanner');
  if (_dab) { _dab.style.display = 'none'; _dab.innerHTML = ''; }
  openModal('txModal');
  if (typeof initTxFormMode === 'function') initTxFormMode();
}
function _filterTxAccountOrigin(excludeCreditCards) {
  const sel = document.getElementById('txAccountId');
  if (!sel || !state.accounts) return;
  const currentVal = sel.value;
  const accounts = excludeCreditCards
    ? state.accounts.filter(a => a.type !== 'cartao_credito')
    : state.accounts;
  sel.innerHTML = (typeof _accountOptions === 'function')
    ? _accountOptions(accounts, 'Selecione a conta')
    : '<option value="">Selecione a conta</option>' +
      accounts.map(a => `<option value="${a.id}">${esc(a.name)} (${a.currency})</option>`).join('');
  sel.value = currentVal || '';
  if (excludeCreditCards && currentVal) {
    const acct = state.accounts.find(a => a.id === currentVal);
    if (acct && acct.type === 'cartao_credito') sel.value = '';
  }
}


function setTxType(type){
  document.getElementById('txTypeField').value=type;
  // card_payment is visually shown as 'transfer' tab
  const activeTab = type;
  document.querySelectorAll('#txTypeTabs .tab').forEach((t,i)=>t.classList.toggle('active',['expense','income','transfer','card_payment'][i]===activeTab));
  const isTransfer = type==='transfer' || type==='card_payment';
  const isCardPayment = type==='card_payment';
  const isPureTransfer = type==='transfer';
  document.getElementById('txTransferToGroup').style.display=isTransfer?'':'none';
  document.getElementById('txPayeeGroup').style.display=isTransfer?'none':'';
  // Show category for expense, income and card_payment; hide only for pure transfer
  document.getElementById('txCategoryGroup').style.display=isPureTransfer?'none':'';
  // Show/hide card payment label
  const cpBadge = document.getElementById('txCardPaymentBadge');
  if(cpBadge) cpBadge.style.display = isCardPayment ? '' : 'none';
  const transferToLabel = document.querySelector('#txTransferToGroup label');
  if(transferToLabel) transferToLabel.textContent = isCardPayment ? 'Cartão de Crédito (Destino) *' : 'Conta Destino *';
  // Filter source account: card_payment origin cannot be a credit card account
  _filterTxAccountOrigin(isCardPayment);
  // Rebuild category picker filtered by transaction type
  buildCatPicker();
  // Auto-classify card_payment into "Cartão de Crédito" category
  if (isCardPayment) {
    _txAutoSetCardPaymentCategory();
  }
  // Hide FX panel when switching away from transfer
  if(!isTransfer) {
    _hideFxPanel();
    // Re-evaluate currency panel for the selected account
    const accId = document.getElementById('txAccountId')?.value;
    if (accId) _updateTxCurrencyPanel(accId);
  } else {
    _hideTxCurrencyPanel();
  }
}

/**
 * Auto-classifica pagamento de cartão na categoria "Cartão de Crédito".
 * Se não existir, exibe banner pedindo que o usuário crie a categoria.
 */
function _txAutoSetCardPaymentCategory() {
  const cats = state.categories || [];
  // Procurar a categoria pelo nome (case-insensitive)
  const CC_NAMES = ['cartão de crédito', 'cartao de credito', 'pagamento cartão', 'pagamento cartao', 'cartão'];
  const ccCat = cats.find(c =>
    CC_NAMES.some(n => c.name.toLowerCase().replace(/[áàãâ]/g,'a').replace(/[éê]/g,'e').replace(/[ó]/g,'o').replace(/[ç]/g,'c') === n)
  );

  // Remover banner anterior se existir
  document.getElementById('_txCardPayCatBanner')?.remove();

  if (ccCat) {
    // Categoria encontrada — selecionar automaticamente
    setCatPickerValue(ccCat.id, 'tx');
    return;
  }

  // Categoria não encontrada — exibir banner para criar
  const catGroup = document.getElementById('txCategoryGroup');
  if (!catGroup) return;

  // Limpar seleção atual
  setCatPickerValue(null, 'tx');

  const banner = document.createElement('div');
  banner.id = '_txCardPayCatBanner';
  banner.style.cssText = `
    margin-top: 8px; padding: 11px 14px;
    background: var(--amber-lt, #fffbeb);
    border: 1.5px solid var(--amber, #b45309);
    border-radius: 10px;
    display: flex; align-items: flex-start; gap: 10px;
    font-size: .80rem; color: #78350f; line-height: 1.5;
  `;
  banner.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" style="flex-shrink:0;margin-top:1px;color:#b45309"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    <div style="flex:1;min-width:0">
      <div style="font-weight:700;margin-bottom:3px">Categoria "Cartão de Crédito" não encontrada</div>
      <div style="margin-bottom:8px">Para pagamentos de cartão, crie esta categoria uma vez para manter os relatórios organizados.</div>
      <button type="button" onclick="_txCreateCardPaymentCategory()" style="
        padding:6px 14px; background:var(--amber,#b45309); color:#fff; border:none;
        border-radius:7px; font-size:.78rem; font-weight:700; cursor:pointer;
        font-family:inherit; display:inline-flex; align-items:center; gap:5px;
      ">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Criar categoria agora
      </button>
    </div>`;
  catGroup.appendChild(banner);
}

/**
 * Cria a categoria "Cartão de Crédito" do tipo despesa e a seleciona.
 */
async function _txCreateCardPaymentCategory() {
  const btn = document.querySelector('#_txCardPayCatBanner button');
  if (btn) { btn.disabled = true; btn.textContent = 'Criando…'; }
  try {
    const payload = {
      family_id: famId(),
      name: 'Cartão de Crédito',
      type: 'despesa',
      icon: '💳',
      color: '#1d4ed8',
      parent_id: null,
      is_elastic: false,
    };
    const { data, error } = await famQ(sb.from('categories').insert(payload).select().single());
    if (error) throw error;
    // Adicionar ao state local
    if (state.categories) state.categories.push(data);
    // Reconstruir picker e selecionar
    buildCatPicker();
    setCatPickerValue(data.id, 'tx');
    document.getElementById('_txCardPayCatBanner')?.remove();
    toast('✅ Categoria "Cartão de Crédito" criada e selecionada!', 'success');
  } catch(e) {
    toast('Erro ao criar categoria: ' + (e.message || e), 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Criar categoria agora'; }
  }
}
window._txAutoSetCardPaymentCategory  = _txAutoSetCardPaymentCategory;
window._txCreateCardPaymentCategory   = _txCreateCardPaymentCategory;

// ── FX / Exchange-rate helpers ─────────────────────────────────────────────

// frankfurter.dev/v1: free, no key, CORS-correct, ECB data
// Endpoint: GET https://api.frankfurter.dev/v1/YYYY-MM-DD?base=EUR&to=BRL
// FX_API_BASE is set by fx_rates.js (loaded before this file); fallback here for safety
const FX_API_BASE = window.FX_API_BASE || 'https://api.frankfurter.dev/v1';

function _getTransferCurrencies() {
  const srcId  = document.getElementById('txAccountId').value;
  const dstId  = document.getElementById('txTransferTo').value;
  const srcAcc = state.accounts.find(a => a.id === srcId);
  const dstAcc = state.accounts.find(a => a.id === dstId);
  return {
    src: srcAcc?.currency || 'BRL',
    dst: dstAcc?.currency || 'BRL',
    srcName: srcAcc?.name || '',
    dstName: dstAcc?.name || '',
  };
}

function _hideFxPanel() {
  const panel = document.getElementById('txFxPanel');
  if (panel) panel.style.display = 'none';
}

function onTransferAccountChange() {
  const { src, dst } = _getTransferCurrencies();
  const panel = document.getElementById('txFxPanel');
  if (!panel) return;

  if (!src || !dst || src === dst) {
    panel.style.display = 'none';
    return;
  }

  // Show the panel and update labels
  panel.style.display = '';
  const title = document.getElementById('txFxTitle');
  const label = document.getElementById('txFxLabel');
  if (title) title.textContent = `Câmbio: ${src} → ${dst}`;
  if (label) label.textContent = `(1 ${src} = ? ${dst})`;

  // Reset suggestion and preview
  const sugg = document.getElementById('txFxSuggestion');
  if (sugg) sugg.style.display = 'none';
  const preview = document.getElementById('txFxPreview');
  if (preview) preview.textContent = '';

  // Auto-fetch the suggestion
  fetchSuggestedFxRate();
}

// Also re-check when source account changes
function _onTxSourceAccountChange(accountId) {
  checkAccountIofConfig(accountId);
  const type = document.getElementById('txTypeField').value;
  if (type === 'transfer' || type === 'card_payment') {
    onTransferAccountChange();
  } else {
    _updateTxCurrencyPanel(accountId);
  }
}

// ── Currency helpers for regular expense/income transactions ──────────────

/** Returns the account currency for the currently selected account */
function _getTxAccountCurrency() {
  const accId = document.getElementById('txAccountId')?.value;
  const acc   = (state.accounts || []).find(a => a.id === accId);
  return acc?.currency || 'BRL';
}

/** Returns the transaction currency chosen by user (may differ from account currency) */
function _getTxSelectedCurrency() {
  const sel = document.getElementById('txCurrencySelect');
  return (sel && sel.value) ? sel.value : _getTxAccountCurrency();
}

function _hideTxCurrencyPanel() {
  const p = document.getElementById('txCurrencyPanel');
  if (p) p.style.display = 'none';
}

/** Rebuilds the currency selector keeping accountCurrency as first option */
function _rebuildTxCurrencySelect(accountCur, selectedCur) {
  const sel = document.getElementById('txCurrencySelect');
  if (!sel) return;
  const CURRENCIES = ['BRL','USD','EUR','GBP','AED','ARS','CAD','CHF','JPY','MXN','CLP','COP','PEN','UYU'];
  const list = [...new Set([accountCur, ...CURRENCIES])];
  sel.innerHTML = list.map(c =>
    `<option value="${c}"${c===(selectedCur||accountCur)?' selected':''}>${c}</option>`
  ).join('');
}

/** Updates currency panel and badge whenever account or currency changes */
function _updateTxCurrencyPanel(accountId, forceCur) {
  const acc        = (state.accounts || []).find(a => a.id === accountId);
  const accountCur = acc?.currency || 'BRL';

  // Build or reset the selector
  const currentSel = forceCur || _getTxSelectedCurrency();
  _rebuildTxCurrencySelect(accountCur, currentSel);

  const txCur  = _getTxSelectedCurrency();
  const badge  = document.getElementById('txCurrencyBadge');
  if (badge) badge.textContent = txCur;

  const panel  = document.getElementById('txCurrencyPanel');
  if (!panel) return;

  // Show panel when:
  //   (a) tx currency differs from account currency  (e.g. USD tx on BRL account)
  //   (b) account itself is non-BRL                  (e.g. USD tx on USD account → still need BRL rate for reports/patrimony)
  const needsConversion = !!accountId && (txCur !== accountCur || accountCur !== 'BRL');
  if (!needsConversion) {
    panel.style.display = 'none';
  } else {
    panel.style.display = '';
    const title     = document.getElementById('txCurrencyPanelTitle');
    const fromLabel = document.getElementById('txCurrencyRateFromLabel');
    const toLabel   = document.getElementById('txCurrencyRateToLabel');
    // Determine "from" currency for display: if tx cur !== account cur, show tx→account; else show account→BRL
    const dispFrom = (txCur !== accountCur) ? txCur : accountCur;
    const dispTo   = (txCur !== accountCur) ? accountCur : 'BRL';
    if (title)     title.textContent = `Conversão: ${dispFrom} → ${dispTo}`;
    if (fromLabel) fromLabel.textContent = dispFrom;
    if (toLabel)   toLabel.textContent   = dispTo;
    const sugg = document.getElementById('txCurrencySuggestion');
    if (sugg) sugg.style.display = 'none';
    const preview = document.getElementById('txCurrencyPreview');
    if (preview) preview.textContent = '';
    fetchTxCurrencyRate();
  }

  // Feature 2: auto-trigger IOF when credit card + currencies differ
  checkAccountIofConfig(accountId, txCur);
}

/** Called when user picks a different transaction currency */
function onTxCurrencyChange() {
  const accId = document.getElementById('txAccountId')?.value;
  _updateTxCurrencyPanel(accId);
}

function onTxAmountInput() {
  if (document.getElementById('txIsInternational')?.checked) updateIofMirror();
  updateTxCurrencyPreview();
}

function updateTxCurrencyPreview() {
  const accountCur = _getTxAccountCurrency();
  const txCur      = _getTxSelectedCurrency();
  const panel      = document.getElementById('txCurrencyPanel');
  if (!panel || panel.style.display === 'none') return;

  // Determine target currency for display: if currencies differ → accountCur; else → BRL
  const targetCur = (txCur !== accountCur) ? accountCur : 'BRL';

  const rateVal = parseFloat(document.getElementById('txCurrencyRate')?.value?.replace(',', '.'));
  const amtVal  = getAmtField('txAmount') || 0;
  const preview = document.getElementById('txCurrencyPreview');
  const hint    = document.getElementById('txCurrencyBrlHint');
  if (!rateVal || isNaN(rateVal) || !amtVal) {
    if (preview) preview.textContent = '';
    if (hint) hint.textContent = '—';
    return;
  }
  const converted = amtVal * rateVal;
  if (preview) preview.textContent = `= ${fmt(converted, targetCur)}`;
  if (hint) hint.textContent = fmt(converted, targetCur);
}

async function fetchTxCurrencyRate() {
  const accountCur = _getTxAccountCurrency();
  const txCur      = _getTxSelectedCurrency();
  // For same-currency non-BRL accounts we need to fetch accountCur→BRL
  const fetchFrom = (txCur !== accountCur) ? txCur : accountCur;
  const fetchTo   = (txCur !== accountCur) ? accountCur : 'BRL';
  if (!fetchFrom || fetchFrom === fetchTo) return;

  const btn  = document.getElementById('txCurrencyFetchBtn');
  const icon = document.getElementById('txCurrencyFetchIcon');
  const sugg = document.getElementById('txCurrencySuggestion');
  if (btn)  btn.disabled = true;
  if (icon) icon.textContent = '⏳';
  if (sugg) sugg.style.display = 'none';

  try {
    let txDate = document.getElementById('txDate')?.value || new Date().toISOString().slice(0,10);
    const todayStr = new Date().toISOString().slice(0,10);
    if (txDate > todayStr) txDate = todayStr;

    const url = `${FX_API_BASE}/${txDate}?base=${fetchFrom}&to=${fetchTo}`;
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const rate = json?.rates?.[fetchTo];
    if (!rate) throw new Error('Taxa não encontrada');

    const usedDate = json.date || txDate;
    const rateStr  = Number(rate).toFixed(6);
    const rateInput = document.getElementById('txCurrencyRate');
    if (rateInput) rateInput.value = rateStr;
    if (sugg) {
      sugg.textContent = `📡 Cotação de ${usedDate} (BCE): 1 ${fetchFrom} = ${rateStr} ${fetchTo}`;
      sugg.style.display = '';
      sugg.style.background = '';
      sugg.style.color = '';
    }
    updateTxCurrencyPreview();
    // Atualiza preview de IOF se marcado
    if (document.getElementById('txIsInternational')?.checked) updateIofMirror();
  } catch (e) {
    if (sugg) {
      sugg.textContent = `⚠️ Não foi possível buscar: ${e.message}. Informe a taxa manualmente.`;
      sugg.style.display = '';
      sugg.style.background = '#fef9c3';
      sugg.style.color = '#92400e';
    }
  } finally {
    if (btn)  btn.disabled = false;
    if (icon) icon.textContent = '🔄';
  }
}


// tx-row-target and tx-row-new styles live in style.css
function _ensureTxFocusStyles(){ /* styles in CSS */ }

async function _goToSavedTransaction(txId, txData = {}) {
  if (!txId) return;

  // Navigate to transactions page
  try {
    if (typeof navigate === 'function') navigate('transactions');
    else state.currentPage = 'transactions';
  } catch (_) {}

  try { setTxView('flat'); } catch (_) {}

  // Set filters to show the month of the saved transaction with no other filters
  // Filter to the account of the saved transaction so only that account's
  // transactions are shown — the new row is highlighted within its context
  const savedAccountId = txData?.account_id || '';

  state.txFilter = state.txFilter || {};
  state.txFilter.search  = '';
  state.txFilter.account = savedAccountId;
  state.txFilter.type    = '';
  state.txFilter.month   = txData?.date ? String(txData.date).slice(0, 7) : (state.txFilter.month || '');
  state.txFilter.status  = (txData?.status || 'confirmed') === 'pending' ? 'pending' : '';
  state.txSortField = 'date';
  state.txSortAsc   = false;
  state.txPage      = 0;

  // Sync filter UI
  const monthEl  = document.getElementById('txMonth');
  const accEl    = document.getElementById('txAccount');
  const typeEl   = document.getElementById('txType');
  const statEl   = document.getElementById('txStatusFilter');
  const searchEl = document.getElementById('txSearch');
  if (monthEl)  monthEl.value  = state.txFilter.month || '';
  if (accEl)    accEl.value    = savedAccountId;
  if (typeEl)   typeEl.value   = '';
  if (statEl)   statEl.value   = state.txFilter.status || '';
  if (searchEl) searchEl.value = '';

  // Load the page — row will now be in the DOM
  try { await loadTransactions(); } catch (_) {}

  // First scroll the content area to top so the highlight scroll is predictable
  const _contentEl = document.querySelector('.content') || document.getElementById('page-transactions');
  if (_contentEl) _contentEl.scrollTop = 0;

  // Highlight and scroll to the saved row
  _highlightNewTxRow(txId);
}

function _highlightNewTxRow(txId) {
  const attempt = (tries) => {
    const row = document.querySelector(`[data-tx-id="${txId}"]`);
    if (row) {
      // Scroll into view with some breathing room at top
      row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      // Add entrance animation class
      row.classList.remove('tx-row-new'); // reset if already there
      void row.offsetWidth;               // force reflow to restart animation
      row.classList.add('tx-row-new');
      // Remove after animation completes
      setTimeout(() => row.classList.remove('tx-row-new'), 3000);
      return true;
    }
    if (tries > 0) setTimeout(() => attempt(tries - 1), 150);
    return false;
  };
  // Try immediately, then retry a few times in case render is async
  requestAnimationFrame(() => attempt(4));
}

async function fetchSuggestedFxRate() {
  const { src, dst } = _getTransferCurrencies();
  if (!src || !dst || src === dst) return;

  const btn  = document.getElementById('txFxFetchBtn');
  const icon = document.getElementById('txFxFetchIcon');
  const sugg = document.getElementById('txFxSuggestion');
  if (btn)  { btn.disabled = true; }
  if (icon) { icon.textContent = '⏳'; }
  if (sugg) { sugg.style.display = 'none'; }

  try {
    // Use the transaction date for historical rate; fall back to today.
    // Frankfurter uses weekday rates — if date is a weekend it returns the
    // closest prior business day automatically.
    let txDate = document.getElementById('txDate').value ||
      new Date().toISOString().slice(0, 10);

    // Frankfurter does not serve future dates — cap to today
    const todayStr = new Date().toISOString().slice(0, 10);
    if (txDate > todayStr) txDate = todayStr;

    // GET /YYYY-MM-DD?base=SRC&to=DST
    const url = `${FX_API_BASE}/${txDate}?base=${src}&to=${dst}`;
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    // Response: { "base": "EUR", "date": "2026-03-06", "rates": { "BRL": 6.1234 } }
    const rate = json?.rates?.[dst];
    if (!rate) throw new Error('Taxa não encontrada na resposta');

    const usedDate = json.date || txDate; // frankfurter returns actual business day used
    const rateStr  = Number(rate).toFixed(6);

    const rateInput = document.getElementById('txFxRate');
    if (rateInput) rateInput.value = rateStr;

    if (sugg) {
      sugg.textContent = `📡 Cotação de ${usedDate} (BCE): 1 ${src} = ${rateStr} ${dst}`;
      sugg.style.display  = '';
      sugg.style.background = '';
      sugg.style.color      = '';
    }

    updateFxPreview();

  } catch(e) {
    if (sugg) {
      sugg.textContent = `⚠️ Não foi possível buscar a cotação: ${e.message}. Informe a taxa manualmente.`;
      sugg.style.display = '';
      sugg.style.background = '#fef9c3';
      sugg.style.color = '#92400e';
    }
  } finally {
    if (btn)  { btn.disabled = false; }
    if (icon) { icon.textContent = '🔄'; }
  }
}

function updateFxPreview() {
  const { src, dst } = _getTransferCurrencies();
  const rateVal  = parseFloat(document.getElementById('txFxRate')?.value?.replace(',', '.'));
  const amtVal   = getAmtField('txAmount');
  const preview  = document.getElementById('txFxPreview');
  if (!preview) return;
  if (!rateVal || isNaN(rateVal) || !amtVal) { preview.textContent = ''; return; }
  const converted = (Math.abs(amtVal) * rateVal);
  preview.textContent = `= ${fmt(converted, dst)}`;
}

// ── Duplicate confirmation dialog ────────────────────────────────────────────
async function _txDupConfirm({ payeeName, catLabel, amtFmt, dateLabel }) {
  return new Promise(resolve => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:19999;display:flex;align-items:center;justify-content:center;padding:24px';
    d.innerHTML = `
      <div style="background:var(--surface);border-radius:var(--r-lg);padding:0;max-width:420px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,.35);overflow:hidden">
        <div style="background:linear-gradient(135deg,#b45309,#d97706);padding:18px 20px;display:flex;align-items:center;gap:12px">
          <span style="font-size:1.6rem">⚠️</span>
          <div>
            <div style="color:#fff;font-size:.95rem;font-weight:800;line-height:1.2">Possível transação duplicada</div>
            <div style="color:rgba(255,255,255,.75);font-size:.75rem;margin-top:2px">Já existe um lançamento com os mesmos dados</div>
          </div>
        </div>
        <div style="padding:20px">
          <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r-sm);padding:14px 16px;margin-bottom:16px;font-size:.84rem">
            <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 12px;color:var(--text2)">
              <span style="color:var(--muted);font-weight:600">Beneficiário</span><span>${esc(payeeName)}</span>
              <span style="color:var(--muted);font-weight:600">Categoria</span><span>${esc(catLabel)}</span>
              <span style="color:var(--muted);font-weight:600">Valor</span><span style="font-weight:700;color:var(--text)">${esc(amtFmt)}</span>
              <span style="color:var(--muted);font-weight:600">Data</span><span>${esc(dateLabel)}</span>
            </div>
          </div>
          <div style="font-size:.82rem;color:var(--muted);margin-bottom:18px;line-height:1.6">
            Um lançamento com os mesmos dados já existe. Tem certeza que deseja registrar novamente?
          </div>
          <div style="display:flex;gap:10px">
            <button id="_dupNo2" style="flex:1;padding:12px;border-radius:var(--r-sm);border:1.5px solid var(--border);background:var(--surface);color:var(--text);font-family:var(--font-sans);font-size:.9rem;font-weight:600;cursor:pointer">
              Cancelar
            </button>
            <button id="_dupYes2" style="flex:1;padding:12px;border-radius:var(--r-sm);border:none;background:var(--amber,#d97706);color:#fff;font-family:var(--font-sans);font-size:.9rem;font-weight:700;cursor:pointer">
              Lançar mesmo assim
            </button>
          </div>
        </div>
      </div>`;
    d.querySelector('#_dupNo2').onclick  = () => { d.remove(); resolve(false); };
    d.querySelector('#_dupYes2').onclick = () => { d.remove(); resolve(true);  };
    document.body.appendChild(d);
  });
}

// ── Duplicate transaction guard ─────────────────────────────────────────────
let _txSaving = false; // re-entrancy guard against concurrent double-clicks

async function saveTransaction(){
  // ── Duplicate detection ──────────────────────────────────────────────────
  const _isEdit = !!document.getElementById('txId').value;

  // Hard guard: block concurrent saves (button clicked again while save is running)
  if (_txSaving && !_isEdit) return;

  if (!_isEdit) {
    const _date      = document.getElementById('txDate').value;
    const _accountId = document.getElementById('txAccountId').value;
    const _amount    = Math.abs(getAmtField('txAmount'));
    const _payeeId   = document.getElementById('txPayeeId').value   || null;
    const _catId     = document.getElementById('txCategoryId').value || null;
    const _desc      = document.getElementById('txDesc').value.trim();
    const _type      = document.getElementById('txTypeField').value;

    // Query DB for an existing transaction matching all key fields on same date
    if (_date && _accountId && _amount > 0) {
      try {
        let q = famQ(sb.from('transactions').select('id,description,amount,payee_id,category_id'))
          .eq('date', _date)
          .eq('account_id', _accountId)
          .eq('is_transfer', _type === 'transfer' || _type === 'card_payment');

        // Match amount (stored as negative for expenses)
        const _storedAmt = (_type === 'expense' || _type === 'transfer' || _type === 'card_payment')
          ? -_amount : _amount;
        q = q.gte('amount', _storedAmt - 0.01).lte('amount', _storedAmt + 0.01);

        const { data: existing } = await q.limit(5);

        if (existing && existing.length > 0) {
          // Check if any match on payee + category + description
          const match = existing.find(e => {
            const samePayee    = !_payeeId || !e.payee_id    || e.payee_id    === _payeeId;
            const sameCat      = !_catId   || !e.category_id || e.category_id === _catId;
            const sameDesc     = !_desc    || !e.description  || e.description.toLowerCase() === _desc.toLowerCase();
            return samePayee && sameCat && sameDesc;
          });

          if (match) {
            // Build human-readable summary of the duplicate
            const payeeName = document.getElementById('txPayeeName')?.value?.trim() || '—';
            const catLabel  = document.getElementById('catPickerLabel')?.textContent?.replace(/^—.*—$/, '').trim() || '—';
            const amtFmt    = typeof fmt === 'function' ? fmt(_storedAmt) : _storedAmt.toFixed(2);
            const dateLabel = _date;

            const confirmed = await _txDupConfirm({ payeeName, catLabel, amtFmt, dateLabel });
            if (!confirmed) return;
          }
        }
      } catch(e) {
        console.debug('[dup-check]', e.message); // non-fatal — proceed on error
      }
    }
  }
  _txSaving = true;
  // ── End duplicate detection ──────────────────────────────────────────────

  const id=document.getElementById('txId').value,type=document.getElementById('txTypeField').value;
  let amount=getAmtField('txAmount');
  const isTransfer = type==='transfer' || type==='card_payment';
  const isCardPayment = type==='card_payment';
  if(type==='expense')amount=-Math.abs(amount);
  else if(type==='income')amount=Math.abs(amount);
  else if(isTransfer)amount=-Math.abs(amount); // debit origin account

  // ── FX: compute credited amount for destination when currencies differ ──
  let pairedAmount = Math.abs(amount); // default: 1:1 same amount
  if (isTransfer && !isCardPayment) {
    const { src, dst } = _getTransferCurrencies();
    if (src && dst && src !== dst) {
      const fxRate = parseFloat(document.getElementById('txFxRate')?.value?.replace(',', '.'));
      if (fxRate > 0) pairedAmount = Math.abs(amount) * fxRate;
    }
  }
  const tags=document.getElementById('txTags').value.split(',').map(s=>s.trim()).filter(Boolean);

  // Determine attachment fields for the DB record
  // Rules:
  //  • Pending new file  → keep existing URL in the row for now; upload will overwrite after save
  //  • Existing kept     → preserve url + name from hidden fields
  //  • Attachment removed → hidden fields are empty → null
  const hasPendingFile = !!window._txPendingFile;
  const existingUrl    = document.getElementById('txAttachUrl').value || null;
  const existingName   = document.getElementById('txAttachNameHidden').value || null;

  // Determine transaction currency — user may pick different currency than account (Feature 1)
  const _txSrcAccId = document.getElementById('txAccountId').value;
  const _txSrcAcc   = (state.accounts || []).find(a => a.id === _txSrcAccId);
  const accountCurrency = _txSrcAcc?.currency || 'BRL';
  const txCurrency  = _getTxSelectedCurrency?.() || accountCurrency;

  // Compute brl_amount:
  //   Case A: tx currency differs from account currency  → rate converts txCur → accountCur
  //   Case B: non-BRL account, same currency             → rate converts accountCur → BRL
  let brlAmount = null;
  if (!isTransfer) {
    const fxRate = parseFloat(document.getElementById('txCurrencyRate')?.value?.replace(',', '.'));
    if (fxRate > 0) {
      if (txCurrency !== accountCurrency) {
        // Case A: amount in txCurrency → accountCurrency; then if accountCurrency is also non-BRL we'd need another step,
        // but for now store the converted value (accountCur equivalent)
        brlAmount = amount * fxRate;
      } else if (accountCurrency !== 'BRL') {
        // Case B: amount is in accountCurrency → multiply by rate to get BRL
        brlAmount = amount * fxRate;
      }
    }
  }

  const txDescEl = document.getElementById('txDesc');
  let autoTxDesc = txDescEl?.value?.trim() || '';
  if (!autoTxDesc) {
    // Auto-generate from payee name + category name
    const payeeName    = document.getElementById('txPayeeName')?.value?.trim() || '';
    const catLabel     = document.getElementById('catPickerLabel')?.textContent?.trim() || '';
    const cleanCat     = catLabel.replace(/^—.*—$/, '').trim();
    if (payeeName && cleanCat && cleanCat.length > 0) {
      autoTxDesc = payeeName + ' — ' + cleanCat;
    } else if (payeeName) {
      autoTxDesc = payeeName;
    } else if (typeof ensureTransactionDescription === 'function') {
      autoTxDesc = (await ensureTransactionDescription(txDescEl)).trim();
    }
    if (txDescEl && autoTxDesc) txDescEl.value = autoTxDesc;
  }

  const data={
    date:document.getElementById('txDate').value,
    description:autoTxDesc,
    amount,
    currency: txCurrency,
    brl_amount: brlAmount,
    account_id:document.getElementById('txAccountId').value||null,
    payee_id:isTransfer?null:(document.getElementById('txPayeeId').value||null),
    category_id:document.getElementById('txCategoryId').value||null,
    memo:document.getElementById('txMemo').value,
    tags:tags.length?tags:null,
    status: (document.getElementById('txStatus')?.value || 'confirmed'),
    is_transfer:isTransfer,
    is_card_payment:isCardPayment,
    transfer_to_account_id:isTransfer?document.getElementById('txTransferTo').value||null:null,
    // Always write current attachment state; upload will overwrite if there's a pending file
    attachment_url:  existingUrl,
    attachment_name: existingName,
    updated_at:new Date().toISOString(),
    family_id:famId(),
    family_member_ids: typeof getFmcMultiPickerSelected === 'function'
      ? getFmcMultiPickerSelected('txFamilyMemberPicker')
      : [],
    family_member_id: (()=>{
      if (typeof getFmcMultiPickerSelected === 'function') {
        const ids = getFmcMultiPickerSelected('txFamilyMemberPicker');
        return ids[0] || null;
      }
      return document.getElementById('txFamilyMember')?.value || null;
    })()
  };
  if(!data.date||!data.account_id){toast(t('tx.err_date_account'),'error');return;}
  // Beneficiário obrigatório para não-transferências
  if(!isTransfer && !data.payee_id) {
    toast('Beneficiário / Fonte é obrigatório.','error');
    // Switch to Principal tab to show the field
    if(typeof switchTxTab==='function') {
      const btn = document.querySelector('[data-tab="txCtxPrincipal"]');
      if(btn) switchTxTab('txCtxPrincipal', btn);
    }
    setTimeout(()=>document.getElementById('txPayeeName')?.focus(),100);
    return;
  }
  // Categoria obrigatória para não-transferências
  if(!isTransfer && !data.category_id) {
    toast('Categoria é obrigatória.','error');
    if(typeof switchTxTab==='function') {
      const btn = document.querySelector('[data-tab="txCtxPrincipal"]');
      if(btn) switchTxTab('txCtxPrincipal', btn);
    }
    return;
  }
  let err,txResult;
  if(id){
    ({error:err}=await sb.from('transactions').update(data).eq('id',id));
    // If editing a transfer, update the paired leg too
    if(!err && isTransfer) {
      const {data:orig} = await sb.from('transactions').select('linked_transfer_id').eq('id',id).single();
      if(orig?.linked_transfer_id) {
        await sb.from('transactions').update({
          date: data.date,
          description: data.description,
          amount: pairedAmount,
          account_id: data.transfer_to_account_id,
          memo: data.memo,
          tags: data.tags,
          is_transfer: true,
          is_card_payment: data.is_card_payment,
          status: data.status,
          transfer_to_account_id: data.account_id,
          updated_at: new Date().toISOString(),
        }).eq('id', orig.linked_transfer_id);
      }
    }
  }
  else {
    ({data:txResult,error:err}=await sb.from('transactions').insert(data).select().single());
    // For new transfers, create the paired credit leg on the destination account
    if(!err && isTransfer && txResult?.id && data.transfer_to_account_id) {
      const pairedTx = {
        date: data.date,
        description: data.description,
        amount: pairedAmount,
        account_id: data.transfer_to_account_id,
        payee_id: null,
        category_id: data.category_id || null,
        memo: data.memo,
        tags: data.tags,
        is_transfer: true,
        is_card_payment: data.is_card_payment,
        status: data.status,
        transfer_to_account_id: data.account_id,
        updated_at: new Date().toISOString(),
        family_id: famId(),
      };
      // Try inserting with linked_transfer_id (requires migration_v3 to have been run)
      let pairedResult, pairedErr;
      ({data:pairedResult, error:pairedErr} = await sb.from('transactions')
        .insert({...pairedTx, linked_transfer_id: txResult.id}).select().single());
      // If column doesn't exist yet, retry without it
      if(pairedErr && pairedErr.message?.includes('linked_transfer_id')) {
        ({data:pairedResult, error:pairedErr} = await sb.from('transactions')
          .insert(pairedTx).select().single());
      }
      if(pairedErr) {
        toast('Transferência salva, mas erro ao criar lançamento de entrada: ' + pairedErr.message, 'warning');
      } else if(pairedResult?.id) {
        // Back-link origin row to paired row (best-effort)
        await sb.from('transactions').update({linked_transfer_id: pairedResult.id}).eq('id', txResult.id).then(()=>{}).catch(()=>{});
      }
    }
  }
  if(err){_txSaving = false; toast(err.message,'error');return;}

  // Create IOF mirror transaction if international (new transactions only)
  // Keep this BEFORE attachment upload. Otherwise an attachment upload failure would
  // skip the IOF launch even though the original transaction was already saved.
  const isIntl = document.getElementById('txIsInternational')?.checked;
  if(isIntl && !id && txResult?.id) {
    await createIofMirrorTx({ ...data, family_id: data.family_id || txResult.family_id || famId() }, txResult.id);
  }

  // Upload pending attachment BEFORE closing modal — keeps UX in sync
  const pendingFile = window._txPendingFile;
  const savedId     = id || txResult?.id;
  if (pendingFile && savedId) {
    const saveBtn = document.querySelector('#txModal .btn-primary');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ Enviando…'; }
    const uploadedUrl = await uploadTxAttachment(pendingFile, savedId);
    window._txPendingFile = null;
    window._txPendingName = null;
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Salvar'; }
    if (!uploadedUrl) {
      // Upload failed — transaction was saved. Existing attachment is preserved; warn the user.
      toast('⚠️ Transação salva, mas o anexo não foi enviado. Verifique o bucket "fintrack-attachments" no Supabase.', 'error');
      closeModal('txModal');
      if(!id && savedId) {
        await _goToSavedTransaction(savedId, { ...data, id: savedId, status: data.status, date: data.date });
      } else {
        if(state.currentPage==='transactions') await loadTransactions();
        if(state.currentPage==='dashboard') await loadDashboard();
      }
      return;
    }
  }
  DB.accounts.bust();
  try{await recalcAccountBalances();}catch(_e){}
  // Debt amortization: post credit entry to debt ledger (new transactions only)
  if (!id && txResult?.id && window._pendingAmortDebtId && typeof postDebtAmortizationEntry === 'function') {
    await postDebtAmortizationEntry(data.amount, data.date, txResult.id).catch(() => {});
  }
  _txSaving = false; // release guard
  toast(id?'✓ Atualizado!':'✓ Transação salva!','success');
  // Notify user on new transaction if enabled
  if (!id && savedId && typeof notifyOnTransaction === 'function') {
    notifyOnTransaction({ id: savedId, ...data }).catch(() => {});
  }
  closeModal('txModal');
  if(!id && savedId) {
    await _goToSavedTransaction(savedId, { ...data, id: savedId, status: data.status, date: data.date });
  } else {
    if(state.currentPage==='transactions') await loadTransactions();
    if(state.currentPage==='dashboard') await loadDashboard();
  }
}
async function duplicateTransaction(id) {
  if(!confirm('Duplicar transação? Ela será aberta para edição antes de salvar.')) return;
  const orig = state.transactions?.find(t=>t.id===id) ||
    await sb.from('transactions').select('*').eq('id',id).single().then(r => r.data);
  if (!orig) { toast(t('tx.not_found'),'error'); return; }
  _openTxAsCopy(orig);
}

function _openTxAsCopy(orig) {
  // Build a prefilled "new" transaction from orig — no ID, today's date
  const today = new Date().toISOString().slice(0,10);
  resetTxModal();
  document.getElementById('txDate').value = today;
  document.getElementById('txDesc').value = (orig.description || '') + ' (cópia)';
  document.getElementById('txAccountId').value = orig.account_id || '';
  setAmtField('txAmount', orig.amount || 0);
  setCatPickerValue(orig.category_id || null);
  setPayeeField(orig.payee_id || null, 'tx');
  document.getElementById('txMemo').value = orig.memo || '';
  document.getElementById('txTags').value = (orig.tags || []).join(', ');
  const stEl = document.getElementById('txStatus');
  if (stEl) stEl.value = orig.status || 'confirmed';
  const type = orig.is_transfer
    ? (orig.is_card_payment ? 'card_payment' : 'transfer')
    : (orig.amount >= 0 ? 'income' : 'expense');
  setTxType(type);
  if (type === 'transfer' || type === 'card_payment') {
    document.getElementById('txTransferTo').value = orig.transfer_to_account_id || '';
  }
  if (typeof renderFmcMultiPicker === 'function') {
    const pre = orig.family_member_ids?.length
      ? orig.family_member_ids
      : (orig.family_member_id ? [orig.family_member_id] : []);
    renderFmcMultiPicker('txFamilyMemberPicker', { selected: pre });
  }
  document.getElementById('txModalTitle').textContent = 'Nova Transação (cópia)';
  // txId stays empty → saveTransaction() will INSERT
  openModal('txModal');
  if (typeof initTxFormMode === 'function') initTxFormMode();
}
// ══════════════════════════════════════════════════════════════════════════════
//  SMART AI SUGGESTIONS ENGINE — v2
//  Single Gemini call returns payee + category + account + member together.
//  Also triggers when payee is selected (to suggest category).
//  Supports both 'tx' (transaction) and 'sc' (scheduled) contexts.
// ══════════════════════════════════════════════════════════════════════════════

const _aiSuggest = {
  timer:   { tx: null, sc: null },
  pending: { tx: null, sc: null },  // { payee, category, account, member }
  loading: { tx: false, sc: false },
};

// Keep legacy vars to avoid breaking any external references
let _aiPayeeTimer = null, _aiPayeePending = null;
let _aiAccountTimer = null, _aiAccountPending = null;
let _aiMemberTimer = null, _aiMemberPending = null;

// ── Entry points (called from HTML oninput / onblur) ─────────────────────────

function _aiSmartDebounce(val, ctx = 'tx') {
  if (_aiSuggest.timer[ctx]) clearTimeout(_aiSuggest.timer[ctx]);
  _aiHideSuggestPanel(ctx);
  if (!val || val.trim().length < 4) return;
  _aiSuggest.timer[ctx] = setTimeout(() => _aiSmartRun(val.trim(), ctx), 750);
}

function _aiSmartTrigger(val, ctx = 'tx') {
  if (!val || val.trim().length < 4) return;
  if (_aiSuggest.timer[ctx]) { clearTimeout(_aiSuggest.timer[ctx]); _aiSuggest.timer[ctx] = null; }
  _aiSmartRun(val.trim(), ctx);
}

// ── Core: build context and call Gemini (or fallback) ────────────────────────

async function _aiSmartRun(desc, ctx) {
  if (_aiSuggest.loading[ctx]) return;

  // Don't suggest fields already filled
  const payeeAlreadySet = !!document.getElementById(ctx + 'PayeeId')?.value;
  const catAlreadySet   = !!(ctx === 'tx'
    ? document.getElementById('txCategoryId')?.value
    : document.getElementById('scCategoryId')?.value);
  const accAlreadySet   = !!document.getElementById(ctx === 'tx' ? 'txAccountId' : 'scAccountId')?.value;
  const memberAlreadySet = ctx === 'tx'
    ? document.querySelectorAll('#txFamilyMemberPicker .fmc-pick-chip').length > 0
    : false;

  if (payeeAlreadySet && catAlreadySet && accAlreadySet && memberAlreadySet) return;

  _aiSuggest.loading[ctx] = true;
  try {
    const apiKey = await getAppSetting('gemini_api_key', '').catch(() => '');
    if (apiKey?.startsWith('AIza')) {
      await _aiSmartGemini(desc, ctx, { payeeAlreadySet, catAlreadySet, accAlreadySet, memberAlreadySet });
    } else {
      _aiSmartFallback(desc, ctx, { payeeAlreadySet, catAlreadySet, accAlreadySet, memberAlreadySet });
    }
  } catch (_) {
    _aiSmartFallback(desc, ctx, { payeeAlreadySet, catAlreadySet, accAlreadySet, memberAlreadySet });
  } finally {
    _aiSuggest.loading[ctx] = false;
  }
}

async function _aiSmartGemini(desc, ctx, flags) {
  const payees    = (state.payees    || []).slice(0, 100).map(p => p.name);
  const cats      = (state.categories || []).filter(c => c.type !== 'transferencia').slice(0, 80).map(c => c.name);
  const accounts  = (state.accounts  || []).slice(0, 20).map(a => a.name);
  const members   = typeof getFamilyMembers === 'function' ? getFamilyMembers().map(m => m.name) : [];

  // Build a minimal recent history snapshot for smarter matching
  const recentSnap = (state.transactions || []).slice(0, 60)
    .filter(t => t.description)
    .map(t => {
      const cat = (state.categories || []).find(c => c.id === t.category_id)?.name;
      const acc = (state.accounts   || []).find(a => a.id === t.account_id)?.name;
      const pay = (state.payees     || []).find(p => p.id === t.payee_id)?.name;
      return [t.description, pay, cat, acc].filter(Boolean).join('|');
    }).slice(0, 30).join('\n');

  const prompt = `You are a financial assistant helping fill a transaction form.

Transaction description typed by user: "${desc}"

Available data:
PAYEES: ${payees.join(', ') || 'none'}
CATEGORIES: ${cats.join(', ') || 'none'}
ACCOUNTS: ${accounts.join(', ') || 'none'}
FAMILY MEMBERS: ${members.join(', ') || 'none'}

Recent transaction history (desc|payee|category|account):
${recentSnap || 'none'}

Based on the description and history, suggest the BEST match for each field.
If no good match exists for a field, use null.
Respond ONLY with valid JSON, no explanation:
{
  "payee": "exact name from PAYEES list or null",
  "category": "exact name from CATEGORIES list or null",
  "account": "exact name from ACCOUNTS list or null",
  "member": "exact name from FAMILY MEMBERS list or null",
  "confidence": "high|medium|low"
}`;

  const apiKey = await getAppSetting('gemini_api_key', '');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${RECEIPT_AI_MODEL}:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 80, temperature: 0 },
    }),
  });
  if (!resp.ok) { _aiSmartFallback(desc, ctx, flags); return; }

  const json = await resp.json();
  let raw = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  // Strip markdown code fences if present
  raw = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();

  let result;
  try { result = JSON.parse(raw); } catch (_) { _aiSmartFallback(desc, ctx, flags); return; }

  _aiSmartApplySuggestions(result, ctx, flags);
}

function _aiSmartFallback(desc, ctx, flags) {
  // Pure client-side fallback — frequency analysis on recent transactions
  const words = desc.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
  if (!words.length) return;

  const recent = (state.transactions || []).slice(0, 300);
  const payeeScores = {}, catScores = {}, accScores = {}, memberScores = {};

  for (const tx of recent) {
    if (!tx.description) continue;
    const txWords = tx.description.toLowerCase().split(/\s+/);
    const matchCount = words.filter(w => txWords.some(tw => tw.includes(w) || w.includes(tw))).length;
    if (!matchCount) continue;
    const weight = matchCount;
    if (tx.payee_id)    payeeScores[tx.payee_id]   = (payeeScores[tx.payee_id]   || 0) + weight;
    if (tx.category_id) catScores[tx.category_id]  = (catScores[tx.category_id]  || 0) + weight;
    if (tx.account_id)  accScores[tx.account_id]   = (accScores[tx.account_id]   || 0) + weight;
    const mids = tx.family_member_ids?.length ? tx.family_member_ids : (tx.family_member_id ? [tx.family_member_id] : []);
    for (const mid of mids) memberScores[mid] = (memberScores[mid] || 0) + weight;
  }

  const topPayee  = Object.entries(payeeScores).sort((a,b)=>b[1]-a[1])[0];
  const topCat    = Object.entries(catScores).sort((a,b)=>b[1]-a[1])[0];
  const topAcc    = Object.entries(accScores).sort((a,b)=>b[1]-a[1])[0];
  const topMember = Object.entries(memberScores).sort((a,b)=>b[1]-a[1])[0];

  const payeeObj  = topPayee?.[1] >= 1 ? (state.payees    || []).find(p => p.id === topPayee[0])  : null;
  const catObj    = topCat?.[1]   >= 1 ? (state.categories|| []).find(c => c.id === topCat[0])    : null;
  const accObj    = topAcc?.[1]   >= 1 ? (state.accounts  || []).find(a => a.id === topAcc[0])    : null;
  const members   = typeof getFamilyMembers === 'function' ? getFamilyMembers() : [];
  const memberObj = topMember?.[1] >= 2 ? members.find(m => m.id === topMember[0]) : null;

  _aiSmartApplySuggestions({
    payee:    payeeObj?.name   || null,
    category: catObj?.name    || null,
    account:  accObj?.name    || null,
    member:   memberObj?.name || null,
    confidence: 'medium',
  }, ctx, flags);
}

function _aiSmartApplySuggestions(result, ctx, flags) {
  const suggestions = [];

  // Payee suggestion
  if (!flags.payeeAlreadySet && result.payee) {
    const matched = (state.payees || []).find(p =>
      p.name.toLowerCase() === result.payee.toLowerCase() ||
      p.name.toLowerCase().includes(result.payee.toLowerCase())
    );
    if (matched) {
      suggestions.push({
        type: 'payee', icon: '👤', label: 'Beneficiário',
        value: matched.name, id: matched.id,
        apply: () => {
          selectPayee(matched.id, matched.name, ctx);
          // After selecting payee, trigger category suggestion from payee history
          if (ctx === 'tx' && typeof suggestCategoryForPayee === 'function') {
            suggestCategoryForPayee(matched.id);
          }
        },
      });
    }
  }

  // Category suggestion
  if (!flags.catAlreadySet && result.category) {
    const matched = (state.categories || []).find(c =>
      c.name.toLowerCase() === result.category.toLowerCase() ||
      c.name.toLowerCase().includes(result.category.toLowerCase())
    );
    if (matched) {
      suggestions.push({
        type: 'category', icon: matched.icon || '📂', label: 'Categoria',
        value: matched.name, id: matched.id, color: matched.color,
        apply: () => {
          if (ctx === 'tx') {
            setCatPickerValue(matched.id);
            hideCatSuggestion();
          } else if (ctx === 'sc' && typeof setCatPickerValue === 'function') {
            setCatPickerValue(matched.id, 'sc');
          }
        },
      });
    }
  }

  // Account suggestion
  if (!flags.accAlreadySet && result.account) {
    const accSelId = ctx === 'tx' ? 'txAccountId' : 'scAccountId';
    const matched = (state.accounts || []).find(a =>
      a.name.toLowerCase() === result.account.toLowerCase() ||
      a.name.toLowerCase().includes(result.account.toLowerCase())
    );
    if (matched) {
      suggestions.push({
        type: 'account', icon: matched.icon || '🏦', label: 'Conta',
        value: matched.name, id: matched.id,
        apply: () => {
          const sel = document.getElementById(accSelId);
          if (sel) { sel.value = matched.id; sel.dispatchEvent(new Event('change')); }
        },
      });
    }
  }

  // Member suggestion (tx only for now)
  if (ctx === 'tx' && !flags.memberAlreadySet && result.member) {
    const members = typeof getFamilyMembers === 'function' ? getFamilyMembers() : [];
    const matched = members.find(m =>
      m.name.toLowerCase() === result.member.toLowerCase() ||
      m.name.toLowerCase().includes(result.member.toLowerCase())
    );
    if (matched) {
      suggestions.push({
        type: 'member', icon: '👤', label: 'Membro',
        value: matched.name, id: matched.id,
        apply: () => {
          if (typeof renderFmcMultiPicker === 'function') {
            renderFmcMultiPicker('txFamilyMemberPicker', { selected: [matched.id] });
          }
        },
      });
    }
  }

  if (!suggestions.length) return;

  _aiSuggest.pending[ctx] = suggestions;
  _aiRenderSuggestPanel(ctx, suggestions);
}

// ── Render the suggestion panel ───────────────────────────────────────────────

function _aiRenderSuggestPanel(ctx, suggestions) {
  const panelId = ctx + 'AiSuggestionsPanel';
  const chipsId = ctx + 'AiSuggestChips';
  const panel = document.getElementById(panelId);
  const chips = document.getElementById(chipsId);
  if (!panel || !chips) return;

  chips.innerHTML = suggestions.map((s, i) => {
    const colorStyle = s.color ? `border-left: 3px solid ${s.color}` : '';
    return `<div class="ai-suggest-chip" style="${colorStyle}">
      <span class="ai-suggest-chip-label">${s.label}</span>
      <button class="ai-suggest-chip-value" onclick="_aiApplySuggestion('${ctx}',${i})"
        title="Aplicar sugestão">
        ${s.icon} ${esc(s.value)}
      </button>
      <button class="ai-suggest-chip-dismiss" onclick="_aiDismissSuggestion('${ctx}',${i})"
        title="Ignorar">✕</button>
    </div>`;
  }).join('');

  panel.style.display = 'block';
}

function _aiHideSuggestPanel(ctx) {
  const panel = document.getElementById(ctx + 'AiSuggestionsPanel');
  if (panel) panel.style.display = 'none';
  _aiSuggest.pending[ctx] = null;
}

function _aiApplySuggestion(ctx, idx) {
  const suggestions = _aiSuggest.pending[ctx];
  if (!suggestions?.[idx]) return;
  suggestions[idx].apply();
  // Remove this chip from the panel
  suggestions.splice(idx, 1);
  if (!suggestions.length) {
    _aiHideSuggestPanel(ctx);
  } else {
    _aiRenderSuggestPanel(ctx, suggestions);
  }
}

function _aiDismissSuggestion(ctx, idx) {
  const suggestions = _aiSuggest.pending[ctx];
  if (!suggestions) return;
  suggestions.splice(idx, 1);
  if (!suggestions.length) {
    _aiHideSuggestPanel(ctx);
  } else {
    _aiRenderSuggestPanel(ctx, suggestions);
  }
}

function _aiDismissAll(ctx) {
  _aiHideSuggestPanel(ctx);
}

// ── Legacy compatibility shims (kept so old HTML references still work) ───────

function _aiPayeeDebounce(val)       { _aiSmartDebounce(val, 'tx'); }
function _aiAccountDebounce(val)     { /* absorbed into _aiSmartDebounce */ }
function _aiMemberDebounce(val)      { /* absorbed into _aiSmartDebounce */ }
function _aiSuggestPayeeFromDesc(v)  { _aiSmartTrigger(v, 'tx'); }
function _applyAiPayeeSuggestion()   { /* legacy — now handled by chip buttons */ }
function _dismissAiPayeeSuggestion() { _aiHideSuggestPanel('tx'); }
function _applyAiAccountSuggestion() { /* legacy */ }
function _dismissAiAccountSuggestion(){ _aiHideSuggestPanel('tx'); }
function _applyAiMemberSuggestion()  { /* legacy */ }
function _dismissAiMemberSuggestion(){ _aiHideSuggestPanel('tx'); }

// ── Trigger from payee selection (category suggestion based on payee history) ─

function _aiSuggestFromPayee(payeeId, ctx) {
  if (!payeeId || ctx !== 'tx') return;
  // suggestCategoryForPayee already called by selectPayee → handled there
}


async function deleteTransaction(id){
  if(!confirm('Excluir transação?'))return;
  // 1. Null out any scheduled_occurrence that references this transaction
  //    (avoids FK / check-constraint violations when the row is deleted)
  await sb.from('scheduled_occurrences').update({transaction_id:null}).eq('transaction_id',id);
  // 2. If this is one leg of a transfer, delete the paired leg too
  const {data:tx} = await sb.from('transactions').select('linked_transfer_id,is_transfer').eq('id',id).single();
  if(tx?.linked_transfer_id) {
    await sb.from('scheduled_occurrences').update({transaction_id:null}).eq('transaction_id',tx.linked_transfer_id);
    await sb.from('transactions').delete().eq('id',tx.linked_transfer_id);
  }
  // 3. Delete the transaction itself
  const{error}=await sb.from('transactions').delete().eq('id',id);
  if(error){toast(error.message,'error');return;}
  DB.accounts.bust();
  try{await recalcAccountBalances();}catch(_e){}
  toast(t('tx.deleted'),'success');
  loadTransactions();
  if(state.currentPage==='dashboard') loadDashboard();
}

/* ── Transaction Detail Drawer ── */
let _txDetailId = null;

async function openTxDetail(id) {
  _txDetailId = id;

  // Always fetch fresh from DB to get attachment_name and all joined fields
  const { data, error } = await sb.from('transactions')
    .select('*, accounts!transactions_account_id_fkey(name,currency,color,icon), payees(name), categories(name,color,icon), family_composition(id,name,avatar_emoji,member_type,birth_date)')
    .eq('id', id).single();
  if (error || !data) { toast(t('tx.not_found'), 'error'); return; }
  const t = data;

  // Cache current status for quick toggle actions
  window._txDetailStatus = (t.status || 'confirmed');

  const isIncome  = t.amount >= 0;
  const amtClass  = isIncome ? 'amount-pos' : 'amount-neg';
  const typeLabel = t.is_card_payment ? '💳 Pgto. Cartão' : t.is_transfer ? '🔄 Transferência' : isIncome ? '📈 Receita' : '📉 Despesa';
  const catColor  = t.categories?.color || 'var(--muted)';
  const accColor  = t.accounts?.color   || 'var(--accent)';

  // ── Attachment block ─────────────────────────────────────────────────────
  let attachHtml = '';
  if (t.attachment_url) {
    const isPdf   = _isAttachPdf(t.attachment_url, t.attachment_name);
    const isImage = _isAttachImage(t.attachment_url, t.attachment_name);
    const safeUrl = t.attachment_url.replace(/'/g, "\'");
    const safeName = esc(t.attachment_name || 'Anexo');
    const delMsg = 'Remover anexo?';
    const delBtn = `<button onclick="if(confirm('${delMsg}')){deleteTxAttachment('${t.id}','${safeUrl}').then(()=>{closeModal('txDetailModal');loadTransactions();})}" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:.78rem;padding:3px 8px;border:1px solid rgba(192,57,43,.3);border-radius:6px;display:flex;align-items:center;gap:4px" title="Remover anexo"><span>🗑️</span> Remover</button>`;

    let previewContent;
    if (isImage) {
      previewContent = (
        '<a href="' + t.attachment_url + '" target="_blank" rel="noopener"' +
        ' style="display:block;border-radius:var(--r-sm);overflow:hidden;border:1px solid var(--border);background:#f8f8f8;position:relative">' +
        '<img src="' + t.attachment_url + '"' +
        ' style="width:100%;max-height:320px;object-fit:contain;display:block;background:#f0f0f0">' +
        '<div style="position:absolute;bottom:0;left:0;right:0;padding:4px 8px;background:rgba(0,0,0,.38);color:#fff;font-size:.7rem;text-align:right">&#128269; Clique para abrir</div>' +
        '</a>'
      );
    } else if (isPdf) {
      previewContent = (
        '<div style="border:1px solid var(--border);border-radius:var(--r-sm);overflow:hidden">' +
        '<iframe src="' + t.attachment_url + '" width="100%" height="360"' +
        ' style="display:block;border:none;background:#f8f8f8"></iframe>' +
        '<a href="' + t.attachment_url + '" target="_blank" rel="noopener"' +
        ' style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--bg2);border-top:1px solid var(--border);text-decoration:none;color:var(--text2);font-size:.8rem">' +
        '<span>&#128196;</span><span>Abrir PDF em nova aba &#8599;</span>' +
        '</a>' +
        '</div>'
      );
    } else {
      previewContent = (
        '<a href="' + t.attachment_url + '" target="_blank" rel="noopener"' +
        ' style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--r-sm);text-decoration:none;color:var(--text2)">' +
        '<span style="font-size:1.6rem">&#128206;</span>' +
        '<div>' +
        '<div style="font-size:.85rem;font-weight:600;color:var(--text)">' + safeName + '</div>' +
        '<div style="font-size:.72rem;color:var(--muted)">Clique para baixar &#8599;</div>' +
        '</div>' +
        '</a>'
      );
    }
    attachHtml = (
      '<div style="padding:14px 20px;border-top:1px solid var(--border)">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">' +
      '<div style="display:flex;align-items:center;gap:6px">' +
      '<span style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)">&#128206; Anexo</span>' +
      '<span style="font-size:.72rem;color:var(--muted2);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + safeName + '">' + safeName + '</span>' +
      '</div>' +
      delBtn +
      '</div>' +
      previewContent +
      '</div>'
    )
  }

  // ── Meta rows ────────────────────────────────────────────────────────────
  const metaRows = [];
  if (t.memo)         metaRows.push(['Memo', esc(t.memo)]);
  if (t.tags?.length) metaRows.push(['Tags', t.tags.map(tag => `<span class="badge badge-muted">${esc(tag)}</span>`).join(' ')]);
  if (t.family_composition) {
    const m = t.family_composition;
    const age = typeof _fmcCalcAge === 'function' ? _fmcCalcAge(m.birth_date) : null;
    const ageTxt = age !== null ? ` (${age})` : '';
    metaRows.push(['Membro', `${m.avatar_emoji || '👤'} ${esc(m.name)}${ageTxt}`]);
  }
  if (t.currency && t.currency !== 'BRL') metaRows.push(['Moeda', t.currency]);

  const metaHtml = metaRows.map(([label, val]) => `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:7px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:.78rem;color:var(--muted);font-weight:600">${label}</span>
      <span style="font-size:.82rem;color:var(--text2);text-align:right;max-width:65%">${val}</span>
    </div>`).join('');

  document.getElementById('txDetailTitle').textContent = t.description || 'Transação';
  document.getElementById('txDetailBody').innerHTML = `
    <div style="text-align:center;padding:22px 20px 16px;border-bottom:1px solid var(--border)">
      <div class="${amtClass}" style="font-size:2rem;font-weight:700;letter-spacing:-.02em">${fmt(t.amount, t.currency||'BRL')}</div>
      <div style="margin-top:4px;font-size:.8rem;color:var(--muted)">${typeLabel} &nbsp;·&nbsp; ${fmtDate(t.date)}</div>
      <div style="margin-top:10px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
        <span class="badge" style="font-size:.78rem;font-weight:700;background:${(t.status||'confirmed')==='pending'?'var(--yellow-lt,#fef9c3)':'var(--green-lt)'};color:${(t.status||'confirmed')==='pending'?'#92400e':'var(--green)'};border:1px solid ${(t.status||'confirmed')==='pending'?'#fcd34d':'var(--green)'}30">
          ${(t.status||'confirmed')==='pending'?'⏳ Pendente':'✅ Confirmada'}
        </span>
        <button class="btn btn-ghost btn-sm" onclick="toggleTxDetailStatus()" style="font-weight:700">
          ${(t.status||'confirmed')==='pending'?'✅ Confirmar':'⏳ Marcar pendente'}
        </button>
      </div>
    </div>
    <div style="padding:4px 20px 8px">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:.78rem;color:var(--muted);font-weight:600">Conta</span>
        <span style="display:flex;align-items:center;gap:6px;font-size:.85rem;font-weight:600;color:var(--text)">
          ${renderIconEl(t.accounts?.icon, accColor, 16)}
          ${esc(t.accounts?.name || '—')}
        </span>
      </div>
      ${t.categories ? `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:.78rem;color:var(--muted);font-weight:600">Categoria</span>
        <span class="badge" style="background:${catColor}18;color:${catColor};border:1px solid ${catColor}30;font-size:.78rem">${esc(t.categories.name)}</span>
      </div>` : ''}
      ${t.payees ? `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:.78rem;color:var(--muted);font-weight:600">Beneficiário</span>
        <span style="font-size:.82rem;color:var(--text2)">${esc(t.payees.name)}</span>
      </div>` : ''}
      ${metaHtml}
    </div>
    ${attachHtml}`;

  openModal('txDetailModal');
}

function _txDetailAction(action) {
  if (!_txDetailId) return;
  if (action === 'makeScheduled') { convertTxToScheduled(_txDetailId); return; }
  closeModal('txDetailModal');
  if (action === 'edit') editTransaction(_txDetailId);
  else if (action === 'dup') duplicateTransaction(_txDetailId);
  else if (action === 'del') deleteTransaction(_txDetailId);
}

// Quick toggle: ✅ Confirmar / ⏳ Pendente directly from the transaction detail
async function toggleTxDetailStatus() {
  if (!_txDetailId) return;
  const cur = (window._txDetailStatus || 'confirmed');
  const next = (cur === 'pending') ? 'confirmed' : 'pending';
  if(cur === 'confirmed' && next === 'pending' && !confirm('Marcar transação como pendente?')) return;
  try {
    const { error } = await sb.from('transactions')
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq('id', _txDetailId);
    if (error) { toast(error.message, 'error'); return; }
    window._txDetailStatus = next;
    // Refresh lists and dashboard totals
    await loadTransactions();
    if (state.currentPage === 'dashboard') loadDashboard();
    // Re-open detail to reflect the new status (keeps the user in context)
    await openTxDetail(_txDetailId);
    toast(next === 'pending' ? 'Marcada como pendente' : 'Confirmada', 'success');
  } catch (e) {
    toast('Erro: ' + e.message, 'error');
    console.error(e);
  }
}


// ─────────────────────────────────────────────
// Mobile UX: swipe to confirm + compact view
// ─────────────────────────────────────────────
let _txSwipeBound = false;

function enhanceTransactionsMobileLayout(){
  const page = document.getElementById('page-transactions');
  if (!page) return;

  const header = page.querySelector('.tx-page-header');
  const filterBar = page.querySelector('.tx-filter-bar');
  const chipsRow = page.querySelector('.tx-filter-chips-row');
  const searchWrap = page.querySelector('.tx-search-wrap');
  const searchInput = document.getElementById('txSearch');
  const actionsWrap = header?.lastElementChild;

  if (header) header.classList.add('tx-mobile-refined-header');
  if (actionsWrap) actionsWrap.classList.add('tx-mobile-header-actions');
  if (filterBar) filterBar.classList.add('tx-mobile-refined-filters');
  if (chipsRow) chipsRow.classList.add('tx-mobile-refined-grid');
  if (searchWrap) searchWrap.classList.add('tx-mobile-search-shell');
  if (searchInput && window.innerWidth <= 720) {
    searchInput.placeholder = 'Buscar transação';
  }

  const controls = [
    ['txMonth', 'Período'],
    ['txAccount', 'Conta'],
    ['txCategoryFilter', 'Categoria'],
    ['txType', 'Tipo'],
    ['txStatusFilter', 'Status'],
    ['txMemberPicker', 'Pessoa'],
    ['txReconcileFilter', 'Conciliação'],
    ['btnEnterReconcile', 'Modo de conciliação'],
  ];

  controls.forEach(([id, label]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const wrap = el.closest('.tx-filter-chip-wrap') || el;
    wrap.dataset.mobileLabel = label;
    wrap.classList.add('tx-mobile-filter-cell');
    if (id === 'btnEnterReconcile' || id === 'txReconcileFilter') {
      wrap.classList.add('tx-mobile-span-2');
    }
  });

  const viewBtns = page.querySelector('.tx-view-btns');
  if (viewBtns) {
    viewBtns.dataset.mobileLabel = 'Visualização';
    viewBtns.classList.add('tx-mobile-filter-cell', 'tx-mobile-span-2');
  }

  if (chipsRow) {
    const desiredOrder = [
      'txMonth',
      'txAccount',
      'txCategoryFilter',
      'txType',
      'txStatusFilter',
      'txMemberPicker',
      'txReconcileFilter',
      'btnEnterReconcile',
    ];
    desiredOrder.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const node = el.closest('.tx-filter-chip-wrap') || el;
      if (node.parentElement === chipsRow) chipsRow.appendChild(node);
    });
    if (viewBtns && viewBtns.parentElement === chipsRow) chipsRow.appendChild(viewBtns);
  }
}

function initTxMobileUX(){
  // Bind once using event delegation
  if(_txSwipeBound) return;
  _txSwipeBound = true;
  let startX=0, startY=0, targetEl=null, tracking=false;

  document.addEventListener('touchstart', (ev)=>{
    const row = ev.target.closest?.('.tx-row-clickable');
    if(!row) return;
    // Only enable swipe on small screens
    if(window.innerWidth>720) return;
    tracking=true;
    targetEl=row;
    const t=ev.touches[0];
    startX=t.clientX; startY=t.clientY;
  }, {passive:true});

  document.addEventListener('touchmove', (ev)=>{
    if(!tracking||!targetEl) return;
    const t=ev.touches[0];
    const dx=t.clientX-startX; const dy=t.clientY-startY;
    if(Math.abs(dy) > Math.abs(dx)) return; // vertical scroll wins

    // Allow both directions: right = confirm, left = back to pending
    const clamped = Math.max(-90, Math.min(dx, 90));
    targetEl.style.transition='none';
    targetEl.style.transform=`translateX(${clamped}px)`;

    if(clamped > 0){
      targetEl.style.background='var(--green-lt,#dcfce7)';
    } else if(clamped < 0){
      targetEl.style.background='var(--amber-lt,#fffbeb)';
    }
  }, {passive:true});

  document.addEventListener('touchend', async (ev)=>{
    if(!tracking||!targetEl) return;
    const id = targetEl.getAttribute('data-tx-id');
    const dx = (targetEl.style.transform||'').match(/translateX\(([-0-9.]+)px\)/);
    const moved = dx ? parseFloat(dx[1]) : 0;

    // Reset visuals with animation
    targetEl.style.transition='transform 180ms ease, background 180ms ease';
    targetEl.style.transform='translateX(0px)';
    targetEl.style.background='';

    tracking=false;
    const el=targetEl; targetEl=null;

    if(!id) return;
    if(Math.abs(moved) < 60) return;

    const isPending = el.classList.contains('tx-pending');

    try {
      if(moved > 0) {
        // Swipe right: pending -> confirmed
        if(!isPending) return;
        el.classList.add('tx-confirm-anim');
        setTimeout(()=>el.classList.remove('tx-confirm-anim'), 650);
        await setTransactionStatus(id, 'confirmed');
      } else {
        // Swipe left: confirmed -> pending
        if(isPending) return;
        el.classList.add('tx-pending-anim');
        setTimeout(()=>el.classList.remove('tx-pending-anim'), 650);
        await setTransactionStatus(id, 'pending');
      }
    } catch(e) {
      toast('Erro ao atualizar status: '+e.message,'error');
    }
  }, {passive:true});

  // Compact view: apply class based on preference
  applyTxCompactPreference();
}

function applyTxCompactPreference(){
  try{
    const pref = (typeof getUserPreference==='function') ? getUserPreference('transactions','compact_view') : null;
    const isCompact = pref === true || pref === 'true' || localStorage.getItem('tx_compact_view')==='1';
    document.body.classList.toggle('tx-compact', !!isCompact);
  }catch(e){}
}

// ── Feature 5: Converter transação normal em Programada ──────────────────
async function convertTxToScheduled(txId) {
  if (!txId) return;
  // Load full transaction data
  const { data: t, error } = await sb.from('transactions')
    .select('*, accounts!transactions_account_id_fkey(name,currency), categories(name,color), payees(name)')
    .eq('id', txId).single();
  if (error || !t) { toast(t('toast.err_load_tx'), 'error'); return; }

  // Pre-fill the convertToScheduledModal
  const el = id => document.getElementById(id);
  if (!el('convertToScheduledModal')) { toast('Modal de programação não encontrado.', 'error'); return; }

  el('ctsTxId').value    = txId;
  el('ctsDesc').value    = t.description || '';
  el('ctsAmount').value  = Math.abs(t.amount || 0).toFixed(2).replace('.', ',');
  el('ctsAccount').textContent = t.accounts?.name || '—';
  el('ctsDate').value    = t.date || new Date().toISOString().slice(0,10);
  el('ctsMemo').value    = t.memo || '';
  el('ctsType').value    = t.is_transfer ? 'transfer' : (t.amount < 0 ? 'expense' : 'income');

  // Pre-select account (favorites first)
  const accSel = el('ctsAccountId');
  if (accSel) {
    accSel.innerHTML = (typeof _accountOptions === 'function')
      ? _accountOptions(state.accounts || [], 'Selecione a conta')
      : (state.accounts||[]).map(a =>
          `<option value="${a.id}">${esc(a.name)} (${a.currency})</option>`
        ).join('');
    if (t.account_id) accSel.value = t.account_id;
  }
  // Note: original transaction is kept. The scheduled starts from the chosen date forward.
  const noteEl = el('ctsNote');
  if (noteEl) noteEl.innerHTML =
    `<strong>Nota:</strong> A transação original de <strong>${fmtDate(t.date)}</strong> 
     permanece lançada. A programação será criada para as próximas ocorrências a partir da data escolhida.`;

  closeModal('txDetailModal');
  openModal('convertToScheduledModal');
}

async function saveConvertToScheduled() {
  const el = id => document.getElementById(id);
  const txId   = el('ctsTxId')?.value;
  const desc   = el('ctsDesc')?.value?.trim();
  const amount = parseFloat((el('ctsAmountInput')?.value||'0').replace(',','.')) || 0;
  const accId  = el('ctsAccountId')?.value;
  const startDate = el('ctsDate')?.value;
  const freq   = document.querySelector('input[name=ctsFreq]:checked')?.value || 'monthly';
  const memo   = el('ctsMemo')?.value || '';
  const type   = el('ctsType')?.value || 'expense';

  if (!desc)      { toast(t('toast.err_description'),'error'); return; }
  if (!accId)     { toast(t('toast.err_select_account'),'error'); return; }
  if (!startDate) { toast(t('toast.err_start_date'),'error'); return; }

  // Find original tx to copy category/payee
  const orig = (state.transactions||[]).find(t=>t.id===txId) || {};

  const data = {
    description: desc,
    type,
    amount: (type==='expense') ? -Math.abs(amount) : Math.abs(amount),
    account_id: accId,
    payee_id: orig.payee_id || null,
    category_id: orig.category_id || null,
    memo,
    tags: orig.tags || null,
    status: 'active',
    start_date: startDate,
    frequency: freq,
    auto_register: false,
    auto_confirm: true,
    updated_at: new Date().toISOString(),
    family_id: famId(),
  };

  const { error } = await sb.from('scheduled_transactions').insert(data);
  if (error) { toast('Erro ao criar programação: ' + error.message, 'error'); return; }

  toast(t('scheduled.saved'), 'success');
  // No per-transaction notify for scheduled — notified at execution time
  closeModal('convertToScheduledModal');
  if (state.currentPage === 'scheduled') loadScheduled();
}

// Toggle status helper used by detail view + swipe
async function setTransactionStatus(txId, status){
  // Extra confirmation when switching from Confirmada -> Pendente
  try {
    const cur = (state.transactions?.find(t=>t.id===txId)?.status) || (window._txDetailId===txId ? (window._txDetailStatus||'confirmed') : 'confirmed');
    if(cur === 'confirmed' && status === 'pending') {
      if(!confirm('Marcar transação como pendente?')) return;
    }
  } catch(e) {}
  if(!sb) throw new Error('Sem conexão');
  const { error } = await sb.from('transactions').update({ status, updated_at: new Date().toISOString() }).eq('id', txId);
  if(error) throw error;
  // Refresh views
  await loadAccounts();
  if(state.currentPage==='transactions') await loadTransactions();
  if(state.currentPage==='dashboard') await loadDashboard();
  toast(status==='confirmed' ? '✅ Confirmada' : '⏳ Marcada como pendente', 'success');
}

// ── Feature 9: Sugestão automática do melhor cartão ──────────────────────

/**
 * Calcula quantos dias de prazo um cartão dá a partir de hoje.
 * Lógica: se hoje <= best_purchase_day → paga na fatura deste mês (due_day)
 *         senão → paga na fatura do mês seguinte
 */
function _cardDaysUntilPayment(card) {
  if (!card.best_purchase_day || !card.due_day) return -1;
  const today   = new Date();
  const todayD  = today.getDate();
  const bestDay = parseInt(card.best_purchase_day);
  const dueDay  = parseInt(card.due_day);
  if (isNaN(bestDay) || isNaN(dueDay)) return -1;

  // Data de vencimento desta ou da próxima fatura
  let dueDate;
  if (todayD <= bestDay) {
    // Ainda dentro do melhor período — vence neste mês
    dueDate = new Date(today.getFullYear(), today.getMonth(), dueDay);
  } else {
    // Passou do melhor dia — vence no próximo mês
    dueDate = new Date(today.getFullYear(), today.getMonth() + 1, dueDay);
  }
  const diff = Math.ceil((dueDate - today) / 86400000);
  return diff;
}

/** Mostra (ou atualiza) o banner de sugestão de cartão no modal de transação */
function suggestBestCard() {
  const banner = document.getElementById('txBestCardSuggestion');
  if (!banner) return;

  const txType = document.getElementById('txTypeField')?.value;
  // Só faz sentido para despesas
  if (txType !== 'expense') { banner.style.display = 'none'; return; }

  const cards = (state.accounts || []).filter(a =>
    a.type === 'cartao_credito' && a.best_purchase_day && a.due_day
  );

  if (!cards.length) {
    // Fallback: sugere última conta usada
    const lastAccId = state.txFilter?.account || '';
    const lastAcc   = lastAccId ? state.accounts.find(a => a.id === lastAccId) : null;
    if (lastAcc) {
      banner.style.display = '';
      banner.innerHTML = `<span style="font-size:.8rem;color:var(--muted)">💡 Última conta usada: <strong>${esc(lastAcc.name)}</strong></span>`;
    } else {
      banner.style.display = 'none';
    }
    return;
  }

  // Ordena por maior prazo
  const ranked = cards
    .map(c => ({ card: c, days: _cardDaysUntilPayment(c) }))
    .filter(x => x.days >= 0)
    .sort((a, b) => b.days - a.days);

  if (!ranked.length) { banner.style.display = 'none'; return; }

  const best = ranked[0];
  const today = new Date();
  const bestPurchaseDate = new Date(today.getFullYear(), today.getMonth(), best.card.best_purchase_day);
  const bestPurchaseFmt  = bestPurchaseDate.toLocaleDateString('pt-BR', {day:'2-digit',month:'2-digit'});

  banner.style.display = '';
  banner.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:10px">
      <span style="font-size:1.1rem;flex-shrink:0">💳</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:.78rem;font-weight:700;color:var(--accent);margin-bottom:2px">Cartão sugerido</div>
        <div style="font-size:.85rem;font-weight:600">${esc(best.card.name)}</div>
        <div style="font-size:.72rem;color:var(--muted);margin-top:2px">
          Melhor compra até dia <strong>${best.card.best_purchase_day}</strong> (${bestPurchaseFmt}) ·
          <strong>${best.days}</strong> dias até pagamento
        </div>
        ${ranked.length > 1 ? `<div style="font-size:.7rem;color:var(--muted);margin-top:1px">${ranked.length-1} outro${ranked.length>2?'s':''} cartão${ranked.length>2?'s':''} disponível${ranked.length>2?'is':''}</div>` : ''}
      </div>
      <button type="button" onclick="event.stopPropagation();_applyCardSuggestion('${best.card.id}')"
        style="font-size:.72rem;padding:4px 9px;background:var(--accent);color:#fff;border:none;border-radius:6px;cursor:pointer;white-space:nowrap;font-family:inherit;font-weight:600">
        Usar
      </button>
    </div>`;
}

function _applyCardSuggestion(cardId) {
  const sel = document.getElementById('txAccountId');
  if (sel) {
    sel.value = cardId;
    _onTxSourceAccountChange(cardId);
  }
  suggestBestCard();
}


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
