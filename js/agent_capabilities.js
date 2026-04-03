// ════════════════════════════════════════════════════════════════════════════
// AGENT_CAPABILITIES.JS — "Saiba o que posso fazer"
// Sistema de descoberta de capacidades com atalhos de execução guiada.
// Organizado em categorias temáticas com fluxos passo-a-passo.
// ════════════════════════════════════════════════════════════════════════════
'use strict';

// ── Catálogo completo de capacidades ────────────────────────────────────────
const AGENT_CAPABILITIES = {

  // ── LANÇAMENTOS ──────────────────────────────────────────────────────────
  transacoes: {
    id: 'transacoes',
    label: 'Transações',
    icon: '💳',
    color: '#2a6049',
    colorLight: 'rgba(42,96,73,.12)',
    description: 'Criar, registrar e consultar lançamentos financeiros',
    actions: [
      {
        id: 'despesa',
        label: 'Registrar despesa',
        icon: '💸',
        description: 'Lance um pagamento ou compra em qualquer conta',
        example: 'Paguei R$85 de mercado no cartão Nubank',
        shortcut: 'despesa',
        guided: {
          title: 'Nova Despesa',
          steps: [
            { field: 'amount',        label: 'Valor',       type: 'money',  placeholder: 'Ex: 85,00',       required: true },
            { field: 'description',   label: 'Descrição',   type: 'text',   placeholder: 'Ex: Mercado',      required: true },
            { field: 'account_name',  label: 'Conta',       type: 'account',placeholder: 'Selecionar',       required: true },
            { field: 'category_name', label: 'Categoria',   type: 'category',placeholder: 'Selecionar',      required: false },
            { field: 'date',          label: 'Data',        type: 'date',   placeholder: 'Hoje',             required: false },
          ],
          intent: 'create_transaction',
          extra: { type: 'expense' },
          confirmLabel: 'Registrar despesa',
        },
      },
      {
        id: 'receita',
        label: 'Registrar receita',
        icon: '💰',
        description: 'Registre um recebimento, salário ou transferência recebida',
        example: 'Recebi R$5.000 de salário na conta Itaú',
        shortcut: 'receita',
        guided: {
          title: 'Nova Receita',
          steps: [
            { field: 'amount',        label: 'Valor',       type: 'money',  placeholder: 'Ex: 5000,00',      required: true },
            { field: 'description',   label: 'Descrição',   type: 'text',   placeholder: 'Ex: Salário',       required: true },
            { field: 'account_name',  label: 'Conta',       type: 'account',placeholder: 'Selecionar',        required: true },
            { field: 'category_name', label: 'Categoria',   type: 'category',placeholder: 'Selecionar',       required: false },
            { field: 'date',          label: 'Data',        type: 'date',   placeholder: 'Hoje',              required: false },
          ],
          intent: 'create_transaction',
          extra: { type: 'income' },
          confirmLabel: 'Registrar receita',
        },
      },
      {
        id: 'programado',
        label: 'Transação programada',
        icon: '📅',
        description: 'Crie cobranças ou recebimentos recorrentes automáticos',
        example: 'Cadastrar aluguel de R$2.000 todo dia 5',
        shortcut: 'criar programado',
        guided: {
          title: 'Nova Transação Programada',
          steps: [
            { field: 'description',  label: 'Descrição',  type: 'text',    placeholder: 'Ex: Aluguel',       required: true },
            { field: 'amount',       label: 'Valor',      type: 'money',   placeholder: 'Ex: 2000,00',       required: true },
            { field: 'frequency',    label: 'Frequência', type: 'select',  options: [
                {value:'monthly',label:'Mensal'},{value:'weekly',label:'Semanal'},
                {value:'biweekly',label:'Quinzenal'},{value:'annual',label:'Anual'},
              ], required: true },
            { field: 'account_name', label: 'Conta',      type: 'account', placeholder: 'Selecionar',        required: true },
          ],
          intent: 'create_scheduled',
          extra: { type: 'expense' },
          confirmLabel: 'Criar programado',
        },
      },
      {
        id: 'consulta_gastos',
        label: 'Quanto gastei?',
        icon: '📊',
        description: 'Consulte seus gastos por período, conta ou categoria',
        example: 'Quanto gastei em alimentação este mês?',
        shortcut: 'quanto gastei este mês?',
        guided: null,
        isQuery: true,
      },
    ],
  },

  // ── CONTAS & SALDO ───────────────────────────────────────────────────────
  contas: {
    id: 'contas',
    label: 'Contas',
    icon: '🏦',
    color: '#1d4ed8',
    colorLight: 'rgba(29,78,216,.12)',
    description: 'Gerenciar contas bancárias, cartões e carteiras',
    actions: [
      {
        id: 'nova_conta',
        label: 'Nova conta',
        icon: '➕',
        description: 'Crie uma conta corrente, poupança, cartão ou investimento',
        example: 'Criar conta corrente Nubank em BRL',
        shortcut: 'criar conta',
        guided: {
          title: 'Nova Conta',
          steps: [
            { field: 'name',     label: 'Nome',   type: 'text',   placeholder: 'Ex: Nubank Corrente',  required: true },
            { field: 'type',     label: 'Tipo',   type: 'select', options: [
                {value:'corrente',label:'Conta Corrente'},{value:'poupanca',label:'Poupança'},
                {value:'cartao_credito',label:'Cartão de Crédito'},{value:'investimento',label:'Investimento'},
                {value:'dinheiro',label:'Dinheiro'},
              ], required: true },
            { field: 'currency', label: 'Moeda',  type: 'select', options: [
                {value:'BRL',label:'BRL — Real'},{value:'USD',label:'USD — Dólar'},
                {value:'EUR',label:'EUR — Euro'},
              ], required: true },
          ],
          intent: 'create_account',
          confirmLabel: 'Criar conta',
        },
      },
      {
        id: 'saldo',
        label: 'Ver saldo total',
        icon: '💳',
        description: 'Consulte o saldo atual de todas as suas contas',
        example: 'Qual meu saldo total agora?',
        shortcut: 'qual meu saldo total?',
        guided: null,
        isQuery: true,
      },
      {
        id: 'nav_contas',
        label: 'Ir para Contas',
        icon: '🔗',
        description: 'Abre a tela de gerenciamento de contas',
        shortcut: '__nav__:accounts',
        guided: null,
        isNav: true,
      },
    ],
  },

  // ── ORÇAMENTOS ───────────────────────────────────────────────────────────
  orcamentos: {
    id: 'orcamentos',
    label: 'Orçamentos',
    icon: '🎯',
    color: '#7c3aed',
    colorLight: 'rgba(124,58,237,.12)',
    description: 'Criar e acompanhar orçamentos por categoria',
    actions: [
      {
        id: 'resumo_orcamento',
        label: 'Resumo dos orçamentos',
        icon: '📊',
        description: 'Veja quais orçamentos estão no limite ou estourados',
        example: 'Como estão meus orçamentos deste mês?',
        shortcut: 'como estão meus orçamentos?',
        guided: null,
        isQuery: true,
      },
      {
        id: 'nav_orcamentos',
        label: 'Ir para Orçamentos',
        icon: '🔗',
        description: 'Abre a tela de criação e gestão de orçamentos',
        shortcut: '__nav__:budgets',
        guided: null,
        isNav: true,
      },
    ],
  },

  // ── INVESTIMENTOS ────────────────────────────────────────────────────────
  investimentos: {
    id: 'investimentos',
    label: 'Investimentos',
    icon: '📈',
    color: '#0891b2',
    colorLight: 'rgba(8,145,178,.12)',
    description: 'Acompanhar carteira, aportes e rendimentos',
    actions: [
      {
        id: 'resumo_inv',
        label: 'Resumo da carteira',
        icon: '💼',
        description: 'Veja o valor total investido, rendimento e distribuição',
        example: 'Como está minha carteira de investimentos?',
        shortcut: 'como estão meus investimentos?',
        guided: null,
        isQuery: true,
      },
      {
        id: 'nav_investimentos',
        label: 'Ir para Investimentos',
        icon: '🔗',
        description: 'Abre a tela de investimentos',
        shortcut: '__nav__:investments',
        guided: null,
        isNav: true,
      },
    ],
  },

  // ── DÍVIDAS ──────────────────────────────────────────────────────────────
  dividas: {
    id: 'dividas',
    label: 'Dívidas',
    icon: '💳',
    color: '#dc2626',
    colorLight: 'rgba(220,38,38,.1)',
    description: 'Controlar e pagar dívidas ativas',
    actions: [
      {
        id: 'nova_divida',
        label: 'Registrar dívida',
        icon: '📋',
        description: 'Cadastre uma nova dívida com credor e valor',
        example: 'Dívida de R$10.000 no banco com juros CDI',
        shortcut: 'registrar dívida',
        guided: {
          title: 'Nova Dívida',
          steps: [
            { field: 'description',     label: 'Descrição',  type: 'text',  placeholder: 'Ex: Empréstimo pessoal',  required: true },
            { field: 'original_amount', label: 'Valor',      type: 'money', placeholder: 'Ex: 10000,00',            required: true },
            { field: 'creditor',        label: 'Credor',     type: 'text',  placeholder: 'Ex: Banco Itaú',          required: true },
          ],
          intent: 'create_debt',
          confirmLabel: 'Registrar dívida',
        },
      },
      {
        id: 'pagar_divida',
        label: 'Pagar parcela de dívida',
        icon: '✅',
        description: 'Registre o pagamento de uma parcela ou amortização',
        example: 'Pagar R$500 na dívida do Itaú',
        shortcut: 'pagar dívida',
        guided: null,
      },
      {
        id: 'nav_dividas',
        label: 'Ir para Dívidas',
        icon: '🔗',
        description: 'Abre o módulo de controle de dívidas',
        shortcut: '__nav__:debts',
        guided: null,
        isNav: true,
      },
    ],
  },

  // ── SONHOS ───────────────────────────────────────────────────────────────
  sonhos: {
    id: 'sonhos',
    label: 'Sonhos',
    icon: '🌟',
    color: '#f59e0b',
    colorLight: 'rgba(245,158,11,.12)',
    description: 'Definir e acompanhar metas financeiras',
    actions: [
      {
        id: 'novo_sonho',
        label: 'Criar sonho / meta',
        icon: '✨',
        description: 'Crie uma meta financeira com valor-alvo e prazo',
        example: 'Quero fazer uma viagem de R$15.000 em dezembro',
        shortcut: 'criar sonho',
        guided: {
          title: 'Novo Sonho',
          steps: [
            { field: 'name',          label: 'Nome do sonho', type: 'text',   placeholder: 'Ex: Viagem para Europa',  required: true },
            { field: 'target_amount', label: 'Valor-alvo',    type: 'money',  placeholder: 'Ex: 15000,00',            required: true },
            { field: 'target_date',   label: 'Prazo',         type: 'date',   placeholder: 'Data desejada',           required: false },
          ],
          intent: 'create_dream',
          confirmLabel: 'Criar sonho',
        },
      },
      {
        id: 'nav_sonhos',
        label: 'Ir para Sonhos',
        icon: '🔗',
        description: 'Abre o módulo de sonhos e metas',
        shortcut: '__nav__:dreams',
        guided: null,
        isNav: true,
      },
    ],
  },

  // ── BENEFICIÁRIOS & CATEGORIAS ───────────────────────────────────────────
  cadastros: {
    id: 'cadastros',
    label: 'Cadastros',
    icon: '📁',
    color: '#64748b',
    colorLight: 'rgba(100,116,139,.12)',
    description: 'Gerenciar beneficiários, categorias e membros da família',
    actions: [
      {
        id: 'novo_beneficiario',
        label: 'Criar beneficiário',
        icon: '👤',
        description: 'Cadastre uma loja, pessoa ou empresa como favorecido',
        example: 'Adicionar Padaria do João como beneficiário',
        shortcut: 'criar beneficiário',
        guided: {
          title: 'Novo Beneficiário',
          steps: [
            { field: 'name', label: 'Nome', type: 'text', placeholder: 'Ex: Padaria Central', required: true },
          ],
          intent: 'create_payee',
          confirmLabel: 'Criar beneficiário',
        },
      },
      {
        id: 'nova_categoria',
        label: 'Criar categoria',
        icon: '🏷️',
        description: 'Adicione uma nova categoria de receita ou despesa',
        example: 'Criar categoria de Educação',
        shortcut: 'criar categoria',
        guided: {
          title: 'Nova Categoria',
          steps: [
            { field: 'name', label: 'Nome',  type: 'text',   placeholder: 'Ex: Educação',   required: true },
            { field: 'type', label: 'Tipo',  type: 'select', options: [
                {value:'despesa',label:'Despesa'},{value:'receita',label:'Receita'},
              ], required: true },
          ],
          intent: 'create_category',
          confirmLabel: 'Criar categoria',
        },
      },
      {
        id: 'novo_membro',
        label: 'Adicionar membro da família',
        icon: '👨‍👩‍👧',
        description: 'Cadastre um integrante para rastrear gastos individuais',
        example: 'Adicionar minha filha Ana',
        shortcut: 'criar membro da família',
        guided: {
          title: 'Novo Membro da Família',
          steps: [
            { field: 'name',       label: 'Nome',         type: 'text',   placeholder: 'Ex: Maria',  required: true },
            { field: 'birth_date', label: 'Nascimento',   type: 'date',   placeholder: 'dd/mm/aaaa', required: false },
          ],
          intent: 'create_family_member',
          confirmLabel: 'Criar membro',
        },
      },
    ],
  },

  // ── ANÁLISE & RELATÓRIOS ─────────────────────────────────────────────────
  analise: {
    id: 'analise',
    label: 'Análise',
    icon: '🧠',
    color: '#16a34a',
    colorLight: 'rgba(22,163,74,.12)',
    description: 'Insights financeiros, previsões e relatórios',
    actions: [
      {
        id: 'resumo_mes',
        label: 'Resumo do mês',
        icon: '📊',
        description: 'Receitas, despesas, saldo e maiores gastos do mês',
        example: 'Resumo financeiro completo de março',
        shortcut: 'resumo financeiro deste mês',
        guided: null,
        isQuery: true,
      },
      {
        id: 'previsao',
        label: 'Previsão de caixa',
        icon: '🔮',
        description: 'Qual será meu saldo nos próximos dias?',
        example: 'Como estará meu caixa nos próximos 30 dias?',
        shortcut: 'previsão dos próximos 30 dias',
        guided: null,
        isQuery: true,
      },
      {
        id: 'maiores_gastos',
        label: 'Maiores gastos',
        icon: '📉',
        description: 'Quais categorias ou beneficiários consomem mais',
        example: 'Onde estou gastando mais este mês?',
        shortcut: 'onde estou gastando mais?',
        guided: null,
        isQuery: true,
      },
      {
        id: 'saude_financeira',
        label: 'Saúde financeira',
        icon: '💚',
        description: 'Análise geral da situação financeira da família',
        example: 'Como está minha saúde financeira?',
        shortcut: 'como está minha saúde financeira?',
        guided: null,
        isQuery: true,
      },
      {
        id: 'nav_relatorios',
        label: 'Ir para Relatórios',
        icon: '🔗',
        description: 'Abre a tela de relatórios avançados',
        shortcut: '__nav__:reports',
        guided: null,
        isNav: true,
      },
    ],
  },

  // ── NAVEGAÇÃO & AJUDA ────────────────────────────────────────────────────
  navegacao: {
    id: 'navegacao',
    label: 'Navegar & Ajuda',
    icon: '🧭',
    color: '#0369a1',
    colorLight: 'rgba(3,105,161,.12)',
    description: 'Ir para qualquer tela ou obter ajuda sobre o app',
    actions: [
      {
        id: 'nav_dashboard',
        label: 'Dashboard',
        icon: '🏠',
        description: 'Tela principal com resumo e gráficos',
        shortcut: '__nav__:dashboard',
        guided: null,
        isNav: true,
      },
      {
        id: 'nav_transacoes',
        label: 'Transações',
        icon: '📋',
        description: 'Listar e filtrar todos os lançamentos',
        shortcut: '__nav__:transactions',
        guided: null,
        isNav: true,
      },
      {
        id: 'nav_agendados',
        label: 'Programados',
        icon: '📅',
        description: 'Pagamentos e recebimentos recorrentes',
        shortcut: '__nav__:scheduled',
        guided: null,
        isNav: true,
      },
      {
        id: 'ajuda_geral',
        label: 'Como usar o app?',
        icon: '❓',
        description: 'Tire dúvidas sobre qualquer funcionalidade',
        example: 'Como adicionar uma conta? Como funciona o orçamento?',
        shortcut: 'como usar o FinTrack?',
        guided: null,
        isQuery: true,
      },
    ],
  },
};

// ── Show capabilities panel ──────────────────────────────────────────────────
function agentShowCapabilities() {
  const categories = Object.values(AGENT_CAPABILITIES);

  const html = `
<div class="agent-caps-wrap" id="agentCapsPanel">

  <!-- Header -->
  <div class="agent-caps-header">
    <div class="agent-caps-header-icon">✨</div>
    <div>
      <div class="agent-caps-title">O que posso fazer por você</div>
      <div class="agent-caps-subtitle">Toque em qualquer ação para executá-la agora</div>
    </div>
    <button class="agent-caps-close" onclick="agentCloseCaps()">✕</button>
  </div>

  <!-- Search bar -->
  <div class="agent-caps-search-wrap">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" style="flex-shrink:0;color:var(--muted)"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
    <input type="text" class="agent-caps-search" placeholder="Pesquisar funcionalidades…"
      oninput="agentSearchCaps(this.value)" autocomplete="off" autocorrect="off" spellcheck="false">
  </div>

  <!-- Category pills -->
  <div class="agent-caps-cats" id="agentCapsCats">
    <button class="agent-cats-pill active" onclick="agentFilterCaps('all', this)">Tudo</button>
    ${categories.map(c =>
      `<button class="agent-cats-pill" onclick="agentFilterCaps('${c.id}', this)" style="--pill-color:${c.color}">${c.icon} ${c.label}</button>`
    ).join('')}
  </div>

  <!-- Cards grid -->
  <div class="agent-caps-grid" id="agentCapsGrid">
    ${categories.map(cat => `
      <div class="agent-caps-section" data-cat="${cat.id}">
        <div class="agent-caps-section-header" style="--sec-color:${cat.color}">
          <span class="agent-caps-section-icon">${cat.icon}</span>
          <span class="agent-caps-section-title">${cat.label}</span>
          <span class="agent-caps-section-desc">${cat.description}</span>
        </div>
        <div class="agent-caps-actions">
          ${cat.actions.map(action => `
            <button class="agent-caps-action ${action.isNav ? 'agent-caps-action--nav' : ''} ${action.isQuery ? 'agent-caps-action--query' : ''}"
              style="--act-color:${cat.color};--act-color-lt:${cat.colorLight}"
              onclick="agentTriggerAction('${action.id}', '${cat.id}')"
              title="${action.description || ''}">
              <span class="agent-caps-action-icon">${action.icon || cat.icon}</span>
              <div class="agent-caps-action-body">
                <div class="agent-caps-action-label">${action.label}</div>
                ${action.description ? `<div class="agent-caps-action-desc">${action.description}</div>` : ''}
              </div>
              <span class="agent-caps-action-badge ${action.isNav ? 'badge--nav' : action.isQuery ? 'badge--query' : 'badge--action'}">
                ${action.isNav ? '→' : action.isQuery ? '?' : '▶'}
              </span>
            </button>`
          ).join('')}
        </div>
      </div>`
    ).join('')}
  </div>

  <!-- Footer: quick examples -->
  <div class="agent-caps-footer">
    <div class="agent-caps-footer-label">💬 Ou escreva livremente:</div>
    <div class="agent-caps-examples">
      <button class="agent-caps-example" onclick="agentCloseCaps();agentSuggest('Quanto gastei este mês?')">💬 Quanto gastei?</button>
      <button class="agent-caps-example" onclick="agentCloseCaps();agentSuggest('criar despesa de R$')">💸 Nova despesa</button>
      <button class="agent-caps-example" onclick="agentCloseCaps();agentSuggest('como funciona o orçamento?')">❓ Como funciona?</button>
    </div>
  </div>
</div>`;

  _agentAppendStructured('assistant', html, 'Aqui estão tudo que posso fazer:');
  // scroll to bottom
  setTimeout(() => {
    const feed = document.getElementById('agentFeed');
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, 80);
}
window.agentShowCapabilities = agentShowCapabilities;

// ── Filter categories ────────────────────────────────────────────────────────
function agentFilterCaps(catId, btn) {
  // Update pills
  document.querySelectorAll('.agent-cats-pill').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');

  // Show/hide sections
  document.querySelectorAll('.agent-caps-section').forEach(sec => {
    sec.style.display = (catId === 'all' || sec.dataset.cat === catId) ? '' : 'none';
  });
}
window.agentFilterCaps = agentFilterCaps;

// ── Close capabilities panel ─────────────────────────────────────────────────
function agentCloseCaps() {
  const panel = document.getElementById('agentCapsPanel');
  if (panel) {
    panel.style.opacity = '0';
    panel.style.transform = 'translateY(8px)';
    setTimeout(() => panel.closest('.agent-msg')?.remove(), 200);
  }
}
window.agentCloseCaps = agentCloseCaps;

// ── Trigger a specific action ────────────────────────────────────────────────
function agentTriggerAction(actionId, catId) {
  const cat    = AGENT_CAPABILITIES[catId];
  const action = cat?.actions.find(a => a.id === actionId);
  if (!action) return;

  // Navigation shortcut
  if (action.isNav && action.shortcut?.startsWith('__nav__:')) {
    const page = action.shortcut.replace('__nav__:', '');
    agentCloseCaps();
    setTimeout(() => {
      if (typeof navigate === 'function') navigate(page);
      _agentAppend('assistant', `✅ Navegando para **${action.label}**…`);
    }, 150);
    return;
  }

  // Query shortcut — just send as text
  if (action.isQuery || !action.guided) {
    agentCloseCaps();
    setTimeout(() => {
      const input = document.getElementById('agentInput');
      if (input) { input.value = action.shortcut; input.focus(); }
      agentSend();
    }, 150);
    return;
  }

  // Guided multi-step flow
  agentCloseCaps();
  setTimeout(() => agentStartGuided(action, cat), 180);
}
window.agentTriggerAction = agentTriggerAction;

// ── Guided multi-step form ───────────────────────────────────────────────────
const _agentGuidedState = {
  action: null,
  cat:    null,
  values: {},
  step:   0,
};

function agentStartGuided(action, cat) {
  _agentGuidedState.action = action;
  _agentGuidedState.cat    = cat;
  _agentGuidedState.values = { ...(action.guided?.extra || {}) };
  _agentGuidedState.step   = 0;

  _agentRenderGuidedForm();
}
window.agentStartGuided = agentStartGuided;

function _agentRenderGuidedForm() {
  const { action, cat, values, step } = _agentGuidedState;
  if (!action?.guided) return;

  const { title, steps, confirmLabel } = action.guided;
  const totalSteps = steps.length;
  const pct = Math.round((step / totalSteps) * 100);

  // Build field rows
  const fieldsHtml = steps.map((s, i) => {
    const isDone    = i < step;
    const isCurrent = i === step;
    const val       = values[s.field];
    const displayVal = val !== undefined && val !== '' ? String(val) : null;

    let inputHtml = '';
    if (isCurrent) {
      inputHtml = _agentBuildGuidedInput(s, i);
    }

    return `
      <div class="agf-field ${isDone ? 'agf-field--done' : ''} ${isCurrent ? 'agf-field--active' : ''} ${!isDone && !isCurrent ? 'agf-field--pending' : ''}"
           id="agf-field-${i}">
        <div class="agf-field-row">
          <div class="agf-field-status">
            ${isDone    ? '<span class="agf-status-done">✓</span>'       : ''}
            ${isCurrent ? '<span class="agf-status-active"></span>'      : ''}
            ${!isDone && !isCurrent ? '<span class="agf-status-pending">'+(i+1)+'</span>' : ''}
          </div>
          <div class="agf-field-content">
            <div class="agf-field-label">
              ${s.label}
              ${s.required ? '<span class="agf-required">*</span>' : ''}
            </div>
            ${displayVal && !isCurrent ? `<div class="agf-field-value">${_agentFmtGuidedVal(s, displayVal)}</div>` : ''}
            ${isCurrent ? inputHtml : ''}
          </div>
        </div>
      </div>`;
  }).join('');

  // Progress bar
  const progressHtml = `
    <div class="agf-progress">
      <div class="agf-progress-bar" style="width:${pct}%"></div>
    </div>
    <div class="agf-progress-label">${step} de ${totalSteps} campos · ${pct}% preenchido</div>
  `;

  // Action buttons
  const allRequired = steps.filter(s => s.required);
  const allFilled   = allRequired.every(s => {
    const v = values[s.field];
    return v !== undefined && v !== '' && v !== null;
  });

  const buttonsHtml = `
    <div class="agf-buttons">
      ${step < totalSteps
        ? `<button class="agf-btn agf-btn--skip" onclick="agentGuidedSkip()" title="Pular campo opcional">
             Pular →
           </button>`
        : ''
      }
      ${allFilled || step >= totalSteps
        ? `<button class="agf-btn agf-btn--confirm" onclick="agentGuidedConfirm()">
             ✓ ${confirmLabel || 'Confirmar'}
           </button>`
        : `<button class="agf-btn agf-btn--confirm agf-btn--disabled" disabled title="Preencha os campos obrigatórios">
             ✓ ${confirmLabel || 'Confirmar'}
           </button>`
      }
    </div>`;

  const html = `
    <div class="agent-guided-form" id="agentGuidedForm">
      <!-- Header -->
      <div class="agf-header" style="--agf-color:${cat.color}">
        <span class="agf-header-icon">${action.icon || cat.icon}</span>
        <div class="agf-header-text">
          <div class="agf-title">${title}</div>
          <div class="agf-subtitle">Preencha os campos para criar</div>
        </div>
        <button class="agf-close" onclick="agentCancelGuided()">✕</button>
      </div>
      ${progressHtml}
      <div class="agf-fields">${fieldsHtml}</div>
      ${buttonsHtml}
    </div>`;

  // Remove previous guided form if exists
  document.getElementById('agentGuidedForm')?.closest('.agent-msg')?.remove();
  _agentAppendStructured('assistant', html, title);

  // Focus first input
  setTimeout(() => {
    const input = document.getElementById('agf-input-' + step);
    if (input) input.focus();
  }, 80);
  setTimeout(() => {
    const feed = document.getElementById('agentFeed');
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, 100);
}

function _agentBuildGuidedInput(step, idx) {
  const id = 'agf-input-' + idx;

  if (step.type === 'select' && step.options) {
    return `<select id="${id}" class="agf-input agf-select" onchange="agentGuidedInput(${idx}, this.value)" autocomplete="off">
      <option value="">— Selecionar —</option>
      ${step.options.map(o => `<option value="${o.value}">${o.label}</option>`).join('')}
    </select>`;
  }

  if (step.type === 'account') {
    const accounts = (window.state?.accounts || []).slice(0, 20);
    return `<div class="agf-input-with-chips">
      <input type="text" id="${id}" class="agf-input" placeholder="${step.placeholder || ''}"
        oninput="agentGuidedInputText(${idx}, this.value)"
        onkeydown="if(event.key==='Enter')agentGuidedAdvance(${idx})"
        autocomplete="off">
      ${accounts.length ? `<div class="agf-chips">
        ${accounts.slice(0,5).map(a => `<button class="agf-chip" onclick="agentGuidedPickChip(${idx},'${a.name.replace(/'/g,"\\'")}',document.getElementById('agf-input-${idx}'))">${a.name}</button>`).join('')}
      </div>` : ''}
    </div>`;
  }

  if (step.type === 'category') {
    const cats = (window.state?.categories || []).filter(c => c.type !== 'transferencia').slice(0, 20);
    return `<div class="agf-input-with-chips">
      <input type="text" id="${id}" class="agf-input" placeholder="${step.placeholder || ''}"
        oninput="agentGuidedInputText(${idx}, this.value)"
        onkeydown="if(event.key==='Enter')agentGuidedAdvance(${idx})"
        autocomplete="off">
      ${cats.length ? `<div class="agf-chips">
        ${cats.slice(0,6).map(c => `<button class="agf-chip" onclick="agentGuidedPickChip(${idx},'${c.name.replace(/'/g,"\\'")}',document.getElementById('agf-input-${idx}'))">${c.name}</button>`).join('')}
      </div>` : ''}
    </div>`;
  }

  if (step.type === 'money') {
    return `<div class="agf-money-wrap">
      <span class="agf-money-prefix">R$</span>
      <input type="text" id="${id}" class="agf-input agf-money" inputmode="decimal"
        placeholder="${step.placeholder || '0,00'}"
        oninput="agentGuidedInputMoney(${idx}, this.value)"
        onkeydown="if(event.key==='Enter')agentGuidedAdvance(${idx})"
        autocomplete="off">
    </div>`;
  }

  if (step.type === 'date') {
    const today = new Date().toISOString().slice(0,10);
    return `<input type="date" id="${id}" class="agf-input" value="${today}"
      onchange="agentGuidedInput(${idx}, this.value)"
      onkeydown="if(event.key==='Enter')agentGuidedAdvance(${idx})"
      autocomplete="off">`;
  }

  return `<input type="text" id="${id}" class="agf-input" placeholder="${step.placeholder || ''}"
    oninput="agentGuidedInputText(${idx}, this.value)"
    onkeydown="if(event.key==='Enter')agentGuidedAdvance(${idx})"
    autocomplete="off">`;
}

function _agentFmtGuidedVal(step, val) {
  if (step.type === 'money') return 'R$ ' + parseFloat(String(val).replace(',','.')).toFixed(2).replace('.', ',');
  if (step.type === 'date')  return new Date(val + 'T12:00').toLocaleDateString('pt-BR');
  if (step.type === 'select') {
    const opt = step.options?.find(o => o.value === val);
    return opt ? opt.label : val;
  }
  return val;
}

// ── Guided input handlers ────────────────────────────────────────────────────
window.agentGuidedInput = function(idx, val) {
  const step = _agentGuidedState.action?.guided?.steps?.[idx];
  if (!step) return;
  _agentGuidedState.values[step.field] = val;
  // Auto-advance for select
  if (step.type === 'select' && val) {
    setTimeout(() => agentGuidedAdvance(idx), 120);
  }
  _agentUpdateGuidedButtons();
};

window.agentGuidedInputText = function(idx, val) {
  const step = _agentGuidedState.action?.guided?.steps?.[idx];
  if (!step) return;
  _agentGuidedState.values[step.field] = val;
  _agentUpdateGuidedButtons();
};

window.agentGuidedInputMoney = function(idx, val) {
  const step = _agentGuidedState.action?.guided?.steps?.[idx];
  if (!step) return;
  const num = parseFloat(String(val).replace(/\./g,'').replace(',','.'));
  _agentGuidedState.values[step.field] = isNaN(num) ? val : num;
  _agentUpdateGuidedButtons();
};

window.agentGuidedPickChip = function(idx, val, inputEl) {
  if (inputEl) inputEl.value = val;
  agentGuidedInputText(idx, val);
  setTimeout(() => agentGuidedAdvance(idx), 100);
};

window.agentGuidedAdvance = function(idx) {
  const steps = _agentGuidedState.action?.guided?.steps || [];
  const step  = steps[idx];
  const val   = _agentGuidedState.values[step?.field];

  if (step?.required && (!val && val !== 0)) {
    // Shake the input
    const el = document.getElementById('agf-input-' + idx);
    if (el) { el.style.borderColor = 'var(--red)'; el.focus(); setTimeout(() => el.style.borderColor = '', 1200); }
    return;
  }

  if (idx + 1 < steps.length) {
    _agentGuidedState.step = idx + 1;
    _agentRenderGuidedForm();
  }
};

window.agentGuidedSkip = function() {
  const steps  = _agentGuidedState.action?.guided?.steps || [];
  const curIdx = _agentGuidedState.step;
  if (curIdx + 1 < steps.length) {
    _agentGuidedState.step = curIdx + 1;
    _agentRenderGuidedForm();
  }
};

window.agentGuidedConfirm = async function() {
  const { action, values } = _agentGuidedState;
  if (!action?.guided) return;

  const steps = action.guided.steps;
  // Final validation
  for (const s of steps) {
    if (s.required && (!values[s.field] && values[s.field] !== 0)) {
      toast(`Campo obrigatório: ${s.label}`, 'warning');
      return;
    }
  }

  // Build plan and execute via agent dispatch
  const intent  = action.guided.intent;
  const data    = { ...values };

  // Normalize: if date not set, use today
  if (!data.date && !data.start_date) {
    data.date = new Date().toISOString().slice(0,10);
  }

  // Build natural-language summary
  let summary = '';
  if (intent === 'create_transaction') {
    const sign = data.type === 'income' ? '+' : '-';
    const amt  = data.amount ? 'R$' + Math.abs(data.amount).toFixed(2).replace('.',',') : '';
    summary = `${sign}${amt} — ${data.description || ''}`;
  } else if (intent === 'create_scheduled') {
    summary = `Programado: ${data.description || ''} — ${data.amount ? 'R$'+data.amount : ''}`;
  } else if (intent === 'create_account') {
    summary = `Conta: ${data.name}`;
  } else if (intent === 'create_dream') {
    summary = `Sonho: ${data.name} — R$${data.target_amount || ''}`;
  } else {
    summary = `${action.label}: ${data.name || data.description || ''}`;
  }

  // Close guided form
  document.getElementById('agentGuidedForm')?.closest('.agent-msg')?.remove();

  // Inject into agent pipeline via fake message
  const fakeMsg = JSON.stringify({ _guided: true, intent, data, summary });
  _agentGuidedState.action = null;
  _agentGuidedState.values = {};
  _agentGuidedState.step   = 0;

  // Emit into feed
  _agentAppend('user', action.guided.confirmLabel || 'Confirmar');
  _agentSetLoading(true);

  try {
    // Build plan directly
    const plan = {
      intent,
      summary,
      requires_confirmation: false,
      missing_fields: [],
      guided: false,
      actions: [{ type: intent, data }],
    };
    await _agentExecute(plan, summary);
  } catch(e) {
    _agentAppend('assistant', '❌ Erro: ' + (e.message || e));
  } finally {
    _agentSetLoading(false);
  }
};

window.agentCancelGuided = function() {
  document.getElementById('agentGuidedForm')?.closest('.agent-msg')?.remove();
  _agentGuidedState.action = null;
  _agentGuidedState.values = {};
  _agentGuidedState.step   = 0;
  _agentAppend('assistant', '↩️ Formulário cancelado. Como posso ajudar?');
};

function _agentUpdateGuidedButtons() {
  const { action, values } = _agentGuidedState;
  if (!action?.guided) return;
  const steps = action.guided.steps;
  const allRequired = steps.filter(s => s.required);
  const allFilled   = allRequired.every(s => {
    const v = values[s.field];
    return v !== undefined && v !== '' && v !== null;
  });
  const confirmBtn = document.querySelector('.agf-btn--confirm');
  if (confirmBtn) {
    confirmBtn.disabled = !allFilled;
    confirmBtn.classList.toggle('agf-btn--disabled', !allFilled);
  }
}


// ════════════════════════════════════════════════════════════════════════════
// CONTEXTUAL SUGGESTIONS — mostra ações relevantes após operações
// ════════════════════════════════════════════════════════════════════════════

/**
 * Mostra sugestões contextuais relevantes após uma ação bem-sucedida.
 * Ex: depois de criar uma despesa, sugere "Ver extrato" ou "Criar outra"
 */
function agentShowContextualSuggestions(intent, data) {
  const suggestions = _agentGetContextualSuggestions(intent, data);
  if (!suggestions.length) return;

  const html = `
<div class="agent-ctx-suggestions">
  <div class="agent-ctx-label">O que deseja fazer agora?</div>
  <div class="agent-ctx-chips">
    ${suggestions.map(s => `
      <button class="agent-ctx-chip ${s.primary ? 'agent-ctx-chip--primary' : ''}"
        onclick="${s.action}">
        ${s.icon} ${s.label}
      </button>`
    ).join('')}
  </div>
</div>`;

  _agentAppendStructured('assistant', html, 'Sugestões contextuais');
}
window.agentShowContextualSuggestions = agentShowContextualSuggestions;

function _agentGetContextualSuggestions(intent, data) {
  const suggs = {
    create_transaction: [
      { icon:'💸', label:'Outra despesa',       action:"agentSuggest('criar despesa')",           primary: true },
      { icon:'📊', label:'Ver extrato',          action:"navigate('transactions');toggleAgent()" },
      { icon:'🎯', label:'Verificar orçamento',  action:"agentSuggest('como estão meus orçamentos?')" },
    ],
    create_scheduled: [
      { icon:'📅', label:'Ver programados',      action:"navigate('scheduled');toggleAgent()",     primary: true },
      { icon:'📋', label:'Outro programado',      action:"agentSuggest('criar programado')" },
    ],
    create_account: [
      { icon:'🏦', label:'Ver contas',           action:"navigate('accounts');toggleAgent()",      primary: true },
      { icon:'💸', label:'Registrar despesa',    action:"agentSuggest('criar despesa')" },
    ],
    create_dream: [
      { icon:'🌟', label:'Ver sonhos',           action:"navigate('dreams');toggleAgent()",        primary: true },
      { icon:'✨', label:'Outro sonho',           action:"agentSuggest('criar sonho')" },
    ],
    create_debt: [
      { icon:'💳', label:'Ver dívidas',          action:"navigate('debts');toggleAgent()",         primary: true },
      { icon:'💳', label:'Pagar parcela',         action:"agentSuggest('pagar dívida')" },
    ],
    create_payee: [
      { icon:'💸', label:'Criar despesa com ele', action:"agentSuggest('criar despesa')",          primary: true },
      { icon:'👤', label:'Outro beneficiário',    action:"agentSuggest('criar beneficiário')" },
    ],
    create_category: [
      { icon:'💸', label:'Criar despesa nessa categoria', action:"agentSuggest('criar despesa')", primary: true },
      { icon:'🎯', label:'Criar orçamento',        action:"navigate('budgets');toggleAgent()" },
    ],
  };
  return suggs[intent] || [];
}

// ── Hook into agent execute success ─────────────────────────────────────────
// Called by agent.js after allOk — patches _agentRefreshAfterPlan to show
// contextual suggestions
const _originalRefreshAfterPlan = window._agentRefreshAfterPlan;

// We patch via monkey-patching after agent.js loads
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    const originalFn = window._agentRefreshAfterPlan;
    if (typeof originalFn === 'function') {
      window._agentRefreshAfterPlan = async function(plan) {
        await originalFn(plan);
        // Show contextual suggestions for create intents
        const intent = plan?.intent || plan?.actions?.[0]?.type;
        const data   = plan?.actions?.[0]?.data || {};
        if (intent && intent.startsWith('create_')) {
          setTimeout(() => agentShowContextualSuggestions(intent, data), 400);
        }
      };
    }
  }, 500);
});

// ════════════════════════════════════════════════════════════════════════════
// SEARCH INSIDE CAPABILITIES
// ════════════════════════════════════════════════════════════════════════════

function agentSearchCaps(query) {
  const q = (query || '').toLowerCase().trim();
  const grid = document.getElementById('agentCapsGrid');
  if (!grid) return;

  if (!q) {
    // Show all
    document.querySelectorAll('.agent-caps-section').forEach(s => s.style.display = '');
    document.querySelectorAll('.agent-caps-action').forEach(a => a.style.display = '');
    return;
  }

  // Search through capabilities
  Object.values(AGENT_CAPABILITIES).forEach(cat => {
    const section = grid.querySelector(`[data-cat="${cat.id}"]`);
    if (!section) return;

    let anyVisible = false;
    cat.actions.forEach((action, idx) => {
      const btn = section.querySelectorAll('.agent-caps-action')[idx];
      if (!btn) return;
      const searchable = `${action.label} ${action.description || ''} ${action.example || ''}`.toLowerCase();
      const matches = searchable.includes(q) || cat.label.toLowerCase().includes(q);
      btn.style.display = matches ? '' : 'none';
      if (matches) anyVisible = true;
    });

    section.style.display = anyVisible ? '' : 'none';
  });
}
window.agentSearchCaps = agentSearchCaps;

