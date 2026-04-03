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
    const _tc = statTotalEl.closest('.stat-card');
    if (_tc) {
      _tc.style.cursor = 'pointer';
      _tc.title = 'Ver composição do patrimônio';
      _tc.onclick = () => _openPatrimonioModal();
    }
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
  _dashRenderInvestments().catch(()=>{});
  await loadDashboardAutoRunSummary();

  // FIX: Carregar orçamentos para o snapshot do dashboard.
  // loadBudgets popula _budgetCache e _budgetSpent, depois chama
  // _renderDashBudgetSnapshot automaticamente. Sem isso o card fica vazio.
  if (typeof loadBudgets === 'function') {
    loadBudgets().catch(() => {}).finally(() => {
      // Re-aplicar visibilidade após render para respeitar prefs do usuário
      try { _dashApplyPrefs(_dashGetPrefs()); } catch(_e) {}
    });
  }

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
        // Confirmed-only balance line — sempre renderizada para manter altura uniforme.
        // visibility:hidden quando não há pendentes (reserva o espaço sem mostrar nada).
        const _confBal    = a.confirmed_balance;
        const _hasPending = (_confBal !== undefined) && (Math.abs(_confBal - a.balance) > 0.001);
        const _confIsNeg  = _confBal < 0;
        const _confLine   = `<div class="dash-fav-card__confirmed ${_confIsNeg ? 'neg' : ''}"
          style="${_hasPending ? '' : 'visibility:hidden'}">
            <span class="dash-fav-card__confirmed-label">confirmado</span>
            ${_hasPending ? fmt(_confBal, a.currency) : '—'}
          </div>`;
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
          <button class="dash-fav-card__consolidate-btn" title="Ajustar / Consolidar saldo"
            onclick="event.stopPropagation();openConsolidateModal('${a.id}')">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          </button>
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

      // Coluna de tipo: header + contas empilhadas verticalmente
      const _favTypeCol = (items, label) => {
        if (!items.length) return '';
        const total      = items.reduce((s,a) => s + toBRL(parseFloat(a.balance)||0, a.currency||'BRL'), 0);
        const isCC       = label === 'Cartão de Crédito';
        const totalFmt   = fmt(Math.abs(total), 'BRL');
        const totalColor = total < 0 ? 'var(--red)' : isCC ? 'var(--red)' : 'var(--accent)';
        const icon       = isCC ? '💳' : label.includes('Corrente') ? '🏦' : '📦';
        // No mobile: volta ao layout original (grid horizontal)
        // No desktop: cada conta é empilhada verticalmente dentro da coluna
        return `<div class="dash-fav-type-group dash-fav-type-col">
          <div class="dash-fav-type-header">
            <span class="dash-fav-type-label">${icon} ${label}</span>
            <span class="dash-fav-type-total" style="color:${totalColor};font-family:var(--font-serif,monospace)">${isCC && total < 0 ? '−' : ''}${totalFmt}</span>
          </div>
          <div class="dash-favs-col-stack">${items.map(rowHtml).join('')}</div>
        </div>`;
      };

      // Desktop: grupos lado a lado. Mobile: empilhados (CSS cuida disso).
      const activeGroups = [
        favCC.length     ? _favTypeCol(favCC,    'Cartão de Crédito')          : '',
        favCheck.length  ? _favTypeCol(favCheck,  'Corrente / Poupança') : '',
        favOthers.length ? _favTypeCol(favOthers, 'Outros')                     : '',
      ].filter(Boolean);

      const favHtml = activeGroups.length
        ? `<div class="dash-fav-cols-layout">${activeGroups.join('')}</div>`
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
  // Two-step query: scalar fields only (sem JOINs) para evitar PostgREST schema-cache issues.
  // Contas e payees são enriquecidos via state.accounts / state.payees já carregados.
  const _txSelect = 'id,date,description,amount,brl_amount,currency,account_id,payee_id,category_id,is_transfer,is_card_payment';
  const _dateGte = `${y}-${m}-01`;
  // Último dia real do mês — evita comparação com data inválida (ex: 2026-02-31)
  const _lastDay = new Date(y, now.getMonth()+1, 0).getDate();
  const _dateLte = `${y}-${m}-${String(_lastDay).padStart(2,'0')}`;

  // Build expense query (amount < 0) — exclui transferências e pagamentos de fatura
  const qExp = famQ(sb.from('transactions').select(_txSelect))
    .gte('date',_dateGte).lte('date',_dateLte)
    .lt('amount',0).not('category_id','is',null)
    .eq('is_transfer',false).eq('is_card_payment',false);
  // Build income query (amount > 0) — exclui transferências
  const qInc = famQ(sb.from('transactions').select(_txSelect))
    .gte('date',_dateGte).lte('date',_dateLte)
    .gt('amount',0).not('category_id','is',null)
    .eq('is_transfer',false).eq('is_card_payment',false);

  const [resExp, resInc] = await Promise.all([qExp, qInc]);
  const data    = resExp.data;
  const dataInc = resInc.data;

  // Enriquecer com account name e payee name a partir do estado (já carregado, sem query extra)
  const _accById  = Object.fromEntries((state.accounts||[]).map(a=>[a.id,a]));
  const _payById  = Object.fromEntries((state.payees ||[]).map(p=>[p.id,p]));
  const _enrich = t => ({
    ...t,
    accounts: _accById[t.account_id] ? { name: _accById[t.account_id].name } : null,
    payees:   _payById[t.payee_id]   ? { name: _payById[t.payee_id].name   } : null,
  });

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
  (data||[]).map(_enrich).forEach(t=>{
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
  (dataInc||[]).map(_enrich).forEach(t => {
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
    closeCatDetail();
    return; // FIX: não continuar para render com dados vazios
  }

  closeCatDetail(); // reset any open detail

  // Restore chart type from prefs
  const savedType = _dashGetPrefs()?.catChartType || 'bar';
  if (savedType !== _catChartType) {
    _catChartType = savedType;
    // sync toggle buttons
    const pie = document.getElementById('catChartTypePie');
    const bar = document.getElementById('catChartTypeBar');
    if (pie) { pie.classList.toggle('active', savedType === 'doughnut'); pie.style.background=''; pie.style.color=''; }
    if (bar) { bar.classList.toggle('active', savedType === 'bar');     bar.style.background=''; bar.style.color=''; }
  }

  if (_catChartType === 'bar') {
    _renderCatChartBar();
    return;
  }

  _renderCatChartDoughnut();
}

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
  { id: 'kpis',        label: 'Patrimônio, Receita, Despesa e Saldo', icon: '💰', sub: 'Cards de resumo financeiro do mês', el: 'dashCardKpis'       },
  { id: 'accounts',    label: 'Saldo por Conta',           icon: '🏦', sub: 'Saldo atual de cada conta',                 el: 'dashCardAccounts'   },
  { id: 'charts',      label: 'Fluxo de Caixa e Gráficos', icon: '📊', sub: 'Cashflow 6 meses + gráfico de despesas',    el: 'dashCardCharts'     },
  { id: 'favcats',     label: 'Categorias Favoritas',      icon: '⭐', sub: 'Evolução das categorias marcadas',          el: 'dashCardFavCats'    },
  { id: 'budgetSnap',  label: 'Orçamentos do Mês',         icon: '🎯', sub: 'Resumo dos orçamentos ativos',              el: 'dashBudgetSnapshot' },
  { id: 'investments', label: 'Carteira de Investimentos', icon: '📈', sub: 'Resumo da carteira: valor, custo e resultado', el: 'dashCardInvestments', moduleKey: 'investments_enabled' },
  { id: 'upcoming',    label: 'Próximas Transações',       icon: '📆', sub: 'Programadas para os próximos 10 dias',      el: 'dashCardUpcoming'   },
  { id: 'forecast90',  label: 'Previsão 90 dias',          icon: '📈', sub: 'Projeção de saldo para os próximos 90 dias',el: 'dashCardForecast90' },
  { id: 'recent',      label: 'Últimas Transações',        icon: '🧾', sub: 'Histórico recente de lançamentos',          el: 'dashCardRecent'     },
];

function _dashGetPrefs() {
  try {
    const raw = localStorage.getItem(_DASH_PREFS_KEY());
    if (raw) return JSON.parse(raw);
  } catch (_e) {}
  // Defaults: tudo visível (module cards start hidden until module is confirmed active)
  return Object.fromEntries(_DASH_CARDS.map(c => [c.id, !c.moduleKey]));
}

/** Returns cards available based on enabled modules */
function _getDashAvailableCards() {
  const fid = typeof famId === 'function' ? famId() : null;
  return _DASH_CARDS.filter(c => {
    if (!c.moduleKey) return true;
    const cacheKey = c.moduleKey + '_' + fid;
    const cached = window._familyFeaturesCache?.[cacheKey];
    return cached === true;
  });
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

// ════════════════════════════════════════════════════════
// INVESTMENT DASHBOARD CARD — render & update
// ════════════════════════════════════════════════════════
function _dashEnsureInvCard() {
  if (document.getElementById('dashCardInvestments')) return;
  // Insert before dashCardUpcoming
  const ref = document.getElementById('dashCardUpcoming');
  if (!ref) return;
  const card = document.createElement('div');
  card.id = 'dashCardInvestments';
  card.className = 'card mb-4';
  card.innerHTML = `
    <div class="card-header" style="gap:8px">
      <span class="card-title">📈 Carteira de Investimentos</span>
      <button class="btn btn-ghost btn-sm" onclick="navigate('investments')" style="margin-left:auto">Ver carteira →</button>
    </div>
    <div id="dashInvContent" style="padding:0 4px 4px">
      <div class="text-muted" style="text-align:center;padding:18px;font-size:.83rem">Carregando…</div>
    </div>`;
  ref.parentElement.insertBefore(card, ref);
}

async function _dashRenderInvestments() {
  // Only render if module is active
  const fid = typeof famId === 'function' ? famId() : null;
  if (!fid) return;
  const cacheKey = 'investments_enabled_' + fid;
  const enabled = window._familyFeaturesCache?.[cacheKey] === true;
  if (!enabled) return;

  _dashEnsureInvCard();
  const prefs = _dashGetPrefs();
  const card = document.getElementById('dashCardInvestments');
  if (!card) return;
  card.style.display = prefs.investments !== false ? '' : 'none';
  if (prefs.investments === false) return;

  const el = document.getElementById('dashInvContent');
  if (!el) return;

  // Gather data from investments module
  const positions = (typeof _inv !== 'undefined' && _inv.positions) ? _inv.positions.filter(p => +(p.quantity) > 0) : [];

  if (!positions.length) {
    el.innerHTML = `<div style="text-align:center;padding:20px;color:var(--muted);font-size:.83rem">
      <div style="font-size:1.5rem;margin-bottom:8px">📈</div>
      Nenhuma posição registrada ainda.<br>
      <button class="btn btn-primary btn-sm" style="margin-top:10px" onclick="navigate('investments')">Acessar Investimentos</button>
    </div>`;
    return;
  }

  // Calculate totals
  const totalMV   = positions.reduce((s,p) => s + (typeof _invMarketValue === 'function' ? _invMarketValue(p) : 0), 0);
  const totalCost = positions.reduce((s,p) => s + (typeof _invCost === 'function' ? _invCost(p) : (+(p.quantity) * +(p.avg_cost))), 0);
  const pnl       = totalMV - totalCost;
  const pnlPct    = totalCost ? pnl / totalCost * 100 : 0;
  const isPos     = pnl >= 0;

  // Group by asset type
  const byType = {};
  positions.forEach(p => {
    const k = p.asset_type || 'outro';
    if (!byType[k]) byType[k] = { mv: 0, count: 0 };
    byType[k].mv += typeof _invMarketValue === 'function' ? _invMarketValue(p) : 0;
    byType[k].count++;
  });

  const typeEmoji = { acao_br:'🇧🇷', fii:'🏢', etf_br:'📊', acao_us:'🇺🇸', etf_us:'📈',
    bdr:'🌐', crypto:'₿', tesouro_direto:'🏛️', fundo_investimento:'🏦', renda_fixa:'💰', outro:'📌' };
  const typeLabel = { acao_br:'Ações BR', fii:'FIIs', etf_br:'ETFs BR', acao_us:'Ações US',
    etf_us:'ETFs US', bdr:'BDRs', crypto:'Cripto', tesouro_direto:'Tesouro', fundo_investimento:'Fundos',
    renda_fixa:'Renda Fixa', outro:'Outros' };

  const typeRows = Object.entries(byType)
    .sort((a,b) => b[1].mv - a[1].mv)
    .slice(0, 5)
    .map(([type, d]) => {
      const pct = totalMV ? (d.mv / totalMV * 100) : 0;
      const emoji = typeEmoji[type] || '📌';
      const lbl   = typeLabel[type] || type;
      return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:.88rem;flex-shrink:0">${emoji}</span>
        <span style="font-size:.78rem;font-weight:600;color:var(--text2);flex:1">${lbl}</span>
        <span style="font-size:.7rem;color:var(--muted);min-width:34px;text-align:right">${pct.toFixed(0)}%</span>
        <span style="font-size:.82rem;font-weight:700;color:var(--text);min-width:80px;text-align:right;font-family:var(--font-serif)">${fmt(d.mv)}</span>
      </div>`;
    }).join('');

  // Top positions
  const topPos = [...positions]
    .sort((a,b) => (typeof _invMarketValue === 'function' ? _invMarketValue(b) - _invMarketValue(a) : 0))
    .slice(0, 3);

  const topRows = topPos.map(p => {
    const mv  = typeof _invMarketValue === 'function' ? _invMarketValue(p) : 0;
    const c   = typeof _invCost === 'function' ? _invCost(p) : (+(p.quantity) * +(p.avg_cost));
    const ret = c ? (mv - c) / c * 100 : 0;
    const retColor = ret >= 0 ? 'var(--accent)' : 'var(--red,#dc2626)';
    const netRet = typeof _invNetReturn === 'function' ? _invNetReturn(p) : null;
    return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)">
      <div style="flex:1;min-width:0">
        <div style="font-size:.82rem;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.ticker)}</div>
        <div style="font-size:.68rem;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name||'')}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:.82rem;font-weight:700;font-family:var(--font-serif)">${fmt(mv)}</div>
        <div style="font-size:.68rem;font-weight:600;color:${retColor}">${ret>=0?'+':''}${ret.toFixed(2)}%${netRet?.hasFees?' (liq. '+netRet.netReturnPct.toFixed(1)+'%)':''}</div>
      </div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <!-- KPI strip -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px;background:var(--border);border-radius:10px;overflow:hidden;margin-bottom:12px">
      <div style="background:var(--surface2);padding:10px 14px">
        <div style="font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:3px">Valor de mercado</div>
        <div style="font-size:.95rem;font-weight:800;font-family:var(--font-serif);color:var(--text)">${fmt(totalMV)}</div>
      </div>
      <div style="background:var(--surface2);padding:10px 14px">
        <div style="font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:3px">Custo total</div>
        <div style="font-size:.95rem;font-weight:800;font-family:var(--font-serif);color:var(--text2)">${fmt(totalCost)}</div>
      </div>
      <div style="background:var(--surface2);padding:10px 14px">
        <div style="font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:3px">Resultado</div>
        <div style="font-size:.95rem;font-weight:800;font-family:var(--font-serif);color:${isPos?'var(--accent)':'var(--red,#dc2626)'}">${isPos?'+':''}${fmt(pnl)} <span style="font-size:.72rem">(${pnlPct.toFixed(2)}%)</span></div>
      </div>
    </div>
    <!-- Distribution by type -->
    ${Object.keys(byType).length > 1 ? `
    <div style="font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:4px;padding:0 2px">Distribuição por tipo</div>
    <div style="margin-bottom:10px">${typeRows}</div>` : ''}
    <!-- Top positions -->
    <div style="font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:4px;padding:0 2px">Principais posições</div>
    <div>${topRows}</div>
    <div style="text-align:center;padding:8px 0 2px">
      <button class="btn btn-ghost btn-sm" onclick="navigate('investments')" style="font-size:.75rem">Ver carteira completa →</button>
    </div>`;
}
window._dashRenderInvestments = _dashRenderInvestments;

function _dashApplyPrefs(prefs) {
  const order = _getDashCardOrder(prefs);
  const available = _getDashAvailableCards();
  const availableIds = new Set(available.map(c => c.id));

  // ── 1. Visibilidade ────────────────────────────────────────────────────────
  order.forEach(c => {
    const el = document.getElementById(c.el);
    if (!el) return;
    // Module-gated cards: only show if module is active AND user has it enabled
    if (c.moduleKey && !availableIds.has(c.id)) {
      el.style.display = 'none';
      return;
    }
    el.style.display = prefs[c.id] !== false ? '' : 'none';
  });

  // ── 2. Reordenação robusta no DOM ──────────────────────────────────────────
  // Elementos fixos que NUNCA devem ser movidos (sempre no topo):
  //   .page-header-bar  — barra de título injetada pelo navigate()
  //   #dashFilterBadge  — badge de filtro de membro/grupo
  //   #fxRatesBadge     — barra de câmbio
  try {
    const els = order.map(c => document.getElementById(c.el)).filter(Boolean);
    if (!els.length) return;
    const parent = els[0].parentElement;
    if (!parent) return;

    // Filtra apenas os cards que são filhos diretos deste pai
    const direct = els.filter(el => el.parentElement === parent);
    if (!direct.length) return;

    // IDs/classes que são elementos fixos — não devem ser tocados
    const _isFixed = el =>
      el.classList.contains('page-header-bar') ||
      el.id === 'dashFilterBadge' ||
      el.id === 'fxRatesBadge';

    // Encontrar o índice do primeiro filho NÃO-fixo (ponto de inserção inicial)
    const allChildren = Array.from(parent.children);
    let insertionBase = allChildren.findIndex(ch => !_isFixed(ch));
    if (insertionBase < 0) insertionBase = allChildren.length;

    // Reordenar: inserir cada card na sequência correta, após os elementos fixos
    direct.forEach((el, i) => {
      const refIndex = insertionBase + i;
      const refEl = parent.children[refIndex];
      if (refEl && refEl !== el) {
        parent.insertBefore(el, refEl);
      } else if (!refEl) {
        parent.appendChild(el);
      }
    });
  } catch(_) {}
}

function openDashCustomModal() {
  const prefs = _dashGetPrefs();
  const order = _getDashCardOrder(prefs);
  _dashCustomCurrentOrder = order.map(c => c.id);
  _renderDashCustomList(order, prefs);
  openModal('dashCustomModal');
  requestAnimationFrame(() => _dashInitDnD());
}

function _getDashCardOrder(prefs) {
  const savedOrder = prefs._order;
  if (savedOrder && Array.isArray(savedOrder)) {
    const ordered = savedOrder
      .map(id => _DASH_CARDS.find(c => c.id === id))
      .filter(Boolean);
    _DASH_CARDS.forEach(c => { if (!ordered.find(x => x.id === c.id)) ordered.push(c); });
    return ordered;
  }
  return [..._DASH_CARDS];
}

let _dashCustomCurrentOrder = null;

function _renderDashCustomList(order, prefs) {
  const list = document.getElementById('dashCustomList');
  if (!list) return;
  const _avail = new Set(_getDashAvailableCards().map(c => c.id));
  list.innerHTML = order.filter(c => !c.moduleKey || _avail.has(c.id)).map((c, idx) => `
    <div class="dash-custom-item" data-card-id="${c.id}" draggable="true"
      style="display:flex;align-items:center;gap:10px;padding:11px 14px;
        background:var(--surface2);border:1.5px solid var(--border);
        border-radius:10px;cursor:grab;transition:all .15s;user-select:none"
      onmouseenter="this.style.borderColor='var(--accent)'"
      onmouseleave="this.style.borderColor='var(--border)'">
      <span style="color:var(--muted);font-size:1rem;flex-shrink:0;cursor:grab" title="Arrastar">⠿</span>
      <span style="font-size:1.1rem;flex-shrink:0">${c.icon}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:.84rem;font-weight:600;color:var(--text)">${c.label}</div>
        <div style="font-size:.71rem;color:var(--muted);margin-top:1px">${c.sub}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:2px;flex-shrink:0">
        <button
          style="width:24px;height:20px;border-radius:5px;border:1px solid var(--border);
            background:var(--surface);color:var(--text2);font-size:.65rem;cursor:pointer;
            display:flex;align-items:center;justify-content:center;
            ${idx===0 ? 'opacity:.3;pointer-events:none' : ''}"
          onclick="event.stopPropagation();_dashMoveCard('${c.id}',-1)"
          title="Mover para cima">▲</button>
        <button
          style="width:24px;height:20px;border-radius:5px;border:1px solid var(--border);
            background:var(--surface);color:var(--text2);font-size:.65rem;cursor:pointer;
            display:flex;align-items:center;justify-content:center;
            ${idx===order.length-1 ? 'opacity:.3;pointer-events:none' : ''}"
          onclick="event.stopPropagation();_dashMoveCard('${c.id}',+1)"
          title="Mover para baixo">▼</button>
      </div>
      <button class="dash-toggle-switch ${prefs[c.id]!==false?'on':''}" data-card="${c.id}"
        style="flex-shrink:0"
        onclick="event.stopPropagation();_dashToggleCard('${c.id}',this.closest('.dash-custom-item'))">
      </button>
    </div>`).join('');
  requestAnimationFrame(() => _dashInitDnD());
}

function _dashMoveCard(id, dir) {
  const prefs = _dashGetPrefs();
  const order = _getDashCardOrder({ ...prefs, _order: _dashCustomCurrentOrder || prefs._order });
  const idx   = order.findIndex(c => c.id === id);
  if (idx < 0) return;
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= order.length) return;
  [order[idx], order[newIdx]] = [order[newIdx], order[idx]];
  _dashCustomCurrentOrder = order.map(c => c.id);
  const updPrefs = { ...prefs, _order: _dashCustomCurrentOrder };
  _renderDashCustomList(order, updPrefs);
  _dashSavePrefs(updPrefs).catch(() => {});
  _dashApplyPrefs(updPrefs);
}

function _dashToggleCard(id, row) {
  const btn = row ? row.querySelector('.dash-toggle-switch') : null;
  if (!btn) return;
  const isOn = btn.classList.toggle('on');
  const prefs = _dashGetPrefs();
  const updPrefs = { ...prefs, [id]: isOn };
  if (_dashCustomCurrentOrder) updPrefs._order = _dashCustomCurrentOrder;
  _dashSavePrefs(updPrefs).catch(() => {});
  _dashApplyPrefs(updPrefs);
}

// Drag-and-Drop nativo
let _dndDragId = null;

function _dashInitDnD() {
  const list = document.getElementById('dashCustomList');
  if (!list) return;
  list.querySelectorAll('.dash-custom-item').forEach(item => {
    item.addEventListener('dragstart', e => {
      _dndDragId = item.dataset.cardId;
      item.style.opacity = '.45';
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => {
      item.style.opacity = '';
      list.querySelectorAll('.dash-custom-item').forEach(i => {
        i.style.background = ''; i.style.borderColor = 'var(--border)';
      });
    });
    item.addEventListener('dragover', e => {
      e.preventDefault();
      if (item.dataset.cardId !== _dndDragId) {
        item.style.borderColor = 'var(--accent)';
        item.style.background  = 'var(--accent-lt, #e8f2ee)';
      }
    });
    item.addEventListener('dragleave', () => {
      item.style.background = ''; item.style.borderColor = 'var(--border)';
    });
    item.addEventListener('drop', e => {
      e.preventDefault();
      item.style.background = ''; item.style.borderColor = 'var(--border)';
      if (!_dndDragId || _dndDragId === item.dataset.cardId) return;
      const prefs = _dashGetPrefs();
      const order = _getDashCardOrder({ ...prefs, _order: _dashCustomCurrentOrder || prefs._order });
      const fromIdx = order.findIndex(c => c.id === _dndDragId);
      const toIdx   = order.findIndex(c => c.id === item.dataset.cardId);
      if (fromIdx < 0 || toIdx < 0) { _dndDragId = null; return; }
      const [moved] = order.splice(fromIdx, 1);
      order.splice(toIdx, 0, moved);
      _dashCustomCurrentOrder = order.map(c => c.id);
      const updPrefs = { ...prefs, _order: _dashCustomCurrentOrder };
      _renderDashCustomList(order, updPrefs);
      _dashSavePrefs(updPrefs).catch(() => {});
      _dashApplyPrefs(updPrefs);
      _dndDragId = null;
    });
  });
}

function _dashCustomSave() {
  // Mudanças já são aplicadas em tempo real — apenas fecha o modal
  closeModal('dashCustomModal');
  toast('Preferências do dashboard salvas!', 'success');
}

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
// ── Dashboard Forecast 90d ─────────────────────────────────────────────────
let _dashForecastChart = null;
let _dashForecastRendering = false; // lock para evitar chamadas concorrentes
let _dashForecastTimer = null;

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
  // ── Lock de concorrência: evitar "Canvas is already in use" ──────────────
  // Se uma renderização já está em progresso, aguardar até 1.5s e tentar de novo
  if (_dashForecastRendering) {
    await new Promise(r => setTimeout(r, 80));
    if (_dashForecastRendering) return; // ainda ocupado — desistir
  }
  _dashForecastRendering = true;
  try {
    await _renderDashForecastInner();
  } finally {
    _dashForecastRendering = false;
  }
}

async function _renderDashForecastInner() {
  const card = document.getElementById('dashCardForecast90');
  if (!card || card.style.display === 'none') return;

  _initDashForecastAccountSelect();

  const accIds = typeof _fcPickerGetSelected === 'function'
    ? _fcPickerGetSelected('dashForecastAcctPicker')
    : [];
  const includeScheduled = document.getElementById('dashForecastScheduled')?.checked !== false;
  const canvas = document.getElementById('dashForecastChart');
  if (!canvas) return;

  // Destroy previous chart — usar Chart.getChart para garantir limpeza total do canvas
  // independente de _dashForecastChart ter sido perdido por navegação ou erro anterior
  const existingChart = (typeof Chart !== 'undefined' && Chart.getChart)
    ? Chart.getChart(canvas) : null;
  if (existingChart) {
    try { existingChart.destroy(); } catch(_) {}
  }
  if (_dashForecastChart && _dashForecastChart !== existingChart) {
    try { _dashForecastChart.destroy(); } catch(_) {}
  }
  _dashForecastChart = null;

  // Date range: today → today + 90 days
  const fromDate = new Date();
  const toDate   = new Date();
  toDate.setDate(toDate.getDate() + 90);
  const fromStr = fromDate.toISOString().slice(0, 10);
  const toStr   = toDate.toISOString().slice(0, 10);

  // Fetch real transactions in period
  let q = famQ(sb.from('transactions')
    .select('id,date,description,amount,currency,brl_amount,account_id,is_transfer,categories(name,color,icon),payees(name),accounts!transactions_account_id_fkey(id,name,color,currency,icon,type,balance)')
    .gte('date', fromStr).lte('date', toStr).order('date'));
  if (accIds.length === 1) q = q.eq('account_id', accIds[0]);
  else if (accIds.length > 1) q = q.in('account_id', accIds);
  const { data: txData } = await q;

  // Build scheduled items using same logic as forecast.js
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
            scheduledItems.push({
              date,
              description: sc.description || '',
              amount: originAmount,
              account_id: sc.account_id,
              currency: sc.currency || accMeta?.currency || 'BRL',
              categories: sc.categories || null,
              payees: sc.payees || null,
              accounts: accMeta || null,
              isScheduled: true,
              scheduled_id: sc.id,
              scheduled_type: sc.type || ''
            });
          }
        }
        if (isTransfer && sc.transfer_to_account_id && (!accIds.length || accIds.includes(sc.transfer_to_account_id))) {
          const accMeta = (state.accounts || []).find(a => a.id === sc.transfer_to_account_id);
          scheduledItems.push({
            date,
            description: sc.description || '',
            amount: Math.abs(parseFloat(sc.amount)||0),
            account_id: sc.transfer_to_account_id,
            currency: accMeta?.currency || 'BRL',
            categories: sc.categories || null,
            payees: null,
            accounts: accMeta || null,
            isScheduled: true,
            scheduled_id: sc.id,
            scheduled_type: sc.type || ''
          });
        }
      });
    });
  }

  const allItems = [...(txData||[]), ...scheduledItems]
    .map(item => ({
      ...item,
      accounts: item.accounts || (state.accounts || []).find(a => a.id === item.account_id) || null,
    }))
    .sort((a,b)=> {
      const dateCmp = String(a.date||'').localeCompare(String(b.date||''));
      if (dateCmp !== 0) return dateCmp;
      const accCmp = String(a.account_id||'').localeCompare(String(b.account_id||''));
      if (accCmp !== 0) return accCmp;
      return (parseFloat(a.amount)||0) - (parseFloat(b.amount)||0);
    });

  const accountIds = [...new Set(allItems.map(t=>t.account_id))].filter(Boolean);

  // Quando sem picker selecionado:
  //   - Prioridade 1: contas que têm tx no período (accountIds)
  //   - Fallback: todas as contas ativas (garante KPIs mesmo sem tx nos 90 dias)
  const allActiveAccounts = (state.accounts||[]).filter(a => a.active !== false);
  const accounts = accIds.length
    ? (state.accounts||[]).filter(a=>accIds.includes(a.id))
    : accountIds.length
      ? (state.accounts||[]).filter(a=>accountIds.includes(a.id))
      : allActiveAccounts;

  if (!accounts.length) {
    const summary = document.getElementById('dashForecastSummary');
    if (summary) summary.innerHTML = '<span style="color:var(--muted)">Sem dados de previsão para o período</span>';
    return;
  }

  // Build daily dates for the full 90-day horizon
  const dates = [];
  let cur = new Date(fromStr+'T12:00');
  const end = new Date(toStr+'T12:00');
  while (cur <= end) { dates.push(cur.toISOString().slice(0,10)); cur.setDate(cur.getDate()+1); }

  const COLORS = ['#2a6049','#1d4ed8','#b45309','#7c3aed','#dc2626','#059669'];
  const visibleAccounts = accounts.slice(0,6);

  // ── Calcular KPI: saldo inicial e final totais ──────────────────────────

  const txByDate = dates.reduce((acc, date) => { acc[date] = []; return acc; }, {});
  allItems.forEach(item => {
    if (txByDate[item.date]) txByDate[item.date].push(item);
  });

  const txByDateGrouped = Object.keys(txByDate).reduce((acc, date) => {
    const groupedMap = new Map();
    (txByDate[date] || []).forEach(item => {
      const accKey = item.account_id || '__no_account__';
      if (!groupedMap.has(accKey)) {
        groupedMap.set(accKey, {
          account_id: item.account_id || '',
          account_name: item.accounts?.name || 'Sem conta',
          account_color: item.accounts?.color || 'var(--border)',
          account_currency: item.accounts?.currency || item.currency || 'BRL',
          items: [],
        });
      }
      groupedMap.get(accKey).items.push(item);
    });
    acc[date] = Array.from(groupedMap.values())
      .map(group => ({
        ...group,
        total: group.items.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0),
      }))
      .sort((a,b) => a.account_name.localeCompare(b.account_name, 'pt-BR'));
    return acc;
  }, {});

  const datasets = visibleAccounts.map((a,idx)=>{
    const txAcc = allItems.filter(t=>t.account_id===a.id);
    const txAccByDate = txAcc.reduce((acc, item) => {
      acc[item.date] = (acc[item.date] || 0) + (parseFloat(item.amount) || 0);
      return acc;
    }, {});
    const realSum = txAcc.filter(t=>!t.isScheduled).reduce((s,t)=>s+(parseFloat(t.amount)||0),0);
    const baseBal = (parseFloat(a.balance)||0) - realSum;
    const color = a.color || COLORS[idx%COLORS.length];
    const accTxDates = new Set(Object.keys(txAccByDate));
    let runningBalance = baseBal;
    const dailySeries = dates.map(date => {
      runningBalance += txAccByDate[date] || 0;
      return +runningBalance.toFixed(2);
    });
    return {
      label: a.name,
      data: dailySeries,
      borderColor: color,
      backgroundColor: color + '14',
      fill: 'origin',
      tension: 0.4,
      borderWidth: 2.5,
      pointRadius: dates.map(date => accTxDates.has(date) ? 3 : 0),
      pointHitRadius: dates.map(() => 14),
      pointHoverRadius: dates.map(date => accTxDates.has(date) ? 6 : 4),
      pointBackgroundColor: color,
      pointBorderColor: '#fff',
      pointBorderWidth: 1.5,
      spanGaps: false,
      _baseBal: baseBal,
    };
  });

  // ── KPIs: saldo inicial total, projetado, min e max ────────────────────
  // totalInicial = saldo atual real das contas visíveis (não filtradas por período)
  const totalInicial = visibleAccounts.reduce((s,a) => s + (parseFloat(a.balance)||0), 0);
  let globalMin = Infinity, globalMax = -Infinity, totalFinal = 0;
  datasets.forEach(ds => {
    ds.data.forEach(v => {
      if (v < globalMin) globalMin = v;
      if (v > globalMax) globalMax = v;
    });
    totalFinal += ds.data[ds.data.length - 1] ?? 0;
  });
  if (globalMin === Infinity)  globalMin = 0;
  if (globalMax === -Infinity) globalMax = 0;

  const _fcp = id => document.getElementById(id);
  const _fcpFmt = (v, color) => {
    const el = _fcp(color);
    if (!el) return;
    el.textContent = fmt(v);
    el.style.color = v < 0 ? 'var(--red,#dc2626)' : '';
  };
  _fcpFmt(totalInicial, 'fcp-kpi-inicial');
  if (_fcp('fcp-kpi-final')) {
    _fcp('fcp-kpi-final').textContent = fmt(totalFinal);
    _fcp('fcp-kpi-final').style.color = totalFinal < 0 ? 'var(--red,#dc2626)'
      : totalFinal > totalInicial ? 'var(--green,#16a34a)' : 'var(--accent)';
  }
  if (_fcp('fcp-kpi-min')) _fcp('fcp-kpi-min').textContent = fmt(globalMin);
  if (_fcp('fcp-kpi-max')) _fcp('fcp-kpi-max').textContent = fmt(globalMax);

  // ── Anotações: linha zero + ponto min + ponto máximo ──────────────────
  let minPtDate = null, maxPtDate = null;
  let minPtVal = Infinity, maxPtVal = -Infinity;
  // Usar apenas o primeiro dataset para anotações de ponto (mais legível)
  if (datasets.length > 0) {
    datasets[0].data.forEach((v, i) => {
      if (v < minPtVal) { minPtVal = v; minPtDate = dates[i]; }
      if (v > maxPtVal) { maxPtVal = v; maxPtDate = dates[i]; }
    });
  }
  const annotations = {
    zeroLine: {
      type: 'line', yMin: 0, yMax: 0,
      borderColor: 'rgba(220,38,38,.40)', borderWidth: 1.5, borderDash: [5,4],
    },
  };
  if (minPtDate) annotations.minPt = {
    type:'point', xValue:minPtDate, yValue:minPtVal,
    radius:5, backgroundColor:'#dc2626', borderColor:'#fff', borderWidth:2,
  };
  if (maxPtDate) annotations.maxPt = {
    type:'point', xValue:maxPtDate, yValue:maxPtVal,
    radius:5, backgroundColor:'#16a34a', borderColor:'#fff', borderWidth:2,
  };

  // ── Gráfico ────────────────────────────────────────────────────────────
  _dashForecastChart = new Chart(canvas, {
    type: 'line',
    data: { labels: dates, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode:'index', intersect:false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            boxWidth: 10, boxHeight: 10,
            borderRadius: 5,
            usePointStyle: true, pointStyle: 'circle',
            font: { size: 10, weight: '600' },
            color: 'var(--text2)',
            padding: 12,
          },
        },
        tooltip: {
          backgroundColor: 'var(--surface)',
          titleColor: 'var(--text)',
          bodyColor: 'var(--text2)',
          borderColor: 'var(--border)',
          borderWidth: 1,
          padding: 10,
          cornerRadius: 10,
          boxPadding: 4,
          callbacks: {
            title(items) {
              const label = items?.[0]?.label || '';
              return typeof fmtDate === 'function' ? fmtDate(label) : label;
            },
            label(ctx) {
              const isNeg = ctx.parsed.y < 0;
              return ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`;
            },
            afterBody(items) {
              const label = items?.[0]?.label || '';
              const groups = txByDateGrouped[label] || [];
              if (!groups.length) return [];
              return ['', ...groups.map(g => `  ${g.account_name}: ${g.items.length} lançamento(s)`)];
            },
          },
        },
        annotation: { annotations },
      },
      scales: {
        x: {
          type: 'category',
          ticks: {
            autoSkip: true,
            maxTicksLimit: 7,
            color: 'var(--muted)',
            font: { size: 10 },
            callback(value, index) {
              const label = this.getLabelForValue ? this.getLabelForValue(value) : dates[index];
              if (!label) return '';
              const parts = label.split('-');
              return parts.length === 3 ? `${parts[2]}/${parts[1]}` : label;
            },
          },
          grid: { color: 'rgba(0,0,0,.04)' },
          border: { display: false },
        },
        y: {
          ticks: {
            callback: v => fmt(v),
            color: 'var(--muted)',
            font: { size: 10 },
            maxTicksLimit: 5,
          },
          grid: {
            color: ctx => ctx.tick.value === 0 ? 'rgba(220,38,38,.15)' : 'rgba(0,0,0,.04)',
          },
          border: { display: false },
        },
      },
      onClick(evt) {
        const points = _dashForecastChart?.getElementsAtEventForMode(evt, 'index', { intersect:false }, false) || [];
        if (!points.length) return;
        const idx = points[0].index;
        const label = dates[idx] || '';
        if (label) _dashForecastDrill(label, txByDateGrouped[label] || []);
      },
      onHover(evt) {
        const points = _dashForecastChart?.getElementsAtEventForMode(evt, 'index', { intersect:false }, false) || [];
        const hasDate = Boolean(points?.length);
        if (evt.native?.target) evt.native.target.style.cursor = hasDate ? 'pointer' : 'default';
      },
    },
  });

  // ── Summary: chips por conta com saldo final ──────────────────────────
  const summary = document.getElementById('dashForecastSummary');
  if (summary) {
    if (!visibleAccounts.length) {
      summary.innerHTML = '<span style="color:var(--muted);font-size:.78rem">Sem dados para o período.</span>';
    } else {
      summary.innerHTML = visibleAccounts.map((a, idx) => {
        const ds = datasets[idx];
        const finalY = ds?.data?.[ds.data.length - 1] ?? 0;
        const isNeg  = finalY < 0;
        const color  = a.color || COLORS[idx % COLORS.length];
        return `<div class="fcp-acct-chip">
          <span class="fcp-acct-dot" style="background:${color}"></span>
          <span class="fcp-acct-name">${esc(a.name)}</span>
          <span class="fcp-acct-val ${isNeg ? 'fcp-acct-val--neg' : 'fcp-acct-val--pos'}">${fmt(finalY, a.currency)}</span>
        </div>`;
      }).join('');
    }
  }
}


function _dashDrillToTx(categoryId, month) {
  state.txFilter = state.txFilter || {};
  state.txFilter.month      = month || '';
  state.txFilter.categoryId = categoryId || '';
  state.txFilter.type       = '';
  state.txFilter.search     = '';
  state.txFilter.status     = '';
  state.txPage = 0;
  navigate('transactions');
  // Sync filter UI after navigation
  requestAnimationFrame(() => {
    const mEl = document.getElementById('txMonth');
    const cEl = document.getElementById('txCategoryFilter');
    if (mEl) mEl.value = state.txFilter.month;
    if (cEl) cEl.value = state.txFilter.categoryId;
    loadTransactions();
  });
}

// ── Category chart type toggle ────────────────────────────────────────────
let _catChartType = 'bar';     // default: bar chart
let _dashCatMode  = 'expense'; // 'expense' | 'income'

// Dashboard category mode toggle (expense/income)
function _setDashCatMode(mode) {
  _dashCatMode = mode;
  const expBtn = document.getElementById('dashCatModeExp');
  const incBtn = document.getElementById('dashCatModeInc');
  if (expBtn) expBtn.classList.toggle('active', mode === 'expense');
  if (incBtn) incBtn.classList.toggle('active', mode === 'income');
  const titleEl = document.getElementById('dashCatChartTitle');
  if (titleEl) titleEl.textContent = 'Distribuição por Categoria';
  // Re-render using cached data
  _renderDashCatWithMode();
}
window._setDashCatMode = _setDashCatMode;

function _renderDashCatWithMode() {
  // Switch _catChartEntries to whichever mode is active, then re-render
  if (_dashCatMode === 'income') {
    _catChartEntries = window._catChartIncEntriesRaw || [];
  } else {
    _catChartEntries = window._catChartExpEntriesRaw || [];
  }
  if (!_catChartEntries.length) return;
  // Destroy existing chart cleanly
  const existing = state.chartInstances?.['categoryChart'];
  if (existing) { try { existing.destroy(); } catch(_){} delete state.chartInstances['categoryChart']; }
  closeCatDetail();
  if (_catChartType === 'bar') _renderCatChartBar();
  else _renderCatChartDoughnut();
}

function _setCatChartType(type) {
  _catChartType = type;
  // Sync toggle button visuals
  const pie  = document.getElementById('catChartTypePie');
  const bar2 = document.getElementById('catChartTypeBar');
  if (pie)  { pie.classList.toggle('active',  type === 'doughnut'); pie.style.background=''; pie.style.color=''; }
  if (bar2) { bar2.classList.toggle('active', type === 'bar');      bar2.style.background=''; bar2.style.color=''; }

  // Persist preference
  try { _dashSavePrefs({ ..._dashGetPrefs(), catChartType: type }).catch(() => {}); } catch(_) {}

  // Guard: no data yet — nothing to render
  if (!_catChartEntries.length) return;

  // Destroy current chart cleanly before switching type
  const existing = state.chartInstances?.['categoryChart'];
  if (existing) { try { existing.destroy(); } catch(_) {} delete state.chartInstances['categoryChart']; }

  // Reset detail panel
  const detailEl = document.getElementById('catChartDetail');
  const backBtn  = document.getElementById('catDetailBackBtn');
  if (detailEl) detailEl.style.display = 'none';
  if (backBtn)  backBtn.style.display  = 'none';

  if (type === 'bar') {
    _renderCatChartBar();
  } else {
    _renderCatChartDoughnut();
  }
}

function _renderCatChartDoughnut() {
  const canvas = document.getElementById('categoryChart');
  if (!canvas || !_catChartEntries.length) return; // FIX: guarda contra dados vazios
  // Reset wrapper so doughnut uses its natural aspect ratio
  const wrap = document.getElementById('catChartWrap');
  if (wrap) { wrap.style.height = ''; }
  canvas.setAttribute('height', '200');
  canvas.style.height = '';
  renderChart('categoryChart', 'doughnut',
    _catChartEntries.map(e => e.name),
    [{ data: _catChartEntries.map(e => e.total), backgroundColor: _catChartEntries.map(e => e.color), borderWidth: 2, borderColor: '#fff', hoverOffset: 8, hoverBorderWidth: 3 }],
    {
      onClick(event, elements) { if (elements.length) openCatDetail(elements[0].index); },
      onHover(event, elements) { const c = event.native?.target; if (c) c.style.cursor = elements.length ? 'pointer' : 'default'; },
    }
  );
}

function _renderCatChartBar() {
  const canvas = document.getElementById('categoryChart');
  if (!canvas || !_catChartEntries.length) return;
  // Destroy existing
  const existing = state.chartInstances['categoryChart'];
  if (existing) { try { existing.destroy(); } catch(e) {} delete state.chartInstances['categoryChart']; }
  // Set explicit height on the wrapper — required for maintainAspectRatio:false
  const barH = Math.max(200, _catChartEntries.length * 36 + 48);
  const wrap = document.getElementById('catChartWrap');
  if (wrap) { wrap.style.height = barH + 'px'; wrap.style.overflowX = 'hidden'; }
  canvas.removeAttribute('height');
  canvas.style.height = barH + 'px';
  canvas.style.maxWidth = '100%';
  const chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: _catChartEntries.map(e => e.name),
      datasets: [{
        data: _catChartEntries.map(e => e.total),
        backgroundColor: _catChartEntries.map(e => e.color + 'cc'),
        borderColor:     _catChartEntries.map(e => e.color),
        borderWidth: 1.5,
        borderRadius: 6,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => fmt(ctx.parsed.x) } }
      },
      scales: {
        x: { ticks: { callback: v => fmt(v), color: '#8c8278', font: { size: 10 } }, grid: { color: '#e8e4de44' } },
        y: { ticks: { color: '#8c8278', font: { size: 11 } }, grid: { display: false } }
      },
      onClick(event, elements) { if (elements.length) openCatDetail(elements[0].index); },
      onHover(event, elements) { const c = event.native?.target; if (c) c.style.cursor = elements.length ? 'pointer' : 'default'; },
    }
  });
  state.chartInstances['categoryChart'] = chart;
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


// === Navigate to forecast report on chart click ===
function attachForecastNavigation(chartInstance, labelsArr, txByLabel) {
  if (!chartInstance) return;
  chartInstance.options.onClick = function(evt, elements) {
    if (elements && elements.length && labelsArr && txByLabel) {
      const idx   = elements[0].index;
      const label = labelsArr[idx];
      const txs   = txByLabel[label] || [];
      if (txs.length) {
        // Show inline drill panel on dashboard
        _dashForecastDrill(label, txs);
        return;
      }
    }
    // Default: navigate to forecast report
    navigate('reports');
    setTimeout(() => {
      if (typeof setReportView === 'function') setReportView('forecast');
    }, 300);
  };
  chartInstance.options.onHover = function(evt, elements) {
    evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
  };
  chartInstance.update();
}

function _dashForecastOpenItem(kind, id) {
  closeModal('forecastDrillModal');
  if (kind === 'scheduled') {
    if (typeof openScheduledModal === 'function') openScheduledModal(id || '');
    return;
  }
  if (typeof editTransaction === 'function') editTransaction(id || '');
}
window._dashForecastOpenItem = _dashForecastOpenItem;

function _dashForecastDrill(label, groups) {
  _showForecastDrillModal(label, groups);
}

function _showForecastDrillModal(label, groups) {
  const normalizedGroups = Array.isArray(groups) ? groups : [];
  const allTxs = normalizedGroups.flatMap(group => Array.isArray(group.items) ? group.items : []);
  const totalAbs = allTxs.reduce((sum, item) => sum + Math.abs(Number(item.amount) || 0), 0);
  const totalNet = allTxs.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const rows = normalizedGroups.length
    ? normalizedGroups.map(group => {
        const accountTone = group.account_color || 'var(--border)';
        const accountCurrency = group.account_currency || 'BRL';
        const itemsHtml = (group.items || []).map(item => {
          const isNeg = Number(item.amount) < 0;
          const catColor = item.categories?.color || (isNeg ? 'var(--red)' : 'var(--green)');
          const meta = [
            item.isScheduled ? 'Programado' : 'Lançado',
            item.categories?.name ? esc(item.categories.name) : '',
            item.payees?.name ? esc(item.payees.name) : ''
          ].filter(Boolean).join(' · ');
          const openKind = item.isScheduled ? 'scheduled' : 'transaction';
          const openId = item.isScheduled ? (item.scheduled_id || '') : (item.id || '');
          const badge = item.isScheduled
            ? '<span style="font-size:.62rem;background:rgba(30,91,168,.12);color:#1e5ba8;border-radius:4px;padding:1px 5px;margin-left:4px">prog.</span>'
            : '';
          return `<button type="button" onclick="_dashForecastOpenItem('${openKind}','${openId}')" style="width:100%;text-align:left;display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;cursor:pointer">
            <span style="width:8px;height:8px;border-radius:50%;background:${catColor};flex-shrink:0"></span>
            <span style="flex:1;min-width:0">
              <span style="display:block;font-size:.8rem;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(item.description || '—')}${badge}</span>
              <span style="display:block;font-size:.68rem;color:var(--muted);margin-top:2px">${meta || 'Sem detalhes adicionais'}</span>
            </span>
            <span style="font-size:.82rem;font-weight:700;color:${isNeg ? 'var(--red,#c0392b)' : 'var(--green,#2a7a4a)'};flex-shrink:0">${isNeg ? '−' : '+'}${fmt(Math.abs(Number(item.amount) || 0), item.currency || accountCurrency)}</span>
          </button>`;
        }).join('');

        return `<div style="display:flex;flex-direction:column;gap:8px;padding:10px 0;border-top:1px solid var(--border)">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
            <div style="display:flex;align-items:center;gap:8px;min-width:0">
              <span style="width:9px;height:9px;border-radius:50%;background:${accountTone};flex-shrink:0"></span>
              <div style="min-width:0">
                <div style="font-size:.8rem;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(group.account_name || 'Sem conta')}</div>
                <div style="font-size:.68rem;color:var(--muted)">${group.items.length} item(ns)</div>
              </div>
            </div>
            <div style="font-size:.8rem;font-weight:700;color:${group.total < 0 ? 'var(--red,#c0392b)' : 'var(--green,#2a7a4a)'};flex-shrink:0">${group.total < 0 ? '−' : '+'}${fmt(Math.abs(group.total || 0), accountCurrency)}</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px">${itemsHtml}</div>
        </div>`;
      }).join('')
    : `<div style="padding:18px 10px;text-align:center;color:var(--muted)">Nenhuma transação ou programado encontrado para este dia.</div>`;

  const subtitle = `${allTxs.length} lançamento${allTxs.length!==1?'s':''} · líquido ${totalNet < 0 ? '−' : '+'}${fmt(Math.abs(totalNet))}`;
  const title = typeof fmtDate === 'function' ? fmtDate(label) : label;
  const netColor = totalNet < 0 ? 'var(--red,#dc2626)' : 'var(--green,#16a34a)';
  const content = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px">
      <div>
        <div style="font-size:.92rem;font-weight:800;color:var(--text);letter-spacing:-.01em">${esc(title)}</div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:3px;flex-wrap:wrap">
          <span style="font-size:.72rem;color:var(--muted)">${allTxs.length} lançamento${allTxs.length!==1?'s':''}</span>
          <span style="font-size:.72rem;font-weight:700;color:${netColor}">
            ${totalNet < 0 ? '−' : '+'}${fmt(Math.abs(totalNet))}
          </span>
          ${totalAbs > Math.abs(totalNet) ? `<span style="font-size:.68rem;color:var(--muted)">giro ${fmt(totalAbs)}</span>` : ''}
        </div>
      </div>
      <button onclick="closeModal('forecastDrillModal')"
        style="background:var(--surface2);border:1px solid var(--border);border-radius:20px;padding:4px 12px;cursor:pointer;font-size:.72rem;font-weight:600;color:var(--text2);white-space:nowrap;flex-shrink:0;transition:background .15s"
        onmouseover="this.style.background='var(--border)'" onmouseout="this.style.background='var(--surface2)'">
        Fechar ✕
      </button>
    </div>
    <div style="display:flex;flex-direction:column;gap:0;max-height:60dvh;overflow-y:auto">${rows}</div>`;

  let modal = document.getElementById('forecastDrillModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'forecastDrillModal';
    modal.className = 'modal-overlay';
    modal.onclick = e => { if (e.target === modal) closeModal('forecastDrillModal'); };
    modal.innerHTML = '<div class="modal" style="max-width:560px;max-height:82dvh;overflow:hidden;padding:0;display:flex;flex-direction:column"><div class="modal-handle"></div><div id="forecastDrillModalBody" style="padding:16px 18px;overflow-y:auto"></div></div>';
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
  const accs = Array.isArray(state.accounts) ? state.accounts : [];
  if (!accs.length) return;

  // ── Mostrar modal imediatamente com loading ───────────────────────────────
  let modal = document.getElementById('patrimonioModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'patrimonioModal';
    modal.className = 'modal-overlay';
    modal.onclick = e => { if (e.target === modal) closeModal('patrimonioModal'); };
    modal.innerHTML = `<div class="modal" style="max-width:500px;max-height:84dvh;overflow-y:auto;padding:0"><div class="modal-handle"></div><div id="patrimonioModalBody"></div></div>`;
    document.body.appendChild(modal);
  }
  document.getElementById('patrimonioModalBody').innerHTML =
    `<div style="padding:32px;text-align:center;color:var(--muted);font-size:.85rem">Carregando composição…</div>`;
  openModal('patrimonioModal');

  // ── Separar contas por tipo ───────────────────────────────────────────────
  const invAccs = accs.filter(a => a.type === 'investimento');
  const regAccs = accs.filter(a => a.type !== 'investimento');

  // Contas regulares
  const regularTotal = regAccs.reduce((s, a) =>
    s + toBRL(parseFloat(a.balance) || 0, a.currency || 'BRL'), 0);

  // Contas de investimento: usa _totalPortfolioBalance se disponível (valor de mercado)
  const investTotal = invAccs.reduce((s, a) => {
    const bal = (a._totalPortfolioBalance != null)
      ? a._totalPortfolioBalance
      : (parseFloat(a.balance) || 0);
    return s + toBRL(bal, a.currency || 'BRL');
  }, 0);

  const accountTotal = regularTotal + investTotal;

  // ── Dívidas ───────────────────────────────────────────────────────────────
  let debtTotal = 0, debts = [];
  try {
    const { data: debtsData } = await famQ(
      sb.from('debts')
        .select('id,name,current_balance,original_amount,currency,status,adjustment_type')
        .eq('status', 'active')
    );
    debts = debtsData || [];
    debtTotal = debts.reduce((s, d) =>
      s + toBRL(parseFloat(d.current_balance ?? d.original_amount) || 0, d.currency || 'BRL'), 0);
  } catch(_) {}

  // ── Patrimônio líquido — bate com statTotal ───────────────────────────────
  const totalBRL = accountTotal - debtTotal;

  // ── Helper: linha de conta ────────────────────────────────────────────────
  const _accRow = (a, isInv) => {
    const bal = isInv
      ? ((a._totalPortfolioBalance != null) ? a._totalPortfolioBalance : (parseFloat(a.balance) || 0))
      : (parseFloat(a.balance) || 0);
    const cur    = a.currency || 'BRL';
    const balBRL = toBRL(bal, cur);
    const pct    = Math.abs(totalBRL) > 0 ? Math.abs(balBRL / totalBRL * 100) : 0;
    const isNeg  = bal < 0;
    const onclick = isInv
      ? `navigate('investments');closeModal('patrimonioModal')`
      : `goToAccountTransactions('${a.id}');closeModal('patrimonioModal')`;
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:9px;
                  background:var(--surface2);cursor:pointer;transition:background .12s"
        onclick="${onclick}"
        onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background='var(--surface2)'">
        <div style="width:30px;height:30px;border-radius:8px;background:${a.color||'var(--accent)'}22;
                    display:flex;align-items:center;justify-content:center;flex-shrink:0">
          ${_dashRenderIcon(a.icon, a.color, 16)}
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:.82rem;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.name)}</div>
          <div style="font-size:.67rem;color:var(--muted)">${accountTypeLabel?.(a.type)||a.type||''}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:.88rem;font-weight:700;font-family:var(--font-serif);color:${isNeg?'var(--red)':'var(--text)'}">
            ${fmt(bal, cur)}${isInv && a._totalPortfolioBalance != null ? ' <span style="font-size:.6rem;color:#7c3aed;font-weight:600">MKT</span>' : ''}
          </div>
          ${cur !== 'BRL' ? `<div style="font-size:.67rem;color:var(--muted)">${dashFmt(balBRL,'BRL')}</div>` : ''}
          <div style="font-size:.63rem;color:var(--muted)">${pct.toFixed(1)}%</div>
        </div>
      </div>
      <div style="height:3px;border-radius:2px;background:var(--border);margin:0 10px 2px;overflow:hidden">
        <div style="height:100%;width:${Math.min(pct,100)}%;background:${isInv?'#7c3aed':(a.color||'var(--accent)')};border-radius:2px;transition:width .4s ease"></div>
      </div>`;
  };

  // ── Helper: cabeçalho de seção ────────────────────────────────────────────
  const _secHead = (label, total, color) => `
    <div style="font-size:.67rem;font-weight:700;text-transform:uppercase;letter-spacing:.09em;
                color:${color||'var(--muted)'};padding:4px 0 8px;border-bottom:1px solid var(--border);
                margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
      <span>${label}</span>
      <span style="font-family:var(--font-serif);font-size:.82rem;color:var(--text)">${dashFmt(total,'BRL')}</span>
    </div>`;

  // ── Construir HTML ────────────────────────────────────────────────────────
  let content = `<div style="padding:20px 22px 28px">`;

  // Header com total + breakdown rápido
  content += `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:18px">
      <div>
        <div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:4px">Patrimônio Líquido</div>
        <div style="font-size:1.9rem;font-weight:800;font-family:var(--font-serif);
                    color:${totalBRL>=0?'var(--accent)':'var(--red)'};line-height:1.05">${dashFmt(totalBRL,'BRL')}</div>
        <div style="font-size:.72rem;color:var(--muted);margin-top:7px;display:flex;gap:14px;flex-wrap:wrap">
          <span>Contas: <strong style="color:var(--text)">${dashFmt(regularTotal,'BRL')}</strong></span>
          ${investTotal ? `<span>Investimentos: <strong style="color:#7c3aed">${dashFmt(investTotal,'BRL')}</strong></span>` : ''}
          ${debtTotal   ? `<span style="color:var(--red)">Dívidas: <strong>−${dashFmt(debtTotal,'BRL')}</strong></span>` : ''}
        </div>
      </div>
      <button onclick="closeModal('patrimonioModal')"
        style="background:var(--surface2);border:1px solid var(--border);border-radius:50%;
               width:32px;height:32px;font-size:.9rem;cursor:pointer;color:var(--muted);
               display:flex;align-items:center;justify-content:center;flex-shrink:0">✕</button>
    </div>`;

  // Barra de composição visual
  const grand = accountTotal + debtTotal;
  if (grand > 0) {
    const pReg = grand > 0 ? (regularTotal / grand * 100) : 0;
    const pInv = grand > 0 ? (investTotal  / grand * 100) : 0;
    const pDbt = grand > 0 ? (debtTotal    / grand * 100) : 0;
    content += `
      <div style="margin-bottom:18px">
        <div style="display:flex;height:8px;border-radius:99px;overflow:hidden;gap:2px;margin-bottom:7px">
          ${regularTotal > 0 ? `<div style="flex:${pReg.toFixed(1)};background:var(--accent);min-width:4px;border-radius:99px"></div>` : ''}
          ${investTotal  > 0 ? `<div style="flex:${pInv.toFixed(1)};background:#7c3aed;min-width:4px;border-radius:99px"></div>` : ''}
          ${debtTotal    > 0 ? `<div style="flex:${pDbt.toFixed(1)};background:var(--red);min-width:4px;border-radius:99px"></div>` : ''}
        </div>
        <div style="display:flex;gap:16px;font-size:.68rem;color:var(--muted);flex-wrap:wrap">
          ${regularTotal > 0 ? `<span><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--accent);margin-right:3px;vertical-align:middle"></i>Contas ${pReg.toFixed(0)}%</span>` : ''}
          ${investTotal  > 0 ? `<span><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#7c3aed;margin-right:3px;vertical-align:middle"></i>Investimentos ${pInv.toFixed(0)}%</span>` : ''}
          ${debtTotal    > 0 ? `<span><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--red);margin-right:3px;vertical-align:middle"></i>Dívidas ${pDbt.toFixed(0)}%</span>` : ''}
        </div>
      </div>`;
  }

  // ── Contas regulares agrupadas por moeda ──────────────────────────────────
  if (regAccs.length) {
    const byCur = {};
    regAccs.forEach(a => {
      const c = a.currency || 'BRL';
      (byCur[c] = byCur[c] || []).push(a);
    });
    Object.entries(byCur).forEach(([cur, group]) => {
      const grpBRL = group.reduce((s,a) => s + toBRL(parseFloat(a.balance)||0, cur), 0);
      content += `<div style="margin-bottom:14px">`;
      content += _secHead(`Contas${Object.keys(byCur).length > 1 ? ' — '+cur : ''}`, grpBRL);
      content += `<div style="display:flex;flex-direction:column;gap:2px">`;
      group.sort((a,b) => Math.abs(parseFloat(b.balance)||0) - Math.abs(parseFloat(a.balance)||0))
           .forEach(a => { content += _accRow(a, false); });
      content += `</div></div>`;
    });
  }

  // ── Investimentos ─────────────────────────────────────────────────────────
  if (invAccs.length) {
    content += `<div style="margin-bottom:14px">`;
    content += _secHead('Carteira de Investimentos', investTotal, '#7c3aed');
    content += `<div style="display:flex;flex-direction:column;gap:2px">`;
    invAccs.sort((a,b) => {
      const ba = a._totalPortfolioBalance ?? parseFloat(a.balance) ?? 0;
      const bb = b._totalPortfolioBalance ?? parseFloat(b.balance) ?? 0;
      return Math.abs(bb) - Math.abs(ba);
    }).forEach(a => { content += _accRow(a, true); });
    content += `</div>`;
    if (invAccs.some(a => a._totalPortfolioBalance != null)) {
      content += `<div style="font-size:.66rem;color:var(--muted);padding:5px 10px 0;font-style:italic">MKT = valor de mercado calculado das posições em carteira</div>`;
    }
    content += `</div>`;
  }

  // ── Dívidas ───────────────────────────────────────────────────────────────
  if (debts.length) {
    content += `<div style="margin-bottom:14px">`;
    content += _secHead('Dívidas Ativas (deduzidas)', debtTotal, 'var(--red)');
    content += `<div style="display:flex;flex-direction:column;gap:4px">`;
    debts.forEach(d => {
      const bal    = parseFloat(d.current_balance ?? d.original_amount) || 0;
      const cur    = d.currency || 'BRL';
      const balBRL = toBRL(bal, cur);
      const pct    = Math.abs(totalBRL) > 0 ? Math.abs(balBRL / totalBRL * 100) : 0;
      content += `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:9px;
                    background:rgba(220,38,38,.04);border:1px solid rgba(220,38,38,.1)">
          <div style="width:30px;height:30px;border-radius:8px;background:rgba(220,38,38,.1);
                      display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:.9rem">💳</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:.82rem;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.name||'Dívida')}</div>
            <div style="font-size:.67rem;color:var(--muted)">${d.adjustment_type||'Dívida ativa'}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:.88rem;font-weight:700;font-family:var(--font-serif);color:var(--red)">−${fmt(bal, cur)}</div>
            ${cur !== 'BRL' ? `<div style="font-size:.67rem;color:var(--muted)">−${dashFmt(balBRL,'BRL')}</div>` : ''}
            <div style="font-size:.63rem;color:var(--muted)">${pct.toFixed(1)}%</div>
          </div>
        </div>`;
    });
    content += `</div>`;
    content += `<div style="display:flex;justify-content:flex-end;padding:5px 10px 0;font-size:.74rem">
      <span style="font-weight:700;color:var(--red)">Total: −${dashFmt(debtTotal,'BRL')}</span>
    </div>`;
    content += `</div>`;
  }

  // ── Linha de reconciliação (bate com o KPI) ───────────────────────────────
  content += `
    <div style="border-top:2px solid var(--border);margin-top:4px;padding-top:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
        <span style="font-size:.78rem;color:var(--muted)">Contas + Investimentos</span>
        <span style="font-size:.85rem;font-weight:700;font-family:var(--font-serif)">${dashFmt(accountTotal,'BRL')}</span>
      </div>
      ${debtTotal ? `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-size:.78rem;color:var(--muted)">− Dívidas ativas</span>
        <span style="font-size:.85rem;font-weight:700;font-family:var(--font-serif);color:var(--red)">−${dashFmt(debtTotal,'BRL')}</span>
      </div>` : ''}
      <div style="display:flex;justify-content:space-between;align-items:center;
                  background:${totalBRL>=0?'var(--accent-lt)':'var(--red-lt)'};
                  border-radius:10px;padding:10px 14px">
        <span style="font-size:.82rem;font-weight:700;color:var(--text)">= Patrimônio Líquido</span>
        <span style="font-size:1.05rem;font-weight:800;font-family:var(--font-serif);
                     color:${totalBRL>=0?'var(--accent)':'var(--red)'}">${dashFmt(totalBRL,'BRL')}</span>
      </div>
    </div>`;

  content += '</div>';
  document.getElementById('patrimonioModalBody').innerHTML = content;
}
window._openPatrimonioModal = _openPatrimonioModal;

