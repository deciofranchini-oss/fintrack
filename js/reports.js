let rptState = { view:'regular', txData:[] };
let rptTxSortField = 'date', rptTxSortAsc = false;

/* ── Date range ── */
function getRptDateRange() {
  const p   = document.getElementById('rptPeriod')?.value || 'month';
  const now = new Date();
  let from, to;
  if(p === 'month') {
    const ym = document.getElementById('reportMonth')?.value || now.toISOString().slice(0,7);
    const [y,m] = ym.split('-');
    from = `${y}-${m}-01`;
    to   = `${y}-${m}-${String(new Date(+y,+m,0).getDate()).padStart(2,'0')}`;
  } else if(p === 'custom') {
    from = document.getElementById('rptFrom')?.value || now.toISOString().slice(0,10);
    to   = document.getElementById('rptTo')?.value   || now.toISOString().slice(0,10);
  } else if(p === 'quarter') {
    const q = Math.floor(now.getMonth()/3);
    from = new Date(now.getFullYear(),q*3,1).toISOString().slice(0,10);
    to   = new Date(now.getFullYear(),q*3+3,0).toISOString().slice(0,10);
  } else if(p === 'year') {
    from = `${now.getFullYear()}-01-01`;
    to   = `${now.getFullYear()}-12-31`;
  } else { // last12
    const d = new Date(); d.setMonth(d.getMonth()-11); d.setDate(1);
    from = d.toISOString().slice(0,10);
    to   = now.toISOString().slice(0,10);
  }
  return {from, to};
}

function onRptPeriodChange() {
  const p = document.getElementById('rptPeriod').value;
  document.getElementById('rptMonthWrap').style.display = p==='month'  ? '' : 'none';
  document.getElementById('rptFromWrap').style.display  = p==='custom' ? '' : 'none';
  document.getElementById('rptToWrap').style.display    = p==='custom' ? '' : 'none';
  loadCurrentReport();
}

/* ── Populate filter selects ── */
function populateReportFilters() {
  const opts = (arr, valFn, txtFn) =>
    arr.map(x=>`<option value="${valFn(x)}">${esc(txtFn(x))}</option>`).join('');

  ['rptAccount','forecastAccountFilter'].forEach(id=>{
    const el = document.getElementById(id); if(!el) return;
    const cur = el.value;
    el.innerHTML = (id==='forecastAccountFilter'?'<option value="">Todas as contas</option>':'<option value="">Todas</option>') +
      opts(state.accounts, a=>a.id, a=>a.name);
    el.value = cur;
  });
  const catEl = document.getElementById('rptCategory');
  if(catEl) {
    const cur = catEl.value;
    catEl.innerHTML = '<option value="">Todas</option>' +
      opts(state.categories.sort((a,b)=>a.name.localeCompare(b.name)), c=>c.id, c=>(c.icon||'')+'  '+c.name);
    catEl.value = cur;
  }
  const payEl = document.getElementById('rptPayee');
  if(payEl) {
    const cur = payEl.value;
    payEl.innerHTML = '<option value="">Todos</option>' +
      opts(state.payees.sort((a,b)=>a.name.localeCompare(b.name)), p=>p.id, p=>p.name);
    payEl.value = cur;
  }

  // Tag filter
  _refreshRptTagFilter();

  // Member filter
  if (typeof populateFamilyMemberSelect === 'function') {
    populateFamilyMemberSelect('rptMember', { placeholder: 'Todos' });
  }
  // Relationship group filter
  if (typeof populateRelationshipFilter === 'function') {
    populateRelationshipFilter('rptRelGroup', 'Todos');
  }
}

/** When relationship group filter changes, reset the specific member filter */
function _onRptRelGroupChange() {
  // Clear specific member selection when a group is chosen
  const rptMem = document.getElementById('rptMember');
  if (rptMem) rptMem.value = '';
  loadCurrentReport(true);
}

/** Rebuild the tag filter dropdown from the current rptState.txData (or state.transactions). */
function _refreshRptTagFilter() {
  const tagEl = document.getElementById('rptTag');
  if (!tagEl) return;
  const cur = tagEl.value;
  // Collect all unique tags from loaded transactions
  const tagSet = new Set();
  const src = rptState.txData?.length ? rptState.txData : (state.transactions || []);
  src.forEach(t => (t.tags || []).forEach(tag => { if (tag) tagSet.add(tag); }));
  const sorted = [...tagSet].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  tagEl.innerHTML = '<option value="">Todas</option>' +
    sorted.map(tag => `<option value="${esc(tag)}">${esc(tag)}</option>`).join('');
  if (cur && tagSet.has(cur)) tagEl.value = cur;
}

let _rptLoading = false;
async function loadCurrentReport(resetPage = false) {
  if (_rptLoading) return; // prevent concurrent fetches
  _rptLoading = true;
  try {
    if (rptState.view === 'regular')           await loadReports();
    else if (rptState.view === 'transactions') await loadReportTx();
    else if (rptState.view === 'forecast')     await loadForecast();
  } finally {
    _rptLoading = false;
  }
}

/* ── Fetch filtered transactions ── */
async function fetchRptTransactions() {
  const {from, to} = getRptDateRange();
  const accId  = document.getElementById('rptAccount')?.value   || '';
  const typeV  = document.getElementById('rptType')?.value      || '';
  const catId  = document.getElementById('rptCategory')?.value  || '';
  const payId  = document.getElementById('rptPayee')?.value     || '';
  const tagV    = document.getElementById('rptTag')?.value       || '';
  const memberV   = document.getElementById('rptMember')?.value    || '';
  const relGroupV = document.getElementById('rptRelGroup')?.value  || '';

  let q = famQ(sb.from('transactions')
    .select('*, accounts!transactions_account_id_fkey(name,color,currency), categories(name,color,type), payees(name)'))
    .gte('date',from).lte('date',to)
    .order('date',{ascending:false});
  if(accId) q = q.eq('account_id', accId);
  if(catId) q = q.eq('category_id', catId);
  if(payId) q = q.eq('payee_id', payId);
  if(typeV==='expense') q = q.lt('amount',0);
  if(typeV==='income')  q = q.gt('amount',0);
  // Tag filter: PostgREST array-contains operator
  if(tagV)    q = q.contains('tags', [tagV]);
  // Apply specific member filter OR relationship group filter
  // Uses family_member_ids[] (array) when available, falls back to family_member_id
  if (memberV) {
    q = q.or(`family_member_id.eq.${memberV},family_member_ids.cs.{${memberV}}`);
  } else if (relGroupV && typeof getMemberIdsByRelGroup === 'function') {
    const groupIds = getMemberIdsByRelGroup(relGroupV);
    if (groupIds && groupIds.length > 0) {
      q = q.in('family_member_id', groupIds);
    } else if (groupIds && groupIds.length === 0) {
      return []; // group exists but empty → no results
    }
  }

  const {data, error} = await q;
  if(error) { toast(error.message,'error'); return []; }
  const result = (data||[]).filter(t=>!t.is_transfer);

  // Refresh tag dropdown with tags found in this period/filters
  // (do it after filter so we show tags relevant to current context)
  setTimeout(_refreshRptTagFilter, 0);
  // Refresh member and relationship selects
  setTimeout(() => {
    if (typeof populateFamilyMemberSelect === 'function') {
      populateFamilyMemberSelect('rptMember', { placeholder: 'Todos' });
    }
    if (typeof populateRelationshipFilter === 'function') {
      populateRelationshipFilter('rptRelGroup', 'Todos');
    }
  }, 0);

  return result;
}

/* ═══ VIEW: ANÁLISE ═══ */
async function loadReports() {
  const {from, to} = getRptDateRange();
  const txs  = await fetchRptTransactions();
  rptState.txData = txs;

  const exps = txs.filter(t=>t.amount<0);
  const incs = txs.filter(t=>t.amount>0);
  const _rBrl=t=>typeof txToBRL==='function'?Math.abs(txToBRL(t)):Math.abs(t.brl_amount??t.amount??0);
  const totExp=exps.reduce((s,t)=>s+_rBrl(t),0);
  const totInc=incs.reduce((s,t)=>s+_rBrl(t),0);
  const bal    = totInc - totExp;

  /* KPIs */
  document.getElementById('reportKpis').innerHTML = `
    <div class="rpt-kpi rpt-kpi--inc"><div class="rpt-kpi-label">Receitas</div><div class="rpt-kpi-value">${fmt(totInc)}</div></div>
    <div class="rpt-kpi rpt-kpi--exp"><div class="rpt-kpi-label">Despesas</div><div class="rpt-kpi-value">${fmt(totExp)}</div></div>
    <div class="rpt-kpi rpt-kpi--bal ${bal>=0?'pos':'neg'}"><div class="rpt-kpi-label">Saldo</div><div class="rpt-kpi-value">${fmt(bal)}</div></div>
    <div class="rpt-kpi"><div class="rpt-kpi-label">Transações</div><div class="rpt-kpi-value">${txs.length}</div></div>
    <div class="report-kpi"><div class="report-kpi-label">Ticket médio</div><div class="report-kpi-value">${exps.length?fmt(totExp/exps.length):'—'}</div></div>
  `;
  document.getElementById('reportDataInfo').textContent =
    `${fmtDate(from)} → ${fmtDate(to)}  ·  ${txs.length} transações`;

  /* Despesas por categoria */
  const expMap = {};
  exps.forEach(t=>{
    const n=t.categories?.name||'Sem categoria', c=t.categories?.color||'#94a3b8';
    if(!expMap[n]) expMap[n]={total:0,rawColor:c,count:0};
    expMap[n].total+=_rBrl(t); expMap[n].count++;
  });
  const expEntries = Object.entries(expMap).sort((a,b)=>b[1].total-a[1].total);
  // Always destroy stale instance — even if there is no data to render,
  // so filters don't leave the previous chart visible
  if(state.chartInstances['reportCatChart']) {
    state.chartInstances['reportCatChart'].destroy();
    delete state.chartInstances['reportCatChart'];
  }
  if(expEntries.length){
    const _expColors = new Set();
    renderChart('reportCatChart','doughnut',expEntries.map(e=>e[0]),
      [{data:expEntries.map(e=>e[1].total),
        backgroundColor:expEntries.map((e,i)=>_catColor(e[1].rawColor,i,_expColors)),
        borderWidth:2,borderColor:'#fff',hoverOffset:8}]);
  }

  /* Receitas por categoria */
  const incMap = {};
  incs.forEach(t=>{
    const n=t.categories?.name||'Sem categoria', c=t.categories?.color||'#94a3b8';
    if(!incMap[n]) incMap[n]={total:0,rawColor:c,count:0};
    incMap[n].total+=_rBrl(t); incMap[n].count++;
  });
  const incEntries = Object.entries(incMap).sort((a,b)=>b[1].total-a[1].total);
  // Always destroy stale instance first
  if(state.chartInstances['reportIncomeChart']) {
    state.chartInstances['reportIncomeChart'].destroy();
    delete state.chartInstances['reportIncomeChart'];
  }
  if(incEntries.length){
    const _incColors = new Set();
    renderChart('reportIncomeChart','doughnut',incEntries.map(e=>e[0]),
      [{data:incEntries.map(e=>e[1].total),
        backgroundColor:incEntries.map((e,i)=>_catColor(e[1].rawColor,i,_incColors)),
        borderWidth:2,borderColor:'#fff',hoverOffset:8}]);
  }

  /* Por conta */
  const accMap = {};
  txs.forEach(t=>{
    const n=t.accounts?.name||'—', c=t.accounts?.color||'#94a3b8';
    if(!accMap[n]) accMap[n]={exp:0,inc:0,color:c};
    if(t.amount<0) accMap[n].exp+=_rBrl(t); else accMap[n].inc+=_rBrl(t);
  });
  const accE = Object.entries(accMap).sort((a,b)=>(b[1].exp+b[1].inc)-(a[1].exp+a[1].inc));
  if(accE.length)
    renderChart('reportAccountChart','bar',accE.map(e=>e[0]),[
      {label:'Despesas',data:accE.map(e=>+e[1].exp.toFixed(2)),backgroundColor:'rgba(192,57,43,.8)',borderRadius:5,borderSkipped:false},
      {label:'Receitas',data:accE.map(e=>+e[1].inc.toFixed(2)),backgroundColor:'rgba(42,122,74,.8)',borderRadius:5,borderSkipped:false},
    ]);

  /* Evolução */
  await renderTrendChart(from, to);

  /* ─── Tabela de categorias — agrupada por Despesa / Receita / Transferência ─── */
  (function renderCatTable() {
    // Inclui transferências (is_transfer=true) como terceiro grupo
    const allTxs = [...txs];
    // Fetch transfers separately to show in the third group
    // (fetchRptTransactions already excluded them, so we only have expense/income here)
    // Build maps per group
    const expMap = {}, incMap = {}, trnMap = {};
    allTxs.forEach(t => {
      const n = t.categories?.name || 'Sem categoria';
      const c = t.categories?.color || '#94a3b8';
      if (t.is_transfer) {
        if (!trnMap[n]) trnMap[n] = { name: n, color: c, total: 0, count: 0 };
        trnMap[n].total += (typeof txToBRL==="function"?Math.abs(txToBRL(t)):Math.abs(t.brl_amount??t.amount??0)); trnMap[n].count++;
      } else if (t.amount < 0) {
        if (!expMap[n]) expMap[n] = { name: n, color: c, total: 0, count: 0 };
        expMap[n].total += (typeof txToBRL==="function"?Math.abs(txToBRL(t)):Math.abs(t.brl_amount??t.amount??0)); expMap[n].count++;
      } else {
        if (!incMap[n]) incMap[n] = { name: n, color: c, total: 0, count: 0 };
        incMap[n].total += t.amount; incMap[n].count++;
      }
    });

    const expE = Object.values(expMap).sort((a, b) => b.total - a.total);
    const incE = Object.values(incMap).sort((a, b) => b.total - a.total);
    const trnE = Object.values(trnMap).sort((a, b) => b.total - a.total);
    const totExp = expE.reduce((s, e) => s + e.total, 0);
    const totInc = incE.reduce((s, e) => s + e.total, 0);
    const totTrn = trnE.reduce((s, e) => s + e.total, 0);

    function groupRows(entries, groupTotal, amtClass, sign) {
      return entries.map(v => `<tr>
        <td style="padding-left:18px">
          <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${v.color};margin-right:6px;flex-shrink:0;vertical-align:middle"></span>${esc(v.name)}
        </td>
        <td class="text-muted" style="text-align:center">${v.count}</td>
        <td class="${amtClass}">${sign}${fmt(v.total)}</td>
        <td>
          <div style="display:flex;align-items:center;gap:5px">
            <div style="flex:1;min-width:44px;background:var(--bg2);border-radius:100px;height:4px">
              <div style="width:${groupTotal>0?(v.total/groupTotal*100).toFixed(1):0}%;height:100%;background:${v.color};border-radius:100px"></div>
            </div>
            <span style="font-size:.7rem;color:var(--muted);width:36px;text-align:right">${groupTotal>0?(v.total/groupTotal*100).toFixed(1):0}%</span>
          </div>
        </td>
      </tr>`).join('');
    }

    function groupHeader(label, total, colorHex, amtClass, sign, count) {
      return `<tr style="background:var(--surface2)">
        <td colspan="4" style="padding:8px 10px 6px">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px">
            <span style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:${colorHex}">${label}</span>
            <span style="font-size:.82rem;font-weight:700;${amtClass.includes('neg')?'color:var(--red)':amtClass.includes('pos')?'color:var(--green)':'color:var(--text2)'}">${sign}${fmt(total)}<span style="font-size:.7rem;font-weight:400;color:var(--muted);margin-left:6px">${count} categoria${count!==1?'s':''}</span></span>
          </div>
        </td>
      </tr>`;
    }

    let html = '';
    if (expE.length) {
      html += groupHeader('💸 Despesas', totExp, 'var(--red,#c0392b)', 'amount-neg', '-', expE.length);
      html += groupRows(expE, totExp, 'amount-neg', '-');
    }
    if (incE.length) {
      html += groupHeader('📈 Receitas', totInc, 'var(--green,#2a7a4a)', 'amount-pos', '', incE.length);
      html += groupRows(incE, totInc, 'amount-pos', '');
    }
    if (trnE.length) {
      html += groupHeader('🔄 Transferências', totTrn, 'var(--accent,#2a6049)', 'amount-transfer', '', trnE.length);
      html += groupRows(trnE, totTrn, 'text-muted', '');
    }
    if (!html) html = '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:28px">Nenhuma transação no período</td></tr>';

    document.getElementById('reportCatBody').innerHTML = html;
  })();
}

async function renderTrendChart(from, to) {
  const MNAMES=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const months=[], seen=new Set();
  let cur=new Date(from+'T12:00'); const end=new Date(to+'T12:00');
  while(cur<=end){
    const y=cur.getFullYear(), m=String(cur.getMonth()+1).padStart(2,'0'), k=`${y}-${m}`;
    if(!seen.has(k)){seen.add(k);months.push({key:k,label:MNAMES[cur.getMonth()]+'/'+String(y).slice(2),inc:0,exp:0});}
    cur.setMonth(cur.getMonth()+1);
  }
  if(months.length<=1){
    const wkMap={};
    rptState.txData.forEach(t=>{
      const d=new Date(t.date+'T12:00');
      const w='Sem '+Math.ceil(d.getDate()/7);
      if(!wkMap[w]) wkMap[w]={inc:0,exp:0};
      if(t.amount<0) wkMap[w].exp+=(typeof txToBRL==="function"?Math.abs(txToBRL(t)):Math.abs(t.brl_amount??t.amount??0)); else wkMap[w].inc+=(typeof txToBRL==="function"?Math.abs(txToBRL(t)):parseFloat(t.brl_amount??t.amount)??0);
    });
    const wks=Object.entries(wkMap);
    if(wks.length) renderChart('reportTrendChart','bar',wks.map(w=>w[0]),[
      {label:'Receitas',data:wks.map(w=>+w[1].inc.toFixed(2)),backgroundColor:'rgba(42,122,74,.8)',borderRadius:5,borderSkipped:false},
      {label:'Despesas',data:wks.map(w=>+w[1].exp.toFixed(2)),backgroundColor:'rgba(192,57,43,.75)',borderRadius:5,borderSkipped:false},
    ]);
    return;
  }
  rptState.txData.forEach(t=>{
    const m=months.find(x=>x.key===t.date.slice(0,7)); if(!m) return;
    if(t.amount<0) m.exp+=(typeof txToBRL==="function"?Math.abs(txToBRL(t)):Math.abs(t.brl_amount??t.amount??0)); else m.inc+=(typeof txToBRL==="function"?Math.abs(txToBRL(t)):parseFloat(t.brl_amount??t.amount)??0);
  });
  renderChart('reportTrendChart','bar',months.map(m=>m.label),[
    {label:'Receitas',data:months.map(m=>+m.inc.toFixed(2)),backgroundColor:'rgba(42,122,74,.8)',borderRadius:5,borderSkipped:false},
    {label:'Despesas',data:months.map(m=>+m.exp.toFixed(2)),backgroundColor:'rgba(192,57,43,.75)',borderRadius:5,borderSkipped:false},
  ]);
}

/* ═══ VIEW: TRANSAÇÕES ═══ */
async function loadReportTx() {
  const {from,to}=getRptDateRange();
  const txs = await fetchRptTransactions();
  rptState.txData = txs;
  const totExp=txs.filter(t=>t.amount<0).reduce((s,t)=>s+(typeof txToBRL==="function"?Math.abs(txToBRL(t)):Math.abs(t.brl_amount??t.amount??0)),0);
  const totInc=txs.filter(t=>t.amount>0).reduce((s,t)=>s+(typeof txToBRL==="function"?txToBRL(t):parseFloat(t.brl_amount??t.amount)??0),0);
  document.getElementById('reportTxKpis').innerHTML=`
    <div class="report-kpi"><div class="report-kpi-label">Receitas</div><div class="report-kpi-value text-green">${fmt(totInc)}</div></div>
    <div class="report-kpi"><div class="report-kpi-label">Despesas</div><div class="report-kpi-value text-red">${fmt(totExp)}</div></div>
    <div class="report-kpi"><div class="report-kpi-label">Saldo</div><div class="report-kpi-value ${(totInc-totExp)>=0?'text-green':'text-red'}">${fmt(totInc-totExp)}</div></div>
    <div class="report-kpi"><div class="report-kpi-label">Qtd</div><div class="report-kpi-value">${txs.length}</div></div>`;
  document.getElementById('reportDataInfo').textContent=`${fmtDate(from)} → ${fmtDate(to)}  ·  ${txs.length} transações`;
  renderReportTxTable(txs);
}

function rptSortTx(field) {
  if(rptTxSortField===field) rptTxSortAsc=!rptTxSortAsc;
  else {rptTxSortField=field; rptTxSortAsc=false;}
  ['Date','Desc','Amt'].forEach(f=>{const el=document.getElementById('rptSort'+f);if(el)el.textContent='';});
  const arrow=rptTxSortAsc?'▲':'▼';
  const map={date:'Date',description:'Desc',amount:'Amt'};
  const el=document.getElementById('rptSort'+(map[field]||''));if(el)el.textContent=' '+arrow;
  const sorted=[...rptState.txData].sort((a,b)=>{
    const va=a[field], vb=b[field];
    if(typeof va==='string') return rptTxSortAsc?va.localeCompare(vb):vb.localeCompare(va);
    return rptTxSortAsc?(va-vb):(vb-va);
  });
  renderReportTxTable(sorted);
}

function renderReportTxTable(txs) {
  const total=txs.reduce((s,t)=>s+(typeof txToBRL==="function"?txToBRL(t):parseFloat(t.brl_amount??t.amount)??0),0);
  const countEl=document.getElementById('reportTxCount');
  if(countEl) countEl.textContent=txs.length+' registros';
  const totEl=document.getElementById('reportTxTotal');
  if(totEl){totEl.textContent=fmt(total);totEl.className=total>=0?'amount-pos':'amount-neg';}
  document.getElementById('reportTxBody').innerHTML=txs.length
    ? txs.map(t=>`<tr>
        <td style="white-space:nowrap;font-size:.8rem;color:var(--muted)">${fmtDate(t.date)}</td>
        <td style="max-width:180px"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.description||'—')}</div></td>
        <td style="font-size:.8rem">${esc(t.accounts?.name||'—')}</td>
        <td>${t.categories?`<span class="badge" style="background:${t.categories.color}18;color:${t.categories.color};border:1px solid ${t.categories.color}30;font-size:.68rem">${esc(t.categories.name)}</span>`:'—'}</td>
        <td style="font-size:.8rem;color:var(--muted)">${esc(t.payees?.name||'—')}</td>
        <td class="${t.amount>=0?'amount-pos':'amount-neg'}" style="white-space:nowrap;font-weight:600">${fmt(t.amount)}</td>
      </tr>`).join('')
    : '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:28px">Nenhuma transação no período</td></tr>';
}

/* ═══ VIEW TOGGLE ═══ */
function setReportView(view) {
  rptState.view = view;
  document.getElementById('reportRegularView').style.display  = view==='regular'       ? '' : 'none';
  document.getElementById('reportTxView').style.display       = view==='transactions'  ? '' : 'none';
  document.getElementById('reportForecastView').style.display = view==='forecast'      ? '' : 'none';
  document.getElementById('reportFilterBar').style.display    = view==='forecast'      ? 'none' : '';
  ['rptBtnRegular','rptBtnTx','rptBtnForecast'].forEach(id=>
    document.getElementById(id)?.classList.remove('active'));
  const map={regular:'rptBtnRegular',transactions:'rptBtnTx',forecast:'rptBtnForecast'};
  document.getElementById(map[view])?.classList.add('active');
  if(view==='forecast'){
    if(!document.getElementById('forecastFrom').value){
      const today=new Date().toISOString().slice(0,10);
      const in3=new Date();in3.setMonth(in3.getMonth()+3);
      document.getElementById('forecastFrom').value=today;
      document.getElementById('forecastTo').value=in3.toISOString().slice(0,10);
    }
    loadForecast();
  } else {
    loadCurrentReport();
  }
}

/* ═══════════════════════════════════════════════════════════════════
   PDF CORE — _buildReportPDF(doc)
   Captura TUDO que está na tela: filtros ativos, KPIs, gráficos
   como imagem, tabelas completas e previsão.
═══════════════════════════════════════════════════════════════════ */

/* ── Helpers ── */
function _getPeriodLabel() {
  const p = document.getElementById('rptPeriod')?.value || 'month';
  return { month:'Mês', custom:'Período', quarter:'Trimestre', year:'Ano', last12:'Últimos 12 meses' }[p] || p;
}
function _getActiveFiltersLabel() {
  const parts = [];
  const acc = document.getElementById('rptAccount');
  if (acc?.value) parts.push('Conta: ' + (acc.options[acc.selectedIndex]?.text || acc.value));
  const cat = document.getElementById('rptCategory');
  if (cat?.value) parts.push('Cat: ' + (cat.options[cat.selectedIndex]?.text || cat.value));
  const pay = document.getElementById('rptPayee');
  if (pay?.value) parts.push('Ben: ' + (pay.options[pay.selectedIndex]?.text || pay.value));
  const typ = document.getElementById('rptType');
  if (typ?.value) parts.push(typ.value === 'expense' ? 'Só Despesas' : 'Só Receitas');
  const tag = document.getElementById('rptTag');
  if (tag?.value) parts.push('Tag: ' + tag.value);
  const mem = document.getElementById('rptMember');
  if (mem?.value) {
    const memName = mem.options[mem.selectedIndex]?.text?.replace(/^[^\s]+\s/, '') || mem.value;
    parts.push('Membro: ' + memName);
  }
  const relGrp = document.getElementById('rptRelGroup');
  if (relGrp?.value) parts.push('Grupo: ' + relGrp.value);
  return parts.length ? parts.join(' · ') : 'Todos os dados';
}

/* ── Capture chart canvas → PNG base64, even when hidden ── */
function _chartToImage(canvasId) {
  try {
    const canvas = document.getElementById(canvasId);
    if (!canvas || canvas.width === 0 || canvas.height === 0) return null;
    return canvas.toDataURL('image/png', 0.95);
  } catch (e) { return null; }
}

/* ── Ensure all report charts are rendered before PDF ──
 *
 * Strategy: make reportRegularView visible, force a full re-render of all
 * charts (destroys and recreates Chart.js instances at the correct pixel
 * ratio), wait two animation frames for the browser to paint, then let
 * _buildReportPDF capture the canvases. Visibility is restored afterward.
 */
async function _ensureChartsRendered() {
  if (rptState.view === 'regular') {
    // Make the report view container fully visible so Chart.js renders
    // at the correct devicePixelRatio and with full colors.
    const view = document.getElementById('reportRegularView');
    const page = document.getElementById('page-reports');
    const viewWasHidden = view && view.style.display === 'none';
    const pageWasHidden = page && !page.classList.contains('active');

    if (viewWasHidden && view) view.style.display = '';
    if (pageWasHidden && page) { page.style.visibility = 'hidden'; page.classList.add('active'); }

    // Force chart instances to recalculate their dimensions now that the
    // container is display:block. Chart.js renders at 0×0 if the canvas
    // was inside a display:none parent at draw time.
    Object.values(state.chartInstances || {}).forEach(ch => {
      try { ch.resize(); } catch(e) {}
    });

    // Always re-render: destroys old (potentially faded) chart instances
    // and creates fresh ones with correct colors and pixel ratio.
    await loadReports();

    // Wait two frames — first for Chart.js to draw, second for browser to composite
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    // Extra resize pass after render to ensure all canvases are at full resolution
    Object.values(state.chartInstances || {}).forEach(ch => {
      try { ch.resize(); } catch(e) {}
    });
    await new Promise(r => requestAnimationFrame(r));

    // Restore visibility (will be undone again in _buildReportPDF if needed)
    if (viewWasHidden && view) view.style.display = 'none';
    if (pageWasHidden && page) { page.classList.remove('active'); page.style.visibility = ''; }
    return;
  }
  if (rptState.view === 'transactions') {
    if (!rptState.txData?.length) await loadReportTx();
    return;
  }
  if (rptState.view === 'forecast') {
    if (!state.chartInstances?.['forecastChart']) await loadForecast();
    return;
  }
}

/* ══════════════════════════════════════════════════════════════════
   PDF DESIGN SYSTEM
══════════════════════════════════════════════════════════════════ */
const PDF_GREEN      = [34, 85, 60];
const PDF_GREEN_DARK = [22, 58, 42];
const PDF_GREEN_LT   = [42, 122, 74];
const PDF_RED        = [192, 57, 43];
const PDF_AMBER      = [180, 83, 9];
const PDF_GRAY       = [100, 100, 100];
const PDF_MUTED      = [140, 130, 120];
const PDF_BG         = [248, 252, 249];
const PDF_CARD       = [255, 255, 255];
const PDF_BORDER     = [210, 225, 215];

function _pdfNewPage(doc) {
  doc.addPage();
  return 18;
}

function _pdfCheckY(doc, y, needed) {
  const H = doc.internal.pageSize.getHeight();
  if (y + needed > H - 18) return _pdfNewPage(doc);
  return y;
}

/* ── Cover / Header ── */
function _pdfHeader(doc, from, to, viewLabel, familyName) {
  const W = doc.internal.pageSize.getWidth();

  // Deep green background
  doc.setFillColor(...PDF_GREEN_DARK);
  doc.rect(0, 0, W, 42, 'F');
  // Accent stripe
  doc.setFillColor(...PDF_GREEN_LT);
  doc.rect(0, 0, 5, 42, 'F');
  // Subtle diagonal stripe overlay (decorative) — reset opacity immediately after
  if (doc.setGState) {
    doc.setFillColor(255, 255, 255);
    doc.setGState(new doc.GState({ opacity: 0.04 }));
    // Draw a subtle stripe rect here if desired (currently just sets fill, no draw)
    doc.setGState(new doc.GState({ opacity: 1.0 })); // ← CRITICAL: restore full opacity
  }

  // Logo mark
  doc.setFontSize(11); doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text('Family FinTrack', 11, 18);

  // Main title
  doc.setFontSize(15); doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text('Relatório Financeiro', 32, 13);
  // Subtitle: view label
  doc.setFontSize(9); doc.setFont('helvetica', 'normal');
  doc.setTextColor(200, 235, 215);
  doc.text(viewLabel, 32, 20);

  // Period pill
  const periodText = fmtDate(from) + ' → ' + fmtDate(to);
  doc.setFontSize(8);
  doc.setTextColor(180, 220, 200);
  doc.text('📅  ' + periodText, 32, 28);

  // Filters
  const fl = _getActiveFiltersLabel();
  if (fl !== 'Todos os dados') {
    doc.setFontSize(7);
    doc.setTextColor(150, 195, 175);
    doc.text('Filtros: ' + fl, 32, 34);
  }

  // Right side: date + family
  doc.setFontSize(7.5); doc.setFont('helvetica', 'normal');
  doc.setTextColor(180, 220, 200);
  doc.text('Gerado em ' + new Date().toLocaleString('pt-BR'), W - 12, 28, { align: 'right' });
  if (familyName) {
    doc.text(familyName, W - 12, 35, { align: 'right' });
  }

  // Bottom accent line
  doc.setDrawColor(...PDF_GREEN_LT);
  doc.setLineWidth(0.5);
  doc.line(0, 42, W, 42);

  return 50; // next Y
}

/* ── Section title bar ── */
function _pdfSectionTitle(doc, y, title) {
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(242, 248, 244);
  doc.rect(14, y - 2, W - 28, 11, 'F');
  doc.setDrawColor(...PDF_BORDER);
  doc.setLineWidth(0.25);
  doc.line(14, y + 9, W - 14, y + 9);
  // Left accent bar
  doc.setFillColor(...PDF_GREEN);
  doc.rect(14, y - 2, 3, 11, 'F');
  doc.setFontSize(9.5); doc.setFont('helvetica', 'bold');
  doc.setTextColor(...PDF_GREEN);
  doc.text(title, 21, y + 5.5);
  return y + 14;
}

/* ── KPI row ── */
function _pdfKpis(doc, y, txs) {
  const W = doc.internal.pageSize.getWidth();
  const totExp = txs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const totInc = txs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const bal    = totInc - totExp;
  const nExp   = txs.filter(t => t.amount < 0).length;
  const avg    = nExp ? totExp / nExp : 0;

  const kpis = [
    { label: 'RECEITAS',     value: fmt(totInc), color: PDF_GREEN_LT, bg: [235, 250, 240] },
    { label: 'DESPESAS',     value: fmt(totExp), color: PDF_RED,      bg: [252, 240, 238] },
    { label: 'SALDO',        value: fmt(bal),    color: bal >= 0 ? PDF_GREEN_LT : PDF_RED, bg: bal >= 0 ? [235, 250, 240] : [252, 240, 238] },
    { label: 'TRANSAÇÕES',   value: String(txs.length), color: PDF_GREEN, bg: [240, 248, 244] },
    { label: 'TICKET MÉDIO', value: avg ? fmt(avg) : '—', color: PDF_GRAY, bg: [245, 245, 245] },
  ];

  const kw = (W - 28) / kpis.length;
  kpis.forEach(({ label, value, color, bg }, i) => {
    const x = 14 + i * kw;
    // Card background
    doc.setFillColor(...bg);
    doc.roundedRect(x, y, kw - 2.5, 22, 2, 2, 'F');
    // Top color bar
    doc.setFillColor(...color);
    doc.rect(x, y, kw - 2.5, 3, 'F');
    // Label
    doc.setFontSize(5.8); doc.setFont('helvetica', 'bold');
    doc.setTextColor(...PDF_MUTED);
    doc.text(label, x + 4, y + 9);
    // Value
    doc.setFontSize(8.5); doc.setFont('helvetica', 'bold');
    doc.setTextColor(...color);
    doc.text(value, x + 4, y + 18, { maxWidth: kw - 8 });
  });
  return y + 28;
}

/* ── Health indicators ── */
function _pdfHealthBar(doc, y, txs) {
  const W = doc.internal.pageSize.getWidth();
  const totExp = txs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const totInc = txs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  if (!totInc) return y;

  const savingsRate = ((totInc - totExp) / totInc * 100);
  const expenseRate = (totExp / totInc * 100);
  const barW = W - 28;

  doc.setFillColor(245, 248, 246);
  doc.roundedRect(14, y, barW, 14, 2, 2, 'F');
  doc.setDrawColor(...PDF_BORDER);
  doc.setLineWidth(0.2);
  doc.roundedRect(14, y, barW, 14, 2, 2, 'S');

  // Left: savings rate
  doc.setFontSize(7); doc.setFont('helvetica', 'bold');
  doc.setTextColor(savingsRate >= 20 ? 42 : savingsRate >= 5 ? 180 : 192,
                   savingsRate >= 20 ? 122 : savingsRate >= 5 ? 83 : 57,
                   savingsRate >= 20 ? 74 : savingsRate >= 5 ? 9 : 43);
  const srLabel = `Taxa de poupança: ${savingsRate.toFixed(1)}%`;
  doc.text(srLabel, 18, y + 9);

  // Center: expense bar
  const barStart = 80, barLen = barW - 100;
  doc.setFillColor(232, 236, 233);
  doc.rect(barStart, y + 5, barLen, 4, 'F');
  const fillLen = Math.min(expenseRate / 100, 1) * barLen;
  const fillColor = expenseRate > 90 ? PDF_RED : expenseRate > 70 ? PDF_AMBER : PDF_GREEN_LT;
  doc.setFillColor(...fillColor);
  doc.rect(barStart, y + 5, fillLen, 4, 'F');

  // Right: expense rate
  doc.setFontSize(7); doc.setFont('helvetica', 'normal');
  doc.setTextColor(...PDF_MUTED);
  doc.text(`${expenseRate.toFixed(1)}% da receita gasto`, W - 18, y + 9, { align: 'right' });

  return y + 18;
}

/* ── Render chart image into PDF ── */
function _pdfAddChart(doc, y, canvasId, title, opts = {}) {
  const W  = doc.internal.pageSize.getWidth();
  const img = _chartToImage(canvasId);
  if (!img) return y;
  const h  = opts.h || 62;
  const w  = opts.w || (W - 28);
  const x  = opts.x || 14;
  y = _pdfCheckY(doc, y, h + 20);
  if (title) y = _pdfSectionTitle(doc, y, title);
  // Card
  doc.setFillColor(...PDF_CARD);
  doc.setDrawColor(...PDF_BORDER);
  doc.setLineWidth(0.25);
  doc.roundedRect(x, y, w, h, 2, 2, 'FD');
  doc.addImage(img, 'PNG', x + 1, y + 1, w - 2, h - 2);
  return y + h + 4;
}

/* ── Two charts side-by-side ── */
function _pdfChartRow(doc, y, charts, rowH) {
  const W  = doc.internal.pageSize.getWidth();
  const h  = rowH || 64;
  const cw = (W - 30) / 2;
  y = _pdfCheckY(doc, y, h + 10);
  charts.forEach(({ canvasId, label }, i) => {
    const img = _chartToImage(canvasId);
    const x   = 14 + i * (cw + 2);
    doc.setFillColor(...PDF_CARD);
    doc.setDrawColor(...PDF_BORDER);
    doc.setLineWidth(0.25);
    doc.roundedRect(x, y, cw, h, 2, 2, 'FD');
    if (label) {
      doc.setFontSize(6.5); doc.setFont('helvetica', 'bold');
      doc.setTextColor(...PDF_MUTED);
      doc.text(label, x + 4, y + 6);
    }
    if (img) {
      doc.addImage(img, 'PNG', x + 1, y + (label ? 7 : 1), cw - 2, h - (label ? 8 : 2));
    } else {
      doc.setFontSize(8); doc.setTextColor(...PDF_MUTED);
      doc.text('Gráfico indisponível', x + cw / 2, y + h / 2, { align: 'center' });
    }
  });
  return y + h + 6;
}

/* ── Category breakdown table ── */
function _pdfCatTable(doc, y, txs) {
  y = _pdfCheckY(doc, y, 30);
  y = _pdfSectionTitle(doc, y, 'Detalhamento por Categoria');

  // Build separate maps per group
  const expMap = {}, incMap = {}, trnMap = {};
  txs.forEach(t => {
    const n = t.categories?.name || 'Sem categoria';
    if (t.is_transfer) {
      if (!trnMap[n]) trnMap[n] = { name: n, total: 0, count: 0 };
      trnMap[n].total += (typeof txToBRL==="function"?Math.abs(txToBRL(t)):Math.abs(t.brl_amount??t.amount??0)); trnMap[n].count++;
    } else if (t.amount < 0) {
      if (!expMap[n]) expMap[n] = { name: n, total: 0, count: 0 };
      expMap[n].total += (typeof txToBRL==="function"?Math.abs(txToBRL(t)):Math.abs(t.brl_amount??t.amount??0)); expMap[n].count++;
    } else {
      if (!incMap[n]) incMap[n] = { name: n, total: 0, count: 0 };
      incMap[n].total += t.amount; incMap[n].count++;
    }
  });

  const expE = Object.values(expMap).sort((a, b) => b.total - a.total);
  const incE = Object.values(incMap).sort((a, b) => b.total - a.total);
  const trnE = Object.values(trnMap).sort((a, b) => b.total - a.total);
  const totExp = expE.reduce((s, e) => s + e.total, 0);
  const totInc = incE.reduce((s, e) => s + e.total, 0);
  const totTrn = trnE.reduce((s, e) => s + e.total, 0);

  function buildBody(entries, groupTotal, signFn) {
    return entries.map(v => [
      v.name, v.count,
      signFn(v.total),
      groupTotal > 0 ? (v.total / groupTotal * 100).toFixed(1) + '%' : '0%',
    ]);
  }

  // Build grouped rows with section headers
  const body = [];
  const rowMeta = []; // {type: 'header'|'expense'|'income'|'transfer', total}

  if (expE.length) {
    body.push([`→ Despesas`, expE.length + ' categorias', fmt(totExp), '']);
    rowMeta.push({ type: 'header-exp' });
    expE.forEach(v => {
      body.push([v.name, v.count, fmt(v.total), totExp > 0 ? (v.total/totExp*100).toFixed(1)+'%' : '0%']);
      rowMeta.push({ type: 'expense' });
    });
  }
  if (incE.length) {
    body.push([`→ Receitas`, incE.length + ' categorias', fmt(totInc), '']);
    rowMeta.push({ type: 'header-inc' });
    incE.forEach(v => {
      body.push([v.name, v.count, fmt(v.total), totInc > 0 ? (v.total/totInc*100).toFixed(1)+'%' : '0%']);
      rowMeta.push({ type: 'income' });
    });
  }
  if (trnE.length) {
    body.push([`→ Transferências`, trnE.length + ' categorias', fmt(totTrn), '']);
    rowMeta.push({ type: 'header-trn' });
    trnE.forEach(v => {
      body.push([v.name, v.count, fmt(v.total), totTrn > 0 ? (v.total/totTrn*100).toFixed(1)+'%' : '0%']);
      rowMeta.push({ type: 'transfer' });
    });
  }
  if (!body.length) return y;

  doc.autoTable({
    startY: y,
    head: [['Categoria', 'Qtd', 'Total', '% do Grupo']],
    body,
    styles: { fontSize: 8, cellPadding: [3, 5] },
    headStyles: { fillColor: PDF_GREEN, textColor: [255,255,255], fontStyle: 'bold', fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 16, halign: 'center' },
      2: { cellWidth: 40, halign: 'right' },
      3: { cellWidth: 25, halign: 'right' },
    },
    margin: { left: 14, right: 14 },
    didParseCell(data) {
      if (data.section !== 'body') return;
      const meta = rowMeta[data.row.index];
      if (!meta) return;
      const isHeader = meta.type.startsWith('header');
      if (isHeader) {
        data.cell.styles.fillColor = meta.type === 'header-exp' ? [255,235,235]
          : meta.type === 'header-inc' ? [235,255,240] : [235,240,255];
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fontSize  = 8.5;
        data.cell.styles.textColor = meta.type === 'header-exp' ? PDF_RED
          : meta.type === 'header-inc' ? PDF_GREEN_LT : [30,91,168];
      } else if (data.column.index === 2) {
        data.cell.styles.textColor = meta.type === 'expense' ? PDF_RED
          : meta.type === 'income' ? PDF_GREEN_LT : [30,91,168];
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });
  return doc.lastAutoTable.finalY + 8;
}

/* ── Top payees table ── */
function _pdfPayeeTable(doc, y, txs) {
  const payMap = {};
  txs.filter(t => t.amount < 0).forEach(t => {
    const n = t.payees?.name || t.description || 'Sem beneficiário';
    if (!payMap[n]) payMap[n] = { total: 0, count: 0 };
    payMap[n].total += (typeof txToBRL==="function"?Math.abs(txToBRL(t)):Math.abs(t.brl_amount??t.amount??0)); payMap[n].count++;
  });
  const rows = Object.entries(payMap).sort((a,b) => b[1].total - a[1].total).slice(0, 15);
  if (!rows.length) return y;

  y = _pdfCheckY(doc, y, 30);
  y = _pdfSectionTitle(doc, y, 'Top Beneficiários (Despesas)');
  const grand = rows.reduce((s, [,v]) => s + v.total, 0);

  doc.autoTable({
    startY: y,
    head: [['Beneficiário', 'Qtd', 'Total', '% do Total']],
    body: rows.map(([name, v]) => [name, v.count, fmt(v.total),
      grand > 0 ? (v.total / grand * 100).toFixed(1) + '%' : '0%']),
    styles: { fontSize: 8, cellPadding: [3, 5] },
    headStyles: { fillColor: PDF_GREEN, textColor: [255,255,255], fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: PDF_BG },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 16, halign: 'center' },
      2: { cellWidth: 40, halign: 'right', fontStyle: 'bold', textColor: PDF_RED },
      3: { cellWidth: 25, halign: 'right' },
    },
    margin: { left: 14, right: 14 },
  });
  return doc.lastAutoTable.finalY + 8;
}

/* ── Transactions table ── */
function _pdfTxTable(doc, y, txs) {
  y = _pdfCheckY(doc, y, 30);
  y = _pdfSectionTitle(doc, y, 'Lista de Transações (' + txs.length + ')');

  const totInc = txs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const totExp = txs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const bal    = totInc - totExp;

  doc.autoTable({
    startY: y,
    head: [['Data', 'Descrição', 'Conta', 'Categoria', 'Beneficiário', 'Valor']],
    body: txs.map(t => [fmtDate(t.date), t.description || '—', t.accounts?.name || '—',
      t.categories?.name || '—', t.payees?.name || '—', fmt(t.amount)]),
    foot: [['', '', '', '', 'TOTAL', fmt(bal)]],
    styles: { fontSize: 7.5, cellPadding: [3, 5], overflow: 'ellipsize' },
    headStyles: { fillColor: PDF_GREEN, textColor: [255,255,255], fontStyle: 'bold', fontSize: 8 },
    footStyles: { fillColor: [240, 248, 244], textColor: PDF_GREEN, fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: PDF_BG },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 30 },
      3: { cellWidth: 30 },
      4: { cellWidth: 30 },
      5: { cellWidth: 32, halign: 'right' },
    },
    margin: { left: 14, right: 14 },
    didParseCell(data) {
      if (data.column.index === 5 && data.section === 'body') {
        const v = txs[data.row.index]?.amount;
        data.cell.styles.textColor = (v < 0) ? PDF_RED : PDF_GREEN_LT;
        data.cell.styles.fontStyle = 'bold';
      }
      if (data.column.index === 5 && data.section === 'foot') {
        data.cell.styles.textColor = bal < 0 ? PDF_RED : PDF_GREEN_LT;
      }
    },
  });
  return doc.lastAutoTable.finalY + 8;
}

/* ── Summary box ── */
function _pdfSummaryBox(doc, y, txs) {
  const W = doc.internal.pageSize.getWidth();
  const totExp = txs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const totInc = txs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const bal    = totInc - totExp;
  y = _pdfCheckY(doc, y, 22);

  doc.setFillColor(240, 248, 244);
  doc.setDrawColor(...PDF_GREEN_LT);
  doc.setLineWidth(0.4);
  doc.roundedRect(14, y, W - 28, 18, 2, 2, 'FD');

  doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...PDF_GREEN);
  doc.text('Resumo do período', 19, y + 7);
  doc.setFont('helvetica', 'normal'); doc.setTextColor(...PDF_GRAY);
  doc.text(
    `Receitas: ${fmt(totInc)}     Despesas: ${fmt(totExp)}     Saldo: ${fmt(bal)}     Transações: ${txs.length}`,
    19, y + 13
  );
  return y + 24;
}

/* ── Forecast section ── */
function _pdfForecastSection(doc, y) {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  y = _pdfAddChart(doc, y, 'forecastChart', 'Saldo Previsto por Conta', { h: 65 });

  const container = document.getElementById('forecastAccountsContainer');
  if (!container) return y;

  container.querySelectorAll('.forecast-account-section').forEach(section => {
    const accName = section.querySelector('.forecast-account-header div > div:first-child')
      ?.textContent?.trim() || 'Conta';
    const rows = [];
    section.querySelectorAll('tbody tr').forEach(tr => {
      const cells = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.replace(/\s+/g,' ').trim());
      if (cells.length >= 4) rows.push(cells.slice(0, 5));
    });
    if (!rows.length) return;
    y = _pdfCheckY(doc, y, 30);
    y = _pdfSectionTitle(doc, y, accName);

    doc.autoTable({
      startY: y,
      head: [['Data', 'Descrição', 'Beneficiário', 'Valor', 'Saldo Prev.']],
      body: rows,
      styles: { fontSize: 7.5, cellPadding: [3,5] },
      headStyles: { fillColor: PDF_GREEN, textColor: [255,255,255], fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: PDF_BG },
      columnStyles: {
        0: { cellWidth: 22 }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 35 },
        3: { cellWidth: 30, halign: 'right' }, 4: { cellWidth: 30, halign: 'right', fontStyle: 'bold' },
      },
      margin: { left: 14, right: 14 },
      didParseCell(data) {
        if ((data.column.index === 3 || data.column.index === 4) && data.section === 'body') {
          data.cell.styles.textColor = (data.cell.raw||'').trim().startsWith('-') ? PDF_RED : PDF_GREEN_LT;
          data.cell.styles.fontStyle = 'bold';
        }
      },
    });
    y = doc.lastAutoTable.finalY + 10;
  });
  return y;
}

/* ── Footer on every page ── */
function _pdfFooter(doc, from, to) {
  const pages = doc.internal.getNumberOfPages();
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFillColor(240, 246, 242);
    doc.rect(0, H - 11, W, 11, 'F');
    doc.setDrawColor(...PDF_BORDER);
    doc.setLineWidth(0.25);
    doc.line(0, H - 11, W, H - 11);
    doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...PDF_MUTED);
    doc.text('Family FinTrack  ·  Documento Confidencial', 14, H - 4);
    doc.text(new Date().toLocaleDateString('pt-BR'), W / 2, H - 4, { align: 'center' });
    doc.text(`Página ${i} / ${pages}`, W - 14, H - 4, { align: 'right' });
  }
}

/* ══════════════════════════════════════════════════════════════════
   _buildReportPDF — master function
   Reads EXACTLY what is on screen at the moment of the call.
══════════════════════════════════════════════════════════════════ */
async function _buildReportPDF() {
  const { jsPDF } = window.jspdf;
  const { from, to } = getRptDateRange();
  const txs = rptState.txData;

  // Ensure reportRegularView is visible during the entire PDF build so that
  // canvas.toDataURL() captures full-opacity colors (Chart.js renders faded
  // colors when the parent was display:none at draw time).
  const _rptView = document.getElementById('reportRegularView');
  const _rptPage = document.getElementById('page-reports');
  const _viewWasHidden = _rptView && _rptView.style.display === 'none';
  const _pageWasHidden = _rptPage && !_rptPage.classList.contains('active');
  if (_viewWasHidden) _rptView.style.display = '';
  if (_pageWasHidden) { _rptPage.style.visibility = 'hidden'; _rptPage.classList.add('active'); }

  // Re-render charts with correct visibility so colors are vivid
  await _ensureChartsRendered();

  const viewLabels = {
    regular:      'Análise por Categoria',
    transactions: 'Lista de Transações',
    forecast:     'Previsão de Saldo',
  };
  const viewLabel = viewLabels[rptState.view] || 'Relatório';
  const familyName = typeof currentUser !== 'undefined'
    ? (currentUser?.name || currentUser?.email || '') : '';

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  let y = _pdfHeader(doc, from, to, viewLabel, familyName);

  /* ── KPIs + health bar ── */
  if (rptState.view !== 'forecast' && txs.length) {
    y = _pdfKpis(doc, y, txs);
    y = _pdfHealthBar(doc, y, txs);
    y += 4;
  }

  /* ── View: Análise ── */
  if (rptState.view === 'regular') {

    // Row 1: Expenses + Income doughnut charts
    const hasExpChart = !!_chartToImage('reportCatChart');
    const hasIncChart = !!_chartToImage('reportIncomeChart');
    if (hasExpChart || hasIncChart) {
      y = _pdfSectionTitle(doc, y, 'Distribuição de Gastos e Receitas');
      y = _pdfChartRow(doc, y, [
        { canvasId: 'reportCatChart',    label: 'Despesas por Categoria' },
        { canvasId: 'reportIncomeChart', label: 'Receitas por Categoria' },
      ], 68);
    }

    // Row 2: Account bar + Trend bar
    const hasAccChart  = !!_chartToImage('reportAccountChart');
    const hasTrendChart = !!_chartToImage('reportTrendChart');
    if (hasAccChart || hasTrendChart) {
      y = _pdfChartRow(doc, y, [
        { canvasId: 'reportAccountChart', label: 'Por Conta' },
        { canvasId: 'reportTrendChart',   label: 'Evolução no Período' },
      ], 62);
    }

    // Category breakdown
    if (txs.length) {
      y = _pdfCatTable(doc, y, txs);
      y = _pdfPayeeTable(doc, y, txs);
      y = _pdfSummaryBox(doc, y, txs);
    }

  /* ── View: Transações ── */
  } else if (rptState.view === 'transactions') {

    if (txs.length) {
      // Mini-breakdown charts (side by side)
      const W  = doc.internal.pageSize.getWidth();
      const cw = (W - 30) / 2;

      // Rebuild inline mini-charts data for PDF context
      // (these may not have separate canvases — use data to draw summary table instead)
      y = _pdfCheckY(doc, y, 18);

      // Quick stats by account
      const accMap = {};
      txs.forEach(t => {
        const n = t.accounts?.name || '—';
        if (!accMap[n]) accMap[n] = { inc: 0, exp: 0, count: 0 };
        if (t.amount >= 0) accMap[n].inc += (typeof txToBRL==='function'?Math.abs(txToBRL(t)):parseFloat(t.brl_amount??t.amount)??0);
        else accMap[n].exp += (typeof txToBRL==='function'?Math.abs(txToBRL(t)):Math.abs(t.brl_amount??t.amount??0));
        accMap[n].count++;
      });
      const accRows = Object.entries(accMap).sort((a,b)=>(b[1].inc+b[1].exp)-(a[1].inc+a[1].exp));

      if (accRows.length > 1) {
        y = _pdfSectionTitle(doc, y, 'Resumo por Conta');
        doc.autoTable({
          startY: y,
          head: [['Conta', 'Qtd', 'Receitas', 'Despesas', 'Saldo']],
          body: accRows.map(([name, v]) => [
            name, v.count, fmt(v.inc), fmt(v.exp), fmt(v.inc - v.exp)
          ]),
          styles: { fontSize: 8, cellPadding: [3,5] },
          headStyles: { fillColor: PDF_GREEN, textColor: [255,255,255], fontStyle: 'bold', fontSize: 8 },
          alternateRowStyles: { fillColor: PDF_BG },
          columnStyles: {
            0: { cellWidth: 'auto' },
            1: { cellWidth: 16, halign: 'center' },
            2: { cellWidth: 38, halign: 'right' },
            3: { cellWidth: 38, halign: 'right' },
            4: { cellWidth: 38, halign: 'right', fontStyle: 'bold' },
          },
          margin: { left: 14, right: 14 },
          didParseCell(data) {
            if (data.column.index === 4 && data.section === 'body') {
              const v = accRows[data.row.index]?.[1];
              const bal = (v?.inc||0) - (v?.exp||0);
              data.cell.styles.textColor = bal < 0 ? PDF_RED : PDF_GREEN_LT;
            }
            if (data.column.index === 2 && data.section === 'body') data.cell.styles.textColor = PDF_GREEN_LT;
            if (data.column.index === 3 && data.section === 'body') data.cell.styles.textColor = PDF_RED;
          },
        });
        y = doc.lastAutoTable.finalY + 8;
      }

      y = _pdfTxTable(doc, y, txs);
      y = _pdfSummaryBox(doc, y, txs);
    } else {
      const W = doc.internal.pageSize.getWidth();
      doc.setFontSize(10); doc.setTextColor(...PDF_MUTED);
      doc.text('Nenhuma transação no período selecionado.', W / 2, y + 20, { align: 'center' });
    }

  /* ── View: Previsão ── */
  } else if (rptState.view === 'forecast') {
    y = _pdfForecastSection(doc, y);
  }

  _pdfFooter(doc, from, to);
  // Restore view visibility that was set before chart rendering
  if (typeof _viewWasHidden !== 'undefined' && _viewWasHidden && _rptView) _rptView.style.display = 'none';
  if (typeof _pageWasHidden !== 'undefined' && _pageWasHidden && _rptPage) {
    _rptPage.classList.remove('active');
    _rptPage.style.visibility = '';
  }

  return { doc, from, to };
}

/* ═══ EXPORT: PDF ═══ */
async function exportReportPDF() {
  const btn  = document.querySelector('[onclick="exportReportPDF()"]');
  const orig = btn?.textContent || '📄 Baixar PDF';
  if (btn) { btn.textContent = '⏳ Gerando...'; btn.disabled = true; }
  try {
    const { doc, from, to } = await _buildReportPDF();
    doc.save(`FinTrack_${from}_${to}_${rptState.view}.pdf`);
    toast('✓ PDF gerado e baixado!', 'success');
  } catch (e) {
    toast('Erro ao gerar PDF: ' + e.message, 'error');
    console.error('[PDF]', e);
  } finally {
    if (btn) { btn.textContent = orig; btn.disabled = false; }
  }
}

/* ═══ EXPORT: PRINT ═══ */
function printReport() {
  const area = document.getElementById('printArea');
  const { from, to } = getRptDateRange();
  const txs = rptState.txData;
  const totExp = txs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const totInc = txs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const bal = totInc - totExp;
  const viewLabel = { regular:'Análise', transactions:'Transações', forecast:'Previsão' }[rptState.view] || '';

  // Capture charts as images
  const chartIds   = ['reportCatChart','reportIncomeChart','reportAccountChart','reportTrendChart','forecastChart'];
  const chartTitles = ['Despesas por Categoria','Receitas por Categoria','Por Conta','Evolução Mensal','Saldo Previsto'];
  const chartImgs  = chartIds.map((id, i) => {
    const img = _chartToImage(id);
    return img ? `<div style="background:#fff;border-radius:8px;padding:12px;box-shadow:0 1px 3px #0001">
      <div style="font-size:10px;font-weight:700;color:#22553c;margin-bottom:8px">${chartTitles[i]}</div>
      <img src="${img}" style="width:100%;height:auto;display:block">
    </div>` : '';
  }).filter(Boolean);

  const kpiHtml = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0">
      ${[
        ['Receitas', fmt(totInc), '#2a7a4a', '#e8f5ee'],
        ['Despesas', fmt(totExp), '#c0392b', '#fdf0ee'],
        ['Saldo',    fmt(bal),    bal>=0?'#2a7a4a':'#c0392b', bal>=0?'#e8f5ee':'#fdf0ee'],
        ['Transações', txs.length, '#22553c', '#f0f7f2'],
      ].map(([label, val, color, bg]) => `
        <div style="background:${bg};border-radius:8px;padding:12px;border-top:3px solid ${color}">
          <div style="font-size:9px;font-weight:700;color:#888;text-transform:uppercase;margin-bottom:4px">${label}</div>
          <div style="font-size:16px;font-weight:800;color:${color}">${val}</div>
        </div>`).join('')}
    </div>`;

  let chartsHtml = '';
  if (rptState.view === 'regular' && chartImgs.length) {
    chartsHtml = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
      ${chartImgs.slice(0, 4).join('')}
    </div>`;
  } else if (rptState.view === 'forecast' && chartImgs[4]) {
    chartsHtml = chartImgs[4];
  }

  let bodyHtml = '';
  if (rptState.view === 'transactions') {
    bodyHtml = `<table style="width:100%;border-collapse:collapse;font-size:11px">
      <thead><tr style="background:#22553c;color:#fff">
        <th style="padding:7px 8px;text-align:left">Data</th>
        <th style="padding:7px 8px;text-align:left">Descrição</th>
        <th style="padding:7px 8px;text-align:left">Conta</th>
        <th style="padding:7px 8px;text-align:left">Categoria</th>
        <th style="padding:7px 8px;text-align:left">Beneficiário</th>
        <th style="padding:7px 8px;text-align:right">Valor</th>
      </tr></thead><tbody>
      ${txs.map((t, i) => `<tr style="background:${i%2?'#f8fcf9':'#fff'}">
        <td style="padding:5px 8px;color:#666">${fmtDate(t.date)}</td>
        <td style="padding:5px 8px">${esc(t.description||'—')}</td>
        <td style="padding:5px 8px">${esc(t.accounts?.name||'—')}</td>
        <td style="padding:5px 8px">${esc(t.categories?.name||'—')}</td>
        <td style="padding:5px 8px">${esc(t.payees?.name||'—')}</td>
        <td style="padding:5px 8px;text-align:right;font-weight:700;color:${t.amount>=0?'#2a7a4a':'#c0392b'}">${fmt(t.amount)}</td>
      </tr>`).join('')}
      <tr style="background:#e8f5ee;font-weight:800">
        <td colspan="5" style="padding:8px 8px">TOTAL</td>
        <td style="padding:8px;text-align:right;color:${bal>=0?'#2a7a4a':'#c0392b'}">${fmt(bal)}</td>
      </tr></tbody></table>`;
  } else if (rptState.view === 'regular') {
    const allMap = {};
    txs.forEach(t => {
      const n = t.categories?.name||'Sem categoria', tp = t.amount<0?'Despesa':'Receita', k = n+'|'+tp;
      if (!allMap[k]) allMap[k] = {name:n,type:tp,color:t.categories?.color||'#888',total:0,count:0};
      allMap[k].total += (typeof txToBRL==="function"?Math.abs(txToBRL(t)):Math.abs(t.brl_amount??t.amount??0)); allMap[k].count++;
    });
    const rows = Object.values(allMap).sort((a,b)=>b.total-a.total);
    const grand = rows.reduce((s,e)=>s+e.total,0);
    bodyHtml = `<table style="width:100%;border-collapse:collapse;font-size:11px">
      <thead><tr style="background:#22553c;color:#fff">
        <th style="padding:7px 8px;text-align:left">Categoria</th>
        <th style="padding:7px 8px;text-align:center">Tipo</th>
        <th style="padding:7px 8px;text-align:center">Qtd</th>
        <th style="padding:7px 8px;text-align:right">Total</th>
        <th style="padding:7px 8px;text-align:right">%</th>
      </tr></thead><tbody>
      ${rows.map((v,i)=>`<tr style="background:${i%2?'#f8fcf9':'#fff'}">
        <td style="padding:5px 8px"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${v.color};margin-right:5px;vertical-align:middle"></span>${esc(v.name)}</td>
        <td style="padding:5px 8px;text-align:center;font-weight:700;color:${v.type==='Despesa'?'#c0392b':'#2a7a4a'}">${v.type}</td>
        <td style="padding:5px 8px;text-align:center">${v.count}</td>
        <td style="padding:5px 8px;text-align:right;font-weight:700;color:${v.type==='Despesa'?'#c0392b':'#2a7a4a'}">${fmt(v.total)}</td>
        <td style="padding:5px 8px;text-align:right;color:#888">${grand>0?(v.total/grand*100).toFixed(1):0}%</td>
      </tr>`).join('')}
      </tbody></table>`;
  } else if (rptState.view === 'forecast') {
    bodyHtml = document.getElementById('forecastAccountsContainer')?.innerHTML || '';
  }

  area.innerHTML = `
    <div style="font-family:Arial,sans-serif;max-width:960px;margin:0 auto;font-size:12px">
      <div style="background:#163a2a;color:#fff;padding:20px 24px;border-left:5px solid #2a7a4a">
        <div style="font-size:20px;font-weight:800">Family FinTrack — Relatório ${viewLabel}</div>
        <div style="font-size:11px;opacity:.8;margin-top:6px">
          Período: ${fmtDate(from)} até ${fmtDate(to)}
          &nbsp;·&nbsp; Filtros: ${_getActiveFiltersLabel()}
          &nbsp;·&nbsp; Gerado: ${new Date().toLocaleString('pt-BR')}
        </div>
      </div>
      <div style="background:#f0f7f2;padding:16px 24px">
        ${rptState.view !== 'forecast' ? kpiHtml : ''}
        ${chartsHtml}
        ${bodyHtml ? `<div style="margin-top:14px">${bodyHtml}</div>` : ''}
      </div>
    </div>`;
  area.style.display = 'block';
  window.print();
  setTimeout(() => { area.style.display = 'none'; area.innerHTML = ''; }, 1800);
}

/* ═══ EXPORT: CSV ═══ */
function exportReportCSV() {
  const txs = rptState.txData;
  if (!txs.length) { toast('Nenhum dado para exportar', 'error'); return; }
  const { from, to } = getRptDateRange();
  const BOM = '\uFEFF';
  const headers = ['Data','Descrição','Conta','Moeda','Categoria','Beneficiário','Tags','Valor','Tipo','Memo'];
  const rows = txs.map(t => [
    t.date,
    `"${(t.description||'').replace(/"/g,'""')}"`,
    `"${(t.accounts?.name||'').replace(/"/g,'""')}"`,
    t.accounts?.currency || 'BRL',
    `"${(t.categories?.name||'').replace(/"/g,'""')}"`,
    `"${(t.payees?.name||'').replace(/"/g,'""')}"`,
    `"${(t.tags||[]).join(', ').replace(/"/g,'""')}"`,
    String(t.amount).replace('.', ','),
    t.amount < 0 ? 'Despesa' : 'Receita',
    `"${(t.memo||'').replace(/"/g,'""')}"`,
  ]);
  const csv = BOM + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a'); a.href = url;
  a.download = `FinTrack_${from}_${to}.csv`; a.click();
  URL.revokeObjectURL(url);
  toast(`✓ CSV exportado — ${txs.length} transações`, 'success');
}

/* ═══ EMAIL POPUP ═══ */
function showEmailPopup() {
  const { from, to } = getRptDateRange();
  document.getElementById('emailSubject').value = `Relatório Family FinTrack — ${fmtDate(from)} a ${fmtDate(to)}`;
  document.getElementById('emailPopup').style.display = 'flex';
}
function closeEmailPopup() {
  document.getElementById('emailPopup').style.display = 'none';
}

/* ══════════════════════════════════════════════════════════════════
   _buildReportEmailHTML
   Gera HTML rico do relatório para envio via EmailJS em {{report_content}}.
   Compatível com Gmail, Outlook e iOS Mail (CSS inline, sem media queries).
   Usa o mesmo padrão de buildScheduledEmailReportContent em auto_register.js.
══════════════════════════════════════════════════════════════════ */
function _buildReportEmailHTML(txs, from, to, viewLabel, filters, pdfUrl) {
  const GREEN      = '#163a2a';
  const GREEN_LT   = '#2a7a4a';
  const GREEN_BG   = '#e8f5ee';
  const RED        = '#c0392b';
  const RED_BG     = '#fdf0ee';
  const MUTED      = '#6b7280';
  const BORDER     = '#e5e7eb';
  const BG         = '#f5f7fb';
  const WHITE      = '#ffffff';

  const totInc = txs.filter(t => t.amount > 0).reduce((s,t) => s + t.amount, 0);
  const totExp = txs.filter(t => t.amount < 0).reduce((s,t) => s + Math.abs(t.amount), 0);
  const bal    = totInc - totExp;
  const savingsRate = totInc > 0 ? ((totInc - totExp) / totInc * 100) : 0;

  const periodLabel = fmtDate(from) + ' a ' + fmtDate(to);
  const generatedAt = new Date().toLocaleString('pt-BR');
  const familyName  = currentUser?.name || currentUser?.email || 'Família';

  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function money(v) { return fmt(v); }

  // ── KPI row ──────────────────────────────────────────────────────
  const kpiHtml = `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:6px 0;margin:16px 0">
      <tr>
        ${[
          ['Receitas',  money(totInc), GREEN_LT, GREEN_BG],
          ['Despesas',  money(totExp), RED,      RED_BG],
          ['Saldo',     money(bal),    bal>=0?GREEN_LT:RED, bal>=0?GREEN_BG:RED_BG],
          ['Transações',String(txs.length), '#374151', '#f3f4f6'],
        ].map(([lbl,val,color,bg]) => `
          <td width="25%" style="padding:0">
            <div style="background:${bg};border-radius:8px;padding:10px 8px;border-top:3px solid ${color};text-align:center">
              <div style="font-size:10px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">${lbl}</div>
              <div style="font-size:14px;font-weight:800;color:${color};white-space:nowrap">${val}</div>
            </div>
          </td>`).join('')}
      </tr>
    </table>`;

  // ── Health bar (savings rate indicator) ──────────────────────────
  const srColor = savingsRate >= 20 ? GREEN_LT : savingsRate >= 5 ? '#b45309' : RED;
  const srLabel = savingsRate >= 20 ? 'Saudável 💚' : savingsRate >= 5 ? 'Atenção 🟡' : 'Crítico 🔴';
  const healthHtml = totInc > 0 ? `
    <div style="background:#f8fafc;border:1px solid ${BORDER};border-radius:8px;padding:10px 14px;margin-bottom:14px;display:flex;align-items:center;gap:12px">
      <div style="flex:1">
        <div style="font-size:11px;font-weight:700;color:${srColor}">Taxa de poupança: ${savingsRate.toFixed(1)}% — ${srLabel}</div>
        <div style="background:#e5e7eb;border-radius:4px;height:5px;margin-top:5px;overflow:hidden">
          <div style="background:${srColor};height:5px;width:${Math.min(savingsRate,100).toFixed(0)}%;border-radius:4px"></div>
        </div>
      </div>
      <div style="font-size:11px;color:${MUTED};white-space:nowrap">${(totExp/totInc*100).toFixed(0)}% gasto</div>
    </div>` : '';

  // ── Category breakdown (top 8) ───────────────────────────────────
  const catMap = {};
  txs.filter(t => t.amount < 0).forEach(t => {
    const k = t.categories?.name || 'Sem categoria';
    if (!catMap[k]) catMap[k] = { total: 0, count: 0, color: t.categories?.color || '#888' };
    catMap[k].total += (typeof txToBRL==="function"?Math.abs(txToBRL(t)):Math.abs(t.brl_amount??t.amount??0));
    catMap[k].count++;
  });
  const catRows = Object.entries(catMap).sort((a,b) => b[1].total - a[1].total).slice(0, 8);
  const catGrand = catRows.reduce((s,[,v]) => s + v.total, 0);

  const catHtml = catRows.length ? `
    <div style="margin-bottom:16px">
      <div style="font-size:12px;font-weight:700;color:${GREEN};text-transform:uppercase;letter-spacing:.06em;
                  border-bottom:2px solid ${GREEN_BG};padding-bottom:5px;margin-bottom:8px">
        Despesas por Categoria
      </div>
      ${catRows.map(([name, v]) => {
        const pct = catGrand > 0 ? (v.total / catGrand * 100) : 0;
        return `
        <div style="margin-bottom:5px">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px">
            <span style="font-size:12px;color:#374151">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${esc(v.color)};margin-right:5px;vertical-align:middle"></span>
              ${esc(name)}
              <span style="font-size:10px;color:${MUTED}"> (${v.count}x)</span>
            </span>
            <span style="font-size:12px;font-weight:700;color:${RED}">${money(v.total)}</span>
          </div>
          <div style="background:#e5e7eb;border-radius:3px;height:4px;overflow:hidden">
            <div style="background:${esc(v.color)};height:4px;width:${pct.toFixed(0)}%;border-radius:3px"></div>
          </div>
        </div>`;
      }).join('')}
    </div>` : '';

  // ── Top payees (top 5) ────────────────────────────────────────────
  const payMap = {};
  txs.filter(t => t.amount < 0).forEach(t => {
    const k = t.payees?.name || t.description || 'Sem beneficiário';
    if (!payMap[k]) payMap[k] = { total: 0, count: 0 };
    payMap[k].total += (typeof txToBRL==="function"?Math.abs(txToBRL(t)):Math.abs(t.brl_amount??t.amount??0));
    payMap[k].count++;
  });
  const payRows = Object.entries(payMap).sort((a,b) => b[1].total - a[1].total).slice(0, 5);
  const payHtml = payRows.length ? `
    <div style="margin-bottom:16px">
      <div style="font-size:12px;font-weight:700;color:${GREEN};text-transform:uppercase;letter-spacing:.06em;
                  border-bottom:2px solid ${GREEN_BG};padding-bottom:5px;margin-bottom:8px">
        Top Beneficiários
      </div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px">
        ${payRows.map(([name,v],i) => `
          <tr style="background:${i%2===0?WHITE:'#f8fafc'}">
            <td style="padding:5px 8px;color:#374151">${esc(name)}</td>
            <td style="padding:5px 8px;text-align:center;color:${MUTED};font-size:11px">${v.count}x</td>
            <td style="padding:5px 8px;text-align:right;font-weight:700;color:${RED}">${money(v.total)}</td>
          </tr>`).join('')}
      </table>
    </div>` : '';

  // ── Last 10 transactions ─────────────────────────────────────────
  const recentTxs = [...txs].sort((a,b) => b.date < a.date ? -1 : 1).slice(0, 10);
  const txHtml = recentTxs.length ? `
    <div style="margin-bottom:16px">
      <div style="font-size:12px;font-weight:700;color:${GREEN};text-transform:uppercase;letter-spacing:.06em;
                  border-bottom:2px solid ${GREEN_BG};padding-bottom:5px;margin-bottom:8px">
        Últimas Transações
      </div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:11px">
        <tr style="background:${GREEN};color:${WHITE}">
          <th style="padding:5px 8px;text-align:left;font-weight:600">Data</th>
          <th style="padding:5px 8px;text-align:left;font-weight:600">Descrição</th>
          <th style="padding:5px 8px;text-align:left;font-weight:600">Categoria</th>
          <th style="padding:5px 8px;text-align:right;font-weight:600">Valor</th>
        </tr>
        ${recentTxs.map((t,i) => `
          <tr style="background:${i%2===0?WHITE:'#f8fafc'}">
            <td style="padding:5px 8px;color:${MUTED};white-space:nowrap">${fmtDate(t.date)}</td>
            <td style="padding:5px 8px;color:#374151;max-width:160px;overflow:hidden;text-overflow:ellipsis">${esc(t.description||'—')}</td>
            <td style="padding:5px 8px;color:${MUTED}">${esc(t.categories?.name||'—')}</td>
            <td style="padding:5px 8px;text-align:right;font-weight:700;color:${t.amount>=0?GREEN_LT:RED}">${money(t.amount)}</td>
          </tr>`).join('')}
      </table>
      ${txs.length > 10 ? `<div style="text-align:center;padding:6px;font-size:11px;color:${MUTED}">+ ${txs.length-10} transações no PDF completo</div>` : ''}
    </div>` : '';

  // ── PDF link button ───────────────────────────────────────────────
  const pdfBtnHtml = pdfUrl ? `
    <div style="text-align:center;margin:20px 0 8px">
      <a href="${esc(pdfUrl)}"
         style="display:inline-block;background:${GREEN};color:${WHITE};text-decoration:none;
                font-weight:700;font-size:13px;padding:12px 28px;border-radius:8px;
                letter-spacing:.02em">
        📄 Baixar Relatório PDF Completo
      </a>
      <div style="font-size:10px;color:${MUTED};margin-top:6px">
        Arquivo: ${esc(pdfUrl.split('/').pop()?.split('?')[0] || 'relatório.pdf')}
      </div>
    </div>` : '';

  // ── Assemble ─────────────────────────────────────────────────────
  return `
<div style="font-family:Arial,Helvetica,sans-serif;background:${BG};padding:16px;margin:0">
  <div style="max-width:560px;margin:0 auto">

    <!-- Header -->
    <div style="background:${GREEN};border-radius:12px 12px 0 0;padding:20px 24px;border-left:5px solid ${GREEN_LT}">
      <div style="font-size:18px;font-weight:800;color:${WHITE};margin-bottom:4px">
        Relatório Financeiro — ${esc(viewLabel)}
      </div>
      <div style="font-size:11px;color:#a7d4be;line-height:1.6">
        📅 ${esc(periodLabel)} &nbsp;·&nbsp; 👤 ${esc(familyName)}<br>
        ${filters !== 'Todos os dados' ? `🔍 ${esc(filters)} &nbsp;·&nbsp; ` : ''}
        🕐 Gerado em ${esc(generatedAt)}
      </div>
    </div>

    <!-- Body -->
    <div style="background:${WHITE};border:1px solid ${BORDER};border-top:none;border-radius:0 0 12px 12px;padding:20px 24px">
      ${kpiHtml}
      ${healthHtml}
      ${catHtml}
      ${payHtml}
      ${txHtml}
      ${pdfBtnHtml}
    </div>

    <!-- Footer -->
    <div style="text-align:center;padding:12px;font-size:10px;color:${MUTED}">
      Family FinTrack &nbsp;·&nbsp; Relatório Confidencial &nbsp;·&nbsp; ${esc(generatedAt)}
    </div>

  </div>
</div>`;
}

async function sendReportByEmail() {
  const emailToEl = document.getElementById('emailTo');
  const toAddr    = (emailToEl.value || '').trim();
  if (!toAddr) { toast('Informe o destinatário', 'error'); emailToEl.focus(); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toAddr)) {
    toast('Endereço de e-mail inválido', 'error'); emailToEl.focus(); return;
  }
  if (!EMAILJS_CONFIG.serviceId || !EMAILJS_CONFIG.templateId || !EMAILJS_CONFIG.publicKey) {
    toast('Configure o EmailJS primeiro (botão ⚙️)', 'error'); showEmailConfig(); return;
  }

  const btn    = document.getElementById('emailSendBtn');
  const status = document.getElementById('emailStatus');
  btn.disabled = true; btn.textContent = '⏳ Gerando PDF...'; status.textContent = '';

  try {
    const { doc, from, to } = await _buildReportPDF();
    const txs    = rptState.txData;
    const totExp = txs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
    const totInc = txs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const bal    = totInc - totExp;

    btn.textContent = '⏳ Salvando PDF...';
    const pdfBytes    = doc.output('arraybuffer');
    const pdfBlob     = new Blob([pdfBytes], { type: 'application/pdf' });
    const fileName    = `FinTrack_${from}_${to}_${rptState.view}_${Date.now()}.pdf`;
    const storagePath = `reports/${fileName}`;

    const { error: upErr } = await sb.storage
      .from('fintrack-attachments')
      .upload(storagePath, pdfBlob, { upsert: true, contentType: 'application/pdf' });
    if (upErr) throw new Error('Erro no upload: ' + upErr.message);

    const { data: urlData } = sb.storage.from('fintrack-attachments').getPublicUrl(storagePath);
    const pdfUrl = urlData.publicUrl;

    btn.textContent = '⏳ Enviando e-mail...';
    emailjs.init(EMAILJS_CONFIG.publicKey);

    const subject     = document.getElementById('emailSubject').value.trim()
      || `Relatório FinTrack — ${fmtDate(from)} a ${fmtDate(to)}`;
    const userMessage = document.getElementById('emailMsg').value.trim()
      || `Segue o relatório financeiro do período de ${fmtDate(from)} a ${fmtDate(to)}.`;
    const viewLabel   = { regular:'Análise por Categoria', transactions:'Lista de Transações', forecast:'Previsão' }[rptState.view] || '';
    const filters     = _getActiveFiltersLabel();

    // Build rich HTML report body — sent as {{report_content}} which is what the
    // shared EmailJS template uses in its Body (same as auto_register.js does).
    // {{message}} remains as plain-text fallback for simpler template configurations.
    const reportHtml = _buildReportEmailHTML(txs, from, to, viewLabel, filters, pdfUrl);

    // Build standardised subject
    const reportSubject = `[Family FinTrack] Relatório ${viewLabel} — ${fmtDate(from)} a ${fmtDate(to)}`;
    const templateParams = {
      to_email: toAddr, to: toAddr, email: toAddr, recipient: toAddr,
      dest_email: toAddr, reply_to: toAddr,
      from_name:      'Family FinTrack',
      report_subject: reportSubject,
      subject:        reportSubject,
      // Plain-text fallback (used by other template functions)
      message:        userMessage || `Relatório ${viewLabel} — ${fmtDate(from)} a ${fmtDate(to)}`,
      // Rich HTML body — {{report_content}} in the EmailJS template Body
      report_content: reportHtml,
      report_period:  `${fmtDate(from)} a ${fmtDate(to)}`,
      report_view:    viewLabel,
      report_filters: filters,
      report_income:  fmt(totInc),
      report_expense: fmt(totExp),
      report_balance: fmt(bal),
      report_count:   String(txs.length),
      pdf_url:        pdfUrl,
      pdf_name:       fileName,
    };

    try {
      await emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, templateParams);
    } catch (ejErr) {
      const errText = ejErr?.text || ejErr?.message || JSON.stringify(ejErr);
      if (/recipients|address|to email/i.test(errText)) {
        throw new Error(
          `O campo "To Email" do template EmailJS precisa ser configurado como {{to_email}}.\n\n` +
          `Acesse: emailjs.com → Email Templates → seu template → campo "To Email" → defina: {{to_email}}\n\nErro: ${errText}`
        );
      }
      throw new Error(errText);
    }

    status.textContent = '✓ Enviado!'; status.style.color = 'var(--green)';
    toast('✓ E-mail enviado com sucesso!', 'success');
    setTimeout(closeEmailPopup, 1800);

  } catch (e) {
    console.error('[Email]', e);
    const msg = e.message || e.text || 'Erro desconhecido';
    status.textContent = '✗ Erro'; status.style.color = 'var(--red)';
    toast(msg.split('\n')[0], 'error');
    if (msg.includes('To Email') || msg.includes('{{to_email}}')) {
      let helperEl = document.getElementById('emailConfigHelper');
      if (!helperEl) {
        helperEl = document.createElement('div');
        helperEl.id = 'emailConfigHelper';
        helperEl.style.cssText = 'background:var(--amber-lt);border:1px solid var(--amber);border-radius:6px;padding:10px;font-size:.78rem;color:var(--text2);margin-top:8px;line-height:1.5';
        document.querySelector('.email-popup-box')?.appendChild(helperEl);
      }
      helperEl.innerHTML = `⚠️ <strong>Configuração necessária no EmailJS:</strong><br>
        Acesse <a href="https://dashboard.emailjs.com/admin/templates" target="_blank" style="color:var(--accent)">emailjs.com → Email Templates</a>,
        abra seu template e no campo <strong>"To Email"</strong> defina: <code style="background:var(--bg2);padding:1px 4px;border-radius:3px">{{to_email}}</code>`;
    }
  } finally {
    btn.disabled = false; btn.textContent = 'Enviar PDF';
  }
}

function renderChart(id, type, labels, datasets, extraOptions={}) {
  if(state.chartInstances[id]) state.chartInstances[id].destroy();
  const ctx = document.getElementById(id)?.getContext('2d');
  if(!ctx) return;

  const isDoughnut = type === 'doughnut' || type === 'pie';
  const isBar = type === 'bar';

  state.chartInstances[id] = new Chart(ctx, {
    type,
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      animation: { duration: 400 },
      plugins: {
        legend: {
          display: true,
          position: isDoughnut ? 'bottom' : 'top',
          align: 'center',
          onClick(e, legendItem, legend) {
            // Toggle visibility on click
            const chart = legend.chart;
            const idx = legendItem.index;
            const dsIdx = legendItem.datasetIndex;
            if(isDoughnut) {
              // For doughnut: toggle individual arc
              const meta = chart.getDatasetMeta(0);
              const arc = meta.data[idx];
              arc.hidden = !arc.hidden;
              // Strike through label
              legendItem.hidden = arc.hidden;
            } else {
              // For bar/line: toggle whole dataset
              const meta = chart.getDatasetMeta(dsIdx);
              meta.hidden = meta.hidden === null ? true : !meta.hidden;
              legendItem.hidden = meta.hidden;
            }
            chart.update();
          },
          labels: {
            color: '#3d3830',
            font: { family: 'Outfit', size: 11.5, weight: '500' },
            padding: 16,
            boxWidth: isDoughnut ? 12 : 14,
            boxHeight: isDoughnut ? 12 : 14,
            borderRadius: isDoughnut ? 6 : 3,
            usePointStyle: !isDoughnut,
            pointStyle: isBar ? 'rect' : 'circle',
            generateLabels(chart) {
              if(isDoughnut) {
                const ds = chart.data.datasets[0];
                const meta = chart.getDatasetMeta(0);
                return chart.data.labels.map((label, i) => {
                  const arc = meta.data[i];
                  const total = ds.data.reduce((s,v)=>s+(v||0),0);
                  const pct = total > 0 ? ((ds.data[i]||0)/total*100).toFixed(1)+'%' : '';
                  return {
                    text: `${label}  ${pct}`,
                    fillStyle: Array.isArray(ds.backgroundColor) ? ds.backgroundColor[i] : ds.backgroundColor,
                    strokeStyle: '#fff',
                    lineWidth: 2,
                    hidden: arc ? arc.hidden : false,
                    index: i,
                    datasetIndex: 0,
                  };
                });
              }
              // Bar/line default
              return Chart.defaults.plugins.legend.labels.generateLabels(chart);
            }
          }
        },
        tooltip: {
          backgroundColor: '#fff',
          titleColor: '#1a1714',
          bodyColor: '#3d3830',
          borderColor: '#e8e4de',
          borderWidth: 1,
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            label(ctx) {
              const val = fmt(ctx.raw);
              if(isDoughnut) {
                const total = ctx.dataset.data.reduce((s,v)=>s+(v||0),0);
                const pct = total > 0 ? (ctx.raw/total*100).toFixed(1)+'%' : '';
                return `  ${ctx.label}: ${val} (${pct})`;
              }
              return `  ${ctx.dataset.label}: ${val}`;
            }
          }
        }
      },
      scales: isBar ? {
        x: { ticks:{color:'#8c8278',font:{size:10.5}}, grid:{color:'#f0ede811'}, border:{color:'#e8e4de'} },
        y: { ticks:{color:'#8c8278',font:{size:10.5},callback:v=>fmt(v)}, grid:{color:'#f0ede8'}, border:{color:'#e8e4de'} }
      } : undefined,
      ...extraOptions,
    }
  });
  return state.chartInstances[id];
}

function populateSelects(){populateReportFilters();
  const aOpts=state.accounts.map(a=>`<option value="${a.id}">${esc(a.name)} (${a.currency})</option>`).join('');
  ['txAccountId','txTransferTo'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML='<option value="">Selecione a conta</option>'+aOpts;});
  const txAF=document.getElementById('txAccount');if(txAF)txAF.innerHTML='<option value="">Todas as contas</option>'+aOpts;
  // payee autocomplete uses state.payees directly - no select to populate
  buildCatPicker(); // hierarchical picker replaces flat select
  const pCat=document.getElementById('payeeCategory');if(pCat)pCat.innerHTML='<option value="">— Nenhuma —</option>'+state.categories.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
}

function openModal(id){document.getElementById(id).classList.add('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');}
document.querySelectorAll('.modal-overlay').forEach(el=>{el.addEventListener('click',e=>{if(e.target===el)el.classList.remove('open');});});

function toast(msg,type='info'){
  const icons={success:'✓',error:'✕',info:'i'};
  const el=document.createElement('div');el.className=`toast ${type}`;el.innerHTML=`<span style="font-weight:700">${icons[type]||'i'}</span><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(()=>{el.style.opacity='0';el.style.transform='translateX(16px)';el.style.transition='.2s';setTimeout(()=>el.remove(),200);},3200);
}

function fmt(v,currency='BRL'){if(state.privacyMode)return'••••••';return new Intl.NumberFormat('pt-BR',{style:'currency',currency:currency||'BRL',minimumFractionDigits:2}).format(v||0);}
// Parse a user-typed amount string: handles both "1.234,56" (BR) and "1,234.56" (EN) and negatives
function parseAmtInput(s) {
  if (!s && s !== 0) return 0;
  const str = String(s).trim();
  if (!str) return 0;
  const neg = str.startsWith('-');
  let clean = str.replace(/^-/, '');
  // Detect BR format: ends with ,XX (comma as decimal separator)
  if (/,\d{1,2}$/.test(clean)) {
    clean = clean.replace(/\./g, '').replace(',', '.');
  } else {
    // EN format or plain integer: remove commas
    clean = clean.replace(/,/g, '');
  }
  const v = parseFloat(clean);
  if (isNaN(v)) return 0;
  return neg ? -Math.abs(v) : v;
}

// Sign toggle button state: fieldId → true means negative
const _amtSignState = {};

function toggleAmtSign(fieldId) {
  _amtSignState[fieldId] = !_amtSignState[fieldId];
  _updateSignBtn(fieldId);
}

function _updateSignBtn(fieldId) {
  const btn = document.getElementById(fieldId + 'SignBtn');
  if (!btn) return;
  const isNeg = !!_amtSignState[fieldId];
  btn.textContent = isNeg ? '−' : '+';
  btn.classList.toggle('negative', isNeg);
  btn.classList.toggle('positive', !isNeg);
}

// Set amount field value and sign btn state from a numeric value (e.g. when editing)
function setAmtField(fieldId, value) {
  const isNeg = (value < 0);
  _amtSignState[fieldId] = isNeg;
  const el = document.getElementById(fieldId);
  if (el) el.value = value !== 0 ? Math.abs(value).toFixed(2).replace('.', ',') : '';
  _updateSignBtn(fieldId);
}

// Read the signed value from an amount field
function getAmtField(fieldId) {
  const el = document.getElementById(fieldId);
  if (!el) return 0;
  const raw = el.value.trim();
  if (!raw) return 0;
  // Parse the absolute value
  let clean = raw.replace(/\./g, '').replace(',', '.'); // handle BR format
  if (!/[.,]/.test(raw)) clean = raw; // plain integer
  const abs = Math.abs(parseFloat(clean) || 0);
  return _amtSignState[fieldId] ? -abs : abs;
}

// ─────────────────────────────────────────────────────────────
// Amount inputs: auto-decimals (centavos) mask
// Goal: user never needs to type comma/decimal separator.
// Examples while typing digits:
//   "1"   → "0,01"
//   "12"  → "0,12"
//   "123" → "1,23"
// Works well on mobile numeric keypad.
//
// Notes:
// - We keep the sign separated via the existing +/- button state.
// - We always format in pt-BR with comma decimal separator.
// - We intentionally keep caret at end (simple + robust).
// ─────────────────────────────────────────────────────────────

function _formatCentsBRFromDigits(digits) {
  const d = String(digits || '').replace(/\D/g, '');
  if (!d) return '';
  const n = parseInt(d, 10);
  if (!isFinite(n)) return '';
  const v = (n / 100);
  return v.toFixed(2).replace('.', ',');
}

function bindAmtAutoDecimals(fieldId) {
  const el = document.getElementById(fieldId);
  if (!el) return;
  if (el.dataset && el.dataset.amtAutoDecimals === '1') return; // avoid double binding
  if (el.dataset) el.dataset.amtAutoDecimals = '1';

  const applyMask = () => {
    const raw = (el.value || '').toString();
    const digits = raw.replace(/\D/g, '');
    const masked = _formatCentsBRFromDigits(digits);
    el.value = masked;
    try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) {}
  };

  el.addEventListener('input', () => {
    if (!el.value) return;
    applyMask();
  });

  el.addEventListener('blur', () => {
    if (!el.value) return;
    applyMask();
  });

  el.addEventListener('paste', () => {
    setTimeout(() => {
      if (!el.value) return;
      applyMask();
    }, 0);
  });
}

function bindAllAmtAutoDecimals(fieldIds) {
  const ids = Array.isArray(fieldIds)
    ? fieldIds
    : ['txAmount','accountBalance','budgetAmount','scAmount','occAmount'];
  ids.forEach(id => { try { bindAmtAutoDecimals(id); } catch(e) {} });
}
function fmtDate(d){if(!d)return'—';const[y,m,day]=d.split('T')[0].split('-');return`${day}/${m}/${y}`;}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}


/* ═══════════════════════════════════════
   PAYEE AUTOCOMPLETE
═══════════════════════════════════════ */
