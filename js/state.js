/**
 * Global application state — fonte única de verdade para o estado global.
 * Deve ser carregado ANTES de qualquer outro módulo local.
 *
 * Usa `var` para criar binding verdadeiramente global acessível como `state`
 * em todos os <script> clássicos, sem depender de import/export.
 *
 * Combina:
 *  - Campos de domínio (contas, categorias, transações, etc.)
 *  - Campos de UI e paginação (txPage, txFilter, currentPage, etc.)
 *  - Campos de cache e preferências do usuário
 */
// eslint-disable-next-line no-var
var state = window.state || {
  // ── Auth / perfil ─────────────────────────────────────────────
  user:               null,
  profile:            null,
  familyId:           null,

  // ── Dados de domínio (preenchidos pelo DB / módulos) ──────────
  accounts:           [],
  accountGroups:      [],
  groups:             [],   // alias de accountGroups (legado — mantido para compatibilidade)
  categories:         [],
  payees:             [],
  transactions:       [],
  scheduled:          [],
  budgets:            [],

  // ── Paginação e ordenação de transações ───────────────────────
  txPage:             0,
  txPageSize:         50,
  txTotal:            0,
  txSortField:        'date',
  txSortAsc:          false,
  txFilter:           { search: '', month: '', account: '', type: '', status: '' },
  txView:             'flat',

  // ── Navegação ─────────────────────────────────────────────────
  currentPage:        'dashboard',

  // ── Gráficos ──────────────────────────────────────────────────
  chartInstances:     {},

  // ── UI ────────────────────────────────────────────────────────
  ui:                 { currentPage: 'dashboard' },
  privacyMode:        false,

  // ── Modo Reconciliação ────────────────────────────────────────
  reconcileMode:      false,
  reconcileChecked:   new Set(), // IDs marcados nesta sessão

  // ── Preferências e caches auxiliares ─────────────────────────
  prefs:              {},
  lastCategoryByPayee:{},
  cache:              {},
  flags:              {},
};

window.state = state;

// Garantir que todos os containers existam mesmo em reloads parciais
state.accounts            = state.accounts            || [];
state.accountGroups       = state.accountGroups       || [];
state.groups              = state.groups              || [];
state.categories          = state.categories          || [];
state.payees              = state.payees              || [];
state.transactions        = state.transactions        || [];
state.scheduled           = state.scheduled           || [];
state.budgets             = state.budgets             || [];
state.txFilter            = state.txFilter            || { search: '', month: '', account: '', type: '', status: '' };
state.chartInstances      = state.chartInstances      || {};
state.ui                  = state.ui                  || { currentPage: 'dashboard' };
state.prefs               = state.prefs               || {};
state.lastCategoryByPayee = state.lastCategoryByPayee || {};
state.cache               = state.cache               || {};
state.flags               = state.flags               || {};


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
