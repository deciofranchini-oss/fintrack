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

async function loadDashboardRecent(memberIds = null){
  const status = document.getElementById('dashRecentStatus')?.value || '';
  let q = famQ(
    sb.from('transactions')
      .select('*, status, accounts!transactions_account_id_fkey(name), categories(name,color)')
  ).order('date', { ascending: false }).limit(30);

  if (status) q = q.eq('status', status);
  const qFiltered = _applyDashMemberFilter(q, memberIds);
  if (qFiltered === null) {
    const body = document.getElementById('recentTxBody');
    if (body) body.innerHTML = '<tr><td colspan="4" class="text-muted" style="text-align:center;padding:24px;font-size:.83rem">Nenhuma transação para este filtro</td></tr>';
    return;
  }
  q = qFiltered;

  const { data: recent, error } = await q;
  if (error) { console.warn('[dashboard recent]', error.message); }

  const body = document.getElementById('recentTxBody');
  if (!body) return;

  const items = recent || [];
  if (!items.length) {
    body.innerHTML = '<tr><td colspan="4" class="text-muted" style="text-align:center;padding:24px;font-size:.83rem">Sem transações</td></tr>';
    return;
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  const byDate = {};
  items.forEach(t => { (byDate[t.date] ||= []).push(t); });

  const dateLabel = (date) => {
    if (date === todayStr) return 'Hoje';
    if (date === yesterdayStr) return 'Ontem';
    return fmtDate(date);
  };

  body.innerHTML = Object.entries(byDate).map(([date, rows]) => {
    const confirmedCount = rows.filter(t => (t.status || 'confirmed') !== 'pending').length;
    const pendingCount = rows.length - confirmedCount;
    const total = rows.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const badgeParts = [
      `<span style="font-size:.7rem;color:var(--muted)">${rows.length} item${rows.length > 1 ? 's' : ''}</span>`
    ];
    if (pendingCount) badgeParts.push(`<span class="badge" style="background:rgba(245,158,11,.14);color:var(--amber,#b45309);border:1px solid rgba(180,83,9,.18);font-size:.64rem">⏳ ${pendingCount} pendente${pendingCount>1?'s':''}</span>`);
    const totalColor = total === 0 ? 'var(--muted)' : (total > 0 ? 'var(--green,#16a34a)' : 'var(--red,#dc2626)');

    const header = `<tr class="recent-date-group"><td colspan="4" style="padding:10px 10px 8px 10px;background:var(--surface2);border-top:1px solid var(--border);border-bottom:1px solid var(--border)"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span style="font-size:.78rem;font-weight:800;color:var(--text2);text-transform:uppercase;letter-spacing:.03em">${dateLabel(date)}</span><span style="font-size:.72rem;color:var(--muted)">${fmtDate(date)}</span>${badgeParts.join('')}</div><span style="font-size:.78rem;font-weight:800;color:${totalColor}">${fmt(total)}</span></div></td></tr>`;

    const lines = rows.map(t => {
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

    return header + lines;
  }).join('');
}


// ── Dashboard member filter helper ───────────────────────────────────────────
// Returns array of member IDs for the current dashboard filters,
// or null if no filter is active (= show all).
function _updateDashFilterBadge(memberIds) {
  let badge = document.getElementById('dashFilterBadge');
  if (!memberIds) {
    if (badge) { badge.style.display = 'none'; } return;
  }
  if (!badge) return;
  const memberId  = document.getElementById('dashMemberFilter')?.value || '';
  const relGroup  = document.getElementById('dashRelGroup')?.value    || '';
  const sel       = document.getElementById('dashMemberFilter');
  const relSel    = document.getElementById('dashRelGroup');
  let label = '';
  if (memberId && sel) {
    label = sel.options[sel.selectedIndex]?.text || memberId;
  } else if (relGroup && relSel) {
    label = relSel.options[relSel.selectedIndex]?.text || relGroup;
  }
  if (label) {
    badge.style.display = 'inline-flex';
    const span = badge.querySelector('span');
    if (span) span.textContent = '👤 ' + label;
  } else {
    badge.style.display = 'none';
  }
}


function _getDashMemberIds() {
  const memberId = document.getElementById('dashMemberFilter')?.value || '';
  const relGroup = document.getElementById('dashRelGroup')?.value    || '';
  if (memberId) return [memberId];
  if (relGroup && typeof getMemberIdsByRelGroup === 'function') {
    return getMemberIdsByRelGroup(relGroup); // may be [] if group empty
  }
  return null; // no filter active
}

// Apply member filter to a Supabase query object (transactions table).
// Returns the (possibly modified) query.
function _applyDashMemberFilter(q, memberIds) {
  if (!memberIds) return q;          // no filter
  if (memberIds.length === 0) return null; // filter active but no members — no results
  return q.in('family_member_id', memberIds);
}


function _openDashMonthTx(type, memberIds) {
  const now=new Date();
  const month=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  state.txFilter=state.txFilter||{};
  Object.assign(state.txFilter,{month,type,search:'',account:'',status:'confirmed'});
  state.txPage=0; state.txSortField='date'; state.txSortAsc=false;
  const _e=id=>document.getElementById(id);
  if(_e('txMonth'))        _e('txMonth').value=month;
  if(_e('txType'))         _e('txType').value=type;
  if(_e('txStatusFilter')) _e('txStatusFilter').value='confirmed';
  if(_e('txSearch'))       _e('txSearch').value='';
  if(_e('txAccount'))      _e('txAccount').value='';
  navigate('transactions');
}
async function loadDashboard(){
  // Aplicar prefs de customização imediatamente (evita flash de cards ocultos)
  try { _dashApplyPrefs(_dashGetPrefs()); } catch(_e) {}
  // Sincronizar prefs do servidor em background
  _syncDashPrefsFromServer().catch(()=>{});
  // Guard: sem cliente Supabase ou sem family_id não há dados para mostrar
  if (!sb) { console.warn('[dashboard] sb não inicializado'); return; }
  if (!currentUser?.family_id && currentUser?.role !== 'admin' && currentUser?.role !== 'owner') {
    console.warn('[dashboard] currentUser sem family_id — lançando wizard de criação');
    // User has no family: let them create one instead of showing a dead-end message
    if (typeof enforceFirstLoginFamilyCreation === 'function') {
      enforceFirstLoginFamilyCreation();
    }
    return;
  }
  // Inicia FX em paralelo com os KPIs — nunca bloqueia o dashboard
  const fxPromise = initFxRates().catch(()=>{});
  const _dashMemberIds = _getDashMemberIds();

  // Show/hide active filter badge on dashboard KPIs
  _updateDashFilterBadge(_dashMemberIds);

  const [{ income, expense, total, pendingCount: _pendCount }] = await Promise.all([
    DB.dashboard.loadKPIs(_dashMemberIds),
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
    statIncomeEl.textContent=dashFmt(income,'BRL');
    statIncomeEl.className='stat-value amount-pos';
    const _ic=statIncomeEl.closest('.stat-card');
    if(_ic){_ic.style.cursor='pointer';_ic.title='Ver receitas do mês';
      _ic.onclick=()=>_openDashMonthTx('income',_dashMemberIds);}
  }
  if (statExpensesEl){
    statExpensesEl.textContent=dashFmt(expense,'BRL');
    statExpensesEl.className='stat-value amount-neg';
    const _ec=statExpensesEl.closest('.stat-card');
    if(_ec){_ec.style.cursor='pointer';_ec.title='Ver despesas do mês';
      _ec.onclick=()=>_openDashMonthTx('expense',_dashMemberIds);}
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
  await loadDashboardRecent(_dashMemberIds);
  if (typeof renderDashboardUpcoming === 'function') await renderDashboardUpcoming(_dashMemberIds);
  if(typeof _renderDashFavCategories==='function') await _renderDashFavCategories(income, expense);
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
        // Fintech-style card for favorites
        const _cardColor  = a.color || '#2a6049';
        const _typeLabel  = accountTypeLabel(a.type) || a.type || '';
        const _isNeg      = a.balance < 0;
        const _brlLine    = (a.currency !== 'BRL')
          ? `<div class="dash-fav-brl">${dashFmt(toBRL(a.balance,a.currency),'BRL')}</div>`
          : '';
        return `<div class="dash-fav-card" onclick="goToAccountTransactions('${a.id}')"
          style="--card-clr:${_cardColor}">
          <div class="dash-fav-card__top">
            <div class="dash-fav-card__icon">${renderIconEl(a.icon,a.color,20)}</div>
            <span class="dash-fav-card__type">${esc(_typeLabel)}</span>
          </div>
          <div class="dash-fav-card__name">${esc(a.name)}</div>
          <div class="dash-fav-card__balance ${_isNeg ? 'neg' : ''}">${fmt(a.balance,a.currency)}</div>
          ${_brlLine}
          <div class="dash-fav-card__shine"></div>
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
      html += `<div class="dash-favs-section">
        <div class="dash-favs-grid">${favs.map(rowHtml).join('')}</div>
      </div>`;

      // Non-favorites: split BRL vs foreign, both collapsed by default
      const nonFavs = accs.filter(a => !a.is_favorite);
      if (nonFavs.length) {
        const brlAccs = nonFavs.filter(a => !a.currency || a.currency === 'BRL');
        const fxAccs  = nonFavs.filter(a =>  a.currency && a.currency !== 'BRL');

        const buildOtherGroup = (key, label, emoji, gAccs) => {
          if (!gAccs.length) return '';
          // Start collapsed by default
          if (_dashGroupCollapsed[key] === undefined) _dashGroupCollapsed[key] = true;
          const collapsed = _dashGroupCollapsed[key];
          const gTotal = gAccs.reduce((s,a) => s + toBRL(parseFloat(a.balance)||0, a.currency||'BRL'), 0);
          return `<div style="margin-top:6px">
            <div onclick="toggleDashGroup('${key}')"
              style="display:flex;justify-content:space-between;align-items:center;
                padding:7px 0;cursor:pointer;user-select:none;
                border-top:1px solid var(--border)">
              <span style="display:flex;align-items:center;gap:6px;font-size:.68rem;font-weight:700;
                text-transform:uppercase;letter-spacing:.07em;color:var(--muted)">
                <span style="display:inline-block;transition:transform .2s;
                  transform:rotate(${collapsed?'-90deg':'0deg'})"
                  id="dashGroupArrow-${key}">▾</span>
                ${emoji} ${label}
              </span>
              <span style="font-size:.72rem;font-weight:600;color:var(--muted)">${dashFmt(gTotal,'BRL')}</span>
            </div>
            <div id="dashGroupBody-${key}"
              style="overflow:hidden;transition:max-height .25s ease;
                max-height:${collapsed?'0':'2000px'}">
              ${gAccs.map(rowHtml).join('')}
            </div>
          </div>`;
        };

        html += buildOtherGroup('__nonfav_brl', 'Em Real', '🇧🇷', brlAccs);
        html += buildOtherGroup('__nonfav_fx',  'Moeda Estrangeira', '🌍', fxAccs);
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
  // Populate member and relationship filters for category chart
  if (typeof refreshAllFamilyMemberSelects === 'function') {
    refreshAllFamilyMemberSelects();
  } else {
    const dashMemSel = document.getElementById('dashMemberFilter');
    if (dashMemSel && typeof populateFamilyMemberSelect === 'function') {
      populateFamilyMemberSelect('dashMemberFilter', { placeholder: 'Família (todos)' });
      dashMemSel.style.display = dashMemSel.options.length > 1 ? '' : 'none';
    }
  }

  await Promise.all([renderCashflowChart(_dashMemberIds),renderCategoryChart()]);
}
async function renderCashflowChart(memberIds = null){
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
  // ONE query for all 6 months, with optional member filter
  const cashRows = await DB.dashboard.loadCashflow(accId, memberIds);
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
  const memberId  = document.getElementById('dashMemberFilter')?.value || '';
  const relGroup  = document.getElementById('dashRelGroup')?.value || '';

  // Resolve member IDs from relationship group filter
  let memberIds = null;
  if (relGroup && typeof getMemberIdsByRelGroup === 'function') {
    memberIds = getMemberIdsByRelGroup(relGroup);
  }
  if (memberId) memberIds = [memberId]; // specific member overrides group

  let q = famQ(
    sb.from('transactions')
      .select('id,date,description,amount,brl_amount,currency,account_id,categories(name,color),payees(name),accounts!transactions_account_id_fkey(name)')
  ).gte('date',`${y}-${m}-01`).lte('date',`${y}-${m}-31`).lt('amount',0).not('category_id','is',null);

  if (memberIds && memberIds.length > 0) {
    q = q.in('family_member_id', memberIds);
  } else if (memberIds && memberIds.length === 0) {
    // Group exists but has no members — return empty
    const catChartEl = document.getElementById('catChartCard');
    if (catChartEl) catChartEl.style.display = 'none';
    return;
  }

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



// ════════════════════════════════════════════════════════════════
// Dashboard: sistema de customização por usuário
// ════════════════════════════════════════════════════════════════

const _DASH_PREFS_KEY = () =>
  `dash_prefs_${typeof currentUser !== 'undefined' && currentUser?.id ? currentUser.id : 'default'}`;

const _DASH_CARDS = [
  { id: 'accounts', label: 'Saldo por Conta',           icon: '🏦', sub: 'Saldo atual de cada conta',                 el: 'dashCardAccounts' },
  { id: 'charts',   label: 'Fluxo de Caixa e Gráficos', icon: '📊', sub: 'Cashflow 6 meses + gráfico de despesas',    el: 'dashCardCharts'   },
  { id: 'favcats',  label: 'Categorias Favoritas',      icon: '⭐', sub: 'Evolução das categorias marcadas',          el: 'dashCardFavCats'  },
  { id: 'upcoming', label: 'Próximas Transações',       icon: '📆', sub: 'Programadas para os próximos 10 dias',      el: 'dashCardUpcoming' },
  { id: 'recent',   label: 'Últimas Transações',        icon: '🧾', sub: 'Histórico recente de lançamentos',          el: 'dashCardRecent'   },
];

function _dashGetPrefs() {
  try {
    const raw = localStorage.getItem(_DASH_PREFS_KEY());
    if (raw) return JSON.parse(raw);
  } catch (_e) {}
  // Defaults: tudo visível
  return Object.fromEntries(_DASH_CARDS.map(c => [c.id, true]));
}

async function _dashSavePrefs(prefs) {
  const key = _DASH_PREFS_KEY();
  try { localStorage.setItem(key, JSON.stringify(prefs)); } catch (_e) {}
  if (typeof sb === 'undefined' || !sb) return;
  try {
    const { error } = await sb.from('app_settings')
      .upsert({ key, value: prefs }, { onConflict: 'key' });
    if (error) console.warn('[dashPrefs] save error:', error.message);
  } catch (e) { console.warn('[dashPrefs] save exception:', e.message); }
}

async function _syncDashPrefsFromServer() {
  if (typeof sb === 'undefined' || !sb) return;
  const key = _DASH_PREFS_KEY();
  if (key.endsWith('_default')) return; // usuário não logado ainda
  try {
    const { data, error } = await sb.from('app_settings')
      .select('value').eq('key', key).maybeSingle();
    if (error) { console.warn('[dashPrefs] sync error:', error.message); return; }
    if (data?.value && typeof data.value === 'object') {
      _dashSavePrefs(data.value);
      _dashApplyPrefs(data.value);
      _renderDashFavCategories(_lastDashIncome, _lastDashExpense);
    }
  } catch (e) { console.warn('[dashPrefs] sync exception:', e.message); }
}

function _dashApplyPrefs(prefs) {
  _DASH_CARDS.forEach(c => {
    const el = document.getElementById(c.el);
    if (!el) return;
    const visible = prefs[c.id] !== false;
    el.style.display = visible ? '' : 'none';
  });
}

function openDashCustomModal() {
  const prefs = _dashGetPrefs();
  const list  = document.getElementById('dashCustomList');
  if (!list) return;
  list.innerHTML = _DASH_CARDS.map(c => `
    <div class="dash-custom-toggle" onclick="_dashToggleCard('${c.id}',this)">
      <span class="dash-custom-toggle-icon">${c.icon}</span>
      <div style="flex:1;min-width:0">
        <div class="dash-custom-toggle-label">${c.label}</div>
        <div class="dash-custom-toggle-sub">${c.sub}</div>
      </div>
      <button class="dash-toggle-switch ${prefs[c.id]!==false?'on':''}" data-card="${c.id}" onclick="event.stopPropagation();_dashToggleCard('${c.id}',this.closest('.dash-custom-toggle'))"></button>
    </div>`).join('');
  openModal('dashCustomModal');
}

function _dashToggleCard(id, row) {
  const btn = row?.querySelector('.dash-toggle-switch');
  if (!btn) return;
  const isOn = btn.classList.toggle('on');
  btn.setAttribute('data-state', isOn ? 'on' : 'off');
}

function _dashCustomSave() {
  const prefs = {};
  _DASH_CARDS.forEach(c => {
    const btn = document.querySelector(`.dash-toggle-switch[data-card="${c.id}"]`);
    prefs[c.id] = btn ? btn.classList.contains('on') : true;
  });
  _dashSavePrefs(prefs);
  _dashApplyPrefs(prefs);
  // Re-renderizar favoritos se voltou a ser visível
  if (prefs.favcats !== false) _renderDashFavCategories(_lastDashIncome, _lastDashExpense);
  closeModal('dashCustomModal');
  toast('Preferências do dashboard salvas!', 'success');
}

// Guardar últimos valores de income/expense para re-render após customização
let _lastDashIncome = 0, _lastDashExpense = 0;

// ════════════════════════════════════════════════════════════════
// _renderDashFavCategories — redesenhada
// ════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════
// Dashboard: categorias favoritas — redesign completo
// ══════════════════════════════════════════════════════════════════
async function _renderDashFavCategories(totalIncome, totalExpense) {
  _lastDashIncome  = totalIncome  != null ? totalIncome  : _lastDashIncome;
  _lastDashExpense = totalExpense != null ? totalExpense : _lastDashExpense;

  const prefs = _dashGetPrefs();
  _dashApplyPrefs(prefs);

  const el = document.getElementById('dashFavCategories');
  if (!el) return;
  if (prefs.favcats === false) return;

  const ids = typeof _loadCatFavorites === 'function' ? _loadCatFavorites() : [];

  // Estado vazio — sem favoritos configurados
  if (!ids.length) {
    el.innerHTML = `
      <div class="dfav-card">
        <div class="dfav-header">
          <span class="dfav-title">⭐ Categorias Favoritas</span>
          <button class="dfav-manage" onclick="navigate('categories')">+ Adicionar</button>
        </div>
        <div class="dfav-empty">
          <div style="font-size:1.6rem;margin-bottom:8px">⭐</div>
          <div style="font-weight:600;margin-bottom:4px">Nenhuma categoria favorita</div>
          <div style="font-size:.75rem;color:var(--muted)">Vá em Categorias e marque com ★ as que deseja acompanhar aqui.</div>
          <button onclick="navigate('categories')" class="btn btn-primary btn-sm" style="margin-top:12px;font-size:.78rem">
            Gerenciar Categorias
          </button>
        </div>
      </div>`;
    return;
  }

  const allCats = state.categories || [];
  const favCats = allCats.filter(c => ids.includes(c.id));
  if (!favCats.length) {
    el.innerHTML = `<div class="dfav-card"><div class="dfav-header"><span class="dfav-title">⭐ Categorias Favoritas</span><button class="dfav-manage" onclick="navigate('categories')">Gerenciar</button></div><div class="dfav-empty"><div>Categorias favoritas não encontradas.<br><span style="font-size:.75rem">Elas podem ter sido excluídas.</span></div></div></div>`;
    return;
  }

  const now  = new Date(), y = now.getFullYear(), mo = String(now.getMonth()+1).padStart(2,'0');
  const from = `${y}-${mo}-01`;
  const to   = `${y}-${mo}-${String(new Date(y, now.getMonth()+1, 0).getDate()).padStart(2,'0')}`;
  const monthLabel = now.toLocaleDateString('pt-BR',{month:'long',year:'numeric'});

  // Índice de transações confirmadas do mês por category_id
  const txsByCat = {};
  try {
    let q = famQ(sb.from('transactions').select('category_id,date,amount,brl_amount,currency,is_transfer,status,family_member_id'))
      .gte('date', from)
      .lte('date', to)
      .eq('status', 'confirmed');
    const memberIds = _getDashMemberIds();
    if (memberIds && memberIds.length > 0) q = q.in('family_member_id', memberIds);
    else if (memberIds && memberIds.length === 0) q = null;
    const { data: monthTx = [] } = q ? await q : { data: [] };
    monthTx.forEach(t => {
      const txDate = String(t.date || '').slice(0,10);
      if (!t.category_id || t.is_transfer || txDate < from || txDate > to) return;
      if (!txsByCat[t.category_id]) txsByCat[t.category_id] = [];
      txsByCat[t.category_id].push(t);
    });
  } catch (e) {
    console.warn('[dash favcats monthTx]', e?.message || e);
  }

  const sumBrl = txs => txs.reduce((acc, t) => {
    const v = typeof txToBRL === 'function' ? txToBRL(t) : parseFloat(t.brl_amount ?? t.amount) ?? 0;
    return acc + v;
  }, 0);

  // Inferir tipo pela categoria (DB) ou pelo sinal das transações
  const inferType = c => {
    const rawType = String(c?.type || '').toLowerCase();
    if (['receita','income','ganho','entrada'].includes(rawType)) return 'income';
    if (['despesa','expense','gasto','saida','saída'].includes(rawType)) return 'expense';
    const txs = txsByCat[c.id] || [];
    return txs.length ? (sumBrl(txs) >= 0 ? 'income' : 'expense') : 'expense';
  };

  // Construir linha individual
  const renderRow = (c, isChild, isCtxOnly, isLast) => {
    const ownTxs = txsByCat[c.id] || [];
    const ownVal = sumBrl(ownTxs);
    const cType  = inferType(c);
    const base   = cType === 'expense' ? _lastDashExpense : _lastDashIncome;
    const pct    = base > 0 ? Math.abs(ownVal) / base * 100 : 0;
    const barW   = Math.min(pct, 100).toFixed(1);
    const barClr = cType === 'expense' ? 'var(--red,#dc2626)' : 'var(--green,#16a34a)';
    const valClr = ownVal === 0 ? 'var(--muted)' : (cType === 'expense' ? 'var(--red,#dc2626)' : 'var(--green,#16a34a)');
    const valStr = ownVal === 0 ? '—' : (ownVal > 0 ? '+' : '') + fmt(ownVal, 'BRL');
    const pctStr = pct >= 0.1 ? pct.toFixed(1) + '%' : (pct > 0 ? '<0.1%' : '—');
    const navAction = `onclick="_openDashMonthTx('${cType==='expense'?'expense':'income'}',null)"`;

    // Linha de contexto (pai não-favorito, só para hierarquia)
    if (isCtxOnly) {
      return `<div class="dfav-row dfav-row--ctx">
        <span class="dfav-icon">${c.icon||'📦'}</span>
        <span class="dfav-name dfav-name--ctx">${esc(c.name)}</span>
        ${ownVal !== 0 ? `<span class="dfav-val dfav-val--muted">${fmt(Math.abs(ownVal),'BRL')}</span>` : ''}
      </div>`;
    }

    const rowClass  = isChild ? 'dfav-row dfav-row--child' : 'dfav-row';
    const nameClass = isChild ? 'dfav-name dfav-name--child' : 'dfav-name';
    const connector = isChild
      ? `<span class="dfav-conn${isLast?' dfav-conn--last':''}"></span>` : '';

    return `<div class="${rowClass}" ${navAction} title="Ver transações">
        ${connector}
        <span class="dfav-icon${isChild?' dfav-icon--sm':''}">${c.icon||'📦'}</span>
        <div class="dfav-body">
          <div class="dfav-row-top">
            <span class="${nameClass}">${esc(c.name)}</span>
            <span class="dfav-val" style="color:${valClr}">${valStr}</span>
          </div>
          ${pct > 0 ? `<div class="dfav-bar-row">
            <div class="dfav-bar-bg">
              <div class="dfav-bar-fill" style="width:${barW}%;background:${barClr}"></div>
            </div>
            <span class="dfav-pct" style="color:${valClr}">${pctStr}</span>
          </div>` : `<div class="dfav-bar-row"><div class="dfav-bar-bg"></div><span class="dfav-pct">—</span></div>`}
        </div>
      </div>`;
  };

  // Construir seção (Despesas ou Receitas)
  const buildSection = (label, typeKey, secColor) => {
    const parentFavs = favCats.filter(c => !c.parent_id && inferType(c) === typeKey);

    // Pais NÃO favoritos que têm subcats favoritas
    const nfParents = [];
    allCats.filter(p => !p.parent_id && !ids.includes(p.id)).forEach(p => {
      const subs = allCats.filter(c => c.parent_id === p.id && ids.includes(c.id) && inferType(c) === typeKey);
      if (subs.length) nfParents.push({ p, subs });
    });

    // Marcar subcats já cobertas por pais acima
    const covered = new Set();
    parentFavs.forEach(p =>
      allCats.filter(c => c.parent_id === p.id && ids.includes(c.id)).forEach(c => covered.add(c.id)));
    nfParents.forEach(({ subs }) => subs.forEach(c => covered.add(c.id)));

    // Subcats favoritas sem pai visível
    const orphans = favCats.filter(c => c.parent_id && inferType(c) === typeKey && !covered.has(c.id));

    const rows = [];

    parentFavs.forEach(p => {
      rows.push(renderRow(p, false, false, false));
      const subs = allCats.filter(c => c.parent_id === p.id && ids.includes(c.id) && inferType(c) === typeKey);
      subs.forEach((sub, si) => rows.push(renderRow(sub, true, false, si === subs.length - 1)));
    });

    nfParents.forEach(({ p, subs }) => {
      rows.push(renderRow(p, false, true, false));
      subs.forEach((sub, si) => rows.push(renderRow(sub, true, false, si === subs.length - 1)));
    });

    orphans.forEach(c => rows.push(renderRow(c, false, false, false)));

    if (!rows.length) return '';

    // KPI da seção: total de todas as categorias favoritas deste tipo, sem duplicar
    const favIdsOfType = new Set(
      favCats.filter(c => inferType(c) === typeKey).map(c => c.id)
    );
    const sectionTotal = Array.from(favIdsOfType)
      .reduce((acc, id) => acc + sumBrl(txsByCat[id] || []), 0);
    const base = typeKey === 'expense' ? _lastDashExpense : _lastDashIncome;
    const secPct = base > 0 ? Math.abs(sectionTotal) / base * 100 : 0;

    return `<div class="dfav-section">
      <div class="dfav-section-hdr" style="border-left:3px solid ${secColor}">
        <span class="dfav-section-label" style="color:${secColor}">${label}</span>
        <span class="dfav-section-total" style="color:${valClrFromType(typeKey, sectionTotal)}">${sectionTotal===0?'—':(sectionTotal>0?'+':'')+fmt(sectionTotal,'BRL')}</span>
        ${secPct >= 0.1 ? `<span class="dfav-section-pct">${secPct.toFixed(1)}% do total</span>` : ''}
      </div>
      ${rows.join('')}
    </div>`;
  };

  const valClrFromType = (t, v) => v === 0 ? 'var(--muted)' : (t === 'expense' ? 'var(--red,#dc2626)' : 'var(--green,#16a34a)');

  const expSec = buildSection('Despesas', 'expense', 'var(--red,#dc2626)');
  const incSec = buildSection('Receitas', 'income',  'var(--green,#16a34a)');

  if (!expSec && !incSec) {
    el.innerHTML = `<div class="dfav-card"><div class="dfav-header"><span class="dfav-title">⭐ Categorias Favoritas</span><button class="dfav-manage" onclick="navigate('categories')">Gerenciar</button></div><div class="dfav-empty">Sem movimentações no mês para as categorias favoritas.</div></div>`;
    return;
  }

  el.innerHTML = `<div class="dfav-card">
    <div class="dfav-header">
      <div>
        <span class="dfav-title">⭐ Categorias Favoritas</span>
        <span class="dfav-subtitle">${monthLabel}</span>
      </div>
      <button class="dfav-manage" onclick="navigate('categories')" title="Gerenciar favoritas">★ Gerenciar</button>
    </div>
    <div class="dfav-body-wrap">
      ${expSec}
      ${expSec && incSec ? '<div class="dfav-divider"></div>' : ''}
      ${incSec}
    </div>
  </div>`;
}


async function renderDashboardUpcoming(memberIds = null) {
  const prefs = _dashGetPrefs();
  _dashApplyPrefs(prefs);
  const listEl = document.getElementById('dashUpcomingList');
  const cardEl = document.getElementById('dashCardUpcoming');
  if (!listEl || !cardEl) return;
  if (prefs.upcoming === false) return;

  if (!state.scheduled || !state.scheduled.length) {
    try { if (typeof loadScheduled === 'function') await loadScheduled(); } catch(e) { console.warn('[dash upcoming loadScheduled]', e?.message || e); }
  }

  const today = new Date().toISOString().slice(0, 10);
  const limit = new Date();
  limit.setDate(limit.getDate() + 10);
  const limitStr = limit.toISOString().slice(0, 10);

  const memberSet = Array.isArray(memberIds) && memberIds.length ? new Set(memberIds) : null;
  const upcoming = [];

  const pushOccurrence = (sc, date, isPending=false) => {
    const scheduledMemberIds = [];
    if (sc.family_member_id) scheduledMemberIds.push(sc.family_member_id);
    if (Array.isArray(sc.family_member_ids)) scheduledMemberIds.push(...sc.family_member_ids.filter(Boolean));
    const uniqueMembers = [...new Set(scheduledMemberIds)];
    if (memberSet && uniqueMembers.length && !uniqueMembers.some(id => memberSet.has(id))) return;
    if (memberSet && uniqueMembers.length === 0) return;
    upcoming.push({ sc, date, isPending });
  };

  (state.scheduled || []).forEach(sc => {
    if (sc.status === 'paused') return;
    const pendingDates = new Set(
      (sc.occurrences || [])
        .filter(o => (o.execution_status === 'pending' || o.execution_status === 'skipped') && o.scheduled_date >= today && o.scheduled_date <= limitStr)
        .map(o => o.scheduled_date)
    );
    const executedDates = new Set(
      (sc.occurrences || [])
        .filter(o => o.execution_status === 'executed' || o.execution_status === 'processing')
        .map(o => o.scheduled_date)
    );

    let cur = sc.start_date;
    let count = 0;
    const maxCount = sc.end_count || 999;
    const endDate = sc.end_date || '2099-12-31';
    while (cur && cur <= limitStr && count < maxCount && cur <= endDate) {
      if (cur >= today && !executedDates.has(cur)) pushOccurrence(sc, cur, pendingDates.has(cur));
      count++;
      if (sc.frequency === 'once') break;
      cur = nextDate(cur, sc.frequency, sc.custom_interval, sc.custom_unit);
      if (!cur) break;
    }
    pendingDates.forEach(date => {
      if (date >= today && date <= limitStr && !executedDates.has(date) && !upcoming.some(x => x.sc.id === sc.id && x.date === date)) {
        pushOccurrence(sc, date, true);
      }
    });
  });

  upcoming.sort((a,b) => a.date.localeCompare(b.date) || String(a.sc.description||'').localeCompare(String(b.sc.description||'')));

  if (!upcoming.length) {
    listEl.innerHTML = '<div class="text-muted" style="text-align:center;padding:18px;font-size:.83rem">Sem programações para os próximos 10 dias.</div>';
    return;
  }

  const byDate = {};
  upcoming.forEach(u => { (byDate[u.date] ||= []).push(u); });
  const DOW = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate()+1);
  const tomorrowStr = tomorrow.toISOString().slice(0,10);

  listEl.innerHTML = Object.entries(byDate).map(([date, items]) => {
    const isToday = date === today;
    const isTomorrow = date === tomorrowStr;
    const dow = DOW[new Date(date+'T12:00:00').getDay()];
    const dayTot = items.reduce((s,{sc}) => {
      const isExp = sc.type==='expense'||sc.type==='card_payment'||sc.type==='transfer';
      return s + (isExp ? -1 : 1) * Math.abs(Number(sc.amount) || 0);
    }, 0);
    const rows = items.map(({sc,isPending}) => {
      const isExp = sc.type==='expense'||sc.type==='card_payment'||sc.type==='transfer';
      const typeIcon = sc.type==='card_payment' ? '💳' : sc.type==='transfer' ? '↔' : isExp ? '↑' : '↓';
      const dest = (sc.type==='transfer'||sc.type==='card_payment') ? (state.accounts || []).find(a => a.id === sc.transfer_to_account_id) : null;
      const catColor = sc.categories?.color || (isExp ? 'var(--red)' : 'var(--green)');
      const manualBadge = !sc.auto_register ? '<span class="sup-manual-badge">Manual</span>' : '';
      const pendingBadge = isPending ? '<span class="sup-pending-badge" title="Aguardando registro">⚠ Pendente</span>' : '';
      return `<div class="sup-item${isToday?' sup-item--today':''}">
        <div class="sup-icon" style="background:color-mix(in srgb,${catColor} 14%,transparent);color:${catColor}">${typeIcon}</div>
        <div class="sup-body">
          <div class="sup-desc">${esc(sc.description)}${manualBadge}${pendingBadge}</div>
          <div class="sup-acct">${esc(sc.accounts?.name||'—')}${dest?` <span class="sup-arrow">→</span> ${esc(dest.name)}`:''}</div>
        </div>
        <div class="sup-right">
          <span class="sup-amt ${isExp?'neg':'pos'}">${isExp?'−':'+'}${fmt(Math.abs(Number(sc.amount)||0))}</span>
          <div class="sup-actions">
            <button class="sup-ignore-btn" title="Ignorar" onclick="event.stopPropagation();ignoreOccurrence('${sc.id}','${date}')">✕</button>
            <button class="sup-register-btn" onclick="openRegisterOcc('${sc.id}','${date}')">✓</button>
          </div>
        </div>
      </div>`;
    }).join('');

    const dayNum = new Date(date+'T12:00:00').getDate();
    const dayMon = new Date(date+'T12:00:00').toLocaleString('pt-BR',{month:'short'}).replace('.','');
    const dayPill = isToday
      ? `<div class="sup-day-pill sup-day-pill--today"><span>Hoje</span></div>`
      : isTomorrow
      ? `<div class="sup-day-pill sup-day-pill--tmrw"><span>Amanhã</span></div>`
      : `<div class="sup-day-pill"><span class="sup-day-num">${dayNum}</span><span class="sup-day-mon">${dayMon}</span></div>`;

    return `<div class="sup-group">
      <div class="sup-group-hdr">
        <div class="sup-group-left">
          ${dayPill}
          <span class="sup-group-dow">${dow}</span>
        </div>
        <div class="sup-group-meta">
          <span class="sup-day-total ${dayTot>=0?'pos':'neg'}">${dayTot>=0?'+':''}${fmt(dayTot)}</span>
          <span class="sup-day-count">${items.length}</span>
        </div>
      </div>
      <div class="sup-rows">${rows}</div>
    </div>`;
  }).join('');
}
