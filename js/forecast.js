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
  const accFilter = document.getElementById('forecastAccountFilter').value;
  const includeScheduled = document.getElementById('forecastIncludeScheduled').checked;
  if (!fromStr || !toStr) return;

  const container = document.getElementById('forecastAccountsContainer');
  if (container) container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted)"><div style="font-size:1.5rem;margin-bottom:8px">⏳</div>Carregando previsão...</div>';

  // ── 1. Real transactions in period ──────────────────────────────────────
  let q = famQ(sb.from('transactions')
    .select('id, date, description, amount, account_id, is_transfer, category_id, payee_id, categories(name,color), payees(name)')
    .gte('date', fromStr)
    .lte('date', toStr)
    .order('date'));
  if (accFilter) q = q.eq('account_id', accFilter);
  const { data: txData, error: txErr } = await q;
  if (txErr) { toast(txErr.message, 'error'); return; }

  // ── 2. Scheduled occurrences in period ──────────────────────────────────
  let scheduledItems = [];
  if (includeScheduled && state.scheduled.length) {
    const schToProcess = accFilter
      ? state.scheduled.filter(s => s.account_id === accFilter)
      : state.scheduled;

    schToProcess.forEach(sc => {
      if (sc.status === 'paused') return;
      const registered = new Set((sc.occurrences || []).map(o => o.scheduled_date));
      const occ = generateOccurrences(sc, 200);
      occ.forEach(date => {
        if (date >= fromStr && date <= toStr && !registered.has(date)) {
          scheduledItems.push({
            date,
            description: sc.description + ' 📅',
            amount: sc.amount,
            account_id: sc.account_id,
            categories: sc.categories,
            payees: sc.payees,
            isScheduled: true,
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
  const accounts = accFilter
    ? state.accounts.filter(a => a.id === accFilter)
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
        }}
      },
      scales: {
        x: { type: 'category', ticks: { maxTicksLimit: 12, color: '#8c8278' }, grid: { color: '#e8e4de44' } },
        y: { ticks: { callback: v => fmt(v), color: '#8c8278' }, grid: { color: '#e8e4de44' } }
      }
    }
  });
}

function renderForecastTables(allItems, accounts) {
  const container = document.getElementById('forecastAccountsContainer');
  if (!container) return;
  const today = new Date().toISOString().slice(0, 10);

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

    const rows = txs.map(t => {
      runningBalance += parseFloat(t.amount) || 0;
      const isPast   = t.date < today;
      const isToday  = t.date === today;
      const isNeg    = runningBalance < 0;
      const rowClass = isPast ? 'forecast-row-past' : isToday ? 'forecast-row-today' : '';
      const balClass = isNeg ? 'forecast-row-negative' : '';
      const scheduledBadge = t.isScheduled
        ? '<span class="badge" style="background:var(--amber-lt);color:var(--amber);border:1px solid rgba(180,83,9,.2);font-size:.65rem">📅 prog.</span>'
        : '';
      const catBadge = t.categories
        ? `<span class="badge" style="background:${t.categories.color}18;color:${t.categories.color};border:1px solid ${t.categories.color}28;font-size:.65rem">${esc(t.categories.name)}</span>`
        : '';
      const todayMarker = isToday ? '<span style="color:var(--accent);font-size:.65rem;margin-left:4px">●hoje</span>' : '';
      return `<tr class="${rowClass} ${balClass}">
        <td style="white-space:nowrap;font-size:.8rem;color:${isToday ? 'var(--accent)' : 'var(--muted)'}">${fmtDate(t.date)}${todayMarker}</td>
        <td style="max-width:200px"><div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
          <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px">${esc(t.description || '')}</span>
          ${scheduledBadge}${catBadge}
        </div></td>
        <td style="white-space:nowrap;font-size:.8rem;color:var(--muted)">${t.payees?.name || ''}</td>
        <td class="${(parseFloat(t.amount) || 0) >= 0 ? 'amount-pos' : 'amount-neg'}" style="white-space:nowrap;font-weight:600">${(parseFloat(t.amount)||0) >= 0 ? '+' : ''}${fmt(t.amount)}</td>
        <td class="forecast-balance ${isNeg ? 'amount-neg' : ''}" style="white-space:nowrap">${fmt(runningBalance, a.currency)}</td>
      </tr>`;
    }).join('');

    const periodSum = txs.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);

    return `
    <div class="forecast-account-section" id="forecastAcc-${a.id}">
      <div class="forecast-account-header" onclick="toggleForecastSection('${a.id}')">
        <div style="width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:${accentColor}22;flex-shrink:0">${renderIconEl(a.icon, a.color, 22)}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:.95rem">${esc(a.name)}</div>
          <div style="font-size:.75rem;color:var(--muted)">Saldo atual: <strong>${fmt(a.balance || 0, a.currency)}</strong> · ${txs.length} transação${txs.length !== 1 ? 'ões' : ''} no período</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-family:var(--font-serif);font-weight:700;font-size:1rem;color:${finalBalance >= 0 ? 'var(--green,#16a34a)' : 'var(--red)'}">${fmt(finalBalance, a.currency)}</div>
          <div style="font-size:.68rem;color:var(--muted)">saldo final prev.</div>
        </div>
        <span id="forecastToggle-${a.id}" style="color:var(--muted);font-size:.75rem;margin-left:8px">▼</span>
      </div>
      <div class="forecast-table-wrap" id="forecastBody-${a.id}">
        ${txs.length ? `
        <div class="table-wrap" style="margin:0">
          <table>
            <thead><tr><th>Data</th><th>Descrição</th><th>Beneficiário</th><th>Valor</th><th>Saldo Prev.</th></tr></thead>
            <tbody>${rows}</tbody>
            <tfoot>
              <tr style="background:var(--surface2);font-weight:600">
                <td colspan="3" style="padding:10px 14px;font-size:.8rem">Total do período</td>
                <td class="${periodSum >= 0 ? 'amount-pos' : 'amount-neg'}">${periodSum >= 0 ? '+' : ''}${fmt(periodSum, a.currency)}</td>
                <td class="forecast-balance ${finalBalance < 0 ? 'amount-neg' : ''}">${fmt(finalBalance, a.currency)}</td>
              </tr>
            </tfoot>
          </table>
        </div>` : '<div style="padding:20px;text-align:center;color:var(--muted);font-size:.85rem">Nenhuma transação neste período</div>'}
      </div>
    </div>`;
  }).join('');
}

function toggleForecastSection(id) {
  const body  = document.getElementById('forecastBody-' + id);
  const arrow = document.getElementById('forecastToggle-' + id);
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : '';
  if (arrow) arrow.textContent = isOpen ? '▶' : '▼';
}
