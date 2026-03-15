/* ═══════════════════════════════════════════════════════════════════════════
   FAMILY_MEMBERS_COMPOSITION.JS — Gestão de membros da família
   ─────────────────────────────────────────────────────────────────────────
   Tabela: family_composition
     id         UUID PK
     family_id  UUID FK families
     name       TEXT NOT NULL
     type       TEXT  'adult' | 'child'
     relation   TEXT  pai|mae|filho|filha|enteado|enteada|avo|avo_f|tio|tia|outro
     birth_year INTEGER (opcional)
     avatar_emoji TEXT (opcional)
     created_at TIMESTAMPTZ

   SQL de criação (execute no Supabase):
   ─────────────────────────────────────
   CREATE TABLE IF NOT EXISTS public.family_composition (
     id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     family_id   UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
     name        TEXT NOT NULL,
     type        TEXT NOT NULL DEFAULT 'adult' CHECK (type IN ('adult','child')),
     relation    TEXT NOT NULL DEFAULT 'outro',
     birth_year  INTEGER,
     avatar_emoji TEXT DEFAULT '👤',
     created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
   );
   ALTER TABLE public.family_composition ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "family_composition_family"
     ON public.family_composition FOR ALL
     USING (family_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid()));

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

const FMC_RELATIONS = [
  { value: 'pai',      label: 'Pai',      type: 'adult' },
  { value: 'mae',      label: 'Mãe',      type: 'adult' },
  { value: 'filho',    label: 'Filho',     type: 'child' },
  { value: 'filha',    label: 'Filha',     type: 'child' },
  { value: 'enteado',  label: 'Enteado',   type: 'child' },
  { value: 'enteada',  label: 'Enteada',   type: 'child' },
  { value: 'avo',      label: 'Avô',       type: 'adult' },
  { value: 'avo_f',    label: 'Avó',       type: 'adult' },
  { value: 'tio',      label: 'Tio',       type: 'adult' },
  { value: 'tia',      label: 'Tia',       type: 'adult' },
  { value: 'conjuge',  label: 'Cônjuge',   type: 'adult' },
  { value: 'irmao',    label: 'Irmão',     type: 'adult' },
  { value: 'irma',     label: 'Irmã',      type: 'adult' },
  { value: 'sobrinho', label: 'Sobrinho',  type: 'child' },
  { value: 'sobrinha', label: 'Sobrinha',  type: 'child' },
  { value: 'neto',     label: 'Neto',      type: 'child' },
  { value: 'neta',     label: 'Neta',      type: 'child' },
  { value: 'outro',    label: 'Outro',     type: 'adult' },
];

const FMC_DEFAULT_EMOJI = { adult: '👤', child: '👶' };

// ── Load / cache ────────────────────────────────────────────────────────────
async function loadFamilyComposition(force = false) {
  if (!sb || !currentUser?.family_id) return;
  if (!force && _fmc.loaded && _fmc.members.length >= 0) return;
  try {
    const { data, error } = await famQ(
      sb.from('family_composition').select('*')
    ).order('type', { ascending: false }).order('name'); // adults first
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
  const cur = el.value;
  const placeholder = opts.placeholder || 'Família (geral)';
  el.innerHTML = `<option value="">${esc(placeholder)}</option>` +
    _fmc.members.map(m => {
      const rel = FMC_RELATIONS.find(r => r.value === m.relation);
      const label = `${m.avatar_emoji || FMC_DEFAULT_EMOJI[m.type]} ${esc(m.name)}${rel ? ' · ' + rel.label : ''}`;
      return `<option value="${m.id}">${label}</option>`;
    }).join('');
  if (cur && _fmc.members.find(m => m.id === cur)) el.value = cur;
}

// Refresh all member selects on the page
function refreshAllFamilyMemberSelects() {
  ['txFamilyMember', 'budgetFamilyMember', 'rptMember', 'dashMemberFilter'].forEach(id => {
    populateFamilyMemberSelect(id);
  });
}

// ── Summary ─────────────────────────────────────────────────────────────────
function getFamilyCompositionSummary() {
  const adults   = _fmc.members.filter(m => m.type === 'adult').length;
  const children = _fmc.members.filter(m => m.type === 'child').length;
  return { total: _fmc.members.length, adults, children };
}

// ── Settings panel — initFamilyCompositionPanel ─────────────────────────────
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
      const rel  = FMC_RELATIONS.find(r => r.value === m.relation);
      const emoji = m.avatar_emoji || FMC_DEFAULT_EMOJI[m.type];
      const typeBadge = m.type === 'adult'
        ? `<span style="font-size:.65rem;background:#eff6ff;color:#1d4ed8;padding:1px 6px;border-radius:4px;font-weight:700">Adulto</span>`
        : `<span style="font-size:.65rem;background:#f0fdf4;color:#15803d;padding:1px 6px;border-radius:4px;font-weight:700">Criança</span>`;
      html += `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;
             background:var(--surface2);border:1px solid var(--border);border-radius:var(--r-sm)">
          <div style="width:36px;height:36px;border-radius:50%;background:var(--accent-lt);
               display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0">
            ${emoji}
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:.88rem">${esc(m.name)}</div>
            <div style="font-size:.74rem;color:var(--muted);display:flex;align-items:center;gap:6px;margin-top:2px">
              ${typeBadge}
              ${rel ? `<span>${esc(rel.label)}</span>` : ''}
              ${m.birth_year ? `<span>· ${new Date().getFullYear() - m.birth_year} anos</span>` : ''}
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
function openFamilyMemberForm(memberId = null) {
  const m = memberId ? getFamilyMemberById(memberId) : null;
  const title = m ? 'Editar Membro' : 'Novo Membro';

  // Build relation options grouped by type
  const relOpts = FMC_RELATIONS.map(r =>
    `<option value="${r.value}" data-type="${r.type}" ${m?.relation === r.value ? 'selected' : ''}>${esc(r.label)}</option>`
  ).join('');

  const yearNow = new Date().getFullYear();
  const yearOpts = Array.from({length: 100}, (_, i) => yearNow - i)
    .map(y => `<option value="${y}" ${m?.birth_year === y ? 'selected' : ''}>${y}</option>`).join('');

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
                <option value="adult" ${(!m || m.type === 'adult') ? 'selected' : ''}>🧑 Adulto</option>
                <option value="child" ${m?.type === 'child' ? 'selected' : ''}>👶 Criança</option>
              </select>
            </div>
            <div class="form-group">
              <label>Relação *</label>
              <select id="fmcRelation">${relOpts}</select>
            </div>
            <div class="form-group">
              <label>Ano de Nascimento <span style="font-size:.72rem;color:var(--muted)">(opcional)</span></label>
              <select id="fmcBirthYear">
                <option value="">— Não informado —</option>
                ${yearOpts}
              </select>
            </div>
            <div class="form-group">
              <label>Emoji / Avatar <span style="font-size:.72rem;color:var(--muted)">(opcional)</span></label>
              <input type="text" id="fmcEmoji" value="${esc(m?.avatar_emoji || '')}"
                placeholder="👤" maxlength="4"
                style="font-size:1.4rem;text-align:center;width:60px">
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
  // Auto-suggest relation when type changes
  const type = document.getElementById('fmcType')?.value;
  const relSel = document.getElementById('fmcRelation');
  if (!relSel) return;
  // Only auto-change if currently on a mismatched type
  const cur = FMC_RELATIONS.find(r => r.value === relSel.value);
  if (cur && cur.type !== type) {
    const firstMatch = FMC_RELATIONS.find(r => r.type === type);
    if (firstMatch) relSel.value = firstMatch.value;
  }
}

async function saveFamilyMember() {
  const memberId = document.getElementById('fmcMemberId')?.value || '';
  const name     = document.getElementById('fmcName')?.value.trim();
  const type     = document.getElementById('fmcType')?.value;
  const relation = document.getElementById('fmcRelation')?.value;
  const birthYearVal = document.getElementById('fmcBirthYear')?.value;
  const emoji    = document.getElementById('fmcEmoji')?.value.trim() || FMC_DEFAULT_EMOJI[type];
  const errEl    = document.getElementById('fmcError');

  if (!name) {
    if (errEl) { errEl.textContent = 'Informe o nome do membro.'; errEl.style.display = ''; }
    return;
  }
  if (errEl) errEl.style.display = 'none';

  const record = {
    family_id:    famId(),
    name,
    type,
    relation,
    birth_year:   birthYearVal ? parseInt(birthYearVal) : null,
    avatar_emoji: emoji,
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
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id    UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  type         TEXT NOT NULL DEFAULT 'adult'
               CHECK (type IN ('adult', 'child')),
  relation     TEXT NOT NULL DEFAULT 'outro',
  birth_year   INTEGER,
  avatar_emoji TEXT DEFAULT '👤',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_family_composition_family
  ON public.family_composition(family_id);

ALTER TABLE public.family_composition ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fmc_family_access"
  ON public.family_composition FOR ALL
  USING (
    family_id IN (
      SELECT family_id FROM public.family_members
      WHERE user_id = auth.uid()
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
  const existing = document.getElementById('firstFamilyOverlay');
  if (existing) return;

  const overlay = document.createElement('div');
  overlay.id = 'firstFamilyOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:var(--surface,#fff);z-index:20000;display:flex;align-items:center;justify-content:center;padding:20px';

  overlay.innerHTML = `
    <div style="max-width:420px;width:100%;text-align:center">
      <div style="font-size:3rem;margin-bottom:12px">🏠</div>
      <h2 style="font-size:1.4rem;font-weight:700;color:var(--text);margin-bottom:8px">Bem-vindo ao Family FinTrack!</h2>
      <p style="font-size:.88rem;color:var(--muted);margin-bottom:24px;line-height:1.6">
        Para começar, crie sua família. Ela será o contexto de todas as suas operações financeiras.
      </p>

      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--r);padding:20px;text-align:left">
        <div class="form-group" style="margin-bottom:14px">
          <label style="font-weight:600">Nome da Família *</label>
          <input type="text" id="firstFamilyName" placeholder="Ex: Família Silva"
            style="width:100%;margin-top:6px" autofocus
            onkeydown="if(event.key==='Enter') createFirstFamily()">
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label style="font-weight:600">Descrição <span style="font-size:.72rem;font-weight:400;color:var(--muted)">(opcional)</span></label>
          <input type="text" id="firstFamilyDesc" placeholder="Ex: Nossa família"
            style="width:100%;margin-top:6px">
        </div>
        <div id="firstFamilyError" style="display:none;color:var(--red);font-size:.78rem;margin-top:8px"></div>
      </div>

      <button class="btn btn-primary" id="firstFamilyBtn"
        onclick="createFirstFamily()"
        style="margin-top:18px;width:100%;padding:14px;font-size:1rem;font-weight:600">
        🏠 Criar minha família
      </button>
      <p style="font-size:.72rem;color:var(--muted);margin-top:12px">
        Você será automaticamente o proprietário (Owner) desta família.
      </p>
    </div>`;

  document.body.appendChild(overlay);
  setTimeout(() => document.getElementById('firstFamilyName')?.focus(), 150);
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
async function _loadAndRenderFmcForFamily(familyId) {
  const listEl  = document.getElementById(`fmcList-${familyId}`);
  const badgeEl = document.getElementById(`fmcBadge-${familyId}`);
  if (!listEl) return;

  try {
    const { data, error } = await sb
      .from('family_composition')
      .select('*')
      .eq('family_id', familyId)
      .order('type', { ascending: false })
      .order('name');

    if (error) {
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        listEl.innerHTML = `<div style="font-size:.75rem;color:var(--amber,#b45309);padding:8px 10px;
            background:var(--amber-lt);border:1px solid var(--amber);border-radius:6px">
          ⚠️ Execute <code>migration_family_composition.sql</code> no Supabase para habilitar.
          <button class="btn btn-ghost btn-sm" style="font-size:.7rem;margin-top:4px;display:block"
            onclick="showFamilyCompositionMigration()">📋 Ver SQL</button>
        </div>`;
        if (badgeEl) badgeEl.textContent = '— sem tabela';
        return;
      }
      throw error;
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
      const rel  = FMC_RELATIONS.find(r => r.value === m.relation);
      const emoji = m.avatar_emoji || FMC_DEFAULT_EMOJI[m.type] || '👤';
      const typeColor = m.type === 'adult' ? '#1d4ed8' : '#15803d';
      const typeBg    = m.type === 'adult' ? '#eff6ff' : '#f0fdf4';
      const typeLabel = m.type === 'adult' ? 'Adulto' : 'Criança';
      const age = m.birth_year ? ` · ${new Date().getFullYear() - m.birth_year} anos` : '';
      return `
        <div style="display:flex;align-items:center;gap:8px;padding:7px 10px;
             background:var(--surface2);border:1px solid var(--border);border-radius:8px">
          <div style="width:30px;height:30px;border-radius:50%;background:var(--accent-lt);
               display:flex;align-items:center;justify-content:center;font-size:.95rem;flex-shrink:0">
            ${emoji}
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${esc(m.name)}
            </div>
            <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:2px">
              <span style="font-size:.65rem;font-weight:700;padding:1px 5px;border-radius:3px;
                background:${typeBg};color:${typeColor}">${typeLabel}</span>
              ${rel ? `<span style="font-size:.7rem;color:var(--muted)">${esc(rel.label)}${age}</span>` : ''}
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
function openFamilyMemberFormForFamily(familyId, memberId = null) {
  // Build a temporary override: swap famId() context for this call
  const _origFamId = currentUser?.family_id;
  if (currentUser) currentUser._tempFamilyId = familyId;

  // Open the standard form — it calls famId() which we patch below
  openFamilyMemberForm(memberId);

  // Patch: after modal is open, store familyId on a hidden field
  setTimeout(() => {
    let hiddenFid = document.getElementById('fmcFamilyId');
    if (!hiddenFid) {
      hiddenFid = document.createElement('input');
      hiddenFid.type = 'hidden';
      hiddenFid.id   = 'fmcFamilyId';
      document.getElementById('fmcMemberModal')?.querySelector('.modal-body')?.appendChild(hiddenFid);
    }
    hiddenFid.value = familyId;
    // Override the save callback to refresh the right card
    const saveBtn = document.getElementById('fmcMemberModal')?.querySelector('button[onclick="saveFamilyMember()"]');
    if (saveBtn) saveBtn.setAttribute('onclick', `saveFamilyMemberForFamily('${familyId}')`);
  }, 50);
}

async function saveFamilyMemberForFamily(familyId) {
  const memberId = document.getElementById('fmcMemberId')?.value || '';
  const name     = document.getElementById('fmcName')?.value.trim();
  const type     = document.getElementById('fmcType')?.value;
  const relation = document.getElementById('fmcRelation')?.value;
  const birthYearVal = document.getElementById('fmcBirthYear')?.value;
  const emoji    = document.getElementById('fmcEmoji')?.value.trim() || FMC_DEFAULT_EMOJI[type];
  const errEl    = document.getElementById('fmcError');

  if (!name) {
    if (errEl) { errEl.textContent = 'Informe o nome do membro.'; errEl.style.display = ''; }
    return;
  }
  if (errEl) errEl.style.display = 'none';

  const record = {
    family_id:    familyId,
    name,
    type,
    relation,
    birth_year:   birthYearVal ? parseInt(birthYearVal) : null,
    avatar_emoji: emoji,
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

    // Refresh the specific family card section
    await _loadAndRenderFmcForFamily(familyId);

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
  if (familyId === currentUser?.family_id) {
    await loadFamilyComposition(true);
    refreshAllFamilyMemberSelects();
  }
}
