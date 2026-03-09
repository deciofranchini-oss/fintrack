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
  if (!toImport.length) { toast('Nenhuma linha selecionada', 'warning'); return; }

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
  const f=state.txFilter;
  const isGroup = state.txView === 'group';
  let q=famQ(sb.from('transactions').select('*, accounts!transactions_account_id_fkey(name,currency,color,icon), payees(name), categories(name,color,icon)',{count:'exact'})).order('status',{ascending:false}).order(state.txSortField,{ascending:state.txSortAsc});
  // Pagination only in flat view; grouped view loads all for the current filter set
  if(!isGroup) q=q.range(state.txPage*state.txPageSize,(state.txPage+1)*state.txPageSize-1);
  if(f.month){
    if(f.month.startsWith('year:')) {
      const y = f.month.split(':')[1];
      q=q.gte('date',`${y}-01-01`).lte('date',`${y}-12-31`);
    } else {
      const[y,m]=f.month.split('-');
      const lastDay = new Date(+y, +m, 0).getDate(); // day 0 of next month = last day of this month
      q=q.gte('date',`${y}-${m}-01`).lte('date',`${y}-${m}-${String(lastDay).padStart(2,'0')}`);
    }
  }
  if(f.account)q=q.eq('account_id',f.account);if(f.search)q=q.ilike('description','%'+f.search+'%');
  if(f.type==='income')q=q.gt('amount',0).eq('is_transfer',false);else if(f.type==='expense')q=q.lt('amount',0).eq('is_transfer',false);else if(f.type==='transfer')q=q.eq('is_transfer',true).eq('is_card_payment',false);else if(f.type==='card_payment')q=q.eq('is_card_payment',true);
  // Status filter: pending | confirmed | all
  if(f.status==='pending') q=q.eq('status','pending');
  else if(f.status==='confirmed') q=q.eq('status','confirmed');
  const{data,count,error}=await q;if(error){toast(error.message,'error');return;}state.transactions=data||[];state.txTotal=count||0;renderTransactions();
}
function filterTransactions(){
  state.txFilter.search=document.getElementById('txSearch').value;
  state.txFilter.month=document.getElementById('txMonth').value;
  state.txFilter.account=document.getElementById('txAccount').value;
  state.txFilter.type=document.getElementById('txType').value;
  state.txFilter.status=(document.getElementById('txStatusFilter')?.value)||'';
  state.txPage=0;
  if(state.txView==='flat') document.getElementById('txSummaryBar').style.display='none';
  loadTransactions();
}

function populateTxMonthFilter() {
  const sel = document.getElementById('txMonth');
  if (!sel) return;
  const prev = sel.value;
  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth() + 1;
  const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

  let html = '<option value="">Todos os meses</option>';

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
function txRow(t, showAccount=true) {
  const isPending = (t.status||'confirmed') === 'pending';
  const pendingBadge = isPending ? ' <span class="badge" style="margin-left:5px;background:var(--yellow-lt,#fef9c3);color:#92400e;border:1px solid #fcd34d;font-size:.65rem">Pendente</span>' : '';
  const cat = t.categories
    ? `<span class="badge" style="background:${t.categories.color}18;color:${t.categories.color};border:1px solid ${t.categories.color}30;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;vertical-align:middle">${esc(t.categories.name)}</span>`
    : '<span class="text-muted" style="font-size:.78rem">—</span>';
  const acctCell = showAccount
    ? `<td><span class="badge badge-muted" style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;vertical-align:middle">${esc(t.accounts?.name||'—')}</span></td>`
    : `<td style="display:none"></td>`;
  return `<tr class="tx-row-clickable${isPending?' tx-pending':''}" data-tx-id="${t.id}" onclick="openTxDetail('${t.id}')" style="cursor:pointer">
    <td class="text-muted tx-col-date" style="white-space:nowrap;font-size:.8rem">${fmtDate(t.date)}${pendingBadge}</td>
    ${acctCell}
    <td class="tx-col-desc" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.description||'—')}${t.attachment_url?'<span title="Tem anexo" style="margin-left:4px;opacity:.6;font-size:.72rem">📎</span>':''}</td>
    <td class="text-muted tx-col-pay" style="font-size:.82rem;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.payees?.name||'—')}</td>
    <td class="tx-col-cat">${cat}</td>
    <td class="${t.amount>=0?'amount-pos':'amount-neg'} tx-col-amt" style="white-space:nowrap;font-variant-numeric:tabular-nums">
      ${(()=>{
        const cur = (t.currency||t.accounts?.currency||'BRL').toUpperCase();
        const mainFmt = fmt(t.amount, cur);
        // Se moeda estrangeira E temos brl_amount, mostra conversão como tooltip/subtext
        if (cur !== 'BRL' && t.brl_amount != null) {
          return `<span title="${mainFmt} = ${fmt(t.brl_amount,'BRL')}">${mainFmt}<span style="display:block;font-size:.68rem;color:var(--muted);font-weight:400">${fmt(t.brl_amount,'BRL')}</span></span>`;
        }
        return mainFmt;
      })()}
    </td>
    <td class="tx-col-act" onclick="event.stopPropagation()"><div style="display:flex;gap:3px;justify-content:center"><button class="btn-icon" title="Editar" onclick="editTransaction('${t.id}')">✏️</button><button class="btn-icon" title="Duplicar" onclick="duplicateTransaction('${t.id}')">📋</button><button class="btn-icon" title="Excluir" onclick="deleteTransaction('${t.id}')">🗑️</button></div></td>
  </tr>`;
}

function setTxView(v) {
  state.txView = v;
  document.getElementById('viewBtnFlat').classList.toggle('active', v==='flat');
  document.getElementById('viewBtnGroup').classList.toggle('active', v==='group');
  document.getElementById('txFlatCard').style.display = v==='flat' ? '' : 'none';
  document.getElementById('txGroupContainer').style.display = v==='group' ? '' : 'none';
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
  if(!txs.length){body.innerHTML='<tr><td colspan="7" class="text-muted" style="text-align:center;padding:32px;font-size:.83rem">Nenhuma transação encontrada</td></tr>';return;}
  const pending = txs.filter(t => (t.status||'confirmed')==='pending');
  const confirmed = txs.filter(t => (t.status||'confirmed')!=='pending');
  const sep = (pending.length && confirmed.length) ? `<tr><td colspan="7" style="padding:6px 10px;background:var(--bg2);color:var(--muted);font-size:.72rem;font-weight:700">CONFIRMADAS</td></tr>` : '';
  body.innerHTML = pending.map(t => txRow(t, true)).join('') + sep + confirmed.map(t => txRow(t, true)).join('');
  const total=state.txTotal, page=state.txPage, ps=state.txPageSize;
  document.getElementById('txPagination').innerHTML=`<span>${page*ps+1}–${Math.min((page+1)*ps,total)} de ${total}</span><div style="display:flex;gap:5px"><button class="btn btn-ghost btn-sm" ${page===0?'disabled':''} onclick="changePage(-1)">‹ Anterior</button><button class="btn btn-ghost btn-sm" ${(page+1)*ps>=total?'disabled':''} onclick="changePage(1)">Próxima ›</button></div>`;

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

  // Summary bar
  const summaryBar = document.getElementById('txSummaryBar');
  summaryBar.style.display = 'flex';
  summaryBar.innerHTML = sortedKeys.map(k => {
    const g = groups[k];
    const acct = state.accounts.find(a => a.id === k) || {};
    const col = acct.color || 'var(--accent)';
    const bal = g.balance;
    return `<div onclick="document.getElementById('txGroup-${k}').scrollIntoView({behavior:'smooth',block:'start'})"
      style="display:flex;align-items:center;gap:6px;padding:6px 12px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r-sm);cursor:pointer;transition:box-shadow .15s;font-size:.8rem"
      onmouseover="this.style.boxShadow='var(--shadow)'" onmouseout="this.style.boxShadow=''">
      ${renderIconEl(acct.icon, acct.color, 20)}
      <span style="font-weight:600;color:var(--text)">${esc(g.account?.name||'Sem conta')}</span>
      <span class="${bal>=0?'amount-pos':'amount-neg'}" style="font-weight:600;font-size:.85rem">${fmt(bal,'BRL')}</span>
    </div>`;
  }).join('');

  // Render each group
  container.innerHTML = sortedKeys.map(k => {
    const g = groups[k];
    const acct = state.accounts.find(a => a.id === k) || {};
    const col = acct.color || 'var(--accent)';
    const colspan = 6;
    return `<div class="tx-group-wrap" id="txGroup-${k}" style="border:1px solid var(--border);border-radius:var(--r);overflow:hidden;margin-bottom:14px">
      <div class="tx-group-header" onclick="toggleTxGroup('${k}')"
        style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--surface2);border-bottom:2px solid ${col}30;cursor:pointer">
        <div style="width:4px;height:32px;background:${col};border-radius:4px;flex-shrink:0"></div>
        ${renderIconEl(acct.icon, acct.color, 28)}
        <span style="font-weight:700;font-size:.95rem;flex:1">${esc(g.account?.name||'Sem conta')}</span>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          ${g.income ? `<span class="badge badge-green" style="font-size:.75rem">+${fmt(g.income,'BRL')}</span>` : ''}
          ${g.expense ? `<span class="badge badge-red" style="font-size:.75rem">${fmt(g.expense,'BRL')}</span>` : ''}
          <span class="badge" style="font-size:.78rem;font-weight:700;background:${g.balance>=0?'var(--green-lt)':'var(--red-lt)'};color:${g.balance>=0?'var(--green)':'var(--red)'}">
            ${g.balance>=0?'=':''} ${fmt(g.balance,'BRL')}
          </span>
          <span style="font-size:.7rem;color:var(--muted)">${g.txs.length} lanç.</span>
        </div>
        <span id="txGroupToggle-${k}" style="font-size:.7rem;color:var(--muted);transition:transform .2s">▼</span>
      </div>
      <div id="txGroupBody-${k}" class="tx-group-body">
        <div class="table-wrap" style="margin:0">
          <table style="border-radius:0">
            <thead><tr><th class="tx-th-date" onclick="sortTx('date')">Data ⇅</th><th class="tx-th-acct" style="display:none">Conta</th><th class="tx-th-desc">Descrição</th><th class="tx-th-pay">Beneficiário</th><th class="tx-th-cat">Categoria</th><th class="tx-th-amt" onclick="sortTx('amount')">Valor ⇅</th><th class="tx-th-act"></th></tr></thead>
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
  const collapsed = body.style.display === 'none';
  body.style.display = collapsed ? '' : 'none';
  if(arrow) arrow.style.transform = collapsed ? '' : 'rotate(-90deg)';
}

function changePage(dir){state.txPage+=dir;loadTransactions();}
function openTransactionModal(id=''){resetTxModal();document.getElementById('txDate').value=new Date().toISOString().slice(0,10);document.getElementById('txModalTitle').textContent='Nova Transação';if(id)editTransaction(id);else openModal('txModal');}
function resetTxModal(){
  ['txId','txDesc','txMemo','txTags'].forEach(f=>document.getElementById(f).value='');
  const stEl=document.getElementById('txStatus'); if(stEl) stEl.value='confirmed';
  setAmtField('txAmount', 0);
  document.getElementById('txTypeField').value='expense';
  _hideTxCurrencyPanel();
  setTxType('expense');clearPayeeField('tx');hideCatSuggestion();setCatPickerValue(null);
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
  openModal('txModal');
}
function _filterTxAccountOrigin(excludeCreditCards) {
  const sel = document.getElementById('txAccountId');
  if (!sel || !state.accounts) return;
  const currentVal = sel.value;
  const accounts = excludeCreditCards
    ? state.accounts.filter(a => a.type !== 'cartao_credito')
    : state.accounts;
  sel.innerHTML = '<option value="">Selecione a conta</option>' +
    accounts.map(a => `<option value="${a.id}"${a.id===currentVal?' selected':''}>${esc(a.name)} (${a.currency})</option>`).join('');
  if (excludeCreditCards && currentVal) {
    const acct = state.accounts.find(a => a.id === currentVal);
    if (acct && acct.type === 'cartao_credito') sel.value = '';
  }
}


function setTxType(type){
  document.getElementById('txTypeField').value=type;
  // card_payment is visually shown as 'transfer' tab
  const activeTab = (type==='card_payment') ? 'transfer' : type;
  document.querySelectorAll('#txModal .tab').forEach((t,i)=>t.classList.toggle('active',['expense','income','transfer'][i]===activeTab));
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

// ── FX / Exchange-rate helpers ─────────────────────────────────────────────

// frankfurter.app: free, no key, CORS-correct, ECB data
// Endpoint: GET https://api.frankfurter.app/YYYY-MM-DD?base=EUR&to=BRL
const FX_API_BASE = 'https://api.frankfurter.app';

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

/** Returns currency of currently selected source account */
function _getTxAccountCurrency() {
  const accId = document.getElementById('txAccountId')?.value;
  const acc   = (state.accounts || []).find(a => a.id === accId);
  return acc?.currency || 'BRL';
}

function _hideTxCurrencyPanel() {
  const p = document.getElementById('txCurrencyPanel');
  if (p) p.style.display = 'none';
  const badge = document.getElementById('txCurrencyBadge');
  if (badge) badge.textContent = 'BRL';
}

/** Updates currency badge and shows/hides the FX panel for expense/income */
function _updateTxCurrencyPanel(accountId) {
  const acc = (state.accounts || []).find(a => a.id === accountId);
  const cur = acc?.currency || 'BRL';
  const badge = document.getElementById('txCurrencyBadge');
  if (badge) badge.textContent = cur;

  const panel = document.getElementById('txCurrencyPanel');
  if (!panel) return;

  if (cur === 'BRL' || !accountId) {
    panel.style.display = 'none';
    return;
  }

  // Non-BRL account: show conversion panel
  panel.style.display = '';
  const title = document.getElementById('txCurrencyPanelTitle');
  const fromLabel = document.getElementById('txCurrencyRateFromLabel');
  if (title) title.textContent = `Conversão: ${cur} → BRL`;
  if (fromLabel) fromLabel.textContent = cur;

  // Clear suggestion + preview
  const sugg = document.getElementById('txCurrencySuggestion');
  if (sugg) sugg.style.display = 'none';
  const preview = document.getElementById('txCurrencyPreview');
  if (preview) preview.textContent = '';

  // Auto-fetch suggestion
  fetchTxCurrencyRate();
}

function onTxAmountInput() {
  // IOF mirror (existing)
  if (document.getElementById('txIsInternational')?.checked) updateIofMirror();
  // Currency preview
  updateTxCurrencyPreview();
}

function updateTxCurrencyPreview() {
  const cur    = _getTxAccountCurrency();
  const panel  = document.getElementById('txCurrencyPanel');
  if (!panel || panel.style.display === 'none') return;
  if (cur === 'BRL') return;

  const rateVal = parseFloat(document.getElementById('txCurrencyRate')?.value?.replace(',', '.'));
  const amtVal  = Math.abs(getAmtField('txAmount') || 0);
  const preview = document.getElementById('txCurrencyPreview');
  const hint    = document.getElementById('txCurrencyBrlHint');
  if (!rateVal || isNaN(rateVal) || !amtVal) {
    if (preview) preview.textContent = '';
    if (hint) hint.textContent = '—';
    return;
  }
  const brl = amtVal * rateVal;
  if (preview) preview.textContent = `= ${fmt(brl, 'BRL')}`;
  if (hint) hint.textContent = fmt(brl, 'BRL');
}

async function fetchTxCurrencyRate() {
  const cur = _getTxAccountCurrency();
  if (cur === 'BRL') return;

  const btn  = document.getElementById('txCurrencyFetchBtn');
  const icon = document.getElementById('txCurrencyFetchIcon');
  const sugg = document.getElementById('txCurrencySuggestion');
  if (btn)  btn.disabled = true;
  if (icon) icon.textContent = '⏳';
  if (sugg) sugg.style.display = 'none';

  try {
    let txDate = document.getElementById('txDate')?.value || new Date().toISOString().slice(0, 10);
    const todayStr = new Date().toISOString().slice(0, 10);
    if (txDate > todayStr) txDate = todayStr;

    // Frankfurter: base=cur, to=BRL
    // If cur = EUR use a direct call; EUR is always available as base
    // Frankfurter doesn't serve EUR→EUR, so handle BRL base specially
    let url, rate;
    if (cur === 'EUR') {
      url = `${FX_API_BASE}/${txDate}?base=EUR&to=BRL`;
    } else {
      // For USD, AED, etc: get cur→BRL directly
      // Frankfurter supports any of its currencies as base
      url = `${FX_API_BASE}/${txDate}?base=${cur}&to=BRL`;
    }
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    rate = json?.rates?.BRL;
    if (!rate) throw new Error('Taxa não encontrada');

    const usedDate = json.date || txDate;
    const rateStr  = Number(rate).toFixed(6);
    const rateInput = document.getElementById('txCurrencyRate');
    if (rateInput) rateInput.value = rateStr;
    if (sugg) {
      sugg.textContent = `📡 Cotação de ${usedDate} (BCE): 1 ${cur} = ${rateStr} BRL`;
      sugg.style.display = '';
      sugg.style.background = '';
      sugg.style.color = '';
    }
    updateTxCurrencyPreview();
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

async function saveTransaction(){
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

  // Determine transaction currency from selected account
  const _txSrcAccId = document.getElementById('txAccountId').value;
  const _txSrcAcc   = (state.accounts || []).find(a => a.id === _txSrcAccId);
  const txCurrency  = _txSrcAcc?.currency || 'BRL';

  // For non-BRL expense/income: compute brl_amount from the exchange rate panel
  let brlAmount = null;
  if (!isTransfer && txCurrency !== 'BRL') {
    const fxRate = parseFloat(document.getElementById('txCurrencyRate')?.value?.replace(',', '.'));
    if (fxRate > 0) brlAmount = Math.abs(amount) * fxRate;
  }

  const data={
    date:document.getElementById('txDate').value,
    description:document.getElementById('txDesc').value.trim(),
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
    family_id:famId()
  };
  if(!data.date||!data.account_id){toast('Preencha data e conta','error');return;}
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
  if(err){toast(err.message,'error');return;}

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
      if(state.currentPage==='transactions')loadTransactions();
      if(state.currentPage==='dashboard')loadDashboard();
      return;
    }
  }

  // Create IOF mirror transaction if international (new transactions only)
  const isIntl = document.getElementById('txIsInternational')?.checked;
  if(isIntl && !id && txResult?.id) {
    await createIofMirrorTx(data, txResult.id);
  }
  toast(id?'✓ Atualizado!':'✓ Transação salva!','success');
  closeModal('txModal');
  if(state.currentPage==='transactions')loadTransactions();
  if(state.currentPage==='dashboard')loadDashboard();
}
async function duplicateTransaction(id) {
  if(!confirm('Duplicar transação?')) return;
  // Find original transaction
  const orig = state.transactions?.find(t=>t.id===id);
  if (!orig) {
    // Fetch from DB if not in state
    const {data, error} = await sb.from('transactions').select('*').eq('id', id).single();
    if (error || !data) { toast('Transação não encontrada','error'); return; }
    await _doDuplicateTx(data);
  } else {
    await _doDuplicateTx(orig);
  }
}
async function _doDuplicateTx(orig) {
  const today = new Date().toISOString().slice(0,10);
  const newTx = {
    account_id:             orig.account_id,
    description:            orig.description ? orig.description + ' (cópia)' : '(cópia)',
    amount:                 orig.amount,
    date:                   today,
    category_id:            orig.category_id || null,
    payee_id:               orig.payee_id || null,
    memo:                   orig.memo || null,
    is_transfer:            orig.is_transfer || false,
    currency:               orig.currency || 'BRL',
    transfer_to_account_id: orig.transfer_to_account_id || null,
    family_id:              famId(),
  };
  const {data, error} = await sb.from('transactions').insert(newTx).select().single();
  if (error) { toast('Erro ao duplicar: ' + error.message, 'error'); return; }
  toast('Transação duplicada! (' + (newTx.description) + ')', 'success');
  if (state.currentPage === 'transactions') loadTransactions();
  if (state.currentPage === 'dashboard') loadDashboard();
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
  toast('Excluída','success');
  loadTransactions();
  if(state.currentPage==='dashboard')loadDashboard();
}

/* ── Transaction Detail Drawer ── */
let _txDetailId = null;

async function openTxDetail(id) {
  _txDetailId = id;

  // Always fetch fresh from DB to get attachment_name and all joined fields
  const { data, error } = await sb.from('transactions')
    .select('*, accounts!transactions_account_id_fkey(name,currency,color,icon), payees(name), categories(name,color,icon)')
    .eq('id', id).single();
  if (error || !data) { toast('Transação não encontrada', 'error'); return; }
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
