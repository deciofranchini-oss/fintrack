const _dashGroupCollapsed = {}; // groupId → true/false

function toggleDashGroup(key) {
  _dashGroupCollapsed[key] = !_dashGroupCollapsed[key];
  const body  = document.getElementById('dashGroupBody-' + key);
  const arrow = document.getElementById('dashGroupArrow-' + key);
  const collapsed = _dashGroupCollapsed[key];
  if (body)  body.style.maxHeight  = collapsed ? '0' : '2000px';
  if (arrow) arrow.style.transform = collapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
}

// Dashboard formatter: no decimals (0 casas) for quick glance
function dashFmt(value, currency='BRL'){
  const v = Number(value) || 0;
  try{
    const opts = { minimumFractionDigits: 0, maximumFractionDigits: 0 };
    if(currency){
      return v.toLocaleString('pt-BR', { style:'currency', currency, ...opts });
    }
    return v.toLocaleString('pt-BR', opts);
  }catch(e){
    // Fallback
    const rounded = Math.round(v);
    return (currency ? `R$ ${rounded.toLocaleString('pt-BR')}` : rounded.toLocaleString('pt-BR'));
  }
}

async function loadDashboardRecent(){
  const status = document.getElementById('dashRecentStatus')?.value || '';
  let q = famQ(
    sb.from('transactions')
      .select('*, status, accounts!transactions_account_id_fkey(name), categories(name,color)')
  ).order('date', { ascending: false }).limit(10);

  if (status) q = q.eq('status', status);

  const { data: recent, error } = await q;
  if (error) { console.warn('[dashboard recent]', error.message); }

  const body = document.getElementById('recentTxBody');
  if (!body) return;

  if (!recent?.length) {
    body.innerHTML = '<tr><td colspan="4" class="text-muted" style="text-align:center;padding:24px;font-size:.83rem">Sem transações</td></tr>';
    return;
  }

  body.innerHTML = (recent || []).map(t => {
    const isPend = (t.status || 'confirmed') === 'pending';
    const rowStyle = isPend ? 'background:rgba(245,158,11,.10)' : '';
    const badge = isPend ? '<span class="badge" style="margin-left:6px;background:rgba(245,158,11,.16);color:var(--amber,#b45309);border:1px solid rgba(180,83,9,.18);font-size:.65rem">⏳ pendente</span>' : '';
    const clip = t.attachment_url ? ' <span title="Possui anexo" style="font-size:.85rem;opacity:.75">📎</span>' : '';
    return `<tr class="tx-row-clickable" data-tx-id="${t.id}" onclick="openTxDetail('${t.id}')" style="cursor:pointer;${rowStyle}">
      <td class="text-muted" style="white-space:nowrap">${fmtDate(t.date)}</td>
      <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.description||'—')}${clip}${badge}</td>
      <td>${t.categories?`<span class="badge" style="background:${t.categories.color}18;color:${t.categories.color};border:1px solid ${t.categories.color}28">${esc(t.categories.name)}</span>`:'—'}</td>
      <td class="${t.amount>=0?'amount-pos':'amount-neg'}" style="white-space:nowrap">${fmt(t.amount)}</td>
    </tr>`;
  }).join('');
}


async function loadDashboard(){
  // Garante que cotações estejam disponíveis antes de computar totais
  await initFxRates().catch(()=>{});
  const now=new Date(),y=now.getFullYear(),m=String(now.getMonth()+1).padStart(2,'0');
  const{data:monthTxs}=await famQ(sb.from('transactions').select('amount,brl_amount,currency,is_transfer,status,account_id')).eq('status','confirmed').gte('date',`${y}-${m}-01`).lte('date',`${y}-${m}-31`);
  let income=0,expense=0;
  (monthTxs||[]).filter(t=>!t.is_transfer).forEach(t=>{
    // Usa brl_amount se disponível; senão converte usando câmbio cached
    const cur = t.currency || 'BRL';
    const brl = t.brl_amount != null ? t.brl_amount : toBRL(t.amount, cur);
    if(brl>0) income+=brl; else expense+=Math.abs(brl);
  });
  // Patrimônio: soma dos saldos de todas as contas ativas (já carregadas em state)
  await loadAccounts(); // garante dados frescos
  // Patrimônio total convertido para BRL
  const total = state.accounts.reduce((s,a)=>{
    const bal = parseFloat(a.balance) || 0;
    const cur = a.currency || 'BRL';
    return s + toBRL(bal, cur);
  },0);
  const statTotalEl = document.getElementById('statTotal');
  const statIncomeEl = document.getElementById('statIncome');
  const statExpensesEl = document.getElementById('statExpenses');
  const bal = income - expense;
  const balEl = document.getElementById('statBalance');

  if (statTotalEl){
    statTotalEl.textContent = dashFmt(total,'BRL');
    statTotalEl.className = 'stat-value ' + (total >= 0 ? 'amount-pos' : 'amount-neg');
  }
  if (statIncomeEl){
    statIncomeEl.textContent = dashFmt(income,'BRL');
    statIncomeEl.className = 'stat-value amount-pos';
  }
  if (statExpensesEl){
    statExpensesEl.textContent = dashFmt(expense,'BRL');
    statExpensesEl.className = 'stat-value amount-neg';
  }
  if (balEl){
    balEl.textContent = dashFmt(bal,'BRL');
    balEl.className = 'stat-value ' + (bal >= 0 ? 'amount-pos' : 'amount-neg');
  }
  // Pending transactions badge
  try {
    const { count: pendingCount } = await famQ(
      sb.from('transactions').select('id', { count: 'exact', head: true })
    ).eq('status','pending');
    const pb = document.getElementById('dashPendingBadge');
    if (pb) {
      if ((pendingCount || 0) > 0) {
        pb.style.display = '';
        pb.textContent = `⏳ ${pendingCount} pendente${pendingCount !== 1 ? 's' : ''}`;
        pb.title = 'Clique para ver pendentes';
        pb.style.cursor = 'pointer';
        pb.onclick = () => {
          navigate('transactions');
          // Apply pending filter when user lands on Transactions
          setTimeout(() => {
            const sel = document.getElementById('txStatusFilter');
            if (sel) { sel.value = 'pending'; filterTransactions(); }
          }, 50);
        };
      } else {
        pb.style.display = 'none';
      }
    }
  } catch(e) {
    // fail silently
  }

  // Recent transactions table (supports status filter)
  await loadDashboardRecent();
  await loadDashboardAutoRunSummary();

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
      const gTotal = gAccs.reduce((s,a) => s + toBRL(parseFloat(a.balance)||0, a.currency||'BRL'), 0);
      return `<div style="margin-bottom:2px">
        <div onclick="toggleDashGroup('${key}')" style="display:flex;justify-content:space-between;align-items:center;padding:8px 0 4px;margin-top:6px;cursor:pointer;user-select:none">
          <span style="display:flex;align-items:center;gap:5px;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)">
            <span style="display:inline-block;transition:transform .2s;transform:rotate(${collapsed?'-90deg':'0deg'})" id="dashGroupArrow-${key}">▾</span>
            ${label}
          </span>
          <span style="font-size:.75rem;font-weight:600;color:var(--muted)">${dashFmt(gTotal,'BRL')}</span>
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
    let q=famQ(sb.from('transactions').select('amount,brl_amount,currency,is_transfer'))
      .gte('date',`${y}-${m}-01`).lte('date',`${y}-${m}-31`);
    if(accId) q=q.eq('account_id',accId);
    const{data}=await q;
    let inc=0,exp=0;
    (data||[]).filter(t=>!t.is_transfer).forEach(t=>{
      const brl = t.brl_amount != null ? t.brl_amount : toBRL(t.amount, t.currency || 'BRL');
      if(brl>0) inc+=brl; else exp+=Math.abs(brl);
    });
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
  const{data}=await famQ(sb.from('transactions').select('amount,brl_amount,currency,categories(name,color)')).gte('date',`${y}-${m}-01`).lte('date',`${y}-${m}-31`).lt('amount',0).not('category_id','is',null);
  const catMap={};
  (data||[]).forEach(t=>{
    const n=t.categories?.name||'Outros';
    const c=t.categories?.color||'#94a3b8';
    if(!catMap[n]) catMap[n]={total:0,color:c};
    const brl = t.brl_amount != null ? Math.abs(t.brl_amount) : toBRL(Math.abs(t.amount), t.currency||'BRL');
    catMap[n].total+=brl;
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


// Daily summary: how many scheduled auto-registrations ran today
async function loadDashboardAutoRunSummary(){
  const el = document.getElementById('dashAutoRunSummary');
  if(!el || !sb) return;
  try{
    const today = new Date().toISOString().slice(0,10);
    const q = famQ(sb.from('scheduled_run_logs').select('id',{count:'exact', head:true}))
      .eq('scheduled_date', today);
    const { count, error } = await q;
    if(error) throw error;
    const n = count || 0;
    if(n>0){
      el.style.display='';
      el.textContent = `📌 Hoje: ${n} programada${n!==1?'s':''} auto-registrada${n!==1?'s':''}`;
      const isAdmin = (typeof currentUser!=='undefined') && (currentUser?.role==='admin' || currentUser?.role==='owner' || currentUser?.can_admin);
      if(!isAdmin){ el.style.cursor='default'; el.onclick=null; }
    } else {
      el.style.display='none';
    }
  }catch(e){
    // table may not exist; hide silently
    el.style.display='none';
  }
}
