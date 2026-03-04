async function loadCategories(){const{data,error}=await famQ(sb.from('categories').select('*')).order('name');if(error){toast(error.message,'error');return;}state.categories=data||[];}
function renderCategories(){
  ['expense','income'].forEach(type=>{
    const dbType = type==='expense' ? 'despesa' : 'receita';
    const container = document.getElementById('catEditor' + (type==='expense'?'Expense':'Income'));
    const countEl = document.getElementById('catCount' + (type==='expense'?'Expense':'Income'));
    if(!container) return;
    const parents = state.categories.filter(c=>c.type===dbType&&!c.parent_id).sort((a,b)=>a.name.localeCompare(b.name));
    const allChildren = state.categories.filter(c=>c.type===dbType&&c.parent_id);
    if(countEl) countEl.textContent = state.categories.filter(c=>c.type===dbType).length + ' categorias';
    if(!parents.length){container.innerHTML=`<div style="text-align:center;padding:24px;color:var(--muted);font-size:.83rem">Nenhuma categoria. Clique em "+ ${type==='expense'?'Despesa':'Receita'}" para criar.</div>`;return;}
    container.innerHTML = parents.map(p=>{
      const subs = allChildren.filter(c=>c.parent_id===p.id).sort((a,b)=>a.name.localeCompare(b.name));
      return `
      <div class="cat-editor-wrap" id="catWrap-${p.id}">
        <div class="cat-item-row" draggable="true" ondragstart="catDragStart(event,'${p.id}')" ondragover="catDragOver(event,'${p.id}')" ondrop="catDrop(event,'${p.id}')" ondragend="catDragEnd()">
          <span class="cat-drag-handle" title="Arrastar para reordenar">⠿</span>
          <div class="cat-item-icon" style="background:${p.color||'var(--bg2)'}20;border:2px solid ${p.color||'var(--border)'}">
            <span>${p.icon||'📦'}</span>
          </div>
          <span class="cat-item-name" id="catName-${p.id}" ondblclick="startCatInlineEdit('${p.id}')">${esc(p.name)}</span>
          ${subs.length ? `<span class="cat-sub-count">${subs.length}</span>` : ''}
          <div class="cat-inline-actions">
            <button class="btn-icon" onclick="openCategoryModal('','${p.id}','${dbType}')" title="Nova subcategoria" style="font-size:.7rem;padding:3px 7px">+ Sub</button>
            <button class="btn-icon" onclick="openCategoryModal('${p.id}')" title="Editar">✏️</button>
            <button class="btn-icon" onclick="deleteCategory('${p.id}')" title="Excluir">🗑️</button>
          </div>
        </div>
        ${subs.map(c=>`
        <div class="cat-item-row" style="padding-left:36px;background:var(--surface2)" draggable="true"
          ondragstart="catDragStart(event,'${c.id}')" ondragover="catDragOver(event,'${c.id}')" ondrop="catDrop(event,'${c.id}')" ondragend="catDragEnd()">
          <span class="cat-drag-handle" title="Arrastar">⠿</span>
          <div class="cat-item-indent">
            <svg width="12" height="16" viewBox="0 0 12 16" fill="none"><path d="M1 0 L1 8 L12 8" stroke="var(--border2)" stroke-width="1.5"/></svg>
          </div>
          <div class="cat-item-icon" style="background:${c.color||'var(--bg2)'}20;border:2px solid ${c.color||'var(--border)'}">
            <span style="font-size:.65rem">${c.icon||'▸'}</span>
          </div>
          <span class="cat-item-name child-name" ondblclick="startCatInlineEdit('${c.id}')">${esc(c.name)}</span>
          <span class="cat-parent-chip" onclick="changeCatParent('${c.id}')" title="Mudar categoria pai">📂 ${esc(p.name)}</span>
          <div class="cat-inline-actions">
            <button class="btn-icon" onclick="openCategoryModal('${c.id}')" title="Editar">✏️</button>
            <button class="btn-icon" onclick="deleteCategory('${c.id}')" title="Excluir">🗑️</button>
          </div>
        </div>`).join('')}
      </div>`;
    }).join('');
    // Add "uncategorized children" (orphaned)
    const orphaned = allChildren.filter(c=>!parents.find(p=>p.id===c.parent_id));
    if(orphaned.length){
      container.innerHTML+=`<div style="font-size:.72rem;color:var(--muted);padding:6px 14px">Subcategorias sem pai: ${orphaned.map(c=>`<button class="cat-parent-chip" onclick="openCategoryModal('${c.id}')">${c.icon||''} ${esc(c.name)}</button>`).join(' ')}</div>`;
    }
  });
}

// ── Inline name editing ─────────────────────────────────────
function startCatInlineEdit(id) {
  const span = document.getElementById('catName-'+id);
  if(!span) return;
  const cat = state.categories.find(c=>c.id===id);
  if(!cat) return;
  const input = document.createElement('input');
  input.className = 'cat-inline-input';
  input.value = cat.name;
  input.onblur = () => finishCatInlineEdit(id, input.value);
  input.onkeydown = e => {
    if(e.key==='Enter') input.blur();
    if(e.key==='Escape') { input.value=cat.name; input.blur(); }
  };
  span.replaceWith(input);
  input.focus(); input.select();
}
async function finishCatInlineEdit(id, newName) {
  const trimmed = newName.trim();
  const cat = state.categories.find(c=>c.id===id);
  if(!cat || !trimmed || trimmed===cat.name) { renderCategories(); return; }
  const {error} = await sb.from('categories').update({name:trimmed}).eq('id',id);
  if(error){toast(error.message,'error'); renderCategories(); return;}
  cat.name = trimmed;
  toast('Nome atualizado','success');
  buildCatPicker();
  renderCategories();
}

// ── Change parent (promote/demote) ──────────────────────────
function changeCatParent(childId) {
  const cat = state.categories.find(c=>c.id===childId);
  if(!cat) return;
  const type = cat.type;
  const parents = state.categories.filter(c=>!c.parent_id&&c.id!==childId&&c.type===type);
  if(!parents.length){toast('Nenhuma categoria pai disponível','error');return;}
  // Simple select prompt via existing modal
  openCategoryModal(childId);
}

// ── Drag and drop for reorder / reparent ───────────────────
let catDragId = null;
function catDragStart(e, id) {
  catDragId = id;
  e.dataTransfer.effectAllowed = 'move';
  e.currentTarget.classList.add('dragging');
}
function catDragOver(e, id) {
  if(id===catDragId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.cat-item-row.drag-over').forEach(el=>el.classList.remove('drag-over'));
  e.currentTarget.classList.add('drag-over');
}
async function catDrop(e, targetId) {
  e.preventDefault();
  document.querySelectorAll('.cat-item-row.drag-over,.cat-item-row.dragging').forEach(el=>{el.classList.remove('drag-over');el.classList.remove('dragging');});
  if(!catDragId || catDragId===targetId) return;
  const dragged = state.categories.find(c=>c.id===catDragId);
  const target = state.categories.find(c=>c.id===targetId);
  if(!dragged||!target) return;
  // Dropping a parent onto another parent: reorder (no DB order yet — just visual swap name)
  // Dropping a child onto a parent: reparent
  const isTargetParent = !target.parent_id;
  const isDraggedChild = !!dragged.parent_id;
  if(isTargetParent && isDraggedChild && dragged.parent_id!==target.id) {
    // Reparent: move child under new parent
    if(!confirm(`Mover "${dragged.name}" para "${target.name}"?`)) return;
    const {error} = await sb.from('categories').update({parent_id:target.id}).eq('id',dragged.id);
    if(error){toast(error.message,'error');return;}
    dragged.parent_id = target.id;
    toast(`"${dragged.name}" movido para "${target.name}"!`,'success');
    buildCatPicker();
    renderCategories();
  } else if(!isTargetParent && !isDraggedChild) {
    toast('Solte em uma subcategoria para reparentar, ou use ✏️ para editar','info');
  } else {
    toast('Edite a categoria para mudar seu pai','info');
  }
  catDragId = null;
}
function catDragEnd() {
  document.querySelectorAll('.cat-item-row.dragging,.cat-item-row.drag-over').forEach(el=>{el.classList.remove('dragging');el.classList.remove('drag-over');});
  catDragId = null;
}
function openCategoryModal(id='', preParentId='', preType=''){
  const form={id:'',name:'',type:preType||'despesa',parent_id:preParentId||'',icon:'📦',color:'#2a6049'};
  if(id){const c=state.categories.find(x=>x.id===id);if(c)Object.assign(form,c);}
  document.getElementById('categoryId').value=form.id;
  document.getElementById('categoryName').value=form.name;
  document.getElementById('categoryType').value=form.type;
  document.getElementById('categoryIcon').value=form.icon||'';
  document.getElementById('categoryColor').value=form.color||'#2a6049';
  document.getElementById('categoryModalTitle').textContent=id?'Editar Categoria':(preParentId?'Nova Subcategoria':'Nova Categoria');
  const sel=document.getElementById('categoryParent');
  sel.innerHTML='<option value="">— Nenhuma (categoria pai) —</option>'+state.categories.filter(c=>!c.parent_id&&c.id!==id).map(c=>`<option value="${c.id}">${c.icon||''} ${esc(c.name)}</option>`).join('');
  sel.value=form.parent_id||'';
  const hint=document.getElementById('catParentHint');
  if(preParentId&&!id){
    const parent=state.categories.find(x=>x.id===preParentId);
    if(hint&&parent){hint.textContent=`Subcategoria de: ${parent.icon||''} ${parent.name}`;hint.style.display='block';}
  } else {
    if(hint)hint.style.display='none';
  }
  openModal('categoryModal');
}
async function saveCategory(){
  const id=document.getElementById('categoryId').value;
  const data={name:document.getElementById('categoryName').value.trim(),type:document.getElementById('categoryType').value,parent_id:document.getElementById('categoryParent').value||null,icon:document.getElementById('categoryIcon').value||'📦',color:document.getElementById('categoryColor').value};
  if(!data.name){toast('Informe o nome','error');return;}
  if(!id) data.family_id=famId(); let err;if(id){({error:err}=await sb.from('categories').update(data).eq('id',id));}else{({error:err}=await sb.from('categories').insert(data));}
  if(err){toast(err.message,'error');return;}
  toast('Categoria salva!','success');
  closeModal('categoryModal');
  await loadCategories();
  populateSelects();
  renderCategories();
  // If called from a transaction/scheduled modal, select the new category there
  if(window._catSaveCallback) {
    const cb = window._catSaveCallback;
    window._catSaveCallback = null;
    // Find the newly saved category by name+type
    const saved = state.categories.find(c => c.name === data.name && c.type === data.type && !id);
    if(saved) cb(saved.id);
  }
}
async function deleteCategory(id){if(!confirm('Excluir esta categoria?'))return;const{error}=await sb.from('categories').delete().eq('id',id);if(error){toast(error.message,'error');return;}toast('Removida','success');await loadCategories();populateSelects();renderCategories();}

// ── Quick create category from transaction/scheduled modal ────────────────
// Opens the category modal pre-filled with the correct type, and after saving
// automatically selects the new category in the calling picker (ctx = 'tx'|'sc').
function quickCreateCategory(type, ctx) {
  ctx = ctx || 'tx';
  type = type || 'despesa';
  // Store callback: will be called with the new category id after save
  window._catSaveCallback = function(catId) {
    buildCatPicker(type, ctx);
    setCatPickerValue(catId, ctx);
  };
  openCategoryModal('', '', type);
}
