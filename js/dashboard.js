const _dashGroupCollapsed = {}; // groupId → true/false

function toggleDashGroup(key) {
  _dashGroupCollapsed[key] = !_dashGroupCollapsed[key];
  const body  = document.getElementById('dashGroupBody-' + key);
  const arrow = document.getElementById('dashGroupArrow-' + key);
  const collapsed = _dashGroupCollapsed[key];
  if (body)  body.style.maxHeight  = collapsed ? '0' : '2000px';
  if (arrow) arrow.style.transform = collapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
}

async function loadDashboard(){
  const now=new Date(),y=now.getFullYear(),m=String(now.getMonth()+1).padStart(2,'0');
  const{data:monthTxs}=await famQ(sb.from('transactions').select('amount,is_transfer')).gte('date',`${y}-${m}-01`).lte('date',`${y}-${m}-31`);
  let income=0,expense=0;(monthTxs||[]).filter(t=>!t.is_transfer).forEach(t=>{if(t.amount>0)income+=t.amount;else expense+=Math.abs(t.amount);});
  // Patrimônio: soma dos saldos de todas as contas ativas (já carregadas em state)
  await loadAccounts(); // garante dados frescos
  const total = state.accounts.reduce((s,a)=>{
    return s + (parseFloat(a.balance)||0);
  },0);
  document.getElementById('statTotal').textContent=fmt(total,'BRL');document.getElementById('statIncome').textContent=fmt(income);document.getElementById('statExpenses').textContent=fmt(expense);
  const bal=income-expense,balEl=document.getElementById('statBalance');balEl.textContent=fmt(bal);balEl.className='stat-value '+(bal>=0?'text-green':'text-red');
  const{data:recent}=await famQ(sb.from('transactions').select('*, accounts!transactions_account_id_fkey(name), categories(name,color)')).order('date',{ascending:false}).limit(10);
  const body=document.getElementById('recentTxBody');
  if(!recent?.length){body.innerHTML='<tr><td colspan="4" class="text-muted" style="text-align:center;padding:24px;font-size:.83rem">Sem transações</td></tr>';}
  else body.innerHTML=(recent||[]).map(t=>`<tr><td class="text-muted" style="white-space:nowrap">${fmtDate(t.date)}</td><td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.description||'—')}</td><td>${t.categories?`<span class="badge" style="background:${t.categories.color}18;color:${t.categories.color};border:1px solid ${t.categories.color}28">${esc(t.categories.name)}</span>`:'—'}</td><td class="${t.amount>=0?'amount-pos':'amount-neg'}" style="white-space:nowrap">${fmt(t.amount)}</td></tr>`).join('');
  // Render account balances grouped by account group
  (function renderAccountBalances() {
    const el = document.getElementById('accountBalancesList');
    const accs = state.accounts;
    const groups = state.groups || [];
    const rowHtml = a => `<div onclick="goToAccountTransactions('${a.id}')" style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid var(--border);cursor:pointer;transition:background .15s;border-radius:4px;margin:0 -4px;padding-left:4px;padding-right:4px" onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background=''">
      <div style="display:flex;align-items:center;gap:9px">${renderIconEl(a.icon,a.color,20)}<span style="font-size:.875rem;color:var(--text2)">${esc(a.name)}</span></div>
      <span class="${a.balance<0?'text-red':'text-accent'}" style="font-size:.875rem;font-weight:500">${fmt(a.balance,a.currency)}</span>
    </div>`;
    if (!groups.length) {
      el.innerHTML = accs.map(rowHtml).join('');
      return;
    }
    const grouped = {};
    accs.forEach(a => { const gid = a.group_id || '__none__'; if (!grouped[gid]) grouped[gid] = []; grouped[gid].push(a); });
    let html = '';
    const buildGroup = (key, label, gAccs) => {
      const collapsed = _dashGroupCollapsed[key] === true;
      const gTotal = gAccs.reduce((s,a) => s + (parseFloat(a.balance)||0), 0);
      return `<div style="margin-bottom:2px">
        <div onclick="toggleDashGroup('${key}')" style="display:flex;justify-content:space-between;align-items:center;padding:8px 0 4px;margin-top:6px;cursor:pointer;user-select:none">
          <span style="display:flex;align-items:center;gap:5px;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)">
            <span style="display:inline-block;transition:transform .2s;transform:rotate(${collapsed?'-90deg':'0deg'})" id="dashGroupArrow-${key}">▾</span>
            ${label}
          </span>
          <span style="font-size:.75rem;font-weight:600;color:var(--muted)">${fmt(gTotal,'BRL')}</span>
        </div>
        <div id="dashGroupBody-${key}" style="padding-left:4px;overflow:hidden;transition:max-height .25s ease;max-height:${collapsed?'0':'2000px'}">
          ${gAccs.map(rowHtml).join('')}
        </div>
      </div>`;
    };
    groups.forEach(g => {
      const gAccs = grouped[g.id];
      if (!gAccs || !gAccs.length) return;
      html += buildGroup(g.id, `${g.emoji||'🗂️'} ${esc(g.name)}`, gAccs);
    });
    const ungrouped = grouped['__none__'];
    if (ungrouped && ungrouped.length) html += buildGroup('__none__', 'Sem grupo', ungrouped);
    el.innerHTML = html || accs.map(rowHtml).join('');
  })();
  await Promise.all([renderCashflowChart(),renderCategoryChart()]);
}
async function renderCashflowChart(){
  // Populate account filter (refresh every time dashboard loads)
  const sel = document.getElementById('cashflowAccountFilter');
  if(sel) {
    const curVal = sel.value;
    sel.innerHTML = '<option value="">Todas as contas</option>' +
      state.accounts.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join('');
    if(curVal) sel.value = curVal; // restore selection
  }
  const accId = sel ? sel.value : '';
  const months=[];
  for(let i=5;i>=0;i--){
    const d=new Date();d.setMonth(d.getMonth()-i);
    months.push({y:d.getFullYear(),m:String(d.getMonth()+1).padStart(2,'0')});
  }
  const MONTH_NAMES=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const labels=months.map(({y,m})=>{
    const d=new Date(+y,+m-1,1);
    return MONTH_NAMES[d.getMonth()]+'/'+String(y).slice(2);
  });
  const incomes=[],expenses=[],balances=[];
  for(const{y,m}of months){
    let q=sb.from('transactions').select('amount,is_transfer')
      .gte('date',`${y}-${m}-01`).lte('date',`${y}-${m}-31`);
    if(accId) q=q.eq('account_id',accId);
    const{data}=await q;
    let inc=0,exp=0;
    (data||[]).filter(t=>!t.is_transfer).forEach(t=>{if(t.amount>0)inc+=t.amount;else exp+=Math.abs(t.amount);});
    incomes.push(+inc.toFixed(2));
    expenses.push(+exp.toFixed(2));
    balances.push(+(inc-exp).toFixed(2));
  }
  renderChart('cashflowChart','bar',labels,[
    {label:'Receitas',data:incomes,backgroundColor:'rgba(42,122,74,.8)',borderRadius:6,borderSkipped:false,order:2},
    {label:'Despesas',data:expenses,backgroundColor:'rgba(192,57,43,.75)',borderRadius:6,borderSkipped:false,order:2},
    {label:'Saldo',data:balances,type:'line',borderColor:'#1e5ba8',backgroundColor:'rgba(30,91,168,.12)',borderWidth:2.5,pointRadius:4,pointBackgroundColor:'#1e5ba8',fill:true,tension:0.35,order:1},
  ]);
}
async function renderCategoryChart(){
  const now=new Date(),y=now.getFullYear(),m=String(now.getMonth()+1).padStart(2,'0');
  const{data}=await sb.from('transactions').select('amount,categories(name,color)').gte('date',`${y}-${m}-01`).lte('date',`${y}-${m}-31`).lt('amount',0).not('category_id','is',null);
  const catMap={};
  (data||[]).forEach(t=>{
    const n=t.categories?.name||'Outros';
    const c=t.categories?.color||'#94a3b8';
    if(!catMap[n]) catMap[n]={total:0,color:c};
    catMap[n].total+=Math.abs(t.amount);
  });
  const FALLBACK_COLORS=['#2a6049','#1e5ba8','#b45309','#c0392b','#7c3aed','#2a7a4a','#3d7a5e'];
  const entries=Object.entries(catMap).sort((a,b)=>b[1].total-a[1].total).slice(0,8);
  if(!entries.length){
    const el=document.getElementById('categoryChart');
    if(el){const ctx=el.getContext('2d');ctx.clearRect(0,0,el.width,el.height);ctx.fillStyle='#8c8278';ctx.textAlign='center';ctx.font='13px Outfit';ctx.fillText('Sem despesas no mês',el.width/2,el.height/2);}
    return;
  }
  renderChart('categoryChart','doughnut',
    entries.map(e=>e[0]),
    [{data:entries.map(e=>e[1].total),backgroundColor:entries.map((e,i)=>e[1].color||FALLBACK_COLORS[i%FALLBACK_COLORS.length]),borderWidth:2,borderColor:'#fff',hoverOffset:6}]
  );
}
/* ═══════════════════════════════════════════════════════════════
   REPORTS — state, filters, data, export
═══════════════════════════════════════════════════════════════ */
