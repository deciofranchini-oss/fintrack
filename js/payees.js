async function loadPayees(){const{data,error}=await famQ(sb.from('payees').select('*, categories(name)')).order('name');if(error){toast(error.message,'error');return;}state.payees=data||[];}
function payeeTypeBadge(t){const m={beneficiario:'badge-blue',fonte_pagadora:'badge-green',ambos:'badge-amber'};const l={beneficiario:'Beneficiário',fonte_pagadora:'Fonte Pagadora',ambos:'Ambos'};return`<span class="badge ${m[t]||'badge-muted'}">${l[t]||t}</span>`;}

function payeeRow(p) {
  return `<tr>
    <td><strong>${esc(p.name)}</strong>${p.notes?`<div style="font-size:.72rem;color:var(--muted);margin-top:1px">${esc(p.notes)}</div>`:''}</td>
    <td class="text-muted" style="font-size:.82rem">${p.categories?.name||'—'}</td>
    <td><div style="display:flex;gap:5px"><button class="btn-icon" onclick="openPayeeModal('${p.id}')">✏️</button><button class="btn-icon" onclick="deletePayee('${p.id}')">🗑️</button></div></td>
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
            <thead><tr><th>Nome</th><th>Categoria Padrão</th><th style="width:70px"></th></tr></thead>
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
  document.getElementById('payeeId').value=form.id;document.getElementById('payeeName').value=form.name;document.getElementById('payeeType').value=form.type;document.getElementById('payeeNotes').value=form.notes||'';
  const sel=document.getElementById('payeeCategory');sel.innerHTML='<option value="">— Nenhuma —</option>'+state.categories.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');sel.value=form.default_category_id||'';
  document.getElementById('payeeModalTitle').textContent=id?'Editar Beneficiário':'Novo Beneficiário';openModal('payeeModal');
}
async function savePayee(){
  const id=document.getElementById('payeeId').value;
  const data={name:document.getElementById('payeeName').value.trim(),type:document.getElementById('payeeType').value,default_category_id:document.getElementById('payeeCategory').value||null,notes:document.getElementById('payeeNotes').value};
  if(!data.name){toast('Informe o nome','error');return;}
  if(!id) data.family_id=famId(); let err;if(id){({error:err}=await sb.from('payees').update(data).eq('id',id));}else{({error:err}=await sb.from('payees').insert(data));}
  if(err){toast(err.message,'error');return;}toast('Salvo!','success');closeModal('payeeModal');await loadPayees();populateSelects();renderPayees();
}
async function deletePayee(id){if(!confirm('Excluir?'))return;const{error}=await sb.from('payees').delete().eq('id',id);if(error){toast(error.message,'error');return;}toast('Removido','success');await loadPayees();renderPayees();}

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

  _payeeClipboardItems = names.map(name => ({
    name,
    exists: existingNames.has(name.toLowerCase()),
    selected: !existingNames.has(name.toLowerCase()), // pre-select only new ones
  }));

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
    const batch = toImport.map(i => ({ name: i.name, type, family_id: famId() }));
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
