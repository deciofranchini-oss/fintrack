// ── Budgets v3 ──────────────────────────────────────────────────────────────
// Refactor completo: auto_reset propagation, pause/resume, UX imersiva,
// deep-dive por categoria, dashboard snapshot card.



// ── Estado do módulo ────────────────────────────────────────────────────────
let _budgetView   = 'monthly';
let _budgetCache  = [];
let _budgetSpent  = {};
let _dbHasBudgetType   = null;
let _dbHasBudgetPaused = null;

// ── Detecção de schema ──────────────────────────────────────────────────────

async function _checkBudgetSchema() {
  if (_dbHasBudgetType !== null) return _dbHasBudgetType;
  const { error } = await famQ(sb.from('budgets').select('budget_type').limit(1));
  _dbHasBudgetType = !error || !error.message?.includes('budget_type');
  return _dbHasBudgetType;
}

async function _checkBudgetPausedColumn() {
  if (_dbHasBudgetPaused !== null) return _dbHasBudgetPaused;
  const { error } = await famQ(sb.from('budgets').select('paused').limit(1));
  _dbHasBudgetPaused = !error || !error.message?.includes('paused');
  return _dbHasBudgetPaused;
}

// ── Utilidades ──────────────────────────────────────────────────────────────

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
    if (t.category_id && !t.is_transfer && !t.is_card_payment)
      map[t.category_id] = (map[t.category_id] || 0) + Math.abs(t.amount);
  });
  return map;
}

function _periodLabel(period) {
  if (_budgetView === 'annual') return String(period.year);
  return new Date(period.year, period.month - 1, 1)
    .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

// ── Seletores de período ────────────────────────────────────────────────────

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

// ── Abas de visualização ────────────────────────────────────────────────────

function setBudgetView(view) {
  _budgetView = view;
  document.getElementById('budgetTabMonthly')?.classList.toggle('active', view === 'monthly');
  document.getElementById('budgetTabAnnual')?.classList.toggle('active',  view === 'annual');
  const mp = document.getElementById('budgetMonthPicker');
  const yp = document.getElementById('budgetYearPicker');
  if (mp) mp.style.display = view === 'monthly' ? '' : 'none';
  if (yp) yp.style.display = view === 'annual'  ? '' : 'none';
  loadBudgets();
}

// ── Período selecionado ─────────────────────────────────────────────────────

function _getSelectedPeriod() {
  if (_budgetView === 'annual') {
    const y = parseInt(document.getElementById('budgetYear')?.value) || new Date().getFullYear();
    return { year: y };
  }
  const mv = document.getElementById('budgetMonth')?.value || new Date().toISOString().slice(0, 7);
  const [y, m] = mv.split('-');
  return { year: parseInt(y), month: parseInt(m), monthStr: mv };
}

// ── AUTO-RESET: propagar orçamentos permanentes para o mês atual ────────────

async function _propagateAutoResetBudgets(period) {
  // Copia orçamentos auto_reset=true do mês mais recente para o mês target,
  // se ele ainda não tiver esses orçamentos.
  // Funciona mesmo sem migration v2/v3 (adaptado ao schema disponível).
  if (_budgetView !== 'monthly') return;
  try {
    const hasSchema = await _checkBudgetSchema();
    const hasPaused = await _checkBudgetPausedColumn();

    const targetMs = `${period.year}-${String(period.month).padStart(2, '0')}-01`;

    // ── 1. Buscar orçamentos auto_reset do mês target ──────────────────────
    // Se já existem, encerrar (já foram propagados anteriormente).
    let existQ = famQ(sb.from('budgets').select('category_id'));
    if (hasSchema) existQ = existQ.eq('budget_type', 'monthly');
    existQ = existQ.eq('month', targetMs);
    const { data: targetBudgets } = await existQ;
    const existingCatIds = new Set((targetBudgets || []).map(b => b.category_id));

    // ── 2. Buscar TODOS os orçamentos auto_reset (qualquer mês) ───────────
    let srcQ = famQ(sb.from('budgets').select(
      hasPaused
        ? 'id,category_id,amount,month,budget_type,auto_reset,paused,notes,family_member_id,family_id'
        : 'id,category_id,amount,month,budget_type,auto_reset,notes,family_member_id,family_id'
    ));
    if (hasSchema) srcQ = srcQ.eq('budget_type', 'monthly');
    // Não filtramos por auto_reset aqui para capturar também registros onde
    // a coluna pode ter valor NULL por diferença de schema.
    const { data: allMonthly } = await srcQ;
    if (!allMonthly?.length) return;

    // Filtrar apenas auto_reset=true (ou null, tratado como true para compatibilidade)
    const autoResetSrc = allMonthly.filter(b => {
      if (hasPaused && b.paused === true) return false; // pausados nunca propagam
      return b.auto_reset !== false; // true ou null → propagar
    });
    if (!autoResetSrc.length) return;

    // ── 3. Para cada categoria, pegar o registro do mês mais recente ───────
    // que seja ANTERIOR ao targetMs (não propagar do futuro para o passado).
    const latestByCat = {};
    autoResetSrc.forEach(b => {
      if (!b.month) return;
      if (b.month >= targetMs) return; // só propagar de meses anteriores
      if (existingCatIds.has(b.category_id)) return; // já existe no target
      const cur = latestByCat[b.category_id];
      if (!cur || b.month > cur.month) latestByCat[b.category_id] = b;
    });

    const toInsert = Object.values(latestByCat);
    if (!toInsert.length) return;

    // ── 4. Inserir no mês target ───────────────────────────────────────────
    const [y] = targetMs.split('-');
    const inserts = toInsert.map(b => {
      const row = {
        category_id:      b.category_id,
        amount:           b.amount,
        month:            targetMs,
        family_id:        famId(),
        year:             parseInt(y),
        notes:            b.notes || null,
        family_member_id: b.family_member_id || null,
      };
      if (hasSchema) { row.budget_type = 'monthly'; row.auto_reset = true; }
      if (hasPaused) row.paused = false;
      return row;
    });

    // Inserir em lote; ignorar erros de duplicata (23505)
    const { error: insertErr } = await sb.from('budgets').insert(inserts);
    if (insertErr) {
      if (insertErr.code !== '23505' && !insertErr.message?.includes('duplicate')) {
        console.warn('[budgets] propagate error:', insertErr.message, insertErr.code);
      }
    } else {
      console.log(`[budgets] propagated ${inserts.length} budget(s) to ${targetMs}`);
    }
  } catch(e) {
    console.warn('[budgets] propagate exception:', e?.message);
  }
}

// ── Pausar / Retomar ────────────────────────────────────────────────────────

async function toggleBudgetPause(id) {
  const hasPaused = await _checkBudgetPausedColumn();
  const b = _budgetCache.find(x => x.id === id);
  if (!b) return;

  if (!hasPaused) {
    toast('Execute migration_budgets_v3.sql para habilitar a pausa.', 'warning');
    return;
  }

  const newPaused = !(b.paused ?? false);
  const { error } = await sb.from('budgets').update({ paused: newPaused }).eq('id', id);
  if (error) { toast(error.message, 'error'); return; }

  toast(newPaused
    ? '⏸ Orçamento pausado — histórico preservado'
    : '▶ Orçamento retomado', 'success');
  await loadBudgets();
}

// ── Skeleton ────────────────────────────────────────────────────────────────

function _budgetSkeletonHTML() {
  return Array.from({ length: 4 }, () =>
    `<div class="bgt-card bgt-skeleton">
      <div class="bgt-sk-line bgt-sk-line--title"></div>
      <div class="bgt-sk-line bgt-sk-line--bar"></div>
      <div class="bgt-sk-line bgt-sk-line--sub"></div>
    </div>`
  ).join('');
}

// ── Carregar e renderizar ───────────────────────────────────────────────────

async function loadBudgets() {
  const period = _getSelectedPeriod();
  const grid   = document.getElementById('budgetGrid');
  if (!grid) return;

  grid.innerHTML = _budgetSkeletonHTML();

  const [hasNewSchema, hasPaused] = await Promise.all([
    _checkBudgetSchema(),
    _checkBudgetPausedColumn(),
  ]);

  if (_budgetView === 'monthly') {
    await _propagateAutoResetBudgets(period);
  }

  // Two-step: fetch budgets with scalar fields only (sem JOIN de categorias),
  // depois enriquecer via state.categories já carregado em memória.
  // Evita PostgREST schema-cache issues que causam data:null silencioso.
  // Colunas escalares — 'paused' incluído apenas se a coluna existir no banco
  const _cols = hasPaused
    ? 'id,category_id,amount,month,year,budget_type,auto_reset,paused,notes,family_member_id,family_id,created_at'
    : 'id,category_id,amount,month,year,budget_type,auto_reset,notes,family_member_id,family_id,created_at';
  let bq = famQ(sb.from('budgets').select(_cols));

  if (hasNewSchema) {
    bq = bq.eq('budget_type', _budgetView);
    if (_budgetView === 'monthly') {
      const ms = `${period.year}-${String(period.month).padStart(2, '0')}-01`;
      bq = bq.eq('month', ms);
    } else {
      bq = bq.eq('year', period.year);
    }
  } else {
    if (_budgetView === 'annual') {
      grid.innerHTML = `<div class="bgt-empty" style="grid-column:1/-1">
        <div class="bgt-empty-icon">⚠️</div>
        <p>Orçamentos anuais requerem a migration do banco.</p>
        <small>Execute <code>migration_budgets_v2.sql</code> no Supabase.</small>
      </div>`;
      return;
    }
    const ms = `${period.year}-${String(period.month).padStart(2, '0')}-01`;
    bq = bq.eq('month', ms);
  }

  const { data: budgets, error: be } = await bq;
  if (be) {
    toast('Erro ao carregar orçamentos: ' + be.message, 'error');
    grid.innerHTML = `<div class="bgt-empty" style="grid-column:1/-1">
      <div class="bgt-empty-icon">❌</div><p>Erro ao carregar</p>
      <small>${esc(be.message)}</small>
    </div>`;
    return;
  }
  // Enriquecer cada budget com sua categoria a partir do state (já carregado)
  const _catById = Object.fromEntries((state.categories || []).map(c => [c.id, c]));
  _budgetCache = (budgets || []).map(b => ({
    ...b,
    categories: _catById[b.category_id] || null,
  }));

  let txQ = famQ(sb.from('transactions')
    .select('category_id,amount,is_transfer,is_card_payment')).lt('amount', 0);
  if (_budgetView === 'monthly') {
    const y = String(period.year), m = String(period.month).padStart(2, '0');
    const last = String(_lastDayOf(y, m)).padStart(2, '0');
    txQ = txQ.gte('date', `${y}-${m}-01`).lte('date', `${y}-${m}-${last}`);
  } else {
    txQ = txQ.gte('date', `${period.year}-01-01`).lte('date', `${period.year}-12-31`);
  }
  const { data: txs } = await txQ;
  const raw = _buildRawSpending(txs);

  _budgetSpent = {};
  _budgetCache.forEach(b => {
    const fam = _categoryFamily(b.category_id);
    _budgetSpent[b.id] = 0;
    fam.forEach(cid => { _budgetSpent[b.id] += (raw[cid] || 0); });
  });

  if (!_budgetCache.length) {
    const lbl = _periodLabel(period);
    grid.innerHTML = `<div class="bgt-empty" style="grid-column:1/-1">
      <div class="bgt-empty-icon">🎯</div>
      <p>Nenhum orçamento para <strong>${lbl}</strong></p>
      <button class="btn btn-primary" style="margin-top:16px" onclick="openBudgetModal()">+ Criar orçamento</button>
    </div>`;
    _renderDashBudgetSnapshot();
    return;
  }

  const active = _budgetCache.filter(b => !(b.paused ?? false));
  const paused = _budgetCache.filter(b =>  (b.paused ?? false));
  const sortFn = (a, b) =>
    (_budgetSpent[b.id] / (b.amount || 1)) - (_budgetSpent[a.id] / (a.amount || 1));

  let html = active.sort(sortFn).map(b => _budgetCardHTML(b, _budgetSpent[b.id], raw)).join('');
  if (paused.length) {
    html += `<div class="bgt-paused-sep" style="grid-column:1/-1">
      <span>⏸ Pausados (${paused.length})</span>
    </div>`;
    html += paused.sort(sortFn).map(b => _budgetCardHTML(b, _budgetSpent[b.id], raw)).join('');
  }

  grid.innerHTML = html;

  requestAnimationFrame(() => {
    grid.querySelectorAll('.bgt-card').forEach((el, i) => {
      el.style.animationDelay = `${i * 40}ms`;
      el.classList.add('bgt-card--animate');
    });
  });

  _renderDashBudgetSnapshot();
}

// ── Card HTML ───────────────────────────────────────────────────────────────

function _budgetCardHTML(b, spent, raw) {
  const pct    = b.amount > 0 ? Math.min(100, (spent / b.amount) * 100) : 0;
  const over   = spent > b.amount && b.amount > 0;
  const near   = !over && pct >= 80;
  const isPaused = b.paused ?? false;

  const cat   = b.categories || {};
  const color = isPaused ? 'var(--muted)'
              : over     ? 'var(--red)'
              : near     ? 'var(--amber)'
              : (cat.color || 'var(--accent)');
  const rem = b.amount - spent;

  const member = b.family_member_id && typeof getFamilyMemberById === 'function'
    ? getFamilyMemberById(b.family_member_id) : null;
  const memberBadge = member
    ? `<span class="bgt-tag bgt-tag--member">${member.avatar_emoji || '👤'} ${esc(member.name)}</span>` : '';

  const parentCat = cat.parent_id
    ? state.categories.find(c => c.id === cat.parent_id) : null;

  const children = state.categories.filter(c => c.parent_id === b.category_id && c.type === 'despesa');
  const childTagsHtml = children.length
    ? `<div class="bgt-subtags">${children
        .map(c => {
          const cs = (raw || {})[c.id] || 0;
          return `<span class="bgt-subtag" style="--sub-color:${c.color || 'var(--accent)'}"
            ${cs > 0 ? `onclick="event.stopPropagation();openCategoryHistory('${c.id}','${esc(c.name)}')"` : ''}>
            ${c.icon || ''} ${esc(c.name)}${cs > 0 ? ` <em>${fmt(cs)}</em>` : ''}
          </span>`;
        }).join('')}
      </div>` : '';

  const autoResetBadge = (b.auto_reset ?? true) && _budgetView === 'monthly' && !isPaused
    ? `<span class="bgt-tag bgt-tag--reset" title="Repete todo mês automaticamente">🔄 Mensal</span>` : '';
  const pausedBadge = isPaused
    ? `<span class="bgt-tag bgt-tag--paused">⏸ Pausado</span>` : '';
  const annualBadge = _budgetView === 'annual'
    ? `<span class="bgt-tag bgt-tag--annual">📆 Anual</span>` : '';

  const statusEl = over
    ? `<span class="bgt-status bgt-status--over">⚠ Excedido em ${fmt(Math.abs(rem))}</span>`
    : near
    ? `<span class="bgt-status bgt-status--near">⚡ ${fmt(rem)} restante</span>`
    : isPaused
    ? `<span class="bgt-status bgt-status--paused">Pausado — dados históricos preservados</span>`
    : `<span class="bgt-status bgt-status--ok">✓ ${fmt(rem)} disponível</span>`;

  const stateClass = isPaused ? 'bgt-card--paused'
                   : over     ? 'bgt-card--over'
                   : near     ? 'bgt-card--near'
                   :            'bgt-card--ok';

  return `
  <div class="bgt-card ${stateClass}"
       onclick="openBudgetDrilldown('${b.id}','${(cat.name||'').replace(/'/g,'\\u0027')}')">

    <div class="bgt-stripe" style="background:${color}"></div>

    <div class="bgt-card-head">
      <div class="bgt-cat-wrap">
        <div class="bgt-cat-icon" style="background:${color}18;color:${color}">${cat.icon || '📦'}</div>
        <div class="bgt-cat-meta">
          ${parentCat ? `<div class="bgt-cat-parent">${parentCat.icon || ''} ${esc(parentCat.name)} ›</div>` : ''}
          <div class="bgt-cat-name">${esc(cat.name || '—')}</div>
          <div class="bgt-cat-tags">${memberBadge}${autoResetBadge}${annualBadge}${pausedBadge}</div>
        </div>
      </div>
      <div class="bgt-actions" onclick="event.stopPropagation()">
        <button class="bgt-btn-icon" onclick="openBudgetModal('${b.id}')" title="Editar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="bgt-btn-icon ${isPaused ? 'bgt-btn-icon--resume' : ''}"
          onclick="toggleBudgetPause('${b.id}')"
          title="${isPaused ? 'Retomar orçamento' : 'Pausar (preserva dados)'}">
          ${isPaused
            ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`
            : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`}
        </button>
        <button class="bgt-btn-icon bgt-btn-icon--danger" onclick="deleteBudget('${b.id}')" title="Excluir">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>
    </div>

    <div class="bgt-progress-wrap">
      <div class="bgt-progress-track">
        <div class="bgt-progress-fill" style="width:${pct}%;background:${color}"></div>
        ${pct > 0 ? `<div class="bgt-progress-pct" style="color:${color}">${pct.toFixed(0)}%</div>` : ''}
      </div>
    </div>

    <div class="bgt-amounts">
      <div class="bgt-amt-cell">
        <div class="bgt-amt-lbl">Gasto</div>
        <div class="bgt-amt-val${over ? ' bgt-amt-val--over' : ''}">${fmt(spent)}</div>
      </div>
      <div class="bgt-amt-cell bgt-amt-cell--center">
        <div class="bgt-amt-lbl">${over ? 'Excesso' : 'Restante'}</div>
        <div class="bgt-amt-val" style="color:${over ? 'var(--red)' : isPaused ? 'var(--muted)' : 'var(--green)'}">
          ${over ? '-' : ''}${fmt(Math.abs(rem))}
        </div>
      </div>
      <div class="bgt-amt-cell bgt-amt-cell--right">
        <div class="bgt-amt-lbl">Meta</div>
        <div class="bgt-amt-val">${fmt(b.amount)}</div>
      </div>
    </div>

    <div class="bgt-footer">
      ${statusEl}
      ${b.notes ? `<div class="bgt-note">💬 ${esc(b.notes)}</div>` : ''}
    </div>

    ${childTagsHtml}
  </div>`;
}

// ── Drilldown imersivo ──────────────────────────────────────────────────────

async function _fetchRawSpendingForDrill(dateFrom, dateTo) {
  const { data } = await famQ(
    sb.from('transactions').select('category_id,amount,is_transfer,is_card_payment')
  ).lt('amount', 0).gte('date', dateFrom).lte('date', dateTo);
  return _buildRawSpending(data);
}

async function openBudgetDrilldown(budgetId, catName) {
  const modal = document.getElementById('budgetDrilldownModal');
  if (!modal) return;
  const b = _budgetCache.find(x => x.id === budgetId);
  if (!b) return;

  const period = _getSelectedPeriod();
  let dateFrom, dateTo;
  if (_budgetView === 'monthly') {
    const y = String(period.year), m = String(period.month).padStart(2, '0');
    dateFrom = `${y}-${m}-01`;
    dateTo   = `${y}-${m}-${String(_lastDayOf(y, m)).padStart(2, '0')}`;
  } else {
    dateFrom = `${period.year}-01-01`;
    dateTo   = `${period.year}-12-31`;
  }

  const cat   = b.categories || {};
  const spent = _budgetSpent[b.id] || 0;
  const pct   = b.amount > 0 ? Math.min(100, (spent / b.amount) * 100) : 0;
  const over  = spent > b.amount && b.amount > 0;
  const color = over ? 'var(--red)' : pct >= 80 ? 'var(--amber)' : (cat.color || 'var(--accent)');

  const headerEl = document.getElementById('budgetDrillHeader');
  if (headerEl) {
    headerEl.innerHTML = `
      <div class="bgt-drill-hero" style="--drill-color:${color}">
        <div class="bgt-drill-hero-left">
          <div class="bgt-drill-icon" style="background:${color}18;color:${color}">${cat.icon || '📦'}</div>
          <div>
            <div class="bgt-drill-cat">${esc(cat.name || catName)}</div>
            <div class="bgt-drill-period">${_periodLabel(period)}</div>
          </div>
        </div>
        <div class="bgt-drill-kpis">
          <div class="bgt-drill-kpi">
            <span class="bgt-drill-kpi-val" style="color:${color}">${fmt(spent)}</span>
            <span class="bgt-drill-kpi-lbl">gasto</span>
          </div>
          <div class="bgt-drill-sep">de</div>
          <div class="bgt-drill-kpi">
            <span class="bgt-drill-kpi-val">${fmt(b.amount)}</span>
            <span class="bgt-drill-kpi-lbl">orçado</span>
          </div>
        </div>
      </div>
      <div class="bgt-drill-bar-wrap">
        <div class="bgt-drill-bar-track">
          <div class="bgt-drill-bar-fill" style="width:${pct}%;background:${color}"></div>
        </div>
        <span class="bgt-drill-bar-pct" style="color:${color}">${pct.toFixed(1)}%</span>
      </div>`;
  }

  document.getElementById('budgetDrillTitle').textContent = esc(cat.name || catName);
  const bodyEl = document.getElementById('budgetDrillBody');
  if (bodyEl) bodyEl.innerHTML = '<tr><td colspan="3" class="bgt-drill-loading">Carregando transações…</td></tr>';

  const subEl = document.getElementById('budgetDrillSubs');
  if (subEl) subEl.innerHTML = '';

  openModal('budgetDrilldownModal');

  // Buscar raw spending para subcategorias e transações em paralelo
  const allCatIds = [..._categoryFamily(b.category_id)];
  const [rawData, txResult] = await Promise.all([
    _fetchRawSpendingForDrill(dateFrom, dateTo),
    (async () => {
      let q = famQ(
        sb.from('transactions')
          .select('id,date,description,amount,currency,brl_amount,status,accounts!transactions_account_id_fkey(name),categories(name,color,icon)')
      ).lt('amount', 0)
       .eq('is_transfer', false)
       .eq('is_card_payment', false)
       .gte('date', dateFrom).lte('date', dateTo)
       .order('date', { ascending: false })
       .limit(500);
      q = allCatIds.length === 1 ? q.eq('category_id', allCatIds[0]) : q.in('category_id', allCatIds);
      return q;
    })(),
  ]);

  // Renderizar subcategorias
  const children = state.categories.filter(c => c.parent_id === b.category_id && c.type === 'despesa');
  if (subEl && children.length) {
    const totalSub = children.reduce((s, c) => s + (rawData[c.id] || 0), 0);
    subEl.innerHTML = `
      <div class="bgt-drill-section-title">Distribuição por subcategoria</div>
      <div class="bgt-drill-subs">
        ${children
          .map(c => ({ c, s: rawData[c.id] || 0 }))
          .sort((a, b) => b.s - a.s)
          .map(({ c, s: cs }) => {
            const subPct = totalSub > 0 ? (cs / totalSub) * 100 : 0;
            const subBudgetPct = b.amount > 0 ? (cs / b.amount) * 100 : 0;
            return `
              <div class="bgt-drill-sub-row">
                <div class="bgt-drill-sub-label">
                  <span style="color:${c.color || 'var(--accent)'}">${c.icon || '•'}</span>
                  <span>${esc(c.name)}</span>
                </div>
                <div class="bgt-drill-sub-bar-wrap">
                  <div class="bgt-drill-sub-bar-track">
                    <div class="bgt-drill-sub-bar-fill"
                      style="width:${subPct}%;background:${c.color || 'var(--accent)'}"></div>
                  </div>
                  <span class="bgt-drill-sub-pct">${subBudgetPct.toFixed(0)}% do total</span>
                </div>
                <div class="bgt-drill-sub-val">${cs > 0 ? fmt(cs) : '—'}</div>
              </div>`;
          }).join('')}
      </div>`;
  }

  const { data, error } = await txResult;
  const totalEl = document.getElementById('budgetDrillTotal');

  if (error) {
    if (bodyEl) bodyEl.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--red)">Erro: ${esc(error.message)}</td></tr>`;
    return;
  }

  if (!data?.length) {
    if (totalEl) totalEl.textContent = 'Nenhuma transação no período';
    if (bodyEl) bodyEl.innerHTML = '<tr><td colspan="3" class="bgt-drill-empty">Nenhuma transação no período</td></tr>';
    return;
  }

  const totalSpent = data.reduce((s, t) => s + Math.abs(parseFloat(t.amount) || 0), 0);
  if (totalEl) totalEl.textContent = `${data.length} transação${data.length !== 1 ? 'ões' : ''} · Total: ${fmt(totalSpent)}`;

  if (bodyEl) {
    bodyEl.innerHTML = data.map(t => {
      const cur      = t.currency || 'BRL';
      const catColor = t.categories?.color || 'var(--muted)';
      const catBadge = t.categories
        ? `<span class="badge" style="background:${catColor}18;color:${catColor};border:1px solid ${catColor}28;font-size:.65rem">${esc(t.categories.name)}</span>` : '';
      const pend = t.status === 'pending'
        ? ' <span style="color:var(--amber);font-size:.72rem">⏳</span>' : '';
      return `<tr class="bgt-drill-tx-row"
        onclick="closeModal('budgetDrilldownModal');editTransaction('${t.id}')">
        <td class="bgt-drill-tx-date">${fmtDate(t.date)}</td>
        <td>
          <div class="bgt-drill-tx-desc">${esc(t.description || '')}${pend}</div>
          <div style="margin-top:2px">${catBadge}</div>
          <div class="bgt-drill-tx-acct">${esc(t.accounts?.name || '')}</div>
        </td>
        <td class="bgt-drill-tx-amt">
          ${fmt(Math.abs(t.amount), cur)}
          ${cur !== 'BRL' && t.brl_amount
            ? `<div class="bgt-drill-tx-brl">${fmt(t.brl_amount, 'BRL')}</div>` : ''}
        </td>
      </tr>`;
    }).join('');
  }
}

// ── Dashboard snapshot ──────────────────────────────────────────────────────

function _renderDashBudgetSnapshot() {
  const el = document.getElementById('dashBudgetSnapshot');
  if (!el) return;

  const prefs = typeof _dashGetPrefs === 'function' ? _dashGetPrefs() : {};
  if (prefs.budgetSnap === false) { el.style.display = 'none'; return; }

  const now  = new Date();
  const mStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const active = _budgetCache.filter(b => {
    if (b.paused) return false;
    if (b.budget_type && b.budget_type !== 'monthly') return false;
    if (b.month && b.month.slice(0, 7) !== mStr) return false;
    return true;
  });

  if (!active.length) { el.style.display = 'none'; return; }
  el.style.display = '';

  // ── Totais globais ─────────────────────────────────────────────────────────
  const totalBudget = active.reduce((s, b) => s + (b.amount || 0), 0);
  const totalSpent  = active.reduce((s, b) => s + (_budgetSpent[b.id] || 0), 0);
  const totalPct    = totalBudget > 0 ? Math.min(100, (totalSpent / totalBudget) * 100) : 0;
  const overCount   = active.filter(b => (_budgetSpent[b.id] || 0) > b.amount).length;
  const nearCount   = active.filter(b => {
    const p = b.amount > 0 ? (_budgetSpent[b.id] || 0) / b.amount : 0;
    return p >= 0.8 && p < 1;
  }).length;
  const remaining   = Math.max(0, totalBudget - totalSpent);
  const globalColor = overCount > 0 ? 'var(--red)' : nearCount > 0 ? 'var(--amber)' : 'var(--accent)';

  // ── Ordenação: excedidos primeiro, depois por % decrescente ───────────────
  const sorted = [...active].sort((a, b) => {
    const pa = (_budgetSpent[a.id] || 0) / (a.amount || 1);
    const pb = (_budgetSpent[b.id] || 0) / (b.amount || 1);
    return pb - pa;
  });

  // ── Render de cada card ───────────────────────────────────────────────────
  const cards = sorted.map(b => {
    const cat   = b.categories || {};
    const spent = _budgetSpent[b.id] || 0;
    const pct   = b.amount > 0 ? Math.min(100, (spent / b.amount) * 100) : 0;
    const over  = spent > b.amount;
    const near  = !over && pct >= 80;
    const color = over  ? 'var(--red)'
                : near  ? 'var(--amber)'
                :          (cat.color || 'var(--accent)');
    const statusClass = over ? 'dbs-card--over' : near ? 'dbs-card--near' : 'dbs-card--ok';

    // Badge apenas para alertas relevantes
    const badge = over
      ? `<span class="dbs-badge dbs-badge--over">Excedido</span>`
      : near
      ? `<span class="dbs-badge dbs-badge--near">⚡ Atenção</span>`
      : '';

    const leftover = b.amount - spent;
    const leftoverFmt = leftover >= 0
      ? `<span class="dbs-remaining">💚 Restam ${fmt(leftover)}</span>`
      : `<span class="dbs-remaining dbs-remaining--over">🔴 Excesso ${fmt(Math.abs(leftover))}</span>`;

    // Mini-anel de progresso SVG (32×32)
    const r = 12, circ = 2 * Math.PI * r;
    const dash = ((pct / 100) * circ).toFixed(1);
    const gap  = (circ - dash).toFixed(1);
    const ring = `<svg width="32" height="32" viewBox="0 0 32 32" style="flex-shrink:0;transform:rotate(-90deg)">
      <circle cx="16" cy="16" r="${r}" fill="none" stroke="${color}22" stroke-width="3.5"/>
      <circle cx="16" cy="16" r="${r}" fill="none" stroke="${color}" stroke-width="3.5"
        stroke-dasharray="${dash} ${gap}" stroke-linecap="round"/>
    </svg>`;

    return `<div class="dbs-card ${statusClass}" onclick="navigate('budgets')" title="${esc(cat.name||'—')}">
      <div class="dbs-card-top">
        <div style="position:relative;flex-shrink:0">
          ${ring}
          <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:.78rem">
            ${cat.icon || '📦'}
          </div>
        </div>
        <div class="dbs-card-info">
          <div class="dbs-cat-name">${esc(cat.name || '—')}</div>
          ${leftoverFmt}
        </div>
        ${badge}
      </div>
      <div class="dbs-bar-track">
        <div class="dbs-bar-fill" style="width:${pct}%;background:${color}"></div>
      </div>
      <div class="dbs-card-bottom">
        <span class="dbs-spent" style="color:${color}">${fmt(spent)}</span>
        <span class="dbs-limit">/ ${fmt(b.amount)}</span>
        <span class="dbs-pct" style="color:${color}">${pct.toFixed(0)}%</span>
      </div>
    </div>`;
  }).join('');

  // ── Barra de progresso global ──────────────────────────────────────────────
  const monthName = now.toLocaleDateString('pt-BR', { month: 'long' });

  const inner = el.querySelector('.dash-budget-snap-inner');
  if (!inner) return;

  // Status geral para mensagem no header
  const statusMsg = overCount > 0
    ? `<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(220,38,38,.15);color:#fca5a5;border-radius:20px;padding:1px 8px;font-size:.64rem;font-weight:700;letter-spacing:.03em">⚠ ${overCount} excedido${overCount!==1?'s':''}</span>`
    : nearCount > 0
    ? `<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(180,83,9,.15);color:#fcd34d;border-radius:20px;padding:1px 8px;font-size:.64rem;font-weight:700;letter-spacing:.03em">⚡ ${nearCount} no limite</span>`
    : `<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(93,219,160,.15);color:#6ee7a0;border-radius:20px;padding:1px 8px;font-size:.64rem;font-weight:700;letter-spacing:.03em">✓ Sob controle</span>`;

  inner.innerHTML = `
    <div class="dbs-header">
      <div class="dbs-header-left">
        <div class="dbs-title">🎯 Orçamentos · ${monthName.charAt(0).toUpperCase() + monthName.slice(1)}</div>
        <div class="dbs-subtitle" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span>${active.length} categoria${active.length !== 1 ? 's' : ''} ativa${active.length !== 1 ? 's' : ''}</span>
          ${statusMsg}
        </div>
      </div>
      <button class="btn dbs-link" onclick="event.stopPropagation();navigate('budgets')" style="padding:6px 14px">
        Ver todos →
      </button>
    </div>

    <div class="dbs-summary-strip">
      <div class="dbs-kpi">
        <div class="dbs-kpi-lbl">Total gasto</div>
        <div class="dbs-kpi-val" style="color:${globalColor}">${fmt(totalSpent)}</div>
      </div>
      <div class="dbs-kpi">
        <div class="dbs-kpi-lbl">Orçado</div>
        <div class="dbs-kpi-val">${fmt(totalBudget)}</div>
      </div>
      <div class="dbs-kpi">
        <div class="dbs-kpi-lbl">Disponível</div>
        <div class="dbs-kpi-val" style="color:${remaining > 0 ? 'var(--green)' : 'var(--red)'}">${fmt(remaining)}</div>
      </div>
      <div class="dbs-kpi dbs-kpi--hide-sm">
        <div class="dbs-kpi-lbl">Uso geral</div>
        <div class="dbs-kpi-val" style="color:${globalColor}">${totalPct.toFixed(0)}%</div>
      </div>
    </div>

    <div class="dbs-global-bar-wrap">
      <div class="dbs-global-bar-track">
        <div class="dbs-global-bar-fill" style="width:${totalPct}%;background:${globalColor}"></div>
      </div>
      <span class="dbs-global-bar-pct" style="color:${globalColor}">${totalPct.toFixed(0)}%</span>
    </div>

    <div class="dbs-grid">
      ${cards}
    </div>`;
}

// ── Histórico ───────────────────────────────────────────────────────────────

async function loadBudgetHistory() {
  const catId     = document.getElementById('budgetHistCat')?.value;
  const container = document.getElementById('budgetHistContainer');
  if (!container) return;

  if (!catId) {
    container.innerHTML = '<div class="bgt-hist-placeholder">Selecione uma categoria para ver o histórico dos últimos 12 meses.</div>';
    const eb = document.getElementById('budgetHistExportBar');
    if (eb) eb.style.display = 'none';
    return;
  }

  container.innerHTML = '<div class="bgt-hist-placeholder">⏳ Carregando...</div>';
  const exportBar = document.getElementById('budgetHistExportBar');
  if (exportBar) exportBar.style.display = 'none';

  const now    = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
  }

  const firstMonth = months[0];
  const lastDay    = _lastDayOf(now.getFullYear(), now.getMonth() + 1);
  const lastDate   = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  // Busca TODOS os orçamentos da categoria (sem filtrar por mês) para capturar o recorrente
  const [{ data: histBudgets }, { data: txAll }] = await Promise.all([
    famQ(sb.from('budgets').select('month,amount,auto_reset,budget_type,created_at'))
      .eq('category_id', catId),
    (async () => {
      const family = _categoryFamily(catId);
      return famQ(sb.from('transactions')
        .select('category_id,amount,date,is_transfer,is_card_payment'))
        .lt('amount', 0).gte('date', firstMonth).lte('date', lastDate)
        .in('category_id', [...family]);
    })(),
  ]);

  // Mapa mês → valor específico
  const budgetMap = {};
  (histBudgets || []).forEach(b => { if (b.month) budgetMap[b.month] = b.amount; });

  // Orçamento recorrente: auto_reset=true mais antigo → valor base para fallback
  const recurring    = (histBudgets || [])
    .filter(b => b.auto_reset !== false)
    .sort((a, b_) => (a.month || a.created_at || '') < (b_.month || b_.created_at || '') ? -1 : 1);
  const recurBase    = recurring[0] || null;
  const recurAmount  = recurBase?.amount  || 0;
  const recurStart   = recurBase?.month   || null;

  let totalSpent = 0, totalBudget = 0, overCount = 0;

  const rows = months.map(ms => {
    const [y, m] = ms.slice(0, 7).split('-');
    const last   = _lastDayOf(parseInt(y), parseInt(m));
    const me     = `${y}-${m}-${String(last).padStart(2, '0')}`;
    const spent  = (txAll || [])
      .filter(t => !t.is_transfer && !t.is_card_payment && t.date >= ms && t.date <= me)
      .reduce((s, t) => s + Math.abs(t.amount), 0);

    // Valor: específico do mês > recorrente base (a partir do mês de criação) > 0
    let budget = budgetMap[ms] || 0;
    const isRecurring = !budget && recurAmount > 0 && recurStart && ms >= recurStart;
    if (isRecurring) budget = recurAmount;

    const pct    = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
    const over   = budget > 0 && spent > budget;
    const label  = new Date(ms + 'T12:00').toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
    const isCur  = ms === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    if (budget > 0) { totalBudget += budget; totalSpent += spent; }
    if (over) overCount++;

    const recurBadge = isRecurring
      ? ' <span title="Valor da recorrência" style="font-size:.6rem;color:var(--muted);vertical-align:middle">↻</span>'
      : '';

    return `<tr${isCur ? ' class="bgt-hist-row--current"' : ''}>
      <td class="bgt-hist-month">${label}${isCur ? ' <span class="bgt-hist-now">agora</span>' : ''}</td>
      <td>${budget > 0 ? fmt(budget) + recurBadge : '<span style="color:var(--muted)">—</span>'}</td>
      <td class="${over ? 'amount-neg' : ''}" style="font-weight:600">
        ${spent > 0 ? fmt(spent) : '<span style="color:var(--muted)">—</span>'}
      </td>
      <td style="min-width:100px">
        ${budget > 0 ? `
          <div class="bgt-hist-bar-track">
            <div class="bgt-hist-bar-fill" style="width:${pct}%;background:${over ? 'var(--red)' : pct >= 80 ? 'var(--amber)' : 'var(--accent)'}"></div>
          </div>
          <div style="font-size:.65rem;color:var(--muted);margin-top:2px">${pct.toFixed(0)}%</div>` : ''}
      </td>
      <td class="${budget > 0 ? (over ? 'amount-neg' : 'amount-pos') : ''}" style="font-size:.78rem">
        ${budget > 0 ? (over ? '-' : '') + fmt(Math.abs(budget - spent)) : ''}
      </td>
    </tr>`;
  }).join('');

  const withBudget = months.filter(ms =>
    budgetMap[ms] || (recurAmount > 0 && recurStart && ms >= recurStart)
  ).length;
  const avgPct = totalBudget > 0 ? ((totalSpent / totalBudget) * 100).toFixed(0) : null;

  container.innerHTML = `
    <div class="bgt-hist-summary">
      <span>📅 <strong>${withBudget}</strong> meses com orçamento</span>
      ${recurAmount > 0 ? `<span style="font-size:.74rem;color:var(--muted)">↻ Recorrente: ${fmt(recurAmount)}</span>` : ''}
      ${avgPct !== null ? `<span>📊 Média: <strong>${avgPct}%</strong> utilizado</span>` : ''}
      ${overCount > 0
        ? `<span class="bgt-hist-summary--over">⚠️ <strong>${overCount}</strong> ${overCount===1?'mês estourado':'meses estourados'}</span>`
        : withBudget > 0 ? '<span class="bgt-hist-summary--ok">✅ Nunca estourou</span>' : ''}
    </div>
    <div class="table-wrap">
      <table id="budgetHistTable">
        <thead><tr><th>Mês</th><th>Orçamento</th><th>Gasto</th><th>Progresso</th><th>Saldo</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  if (exportBar) exportBar.style.display = 'flex';
}


function openBudgetModal(id = '') {
  const existing = id ? _budgetCache.find(x => x.id === id) : null;

  document.getElementById('budgetId').value = id;
  document.getElementById('budgetModalTitle').textContent = id ? 'Editar Orçamento' : 'Novo Orçamento';

  // Detect recurring: budget_type='monthly' AND auto_reset=true stored as 'recurring' in UI
  const rawBtype = existing?.budget_type || _budgetView;
  const btype = (rawBtype === 'monthly' && existing?.auto_reset === true && existing?.id)
    ? 'recurring' : rawBtype;
  _setBudgetModalType(btype);

  const period = _getSelectedPeriod();
  const now    = new Date();

  const monthEl = document.getElementById('budgetModalMonth');
  if (monthEl) {
    monthEl.value = existing?.month
      ? existing.month.slice(0, 7)
      : (period.monthStr || now.toISOString().slice(0, 7));
  }
  const yearEl = document.getElementById('budgetModalYear');
  if (yearEl) yearEl.value = existing?.year || period.year || now.getFullYear();

  const catSel  = document.getElementById('budgetCategory');
  const parents = state.categories.filter(c => c.type === 'despesa' && !c.parent_id)
    .sort((a, b) => a.name.localeCompare(b.name));
  let opts = '';
  parents.forEach(p => {
    opts += `<option value="${p.id}">${p.icon || '📦'} ${esc(p.name)}</option>`;
    state.categories.filter(c => c.type === 'despesa' && c.parent_id === p.id)
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(c => { opts += `<option value="${c.id}">　↳ ${c.icon || '•'} ${esc(c.name)}</option>`; });
  });
  catSel.innerHTML = opts;
  if (existing?.category_id) catSel.value = existing.category_id;

  _updateBudgetCatHint();
  catSel.onchange = _updateBudgetCatHint;

  setAmtField('budgetAmount', existing?.amount || 0);

  const arEl = document.getElementById('budgetAutoReset');
  if (arEl) arEl.checked = existing ? !!(existing.auto_reset ?? true) : true;

  const notesEl = document.getElementById('budgetNotes');
  if (notesEl) notesEl.value = existing?.notes || '';

  if (typeof populateFamilyMemberSelect === 'function') {
    populateFamilyMemberSelect('budgetFamilyMember');
    const fmSel = document.getElementById('budgetFamilyMember');
    if (fmSel) fmSel.value = existing?.family_member_id || '';
  }

  openModal('budgetModal');
}

function _updateBudgetCatHint() {
  const catId = document.getElementById('budgetCategory')?.value;
  const hint  = document.getElementById('budgetCatHint');
  if (!hint) return;
  hint.style.display = catId && state.categories.some(c => c.parent_id === catId && c.type === 'despesa')
    ? '' : 'none';
}

function setBudgetModalType(type) { _setBudgetModalType(type); }

function _setBudgetModalType(type) {
  // Sync type card active states (new v2 modal)
  ['monthly','recurring','annual'].forEach(t => {
    const btn = document.getElementById('budgetModalType' + t.charAt(0).toUpperCase() + t.slice(1));
    if (btn) btn.classList.toggle('bgt-type-card--active', t === type);
  });
  // Legacy tab compat (old modals still present in some builds)
  document.getElementById('budgetModalTypeMonthly')?.classList.toggle('active', type === 'monthly');
  document.getElementById('budgetModalTypeAnnual')?.classList.toggle('active',  type === 'annual');

  const mg = document.getElementById('budgetModalMonthGroup');
  const yg = document.getElementById('budgetModalYearGroup');
  const tt = document.getElementById('budgetModalTypeCurrent');

  // Month picker: visible only for 'monthly'
  if (mg) mg.style.display = type === 'monthly' ? '' : 'none';
  // Year picker: visible only for 'annual'
  if (yg) yg.style.display = type === 'annual'  ? '' : 'none';
  // Store type
  if (tt) tt.setAttribute('data-type', type);

  // autoReset hidden input: true for recurring & monthly, false for annual
  const arHidden = document.getElementById('budgetAutoReset');
  if (arHidden && arHidden.type === 'hidden') {
    arHidden.value = (type === 'recurring' || type === 'monthly') ? 'true' : 'false';
  }

  // Contextual hint text + icon
  const hintEl   = document.getElementById('budgetTypeHint');
  const hintText = document.getElementById('budgetTypeHintText');
  const modalIcon = document.getElementById('budgetModalIcon');
  const modalSub  = document.getElementById('budgetModalSub');

  const hints = {
    monthly:   { text: 'Selecione o mês para este orçamento',                          icon: '📅', sub: 'Defina um limite para um mês específico' },
    recurring: { text: 'Sem picker de mês — este orçamento se repete todo mês sempre', icon: '🔄', sub: 'Repete automaticamente em todos os meses' },
    annual:    { text: 'Selecione o ano para este orçamento',                           icon: '📆', sub: 'Defina um limite total para o ano inteiro'  },
  };
  const h = hints[type] || hints.monthly;
  if (hintText) hintText.textContent = h.text;
  if (hintEl)   hintEl.style.display = '';
  if (modalIcon) modalIcon.textContent = h.icon;
  if (modalSub)  modalSub.textContent  = h.sub;
}

// ── Salvar / Excluir ────────────────────────────────────────────────────────

async function saveBudget() {
  const id       = document.getElementById('budgetId').value;
  const btype    = document.getElementById('budgetModalTypeCurrent')?.getAttribute('data-type') || _budgetView;
  const catId    = document.getElementById('budgetCategory').value;
  const amount   = Math.abs(getAmtField('budgetAmount'));
  // budgetAutoReset is a hidden input in the new modal (value='true'/'false')
  // or a checkbox in legacy builds — support both
  const _arEl = document.getElementById('budgetAutoReset');
  const autoReset = _arEl
    ? (_arEl.type === 'hidden' ? _arEl.value !== 'false' : (_arEl.checked ?? true))
    : true;
  const notes    = document.getElementById('budgetNotes')?.value.trim() || null;

  if (!catId)  { toast('Selecione uma categoria', 'error'); return; }
  if (!amount) { toast('Informe o valor limite', 'error');  return; }

  let month = null, year = null;
  if (btype === 'monthly') {
    const mv = document.getElementById('budgetModalMonth')?.value;
    if (!mv) { toast('Selecione o mês', 'error'); return; }
    const [y, m] = mv.split('-');
    month = `${y}-${m}-01`;
    year  = parseInt(y);
  } else if (btype === 'recurring') {
    // Recorrente: não requer mês fixo — usa o mês atual como âncora,
    // a propagação automática cuidará dos meses seguintes.
    const now = new Date();
    const y   = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2,'0');
    month = `${y}-${m}-01`;
    year  = y;
  } else {
    year = parseInt(document.getElementById('budgetModalYear')?.value);
    if (!year) { toast('Selecione o ano', 'error'); return; }
  }

  const [hasNewSchema, hasPaused] = await Promise.all([
    _checkBudgetSchema(),
    _checkBudgetPausedColumn(),
  ]);

  const data = { category_id: catId, amount, month, family_id: famId() };

  // Determine effective budget_type stored in DB:
  // 'recurring' is stored as budget_type='monthly' + auto_reset=true
  // (avoids a DB migration while reusing existing propagation logic)
  const dbBtype = (btype === 'recurring') ? 'monthly' : btype;

  if (hasNewSchema) {
    data.budget_type = dbBtype;
    // recurring → always auto_reset=true; monthly → respect checkbox (hidden=true); annual → false
    data.auto_reset  = (btype === 'recurring') ? true
                     : (btype === 'monthly')   ? (autoReset !== false)
                     : false;
    data.year        = year;
    data.notes       = notes;
  }
  if (hasPaused) data.paused = false;

  const fmMemberId = document.getElementById('budgetFamilyMember')?.value || null;
  if (fmMemberId) data.family_member_id = fmMemberId;

  let err;
  if (id) {
    ({ error: err } = await sb.from('budgets').update(data).eq('id', id));
  } else if (hasNewSchema) {
    // Use plain INSERT for recurring (no fixed month/constraint dependency)
    if (btype === 'recurring') {
      ({ error: err } = await sb.from('budgets').insert(data));
    } else {
      const conflict = dbBtype === 'monthly'
        ? 'family_id,category_id,month,budget_type'
        : 'family_id,category_id,year,budget_type';
      ({ error: err } = await sb.from('budgets').upsert(data, { onConflict: conflict }));
    }
  } else {
    ({ error: err } = await sb.from('budgets').upsert(data, { onConflict: 'category_id,month' }));
  }

  if (err) { toast(err.message, 'error'); return; }
  toast(id ? 'Orçamento atualizado!' : 'Orçamento criado!', 'success');
  closeModal('budgetModal');
  await loadBudgets();
  if (!id) _scrollTopAndHighlight('.bgt-card');
}

async function deleteBudget(id) {
  if (!confirm('Excluir este orçamento?\n\nDica: considere pausá-lo para preservar o histórico.')) return;
  const { error } = await sb.from('budgets').delete().eq('id', id);
  if (error) { toast(error.message, 'error'); return; }
  toast('Orçamento excluído', 'success');
  loadBudgets();
}

// ── Init ─────────────────────────────────────────────────────────────────────

function initBudgetsPage() {
  const now     = new Date();
  const monthEl = document.getElementById('budgetMonth');
  if (monthEl && !monthEl.value) monthEl.value = now.toISOString().slice(0, 7);
  _populateYearSelectors();
  _populateHistCat();
  _dbHasBudgetType   = null;
  _dbHasBudgetPaused = null;
  setBudgetView(_budgetView);
}
