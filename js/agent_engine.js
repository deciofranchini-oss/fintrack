/* ═══════════════════════════════════════════════════════════════════════════
   AGENT_ENGINE.JS — FinTrack Copiloto Financeiro v3
   Motor profissional do agente: Entity Resolver, Confidence System,
   Intent Schemas, Session Memory, Autocomplete contextual.

   Carregado ANTES de agent.js.
   Expõe: AgentEngine (singleton) acessível por agent.js.
═══════════════════════════════════════════════════════════════════════════ */
'use strict';

/* ────────────────────────────────────────────────────────────────────────────
   LOGGER ESTRUTURADO
   Centraliza todos os logs do agente com níveis e timestamps.
   Controlado por AgentEngine.debug (ligado em dev, desligado em prod).
──────────────────────────────────────────────────────────────────────────── */
const AgentLogger = {
  debug: false, // ligado via AgentEngine.setDebug(true)
  _log(level, ...args) {
    if (!this.debug && level === 'debug') return;
    const tag = `[agent:${level}] ${new Date().toISOString().slice(11,23)}`;
    console[level === 'debug' ? 'log' : level]?.(tag, ...args);
  },
  debug(...a)  { this._log('debug', ...a); },
  info(...a)   { this._log('info',  ...a); },
  warn(...a)   { this._log('warn',  ...a); },
  error(...a)  { this._log('error', ...a); },
};

/* ────────────────────────────────────────────────────────────────────────────
   INTENT SCHEMAS
   Define os campos necessários para cada intenção, com tipos e obrigatoriedade.
   Usado pela guided UI e pelo sistema de missing fields.
──────────────────────────────────────────────────────────────────────────── */
const AGENT_INTENT_SCHEMAS = {
  create_transaction: {
    label: 'Criar transação',
    icon: '💸',
    fields: [
      { key: 'account_name', label: 'Conta',        type: 'selector', required: true,  entityList: 'accounts' },
      { key: 'amount',       label: 'Valor',         type: 'numeric',  required: true  },
      { key: 'category_name',label: 'Categoria',     type: 'selector', required: true,  entityList: 'categories' },
      { key: 'payee_name',   label: 'Beneficiário',  type: 'selector', required: false, entityList: 'payees' },
      { key: 'date',         label: 'Data',           type: 'date',     required: false },
      { key: 'description',  label: 'Descrição',      type: 'text',     required: false },
    ],
  },
  create_scheduled: {
    label: 'Criar programado',
    icon: '📅',
    fields: [
      { key: 'account_name',  label: 'Conta',        type: 'selector', required: true,  entityList: 'accounts' },
      { key: 'amount',        label: 'Valor',         type: 'numeric',  required: true  },
      { key: 'category_name', label: 'Categoria',     type: 'selector', required: true,  entityList: 'categories' },
      { key: 'frequency',     label: 'Recorrência',   type: 'choice',   required: true,
        choices: [
          { value: 'monthly', label: 'Mensal'   },
          { value: 'weekly',  label: 'Semanal'  },
          { value: 'daily',   label: 'Diária'   },
          { value: 'yearly',  label: 'Anual'    },
        ]
      },
      { key: 'start_date',    label: 'Data inicial',  type: 'date',     required: false },
      { key: 'payee_name',    label: 'Beneficiário',  type: 'selector', required: false, entityList: 'payees' },
    ],
  },
  create_payee: {
    label: 'Criar beneficiário',
    icon: '👤',
    fields: [
      { key: 'name', label: 'Nome', type: 'text', required: true },
    ],
  },
  create_category: {
    label: 'Criar categoria',
    icon: '🏷️',
    fields: [
      { key: 'name',  label: 'Nome',  type: 'text',   required: true  },
      { key: 'type',  label: 'Tipo',  type: 'choice', required: false,
        choices: [{ value: 'expense', label: 'Despesa' }, { value: 'income', label: 'Receita' }]
      },
      { key: 'color', label: 'Cor',   type: 'text',   required: false },
    ],
  },
  create_family_member: {
    label: 'Criar membro da família',
    icon: '👨‍👩‍👧',
    fields: [
      { key: 'name',                label: 'Nome',              type: 'text', required: true  },
      { key: 'birth_date',          label: 'Data de nascimento', type: 'date', required: false },
      { key: 'family_relationship', label: 'Parentesco',         type: 'text', required: false },
    ],
  },
  create_account: {
    label: 'Criar conta',
    icon: '🏦',
    fields: [
      { key: 'name',     label: 'Nome da conta', type: 'text',   required: true  },
      { key: 'type',     label: 'Tipo',           type: 'choice', required: true,
        choices: [
          { value: 'checking',   label: 'Conta corrente' },
          { value: 'savings',    label: 'Poupança'        },
          { value: 'credit',     label: 'Cartão de crédito' },
          { value: 'investment', label: 'Investimento'    },
          { value: 'cash',       label: 'Dinheiro'        },
        ]
      },
      { key: 'currency', label: 'Moeda',          type: 'choice', required: false,
        choices: [{ value: 'BRL', label: 'BRL (R$)' }, { value: 'USD', label: 'USD ($)' }, { value: 'EUR', label: 'EUR (€)' }]
      },
      { key: 'balance',  label: 'Saldo inicial',  type: 'numeric', required: false },
    ],
  },
  create_debt: {
    label: 'Registrar dívida',
    icon: '📋',
    fields: [
      { key: 'description',    label: 'Descrição',   type: 'text',    required: true  },
      { key: 'original_amount',label: 'Valor',        type: 'numeric', required: true  },
      { key: 'creditor',       label: 'Credor',       type: 'text',    required: false },
      { key: 'start_date',     label: 'Data',         type: 'date',    required: false },
    ],
  },
  create_dream: {
    label: 'Criar sonho / meta',
    icon: '⭐',
    fields: [
      { key: 'name',          label: 'Nome do sonho', type: 'text',    required: true  },
      { key: 'target_amount', label: 'Valor alvo',     type: 'numeric', required: true  },
      { key: 'target_date',   label: 'Data alvo',      type: 'date',    required: false },
      { key: 'description',   label: 'Descrição',      type: 'text',    required: false },
    ],
  },
};

/* ────────────────────────────────────────────────────────────────────────────
   ENTITY RESOLVER — núcleo do sistema de resolução de entidades
   Implementa: normalização, fuzzy matching com score, aliases, priorização.
──────────────────────────────────────────────────────────────────────────── */
const AgentEntityResolver = {

  // Cache de aliases aprendidos por sessão { entityType: { normalizedAlias: entityId } }
  _aliases: {},

  // Normaliza texto removendo acentos, caixa, pontuação excessiva
  normalize(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  },

  // Distância de Levenshtein entre dois strings normalizados
  levenshtein(a, b) {
    a = this.normalize(a); b = this.normalize(b);
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i-1] === b[j-1] ? 0 : 1;
        dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost);
      }
    }
    return dp[m][n];
  },

  // Score de similaridade 0..1 entre dois termos
  similarity(a, b) {
    const na = this.normalize(a), nb = this.normalize(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    if (na.startsWith(nb) || nb.startsWith(na)) return 0.96;
    if (na.includes(nb) || nb.includes(na)) return 0.90;
    const dist = this.levenshtein(na, nb);
    const maxLen = Math.max(na.length, nb.length) || 1;
    return Math.max(0, 1 - dist / maxLen);
  },

  /**
   * Resolve uma entidade (conta, categoria, beneficiário) a partir de um nome textual.
   * Retorna objeto estruturado com score e alternativas.
   *
   * @param {Array}  list         - lista de objetos { id, name, ... }
   * @param {string} query        - texto digitado pelo usuário
   * @param {string} entityType   - 'account' | 'category' | 'payee'
   * @returns {{ match, confidence, alternatives, requires_user_confirmation }}
   */
  resolve(list, query, entityType = '') {
    if (!query || !query.trim()) {
      return { match: null, confidence: 0, alternatives: [], requires_user_confirmation: false };
    }

    const nq = this.normalize(query);

    // Checar aliases aprendidos
    const aliasMap = this._aliases[entityType] || {};
    const aliasedId = aliasMap[nq];
    if (aliasedId) {
      const aliasMatch = (list || []).find(x => x.id === aliasedId);
      if (aliasMatch) {
        AgentLogger.debug(`[resolver] alias match: "${query}" → "${aliasMatch.name}" (${entityType})`);
        return { match: aliasMatch, confidence: 1, alternatives: [], requires_user_confirmation: false };
      }
    }

    // Calcular scores para todos os itens da lista
    const scored = (list || [])
      .filter(item => item && item.name)
      .map(item => {
        const nameNorm = this.normalize(item.name);
        // Testar também palavras individuais da query contra palavras do nome
        const queryWords = nq.split(' ').filter(Boolean);
        const nameWords  = nameNorm.split(' ').filter(Boolean);
        let wordScore = 0;
        for (const qw of queryWords) {
          for (const nw of nameWords) {
            wordScore = Math.max(wordScore, this.similarity(qw, nw));
          }
        }
        const fullScore = this.similarity(nq, nameNorm);
        const score = Math.max(fullScore, wordScore * 0.9);
        return { item, score };
      })
      .filter(x => x.score > 0.35)
      .sort((a, b) => b.score - a.score);

    if (!scored.length) {
      return { match: null, confidence: 0, alternatives: [], requires_user_confirmation: false };
    }

    const best = scored[0];
    const alternatives = scored.slice(1, 4).map(x => x.item);

    // Sistema de confiança
    const confidence = best.score;
    const requires_user_confirmation = confidence < 0.85 && confidence >= 0.6;

    AgentLogger.debug(`[resolver] "${query}" → "${best.item.name}" (conf=${confidence.toFixed(2)}, type=${entityType})`);

    return {
      match: confidence >= 0.6 ? best.item : null,
      confidence,
      alternatives,
      requires_user_confirmation,
    };
  },

  // Aprende um alias: "nub" → conta Nubank (entityType, normalizedAlias, entityId)
  learnAlias(entityType, alias, entityId) {
    if (!this._aliases[entityType]) this._aliases[entityType] = {};
    this._aliases[entityType][this.normalize(alias)] = entityId;
    AgentLogger.debug(`[resolver] learned alias: "${alias}" → ${entityId} (${entityType})`);
  },
};

/* ────────────────────────────────────────────────────────────────────────────
   CONFIDENCE SYSTEM
   Traduz scores numéricos em ações concretas do agente.
──────────────────────────────────────────────────────────────────────────── */
const AgentConfidence = {
  // Limiares
  AUTO_RESOLVE:    0.85, // resolve automaticamente, sem perguntar
  ASK_CONFIRM:     0.60, // sugere e pede confirmação leve
  OPEN_SELECTOR:   0.40, // abre seletor visual (chip list)
  // Abaixo de OPEN_SELECTOR → campo vazio, guided UI obrigatória

  classify(score) {
    if (score >= this.AUTO_RESOLVE)  return 'auto';
    if (score >= this.ASK_CONFIRM)   return 'confirm';
    if (score >= this.OPEN_SELECTOR) return 'selector';
    return 'unknown';
  },

  // Dado resultado do resolver, decide o que fazer
  decision(resolveResult) {
    const { match, confidence } = resolveResult;
    if (!match) return { action: 'unknown', confidence: 0 };
    const action = this.classify(confidence);
    return { action, match, confidence };
  },
};

/* ────────────────────────────────────────────────────────────────────────────
   SESSION MEMORY — memória curta da conversa
   Permite multi-turn: "crie despesa" → "qual conta?" → "nubank" → executa.
──────────────────────────────────────────────────────────────────────────── */
const AgentSession = {
  // Estado completo da sessão
  state: {
    pendingIntent:       null,   // intent aguardando dados
    draftData:           {},     // dados parciais coletados
    missingFields:       [],     // campos ainda faltantes
    lastEntities:        {},     // últimas entidades resolvidas { account_name, category_name, ... }
    lastPage:            null,   // última página visitada
    lastActionTimestamp: 0,      // timestamp da última ação executada
    awaitingField:       null,   // campo específico aguardando resposta
    ambiguities:         [],     // ambiguidades pendentes de resolução
    confirmationPending: null,   // plano aguardando confirmação do usuário
    turnCount:           0,      // contador de turnos da sessão
  },

  // Reseta a sessão (nova conversa ou após execução bem-sucedida)
  reset() {
    this.state = {
      pendingIntent:       null,
      draftData:           {},
      missingFields:       [],
      lastEntities:        {},
      lastPage:            this.state.lastPage, // preserva página atual
      lastActionTimestamp: this.state.lastActionTimestamp,
      awaitingField:       null,
      ambiguities:         [],
      confirmationPending: null,
      turnCount:           this.state.turnCount,
    };
    AgentLogger.debug('[session] reset');
  },

  // Inicia um novo draft de intent
  startIntent(intent, partialData = {}) {
    this.state.pendingIntent  = intent;
    this.state.draftData      = { ...partialData };
    this.state.missingFields  = [];
    this.state.awaitingField  = null;
    this.state.turnCount++;
    AgentLogger.info('[session] startIntent:', intent, partialData);
  },

  // Atualiza dados parciais do draft
  updateDraft(fields = {}) {
    Object.assign(this.state.draftData, fields);
    AgentLogger.debug('[session] updateDraft:', fields);
  },

  // Registra entidades resolvidas para uso em próximos turnos
  rememberEntities(entities = {}) {
    Object.assign(this.state.lastEntities, entities);
  },

  // Verifica se há um intent pendente com dados incompletos
  hasPendingIntent() {
    return !!(this.state.pendingIntent && this.state.missingFields.length > 0);
  },

  // Retorna o próximo campo faltante para perguntar ao usuário
  nextMissingField() {
    return this.state.missingFields[0] || null;
  },

  // Aplica valor a um campo, remove dos missing
  fillField(fieldKey, value) {
    this.state.draftData[fieldKey] = value;
    this.state.missingFields = this.state.missingFields.filter(f => f !== fieldKey);
    if (this.state.awaitingField === fieldKey) {
      this.state.awaitingField = null;
    }
    AgentLogger.debug(`[session] fillField: ${fieldKey} = ${value}`);
  },

  // Sinaliza que está aguardando resposta para um campo específico
  awaitField(fieldKey) {
    this.state.awaitingField = fieldKey;
  },

  // Persiste na session memory do agent._agent (compatibilidade)
  syncToAgent(agentObj) {
    if (!agentObj) return;
    agentObj.session = {
      ...agentObj.session,
      lastIntent:     this.state.pendingIntent,
      draftPlan:      this.state.draftData,
      draftUpdatedAt: Date.now(),
    };
  },
};

/* ────────────────────────────────────────────────────────────────────────────
   GEMINI CONTRACT
   Define o contrato de entrada/saída para o Gemini, separando interpretação
   de execução. O Gemini retorna sempre JSON estruturado.
──────────────────────────────────────────────────────────────────────────── */
const AgentGeminiContract = {

  // Prompt padrão para interpretação de intenção (NL → JSON estruturado)
  buildInterpretPrompt(userMessage, context) {
    return `Você é o interpretador do FinTrack Agent. Sua ÚNICA função é analisar o pedido do usuário e retornar JSON estruturado.

NÃO execute ações. NÃO responda em texto livre. Retorne APENAS JSON válido.

## Formato obrigatório:
{
  "intent": "<intent>",
  "confidence": <0.0-1.0>,
  "extracted_fields": { "<campo>": "<valor>" },
  "missing_fields": ["<campo>", ...],
  "ambiguities": [{ "field": "<campo>", "candidates": ["<a>", "<b>"] }],
  "suggested_ui": "<mensagem ao usuário em português>"
}

## Intents disponíveis:
create_transaction | create_scheduled | create_payee | create_category |
create_family_member | create_account | create_debt | create_dream |
edit_entity | delete_entity | query_balance | finance_query | navigate |
pay_debt | help | not_understood

## Regras:
- despesa = amount negativo; receita = amount positivo
- Se faltar dado crítico, inclua em missing_fields
- Se houver ambiguidade (ex: "Nubank" pode ser conta corrente ou crédito), inclua em ambiguities
- confidence: 1.0 = certeza absoluta, 0.0 = não entendeu nada
- suggested_ui: mensagem amigável para mostrar ao usuário

## Contexto atual:
Data: ${context.today}
Contas: ${JSON.stringify(context.accounts)}
Categorias: ${JSON.stringify(context.categories)}
Beneficiários: ${JSON.stringify(context.payees)}
Página atual: ${context.currentPage || 'dashboard'}
Sessão pendente: ${context.pendingIntent || 'nenhuma'}

## Pedido do usuário:
"${userMessage}"`;
  },

  // Valida e normaliza a resposta do Gemini
  parseResponse(rawText) {
    try {
      const cleaned = String(rawText || '')
        .trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```$/i, '')
        .trim();
      const f = cleaned.indexOf('{'), l = cleaned.lastIndexOf('}');
      if (f < 0 || l <= f) throw new Error('JSON não encontrado');
      const parsed = JSON.parse(cleaned.slice(f, l + 1));

      // Normalização e defaults
      return {
        intent:           String(parsed.intent || 'not_understood'),
        confidence:       Math.min(1, Math.max(0, Number(parsed.confidence) || 0)),
        extracted_fields: parsed.extracted_fields && typeof parsed.extracted_fields === 'object'
                            ? parsed.extracted_fields : {},
        missing_fields:   Array.isArray(parsed.missing_fields) ? parsed.missing_fields : [],
        ambiguities:      Array.isArray(parsed.ambiguities) ? parsed.ambiguities : [],
        suggested_ui:     String(parsed.suggested_ui || ''),
      };
    } catch (e) {
      AgentLogger.warn('[gemini-contract] parse error:', e.message);
      return {
        intent: 'not_understood',
        confidence: 0,
        extracted_fields: {},
        missing_fields: [],
        ambiguities: [],
        suggested_ui: '',
      };
    }
  },
};

/* ────────────────────────────────────────────────────────────────────────────
   PIPELINE STAGES
   Cada estágio do pipeline do agente é uma função pura (ou quase).
   agent.js chama AgentEngine.runPipeline(text) e recebe um PipelineResult.
──────────────────────────────────────────────────────────────────────────── */
const AgentPipeline = {

  /**
   * Estágio 1: Interpretação (NL → intenção + campos extraídos)
   * Usa heurísticas locais primeiro; Gemini como fallback/confirmação.
   */
  interpret(text, context) {
    AgentLogger.info('[pipeline:1] interpret:', text.slice(0, 80));
    const local = this._localInterpret(text, context);
    AgentLogger.debug('[pipeline:1] local result:', local);
    return local;
  },

  /**
   * Estágio 2: Extração de entidades brutas do texto
   */
  extractEntities(text, intentResult) {
    AgentLogger.info('[pipeline:2] extractEntities');
    // Delegado para as funções já existentes em agent.js (compatibilidade)
    return intentResult.extracted_fields || {};
  },

  /**
   * Estágio 3: Resolução de entidades (fuzzy + contexto)
   * Para cada campo de entidade, tenta resolver com o EntityResolver.
   */
  resolveEntities(entities, state) {
    AgentLogger.info('[pipeline:3] resolveEntities:', entities);
    const resolved = {};
    const ambiguities = [];

    const tryResolve = (key, list, entityType) => {
      const val = entities[key];
      if (!val) return;
      const result = AgentEntityResolver.resolve(list, val, entityType);
      const decision = AgentConfidence.decision(result);
      resolved[key] = { raw: val, ...result, decision: decision.action };
      if (decision.action === 'confirm' || decision.action === 'selector') {
        ambiguities.push({ field: key, candidates: [result.match, ...result.alternatives].filter(Boolean) });
      }
      AgentLogger.debug(`[pipeline:3] ${key}: "${val}" → conf=${result.confidence.toFixed(2)}, action=${decision.action}`);
    };

    tryResolve('account_name',  state.accounts   || [], 'account');
    tryResolve('category_name', state.categories || [], 'category');
    tryResolve('payee_name',    state.payees     || [], 'payee');

    return { resolved, ambiguities };
  },

  /**
   * Estágio 4: Avaliação de confiança global
   * Combina confidence da intent com a das entidades.
   */
  evaluateConfidence(intentResult, resolveResult) {
    const base = intentResult.confidence || 0.5;
    const entityScores = Object.values(resolveResult.resolved)
      .filter(r => r.match) // só entidades que resolveram
      .map(r => r.confidence);
    const entityAvg = entityScores.length
      ? entityScores.reduce((s, v) => s + v, 0) / entityScores.length
      : 1; // sem entidades = sem penalidade
    const combined = base * 0.6 + entityAvg * 0.4;
    AgentLogger.info('[pipeline:4] confidence:', { base, entityAvg, combined: combined.toFixed(2) });
    return combined;
  },

  /**
   * Estágio 5: Identificação de lacunas
   * Compara os campos extraídos com o schema da intent.
   */
  identifyGaps(intent, data) {
    AgentLogger.info('[pipeline:5] identifyGaps for:', intent);
    const schema = AGENT_INTENT_SCHEMAS[intent];
    if (!schema) return [];
    const isBlank = v => v === null || v === undefined || String(v).trim() === '' || (typeof v === 'number' && !Number.isFinite(v));
    const missing = schema.fields
      .filter(f => f.required && isBlank(data[f.key]))
      .map(f => f.key);
    AgentLogger.debug('[pipeline:5] missing fields:', missing);
    return missing;
  },

  /**
   * Estágio 6: Geração da estrutura guiada
   * Retorna HTML rich com chips, fields e botões de ação.
   * Delega para AgentGuidedUI.build().
   */
  buildGuidedStructure(intent, data, missingFields, resolvedEntities) {
    AgentLogger.info('[pipeline:6] buildGuidedStructure');
    return AgentGuidedUI.build(intent, data, missingFields, resolvedEntities);
  },

  /**
   * Interpretador local heurístico (sem Gemini)
   * Mantém compatibilidade com o sistema atual.
   */
  _localInterpret(text, context) {
    const msg = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // Intenções de ação mais comuns
    const actionPatterns = [
      // Transação
      { rx: /(cri[ea]r?|adicione|adicionar|lanc[ae]r?|registr[ae]r?)\s.*(despesa|gasto|compra)/,
        intent: 'create_transaction', type: 'expense' },
      { rx: /(cri[ea]r?|adicione|adicionar|lanc[ae]r?|registr[ae]r?)\s.*(receita|entrada|ganho|recebimento)/,
        intent: 'create_transaction', type: 'income' },
      { rx: /(cri[ea]r?|adicione|adicionar|lanc[ae]r?|registr[ae]r?)\s.*(transac)/,
        intent: 'create_transaction', type: null },

      // Programado
      { rx: /programad/,
        intent: 'create_scheduled', type: null },

      // Outros
      { rx: /(cri[ea]r?|adicione)\s.*(benefici|favorecido)/,
        intent: 'create_payee', type: null },
      { rx: /(cri[ea]r?|adicione)\s.*(categoria)/,
        intent: 'create_category', type: null },
      { rx: /(cri[ea]r?|adicione)\s.*(membro|familiar|integrante)/,
        intent: 'create_family_member', type: null },
      { rx: /(cri[ea]r?|adicione)\s.*(conta|bank)/,
        intent: 'create_account', type: null },
      { rx: /(cri[ea]r?|adicione|registr[ae]r?)\s.*(d[ií]vida)/,
        intent: 'create_debt', type: null },
      { rx: /(cri[ea]r?|adicione)\s.*(sonho|meta|objetivo)/,
        intent: 'create_dream', type: null },

      // Pagamento de dívida
      { rx: /(pagar?|quitar|abater)\s.*(d[ií]vida)/,
        intent: 'pay_debt', type: null },

      // Consultas financeiras
      { rx: /quanto (gastei|recebi|paguei|ganhei)|saldo|resumo|minhas? financa/,
        intent: 'finance_query', type: null },

      // Navegação
      { rx: /\b(abr[ia]|ir para|naveg|vai para|abre|mostra|mostrar)\b/,
        intent: 'navigate', type: null },

      // Ajuda
      { rx: /como (fazer|usar|criar|adicionar|configurar)|o que [eé]|para que serve|me explique/,
        intent: 'help', type: null },
    ];

    for (const p of actionPatterns) {
      if (p.rx.test(msg)) {
        const fields = {};
        if (p.type) fields.type = p.type;
        return {
          intent: p.intent,
          confidence: 0.7, // heurístico tem confiança moderada
          extracted_fields: fields,
          missing_fields: [],
          ambiguities: [],
          suggested_ui: '',
        };
      }
    }

    return {
      intent: 'not_understood',
      confidence: 0.1,
      extracted_fields: {},
      missing_fields: [],
      ambiguities: [],
      suggested_ui: '',
    };
  },
};

/* ────────────────────────────────────────────────────────────────────────────
   GUIDED UI BUILDER — gera HTML rico para campos faltantes
   Usa o schema do intent para criar cards interativos com chips e botões.
──────────────────────────────────────────────────────────────────────────── */
const AgentGuidedUI = {

  // Retorna o estado atual do state global (compatibilidade com agent.js)
  _state() { return window.state || {}; },

  // Monta o HTML completo da guided UI
  build(intent, data, missingFields, resolvedEntities = {}) {
    const schema = AGENT_INTENT_SCHEMAS[intent];
    if (!schema) return this._fallbackHtml(intent, data, missingFields);

    const icon = schema.icon || '⚡';
    const title = schema.label || 'Completar ação';
    const typeLabel = data.type === 'income' ? '🟢 Receita' : data.type === 'expense' ? '🔴 Despesa' : '';

    const fieldRows = schema.fields.map(field => {
      const value = data[field.key];
      const isMissing = missingFields.includes(field.key);
      const resolved  = resolvedEntities[field.key];
      return this._buildFieldRow(field, value, isMissing, resolved);
    }).join('');

    const chipsSection = missingFields.map(fieldKey => {
      const field = schema.fields.find(f => f.key === fieldKey);
      if (!field) return '';
      return this._buildFieldChips(field, data, resolvedEntities[fieldKey]);
    }).filter(Boolean).join('');

    const progress = this._progressBar(schema.fields.length - missingFields.length, schema.fields.length);

    return `
<div class="agent-guided-card">
  <div class="agent-guided-header">
    <span class="agent-guided-icon">${icon}</span>
    <div>
      <div class="agent-guided-title">${title}</div>
      ${typeLabel ? `<div class="agent-guided-subtitle">${typeLabel}</div>` : ''}
    </div>
    ${progress}
  </div>
  <div class="agent-guided-fields">${fieldRows}</div>
  ${chipsSection ? `<div class="agent-guided-chips-section">${chipsSection}</div>` : ''}
  <div class="agent-guided-hint">💬 Complete os campos destacados ou continue digitando naturalmente.</div>
</div>`.trim();
  },

  _buildFieldRow(field, value, isMissing, resolved) {
    const displayValue = this._formatValue(field, value);
    const missingClass = isMissing ? 'agent-guided-field--missing' : '';
    const indicator = isMissing ? '⚠️' : '✅';
    const confBadge = resolved && resolved.confidence < 0.85 && resolved.confidence >= 0.6
      ? `<span class="agent-conf-badge">?</span>` : '';

    return `
<div class="agent-guided-field ${missingClass}">
  <span class="agent-guided-field-label">${field.label}</span>
  <span class="agent-guided-field-value">${indicator} ${displayValue}${confBadge}</span>
</div>`.trim();
  },

  _buildFieldChips(field, data, resolved) {
    const options = this._getOptions(field, data);
    if (!options.length) return '';

    // Se há um match com confiança média (0.6-0.85), coloca como primeira opção destacada
    let headerHtml = '';
    if (resolved && resolved.match && resolved.requires_user_confirmation) {
      headerHtml = `
<div class="agent-chips-confirm">
  <span class="agent-chips-confirm-text">Você quis dizer <strong>${resolved.match.name}</strong>?</span>
  <button class="agent-chip agent-chip--confirm" onclick="agentChooseSlot('${field.key}', '${String(resolved.match.name).replace(/'/g,"&#39;")}', true)">✓ Sim</button>
  <button class="agent-chip agent-chip--alt" onclick="agentSuggest('')">Não, escolher</button>
</div>`.trim();
    }

    const chipsBtns = options.slice(0, 6).map(opt =>
      `<button class="agent-chip" onclick="agentChooseSlot('${field.key}', '${String(opt.value).replace(/'/g, "&#39;")}', true)">${opt.label}</button>`
    ).join('');

    return `
<div class="agent-chips-group">
  <div class="agent-chips-label">${field.label}:</div>
  ${headerHtml}
  <div class="agent-chips-row">${chipsBtns}</div>
</div>`.trim();
  },

  _getOptions(field, data) {
    const s = this._state();
    if (field.entityList === 'accounts')   return (s.accounts   || []).map(a => ({ value: a.name, label: a.name }));
    if (field.entityList === 'categories') {
      const type = data.type || 'expense';
      return (s.categories || [])
        .filter(c => !c.type || c.type === type || c.type === 'both')
        .map(c => ({ value: c.name, label: c.name }));
    }
    if (field.entityList === 'payees')     return (s.payees || []).map(p => ({ value: p.name, label: p.name }));
    if (field.choices)                     return field.choices;
    if (field.key === 'date')              return [
      { value: new Date().toISOString().slice(0, 10), label: 'Hoje' },
      { value: (() => { const d = new Date(); d.setDate(d.getDate()-1); return d.toISOString().slice(0,10); })(), label: 'Ontem' },
    ];
    return [];
  },

  _formatValue(field, value) {
    if (value === null || value === undefined || String(value).trim() === '') {
      return '<span class="agent-guided-empty">[preencher]</span>';
    }
    if (field.key === 'amount') {
      const n = Math.abs(Number(value) || 0);
      return typeof fmt === 'function' ? fmt(n, 'BRL') : `R$ ${n.toFixed(2)}`;
    }
    if (field.key === 'frequency') {
      const map = { daily: 'Diária', weekly: 'Semanal', monthly: 'Mensal', yearly: 'Anual' };
      return map[value] || value;
    }
    if (field.type === 'date') return String(value).slice(0, 10);
    return String(value);
  },

  _progressBar(filled, total) {
    const pct = total > 0 ? Math.round((filled / total) * 100) : 100;
    return `<div class="agent-guided-progress" title="${pct}% completo"><div class="agent-guided-progress-bar" style="width:${pct}%"></div></div>`;
  },

  _fallbackHtml(intent, data, missingFields) {
    // fallback simples se schema não existir
    const rows = missingFields.map(f => `<div class="agent-guided-field agent-guided-field--missing"><span>${f}</span></div>`).join('');
    return `<div class="agent-guided-card"><div class="agent-guided-fields">${rows}</div></div>`;
  },
};

/* ────────────────────────────────────────────────────────────────────────────
   QUICK REPLIES — sugestões contextuais rápidas baseadas na página atual
──────────────────────────────────────────────────────────────────────────── */
const AgentQuickReplies = {
  // Retorna chips de ações rápidas baseados na página atual e contexto
  getForPage(page) {
    const pageMap = {
      dashboard: [
        { label: '💸 Nova despesa',  text: 'criar despesa' },
        { label: '💰 Nova receita',  text: 'criar receita' },
        { label: '📊 Meu resumo',    text: 'resumo financeiro deste mês' },
        { label: '💳 Saldo',         text: 'qual meu saldo total?' },
      ],
      transactions: [
        { label: '💸 Criar despesa', text: 'criar despesa' },
        { label: '💰 Criar receita', text: 'criar receita' },
        { label: '📅 Mês passado',   text: 'quanto gastei no mês passado?' },
        { label: '🏷️ Por categoria', text: 'maiores categorias de gasto' },
      ],
      scheduled: [
        { label: '📅 Criar programado',  text: 'criar transação programada mensal' },
        { label: '📋 Meus programados',  text: 'quais são meus programados ativos?' },
      ],
      debts: [
        { label: '📋 Nova dívida',    text: 'registrar dívida' },
        { label: '💳 Pagar dívida',   text: 'pagar dívida' },
      ],
      payees: [
        { label: '👤 Novo beneficiário', text: 'criar beneficiário' },
      ],
      default: [
        { label: '💸 Nova despesa',  text: 'criar despesa' },
        { label: '💰 Nova receita',  text: 'criar receita' },
        { label: '❓ Ajuda',         text: 'como usar o FinTrack?' },
        { label: '💳 Saldo',         text: 'qual meu saldo?' },
      ],
    };
    return pageMap[page] || pageMap.default;
  },

  // Renderiza os chips de quick replies
  render(page) {
    const replies = this.getForPage(page);
    const buttons = replies.map(r =>
      `<button class="agent-quick-chip" onclick="agentSuggest('${r.text.replace(/'/g,"&#39;")}')">${r.label}</button>`
    ).join('');
    return `<div class="agent-quick-replies">${buttons}</div>`;
  },
};

/* ────────────────────────────────────────────────────────────────────────────
   RESPONSE BUILDER — monta respostas UX ricas
   Evita respostas puramente textuais.
──────────────────────────────────────────────────────────────────────────── */
const AgentResponseBuilder = {

  // Resposta de sucesso com botão de ação opcional
  success(message, actions = []) {
    const actionBtns = actions.map(a =>
      `<button class="agent-action-btn" onclick="${a.onclick}">${a.label}</button>`
    ).join('');
    return {
      html: `<div class="agent-response agent-response--success">
        <div class="agent-response-text">✅ ${_agentMarkdownSafe(message)}</div>
        ${actionBtns ? `<div class="agent-response-actions">${actionBtns}</div>` : ''}
      </div>`,
    };
  },

  // Resposta de erro com sugestão de recovery
  error(message, suggestions = []) {
    const sugBtns = suggestions.map(s =>
      `<button class="agent-chip" onclick="agentSuggest('${s.replace(/'/g,"&#39;")}')">${s}</button>`
    ).join('');
    return {
      html: `<div class="agent-response agent-response--error">
        <div class="agent-response-text">❌ ${_agentMarkdownSafe(message)}</div>
        ${sugBtns ? `<div class="agent-chips-row" style="margin-top:8px">${sugBtns}</div>` : ''}
      </div>`,
    };
  },

  // Resposta de confirmação pendente
  confirmPending(summary, details = '') {
    return {
      html: `<div class="agent-response agent-response--confirm">
        <div class="agent-response-text">🧾 ${_agentMarkdownSafe(summary)}</div>
        ${details ? `<div class="agent-response-detail">${details}</div>` : ''}
        <div class="agent-response-actions">
          <button class="agent-action-btn agent-action-btn--primary" onclick="agentSend_confirm()">✓ Confirmar</button>
          <button class="agent-action-btn agent-action-btn--secondary" onclick="agentSend_cancel()">✗ Cancelar</button>
        </div>
      </div>`,
    };
  },

  // Resposta de "não entendido" com suggestions contextuais
  notUnderstood(hasGeminiKey = false) {
    const tips = hasGeminiKey
      ? ['criar despesa de R$50 em Alimentação', 'quanto gastei este mês?', 'como usar o FinTrack?']
      : ['criar despesa de R$50', 'qual meu saldo?', 'como criar uma conta?'];
    const chipsBtns = tips.map(t =>
      `<button class="agent-chip" onclick="agentSuggest('${t.replace(/'/g,"&#39;")}')">${t}</button>`
    ).join('');
    return {
      html: `<div class="agent-response agent-response--neutral">
        <div class="agent-response-text">🤔 Não consegui entender esse pedido.</div>
        <div class="agent-chips-label" style="margin-top:8px">Tente:</div>
        <div class="agent-chips-row">${chipsBtns}</div>
        ${!hasGeminiKey ? '<div class="agent-guided-hint" style="margin-top:8px">💡 Configure a chave Gemini em <strong>Configurações → IA</strong> para comandos mais complexos.</div>' : ''}
      </div>`,
    };
  },
};

// Helper de markdown seguro (não depende de agent.js estar carregado)
function _agentMarkdownSafe(text) {
  return String(text || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

/* ────────────────────────────────────────────────────────────────────────────
   AGENT ENGINE — fachada pública que une todos os módulos
   agent.js importa este objeto para usar o pipeline profissional.
──────────────────────────────────────────────────────────────────────────── */
const AgentEngine = {

  // Módulos internos (acessíveis para extensão/teste)
  EntityResolver: AgentEntityResolver,
  Confidence:     AgentConfidence,
  Session:        AgentSession,
  GeminiContract: AgentGeminiContract,
  Pipeline:       AgentPipeline,
  GuidedUI:       AgentGuidedUI,
  QuickReplies:   AgentQuickReplies,
  ResponseBuilder:AgentResponseBuilder,
  Schemas:        AGENT_INTENT_SCHEMAS,
  Logger:         AgentLogger,

  // Ativa modo debug (loga todos os estágios no console)
  setDebug(on) { AgentLogger.debug = !!on; },

  /**
   * Pipeline completo de processamento de uma mensagem do usuário.
   * Retorna um PipelineResult com tudo necessário para agent.js executar.
   *
   * @param {string} text           - mensagem do usuário
   * @param {object} agentState     - estado atual do _agent (de agent.js)
   * @param {object} appState       - state global do app (window.state)
   * @returns {PipelineResult}
   */
  async runPipeline(text, agentState, appState) {
    AgentLogger.info('[engine] runPipeline:', text.slice(0, 100));
    AgentSession.state.turnCount++;

    const context = this._buildContext(agentState, appState);

    // Estágio 1: Interpretação local
    const interpretation = AgentPipeline.interpret(text, context);

    // Estágio 2: Extração de entidades (combinando heurísticas)
    const rawEntities = AgentPipeline.extractEntities(text, interpretation);

    // Estágio 3: Resolução de entidades
    const { resolved, ambiguities } = AgentPipeline.resolveEntities(rawEntities, appState);

    // Montar data consolidada (raw + resolved)
    const data = { ...rawEntities };
    for (const [key, res] of Object.entries(resolved)) {
      if (res.match && res.decision === 'auto') {
        // Alta confiança → resolve direto, sem perguntar
        if (key === 'account_name')   data.account_name  = res.match.name;
        if (key === 'category_name')  data.category_name = res.match.name;
        if (key === 'payee_name')     data.payee_name    = res.match.name;
      }
    }

    // Estágio 4: Avaliação de confiança global
    const globalConfidence = AgentPipeline.evaluateConfidence(interpretation, { resolved });

    // Estágio 5: Identificação de lacunas
    const missingFields = AgentPipeline.identifyGaps(interpretation.intent, data);

    // Estágio 6: Estrutura guiada (se necessário)
    const guidedHtml = missingFields.length > 0
      ? AgentPipeline.buildGuidedStructure(interpretation.intent, data, missingFields, resolved)
      : null;

    const result = {
      intent:           interpretation.intent,
      confidence:       globalConfidence,
      data,
      resolved,
      ambiguities:      [...(interpretation.ambiguities || []), ...ambiguities],
      missingFields,
      isGuided:         missingFields.length > 0,
      guidedHtml,
      requiresConfirm:  globalConfidence < AgentConfidence.AUTO_RESOLVE && globalConfidence >= AgentConfidence.ASK_CONFIRM,
      suggestedUi:      interpretation.suggested_ui || '',
    };

    AgentLogger.info('[engine] pipeline result:', {
      intent: result.intent,
      confidence: result.confidence.toFixed(2),
      missingFields: result.missingFields,
      isGuided: result.isGuided,
    });

    return result;
  },

  // Usa Gemini como reforço quando heurísticas são insuficientes
  async runWithGemini(text, agentState, appState, apiKey) {
    AgentLogger.info('[engine] runWithGemini');
    const context = this._buildContext(agentState, appState);
    const prompt = AgentGeminiContract.buildInterpretPrompt(text, context);

    let rawText = '';
    for (const model of ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']) {
      try {
        rawText = await this._callGemini(prompt, apiKey, 600, model);
        break;
      } catch (e) {
        if (!/404/.test(e.message || '')) throw e;
      }
    }

    const geminiResult = AgentGeminiContract.parseResponse(rawText);
    AgentLogger.info('[engine] gemini result:', geminiResult);

    // Mescla resultado do Gemini com entidades extraídas localmente
    const { resolved, ambiguities } = AgentPipeline.resolveEntities(
      geminiResult.extracted_fields,
      appState
    );

    const data = { ...geminiResult.extracted_fields };
    for (const [key, res] of Object.entries(resolved)) {
      if (res.match && res.decision === 'auto') {
        if (key === 'account_name')   data.account_name  = res.match.name;
        if (key === 'category_name')  data.category_name = res.match.name;
        if (key === 'payee_name')     data.payee_name    = res.match.name;
      }
    }

    const missingFields = [
      ...geminiResult.missing_fields,
      ...AgentPipeline.identifyGaps(geminiResult.intent, data),
    ].filter((v, i, a) => a.indexOf(v) === i); // deduplica

    const guidedHtml = missingFields.length > 0
      ? AgentPipeline.buildGuidedStructure(geminiResult.intent, data, missingFields, resolved)
      : null;

    return {
      intent:          geminiResult.intent,
      confidence:      geminiResult.confidence,
      data,
      resolved,
      ambiguities:     [...geminiResult.ambiguities, ...ambiguities],
      missingFields,
      isGuided:        missingFields.length > 0,
      guidedHtml,
      requiresConfirm: geminiResult.confidence < AgentConfidence.AUTO_RESOLVE,
      suggestedUi:     geminiResult.suggested_ui,
    };
  },

  // Constrói contexto para interpretação
  _buildContext(agentState, appState) {
    const s = appState || {};
    return {
      today:         new Date().toISOString().slice(0, 10),
      currentPage:   s.currentPage || window.state?.currentPage || 'dashboard',
      pendingIntent: AgentSession.state.pendingIntent,
      accounts:      (s.accounts   || []).slice(0, 20).map(a => ({ id: a.id, name: a.name, type: a.type })),
      categories:    (s.categories || []).slice(0, 40).map(c => ({ id: c.id, name: c.name, type: c.type })),
      payees:        (s.payees     || []).slice(0, 30).map(p => ({ id: p.id, name: p.name })),
    };
  },

  // Chamada Gemini compartilhada
  async _callGemini(prompt, apiKey, maxTokens = 600, model = 'gemini-2.0-flash') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.1 },
      }),
    });
    if (!resp.ok) {
      const raw = await resp.text().catch(() => '');
      throw new Error(`Gemini HTTP ${resp.status}${raw ? ': ' + raw.slice(0, 120) : ''}`);
    }
    const json = await resp.json();
    return json?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  },
};

// Expõe globalmente
window.AgentEngine = AgentEngine;

AgentLogger.info('[agent_engine] loaded — FinTrack Copiloto v3');
