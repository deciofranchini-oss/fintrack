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
-- family_members.user_id → app_users(id), not auth.uid() directly.
-- Use auth.jwt() ->> 'email' to get the authenticated user's email from JWT.
CREATE POLICY "fmc_family_access"
  ON public.family_composition FOR ALL
  USING (
    family_id IN (
      SELECT fm.family_id
      FROM public.family_members fm
      JOIN public.app_users au ON au.id = fm.user_id
      WHERE au.email = (auth.jwt() ->> 'email')
    )
  );t: drop first so script can be re-run safely
DROP POLICY IF EXISTS "fmc_family_access" ON public.family_composition;
-- family_members.user_id → app_users(id), not auth.uid() directly.
-- Use auth.jwt() ->> 'email' to get the authenticated user's email from the JWT.
CREATE POLICY "fmc_family_access"
  ON public.family_composition FOR ALL
  USING (
    family_id IN (
      SELECT fm.family_id
      FROM public.family_members fm
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
