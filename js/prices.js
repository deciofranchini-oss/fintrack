/* ═══════════════════════════════════════════════════════════════════════════
   PRICES.JS — Gerenciamento de Preços
   Histórico de preços unitários por item × estabelecimento × família.
   Ativado por família pelo admin global no painel de usuários.

   ESTRUTURA DE DADOS:
     price_items    — produto/item (nome, unidade, categoria)
     price_stores   — estabelecimento (nome, endereço, payee_id, contato)
     price_history  — registro de preço: item + store + data + qty + unit_price
═══════════════════════════════════════════════════════════════════════════ */

const _px = {
  items:         [],
  stores:        [],
  activeItemId:  null,
  search:        '',
  catFilter:     '',
  subcatFilter:  '',   // filtro subcategoria de preços
  typeFilter:    '',   // filtro tipo dentro da subcategoria
  storeFilter:   '',
  pidStoreFilter: '',
  groupBy:       '',   // '' | 'cat' | 'store' | 'subcat'
};

// ─────────────────────────────────────────────────────────────────────────────
// SISTEMA DE CATEGORIAS HIERÁRQUICAS EXCLUSIVAS DE PREÇOS
// Estrutura: Categoria App → Subcategoria Preços → Tipo
// Persistência exclusivamente via Supabase (app_settings + price_items)
//
// app_settings keys:
//   px_hierarchy_{family_id}  → JSON com definição de subcategorias e tipos
//   px_item_meta_{family_id}  → JSON com mapeamento itemId → px_subcat value
//
// Formato px_subcat value: "catId|__|subcatKey|__|typeLabel"
// ─────────────────────────────────────────────────────────────────────────────

const __SEP__ = '|__|';

// Cache em memória para a sessão (evita round-trips repetidos)
let _pxHierCache = null;      // { [catId|'__none__']: { subcategories: { [key]: { label, types[] } } } }
let _pxItemMetaCache = null;  // { [itemId]: "catId|__|subcatKey|__|typeLabel" }
let _pxHierDirty = false;
let _pxItemMetaDirty = false;

function _pxHierSettingKey() { return _famId() ? `px_hierarchy_${_famId()}` : null; }
function _pxItemMetaKey()    { return _famId() ? `px_item_meta_${_famId()}` : null; }

// Carrega hierarquia do Supabase (app_settings) — com cache em memória
async function _pxHierLoad() {
  if (_pxHierCache !== null) return _pxHierCache;
  const key = _pxHierSettingKey();
  if (!key) { _pxHierCache = {}; return {}; }
  try {
    const { data } = await sb.from('app_settings').select('value').eq('key', key).maybeSingle();
    const raw = data?.value;
    _pxHierCache = (raw && typeof raw === 'object') ? raw : (raw ? JSON.parse(raw) : {});
  } catch { _pxHierCache = {}; }
  return _pxHierCache;
}

// Persiste hierarquia no Supabase
async function _pxHierSave() {
  const key = _pxHierSettingKey();
  if (!key || !_pxHierCache) return;
  try {
    await sb.from('app_settings').upsert({ key, value: _pxHierCache }, { onConflict: 'key' });
    _pxHierDirty = false;
  } catch(e) { console.warn('[px] hier save error:', e.message); }
}

// Carrega mapeamento item→subcat do Supabase
async function _pxItemMetaLoad() {
  if (_pxItemMetaCache !== null) return _pxItemMetaCache;
  const key = _pxItemMetaKey();
  if (!key) { _pxItemMetaCache = {}; return {}; }
  try {
    const { data } = await sb.from('app_settings').select('value').eq('key', key).maybeSingle();
    const raw = data?.value;
    _pxItemMetaCache = (raw && typeof raw === 'object') ? raw : (raw ? JSON.parse(raw) : {});
  } catch { _pxItemMetaCache = {}; }
  return _pxItemMetaCache;
}

// Persiste mapeamento item→subcat no Supabase
async function _pxItemMetaSave() {
  const key = _pxItemMetaKey();
  if (!key || !_pxItemMetaCache) return;
  try {
    await sb.from('app_settings').upsert({ key, value: _pxItemMetaCache }, { onConflict: 'key' });
    _pxItemMetaDirty = false;
  } catch(e) { console.warn('[px] item meta save error:', e.message); }
}

// Invalida caches (chamado ao trocar de família ou recarregar)
function _pxInvalidateCaches() {
  _pxHierCache = null;
  _pxItemMetaCache = null;
}

// Retorna lista de subcategorias para um catId (ou __none__) — síncrono após load
function _pxSubcatsForCat(catId) {
  const h = _pxHierCache || {};
  const key = catId || '__none__';
  return Object.entries((h[key]?.subcategories) || {})
    .map(([k, v]) => ({ key: k, label: v.label, types: v.types || [] }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// Retorna tipos para catId + subcatKey
function _pxTypesFor(catId, subcatKey) {
  const h = _pxHierCache || {};
  const key = catId || '__none__';
  return (h[key]?.subcategories?.[subcatKey]?.types || []).sort();
}

// Adiciona subcategoria e persiste no Supabase
async function _pxAddSubcat(catId, label) {
  if (!_pxHierCache) await _pxHierLoad();
  const key = catId || '__none__';
  if (!_pxHierCache[key]) _pxHierCache[key] = { subcategories: {} };
  if (!_pxHierCache[key].subcategories) _pxHierCache[key].subcategories = {};
  const subcatKey = label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'');
  if (!subcatKey) return null;
  if (!_pxHierCache[key].subcategories[subcatKey]) {
    _pxHierCache[key].subcategories[subcatKey] = { label, types: [] };
  }
  await _pxHierSave();
  return subcatKey;
}

// Adiciona tipo e persiste
async function _pxAddType(catId, subcatKey, typeLabel) {
  if (!_pxHierCache) await _pxHierLoad();
  const key = catId || '__none__';
  if (!_pxHierCache[key]?.subcategories?.[subcatKey]) return;
  const types = _pxHierCache[key].subcategories[subcatKey].types;
  if (!types.includes(typeLabel)) types.push(typeLabel);
  await _pxHierSave();
}

// Popula select de subcategorias no filtro da página
function _populatePxSubcatFilter() {
  const sel = document.getElementById('pxSubcatFilter');
  if (!sel) return;
  const catId = _px.catFilter || null;
  const subcats = _pxSubcatsForCat(catId);
  sel.innerHTML = '<option value="">Todas as subcategorias</option>' +
    subcats.map(s => `<option value="${s.key}${__SEP__}${catId||''}">${esc(s.label)}</option>`).join('');
  sel.value = '';
  _px.subcatFilter = '';
  _populatePxTypeFilter();
}

// Popula select de tipos no filtro
function _populatePxTypeFilter() {
  const sel = document.getElementById('pxTypeFilter');
  if (!sel) return;
  const subcatVal = document.getElementById('pxSubcatFilter')?.value || '';
  if (!subcatVal) {
    sel.innerHTML = '<option value="">Todos os tipos</option>';
    sel.value = '';
    _px.typeFilter = '';
    sel.disabled = true;
    return;
  }
  const [subcatKey, catId] = subcatVal.split(__SEP__);
  const types = _pxTypesFor(catId || null, subcatKey);
  sel.disabled = types.length === 0;
  sel.innerHTML = '<option value="">Todos os tipos</option>' +
    types.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  sel.value = '';
  _px.typeFilter = '';
}

// Popula subcategorias no formulário de item
function _pxPopulateFormSubcats(catId) {
  const sel = document.getElementById('pifSubcat');
  if (!sel) return;
  const subcats = _pxSubcatsForCat(catId);
  sel.innerHTML = '<option value="">— Nenhuma —</option>' +
    subcats.map(s => `<option value="${s.key}">${esc(s.label)}</option>`).join('') +
    '<option value="__new__">+ Nova subcategoria…</option>';
}

// Popula tipos no formulário de item
function _pxPopulateFormTypes(catId, subcatKey) {
  const sel = document.getElementById('pifType');
  if (!sel) return;
  if (!subcatKey || subcatKey === '__new__') {
    sel.innerHTML = '<option value="">— Nenhum —</option>';
    sel.disabled = true;
    return;
  }
  const types = _pxTypesFor(catId, subcatKey);
  sel.disabled = false;
  sel.innerHTML = '<option value="">— Nenhum —</option>' +
    types.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('') +
    '<option value="__new__">+ Novo tipo…</option>';
}

// Handler: mudança de categoria no formulário
function _pxFormCatChanged() {
  const catId = document.getElementById('pifCategory')?.value || null;
  _pxPopulateFormSubcats(catId);
  _pxPopulateFormTypes(catId, null);
}

// Handler: mudança de subcategoria no formulário
async function _pxFormSubcatChanged() {
  const catId = document.getElementById('pifCategory')?.value || null;
  const subcatSel = document.getElementById('pifSubcat');
  const subcatKey = subcatSel?.value || null;
  if (subcatKey === '__new__') {
    const nome = prompt('Nome da nova subcategoria (ex: Bebidas, Laticínios, Combustível):');
    if (!nome?.trim()) { subcatSel.value = ''; return; }
    const key = await _pxAddSubcat(catId, nome.trim());
    _pxPopulateFormSubcats(catId);
    if (key) subcatSel.value = key;
  }
  _pxPopulateFormTypes(catId, subcatSel?.value || null);
}

// Handler: mudança de tipo no formulário
async function _pxFormTypeChanged() {
  const catId    = document.getElementById('pifCategory')?.value || null;
  const subcatSel = document.getElementById('pifSubcat');
  const typeSel   = document.getElementById('pifType');
  const subcatKey = subcatSel?.value || null;
  if (typeSel?.value === '__new__') {
    const nome = prompt('Nome do novo tipo (ex: Refrigerante, Gasolina, Desnatado):');
    if (!nome?.trim()) { typeSel.value = ''; return; }
    await _pxAddType(catId, subcatKey, nome.trim());
    _pxPopulateFormTypes(catId, subcatKey);
    typeSel.value = nome.trim();
  }
}

// Retorna hierarquia de um item (lê do cache _pxItemMetaCache)
function _pxItemHier(item) {
  const stored = (_pxItemMetaCache || {})[item.id] || null;
  if (!stored) return null;
  const parts = stored.split(__SEP__);
  if (parts.length < 2) return null;
  const [catId, subcatKey, typeLabel] = parts;
  const h = _pxHierCache || {};
  const groupKey = catId || '__none__';
  const subcat = h[groupKey]?.subcategories?.[subcatKey];
  if (!subcat) return null;
  return { catId, subcatKey, subcatLabel: subcat.label, typeLabel: typeLabel || null };
}

// Constrói o valor de px_subcat
function _pxBuildHierValue(catId, subcatKey, typeLabel) {
  if (!subcatKey) return null;
  return [catId || '', subcatKey, typeLabel || ''].join(__SEP__);
}

// Filtra items pela hierarquia selecionada
function _pxApplyHierFilter(items) {
  const subcatVal = document.getElementById('pxSubcatFilter')?.value || '';
  const typeVal   = document.getElementById('pxTypeFilter')?.value || '';
  if (!subcatVal && !typeVal) return items;
  let filtered = items;
  if (subcatVal) {
    const [subcatKey, catId] = subcatVal.split(__SEP__);
    filtered = filtered.filter(item => {
      const hier = _pxItemHier(item);
      if (!hier) return false;
      const catMatch = !catId || hier.catId === catId;
      return catMatch && hier.subcatKey === subcatKey;
    });
  }
  if (typeVal) {
    filtered = filtered.filter(item => _pxItemHier(item)?.typeLabel === typeVal);
  }
  return filtered;
}

// ─────────────────────────────────────────────────────────────────────────────
// FEATURE FLAG
// ─────────────────────────────────────────────────────────────────────────────

async function isPricesEnabled() {
  const famId = currentUser?.family_id;
  if (!famId) return false;
  const cacheKey = 'prices_enabled_' + famId;
  if (window._familyFeaturesCache && cacheKey in window._familyFeaturesCache) {
    return !!window._familyFeaturesCache[cacheKey];
  }
  const val = await getAppSetting(cacheKey, false);
  return val === true || val === 'true';
}

function _syncModulesSection() {
  const sec = document.getElementById('modulesNavSection');
  if (!sec) return;
  const anyOn = ['groceryNav','pricesNav','investmentsNav','aiInsightsNav','debtsNav'].some(id => {
    const el = document.getElementById(id);
    return el && el.style.display !== 'none';
  });
  sec.style.display = anyOn ? '' : 'none';
}

async function applyPricesFeature() {
  const on = await isPricesEnabled();
  const navEl = document.getElementById('pricesNav');
  if (navEl) { navEl.style.display = on ? '' : 'none'; navEl.dataset.featureControlled = '1'; }
  const txBtn = document.getElementById('txRegisterPricesBtn');
  if (txBtn) txBtn.style.display = on ? '' : 'none';
  _syncModulesSection();
}

async function toggleFamilyPrices(familyId, enabled) {
  await saveAppSetting('prices_enabled_' + familyId, enabled);
  if (typeof applyPricesFeature === 'function') applyPricesFeature().catch(() => {});
  toast(enabled ? '✓ Gestão de Preços ativada' : 'Gestão de Preços desativada', 'success');
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE INIT & DATA LOAD
// ─────────────────────────────────────────────────────────────────────────────

async function applyGroceryFeature() {
  const famId = currentUser?.family_id;
  if (!famId) return;
  const on = await isGroceryEnabled();
  const navEl = document.getElementById('groceryNav');
  if (navEl) { navEl.style.display = on ? '' : 'none'; navEl.dataset.featureControlled = '1'; }
  _syncModulesSection();
}

async function isGroceryEnabled() {
  const famId = currentUser?.family_id;
  if (!famId) return false;
  const cacheKey = 'grocery_enabled_' + famId;
  if (window._familyFeaturesCache && cacheKey in window._familyFeaturesCache)
    return !!window._familyFeaturesCache[cacheKey];
  const local = localStorage.getItem(cacheKey);
  if (local !== null) return local === 'true';
  const val = await getAppSetting(cacheKey, false);
  return val === true || val === 'true';
}

async function initPricesPage() {
  const on = await isPricesEnabled();
  if (!on) { toast('Recurso de preços não está ativo para esta família.', 'warning'); navigate('dashboard'); return; }
  _px.search = _px.catFilter = _px.storeFilter = _px.subcatFilter = _px.typeFilter = '';
  const searchEl = document.getElementById('pricesSearch');
  if (searchEl) searchEl.value = '';
  // Invalida caches para recarregar dados frescos do Supabase
  _pxInvalidateCaches();
  // Carrega dados e caches de hierarquia em paralelo
  await Promise.all([
    _loadPricesData(),
    _pxHierLoad(),
    _pxItemMetaLoad(),
  ]);
  _populatePricesCatFilter();
  _populatePricesStoreFilter();
  _populatePxSubcatFilter();
  _renderPricesPage();
}

function _populatePricesCatFilter() {
  const sel = document.getElementById('pricesCatFilter');
  if (!sel) return;
  // Only show categories that have at least one price_item record
  const usedCatIds = new Set(_px.items.map(i => i.category_id).filter(Boolean));
  const cats = (state.categories || [])
    .filter(c => c.type !== 'income' && usedCatIds.has(c.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  sel.innerHTML = '<option value="">Todas as categorias</option>' +
    cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

function _populatePricesStoreFilter() {
  const sel = document.getElementById('pricesStoreFilter');
  if (!sel) return;
  sel.innerHTML = '<option value="">Todos os estabelecimentos</option>' +
    _px.stores.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
}

async function _loadPricesData() {
  const fid = _famId();
  if (!fid) return;
  const [itemsRes, storesRes] = await Promise.all([
    sb.from('price_items')
      .select('id, name, description, unit, category_id, avg_price, last_price, record_count, categories(name)')
      .eq('family_id', fid).order('name'),
    sb.from('price_stores')
      .select('id, name, address, city, state_uf, zip_code, phone, cnpj, payee_id, payees(id, name, phone, address, city, state_uf, cnpj_cpf, whatsapp, website)')
      .eq('family_id', fid).order('name'),
  ]);
  _px.items  = itemsRes.data  || [];
  _px.stores = storesRes.data || [];
}

function _famId() { return currentUser?.family_id || null; }

// ─────────────────────────────────────────────────────────────────────────────
// RENDER PRICES PAGE
// ─────────────────────────────────────────────────────────────────────────────

function _renderPricesPage() {
  const listEl = document.getElementById('pricesItemList');
  if (!listEl) return;
  let items = _px.items;
  if (_px.search) {
    const q = _px.search.toLowerCase();
    items = items.filter(i => i.name.toLowerCase().includes(q) || (i.description||'').toLowerCase().includes(q));
  }
  if (_px.catFilter)   items = items.filter(i => i.category_id === _px.catFilter);
  // Filtros hierárquicos exclusivos de preços
  items = _pxApplyHierFilter(items);

  const countEl = document.getElementById('pricesCount');
  if (countEl) countEl.textContent = items.length + (items.length !== 1 ? ' itens' : ' item');

  // ── Summary hero strip ────────────────────────────────────────────────
  const heroEl = document.getElementById('pricesHero');
  if (heroEl && _px.items.length) {
    const allWithPrice  = [..._px.items].filter(i => i.last_price != null);
    const totalItems    = _px.items.length;
    const totalRecords  = _px.items.reduce((s, i) => s + (i.record_count || 0), 0);
    const sorted        = [...allWithPrice].sort((a,b) => a.last_price - b.last_price);
    const cheapest      = sorted[0];
    const priciest      = sorted[sorted.length - 1];
    heroEl.innerHTML = `
      <div class="px-hero-kpi">
        <div class="px-hero-kpi-val">${totalItems}</div>
        <div class="px-hero-kpi-lbl">Itens cadastrados</div>
      </div>
      <div class="px-hero-kpi">
        <div class="px-hero-kpi-val">${totalRecords}</div>
        <div class="px-hero-kpi-lbl">Registros de preço</div>
      </div>
      ${cheapest ? `<div class="px-hero-kpi">
        <div class="px-hero-kpi-val" style="color:var(--green)">${fmt(cheapest.last_price)}</div>
        <div class="px-hero-kpi-lbl">Mais barato · ${esc(cheapest.name)}</div>
      </div>` : ''}
      ${priciest && priciest !== cheapest ? `<div class="px-hero-kpi">
        <div class="px-hero-kpi-val">${fmt(priciest.last_price)}</div>
        <div class="px-hero-kpi-lbl">Mais caro · ${esc(priciest.name)}</div>
      </div>` : ''}
    `;
    heroEl.style.display = 'grid';
  }

  if (!items.length) {
    listEl.innerHTML = `
      <div class="prices-empty">
        <div style="font-size:2.8rem;margin-bottom:12px">🏷️</div>
        <div style="font-weight:700;font-size:.95rem;margin-bottom:6px">Nenhum item encontrado</div>
        <div style="font-size:.82rem;color:var(--muted);max-width:280px;text-align:center;line-height:1.55">
          Tente ajustar os filtros ou cadastre novos itens.
        </div>
      </div>`;
    return;
  }
  if (_px.groupBy) {
    if (_px.groupBy === 'subcat') { _renderPricesGroupedBySubcat(items); return; }
    _renderPricesGrouped(items);
    return;
  }
  listEl.innerHTML = `<div class="px-grid">` + items.map(_pxCardHtml).join('') + `</div>`;
}

function pricesSearch(val)      { _px.search = val;      _renderPricesPage(); }
function pricesCatFilter(val)   {
  _px.catFilter = val;
  _populatePxSubcatFilter();
  _renderPricesPage();
}
function pricesStoreFilter(val) { _px.storeFilter = val; _renderPricesPage(); }
function pricesSubcatFilter(val) {
  _px.subcatFilter = val;
  _populatePxTypeFilter();
  _renderPricesPage();
}
function pricesTypeFilter(val)  { _px.typeFilter = val; _renderPricesPage(); }
function pricesSetGroup(val) {
  _px.groupBy = val;
  ['pxGroupNone','pxGroupCat','pxGroupStore','pxGroupSubcat'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  const map = { '': 'pxGroupNone', cat: 'pxGroupCat', store: 'pxGroupStore', subcat: 'pxGroupSubcat' };
  const active = document.getElementById(map[val]);
  if (active) active.classList.add('active');
  _renderPricesPage();
}

function _renderPricesGrouped(items) {
  const listEl = document.getElementById('pricesItemList');
  if (!listEl) return;

  if (_px.groupBy === 'cat') {
    // Group by category name
    const groups = {};
    items.forEach(item => {
      const key = item.categories?.name || 'Sem categoria';
      const color = item.categories?.color || 'var(--accent)';
      if (!groups[key]) groups[key] = { color, items: [], total: 0 };
      groups[key].items.push(item);
      groups[key].total += item.record_count || 0;
    });
    listEl.innerHTML = Object.entries(groups)
      .sort((a,b) => a[0].localeCompare(b[0]))
      .map(([gName, g]) => `
        <div class="px-group-section">
          <div class="px-group-header">
            <span class="px-group-dot" style="background:${g.color}"></span>
            <span class="px-group-label">${esc(gName)}</span>
            <span class="px-group-count">${g.items.length} ${g.items.length !== 1 ? 'itens' : 'item'}</span>
          </div>
          <div class="px-grid">${g.items.map(_pxCardHtml).join('')}</div>
        </div>`).join('');

  } else if (_px.groupBy === 'store') {
    // Group by last recorded store — uses price_history to find recent store
    // Since items don't carry store directly, group by avg cheapest store from history
    // Fallback: group items by name prefix (letter) or show all under store filter
    // We load per-item store data lazily — for now group by store from _px.stores filter
    const storeId = _px.storeFilter;
    if (storeId) {
      // If a store filter is active, show items that have history in that store
      // (already filtered) grouped under that store header
      const store = _px.stores.find(s => s.id === storeId);
      listEl.innerHTML = `
        <div class="px-group-section">
          <div class="px-group-header">
            <span class="px-group-dot" style="background:var(--accent)">🏪</span>
            <span class="px-group-label">${esc(store?.name || 'Estabelecimento')}</span>
            <span class="px-group-count">${items.length} ${items.length !== 1 ? 'itens' : 'item'}</span>
          </div>
          <div class="px-grid">${items.map(_pxCardHtml).join('')}</div>
        </div>`;
    } else {
      // No store filter: group alphabetically A-Z under store headers from history
      // Load all history grouped by store (batch query)
      _renderPricesGroupedByStore(items, listEl);
      return;
    }
  }
}

async function _renderPricesGroupedByStore(items, listEl) {
  if (!items.length) { listEl.innerHTML = ''; return; }
  const fid = _famId();
  if (!fid) return;
  // Fetch last store per item from price_history
  const itemIds = items.map(i => i.id);
  const { data: hist } = await sb.from('price_history')
    .select('item_id, store_id')
    .eq('family_id', fid)
    .in('item_id', itemIds)
    .order('purchased_at', { ascending: false });

  // Map item_id → most recent store_id
  const itemToStore = {};
  (hist || []).forEach(h => {
    if (!itemToStore[h.item_id]) itemToStore[h.item_id] = h.store_id;
  });

  const storeMap = Object.fromEntries(_px.stores.map(s => [s.id, s]));
  const groups = {};
  items.forEach(item => {
    const storeId = itemToStore[item.id];
    const store = storeId ? storeMap[storeId] : null;
    const key = store?.name || 'Sem estabelecimento';
    if (!groups[key]) groups[key] = { items: [] };
    groups[key].items.push(item);
  });

  listEl.innerHTML = Object.entries(groups)
    .sort((a,b) => a[0].localeCompare(b[0]))
    .map(([gName, g]) => `
      <div class="px-group-section">
        <div class="px-group-header">
          <span style="font-size:.95rem">🏪</span>
          <span class="px-group-label">${esc(gName)}</span>
          <span class="px-group-count">${g.items.length} ${g.items.length !== 1 ? 'itens' : 'item'}</span>
        </div>
        <div class="px-grid">${g.items.map(_pxCardHtml).join('')}</div>
      </div>`).join('');
}


// ── Emoji inteligente por item — baseado em nome e categoria ─────────────────
// Mapeamento local: sem chamada de API, instantâneo.
function _pxItemEmoji(item) {
  // 1. Prioridade: ícone da categoria
  const catIcon = item.categories?.icon;
  if (catIcon && catIcon.length <= 4) return catIcon; // emoji do cadastro

  // 2. Mapa por palavras-chave no nome do item (normalizado)
  const name = (item.name + ' ' + (item.description || '')).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // remove acentos

  const MAP = [
    // Laticínios e ovos
    [/leite|iogurte|queijo|manteiga|nata|creme\s+de\s+leite|requeijao|mussarela/,'🥛'],
    [/ovo|ovos/,'🥚'],
    // Carnes
    [/carne|bife|frango|peixe|atum|sardinha|camarao|bacalhau|linguica|salsicha|presunto|bacon|peito|coxa|sobrecoxa|patinho|alcatra|file|costela|pernil|lombo/,'🥩'],
    // Hortifruti
    [/banana|maca|laranja|limao|uva|morango|abacaxi|mamao|manga|pera|melao|melancia|kiwi|fruta/,'🍎'],
    [/tomate|alface|cenoura|batata|cebola|alho|pepino|brocolis|abobrinha|pimentao|berinjela|mandioca|inhame|legume|verdura|vegetal|espinafre|couve|repolho/,'🥦'],
    // Grãos e massas
    [/arroz/,'🍚'],
    [/feijao|lentilha|grao|ervilha/,'🫘'],
    [/macarrao|massa|espaguete|lasanha|penne|fusilli|farinha|amido|aveia/,'🍝'],
    [/pao|bolo|biscoito|bolacha|torrada|croissant|waffle|panqueca/,'🍞'],
    // Condimentos e temperos
    [/sal|acucar|mel|azeite|vinagre|ketchup|mostarda|maionese|molho|pimenta|canela|oregano|tempero|extrato|caldo/,'🧂'],
    // Bebidas
    [/agua|agua\s+mineral|agua\s+com\s+gas/,'💧'],
    [/suco|nectar|limonada/,'🧃'],
    [/refrigerante|coca|pepsi|guarana|fanta|sprite/,'🥤'],
    [/cerveja|vinho|whisky|vodka|cachaca|licor|espumante/,'🍺'],
    [/cafe|cha|cappuccino|nescafe|achocolatado|chocolate\s+quente/,'☕'],
    // Limpeza
    [/detergente|sabao|sabonete|shampoo|condicionador|desinfetante|multiuso|limpador|agua\s+sanitaria|alvejante|amaciante|esponja|papel\s+toalha|papel\s+higienico/,'🧹'],
    // Higiene pessoal
    [/creme\s+dental|pasta\s+de\s+dente|escova\s+de\s+dente|fio\s+dental|desodorante|perfume|absorvente|fraldas|barbear/,'🪥'],
    // Congelados e padaria
    [/sorvete|gelado|popsicle/,'🍦'],
    [/pizza|hamburguer|hot\s+dog/,'🍕'],
    // Bebê / criança
    [/fralda|papinha|formula\s+infant/,'👶'],
    // Animais
    [/racao|petisco\s+pet|pet\s+shop/,'🐾'],
    // Farmácia
    [/remedio|medicamento|vitamina|suplemento|pomada|antisseptico|curativo/,'💊'],
    // Eletrônicos / pilhas
    [/pilha|bateria|lampada|cabo\s+usb/,'🔋'],
    // Papelaria
    [/caderno|caneta|lapis|borracha|cola|papel\s+a4/,'📝'],
    // Categoria genérica por nome da categoria
    [/aliment|mercearia|supermercado|padaria/,'🛒'],
    [/limpeza|higiene|cuidado/,'🧼'],
    [/bebe|infantil|kids/,'👶'],
    [/pet|animal/,'🐾'],
    [/farm|saude|medic/,'💊'],
    [/bebida/,'🥤'],
    [/hortifruti|frutas|verduras/,'🥬'],
  ];

  for (const [re, emoji] of MAP) {
    if (re.test(name)) return emoji;
  }

  // 3. Fallback por nome da categoria
  const catName = (item.categories?.name || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const [re, emoji] of MAP) {
    if (re.test(catName)) return emoji;
  }

  // 4. Fallback neutro
  return '📦';
}

function _pxCardHtml(item) {
  const avg  = item.avg_price  != null ? fmt(item.avg_price)  : null;
  const last = item.last_price != null ? fmt(item.last_price) : null;
  const cnt  = item.record_count || 0;
  const cat  = item.categories?.name  || '';
  const catColor = item.categories?.color || 'var(--accent)';
  let trend = '';
  if (item.avg_price != null && item.last_price != null) {
    if      (item.last_price > item.avg_price * 1.02) trend = '<span class="px-trend up">\u2191</span>';
    else if (item.last_price < item.avg_price * 0.98) trend = '<span class="px-trend dn">\u2193</span>';
    else                                               trend = '<span class="px-trend eq">\u2192</span>';
  }
  const emoji  = _pxItemEmoji(item);
  const unitBadge = (item.unit && item.unit !== 'un')
    ? `<span class="px-unit">${esc(item.unit)}</span>` : '';

  // Hierarquia exclusiva de preços
  const hier = _pxItemHier(item);
  let hierHtml = '';
  if (hier) {
    hierHtml = `<div class="px-cat-breadcrumb">`;
    if (cat) hierHtml += `<span>${esc(cat)}</span><span class="sep">›</span>`;
    hierHtml += `<span class="px-cat-tag">${esc(hier.subcatLabel)}</span>`;
    if (hier.typeLabel) hierHtml += `<span class="sep">›</span><span class="px-type-badge">${esc(hier.typeLabel)}</span>`;
    hierHtml += `</div>`;
  }

  return `
    <div class="px-card" onclick="openPriceItemDetail('${item.id}')" style="--px-clr:${catColor}">
      <div class="px-card-top">
        <div class="px-avatar" style="background:color-mix(in srgb,${catColor} 15%,transparent);font-size:1.4rem;line-height:1">${emoji}</div>
        ${!hier && cat && !_px.groupBy ? `<span class="px-cat-badge" style="color:${catColor};background:color-mix(in srgb,${catColor} 12%,transparent)">${esc(cat)}</span>` : ''}
        <button class="px-cart-btn" title="Adicionar à lista de compras"
                onclick="event.stopPropagation();openAddToGroceryList('${item.id}','${esc(item.name).replace(/'/g,'\u0027')}','${esc(item.unit||'un')}',${item.last_price ?? 'null'})">
          🛒
        </button>
      </div>
      <div class="px-name">${esc(item.name)}${unitBadge}</div>
      ${hierHtml}
      ${item.description ? `<div class="px-desc">${esc(item.description)}</div>` : ''}
      <div class="px-prices">
        <div class="px-price-col"><span class="px-price-lbl">Preço médio</span><span class="px-price-val">${avg ?? '—'}</span></div>
        <div class="px-price-col"><span class="px-price-lbl">Último ${trend}</span><span class="px-price-val ${item.last_price != null ? 'accent' : ''}">${last ?? '—'}</span></div>
        <div class="px-price-col"><span class="px-price-lbl">Registros</span><span class="px-price-val">${cnt}</span></div>
      </div>
      <div class="px-card-footer"><div class="px-progress"><div class="px-progress-bar" style="width:${Math.min(100, cnt * 10)}%;background:${catColor}"></div></div></div>
    </div>`;
}

// Agrupa items por subcategoria de preços
function _renderPricesGroupedBySubcat(items) {
  const listEl = document.getElementById('pricesItemList');
  if (!listEl) return;
  const groups = {};
  const noSubcat = [];
  items.forEach(item => {
    const hier = _pxItemHier(item);
    if (!hier) { noSubcat.push(item); return; }
    if (!groups[hier.subcatKey]) {
      groups[hier.subcatKey] = { label: hier.subcatLabel, items: [], byType: {} };
    }
    groups[hier.subcatKey].items.push(item);
    if (hier.typeLabel) {
      if (!groups[hier.subcatKey].byType[hier.typeLabel]) groups[hier.subcatKey].byType[hier.typeLabel] = [];
      groups[hier.subcatKey].byType[hier.typeLabel].push(item);
    }
  });

  let html = '';
  Object.entries(groups)
    .sort((a, b) => a[1].label.localeCompare(b[1].label))
    .forEach(([key, g]) => {
      const typeKeys = Object.keys(g.byType);
      let innerHtml = '';
      if (typeKeys.length > 0) {
        typeKeys.sort().forEach(tl => {
          innerHtml += `
            <div style="margin-bottom:12px">
              <div class="px-subcat-group-header" style="padding-left:4px;border-left:3px solid var(--accent);margin-bottom:8px">
                <span class="px-subcat-group-label" style="font-size:.72rem;color:var(--muted)">${esc(tl)}</span>
                <span class="px-subcat-group-meta">${g.byType[tl].length} item(s)</span>
              </div>
              <div class="px-grid">${g.byType[tl].map(_pxCardHtml).join('')}</div>
            </div>`;
        });
        const untyped = g.items.filter(i => !_pxItemHier(i)?.typeLabel);
        if (untyped.length) innerHtml += `<div class="px-grid">${untyped.map(_pxCardHtml).join('')}</div>`;
      } else {
        innerHtml = `<div class="px-grid">${g.items.map(_pxCardHtml).join('')}</div>`;
      }
      html += `
        <div class="px-subcat-group">
          <div class="px-subcat-group-header">
            <span class="px-subcat-group-dot"></span>
            <span class="px-subcat-group-label">${esc(g.label)}</span>
            <span class="px-subcat-group-meta">${g.items.length} item(s)</span>
          </div>
          ${innerHtml}
        </div>`;
    });

  if (noSubcat.length) {
    html += `
      <div class="px-subcat-group">
        <div class="px-subcat-group-header">
          <span class="px-subcat-group-dot" style="background:var(--muted2)"></span>
          <span class="px-subcat-group-label" style="color:var(--muted)">Sem subcategoria</span>
          <span class="px-subcat-group-meta">${noSubcat.length} item(s)</span>
        </div>
        <div class="px-grid">${noSubcat.map(_pxCardHtml).join('')}</div>
      </div>`;
  }
  listEl.innerHTML = html || '<div class="prices-empty"><div style="font-size:2.8rem;margin-bottom:12px">🏷️</div><div style="font-weight:700">Nenhum item encontrado</div></div>';
}

// ─────────────────────────────────────────────────────────────────────────────
// ITEM DETAIL MODAL
// ─────────────────────────────────────────────────────────────────────────────

async function openPriceItemDetail(itemId) {
  _px.activeItemId = itemId;
  const item = _px.items.find(i => i.id === itemId);
  if (!item) return;
  const el = id => document.getElementById(id);
  if (el('pidModalTitle')) el('pidModalTitle').textContent = '📦 ' + item.name;
  if (el('pidItemCat'))  el('pidItemCat').textContent  = item.categories?.name || '';
  if (el('pidItemDesc')) { el('pidItemDesc').textContent = item.description || ''; el('pidItemDesc').style.display = item.description ? '' : 'none'; }
  if (el('pidItemUnit')) el('pidItemUnit').textContent  = item.unit ? '(' + item.unit + ')' : '';
  if (el('pidAvgPrice'))  el('pidAvgPrice').textContent  = item.avg_price  != null ? fmt(item.avg_price)  : '—';
  if (el('pidLastPrice')) el('pidLastPrice').textContent = item.last_price != null ? fmt(item.last_price) : '—';
  if (el('pidMinPrice'))  el('pidMinPrice').textContent  = '—';
  if (el('pidCount'))     el('pidCount').textContent = item.record_count || '0';
  const pidStoreSel = el('pidStoreFilter');
  if (pidStoreSel) {
    pidStoreSel.innerHTML = '<option value="">Todos os estabelecimentos</option>' +
      _px.stores.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    pidStoreSel.value = _px.pidStoreFilter || '';
  }
  const histEl = el('pidHistoryList');
  if (histEl) histEl.innerHTML = '<div class="pid-loading">⏳ Carregando histórico...</div>';
  openModal('priceItemDetailModal');
  await _loadAndRenderPidHistory(itemId);
}

async function _loadAndRenderPidHistory(itemId) {
  const histEl = document.getElementById('pidHistoryList');
  if (!histEl) return;
  let q = sb.from('price_history')
    .select('id, unit_price, quantity, purchased_at, store_id, price_stores(id, name, address, city, state_uf, payees(name))')
    .eq('item_id', itemId).order('purchased_at', { ascending: false }).limit(100);
  if (_px.pidStoreFilter) q = q.eq('store_id', _px.pidStoreFilter);
  const { data: hist, error } = await q;
  if (error || !hist?.length) { histEl.innerHTML = '<div class="pid-empty">Nenhum registro encontrado.</div>'; return; }
  const prices = hist.map(h => h.unit_price).filter(v => v != null);
  const minPrice = prices.length ? Math.min(...prices) : null;
  const minEl = document.getElementById('pidMinPrice');
  if (minEl) minEl.textContent = minPrice != null ? fmt(minPrice) : '—';
  histEl.innerHTML = hist.map(h => {
    const store   = h.price_stores;
    const dateStr = h.purchased_at ? new Date(h.purchased_at + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
    const loc     = [store?.address, store?.city, store?.state_uf].filter(Boolean).join(', ');
    const payeeName = store?.payees?.name;
    return `
    <div class="pid-row">
      <div class="pid-row-date">${dateStr}</div>
      <div class="pid-row-store">
        <div class="pid-row-store-name">${esc(store?.name || '—')}${payeeName && payeeName !== store?.name ? ` <span style="font-size:.68rem;color:var(--muted)">(${esc(payeeName)})</span>` : ''}</div>
        ${loc ? `<div class="pid-row-store-addr">${esc(loc)}</div>` : ''}
      </div>
      <div class="pid-row-qty">×${h.quantity ?? 1}</div>
      <div class="pid-row-price">${fmt(h.unit_price)}</div>
      <button class="pid-row-del btn-icon" onclick="event.stopPropagation();deletePriceHistory('${h.id}','${itemId}')" title="Remover">🗑</button>
    </div>`;
  }).join('');
}

async function filterPidHistory() {
  const sel = document.getElementById('pidStoreFilter');
  _px.pidStoreFilter = sel?.value || '';
  if (_px.activeItemId) await _loadAndRenderPidHistory(_px.activeItemId);
}

async function deletePriceHistory(histId, itemId) {
  if (!confirm('Remover este registro do histórico?')) return;
  const { error } = await sb.from('price_history').delete().eq('id', histId);
  if (error) { toast('Erro: ' + error.message, 'error'); return; }
  await _refreshItemStats(itemId);
  await _loadPricesData();
  await _loadAndRenderPidHistory(itemId);
  _renderPricesPage();
  toast('Registro removido', 'success');
}

async function openEditPriceItem() {
  const item = _px.items.find(i => i.id === _px.activeItemId);
  if (!item) return;
  closeModal('priceItemDetailModal');
  _openItemForm(item);
}

function deletePriceItemCurrent() { deletePriceItem(); }

async function deletePriceItem() {
  const item = _px.items.find(i => i.id === _px.activeItemId);
  if (!item) return;
  if (!confirm(`Excluir o item "${item.name}" e todo o histórico?\n\nEsta ação é irreversível.`)) return;
  await sb.from('price_history').delete().eq('item_id', item.id);
  await sb.from('price_items').delete().eq('id', item.id);
  closeModal('priceItemDetailModal');
  toast('Item excluído', 'success');
  await _loadPricesData();
  _renderPricesPage();
}

// ─────────────────────────────────────────────────────────────────────────────
// ADD PRICE RECORD MODAL  (manual, from item detail "+ Registrar Preço")
// ─────────────────────────────────────────────────────────────────────────────

function openAddPriceRecord() {
  const item = _px.items.find(i => i.id === _px.activeItemId);
  if (!item) return;
  const el = id => document.getElementById(id);
  if (el('aprModalTitle')) el('aprModalTitle').textContent = '📌 Registrar Preço — ' + item.name;
  if (el('aprItemId'))     el('aprItemId').value = item.id;
  if (el('aprPrice'))      el('aprPrice').value  = '';
  if (el('aprQty'))        el('aprQty').value    = '1';
  if (el('aprDate'))       el('aprDate').value   = new Date().toISOString().slice(0, 10);
  if (el('aprStoreInput')) el('aprStoreInput').value = '';
  if (el('aprStoreId'))    el('aprStoreId').value    = '';
  const sug = el('aprStoreSuggest');
  if (sug) sug.style.display = 'none';
  if (el('aprError')) el('aprError').style.display = 'none';
  openModal('addPriceRecordModal');
  setTimeout(() => el('aprPrice')?.focus(), 150);
}

async function saveAddPriceRecord() {
  const el      = id => document.getElementById(id);
  const itemId  = el('aprItemId')?.value;
  const price   = parseFloat(el('aprPrice')?.value);
  const qty     = parseFloat(el('aprQty')?.value)  || 1;
  const date    = el('aprDate')?.value;
  const storeId   = el('aprStoreId')?.value   || null;
  const storeName = el('aprStoreInput')?.value?.trim();
  if (!price || price <= 0) { _aprErr('Informe o valor unitário.'); return; }
  if (!date)                { _aprErr('Informe a data.'); return; }
  const saveBtn = el('aprSaveBtn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳'; }
  try {
    const fid = _famId();
    let resolvedStoreId = storeId;
    if (!resolvedStoreId && storeName) {
      const { data: ns, error: nsErr } = await sb.from('price_stores')
        .insert({ family_id: fid, name: storeName }).select('id').single();
      if (nsErr) throw new Error('Erro ao criar estabelecimento: ' + nsErr.message);
      resolvedStoreId = ns.id;
      await _loadPricesData();
    }
    const { error } = await sb.from('price_history').insert({
      family_id: fid, item_id: itemId, store_id: resolvedStoreId,
      unit_price: price, quantity: qty, purchased_at: date,
    });
    if (error) throw error;
    await _refreshItemStats(itemId);
    await _loadPricesData();
    _populatePricesStoreFilter();
    toast('✓ Preço registrado', 'success');
    closeModal('addPriceRecordModal');
    await openPriceItemDetail(itemId);
    _renderPricesPage();
  } catch(e) {
    _aprErr('Erro: ' + e.message);
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 Salvar'; }
  }
}

function _aprErr(msg) { const el = document.getElementById('aprError'); if (el) { el.textContent = msg; el.style.display = ''; } }

function _aprStoreSearch(val) {
  const suggest = document.getElementById('aprStoreSuggest');
  const hidEl   = document.getElementById('aprStoreId');
  if (hidEl) hidEl.value = '';
  if (!val.trim()) { if (suggest) suggest.style.display = 'none'; return; }
  const q = val.toLowerCase();
  const matches = _px.stores.filter(s => s.name.toLowerCase().includes(q));
  if (!suggest) return;
  if (!matches.length) { suggest.style.display = 'none'; return; }
  suggest.style.display = '';
  suggest.innerHTML = matches.map(s => {
    const loc = [s.address, s.city].filter(Boolean).join(', ');
    return `<div class="store-suggest-item" onclick="_aprSelectStore('${s.id}','${esc(s.name).replace(/'/g,"\\'")}')">
      <strong>${esc(s.name)}</strong>${loc ? `<div style="font-size:.72rem;color:var(--muted)">${esc(loc)}</div>` : ''}
    </div>`;
  }).join('');
}

function _aprSelectStore(id, name) {
  document.getElementById('aprStoreId').value    = id;
  document.getElementById('aprStoreInput').value = name;
  const sug = document.getElementById('aprStoreSuggest');
  if (sug) sug.style.display = 'none';
}

function aprNewStore() {
  const name = document.getElementById('aprStoreInput')?.value?.trim() || '';
  closeModal('addPriceRecordModal');
  openStoreForm(null, name, (ns) => { _aprSelectStore(ns.id, ns.name); openModal('addPriceRecordModal'); });
}

// ─────────────────────────────────────────────────────────────────────────────
// ITEM CREATE / EDIT FORM
// ─────────────────────────────────────────────────────────────────────────────

function openNewPriceItem() { _openItemForm(null); }

async function _openItemForm(item) {
  const el = id => document.getElementById(id);
  if (el('pifItemId'))     el('pifItemId').value = item?.id || '';
  if (el('pifName'))       el('pifName').value   = item?.name || '';
  if (el('pifDesc'))       el('pifDesc').value   = item?.description || '';
  const unitSel = el('pifUnit'); if (unitSel) unitSel.value = item?.unit || 'un';
  if (el('pifModalTitle')) el('pifModalTitle').textContent = item ? '✏️ Editar Item' : '🏷️ Novo Item';
  if (el('pifPrice'))      el('pifPrice').value  = '';
  if (el('pifQty'))        el('pifQty').value    = '1';
  if (el('pifDate'))       el('pifDate').value   = new Date().toISOString().slice(0, 10);
  if (el('pifStoreInput')) el('pifStoreInput').value = '';
  if (el('pifStoreId'))    el('pifStoreId').value    = '';
  const sug = el('pifStoreSuggest'); if (sug) sug.style.display = 'none';
  const catSel = el('pifCategory');
  if (catSel) {
    catSel.innerHTML = '<option value="">— Nenhuma —</option>' +
      (state.categories || []).filter(c => c.type !== 'income')
        .map(c => `<option value="${c.id}"${item?.category_id === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
  }
  // Garante que caches do Supabase estejam carregados
  if (_pxHierCache === null) await _pxHierLoad();
  if (_pxItemMetaCache === null) await _pxItemMetaLoad();

  // Popula hierarquia
  const catId = item?.category_id || null;
  _pxPopulateFormSubcats(catId);

  // Restaura seleção salva no Supabase (via _pxItemMetaCache)
  const storedHier = item?.id ? (_pxItemMetaCache[item.id] || null) : null;
  if (storedHier) {
    const parts = storedHier.split(__SEP__);
    const [, subcatKey, typeLabel] = parts;
    _pxPopulateFormTypes(catId, subcatKey);
    setTimeout(() => {
      if (el('pifSubcat') && subcatKey) el('pifSubcat').value = subcatKey;
      if (el('pifType') && typeLabel)   el('pifType').value   = typeLabel;
    }, 50);
  } else {
    _pxPopulateFormTypes(catId, null);
  }
  if (el('pifError')) el('pifError').style.display = 'none';
  openModal('priceItemFormModal');
  setTimeout(() => el('pifName')?.focus(), 150);
}

async function savePriceItem() {
  const el    = id => document.getElementById(id);
  const id    = el('pifItemId')?.value;
  const name  = el('pifName')?.value?.trim();
  const desc  = el('pifDesc')?.value?.trim();
  const unit  = el('pifUnit')?.value || 'un';
  const catId = el('pifCategory')?.value || null;
  const price = parseFloat(el('pifPrice')?.value);
  const qty   = parseFloat(el('pifQty')?.value)  || 1;
  const date  = el('pifDate')?.value;
  const storeId   = el('pifStoreId')?.value   || null;
  const storeName = el('pifStoreInput')?.value?.trim();

  // Hierarquia exclusiva de preços — salva via Supabase (app_settings)
  const subcatKey = el('pifSubcat')?.value || null;
  const typeLabel = (el('pifType')?.value && el('pifType')?.value !== '__new__') ? el('pifType').value : null;
  const pxSubcatVal = (subcatKey && subcatKey !== '__new__')
    ? _pxBuildHierValue(catId, subcatKey, typeLabel)
    : null;

  if (!name) { _pifErr('Informe o nome do item.'); return; }
  if (el('pifError')) el('pifError').style.display = 'none';
  const fid     = _famId();
  const payload = { name, description: desc || null, unit, category_id: catId, family_id: fid };
  let itemId;
  if (id) {
    const { error } = await sb.from('price_items').update(payload).eq('id', id);
    if (error) { _pifErr('Erro: ' + error.message); return; }
    itemId = id;
  } else {
    const { data: ni, error } = await sb.from('price_items').insert(payload).select('id').single();
    if (error) { _pifErr('Erro: ' + error.message); return; }
    itemId = ni.id;
  }
  // Persiste vínculo item→subcategoria no Supabase (app_settings px_item_meta_{fid})
  if (pxSubcatVal !== null) {
    if (!_pxItemMetaCache) await _pxItemMetaLoad();
    _pxItemMetaCache[itemId] = pxSubcatVal;
    await _pxItemMetaSave();
  } else if (pxSubcatVal === null && id && _pxItemMetaCache?.[id]) {
    // Usuário limpou a hierarquia do item: remove o vínculo
    delete _pxItemMetaCache[id];
    await _pxItemMetaSave();
  }
  if (price > 0 && date) {
    let resolvedStoreId = storeId;
    if (!resolvedStoreId && storeName) {
      const { data: ns } = await sb.from('price_stores')
        .insert({ family_id: fid, name: storeName }).select('id').single();
      if (ns) resolvedStoreId = ns.id;
    }
    await sb.from('price_history').insert({
      family_id: fid, item_id: itemId, store_id: resolvedStoreId || null,
      unit_price: price, quantity: qty, purchased_at: date,
    });
    await _refreshItemStats(itemId);
  }
  toast(id ? '✓ Item atualizado' : '✓ Item criado', 'success');
  closeModal('priceItemFormModal');
  await _loadPricesData();
  _populatePricesStoreFilter();
  _populatePxSubcatFilter();
  _renderPricesPage();
}

function _pifErr(msg) { const el = document.getElementById('pifError'); if (el) { el.textContent = msg; el.style.display = ''; } }

function _pifStoreSearch(val) {
  const suggest = document.getElementById('pifStoreSuggest');
  const hidEl   = document.getElementById('pifStoreId');
  if (hidEl) hidEl.value = '';
  if (!val.trim()) { if (suggest) suggest.style.display = 'none'; return; }
  const q = val.toLowerCase();
  const matches = _px.stores.filter(s => s.name.toLowerCase().includes(q));
  if (!suggest) return;
  if (!matches.length) { suggest.style.display = 'none'; return; }
  suggest.style.display = '';
  suggest.innerHTML = matches.map(s => {
    const loc = [s.address, s.city].filter(Boolean).join(', ');
    return `<div class="store-suggest-item" onclick="_pifSelectStore('${s.id}','${esc(s.name).replace(/'/g,"\\'")}')">
      <strong>${esc(s.name)}</strong>${loc ? `<div style="font-size:.72rem;color:var(--muted)">${esc(loc)}</div>` : ''}
    </div>`;
  }).join('');
}

function _pifSelectStore(id, name) {
  document.getElementById('pifStoreId').value    = id;
  document.getElementById('pifStoreInput').value = name;
  const sug = document.getElementById('pifStoreSuggest'); if (sug) sug.style.display = 'none';
}

function _pifStoreNew() {
  const name = document.getElementById('pifStoreInput')?.value?.trim() || '';
  closeModal('priceItemFormModal');
  openStoreForm(null, name, (ns) => { _pifSelectStore(ns.id, ns.name); openModal('priceItemFormModal'); });
}

// ─────────────────────────────────────────────────────────────────────────────
// REGISTER PRICES FROM RECEIPT
// ─────────────────────────────────────────────────────────────────────────────

// ── Feature 11: Gestão de relacionamento Estabelecimento ↔ Beneficiário ─────

async function openStorePayeeMap() {
  await _loadPricesData();
  _renderStorePayeeMap();
  openModal('storePayeeMapModal');
}

function _renderStorePayeeMap() {
  const el = document.getElementById('storePayeeMapBody');
  if (!el) return;

  const stores = (_px.stores || []).slice().sort((a,b) => a.name.localeCompare(b.name));
  const payees = (state.payees || []).slice().sort((a,b) => a.name.localeCompare(b.name));
  const payeeOpts = '<option value="">— Nenhum —</option>' +
    payees.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');

  if (!stores.length) {
    el.innerHTML = '<div style="text-align:center;padding:32px;color:var(--muted)">Nenhum estabelecimento cadastrado ainda.</div>';
    return;
  }

  el.innerHTML = stores.map(store => {
    const linkedPayee = store.payees;
    const payeeOptsSelected = payeeOpts.replace(
      linkedPayee ? `value="${linkedPayee.id}"` : 'value="">',
      linkedPayee ? `value="${linkedPayee.id}" selected` : 'value="" selected>'
    );
    const locParts = [store.address, store.city, store.state_uf].filter(Boolean);
    const locLine  = locParts.join(', ');
    return `<div class="spm-row" id="spmRow-${store.id}">
      <div class="spm-store">
        <div class="spm-store-name">${esc(store.name)}</div>
        ${locLine ? `<div class="spm-store-addr">${esc(locLine)}</div>` : ''}
        ${store.cnpj ? `<div class="spm-store-cnpj">🪪 ${esc(store.cnpj)}</div>` : ''}
      </div>
      <div class="spm-arrow">→</div>
      <div class="spm-payee">
        <select class="spm-payee-select" id="spmPayee-${store.id}"
          onchange="saveStorePayeeLink('${store.id}', this.value)"
          style="font-size:.82rem;padding:5px 8px;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--surface);max-width:180px">
          ${payeeOptsSelected}
        </select>
        ${linkedPayee ? `<div style="font-size:.7rem;color:var(--green,#16a34a);margin-top:3px">✓ ${esc(linkedPayee.name)}</div>` : '<div style="font-size:.7rem;color:var(--muted);margin-top:3px">Sem vínculo</div>'}
      </div>
    </div>`;
  }).join('');
}

async function saveStorePayeeLink(storeId, payeeId) {
  const { error } = await sb.from('price_stores')
    .update({ payee_id: payeeId || null, updated_at: new Date().toISOString() })
    .eq('id', storeId);
  if (error) { toast('Erro ao salvar vínculo: ' + error.message, 'error'); return; }

  // Update local cache
  const store = (_px.stores||[]).find(s=>s.id===storeId);
  if (store) {
    const payee = (state.payees||[]).find(p=>p.id===payeeId);
    store.payee_id = payeeId||null;
    store.payees   = payee||null;
  }
  toast('Vínculo salvo!', 'success');
  _renderStorePayeeMap(); // re-render to update hints
}

async function openRegisterPricesFromReceipt() {
  const result = window._lastReceiptAiResult;
  if (!result) { toast('Leia o recibo com IA primeiro.', 'warning'); return; }
  await _loadPricesData();
  _openRegisterModal(result);
}

function _openRegisterModal(aiResult) {
  const el = id => document.getElementById(id);
  if (el('rpmStoreInput')) el('rpmStoreInput').value = '';
  if (el('rpmStoreId'))    el('rpmStoreId').value    = '';
  if (el('rpmStoreInfo'))  { el('rpmStoreInfo').style.display = 'none'; el('rpmStoreInfo').innerHTML = ''; }
  const sug = el('rpmStoreSuggest'); if (sug) sug.style.display = 'none';
  if (el('rpmDate'))  el('rpmDate').value  = aiResult.date || new Date().toISOString().slice(0, 10);
  if (el('rpmError')) el('rpmError').style.display = 'none';
  window._rpmAiAddress = aiResult.address || null;
  window._rpmAiCnpj    = aiResult.cnpj    || null;

  if (aiResult.payee) {
    const normQ = aiResult.payee.toLowerCase();
    // Match by CNPJ first (most reliable)
    let known = aiResult.cnpj
      ? _px.stores.find(s => s.cnpj && s.cnpj.replace(/\D/g,'') === aiResult.cnpj.replace(/\D/g,''))
      : null;
    // Match by name
    if (!known) known = _px.stores.find(s => s.name.toLowerCase().includes(normQ) || normQ.includes(s.name.toLowerCase()));
    // Match via payee
    if (!known && state.payees) {
      const pm = state.payees.find(p => p.name.toLowerCase().includes(normQ) || normQ.includes(p.name.toLowerCase()));
      if (pm) known = _px.stores.find(s => s.payee_id === pm.id);
    }
    if (known) {
      if (el('rpmStoreInput')) el('rpmStoreInput').value = known.name;
      if (el('rpmStoreId'))    el('rpmStoreId').value    = known.id;
      _rpmShowStoreInfo(known);
    } else {
      if (el('rpmStoreInput')) el('rpmStoreInput').value = aiResult.payee;
      if (aiResult.address && el('rpmStoreInfo')) {
        el('rpmStoreInfo').style.display = '';
        el('rpmStoreInfo').innerHTML = `<span style="color:var(--accent)">📍 Novo estabelecimento</span> · ${esc(aiResult.address)}${aiResult.cnpj ? ' · 🪪 '+esc(aiResult.cnpj) : ''}`;
      }
    }
  }
  // Normalise items from both receipt_ai.js (_callClaudeVision) and prices.js (_callPricesVision)
  // Both return items[] but with slightly different field names — unify here
  const rawItems = (aiResult.items || []).map(it => ({
    description: it.description || it.ai_name || '',
    ai_name:     it.ai_name     || it.description || '',
    quantity:    parseFloat(it.quantity)   || 1,
    unit_price:  parseFloat(it.unit_price) || parseFloat(it.price) || 0,
    total_price: parseFloat(it.total_price)|| (parseFloat(it.unit_price||0) * (parseFloat(it.quantity)||1)),
    category:    it.category || null,
  })).filter(it => it.description && it.unit_price > 0);

  if (rawItems.length) {
    _renderRpmRows(rawItems);
  } else {
    // Fallback: single row with the note total (nothing better to show)
    _renderRpmRows([{
      description: aiResult.description || aiResult.payee || '',
      ai_name:     aiResult.description || '',
      quantity:    1,
      unit_price:  aiResult.amount || 0,
      total_price: aiResult.amount || 0,
      category:    aiResult.category || null,
    }]);
  }
  openModal('registerPricesModal');
}

function _rpmShowStoreInfo(store) {
  const el = document.getElementById('rpmStoreInfo');
  if (!el) return;
  const parts = [];
  const addr = [store.address, store.city, store.state_uf].filter(Boolean).join(', ');
  if (addr)         parts.push('📍 ' + addr);
  if (store.phone)  parts.push('📞 ' + store.phone);
  if (store.cnpj)   parts.push('🪪 ' + store.cnpj);
  if (store.payees) parts.push('👤 ' + store.payees.name);
  if (parts.length) { el.style.display = ''; el.textContent = parts.join('  ·  '); }
  else              el.style.display = 'none';
}

function _rpmStoreSearch(val) {
  const suggest = document.getElementById('rpmStoreSuggest');
  const hidEl   = document.getElementById('rpmStoreId');
  if (hidEl) hidEl.value = '';
  const si = document.getElementById('rpmStoreInfo');
  if (si) si.style.display = 'none';
  if (!val.trim()) { if (suggest) suggest.style.display = 'none'; return; }
  const q = val.toLowerCase();
  const matches = _px.stores.filter(s => s.name.toLowerCase().includes(q));
  if (!suggest) return;
  if (!matches.length) { suggest.style.display = 'none'; return; }
  suggest.style.display = '';
  suggest.innerHTML = matches.map(s => {
    const loc = [s.address, s.city].filter(Boolean).join(', ');
    const payeeLine = s.payees ? ` <span style="font-size:.68rem;color:var(--muted)">· ${esc(s.payees.name)}</span>` : '';
    return `<div class="store-suggest-item" onclick="_rpmSelectStore('${s.id}','${esc(s.name).replace(/'/g,"\\'")}')">
      <strong>${esc(s.name)}</strong>${payeeLine}
      ${loc ? `<div style="font-size:.72rem;color:var(--muted)">${esc(loc)}</div>` : ''}
    </div>`;
  }).join('');
}

function _rpmSelectStore(id, name) {
  document.getElementById('rpmStoreId').value    = id;
  document.getElementById('rpmStoreInput').value = name;
  const sug = document.getElementById('rpmStoreSuggest'); if (sug) sug.style.display = 'none';
  const store = _px.stores.find(s => s.id === id);
  if (store) _rpmShowStoreInfo(store);
}

function rpmNewStore() {
  const name    = document.getElementById('rpmStoreInput')?.value?.trim() || '';
  const aiAddr  = window._rpmAiAddress || '';
  closeModal('registerPricesModal');
  openStoreForm(null, name, (ns) => { _rpmSelectStore(ns.id, ns.name); openModal('registerPricesModal'); }, aiAddr);
}

// ─────────────────────────────────────────────────────────────────────────────
// RPM ITEM ROWS
// ─────────────────────────────────────────────────────────────────────────────

function _renderRpmRows(items) {
  const el = document.getElementById('rpmItemList');
  if (!el) return;
  window._rpmItems = items.map((it, idx) => ({ ...it, idx }));
  // Feature 2: responsive grid — cards on mobile, compact table on desktop
  el.innerHTML = `<div class="rpm-grid" id="rpmTableBody">
    ${window._rpmItems.map(it => _rpmRowHtml(it)).join('')}
  </div>`;
  window._rpmItems.forEach(it => _rpmAutoLink(it.idx));
}

function _rpmRowHtml(it) {
  const idx      = it.idx;
  const itemOpts = _px.items.map(i => `<option value="${i.id}">${esc(i.name)}</option>`).join('');

  // Feature 6: hierarchical category options (parent → child indented)
  const cats = (state.categories || []).filter(c => c.type !== 'income');
  const parents  = cats.filter(c => !c.parent_id).sort((a,b)=>a.name.localeCompare(b.name));
  const children = cats.filter(c => !!c.parent_id);
  const catMatch = it.category
    ? cats.find(c => c.name.toLowerCase() === (it.category||'').toLowerCase())
    : null;
  const selectedId = catMatch?.id || '';
  let catOptsHtml = '<option value="">— Categoria —</option>';
  parents.forEach(p => {
    catOptsHtml += `<option value="${p.id}"${selectedId===p.id?' selected':''}>${p.icon||'📦'} ${esc(p.name)}</option>`;
    children.filter(c=>c.parent_id===p.id).sort((a,b)=>a.name.localeCompare(b.name)).forEach(c => {
      catOptsHtml += `<option value="${c.id}"${selectedId===c.id?' selected':''}>&nbsp;&nbsp;↳ ${esc(c.name)}</option>`;
    });
  });

  const rawName   = esc(it.description || it.ai_name || '');
  const aiHint    = (it.ai_name && it.ai_name !== it.description) ? esc(it.ai_name) : '';
  const unitPrice = (it.unit_price || 0).toFixed(2);

  // Feature 2: card layout — each item is a card, not a table row
  return `<div class="rpm-card" id="rpmItem-${idx}">
    <div class="rpm-card-num">${idx + 1}</div>
    <div class="rpm-card-body">
      <div class="rpm-card-row">
        <input type="text" id="rpmDesc-${idx}" class="rpm-inline-input rpm-desc-input"
               value="${rawName}" placeholder="Descrição do item…"
               oninput="_rpmAutoLink(${idx})">
        ${aiHint ? `<div class="rpm-ai-name" title="Nome original do recibo">${aiHint}</div>` : ''}
      </div>
      <div class="rpm-card-fields">
        <div class="rpm-field-group">
          <label class="rpm-field-label">Qtd</label>
          <input type="number" id="rpmQty-${idx}" class="rpm-inline-input rpm-input-center"
                 value="${it.quantity ?? 1}" min="0.001" step="any" style="width:70px">
        </div>
        <div class="rpm-field-group">
          <label class="rpm-field-label">Preço Unit.</label>
          <input type="number" id="rpmPrice-${idx}" class="rpm-inline-input rpm-input-right"
                 value="${unitPrice}" min="0" step="0.01" style="width:100px">
        </div>
        <div class="rpm-field-group" style="flex:1;min-width:120px">
          <label class="rpm-field-label">Categoria</label>
          <select id="rpmCat-${idx}" class="rpm-inline-select">${catOptsHtml}</select>
        </div>
        <div class="rpm-field-group" style="flex:1;min-width:130px">
          <label class="rpm-field-label">Vincular Item</label>
          <select id="rpmLink-${idx}" class="rpm-inline-select">
            <option value="">+ novo item</option>
            ${itemOpts}
          </select>
        </div>
      </div>
    </div>
    <div class="rpm-card-actions">
      <button class="rpm-ai-btn" onclick="rpmNormalizeAI(${idx})" title="Normalizar com IA">🤖</button>
      <button class="rpm-del-btn" onclick="rpmRemoveRow(${idx})" title="Remover">✕</button>
    </div>
  </div>`;
}

function _rpmAutoLink(idx) {
  const descEl = document.getElementById(`rpmDesc-${idx}`);
  const linkEl = document.getElementById(`rpmLink-${idx}`);
  if (!descEl || !linkEl || linkEl.value) return;
  const q = (descEl.value || '').toLowerCase().trim();
  if (q.length < 3) return;
  const match = _px.items.find(i => { const n = i.name.toLowerCase(); return n.includes(q) || q.includes(n); });
  if (match) linkEl.value = match.id;
}

function rpmRemoveRow(idx) { document.getElementById(`rpmItem-${idx}`)?.remove(); window._rpmItems = (window._rpmItems||[]).filter(i => i.idx !== idx); }

async function rpmNormalizeAI(idx) {
  const descEl = document.getElementById(`rpmDesc-${idx}`);
  const raw    = descEl?.value?.trim();
  if (!raw) return;
  const apiKey = await getAppSetting(RECEIPT_AI_KEY_SETTING, '');
  if (!apiKey) { toast('Configure a chave Gemini para usar IA.', 'warning'); return; }
  const btn = descEl?.parentElement?.querySelector('.rpm-ai-btn');
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
  try {
    const url  = `https://generativelanguage.googleapis.com/v1beta/models/${RECEIPT_AI_MODEL}:generateContent?key=${apiKey}`;
    const resp = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text:
          `Normalize este nome de produto para uma descrição curta e padronizada em português brasileiro.\n` +
          `Remova abreviações técnicas e códigos internos.\n` +
          `Retorne APENAS o nome normalizado em Title Case.\n\nProduto: ${raw}`
        }] }],
        generationConfig: { maxOutputTokens: 50, temperature: 0.1 },
      }),
    });
    const data = await resp.json();
    const norm = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (norm && descEl) { descEl.value = norm; _rpmAutoLink(idx); }
    toast('✓ Nome normalizado', 'success');
  } catch(e) { toast('Erro na IA: ' + e.message, 'error'); }
  finally { if (btn) { btn.textContent = '🤖'; btn.disabled = false; } }
}

async function rpmNormalizeAllAI() {
  const rows = document.querySelectorAll('[id^="rpmItem-"]');
  for (const row of rows) {
    await rpmNormalizeAI(row.id.replace('rpmItem-', ''));
    await new Promise(r => setTimeout(r, 200));
  }
}

function rpmAddRow() {
  const tbody = document.getElementById('rpmTableBody');
  if (!tbody) return;
  const maxIdx = window._rpmItems?.length ? Math.max(...window._rpmItems.map(i => i.idx)) + 1 : 0;
  const newItem = { idx: maxIdx, ai_name: '', quantity: 1, unit_price: 0 };
  window._rpmItems = [...(window._rpmItems || []), newItem];
  const tmp = document.createElement('tbody');
  tmp.innerHTML = _rpmRowHtml(newItem);
  tbody.appendChild(tmp.firstElementChild);
  document.getElementById(`rpmDesc-${maxIdx}`)?.focus();
}

async function saveRegisterPrices() {
  const el      = id => document.getElementById(id);
  const storeId = el('rpmStoreId')?.value   || null;
  const storeName = el('rpmStoreInput')?.value?.trim();
  const date    = el('rpmDate')?.value;
  const saveBtn = el('rpmSaveBtn');
  if (!storeName) { _rpmErr('Informe o nome do estabelecimento.'); return; }
  if (!date)      { _rpmErr('Informe a data.'); return; }
  el('rpmError').style.display = 'none';
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ Salvando...'; }
  try {
    const fid = _famId();
    let resolvedStoreId = storeId;
    if (!resolvedStoreId) {
      const { data: existStore } = await sb.from('price_stores')
        .select('id').eq('family_id', fid).ilike('name', storeName).maybeSingle();
      if (existStore?.id) {
        resolvedStoreId = existStore.id;
      } else {
        const aiAddr = window._rpmAiAddress || null;
        const aiCnpj = window._rpmAiCnpj    || null;
        const { data: ns, error: nsErr } = await sb.from('price_stores')
          .insert({ family_id: fid, name: storeName, address: aiAddr, cnpj: aiCnpj }).select('id').single();
        if (nsErr) throw new Error('Erro ao salvar estabelecimento: ' + nsErr.message);
        resolvedStoreId = ns.id;
      }
    }
    // Collect grid rows then batch-save (2 queries instead of N*3)
    const rows = document.querySelectorAll('[id^="rpmItem-"]');
    const items = [];
    rows.forEach(row => {
      const idx   = row.id.replace('rpmItem-', '');
      const desc  = el(`rpmDesc-${idx}`)?.value?.trim();
      const qty   = parseFloat(el(`rpmQty-${idx}`)?.value)   || 1;
      const price = parseFloat(el(`rpmPrice-${idx}`)?.value) || 0;
      const catId = el(`rpmCat-${idx}`)?.value  || null;
      const itemId= el(`rpmLink-${idx}`)?.value || null;
      if (desc && price > 0) items.push({ desc, qty, price, catId, itemId });
    });
    const { saved } = await DB.prices.saveReceipt(fid, resolvedStoreId, date, items);
    toast(`✓ ${saved} preço${saved !== 1 ? 's' : ''} registrado${saved !== 1 ? 's' : ''}!`, 'success');
    closeModal('registerPricesModal');
    if (state.currentPage === 'prices') { await _loadPricesData(); _populatePricesStoreFilter(); _renderPricesPage(); }
  } catch(e) {
    _rpmErr('Erro: ' + e.message);
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 Salvar Preços'; }
  }
}

function _rpmErr(msg) { const el = document.getElementById('rpmError'); if (el) { el.textContent = msg; el.style.display = ''; } }

// ─────────────────────────────────────────────────────────────────────────────
// STORE MANAGER
// ─────────────────────────────────────────────────────────────────────────────

async function openPricesStoreManager() {
  await _loadPricesData();
  _renderStoreList('');
  const si = document.getElementById('storeSearch'); if (si) si.value = '';
  openModal('pricesStoreModal');
}

function _filterStoreList(val) { _renderStoreList(val); }

function _renderStoreList(search) {
  const el = document.getElementById('storeList');
  if (!el) return;
  let stores = _px.stores;
  if (search) {
    const q = search.toLowerCase();
    stores = stores.filter(s =>
      s.name.toLowerCase().includes(q) || (s.address||'').toLowerCase().includes(q) ||
      (s.city||'').toLowerCase().includes(q) || (s.payees?.name||'').toLowerCase().includes(q)
    );
  }
  if (!stores.length) {
    el.innerHTML = '<div style="text-align:center;padding:32px;color:var(--muted);font-size:.83rem">Nenhum estabelecimento cadastrado.</div>';
    return;
  }
  el.innerHTML = stores.map(s => {
    const loc = [s.address, s.city, s.state_uf].filter(Boolean).join(', ');
    const contact = [
      s.payees ? `<span>👤 ${esc(s.payees.name)}</span>` : '',
      s.phone  ? `<span>📞 ${esc(s.phone)}</span>`  : '',
      s.cnpj   ? `<span>🪪 ${esc(s.cnpj)}</span>`   : '',
    ].filter(Boolean).join(' · ');
    return `
    <div class="store-list-row" onclick="openStoreForm('${s.id}')">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:.88rem">${esc(s.name)}</div>
        ${loc     ? `<div style="font-size:.75rem;color:var(--muted)">${esc(loc)}</div>` : ''}
        ${contact ? `<div style="font-size:.72rem;color:var(--muted);margin-top:2px;display:flex;gap:8px;flex-wrap:wrap">${contact}</div>` : ''}
      </div>
      <button class="btn-icon" title="Excluir" onclick="event.stopPropagation();deleteStore('${s.id}')" style="color:var(--red)">🗑</button>
    </div>`;
  }).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// STORE CREATE / EDIT FORM
// callback(newStore) — used when opened inline from rpm/pif/apr modals
// ─────────────────────────────────────────────────────────────────────────────

let _storeFormCallback = null;

function openStoreForm(storeId, prefillName, callback, prefillAddress) {
  _storeFormCallback = callback || null;
  // If called from store manager (no external callback), close manager first to avoid z-index stacking
  const _managerWasOpen = !callback && document.getElementById('pricesStoreModal')?.classList.contains('open');
  if (_managerWasOpen) closeModal('pricesStoreModal');
  const store = storeId ? _px.stores.find(s => s.id === storeId) : null;
  const el    = id => document.getElementById(id);
  if (el('storeFormId'))      el('storeFormId').value      = store?.id || '';
  if (el('storeFormName'))    el('storeFormName').value    = store?.name    || prefillName    || '';
  if (el('storeFormAddress')) el('storeFormAddress').value = store?.address || prefillAddress || '';
  if (el('storeFormCity'))    el('storeFormCity').value    = store?.city     || '';
  if (el('storeFormUf'))      el('storeFormUf').value      = store?.state_uf || '';
  if (el('storeFormPhone'))   el('storeFormPhone').value   = store?.phone    || '';
  if (el('storeFormCnpj'))    el('storeFormCnpj').value    = store?.cnpj     || '';
  if (el('storeFormTitle'))   el('storeFormTitle').textContent = store ? '✏️ Editar Estabelecimento' : '🏪 Novo Estabelecimento';
  if (el('storeFormError'))   el('storeFormError').style.display = 'none';
  const paySel = el('storeFormPayee');
  if (paySel) {
    const payees = (state.payees || []).filter(p => p.type !== 'income_source');
    paySel.innerHTML = '<option value="">— Nenhum —</option>' +
      payees.map(p => `<option value="${p.id}"${store?.payee_id === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
    paySel.onchange = () => _storeFormSyncFromPayee(paySel.value);
    // If new store: auto-sync from AI CNPJ match
    if (!store && window._rpmAiCnpj) {
      const pm = payees.find(p => p.cnpj_cpf?.replace(/\D/g,'') === (window._rpmAiCnpj||'').replace(/\D/g,''));
      if (pm) { paySel.value = pm.id; _storeFormSyncFromPayee(pm.id, false); }
    }
  }
  openModal('storeFormModal');
  setTimeout(() => el('storeFormName')?.focus(), 150);
}

function _storeFormSyncFromPayee(payeeId, overwrite = true) {
  if (!payeeId) return;
  const p  = (state.payees || []).find(p => p.id === payeeId);
  if (!p) return;
  const el = id => document.getElementById(id);
  const set = (elId, val) => { if (val && el(elId) && (overwrite || !el(elId).value)) el(elId).value = val; };
  set('storeFormAddress', p.address);
  set('storeFormCity',    p.city);
  set('storeFormUf',      p.state_uf);
  set('storeFormPhone',   p.phone);
  set('storeFormCnpj',    p.cnpj_cpf);
}

async function saveStoreForm() {
  const el      = id => document.getElementById(id);
  const id      = el('storeFormId')?.value;
  const name    = el('storeFormName')?.value?.trim();
  const address = el('storeFormAddress')?.value?.trim() || null;
  const city    = el('storeFormCity')?.value?.trim()    || null;
  const uf      = el('storeFormUf')?.value?.trim()?.toUpperCase() || null;
  const phone   = el('storeFormPhone')?.value?.trim()   || null;
  const cnpj    = el('storeFormCnpj')?.value?.trim()    || null;
  const payeeId = el('storeFormPayee')?.value           || null;
  const errEl   = el('storeFormError');
  if (!name) { if (errEl) { errEl.textContent = 'Informe o nome.'; errEl.style.display = ''; } return; }
  if (errEl) errEl.style.display = 'none';
  const payload = { name, address, city, state_uf: uf, phone, cnpj, payee_id: payeeId, family_id: _famId() };
  let result;
  if (id) {
    const { data, error } = await sb.from('price_stores').update(payload).eq('id', id).select().single();
    if (error) { if (errEl) { errEl.textContent = 'Erro: ' + error.message; errEl.style.display = ''; } return; }
    result = data;
  } else {
    const { data, error } = await sb.from('price_stores').insert(payload).select().single();
    if (error) { if (errEl) { errEl.textContent = 'Erro: ' + error.message; errEl.style.display = ''; } return; }
    result = data;
  }
  toast(id ? '✓ Estabelecimento atualizado' : '✓ Estabelecimento criado', 'success');
  await _loadPricesData();
  _populatePricesStoreFilter();
  if (_storeFormCallback) {
    const freshStore = _px.stores.find(s => s.id === result.id) || result;
    _storeFormCallback(freshStore);
    _storeFormCallback = null;
    closeModal('storeFormModal');
    return;
  }
  closeModal('storeFormModal');
  // Reopen store manager and refresh list
  _renderStoreList(el('storeSearch')?.value || '');
  openModal('pricesStoreModal');
}

async function deleteStore(storeId) {
  const store = _px.stores.find(s => s.id === storeId);
  if (!store) return;
  if (!confirm(`Excluir "${store.name}"?\n\nOs registros de histórico vinculados serão mantidos sem referência de estabelecimento.`)) return;
  await sb.from('price_history').update({ store_id: null }).eq('store_id', storeId);
  const { error } = await sb.from('price_stores').delete().eq('id', storeId);
  if (error) { toast('Erro: ' + error.message, 'error'); return; }
  toast('Estabelecimento excluído', 'success');
  await _loadPricesData();
  _populatePricesStoreFilter();
  _renderStoreList(document.getElementById('storeSearch')?.value || '');
}

// ─────────────────────────────────────────────────────────────────────────────
// STATS RECALCULATION
// ─────────────────────────────────────────────────────────────────────────────

async function _refreshItemStats(itemId) {
  const { data: rows } = await sb.from('price_history')
    .select('unit_price, purchased_at').eq('item_id', itemId)
    .order('purchased_at', { ascending: false });
  if (!rows?.length) {
    await sb.from('price_items').update({ avg_price: null, last_price: null, record_count: 0 }).eq('id', itemId);
    return;
  }
  const prices = rows.map(r => r.unit_price).filter(v => v != null);
  const avg    = prices.reduce((a, b) => a + b, 0) / prices.length;
  await sb.from('price_items').update({
    avg_price: Math.round(avg * 100) / 100, last_price: prices[0], record_count: prices.length,
  }).eq('id', itemId);
}

// ══════════════════════════════════════════════════════════════════════════════
// RECEIPT SCAN na página de Preços
// ══════════════════════════════════════════════════════════════════════════════

let _pricesReceiptPending = null;

function openPricesReceiptScan() {
  const zone = document.getElementById('pricesReceiptZone');
  if (zone) zone.style.display = '';
  _pricesReceiptPending = null;
  const nameEl = document.getElementById('pricesReceiptFileName');
  if (nameEl) nameEl.textContent = '';
  const btn = document.getElementById('pricesReadAiBtn');
  if (btn) btn.style.display = 'none';
  const status = document.getElementById('pricesAiStatus');
  if (status) status.style.display = 'none';
}

function closePricesReceiptZone() {
  const zone = document.getElementById('pricesReceiptZone');
  if (zone) zone.style.display = 'none';
  _pricesReceiptPending = null;
  const inp = document.getElementById('pricesReceiptInput');
  if (inp) inp.value = '';
}

async function onPricesReceiptSelected(inputEl) {
  const file = inputEl?.files?.[0];
  if (!file) return;
  inputEl.value = '';
  const nameEl = document.getElementById('pricesReceiptFileName');
  if (nameEl) nameEl.textContent = file.name;
  const btn    = document.getElementById('pricesReadAiBtn');
  const status = document.getElementById('pricesAiStatus');
  if (btn)    btn.style.display = 'none';
  if (status) { status.style.display = ''; status.textContent = '⏳ Preparando arquivo...'; }
  try {
    if (file.type === 'application/pdf') {
      const b64 = await _pdfPageToBase64(file);
      _pricesReceiptPending = { base64: b64, mediaType: 'image/png', fileName: file.name };
    } else if (file.type.startsWith('image/')) {
      const b64 = await _fileToBase64(file);
      _pricesReceiptPending = { base64: b64, mediaType: file.type, fileName: file.name };
    } else { throw new Error('Formato não suportado. Use imagem ou PDF.'); }
    if (status) status.style.display = 'none';
    if (btn)    btn.style.display = '';
  } catch(e) {
    if (status) status.textContent = '❌ ' + e.message;
    toast('Erro ao preparar arquivo: ' + e.message, 'error');
  }
}

async function onPricesReceiptDrop(event) {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  const nameEl = document.getElementById('pricesReceiptFileName');
  if (nameEl) nameEl.textContent = file.name;
  await onPricesReceiptSelected({ files: [file], value: '' });
}

async function readPricesReceiptWithAI() {
  if (!_pricesReceiptPending) { toast('Selecione um arquivo primeiro.', 'warning'); return; }
  const apiKey = await getAppSetting(RECEIPT_AI_KEY_SETTING, '');
  if (!apiKey) { toast('Configure a chave Gemini em Configurações → IA.', 'warning'); return; }
  const btn    = document.getElementById('pricesReadAiBtn');
  const status = document.getElementById('pricesAiStatus');
  if (btn)    { btn.disabled = true; btn.textContent = '⏳ Analisando...'; }
  if (status) { status.style.display = ''; status.textContent = '⏳ Analisando recibo com IA...'; }
  try {
    const result = await _callPricesVision(apiKey, _pricesReceiptPending);
    _pricesReceiptPending = null;
    closePricesReceiptZone();
    await _loadPricesData();
    _openRegisterModal(result);
  } catch(e) {
    if (status) status.textContent = '❌ ' + e.message;
    toast('Erro na análise: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🤖 Analisar com IA'; }
  }
}

async function _callPricesVision(apiKey, pending) {
  const catList   = (state.categories || []).filter(c => c.type === 'expense').map(c => c.name).join(', ');
  const storeList = _px.stores.slice(0, 20).map(s => s.name).join(', ');
  const today     = new Date().toISOString().slice(0, 10);
  const prompt =
    `Você é especialista em leitura de notas fiscais e recibos brasileiros.\n` +
    `Analise a imagem e extraia TODOS os itens com preços unitários e quantidades.\n` +
    `ESTABELECIMENTOS JÁ CADASTRADOS: ${storeList || '(nenhum ainda)'}\n` +
    `CATEGORIAS DISPONÍVEIS: ${catList || 'Alimentação, Higiene, Limpeza, Outros'}\n` +
    `Responda SOMENTE com JSON válido, sem markdown.\n\n` +
    `RETORNE EXATAMENTE ESTE JSON:\n` +
    `{"date":"YYYY-MM-DD","payee":"nome do estabelecimento","address":"endereço ou null","cnpj":"CNPJ ou null",` +
    `"items":[{"description":"nome normalizado","ai_name":"nome exato no recibo","quantity":1,"unit_price":0.00,"total_price":0.00,"category":"categoria ou null"}]}\n\n` +
    `REGRAS: description=nome limpo sem abreviações; unit_price=total_price/quantity; date=${today} se não encontrar; ` +
    `se payee bater com algum da lista use o nome exato.`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${RECEIPT_AI_MODEL}:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [
        { inline_data: { mime_type: pending.mediaType, data: pending.base64 } },
        { text: prompt },
      ]}],
      generationConfig: { maxOutputTokens: 2000, temperature: 0.1 },
    }),
  });
  if (!resp.ok) { const err = await resp.json().catch(() => ({})); throw new Error(err?.error?.message || `HTTP ${resp.status}`); }
  const data  = await resp.json();
  const text  = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const clean = text.replace(/```json|```/g, '').trim();
  let parsed;
  try { parsed = JSON.parse(clean); } catch { throw new Error('Resposta inválida da IA'); }
  if (parsed.error) throw new Error(parsed.error);
  return parsed;
}


/* ══════════════════════════════════════════════════════════════════
   ADD TO GROCERY LIST — from the prices page
══════════════════════════════════════════════════════════════════ */

let _addToGrocery_item = null;

async function openAddToGroceryList(itemId, itemName, itemUnit, lastPrice) {
  _addToGrocery_item = { id: itemId, name: itemName, unit: itemUnit || 'un', lastPrice };

  if (typeof _loadGroceryLists === 'function' && (!_grocery.lists || !_grocery.lists.length)) {
    try { await _loadGroceryLists(); } catch(e) { console.warn('[prices→grocery]', e.message); }
  }

  const listSel = document.getElementById('addToGroceryListSel');
  const itemLbl = document.getElementById('addToGroceryItemLabel');
  const qtyEl   = document.getElementById('addToGroceryQty');
  const priceEl = document.getElementById('addToGroceryPrice');

  if (itemLbl) itemLbl.textContent = itemName + (itemUnit && itemUnit !== 'un' ? ` (${itemUnit})` : '');
  if (qtyEl)   qtyEl.value   = '1';
  if (priceEl) priceEl.value = lastPrice != null ? Number(lastPrice).toFixed(2) : '';

  if (listSel) {
    const lists = (_grocery.lists || []).filter(l => l.status !== 'done');
    if (!lists.length) {
      listSel.innerHTML = '<option value="">— Crie uma lista no Mercado primeiro —</option>';
    } else {
      listSel.innerHTML = '<option value="">Selecione a lista…</option>' +
        lists.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
      if (_grocery.currentList) listSel.value = _grocery.currentList;
    }
  }

  if (typeof openModal === 'function') openModal('addToGroceryModal');
}

async function confirmAddToGroceryList() {
  const item   = _addToGrocery_item;
  if (!item) return;

  const listId = document.getElementById('addToGroceryListSel')?.value;
  const qty    = parseFloat(document.getElementById('addToGroceryQty')?.value) || 1;
  const price  = parseFloat(document.getElementById('addToGroceryPrice')?.value) || null;

  if (!listId) { toast('Selecione uma lista', 'error'); return; }

  const btn = document.getElementById('addToGroceryConfirmBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Adicionando…'; }

  try {
    const { error } = await sb.from('grocery_items').insert({
      list_id:         listId,
      family_id:       famId(),
      name:            item.name,
      unit:            item.unit,
      qty,
      price_item_id:   item.id,
      suggested_price: price,
      needs_mapping:   false,
      checked:         false,
    });
    if (error) throw error;

    await sb.from('grocery_lists')
      .update({ status: 'open', updated_at: new Date().toISOString() })
      .eq('id', listId);

    if (typeof _loadGroceryLists === 'function') await _loadGroceryLists().catch(() => {});

    if (_grocery.currentList === listId && typeof _loadGroceryItems === 'function') {
      await _loadGroceryItems(listId);
      if (typeof _renderGroceryItems === 'function') _renderGroceryItems();
    }

    const listName = (_grocery.lists || []).find(l => l.id === listId)?.name || 'lista';
    toast(`✅ "${item.name}" adicionado à lista "${listName}"`, 'success');
    if (typeof closeModal === 'function') closeModal('addToGroceryModal');
    _addToGrocery_item = null;
  } catch(e) {
    toast('Erro ao adicionar: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Adicionar'; }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GERENCIADOR DE SUBCATEGORIAS & TIPOS  (openPxHierManager)
// CRUD completo: criar, renomear, excluir subcategorias e tipos.
// Ao excluir uma subcategoria, limpa todos os vínculos de itens afetados.
// ─────────────────────────────────────────────────────────────────────────────

async function openPxHierManager() {
  // Garante dados frescos
  if (_pxHierCache     === null) await _pxHierLoad();
  if (_pxItemMetaCache === null) await _pxItemMetaLoad();

  // Popula select de categorias com todas as que têm dados OU que existem no hierarchy
  const catSel = document.getElementById('pxhmCatSel');
  if (catSel) {
    const usedCatIds = new Set([
      ..._px.items.map(i => i.category_id).filter(Boolean),
      ...Object.keys(_pxHierCache || {}).filter(k => k !== '__none__'),
    ]);
    const cats = (state.categories || [])
      .filter(c => c.type !== 'income')
      .sort((a, b) => a.name.localeCompare(b.name));
    catSel.innerHTML = '<option value="">— Sem categoria —</option>' +
      cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    catSel.value = '';
  }

  openModal('pxHierManagerModal');
  pxhmLoadCat();
}
window.openPxHierManager = openPxHierManager;

// Renderiza lista de subcategorias para o catId selecionado
function pxhmLoadCat() {
  const catId = document.getElementById('pxhmCatSel')?.value || null;
  _pxhmRender(catId);
}
window.pxhmLoadCat = pxhmLoadCat;

function _pxhmRender(catId) {
  const el = document.getElementById('pxhmSubcatList');
  if (!el) return;

  const subcats = _pxSubcatsForCat(catId);

  if (!subcats.length) {
    el.innerHTML = `
      <div style="text-align:center;padding:32px;color:var(--muted)">
        <div style="font-size:2rem;margin-bottom:8px;opacity:.4">🏷️</div>
        <div style="font-size:.85rem;font-weight:600;margin-bottom:4px">Nenhuma subcategoria</div>
        <div style="font-size:.78rem">Clique em <strong>+ Nova subcategoria</strong> para começar.</div>
      </div>`;
    return;
  }

  // Count how many items are bound to each subcat/type
  const meta = _pxItemMetaCache || {};
  const countBySubcat = {};
  const countByType   = {};
  Object.values(meta).forEach(v => {
    const parts = (v || '').split(__SEP__);
    if (parts.length < 2) return;
    const [mCatId, mSubcatKey, mTypeLabel] = parts;
    const groupCatId = catId || null;
    if ((groupCatId ? mCatId === groupCatId : !mCatId || mCatId === '') || catId === null) {
      const sk = mSubcatKey;
      if (sk) {
        countBySubcat[sk] = (countBySubcat[sk] || 0) + 1;
        if (mTypeLabel) {
          const tk = sk + '||' + mTypeLabel;
          countByType[tk] = (countByType[tk] || 0) + 1;
        }
      }
    }
  });

  el.innerHTML = subcats.map(sub => {
    const itemCount = countBySubcat[sub.key] || 0;
    const types = sub.types || [];

    const typeRows = types.length ? types.map(tl => {
      const tc = countByType[sub.key + '||' + tl] || 0;
      return `<div class="pxhm-type-row" id="pxhmType_${esc(sub.key)}_${esc(tl)}">
        <span class="pxhm-type-dot"></span>
        <span class="pxhm-type-label" id="pxhmTypeLbl_${esc(sub.key)}_${esc(tl)}">${esc(tl)}</span>
        ${tc ? `<span class="pxhm-badge">${tc} item${tc !== 1 ? 's' : ''}</span>` : ''}
        <div class="pxhm-type-actions">
          <button class="pxhm-btn-icon" title="Renomear tipo"
            onclick="pxhmRenameType('${esc(catId||'')}','${esc(sub.key)}','${esc(tl)}')" >✏️</button>
          <button class="pxhm-btn-icon pxhm-btn-del" title="Excluir tipo"
            onclick="pxhmDeleteType('${esc(catId||'')}','${esc(sub.key)}','${esc(tl)}',${tc})">🗑</button>
        </div>
      </div>`;
    }).join('') : `<div class="pxhm-type-empty">Nenhum tipo — clique em <strong>+ Tipo</strong></div>`;

    return `<div class="pxhm-subcat-block" id="pxhmSub_${esc(sub.key)}">
      <div class="pxhm-subcat-header">
        <div class="pxhm-subcat-dot"></div>
        <span class="pxhm-subcat-label" id="pxhmSubLbl_${esc(sub.key)}">${esc(sub.label)}</span>
        ${itemCount ? `<span class="pxhm-badge pxhm-badge-main">${itemCount} item${itemCount !== 1 ? 's' : ''}</span>` : ''}
        <div class="pxhm-subcat-actions">
          <button class="pxhm-btn-sm" title="Adicionar tipo"
            onclick="pxhmAddType('${esc(catId||'')}','${esc(sub.key)}')">+ Tipo</button>
          <button class="pxhm-btn-icon" title="Renomear subcategoria"
            onclick="pxhmRenameSubcat('${esc(catId||'')}','${esc(sub.key)}','${esc(sub.label)}')">✏️</button>
          <button class="pxhm-btn-icon pxhm-btn-del" title="Excluir subcategoria"
            onclick="pxhmDeleteSubcat('${esc(catId||'')}','${esc(sub.key)}','${esc(sub.label)}',${itemCount})">🗑</button>
        </div>
      </div>
      <div class="pxhm-types-list">${typeRows}</div>
    </div>`;
  }).join('');

  // Inject scoped CSS once
  if (!document.getElementById('pxhmStyle')) {
    const s = document.createElement('style');
    s.id = 'pxhmStyle';
    s.textContent = `
      .pxhm-subcat-block { border:1px solid var(--border); border-radius:10px; margin-bottom:10px; overflow:hidden; }
      .pxhm-subcat-header { display:flex; align-items:center; gap:8px; padding:10px 14px; background:var(--surface2); flex-wrap:wrap; }
      .pxhm-subcat-dot { width:10px; height:10px; border-radius:50%; background:var(--accent); flex-shrink:0; }
      .pxhm-subcat-label { font-weight:700; font-size:.88rem; color:var(--text); flex:1; min-width:0; }
      .pxhm-subcat-actions { display:flex; gap:4px; align-items:center; margin-left:auto; flex-shrink:0; }
      .pxhm-types-list { padding:8px 14px 10px 14px; display:flex; flex-direction:column; gap:4px; background:var(--surface); }
      .pxhm-type-row { display:flex; align-items:center; gap:8px; padding:6px 8px; border-radius:7px; background:var(--bg2); }
      .pxhm-type-dot { width:6px; height:6px; border-radius:50%; background:var(--muted); flex-shrink:0; }
      .pxhm-type-label { font-size:.82rem; color:var(--text); flex:1; min-width:0; }
      .pxhm-type-actions { display:flex; gap:3px; margin-left:auto; flex-shrink:0; }
      .pxhm-type-empty { font-size:.75rem; color:var(--muted); padding:4px 8px; font-style:italic; }
      .pxhm-badge { font-size:.65rem; font-weight:700; padding:2px 7px; border-radius:99px; background:var(--accent-lt); color:var(--accent); white-space:nowrap; }
      .pxhm-badge-main { background:rgba(42,96,73,.12); color:var(--accent); }
      .pxhm-btn-sm { font-size:.72rem; font-weight:700; font-family:var(--font-sans); padding:4px 9px; border-radius:6px; border:1.5px solid var(--accent); background:transparent; color:var(--accent); cursor:pointer; white-space:nowrap; transition:all .15s; }
      .pxhm-btn-sm:hover { background:var(--accent); color:#fff; }
      .pxhm-btn-icon { background:none; border:none; cursor:pointer; font-size:.88rem; padding:3px 5px; border-radius:5px; transition:background .12s; line-height:1; }
      .pxhm-btn-icon:hover { background:var(--surface2); }
      .pxhm-btn-del:hover { background:rgba(192,57,43,.1); }
      .pxhm-inline-edit { display:flex; align-items:center; gap:6px; }
      .pxhm-inline-input { font-size:.85rem; font-family:var(--font-sans); padding:4px 8px; border:1.5px solid var(--accent); border-radius:6px; background:var(--surface); color:var(--text); flex:1; outline:none; }
      .pxhm-save-btn { font-size:.75rem; font-weight:700; font-family:var(--font-sans); padding:4px 10px; border-radius:6px; border:none; background:var(--accent); color:#fff; cursor:pointer; white-space:nowrap; }
      .pxhm-cancel-btn { font-size:.75rem; font-family:var(--font-sans); padding:4px 8px; border-radius:6px; border:1px solid var(--border); background:transparent; color:var(--text2); cursor:pointer; }
    `;
    document.head.appendChild(s);
  }
}

// ── ADD SUBCAT ───────────────────────────────────────────────────────────────
async function pxhmAddSubcat() {
  const catId = document.getElementById('pxhmCatSel')?.value || null;
  const catName = document.getElementById('pxhmCatSel')?.selectedOptions?.[0]?.text || 'Sem categoria';

  // Inline input na área de lista
  const el = document.getElementById('pxhmSubcatList');
  if (!el) return;

  // Check se já há um input inline aberto
  if (document.getElementById('pxhmNewSubcatInput')) return;

  const addRow = document.createElement('div');
  addRow.style.cssText = 'margin-bottom:10px;padding:10px 14px;border:1.5px dashed var(--accent);border-radius:10px;background:var(--accent-lt)';
  addRow.innerHTML = `
    <div style="font-size:.72rem;font-weight:700;color:var(--accent);margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em">Nova subcategoria em "${esc(catName)}"</div>
    <div class="pxhm-inline-edit">
      <input id="pxhmNewSubcatInput" class="pxhm-inline-input" type="text"
        placeholder="Ex: Bebidas, Laticínios, Frios…" autocomplete="off"
        onkeydown="if(event.key==='Enter')pxhmConfirmAddSubcat('${esc(catId||'')}');if(event.key==='Escape')this.closest('[style]').remove()">
      <button class="pxhm-save-btn" onclick="pxhmConfirmAddSubcat('${esc(catId||'')}')">Adicionar</button>
      <button class="pxhm-cancel-btn" onclick="this.closest('[style]').remove()">✕</button>
    </div>`;
  el.insertBefore(addRow, el.firstChild);
  document.getElementById('pxhmNewSubcatInput')?.focus();
}
window.pxhmAddSubcat = pxhmAddSubcat;

async function pxhmConfirmAddSubcat(catId) {
  const inp = document.getElementById('pxhmNewSubcatInput');
  const label = inp?.value?.trim();
  if (!label) { inp?.focus(); return; }
  inp.disabled = true;
  const key = await _pxAddSubcat(catId || null, label);
  inp.closest('[style]')?.remove();
  if (key) {
    toast(`✓ Subcategoria "${label}" criada`, 'success');
    _pxhmRender(catId || null);
    // Refresh filtros da página
    _populatePxSubcatFilter();
  } else {
    toast('Erro ao criar subcategoria', 'error');
  }
}
window.pxhmConfirmAddSubcat = pxhmConfirmAddSubcat;

// ── RENAME SUBCAT ────────────────────────────────────────────────────────────
async function pxhmRenameSubcat(catId, subcatKey, currentLabel) {
  const headerEl = document.getElementById(`pxhmSub_${subcatKey}`)?.querySelector('.pxhm-subcat-header');
  if (!headerEl) return;
  const lblEl = document.getElementById(`pxhmSubLbl_${subcatKey}`);
  if (!lblEl) return;

  // Replace label with inline input
  const orig = lblEl.outerHTML;
  lblEl.outerHTML = `<div class="pxhm-inline-edit" style="flex:1;min-width:0">
    <input id="pxhmRenameSubInput_${subcatKey}" class="pxhm-inline-input" type="text"
      value="${esc(currentLabel)}" autocomplete="off"
      onkeydown="if(event.key==='Enter')pxhmConfirmRenameSubcat('${esc(catId)}','${esc(subcatKey)}');if(event.key==='Escape')pxhmLoadCat()">
    <button class="pxhm-save-btn" onclick="pxhmConfirmRenameSubcat('${esc(catId)}','${esc(subcatKey)}')">Salvar</button>
    <button class="pxhm-cancel-btn" onclick="pxhmLoadCat()">✕</button>
  </div>`;
  document.getElementById(`pxhmRenameSubInput_${subcatKey}`)?.select();
}
window.pxhmRenameSubcat = pxhmRenameSubcat;

async function pxhmConfirmRenameSubcat(catId, subcatKey) {
  const inp = document.getElementById(`pxhmRenameSubInput_${subcatKey}`);
  const newLabel = inp?.value?.trim();
  if (!newLabel) { inp?.focus(); return; }

  const hierKey = catId || '__none__';
  if (!_pxHierCache?.[hierKey]?.subcategories?.[subcatKey]) {
    toast('Subcategoria não encontrada', 'error'); return;
  }
  _pxHierCache[hierKey].subcategories[subcatKey].label = newLabel;
  await _pxHierSave();
  toast(`✓ Renomeada para "${newLabel}"`, 'success');
  _pxhmRender(catId || null);
  _populatePxSubcatFilter();
  _renderPricesPage();
}
window.pxhmConfirmRenameSubcat = pxhmConfirmRenameSubcat;

// ── DELETE SUBCAT ────────────────────────────────────────────────────────────
async function pxhmDeleteSubcat(catId, subcatKey, label, itemCount) {
  const msg = itemCount
    ? `Excluir a subcategoria "${label}"?\n\nAtenção: ${itemCount} item(s) perderão este vínculo. O histórico de preços não será afetado.`
    : `Excluir a subcategoria "${label}"?`;
  if (!confirm(msg)) return;

  const hierKey = catId || '__none__';

  // Remove da hierarquia
  if (_pxHierCache?.[hierKey]?.subcategories?.[subcatKey]) {
    delete _pxHierCache[hierKey].subcategories[subcatKey];
    // Limpa hierKey vazio
    if (!Object.keys(_pxHierCache[hierKey].subcategories).length) {
      delete _pxHierCache[hierKey];
    }
    await _pxHierSave();
  }

  // Remove vínculos de itens afetados do item meta
  if (_pxItemMetaCache) {
    let changed = false;
    for (const [itemId, val] of Object.entries(_pxItemMetaCache)) {
      const parts = (val || '').split(__SEP__);
      if (parts[0] === (catId || '') && parts[1] === subcatKey) {
        delete _pxItemMetaCache[itemId];
        changed = true;
      }
    }
    if (changed) await _pxItemMetaSave();
  }

  toast(`✓ Subcategoria "${label}" excluída`, 'success');
  _pxhmRender(catId || null);
  _populatePxSubcatFilter();
  _renderPricesPage();
}
window.pxhmDeleteSubcat = pxhmDeleteSubcat;

// ── ADD TYPE ─────────────────────────────────────────────────────────────────
async function pxhmAddType(catId, subcatKey) {
  const typesListEl = document.querySelector(`#pxhmSub_${subcatKey} .pxhm-types-list`);
  if (!typesListEl) return;
  if (document.getElementById(`pxhmNewTypeInput_${subcatKey}`)) return;

  const addRow = document.createElement('div');
  addRow.style.cssText = 'padding:6px 8px;border:1.5px dashed var(--accent);border-radius:7px;background:var(--accent-lt);margin-top:4px';
  addRow.innerHTML = `
    <div class="pxhm-inline-edit">
      <input id="pxhmNewTypeInput_${subcatKey}" class="pxhm-inline-input" type="text"
        placeholder="Ex: Refrigerante, Integral, Gasolina…" autocomplete="off"
        onkeydown="if(event.key==='Enter')pxhmConfirmAddType('${esc(catId)}','${esc(subcatKey)}');if(event.key==='Escape')this.closest('[style]').remove()">
      <button class="pxhm-save-btn" onclick="pxhmConfirmAddType('${esc(catId)}','${esc(subcatKey)}')">Adicionar</button>
      <button class="pxhm-cancel-btn" onclick="this.closest('[style]').remove()">✕</button>
    </div>`;
  typesListEl.appendChild(addRow);
  document.getElementById(`pxhmNewTypeInput_${subcatKey}`)?.focus();
}
window.pxhmAddType = pxhmAddType;

async function pxhmConfirmAddType(catId, subcatKey) {
  const inp = document.getElementById(`pxhmNewTypeInput_${subcatKey}`);
  const typeLabel = inp?.value?.trim();
  if (!typeLabel) { inp?.focus(); return; }
  inp.disabled = true;
  await _pxAddType(catId || null, subcatKey, typeLabel);
  inp.closest('[style]')?.remove();
  toast(`✓ Tipo "${typeLabel}" adicionado`, 'success');
  _pxhmRender(catId || null);
  // Refresh tipo no formulário de item se aberto
  const pifCat = document.getElementById('pifCategory')?.value;
  const pifSub = document.getElementById('pifSubcat')?.value;
  if (pifCat === (catId || '') && pifSub === subcatKey) {
    _pxPopulateFormTypes(catId || null, subcatKey);
  }
}
window.pxhmConfirmAddType = pxhmConfirmAddType;

// ── RENAME TYPE ──────────────────────────────────────────────────────────────
async function pxhmRenameType(catId, subcatKey, typeLabel) {
  const rowEl = document.getElementById(`pxhmType_${subcatKey}_${typeLabel}`);
  const lblEl = document.getElementById(`pxhmTypeLbl_${subcatKey}_${typeLabel}`);
  if (!rowEl || !lblEl) return;

  const safeKey = subcatKey + '_' + typeLabel.replace(/[^a-z0-9]/gi, '_');
  lblEl.outerHTML = `<div class="pxhm-inline-edit" style="flex:1;min-width:0">
    <input id="pxhmRenameTypeInput_${safeKey}" class="pxhm-inline-input" type="text"
      value="${esc(typeLabel)}" autocomplete="off"
      onkeydown="if(event.key==='Enter')pxhmConfirmRenameType('${esc(catId)}','${esc(subcatKey)}','${esc(typeLabel)}','${safeKey}');if(event.key==='Escape')pxhmLoadCat()">
    <button class="pxhm-save-btn" onclick="pxhmConfirmRenameType('${esc(catId)}','${esc(subcatKey)}','${esc(typeLabel)}','${safeKey}')">Salvar</button>
    <button class="pxhm-cancel-btn" onclick="pxhmLoadCat()">✕</button>
  </div>`;
  document.getElementById(`pxhmRenameTypeInput_${safeKey}`)?.select();
}
window.pxhmRenameType = pxhmRenameType;

async function pxhmConfirmRenameType(catId, subcatKey, oldLabel, safeKey) {
  const inp = document.getElementById(`pxhmRenameTypeInput_${safeKey}`);
  const newLabel = inp?.value?.trim();
  if (!newLabel || newLabel === oldLabel) { inp?.focus(); return; }

  const hierKey = catId || '__none__';
  const types = _pxHierCache?.[hierKey]?.subcategories?.[subcatKey]?.types;
  if (!types) { toast('Tipo não encontrado', 'error'); return; }

  const idx = types.indexOf(oldLabel);
  if (idx !== -1) types[idx] = newLabel;
  await _pxHierSave();

  // Atualiza vínculos de itens: substitui o typeLabel antigo pelo novo
  if (_pxItemMetaCache) {
    let changed = false;
    for (const [itemId, val] of Object.entries(_pxItemMetaCache)) {
      const parts = (val || '').split(__SEP__);
      if (parts[0] === (catId || '') && parts[1] === subcatKey && parts[2] === oldLabel) {
        _pxItemMetaCache[itemId] = [parts[0], parts[1], newLabel].join(__SEP__);
        changed = true;
      }
    }
    if (changed) await _pxItemMetaSave();
  }

  toast(`✓ Tipo renomeado para "${newLabel}"`, 'success');
  _pxhmRender(catId || null);
}
window.pxhmConfirmRenameType = pxhmConfirmRenameType;

// ── DELETE TYPE ──────────────────────────────────────────────────────────────
async function pxhmDeleteType(catId, subcatKey, typeLabel, itemCount) {
  const msg = itemCount
    ? `Excluir o tipo "${typeLabel}"?\n\n${itemCount} item(s) perderão este tipo (a subcategoria é mantida).`
    : `Excluir o tipo "${typeLabel}"?`;
  if (!confirm(msg)) return;

  const hierKey = catId || '__none__';
  const types = _pxHierCache?.[hierKey]?.subcategories?.[subcatKey]?.types;
  if (types) {
    const idx = types.indexOf(typeLabel);
    if (idx !== -1) types.splice(idx, 1);
    await _pxHierSave();
  }

  // Remove typeLabel dos vínculos de itens afetados (mantém subcategoria)
  if (_pxItemMetaCache) {
    let changed = false;
    for (const [itemId, val] of Object.entries(_pxItemMetaCache)) {
      const parts = (val || '').split(__SEP__);
      if (parts[0] === (catId || '') && parts[1] === subcatKey && parts[2] === typeLabel) {
        // Mantém catId + subcatKey, remove typeLabel
        _pxItemMetaCache[itemId] = [parts[0], parts[1], ''].join(__SEP__);
        changed = true;
      }
    }
    if (changed) await _pxItemMetaSave();
  }

  toast(`✓ Tipo "${typeLabel}" excluído`, 'success');
  _pxhmRender(catId || null);
  // Refresh form se aberto
  const pifCat = document.getElementById('pifCategory')?.value;
  const pifSub = document.getElementById('pifSubcat')?.value;
  if (pifCat === (catId || '') && pifSub === subcatKey) {
    _pxPopulateFormTypes(catId || null, subcatKey);
  }
}
window.pxhmDeleteType = pxhmDeleteType;
