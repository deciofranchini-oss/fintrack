/* ═══════════════════════════════════════════════════════════════════════════
   AGENT.JS — FinTrack Copiloto v5
   Redesenhado para alinhar com o app e cobrir todas as funcionalidades.
   Arquitetura: Gemini Function Calling → ferramentas declarativas → ações reais.
═══════════════════════════════════════════════════════════════════════════ */

const _ag = {
  open: false, loading: false, apiKey: null,
  history: [], ctx: null, ctxTs: 0, welcomed: false,
};
const _AG_CTX_TTL = 90_000;

/* ════════════════════════════════════════════════════════════════════════════
   FERRAMENTAS — todas as ações do FinTrack
════════════════════════════════════════════════════════════════════════════ */
const _AG_TOOLS = [{ function_declarations: [

  // ── CONSULTAS ─────────────────────────────────────────────────────────────
  {
    name: 'get_summary',
    description: 'Resumo financeiro completo: saldo total, receitas e despesas do mês, patrimônio líquido, top categorias, programados próximos.',
    parameters: { type:'object', properties:{} },
  },
  {
    name: 'get_accounts',
    description: 'Lista todas as contas com saldos atuais, tipo e moeda.',
    parameters: { type:'object', properties:{} },
  },
  {
    name: 'get_transactions',
    description: 'Lista transações por período, conta, categoria ou tipo.',
    parameters: {
      type:'object',
      properties: {
        period:        { type:'string', description:'este_mes | mes_passado | ultimos_30_dias | ultimos_90_dias | este_ano | YYYY-MM' },
        account_name:  { type:'string' },
        category_name: { type:'string' },
        payee_name:    { type:'string' },
        type:          { type:'string', enum:['expense','income','all'] },
        limit:         { type:'number' },
      },
    },
  },
  {
    name: 'search_transactions',
    description: 'Busca transações por texto na descrição ou beneficiário.',
    parameters: { type:'object', properties:{ query:{type:'string'}, limit:{type:'number'} }, required:['query'] },
  },
  {
    name: 'get_budgets',
    description: 'Status dos orçamentos do mês com percentual gasto.',
    parameters: { type:'object', properties:{} },
  },
  {
    name: 'get_scheduled',
    description: 'Programados ativos e próximas ocorrências.',
    parameters: { type:'object', properties:{ days_ahead:{type:'number'} } },
  },
  {
    name: 'get_debts',
    description: 'Dívidas ativas com saldo e credor.',
    parameters: { type:'object', properties:{} },
  },
  {
    name: 'get_investments',
    description: 'Carteira de investimentos com posições e rentabilidade.',
    parameters: { type:'object', properties:{} },
  },
  {
    name: 'get_dreams',
    description: 'Objetivos/sonhos financeiros com progresso.',
    parameters: { type:'object', properties:{} },
  },
  {
    name: 'get_receivables',
    description: 'Valores a receber pendentes.',
    parameters: { type:'object', properties:{} },
  },

  // ── CRIAÇÃO / ALTERAÇÃO DE TRANSAÇÕES ────────────────────────────────────
  {
    name: 'create_transaction',
    description: 'Cria uma transação (despesa ou receita) diretamente. Confirma antes de executar.',
    parameters: {
      type:'object',
      properties: {
        type:          { type:'string', enum:['expense','income'] },
        amount:        { type:'number' },
        description:   { type:'string' },
        account_name:  { type:'string' },
        category_name: { type:'string' },
        payee_name:    { type:'string' },
        date:          { type:'string', description:'YYYY-MM-DD (padrão: hoje)' },
        memo:          { type:'string' },
        status:        { type:'string', enum:['confirmed','pending'], description:'padrão: confirmed' },
      },
      required:['type','amount','description'],
    },
  },
  {
    name: 'create_transfer',
    description: 'Transferência entre contas.',
    parameters: {
      type:'object',
      properties: {
        amount:            { type:'number' },
        from_account_name: { type:'string' },
        to_account_name:   { type:'string' },
        description:       { type:'string' },
        date:              { type:'string' },
      },
      required:['amount','from_account_name','to_account_name'],
    },
  },
  {
    name: 'open_new_transaction_form',
    description: 'Abre o formulário de nova transação com campos pré-preenchidos para o usuário revisar.',
    parameters: {
      type:'object',
      properties: {
        type:          { type:'string', enum:['expense','income'] },
        amount:        { type:'number' },
        description:   { type:'string' },
        account_name:  { type:'string' },
        category_name: { type:'string' },
        payee_name:    { type:'string' },
      },
    },
  },

  // ── PROGRAMADOS ───────────────────────────────────────────────────────────
  {
    name: 'create_scheduled',
    description: 'Cria transação recorrente (programado).',
    parameters: {
      type:'object',
      properties: {
        type:          { type:'string', enum:['expense','income'] },
        amount:        { type:'number' },
        description:   { type:'string' },
        account_name:  { type:'string' },
        category_name: { type:'string' },
        frequency:     { type:'string', enum:['monthly','weekly','biweekly','yearly','once'] },
        start_date:    { type:'string' },
      },
      required:['type','amount','description','frequency'],
    },
  },
  {
    name: 'toggle_scheduled',
    description: 'Pausa ou retoma um programado.',
    parameters: {
      type:'object',
      properties: {
        name:   { type:'string' },
        action: { type:'string', enum:['pause','resume'] },
      },
      required:['name','action'],
    },
  },

  // ── ORÇAMENTOS ────────────────────────────────────────────────────────────
  {
    name: 'create_budget',
    description: 'Cria orçamento mensal para uma categoria.',
    parameters: {
      type:'object',
      properties: {
        category_name: { type:'string' },
        amount:        { type:'number' },
        month:         { type:'string', description:'YYYY-MM' },
      },
      required:['category_name','amount'],
    },
  },

  // ── CATEGORIAS ────────────────────────────────────────────────────────────
  {
    name: 'create_category',
    description: 'Cria uma nova categoria de despesa ou receita.',
    parameters: {
      type:'object',
      properties: {
        name:        { type:'string' },
        type:        { type:'string', enum:['despesa','receita'] },
        icon:        { type:'string', description:'emoji' },
        color:       { type:'string', description:'hex color' },
        parent_name: { type:'string', description:'nome da categoria pai (para subcategoria)' },
      },
      required:['name','type'],
    },
  },

  // ── BENEFICIÁRIOS ─────────────────────────────────────────────────────────
  {
    name: 'create_payee',
    description: 'Cria um novo beneficiário/fonte pagadora.',
    parameters: {
      type:'object',
      properties: {
        name:          { type:'string' },
        type:          { type:'string', enum:['beneficiario','fonte_pagadora','ambos'] },
        category_name: { type:'string', description:'categoria padrão' },
      },
      required:['name'],
    },
  },

  // ── SONHOS / OBJETIVOS ────────────────────────────────────────────────────
  {
    name: 'create_dream',
    description: 'Cria um objetivo/sonho financeiro.',
    parameters: {
      type:'object',
      properties: {
        title:         { type:'string' },
        target_amount: { type:'number' },
        dream_type:    { type:'string', enum:['imovel','automovel','viagem','educacao','investimento','outro'] },
        target_date:   { type:'string', description:'YYYY-MM-DD' },
        description:   { type:'string' },
        priority:      { type:'number', description:'1 = mais urgente' },
      },
      required:['title','target_amount'],
    },
  },

  // ── LISTA DE COMPRAS ──────────────────────────────────────────────────────
  {
    name: 'add_grocery_item',
    description: 'Adiciona item à lista de compras ativa.',
    parameters: {
      type:'object',
      properties: {
        name:            { type:'string' },
        qty:             { type:'number' },
        unit:            { type:'string' },
        suggested_price: { type:'number' },
      },
      required:['name'],
    },
  },

  // ── NAVEGAÇÃO ─────────────────────────────────────────────────────────────
  {
    name: 'navigate_to',
    description: 'Navega para uma página do app.',
    parameters: {
      type:'object',
      properties: {
        page: {
          type:'string',
          enum:['dashboard','transactions','accounts','scheduled','budgets','reports',
                'categories','payees','investments','debts','dreams','grocery',
                'prices','ai_insights','receivables'],
        },
      },
      required:['page'],
    },
  },

  // ── PERGUNTAS GERAIS (financeiras sem ferramentas) ─────────────────────────
  {
    name: 'answer_financial_question',
    description: 'Responde perguntas gerais sobre finanças pessoais, conceitos financeiros, dicas, planejamento, impostos, investimentos, educação financeira — qualquer pergunta que não precise consultar dados do app.',
    parameters: {
      type:'object',
      properties: {
        topic:    { type:'string', description:'tópico da pergunta' },
        question: { type:'string', description:'pergunta completa' },
      },
      required:['question'],
    },
  },

]}];

/* ════════════════════════════════════════════════════════════════════════════
   SYSTEM PROMPT
════════════════════════════════════════════════════════════════════════════ */
function _agSystemPrompt(ctx) {
  const s    = ctx.snapshot;
  const acc  = ctx.accounts.map(a => `${a.name} (${a.typePt}, ${a.currency}, saldo: ${a.balanceFmt}${a.negative?' ⚠️ NEGATIVO':''})`).join('\n  ');
  const cExp = ctx.categories.filter(c=>c.type==='despesa'&&!c.parent_id).map(c=>c.name).join(', ');
  const cInc = ctx.categories.filter(c=>c.type==='receita'&&!c.parent_id).map(c=>c.name).join(', ');
  const pays = ctx.payees.slice(0,60).map(p=>p.name).join(', ');
  const sch  = ctx.scheduled.slice(0,20).map(s=>`${s.description} (${s.freqPt}, ${s.typePt}, R$${Math.abs(s.amount).toFixed(2)})`).join('\n  ');
  const dbt  = ctx.debts.length ? ctx.debts.map(d=>`${d.name}: ${d.balanceFmt}${d.creditor?' — '+d.creditor:''}`).join('\n  ') : 'Nenhuma';
  const bud  = ctx.budgets.length ? ctx.budgets.map(b=>`${b.category}: ${b.pct}% de ${b.limitFmt}`).join('\n  ') : 'Nenhum';

  return `Você é o **FinTrack Agent**, assistente financeiro pessoal da família no app FinTrack.

## IDENTIDADE
- Tom: amigável, direto, preciso — consultor financeiro de confiança da família
- Idioma: SEMPRE português brasileiro
- Use emojis com parcimônia (1-2 por resposta, nunca excessivo)
- Respostas objetivas: máximo 3 parágrafos para consultas, 1 linha para confirmações
- Para perguntas gerais de finanças (que não precisam de dados do app), use **answer_financial_question** — você SABE responder sobre: investimentos, impostos, planejamento financeiro, CDB, tesouro direto, FGTS, aposentadoria, inflação, câmbio, criptomoedas, mercado de ações, seguros, etc.
- NUNCA diga que não sabe responder perguntas financeiras gerais — você é especialista

## DADOS REAIS DA FAMÍLIA (${ctx.today})
**Página atual:** ${ctx.currentPage}
**Saldo total:** ${s.totalSaldoFmt} | **Dívidas:** ${s.debtTotalFmt} | **Patrimônio:** ${s.patrimonioFmt}
**Mês ${ctx.monthName}:** Receitas ${s.incomeMonthFmt} · Despesas ${s.expenseMonthFmt} · Saldo ${s.balanceMonthFmt}
${s.topCats.length ? `**Top gastos:** ${s.topCats.slice(0,5).join(' | ')}` : ''}
${s.upcomingCount ? `**Próximos 7 dias:** ${s.upcomingCount} programados (${s.upcomingDesc.join(', ')})` : ''}

### Contas disponíveis:
  ${acc || 'Nenhuma'}

### Categorias de despesa: ${cExp || 'nenhuma'}
### Categorias de receita: ${cInc || 'nenhuma'}
### Beneficiários frequentes: ${pays || 'nenhum'}

### Programados ativos:
  ${sch || 'Nenhum'}

### Dívidas:
  ${dbt}

### Orçamentos mês:
  ${bud}

## REGRAS DE FERRAMENTAS
- **Consultas** → use get_* para dados reais; não invente números
- **Ações** → sempre confirme antes de criar/alterar dados (1 mensagem de confirmação, breve)
- **Confirmação do usuário** (sim/pode/ok/confirma/vai/registra/salva) → execute IMEDIATAMENTE com create_transaction (status padrão: pendente validação)
- **Criar transação definitiva** → só use status 'confirmed' quando o usuário dizer explicitamente: "definitivo", "confirmar agora", "salvar definitivo", "sem revisão"
- **Criar transação** → use SEMPRE create_transaction; se conta não informada, use a conta corrente principal; SEMPRE criar como pendente a não ser que usuário peça definitivo
- **Transações pendentes**: ficam aguardando validação no app (Menu → Validar transações por chat)
- **Perguntas financeiras gerais** → use answer_financial_question (educação financeira, conceitos, estratégias)
- **Navegação** → use navigate_to para ir a páginas
- Resolva nomes de contas/categorias pelos dados acima (fuzzy match tolerante)
- Se faltarem dados obrigatórios, pergunte apenas o essencial (1 pergunta por vez)`;
}

/* ════════════════════════════════════════════════════════════════════════════
   CONTEXTO DA FAMÍLIA
════════════════════════════════════════════════════════════════════════════ */
async function _agGetContext() {
  if (_ag.ctx && (Date.now() - _ag.ctxTs) < _AG_CTX_TTL) return _ag.ctx;
  const fid = typeof famId === 'function' ? famId() : null;
  if (!fid) return _agCtxEmpty();

  try {
    if (!state.accounts?.length)   await DB.accounts.load();
    if (!state.categories?.length) await DB.categories.load();
    if (!state.payees?.length)     await DB.payees.load();
    if (!state.scheduled?.length && typeof loadScheduled==='function') await loadScheduled();
    if (!state.budgets?.length    && typeof loadBudgets==='function')   await loadBudgets();
  } catch(_) {}

  const now  = new Date();
  const y    = now.getFullYear();
  const mon  = String(now.getMonth()+1).padStart(2,'0');
  const today= now.toISOString().slice(0,10);
  const months_pt = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

  let monthlyTxs = [];
  try {
    const { data } = await famQ(
      sb.from('transactions')
        .select('id,date,description,amount,brl_amount,currency,is_transfer,is_card_payment,category_id,account_id,payee_id,status')
    ).gte('date',`${y}-${mon}-01`).lte('date',`${y}-${mon}-31`).eq('status','confirmed').order('date',{ascending:false}).limit(300);
    monthlyTxs = (data||[]).filter(t=>!t.is_transfer&&!t.is_card_payment);
  } catch(_) {}

  let debts = [];
  try {
    const { data:dd } = await famQ(
      sb.from('debts').select('id,description,name,current_balance,original_amount,currency,status,creditor,creditor_payee_id')
    ).eq('status','active');
    debts = dd||[];
  } catch(_) {}

  const accs    = state.accounts   || [];
  const cats    = state.categories || [];
  const payees  = state.payees     || [];
  const sched   = state.scheduled  || [];
  const budgets = state.budgets    || [];

  const brl  = (v,cur) => typeof toBRL   ==='function'? toBRL(+v||0,cur||'BRL')    : +v||0;
  const fmt  = (v)     => typeof dashFmt ==='function'? dashFmt(Math.abs(+v||0),'BRL') : `R$${(+v||0).toFixed(2)}`;
  const typePtAcc = t => ({corrente:'Conta corrente',poupanca:'Poupança',cartao_credito:'Cartão de crédito',investimento:'Investimento',dinheiro:'Dinheiro',outros:'Outros',programa_fidelidade:'Prog. Fidelidade'}[t]||t);
  // Only show transactionable accounts (exclude loyalty/investment for tx context)
  const accForTx = accs.filter(a => a.type !== 'programa_fidelidade');
  const typePtSc  = t => ({expense:'Despesa',income:'Receita',transfer:'Transferência'}[t]||t);
  const freqPt    = f => ({monthly:'Mensal',weekly:'Semanal',biweekly:'Quinzenal',yearly:'Anual',once:'Única vez'}[f]||f);

  const totalSaldo = accs.reduce((s,a)=>s+brl(a.balance||0,a.currency),0);
  const debtTotal  = debts.reduce((s,d)=>s+brl(d.current_balance??d.original_amount,d.currency),0);

  let incomeMonth=0, expenseMonth=0;
  const byCat = {};
  monthlyTxs.forEach(t=>{
    const v = brl(t.brl_amount??t.amount,t.currency);
    if(v>0) incomeMonth+=v; else expenseMonth+=Math.abs(v);
    const catName = cats.find(c=>c.id===t.category_id)?.name;
    if(v<0&&catName) byCat[catName]=(byCat[catName]||0)+Math.abs(v);
  });
  const topCats = Object.entries(byCat).sort(([,a],[,b])=>b-a).slice(0,6).map(([n,v])=>`${n} (${fmt(v)})`);

  const upcoming = sched.filter(sc=>{
    if((sc.status||'active')!=='active') return false;
    const d = sc.start_date||sc.next_occurrence||'';
    if(!d) return false;
    const diff = (new Date(d)-new Date(today))/86400000;
    return diff>=0&&diff<=7;
  });

  const budgetObjs = budgets.slice(0,10).map(b=>{
    const catName = cats.find(c=>c.id===b.category_id)?.name||'?';
    const pct = b.amount>0?Math.round((+(b.spent||0)/+b.amount)*100):0;
    return {id:b.id,category:catName,category_id:b.category_id,limit:+b.amount,spent:+(b.spent||0),pct,limitFmt:fmt(+b.amount)};
  });

  _ag.ctx = {
    today, familyId:fid, monthName:months_pt[now.getMonth()],
    currentPage: window.state?.currentPage||'dashboard',
    accounts: accForTx.map(a=>({id:a.id,name:a.name,type:a.type,typePt:typePtAcc(a.type),currency:a.currency||'BRL',balance:brl(a.balance||0,a.currency),balanceFmt:fmt(brl(a.balance||0,a.currency)),negative:brl(a.balance||0,a.currency)<0})),
    categories: cats.map(c=>({id:c.id,name:c.name,type:c.type,parent_id:c.parent_id})),
    payees: payees.map(p=>({id:p.id,name:p.name,default_category_id:p.default_category_id})),
    scheduled: sched.filter(s=>(s.status||'active')==='active').map(s=>({id:s.id,description:s.description,amount:s.amount,type:s.type,typePt:typePtSc(s.type),frequency:s.frequency,freqPt:freqPt(s.frequency),account_id:s.account_id,next:s.start_date||s.next_occurrence||''})),
    debts: debts.map(d=>({id:d.id,name:d.description||d.name,balance:brl(d.current_balance??d.original_amount,d.currency),balanceFmt:fmt(brl(d.current_balance??d.original_amount,d.currency)),creditor:typeof d.creditor==='object'?d.creditor?.name:d.creditor})),
    budgets: budgetObjs,
    snapshot:{
      totalSaldoFmt:fmt(totalSaldo),totalSaldo,debtTotalFmt:fmt(debtTotal),debtTotal,
      patrimonioFmt:fmt(totalSaldo-debtTotal),
      incomeMonthFmt:fmt(incomeMonth),incomeMonth,
      expenseMonthFmt:fmt(expenseMonth),expenseMonth,
      balanceMonthFmt:fmt(incomeMonth-expenseMonth),
      topCats,txCount:monthlyTxs.length,
      upcomingCount:upcoming.length,upcomingDesc:upcoming.slice(0,3).map(s=>s.description),
    },
  };
  _ag.ctxTs = Date.now();
  return _ag.ctx;
}
/* ════════════════════════════════════════════════════════════════════════════
   n8n PROXY — processa mensagem via webhook n8n em vez do Gemini direto
   O n8n recebe: { message, family_id, session_id, user_id, today }
   O n8n retorna: { ok, text, tool_executed?, tool_result?, error? }
════════════════════════════════════════════════════════════════════════════ */
async function _agProcessViaProxy(userText, webhookUrl) {
  const fid     = typeof famId === 'function' ? famId() : null;
  const userId  = currentUser?.app_user_id || currentUser?.id || null;
  const n8nKey  = await getAppSetting('agent_n8n_secret_key', '').catch(() => '');

  const headers = { 'Content-Type': 'application/json' };
  if (n8nKey) headers['x-fintrack-key'] = String(n8nKey);

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message:    userText,
        family_id:  fid,
        session_id: _ag._n8nSession || (_ag._n8nSession = crypto.randomUUID()),
        user_id:    userId,
        today:      new Date().toISOString().slice(0, 10),
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => `HTTP ${res.status}`);
      throw new Error(`n8n respondeu com erro ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();

    if (!data.ok) {
      throw new Error(data.error || 'Resposta inválida do n8n');
    }

    // Show tool execution feedback if reported by n8n
    if (data.tool_executed) {
      _agAppendToolCall(data.tool_executed, data.tool_args || {});
    }

    _agAppendBot(data.text || '(sem resposta)');

    // Refresh dashboard data if n8n created/modified transactions
    if (data.tool_executed && data.tool_executed.includes('transaction')) {
      _agInvalidateCtx();
      setTimeout(() => {
        if (typeof loadTransactions === 'function') loadTransactions(true).catch(() => {});
        if (typeof loadDashboard    === 'function') loadDashboard().catch(() => {});
      }, 500);
    }

  } catch(err) {
    console.error('[Agent n8n]', err);
    _agAppendBot(`❌ Erro ao conectar ao n8n: ${err.message}\n\n_Verifique a URL do webhook em Configurações → IA._`);
  } finally {
    _agSetLoading(false);
  }
}

function _agCtxEmpty() {
  return { today:new Date().toISOString().slice(0,10), familyId:null, monthName:'', currentPage:'dashboard', accounts:[], categories:[], payees:[], scheduled:[], debts:[], budgets:[], snapshot:{totalSaldoFmt:'R$0',totalSaldo:0,debtTotalFmt:'R$0',debtTotal:0,patrimonioFmt:'R$0',incomeMonthFmt:'R$0',expenseMonthFmt:'R$0',balanceMonthFmt:'R$0',topCats:[],txCount:0,upcomingCount:0,upcomingDesc:[]} };
}
function _agInvalidateCtx() { _ag.ctxTs = 0; }

/* ════════════════════════════════════════════════════════════════════════════
   CHAMADA AO GEMINI
════════════════════════════════════════════════════════════════════════════ */
async function _agCallGemini(userText, ctx, toolResultParts) {
  const model = typeof getGeminiModel==='function' ? await getGeminiModel() : 'gemini-2.5-flash';
  const url   = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${_ag.apiKey}`;

  if (userText) _ag.history.push({role:'user',parts:[{text:userText}]});
  if (toolResultParts) {
    _ag.history.push({role:'model',parts:toolResultParts.modelParts});
    _ag.history.push({role:'user', parts:toolResultParts.resultParts});
  }
  if (_ag.history.length > 40) _ag.history = _ag.history.slice(-40);

  const body = {
    system_instruction: {parts:[{text:_agSystemPrompt(ctx)}]},
    contents: _ag.history,
    tools: _AG_TOOLS,
    tool_config: {function_calling_config:{mode:'AUTO'}},
    generationConfig: {
      temperature: 0.35,
      maxOutputTokens: 1500,
      // Agent uses multi-turn function calling — needs reasoning to resolve account/category names
      // and maintain conversation context. Allow a small thinking budget (not zero).
      thinkingConfig: { thinkingBudget: /gemini-2\.5/.test(model) ? 1024 : 0 },
    },
  };

  return geminiRetryFetch(url, body, {
    onRetry: (attempt, max, waitMs) => _agUpdateRetryStatus(attempt, max, waitMs),
  });
}

function _agUpdateRetryStatus(attempt, max, waitMs) {
  const statusEl = document.getElementById('agentStatusText');
  const dot      = document.querySelector('.ag-status-dot');
  if (statusEl) statusEl.textContent = `Alta demanda — tentativa ${attempt}/${max} em ${waitMs/1000}s…`;
  if (dot) dot.style.cssText = 'background:#f59e0b;box-shadow:0 0 6px #f59e0b';
}

/* ════════════════════════════════════════════════════════════════════════════
   EXECUÇÃO DAS FERRAMENTAS
════════════════════════════════════════════════════════════════════════════ */
async function _agExecTool(name, args, ctx) {
  const fid = ctx.familyId||(typeof famId==='function'?famId():null);
  const brl = (v,cur) => typeof toBRL  ==='function'?toBRL(+v||0,cur||'BRL'):+v||0;
  const fmt = (v)     => typeof dashFmt==='function'?dashFmt(Math.abs(+v||0),'BRL'):`R$${(+v||0).toFixed(2)}`;
  const match = (list,query,key='name') => {
    if(!query) return null;
    const q = query.toLowerCase().trim();
    return list.find(x=>(x[key]||'').toLowerCase()===q)
        || list.find(x=>(x[key]||'').toLowerCase().includes(q))
        || list.find(x=>q.includes((x[key]||'').toLowerCase())&&(x[key]||'').length>3)
        || null;
  };

  switch(name) {

    case 'get_summary': {
      const s = ctx.snapshot;
      return {saldo_total:s.totalSaldoFmt,dividas:s.debtTotalFmt,patrimonio:s.patrimonioFmt,receitas_mes:s.incomeMonthFmt,despesas_mes:s.expenseMonthFmt,saldo_mes:s.balanceMonthFmt,transacoes_mes:s.txCount,top_categorias:s.topCats,programados_proximos:s.upcomingCount};
    }

    case 'get_accounts': {
      return ctx.accounts.map(a=>({nome:a.name,tipo:a.typePt,moeda:a.currency,saldo:a.balanceFmt,negativo:a.negative}));
    }

    case 'get_transactions': {
      const now = new Date();
      let from, to;
      const p = (args.period||'este_mes').toLowerCase();
      const mStr = () => String(now.getMonth()+1).padStart(2,'0');
      if (p==='este_mes') { from=`${now.getFullYear()}-${mStr()}-01`; to=now.toISOString().slice(0,10); }
      else if (p==='mes_passado') { const d=new Date(now.getFullYear(),now.getMonth()-1,1); from=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; to=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-31`; }
      else if (p==='ultimos_30_dias') { const d=new Date(now); d.setDate(d.getDate()-30); from=d.toISOString().slice(0,10); to=now.toISOString().slice(0,10); }
      else if (p==='ultimos_90_dias') { const d=new Date(now); d.setDate(d.getDate()-90); from=d.toISOString().slice(0,10); to=now.toISOString().slice(0,10); }
      else if (p==='este_ano') { from=`${now.getFullYear()}-01-01`; to=now.toISOString().slice(0,10); }
      else if (/^\d{4}-\d{2}$/.test(p)) { from=`${p}-01`; to=`${p}-31`; }
      else { from=`${now.getFullYear()}-${mStr()}-01`; to=now.toISOString().slice(0,10); }
      const lim = Math.min(+(args.limit)||20,100);
      let q = famQ(sb.from('transactions').select('id,date,description,amount,brl_amount,currency,is_transfer,is_card_payment,category_id,account_id,payee_id')).gte('date',from).lte('date',to).eq('status','confirmed').order('date',{ascending:false}).limit(lim);
      const {data} = await q;
      let txs = (data||[]).filter(t=>!t.is_transfer&&!t.is_card_payment);
      if (args.type==='expense') txs=txs.filter(t=>(t.brl_amount??t.amount)<0);
      if (args.type==='income')  txs=txs.filter(t=>(t.brl_amount??t.amount)>0);
      if (args.category_name) { const cat=match(ctx.categories,args.category_name); if(cat) txs=txs.filter(t=>t.category_id===cat.id); }
      if (args.account_name)  { const acc=match(ctx.accounts,args.account_name);    if(acc) txs=txs.filter(t=>t.account_id===acc.id); }
      if (args.payee_name)    { const pay=match(ctx.payees,args.payee_name);         if(pay) txs=txs.filter(t=>t.payee_id===pay.id); }
      return txs.slice(0,lim).map(t=>({data:t.date,descricao:t.description,valor:fmt(brl(t.brl_amount??t.amount,t.currency)),tipo:(t.brl_amount??t.amount)>0?'receita':'despesa',categoria:ctx.categories.find(c=>c.id===t.category_id)?.name||'',conta:ctx.accounts.find(a=>a.id===t.account_id)?.name||'',beneficiario:ctx.payees.find(p=>p.id===t.payee_id)?.name||''}));
    }

    case 'search_transactions': {
      const lim=Math.min(+(args.limit)||15,50);
      const {data} = await famQ(sb.from('transactions').select('id,date,description,amount,brl_amount,currency,is_transfer,is_card_payment,category_id,account_id,payee_id')).ilike('description',`%${args.query}%`).eq('status','confirmed').order('date',{ascending:false}).limit(lim);
      return (data||[]).filter(t=>!t.is_transfer&&!t.is_card_payment).map(t=>({data:t.date,descricao:t.description,valor:fmt(brl(t.brl_amount??t.amount,t.currency)),tipo:(t.brl_amount??t.amount)>0?'receita':'despesa',categoria:ctx.categories.find(c=>c.id===t.category_id)?.name||''}));
    }

    case 'get_budgets': {
      return ctx.budgets.map(b=>({categoria:b.category,limite:b.limitFmt,gasto:fmt(b.spent),percentual:b.pct+'%',status:b.pct>=100?'🔴 Excedido':b.pct>=80?'🟡 Atenção':'🟢 OK'}));
    }

    case 'get_scheduled': {
      return ctx.scheduled.slice(0,25).map(s=>({descricao:s.description,tipo:s.typePt,frequencia:s.freqPt,valor:fmt(Math.abs(s.amount)),proxima:s.next||'indefinido'}));
    }

    case 'get_debts': {
      return ctx.debts.map(d=>({nome:d.name,saldo:d.balanceFmt,credor:d.creditor||''}));
    }

    case 'get_investments': {
      const accsInv = ctx.accounts.filter(a=>a.type==='investimento');
      if (!accsInv.length) return {ok:false,msg:'Nenhuma conta de investimento cadastrada.'};
      return accsInv.map(a=>({conta:a.name,saldo:a.balanceFmt}));
    }

    case 'get_dreams': {
      try {
        const {data} = await famQ(sb.from('dreams').select('title,target_amount,target_date,status,dream_type,priority')).eq('status','active').order('priority',{ascending:true});
        return (data||[]).map(d=>({titulo:d.title,meta:fmt(d.target_amount),prazo:d.target_date||'indefinido',tipo:d.dream_type}));
      } catch(e) { return {ok:false,error:e.message}; }
    }

    case 'get_receivables': {
      try {
        const {data} = await sb.from('transactions').select('id,date,description,amount,payees(name)').eq('family_id',fid).eq('status','pending').gte('amount',0).eq('is_transfer',false).order('date',{ascending:true}).limit(20);
        return (data||[]).map(r=>({descricao:r.description,valor:fmt(r.amount),data:r.date,devedor:r.payees?.name||''}));
      } catch(e) { return []; }
    }

    case 'create_transaction': {
      const amt = Math.abs(+(args.amount)||0);
      if (!amt) return {ok:false,error:'Valor inválido.'};
      let acc = match(ctx.accounts, args.account_name);
      if (!acc && ctx.accounts.length === 1) acc = ctx.accounts[0];
      // Smart fallback: quando conta não especificada, prefere conta corrente/poupança ativa
      if (!acc && ctx.accounts.length > 1) {
        acc = ctx.accounts.find(a => a.type === 'corrente' && !a.negative)
           || ctx.accounts.find(a => a.type === 'corrente')
           || ctx.accounts.find(a => a.type !== 'investimento' && a.type !== 'programa_fidelidade')
           || ctx.accounts[0];
      }
      if (!acc) return {ok:false,error:`Conta não encontrada. Disponíveis: ${ctx.accounts.map(a=>a.name).join(', ')}`};
      const catType = args.type==='income'?'receita':'despesa';
      let cat = match(ctx.categories.filter(c=>c.type===catType),args.category_name)||match(ctx.categories,args.category_name);
      const payee = match(ctx.payees,args.payee_name);
      const signedAmt = args.type==='income' ? amt : -amt;
      // Determinar status: definitivo apenas se explicitamente solicitado
      const explicit = args.definitive === true || args.status === 'confirmed';
      const txStatus = explicit ? 'confirmed' : 'pending';
      const row = {
        date:args.date||new Date().toISOString().slice(0,10),
        description:args.description, amount:signedAmt,
        brl_amount:typeof toBRL==='function'?toBRL(signedAmt,acc.currency||'BRL'):signedAmt,
        currency:acc.currency||'BRL', account_id:acc.id,
        category_id:cat?.id||null, payee_id:payee?.id||null,
        memo:args.memo||null, is_transfer:false, is_card_payment:false,
        status:txStatus, source:'chat', family_id:fid,
        created_at:new Date().toISOString(), updated_at:new Date().toISOString(),
      };
      const {data:tx,error} = await sb.from('transactions').insert(row).select().single();
      if (error) return {ok:false,error:error.message};
      _agInvalidateCtx();
      setTimeout(()=>{
        if(typeof loadTransactions==='function') loadTransactions(true).catch(()=>{});
        if(typeof loadDashboard==='function') loadDashboard().catch(()=>{});
        _agRefreshChatPendingBadge();
      },400);
      // Duplicate detection: check last 7 days for similar amount + description
      let dupWarning = '';
      try {
        const d7 = new Date(); d7.setDate(d7.getDate() - 7);
        const { data: nearTx } = await famQ(
          sb.from('transactions').select('id,date,description,amount')
        ).gte('date', d7.toISOString().slice(0,10))
         .neq('id', tx.id).neq('status', 'pending')
         .gte('amount', Math.min(signedAmt * 0.95, signedAmt * 1.05))
         .lte('amount', Math.max(signedAmt * 0.95, signedAmt * 1.05))
         .limit(5);
        const descQ = (args.description || '').toLowerCase().replace(/\s+/g, '').slice(0, 10);
        const dup = (nearTx || []).find(t => {
          const td = (t.description || '').toLowerCase().replace(/\s+/g, '');
          return td.slice(0, 8) === descQ.slice(0, 8) || (descQ.length > 5 && td.includes(descQ.slice(0, 6)));
        });
        if (dup) {
          const dd = new Date(dup.date + 'T12:00').toLocaleDateString('pt-BR');
          dupWarning = '\n\n⚠️ _Atenção: encontrei uma transação similar — "' + dup.description + '" em ' + dd + '. Se for duplicado, descarte em **Menu → Validar transações por chat**._';
        }
      } catch(_) { /* duplicate check is best-effort */ }

      if (txStatus === 'pending') {
        return {ok:true,msg:`📝 Salva como pendente: ${args.description} — ${fmt(amt)}\n\n_Valide em Menu → Validar transações por chat_` + dupWarning,id:tx.id,pending:true};
      }
      return {ok:true,msg:`✅ Registrado definitivamente: ${args.description} — ${fmt(amt)} na conta ${acc.name}` + dupWarning,id:tx.id};
    }

    case 'create_transfer': {
      const amt = Math.abs(+(args.amount)||0);
      if (!amt) return {ok:false,error:'Valor inválido.'};
      const accFrom = match(ctx.accounts,args.from_account_name);
      const accTo   = match(ctx.accounts,args.to_account_name);
      if (!accFrom) return {ok:false,error:`Conta de origem "${args.from_account_name}" não encontrada.`};
      if (!accTo)   return {ok:false,error:`Conta de destino "${args.to_account_name}" não encontrada.`};
      const date = args.date||new Date().toISOString().slice(0,10);
      const desc = args.description||`Transferência ${accFrom.name} → ${accTo.name}`;
      const base = {description:desc,date,is_transfer:true,is_card_payment:false,status:'confirmed',family_id:fid,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
      const {error:e1} = await sb.from('transactions').insert({...base,amount:-amt,brl_amount:typeof toBRL==='function'?toBRL(-amt,accFrom.currency||'BRL'):-amt,currency:accFrom.currency||'BRL',account_id:accFrom.id,transfer_to_account_id:accTo.id});
      if (e1) return {ok:false,error:e1.message};
      const {error:e2} = await sb.from('transactions').insert({...base,amount:amt,brl_amount:typeof toBRL==='function'?toBRL(amt,accTo.currency||'BRL'):amt,currency:accTo.currency||'BRL',account_id:accTo.id,transfer_to_account_id:accFrom.id});
      if (e2) return {ok:false,error:e2.message};
      _agInvalidateCtx();
      setTimeout(()=>{ if(typeof loadTransactions==='function') loadTransactions(true).catch(()=>{}); },400);
      return {ok:true,msg:`✅ Transferência de ${fmt(amt)} de ${accFrom.name} para ${accTo.name} registrada.`};
    }

    case 'open_new_transaction_form': {
      const acc = match(ctx.accounts,args.account_name);
      const cat = match(ctx.categories,args.category_name);
      const payee = match(ctx.payees,args.payee_name);
      _agOpenModal('txModal',{type:args.type,amount:args.amount,description:args.description,account_id:acc?.id,category_id:cat?.id,payee_id:payee?.id});
      return {ok:true,msg:'Formulário aberto com os dados. Revise e salve.'};
    }

    case 'create_scheduled': {
      const amt = Math.abs(+(args.amount)||0);
      if (!amt) return {ok:false,error:'Valor inválido.'};
      const acc = match(ctx.accounts,args.account_name);
      if (!acc&&ctx.accounts.length===1) { /* use default */ }
      const cat = match(ctx.categories,args.category_name);
      const {error} = await sb.from('scheduled_transactions').insert({
        description:args.description, type:args.type, amount:args.type==='expense'?-amt:amt,
        currency:acc?.currency||'BRL', account_id:acc?.id||ctx.accounts[0]?.id||null,
        category_id:cat?.id||null, frequency:args.frequency,
        start_date:args.start_date||new Date().toISOString().slice(0,10),
        status:'active', auto_register:false, auto_confirm:true, family_id:fid,
        created_at:new Date().toISOString(),
      });
      if (error) return {ok:false,error:error.message};
      _agInvalidateCtx();
      setTimeout(()=>{ if(typeof loadScheduled==='function') loadScheduled().catch(()=>{}); },400);
      return {ok:true,msg:`✅ Programado "${args.description}" criado — ${args.frequency}.`};
    }

    case 'toggle_scheduled': {
      const sc = match(ctx.scheduled,args.name,'description');
      if (!sc) return {ok:false,error:`Programado "${args.name}" não encontrado.`};
      const newStatus = args.action==='pause'?'paused':'active';
      const {error} = await sb.from('scheduled_transactions').update({status:newStatus,updated_at:new Date().toISOString()}).eq('id',sc.id);
      if (error) return {ok:false,error:error.message};
      _agInvalidateCtx();
      setTimeout(()=>{ if(typeof loadScheduled==='function') loadScheduled().catch(()=>{}); },400);
      return {ok:true,msg:`✅ Programado "${sc.description}" ${args.action==='pause'?'pausado':'retomado'}.`};
    }

    case 'create_budget': {
      const cat = match(ctx.categories,args.category_name);
      if (!cat) return {ok:false,error:`Categoria "${args.category_name}" não encontrada.`};
      const now = new Date();
      const month = (args.month||`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`)+'-01';
      const {error} = await sb.from('budgets').insert({category_id:cat.id,amount:+args.amount,month,family_id:fid,created_at:new Date().toISOString()});
      if (error) return {ok:false,error:error.message};
      _agInvalidateCtx();
      setTimeout(()=>{ if(typeof loadBudgets==='function') loadBudgets().catch(()=>{}); },400);
      return {ok:true,msg:`✅ Orçamento de ${fmt(+args.amount)} para ${cat.name} criado.`};
    }

    case 'create_category': {
      const parent = args.parent_name ? match(ctx.categories,args.parent_name) : null;
      const {data:cat,error} = await sb.from('categories').insert({
        name:args.name, type:args.type||'despesa',
        icon:args.icon||'📦', color:args.color||'#6b7280',
        parent_id:parent?.id||null, family_id:fid,
        created_at:new Date().toISOString(),
      }).select().single();
      if (error) return {ok:false,error:error.message};
      if (state.categories) state.categories.push(cat);
      if (typeof DB!=='undefined'&&DB.categories) DB.categories.invalidate?.();
      setTimeout(()=>{ if(typeof renderCategories==='function') renderCategories(); },300);
      return {ok:true,msg:`✅ Categoria "${args.name}" criada${parent?` como sub de ${parent.name}`:''}.`};
    }

    case 'create_payee': {
      const cat = match(ctx.categories,args.category_name);
      const {data:pay,error} = await sb.from('payees').insert({
        name:args.name, type:args.type||'beneficiario',
        default_category_id:cat?.id||null, family_id:fid,
        created_at:new Date().toISOString(),
      }).select().single();
      if (error) return {ok:false,error:error.message};
      if (state.payees) state.payees.push(pay);
      setTimeout(()=>{ if(typeof loadPayees==='function') loadPayees().catch(()=>{}); },300);
      return {ok:true,msg:`✅ Beneficiário "${args.name}" criado.`};
    }

    case 'create_dream': {
      const authUid = (await sb.auth.getUser().catch(()=>({data:{}})))?.data?.user?.id||null;
      const {error} = await sb.from('dreams').insert({
        title:args.title, target_amount:+args.target_amount,
        dream_type:args.dream_type||'outro',
        target_date:args.target_date||null,
        description:args.description||null,
        priority:args.priority||1,
        status:'active', family_id:fid,
        created_by:authUid, created_at:new Date().toISOString(), updated_at:new Date().toISOString(),
      });
      if (error) return {ok:false,error:error.message};
      setTimeout(()=>{ if(typeof initDreamsPage==='function'&&state.currentPage==='dreams') initDreamsPage(); },400);
      return {ok:true,msg:`✅ Objetivo "${args.title}" criado — meta: ${fmt(+args.target_amount)}.`};
    }

    case 'add_grocery_item': {
      try {
        // Find active grocery list or create one
        let listId = null;
        const {data:lists} = await sb.from('grocery_lists').select('id').eq('family_id',fid).eq('status','open').order('created_at',{ascending:false}).limit(1);
        if (lists?.length) { listId=lists[0].id; }
        else {
          const {data:nl,error:ne} = await sb.from('grocery_lists').insert({family_id:fid,name:'Lista de compras',status:'open',created_at:new Date().toISOString()}).select().single();
          if (ne) return {ok:false,error:ne.message};
          listId = nl.id;
        }
        const {error} = await sb.from('grocery_items').insert({list_id:listId,family_id:fid,name:args.name,qty:+(args.qty)||1,unit:args.unit||'un',suggested_price:args.suggested_price||null,checked:false});
        if (error) return {ok:false,error:error.message};
        return {ok:true,msg:`✅ "${args.name}" adicionado à lista de compras.`};
      } catch(e) { return {ok:false,error:e.message}; }
    }

    case 'navigate_to': {
      const pages = {dashboard:'Dashboard',transactions:'Transações',accounts:'Contas',scheduled:'Programados',budgets:'Orçamentos',reports:'Relatórios',categories:'Categorias',payees:'Beneficiários',investments:'Investimentos',debts:'Dívidas',dreams:'Sonhos',grocery:'Mercado',prices:'Preços',ai_insights:'AI Insights',receivables:'A Receber'};
      if (typeof navigate==='function') navigate(args.page);
      return {ok:true,msg:`Navegando para ${pages[args.page]||args.page}.`};
    }

    case 'answer_financial_question': {
      // Let Gemini answer this using its own knowledge — return the topic so the model can respond
      return {topic:args.topic||'finanças pessoais',question:args.question,instruction:'Responda esta pergunta usando seu conhecimento como especialista financeiro. Esta é uma pergunta educacional, não sobre dados do app.'};
    }

    default:
      return {ok:false,error:`Ferramenta desconhecida: ${name}`};
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   PROCESSAMENTO DA MENSAGEM
════════════════════════════════════════════════════════════════════════════ */
async function _agProcess(userText) {
  _agSetLoading(true);
  _agAppendUser(userText);

  // ── n8n proxy mode ────────────────────────────────────────────────────────
  // If an n8n webhook URL is configured in Settings → IA, route through n8n.
  // n8n handles context building, Gemini call, tool execution and history.
  try {
    const n8nUrl = await getAppSetting('agent_n8n_webhook_url', '');
    if (n8nUrl && String(n8nUrl).startsWith('http')) {
      await _agProcessViaProxy(userText, String(n8nUrl));
      return;
    }
  } catch(_) {}
  // ── fallback: direct Gemini ───────────────────────────────────────────────

  if (!_ag.apiKey) {
    _agAppendBot('⚙️ Configure sua **chave Gemini** em Configurações → IA para usar o agente.');
    _agSetLoading(false);
    return;
  }

  try {
    const ctx = await _agGetContext();
    let respData = await _agCallGemini(userText, ctx, null);
    let iters = 0;

    while (iters++ < 5) {
      const parts    = respData?.candidates?.[0]?.content?.parts || [];
      const fcPart   = parts.find(p => p.function_call);
      const textPart = parts.find(p => p.text)?.text || '';

      if (!fcPart) {
        // Text-only response
        if (textPart) _agAppendBot(textPart);
        else _agAppendBot('Desculpe, não consegui gerar uma resposta. Tente novamente.');
        break;
      }

      const fc   = fcPart.function_call;
      const args = fc.args || {};
      _agAppendToolCall(fc.name, args);

      let toolResult;
      try {
        toolResult = await _agExecTool(fc.name, args, ctx);
      } catch(toolErr) {
        toolResult = {ok:false,error:toolErr.message};
      }

      respData = await _agCallGemini(null, ctx, {
        modelParts: parts,
        resultParts: [{
          function_response: {
            name: fc.name,
            response: { result: typeof toolResult==='string' ? toolResult : JSON.stringify(toolResult) },
          },
        }],
      });
    }
  } catch(err) {
    console.error('[Agent]', err);
    _agAppendBot(`❌ ${err.message}`);
  } finally {
    _agSetLoading(false);
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   UI HELPERS
════════════════════════════════════════════════════════════════════════════ */
function _agLoadKey() {
  if (_ag.apiKey) return Promise.resolve();
  return getGeminiApiKey().then(k=>{
    _ag.apiKey = (k&&String(k).startsWith('AIza'))?k:null;
    _agUpdateStatus();
  }).catch(()=>{});
}

function _agUpdateStatus() {
  const dot  = document.querySelector('.ag-status-dot');
  const text = document.getElementById('agentStatusText');
  if (!dot||!text) return;
  if (_ag.loading)  { dot.style.cssText='background:#f59e0b;box-shadow:0 0 6px #f59e0b'; text.textContent='Processando…'; }
  else if (_ag.apiKey) { dot.style.cssText='background:#22c55e;box-shadow:0 0 6px #22c55e'; text.textContent='Pronto'; }
  else { dot.style.cssText='background:#ef4444;box-shadow:0 0 6px #ef4444'; text.textContent='Configure a chave Gemini'; }
}

function _agAppendUser(text) {
  const box = document.getElementById('agentFeed');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'ag-msg ag-msg--user';
  el.innerHTML = `<div class="ag-bubble ag-bubble--user">${esc(text)}</div>`;
  box.appendChild(el);
  _agScrollBottom();
}

function _agAppendBot(text) {
  const box = document.getElementById('agentFeed');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'ag-msg ag-msg--bot';
  el.innerHTML = `<div class="ag-avatar ag-avatar--bot"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#86efac" stroke-width="2" stroke-linecap="round"><path d="M12 2L13.7 8.3L20 10L13.7 11.7L12 18L10.3 11.7L4 10L10.3 8.3Z"/></svg></div><div class="ag-bubble ag-bubble--bot">${_agMarkdown(text)}</div>`;
  box.appendChild(el);
  _agScrollBottom();
}

const _AG_TOOL_LABELS = {
  get_summary:'📊 Consultando resumo',get_accounts:'🏦 Buscando contas',
  get_transactions:'📋 Buscando transações',search_transactions:'🔍 Pesquisando',
  get_budgets:'🎯 Verificando orçamentos',get_scheduled:'📆 Verificando programados',
  get_debts:'📉 Consultando dívidas',get_investments:'📈 Consultando investimentos',
  get_dreams:'⭐ Buscando objetivos',get_receivables:'📬 Verificando a receber',
  create_transaction:'💾 Registrando transação',create_transfer:'↔️ Transferindo',
  open_new_transaction_form:'📝 Abrindo formulário',create_scheduled:'⚙️ Criando programado',
  toggle_scheduled:'⏸️ Alterando programado',create_budget:'🎯 Criando orçamento',
  create_category:'🏷️ Criando categoria',create_payee:'👤 Criando beneficiário',
  create_dream:'⭐ Criando objetivo',add_grocery_item:'🛒 Adicionando item',
  navigate_to:'🧭 Navegando',answer_financial_question:'💡 Consultando especialista',
};

function _agAppendToolCall(name) {
  const box = document.getElementById('agentFeed');
  if (!box) return;
  const label = _AG_TOOL_LABELS[name]||`⚙️ ${name}`;
  const el = document.createElement('div');
  el.className = 'ag-msg ag-msg--tool';
  el.innerHTML = `<div class="ag-tool-chip"><span class="ag-tool-spin">◌</span> ${esc(label)}…</div>`;
  box.appendChild(el);
  _agScrollBottom();
}

function _agMarkdown(text) {
  return String(text||'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/`(.+?)`/g,'<code>$1</code>')
    .replace(/^#{1,3} (.+)$/gm,'<strong>$1</strong>')
    .replace(/\n/g,'<br>');
}

function _agScrollBottom() {
  const box = document.getElementById('agentFeed');
  if (box) requestAnimationFrame(()=>{ box.scrollTop = box.scrollHeight; });
}

function _agSetLoading(v) {
  _ag.loading = v;
  _agUpdateStatus();
  const btn = document.getElementById('agentSendBtn');
  if (btn) btn.disabled = v;
  if (v) {
    const box = document.getElementById('agentFeed');
    if (box) {
      const el = document.createElement('div');
      el.id = 'agTyping'; el.className = 'ag-msg ag-msg--bot';
      el.innerHTML = `<div class="ag-avatar ag-avatar--bot"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#86efac" stroke-width="2" stroke-linecap="round"><path d="M12 2L13.7 8.3L20 10L13.7 11.7L12 18L10.3 11.7L4 10L10.3 8.3Z"/></svg></div><div class="ag-bubble ag-bubble--bot ag-typing"><span></span><span></span><span></span></div>`;
      box.appendChild(el);
      _agScrollBottom();
    }
  } else {
    document.getElementById('agTyping')?.remove();
  }
}

function _agOpenModal(modalId, prefill) {
  if (typeof openTransactionModal==='function' && modalId==='txModal') {
    openTransactionModal(null);
    requestAnimationFrame(()=>{
      if (prefill.type && typeof setTxType==='function') setTxType(prefill.type);
      if (prefill.amount && typeof setAmtField==='function') setAmtField('txAmount',prefill.amount);
      if (prefill.description) { const el=document.getElementById('txDesc'); if(el) el.value=prefill.description; }
      if (prefill.account_id)  { const el=document.getElementById('txAccountId'); if(el) el.value=prefill.account_id; }
      if (prefill.category_id) { const el=document.getElementById('txCategoryId'); if(el) el.value=prefill.category_id; }
      if (prefill.payee_id)    { const el=document.getElementById('txPayeeId'); if(el) el.value=prefill.payee_id; }
    });
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   UI PRINCIPAL
════════════════════════════════════════════════════════════════════════════ */
function toggleAgent() {
  _ag.open = !_ag.open;
  const panel = document.getElementById('agentPanel');
  if (!panel) return;
  if (_ag.open) {
    panel.style.display = 'flex';
    requestAnimationFrame(()=>panel.classList.add('agent-open'));
    if (!_ag.welcomed) { _agWelcome(); _ag.welcomed=true; }
    _agUpdateContextBar();
    setTimeout(()=>document.getElementById('agentInput')?.focus(),200);
  } else {
    panel.classList.remove('agent-open');
    setTimeout(()=>{ panel.style.display='none'; },280);
  }
}

function _agWelcome() {
  _agLoadKey().then(()=>{
    const famName = (state.families||[])[0]?.name||'sua família';
    _agAppendBot(`Olá! Sou o **FinTrack Agent** ✦\n\nPosso te ajudar com tudo no app — **registrar transações**, **consultar saldos**, **criar orçamentos**, **programados**, **objetivos** e muito mais.\n\nTambém respondo qualquer pergunta sobre **finanças pessoais**, investimentos e planejamento financeiro.\n\nComo posso ajudar você hoje?`);
    if (!_ag.apiKey) {
      setTimeout(()=>_agAppendBot('⚠️ Configure sua **chave Gemini** em Configurações → IA para ativar todas as funcionalidades.'),300);
    }
  });
}

async function agentSend() {
  const inp = document.getElementById('agentInput');
  if (!inp) return;
  const text = inp.value.trim();
  if (!text||_ag.loading) return;
  inp.value = ''; inp.style.height = '';
  await _agProcess(text);
}

function agentSuggest(text) {
  const inp = document.getElementById('agentInput');
  if (inp) { inp.value=text; inp.focus(); agentSend(); }
}

function _agClearHistory() {
  _ag.history=[]; _ag.welcomed=false;
  const box=document.getElementById('agentFeed');
  if (box) box.innerHTML='';
  _agWelcome();
}
window._agentClearHistory = _agClearHistory;

function _agToggleFullscreen() {
  const panel = document.getElementById('agentPanel');
  if (!panel) return;
  panel.classList.toggle('agent-fullscreen');
  const btn=document.getElementById('agentFullscreenBtn');
  if (btn) btn.title=panel.classList.contains('agent-fullscreen')?'Sair da tela cheia':'Tela cheia';
}
window._agentToggleFullscreen = _agToggleFullscreen;

function _agUpdateContextBar() {
  const el = document.getElementById('agentContextPage');
  if (!el) return;
  const pages={dashboard:'📊 Dashboard',transactions:'💳 Transações',accounts:'🏦 Contas',scheduled:'📆 Programados',budgets:'🎯 Orçamentos',reports:'📈 Relatórios',investments:'📊 Investimentos',debts:'📉 Dívidas',dreams:'⭐ Objetivos',categories:'🏷️ Categorias',payees:'👤 Beneficiários',grocery:'🛒 Mercado',receivables:'📬 A Receber'};
  const cur = window.state?.currentPage||'dashboard';
  el.textContent = pages[cur]||cur;
}

function _agOnInput(el) { el.style.height=''; el.style.height=Math.min(el.scrollHeight,120)+'px'; }
function _agOnKeydown(e) { if(e.key==='Enter'&&!e.shiftKey) { e.preventDefault(); agentSend(); } }

window._agentOnInput    = _agOnInput;
window._agentOnKeydown  = _agOnKeydown;
window.agentSend        = agentSend;
window.agentSuggest     = agentSuggest;
// ── Chat pending badge ─────────────────────────────────────────────────────
async function _agRefreshChatPendingBadge() {
  try {
    const fid = typeof famId === 'function' ? famId() : null;
    if (!fid || !sb) return;
    const { count } = await sb.from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('family_id', fid).eq('source', 'chat').eq('status', 'pending');
    const n = count || 0;

    // Update menu badge
    const badge = document.getElementById('chatValidateBadge');
    if (badge) {
      badge.textContent = n || '';
      badge.style.display = n > 0 ? 'inline-flex' : 'none';
    }

    // Update topbar button (visible whenever there are pending chat transactions)
    const topbarBtn   = document.getElementById('chatPendingTopbarBtn');
    const topbarCount = document.getElementById('chatPendingTopbarCount');
    if (topbarBtn) {
      topbarBtn.style.display = n > 0 ? '' : 'none';
      topbarBtn.style.color = n > 0 ? '#dc2626' : 'var(--muted)';
    }
    if (topbarCount) topbarCount.textContent = n > 0 ? String(n) : '';

    // Show/update a toast banner only first time there are new pending transactions
    if (n > 0 && !window._chatPendingNotified) {
      window._chatPendingNotified = true;
      if (typeof toast === 'function') {
        toast(`💬 ${n} transaç${n===1?'ão':'ões'} do chat aguardando validação — toque em ✅ no topo`, 'info', 6000);
      }
    }
    if (n === 0) window._chatPendingNotified = false;
  } catch(e) { console.warn('[chatPendingBadge]', e?.message); }
}
window._agRefreshChatPendingBadge = _agRefreshChatPendingBadge;


window.toggleAgent      = toggleAgent;
