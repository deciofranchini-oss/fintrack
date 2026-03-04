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
      <button class="btn btn-ghost btn-sm" onmousedown="event.preventDefault()" onclick="createPayeeFromInput('tx')">
        Não, criar novo
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
      <button class="btn btn-ghost btn-sm" onmousedown="event.preventDefault()" onclick="clearPayeeField('tx')">
        Cancelar
      </button>
    </div>`;
  banner.style.display = 'block';
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


/* ═══════════════════════════════════════
   ICON PICKER
═══════════════════════════════════════ */
