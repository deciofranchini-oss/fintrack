// ── Categories — per-family, with tx counts and safe deletion ─────────────

// Cache de contagem de transações por category_id: { [id]: number }
let _catTxCounts = {};

// ── Load ──────────────────────────────────────────────────────────────────

async function loadCategories() {
  const { data, error } = await famQ(sb.from('categories').select('*')).order('name');
  if (error) { toast(error.message, 'error'); return; }
  state.categories = data || [];
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

function renderCategories() {
  ['expense', 'income'].forEach(type => {
    const dbType    = type === 'expense' ? 'despesa' : 'receita';
    const container = document.getElementById('catEditor' + (type === 'expense' ? 'Expense' : 'Income'));
    const countEl   = document.getElementById('catCount'  + (type === 'expense' ? 'Expense' : 'Income'));
    if (!container) return;

    const parents     = state.categories.filter(c => c.type === dbType && !c.parent_id).sort((a, b) => a.name.localeCompare(b.name));
    const allChildren = state.categories.filter(c => c.type === dbType && c.parent_id);
    if (countEl) countEl.textContent = state.categories.filter(c => c.type === dbType).length + ' categorias';

    if (!parents.length) {
      container.innerHTML = `<div style="text-align:center;padding:24px;color:var(--muted);font-size:.83rem">
        Nenhuma categoria. Clique em "+ ${type === 'expense' ? 'Despesa' : 'Receita'}" para criar.</div>`;
      return;
    }

    container.innerHTML = parents.map(p => {
      const subs      = allChildren.filter(c => c.parent_id === p.id).sort((a, b) => a.name.localeCompare(b.name));
      const pTxCount  = _catTxCounts[p.id] || 0;
      const pOwnCount = pTxCount - subs.reduce((s, c) => s + (_catTxCounts[c.id] || 0), 0);

      return `
      <div class="cat-editor-wrap" id="catWrap-${p.id}">
        <div class="cat-item-row" draggable="true"
          ondragstart="catDragStart(event,'${p.id}')"
          ondragover="catDragOver(event,'${p.id}')"
          ondrop="catDrop(event,'${p.id}')"
          ondragend="catDragEnd()">
          <span class="cat-drag-handle" title="Arrastar para reordenar">⠿</span>
          <div class="cat-item-icon" style="background:${p.color || 'var(--bg2)'}20;border:2px solid ${p.color || 'var(--border)'}">
            <span>${p.icon || '📦'}</span>
          </div>
          <span class="cat-item-name" id="catName-${p.id}" ondblclick="startCatInlineEdit('${p.id}')">${esc(p.name)}</span>
          ${subs.length ? `<span class="cat-sub-count">${subs.length} sub</span>` : ''}
          ${pTxCount > 0 ? `<span class="cat-tx-count" title="${pTxCount} transação(ões) vinculada(s)">📊 ${pTxCount}</span>` : ''}
          <div class="cat-inline-actions">
            <button class="btn-icon" onclick="openCategoryModal('','${p.id}','${dbType}')" title="Nova subcategoria" style="font-size:.7rem;padding:3px 7px">+ Sub</button>
            <button class="btn-icon" onclick="openCategoryModal('${p.id}')" title="Editar">✏️</button>
            <button class="btn-icon" onclick="deleteCategory('${p.id}')" title="Excluir" style="color:var(--red)">🗑️</button>
          </div>
        </div>
        ${subs.map(c => {
          const cCount = _catTxCounts[c.id] || 0;
          return `
          <div class="cat-item-row" style="padding-left:36px;background:var(--surface2)" draggable="true"
            ondragstart="catDragStart(event,'${c.id}')"
            ondragover="catDragOver(event,'${c.id}')"
            ondrop="catDrop(event,'${c.id}')"
            ondragend="catDragEnd()">
            <span class="cat-drag-handle" title="Arrastar">⠿</span>
            <div class="cat-item-indent">
              <svg width="12" height="16" viewBox="0 0 12 16" fill="none"><path d="M1 0 L1 8 L12 8" stroke="var(--border2)" stroke-width="1.5"/></svg>
            </div>
            <div class="cat-item-icon" style="background:${c.color || 'var(--bg2)'}20;border:2px solid ${c.color || 'var(--border)'}">
              <span style="font-size:.65rem">${c.icon || '▸'}</span>
            </div>
            <span class="cat-item-name child-name" ondblclick="startCatInlineEdit('${c.id}')">${esc(c.name)}</span>
            <span class="cat-parent-chip" onclick="changeCatParent('${c.id}')" title="Mudar categoria pai">📂 ${esc(p.name)}</span>
            ${cCount > 0 ? `<span class="cat-tx-count" title="${cCount} transação(ões)">📊 ${cCount}</span>` : ''}
            <div class="cat-inline-actions">
              <button class="btn-icon" onclick="openCategoryModal('${c.id}')" title="Editar">✏️</button>
              <button class="btn-icon" onclick="deleteCategory('${c.id}')" title="Excluir" style="color:var(--red)">🗑️</button>
            </div>
          </div>`;
        }).join('')}
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
  toast('Nome atualizado', 'success');
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
    toast('Edite a categoria para mudar seu pai', 'info');
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
  };
  if (!data.name) { toast('Informe o nome', 'error'); return; }
  if (!id) data.family_id = famId();

  let err;
  if (id) {
    ({ error: err } = await sb.from('categories').update(data).eq('id', id));
  } else {
    ({ error: err } = await sb.from('categories').insert(data));
  }
  if (err) { toast(err.message, 'error'); return; }

  toast('Categoria salva!', 'success');
  closeModal('categoryModal');
  await loadCategories();
  populateSelects();
  renderCategories();

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

  if (!toId) { toast('Selecione a categoria destino', 'error'); return; }

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
    toast('Categoria excluída e registros transferidos!', 'success');

  } catch (err) {
    toast(err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✅ Transferir e Excluir'; }
  }
}

async function _doDeleteCategory(id) {
  const { error } = await sb.from('categories').delete().eq('id', id);
  if (error) { toast(error.message, 'error'); return; }
  toast('Categoria excluída', 'success');
  await loadCategories();
  await _loadCatTxCounts();
  populateSelects();
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

// ── Page init ─────────────────────────────────────────────────────────────

async function initCategoriesPage() {
  await _loadCatTxCounts();
  renderCategories();
}
