/* admin.js — Minimal stub: unique helpers not in auth.js.
 * All user/family admin functions live in auth.js (loaded before this file).
 * This file adds only what auth.js doesn't have.
 */

// ── Feature-flag toggle per family ────────────────────────────────────────
// Called from family card checkboxes rendered by loadFamiliesList() (auth.js).
async function toggleFamilyFeature(familyId, key, enabled) {
  if (!window._familyFeaturesCache) window._familyFeaturesCache = {};
  window._familyFeaturesCache[key] = enabled;
  try { localStorage.setItem(key, String(enabled)); } catch {}

  await saveAppSetting(key, enabled);
  toast(enabled ? '✓ Módulo ativado' : 'Módulo desativado', 'success');

  if (key.startsWith('prices_enabled_'))      { try { await applyPricesFeature?.();      } catch {} }
  if (key.startsWith('grocery_enabled_'))     { try { await applyGroceryFeature?.();     } catch {} }
  if (key.startsWith('investments_enabled_')) { try { await applyInvestmentsFeature?.(); } catch {} }
  await loadFamiliesList();
}

// ── Pre-load feature flags before rendering families ─────────────────────
async function _loadFamilyFeatures(families) {
  window._familyFeaturesCache = window._familyFeaturesCache || {};
  const keys = [];
  families.forEach(f => {
    keys.push('prices_enabled_'+f.id, 'grocery_enabled_'+f.id,
              'investments_enabled_'+f.id,
              'backup_enabled_'+f.id, 'snapshot_enabled_'+f.id);
  });
  try {
    const { data } = await sb.from('app_settings')
      .select('key,value').in('key', keys);
    (data||[]).forEach(row => {
      window._familyFeaturesCache[row.key] = (row.value === true || row.value === 'true');
    });
  } catch {}
}
