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

function buildCatPicker() {
  const dd = document.getElementById('catPickerDropdown');
  if (!dd) return;

  const parents = state.categories
    .filter(c => !c.parent_id)
    .sort((a, b) => a.name.localeCompare(b.name));

  let html = `<div class="cat-none-option" onclick="setCatPickerValue(null)">
    <span style="width:10px;height:10px;border-radius:50%;background:var(--border);display:inline-block;flex-shrink:0"></span>
    <span style="color:var(--muted)">— Sem categoria —</span>
  </div>`;

  parents.forEach(p => {
    const children = state.categories
      .filter(c => c.parent_id === p.id)
      .sort((a, b) => a.name.localeCompare(b.name));

    const hasChildren = children.length > 0;
    const color = p.color || '#8c8278';
    const icon = p.icon || '📦';
    const groupId = 'catGroup-' + p.id;

    html += `<div class="cat-group-header" id="catGH-${p.id}">
      <span style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0"></span>
      <span style="font-size:.9rem;flex-shrink:0">${icon}</span>
      <span class="cat-group-label">${esc(p.name)}</span>
      <span class="cat-group-select" onclick="event.stopPropagation();setCatPickerValue('${p.id}')" title="Selecionar esta categoria">usar</span>
      ${hasChildren ? `<span class="cat-group-count">${children.length}</span>
      <span class="cat-group-arrow" id="catArr-${p.id}">▶</span>` : ''}
    </div>`;

    if (hasChildren) {
      // make the header toggle children on click
      html += `<div class="cat-children" id="${groupId}">`;
      children.forEach(c => {
        const cc = c.color || color;
        html += `<div class="cat-option" id="catOpt-${c.id}" onclick="setCatPickerValue('${c.id}')">
          <span class="cat-picker-dot" style="background:${cc}"></span>
          <span style="font-size:.8rem">${c.icon||'▸'}</span>
          <span>${esc(c.name)}</span>
        </div>`;
      });
      html += `</div>`;
    }
  });

  dd.innerHTML = html;

  // Attach toggle handlers to group headers that have children
  parents.forEach(p => {
    const children = state.categories.filter(c => c.parent_id === p.id);
    if (!children.length) return;
    const gh = document.getElementById('catGH-' + p.id);
    if (gh) gh.addEventListener('click', () => toggleCatGroup(p.id));
  });
}

function toggleCatGroup(parentId) {
  const group = document.getElementById('catGroup-' + parentId);
  const arrow = document.getElementById('catArr-' + parentId);
  if (!group) return;
  const isOpen = group.classList.toggle('open');
  if (arrow) arrow.classList.toggle('open', isOpen);
}

function toggleCatPicker() {
  const dd = document.getElementById('catPickerDropdown');
  const btn = document.getElementById('catPickerBtn');
  if (!dd || !btn) return;
  catPickerOpen = !catPickerOpen;
  dd.classList.toggle('open', catPickerOpen);
  btn.classList.toggle('open', catPickerOpen);
  if (catPickerOpen) {
    // Auto-expand the group containing the currently selected category
    const currentId = document.getElementById('txCategoryId').value;
    if (currentId) {
      const cat = state.categories.find(c => c.id === currentId);
      if (cat?.parent_id) {
        const group = document.getElementById('catGroup-' + cat.parent_id);
        const arrow = document.getElementById('catArr-' + cat.parent_id);
        if (group && !group.classList.contains('open')) {
          group.classList.add('open');
          if (arrow) arrow.classList.add('open');
        }
      }
    }
    // Close picker when clicking outside
    setTimeout(() => {
      document.addEventListener('click', closeCatPickerOutside, { once: true });
    }, 10);
  }
}

function closeCatPickerOutside(e) {
  const wrap = document.getElementById('catPickerWrap');
  if (wrap && !wrap.contains(e.target)) {
    closeCatPicker();
  } else if (catPickerOpen) {
    // Re-attach listener if still open
    setTimeout(() => {
      document.addEventListener('click', closeCatPickerOutside, { once: true });
    }, 10);
  }
}

function closeCatPicker() {
  catPickerOpen = false;
  const dd = document.getElementById('catPickerDropdown');
  const btn = document.getElementById('catPickerBtn');
  if (dd) dd.classList.remove('open');
  if (btn) btn.classList.remove('open');
}

function setCatPickerValue(catId) {
  // Update hidden input
  const input = document.getElementById('txCategoryId');
  if (input) input.value = catId || '';

  // Update button label
  const label = document.getElementById('catPickerLabel');
  const dot = document.getElementById('catPickerDot');

  if (!catId) {
    if (label) { label.textContent = '— Sem categoria —'; label.style.color = 'var(--muted)'; }
    if (dot) dot.style.display = 'none';
  } else {
    const cat = state.categories.find(c => c.id === catId);
    if (cat && label) {
      // Show parent > child breadcrumb if it's a subcategory
      const parent = cat.parent_id ? state.categories.find(c => c.id === cat.parent_id) : null;
      label.textContent = parent ? `${parent.icon||'📦'} ${parent.name}  ›  ${cat.icon||'▸'} ${cat.name}` : `${cat.icon||'📦'} ${cat.name}`;
      label.style.color = 'var(--text)';
    }
    if (dot && cat) { dot.style.background = cat.color || 'var(--accent)'; dot.style.display = ''; }
  }

  // Highlight selected option
  document.querySelectorAll('.cat-option').forEach(el => {
    el.classList.toggle('selected', el.id === 'catOpt-' + catId);
  });

  closeCatPicker();
}


/* ═══════════════════════════════════════════════════════
   SCHEDULED TRANSACTIONS
═══════════════════════════════════════════════════════ */

// ── State ──────────────────────────────────────────────
state.scheduled = [];

// ── Frequency helpers ──────────────────────────────────
const FREQ_LABELS = {
  once: 'Uma vez', weekly: 'Semanal', biweekly: 'Quinzenal',
  monthly: 'Mensal', bimonthly: 'Bimestral', quarterly: 'Trimestral',
  semiannual: 'Semestral', annual: 'Anual', custom: 'Personalizado'
};

