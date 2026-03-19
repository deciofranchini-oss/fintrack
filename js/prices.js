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
  storeFilter:   '',
  pidStoreFilter: '',
};

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
  const anyOn = ['groceryNav','pricesNav','investmentsNav'].some(id => {
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
  _px.search = _px.catFilter = _px.storeFilter = '';
  const searchEl = document.getElementById('pricesSearch');
  if (searchEl) searchEl.value = '';
  _populatePricesCatFilter();
  await _loadPricesData();
  _populatePricesStoreFilter();
  _renderPricesPage();
}

function _populatePricesCatFilter() {
  const sel = document.getElementById('pricesCatFilter');
  if (!sel) return;
  const exp = (state.categories || []).filter(c => c.type !== 'income');
  sel.innerHTML = '<option value="">Todas as categorias</option>' +
    exp.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
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
  if (_px.catFilter) items = items.filter(i => i.category_id === _px.catFilter);
  const countEl = document.getElementById('pricesCount');
  if (countEl) countEl.textContent = items.length + (items.length !== 1 ? ' itens' : ' item');
  if (!items.length) {
    listEl.innerHTML = `
      <div class="prices-empty">
        <div style="font-size:2.8rem;margin-bottom:12px">🏷️</div>
        <div style="font-weight:700;font-size:.95rem;margin-bottom:6px">Nenhum item cadastrado</div>
        <div style="font-size:.82rem;color:var(--muted);max-width:280px;text-align:center;line-height:1.55">
          Registre preços ao incluir transações com recibo lido por IA,<br>ou clique em <strong>+ Novo Item</strong>.
        </div>
      </div>`;
    return;
  }
  listEl.innerHTML = `<div class="px-grid">` +
    items.map(item => {
      const avg  = item.avg_price  != null ? fmt(item.avg_price)  : null;
      const last = item.last_price != null ? fmt(item.last_price) : null;
      const cnt  = item.record_count || 0;
      const cat  = item.categories?.name  || '';
      const catColor = item.categories?.color || 'var(--accent)';

      // Trend arrow: compare last vs avg
      let trend = '';
      if (item.avg_price != null && item.last_price != null) {
        if      (item.last_price > item.avg_price * 1.02) trend = '<span class="px-trend up">↑</span>';
        else if (item.last_price < item.avg_price * 0.98) trend = '<span class="px-trend dn">↓</span>';
        else                                               trend = '<span class="px-trend eq">→</span>';
      }

      // Visual avatar: first 2 chars of item name, coloured by category
      const initials = item.name.trim().slice(0,2).toUpperCase();
      const unitBadge = (item.unit && item.unit !== 'un')
        ? `<span class="px-unit">${esc(item.unit)}</span>` : '';

      return `
      <div class="px-card" onclick="openPriceItemDetail('${item.id}')"
           style="--px-clr:${catColor}">
        <div class="px-card-top">
          <div class="px-avatar" style="background:color-mix(in srgb,${catColor} 15%,transparent);color:${catColor}">${initials}</div>
          ${cat ? `<span class="px-cat-badge" style="color:${catColor};background:color-mix(in srgb,${catColor} 12%,transparent)">${esc(cat)}</span>` : ''}
          <button class="px-cart-btn" title="Adicionar à lista de compras"
                  onclick="event.stopPropagation();openAddToGroceryList('${item.id}','${esc(item.name).replace(/'/g,'\u0027')}','${esc(item.unit||'un')}',${item.last_price ?? 'null'})">
            🛒
          </button>
        </div>
        <div class="px-name">${esc(item.name)}${unitBadge}</div>
        ${item.description ? `<div class="px-desc">${esc(item.description)}</div>` : ''}
        <div class="px-prices">
          <div class="px-price-col">
            <span class="px-price-lbl">Preço médio</span>
            <span class="px-price-val">${avg ?? '—'}</span>
          </div>
          <div class="px-price-col">
            <span class="px-price-lbl">Último ${trend}</span>
            <span class="px-price-val ${item.last_price != null ? 'accent' : ''}">${last ?? '—'}</span>
          </div>
          <div class="px-price-col">
            <span class="px-price-lbl">Registros</span>
            <span class="px-price-val">${cnt}</span>
          </div>
        </div>
        <div class="px-card-footer">
          <div class="px-progress">
            <div class="px-progress-bar" style="width:${Math.min(100, cnt * 10)}%;background:${catColor}"></div>
          </div>
        </div>
      </div>`;
    }).join('') + `</div>`;
}

function pricesSearch(val)      { _px.search = val;      _renderPricesPage(); }
function pricesCatFilter(val)   { _px.catFilter = val;   _renderPricesPage(); }
function pricesStoreFilter(val) { _px.storeFilter = val; _renderPricesPage(); }

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

function _openItemForm(item) {
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
  const rawItems = aiResult.items || [];
  _renderRpmRows(rawItems.length ? rawItems : [{ ai_name: aiResult.description || '', quantity: 1, unit_price: aiResult.amount || 0 }]);
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
  const rows = document.querySelectorAll('tr.rpm-row');
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
    const rows = document.querySelectorAll('tr.rpm-row');
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
