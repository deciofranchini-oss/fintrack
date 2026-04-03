/* ═══════════════════════════════════════
   RESIZABLE TABLE COLUMNS (desktop ≥768px)
   Strategy: inject <colgroup><col> elements so widths survive
   thead/tbody re-renders. Persist per table.id in localStorage.
═══════════════════════════════════════ */

const _COL_W_PREFIX = 'col_w_';

function _saveColWidths(table) {
  if (!table?.id) return;
  try {
    const cols = table.querySelectorAll('colgroup col');
    if (!cols.length) return;
    const widths = [...cols].map(c => c.style.width || '');
    localStorage.setItem(_COL_W_PREFIX + table.id, JSON.stringify(widths));
  } catch(_) {}
}

function _restoreColWidths(table) {
  if (!table?.id) return;
  try {
    const raw = localStorage.getItem(_COL_W_PREFIX + table.id);
    if (!raw) return;
    const widths = JSON.parse(raw);
    const cols   = table.querySelectorAll('colgroup col');
    cols.forEach((col, i) => { if (widths[i]) col.style.width = widths[i]; });
  } catch(_) {}
}

function _ensureColgroup(table) {
  // Always keep colgroup in sync with current thead column count
  const ths = table.querySelectorAll('thead tr:first-child th');
  if (!ths.length) return null;
  let cg = table.querySelector('colgroup');
  if (!cg) {
    cg = document.createElement('colgroup');
    table.insertBefore(cg, table.firstChild);
  }
  // Add missing <col> elements
  while (cg.children.length < ths.length) {
    cg.appendChild(document.createElement('col'));
  }
  // Remove extras
  while (cg.children.length > ths.length) {
    cg.removeChild(cg.lastChild);
  }
  return cg;
}

function initResizableTable(table) {
  if (!table || window.innerWidth < 768) return;
  // Always (re-)sync colgroup and restore saved widths — even on re-init
  const cg = _ensureColgroup(table);
  if (!cg) return;
  _restoreColWidths(table);
  if (table.dataset.resizeInited) return; // handles already attached
  table.dataset.resizeInited = '1';
  table.style.tableLayout = 'fixed';

  const ths = table.querySelectorAll('thead tr:first-child th');
  ths.forEach((th, i) => {
    if (i === ths.length - 1) return; // skip last column (actions)
    const handle = document.createElement('div');
    handle.className = 'col-resize-handle';
    handle.title = 'Arrastar para redimensionar';
    th.appendChild(handle);

    let startX = 0, startW = 0;

    const onMove = e => {
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const nw = Math.max(36, startW + clientX - startX);
      const col = cg.children[i];
      if (col) col.style.width = nw + 'px';
    };

    const onUp = () => {
      handle.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      _saveColWidths(table);
    };

    handle.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      // Use the <col> width if already set, otherwise measure the th
      const col = cg.children[i];
      const colW = col?.style.width ? parseFloat(col.style.width) : 0;
      startX = e.clientX;
      startW = colW || th.offsetWidth;
      handle.classList.add('dragging');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}

// Re-sync colgroup + restore widths whenever a resizable table's content changes
function refreshResizableTable(tableOrId) {
  const table = typeof tableOrId === 'string'
    ? document.getElementById(tableOrId)
    : tableOrId;
  if (!table) return;
  _ensureColgroup(table);
  _restoreColWidths(table);
}

function initAllResizableTables() {
  if (window.innerWidth < 768) return;
  document.querySelectorAll('table.resizable-table').forEach(t => {
    // Always re-sync colgroup (thead may have been re-rendered)
    _ensureColgroup(t);
    _restoreColWidths(t);
    if (!t.dataset.resizeInited) initResizableTable(t);
  });
}

// Auto-init via MutationObserver
(function() {
  if (typeof MutationObserver === 'undefined') return;
  const obs = new MutationObserver(mutations => {
    let needsSync = false;
    mutations.forEach(m => {
      if (m.type === 'childList') needsSync = true;
    });
    if (needsSync) initAllResizableTables();
  });
  document.addEventListener('DOMContentLoaded', () => {
    obs.observe(document.body, { childList: true, subtree: true });
    initAllResizableTables();
  });
})();


/* ═══════════════════════════════════════
   FORECAST MULTI-ACCOUNT PICKER
   Shared by Relatórios/Forecast and Dashboard Forecast.
   State persisted in _dashSavePrefs under 'forecastAccounts' and 'dashForecastAccounts'.
═══════════════════════════════════════ */

// Map pickerId → { accountIds: Set, onChange: fn }
const _fcPickers = {};

function _fcPickerToggle(pickerId) {
  const dd = document.getElementById(pickerId.replace('Picker','Dropdown').replace('AcctPicker','AcctDropdown'));
  if (!dd) return;
  const isOpen = dd.classList.toggle('open');
  if (isOpen) {
    // Close on outside click
    setTimeout(() => {
      const handler = e => {
        const picker = document.getElementById(pickerId);
        if (picker && !picker.contains(e.target)) {
          dd.classList.remove('open');
          document.removeEventListener('click', handler);
        }
      };
      document.addEventListener('click', handler);
    }, 0);
  }
}

function _fcPickerBuild(pickerId, selectedIds, onChange) {
  const ddId = pickerId.replace('AcctPicker','AcctDropdown');
  const dd = document.getElementById(ddId);
  if (!dd) return;

  const selected = new Set(Array.isArray(selectedIds) ? selectedIds : []);
  _fcPickers[pickerId] = { selected, onChange };

  const accs = state.accounts || [];
  const favs = accs.filter(a => a.is_favorite);
  const rest = accs.filter(a => !a.is_favorite);

  let html = `<div class="fc-acct-opt">
    <input type="checkbox" id="${ddId}_all" ${selected.size===0?'checked':''}
      onchange="_fcPickerToggleAll('${pickerId}', this.checked)">
    <span style="font-weight:600;color:var(--text)">Todas as contas</span>
  </div>`;

  const renderGroup = (list, label) => {
    if (!list.length) return '';
    let g = label ? `<div class="fc-acct-sep">${label}</div>` : '';
    g += list.map(a => `
      <div class="fc-acct-opt">
        <input type="checkbox" id="${ddId}_${a.id}" value="${a.id}"
          ${selected.has(a.id)?'checked':''}
          onchange="_fcPickerToggleOne('${pickerId}','${a.id}',this.checked)">
        <span class="fc-acct-opt-dot" style="background:${a.color||'var(--accent)'}"></span>
        <span>${esc(a.name)} <span style="color:var(--muted);font-size:.75em">${a.currency}</span></span>
      </div>`).join('');
    return g;
  };

  html += renderGroup(favs, favs.length && rest.length ? '⭐ Favoritas' : '');
  html += renderGroup(rest, favs.length && rest.length ? 'Outras' : '');
  dd.innerHTML = html;
  _fcPickerUpdateLabel(pickerId);
}

function _fcPickerToggleAll(pickerId, checked) {
  const p = _fcPickers[pickerId];
  if (!p) return;
  if (checked) {
    p.selected.clear();
  } else {
    // Re-check "all" if user unchecks it (can't have nothing)
    const allChk = document.getElementById(pickerId.replace('AcctPicker','AcctDropdown') + '_all');
    if (allChk) allChk.checked = true;
    return;
  }
  // Uncheck all individual
  document.querySelectorAll(`#${pickerId.replace('AcctPicker','AcctDropdown')} input[value]`)
    .forEach(cb => { cb.checked = false; });
  _fcPickerUpdateLabel(pickerId);
  p.onChange?.([]);
}

function _fcPickerToggleOne(pickerId, accountId, checked) {
  const p = _fcPickers[pickerId];
  if (!p) return;
  if (checked) {
    p.selected.add(accountId);
  } else {
    p.selected.delete(accountId);
  }
  // Sync "all" checkbox
  const ddId = pickerId.replace('AcctPicker','AcctDropdown');
  const allChk = document.getElementById(ddId + '_all');
  if (allChk) allChk.checked = p.selected.size === 0;
  // If nothing selected, revert to "all"
  if (p.selected.size === 0 && allChk) allChk.checked = true;
  _fcPickerUpdateLabel(pickerId);
  p.onChange?.(p.selected.size ? [...p.selected] : []);
}

function _fcPickerGetSelected(pickerId) {
  return _fcPickers[pickerId] ? [...(_fcPickers[pickerId].selected)] : [];
}

function _fcPickerUpdateLabel(pickerId) {
  const p = _fcPickers[pickerId];
  if (!p) return;
  const labelId = pickerId.replace('AcctPicker','AcctLabel');
  const el = document.getElementById(labelId);
  if (!el) return;
  if (p.selected.size === 0) {
    el.textContent = pickerId.includes('dash') ? 'Todas' : 'Todas as contas';
    return;
  }
  const accs = state.accounts || [];
  const names = [...p.selected].map(id => accs.find(a=>a.id===id)?.name || id);
  if (names.length <= 2) {
    el.textContent = names.join(', ');
  } else {
    el.textContent = `${names.length} contas`;
  }
}


function _buildCategoryFilterOptions() {
  const cats = state.categories || [];
  const roots = cats.filter(c => !c.parent_id).sort((a,b) => a.name.localeCompare(b.name));
  const lines = [];
  const walk = (list, depth) => list.forEach(c => {
    const indent = '\u00a0\u00a0'.repeat(depth);
    lines.push(`<option value="${c.id}">${indent}${esc(c.name)}</option>`);
    const children = cats.filter(x => x.parent_id === c.id).sort((a,b) => a.name.localeCompare(b.name));
    if (children.length) walk(children, depth + 1);
  });
  walk(roots, 0);
  return lines.join('');
}

function _accountOptions(accounts, placeholder) {
  const list = Array.isArray(accounts) ? accounts : [];
  const favs = list.filter(a => a.is_favorite);
  const rest = list.filter(a => !a.is_favorite);
  const renderOpt = (a, isFav=false) => `<option value="${a.id}">${isFav ? '⭐ ' : ''}${esc(a.name)} (${a.currency})</option>`;

  let html = placeholder ? `<option value="">${placeholder}</option>` : '';

  if (favs.length) {
    html += favs.map(a => renderOpt(a, true)).join('');
    if (rest.length) {
      html += `<option value="" disabled>──────────</option>`;
      html += rest.map(a => renderOpt(a, false)).join('');
    }
  } else {
    html += rest.map(a => renderOpt(a, false)).join('');
  }

  return html;
}

// populateSelects is defined in reports.js (always loaded).
// _accountOptions and _buildCategoryFilterOptions are helpers used by it.

function openModal(id){document.getElementById(id).classList.add('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');}
document.querySelectorAll('.modal-overlay').forEach(el=>{el.addEventListener('click',e=>{if(e.target===el)el.classList.remove('open');});});

function toast(msg,type='info'){
  // Auto-translate if message exists as direct-text key in i18n builtin
  if (typeof t === 'function' && msg && typeof msg === 'string') {
    const translated = t(msg);
    // t() returns the key itself when not found — only use if actually translated
    if (translated && translated !== msg) msg = translated;
  }
  const icons={success:'✓',error:'✕',info:'i'};
  const el=document.createElement('div');el.className=`toast ${type}`;el.innerHTML=`<span style="font-weight:700">${icons[type]||'i'}</span><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(()=>{el.style.opacity='0';el.style.transform='translateX(16px)';el.style.transition='.2s';setTimeout(()=>el.remove(),200);},3200);
}

function fmt(v,currency='BRL'){if(state.privacyMode)return'••••••';return new Intl.NumberFormat('pt-BR',{style:'currency',currency:currency||'BRL',minimumFractionDigits:2}).format(v||0);}
// Parse a user-typed amount string: handles both "1.234,56" (BR) and "1,234.56" (EN) and negatives
function parseAmtInput(s) {
  if (!s && s !== 0) return 0;
  const str = String(s).trim();
  if (!str) return 0;
  const neg = str.startsWith('-');
  let clean = str.replace(/^-/, '');
  // Detect BR format: ends with ,XX (comma as decimal separator)
  if (/,\d{1,2}$/.test(clean)) {
    clean = clean.replace(/\./g, '').replace(',', '.');
  } else {
    // EN format or plain integer: remove commas
    clean = clean.replace(/,/g, '');
  }
  const v = parseFloat(clean);
  if (isNaN(v)) return 0;
  return neg ? -Math.abs(v) : v;
}

// Sign toggle button state: fieldId → true means negative
const _amtSignState = {};

function toggleAmtSign(fieldId) {
  _amtSignState[fieldId] = !_amtSignState[fieldId];
  _updateSignBtn(fieldId);
}

function _updateSignBtn(fieldId) {
  const btn = document.getElementById(fieldId + 'SignBtn');
  if (!btn) return;
  const isNeg = !!_amtSignState[fieldId];
  btn.textContent = isNeg ? '−' : '+';
  btn.classList.toggle('negative', isNeg);
  btn.classList.toggle('positive', !isNeg);
}

// Set amount field value and sign btn state from a numeric value (e.g. when editing)
function setAmtField(fieldId, value) {
  const isNeg = (value < 0);
  _amtSignState[fieldId] = isNeg;
  const el = document.getElementById(fieldId);
  if (el) {
    const abs = Math.abs(value);
    if (abs === 0) {
      el.value = '';
      el.dataset.cents = '0';
    } else {
      // Store raw cents so _amtFieldInput centavos-mode works after focus
      const centsInt = Math.round(abs * 100);
      el.dataset.cents = String(centsInt);
      el.value = abs.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
  }
  _updateSignBtn(fieldId);
}

// Read the signed value from an amount field
function getAmtField(fieldId) {
  const el = document.getElementById(fieldId);
  if (!el) return 0;
  const raw = el.value.trim();
  if (!raw) return 0;
  // Parse the absolute value
  let clean = raw.replace(/\./g, '').replace(',', '.'); // handle BR format
  if (!/[.,]/.test(raw)) clean = raw; // plain integer
  const abs = Math.abs(parseFloat(clean) || 0);
  return _amtSignState[fieldId] ? -abs : abs;
}

/**
 * onblur: formata o valor digitado como moeda BR (ex: 10500 → 10.500,00)
 * Chamado via onblur nos campos de valor dos modais de programados.
 */
function _amtFieldBlur(fieldId) {
  const el = document.getElementById(fieldId);
  if (!el) return;
  const raw = el.value.trim();
  if (!raw) return;
  // Parse lenientemente: aceita 10500 / 10500,00 / 10.500,00 / 10500.00
  let clean = raw.replace(/\./g, '').replace(',', '.');
  if (!/[.,]/.test(raw)) clean = raw;
  const num = Math.abs(parseFloat(clean) || 0);
  if (num === 0) { el.value = ''; return; }
  // Formatar com separador de milhar BR e 2 casas decimais
  el.value = num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * onfocus: seleciona tudo e limpa os dígitos acumulados do campo
 * para reiniciar o modo centavos do zero.
 */
function _amtFieldFocus(fieldId) {
  const el = document.getElementById(fieldId);
  if (!el) return;
  // Reseta o acumulador de dígitos para o valor atual (sem formatação)
  // Ex: "1.500,00" → acumulador = "150000"
  const raw  = el.value.replace(/\./g, '').replace(',', '');
  const num  = parseInt(raw.replace(/[^\d]/g, '') || '0', 10);
  el.dataset.cents = String(num);
  // Seleciona tudo para que o próximo dígito reinicie do zero via oninput
  setTimeout(function() { try { el.select(); } catch(e) {} }, 0);
}

/**
 * oninput: modo centavos puro.
 * Cada dígito digitado entra pela direita (centavos).
 * Backspace remove o dígito mais à direita.
 * Vírgula e ponto são ignorados (não mudam o valor).
 *
 *   digita 1 → "0,01"
 *   digita 5 → "0,15"
 *   digita 0 → "1,50"
 *   digita 0 → "15,00"
 *   digita 0 → "150,00"
 *   digita 0 → "1.500,00"
 *   digita 5 → "15.000,05"
 */
// Keydown handler: intercepts Backspace and digit keys BEFORE browser modifies field
// This is the authoritative path for physical keyboards and desktop browsers.
function _amtFieldKeydown(fieldId, e) {
  const el = document.getElementById(fieldId);
  if (!el) return;

  // Backspace: drop last digit from accumulator
  if (e.key === 'Backspace' || e.keyCode === 8) {
    e.preventDefault();
    const cents = Math.floor(parseInt(el.dataset.cents || '0', 10) / 10);
    el.dataset.cents = String(cents);
    _amtRender(el, cents);
    return;
  }

  // Delete: clear field
  if (e.key === 'Delete' || e.keyCode === 46) {
    e.preventDefault();
    el.dataset.cents = '0';
    el.value = '';
    return;
  }

  // Allow: Tab, arrows, Ctrl/Cmd combos
  if (e.key.length > 1 || e.ctrlKey || e.metaKey) return;

  // Allow only digit characters
  if (!/[0-9]/.test(e.key)) { e.preventDefault(); return; }

  e.preventDefault();
  const digit = parseInt(e.key, 10);
  const prev  = el.dataset.cents || '0';
  const next  = prev + String(digit);
  const cents = parseInt(next.slice(-13), 10);
  el.dataset.cents = String(cents);
  _amtRender(el, cents);
}

// Render centavos value into the field
function _amtRender(el, cents) {
  if (!cents) { el.value = ''; return; }
  const reais     = Math.floor(cents / 100);
  const centsOnly = cents % 100;
  el.value = reais.toLocaleString('pt-BR') + ',' + String(centsOnly).padStart(2, '0');
  try { el.setSelectionRange(el.value.length, el.value.length); } catch(_) {}
}

// oninput: fallback for paste, autofill and mobile virtual keyboards
// (keydown may not fire reliably on all mobile soft keyboards)
function _amtFieldInput(fieldId) {
  const el = document.getElementById(fieldId);
  if (!el) return;

  const rawDigits = el.value.replace(/[^0-9]/g, '');
  if (!rawDigits) { el.dataset.cents = '0'; el.value = ''; return; }

  const cents = parseInt(rawDigits.slice(-13) || '0', 10);
  el.dataset.cents = String(cents);
  _amtRender(el, cents);
}
function fmtDate(d){if(!d)return'—';const[y,m,day]=d.split('T')[0].split('-');return`${day}/${m}/${y}`;}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}


/* ═══════════════════════════════════════
   PAYEE AUTOCOMPLETE
═══════════════════════════════════════ */
const payeeAC = {
  focusIdx: -1,
  blurTimer: null,
  selectedId: null,
  selectedName: null
};

function clearPayeeField(ctx) {
  const c = payeeCtx(ctx);
  if(c.idEl) c.idEl.value = '';
  if(c.nameEl) c.nameEl.value = '';
  if(c.statusEl) c.statusEl.textContent = '';
  hidePayeeDropdown(ctx);
  hidePayeeSimilar();
  payeeAC.selectedId = null;
  payeeAC.selectedName = null;
}

function setPayeeField(payeeId, ctx) {
  if (!payeeId) { clearPayeeField(ctx); return; }
  const p = state.payees.find(x => x.id === payeeId);
  const c = payeeCtx(ctx);
  if (p) {
    if(c.idEl) c.idEl.value = p.id;
    if(c.nameEl) c.nameEl.value = p.name;
    if(c.statusEl) c.statusEl.textContent = '✓';
    payeeAC.selectedId = p.id;
    payeeAC.selectedName = p.name;
  } else clearPayeeField(ctx);
}

function selectPayee(id, name, ctx) {
  const c = payeeCtx(ctx);
  if(c.idEl) c.idEl.value = id;
  if(c.nameEl) c.nameEl.value = name;
  if(c.statusEl) c.statusEl.textContent = '✓';
  payeeAC.selectedId = id;
  payeeAC.selectedName = name;
  hidePayeeDropdown(ctx);
  hidePayeeSimilar();
  // Category suggestion only for tx modal
  if(ctx !== 'sc') suggestCategoryForPayee(id);
  // Debt amortization detection (tx modal only, expense transactions)
  if(ctx === 'tx' || ctx === undefined) {
    const txType = document.getElementById('txTypeField')?.value;
    if(txType === 'expense' && typeof checkDebtAmortization === 'function') {
      checkDebtAmortization(id).catch(() => {});
    }
  }
}

async function suggestCategoryForPayee(payeeId) {
  if(!payeeId) { hideCatSuggestion(); return; }
  // Check if category already selected (editing mode)
  const currentCat = document.getElementById('txCategoryId').value;
  if(currentCat) { hideCatSuggestion(); return; }
  // Query last transaction with this payee that has a category
  const { data } = await sb.from('transactions')
    .select('category_id, categories(name,color)')
    .eq('payee_id', payeeId)
    .not('category_id', 'is', null)
    .order('date', { ascending: false })
    .limit(1)
    .single();
  if(!data?.category_id) { hideCatSuggestion(); return; }
  showCatSuggestion(data.category_id, data.categories?.name, data.categories?.color);
}

function showCatSuggestion(catId, catName, catColor) {
  const el = document.getElementById('catSuggestion');
  const dot = document.getElementById('catSugDot');
  const name = document.getElementById('catSugName');
  if(!el || !catId) return;
  dot.style.background = catColor || 'var(--accent)';
  name.textContent = catName || 'Categoria';
  el._catId = catId;
  el.classList.add('visible');
}

function hideCatSuggestion() {
  const el = document.getElementById('catSuggestion');
  if(el) el.classList.remove('visible');
}

function applyCatSuggestion() {
  const el = document.getElementById('catSuggestion');
  if(!el?._catId) return;
  setCatPickerValue(el._catId);
  hideCatSuggestion();
}

// ── payee AC context helpers ─────────────────────────────────────────────────
// ctx = 'tx' (transaction modal) | 'sc' (scheduled modal)
function payeeCtx(ctx) {
  // 'dbt' context: creditor autocomplete inside the debt form modal
  if (ctx === 'dbt') {
    return {
      idEl:     document.getElementById('dbtPayeeId'),
      nameEl:   document.getElementById('dbtPayeeName'),
      statusEl: document.getElementById('dbtPayeeStatus'),
      ddEl:     document.getElementById('dbtPayeeDropdown'),
      bannerEl: null,
      typeEl:   null,
      ctx:      'dbt',
    };
  }
  const p = ctx === 'sc' ? 'sc' : 'tx';
  return {
    idEl:     document.getElementById(p + 'PayeeId'),
    nameEl:   document.getElementById(p + 'PayeeName'),
    statusEl: document.getElementById(p + 'PayeeStatus'),
    ddEl:     document.getElementById(p + 'PayeeDropdown'),
    bannerEl: ctx === 'sc' ? null : document.getElementById('txPayeeSimilarBanner'),
    typeEl:   document.getElementById(ctx === 'sc' ? 'scTypeField' : 'txTypeField'),
    ctx: p,
  };
}

function onPayeeInput(val, ctx) {
  const c = payeeCtx(ctx);
  if (val !== payeeAC.selectedName) {
    if(c.idEl) c.idEl.value = '';
    if(c.statusEl) c.statusEl.textContent = '';
    payeeAC.selectedId = null;
    payeeAC.selectedName = null;
  }
  if(c.bannerEl) c.bannerEl.style.display = 'none';
  if (val.length < 3) { if(c.ddEl) c.ddEl.style.display='none'; return; }
  const q = val.toLowerCase();
  const matches = state.payees.filter(p => p.name.toLowerCase().includes(q));
  showPayeeDropdown(matches, val, ctx);
}

function showPayeeDropdown(matches, typed, ctx) {
  const c = payeeCtx(ctx);
  const dd = c.ddEl;
  if(!dd) return;
  payeeAC.focusIdx = -1;
  let html = '';
  matches.slice(0, 8).forEach((p) => {
    const badge = { beneficiario: 'Beneficiário', fonte_pagadora: 'Fonte Pagadora', ambos: 'Ambos' }[p.type] || p.type;
    html += `<div class="payee-opt" onmousedown="event.preventDefault()" onclick="selectPayee('${p.id}','${esc(p.name)}','${ctx}')">
      <span class="payee-opt-icon">👤</span>
      <div><div class="payee-opt-name">${highlightMatch(esc(p.name), typed)}</div><div class="payee-opt-sub">${badge}</div></div>
    </div>`;
  });
  html += `<div class="payee-opt payee-opt-create" onmousedown="event.preventDefault()" onclick="createPayeeFromInput('${ctx}')">
    <span class="payee-opt-icon">＋</span>
    <div><div class="payee-opt-name">Criar "<strong>${esc(typed)}</strong>"</div><div class="payee-opt-sub">Novo beneficiário</div></div>
  </div>`;
  dd.innerHTML = html;
  dd.style.display = 'block';
}

function hidePayeeDropdown(ctx) {
  const c = payeeCtx(ctx);
  if(c.ddEl) c.ddEl.style.display = 'none';
  payeeAC.focusIdx = -1;
}

function hidePayeeSimilar() {
  const b = document.getElementById('txPayeeSimilarBanner');
  if (b) b.style.display = 'none';
}

function onPayeeBlur(ctx) {
  payeeAC.blurTimer = setTimeout(() => {
    const c = payeeCtx(ctx);
    const typed = c.nameEl?.value.trim() || '';
    hidePayeeDropdown(ctx);
    // Only show similar banner for tx modal (not sc)
    if (ctx !== 'sc' && !payeeAC.selectedId && typed.length >= 2) {
      checkSimilarPayee(typed);
    }
  }, 200);
}

function onPayeeKey(e, ctx) {
  const c = payeeCtx(ctx);
  const dd = c.ddEl;
  if(!dd || dd.style.display === 'none') return;
  const opts = dd.querySelectorAll('.payee-opt');
  if (!opts.length) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    payeeAC.focusIdx = Math.min(payeeAC.focusIdx + 1, opts.length - 1);
    opts.forEach((o, i) => o.classList.toggle('focused', i === payeeAC.focusIdx));
    opts[payeeAC.focusIdx]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    payeeAC.focusIdx = Math.max(payeeAC.focusIdx - 1, 0);
    opts.forEach((o, i) => o.classList.toggle('focused', i === payeeAC.focusIdx));
    opts[payeeAC.focusIdx]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter' && payeeAC.focusIdx >= 0) {
    e.preventDefault();
    opts[payeeAC.focusIdx]?.click();
  } else if (e.key === 'Escape') {
    hidePayeeDropdown(ctx);
  }
}

function highlightMatch(name, q) {
  const idx = name.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return name;
  return name.slice(0, idx) + '<mark style="background:var(--accent-lt);color:var(--accent);border-radius:2px">' + name.slice(idx, idx + q.length) + '</mark>' + name.slice(idx + q.length);
}

/* ── Similarity (Levenshtein distance) ── */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

function similarity(a, b) {
  const al = a.toLowerCase(), bl = b.toLowerCase();
  // exact substring = very similar
  if (al.includes(bl) || bl.includes(al)) return 0.9;
  const dist = levenshtein(al, bl);
  return 1 - dist / Math.max(al.length, bl.length);
}

function checkSimilarPayee(typed) {
  const best = state.payees
    .map(p => ({ p, score: similarity(typed, p.name) }))
    .filter(x => x.score >= 0.6)
    .sort((a, b) => b.score - a.score)[0];

  if (!best) {
    // No similar — ask to create
    showCreateNewBanner(typed);
    return;
  }

  // Show "did you mean?" banner
  const banner = document.getElementById('txPayeeSimilarBanner');
  banner.innerHTML = `
    <strong>⚠️ Beneficiário semelhante encontrado</strong>
    É este mesmo? <em>"${esc(best.p.name)}"</em>
    <div class="payee-similar-actions">
      <button class="btn btn-primary btn-sm" onmousedown="event.preventDefault()" onclick="confirmSimilarPayee('${best.p.id}','${esc(best.p.name)}')">
        Sim, usar "${esc(best.p.name)}"
      </button>
      <button class="btn btn-ghost btn-sm" onmousedown="event.preventDefault()" onclick="cancelPayeeCreation('tx')">
        Não, escolher outro
      </button>
      <button class="btn btn-ghost btn-sm" onmousedown="event.preventDefault()" onclick="createPayeeFromInput('tx')">
        Criar novo
      </button>
    </div>`;
  banner.style.display = 'block';
}

function showCreateNewBanner(typed) {
  const banner = document.getElementById('txPayeeSimilarBanner');
  banner.innerHTML = `
    <strong style="color:var(--accent)">➕ Novo beneficiário</strong>
    Criar "<em>${esc(typed)}</em>" como novo registro?
    <div class="payee-similar-actions">
      <button class="btn btn-primary btn-sm" onmousedown="event.preventDefault()" onclick="createPayeeFromInput('tx')">
        Criar agora
      </button>
      <button class="btn btn-ghost btn-sm" onmousedown="event.preventDefault()" onclick="cancelPayeeCreation('tx')">
        Escolher existente
      </button>
    </div>`;
  banner.style.display = 'block';
}

function cancelPayeeCreation(ctx) {
  // Hide the banner but keep the typed text so user can edit and pick from dropdown
  hidePayeeSimilar();
  const c = payeeCtx(ctx);
  // Re-focus the name input so the dropdown can reappear
  if (c.nameEl) {
    c.nameEl.focus();
    // Trigger dropdown with current value
    const val = c.nameEl.value;
    if (val && val.length >= 2) {
      onPayeeInput(val, ctx);
    }
  }
}

function confirmSimilarPayee(id, name) {
  selectPayee(id, name, 'tx');
  hidePayeeSimilar();
}

async function createPayeeFromInput(ctx) {
  const c = payeeCtx(ctx);
  const typed = c.nameEl?.value.trim() || '';
  if (!typed) return;
  const txType = c.typeEl?.value || 'expense';
  const payeeType = txType === 'income' ? 'fonte_pagadora' : 'beneficiario';
  const { data, error } = await sb.from('payees').insert({ name: typed, type: payeeType, family_id: famId() }).select().single();
  if (error) { toast('Erro ao criar beneficiário: ' + error.message, 'error'); return; }
  state.payees.push(data);
  state.payees.sort((a, b) => a.name.localeCompare(b.name));
  selectPayee(data.id, data.name, ctx);
  hidePayeeSimilar();
  toast(`"${typed}" criado como ${payeeType === 'fonte_pagadora' ? 'Fonte Pagadora' : 'Beneficiário'}`, 'success');
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


/* ═══════════════════════════════════════
   AI AUTO-DESCRIPTION (shared desktop + mobile)
═══════════════════════════════════════ */
function _afdClean(v) {
  return String(v || '').replace(/\s+/g, ' ').trim();
}

function _afdTitle(v) {
  const s = _afdClean(v);
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildAutoDescriptionFallback(categoryName, payeeName, memberName) {
  const cat = _afdTitle(categoryName);
  const pay = _afdTitle(payeeName);
  const mem = _afdTitle(memberName);
  if (cat && pay && mem) return `${cat} do ${mem} no ${pay}`;
  if (cat && pay) return `${cat} no ${pay}`;
  if (cat && mem) return `${cat} do ${mem}`;
  return cat || pay || mem || 'Lançamento';
}

async function generateAutoTransactionDescription({ categoryName, payeeName, memberName } = {}) {
  const fallback = buildAutoDescriptionFallback(categoryName, payeeName, memberName);
  const cat = _afdClean(categoryName);
  const pay = _afdClean(payeeName);
  const mem = _afdClean(memberName);
  if (!cat && !pay && !mem) return fallback;

  try {
    const apiKey = await getAppSetting('gemini_api_key', '').catch(() => '');
    if (!apiKey || !apiKey.startsWith('AIza')) return fallback;

    const prompt = `Você cria descrições curtas e padronizadas para lançamentos financeiros.
Retorne SOMENTE a descrição final, sem aspas, sem markdown, sem explicações.

REGRA DE FORMATO PREFERENCIAL:
- Se houver categoria e beneficiário: "<Categoria> no <Beneficiário>"
- Se houver categoria, beneficiário e membro: "<Categoria> do <Membro> no <Beneficiário>"
- Preserve nomes próprios corretamente.
- Seja curto, direto e natural em português do Brasil.
- Não invente informação além dos campos fornecidos.
- Não use ponto final.
- Máximo de 60 caracteres.

DADOS:
Categoria: ${cat || '(vazio)'}
Beneficiário: ${pay || '(vazio)'}
Membro: ${mem || '(vazio)'}

Exemplos válidos:
Supermercado no Pão de Açúcar
Supermercado do Décio no Pão de Açúcar
Farmácia na Drogasil
Presente da Chloe na Amazon`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 80 }
      })
    });
    if (!resp.ok) return fallback;

    const json = await resp.json().catch(() => null);
    const text = _afdClean(json?.candidates?.[0]?.content?.parts?.map(p => p?.text || '').join(' ') || '');
    if (!text) return fallback;

    const cleaned = text.replace(/^['"“”]+|['"“”]+$/g, '').replace(/\s+/g, ' ').trim();
    if (!cleaned || cleaned.length > 80) return fallback;
    return cleaned;
  } catch (_) {
    return fallback;
  }
}

async function ensureTransactionDescription(input) {
  const el = typeof input === 'string' ? document.getElementById(input) : input;
  const current = _afdClean(el?.value);
  if (current) return current;

  const categoryId = document.getElementById('txCategoryId')?.value || document.getElementById('scCategoryId')?.value || '';
  const payeeId    = document.getElementById('txPayeeId')?.value    || document.getElementById('scPayeeId')?.value    || '';

  let memberId = null;
  if (typeof getFmcMultiPickerSelected === 'function') {
    const txIds = getFmcMultiPickerSelected('txFamilyMemberPicker');
    const scIds = getFmcMultiPickerSelected('scFamilyMemberPicker');
    memberId = (txIds && txIds[0]) || (scIds && scIds[0]) || null;
  }
  memberId = memberId || document.getElementById('txFamilyMember')?.value || null;

  const categoryName = (state.categories || []).find(c => c.id === categoryId)?.name || '';
  const payeeName    = (state.payees || []).find(p => p.id === payeeId)?.name || '';
  const memberName   = (typeof getFamilyMemberById === 'function' && memberId)
    ? (getFamilyMemberById(memberId)?.name || '')
    : '';

  const generated = await generateAutoTransactionDescription({ categoryName, payeeName, memberName });
  if (el && generated) el.value = generated;
  return generated;
}

window.buildAutoDescriptionFallback = buildAutoDescriptionFallback;
window.generateAutoTransactionDescription = generateAutoTransactionDescription;
window.ensureTransactionDescription = ensureTransactionDescription;
