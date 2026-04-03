/* ═══════════════════════════════════════════════════════════════════════
   AGENT.JS — FinTrack Copiloto Financeiro v3
   Motor profissional com pipeline de 6 estágios, entity resolver, sistema
   de confiança, memória de sessão e UI interativa.

   Depende de: agent_engine.js (carregado antes)

   Pipeline: userMessage
     → AgentEngine.runPipeline()          (interpret + resolve + gaps)
     → _agentDispatch()                   (roteador principal)
       HELP    → _agentAnswerHelp()        (busca semântica + Gemini)
       FINANCE → _agentAnswerFinance()     (state + Supabase + Gemini)
       ACTION  → _agentBuildPlan()         (heurística + Gemini fallback)
               → _agentExecute()           (executor com validação)
       GUIDED  → _agentShowGuided()        (UI interativa para campos faltantes)
     → _agentRefreshAfterPlan()           (atualiza estado do app)
═══════════════════════════════════════════════════════════════════════ */
'use strict';

const _agent = {
  open: false,
  history: [],
  apiKey: null,
  loading: false,
  pendingPlan: null,
  inlineReady: false,
  // v3: session memory completa (sincronizada com AgentSession)
  session: {
    lastIntent:       null,
    draftPlan:        null,
    draftUpdatedAt:   0,
    awaitingField:    null,
    lastEntities:     {},
    turnCount:        0,
  },
  _engineReady: false,
};

// Inicializa o engine e sincroniza sessão
function _agentInitEngine() {
  if (typeof AgentEngine === 'undefined') return;
  _agent._engineReady = true;
  // Ativa debug via URL param: ?agentDebug=1
  const debugMode = new URLSearchParams(window.location.search).get('agentDebug') === '1';
  AgentEngine.setDebug(debugMode);
  AgentEngine.Logger.info('[agent] v3 engine ready, debug='+debugMode);
}

// Chamado quando agent abre pela primeira vez
document.addEventListener('DOMContentLoaded', () => {
  // Pequeno delay para garantir que agent_engine.js já executou
  setTimeout(_agentInitEngine, 100);
});

const AGENT_ALLOWED_INTENTS = new Set([
  'create_transaction','create_scheduled','create_payee','create_category',
  'create_family_member','create_debt','create_account','create_dream',
  'edit_entity','delete_entity','pay_debt',
  'query_balance','navigate','confirm','cancel','help','finance_query','not_understood',
]);

// ── Public API ────────────────────────────────────────────────────────────
window.toggleAgent = function() {
  _agent.open = !_agent.open;
  const panel = document.getElementById('agentPanel');
  if (!panel) return;
  panel.style.display = _agent.open ? 'flex' : 'none';
  if (_agent.open) {
    document.getElementById('agentInput')?.focus();
    _agentEnsureInlineUi();
    if (!_agent.history.length) _agentWelcome();
    _agentRefreshQuickReplies(); // v3: atualiza chips contextuais
    _agentInitEngine();          // v3: garante engine pronto
  }
};

// v3: confirma ação pendente via botão visual
window.agentSend_confirm = function() {
  const input = document.getElementById('agentInput');
  if (input) input.value = 'ok';
  agentSend();
  _agentHideConfirmBar();
};

// v3: cancela ação pendente
window.agentSend_cancel = function() {
  _agent.pendingPlan = null;
  if (typeof AgentEngine !== 'undefined') AgentEngine.Session.reset();
  _agentHideConfirmBar();
  _agentAppend('assistant', '↩️ Ação cancelada.');
};

window.agentSend = async function() {
  const input = document.getElementById('agentInput');
  const text = (input?.value || '').trim();
  if (!text || _agent.loading) return;
  input.value = '';
  input.style.height = 'auto';
  _agentRenderInlineSuggestions('');
  _agentHideConfirmBar();
  _agentAppend('user', text);
  _agentSetLoading(true);
  try { await _agentDispatch(text); }
  catch (e) { console.error('[agent]', e); _agentAppend('assistant', `❌ Erro: ${e.message}`); }
  finally { _agentSetLoading(false); }
};

window.agentKeydown = function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); agentSend(); }
};

window.agentSuggest = function(text) {
  const input = document.getElementById('agentInput');
  if (input) { input.value = text; input.focus(); _agentRenderInlineSuggestions(text); }
};

window.agentChooseSlot = function(field, value, sendNow=false) {
  const payload = `__agent_slot__:${field}:${value}`;
  if (sendNow) {
    const input = document.getElementById('agentInput');
    if (input) input.value = payload;
    agentSend();
    return;
  }
  const input = document.getElementById('agentInput');
  if (input) { input.value = payload; input.focus(); }
};

// ── Welcome ───────────────────────────────────────────────────────────────
function _agentWelcome() {
  const page = window.state?.currentPage || 'dashboard';
  const quickRepliesHtml = typeof AgentEngine !== 'undefined'
    ? AgentEngine.QuickReplies.render(page)
    : '';

  const welcomeHtml = `
<div style="display:flex;flex-direction:column;gap:10px">
  <div>
    👋 Olá! Sou o <strong>FinTrack Copiloto</strong>.<br>
    <span style="font-size:.8rem;color:var(--muted)">Posso criar transações, responder sobre suas finanças e ajudar com o app.</span>
  </div>
  <div style="display:flex;flex-direction:column;gap:4px;font-size:.8rem;color:var(--muted)">
    <div>💸 <em>"Crie despesa de R$80 no Supermercado"</em></div>
    <div>📊 <em>"Quanto gastei este mês?"</em></div>
    <div>❓ <em>"Como adicionar uma conta?"</em></div>
  </div>
  ${quickRepliesHtml}
</div>`.trim();

  _agentAppendStructured('assistant', welcomeHtml, 'Olá! Sou o FinTrack Copiloto.');
}

// ── Main dispatcher — v3 com engine pipeline ──────────────────────────────
async function _agentDispatch(text) {
  // ── Slot payload (chip clicado) ──
  if (_agentIsSlotPayload(text) && _agent.pendingPlan) {
    const merged = _agentApplySlotPayload(_agent.pendingPlan, text);
    _agent.pendingPlan = null;
    _agentHideConfirmBar();
    await _agentExecute(merged, text);
    return;
  }

  // ── Preenchimento de campo no fluxo multi-turn ──
  if (_agent.pendingPlan && !_agentIsConfirmation(text)) {
    const merged = _agentMergeIntoPendingPlan(_agent.pendingPlan, text);
    if (merged) {
      _agent.pendingPlan = null;
      _agentHideConfirmBar();
      await _agentExecute(merged, text);
      return;
    }
  }

  // ── Confirmação explícita ──
  if (_agentIsConfirmation(text) && _agent.pendingPlan) {
    const plan = _agent.pendingPlan;
    _agent.pendingPlan = null;
    _agentHideConfirmBar();
    await _agentExecute(plan, text);
    return;
  }

  // ── v3: Tenta usar o engine pipeline primeiro ──
  if (_agent._engineReady && typeof AgentEngine !== 'undefined') {
    try {
      const engineResult = await AgentEngine.runPipeline(text, _agent, window.state || {});

      // Intent resolvível localmente com boa confiança → passa para o fluxo clássico
      if (engineResult.intent !== 'not_understood' && engineResult.confidence >= 0.55) {
        // Registra entidades resolvidas para uso futuro
        AgentEngine.Session.rememberEntities(engineResult.resolved || {});

        // Repassa para intents de query/help/navigate (sem mudar comportamento)
        if (engineResult.intent === 'help') { await _agentAnswerHelp(text); return; }
        if (engineResult.intent === 'finance_query') { await _agentAnswerFinance(text); return; }
        if (engineResult.intent === 'navigate') {
          const page = _agentExtractNavPage(text);
          if (page && typeof navigate === 'function') {
            navigate(page);
            _agentAppend('assistant', `✅ Abrindo **${page}**.`);
            return;
          }
        }

        // Para intents de ação: usa engine para guided UI e resolução de entidades
        if (_agentIsActionIntent(engineResult.intent)) {
          const plan = await _agentBuildPlanFromEngine(text, engineResult);
          await _agentExecute(plan, text);
          return;
        }
      }
    } catch(e) {
      console.warn('[agent] engine pipeline error, falling back:', e?.message || e);
      // Fallback gracioso para o fluxo clássico abaixo
    }
  }

  // ── Fluxo clássico (fallback) ──
  const intent = _agentClassifyIntent(text);

  if (intent === 'help') { await _agentAnswerHelp(text); return; }
  if (intent === 'finance_query') { await _agentAnswerFinance(text); return; }

  if (intent === 'navigate') {
    const page = _agentExtractNavPage(text);
    if (page && typeof navigate === 'function') {
      navigate(page);
      _agentAppend('assistant', `✅ Abrindo **${page}**.`);
      return;
    }
  }

  const plan = await _agentBuildPlan(text);
  await _agentExecute(plan, text);
}

// ── v3 Engine helpers ─────────────────────────────────────────────────────

// Verifica se o intent é de ação (não query/help/navigate)
function _agentIsActionIntent(intent) {
  return ['create_transaction','create_scheduled','create_payee','create_category',
          'create_family_member','create_account','create_debt','create_dream',
          'pay_debt','edit_entity','delete_entity'].includes(intent);
}

// Constrói um plano compatível com _agentExecute() a partir do resultado do engine
async function _agentBuildPlanFromEngine(userMessage, engineResult) {
  // Inicia com o resultado local do engine
  const data = engineResult.data || {};
  const missingFields = engineResult.missingFields || [];

  // Se confiança baixa e há chave Gemini, reforça com Gemini
  if (engineResult.confidence < 0.75) {
    const key = await _agentGetKey();
    if (key) {
      try {
        const geminiResult = await AgentEngine.runWithGemini(
          userMessage, _agent, window.state || {}, key
        );
        // Gemini tem prioridade para campos que o local não resolveu
        Object.assign(data, geminiResult.data);
        // Atualiza missing fields com a visão do Gemini
        if (geminiResult.missingFields.length < missingFields.length) {
          missingFields.length = 0;
          missingFields.push(...geminiResult.missingFields);
        }
      } catch (e) {
        console.warn('[agent] Gemini reforço falhou:', e?.message);
      }
    }
  }

  // Monta plano no formato esperado por _agentExecute()
  const plan = {
    intent: engineResult.intent,
    summary: _agentBuildSummary(engineResult.intent, data),
    requires_confirmation: false,
    missing_fields: missingFields,
    guided: missingFields.length > 0,
    actions: [{
      type: engineResult.intent,
      data: {
        ...data,
        date: data.date || new Date().toISOString().slice(0, 10),
      },
    }],
    // v3: HTML rico gerado pelo engine
    _guidedHtml: engineResult.guidedHtml || null,
    _ambiguities: engineResult.ambiguities || [],
  };

  return plan;
}

// Gera summary amigável para o plano
function _agentBuildSummary(intent, data) {
  const labels = {
    create_transaction: 'Criar transação',
    create_scheduled:  'Criar programado',
    create_payee:      'Criar beneficiário',
    create_category:   'Criar categoria',
    create_family_member: 'Criar membro da família',
    create_account:    'Criar conta',
    create_debt:       'Registrar dívida',
    create_dream:      'Criar sonho',
    pay_debt:          'Pagar dívida',
  };
  return labels[intent] || 'Executando ação';
}

// Mostra/esconde barra de confirmação visual
function _agentShowConfirmBar() {
  const bar = document.getElementById('agentConfirmBar');
  if (bar) bar.classList.add('active');
}
function _agentHideConfirmBar() {
  const bar = document.getElementById('agentConfirmBar');
  if (bar) bar.classList.remove('active');
}

// Atualiza quick replies baseado na página atual
function _agentRefreshQuickReplies() {
  if (typeof AgentEngine === 'undefined') return;
  const page = window.state?.currentPage || 'dashboard';
  const bar = document.getElementById('agentQuickBar');
  if (!bar) return;
  bar.innerHTML = AgentEngine.QuickReplies.render(page);
}

// ── Intent classifier ─────────────────────────────────────────────────────
function _agentClassifyIntent(text) {
  const msg = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const helpRx = [
    /como (adicionar|criar|cadastrar|editar|excluir|deletar|remover|configurar|ativar|desativar|convidar|usar|fazer|mudar|alterar)/,
    /o que [ee] (uma?|o|a)\s+(conta|transacao|categoria|orcamento|programado|beneficiario|modulo|dashboard|relatorio|previsao|reconciliacao|divida|investimento|cartao)/,
    /para que serve|como funciona|onde (fico|encontro|vejo|acho|esta)/,
    /nao (consigo|encontro|acho|sei|entendo)\s/,
    /o que significa|qual a diferenca|me explique|central de ajuda/,
    /como (mudar|trocar|alterar) (idioma|senha|foto|perfil|avatar|nome)/,
    /como (convidar|adicionar|remover) (membro|familiar|usuario)/,
    /o que (posso|da pra) fazer/,
  ];
  if (helpRx.some(p => p.test(msg))) return 'help';

  const financeRx = [
    /quanto (gastei|recebi|entrou|saiu|paguei|ganhei)/,
    /qual (meu|minha|o meu|a minha|foi o|foi a).{0,30}(saldo|gasto|despesa|receita|conta|categoria|total)/,
    /quais (contas|categorias|despesas|receitas|transacoes|programados)\s*(estao|tem|tenho|mais)/,
    /maior (gasto|despesa|receita|categoria|conta)/,
    /saldo (total|atual|das contas|por conta|negativo)/,
    /resumo (financeiro|do mes|mensal|das financas)/,
    /mostre (meu|minha|os|as)\s*(saldo|gasto|despesa|receita|conta|categoria)/,
    /tendencia|evolucao|historico (de gastos|financeiro|mensal)/,
    /estou (no vermelho|no azul|gastando mais|recebendo mais)/,
    /previsao|forecast|proximo mes/,
    /orcamento (restante|utilizado|estourado|disponivel)/,
    /minhas? financas|meu financeiro|minha situacao/,
  ];
  if (financeRx.some(p => p.test(msg))) return 'finance_query';

  if (/\b(abr[ia]|ir para|naveg|vai para)\b/.test(msg)) return 'navigate';
  if (/(cri[ea]r?|adicionar?|adicione|lanc[ae]r?|registrar?|registre)\s/.test(msg)) return 'action';

  return 'unknown';
}

// ════════════════════════════════════════════════════════════════════════════
// HELP — busca semântica em help.js + Gemini
// ════════════════════════════════════════════════════════════════════════════

async function _agentAnswerHelp(query) {
  const index = _agentBuildHelpIndex();
  if (!index.length) {
    _agentAppend('assistant', '⚠️ Central de ajuda não disponível no momento.');
    return;
  }

  const scored = _agentScoreHelpArticles(index, query);
  const top = scored.slice(0, 3);
  const key = await _agentGetKey();

  if (top.length && top[0].score >= 2 && key) {
    await _agentAnswerHelpWithGemini(query, top, key);
    return;
  }

  if (top.length && top[0].score >= 2) {
    const best = top[0];
    const lines = [`📖 **${best.title}**`, '', best.summary.slice(0, 300) + (best.summary.length > 300 ? '…' : '')];
    if (best.section) lines.push('', `*Seção: ${best.section}*`);
    if (top.length > 1) {
      lines.push('', '**Relacionados:**');
      top.slice(1).forEach(a => lines.push(`• ${a.title}`));
    }
    _agentAppend('assistant', lines.join('\n'));
    return;
  }

  if (key) {
    await _agentAnswerHelpWithGemini(query, index.slice(0, 8), key);
    return;
  }

  _agentAppend('assistant',
    '🤔 Não encontrei resposta exata.\n\n' +
    'Consulte a **Central de Ajuda** no menu lateral para mais detalhes.'
  );
}

async function _agentAnswerHelpWithGemini(query, articles, apiKey) {
  const ctx = articles.slice(0, 4).map(a =>
    `=== ${a.title} (${a.section}) ===\n${a.plainText.slice(0, 500)}`
  ).join('\n\n');

  const prompt = `Você é o suporte do app Family FinTrack.
Pergunta do usuário: "${query}"

Responda em português usando APENAS o contexto abaixo. Seja objetivo (máx 5 frases).
Use **negrito** para termos importantes. Se não souber, diga que não encontrou.

CONTEXTO:
${ctx}`;

  try {
    const resp = await _agentCallGemini(prompt, apiKey, 400);
    _agentAppend('assistant', resp);
  } catch (e) {
    _agentAppend('assistant', articles[0]?.summary || 'Consulte a Central de Ajuda para detalhes.');
  }
}

function _agentBuildHelpIndex() {
  try {
    if (typeof _helpContent !== 'function') return [];
    const lang = (typeof i18nGetLanguage === 'function') ? i18nGetLanguage() : 'pt';
    return _helpContent().flatMap(section => {
      const sectionTitle = section.title?.[lang] || section.title?.pt || '';
      return (section.articles || []).map(article => {
        const title = article.title?.[lang] || article.title?.pt || '';
        const rawBody = article.body?.[lang] || article.body?.pt || '';
        const plainText = _agentStripHtml(typeof rawBody === 'string' ? rawBody : String(rawBody));
        return {
          id: article.id, section: sectionTitle, title,
          plainText,
          summary: plainText.replace(/\s+/g,' ').trim().slice(0, 300),
          keywords: _agentExtractKeywords(title + ' ' + plainText),
        };
      });
    });
  } catch (e) { return []; }
}

function _agentScoreHelpArticles(index, query) {
  const qWords = _agentTokenize(query);
  return index.map(a => {
    let score = 0;
    const tWords = _agentTokenize(a.title);
    const bWords = _agentTokenize(a.plainText);
    for (const qw of qWords) {
      if (qw.length < 3) continue;
      if (tWords.some(w => w.includes(qw) || qw.includes(w))) score += 3;
      if (bWords.some(w => w.includes(qw) || qw.includes(w))) score += 1;
      if (a.keywords.includes(qw)) score += 2;
    }
    if (_agentTokenize(a.section).some(w => qWords.includes(w))) score += 1;
    return { ...a, score };
  }).filter(a => a.score > 0).sort((a,b) => b.score - a.score);
}

function _agentStripHtml(html) {
  return html.replace(/<[^>]+>/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();
}

function _agentTokenize(text) {
  return String(text||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(w=>w.length>=3);
}

function _agentExtractKeywords(text) {
  const stop = new Set(['para','como','que','uma','com','por','mais','mas','nao','dos','das','nos','nas','seu','sua','seus','suas','este','esta','esse','essa','isto','isso','aqui','ali','tambem','ainda','bem','quando','onde','quem','qual','porque','entao','assim','cada','todo','toda','todos','todas','muito','antes','depois','entre','sobre','sem','ter','ser','foi','sao','esta','tem','vai','deve','pode']);
  return _agentTokenize(text).filter(w => !stop.has(w));
}

// ════════════════════════════════════════════════════════════════════════════
// FINANCE QUERY
// ════════════════════════════════════════════════════════════════════════════

async function _agentAnswerFinance(query) {
  await _agentEnsureContextLoaded();
  const msg = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const key = await _agentGetKey();

  let snapshot = '';

  if (/saldo|conta|vermelho|azul/.test(msg)) {
    snapshot = _agentFinanceBalances();
  } else if (/gastei|gasto|despesa|receita|entrou|saiu|paguei|ganhei/.test(msg)) {
    const period = _agentParsePeriodFromQuery(msg);
    snapshot = await _agentFinanceSpending(period);
  } else if (/orcamento|budget|restante|estourado|limite/.test(msg)) {
    snapshot = _agentFinanceBudgets();
  } else if (/programado|recorrente|proximo mes|vencer|debito/.test(msg)) {
    snapshot = _agentFinanceScheduled();
  } else {
    snapshot = _agentBuildFinanceSnapshot();
  }

  if (key) {
    await _agentFinanceWithGemini(query, snapshot, key);
  } else {
    _agentAppend('assistant', snapshot);
  }
}

async function _agentFinanceWithGemini(query, data, apiKey) {
  const prompt = `Você é o assistente financeiro do app Family FinTrack.
Pergunta: "${query}"

Use SOMENTE os dados abaixo. Responda em português, de forma objetiva (máx 8 linhas).
Use **negrito** e listas com •. Não invente dados.

DADOS:
${data}`;
  try {
    _agentAppend('assistant', await _agentCallGemini(prompt, apiKey, 500));
  } catch (e) {
    _agentAppend('assistant', data);
  }
}

function _agentFinanceBalances() {
  const accs = state.accounts || [];
  if (!accs.length) return '⚠️ Nenhuma conta cadastrada.';
  const f = (v,cur) => typeof fmt==='function'?fmt(v,cur||'BRL'):`R$ ${Number(v).toFixed(2)}`;
  const toBrl = (v,cur) => typeof toBRL==='function'?toBRL(v,cur):Number(v);
  const total = accs.reduce((s,a)=>s+toBrl(Number(a.balance)||0,a.currency||'BRL'),0);
  const neg = accs.filter(a=>Number(a.balance)<0);
  const lines = ['**💰 Saldo das contas:**',''];
  accs.forEach(a => {
    const bal = Number(a.balance)||0;
    const icon = bal < 0 ? '🔴' : '🟢';
    const brl = a.currency!=='BRL' ? ` *(${f(toBrl(bal,a.currency),'BRL')} BRL)*` : '';
    lines.push(`${icon} **${a.name}**: ${f(bal,a.currency)}${brl}`);
  });
  lines.push('',`**Total BRL: ${f(total,'BRL')}**`);
  if (neg.length) lines.push('',`⚠️ ${neg.length} conta(s) negativa(s): ${neg.map(a=>a.name).join(', ')}`);
  return lines.join('\n');
}

async function _agentFinanceSpending(period) {
  const { year, month, label } = period;
  const f = (v) => typeof fmt==='function'?fmt(v,'BRL'):`R$ ${Number(v).toFixed(2)}`;
  let txs = state.transactions || [];

  // Try to fetch from DB for the specific period
  if (_agentGetFamilyId()) {
    try {
      const start = `${year}-${String(month).padStart(2,'0')}-01`;
      const end   = `${year}-${String(month).padStart(2,'0')}-31`;
      const { data } = await sb.from('transactions')
        .select('amount,status,categories(name)')
        .gte('date',start).lte('date',end)
        .eq('family_id',_agentGetFamilyId())
        .eq('is_transfer',false).neq('is_card_payment',true)
        .limit(500);
      if (data?.length) txs = data;
    } catch(e) { console.warn('[agent finance]',e); }
  }

  if (!txs.length) return `📭 Nenhuma transação para ${label}.`;

  let income=0, expense=0;
  const byCat = {};
  for (const t of txs) {
    if ((t.status||'confirmed')==='pending') continue;
    const amt = Number(t.amount)||0;
    if (amt>0) income+=amt; else expense+=Math.abs(amt);
    const cat = t.categories?.name||'Sem categoria';
    if (amt<0) byCat[cat]=(byCat[cat]||0)+Math.abs(amt);
  }

  const topCats = Object.entries(byCat).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const lines=[
    `**📅 ${label}:**`,'',
    `🟢 Receitas: **${f(income)}**`,
    `🔴 Despesas: **${f(expense)}**`,
    `${income-expense>=0?'✅':'⚠️'} Resultado: **${f(income-expense)}**`,
  ];
  if (topCats.length) {
    lines.push('','**🏷️ Maiores despesas por categoria:**');
    topCats.forEach(([cat,val])=>{
      const pct = expense>0?((val/expense)*100).toFixed(0):0;
      lines.push(`• **${cat}**: ${f(val)} (${pct}%)`);
    });
  }
  return lines.join('\n');
}

function _agentFinanceBudgets() {
  const budgets = state.budgets||[];
  if (!budgets.length) return '📭 Nenhum orçamento cadastrado.';
  const f=(v)=>typeof fmt==='function'?fmt(v,'BRL'):`R$ ${Number(v).toFixed(2)}`;
  const lines=['**🎯 Orçamentos:**',''];
  budgets.forEach(b=>{
    const limit=Number(b.amount)||0, spent=Number(b.spent)||0;
    const pct=limit>0?Math.round((spent/limit)*100):0;
    const icon=pct>=100?'🔴':pct>=80?'🟡':'🟢';
    lines.push(`${icon} **${b.categories?.name||'Categoria'}**: ${f(spent)} / ${f(limit)} (${pct}%)`);
  });
  return lines.join('\n');
}

function _agentFinanceScheduled() {
  const sched=state.scheduled||[];
  if (!sched.length) return '📭 Nenhum programado cadastrado.';
  const f=(v)=>typeof fmt==='function'?fmt(Math.abs(v),'BRL'):`R$ ${Math.abs(Number(v)).toFixed(2)}`;
  const active=sched.filter(s=>(s.status||'active')==='active');
  const exp=active.filter(s=>Number(s.amount)<0);
  const inc=active.filter(s=>Number(s.amount)>0);
  const totalExp=exp.reduce((s,t)=>s+Math.abs(Number(t.amount)||0),0);
  const totalInc=inc.reduce((s,t)=>s+(Number(t.amount)||0),0);
  const lines=[
    `**📅 Programados ativos:**`,'',
    `🔴 Despesas: **${f(totalExp)}** (${exp.length} itens)`,
    `🟢 Receitas: **${f(totalInc)}** (${inc.length} itens)`,
  ];
  if (exp.length) {
    lines.push('','**Maiores despesas programadas:**');
    exp.sort((a,b)=>Math.abs(Number(a.amount))-Math.abs(Number(b.amount))).reverse().slice(0,5)
      .forEach(s=>lines.push(`• **${s.description}**: ${f(s.amount)} (${s.frequency||'mensal'})`));
  }
  return lines.join('\n');
}

function _agentBuildFinanceSnapshot() {
  const f=(v)=>typeof fmt==='function'?fmt(v,'BRL'):`R$ ${Number(v).toFixed(2)}`;
  const toBrl=(v,cur)=>typeof toBRL==='function'?toBRL(v,cur):Number(v);
  const accs=state.accounts||[];
  const total=accs.reduce((s,a)=>s+toBrl(Number(a.balance)||0,a.currency||'BRL'),0);
  const txs=state.transactions||[];
  const inc=txs.filter(t=>Number(t.amount)>0).reduce((s,t)=>s+Number(t.amount),0);
  const exp=txs.filter(t=>Number(t.amount)<0).reduce((s,t)=>s+Math.abs(Number(t.amount)),0);
  return [
    `**💰 Total em contas: ${f(total)}**`,
    `📈 Receitas (exibidas): ${f(inc)}`,
    `📉 Despesas (exibidas): ${f(exp)}`,
    `📅 Programados ativos: ${(state.scheduled||[]).filter(s=>(s.status||'active')==='active').length}`,
    `🎯 Orçamentos: ${(state.budgets||[]).length}`,
    `🏦 Contas: ${accs.length} (${accs.filter(a=>Number(a.balance)<0).length} negativa(s))`,
  ].join('\n');
}

function _agentParsePeriodFromQuery(msg) {
  const now=new Date();
  const months={janeiro:1,fevereiro:2,marco:3,abril:4,maio:5,junho:6,julho:7,agosto:8,setembro:9,outubro:10,novembro:11,dezembro:12};
  for (const [n,num] of Object.entries(months)) {
    if (msg.includes(n)) {
      const y=msg.match(/20\d{2}/)?.[0]||now.getFullYear();
      return {year:Number(y),month:num,label:`${n} ${y}`};
    }
  }
  if (/mes passado|ultimo mes/.test(msg)) {
    const d=new Date(now.getFullYear(),now.getMonth()-1,1);
    return {year:d.getFullYear(),month:d.getMonth()+1,label:'mês passado'};
  }
  return {year:now.getFullYear(),month:now.getMonth()+1,label:'este mês'};
}

// ════════════════════════════════════════════════════════════════════════════
// ACTIONS — build + execute
// ════════════════════════════════════════════════════════════════════════════

async function _agentBuildPlan(userMessage) {
  const direct = _agentParseStructured(userMessage);
  if (direct.intent !== 'not_understood') return direct;
  const key = await _agentGetKey();
  if (!key) return { ...direct, _noKey: true };
  _agent.apiKey = key;

  // v3: usa o contrato Gemini do engine se disponível
  if (_agent._engineReady && typeof AgentEngine !== 'undefined') {
    try {
      const result = await AgentEngine.runWithGemini(userMessage, _agent, window.state || {}, key);
      return _agentNormalizeEngineResult(result, userMessage);
    } catch(e) {
      console.warn('[agent] engine Gemini failed, falling back to classic:', e?.message);
    }
  }

  // Fallback clássico
  const aiPlan = await _agentPlanWithGemini(userMessage);
  return _agentNormalizePlan(aiPlan, userMessage);
}

// Converte resultado do engine para formato de plano clássico
function _agentNormalizeEngineResult(engineResult, originalText) {
  const intent = engineResult.intent || 'not_understood';
  if (!AGENT_ALLOWED_INTENTS.has(intent) && intent !== 'not_understood') {
    // Intents novos do v3 que não estão no set clássico — tenta mapear
    const mapped = {
      create_account: 'not_understood', // ainda não implementado, seguro
      create_dream:   'not_understood',
      pay_debt:       'not_understood',
      edit_entity:    'not_understood',
      delete_entity:  'not_understood',
    };
    if (mapped[intent]) {
      _agentAppend('assistant', `ℹ️ A ação **${_agentBuildSummary(intent, {})}** ainda está em desenvolvimento. Em breve!`);
    }
  }

  const data = engineResult.data || {};
  return {
    intent,
    summary: _agentBuildSummary(intent, data),
    requires_confirmation: false,
    missing_fields: engineResult.missingFields || [],
    guided: (engineResult.missingFields || []).length > 0,
    actions: [{ type: intent, data }],
    _guidedHtml: engineResult.guidedHtml || null,
    _ambiguities: engineResult.ambiguities || [],
  };
}

async function _agentPlanWithGemini(userMessage) {
  // v3: usa o prompt do contrato Gemini se engine disponível
  if (_agent._engineReady && typeof AgentEngine !== 'undefined') {
    const ctx = _agentBuildContext();
    const prompt = AgentEngine.GeminiContract.buildInterpretPrompt(userMessage, {
      ...ctx,
      currentPage: window.state?.currentPage || 'dashboard',
      pendingIntent: null,
    });
    for (const model of ['gemini-2.0-flash','gemini-2.5-flash','gemini-2.5-flash-lite']) {
      try {
        const text = await _agentCallGemini(prompt, _agent.apiKey, 800, model);
        const parsed = AgentEngine.GeminiContract.parseResponse(text);
        // Converte para formato de plano clássico
        return {
          intent: parsed.intent,
          summary: _agentBuildSummary(parsed.intent, parsed.extracted_fields),
          requires_confirmation: parsed.confidence < 0.85,
          actions: [{ type: parsed.intent, data: parsed.extracted_fields || {} }],
          missing_fields: parsed.missing_fields || [],
          ambiguous_fields: (parsed.ambiguities || []).map(a => a.field),
          guided: (parsed.missing_fields || []).length > 0,
        };
      } catch (e) {
        if (!/404/.test(e.message||'')) throw e;
      }
    }
  }

  // Fallback: prompt clássico
  const ctx = _agentBuildContext();
  const prompt = `Você é o FinTrack Agent. Converta o pedido em JSON para execução no app.
Retorne APENAS JSON válido, sem markdown.

Data: ${ctx.today}
Contas: ${JSON.stringify(ctx.accounts)}
Categorias: ${JSON.stringify(ctx.categories)}
Beneficiários: ${JSON.stringify(ctx.payees)}

Formato:
{"intent":"create_transaction|create_scheduled|create_payee|create_category|create_debt|navigate|not_understood","summary":"texto","requires_confirmation":false,"actions":[{"type":"...","data":{}}]}

Regras: despesa=amount negativo, receita=positivo. Use *_name quando sem id. Se faltar dado crítico, intent=not_understood.

Pedido: ${JSON.stringify(userMessage)}`;

  for (const model of ['gemini-2.0-flash','gemini-2.5-flash','gemini-2.5-flash-lite']) {
    try {
      const text = await _agentCallGemini(prompt, _agent.apiKey, 800, model);
      return JSON.parse(_agentExtractJson(text));
    } catch (e) {
      if (!/404/.test(e.message||'')) throw e;
    }
  }
  throw new Error('Não foi possível interpretar o pedido com a IA.');
}

// ── Core Gemini caller ─────────────────────────────────────────────────────
async function _agentCallGemini(prompt, apiKey, maxTokens=600, model='gemini-2.0-flash') {
  const url=`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const resp=await fetch(url,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:maxTokens,temperature:0.15}})
  });
  if(!resp.ok){const raw=await resp.text().catch(()=>'');throw new Error(`Gemini HTTP ${resp.status}${raw?': '+raw.slice(0,120):''}`);}
  const data=await resp.json();
  return data?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'';
}

function _agentExtractJson(text) {
  const s=String(text||'').trim().replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```$/i,'').trim();
  const f=s.indexOf('{'),l=s.lastIndexOf('}');
  return (f>=0&&l>f)?s.slice(f,l+1):s;
}

function _agentNormalizePlan(plan, originalText) {
  if (!plan||typeof plan!=='object') return _agentParseStructured(originalText);
  if (!AGENT_ALLOWED_INTENTS.has(plan.intent)) plan.intent='not_understood';
  plan.summary=plan.summary||'';
  plan.actions=Array.isArray(plan.actions)?plan.actions:[];
  plan.requires_confirmation=!!plan.requires_confirmation;
  plan.missing_fields=Array.isArray(plan.missing_fields)?plan.missing_fields:[];
  plan.ambiguous_fields=Array.isArray(plan.ambiguous_fields)?plan.ambiguous_fields:[];
  plan.guided=plan.missing_fields.length>0;
  return plan;
}

function _agentParseStructured(text) {
  const raw=String(text||'').trim();
  const msg=raw.toLowerCase();
  const amount=_agentParseAmount(raw);
  const date=_agentParseDate(raw);

  if (/saldo total|qual .*saldo|quanto .*saldo/.test(msg))
    return {intent:'query_balance',summary:'Consultando saldo',requires_confirmation:false,actions:[]};

  if (/\b(abr[ia]|ir para|naveg)\b/.test(msg)) {
    const page=_agentExtractNavPage(text);
    if (page) return {intent:'navigate',summary:`Abrindo ${page}`,requires_confirmation:false,actions:[{type:'navigate',data:{page}}]};
  }

  if (/(membro|integrante|familiar)/.test(msg)&&/(cri[ea]r?|adicionar?|cadastro|cadastrar|adicione)/.test(msg)) {
    const name=_agentExtractAfter(raw,[/nome\s+([^,.;]+?)(?=\s+(?:e\s+)?(?:nascimento|data)\b|[,.;]|$)/i,/membro\s+(?:da\s+fam[ií]lia\s+)?(?:com\s+nome\s+)?([^,.;]+?)(?=\s+(?:e\s+)?(?:nascimento|data)\b|[,.;]|$)/i,/integrante\s+(?:com\s+nome\s+)?([^,.;]+?)(?=\s+(?:e\s+)?(?:nascimento|data)\b|[,.;]|$)/i,/familiar\s+(?:com\s+nome\s+)?([^,.;]+?)(?=\s+(?:e\s+)?(?:nascimento|data)\b|[,.;]|$)/i]);
    const birth_date=_agentParseBirthDate(raw);
    const relationship=_agentParseFamilyRelationship(raw);
    const member_type=_agentInferFamilyMemberType(raw,birth_date,relationship);
    const plan={intent:'create_family_member',summary:'Criando membro da família',requires_confirmation:false,actions:[{type:'create_family_member',data:{name,birth_date,member_type,family_relationship:relationship}}]};
    return _agentFinalizeGuidedPlan(plan);
  }

  if (/(cri[ea]r?|adicionar?|adicione|lanc[ae]r?|registrar?|registre)\s.*?(transac|despesa|receita)/.test(msg)) {
    const isIncome=/(receita|entrada|ganho|recebimento)/.test(msg);
    const parts=_agentExtractTransactionEntities(raw,{kind:'transaction',isIncome});
    const plan={intent:'create_transaction',summary:'Criando transação',requires_confirmation:false,actions:[{type:'create_transaction',data:{
      date,amount:isIncome?(amount===null?null:Math.abs(amount)):(amount===null?null:-Math.abs(amount)),type:isIncome?'income':'expense',
      description:parts.description||_agentParseDescription(raw,{kind:'transaction',isIncome}),
      account_name:parts.account_name||'',
      category_name:parts.category_name||'',
      payee_name:parts.payee_name||'',
      family_member_name:_agentExtractAfter(raw,[/(?:pelo|pela)\s+([^,.;]+)/i]),
    }}]};
    return _agentFinalizeGuidedPlan(plan);
  }

  if (/programad/.test(msg)) {
    const isIncome=/receita|entrada/.test(msg);
    const parts=_agentExtractTransactionEntities(raw,{kind:'scheduled',isIncome});
    const plan={intent:'create_scheduled',summary:'Criando programado',requires_confirmation:false,actions:[{type:'create_scheduled',data:{
      date,amount:isIncome?(amount===null?null:Math.abs(amount)):(amount===null?null:-Math.abs(amount)),type:isIncome?'income':'expense',
      description:parts.description||_agentParseDescription(raw,{kind:'scheduled',isIncome}),
      account_name:parts.account_name||'',
      category_name:parts.category_name||'',
      payee_name:parts.payee_name||'',
      frequency:_agentParseFrequency(msg)||'',
      start_date:date,installments:_agentParseInstallments(msg),
      family_member_name:_agentExtractAfter(raw,[/(?:para\s+o|para\s+a|pro\s+o|pro\s+a|pra\s+o|pra\s+a)\s+([^,.;]+)/i]),
    }}]};
    return _agentFinalizeGuidedPlan(plan);
  }

  if (/benefici[aá]rio|favorecido/.test(msg)&&/(cri[ea]|adicione)/.test(msg)) {
    const name=_agentExtractAfter(raw,[/benefici[aá]rio\s+([^,.;]+)/i,/favorecido\s+([^,.;]+)/i]);
    return _agentFinalizeGuidedPlan({intent:'create_payee',summary:'Criando beneficiário',requires_confirmation:false,actions:[{type:'create_payee',data:{name}}]});
  }

  if (/categoria/.test(msg)&&/(cri[ea]|adicione)/.test(msg)) {
    const name=_agentExtractAfter(raw,[/categoria\s+([^,.;]+)/i]);
    return _agentFinalizeGuidedPlan({intent:'create_category',summary:'Criando categoria',requires_confirmation:false,actions:[{type:'create_category',data:{name,type:'expense',color:_agentParseColor(msg)}}]});
  }

  if (/d[ií]vida/.test(msg)&&amount!==null)
    return {intent:'create_debt',summary:'Criando dívida',requires_confirmation:false,actions:[{type:'create_debt',data:{description:_agentParseDescription(raw),creditor:_agentExtractPayee(raw),original_amount:Math.abs(amount),start_date:date}}],missing_fields:[]};

  // v3: Criar conta
  if (/(cri[ea]r?|adicionar?|adicione|cadastr[ae]r?)\s.*(conta|bank)/.test(msg)&&!/(transa|despesa|receita)/.test(msg)) {
    const name=_agentExtractAfter(raw,[/conta\s+(?:chamada?\s+)?([^,.;]+?)(?=\s+(?:tipo|de|no|na)\b|[,.;]|$)/i,/(?:de\s+nome\s+|chamada?\s+)([^,.;]+?)(?=[,.;]|$)/i]);
    const accType=_agentParseAccountType(msg);
    const currency=/(dolar|dollar|usd|\$\s*\d)/.test(msg)?'USD':/(euro|eur)/.test(msg)?'EUR':'BRL';
    return _agentFinalizeGuidedPlan({intent:'create_account',summary:'Criando conta',requires_confirmation:false,
      actions:[{type:'create_account',data:{name,type:accType,currency,balance:amount||0}}]});
  }

  // v3: Criar sonho / meta
  if (/(sonho|meta|objetivo|poupar?\s+para|guardar?\s+para)/.test(msg)&&/(cri[ea]r?|adicionar?|adicione|quero)/.test(msg)) {
    const name=_agentExtractAfter(raw,[/sonho\s+(?:de\s+)?([^,.;]+?)(?=\s+(?:de|com|no)\b|[,.;]|$)/i,/meta\s+(?:de\s+)?([^,.;]+?)(?=\s+(?:de|com|no)\b|[,.;]|$)/i,/objetivo\s+(?:de\s+)?([^,.;]+?)(?=[,.;]|$)/i]);
    const targetDate=_agentParseTargetDate(raw);
    return _agentFinalizeGuidedPlan({intent:'create_dream',summary:'Criando sonho',requires_confirmation:false,
      actions:[{type:'create_dream',data:{name,target_amount:amount?Math.abs(amount):null,target_date:targetDate}}]});
  }

  // v3: Pagar dívida
  if (/(pagar?|quitar|abater|registrar?\s+pagamento)/.test(msg)&&/(d[ií]vida|parcela|credor)/.test(msg)) {
    const creditor=_agentExtractPayee(raw);
    return _agentFinalizeGuidedPlan({intent:'pay_debt',summary:'Pagando dívida',requires_confirmation:true,
      actions:[{type:'pay_debt',data:{name:creditor,amount:amount?Math.abs(amount):null}}]});
  }

  return {intent:'not_understood',summary:'',requires_confirmation:false,actions:[],missing_fields:[]};
}

function _agentExtractNavPage(text) {
  const navMap=[
    ['dashboard',/dashboard|painel/],['transactions',/transa[cç][aã]o|lan[çc]amento|despesa|receita/],
    ['scheduled',/programad/],['reports',/relat[oó]rio|forecast|previs[aã]o/],
    ['payees',/benefici[aá]rio|favorecido/],['categories',/categoria/],
    ['accounts',/\bconta/],['budgets',/or[cç]amento/],
    ['settings',/configura[cç][oõ]es?/],['help',/ajuda|help/],
    ['investments',/investimento/],['debts',/d[ií]vida/],
    ['prices',/pre[cç]o/],['grocery',/lista.*compra/],
  ];
  const msg=text.toLowerCase();
  return navMap.find(([,rx])=>rx.test(msg))?.[0]||null;
}

async function _agentExecute(plan, originalText) {
  const normalized=_agentNormalizePlan(plan,originalText);

  if (normalized.intent==='not_understood') {
    // v3: usa resposta rica do engine
    if (typeof AgentEngine !== 'undefined') {
      const key = await _agentGetKey();
      _agentAppendStructured('assistant',
        AgentEngine.ResponseBuilder.notUnderstood(!!key).html,
        'Não entendido'
      );
    } else {
      _agentAppend('assistant', normalized._noKey
        ? '🤔 Pedido não reconhecido.\n\nPara pedidos complexos, configure a **chave Gemini** em Configurações → IA.\n\nOu tente: *"Quanto gastei este mês?"* ou *"Como criar uma conta?"*'
        : '🤔 Não consegui mapear esse pedido.\n\nTente:\n• *"Crie despesa de R$50 em Alimentação"*\n• *"Quanto gastei este mês?"*\n• *"Como criar uma conta?"*'
      );
    }
    return;
  }

  if (normalized.guided) {
    _agent.pendingPlan = normalized;
    _agent.session.draftPlan = normalized;
    _agent.session.draftUpdatedAt = Date.now();
    // v3: usa HTML rico do engine se disponível, senão HTML clássico
    const html = normalized._guidedHtml || _agentBuildGuidedHtml(normalized);
    _agentAppendStructured('assistant', html, normalized.summary || 'Preencha os campos faltantes.');
    return;
  }

  if (normalized.intent==='confirm') {
    if (!_agent.pendingPlan) { _agentAppend('assistant','Não há ação pendente.'); return; }
    plan=_agent.pendingPlan; _agent.pendingPlan=null;
    _agentHideConfirmBar();
  } else if (normalized.requires_confirmation) {
    _agent.pendingPlan=normalized;
    // v3: mostra barra de confirm visual + mensagem
    _agentShowConfirmBar();
    _agentAppend('assistant',`🧾 ${normalized.summary||'Ação a executar.'}\n\nConfirme abaixo ou digite **ok**.`);
    return;
  } else {
    plan=normalized;
  }

  if (plan.intent==='query_balance') { _agentAnswerBalance(); return; }

  await _agentEnsureContextLoaded();

  if (plan.intent==='navigate') {
    const page=plan.actions?.[0]?.data?.page;
    if (page&&typeof navigate==='function') { navigate(page); _agentAppend('assistant',`✅ Abrindo **${page}**.`); return; }
  }

  _agentAppend('assistant',`🔄 **${plan.summary||'Executando…'}**`);
  const results=[], ctx={};
  for (const action of (plan.actions||[])) {
    try { results.push(await _agentRunAction(action,ctx)); }
    catch (e) { results.push({ok:false,msg:`Erro em ${action.type}: ${e.message}`}); }
  }
  const allOk=results.length&&results.every(r=>r.ok);

  // v3: usa resposta rica para sucesso/erro
  if (typeof AgentEngine !== 'undefined') {
    const msg = results.map(r=>r.msg).join('\n');
    if (allOk) {
      _agentAppendStructured('assistant', AgentEngine.ResponseBuilder.success(msg).html, msg);
    } else {
      const errMsg = results.filter(r=>!r.ok).map(r=>r.msg).join('\n');
      const suggestions = ['Tente novamente', 'Ver contas', 'Ajuda'];
      _agentAppendStructured('assistant', AgentEngine.ResponseBuilder.error(errMsg, suggestions).html, errMsg);
    }
  } else {
    _agentAppend('assistant',results.map(r=>r.ok?`✅ ${r.msg}`:`❌ ${r.msg}`).join('\n')+(allOk?'\n\n*Tudo pronto!*':''));
  }

  if (allOk) {
    _agent.pendingPlan = null;
    _agent.session.draftPlan = null;
    if (typeof AgentEngine !== 'undefined') AgentEngine.Session.reset();
    _agentHideConfirmBar();
    await _agentRefreshAfterPlan(plan);
    // v3: atualiza quick replies após ação
    setTimeout(_agentRefreshQuickReplies, 300);
  }
}

async function _agentRunAction(action,ctx) {
  const d=action.data||{};
  switch(action.type){
    case 'check_payee':    return _agentEnsurePayee(d.name||d.payee_name||'',ctx);
    case 'check_category': return _agentEnsureCategory(d.category_name||d.name||'',d.type||'expense',d.color,ctx);
    case 'create_transaction': return _agentCreateTransaction(d,ctx);
    case 'create_scheduled':   return _agentCreateScheduled(d,ctx);
    case 'create_payee':       return _agentEnsurePayee(d.name||'',ctx,true);
    case 'create_category':    return _agentEnsureCategory(d.name||'',d.type||'expense',d.color,ctx,true);
    case 'create_family_member': return _agentCreateFamilyMember(d);
    case 'create_debt':        return _agentCreateDebt(d);
    case 'create_account':     return _agentCreateAccount(d);
    case 'create_dream':       return _agentCreateDream(d);
    case 'pay_debt':           return _agentPayDebt(d);
    case 'navigate':
      if(d.page&&typeof navigate==='function'){navigate(d.page);return{ok:true,msg:`Página **${d.page}** aberta`};}
      throw new Error('Página não informada.');
    default: return{ok:false,msg:`Ação desconhecida: ${action.type}`};
  }
}

async function _agentEnsurePayee(name,ctx,explicit=false){
  const c=String(name||'').trim();
  if(!c) return{ok:!explicit,msg:explicit?'Nome não informado.':'Sem beneficiário'};
  const ex=_agentFindByName(state.payees||[],c);
  if(ex){ctx.payee_id=ex.id;return{ok:true,msg:`Beneficiário **${ex.name}** encontrado`};}
  const{data,error}=await sb.from('payees').insert({name:c,type:'beneficiario',family_id:_agentGetFamilyId()}).select('id,name,type').single();
  if(error) throw new Error(error.message);
  state.payees=[...(state.payees||[]),data];
  if(typeof DB!=='undefined'&&DB.payees?.bust) DB.payees.bust();
  ctx.payee_id=data.id;
  return{ok:true,msg:`Beneficiário **${c}** criado`};
}

async function _agentEnsureCategory(name,type='expense',color='#2a6049',ctx={},explicit=false){
  const c=String(name||'').trim();
  if(!c) return{ok:!explicit,msg:explicit?'Nome não informado.':'Sem categoria'};
  const ex=_agentFindByName(state.categories||[],c);
  if(ex){ctx.category_id=ex.id;return{ok:true,msg:`Categoria **${ex.name}** encontrada`};}
  const{data,error}=await sb.from('categories').insert({name:c,type,color:color||'#2a6049',family_id:_agentGetFamilyId()}).select('id,name,type,color').single();
  if(error) throw new Error(error.message);
  state.categories=[...(state.categories||[]),data];
  ctx.category_id=data.id;
  return{ok:true,msg:`Categoria **${c}** criada`};
}

async function _agentCreateTransaction(d,ctx){
  const account=_agentResolveAccountObj(d.account_id,d.account_name);
  if(!account) throw new Error('Conta não encontrada. Especifique o nome da conta.');
  let catId=d.category_id||ctx.category_id||_agentResolveCategory(d.category_name);
  if(!catId&&d.category_name){const r=await _agentEnsureCategory(d.category_name,d.type==='income'?'income':'expense',null,ctx);if(!r.ok)throw new Error(r.msg);catId=ctx.category_id;}
  let payId=d.payee_id||ctx.payee_id||_agentResolvePayee(d.payee_name);
  if(!payId&&d.payee_name){const r=await _agentEnsurePayee(d.payee_name,ctx);if(!r.ok)throw new Error(r.msg);payId=ctx.payee_id;}
  let amount=Number(d.amount||0);
  if(!Number.isFinite(amount)||!amount) throw new Error('Valor inválido.');
  if((d.type||'').toLowerCase()==='expense'&&amount>0) amount=-amount;
  if((d.type||'').toLowerCase()==='income'&&amount<0) amount=Math.abs(amount);
  const payload={date:d.date||new Date().toISOString().slice(0,10),description:d.description||d.payee_name||'Lançamento via Agent',amount,account_id:account.id,category_id:catId||null,payee_id:payId||null,family_id:_agentGetFamilyId(),status:'confirmed',is_transfer:false,is_card_payment:false,updated_at:new Date().toISOString()};
  const{data,error}=await sb.from('transactions').insert(payload).select('id,date,description,amount').single();
  if(error) throw new Error(error.message);
  if(typeof notifyOnTransaction==='function'){try{await notifyOnTransaction(data);}catch(_){}}
  ctx.last_transaction_id=data.id;
  const fmtAmt=typeof fmt==='function'?fmt(Math.abs(amount),account.currency||'BRL'):Math.abs(amount).toFixed(2);
  return{ok:true,msg:`**${payload.description}** em **${account.name}** — ${fmtAmt}`};
}

async function _agentCreateScheduled(d,ctx){
  const account=_agentResolveAccountObj(d.account_id,d.account_name);
  if(!account) throw new Error('Conta não encontrada.');
  let catId=d.category_id||ctx.category_id||_agentResolveCategory(d.category_name);
  if(!catId&&d.category_name){await _agentEnsureCategory(d.category_name,d.type==='income'?'income':'expense',null,ctx);catId=ctx.category_id;}
  let payId=d.payee_id||ctx.payee_id||_agentResolvePayee(d.payee_name);
  if(!payId&&d.payee_name){await _agentEnsurePayee(d.payee_name,ctx);payId=ctx.payee_id;}
  let amount=Number(d.amount||0);
  if(!Number.isFinite(amount)||!amount) throw new Error('Valor inválido.');
  if((d.type||'').toLowerCase()!=='income') amount=-Math.abs(amount);
  const payload={description:d.description||d.payee_name||'Programado via Agent',amount,type:d.type||'expense',frequency:d.frequency||'monthly',start_date:d.start_date||new Date().toISOString().slice(0,10),installments:d.installments??null,account_id:account.id,category_id:catId||null,payee_id:payId||null,family_id:_agentGetFamilyId(),auto_register:true,status:'active',updated_at:new Date().toISOString()};
  const{error}=await sb.from('scheduled_transactions').insert(payload);
  if(error) throw new Error(error.message);
  return{ok:true,msg:`Programado **${payload.description}** (${payload.frequency})`};
}

async function _agentCreateDebt(d){
  const amount=Math.abs(Number(d.original_amount||d.amount||0));
  if(!amount) throw new Error('Valor inválido.');
  const payload={description:d.description||d.creditor||'Dívida via Agent',creditor:d.creditor||d.description||'Credor',original_amount:amount,current_balance:amount,currency:d.currency||'BRL',start_date:d.start_date||new Date().toISOString().slice(0,10),status:'active',family_id:_agentGetFamilyId(),updated_at:new Date().toISOString()};
  const{error}=await sb.from('debts').insert(payload);
  if(error) throw new Error(error.message);
  return{ok:true,msg:`Dívida **${payload.description}** — ${typeof fmt==='function'?fmt(amount,'BRL'):amount.toFixed(2)}`};
}


async function _agentCreateFamilyMember(d){
  const name=String(d.name||'').trim();
  if(!name) throw new Error('Nome do membro não informado.');
  const family_id=_agentGetFamilyId();
  if(!family_id) throw new Error('Família não identificada.');
  if(typeof loadFamilyComposition==='function') { try { await loadFamilyComposition(); } catch(_) {} }
  const existing=_agentFindByName((typeof getFamilyMembers==='function'?getFamilyMembers():[]), name);
  if(existing) return {ok:true,msg:`Membro **${existing.name}** já existe`};
  const record={
    family_id,
    name,
    member_type:d.member_type||'adult',
    family_relationship:d.family_relationship||'outro',
    birth_date:d.birth_date||null,
    avatar_emoji:d.member_type==='child'?'👶':'👤',
  };
  const { error } = await sb.from('family_composition').insert(record);
  if(error) throw new Error(error.message);
  return {ok:true,msg:`Membro **${name}** criado${record.birth_date?` (${record.birth_date})`:''}`};
}

// ── v3: Criar conta bancária via agente ───────────────────────────────────
async function _agentCreateAccount(d) {
  const name = String(d.name || '').trim();
  if (!name) throw new Error('Nome da conta não informado.');
  const family_id = _agentGetFamilyId();
  if (!family_id) throw new Error('Família não identificada.');

  // Verifica se já existe conta com esse nome
  const existing = _agentFindByName(state.accounts || [], name);
  if (existing) return { ok: true, msg: `Conta **${existing.name}** já existe` };

  // Mapeia tipo da conta
  const typeMap = {
    checking: 'checking', corrente: 'checking', conta_corrente: 'checking',
    savings: 'savings', poupanca: 'savings', poupança: 'savings',
    credit: 'credit', credito: 'credit', crédito: 'credit', cartao: 'credit',
    investment: 'investment', investimento: 'investment',
    cash: 'cash', dinheiro: 'cash',
  };
  const rawType = String(d.type || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const accountType = typeMap[rawType] || 'checking';

  const balance = Number(d.balance || d.initial_balance || 0);
  const currency = String(d.currency || 'BRL').toUpperCase();

  const payload = {
    name,
    type: accountType,
    balance,
    currency,
    family_id,
    is_active: true,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await sb.from('accounts').insert(payload).select('id,name,type,balance').single();
  if (error) throw new Error(error.message);

  // Atualiza state local
  state.accounts = [...(state.accounts || []), data];
  if (typeof DB !== 'undefined' && DB.accounts?.bust) DB.accounts.bust();

  const fmtBal = typeof fmt === 'function' ? fmt(balance, currency) : `${currency} ${balance.toFixed(2)}`;
  return { ok: true, msg: `Conta **${name}** (${accountType}) criada com saldo ${fmtBal}` };
}

// ── v3: Criar sonho / meta financeira via agente ──────────────────────────
async function _agentCreateDream(d) {
  const name = String(d.name || d.description || '').trim();
  if (!name) throw new Error('Nome do sonho não informado.');

  const targetAmount = Math.abs(Number(d.target_amount || d.amount || 0));
  if (!targetAmount) throw new Error('Valor alvo não informado.');

  const family_id = _agentGetFamilyId();
  if (!family_id) throw new Error('Família não identificada.');

  const payload = {
    name,
    description: d.description || name,
    target_amount: targetAmount,
    current_amount: Number(d.current_amount || 0),
    target_date: d.target_date || null,
    status: 'active',
    family_id,
    updated_at: new Date().toISOString(),
  };

  const { error } = await sb.from('dreams').insert(payload);
  if (error) throw new Error(error.message);

  // Refresca lista de dreams se na página
  if (state.currentPage === 'dreams' && typeof loadDreams === 'function') {
    try { await loadDreams(); } catch(_) {}
  }

  const fmtAmt = typeof fmt === 'function' ? fmt(targetAmount, 'BRL') : `R$ ${targetAmount.toFixed(2)}`;
  const dateStr = d.target_date ? ` para ${d.target_date}` : '';
  return { ok: true, msg: `Sonho **${name}** criado — meta ${fmtAmt}${dateStr}` };
}

// ── v3: Registrar pagamento de dívida ────────────────────────────────────
async function _agentPayDebt(d) {
  const family_id = _agentGetFamilyId();
  if (!family_id) throw new Error('Família não identificada.');

  // Resolve qual dívida
  const debtName = String(d.name || d.description || d.creditor || '').trim();
  let debt = null;

  if (debtName) {
    // Busca dívidas ativas
    const { data: debts } = await sb
      .from('debts')
      .select('id,description,creditor,current_balance,original_amount,currency')
      .eq('family_id', family_id)
      .eq('status', 'active');

    // Fuzzy match no nome da dívida
    const combined = (debts || []).map(db => ({
      ...db,
      name: db.description || db.creditor || 'Dívida',
    }));
    debt = _agentFindByName(combined, debtName);
  }

  if (!debt) {
    // Se não achou, pede seleção
    const { data: debts } = await sb
      .from('debts')
      .select('id,description,creditor,current_balance,currency')
      .eq('family_id', family_id)
      .eq('status', 'active')
      .limit(5);

    if (!debts?.length) throw new Error('Nenhuma dívida ativa encontrada.');

    // Retorna lista para o usuário escolher
    const list = debts.map(db =>
      `• **${db.description || db.creditor}**: ${typeof fmt === 'function' ? fmt(db.current_balance, db.currency||'BRL') : db.current_balance}`
    ).join('\n');
    _agentAppend('assistant', `💳 Qual dívida deseja pagar?\n\n${list}\n\nDigite o nome da dívida.`);
    return { ok: false, msg: 'Seleção de dívida necessária' };
  }

  const payAmount = Math.abs(Number(d.amount || d.pay_amount || debt.current_balance || 0));
  if (!payAmount) throw new Error('Valor do pagamento não informado.');

  // Calcula novo saldo
  const newBalance = Math.max(0, debt.current_balance - payAmount);
  const newStatus = newBalance <= 0 ? 'paid' : 'active';

  const { error } = await sb
    .from('debts')
    .update({ current_balance: newBalance, status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', debt.id);

  if (error) throw new Error(error.message);

  // Refresca debts
  if (state.currentPage === 'debts' && typeof loadDebts === 'function') {
    try { await loadDebts(); } catch(_) {}
  }

  const debtLabel = debt.description || debt.creditor || 'Dívida';
  const fmtPaid = typeof fmt === 'function' ? fmt(payAmount, debt.currency || 'BRL') : payAmount.toFixed(2);
  const statusMsg = newStatus === 'paid' ? ' 🎉 **Dívida quitada!**' : ` Saldo restante: ${typeof fmt === 'function' ? fmt(newBalance, debt.currency || 'BRL') : newBalance.toFixed(2)}`;
  return { ok: true, msg: `Pagamento de ${fmtPaid} registrado em **${debtLabel}**.${statusMsg}` };
}

function _agentParseBirthDate(text){
  const raw=String(text||'');
  const abs=raw.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
  if(abs){let yy=abs[3]?Number(abs[3]):new Date().getFullYear(); if(yy<100) yy+=2000; const d=new Date(yy,Number(abs[2])-1,Number(abs[1]),12,0,0); if(!isNaN(d)) return d.toISOString().slice(0,10);}
  return null;
}
function _agentParseFamilyRelationship(text){
  const norm=_agentNormalizeLooseText(text);
  const map=['pai','mae','conjuge','irmao','irma','avo','avo_f','tio','tia','filho','filha','enteado','enteada','neto','neta','sobrinho','sobrinha'];
  return map.find(v=>norm.includes(v.replace('_f',''))) || 'outro';
}
function _agentInferFamilyMemberType(text,birthDate,relationship){
  const norm=_agentNormalizeLooseText(text);
  if(/crianca|beb[eê]|filh|entead|net|sobrinh/.test(norm)) return 'child';
  if(birthDate){ const age=Math.max(0, Math.floor((Date.now()-new Date(birthDate).getTime())/31557600000)); if(age<18) return 'child'; }
  return ['filho','filha','enteado','enteada','neto','neta','sobrinho','sobrinha'].includes(relationship)?'child':'adult';
}
function _agentFinalizeGuidedPlan(plan){
  const action=plan.actions?.[0]||{data:{}};
  plan.missing_fields=_agentComputeMissingFields(plan.intent, action.data||{});
  plan.guided=plan.missing_fields.length>0;
  return plan;
}
function _agentComputeMissingFields(intent,data){
  const missing=[];
  const isBlank=v=>v===null||v===undefined||String(v).trim()==='';
  const noAmt=d=>d.amount===null||d.amount===undefined||!Number.isFinite(Number(d.amount))||Number(d.amount)===0;
  if(intent==='create_transaction'){
    if(noAmt(data)) missing.push('amount');
    if(isBlank(data.account_name)&&!data.account_id) missing.push('account_name');
    if(isBlank(data.category_name)&&!data.category_id) missing.push('category_name');
  }
  if(intent==='create_scheduled'){
    if(noAmt(data)) missing.push('amount');
    if(isBlank(data.account_name)&&!data.account_id) missing.push('account_name');
    if(isBlank(data.category_name)&&!data.category_id) missing.push('category_name');
    if(isBlank(data.frequency)) missing.push('frequency');
    if(isBlank(data.start_date)) missing.push('start_date');
  }
  if(intent==='create_payee' && isBlank(data.name)) missing.push('name');
  if(intent==='create_category' && isBlank(data.name)) missing.push('name');
  if(intent==='create_family_member' && isBlank(data.name)) missing.push('name');
  // v3: novos intents
  if(intent==='create_account' && isBlank(data.name)) missing.push('name');
  if(intent==='create_debt'){
    if(isBlank(data.description)&&isBlank(data.creditor)) missing.push('description');
    if(noAmt({amount:data.original_amount||data.amount})) missing.push('original_amount');
  }
  if(intent==='create_dream'){
    if(isBlank(data.name)) missing.push('name');
    if(noAmt({amount:data.target_amount||data.amount})) missing.push('target_amount');
  }
  if(intent==='pay_debt'){
    if(noAmt({amount:data.amount||data.pay_amount})) missing.push('amount');
  }
  return missing;
}
function _agentFieldLabel(field){
  return ({
    amount:'Valor', account_name:'Conta', category_name:'Categoria',
    payee_name:'Beneficiário', frequency:'Recorrência', start_date:'Data inicial',
    name:'Nome', birth_date:'Data de nascimento', description:'Descrição',
    original_amount:'Valor da dívida', target_amount:'Valor alvo',
    target_date:'Data alvo', creditor:'Credor', type:'Tipo', currency:'Moeda',
  })[field]||field;
}
function _agentFormatFieldValue(field,value){
  if(value===null||value===undefined||value==='') return '<span style="color:var(--muted)">[selecionar]</span>';
  if(field==='amount'){ const n=Math.abs(Number(value)||0); return typeof fmt==='function'?fmt(n,'BRL'):`R$ ${n.toFixed(2)}`; }
  if(field==='start_date'||field==='birth_date'||field==='date') return String(value).slice(0,10);
  if(field==='frequency'){ const map={daily:'Diária',weekly:'Semanal',monthly:'Mensal',yearly:'Anual'}; return map[value]||value; }
  return String(value);
}
function _agentBuildGuidedHtml(plan){
  // v3: usa o engine GuidedUI se disponível (HTML mais rico)
  if (typeof AgentEngine !== 'undefined') {
    const data = plan.actions?.[0]?.data || {};
    return AgentEngine.GuidedUI.build(
      plan.intent,
      data,
      plan.missing_fields || [],
      {} // resolved entities (sem info de confiança neste ponto)
    );
  }
  // Fallback clássico
  const data=plan.actions?.[0]?.data||{};
  const title={create_transaction:'Criar transação',create_scheduled:'Criar transação programada',create_payee:'Criar beneficiário',create_category:'Criar categoria',create_family_member:'Criar membro da família'}[plan.intent]||'Completar ação';
  const fieldsByIntent={
    create_transaction:['type','account_name','amount','category_name','payee_name','date'],
    create_scheduled:['type','account_name','amount','category_name','payee_name','frequency','start_date'],
    create_payee:['name'],
    create_category:['name'],
    create_family_member:['name','birth_date','member_type','family_relationship'],
  };
  const rows=(fieldsByIntent[plan.intent]||[]).map(field=>{
    const value=(field==='type' && data[field]) ? (data[field]==='income'?'Receita':'Despesa') : _agentFormatFieldValue(field,data[field]);
    const missing=(plan.missing_fields||[]).includes(field);
    return `<div style="display:flex;justify-content:space-between;gap:12px;padding:4px 0;border-bottom:1px dashed rgba(255,255,255,.08)"><span>${_agentFieldLabel(field)}</span><span style="text-align:right;${missing?'color:#fde68a;font-weight:700;':''}">${value}</span></div>`;
  }).join('');
  const chipRows=(plan.missing_fields||[]).map(field=>_agentBuildFieldChips(field, data[field], plan)).filter(Boolean).join('');
  return `<div style="display:flex;flex-direction:column;gap:10px"><div><strong>${title}</strong></div><div style="display:flex;flex-direction:column;gap:2px">${rows}</div>${chipRows?`<div style="display:flex;flex-direction:column;gap:8px">${chipRows}</div>`:''}<div style="font-size:.78rem;color:var(--muted)">Complete os campos destacados ou digite naturalmente para continuar.</div></div>`;
}
function _agentBuildFieldChips(field,currentValue,plan){
  const options=_agentSuggestFieldOptions(field,'',plan).slice(0,6);
  if(!options.length) return '';
  const buttons=options.map(opt=>`<button class="agent-chip" onclick="agentChooseSlot('${field}', '${String(opt.value).replace(/'/g,"&#39;")}', true)">${opt.label}</button>`).join(' ');
  return `<div><div style="font-size:.78rem;color:var(--muted);margin-bottom:4px">${_agentFieldLabel(field)}</div><div style="display:flex;flex-wrap:wrap;gap:6px">${buttons}</div></div>`;
}
function _agentSuggestFieldOptions(field, query='', plan=null){
  const q=_agentNormalizeName(query);
  // Filtra categorias por tipo (receita/despesa)
  const txType = plan?.actions?.[0]?.data?.type || 'expense';
  const cats = (state.categories||[])
    .filter(c => !c.type || c.type === txType || c.type === 'both')
    .map(c=>({value:c.name,label:c.name}));

  const map={
    account_name:  (state.accounts||[]).map(a=>({value:a.name,label:a.name})),
    category_name: cats,
    payee_name:    (state.payees||[]).map(p=>({value:p.name,label:p.name})),
    frequency:     [{value:'monthly',label:'Mensal'},{value:'weekly',label:'Semanal'},{value:'daily',label:'Diária'},{value:'yearly',label:'Anual'}],
    start_date:    [{value:new Date().toISOString().slice(0,10),label:'Hoje'},{value:_agentDateOffset(1),label:'Amanhã'}],
    date:          [{value:new Date().toISOString().slice(0,10),label:'Hoje'},{value:_agentDateOffset(-1),label:'Ontem'}],
    // v3: novos campos
    type:          [{value:'expense',label:'Despesa'},{value:'income',label:'Receita'}],
    currency:      [{value:'BRL',label:'BRL (R$)'},{value:'USD',label:'USD ($)'},{value:'EUR',label:'EUR (€)'}],
    // account type chips (para create_account)
    account_type:  [
      {value:'checking',label:'Conta corrente'},
      {value:'savings',label:'Poupança'},
      {value:'credit',label:'Cartão de crédito'},
      {value:'investment',label:'Investimento'},
      {value:'cash',label:'Dinheiro'},
    ],
    birth_date:[],
    amount:[],
    original_amount:[],
    target_amount:[],
  };
  let opts=map[field]||[];
  if(q) opts=opts.filter(o=>_agentNormalizeName(o.label).includes(q)||_agentNormalizeName(o.value).includes(q));
  return opts;
}
function _agentDateOffset(days){ const d=new Date(); d.setDate(d.getDate()+days); return d.toISOString().slice(0,10); }
function _agentIsSlotPayload(text){ return /^__agent_slot__:/i.test(String(text||'')); }
function _agentApplySlotPayload(plan, payload){
  const m=String(payload||'').match(/^__agent_slot__:(.+?):(.+)$/i); if(!m) return plan;
  const field=m[1], value=m[2];
  const cloned=JSON.parse(JSON.stringify(plan));
  const data=cloned.actions?.[0]?.data||{};
  // v3: trata campos numéricos corretamente
  const numericFields=['amount','original_amount','target_amount','balance','pay_amount'];
  data[field] = numericFields.includes(field)
    ? Number(String(value).replace(',','.'))
    : value;
  cloned.actions[0].data=data;
  return _agentFinalizeGuidedPlan(cloned);
}
function _agentMergeIntoPendingPlan(plan,text){
  const cloned=JSON.parse(JSON.stringify(plan));
  const data=cloned.actions?.[0]?.data||{};
  const raw=String(text||'').trim();
  const missing=cloned.missing_fields||[];
  const firstMissing=missing[0];

  // Transação e programado
  if(cloned.intent==='create_transaction' || cloned.intent==='create_scheduled'){
    const amt=_agentParseAmount(raw);
    if(missing.includes('amount') && amt!==null)
      data.amount=(data.type==='income'?Math.abs(amt):-Math.abs(amt));
    const entities=_agentExtractTransactionEntities(raw,{kind:cloned.intent==='create_scheduled'?'scheduled':'transaction',isIncome:data.type==='income'});
    if(missing.includes('account_name') && entities.account_name) data.account_name=entities.account_name;
    if(missing.includes('category_name') && entities.category_name) data.category_name=entities.category_name;
    if(missing.includes('payee_name') && entities.payee_name) data.payee_name=entities.payee_name;
    if(cloned.intent==='create_scheduled'){
      const freq=_agentParseFrequency(raw);
      if(missing.includes('frequency') && freq) data.frequency=freq;
      if(missing.includes('start_date')) data.start_date=_agentParseDate(raw);
    } else if(missing.includes('date') && raw) data.date=_agentParseDate(raw);
  }

  // Simples: nome é o texto digitado
  if(cloned.intent==='create_payee' && missing.includes('name')) data.name=raw;
  if(cloned.intent==='create_category' && missing.includes('name')) data.name=raw;

  // Membro da família
  if(cloned.intent==='create_family_member'){
    if(missing.includes('name') && !_agentParseBirthDate(raw)) data.name=raw;
    if(missing.includes('birth_date')) data.birth_date=_agentParseBirthDate(raw)||data.birth_date;
  }

  // v3: Conta
  if(cloned.intent==='create_account'){
    if(missing.includes('name')) data.name=raw;
    if(missing.includes('type')) data.type=_agentParseAccountType(raw.toLowerCase());
    const amt=_agentParseAmount(raw);
    if(missing.includes('balance') && amt!==null) data.balance=amt;
  }

  // v3: Sonho / meta
  if(cloned.intent==='create_dream'){
    const amt=_agentParseAmount(raw);
    if(missing.includes('name') && amt===null) data.name=raw;
    if(missing.includes('target_amount') && amt!==null) data.target_amount=Math.abs(amt);
    if(missing.includes('target_date')) data.target_date=_agentParseTargetDate(raw)||_agentParseDate(raw);
  }

  // v3: Pagamento de dívida
  if(cloned.intent==='pay_debt'){
    const amt=_agentParseAmount(raw);
    if(missing.includes('amount') && amt!==null) data.amount=Math.abs(amt);
    if(missing.includes('name') && amt===null) data.name=raw;
  }

  // v3: Dívida
  if(cloned.intent==='create_debt'){
    const amt=_agentParseAmount(raw);
    if(missing.includes('description') && amt===null) data.description=raw;
    if(missing.includes('original_amount') && amt!==null) data.original_amount=Math.abs(amt);
  }

  // Fallback genérico: texto livre preenche o primeiro campo faltante de texto
  if(firstMissing && !data[firstMissing]){
    const textFields=['account_name','category_name','payee_name','name','description','creditor'];
    if(textFields.includes(firstMissing)) data[firstMissing]=raw;
  }

  cloned.actions[0].data=data;
  return _agentFinalizeGuidedPlan(cloned);
}
function _agentAppendStructured(role, html, fallbackText=''){ _agent.history.push({role,text:fallbackText||'[structured]'}); _agentRenderMessage(role,{html,fallbackText}); }
function _agentEnsureInlineUi(){
  if(_agent.inlineReady) return;
  const input=document.getElementById('agentInput'); if(!input) return;
  // v3: o agentInlineHints já existe no HTML, não precisamos criar dinamicamente
  input.addEventListener('input', e=>_agentRenderInlineSuggestions(e.target.value));
  _agent.inlineReady=true;
}
function _agentRenderInlineSuggestions(text){
  const box=document.getElementById('agentInlineHints'); if(!box) return;
  const plan=_agent.pendingPlan||_agent.session.draftPlan;
  let field=''; let query=String(text||'').trim();

  if(plan?.missing_fields?.length){
    field=plan.missing_fields[0];
    if(_agentIsSlotPayload(query)) query='';
  } else {
    const norm=_agentNormalizeName(query);
    // v3: padrões mais ricos para autocomplete contextual
    if(/conta\s*$/.test(norm))                              field='account_name';
    else if(/categoria\s*$/.test(norm))                     field='category_name';
    else if(/(beneficiar|favorecid|para\s+o|para\s+a)\s*$/.test(norm)) field='payee_name';
    else if(/(recorrencia|frequencia|todo[s]?\s+os)\s*$/.test(norm))   field='frequency';
    else if(/(moeda|em\s+)\s*$/.test(norm))                 field='currency';
    // Sugestões de ação rápida ao iniciar uma frase de ação
    else if(!query && plan===null) {
      // Mostra quick replies quando campo vazio
      const page = window.state?.currentPage || 'dashboard';
      if(typeof AgentEngine !== 'undefined') {
        const replies = AgentEngine.QuickReplies.getForPage(page);
        box.innerHTML=replies.map(r=>`<button class="agent-quick-chip" onclick="agentSuggest('${r.text.replace(/'/g,"&#39;")}')">${r.label}</button>`).join('');
        box.style.display='flex';
      } else { box.style.display='none'; box.innerHTML=''; }
      return;
    }
  }

  if(!field){ box.style.display='none'; box.innerHTML=''; return; }
  const opts=_agentSuggestFieldOptions(field, query, plan).slice(0,6);
  if(!opts.length){ box.style.display='none'; box.innerHTML=''; return; }
  box.innerHTML=opts.map(opt=>`<button class="agent-chip" onclick="agentChooseSlot('${field}', '${String(opt.value).replace(/'/g,"&#39;")}', false)">${opt.label}</button>`).join('');
  box.style.display='flex';
}

function _agentResolveAccountObj(id,name){const a=state.accounts||[];if(id)return a.find(x=>x.id===id)||null;if(!name)return a[0]||null;return _agentFindByName(a,name);}
function _agentResolveCategory(name){return name?_agentFindByName(state.categories||[],name)?.id||null:null;}
function _agentResolvePayee(name){return name?_agentFindByName(state.payees||[],name)?.id||null:null;}
function _agentNormalizeName(value){return String(value||'').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();}
function _agentLevenshtein(a,b){a=_agentNormalizeName(a);b=_agentNormalizeName(b);const m=a.length,n=b.length;if(!m)return n;if(!n)return m;const dp=Array.from({length:m+1},()=>Array(n+1).fill(0));for(let i=0;i<=m;i++)dp[i][0]=i;for(let j=0;j<=n;j++)dp[0][j]=j;for(let i=1;i<=m;i++){for(let j=1;j<=n;j++){const cost=a[i-1]===b[j-1]?0:1;dp[i][j]=Math.min(dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+cost);}}return dp[m][n];}
function _agentFindByName(list,name){
  // v3: usa o EntityResolver do engine se disponível (melhor fuzzy matching)
  if (typeof AgentEngine !== 'undefined') {
    const result = AgentEngine.EntityResolver.resolve(list, name, '');
    if (result.match && result.confidence >= 0.62) return result.match;
    return null;
  }
  // Fallback clássico
  const n=_agentNormalizeName(name);
  if(!n) return null;
  let best=null,bestScore=-1;
  for(const item of (list||[])){
    const cand=String(item?.name||'').trim();
    const cn=_agentNormalizeName(cand);
    if(!cn) continue;
    let score=0;
    if(cn===n) score=1;
    else if(cn.startsWith(n)||n.startsWith(cn)) score=0.95;
    else if(cn.includes(n)||n.includes(cn)) score=0.9;
    else { const dist=_agentLevenshtein(cn,n); const maxLen=Math.max(cn.length,n.length)||1; score=1-(dist/maxLen); }
    if(score>bestScore){best=item;bestScore=score;}
  }
  return bestScore>=0.62?best:null;
}

async function _agentGetKey(){if(_agent.apiKey)return _agent.apiKey;try{const k=await getAppSetting('gemini_api_key','');_agent.apiKey=k||null;return _agent.apiKey;}catch(_){return null;}}
function _agentGetUser(){try{if(typeof currentUser!=='undefined'&&currentUser)return currentUser;}catch(_){}return window.currentUser||state?.user||null;}
function _agentGetFamilyId(){const u=_agentGetUser();try{if(typeof famId==='function')return famId()||u?.family_id||state?.familyId||null;}catch(_){}return u?.family_id||state?.familyId||null;}
async function _agentEnsureContextLoaded(){
  const client=window.sb||window.ensureSupabaseClient?.()||null;
  if(!client) throw new Error('Cliente Supabase não inicializado.');
  let session=null;
  try{session=(await client.auth?.getSession?.())?.data?.session||null;}catch(e){console.warn('[agent]session',e?.message||e);}
  if(!session && !_agentGetUser()) throw new Error('Sessão expirada ou usuário não autenticado.');
  if(!_agentGetFamilyId()) throw new Error('Família não identificada na sessão atual.');
  try{
    if((!state.accounts||!state.accounts.length)&&typeof DB!=='undefined'&&DB.accounts?.load) await DB.accounts.load();
    if((!state.categories||!state.categories.length)&&typeof loadCategories==='function') await loadCategories();
    if((!state.payees||!state.payees.length)&&typeof loadPayees==='function'){try{await loadPayees(true);}catch(_){await loadPayees();}}
    if((!state.scheduled||!state.scheduled.length)&&typeof loadScheduled==='function') await loadScheduled();
  }catch(e){console.warn('[agent]preload:',e?.message||e);}
}
function _agentBuildContext(){return{today:new Date().toISOString().slice(0,10),accounts:(state.accounts||[]).slice(0,30).map(a=>({id:a.id,name:a.name,type:a.type,currency:a.currency||'BRL'})),categories:(state.categories||[]).slice(0,50).map(c=>({id:c.id,name:c.name,type:c.type})),payees:(state.payees||[]).slice(0,50).map(p=>({id:p.id,name:p.name})),};}

function _agentIsConfirmation(msg){return /^(ok|pode|confirmo|confirmar|sim|manda ver|prosseguir)$/i.test(String(msg).trim());}
function _agentParseAmount(text){const m=String(text||'').match(/(?:r\$\s*)?(-?\d{1,3}(?:[.\s]\d{3})*(?:,\d{1,2})|-?\d+(?:,\d{1,2})?|-?\d+(?:\.\d{1,2})?)/i);if(!m)return null;let v=m[1].replace(/\s/g,'');if(v.includes(',')&&v.includes('.'))v=v.replace(/\./g,'').replace(',','.');else if(v.includes(','))v=v.replace(',','.');const n=parseFloat(v);return Number.isFinite(n)?n:null;}
function _agentParseDate(text){const msg=String(text||'').toLowerCase();const dt=new Date();if(/amanh[ãa]/.test(msg))dt.setDate(dt.getDate()+1);else if(/ontem/.test(msg))dt.setDate(dt.getDate()-1);const abs=String(text||'').match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);if(abs){let yy=abs[3]?Number(abs[3]):dt.getFullYear();if(yy<100)yy+=2000;const p=new Date(yy,Number(abs[2])-1,Number(abs[1]),12,0,0);if(!isNaN(p))return p.toISOString().slice(0,10);}return dt.toISOString().slice(0,10);}
function _agentParseFrequency(msg){if(/seman/.test(msg))return'weekly';if(/anual|ano/.test(msg))return'yearly';if(/di[aá]ri/.test(msg))return'daily';if(/mensa|m[eê]s/.test(msg))return'monthly';return null;}
function _agentParseInstallments(msg){const m=String(msg||'').match(/(\d+)\s*parcelas?/i);if(!m)return null;const n=Number(m[1]);return Number.isFinite(n)?n:null;}
function _agentParseColor(msg){const map={azul:'#2563eb',verde:'#16a34a',vermelho:'#dc2626',laranja:'#f97316',roxo:'#7c3aed',amarelo:'#f59e0b',rosa:'#ec4899',cinza:'#6b7280'};return map[Object.keys(map).find(c=>msg.includes(c))||'']||'#2a6049';}

// v3: Detecta tipo de conta a partir do texto
function _agentParseAccountType(msg) {
  if (/(poupan[cç]|savings)/.test(msg)) return 'savings';
  if (/(cart[aã]o|credit|cr[eé]dito)/.test(msg)) return 'credit';
  if (/(investiment|ações|renda)/.test(msg)) return 'investment';
  if (/(dinheiro|carteira|espécie|especie|cash)/.test(msg)) return 'cash';
  return 'checking'; // corrente é o default
}

// v3: Extrai data alvo de expressões como "em 2 anos", "para dezembro de 2026"
function _agentParseTargetDate(text) {
  const now = new Date();
  const msg = String(text || '').toLowerCase();
  // "em X anos"
  const yearsMatch = msg.match(/em\s+(\d+)\s+anos?/);
  if (yearsMatch) {
    const d = new Date(now);
    d.setFullYear(d.getFullYear() + Number(yearsMatch[1]));
    return d.toISOString().slice(0, 10);
  }
  // "em X meses"
  const monthsMatch = msg.match(/em\s+(\d+)\s+m[eê]ses?/);
  if (monthsMatch) {
    const d = new Date(now);
    d.setMonth(d.getMonth() + Number(monthsMatch[1]));
    return d.toISOString().slice(0, 10);
  }
  // Data explícita DD/MM/YYYY
  const abs = text.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
  if (abs) {
    let yy = abs[3] ? Number(abs[3]) : now.getFullYear() + 1;
    if (yy < 100) yy += 2000;
    const d = new Date(yy, Number(abs[2])-1, Number(abs[1]), 12, 0, 0);
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
  }
  return null;
}
function _agentExtractAfter(text,regexes){for(const rx of regexes){const m=String(text||'').match(rx);if(m?.[1])return _agentCleanEntityText(m[1]);}return'';}
function _agentNormalizeLooseText(text){return String(text||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();}
function _agentCleanEntityText(text){return String(text||'').replace(/[“”"']/g,' ').replace(/\s+/g,' ').replace(/^[,.;:\-\s]+|[,.;:\-\s]+$/g,'').trim();}
function _agentEscapeRegex(text){return String(text||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
function _agentTrimConnectorTail(text){return _agentCleanEntityText(String(text||'').replace(/\s+(?:para|pro|pra|no|na|em|de|categoria)\b.*$/i,' '));}
function _agentRemoveFirst(text,pattern){return String(text||'').replace(pattern,' ');}
function _agentBuildEntitySearchSpace(text){
  let work=' '+String(text||'')+' ';
  work=_agentRemoveFirst(work,/[“"][^”"]+[”"]/g);
  work=_agentRemoveFirst(work,/(?:r\$\s*)?-?\d{1,3}(?:[.\s]\d{3})*(?:,\d{1,2})|(?:r\$\s*)?-?\d+(?:[.,]\d{1,2})?/i);
  work=_agentRemoveFirst(work,/\b(reais?|real|d[oó]lares?|euros?)\b/gi);
  work=_agentRemoveFirst(work,/\b(crie|criar|adicione|adicionar|registre|registrar|lance|lan[cç]ar|uma|um|novo|nova|despesa|receita|transa[cç][aã]o|programad[ao]s?|mensal|semanal|anual|di[aá]rio)\b/gi);
  return work.replace(/\s+/g,' ').trim();
}
function _agentFindKnownEntityName(list,text){
  const hay=_agentNormalizeLooseText(text);
  if(!hay.trim()) return '';
  let best=''; let bestScore=0;
  const chunks=[hay, ...hay.split(/\s+/).filter(Boolean)];
  for(const item of (list||[])){
    const name=String(item?.name||'').trim();
    const needle=_agentNormalizeLooseText(name);
    if(!needle||needle.length<2) continue;
    for(const chunk of chunks){
      let score=0;
      if(chunk===needle) score=1;
      else if(chunk.includes(needle)||needle.includes(chunk)) score=0.92;
      else {
        const dist=_agentLevenshtein(chunk, needle);
        const maxLen=Math.max(chunk.length, needle.length)||1;
        score=1-(dist/maxLen);
      }
      if(score>bestScore){ bestScore=score; best=name; }
    }
  }
  return bestScore>=0.62 ? best : '';
}
function _agentExtractTransactionEntities(text,opts={}){
  const original=String(text||'').trim();
  const info={account_name:'',category_name:'',payee_name:'',description:''};
  let work=_agentBuildEntitySearchSpace(original);
  const quoted=original.match(/[“\"](.+?)[”\"]/);
  if(quoted?.[1]) info.description=_agentCleanEntityText(quoted[1]);

  const accountPatterns=[/(?:na|da)\s+conta\s+(.+?)(?=\s+(?:de|em|para|pro|pra|no|na|categoria)\b|[,.;]|$)/i,/\bconta\s+(.+?)(?=\s+(?:de|em|para|pro|pra|no|na|categoria)\b|[,.;]|$)/i];
  for(const rx of accountPatterns){const m=original.match(rx);if(m?.[1]){info.account_name=_agentCleanEntityText(m[1]);break;}}
  if(!info.account_name) info.account_name=_agentFindKnownEntityName(state.accounts||[],work);
  if(info.account_name){
    const accRx=new RegExp('\\b(?:na|da)?\\s*conta\\s+'+_agentEscapeRegex(info.account_name)+'\\b','i');
    work=_agentRemoveFirst(work,accRx).replace(/\s+/g,' ').trim();
  }

  const explicitCat=[/\b(?:na\s+categoria|categoria)\s+(.+?)(?=\s+(?:para|pro|pra|no|na)\b|[,.;]|$)/i];
  for(const rx of explicitCat){const m=original.match(rx);if(m?.[1]){info.category_name=_agentCleanEntityText(m[1]);break;}}
  if(!info.category_name){
    const afterAccount=original.match(/\b(?:na|da)\s+conta\s+.+?\s+(?:de|em)\s+(.+?)(?=\s+(?:para|pro|pra|no|na)\b|[,.;]|$)/i);
    if(afterAccount?.[1]) info.category_name=_agentCleanEntityText(afterAccount[1]);
  }
  if(!info.category_name){
    const knownCategory=_agentFindKnownEntityName(state.categories||[],work);
    if(knownCategory) info.category_name=knownCategory;
  }
  if(info.category_name){
    const catRx=new RegExp('\\b(?:na\\s+categoria|categoria|de|em)?\\s*'+_agentEscapeRegex(info.category_name)+'\\b','i');
    work=_agentRemoveFirst(work,catRx).replace(/\s+/g,' ').trim();
  }

  const payeePatterns=[/\b(?:para|pro|pra)\s+(.+?)(?=[,.;]|$)/i,/\b(?:no|na)\s+(.+?)(?=[,.;]|$)/i,/\bem\s+(.+?)(?=[,.;]|$)/i];
  for(const rx of payeePatterns){
    const m=original.match(rx);
    if(!m?.[1]) continue;
    const candidate=_agentTrimConnectorTail(m[1]);
    if(!candidate) continue;
    const candidateNorm=_agentNormalizeLooseText(candidate);
    const catNorm=_agentNormalizeLooseText(info.category_name);
    const accNorm=_agentNormalizeLooseText(info.account_name);
    if(!candidateNorm||/^conta/.test(candidateNorm)||/^categoria/.test(candidateNorm)) continue;
    if(candidateNorm && candidateNorm!==catNorm && candidateNorm!==accNorm && !candidateNorm.includes(accNorm||'__never__')){info.payee_name=candidate;break;}
  }
  if(!info.payee_name){
    const knownPayee=_agentFindKnownEntityName(state.payees||[],work);
    if(knownPayee && _agentNormalizeLooseText(knownPayee)!==_agentNormalizeLooseText(info.category_name)) info.payee_name=knownPayee;
  }

  if(!info.description){
    if(info.payee_name) info.description=info.payee_name;
    else if(info.category_name) info.description=`${opts.isIncome?'Receita':'Despesa'} em ${info.category_name}`;
    else info.description='Lançamento via Agent';
  }
  info.account_name=_agentCleanEntityText(info.account_name);
  info.category_name=_agentCleanEntityText(info.category_name);
  info.payee_name=_agentCleanEntityText(info.payee_name);
  info.description=_agentCleanEntityText(info.description)||'Lançamento via Agent';
  return info;
}
function _agentExtractPayee(text){return _agentExtractTransactionEntities(text,{}).payee_name||'';}
function _agentParseDescription(text,opts={}){const parts=_agentExtractTransactionEntities(text,opts);return parts.description||'Lançamento via Agent';}
async function _agentRefreshAfterPlan(plan){
  try{
    if(plan.intent==='create_transaction'){
      if(typeof DB!=='undefined'&&DB.accounts?.bust)DB.accounts.bust();
      if(typeof loadTransactions==='function')await loadTransactions();
      if(typeof loadDashboard==='function')await loadDashboard();
    }
    if(plan.intent==='create_scheduled'&&typeof loadScheduled==='function')await loadScheduled();
    if(plan.intent==='create_payee'&&typeof loadPayees==='function')await loadPayees(true);
    if(plan.intent==='create_category'&&typeof loadCategories==='function')await loadCategories();
    if(plan.intent==='create_debt'&&typeof loadDebts==='function')await loadDebts();
    if(plan.intent==='pay_debt'&&typeof loadDebts==='function')await loadDebts();
    if(plan.intent==='create_account'){
      if(typeof DB!=='undefined'&&DB.accounts?.bust)DB.accounts.bust();
      if(typeof loadAccounts==='function')await loadAccounts();
      if(typeof loadDashboard==='function')await loadDashboard();
    }
    if(plan.intent==='create_dream'&&typeof loadDreams==='function')await loadDreams();
    if(plan.intent==='create_family_member'&&typeof loadFamilyComposition==='function'){
      await loadFamilyComposition(true);
      if(typeof refreshAllFamilyMemberSelects==='function') refreshAllFamilyMemberSelects();
    }
  }catch(e){console.warn('[agent refresh]',e?.message||e);}
}

function _agentAnswerBalance(){_agentAppend('assistant',_agentFinanceBalances());}

function _agentAppend(role,text){_agent.history.push({role,text});_agentRenderMessage(role,text);}
function _agentRenderMessage(role,text){
  const feed=document.getElementById('agentFeed');
  if(!feed)return;
  const msg=document.createElement('div');
  msg.className=`agent-msg agent-msg--${role}`;
  const avatarSvg=`<div class="agent-avatar"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#86efac" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><circle cx="12" cy="16" r="1" fill="#86efac" stroke="none"/></svg></div>`;
  const safeHtml=(text&&typeof text==='object'&&text.html)?text.html:_agentMarkdown(text);
  msg.innerHTML=`<div class="agent-bubble">${role!=='user'?avatarSvg:''}<div class="agent-text">${safeHtml}</div></div>`;
  feed.appendChild(msg);
  feed.scrollTop=feed.scrollHeight;
}
function _agentMarkdown(text){return String(text||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>').replace(/`(.+?)`/g,'<code>$1</code>').replace(/\n/g,'<br>');}

function _agentSetLoading(on){
  _agent.loading=on;
  const btn=document.getElementById('agentSendBtn'),ind=document.getElementById('agentLoading');
  if(btn)btn.disabled=on;if(ind)ind.style.display=on?'':'none';
  document.querySelectorAll('.agent-loading').forEach(el=>el.remove());
  if(!on)return;
  const feed=document.getElementById('agentFeed');if(!feed)return;
  const el=document.createElement('div');
  el.className='agent-msg agent-msg--assistant agent-loading';
  el.innerHTML='<div class="agent-bubble"><span class="agent-avatar">🤖</span><div class="agent-typing"><span></span><span></span><span></span></div></div>';
  feed.appendChild(el);feed.scrollTop=feed.scrollHeight;
}
