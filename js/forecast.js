/* ═══════════════════════════════════════════════════════════════════════
   FORECAST.JS  —  Previsão de fluxo de caixa
   Corrigido: nested function bug, dependências de estado, fallbacks robustos
═══════════════════════════════════════════════════════════════════════ */

const _forecastDateUtils = window.FinTrackDateUtils || {
  getUserLocale: () => document?.documentElement?.lang || navigator.language || 'pt-BR',
  getTodayLocalISO: () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  },
};

// ── Safe wrappers (funcionam mesmo se i18n/utils não carregou ainda) ──────────
const _fct   = (key) => { try { return t(key); } catch(_) { return key; } };
const _fcEsc = (s)   => { try { return esc(s); } catch(_) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); } };
const _fcFmt = (v,c) => { try { return fmt(v,c); } catch(_) { return String(Number(v||0).toFixed(2)); } };

// ── Data de partes — FORA de qualquer outra função (era o bug principal) ──────
function _forecastDateParts(iso) {
  try {
    const dt = new Date(`${String(iso||'').slice(0,10)}T12:00:00`);
    if (Number.isNaN(dt.getTime())) return { weekday:'', day:'--', monthYear:'', short:'—' };
    const locale  = _forecastDateUtils.getUserLocale();
    const weekday = new Intl.DateTimeFormat(locale, { weekday:'short' }).format(dt).replace('.','').toUpperCase();
    const day     = new Intl.DateTimeFormat(locale, { day:'2-digit' }).format(dt);
    const month   = new Intl.DateTimeFormat(locale, { month:'short' }).format(dt).replace('.','').toUpperCase();
    const year    = new Intl.DateTimeFormat(locale, { year:'2-digit' }).format(dt);
    return {
      weekday,
      day,
      monthYear: `${month} · ${year}`,
      short: `${day}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`,
    };
  } catch(_) {
    return { weekday:'', day:'--', monthYear:'', short:'—' };
  }
}

// ── Account picker init ───────────────────────────────────────────────────────
function _initForecastPicker(savedIds) {
  if (typeof _fcPickerBuild !== 'function') return;
  _fcPickerBuild('forecastAcctPicker', savedIds || [], loadForecast);
}

// ── Chart instance ────────────────────────────────────────────────────────────
let forecastChartInstance = null;

function _destroyForecastChart() {
  if (forecastChartInstance) {
    try { forecastChartInstance.destroy(); } catch(_) {}
    forecastChartInstance = null;
  }
}

function _fcNormalizeCacheItem(item, idx) {
  const safe = { ...(item || {}) };
  safe.__forecast_uid = safe.__forecast_uid || [
    safe.id || 'sc',
    safe.account_id || 'na',
    safe.date || 'nd',
    idx,
  ].join('::');
  return safe;
}


function _fcGetSupabase() {
  try {
    if (typeof sb !== 'undefined' && sb) return sb;
  } catch(_) {}
  try {
    if (window.sb) return window.sb;
  } catch(_) {}
  try {
    if (typeof ensureSupabaseClient === 'function') {
      const client = ensureSupabaseClient();
      if (client) return client;
    }
  } catch(_) {}
  try {
    if (typeof window.ensureSupabaseClient === 'function') {
      const client = window.ensureSupabaseClient();
      if (client) return client;
    }
  } catch(_) {}
  return null;
}

function _fcGetCurrentUser() {
  try {
    if (typeof currentUser !== 'undefined' && currentUser) return currentUser;
  } catch(_) {}
  try {
    if (window.currentUser) return window.currentUser;
  } catch(_) {}
  try {
    if (state && state.user) return state.user;
  } catch(_) {}
  return null;
}

async function _fcHydrateAuthContext() {
  let client = _fcGetSupabase();
  let user = _fcGetCurrentUser();

  if (!client) {
    try { client = typeof ensureSupabaseClient === 'function' ? ensureSupabaseClient() : client; } catch(_) {}
    try { client = client || (typeof window.ensureSupabaseClient === 'function' ? window.ensureSupabaseClient() : null); } catch(_) {}
  }
  if (client && !window.sb) {
    try { window.sb = client; } catch(_) {}
  }

  if (!user && client?.auth?.getSession) {
    try {
      const { data } = await client.auth.getSession();
      const authUser = data?.session?.user || null;
      if (authUser) {
        user = _fcGetCurrentUser() || {
          id: authUser.id,
          email: authUser.email || '',
          name: authUser.user_metadata?.name || authUser.email || 'Usuário',
          family_id: null,
        };
      }
    } catch(_) {}
  }

  if (user && !window.currentUser) {
    try { window.currentUser = user; } catch(_) {}
  }

  return { client, user };
}

// ── Garante que state.accounts e state.scheduled estão carregados ────────────
async function _fcEnsureState(client) {
  const sbClient = client || _fcGetSupabase();

  if (!state.accounts || !state.accounts.length) {
    try {
      if (typeof DB !== 'undefined' && DB.accounts && typeof DB.accounts.load === 'function') {
        await DB.accounts.load();
      } else if (sbClient) {
        const { data } = await famQ(
          sbClient.from('accounts')
            .select('id,name,color,currency,icon,type,balance,confirmed_balance,active,is_favorite')
            .eq('active', true)
        ).order('name');
        state.accounts = data || [];
      }
    } catch(e) { console.warn('[forecast] accounts load:', e?.message); }
  }

  if (!state.scheduled || !state.scheduled.length) {
    try {
      if (typeof loadScheduled === 'function') await loadScheduled();
    } catch(e) { console.warn('[forecast] scheduled load:', e?.message); }
  }
}

// ── loadForecast — função principal ──────────────────────────────────────────
async function loadForecast() {
  const { client: sbClient, user } = await _fcHydrateAuthContext();

  const fromStr = document.getElementById('forecastFrom')?.value || '';
  const toStr   = document.getElementById('forecastTo')?.value   || '';
  if (!fromStr || !toStr) return;

  const container = document.getElementById('forecastAccountsContainer');
  if (!sbClient) {
    console.warn('[forecast] Supabase não disponível para carregar a previsão');
    if (container) {
      container.innerHTML = `
      <div class="card" style="text-align:center;padding:40px;color:var(--muted)">
        <div style="font-size:2rem;margin-bottom:12px">⚠️</div>
        <p>Supabase não está disponível para carregar a previsão.</p>
      </div>`;
    }
    _destroyForecastChart();
    return;
  }

  if (!user) {
    console.warn('[forecast] contexto do usuário ausente para previsão');
    if (container) {
      container.innerHTML = `
      <div class="card" style="text-align:center;padding:40px;color:var(--muted)">
        <div style="font-size:2rem;margin-bottom:12px">⚠️</div>
        <p>Não foi possível identificar a sessão do usuário para carregar a previsão.</p>
      </div>`;
    }
    _destroyForecastChart();
    return;
  }

  const accIds = typeof _fcPickerGetSelected === 'function'
    ? _fcPickerGetSelected('forecastAcctPicker')
    : [];
  const includeScheduled = document.getElementById('forecastIncludeScheduled')?.checked !== false;

  // Salva preferência
  try {
    if (typeof _dashGetPrefs === 'function' && typeof _dashSavePrefs === 'function') {
      _dashSavePrefs({ ..._dashGetPrefs(), forecastAccounts: accIds }).catch(() => {});
    }
  } catch(_) {}

  // Loading
  if (container) {
    container.innerHTML = `
      <div style="text-align:center;padding:48px 24px;color:var(--muted)">
        <div style="font-size:2rem;margin-bottom:10px">⏳</div>
        <div style="font-size:.88rem">Carregando previsão…</div>
      </div>`;
  }

  // Garante estado
  await _fcEnsureState(sbClient);

  // ── 1. Transações reais do período ──────────────────────────────────────
  let txData = [];
  try {
    let q = famQ(
      sbClient.from('transactions')
        .select([
          'id','date','description','amount','currency','brl_amount',
          'account_id','is_transfer',
          'categories(name,color,icon)',
          'payees(name)',
          'accounts!transactions_account_id_fkey(id,name,color,currency,icon,type,balance)',
        ].join(', '))
        .gte('date', fromStr)
        .lte('date', toStr)
        .order('date')
    );
    if (accIds.length === 1) q = q.eq('account_id', accIds[0]);
    else if (accIds.length > 1) q = q.in('account_id', accIds);

    const { data, error } = await q;
    if (error) throw error;
    txData = data || [];
  } catch(e) {
    console.error('[forecast] transactions query:', e?.message);
    if (container) container.innerHTML = `
      <div class="card" style="text-align:center;padding:40px;color:var(--muted)">
        <div style="font-size:2rem;margin-bottom:12px">⚠️</div>
        <p>Erro ao carregar transações: ${_fcEsc(e?.message||'Verifique sua conexão.')}</p>
      </div>`;
    _destroyForecastChart();
    return;
  }

  // ── 2. Transações programadas do período ────────────────────────────────
  const scheduledItems = [];
  if (includeScheduled && (state.scheduled||[]).length) {
    const schList = accIds.length
      ? state.scheduled.filter(s => accIds.includes(s.account_id) || accIds.includes(s.transfer_to_account_id))
      : state.scheduled;

    schList.forEach(sc => {
      if (sc.status === 'paused') return;
      if (typeof generateOccurrences !== 'function') return;

      let occ;
      try { occ = generateOccurrences(sc, 200); } catch(_) { return; }

      const registered    = new Set((sc.occurrences||[]).map(o => o.scheduled_date));
      const isTransfer    = sc.type === 'transfer' || sc.type === 'card_payment';
      const isIncome      = sc.type === 'income';
      const isExpense     = sc.type === 'expense';
      const isCardPayment = sc.type === 'card_payment';
      const baseAmt       = Math.abs(parseFloat(sc.amount)||0);

      occ.forEach(date => {
        if (date < fromStr || date > toStr || registered.has(date)) return;

        if (!accIds.length || accIds.includes(sc.account_id)) {
          let originAmt = 0;
          if (isIncome)  originAmt =  baseAmt;
          else if (isExpense || isTransfer || isCardPayment) originAmt = -baseAmt;
          if (originAmt !== 0) {
            scheduledItems.push({
              date, description: sc.description||'', amount: originAmt,
              currency: sc.currency || sc.accounts?.currency || 'BRL',
              account_id: sc.account_id,
              categories: sc.categories||null, payees: sc.payees||null,
              isScheduled: true,
              source_scheduled_id: sc.id || null,
              scheduled_date: date,
              type: sc.type || null,
            });
          }
        }

        if ((isTransfer||isCardPayment) && sc.transfer_to_account_id &&
            (!accIds.length || accIds.includes(sc.transfer_to_account_id))) {
          let creditAmt = baseAmt;
          if (sc.fx_mode==='fixed' && sc.fx_rate>0) creditAmt *= sc.fx_rate;
          scheduledItems.push({
            date, description: sc.description||'', amount: creditAmt,
            currency: null, account_id: sc.transfer_to_account_id,
            categories: sc.categories||null, payees: null, isScheduled: true,
            source_scheduled_id: sc.id || null,
            scheduled_date: date,
            type: sc.type || null,
          });
        }
      });
    });
  }

  // ── 3. Merge ─────────────────────────────────────────────────────────────
  const allItems = [...txData, ...scheduledItems]
    .sort((a,b) => (a.date||'').localeCompare(b.date||''))
    .map((item, idx) => _fcNormalizeCacheItem(item, idx));

  try { window._forecastTxCache = allItems.slice(); } catch(_) {}

  if (!allItems.length) {
    if (container) container.innerHTML = `
      <div class="card" style="text-align:center;padding:40px;color:var(--muted)">
        <div style="font-size:2rem;margin-bottom:12px">📅</div>
        <p>Nenhuma transação no período selecionado.</p>
      </div>`;
    _destroyForecastChart();
    return;
  }

  // ── 4. Resolve contas ────────────────────────────────────────────────────
  const accountIds = [...new Set(allItems.map(t => t.account_id))].filter(Boolean);

  let accounts = accIds.length
    ? (state.accounts||[]).filter(a => accIds.includes(a.id))
    : (state.accounts||[]).filter(a => accountIds.includes(a.id));

  // Fallback: extrai conta do join em txData
  if (!accounts.length) {
    const accMap = {};
    txData.forEach(tx => {
      if (tx.account_id && tx.accounts && !accMap[tx.account_id]) {
        accMap[tx.account_id] = {
          id: tx.account_id,
          name:     tx.accounts.name     || 'Conta',
          color:    tx.accounts.color    || '#2a6049',
          currency: tx.accounts.currency || tx.currency || 'BRL',
          icon:     tx.accounts.icon     || '',
          type:     tx.accounts.type     || 'corrente',
          balance:  parseFloat(tx.accounts.balance)||0,
        };
      }
    });
    // Adiciona contas de transações programadas que não estavam no txData
    scheduledItems.forEach(s => {
      if (s.account_id && !accMap[s.account_id]) {
        const fromState = (state.accounts||[]).find(a => a.id === s.account_id);
        if (fromState) accMap[s.account_id] = fromState;
      }
    });
    accounts = Object.values(accMap).filter(a => accountIds.includes(a.id));
  }

  if (!accounts.length) {
    if (container) container.innerHTML = `
      <div class="card" style="text-align:center;padding:40px;color:var(--muted)">
        <div style="font-size:2rem;margin-bottom:12px">⚠️</div>
        <p>Não foi possível identificar as contas. Recarregue a página e tente novamente.</p>
      </div>`;
    _destroyForecastChart();
    return;
  }

  // ── 5. Gráfico ────────────────────────────────────────────────────────────
  try { renderForecastChart(allItems, accounts, fromStr, toStr); }
  catch(e) { console.warn('[forecast] chart error:', e?.message); }

  // ── 6. Tabelas ────────────────────────────────────────────────────────────
  try { renderForecastTables(allItems, accounts); }
  catch(e) {
    console.error('[forecast] table error:', e?.message);
    if (container) container.innerHTML += `
      <div class="card" style="text-align:center;padding:24px;color:var(--muted)">
        <p>Erro ao renderizar tabela: ${_fcEsc(e?.message||'')}</p>
      </div>`;
  }
}
window.loadForecast = loadForecast;

// ── Gráfico ───────────────────────────────────────────────────────────────────
function renderForecastChart(allItems, accounts, fromStr, toStr) {
  const canvas = document.getElementById('forecastChart');
  if (!canvas || typeof Chart === 'undefined') return;
  _destroyForecastChart();

  const dates = [];
  let cur = new Date(fromStr + 'T12:00:00');
  const end = new Date(toStr + 'T12:00:00');
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0,10));
    cur.setDate(cur.getDate()+1);
  }
  if (!dates.length) return;

  const COLORS = ['#2a6049','#1d4ed8','#b45309','#7c3aed','#dc2626','#059669'];

  const datasets = accounts.slice(0,6).map((a,idx) => {
    const txsForAcc   = allItems.filter(t => t.account_id===a.id);
    const realSum     = txsForAcc.filter(t=>!t.isScheduled).reduce((s,t)=>s+(parseFloat(t.amount)||0),0);
    const baseBal     = (parseFloat(a.balance)||0) - realSum;
    const color       = (a.color && a.color!=='var(--accent)') ? a.color : COLORS[idx%COLORS.length];
    const accDatesWithTx = new Set(txsForAcc.map(t => t.date));
    let running = baseBal;
    const byDate = new Map();
    txsForAcc.forEach(t => {
      const key = t.date;
      byDate.set(key, (byDate.get(key) || 0) + (parseFloat(t.amount)||0));
    });

    return {
      label: a.name,
      data: dates.map(d => {
        running += (byDate.get(d) || 0);
        return +running.toFixed(2);
      }),
      borderColor: color,
      backgroundColor: color+'18',
      fill:false,
      tension:0.28,
      borderWidth:2,
      pointRadius: dates.map(d => accDatesWithTx.has(d) ? 4 : 2),
      pointHoverRadius: dates.map(d => accDatesWithTx.has(d) ? 7 : 5),
      pointBackgroundColor: dates.map(d => accDatesWithTx.has(d) ? color : '#ffffff'),
      pointBorderColor: color,
      pointBorderWidth: dates.map(d => accDatesWithTx.has(d) ? 1.5 : 1),
      hitRadius: 10,
    };
  });

  forecastChartInstance = new Chart(canvas, {
    type:'line',
    data:{ labels: dates, datasets },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      interaction:{ mode:'index', intersect:false },
      plugins:{
        legend:{ position:'bottom', labels:{ boxWidth:12, font:{size:11} } },
        tooltip:{
          callbacks:{
            title: ctx => {
              const d = ctx[0]?.label || '';
              const dp = typeof _forecastDateParts === 'function' ? _forecastDateParts(d) : null;
              const txsOnDay = allItems.filter(t => t.date === d);
              const title = dp?.weekday ? `${dp.weekday}, ${dp.short}` : d;
              return txsOnDay.length
                ? `${title} · ${txsOnDay.length} transação${txsOnDay.length>1?'ões':''}`
                : title;
            },
            label: ctx => `${ctx.dataset.label}: ${_fcFmt(ctx.parsed.y)}`,
            afterBody: ctx => {
              const d = ctx?.[0]?.label || '';
              if (!d) return [];
              const txsOnDay = allItems.filter(t => t.date === d);
              if (!txsOnDay.length) return ['Sem transações neste dia'];
              return ['Toque para ver as transações do dia por conta'];
            },
          }
        },
      },
      onClick(evt) {
        const chart = forecastChartInstance;
        if (!chart) return;
        const points = chart.getElementsAtEventForMode(evt, 'index', { intersect:false }, false);
        if (!points.length) return;
        const idx  = points[0].index;
        const date = dates[idx];
        if (!date) return;
        const txsOnDay = allItems.filter(t => t.date === date);
        if (!txsOnDay.length) return;
        const dp = typeof _forecastDateParts === 'function' ? _forecastDateParts(date) : { short: date };
        const label = dp.weekday ? `${dp.weekday}, ${dp.short}` : date;
        if (typeof _forecastOpenDayDrill === 'function') {
          _forecastOpenDayDrill(date, label);
        } else if (typeof _forecastDrillRow === 'function') {
          _forecastDrillRow(date, label);
        }
      },
      onHover(evt) {
        const chart = forecastChartInstance;
        const points = chart ? chart.getElementsAtEventForMode(evt, 'index', { intersect:false }, false) : [];
        const idx = points?.[0]?.index;
        const date = idx != null ? dates[idx] : null;
        const hasTx = date && allItems.some(t => t.date === date);
        evt.native.target.style.cursor = hasTx ? 'pointer' : 'default';
      },
      scales:{
        x:{
          type:'category',
          ticks:{
            maxTicksLimit:10,
            color:'#8c8278',
            font:{size:10},
            callback(value, index) {
              const raw = dates[index];
              if (!raw) return '';
              const parts = raw.split('-');
              return `${parts[2]}/${parts[1]}`;
            }
          },
          grid:{color:'#e8e4de33'}
        },
        y:{
          ticks:{ callback:v=>_fcFmt(v), color:'#8c8278', font:{size:10} },
          grid:{ color:ctx=>ctx.tick?.value===0?'rgba(220,38,38,0.5)':'#e8e4de33', lineWidth:ctx=>ctx.tick?.value===0?2:1 },
        },
      },
    },
  });
}

// ── Tabelas por conta ─────────────────────────────────────────────────────────
function renderForecastTables(allItems, accounts) {
  const container = document.getElementById('forecastAccountsContainer');
  if (!container) return;

  if (!accounts.length) {
    container.innerHTML = `<div class="card" style="text-align:center;padding:40px;color:var(--muted)"><div style="font-size:2rem;margin-bottom:12px">📅</div><p>Nenhuma conta no período.</p></div>`;
    return;
  }

  const today = _forecastDateUtils.getTodayLocalISO();

  container.innerHTML = accounts.map(a => {
    const txs = allItems.filter(t=>t.account_id===a.id).sort((x,y)=>(x.date||'').localeCompare(y.date||''));
    if (!txs.length) return '';

    const realSum      = txs.filter(t=>!t.isScheduled).reduce((s,t)=>s+(parseFloat(t.amount)||0),0);
    let runningBalance = (parseFloat(a.balance)||0) - realSum;
    const periodSum    = txs.reduce((s,t)=>s+(parseFloat(t.amount)||0),0);
    const finalBalance = (parseFloat(a.balance)||0) - realSum + periodSum;
    const accentColor  = (a.color && a.color!=='var(--accent)') ? a.color : '#2a6049';

    let currentDateGroup = null;

    const rows = txs.map(t => {
      runningBalance += parseFloat(t.amount)||0;
      const isPast   = t.date < today;
      const isToday  = t.date === today;
      const isNeg    = runningBalance < 0;
      const isPos    = runningBalance > 0;
      const rowCls   = [isPast?'forecast-row-past':'', isToday?'forecast-row-today':'', isNeg?'forecast-row-negative':''].filter(Boolean).join(' ');
      const catColor = t.categories?.color || (parseFloat(t.amount)>=0 ? 'var(--accent)' : 'var(--red)');
      const dp       = _forecastDateParts(t.date);
      const todayBadge = isToday ? '<span class="forecast-date-today">Hoje</span>' : '';
      const catLine  = t.categories?.name ? `<div class="forecast-line forecast-category" style="color:${catColor}"><span class="forecast-cat-dot" style="background:${catColor}"></span>${_fcEsc(t.categories.name)}</div>` : '';
      const paLine   = t.payees?.name ? `<div class="forecast-line forecast-payee">${_fcEsc(t.payees.name)}</div>` : '';
      const scBadge  = t.isScheduled ? '<span style="font-size:.62rem;background:rgba(30,91,168,.12);color:#1e5ba8;border-radius:4px;padding:1px 5px;margin-left:4px">prog.</span>' : '';

      const grpHdr = currentDateGroup !== t.date
        ? (() => {
            currentDateGroup = t.date;
            return `<tr class="forecast-date-group-row${isToday?' forecast-date-group-row--today':''}"><td colspan="3"><div class="forecast-date-group-pill"><div class="forecast-date-group-copy"><span class="forecast-date-group-main">${dp.weekday}</span><span class="forecast-date-group-sub">${dp.short}</span></div>${todayBadge}</div></td></tr>`;
          })()
        : '';

      const drillLabel = (t.description||dp.short).replace(/'/g,"\\'");
      const amt = parseFloat(t.amount)||0;

      return `${grpHdr}<tr class="${rowCls} forecast-tx-row" style="cursor:pointer" onclick="if(typeof _forecastDrillRow==='function')_forecastDrillRow('${t.date}','${drillLabel}')" title="Ver detalhes">
        <td class="forecast-date-cell${isToday?' forecast-date-cell--today':''}"><div class="forecast-date-card forecast-date-card--compact"><div class="forecast-date-weekday">${dp.weekday}</div><div class="forecast-date-daynum">${dp.day}</div><div class="forecast-date-monthyear">${dp.monthYear}</div></div></td>
        <td class="forecast-desc-cell"><div class="forecast-line forecast-title">${_fcEsc(t.description||'')}${scBadge}</div>${catLine}${paLine}</td>
        <td class="forecast-amount-cell ${amt>=0?'amount-pos':'amount-neg'}">
          <div class="forecast-amount-main">${amt>=0?'+':''}${_fcFmt(t.amount,a.currency)}</div>
          ${a.currency!=='BRL'&&t.brl_amount!=null?`<div class="forecast-amount-brl">${_fcFmt(t.brl_amount,'BRL')}</div>`:''}
          <div class="forecast-run-bal ${isNeg?'amount-neg':isPos?'amount-pos':''}">${_fcFmt(runningBalance,a.currency)}</div>
        </td>
      </tr>`;
    }).join('');

    const iconHtml = typeof renderIconEl==='function'
      ? renderIconEl(a.icon, a.color, 22)
      : `<span style="font-size:1.1rem">${a.icon||'💳'}</span>`;

    return `
    <div class="forecast-account-section" id="forecastAcc-${a.id}">
      <div class="forecast-account-header" onclick="toggleForecastSection('${a.id}')">
        <div style="width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:${accentColor}22;flex-shrink:0">${iconHtml}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:.95rem">${_fcEsc(a.name)}</div>
          <div style="font-size:.75rem;color:var(--muted)">${_fct('fc.current_balance')} <strong>${_fcFmt(a.balance||0,a.currency)}</strong> · ${txs.length} ${txs.length!==1?_fct('fc.txs_in_period_pl'):_fct('fc.txs_in_period')}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-family:var(--font-serif);font-weight:700;font-size:1rem;color:${finalBalance>=0?'var(--green,#16a34a)':'var(--red)'}">${_fcFmt(finalBalance,a.currency)}</div>
          <div style="font-size:.68rem;color:var(--muted)">${_fct('fc.final_balance')}</div>
        </div>
        <span id="forecastToggle-${a.id}" style="color:var(--muted);font-size:.75rem;margin-left:8px">▼</span>
      </div>
      <div class="forecast-table-wrap" id="forecastBody-${a.id}">
        <div class="table-wrap" style="margin:0">
          <table class="resizable-table forecast-grid-table" id="forecastTable-${a.id}">
            <colgroup><col class="forecast-col-date"><col class="forecast-col-desc"><col class="forecast-col-amount"></colgroup>
            <thead><tr>
              <th class="forecast-head-date">${_fct('fc.date')}</th>
              <th class="forecast-head-desc">${_fct('fc.description')}</th>
              <th class="forecast-head-amount">${_fct('fc.amount')}</th>
            </tr></thead>
            <tbody>${rows}</tbody>
            <tfoot>
              <tr style="background:var(--surface2);font-weight:600">
                <td colspan="2" style="padding:7px 8px;font-size:.78rem">${_fct('fc.period_total')}</td>
                <td class="${periodSum>=0?'amount-pos':'amount-neg'}" style="text-align:right;padding:7px 8px">${periodSum>=0?'+':''}${_fcFmt(periodSum,a.currency)}</td>
              </tr>
              <tr style="background:color-mix(in srgb,${accentColor} 8%,var(--surface));border-top:2px solid ${accentColor}40">
                <td colspan="2" style="padding:7px 8px;font-size:.78rem;color:var(--muted);font-weight:600">${_fct('fc.final_balance')}</td>
                <td class="${finalBalance<0?'amount-neg':''}" style="text-align:right;padding:7px 8px;font-weight:800;font-size:.95rem;font-family:var(--font-serif)">${_fcFmt(finalBalance,a.currency)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>`;
  }).join('');

  setTimeout(() => { try { if (typeof initAllResizableTables==='function') initAllResizableTables(); } catch(_) {} }, 60);
}

// ── Toggle seção aberta/fechada ───────────────────────────────────────────────
function toggleForecastSection(id) {
  const body  = document.getElementById('forecastBody-'+id);
  const arrow = document.getElementById('forecastToggle-'+id);
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : '';
  if (arrow) arrow.textContent = isOpen ? '▶' : '▼';
}
window.toggleForecastSection = toggleForecastSection;

// ── Cor de periodicidade (usado por scheduled.js) ─────────────────────────────
function getPeriodColor(period) {
  return ({ daily:'#2ecc71', weekly:'#3498db', monthly:'#f39c12', yearly:'#9b59b6' })[(period||'').toLowerCase()] || '#1F6B4F';
}
window.getPeriodColor = getPeriodColor;
