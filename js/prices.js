/* ═══════════════════════════════════════════════════════════════════════════
   PRICES.JS — Gerenciamento de Preços
   Histórico de preços por item, vinculado por família.
   Ativado por família pelo admin global no painel de usuários.
═══════════════════════════════════════════════════════════════════════════ */

// ── Estado local ──────────────────────────────────────────────────────────────
const _px = {
  items:         [],   // price_items (com avg/last/count calculados)
  stores:        [],   // price_stores
  activeItemId:  null,
  search:        '',
  catFilter:     '',
};

// ─────────────────────────────────────────────────────────────────────────────
// FEATURE FLAG
// ─────────────────────────────────────────────────────────────────────────────

async function isPricesEnabled() {
  const famId = currentUser?.family_id;
  if (!famId) return false;
  const val = await getAppSetting('prices_enabled_' + famId, false);
  return val === true || val === 'true';
}

// Aplica visibilidade do nav + botão de transação conforme feature flag
async function applyPricesFeature() {
  const on = await isPricesEnabled();
  const navEl = document.getElementById('pricesNav');
  if (navEl) navEl.style.display = on ? '' : 'none';
  const txBtn = document.getElementById('txRegisterPricesBtn');
  if (txBtn) {
    // só mostra se feature on E se já há resultado de IA disponível
    if (!on) txBtn.style.display = 'none';
    // quando on, a exibição é controlada pelo receipt_ai após leitura
  }
}

// Chamado pelo admin ao togglear o checkbox na lista de famílias
async function toggleFamilyPrices(familyId, enabled) {
  await saveAppSetting('prices_enabled_' + familyId, enabled);
  if (typeof applyPricesFeature === 'function') applyPricesFeature().catch(() => {});
  toast(enabled ? '✓ Gestão de Preços ativada para esta família' : 'Gestão de Preços desativada', 'success');
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE INIT & DATA LOAD
// ─────────────────────────────────────────────────────────────────────────────

async function initPricesPage() {
  const on = await isPricesEnabled();
  if (!on) {
    toast('Recurso de preços não está ativo para esta família.', 'warning');
    navigate('dashboard');
    return;
  }
  _px.search    = '';
  _px.catFilter = '';
  const searchEl = document.getElementById('pricesSearchInput');
  const catEl    = document.getElementById('pricesCatFilter');
  if (searchEl) searchEl.value = '';
  _populatePricesCatFilter();
  await _loadPricesData();
  _renderPricesPage();
}

function _populatePricesCatFilter() {
  const sel = document.getElementById('pricesCatFilter');
  if (!sel) return;
  const exp = (state.categories || []).filter(c => !c.parent_id && c.type !== 'income');
  sel.innerHTML = '<option value="">Todas as categorias</option>' +
    exp.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

async function _loadPricesData() {
  const fid = _famId();
  if (!fid) return;
  const [itemsRes, storesRes] = await Promise.all([
    sb.from('price_items')
      .select('id, name, description, unit, category_id, avg_price, last_price, record_count, categories(name)')
      .eq('family_id', fid)
      .order('name'),
    sb.from('price_stores')
      .select('id, name, address')
      .eq('family_id', fid)
      .order('name'),
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
    items = items.filter(i =>
      i.name.toLowerCase().includes(q) ||
      (i.description || '').toLowerCase().includes(q));
  }
  if (_px.catFilter) {
    items = items.filter(i => i.category_id === _px.catFilter);
  }

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

  listEl.innerHTML = `<div class="price-list">` +
    items.map(item => {
      const avg  = item.avg_price  != null ? fmt(item.avg_price)  : '—';
      const last = item.last_price != null ? fmt(item.last_price) : '—';
      const cat  = item.categories?.name || '';
      return `
      <div class="price-card" onclick="openPriceItemDetail('${item.id}')">
        <div class="price-card-body">
          <div class="price-card-name">${esc(item.name)}</div>
          ${cat  ? `<div class="price-card-tag">${esc(cat)}</div>` : ''}
          ${item.description ? `<div class="price-card-desc">${esc(item.description)}</div>` : ''}
        </div>
        <div class="price-card-stats">
          <div class="price-stat-col">
            <span class="price-stat-lbl">Média</span>
            <span class="price-stat-val accent">${avg}</span>
          </div>
          <div class="price-stat-col">
            <span class="price-stat-lbl">Último</span>
            <span class="price-stat-val">${last}</span>
          </div>
          <div class="price-stat-col">
            <span class="price-stat-lbl">Registros</span>
            <span class="price-stat-val">${item.record_count || 0}</span>
          </div>
        </div>
        <div class="price-card-chevron">›</div>
      </div>`;
    }).join('') + `</div>`;
}

function pricesSearch(val) {
  _px.search = val;
  _renderPricesPage();
}

function pricesCatFilter(val) {
  _px.catFilter = val;
  _renderPricesPage();
}

// ─────────────────────────────────────────────────────────────────────────────
// ITEM DETAIL MODAL
// ─────────────────────────────────────────────────────────────────────────────

async function openPriceItemDetail(itemId) {
  _px.activeItemId = itemId;
  const item = _px.items.find(i => i.id === itemId);
  if (!item) return;

  document.getElementById('pidItemName').textContent  = item.name;
  document.getElementById('pidItemCat').textContent   = item.categories?.name || '—';
  document.getElementById('pidItemDesc').textContent  = item.description || '';
  document.getElementById('pidItemUnit').textContent  = item.unit ? '/' + item.unit : '';
  document.getElementById('pidAvg').textContent   = item.avg_price  != null ? fmt(item.avg_price)  : '—';
  document.getElementById('pidLast').textContent  = item.last_price != null ? fmt(item.last_price) : '—';
  document.getElementById('pidCount').textContent = item.record_count || '0';

  const histEl = document.getElementById('pidHistory');
  histEl.innerHTML = '<div class="pid-loading">⏳ Carregando histórico...</div>';
  openModal('priceItemDetailModal');

  const { data: hist, error } = await sb
    .from('price_history')
    .select('id, unit_price, quantity, purchased_at, price_stores(id, name, address)')
    .eq('item_id', itemId)
    .order('purchased_at', { ascending: false })
    .limit(60);

  if (error || !hist?.length) {
    histEl.innerHTML = '<div class="pid-empty">Nenhum registro encontrado.</div>';
    return;
  }

  histEl.innerHTML = hist.map(h => {
    const store   = h.price_stores;
    const dateStr = h.purchased_at ? new Date(h.purchased_at + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
    return `
    <div class="pid-row">
      <div class="pid-row-date">${dateStr}</div>
      <div class="pid-row-store">
        <div class="pid-row-store-name">${esc(store?.name || '—')}</div>
        ${store?.address ? `<div class="pid-row-store-addr">${esc(store.address)}</div>` : ''}
      </div>
      <div class="pid-row-qty">×${h.quantity ?? 1}</div>
      <div class="pid-row-price">${fmt(h.unit_price)}</div>
      <button class="pid-row-del" onclick="event.stopPropagation();deletePriceHistory('${h.id}','${itemId}')"
              title="Remover registro">🗑</button>
    </div>`;
  }).join('');
}

async function deletePriceHistory(histId, itemId) {
  if (!confirm('Remover este registro do histórico?')) return;
  const { error } = await sb.from('price_history').delete().eq('id', histId);
  if (error) { toast('Erro: ' + error.message, 'error'); return; }
  await _refreshItemStats(itemId);
  await _loadPricesData();
  await openPriceItemDetail(itemId);
  _renderPricesPage();
  toast('Registro removido', 'success');
}

async function openEditPriceItem() {
  const item = _px.items.find(i => i.id === _px.activeItemId);
  if (!item) return;
  closeModal('priceItemDetailModal');
  _openItemForm(item);
}

async function deletePriceItem() {
  const item = _px.items.find(i => i.id === _px.activeItemId);
  if (!item) return;
  if (!confirm(`Excluir o item "${item.name}" e todo o histórico de preços?\n\nEsta ação é irreversível.`)) return;
  await sb.from('price_history').delete().eq('item_id', item.id);
  await sb.from('price_items').delete().eq('id', item.id);
  closeModal('priceItemDetailModal');
  toast('Item excluído', 'success');
  await _loadPricesData();
  _renderPricesPage();
}

// ─────────────────────────────────────────────────────────────────────────────
// ITEM CREATE / EDIT FORM
// ─────────────────────────────────────────────────────────────────────────────

function openNewPriceItem() { _openItemForm(null); }

function _openItemForm(item) {
  document.getElementById('pifId').value          = item?.id || '';
  document.getElementById('pifName').value        = item?.name || '';
  document.getElementById('pifDescription').value = item?.description || '';
  document.getElementById('pifUnit').value        = item?.unit || 'un';
  document.getElementById('pifFormTitle').textContent = item ? '✏️ Editar Item' : '🏷️ Novo Item';

  const catSel = document.getElementById('pifCategory');
  catSel.innerHTML = '<option value="">— Sem categoria —</option>' +
    (state.categories || [])
      .filter(c => c.type !== 'income')
      .map(c => `<option value="${c.id}"${item?.category_id === c.id ? ' selected' : ''}>${esc(c.name)}</option>`)
      .join('');

  document.getElementById('pifError').style.display = 'none';
  openModal('priceItemFormModal');
  setTimeout(() => document.getElementById('pifName')?.focus(), 150);
}

async function savePriceItem() {
  const id    = document.getElementById('pifId').value;
  const name  = document.getElementById('pifName').value.trim();
  const desc  = document.getElementById('pifDescription').value.trim();
  const unit  = document.getElementById('pifUnit').value.trim() || 'un';
  const catId = document.getElementById('pifCategory').value || null;
  const errEl = document.getElementById('pifError');

  if (!name) { _pifErr('Informe o nome do item.'); return; }
  errEl.style.display = 'none';

  const payload = { name, description: desc || null, unit, category_id: catId, family_id: _famId() };
  const { error } = id
    ? await sb.from('price_items').update(payload).eq('id', id)
    : await sb.from('price_items').insert(payload);

  if (error) { _pifErr('Erro: ' + error.message); return; }

  toast(id ? '✓ Item atualizado' : '✓ Item criado', 'success');
  closeModal('priceItemFormModal');
  await _loadPricesData();
  _renderPricesPage();
}

function _pifErr(msg) {
  const el = document.getElementById('pifError');
  if (el) { el.textContent = msg; el.style.display = ''; }
}

// ─────────────────────────────────────────────────────────────────────────────
// REGISTER PRICES FROM RECEIPT  (called from transaction modal button)
// ─────────────────────────────────────────────────────────────────────────────

async function openRegisterPricesFromReceipt() {
  const result = window._lastReceiptAiResult;
  if (!result) {
    toast('Leia o recibo com IA primeiro.', 'warning');
    return;
  }
  await _loadPricesData(); // refresh stores/items
  _openRegisterModal(result);
}

function _openRegisterModal(aiResult) {
  const storeEl = document.getElementById('rpmStoreName');
  const addrEl  = document.getElementById('rpmStoreAddress');
  const dateEl  = document.getElementById('rpmDate');
  const errEl   = document.getElementById('rpmError');

  if (storeEl) storeEl.value = aiResult.payee || '';
  if (addrEl)  addrEl.value  = '';
  if (dateEl)  dateEl.value  = aiResult.date || new Date().toISOString().slice(0, 10);
  if (errEl)   errEl.style.display = 'none';

  // Try to auto-fill store address from known stores
  if (aiResult.payee) {
    const known = _px.stores.find(s =>
      s.name.toLowerCase().includes(aiResult.payee.toLowerCase()) ||
      aiResult.payee.toLowerCase().includes(s.name.toLowerCase())
    );
    if (known?.address && addrEl) addrEl.value = known.address;
  }

  const rawItems = aiResult.items || [];
  _renderRpmRows(rawItems.length ? rawItems : [{
    ai_name:    aiResult.description || '',
    quantity:   1,
    unit_price: aiResult.amount || 0,
  }]);

  openModal('registerPricesModal');
}

// Render rows of items to register
function _renderRpmRows(items) {
  const el = document.getElementById('rpmItemList');
  if (!el) return;

  // Store items data in window for manipulation
  window._rpmItems = items.map((it, idx) => ({ ...it, idx }));

  el.innerHTML = window._rpmItems.map(it => _rpmRowHtml(it)).join('');
}

function _rpmRowHtml(it) {
  const idx      = it.idx;
  const catOpts  = (state.categories || []).filter(c => c.type !== 'income')
    .map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  const itemOpts = _px.items
    .map(i => `<option value="${i.id}">${esc(i.name)}</option>`).join('');

  return `
  <div class="rpm-item" id="rpmItem-${idx}">
    <div class="rpm-item-header">
      <span class="rpm-item-num">${idx + 1}</span>
      <input type="text" class="rpm-item-desc" id="rpmDesc-${idx}"
             placeholder="Descrição do item"
             value="${esc(it.ai_name || it.description || '')}"
             style="flex:1">
      <button class="rpm-ai-btn" onclick="rpmNormalizeAI(${idx})" title="Normalizar com IA">🤖</button>
      <button class="rpm-del-btn" onclick="rpmRemoveRow(${idx})" title="Remover">✕</button>
    </div>
    <div class="rpm-item-fields">
      <div class="form-group" style="margin:0">
        <label style="font-size:.72rem">Qtd</label>
        <input type="number" id="rpmQty-${idx}" value="${it.quantity ?? 1}"
               min="0.001" step="any" style="font-size:.83rem;text-align:center">
      </div>
      <div class="form-group" style="margin:0">
        <label style="font-size:.72rem">Preço Unit. (R$)</label>
        <input type="number" id="rpmPrice-${idx}" value="${(it.unit_price || 0).toFixed(2)}"
               min="0" step="0.01" style="font-size:.83rem">
      </div>
      <div class="form-group" style="margin:0">
        <label style="font-size:.72rem">Categoria</label>
        <select id="rpmCat-${idx}" style="font-size:.8rem">
          <option value="">—</option>
          ${catOpts}
        </select>
      </div>
    </div>
    <div class="form-group" style="margin:6px 0 0">
      <label style="font-size:.72rem">Vincular a item já cadastrado <span style="color:var(--muted)">(deixe vazio para criar novo)</span></label>
      <select id="rpmLink-${idx}" style="font-size:.8rem">
        <option value="">— Criar novo item —</option>
        ${itemOpts}
      </select>
    </div>
  </div>`;
}

function rpmRemoveRow(idx) {
  document.getElementById(`rpmItem-${idx}`)?.remove();
}

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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text:
          `Normalize este nome de produto de supermercado/loja para uma descrição curta, limpa e padronizada em português brasileiro.\n` +
          `Remova: abreviações técnicas, códigos internos, unidades embutidas no nome, caracteres especiais desnecessários.\n` +
          `Padronize para uso em cadastro de preços (ex: "ARROZ BRANCO TYPE1 5KG" → "Arroz Branco 5kg").\n` +
          `Retorne APENAS o nome normalizado em Title Case, sem explicações, sem aspas, sem pontuação final.\n\n` +
          `Produto: ${raw}`
        }] }],
        generationConfig: { maxOutputTokens: 50, temperature: 0.1 },
      }),
    });
    const data = await resp.json();
    const norm = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (norm && descEl) descEl.value = norm;
    toast('✓ Nome normalizado', 'success');
  } catch(e) {
    toast('Erro na IA: ' + e.message, 'error');
  } finally {
    if (btn) { btn.textContent = '🤖'; btn.disabled = false; }
  }
}

async function rpmNormalizeAllAI() {
  const rows = document.querySelectorAll('.rpm-item');
  for (const row of rows) {
    const idx = row.id.replace('rpmItem-', '');
    await rpmNormalizeAI(idx);
    await new Promise(r => setTimeout(r, 200)); // small delay between calls
  }
}

function rpmAddRow() {
  const container = document.getElementById('rpmItemList');
  if (!container) return;
  const maxIdx = window._rpmItems?.length
    ? Math.max(...window._rpmItems.map(i => i.idx)) + 1
    : 0;
  const newItem = { idx: maxIdx, ai_name: '', quantity: 1, unit_price: 0 };
  window._rpmItems = [...(window._rpmItems || []), newItem];
  const div = document.createElement('div');
  div.innerHTML = _rpmRowHtml(newItem);
  container.appendChild(div.firstElementChild);
  document.getElementById(`rpmDesc-${maxIdx}`)?.focus();
}

async function saveRegisterPrices() {
  const storeName = document.getElementById('rpmStoreName')?.value?.trim();
  const storeAddr = document.getElementById('rpmStoreAddress')?.value?.trim();
  const date      = document.getElementById('rpmDate')?.value;
  const errEl     = document.getElementById('rpmError');
  const saveBtn   = document.getElementById('rpmSaveBtn');

  if (!storeName) { _rpmErr('Informe o nome do estabelecimento.'); return; }
  if (!date)      { _rpmErr('Informe a data.'); return; }
  errEl.style.display = 'none';

  saveBtn.disabled    = true;
  saveBtn.textContent = '⏳ Salvando...';

  try {
    const fid = _famId();

    // ── Upsert store ─────────────────────────────────────────────────────────
    let storeId;
    const { data: existStore } = await sb
      .from('price_stores')
      .select('id, address')
      .eq('family_id', fid)
      .ilike('name', storeName)
      .maybeSingle();

    if (existStore?.id) {
      storeId = existStore.id;
      // Update address if provided and not already set
      if (storeAddr && !existStore.address) {
        await sb.from('price_stores').update({ address: storeAddr }).eq('id', storeId);
      }
    } else {
      const { data: ns, error: nsErr } = await sb
        .from('price_stores')
        .insert({ family_id: fid, name: storeName, address: storeAddr || null })
        .select('id').single();
      if (nsErr) throw new Error('Erro ao salvar estabelecimento: ' + nsErr.message);
      storeId = ns.id;
    }

    // ── Process each row ─────────────────────────────────────────────────────
    const rows  = document.querySelectorAll('.rpm-item');
    let   saved = 0;

    for (const row of rows) {
      const idx   = row.id.replace('rpmItem-', '');
      const desc  = document.getElementById(`rpmDesc-${idx}`)?.value?.trim();
      const qty   = parseFloat(document.getElementById(`rpmQty-${idx}`)?.value)   || 1;
      const price = parseFloat(document.getElementById(`rpmPrice-${idx}`)?.value) || 0;
      const catId = document.getElementById(`rpmCat-${idx}`)?.value  || null;
      const link  = document.getElementById(`rpmLink-${idx}`)?.value || null;

      if (!desc || price <= 0) continue; // skip empty/zero rows

      // Resolve or create price_item
      let itemId = link;
      if (!itemId) {
        const { data: ni, error: niErr } = await sb
          .from('price_items')
          .insert({ family_id: fid, name: desc, category_id: catId })
          .select('id').single();
        if (niErr) { console.warn('price_item insert:', niErr.message); continue; }
        itemId = ni.id;
      } else if (catId) {
        // Update category on existing item if provided
        await sb.from('price_items').update({ category_id: catId }).eq('id', itemId);
      }

      // Insert history record
      const { error: hErr } = await sb.from('price_history').insert({
        family_id:    fid,
        item_id:      itemId,
        store_id:     storeId,
        unit_price:   price,
        quantity:     qty,
        purchased_at: date,
      });
      if (hErr) { console.warn('price_history insert:', hErr.message); continue; }

      await _refreshItemStats(itemId);
      saved++;
    }

    toast(`✓ ${saved} preço${saved !== 1 ? 's' : ''} registrado${saved !== 1 ? 's' : ''}!`, 'success');
    closeModal('registerPricesModal');

    // Refresh page if currently on prices
    if (state.currentPage === 'prices') {
      await _loadPricesData();
      _renderPricesPage();
    }
  } catch(e) {
    _rpmErr('Erro: ' + e.message);
  } finally {
    saveBtn.disabled    = false;
    saveBtn.textContent = '💾 Salvar preços';
  }
}

function _rpmErr(msg) {
  const el = document.getElementById('rpmError');
  if (el) { el.textContent = msg; el.style.display = ''; }
}

// ─────────────────────────────────────────────────────────────────────────────
// STATS RECALCULATION (after insert/delete)
// ─────────────────────────────────────────────────────────────────────────────

async function _refreshItemStats(itemId) {
  const { data: rows } = await sb
    .from('price_history')
    .select('unit_price, purchased_at')
    .eq('item_id', itemId)
    .order('purchased_at', { ascending: false });

  if (!rows?.length) {
    await sb.from('price_items').update({ avg_price: null, last_price: null, record_count: 0 }).eq('id', itemId);
    return;
  }
  const prices = rows.map(r => r.unit_price).filter(v => v != null);
  const avg    = prices.reduce((a, b) => a + b, 0) / prices.length;
  await sb.from('price_items').update({
    avg_price:    Math.round(avg * 100) / 100,
    last_price:   prices[0],
    record_count: prices.length,
  }).eq('id', itemId);
}

// ══════════════════════════════════════════════════════════════════════════════
// RECEIPT SCAN na página de Preços (sem armazenar arquivo)
// ══════════════════════════════════════════════════════════════════════════════

let _pricesReceiptPending = null; // { base64, mediaType, fileName }

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
  inputEl.value = ''; // Allow reselect of same file

  const nameEl = document.getElementById('pricesReceiptFileName');
  if (nameEl) nameEl.textContent = file.name;

  const btn    = document.getElementById('pricesReadAiBtn');
  const status = document.getElementById('pricesAiStatus');
  if (btn)    { btn.style.display = 'none'; }
  if (status) { status.style.display = ''; status.textContent = '⏳ Preparando arquivo...'; }

  try {
    // Reuse receipt_ai.js helpers
    if (file.type === 'application/pdf') {
      const b64 = await _pdfPageToBase64(file);
      _pricesReceiptPending = { base64: b64, mediaType: 'image/png', fileName: file.name };
    } else if (file.type.startsWith('image/')) {
      const b64 = await _fileToBase64(file);
      _pricesReceiptPending = { base64: b64, mediaType: file.type, fileName: file.name };
    } else {
      throw new Error('Formato não suportado. Use imagem ou PDF.');
    }
    if (status) status.style.display = 'none';
    if (btn)    btn.style.display = '';
  } catch(e) {
    if (status) { status.textContent = '❌ ' + e.message; }
    toast('Erro ao preparar arquivo: ' + e.message, 'error');
  }
}

async function onPricesReceiptDrop(event) {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  // Simulate file selection
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

    // Discard the file from memory — we only needed it for extraction
    _pricesReceiptPending = null;

    // Close scan zone
    closePricesReceiptZone();

    // Open register prices modal with extracted data
    await _openRegisterPricesModal(result);

  } catch(e) {
    if (status) { status.textContent = '❌ ' + e.message; }
    toast('Erro na análise: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🤖 Analisar com IA'; }
  }
}

async function _callPricesVision(apiKey, pending) {
  // Extended prompt that returns line items
  const catList = (state.categories || []).filter(c => c.type === 'expense')
    .map(c => c.name).join(', ');
  const today = new Date().toISOString().slice(0, 10);

  const prompt = `Você é especialista em leitura de notas fiscais, cupons e recibos brasileiros.
Analise a imagem e extraia TODOS os itens da compra com seus preços unitários e quantidades.
Responda SOMENTE com JSON válido, sem markdown.

CATEGORIAS DISPONÍVEIS (use o nome exato ou null): ${catList || 'Alimentação, Higiene, Limpeza, Outros'}

RETORNE EXATAMENTE ESTE JSON:
{
  "date": "YYYY-MM-DD",
  "payee": "nome do estabelecimento",
  "address": "endereço do estabelecimento se visível, ou null",
  "items": [
    {
      "description": "nome normalizado e limpo do produto",
      "ai_name": "nome exato como aparece no recibo",
      "quantity": 1,
      "unit_price": 0.00,
      "total_price": 0.00,
      "category": "categoria mais próxima da lista ou null"
    }
  ]
}

REGRAS:
- description: nome limpo, sem abreviações, sem códigos, em português
- quantity: número (pode ser decimal para produtos a peso, ex: 0.546 kg)
- unit_price: preço por unidade/kg/litro (total_price / quantity)
- Se não encontrar itens individuais, retorne um único item com o total
- date: data da compra; se não encontrar use ${today}
- address: apenas rua + número + bairro se visível

Arquivo: ${pending.fileName}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${RECEIPT_AI_MODEL}:generateContent?key=${apiKey}`;
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
    throw new Error(err?.error?.message || `HTTP ${resp.status}`);
  }

  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const clean = text.replace(/```json|```/g, '').trim();

  let parsed;
  try { parsed = JSON.parse(clean); }
  catch { throw new Error('Resposta inválida da IA'); }

  if (parsed.error) throw new Error(parsed.error);
  return parsed;
}
