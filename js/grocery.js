/* ═══════════════════════════════════════════════════════════════════════════
   grocery.js — Lista de Mercado v2.0
   ─────────────────────────────────────────────────────────────────────────
   Melhorias v2:
   • Seleção de itens da base de preços (price_items) com busca em tempo real
   • Criação de novos itens diretamente na lista (sem price_item_id obrigatório)
   • Campo "novo item" marcado como pendente de mapeamento (needs_mapping=true)
   • Botão "Registrar Compra com IA": envia foto/PDF de recibo → Gemini Vision
     extrai itens linha a linha → tenta equivalência com itens da lista por
     nome (fuzzy) e com price_items → salva price_history + atualiza sugestões
   • Equivalência inteligente: IA recebe lista de itens da lista + price_items
     e devolve JSON com mapeamentos e preços por item
   ─────────────────────────────────────────────────────────────────────────
   Tabelas: grocery_lists, grocery_items, price_items, price_history
═══════════════════════════════════════════════════════════════════════════ */

const _grocery = {
  lists:       [],
  items:       [],
  currentList: null,
};

// ─────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────
async function initGroceryPage() {
  const on = typeof isGroceryEnabled === 'function' && await isGroceryEnabled();
  if (!on) {
    toast('Lista de Mercado não está ativa. Ative em Administração → Famílias.', 'warning');
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
    .select('id, list_id, name, qty, unit, checked, price_item_id, suggested_price, suggested_store, needs_mapping, price_items(id,name,unit)')
    .eq('list_id', listId)
    .order('checked')
    .order('name');
  if (error) { toast('Erro ao carregar itens: ' + error.message, 'error'); return; }
  _grocery.items = data || [];
}

// ─────────────────────────────────────────────────────────────────────────
// RENDER — LISTAS
// ─────────────────────────────────────────────────────────────────────────
function _renderGroceryLists() {
  const container = document.getElementById('groceryListsContainer');
  if (!container) return;

  if (!_grocery.lists.length) {
    container.innerHTML = `
    <div class="card" style="text-align:center;padding:48px;color:var(--muted)">
      <div style="font-size:2.5rem;margin-bottom:12px;opacity:.4">🛒</div>
      <div style="font-weight:600;margin-bottom:6px">Nenhuma lista criada</div>
      <p style="font-size:.875rem">Crie uma lista e adicione itens do seu histórico de preços.</p>
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

// ─────────────────────────────────────────────────────────────────────────
// CRUD — LISTAS
// ─────────────────────────────────────────────────────────────────────────
function openCreateGroceryList() {
  const el = document.getElementById('groceryNewListName');
  if (el) el.value = '';
  openModal('groceryCreateModal');
}

async function saveGroceryList() {
  const name = document.getElementById('groceryNewListName')?.value?.trim();
  if (!name) { toast('Informe o nome da lista', 'error'); return; }
  const { data, error } = await sb.from('grocery_lists').insert({
    name, family_id: famId(), status: 'open',
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

// ─────────────────────────────────────────────────────────────────────────
// DETALHE DA LISTA
// ─────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────
// RENDER — ITENS
// ─────────────────────────────────────────────────────────────────────────
function _renderGroceryItems() {
  const container = document.getElementById('groceryItemsContainer');
  if (!container) return;

  const pending = _grocery.items.filter(i => !i.checked);
  const done    = _grocery.items.filter(i => !!i.checked);
  const total   = _grocery.items.reduce((s, i) => s + (parseFloat(i.suggested_price)||0) * (parseFloat(i.qty)||1), 0);
  const bought  = done.reduce((s, i) => s + (parseFloat(i.suggested_price)||0) * (parseFloat(i.qty)||1), 0);
  const needsMap = _grocery.items.filter(i => i.needs_mapping && !i.price_item_id).length;

  const totalEl = document.getElementById('groceryTotals');
  if (totalEl) totalEl.innerHTML = `
    <span style="font-size:.78rem;color:var(--muted)">${_grocery.items.length} item${_grocery.items.length!==1?'s':''}</span>
    ${total > 0 ? `<span style="font-size:.78rem;color:var(--muted)">· Est. ${fmt(total)}</span>` : ''}
    ${done.length > 0 ? `<span style="font-size:.78rem;color:var(--green,#16a34a)">· ${done.length} comprado${done.length!==1?'s':''} (${fmt(bought)})</span>` : ''}
    ${needsMap > 0 ? `<span style="font-size:.78rem;color:var(--amber,#f59e0b)" title="Itens sem equivalência no catálogo de preços">· ⚠️ ${needsMap} sem mapeamento</span>` : ''}`;

  if (!_grocery.items.length) {
    container.innerHTML = `<div style="text-align:center;padding:32px;color:var(--muted);font-size:.875rem">
      Lista vazia. Adicione itens abaixo.</div>`;
    return;
  }

  const renderItem = i => {
    const store = i.suggested_store || '';
    const price = parseFloat(i.suggested_price);
    const priceHtml = price > 0 ? `<span style="font-size:.75rem;color:var(--muted)">${fmt(price)}/un</span>` : '';
    const storeHtml = store ? `<span style="font-size:.7rem;color:var(--muted)">📍 ${esc(store)}</span>` : '';
    const linkedHtml = i.price_items?.name
      ? `<span style="font-size:.65rem;padding:1px 5px;border-radius:8px;background:var(--accent-lt);color:var(--accent)">🔗 ${esc(i.price_items.name)}</span>`
      : (i.needs_mapping
        ? `<span style="font-size:.65rem;padding:1px 5px;border-radius:8px;background:rgba(245,158,11,.12);color:var(--amber,#b45309)">⚠️ sem mapeamento</span>`
        : '');
    return `<div class="grocery-item${i.checked?' grocery-item-done':''}" id="groceryItem-${i.id}">
      <button class="grocery-check-btn" onclick="toggleGroceryItem('${i.id}',${!i.checked})"
        style="width:24px;height:24px;border-radius:50%;border:2px solid ${i.checked?'var(--green,#16a34a)':'var(--border)'};
               background:${i.checked?'var(--green,#16a34a)':'transparent'};
               flex-shrink:0;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;font-size:.75rem">
        ${i.checked ? '✓' : ''}
      </button>
      <div style="flex:1;min-width:0">
        <div style="font-size:.875rem;font-weight:${i.checked?'400':'600'};
             ${i.checked?'text-decoration:line-through;color:var(--muted)':''}">
          ${esc(i.name)}
        </div>
        <div style="display:flex;gap:6px;align-items:center;margin-top:3px;flex-wrap:wrap">
          <span style="font-size:.75rem;color:var(--muted)">Qtd: <strong>${i.qty||1} ${esc(i.unit||'un')}</strong></span>
          ${priceHtml}${storeHtml}${linkedHtml}
        </div>
      </div>
      <button class="btn-icon" onclick="removeGroceryItem('${i.id}')" style="color:var(--muted);font-size:.78rem">✕</button>
    </div>`;
  };

  container.innerHTML =
    (pending.length ? `<div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);padding:8px 0 4px">A comprar (${pending.length})</div>` + pending.map(renderItem).join('') : '') +
    (done.length    ? `<div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--green,#16a34a);padding:12px 0 4px;margin-top:4px">Comprados (${done.length})</div>` + done.map(renderItem).join('') : '');
}

// ─────────────────────────────────────────────────────────────────────────
// TOGGLE / REMOVE ITEM
// ─────────────────────────────────────────────────────────────────────────
async function toggleGroceryItem(itemId, checked) {
  await sb.from('grocery_items').update({ checked }).eq('id', itemId);
  const item = _grocery.items.find(i => i.id === itemId);
  if (item) item.checked = checked;
  _renderGroceryItems();
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

// ─────────────────────────────────────────────────────────────────────────
// ADICIONAR ITEM — modal com busca em price_items ou novo item
// ─────────────────────────────────────────────────────────────────────────
async function openAddGroceryItem() {
  const searchEl = document.getElementById('groceryItemSearch');
  const sugEl    = document.getElementById('groceryItemSuggestions');
  const formEl   = document.getElementById('groceryItemForm');
  const badgeEl  = document.getElementById('groceryItemMappingBadge');

  if (searchEl) searchEl.value = '';
  if (sugEl)    { sugEl.innerHTML = ''; sugEl.style.display = 'none'; }
  if (formEl)   formEl.style.display = 'none';
  if (badgeEl)  badgeEl.innerHTML = '';

  openModal('groceryAddItemModal');

  // Ensure price_items are loaded — they live in prices.js _px.items
  // If the user hasn't visited the Prices page yet, _px.items is empty.
  // Load directly here so the catalog is always available.
  if (!_px.items || !_px.items.length) {
    if (typeof _loadPricesData === 'function') {
      try { await _loadPricesData(); } catch(e) { console.warn('[grocery] _loadPricesData:', e.message); }
    }
  }

  // Show full catalog immediately on open
  setTimeout(() => {
    searchGroceryItem('');
    searchEl?.focus();
  }, 80);
}

function searchGroceryItem(val) {
  const sugEl = document.getElementById('groceryItemSuggestions');
  if (!sugEl) return;

  const allItems = _px?.items || [];

  if (!val || val.length < 1) {
    // Show full catalog (up to 20) when field is empty
    if (!allItems.length) {
      sugEl.innerHTML = '<div style="padding:10px 12px;font-size:.8rem;color:var(--muted)">Catálogo de preços vazio. Adicione itens na página Preços.</div>';
      sugEl.style.display = '';
      return;
    }
    _renderGrocerySearchResults(allItems.slice(0, 20), val);
    return;
  }

  const q = val.toLowerCase().trim();
  const matched = allItems.filter(i => i.name.toLowerCase().includes(q)).slice(0, 10);
  _renderGrocerySearchResults(matched, val);
}

function _renderGrocerySearchResults(items, typedVal) {
  const sugEl = document.getElementById('groceryItemSuggestions');
  if (!sugEl) return;

  const rows = items.map(item => {
    const lastPrice = item.last_price != null ? fmt(item.last_price) : '';
    return `<div class="grocery-sug-row"
       onclick="_fillGroceryItemForm('${item.id}','${esc(item.name).replace(/'/g,"\\u0027")}','${esc(item.unit||'un')}')"
       onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''">
      <div>
        <div style="font-weight:600;font-size:.85rem">${esc(item.name)}</div>
        <div style="font-size:.72rem;color:var(--muted)">${esc(item.unit||'un')}</div>
      </div>
      ${lastPrice ? `<span style="font-size:.78rem;color:var(--accent);font-weight:600">${lastPrice}</span>` : ''}
    </div>`;
  });

  // Always show "add new" option at bottom
  const newRow = typedVal && typedVal.length >= 2
    ? `<div class="grocery-sug-row grocery-sug-new"
         onclick="_fillGroceryItemForm(null,'${esc(typedVal).replace(/'/g,"\\u0027")}','')"
         onmouseover="this.style.background='var(--accent-lt)'" onmouseout="this.style.background=''">
        <span>➕ Adicionar <strong>"${esc(typedVal)}"</strong> como novo item</span>
        <span style="font-size:.7rem;color:var(--muted)">sem mapeamento</span>
      </div>`
    : '';

  const content = rows.join('') + newRow;
  sugEl.innerHTML = content;
  sugEl.style.display = content.trim() ? '' : 'none';
}

async function _fillGroceryItemForm(priceItemId, name, unit) {
  const formEl = document.getElementById('groceryItemForm');
  const nameEl = document.getElementById('groceryNewItemName');
  const unitEl = document.getElementById('groceryNewItemUnit');
  const qtyEl  = document.getElementById('groceryNewItemQty');
  const priceEl= document.getElementById('groceryNewItemPrice');
  const storeEl= document.getElementById('groceryNewItemStore');
  const hidEl  = document.getElementById('groceryNewItemPriceItemId');
  const mapEl  = document.getElementById('groceryNewItemNeedsMapping');
  const badgeEl= document.getElementById('groceryItemMappingBadge');

  if (formEl)  formEl.style.display  = '';
  if (nameEl)  nameEl.value  = name || '';
  if (unitEl)  unitEl.value  = unit || 'un';
  if (hidEl)   hidEl.value   = priceItemId || '';
  if (qtyEl)   qtyEl.value   = '1';
  if (priceEl) priceEl.value = '';
  if (storeEl) storeEl.value = '';
  if (mapEl)   mapEl.value   = priceItemId ? 'false' : 'true';

  // Badge: linked vs new
  if (badgeEl) {
    if (priceItemId) {
      badgeEl.innerHTML = `<span style="font-size:.72rem;padding:2px 8px;border-radius:10px;background:var(--accent-lt);color:var(--accent)">🔗 Vinculado ao catálogo de preços</span>`;
    } else {
      badgeEl.innerHTML = `<span style="font-size:.72rem;padding:2px 8px;border-radius:10px;background:rgba(245,158,11,.12);color:var(--amber,#b45309)">⚠️ Novo item — será mapeado ao registrar recibo</span>`;
    }
  }

  // Fetch suggested price if linked to price_items
  if (priceItemId) {
    try {
      const { data } = await sb.from('price_history')
        .select('unit_price, store_id, price_stores(name)')
        .eq('item_id', priceItemId)
        .eq('family_id', famId())
        .order('purchased_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        if (priceEl) priceEl.value = data.unit_price?.toFixed(2) || '';
        if (storeEl && data.price_stores?.name) storeEl.value = data.price_stores.name;
      }
    } catch {}
  }

  formEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function confirmAddGroceryItem() {
  const listId   = _grocery.currentList;
  if (!listId) { toast('Nenhuma lista aberta.', 'error'); return; }
  const name     = document.getElementById('groceryNewItemName')?.value?.trim();
  const unit     = document.getElementById('groceryNewItemUnit')?.value?.trim() || 'un';
  const qty      = parseFloat(document.getElementById('groceryNewItemQty')?.value) || 1;
  const price    = parseFloat(document.getElementById('groceryNewItemPrice')?.value) || null;
  const store    = document.getElementById('groceryNewItemStore')?.value?.trim() || null;
  const itemId   = document.getElementById('groceryNewItemPriceItemId')?.value || null;
  const needsMap = document.getElementById('groceryNewItemNeedsMapping')?.value === 'true';
  if (!name) { toast('Informe o nome do item', 'error'); return; }

  const { error } = await sb.from('grocery_items').insert({
    list_id:        listId,
    family_id:      famId(),
    name,
    unit,
    qty,
    price_item_id:  itemId || null,
    suggested_price: price,
    suggested_store: store,
    needs_mapping:  needsMap,
    checked:        false,
  });
  if (error) { toast('Erro ao adicionar item: ' + error.message, 'error'); return; }

  closeModal('groceryAddItemModal');
  await _loadGroceryItems(listId);
  _renderGroceryItems();
  toast('Item adicionado!', 'success');
  await sb.from('grocery_lists').update({ status: 'open', updated_at: new Date().toISOString() }).eq('id', listId);
  const list = _grocery.lists.find(l => l.id === listId);
  if (list) list.status = 'open';
  _renderGroceryLists();
}

// ─────────────────────────────────────────────────────────────────────────
// REGISTRAR COMPRA COM IA — foto/PDF de recibo → equivalência + price_history
// ─────────────────────────────────────────────────────────────────────────
function openGroceryReceiptAI() {
  const listId = _grocery.currentList;
  if (!listId) { toast('Abra uma lista primeiro.', 'warning'); return; }
  const fileEl = document.getElementById('groceryReceiptFile');
  if (fileEl) fileEl.value = '';
  const previewEl = document.getElementById('groceryReceiptPreview');
  if (previewEl) { previewEl.style.display = 'none'; previewEl.innerHTML = ''; }
  const resultEl = document.getElementById('groceryReceiptResult');
  if (resultEl) { resultEl.style.display = 'none'; resultEl.innerHTML = ''; }
  openModal('groceryReceiptModal');
}

async function groceryReceiptFileSelected(input) {
  const file = input?.files?.[0];
  if (!file) return;
  window._groceryReceiptPending = null;

  const previewEl = document.getElementById('groceryReceiptPreview');
  if (previewEl) {
    previewEl.style.display = '';
    previewEl.innerHTML = `<div style="font-size:.8rem;color:var(--muted)">⏳ Preparando ${esc(file.name)}…</div>`;
  }

  try {
    if (file.type === 'application/pdf') {
      // Reuse the same pdf-to-canvas from receipt_ai.js if available
      if (typeof _pdfPageToBase64 === 'function') {
        const b64 = await _pdfPageToBase64(file);
        window._groceryReceiptPending = { base64: b64, mediaType: 'image/png', fileName: file.name };
      } else {
        throw new Error('Suporte a PDF não disponível. Use uma imagem.');
      }
    } else if (file.type.startsWith('image/')) {
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result.split(',')[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      window._groceryReceiptPending = { base64: b64, mediaType: file.type, fileName: file.name };
    } else {
      throw new Error('Selecione uma imagem (JPG/PNG) ou PDF.');
    }

    if (previewEl) {
      if (file.type.startsWith('image/')) {
        previewEl.innerHTML = `<img src="data:${file.type};base64,${window._groceryReceiptPending.base64}"
          style="max-width:100%;max-height:180px;border-radius:8px;object-fit:contain">`;
      } else {
        previewEl.innerHTML = `<div style="padding:12px;background:var(--surface2);border-radius:8px;font-size:.85rem">📄 ${esc(file.name)}</div>`;
      }
    }
  } catch(e) {
    if (previewEl) previewEl.innerHTML = `<div style="color:var(--red);font-size:.8rem">❌ ${esc(e.message)}</div>`;
    window._groceryReceiptPending = null;
  }
}

async function processGroceryReceiptWithAI() {
  if (!window._groceryReceiptPending) {
    toast('Selecione um arquivo primeiro.', 'warning'); return;
  }
  const apiKey = await getAppSetting('gemini_api_key', '');
  if (!apiKey || !apiKey.startsWith('AIza')) {
    toast('Configure a chave Gemini em Configurações → IA.', 'warning');
    if (typeof showAiConfig === 'function') showAiConfig();
    return;
  }

  const btn = document.getElementById('groceryReceiptAiBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Analisando recibo…'; }
  const resultEl = document.getElementById('groceryReceiptResult');
  if (resultEl) { resultEl.style.display = 'none'; resultEl.innerHTML = ''; }

  try {
    const result = await _callGroceryReceiptAI(apiKey, window._groceryReceiptPending);
    await _applyGroceryReceiptResult(result);
  } catch(e) {
    toast('Erro na leitura: ' + e.message, 'error');
    console.error('[GroceryAI]', e);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '🤖 Analisar com IA'; }
  }
}

async function _callGroceryReceiptAI(apiKey, pending) {
  // Build context: items in this list + all price_items in catalog
  const listItems = _grocery.items.map(i =>
    `${i.name}|${i.qty||1}|${i.unit||'un'}|${i.price_item_id||''}|${i.price_items?.name||''}`
  ).join('\n');

  const catalogItems = (_px?.items || []).slice(0, 150).map(i =>
    `${i.id}|${i.name}|${i.unit||'un'}`
  ).join('\n');

  const today = new Date().toISOString().slice(0, 10);

  const prompt = `Você é especialista em leitura de recibos e notas fiscais brasileiras.
Analise o recibo/nota na imagem e retorne SOMENTE um JSON válido.

CONTEXTO:
- Data de hoje: ${today}
- Itens na lista de compras (nome|qtd|unidade|price_item_id|nome_catalogo):
${listItems || '(lista vazia)'}

- Catálogo de preços disponível (id|nome|unidade):
${catalogItems || '(sem itens no catálogo)'}

TAREFA:
1. Identifique o estabelecimento, data e total do recibo
2. Para cada item do recibo, tente encontrar a equivalência:
   a) Primeiro: compare com os itens da LISTA DE COMPRAS (por nome similar)
   b) Se não estiver na lista: compare com o CATÁLOGO DE PREÇOS (por nome similar)
   c) Se não encontrar em nenhum: crie como novo item
3. Retorne preços unitários (calcule se necessário: total_item / quantidade)

RETORNE EXATAMENTE ESTE JSON (sem markdown, sem texto fora do JSON):
{
  "store_name": "nome do estabelecimento",
  "date": "YYYY-MM-DD",
  "total": 0.00,
  "items": [
    {
      "receipt_name": "nome como aparece no recibo",
      "qty": 1,
      "unit": "un",
      "unit_price": 0.00,
      "total_price": 0.00,
      "list_item_name": "nome do item na lista se encontrado ou null",
      "catalog_item_id": "UUID do price_item se encontrado ou null",
      "catalog_item_name": "nome do item no catálogo se encontrado ou null",
      "match_confidence": 0.9,
      "match_type": "list_match|catalog_match|new_item"
    }
  ]
}

REGRAS:
- Valores numéricos sem símbolo de moeda
- match_confidence: 0.0–1.0 (quão certo você está do mapeamento)
- match_type: "list_match" se achou na lista, "catalog_match" se só no catálogo, "new_item" se não achou
- Se não for recibo/nota fiscal: {"error": "não é um documento fiscal"}
- Arquivo: ${pending.fileName}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [
        { inline_data: { mime_type: pending.mediaType, data: pending.base64 } },
        { text: prompt },
      ]}],
      generationConfig: { maxOutputTokens: 2000, temperature: 0.1 },
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    const msg = err?.error?.message || `HTTP ${resp.status}`;
    if (resp.status === 400 && msg.includes('API_KEY')) throw new Error('Chave API inválida.');
    if (resp.status === 429) throw new Error('Limite de requisições atingido. Aguarde.');
    throw new Error(msg);
  }

  const data  = await resp.json();
  const text  = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const clean = text.replace(/```json|```/g, '').trim();
  let parsed;
  try { parsed = JSON.parse(clean); }
  catch { throw new Error('Resposta inválida: ' + text.slice(0, 120)); }
  if (parsed.error) throw new Error(parsed.error);
  return parsed;
}

async function _applyGroceryReceiptResult(result) {
  const resultEl = document.getElementById('groceryReceiptResult');

  if (!result?.items?.length) {
    if (resultEl) {
      resultEl.style.display = '';
      resultEl.innerHTML = `<div style="color:var(--muted);font-size:.85rem;padding:12px">Nenhum item identificado no recibo.</div>`;
    }
    return;
  }

  // Find or create price_store for this store
  let storeId = null;
  if (result.store_name) {
    const existing = (_px?.stores || []).find(s =>
      s.name.toLowerCase().includes(result.store_name.toLowerCase()) ||
      result.store_name.toLowerCase().includes(s.name.toLowerCase())
    );
    if (existing) {
      storeId = existing.id;
    } else {
      // Create new store
      const { data: newStore } = await sb.from('price_stores').insert({
        name: result.store_name, family_id: famId()
      }).select('id').single();
      if (newStore) {
        storeId = newStore.id;
        if (_px) _px.stores = [...(_px.stores||[]), { id: storeId, name: result.store_name }];
      }
    }
  }

  const purchasedAt = result.date || new Date().toISOString().slice(0, 10);
  const savedItems = [];
  const newPriceItems = [];

  for (const item of result.items) {
    if (!item.unit_price || item.unit_price <= 0) continue;

    let priceItemId = item.catalog_item_id || null;

    // If new item but matches something in our grocery list (needs_mapping)
    if (!priceItemId && item.list_item_name) {
      const listItem = _grocery.items.find(i =>
        i.name.toLowerCase() === item.list_item_name?.toLowerCase() ||
        i.name.toLowerCase().includes(item.receipt_name?.toLowerCase())
      );
      if (listItem && listItem.needs_mapping && !listItem.price_item_id) {
        // Create price_item for this new item and link it to the grocery_item
        const { data: newPi } = await sb.from('price_items').insert({
          name: listItem.name,
          unit: listItem.unit || item.unit || 'un',
          family_id: famId(),
        }).select('id').single();
        if (newPi) {
          priceItemId = newPi.id;
          newPriceItems.push(newPi.id);
          // Update the grocery_item to link to this new price_item
          await sb.from('grocery_items').update({
            price_item_id: newPi.id,
            needs_mapping: false,
            suggested_price: item.unit_price,
            suggested_store: result.store_name || null,
          }).eq('id', listItem.id);
          // Update local state
          listItem.price_item_id = newPi.id;
          listItem.needs_mapping = false;
          listItem.suggested_price = item.unit_price;
          if (_px) _px.items = [...(_px.items||[]), { id: newPi.id, name: listItem.name, unit: listItem.unit||'un' }];
        }
      }
    }

    if (!priceItemId) continue; // skip items with no price_item to record history for

    // Save to price_history
    const { error: phErr } = await sb.from('price_history').insert({
      item_id:      priceItemId,
      store_id:     storeId,
      family_id:    famId(),
      unit_price:   item.unit_price,
      quantity:     item.qty || 1,
      purchased_at: purchasedAt,
    });
    if (!phErr) savedItems.push({ ...item, priceItemId });

    // Update suggested_price on matching grocery_items
    const matched = _grocery.items.filter(i => i.price_item_id === priceItemId);
    for (const gi of matched) {
      await sb.from('grocery_items').update({
        suggested_price: item.unit_price,
        suggested_store: result.store_name || gi.suggested_store,
      }).eq('id', gi.id);
      gi.suggested_price = item.unit_price;
      if (result.store_name) gi.suggested_store = result.store_name;
    }
  }

  // Re-render items with updated prices
  _renderGroceryItems();

  // Show result summary
  if (resultEl) {
    resultEl.style.display = '';
    const matchedCount  = result.items.filter(i => i.match_type !== 'new_item').length;
    const newMappedCount = newPriceItems.length;
    const skippedCount  = result.items.filter(i => !i.unit_price || i.unit_price <= 0).length;

    resultEl.innerHTML = `
      <div style="padding:12px;background:var(--surface2);border-radius:10px;margin-top:8px">
        <div style="font-weight:700;font-size:.85rem;margin-bottom:8px">📊 Resultado da leitura</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:.78rem">
          <div>🏪 <strong>${esc(result.store_name||'Estabelecimento')}</strong></div>
          <div>📅 ${esc(result.date||'—')}</div>
          <div>🛍️ ${result.items.length} itens lidos</div>
          <div>💰 Total: <strong>${result.total ? fmt(result.total) : '—'}</strong></div>
          <div style="color:var(--green,#16a34a)">✅ ${savedItems.length} preços salvos</div>
          <div style="color:var(--accent)">${newMappedCount > 0 ? `🔗 ${newMappedCount} novos mapeamentos` : ''}</div>
        </div>
        <div style="margin-top:10px;font-size:.75rem;color:var(--muted)">
          ${result.items.map(i => {
            const icon = i.match_type === 'list_match' ? '✅' : i.match_type === 'catalog_match' ? '🔗' : '⚠️';
            const price = i.unit_price > 0 ? fmt(i.unit_price) + '/un' : 'sem preço';
            return `<div style="padding:3px 0;border-bottom:1px solid var(--border)">${icon} ${esc(i.receipt_name)} → ${esc(i.list_item_name||i.catalog_item_name||'novo')} · ${price}</div>`;
          }).join('')}
        </div>
        ${savedItems.length > 0 ? `<div style="margin-top:8px;font-size:.75rem;color:var(--green,#16a34a)">✅ Histórico de preços atualizado!</div>` : ''}
      </div>`;
  }

  const savedCount = savedItems.length + newPriceItems.length;
  if (savedCount > 0) {
    toast(`✅ ${savedCount} preço${savedCount!==1?'s':''} registrado${savedCount!==1?'s':''}!`, 'success');
  } else {
    toast('Nenhum preço novo foi salvo. Verifique o mapeamento dos itens.', 'warning');
  }
}
