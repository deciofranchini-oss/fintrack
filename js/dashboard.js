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
  if (state?.privacyMode) return '••••••';
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
  // Guard: sem cliente Supabase ou sem family_id não há dados para mostrar
  if (!sb) { console.warn('[dashboard] sb não inicializado'); return; }
  if (!currentUser?.family_id && currentUser?.role !== 'admin' && currentUser?.role !== 'owner') {
    console.warn('[dashboard] currentUser sem family_id — aguardando contexto');
    // Mostra estado vazio amigável ao invés de erros silenciosos
    const el = document.getElementById('accountBalancesList');
    if (el) el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:.83rem">Nenhuma família vinculada.<br>Peça ao administrador para associar sua conta.</div>';
    return;
  }
  // Inicia FX em paralelo com os KPIs — nunca bloqueia o dashboard
  const fxPromise = initFxRates().catch(()=>{});
  const [{ income, expense, total, pendingCount: _pendCount }] = await Promise.all([
    DB.dashboard.loadKPIs(),
    fxPromise,
  ]);
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
  // Pending badge — count already loaded by DB.dashboard.loadKPIs() above
  try {
    const pendingCount = _pendCount;
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
    const favs = accs.filter(a => a.is_favorite);

    // ── Row renderers ────────────────────────────────────────────────────
    const rowHtml = a => {
      const isFav = !!a.is_favorite;
      const balColor = a.balance < 0 ? 'var(--red)' : 'var(--accent)';
      if (isFav) {
        // Highlighted card for favorites
        return `<div onclick="goToAccountTransactions('${a.id}')"
          class="dash-acc-fav-row"
          onmouseover="this.classList.add('dash-acc-fav-row--hover')"
          onmouseout="this.classList.remove('dash-acc-fav-row--hover')">
          <div style="display:flex;align-items:center;gap:9px;min-width:0;flex:1">
            <div style="position:relative;flex-shrink:0">
              ${renderIconEl(a.icon,a.color,22)}
              <span style="position:absolute;top:-4px;right:-5px;font-size:.55rem;line-height:1">⭐</span>
            </div>
            <div style="min-width:0">
              <div style="font-size:.85rem;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.name)}</div>
              <div style="font-size:.68rem;color:var(--muted)">${a.currency !== 'BRL' ? a.currency : accountTypeLabel(a.type)||''}</div>
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:.95rem;font-weight:700;color:${balColor};font-family:var(--font-serif)">${fmt(a.balance,a.currency)}</div>
            ${a.currency !== 'BRL' ? `<div style="font-size:.68rem;color:var(--muted)">${dashFmt(toBRL(a.balance,a.currency),'BRL')}</div>` : ''}
          </div>
        </div>`;
      }
      // Standard row for non-favorites
      return `<div onclick="goToAccountTransactions('${a.id}')" style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer;transition:background .15s;border-radius:4px;margin:0 -4px;padding-left:4px;padding-right:4px" onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background=''">
        <div style="display:flex;align-items:center;gap:9px">${renderIconEl(a.icon,a.color,18)}<span style="font-size:.83rem;color:var(--text2)">${esc(a.name)}</span></div>
        <span class="${a.balance<0?'text-red':'text-accent'}" style="font-size:.83rem;font-weight:500">${fmt(a.balance,a.currency)}</span>
      </div>`;
    };

    // ── Build HTML ────────────────────────────────────────────────────────
    let html = '';

    // Favorites section — always at top if any exist
    if (favs.length) {
      html += `<div style="margin-bottom:8px">
        <div style="font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);padding:6px 0 4px">⭐ Favoritas</div>
        <div class="dash-acc-favs-grid">${favs.map(rowHtml).join('')}</div>
      </div>`;

      // Non-favorites below, as a compact collapsed section if many accounts
      const nonFavs = accs.filter(a => !a.is_favorite);
      if (nonFavs.length) {
        html += `<div>
          <div style="font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);padding:4px 0 2px;border-top:1px solid var(--border);margin-top:4px">Outras</div>
          ${nonFavs.map(rowHtml).join('')}
        </div>`;
      }
      el.innerHTML = html;
      return;
    }

    // No favorites — use original group/flat layout
    if (!groups.length) {
      el.innerHTML = accs.map(rowHtml).join('');
      return;
    }
    const grouped = {};
    accs.forEach(a => { const gid = a.group_id || '__none__'; if (!grouped[gid]) grouped[gid] = []; grouped[gid].push(a); });
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
  // Populate member filter for category chart
  const dashMemSel = document.getElementById('dashMemberFilter');
  if (dashMemSel && typeof populateFamilyMemberSelect === 'function') {
    const prevMember = dashMemSel.value;
    populateFamilyMemberSelect('dashMemberFilter', { placeholder: 'Família (todos)' });
    dashMemSel.style.display = dashMemSel.options.length > 1 ? '' : 'none';
    if (prevMember) dashMemSel.value = prevMember;
  }

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
  const labels=[];
  // ONE query for all 6 months (replaces 6 serial queries)
  const cashRows = await DB.dashboard.loadCashflow(accId);
  const incomes  = cashRows.map(r => r.income);
  const expenses = cashRows.map(r => r.expense);
  const balances = cashRows.map(r => r.balance);
  labels.length = 0;
  cashRows.forEach(r => labels.push(r.label));
  renderChart('cashflowChart','bar',labels,[
    {label:'Receitas',data:incomes,backgroundColor:'rgba(42,122,74,.8)',borderRadius:6,borderSkipped:false,order:2},
    {label:'Despesas',data:expenses,backgroundColor:'rgba(192,57,43,.75)',borderRadius:6,borderSkipped:false,order:2},
    {label:'Saldo',data:balances,type:'line',borderColor:'#1e5ba8',backgroundColor:'rgba(30,91,168,.12)',borderWidth:2.5,pointRadius:4,pointBackgroundColor:'#1e5ba8',fill:true,tension:0.35,order:1},
  ]);
}
// ─── Category chart: rich palette + click-to-drill ───────────────────────
// Stores raw transaction data so click handler can filter without re-fetching
let _catChartRawData = [];  // [{name, color, brl, t}]
let _catChartEntries = [];  // [{name, total, color, txs}]

// Extended 24-color palette — enough for all realistic category counts without repeats
const CAT_PALETTE = [
  '#2a6049','#1e5ba8','#b45309','#c0392b','#7c3aed',
  '#0891b2','#be185d','#15803d','#c2410c','#4338ca',
  '#0f766e','#9333ea','#b91c1c','#1d4ed8','#92400e',
  '#166534','#0369a1','#a16207','#9f1239','#1e40af',
  '#065f46','#6d28d9','#7f1d1d','#1e3a5f',
];

const GENERIC_COLORS = new Set(['#94a3b8','#888','#888888','#999','#999999']);

/**
 * Assign a distinct palette color to each slice.
 * Strategy: if the category has a meaningful custom color, use it only if no
 * earlier slice in the same chart already used that exact color. Otherwise
 * advance to the next available palette slot — guaranteeing no repeats.
 *
 * @param {string}   color   raw category color from DB
 * @param {number}   idx     position in the current chart (0-based)
 * @param {Set}      usedSet Set of colors already assigned in this chart pass
 */
function _catColor(color, idx, usedSet) {
  const isGeneric = !color || GENERIC_COLORS.has(color.toLowerCase());
  if (!isGeneric) {
    const c = color.toLowerCase();
    if (!usedSet || !usedSet.has(c)) {
      if (usedSet) usedSet.add(c);
      return color;
    }
  }
  // Advance through palette until we find an unused color
  let paletteIdx = idx;
  if (usedSet) {
    paletteIdx = 0;
    let checked = 0;
    while (checked < CAT_PALETTE.length) {
      const candidate = CAT_PALETTE[paletteIdx % CAT_PALETTE.length];
      if (!usedSet.has(candidate)) { usedSet.add(candidate); return candidate; }
      paletteIdx++; checked++;
    }
    // All palette colors used (>24 categories) — cycle with opacity variation
    const base = CAT_PALETTE[idx % CAT_PALETTE.length];
    usedSet.add(base + '_' + idx);
    return base;
  }
  return CAT_PALETTE[paletteIdx % CAT_PALETTE.length];
}

async function renderCategoryChart(){
  const now=new Date(),y=now.getFullYear(),m=String(now.getMonth()+1).padStart(2,'0');
  const memberId = document.getElementById('dashMemberFilter')?.value || '';
  let q = famQ(
    sb.from('transactions')
      .select('id,date,description,amount,brl_amount,currency,account_id,categories(name,color),payees(name),accounts!transactions_account_id_fkey(name)')
  ).gte('date',`${y}-${m}-01`).lte('date',`${y}-${m}-31`).lt('amount',0).not('category_id','is',null);
  if (memberId) q = q.eq('family_member_id', memberId);
  const{data}=await q;

  const catMap={};
  (data||[]).forEach(t=>{
    const n=t.categories?.name||'Outros';
    const rawColor=t.categories?.color||'';
    if(!catMap[n]) catMap[n]={rawColor, txs:[], total:0};
    const brl = t.brl_amount != null ? Math.abs(t.brl_amount) : toBRL(Math.abs(t.amount), t.currency||'BRL');
    catMap[n].total+=brl;
    catMap[n].txs.push({...t, _brl: brl});
  });

  const _usedColors = new Set();
  _catChartEntries=Object.entries(catMap)
    .sort((a,b)=>b[1].total-a[1].total)
    .slice(0,8)
    .map(([name,v],i)=>({
      name,
      total: v.total,
      color: _catColor(v.rawColor, i, _usedColors),
      txs: v.txs.sort((a,b)=>b._brl-a._brl),
    }));

  if(!_catChartEntries.length){
    const el=document.getElementById('categoryChart');
    if(el){const ctx=el.getContext('2d');ctx.clearRect(0,0,el.width,el.height);ctx.fillStyle='#8c8278';ctx.textAlign='center';ctx.font='13px Outfit';ctx.fillText('Sem despesas no mês',el.width/2,el.height/2);}
    return;
  }

  closeCatDetail(); // reset any open detail

  renderChart('categoryChart','doughnut',
    _catChartEntries.map(e=>e.name),
    [{
      data: _catChartEntries.map(e=>e.total),
      backgroundColor: _catChartEntries.map(e=>e.color),
      borderWidth: 2,
      borderColor: '#fff',
      hoverOffset: 8,
      hoverBorderWidth: 3,
    }],
    {
      onClick(event, elements) {
        if (!elements.length) return;
        const idx = elements[0].index;
        openCatDetail(idx);
      },
      onHover(event, elements) {
        const canvas = event.native?.target;
        if (canvas) canvas.style.cursor = elements.length ? 'pointer' : 'default';
      },
    }
  );
}

function openCatDetail(idx) {
  const entry = _catChartEntries[idx];
  if (!entry) return;

  const detailEl   = document.getElementById('catChartDetail');
  const titleEl    = document.getElementById('catChartDetailTitle');
  const listEl     = document.getElementById('catChartDetailList');
  const backBtn    = document.getElementById('catDetailBackBtn');
  const canvas     = document.getElementById('categoryChart');

  if (!detailEl || !titleEl || !listEl) return;

  // Shrink chart, show detail
  if (canvas) canvas.height = 140;
  if (backBtn) backBtn.style.display = 'flex';
  detailEl.style.display = '';

  const dot = `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${entry.color};flex-shrink:0"></span>`;
  titleEl.innerHTML = `${dot}<strong>${esc(entry.name)}</strong><span style="color:var(--muted);font-weight:400;font-size:.72rem;margin-left:4px">${fmt(entry.total)}</span><span style="color:var(--muted);font-weight:400;font-size:.72rem;margin-left:4px">· ${entry.txs.length} lançamento${entry.txs.length!==1?'s':''}`;

  const MON=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  listEl.innerHTML = entry.txs.map(t => {
    const d = t.date ? new Date(t.date+'T12:00:00') : new Date();
    const dateStr = `${d.getDate()} ${MON[d.getMonth()]}`;
    const acctName = t.accounts?.name || '';
    const payeeName = t.payees?.name || '';
    const meta = [acctName, payeeName].filter(Boolean).join(' · ');
    return `<div onclick="openTxDetail('${t.id}')" style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);cursor:pointer;transition:background .12s;border-radius:3px" onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background=''">
      <div style="min-width:0;flex:1">
        <div style="font-size:.82rem;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.description||'—')}</div>
        <div style="font-size:.7rem;color:var(--muted)">${dateStr}${meta?' · '+esc(meta):''}</div>
      </div>
      <span style="font-size:.85rem;font-weight:700;color:var(--red);flex-shrink:0;margin-left:10px">${fmt(t._brl)}</span>
    </div>`;
  }).join('');

  // Highlight the selected arc
  const chart = state.chartInstances['categoryChart'];
  if (chart) {
    chart.data.datasets[0].backgroundColor = _catChartEntries.map((e,i) =>
      i === idx ? e.color : e.color + '44'
    );
    chart.update();
  }
}

function closeCatDetail() {
  const detailEl = document.getElementById('catChartDetail');
  const backBtn  = document.getElementById('catDetailBackBtn');
  const canvas   = document.getElementById('categoryChart');
  if (detailEl) detailEl.style.display = 'none';
  if (backBtn)  backBtn.style.display  = 'none';
  if (canvas)   canvas.height = 200;

  // Restore chart colors
  const chart = state.chartInstances['categoryChart'];
  if (chart && _catChartEntries.length) {
    chart.data.datasets[0].backgroundColor = _catChartEntries.map(e => e.color);
    chart.update();
  }
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
