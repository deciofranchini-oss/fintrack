const ICON_META = {
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

  let html = '<div class="cat-none-option" onclick="setCatPickerValue(null, \'' + ctx + '\')">' +
    '<span style="width:10px;height:10px;border-radius:50%;background:var(--border);display:inline-block;flex-shrink:0"></span>' +
    '<span style="color:var(--muted)">\u2014 Sem categoria \u2014</span>' +
    '</div>';

  parents.forEach(function(p) {
    const children = cats
      .filter(function(c){ return c.parent_id === p.id; })
      .sort(function(a, b){ return a.name.localeCompare(b.name); });

    const hasChildren = children.length > 0;
    const color = p.color || '#8c8278';
    const icon = p.icon || '\ud83d\udce6';
    const groupId = 'catGroup-' + p.id;

    html += '<div class="cat-group-header" id="catGH-' + p.id + '">' +
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
        html += '<div class="cat-option" id="catOpt-' + c.id + '" data-cat-id="' + c.id + '" onclick="setCatPickerValue(\'' + c.id + '\', \'' + ctx + '\')">' +
          '<span class="cat-picker-dot" style="background:' + cc + '"></span>' +
          '<span style="font-size:.8rem">' + (c.icon || '▸') + '</span>' +
          '<span>' + esc(c.name) + '</span>' +
          '</div>';
      });
      html += '</div>';
    }
  });

  // Add "create category" quick button at bottom of picker
  var createType = typeFilter === 'despesa' ? 'despesa' : typeFilter === 'receita' ? 'receita' : 'despesa';
  html += '<div class="cat-create-btn" onclick="event.stopPropagation();quickCreateCategory(\'' + createType + '\', \'' + ctx + '\')" style="display:flex;align-items:center;gap:6px;padding:9px 12px;border-top:1px solid var(--border);cursor:pointer;color:var(--accent);font-size:.8rem;font-weight:600;" onmouseover="this.style.background=\'var(--accent-lt)\'" onmouseout="this.style.background=\'\'"><span>+</span><span>Nova categoria</span></div>';

  dd.innerHTML = html;

  // Attach toggle handlers
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
  var currentId = document.getElementById(c.inputId) ? document.getElementById(c.inputId).value : '';
  if (currentId) {
    var cat = (state.categories || []).find(function(x){ return x.id === currentId; });
    if (cat && cat.parent_id) {
      var grp = document.getElementById('catGroup-' + cat.parent_id);
      var arr = document.getElementById('catArr-' + cat.parent_id);
      if (grp && !grp.classList.contains('open')) { grp.classList.add('open'); if (arr) arr.classList.add('open'); }
    }
  }
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
