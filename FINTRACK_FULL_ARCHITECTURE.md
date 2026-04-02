# Family FinTrack — Arquitetura Técnica Completa
**Versão:** 2026.1 · **Atualizado em:** Março 2026  
**Stack:** Vanilla JS · Supabase (PostgreSQL + Auth + Storage) · PWA · Gemini AI

---

## 1. Visão Geral da Arquitetura

O **Family FinTrack** é uma Progressive Web App (PWA) de página única (SPA) construída com HTML/CSS/JavaScript puro, sem frameworks de front-end. O backend é inteiramente gerenciado pelo **Supabase** (PostgreSQL, Auth, Row Level Security, Storage e Edge Functions).

```
┌─────────────────────────────────────────────────────────┐
│                    CLIENTE (Browser / PWA)               │
│                                                         │
│  app.html ─► routing via navigate()                     │
│  index.html ─► landing page pública                     │
│                                                         │
│  JS Modules (js/*.js)                                   │
│  ├── auth.js        Autenticação e sessão               │
│  ├── app.js         Roteamento, topbar, navegação        │
│  ├── state.js       Estado global compartilhado          │
│  ├── db.js          Cache de dados e loaders             │
│  ├── ui_helpers.js  Helpers de UI reutilizáveis          │
│  ├── utils.js       Utilitários (fmt, toast, masks)      │
│  └── [módulos].js   Um arquivo por feature               │
│                                                         │
│  CSS                                                    │
│  └── css/style.css  ~22.000 linhas, design system       │
│                                                         │
│  PWA                                                    │
│  ├── manifest.json  Metadados da PWA                    │
│  └── js/sw.js       Service Worker (cache offline)       │
└────────────────────────┬────────────────────────────────┘
                         │ HTTPS / WebSocket
                         │ Supabase JS Client (sb)
┌────────────────────────▼────────────────────────────────┐
│                    SUPABASE (Backend)                    │
│                                                         │
│  Auth    JWT + bcrypt · Sessions · Magic Links           │
│  DB      PostgreSQL 15 + RLS policies                   │
│  Storage fintrack-attachments (PDFs, imagens)           │
│  Functions Edge Functions (auto-registro, notificações) │
└─────────────────────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│              SERVIÇOS EXTERNOS                           │
│                                                         │
│  Google Gemini API   IA (insights, agent, sonhos)       │
│  Frankfurter API     Cotações de câmbio                 │
│  EmailJS             Notificações por e-mail            │
│  WhatsApp Business   Notificações (via template)        │
│  Telegram Bot API    Notificações programadas           │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Estrutura de Arquivos

```
fintrackapp-main/
├── index.html              Landing page pública
├── app.html                App principal (SPA)
├── manifest.json           PWA manifest
├── css/
│   └── style.css           Design system completo (~22.500 linhas)
└── js/
    ├── app.js              Roteamento, navigate(), topbar, sidebar
    ├── auth.js             Autenticação, sessão, roles, famílias
    ├── state.js            Estado global (state.*)
    ├── db.js               Loaders, cache invalidation (DB.*)
    ├── config.js           Constantes, EMAILJS_CONFIG
    ├── supabase.js         Cliente Supabase (sb), famQ()
    ├── utils.js            fmt(), toast(), masks, amt helpers
    ├── ui_helpers.js       buildCatPicker(), payee autocomplete
    ├── i18n.js             Internacionalização PT/EN/ES/FR
    ├── fx_rates.js         Cotações FX, toBRL(), iof.js
    ├── date.js             Helpers de data (fmtDate, localDateStr)
    ├── transactions.js     CRUD de transações
    ├── accounts.js         CRUD de contas e grupos
    ├── categories.js       CRUD de categorias (hierárquico)
    ├── payees.js           CRUD de beneficiários
    ├── scheduled.js        Programados recorrentes
    ├── budgets.js          Orçamentos mensais/anuais
    ├── reports.js          Relatórios, gráficos, PDF, CSV, e-mail
    ├── forecast.js         Previsão de caixa (fluxo projetado)
    ├── dashboard.js        Dashboard com KPIs e gráfico 90 dias
    ├── ai_insights.js      AI Insights (Gemini, chat, snapshots)
    ├── agent.js            FinTrack Agent (chat assistente IA)
    ├── dreams.js           Módulo Sonhos (objetivos financeiros)
    ├── investments.js      Carteira de investimentos
    ├── debts.js            Gestão de dívidas
    ├── prices.js           Rastreamento de preços
    ├── grocery.js          Lista de compras
    ├── import.js           Importação CSV/OFX
    ├── backup.js           Backup e restore JSON
    ├── settings.js         Configurações, módulos, telemetria
    ├── telemetry.js        Telemetria e analytics
    ├── help.js             Central de ajuda (4 idiomas)
    ├── feedback.js         Feedback de usuários
    ├── auto_register.js    Auto-registro de programados
    ├── form_mode.js        Modo abas vs. wizard
    ├── wizard.js           Wizard de criação de transação
    ├── family_members_composition.js  Composição familiar
    ├── family_prefs.js     Preferências por família
    ├── payee_autocomplete.js  Autocomplete de beneficiários
    ├── receipt_ai.js       OCR de recibos com Gemini Vision
    ├── import_ai.js        Assistente de importação com IA
    ├── orphan.js           Detecção de transações sem categoria
    ├── audit.js            Logs de auditoria
    ├── admin.js            Painel administrativo
    ├── translations_admin.js  Gerenciamento de traduções
    ├── privacy.js          Página de privacidade
    ├── landing.js          Landing page
    └── sw.js               Service Worker PWA
```

---

## 3. Módulo de Estado Global (`state.js`)

O estado é centralizado em um único objeto `state` acessível globalmente:

```javascript
const state = {
  // Dados carregados do DB
  accounts:      [],   // Contas bancárias
  categories:    [],   // Categorias (hierárquicas)
  payees:        [],   // Beneficiários
  transactions:  [],   // Transações do mês atual
  scheduled:     [],   // Programados ativos
  budgets:       [],   // Orçamentos do mês

  // Sessão
  user:          null, // currentUser (app_users)
  familyId:      null, // UUID da família atual
  currentPage:   '',   // Página ativa
  
  // UI
  privacyMode:   false, // Modo privacidade (oculta valores)
  chartInstances: {},   // Instâncias Chart.js ativas
  txFilter:      {},    // Filtros ativos em Transações
};
```

### Cache Invalidation (`db.js`)

```javascript
// Padrão de cache com bust()
DB.accounts = {
  load: async () => { /* fetch + state.accounts = */ },
  bust: () => { /* invalida cache local */ }
};
```

---

## 4. Roteamento e Navegação (`app.js`)

Não há framework de roteamento. A navegação é imperativa via `navigate(page)`:

```javascript
function navigate(page) {
  // Guarda-admin: settings/telemetry apenas para admin
  // Histórico para navigateBack()
  // Ativa .page + .nav-item + .bn-item correspondentes
  // Injeta page-header-bar no topo da página
  // Move FX bar para abaixo do header
  // Chama init da página (ex: initDashboard())
}
```

### Injeção de Header por Página

```javascript
// _injectPageHeader(pg) - chamado a cada navigate()
// Cria div.page-header-bar com ícone SVG + título + ação opcional
// Inserido como firstChild da .page ativa
// FX bar reposicionada imediatamente abaixo
```

---

## 5. Autenticação e Autorização (`auth.js`)

### Fluxo de Login
```
Landing → doLogin() → supabase.auth.signInWithPassword()
  → onAuthStateChange() → loadUserProfile() → initApp()
```

### Roles e Permissões
| Role | can_view | can_create | can_edit | can_delete | can_admin |
|------|----------|------------|----------|------------|-----------|
| owner | ✓ | ✓ | ✓ | ✓ | ✓ |
| admin | ✓ | ✓ | ✓ | ✓ | ✓ |
| editor | ✓ | ✓ | ✓ | - | - |
| viewer | ✓ | - | - | - | - |
| member | ✓ | ✓ | ✓ | - | - |

### Família e Multi-tenant
```javascript
// famId() - retorna UUID da família ativa
// famQ(query) - aplica .eq('family_id', famId()) em toda query
// Usuário pode pertencer a múltiplas famílias (preferred_family_id)
```

### Row Level Security (RLS)
Todas as tabelas têm políticas RLS que isolam dados por família. Funções críticas:
- `ft_get_my_family_ids()` — SECURITY DEFINER, retorna famílias do usuário
- `ft_is_admin()` — SECURITY DEFINER, verifica role admin

---

## 6. Banco de Dados (PostgreSQL + Supabase)

### Tabelas Principais

#### `families` — Famílias
```sql
id uuid PK, name text, description text, active boolean,
created_at timestamptz, updated_at timestamptz
```

#### `app_users` — Usuários do app
```sql
id uuid PK, email text UNIQUE, name text, password_hash text,
role text, active boolean, approved boolean,
family_id uuid → families, auth_uid uuid UNIQUE → auth.users,
preferred_family_id uuid, preferred_form_mode text,
notify_on_tx boolean, notify_tx_email boolean, ...
```

#### `accounts` — Contas financeiras
```sql
id uuid PK, name text, type account_type, currency text,
balance numeric, color text, icon text, active boolean,
is_brazilian boolean, iof_rate numeric,
group_id uuid → account_groups, family_id uuid,
initial_balance numeric, is_favorite boolean,
best_purchase_day integer, due_day integer
```

#### `transactions` — Transações
```sql
id uuid PK, account_id uuid, payee_id uuid, category_id uuid,
description text, amount numeric, currency text,
exchange_rate numeric, amount_brl numeric,
date date, time time, memo text, tags uuid[],
is_transfer boolean, transfer_to_account_id uuid,
transfer_pair_id uuid, balance_after numeric,
reconciled boolean, is_card_payment boolean,
status varchar(default 'confirmed'),
family_id uuid, family_member_id uuid, family_member_ids uuid[]
```

#### `scheduled_transactions` — Programados
```sql
id uuid PK, description text, type text, amount numeric,
account_id uuid, payee_id uuid, category_id uuid,
frequency text, start_date date, end_date date, end_count integer,
auto_register boolean, auto_confirm boolean,
notify_email boolean, notify_whatsapp boolean, notify_telegram boolean,
family_id uuid, status text, currency text, ...
```

#### `categories` — Categorias
```sql
id uuid PK, name text, parent_id uuid → categories (self-ref),
type text (despesa|receita|transferencia),
color text, icon text, family_id uuid
```

#### `budgets` — Orçamentos
```sql
id uuid PK, category_id uuid, month date, amount numeric,
budget_type text, auto_reset boolean, year integer,
family_id uuid, family_member_id uuid
```

#### `dreams` — Sonhos financeiros
```sql
id uuid PK, family_id uuid, created_by uuid,
title text, description text, dream_type text,
target_amount numeric, currency text, target_date date,
priority integer, status text (active|paused|achieved|cancelled),
ai_generated_fields_json jsonb, simulation_json jsonb
```

#### `dream_items` — Componentes do sonho
```sql
id uuid PK, dream_id uuid, family_id uuid,
name text, estimated_amount numeric, is_ai_suggested boolean
```

#### `dream_contributions` — Aportes
```sql
id uuid PK, dream_id uuid, family_id uuid,
amount numeric, date date, type text, notes text
```

#### `ai_insight_snapshots` — Snapshots de análise IA
```sql
id uuid PK, family_id uuid, created_by uuid, title text,
period_from date, period_to date, snapshot_type text,
status text, filters jsonb, source_metrics jsonb,
projection_metrics jsonb, recommendation_summary jsonb,
ai_summary jsonb, confidence_score numeric, model_name text
```

#### `investment_positions`, `investment_transactions`, `investment_price_history`
Carteira de investimentos com posições, transações e histórico de preços.

#### `debts`, `debt_ledger`
Gestão de dívidas com ledger de movimentações (amortização, juros, ajustes).

#### `price_items`, `price_history`, `price_stores`
Rastreamento de preços de produtos por loja.

#### `grocery_lists`, `grocery_items`
Listas de compras integradas com rastreamento de preços.

#### `app_telemetry`
Telemetria de uso: events, sessões, dispositivos, páginas.

#### `app_feedback`
Feedbacks de usuários (bug, melhoria, feature).

#### `app_settings` — Configurações key-value (JSONB)
```sql
key text PK, value jsonb, updated_at timestamptz
-- Exemplos de keys:
-- 'gemini_api_key', 'emailjs_*', 'dreams_enabled_{family_id}',
-- 'px_hierarchy_{family_id}', 'px_item_meta_{family_id}'
```

---

## 7. Módulos Funcionais

### 7.1 Dashboard (`dashboard.js`)

**KPIs exibidos:** Saldo total, Receitas/Despesas do mês, Taxa de poupança, Próximos programados.

**Gráfico 90 dias:** Projeção de saldo por conta. Pontos aparecem em datas com transações (clicáveis → abre detalhes do dia). Implementado com Chart.js usando `pointRadius` condicional por array.

**Widgets configuráveis:** O usuário pode personalizar quais cards aparecem via `openDashCustomModal()`. Preferências salvas em `app_settings` com key `dash_prefs_{family_id}`.

### 7.2 Transações (`transactions.js`)

**Entrada de dados — Modo Abas:**
- **Principal:** Valor (ATM-style centavo-first), Data, Descrição, Conta, Beneficiário, Categoria
- **Detalhes:** Membro da família, Tags, Memo, Anexo
- **Tabs:** Estilo pill verde com animação de seleção

**Entrada de dados — Modo Wizard (4 passos):**
Alternativa ao modo abas. Preferência salva por usuário (`preferred_form_mode`).

**Mascaramento de valor:** Sistema ATM centavo-first em `utils.js`. `dataset.amtCents` é a fonte de verdade. Suporte a paste em formato BR (`1.500,00`) e EN (`1500.00`).

**AI Smart Suggestions:** Ao digitar descrição, o sistema sugere categoria, beneficiário e membro via Gemini (debounce 600ms).

**Agrupamento:** Modo padrão agrupa por data. Modo por conta usa `renderWithDateGroupsForGroup()`.

### 7.3 Relatórios (`reports.js`)

**Três visões:**
1. **Análise:** KPIs + gráficos de categoria (barra/rosca) + gráfico por conta + tendência mensal. Clicar em qualquer barra/fatia abre drill-down com transações filtradas.
2. **Transações:** Tabela filtrável e ordenável.
3. **Previsão:** Delegada ao `forecast.js`.

**Drill-down panel:** `position:fixed` (corrigido em 2026), inicializado lazily na primeira chamada. HTML criado dinamicamente em `_drillOpen()`.

**Exportação:** PDF (jsPDF + jspdf-autotable), CSV (download direto), Impressão, E-mail (EmailJS + Storage para link PDF).

**Filtros:** Período, Conta, Categoria, Beneficiário, Tipo, Tags, Membro, Grupo de parentesco.

### 7.4 Previsão de Caixa (`forecast.js`)

Calcula saldo projetado combinando transações reais + programados futuros.

**Gráfico:** Chart.js line chart com pontos apenas em datas com transações (clicáveis). Clicar em ponto chama `_forecastDrillRow(date, label)` → abre detalhes do dia.

```javascript
// Lógica de pontos por conta
pointRadius: sampledDates.map(d => {
  if (!accDatesWithTx.has(d)) return 0;
  return sampledDates.length > 60 ? 3 : 5;
}),
```

**Tabela:** Agrupada por data com badge "prog." para programados. Clicável linha a linha.

**Seletor de contas:** Multi-select via `_fcPickerBuild()`. Preferências salvas.

### 7.5 AI Insights (`ai_insights.js`)

**Arquitetura:**
```
Dados (state + DB) → Engine (ai_insights.js) → Prompt → Gemini API → Renderização
```

**Engine v2:**
- Coleta transações do período com filtros aplicados
- Calcula KPIs: receita, despesa, saldo, taxa poupança, ticket médio
- Agrupa por categoria, beneficiário e membro da família
- Detecta anomalias e padrões recorrentes
- Projeta orçamentos (closedMonthKeys)
- Exclui `adjustment` e `card_payment` de projeções

**Abas:**
- **Análise:** Formulário de filtros (colapsável) + botão "Analisar com IA" + resultado
- **Snapshots:** Histórico de análises salvas (`ai_insight_snapshots`)
- **Chat:** Chat contextual sobre os dados do período analisado

**Modelos suportados:** `gemini-2.0-flash`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`

**Prompt version:** `ai-insights-prompt-v2`

### 7.6 FinTrack Agent (`agent.js`)

Assistente conversacional com três capacidades:

```
Mensagem → _agentClassifyIntent() → dispatcher
  HELP    → _agentAnswerHelp()     (busca semântica + Gemini)
  FINANCE → _agentAnswerFinance()  (state + DB + Gemini)
  ACTION  → _agentBuildPlan() → _agentExecute()
  UNKNOWN → Gemini fallback
```

**Intent classification:** Regex-based sem IA por padrão. Gemini é invocado para intents complexas ou quando `_agentParseStructured()` retorna `not_understood`.

**Ações suportadas:** `create_transaction`, `create_scheduled`, `create_payee`, `create_category`, `create_debt`, `navigate`, `query_balance`.

**UI (redesign 2026):**
- Header: gradiente verde FinTrack + dot "online" animado + avatar SVG
- Bolhas: estilo assimétrico (assistente: `4px 12px 12px 12px`; usuário: `12px 4px 12px 12px`)
- Input: focus verde (#16a34a), botão enviar com gradiente
- Chips de sugestão com hover verde

### 7.7 Módulo Sonhos (`dreams.js`)

**Tabelas:** `dreams`, `dream_items`, `dream_contributions`

**Wizard de criação (4 passos):**
1. Tipo (viagem/automóvel/imóvel) ou texto livre → interpretação IA
2. Dados básicos + campos específicos do tipo
3. Componentes de custo (manual ou sugestão IA)
4. Revisão e confirmação

**Análise IA:** Prompt envia contexto do sonho + dados financeiros reais → retorna JSON com `viabilidade`, `resumo`, `pontos_positivos`, `alertas`, `recomendacoes`, `prazo_realista_meses`, `economia_sugerida_mensal`, `motivacao`.

**Cenários:** Calculados localmente com `remaining / (months * 1.5)`, `/ months`, `/ (months * 0.7)`.

**CSS redesign 2026:** Cards com `::before` colorido por tipo, ícone em pill, progress bar arredondada, empty state com animação `dreamFloat`, wizard com `.drm-wizard-step` indicators.

### 7.8 Programados (`scheduled.js`)

**Frequências:** once, weekly, biweekly, monthly, bimonthly, quarterly, semiannual, annual, custom.

**Auto-registro:** `auto_register.js` + Edge Function processa programados vencidos e cria transações automaticamente.

**Modal (redesign 2026):**
- Tabs em pill verde (`.tx-ctx-tab.active` com `background:var(--accent)`)
- Campo "Primeira data" adicionado na aba Principal
- Cards de notificação com borda colorida quando checkbox ativado
- Grid de frequência como pill buttons

**Notificações:** Email (EmailJS), WhatsApp (template), Telegram (bot API).

### 7.9 Investimentos (`investments.js`)

**Banner:** `inv-hero` com gradiente `160deg, #0d3d28 → #1d6b47 → #0e3520` (alinhado com `dbt-hero` em 2026).

**Posições:** ticker, asset_type, quantity, avg_cost, current_price.

**Rentabilidade:** `(current_price - avg_cost) / avg_cost × quantity`.

**Histórico:** `investment_price_history` com fonte `api` ou `manual`.

### 7.10 Dívidas (`debts.js`)

**Tipos de reajuste:** fixed, selic, ipca, igpm, cdi, poupanca, custom.

**Ledger:** Cada movimento (amortização, juros, ajuste) cria um registro em `debt_ledger` com `previous_balance` e `resulting_balance`.

**Credores:** Referenciados via `payees.id` (`creditor_payee_id`).

---

## 8. Sistema de Câmbio FX

```javascript
// fx_rates.js
toBRL(amount, currency)      // Converte para BRL usando taxa atual
txToBRL(transaction)         // Considera exchange_rate ou brl_amount
_renderFxBadge()             // Atualiza barra de câmbio no topo
fetchScCurrencyRate()        // Busca cotação via Frankfurter API
```

**Modos de taxa:**
- `fixed` — Taxa fixada no momento do lançamento
- `api` — Buscada via Frankfurter API na data do registro
- `iof` — Aplica IOF sobre transações internacionais (padrão 3.38%)

---

## 9. Internacionalização (`i18n.js`)

**Idiomas:** pt (padrão), en, es, fr

**Arquitetura:**
```javascript
// Todas as strings em objeto _i18nData
// t(key) → retorna string no idioma ativo
// i18nApplyToDOM(el) → aplica data-i18n="key" a todos os elementos
// i18nGetLanguage() → idioma ativo
```

**Cobertura:** ~300+ chaves. Inclui `tx.*`, `ai.*`, `rpt.*`, `sched.*`, etc.

---

## 10. Design System (`css/style.css`)

### Variáveis CSS (tokens)
```css
:root {
  --accent: #1F6B4F;       /* Verde FinTrack */
  --accent-lt: rgba(31,107,79,.1);
  --surface: #ffffff;
  --surface2: #f8faf9;
  --border: #e5e7eb;
  --text: #1a1a1a;
  --text2: #4b5563;
  --muted: #9ca3af;
  --topbar-h: 58px;
  --bottom-h: 64px;
  --sidebar-w: 240px;
  --font-sans: 'Outfit', system-ui, sans-serif;
  --font-serif: 'Lora', Georgia, serif;
}
```

### Topbar (`app.html` inline + `css/style.css`)
```
.topbar { background: #166534 (solid verde escuro) }
.page-header-bar { background: linear-gradient(135deg, #163d35, #2f7f63, #b7db4a) }
.topbar-icon-btn { 36×36px, border-radius:12px, glass morphism }
.topbar-agent-btn { gradient verde premium }
.topbar-feedback-btn { gradient âmbar/laranja }
#logoutTopbarBtn { vermelho }
```

### Hierarquia de camadas CSS
1. Reset/base
2. Design tokens (variáveis)
3. Layout (sidebar, topbar, content)
4. Componentes globais (cards, modals, forms, buttons)
5. Módulos por página (`.page-*` prefixes)
6. Patches e overrides cronológicos (comentados com data)

---

## 11. PWA e Offline

```json
// manifest.json
{
  "name": "Family FinTrack",
  "start_url": "/app.html",
  "display": "standalone",
  "theme_color": "#1F6B4F",
  "background_color": "#ffffff"
}
```

**Service Worker (`sw.js`):**
- Cache de shell (app.html, css, js principais)
- Estratégia: Cache First para assets estáticos
- Network First para dados do Supabase
- Não usa `confirm()` nativo (incompatível com PWA em alguns contexts)

---

## 12. Segurança

### Row Level Security (RLS)
```sql
-- Cada tabela tem policies equivalentes a:
CREATE POLICY "families_isolation"
ON transactions FOR ALL
USING (family_id = ANY(ft_get_my_family_ids()));

-- Função com SECURITY DEFINER para evitar recursão infinita:
CREATE FUNCTION ft_get_my_family_ids()
RETURNS uuid[] LANGUAGE sql SECURITY DEFINER AS $$
  SELECT ARRAY(SELECT family_id FROM family_members WHERE user_id = auth.uid())
$$;
```

### Autenticação
- JWT com expiração + refresh token via Supabase Auth
- Senhas hasheadas com bcrypt
- `must_change_pwd` flag para redefinição obrigatória
- Aprovação manual por admin (`approved boolean`)

### Proteção de dados sensíveis
- Chaves de API (Gemini, EmailJS) armazenadas em `app_settings` no banco (nunca no código)
- `privacy_mode` oculta valores na UI sem alterar dados

---

## 13. Telemetria (`telemetry.js`, `app_telemetry`)

**Eventos coletados:**
- `page_view` — Navegação entre páginas
- `action` — Ações do usuário (criar TX, abrir modal, etc.)
- `error` — Erros capturados

**Dados por evento:** `session_id`, `user_id`, `family_id`, `device_type`, `device_os`, `device_browser`, `is_pwa`, `lang`, `payload jsonb`.

**Dashboard de telemetria:** Exclusivo para admins. Accessible via topbar icon → página `telemetry`.

---

## 14. Fluxo de Auto-registro de Programados

```
Cron/Edge Function (Supabase)
  → Lista scheduled_transactions onde status='active' e start_date <= hoje
  → Para cada um, verifica se já existe em scheduled_occurrences
  → Se não: cria transação em transactions
              cria registro em scheduled_occurrences (execution_status='executed')
              envia notificações (email/whatsapp/telegram)
              cria log em scheduled_run_logs
```

---

## 15. Importação (`import.js`, `import_ai.js`)

**Formatos suportados:** CSV (genérico), OFX, JSON (backup FinTrack).

**Pipeline:**
1. Parse do arquivo → staging tables (`import_staging_*`)
2. Revisão pelo usuário (match de contas, categorias, beneficiários)
3. Commit → transações definitivas

**AI-assisted import (`import_ai.js`):** Usa Gemini para mapear colunas automaticamente e sugerir categorias.

---

## 16. Backup e Restore (`backup.js`)

```javascript
// Exporta snapshot JSON completo:
{ accounts, categories, payees, transactions, scheduled, budgets, ... }

// Armazenado em app_backups com:
{ label, backup_type, payload jsonb, counts jsonb, size_kb }
```

---

## 17. Integrações de IA

### Google Gemini (`receipt_ai.js`, `ai_insights.js`, `agent.js`, `dreams.js`, `import_ai.js`)

```javascript
// Endpoint padrão:
const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

// Modelos usados:
// gemini-2.0-flash       (padrão — rápido)
// gemini-2.5-flash       (avançado)
// gemini-2.5-flash-lite  (leve)
// gemini-pro-vision      (OCR de recibos)

// Chave configurada em: app_settings['gemini_api_key']
// Constante: RECEIPT_AI_KEY_SETTING, RECEIPT_AI_MODEL
```

### EmailJS
```javascript
// EMAILJS_CONFIG em config.js:
{ serviceId, templateId, publicKey }
// Template variáveis: to_email, report_content, report_period, ...
```

### Frankfurter API (câmbio)
```
GET https://api.frankfurter.app/latest?from={currency}&to=BRL
GET https://api.frankfurter.app/{date}?from={currency}&to=BRL
```

---

## 18. Convenções de Código

### Nomenclatura de funções
- `load*()` — Busca dados do DB e atualiza state/UI
- `render*()` — Renderiza HTML a partir do state
- `open*Modal()` / `close*Modal()` — Gestão de modais
- `save*()` — Persiste dados no DB
- `_private()` — Funções internas (underscore prefix)
- `window.publicFn = function` — Expõe ao escopo global

### Padrão de queries Supabase
```javascript
// Sempre usar famQ() para isolar por família:
const { data, error } = await famQ(
  sb.from('transactions')
    .select('*, categories(name,color), payees(name)')
).gte('date', from).lte('date', to).order('date', { ascending: false });
```

### Rendering de HTML
```javascript
// Usar esc() para sanitizar strings antes de inserir em HTML
function esc(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')...
}
```

---

## 19. Variáveis de Ambiente / Configuração

Não há `.env` — configurações sensíveis são armazenadas em `app_settings` no Supabase:

| Chave | Tipo | Descrição |
|-------|------|-----------|
| `gemini_api_key` | string | Chave da API Gemini |
| `emailjs_service_id` | string | EmailJS service ID |
| `emailjs_template_id` | string | EmailJS template ID |
| `emailjs_public_key` | string | EmailJS public key |
| `dreams_enabled_{family_id}` | boolean | Módulo Sonhos ativo |
| `dash_prefs_{family_id}` | jsonb | Preferências do Dashboard |
| `px_hierarchy_{family_id}` | jsonb | Hierarquia de preços |
| `px_item_meta_{family_id}` | jsonb | Metadados de itens de preço |

O cliente Supabase é inicializado em `supabase.js`:
```javascript
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
// URL e ANON_KEY ficam em config.js (variáveis públicas, protegidas por RLS)
```

---

## 20. Deploy e Infraestrutura

| Componente | Tecnologia |
|-----------|-----------|
| Hosting front-end | Qualquer servidor estático (Vercel, Netlify, GitHub Pages, S3) |
| Banco de dados | Supabase (PostgreSQL 15) |
| Autenticação | Supabase Auth |
| Storage | Supabase Storage (`fintrack-attachments`) |
| Edge Functions | Supabase Edge Functions (auto-registro, notificações) |
| CDN | Via provedor de hosting |
| SSL/TLS | Gerenciado pelo provedor (Let's Encrypt ou equivalente) |

**Requisitos mínimos de deploy:**
- Supabase project com tabelas migradas
- `config.js` com `SUPABASE_URL` e `SUPABASE_ANON_KEY`
- Servidor HTTPS (PWA requer)
- Opcional: domínio customizado para `manifest.json` scope

---

*Documentação gerada em Março 2026 · Family FinTrack v2026.1*
