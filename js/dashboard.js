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

function _dashRenderIcon(iconKey, color, size){
  try {
    if (typeof renderIconEl === 'function') return renderIconEl(iconKey, color, size);
  } catch(_) {}
  return `<span style="font-size:${size || 18}px">🏦</span>`;
}

function _dashRenderChart(id, type, labels, datasets, extraOptions={}) {
  if (typeof renderChart === 'function') return renderChart(id, type, labels, datasets, extraOptions);
  const canvas = document.getElementById(id);
  const ctx = canvas?.getContext?.('2d');
  if (!ctx || typeof Chart === 'undefined') return null;
  state.chartInstances = state.chartInstances || {};
  if (state.chartInstances[id]) {
    try { state.chartInstances[id].destroy(); } catch(_) {}
  }
  state.chartInstances[id] = new Chart(ctx, {
    type,
    data: { labels, datasets },
    options: Object.assign({ responsive:true, maintainAspectRatio:true }, extraOptions || {})
  });
  return state.chartInstances[id];
}

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
    if (body) body.innerHTML = `<tr><td colspan="4" class="text-muted" style="text-align:center;padding:24px;font-size:.83rem">${t('dash.empty_tx')}</td></tr>`;
    return;
  }
  q = qFiltered;

  const { data: recent, error } = await q;
  if (error) { console.warn('[dashboard recent]', error.message); }

  const body = document.getElementById('recentTxBody');
  if (!body) return;

  const items = recent || [];
  if (!items.length) {
    body.innerHTML = `<tr><td colspan="4" class="text-muted" style="text-align:center;padding:24px;font-size:.83rem">${t('dash.empty_tx')}</td></tr>`;
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
// ── Shared patrimônio score badge updater ────────────────────────────────────
// Called both from loadDashboard (quick estimate) and _openPatrimonioModal (exact)
function _updatePatrimonioScoreBadge(patrimonioTotal, debtTotal, anchorEl) {
  // Replicate exact same formula as _openPatrimonioModal
  const accs         = Array.isArray(state.accounts) ? state.accounts : [];
  const liquidTotal  = accs
    .filter(a => !['investimento','cartao_credito'].includes(a.type) && (parseFloat(a.balance)||0) > 0)
    .reduce((s,a) => s + toBRL(parseFloat(a.balance)||0, a.currency||'BRL'), 0);
  const invTotal     = accs
    .filter(a => a.type === 'investimento')
    .reduce((s,a) => s + toBRL((a._totalPortfolioBalance ?? parseFloat(a.balance))||0, a.currency||'BRL'), 0);
  const cardNegTotal = accs
    .filter(a => a.type === 'cartao_credito' && (parseFloat(a.balance)||0) < 0)
    .reduce((s,a) => s + Math.abs(toBRL(parseFloat(a.balance)||0, a.currency||'BRL')), 0);
  const totalPassivos = cardNegTotal + (debtTotal || 0);
  const totalAtivos   = accs
    .filter(a => {
      const b = a.type === 'investimento'
        ? (a._totalPortfolioBalance ?? (parseFloat(a.balance)||0))
        : (parseFloat(a.balance)||0);
      return toBRL(b, a.currency||'BRL') > 0;
    })
    .reduce((s,a) => {
      const b = a.type === 'investimento'
        ? (a._totalPortfolioBalance ?? (parseFloat(a.balance)||0))
        : (parseFloat(a.balance)||0);
      return s + toBRL(b, a.currency||'BRL');
    }, 0);

  const endividamento = totalAtivos > 0 ? totalPassivos / totalAtivos : 0;
  const debtsArr      = typeof _dbt !== 'undefined' && _dbt.loaded ? _dbt.debts.filter(d=>(d.status||'active')==='active') : [];
  const healthScore   = Math.round(Math.max(0, Math.min(100,
    70 * (1 - Math.min(endividamento, 1)) +
    20 * ([liquidTotal > 0, invTotal > 0, debtsArr.length === 0].filter(Boolean).length / 3) +
    10 * (patrimonioTotal > 0 ? 1 : 0)
  )));

  const [hsLabel, hsBg, hsClr] = healthScore >= 80
    ? ['Excelente','rgba(16,185,129,.12)','#10b981']
    : healthScore >= 60 ? ['Bom','rgba(245,158,11,.12)','#f59e0b']
    : healthScore >= 40 ? ['Atenção','rgba(249,115,22,.12)','#f97316']
    : ['Crítico','rgba(239,68,68,.12)','#ef4444'];

  const anchor = anchorEl || document.getElementById('statTotal');
  if (!anchor) return;

  let badge = document.getElementById('dashPatrimonioScore');
  if (!badge) {
    badge = document.createElement('span');
    badge.id = 'dashPatrimonioScore';
    badge.style.cssText =
      'display:inline-flex;align-items:center;gap:3px;margin-left:8px;' +
      'padding:2px 8px;border-radius:20px;font-size:.65rem;font-weight:800;' +
      'letter-spacing:.04em;cursor:pointer;vertical-align:middle;' +
      'border:1px solid transparent;transition:all .2s';
    badge.title = 'Score de saúde patrimonial — clique para ver detalhes';
    badge.onclick = e => { e.stopPropagation(); _openPatrimonioModal(); };
    anchor.after(badge);
  }
  badge.textContent      = healthScore + ' ' + hsLabel;
  badge.style.background = hsBg;
  badge.style.color      = hsClr;
  badge.style.borderColor = hsClr + '33';
}
window._updatePatrimonioScoreBadge = _updatePatrimonioScoreBadge;


async function loadDashboard(){
  // Atualizar nome da família ativa no topo do dashboard
  try {
    const famNameEl = document.getElementById('dashFamilyNameText');
    if (famNameEl) {
      const fid = currentUser?.family_id;
      const name = (typeof _familyDisplayName === 'function' && fid)
        ? _familyDisplayName(fid, '')
        : (currentUser?.families?.[0]?.name || '');
      famNameEl.textContent = name || '—';
    }
  } catch(_e) {}

  // ── Saudação na barra de título do dashboard ────────────────────────────
  // Só exibe na primeira visita após login (_dashGreetingPending definido em updateUserUI)
  try {
    if (window._dashGreetingPending) {
      window._dashGreetingPending = false;
      const _h = new Date().getHours();
      const _greet = _h >= 5 && _h < 12 ? 'Bom dia'
                   : _h >= 12 && _h < 18 ? 'Boa tarde'
                   : _h >= 18 ? 'Boa noite' : 'Boa madrugada';
      const _uname = (currentUser?.name || '').split(' ')[0].trim();
      const _msg   = _uname ? `${_greet}, ${_uname}!` : `${_greet}!`;
      const _titleEl = document.querySelector('#page-dashboard .page-header-bar-title');
      if (_titleEl) {
        _titleEl.textContent = _msg;
        // Reverter para "Dashboard" após 12 segundos
        setTimeout(() => {
          const el = document.querySelector('#page-dashboard .page-header-bar-title');
          if (el && el.textContent !== 'Dashboard') el.textContent = 'Dashboard';
        }, 12000);
      }
      // Ocultar elemento legado (mantido no HTML mas não mais necessário)
      const _greetEl = document.getElementById('dashWelcomeMsg');
      if (_greetEl) _greetEl.style.display = 'none';
    }
  } catch(_e) {}

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

  let income = 0, expense = 0, total = 0, _pendCount = 0;
  let kpiResult = null;
  try {
    const [_kpi] = await Promise.all([
      DB.dashboard.loadKPIs(_dashMemberIds),
      fxPromise,
    ]);
    kpiResult = _kpi;
    if (kpiResult) {
      income = kpiResult.income || 0;
      expense = kpiResult.expense || 0;
      total = kpiResult.total || 0;
      _pendCount = kpiResult.pendingCount || 0;
    }
  } catch (kpiErr) {
    console.error('[dashboard] loadKPIs failed:', kpiErr?.message);
    // Show zeros rather than blank — user sees the page even if data failed
  }
  const statTotalEl = document.getElementById('statTotal');
  const statIncomeEl = document.getElementById('statIncome');
  const statExpensesEl = document.getElementById('statExpenses');
  const bal = income - expense;
  const balEl = document.getElementById('statBalance');

  if (statTotalEl){
    statTotalEl.textContent = dashFmt(total,'BRL');
    statTotalEl.className = 'stat-value ' + (total >= 0 ? 'amount-pos' : 'amount-neg');
    const _tc = statTotalEl.closest('.stat-card');
    if (_tc) {
      _tc.style.cursor = 'pointer';
      _tc.title = 'Ver composição do patrimônio';
      _tc.onclick = () => _openPatrimonioModal();
    }
    // ── Health score badge — computed after modal data is ready ────────
    // Use debtTotal from loadKPIs + accounts already in state for a quick estimate
    // then update with precise value from modal calculation once available
    _updatePatrimonioScoreBadge(total, kpiResult?.debtTotal ?? 0, statTotalEl);
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
  _renderDashForecast().catch(()=>{});
  await loadDashboardAutoRunSummary();
  // Carregar cards opcionais (budgets + investments + dreams) se habilitados
  _loadDashBudgetsCard().catch(() => {});
  _loadDashInvestmentsCard().catch(() => {});
  _loadDashDreamsCard().catch(() => {});
  _loadDashTopPayeesCard().catch(() => {});
  _loadDashLoyaltyCard().catch(() => {});

  // Render account balances grouped by account group
  (function renderAccountBalances() {
    const el = document.getElementById('accountBalancesList');
    if (!el) { console.warn('[dashboard] accountBalancesList not found'); return; }
    const accs = Array.isArray(state.accounts) ? state.accounts : [];
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
        // Confirmed-only balance line (hidden when equal to total balance)
        const _confBal = a.confirmed_balance;
        const _hasPending = (_confBal !== undefined) && (Math.abs(_confBal - a.balance) > 0.001);
        const _confIsNeg   = _confBal < 0;
        const _confLine    = _hasPending
          ? `<div class="dash-fav-card__confirmed ${_confIsNeg ? 'neg' : ''}">
               <span class="dash-fav-card__confirmed-label">confirmado</span>
               ${fmt(_confBal, a.currency)}
             </div>`
          : '';
        // Loyalty points — compact number shown LEFT of add button
        // Respects show_in_dash_fav flag. Returns points number only (no icon).
        const _loyProg = (typeof getLoyaltyBadgeProgId === 'function') && getLoyaltyBadgeProgId(a.id);
        const _loyPts  = _loyProg
          ? (() => {
              const p = (window._loy?.programs||[]).find(x => x.id === _loyProg);
              if (!p) return '';
              const n = p.points_balance || 0;
              // Compact format: 9.999.999 → "9,9M"  999.999 → "999k"  9.999 → "9.999"
              if (n >= 1000000) return (n/1000000).toFixed(1).replace('.',',') + 'M';
              if (n >= 100000)  return Math.round(n/1000) + 'k';
              return n.toLocaleString('pt-BR');
            })()
          : '';

        return `<div class="dash-fav-card" onclick="goToAccountTransactions('${a.id}')"
          style="--card-clr:${_cardColor}">
          <div class="dash-fav-card__top">
            <div class="dash-fav-card__icon">${_dashRenderIcon(a.icon,a.color,20)}</div>
            <span class="dash-fav-card__type">${esc(_typeLabel)}</span>
          </div>
          <div class="dash-fav-card__name">${esc(a.name)}</div>
          <div class="dash-fav-card__balance ${_isNeg ? 'neg' : ''}">${fmt(a.balance,a.currency)}</div>
          ${_confLine}
          ${_brlLine}
          <div class="dash-fav-card__spacer"></div>
          <div class="dash-fav-card__actions" onclick="event.stopPropagation()">
            ${_loyPts ? `<span class="dash-fav-pts" onclick="(function(){const p=typeof getLoyaltyBadgeProgId==='function'&&getLoyaltyBadgeProgId('${a.id}');if(p&&typeof openLoyaltyStatement==='function')openLoyaltyStatement(p);})()" title="Pontos de fidelidade — ver extrato">${_loyPts}</span>` : ''}
            <button class="dash-fav-card__btn dash-fav-card__btn--add"
              onclick="_dashFavAddTx('${a.id}')"
              title="Nova transação nesta conta">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            <button class="dash-fav-card__btn"
              onclick="_openFavAccountModal('${a.id}')"
              title="Informações da conta">
              <svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM9 9a1 1 0 0 0 0 2v3a1 1 0 0 0 2 0V9a1 1 0 0 0-1-1H9z" clip-rule="evenodd"/></svg>
            </button>
            <button class="dash-fav-card__btn"
              onclick="openConsolidateModal('${a.id}')"
              title="Consolidar saldo">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            </button>
          </div>
          <div class="dash-fav-card__shine"></div>
        </div>`;
      }
      // Standard row for non-favorites
      return `<div onclick="goToAccountTransactions('${a.id}')" style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid var(--border);cursor:pointer;transition:background .15s;border-radius:4px;margin:0 -4px;padding-left:4px;padding-right:4px" onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background=''">
        <div style="display:flex;align-items:center;gap:9px">${_dashRenderIcon(a.icon,a.color,20)}<span style="font-size:.92rem;font-weight:500;color:var(--text)">${esc(a.name)}</span></div>
        <span class="${a.balance<0?'text-red':'text-accent'}" style="font-size:.92rem;font-weight:700;font-family:var(--font-serif)">${fmt(a.balance,a.currency)}</span>
      </div>`;
    };

    // ── Build HTML ────────────────────────────────────────────────────────
    let html = '';

    // Favorites section — always at top if any exist, grouped by type
    if (favs.length) {
      // Group favorites: credit cards | checking+savings | others
      const favCC      = favs.filter(a => a.type === 'cartao_credito');
      const favCheck   = favs.filter(a => a.type === 'corrente' || a.type === 'poupanca');
      const favOthers  = favs.filter(a => !['cartao_credito','corrente','poupanca'].includes(a.type));

      const _favTypeSep = (items, label) => {
        if (!items.length) return '';
        const total = items.reduce((s,a) => s + toBRL(parseFloat(a.balance)||0, a.currency||'BRL'), 0);
        const isCC = label === 'Cartão de Crédito';
        // Use fmt() for consistency with rest of app (shows centavos, respects privacy mode)
        const totalFmt = fmt(Math.abs(total), 'BRL');
        const totalColor = total < 0 ? 'var(--red)' : isCC ? 'var(--red)' : 'var(--accent)';
        const icon = isCC ? '💳' : label.includes('Corrente') ? '🏦' : '📦';
        return `<div class="dash-fav-type-group">
          <div class="dash-fav-type-header">
            <span class="dash-fav-type-label">${icon} ${label}</span>
            <span class="dash-fav-type-total" style="color:${totalColor};font-family:var(--font-serif,monospace)">${isCC && total < 0 ? '−' : ''}${totalFmt}</span>
          </div>
          <div class="dash-favs-grid">${items.map(rowHtml).join('')}</div>
        </div>`;
      };

      // Desktop: type groups rendered as parallel columns
      // Mobile/tablet: stacked vertically (default)
      const _hasMultipleGroups = [favCC, favCheck, favOthers].filter(g => g.length).length > 1;
      const favHtml = (favCC.length || favCheck.length || favOthers.length)
        ? (_hasMultipleGroups
            ? `<div class="dash-fav-columns">${
                [
                  _favTypeSep(favCC, 'Cartão de Crédito'),
                  _favTypeSep(favCheck, 'Corrente / Poupança'),
                  _favTypeSep(favOthers, 'Outros')
                ].filter(Boolean).join('')
              }</div>`
            : _favTypeSep(favCC, 'Cartão de Crédito') +
              _favTypeSep(favCheck, 'Corrente / Poupança') +
              _favTypeSep(favOthers, 'Outros')
          )
        : `<div class="dash-favs-grid">${favs.map(rowHtml).join('')}</div>`;

      html += `<div class="dash-favs-section">${favHtml}</div>`;

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
    // member filter removed
  }

  // Render charts independently — failure in one must not block the other
  await Promise.all([
    renderCashflowChart(_dashMemberIds).catch(e => console.warn('[dashboard] cashflow:', e?.message)),
    renderCategoryChart().catch(e => console.warn('[dashboard] categoryChart:', e?.message)),
    renderDashCCInvoices().catch(e => console.warn('[dashboard] ccInvoices:', e?.message)),
  ]);
}
async function renderCashflowChart(memberIds = null){
  // Populate account filter (refresh every time dashboard loads)
  const sel = document.getElementById('cashflowAccountFilter');
  if(sel) {
    const curVal = sel.value;
    sel.innerHTML = `<option value="">${t('dash.all_accounts')}</option>` +
      (typeof _accountOptions === 'function'
        ? _accountOptions(state.accounts, null)
        : state.accounts.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join(''));
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
  // Store monthly data for drill-down
  window._cashflowMonthData = {};
  cashRows.forEach(r => { window._cashflowMonthData[r.label] = r; });

  const chartInst = _dashRenderChart('cashflowChart','bar',labels,[
    {label:'Receitas',data:incomes,backgroundColor:'rgba(42,122,74,.8)',borderRadius:6,borderSkipped:false,order:2},
    {label:'Despesas',data:expenses,backgroundColor:'rgba(192,57,43,.75)',borderRadius:6,borderSkipped:false,order:2},
    {label:'Saldo',data:balances,type:'line',borderColor:'#1e5ba8',backgroundColor:'rgba(30,91,168,.12)',borderWidth:2.5,pointRadius:4,pointBackgroundColor:'#1e5ba8',fill:true,tension:0.35,order:1},
  ],{
    onClick(evt, elements) {
      if (!elements.length) return;
      const idx    = elements[0].index;
      const label  = labels[idx];
      const dsIdx  = elements[0].datasetIndex;
      const isInc  = dsIdx === 0;
      const isExp  = dsIdx === 1;
      _dashCashflowDrill(label, isInc ? 'income' : isExp ? 'expense' : null);
    },
    onHover(evt, elements) { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; },
  });
}

async function _dashCashflowDrill(monthLabel, type) {
  const wrap  = document.getElementById('dashForecastChartWrap');
  const drill = document.getElementById('dashCashflowDrill');
  if (!wrap || !drill) return;

  drill.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:.82rem">⏳ Carregando…</div>';
  wrap.style.display = 'none';
  drill.style.display = 'block';

  // Parse month from label (e.g. "Jan/25" → 2025-01)
  const monthMap = {Jan:'01',Fev:'02',Mar:'03',Abr:'04',Mai:'05',Jun:'06',Jul:'07',Ago:'08',Set:'09',Out:'10',Nov:'11',Dez:'12'};
  const parts = monthLabel.split('/');
  const monthNum = monthMap[parts[0]] || '01';
  const yearFull = parts[1] ? (parseInt(parts[1]) < 50 ? '20'+parts[1] : '19'+parts[1]) : new Date().getFullYear();
  const from = `${yearFull}-${monthNum}-01`;
  const lastDay = new Date(parseInt(yearFull), parseInt(monthNum), 0).getDate();
  const to = `${yearFull}-${monthNum}-${String(lastDay).padStart(2,'0')}`;

  try {
    let q = famQ(sb.from('transactions')
      .select('id,date,description,amount,accounts!transactions_account_id_fkey(name),categories(name,color)'))
      .gte('date', from).lte('date', to).order('date',{ascending:false});
    if (type === 'income')  q = q.gt('amount', 0);
    if (type === 'expense') q = q.lt('amount', 0);
    const { data: txs } = await q;

    const typeLabel = type === 'income' ? 'Receitas' : type === 'expense' ? 'Despesas' : 'Tudo';
    const total = (txs||[]).reduce((s,t) => s + Math.abs(Number(t.amount)||0), 0);

    drill.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:6px">
        <div>
          <span style="font-size:.88rem;font-weight:700;color:var(--text)">${monthLabel} · ${typeLabel}</span>
          <span style="font-size:.72rem;color:var(--muted);margin-left:8px">${(txs||[]).length} transações · ${fmt(total)}</span>
        </div>
        <button onclick="document.getElementById('dashCashflowDrill').style.display='none';document.getElementById('dashForecastChartWrap').style.display=''"
          style="display:flex;align-items:center;gap:4px;font-size:.75rem;font-weight:700;padding:4px 10px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--muted);cursor:pointer">
          ← Voltar ao gráfico
        </button>
      </div>
      <div style="display:flex;flex-direction:column;gap:3px;max-height:220px;overflow-y:auto">
        ${(txs||[]).length ? (txs||[]).map(t => {
          const isNeg = t.amount < 0;
          const catColor = t.categories?.color || (isNeg ? 'var(--red)' : 'var(--green)');
          return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--surface2);border-radius:7px;cursor:pointer;transition:background .12s"
            onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background='var(--surface2)'"
            onclick="if(typeof openTransactionEdit==='function')openTransactionEdit('${t.id}')">
            <div style="width:6px;height:6px;border-radius:50%;background:${catColor};flex-shrink:0"></div>
            <div style="flex:1;min-width:0">
              <div style="font-size:.78rem;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.description||'—')}</div>
              <div style="font-size:.65rem;color:var(--muted)">${t.date}${t.accounts?.name?' · '+esc(t.accounts.name):''}</div>
            </div>
            <span style="font-size:.8rem;font-weight:700;flex-shrink:0;color:${isNeg?'var(--red,#c0392b)':'var(--green,#2a7a4a)'}">
              ${isNeg?'−':'+'}${fmt(Math.abs(Number(t.amount)||0))}
            </span>
          </div>`;
        }).join('') : '<div style="text-align:center;padding:20px;color:var(--muted);font-size:.82rem">Nenhuma transação</div>'}
      </div>`;
  } catch(e) {
    drill.innerHTML = `<div style="color:var(--red,#dc2626);padding:12px;font-size:.8rem">Erro: ${esc(e.message)}</div>
      <button onclick="document.getElementById('dashCashflowDrill').style.display='none';document.getElementById('dashForecastChartWrap').style.display=''"
        style="margin-top:8px;padding:5px 12px;border:1px solid var(--border);border-radius:7px;background:var(--surface);cursor:pointer;font-size:.78rem">
        ← Voltar
      </button>`;
  }
}
window._dashCashflowDrill = _dashCashflowDrill;
// ─── Category chart: rich palette + click-to-drill ───────────────────────
// Stores raw transaction data so click handler can filter without re-fetching
let _catChartType    = 'bar'; // 'bar' | 'doughnut' — declared early to avoid TDZ
let _catChartRawData = [];   // [{name, color, brl, t}]
let _catChartEntries = [];   // [{name, total, color, txs}]

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
  const _txSelect = 'id,date,description,amount,brl_amount,currency,account_id,category_id,categories(id,name,color),payees(name),accounts!transactions_account_id_fkey(name)';
  const _lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const _dateGte = `${y}-${m}-01`, _dateLte = `${y}-${m}-${String(_lastDay).padStart(2,'0')}`;

  // Build expense query (amount < 0)
  const qExp = famQ(sb.from('transactions').select(_txSelect))
    .gte('date',_dateGte).lte('date',_dateLte).lt('amount',0).not('category_id','is',null);
  // Build income query (amount > 0)
  const qInc = famQ(sb.from('transactions').select(_txSelect))
    .gte('date',_dateGte).lte('date',_dateLte).gt('amount',0).not('category_id','is',null);

  const [{data}, {data: dataInc}] = await Promise.all([qExp, qInc]);

  // Build parent lookup from state.categories (already loaded, has parent_id)
  const allCats = state.categories || [];
  const catById = Object.fromEntries(allCats.map(c => [c.id, c]));
  function _getRootCat(tx) {
    // Start from the category_id on the transaction (not the join, to avoid nested FK issues)
    const startId = tx.category_id;
    if (!startId) return { name: 'Outros', color: '', id: null };
    let cur = catById[startId];
    if (!cur) {
      // Fallback: use join data if state doesn't have it yet
      return { name: tx.categories?.name || 'Outros', color: tx.categories?.color || '', id: startId };
    }
    while (cur.parent_id && catById[cur.parent_id]) {
      cur = catById[cur.parent_id];
    }
    return { name: cur.name, color: cur.color || '', id: cur.id };
  }

  const catMap={};
  (data||[]).forEach(t=>{
    const root = _getRootCat(t);
    const n = root.name;
    const rawColor = root.color;
    if(!catMap[n]) catMap[n]={rawColor, txs:[], total:0, rootId: root.id};
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
      rootId: v.rootId,
    }));

  // Build income category entries (same logic, positive amounts)
  const incMap = {};
  (dataInc||[]).forEach(t => {
    const root = _getRootCat(t);
    const n = root.name, rawColor = root.color;
    if (!incMap[n]) incMap[n] = {rawColor, txs:[], total:0, rootId:root.id};
    const brl = t.brl_amount != null ? Math.abs(t.brl_amount) : toBRL(Math.abs(t.amount), t.currency||'BRL');
    incMap[n].total += brl;
    incMap[n].txs.push({...t, _brl:brl});
  });
  const _incColors = new Set();
  window._catChartIncEntries = Object.entries(incMap)
    .sort((a,b)=>b[1].total-a[1].total).slice(0,8)
    .map(([name,v],i)=>({ name, total:v.total, color:_catColor(v.rawColor,i,_incColors), txs:v.txs.sort((a,b)=>b._brl-a._brl), rootId:v.rootId }));

  // Cache both for mode toggle
  window._catChartExpEntriesRaw = [..._catChartEntries];
  window._catChartIncEntriesRaw = [...(window._catChartIncEntries||[])];

  if(!_catChartEntries.length){
    const el=document.getElementById('categoryChart');
    if(el){const ctx=el.getContext('2d');ctx.clearRect(0,0,el.width,el.height);ctx.fillStyle='#8c8278';ctx.textAlign='center';ctx.font='13px Outfit';ctx.fillText(t('dash.empty_tx'),el.width/2,el.height/2);}
  }

  closeCatDetail(); // reset any open detail

  // Restore expense/income mode from prefs (persists across reloads)
  const savedMode = _dashGetPrefs()?.catChartMode || 'expense';
  if (savedMode === 'income') {
    _catChartEntries = window._catChartIncEntries || _catChartEntries;
  } else {
    _catChartEntries = window._catChartExpEntriesRaw || _catChartEntries;
  }
  const expBtn = document.getElementById('dashCatModeExp');
  const incBtn = document.getElementById('dashCatModeInc');
  if (expBtn) expBtn.classList.toggle('active', savedMode === 'expense');
  if (incBtn) incBtn.classList.toggle('active', savedMode === 'income');

  // Ensure chart controls + type toggle are visible (may have been hidden by openCatDetail)
  const dashCatControls = document.getElementById('dashCatControls');
  const catChartWrap    = document.getElementById('catChartWrap');
  const typeTogglePar   = document.querySelector('#catChartCard > div:last-child');
  if (dashCatControls) dashCatControls.style.display = '';
  if (catChartWrap)    catChartWrap.style.display    = '';
  if (typeTogglePar && typeTogglePar.querySelector('.dash-cat-toggle'))
    typeTogglePar.style.display = '';

  // Restore chart type from prefs
  const savedType = _dashGetPrefs()?.catChartType || 'bar';
  _catChartType = savedType;
  const pie = document.getElementById('catChartTypePie');
  const bar = document.getElementById('catChartTypeBar');
  if (pie) pie.classList.toggle('active', savedType === 'doughnut');
  if (bar) bar.classList.toggle('active', savedType === 'bar');

// ── _renderCatChartBar: horizontal bar chart from _catChartEntries ───────────

  if (_catChartType === 'bar') {
    _renderCatChartBar();
    return;
  }

  _renderCatChartDoughnut();
}

function _renderCatChartBar() {
  const canvas = document.getElementById('categoryChart');
  if (!canvas) return;

  const entries = _catChartEntries.slice(0, 16); // max 16 bars for readability
  const labels  = entries.map(e => e.name);
  const data    = entries.map(e => e.total);
  const colors  = entries.map(e => e.color || '#2a6049');

  const usedColors = new Set(colors);

  if (state.chartInstances && state.chartInstances['categoryChart']) {
    try { state.chartInstances['categoryChart'].destroy(); } catch(_) {}
  }
  state.chartInstances = state.chartInstances || {};

  const ctx = canvas.getContext('2d');
  state.chartInstances['categoryChart'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors.map(c => c + 'cc'),
        borderColor:     colors,
        borderWidth:     1.5,
        borderRadius:    4,
        borderSkipped:   false,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => '  ' + (typeof fmt === 'function' ? fmt(ctx.parsed.x) : ctx.parsed.x),
          },
        },
      },
      onClick(evt, elements) {
        if (!elements.length) return;
        openCatDetail(elements[0].index);
      },
      onHover(evt, elements) {
        evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
      },
      scales: {
        x: {
          ticks: {
            font: { size: 10 },
            color: '#8c8278',
            callback: v => typeof dashFmt === 'function' ? dashFmt(v) : v,
          },
          grid: { color: '#e8e4de22' },
        },
        y: {
          ticks: {
            font: { size: 11 },
            color: 'var(--text)',
            callback(val) {
              const label = this.getLabelForValue(val);
              return label && label.length > 18 ? label.slice(0, 17) + '…' : label;
            },
          },
          grid: { display: false },
        },
      },
    },
  });
  // Adjust canvas height based on entry count
  canvas.style.height = Math.max(160, entries.length * 28) + 'px';
}
window._renderCatChartBar       = _renderCatChartBar;

function _renderCatChartDoughnut() {
  const canvas = document.getElementById('categoryChart');
  if (!canvas) return;

  const entries = _catChartEntries.slice(0, 12);
  const labels  = entries.map(e => e.name);
  const data    = entries.map(e => e.total);
  const colors  = entries.map(e => e.color || '#2a6049');

  if (state.chartInstances && state.chartInstances['categoryChart']) {
    try { state.chartInstances['categoryChart'].destroy(); } catch(_) {}
  }
  state.chartInstances = state.chartInstances || {};

  canvas.style.height = '220px';
  const ctx = canvas.getContext('2d');
  state.chartInstances['categoryChart'] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors.map(c => c + 'cc'),
        borderColor:     '#fff',
        borderWidth:     2,
        hoverBorderWidth: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: {
          position: 'right',
          labels: {
            boxWidth: 10,
            font: { size: 11 },
            color: 'var(--text)',
            padding: 10,
          },
        },
        tooltip: {
          callbacks: {
            label: ctx => ' ' + ctx.label + ': ' + (typeof fmt === 'function' ? fmt(ctx.parsed) : ctx.parsed),
          },
        },
      },
      onClick(evt, elements) {
        if (!elements.length) return;
        openCatDetail(elements[0].index);
      },
      onHover(evt, elements) {
        evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
      },
    },
  });
}
window._renderCatChartDoughnut  = _renderCatChartDoughnut;


function openCatDetail(idx) {
  const entry = _catChartEntries[idx];
  if (!entry) return;

  const detailEl   = document.getElementById('catChartDetail');
  const titleEl    = document.getElementById('catChartDetailTitle');
  const listEl     = document.getElementById('catChartDetailList');
  const backBtn    = document.getElementById('catDetailBackBtn');
  const wrap       = document.getElementById('catChartWrap');
  const chartControls = document.getElementById('dashCatControls');
  const typeToggle    = document.querySelector('#catChartCard > div:last-child');

  if (!detailEl || !titleEl || !listEl) return;

  // Hide chart + mode controls, show back button + transaction list
  if (wrap)          wrap.style.display = 'none';
  if (chartControls) chartControls.style.display = 'none';
  if (typeToggle && typeToggle.querySelector('.dash-cat-toggle')) typeToggle.style.display = 'none';
  if (backBtn)       backBtn.style.display = 'flex';
  detailEl.style.display = '';

  const dot = `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${entry.color};flex-shrink:0"></span>`;
  titleEl.innerHTML = `${dot}<strong>${esc(entry.name)}</strong><span style="color:var(--muted);font-weight:400;font-size:.72rem;margin-left:4px">${fmt(entry.total)}</span><span style="color:var(--muted);font-weight:400;font-size:.72rem;margin-left:4px">· ${entry.txs.length} lançamento${entry.txs.length!==1?'s':''}`;

  // "Ver transações" button — navigates to transactions page with category pre-filtered
  const now2 = new Date();
  const ym = `${now2.getFullYear()}-${String(now2.getMonth()+1).padStart(2,'0')}`;
  titleEl.innerHTML += `&nbsp;<button onclick="_dashDrillToTx('${entry.rootId||''}','${ym}')" style="font-size:.68rem;padding:2px 7px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--accent);cursor:pointer;font-weight:600;margin-left:6px">${t('dash.view_all')}</button>`;

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
  const detailEl    = document.getElementById('catChartDetail');
  const backBtn     = document.getElementById('catDetailBackBtn');
  const wrap        = document.getElementById('catChartWrap');
  const chartControls = document.getElementById('dashCatControls');
  const typeToggle    = document.querySelector('#catChartCard > div:last-child');

  if (detailEl)       detailEl.style.display = 'none';
  if (backBtn)        backBtn.style.display  = 'none';
  if (wrap)           wrap.style.display = '';
  if (chartControls)  chartControls.style.display = '';
  if (typeToggle && typeToggle.querySelector('.dash-cat-toggle')) typeToggle.style.display = '';

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
  { id: 'accounts',     label: 'Saldo por Conta',           icon: '🏦', sub: 'Saldo atual de cada conta',                 el: 'dashCardAccounts'     },
  { id: 'charts',       label: 'Fluxo de Caixa e Gráficos', icon: '📊', sub: 'Cashflow 6 meses + gráfico de despesas',    el: 'dashCardCharts'       },
  { id: 'favcats',      label: 'Categorias Favoritas',      icon: '⭐', sub: 'Evolução das categorias marcadas',          el: 'dashCardFavCats'      },
  { id: 'upcoming',     label: 'Próximas Transações',       icon: '📆', sub: 'Programadas para os próximos 10 dias',      el: 'dashCardUpcoming'     },
  { id: 'ccinvoices',   label: 'Próximas Faturas',          icon: '💳', sub: 'Próximo pagamento de cada cartão',          el: 'dashCardCCInvoices',  optional: true },
  { id: 'forecast90',   label: 'Previsão 90 dias',          icon: '📈', sub: 'Projeção de saldo para os próximos 90 dias',el: 'dashCardForecast90'   },
  { id: 'recent',       label: 'Últimas Transações',        icon: '🧾', sub: 'Histórico recente de lançamentos',          el: 'dashCardRecent'       },
  { id: 'budgets',      label: 'Orçamentos do Mês',         icon: '🎯', sub: 'Progresso dos orçamentos mensais',          el: 'dashCardBudgets',     optional: true },
  { id: 'investments',  label: 'Carteira de Investimentos', icon: '📈', sub: 'Resumo e distribuição da carteira',         el: 'dashCardInvestments', optional: true },
  { id: 'dreams',       label: 'Meus Sonhos',               icon: '🌟', sub: 'Progresso dos seus sonhos financeiros',     el: 'dashCardDreams',      optional: true },
  { id: 'toppayees',    label: 'Top Beneficiários',         icon: '🏪', sub: 'Quem mais recebe seus pagamentos',          el: 'dashCardTopPayees',   optional: true },
  { id: 'loyalty',      label: 'Programas de Fidelidade',   icon: '⭐', sub: 'Saldo de pontos de cada programa',          el: 'dashCardLoyalty',     optional: true },
];

function _dashGetPrefs() {
  const key = _DASH_PREFS_KEY();
  // 1. Check Supabase cache (_appSettingsCache loaded at login)
  if (typeof _appSettingsCache !== 'undefined' && _appSettingsCache &&
      _appSettingsCache[key] && typeof _appSettingsCache[key] === 'object') {
    const cached = _appSettingsCache[key];
    try { localStorage.setItem(key, JSON.stringify(cached)); } catch {}
    return cached;
  }
  // 2. Fallback: localStorage (inject defaults for newly added optional cards)
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const saved = JSON.parse(raw);
      _DASH_CARDS.forEach(c => { if (!(c.id in saved)) saved[c.id] = !c.optional; });
      return saved;
    }
  } catch (_e) {}
  return Object.fromEntries(_DASH_CARDS.map(c => [c.id, !c.optional]));
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
      // Inject defaults for optional cards added after the user's prefs were saved
      const merged = Object.assign({}, data.value);
      _DASH_CARDS.forEach(c => {
        if (!(c.id in merged)) {
          // New card not yet in saved prefs — use default
          // Check localStorage first in case user just saved it this session
          merged[c.id] = !c.optional;
        }
      });
      _dashSavePrefs(merged);
      _dashApplyPrefs(merged);
      _renderDashFavCategories(_lastDashIncome, _lastDashExpense);
      // Load optional cards that are now enabled
      if (merged.loyalty !== false) _loadDashLoyaltyCard().catch(()=>{});
    }
  } catch (e) { console.warn('[dashPrefs] sync exception:', e.message); }
}

function _dashApplyPrefs(prefs) {
  const order = _getDashCardOrder(prefs);
  const pairs = Array.isArray(prefs._pairs) ? prefs._pairs : [];

  // Build fast lookup: cardId → paired partner id
  const pairedWith = {};
  pairs.forEach(([a, b]) => { pairedWith[a] = b; pairedWith[b] = a; });
  const pairedSeconds = new Set(pairs.map(p => p[1]));

  // Apply visibility
  order.forEach(c => {
    const el = document.getElementById(c.el);
    if (!el) return;
    el.style.display = prefs[c.id] !== false ? '' : 'none';
  });

  // Apply DOM order with side-by-side pair support
  try {
    let parent = null;
    for (const c of order) {
      const el = document.getElementById(c.el);
      if (el) { parent = el.parentElement; break; }
    }
    if (!parent) return;

    // Remove any existing pair wrappers (move children out first)
    parent.querySelectorAll('.dash-pair-wrap').forEach(wrap => {
      while (wrap.firstChild) parent.insertBefore(wrap.firstChild, wrap);
      wrap.remove();
    });

    // Re-attach in order, wrapping pairs
    const processedSeconds = new Set();
    order.forEach(c => {
      const el = document.getElementById(c.el);
      if (!el) return;

      // Skip second-of-pair — handled when first is processed
      if (pairedSeconds.has(c.id) && processedSeconds.has(c.id)) return;

      const partnerId = pairs.find(p => p[0] === c.id)?.[1];
      const partnerCard = partnerId ? _DASH_CARDS.find(x => x.id === partnerId) : null;
      const partnerEl   = partnerCard ? document.getElementById(partnerCard.el) : null;

      const firstVisible  = prefs[c.id] !== false;
      const secondVisible = partnerCard && prefs[partnerCard.id] !== false;

      if (partnerId && partnerEl && firstVisible && secondVisible) {
        // Both visible — wrap in grid
        const wrap = document.createElement('div');
        wrap.className = 'dash-pair-wrap';
        // Remove mb-4/mb-6 temporarily handled by CSS
        parent.appendChild(wrap);
        wrap.appendChild(el);
        wrap.appendChild(partnerEl);
        processedSeconds.add(partnerId);
      } else {
        // Single card — append normally
        parent.appendChild(el);
        if (partnerId) processedSeconds.add(partnerId);
      }
    });
  } catch(e) { console.warn('[dashApplyPrefs pairs]', e.message); }
}

function openDashCustomModal() {
  const prefs = _dashGetPrefs();
  const order = _getDashCardOrder(prefs);
  const list  = document.getElementById('dashCustomList');
  if (!list) return;
  _renderDashCustomList(order, prefs);
  openModal('dashCustomModal');
}

function _getDashCardOrder(prefs) {
  // Use saved order from prefs, fallback to _DASH_CARDS default order
  const savedOrder = prefs._order;
  let ordered;
  if (savedOrder && Array.isArray(savedOrder)) {
    ordered = savedOrder
      .map(id => _DASH_CARDS.find(c => c.id === id))
      .filter(Boolean);
    // Append any new cards not in saved order
    _DASH_CARDS.forEach(c => { if (!ordered.find(x => x.id === c.id)) ordered.push(c); });
  } else {
    ordered = [..._DASH_CARDS];
  }
  // 'accounts' (Saldo por Conta) is always pinned as the first card
  const accountsIdx = ordered.findIndex(c => c.id === 'accounts');
  if (accountsIdx > 0) {
    const [accounts] = ordered.splice(accountsIdx, 1);
    ordered.unshift(accounts);
  }
  return ordered;
}

function _renderDashCustomList(order, prefs) {
  const list = document.getElementById('dashCustomList');
  if (!list) return;

  const pairs = Array.isArray(prefs._pairs) ? prefs._pairs : [];
  // Build set of ids that are the FIRST of a pair
  const pairedFirst = new Set(pairs.map(p => p[0]));
  // Build set of ids that are the SECOND of a pair (they show a "paired" indicator)
  const pairedSecond = new Set(pairs.map(p => p[1]));

  list.innerHTML = order.map((c, idx) => {
    const isPinned    = c.id === 'accounts';
    const isFirst     = pairedFirst.has(c.id);
    const isSecond    = pairedSecond.has(c.id);
    const isPaired    = isFirst || isSecond;
    const canPair     = !isPinned && idx < order.length - 1 && !isSecond;
    const nextCard    = order[idx + 1];

    return `
    <div class="dcc-item${isPinned?' dcc-item--pinned':''}${isPaired?' dcc-item--paired':''}" data-card-id="${c.id}" draggable="${isPinned?'false':'true'}">
      <div class="dcc-handle" title="${isPinned?'Card fixo — sempre o primeiro':'Arrastar para reordenar'}"
        style="${isPinned?'opacity:.3;cursor:default;pointer-events:none;':''}">
        ${isPinned
          ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`
          : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`
        }
      </div>
      <span class="dcc-icon">${c.icon}</span>
      <div class="dcc-info">
        <div class="dcc-label">${c.label}</div>
        <div class="dcc-sub">${c.sub}</div>
        ${isPinned ? '<span class="dcc-badge" style="background:rgba(42,96,73,.12);color:#2a6049;border-color:rgba(42,96,73,.2)">📌 fixo</span>' : ''}
        ${c.optional && !isPinned ? '<span class="dcc-badge">opcional</span>' : ''}
        ${isFirst ? `<span class="dcc-badge dcc-badge--paired">⊞ lado a lado com ${nextCard?.icon||''} ${nextCard?.label||''}</span>` : ''}
        ${isSecond ? '<span class="dcc-badge dcc-badge--paired">⊞ em paralelo</span>' : ''}
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        ${canPair ? `<button class="dcc-pair-btn${isFirst?' dcc-pair-btn--on':''}" data-card="${c.id}" data-next="${nextCard?.id||''}"
          onclick="event.stopPropagation();_dashTogglePair('${c.id}','${nextCard?.id||''}')"
          title="${isFirst?'Desfazer layout lado a lado':'Colocar em paralelo com o próximo card'}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <rect x="2" y="3" width="9" height="18" rx="2"/>
            <rect x="13" y="3" width="9" height="18" rx="2"/>
          </svg>
        </button>` : ''}
        <button class="dcc-toggle ${prefs[c.id]!==false?'dcc-on':''}" data-card="${c.id}"
          onclick="event.stopPropagation();_dashToggleCard('${c.id}',this.closest('.dcc-item'))"
          title="${prefs[c.id]!==false?'Ocultar card':'Mostrar card'}"
          ${isPinned?'disabled style="opacity:.5;cursor:default"':''}>
          <span class="dcc-toggle-knob"></span>
        </button>
      </div>
    </div>`; }).join('');

  _initDashDrag(list);
}

function _initDashDrag(list) {
  // ── Suporte a Mouse (HTML5 DnD) ──────────────────────────────────────────
  // Fix: pointer-events:none on the dragging item breaks HTML5 DnD on desktop.
  // Solution: use a CSS class that only changes visual appearance (opacity/shadow)
  // WITHOUT pointer-events:none — the browser needs to keep pointer events active
  // on the source element throughout the drag operation.
  let dragSrc = null;

  list.querySelectorAll('.dcc-item').forEach(item => {
    item.addEventListener('dragstart', e => {
      if (item.dataset.cardId === 'accounts') { e.preventDefault(); return; }
      dragSrc = item;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', item.dataset.cardId);
      // Delay adding class so the browser can capture the drag image first
      requestAnimationFrame(() => item.classList.add('dcc-dragging'));
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('dcc-dragging');
      list.querySelectorAll('.dcc-item').forEach(i => i.classList.remove('dcc-over'));
      dragSrc = null;
      _dashCustomPendingOrder = [...list.querySelectorAll('.dcc-item')].map(i => i.dataset.cardId);
    });

    item.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dragSrc && item !== dragSrc) {
        list.querySelectorAll('.dcc-item').forEach(i => i.classList.remove('dcc-over'));
        item.classList.add('dcc-over');
      }
    });

    item.addEventListener('dragleave', e => {
      // Only remove highlight if truly leaving the item (not entering a child)
      if (!item.contains(e.relatedTarget)) {
        item.classList.remove('dcc-over');
      }
    });

    item.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      item.classList.remove('dcc-over');
      if (dragSrc && item !== dragSrc) {
        // Never allow dropping before or onto the pinned 'accounts' card
        if (item.dataset.cardId === 'accounts') return;
        const allItems = [...list.querySelectorAll('.dcc-item')];
        const srcIdx  = allItems.indexOf(dragSrc);
        const tgtIdx  = allItems.indexOf(item);
        if (srcIdx < tgtIdx) item.after(dragSrc);
        else item.before(dragSrc);
        // Ensure accounts stays first in the pending order
        const newOrder = [...list.querySelectorAll('.dcc-item')].map(i => i.dataset.cardId);
        const accIdx = newOrder.indexOf('accounts');
        if (accIdx > 0) { newOrder.splice(accIdx, 1); newOrder.unshift('accounts'); }
        _dashCustomPendingOrder = newOrder;
      }
    });
  });

  // Container-level dragover — needed so the browser registers the list as a valid
  // drop target even between items (prevents the "not allowed" cursor glitch)
  list.addEventListener('dragover', e => { e.preventDefault(); });
  list.addEventListener('drop',     e => { e.preventDefault(); });

  // ── Suporte a Touch (iOS Safari + Android) ──────────────────────────────
  // HTML5 DnD não funciona em touch — implementar via touchstart/touchmove/touchend
  let touchSrc    = null;
  let touchClone  = null;
  let touchStartY = 0;
  let touchOffY   = 0;

  function _getItemAtY(y) {
    // Encontrar o dcc-item sob a coordenada Y ignorando o clone
    const items = [...list.querySelectorAll('.dcc-item:not(.dcc-dragging)')];
    for (const it of items) {
      const r = it.getBoundingClientRect();
      if (y >= r.top && y <= r.bottom) return it;
    }
    return null;
  }

  // Detecção de eixo para não bloquear scroll vertical até confirmar drag
  let _dccTouchStartX = 0;
  let _dccAxis        = null; // null | 'drag' | 'scroll'
  const DRAG_THRESHOLD = 6; // px de movimento vertical para confirmar drag

  list.querySelectorAll('.dcc-item').forEach(item => {
    item.addEventListener('touchstart', e => {
      // Pinned card cannot be dragged
      if (item.dataset.cardId === 'accounts') return;
      // Só iniciar drag se o toque for no handle ou no item fora do toggle
      const tog = e.target.closest('.dcc-toggle');
      if (tog) return;

      // Registrar ponto de início — ainda NÃO chamar preventDefault
      // (seria passive:false desnecessário que bloqueia scroll imediatamente)
      touchSrc     = item;
      touchStartY  = e.touches[0].clientY;
      _dccTouchStartX = e.touches[0].clientX;
      _dccAxis     = null; // aguardar confirmação de eixo

      const rect = item.getBoundingClientRect();
      touchOffY  = touchStartY - rect.top;
    }, { passive: true }); // passive:true — não bloquear scroll no touchstart

    item.addEventListener('touchmove', e => {
      if (!touchSrc) return;

      const t  = e.touches[0];
      const dy = Math.abs(t.clientY - touchStartY);
      const dx = Math.abs(t.clientX - _dccTouchStartX);

      // Fase de detecção de eixo
      if (_dccAxis === null) {
        if (dy < DRAG_THRESHOLD && dx < DRAG_THRESHOLD) return; // aguardar
        // Movimento horizontal dominante = scroll lateral (não é drag de reorder)
        // Movimento vertical dominante = drag de reorder
        _dccAxis = dy >= dx ? 'drag' : 'scroll';
      }

      // Eixo scroll → abandonar, deixar scroll livre
      if (_dccAxis === 'scroll') {
        touchSrc = null; _dccAxis = null;
        return;
      }

      // Eixo drag confirmado — agora sim bloquear scroll e criar clone
      e.preventDefault();

      if (!touchClone) {
        // Criar clone apenas quando drag é confirmado (primeira vez aqui)
        const rect = item.getBoundingClientRect();
        touchClone = item.cloneNode(true);
        touchClone.style.cssText = [
          'position:fixed',
          'z-index:9999',
          'pointer-events:none',
          'left:' + rect.left + 'px',
          'width:' + rect.width + 'px',
          'top:'  + (touchStartY - touchOffY) + 'px',
          'opacity:.85',
          'box-shadow:0 8px 28px rgba(0,0,0,.22)',
          'border-radius:10px',
          'transform:scale(1.02)',
          'transition:none',
        ].join(';');
        document.body.appendChild(touchClone);
        item.classList.add('dcc-dragging');
      }

      const y = t.clientY;
      touchClone.style.top = (y - touchOffY) + 'px';

      // Highlight do item alvo
      const over = _getItemAtY(y);
      list.querySelectorAll('.dcc-item').forEach(i => i.classList.remove('dcc-over'));
      if (over && over !== touchSrc) over.classList.add('dcc-over');

    }, { passive: false }); // passive:false necessário para preventDefault no drag

    item.addEventListener('touchend', e => {
      if (!touchSrc) return;

      // Remover clone se foi criado
      if (touchClone) { touchClone.remove(); touchClone = null; }

      // Só reordenar se drag foi de facto confirmado (clone chegou a existir)
      if (_dccAxis === 'drag') {
        const y = e.changedTouches[0].clientY;
        const over = _getItemAtY(y);
        if (over && over !== touchSrc) {
          const allItems = [...list.querySelectorAll('.dcc-item')];
          const srcIdx = allItems.indexOf(touchSrc);
          const tgtIdx = allItems.indexOf(over);
          if (srcIdx < tgtIdx) over.after(touchSrc);
          else over.before(touchSrc);
        }
        _dashCustomPendingOrder = [...list.querySelectorAll('.dcc-item')].map(i => i.dataset.cardId);
      }

      touchSrc.classList.remove('dcc-dragging');
      list.querySelectorAll('.dcc-item').forEach(i => i.classList.remove('dcc-over'));
      touchSrc = null; _dccAxis = null;
    });

    item.addEventListener('touchcancel', () => {
      if (touchClone) { touchClone.remove(); touchClone = null; }
      if (touchSrc)   { touchSrc.classList.remove('dcc-dragging'); touchSrc = null; }
      list.querySelectorAll('.dcc-item').forEach(i => i.classList.remove('dcc-over'));
      _dccAxis = null;
    });
  });
}

function _dashMoveCard(id, dir) {
  const prefs = _dashGetPrefs();
  const order = _getDashCardOrder(prefs);
  const idx   = order.findIndex(c => c.id === id);
  if (idx < 0) return;
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= order.length) return;
  [order[idx], order[newIdx]] = [order[newIdx], order[idx]];
  // Temporarily store new order and re-render the list
  _dashCustomPendingOrder = order.map(c => c.id);
  const updPrefs = {...prefs, _order: _dashCustomPendingOrder};
  _renderDashCustomList(order, updPrefs);
}
let _dashCustomPendingOrder = null;

function _dashToggleCard(id, row) {
  const btn = row?.querySelector('.dcc-toggle');
  if (!btn) return;
  const isOn = btn.classList.toggle('dcc-on');
  btn.title = isOn ? 'Ocultar card' : 'Mostrar card';
}

// ── Toggle "vincular em paralelo" ────────────────────────────────────────
function _dashToggleLink(cardId, btn) {
  const prefs  = _dashGetPrefs();
  const linked = prefs._linked || {};
  linked[cardId] = !linked[cardId];
  if (!linked[cardId]) delete linked[cardId];
  if (Object.keys(linked).length) prefs._linked = linked;
  else delete prefs._linked;
  _dashSavePrefs(prefs);
  btn.classList.toggle('dcc-link-on', !!linked[cardId]);
  btn.title = linked[cardId] ? 'Desvincular do próximo card' : 'Lado a lado com próximo card (desktop)';
  _dashApplyLinkedCards(prefs);
}
window._dashToggleLink = _dashToggleLink;

function _dashApplyLinkedCards(prefs) {
  if (!prefs) prefs = _dashGetPrefs();
  const linked = prefs._linked || {};
  if (window.innerWidth < 900) return;
  const order = _getDashCardOrder(prefs);
  order.forEach((c, i) => {
    const el = document.getElementById(c.el);
    if (!el) return;
    if (!!linked[c.id] && prefs[c.id] !== false) el.style.gridColumn = '1';
    else if (i > 0 && !!linked[order[i-1]?.id] && prefs[c.id] !== false) el.style.gridColumn = '2';
    else el.style.gridColumn = '';
  });
}
window._dashApplyLinkedCards = _dashApplyLinkedCards;

function _dashTogglePair(firstId, secondId) {
  if (!firstId || !secondId) return;
  const prefs = _dashGetPrefs();
  const pairs = Array.isArray(prefs._pairs) ? [...prefs._pairs] : [];

  // Check if this pair already exists
  const existingIdx = pairs.findIndex(p => p[0] === firstId && p[1] === secondId);
  if (existingIdx >= 0) {
    // Remove pair
    pairs.splice(existingIdx, 1);
  } else {
    // Remove any existing pair involving either card, then add new
    const filtered = pairs.filter(p => p[0] !== firstId && p[1] !== firstId && p[0] !== secondId && p[1] !== secondId);
    filtered.push([firstId, secondId]);
    pairs.splice(0, pairs.length, ...filtered);
  }

  // Save to prefs immediately so re-render picks it up
  const updPrefs = { ...prefs, _pairs: pairs };
  const order = _getDashCardOrder(updPrefs);
  _renderDashCustomList(order, updPrefs);

  // Store pending pairs for save
  window._dashCustomPendingPairs = pairs;
}
window._dashTogglePair = _dashTogglePair;

function _dashCustomSave() {
  // Start from existing prefs so we don't lose catChartType, dashForecastAccounts, etc.
  const existingPrefs = _dashGetPrefs();
  const prefs = { ...existingPrefs };
  _DASH_CARDS.forEach(c => {
    const btn = document.querySelector(`.dcc-toggle[data-card="${c.id}"]`);
    prefs[c.id] = btn ? btn.classList.contains('dcc-on') : !c.optional;
  });
  // Save card order if user reordered — always enforce accounts as first
  if (_dashCustomPendingOrder) {
    const savedOrder = [..._dashCustomPendingOrder];
    const accIdx = savedOrder.indexOf('accounts');
    if (accIdx > 0) { savedOrder.splice(accIdx, 1); savedOrder.unshift('accounts'); }
    prefs._order = savedOrder;
    _dashCustomPendingOrder = null;
  } else {
    // Even without a new reorder, sanitize any existing order in prefs
    if (Array.isArray(prefs._order)) {
      const accIdx = prefs._order.indexOf('accounts');
      if (accIdx > 0) { prefs._order.splice(accIdx, 1); prefs._order.unshift('accounts'); }
    }
  }

  // Save pairs configuration
  if (window._dashCustomPendingPairs !== undefined) {
    prefs._pairs = window._dashCustomPendingPairs;
    window._dashCustomPendingPairs = undefined;
  }
  _dashSavePrefs(prefs);
  _dashApplyPrefs(prefs);
  if (prefs.favcats !== false) _renderDashFavCategories(_lastDashIncome, _lastDashExpense);
  // Reload optional cards that were just switched ON (content would still say "Carregando…")
  // Treat undefined as the card's default: optional=false, mandatory=true
  const _wasOff = (id, optional) => { const v = existingPrefs[id]; return v === false || (v === undefined && optional); };
  if (prefs.budgets     !== false && _wasOff('budgets',     true))  _loadDashBudgetsCard().catch(()=>{});
  if (prefs.investments !== false && _wasOff('investments', true))  _loadDashInvestmentsCard().catch(()=>{});
  if (prefs.dreams      !== false && _wasOff('dreams',      true))  _loadDashDreamsCard().catch(()=>{});
  if (prefs.toppayees   !== false && _wasOff('toppayees',   false)) _loadDashTopPayeesCard().catch(()=>{});
  if (prefs.forecast90  !== false && _wasOff('forecast90',  false)) _renderDashForecast().catch(()=>{});
  if (prefs.loyalty     !== false && _wasOff('loyalty',     true))  _loadDashLoyaltyCard().catch(()=>{});
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
    el.innerHTML = `<div class="dfav-card"><div class="dfav-header"><span class="dfav-title">⭐ Categorias Favoritas</span><button class="dfav-manage" onclick="navigate('categories')">${t('dash.manage')}</button></div><div class="dfav-empty"><div>Categorias favoritas não encontradas.<br><span style="font-size:.75rem">Elas podem ter sido excluídas.</span></div></div></div>`;
    return;
  }

  const now  = new Date(), y = now.getFullYear(), mo = String(now.getMonth()+1).padStart(2,'0');
  const from = `${y}-${mo}-01`;
  const to   = `${y}-${mo}-${String(new Date(y, now.getMonth()+1, 0).getDate()).padStart(2,'0')}`;
  const monthLabel = now.toLocaleDateString('pt-BR',{month:'long',year:'numeric'});

  // Índice de transações confirmadas do mês por category_id
  const txsByCat = {};
  try {
    let q = famQ(sb.from('transactions').select('category_id,date,amount,brl_amount,currency,is_transfer,status,family_member_id,family_member_ids,category_splits,member_shares'))
      .gte('date', from)
      .lte('date', to)
      .eq('status', 'confirmed');
    const memberIds = _getDashMemberIds();
    if (memberIds && memberIds.length > 0) q = q.in('family_member_id', memberIds);
    else if (memberIds && memberIds.length === 0) q = null;
    const { data: monthTx = [] } = q ? await q : { data: [] };
    monthTx.forEach(t => {
      const txDate = String(t.date || '').slice(0,10);
      if (t.is_transfer || txDate < from || txDate > to) return;
      // Se member_shares existe, filtrar por membro considerando proporcional
      if (Array.isArray(t.category_splits) && t.category_splits.length >= 2) {
        // Distribui pelos splits
        t.category_splits.forEach(s => {
          if (!s.category_id) return;
          if (!txsByCat[s.category_id]) txsByCat[s.category_id] = [];
          // Cria tx virtual com o amount do split
          txsByCat[s.category_id].push({ ...t, amount: -Math.abs(s.amount), brl_amount: -Math.abs(s.amount), category_id: s.category_id });
        });
      } else {
        if (!t.category_id) return;
        if (!txsByCat[t.category_id]) txsByCat[t.category_id] = [];
        txsByCat[t.category_id].push(t);
      }
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
    // Drill to exact transactions by category + current month
    const navAction = `onclick="_dashDrillToTx('${c.id}','${y}-${mo}')"`;  

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

    return `<div class="${rowClass}" style="cursor:pointer" ${navAction} title="Ver transações">
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
    el.innerHTML = `<div class="dfav-card"><div class="dfav-header"><span class="dfav-title">⭐ Categorias Favoritas</span><button class="dfav-manage" onclick="navigate('categories')">${t('dash.manage')}</button></div><div class="dfav-empty">Sem movimentações no mês para as categorias favoritas.</div></div>`;
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
    // Dates explicitly ignored — must NOT appear
    const skippedDates = new Set(
      (sc.occurrences || [])
        .filter(o => o.execution_status === 'skipped')
        .map(o => o.scheduled_date)
    );
    const pendingDates = new Set(
      (sc.occurrences || [])
        .filter(o => o.execution_status === 'pending' && o.scheduled_date >= today && o.scheduled_date <= limitStr)
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
      if (cur >= today && !executedDates.has(cur) && !skippedDates.has(cur))
        pushOccurrence(sc, cur, pendingDates.has(cur));
      count++;
      if (sc.frequency === 'once') break;
      cur = nextDate(cur, sc.frequency, sc.custom_interval, sc.custom_unit);
      if (!cur) break;
    }
    pendingDates.forEach(date => {
      if (date >= today && date <= limitStr && !executedDates.has(date) && !skippedDates.has(date)
          && !upcoming.some(x => x.sc.id === sc.id && x.date === date)) {
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

    const groupId = 'supGroup-' + date;
    const isCollapsed = !isToday && !isTomorrow; // today/tomorrow expanded by default
    return `<div class="sup-group">
      <div class="sup-group-hdr" onclick="toggleSupGroup('${date}')" style="cursor:pointer;user-select:none">
        <div class="sup-group-left">
          ${dayPill}
          <span class="sup-group-dow">${dow}</span>
        </div>
        <div class="sup-group-meta">
          <span class="sup-day-total ${dayTot>=0?'pos':'neg'}">${dayTot>=0?'+':''}${fmt(dayTot)}</span>
          <span class="sup-day-count">${items.length}</span>
          <span class="sup-group-toggle" id="supArrow-${date}" style="font-size:.7rem;color:var(--muted);transition:transform .2s;display:inline-block;transform:rotate(${isCollapsed?'-90deg':'0deg'})">▾</span>
        </div>
      </div>
      <div class="sup-rows" id="${groupId}" style="overflow:hidden;transition:max-height .22s ease;max-height:${isCollapsed?'0':'2000px'}">${rows}</div>
    </div>`;
  }).join('');
}

// Navigate to transactions page with category + month pre-filtered
// ── Favorite account info modal ───────────────────────────────────────────
function _openFavAccountModal(accountId) {
  const a = (state.accounts || []).find(x => x.id === accountId);
  if (!a) { toast('Conta não encontrada', 'error'); return; }

  const typeLabel  = (typeof accountTypeLabel === 'function' ? accountTypeLabel(a.type) : '') || a.type || '';
  const balColor   = (parseFloat(a.balance)||0) < 0 ? 'var(--red,#dc2626)' : 'var(--accent)';
  const color      = a.color || '#2a6049';

  // Bank / card info lines
  const bankInfo  = [
    a.bank_name,
    a.bank_code   && `Cód. ${a.bank_code}`,
    a.agency      && `Ag. ${a.agency}`,
    a.account_number && `CC ${a.account_number}`,
  ].filter(Boolean).join(' · ');
  const ibanLine  = a.iban ? `IBAN: ${a.iban}` : (a.routing_number ? `Routing: ${a.routing_number}` : '');
  const swiftLine = a.swift_bic ? `SWIFT/BIC: ${a.swift_bic}` : '';
  const cardInfo  = a.type === 'cartao_credito'
    ? [a.card_issuer, a.card_brand, a.card_type, a.card_limit && `Limite: ${fmt(a.card_limit)}`].filter(Boolean).join(' · ')
    : '';
  const dueLine   = a.due_day ? `Dia ${a.due_day}` : '';
  const bestLine  = a.best_purchase_day ? `Melhor compra: dia ${a.best_purchase_day}` : '';
  const groupName = (() => { const g = (state.groups||[]).find(x=>x.id===a.group_id); return g ? g.name : ''; })();

  // Build info rows helper
  const row = (label, val, mono) => val
    ? `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:7px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:.78rem;color:var(--muted);white-space:nowrap">${label}</span>
        <span style="font-size:.8rem;font-weight:600;color:var(--text);text-align:right${mono?';font-family:monospace':''}">${esc(val)}</span>
      </div>`
    : '';

  const brlLine = a.currency !== 'BRL'
    ? `<div style="font-size:.78rem;color:rgba(255,255,255,.65);margin-top:2px">≈ ${dashFmt(toBRL ? toBRL(a.balance,a.currency) : a.balance,'BRL')} BRL</div>`
    : '';

  const confBal  = a.confirmed_balance;
  const hasPend  = confBal !== undefined && Math.abs(confBal - (parseFloat(a.balance)||0)) > 0.001;
  const confLine = hasPend
    ? `<div style="font-size:.72rem;color:rgba(255,255,255,.65);margin-top:3px">Confirmado: ${fmt(confBal,a.currency)}</div>`
    : '';

  const content = `
    <!-- Hero -->
    <div style="background:linear-gradient(135deg,${color}dd,${color}99);padding:18px 20px 16px;border-radius:12px 12px 0 0;position:relative;overflow:hidden">
      <div style="position:absolute;right:-20px;bottom:-20px;width:90px;height:90px;border-radius:50%;background:rgba(255,255,255,.08);pointer-events:none"></div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <div style="width:36px;height:36px;border-radius:10px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;flex-shrink:0">
          ${typeof _dashRenderIcon === 'function' ? _dashRenderIcon(a.icon,a.color,20) : '🏦'}
        </div>
        <div style="min-width:0">
          <div style="font-size:.95rem;font-weight:800;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.name)}</div>
          <div style="font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:rgba(255,255,255,.65);margin-top:1px">${esc(typeLabel)}</div>
        </div>
        <button onclick="closeModal('favAccModal')"
          style="margin-left:auto;flex-shrink:0;background:rgba(255,255,255,.15);border:none;border-radius:6px;width:28px;height:28px;cursor:pointer;color:#fff;font-size:.85rem;display:flex;align-items:center;justify-content:center">✕</button>
      </div>
      <div style="font-size:1.55rem;font-weight:800;font-family:var(--font-serif,monospace);color:${(parseFloat(a.balance)||0)<0?'#fca5a5':'#fff'}">${fmt(a.balance,a.currency)}</div>
      ${brlLine}
      ${confLine}
    </div>

    <!-- Body -->
    <div style="padding:14px 20px 20px">
      <div style="display:flex;flex-direction:column;gap:0">
        ${groupName  ? row('Grupo',       groupName)                        : ''}
        ${a.currency !== 'BRL' ? row('Moeda', a.currency)                  : ''}
        ${bankInfo   ? row('Banco',       bankInfo)                         : ''}
        ${cardInfo   ? row('Cartão',      cardInfo)                         : ''}
        ${ibanLine   ? row('IBAN / Routing', ibanLine, true)                : ''}
        ${swiftLine  ? row('SWIFT/BIC',   swiftLine, true)                  : ''}
        ${dueLine    ? row('Vencimento',  dueLine)                          : ''}
        ${bestLine   ? row('Melhor compra', bestLine.replace('Melhor compra: ','')) : ''}
      </div>
      ${a.notes ? `<div style="margin-top:10px;padding:9px 11px;background:var(--surface2);border-radius:8px;font-size:.8rem;color:var(--text2);line-height:1.5">${esc(a.notes)}</div>` : ''}

      <!-- Actions -->
      <div style="display:flex;gap:8px;margin-top:16px">
        <button onclick="closeModal('favAccModal');goToAccountTransactions('${a.id}')"
          style="flex:1;padding:9px 0;border-radius:9px;border:1.5px solid var(--border);background:var(--surface2);font-size:.8rem;font-weight:700;color:var(--text2);cursor:pointer;transition:background .15s"
          onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background='var(--surface2)'">
          📋 Ver Transações
        </button>
        <button onclick="closeModal('favAccModal');openAccountModal('${a.id}')"
          style="flex:1;padding:9px 0;border-radius:9px;border:none;background:${color};font-size:.8rem;font-weight:700;color:#fff;cursor:pointer;opacity:.9;transition:opacity .15s"
          onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='.9'">
          ✏️ Editar Conta
        </button>
      </div>
    </div>`;

  // Reuse or create modal
  let modal = document.getElementById('favAccModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'favAccModal';
    modal.className = 'modal-overlay';
    modal.id = 'favAccModal';
    modal.onclick = e => { if (e.target === modal) closeModal('favAccModal'); };
    modal.innerHTML = '<div class="modal" style="max-width:400px;padding:0;overflow:hidden"><div class="modal-handle"></div><div id="favAccModalBody"></div></div>';
    document.body.appendChild(modal);
  }
  const _favBody = document.getElementById('favAccModalBody');
  if (_favBody) _favBody.innerHTML = content;
  openModal('favAccModal');
}
window._openFavAccountModal = _openFavAccountModal;

// ── Dashboard Forecast 90d ─────────────────────────────────────────────────
let _dashForecastChart = null;
let _dashForecastTimer = null;
// Store daily data for tooltip + drill-down (shared between chart and modal)
let _fcDailyData   = {};   // date → { balances:{accId→val}, txs:[], scheduled:[] }
let _fcAllAccounts = [];   // accounts used in this render
let _fcAllDates    = [];   // full 91-day date array

function _initDashForecastAccountSelect() {
  if (typeof _fcPickerBuild !== 'function') return;
  const prefs    = _dashGetPrefs();
  const savedIds = Array.isArray(prefs.dashForecastAccounts) ? prefs.dashForecastAccounts : [];
  _fcPickerBuild('dashForecastAcctPicker', savedIds, ids => {
    _dashSavePrefs({ ..._dashGetPrefs(), dashForecastAccounts: ids }).catch(()=>{});
    _renderDashForecast();
  });
}

async function _renderDashForecast() {
  const card = document.getElementById('dashCardForecast90');
  if (!card || card.style.display === 'none') return;

  _initDashForecastAccountSelect();

  const accIds = typeof _fcPickerGetSelected === 'function'
    ? _fcPickerGetSelected('dashForecastAcctPicker')
    : [];
  const includeScheduled = true; // Programados sempre inclusos (checkbox removido)
  const canvas = document.getElementById('dashForecastChart');
  if (!canvas) return;

  if (_dashForecastChart) { try { _dashForecastChart.destroy(); } catch(_) {} _dashForecastChart = null; }

  // Date range: today → today + 90 days (ALL days, daily resolution)
  const fromDate = new Date();
  const toDate   = new Date();
  toDate.setDate(toDate.getDate() + 90);
  const fromStr = fromDate.toISOString().slice(0, 10);
  const toStr   = toDate.toISOString().slice(0, 10);

  // Fetch real transactions in period
  let q = famQ(sb.from('transactions')
    .select('id,date,description,amount,currency,brl_amount,account_id,is_transfer,status,categories(name,color,icon),payees(name),accounts!transactions_account_id_fkey(id,name,color,currency,icon,type,balance)')
    .gte('date', fromStr).lte('date', toStr).order('date'));
  if (accIds.length === 1) q = q.eq('account_id', accIds[0]);
  else if (accIds.length > 1) q = q.in('account_id', accIds);
  const { data: txData } = await q;

  // Ensure scheduled transactions are loaded before building forecast items
  if (!state.scheduled?.length && typeof loadScheduled === 'function') {
    try { await loadScheduled(); } catch(_) {}
  }

  // Build scheduled items
  let scheduledItems = [];
  if (includeScheduled && state.scheduled?.length) {
    const schToProcess = accIds.length
      ? state.scheduled.filter(s => accIds.includes(s.account_id) || accIds.includes(s.transfer_to_account_id))
      : state.scheduled;
    schToProcess.forEach(sc => {
      if (sc.status === 'paused') return;
      const registered = new Set((sc.occurrences||[]).map(o => o.scheduled_date));
      const occ = typeof generateOccurrences === 'function' ? generateOccurrences(sc, 200) : [];
      const isTransfer = sc.type === 'transfer' || sc.type === 'card_payment';
      occ.forEach(date => {
        if (date < fromStr || date > toStr || registered.has(date)) return;
        const baseAmt = Math.abs(parseFloat(sc.amount) || 0);
        if (!accIds.length || accIds.includes(sc.account_id)) {
          const originAmount = sc.type === 'income' ? baseAmt : -baseAmt;
          if (originAmount !== 0) {
            const accMeta = (state.accounts || []).find(a => a.id === sc.account_id);
            scheduledItems.push({ date, description: sc.description || '', amount: originAmount, account_id: sc.account_id, currency: sc.currency || accMeta?.currency || 'BRL', categories: sc.categories || null, payees: sc.payees || null, accounts: accMeta || null, isScheduled: true });
          }
        }
        if (isTransfer && sc.transfer_to_account_id && (!accIds.length || accIds.includes(sc.transfer_to_account_id))) {
          const accMeta = (state.accounts || []).find(a => a.id === sc.transfer_to_account_id);
          scheduledItems.push({ date, description: sc.description || '', amount: Math.abs(parseFloat(sc.amount)||0), account_id: sc.transfer_to_account_id, currency: accMeta?.currency || 'BRL', categories: null, payees: null, accounts: accMeta || null, isScheduled: true });
        }
      });
    });
  }

  const allItems = [...(txData||[]), ...scheduledItems].sort((a,b)=>a.date.localeCompare(b.date));
  const accountIds = [...new Set(allItems.map(t=>t.account_id))].filter(Boolean);
  const accounts = accIds.length
    ? (state.accounts||[]).filter(a=>accIds.includes(a.id))
    : (state.accounts||[]).filter(a=>accountIds.includes(a.id));

  _fcAllAccounts = accounts;

  if (!accounts.length) {
    const summary = document.getElementById('dashForecastSummary');
    if (summary) summary.innerHTML = '<span style="color:var(--muted)">Sem dados de previsão para o período</span>';
    return;
  }

  // Build full daily date array (91 points)
  const allDates = [];
  let cur = new Date(fromStr + 'T12:00');
  const end = new Date(toStr + 'T12:00');
  while (cur <= end) { allDates.push(cur.toISOString().slice(0,10)); cur.setDate(cur.getDate()+1); }
  _fcAllDates = allDates;

  const COLORS = ['#2a6049','#1d4ed8','#b45309','#7c3aed','#dc2626','#059669'];

  // ── Build _fcDailyData: cumulative balance + transactions per day ─────────
  _fcDailyData = {};
  allDates.forEach(d => { _fcDailyData[d] = { balances: {}, txs: [], scheduled: [], totalIn: 0, totalOut: 0 }; });

  accounts.forEach(a => {
    const txAcc = allItems.filter(t => t.account_id === a.id);
    const realSumAll = txAcc.filter(t => !t.isScheduled).reduce((s,t)=>s+(parseFloat(t.amount)||0),0);
    let running = (parseFloat(a.balance)||0) - realSumAll;
    allDates.forEach(d => {
      const dayItems = txAcc.filter(t => t.date === d);
      dayItems.forEach(t => { running += (parseFloat(t.amount)||0); });
      _fcDailyData[d].balances[a.id] = +running.toFixed(2);
    });
  });

  // Populate txs + scheduled + daily totals
  allItems.forEach(t => {
    if (!_fcDailyData[t.date]) return;
    const enriched = { ...t, accounts: t.accounts || (state.accounts||[]).find(a=>a.id===t.account_id)||null };
    const amt = parseFloat(t.amount) || 0;
    if (t.isScheduled) {
      _fcDailyData[t.date].scheduled.push(enriched);
    } else {
      _fcDailyData[t.date].txs.push(enriched);
    }
    if (amt > 0) _fcDailyData[t.date].totalIn  += amt;
    else         _fcDailyData[t.date].totalOut += Math.abs(amt);
  });

  // ── Datasets: line per account (scalar y) + scatter overlays for markers ─
  // IMPORTANT: use data.labels + scalar y[] — NOT {x,y} objects — so that
  // per-point arrays (pointRadius, pointBackgroundColor, pointStyle) stay
  // correctly index-aligned with Chart.js v4 category scale.
  const lineDatasets = accounts.slice(0, 6).map((a, idx) => {
    const color = a.color || COLORS[idx % COLORS.length];
    // Build a canvas gradient for the area fill (top=color, bottom=transparent)
    const gradientFill = (ctx_chart) => {
      try {
        const chart = ctx_chart.chart;
        const { ctx, chartArea } = chart;
        if (!chartArea) return color + '18';
        const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
        gradient.addColorStop(0, color + '38');
        gradient.addColorStop(0.6, color + '10');
        gradient.addColorStop(1, color + '00');
        return gradient;
      } catch(_) { return color + '18'; }
    };
    return {
      label: a.name,
      data: allDates.map(d => _fcDailyData[d].balances[a.id] ?? null),
      borderColor: color,
      backgroundColor: gradientFill,
      fill: true,
      tension: 0.38,
      borderWidth: accounts.length === 1 ? 3 : 2.2,
      pointRadius: 0,
      pointHoverRadius: 7,
      pointHitRadius: 18,
      pointBackgroundColor: color,
      pointBorderColor: '#fff',
      pointBorderWidth: 2.5,
      spanGaps: true,
      borderCapStyle: 'round',
      borderJoinStyle: 'round',
    };
  });

  // Scatter marker datasets — one per account, only active days
  // These sit on top of the line and show circles/triangles with correct color
  const markerDatasets = accounts.slice(0, 6).map((a, idx) => {
    const color = a.color || COLORS[idx % COLORS.length];
    const pts = [];
    allDates.forEach((d, i) => {
      const dd       = _fcDailyData[d];
      const hasReal  = dd.txs.some(t => t.account_id === a.id);
      const hasSched = dd.scheduled.some(t => t.account_id === a.id);
      if (!hasReal && !hasSched) return;
      const bal = _fcDailyData[d].balances[a.id];
      if (bal == null) return;
      pts.push({
        x: i,                // category scale uses index as x for scatter
        y: bal,
        _date: d,
        _isSched: hasSched && !hasReal,
        _isMixed: hasReal && hasSched,
      });
    });
    return {
      type: 'scatter',
      label: '_marker_' + a.id,  // prefix so legend filter can hide these
      xAxisID: 'x',
      yAxisID: 'y',
      data: pts,
      backgroundColor: pts.map(p =>
        p._isMixed  ? '#f59e0b' :   // amber  — both real + scheduled
        p._isSched  ? '#1d4ed8' :   // blue   — scheduled only
        color                        // account color — real tx only
      ),
      borderColor: '#fff',
      borderWidth: 2,
      pointRadius: 6,
      pointHoverRadius: 9,
      pointStyle: pts.map(p => p._isSched ? 'triangle' : 'circle'),
      showLine: false,
    };
  });

  const datasets = [...lineDatasets, ...markerDatasets];

  // ── Annotations ───────────────────────────────────────────────────────────
  const allVals = lineDatasets.flatMap(ds => ds.data.filter(v => v != null));
  const minVal  = allVals.length ? Math.min(...allVals) : 0;
  const maxVal  = allVals.length ? Math.max(...allVals) : 0;
  const minDate = allDates.find(d => Object.values(_fcDailyData[d].balances).some(v => v === minVal));
  const maxDate = allDates.find(d => Object.values(_fcDailyData[d].balances).some(v => v === maxVal));
  const minIdx  = minDate ? allDates.indexOf(minDate) : -1;
  const maxIdx  = maxDate ? allDates.indexOf(maxDate) : -1;

  // Weekly vertical guides for readability
  const weekGuides = {};
  allDates.forEach((d, i) => {
    if (i === 0) return;
    const dow = new Date(d + 'T12:00').getDay();
    if (dow === 1) { // Monday
      weekGuides['wk_' + d] = {
        type: 'line', xMin: d, xMax: d,
        borderColor: 'rgba(125,194,66,0.08)', borderWidth: 1,
      };
    }
  });

  const fmtShort = v => {
    const abs = Math.abs(v);
    if (abs >= 1000000) return (v/1000000).toFixed(1).replace('.0','') + 'M';
    if (abs >= 1000)    return (v/1000).toFixed(0) + 'k';
    return fmt(v);
  };

  const annotations = {
    ...weekGuides,
    zeroLine: {
      type: 'line', yMin: 0, yMax: 0,
      borderColor: 'rgba(220,38,38,0.30)', borderWidth: 1.5, borderDash: [6,4],
    },
    todayLine: {
      type: 'line', xMin: fromStr, xMax: fromStr,
      borderColor: 'rgba(42,96,73,0.75)', borderWidth: 2, borderDash: [4,3],
      label: {
        content: '▶ Hoje', display: true, position: 'start',
        font: { size: 10, weight: '800', family: 'Outfit, sans-serif' },
        color: '#fff',
        backgroundColor: 'rgba(42,96,73,0.90)',
        padding: { x: 8, y: 5 }, borderRadius: 7,
        yAdjust: -4,
      },
    },
  };
  if (minIdx >= 0) annotations.minPt = {
    type: 'point', xValue: minIdx, yValue: minVal,
    radius: 8, backgroundColor: '#ef4444', borderColor: '#fff', borderWidth: 2.5,
    label: {
      content: '↓ ' + fmtShort(minVal), display: true,
      font: { size: 9, weight: '700', family: 'Outfit, sans-serif' },
      color: '#fff', backgroundColor: 'rgba(239,68,68,0.88)',
      padding: { x: 6, y: 3 }, borderRadius: 5,
      yAdjust: 18,
    },
  };
  if (maxIdx >= 0) annotations.maxPt = {
    type: 'point', xValue: maxIdx, yValue: maxVal,
    radius: 8, backgroundColor: '#22c55e', borderColor: '#fff', borderWidth: 2.5,
    label: {
      content: '↑ ' + fmtShort(maxVal), display: true,
      font: { size: 9, weight: '700', family: 'Outfit, sans-serif' },
      color: '#fff', backgroundColor: 'rgba(34,197,94,0.88)',
      padding: { x: 6, y: 3 }, borderRadius: 5,
      yAdjust: -18,
    },
  };

  // ── Chart instance ────────────────────────────────────────────────────────
  // Set canvas pixel ratio for crisp rendering on retina
  canvas.style.display = 'block';

  _dashForecastChart = new Chart(canvas, {
    type: 'line',
    data: { labels: allDates, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 500, easing: 'easeOutCubic' },
      layout: { padding: { top: 8, right: 4, bottom: 4, left: 0 } },
      plugins: {
        legend: {
          position: 'bottom',
          align: 'start',
          labels: {
            boxWidth: 12,
            boxHeight: 3,
            borderRadius: 2,
            useBorderRadius: true,
            padding: 14,
            font: { size: 11, family: 'Outfit, sans-serif', weight: '500' },
            color: '#6b7280',
            filter: item => !item.text.startsWith('_marker_') && item.text !== '_skip_',
            generateLabels(chart) {
              const accItems = chart.data.datasets
                .filter(ds => !ds.label.startsWith('_marker_') && !ds.label.includes('Programado'))
                .map((ds, i) => ({
                  text: ds.label,
                  fillStyle: ds.borderColor,
                  strokeStyle: ds.borderColor,
                  lineWidth: 2.5,
                  hidden: false,
                  datasetIndex: i,
                }));
              // Add "Progs" legend entry for the blue-triangle scheduled marker
              const hasScheduled = chart.data.datasets.some(ds =>
                ds.label.startsWith('_marker_') &&
                ds.data.some(p => p?._isSched || p?._isMixed)
              );
              if (hasScheduled) {
                accItems.push({
                  text: 'Progs',
                  fillStyle: '#1d4ed8',
                  strokeStyle: '#1d4ed8',
                  lineWidth: 0,
                  hidden: false,
                  pointStyle: 'triangle',
                  datasetIndex: -1,
                });
              }
              return accItems;
            },
          },
          // Disable legend clicks — forecast always shows all accounts + scheduled
          onClick: () => {},
          onHover: (e) => { e.native.target.style.cursor = 'default'; },
        },
        tooltip: {
          backgroundColor: 'rgba(13,20,15,0.97)',
          titleColor: '#f0fdf4',
          bodyColor: '#bbf7d0',
          footerColor: '#6ee7b7',
          borderColor: 'rgba(74,222,128,0.25)',
          borderWidth: 1,
          padding: { x: 14, y: 12 },
          cornerRadius: 10,
          titleFont: { size: 11, weight: '700', family: 'Outfit, sans-serif' },
          bodyFont: { size: 11, family: 'Outfit, sans-serif' },
          caretPadding: 8,
          filter: item => !item.dataset.label?.startsWith('_marker_'),
          callbacks: {
            // ── Title: data formatada + dia da semana + contagem de transações ──
            title(items) {
              const d = items[0]?.label || '';
              if (!d) return '';
              const [y, m, day] = d.split('-');
              const weekdays = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
              const wd = weekdays[new Date(d + 'T12:00').getDay()];
              const dd = _fcDailyData[d];
              const nReal  = (dd?.txs||[]).length;
              const nSched = (dd?.scheduled||[]).length;
              const parts  = [];
              if (nReal)  parts.push(`${nReal} lançamento${nReal>1?'s':''}`);
              if (nSched) parts.push(`${nSched} programado${nSched>1?'s':''}`);
              return `${wd}, ${day}/${m}/${y}` + (parts.length ? `  ·  ${parts.join(' + ')}` : '');
            },
            // ── Body: saldo projetado por conta ──────────────────────────────
            label(ctx) {
              if (ctx.dataset.label?.startsWith('_marker_')) return null;
              const d   = ctx.label || '';
              const acc = accounts[ctx.datasetIndex];
              const bal = ctx.parsed.y;
              if (bal == null) return '';
              const balFmt = fmt(bal, acc?.currency || 'BRL');
              const dd = _fcDailyData[d];
              const hasTx    = (dd?.txs||[]).some(t => t.account_id === acc?.id);
              const hasSched = (dd?.scheduled||[]).some(t => t.account_id === acc?.id);
              const tag = hasTx && hasSched ? ' ●▲' : hasTx ? ' ●' : hasSched ? ' ▲' : '';
              return `  ${acc?.name || ctx.dataset.label}: ${balFmt}${tag}`;
            },
            // ── After body: fluxo diário + lista de transações do dia ─────────
            afterBody(items) {
              const d  = items[0]?.label || '';
              const dd = _fcDailyData[d];
              if (!dd) return [];
              const allDayItems = [...(dd.txs||[]), ...(dd.scheduled||[])];
              const lines = [];

              if (dd.totalIn > 0 || dd.totalOut > 0) {
                lines.push('');
                lines.push(`  ↑ +${fmt(dd.totalIn)}   ↓ −${fmt(dd.totalOut)}`);
                const net = dd.totalIn - dd.totalOut;
                lines.push(`  Net: ${net >= 0 ? '+' : '−'}${fmt(Math.abs(net))}`);
              }

              if (allDayItems.length) {
                lines.push('');
                allDayItems.slice(0, 5).forEach(t => {
                  const neg    = Number(t.amount) < 0;
                  const sign   = neg ? '−' : '+';
                  const amtStr = fmt(Math.abs(Number(t.amount)), t.currency || 'BRL');
                  const label  = (t.description || t.payees?.name || '—').slice(0, 22);
                  const sched  = t.isScheduled ? ' ▲' : '';
                  const cat    = t.categories?.icon ? t.categories.icon + ' ' : '';
                  lines.push(`  ${sign}${amtStr}  ${cat}${label}${sched}`);
                });
                if (allDayItems.length > 5) {
                  lines.push(`  + ${allDayItems.length - 5} mais…`);
                }
              }

              lines.push('');
              lines.push('  👆 Toque para detalhes');
              return lines;
            },
          },
        },
        annotation: { annotations },
      },
      scales: {
        x: {
          type: 'category',
          border: { display: false },
          ticks: {
            color: '#9ca3af',
            font: { size: 10, weight: '600', family: 'Outfit, sans-serif' },
            maxRotation: 0,
            padding: 8,
            callback(val, idx) {
              const d = allDates[idx];
              if (!d) return '';
              const [, m, day] = d.split('-');
              const date = new Date(d + 'T12:00');
              const dow  = date.getDay();
              const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
              // First day, last day, every Monday, and 1st of month
              const isFirst = idx === 0;
              const isLast  = idx === allDates.length - 1;
              const isMonday   = dow === 1;
              const isMonthStart = day === '01';
              if (isFirst || isLast)       return `${day}/${m}`;
              if (isMonthStart)            return MONTHS[parseInt(m)-1];
              if (isMonday && idx % 7 === 0) return `${day}/${m}`;
              if (isMonday && (allDates.length <= 30)) return `${day}/${m}`;
              return '';
            },
          },
          grid: {
            drawTicks: false,
            color: ctx => {
              const d = allDates[ctx.index];
              if (!d) return 'transparent';
              const date = new Date(d + 'T12:00');
              const dow  = date.getDay();
              const day  = d.slice(8);
              if (day === '01') return 'rgba(42,96,73,0.15)';   // month boundary — accent
              if (dow === 1)    return 'rgba(156,163,175,0.08)'; // weekly grid
              return 'transparent';
            },
            lineWidth: ctx => {
              const d = allDates[ctx.index];
              if (!d) return 1;
              return d.slice(8) === '01' ? 1.5 : 1;
            },
          },
        },
        y: {
          position: 'right',
          border: { display: false },
          ticks: {
            callback: v => {
              const abs = Math.abs(v);
              if (abs >= 1000000) return (v/1000000).toFixed(1).replace('.0','') + 'M';
              if (abs >= 1000)    return (v/1000).toFixed(0) + 'k';
              return fmt(v);
            },
            color: '#9ca3af',
            font: { size: 10, family: 'Outfit, sans-serif' },
            maxTicksLimit: 6,
            padding: 12,
          },
          grid: {
            color: ctx => ctx.tick.value === 0
              ? 'rgba(239,68,68,0.22)'
              : 'rgba(156,163,175,0.08)',
            lineWidth: ctx => ctx.tick.value === 0 ? 1.5 : 1,
            borderDash: ctx => ctx.tick.value === 0 ? [6,4] : [0,0],
          },
        },
      },
      onClick(evt, elements) {
        if (!elements.length) return;
        const el = elements.find(e => !datasets[e.datasetIndex]?.label?.startsWith('_marker_')) || elements[0];
        const idx  = el.index;
        const date = allDates[idx];
        if (date) _dashForecastDrill(date, _fcDailyData[date]);
      },
      onHover(evt, elements) {
        evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
      },
    },
  });

  // ── Summary row: today balance + 90-day projected balance + delta ─────────
  const summary = document.getElementById('dashForecastSummary');
  if (summary) {
    const lastDate = allDates[allDates.length - 1];
    summary.innerHTML = accounts.slice(0,6).map((a, idx) => {
      const finalBal = _fcDailyData[lastDate]?.balances[a.id] ?? 0;
      const todayBal = _fcDailyData[fromStr]?.balances[a.id] ?? (parseFloat(a.balance)||0);
      const delta    = finalBal - todayBal;
      const pct      = todayBal !== 0 ? (delta / Math.abs(todayBal) * 100) : 0;
      const isNeg    = finalBal < 0;
      const isDown   = delta < 0;
      const color    = a.color || COLORS[idx % COLORS.length];
      const arrow    = isDown ? '↓' : '↑';
      const deltaClr = isDown ? '#ef4444' : '#22c55e';
      const pctStr   = Math.abs(pct) < 999 ? ` ${arrow} ${Math.abs(pct).toFixed(1)}%` : '';
      return `<span style="display:flex;align-items:center;gap:5px;white-space:nowrap;
        padding:5px 10px;border-radius:10px;background:var(--surface2);border:1px solid var(--border)">
        <span style="width:9px;height:9px;border-radius:50%;background:${color};flex-shrink:0;box-shadow:0 0 0 2px ${color}25"></span>
        <span style="color:var(--text2);font-size:.75rem;font-weight:600">${esc(a.name)}</span>
        <strong style="color:${isNeg?'#ef4444':'var(--text)'};font-size:.8rem">${fmt(finalBal, a.currency)}</strong>
        <span style="font-size:.69rem;font-weight:700;color:${deltaClr};background:${deltaClr}18;
          padding:1px 5px;border-radius:5px">${pctStr || (isDown ? '↓' : '↑')}</span>
      </span>`;
    }).join('');
  }
}


function attachForecastNavigation(chartInstance, labelsArr, txByLabel) {
  if (!chartInstance) return;
  chartInstance.options.onClick = function(evt, elements) {
    if (elements?.length && labelsArr) {
      const date = labelsArr[elements[0].index];
      if (date) _dashForecastDrill(date, _fcDailyData[date]);
    }
  };
  chartInstance.update();
}

function _dashForecastDrill(date, dayData) {
  _showForecastDrillModal(date, dayData || _fcDailyData[date] || {});
}

// ── Forecast drill-down modal ─────────────────────────────────────────────
function _showForecastDrillModal(date, dayData) {
  const txs       = dayData?.txs       || [];
  const scheduled = dayData?.scheduled || [];
  const balances  = dayData?.balances  || {};
  const allItems  = [...txs, ...scheduled];

  const [y, m, d] = (date || '').split('-');
  const dateLabel  = d && m && y ? `${d}/${m}/${y}` : date;
  const weekdays   = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
  const weekday    = date ? weekdays[new Date(date + 'T12:00').getDay()] : '';
  const isToday    = date === new Date().toISOString().slice(0,10);
  const isPast     = date < new Date().toISOString().slice(0,10);

  // ── Estatísticas do dia ───────────────────────────────────────────────────
  const totalIn   = allItems.filter(t => Number(t.amount) > 0).reduce((s,t)=>s+Number(t.amount),0);
  const totalOut  = allItems.filter(t => Number(t.amount) < 0).reduce((s,t)=>s+Math.abs(Number(t.amount)),0);
  const netFlow   = totalIn - totalOut;
  const nReal     = txs.length;
  const nSched    = scheduled.length;

  // Breakdown por categoria
  const catTotals = {};
  allItems.forEach(t => {
    const key  = t.categories?.name || (Number(t.amount)>0 ? 'Receitas' : 'Outros');
    const icon = t.categories?.icon || (Number(t.amount)>0 ? '💰' : '📦');
    const col  = t.categories?.color || (Number(t.amount)>0 ? '#16a34a' : '#6b7280');
    if (!catTotals[key]) catTotals[key] = { icon, color: col, totalIn:0, totalOut:0, count:0 };
    if (Number(t.amount) > 0) catTotals[key].totalIn  += Number(t.amount);
    else                      catTotals[key].totalOut += Math.abs(Number(t.amount));
    catTotals[key].count++;
  });
  const catRows = Object.entries(catTotals)
    .sort((a,b) => (b[1].totalIn + b[1].totalOut) - (a[1].totalIn + a[1].totalOut))
    .slice(0, 6);

  // ── Saldo das contas neste dia ────────────────────────────────────────────
  const balCards = _fcAllAccounts.filter(a => balances[a.id] !== undefined).map(a => {
    const bal     = balances[a.id];
    const isNeg   = bal < 0;
    const color   = a.color || '#2a6049';
    const todayBal= _fcDailyData[_fcAllDates[0]]?.balances[a.id] ?? bal;
    const delta   = bal - todayBal;
    const deltaFmt= (delta >= 0 ? '+' : '−') + fmt(Math.abs(delta), a.currency);
    const deltaClr= delta >= 0 ? 'var(--accent)' : 'var(--red,#c0392b)';
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--surface2);border-radius:10px;border-left:3px solid ${color}">
        <span style="font-size:1.2rem;flex-shrink:0">${a.icon||'🏦'}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:.78rem;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.name)}</div>
          <div style="font-size:.67rem;color:var(--muted);margin-top:1px">Saldo projetado${isPast?' (real)':''}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:.9rem;font-weight:800;color:${isNeg?'var(--red,#c0392b)':'var(--accent)'}">
            ${fmt(bal, a.currency)}
          </div>
          ${!isToday && delta !== 0 ? `<div style="font-size:.65rem;color:${deltaClr};margin-top:1px">${deltaFmt} vs hoje</div>` : ''}
        </div>
      </div>`;
  }).join('');

  // ── Lista de transações ───────────────────────────────────────────────────
  const txRows = allItems.length
    ? allItems.map(t => {
        const isNeg   = Number(t.amount) < 0;
        const catIcon = t.categories?.icon || (isNeg ? '📦' : '💰');
        const catClr  = t.categories?.color || (isNeg ? '#6b7280' : '#16a34a');
        const payee   = t.payees?.name || '';
        const desc    = t.description || payee || '—';
        const accName = t.accounts?.name || (state.accounts||[]).find(a=>a.id===t.account_id)?.name || '';
        const accClr  = t.accounts?.color || (state.accounts||[]).find(a=>a.id===t.account_id)?.color || '#2a6049';
        const amt     = Math.abs(Number(t.amount));
        const cur     = t.currency || t.accounts?.currency || 'BRL';
        const isPend  = (t.status || 'confirmed') === 'pending';

        const tags = [];
        if (t.isScheduled) tags.push(`<span style="font-size:.6rem;padding:1px 6px;border-radius:4px;background:rgba(29,78,216,.12);color:#1d4ed8;font-weight:600">▲ Programado</span>`);
        if (isPend)        tags.push(`<span style="font-size:.6rem;padding:1px 6px;border-radius:4px;background:rgba(180,83,9,.12);color:#b45309;font-weight:600">Pendente</span>`);
        if (t.categories?.name) tags.push(`<span style="font-size:.6rem;padding:1px 6px;border-radius:4px;background:${catClr}18;color:${catClr}">${catIcon} ${esc(t.categories.name)}</span>`);

        return `
          <div style="display:flex;align-items:flex-start;gap:10px;padding:9px 11px;background:var(--surface2);border-radius:10px;border-left:2.5px solid ${isNeg?'var(--red,#c0392b)':'var(--accent)'}">
            <span style="font-size:1.15rem;flex-shrink:0;margin-top:1px">${catIcon}</span>
            <div style="flex:1;min-width:0">
              <div style="font-size:.82rem;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(desc)}</div>
              ${accName ? `<div style="font-size:.68rem;color:var(--muted);margin-top:2px;display:flex;align-items:center;gap:3px"><span style="width:5px;height:5px;border-radius:50%;background:${accClr};flex-shrink:0"></span>${esc(accName)}</div>` : ''}
              ${tags.length ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">${tags.join('')}</div>` : ''}
            </div>
            <div style="text-align:right;flex-shrink:0">
              <span style="font-size:.9rem;font-weight:800;color:${isNeg?'var(--red,#c0392b)':'var(--accent)'}">
                ${isNeg?'−':'+'}${fmt(amt, cur)}
              </span>
            </div>
          </div>`;
      }).join('')
    : `<div style="padding:24px 10px;text-align:center;color:var(--muted);font-size:.83rem">
         📭 Nenhuma movimentação neste dia.
       </div>`;

  // ── Breakdown por categoria ───────────────────────────────────────────────
  const maxCatVal = Math.max(...catRows.map(([, v]) => v.totalIn + v.totalOut), 1);
  const catSection = catRows.length ? `
    <div style="margin-top:18px">
      <div style="font-size:.7rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px">Por categoria</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${catRows.map(([cat, {icon, color, totalIn: tIn, totalOut: tOut, count}]) => {
          const total = tIn + tOut;
          const pct   = Math.round((total / maxCatVal) * 100);
          const isInc = tIn > tOut;
          return `
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:.9rem;flex-shrink:0">${icon}</span>
            <div style="flex:1;min-width:0">
              <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px">
                <span style="font-size:.75rem;color:var(--text2);font-weight:600">${esc(cat)}</span>
                <span style="font-size:.72rem;font-weight:700;color:${isInc?'var(--accent)':'var(--red,#c0392b)'}">${isInc?'+':'-'}${fmt(total)}</span>
              </div>
              <div style="height:3px;border-radius:2px;background:var(--border)">
                <div style="height:100%;border-radius:2px;background:${color || (isInc?'var(--accent)':'var(--red,#c0392b)')};width:${pct}%;transition:width .3s"></div>
              </div>
            </div>
            <span style="font-size:.65rem;color:var(--muted);flex-shrink:0">${count}x</span>
          </div>`;
        }).join('')}
      </div>
    </div>` : '';

  // ── Estatísticas de tendência (vs dia anterior e vs mesma semana) ─────────
  const dayIdx   = _fcAllDates.indexOf(date);
  const prevDate = dayIdx > 0 ? _fcAllDates[dayIdx - 1] : null;
  const prev7    = dayIdx >= 7 ? _fcAllDates[dayIdx - 7] : null;
  let trendHtml  = '';
  if (prevDate || prev7) {
    const prevBal = prevDate ? Object.values(_fcDailyData[prevDate]?.balances||{}).reduce((s,v)=>s+v,0) : null;
    const curBal  = Object.values(balances).reduce((s,v)=>s+v,0);
    const prev7Bal= prev7 ? Object.values(_fcDailyData[prev7]?.balances||{}).reduce((s,v)=>s+v,0) : null;
    const d1Delta = prevBal != null ? curBal - prevBal : null;
    const d7Delta = prev7Bal != null ? curBal - prev7Bal : null;
    const pill = (val, label) => val == null ? '' : `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:var(--surface2);border-radius:8px">
        <span style="font-size:.72rem;color:var(--muted)">${label}</span>
        <span style="font-size:.76rem;font-weight:700;color:${val>=0?'var(--accent)':'var(--red,#c0392b)'}">
          ${val>=0?'+':'−'}${fmt(Math.abs(val))}
        </span>
      </div>`;
    trendHtml = `
      <div style="margin-top:18px">
        <div style="font-size:.7rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Tendência do saldo total</div>
        <div style="display:flex;flex-direction:column;gap:5px">
          ${pill(d1Delta, 'vs dia anterior')}
          ${pill(d7Delta, 'vs semana passada')}
        </div>
      </div>`;
  }

  // ── Badge de tipo do dia ──────────────────────────────────────────────────
  const dayBadge = isToday
    ? `<span style="font-size:.65rem;padding:2px 8px;border-radius:20px;background:rgba(42,96,73,.15);color:#2a6049;font-weight:700">Hoje</span>`
    : isPast
    ? `<span style="font-size:.65rem;padding:2px 8px;border-radius:20px;background:var(--surface3,var(--surface2));color:var(--muted);font-weight:600">Passado</span>`
    : `<span style="font-size:.65rem;padding:2px 8px;border-radius:20px;background:rgba(29,78,216,.1);color:#1d4ed8;font-weight:600">Futuro</span>`;

  // ── Navegação entre dias ──────────────────────────────────────────────────
  const prevDateNav = dayIdx > 0 ? _fcAllDates[dayIdx - 1] : null;
  const nextDateNav = dayIdx < _fcAllDates.length - 1 ? _fcAllDates[dayIdx + 1] : null;
  const navBtn = (d, label, dir) => d
    ? `<button onclick="_dashForecastDrill('${d}', _fcDailyData['${d}'])"
         style="display:flex;align-items:center;gap:4px;font-size:.72rem;padding:5px 10px;border-radius:7px;border:1px solid var(--border);background:var(--surface2);color:var(--text2);cursor:pointer">
         ${dir === 'prev' ? '←' : ''} ${label} ${dir === 'next' ? '→' : ''}
       </button>`
    : `<span></span>`;

  // ── HTML do modal ─────────────────────────────────────────────────────────
  const content = `
    <!-- Header -->
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px;gap:8px">
      <div style="min-width:0">
        <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">
          <span style="font-size:1.05rem;font-weight:800;color:var(--text)">${weekday}</span>
          ${dayBadge}
        </div>
        <div style="font-size:.78rem;color:var(--muted);margin-top:2px">${dateLabel}
          ${nReal || nSched ? `· <strong style="color:var(--text2)">${nReal} lançamento${nReal!==1?'s':''}</strong>${nSched ? ` + <strong style="color:#1d4ed8">${nSched} programado${nSched!==1?'s':''}</strong>` : ''}` : ''}
        </div>
      </div>
      <button onclick="closeModal('forecastDrillModal')"
        style="background:none;border:1px solid var(--border);border-radius:7px;padding:4px 10px;cursor:pointer;font-size:.75rem;color:var(--muted);flex-shrink:0">✕</button>
    </div>

    <!-- Stats bar -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;margin-bottom:14px">
      <div style="background:rgba(42,122,74,.1);border:1px solid rgba(42,122,74,.15);border-radius:10px;padding:9px 10px;text-align:center">
        <div style="font-size:.65rem;color:var(--muted);margin-bottom:3px;font-weight:600;text-transform:uppercase;letter-spacing:.05em">Entradas</div>
        <div style="font-size:.92rem;font-weight:800;color:var(--accent)">+${fmt(totalIn)}</div>
      </div>
      <div style="background:rgba(192,57,43,.07);border:1px solid rgba(192,57,43,.15);border-radius:10px;padding:9px 10px;text-align:center">
        <div style="font-size:.65rem;color:var(--muted);margin-bottom:3px;font-weight:600;text-transform:uppercase;letter-spacing:.05em">Saídas</div>
        <div style="font-size:.92rem;font-weight:800;color:var(--red,#c0392b)">−${fmt(totalOut)}</div>
      </div>
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:9px 10px;text-align:center">
        <div style="font-size:.65rem;color:var(--muted);margin-bottom:3px;font-weight:600;text-transform:uppercase;letter-spacing:.05em">Net do dia</div>
        <div style="font-size:.92rem;font-weight:800;color:${netFlow>=0?'var(--accent)':'var(--red,#c0392b)'}">
          ${netFlow>=0?'+':'−'}${fmt(Math.abs(netFlow))}
        </div>
      </div>
    </div>

    <!-- Saldo das contas -->
    ${balCards ? `
    <div style="font-size:.7rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Saldo projetado das contas</div>
    <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px">${balCards}</div>` : ''}

    <!-- Transações do dia -->
    <div style="font-size:.7rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">
      Transações${allItems.length ? ` (${allItems.length})` : ''}
    </div>
    <div style="display:flex;flex-direction:column;gap:5px;max-height:260px;overflow-y:auto;padding-right:2px">
      ${txRows}
    </div>

    ${catSection}
    ${trendHtml}

    <!-- Footer: navegação + ação -->
    <div style="margin-top:18px;padding-top:12px;border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
      <div style="display:flex;gap:6px">
        ${navBtn(prevDateNav, 'Anterior', 'prev')}
        ${navBtn(nextDateNav, 'Próximo', 'next')}
      </div>
      
    </div>`;

  // ── Criar / reusar modal ──────────────────────────────────────────────────
  let modal = document.getElementById('forecastDrillModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'forecastDrillModal';
    modal.className = 'modal-overlay';
    modal.id = 'forecastDrillModal';
    modal.onclick = e => { if (e.target === modal) closeModal('forecastDrillModal'); };
    modal.innerHTML = '<div class="modal" style="max-width:540px;max-height:90dvh;overflow-y:auto;padding:0"><div class="modal-handle"></div><div id="forecastDrillModalBody" style="padding:18px 18px 22px"></div></div>';
    document.body.appendChild(modal);
  }
  document.getElementById('forecastDrillModalBody').innerHTML = content;
  openModal('forecastDrillModal');
}
window._dashForecastDrill = _dashForecastDrill;
window._showForecastDrillModal = _showForecastDrillModal;



function toggleSupGroup(date) {
  const body  = document.getElementById('supGroup-' + date);
  const arrow = document.getElementById('supArrow-' + date);
  if (!body) return;
  const isOpen = body.style.maxHeight !== '0px' && body.style.maxHeight !== '0';
  body.style.maxHeight  = isOpen ? '0' : '2000px';
  if (arrow) arrow.style.transform = isOpen ? 'rotate(-90deg)' : 'rotate(0deg)';
}
window.toggleSupGroup = toggleSupGroup;

// ── Modal: Composição do Patrimônio Total ─────────────────────────────────
async function _openPatrimonioModal() {
  /* ═══════════════════════════════════════════════════════════════════════
     PASSO 1 — Carregar contas (mesma lógica do loadKPIs em db.js)
  ═══════════════════════════════════════════════════════════════════════ */
  if (typeof DB !== 'undefined' && DB.accounts) {
    try { await DB.accounts.load(); } catch(_) {}
  }
  const accs = Array.isArray(state.accounts) ? state.accounts : [];
  if (!accs.length) { toast('Nenhuma conta encontrada.', 'info'); return; }

  // Garantir market value de investimentos (idem loadKPIs)
  try {
    if (typeof loadInvestments === 'function') await loadInvestments();
    if (typeof invPostBalanceHook === 'function') invPostBalanceHook();
  } catch(_) {}

  /* ═══════════════════════════════════════════════════════════════════════
     PASSO 2 — Dívidas ativas (mesma query do loadKPIs)
  ═══════════════════════════════════════════════════════════════════════ */
  let debts = [], debtTotal = 0;
  try {
    // _dbt cache do módulo de dívidas (mais completo — inclui description, creditor, etc.)
    if (typeof _dbt !== 'undefined' && _dbt.loaded && Array.isArray(_dbt.debts) && _dbt.debts.length) {
      debts = _dbt.debts.filter(d => (d.status||'active') === 'active');
    } else {
      const { data: dd } = await famQ(
        sb.from('debts').select('id,description,name,current_balance,original_amount,currency,status,interest_rate,index_type,installment_count,installments_paid,creditor,creditor_payee_id')
      ).eq('status', 'active').order('current_balance', { ascending: false });
      debts = dd || [];
    }
  } catch(e) { console.warn('[patrimônio] debts:', e?.message); }
  debtTotal = debts.reduce((s,d) =>
    s + toBRL(parseFloat(d.current_balance ?? d.original_amount)||0, d.currency||'BRL'), 0);

  /* ═══════════════════════════════════════════════════════════════════════
     PASSO 3 — Calcular exatamente igual ao loadKPIs
  ═══════════════════════════════════════════════════════════════════════ */
  // Cada conta contribui com:
  //   - contas de investimento → _totalPortfolioBalance (market value)
  //   - demais → balance (saldo da conta)
  // cartão de crédito negativo → entra negativo no accountTotal
  const accountRows = accs.map(a => {
    const rawBal = (a.type === 'investimento' && a._totalPortfolioBalance != null)
      ? a._totalPortfolioBalance
      : (parseFloat(a.balance) || 0);
    const balBRL = toBRL(rawBal, a.currency || 'BRL');
    return { ...a, _rawBal: rawBal, _balBRL: balBRL };
  }).sort((a,b) => Math.abs(b._balBRL) - Math.abs(a._balBRL));

  const accountTotal = accountRows.reduce((s,a) => s + a._balBRL, 0);

  // ── RECEIVABLES FLAGGED FOR PATRIMÔNIO ────────────────────────────────
  let recvTotal = 0, recvRows = [];
  try {
    const fid = typeof famId === 'function' ? famId() : null;
    if (fid) {
      // Fetch all pending income, then filter by client-side _recvPatMap
      // Avoids SELECT/WHERE on include_in_patrimonio which may not exist yet
      const { data: rv } = await sb.from('transactions')
        .select('id,description,amount,brl_amount,currency,date,payees(name)')
        .eq('family_id', fid).eq('status','pending').gte('amount',0)
        .eq('is_transfer',false);
      // Filter: either column exists in response OR use client-side map
      recvRows = (rv || []).filter(r =>
        r.include_in_patrimonio === true ||
        (typeof _recvPatMap !== 'undefined' && _recvPatMap[r.id] === true)
      );
      recvTotal = recvRows.reduce((s,r) => s + (parseFloat(r.brl_amount ?? r.amount)||0), 0);
    }
  } catch(_) {}

  // ── PATRIMÔNIO TOTAL (idêntico ao dashboard KPI) ──
  const patrimonioTotal = accountTotal - debtTotal + recvTotal;

  // Componentes positivos vs negativos
  const ativoRows    = accountRows.filter(a => a._balBRL > 0);
  const passivoRows  = accountRows.filter(a => a._balBRL < 0); // cartões negativos
  const totalAtivos  = ativoRows.reduce((s,a)=>s+a._balBRL, 0) + recvTotal;
  const totalCartNeg = passivoRows.reduce((s,a)=>s+Math.abs(a._balBRL), 0);
  const totalPassivos = totalCartNeg + debtTotal;

  // Grupos de ativos
  const accsLiquid = ativoRows.filter(a => !['investimento','cartao_credito'].includes(a.type));
  const accsInvest = ativoRows.filter(a => a.type === 'investimento');
  const accsCardPos = ativoRows.filter(a => a.type === 'cartao_credito');
  const accsCardNeg = passivoRows.filter(a => a.type === 'cartao_credito');

  const liquidTotal = accsLiquid.reduce((s,a)=>s+a._balBRL, 0);
  const invTotal    = accsInvest.reduce((s,a)=>s+a._balBRL, 0);
  const ativosBase  = Math.max(totalAtivos, 0.01);

  // Score de saúde
  const endividamento = totalAtivos > 0 ? totalPassivos / totalAtivos : 0;
  const healthScore = Math.round(Math.max(0, Math.min(100,
    70 * (1 - Math.min(endividamento, 1)) +
    20 * ([liquidTotal>0, invTotal>0, debts.length===0].filter(Boolean).length / 3) +
    10 * (patrimonioTotal > 0 ? 1 : 0)
  )));
  const [hLabel, hColor] = healthScore >= 80 ? ['Excelente','#10b981']
    : healthScore >= 60 ? ['Bom','#f59e0b']
    : healthScore >= 40 ? ['Atenção','#f97316']
    : ['Crítico','#ef4444'];

  // Sync the dashboard badge with the exact modal score
  _updatePatrimonioScoreBadge(patrimonioTotal, debtTotal);

  /* ═══════════════════════════════════════════════════════════════════════
     PASSO 4 — Helpers visuais
  ═══════════════════════════════════════════════════════════════════════ */
  const _pct    = (v, b) => b > 0 ? Math.min(100, Math.abs(v/b*100)) : 0;
  const _pctStr = (v, b) => _pct(v,b).toFixed(1);
  const _isFX   = cur => cur && cur !== 'BRL';
  const _cred   = d => { const c=d.creditor; return (typeof c==='object'?c?.name:c)||''; };
  const _dName  = d => esc(d.description || d.name || '—');

  const _invTypeLabel = { acao_br:'Ações BR', fii:'FII', etf_br:'ETF BR', acao_us:'Ações US', etf_us:'ETF US', bdr:'BDR', fundo:'Fundos', crypto:'Cripto', renda_fixa:'Renda Fixa', outro:'Outros' };
  const _invTypeEmoji = { acao_br:'🇧🇷', fii:'🏢', etf_br:'📊', acao_us:'🇺🇸', etf_us:'📈', bdr:'🌐', fundo:'🏦', crypto:'₿', renda_fixa:'💰', outro:'📌' };

  // Tipo de conta para exibição
  const _typeLabel = a => {
    if (typeof accountTypeLabel === 'function') return accountTypeLabel(a.type);
    const m = {corrente:'Conta corrente',poupanca:'Poupança',cartao_credito:'Cartão de crédito',investimento:'Investimento',dinheiro:'Dinheiro/Espécie',outros:'Outros'};
    return m[a.type] || a.type;
  };

  // Linha de conta
  const _row = (a, isNeg=false) => {
    const bal    = a._rawBal;
    const balBRL = a._balBRL;
    const disp   = _isFX(a.currency) ? dashFmt(Math.abs(bal), a.currency) : dashFmt(Math.abs(balBRL), 'BRL');
    const pct    = _pct(Math.abs(balBRL), ativosBase);
    const color  = isNeg ? '#ef4444' : (a.color || '#10b981');
    const sub    = _typeLabel(a) + (_isFX(a.currency) ? ` · ${a.currency}` : '');
    const note   = a.type === 'investimento' && a._totalPortfolioBalance != null
      ? '<span style="font-size:.62rem;background:rgba(59,130,246,.1);color:#3b82f6;padding:1px 5px;border-radius:4px;margin-left:4px">market value</span>'
      : '';
    return `
    <div onclick="goToAccountTransactions('${a.id}');closeModal('patrimonioModal')"
      style="display:flex;align-items:center;gap:10px;padding:9px 14px;cursor:pointer;transition:background .12s;border-bottom:1px solid var(--border)"
      onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''">
      <div style="width:32px;height:32px;border-radius:9px;background:${color}22;flex-shrink:0;display:flex;align-items:center;justify-content:center">
        ${_dashRenderIcon(a.icon, a.color, 16)}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:.84rem;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.name)}${note}</div>
        <div style="font-size:.66rem;color:var(--muted)">${sub}</div>
        <div style="height:2.5px;background:var(--border);border-radius:3px;margin-top:4px;overflow:hidden;max-width:180px">
          <div style="height:100%;width:${pct.toFixed(1)}%;background:${color};border-radius:3px;transition:width .4s"></div>
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0;min-width:80px">
        <div style="font-size:.88rem;font-weight:800;font-family:var(--font-serif);color:${isNeg?'#ef4444':'var(--text)'}">${isNeg?'−':''}${disp}</div>
        ${_isFX(a.currency)?`<div style="font-size:.63rem;color:var(--muted)">≈ ${dashFmt(Math.abs(balBRL),'BRL')}</div>`:''}
        <div style="font-size:.62rem;color:var(--muted)">${pct.toFixed(1)}% patrimônio</div>
      </div>
    </div>`;
  };

  // Linha de investimento individual (ativo)
  const invByType = {};
  const invPositions = typeof _inv !== 'undefined' && _inv.positions ? _inv.positions : [];
  invPositions.forEach(p => {
    const k = p.asset_type || 'outro';
    if (!invByType[k]) invByType[k] = { positions: [], total: 0 };
    const mv = typeof _invMarketValue === 'function' ? _invMarketValue(p) : (+(p.quantity||0)*(+(p.current_price||p.avg_cost||0)));
    // Attach account currency so position row can use it as fallback
    const _pAcc = accs.find(a => a.id === p.account_id);
    invByType[k].positions.push({...p, _mv: mv, _accCurrency: _pAcc?.currency || 'BRL'});
    invByType[k].total += mv;
  });

  // Seção colapsável
  const _section = (emoji, title, total, color, bodyHtml, indent=false) => `
  <div style="margin-bottom:1px;background:var(--surface)">
    <div style="display:flex;align-items:center;gap:8px;padding:9px 14px;background:var(--surface2);border-bottom:1px solid var(--border)${indent?';padding-left:22px':''}">
      <span>${emoji}</span>
      <span style="font-size:.79rem;font-weight:800;color:var(--text);flex:1">${title}</span>
      <span style="font-size:.9rem;font-weight:800;font-family:var(--font-serif);color:${color}">${dashFmt(Math.abs(total),'BRL')}</span>
      <span style="font-size:.63rem;color:var(--muted);margin-left:3px">${_pctStr(Math.abs(total),ativosBase)}%</span>
    </div>
    ${bodyHtml}
  </div>`;

  /* ═══════════════════════════════════════════════════════════════════════
     PASSO 5 — Construir linhas de cada grupo
  ═══════════════════════════════════════════════════════════════════════ */
  // Contas líquidas (corrente, poupança, dinheiro, outros)
  const liquidHtml = accsLiquid.map(a => _row(a)).join('')
    || '<div style="padding:10px 14px;font-size:.8rem;color:var(--muted)">Nenhuma</div>';

  // Investimentos — expandível por tipo de ativo
  let investHtml = '';
  if (accsInvest.length) {
    if (Object.keys(invByType).length) {
      investHtml = accsInvest.map(a => {
        // Mostra a conta + posições abaixo
        const typeRows = invByType; // usaremos details dentro
        return `${_row(a)}`;
      }).join('');
      // Adiciona breakdown por tipo se houver posições
      investHtml += Object.entries(invByType).sort(([,a],[,b])=>b.total-a.total).map(([k,grp]) => `
      <details style="background:var(--surface)">
        <summary style="display:flex;align-items:center;gap:8px;padding:7px 14px 7px 28px;cursor:pointer;list-style:none;border-bottom:1px solid var(--border);background:rgba(59,130,246,.03)">
          <span style="font-size:.9rem">${_invTypeEmoji[k]||'📌'}</span>
          <span style="flex:1;font-size:.78rem;font-weight:600;color:var(--text2)">${_invTypeLabel[k]||k} · ${grp.positions.length} ativo${grp.positions.length!==1?'s':''}</span>
          <span style="font-size:.8rem;font-weight:800;font-family:var(--font-serif)">${dashFmt(grp.total,'BRL')}</span>
          <span style="font-size:.65rem;color:var(--muted);margin-left:3px">▾</span>
        </summary>
        <div style="background:var(--surface2);padding:4px 0">
          ${grp.positions.sort((a,b)=>b._mv-a._mv).map(p => {
            // mv in BRL (for totals/sorting); native values for display
            const mv     = p._mv || 0;  // BRL
            const pCur   = (p.currency && p.currency !== 'BRL') ? p.currency
                         : ((p._accCurrency && p._accCurrency !== 'BRL') ? p._accCurrency : 'BRL');
            const isFxP  = pCur !== 'BRL';
            const qty    = +(p.quantity || 0);
            const avgC   = +(p.avg_cost    || 0);   // native currency
            const cprice = +(p.current_price || 0); // native currency
            const mvNat  = isFxP ? qty * cprice : mv;
            const costNat= qty * avgC;
            const pnlNat = mvNat - costNat;
            const pnlPct = costNat > 0 ? (pnlNat / costNat * 100) : 0;
            return `<div style="display:flex;align-items:center;gap:10px;padding:7px 14px 7px 42px;border-bottom:1px solid var(--border)">
              <div style="flex:1;min-width:0">
                <div style="font-size:.81rem;font-weight:700">${esc(p.ticker||'—')}${isFxP?`<span style="font-size:.56rem;font-weight:800;padding:1px 4px;background:#1e3a8a;color:#fff;border-radius:3px;margin-left:4px">${esc(pCur)}</span>`:''}</div>
                <div style="font-size:.64rem;color:var(--muted)">${qty.toLocaleString('pt-BR',{maximumFractionDigits:4})} un. · PM ${dashFmt(avgC, pCur)}${isFxP?` <span style="opacity:.6">≈ ${dashFmt(typeof toBRL==='function'?toBRL(avgC,pCur):avgC,'BRL')}</span>`:''}</div>
              </div>
              <div style="text-align:right">
                <div style="font-size:.83rem;font-weight:800;font-family:var(--font-serif)">${dashFmt(mvNat, pCur)}</div>
                ${isFxP?`<div style="font-size:.63rem;color:var(--muted)">≈ ${dashFmt(mv,'BRL')}</div>`:''}
                <div style="font-size:.62rem;color:${pnlNat>=0?'#10b981':'#ef4444'};font-weight:700">${pnlNat>=0?'▲':'▼'} ${Math.abs(pnlPct).toFixed(1)}%</div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </details>`).join('');
    } else {
      investHtml = accsInvest.map(a => _row(a)).join('');
    }
  }
  if (!investHtml) investHtml = '<div style="padding:10px 14px;font-size:.8rem;color:var(--muted)">Nenhum</div>';

  // Cartões com saldo positivo (crédito disponível)
  const cardPosHtml = accsCardPos.map(a => _row(a)).join('');

  // Passivos — cartões negativos
  const cardNegHtml = accsCardNeg.map(a => _row(a, true)).join('');

  // Passivos — dívidas
  const debtHtml = debts.length ? debts.map(d => {
    const bal = parseFloat(d.current_balance ?? d.original_amount)||0;
    const balBRL = toBRL(bal, d.currency||'BRL');
    const orig = parseFloat(d.original_amount)||0;
    const quitPct = orig > 0 ? Math.max(0,Math.min(100,((orig-bal)/orig)*100)) : 0;
    const credStr = _cred(d);
    const isFX = _isFX(d.currency||'BRL');
    return `
    <div style="padding:10px 14px;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:flex-start;gap:10px">
        <div style="width:32px;height:32px;border-radius:9px;background:rgba(239,68,68,.1);flex-shrink:0;
          display:flex;align-items:center;justify-content:center;font-size:.95rem">📋</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:.84rem;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_dName(d)}</div>
          <div style="font-size:.66rem;color:var(--muted);margin-top:1px">${credStr?esc(credStr):''}${d.interest_rate?` · ${(+d.interest_rate).toFixed(2)}% a.m.`:''}</div>
          ${orig>0?`<div style="margin-top:5px">
            <div style="display:flex;justify-content:space-between;margin-bottom:2px">
              <span style="font-size:.61rem;color:var(--muted)">Quitado ${quitPct.toFixed(0)}%</span>
              <span style="font-size:.61rem;color:var(--muted)">${d.installments_paid||0}/${d.installment_count||'—'} parcelas</span>
            </div>
            <div style="height:4px;border-radius:4px;background:var(--border);overflow:hidden">
              <div style="height:100%;width:${quitPct.toFixed(1)}%;background:linear-gradient(90deg,#ef4444,#f97316,#10b981);border-radius:4px"></div>
            </div>
          </div>`:''}
        </div>
        <div style="text-align:right;flex-shrink:0;min-width:80px">
          <div style="font-size:.88rem;font-weight:800;font-family:var(--font-serif);color:#ef4444">−${dashFmt(balBRL,'BRL')}</div>
          ${isFX?`<div style="font-size:.63rem;color:var(--muted)">${dashFmt(bal,d.currency||'BRL')}</div>`:''}
          <div style="font-size:.62rem;color:var(--muted)">${_pctStr(balBRL,ativosBase)}% patrimônio</div>
        </div>
      </div>
    </div>`;
  }).join('') : '<div style="padding:10px 14px;font-size:.8rem;color:var(--muted);text-align:center">Nenhuma dívida ativa registrada</div>';

  /* ═══════════════════════════════════════════════════════════════════════
     PASSO 6 — Donut chart (reflete os mesmos 4 componentes)
  ═══════════════════════════════════════════════════════════════════════ */
  const donutSegs = [
    { l:'Contas',       v: Math.max(0,liquidTotal),    c:'#10b981' },
    { l:'Investimentos',v: Math.max(0,invTotal),        c:'#3b82f6' },
    { l:'Crédito disp.',v: accsCardPos.reduce((s,a)=>s+a._balBRL,0), c:'#8b5cf6' },
    { l:'Passivos',     v: totalPassivos,               c:'#ef4444' },
  ].filter(s=>s.v>0);
  const donutTot = donutSegs.reduce((s,g)=>s+g.v,0)||1;
  const R=48,CX=58,CY=58,SW=14; let cum=-90;
  const dPaths = donutSegs.map(seg=>{
    const deg=seg.v/donutTot*360;
    const a1=cum*Math.PI/180, a2=(cum+deg)*Math.PI/180; cum+=deg;
    if(deg>=360) return `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${seg.c}" stroke-width="${SW}"/>`;
    const x1=CX+R*Math.cos(a1),y1=CY+R*Math.sin(a1),x2=CX+R*Math.cos(a2),y2=CY+R*Math.sin(a2);
    return `<path fill="none" stroke="${seg.c}" stroke-width="${SW}" d="M${x1.toFixed(1)},${y1.toFixed(1)} A${R},${R} 0 ${deg>180?1:0},1 ${x2.toFixed(1)},${y2.toFixed(1)}"/>`;
  }).join('');

  /* ═══════════════════════════════════════════════════════════════════════
     PASSO 7 — HTML final
  ═══════════════════════════════════════════════════════════════════════ */
  const html = `<div id="patModal" style="font-family:var(--font-sans,system-ui,sans-serif)">

<!-- ── HEADER ── -->
<div style="padding:16px 16px 12px;border-bottom:1px solid var(--border)">
  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:12px">
    <div>
      <div style="font-size:.58rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:5px">
        🔍 Composição do Patrimônio · Dashboard
      </div>
      <div style="font-size:1.85rem;font-weight:900;font-family:var(--font-serif);color:${patrimonioTotal>=0?'var(--accent)':'#ef4444'};line-height:1;letter-spacing:-.02em">
        ${dashFmt(patrimonioTotal,'BRL')}
      </div>
      <div style="font-size:.67rem;color:var(--muted);margin-top:4px">
        Igual ao valor exibido no Dashboard · ${new Date().toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'})}
      </div>
    </div>
    <div style="display:flex;gap:7px;align-items:flex-start;flex-shrink:0">
      <div style="background:var(--surface2);border:1.5px solid var(--border);border-radius:10px;padding:6px 10px;text-align:center">
        <div style="font-size:1rem;font-weight:900;color:${hColor}">${healthScore}</div>
        <div style="font-size:.56rem;font-weight:700;color:var(--muted);text-transform:uppercase">${hLabel}</div>
      </div>
      <button onclick="closeModal('patrimonioModal')"
        style="background:var(--surface2);border:1px solid var(--border);border-radius:50%;width:30px;height:30px;cursor:pointer;color:var(--text2);font-size:.9rem;display:flex;align-items:center;justify-content:center">✕</button>
    </div>
  </div>

  <!-- Fórmula visível -->
  <div style="background:var(--surface2);border-radius:9px;padding:10px 12px;font-size:.75rem;border:1px solid var(--border)">
    <div style="font-weight:700;color:var(--text);margin-bottom:6px">📐 Como o valor é calculado</div>
    <div style="display:flex;flex-direction:column;gap:3px">
      <div style="display:flex;justify-content:space-between">
        <span style="color:var(--muted)">+ Saldo de todas as contas</span>
        <span style="font-weight:700;font-family:var(--font-serif);color:#10b981">+ ${dashFmt(accountTotal,'BRL')}</span>
      </div>
      ${debtTotal>0?`<div style="display:flex;justify-content:space-between">
        <span style="color:var(--muted)">− Dívidas ativas (${debts.length})</span>
        <span style="font-weight:700;font-family:var(--font-serif);color:#ef4444">− ${dashFmt(debtTotal,'BRL')}</span>
      </div>`:''}
      <div style="border-top:1px solid var(--border);padding-top:5px;margin-top:3px;display:flex;justify-content:space-between">
        <span style="font-weight:800;color:var(--text)">= Patrimônio líquido</span>
        <span style="font-weight:900;font-family:var(--font-serif);color:${patrimonioTotal>=0?'var(--accent)':'#ef4444'}">= ${dashFmt(patrimonioTotal,'BRL')}</span>
      </div>
    </div>
  </div>

  <!-- KPI chips -->
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:10px">
    <div style="background:rgba(16,185,129,.07);border:1px solid rgba(16,185,129,.18);border-radius:9px;padding:8px 10px">
      <div style="font-size:.56rem;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:2px">Contas</div>
      <div style="font-size:.82rem;font-weight:800;color:#10b981;font-family:var(--font-serif)">${dashFmt(accountTotal,'BRL')}</div>
    </div>
    <div style="background:${debtTotal>0?'rgba(239,68,68,.07)':'rgba(16,185,129,.04)'};border:1px solid ${debtTotal>0?'rgba(239,68,68,.18)':'var(--border)'};border-radius:9px;padding:8px 10px">
      <div style="font-size:.56rem;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:2px">Dívidas</div>
      <div style="font-size:.82rem;font-weight:800;color:${debtTotal>0?'#ef4444':'var(--muted)'};font-family:var(--font-serif)">${debtTotal>0?'−'+dashFmt(debtTotal,'BRL'):'Nenhuma'}</div>
    </div>
    <div style="background:${endividamento>0.3?'rgba(239,68,68,.07)':'rgba(16,185,129,.04)'};border:1px solid ${endividamento>0.3?'rgba(239,68,68,.18)':'var(--border)'};border-radius:9px;padding:8px 10px">
      <div style="font-size:.56rem;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:2px">Endividamento</div>
      <div style="font-size:.82rem;font-weight:800;font-family:var(--font-serif);color:${endividamento>0.3?'#ef4444':endividamento>0.15?'#f59e0b':'#10b981'}">${(endividamento*100).toFixed(1)}%</div>
    </div>
  </div>
</div>

<!-- ── DONUT + LEGENDA ── -->
<div style="display:flex;align-items:center;gap:14px;padding:12px 14px;border-bottom:1px solid var(--border);background:var(--surface)">
  <svg viewBox="0 0 116 116" width="82" height="82" style="flex-shrink:0">
    ${dPaths}
    <circle cx="${CX}" cy="${CY}" r="${R-SW/2-1}" fill="var(--surface)"/>
    <text x="${CX}" y="${CY-3}" text-anchor="middle" font-size="9.5" font-weight="900" fill="var(--text)" font-family="var(--font-serif)">${patrimonioTotal>=0?'✓':'!'}</text>
    <text x="${CX}" y="${CY+8}" text-anchor="middle" font-size="5.5" fill="var(--muted)">${hLabel}</text>
  </svg>
  <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:5px">
    ${donutSegs.map(s=>`
    <div style="display:flex;align-items:center;gap:6px">
      <div style="width:8px;height:8px;border-radius:2px;background:${s.c};flex-shrink:0"></div>
      <div style="font-size:.73rem;color:var(--muted);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.l}</div>
      <div style="font-size:.76rem;font-weight:700;font-family:var(--font-serif);white-space:nowrap">${dashFmt(s.v,'BRL')}</div>
      <div style="font-size:.62rem;color:var(--muted);white-space:nowrap">${_pctStr(s.v,donutTot)}%</div>
    </div>`).join('')}
  </div>
</div>

<!-- ── DETALHAMENTO POR CONTA/DÍVIDA ── -->
<div style="background:var(--surface)">

  <!-- ATIVOS -->
  <div style="padding:8px 14px 4px;background:var(--surface2);border-bottom:1px solid var(--border)">
    <span style="font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#10b981">
      ✚ Ativos — ${dashFmt(totalAtivos,'BRL')}
    </span>
  </div>

  ${accsLiquid.length ? `
  <div style="border-bottom:1px solid var(--border)">
    <div style="padding:7px 14px;background:rgba(16,185,129,.04)">
      <span style="font-size:.72rem;font-weight:700;color:#10b981">🏦 Contas & Carteiras — ${dashFmt(liquidTotal,'BRL')}</span>
    </div>
    ${accsLiquid.map(a=>_row(a)).join('')}
  </div>` : ''}

  ${accsInvest.length ? `
  <div style="border-bottom:1px solid var(--border)">
    <div style="padding:7px 14px;background:rgba(59,130,246,.04)">
      <span style="font-size:.72rem;font-weight:700;color:#3b82f6">📊 Investimentos — ${dashFmt(invTotal,'BRL')}</span>
      <span style="font-size:.62rem;color:var(--muted);margin-left:6px">* inclui market value das posições</span>
    </div>
    ${investHtml}
  </div>` : ''}

  ${accsCardPos.length ? `
  <div style="border-bottom:1px solid var(--border)">
    <div style="padding:7px 14px;background:rgba(139,92,246,.04)">
      <span style="font-size:.72rem;font-weight:700;color:#8b5cf6">💳 Cartões — Crédito Disponível — ${dashFmt(accsCardPos.reduce((s,a)=>s+a._balBRL,0),'BRL')}</span>
    </div>
    ${cardPosHtml}
  </div>` : ''}

  ${recvRows.length ? `
  <div style="border-bottom:1px solid var(--border)">
    <div style="padding:7px 14px;background:rgba(30,92,66,.06)">
      <span style="font-size:.72rem;font-weight:700;color:var(--accent)">📬 A Receber (incluído no patrimônio) — +${dashFmt(recvTotal,'BRL')}</span>
    </div>
    ${recvRows.map(r => {
      const rAmt = parseFloat(r.brl_amount ?? r.amount)||0;
      return `<div onclick="navigate('receivables');closeModal('patrimonioModal')" style="display:flex;align-items:center;justify-content:space-between;padding:9px 14px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .12s" onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''">
        <div style="min-width:0;flex:1">
          <div style="font-size:.82rem;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.description||'—')}</div>
          <div style="font-size:.7rem;color:var(--muted)">${fmtDate?fmtDate(r.date):r.date}${r.payees?.name?' · '+esc(r.payees.name):''}</div>
        </div>
        <span style="font-size:.85rem;font-weight:700;color:var(--accent);flex-shrink:0;margin-left:10px">+${dashFmt(rAmt,'BRL')}</span>
      </div>`;
    }).join('')}
  </div>` : ''}

  <!-- PASSIVOS -->
  ${totalPassivos > 0 ? `
  <div style="padding:8px 14px 4px;background:rgba(239,68,68,.05);border-top:2px solid rgba(239,68,68,.2);border-bottom:1px solid var(--border)">
    <span style="font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#ef4444">
      ✕ Passivos — − ${dashFmt(totalPassivos,'BRL')}
    </span>
  </div>

  ${accsCardNeg.length ? `
  <div style="border-bottom:1px solid var(--border)">
    <div style="padding:7px 14px;background:rgba(239,68,68,.04)">
      <span style="font-size:.72rem;font-weight:700;color:#ef4444">💳 Faturas em Aberto — − ${dashFmt(totalCartNeg,'BRL')}</span>
    </div>
    ${cardNegHtml}
  </div>` : ''}

  <div>
    <div style="padding:7px 14px;background:rgba(239,68,68,.04)">
      <span style="font-size:.72rem;font-weight:700;color:#ef4444">📋 Dívidas Ativas (${debts.length}) — − ${dashFmt(debtTotal,'BRL')}</span>
    </div>
    ${debtHtml}
  </div>` : `
  <div style="text-align:center;padding:12px;background:rgba(16,185,129,.05);border-top:1px solid rgba(16,185,129,.15)">
    <span style="font-size:.8rem;font-weight:700;color:#10b981">🎉 Sem passivos — patrimônio livre!</span>
  </div>`}

</div>

<!-- ── ANÁLISE IA ── -->
<div id="patAiCard" style="margin:0;border-top:1px solid var(--border)">
  <!-- Header gradiente -->
  <div style="background:linear-gradient(135deg,#0f2a1e 0%,#163a28 60%,#1a4433 100%);padding:14px 16px 12px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
      <div style="width:34px;height:34px;border-radius:10px;background:rgba(255,255,255,.08);display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0">✨</div>
      <div>
        <div style="font-size:.85rem;font-weight:800;color:#fff;line-height:1.2">Análise com IA</div>
        <div style="font-size:.65rem;color:rgba(255,255,255,.5);font-weight:500">Gemini · Patrimônio</div>
      </div>
      <button id="patAiBtn" onclick="_patAnalyzeWithGemini()"
        style="margin-left:auto;padding:5px 11px;background:rgba(255,255,255,.12);color:rgba(255,255,255,.8);border:1px solid rgba(255,255,255,.15);border-radius:8px;font-size:.72rem;font-weight:700;cursor:pointer;font-family:inherit;touch-action:manipulation;display:none">
        ↺ Refazer
      </button>
    </div>
    <!-- Score bar inline -->
    <div style="display:flex;align-items:center;gap:8px">
      <div style="flex:1;height:4px;background:rgba(255,255,255,.1);border-radius:4px;overflow:hidden">
        <div id="patAiScoreBar" style="height:100%;width:${healthScore}%;background:${hColor};border-radius:4px;transition:width .6s ease"></div>
      </div>
      <span style="font-size:.72rem;font-weight:800;color:${hColor};min-width:28px;text-align:right">${healthScore}</span>
      <span style="font-size:.68rem;color:rgba(255,255,255,.45);font-weight:600">${hLabel}</span>
    </div>
  </div>
  <!-- Resultado da análise -->
  <div id="patAiResult" style="padding:14px 16px;background:var(--surface);min-height:64px">
    <div style="display:flex;align-items:center;gap:8px;color:var(--muted);font-size:.8rem">
      <span id="patAiSpinner" style="display:inline-block;width:14px;height:14px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin 0.8s linear infinite"></span>
      <span>Consultando Gemini…</span>
    </div>
  </div>
</div>
<style>@keyframes spin{to{transform:rotate(360deg)}}</style>

</div>`;/* end patModal */

  /* ── Renderizar modal ── */
  let modal = document.getElementById('patrimonioModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'patrimonioModal';
    modal.className = 'modal-overlay';
    modal.onclick = e => { if (e.target === modal) closeModal('patrimonioModal'); };
    modal.innerHTML = `<div class="modal" style="max-width:500px;max-height:90dvh;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:0;border-radius:16px">
      <div id="patrimonioModalBody"></div>
    </div>`;
    document.body.appendChild(modal);
  }
  // Store metrics for Gemini analysis (avoids JSON-in-onclick issues)
  window._patMetrics = {
    totalAtivos, totalPassivos, patrimonioTotal, debtTotal, totalCartNeg,
    liquidTotal, invTotal, endividamento, healthScore,
    debtsCount: debts.length, accsCount: accs.length, hLabel
  };
  document.getElementById('patrimonioModalBody').innerHTML = html;
  openModal('patrimonioModal');
  // Auto-trigger AI analysis immediately after modal renders
  setTimeout(() => _patAnalyzeWithGemini(), 80);
}
window._openPatrimonioModal = _openPatrimonioModal;

// ── Análise patrimonial com Gemini ────────────────────────────────────────
async function _patAnalyzeWithGemini() {
  const metrics = window._patMetrics || {};
  const btn    = document.getElementById('patAiBtn');
  const result = document.getElementById('patAiResult');
  if (!btn || !result) return;

  // Prevent double-call while running
  if (btn._patRunning) return;
  btn._patRunning = true;

  const apiKey = typeof getGeminiApiKey === 'function'
    ? await getGeminiApiKey().catch(() => '')
    : '';

  if (!apiKey || !apiKey.startsWith('AIza')) {
    result.innerHTML = '<div style="display:flex;align-items:flex-start;gap:8px;padding:8px 12px;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);border-radius:10px"><span style="font-size:1rem;flex-shrink:0">⚠️</span><span style="font-size:.82rem;color:#f59e0b;line-height:1.5">Configure a chave Gemini em <strong>Gerenciar Família → IA</strong> para usar esta análise.</span></div>';
    btn._patRunning = false;
    btn.style.display = '';
    return;
  }

  btn.style.display = 'none';
  result.innerHTML = '<div style="display:flex;align-items:center;gap:8px;color:var(--muted);font-size:.8rem"><span style="display:inline-block;width:14px;height:14px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin 0.8s linear infinite"></span><span>Consultando Gemini…</span></div>';

  // Use configured model, fallback to 1.5-flash (stable, no thinking quirks)
  let _patModel = 'gemini-2.0-flash';
  try {
    const m = typeof getGeminiModel === 'function' ? await getGeminiModel() : null;
    if (m && typeof m === 'string' && m.startsWith('gemini')) _patModel = m;
  } catch(_) {}

  // Safe metric coercion
  const _safe = v => (typeof v === 'number' && isFinite(v)) ? v : 0;
  const _patLiq   = _safe(metrics.patrimonioTotal);
  const _totalAtiv= _safe(metrics.totalAtivos);
  const _liquidAmt= _safe(metrics.liquidTotal);
  const _invAmt   = _safe(metrics.invTotal);
  const _totalPass= _safe(metrics.totalPassivos);
  const _debtAmt  = _safe(metrics.debtTotal);
  const _cardDebt = _safe(metrics.totalCartNeg);
  const _endivPct = _safe(metrics.endividamento);
  const _score    = _safe(metrics.healthScore);
  const _fmt2     = v => 'R$\u00a0' + Math.round(Math.abs(v)).toLocaleString('pt-BR');

  const prompt =
    'Responda APENAS com 2 parágrafos curtos de texto puro (sem markdown, sem asteriscos, sem títulos). Seja direto.\n\n' +
    'Dados financeiros da família:\n' +
    '• Patrimônio líquido: ' + _fmt2(_patLiq) + '\n' +
    '• Ativos: ' + _fmt2(_totalAtiv) + ' (liquidez: ' + _fmt2(_liquidAmt) + ', investimentos: ' + _fmt2(_invAmt) + ')\n' +
    '• Passivos: ' + _fmt2(_totalPass) + ' (dívidas: ' + _fmt2(_debtAmt) + ', cartões: ' + _fmt2(_cardDebt) + ')\n' +
    '• Endividamento: ' + (_endivPct * 100).toFixed(0) + '% | Score: ' + _score + '/100\n\n' +
    'Parágrafo 1: pontos fortes e fracos da situação atual.\n' +
    'Parágrafo 2: 2 ações concretas prioritárias para melhorar.';

  // For 2.5 models, disable thinking to guarantee fast response
  const is25 = /gemini-2\.5/.test(_patModel);
  const genConfig = { temperature: 0.5, maxOutputTokens: 512 };
  if (is25) genConfig.thinkingConfig = { thinkingBudget: 0 };

  const reqBody = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: genConfig,
  });

  // Hard 30s timeout via AbortController — no more infinite spinners
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 30000);

  const _tryFetch = async (model) => {
    const url  = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: reqBody,
      signal: controller.signal,
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error((err?.error?.message) || 'HTTP ' + resp.status);
    }
    return resp.json();
  };

  try {
    let data;
    try {
      data = await _tryFetch(_patModel);
    } catch(primaryErr) {
      if (primaryErr.name === 'AbortError') throw primaryErr;
      // Fallback to stable model if configured model fails
      if (_patModel !== 'gemini-2.5-flash') {
        result.innerHTML = '<div style="display:flex;align-items:center;gap:8px;color:var(--muted);font-size:.8rem"><span style="display:inline-block;width:14px;height:14px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin 0.8s linear infinite"></span><span>Tentando modelo alternativo…</span></div>';
        data = await _tryFetch('gemini-2.5-flash');
      } else {
        throw primaryErr;
      }
    }

    clearTimeout(timeoutId);

    const parts = data?.candidates?.[0]?.content?.parts || [];
    const raw   = parts.map(p => p.text || '').join('').trim();
    if (!raw) throw new Error('Resposta vazia do modelo. Tente novamente.');

    let cleanText = raw
      .replace(/^(aqui (está|estão|vai)|aqui (a análise|está a análise):?\s*)/i, '')
      .replace(/^(claro[,!]?\s*)/i, '')
      .replace(/^(análise[:\s]+)/i, '')
      .trim();

    const _mdToHtml = s => s
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/^#{1,3}\s+/gm, '')
      .replace(/^[-•]\s+/gm, '• ')
      .replace(/^(P[12]:|Parágrafo \d+:)/gm, '')
      .trim();

    const paras = cleanText.split(/\n\n+/).map(p => _mdToHtml(p.trim())).filter(Boolean);
    if (!paras.length) throw new Error('Resposta inválida. Tente novamente.');

    result.innerHTML = paras.map((p, i) =>
      '<p style="margin:0 0 ' + (i < paras.length-1 ? '12' : '0') + 'px;color:var(--text);line-height:1.7;font-size:.85rem">' + p + '</p>'
    ).join('');

  } catch(e) {
    clearTimeout(timeoutId);
    const _msg = e.name === 'AbortError'
      ? 'Tempo limite de 30s atingido. Verifique sua conexão e tente novamente.'
      : (e.message || String(e));
    result.innerHTML = '<div style="display:flex;align-items:flex-start;gap:8px;padding:8px 12px;background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.2);border-radius:10px"><span style="font-size:.9rem;flex-shrink:0">❌</span><span style="font-size:.8rem;color:#ef4444;line-height:1.5">' + (typeof esc === 'function' ? esc(_msg) : _msg) + '</span></div>';
  } finally {
    btn._patRunning = false;
    btn.style.display = '';
  }
}
window._patAnalyzeWithGemini = _patAnalyzeWithGemini;


/* ══════════════════════════════════════════════════════════════════
   DASHBOARD — Card de Orçamentos
══════════════════════════════════════════════════════════════════ */

let _dashBudgetChart = null;

async function _loadDashBudgetsCard() {
  const card = document.getElementById('dashCardBudgets');
  const body = document.getElementById('dashBudgetsBody');
  if (!card || !body) return;

  const prefs = _dashGetPrefs();
  if (prefs['budgets'] === false) { card.style.display = 'none'; return; }
  card.style.display = '';
  body.innerHTML = '<div class="text-muted" style="text-align:center;padding:20px;font-size:.83rem">⏳ Carregando orçamentos…</div>';

  try {
    const now = new Date();
    const y   = now.getFullYear();
    const m   = String(now.getMonth() + 1).padStart(2, '0');
    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();

    // Fetch all budgets and filter client-side (compatible with all schema versions)
    // Excluir pausados do total — paused=true são standby e não contam
    const { data: allBudgets } = await famQ(
      sb.from('budgets').select('id,amount,category_id,budget_type,month,year,paused,categories(id,name,icon,color)')
    ).order('amount', { ascending: false });

    const bRows = (allBudgets || []).filter(b => {
      if (b.paused) return false; // pausados ficam fora do dashboard
      // year column may come as string or number depending on DB driver
      if (b.budget_type === 'annual') return String(b.year) === String(y);
      const bMonth = (b.month || '').slice(0, 7);
      return bMonth === `${y}-${m}`;
    });

    if (!bRows.length) {
      body.innerHTML = `
        <div style="text-align:center;padding:20px 16px;color:var(--muted)">
          <div style="font-size:1.8rem;margin-bottom:6px">🎯</div>
          <div style="font-size:.83rem;font-weight:600">Nenhum orçamento para este mês</div>
          <button class="btn btn-primary btn-sm" style="margin-top:10px" onclick="navigate('budgets')">Criar orçamento</button>
        </div>`;
      return;
    }

    const hasAnnual = bRows.some(b => b.budget_type === 'annual');

    // Fetch spending: current month for monthly budgets; YTD for annual budgets
    // We run two queries in parallel when annual budgets exist
    // Alinhar com módulo de orçamentos: sem filtro de status (inclui pending + confirmed)
    const txMonthQ = famQ(
      sb.from('transactions').select('category_id,amount,brl_amount,currency,category_splits')
    ).gte('date', `${y}-${m}-01`).lte('date', `${y}-${m}-${String(lastDay).padStart(2,'0')}`).lt('amount', 0);

    const txYtdQ = hasAnnual
      ? famQ(sb.from('transactions').select('category_id,amount,brl_amount,currency,category_splits'))
          .gte('date', `${y}-01-01`).lte('date', `${y}-12-31`).lt('amount', 0)
      : Promise.resolve({ data: [] });

    const [{ data: txMonth }, { data: txYtd }] = await Promise.all([txMonthQ, txYtdQ]);

    const _sumBycat = (rows) => {
      // Considera category_splits igual ao _buildRawSpending do módulo de orçamentos
      const map = {};
      (rows || []).forEach(t => {
        if (Array.isArray(t.category_splits) && t.category_splits.length >= 2) {
          t.category_splits.forEach(s => {
            if (s.category_id && s.amount > 0) {
              map[s.category_id] = (map[s.category_id] || 0) + Math.abs(s.amount);
            }
          });
        } else if (t.category_id) {
          map[t.category_id] = (map[t.category_id] || 0) + Math.abs(parseFloat(t.amount) || 0);
        }
      });
      return map;
    };
    const spentMonthBycat = _sumBycat(txMonth);
    const spentYtdBycat   = hasAnnual ? _sumBycat(txYtd) : spentMonthBycat;

    // Helper: soma categoria pai + todas as subcategorias (igual ao _categoryFamily do módulo)
    const _catFamily = (catId) => {
      const cats = state.categories || [];
      const ids = new Set([catId]);
      // Nível 1: filhos diretos
      cats.forEach(c => { if (c.parent_id === catId) ids.add(c.id); });
      // Nível 2: filhos dos filhos
      const lvl1 = new Set(ids);
      cats.forEach(c => { if (lvl1.has(c.parent_id) && c.id !== catId) ids.add(c.id); });
      return ids;
    };

    // Sort: most exceeded first, then by % used desc
    // Annual budgets use YTD spending; monthly use current-month spending
    const enriched = bRows.map(b => {
      const limit    = parseFloat(b.amount) || 0;
      const spentMap = b.budget_type === 'annual' ? spentYtdBycat : spentMonthBycat;
      // Somar hierarquia de subcategorias (igual ao módulo)
      const famIds = _catFamily(b.category_id);
      let spent = 0;
      famIds.forEach(cid => { spent += (spentMap[cid] || 0); });
      const pct  = limit > 0 ? (spent / limit) * 100 : 0;
      const over = spent > limit;
      return { ...b, limit, spent, pct, over };
    }).sort((a, b) => (b.over - a.over) || (b.pct - a.pct));

    const totalLimit  = enriched.reduce((s, b) => s + b.limit, 0);
    const totalSpent  = enriched.reduce((s, b) => s + b.spent, 0);
    const overallPct  = totalLimit > 0 ? Math.min((totalSpent / totalLimit) * 100, 100) : 0;
    const overCount   = enriched.filter(b => b.over).length;

    // Donut chart data
    const chartLabels = enriched.slice(0, 8).map(b => b.categories?.name || 'Sem categoria');
    const chartSpent  = enriched.slice(0, 8).map(b => b.spent);
    const chartColors = enriched.slice(0, 8).map((b, i) => {
      const base = b.categories?.color || ['#2a6049','#1d4ed8','#b45309','#7c3aed','#dc2626','#059669','#d97706','#0891b2'][i % 8];
      return b.over ? '#dc2626' : base;
    });

    // Build HTML — compact layout matching investments card
    let html = '';

    // Hero KPI row
    const kpiColor = totalSpent > totalLimit ? 'var(--red)' : overallPct >= 90 ? '#b45309' : 'var(--accent)';
    const pctColor = overallPct >= 90 ? 'var(--red)' : overallPct >= 70 ? '#b45309' : 'var(--accent)';
    html += `
      <div style="display:flex;justify-content:space-between;align-items:center;
        padding:12px 16px 10px;border-bottom:1px solid var(--border);
        background:linear-gradient(135deg,rgba(180,83,9,.05),transparent)">
        <div>
          <div style="font-size:.65rem;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.06em">Total gasto</div>
          <div style="font-size:1.35rem;font-weight:800;font-family:var(--font-serif);color:${kpiColor};line-height:1.1">${dashFmt(totalSpent,'BRL')}</div>
          <div style="font-size:.68rem;color:var(--muted);margin-top:2px">de ${dashFmt(totalLimit,'BRL')}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:.65rem;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.06em">Uso geral</div>
          <div style="font-size:.95rem;font-weight:800;color:${pctColor}">${overallPct.toFixed(0)}%</div>
          <div style="font-size:.7rem;color:${overCount>0?'var(--red)':'var(--muted)'}">
            ${overCount > 0 ? overCount + ' estourado' + (overCount > 1 ? 's' : '') : 'dentro do limite'}
          </div>
        </div>
      </div>`;

    // Budget rows — compact vertical list
    html += '<div style="padding:8px 14px 4px;display:flex;flex-direction:column;gap:6px">';
    enriched.slice(0, 6).forEach(b => {
      const icon    = b.categories?.icon || '📦';
      const name    = b.categories?.name || 'Sem categoria';
      const color   = b.over ? '#dc2626' : (b.categories?.color || 'var(--accent)');
      const barPct  = Math.min(b.pct, 100);
      const catIdSafe = (b.category_id||'').replace(/'/g,'');
      const nameSafe  = (name||'').replace(/'/g,'').replace(/"/g,'');
      html += `
        <div style="cursor:pointer;border-radius:7px;padding:5px 6px;margin:-5px -6px;transition:background .12s"
          onclick="_openBudgetTxModal('${catIdSafe}','${nameSafe}','${b.budget_type||'monthly'}')"
          onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px">
            <span style="font-size:.78rem;font-weight:600;color:var(--text);display:flex;align-items:center;gap:4px;min-width:0;overflow:hidden">
              <span style="flex-shrink:0">${icon}</span>
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</span>
              ${b.budget_type==='annual'?'<span style="flex-shrink:0;font-size:.55rem;background:rgba(29,78,216,.1);color:#1d4ed8;border-radius:4px;padding:1px 4px">YTD</span>':''}
            </span>
            <span style="font-size:.72rem;font-weight:700;color:${color};flex-shrink:0;margin-left:6px">${b.pct.toFixed(0)}%</span>
          </div>
          <div style="height:4px;border-radius:3px;background:var(--border);overflow:hidden">
            <div style="height:100%;width:${barPct}%;background:${color};border-radius:3px;transition:width .5s ease"></div>
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:2px">
            <span style="font-size:.6rem;color:var(--muted)">${dashFmt(b.spent,'BRL')}</span>
            <span style="font-size:.6rem;color:var(--muted)">${dashFmt(b.limit,'BRL')}</span>
          </div>
        </div>`;
    });
    if (enriched.length > 6) {
      html += `<div style="font-size:.7rem;color:var(--muted);text-align:center;padding:3px 0">+ ${enriched.length - 6} categoria${enriched.length-6!==1?'s':''}</div>`;
    }
    html += '</div>';
    html += `<div style="padding:4px 14px 10px;text-align:right">
      <button class="btn btn-ghost btn-sm" onclick="navigate('budgets')" style="font-size:.72rem">Ver orçamentos →</button>
    </div>`;

    // Objetivos ativos (compact)
    let objHtml = '';
    try {
      const today = (typeof localDateStr==='function') ? localDateStr() : new Date().toISOString().slice(0,10);
      const fid = typeof famId==='function' ? famId() : null;
      let objs = [];
      if (fid) {
        if (window._objList && window._objList.length) {
          objs = window._objList;
        } else {
          const { data: objData } = await famQ(
            sb.from('financial_objectives').select('id,name,icon,status,budget_limit,start_date,end_date')
          ).order('start_date', { ascending: false });
          objs = objData || [];
          window._objList = objs;
        }
      }
      const activeObjs = objs.filter(o =>
        o.status !== 'closed' &&
        (!o.end_date || o.end_date >= today) &&
        today >= (o.start_date || '0000-00-00')
      ).slice(0, 5);

      if (activeObjs.length) {
        const objIds = activeObjs.map(o => o.id);
        const { data: objTxs } = await famQ(
          sb.from('transactions').select('objective_id,amount')
        ).in('objective_id', objIds).lt('amount', 0);

        const spentByObj = {};
        (objTxs || []).forEach(t => {
          spentByObj[t.objective_id] = (spentByObj[t.objective_id] || 0) + Math.abs(parseFloat(t.amount)||0);
        });

        const objRows = activeObjs.map(o => {
          const spent = spentByObj[o.id] || 0;
          const limit = o.budget_limit ? parseFloat(o.budget_limit) : 0;
          const pct   = limit > 0 ? Math.min((spent / limit) * 100, 100) : 0;
          const over  = limit > 0 && spent > limit;
          const color = over ? '#dc2626' : 'var(--accent)';
          return `<div style="cursor:pointer;border-radius:7px;padding:5px 6px;margin:-5px -6px;transition:background .12s"
              onclick="typeof openObjectiveDetail==='function'&&openObjectiveDetail('${o.id}')"
              onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:${limit>0?'3':'0'}px">
              <span style="display:flex;align-items:center;gap:4px;min-width:0;overflow:hidden">
                <span style="flex-shrink:0;font-size:.82rem">${o.icon||'🎯'}</span>
                <span style="font-size:.77rem;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(o.name||'—')}</span>
              </span>
              <span style="flex-shrink:0;margin-left:6px;font-size:.72rem;font-weight:700;color:${over?'var(--red)':pct>=90?'#b45309':'var(--muted)'}">
                ${limit>0 ? pct.toFixed(0)+'%' : dashFmt(spent,'BRL')}
              </span>
            </div>
            ${limit>0?`<div style="height:4px;border-radius:3px;background:var(--border);overflow:hidden">
              <div style="height:100%;width:${pct.toFixed(1)}%;background:${color};border-radius:3px;transition:width .5s ease"></div>
            </div>
            <div style="display:flex;justify-content:space-between;margin-top:2px">
              <span style="font-size:.6rem;color:var(--muted)">${dashFmt(spent,'BRL')}</span>
              <span style="font-size:.6rem;color:var(--muted)">${dashFmt(limit,'BRL')}</span>
            </div>`:``}
          </div>`;
        }).join('');

        objHtml = `
          <div style="border-top:1px solid var(--border);padding:8px 14px 4px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px">
              <span style="font-size:.66rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--accent)">🎯 Objetivos Ativos</span>
              <span style="font-size:.68rem;color:var(--muted)">${activeObjs.length}</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px">${objRows}</div>
          </div>
          <div style="padding:4px 14px 10px;text-align:right">
            <button class="btn btn-ghost btn-sm" onclick="navigate('objectives')" style="font-size:.72rem">Ver objetivos →</button>
          </div>`;
      }
    } catch(eObj) {
      console.warn('[dash budgets] objectives:', eObj?.message);
    }
    // Combine: budgets + objectives (vertical stack)
    const finalHtml = html + objHtml;

    if (_dashBudgetChart) { try { _dashBudgetChart.destroy(); } catch(_) {} _dashBudgetChart = null; }
    body.innerHTML = finalHtml;

  } catch(e) {
    body.innerHTML = `<div class="text-muted" style="text-align:center;padding:16px;font-size:.8rem">⚠️ ${esc(e.message)}</div>`;
  }
}
window._loadDashBudgetsCard = _loadDashBudgetsCard;

// ── Modal: transações que compõem um orçamento ─────────────────────────────
async function _openBudgetTxModal(categoryId, categoryName, budgetType) {
  // Calcular período
  const now = new Date();
  const y   = now.getFullYear();
  const m   = String(now.getMonth() + 1).padStart(2, '0');
  const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
  const dateFrom = budgetType === 'annual' ? `${y}-01-01` : `${y}-${m}-01`;
  const dateTo   = budgetType === 'annual' ? `${y}-12-31` : `${y}-${m}-${String(lastDay).padStart(2,'0')}`;
  const period   = budgetType === 'annual' ? `Ano ${y}` : `${String(now.getMonth()+1).padStart(2,'0')}/${y}`;

  // Coletar ids da família de categorias (pai + filhos)
  const allCats = state.categories || [];
  const famIds = new Set([categoryId]);
  allCats.forEach(c => { if (c.parent_id === categoryId) famIds.add(c.id); });
  const lvl1 = new Set(famIds);
  allCats.forEach(c => { if (lvl1.has(c.parent_id)) famIds.add(c.id); });

  // Criar/reabrir modal
  document.getElementById('budgetTxModal')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  overlay.id = 'budgetTxModal';
  overlay.style.zIndex = '10020';
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="modal" style="max-width:520px;max-height:85dvh;display:flex;flex-direction:column">
      <div class="modal-handle"></div>
      <div class="modal-header" style="flex-shrink:0">
        <div>
          <div class="modal-title">${esc(categoryName)}</div>
          <div style="font-size:.7rem;color:var(--muted);margin-top:1px">Transações do orçamento · ${period}</div>
        </div>
        <button class="modal-close" onclick="document.getElementById('budgetTxModal')?.remove()">✕</button>
      </div>
      <div id="budgetTxBody" style="flex:1;overflow-y:auto;padding:14px 16px">
        <div style="text-align:center;padding:24px;color:var(--muted);font-size:.83rem">⏳ Carregando…</div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const body = document.getElementById('budgetTxBody');
  try {
    const { data: txs, error } = await famQ(
      sb.from('transactions')
        .select('id,date,description,amount,currency,brl_amount,payees(name),accounts!transactions_account_id_fkey(name,icon,color)')
    ).in('category_id', [...famIds])
     .gte('date', dateFrom).lte('date', dateTo)
     .lt('amount', 0)
     .order('date', { ascending: false });

    if (error) throw error;
    if (!txs || !txs.length) {
      body.innerHTML = `<div style="text-align:center;padding:32px 16px;color:var(--muted)">
        <div style="font-size:2rem;margin-bottom:8px">📭</div>
        <div style="font-size:.85rem">Nenhuma transação neste período para este orçamento.</div>
      </div>`;
      return;
    }

    const total = txs.reduce((s, t) => s + Math.abs(parseFloat(t.amount)||0), 0);
    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--border)">
        <span style="font-size:.75rem;color:var(--muted)">${txs.length} transaç${txs.length===1?'ão':'ões'}</span>
        <span style="font-size:.95rem;font-weight:800;font-family:var(--font-serif);color:var(--red,#dc2626)">−${dashFmt(total,'BRL')}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">`;

    txs.forEach(t => {
      const amt     = Math.abs(parseFloat(t.amount)||0);
      const payee   = t.payees?.name || '';
      const acct    = t.accounts?.name || '';
      const desc    = t.description || payee || '—';
      const sub     = [payee !== desc ? payee : '', acct].filter(Boolean).join(' · ');
      html += `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;background:var(--surface2);cursor:pointer;transition:background .12s"
          onclick="document.getElementById('budgetTxModal')?.remove();editTransaction('${t.id}')"
          onmouseover="this.style.background='var(--bg2,rgba(0,0,0,.04))'" onmouseout="this.style.background='var(--surface2)'">
          <div style="flex:1;min-width:0">
            <div style="font-size:.83rem;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(desc)}</div>
            <div style="font-size:.67rem;color:var(--muted)">${fmtDate(t.date)}${sub ? ' · ' + esc(sub) : ''}</div>
          </div>
          <div style="font-size:.88rem;font-weight:700;font-family:var(--font-serif);color:var(--red,#dc2626);flex-shrink:0">−${dashFmt(amt,'BRL')}</div>
        </div>`;
    });
    html += `</div>`;
    body.innerHTML = html;
  } catch(e) {
    body.innerHTML = `<div style="text-align:center;padding:20px;color:var(--muted);font-size:.82rem">⚠️ ${esc(e.message)}</div>`;
  }
}
window._openBudgetTxModal = _openBudgetTxModal;

/* ══════════════════════════════════════════════════════════════════
   DASHBOARD — Card de Investimentos
══════════════════════════════════════════════════════════════════ */

let _dashInvChart = null;

async function _loadDashInvestmentsCard() {
  const card = document.getElementById('dashCardInvestments');
  const body = document.getElementById('dashInvestmentsBody');
  if (!card || !body) return;

  const prefs = _dashGetPrefs();

  if (prefs['investments'] === false) { card.style.display = 'none'; return; }
  card.style.display = '';
  body.innerHTML = '<div class="text-muted" style="text-align:center;padding:20px;font-size:.83rem">⏳ Carregando carteira…</div>';

  try {
    // Garantir que investimentos estão carregados — força reload se positions vazia
    if (typeof loadInvestments === 'function') {
      const needLoad = typeof _inv === 'undefined' || !_inv.loaded || (_inv.positions || []).length === 0;
      if (needLoad) {
        try { await loadInvestments(true); } catch(e) { console.warn('[inv card]', e?.message); }
      }
    }

    // Fallback: buscar posições direto do banco se _inv ainda vazio
    let positions = (typeof _inv !== 'undefined') ? (_inv.positions || []) : [];
    if (!positions.length && sb) {
      try {
        const { data: posData } = await famQ(
          sb.from('investment_positions').select('*')
        ).order('ticker');
        positions = (posData || []).filter(p => (+(p.quantity) || 0) > 0);
      } catch(e) { console.warn('[inv card] direct fetch:', e?.message); }
    }

    const totalMV = positions.length
      ? positions.reduce((s, p) => {
          const price = (p.currency && p.currency !== 'BRL')
            ? toBRL(+(p.current_price||0), p.currency)
            : +(p.current_price||0);
          return s + (+(p.quantity)||0) * price;
        }, 0)
      : (typeof invTotalPortfolioValue === 'function' ? invTotalPortfolioValue() : 0);

    if (!positions.length) {
      // Check if module is truly disabled or just empty
      const invModEnabled = (typeof isModuleEnabled === 'function') ? isModuleEnabled('investments') : false;
      body.innerHTML = invModEnabled
        ? `<div style="text-align:center;padding:24px 16px;color:var(--muted)">
            <div style="font-size:2rem;margin-bottom:8px">📊</div>
            <div style="font-size:.83rem;font-weight:600">Nenhuma posição registrada</div>
            <button class="btn btn-primary btn-sm" style="margin-top:10px" onclick="navigate('investments')">Registrar investimento</button>
          </div>`
        : `<div style="text-align:center;padding:24px 16px;color:var(--muted)">
            <div style="font-size:2rem;margin-bottom:8px">📈</div>
            <div style="font-size:.83rem;font-weight:600;color:var(--text2);margin-bottom:6px">Módulo de Investimentos</div>
            <div style="font-size:.78rem;line-height:1.5;margin-bottom:14px">Ative este módulo nas configurações da família.</div>
            <button class="btn btn-ghost btn-sm" onclick="navigate('settings')">Configurar módulo →</button>
          </div>`;
      return;
    }

    // Agrupamento por tipo
    const byType = {};
    positions.forEach(p => {
      const k = p.asset_type || 'outro';
      if (!byType[k]) byType[k] = { total: 0, count: 0 };
      const mv = (typeof _invMarketValue === 'function') ? _invMarketValue(p) : (+(p.quantity||0) * (+(p.current_price||p.avg_cost||0)));
      byType[k].total += mv;
      byType[k].count++;
    });

    const typeEmoji = { acao_br:'🇧🇷',fii:'🏢',etf_br:'📊',acao_us:'🇺🇸',etf_us:'📈',bdr:'🌐',fundo:'🏦',crypto:'₿',renda_fixa:'💰',outro:'📌' };
    const typeLabel = { acao_br:'Ações BR',fii:'FII',etf_br:'ETF BR',acao_us:'Ações US',etf_us:'ETF US',bdr:'BDR',fundo:'Fundos',crypto:'Cripto',renda_fixa:'Renda Fixa',outro:'Outros' };

    // KPI total + retorno
    const totalCost = positions.reduce((s,p) => s + (+(p.quantity||0) * (+(p.avg_cost||0))), 0);
    const pnl       = totalMV - totalCost;
    const pnlPct    = totalCost > 0 ? (pnl / totalCost * 100) : 0;

    // ── Individual positions by value descending ──
    const sortedPositions = [...positions]
      .map(p => {
        const price = (p.currency && p.currency !== 'BRL')
          ? toBRL(+(p.current_price||0), p.currency)
          : +(p.current_price||0);
        const mv    = (+(p.quantity)||0) * price;
        const cost  = (+(p.quantity)||0) * (+(p.avg_cost)||0);
        const pnlP  = mv - cost;
        const pnlPP = cost > 0 ? (pnlP / cost * 100) : 0;
        return { ...p, _mv: mv, _cost: cost, _pnl: pnlP, _pnlPct: pnlPP };
      })
      .filter(p => p._mv > 0)
      .sort((a, b) => b._mv - a._mv);

    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px 10px;border-bottom:1px solid var(--border);background:linear-gradient(135deg,rgba(30,91,66,.06),transparent)">
        <div>
          <div style="font-size:.65rem;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.06em">Valor de mercado</div>
          <div style="font-size:1.35rem;font-weight:800;font-family:var(--font-serif);color:var(--accent);line-height:1.1">${dashFmt(totalMV,'BRL')}</div>
          <div style="font-size:.68rem;color:var(--muted);margin-top:2px">${sortedPositions.length} posições</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:.65rem;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.06em">Resultado total</div>
          <div style="font-size:.95rem;font-weight:800;color:${pnl>=0?'var(--accent)':'var(--red)'}">
            ${pnl>=0?'+':''}${dashFmt(pnl,'BRL')}
          </div>
          <div style="font-size:.7rem;font-weight:700;color:${pnlPct>=0?'var(--accent)':'var(--red)'}">
            ${pnlPct>=0?'▲':'▼'} ${Math.abs(pnlPct).toFixed(2)}%
          </div>
        </div>
      </div>`;

    // Chart + bars layout
    const sortedTypes = Object.entries(byType).sort(([,a],[,b]) => b.total - a.total);
    const typeColors  = ['#2a6049','#1d4ed8','#b45309','#7c3aed','#dc2626','#059669','#d97706','#0891b2','#be185d','#0369a1'];

    html += `
      <div style="display:flex;gap:0;align-items:flex-start">
        <div style="flex:0 0 120px;padding:12px 8px 8px 12px;display:flex;flex-direction:column;align-items:center;gap:4px">
          <canvas id="dashInvDonut" width="100" height="100" style="max-width:100px;max-height:100px"></canvas>
          <div style="font-size:.6rem;color:var(--muted);text-align:center;margin-top:2px">por tipo</div>
        </div>
        <div style="flex:1;padding:10px 14px 8px 6px;display:flex;flex-direction:column;gap:7px">`;

    sortedTypes.slice(0, 6).forEach(([k, grp], i) => {
      const pct   = totalMV > 0 ? (grp.total / totalMV * 100) : 0;
      const color = typeColors[i % typeColors.length];
      html += `
          <div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px">
              <span style="font-size:.74rem;font-weight:700;color:var(--text);display:flex;align-items:center;gap:5px">
                <span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${color};flex-shrink:0"></span>
                ${typeEmoji[k]||'📌'} ${typeLabel[k]||k}
              </span>
              <span style="font-size:.72rem;font-weight:700;color:var(--text2);white-space:nowrap">${dashFmt(grp.total,'BRL')} <span style="color:var(--muted);font-weight:400">${pct.toFixed(1)}%</span></span>
            </div>
            <div style="height:4px;border-radius:2px;background:var(--border);overflow:hidden">
              <div style="height:100%;width:${Math.min(pct,100)}%;background:${color};border-radius:3px;transition:width .4s ease"></div>
            </div>
            <div style="display:flex;justify-content:space-between;margin-top:2px">
              <span style="font-size:.62rem;color:var(--muted)">${grp.count} ativo${grp.count!==1?'s':''}</span>
              <span style="font-size:.62rem;color:var(--muted)">${dashFmt(grp.total,'BRL')}</span>
            </div>
          </div>`;
    });

    html += `
        </div>
      </div>
      <div style="padding:6px 14px 10px;text-align:right">
        <button class="btn btn-ghost btn-sm" onclick="navigate('investments')">Ver carteira completa →</button>
      </div>`;

    // ── Individual positions list ─────────────────────────────────────
    if (sortedPositions.length > 0) {
      html += `
        <div style="border-top:1px solid var(--border);padding:10px 14px 12px">
          <div style="font-size:.63rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:8px">Posições</div>
          <div style="display:flex;flex-direction:column;gap:5px">`;
      sortedPositions.slice(0, 7).forEach(p => {
        html += `
            <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;background:var(--bg2);cursor:pointer"
              onclick="navigate('investments')">
              <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:baseline;gap:5px">
                  <span style="font-size:.8rem;font-weight:800;color:var(--text)">${esc(p.ticker)}</span>
                  <span style="font-size:.66rem;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100px">${esc(p.name||'')}</span>
                </div>
                <div style="font-size:.63rem;color:var(--muted)">${+(p.quantity)||0} un.</div>
              </div>
              <div style="text-align:right;flex-shrink:0">
                <div style="font-size:.82rem;font-weight:700;color:var(--text)">${dashFmt(p._mv,'BRL')}</div>
                <div style="font-size:.64rem;font-weight:700;color:${p._pnl>=0?'var(--accent)':'var(--red)'}">${p._pnl>=0?'+':''}${dashFmt(p._pnl,'BRL')}</div>
              </div>
            </div>`;
      });
      if (sortedPositions.length > 7) {
        html += `<div style="text-align:center;padding:5px 0;font-size:.7rem;color:var(--accent);cursor:pointer;font-weight:600" onclick="navigate('investments')">
          +${sortedPositions.length - 7} posições → ver carteira completa
        </div>`;
      }
      html += `</div></div>`;
    }

    // Destroy previous chart BEFORE replacing innerHTML
    if (_dashInvChart) { try { _dashInvChart.destroy(); } catch(_) {} _dashInvChart = null; }
    body.innerHTML = html;

    // Render donut
    const invCanvas = document.getElementById('dashInvDonut');
    if (invCanvas && typeof Chart !== 'undefined' && sortedTypes.length) {
      _dashInvChart = new Chart(invCanvas, {
        type: 'doughnut',
        data: {
          labels: sortedTypes.slice(0,6).map(([k]) => typeLabel[k]||k),
          datasets: [{
            data: sortedTypes.slice(0,6).map(([,g]) => g.total),
            backgroundColor: sortedTypes.slice(0,6).map((_,i) => typeColors[i%typeColors.length]),
            borderColor: 'var(--surface)',
            borderWidth: 2,
          }],
        },
        options: {
          responsive: false,
          cutout: '62%',
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: ctx => ` ${ctx.label}: ${dashFmt(ctx.parsed,'BRL')}`,
              },
            },
          },
        },
      });
    }
  } catch(e) {
    body.innerHTML = `<div class="text-muted" style="text-align:center;padding:16px;font-size:.8rem">⚠️ Erro ao carregar: ${esc(e.message)}</div>`;
  }
}
window._loadDashInvestmentsCard = _loadDashInvestmentsCard;

/* ══════════════════════════════════════════════════════════════════
   DASHBOARD — Card de Sonhos
══════════════════════════════════════════════════════════════════ */

async function _loadDashDreamsCard() {
  const card = document.getElementById('dashCardDreams');
  const body = document.getElementById('dashDreamsBody');
  if (!card || !body) return;

  const prefs = _dashGetPrefs();

  // Verificar se módulo dreams está habilitado para a família
  const modEnabled = (typeof isModuleEnabled === 'function')
    ? isModuleEnabled('dreams')
    : true;

  if (prefs['dreams'] === false) { card.style.display = 'none'; return; }

  if (!modEnabled) {
    body.innerHTML = `<div style="text-align:center;padding:24px 16px;color:var(--muted)">
      <div style="font-size:2rem;margin-bottom:8px">🌟</div>
      <div style="font-size:.83rem;font-weight:600;color:var(--text2);margin-bottom:6px">Módulo de Sonhos</div>
      <div style="font-size:.78rem;line-height:1.5;margin-bottom:14px">Ative este módulo nas configurações da família para acompanhar seus sonhos financeiros.</div>
      <button class="btn btn-ghost btn-sm" onclick="navigate('settings')">Configurar módulo →</button>
    </div>`;
    return;
  }

  body.innerHTML = '<div class="text-muted" style="text-align:center;padding:20px;font-size:.83rem">⏳ Carregando sonhos…</div>';

  try {
    // Carregar sonhos se não estiver no cache
    let dreams = [];
    if (typeof _drm !== 'undefined' && _drm.dreams?.length) {
      dreams = _drm.dreams.filter(d => d.status === 'active');
    } else {
      const { data } = await famQ(
        sb.from('dreams').select('*, dream_contributions(amount)').eq('status','active').order('priority').limit(5)
      );
      dreams = data || [];
    }

    if (!dreams.length) {
      body.innerHTML = `
        <div style="text-align:center;padding:24px 16px;color:var(--muted)">
          <div style="font-size:2rem;margin-bottom:8px">🌟</div>
          <div style="font-size:.83rem;font-weight:600">Nenhum sonho ativo</div>
          <button class="btn btn-primary btn-sm" style="margin-top:10px" onclick="navigate('dreams')">Criar meu primeiro sonho</button>
        </div>`;
      return;
    }

    const _dreamEmoji = { viagem:'✈️', automovel:'🚗', imovel:'🏠', cirurgia_plastica:'💉', estudos:'🎓', outro:'🌟' };

    // Total acumulado / total meta
    const totalMeta  = dreams.reduce((s,d) => s + (+(d.target_amount)||0), 0);
    const totalAcum  = dreams.reduce((s,d) => {
      const contribs = Array.isArray(d.dream_contributions) ? d.dream_contributions : (d._contributions || []);
      return s + contribs.reduce((cs, c) => cs + (+(c.amount)||0), 0);
    }, 0);
    const totalPct   = totalMeta > 0 ? Math.min(totalAcum / totalMeta * 100, 100) : 0;

    let html = `
      <div style="padding:14px 16px 10px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-size:.72rem;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em">${dreams.length} sonho${dreams.length!==1?'s':''} ativo${dreams.length!==1?'s':''}</div>
          <div style="font-size:1rem;font-weight:800;font-family:var(--font-serif);color:var(--accent)">${dashFmt(totalAcum,'BRL')} de ${dashFmt(totalMeta,'BRL')}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:.72rem;color:var(--muted);margin-bottom:3px">${totalPct.toFixed(0)}% concluído</div>
          <div style="width:80px;height:6px;border-radius:3px;background:var(--border);overflow:hidden">
            <div style="height:100%;width:${totalPct.toFixed(1)}%;background:var(--accent);border-radius:3px;transition:width .6s ease"></div>
          </div>
        </div>
      </div>
      <div style="padding:10px 16px;display:flex;flex-direction:column;gap:8px">`;

    dreams.slice(0, 4).forEach(d => {
      const contribs = Array.isArray(d.dream_contributions) ? d.dream_contributions : (d._contributions || []);
      const acum   = contribs.reduce((s,c) => s + (+(c.amount)||0), 0);
      const meta   = +(d.target_amount) || 0;
      const pct    = meta > 0 ? Math.min(acum / meta * 100, 100) : 0;
      const emoji  = _dreamEmoji[d.dream_type] || '🌟';
      const prioColor = d.priority === 1 ? 'var(--red)' : d.priority === 2 ? 'var(--amber)' : 'var(--muted)';

      html += `
        <div style="cursor:pointer" onclick="navigate('dreams')"
          onmouseover="this.style.opacity='.8'" onmouseout="this.style.opacity='1'">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span style="font-size:.9rem">${emoji}</span>
            <div style="flex:1;min-width:0">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <span style="font-size:.82rem;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.title||'—')}</span>
                <span style="font-size:.72rem;color:var(--muted);flex-shrink:0;margin-left:6px">${pct.toFixed(0)}%</span>
              </div>
              <div style="display:flex;justify-content:space-between;font-size:.68rem;color:var(--muted)">
                <span>${dashFmt(acum,'BRL')} / ${dashFmt(meta,'BRL')}</span>
                <span style="color:${prioColor}">P${d.priority||1}</span>
              </div>
            </div>
          </div>
          <div style="height:4px;border-radius:2px;background:var(--border);overflow:hidden">
            <div style="height:100%;width:${pct.toFixed(1)}%;background:var(--accent);border-radius:2px;transition:width .5s ease"></div>
          </div>
        </div>`;
    });

    if (dreams.length > 4) {
      html += `<div style="font-size:.75rem;color:var(--muted);text-align:center;padding-top:4px">+ ${dreams.length - 4} sonho${dreams.length-4!==1?'s':''}</div>`;
    }

    html += `<div style="text-align:center;margin-top:4px">
      <button class="btn btn-ghost btn-sm" onclick="navigate('dreams')">Ver todos os sonhos →</button>
    </div></div>`;

    body.innerHTML = html;
  } catch(e) {
    body.innerHTML = `<div class="text-muted" style="text-align:center;padding:16px;font-size:.8rem">⚠️ Erro ao carregar: ${esc(e.message)}</div>`;
  }
}
window._loadDashDreamsCard = _loadDashDreamsCard;

window._loadDashDreamsCard = _loadDashDreamsCard;

// ── Open new-tx modal pre-filled with a specific account ────────────────
function _dashFavAddTx(accountId) {
  // Open the transaction modal — pre-fill the account
  if (typeof openTransactionModal === 'function') {
    openTransactionModal();
  } else if (typeof openTxModal === 'function') {
    openTxModal();
  }
  // Pre-fill the origin account after the modal has rendered
  requestAnimationFrame(() => setTimeout(() => {
    const sel = document.getElementById('txAccountId');
    if (sel && accountId) {
      sel.value = accountId;
      sel.dispatchEvent(new Event('change'));
    }
    // Also set the account filter so navigating to transactions keeps context
    if (state && accountId) state.txFilter = { ...state.txFilter, account: accountId };
  }, 200));
}
window._dashFavAddTx = _dashFavAddTx;

// ── Card: Top Beneficiários e Fontes Pagadoras ────────────────────────────
// Estado do switch: 'year' (padrão) | 'alltime'
let _dashPayeePeriod = 'year';

async function _loadDashTopPayeesCard(period) {
  const card = document.getElementById('dashCardTopPayees');
  const body = document.getElementById('dashTopPayeesBody');
  if (!card || !body) return;

  const prefs = _dashGetPrefs();
  if (prefs['toppayees'] === false) { card.style.display = 'none'; return; }
  card.style.display = '';

  // Usa período passado ou o estado atual
  if (period) _dashPayeePeriod = period;
  const isYear = _dashPayeePeriod !== 'alltime';

  body.innerHTML = '<div class="dcard-loading">⏳ Carregando…</div>';

  try {
    const now = new Date();
    const y   = now.getFullYear();
    const _sel = 'id,date,description,amount,brl_amount,currency,payee_id,payees(id,name,type),categories(name,color)';

    // Query: ano corrente ou todos os tempos
    let q = famQ(sb.from('transactions').select(_sel)).not('payee_id','is',null);
    if (isYear) {
      q = q.gte('date', `${y}-01-01`).lte('date', `${y}-12-31`);
    }
    const { data: txs } = await q;

    // Agrega por payee
    const _aggregate = (rows) => {
      const exp = {}, inc = {};
      (rows || []).forEach(t => {
        const pid  = t.payee_id;
        const name = t.payees?.name || pid;
        const type = t.payees?.type || 'beneficiario';
        const amt  = Math.abs(parseFloat(t.brl_amount ?? t.amount) || 0);
        if (parseFloat(t.amount) < 0) {
          if (!exp[pid]) exp[pid] = { id: pid, name, type, total: 0, count: 0, txs: [] };
          exp[pid].total += amt; exp[pid].count++;
          exp[pid].txs.push(t);
        } else {
          if (!inc[pid]) inc[pid] = { id: pid, name, type, total: 0, count: 0, txs: [] };
          inc[pid].total += amt; inc[pid].count++;
          inc[pid].txs.push(t);
        }
      });
      return {
        topExp: Object.values(exp).sort((a,b)=>b.total-a.total).slice(0,10),
        topInc: Object.values(inc).sort((a,b)=>b.total-a.total).slice(0,10),
      };
    };

    const agg = _aggregate(txs);
    // Salva para drill-down — usa mesma estrutura de antes (scope = 'year' | 'alltime')
    const scopeKey = isYear ? 'year' : 'alltime';
    window._dashPayeeDrillData = {};
    window._dashPayeeDrillData[scopeKey] = agg;
    window._dashPayeeDrillScope = scopeKey;

    // ── Linha de payee ────────────────────────────────────────────
    const _payeeRow = (p, i, maxVal, isInc) => {
      const bar    = maxVal > 0 ? Math.min(p.total / maxVal * 100, 100).toFixed(1) : 0;
      const color  = isInc ? '#16a34a' : '#dc2626';
      const bucket = isInc ? 'inc' : 'exp';
      return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;
          cursor:pointer;transition:background .12s;border-radius:8px;margin:0 -4px;padding-left:4px"
          onclick="_dashPayeeDrill('${esc(p.id)}','${scopeKey}','${bucket}')"
          onmouseover="this.style.background='var(--surface2)'"
          onmouseout="this.style.background=''">
        <span style="font-size:.62rem;font-weight:700;color:var(--muted);width:14px;text-align:right;flex-shrink:0">${i+1}</span>
        <div style="flex:1;min-width:0">
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:4px;margin-bottom:2px">
            <span style="font-size:.78rem;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</span>
            <span style="font-size:.74rem;font-weight:700;color:${isInc?'#16a34a':'#dc2626'};white-space:nowrap;flex-shrink:0">${isInc?'+':'−'}${dashFmt(p.total,'BRL')}</span>
          </div>
          <div style="display:flex;align-items:center;gap:5px">
            <div style="flex:1;height:3px;border-radius:2px;background:var(--border);overflow:hidden">
              <div style="height:100%;width:${bar}%;background:${color};border-radius:2px;transition:width .5s"></div>
            </div>
            <span style="font-size:.58rem;color:var(--muted);flex-shrink:0">${p.count}tx</span>
          </div>
        </div>
        <span style="font-size:.68rem;color:var(--muted);flex-shrink:0">›</span>
      </div>`;
    };

    // ── Coluna ────────────────────────────────────────────────────
    const _col = (title, icon, items, isInc) => {
      const maxVal = items[0]?.total || 1;
      const totalAmt = items.reduce((s,p)=>s+p.total, 0);
      const colorH = isInc ? '#16a34a' : '#dc2626';
      const rows   = items.length
        ? items.map((p,i) => _payeeRow(p, i, maxVal, isInc)).join('')
        : `<div style="text-align:center;padding:20px 0;color:var(--muted);font-size:.78rem">Nenhum registro</div>`;
      return `<div>
        <div style="display:flex;align-items:baseline;justify-content:space-between;
          margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid ${colorH}33">
          <div style="display:flex;align-items:center;gap:5px">
            <span>${icon}</span>
            <span style="font-size:.66rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:${colorH}">${title}</span>
          </div>
          <span style="font-size:.78rem;font-weight:800;font-family:var(--font-serif);color:${colorH}">
            ${isInc?'+':'−'}${dashFmt(totalAmt,'BRL')}
          </span>
        </div>
        ${rows}
      </div>`;
    };

    // ── Rótulo do período ─────────────────────────────────────────
    const periodLabel = isYear
      ? `Ano ${y}`
      : 'Todos os tempos';

    // ── KPI bar ───────────────────────────────────────────────────
    const totalExp = agg.topExp.reduce((s,p)=>s+p.total,0);
    const totalInc = agg.topInc.reduce((s,p)=>s+p.total,0);

    const kpi = `<div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid var(--border)">
      <div style="padding:10px 14px;border-right:1px solid var(--border)">
        <div style="font-size:.58rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:2px">Top Desp. · ${periodLabel}</div>
        <div style="font-size:1rem;font-weight:800;font-family:var(--font-serif)">${dashFmt(totalExp,'BRL')}</div>
      </div>
      <div style="padding:10px 14px">
        <div style="font-size:.58rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:2px">Top Rec. · ${periodLabel}</div>
        <div style="font-size:1rem;font-weight:800;font-family:var(--font-serif);color:#16a34a">${dashFmt(totalInc,'BRL')}</div>
      </div>
    </div>`;

    // ── Switch ────────────────────────────────────────────────────
    const switchHtml = `<div style="display:flex;align-items:center;justify-content:flex-end;
        gap:4px;padding:8px 14px 0">
      <button onclick="_loadDashTopPayeesCard('year')"
        style="padding:4px 10px;border-radius:20px;font-size:.7rem;font-weight:700;
          font-family:inherit;cursor:pointer;border:1.5px solid var(--border);
          transition:all .15s;
          background:${isYear?'var(--accent)':'var(--surface2)'};
          color:${isYear?'#fff':'var(--muted)'}">
        Ano corrente
      </button>
      <button onclick="_loadDashTopPayeesCard('alltime')"
        style="padding:4px 10px;border-radius:20px;font-size:.7rem;font-weight:700;
          font-family:inherit;cursor:pointer;border:1.5px solid var(--border);
          transition:all .15s;
          background:${!isYear?'var(--accent)':'var(--surface2)'};
          color:${!isYear?'#fff':'var(--muted)'}">
        Todos os tempos
      </button>
    </div>`;

    // ── Layout: desktop 2-col, mobile empilhado ───────────────────
    const gridLayout = `
      <!-- Desktop: 2 colunas | Mobile: empilhado (beneficiários em cima) -->
      <div class="dash-payee-grid">
        <div class="dash-payee-col">
          ${_col('Beneficiários', '📤', agg.topExp, false)}
        </div>
        <div class="dash-payee-col">
          ${_col('Fontes Pagadoras', '📥', agg.topInc, true)}
        </div>
      </div>`;

    const verRelatorioLink = '';
    body.innerHTML = kpi + switchHtml +
      `<div style="padding:12px 14px 10px">${gridLayout}</div>` + verRelatorioLink;

  } catch(e) {
    body.innerHTML = `<div class="dcard-loading">⚠️ ${esc(e.message)}</div>`;
  }
}
window._loadDashTopPayeesCard = _loadDashTopPayeesCard;

// ══════════════════════════════════════════════════════════════════════════════
// Card: Programas de Fidelidade
// ══════════════════════════════════════════════════════════════════════════════
async function _loadDashLoyaltyCard() {
  const card  = document.getElementById('dashCardLoyalty');
  const body  = document.getElementById('dashLoyaltyBody');
  const subEl = document.getElementById('dashLoyaltySub');
  if (!card) return;

  const prefs = _dashGetPrefs();
  if (prefs.loyalty === false) { card.style.display = 'none'; return; }

  // Always load/refresh loyalty programs — window._loy may not be set yet
  // if loyalty.js loaded after dashboard.js (script order issue)
  if (typeof loadLoyaltyPrograms === 'function') {
    await loadLoyaltyPrograms().catch(() => {});
  }

  const programs = (window._loy?.programs) || [];
  const active   = programs; // mostrar todos os programas cadastrados

  // If prefs say show but no programs loaded yet, show empty state (don't hide)
  if (!active.length) {
    card.style.display = '';
    if (body) body.innerHTML = '<div style="padding:16px;text-align:center;font-size:.8rem;color:var(--muted)">Nenhum programa de fidelidade cadastrado.<br><button onclick="navigate(\'accounts\')" style="margin-top:8px;font-size:.76rem;color:var(--accent);background:none;border:none;cursor:pointer;font-family:inherit;font-weight:600">+ Cadastrar programa →</button></div>';
    if (subEl) subEl.textContent = '0 programas';
    return;
  }

  const E      = typeof esc === 'function' ? esc : s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;');
  const fmtPts = n => Number(n||0).toLocaleString('pt-BR');
  const totalPts = active.reduce((s, p) => s + Number(p.points_balance||0), 0);
  if (subEl) subEl.textContent = active.length + ' programa' + (active.length > 1 ? 's' : '') + ' \u00b7 ' + fmtPts(totalPts) + ' pts total';

  const PCOLORS = { smiles:'#FF6600', latam_pass:'#E31837', livelo:'#B31017', tudoazul:'#0056A2',
    esfera:'#E5001E', clube_itau:'#FF6600', multiplus:'#F47920', azul_mais:'#004F9F',
    dotz:'#8B4513', stix:'#008000', custom:'#f59e0b' };
  const PICONS = { smiles:'&#x1F60A;', latam_pass:'&#x1F30E;', livelo:'&#x1F534;', tudoazul:'&#x1F499;',
    esfera:'&#x1F7E1;', clube_itau:'&#x1F536;', multiplus:'&#x1F7E0;', azul_mais:'&#x2708;&#xFE0F;',
    dotz:'&#x1F7E4;', stix:'&#x1F7E2;', custom:'&#x2B50;' };

  function pColor(p) { return p.color || PCOLORS[p.program_type] || '#f59e0b'; }
  function pIcon(p)  { return p.icon  || PICONS[p.program_type]  || '&#x2B50;'; }

  function expiryInfo(p) {
    if (!p.points_expiry_date) return null;
    const days = Math.round((new Date(p.points_expiry_date + 'T12:00:00') - new Date()) / 86400000);
    if (days < 0)   return { label:'Vencido', color:'#dc2626', bg:'rgba(220,38,38,.08)' };
    if (days <= 30) return { label: days + 'd', color:'#d97706', bg:'rgba(217,119,6,.08)' };
    return null;
  }

  function linkedAccName(p) {
    if (!p.linked_account_id) return null;
    const a = (state.accounts||[]).find(a => a.id === p.linked_account_id);
    return a ? a.name : null;
  }

  let html = '';
  // Build dash-fav-card style grid — same as favorite accounts
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));'
    + 'gap:10px;padding:12px 16px 4px">';

  active.forEach(function(p) {
    const color   = pColor(p);
    const icon    = pIcon(p);
    const pts     = Number(p.points_balance||0);
    const expiry  = expiryInfo(p);
    const accName = linkedAccName(p);
    const pid     = E(p.id);
    const subLine = accName ? accName
                            : (p.program_type !== 'custom' ? p.program_type.replace(/_/g,' ') : 'Pontos');

    // Shine overlay hex — lighter version of color
    let expiryBadge = '';
    if (expiry) {
      expiryBadge = '<span style="display:inline-flex;align-items:center;gap:2px;'
        + 'padding:1px 5px;border-radius:6px;font-size:.58rem;font-weight:700;'
        + 'background:rgba(0,0,0,.25);color:#fff;margin-top:3px">'
        + expiry.label + '</span>';
    }

    html += '<div data-loyid="' + pid + '" onclick="_dashLoyaltyOpen(this)"'
      // Card shell — dash-fav-card style with program color
      + ' style="position:relative;overflow:hidden;border-radius:12px;'
      + 'padding:10px 12px 9px;cursor:pointer;'
      + 'background:linear-gradient(135deg,'
      + color + ' 0%,'
      + color + 'cc 100%);'
      + 'color:#fff;'
      + 'box-shadow:0 4px 14px ' + color + '55,0 1px 3px rgba(0,0,0,.18);'
      + 'transition:transform .18s,box-shadow .18s;'
      + 'display:flex;flex-direction:column;min-height:110px;'
      + 'user-select:none;-webkit-tap-highlight-color:transparent"'
      + ' onmouseover="this.style.transform=\'translateY(-2px) scale(1.01)\'"'
      + ' onmouseout="this.style.transform=\'\'">'

      // Shine overlay
      + '<div style="pointer-events:none;position:absolute;inset:0;'
      + 'background:linear-gradient(135deg,rgba(255,255,255,.18) 0%,rgba(255,255,255,0) 55%);'
      + 'border-radius:inherit"></div>'

      // Decorative circle
      + '<div style="pointer-events:none;position:absolute;width:80px;height:80px;'
      + 'border-radius:50%;background:rgba(255,255,255,.08);'
      + 'bottom:-18px;right:-18px"></div>'

      // Top: icon + api badge
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">'
      + '<span style="font-size:1.4rem;line-height:1">' + icon + '</span>'
      + (p.api_enabled ? '<span style="font-size:.55rem;font-weight:800;padding:1px 5px;'
        + 'border-radius:5px;background:rgba(255,255,255,.25);color:#fff">API</span>' : '')
      + '</div>'

      // Program name
      + '<div style="font-size:.78rem;font-weight:700;color:rgba(255,255,255,.95);'
      + 'line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
      + 'margin-bottom:2px">' + E(p.name) + '</div>'

      // Linked account or type
      + '<div style="font-size:.62rem;color:rgba(255,255,255,.65);'
      + 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:auto">'
      + E(subLine) + '</div>'

      // Points balance — big number
      + '<div style="margin-top:8px">'
      + '<div style="font-size:1.2rem;font-weight:800;color:#fff;'
      + 'font-family:var(--font-serif);line-height:1;letter-spacing:-.02em">'
      + fmtPts(pts) + '</div>'
      + '<div style="font-size:.6rem;color:rgba(255,255,255,.65);margin-top:1px">pontos</div>'
      + expiryBadge
      + '</div>'
      + '</div>';
  });

  html += '</div>';

  // Footer: subtle link
  html += '<div style="text-align:center;padding:6px 0 10px">'
    + '<button onclick="navigate(\'accounts\');'
    + 'setTimeout(()=>document.querySelector(\'.loy-section\')?.scrollIntoView({behavior:\'smooth\'}),400)"'
    + ' style="background:none;border:none;cursor:pointer;font-family:inherit;font-size:.7rem;'
    + 'color:var(--muted);transition:color .15s;padding:2px 8px"'
    + ' onmouseover="this.style.color=\'var(--accent)\'" onmouseout="this.style.color=\'var(--muted)\'">'
    + 'Ver todos os programas \u2192</button></div>';

  if (body) body.innerHTML = html;
}

function _dashLoyaltyOpen(el) {
  const id = el.closest('[data-loyid]')?.dataset?.loyid;
  if (id && typeof openLoyaltyStatement === 'function') openLoyaltyStatement(id);
}
window._dashLoyaltyOpen     = _dashLoyaltyOpen;
window._loadDashLoyaltyCard = _loadDashLoyaltyCard;


// ── Drill-down: mostrar transações de um beneficiário/fonte ─────────────────
function _dashPayeeDrill(payeeId, scope, bucket) {
  const data   = window._dashPayeeDrillData;
  if (!data) return;

  // Suporte ao scope dinâmico (year | alltime)
  const scopeData = data[scope] || data[Object.keys(data)[0]];
  if (!scopeData) return;

  const list   = scopeData[bucket === 'exp' ? 'topExp' : 'topInc'];
  const entry  = list.find(p => p.id === payeeId);
  if (!entry) return;

  const isInc  = bucket === 'inc';
  const color  = isInc ? '#16a34a' : '#dc2626';
  const total  = entry.total;
  const txs    = [...entry.txs].sort((a,b) => (b.date||'').localeCompare(a.date||''));

  // Remove modal existente se houver
  document.getElementById('dashPayeeDrillModal')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  overlay.id = 'dashPayeeDrillModal';
  overlay.style.zIndex = '10025';
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

  const rows = txs.map(t => {
    const amt   = Math.abs(parseFloat(t.brl_amount ?? t.amount) || 0);
    const catColor = t.categories?.color || (isInc ? '#16a34a' : '#94a3b8');
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:9px 14px;
        border-bottom:1px solid var(--border);cursor:pointer;transition:background .12s"
        onclick="overlay.remove();editTransaction('${t.id}')"
        onmouseover="this.style.background='var(--surface2)'"
        onmouseout="this.style.background=''">
        <div style="width:7px;height:7px;border-radius:50%;background:${catColor};flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:.83rem;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            ${esc(t.description || entry.name || '—')}
          </div>
          <div style="font-size:.68rem;color:var(--muted)">
            ${fmtDate(t.date)}${t.categories?.name ? ' · ' + esc(t.categories.name) : ''}
          </div>
        </div>
        <span style="font-size:.88rem;font-weight:700;color:${color};flex-shrink:0;margin-left:8px">
          ${isInc ? '+' : '−'}${dashFmt(amt,'BRL')}
        </span>
      </div>`;
  }).join('');

  overlay.innerHTML = `
    <div class="modal" style="max-width:480px;max-height:85dvh;display:flex;flex-direction:column;padding:0;border-radius:16px">
      <div class="modal-handle"></div>
      <!-- Header -->
      <div style="padding:14px 16px 12px;border-bottom:1px solid var(--border);flex-shrink:0">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-size:.95rem;font-weight:800;color:var(--text)">${esc(entry.name)}</div>
            <div style="font-size:.7rem;color:var(--muted);margin-top:1px">
              ${txs.length} transaç${txs.length===1?'ão':'ões'} · ${scope === 'alltime' ? 'Todos os tempos' : 'Ano ' + new Date().getFullYear()}
            </div>
          </div>
          <div style="text-align:right">
            <div style="font-size:1.1rem;font-weight:900;font-family:var(--font-serif);color:${color}">
              ${isInc ? '+' : '−'}${dashFmt(total,'BRL')}
            </div>
            <button onclick="document.getElementById('dashPayeeDrillModal').remove()"
              style="font-size:.7rem;color:var(--muted);background:none;border:none;cursor:pointer;margin-top:2px">
              Fechar ✕
            </button>
          </div>
        </div>
        <!-- Barra de progresso (total desta entrada vs total do período) -->
        <div style="height:3px;border-radius:3px;background:var(--border);margin-top:10px;overflow:hidden">
          <div style="height:100%;width:100%;background:${color};border-radius:3px"></div>
        </div>
      </div>
      <!-- Lista de transações -->
      <div style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch">
        ${rows || '<div style="text-align:center;padding:32px;color:var(--muted);font-size:.85rem">Nenhuma transação</div>'}
      </div>
    </div>`;

  // Corrigir o onclick das linhas (overlay não está no escopo do template literal)
  document.body.appendChild(overlay);

  // Rewire os cliques nas linhas para fechar o modal correto
  overlay.querySelectorAll('[onclick*="overlay.remove"]').forEach(el => {
    const txId = el.getAttribute('onclick').match(/editTransaction\('([^']+)'\)/)?.[1];
    if (txId) {
      el.removeAttribute('onclick');
      el.addEventListener('click', () => {
        overlay.remove();
        if (typeof editTransaction === 'function') editTransaction(txId);
      });
    }
  });
}
window._dashPayeeDrill = _dashPayeeDrill;

window._catColor                           = _catColor;
window._dashCustomSave                     = _dashCustomSave;
window._dashGetPrefs                       = _dashGetPrefs;
window._dashSavePrefs                      = _dashSavePrefs;
window._renderDashFavCategories            = _renderDashFavCategories;
window.closeCatDetail                      = closeCatDetail;

/* ── Chart type and mode toggles (called from HTML) ─────────────────────── */
function _setCatChartType(type) {
  _catChartType = type;
  // Update button states
  const bar = document.getElementById('catChartTypeBar');
  const pie = document.getElementById('catChartTypePie');
  if (bar) bar.classList.toggle('active', type === 'bar');
  if (pie) pie.classList.toggle('active', type === 'doughnut');
  // Re-render with new type (functions now globally accessible)
  if (type === 'doughnut') _renderCatChartDoughnut();
  else _renderCatChartBar();
  // Save to prefs
  try {
    const prefs = _dashGetPrefs() || {};
    prefs.catChartType = type;
    _dashSavePrefs(prefs);
  } catch(_) {}
}

function _setDashCatMode(mode) {
  // mode: 'expense' | 'income'
  const expBtn = document.getElementById('dashCatModeExp');
  const incBtn = document.getElementById('dashCatModeInc');
  if (expBtn) expBtn.classList.toggle('active', mode === 'expense');
  if (incBtn) incBtn.classList.toggle('active', mode === 'income');
  // Switch the data source
  if (mode === 'income') {
    _catChartEntries = window._catChartIncEntries || [];
  } else {
    _catChartEntries = window._catChartExpEntriesRaw || [];
  }
  // Persist mode choice
  try { const p = _dashGetPrefs()||{}; p.catChartMode = mode; _dashSavePrefs(p); } catch(_){}
  // Re-render with the now-global render functions
  if (_catChartType === 'doughnut') _renderCatChartDoughnut();
  else _renderCatChartBar();
}

window._setCatChartType = _setCatChartType;
window._setDashCatMode  = _setDashCatMode;
window.loadDashboard                       = loadDashboard;
window.loadDashboardRecent                 = loadDashboardRecent;
window.openDashCustomModal                 = openDashCustomModal;

/* ════════════════════════════════════════════════════════════════════════════
   DASHBOARD — Card de Próximas Faturas de Cartão de Crédito
   Mostra o próximo pagamento programado (tipo card_payment) de cada cartão.
════════════════════════════════════════════════════════════════════════════ */

async function renderDashCCInvoices() {
  const card    = document.getElementById('dashCardCCInvoices');
  const totalEl = document.getElementById('dashCCTotal');
  const countEl = document.getElementById('dashCCCount');
  const badgesEl= document.getElementById('dashCCBadges');
  const listEl  = document.getElementById('dashCCList');
  if (!card) return;

  const prefs = _dashGetPrefs();
  if (prefs.ccinvoices === false) { card.style.display = 'none'; return; }

  if (!state.scheduled?.length && typeof loadScheduled === 'function') {
    try { await loadScheduled(); } catch(_) {}
  }

  const today = new Date().toISOString().slice(0, 10);
  const E = typeof esc === 'function' ? esc : s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;');
  const F = typeof fmt === 'function' ? fmt : v => 'R$'+Number(v).toFixed(2);

  const cardPayments = (state.scheduled || []).filter(sc =>
    sc.type === 'card_payment' && sc.status !== 'paused' && sc.status !== 'finished'
  );
  if (!cardPayments.length) { card.style.display = 'none'; return; }

  const entries = [];
  cardPayments.forEach(sc => {
    const executedOccs = (sc.occurrences || [])
      .filter(o => o.execution_status === 'executed' || o.execution_status === 'processing');
    const executedDates = new Set(executedOccs.map(o => o.scheduled_date));
    const skippedDates  = new Set(
      (sc.occurrences || []).filter(o => o.execution_status === 'skipped').map(o => o.scheduled_date)
    );
    const lastPaidOcc = executedOccs
      .sort((a, b) => (b.scheduled_date||'').localeCompare(a.scheduled_date||''))
      .find(o => o.scheduled_date < today);
    const lastPaidAmount = lastPaidOcc
      ? Math.abs(parseFloat(lastPaidOcc.amount || sc.amount) || 0)
      : null;

    if (typeof generateOccurrences !== 'function') return;
    const occs    = generateOccurrences(sc, 12);
    const nextDate = occs.find(d => d >= today && !executedDates.has(d) && !skippedDates.has(d));
    if (!nextDate) return;

    const fromAcc  = (state.accounts || []).find(a => a.id === sc.account_id);
    const toAcc    = (state.accounts || []).find(a => a.id === sc.transfer_to_account_id);
    const amount   = Math.abs(parseFloat(sc.amount) || 0);
    // Currency: prefer sc.currency, fallback to fromAcc currency, then BRL
    const currency = (sc.currency || fromAcc?.currency || 'BRL').toUpperCase();
    const isForeign = currency !== 'BRL';
    // BRL equivalent for totals — use toBRL if available, else raw amount
    const amountBRL = isForeign && typeof toBRL === 'function'
      ? Math.abs(toBRL(amount, currency))
      : amount;

    let delta = null;
    if (lastPaidAmount !== null && Math.abs(amount - lastPaidAmount) > 0.01) {
      delta = amount - lastPaidAmount; // in original currency
    }

    entries.push({
      id: sc.id, sc, amount, amountBRL, currency, isForeign,
      date: nextDate, lastPaidAmount, delta,
      description: sc.description || (toAcc ? `Fatura ${toAcc.name}` : 'Pagamento cartão'),
      fromAcc: fromAcc?.name || '—',
      toAcc:   toAcc?.name   || '—',
    });
  });

  if (!entries.length) { card.style.display = 'none'; return; }

  entries.sort((a, b) => a.date.localeCompare(b.date));
  const grandTotal = entries.reduce((s, e) => s + e.amountBRL, 0); // always BRL
  card.style.display = '';

  // ── Hero: total + badges ──────────────────────────────────────────────────
  if (totalEl) totalEl.textContent = '-' + F(grandTotal);

  if (badgesEl) {
    const overdue = entries.filter(e => e.date < today).length;
    const urgent  = entries.filter(e => {
      const d = Math.round((new Date(e.date + 'T12:00:00') - new Date()) / 86400000);
      return e.date >= today && d <= 7;
    }).length;
    const ok      = entries.length - overdue - urgent;
    const badges  = [];
    if (overdue) badges.push(`<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:10px;background:rgba(220,38,38,.08);border:1px solid rgba(220,38,38,.2);font-size:.62rem;font-weight:700;color:#dc2626">⚠ ${overdue} vencida${overdue>1?'s':''}</span>`);
    if (urgent)  badges.push(`<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:10px;background:rgba(217,119,6,.08);border:1px solid rgba(217,119,6,.2);font-size:.62rem;font-weight:700;color:#d97706">⏰ ${urgent} esta sem.</span>`);
    if (ok)      badges.push(`<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:10px;background:rgba(22,163,74,.08);border:1px solid rgba(22,163,74,.2);font-size:.62rem;font-weight:600;color:#16a34a">${ok} no prazo</span>`);
    badgesEl.innerHTML = badges.join('');
  }

  // ── Date-grouped list ─────────────────────────────────────────────────────
  const MON = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const byDate = {};
  entries.forEach(e => { if (!byDate[e.date]) byDate[e.date]=[]; byDate[e.date].push(e); });

  const dates     = Object.keys(byDate).sort();
  if (countEl) countEl.textContent = entries.length + ' fatura' + (entries.length > 1 ? 's' : '') + ' · ' + dates.length + ' data' + (dates.length > 1 ? 's' : '');
  const _ccExp    = window._ccDateExpanded || (window._ccDateExpanded = new Set());

  let html = '';

  dates.forEach((date, di) => {
    const group      = byDate[date];
    const groupTotal    = group.reduce((s, e) => s + e.amountBRL, 0); // BRL for total
    const daysUntil  = Math.round((new Date(date + 'T12:00:00') - new Date()) / 86400000);
    const isOverdue  = date < today;
    const isToday    = daysUntil === 0;
    const isTomorrow = daysUntil === 1;
    const isUrgent   = !isOverdue && daysUntil <= 7;
    const isLast     = di === dates.length - 1;
    const isOpen     = _ccExp.has(date);
    const gid        = 'ccg_' + date.replace(/-/g,'');
    const multi      = group.length > 1;

    // Urgency styling
    const dotClr   = isOverdue ? '#ef4444' : isToday ? '#ef4444' : isUrgent ? '#f59e0b' : '#22c55e';
    const tagBg    = isOverdue ? 'rgba(239,68,68,.1)' : isToday ? 'rgba(239,68,68,.1)' : isUrgent ? 'rgba(245,158,11,.1)' : 'rgba(34,197,94,.08)';
    const tagClr   = isOverdue ? '#ef4444' : isToday ? '#ef4444' : isUrgent ? '#f59e0b' : '#22c55e';
    const tagBdr   = isOverdue ? 'rgba(239,68,68,.3)' : isToday ? 'rgba(239,68,68,.3)' : isUrgent ? 'rgba(245,158,11,.25)' : 'rgba(34,197,94,.2)';
    const daysLabel = isOverdue ? 'vencido' : isToday ? 'hoje' : isTomorrow ? 'amanhã' : `${daysUntil}d`;

    const dt    = new Date(date + 'T12:00:00');
    const dayN  = dt.getDate();
    const monS  = MON[dt.getMonth()];
    const isFirst = di === 0;

    // ── Date row ────────────────────────────────────────────────────────────
    html += `
    <div style="border-bottom:${isLast&&!isOpen?'none':'1px solid var(--border)'}">
      <div onclick="${multi ? `_dashCCToggleDate('${date}')` : `navigate('scheduled')`}"
        style="display:flex;align-items:center;gap:12px;padding:11px 16px;
               cursor:pointer;transition:background .12s;position:relative;
               ${isFirst ? '' : ''}"
        onmouseover="this.style.background='var(--bg2)'"
        onmouseout="this.style.background=''">

        <!-- Date badge -->
        <div style="flex-shrink:0;width:40px;height:40px;border-radius:10px;
          background:${tagBg};border:1.5px solid ${tagBdr};
          display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px">
          <span style="font-size:.52rem;font-weight:800;text-transform:uppercase;
            letter-spacing:.04em;color:${tagClr};line-height:1">${monS}</span>
          <span style="font-size:1rem;font-weight:800;color:${tagClr};line-height:1">${dayN}</span>
        </div>

        <!-- Content -->
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
            <span style="font-size:.83rem;font-weight:700;color:var(--text);
              overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
              ${multi ? `${group.length} faturas` : E(group[0].description)}
            </span>
            ${!multi && group[0].isForeign ? `<span style="flex-shrink:0;font-size:.6rem;font-weight:600;padding:1px 5px;border-radius:6px;background:rgba(30,91,168,.07);color:#1e5ba8;border:1px solid rgba(30,91,168,.15)">${group[0].currency}</span>` : ''}
            ${!multi && group[0].delta !== null ? (() => {
              const up  = group[0].delta > 0;
              const clr = up ? '#ef4444' : '#22c55e';
              const ic  = up ? '↑' : '↓';
              return `<span style="flex-shrink:0;font-size:.6rem;font-weight:700;padding:1px 5px;
                border-radius:6px;background:${up?'rgba(239,68,68,.08)':'rgba(34,197,94,.08)'};
                color:${clr};border:1px solid ${up?'rgba(239,68,68,.2)':'rgba(34,197,94,.2)'}">
                ${ic}${F(Math.abs(group[0].delta))}</span>`;
            })() : ''}
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <span style="display:inline-flex;align-items:center;gap:3px;font-size:.62rem;
              font-weight:700;padding:1px 7px;border-radius:10px;
              background:${tagBg};color:${tagClr};border:1px solid ${tagBdr}">
              <span style="width:5px;height:5px;border-radius:50%;background:${dotClr};flex-shrink:0"></span>
              ${daysLabel}
            </span>
            ${!multi ? `<span style="font-size:.67rem;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${E(group[0].fromAcc)}${group[0].toAcc!=='—'?' → '+E(group[0].toAcc):''}</span>` : `<span style="font-size:.67rem;color:var(--muted)">${group.map(e=>E(e.description)).join(' · ').slice(0,50)}</span>`}
          </div>
        </div>

        <!-- Amount + chevron -->
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
          <div style="text-align:right">
            <div style="font-size:.9rem;font-weight:800;color:var(--text);letter-spacing:-.01em">
              ${multi
                ? '-' + F(groupTotal)
                : '-' + (group[0].isForeign
                    ? new Intl.NumberFormat('pt-BR',{style:'currency',currency:group[0].currency,minimumFractionDigits:2}).format(group[0].amount)
                    : F(group[0].amount))}
            </div>
            ${!multi && group[0].isForeign ? `<div style="font-size:.62rem;color:var(--muted);margin-top:1px">≈ -${F(group[0].amountBRL)}</div>` : ''}
            ${multi && group.some(e=>e.isForeign) ? `<div style="font-size:.62rem;color:#1e5ba8;font-weight:600;margin-top:1px">total em BRL</div>` : ''}
            ${multi && !group.some(e=>e.isForeign) ? `<div style="font-size:.62rem;color:var(--muted);margin-top:1px">${group.length} cartões</div>` : ''}
          </div>
          ${multi ? `
          <div style="width:22px;height:22px;border-radius:6px;background:var(--surface2);
            border:1px solid var(--border);display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <svg id="${gid}_arr" width="10" height="10" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
              style="color:var(--muted);transition:transform .2s;transform:${isOpen?'rotate(180deg)':'rotate(0deg)'}">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </div>` : ''}
        </div>
      </div>`;

    // ── Expanded sub-rows ────────────────────────────────────────────────────
    if (multi) {
      html += `<div id="${gid}" style="display:${isOpen?'':'none'};border-top:1px solid var(--border)">`;
      group.forEach((e) => {
        const up    = e.delta !== null && e.delta > 0;
        const down  = e.delta !== null && e.delta < 0;
        const dClr  = up ? '#ef4444' : '#22c55e';
        const dIc   = up ? '↑' : '↓';
        html += `
        <div onclick="navigate('scheduled')"
          style="display:flex;align-items:center;gap:10px;padding:9px 16px 9px 20px;
            border-bottom:1px solid var(--border);cursor:pointer;transition:background .12s"
          onmouseover="this.style.background='var(--bg2)'"
          onmouseout="this.style.background=''">

          <!-- Card icon -->
          <div style="width:32px;height:32px;border-radius:8px;
            background:rgba(220,38,38,.07);border:1px solid rgba(220,38,38,.15);
            display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
          </div>

          <div style="flex:1;min-width:0">
            <div style="font-size:.8rem;font-weight:600;color:var(--text);
              overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${E(e.description)}</div>
            <div style="font-size:.67rem;color:var(--muted);margin-top:1px;
              overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
              ${E(e.fromAcc)}${e.toAcc!=='—'?' → '+E(e.toAcc):''}
            </div>
          </div>

          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:.85rem;font-weight:700;color:var(--text)">
              -${e.isForeign ? (new Intl.NumberFormat('pt-BR',{style:'currency',currency:e.currency,minimumFractionDigits:2}).format(e.amount) + ` <span style="font-size:.65rem;font-weight:600;color:var(--muted)">≈ ${F(e.amountBRL)}</span>`) : F(e.amount)}
            </div>
            ${e.delta !== null ? `
            <div style="display:flex;align-items:center;justify-content:flex-end;gap:3px;margin-top:2px">
              <span style="font-size:.6rem;font-weight:700;padding:1px 5px;border-radius:5px;
                background:${up?'rgba(239,68,68,.08)':'rgba(34,197,94,.08)'};
                color:${dClr};border:1px solid ${up?'rgba(239,68,68,.2)':'rgba(34,197,94,.2)'}">
                ${dIc}${F(Math.abs(e.delta))}
              </span>
            </div>` : ''}
          </div>
        </div>`;
      });
      html += `</div>`;
    }

    html += `</div>`; // close date group
  });

  if (listEl) listEl.innerHTML = html || '<div style="padding:16px;font-size:.78rem;color:var(--muted);text-align:center">Nenhuma fatura programada</div>';
}

window._dashCCToggleDate = function(date) {
  if (!window._ccDateExpanded) window._ccDateExpanded = new Set();
  const gid   = 'ccg_' + date.replace(/-/g,'');
  const el    = document.getElementById(gid);
  const arrow = document.getElementById(gid + '_arr');
  if (!el) return;
  const isOpen = el.style.display !== 'none';
  if (isOpen) {
    window._ccDateExpanded.delete(date);
    el.style.display = 'none';
    if (arrow) arrow.style.transform = 'rotate(0deg)';
  } else {
    window._ccDateExpanded.add(date);
    el.style.display = '';
    if (arrow) arrow.style.transform = 'rotate(180deg)';
  }
};

window.renderDashCCInvoices = renderDashCCInvoices;
