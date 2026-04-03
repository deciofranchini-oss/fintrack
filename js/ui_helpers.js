window.ICON_META = window.ICON_META || {
  // Brazilian banks
  'itau':       {label:'Itaú',        color:'#FF6600', type:'bank'},
  'inter':      {label:'Inter',       color:'#FF7A00', type:'bank'},
  'bradesco':   {label:'Bradesco',    color:'#CC092F', type:'bank'},
  'nubank':     {label:'Nubank',      color:'#820AD1', type:'bank'},
  'bb':         {label:'BB',          color:'#F5A623', type:'bank'},
  'caixa':      {label:'Caixa',       color:'#005CA9', type:'bank'},
  'santander':  {label:'Santander',   color:'#EC0000', type:'bank'},
  'xp':         {label:'XP',          color:'#000000', type:'bank'},
  'c6':         {label:'C6',          color:'#242424', type:'bank'},
  'neon':       {label:'Neon',        color:'#00D4FF', type:'bank'},
  'next':       {label:'Next',        color:'#00AF3F', type:'bank'},
  'picpay':     {label:'PicPay',      color:'#21C25E', type:'bank'},
  'mercadopago':{label:'Mercado Pago',color:'#009EE3', type:'bank'},
  'sicoob':     {label:'Sicoob',      color:'#006837', type:'bank'},
  'rico':       {label:'Rico',        color:'#00A86B', type:'bank'},
  'will':       {label:'Will',        color:'#7B2D8B', type:'bank'},
  // French banks
  'boursobank': {label:'Boursobank',  color:'#1A2E5A', type:'bank'},
  'bnp':        {label:'BNP Paribas', color:'#009B55', type:'bank'},
  'sg':         {label:'Soc. Gén.',   color:'#E30613', type:'bank'},
  'ca':         {label:'Crédit Ag.',  color:'#009A44', type:'bank'},
  'lcl':        {label:'LCL',         color:'#005BAB', type:'bank'},
  'laposte':    {label:'La Poste',    color:'#FDD000', type:'bank'},
  'cic':        {label:'CIC',         color:'#003087', type:'bank'},
  'bred':       {label:'BRED',        color:'#C8102E', type:'bank'},
  'revolut':    {label:'Revolut',     color:'#0075EB', type:'bank'},
  'n26':        {label:'N26',         color:'#3B82F6', type:'bank'},
  'wise':       {label:'Wise',        color:'#9FE870', type:'bank'},
  'paypal':     {label:'PayPal',      color:'#003087', type:'bank'},
  // Cards
  'visa':       {label:'Visa',        color:'#1A1F71', type:'card'},
  'mastercard': {label:'Mastercard',  color:'#EB001B', type:'card'},
  'amex':       {label:'Amex',        color:'#2E77BC', type:'card'},
  'elo':        {label:'Elo',         color:'#000000', type:'card'},
  'hipercard':  {label:'Hipercard',   color:'#B40019', type:'card'},
  'dinersclub': {label:'Diners',      color:'#004B87', type:'card'},
  'sams':       {label:"Sam's",       color:'#0067A0', type:'card'},
  'porto':      {label:'Porto',       color:'#005B8E', type:'card'},
};
const ICON_META = window.ICON_META;

// Render icon from stored key into an element
function renderIconEl(iconKey, color, size=28) {
  if(!iconKey) return `<span style="font-size:${size}px">🏦</span>`;
  if(iconKey.startsWith('emoji-')) {
    const emoji = iconKey.replace('emoji-','');
    return `<span style="font-size:${Math.round(size*0.9)}px">${emoji}</span>`;
  }
  const meta = ICON_META[iconKey];
  if(!meta) return `<span style="font-size:${Math.round(size*0.9)}px">🏦</span>`;
  const bg = color || meta.color;
  // Special visual rendering for card types
  if(meta.type === 'card') {
    const r = Math.round(size*0.22);
    const fs = Math.round(size*0.32);
    if(iconKey === 'visa') return `<span style="width:${size}px;height:${size}px;background:#1A1F71;border-radius:${r}px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;font-style:italic;font-weight:900;font-size:${fs}px;color:#fff;font-family:serif;letter-spacing:-.03em">VISA</span>`;
    if(iconKey === 'mastercard') {
      const cs = Math.round(size*0.38); const off = Math.round(size*0.12);
      return `<span style="width:${size}px;height:${size}px;background:transparent;border-radius:${r}px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;position:relative;overflow:visible"><span style="width:${cs}px;height:${cs}px;background:#EB001B;border-radius:50%;opacity:.95;position:absolute;left:${Math.round(size*0.06)}px"></span><span style="width:${cs}px;height:${cs}px;background:#F79E1B;border-radius:50%;opacity:.95;position:absolute;right:${Math.round(size*0.06)}px"></span></span>`;
    }
    if(iconKey === 'amex') return `<span style="width:${size}px;height:${size}px;background:#2E77BC;border-radius:${r}px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;font-size:${Math.round(size*0.26)}px;font-weight:700;color:#fff;letter-spacing:.04em">AMEX</span>`;
    if(iconKey === 'elo') return `<span style="width:${size}px;height:${size}px;background:#000;border-radius:${r}px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;font-size:${Math.round(size*0.34)}px;font-weight:900;color:#F5BC00;font-style:italic">elo</span>`;
    // Generic card: colored box with label
    const initials = meta.label.substring(0,2).toUpperCase();
    return `<span style="width:${size}px;height:${size}px;background:${bg};color:${isLightColor(bg)?'#333':'#fff'};border-radius:${r}px;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:${fs}px;font-family:var(--font-sans);letter-spacing:-.02em;flex-shrink:0">${initials}</span>`;
  }
  const initials = meta.label.substring(0,2).toUpperCase();
  return `<span style="width:${size}px;height:${size}px;background:${bg};color:${isLightColor(bg)?'#333':'#fff'};border-radius:${size*0.22}px;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:${Math.round(size*0.35)}px;font-family:var(--font-sans);letter-spacing:-.02em;flex-shrink:0">${initials}</span>`;
}

function isLightColor(hex) {
  const c = hex.replace('#','');
  const r=parseInt(c.substr(0,2),16), g=parseInt(c.substr(2,2),16), b=parseInt(c.substr(4,2),16);
  return (r*299+g*587+b*114)/1000 > 160;
}

function showIconGroup(event, group) {
  document.querySelectorAll('.icon-tab').forEach(t=>t.classList.remove('active'));
  event.target.classList.add('active');
  document.querySelectorAll('.icon-grid').forEach(g=>g.style.display='none');
  document.getElementById('iconGroup-'+group).style.display='grid';
}

function selectAccountIcon(el) {
  document.querySelectorAll('.icon-option').forEach(o=>o.classList.remove('selected'));
  el.classList.add('selected');
  const iconKey = el.dataset.icon;
  const iconColor = el.dataset.color;
  document.getElementById('accountIcon').value = iconKey;
  if(iconColor) document.getElementById('accountColor').value = iconColor;
  // Update preview
  const preview = document.getElementById('accountIconPreview');
  preview.innerHTML = renderIconEl(iconKey, iconColor, 28);
}

function syncIconPickerToValue(iconKey, color) {
  // Mark the right option as selected
  document.querySelectorAll('.icon-option').forEach(o=>{
    o.classList.toggle('selected', o.dataset.icon === iconKey);
  });
  // Switch to correct tab if needed
  if(iconKey) {
    let group = 'generic';
    const meta = ICON_META[iconKey];
    if(meta) {
      const banksFR = ['boursobank','bnp','sg','ca','lcl','laposte','cic','bred','revolut','n26','wise','paypal'];
      const cards = ['visa','mastercard','amex','elo','hipercard','dinersclub','sams','porto'];
      if(cards.includes(iconKey)) group = 'cards';
      else if(banksFR.includes(iconKey)) group = 'banks-fr';
      else group = 'banks-br';
    }
    document.querySelectorAll('.icon-tab').forEach(t=>t.classList.remove('active'));
    const activeTab = document.querySelector(`.icon-tab[onclick*="${group}"]`);
    if(activeTab) activeTab.classList.add('active');
    document.querySelectorAll('.icon-grid').forEach(g=>g.style.display='none');
    const activeGroup = document.getElementById('iconGroup-'+group);
    if(activeGroup) activeGroup.style.display='grid';
  }
  const preview = document.getElementById('accountIconPreview');
  if(preview) preview.innerHTML = renderIconEl(iconKey, color, 28);
}


/* ═══════════════════════════════════════
   HIERARCHICAL CATEGORY PICKER
═══════════════════════════════════════ */
let catPickerOpen = false;

// ID helpers for the search input element inside each picker dropdown
function _catSearchId(ctx) {
  return ctx === 'sc' ? 'scCatPickerSearch' : 'catPickerSearch';
}

function buildCatPicker(typeFilter, ctx) {
  ctx = ctx || 'tx';
  var c = _catCtx(ctx);
  const dd = document.getElementById(c.ddId);
  if (!dd) return;

  // Auto-detect filter from the modal type if not explicitly provided
  if (!typeFilter) {
    var txType = document.getElementById(c.typeId) ? document.getElementById(c.typeId).value : '';
    if (txType === 'expense') typeFilter = 'despesa';
    else if (txType === 'income') typeFilter = 'receita';
  }

  const allCats = state.categories || [];
  const cats = typeFilter ? allCats.filter(function(c){ return c.type === typeFilter; }) : allCats;

  const parents = cats
    .filter(function(c){ return !c.parent_id; })
    .sort(function(a, b){ return a.name.localeCompare(b.name); });

  // ── Search input (sticky, top of dropdown) ───────────────────────────────
  const searchId = _catSearchId(ctx);
  let html = '<div class="cat-search-wrap">' +
    '<svg class="cat-search-svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>' +
    '<input type="text" id="' + searchId + '" class="cat-search-input"' +
    ' placeholder="Buscar categoria..." autocomplete="off" autocorrect="off" spellcheck="false"' +
    ' oninput="_catPickerFilter(\'' + ctx + '\', this.value)"' +
    ' onclick="event.stopPropagation()"' +
    ' onkeydown="_catPickerSearchKeydown(event, \'' + ctx + '\')">' +
    '<button type="button" class="cat-search-clear" id="' + searchId + 'Clear"' +
    ' onclick="event.stopPropagation();_catPickerClearSearch(\'' + ctx + '\')" tabindex="-1" aria-label="Limpar">&#10005;</button>' +
    '</div>';

  // ── Chips de categorias recentes (últimas 5 usadas nas transações) ────────
  var recentCatIds = _catPickerGetRecents(ctx, typeFilter);
  if (recentCatIds.length > 0) {
    html += '<div class="cat-recent-wrap" id="catRecentWrap-' + ctx + '">' +
      '<div class="cat-recent-lbl">Usadas recentemente</div>' +
      '<div class="cat-recent-chips">';
    recentCatIds.forEach(function(catId) {
      var cat = allCats.find(function(x){ return x.id === catId; });
      if (!cat) return;
      var parent = cat.parent_id ? allCats.find(function(x){ return x.id === cat.parent_id; }) : null;
      var label = parent ? (parent.icon||'') + ' ' + cat.name : (cat.icon||'📦') + ' ' + cat.name;
      var color = cat.color || 'var(--accent)';
      html += '<button type="button" class="cat-recent-chip" onclick="event.stopPropagation();setCatPickerValue(\'' + catId + '\', \'' + ctx + '\')" title="' + esc(parent ? parent.name + ' > ' + cat.name : cat.name) + '">' +
        '<span class="cat-recent-chip-dot" style="background:' + color + '"></span>' +
        esc(label) +
        '</button>';
    });
    html += '</div></div>';
  }

  // ── "Sem categoria" option ────────────────────────────────────────────────
  html += '<div class="cat-none-option" onclick="setCatPickerValue(null, \'' + ctx + '\')">' +
    '<span style="width:10px;height:10px;border-radius:50%;background:var(--border);display:inline-block;flex-shrink:0"></span>' +
    '<span style="color:var(--muted)">\u2014 Sem categoria \u2014</span>' +
    '</div>';

  // ── Category groups ───────────────────────────────────────────────────────
  parents.forEach(function(p) {
    const children = cats
      .filter(function(c){ return c.parent_id === p.id; })
      .sort(function(a, b){ return a.name.localeCompare(b.name); });

    const hasChildren = children.length > 0;
    const color = p.color || '#8c8278';
    const icon = p.icon || '\ud83d\udce6';
    const groupId = 'catGroup-' + p.id;

    // data-cat-name enables fast text-match without touching state in filter fn
    html += '<div class="cat-group-header" id="catGH-' + p.id + '" data-cat-name="' + esc(p.name.toLowerCase()) + '">' +
      '<span style="width:10px;height:10px;border-radius:50%;background:' + color + ';flex-shrink:0"></span>' +
      '<span style="font-size:.9rem;flex-shrink:0">' + icon + '</span>' +
      '<span class="cat-group-label">' + esc(p.name) + '</span>' +
      '<span class="cat-group-select" onclick="event.stopPropagation();setCatPickerValue(\'' + p.id + '\', \'' + ctx + '\')" title="Selecionar esta categoria">usar</span>' +
      (hasChildren ? '<span class="cat-group-count">' + children.length + '</span><span class="cat-group-arrow" id="catArr-' + p.id + '">▶</span>' : '') +
      '</div>';

    if (hasChildren) {
      html += '<div class="cat-children" id="' + groupId + '">';
      children.forEach(function(c) {
        const cc = c.color || color;
        html += '<div class="cat-option" id="catOpt-' + c.id + '" data-cat-id="' + c.id + '" data-cat-name="' + esc(c.name.toLowerCase()) + '" data-parent-name="' + esc(p.name.toLowerCase()) + '" onclick="setCatPickerValue(\'' + c.id + '\', \'' + ctx + '\')">' +
          '<span class="cat-picker-dot" style="background:' + cc + '"></span>' +
          '<span style="font-size:.8rem">' + (c.icon || '▸') + '</span>' +
          '<span>' + esc(c.name) + '</span>' +
          '</div>';
      });
      html += '</div>';
    }
  });

  // ── "Nova categoria" button ───────────────────────────────────────────────
  var createType = typeFilter === 'despesa' ? 'despesa' : typeFilter === 'receita' ? 'receita' : 'despesa';
  html += '<div class="cat-create-btn" onclick="event.stopPropagation();quickCreateCategory(\'' + createType + '\', \'' + ctx + '\')" style="display:flex;align-items:center;gap:6px;padding:9px 12px;border-top:1px solid var(--border);cursor:pointer;color:var(--accent);font-size:.8rem;font-weight:600;" onmouseover="this.style.background=\'var(--accent-lt)\'" onmouseout="this.style.background=\'\'"><span>+</span><span>Nova categoria</span></div>';

  dd.innerHTML = html;

  // Attach toggle handlers for groups (not needed during search — handled separately)
  parents.forEach(function(p) {
    const children = cats.filter(function(c){ return c.parent_id === p.id; });
    if (!children.length) return;
    const gh = document.getElementById('catGH-' + p.id);
    if (gh) gh.addEventListener('click', function(){ toggleCatGroup(p.id); });
  });

  // Clear selected category if it doesn\'t match the new filter
  if (typeFilter) {
    const currentId = document.getElementById(c.inputId) && document.getElementById(c.inputId).value;
    if (currentId) {
      const cat = allCats.find(function(x){ return x.id === currentId; });
      if (cat && cat.type !== typeFilter) setCatPickerValue(null, ctx);
    }
  }
}

// ── Search filter ─────────────────────────────────────────────────────────────
function _catPickerFilter(ctx, rawQuery) {
  var c  = _catCtx(ctx);
  var dd = document.getElementById(c.ddId);
  if (!dd) return;

  var q = (rawQuery || '').trim().toLowerCase();

  // Toggle clear button visibility
  var clearBtn = document.getElementById(_catSearchId(ctx) + 'Clear');
  if (clearBtn) clearBtn.style.display = q ? '' : 'none';

  if (!q) {
    // Restore everything to default collapsed state
    dd.querySelectorAll('.cat-group-header').forEach(function(el) { el.style.display = ''; });
    dd.querySelectorAll('.cat-children').forEach(function(el) {
      el.style.display = '';          // let CSS class control visibility
      el.classList.remove('open');   // collapse back to normal state
    });
    dd.querySelectorAll('.cat-option').forEach(function(el) { el.style.display = ''; });
    dd.querySelectorAll('.cat-none-option').forEach(function(el) { el.style.display = ''; });
    return;
  }

  // Hide "sem categoria" when actively searching
  dd.querySelectorAll('.cat-none-option').forEach(function(el) { el.style.display = 'none'; });

  // For each group header: show if parent name matches
  dd.querySelectorAll('.cat-group-header').forEach(function(gh) {
    var parentName = gh.getAttribute('data-cat-name') || '';
    var parentMatches = parentName.includes(q);

    // Check children
    var pid = gh.id.replace('catGH-', '');
    var childrenWrap = document.getElementById('catGroup-' + pid);
    var anyChildMatch = false;

    if (childrenWrap) {
      childrenWrap.querySelectorAll('.cat-option').forEach(function(opt) {
        var childName  = opt.getAttribute('data-cat-name') || '';
        var parentN    = opt.getAttribute('data-parent-name') || '';
        var matches    = childName.includes(q) || parentN.includes(q);
        opt.style.display = (matches || parentMatches) ? '' : 'none';
        if (matches) anyChildMatch = true;
      });

      if (parentMatches || anyChildMatch) {
        // Force children visible and expanded during search
        childrenWrap.style.display = 'block';
      } else {
        childrenWrap.style.display = 'none';
      }
    }

    // Show the group header if parent name matches OR any child matched
    gh.style.display = (parentMatches || anyChildMatch) ? '' : 'none';
  });
}

// Clear search and restore full list
function _catPickerClearSearch(ctx) {
  var inp = document.getElementById(_catSearchId(ctx));
  if (inp) { inp.value = ''; inp.focus(); }
  _catPickerFilter(ctx, '');
}

// Keyboard: Escape clears search; Enter selects first visible option
function _catPickerSearchKeydown(e, ctx) {
  if (e.key === 'Escape') {
    e.stopPropagation();
    var inp = document.getElementById(_catSearchId(ctx));
    if (inp && inp.value) {
      _catPickerClearSearch(ctx);
    } else {
      _closeCatPickerByCtx(ctx);
    }
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    var c  = _catCtx(ctx);
    var dd = document.getElementById(c.ddId);
    if (!dd) return;
    // Find first visible cat-option
    var opts = dd.querySelectorAll('.cat-option');
    for (var i = 0; i < opts.length; i++) {
      if (opts[i].style.display !== 'none') {
        opts[i].click();
        return;
      }
    }
    // If no child visible, try first visible parent "usar" button
    var usarBtns = dd.querySelectorAll('.cat-group-select');
    for (var j = 0; j < usarBtns.length; j++) {
      var gh = usarBtns[j].closest('.cat-group-header');
      if (gh && gh.style.display !== 'none') {
        usarBtns[j].click();
        return;
      }
    }
  }
}

// ctx = 'tx' (transaction modal) | 'sc' (scheduled modal)
function _catCtx(ctx) {
  ctx = ctx || 'tx';
  return {
    ddId:    ctx === 'sc' ? 'scCatPickerDropdown' : 'catPickerDropdown',
    btnId:   ctx === 'sc' ? 'scCatPickerBtn'      : 'catPickerBtn',
    wrapId:  ctx === 'sc' ? 'scCatPickerWrap'     : 'catPickerWrap',
    inputId: ctx === 'sc' ? 'scCategoryId'        : 'txCategoryId',
    labelId: ctx === 'sc' ? 'scCatPickerLabel'    : 'catPickerLabel',
    dotId:   ctx === 'sc' ? 'scCatPickerDot'      : 'catPickerDot',
    typeId:  ctx === 'sc' ? 'scTypeField'          : 'txTypeField',
  };
}

let _catPickerCtx = null;

function toggleCatGroup(parentId) {
  var group = document.getElementById('catGroup-' + parentId);
  var arrow = document.getElementById('catArr-' + parentId);
  if (!group) return;
  var isOpen = group.classList.toggle('open');
  if (arrow) arrow.classList.toggle('open', isOpen);
}

function toggleCatPicker(ctx) {
  ctx = ctx || 'tx';
  var c = _catCtx(ctx);
  var dd  = document.getElementById(c.ddId);
  var btn = document.getElementById(c.btnId);
  if (!dd || !btn) return;
  var wasOpen = dd.classList.contains('open');
  if (_catPickerCtx) _closeCatPickerByCtx(_catPickerCtx);
  if (wasOpen) return;
  _catPickerCtx = ctx;
  dd.classList.add('open');
  btn.classList.add('open');
  // Auto-expand group of currently selected category
  var currentId = document.getElementById(c.inputId) ? document.getElementById(c.inputId).value : '';
  if (currentId) {
    var cat = (state.categories || []).find(function(x){ return x.id === currentId; });
    if (cat && cat.parent_id) {
      var grp = document.getElementById('catGroup-' + cat.parent_id);
      var arr = document.getElementById('catArr-' + cat.parent_id);
      if (grp && !grp.classList.contains('open')) { grp.classList.add('open'); if (arr) arr.classList.add('open'); }
    }
  }
  // Focus the search input after a short delay (allows dropdown animation to start)
  setTimeout(function() {
    var inp = document.getElementById(_catSearchId(ctx));
    if (inp) inp.focus();
  }, 60);
  setTimeout(function() { document.addEventListener('click', _catPickerOutsideHandler, { once: true }); }, 10);
}

function _catPickerOutsideHandler(e) {
  if (!_catPickerCtx) return;
  var c = _catCtx(_catPickerCtx);
  var wrap = document.getElementById(c.wrapId);
  if (wrap && !wrap.contains(e.target)) {
    _closeCatPickerByCtx(_catPickerCtx);
  } else {
    setTimeout(function() { document.addEventListener('click', _catPickerOutsideHandler, { once: true }); }, 10);
  }
}

function _closeCatPickerByCtx(ctx) {
  var c = _catCtx(ctx);
  var dd  = document.getElementById(c.ddId);
  var btn = document.getElementById(c.btnId);
  if (dd)  dd.classList.remove('open');
  if (btn) btn.classList.remove('open');
  // Clear search so next open starts fresh
  var inp = document.getElementById(_catSearchId(ctx));
  if (inp && inp.value) {
    inp.value = '';
    _catPickerFilter(ctx, '');
  }
  if (_catPickerCtx === ctx) _catPickerCtx = null;
}

function closeCatPicker() { _closeCatPickerByCtx('tx'); }

function setCatPickerValue(catId, ctx) {
  ctx = ctx || 'tx';
  var c = _catCtx(ctx);
  var input = document.getElementById(c.inputId);
  if (input) input.value = catId || '';
  var label = document.getElementById(c.labelId);
  var dot   = document.getElementById(c.dotId);
  if (!catId) {
    if (label) { label.textContent = '— Sem categoria —'; label.style.color = 'var(--muted)'; }
    if (dot) dot.style.display = 'none';
  } else {
    var cat = (state.categories || []).find(function(x){ return x.id === catId; });
    if (cat && label) {
      var parent = cat.parent_id ? (state.categories || []).find(function(x){ return x.id === cat.parent_id; }) : null;
      label.textContent = parent
        ? (parent.icon||'📦') + ' ' + parent.name + '  ›  ' + (cat.icon||'▸') + ' ' + cat.name
        : (cat.icon||'📦') + ' ' + cat.name;
      label.style.color = 'var(--text)';
    }
    if (dot && cat) { dot.style.background = cat.color || 'var(--accent)'; dot.style.display = ''; }
  }
  var dd = document.getElementById(c.ddId);
  if (dd) {
    dd.querySelectorAll('.cat-option').forEach(function(el) {
      el.classList.toggle('selected', el.getAttribute('data-cat-id') === catId);
    });
  }
  _closeCatPickerByCtx(ctx);
}



/* ═══════════════════════════════════════════════════════
   SCHEDULED TRANSACTIONS
═══════════════════════════════════════════════════════ */


/* ═══════════════════════════════════════════════════════
   MONEY INPUT (AUTO DECIMALS) — iOS friendly
   - User types only digits; UI always shows pt-BR money (0,00)
   - Works with iPhone virtual keyboard (relies on 'input'/'beforeinput', not keydown)
═══════════════════════════════════════════════════════ */
(function(){
  function _formatPtBrFromCents(cents){
    cents = Math.max(0, Number.isFinite(cents) ? Math.floor(cents) : 0);
    const intPart = Math.floor(cents / 100);
    const decPart = String(cents % 100).padStart(2,'0');
    // thousands separator
    const intStr = String(intPart).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return intStr + ',' + decPart;
  }

  function _applyMoneyMask(el){
    if(!el) return;
    if(el._moneyMasking) return;
    el._moneyMasking = true;
    try{
      const digits = String(el.value||'').replace(/\D/g,'');
      const cents = digits ? parseInt(digits,10) : 0;
      el.dataset.moneyDigits = digits || '0';
      const next = _formatPtBrFromCents(cents);
      if(el.value !== next) el.value = next;
      // keep caret at end (most predictable on iOS)
      try{ el.setSelectionRange(el.value.length, el.value.length); } catch(e){}
    } finally {
      el._moneyMasking = false;
    }
  }

  function _shouldMask(el){
    if(!el || el.disabled || el.readOnly) return false;
    // txAmount e scAmount são gerenciados por _amtFieldInput/Blur/Focus em utils.js
    // — NÃO incluir aqui para evitar conflito de handlers
    const ids = ['accountBalance','budgetAmount','debtFormAmount','consolidateAmount'];
    return ids.includes(el.id);
  }

  function bindMoneyInput(el){
    if(!el || el._moneyBound) return;
    if(!_shouldMask(el)) return;
    el._moneyBound = true;

    // Ensure it's text so we can write commas safely across browsers
    try{ el.setAttribute('type','text'); } catch(e){}
    el.setAttribute('inputmode','numeric');
    el.setAttribute('autocomplete','off');
    el.setAttribute('autocorrect','off');
    el.setAttribute('autocapitalize','off');
    el.setAttribute('spellcheck','false');

    // iOS: beforeinput é mais confiável que keydown para bloquear não-dígitos
    el.addEventListener('beforeinput', function(ev){
      if(ev && ev.inputType === 'insertText' && ev.data && /\D/.test(ev.data)) {
        ev.preventDefault();
      }
    });

    el.addEventListener('input', function(){ _applyMoneyMask(el); });

    el.addEventListener('paste', function(){
      setTimeout(function(){ _applyMoneyMask(el); }, 0);
    });

    el.addEventListener('focus', function(){
      if(!el.value) el.value = '0,00';
      setTimeout(function(){
        try{ el.setSelectionRange(el.value.length, el.value.length); } catch(e){}
      }, 0);
    });

    el.addEventListener('blur', function(){
      _applyMoneyMask(el);
    });

    // Initial normalization
    _applyMoneyMask(el);
  }

  function initMoneyInputs(){
    // txAmount e scAmount excluídos — gerenciados por utils.js (_amtFieldInput/Blur/Focus)
    ['accountBalance','budgetAmount','debtFormAmount','consolidateAmount'].forEach(function(id){
      const el = document.getElementById(id);
      if(el) bindMoneyInput(el);
    });
  }

  // Expose for debugging / manual rebinding after dynamic DOM changes
  window.bindMoneyInput = bindMoneyInput;
  window.initMoneyInputs = initMoneyInputs;

  if(document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMoneyInputs);
  } else {
    initMoneyInputs();
  }
})();


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
