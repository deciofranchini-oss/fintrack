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
  DB.payees.bust(); await loadPayees(true);
  if(typeof populateSelects==='function') populateSelects();
  renderPayees();

  toast(
    fail === 0
      ? `✅ ${ok} nome${ok !== 1 ? 's' : ''} normalizado${ok !== 1 ? 's' : ''}!`
      : `✓ ${ok} OK · ⚠️ ${fail} erro${fail !== 1 ? 's' : ''}`,
    fail === 0 ? 'success' : 'warning'
  );
  window._normPayeeChanges = [];
}

async function loadPayees(force=false){
  try { await DB.payees.load(force); }
  catch(e) { toast(e.message,'error'); }
}

// ── Contagem de transações por payee ──────────────────────────────────────
let _payeeTxCounts = {};
window._resetPayeeTxCounts = () => { _payeeTxCounts = {}; };

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
  // Feature 4: badge clicável abre histórico
  const txBadge = txCount > 0
    ? `<span style="display:inline-flex;align-items:center;gap:3px;font-size:.72rem;font-weight:600;color:var(--accent);background:var(--accent-lt);border:1px solid var(--accent)30;border-radius:20px;padding:1px 7px;cursor:pointer" onclick="event.stopPropagation();openPayeeHistory('${p.id}','${esc(p.name)}')" title="Ver histórico">${txCount} tx 📋</span>`
    : `<span style="font-size:.72rem;color:var(--muted)">—</span>`;
  const locParts = [p.address, p.city, p.state_uf].filter(Boolean);
  const locLine  = locParts.length ? locParts.join(', ') : '';
  const contactChips = [
    locLine   ? `<span title="Endereço" style="font-size:.7rem;color:var(--muted)">📍 ${esc(locLine)}</span>` : '',
    p.phone   ? `<span title="Telefone" style="font-size:.7rem;color:var(--muted)">📞 ${esc(p.phone)}</span>` : '',
    p.whatsapp? `<span title="WhatsApp" style="font-size:.7rem;color:var(--muted)">💬 ${esc(p.whatsapp)}</span>` : '',
    p.website ? `<a href="${esc(p.website)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Site" style="font-size:.7rem;color:var(--accent)">🌐 ${esc(p.website.replace(/^https?:\/\//, ''))}</a>` : '',
    p.cnpj_cpf? `<span title="CNPJ/CPF" style="font-size:.7rem;color:var(--muted)">🪪 ${esc(p.cnpj_cpf)}</span>` : '',
  ].filter(Boolean);
  // Feature 4: linha clicável quando há transações
  const rowAttrs = txCount > 0
    ? `onclick="openPayeeHistory('${p.id}','${esc(p.name)}')" style="cursor:pointer"`
    : '';
  return `<tr class="payee-row py2-row" ${rowAttrs}>
    <td>
      <div class="py2-name-cell">
        <div class="py2-avatar" style="background:${avatarColor}18;border:1.5px solid ${avatarColor}35;color:${avatarColor}">${initials}</div>
        <div class="py2-name-body">
          <div class="py2-name">${esc(p.name)}</div>
          ${contactChips.length ? `<div class="py2-chips">${contactChips.join('')}</div>` : ''}
          ${p.notes ? `<div class="py2-notes">${esc(p.notes)}</div>` : ''}
        </div>
      </div>
    </td>
    <td>
      ${p.categories?.name
        ? `<span class="py2-cat-badge">${esc(p.categories.name)}</span>`
        : `<span class="py2-cat-none">—</span>`}
    </td>
    <td style="text-align:center">${txBadge}</td>
    <td>
      <div class="payee-row-actions" style="display:flex;gap:4px;justify-content:flex-end">
        <button class="py2-action-btn" onclick="event.stopPropagation();openPayeeModal('${p.id}')" title="Editar">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="py2-action-btn py2-action-del" onclick="event.stopPropagation();deletePayee('${p.id}')" title="Excluir">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>
    </td>
  </tr>`;
}

// Feature 4: modal com histórico de transações do beneficiário (últimos 6 meses)
async function openPayeeHistory(payeeId, payeeName) {
  const modal = document.getElementById('payeeHistoryModal');
  if (!modal) return;
  document.getElementById('payeeHistoryTitle').textContent = payeeName + ' — últimos 6 meses';
  document.getElementById('payeeHistoryTotal').textContent = '';
  document.getElementById('payeeHistoryBody').innerHTML =
    '<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--muted)">Carregando…</td></tr>';
  openModal('payeeHistoryModal');

  const since = new Date();
  since.setMonth(since.getMonth() - 6);
  const sinceStr = since.toISOString().slice(0,10);

  const { data, error } = await famQ(
    sb.from('transactions')
      .select('id,date,description,amount,currency,brl_amount,status,accounts!transactions_account_id_fkey(name,currency),categories(name,color)')
      .eq('payee_id', payeeId)
      .gte('date', sinceStr)
      .order('date', { ascending: false })
      .limit(200)
  );

  if (error) {
    document.getElementById('payeeHistoryBody').innerHTML =
      `<tr><td colspan="4" style="text-align:center;color:var(--red)">Erro: ${esc(error.message)}</td></tr>`;
    return;
  }
  if (!data || !data.length) {
    document.getElementById('payeeHistoryBody').innerHTML =
      '<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--muted)">Nenhuma transação nos últimos 6 meses</td></tr>';
    return;
  }

  const total = data.reduce((s,t) => s + (parseFloat(t.amount)||0), 0);
  document.getElementById('payeeHistoryTotal').textContent =
    data.length + ' transações · Total: ' + fmt(total);

  document.getElementById('payeeHistoryBody').innerHTML = data.map(t => {
    const cur = t.currency || t.accounts?.currency || 'BRL';
    const amtClass = (parseFloat(t.amount)||0) >= 0 ? 'amount-pos' : 'amount-neg';
    const catBadge = t.categories
      ? `<span class="badge" style="background:${t.categories.color}18;color:${t.categories.color};border:1px solid ${t.categories.color}28;font-size:.65rem">${esc(t.categories.name)}</span>`
      : '';
    const pendDot = t.status==='pending'
      ? '<span title="Pendente" style="color:var(--amber);font-size:.75rem"> ⏳</span>' : '';
    return `<tr style="cursor:pointer" onclick="closeModal('payeeHistoryModal');editTransaction('${t.id}')">
      <td style="white-space:nowrap;font-size:.8rem;color:var(--muted)">${fmtDate(t.date)}</td>
      <td>
        <div style="font-size:.85rem;font-weight:500">${esc(t.description||'')}${pendDot}</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:2px">${catBadge}</div>
        <div style="font-size:.7rem;color:var(--muted)">${esc(t.accounts?.name||'')}</div>
      </td>
      <td class="${amtClass}" style="white-space:nowrap;font-weight:600;text-align:right">
        ${(parseFloat(t.amount)||0)>=0?'+':''}${fmt(t.amount,cur)}
        ${cur!=='BRL'&&t.brl_amount?`<div style="font-size:.68rem;color:var(--muted)">${fmt(t.brl_amount,'BRL')}</div>`:''}
      </td>
      <td style="text-align:center;font-size:.75rem;color:var(--muted)">${esc(t.accounts?.name||'')}</td>
    </tr>`;
  }).join('');
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

function py2SetTypeFilter(btn, type) {
  // Update hidden select
  const sel = document.getElementById('payeeTypeFilter');
  if (sel) sel.value = type;
  // Update pill active state
  document.querySelectorAll('.py2-type-pill').forEach(b => b.classList.toggle('active', b === btn));
  filterPayees();
}
async function openPayeeModal(id=''){
  // Reset logo state
  window._payeeLogoPending = null;
  const logoPreview = document.getElementById('payeeLogoPreview');
  const logoFile    = document.getElementById('payeeLogoFile');
  const logoRemove  = document.getElementById('payeeLogoRemoveBtn');
  const logoUrl     = document.getElementById('payeeLogoUrl');
  const logoFlag    = document.getElementById('payeeLogoRemoveFlag');
  const aiPanel     = document.getElementById('payeeAiSuggestPanel');
  if (logoPreview) logoPreview.innerHTML = '🏢';
  if (logoFile)    { try { logoFile.value = ''; } catch(_) {} }
  if (logoRemove)  logoRemove.style.display = 'none';
  if (logoUrl)     logoUrl.value = '';
  if (logoFlag)    logoFlag.value = '';
  if (aiPanel)     aiPanel.style.display = 'none';
  const form={id:'',name:'',type:'beneficiario',default_category_id:'',notes:''};
  if(id){const p=state.payees.find(x=>x.id===id);if(p)Object.assign(form,p);}

  // Ensure categories are loaded before building the picker
  if (!state.categories || !state.categories.length) {
    try { await DB.categories.load(); } catch(_) {}
  }

  document.getElementById('payeeId').value    = form.id;
  document.getElementById('payeeName').value  = form.name;
  document.getElementById('payeeType').value  = form.type;
  document.getElementById('payeeNotes').value = form.notes || '';
  // Restore logo / icon if editing existing payee
  const _logoPreview = document.getElementById('payeeLogoPreview');
  const _logoRemove  = document.getElementById('payeeLogoRemoveBtn');
  const _logoUrl     = document.getElementById('payeeLogoUrl');
  if (form.avatar_url && _logoPreview) {
    _logoPreview.innerHTML = form.avatar_url.startsWith('emoji:')
      ? `<span style="font-size:2rem">${form.avatar_url.slice(6)}</span>`
      : `<img src="${form.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:9px">`;
    if (_logoRemove) _logoRemove.style.display = '';
    if (_logoUrl)    _logoUrl.value = form.avatar_url;
  }
  document.getElementById('payeeModalTitle').textContent = id ? 'Editar Beneficiário' : 'Novo Beneficiário';
  // Campos de contato/localização
  document.getElementById('payeeAddress').value  = form.address  || '';
  document.getElementById('payeeCity').value     = form.city     || '';
  document.getElementById('payeeStateUf').value  = form.state_uf || '';
  document.getElementById('payeeZip').value      = form.zip_code || '';
  document.getElementById('payeePhone').value    = form.phone    || '';
  document.getElementById('payeeWhatsapp').value = form.whatsapp || '';
  document.getElementById('payeeWebsite').value  = form.website  || '';
  document.getElementById('payeeCnpj').value     = form.cnpj_cpf || '';
  _buildPayeeCatPicker(form.type, form.default_category_id || '');
  // Rebuild picker when type changes
  const typeEl = document.getElementById('payeeType');
  typeEl.onchange = () => _buildPayeeCatPicker(typeEl.value, '');
  openModal('payeeModal');
}

/** Constrói o dropdown hierárquico de categorias filtrado por tipo de beneficiário */
function _normalizePayeeCatType(raw) {
  const v = String(raw || '').toLowerCase().trim();
  if (!v) return '';
  if (['expense', 'despesa', 'gasto'].includes(v)) return 'expense';
  if (['income', 'receita', 'entrada'].includes(v)) return 'income';
  if (['both', 'ambos', 'ambas', 'all', 'todos'].includes(v)) return 'both';
  return v;
}

function _payeeTypeToCatGroup(payeeType) {
  if (payeeType === 'beneficiario') return 'expense';
  if (payeeType === 'fonte_pagadora') return 'income';
  return null; // 'ambos' → mostra tudo
}

function _buildPayeeCatPicker(payeeType, selectedId) {
  const typeFilter = _payeeTypeToCatGroup(payeeType);
  const cats = Array.isArray(state.categories) ? state.categories : [];
  const dropdown = document.getElementById('payeeCatPickerDropdown');
  if (!dropdown) return;

  const parents = cats
    .filter(c => !c.parent_id)
    .filter(c => {
      const catType = _normalizePayeeCatType(c.type);
      return typeFilter === null || catType === typeFilter || catType === 'both';
    })
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'));

  let html = `<div onclick="setPayeeCatValue('', true)"
    style="padding:9px 12px;cursor:pointer;font-size:.82rem;color:var(--muted);
           border-bottom:1px solid var(--border2)"
    onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background=''">
    — Nenhuma —</div>`;

  if (!parents.length) {
    html += `<div style="padding:12px;font-size:.8rem;color:var(--muted)">Nenhuma categoria disponível.</div>`;
    dropdown.innerHTML = html;
    setPayeeCatValue(selectedId, false);
    return;
  }

  const groupDefs = typeFilter === null
    ? [['expense', '💸 Despesas'], ['income', '💰 Receitas']]
    : [[typeFilter, typeFilter === 'expense' ? '💸 Despesas' : '💰 Receitas']];

  groupDefs.forEach(([groupType, label]) => {
    const group = parents.filter(p => {
      const catType = _normalizePayeeCatType(p.type);
      return catType === groupType || catType === 'both';
    });
    if (!group.length) return;
    if (typeFilter === null) {
      html += `<div style="padding:5px 10px;font-size:.7rem;font-weight:700;
                           text-transform:uppercase;letter-spacing:.06em;
                           color:var(--muted);background:var(--surface2)">${label}</div>`;
    }
    group.forEach(parent => {
      const children = cats
        .filter(c => c.parent_id === parent.id)
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'));
      html += _payeeCatParentHtml(parent, children);
    });
  });

  dropdown.innerHTML = html;
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
      ${cdot}<span>${esc(parent.name)} <span style="color:var(--muted)">→</span> ${esc(c.name)}</span></div>`;
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
      const parent = cat.parent_id ? (state.categories || []).find(c => c.id === cat.parent_id) : null;
      if (label) label.textContent = parent ? `${parent.name} → ${cat.name}` : cat.name;
      if (dot)   dot.style.background = cat.color || parent?.color || 'var(--accent)';
    }
  }
  if (closeDropdown && dd) dd.style.display = 'none';
}
// ── Payee logo/icon upload + AI suggest ──────────────────────────────────
window.payeePreviewLogo = function(input) {
  const file = input?.files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { toast('Imagem muito grande (máx 2MB)', 'error'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    const preview = document.getElementById('payeeLogoPreview');
    const removeBtn = document.getElementById('payeeLogoRemoveBtn');
    if (preview) {
      preview.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:9px">`;
    }
    if (removeBtn) removeBtn.style.display = '';
    window._payeeLogoPending = { dataUrl: e.target.result, file };
  };
  reader.readAsDataURL(file);
};

window.payeeRemoveLogo = function() {
  const preview = document.getElementById('payeeLogoPreview');
  const removeBtn = document.getElementById('payeeLogoRemoveBtn');
  const urlInput  = document.getElementById('payeeLogoUrl');
  const flagInput = document.getElementById('payeeLogoRemoveFlag');
  if (preview) preview.innerHTML = '🏢';
  if (removeBtn) removeBtn.style.display = 'none';
  if (urlInput)  urlInput.value  = '';
  if (flagInput) flagInput.value = '1';
  window._payeeLogoPending = null;
};

window.payeeAiSuggestLogo = async function() {
  const name = document.getElementById('payeeName')?.value?.trim();
  if (!name) { toast('Informe o nome do beneficiário primeiro', 'warning'); return; }
  const payeeType = document.getElementById('payeeType')?.value?.trim() || '';
  const website = document.getElementById('payeeWebsite')?.value?.trim() || '';
  const city = document.getElementById('payeeCity')?.value?.trim() || '';
  const stateUf = document.getElementById('payeeStateUf')?.value?.trim() || '';
  const notes = document.getElementById('payeeNotes')?.value?.trim() || '';
  const cnpjCpf = document.getElementById('payeeCnpj')?.value?.trim() || '';
  const panel   = document.getElementById('payeeAiSuggestPanel');
  const content = document.getElementById('payeeAiSuggestContent');
  if (!panel || !content) return;
  panel.style.display = '';
  content.style.display = 'flex';
  content.style.gap = '8px';
  content.style.flexWrap = 'wrap';
  content.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:.8rem;padding:12px;width:100%">⏳ Buscando sugestões…</div>';

  try {
    const apiKey = await getAppSetting('gemini_api_key', '');
    if (!apiKey) { content.innerHTML = '<div style="color:var(--red,#dc2626);font-size:.78rem;padding:8px">Configure a chave Gemini em Configurações → IA</div>'; return; }

    const domain = (() => {
      if (!website) return '';
      try {
        const normalized = /^https?:\/\//i.test(website) ? website : `https://${website}`;
        return new URL(normalized).hostname.replace(/^www\./i, '');
      } catch (_) {
        return website.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].trim();
      }
    })();

    const context = [
      `Nome da empresa/beneficiário: ${name}`,
      payeeType ? `Tipo cadastrado: ${payeeType}` : '',
      website ? `Website informado: ${website}` : '',
      domain ? `Domínio provável da empresa: ${domain}` : '',
      city || stateUf ? `Localização: ${[city, stateUf].filter(Boolean).join(' - ')}` : '',
      cnpjCpf ? `Documento informado: ${cnpjCpf}` : '',
      notes ? `Notas/contexto: ${notes}` : ''
    ].filter(Boolean).join('\n');

    const prompt = [
      'Você é um assistente de branding minimalista para um app financeiro.',
      'Com base no contexto abaixo, sugira 3 ícones/emoji para representar visualmente o beneficiário.',
      'Use o NOME DA EMPRESA/BENEFICIÁRIO como principal pista para reconhecer a marca.',
      'Se o nome parecer corresponder a uma empresa conhecida, tente inferir elementos do logotipo, símbolo, cor ou forma mais reconhecível da marca e converta isso em um ícone simples para avatar.',
      'Não copie logotipos oficiais nem descreva marcas registradas em detalhe. Faça apenas uma interpretação visual segura e genérica.',
      'Priorize sugestões que remetam à empresa específica antes de recorrer a ícones genéricos do setor.',
      'Responda APENAS com JSON válido no formato: {"suggestions":[{"emoji":"🛒","label":"Supermercado","reason":"...","brand_hint":"..."},{"emoji":"...","label":"...","reason":"...","brand_hint":"..."},{"emoji":"...","label":"...","reason":"...","brand_hint":"..."}]}',
      '',
      context
    ].join('\n');

    const models = ['gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-1.5-flash'];
    let lastErr = null;
    let parsed = null;

    for (const model of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const resp = await fetch(url, {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({
            contents:[{parts:[{text:prompt}]}],
            generationConfig:{maxOutputTokens:500,temperature:0.35,responseMimeType:'application/json'}
          })
        });
        if (!resp.ok) {
          const errText = await resp.text().catch(()=>'');
          throw new Error(`HTTP ${resp.status}${errText ? ' - ' + errText : ''}`);
        }
        const data = await resp.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const clean = text.replace(/```json|```/g,'').trim();
        parsed = JSON.parse(clean);
        if (parsed?.suggestions?.length) break;
        throw new Error('Sem sugestões');
      } catch (err) {
        lastErr = err;
      }
    }

    const sugs = parsed?.suggestions || [];
    if (!sugs.length) throw (lastErr || new Error('Sem sugestões'));

    content.innerHTML = sugs.map(s => {
      const title = esc(s.label || 'Sugestão');
      const reason = esc(s.reason || '');
      const hint = esc(s.brand_hint || '');
      const details = [reason, hint].filter(Boolean).join(' · ');
      const emoji = String(s.emoji || '🏢').replace(/'/g, '&#39;');
      return `
      <div onclick="payeeSelectAiLogo('${emoji}')"
        style="flex:1;min-width:88px;text-align:center;padding:10px 8px;border:1.5px solid var(--border);
               border-radius:10px;cursor:pointer;transition:all .15s;background:var(--surface)"
        onmouseover="this.style.borderColor='var(--accent)';this.style.background='var(--accent-lt)'"
        onmouseout="this.style.borderColor='var(--border)';this.style.background='var(--surface)'">
        <div style="font-size:2rem;line-height:1;margin-bottom:4px">${esc(s.emoji || '🏢')}</div>
        <div style="font-size:.7rem;font-weight:700;color:var(--text);margin-bottom:2px">${title}</div>
        <div style="font-size:.65rem;color:var(--muted);line-height:1.3">${details}</div>
      </div>`;
    }).join('');
  } catch(e) {
    content.innerHTML = `<div style="color:var(--red,#dc2626);font-size:.78rem;padding:8px">Erro: ${esc(e.message)}</div>`;
  }
};

window.payeeSelectAiLogo = function(emoji) {
  const preview = document.getElementById('payeeLogoPreview');
  const urlInput = document.getElementById('payeeLogoUrl');
  if (preview) preview.innerHTML = `<span style="font-size:2rem">${emoji}</span>`;
  if (urlInput) urlInput.value = 'emoji:' + emoji;
  window._payeeLogoPending = { emoji };
  document.getElementById('payeeAiSuggestPanel').style.display = 'none';
  toast('Ícone selecionado!', 'success');
};

async function savePayee() {
  const id = document.getElementById('payeeId').value;
  const data = {
    name:                normalizePayeeName(document.getElementById('payeeName').value),
    type:                document.getElementById('payeeType').value,
    default_category_id: document.getElementById('payeeCategory').value || null,
    notes:               document.getElementById('payeeNotes').value,
    address:             document.getElementById('payeeAddress').value.trim()  || null,
    city:                document.getElementById('payeeCity').value.trim()     || null,
    state_uf:            document.getElementById('payeeStateUf').value.trim()  || null,
    zip_code:            document.getElementById('payeeZip').value.trim()      || null,
    phone:               document.getElementById('payeePhone').value.trim()    || null,
    whatsapp:            document.getElementById('payeeWhatsapp').value.trim() || null,
    website:             document.getElementById('payeeWebsite').value.trim()  || null,
    cnpj_cpf:            document.getElementById('payeeCnpj').value.trim()     || null,
  };
  if (!data.name) { toast(t('toast.err_name'), 'error'); return; }

  // ── Logo / icon ───────────────────────────────────────────────────────
  const _pending    = window._payeeLogoPending;
  const _logoUrl    = document.getElementById('payeeLogoUrl')?.value || '';
  const _removeFlag = document.getElementById('payeeLogoRemoveFlag')?.value;

  if (_removeFlag === '1') {
    data.avatar_url = null;
  } else if (_pending?.emoji) {
    data.avatar_url = 'emoji:' + _pending.emoji;
  } else if (_pending?.file) {
    try {
      const fid  = famId();
      const ext  = (_pending.file.name.split('.').pop() || 'png').toLowerCase();
      const path = `payees/${fid}/${Date.now()}.${ext}`;
      const { error: upErr } = await sb.storage
        .from('fintrack-attachments')
        .upload(path, _pending.file, { upsert: true, contentType: _pending.file.type });
      if (!upErr) {
        const { data: urlData } = sb.storage.from('fintrack-attachments').getPublicUrl(path);
        if (urlData?.publicUrl) data.avatar_url = urlData.publicUrl;
      }
    } catch(_) {}
  } else if (_logoUrl) {
    data.avatar_url = _logoUrl;
  }
  window._payeeLogoPending = null;
  // ─────────────────────────────────────────────────────────────────────

  if (!id) data.family_id = famId();
  let err;
  if (id) { ({ error: err } = await sb.from('payees').update(data).eq('id', id)); }
  else    { ({ error: err } = await sb.from('payees').insert(data)); }
  if (err) { toast(err.message, 'error'); return; }

  const _pyNew = !id;
  toast('Salvo!', 'success');
  closeModal('payeeModal');
  DB.payees.bust();
  await loadPayees(true);
  if (typeof populateSelects === 'function') populateSelects();
  if (_pyNew) _scrollTopAndHighlight('.payee-card:first-child,.payee-row:first-child');
  renderPayees();
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
  toast(t('payee.deleted'), 'success');
  DB.payees.bust(); await loadPayees(true);
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

    DB.payees.bust(); await loadPayees(true);
    if(typeof populateSelects==='function') populateSelects();
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



// ── Google Maps / Places lookup ──────────────────────────────────────────────
async function searchPayeeOnMaps() {
  const query    = (document.getElementById('payeeMapsQuery')?.value || '').trim();
  const nameVal  = (document.getElementById('payeeName')?.value || '').trim();
  const searchQ  = query || nameVal;
  if (!searchQ) { toast('Digite um nome ou endereço para buscar.', 'warning'); return; }

  const btn = document.getElementById('payeeMapsBtn');
  const res = document.getElementById('payeeMapsResults');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Buscando…'; }
  if (res) { res.style.display = 'none'; res.innerHTML = ''; }

  try {
    // Use Google Places Text Search via Supabase Edge Function proxy (avoids CORS + key exposure)
    // Fallback: use nominatim (OpenStreetMap) which is free and CORS-friendly
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQ)}&format=json&addressdetails=1&limit=5&accept-language=pt-BR`;
    const resp = await fetch(nominatimUrl, {
      headers: { 'Accept-Language': 'pt-BR,pt;q=0.9', 'User-Agent': 'FamilyFinTrack/1.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) throw new Error('Erro na busca: ' + resp.status);
    const data = await resp.json();

    if (!data.length) {
      if (res) {
        res.style.display = '';
        res.innerHTML = `<div style="padding:12px 14px;font-size:.82rem;color:var(--muted);text-align:center">
          Nenhum resultado encontrado. Tente um termo mais específico.
        </div>`;
      }
      return;
    }

    if (res) {
      res.style.display = '';
      res.innerHTML = data.map((place, i) => {
        const addr = place.address || {};
        const displayName = place.display_name || '';
        const road     = addr.road || addr.pedestrian || addr.street || '';
        const houseNum = addr.house_number || '';
        const city     = addr.city || addr.town || addr.municipality || addr.county || '';
        const state    = addr.state || '';
        const stateAbbr = _nominatimStateAbbr(state);
        const postcode = addr.postcode || '';
        const phone    = '';
        const website  = '';

        const fullAddr = [road, houseNum].filter(Boolean).join(', ');
        const shortName = displayName.split(',')[0];

        return `<div onclick="_applyMapsResult(${i})"
          data-idx="${i}"
          style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);
                 transition:background .12s"
          onmouseover="this.style.background='var(--surface2)'"
          onmouseout="this.style.background=''"
          data-name="${esc(shortName)}"
          data-address="${esc(fullAddr)}"
          data-city="${esc(city)}"
          data-state="${esc(stateAbbr)}"
          data-zip="${esc(postcode.replace('-',''))}"
          data-phone="${esc(phone)}"
          data-website="${esc(website)}">
          <div style="font-weight:600;font-size:.84rem;color:var(--text)">${esc(shortName)}</div>
          <div style="font-size:.74rem;color:var(--muted);margin-top:2px">${esc(displayName.split(',').slice(1,4).join(',').trim())}</div>
        </div>`;
      }).join('');
      window._payeeMapsData = data;
    }
  } catch(e) {
    toast('Erro ao buscar: ' + (e.message || 'Verifique a conexão'), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🗺️ Buscar'; }
  }
}

function _nominatimStateAbbr(stateName) {
  const map = {
    'Acre':'AC','Alagoas':'AL','Amapá':'AP','Amazonas':'AM','Bahia':'BA',
    'Ceará':'CE','Distrito Federal':'DF','Espírito Santo':'ES','Goiás':'GO',
    'Maranhão':'MA','Mato Grosso':'MT','Mato Grosso do Sul':'MS','Minas Gerais':'MG',
    'Pará':'PA','Paraíba':'PB','Paraná':'PR','Pernambuco':'PE','Piauí':'PI',
    'Rio de Janeiro':'RJ','Rio Grande do Norte':'RN','Rio Grande do Sul':'RS',
    'Rondônia':'RO','Roraima':'RR','Santa Catarina':'SC','São Paulo':'SP',
    'Sergipe':'SE','Tocantins':'TO',
  };
  return map[stateName] || (stateName ? stateName.slice(0,2).toUpperCase() : '');
}

function _applyMapsResult(idx) {
  const res = document.getElementById('payeeMapsResults');
  const row = res?.querySelector(`[data-idx="${idx}"]`);
  if (!row) return;

  const name    = row.dataset.name    || '';
  const address = row.dataset.address || '';
  const city    = row.dataset.city    || '';
  const state   = row.dataset.state   || '';
  const zip     = row.dataset.zip     || '';
  const phone   = row.dataset.phone   || '';
  const website = row.dataset.website || '';

  // Fill form fields
  if (name && !document.getElementById('payeeName')?.value)
    document.getElementById('payeeName').value = name;
  if (address)  document.getElementById('payeeAddress').value  = address;
  if (city)     document.getElementById('payeeCity').value     = city;
  if (state)    document.getElementById('payeeStateUf').value  = state.slice(0,2).toUpperCase();
  if (zip)      document.getElementById('payeeZip').value      = zip;
  if (phone)    document.getElementById('payeePhone').value    = phone;
  if (website)  document.getElementById('payeeWebsite').value  = website;

  // Hide results
  if (res) res.style.display = 'none';
  toast('✅ Dados preenchidos com informações do Maps.', 'success');
}

// Allow pressing Enter in maps query field
document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.id === 'payeeMapsQuery') {
      e.preventDefault();
      searchPayeeOnMaps();
    }
  });
});

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
