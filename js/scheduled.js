// ── State ──────────────────────────────────────────────
state.scheduled = [];

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
    const { data, error } = await famQ(sb.from('scheduled_transactions').select('*, accounts!scheduled_transactions_account_id_fkey(name,currency), payees(name), categories(name,color), occurrences:scheduled_occurrences(id,scheduled_date,actual_date,amount,memo,transaction_id)')).order('start_date');
    if(error) throw error;
    state.scheduled = data || [];
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

function filterScheduled() {
  const search = (document.getElementById('scSearch')?.value||'').toLowerCase();
  const statusF = document.getElementById('scStatusFilter')?.value||'';
  const typeF = document.getElementById('scTypeFilter')?.value||'';

  let list = state.scheduled;
  if(search) list = list.filter(s => s.description?.toLowerCase().includes(search) || s.payees?.name?.toLowerCase().includes(search));
  if(typeF) list = list.filter(s => s.type === typeF);
  if(statusF) {
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
        <div class="sc-card-amount ${isExpense?'amount-neg':'amount-pos'}">
          ${isCardPayment?'💳 ':''}${isTransferSc?'🔄 ':''}${isExpense?'-':'+'} ${fmt(Math.abs(sc.amount))}
          ${isTransferSc&&destAcct?`<span style="font-size:.7rem;color:var(--muted)"> → ${esc(destAcct.name)}</span>`:''}
        </div>
        <div class="sc-card-actions" onclick="event.stopPropagation()">
          ${next ? `<button class="btn btn-primary btn-sm" onclick="openRegisterOcc('${sc.id}','${next}')" title="Registrar próxima ocorrência">✓ Registrar</button>` : ''}
          <button class="btn-icon" onclick="openScheduledModal('${sc.id}')" title="Editar">✏️</button>
          <button class="btn-icon" onclick="deleteScheduled('${sc.id}')" title="Excluir">🗑️</button>
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
        <div style="padding:8px 16px 12px;display:flex;gap:8px;border-top:1px solid var(--border);flex-wrap:wrap">
          <span style="font-size:.75rem;color:var(--muted)">Conta: <strong>${esc(acct?.name||'—')}</strong></span>
          ${isTransferSc&&destAcct?`<span style="font-size:.75rem;color:var(--muted)">→ Destino: <strong>${esc(destAcct.name)}</strong></span>`:''}
          ${sc.memo ? `<span style="font-size:.75rem;color:var(--muted)">· ${esc(sc.memo)}</span>` : ''}
          <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="toggleScStatus('${sc.id}')">
            ${sc.status==='active'?'⏸ Pausar':'▶ Reativar'}
          </button>
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

  const card = document.getElementById('scheduledUpcomingCard');
  const body = document.getElementById('scheduledUpcomingBody');
  const totalEl = document.getElementById('scheduledUpcomingTotal');
  if(!upcoming.length) { if(card) card.style.display='none'; return; }

  if(card) card.style.display='';
  if(totalEl) {
    const total = upcoming.reduce((s,u) => s + (u.sc.type==='expense'?-1:1)*Math.abs(u.sc.amount), 0);
    totalEl.textContent = (total>=0?'+':'') + fmt(total);
    totalEl.className = 'badge ' + (total>=0?'badge-green':'badge-red');
  }
  if(body) body.innerHTML = upcoming.slice(0, 20).map(({sc, date}) => {
    const isOverdue = date < today;
    const isExpense = sc.type === 'expense';
    return `<tr class="${isOverdue?'sc-upcoming-row-overdue':''}">
      <td class="${isOverdue?'amount-neg':'text-muted'}" style="white-space:nowrap">${fmtDate(date)}${isOverdue?' ⚠':''}</td>
      <td>${esc(sc.description)}${sc.payees?`<span style="color:var(--muted);font-size:.78rem"> · ${esc(sc.payees.name)}</span>`:''}</td>
      <td><span class="badge badge-muted">${esc(sc.accounts?.name||'—')}</span></td>
      <td class="${isExpense?'amount-neg':'amount-pos'}" style="white-space:nowrap">${isExpense?'-':'+'} ${fmt(Math.abs(sc.amount))}</td>
      <td><button class="btn btn-primary btn-sm" onclick="openRegisterOcc('${sc.id}','${date}')">✓ Registrar</button></td>
    </tr>`;
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

  // Type
  setScType(sc?.type||'expense');

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

  // Auto-register & notify fields
  const arEl = document.getElementById('scAutoRegister');
  const neEl = document.getElementById('scNotifyEmail');
  const naEl = document.getElementById('scNotifyEmailAddr');
  const ndEl = document.getElementById('scNotifyDaysBefore');
  const ndDiv = document.getElementById('scNotifyEmailDetails');
  if(arEl) arEl.checked = sc?.auto_register || false;
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
  // Filter source account: card_payment origin cannot be a credit card account
  _filterScAccountOrigin(isCardPayment);
  // Rebuild category picker for this type
  buildCatPicker(null, 'sc');
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
  const notifyEm = document.getElementById('scNotifyEmail')?.checked || false;
  const isScTransfer = type==='transfer' || type==='card_payment';
  const isScCardPayment = type==='card_payment';
  const data = {
    description: document.getElementById('scDesc').value.trim(),
    type,
    amount: (type==='expense'||isScTransfer) ? -Math.abs(amount) : Math.abs(amount),
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
    notify_email: notifyEm,
    notify_email_addr: notifyEm ? (document.getElementById('scNotifyEmailAddr')?.value.trim()||null) : null,
    notify_days_before: notifyEm ? parseInt(document.getElementById('scNotifyDaysBefore')?.value||'1') : 1,
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
