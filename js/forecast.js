
// ── Init / refresh the forecast account multi-picker ─────────────────────────
function _initForecastPicker(savedIds) {
  if (typeof _fcPickerBuild !== 'function') return;
  _fcPickerBuild('forecastAcctPicker', savedIds || [], loadForecast);
}

let forecastChartInstance = null;

function _destroyForecastChart() {
  if (forecastChartInstance) {
    try { forecastChartInstance.destroy(); } catch(e) {}
    forecastChartInstance = null;
  }
}

async function loadForecast() {
  const fromStr = document.getElementById('forecastFrom').value;
  const toStr   = document.getElementById('forecastTo').value;
  // Multi-account: get array of selected IDs (empty = all)
  const accIds = typeof _fcPickerGetSelected === 'function'
    ? _fcPickerGetSelected('forecastAcctPicker')
    : [];
  const includeScheduled = document.getElementById('forecastIncludeScheduled').checked;
  if (!fromStr || !toStr) return;

  // Save preference
  try {
    const prefs = typeof _dashGetPrefs === 'function' ? _dashGetPrefs() : {};
    if (typeof _dashSavePrefs === 'function') _dashSavePrefs({ ...prefs, forecastAccounts: accIds }).catch(()=>{});
  } catch(_) {}

  const container = document.getElementById('forecastAccountsContainer');
  if (container) container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--muted)"><div style="font-size:1.5rem;margin-bottom:8px">⏳</div>${t('fc.loading')}</div>`;

  // ── 1. Real transactions in period ──────────────────────────────────────
  let q = famQ(sb.from('transactions')
    .select('id, date, description, amount, currency, brl_amount, account_id, is_transfer, category_id, payee_id, categories(name,color), payees(name)')
    .gte('date', fromStr)
    .lte('date', toStr)
    .order('date'));
  if (accIds.length === 1) q = q.eq('account_id', accIds[0]);
  else if (accIds.length > 1) q = q.in('account_id', accIds);
  const { data: txData, error: txErr } = await q;
  if (txErr) { toast(txErr.message, 'error'); return; }

  // ── 2. Scheduled occurrences in period ──────────────────────────────────
  let scheduledItems = [];
  if (includeScheduled && state.scheduled.length) {
    // Filter: conta origem OU conta destino bate com o filtro
    const schToProcess = accIds.length
      ? state.scheduled.filter(s => accIds.includes(s.account_id) || accIds.includes(s.transfer_to_account_id))
      : state.scheduled;

    schToProcess.forEach(sc => {
      if (sc.status === 'paused') return;
      const registered = new Set((sc.occurrences || []).map(o => o.scheduled_date));
      const occ = generateOccurrences(sc, 200);
      const isTransfer = sc.type === 'transfer' || sc.type === 'card_payment';

      occ.forEach(date => {
        if (date < fromStr || date > toStr || registered.has(date)) return;

        const baseAmt = Math.abs(parseFloat(sc.amount) || 0);
        const isExpense = sc.type === 'expense';
        const isIncome  = sc.type === 'income';
        const isCardPayment = sc.type === 'card_payment';

        // Conta origem:
        // - expense: saída (negativo)
        // - income: entrada (positivo)
        // - transfer/card_payment: perna de débito (negativo)
        if (!accIds.length || accIds.includes(sc.account_id)) {
          let originAmount = 0;
          if (isIncome) originAmount = baseAmt;
          else if (isExpense || isTransfer || isCardPayment) originAmount = -baseAmt;

          if (originAmount !== 0) {
            scheduledItems.push({
              date,
              description: sc.description,
              amount: originAmount,
              currency: sc.currency || sc.accounts?.currency || null,
              account_id: sc.account_id,
              categories: sc.categories,
              payees: sc.payees,
              isScheduled: true,
              transferLeg: isTransfer || isCardPayment ? 'debit' : null,
              sc_id: sc.id,
            });
          }
        }

        // Conta destino: apenas transferências/cartão, sempre positivo
        if ((isTransfer || isCardPayment) && sc.transfer_to_account_id && (!accIds.length || accIds.includes(sc.transfer_to_account_id))) {
          let creditAmt = baseAmt;
          if (sc.fx_mode === 'fixed' && sc.fx_rate > 0) creditAmt = creditAmt * sc.fx_rate;
          scheduledItems.push({
            date,
            description: sc.description,
            amount: creditAmt,
            currency: null, // credit leg uses destination account currency
            account_id: sc.transfer_to_account_id,
            categories: sc.categories,
            payees: null,
            isScheduled: true,
            transferLeg: 'credit',
            sc_id: sc.id,
          });
        }
      });
    });
  }

  // ── 3. Merge and determine accounts involved ─────────────────────────────
  const allItems = [...(txData || []), ...scheduledItems]
    .sort((a, b) => a.date.localeCompare(b.date));

  const accountIds = [...new Set(allItems.map(t => t.account_id))].filter(Boolean);
  // Look up accounts from state (has real balance, color, currency, icon)
  const accounts = accIds.length
    ? state.accounts.filter(a => accIds.includes(a.id))
    : state.accounts.filter(a => accountIds.includes(a.id));

  if (!accounts.length && !allItems.length) {
    if (container) container.innerHTML = '<div class="card" style="text-align:center;padding:40px;color:var(--muted)"><div style="font-size:2rem;margin-bottom:12px">📅</div><p>Nenhuma transação no período selecionado.</p></div>';
    _destroyForecastChart();
    return;
  }

  // ── 4. Chart ─────────────────────────────────────────────────────────────
  renderForecastChart(allItems, accounts, fromStr, toStr);

  // ── 5. Per-account tables ─────────────────────────────────────────────────
  renderForecastTables(allItems, accounts);
}

function renderForecastChart(allItems, accounts, fromStr, toStr) {
  const canvas = document.getElementById('forecastChart');
  if (!canvas) return;
  _destroyForecastChart();

  // Build date range (daily, downsampled to weekly if > 90 days)
  const dates = [];
  let cur = new Date(fromStr + 'T12:00:00');
  const end = new Date(toStr + 'T12:00:00');
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  const step = dates.length > 90 ? 7 : 1;
  const sampledDates = dates.filter((_, i) => i % step === 0);
  if (!sampledDates.includes(toStr) && dates.length) sampledDates.push(toStr);

  const colors = ['#2a6049','#1d4ed8','#b45309','#7c3aed','#dc2626','#059669'];
  const datasets = accounts.slice(0, 6).map((a, idx) => {
    const txForAccount = allItems.filter(t => t.account_id === a.id);

    // a.balance already includes ALL real txs ever. To avoid double-counting,
    // subtract the real (non-scheduled) txs that fall inside this period —
    // they will be re-added one by one as we walk the timeline.
    const realTxsInPeriod = txForAccount.filter(t => !t.isScheduled);
    const realSum = realTxsInPeriod.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
    const baseBal = (parseFloat(a.balance) || 0) - realSum;

    const color = a.color || colors[idx % colors.length];
    return {
      label: a.name,
      data: sampledDates.map(d => {
        const sumUpToDate = txForAccount
          .filter(t => t.date <= d)
          .reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
        return { x: d, y: +(baseBal + sumUpToDate).toFixed(2) };
      }),
      borderColor: color,
      backgroundColor: color + '18',
      fill: false,
      tension: 0.3,
      borderWidth: 2,
      pointRadius: sampledDates.length > 60 ? 0 : 2,
    };
  });

  forecastChartInstance = new Chart(canvas, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom' },
        tooltip: { callbacks: {
          label: ctx => `${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`
        }},
        // Annotation: zero baseline + min/max per dataset
        annotation: (() => {
          const annotations = {
            zeroLine: {
              type: 'line', yMin: 0, yMax: 0,
              borderColor: 'rgba(220,38,38,0.55)',
              borderWidth: 1.5,
              borderDash: [5, 4],
              label: { content: 'Zero', enabled: true, position: 'start',
                       font: { size: 10 }, color: '#dc2626',
                       backgroundColor: 'rgba(220,38,38,0.08)' }
            }
          };
          datasets.forEach((ds, i) => {
            const vals = ds.data.map(p => p.y);
            if (!vals.length) return;
            const minVal = Math.min(...vals);
            const maxVal = Math.max(...vals);
            const minPt  = ds.data.find(p => p.y === minVal);
            const maxPt  = ds.data.find(p => p.y === maxVal);
            annotations[`min_${i}`] = {
              type: 'point', xValue: minPt.x, yValue: minVal,
              radius: 5, backgroundColor: '#dc2626',
              borderColor: '#fff', borderWidth: 2
            };
            annotations[`max_${i}`] = {
              type: 'point', xValue: maxPt.x, yValue: maxVal,
              radius: 5, backgroundColor: '#16a34a',
              borderColor: '#fff', borderWidth: 2
            };
          });
          return { annotations };
        })()
      },
      scales: {
        x: { type: 'category', ticks: { maxTicksLimit: 12, color: '#8c8278' }, grid: { color: '#e8e4de44' } },
        y: {
          ticks: { callback: v => fmt(v), color: '#8c8278' },
          grid: {
            color: ctx => ctx.tick.value === 0 ? 'rgba(220,38,38,0.7)' : '#e8e4de44',
            lineWidth: ctx => ctx.tick.value === 0 ? 2 : 1,
          }
        }
      }
    },
    plugins: [{
      id: 'zeroBaseline',
      afterDraw(chart) {
        const yScale = chart.scales.y;
        if (!yScale) return;
        const yZero = yScale.getPixelForValue(0);
        const min = yScale.min, max = yScale.max;
        if (yZero === undefined || yZero < yScale.top || yZero > yScale.bottom) return;
        const ctx2 = chart.ctx;
        ctx2.save();
        ctx2.beginPath();
        ctx2.moveTo(chart.chartArea.left, yZero);
        ctx2.lineTo(chart.chartArea.right, yZero);
        ctx2.strokeStyle = 'rgba(220,38,38,0.8)';
        ctx2.lineWidth = 2;
        ctx2.setLineDash([6, 4]);
        ctx2.stroke();
        ctx2.restore();
      }
    }]
  });
}

function renderForecastTables(allItems, accounts) {
  const container = document.getElementById('forecastAccountsContainer');
  if (!container) return;
  const today = new Date().toISOString().slice(0, 10);

function _forecastDateParts(iso){
  try {
    const dt = new Date(`${String(iso || '').slice(0,10)}T12:00:00`);
    if (Number.isNaN(dt.getTime())) return { weekday:'', day:'--', monthYear:'', short:'—' };
    const locale = document?.documentElement?.lang || 'pt-BR';
    const weekday = new Intl.DateTimeFormat(locale, { weekday:'short' }).format(dt).replace('.', '').toUpperCase();
    const day = new Intl.DateTimeFormat(locale, { day:'2-digit' }).format(dt);
    const month = new Intl.DateTimeFormat(locale, { month:'short' }).format(dt).replace('.', '').toUpperCase();
    const year = new Intl.DateTimeFormat(locale, { year:'2-digit' }).format(dt);
    return {
      weekday,
      day,
      monthYear: `${month} · ${year}`,
      short: `${day}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`
    };
  } catch(_e){
    return { weekday:'', day:'--', monthYear:'', short:'—' };
  }
}

  if (!accounts.length) {
    container.innerHTML = '<div class="card" style="text-align:center;padding:40px;color:var(--muted)"><div style="font-size:2rem;margin-bottom:12px">📅</div><p>Nenhuma transação no período selecionado.</p></div>';
    return;
  }

  container.innerHTML = accounts.map(a => {
    const txs = allItems
      .filter(t => t.account_id === a.id)
      .sort((x, y) => x.date.localeCompare(y.date));

    // a.balance includes ALL real txs ever. Subtract real txs in this period
    // so the running balance starts correctly and each tx is counted once only.
    const realSum = txs
      .filter(t => !t.isScheduled)
      .reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
    let runningBalance = (parseFloat(a.balance) || 0) - realSum;

    const accentColor = a.color || 'var(--accent)';
    const finalBalance = (parseFloat(a.balance) || 0) -
      realSum +
      txs.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);

    let currentDateGroup = null;
    const rows = txs.map(t => {
      runningBalance += parseFloat(t.amount) || 0;
      const isPast   = t.date < today;
      const isToday  = t.date === today;
      const isNeg    = runningBalance < 0;
      const isPos    = runningBalance > 0;
      const rowClass = isPast ? 'forecast-row-past' : isToday ? 'forecast-row-today' : '';
      const balClass = isNeg ? 'forecast-row-negative' : '';
      const _catIcon = t.categories?.icon || null;
      const _catColor = t.categories?.color || 'var(--accent)';
      const todayMarker = isToday ? '<span class="forecast-date-today">Hoje</span>' : '';
      const dateParts = _forecastDateParts(t.date);
      const groupHeader = currentDateGroup !== t.date
        ? (() => {
            currentDateGroup = t.date;
            return `<tr class="forecast-date-group-row ${isToday ? 'forecast-date-group-row--today' : ''}">
              <td colspan="3">
                <div class="forecast-date-group-pill">
                  <div class="forecast-date-group-copy">
                    <span class="forecast-date-group-main">${dateParts.weekday}</span>
                    <span class="forecast-date-group-sub">${dateParts.short}</span>
                  </div>
                  ${todayMarker}
                </div>
              </td>
            </tr>`;
          })()
        : '';
      const _catName  = t.categories?.name ? esc(t.categories.name) : null;
      const _catLine  = _catName
        ? `<div class="forecast-line forecast-category" style="color:${_catColor}"><span class="forecast-cat-dot" style="background:${_catColor}"></span>${_catIcon ? _catIcon + ' ' : ''}${_catName}</div>`
        : '';
      const payeeLine = t.payees?.name
        ? `<div class="forecast-line forecast-payee">${esc(t.payees.name)}</div>`
        : '';
      return `${groupHeader}<tr class="${rowClass} ${balClass} forecast-tx-row">
        <td class="forecast-date-cell ${isToday ? 'forecast-date-cell--today' : ''}">
          <div class="forecast-date-card forecast-date-card--compact" aria-label="${dateParts.short}">
            <div class="forecast-date-weekday">${dateParts.weekday}</div>
            <div class="forecast-date-daynum">${dateParts.day}</div>
            <div class="forecast-date-monthyear">${dateParts.monthYear}</div>
          </div>
        </td>
        <td class="forecast-desc-cell">
          <div class="forecast-line forecast-title">${esc(t.description||'')}</div>
          ${_catLine}
          ${payeeLine}
        </td>
        <td class="forecast-amount-cell ${(parseFloat(t.amount)||0)>=0?'amount-pos':'amount-neg'}">
          <div class="forecast-amount-main">${(parseFloat(t.amount)||0)>=0?'+':''}${fmt(t.amount, a.currency)}</div>
          ${(a.currency !== 'BRL' && t.brl_amount != null)
            ? `<div class="forecast-amount-brl">${fmt(t.brl_amount,'BRL')}</div>`
            : (a.currency === 'BRL' ? '' : `<div class="forecast-amount-brl">&nbsp;</div>`)
          }
          <div class="forecast-run-bal ${isNeg?'amount-neg':isPos?'amount-pos':''}">${fmt(runningBalance,a.currency)}</div>
        </td>
      </tr>`;
    }).join('');

    const periodSum = txs.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);

    return `
    <div class="forecast-account-section" id="forecastAcc-${a.id}">
      <div class="forecast-account-header" onclick="toggleForecastSection('${a.id}')">
        <div style="width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:${accentColor}22;flex-shrink:0">${renderIconEl(a.icon, a.color, 22)}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:.95rem">${esc(a.name)}</div>
          <div style="font-size:.75rem;color:var(--muted)">${t("fc.current_balance")} <strong>${fmt(a.balance || 0, a.currency)}</strong> · ${txs.length} ${txs.length !== 1 ? t("fc.txs_in_period_pl") : t("fc.txs_in_period")}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-family:var(--font-serif);font-weight:700;font-size:1rem;color:${finalBalance >= 0 ? 'var(--green,#16a34a)' : 'var(--red)'}">${fmt(finalBalance, a.currency)}</div>
          <div style="font-size:.68rem;color:var(--muted)">${t("fc.final_balance")}</div>
        </div>
        <span id="forecastToggle-${a.id}" style="color:var(--muted);font-size:.75rem;margin-left:8px">▼</span>
      </div>
      <div class="forecast-table-wrap" id="forecastBody-${a.id}">
        ${txs.length ? `
        <div class="table-wrap" style="margin:0">
          <table class="resizable-table forecast-grid-table" id="forecastTable-${a.id}">
            <colgroup>
              <col class="forecast-col-date">
              <col class="forecast-col-desc">
              <col class="forecast-col-amount">
            </colgroup>
            <thead><tr>
              <th class="forecast-head-date">${t("fc.date")}</th>
              <th class="forecast-head-desc">${t("fc.description")}</th>
              <th class="forecast-head-amount">${t("fc.amount")}</th>
            </tr></thead>
            <tbody>${rows}</tbody>
            <tfoot>
              <tr style="background:var(--surface2);font-weight:600">
                <td colspan="2" style="padding:7px 8px;font-size:.78rem">${t("fc.period_total")}</td>
                <td class="${periodSum>=0?'amount-pos':'amount-neg'}" style="text-align:right;padding:7px 8px">${periodSum>=0?'+':''}${fmt(periodSum,a.currency)}</td>
              </tr>
              <tr style="background:color-mix(in srgb,${accentColor} 8%,var(--surface));border-top:2px solid ${accentColor}40">
                <td colspan="2" style="padding:7px 8px;font-size:.78rem;color:var(--muted);font-weight:600">${t("fc.final_balance")}</td>
                <td class="${finalBalance<0?'amount-neg':''}" style="text-align:right;padding:7px 8px;font-weight:800;font-size:.95rem;font-family:var(--font-serif)">${fmt(finalBalance,a.currency)}</td>
              </tr>
            </tfoot>
          </table>
        </div>` : `<div style="padding:20px;text-align:center;color:var(--muted);font-size:.85rem">${t('fc.empty')}</div>`}
      </div>
    </div>`;
  }).join('');
  // Init resizable columns
  setTimeout(() => { if (typeof initAllResizableTables === 'function') initAllResizableTables(); }, 50);
}

function toggleForecastSection(id) {
  const body  = document.getElementById('forecastBody-' + id);
  const arrow = document.getElementById('forecastToggle-' + id);
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : '';
  if (arrow) arrow.textContent = isOpen ? '▶' : '▼';
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
