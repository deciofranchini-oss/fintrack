// ── State ──────────────────────────────────────────────
state.scheduled = [];


async function _createPairedTransferLeg(originTx, sc, actualDate, memoOverride=null) {
  if(!sc?.transfer_to_account_id) return null;
  const pairedTx = {
    family_id: famId(),
    date: actualDate,
    description: sc.description,
    amount: Math.abs(originTx.amount),
    account_id: sc.transfer_to_account_id,
    payee_id: null,
    category_id: sc.category_id || null,
    memo: memoOverride ?? originTx.memo ?? sc.memo,
    tags: sc.tags,
    is_transfer: true,
    is_card_payment: sc.type==='card_payment',
    transfer_to_account_id: sc.account_id,
    updated_at: new Date().toISOString(),
    status: originTx.status || 'confirmed',
  };
  let pairedResult, pairedErr;
  ({data:pairedResult, error:pairedErr} = await sb.from('transactions')
    .insert({...pairedTx, linked_transfer_id: originTx.id}).select().single());
  if(pairedErr && pairedErr.message?.includes('linked_transfer_id')) {
    ({data:pairedResult, error:pairedErr} = await sb.from('transactions')
      .insert(pairedTx).select().single());
  }
  if(pairedErr) {
    toast('Ocorrência registrada, mas erro ao criar lançamento de entrada: ' + pairedErr.message, 'warning');
    return null;
  }
  // Back-link origin to paired (best-effort)
  await sb.from('transactions').update({linked_transfer_id: pairedResult.id}).eq('id', originTx.id).then(()=>{}).catch(()=>{});
  return pairedResult;
}

// ── Frequency helpers ──────────────────────────────────
const FREQ_LABELS = {
  once: 'Uma vez', weekly: 'Semanal', biweekly: 'Quinzenal',
  monthly: 'Mensal', bimonthly: 'Bimestral', quarterly: 'Trimestral',
  semiannual: 'Semestral', annual: 'Anual', custom: 'Personalizado'
};

function nextDate(from, freq, customInterval, customUnit) {
  const d = new Date(from + 'T12:00:00');
  switch(freq) {
    case 'weekly':     d.setDate(d.getDate() + 7); break;
    case 'biweekly':   d.setDate(d.getDate() + 14); break;
    case 'monthly':    d.setMonth(d.getMonth() + 1); break;
    case 'bimonthly':  d.setMonth(d.getMonth() + 2); break;
    case 'quarterly':  d.setMonth(d.getMonth() + 3); break;
    case 'semiannual': d.setMonth(d.getMonth() + 6); break;
    case 'annual':     d.setFullYear(d.getFullYear() + 1); break;
    case 'custom':
      const n = parseInt(customInterval) || 1;
      if(customUnit === 'days')   d.setDate(d.getDate() + n);
      else if(customUnit === 'weeks')  d.setDate(d.getDate() + n*7);
      else if(customUnit === 'months') d.setMonth(d.getMonth() + n);
      else if(customUnit === 'years')  d.setFullYear(d.getFullYear() + n);
      break;
  }
  return d.toISOString().slice(0, 10);
}

function generateOccurrences(sc, limit = 12) {
  const dates = [];
  if(sc.frequency === 'once') {
    dates.push(sc.start_date);
    return dates;
  }
  let cur = sc.start_date;
  const today = new Date().toISOString().slice(0, 10);
  let count = 0;
  const maxCount = sc.end_count || 999;
  const endDate = sc.end_date || '2099-12-31';
  while(count < maxCount && cur <= endDate && dates.length < limit) {
    dates.push(cur);
    count++;
    if(count >= maxCount || cur >= endDate) break;
    cur = nextDate(cur, sc.frequency, sc.custom_interval, sc.custom_unit);
  }
  return dates;
}

function getNextOccurrence(sc) {
  const today = new Date().toISOString().slice(0, 10);
  const registered = (sc.occurrences || []).map(o => o.scheduled_date);
  if(sc.frequency === 'once') {
    return registered.includes(sc.start_date) ? null : sc.start_date;
  }
  let cur = sc.start_date;
  const maxCount = sc.end_count || 999;
  const endDate = sc.end_date || '2099-12-31';
  let count = 0;
  while(count < maxCount && cur <= endDate) {
    if(!registered.includes(cur)) return cur;
    count++;
    cur = nextDate(cur, sc.frequency, sc.custom_interval, sc.custom_unit);
  }
  return null;
}

function scFreqLabel(sc) {
  if(sc.frequency === 'custom') {
    return `A cada ${sc.custom_interval} ${({days:'dia(s)',weeks:'semana(s)',months:'mês/meses',years:'ano(s)'})[sc.custom_unit]||sc.custom_unit}`;
  }
  return FREQ_LABELS[sc.frequency] || sc.frequency;
}

function scStatusLabel(sc) {
  if(sc.status === 'paused') return {cls:'sc-status-paused', label:'⏸ Pausado'};
  if(sc.status === 'finished') return {cls:'sc-status-finished', label:'✓ Concluído'};
  const next = getNextOccurrence(sc);
  const today = new Date().toISOString().slice(0,10);
  if(next && next < today) return {cls:'sc-status-overdue', label:'⚠ Atrasado'};
  if(!next) return {cls:'sc-status-finished', label:'✓ Concluído'};
  return {cls:'sc-status-active', label:'● Ativo'};
}

// ── Load & Render ──────────────────────────────────────
async function loadScheduled() {
  try {
    const { data, error } = await famQ(sb.from('scheduled_transactions').select('*, accounts!scheduled_transactions_account_id_fkey(name,currency), payees(name), categories(name,color), occurrences:scheduled_occurrences(id,scheduled_date,actual_date,amount,memo,transaction_id)'));
    if(error) throw error;
    state.scheduled = data || [];

// Sort by next scheduled occurrence (closest first)
state.scheduled.sort((a,b) => {
  const da = getNextOccurrence(a) || '9999-12-31';
  const db = getNextOccurrence(b) || '9999-12-31';
  if (da < db) return -1;
  if (da > db) return 1;
  // tie-breaker: description
  return (a.description||'').localeCompare(b.description||'');
});

  } catch(e) {
    // Table might not exist yet
    if(e.message?.includes('does not exist') || e.code === '42P01') {
      document.getElementById('scheduledList').innerHTML = `
        <div class="card" style="text-align:center;padding:40px">
          <div style="font-size:2rem;margin-bottom:12px">📅</div>
          <div style="font-weight:600;margin-bottom:8px">Tabela ainda não criada</div>
          <p style="color:var(--muted);font-size:.875rem;max-width:400px;margin:0 auto 16px">
            Execute o SQL abaixo no Supabase para habilitar esta funcionalidade:
          </p>
          <pre style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r-sm);padding:14px;text-align:left;font-size:.72rem;overflow-x:auto;white-space:pre-wrap">${esc(SCHEDULED_SQL)}</pre>
        </div>`;
      return;
    }
    toast(e.message, 'error');
    return;
  }
  filterScheduled();
}

// Active chip state (replaces old scStatusFilter select)
let _scStatusChip = 'all';

function scChipFilter(event, status) {
  _scStatusChip = status;
  // Update active chip
  ['all','active','paused','finished'].forEach(s => {
    const el = document.getElementById('scChip' + s.charAt(0).toUpperCase() + s.slice(1));
    if (el) el.classList.toggle('active', s === status);
  });
  filterScheduled();
}

function filterScheduled() {
  const search = (document.getElementById('scSearch')?.value||'').toLowerCase();
  const statusF = _scStatusChip || '';
  const typeF = document.getElementById('scTypeFilter')?.value||'';

  let list = state.scheduled;
  if(search) list = list.filter(s => s.description?.toLowerCase().includes(search) || s.payees?.name?.toLowerCase().includes(search));
  if(typeF) list = list.filter(s => s.type === typeF);
  if(statusF && statusF !== 'all') {
    list = list.filter(s => {
      const st = scStatusLabel(s);
      if(statusF === 'active') return st.label.includes('Ativo') || st.label.includes('Atrasado');
      if(statusF === 'paused') return s.status === 'paused';
      if(statusF === 'finished') return !st.label.includes('Ativo') && !st.label.includes('Atrasado') && s.status !== 'paused';
    });
  }
  renderScheduled(list);
  renderUpcoming();
}

function renderScheduled(list) {
  const container = document.getElementById('scheduledList');

  // Summary bar
  const bar = document.getElementById('scheduledSummaryBar');
  if(bar) {
    const all = state.scheduled;
    const today = new Date().toISOString().slice(0,10);
    const active = all.filter(s => { const st=scStatusLabel(s); return st.label.includes('Ativo'); }).length;
    const overdue = all.filter(s => scStatusLabel(s).label.includes('Atrasado')).length;
    const paused = all.filter(s => s.status==='paused').length;
    const finished = all.filter(s => { const st=scStatusLabel(s); return st.label.includes('Concluído'); }).length;
    bar.innerHTML = [
      active   ? `<span class="badge sc-status-active" style="font-size:.8rem;padding:4px 12px">● ${active} ativo${active>1?'s':''}</span>` : '',
      overdue  ? `<span class="badge sc-status-overdue" style="font-size:.8rem;padding:4px 12px">⚠ ${overdue} atrasado${overdue>1?'s':''}</span>` : '',
      paused   ? `<span class="badge sc-status-paused" style="font-size:.8rem;padding:4px 12px">⏸ ${paused} pausado${paused>1?'s':''}</span>` : '',
      finished ? `<span class="badge sc-status-finished" style="font-size:.8rem;padding:4px 12px">✓ ${finished} concluído${finished>1?'s':''}</span>` : '',
    ].join('');
  }

  if(!list.length) {
    container.innerHTML = `<div class="card" style="text-align:center;padding:48px;color:var(--muted)">
      <div style="font-size:2.5rem;margin-bottom:12px;opacity:.4">📅</div>
      <div style="font-weight:600;margin-bottom:6px">Nenhuma transação programada</div>
      <p style="font-size:.875rem">Clique em "+ Programar" para agendar pagamentos ou recebimentos.</p>
    </div>`;
    return;
  }

  container.innerHTML = list.map(sc => {
    const st = scStatusLabel(sc);
    const next = getNextOccurrence(sc);
    const today = new Date().toISOString().slice(0,10);
    const isExpense = sc.type === 'expense' || sc.type === 'transfer' || sc.type === 'card_payment';
    const isCardPayment = sc.type === 'card_payment';
    const isTransferSc = sc.type === 'transfer' || sc.type === 'card_payment';
    const acct = state.accounts.find(a => a.id === sc.account_id);
    const destAcct = isTransferSc ? state.accounts.find(a => a.id === sc.transfer_to_account_id) : null;
    const regCount = (sc.occurrences||[]).length;
    const totalCount = sc.end_count ? `${regCount}/${sc.end_count}` : `${regCount} reg.`;
    const occList = generateOccurrences(sc, 8);
    const registered = (sc.occurrences||[]).reduce((m,o)=>{m[o.scheduled_date]=o;return m;},{});

    return `<div class="sc-card" id="scCard-${sc.id}">
      <div class="sc-card-header" onclick="toggleScCard('${sc.id}')">
        <div class="sc-card-type" style="background:${isCardPayment?'var(--blue-lt,#eff6ff)':isTransferSc?'var(--muted-lt,#f1f5f9)':isExpense?'var(--red-lt)':'var(--green-lt)'}">
          ${isCardPayment ? '💳' : isTransferSc ? '🔄' : isExpense ? '💸' : '💰'}
        </div>
        <div class="sc-card-info">
          <div class="sc-card-title">${esc(sc.description)}</div>
          <div class="sc-card-sub">
            <span>${scFreqLabel(sc)}</span>
            ${sc.payees ? `<span>· ${esc(sc.payees.name)}</span>` : ''}
            ${sc.categories ? `<span class="badge" style="background:${sc.categories.color}18;color:${sc.categories.color};border:1px solid ${sc.categories.color}30;font-size:.65rem">${esc(sc.categories.name)}</span>` : ''}
            <span class="sc-status-badge ${st.cls}">${st.label}</span>
            ${next ? `<span class="sc-next-badge">próx: ${fmtDate(next)}</span>` : ''}
          </div>
        </div>
        <div class="sc-card-right">
          <div class="sc-card-amount ${isExpense?'amount-neg':'amount-pos'}">
            ${isExpense?'−':'+'}${fmt(Math.abs(sc.amount))}
          </div>
          ${isTransferSc&&destAcct?`<div class="sc-card-transfer-tag">→ ${esc(destAcct.name)}</div>`:''}
        </div>
      </div>
      <div class="sc-card-footer" onclick="event.stopPropagation()">
        ${next ? `<button class="sc-action-btn sc-action-register" onclick="openRegisterOcc('${sc.id}','${next}')">✓ Registrar</button>` : `<span></span>`}
        <div class="sc-footer-actions">
          <button class="sc-action-icon" onclick="toggleScStatus('${sc.id}')" title="${sc.status==='active'?'Pausar':'Reativar'}">${sc.status==='active'?'⏸':'▶'}</button>
          <button class="sc-action-icon" onclick="openScheduledModal('${sc.id}')" title="Editar">✏️</button>
          <button class="sc-action-icon sc-action-delete" onclick="deleteScheduled('${sc.id}')" title="Excluir">🗑️</button>
        </div>
      </div>
      <div class="sc-card-body" id="scBody-${sc.id}">
        <div class="sc-occurrences">
          <div style="font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:8px">
            Ocorrências · ${totalCount} registradas
            ${sc.end_date ? ` · até ${fmtDate(sc.end_date)}` : ''}
          </div>
          ${occList.map(date => {
            const occ = registered[date];
            const isPast = date < today;
            const isToday = date === today;
            return `<div class="sc-occ-row">
              <span class="sc-occ-date ${isToday?'text-accent':''}">${fmtDate(date)}${isToday?' ·hoje':''}</span>
              <span class="sc-occ-label">${occ ? esc(occ.memo||sc.description) : '<span style="color:var(--muted2)">—</span>'}</span>
              <span class="sc-occ-status">
                ${occ
                  ? `<span class="sc-status-badge sc-status-finished">✓ ${fmt(occ.amount||sc.amount)}</span>`
                  : isPast
                    ? `<span class="sc-status-badge sc-status-overdue">Pendente</span>`
                    : `<span class="sc-status-badge" style="background:var(--bg2);color:var(--muted);border:1px solid var(--border)">Agendado</span>`
                }
              </span>
              ${!occ ? `<button class="btn-icon" style="font-size:.72rem;padding:3px 7px" onclick="openRegisterOcc('${sc.id}','${date}')">✓</button>` : ''}
            </div>`;
          }).join('')}
          ${sc.frequency !== 'once' && occList.length >= 8 ? `<div style="font-size:.75rem;color:var(--muted);text-align:center;padding:6px">... e mais ocorrências futuras</div>` : ''}
        </div>
        <div class="sc-body-info">
          <span>Conta: <strong>${esc(acct?.name||'—')}</strong></span>
          ${isTransferSc&&destAcct?`<span>→ Destino: <strong>${esc(destAcct.name)}</strong></span>`:''}
          ${sc.memo ? `<span>· ${esc(sc.memo)}</span>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

function renderUpcoming() {
  const today = new Date().toISOString().slice(0, 10);
  const limit = new Date(); limit.setDate(limit.getDate() + 30);
  const limitStr = limit.toISOString().slice(0, 10);

  const upcoming = [];
  state.scheduled.forEach(sc => {
    if(sc.status === 'paused') return;
    const registered = new Set((sc.occurrences||[]).map(o => o.scheduled_date));
    const occ = generateOccurrences(sc, 60);
    occ.forEach(date => {
      if(date >= today && date <= limitStr && !registered.has(date)) {
        upcoming.push({ sc, date });
      }
    });
  });
  upcoming.sort((a, b) => a.date.localeCompare(b.date));

  const card    = document.getElementById('scheduledUpcomingCard');
  const listEl  = document.getElementById('scheduledUpcomingList');
  const totalEl = document.getElementById('scheduledUpcomingTotal');
  if(!upcoming.length) { if(card) card.style.display='none'; return; }

  if(card) card.style.display='';
  if(totalEl) {
    const total = upcoming.reduce((s,u) => s + (u.sc.type==='expense'?-1:1)*Math.abs(u.sc.amount), 0);
    totalEl.textContent = (total>=0?'+':'') + fmt(total);
    totalEl.className = 'badge ' + (total>=0?'badge-green':'badge-red');
  }

  // Mobile-first card list (no table)
  if(listEl) listEl.innerHTML = upcoming.slice(0, 20).map(({sc, date}) => {
    const isOverdue = date < today;
    const isToday   = date === today;
    const isExpense = sc.type === 'expense' || sc.type === 'card_payment' || sc.type === 'transfer';
    const typeIcon  = sc.type === 'card_payment' ? '💳' : sc.type === 'transfer' ? '🔄' : isExpense ? '💸' : '💰';
    const dateLabel = isToday ? '🔔 Hoje' : isOverdue ? `⚠️ ${fmtDate(date)}` : fmtDate(date);
    return `<div class="sc-upcoming-item${isOverdue?' sc-upcoming-overdue':''}${isToday?' sc-upcoming-today':''}">
      <div class="sc-upcoming-left">
        <span class="sc-upcoming-date">${dateLabel}</span>
        <span class="sc-upcoming-desc">${typeIcon} ${esc(sc.description)}</span>
        <span class="sc-upcoming-acct">${esc(sc.accounts?.name||'—')}</span>
      </div>
      <div class="sc-upcoming-right">
        <span class="${isExpense?'amount-neg':'amount-pos'} sc-upcoming-amt">${isExpense?'−':'+'}${fmt(Math.abs(sc.amount))}</span>
        <button class="btn btn-primary btn-sm sc-upcoming-btn" onclick="openRegisterOcc('${sc.id}','${date}')">✓ Registrar</button>
      </div>
    </div>`;
  }).join('');
}

function toggleScCard(id) {
  const body = document.getElementById('scBody-'+id);
  if(body) body.classList.toggle('open');
}

// ── Modal open/save/delete ─────────────────────────────
function openScheduledModal(id='') {
  const sc = id ? state.scheduled.find(s=>s.id===id) : null;
  document.getElementById('scId').value = id;
  document.getElementById('scDesc').value = sc?.description||'';
  setAmtField('scAmount', sc ? sc.amount : 0);
  document.getElementById('scMemo').value = sc?.memo||'';
  document.getElementById('scTags').value = (sc?.tags||[]).join(', ');
  document.getElementById('scStatus').value = sc?.status||'active';

  // Populate account select
  const aEl = document.getElementById('scAccountId');
  aEl.innerHTML = state.accounts.map(a=>`<option value="${a.id}">${esc(a.name)} (${a.currency})</option>`).join('');
  if(sc?.account_id) aEl.value = sc.account_id;

  // Populate transfer-to account select
  const trEl = document.getElementById('scTransferToAccountId');
  if(trEl) {
    trEl.innerHTML = '<option value="">— Selecionar conta destino —</option>' + state.accounts.map(a=>`<option value="${a.id}">${esc(a.name)} (${a.currency})</option>`).join('');
    if(sc?.transfer_to_account_id) trEl.value = sc.transfer_to_account_id;
  }

  // Populate category picker (same as transaction modal)
  buildCatPicker(null, 'sc');
  setCatPickerValue(sc?.category_id || null, 'sc');

  // Payee
  setPayeeField(sc?.payee_id||null, 'sc');

  // Type — sets FX panel visibility
  setScType(sc?.type||'expense');

  // Restore FX settings for cross-currency transfers
  setTimeout(() => {
    onScTransferAccountChange(); // re-evaluate if currencies differ
    if (sc?.type === 'transfer') {
      const fxMode = sc?.fx_mode || 'fixed';
      setScFxMode(fxMode);
      if (fxMode === 'fixed' && sc?.fx_rate) {
        const input = document.getElementById('scFxRate');
        if (input) input.value = Number(sc.fx_rate).toFixed(6);
        updateScFxPreview();
      }
    }
  }, 50);

  // Dates
  document.getElementById('scStartDate').value = sc?.start_date || new Date().toISOString().slice(0,10);

  // Frequency
  const freq = sc?.frequency||'once';
  document.querySelectorAll('input[name=scFreq]').forEach(r => r.checked = r.value===freq);
  document.getElementById('scCustomIntervalGroup').style.display = freq==='custom' ? '' : 'none';
  document.getElementById('scEndGroup').style.display = freq==='once' ? 'none' : '';
  document.getElementById('scCustomInterval').value = sc?.custom_interval||1;
  document.getElementById('scCustomUnit').value = sc?.custom_unit||'months';

  // End condition
  const endType = sc?.end_count ? 'count' : sc?.end_date ? 'date' : 'forever';
  document.querySelectorAll('input[name=scEnd]').forEach(r => r.checked = r.value===endType);
  document.getElementById('scEndCountGroup').style.display = endType==='count' ? '' : 'none';
  document.getElementById('scEndDateGroup').style.display = endType==='date' ? '' : 'none';
  document.getElementById('scEndCount').value = sc?.end_count||'';
  document.getElementById('scEndDate').value = sc?.end_date||'';

  // Attach event listeners for dynamic preview (replace to avoid dupes)
  document.querySelectorAll('input[name=scFreq]').forEach(r => { r.onchange = onScFreqChange; });
  document.querySelectorAll('input[name=scEnd]').forEach(r => { r.onchange = onScEndChange; });
  ['scStartDate','scEndCount','scEndDate','scCustomInterval','scCustomUnit'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.oninput = updateScPreview;
  });

  document.getElementById('scheduledModalTitle').textContent = id ? 'Editar Programação' : 'Programar Transação';

  // Currency badge + panel — restore after type/account are settled
  setTimeout(() => {
    const type  = document.getElementById('scTypeField')?.value;
    const accId = document.getElementById('scAccountId')?.value;
    if (type !== 'transfer' && type !== 'card_payment' && accId) {
      _updateScCurrencyPanel(accId);
      // Se estava editando e tinha brl_amount, recalcula a taxa implícita
      if (sc?.currency && sc.currency !== 'BRL' && sc.brl_amount && sc.amount) {
        const impliedRate = Math.abs(sc.brl_amount / sc.amount);
        const rateInput = document.getElementById('scCurrencyRate');
        if (rateInput && impliedRate > 0) {
          rateInput.value = impliedRate.toFixed(6);
          updateScCurrencyPreview();
        }
      }
    }
  }, 80);

  // Auto-register & notify fields
  const arEl = document.getElementById('scAutoRegister');
  const neEl = document.getElementById('scNotifyEmail');
  const naEl = document.getElementById('scNotifyEmailAddr');
  const ndEl = document.getElementById('scNotifyDaysBefore');
  const ndDiv = document.getElementById('scNotifyEmailDetails');
  if(arEl) arEl.checked = sc?.auto_register || false;
  const acEl = document.getElementById('scAutoConfirm');
  if(acEl) acEl.checked = (sc?.auto_confirm ?? true);

  if(neEl) {
    neEl.checked = sc?.notify_email || false;
    if(ndDiv) ndDiv.style.display = neEl.checked ? '' : 'none';
  }
  if(naEl) naEl.value = sc?.notify_email_addr || '';
  if(ndEl) ndEl.value = sc?.notify_days_before ?? 1;

  updateScPreview();
  openModal('scheduledModal');
}

function setScType(type) {
  document.getElementById('scTypeField').value = type;
  const activeTab = (type==='transfer'||type==='card_payment') ? 'transfer' : type;
  document.querySelectorAll('#scheduledModal .tab').forEach((t,i)=>t.classList.toggle('active',['expense','income','transfer'][i]===activeTab));
  const isTransfer = type==='transfer' || type==='card_payment';
  const isCardPayment = type==='card_payment';
  const trGroup = document.getElementById('scTransferToGroup');
  const payGroup = document.getElementById('scPayeeGroup');
  const catGroup = document.getElementById('scCategoryGroup');
  if(trGroup) trGroup.style.display = isTransfer ? '' : 'none';
  if(payGroup) payGroup.style.display = isTransfer ? 'none' : '';
  if(catGroup) catGroup.style.display = isCardPayment ? '' : (isTransfer ? 'none' : '');
  const cpBadge = document.getElementById('scCardPaymentBadge');
  if(cpBadge) cpBadge.style.display = isCardPayment ? '' : 'none';
  const trLabel = document.querySelector('#scTransferToGroup label');
  if(trLabel) trLabel.textContent = isCardPayment ? 'Cartão de Crédito (Destino) *' : 'Conta Destino *';
  // Hide FX panel when switching away from transfer
  if (!isTransfer) {
    _hideScFxPanel();
    const accId = document.getElementById('scAccountId')?.value;
    if (accId) _updateScCurrencyPanel(accId);
  } else {
    _hideScCurrencyPanel();
  }
  // Filter source account: card_payment origin cannot be a credit card account
  _filterScAccountOrigin(isCardPayment);
  // Rebuild category picker for this type
  buildCatPicker(null, 'sc');
}

// ── Scheduled FX helpers ──────────────────────────────────────────────────

function _getScTransferCurrencies() {
  const srcId  = document.getElementById('scAccountId')?.value;
  const dstId  = document.getElementById('scTransferToAccountId')?.value;
  const srcAcc = state.accounts.find(a => a.id === srcId);
  const dstAcc = state.accounts.find(a => a.id === dstId);
  return {
    src: srcAcc?.currency || null,
    dst: dstAcc?.currency || null,
  };
}

function _hideScFxPanel() {
  const panel = document.getElementById('scFxPanel');
  if (panel) panel.style.display = 'none';
}

/** Dispatcher — chamado quando conta de origem muda */
function onScAccountChange() {
  const type = document.getElementById('scTypeField')?.value;
  if (type === 'transfer' || type === 'card_payment') {
    onScTransferAccountChange();
  } else {
    _updateScCurrencyPanel(document.getElementById('scAccountId')?.value);
  }
}

// ── Currency helpers para despesa/receita em moeda estrangeira ────────────

function _getScAccountCurrency() {
  const acc = (state.accounts || []).find(a => a.id === document.getElementById('scAccountId')?.value);
  return acc?.currency || 'BRL';
}

function _hideScCurrencyPanel() {
  const p = document.getElementById('scCurrencyPanel');
  if (p) p.style.display = 'none';
  const badge = document.getElementById('scCurrencyBadge');
  if (badge) badge.textContent = 'BRL';
}

function _updateScCurrencyPanel(accountId) {
  const acc = (state.accounts || []).find(a => a.id === accountId);
  const cur = acc?.currency || 'BRL';
  const badge = document.getElementById('scCurrencyBadge');
  if (badge) badge.textContent = cur;

  const panel = document.getElementById('scCurrencyPanel');
  if (!panel) return;

  if (cur === 'BRL' || !accountId) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = '';
  const title = document.getElementById('scCurrencyPanelTitle');
  const fromLabel = document.getElementById('scCurrencyRateFromLabel');
  if (title) title.textContent = `Conversão: ${cur} → BRL`;
  if (fromLabel) fromLabel.textContent = cur;

  const sugg = document.getElementById('scCurrencySuggestion');
  if (sugg) sugg.style.display = 'none';
  const preview = document.getElementById('scCurrencyPreview');
  if (preview) preview.textContent = '';
  fetchScCurrencyRate();
}

function updateScCurrencyPreview() {
  const type = document.getElementById('scTypeField')?.value;
  if (type === 'transfer' || type === 'card_payment') return;
  const panel = document.getElementById('scCurrencyPanel');
  if (!panel || panel.style.display === 'none') return;
  const rateVal = parseFloat(document.getElementById('scCurrencyRate')?.value?.replace(',', '.'));
  const amtVal  = Math.abs(getAmtField('scAmount') || 0);
  const preview = document.getElementById('scCurrencyPreview');
  const hint    = document.getElementById('scCurrencyBrlHint');
  if (!rateVal || isNaN(rateVal) || !amtVal) {
    if (preview) preview.textContent = '';
    if (hint)    hint.textContent = '—';
    return;
  }
  const brl = amtVal * rateVal;
  if (preview) preview.textContent = `= ${fmt(brl, 'BRL')}`;
  if (hint)    hint.textContent = fmt(brl, 'BRL');
}

async function fetchScCurrencyRate() {
  const cur = _getScAccountCurrency();
  if (cur === 'BRL') return;
  const btn  = document.getElementById('scCurrencyFetchBtn');
  const icon = document.getElementById('scCurrencyFetchIcon');
  const sugg = document.getElementById('scCurrencySuggestion');
  if (btn)  btn.disabled = true;
  if (icon) icon.textContent = '⏳';
  if (sugg) sugg.style.display = 'none';
  try {
    const today = new Date().toISOString().slice(0, 10);
    const fxBase = (typeof FX_API_BASE !== 'undefined') ? FX_API_BASE : 'https://api.frankfurter.app';
    const url = `${fxBase}/${today}?base=${cur}&to=BRL`;
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const rate = json?.rates?.BRL;
    if (!rate) throw new Error('Taxa não encontrada');
    const rateStr = Number(rate).toFixed(6);
    const rateInput = document.getElementById('scCurrencyRate');
    if (rateInput) rateInput.value = rateStr;
    if (sugg) {
      sugg.textContent = `📡 Cotação de ${json.date} (BCE): 1 ${cur} = ${rateStr} BRL`;
      sugg.style.display = '';
      sugg.style.background = '';
      sugg.style.color = '';
    }
    updateScCurrencyPreview();
  } catch (e) {
    if (sugg) {
      sugg.textContent = `⚠️ Não foi possível buscar: ${e.message}. Informe manualmente.`;
      sugg.style.display = '';
      sugg.style.background = '#fef9c3';
      sugg.style.color = '#92400e';
    }
  } finally {
    if (btn)  btn.disabled = false;
    if (icon) icon.textContent = '🔄';
  }
}

function onScTransferAccountChange() {
  const { src, dst } = _getScTransferCurrencies();
  const panel = document.getElementById('scFxPanel');
  if (!panel) return;
  const type = document.getElementById('scTypeField').value;
  if (type !== 'transfer' || !src || !dst || src === dst) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = '';
  const title = document.getElementById('scFxTitle');
  const label = document.getElementById('scFxLabel');
  if (title) title.textContent = `Câmbio: ${src} → ${dst}`;
  if (label) label.textContent = `(1 ${src} = ? ${dst})`;
  updateScFxPreview();
}

function setScFxMode(mode) {
  const fixedBtn  = document.getElementById('scFxModeFixed');
  const apiBtn    = document.getElementById('scFxModeApi');
  const fixedPan  = document.getElementById('scFxFixedPanel');
  const apiPan    = document.getElementById('scFxApiPanel');
  const activeStyle   = 'border-color:#2563eb;background:#2563eb;color:#fff;';
  const inactiveStyle = 'border-color:#e5e7eb;background:transparent;color:#6b7280;';
  if (mode === 'fixed') {
    if (fixedBtn) fixedBtn.style.cssText += activeStyle;
    if (apiBtn)   apiBtn.style.cssText   += inactiveStyle;
    if (fixedPan) fixedPan.style.display = '';
    if (apiPan)   apiPan.style.display   = 'none';
    document.getElementById('scFxPanel')?.setAttribute('data-fx-mode', 'fixed');
  } else {
    if (fixedBtn) fixedBtn.style.cssText += inactiveStyle;
    if (apiBtn)   apiBtn.style.cssText   += activeStyle;
    if (fixedPan) fixedPan.style.display = 'none';
    if (apiPan)   apiPan.style.display   = '';
    document.getElementById('scFxPanel')?.setAttribute('data-fx-mode', 'api');
  }
}

async function fetchScSuggestedFxRate() {
  const { src, dst } = _getScTransferCurrencies();
  if (!src || !dst || src === dst) return;
  const btn  = document.getElementById('scFxFetchBtn');
  const icon = document.getElementById('scFxFetchIcon');
  const sugg = document.getElementById('scFxSuggestion');
  if (btn) btn.disabled = true;
  if (icon) icon.textContent = '⏳';
  if (sugg) sugg.style.display = 'none';
  try {
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch(`https://api.frankfurter.app/${today}?base=${src}&to=${dst}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const rate = json?.rates?.[dst];
    if (!rate) throw new Error('Taxa não encontrada');
    const rateStr = Number(rate).toFixed(6);
    const input = document.getElementById('scFxRate');
    if (input) input.value = rateStr;
    if (sugg) {
      sugg.textContent = `📡 Cotação de ${json.date||today} (BCE): 1 ${src} = ${rateStr} ${dst}`;
      sugg.style.display = '';
      sugg.style.background = '';
      sugg.style.color = '';
    }
    updateScFxPreview();
  } catch(e) {
    if (sugg) {
      sugg.textContent = `⚠️ Não foi possível buscar: ${e.message}`;
      sugg.style.display = '';
      sugg.style.background = '#fef9c3';
      sugg.style.color = '#92400e';
    }
  } finally {
    if (btn) btn.disabled = false;
    if (icon) icon.textContent = '🔄';
  }
}

function updateScFxPreview() {
  const { src, dst } = _getScTransferCurrencies();
  const rateVal = parseFloat(document.getElementById('scFxRate')?.value?.replace(',', '.'));
  const amtVal  = getAmtField('scAmount');
  const preview = document.getElementById('scFxPreview');
  if (!preview) return;
  if (!rateVal || isNaN(rateVal) || !amtVal) { preview.textContent = ''; return; }
  preview.textContent = `= ${fmt(Math.abs(amtVal) * rateVal, dst)}`;
}

function _filterScAccountOrigin(excludeCreditCards) {
  const sel = document.getElementById('scAccountId');
  if (!sel || !state.accounts) return;
  const currentVal = sel.value;
  const accounts = excludeCreditCards
    ? state.accounts.filter(a => a.type !== 'cartao_credito')
    : state.accounts;
  sel.innerHTML = accounts.map(a =>
    `<option value="${a.id}"${a.id===currentVal?' selected':''}>${esc(a.name)} (${a.currency})</option>`
  ).join('');
  if (excludeCreditCards && currentVal) {
    const acct = state.accounts.find(a => a.id === currentVal);
    if (acct && acct.type === 'cartao_credito') sel.value = '';
  }
}

function onScFreqChange() {
  const freq = document.querySelector('input[name=scFreq]:checked')?.value || 'once';
  document.getElementById('scCustomIntervalGroup').style.display = freq==='custom' ? '' : 'none';
  document.getElementById('scEndGroup').style.display = freq==='once' ? 'none' : '';
  updateScPreview();
}

function onScEndChange() {
  const end = document.querySelector('input[name=scEnd]:checked')?.value || 'forever';
  document.getElementById('scEndCountGroup').style.display = end==='count' ? '' : 'none';
  document.getElementById('scEndDateGroup').style.display = end==='date' ? '' : 'none';
  updateScPreview();
}

function updateScPreview() {
  const preview = document.getElementById('scPreview');
  if(!preview) return;
  const freq = document.querySelector('input[name=scFreq]:checked')?.value || 'once';
  const start = document.getElementById('scStartDate').value;
  const end = document.querySelector('input[name=scEnd]:checked')?.value || 'forever';
  const count = parseInt(document.getElementById('scEndCount').value) || null;
  const endDate = document.getElementById('scEndDate').value;
  const interval = parseInt(document.getElementById('scCustomInterval').value) || 1;
  const unit = document.getElementById('scCustomUnit').value;

  if(!start) { preview.innerHTML = '<span style="color:var(--muted2)">Defina a data de início para ver o resumo.</span>'; return; }

  const sc = { frequency: freq, start_date: start, end_count: end==='count'?count:null, end_date: end==='date'?endDate:null, custom_interval: interval, custom_unit: unit, occurrences: [] };
  const dates = generateOccurrences(sc, 6);

  let html = `<strong>${FREQ_LABELS[freq]||freq}</strong>`;
  if(freq==='custom') html += ` — a cada ${interval} ${({days:'dia(s)',weeks:'semana(s)',months:'mês/meses',years:'ano(s)'})[unit]}`;
  if(end==='count' && count) html += ` · <strong>${count}x</strong> parcelas`;
  if(end==='date' && endDate) html += ` · até <strong>${fmtDate(endDate)}</strong>`;
  if(freq !== 'once' && end==='forever') html += ' · indefinido';

  if(dates.length) {
    html += `<div class="sc-dates">${dates.map((d,i)=>`<span class="sc-date-chip">${i===0?'1ª: ':''}${fmtDate(d)}</span>`).join('')}${end!=='count'||!count||count>6?'<span class="sc-date-chip" style="opacity:.5">…</span>':''}</div>`;
  }
  preview.innerHTML = html;
}

async function saveScheduled() {
  const id = document.getElementById('scId').value;
  const freq = document.querySelector('input[name=scFreq]:checked')?.value || 'once';
  const endType = document.querySelector('input[name=scEnd]:checked')?.value || 'forever';
  const type = document.getElementById('scTypeField').value;
  const amount = getAmtField('scAmount');
  const tags = document.getElementById('scTags').value.split(',').map(s=>s.trim()).filter(Boolean);

  const autoReg = document.getElementById('scAutoRegister')?.checked || false;
  const autoConfirm = document.getElementById('scAutoConfirm')?.checked ?? true;
  const notifyEm = document.getElementById('scNotifyEmail')?.checked || false;
  const isScTransfer = type==='transfer' || type==='card_payment';
  const isScCardPayment = type==='card_payment';

  // FX settings for cross-currency transfers
  const fxPanel   = document.getElementById('scFxPanel');
  const fxVisible = fxPanel && fxPanel.style.display !== 'none';
  const fxMode    = fxVisible ? (fxPanel.getAttribute('data-fx-mode') || 'fixed') : null;
  const fxRateRaw = parseFloat(document.getElementById('scFxRate')?.value?.replace(',', '.'));
  const fxRate    = (fxMode === 'fixed' && fxRateRaw > 0) ? fxRateRaw : null;

  // Moeda da conta de origem
  const _scAcc     = (state.accounts || []).find(a => a.id === document.getElementById('scAccountId').value);
  const scCurrency = _scAcc?.currency || 'BRL';
  let scBrlAmount  = null;
  if (!isScTransfer && scCurrency !== 'BRL') {
    const fxRate = parseFloat(document.getElementById('scCurrencyRate')?.value?.replace(',', '.'));
    if (fxRate > 0) scBrlAmount = Math.abs(amount) * fxRate;
  }

  const data = {
    description: document.getElementById('scDesc').value.trim(),
    type,
    amount: (type==='expense'||isScTransfer) ? -Math.abs(amount) : Math.abs(amount),
    currency:   scCurrency,
    brl_amount: scBrlAmount,
    account_id: document.getElementById('scAccountId').value || null,
    transfer_to_account_id: isScTransfer ? (document.getElementById('scTransferToAccountId')?.value || null) : null,
    payee_id: isScTransfer ? null : (document.getElementById('scPayeeId').value || null),
    category_id: document.getElementById('scCategoryId').value || null,
    memo: document.getElementById('scMemo').value,
    tags: tags.length ? tags : null,
    status: document.getElementById('scStatus').value,
    start_date: document.getElementById('scStartDate').value,
    frequency: freq,
    custom_interval: freq==='custom' ? parseInt(document.getElementById('scCustomInterval').value)||1 : null,
    custom_unit: freq==='custom' ? document.getElementById('scCustomUnit').value : null,
    end_count: endType==='count' ? parseInt(document.getElementById('scEndCount').value)||null : null,
    end_date: endType==='date' ? document.getElementById('scEndDate').value||null : null,
    auto_register: autoReg,
    auto_confirm: autoConfirm,
    notify_email: notifyEm,
    notify_email_addr: notifyEm ? (document.getElementById('scNotifyEmailAddr')?.value.trim()||null) : null,
    notify_days_before: notifyEm ? parseInt(document.getElementById('scNotifyDaysBefore')?.value||'1') : 1,
    fx_mode:  fxVisible ? fxMode : null,
    fx_rate:  fxRate,
    updated_at: new Date().toISOString(),
  };

  if(!data.description) { toast('Informe a descrição', 'error'); return; }
  if(!data.account_id) { toast('Selecione a conta', 'error'); return; }
  if(isScTransfer && !data.transfer_to_account_id) { toast('Selecione a conta destino da transferência', 'error'); return; }
  if(isScTransfer && data.account_id === data.transfer_to_account_id) { toast('Conta origem e destino não podem ser iguais', 'error'); return; }
  if(!data.start_date) { toast('Informe a data de início', 'error'); return; }

  let err;
  if(!id) data.family_id = famId();
  if(id) { ({error:err} = await sb.from('scheduled_transactions').update(data).eq('id',id)); }
  else    { ({error:err} = await sb.from('scheduled_transactions').insert(data)); }
  if(err) { toast(err.message,'error'); return; }
  toast(id?'Programação atualizada!':'Transação programada!','success');
  closeModal('scheduledModal');
  loadScheduled();
}

async function deleteScheduled(id) {
  if(!confirm('Excluir esta programação e todas as ocorrências?')) return;
  await sb.from('scheduled_occurrences').delete().eq('scheduled_id', id);
  const {error} = await sb.from('scheduled_transactions').delete().eq('id', id);
  if(error) { toast(error.message,'error'); return; }
  toast('Removido','success');
  loadScheduled();
}

async function toggleScStatus(id) {
  const sc = state.scheduled.find(s=>s.id===id);
  if(!sc) return;
  const newStatus = sc.status==='active'?'paused':'active';
  const {error} = await sb.from('scheduled_transactions').update({status:newStatus}).eq('id',id);
  if(error) { toast(error.message,'error'); return; }
  sc.status = newStatus;
  filterScheduled();
}

// ── Register Occurrence ────────────────────────────────
let _registerOccScId = null;
let _registerOccDate = null;

function openRegisterOcc(scId, date) {
  _registerOccScId = scId;
  _registerOccDate = date;
  const sc = state.scheduled.find(s=>s.id===scId);
  if(!sc) return;
  document.getElementById('occScId').value = scId;
  document.getElementById('occDate').value = date;
  setAmtField('occAmount', sc.amount);
  document.getElementById('occMemo').value = '';
  document.getElementById('registerOccDesc').textContent = `Registrar "${sc.description}" em ${fmtDate(date)} — isso criará uma transação real na conta ${sc.accounts?.name||''}.`;
  openModal('registerOccModal');
}

async function confirmRegisterOccurrence() {
  const scId = _registerOccScId;
  const schedDate = _registerOccDate;
  const sc = state.scheduled.find(s=>s.id===scId);
  if(!sc) return;

  const actualDate = document.getElementById('occDate').value;
  const amount = getAmtField('occAmount') || Math.abs(sc.amount);
  const memo = document.getElementById('occMemo').value;
  const isScTransfer = sc.type==='transfer' || sc.type==='card_payment';
  const finalAmount = (sc.type==='expense' || isScTransfer) ? -Math.abs(amount) : Math.abs(amount);

  // 1. Create real transaction (debit / origin leg)
  const txStatus = (sc.auto_confirm ?? true) ? 'confirmed' : 'pending';
  const { data: txData, error: txErr } = await sb.from('transactions').insert({ family_id: famId(),
    date: actualDate,
    description: sc.description,
    amount: finalAmount,
    account_id: sc.account_id,
    payee_id: sc.payee_id || null,
    category_id: sc.category_id || null,
    memo: memo || sc.memo,
    tags: sc.tags,
    is_transfer: isScTransfer,
    is_card_payment: sc.type==='card_payment',
    transfer_to_account_id: isScTransfer ? sc.transfer_to_account_id : null,
    updated_at: new Date().toISOString(),
    status: txStatus,
  }).select().single();
  if(txErr) { toast(txErr.message,'error'); return; }

  // 1b. For transfers/card payments, create the paired credit leg
  if(isScTransfer && sc.transfer_to_account_id && txData?.id) {
    const pairedTx = {
      family_id: famId(),
      date: actualDate,
      description: sc.description,
      amount: Math.abs(finalAmount),
      account_id: sc.transfer_to_account_id,
      payee_id: null,
      category_id: sc.category_id || null,
      memo: memo || sc.memo,
      tags: sc.tags,
      is_transfer: true,
      is_card_payment: sc.type==='card_payment',
      transfer_to_account_id: sc.account_id,
      updated_at: new Date().toISOString(),
    };
    // Try with linked_transfer_id first; fall back without if column doesn't exist yet
    let pairedResult, pairedErr;
    ({data: pairedResult, error: pairedErr} = await sb.from('transactions')
      .insert({...pairedTx, linked_transfer_id: txData.id}).select().single());
    if(pairedErr && pairedErr.message?.includes('linked_transfer_id')) {
      ({data: pairedResult, error: pairedErr} = await sb.from('transactions')
        .insert(pairedTx).select().single());
    }
    if(pairedErr) {
      toast('Transação salva, mas erro ao criar lançamento de entrada: ' + pairedErr.message, 'warning');
    } else if(pairedResult?.id) {
      await sb.from('transactions').update({linked_transfer_id: pairedResult.id}).eq('id', txData.id).then(()=>{}).catch(()=>{});
    }
  }

  // 2. Register occurrence
  const { error: occErr } = await sb.from('scheduled_occurrences').insert({
    scheduled_id: scId,
    scheduled_date: schedDate,
    actual_date: actualDate,
    amount: finalAmount,
    memo,
    transaction_id: txData.id,
  });
  if(occErr) { toast(occErr.message,'error'); return; }

  toast('Transação registrada!','success');
  closeModal('registerOccModal');
  loadScheduled();
}

// Payee autocomplete for SC modal uses shared onPayeeInput/selectPayee with ctx='sc'

// ── SQL for table creation ─────────────────────────────
const SCHEDULED_SQL = `-- Run this in your Supabase SQL Editor
CREATE TABLE IF NOT EXISTS scheduled_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('expense','income','transfer','card_payment')),
  amount NUMERIC NOT NULL,
  account_id UUID REFERENCES accounts(id),
  transfer_to_account_id UUID REFERENCES accounts(id),
  payee_id UUID REFERENCES payees(id),
  category_id UUID REFERENCES categories(id),
  memo TEXT,
  tags TEXT[],
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','finished')),
  start_date DATE NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'once'
    CHECK (frequency IN ('once','weekly','biweekly','monthly','bimonthly','quarterly','semiannual','annual','custom')),
  custom_interval INTEGER,
  custom_unit TEXT CHECK (custom_unit IN ('days','weeks','months','years')),
  end_count INTEGER,
  end_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scheduled_occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_id UUID NOT NULL REFERENCES scheduled_transactions(id) ON DELETE CASCADE,
  scheduled_date DATE NOT NULL,
  actual_date DATE,
  amount NUMERIC,
  memo TEXT,
  transaction_id UUID REFERENCES transactions(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE scheduled_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_occurrences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON scheduled_transactions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON scheduled_occurrences FOR ALL USING (true) WITH CHECK (true);`;


/* ═══════════════════════════════════════════════════════════════
   ATTACHMENT UPLOAD (Supabase Storage)
═══════════════════════════════════════════════════════════════ */


async function runScheduledAutoRegister() {
  // Runs in browser session after boot. Registers missing occurrences up to today (and optionally days ahead).
  try {
    const cfg = getAutoCheckConfig ? getAutoCheckConfig() : { daysAhead: 0 };
    const daysAhead = parseInt(cfg?.daysAhead || 0, 10) || 0;
    const today = new Date();
    const toDate = new Date(today.getTime() + daysAhead*86400000);
    const toStr = toDate.toISOString().slice(0,10);
    const todayStr = today.toISOString().slice(0,10);

    // Ensure scheduled loaded
    if(!state.scheduled || !state.scheduled.length) return 0;

    let created = 0;
    const createdItems = [];
    for(const sc of state.scheduled) {
      if(sc.status !== 'active' || !sc.auto_register) continue;
      const occDates = generateOccurrences(sc, 500);
      const registered = new Set((sc.occurrences||[]).filter(o=>o.transaction_id).map(o=>o.scheduled_date));
      for(const d of occDates) {
        if(d > toStr) continue;
        if(registered.has(d)) continue;

        // Reuse manual register flow (but without UI modal)
        const actualDate = d; // register on scheduled date
        const isScTransfer = sc.type==='transfer' || sc.type==='card_payment';
        const amount = sc.amount;
        const finalAmount = amount; // already signed in DB
        const txStatus = (sc.auto_confirm ?? true) ? 'confirmed' : 'pending';

        const { data: txData, error: txErr } = await sb.from('transactions').insert({ family_id: famId(),
          date: actualDate,
          description: sc.description,
          amount: finalAmount,
          account_id: sc.account_id,
          payee_id: isScTransfer ? null : (sc.payee_id || null),
          category_id: sc.category_id || null,
          memo: sc.memo,
          tags: sc.tags,
          is_transfer: isScTransfer,
          is_card_payment: sc.type==='card_payment',
          transfer_to_account_id: isScTransfer ? sc.transfer_to_account_id : null,
          updated_at: new Date().toISOString(),
          status: txStatus,
        }).select().single();
        if(txErr) { console.warn('[auto_register]', txErr.message); continue; }

        if(isScTransfer) await _createPairedTransferLeg(txData, sc, actualDate, sc.memo);

        createdItems.push({ scheduled_id: sc.id, description: sc.description, date: actualDate, amount: finalAmount, status: txStatus, tx_id: txData.id, notify_email: sc.notify_email, notify_email_addr: sc.notify_email_addr });

        // Optional email notification via EmailJS
        try{
          const cfg2 = getAutoCheckConfig ? getAutoCheckConfig() : null;
          const method = cfg2?.method || 'browser';
          const emailTo = sc.notify_email ? (sc.notify_email_addr || cfg2?.emailDefault || currentUser?.email) : null;
          if(method==='email' && emailTo && typeof sendScheduledNotification==='function') {
            await sendScheduledNotification(sc, actualDate, finalAmount, emailTo);
          }
        }catch(e){ console.warn('[auto_register notify]', e.message); }


        // mark occurrence
        const { error: occErr } = await sb.from('scheduled_occurrences').insert({
          scheduled_id: sc.id,
          scheduled_date: d,
          actual_date: actualDate,
          amount: finalAmount,
          memo: sc.memo,
          transaction_id: txData.id
        });
        if(occErr) console.warn('[auto_register occ]', occErr.message);

        created++;

        // If this scheduled is one-time, remove it from scheduled list after execution on its due date
        try{
          if((sc.frequency==='once' || sc.frequency==='single' || !sc.frequency) && d===todayStr){
            await sb.from('scheduled_transactions').delete().eq('id', sc.id);
          }
        }catch(e){ console.warn('[auto_register delete]', e.message); }

      }
    }
    if(created) {
      // Persist audit logs (best-effort)
      try{
        for(const it of createdItems){
          await insertScheduledRunLog({
            family_id: famId(),
            scheduled_id: it.scheduled_id,
            scheduled_date: it.date,
            transaction_id: it.tx_id,
            status: it.status,
            amount: it.amount,
            description: it.description,
            created_at: new Date().toISOString(),
          });
        }
      }catch(e){}

      // Browser notification summary
      try{ await showAutoRegisterNotification(createdItems); }catch(e){}

      await loadScheduled(); // refresh occurrences
      await loadAccounts();  // refresh balances (pending excluded now)
      if(state.currentPage==='transactions') loadTransactions();
      if(state.currentPage==='dashboard') loadDashboard();
      toast(`✓ ${created} ocorrência(s) registrada(s) automaticamente`, 'success');
    }
    return created;
  } catch(e) {
    console.warn('runScheduledAutoRegister error', e);
    return 0;
  }
}


// ─────────────────────────────────────────────
// Auto-run logs (admin audit)
// ─────────────────────────────────────────────
async function insertScheduledRunLog(entry){
  try{
    if(!sb) return;
    // Best-effort (table may not exist yet)
    await sb.from('scheduled_run_logs').insert(entry);
  }catch(e){
    // ignore if table missing
    console.warn('[scheduled_run_logs]', e.message);
  }
}


async function showAutoRegisterNotification(items){
  if(!items || !items.length) return;
  const title = `FinTrack: ${items.length} programada(s) registrada(s) ✅`;
  const body  = items.slice(0,3).map(i=>`• ${i.description} (${fmt(i.amount)})`).join('\n') + (items.length>3?`\n… +${items.length-3} outras`:'');
  // Try Service Worker notification first (best on mobile/PWA)
  try{
    if('serviceWorker' in navigator){
      const reg = await navigator.serviceWorker.getRegistration();
      if(reg && reg.showNotification){
        await reg.showNotification(title, { body, tag:'fintrack-autoreg', renotify:false });
        return;
      }
    }
  }catch(e){}
  // Fallback to Notification API (in-page)
  if(!('Notification' in window)) return;
  if(Notification.permission === 'default'){
    // Do not force prompt; keep user-driven via settings
    return;
  }
  if(Notification.permission === 'granted'){
    try{ new Notification(title, { body }); }catch(e){}
  }
}
