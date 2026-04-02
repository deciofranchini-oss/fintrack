/* ═══════════════════════════════════════════════════════════════════════
   AGENT.JS — FinTrack Agent
   Parsing estruturado (intenção → ação) com execução direta no app.
   Fluxo:
   1) parser local robusto para intents comuns
   2) fallback Gemini com modelos/endpoint compatíveis
   3) execução direta nas rotinas do app / banco
═══════════════════════════════════════════════════════════════════════ */

'use strict';

const _agent = {
  open: false,
  history: [],
  apiKey: null,
  loading: false,
  pendingPlan: null,
  modelTried: null,
};

const AGENT_ALLOWED_INTENTS = new Set([
  'create_transaction', 'create_scheduled', 'create_payee', 'create_category',
  'create_debt', 'query_balance', 'query_transactions', 'navigate', 'confirm', 'not_understood'
]);

window.toggleAgent = function() {
  _agent.open = !_agent.open;
  const panel = document.getElementById('agentPanel');
  if (panel) {
    panel.style.display = _agent.open ? 'flex' : 'none';
    if (_agent.open) {
      document.getElementById('agentInput')?.focus();
      if (!_agent.history.length) _agentWelcome();
    }
  }
};

function _agentWelcome() {
  _agentAppend('assistant', [
    'Olá! Sou o **FinTrack Agent** 🤖',
    '',
    'Posso criar, buscar e gerenciar dados do app por você. Exemplos:',
    '• *"Crie uma transação de R$150 de Supermercado Extra na categoria Alimentação"*',
    '• *"Adicione transação programada de R$10 mensais para Pão de Açúcar em 10 parcelas para o Décio"*',
    '• *"Crie o beneficiário Padaria Central"*',
    '• *"Qual é meu saldo total?"*',
    '• *"Crie uma dívida de R$2000 de empréstimo pessoal"*',
    '• *"Adicione a categoria Lazer com cor azul"*',
  ].join('\n'));
}

window.agentSend = async function() {
  const input = document.getElementById('agentInput');
  const text = (input?.value || '').trim();
  if (!text || _agent.loading) return;
  if (input) input.value = '';

  _agentAppend('user', text);
  _agentSetLoading(true);

  try {
    const plan = await _agentBuildPlan(text);
    await _agentExecute(plan, text);
  } catch (e) {
    console.error('[agent]', e);
    _agentAppend('assistant', `❌ Erro: ${e.message}`);
  } finally {
    _agentSetLoading(false);
  }
};

window.agentKeydown = function(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    agentSend();
  }
};

window.agentSuggest = function(text) {
  const input = document.getElementById('agentInput');
  if (input) {
    input.value = text;
    input.focus();
  }
};

async function _agentBuildPlan(userMessage) {
  const directPlan = _agentParseStructured(userMessage);
  if (directPlan.intent !== 'not_understood') return directPlan;

  const key = await _agentGetKey();
  if (!key) return directPlan;

  _agent.apiKey = key;
  const aiPlan = await _agentPlanWithGemini(userMessage);
  return _agentNormalizePlan(aiPlan, userMessage);
}

async function _agentGetKey() {
  if (_agent.apiKey) return _agent.apiKey;
  try {
    const k = await getAppSetting('gemini_api_key', '');
    return k || null;
  } catch (_) {
    return null;
  }
}

function _agentGetUser() {
  try {
    if (typeof currentUser !== 'undefined' && currentUser) return currentUser;
  } catch (_) {}
  return window.currentUser || state?.user || null;
}

function _agentGetFamilyId() {
  const user = _agentGetUser();
  try {
    if (typeof famId === 'function') return famId() || user?.family_id || state?.familyId || null;
  } catch (_) {}
  return user?.family_id || state?.familyId || null;
}

async function _agentEnsureContextLoaded() {
  if (!window.sb) throw new Error('Supabase não está disponível.');
  if (!_agentGetUser() && window.sb?.auth?.getSession) {
    try {
      const { data } = await window.sb.auth.getSession();
      if (data?.session?.user && !window.currentUser) {
        window.currentUser = { ...(window.currentUser || {}), id: data.session.user.id, email: data.session.user.email || null };
      }
    } catch (_) {}
  }
  if (!_agentGetFamilyId()) throw new Error('Não consegui identificar a família/sessão do usuário.');

  try {
    if ((!state.accounts || !state.accounts.length) && typeof DB !== 'undefined' && DB.accounts?.load) state.accounts = await DB.accounts.load() || state.accounts;
    if ((!state.categories || !state.categories.length) && typeof loadCategories === 'function') await loadCategories();
    if ((!state.payees || !state.payees.length) && typeof loadPayees === 'function') {
      try { await loadPayees(true); } catch (_) { await loadPayees(); }
    }
    if ((!state.scheduled || !state.scheduled.length) && typeof loadScheduled === 'function') await loadScheduled();
  } catch (e) {
    console.warn('[agent] preload:', e?.message || e);
  }
}

function _agentBuildContext() {
  return {
    today: new Date().toISOString().slice(0, 10),
    accounts: (state.accounts || []).slice(0, 30).map(a => ({ id: a.id, name: a.name, type: a.type, currency: a.currency || 'BRL' })),
    categories: (state.categories || []).slice(0, 50).map(c => ({ id: c.id, name: c.name, type: c.type })),
    payees: (state.payees || []).slice(0, 50).map(p => ({ id: p.id, name: p.name, type: p.type })),
    scheduled: (state.scheduled || []).slice(0, 20).map(s => ({ id: s.id, description: s.description, frequency: s.frequency, amount: s.amount })),
  };
}

async function _agentPlanWithGemini(userMessage) {
  const ctx = _agentBuildContext();
  const prompt = `Você é o FinTrack Agent. Converta o pedido do usuário em JSON estruturado para execução no app.
Retorne APENAS JSON válido, sem markdown.

Data atual: ${ctx.today}
Contas: ${JSON.stringify(ctx.accounts)}
Categorias: ${JSON.stringify(ctx.categories)}
Beneficiários: ${JSON.stringify(ctx.payees)}
Programados: ${JSON.stringify(ctx.scheduled)}

Formato obrigatório:
{
  "intent": "create_transaction|create_scheduled|create_payee|create_category|create_debt|query_balance|navigate|not_understood",
  "summary": "texto curto em português",
  "requires_confirmation": false,
  "actions": [
    {"type": "create_transaction|create_scheduled|create_payee|create_category|create_debt|navigate|check_payee|check_category", "data": {}}
  ]
}

Regras:
- Para despesa, amount deve ser negativo.
- Para receita, amount deve ser positivo.
- Para consulta de saldo, actions pode ser vazio.
- Para navegação, use data.page.
- Use account_name/category_name/payee_name quando não souber o id.
- Se o pedido estiver claro, requires_confirmation=false.
- Se faltar dado crítico, intent=not_understood.

Pedido: ${JSON.stringify(userMessage)}`;

  const models = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
  let lastError = null;

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${_agent.apiKey}`;
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 1400, temperature: 0.1 }
        })
      });

      if (!resp.ok) {
        const raw = await resp.text();
        lastError = new Error(`Gemini API: HTTP ${resp.status}${raw ? ' - ' + raw : ''}`);
        if (resp.status === 404) continue;
        throw lastError;
      }

      const result = await resp.json();
      _agent.modelTried = model;
      const text = result?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
      const clean = _agentExtractJson(text);
      return JSON.parse(clean);
    } catch (e) {
      lastError = e;
      if (!/HTTP 404/.test(e.message || '')) throw e;
    }
  }

  throw lastError || new Error('Não foi possível interpretar o pedido com a IA.');
}

function _agentExtractJson(text) {
  const raw = String(text || '').trim();
  const stripped = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  const first = stripped.indexOf('{');
  const last = stripped.lastIndexOf('}');
  if (first >= 0 && last > first) return stripped.slice(first, last + 1);
  return stripped;
}

function _agentNormalizePlan(plan, originalText) {
  if (!plan || typeof plan !== 'object') return _agentParseStructured(originalText);
  if (!AGENT_ALLOWED_INTENTS.has(plan.intent)) plan.intent = 'not_understood';
  plan.summary = plan.summary || 'Executando no app';
  plan.actions = Array.isArray(plan.actions) ? plan.actions : [];
  plan.requires_confirmation = !!plan.requires_confirmation;
  return plan;
}

function _agentParseStructured(text) {
  const raw = String(text || '').trim();
  const msg = raw.toLowerCase();
  const amount = _agentParseAmount(raw);
  const date = _agentParseDate(raw);

  if (_agentIsConfirmation(msg) && _agent.pendingPlan) {
    return { intent: 'confirm', summary: 'Confirmando ação pendente', requires_confirmation: false, actions: _agent.pendingPlan.actions || [] };
  }

  if (/saldo total|qual .*saldo|quanto .*saldo/.test(msg)) {
    return { intent: 'query_balance', summary: 'Consultando saldo total', requires_confirmation: false, actions: [] };
  }

  const navMap = [
    ['dashboard', /dashboard|painel/],
    ['transactions', /transa[cç][aã]o|despesa|receita|lançamento/],
    ['scheduled', /programad/],
    ['reports', /relat[oó]rio|forecast|previs[aã]o/],
    ['payees', /benefici[aá]rio|favorecido/],
    ['settings', /configura[cç][oõ]es?/],
  ];
  const navHit = navMap.find(([, rx]) => rx.test(msg));
  if (/abr(a|ir)|ir para|naveg/.test(msg) && navHit) {
    return { intent: 'navigate', summary: `Abrindo ${navHit[0]}`, requires_confirmation: false, actions: [{ type: 'navigate', data: { page: navHit[0] } }] };
  }

  if (/crie|criar|adicione|adicionar|lan[çc]e|registre/.test(msg) && /(transa[cç][aã]o|despesa|receita)/.test(msg) && amount !== null) {
    const isIncome = /(receita|entrada|ganho|recebimento)/.test(msg);
    const isExpense = /(despesa|gasto|compra|pagamento|sa[ií]da)/.test(msg) || !isIncome;
    const description = _agentParseDescription(raw);
    const accountName = _agentExtractAfter(raw, [/na conta\s+([^,.;]+)/i, /da conta\s+([^,.;]+)/i]);
    const categoryName = _agentExtractAfter(raw, [/categoria\s+([^,.;]+)/i]);
    const payeeName = _agentExtractPayee(raw);
    const memberName = _agentExtractAfter(raw, [/(?:pelo|pela)\s+([^,.;]+)/i]);
    return {
      intent: 'create_transaction',
      summary: 'Criando transação no app',
      requires_confirmation: false,
      actions: [{
        type: 'create_transaction',
        data: {
          date,
          description,
          amount: isIncome ? Math.abs(amount) : -Math.abs(amount),
          type: isIncome ? 'income' : 'expense',
          account_name: accountName,
          category_name: categoryName,
          payee_name: payeeName,
          family_member_name: memberName,
        }
      }]
    };
  }

  if (/programad/.test(msg) && amount !== null) {
    const accountName = _agentExtractAfter(raw, [/na conta\s+([^,.;]+)/i, /da conta\s+([^,.;]+)/i]);
    const categoryName = _agentExtractAfter(raw, [/categoria\s+([^,.;]+)/i]);
    const payeeName = _agentExtractPayee(raw);
    const frequency = _agentParseFrequency(msg) || 'monthly';
    const installments = _agentParseInstallments(msg);
    const description = _agentParseDescription(raw);
    return {
      intent: 'create_scheduled',
      summary: 'Criando transação programada',
      requires_confirmation: false,
      actions: [{
        type: 'create_scheduled',
        data: {
          description,
          amount: -Math.abs(amount),
          type: /receita|entrada/.test(msg) ? 'income' : 'expense',
          account_name: accountName,
          category_name: categoryName,
          payee_name: payeeName,
          frequency,
          start_date: date,
          installments,
          family_member_name: _agentExtractAfter(raw, [/(?:para|pro|pra)\s+([^,.;]+)/i])
        }
      }]
    };
  }

  if (/benefici[aá]rio|favorecido/.test(msg) && /crie|criar|adicione|adicionar/.test(msg)) {
    const name = _agentExtractAfter(raw, [/benefici[aá]rio\s+([^,.;]+)/i, /favorecido\s+([^,.;]+)/i]);
    if (name) return { intent: 'create_payee', summary: 'Criando beneficiário', requires_confirmation: false, actions: [{ type: 'create_payee', data: { name } }] };
  }

  if (/categoria/.test(msg) && /crie|criar|adicione|adicionar/.test(msg)) {
    const name = _agentExtractAfter(raw, [/categoria\s+([^,.;]+)/i]);
    const color = _agentParseColor(msg);
    if (name) return { intent: 'create_category', summary: 'Criando categoria', requires_confirmation: false, actions: [{ type: 'create_category', data: { name, type: 'expense', color } }] };
  }

  if (/d[ií]vida/.test(msg) && amount !== null) {
    return {
      intent: 'create_debt',
      summary: 'Criando dívida',
      requires_confirmation: false,
      actions: [{ type: 'create_debt', data: { description: _agentParseDescription(raw), creditor: _agentExtractPayee(raw), original_amount: Math.abs(amount), start_date: date } }]
    };
  }

  return { intent: 'not_understood', summary: 'Pedido não compreendido', requires_confirmation: false, actions: [] };
}

function _agentIsConfirmation(msg) {
  return /^(ok|pode|confirmo|confirmar|sim|manda ver|pode fazer|prosseguir)$/i.test(msg.trim());
}

function _agentParseAmount(text) {
  const m = String(text || '').match(/(?:r\$\s*)?(-?\d{1,3}(?:[\.\s]\d{3})*(?:,\d{1,2})|-?\d+(?:,\d{1,2})?|-?\d+(?:\.\d{1,2})?)/i);
  if (!m) return null;
  let v = m[1].replace(/\s/g, '');
  if (v.includes(',') && v.includes('.')) v = v.replace(/\./g, '').replace(',', '.');
  else if (v.includes(',')) v = v.replace(',', '.');
  const num = parseFloat(v);
  return Number.isFinite(num) ? num : null;
}

function _agentParseDate(text) {
  const msg = String(text || '').toLowerCase();
  const dt = new Date();
  if (/amanh[ãa]/.test(msg)) dt.setDate(dt.getDate() + 1);
  else if (/ontem/.test(msg)) dt.setDate(dt.getDate() - 1);
  const abs = String(text || '').match(/(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?/);
  if (abs) {
    const dd = Number(abs[1]);
    const mm = Number(abs[2]) - 1;
    let yy = abs[3] ? Number(abs[3]) : dt.getFullYear();
    if (yy < 100) yy += 2000;
    const parsed = new Date(yy, mm, dd, 12, 0, 0);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  return dt.toISOString().slice(0, 10);
}

function _agentParseFrequency(msg) {
  if (/seman/.test(msg)) return 'weekly';
  if (/anual|anualmente|ano/.test(msg)) return 'yearly';
  if (/di[aá]ri/.test(msg)) return 'daily';
  if (/mensa|m[eê]s/.test(msg)) return 'monthly';
  return null;
}

function _agentParseInstallments(msg) {
  const m = String(msg || '').match(/(\d+)\s*parcelas?/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function _agentParseColor(msg) {
  const map = {
    azul: '#2563eb', verde: '#16a34a', vermelho: '#dc2626', laranja: '#f97316',
    roxo: '#7c3aed', amarelo: '#f59e0b', rosa: '#ec4899', cinza: '#6b7280'
  };
  const hit = Object.keys(map).find(c => msg.includes(c));
  return hit ? map[hit] : '#2a6049';
}

function _agentExtractAfter(text, regexes) {
  for (const rx of regexes) {
    const m = String(text || '').match(rx);
    if (m?.[1]) return m[1].trim().replace(/["“”]/g, '');
  }
  return '';
}

function _agentExtractPayee(text) {
  return _agentExtractAfter(text, [
    /em\s+([^,.;]+)$/i,
    /para\s+([^,.;]+)$/i,
    /no\s+([^,.;]+)$/i,
    /na\s+([^,.;]+)$/i,
  ]);
}

function _agentParseDescription(text) {
  const trimmed = String(text || '').trim();
  const quoted = trimmed.match(/["“](.+?)["”]/);
  if (quoted?.[1]) return quoted[1].trim();
  const afterDe = trimmed.match(/de\s+([^,.;]+)/i);
  if (afterDe?.[1] && !/r\$/i.test(afterDe[1])) return afterDe[1].trim();
  const payee = _agentExtractPayee(trimmed);
  if (payee) return payee;
  return 'Lançamento via Agent';
}

async function _agentExecute(plan, originalText) {
  const normalized = _agentNormalizePlan(plan, originalText);

  if (normalized.intent === 'not_understood') {
    _agentAppend('assistant', '🤔 Não consegui mapear o pedido com segurança. Tente algo como *"Crie uma despesa de R$ 42 na conta XPTO na categoria Alimentação"*.');
    return;
  }

  if (normalized.intent === 'confirm') {
    if (!_agent.pendingPlan) {
      _agentAppend('assistant', 'Não há nenhuma ação pendente para confirmar.');
      return;
    }
    plan = _agent.pendingPlan;
    _agent.pendingPlan = null;
  } else if (normalized.requires_confirmation) {
    _agent.pendingPlan = normalized;
    _agentAppend('assistant', `🧾 ${normalized.summary || 'Encontrei uma ação para executar.'}\n\nDigite **ok** para confirmar.`);
    return;
  } else {
    plan = normalized;
  }

  if (plan.intent === 'query_balance') {
    _agentAnswerBalance();
    return;
  }

  await _agentEnsureContextLoaded();

  if (plan.intent === 'navigate') {
    const page = plan.actions?.[0]?.data?.page;
    if (page && typeof navigate === 'function') {
      navigate(page);
      _agentAppend('assistant', `✅ Navegando para **${page}**.`);
      return;
    }
  }

  _agentAppend('assistant', `🔄 **${plan.summary || 'Executando no app'}**`);

  const results = [];
  const runtimeCtx = {};
  for (const action of (plan.actions || [])) {
    try {
      const result = await _agentRunAction(action, runtimeCtx);
      results.push(result);
    } catch (e) {
      results.push({ ok: false, msg: `Erro em ${action.type}: ${e.message}` });
    }
  }

  const allOk = results.length && results.every(r => r.ok);
  _agentAppend('assistant', results.map(r => r.ok ? `✅ ${r.msg}` : `❌ ${r.msg}`).join('\n') + (allOk ? '\n\n*Tudo pronto!*' : ''));
  if (allOk) await _agentRefreshAfterPlan(plan);
}

async function _agentRunAction(action, ctx) {
  const d = action.data || {};
  switch (action.type) {
    case 'check_payee':
      return _agentEnsurePayee(d.name || d.payee_name || '', ctx);
    case 'check_category':
      return _agentEnsureCategory(d.category_name || d.name || '', d.type || 'expense', d.color, ctx);
    case 'create_transaction':
      return _agentCreateTransaction(d, ctx);
    case 'create_scheduled':
      return _agentCreateScheduled(d, ctx);
    case 'create_payee':
      return _agentEnsurePayee(d.name || '', ctx, true);
    case 'create_category':
      return _agentEnsureCategory(d.name || '', d.type || 'expense', d.color, ctx, true);
    case 'create_debt':
      return _agentCreateDebt(d);
    case 'navigate':
      if (d.page && typeof navigate === 'function') {
        navigate(d.page);
        return { ok: true, msg: `Página **${d.page}** aberta` };
      }
      throw new Error('Página não informada.');
    default:
      return { ok: false, msg: `Ação desconhecida: ${action.type}` };
  }
}

async function _agentEnsurePayee(name, ctx, explicit = false) {
  const cleaned = String(name || '').trim();
  if (!cleaned) return { ok: !explicit, msg: explicit ? 'Nome do beneficiário não informado.' : 'Sem beneficiário no pedido' };
  const existing = _agentFindByName(state.payees || [], cleaned);
  if (existing) {
    ctx.payee_id = existing.id;
    return { ok: true, msg: `Beneficiário **${existing.name}** encontrado` };
  }
  const payload = { name: cleaned, type: 'beneficiario', family_id: _agentGetFamilyId() };
  const { data, error } = await sb.from('payees').insert(payload).select('id,name,type').single();
  if (error) throw new Error(error.message);
  state.payees = [...(state.payees || []), data];
  if (typeof DB !== 'undefined' && DB.payees?.bust) DB.payees.bust();
  ctx.payee_id = data.id;
  return { ok: true, msg: `Beneficiário **${cleaned}** criado` };
}

async function _agentEnsureCategory(name, type = 'expense', color = '#2a6049', ctx = {}, explicit = false) {
  const cleaned = String(name || '').trim();
  if (!cleaned) return { ok: !explicit, msg: explicit ? 'Nome da categoria não informado.' : 'Sem categoria no pedido' };
  const existing = _agentFindByName(state.categories || [], cleaned);
  if (existing) {
    ctx.category_id = existing.id;
    return { ok: true, msg: `Categoria **${existing.name}** encontrada` };
  }
  const payload = { name: cleaned, type, color: color || '#2a6049', family_id: _agentGetFamilyId() };
  const { data, error } = await sb.from('categories').insert(payload).select('id,name,type,color').single();
  if (error) throw new Error(error.message);
  state.categories = [...(state.categories || []), data];
  ctx.category_id = data.id;
  return { ok: true, msg: `Categoria **${cleaned}** criada` };
}

async function _agentCreateTransaction(d, ctx) {
  const account = _agentResolveAccountObj(d.account_id, d.account_name);
  if (!account) throw new Error('Conta não encontrada.');

  let categoryId = d.category_id || ctx.category_id || _agentResolveCategory(d.category_name);
  if (!categoryId && d.category_name) {
    const created = await _agentEnsureCategory(d.category_name, d.type === 'income' ? 'income' : 'expense', null, ctx);
    if (!created.ok) throw new Error(created.msg);
    categoryId = ctx.category_id;
  }

  let payeeId = d.payee_id || ctx.payee_id || _agentResolvePayee(d.payee_name);
  if (!payeeId && d.payee_name) {
    const created = await _agentEnsurePayee(d.payee_name, ctx);
    if (!created.ok) throw new Error(created.msg);
    payeeId = ctx.payee_id;
  }

  let amount = Number(d.amount || 0);
  if (!Number.isFinite(amount) || !amount) throw new Error('Valor da transação inválido.');
  if ((d.type || '').toLowerCase() === 'expense' && amount > 0) amount = -amount;
  if ((d.type || '').toLowerCase() === 'income' && amount < 0) amount = Math.abs(amount);

  const payload = {
    date: d.date || new Date().toISOString().slice(0, 10),
    description: d.description || d.payee_name || 'Lançamento via Agent',
    amount,
    account_id: account.id,
    category_id: categoryId || null,
    payee_id: payeeId || null,
    family_id: _agentGetFamilyId(),
    status: 'confirmed',
    is_transfer: false,
    is_card_payment: false,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await sb.from('transactions').insert(payload).select('id,date,description,amount').single();
  if (error) throw new Error(error.message);

  if (typeof notifyOnTransaction === 'function') {
    try { await notifyOnTransaction(data); } catch (_) {}
  }

  ctx.last_transaction_id = data.id;
  return { ok: true, msg: `Transação **${payload.description}** criada em **${account.name}** por ${fmt ? fmt(Math.abs(amount), account.currency || 'BRL') : Math.abs(amount).toFixed(2)}` };
}

async function _agentCreateScheduled(d, ctx) {
  const account = _agentResolveAccountObj(d.account_id, d.account_name);
  if (!account) throw new Error('Conta não encontrada para o programado.');

  let categoryId = d.category_id || ctx.category_id || _agentResolveCategory(d.category_name);
  if (!categoryId && d.category_name) {
    await _agentEnsureCategory(d.category_name, d.type === 'income' ? 'income' : 'expense', null, ctx);
    categoryId = ctx.category_id;
  }

  let payeeId = d.payee_id || ctx.payee_id || _agentResolvePayee(d.payee_name);
  if (!payeeId && d.payee_name) {
    await _agentEnsurePayee(d.payee_name, ctx);
    payeeId = ctx.payee_id;
  }

  let amount = Number(d.amount || 0);
  if (!Number.isFinite(amount) || !amount) throw new Error('Valor programado inválido.');
  if ((d.type || '').toLowerCase() !== 'income') amount = -Math.abs(amount);

  const payload = {
    description: d.description || d.payee_name || 'Programado via Agent',
    amount,
    type: d.type || 'expense',
    frequency: d.frequency || 'monthly',
    start_date: d.start_date || new Date().toISOString().slice(0, 10),
    installments: d.installments ?? null,
    account_id: account.id,
    category_id: categoryId || null,
    payee_id: payeeId || null,
    family_id: _agentGetFamilyId(),
    auto_register: true,
    status: 'active',
    updated_at: new Date().toISOString(),
  };

  const { error } = await sb.from('scheduled_transactions').insert(payload);
  if (error) throw new Error(error.message);
  return { ok: true, msg: `Programado **${payload.description}** criado com frequência **${payload.frequency}**` };
}

async function _agentCreateDebt(d) {
  const amount = Math.abs(Number(d.original_amount || d.amount || 0));
  if (!amount) throw new Error('Valor da dívida inválido.');
  const payload = {
    description: d.description || d.creditor || 'Dívida via Agent',
    creditor: d.creditor || d.description || 'Credor',
    original_amount: amount,
    current_balance: amount,
    currency: d.currency || 'BRL',
    start_date: d.start_date || new Date().toISOString().slice(0, 10),
    status: 'active',
    family_id: _agentGetFamilyId(),
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from('debts').insert(payload);
  if (error) throw new Error(error.message);
  return { ok: true, msg: `Dívida **${payload.description}** criada por ${amount.toFixed(2)}` };
}

function _agentResolveAccountObj(accountId, accountName) {
  const accounts = state.accounts || [];
  if (accountId) return accounts.find(a => a.id === accountId) || null;
  if (!accountName) return accounts[0] || null;
  return _agentFindByName(accounts, accountName);
}

function _agentResolveCategory(name) {
  if (!name) return null;
  return _agentFindByName(state.categories || [], name)?.id || null;
}

function _agentResolvePayee(name) {
  if (!name) return null;
  return _agentFindByName(state.payees || [], name)?.id || null;
}

function _agentFindByName(list, name) {
  const needle = String(name || '').trim().toLowerCase();
  if (!needle) return null;
  return list.find(item => String(item?.name || '').trim().toLowerCase() === needle)
      || list.find(item => String(item?.name || '').trim().toLowerCase().includes(needle))
      || list.find(item => needle.includes(String(item?.name || '').trim().toLowerCase()))
      || null;
}

async function _agentRefreshAfterPlan(plan) {
  try {
    if (plan.intent === 'create_transaction') {
      if (typeof DB !== 'undefined' && DB.accounts?.bust) DB.accounts.bust();
      if (typeof loadTransactions === 'function') await loadTransactions();
      if (typeof loadDashboard === 'function') await loadDashboard();
      if (state.currentPage === 'reports' && typeof loadForecast === 'function') await loadForecast();
    }
    if (plan.intent === 'create_scheduled' && typeof loadScheduled === 'function') await loadScheduled();
    if (plan.intent === 'create_payee' && typeof loadPayees === 'function') await loadPayees(true);
    if (plan.intent === 'create_category' && typeof loadCategories === 'function') await loadCategories();
    if (plan.intent === 'create_debt' && state.currentPage === 'debts' && typeof loadDebts === 'function') await loadDebts();
  } catch (e) {
    console.warn('[agent refresh]', e?.message || e);
  }
}

function _agentAnswerBalance() {
  const accs = state.accounts || [];
  if (!accs.length) {
    _agentAppend('assistant', 'Não consegui carregar as contas. Tente recarregar a página.');
    return;
  }
  const totalBRL = accs.reduce((sum, a) => sum + (typeof toBRL === 'function' ? toBRL(Number(a.balance) || 0, a.currency || 'BRL') : Number(a.balance) || 0), 0);
  const lines = ['**Saldo das suas contas:**', ''];
  accs.forEach(a => {
    const bal = Number(a.balance) || 0;
    lines.push(`• **${a.name}**: ${typeof fmt === 'function' ? fmt(bal, a.currency || 'BRL') : bal.toFixed(2)}`);
  });
  lines.push('', `**Total (BRL): ${typeof dashFmt === 'function' ? dashFmt(totalBRL, 'BRL') : totalBRL.toFixed(2)}**`);
  _agentAppend('assistant', lines.join('\n'));
}

function _agentAppend(role, text) {
  _agent.history.push({ role, text });
  _agentRenderMessage(role, text);
}

function _agentRenderMessage(role, text) {
  const feed = document.getElementById('agentFeed');
  if (!feed) return;
  const isUser = role === 'user';
  const html = _agentMarkdown(text);
  const msg = document.createElement('div');
  msg.className = `agent-msg agent-msg--${role}`;
  msg.innerHTML = `
    <div class="agent-bubble">
      ${!isUser ? '<span class="agent-avatar">🤖</span>' : ''}
      <div class="agent-text">${html}</div>
    </div>`;
  feed.appendChild(msg);
  feed.scrollTop = feed.scrollHeight;
}

function _agentMarkdown(text) {
  return String(text || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

function _agentSetLoading(on) {
  _agent.loading = on;
  const btn = document.getElementById('agentSendBtn');
  const ind = document.getElementById('agentLoading');
  if (btn) btn.disabled = on;
  if (ind) ind.style.display = on ? '' : 'none';

  document.querySelectorAll('.agent-loading').forEach(el => el.remove());
  if (!on) return;

  const feed = document.getElementById('agentFeed');
  if (!feed) return;
  const el = document.createElement('div');
  el.className = 'agent-msg agent-msg--assistant agent-loading';
  el.innerHTML = '<div class="agent-bubble"><span class="agent-avatar">🤖</span><div class="agent-typing"><span></span><span></span><span></span></div></div>';
  feed.appendChild(el);
  feed.scrollTop = feed.scrollHeight;
}
