/* ═══════════════════════════════════════════════════════════════════════════
   FAMILY_MEMBERS_COMPOSITION.JS — Gestão de membros da família
   ─────────────────────────────────────────────────────────────────────────
   Tabela: family_composition
     id         UUID PK
     family_id  UUID FK families
     name       TEXT NOT NULL
     type       TEXT  'adult' | 'child'
     relation   TEXT  pai|mae|filho|filha|enteado|enteada|avo|avo_f|tio|tia|outro
     birth_date DATE (opcional)
     avatar_emoji TEXT (opcional)
     created_at TIMESTAMPTZ

   SQL de criação (execute no Supabase):
   ─────────────────────────────────────
   CREATE TABLE IF NOT EXISTS public.family_composition (
     id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     family_id   UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
     name        TEXT NOT NULL,
     type        TEXT NOT NULL DEFAULT 'adult' CHECK (type IN ('adult','child')),
     family_relationship TEXT NOT NULL DEFAULT 'outro',
     birth_date  DATE,
     avatar_emoji TEXT DEFAULT '👤',
     created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
   );
   ALTER TABLE public.family_composition ENABLE ROW LEVEL SECURITY;
   -- Idempotent: drop first so script can be re-run safely
DROP POLICY IF EXISTS "fmc_family_access" ON public.family_composition;
CREATE POLICY "fmc_family_access"
     ON public.family_composition FOR ALL
     USING (family_id IN (SELECT family_id FROM public.family_members WHERE user_id = auth.uid()));

   ALTER TABLE public.transactions
     ADD COLUMN IF NOT EXISTS family_member_id UUID REFERENCES public.family_composition(id);

   ALTER TABLE public.budgets
     ADD COLUMN IF NOT EXISTS family_member_id UUID REFERENCES public.family_composition(id);
═══════════════════════════════════════════════════════════════════════════ */

// ── State ──────────────────────────────────────────────────────────────────
let _fmc = {
  members: [],   // cached family_composition rows
  loaded: false,
};
// Current family context for the member form (set by openFamilyMemberForm)
let _fmcActiveFamilyId = null;

const FMC_RELATIONS = [
  // ── Adultos ──────────────────────────────────────────────────────
  { value: 'pai',      label: 'Pai',      type: 'adult' },
  { value: 'mae',      label: 'Mãe',      type: 'adult' },
  { value: 'conjuge',  label: 'Cônjuge',  type: 'adult' },
  { value: 'irmao',    label: 'Irmão',    type: 'adult' },
  { value: 'irma',     label: 'Irmã',     type: 'adult' },
  { value: 'avo',      label: 'Avô',      type: 'adult' },
  { value: 'avo_f',    label: 'Avó',      type: 'adult' },
  { value: 'tio',      label: 'Tio',      type: 'adult' },
  { value: 'tia',      label: 'Tia',      type: 'adult' },
  // ── Crianças ─────────────────────────────────────────────────────
  { value: 'filho',    label: 'Filho',    type: 'child' },
  { value: 'filha',    label: 'Filha',    type: 'child' },
  { value: 'enteado',  label: 'Enteado',  type: 'child' },
  { value: 'enteada',  label: 'Enteada',  type: 'child' },
  { value: 'neto',     label: 'Neto',     type: 'child' },
  { value: 'neta',     label: 'Neta',     type: 'child' },
  { value: 'sobrinho', label: 'Sobrinho', type: 'child' },
  { value: 'sobrinha', label: 'Sobrinha', type: 'child' },
  { value: 'sobrinho', label: 'Sobrinho',  type: 'child' },
  { value: 'sobrinha', label: 'Sobrinha',  type: 'child' },
  { value: 'neto',     label: 'Neto',      type: 'child' },
  { value: 'neta',     label: 'Neta',      type: 'child' },
  { value: 'outro',    label: 'Outro',     type: 'adult' },
];

const FMC_DEFAULT_EMOJI = { adult: '👤', child: '👶' };

/**
 * Calculate age from a birth_date (ISO string 'YYYY-MM-DD').
 * Returns null if birth_date is null/undefined.
 */
function _fmcCalcAge(birthDate) {
  if (!birthDate) return null;
  const dob = new Date(birthDate);
  if (isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age < 0 ? 0 : age;
}

// ── Load / cache ────────────────────────────────────────────────────────────
async function loadFamilyComposition(force = false) {
  if (!sb || !currentUser?.family_id) return;
  if (!force && _fmc.loaded && _fmc.members.length >= 0) return;
  try {
    const { data, error } = await famQ(
      sb.from('family_composition').select('*')
    ).order('member_type', { ascending: false }).order('name'); // adults first
    if (error) {
      // Table may not exist yet — silently ignore
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        _fmc.members = [];
        _fmc.loaded = true;
        return;
      }
      throw error;
    }
    _fmc.members = data || [];
    _fmc.loaded = true;
  } catch (e) {
    console.warn('[FMC] loadFamilyComposition:', e?.message);
    _fmc.members = [];
    _fmc.loaded = true;
  }
}

function getFamilyMembers() { return _fmc.members; }

function getFamilyMemberById(id) {
  return _fmc.members.find(m => m.id === id) || null;
}

function fmcBust() { _fmc.loaded = false; _fmc.members = []; }

// ── Populate selects ────────────────────────────────────────────────────────
function populateFamilyMemberSelect(selectId, opts = {}) {
  const el = document.getElementById(selectId);
  if (!el) return;
  const cur         = el.value;
  const placeholder = opts.placeholder || 'Família (geral)';
  const adults      = _fmc.members.filter(m => (m.member_type || m.type) === 'adult');
  const children    = _fmc.members.filter(m => (m.member_type || m.type) === 'child');

  function memberOption(m) {
    const mtype     = m.member_type || m.type;
    const mrel      = m.family_relationship || m.relation;
    const rel       = FMC_RELATIONS.find(r => r.value === mrel);
    const age       = _fmcCalcAge(m.birth_date);
    const ageSuffix = (mtype === 'child' && age !== null) ? ` (${age})` : '';
    const emoji     = m.avatar_emoji || FMC_DEFAULT_EMOJI[mtype] || '👤';
    const label     = `${emoji} ${esc(m.name)}${ageSuffix}${rel ? ' · ' + rel.label : ''}`;
    return `<option value="${m.id}">${label}</option>`;
  }

  let html = `<option value="">${esc(placeholder)}</option>`;
  if (!adults.length && !children.length) {
    html += _fmc.members.map(memberOption).join('');
  } else {
    if (adults.length)
      html += `<optgroup label="🧑 Adultos">${adults.map(memberOption).join('')}</optgroup>`;
    if (children.length)
      html += `<optgroup label="👶 Crianças">${children.map(memberOption).join('')}</optgroup>`;
  }
  el.innerHTML = html;
  if (cur && _fmc.members.find(m => m.id === cur)) el.value = cur;
}

// Refresh all member selects on the page
// ── Relationship type filter ──────────────────────────────────────────────────
// Maps relation value → display group label
const FMC_REL_GROUPS = {
  pai:      '👨 Pais',
  mae:      '👨 Pais',
  conjuge:  '💑 Cônjuges',
  irmao:    '🤝 Irmãos',
  irma:     '🤝 Irmãos',
  filho:    '👶 Filhos',
  filha:    '👶 Filhos',
  enteado:  '👶 Filhos',
  enteada:  '👶 Filhos',
  neto:     '🌱 Netos',
  neta:     '🌱 Netos',
  sobrinho: '🌱 Netos',
  sobrinha: '🌱 Netos',
  avo:      '👴 Avós',
  avo_f:    '👴 Avós',
  tio:      '🎩 Tios',
  tia:      '🎩 Tios',
  outro:    '➕ Outros',
};

/**
 * Get the unique relationship groups present in the loaded members.
 * Returns array of { group, members } sorted logically.
 */
function getFmcRelationGroups() {
  const groupMap = {};
  for (const m of _fmc.members) {
    const mrel  = m.family_relationship || m.relation || 'outro';
    const group = FMC_REL_GROUPS[mrel] || '➕ Outros';
    if (!groupMap[group]) groupMap[group] = [];
    groupMap[group].push(m);
  }
  return Object.entries(groupMap).map(([group, members]) => ({ group, members }));
}

/**
 * Populate a relationship-type <select> filter.
 * Shows distinct groups present in the loaded members.
 */
function populateRelationshipFilter(selectId, placeholder = 'Todos os membros') {
  const el = document.getElementById(selectId);
  if (!el) return;
  const cur = el.value;
  const groups = getFmcRelationGroups();
  el.innerHTML = `<option value="">${esc(placeholder)}</option>` +
    groups.map(g =>
      `<option value="${esc(g.group)}">${esc(g.group)} (${g.members.length})</option>`
    ).join('');
  if (cur) el.value = cur;
}

/**
 * Get member IDs that match a relationship group filter value.
 * If filter is empty, returns all member IDs.
 */
function getMemberIdsByRelGroup(relGroup) {
  if (!relGroup) return null; // null = no filter
  return _fmc.members
    .filter(m => {
      const mrel  = m.family_relationship || m.relation || 'outro';
      return (FMC_REL_GROUPS[mrel] || '➕ Outros') === relGroup;
    })
    .map(m => m.id);
}

// Refresh all member selects on the page

function refreshAllFamilyMemberSelects() {
  ['txFamilyMember', 'budgetFamilyMember', 'rptMember', 'dashMemberFilter'].forEach(id => {
    populateFamilyMemberSelect(id);
  });
  // Relationship filter selects
  ['rptRelGroup', 'dashRelGroup'].forEach(id => {
    populateRelationshipFilter(id);
  });
  const hasMem = _fmc.members.length > 0;

  // Show/hide dashboard filters
  const dash = document.getElementById('dashMemberFilter');
  if (dash) dash.style.display = hasMem ? '' : 'none';
  const dashRel = document.getElementById('dashRelGroup');
  if (dashRel) dashRel.style.display = hasMem ? '' : 'none';

  // Populate txMemberPicker (now a compact <select>) with family members
  const txMemberSel = document.getElementById('txMemberPicker');
  if (txMemberSel && txMemberSel.tagName === 'SELECT') {
    const curVal = txMemberSel.value;
    txMemberSel.innerHTML = '<option value="">👤 Todos</option>' +
      (_fmc.members || []).map(m =>
        `<option value="${m.user_id}">${m.display_name || m.name || m.user_id}</option>`
      ).join('');
    // Restore previous selection if still valid
    if (curVal && txMemberSel.querySelector(`option[value="${curVal}"]`)) {
      txMemberSel.value = curVal;
    }
  }
  // Show/hide the txMemberPicker wrap
  const txWrap = document.getElementById('txMemberFilterWrap');
  if (txWrap) txWrap.style.display = hasMem ? '' : 'none';

  // Render scFamilyMemberPicker in the scheduled modal (if open)
  if (typeof renderFmcMultiPicker === 'function') {
    const scPicker = document.getElementById('scFamilyMemberPicker');
    if (scPicker) {
      const scCurSel = typeof getFmcMultiPickerSelected === 'function'
        ? getFmcMultiPickerSelected('scFamilyMemberPicker') : [];
      renderFmcMultiPicker('scFamilyMemberPicker', {
        selected: scCurSel,
        placeholder: '👨‍👩‍👧 Família (geral)',
      });
    }
  }
}

// ── Summary ─────────────────────────────────────────────────────────────────
function getFamilyCompositionSummary() {
  const adults   = _fmc.members.filter(m => (m.member_type || m.type) === 'adult').length;
  const children = _fmc.members.filter(m => (m.member_type || m.type) === 'child').length;
  return { total: _fmc.members.length, adults, children };
}

// ── Settings panel — initFamilyCompositionPanel ─────────────────────────────
// ── Multi-select member picker ────────────────────────────────────────────────
function renderFmcMultiPicker(containerId, opts = {}) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const selected   = new Set(opts.selected || []);
  const placeholder = opts.placeholder || '👨‍👩‍👧 Família (geral)';
  // Register onChange callback (function name as string, called on chip toggle/clear)
  if (opts.onChange) _fmcPickerCallbacks[containerId] = opts.onChange;
  else delete _fmcPickerCallbacks[containerId];
  const adults   = _fmc.members.filter(m => (m.member_type || m.type) === 'adult');
  const children = _fmc.members.filter(m => (m.member_type || m.type) === 'child');
  function memberChip(m) {
    const mtype  = m.member_type || m.type;
    const mrel   = m.family_relationship || m.relation;
    const rel    = FMC_RELATIONS.find(r => r.value === mrel);
    const age    = _fmcCalcAge(m.birth_date);
    const ageTxt = age !== null ? ` (${age})` : '';
    const emoji  = m.avatar_emoji || FMC_DEFAULT_EMOJI[mtype] || '👤';
    const isSel  = selected.has(m.id);
    return `<button type="button" class="fmc-chip${isSel ? ' selected' : ''}"
      data-member-id="${m.id}" title="${esc(rel ? rel.label : mtype)}"
      onclick="_fmcChipToggle(this,'${containerId}')"
      >${emoji} ${esc(m.name)}${ageTxt}</button>`;
  }
  let html = `<div class="fmc-picker">`;
  const allSel = !selected.size;
  // Always render the "Família (geral)" chip so the field is always interactive
  html += `<button type="button" class="fmc-chip fmc-chip-all${allSel ? ' selected' : ''}"
    data-member-id="" onclick="_fmcChipClearAll('${containerId}')">${esc(placeholder)}</button>`;

  if (!_fmc.members.length) {
    // No members configured — show hint but keep the "geral" chip interactive
    html += `<span class="fmc-picker-hint">Nenhum membro cadastrado</span>`;
    html += '</div>';
    el.innerHTML = html;
    return;
  }
  if (adults.length)   html += `<span class="fmc-group-label">🧑 Adultos</span>` + adults.map(memberChip).join('');
  if (children.length) html += `<span class="fmc-group-label">👶 Crianças</span>` + children.map(memberChip).join('');
  html += '</div>';
  el.innerHTML = html;
}
// Map of containerId → callback function name (string, called globally after toggle)
const _fmcPickerCallbacks = {};

function _fmcChipToggle(btn, containerId) {
  if (!btn.dataset.memberId) { _fmcChipClearAll(containerId); return; }
  btn.classList.toggle('selected');
  const c = document.getElementById(containerId);
  const all = c?.querySelector('.fmc-chip-all');
  if (all) all.classList.remove('selected');
  if (!c?.querySelector('.fmc-chip:not(.fmc-chip-all).selected') && all)
    all.classList.add('selected');
  _fmcFireCallback(containerId);
}
function _fmcChipClearAll(containerId) {
  const c = document.getElementById(containerId);
  c?.querySelectorAll('.fmc-chip').forEach(x => x.classList.remove('selected'));
  const all = c?.querySelector('.fmc-chip-all');
  if (all) all.classList.add('selected');
  _fmcFireCallback(containerId);
}
function _fmcFireCallback(containerId) {
  const cb = _fmcPickerCallbacks[containerId];
  if (cb && typeof window[cb] === 'function') window[cb](true);
}
function getFmcMultiPickerSelected(containerId) {
  return Array.from(document.getElementById(containerId)
    ?.querySelectorAll('.fmc-chip:not(.fmc-chip-all).selected') || [])
    .map(c => c.dataset.memberId).filter(Boolean);
}
function setFmcMultiPickerSelected(containerId, ids = []) {
  const idSet = new Set(ids);
  document.getElementById(containerId)?.querySelectorAll('.fmc-chip').forEach(c => {
    const id = c.dataset.memberId;
    c.classList.toggle('selected', id ? idSet.has(id) : idSet.size === 0);
  });
}

async function initFamilyCompositionPanel() {
  await loadFamilyComposition(true);
  _renderFamilyCompositionPanel();
}

function _renderFamilyCompositionPanel() {
  const el = document.getElementById('familyCompositionPanel');
  if (!el) return;

  const summary = getFamilyCompositionSummary();
  const migrationNeeded = !_fmc.loaded || (_fmc.members.length === 0 && !_fmc.loaded);

  let html = `
    <!-- Summary badges -->
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:6px;padding:6px 12px;background:var(--accent-lt);border-radius:100px">
        <span style="font-size:.85rem">👥</span>
        <span style="font-size:.8rem;font-weight:700;color:var(--accent)">${summary.total} membro${summary.total !== 1 ? 's' : ''}</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;padding:6px 12px;background:var(--blue-lt,#eff6ff);border-radius:100px">
        <span style="font-size:.85rem">🧑</span>
        <span style="font-size:.8rem;font-weight:700;color:#1d4ed8">${summary.adults} adulto${summary.adults !== 1 ? 's' : ''}</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;padding:6px 12px;background:#f0fdf4;border-radius:100px">
        <span style="font-size:.85rem">👶</span>
        <span style="font-size:.8rem;font-weight:700;color:#15803d">${summary.children} criança${summary.children !== 1 ? 's' : ''}</span>
      </div>
    </div>`;

  // Migration hint if table doesn't exist
  if (!_fmc.loaded && _fmc.members.length === 0) {
    html += `<div style="padding:12px 14px;background:var(--amber-lt);border:1px solid var(--amber);border-radius:var(--r-sm);font-size:.78rem;margin-bottom:12px;line-height:1.6">
      ⚠️ Execute <code>migration_family_composition.sql</code> no Supabase para habilitar esta funcionalidade.
      <button class="btn btn-ghost btn-sm" style="margin-top:6px;display:block;font-size:.73rem"
        onclick="showFamilyCompositionMigration()">📋 Ver SQL</button>
    </div>`;
  }

  // Member list
  if (_fmc.members.length) {
    html += `<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px">`;
    for (const m of _fmc.members) {
      const mtype = m.member_type || m.type;
      const mrel  = m.family_relationship || m.relation;
      const rel   = FMC_RELATIONS.find(r => r.value === mrel);
      const emoji = m.avatar_emoji || FMC_DEFAULT_EMOJI[mtype] || '👤';
      const age   = _fmcCalcAge(m.birth_date);
      const ageTxt = age !== null ? ` (${age})` : '';
      const typeBadge = mtype === 'adult'
        ? `<span style="font-size:.65rem;background:#eff6ff;color:#1d4ed8;padding:1px 6px;border-radius:4px;font-weight:700">Adulto</span>`
        : `<span style="font-size:.65rem;background:#f0fdf4;color:#15803d;padding:1px 6px;border-radius:4px;font-weight:700">Criança</span>`;
      const userLink = m.app_user_id
        ? `<span style="font-size:.65rem;background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:4px;font-weight:700">👤 Vinculado</span>`
        : '';
      html += `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;
             background:var(--surface2);border:1px solid var(--border);border-radius:var(--r-sm)">
          <div style="width:36px;height:36px;border-radius:50%;background:var(--accent-lt);
               display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0">
            ${emoji}
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:.88rem">${esc(m.name)}${ageTxt}</div>
            <div style="font-size:.74rem;color:var(--muted);display:flex;align-items:center;gap:6px;margin-top:2px;flex-wrap:wrap">
              ${typeBadge}
              ${rel ? `<span>${esc(rel.label)}</span>` : ''}
              ${userLink}
            </div>
          </div>
          <button class="btn-icon" title="Editar" onclick="openFamilyMemberForm('${m.id}')">✏️</button>
          <button class="btn-icon" title="Excluir" style="color:var(--red)"
            onclick="deleteFamilyMember('${m.id}','${esc(m.name)}')">🗑</button>
        </div>`;
    }
    html += `</div>`;
  } else if (_fmc.loaded) {
    html += `<div style="text-align:center;padding:20px;color:var(--muted);font-size:.82rem">
      Nenhum membro cadastrado. Clique em "+ Adicionar Membro" para começar.
    </div>`;
  }

  html += `<button class="btn btn-primary btn-sm" onclick="openFamilyMemberForm()">+ Adicionar Membro</button>`;
  el.innerHTML = html;
}

// ── Member form modal ────────────────────────────────────────────────────────
async function openFamilyMemberForm(memberId = null, familyId = null) {
  // Store which family this form is for; falls back to current active family
  _fmcActiveFamilyId = familyId || famId() || null;
  const m = memberId ? getFamilyMemberById(memberId) : null;
  const title = m ? 'Editar Membro' : 'Novo Membro';

  const mtype_cur = m?.member_type || m?.type || 'adult';
  const mrel_cur  = m?.family_relationship || m?.relation || 'outro';

  // Build relation options filtered to current member type
  const relOpts = FMC_RELATIONS
    .filter(r => r.type === mtype_cur || r.value === mrel_cur)
    .map(r => `<option value="${r.value}" ${mrel_cur === r.value ? 'selected' : ''}>${esc(r.label)}</option>`)
    .join('');

  // Build user select for app_user_id association (users from same family)
  const _famUsers = typeof _fmc !== 'undefined' ? [] : [];
  let userOpts = '<option value="">— Não vinculado —</option>';
  try {
    const { data: famUsers } = await sb
      .from('app_users').select('id,name,email')
      .eq('approved', true).order('name');
    userOpts = '<option value="">— Não vinculado —</option>' +
      (famUsers || []).map(u =>
        `<option value="${u.id}" ${m?.app_user_id === u.id ? 'selected' : ''}>${esc(u.name || u.email)}</option>`
      ).join('');
  } catch(_) {}

  const modalHtml = `
    <div class="modal-overlay open" id="fmcMemberModal" style="z-index:10010">
      <div class="modal" style="max-width:420px"><div class="modal-handle"></div>
        <div class="modal-header">
          <span class="modal-title">${title}</span>
          <button class="modal-close" onclick="closeModal('fmcMemberModal')">✕</button>
        </div>
        <div class="modal-body">
          <input type="hidden" id="fmcMemberId" value="${m?.id || ''}">
          <div class="form-grid">
            <div class="form-group full">
              <label>Nome *</label>
              <input type="text" id="fmcName" value="${esc(m?.name || '')}" placeholder="Nome do membro" autofocus>
            </div>
            <div class="form-group">
              <label>Tipo *</label>
              <select id="fmcType" onchange="_fmcOnTypeChange()">
                <option value="adult" ${mtype_cur === 'adult' ? 'selected' : ''}>🧑 Adulto</option>
                <option value="child" ${mtype_cur === 'child' ? 'selected' : ''}>👶 Criança</option>
              </select>
            </div>
            <div class="form-group">
              <label>Relação *</label>
              <select id="fmcRelation">${relOpts}</select>
            </div>
            <div class="form-group full" id="fmcBirthDateGroup">
              <label>Data de Nascimento <span style="font-size:.72rem;color:var(--muted)">(opcional)</span></label>
              <input type="date" id="fmcBirthDate" value="${m?.birth_date ? m.birth_date.slice(0,10) : ''}"
                style="width:100%" max="${new Date().toISOString().slice(0,10)}">
            </div>
            <div class="form-group">
              <label>Emoji / Avatar <span style="font-size:.72rem;color:var(--muted)">(opcional)</span></label>
              <input type="text" id="fmcEmoji" value="${esc(m?.avatar_emoji || '')}"
                placeholder="👤" maxlength="4"
                style="font-size:1.4rem;text-align:center;width:60px">
            </div>
            <div class="form-group full">
              <label>Usuário do sistema <span style="font-size:.72rem;color:var(--muted)">(opcional — associa o membro a uma conta de usuário)</span></label>
              <select id="fmcAppUserId" style="width:100%">${userOpts}</select>
            </div>
          </div>
          <div id="fmcError" style="display:none;color:var(--red);font-size:.78rem;margin-top:8px"></div>
          <div style="display:flex;gap:8px;margin-top:16px">
            <button class="btn btn-primary" onclick="saveFamilyMember()">💾 Salvar</button>
            <button class="btn btn-ghost" onclick="closeModal('fmcMemberModal')">Cancelar</button>
          </div>
        </div>
      </div>
    </div>`;

  // Inject and open
  const existing = document.getElementById('fmcMemberModal');
  if (existing) existing.remove();
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  setTimeout(() => document.getElementById('fmcName')?.focus(), 100);
}

function _fmcOnTypeChange() {
  const type   = document.getElementById('fmcType')?.value;
  const relSel = document.getElementById('fmcRelation');
  if (!relSel || !type) return;

  const curValue = relSel.value;
  const curRel   = FMC_RELATIONS.find(r => r.value === curValue);

  // Rebuild options filtered to the selected type
  relSel.innerHTML = FMC_RELATIONS
    .filter(r => r.type === type)
    .map(r => `<option value="${r.value}">${r.label}</option>`)
    .join('');

  // Restore previous selection if it matches the new type, otherwise pick first
  if (curRel && curRel.type === type) {
    relSel.value = curValue;
  }
}

async function saveFamilyMember() {
  const memberId    = document.getElementById('fmcMemberId')?.value || '';
  const name        = document.getElementById('fmcName')?.value.trim();
  const member_type = document.getElementById('fmcType')?.value;
  const family_relationship = document.getElementById('fmcRelation')?.value;
  const birth_date  = document.getElementById('fmcBirthDate')?.value || null;
  const emoji       = document.getElementById('fmcEmoji')?.value.trim() || FMC_DEFAULT_EMOJI[member_type] || '👤';
  const app_user_id = document.getElementById('fmcAppUserId')?.value || null;
  const errEl       = document.getElementById('fmcError');

  if (!name) {
    if (errEl) { errEl.textContent = 'Informe o nome do membro.'; errEl.style.display = ''; }
    return;
  }
  if (errEl) errEl.style.display = 'none';

  const family_id = _fmcActiveFamilyId || famId();
  if (!family_id) {
    if (errEl) { errEl.textContent = 'Erro: família não identificada. Feche e tente novamente.'; errEl.style.display = ''; }
    return;
  }

  const record = {
    family_id,
    name,
    member_type,
    family_relationship,
    birth_date:           birth_date || null,
    avatar_emoji:         emoji,
    app_user_id:          app_user_id || null,
  };

  try {
    let error;
    if (memberId) {
      ({ error } = await sb.from('family_composition').update(record).eq('id', memberId));
    } else {
      ({ error } = await sb.from('family_composition').insert(record));
    }
    if (error) throw error;

    toast(memberId ? '✓ Membro atualizado!' : '✓ Membro adicionado!', 'success');
    closeModal('fmcMemberModal');
    await loadFamilyComposition(true);
    _renderFamilyCompositionPanel();
    refreshAllFamilyMemberSelects();
    // If opened via a family card, refresh that card too
    if (_fmcActiveFamilyId && typeof _loadAndRenderFmcForFamily === 'function') {
      await _loadAndRenderFmcForFamily(_fmcActiveFamilyId);
    }
  } catch (e) {
    if (errEl) { errEl.textContent = 'Erro: ' + (e?.message || e); errEl.style.display = ''; }
  }
}

async function deleteFamilyMember(memberId, name) {
  if (!confirm(`Excluir o membro "${name}"?\n\nTransações e orçamentos associados perderão o vínculo, mas não serão excluídos.`)) return;
  const { error } = await sb.from('family_composition').delete().eq('id', memberId);
  if (error) { toast('Erro: ' + error.message, 'error'); return; }
  toast(`✓ ${name} removido`, 'success');
  await loadFamilyComposition(true);
  _renderFamilyCompositionPanel();
  refreshAllFamilyMemberSelects();
}

// ── Migration SQL display ────────────────────────────────────────────────────
function showFamilyCompositionMigration() {
  const sql = `-- Family FinTrack: migration_family_composition.sql
-- Execute no Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.family_composition (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id           UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  member_type         TEXT NOT NULL DEFAULT 'adult'
                      CHECK (member_type IN ('adult', 'child')),
  family_relationship TEXT NOT NULL DEFAULT 'outro',
  birth_date          DATE,
  avatar_emoji        TEXT DEFAULT '👤',
  app_user_id         UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_family_composition_family
  ON public.family_composition(family_id);
CREATE INDEX IF NOT EXISTS idx_family_composition_user
  ON public.family_composition(app_user_id)
  WHERE app_user_id IS NOT NULL;

-- If migrating from older version: rename columns
-- ALTER TABLE public.family_composition RENAME COLUMN type TO member_type;
-- ALTER TABLE public.family_composition RENAME COLUMN relation TO family_relationship;
-- ALTER TABLE public.family_composition RENAME COLUMN birth_year TO birth_date;
-- ALTER TABLE public.family_composition ADD COLUMN IF NOT EXISTS
--   app_user_id UUID REFERENCES public.app_users(id) ON DELETE SET NULL;

ALTER TABLE public.family_composition ENABLE ROW LEVEL SECURITY;

-- Idempotent: drop first so script can be re-run safely
DROP POLICY IF EXISTS "fmc_family_access" ON public.family_composition;
CREATE POLICY "fmc_family_access"
  ON public.family_composition FOR ALL
  USING (
    family_id IN (
      SELECT fm.family_id FROM public.family_members fm
      JOIN public.app_users au ON au.id = fm.user_id
      WHERE au.email = (auth.jwt() ->> 'email')
    )
  );

-- Add family_member_id to transactions
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS family_member_id UUID
  REFERENCES public.family_composition(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_family_member
  ON public.transactions(family_member_id)
  WHERE family_member_id IS NOT NULL;

-- Add family_member_id to budgets
ALTER TABLE public.budgets
  ADD COLUMN IF NOT EXISTS family_member_id UUID
  REFERENCES public.family_composition(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_budgets_family_member
  ON public.budgets(family_member_id)
  WHERE family_member_id IS NOT NULL;

-- Multi-member array support for transactions
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS family_member_ids UUID[] DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_transactions_family_member_ids
  ON public.transactions USING GIN (family_member_ids);

-- Member attribution on scheduled transactions
ALTER TABLE public.scheduled_transactions
  ADD COLUMN IF NOT EXISTS family_member_id UUID
  REFERENCES public.family_composition(id) ON DELETE SET NULL;
ALTER TABLE public.scheduled_transactions
  ADD COLUMN IF NOT EXISTS family_member_ids UUID[] DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_scheduled_tx_family_member
  ON public.scheduled_transactions(family_member_id)
  WHERE family_member_id IS NOT NULL;`;

  // Show in a simple overlay
  const existing = document.getElementById('fmcMigrationModal');
  if (existing) existing.remove();
  const html = `
    <div class="modal-overlay open" id="fmcMigrationModal" style="z-index:10010">
      <div class="modal" style="max-width:680px"><div class="modal-handle"></div>
        <div class="modal-header">
          <span class="modal-title">📋 SQL: migration_family_composition.sql</span>
          <button class="modal-close" onclick="closeModal('fmcMigrationModal')">✕</button>
        </div>
        <div class="modal-body">
          <p style="font-size:.82rem;color:var(--muted);margin-bottom:12px">
            Execute este SQL no <strong>Editor SQL do Supabase</strong> para habilitar a gestão de membros da família.
          </p>
          <pre style="font-size:.72rem;background:var(--bg2);padding:16px;border-radius:var(--r-sm);
               overflow-x:auto;max-height:420px;overflow-y:auto;white-space:pre-wrap;
               word-break:break-all;border:1px solid var(--border)">${sql.trim()}</pre>
          <div style="display:flex;gap:8px;margin-top:14px">
            <button class="btn btn-primary btn-sm"
              onclick="navigator.clipboard.writeText(document.getElementById('fmcMigrationModal').querySelector('pre').textContent).then(()=>toast('SQL copiado!','success'))">
              📋 Copiar SQL
            </button>
            <button class="btn btn-ghost btn-sm" onclick="closeModal('fmcMigrationModal')">Fechar</button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

// ── First-login family creation flow ────────────────────────────────────────
/**
 * Called by bootApp when currentUser has no family_id.
 * Shows a blocking overlay that guides user through creating their family.
 * Prevents access to the app until a family exists.
 */
async function enforceFirstLoginFamilyCreation() {
  // Launch the setup wizard directly — family creation is step 1 of the wizard.
  // The wizard detects currentUser.family_id === null and creates the family
  // as part of _wzRunSetup() instead of just renaming an existing one.
  if (typeof openWizardForNewUser === 'function') {
    await openWizardForNewUser();
  }
}

async function createFirstFamily() {
  const name  = document.getElementById('firstFamilyName')?.value.trim();
  const desc  = document.getElementById('firstFamilyDesc')?.value.trim();
  const btn   = document.getElementById('firstFamilyBtn');
  const errEl = document.getElementById('firstFamilyError');

  if (!name) {
    if (errEl) { errEl.textContent = 'Informe o nome da família.'; errEl.style.display = ''; }
    return;
  }
  if (errEl) errEl.style.display = 'none';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Criando…'; }

  try {
    // Use the same RPC that admin uses for family creation
    const { data: rpcData, error: rpcErr } = await sb.rpc('create_family_with_owner', {
      p_name:        name,
      p_description: desc || null,
    });

    if (rpcErr) {
      // Fallback: direct insert if RPC not available
      const { data: fam, error: famErr } = await sb.from('families')
        .insert({ name, description: desc || null }).select('id').single();
      if (famErr) throw famErr;

      const famId_new = fam.id;
      // Add to family_members as owner
      await sb.from('family_members').insert({
        user_id:   currentUser.id,
        family_id: famId_new,
        role:      'owner',
      });
      // Update app_users.family_id
      await sb.from('app_users').update({
        family_id:           famId_new,
        preferred_family_id: famId_new,
      }).eq('id', currentUser.id);

      currentUser.family_id = famId_new;
      currentUser.families  = [{ id: famId_new, name, role: 'owner' }];
    } else {
      // RPC succeeded — reload user context to pick up new family
      await _loadCurrentUserContext();
    }

    // Remove blocking overlay
    document.getElementById('firstFamilyOverlay')?.remove();

    toast(`✓ Família "${name}" criada! Você é o Owner.`, 'success');

    // Continue with normal boot
    await bootApp();

    // Offer wizard after a short delay
    setTimeout(() => {
      if (typeof _offerFamilyWizard === 'function') {
        _offerFamilyWizard(name, currentUser.family_id);
      }
    }, 1000);

  } catch (e) {
    if (errEl) { errEl.textContent = 'Erro: ' + (e?.message || e); errEl.style.display = ''; }
    if (btn) { btn.disabled = false; btn.textContent = '🏠 Criar minha família'; }
  }
}

// ── Per-family panel (used inside family cards in userAdminModal) ────────────

/**
 * Load family composition for a specific family_id and render into
 * the #fmcList-{familyId} and #fmcBadge-{familyId} elements inside the family card.
 */
async function _loadAndRenderFmcForFamily(familyId, containerId = null) {
  // containerId: optional override (e.g. 'mfmFmcList' for the family mgmt modal)
  // Falls back to the admin panel element pattern fmcList-{familyId}
  const listEl  = containerId
    ? document.getElementById(containerId)
    : document.getElementById(`fmcList-${familyId}`);
  const badgeEl = document.getElementById(`fmcBadge-${familyId}`);
  if (!listEl) return;

  try {
    const { data, error } = await sb
      .from('family_composition')
      .select('*')
      .eq('family_id', familyId)
      .order('member_type', { ascending: false })
      .order('name');

    if (error) {
      const isNoTable = error.code === '42P01' || error.message?.includes('does not exist');
      const isBadColumn = error.code === '42703' || error.message?.includes('column') || error.message?.includes('does not exist');
      if (isNoTable) {
        listEl.innerHTML = `<div style="font-size:.75rem;color:var(--amber,#b45309);padding:8px 10px;
            background:var(--amber-lt);border:1px solid var(--amber);border-radius:6px">
          ⚠️ Execute <code>migration_family_composition.sql</code> no Supabase para habilitar.
          <button class="btn btn-ghost btn-sm" style="font-size:.7rem;margin-top:4px;display:block"
            onclick="showFamilyCompositionMigration()">📋 Ver SQL</button>
        </div>`;
        if (badgeEl) badgeEl.textContent = '— sem tabela';
        return;
      }
      // Other DB errors: log and show generic message (don't show migration hint)
      console.error('[FMC] loadFamily error:', error.code, error.message);
      listEl.innerHTML = `<div style="font-size:.75rem;color:var(--red);padding:6px 10px">
        Erro ao carregar membros: ${(error.message || '').split('(')[0].trim()}
      </div>`;
      if (badgeEl) badgeEl.textContent = '— erro';
      return;
    }

    const members = data || [];
    const adults   = members.filter(m => m.type === 'adult').length;
    const children = members.filter(m => m.type === 'child').length;

    if (badgeEl) {
      badgeEl.textContent = members.length
        ? `${members.length} membro${members.length !== 1 ? 's' : ''} · ${adults} adulto${adults !== 1 ? 's' : ''} · ${children} criança${children !== 1 ? 's' : ''}`
        : '— nenhum membro';
    }

    if (!members.length) {
      listEl.innerHTML = `<div style="font-size:.78rem;color:var(--muted);text-align:center;
          padding:10px 0;font-style:italic">
        Nenhum membro cadastrado. Clique em "+ Membro" para adicionar.
      </div>`;
      return;
    }

    listEl.innerHTML = members.map(m => {
      const mtype     = m.member_type || m.type;
      const mrel      = m.family_relationship || m.relation;
      const rel       = FMC_RELATIONS.find(r => r.value === mrel);
      const emoji     = m.avatar_emoji || FMC_DEFAULT_EMOJI[mtype] || '👤';
      const typeColor = mtype === 'adult' ? '#1d4ed8' : '#15803d';
      const typeBg    = mtype === 'adult' ? '#eff6ff' : '#f0fdf4';
      const typeLabel = mtype === 'adult' ? 'Adulto' : 'Criança';
      const age       = _fmcCalcAge(m.birth_date);
      const ageDisplay = age !== null ? ` (${age})` : '';
      const userBadge = m.app_user_id
        ? `<span style="font-size:.62rem;background:#fef3c7;color:#92400e;padding:1px 5px;border-radius:3px;font-weight:700">👤 Vinculado</span>`
        : '';
      return `
        <div style="display:flex;align-items:center;gap:8px;padding:7px 10px;
             background:var(--surface2);border:1px solid var(--border);border-radius:8px">
          <div style="width:30px;height:30px;border-radius:50%;background:var(--accent-lt);
               display:flex;align-items:center;justify-content:center;font-size:.95rem;flex-shrink:0">
            ${emoji}
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${esc(m.name)}${ageDisplay}
            </div>
            <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:2px">
              <span style="font-size:.65rem;font-weight:700;padding:1px 5px;border-radius:3px;
                background:${typeBg};color:${typeColor}">${typeLabel}</span>
              ${rel ? `<span style="font-size:.7rem;color:var(--muted)">${esc(rel.label)}</span>` : ''}
              ${userBadge}
            </div>
          </div>
          <button class="btn-icon" title="Editar"
            onclick="openFamilyMemberFormForFamily('${familyId}','${m.id}')">✏️</button>
          <button class="btn-icon" title="Excluir" style="color:var(--red)"
            onclick="deleteFamilyMemberFromFamily('${familyId}','${m.id}','${esc(m.name).replace(/'/g,"\\'")}')">🗑</button>
        </div>`;
    }).join('');

    // Also update the global _fmc cache if this is the current user's active family
    if (familyId === currentUser?.family_id) {
      _fmc.members = members;
      _fmc.loaded  = true;
      refreshAllFamilyMemberSelects();
    }
  } catch (e) {
    if (listEl) listEl.innerHTML = `<div style="color:var(--red);font-size:.76rem;padding:6px">
      Erro ao carregar: ${esc(e?.message || e)}</div>`;
  }
}

/**
 * Open the member form tied to a specific family card.
 * familyId is passed explicitly so this works for any family (not just the active one).
 */
async function openFamilyMemberFormForFamily(familyId, memberId = null) {
  // Pass familyId directly — no post-render patching needed
  await openFamilyMemberForm(memberId, familyId);
  // _fmcActiveFamilyId is now set inside openFamilyMemberForm
  // saveFamilyMember() will use it automatically
  // After save, _loadAndRenderFmcForFamily(familyId) is called to refresh the card
  // Store familyId for the after-save refresh
  _fmcActiveFamilyId = familyId;
}

async function saveFamilyMemberForFamily(familyId) {
  const memberId            = document.getElementById('fmcMemberId')?.value || '';
  const name                = document.getElementById('fmcName')?.value.trim();
  const member_type         = document.getElementById('fmcType')?.value;
  const family_relationship = document.getElementById('fmcRelation')?.value;
  const birth_date          = document.getElementById('fmcBirthDate')?.value || null;
  const emoji               = document.getElementById('fmcEmoji')?.value.trim() || FMC_DEFAULT_EMOJI[member_type] || '👤';
  const app_user_id         = document.getElementById('fmcAppUserId')?.value || null;
  const errEl               = document.getElementById('fmcError');

  if (!name) {
    if (errEl) { errEl.textContent = 'Informe o nome do membro.'; errEl.style.display = ''; }
    return;
  }
  if (errEl) errEl.style.display = 'none';

  const record = {
    family_id:            familyId,
    name,
    member_type,
    family_relationship,
    birth_date:           birth_date || null,
    avatar_emoji:         emoji,
    app_user_id:          app_user_id || null,
  };

  try {
    let error;
    if (memberId) {
      ({ error } = await sb.from('family_composition').update(record).eq('id', memberId));
    } else {
      ({ error } = await sb.from('family_composition').insert(record));
    }
    if (error) throw error;

    toast(memberId ? '✓ Membro atualizado!' : '✓ Membro adicionado!', 'success');
    closeModal('fmcMemberModal');

    // Refresh: admin panel card section
    await _loadAndRenderFmcForFamily(familyId);

    // Refresh: myFamilyMgmtModal section (if open)
    const mfmList = document.getElementById('mfmFmcList');
    if (mfmList && document.getElementById('myFamilyMgmtModal')?.classList.contains('open')) {
      await _loadAndRenderFmcForFamily(familyId, 'mfmFmcList');
    }

    // If active family, also bust global cache and refresh selects
    if (familyId === currentUser?.family_id) {
      await loadFamilyComposition(true);
      refreshAllFamilyMemberSelects();
    }
  } catch (e) {
    if (errEl) { errEl.textContent = 'Erro: ' + (e?.message || e); errEl.style.display = ''; }
  }
}

async function deleteFamilyMemberFromFamily(familyId, memberId, name) {
  if (!confirm(`Excluir o membro "${name}"?\n\nTransações e orçamentos associados perderão o vínculo, mas não serão excluídos.`)) return;
  const { error } = await sb.from('family_composition').delete().eq('id', memberId);
  if (error) { toast('Erro: ' + error.message, 'error'); return; }
  toast(`✓ ${name} removido`, 'success');
  await _loadAndRenderFmcForFamily(familyId);
  // Refresh modal section too
  const _mfmL = document.getElementById('mfmFmcList');
  if (_mfmL && document.getElementById('myFamilyMgmtModal')?.classList.contains('open')) {
    await _loadAndRenderFmcForFamily(familyId, 'mfmFmcList');
  }
  if (familyId === currentUser?.family_id) {
    await loadFamilyComposition(true);
    refreshAllFamilyMemberSelects();
  }
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
