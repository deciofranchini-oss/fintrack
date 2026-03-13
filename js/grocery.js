/* ═══════════════════════════════════════════════════════════════════════════
   grocery.js — Lista de Mercado (Feature 4)
   Módulo opcional por família — habilitado em Gestão de Famílias.
   Tabelas: grocery_lists, grocery_items
   Versão 1.0: criar listas, adicionar itens da base de preços,
               sugerir preço médio/último, marcar como comprado.
═══════════════════════════════════════════════════════════════════════════ */

const _grocery = {
  lists:       [],
  items:       [],
  currentList: null,
};

// ── Init ─────────────────────────────────────────────────────────────────────
async function initGroceryPage() {
  const on = typeof isGroceryEnabled === 'function' && await isGroceryEnabled();
  if (!on) {
    toast('Lista de Mercado não está ativa para esta família. Ative em Configurações → Famílias.', 'warning');
    navigate('dashboard');
    return;
  }
  await _loadGroceryLists();
  _renderGroceryLists();
}

async function _loadGroceryLists() {
  const { data, error } = await famQ(
    sb.from('grocery_lists')
      .select('id, name, created_at, updated_at, status')
      .order('updated_at', { ascending: false })
  );
  if (error) { toast('Erro ao carregar listas: ' + error.message, 'error'); return; }
  _grocery.lists = data || [];
}

async function _loadGroceryItems(listId) {
  const { data, error } = await sb.from('grocery_items')
    .select('id, list_id, name, qty, unit, checked, price_item_id, suggested_price, suggested_store, price_items(name), price_stores(name)')
    .eq('list_id', listId)
    .order('checked')
    .order('name');
  if (error) { toast('Erro ao carregar itens: ' + error.message, 'error'); return; }
  _grocery.items = data || [];
}

// ── List rendering ────────────────────────────────────────────────────────────
function _renderGroceryLists() {
  const container = document.getElementById('groceryListsContainer');
  if (!container) return;

  if (!_grocery.lists.length) {
    container.innerHTML = `
    <div class="card" style="text-align:center;padding:48px;color:var(--muted)">
      <div style="font-size:2.5rem;margin-bottom:12px;opacity:.4">🛒</div>
      <div style="font-weight:600;margin-bottom:6px">Nenhuma lista criada</div>
      <p style="font-size:.875rem">Crie uma lista de compras para organizar suas compras com base no histórico de preços.</p>
      <button class="btn btn-primary" style="margin-top:16px" onclick="openCreateGroceryList()">+ Nova Lista</button>
    </div>`;
    return;
  }

  container.innerHTML = _grocery.lists.map(list => {
    const date = list.updated_at ? new Date(list.updated_at).toLocaleDateString('pt-BR') : '';
    const statusBadge = list.status === 'done'
      ? '<span class="badge badge-green" style="font-size:.68rem">✓ Concluída</span>'
      : '<span class="badge" style="font-size:.68rem;background:var(--accent-lt);color:var(--accent)">Em aberto</span>';
    return `<div class="card grocery-list-card" style="margin-bottom:10px;cursor:pointer" onclick="openGroceryList('${list.id}')">
      <div style="display:flex;align-items:center;gap:12px;padding:4px 0">
        <div style="font-size:1.5rem">🛒</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:.9rem">${esc(list.name)}</div>
          <div style="font-size:.72rem;color:var(--muted);margin-top:2px">Atualizada: ${date} ${statusBadge}</div>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();deleteGroceryList('${list.id}','${esc(list.name)}')"
            style="color:var(--red);font-size:.72rem;padding:3px 8px">🗑️</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── Create list ───────────────────────────────────────────────────────────────
function openCreateGroceryList() {
  const el = document.getElementById('groceryNewListName');
  if (el) el.value = '';
  openModal('groceryCreateModal');
}

async function saveGroceryList() {
  const name = document.getElementById('groceryNewListName')?.value?.trim();
  if (!name) { toast('Informe o nome da lista', 'error'); return; }
  const { data, error } = await sb.from('grocery_lists').insert({
    name,
    family_id: famId(),
    status: 'open',
    updated_at: new Date().toISOString(),
  }).select().single();
  if (error) { toast('Erro ao criar lista: ' + error.message, 'error'); return; }
  closeModal('groceryCreateModal');
  toast('Lista criada!', 'success');
  await _loadGroceryLists();
  _renderGroceryLists();
  openGroceryList(data.id);
}

async function deleteGroceryList(id, name) {
  if (!confirm(`Excluir a lista "${name}"?`)) return;
  await sb.from('grocery_items').delete().eq('list_id', id);
  await sb.from('grocery_lists').delete().eq('id', id);
  toast('Lista removida', 'success');
  await _loadGroceryLists();
  _renderGroceryLists();
  const detail = document.getElementById('groceryDetailPanel');
  if (detail) detail.style.display = 'none';
}

// ── Open list detail ──────────────────────────────────────────────────────────
async function openGroceryList(listId) {
  _grocery.currentList = listId;
  await _loadGroceryItems(listId);
  const list = _grocery.lists.find(l => l.id === listId);
  const titleEl = document.getElementById('groceryDetailTitle');
  if (titleEl) titleEl.textContent = list?.name || 'Lista';
  _renderGroceryItems();
  const detail = document.getElementById('groceryDetailPanel');
  if (detail) { detail.style.display = ''; detail.scrollIntoView({ behavior: 'smooth' }); }
}

// ── Render items ──────────────────────────────────────────────────────────────
function _renderGroceryItems() {
  const container = document.getElementById('groceryItemsContainer');
  if (!container) return;

  const pending = _grocery.items.filter(i => !i.checked);
  const done    = _grocery.items.filter(i => !!i.checked);
  const total   = _grocery.items.reduce((s, i) => s + (parseFloat(i.suggested_price)||0) * (parseFloat(i.qty)||1), 0);
  const bought  = done.reduce((s, i) => s + (parseFloat(i.suggested_price)||0) * (parseFloat(i.qty)||1), 0);

  const totalEl = document.getElementById('groceryTotals');
  if (totalEl) totalEl.innerHTML = `
    <span style="font-size:.78rem;color:var(--muted)">${_grocery.items.length} item${_grocery.items.length!==1?'s':''}</span>
    ${total > 0 ? `<span style="font-size:.78rem;color:var(--muted)">· Est. ${fmt(total)}</span>` : ''}
    ${done.length > 0 ? `<span style="font-size:.78rem;color:var(--green,#16a34a)">· ${done.length} comprado${done.length!==1?'s':''} (${fmt(bought)})</span>` : ''}`;

  if (!_grocery.items.length) {
    container.innerHTML = `<div style="text-align:center;padding:32px;color:var(--muted);font-size:.875rem">
      Lista vazia. Adicione itens abaixo.</div>`;
    return;
  }

  const renderItem = i => {
    const store = i.price_stores?.name || i.suggested_store || '';
    const price = parseFloat(i.suggested_price);
    const priceHtml = price > 0 ? `<span style="font-size:.75rem;color:var(--muted)">${fmt(price)}/un</span>` : '';
    const storeHtml = store ? `<span style="font-size:.7rem;color:var(--muted)">📍 ${esc(store)}</span>` : '';
    return `<div class="grocery-item${i.checked?' grocery-item-done':''}" id="groceryItem-${i.id}">
      <button class="grocery-check-btn" onclick="toggleGroceryItem('${i.id}',${!i.checked})"
        style="width:24px;height:24px;border-radius:50%;border:2px solid ${i.checked?'var(--green,#16a34a)':'var(--border)'};
               background:${i.checked?'var(--green,#16a34a)':'transparent'};
               flex-shrink:0;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;font-size:.75rem">
        ${i.checked ? '✓' : ''}
      </button>
      <div style="flex:1;min-width:0">
        <div style="font-size:.875rem;font-weight:${i.checked?'400':'600'};
             ${i.checked?'text-decoration:line-through;color:var(--muted)':''}">${esc(i.name)}</div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:2px;flex-wrap:wrap">
          <span style="font-size:.75rem;color:var(--muted)">Qtd: <strong>${i.qty||1} ${esc(i.unit||'un')}</strong></span>
          ${priceHtml}${storeHtml}
        </div>
      </div>
      <button class="btn-icon" onclick="removeGroceryItem('${i.id}')" style="color:var(--muted);font-size:.78rem">✕</button>
    </div>`;
  };

  container.innerHTML =
    (pending.length ? `<div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);padding:8px 0 4px">A comprar (${pending.length})</div>` + pending.map(renderItem).join('') : '') +
    (done.length ? `<div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--green,#16a34a);padding:12px 0 4px;margin-top:4px">Comprados (${done.length})</div>` + done.map(renderItem).join('') : '');
}

// ── Toggle item checked ───────────────────────────────────────────────────────
async function toggleGroceryItem(itemId, checked) {
  await sb.from('grocery_items').update({ checked }).eq('id', itemId);
  const item = _grocery.items.find(i => i.id === itemId);
  if (item) item.checked = checked;
  _renderGroceryItems();
  // Mark list as done if all checked
  if (checked && _grocery.items.every(i => i.checked)) {
    await sb.from('grocery_lists').update({ status: 'done', updated_at: new Date().toISOString() }).eq('id', _grocery.currentList);
    const list = _grocery.lists.find(l => l.id === _grocery.currentList);
    if (list) list.status = 'done';
    _renderGroceryLists();
  }
}

async function removeGroceryItem(itemId) {
  await sb.from('grocery_items').delete().eq('id', itemId);
  _grocery.items = _grocery.items.filter(i => i.id !== itemId);
  _renderGroceryItems();
}

// ── Add item ──────────────────────────────────────────────────────────────────
function openAddGroceryItem() {
  const el = document.getElementById('groceryItemSearch');
  if (el) { el.value = ''; }
  document.getElementById('groceryItemSuggestions')?.style && (document.getElementById('groceryItemSuggestions').style.display = 'none');
  document.getElementById('groceryItemForm')?.style && (document.getElementById('groceryItemForm').style.display = 'none');
  openModal('groceryAddItemModal');
}

function searchGroceryItem(val) {
  const sugEl = document.getElementById('groceryItemSuggestions');
  if (!val || val.length < 2) { if (sugEl) sugEl.style.display = 'none'; return; }
  const q = val.toLowerCase();
  // Search in price_items
  const priceItems = (_px?.items || []).filter(i => i.name.toLowerCase().includes(q)).slice(0, 8);
  if (!sugEl) return;
  if (!priceItems.length) {
    sugEl.innerHTML = `<div style="padding:8px 12px;font-size:.8rem;color:var(--muted)">Nenhum item na base de preços — será criado novo</div>`;
    sugEl.style.display = '';
    // Pre-fill form with typed name
    _fillGroceryItemForm(null, val);
    return;
  }
  sugEl.style.display = '';
  sugEl.innerHTML = priceItems.map(item => {
    // Find last price
    const lastHistory = item.last_price || null;
    return `<div style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);font-size:.85rem"
       onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''"
       onclick="_fillGroceryItemForm('${item.id}','${esc(item.name).replace(/'/g,"\\'")}')">
      <strong>${esc(item.name)}</strong>
      ${lastHistory ? `<span style="float:right;font-size:.75rem;color:var(--accent)">${fmt(lastHistory)}</span>` : ''}
    </div>`;
  }).join('') + `<div style="padding:8px 12px;cursor:pointer;font-size:.8rem;color:var(--accent)"
     onclick="_fillGroceryItemForm(null,'${esc(val).replace(/'/g,"\\'")}')">
    + Adicionar "${esc(val)}" como novo item
  </div>`;
}

async function _fillGroceryItemForm(priceItemId, name) {
  const formEl = document.getElementById('groceryItemForm');
  const nameEl = document.getElementById('groceryNewItemName');
  const qtyEl  = document.getElementById('groceryNewItemQty');
  const priceEl= document.getElementById('groceryNewItemPrice');
  const storeEl= document.getElementById('groceryNewItemStore');
  const hidEl  = document.getElementById('groceryNewItemPriceItemId');
  const sugEl  = document.getElementById('groceryItemSuggestions');

  if (sugEl) sugEl.style.display = 'none';
  if (formEl) formEl.style.display = '';
  if (nameEl) nameEl.value = name || '';
  if (hidEl)  hidEl.value  = priceItemId || '';
  if (qtyEl)  qtyEl.value  = '1';

  // Fetch suggested price from history
  if (priceItemId && priceEl) {
    try {
      const { data } = await sb.from('price_history')
        .select('unit_price, store_id, price_stores(name)')
        .eq('item_id', priceItemId)
        .eq('family_id', famId())
        .order('purchased_at', { ascending: false })
        .limit(1)
        .single();
      if (data) {
        priceEl.value = data.unit_price?.toFixed(2) || '';
        if (storeEl && data.price_stores?.name) storeEl.value = data.price_stores.name;
      }
    } catch {}
  }
}

async function confirmAddGroceryItem() {
  const listId    = _grocery.currentList;
  if (!listId) { toast('Nenhuma lista aberta.', 'error'); return; }
  const name      = document.getElementById('groceryNewItemName')?.value?.trim();
  const qty       = parseFloat(document.getElementById('groceryNewItemQty')?.value) || 1;
  const price     = parseFloat(document.getElementById('groceryNewItemPrice')?.value) || null;
  const store     = document.getElementById('groceryNewItemStore')?.value?.trim() || null;
  const itemId    = document.getElementById('groceryNewItemPriceItemId')?.value || null;
  if (!name) { toast('Informe o nome do item', 'error'); return; }

  const { error } = await sb.from('grocery_items').insert({
    list_id: listId,
    name,
    qty,
    price_item_id: itemId || null,
    suggested_price: price,
    suggested_store: store,
    checked: false,
    family_id: famId(),
  });
  if (error) { toast('Erro ao adicionar item: ' + error.message, 'error'); return; }

  closeModal('groceryAddItemModal');
  await _loadGroceryItems(listId);
  _renderGroceryItems();
  toast('Item adicionado!', 'success');
  // Reopen list and update it
  await sb.from('grocery_lists').update({ status: 'open', updated_at: new Date().toISOString() }).eq('id', listId);
  const list = _grocery.lists.find(l => l.id === listId);
  if (list) list.status = 'open';
  _renderGroceryLists();
}
