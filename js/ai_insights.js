/* ═══════════════════════════════════════════════════════════════════════════
   AI INSIGHTS — Análise financeira inteligente + Chat financeiro
   Reutiliza a mesma infraestrutura Gemini já usada em receipt_ai.js e import_ai.js
   (RECEIPT_AI_KEY_SETTING, RECEIPT_AI_MODEL, getAppSetting)

   Módulos:
     1. Análise IA  — insights financeiros sobre dados pré-computados pelo app
     2. Chat IA     — perguntas em linguagem natural sobre suas finanças
     3. Enriquecimento — contexto adicional para classificação de transações

   Regra de ouro: a IA NUNCA calcula saldos/totais. Toda verdade financeira
   vem do app/banco. A IA apenas interpreta dados já computados.
═══════════════════════════════════════════════════════════════════════════ */

// ── Feature flag ──────────────────────────────────────────────────────────

async function isAiInsightsEnabled() {
  const famId = currentUser?.family_id;
  if (!famId) return false;
  const cacheKey = 'ai_insights_enabled_' + famId;
  if (window._familyFeaturesCache && cacheKey in window._familyFeaturesCache) {
    return !!window._familyFeaturesCache[cacheKey];
  }
  const val = await getAppSetting(cacheKey, false);
  return val === true || val === 'true';
}

async function applyAiInsightsFeature() {
  const on = await isAiInsightsEnabled();
  const navEl = document.getElementById('aiInsightsNav');
  if (navEl) navEl.style.display = on ? '' : 'none';
  _syncModulesSection?.();
}

// ── Estado do módulo ───────────────────────────────────────────────────────

const _ai = {
  // Filtros ativos da tela de Análise
  filters: { dateFrom: '', dateTo: '', memberId: '', accountId: '', categoryId: '', payeeId: '' },
  // Resultado da última análise
  analysisResult: null,
  // Histórico do chat
  chatHistory: [],
  // Contexto financeiro gerado pelo app (não pela IA)
  financialContext: null,
  // Loading states
  analysisLoading: false,
  chatLoading: false,
};

// ══════════════════════════════════════════════════════════════════════════
//  SEÇÃO 1 — INICIALIZAÇÃO DA PÁGINA
// ══════════════════════════════════════════════════════════════════════════

async function initAiInsightsPage() {
  const enabled = await isAiInsightsEnabled();
  const page    = document.getElementById('page-ai_insights');
  if (!page) return;

  if (!enabled) {
    page.innerHTML = `
      <div class="ai-disabled-state">
        <div class="ai-disabled-icon">🤖</div>
        <h3>AI Insights não ativado</h3>
        <p>O módulo de IA não está habilitado para esta família.<br>
           Solicite ao administrador para ativar em <strong>Configurações → Módulos da Família</strong>.</p>
      </div>`;
    return;
  }

  const apiKey = await getAppSetting(RECEIPT_AI_KEY_SETTING, '');
  if (!apiKey || !apiKey.startsWith('AIza')) {
    page.innerHTML = `
      <div class="ai-disabled-state">
        <div class="ai-disabled-icon">🔑</div>
        <h3>Chave Gemini não configurada</h3>
        <p>Configure a chave da API Gemini em <strong>Configurações → IA</strong> para usar os AI Insights.</p>
        <button class="btn btn-primary" onclick="showAiConfig()">Configurar IA</button>
      </div>`;
    return;
  }

  // Populate filter selects
  _aiPopulateFilters();

  // Set default date range (current month)
  const now = new Date();
  const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0');
  const dateFrom = document.getElementById('aiDateFrom');
  const dateTo   = document.getElementById('aiDateTo');
  if (dateFrom && !dateFrom.value) dateFrom.value = `${y}-${m}-01`;
  if (dateTo   && !dateTo.value)   dateTo.value   = `${y}-${m}-${String(new Date(y, now.getMonth()+1, 0).getDate()).padStart(2,'0')}`;

  // Show/hide tabs — start on Analysis tab
  _aiShowTab('analysis');

  // Render existing result if available
  if (_ai.analysisResult) _aiRenderAnalysis(_ai.analysisResult);
  if (_ai.chatHistory.length) _aiRenderChatHistory();
}

function _aiShowTab(tab) {
  ['analysis','chat'].forEach(t => {
    const btn   = document.getElementById('aiTab-' + t);
    const panel = document.getElementById('aiPanel-' + t);
    if (btn)   btn.classList.toggle('active', t === tab);
    if (panel) panel.style.display = t === tab ? '' : 'none';
  });
}

function _aiPopulateFilters() {
  // Members — use getFamilyMembers() from family_members_composition.js
  const memSel = document.getElementById('aiMemberFilter');
  if (memSel) {
    const allMembers = (typeof getFamilyMembers === 'function') ? getFamilyMembers() : [];
    memSel.innerHTML = '<option value="">Todos os membros</option>' +
      allMembers.map(m => `<option value="${esc(m.id || '')}">${esc(m.name || m.display_name || '—')}</option>`).join('');
  }

  // Accounts
  const accSel = document.getElementById('aiAccountFilter');
  if (accSel) {
    accSel.innerHTML = '<option value="">Todas as contas</option>' +
      (state.accounts || []).map(a => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');
  }

  // Categories
  const catSel = document.getElementById('aiCategoryFilter');
  if (catSel) {
    catSel.innerHTML = '<option value="">Todas as categorias</option>' +
      (state.categories || []).filter(c => !c.parent_id).map(c =>
        `<option value="${esc(c.id)}">${esc(c.name)}</option>`
      ).join('');
  }

  // Payees
  const paySel = document.getElementById('aiPayeeFilter');
  if (paySel) {
    paySel.innerHTML = '<option value="">Todos os beneficiários</option>' +
      (state.payees || []).slice(0, 200).map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  }
}

// ══════════════════════════════════════════════════════════════════════════
//  SEÇÃO 2 — COLETA E AGREGAÇÃO DE DADOS FINANCEIROS (pelo app, não pela IA)
// ══════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════
//  SEÇÃO 2 — COLETA E AGREGAÇÃO DE DADOS FINANCEIROS (pelo app, não pela IA)
// ══════════════════════════════════════════════════════════════════════════

async function _aiCollectFinancialContext() {
  const dateFrom   = document.getElementById('aiDateFrom')?.value   || '';
  const dateTo     = document.getElementById('aiDateTo')?.value     || '';
  const memberId   = document.getElementById('aiMemberFilter')?.value || '';
  const accountId  = document.getElementById('aiAccountFilter')?.value || '';
  const categoryId = document.getElementById('aiCategoryFilter')?.value || '';
  const payeeId    = document.getElementById('aiPayeeFilter')?.value   || '';

  // ── 1. Transações do período selecionado ─────────────────────────────
  let q = famQ(sb.from('transactions').select(
    'id,date,amount,amount_brl,brl_amount,is_transfer,is_card_payment,status,' +
    'description,memo,category_id,payee_id,account_id,transfer_to_account_id,' +
    'family_member_id,family_member_ids,currency,exchange_rate,check_number,tags'
  ).eq('status', 'confirmed'));

  if (dateFrom)   q = q.gte('date', dateFrom);
  if (dateTo)     q = q.lte('date', dateTo);
  if (accountId)  q = q.eq('account_id', accountId);
  if (payeeId)    q = q.eq('payee_id', payeeId);
  if (categoryId) q = q.eq('category_id', categoryId);
  q = q.order('date', { ascending: false }).limit(3000);

  const { data: txs, error } = await q;
  if (error) throw new Error('Erro ao carregar transações: ' + error.message);

  // ── 2. Histórico dos 12 meses anteriores ao período (para tendência) ─
  let histRows = [];
  if (dateFrom) {
    const histFrom = new Date(dateFrom);
    histFrom.setMonth(histFrom.getMonth() - 12);
    const histFromStr = histFrom.toISOString().slice(0, 10);
    const histDateTo  = new Date(dateFrom);
    histDateTo.setDate(histDateTo.getDate() - 1);
    const histToStr = histDateTo.toISOString().slice(0, 10);
    const { data: hd } = await famQ(sb.from('transactions').select(
      'id,date,amount,brl_amount,is_transfer,is_card_payment,category_id,payee_id,account_id,family_member_id,currency,exchange_rate'
    ).eq('status', 'confirmed')).gte('date', histFromStr).lte('date', histToStr)
      .order('date', { ascending: false }).limit(2000);
    histRows = hd || [];
  }

  // ── 3. Lookups ────────────────────────────────────────────────────────
  const catMap  = Object.fromEntries((state.categories || []).map(c => [c.id, { name: c.name, type: c.type, parent_id: c.parent_id, icon: c.icon }]));
  const payMap  = Object.fromEntries((state.payees     || []).map(p => [p.id, { name: p.name, type: p.type }]));
  const accMap  = Object.fromEntries((state.accounts   || []).map(a => [a.id, { name: a.name, currency: a.currency, type: a.type, is_credit_card: a.type === 'cartao_credito' }]));

  // ── 4. Classificação de cada transação ──────────────────────────────
  function _classifyTx(t) {
    const rawAmt = parseFloat(t.amount || 0);
    const brlVal = typeof txToBRL === 'function' ? txToBRL(t)
                 : parseFloat(t.brl_amount ?? t.amount_brl ?? t.amount ?? 0);
    const acc = accMap[t.account_id];
    const destAcc = t.transfer_to_account_id ? accMap[t.transfer_to_account_id] : null;

    // Cartão de crédito: o próprio gasto no cartão é despesa real
    // O pagamento da fatura (is_card_payment=true) é transferência contábil — NÃO é despesa
    if (t.is_card_payment) return { type: 'card_payment', brlAmt: Math.abs(brlVal), rawAmt };

    // Transferência entre contas da mesma família: não é receita nem despesa
    if (t.is_transfer) return { type: 'transfer', brlAmt: Math.abs(brlVal), rawAmt };

    // Ajuste de saldo: correção técnica — NÃO é receita nem despesa real
    const _desc = (t.description || '').trim().toLowerCase();
    if (_desc === 'ajuste de saldo' || _desc.startsWith('ajuste de saldo ')) {
      return { type: 'balance_adjustment', brlAmt: Math.abs(brlVal), rawAmt };
    }

    // Receita ou despesa
    if (rawAmt >= 0) return { type: 'income',  brlAmt: brlVal,            rawAmt };
    return             { type: 'expense', brlAmt: Math.abs(brlVal), rawAmt };
  }

  const rows = txs || [];
  const filtered = memberId ? rows.filter(t => t.family_member_id === memberId) : rows;

  // ── 5. Agregações do período ──────────────────────────────────────────
  let totalIncome = 0, totalExpense = 0;
  const byCategory  = {};
  const byPayee     = {};
  const byMember    = {};
  const byMemberCat = {};
  const byMemberPay = {};
  const byMemberInc = {};
  const byMonth     = {};
  // Agrupamento de gastos por cartão de crédito (fatura real vs pagamento)
  const cardSpend   = {}; // accId -> total gasto real no cartão
  const cardPayment = {}; // accId -> total pago de fatura
  let transferCount = 0, cardPaymentCount = 0;

  filtered.forEach(t => {
    const cls      = _classifyTx(t);
    const catInfo  = catMap[t.category_id] || {};
    const catName  = catInfo.name || 'Sem categoria';
    const payName  = payMap[t.payee_id]?.name || null;
    const memId    = t.family_member_id || null;
    const month    = (t.date || '').slice(0, 7);

    if (cls.type === 'transfer') {
      transferCount++;
      // Registra no byMonth mas separado — não some em despesas
      if (month) {
        if (!byMonth[month]) byMonth[month] = { income:0, expense:0, transfers:0, card_payments:0 };
        byMonth[month].transfers += cls.brlAmt;
      }
      return;
    }

    if (cls.type === 'card_payment') {
      cardPaymentCount++;
      // O pagamento de fatura vai para accMap do destino (o cartão)
      const destId = t.transfer_to_account_id || t.account_id;
      cardPayment[destId] = (cardPayment[destId] || 0) + cls.brlAmt;
      if (month) {
        if (!byMonth[month]) byMonth[month] = { income:0, expense:0, transfers:0, card_payments:0 };
        byMonth[month].card_payments += cls.brlAmt;
      }
      return;
    }

    // Gasto real no cartão de crédito (não é pagamento de fatura)
    if (accMap[t.account_id]?.is_credit_card && cls.type === 'expense') {
      cardSpend[t.account_id] = (cardSpend[t.account_id] || 0) + cls.brlAmt;
    }

    if (!byMonth[month]) byMonth[month] = { income:0, expense:0, transfers:0, card_payments:0 };

    if (cls.type === 'income') {
      totalIncome += cls.brlAmt;
      byMonth[month].income += cls.brlAmt;
      if (memId) byMemberInc[memId] = (byMemberInc[memId] || 0) + cls.brlAmt;
    } else {
      totalExpense += cls.brlAmt;
      byMonth[month].expense += cls.brlAmt;
      byCategory[catName] = (byCategory[catName] || 0) + cls.brlAmt;
      if (payName) byPayee[payName] = (byPayee[payName] || 0) + cls.brlAmt;
      if (memId) {
        byMember[memId] = (byMember[memId] || 0) + cls.brlAmt;
        if (!byMemberCat[memId]) byMemberCat[memId] = {};
        byMemberCat[memId][catName] = (byMemberCat[memId][catName] || 0) + cls.brlAmt;
        if (payName) {
          if (!byMemberPay[memId]) byMemberPay[memId] = {};
          byMemberPay[memId][payName] = (byMemberPay[memId][payName] || 0) + cls.brlAmt;
        }
      }
    }
  });

  // ── 6. Resumo de cartões de crédito ──────────────────────────────────
  const creditCardSummary = Object.entries(accMap)
    .filter(([,a]) => a.is_credit_card)
    .map(([id, a]) => ({
      account: a.name,
      real_spending:   +(cardSpend[id]   || 0).toFixed(2),
      invoice_payment: +(cardPayment[id] || 0).toFixed(2),
      note: 'O pagamento da fatura é uma transferência contábil e NÃO representa despesa adicional. A despesa real é o gasto no cartão.',
    }))
    .filter(c => c.real_spending > 0 || c.invoice_payment > 0);

  // ── 7. Histórico mensal (período + 12 meses anteriores) ──────────────
  // Agregar histórico
  const histByMonth = {};
  (histRows || []).forEach(t => {
    const cls   = _classifyTx(t);
    const month = (t.date || '').slice(0, 7);
    if (!month) return;
    if (!histByMonth[month]) histByMonth[month] = { income:0, expense:0 };
    if (cls.type === 'income')  histByMonth[month].income  += cls.brlAmt;
    if (cls.type === 'expense') histByMonth[month].expense += cls.brlAmt;
  });

  const monthlyTrend = Object.entries(byMonth)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, v]) => ({
      month,
      income:        +v.income.toFixed(2),
      expense:       +v.expense.toFixed(2),
      net:           +(v.income - v.expense).toFixed(2),
      transfers:     +v.transfers.toFixed(2),
      card_payments: +v.card_payments.toFixed(2),
    }));

  const historicalTrend = Object.entries(histByMonth)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, v]) => ({
      month,
      income:  +v.income.toFixed(2),
      expense: +v.expense.toFixed(2),
      net:     +(v.income - v.expense).toFixed(2),
    }));

  // Média mensal histórica (12 meses anteriores)
  const histAvgIncome  = historicalTrend.length ? historicalTrend.reduce((s,m)=>s+m.income,0)  / historicalTrend.length : null;
  const histAvgExpense = historicalTrend.length ? historicalTrend.reduce((s,m)=>s+m.expense,0) / historicalTrend.length : null;

  // ── 8. Topo de categorias, beneficiários e membros ───────────────────
  const topCategories = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1]).slice(0, 15)
    .map(([name, amount]) => ({ name, amount: +amount.toFixed(2), pct: totalExpense ? +(amount/totalExpense*100).toFixed(1) : 0 }));

  const topPayees = Object.entries(byPayee)
    .sort((a, b) => b[1] - a[1]).slice(0, 15)
    .map(([name, amount]) => ({ name, amount: +amount.toFixed(2) }));

  const memberMap = {};
  const _fmcMembers = (typeof getFamilyMembers === 'function') ? getFamilyMembers() : [];
  _fmcMembers.forEach(m => { memberMap[m.id] = m.name || m.display_name || '—'; });

  const memberInsights = Object.entries(byMember)
    .sort((a, b) => b[1] - a[1])
    .map(([id, expense]) => {
      const name = memberMap[id] || '—';
      if (name === '—') return null;
      return {
        id, name,
        expense: +expense.toFixed(2),
        income:  +(byMemberInc[id] || 0).toFixed(2),
        topCategories: Object.entries(byMemberCat[id] || {})
          .sort((a,b)=>b[1]-a[1]).slice(0,5)
          .map(([cat, amt]) => ({ name:cat, amount:+amt.toFixed(2), pct: expense>0?+(amt/expense*100).toFixed(1):0 })),
        topPayees: Object.entries(byMemberPay[id] || {})
          .sort((a,b)=>b[1]-a[1]).slice(0,5)
          .map(([pay, amt]) => ({ name:pay, amount:+amt.toFixed(2) })),
        amount: +expense.toFixed(2),
      };
    }).filter(Boolean);

  // ── 9. Transações programadas — detalhe completo ──────────────────────
  const _stSched = (state.scheduled || []).filter(s => s.status === 'active');

  // Frequências → fator mensal
  const _freqFactor = {
    once:0, weekly:4.33, biweekly:2.17, monthly:1, bimonthly:0.5,
    quarterly:0.33, semiannual:0.17, annual:1/12, custom:1,
  };
  function _monthlyFactor(freq, customInterval, customUnit) {
    if (freq === 'once') return 0;
    if (freq === 'custom' && customInterval && customUnit) {
      const unitToMonth = { days:30, weeks:4.33, months:1, years:1/12 };
      return (unitToMonth[customUnit] || 1) / customInterval;
    }
    return _freqFactor[freq] ?? 1;
  }
  function _schedAmt(s) { return Math.abs(parseFloat(s.brl_amount || s.amount || 0)); }

  // Categorizar programados: únicos, mensais, irregulares, anuais
  const schedOnce      = [];  // pagamento único
  const schedMonthly   = [];  // mensais exatos
  const schedRecurring = [];  // outras frequências regulares
  const schedByType    = { expense:0, income:0, transfer:0, card_payment:0 };
  const schedByCategory = {};

  _stSched.forEach(s => {
    const factor   = _monthlyFactor(s.frequency, s.custom_interval, s.custom_unit);
    const rawAmt   = _schedAmt(s);
    const monthAmt = rawAmt * factor;
    const stype    = s.type || (parseFloat(s.amount||0) < 0 ? 'expense' : 'income');
    const catName  = s.categories?.name || catMap[s.category_id]?.name || 'Sem categoria';
    const payName  = s.payees?.name || payMap[s.payee_id]?.name || null;

    const item = {
      description:    s.description,
      category:       catName,
      payee:          payName,
      type:           stype,
      frequency:      s.frequency,
      custom_interval: s.custom_interval || null,
      custom_unit:    s.custom_unit || null,
      amount:         +rawAmt.toFixed(2),
      monthly_equiv:  +monthAmt.toFixed(2),
      start_date:     s.start_date,
      end_date:       s.end_date || null,
      next_date:      typeof getNextOccurrence === 'function' ? getNextOccurrence(s) : null,
      account:        accMap[s.account_id]?.name || null,
      is_card_payment: stype === 'card_payment',
    };

    if (s.frequency === 'once') {
      schedOnce.push(item);
    } else if (s.frequency === 'monthly') {
      schedMonthly.push(item);
    } else {
      schedRecurring.push(item);
    }

    if (schedByType[stype] !== undefined) schedByType[stype] += monthAmt;
    if (!schedByCategory[catName]) schedByCategory[catName] = { income:0, expense:0 };
    if (stype === 'income')  schedByCategory[catName].income  += monthAmt;
    if (stype === 'expense') schedByCategory[catName].expense += monthAmt;
  });

  const recurringCommitments = {
    monthly_expense:  +schedByType.expense.toFixed(2),
    monthly_income:   +schedByType.income.toFixed(2),
    monthly_net:      +(schedByType.income - schedByType.expense).toFixed(2),
    by_category: Object.entries(schedByCategory)
      .map(([cat, v]) => ({ category:cat, monthly_income:+v.income.toFixed(2), monthly_expense:+v.expense.toFixed(2) }))
      .sort((a,b) => (b.monthly_expense+b.monthly_income) - (a.monthly_expense+a.monthly_income)),
  };

  // ── 9b. Projeção de gastos em cartões de crédito ───────────────────
  // Inclui apenas programados do tipo expense/income/once em contas cartão
  // NÃO inclui card_payment (pagamento de fatura) nem ajuste de saldo
  const ccAccIds = Object.entries(accMap)
    .filter(([, a]) => a.is_credit_card)
    .map(([id]) => id);

  const creditCardScheduledItems = _stSched.filter(s => {
    const isOnCcAcc = ccAccIds.includes(s.account_id);
    const isBillPayment = s.type === 'card_payment';
    return isOnCcAcc && !isBillPayment;
  });

  const _ccByCard = {};
  creditCardScheduledItems.forEach(s => {
    const accName = accMap[s.account_id]?.name || 'Cartão';
    if (!_ccByCard[accName]) _ccByCard[accName] = { items: [], monthly_total: 0 };
    const factor   = _monthlyFactor(s.frequency, s.custom_interval, s.custom_unit);
    const rawAmt   = _schedAmt(s);
    const monthly  = rawAmt * factor;
    const catName  = catMap[s.category_id]?.name || null;
    const nextDate = typeof getNextOccurrence === 'function' ? getNextOccurrence(s) : null;
    _ccByCard[accName].items.push({
      description:    s.description,
      category:       catName,
      type:           s.type,
      frequency:      s.frequency,
      amount:         +rawAmt.toFixed(2),
      monthly_equiv:  +monthly.toFixed(2),
      next_date:      nextDate,
      is_once:        s.frequency === 'once',
    });
    _ccByCard[accName].monthly_total += monthly;
  });

  const creditCardProjection = {
    note: 'Gastos programados em cartões de crédito. NÃO inclui pagamento de fatura (is_card_payment). Use para avaliar compromissos futuros no cartão.',
    cards: Object.entries(_ccByCard).map(([card, v]) => ({
      card,
      monthly_total:    +v.monthly_total.toFixed(2),
      scheduled_items:  v.items.sort((a,b) => b.monthly_equiv - a.monthly_equiv),
    })),
    grand_monthly_total: +Object.values(_ccByCard).reduce((s, v) => s + v.monthly_total, 0).toFixed(2),
  };

  // ── 10. Projeção mensal para 6 meses ─────────────────────────────────
  // Base: média dos últimos 3 meses do período (ou hist) para income/expense
  const recentMonths = monthlyTrend.slice(-3);
  const baseIncome  = recentMonths.length
    ? recentMonths.reduce((s,m)=>s+m.income,0)  / recentMonths.length
    : (histAvgIncome || totalIncome);
  const baseExpense = recentMonths.length
    ? recentMonths.reduce((s,m)=>s+m.expense,0) / recentMonths.length
    : (histAvgExpense || totalExpense);

  // Eventos futuros por mês: programados únicos e recorrentes
  const _today = new Date();
  const projMonths = [];

  // Breakdown por categoria no histórico recente (base para projeção)
  const _baseCatExpense = {}; // catName -> avg mensal
  const _baseCatIncome  = {};
  recentMonths.forEach(m => {
    // m não tem breakdown por cat — usamos topCategories ponderadas
  });
  // Distribuição proporcional de baseExpense por categoria (top categorias)
  const _catDistExp = {};
  const _catDistInc = {};
  if (topCategories.length && baseExpense > 0) {
    const topCatTotal = topCategories.reduce((s,c) => s + c.amount, 0) || 1;
    topCategories.forEach(c => {
      _catDistExp[c.name] = baseExpense * (c.amount / topCatTotal);
    });
  }
  // Receitas base
  if (baseIncome > 0) {
    _catDistInc['Receitas base'] = baseIncome;
  }

  for (let i = 1; i <= 6; i++) {
    const d   = new Date(_today.getFullYear(), _today.getMonth() + i, 1);
    const ym  = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
    const dEnd = new Date(d.getFullYear(), d.getMonth()+1, 0);
    const ymEnd = dEnd.toISOString().slice(0,10);

    // ── Programados únicos deste mês ──────────────────────────────────
    const onceThisMonth = schedOnce.filter(s =>
      s.next_date && s.next_date >= ym + '-01' && s.next_date <= ymEnd
    );

    let projExtraIncome = 0, projExtraExpense = 0;
    // Breakdown de categorias projetadas (base + programados)
    const projExpCat = { ...Object.fromEntries(Object.entries(_catDistExp).map(([k,v]) => [k, +v.toFixed(2)])) };
    const projIncCat = { ...Object.fromEntries(Object.entries(_catDistInc).map(([k,v]) => [k, +v.toFixed(2)])) };

    onceThisMonth.forEach(s => {
      if (s.type === 'income')  { projExtraIncome  += s.amount; projIncCat[s.category || s.description] = (projIncCat[s.category || s.description] || 0) + s.amount; }
      if (s.type === 'expense') { projExtraExpense += s.amount; projExpCat[s.category || s.description] = (projExpCat[s.category || s.description] || 0) + s.amount; }
    });

    schedMonthly.forEach(s => {
      if (s.type === 'income')  { projExtraIncome  += s.monthly_equiv; projIncCat[s.category || s.description] = (projIncCat[s.category || s.description] || 0) + s.monthly_equiv; }
      if (s.type === 'expense') { projExtraExpense += s.monthly_equiv; projExpCat[s.category || s.description] = (projExpCat[s.category || s.description] || 0) + s.monthly_equiv; }
    });

    schedRecurring.forEach(s => {
      if (s.type === 'income')  { projExtraIncome  += s.monthly_equiv; projIncCat[s.category || s.description] = (projIncCat[s.category || s.description] || 0) + s.monthly_equiv; }
      if (s.type === 'expense') { projExtraExpense += s.monthly_equiv; projExpCat[s.category || s.description] = (projExpCat[s.category || s.description] || 0) + s.monthly_equiv; }
    });

    const projIncome  = +(baseIncome  + projExtraIncome).toFixed(2);
    const projExpense = +(baseExpense + projExtraExpense).toFixed(2);

    projMonths.push({
      month:             ym,
      projected_income:  projIncome,
      projected_expense: projExpense,
      projected_net:     +(projIncome - projExpense).toFixed(2),
      one_time_events:   onceThisMonth.length,
      // Detalhamento para o painel de UI
      _detail: {
        one_time_items: onceThisMonth.map(s => ({
          description: s.description,
          category:    s.category,
          type:        s.type,
          amount:      s.amount,
          date:        s.next_date,
        })),
        expense_by_cat: Object.entries(projExpCat)
          .sort((a,b) => b[1]-a[1]).slice(0, 8)
          .map(([cat, amt]) => ({ cat, amt: +amt.toFixed(2) })),
        income_by_cat: Object.entries(projIncCat)
          .sort((a,b) => b[1]-a[1]).slice(0, 6)
          .map(([cat, amt]) => ({ cat, amt: +amt.toFixed(2) })),
        scheduled_items: [
          ...schedMonthly.filter(s => s.type==='expense' || s.type==='income').slice(0,6),
          ...schedRecurring.filter(s => s.type==='expense' || s.type==='income').slice(0,4),
        ].map(s => ({ description: s.description, amount: s.monthly_equiv, type: s.type, frequency: s.frequency, category: s.category })),
      },
    });
  }

  const financialProjection = {
    horizon:              '6 meses',
    months:               projMonths,
    base_monthly_income:  +baseIncome.toFixed(2),
    base_monthly_expense: +baseExpense.toFixed(2),
    historical_avg_income:  histAvgIncome  ? +histAvgIncome.toFixed(2)  : null,
    historical_avg_expense: histAvgExpense ? +histAvgExpense.toFixed(2) : null,
    trend_direction: projMonths.every(m=>m.projected_net>=0) ? 'positive'
                   : projMonths.every(m=>m.projected_net<0)  ? 'negative' : 'mixed',
    avg_projected_net: +(projMonths.reduce((s,m)=>s+m.projected_net,0)/projMonths.length).toFixed(2),
  };

  // ── 11. Top transações individuais (despesas e receitas reais) ────────
  const topTransactions = filtered
    .filter(t => { const cls = _classifyTx(t); return cls.type === 'expense' || cls.type === 'income'; })
    .map(t => {
      const cls = _classifyTx(t);
      return {
        date:        t.date,
        description: t.description || '—',
        amount_brl:  +cls.brlAmt.toFixed(2),
        type:        cls.type,
        category:    catMap[t.category_id]?.name || null,
        payee:       payMap[t.payee_id]?.name    || null,
        account:     accMap[t.account_id]?.name  || null,
        currency:    t.currency || 'BRL',
        memo:        t.memo || null,
        tags:        t.tags || null,
      };
    })
    .sort((a, b) => b.amount_brl - a.amount_brl)
    .slice(0, 40);

  // Lista de todas as transações do período (para chat / análise detalhada)
  const allTransactions = filtered
    .filter(t => { const cls = _classifyTx(t); return cls.type === 'expense' || cls.type === 'income'; })
    .map(t => {
      const cls = _classifyTx(t);
      return {
        date:        t.date,
        description: t.description || '—',
        amount_brl:  +cls.brlAmt.toFixed(2),
        type:        cls.type,
        category:    catMap[t.category_id]?.name || null,
        payee:       payMap[t.payee_id]?.name    || null,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  // ── 12. Saldos e resumo por conta ─────────────────────────────────────
  const accountBalances = (state.accounts || [])
    .filter(a => !accountId || a.id === accountId)
    .map(a => ({
      name:     a.name,
      balance:  +(a.balance || 0).toFixed(2),
      currency: a.currency,
      type:     a.type,
      is_credit_card: a.type === 'cartao_credito',
    }));

  const byAccount = {};
  filtered.forEach(t => {
    const cls     = _classifyTx(t);
    const accName = accMap[t.account_id]?.name || 'Desconhecida';
    if (!byAccount[accName]) byAccount[accName] = { income:0, expense:0, transfers:0 };
    if (cls.type === 'income')   byAccount[accName].income   += cls.brlAmt;
    if (cls.type === 'expense')  byAccount[accName].expense  += cls.brlAmt;
    if (cls.type === 'transfer') byAccount[accName].transfers += cls.brlAmt;
  });
  const accountSummary = Object.entries(byAccount).map(([name, v]) => ({
    name,
    income:    +v.income.toFixed(2),
    expense:   +v.expense.toFixed(2),
    net:       +(v.income - v.expense).toFixed(2),
    transfers: +v.transfers.toFixed(2),
  }));

  // ── 13. Anomalias ─────────────────────────────────────────────────────
  const anomalies = _aiDetectAnomalies(
    filtered, catMap, payMap,
    historicalTrend, byCategory
  );

  // ── 14. Orçamentos ────────────────────────────────────────────────────
  let budgetContext = null;
  try {
    if (typeof _rbtGetBudgetContext === 'function') {
      budgetContext = await _rbtGetBudgetContext();
    }
    if (!budgetContext) {
      const curMonth = new Date().toISOString().slice(0,7);
      const { data: bdata } = await famQ(
        sb.from('budgets').select('amount,category_id,categories(name)')
      ).eq('month', curMonth + '-01');
      if (bdata?.length) {
        const rawSpend = {};
        filtered.forEach(t => {
          const cls = _classifyTx(t);
          if (cls.type === 'expense' && t.category_id) {
            rawSpend[t.category_id] = (rawSpend[t.category_id]||0) + cls.brlAmt;
          }
        });
        budgetContext = {
          period: { type:'monthly', month: curMonth },
          budgets: bdata.map(b => {
            const limit = parseFloat(b.amount||0);
            const used  = rawSpend[b.category_id] || 0;
            return {
              category:  b.categories?.name || '—',
              limit:     +limit.toFixed(2),
              used:      +used.toFixed(2),
              available: +Math.max(0, limit - used).toFixed(2),
              pct:       limit > 0 ? +(used/limit*100).toFixed(1) : 0,
              over:      used > limit && limit > 0,
            };
          }),
        };
      }
    }
  } catch(_) {}

  const ctx = {
    period: { from: dateFrom || 'início', to: dateTo || 'hoje' },
    summary: {
      totalIncome:      +totalIncome.toFixed(2),
      totalExpense:     +totalExpense.toFixed(2),
      netResult:        +(totalIncome - totalExpense).toFixed(2),
      txCount:          filtered.filter(t => { const c=_classifyTx(t); return c.type==='income'||c.type==='expense'; }).length,
      transferCount,
      cardPaymentCount,
      note_transfers:   'Transferências entre contas foram EXCLUÍDAS das despesas e receitas — são movimentações internas.',
      note_card_payment:'Pagamentos de fatura de cartão foram EXCLUÍDOS das despesas — evitando dupla contagem com os gastos reais no cartão.',
    },
    topCategories,
    topPayees,
    memberInsights,
    monthlyTrend,
    historicalTrend,
    historicalAvg: {
      monthly_income:  histAvgIncome  ? +histAvgIncome.toFixed(2)  : null,
      monthly_expense: histAvgExpense ? +histAvgExpense.toFixed(2) : null,
    },
    scheduledItems: {
      once:      schedOnce.sort((a,b)=>{ const d=a.next_date||''; const e=b.next_date||''; return d.localeCompare(e); }),
      monthly:   schedMonthly.sort((a,b)=>b.monthly_equiv-a.monthly_equiv),
      recurring: schedRecurring.sort((a,b)=>b.monthly_equiv-a.monthly_equiv),
      total_count: _stSched.length,
    },
    recurringCommitments,
    financialProjection,
    creditCardSummary,
    creditCardProjection,
    accountBalances,
    accountSummary,
    topTransactions,
    allTransactions,
    anomalies,
    budgets: budgetContext,
    filters: { dateFrom, dateTo, memberId, accountId, categoryId, payeeId },
  };

  _ai.financialContext = ctx;
  return ctx;
}

function _aiDetectAnomalies(txs, catMap, payMap, historicalTrend, byCategory) {
  const payeeAmounts = {};
  txs.forEach(t => {
    const rawAmt = parseFloat(t.amount || 0);
    if (t.is_transfer || t.is_card_payment || rawAmt >= 0) return;
    const name = payMap[t.payee_id]?.name || 'Sem beneficiário';
    if (!payeeAmounts[name]) payeeAmounts[name] = [];
    const brl = typeof txToBRL === 'function' ? txToBRL(t) : parseFloat(t.brl_amount ?? t.amount ?? 0);
    payeeAmounts[name].push(Math.abs(brl));
  });

  const anomalies = [];

  // Gastos acima de 2.5x a média com o mesmo beneficiário
  Object.entries(payeeAmounts).forEach(([payee, amounts]) => {
    if (amounts.length < 2) return;
    const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const max = Math.max(...amounts);
    if (max > avg * 2.5 && max > 50) {
      anomalies.push({ type:'high_spend', payee, average:+avg.toFixed(2), max:+max.toFixed(2) });
    }
  });

  // Comparação com média histórica por categoria
  if (historicalTrend?.length >= 3 && byCategory) {
    // (extendable: compare current period per-category vs historical average)
  }

  return anomalies.slice(0, 8);
}

// ══════════════════════════════════════════════════════════════════════════
//  SEÇÃO 3 — ANÁLISE IA
// ══════════════════════════════════════════════════════════════════════════

async function runAiAnalysis() {
  if (_ai.analysisLoading) return;

  const apiKey = await getAppSetting(RECEIPT_AI_KEY_SETTING, '');
  if (!apiKey || !apiKey.startsWith('AIza')) {
    toast(t('ai.no_api_key_config'), 'warning');
    showAiConfig();
    return;
  }

  _ai.analysisLoading = true;
  _aiSetAnalysisState('loading');

  try {
    const ctx    = await _aiCollectFinancialContext();
    const result = await _callGeminiAnalysis(apiKey, ctx);
    _ai.analysisResult = result;
    _aiRenderAnalysis(result);
    toast(t('ai.analysis_done'), 'success');
  } catch (e) {
    _aiSetAnalysisState('error', e.message);
    toast('Erro na análise: ' + e.message, 'error');
    console.error('[AIInsights] analysis error:', e);
  } finally {
    _ai.analysisLoading = false;
  }
}

function _aiSetAnalysisState(state, msg) {
  const container = document.getElementById('aiAnalysisResult');
  if (!container) return;

  if (state === 'loading') {
    container.innerHTML = `
      <div class="ai-loading">
        <div class="ai-loading-spinner"></div>
        <p>Analisando seus dados financeiros com IA…</p>
        <span class="ai-loading-sub">Coletando dados do app → enviando para Gemini → interpretando…</span>
      </div>`;
  } else if (state === 'error') {
    container.innerHTML = `
      <div class="ai-error-state">
        <span class="ai-error-icon">⚠️</span>
        <p><strong>Erro na análise</strong></p>
        <p class="ai-error-msg">${esc(msg || 'Tente novamente.')}</p>
        <button class="btn btn-ghost btn-sm" onclick="runAiAnalysis()">↺ Tentar novamente</button>
      </div>`;
  } else if (state === 'empty') {
    container.innerHTML = `
      <div class="ai-empty-state">
        <span style="font-size:2rem">🔍</span>
        <p>Nenhuma transação encontrada no período selecionado.</p>
        <p class="ai-loading-sub">Ajuste os filtros e tente novamente.</p>
      </div>`;
  }
}

async function _callGeminiAnalysis(apiKey, ctx) {
  const promptData = {
    periodo:          ctx.period,
    resumo_financeiro: {
      ...ctx.summary,
      aviso_metodologia: [
        'TRANSFERÊNCIAS ENTRE CONTAS: NÃO são receitas nem despesas. São movimentações internas.',
        'PAGAMENTO DE FATURA DE CARTÃO: NÃO é despesa. O gasto real já está registrado como despesa no cartão.',
        'GASTOS NO CARTÃO DE CRÉDITO: SÃO despesas reais e constam em topCategorias/topBeneficiarios.',
        'AJUSTE DE SALDO (type=balance_adjustment): Correção técnica. NÃO é receita nem despesa. IGNORAR no prognóstico.',
      ],
    },
    top_categorias_despesa: ctx.topCategories,
    top_beneficiarios:       ctx.topPayees,
    por_membro_familia:      ctx.memberInsights,
    tendencia_mensal_periodo: ctx.monthlyTrend,
    historico_12_meses:       ctx.historicalTrend,
    media_historica_mensal:   ctx.historicalAvg,
    cartoes_credito:          ctx.creditCardSummary,
    programados: {
      pagamentos_unicos:         ctx.scheduledItems?.once     || [],
      recorrentes_mensais:       ctx.scheduledItems?.monthly  || [],
      recorrentes_outras_frequencias: ctx.scheduledItems?.recurring || [],
      total_programados_ativos:  ctx.scheduledItems?.total_count || 0,
      compromissos_mensais:      ctx.recurringCommitments,
    },
    projecao_cartoes_credito:  ctx.creditCardProjection,
    projecao_6_meses:          ctx.financialProjection,
    saldos_contas:             ctx.accountBalances,
    resumo_por_conta:          ctx.accountSummary,
    orcamentos:                ctx.budgets,
    anomalias_detectadas:      ctx.anomalies,
    top_40_transacoes:         ctx.topTransactions,
  };

  const prompt = `Você é um consultor financeiro pessoal sênior analisando as finanças de uma família brasileira.
Os dados abaixo foram COMPUTADOS pelo sistema (valores em BRL) e são 100% precisos. Sua função é INTERPRETAR e PROGNOSTICAR, nunca recalcular.
Responda SOMENTE com JSON válido, sem markdown, sem texto antes ou depois.

═══ REGRAS CRÍTICAS DE ANÁLISE ═══
1. TRANSFERÊNCIAS ENTRE CONTAS (is_transfer=true): NÃO são receitas nem despesas. São apenas movimentações internas entre contas da mesma família. IGNORE-AS nas despesas.
2. PAGAMENTO DE FATURA DE CARTÃO (is_card_payment=true): NÃO é despesa adicional. É uma transferência contábil para pagar o cartão. Os gastos REAIS já estão registrados como despesas individuais no cartão. NUNCA some pagamento de fatura + gastos no cartão — isso geraria dupla contagem.
3. GASTOS NO CARTÃO DE CRÉDITO: SÃO despesas reais. Já estão em top_categorias_despesa e top_beneficiarios.
4. O campo creditCardSummary mostra: real_spending (despesa real) vs invoice_payment (pagamento da fatura). Use apenas real_spending para análise de gastos.
5. AJUSTE DE SALDO (type='balance_adjustment'): São correções técnicas de registro. NÃO são receita nem despesa. NUNCA mencione ajustes de saldo como padrão de gastos, receita ou tendência no prognóstico.

═══ REGRAS DE PROGNÓSTICO ═══
6. Para PAGAMENTOS ÚNICOS (pagamentos_unicos): considere o impacto PONTUAL no mês em que ocorrem — NÃO os trate como recorrentes mensais no prognóstico nem na tendência.
7. Para RECORRENTES MENSAIS (recorrentes_mensais): some ao fluxo mensal projetado de forma consistente.
8. Para RECORRENTES OUTRAS FREQUÊNCIAS (recorrentes_outras_frequencias): use monthly_equiv para distribuição mensal, mas destaque meses com picos (ex: pagamento trimestral).
9. A projeção já considera a base histórica + programados. Analise se o prognóstico é sustentável.
10. Use historico_12_meses para identificar sazonalidade e comparar o período atual com a média histórica.

═══ ANÁLISE OBRIGATÓRIA DE CARTÕES DE CRÉDITO ═══
11. O campo projecao_cartoes_credito contém gastos PROGRAMADOS em cartões (NÃO inclui pagamento de fatura).
12. Inclua OBRIGATORIAMENTE a seção "credit_card_projection" no JSON de resposta com:
    - Análise dos gastos programados por cartão
    - Avaliação de sustentabilidade (gastos vs receita recorrente mensal)
    - Alerta se total projetado supera 30% da receita recorrente mensal
    - Identificação de gastos únicos vs recorrentes no cartão

DADOS FINANCEIROS — PERÍODO ${ctx.period.from} a ${ctx.period.to}:
${JSON.stringify(promptData, null, 0)}

RETORNE EXATAMENTE ESTE JSON (todos os textos em português brasileiro):
{
  "summary": "2-3 frases resumindo o período de forma clara e humana",
  "overview": {
    "income_comment": "comentário sobre as receitas (máx 1 frase)",
    "expense_comment": "comentário sobre as despesas REAIS — excluindo transferências e pagamentos de fatura (máx 1 frase)",
    "net_comment": "avaliação do resultado líquido (máx 1 frase)"
  },
  "member_insights": [
    { "name": "nome", "insight": "observação personalizada sobre os gastos deste membro" }
  ],
  "category_insights": [
    { "category": "nome", "insight": "o que este padrão indica", "action": "sugestão concreta (opcional)" }
  ],
  "anomalies": [
    { "title": "título curto", "description": "descrição do detectado", "severity": "low|medium|high" }
  ],
  "savings_opportunities": [
    { "title": "oportunidade", "description": "como economizar", "estimated_saving": "ex: R$150/mês" }
  ],
  "recommendations": [
    { "title": "recomendação", "description": "ação concreta", "priority": "high|medium|low" }
  ],
  "cashflow_alerts": [
    { "type": "warning|info|ok", "message": "alerta de fluxo de caixa" }
  ],
  "chart_suggestions": [
    { "type": "bar|pie|line|donut", "title": "título", "rationale": "por que este gráfico seria útil" }
  ],
  "classification_suggestions": [
    {
      "description": "descrição da transação sem categoria clara",
      "suggested_category": "categoria sugerida",
      "suggested_payee": "beneficiário normalizado",
      "purpose": "propósito inferido",
      "confidence": 0.85,
      "explanation": "justificativa breve"
    }
  ],
  "forecast": {
    "outlook": "resumo executivo em 2-3 frases do prognóstico para os próximos meses — considerando histórico, sazonalidade e programados",
    "trend": "positive|negative|mixed|stable",
    "risk_level": "low|medium|high",
    "methodology_note": "explique brevemente como o prognóstico foi calculado (base histórica + programados)",
    "monthly_commitment_insight": "análise dos compromissos mensais fixos e seu impacto no fluxo de caixa",
    "one_time_payment_alerts": [
      { "month": "YYYY-MM", "description": "pagamento único relevante neste mês", "amount_approx": 0, "impact": "alto|médio|baixo" }
    ],
    "seasonality_insight": "padrões sazonais identificados no histórico de 12 meses (se houver dados históricos)",
    "projection_highlights": [
      { "month": "YYYY-MM", "highlight": "observação relevante sobre este mês projetado" }
    ],
    "key_risks": [
      { "risk": "descrição do risco", "mitigation": "como mitigar" }
    ],
    "opportunities": [
      { "opportunity": "oportunidade identificada", "action": "ação recomendada" }
    ],
    "card_credit_note": "análise específica dos gastos em cartão de crédito vs pagamentos de fatura (se aplicável)"
  },
  "credit_card_projection": {
    "summary": "análise geral dos compromissos programados em cartões de crédito",
    "sustainability": "ok|warning|critical",
    "sustainability_note": "avaliação se os gastos projetados no cartão são sustentáveis com a receita recorrente",
    "total_monthly_projected": 0,
    "pct_of_recurring_income": 0,
    "cards": [
      {
        "card": "nome do cartão",
        "monthly_total": 0,
        "highlights": "principais gastos programados neste cartão",
        "one_time_items": "gastos únicos relevantes (se houver)",
        "alert": "alerta específico para este cartão (se aplicável)"
      }
    ],
    "recommendations": ["recomendação 1 sobre uso do cartão", "recomendação 2"]
  },
  "budget_analysis": [
    { "category": "nome", "status": "ok|near|over", "insight": "análise do orçamento" }
  ]
}

REGRAS FINAIS:
- NÃO invente números — use apenas os dados fornecidos
- Seja específico e acionável, não genérico
- Contexto brasileiro (BRL, hábitos locais, sazonalidade brasileira)
- member_insights: lista vazia se não houver dados por membro
- classification_suggestions: máx 5, apenas sem categoria ou categoria genérica
- forecast.projection_highlights: máx 4, apenas meses com algo relevante
- forecast.one_time_payment_alerts: apenas pagamentos únicos relevantes (>R$200)
- budget_analysis: lista vazia se não houver orçamentos
- Todos os textos em português brasileiro`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${RECEIPT_AI_MODEL}:generateContent?key=${apiKey}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 6000, temperature: 0.2 },
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    const msg = err?.error?.message || `HTTP ${resp.status}`;
    if (resp.status === 429) throw new Error('Limite de requisições atingido. Aguarde alguns segundos.');
    throw new Error(msg);
  }

  const data  = await resp.json();
  const text  = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const clean = text.replace(/```json|```/g, '').trim();

  let parsed;
  try { parsed = JSON.parse(clean); }
  catch { throw new Error('Resposta inválida da IA'); }

  return parsed;
}


// ── Renderização da análise ───────────────────────────────────────────────

// Converte frequência interna em label legível
function _fmtFreqLabel(freq) {
  return { once:'único', weekly:'semanal', biweekly:'quinzenal', monthly:'mensal',
           bimonthly:'bimestral', quarterly:'trimestral', semiannual:'semestral',
           annual:'anual', custom:'personalizado' }[freq] || freq || '';
}

// Toggle do painel de detalhe mensal no prognóstico
function _aiToggleProjMonth(ym) {
  const det  = document.getElementById('air-proj-detail-' + ym);
  const chev = document.getElementById('air-proj-chev-' + ym);
  if (!det) return;
  const open = det.style.display !== 'none';
  det.style.display = open ? 'none' : '';
  if (chev) chev.textContent = open ? '▼' : '▲';
}
window._aiToggleProjMonth = _aiToggleProjMonth;

// ── Member card toggle ─────────────────────────────────────────────────────
function _aiToggleMember(idx) {
  const body  = document.getElementById('ai-mem-body-' + idx);
  const chev  = document.getElementById('ai-mem-chev-' + idx);
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : '';
  if (chev) chev.textContent = open ? '▼' : '▲';
}
window._aiToggleMember = _aiToggleMember;


function _aiRenderAnalysis(r) {
  const container = document.getElementById('aiAnalysisResult');
  if (!container || !r) return;

  const ctx = _ai.financialContext;
  const fmtN = (v) => 'R$ ' + (parseFloat(v)||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});

  // ── Score de saúde financeira (0-100) ──────────────────────────────────
  let healthScore = 50;
  if (ctx) {
    const net = ctx.summary.netResult;
    const inc = ctx.summary.totalIncome || 1;
    const savRate = net / inc;
    if (savRate >= 0.30) healthScore = 92;
    else if (savRate >= 0.20) healthScore = 80;
    else if (savRate >= 0.10) healthScore = 68;
    else if (savRate >= 0)    healthScore = 55;
    else if (savRate >= -0.10) healthScore = 38;
    else healthScore = 22;
    // bonus/malus from AI
    if (r.forecast?.risk_level === 'low')    healthScore = Math.min(100, healthScore + 8);
    if (r.forecast?.risk_level === 'high')   healthScore = Math.max(0,   healthScore - 12);
    if (r.anomalies?.length > 2)             healthScore = Math.max(0,   healthScore - 6);
  }
  const healthColor = healthScore >= 75 ? '#22c55e' : healthScore >= 50 ? '#f59e0b' : '#ef4444';
  const healthLabel = healthScore >= 75 ? 'Saudável' : healthScore >= 50 ? 'Atenção' : 'Crítico';
  const healthEmoji = healthScore >= 75 ? '💚' : healthScore >= 50 ? '💛' : '❤️';

  // ── Trend icon & forecast ─────────────────────────────────────────────
  const trendDir = r.forecast?.trend || ctx?.financialProjection?.trend_direction || 'stable';
  const trendMeta = {
    positive: { icon:'📈', label:'Tendência positiva', color:'#22c55e' },
    negative: { icon:'📉', label:'Tendência negativa', color:'#ef4444' },
    mixed:    { icon:'↕️', label:'Tendência mista',    color:'#f59e0b' },
    stable:   { icon:'➡️', label:'Estável',            color:'#60a5fa' },
  }[trendDir] || { icon:'📊', label:'Análise', color:'#60a5fa' };

  // ── Hero card ─────────────────────────────────────────────────────────
  const net      = ctx?.summary?.netResult ?? 0;
  const netColor = net >= 0 ? '#22c55e' : '#ef4444';
  const netLabel = net >= 0 ? 'Superávit' : 'Déficit';

  const circleCircumference = 2 * Math.PI * 38; // r=38
  const circleOffset = circleCircumference * (1 - healthScore/100);

  let heroHtml = `
<div class="air-hero">
  <div class="air-hero-glow"></div>
  <div class="air-hero-content">
    <!-- Score gauge -->
    <div class="air-score-wrap">
      <svg class="air-score-svg" viewBox="0 0 100 100" width="100" height="100">
        <circle cx="50" cy="50" r="38" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="7"/>
        <circle cx="50" cy="50" r="38" fill="none" stroke="${healthColor}" stroke-width="7"
          stroke-dasharray="${circleCircumference.toFixed(1)}"
          stroke-dashoffset="${circleOffset.toFixed(1)}"
          stroke-linecap="round"
          transform="rotate(-90 50 50)"
          class="air-score-arc"/>
        <text x="50" y="46" text-anchor="middle" fill="#fff" font-size="18" font-weight="800" font-family="inherit">${healthScore}</text>
        <text x="50" y="60" text-anchor="middle" fill="rgba(255,255,255,.6)" font-size="8" font-family="inherit">/ 100</text>
      </svg>
      <div class="air-score-label" style="color:${healthColor}">${healthEmoji} ${healthLabel}</div>
    </div>
    <!-- KPIs -->
    <div class="air-hero-kpis">
      ${ctx ? `
      <div class="air-hero-kpi">
        <span class="air-hero-kpi-lbl">Receitas</span>
        <span class="air-hero-kpi-val air-green">${fmtN(ctx.summary.totalIncome)}</span>
      </div>
      <div class="air-hero-kpi">
        <span class="air-hero-kpi-lbl">Despesas</span>
        <span class="air-hero-kpi-val air-red">${fmtN(ctx.summary.totalExpense)}</span>
      </div>
      <div class="air-hero-kpi">
        <span class="air-hero-kpi-lbl">${netLabel}</span>
        <span class="air-hero-kpi-val" style="color:${netColor}">${fmtN(Math.abs(net))}</span>
      </div>
      <div class="air-hero-kpi">
        <span class="air-hero-kpi-lbl">Transações</span>
        <span class="air-hero-kpi-val">${ctx.summary.txCount}</span>
      </div>` : ''}
    </div>
    <!-- Trend badge -->
    <div class="air-trend-badge" style="color:${trendMeta.color};background:${trendMeta.color}18;border-color:${trendMeta.color}33">
      ${trendMeta.icon} ${trendMeta.label}
    </div>
  </div>
</div>`;

  // ── AI Summary card — the "voice" of the AI ───────────────────────────
  let aiVoiceHtml = '';
  if (r.summary) {
    aiVoiceHtml = `
<div class="air-voice-card">
  <div class="air-voice-icon">🤖</div>
  <div class="air-voice-body">
    <div class="air-voice-label">Análise Gemini</div>
    <p class="air-voice-text">${esc(r.summary)}</p>
    ${r.overview ? `<div class="air-pills-row">
      ${r.overview.income_comment  ? `<div class="air-pill air-pill-g">💰 ${esc(r.overview.income_comment)}</div>` : ''}
      ${r.overview.expense_comment ? `<div class="air-pill air-pill-r">💸 ${esc(r.overview.expense_comment)}</div>` : ''}
      ${r.overview.net_comment     ? `<div class="air-pill air-pill-b">📈 ${esc(r.overview.net_comment)}</div>` : ''}
    </div>` : ''}
  </div>
</div>`;
  }

  // ── Forecast banner ───────────────────────────────────────────────────
  let forecastBannerHtml = '';
  const fc = r.forecast;
  const proj = ctx?.financialProjection;
  const rcm  = ctx?.recurringCommitments;
  if (fc || proj) {
    const riskLevel = fc?.risk_level || 'medium';
    const riskMeta = {
      low:    { color:'#22c55e', bg:'#052e16', label:'Risco Baixo',  icon:'🛡️' },
      medium: { color:'#f59e0b', bg:'#1c1001', label:'Risco Médio',  icon:'⚡' },
      high:   { color:'#ef4444', bg:'#1c0000', label:'Risco Alto',   icon:'🔥' },
    }[riskLevel] || { color:'#60a5fa', bg:'#0c1a2e', label:'', icon:'📊' };

    // ── KPIs de compromissos recorrentes ─────────────────────────────
    let rcmKpis = '';
    if (rcm?.monthly_expense || rcm?.monthly_income) {
      const rcmNetColor = rcm.monthly_net >= 0 ? '#22c55e' : '#ef4444';
      rcmKpis = `<div class="air-rcm-strip">
        <div class="air-rcm-kpi"><span>Receita recorrente/mês</span><strong class="air-green">${fmtN(rcm.monthly_income)}</strong></div>
        <div class="air-rcm-kpi"><span>Despesa recorrente/mês</span><strong class="air-red">${fmtN(rcm.monthly_expense)}</strong></div>
        <div class="air-rcm-kpi"><span>Resultado recorrente</span><strong style="color:${rcmNetColor}">${fmtN(rcm.monthly_net)}</strong></div>
      </div>`;
    }

    // ── Tabela de projeção mensal com detalhamento ────────────────────
    let projHtml = '';
    if (proj?.months?.length) {
      const months = proj.months;

      // Cabeçalho resumo (sempre visível)
      const summaryRows = months.map(m => {
        const isPos = m.projected_net >= 0;
        const hasOnce = m.one_time_events > 0;
        return `<div class="air-proj-row ${hasOnce ? 'air-proj-row-has-once' : ''}" onclick="_aiToggleProjMonth('${m.month}')" style="cursor:pointer">
          <span class="air-proj-month">
            ${m.month}
            ${hasOnce ? `<span class="air-proj-once-badge" title="${m.one_time_events} evento(s) único(s)">★${m.one_time_events}</span>` : ''}
          </span>
          <span class="air-proj-val air-green">${fmtN(m.projected_income)}</span>
          <span class="air-proj-val air-red">${fmtN(m.projected_expense)}</span>
          <span class="air-proj-net" style="color:${isPos?'#22c55e':'#ef4444'}">${isPos?'+':''}${fmtN(m.projected_net)}</span>
          <span class="air-proj-chevron" id="air-proj-chev-${m.month}">▼</span>
        </div>
        <div class="air-proj-detail" id="air-proj-detail-${m.month}" style="display:none">
          <div class="air-proj-detail-inner">
            ${(() => {
              const det = m._detail;
              if (!det) return '';
              let html = '';

              // Eventos únicos deste mês
              if (det.one_time_items?.length) {
                html += `<div class="air-proj-det-section">
                  <div class="air-proj-det-title">★ Eventos únicos em ${m.month}</div>
                  ${det.one_time_items.map(e => `
                    <div class="air-proj-det-row">
                      <span class="air-proj-det-icon">${e.type==='income'?'💰':'💸'}</span>
                      <span class="air-proj-det-label">${esc(e.description)}${e.category ? ` <em>(${esc(e.category)})</em>` : ''}</span>
                      <span class="air-proj-det-amt ${e.type==='income'?'air-green':'air-red'}">${fmtN(e.amount)}</span>
                    </div>`).join('')}
                </div>`;
              }

              // Detalhamento de despesas por categoria
              if (det.expense_by_cat?.length) {
                const totalExp = det.expense_by_cat.reduce((s,c)=>s+c.amt,0) || 1;
                html += `<div class="air-proj-det-section">
                  <div class="air-proj-det-title">💸 Despesas projetadas por categoria</div>
                  ${det.expense_by_cat.map(c => {
                    const pct = (c.amt / totalExp * 100).toFixed(0);
                    return `<div class="air-proj-det-row">
                      <span class="air-proj-det-icon">📁</span>
                      <span class="air-proj-det-label">${esc(c.cat)}</span>
                      <div class="air-proj-det-bar-wrap">
                        <div class="air-proj-det-bar" style="width:${pct}%;background:#ef4444"></div>
                      </div>
                      <span class="air-proj-det-pct">${pct}%</span>
                      <span class="air-proj-det-amt air-red">${fmtN(c.amt)}</span>
                    </div>`;
                  }).join('')}
                </div>`;
              }

              // Detalhamento de receitas por origem
              if (det.income_by_cat?.length) {
                const totalInc = det.income_by_cat.reduce((s,c)=>s+c.amt,0) || 1;
                html += `<div class="air-proj-det-section">
                  <div class="air-proj-det-title">💰 Receitas projetadas por origem</div>
                  ${det.income_by_cat.map(c => {
                    const pct = (c.amt / totalInc * 100).toFixed(0);
                    return `<div class="air-proj-det-row">
                      <span class="air-proj-det-icon">📥</span>
                      <span class="air-proj-det-label">${esc(c.cat)}</span>
                      <div class="air-proj-det-bar-wrap">
                        <div class="air-proj-det-bar" style="width:${pct}%;background:#22c55e"></div>
                      </div>
                      <span class="air-proj-det-pct">${pct}%</span>
                      <span class="air-proj-det-amt air-green">${fmtN(c.amt)}</span>
                    </div>`;
                  }).join('')}
                </div>`;
              }

              // Programados que compõem a projeção (apenas no primeiro mês expandido, não repete)
              if (det.scheduled_items?.length) {
                html += `<div class="air-proj-det-section">
                  <div class="air-proj-det-title">🔁 Programados incluídos na projeção</div>
                  ${det.scheduled_items.map(s => `
                    <div class="air-proj-det-row">
                      <span class="air-proj-det-icon">${s.type==='income'?'💰':'💸'}</span>
                      <span class="air-proj-det-label">${esc(s.description)}${s.category?` <em>(${esc(s.category)})</em>`:''} <span class="air-proj-det-freq">${_fmtFreqLabel(s.frequency)}</span></span>
                      <span class="air-proj-det-amt ${s.type==='income'?'air-green':'air-red'}">${fmtN(s.amount)}/mês</span>
                    </div>`).join('')}
                </div>`;
              }

              return html || '<div class="air-proj-det-empty">Sem detalhamento adicional.</div>';
            })()}
          </div>
        </div>`;
      }).join('');

      projHtml = `
      <div class="air-proj-table">
        <div class="air-proj-header">
          <span>Mês</span><span>Receitas</span><span>Despesas</span><span>Resultado</span><span></span>
        </div>
        ${summaryRows}
      </div>
      <div style="font-size:.7rem;color:rgba(255,255,255,.4);margin-top:6px;text-align:center">
        Clique em cada mês para ver o detalhamento de receitas e despesas
      </div>`;
    }

    // ── Análise IA: riscos e oportunidades ────────────────────────────
    let keyRisksHtml = (fc?.key_risks||[]).map(k => `
      <div class="air-risk-item">
        <span class="air-risk-bullet">▸</span>
        <div><strong>${esc(k.risk)}</strong>${k.mitigation?`<span class="air-risk-mit"> — ${esc(k.mitigation)}</span>`:''}</div>
      </div>`).join('');

    let oppsHtml = (fc?.opportunities||[]).map(o => `
      <div class="air-opp-item">
        <span class="air-opp-bullet">✦</span>
        <div><strong>${esc(o.opportunity)}</strong>${o.action?`<span class="air-opp-act"> — ${esc(o.action)}</span>`:''}</div>
      </div>`).join('');

    // ── Alertas de eventos únicos ─────────────────────────────────────
    let onceAlertsHtml = '';
    const onceAlerts = fc?.one_time_payment_alerts || [];
    if (onceAlerts.length) {
      onceAlertsHtml = `<div class="air-forecast-section-title">★ Pagamentos únicos relevantes</div>
        <div class="air-once-list">
          ${onceAlerts.map(a => `
            <div class="air-once-item">
              <span class="air-once-month">${a.month}</span>
              <span class="air-once-desc">${esc(a.description)}</span>
              <span class="air-once-impact air-once-${a.impact||'medio'}">${a.impact||'—'}</span>
            </div>`).join('')}
        </div>`;
    }

    // ── Insight de sazonalidade da IA ─────────────────────────────────
    let seasonHtml = '';
    if (fc?.seasonality_insight) {
      seasonHtml = `<div class="air-forecast-section-title">📅 Sazonalidade</div>
        <div class="air-season-insight">${esc(fc.seasonality_insight)}</div>`;
    }

    forecastBannerHtml = `
<div class="air-forecast" style="--fc:${riskMeta.color};--fcbg:${riskMeta.bg}">
  <div class="air-forecast-head">
    <span class="air-forecast-icon">${trendMeta.icon}</span>
    <div style="flex:1;min-width:0">
      <div class="air-forecast-title">Prognóstico Financeiro — 6 meses</div>
      ${fc?.outlook ? `<p class="air-forecast-outlook">${esc(fc.outlook)}</p>` : ''}
    </div>
    <span class="air-risk-chip" style="color:${riskMeta.color}">${riskMeta.icon} ${riskMeta.label}</span>
  </div>
  ${rcmKpis}
  ${projHtml}
  ${onceAlertsHtml}
  ${seasonHtml}
  ${keyRisksHtml ? `<div class="air-forecast-section-title">⚠️ Riscos</div><div class="air-risks-list">${keyRisksHtml}</div>` : ''}
  ${oppsHtml ? `<div class="air-forecast-section-title">🎯 Oportunidades</div><div class="air-opps-list">${oppsHtml}</div>` : ''}
</div>`;
  }

  // ── Alerts — priority strip ───────────────────────────────────────────
  let alertsHtml = '';
  const allAlerts = [
    ...(r.cashflow_alerts||[]).map(a => ({...a, src:'cashflow'})),
    ...(r.anomalies||[]).map(a => ({type:a.severity==='high'?'warning':'info', message:`${a.title}: ${a.description}`, src:'anomaly'})),
  ];
  if (allAlerts.length) {
    alertsHtml = `
<div class="air-alerts-strip">
  ${allAlerts.map(a => {
    const meta = {
      warning: { icon:'⚠️', cls:'air-alert-w' },
      info:    { icon:'ℹ️', cls:'air-alert-i' },
      ok:      { icon:'✅', cls:'air-alert-ok' },
    }[a.type||'info'] || { icon:'ℹ️', cls:'air-alert-i' };
    return `<div class="air-alert-pill ${meta.cls}">${meta.icon} ${esc(a.message)}</div>`;
  }).join('')}
</div>`;
  }

  // ── Savings + Recommendations ─────────────────────────────────────────
  const allActions = [
    ...(r.savings_opportunities||[]).map(s=>({type:'saving', title:s.title, desc:s.description, extra:s.estimated_saving})),
    ...(r.recommendations||[]).map(rc=>({type:rc.priority||'medium', title:rc.title, desc:rc.description, extra:null})),
  ];
  let actionsHtml = '';
  if (allActions.length) {
    actionsHtml = `
<div class="air-section">
  <div class="air-section-title">💡 Recomendações & Oportunidades</div>
  <div class="air-actions-grid">
    ${allActions.map((a,i) => {
      const isSaving = a.type === 'saving';
      const isHigh   = a.type === 'high';
      return `<div class="air-action-card ${isSaving?'air-action-saving':isHigh?'air-action-high':''}" style="animation-delay:${i*40}ms">
        <div class="air-action-icon">${isSaving?'💰':isHigh?'🔴':a.type==='medium'?'🟡':'🟢'}</div>
        <div class="air-action-body">
          <div class="air-action-title">${esc(a.title)}</div>
          <div class="air-action-desc">${esc(a.desc)}</div>
          ${a.extra?`<div class="air-action-est">→ ${esc(a.extra)}</div>`:''}
        </div>
      </div>`;
    }).join('')}
  </div>
</div>`;
  }

  // ── Top categories — visual bar chart ─────────────────────────────────
  let catHtml = '';
  if (ctx?.topCategories?.length) {
    const maxAmt = ctx.topCategories[0].amount || 1;
    catHtml = `
<div class="air-section">
  <div class="air-section-title">📊 Despesas por Categoria</div>
  <div class="air-cat-bars">
    ${ctx.topCategories.slice(0,8).map((c,i) => {
      const barW = (c.amount / maxAmt * 100).toFixed(1);
      const catInsight = (r.category_insights||[]).find(ci=>ci.category===c.name);
      return `<div class="air-cat-row" style="animation-delay:${i*35}ms">
        <div class="air-cat-meta">
          <span class="air-cat-name">${esc(c.name)}</span>
          <span class="air-cat-amt">${fmtN(c.amount)} <small>${c.pct}%</small></span>
        </div>
        <div class="air-cat-track">
          <div class="air-cat-fill" style="width:${barW}%;animation-delay:${i*60+200}ms"></div>
        </div>
        ${catInsight?.insight?`<div class="air-cat-insight">${esc(catInsight.insight)}</div>`:''}
      </div>`;
    }).join('')}
  </div>
</div>`;
  }

  // ── Budget analysis ───────────────────────────────────────────────────
  let budgetHtml = '';
  if (r.budget_analysis?.length) {
    budgetHtml = `
<div class="air-section">
  <div class="air-section-title">🎯 Análise de Orçamentos</div>
  <div class="air-budget-list">
    ${r.budget_analysis.map(b => {
      const sc = {ok:{icon:'✅',color:'#22c55e'}, near:{icon:'⚠️',color:'#f59e0b'}, over:{icon:'🚨',color:'#ef4444'}}[b.status]||{icon:'ℹ️',color:'#60a5fa'};
      return `<div class="air-budget-item" style="border-left-color:${sc.color}">
        <span class="air-budget-icon">${sc.icon}</span>
        <div><strong style="color:${sc.color}">${esc(b.category)}</strong><p class="air-budget-insight">${esc(b.insight)}</p></div>
      </div>`;
    }).join('')}
  </div>
</div>`;
  }

  // ── Credit Card Projection section ────────────────────────────────────
  let ccProjHtml = '';
  const ccProj = r.credit_card_projection;
  const ctxCcProj = ctx?.creditCardProjection;
  if (ccProj && (ctxCcProj?.cards?.length || ccProj.cards?.length)) {
    const sustMeta = {
      ok:       { icon:'✅', color:'#22c55e', label:'Sustentável' },
      warning:  { icon:'⚠️', color:'#f59e0b', label:'Atenção' },
      critical: { icon:'🚨', color:'#ef4444', label:'Crítico' },
    }[ccProj.sustainability || 'ok'] || { icon:'ℹ️', color:'#60a5fa', label:'—' };

    const fmtN = v => {
      if (v === undefined || v === null) return '—';
      return 'R$ ' + parseFloat(v).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
    };

    const cardRows = (ccProj.cards || []).map(c => `
      <div class="air-cc-proj-card">
        <div class="air-cc-proj-card-header">
          <span class="air-cc-proj-card-name">💳 ${esc(c.card)}</span>
          <span class="air-cc-proj-card-total">${fmtN(c.monthly_total)}<small>/mês</small></span>
        </div>
        ${c.highlights ? `<p class="air-cc-proj-detail">${esc(c.highlights)}</p>` : ''}
        ${c.one_time_items ? `<p class="air-cc-proj-once">★ Único: ${esc(c.one_time_items)}</p>` : ''}
        ${c.alert ? `<div class="air-cc-proj-alert">⚠️ ${esc(c.alert)}</div>` : ''}
      </div>`).join('');

    const recList = (ccProj.recommendations || []).map(rec =>
      `<li class="air-cc-proj-rec">${esc(rec)}</li>`
    ).join('');

    ccProjHtml = `
<div class="air-section air-cc-proj-section">
  <div class="air-section-title">💳 Projeção de Gastos — Cartões de Crédito</div>
  <div class="air-cc-proj-header">
    <div class="air-cc-proj-status" style="--scolor:${sustMeta.color}">
      <span>${sustMeta.icon} ${sustMeta.label}</span>
      <span class="air-cc-proj-total-label">Total mensal projetado: <strong>${fmtN(ccProj.total_monthly_projected || ctxCcProj?.grand_monthly_total)}</strong></span>
      ${ccProj.pct_of_recurring_income ? `<span class="air-cc-proj-pct">${ccProj.pct_of_recurring_income}% da receita recorrente</span>` : ''}
    </div>
    ${ccProj.summary ? `<p class="air-cc-proj-summary">${esc(ccProj.summary)}</p>` : ''}
    ${ccProj.sustainability_note ? `<p class="air-cc-proj-sustain">${esc(ccProj.sustainability_note)}</p>` : ''}
  </div>
  ${cardRows ? `<div class="air-cc-proj-cards">${cardRows}</div>` : ''}
  ${recList ? `<ul class="air-cc-proj-recs">${recList}</ul>` : ''}
</div>`;}


  // ── Members ───────────────────────────────────────────────────────────
  let memberHtml = '';
  if (ctx?.memberInsights?.length) {
    const aiMMap = {};
    (r.member_insights||[]).forEach(mi => { if(mi.name) aiMMap[mi.name]=mi.insight; });
    memberHtml = `
<div class="air-section">
  <div class="air-section-title">👥 Por Membro da Família</div>
  <div class="air-member-list">
    ${ctx.memberInsights.map((m,idx) => {
      const pct = ctx.summary.totalExpense>0 ? ((m.expense/ctx.summary.totalExpense)*100).toFixed(1) : 0;
      const insight = aiMMap[m.name]||'';
      const maxCat = (m.topCategories||[])[0]?.amount || 1;
      return `<div class="air-member-card2" id="air-mc-${idx}">
        <div class="air-member2-header" onclick="_aiToggleMember(${idx})">
          <div class="air-avatar2">${esc(m.name.charAt(0).toUpperCase())}</div>
          <div class="air-member2-info">
            <span class="air-member2-name">${esc(m.name)}</span>
            <span class="air-member2-sub">${fmtN(m.expense)} despesas · ${pct}% do total${m.income>0?' · '+fmtN(m.income)+' receitas':''}</span>
          </div>
          <span class="air-member2-chev" id="ai-mem-chev-${idx}">▼</span>
        </div>
        <div class="air-member2-body" id="ai-mem-body-${idx}" style="display:none">
          ${m.topCategories?.length?`<div class="air-mem-cats2">${m.topCategories.map(c=>`
            <div class="air-mem-cat2">
              <div class="air-mem-cat2-top">
                <span>${esc(c.name)}</span>
                <span>${fmtN(c.amount)}</span>
              </div>
              <div class="air-cat-track"><div class="air-cat-fill" style="width:${(c.amount/maxCat*100).toFixed(1)}%"></div></div>
            </div>`).join('')}</div>`:''}
          ${insight?`<div class="air-mem-insight"><span>🤖</span>${esc(insight)}</div>`:''}
        </div>
      </div>`;
    }).join('')}
  </div>
</div>`;
  }

  // ── Trend table ───────────────────────────────────────────────────────
  let trendHtml = '';
  if (ctx?.monthlyTrend?.length > 1) {
    trendHtml = `
<div class="air-section">
  <div class="air-section-title">📅 Histórico Mensal</div>
  <div class="air-trend-table2">
    <div class="air-trend-header2"><span>Mês</span><span>Receitas</span><span>Despesas</span><span>Resultado</span></div>
    ${ctx.monthlyTrend.map(m => {
      const nc = m.net>=0?'#22c55e':'#ef4444';
      return `<div class="air-trend-row2">
        <span class="air-trend-month">${m.month}</span>
        <span class="air-green">${fmtN(m.income)}</span>
        <span class="air-red">${fmtN(m.expense)}</span>
        <span style="color:${nc};font-weight:700">${fmtN(m.net)}</span>
      </div>`;
    }).join('')}
  </div>
</div>`;
  }

  // ── Top payees ────────────────────────────────────────────────────────
  let payeeHtml = '';
  if (ctx?.topPayees?.length) {
    payeeHtml = `
<div class="air-section">
  <div class="air-section-title">🏪 Principais Beneficiários</div>
  <div class="air-payee-list">
    ${ctx.topPayees.slice(0,6).map((p,i) => `
      <div class="air-payee-item" style="animation-delay:${i*30}ms">
        <span class="air-payee-rank">${i+1}</span>
        <span class="air-payee-name">${esc(p.name)}</span>
        <span class="air-payee-amt">${fmtN(p.amount)}</span>
      </div>`).join('')}
  </div>
</div>`;
  }

  // ── Classification suggestions ────────────────────────────────────────
  let classSugHtml = '';
  if (r.classification_suggestions?.length) {
    classSugHtml = `
<div class="air-section air-section-advisory">
  <div class="air-section-title">🏷️ Sugestões de Classificação <small style="font-weight:400;color:var(--muted);font-size:.7rem">apenas sugestões</small></div>
  <div class="air-class-list">
    ${r.classification_suggestions.map(cs => `
      <div class="air-class-item">
        <div class="air-class-desc">${esc(cs.description)}</div>
        <div class="air-class-tags">
          ${cs.suggested_category?`<span class="air-class-tag">📁 ${esc(cs.suggested_category)}</span>`:''}
          ${cs.suggested_payee?`<span class="air-class-tag">👤 ${esc(cs.suggested_payee)}</span>`:''}
          <span class="air-class-conf">${Math.round((cs.confidence||0)*100)}%</span>
        </div>
      </div>`).join('')}
  </div>
</div>`;
  }

  // ── Final assembly ────────────────────────────────────────────────────
  container.innerHTML = `
<div class="air-root">
  ${heroHtml}
  ${aiVoiceHtml}
  ${alertsHtml}
  ${forecastBannerHtml}
  ${ccProjHtml}
  ${actionsHtml}
  ${catHtml}
  ${budgetHtml}
  ${memberHtml}
  ${trendHtml}
  ${payeeHtml}
  ${classSugHtml}
  <div class="air-footer">
    <span>Análise gerada por Google Gemini · Family FinTrack</span>
  </div>
</div>`;

  // Animate score arc
  requestAnimationFrame(() => {
    const arc = container.querySelector('.air-score-arc');
    if (arc) { arc.style.transition = 'stroke-dashoffset 1.2s cubic-bezier(.4,0,.2,1)'; }
  });
}



// ── Export ────────────────────────────────────────────────────────────────

// ── Build AI insights content for PDF / email ────────────────────────────
function _buildAiInsightsHTML() {
  if (!_ai.analysisResult || !_ai.financialContext) return null;
  const ctx = _ai.financialContext;
  const r   = _ai.analysisResult;
  const fmtR = v => 'R$ ' + (parseFloat(v)||0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
  const netColor = ctx.summary.netResult >= 0 ? '#15803d' : '#dc2626';

  const recsHtml = (r.recommendations||[]).map(rc =>
    `<tr><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">
      <span style="color:${rc.priority==='high'?'#dc2626':rc.priority==='medium'?'#d97706':'#15803d'};font-weight:700">[${(rc.priority||'').toUpperCase()}]</span>
      <strong>${esc(rc.title)}</strong> — ${esc(rc.description)}
    </td></tr>`).join('');

  const savingsHtml = (r.savings_opportunities||[]).map(s =>
    `<tr><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">
      <strong>${esc(s.title)}</strong> — ${esc(s.description)}
      ${s.estimated_saving ? `<span style="color:#15803d;font-weight:700"> (${esc(s.estimated_saving)})</span>` : ''}
    </td></tr>`).join('');

  const catHtml = (ctx.topCategories||[]).slice(0,8).map(c =>
    `<tr><td style="padding:4px 8px">${esc(c.name)}</td>
     <td style="padding:4px 8px;text-align:right;font-weight:600">${fmtR(c.amount)}</td>
     <td style="padding:4px 8px;text-align:right;color:#6b7280">${c.pct}%</td></tr>`).join('');

  const forecastHtml = r.forecast ? `
    <h3 style="color:#1e3a5f;font-size:14px;margin:20px 0 8px">Prognóstico Financeiro</h3>
    <p style="background:#f0fdf4;border-left:4px solid #22c55e;padding:10px;margin:0 0 10px;font-style:italic">${esc(r.forecast.outlook||'')}</p>
    ${(r.forecast.key_risks||[]).map(k=>`<p style="margin:4px 0">⚠️ <strong>${esc(k.risk)}</strong>${k.mitigation?` — ${esc(k.mitigation)}`:''}</p>`).join('')}
    ${(r.forecast.opportunities||[]).map(o=>`<p style="margin:4px 0">🎯 <strong>${esc(o.opportunity)}</strong>${o.action?` — ${esc(o.action)}`:''}</p>`).join('')}
  ` : '';

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <style>body{font-family:Arial,sans-serif;color:#111;font-size:13px;max-width:800px;margin:0 auto;padding:20px}
    h2{color:#0d2318;border-bottom:2px solid #2a6049;padding-bottom:6px}
    h3{color:#1a3d28;font-size:14px;margin:18px 0 6px}
    table{width:100%;border-collapse:collapse}th{background:#f3f4f6;padding:6px 8px;text-align:left}
    .kpi-row{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px}
    .kpi{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:10px 14px;min-width:120px}
    .kpi-label{font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em}
    .kpi-value{font-size:18px;font-weight:800;margin-top:2px}</style>
  </head><body>
    <h2>🤖 AI Insights — Family FinTrack</h2>
    <p style="color:#6b7280">Período: <strong>${ctx.period.from} a ${ctx.period.to}</strong> · Gerado em ${new Date().toLocaleString('pt-BR')}</p>

    <div class="kpi-row">
      <div class="kpi"><div class="kpi-label">Receitas</div><div class="kpi-value" style="color:#15803d">${fmtR(ctx.summary.totalIncome)}</div></div>
      <div class="kpi"><div class="kpi-label">Despesas</div><div class="kpi-value" style="color:#dc2626">${fmtR(ctx.summary.totalExpense)}</div></div>
      <div class="kpi"><div class="kpi-label">Resultado</div><div class="kpi-value" style="color:${netColor}">${fmtR(ctx.summary.netResult)}</div></div>
      <div class="kpi"><div class="kpi-label">Transações</div><div class="kpi-value">${ctx.summary.txCount}</div></div>
    </div>

    <h3>Análise Gemini</h3>
    <p style="background:#f0f4ff;border-left:4px solid #6366f1;padding:10px;font-style:italic">${esc(r.summary||'')}</p>

    ${forecastHtml}

    ${catHtml ? `<h3>Top Categorias de Despesa</h3>
    <table><thead><tr><th>Categoria</th><th style="text-align:right">Total</th><th style="text-align:right">%</th></tr></thead>
    <tbody>${catHtml}</tbody></table>` : ''}

    ${recsHtml ? `<h3>Recomendações</h3><table><tbody>${recsHtml}</tbody></table>` : ''}
    ${savingsHtml ? `<h3>Oportunidades de Economia</h3><table><tbody>${savingsHtml}</tbody></table>` : ''}

    <p style="color:#9ca3af;font-size:11px;margin-top:24px;border-top:1px solid #e5e7eb;padding-top:10px">
      Family FinTrack · AI Insights · Análise gerada por Google Gemini</p>
  </body></html>`;
}

// ── Export as PDF ─────────────────────────────────────────────────────────
async function exportAiAnalysis() {
  if (!_ai.analysisResult || !_ai.financialContext) {
    toast('Execute uma análise primeiro', 'warning'); return;
  }

  const { jsPDF } = window.jspdf;
  if (!jsPDF) { toast('jsPDF não disponível', 'error'); return; }

  toast('⏳ Gerando PDF…', 'info');
  try {
    const html = _buildAiInsightsHTML();
    const doc  = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const ctx  = _ai.financialContext;
    const r    = _ai.analysisResult;
    const fmtP = v => 'R$ ' + (parseFloat(v)||0).toLocaleString('pt-BR', {minimumFractionDigits:2});

    let y = 15;
    const lh = 6, pw = 180, lm = 15;

    // Header
    doc.setFontSize(16).setFont(undefined,'bold').setTextColor('#0d2318');
    doc.text('AI Insights — Family FinTrack', lm, y); y += 8;
    doc.setFontSize(9).setFont(undefined,'normal').setTextColor('#6b7280');
    doc.text(`Período: ${ctx.period.from} a ${ctx.period.to}  ·  Gerado em ${new Date().toLocaleString('pt-BR')}`, lm, y); y += 8;

    // KPI row
    doc.setDrawColor('#e5e7eb').setFillColor('#f9fafb');
    const kpis = [
      {label:'Receitas',  val:fmtP(ctx.summary.totalIncome),  color:'#15803d'},
      {label:'Despesas',  val:fmtP(ctx.summary.totalExpense), color:'#dc2626'},
      {label:'Resultado', val:fmtP(ctx.summary.netResult),    color:ctx.summary.netResult>=0?'#15803d':'#dc2626'},
      {label:'Transações',val:String(ctx.summary.txCount),    color:'#111'},
    ];
    const kw = pw/4;
    kpis.forEach((k,i) => {
      const x = lm + i*kw;
      doc.roundedRect(x, y, kw-2, 16, 2, 2, 'FD');
      doc.setFontSize(7).setTextColor('#6b7280').setFont(undefined,'normal');
      doc.text(k.label.toUpperCase(), x+3, y+5);
      doc.setFontSize(10).setFont(undefined,'bold').setTextColor(k.color);
      doc.text(k.val, x+3, y+13);
    });
    y += 22;

    const section = (title) => {
      if (y > 260) { doc.addPage(); y = 15; }
      doc.setFontSize(11).setFont(undefined,'bold').setTextColor('#0d2318');
      doc.text(title, lm, y); y += 6;
      doc.setDrawColor('#2a6049').line(lm, y, lm+pw, y); y += 4;
    };

    const paragraph = (text, color='#111', bold=false) => {
      doc.setFontSize(9).setFont(undefined, bold?'bold':'normal').setTextColor(color);
      const lines = doc.splitTextToSize(text||'', pw);
      lines.forEach(l => { if (y>272){doc.addPage();y=15;} doc.text(l, lm, y); y+=lh; });
      y += 2;
    };

    // AI Summary
    section('Análise Gemini');
    paragraph(r.summary||'', '#374151');
    if (r.overview) {
      if (r.overview.income_comment)  paragraph('💰 ' + r.overview.income_comment, '#15803d');
      if (r.overview.expense_comment) paragraph('💸 ' + r.overview.expense_comment, '#dc2626');
      if (r.overview.net_comment)     paragraph('📈 ' + r.overview.net_comment, '#1d4ed8');
    }

    // Forecast
    if (r.forecast?.outlook) {
      section('Prognóstico & Tendência');
      paragraph(r.forecast.outlook, '#374151', false);
      (r.forecast.key_risks||[]).forEach(k => paragraph(`⚠️ ${k.risk}${k.mitigation?' — '+k.mitigation:''}`, '#b45309'));
      (r.forecast.opportunities||[]).forEach(o => paragraph(`🎯 ${o.opportunity}${o.action?' — '+o.action:''}`, '#15803d'));
    }

    // Cashflow alerts
    if (r.cashflow_alerts?.length) {
      section('Alertas de Fluxo de Caixa');
      r.cashflow_alerts.forEach(a => paragraph(`${a.type==='warning'?'⚠️':'ℹ️'} ${a.message}`, a.type==='warning'?'#b45309':'#1d4ed8'));
    }

    // Top categories
    if (ctx.topCategories?.length) {
      section('Top Categorias de Despesa');
      ctx.topCategories.slice(0,8).forEach(c => {
        if (y>272){doc.addPage();y=15;}
        doc.setFontSize(9).setFont(undefined,'normal').setTextColor('#111');
        doc.text(esc(c.name), lm, y);
        doc.setFont(undefined,'bold');
        doc.text(fmtP(c.amount), lm+120, y, {align:'right'});
        doc.setFont(undefined,'normal').setTextColor('#6b7280');
        doc.text(`${c.pct}%`, lm+pw, y, {align:'right'});
        y += lh;
      });
      y += 2;
    }

    // Recommendations
    if (r.recommendations?.length) {
      section('Recomendações');
      r.recommendations.forEach(rec => {
        const col = rec.priority==='high'?'#dc2626':rec.priority==='medium'?'#d97706':'#15803d';
        paragraph(`[${(rec.priority||'').toUpperCase()}] ${rec.title}: ${rec.description}`, col);
      });
    }

    // Savings
    if (r.savings_opportunities?.length) {
      section('Oportunidades de Economia');
      r.savings_opportunities.forEach(s => {
        paragraph(`${s.title}: ${s.description}${s.estimated_saving?' ('+s.estimated_saving+')':''}`, '#15803d');
      });
    }

    // Footer
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i).setFontSize(7).setTextColor('#9ca3af').setFont(undefined,'normal');
      doc.text(`Family FinTrack · AI Insights · Pág. ${i}/${pageCount}`, 105, 290, {align:'center'});
    }

    doc.save(`ai-insights-${ctx.period.from}-${ctx.period.to}.pdf`);
    toast(t('report.export_ok'), 'success');
  } catch(e) {
    console.error('[AI PDF]', e);
    toast('Erro ao gerar PDF: ' + e.message, 'error');
  }
}

// ── Send AI insights by email ──────────────────────────────────────────────
async function sendAiInsightsByEmail() {
  if (!_ai.analysisResult || !_ai.financialContext) {
    toast('Execute uma análise primeiro', 'warning'); return;
  }
  // Reuse reports email popup
  const popup = document.getElementById('emailPopup');
  if (!popup) { toast('Modal de e-mail não encontrado', 'error'); return; }

  // Override the send button action
  const btn = document.getElementById('emailSendBtn');
  if (btn) {
    btn.onclick = _sendAiEmail;
    btn.textContent = 'Enviar Análise';
  }
  const subjectEl = document.getElementById('emailSubject');
  if (subjectEl) {
    const ctx = _ai.financialContext;
    subjectEl.value = `AI Insights — ${ctx.period.from} a ${ctx.period.to}`;
  }
  popup.style.display = 'flex';
}
window.sendAiInsightsByEmail = sendAiInsightsByEmail;

async function _sendAiEmail() {
  const toAddr = (document.getElementById('emailTo')?.value || '').trim();
  if (!toAddr || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toAddr)) {
    toast('Informe um e-mail válido', 'error'); return;
  }
  if (!EMAILJS_CONFIG.serviceId || !EMAILJS_CONFIG.templateId || !EMAILJS_CONFIG.publicKey) {
    toast('Configure o EmailJS primeiro', 'error'); showEmailConfig(); return;
  }

  const btn = document.getElementById('emailSendBtn');
  const status = document.getElementById('emailStatus');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Enviando…'; }
  if (status) status.textContent = '';

  try {
    const ctx = _ai.financialContext;
    const html = _buildAiInsightsHTML();
    const subject = document.getElementById('emailSubject')?.value.trim()
      || `AI Insights — ${ctx.period.from} a ${ctx.period.to}`;

    emailjs.init(EMAILJS_CONFIG.publicKey);
    await emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, {
      to_email: toAddr, to: toAddr, email: toAddr, recipient: toAddr,
      from_name: 'Family FinTrack',
      report_subject: subject, subject,
      message: `AI Insights para o período ${ctx.period.from} a ${ctx.period.to}.`,
      report_content: html,
      report_period: `${ctx.period.from} a ${ctx.period.to}`,
      report_income:  'R$ ' + (ctx.summary.totalIncome||0).toLocaleString('pt-BR',{minimumFractionDigits:2}),
      report_expense: 'R$ ' + (ctx.summary.totalExpense||0).toLocaleString('pt-BR',{minimumFractionDigits:2}),
      report_balance: 'R$ ' + (ctx.summary.netResult||0).toLocaleString('pt-BR',{minimumFractionDigits:2}),
      pdf_url: '', pdf_name: '',
    });

    if (status) { status.textContent = '✓ Enviado!'; status.style.color = 'var(--green)'; }
    toast('✓ E-mail enviado!', 'success');
    setTimeout(closeEmailPopup, 1800);
  } catch(e) {
    const msg = e?.text || e?.message || JSON.stringify(e);
    toast('Erro ao enviar: ' + msg, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Enviar Análise'; }
  }
}

// ══════════════════════════════════════════════════════════════════════════
//  SEÇÃO 4 — AI CHAT
// ══════════════════════════════════════════════════════════════════════════

async function sendAiChatMessage() {
  const input = document.getElementById('aiChatInput');
  const msg   = (input?.value || '').trim();
  if (!msg) return;
  if (_ai.chatLoading) return;

  const enabled = await isAiInsightsEnabled();
  if (!enabled) { toast('AI Insights não está habilitado para esta família', 'warning'); return; }

  const apiKey = await getAppSetting(RECEIPT_AI_KEY_SETTING, '');
  if (!apiKey || !apiKey.startsWith('AIza')) { toast('Configure a chave Gemini', 'warning'); showAiConfig(); return; }

  // Adiciona mensagem do usuário
  _ai.chatHistory.push({ role: 'user', text: msg });
  if (input) input.value = '';
  _aiRenderChatHistory();

  _ai.chatLoading = true;
  _aiSetChatTyping(true);

  try {
    // Coleta contexto se ainda não temos
    if (!_ai.financialContext) {
      await _aiCollectFinancialContext();
    }

    const reply = await _callGeminiChat(apiKey, msg, _ai.chatHistory.slice(-12));
    _ai.chatHistory.push({ role: 'assistant', text: reply });
  } catch (e) {
    _ai.chatHistory.push({ role: 'assistant', text: `❌ Erro: ${e.message}`, isError: true });
    console.error('[AIInsights] chat error:', e);
  } finally {
    _ai.chatLoading = false;
    _aiSetChatTyping(false);
    _aiRenderChatHistory();
  }
}

async function _callGeminiChat(apiKey, question, history) {
  const ctx = _ai.financialContext;
  const ctxStr = ctx ? JSON.stringify({
    period: ctx.period,
    summary: ctx.summary,
    topCategories: ctx.topCategories.slice(0,10),
    topPayees: ctx.topPayees.slice(0,10),
    memberInsights: ctx.memberInsights,
    monthlyTrend: ctx.monthlyTrend,
    scheduledSummary: ctx.scheduledSummary,
    accountBalances: ctx.accountBalances,
    accountSummary: ctx.accountSummary || [],
    topTransactions: ctx.topTransactions || [],
    anomalies: ctx.anomalies,
  }) : '{}';

  // Monta histórico no formato Gemini
  const geminiHistory = history.slice(0, -1).map(h => ({
    role: h.role === 'user' ? 'user' : 'model',
    parts: [{ text: h.text }],
  }));

  const systemInstruction = `Você é um assistente financeiro pessoal para uma família brasileira usando o app Family FinTrack.
Você responde perguntas sobre as finanças da família usando os dados fornecidos pelo app (não os invente).

DADOS FINANCEIROS ATUAIS (computados pelo app — use como fonte de verdade):
${ctxStr}

REGRAS:
- Seja conciso mas completo. Prefira bullets e listas para clareza.
- NÃO invente números — cite apenas os dados fornecidos acima.
- Quando citar um número, diga se é "dado do app" ou "estimativa IA".
- Se não souber, diga claramente. Não suponha.
- Responda em português brasileiro.
- Para perguntas sobre saldos/totais, cite os dados do app literalmente.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${RECEIPT_AI_MODEL}:generateContent?key=${apiKey}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents: [
        ...geminiHistory,
        { role: 'user', parts: [{ text: question }] },
      ],
      generationConfig: { maxOutputTokens: 800, temperature: 0.4 },
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    const msg = err?.error?.message || `HTTP ${resp.status}`;
    if (resp.status === 429) throw new Error('Limite de requisições. Aguarde.');
    throw new Error(msg);
  }

  const data = await resp.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || '(sem resposta)';
}

function _aiRenderChatHistory() {
  const feed = document.getElementById('aiChatFeed');
  if (!feed) return;

  if (!_ai.chatHistory.length) {
    feed.innerHTML = `
      <div class="ai-chat-empty">
        <p>💬 Faça perguntas sobre suas finanças em linguagem natural.</p>
        <div class="ai-chat-suggestions">
          <button class="ai-chat-suggest" onclick="aiChatSuggest('Qual foi meu maior gasto este mês?')">Maior gasto este mês?</button>
          <button class="ai-chat-suggest" onclick="aiChatSuggest('Como estão meus gastos comparados ao mês passado?')">Vs. mês passado?</button>
          <button class="ai-chat-suggest" onclick="aiChatSuggest('Em quais categorias posso economizar?')">Onde economizar?</button>
          <button class="ai-chat-suggest" onclick="aiChatSuggest('Qual é o meu saldo atual?')">Saldo atual?</button>
        </div>
      </div>`;
    return;
  }

  feed.innerHTML = _ai.chatHistory.map(msg => `
    <div class="ai-chat-msg ai-chat-${msg.role}${msg.isError ? ' ai-chat-error' : ''}">
      <div class="ai-chat-bubble">
        ${msg.role === 'assistant' ? `<span class="ai-chat-origin">${msg.isError ? '⚠️ Erro' : '🤖 IA'}</span>` : ''}
        <div class="ai-chat-text">${_aiFormatChatText(msg.text)}</div>
      </div>
    </div>`).join('');

  // Scroll to bottom
  feed.scrollTop = feed.scrollHeight;
}

function _aiFormatChatText(text) {
  // Simples formatação: negrito, itálico, listas
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    .replace(/\n/g, '<br>');
}

function _aiSetChatTyping(typing) {
  let indicator = document.getElementById('aiChatTyping');
  if (typing && !indicator) {
    const feed = document.getElementById('aiChatFeed');
    if (feed) {
      feed.insertAdjacentHTML('beforeend', `
        <div class="ai-chat-msg ai-chat-assistant" id="aiChatTyping">
          <div class="ai-chat-bubble">
            <span class="ai-chat-origin">🤖 IA</span>
            <div class="ai-typing-dots"><span></span><span></span><span></span></div>
          </div>
        </div>`);
      feed.scrollTop = feed.scrollHeight;
    }
  } else if (!typing && indicator) {
    indicator.remove();
  }
}

function aiChatSuggest(text) {
  const input = document.getElementById('aiChatInput');
  if (input) { input.value = text; input.focus(); }
}

function clearAiChat() {
  _ai.chatHistory = [];
  _ai.financialContext = null;
  _aiRenderChatHistory();
  toast(t('ai.chat_clear'), 'info');
}

// ══════════════════════════════════════════════════════════════════════════
//  SEÇÃO 5 — ENRIQUECIMENTO DE CONTEXTO DE TRANSAÇÕES
// ══════════════════════════════════════════════════════════════════════════

async function enrichTransactionContext(tx) {
  if (!tx) return null;

  const catMap   = Object.fromEntries((state.categories || []).map(c => [c.id, c.name]));
  const payMap   = Object.fromEntries((state.payees     || []).map(p => [p.id, p.name]));
  const accMap   = Object.fromEntries((state.accounts   || []).map(a => [a.id, a.name]));

  // Histórico do mesmo beneficiário
  let payeeHistory = [];
  if (tx.payee_id) {
    const { data } = await famQ(sb.from('transactions').select('date,brl_amount,category_id,description').eq('payee_id', tx.payee_id).order('date', { ascending: false }).limit(10));
    payeeHistory = (data || []).map(t => ({
      date: t.date,
      amount: Math.abs(parseFloat(t.brl_amount || 0)),
      category: catMap[t.category_id] || null,
    }));
  }

  // Detectar recorrência simples
  let recurrencePattern = null;
  if (payeeHistory.length >= 2) {
    const intervals = [];
    for (let i = 1; i < payeeHistory.length; i++) {
      const d1 = new Date(payeeHistory[i-1].date);
      const d2 = new Date(payeeHistory[i].date);
      intervals.push(Math.abs(Math.round((d1 - d2) / (1000 * 60 * 60 * 24))));
    }
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    if (avgInterval <= 10)       recurrencePattern = 'semanal';
    else if (avgInterval <= 35)  recurrencePattern = 'mensal';
    else if (avgInterval <= 100) recurrencePattern = 'trimestral';
  }

  return {
    transaction: {
      description: tx.description,
      amount: Math.abs(parseFloat(tx.brl_amount || 0)),
      type: tx.is_transfer ? (tx.is_card_payment ? 'card_payment' : 'transfer') : parseFloat(tx.amount||0) >= 0 ? 'income' : 'expense',
      date: tx.date,
      memo: tx.memo,
      category: catMap[tx.category_id] || null,
      payee: payMap[tx.payee_id] || null,
      account: accMap[tx.account_id] || null,
    },
    payeeHistory,
    recurrencePattern,
    isRecurrent: !!recurrencePattern,
  };
}

// ══════════════════════════════════════════════════════════════════════════
//  SEÇÃO 6 — INICIALIZAÇÃO (chamada pelo app.js via navigate)
// ══════════════════════════════════════════════════════════════════════════

// Teclado: Enter envia chat
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    const chatInput = document.getElementById('aiChatInput');
    if (chatInput) {
      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendAiChatMessage();
        }
      });
    }

    // Aplica feature flag ao carregar
    applyAiInsightsFeature();
  }, 400);
});


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
