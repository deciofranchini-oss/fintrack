/* ═══════════════════════════════════════════════════════════════════════════
   FAMILY PREFERENCES SERVICE — Family FinTrack
   Fonte única de verdade para preferências e módulos da família.

   Arquitetura multi-tenant:
     • Cada família tem suas próprias preferências isoladas em `family_preferences`
     • Nenhum vazamento entre famílias (family_id é sempre filtrado)
     • Apenas OWNER pode modificar — outros membros podem ler

   Módulos suportados:
     ai_insights | ai_chat | debts | investments | grocery | prices

   Preferências gerais:
     language | ui (estrutura extensível)

   API pública:
     getFamilyPreferences()              → Promise<FamilyPrefs>
     updateFamilyPreferences(patch)      → Promise<void>    (OWNER only)
     isModuleEnabled(moduleName)         → bool (sync, usa cache)
     canModifyPreferences()              → bool (verifica role)
     onPrefsLoaded(cb)                   → registra callback

   Integração:
     • Chamado em bootApp() logo após loadAppSettings()
     • Eventos DOM: 'familyprefs:loaded' e 'familyprefs:changed'
     • Compatibilidade total com _familyFeaturesCache existente
═══════════════════════════════════════════════════════════════════════════ */

// ── Constantes ────────────────────────────────────────────────────────────────
const FP_MODULES = ['ai_insights', 'ai_chat', 'debts', 'investments', 'grocery', 'prices'];
const FP_CACHE_KEY = 'fintrack_fprefs_'; // + family_id
const FP_CACHE_TTL = 10 * 60 * 1000;    // 10 min

// ── Estado interno ────────────────────────────────────────────────────────────
let _fpCache     = null;  // FamilyPrefs object
let _fpFamilyId  = null;  // family_id do cache atual
let _fpReady     = false;
let _fpCallbacks = [];

/**
 * @typedef {Object} FamilyPrefs
 * @property {string}  family_id
 * @property {Object}  modules   - { ai_insights: bool, ... }
 * @property {string}  language  - idioma padrão da família
 * @property {Object}  ui        - preferências de UI (extensível)
 */

// ── API Pública ───────────────────────────────────────────────────────────────

/**
 * Carrega preferências da família (com cache de 10 min).
 * Sempre respeita family_id do usuário atual → sem vazamento entre famílias.
 * @returns {Promise<FamilyPrefs>}
 */
async function getFamilyPreferences() {
  const famId = _getFamId();
  if (!famId) return _fpDefaultPrefs(null);

  // Cache hit (mesma família, ainda válido)
  if (_fpCache && _fpFamilyId === famId) return _fpCache;

  // Tenta cache localStorage
  const cached = _fpReadLocalCache(famId);
  if (cached) {
    _fpCache    = cached;
    _fpFamilyId = famId;
    _fpSetReady();
    // Revalida em background sem bloquear
    _fpLoadFromDB(famId, true).catch(() => {});
    return _fpCache;
  }

  // Carrega do banco
  return await _fpLoadFromDB(famId, false);
}

/**
 * Atualiza preferências da família.
 * Apenas OWNER pode modificar — lança erro para outros roles.
 * @param {Partial<FamilyPrefs>} patch
 * @returns {Promise<void>}
 */
async function updateFamilyPreferences(patch) {
  if (!canModifyPreferences()) {
    throw new Error(t('auth.only_owners') || 'Apenas owners podem modificar preferências da família.');
  }

  const famId = _getFamId();
  if (!famId) throw new Error('family_id não disponível');

  // Merge local imediatamente (optimistic update)
  const current = _fpCache || _fpDefaultPrefs(famId);
  const updated  = _fpMerge(current, patch);
  _fpCache    = updated;
  _fpFamilyId = famId;
  _fpSaveLocalCache(famId, updated);

  // Sincroniza _familyFeaturesCache para compatibilidade com código legado
  _fpSyncLegacyCache(updated, famId);

  // Persiste no banco
  await _fpSaveToDB(famId, updated);

  // Dispara evento
  document.dispatchEvent(new CustomEvent('familyprefs:changed', { detail: { prefs: updated } }));
}

/**
 * Verifica se um módulo está ativo para a família atual (sync, usa cache).
 * Fallback seguro: retorna false se cache não disponível.
 * @param {'ai_insights'|'ai_chat'|'debts'|'investments'|'grocery'|'prices'} moduleName
 * @returns {boolean}
 */
function isModuleEnabled(moduleName) {
  if (!_fpCache) {
    // Fallback: tenta _familyFeaturesCache legado
    const famId = _getFamId();
    if (famId && window._familyFeaturesCache) {
      const legacyKey = `${moduleName}_enabled_${famId}`;
      const v = window._familyFeaturesCache[legacyKey];
      if (v !== undefined) return !!v;
    }
    // Módulos off por padrão (exceto backup/snapshot)
    return false;
  }
  return !!(_fpCache.modules?.[moduleName]);
}

/**
 * Verifica se o usuário atual pode modificar preferências da família.
 * Apenas OWNER (e admin global) pode modificar.
 * @returns {boolean}
 */
function canModifyPreferences() {
  const u = window.currentUser;
  if (!u) return false;
  return u.role === 'owner' || u.role === 'admin' || !!u.can_admin;
}

/**
 * Registra callback chamado quando as preferências estiverem prontas.
 * @param {Function} cb
 */
function onPrefsLoaded(cb) {
  if (_fpReady) { try { cb(_fpCache); } catch(e) {} return; }
  _fpCallbacks.push(cb);
}

/**
 * Força recarga das preferências (invalida cache).
 * @returns {Promise<FamilyPrefs>}
 */
async function reloadFamilyPreferences() {
  const famId = _getFamId();
  if (famId) _fpClearLocalCache(famId);
  _fpCache    = null;
  _fpFamilyId = null;
  _fpReady    = false;
  return await getFamilyPreferences();
}

// ── Internos ──────────────────────────────────────────────────────────────────

function _getFamId() {
  return window.currentUser?.family_id || state?.familyId || null;
}

function _fpDefaultPrefs(famId) {
  return {
    family_id: famId,
    modules: {
      ai_insights:  false,
      ai_chat:      false,
      debts:        false,
      investments:  false,
      grocery:      false,
      prices:       false,
    },
    language: 'pt',
    ui: {},
  };
}

function _fpMerge(base, patch) {
  const result = { ...base };
  if (patch.modules)  result.modules  = { ...base.modules,  ...patch.modules };
  if (patch.language) result.language = patch.language;
  if (patch.ui)       result.ui       = { ...base.ui, ...patch.ui };
  return result;
}

async function _fpLoadFromDB(famId, background) {
  try {
    if (!window.sb) return _fpDefaultPrefs(famId);

    // Tenta tabela dedicada `family_preferences` primeiro
    let prefs = null;
    try {
      const { data, error } = await sb
        .from('family_preferences')
        .select('*')
        .eq('family_id', famId)
        .maybeSingle();
      if (!error && data) prefs = _fpRowToPrefs(data, famId);
    } catch(_) {}

    if (!prefs) {
      // Fallback: monta preferências a partir de app_settings (legado)
      prefs = await _fpLoadFromLegacySettings(famId);
    }

    _fpCache    = prefs;
    _fpFamilyId = famId;
    _fpSaveLocalCache(famId, prefs);
    _fpSyncLegacyCache(prefs, famId);

    if (!background) _fpSetReady();
    if (!background) {
      document.dispatchEvent(new CustomEvent('familyprefs:loaded', { detail: { prefs } }));
    }

    return prefs;
  } catch(e) {
    console.warn('[family_prefs] Load failed:', e.message);
    const def = _fpDefaultPrefs(famId);
    _fpCache    = def;
    _fpFamilyId = famId;
    if (!background) _fpSetReady();
    return def;
  }
}

function _fpRowToPrefs(row, famId) {
  return {
    family_id: famId,
    modules: {
      ai_insights:  !!(row.module_ai_insights),
      ai_chat:      !!(row.module_ai_chat),
      debts:        !!(row.module_debts),
      investments:  !!(row.module_investments),
      grocery:      !!(row.module_grocery),
      prices:       !!(row.module_prices),
    },
    language: row.language || 'pt',
    ui:       (typeof row.ui_settings === 'object' && row.ui_settings) ? row.ui_settings : {},
  };
}

async function _fpLoadFromLegacySettings(famId) {
  const prefs = _fpDefaultPrefs(famId);
  try {
    const moduleKeys = FP_MODULES.map(m => `${m}_enabled_${famId}`);
    const { data } = await sb
      .from('app_settings')
      .select('key, value')
      .in('key', moduleKeys);

    if (data) {
      data.forEach(row => {
        const mod = row.key.replace(`_enabled_${famId}`, '');
        if (FP_MODULES.includes(mod)) {
          prefs.modules[mod] = (row.value === true || row.value === 'true');
        }
      });
    }
    // Also check localStorage as last resort
    FP_MODULES.forEach(mod => {
      const lsKey = `${mod}_enabled_${famId}`;
      const lsVal = localStorage.getItem(lsKey);
      if (lsVal !== null && !data?.find(r => r.key === lsKey)) {
        prefs.modules[mod] = (lsVal === 'true');
      }
    });
  } catch(e) {
    console.warn('[family_prefs] Legacy load failed:', e.message);
  }
  return prefs;
}

async function _fpSaveToDB(famId, prefs) {
  if (!window.sb) return;
  try {
    // Try dedicated table first
    const row = {
      family_id:          famId,
      module_ai_insights: !!(prefs.modules?.ai_insights),
      module_ai_chat:     !!(prefs.modules?.ai_chat),
      module_debts:       !!(prefs.modules?.debts),
      module_investments: !!(prefs.modules?.investments),
      module_grocery:     !!(prefs.modules?.grocery),
      module_prices:      !!(prefs.modules?.prices),
      language:           prefs.language || 'pt',
      ui_settings:        prefs.ui || {},
      updated_at:         new Date().toISOString(),
    };
    const { error } = await sb
      .from('family_preferences')
      .upsert(row, { onConflict: 'family_id' });

    if (!error) {
      // Also sync to legacy app_settings for backwards compatibility
      await _fpSyncToLegacySettings(famId, prefs);
      return;
    }
  } catch(_) {}

  // Fallback: save to legacy app_settings
  await _fpSyncToLegacySettings(famId, prefs);
}

async function _fpSyncToLegacySettings(famId, prefs) {
  try {
    const tasks = FP_MODULES.map(mod =>
      typeof saveAppSetting === 'function'
        ? saveAppSetting(`${mod}_enabled_${famId}`, !!(prefs.modules?.[mod]))
        : Promise.resolve()
    );
    await Promise.all(tasks);
  } catch(e) {
    console.warn('[family_prefs] Legacy sync failed:', e.message);
  }
}

/**
 * Mantém `_familyFeaturesCache` em sincronismo para código legado
 * que ainda referencia window._familyFeaturesCache diretamente.
 */
function _fpSyncLegacyCache(prefs, famId) {
  if (!window._familyFeaturesCache) window._familyFeaturesCache = {};
  FP_MODULES.forEach(mod => {
    const key = `${mod}_enabled_${famId}`;
    window._familyFeaturesCache[key] = !!(prefs.modules?.[mod]);
    // Also persist to localStorage for offline resilience
    try { localStorage.setItem(key, String(!!(prefs.modules?.[mod]))); } catch(_) {}
  });
}

function _fpSetReady() {
  if (_fpReady) return;
  _fpReady = true;
  _fpCallbacks.forEach(cb => { try { cb(_fpCache); } catch(e) {} });
  _fpCallbacks = [];
}

// ── Local Cache (localStorage) ────────────────────────────────────────────────

function _fpReadLocalCache(famId) {
  try {
    const raw = localStorage.getItem(FP_CACHE_KEY + famId);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > FP_CACHE_TTL) {
      localStorage.removeItem(FP_CACHE_KEY + famId);
      return null;
    }
    return data;
  } catch { return null; }
}

function _fpSaveLocalCache(famId, prefs) {
  try {
    localStorage.setItem(FP_CACHE_KEY + famId, JSON.stringify({ ts: Date.now(), data: prefs }));
  } catch(e) { console.warn('[family_prefs] Cache write failed:', e.message); }
}

function _fpClearLocalCache(famId) {
  try { localStorage.removeItem(FP_CACHE_KEY + famId); } catch(_) {}
}

// ── Módulo guard helper (acesso a rotas/seções) ───────────────────────────────

/**
 * Verifica se módulo está ativo. Se não, mostra toast e retorna false.
 * Usar como guard em funções que dependem de módulo.
 * @param {string} moduleName
 * @param {string} [label]  - nome amigável para o toast
 * @returns {boolean}
 */
function assertModuleEnabled(moduleName, label) {
  if (isModuleEnabled(moduleName)) return true;
  const name = label || moduleName;
  if (typeof toast === 'function') {
    toast(`Módulo ${name} não está ativo para sua família.`, 'warning');
  }
  return false;
}

// ── SQL migration helper (output only — não executa) ─────────────────────────
// Para referência: criar tabela no Supabase
// CREATE TABLE IF NOT EXISTS family_preferences (
//   family_id         UUID PRIMARY KEY REFERENCES families(id) ON DELETE CASCADE,
//   module_ai_insights BOOLEAN DEFAULT FALSE,
//   module_ai_chat     BOOLEAN DEFAULT FALSE,
//   module_debts       BOOLEAN DEFAULT FALSE,
//   module_investments BOOLEAN DEFAULT FALSE,
//   module_grocery     BOOLEAN DEFAULT FALSE,
//   module_prices      BOOLEAN DEFAULT FALSE,
//   language           TEXT DEFAULT 'pt',
//   ui_settings        JSONB DEFAULT '{}',
//   created_at         TIMESTAMPTZ DEFAULT NOW(),
//   updated_at         TIMESTAMPTZ DEFAULT NOW()
// );
// ALTER TABLE family_preferences ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "family_read"   ON family_preferences FOR SELECT USING (family_id = (SELECT family_id FROM app_users WHERE id = auth.uid()));
// CREATE POLICY "owner_write"   ON family_preferences FOR ALL USING (
//   family_id = (SELECT family_id FROM app_users WHERE id = auth.uid())
//   AND (SELECT role FROM app_users WHERE id = auth.uid()) IN ('owner','admin')
// );

// ── Expose globalmente ────────────────────────────────────────────────────────
window.getFamilyPreferences    = getFamilyPreferences;
window.updateFamilyPreferences = updateFamilyPreferences;
window.isModuleEnabled         = isModuleEnabled;
window.canModifyPreferences    = canModifyPreferences;
window.onPrefsLoaded           = onPrefsLoaded;
window.reloadFamilyPreferences = reloadFamilyPreferences;
window.assertModuleEnabled     = assertModuleEnabled;
