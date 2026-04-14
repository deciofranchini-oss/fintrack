// ── Categories — per-family, with tx counts and safe deletion ─────────────
// ── Favoritos de categoria ────────────────────────────────────────────────
// Chave por USUÁRIO (não por família) — membros distintos têm favoritos independentes
const _CAT_FAV_KEY = () => {
  const uid = (typeof currentUser !== 'undefined' && currentUser?.id) ? currentUser.id : 'anon';
  return `cat_fav_user_${uid}`;
};

function _loadCatFavorites() {
  // Lê do cache local primeiro (imediato)
  try {
    const raw = localStorage.getItem(_CAT_FAV_KEY());
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

async function _syncCatFavoritesFromServer() {
  if (typeof getAppSetting !== 'function') return;
  try {
    const key = _CAT_FAV_KEY();
    const val = await getAppSetting(key, null);
    if (Array.isArray(val)) {
      try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
    }
  } catch (e) { console.warn('[catFav] sync:', e?.message); }
}

async function _saveCatFavorites(ids) {
  // 1. Persistir localmente (imediato, fallback)
  const key = _CAT_FAV_KEY();
  try { localStorage.setItem(key, JSON.stringify(ids)); } catch {}
  // 2. Upsert no Supabase (principal — sincroniza entre dispositivos)
  if (typeof saveAppSetting === 'function') {
    saveAppSetting(key, ids).catch(e => console.warn('[catFav] save error:', e?.message));
  } else if (typeof sb !== 'undefined' && sb) {
    try {
      const { error } = await sb.from('app_settings')
        .upsert({ key, value: ids }, { onConflict: 'key' });
      if (error) console.warn('[catFav] save error:', error.message);
    } catch (e) { console.warn('[catFav] save exception:', e?.message); }
  }
}

function isCatFavorite(id) { return _loadCatFavorites().includes(id); }

async function toggleCatFavorite(id) {
  const favs = _loadCatFavorites();
  const idx  = favs.indexOf(id);
  if (idx >= 0) favs.splice(idx, 1); else favs.push(id);
  await _saveCatFavorites(favs);
  initCategoriesPage();
  if (state.currentPage === 'dashboard' && typeof _renderDashFavCategories === 'function')
    _renderDashFavCategories(_lastDashIncome, _lastDashExpense);
}

async function _syncCatFavsFromServer() {
  // Busca direto do Supabase — não depende de cache nem de loadAppSetting
  if (typeof sb === 'undefined' || !sb) return;
  const key = _CAT_FAV_KEY();
  if (key.endsWith('_anon')) return; // usuário ainda não logado
  try {
    const { data, error } = await sb.from('app_settings')
      .select('value').eq('key', key).maybeSingle();
    if (error) { console.warn('[catFav] sync error:', error.message); return; }
    if (data?.value && Array.isArray(data.value)) {
      localStorage.setItem(key, JSON.stringify(data.value));
      console.log('[catFav] synced', data.value.length, 'favorites from Supabase');
    }
  } catch (e) { console.warn('[catFav] sync exception:', e.message); }
}

// Cache de contagem de transações por category_id: { [id]: number }
let _catTxCounts = {};
window._resetCatTxCounts = () => { _catTxCounts = {}; };

// ── Load ──────────────────────────────────────────────────────────────────

async function loadCategories(force=false) {
  try { await DB.categories.load(force); }
  catch(e) { toast(e.message,'error'); }
}

// Carrega contagem de transações por categoria (chamado ao abrir a página)
async function _loadCatTxCounts() {
  const { data } = await famQ(
    sb.from('transactions').select('category_id')
  ).not('category_id', 'is', null);

  _catTxCounts = {};
  (data || []).forEach(t => {
    _catTxCounts[t.category_id] = (_catTxCounts[t.category_id] || 0) + 1;
  });

  // Somar filhos no pai
  state.categories.forEach(c => {
    if (c.parent_id && _catTxCounts[c.id]) {
      _catTxCounts[c.parent_id] = (_catTxCounts[c.parent_id] || 0) + _catTxCounts[c.id];
    }
  });
}

// ── Render ────────────────────────────────────────────────────────────────


function _catHighlight(text, term) {
  if (!term) return text;
  const idx = text.toLowerCase().indexOf(term.toLowerCase());
  if (idx === -1) return text;
  return text.slice(0, idx) +
    '<mark style="background:var(--amber,#fef08a);color:var(--text);border-radius:2px;padding:0 1px">' +
    text.slice(idx, idx + term.length) +
    '</mark>' +
    text.slice(idx + term.length);
}

// ── Category search filter ───────────────────────────────────────────────────
let _catSearchTerm = '';

function filterCategories(term) {
  _catSearchTerm = (term || '').toLowerCase().trim();
  const clearBtn = document.getElementById('catSearchClear');
  if (clearBtn) clearBtn.style.display = _catSearchTerm ? '' : 'none';
  renderCategories();
}
window.filterCategories = filterCategories;

function renderCategories() {
  const q = _catSearchTerm;

  ['expense', 'income'].forEach(type => {
    const dbType    = type === 'expense' ? 'despesa' : 'receita';
    const container = document.getElementById('catEditor' + (type === 'expense' ? 'Expense' : 'Income'));
    const countEl   = document.getElementById('catCount'  + (type === 'expense' ? 'Expense' : 'Income'));
    if (!container) return;

    // When searching, include a parent if it OR any of its subs match
    let parents     = state.categories.filter(c => c.type === dbType && !c.parent_id).sort((a, b) => a.name.localeCompare(b.name));
    const allChildren = state.categories.filter(c => c.type === dbType && c.parent_id);

    if (q) {
      parents = parents.filter(p => {
        const parentMatches = p.name.toLowerCase().includes(q);
        const anySubMatches = allChildren.filter(c => c.parent_id === p.id)
          .some(c => c.name.toLowerCase().includes(q));
        return parentMatches || anySubMatches;
      });
    }

    const totalCount = state.categories.filter(c => c.type === dbType).length;
    if (countEl) {
      if (q && parents.length !== state.categories.filter(c => c.type === dbType && !c.parent_id).length) {
        countEl.textContent = parents.length + ' de ' + totalCount;
      } else {
        countEl.textContent = totalCount + (totalCount === 1 ? ' cat.' : ' cats.');
      }
    }

    if (!parents.length) {
      container.innerHTML = q
        ? `<div style="text-align:center;padding:24px;color:var(--muted);font-size:.83rem">
            🔍 Nenhuma categoria encontrada para "<strong>${esc(q)}</strong>"</div>`
        : `<div style="text-align:center;padding:24px;color:var(--muted);font-size:.83rem">
            Nenhuma categoria. Clique em "+ ${type === 'expense' ? 'Despesa' : 'Receita'}" para criar.</div>`;
      return;
    }

    container.innerHTML = parents.map(p => {
      const allSubs  = allChildren.filter(c => c.parent_id === p.id).sort((a, b) => a.name.localeCompare(b.name));
      // When searching: show only matching subs (unless parent itself matches → show all)
      const subs     = (q && !p.name.toLowerCase().includes(q))
        ? allSubs.filter(c => c.name.toLowerCase().includes(q))
        : allSubs;
      const pTxCount  = _catTxCounts[p.id] || 0;
      const pColor    = p.color || 'var(--accent)';

      return `
      <div class="cat-group" id="catWrap-${p.id}" style="--cat-clr:${pColor}">
        <!-- Parent header -->
        <div class="cat-group-hdr" draggable="true"
          ondragstart="catDragStart(event,'${p.id}')"
          ondragover="catDragOver(event,'${p.id}')"
          ondrop="catDrop(event,'${p.id}')"
          ondragend="catDragEnd()">
          <span class="cat-drag-handle" title="Arrastar">⠿</span>
          <div class="cat-group-icon">
            <span>${p.icon || '📦'}</span>
          </div>
          <span class="cat-group-name" id="catName-${p.id}" ondblclick="startCatInlineEdit('${p.id}')">${q ? _catHighlight(esc(p.name), q) : esc(p.name)}</span>
          <div class="cat-group-meta">
            ${subs.length ? `<span class="cat-sub-pill">${subs.length} sub</span>` : ''}
            ${pTxCount > 0 ? `<span class="cat-tx-pill" title="Ver histórico" onclick="event.stopPropagation();openCategoryHistory('${p.id}','${esc(p.name)}')">📊 ${pTxCount}</span>` : ''}
          </div>
          <label class="cat-chat-switch" onclick="event.stopPropagation()" title="${p.chat_enabled !== false ? 'Chat ativo — clique para desativar' : 'Chat inativo — clique para ativar'}">
            <input type="checkbox" ${p.chat_enabled !== false ? 'checked' : ''} onchange="toggleCatChatEnabled('${p.id}')">
            <span class="cat-chat-track"><span class="cat-chat-thumb"></span></span>
            <span class="cat-chat-lbl">Chat</span>
          </label>
          <div class="cat-inline-actions">
            <button class="btn-icon" onclick="openCategoryModal('','${p.id}','${dbType}')" title="Nova subcategoria">＋ Sub</button>
            <button class="btn-icon" onclick="toggleCatFavorite('${p.id}')" title="${isCatFavorite(p.id)?'Remover favorito':'Favoritar'}" style="color:${isCatFavorite(p.id)?'var(--amber,#f59e0b)':'var(--muted)'};font-size:1.05rem">★</button>
            ${(() => {
              const _isActive  = window._iofCatId === p.id;
              const _hasOther  = !!window._iofCatId && window._iofCatId !== p.id;
              const _color     = _isActive ? '#dc2626' : _hasOther ? 'var(--border)' : 'var(--muted)';
              const _bg        = _isActive ? 'rgba(220,38,38,.1)' : 'transparent';
              const _cursor    = _hasOther ? 'not-allowed' : 'pointer';
              const _opacity   = _hasOther ? '0.35' : '1';
              const _title     = _isActive ? 'IOF ativo (clique para liberar seleção)' : _hasOther ? 'Desative o IOF atual para selecionar outro' : 'Definir como categoria padrão do IOF';
              const _events    = _hasOther ? 'none' : 'auto';
              return `<button class="btn-icon cat-iof-btn" onclick="setIofCategoryTarget('${p.id}','${esc(p.name)}')" title="${_title}" style="color:${_color};font-weight:700;font-size:.85rem;background:${_bg};cursor:${_cursor};opacity:${_opacity};pointer-events:${_events}">IOF</button>`;
            })()}
            <button class="btn-icon" onclick="openCategoryModal('${p.id}')" title="Editar">✏️</button>
            <button class="btn-ico" onclick="event.stopPropagation();openCategoryDetailModal('${p.id}')" title="Ver panorâmica 360°" style="font-size:.95rem;width:28px;height:28px;display:flex;align-items:center;justify-content:center">🔍</button>
            <button class="btn-icon" onclick="deleteCategory('${p.id}')" title="Excluir" style="color:var(--red)">🗑️</button>
          </div>
        </div>
        <!-- Subcategories -->
        ${subs.length ? `<div class="cat-subs">` + subs.map(c => {
          const cCount  = _catTxCounts[c.id] || 0;
          const cColor  = c.color || pColor;
          return `
          <div class="cat-sub-row" draggable="true"
            ondragstart="catDragStart(event,'${c.id}')"
            ondragover="catDragOver(event,'${c.id}')"
            ondrop="catDrop(event,'${c.id}')"
            ondragend="catDragEnd()">
            <span class="cat-drag-handle" title="Arrastar">⠿</span>
            <div class="cat-sub-connector"></div>
            <div class="cat-sub-icon" style="background:color-mix(in srgb,${cColor} 14%,transparent)">
              <span style="color:${cColor}">${c.icon || '▸'}</span>
            </div>
            <span class="cat-sub-name" id="catName-${c.id}" ondblclick="startCatInlineEdit('${c.id}')">${q ? _catHighlight(esc(c.name), q) : esc(c.name)}</span>
            ${cCount > 0 ? `<span class="cat-tx-pill" title="Ver histórico" onclick="event.stopPropagation();openCategoryHistory('${c.id}','${esc(c.name)}')">📊 ${cCount}</span>` : ''}
            <label class="cat-chat-switch" onclick="event.stopPropagation()" title="${c.chat_enabled !== false ? 'Chat ativo — clique para desativar' : 'Chat inativo — clique para ativar'}">
              <input type="checkbox" ${c.chat_enabled !== false ? 'checked' : ''} onchange="toggleCatChatEnabled('${c.id}')">
              <span class="cat-chat-track"><span class="cat-chat-thumb"></span></span>
              <span class="cat-chat-lbl">Chat</span>
            </label>
            <div class="cat-inline-actions">
              <button class="btn-icon" onclick="toggleCatFavorite('${c.id}')" title="${isCatFavorite(c.id)?'Remover favorito':'Favoritar'}" style="color:${isCatFavorite(c.id)?'var(--amber,#f59e0b)':'var(--muted)'};font-size:1.05rem">★</button>
              <button class="btn-icon" onclick="openCategoryModal('${c.id}')" title="Editar">✏️</button>
              <button class="btn-ico" onclick="event.stopPropagation();openCategoryDetailModal('${c.id}')" title="Ver panorâmica 360°" style="font-size:.95rem;width:28px;height:28px;display:flex;align-items:center;justify-content:center">🔍</button>
              <button class="btn-icon" onclick="deleteCategory('${c.id}')" title="Excluir" style="color:var(--red)">🗑️</button>
            </div>
          </div>`;
        }).join('') + `</div>` : ''}
      </div>`;
    }).join('');

    // Subcategorias órfãs
    const orphaned = allChildren.filter(c => !parents.find(p => p.id === c.parent_id));
    if (orphaned.length) {
      container.innerHTML += `<div style="font-size:.72rem;color:var(--muted);padding:6px 14px">
        Subcategorias sem pai: ${orphaned.map(c =>
          `<button class="cat-parent-chip" onclick="openCategoryModal('${c.id}')">${c.icon || ''} ${esc(c.name)}</button>`
        ).join(' ')}</div>`;
    }
  });
}

// ── Inline name editing ───────────────────────────────────────────────────

function startCatInlineEdit(id) {
  const span = document.getElementById('catName-' + id);
  if (!span) return;
  const cat = state.categories.find(c => c.id === id);
  if (!cat) return;
  const input = document.createElement('input');
  input.className = 'cat-inline-input';
  input.value = cat.name;
  input.onblur = () => finishCatInlineEdit(id, input.value);
  input.onkeydown = e => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = cat.name; input.blur(); }
  };
  span.replaceWith(input);
  input.focus(); input.select();
}

async function finishCatInlineEdit(id, newName) {
  const trimmed = newName.trim();
  const cat = state.categories.find(c => c.id === id);
  if (!cat || !trimmed || trimmed === cat.name) { renderCategories(); return; }
  const { error } = await sb.from('categories').update({ name: trimmed }).eq('id', id);
  if (error) { toast(error.message, 'error'); renderCategories(); return; }
  cat.name = trimmed;
  toast(t('toast.name_updated'), 'success');
  buildCatPicker();
  renderCategories();
}

// ── Change parent ─────────────────────────────────────────────────────────

function changeCatParent(childId) {
  openCategoryModal(childId);
}

// ── Drag and drop ─────────────────────────────────────────────────────────

let catDragId = null;

function catDragStart(e, id) {
  catDragId = id;
  e.dataTransfer.effectAllowed = 'move';
  e.currentTarget.classList.add('dragging');
}

function catDragOver(e, id) {
  if (id === catDragId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.cat-item-row.drag-over').forEach(el => el.classList.remove('drag-over'));
  e.currentTarget.classList.add('drag-over');
}

async function catDrop(e, targetId) {
  e.preventDefault();
  document.querySelectorAll('.cat-item-row.drag-over,.cat-item-row.dragging').forEach(el => {
    el.classList.remove('drag-over'); el.classList.remove('dragging');
  });
  if (!catDragId || catDragId === targetId) return;
  const dragged = state.categories.find(c => c.id === catDragId);
  const target  = state.categories.find(c => c.id === targetId);
  if (!dragged || !target) return;
  const isTargetParent = !target.parent_id;
  const isDraggedChild = !!dragged.parent_id;
  if (isTargetParent && isDraggedChild && dragged.parent_id !== target.id) {
    if (!confirm(`Mover "${dragged.name}" para "${target.name}"?`)) return;
    const { error } = await sb.from('categories').update({ parent_id: target.id }).eq('id', dragged.id);
    if (error) { toast(error.message, 'error'); return; }
    dragged.parent_id = target.id;
    toast(`"${dragged.name}" movido para "${target.name}"!`, 'success');
    buildCatPicker();
    renderCategories();
  } else if (!isTargetParent && !isDraggedChild) {
    toast('Solte em uma subcategoria para reparentar, ou use ✏️ para editar', 'info');
  } else {
    toast(t('toast.cat_edit_parent'), 'info');
  }
  catDragId = null;
}

function catDragEnd() {
  document.querySelectorAll('.cat-item-row.dragging,.cat-item-row.drag-over').forEach(el => {
    el.classList.remove('dragging'); el.classList.remove('drag-over');
  });
  catDragId = null;
}

// ── Category modal (create/edit) ──────────────────────────────────────────

function openCategoryModal(id = '', preParentId = '', preType = '') {
  const form = { id: '', name: '', type: preType || 'despesa', parent_id: preParentId || '', icon: '📦', color: '#2a6049' };
  if (id) { const c = state.categories.find(x => x.id === id); if (c) Object.assign(form, c); }

  document.getElementById('categoryId').value    = form.id;
  document.getElementById('categoryName').value  = form.name;
  document.getElementById('categoryType').value  = form.type;
  document.getElementById('categoryIcon').value  = form.icon || '📦';
  document.getElementById('categoryColor').value = form.color || '#2a6049';
  const _catChatEl = document.getElementById('categoryChatEnabled');
  if (_catChatEl) _catChatEl.checked = form.chat_enabled !== false; // default true
  document.getElementById('categoryModalTitle').textContent = id ? 'Editar Categoria' : (preParentId ? 'Nova Subcategoria' : 'Nova Categoria');

  const sel = document.getElementById('categoryParent');
  sel.innerHTML = '<option value="">— Nenhuma (categoria pai) —</option>' +
    state.categories.filter(c => !c.parent_id && c.id !== id).map(c =>
      `<option value="${c.id}">${c.icon || ''} ${esc(c.name)}</option>`
    ).join('');
  sel.value = form.parent_id || '';

  const hint = document.getElementById('catParentHint');
  if (preParentId && !id) {
    const parent = state.categories.find(x => x.id === preParentId);
    if (hint && parent) { hint.textContent = `Subcategoria de: ${parent.icon || ''} ${parent.name}`; hint.style.display = 'block'; }
  } else {
    if (hint) hint.style.display = 'none';
  }

  _syncCatIconPicker(form.icon || '📦');
  openModal('categoryModal');
}

function _syncCatIconPicker(iconVal) {
  const preview = document.getElementById('categoryIconPreview');
  if (preview) preview.textContent = iconVal || '📦';
  document.querySelectorAll('#categoryIconPicker .icon-option').forEach(el => {
    el.classList.toggle('selected', el.dataset.icon === 'emoji-' + iconVal);
  });
}

function showCatIconGroup(e, group) {
  const picker = document.getElementById('categoryIconPicker');
  if (!picker) return;
  picker.querySelectorAll('.icon-grid').forEach(g => g.style.display = 'none');
  const target = document.getElementById('catIconGroup-' + group);
  if (target) target.style.display = '';
  picker.querySelectorAll('.icon-tab').forEach(t => t.classList.remove('active'));
  if (e && e.currentTarget) e.currentTarget.classList.add('active');
  else if (e && e.target) e.target.classList.add('active');
}

function selectCatIcon(el) {
  const raw   = el.dataset.icon || '';
  const emoji = raw.startsWith('emoji-') ? raw.slice(6) : raw;
  const input = document.getElementById('categoryIcon');
  if (input) input.value = emoji;
  _syncCatIconPicker(emoji);
}

async function saveCategory() {
  const id   = document.getElementById('categoryId').value;
  const data = {
    name:      document.getElementById('categoryName').value.trim(),
    type:      document.getElementById('categoryType').value,
    parent_id: document.getElementById('categoryParent').value || null,
    icon:      document.getElementById('categoryIcon').value || '📦',
    color:     document.getElementById('categoryColor').value,
    chat_enabled: document.getElementById('categoryChatEnabled') ? !!document.getElementById('categoryChatEnabled').checked : true,
  };
  if (!data.name) { toast(t('toast.err_name'), 'error'); return; }
  if (!id) data.family_id = famId();

  let err;
  if (id) {
    ({ error: err } = await sb.from('categories').update(data).eq('id', id));
  } else {
    ({ error: err } = await sb.from('categories').insert(data));
  }
  if (err) { toast(err.message, 'error'); return; }

  const _isNew=!id;
  toast(t('category.saved'),'success');
  closeModal('categoryModal');
  DB.categories.bust(); await loadCategories(true);
  if(typeof populateSelects==='function') populateSelects(); renderCategories();
  if(_isNew) _scrollTopAndHighlight('.cat-group:first-child');

  if (window._catSaveCallback) {
    const cb = window._catSaveCallback;
    window._catSaveCallback = null;
    const saved = state.categories.find(c => c.name === data.name && c.type === data.type && !id);
    if (saved) cb(saved.id);
  }
}

// ── Delete with tx-count check & reassign ────────────────────────────────

async function deleteCategory(id) {
  const cat = state.categories.find(c => c.id === id);
  if (!cat) return;

  // Contar transações vinculadas (incluindo subcategorias para pais)
  const childIds   = state.categories.filter(c => c.parent_id === id).map(c => c.id);
  const allIds     = [id, ...childIds];
  const txCount    = allIds.reduce((s, cid) => s + (_catTxCounts[cid] || 0), 0);

  // Contar também orçamentos e programados vinculados
  const { count: budgetCount } = await famQ(
    sb.from('budgets').select('id', { count: 'exact', head: true })
  ).in('category_id', allIds);

  const { count: schedCount } = await famQ(
    sb.from('scheduled_transactions').select('id', { count: 'exact', head: true })
  ).in('category_id', allIds);

  const totalLinked = (txCount || 0) + (budgetCount || 0) + (schedCount || 0);
  const hasChildren = childIds.length > 0;

  if (totalLinked > 0 || hasChildren) {
    // Abrir modal de reatribuição
    _openCatReassignModal(cat, childIds, txCount || 0, budgetCount || 0, schedCount || 0);
    return;
  }

  // Sem vínculos — excluir direto
  if (!confirm(`Excluir a categoria "${cat.name}"?`)) return;
  await _doDeleteCategory(id);
}

function _openCatReassignModal(cat, childIds, txCount, budgetCount, schedCount) {
  const modal = document.getElementById('catReassignModal');
  if (!modal) return;

  document.getElementById('catReassignTitle').textContent   = `Excluir: ${cat.icon || ''} ${cat.name}`;
  document.getElementById('catReassignDeleteId').value      = cat.id;
  document.getElementById('catReassignChildIds').value      = JSON.stringify(childIds);

  // Montar resumo dos vínculos
  const parts = [];
  if (txCount > 0)     parts.push(`<strong>${txCount}</strong> transação(ões)`);
  if (budgetCount > 0) parts.push(`<strong>${budgetCount}</strong> orçamento(s)`);
  if (schedCount > 0)  parts.push(`<strong>${schedCount}</strong> transação(ões) programada(s)`);
  if (childIds.length) parts.push(`<strong>${childIds.length}</strong> subcategoria(s)`);

  document.getElementById('catReassignSummary').innerHTML =
    `⚠️ Esta categoria possui ${parts.join(', ')} vinculado(s). ` +
    `Selecione para qual categoria os registros devem ser transferidos antes de excluir.`;

  // Popular select de destino (mesmo tipo, excluindo a própria categoria e seus filhos)
  const excluded = new Set([cat.id, ...childIds]);
  const options  = state.categories
    .filter(c => c.type === cat.type && !excluded.has(c.id))
    .sort((a, b) => {
      // Agrupar: pai primeiro, depois filhos indentados
      const aIsChild = !!a.parent_id;
      const bIsChild = !!b.parent_id;
      if (aIsChild !== bIsChild) return aIsChild ? 1 : -1;
      return a.name.localeCompare(b.name);
    });

  const sel = document.getElementById('catReassignTarget');
  sel.innerHTML = '<option value="">— Selecionar categoria destino —</option>' +
    options.map(c => {
      const isChild = !!c.parent_id;
      const parent  = isChild ? state.categories.find(p => p.id === c.parent_id) : null;
      const label   = isChild ? `　↳ ${c.icon || ''} ${esc(c.name)} (em ${parent ? esc(parent.name) : '?'})` : `${c.icon || '📦'} ${esc(c.name)}`;
      return `<option value="${c.id}">${label}</option>`;
    }).join('');

  openModal('catReassignModal');
}

async function confirmCatReassign() {
  const fromId    = document.getElementById('catReassignDeleteId').value;
  const childIds  = JSON.parse(document.getElementById('catReassignChildIds').value || '[]');
  const toId      = document.getElementById('catReassignTarget').value;

  if (!toId) { toast(t('toast.err_select_cat'), 'error'); return; }

  const allFromIds = [fromId, ...childIds];

  // Desabilitar botão durante operação
  const btn = document.getElementById('catReassignConfirmBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Transferindo...'; }

  try {
    // 1. Reatribuir transações
    for (const fid of allFromIds) {
      const { error: e1 } = await sb.from('transactions')
        .update({ category_id: toId })
        .eq('category_id', fid)
        .eq('family_id', famId());
      if (e1) throw new Error('Erro ao atualizar transações: ' + e1.message);
    }

    // 2. Reatribuir orçamentos
    for (const fid of allFromIds) {
      await sb.from('budgets')
        .update({ category_id: toId })
        .eq('category_id', fid)
        .eq('family_id', famId());
    }

    // 3. Reatribuir transações programadas
    for (const fid of allFromIds) {
      await sb.from('scheduled_transactions')
        .update({ category_id: toId })
        .eq('category_id', fid)
        .eq('family_id', famId());
    }

    // 4. Excluir subcategorias
    for (const cid of childIds) {
      await sb.from('categories').delete().eq('id', cid);
    }

    // 5. Excluir a categoria principal
    await _doDeleteCategory(fromId);

    closeModal('catReassignModal');
    toast(t('category.deleted'), 'success');

  } catch (err) {
    toast(err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✅ Transferir e Excluir'; }
  }
}

async function _doDeleteCategory(id) {
  const { error } = await sb.from('categories').delete().eq('id', id);
  if (error) { toast(error.message, 'error'); return; }
  toast(t('category.deleted_simple'), 'success');
  DB.categories.bust(); await loadCategories(true);
  await _loadCatTxCounts();
  if(typeof populateSelects==='function') populateSelects();
  renderCategories();
}

// ── Quick create from transaction modal ───────────────────────────────────

function quickCreateCategory(type, ctx) {
  ctx  = ctx  || 'tx';
  type = type || 'despesa';
  window._catSaveCallback = function (catId) {
    buildCatPicker(type, ctx);
    setCatPickerValue(catId, ctx);
  };
  openCategoryModal('', '', type);
}

// ── Category Tx History (últimos 6 meses) ────────────────────────────────
async function openCategoryHistory(catId, catName) {
  const modal = document.getElementById('categoryHistoryModal');
  if (!modal) return;
  document.getElementById('catHistoryTitle').textContent = catName + ' — últimos 6 meses';
  document.getElementById('catHistoryTotal').textContent = '';
  document.getElementById('catHistoryBody').innerHTML =
    '<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--muted)">Carregando…</td></tr>';
  openModal('categoryHistoryModal');

  const since = new Date();
  since.setMonth(since.getMonth() - 6);
  const sinceStr = since.toISOString().slice(0, 10);
  const childIds = state.categories.filter(c => c.parent_id === catId).map(c => c.id);
  const allIds = [catId, ...childIds];

  let q = famQ(
    sb.from('transactions')
      .select('id,date,description,amount,currency,brl_amount,status,accounts!transactions_account_id_fkey(name,currency),categories(name,color)')
  ).gte('date', sinceStr).order('date', { ascending: false }).limit(300);
  q = allIds.length === 1 ? q.eq('category_id', catId) : q.in('category_id', allIds);

  const { data, error } = await q;
  if (error) {
    document.getElementById('catHistoryBody').innerHTML =
      `<tr><td colspan="4" style="text-align:center;color:var(--red)">Erro: ${esc(error.message)}</td></tr>`;
    return;
  }
  if (!data || !data.length) {
    document.getElementById('catHistoryBody').innerHTML =
      '<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--muted)">Nenhuma transação nos últimos 6 meses</td></tr>';
    return;
  }
  const total = data.reduce((s,t) => s + (parseFloat(t.amount)||0), 0);
  document.getElementById('catHistoryTotal').textContent =
    data.length + ' transações · Total: ' + fmt(total);
  document.getElementById('catHistoryBody').innerHTML = data.map(t => {
    const cur = t.currency || t.accounts?.currency || 'BRL';
    const amtClass = (parseFloat(t.amount)||0) >= 0 ? 'amount-pos' : 'amount-neg';
    const catBadge = t.categories
      ? `<span class="badge" style="background:${t.categories.color}18;color:${t.categories.color};border:1px solid ${t.categories.color}28;font-size:.65rem">${esc(t.categories.name)}</span>` : '';
    const pendDot = t.status==='pending' ? '<span style="color:var(--amber);font-size:.75rem"> ⏳</span>' : '';
    return `<tr style="cursor:pointer" onclick="closeModal('categoryHistoryModal');editTransaction('${t.id}')">
      <td style="white-space:nowrap;font-size:.8rem;color:var(--muted)">${fmtDate(t.date)}</td>
      <td><div style="font-size:.85rem;font-weight:500">${esc(t.description||'')}${pendDot}</div>
          <div style="margin-top:2px">${catBadge}</div>
          <div style="font-size:.7rem;color:var(--muted)">${esc(t.accounts?.name||'')}</div></td>
      <td class="${amtClass}" style="white-space:nowrap;font-weight:600;text-align:right">
        ${(parseFloat(t.amount)||0)>=0?'+':''}${fmt(t.amount,cur)}
        ${cur!=='BRL'&&t.brl_amount?`<div style="font-size:.68rem;color:var(--muted)">${fmt(t.brl_amount,'BRL')}</div>`:''}</td>
      <td></td></tr>`;
  }).join('');
}

// ── Page init ─────────────────────────────────────────────────────────────

async function initCategoriesPage() {
  // Sync do servidor e re-render com dados atualizados
  _syncCatFavsFromServer().then(() => {
    if (typeof renderCategories === 'function') renderCategories();
    if (state.currentPage === 'dashboard' && typeof _renderDashFavCategories === 'function')
      _renderDashFavCategories(_lastDashIncome, _lastDashExpense);
  }).catch(() => {});
  await _loadCatTxCounts();
  renderCategories();
}


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

// ── Expor funções públicas no window ──────────────────────────────────────────
window._loadCatFavorites                   = _loadCatFavorites;
window._syncCatFavsFromServer              = _syncCatFavsFromServer;
window.confirmCatReassign                  = confirmCatReassign;
window.initCategoriesPage                  = initCategoriesPage;
window.loadCategories                      = loadCategories;
window.openCategoryHistory                 = openCategoryHistory;
/** Toggle chat_enabled for a single category inline (no modal needed) */
async function toggleCatChatEnabled(catId) {
  const cat = (state.categories || []).find(c => c.id === catId);
  if (!cat) return;
  const newVal = cat.chat_enabled === false; // false → true, true/null → false
  try {
    const { error } = await sb.from('categories').update({ chat_enabled: newVal }).eq('id', catId);
    if (error) throw error;
    cat.chat_enabled = newVal;
    // Re-render only the button in-place without full re-render
    const btns = document.querySelectorAll(`.cat-chat-btn[onclick*="'${catId}'"]`);
    btns.forEach(btn => {
      const on = newVal;
      // Update all switch checkboxes for this category (parent + sub rows)
      document.querySelectorAll(`.cat-chat-switch input[onchange*="'${catId}'"]`).forEach(inp => {
        inp.checked = on;
        const lbl = inp.closest('.cat-chat-switch');
        if (lbl) lbl.title = on ? 'Chat ativo — clique para desativar' : 'Chat inativo — clique para ativar';
      });
    });
    toast(`💬 Categoria ${newVal ? 'ativada' : 'desativada'} no chat`, 'info');
  } catch(e) {
    toast('Erro: ' + (e.message || e), 'error');
  }
}
window.toggleCatChatEnabled = toggleCatChatEnabled;

/** Bulk toggle chat_enabled for ALL categories — auto-detects: if any is OFF → mark all ON; else mark all OFF */
async function _catBulkChatToggle() {
  const fid = typeof famId === 'function' ? famId() : currentUser?.family_id;
  if (!fid) return;
  const cats = state.categories || [];

  // If any category is currently disabled → enable all; otherwise disable all
  const anyOff = cats.some(c => c.chat_enabled === false);
  const enable = anyOff; // true = turn everyone ON, false = turn everyone OFF

  const action = enable ? 'ativar todas as categorias no chat' : 'desativar todas as categorias no chat';
  if (!confirm(`Deseja ${action}?`)) return;

  try {
    const { error } = await sb.from('categories')
      .update({ chat_enabled: enable })
      .eq('family_id', fid);
    if (error) throw error;

    // Update local state + re-render switches
    cats.forEach(c => { c.chat_enabled = enable; });

    // Update all visible switch checkboxes
    document.querySelectorAll('.cat-chat-switch input[type="checkbox"]').forEach(inp => {
      inp.checked = enable;
    });

    // Update button label
    const btn = document.getElementById('catBulkChatBtn');
    if (btn) btn.textContent = enable ? '💬 Desativar todas do Chat' : '💬 Ativar todas para Chat';

    toast(`✓ Chat ${enable ? 'ativado' : 'desativado'} em todas as categorias`, 'success');
  } catch(e) {
    toast('Erro: ' + (e.message || e), 'error');
  }
}
window._catBulkChatToggle = _catBulkChatToggle;
window._catBulkChatEnable = (enable) => { /* compat shim */ _catBulkChatToggle(); };

window.openCategoryModal                   = openCategoryModal;
window.renderCategories                    = renderCategories;
window.saveCategory                        = saveCategory;
window.selectCatIcon                       = selectCatIcon;
window.showCatIconGroup                    = showCatIconGroup;

// ── IOF Category Target ────────────────────────────────────────────────────
async function setIofCategoryTarget(catId, catName) {
  const current = window._iofCatId;

  // Toggle off if already set
  if (current === catId) {
    const ok = confirm(`Remover "${catName}" como categoria padrão do IOF?`);
    if (!ok) return;
    window._iofCatId = null;
    await setIofCategoryId(null);
    renderCategories();
    if (typeof toast === 'function') toast('Categoria IOF padrão removida.', 'info');
    return;
  }

  // Switching from another category?
  const hasPrevious = !!current;
  const prevCat = hasPrevious ? (state.categories||[]).find(c=>c.id===current) : null;
  let migrateHistory = false;

  if (hasPrevious) {
    const answer = confirm(
      `Definir "${catName}" como nova categoria padrão do IOF?\n\n` +
      `Anterior: "${prevCat?.name||'Outra'}"\n\n` +
      `Deseja transferir o histórico de transações IOF para esta categoria?`
    );
    if (!answer) return;
    migrateHistory = true;
  }

  await setIofCategoryId(catId);

  if (migrateHistory && typeof bulkUpdateIofCategory === 'function') {
    await bulkUpdateIofCategory(catId);
  }

  renderCategories();
  if (typeof toast === 'function')
    toast(`"${catName}" definida como categoria padrão do IOF.`, 'success');
}

// ════════════════════════════════════════════════════════════════════════════
//  CATEGORY 360° — panorâmica completa da categoria
// ════════════════════════════════════════════════════════════════════════════
async function openCategoryDetailModal(catId) {
  const cat=(state.categories||[]).find(c=>c.id===catId);
  if (!cat) return;

  const parent=cat.parent_id?(state.categories||[]).find(c=>c.id===cat.parent_id):null;
  const children=(state.categories||[]).filter(c=>c.parent_id===catId);

  document.querySelectorAll('#cat360Modal').forEach(m=>m.remove());

  const shell=document.createElement('div');
  shell.id='cat360Modal';
  shell.className='modal-overlay open';
  shell.onclick=e=>{if(e.target===shell)shell.remove();};
  shell.innerHTML=`<div class="modal" style="max-width:600px;max-height:90dvh;overflow-y:auto">
    <div class="modal-handle"></div>
    <div class="modal-body" style="padding:20px;text-align:center;color:var(--muted)">⏳ Carregando...</div>
  </div>`;
  document.body.appendChild(shell);

  // Fetch last 6 months
  const now=new Date();
  const from=new Date(now.getFullYear(),now.getMonth()-5,1).toISOString().slice(0,10);

  // Include sub-category IDs
  const catIds=[catId,...children.map(c=>c.id)];
  const { data:txs=[] }=await sb.from('transactions')
    .select('id,date,description,amount,brl_amount,currency,status,categories(name,color,icon),payees(name)')
    .in('category_id',catIds)
    .gte('date',from)
    .order('date',{ascending:false})
    .limit(60);

  const totalAmt=txs.reduce((s,t)=>s+Math.abs(parseFloat(t.brl_amount||t.amount)||0),0);
  const avgAmt=txs.length?totalAmt/txs.length:0;
  const isExp=cat.type==='despesa';

  // Month breakdown
  const byMonth={};
  txs.forEach(t=>{
    const m=t.date?.slice(0,7)||'';
    byMonth[m]=(byMonth[m]||0)+Math.abs(parseFloat(t.brl_amount||t.amount)||0);
  });
  const months=Object.entries(byMonth).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,6);
  const maxMonth=Math.max(...months.map(m=>m[1]),1);
  const monthBars=months.map(([m,v])=>{
    const pct=Math.round(v/maxMonth*100);
    const [y,mo]=m.split('-');
    const label=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][parseInt(mo)-1]||mo;
    return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <div style="font-size:.72rem;color:var(--muted);width:28px;flex-shrink:0">${label}</div>
      <div style="flex:1;background:var(--border);border-radius:4px;height:10px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${cat.color||'var(--accent)'};border-radius:4px;transition:width .3s"></div>
      </div>
      <div style="font-size:.72rem;font-weight:700;color:var(--text);width:80px;text-align:right">${fmt(v)}</div>
    </div>`;
  }).join('');

  // Top payees
  const payeeMap={};
  txs.forEach(t=>{const n=t.payees?.name||'—';payeeMap[n]=(payeeMap[n]||0)+Math.abs(parseFloat(t.brl_amount||t.amount)||0);});
  const topPayees=Object.entries(payeeMap).sort((a,b)=>b[1]-a[1]).slice(0,5);

  // TX rows
  const txRows=txs.slice(0,20).map(t=>{
    const amt=Math.abs(parseFloat(t.brl_amount||t.amount)||0);
    const d=t.date?t.date.split('-').reverse().join('/'):'—';
    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:5px 8px;font-size:.78rem;color:var(--muted);white-space:nowrap">${d}</td>
      <td style="padding:5px 8px;font-size:.8rem;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.description||'—')}</td>
      <td style="padding:5px 8px;font-size:.78rem;color:var(--muted)">${esc(t.payees?.name||'—')}</td>
      <td style="padding:5px 8px;font-size:.82rem;font-weight:700;text-align:right;color:${isExp?'#dc2626':'#16a34a'}">
        ${isExp?'−':'+'} ${fmt(amt)}</td>
    </tr>`;
  }).join('');

  shell.innerHTML=`
    <div class="modal" style="max-width:600px;max-height:90dvh;overflow-y:auto;border-radius:18px" onclick="event.stopPropagation()">
      <div class="modal-handle"></div>
      <div class="modal-header" style="padding:14px 18px">
        <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0">
          <div style="width:44px;height:44px;border-radius:12px;background:${cat.color||'var(--accent)'}22;display:flex;align-items:center;justify-content:center;font-size:1.4rem;flex-shrink:0">
            ${cat.icon||'🏷️'}
          </div>
          <div style="min-width:0">
            <div style="font-size:1rem;font-weight:800;color:var(--text)">${esc(cat.name)}</div>
            ${parent?`<div style="font-size:.75rem;color:var(--muted)">▸ ${esc(parent.name)}</div>`:''}
            <span style="font-size:.7rem;font-weight:700;color:${cat.color||'var(--accent)'};background:${cat.color||'var(--accent)'}18;padding:2px 8px;border-radius:20px">
              ${cat.type==='despesa'?'Despesa':cat.type==='receita'?'Receita':'Transferência'}
            </span>
          </div>
        </div>
        <button class="modal-close" onclick="document.getElementById('cat360Modal')?.remove()">✕</button>
      </div>

      <div class="modal-body" style="padding:16px 18px;display:flex;flex-direction:column;gap:16px">

        <!-- KPIs -->
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px">
          ${[
            ['Total 6 meses',fmt(totalAmt),'#dc2626'],
            ['Transações',txs.length,'#2563eb'],
            ['Ticket médio',fmt(avgAmt),'#d97706'],
            ['Subcategorias',children.length,'#6d28d9'],
          ].map(([l,v,c])=>`<div style="background:var(--surface2);border-radius:10px;padding:10px 12px;border:1px solid var(--border)">
            <div style="font-size:.66rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:3px">${l}</div>
            <div style="font-size:1rem;font-weight:800;color:${c}">${v}</div>
          </div>`).join('')}
        </div>

        <!-- Monthly bars -->
        ${months.length?`<div style="background:var(--surface2);border-radius:10px;padding:12px 14px;border:1px solid var(--border)">
          <div style="font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:10px">📊 Evolução mensal</div>
          ${monthBars}
        </div>`:''}

        <!-- Top payees -->
        ${topPayees.length?`<div style="background:var(--surface2);border-radius:10px;padding:12px 14px;border:1px solid var(--border)">
          <div style="font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:8px">👥 Top beneficiários</div>
          ${topPayees.map(([n,v])=>`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:.82rem;color:var(--text)">${esc(n)}</span>
            <span style="font-size:.82rem;font-weight:700;color:${isExp?'#dc2626':'#16a34a'}">${fmt(v)}</span>
          </div>`).join('')}
        </div>`:''}

        <!-- Subcategories -->
        ${children.length?`<div style="background:var(--surface2);border-radius:10px;padding:12px 14px;border:1px solid var(--border)">
          <div style="font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:8px">🏷️ Subcategorias</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${children.map(c=>`<span style="padding:3px 10px;border-radius:20px;background:${c.color||'var(--accent)'}20;color:${c.color||'var(--accent)'};font-size:.78rem;font-weight:600;border:1px solid ${c.color||'var(--accent)'}30">${c.icon||'▸'} ${esc(c.name)}</span>`).join('')}
          </div>
        </div>`:''}

        <!-- Recent transactions -->
        ${txs.length?`<div>
          <div style="font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:8px">📋 Últimos 6 meses (${txs.length} transações)</div>
          <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden">
            <table style="width:100%;border-collapse:collapse">
              <thead>
                <tr style="background:var(--surface2)">
                  <th style="padding:5px 8px;font-size:.7rem;font-weight:700;color:var(--muted);text-align:left">Data</th>
                  <th style="padding:5px 8px;font-size:.7rem;font-weight:700;color:var(--muted);text-align:left">Descrição</th>
                  <th style="padding:5px 8px;font-size:.7rem;font-weight:700;color:var(--muted);text-align:left">Beneficiário</th>
                  <th style="padding:5px 8px;font-size:.7rem;font-weight:700;color:var(--muted);text-align:right">Valor</th>
                </tr>
              </thead>
              <tbody>${txRows}</tbody>
            </table>
          </div>
        </div>`:'<div style="color:var(--muted);font-size:.8rem;text-align:center;padding:12px">Nenhuma transação nos últimos 6 meses.</div>'}

        <div style="display:flex;gap:8px">
          <button class="btn btn-ghost btn-sm" onclick="document.getElementById('cat360Modal')?.remove();openCategoryModal('${catId}')">✏️ Editar</button>
        </div>
      </div>
    </div>`;
}
window.openCategoryDetailModal = openCategoryDetailModal;

window.setIofCategoryTarget = setIofCategoryTarget;
