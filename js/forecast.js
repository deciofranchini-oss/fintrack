let forecastChartInstance = null;


async function loadForecast() {
  const fromStr = document.getElementById('forecastFrom').value;
  const toStr   = document.getElementById('forecastTo').value;
  const accFilter = document.getElementById('forecastAccountFilter').value;
  const includeScheduled = document.getElementById('forecastIncludeScheduled').checked;
  if(!fromStr || !toStr) return;

  // 1. Load real future transactions (from today to toStr, including past with fromStr)
  let q = sb.from('transactions')
    .select('*, accounts!transactions_account_id_fkey(name,currency,balance,color,is_brazilian), categories(name,color), payees(name)')
    .gte('date', fromStr).lte('date', toStr).order('date');
  if(accFilter) q = q.eq('account_id', accFilter);
  const { data: txData, error: txErr } = await q;
  if(txErr) { toast(txErr.message,'error'); return; }

  // 2. Load scheduled occurrences for the period
  let scheduledItems = [];
  if(includeScheduled && state.scheduled.length) {
    const schToProcess = accFilter ? state.scheduled.filter(s=>s.account_id===accFilter) : state.scheduled;
    schToProcess.forEach(sc=>{
      if(sc.status==='paused') return;
      const registered = new Set((sc.occurrences||[]).map(o=>o.scheduled_date));
      const occ = generateOccurrences(sc, 200);
      occ.forEach(date=>{
        if(date >= fromStr && date <= toStr && !registered.has(date)) {
          scheduledItems.push({
            date, description: sc.description+'  📅',
            amount: sc.amount,
            account_id: sc.account_id,
            accounts: sc.accounts,
            categories: sc.categories,
            payees: sc.payees,
            isScheduled: true,
            sc_id: sc.id,
          });
        }
      });
    });
  }

  // 3. Merge and group by account
  const allItems = [...(txData||[]), ...scheduledItems].sort((a,b)=>a.date.localeCompare(b.date));
  const accountIds = [...new Set(allItems.map(t=>t.account_id))].filter(Boolean);
  const accounts = state.accounts.filter(a=>accountIds.includes(a.id));
  if(!accounts.length && !allItems.length) {
    document.getElementById('forecastAccountsContainer').innerHTML = '<div class="card" style="text-align:center;padding:40px;color:var(--muted)"><div style="font-size:2rem;margin-bottom:12px">📅</div><p>Nenhuma transação no período selecionado.</p></div>';
    return;
  }

  // 4. Render chart: cumulative balance across all accounts
  renderForecastChart(allItems, accounts, fromStr, toStr);

  // 5. Render per-account tables
  renderForecastTables(allItems, accounts);
}

function renderForecastChart(allItems, accounts, fromStr, toStr) {
  const canvas = document.getElementById('forecastChart');
  if(!canvas) return;
  if(forecastChartInstance) { forecastChartInstance.destroy(); forecastChartInstance = null; }

  // Build date range
  const dates = [];
  let cur = new Date(fromStr+'T12:00:00');
  const end = new Date(toStr+'T12:00:00');
  while(cur <= end) {
    dates.push(cur.toISOString().slice(0,10));
    cur.setDate(cur.getDate()+1);
  }
  if(dates.length > 180) {
    // Downsample to weekly
    const weekly = dates.filter((_,i)=>i%7===0);
    dates.length = 0; dates.push(...weekly);
  }

  // Per-account running balance
  const datasets = accounts.slice(0,5).map(a=>{
    let bal = a.balance || 0;
    const txForAccount = allItems.filter(t=>t.account_id===a.id);
    return {
      label: a.name,
      data: dates.map(d=>{
        txForAccount.filter(t=>t.date<=d).forEach(t=>{});
        // compute balance up to this date
        const sumUpToDate = txForAccount.filter(t=>t.date<=d).reduce((s,t)=>s+t.amount, 0);
        return { x: d, y: +(bal + sumUpToDate).toFixed(2) };
      }),
      borderColor: a.color || '#2a6049',
      backgroundColor: (a.color||'#2a6049')+'22',
      fill: false, tension: 0.3, borderWidth: 2, pointRadius: 1,
    };
  });

  forecastChartInstance = new Chart(canvas, {
    type: 'line',
    data: { datasets },
    options: {
      responsive:true, maintainAspectRatio:false,
      interaction: { mode:'index', intersect:false },
      plugins: { legend:{ position:'bottom' }, tooltip:{ callbacks:{
        label: ctx => `${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`
      }}},
      scales: {
        x: { type:'category', ticks:{ maxTicksLimit:12, color:'#8c8278' }, grid:{ color:'#e8e4de44' } },
        y: { ticks:{ callback: v=>fmt(v), color:'#8c8278' }, grid:{ color:'#e8e4de44' } }
      }
    }
  });
}

function renderForecastTables(allItems, accounts) {
  const container = document.getElementById('forecastAccountsContainer');
  if(!container) return;
  const today = new Date().toISOString().slice(0,10);

  container.innerHTML = accounts.map(a=>{
    const txs = allItems.filter(t=>t.account_id===a.id).sort((x,y)=>x.date.localeCompare(y.date));
    let runningBalance = a.balance || 0;
    const accentColor = a.color || 'var(--accent)';
    const rows = txs.map(t=>{
      runningBalance += t.amount;
      const isPast = t.date < today;
      const isToday = t.date === today;
      const isNeg = runningBalance < 0;
      const balClass = isNeg ? 'forecast-row-negative' : '';
      const rowClass = isPast ? 'forecast-row-past' : isToday ? 'forecast-row-today' : '';
      const scheduledBadge = t.isScheduled ? '<span class="badge" style="background:var(--amber-lt);color:var(--amber);border:1px solid rgba(180,83,9,.2);font-size:.65rem">📅 prog.</span>' : '';
      const catBadge = t.categories ? `<span class="badge" style="background:${t.categories.color}18;color:${t.categories.color};border:1px solid ${t.categories.color}28;font-size:.65rem">${esc(t.categories.name)}</span>` : '';
      return `<tr class="${rowClass} ${balClass}">
        <td style="white-space:nowrap;font-size:.8rem;color:${isToday?'var(--accent)':'var(--muted)'}">${fmtDate(t.date)}${isToday?'<span style="color:var(--accent);font-size:.65rem;margin-left:4px">●hoje</span>':''}</td>
        <td style="max-width:200px"><div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
          <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px">${esc(t.description)}</span>
          ${scheduledBadge}${catBadge}
        </div></td>
        <td style="white-space:nowrap;font-size:.8rem;color:var(--muted)">${t.payees?.name||''}</td>
        <td class="${t.amount>=0?'amount-pos':'amount-neg'}" style="white-space:nowrap;font-weight:600">${t.amount>=0?'+':''}${fmt(t.amount)}</td>
        <td class="forecast-balance ${isNeg?'amount-neg':''}" style="white-space:nowrap">${fmt(runningBalance)}</td>
      </tr>`;
    }).join('');

    return `
    <div class="forecast-account-section" id="forecastAcc-${a.id}">
      <div class="forecast-account-header" onclick="toggleForecastSection('${a.id}')">
        <div style="width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:${accentColor}22;flex-shrink:0">${renderIconEl(a.icon,a.color,22)}</div>
        <div style="flex:1">
          <div style="font-weight:700;font-size:.95rem">${esc(a.name)}</div>
          <div style="font-size:.75rem;color:var(--muted)">Saldo atual: <strong>${fmt(a.balance||0, a.currency)}</strong> · ${txs.length} transações no período</div>
        </div>
        <div style="font-family:var(--font-serif);font-weight:700;font-size:1rem;color:${(a.balance||0)+(txs.reduce((s,t)=>s+t.amount,0))>=0?'var(--green)':'var(--red)'}">
          ${fmt((a.balance||0)+(txs.reduce((s,t)=>s+t.amount,0)), a.currency)}
          <div style="font-size:.68rem;font-weight:400;color:var(--muted);text-align:right">saldo final prev.</div>
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
                <td class="${txs.reduce((s,t)=>s+t.amount,0)>=0?'amount-pos':'amount-neg'}">${fmt(txs.reduce((s,t)=>s+t.amount,0))}</td>
                <td class="forecast-balance ${((a.balance||0)+txs.reduce((s,t)=>s+t.amount,0))<0?'amount-neg':''}">${fmt((a.balance||0)+txs.reduce((s,t)=>s+t.amount,0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>` : '<div style="padding:20px;text-align:center;color:var(--muted);font-size:.85rem">Nenhuma transação neste período</div>'}
      </div>
    </div>`;
  }).join('');
}

function toggleForecastSection(id) {
  const body = document.getElementById('forecastBody-'+id);
  const arrow = document.getElementById('forecastToggle-'+id);
  if(!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : '';
  if(arrow) arrow.textContent = isOpen ? '▶' : '▼';
}

/* ═══════════════════════════════════════════════════════════════
   EMAIL REPORT via EmailJS
═══════════════════════════════════════════════════════════════ */
