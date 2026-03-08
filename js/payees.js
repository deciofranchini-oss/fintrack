/* ═══════════════════════════════════════════════════════════════════════════
   TITLE CASE — Normalização inteligente de nomes de beneficiários
   Regras:
   - Primeiras letras de cada palavra em maiúsculo, demais minúsculas
   - Artigos/preposições PT no meio da frase ficam minúsculos
     (de, da, do, das, dos, e, ou, para, pelo/pela, com, sem, sob, por…)
   - Siglas de 2 letras ALL-CAPS preservadas como sigla (BB, XP, OI…)
     exceto se forem preposição (DO, AS, OS, DE…)
   - Siglas conhecidas sempre ALL-CAPS: PIX, CPF, CNPJ, ATM, TED, DOC…
   - Abreviações: Ltda, Sa, Epp, Eireli, Mei, Me
   - Tokens com ponto/barra curtos: S.A, S/A → uppercase cada segmento
   - Tested: 16/16 casos reais de extratos bancários brasileiros
═══════════════════════════════════════════════════════════════════════════ */

// Artigos e preposições que ficam minúsculos quando no MEIO da frase
const _TC_LOWER = new Set([
  'de','da','do','das','dos','e','ou','a','o','as','os',
  'em','na','no','nas','nos','para','pelo','pela','pelos','pelas',
  'com','sem','sob','por','per','ante','até','após','entre',
]);

// Siglas sempre ALL-CAPS (independente de posição)
const _TC_UPPER_FULL = new Set([
  'cpf','cnpj','atm','pix','ted','doc','iss','nfe','nfse',
  'bb','xp','cef','oi','tim','claro','vivo','sky','gpa',
]);

// Abreviações → Primeira letra maiúscula (Ltda, Sa, Epp…)
const _TC_ABBREV = new Set([
  'ltda','sa','epp','eireli','mei','me',
]);

/**
 * Converte uma string para Title Case inteligente.
 * @param {string} str
 * @returns {string}
 */
function toTitleCase(str) {
  if (!str) return '';
  const s = str.trim();

  // Apenas números/símbolos → retorna sem alterar
  if (/^[\d\s\W]+$/.test(s)) return s;

  // Dividir por espaços (preserva espaços como tokens)
  const words = s.split(/([ \t]+)/);

  return words.map((token, idx) => {
    // Preservar separadores de espaço
    if (/^[ \t]+$/.test(token) || !token) return token;

    const low     = token.toLowerCase();
    const isFirst = idx === 0 || words.slice(0, idx).every(t => /^[ \t]+$/.test(t));
    const isLast  = idx === words.length - 1 || words.slice(idx + 1).every(t => /^[ \t]+$/.test(t));

    // ── Token com separador interno curto: S.A, S/A, C.A → uppercase por segmento
    if (/[./]/.test(token) && token.replace(/[./]/g, '').length <= 4) {
      return token.split(/([./])/).map(seg => {
        if (/^[./]$/.test(seg)) return seg;
        return seg.toUpperCase();
      }).join('');
    }

    // ── Sigla ALL-CAPS conhecida → sempre uppercase
    if (_TC_UPPER_FULL.has(low)) return low.toUpperCase();

    // ── Abreviação conhecida → Capitalize
    if (_TC_ABBREV.has(low)) return low.charAt(0).toUpperCase() + low.slice(1);

    // ── Sigla inferida: exatamente 2 letras ALL-CAPS que NÃO seja preposição
    if (/^[A-ZÀ-Ú]{2}$/.test(token) && !_TC_LOWER.has(low)) return token;

    // ── Preposição/artigo no MEIO da frase → minúsculas
    if (!isFirst && !isLast && _TC_LOWER.has(low)) return low;

    // ── Capitalização padrão: primeira maiúscula, restante minúsculas
    return low.charAt(0).toUpperCase() + low.slice(1);
  }).join('');
}

/** Aplica toTitleCase com trim — ponto de entrada para salvar nomes */
function normalizePayeeName(name) {
  return toTitleCase((name || '').trim());
}

/* ─── Normalização em massa de beneficiários ─────────────────────────────── */

async function openNormalizePayeesModal() {
  const changes = (state.payees || [])
    .map(p => ({ id: p.id, oldName: p.name, newName: normalizePayeeName(p.name) }))
    .filter(c => c.oldName !== c.newName);

  const countEl  = document.getElementById('normPayeeCount');
  const listEl   = document.getElementById('normPayeeList');
  const applyBtn = document.getElementById('normPayeeApplyBtn');

  if (countEl) countEl.textContent = changes.length;

  if (!changes.length) {
    if (listEl) listEl.innerHTML =
      '<div class="norm-empty">✅ Todos os nomes já estão no formato correto.</div>';
    if (applyBtn) applyBtn.style.display = 'none';
  } else {
    if (listEl) {
      listEl.innerHTML = changes.map(c => `
        <div class="norm-row">
          <div class="norm-row-old" title="${esc(c.oldName)}">${esc(c.oldName)}</div>
          <div class="norm-row-arrow">→</div>
          <div class="norm-row-new" title="${esc(c.newName)}">${esc(c.newName)}</div>
        </div>`).join('');
    }
    if (applyBtn) { applyBtn.style.display = ''; applyBtn.disabled = false; applyBtn.textContent = `✅ Aplicar em ${changes.length} nome${changes.length !== 1 ? 's' : ''}`; }
  }

  window._normPayeeChanges = changes;
  openModal('normalizePayeesModal');
}

async function applyNormalizePayees() {
  const changes = window._normPayeeChanges || [];
  if (!changes.length) { closeModal('normalizePayeesModal'); return; }

  const applyBtn = document.getElementById('normPayeeApplyBtn');
  if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = '⏳ Salvando...'; }

  let ok = 0, fail = 0;
  const BATCH = 10;
  for (let i = 0; i < changes.length; i += BATCH) {
    const slice = changes.slice(i, i + BATCH);
    await Promise.all(slice.map(async c => {
      const { error } = await sb.from('payees')
        .update({ name: c.newName })
        .eq('id', c.id)
        .eq('family_id', famId());
      if (error) { fail++; console.warn('[NormPayee]', c.id, error.message); }
      else ok++;
    }));
  }

  closeModal('normalizePayeesModal');
  await loadPayees();
  populateSelects();
  renderPayees();

  toast(
    fail === 0
      ? `✅ ${ok} nome${ok !== 1 ? 's' : ''} normalizado${ok !== 1 ? 's' : ''}!`
      : `✓ ${ok} OK · ⚠️ ${fail} erro${fail !== 1 ? 's' : ''}`,
    fail === 0 ? 'success' : 'warning'
  );
  window._normPayeeChanges = [];
}

async function loadPayees(){const{data,error}=await famQ(sb.from('payees').select('*, categories(name)')).order('name');if(error){toast(error.message,'error');return;}state.payees=data||[];}

// ── Contagem de transações por payee ──────────────────────────────────────
let _payeeTxCounts = {};

async function _loadPayeeTxCounts() {
  const { data } = await famQ(
    sb.from('transactions').select('payee_id')
  ).not('payee_id', 'is', null);
  _payeeTxCounts = {};
  (data || []).forEach(t => {
    _payeeTxCounts[t.payee_id] = (_payeeTxCounts[t.payee_id] || 0) + 1;
  });
}

function payeeTypeBadge(t){const m={beneficiario:'badge-blue',fonte_pagadora:'badge-green',ambos:'badge-amber'};const l={beneficiario:'Beneficiário',fonte_pagadora:'Fonte Pagadora',ambos:'Ambos'};return`<span class="badge ${m[t]||'badge-muted'}">${l[t]||t}</span>`;}

function payeeRow(p) {
  const initials = (p.name||'?').trim().split(/\s+/).map(w=>w[0]||'').slice(0,2).join('').toUpperCase();
  const colors = ['#2a6049','#1e5ba8','#b45309','#6d28d9','#0e7490','#be185d','#047857','#7c3aed'];
  const colorIdx = (p.name||'').charCodeAt(0) % colors.length;
  const avatarColor = colors[colorIdx];
  const txCount = _payeeTxCounts[p.id] || 0;
  const txBadge = txCount > 0
    ? `<span style="display:inline-flex;align-items:center;gap:3px;font-size:.72rem;font-weight:600;color:var(--accent);background:var(--accent-lt);border:1px solid var(--accent)30;border-radius:20px;padding:1px 7px">${txCount} tx</span>`
    : `<span style="font-size:.72rem;color:var(--muted)">—</span>`;
  return `<tr class="payee-row">
    <td>
      <div style="display:flex;align-items:center;gap:10px">
        <div class="payee-row-avatar" style="background:${avatarColor}18;border:1.5px solid ${avatarColor}40;color:${avatarColor}">${initials}</div>
        <div>
          <div style="font-weight:600;font-size:.875rem">${esc(p.name)}</div>
          ${p.notes ? `<div style="font-size:.72rem;color:var(--muted);margin-top:1px">${esc(p.notes)}</div>` : ''}
        </div>
      </div>
    </td>
    <td style="font-size:.82rem;color:var(--text2)">${p.categories?.name||'<span style="color:var(--muted)">—</span>'}</td>
    <td style="text-align:center">${txBadge}</td>
    <td>
      <div style="display:flex;gap:5px;justify-content:flex-end">
        <button class="btn-icon" onclick="openPayeeModal('${p.id}')" title="Editar">✏️</button>
        <button class="btn-icon" onclick="deletePayee('${p.id}')" title="Excluir" style="color:var(--red)">🗑️</button>
      </div>
    </td>
  </tr>`;
}

const PAYEE_GROUP_DEF = [
  { key:'beneficiario',    label:'Beneficiários',    icon:'💸', color:'var(--blue)',  colorLt:'var(--blue-lt)'  },
  { key:'fonte_pagadora',  label:'Fontes Pagadoras',  icon:'💰', color:'var(--green)', colorLt:'var(--green-lt)' },
  { key:'ambos',           label:'Ambos',             icon:'🔄', color:'var(--amber)', colorLt:'var(--amber-lt)' },
];
const payeeGroupState = { beneficiario: true, fonte_pagadora: true, ambos: true }; // true = expanded

function renderPayees(filter='', typeFilter='') {
  let ps = state.payees;
  if(filter) ps = ps.filter(p => p.name.toLowerCase().includes(filter.toLowerCase()));
  if(typeFilter) ps = ps.filter(p => p.type === typeFilter);

  // Summary chips
  const bar = document.getElementById('payeeSummaryBar');
  if(bar) {
    const all = typeFilter ? [] : PAYEE_GROUP_DEF.map(g => {
      const cnt = ps.filter(p => p.type === g.key).length;
      if(!cnt) return '';
      return `<div class="payee-summary-chip" onclick="scrollPayeeGroup('${g.key}')" style="border-left:3px solid ${g.color}">
        <span>${g.icon}</span>
        <span style="font-weight:600;color:var(--text)">${g.label}</span>
        <span class="badge" style="background:${g.colorLt};color:${g.color};border:1px solid ${g.color}30">${cnt}</span>
      </div>`;
    });
    bar.innerHTML = all.join('');
    bar.style.display = ps.length && !typeFilter ? 'flex' : 'none';
  }

  const container = document.getElementById('payeeGroups');
  if(!container) return;

  if(!ps.length) {
    container.innerHTML = '<div class="card" style="text-align:center;padding:40px;color:var(--muted);font-size:.875rem">Nenhum beneficiário encontrado</div>';
    return;
  }

  // When filtering by type, show a single flat group
  const groups = typeFilter
    ? [{ ...PAYEE_GROUP_DEF.find(g=>g.key===typeFilter)||{key:typeFilter,label:typeFilter,icon:'👤',color:'var(--accent)',colorLt:'var(--accent-lt)'}, items: ps }]
    : PAYEE_GROUP_DEF.map(g => ({ ...g, items: ps.filter(p=>p.type===g.key) })).filter(g=>g.items.length>0);

  container.innerHTML = groups.map(g => {
    const expanded = payeeGroupState[g.key] !== false;
    return `<div class="payee-group-wrap" id="payeeGroup-${g.key}">
      <div class="payee-group-header" onclick="togglePayeeGroup('${g.key}')">
        <div class="payee-group-icon" style="background:${g.colorLt}">${g.icon}</div>
        <span class="payee-group-title">${g.label}</span>
        <div class="payee-group-meta">
          <span class="badge" style="background:${g.colorLt};color:${g.color};border:1px solid ${g.color}30;font-size:.75rem">${g.items.length} registro${g.items.length!==1?'s':''}</span>
        </div>
        <span class="payee-group-arrow${expanded?'':' collapsed'}">▼</span>
      </div>
      <div class="payee-group-body${expanded?'':' collapsed'}" id="payeeGroupBody-${g.key}">
        <div class="table-wrap" style="margin:0">
          <table style="border-radius:0">
            <thead><tr><th>Nome</th><th>Categoria Padrão</th><th style="width:80px;text-align:center">Transações</th><th style="width:70px"></th></tr></thead>
            <tbody>${g.items.map(p=>payeeRow(p)).join('')}</tbody>
          </table>
        </div>
      </div>
    </div>`;
  }).join('');
}

function togglePayeeGroup(key) {
  payeeGroupState[key] = !payeeGroupState[key];
  const body = document.getElementById('payeeGroupBody-'+key);
  const arrow = document.querySelector('#payeeGroup-'+key+' .payee-group-arrow');
  if(body) body.classList.toggle('collapsed', !payeeGroupState[key]);
  if(arrow) arrow.classList.toggle('collapsed', !payeeGroupState[key]);
}

function scrollPayeeGroup(key) {
  const el = document.getElementById('payeeGroup-'+key);
  if(!el) return;
  // Ensure expanded
  if(!payeeGroupState[key]) togglePayeeGroup(key);
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function filterPayees(){renderPayees(document.getElementById('payeeSearch').value,document.getElementById('payeeTypeFilter').value);}
function openPayeeModal(id=''){
  const form={id:'',name:'',type:'beneficiario',default_category_id:'',notes:''};
  if(id){const p=state.payees.find(x=>x.id===id);if(p)Object.assign(form,p);}
  document.getElementById('payeeId').value   = form.id;
  document.getElementById('payeeName').value = form.name;
  document.getElementById('payeeType').value = form.type;
  document.getElementById('payeeNotes').value = form.notes || '';
  document.getElementById('payeeModalTitle').textContent = id ? 'Editar Beneficiário' : 'Novo Beneficiário';
  _buildPayeeCatPicker(form.type, form.default_category_id || '');
  // Rebuild picker when type changes
  const typeEl = document.getElementById('payeeType');
  typeEl.onchange = () => _buildPayeeCatPicker(typeEl.value, '');
  openModal('payeeModal');
}

/** Constrói o dropdown hierárquico de categorias filtrado por tipo de beneficiário */
function _buildPayeeCatPicker(payeeType, selectedId) {
  const typeFilter = payeeType === 'beneficiario' ? 'expense'
    : payeeType === 'fonte_pagadora' ? 'income'
    : null; // 'ambos' → mostra todas

  const cats = state.categories || [];
  // Parents visíveis conforme tipo
  const parents = cats.filter(c => !c.parent_id && (typeFilter === null || c.type === typeFilter || c.type === 'both'));
  const dropdown = document.getElementById('payeeCatPickerDropdown');
  if (!dropdown) return;

  let html = `<div onclick="setPayeeCatValue('','true')"
    style="padding:9px 12px;cursor:pointer;font-size:.82rem;color:var(--muted);
           border-bottom:1px solid var(--border2)"
    onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background=''">
    — Nenhuma —</div>`;

  if (typeFilter === null) {
    // Agrupar por tipo quando 'ambos'
    [['expense','💸 Despesas'],['income','💰 Receitas']].forEach(([t, label]) => {
      const group = parents.filter(p => p.type === t || p.type === 'both');
      if (!group.length) return;
      html += `<div style="padding:5px 10px;font-size:.7rem;font-weight:700;
                           text-transform:uppercase;letter-spacing:.06em;
                           color:var(--muted);background:var(--surface2)">${label}</div>`;
      group.forEach(p => { html += _payeeCatParentHtml(p, cats.filter(c => c.parent_id === p.id)); });
    });
  } else {
    parents.forEach(p => { html += _payeeCatParentHtml(p, cats.filter(c => c.parent_id === p.id)); });
  }

  dropdown.innerHTML = html;
  // Apply selected value
  setPayeeCatValue(selectedId, false);
}

function _payeeCatParentHtml(parent, children) {
  const dot = parent.color ? `<span style="width:9px;height:9px;border-radius:50%;background:${parent.color};display:inline-block;flex-shrink:0"></span>` : '';
  const icon = parent.icon ? (parent.icon.startsWith('emoji-') ? `<span>${parent.icon.slice(6)}</span>` : '') : '';
  let h = `<div onclick="setPayeeCatValue('${parent.id}', true)"
    style="padding:8px 12px;cursor:pointer;font-size:.83rem;font-weight:600;
           display:flex;align-items:center;gap:7px;border-bottom:1px solid var(--border2)"
    onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background=''">
    ${dot}${icon}<span>${esc(parent.name)}</span></div>`;
  children.forEach(c => {
    const cdot = c.color ? `<span style="width:7px;height:7px;border-radius:50%;background:${c.color};display:inline-block;flex-shrink:0"></span>` : '';
    h += `<div onclick="setPayeeCatValue('${c.id}', true)"
      style="padding:7px 12px 7px 28px;cursor:pointer;font-size:.8rem;
             display:flex;align-items:center;gap:7px;border-bottom:1px solid var(--border2)"
      onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background=''">
      ${cdot}<span>${esc(c.name)}</span></div>`;
  });
  return h;
}

function togglePayeeCatPicker() {
  const dd = document.getElementById('payeeCatPickerDropdown');
  if (!dd) return;
  const open = dd.style.display !== 'none';
  dd.style.display = open ? 'none' : 'block';
  if (!open) {
    // close on outside click
    setTimeout(() => {
      document.addEventListener('click', function _close(e) {
        const wrap = document.getElementById('payeeCatPickerWrap');
        if (wrap && !wrap.contains(e.target)) {
          dd.style.display = 'none';
          document.removeEventListener('click', _close);
        }
      });
    }, 10);
  }
}

function setPayeeCatValue(catId, closeDropdown) {
  document.getElementById('payeeCategory').value = catId || '';
  const btn   = document.getElementById('payeeCatPickerBtn');
  const label = document.getElementById('payeeCatPickerLabel');
  const dot   = document.getElementById('payeeCatPickerDot');
  const dd    = document.getElementById('payeeCatPickerDropdown');
  if (!catId) {
    if (label) label.textContent = '— Nenhuma —';
    if (dot)   dot.style.background = 'var(--muted)';
  } else {
    const cat = (state.categories || []).find(c => c.id === catId);
    if (cat) {
      if (label) label.textContent = cat.name;
      if (dot)   dot.style.background = cat.color || 'var(--accent)';
    }
  }
  if (closeDropdown && dd) dd.style.display = 'none';
}
async function savePayee(){
  const id=document.getElementById('payeeId').value;
  const data={name:normalizePayeeName(document.getElementById('payeeName').value),type:document.getElementById('payeeType').value,default_category_id:document.getElementById('payeeCategory').value||null,notes:document.getElementById('payeeNotes').value};
  if(!data.name){toast('Informe o nome','error');return;}
  if(!id) data.family_id=famId(); let err;if(id){({error:err}=await sb.from('payees').update(data).eq('id',id));}else{({error:err}=await sb.from('payees').insert(data));}
  if(err){toast(err.message,'error');return;}toast('Salvo!','success');closeModal('payeeModal');await loadPayees();populateSelects();renderPayees();
}
async function deletePayee(id) {
  const payee = state.payees.find(p => p.id === id);
  if (!payee) return;

  const txCount = _payeeTxCounts[id] || 0;

  // Contar transações programadas vinculadas
  const { count: schedCount } = await famQ(
    sb.from('scheduled_transactions').select('id', { count: 'exact', head: true })
  ).eq('payee_id', id);

  const totalLinked = txCount + (schedCount || 0);

  if (totalLinked > 0) {
    _openPayeeReassignModal(payee, txCount, schedCount || 0);
    return;
  }

  if (!confirm(`Excluir "${payee.name}"?`)) return;
  await _doDeletePayee(id);
}

function _openPayeeReassignModal(payee, txCount, schedCount) {
  document.getElementById('payeeReassignTitle').textContent = `Excluir: ${payee.name}`;
  document.getElementById('payeeReassignDeleteId').value = payee.id;

  // Resumo
  const parts = [];
  if (txCount  > 0) parts.push(`<strong>${txCount}</strong> transação(ões)`);
  if (schedCount > 0) parts.push(`<strong>${schedCount}</strong> transação(ões) programada(s)`);
  document.getElementById('payeeReassignSummary').innerHTML =
    `⚠️ Este beneficiário possui ${parts.join(' e ')} vinculado(s). ` +
    `Selecione um beneficiário destino ou crie um novo antes de excluir.`;

  // Popular select — todos os payees exceto o que está sendo deletado
  const options = state.payees
    .filter(p => p.id !== payee.id)
    .sort((a, b) => a.name.localeCompare(b.name));

  const sel = document.getElementById('payeeReassignTarget');
  sel.innerHTML = '<option value="">— Selecionar beneficiário destino —</option>' +
    options.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');

  // Reset create-new fields
  document.getElementById('payeeReassignNewArea').style.display = 'none';
  document.getElementById('payeeReassignNewName').value = '';
  document.getElementById('payeeReassignUseNew').checked = false;
  sel.disabled = false;

  openModal('payeeReassignModal');
}

function togglePayeeReassignNew(checked) {
  document.getElementById('payeeReassignNewArea').style.display = checked ? '' : 'none';
  document.getElementById('payeeReassignTarget').disabled = checked;
  if (checked) setTimeout(() => document.getElementById('payeeReassignNewName').focus(), 100);
}

async function confirmPayeeReassign() {
  const fromId   = document.getElementById('payeeReassignDeleteId').value;
  const useNew   = document.getElementById('payeeReassignUseNew').checked;
  const targetId = document.getElementById('payeeReassignTarget').value;
  const newName  = document.getElementById('payeeReassignNewName').value.trim();

  const btn = document.getElementById('payeeReassignConfirmBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Transferindo...'; }

  try {
    let toId = targetId;

    if (useNew) {
      if (!newName) { toast('Informe o nome do novo beneficiário', 'error'); return; }
      const { data: created, error: createErr } = await sb.from('payees')
        .insert({ name: normalizePayeeName(newName), type: 'beneficiario', family_id: famId() })
        .select().single();
      if (createErr) throw new Error('Erro ao criar beneficiário: ' + createErr.message);
      toId = created.id;
    } else {
      if (!toId) { toast('Selecione o beneficiário destino', 'error'); return; }
    }

    // 1. Reatribuir transações
    const { error: e1 } = await sb.from('transactions')
      .update({ payee_id: toId })
      .eq('payee_id', fromId)
      .eq('family_id', famId());
    if (e1) throw new Error('Erro ao atualizar transações: ' + e1.message);

    // 2. Reatribuir transações programadas
    await sb.from('scheduled_transactions')
      .update({ payee_id: toId })
      .eq('payee_id', fromId)
      .eq('family_id', famId());

    // 3. Excluir
    await _doDeletePayee(fromId);
    closeModal('payeeReassignModal');
    toast('Beneficiário excluído e registros transferidos!', 'success');

  } catch(err) {
    toast(err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✅ Transferir e Excluir'; }
  }
}

async function _doDeletePayee(id) {
  const { error } = await sb.from('payees').delete().eq('id', id);
  if (error) { toast(error.message, 'error'); return; }
  toast('Beneficiário excluído', 'success');
  await loadPayees();
  await _loadPayeeTxCounts();
  renderPayees();
}

/* ─── Payee Clipboard Import ─── */
let _payeeClipboardItems = []; // { name, exists, selected }

function openPayeeClipboardImport() {
  _payeeClipboardItems = [];
  document.getElementById('payeeClipboardText').value = '';
  document.getElementById('payeeClipboardPreview').style.display = 'none';
  document.getElementById('payeeClipboardPreviewBody').innerHTML = '';
  document.getElementById('payeeClipboardCount').textContent = '';
  document.getElementById('payeeClipboardImportBtn').disabled = true;
  const sa = document.getElementById('payeeClipboardSelectAll');
  if (sa) sa.checked = true;
  openModal('payeeClipboardModal');
}

async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    document.getElementById('payeeClipboardText').value = text;
    parsePayeeClipboard();
  } catch(e) {
    toast('Não foi possível acessar a área de transferência. Cole manualmente no campo.', 'warning');
  }
}

function parsePayeeClipboard() {
  const raw = document.getElementById('payeeClipboardText').value;
  if (!raw.trim()) {
    document.getElementById('payeeClipboardPreview').style.display = 'none';
    document.getElementById('payeeClipboardCount').textContent = '';
    document.getElementById('payeeClipboardImportBtn').disabled = true;
    return;
  }

  // Split by newline, semicolon, comma (if whole line looks like a list), or tab
  let names = [];
  const lines = raw.split(/\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // If a line has tabs, split by tab (spreadsheet paste)
    if (trimmed.includes('\t')) {
      names.push(...trimmed.split('\t').map(s => s.trim()).filter(Boolean));
    }
    // If a line has semicolons, split by semicolons
    else if (trimmed.includes(';')) {
      names.push(...trimmed.split(';').map(s => s.trim()).filter(Boolean));
    }
    // If a line has commas but doesn't look like a sentence (few words), split by comma
    else if (trimmed.includes(',') && trimmed.split(',').every(p => p.trim().split(' ').length <= 5)) {
      names.push(...trimmed.split(',').map(s => s.trim()).filter(Boolean));
    }
    // Otherwise the whole line is one name
    else {
      names.push(trimmed);
    }
  }

  // Deduplicate within input
  const seen = new Set();
  names = names.filter(n => { const k = n.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });

  // Check which already exist in state.payees
  const existingNames = new Set((state.payees||[]).map(p => p.name.toLowerCase()));

  _payeeClipboardItems = names.map(name => {
    const normalized = normalizePayeeName(name);
    return {
      name: normalized,
      exists: existingNames.has(normalized.toLowerCase()),
      selected: !existingNames.has(normalized.toLowerCase()),
    };
  });

  renderPayeeClipboardPreview();
}

function renderPayeeClipboardPreview() {
  const items = _payeeClipboardItems;
  const preview = document.getElementById('payeeClipboardPreview');
  const body    = document.getElementById('payeeClipboardPreviewBody');
  const countEl = document.getElementById('payeeClipboardCount');
  const btn     = document.getElementById('payeeClipboardImportBtn');
  const sa      = document.getElementById('payeeClipboardSelectAll');

  if (!items.length) {
    preview.style.display = 'none';
    countEl.textContent = '';
    btn.disabled = true;
    return;
  }

  const newCount  = items.filter(i => !i.exists).length;
  const skipCount = items.filter(i => i.exists).length;
  const selCount  = items.filter(i => i.selected).length;
  countEl.textContent = `${items.length} nomes · ${newCount} novos · ${skipCount} já existem`;

  body.innerHTML = items.map((item, idx) => `
    <tr style="border-bottom:1px solid var(--border);${item.exists?'opacity:.55':''}">
      <td style="padding:6px 12px;color:var(--text)">${esc(item.name)}</td>
      <td style="padding:6px 8px;text-align:center">
        ${item.exists
          ? '<span style="font-size:.72rem;font-weight:600;color:var(--muted);background:var(--bg3);padding:2px 7px;border-radius:20px">Existente</span>'
          : '<span style="font-size:.72rem;font-weight:600;color:var(--green);background:var(--green-lt);padding:2px 7px;border-radius:20px">Novo</span>'
        }
      </td>
      <td style="padding:6px 8px;text-align:center">
        <input type="checkbox" ${item.selected?'checked':''} onchange="payeeClipboardToggleItem(${idx},this.checked)">
      </td>
    </tr>`).join('');

  preview.style.display = '';
  btn.disabled = selCount === 0;
  btn.textContent = selCount > 0 ? `Importar ${selCount} →` : 'Importar →';
  if (sa) sa.checked = items.every(i => i.selected);
}

function payeeClipboardToggleItem(idx, checked) {
  _payeeClipboardItems[idx].selected = checked;
  renderPayeeClipboardPreview();
}

function payeeClipboardToggleAll(checked) {
  _payeeClipboardItems.forEach(i => i.selected = checked);
  renderPayeeClipboardPreview();
}

async function confirmPayeeClipboardImport() {
  const toImport = _payeeClipboardItems.filter(i => i.selected);
  if (!toImport.length) { toast('Nenhum item selecionado', 'warning'); return; }

  const btn = document.getElementById('payeeClipboardImportBtn');
  btn.disabled = true; btn.textContent = '⏳ Importando...';

  const type = document.getElementById('payeeClipboardType').value || 'beneficiario';

  try {
    const batch = toImport.map(i => ({ name: normalizePayeeName(i.name), type, family_id: famId() }));
    // Insert in batches of 100
    let created = 0, errors = 0;
    for (let i = 0; i < batch.length; i += 100) {
      const { error } = await sb.from('payees').insert(batch.slice(i, i + 100));
      if (error) {
        // Try one-by-one to skip individual conflicts
        for (const row of batch.slice(i, i + 100)) {
          const { error: e2 } = await sb.from('payees').insert(row);
          if (e2) errors++;
          else created++;
        }
      } else {
        created += batch.slice(i, i + 100).length;
      }
    }

    await loadPayees();
    populateSelects();
    renderPayees();
    closeModal('payeeClipboardModal');
    toast(`✓ ${created} beneficiário${created !== 1 ? 's' : ''} importado${created !== 1 ? 's' : ''}${errors ? ` · ${errors} erro(s)` : ''}`, errors ? 'warning' : 'success');
  } catch(e) {
    toast('Erro: ' + e.message, 'error');
    console.error(e);
  } finally {
    btn.disabled = false; btn.textContent = `Importar ${toImport.length} →`;
  }
}

/* ══════════════════════════════════════════════════════
   TRANSACTION CLIPBOARD IMPORT
   Format per line: date, amount, description, account, category, payee, memo
══════════════════════════════════════════════════════ */
let _txClipItems = []; // parsed rows ready for preview
