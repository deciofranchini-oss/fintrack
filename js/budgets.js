// ── Budgets v2 ─────────────────────────────────────────────────────────────
// Backward-compatible: funciona com ou sem a migration budget_type/auto_reset/year/notes

let _budgetView  = 'monthly';
let _budgetCache = [];
let _dbHasBudgetType = null; // null = ainda não testado

// ── DB capability detection ────────────────────────────────────────────────

async function _checkBudgetSchema() {
  if (_dbHasBudgetType !== null) return _dbHasBudgetType;
  // Testa se as colunas novas existem com uma query leve
  const { error } = await famQ(sb.from('budgets').select('budget_type,paused').limit(1));
  _dbHasBudgetType = !error || !error.message?.includes('budget_type');
  return _dbHasBudgetType;
}

// ── Utilities ─────────────────────────────────────────────────────────────

function _lastDayOf(y, m) {
  return new Date(+y, +m, 0).getDate();
}

function _categoryFamily(catId) {
  const ids = new Set([catId]);
  state.categories.forEach(c => { if (c.parent_id === catId) ids.add(c.id); });
  const lvl1 = new Set(ids);
  state.categories.forEach(c => { if (lvl1.has(c.parent_id) && c.id !== catId) ids.add(c.id); });
  return ids;
}

function _buildRawSpending(txs) {
  const map = {};
  (txs || []).forEach(t => {
    // Se tem category_splits com ≥2 itens, distribui pelos splits
    if (Array.isArray(t.category_splits) && t.category_splits.length >= 2) {
      t.category_splits.forEach(s => {
        if (s.category_id && s.amount > 0) {
          map[s.category_id] = (map[s.category_id] || 0) + Math.abs(s.amount);
        }
      });
    } else if (t.category_id) {
      map[t.category_id] = (map[t.category_id] || 0) + Math.abs(t.amount);
    }
  });
  return map;
}

// ── Year selectors ────────────────────────────────────────────────────────

function _populateYearSelectors() {
  const cur  = new Date().getFullYear();
  const html = Array.from({ length: 7 }, (_, i) => cur - 3 + i)
    .map(y => `<option value="${y}"${y === cur ? ' selected' : ''}>${y}</option>`)
    .join('');
  ['budgetYear', 'budgetModalYear'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  });
}

function _populateHistCat() {
  const sel = document.getElementById('budgetHistCat');
  if (!sel) return;
  const parents = state.categories.filter(c => c.type === 'despesa' && !c.parent_id)
    .sort((a, b) => a.name.localeCompare(b.name));
  let html = '<option value="">— Selecionar categoria —</option>';
  parents.forEach(p => {
    html += `<option value="${p.id}">${p.icon || '📦'} ${esc(p.name)}</option>`;
    state.categories.filter(c => c.type === 'despesa' && c.parent_id === p.id)
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(c => { html += `<option value="${c.id}">　${c.icon || '•'} ${esc(c.name)}</option>`; });
  });
  sel.innerHTML = html;
}

// ── Tab switching ─────────────────────────────────────────────────────────

function setBudgetView(view) {
  _budgetView = view;
  // Support both old .tab class and new .budget-period-btn class
  ['budgetTabMonthly', 'budgetTabAnnual'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.toggle('active', id === (view === 'monthly' ? 'budgetTabMonthly' : 'budgetTabAnnual'));
    }
  });
  const mp = document.getElementById('budgetMonthPicker');
  const yp = document.getElementById('budgetYearPicker');
  if (mp) mp.style.display = view === 'monthly' ? '' : 'none';
  if (yp) yp.style.display = view === 'annual'  ? '' : 'none';
  loadBudgets();
}

// ── Period helpers ────────────────────────────────────────────────────────

function _getSelectedPeriod() {
  if (_budgetView === 'annual') {
    const y = parseInt(document.getElementById('budgetYear')?.value) || new Date().getFullYear();
    return { year: y };
  }
  const mv = document.getElementById('budgetMonth')?.value || new Date().toISOString().slice(0, 7);
  const [y, m] = mv.split('-');
  return { year: parseInt(y), month: parseInt(m), monthStr: mv };
}

// ── Load & render ─────────────────────────────────────────────────────────

async function loadBudgets() {
  const period = _getSelectedPeriod();
  const grid   = document.getElementById('budgetGrid');
  if (!grid) return;

  grid.innerHTML = '<div class="budget-loading"><span>⏳</span> Carregando...</div>';

  const hasNewSchema = await _checkBudgetSchema();

  // 1. Buscar orçamentos do período
  let bq = famQ(sb.from('budgets').select('*, categories(id,name,icon,color,parent_id)'));
  // Mostrar ativos e pausados; pausados aparecem em seção separada

  if (hasNewSchema) {
    bq = bq.eq('budget_type', _budgetView);
    if (_budgetView === 'monthly') {
      const ms = `${period.year}-${String(period.month).padStart(2, '0')}-01`;
      // Include: specific-month budgets OR recurring templates (month IS NULL)
      bq = bq.or(`month.eq.${ms},and(auto_reset.eq.true,month.is.null)`);
    } else {
      // Include: specific-year budgets OR recurring annual templates (year IS NULL)
      bq = bq.or(`year.eq.${period.year},and(auto_reset.eq.true,year.is.null)`);
    }
  } else {
    // Banco antigo: só mensal por mês
    if (_budgetView === 'annual') {
      // Sem suporte anual no banco antigo — mostrar aviso e sair
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
        <div class="es-icon">⚠️</div>
        <p>Orçamentos anuais requerem a migration do banco.<br>
        <span style="font-size:.82rem;color:var(--muted)">Execute o arquivo <code>migration_budgets_v2.sql</code> no Supabase para habilitar.</span></p>
      </div>`;
      return;
    }
    const ms = `${period.year}-${String(period.month).padStart(2, '0')}-01`;
    bq = bq.eq('month', ms);
  }

  const { data: budgets, error: be } = await bq;
  if (be) {
    toast('Erro ao carregar orçamentos: ' + be.message, 'error');
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="es-icon">❌</div>
      <p>Erro ao carregar orçamentos</p>
      <small style="color:var(--muted)">${esc(be.message)}</small>
    </div>`;
    return;
  }
  _budgetCache = budgets || [];

  // 2. Buscar gastos do período
  let txQ = famQ(sb.from('transactions').select('category_id,amount,category_splits')).lt('amount', 0);
  if (_budgetView === 'monthly') {
    const y = String(period.year), m = String(period.month).padStart(2, '0');
    const last = String(_lastDayOf(y, m)).padStart(2, '0');
    txQ = txQ.gte('date', `${y}-${m}-01`).lte('date', `${y}-${m}-${last}`);
  } else {
    txQ = txQ.gte('date', `${period.year}-01-01`).lte('date', `${period.year}-12-31`);
  }
  const { data: txs } = await txQ;
  const raw = _buildRawSpending(txs);

  // 2b. Auto-project recurring budgets from previous month if current period is empty
  if (hasNewSchema && _budgetView === 'monthly' && _budgetCache.length === 0) {
    await _autoProjectRecurringBudgets(period);
    // Re-fetch after projection
    let bq2 = famQ(sb.from('budgets').select('*, categories(id,name,icon,color,parent_id)'))
      .eq('budget_type', 'monthly')
      .eq('month', `${period.year}-${String(period.month).padStart(2,'0')}-01`);
    const { data: projectedBudgets } = await bq2;
    _budgetCache = projectedBudgets || [];
  }

  // 3. Gasto por orçamento (soma hierarquia)
  const resolved = {};
  _budgetCache.forEach(b => {
    const fam = _categoryFamily(b.category_id);
    resolved[b.id] = 0;
    fam.forEach(cid => { resolved[b.id] += (raw[cid] || 0); });
  });

  // 4. Estado vazio
  if (!_budgetCache.length) {
    const lbl = _budgetView === 'monthly'
      ? new Date(period.year, period.month - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
      : String(period.year);
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="es-icon">🎯</div>
      <p>Nenhum orçamento para <strong>${lbl}</strong></p>
      <button class="btn btn-primary" style="margin-top:14px" onclick="openBudgetModal()">+ Criar orçamento</button>
    </div>`;
    return;
  }

  // 5. Separar pausados dos ativos; ordenar: estourado primeiro, depois % desc
  const activeBudgets = _budgetCache.filter(b => !b.paused);
  const pausedBudgets = _budgetCache.filter(b =>  b.paused);
  const _sortFn = (a, b) =>
    (resolved[b.id] / (b.amount || 1)) - (resolved[a.id] / (a.amount || 1));
  const sortedActive = [...activeBudgets].sort(_sortFn);
  const sortedPaused = [...pausedBudgets].sort(_sortFn);

  let gridHtml = sortedActive.map(b => _budgetCardHTML(b, resolved[b.id], raw)).join('');
  if (sortedPaused.length) {
    gridHtml += `<div style="grid-column:1/-1;margin-top:16px;margin-bottom:4px;font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);display:flex;align-items:center;gap:8px">
      <span>⏸ Orçamentos pausados (${sortedPaused.length})</span>
      <div style="flex:1;height:1px;background:var(--border)"></div>
    </div>`;
    gridHtml += sortedPaused.map(b => _budgetCardHTML(b, resolved[b.id], raw)).join('');
  }
  grid.innerHTML = gridHtml;
}

// ── Budget Drill-Through ────────────────────────────────────────────────
async function openBudgetDrilldown(budgetId, catName) {
  const modal = document.getElementById('budgetDrilldownModal');
  if (!modal) return;
  const b = _budgetCache.find(x => x.id === budgetId);
  if (!b) return;

  const period = _getSelectedPeriod();
  let dateFrom, dateTo;
  if (_budgetView === 'monthly') {
    const y = String(period.year), m = String(period.month).padStart(2,'0');
    dateFrom = `${y}-${m}-01`;
    dateTo   = `${y}-${m}-${String(_lastDayOf(y,m)).padStart(2,'0')}`;
  } else {
    dateFrom = `${period.year}-01-01`;
    dateTo   = `${period.year}-12-31`;
  }

  document.getElementById('budgetDrillTitle').textContent = catName + ' — transações do período';
  document.getElementById('budgetDrillBody').innerHTML =
    '<tr><td colspan="3" style="text-align:center;padding:24px;color:var(--muted)">Carregando…</td></tr>';
  openModal('budgetDrilldownModal');

  const allCatIds = [..._categoryFamily(b.category_id)];
  let q = famQ(
    sb.from('transactions')
      .select('id,date,description,amount,currency,brl_amount,status,accounts!transactions_account_id_fkey(name),categories(name,color)')
  ).lt('amount',0).gte('date',dateFrom).lte('date',dateTo).order('date',{ascending:false}).limit(500);
  q = allCatIds.length===1 ? q.eq('category_id',allCatIds[0]) : q.in('category_id',allCatIds);

  const { data, error } = await q;
  const totalEl = document.getElementById('budgetDrillTotal');
  if (error) {
    document.getElementById('budgetDrillBody').innerHTML =
      `<tr><td colspan="3" style="text-align:center;color:var(--red)">Erro: ${esc(error.message)}</td></tr>`;
    return;
  }
  if (!data || !data.length) {
    if (totalEl) totalEl.textContent = 'Nenhuma transação no período';
    document.getElementById('budgetDrillBody').innerHTML =
      '<tr><td colspan="3" style="text-align:center;padding:24px;color:var(--muted)">Nenhuma transação no período</td></tr>';
    return;
  }
  const totalSpent = data.reduce((s,t)=>s+Math.abs(parseFloat(t.amount)||0),0);
  if (totalEl) totalEl.textContent = `${data.length} transações · Gasto: ${fmt(totalSpent)}`;
  document.getElementById('budgetDrillBody').innerHTML = data.map(t => {
    const cur = t.currency||'BRL';
    const catColor = t.categories?.color||'var(--muted)';
    const catBadge = t.categories
      ? `<span class="badge" style="background:${catColor}18;color:${catColor};border:1px solid ${catColor}28;font-size:.65rem">${esc(t.categories.name)}</span>` : '';
    const pendDot = t.status==='pending'?'<span style="color:var(--amber);font-size:.75rem"> ⏳</span>':'';
    return `<tr style="cursor:pointer" onclick="closeModal('budgetDrilldownModal');editTransaction('${t.id}')">
      <td style="white-space:nowrap;font-size:.8rem;color:var(--muted)">${fmtDate(t.date)}</td>
      <td><div style="font-size:.85rem;font-weight:500">${esc(t.description||'')}${pendDot}</div>
          <div style="margin-top:2px">${catBadge}</div>
          <div style="font-size:.7rem;color:var(--muted)">${esc(t.accounts?.name||'')}</div></td>
      <td class="amount-neg" style="white-space:nowrap;font-weight:600;text-align:right">
        -${fmt(Math.abs(t.amount),cur)}
        ${cur!=='BRL'&&t.brl_amount?`<div style="font-size:.68rem;color:var(--muted)">${fmt(t.brl_amount,'BRL')}</div>`:''}</td>
    </tr>`;
  }).join('');
}

// ── Card HTML ─────────────────────────────────────────────────────────────

function _budgetCardHTML(b, spent, raw) {
  const pct   = b.amount > 0 ? Math.min(100, (spent / b.amount) * 100) : 0;
  const over  = spent > b.amount && b.amount > 0;
  const near  = !over && pct >= 80;
  const cat   = b.categories || {};
  const color = over ? 'var(--red)' : near ? 'var(--amber)' : (cat.color || 'var(--accent)');
  const rem   = b.amount - spent;
  // Member association: look up name and age from loaded composition cache
  const fmcMember  = b.family_member_id && typeof getFamilyMemberById === 'function'
    ? getFamilyMemberById(b.family_member_id) : null;
  const memberAge   = fmcMember && typeof _fmcCalcAge === 'function'
    ? _fmcCalcAge(fmcMember.birth_date) : null;
  const memberLabel = fmcMember
    ? `${fmcMember.avatar_emoji || '👤'} ${esc(fmcMember.name)}${memberAge !== null ? ` (${memberAge})` : ''}`
    : null;

  const parentCat = cat.parent_id
    ? state.categories.find(c => c.id === cat.parent_id) : null;
  const children = state.categories.filter(c => c.parent_id === b.category_id && c.type === 'despesa');

  // Tags de subcategorias com gasto > 0
  const childTagsHtml = children.length
    ? `<div class="budget-child-tags">
        <span style="font-size:.68rem;color:var(--muted);margin-right:2px">Inclui:</span>
        ${children.map(c => {
          const cs = (raw || {})[c.id] || 0;
          const _hasSpent = cs > 0;
          return `<span class="budget-child-tag" style="background:${c.color||'var(--accent)'}22;color:${c.color||'var(--accent)'};cursor:${_hasSpent?'pointer':'default'}" ${_hasSpent?`onclick="event.stopPropagation();openCategoryHistory('${c.id}','${esc(c.name)}')"`:''}>
            ${c.icon || ''} ${esc(c.name)}${cs > 0 ? ' · ' + fmt(cs) : ''}
          </span>`;
        }).join('')}
      </div>` : '';

  const isPaused   = !!b.paused;
  const isRecurring = (b.auto_reset ?? true) && _budgetView === 'monthly';
  const badgesHtml = [
    isPaused
      ? `<span class="budget-badge" style="background:#fef3c7;color:#b45309;font-weight:700;font-size:.65rem">⏸ Pausado</span>` : '',
  ].filter(Boolean).join('');

  return `<div class="budget-card${over ? ' budget-card--over' : near ? ' budget-card--near' : ''}${isPaused ? ' budget-card--paused' : ''}" style="cursor:pointer;${isPaused ? 'opacity:.72' : ''}" onclick="openBudgetDrilldown('${b.id}','${(cat.name||'').replace(/'/g,'\\u0027')}')">
    <div class="budget-card-stripe" style="background:${color}"></div>

    <div class="budget-card-header">
      <div class="budget-cat-info">
        <span class="budget-cat-icon">${cat.icon || '📦'}</span>
        <div style="min-width:0">
          ${parentCat ? `<div style="font-size:.67rem;color:var(--muted);line-height:1.1">${parentCat.icon || ''} ${esc(parentCat.name)} ›</div>` : ''}
          <div style="font-weight:700;font-size:.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(cat.name || '—')}</div>
          ${memberLabel ? `<div style="font-size:.68rem;color:var(--muted);margin-top:1px">${memberLabel}</div>` : ''}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
        ${isPaused ? `<span class="budget-badge" style="background:#fef3c7;color:#b45309;font-weight:700;font-size:.65rem">⏸ Pausado</span>` : ''}
        <button class="btn-icon" onclick="event.stopPropagation();toggleBudgetPaused('${b.id}',${isPaused})"
          title="${isPaused ? 'Retomar orçamento' : 'Pausar orçamento'}"
          style="color:${isPaused ? 'var(--accent)' : 'var(--muted)'}"
          >${isPaused ? '▶️' : '⏸'}</button>
        <button class="btn-icon" onclick="event.stopPropagation();openBudgetModal('${b.id}')" title="Editar">✏️</button>
        <button class="btn-icon" onclick="event.stopPropagation();deleteBudget('${b.id}')" title="Excluir" style="color:var(--red)">🗑️</button>
      </div>
    </div>

    ${(isRecurring && !isPaused) || _budgetView==='annual' || b.notes ? `<div style="padding:2px 10px 7px;display:flex;gap:5px;flex-wrap:wrap">
      ${isRecurring && !isPaused ? `<span class="budget-badge" style="background:#e0f2fe;color:#0369a1;font-size:.7rem" title="Recorrente — reseta todo mês automaticamente">🔄 Recorrente</span>` : ''}
      ${_budgetView==='annual' ? `<span class="budget-badge" style="background:#f0fdf4;color:#15803d;font-size:.7rem">📆 Anual</span>` : ''}
      ${b.notes ? `<span class="budget-badge" style="background:var(--bg2);color:var(--muted);font-size:.7rem" title="${esc(b.notes)}">📝 Nota</span>` : ''}
    </div>` : ''}

    <div class="budget-amounts">
      <div>
        <div class="budget-amt-lbl">Gasto</div>
        <div class="budget-amt-val${over ? ' amount-neg' : ''}">${fmt(spent)}</div>
      </div>
      <div style="text-align:center">
        <div class="budget-amt-lbl">${over ? 'Excesso' : 'Restante'}</div>
        <div class="budget-amt-val" style="color:${over ? 'var(--red)' : 'var(--green)'}">
          ${over ? '-' : ''}${fmt(Math.abs(rem))}
        </div>
      </div>
      <div style="text-align:right">
        <div class="budget-amt-lbl">Meta</div>
        <div class="budget-amt-val">${fmt(b.amount)}</div>
      </div>
    </div>

    <div style="margin-top:10px">
      <div class="progress" style="height:8px;border-radius:6px">
        <div class="progress-bar" style="width:${pct}%;background:${color};border-radius:6px"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:.7rem;color:var(--muted)">
        <span>${pct.toFixed(0)}% utilizado</span>
        ${over ? `<span style="color:var(--red);font-weight:600">⚠ Excedido</span>`
               : near ? `<span style="color:var(--amber);font-weight:600">⚡ Atenção</span>` : ''}
      </div>
    </div>

    ${b.notes ? `<div style="margin-top:8px;padding:6px 8px;background:var(--bg2);border-radius:6px;font-size:.72rem;color:var(--muted)">💬 ${esc(b.notes)}</div>` : ''}
    ${childTagsHtml}
  </div>`;
}

// ── Histórico ─────────────────────────────────────────────────────────────

async function loadBudgetHistory() {
  const catId     = document.getElementById('budgetHistCat')?.value;
  const container = document.getElementById('budgetHistContainer');
  if (!container) return;

  if (!catId) {
    container.innerHTML = '<div style="color:var(--muted);font-size:.83rem;padding:16px 12px">Selecione uma categoria para ver o histórico dos últimos 12 meses.</div>';
    return;
  }

  container.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted)">⏳ Carregando...</div>';

  const now    = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`);
  }

  const firstMonth = months[0];
  const lastDay    = _lastDayOf(now.getFullYear(), now.getMonth() + 1);
  const lastDate   = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;

  const { data: histBudgets } = await famQ(sb.from('budgets').select('month,amount'))
    .eq('category_id', catId)
    .in('month', months);

  const family = _categoryFamily(catId);
  const { data: txAll } = await famQ(sb.from('transactions').select('category_id,amount,date,category_splits'))
    .lt('amount', 0)
    .gte('date', firstMonth)
    .lte('date', lastDate)
    .in('category_id', [...family]);

  const budgetMap = {};
  (histBudgets || []).forEach(b => { budgetMap[b.month] = b.amount; });

  let totalSpent = 0, totalBudget = 0, overCount = 0;

  const rows = months.map(ms => {
    const [y, m] = ms.slice(0,7).split('-');
    const last   = _lastDayOf(parseInt(y), parseInt(m));
    const me     = `${y}-${m}-${String(last).padStart(2,'0')}`;
    const spent  = (txAll || [])
      .filter(t => t.date >= ms && t.date <= me)
      .reduce((s, t) => s + Math.abs(t.amount), 0);

    const budget = budgetMap[ms] || 0;
    const pct    = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
    const over   = budget > 0 && spent > budget;
    const label  = new Date(ms + 'T12:00').toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
    const isCur  = ms === `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;

    if (budget > 0) { totalBudget += budget; totalSpent += spent; }
    if (over) overCount++;

    return `<tr${isCur ? ' style="background:var(--accent-lt)"' : ''}>
      <td style="font-size:.82rem;white-space:nowrap;font-weight:${isCur?'700':'400'}">${label}${isCur?' ←':''}</td>
      <td style="font-size:.82rem">${budget > 0 ? fmt(budget) : '<span style="color:var(--muted)">—</span>'}</td>
      <td class="${over ? 'amount-neg' : ''}" style="font-size:.82rem;font-weight:600">${spent > 0 ? fmt(spent) : '<span style="color:var(--muted)">—</span>'}</td>
      <td style="min-width:90px">
        ${budget > 0 ? `<div class="progress" style="height:5px;margin-top:0"><div class="progress-bar" style="width:${pct}%;background:${over?'var(--red)':'var(--accent)'}"></div></div><div style="font-size:.65rem;color:var(--muted);margin-top:2px">${pct.toFixed(0)}%</div>` : ''}
      </td>
      <td class="${budget > 0 ? (over ? 'amount-neg' : 'amount-pos') : ''}" style="font-size:.78rem">
        ${budget > 0 ? (over ? '-' : '') + fmt(Math.abs(budget - spent)) : ''}
      </td>
    </tr>`;
  }).join('');

  const withBudget = months.filter(ms => budgetMap[ms]).length;
  const avgPct     = totalBudget > 0 ? ((totalSpent / totalBudget) * 100).toFixed(0) : null;

  const summaryHtml = withBudget ? `
    <div style="padding:10px 14px;background:var(--bg2);border-bottom:1px solid var(--border);font-size:.78rem;color:var(--muted);display:flex;gap:20px;flex-wrap:wrap">
      <span>📅 <strong>${withBudget}</strong> meses com orçamento</span>
      ${avgPct !== null ? `<span>📊 Média: <strong>${avgPct}%</strong> utilizado</span>` : ''}
      ${overCount > 0 ? `<span class="text-red">⚠️ <strong>${overCount}</strong> meses estourados</span>` : '<span class="text-green">✅ Nunca estourou</span>'}
    </div>` : '';

  container.innerHTML = `${summaryHtml}<div class="table-wrap"><table>
    <thead><tr><th>Mês</th><th>Orçamento</th><th>Gasto</th><th>Progresso</th><th>Saldo</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

// ── Modal ─────────────────────────────────────────────────────────────────

function openBudgetModal(id = '') {
  const existing = id ? _budgetCache.find(x => x.id === id) : null;

  document.getElementById('budgetId').value = id;
  document.getElementById('budgetModalTitle').textContent = id ? 'Editar Orçamento' : 'Novo Orçamento';

  const btype = existing?.budget_type || _budgetView;
  _setBudgetModalType(btype);

  const period = _getSelectedPeriod();
  const now    = new Date();

  // Mês
  const monthEl = document.getElementById('budgetModalMonth');
  if (monthEl) {
    monthEl.value = existing?.month
      ? existing.month.slice(0, 7)
      : (period.monthStr || now.toISOString().slice(0, 7));
  }

  // Ano — o select já foi populado em initBudgetsPage
  const yearEl = document.getElementById('budgetModalYear');
  if (yearEl) yearEl.value = existing?.year || period.year || now.getFullYear();

  // Categorias: usa picker modal
  const budCatHidden = document.getElementById('budgetCategory');
  const budCatLabel  = document.getElementById('budgetCatPickLabel');
  const budCatBtn    = document.getElementById('budgetCatPickBtn');
  if (budCatHidden) budCatHidden.value = '';
  if (budCatLabel)  { budCatLabel.textContent = '— Selecionar categoria —'; budCatLabel.style.color = 'var(--muted)'; }
  if (budCatBtn)    { budCatBtn.style.borderColor = ''; }
  if (existing?.category_id) {
    const cat = state.categories.find(c => c.id === existing.category_id);
    if (cat) {
      if (budCatHidden) budCatHidden.value = cat.id;
      if (budCatLabel)  { budCatLabel.textContent = `${cat.icon || '📦'} ${cat.name}`; budCatLabel.style.color = 'var(--text)'; }
      if (budCatBtn)    { budCatBtn.style.borderColor = 'var(--accent)'; }
    }
  }
  _updateBudgetCatHint();

  // Valor
  setAmtField('budgetAmount', existing?.amount || 0);

  // Auto-reset (padrão: true)
  const arEl = document.getElementById('budgetAutoReset');
  if (arEl) arEl.checked = existing ? !!(existing.auto_reset ?? true) : true;

  // Pausado
  const pausedEl = document.getElementById('budgetPaused');
  if (pausedEl) pausedEl.checked = !!(existing?.paused);

  // Notas
  const notesEl = document.getElementById('budgetNotes');
  if (notesEl) notesEl.value = existing?.notes || '';

  // Populate family member select
  if (typeof populateFamilyMemberSelect === 'function') {
    populateFamilyMemberSelect('budgetFamilyMember');
    const fmSel = document.getElementById('budgetFamilyMember');
    if (fmSel) fmSel.value = existing?.family_member_id || '';
  }

  // Campo "pausar" só aparece em edição (orçamentos novos sempre começam ativos)
  const pausedGroup = document.getElementById('budgetPausedGroup');
  if (pausedGroup) pausedGroup.style.display = id ? '' : 'none';

  // Update picker visibility based on recurring state
  _onBudgetRecurringChange();

  openModal('budgetModal');
}

function _budgetCatPickerOpen() {
  if (typeof openCatChooser !== 'function') return;
  openCatChooser('tx', function(catId, catName) {
    const hidden = document.getElementById('budgetCategory');
    const label  = document.getElementById('budgetCatPickLabel');
    const btn    = document.getElementById('budgetCatPickBtn');
    if (hidden) hidden.value = catId || '';
    if (label)  { label.textContent = catName || '— Selecionar categoria —'; label.style.color = catId ? 'var(--text)' : 'var(--muted)'; }
    if (btn)    { btn.style.borderColor = catId ? 'var(--accent)' : ''; }
    _updateBudgetCatHint?.();
  });
}
window._budgetCatPickerOpen = _budgetCatPickerOpen;

function _updateBudgetCatHint() {
  const catId = document.getElementById('budgetCategory')?.value;
  const hint  = document.getElementById('budgetCatHint');
  if (!hint) return;
  const hasKids = catId && state.categories.some(c => c.parent_id === catId && c.type === 'despesa');
  hint.style.display = hasKids ? '' : 'none';
}

function setBudgetModalType(type) { _setBudgetModalType(type); }

function _setBudgetModalType(type) {
  document.getElementById('budgetModalTypeMonthly')?.classList.toggle('active', type === 'monthly');
  document.getElementById('budgetModalTypeAnnual')?.classList.toggle('active',  type === 'annual');
  const tt = document.getElementById('budgetModalTypeCurrent');
  if (tt) tt.setAttribute('data-type', type);
  // Update period label in recurring notice
  const periodLabel = document.getElementById('budgetRecurringPeriodLabel');
  if (periodLabel) periodLabel.textContent = type === 'annual' ? 'todos os anos' : 'todos os meses';
  // Update visibility of month/year pickers based on recurring state
  _onBudgetRecurringChange();
  // Auto-reset only makes sense for monthly
  const rg = document.getElementById('budgetAutoResetGroup');
  if (rg) rg.style.display = type === 'monthly' ? '' : 'none';
}

/** Show/hide month or year picker based on whether budget is recurring */
function _onBudgetRecurringChange() {
  const isRecurring = document.getElementById('budgetAutoReset')?.checked ?? false;
  const type        = document.getElementById('budgetModalTypeCurrent')?.getAttribute('data-type') || 'monthly';
  const mg = document.getElementById('budgetModalMonthGroup');
  const yg = document.getElementById('budgetModalYearGroup');
  const rn = document.getElementById('budgetRecurringNotice');

  if (isRecurring) {
    // Recurring: hide period picker, show notice
    if (mg) mg.style.display = 'none';
    if (yg) yg.style.display = 'none';
    if (rn) rn.style.display = '';
  } else {
    // Non-recurring: show appropriate picker
    if (mg) mg.style.display = type === 'monthly' ? '' : 'none';
    if (yg) yg.style.display = type === 'annual'  ? '' : 'none';
    if (rn) rn.style.display = 'none';
  }
}
window._onBudgetRecurringChange = _onBudgetRecurringChange;

// ── Save / Delete ─────────────────────────────────────────────────────────

async function saveBudget() {
  const id        = document.getElementById('budgetId').value;
  const btype     = document.getElementById('budgetModalTypeCurrent')?.getAttribute('data-type') || _budgetView;
  const catId     = document.getElementById('budgetCategory').value;
  const amount    = Math.abs(getAmtField('budgetAmount'));
  // autoReset is read above as autoReset2
  const notes     = document.getElementById('budgetNotes')?.value.trim() || null;

  if (!catId)  { toast('Selecione uma categoria', 'error'); return; }
  if (!amount) { toast('Informe o valor limite', 'error');  return; }

  const autoReset2 = document.getElementById('budgetAutoReset')?.checked ?? true;
  // month column is NOT NULL in DB — use first-of-current-month as placeholder for recurring budgets
  const _nowMonth = new Date();
  const _recurMonth = `${_nowMonth.getFullYear()}-${String(_nowMonth.getMonth()+1).padStart(2,'0')}-01`;

  let month = _recurMonth, year = null;
  if (btype === 'monthly') {
    if (autoReset2) {
      // Recurring monthly: use current month as placeholder (auto_reset=true identifies it as recurring)
      month = _recurMonth;
      year  = null;
    } else {
      const mv = document.getElementById('budgetModalMonth')?.value;
      if (!mv) { toast('Selecione o mês', 'error'); return; }
      const [y, m] = mv.split('-');
      month = `${y}-${m}-01`;
      year  = parseInt(y);
    }
  } else {
    if (autoReset2) {
      // Recurring annual: no specific year needed
      year  = null;
      month = null;
    } else {
      year = parseInt(document.getElementById('budgetModalYear')?.value);
      if (!year) { toast('Selecione o ano', 'error'); return; }
    }
  }

  const hasNewSchema = await _checkBudgetSchema();

  // Dados base (compatível com schema antigo)
  const data = {
    category_id: catId,
    amount:      amount,
    month:       month,
    family_id:   famId(),
  };

  // Campos extras (só quando banco tem o schema novo)
  if (hasNewSchema) {
    data.budget_type = btype;
    data.auto_reset  = autoReset2;
    data.year        = year;
    data.notes       = notes;
    // paused — só salvar em edições (novo orçamento começa ativo)
    if (id) {
      const pausedEl = document.getElementById('budgetPaused');
      data.paused = pausedEl ? !!pausedEl.checked : false;
    } else {
      data.paused = false;
    }
  }
  // family_member_id — works if column exists (silently ignored if not)
  const fmMemberId = document.getElementById('budgetFamilyMember')?.value || null;
  if (fmMemberId) data.family_member_id = fmMemberId;

  let err;
  if (id) {
    // Edição: update direto
    ({ error: err } = await sb.from('budgets').update(data).eq('id', id));
  } else if (hasNewSchema) {
    // Insert com upsert usando nova constraint
    // Recurring budgets (auto_reset=true, month=null) use different conflict key
    let conflict;
    if (autoReset2) {
      conflict = 'family_id,category_id,budget_type,auto_reset';
    } else if (btype === 'monthly') {
      conflict = 'family_id,category_id,month,budget_type';
    } else {
      conflict = 'family_id,category_id,year,budget_type';
    }
    // Try upsert first; if the unique constraint doesn't exist, fall back to plain insert
    try {
      ({ error: err } = await sb.from('budgets').upsert(data, { onConflict: conflict }));
      // If upsert succeeded but constraint doesn't exist, Supabase may return 42P10 error
      if (err && (err.code === '42P10' || err.message?.includes('no unique or exclusion constraint'))) {
        ({ error: err } = await sb.from('budgets').insert(data));
      }
    } catch(_uErr) {
      // Network or unexpected error — fall back to plain insert
      try { ({ error: err } = await sb.from('budgets').insert(data)); } catch(e2) { err = e2; }
    }
  } else {
    // Schema antigo: upsert com constraint original
    ({ error: err } = await sb.from('budgets').upsert(data, { onConflict: 'category_id,month' }));
  }

  if (err) { toast(err.message, 'error'); return; }
  const _isNew=!id;
  toast(id?'Orçamento atualizado!':'Orçamento salvo!','success');
  closeModal('budgetModal');
  await loadBudgets();
  if(_isNew) _scrollTopAndHighlight('.budget-card,.budget-item');
}

async function deleteBudget(id) {
  if (!confirm('Excluir este orçamento?')) return;
  const { error } = await sb.from('budgets').delete().eq('id', id);
  if (error) { toast(error.message, 'error'); return; }
  toast('Orçamento excluído', 'success');
  loadBudgets();
}

// ── Toggle pausa de orçamento recorrente ──────────────────────────────────
async function toggleBudgetPaused(id, currentlyPaused) {
  const newPaused = !currentlyPaused;
  const { error } = await famQ(
    sb.from('budgets').update({ paused: newPaused }).eq('id', id)
  );
  if (error) { toast('Erro ao ' + (newPaused ? 'pausar' : 'retomar') + ': ' + error.message, 'error'); return; }
  toast(newPaused ? '⏸ Orçamento pausado' : '▶️ Orçamento retomado', 'success');
  await loadBudgets();
}
window.toggleBudgetPaused = toggleBudgetPaused;


// ── Init ──────────────────────────────────────────────────────────────────

// ── Estado das abas principais de Orçamentos ─────────────────────────────────
let _budgetMainTab = 'budgets'; // 'budgets' | 'objectives'

function switchBudgetMainTab(tab) {
  _budgetMainTab = tab;

  // Atualizar botões
  document.getElementById('budgetMainTabBudgets')?.classList.toggle('active', tab === 'budgets');
  document.getElementById('budgetMainTabObjectives')?.classList.toggle('active', tab === 'objectives');

  // Mostrar/ocultar painéis
  const panelBudgets    = document.getElementById('budgetPanelBudgets');
  const panelObjectives = document.getElementById('budgetPanelObjectives');
  if (panelBudgets)    panelBudgets.style.display    = tab === 'budgets'    ? '' : 'none';
  if (panelObjectives) panelObjectives.style.display  = tab === 'objectives' ? '' : 'none';

  if (tab === 'objectives') {
    // Reset container display antes de render (evita estado flex travado)
    const grid = document.getElementById('objectivesGrid');
    if (grid) {
      grid.style.display = '';
      grid.style.alignItems = '';
      grid.style.justifyContent = '';
      grid.style.minHeight = '';
    }
    // Carregar objetivos quando a aba é aberta
    if (typeof renderObjectivesPage === 'function') {
      try {
        renderObjectivesPage();
      } catch(e) {
        console.warn('[objectives] renderObjectivesPage:', e.message);
        if (grid) grid.innerHTML = `<div style="color:var(--red);padding:16px">Erro ao carregar: ${e.message}</div>`;
      }
    } else {
      console.warn('[objectives] renderObjectivesPage not yet defined — objectives.js may not be loaded');
    }
  }
}

function initBudgetsPage() {
  const now     = new Date();
  const monthEl = document.getElementById('budgetMonth');
  if (monthEl && !monthEl.value) monthEl.value = now.toISOString().slice(0, 7);

  _populateYearSelectors();
  _populateHistCat();

  // Resetar cache de schema para re-testar a cada visita (banco pode ter sido migrado)
  _dbHasBudgetType = null;

  // Garantir painel correto visível
  if (_budgetMainTab === 'budgets') {
    setBudgetView(_budgetView);
  } else {
    switchBudgetMainTab(_budgetMainTab);
  }
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

// ── Auto-project recurring budgets ──────────────────────────────────────────
// If no budgets exist for current month but recurring ones exist from last month,
// automatically create copies for the current month.
async function _autoProjectRecurringBudgets(period) {
  try {
    // Look for recurring budgets in previous month
    const prevDate = new Date(period.year, period.month - 1, 1);
    prevDate.setMonth(prevDate.getMonth() - 1);
    const prevY = prevDate.getFullYear();
    const prevM = prevDate.getMonth() + 1;
    const prevMonthStr = `${prevY}-${String(prevM).padStart(2,'0')}-01`;
    const curMonthStr  = `${period.year}-${String(period.month).padStart(2,'0')}-01`;

    // Fetch recurring templates: either from previous month OR with month=null (new format)
    const { data: prevBudgetsByMonth } = await famQ(
      sb.from('budgets').select('category_id,amount,budget_type,family_member_id,notes')
    ).eq('budget_type','monthly').eq('month', prevMonthStr).eq('auto_reset', true);

    const { data: recurringTemplates } = await famQ(
      sb.from('budgets').select('category_id,amount,budget_type,family_member_id,notes')
    ).eq('budget_type','monthly').eq('auto_reset', true).is('month', null);

    // Merge: prefer templates (new format), fall back to previous month copies
    const templateCats = new Set((recurringTemplates || []).map(b => b.category_id));
    const prevBudgets = [
      ...(recurringTemplates || []),
      ...((prevBudgetsByMonth || []).filter(b => !templateCats.has(b.category_id))),
    ];

    if (!prevBudgets || !prevBudgets.length) return;

    // Insert for current month (ignore conflicts)
    const toInsert = prevBudgets.map(b => ({
      family_id:        famId(),
      category_id:      b.category_id,
      amount:           b.amount,
      month:            curMonthStr,
      budget_type:      'monthly',
      auto_reset:       true,
      paused:           false,
      notes:            b.notes || null,
      family_member_id: b.family_member_id || null,
    }));

    await sb.from('budgets')
      .upsert(toInsert, { onConflict: 'family_id,category_id,month,budget_type', ignoreDuplicates: true });
  } catch(e) {
    console.debug('[budget auto-project]', e.message);
  }
}

// ── Expor funções públicas no window ──────────────────────────────────────────
window.initBudgetsPage                     = initBudgetsPage;
window.loadBudgets                         = loadBudgets;
window.openBudgetModal                     = openBudgetModal;
window.saveBudget                          = saveBudget;
window.setBudgetModalType                  = setBudgetModalType;
window.setBudgetView                       = setBudgetView;
window.switchBudgetMainTab                 = switchBudgetMainTab;
window._autoProjectRecurringBudgets        = _autoProjectRecurringBudgets;
