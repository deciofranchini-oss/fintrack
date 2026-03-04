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
}

function loadCurrentReport() {
  if(rptState.view==='regular')      loadReports();
  else if(rptState.view==='transactions') loadReportTx();
  else if(rptState.view==='forecast')     loadForecast();
}

/* ── Fetch filtered transactions ── */
async function fetchRptTransactions() {
  const {from, to} = getRptDateRange();
  const accId  = document.getElementById('rptAccount')?.value   || '';
  const typeV  = document.getElementById('rptType')?.value      || '';
  const catId  = document.getElementById('rptCategory')?.value  || '';
  const payId  = document.getElementById('rptPayee')?.value     || '';

  let q = sb.from('transactions')
    .select('*, accounts!transactions_account_id_fkey(name,color,currency), categories(name,color,type), payees(name)')
    .gte('date',from).lte('date',to)
    .order('date',{ascending:false});
  if(accId) q = q.eq('account_id', accId);
  if(catId) q = q.eq('category_id', catId);
  if(payId) q = q.eq('payee_id', payId);
  if(typeV==='expense') q = q.lt('amount',0);
  if(typeV==='income')  q = q.gt('amount',0);

  const {data, error} = await q;
  if(error) { toast(error.message,'error'); return []; }
  return (data||[]).filter(t=>!t.is_transfer);
}

/* ═══ VIEW: ANÁLISE ═══ */
async function loadReports() {
  const {from, to} = getRptDateRange();
  const txs  = await fetchRptTransactions();
  rptState.txData = txs;

  const exps = txs.filter(t=>t.amount<0);
  const incs = txs.filter(t=>t.amount>0);
  const totExp = exps.reduce((s,t)=>s+Math.abs(t.amount),0);
  const totInc = incs.reduce((s,t)=>s+t.amount,0);
  const bal    = totInc - totExp;

  /* KPIs */
  document.getElementById('reportKpis').innerHTML = `
    <div class="report-kpi"><div class="report-kpi-label">Receitas</div><div class="report-kpi-value text-green">${fmt(totInc)}</div></div>
    <div class="report-kpi"><div class="report-kpi-label">Despesas</div><div class="report-kpi-value text-red">${fmt(totExp)}</div></div>
    <div class="report-kpi"><div class="report-kpi-label">Saldo</div><div class="report-kpi-value ${bal>=0?'text-green':'text-red'}">${fmt(bal)}</div></div>
    <div class="report-kpi"><div class="report-kpi-label">Nº Transações</div><div class="report-kpi-value">${txs.length}</div></div>
    <div class="report-kpi"><div class="report-kpi-label">Ticket médio</div><div class="report-kpi-value">${exps.length?fmt(totExp/exps.length):'—'}</div></div>
  `;
  document.getElementById('reportDataInfo').textContent =
    `${fmtDate(from)} → ${fmtDate(to)}  ·  ${txs.length} transações`;

  const FB = ['#2a6049','#1e5ba8','#b45309','#c0392b','#7c3aed','#2a7a4a','#d97706','#6b7280','#3d7a5e','#4e8f73'];

  /* Despesas por categoria */
  const expMap = {};
  exps.forEach(t=>{
    const n=t.categories?.name||'Sem categoria', c=t.categories?.color||'#94a3b8';
    if(!expMap[n]) expMap[n]={total:0,color:c,count:0};
    expMap[n].total+=Math.abs(t.amount); expMap[n].count++;
  });
  const expEntries = Object.entries(expMap).sort((a,b)=>b[1].total-a[1].total);
  if(expEntries.length)
    renderChart('reportCatChart','doughnut',expEntries.map(e=>e[0]),
      [{data:expEntries.map(e=>e[1].total),
        backgroundColor:expEntries.map((e,i)=>e[1].color||FB[i%FB.length]),
        borderWidth:2,borderColor:'#fff',hoverOffset:8}]);

  /* Receitas por categoria */
  const incMap = {};
  incs.forEach(t=>{
    const n=t.categories?.name||'Sem categoria', c=t.categories?.color||'#2a7a4a';
    if(!incMap[n]) incMap[n]={total:0,color:c,count:0};
    incMap[n].total+=t.amount; incMap[n].count++;
  });
  const incEntries = Object.entries(incMap).sort((a,b)=>b[1].total-a[1].total);
  if(incEntries.length)
    renderChart('reportIncomeChart','doughnut',incEntries.map(e=>e[0]),
      [{data:incEntries.map(e=>e[1].total),
        backgroundColor:incEntries.map((e,i)=>e[1].color||FB[i%FB.length]),
        borderWidth:2,borderColor:'#fff',hoverOffset:8}]);

  /* Por conta */
  const accMap = {};
  txs.forEach(t=>{
    const n=t.accounts?.name||'—', c=t.accounts?.color||'#94a3b8';
    if(!accMap[n]) accMap[n]={exp:0,inc:0,color:c};
    if(t.amount<0) accMap[n].exp+=Math.abs(t.amount); else accMap[n].inc+=t.amount;
  });
  const accE = Object.entries(accMap).sort((a,b)=>(b[1].exp+b[1].inc)-(a[1].exp+a[1].inc));
  if(accE.length)
    renderChart('reportAccountChart','bar',accE.map(e=>e[0]),[
      {label:'Despesas',data:accE.map(e=>+e[1].exp.toFixed(2)),backgroundColor:'rgba(192,57,43,.8)',borderRadius:5,borderSkipped:false},
      {label:'Receitas',data:accE.map(e=>+e[1].inc.toFixed(2)),backgroundColor:'rgba(42,122,74,.8)',borderRadius:5,borderSkipped:false},
    ]);

  /* Evolução */
  await renderTrendChart(from, to);

  /* Tabela de categorias */
  const allMap = {};
  txs.forEach(t=>{
    const n=t.categories?.name||'Sem categoria', c=t.categories?.color||'#94a3b8';
    const tp=t.amount<0?'Despesa':'Receita';
    const k=n+'|'+tp;
    if(!allMap[k]) allMap[k]={name:n,color:c,type:tp,total:0,count:0};
    allMap[k].total+=Math.abs(t.amount); allMap[k].count++;
  });
  const allE = Object.values(allMap).sort((a,b)=>b.total-a.total);
  const grand = allE.reduce((s,e)=>s+e.total,0);
  document.getElementById('reportCatBody').innerHTML = allE.length
    ? allE.map(v=>`<tr>
        <td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${v.color};margin-right:6px;flex-shrink:0"></span>${esc(v.name)}</td>
        <td><span class="badge ${v.type==='Despesa'?'badge-red':'badge-green'}" style="font-size:.7rem">${v.type}</span></td>
        <td class="text-muted">${v.count}</td>
        <td class="${v.type==='Despesa'?'amount-neg':'amount-pos'}">${v.type==='Despesa'?'-':''}${fmt(v.total)}</td>
        <td><div style="display:flex;align-items:center;gap:6px">
          <div style="flex:1;min-width:50px;background:var(--bg2);border-radius:100px;height:5px">
            <div style="width:${grand>0?(v.total/grand*100).toFixed(1):0}%;height:100%;background:${v.color};border-radius:100px"></div>
          </div>
          <span style="font-size:.72rem;color:var(--muted);width:38px;text-align:right">${grand>0?(v.total/grand*100).toFixed(1):0}%</span>
        </div></td>
      </tr>`).join('')
    : '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:28px">Nenhuma transação no período</td></tr>';
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
      if(t.amount<0) wkMap[w].exp+=Math.abs(t.amount); else wkMap[w].inc+=t.amount;
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
    if(t.amount<0) m.exp+=Math.abs(t.amount); else m.inc+=t.amount;
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
  const totExp=txs.filter(t=>t.amount<0).reduce((s,t)=>s+Math.abs(t.amount),0);
  const totInc=txs.filter(t=>t.amount>0).reduce((s,t)=>s+t.amount,0);
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
  const total=txs.reduce((s,t)=>s+t.amount,0);
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

/* ═══ EXPORT: PDF ═══ */
async function exportReportPDF() {
  const btn = event.target;
  const origText = btn.textContent;
  btn.textContent='⏳ Gerando...'; btn.disabled=true;
  try {
    const {jsPDF}=window.jspdf;
    const {from,to}=getRptDateRange();
    const doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
    const W=doc.internal.pageSize.getWidth();
    const ACCENT=[42,96,73];

    // Header — green banner with white text
    doc.setFillColor(42,96,73); doc.rect(0,0,W,30,'F');
    doc.setTextColor(255,255,255);
    doc.setFontSize(15); doc.setFont('helvetica','bold');
    doc.text("J.F. Family FinTrack — Relatório", 14, 12);
    doc.setFontSize(9); doc.setFont('helvetica','normal');
    doc.text('Período: ' + fmtDate(from) + ' a ' + fmtDate(to), 14, 21);
    doc.text('Gerado: ' + new Date().toLocaleString('pt-BR'), W-14, 21, {align:'right'});
    doc.setTextColor(30,30,30); doc.setFillColor(255,255,255);

    doc.setFillColor(255,255,255); // reset fill after header
    let y=38;

    // KPIs
    const txs=rptState.txData;
    const totExp=txs.filter(t=>t.amount<0).reduce((s,t)=>s+Math.abs(t.amount),0);
    const totInc=txs.filter(t=>t.amount>0).reduce((s,t)=>s+t.amount,0);
    const bal=totInc-totExp;
    const kpis=[
      ['Receitas',fmt(totInc),[42,122,74]],
      ['Despesas',fmt(totExp),[192,57,43]],
      ['Saldo',fmt(bal),bal>=0?[42,122,74]:[192,57,43]],
      ['Transações',String(txs.length),[42,96,73]],
    ];
    const kw=(W-28)/kpis.length;
    kpis.forEach(([label,val,col],i)=>{
      const x=14+i*kw;
      doc.setFillColor(240,248,244); doc.roundedRect(x,y,kw-3,18,2,2,'F');
      doc.setDrawColor(...col); doc.roundedRect(x,y,kw-3,18,2,2,'S');
      doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(100,100,100);
      doc.text(label, x+4, y+6);
      doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(...col);
      doc.text(val, x+4, y+14);
    });
    y+=26; doc.setTextColor(30,30,30);

    // Category table
    if(rptState.view==='regular' || rptState.view==='transactions') {
      doc.setFontSize(11); doc.setFont('helvetica','bold');
      doc.text(rptState.view==='transactions'?'Transações':'Detalhamento por Categoria', 14, y);
      y+=4;

      if(rptState.view==='transactions') {
        const rows=txs.map(t=>[fmtDate(t.date),t.description||'',t.accounts?.name||'',t.categories?.name||'',t.payees?.name||'',fmt(t.amount)]);
        doc.autoTable({startY:y,head:[['Data','Descrição','Conta','Categoria','Beneficiário','Valor']],body:rows,
          styles:{fontSize:8,cellPadding:3},headStyles:{fillColor:[42,96,73],textColor:[255,255,255]},
          columnStyles:{5:{halign:'right'}},margin:{left:14,right:14},
          didParseCell(data){if(data.column.index===5&&data.section==='body'){const v=txs[data.row.index]?.amount;if(v<0)data.cell.styles.textColor=[192,57,43];else data.cell.styles.textColor=[42,122,74];}}
        });
      } else {
        const allMap={};
        txs.forEach(t=>{const n=t.categories?.name||'Sem categoria',tp=t.amount<0?'Despesa':'Receita',k=n+'|'+tp;
          if(!allMap[k]) allMap[k]={name:n,type:tp,total:0,count:0};
          allMap[k].total+=Math.abs(t.amount);allMap[k].count++;});
        const allE=Object.values(allMap).sort((a,b)=>b.total-a.total);
        const grand=allE.reduce((s,e)=>s+e.total,0);
        const rows=allE.map(v=>[v.name,v.type,String(v.count),fmt(v.total),grand>0?(v.total/grand*100).toFixed(1)+'%':'0%']);
        doc.autoTable({startY:y,head:[['Categoria','Tipo','Qtd','Total','%']],body:rows,
          styles:{fontSize:8,cellPadding:3},headStyles:{fillColor:[42,96,73],textColor:[255,255,255]},
          columnStyles:{3:{halign:'right'},4:{halign:'right'}},margin:{left:14,right:14}});
      }
    }

    // Footer
    const pages=doc.internal.getNumberOfPages();
    for(let i=1;i<=pages;i++){
      doc.setPage(i);doc.setFontSize(8);doc.setTextColor(150);
      doc.text(`JF Family FinTrack  ·  Página ${i}/${pages}`,W/2,doc.internal.pageSize.getHeight()-8,{align:'center'});
    }

    doc.save(`FinTrack_${from}_${to}.pdf`);
    toast('PDF gerado e baixado!','success');
  } catch(e){ toast('Erro ao gerar PDF: '+e.message,'error'); console.error(e); }
  finally{ btn.textContent=origText; btn.disabled=false; }
}

/* ═══ EXPORT: PRINT ═══ */
function printReport() {
  const area = document.getElementById('printArea');
  const {from,to} = getRptDateRange();
  const txs = rptState.txData;
  const totExp=txs.filter(t=>t.amount<0).reduce((s,t)=>s+Math.abs(t.amount),0);
  const totInc=txs.filter(t=>t.amount>0).reduce((s,t)=>s+t.amount,0);
  const bal=totInc-totExp;

  let body='';
  if(rptState.view==='transactions') {
    body=`<table style="width:100%;border-collapse:collapse;font-size:11px">
      <thead><tr style="background:#2a6049;color:#fff">
        <th style="padding:8px;text-align:left">Data</th><th style="padding:8px;text-align:left">Descrição</th>
        <th style="padding:8px;text-align:left">Conta</th><th style="padding:8px;text-align:left">Categoria</th>
        <th style="padding:8px;text-align:left">Beneficiário</th><th style="padding:8px;text-align:right">Valor</th>
      </tr></thead><tbody>
      ${txs.map((t,i)=>`<tr style="background:${i%2?'#f9f9f9':'#fff'}">
        <td style="padding:6px 8px">${fmtDate(t.date)}</td>
        <td style="padding:6px 8px">${esc(t.description||'—')}</td>
        <td style="padding:6px 8px">${esc(t.accounts?.name||'—')}</td>
        <td style="padding:6px 8px">${esc(t.categories?.name||'—')}</td>
        <td style="padding:6px 8px">${esc(t.payees?.name||'—')}</td>
        <td style="padding:6px 8px;text-align:right;color:${t.amount>=0?'#2a7a4a':'#c0392b'};font-weight:600">${fmt(t.amount)}</td>
      </tr>`).join('')}
      <tr style="background:#f0f0f0;font-weight:700">
        <td colspan="5" style="padding:8px">Total</td>
        <td style="padding:8px;text-align:right;color:${bal>=0?'#2a7a4a':'#c0392b'}">${fmt(bal)}</td>
      </tr></tbody></table>`;
  } else {
    const allMap={};
    txs.forEach(t=>{const n=t.categories?.name||'Sem categoria',tp=t.amount<0?'Despesa':'Receita',k=n+'|'+tp;
      if(!allMap[k]) allMap[k]={name:n,type:tp,color:t.categories?.color||'#666',total:0,count:0};
      allMap[k].total+=Math.abs(t.amount);allMap[k].count++;});
    const allE=Object.values(allMap).sort((a,b)=>b.total-a.total);
    const grand=allE.reduce((s,e)=>s+e.total,0);
    body=`<table style="width:100%;border-collapse:collapse;font-size:11px">
      <thead><tr style="background:#2a6049;color:#fff">
        <th style="padding:8px;text-align:left">Categoria</th><th style="padding:8px">Tipo</th>
        <th style="padding:8px;text-align:center">Qtd</th><th style="padding:8px;text-align:right">Total</th>
        <th style="padding:8px;text-align:right">%</th>
      </tr></thead><tbody>
      ${allE.map((v,i)=>`<tr style="background:${i%2?'#f9f9f9':'#fff'}">
        <td style="padding:6px 8px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${v.color};margin-right:6px"></span>${esc(v.name)}</td>
        <td style="padding:6px 8px;text-align:center;color:${v.type==='Despesa'?'#c0392b':'#2a7a4a'}">${v.type}</td>
        <td style="padding:6px 8px;text-align:center">${v.count}</td>
        <td style="padding:6px 8px;text-align:right;font-weight:600;color:${v.type==='Despesa'?'#c0392b':'#2a7a4a'}">${fmt(v.total)}</td>
        <td style="padding:6px 8px;text-align:right;color:#888">${grand>0?(v.total/grand*100).toFixed(1):0}%</td>
      </tr>`).join('')}
      </tbody></table>`;
  }

  area.innerHTML=`
    <div style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto">
      <div style="background:#2a6049;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0;margin-bottom:0">
        <div style="font-size:20px;font-weight:700">JF Family FinTrack — Relatório</div>
        <div style="font-size:13px;opacity:.85;margin-top:4px">Período: ${fmtDate(from)} a ${fmtDate(to)}  ·  Gerado: ${new Date().toLocaleString('pt-BR')}</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:16px;background:#f5f5f5">
        <div style="background:#fff;border-radius:6px;padding:12px;border-left:3px solid #2a7a4a"><div style="font-size:10px;color:#888;text-transform:uppercase">Receitas</div><div style="font-size:16px;font-weight:700;color:#2a7a4a">${fmt(totInc)}</div></div>
        <div style="background:#fff;border-radius:6px;padding:12px;border-left:3px solid #c0392b"><div style="font-size:10px;color:#888;text-transform:uppercase">Despesas</div><div style="font-size:16px;font-weight:700;color:#c0392b">${fmt(totExp)}</div></div>
        <div style="background:#fff;border-radius:6px;padding:12px;border-left:3px solid ${bal>=0?'#2a7a4a':'#c0392b'}"><div style="font-size:10px;color:#888;text-transform:uppercase">Saldo</div><div style="font-size:16px;font-weight:700;color:${bal>=0?'#2a7a4a':'#c0392b'}">${fmt(bal)}</div></div>
        <div style="background:#fff;border-radius:6px;padding:12px;border-left:3px solid #2a6049"><div style="font-size:10px;color:#888;text-transform:uppercase">Transações</div><div style="font-size:16px;font-weight:700;color:#2a6049">${txs.length}</div></div>
      </div>
      <div style="padding:16px">${body}</div>
    </div>`;
  area.style.display='block';
  window.print();
  setTimeout(()=>{ area.style.display='none'; area.innerHTML=''; }, 1500);
}

/* ═══ EXPORT: CSV ═══ */
function exportReportCSV() {
  const txs = rptState.txData;
  if(!txs.length){toast('Nenhum dado para exportar','error');return;}
  const {from,to}=getRptDateRange();
  const BOM='\uFEFF';
  const headers=['Data','Descrição','Conta','Moeda','Categoria','Subcategoria','Beneficiário','Valor','Tipo','Memo'];
  const rows=txs.map(t=>[
    t.date,
    `"${(t.description||'').replace(/"/g,'""')}"`,
    `"${(t.accounts?.name||'').replace(/"/g,'""')}"`,
    t.accounts?.currency||'BRL',
    `"${(t.categories?.name||'').replace(/"/g,'""')}"`,
    '',
    `"${(t.payees?.name||'').replace(/"/g,'""')}"`,
    String(t.amount).replace('.',','),
    t.amount<0?'Despesa':'Receita',
    `"${(t.memo||'').replace(/"/g,'""')}"`,
  ]);
  const csv=BOM+[headers.join(';'),...rows.map(r=>r.join(';'))].join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url;
  a.download=`FinTrack_${from}_${to}.csv`; a.click();
  URL.revokeObjectURL(url);
  toast(`CSV exportado — ${txs.length} transações`,'success');
}

/* ═══ EMAIL POPUP ═══ */
function showEmailPopup() {
  const {from,to}=getRptDateRange();
  document.getElementById('emailSubject').value=`Relatório FinTrack — ${fmtDate(from)} a ${fmtDate(to)}`;
  document.getElementById('emailPopup').style.display='flex';
}
function closeEmailPopup() {
  document.getElementById('emailPopup').style.display='none';
}

async function sendReportByEmail() {
  const emailToEl = document.getElementById('emailTo');
  // Read value directly from the DOM element — avoid browser email validation blocking .value
  const toAddr = (emailToEl.value || '').trim();
  if (!toAddr) { toast('Informe o destinatário', 'error'); emailToEl.focus(); return; }
  // Basic format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toAddr)) {
    toast('Endereço de e-mail inválido', 'error'); emailToEl.focus(); return;
  }
  if (!EMAILJS_CONFIG.serviceId || !EMAILJS_CONFIG.templateId || !EMAILJS_CONFIG.publicKey) {
    toast('Configure o EmailJS primeiro (botão ⚙️)', 'error'); showEmailConfig(); return;
  }
  if (!sb) { toast('Supabase não conectado', 'error'); return; }

  const btn    = document.getElementById('emailSendBtn');
  const status = document.getElementById('emailStatus');
  btn.disabled = true; btn.textContent = '⏳ Gerando PDF...'; status.textContent = '';

  try {
    // ── Step 1: Generate PDF (same as exportReportPDF) ─────────────────
    const { jsPDF } = window.jspdf;
    const { from, to } = getRptDateRange();
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W   = doc.internal.pageSize.getWidth();

    // Header banner
    doc.setFillColor(42, 96, 73); doc.rect(0, 0, W, 30, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(15); doc.setFont('helvetica', 'bold');
    doc.text('J.F. Family FinTrack — Relatório', 14, 12);
    doc.setFontSize(9); doc.setFont('helvetica', 'normal');
    doc.text('Período: ' + fmtDate(from) + ' a ' + fmtDate(to), 14, 21);
    doc.text('Gerado: ' + new Date().toLocaleString('pt-BR'), W - 14, 21, { align: 'right' });
    doc.setTextColor(30, 30, 30);

    let y = 38;
    const txs    = rptState.txData;
    const totExp = txs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
    const totInc = txs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const bal    = totInc - totExp;

    // KPI tiles
    const kpis = [
      ['Receitas',   fmt(totInc), [42, 122, 74]],
      ['Despesas',   fmt(totExp), [192, 57, 43]],
      ['Saldo',      fmt(bal),    bal >= 0 ? [42, 122, 74] : [192, 57, 43]],
      ['Transações', String(txs.length), [42, 96, 73]],
    ];
    const kw = (W - 28) / kpis.length;
    kpis.forEach(([label, val, col], i) => {
      const x = 14 + i * kw;
      doc.setFillColor(240, 248, 244); doc.roundedRect(x, y, kw - 3, 18, 2, 2, 'F');
      doc.setDrawColor(...col);        doc.roundedRect(x, y, kw - 3, 18, 2, 2, 'S');
      doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(100, 100, 100);
      doc.text(label, x + 4, y + 6);
      doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...col);
      doc.text(val, x + 4, y + 14);
    });
    y += 26; doc.setTextColor(30, 30, 30);

    // Data table
    if (rptState.view === 'regular' || rptState.view === 'transactions') {
      doc.setFontSize(11); doc.setFont('helvetica', 'bold');
      doc.text(rptState.view === 'transactions' ? 'Transações' : 'Detalhamento por Categoria', 14, y);
      y += 4;
      if (rptState.view === 'transactions') {
        const rows = txs.map(t => [fmtDate(t.date), t.description || '', t.accounts?.name || '',
          t.categories?.name || '', t.payees?.name || '', fmt(t.amount)]);
        doc.autoTable({
          startY: y,
          head: [['Data', 'Descrição', 'Conta', 'Categoria', 'Beneficiário', 'Valor']],
          body: rows,
          styles: { fontSize: 8, cellPadding: 3 },
          headStyles: { fillColor: [42, 96, 73], textColor: [255, 255, 255] },
          columnStyles: { 5: { halign: 'right' } },
          margin: { left: 14, right: 14 },
          didParseCell(data) {
            if (data.column.index === 5 && data.section === 'body') {
              const v = txs[data.row.index]?.amount;
              data.cell.styles.textColor = v < 0 ? [192, 57, 43] : [42, 122, 74];
            }
          }
        });
      } else {
        const allMap = {};
        txs.forEach(t => {
          const n = t.categories?.name || 'Sem categoria';
          const tp = t.amount < 0 ? 'Despesa' : 'Receita';
          const k  = n + '|' + tp;
          if (!allMap[k]) allMap[k] = { name: n, type: tp, total: 0, count: 0 };
          allMap[k].total += Math.abs(t.amount); allMap[k].count++;
        });
        const allE  = Object.values(allMap).sort((a, b) => b.total - a.total);
        const grand = allE.reduce((s, e) => s + e.total, 0);
        const rows  = allE.map(v => [v.name, v.type, String(v.count), fmt(v.total),
          grand > 0 ? (v.total / grand * 100).toFixed(1) + '%' : '0%']);
        doc.autoTable({
          startY: y,
          head: [['Categoria', 'Tipo', 'Qtd', 'Total', '%']],
          body: rows,
          styles: { fontSize: 8, cellPadding: 3 },
          headStyles: { fillColor: [42, 96, 73], textColor: [255, 255, 255] },
          columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' } },
          margin: { left: 14, right: 14 }
        });
      }
    }

    // Page footer
    const pages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p); doc.setFontSize(8); doc.setTextColor(150);
      doc.text(`JF Family FinTrack  ·  Página ${p}/${pages}`,
        W / 2, doc.internal.pageSize.getHeight() - 8, { align: 'center' });
    }

    // ── Step 2: Upload PDF to Supabase Storage ─────────────────────────
    btn.textContent = '⏳ Salvando PDF...';
    const pdfBytes   = doc.output('arraybuffer');
    const pdfBlob    = new Blob([pdfBytes], { type: 'application/pdf' });
    const fileName   = `FinTrack_${from}_${to}_${Date.now()}.pdf`;
    const storagePath = `reports/${fileName}`;

    const { error: upErr } = await sb.storage
      .from('fintrack-attachments')
      .upload(storagePath, pdfBlob, { upsert: true, contentType: 'application/pdf' });

    if (upErr) throw new Error('Erro no upload: ' + upErr.message);

    // Get the public URL for the uploaded file
    const { data: urlData } = sb.storage
      .from('fintrack-attachments')
      .getPublicUrl(storagePath);

    const pdfUrl = urlData.publicUrl;

    // ── Step 3: Send email via EmailJS with the download link ──────────
    btn.textContent = '⏳ Enviando e-mail...';
    emailjs.init(EMAILJS_CONFIG.publicKey);

    const subject     = document.getElementById('emailSubject').value.trim() || `Relatório FinTrack — ${fmtDate(from)} a ${fmtDate(to)}`;
    const userMessage = document.getElementById('emailMsg').value.trim() ||
      `Segue o relatório financeiro do período de ${fmtDate(from)} a ${fmtDate(to)}.`;

    const viewLabel = rptState.view === 'regular'       ? 'Análise por Categoria'
                    : rptState.view === 'transactions'  ? 'Lista de Transações'
                    : 'Previsão';

    // Pass recipient under every common variable name templates might use
    const templateParams = {
      to_email:       toAddr,
      to:             toAddr,
      email:          toAddr,
      recipient:      toAddr,
      dest_email:     toAddr,
      reply_to:       toAddr,
      from_name:      'J.F. Family FinTrack',
      subject:        subject,
      message:        userMessage,
      report_period:  `${fmtDate(from)} a ${fmtDate(to)}`,
      report_view:    viewLabel,
      report_income:  fmt(totInc),
      report_expense: fmt(totExp),
      report_balance: fmt(bal),
      report_count:   String(txs.length),
      pdf_url:        pdfUrl,
      pdf_name:       fileName,
    };

    try {
      await emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, templateParams);
    } catch(ejErr) {
      const errText = ejErr?.text || ejErr?.message || JSON.stringify(ejErr);
      if (/recipients|address|to email/i.test(errText)) {
        throw new Error(
          `O campo "To Email" do template EmailJS precisa ser configurado como {{to_email}}.

` +
          `Acesse: emailjs.com → Email Templates → seu template → campo "To Email" → defina: {{to_email}}

` +
          `Erro: ${errText}`
        );
      }
      throw new Error(errText);
    }

    status.textContent = '✓ Enviado!'; status.style.color = 'var(--green)';
    toast('E-mail enviado com sucesso!', 'success');
    setTimeout(closeEmailPopup, 1800);

  } catch(e) {
    console.error('[Email]', e);
    const msg = e.message || e.text || 'Erro desconhecido';
    status.textContent = '✗ Erro';
    status.style.color = 'var(--red)';
    // Show full actionable message in a more visible way
    toast(msg.split('\n')[0], 'error');
    if (msg.includes('To Email') || msg.includes('{{to_email}}')) {
      // Show persistent helper message in the status area
      const emailPopupBox = document.querySelector('.email-popup-box');
      let helperEl = document.getElementById('emailConfigHelper');
      if (!helperEl) {
        helperEl = document.createElement('div');
        helperEl.id = 'emailConfigHelper';
        helperEl.style.cssText = 'background:var(--amber-lt);border:1px solid var(--amber);border-radius:6px;padding:10px;font-size:.78rem;color:var(--text2);margin-top:8px;line-height:1.5';
        emailPopupBox?.appendChild(helperEl);
      }
      helperEl.innerHTML = `⚠️ <strong>Configuração necessária no EmailJS:</strong><br>
        Acesse <a href="https://dashboard.emailjs.com/admin/templates" target="_blank" style="color:var(--accent)">emailjs.com → Email Templates</a>,
        abra seu template, e no campo <strong>"To Email"</strong> defina: <code style="background:var(--bg3);padding:1px 4px;border-radius:3px">{{to_email}}</code>`;
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
function fmtDate(d){if(!d)return'—';const[y,m,day]=d.split('T')[0].split('-');return`${day}/${m}/${y}`;}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}


/* ═══════════════════════════════════════
   PAYEE AUTOCOMPLETE
═══════════════════════════════════════ */
