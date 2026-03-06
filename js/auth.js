// Auth context for the UI and data-layer helpers.
// With RLS enabled, the app MUST use Supabase Auth (auth.uid()) as the primary identity.
// currentUser is a lightweight projection used by the UI.
let currentUser = null;  // { id, email, name, role, family_id, can_* }

// Returns a Supabase query with family_id filter applied.
// With RLS enabled, the server will also enforce access.
function famQ(query) {
  if (currentUser?.family_id) return query.eq('family_id', currentUser.family_id);
  return query;
}

// Returns the family_id to inject on inserts (null for admin without family)
function famId() {
  return currentUser?.family_id || null;
}

// ─────────────────────────────────────────────
// Supabase Auth helpers
// ─────────────────────────────────────────────

async function _loadCurrentUserContext() {
  if (!sb) throw new Error('Supabase client não inicializado.');

  const { data: uRes, error: uErr } = await sb.auth.getUser();
  if (uErr) throw uErr;
  const user = uRes?.user;
  if (!user) return null;

  // Profile (created by public.handle_new_user trigger)
  const { data: profile, error: pErr } = await sb
    .from('user_profiles')
    .select('id,email,display_name,role,active')
    .eq('id', user.id)
    .maybeSingle();
  if (pErr) throw pErr;

  // Load ALL family memberships for this user
  const { data: fm, error: fmErr } = await sb
    .from('family_members')
    .select('family_id,role,families(id,name)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });
  if (fmErr) throw fmErr;

  // Also fall back to app_users.family_id for legacy users
  const { data: appUserRow } = await sb
    .from('app_users').select('family_id').eq('email', user.email).maybeSingle();

  const famRow  = (fm && fm.length) ? fm[0] : null;
  const appRole = (profile?.role || famRow?.role || 'viewer');

  // Build the list of families available to the user
  let userFamilies = (fm || [])
    .filter(r => r.family_id)
    .map(r => ({ id: r.family_id, name: r.families?.name || r.family_id, role: r.role }));
  if (!userFamilies.length && appUserRow?.family_id) {
    userFamilies = [{ id: appUserRow.family_id, name: appUserRow.family_id, role: appRole }];
  }

  // Respect user's last active family selection
  const savedFamilyId = localStorage.getItem('ft_active_family_' + user.id);
  const activeFamId   = (savedFamilyId && userFamilies.find(f => f.id === savedFamilyId))
    ? savedFamilyId : (userFamilies[0]?.id || appUserRow?.family_id || null);

  const caps = {
    can_view:   true,
    can_create: appRole !== 'viewer',
    can_edit:   appRole !== 'viewer',
    can_delete: appRole === 'admin' || appRole === 'owner',
    can_export: true,
    can_import: appRole === 'admin' || appRole === 'owner',
    can_admin:  appRole === 'admin' || appRole === 'owner'
  };

  currentUser = {
    id:        user.id,
    email:     user.email || profile?.email || '',
    name:      profile?.display_name || user.email || 'Usuário',
    role:      appRole,
    family_id: activeFamId,
    families:  userFamilies,
    ...caps
  };

  return currentUser;
}

// ── SHA-256 helper (Web Crypto API) ──
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

// ── Show / hide login screen ──
function showLoginScreen() {
  // Hide main app
  const mainApp = document.getElementById('mainApp');
  const sidebar = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebarOverlay');
  if (mainApp) mainApp.style.display = 'none';
  if (sidebar) sidebar.style.display = 'none';
  if (sidebarOverlay) sidebarOverlay.style.display = 'none';

  const ls = document.getElementById('loginScreen');
  if (ls) {
    ls.style.display = 'flex';
    // Fix logo: use same LOGO_URL used throughout the app
    const img = document.getElementById('loginLogoImg');
    if (typeof setAppLogo==='function') {
      const logoFromCache = (typeof _appSettingsCache !== 'undefined' && _appSettingsCache && _appSettingsCache['app_logo_url']) ? _appSettingsCache['app_logo_url'] : '';
      setAppLogo(logoFromCache);
    } else if (img) {
      img.src = (APP_LOGO_URL||DEFAULT_LOGO_URL);
    }
    // Load remembered credentials
    const saved = _loadRememberedCredentials();
    if (saved) {
      const emailEl = document.getElementById('loginEmail');
      const passEl  = document.getElementById('loginPassword');
      const remEl   = document.getElementById('rememberMe');
      if (emailEl) emailEl.value = saved.email || '';
      if (passEl)  passEl.value  = saved.password || '';
      if (remEl)   remEl.checked = true;
    }
    setTimeout(() => {
      const emailEl = document.getElementById('loginEmail');
      if (emailEl && !emailEl.value) emailEl.focus();
      else document.getElementById('loginPassword')?.focus();
    }, 100);
  }
}
function _saveRememberedCredentials(email, password) {
  try {
    // Encode credentials with btoa for basic obfuscation (not encryption)
    const data = btoa(JSON.stringify({ email, password }));
    localStorage.setItem('ft_remember_me', data);
  } catch(e) {}
}
function _loadRememberedCredentials() {
  try {
    const data = localStorage.getItem('ft_remember_me');
    if (!data) return null;
    return JSON.parse(atob(data));
  } catch(e) { return null; }
}
function _clearRememberedCredentials() {
  localStorage.removeItem('ft_remember_me');
}
function hideLoginScreen() {
  const ls = document.getElementById('loginScreen');
  if (ls) ls.style.display = 'none';
  // Show main app
  const mainApp = document.getElementById('mainApp');
  const sidebar = document.getElementById('sidebar');
  if (mainApp) mainApp.style.display = '';
  if (sidebar) sidebar.style.display = '';
}
function toggleLoginPwd() {
  const inp = document.getElementById('loginPassword');
  if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
}

// ── Login ──
async function doLogin() {
  const email    = document.getElementById('loginEmail').value.trim().toLowerCase();
  const password = document.getElementById('loginPassword').value;
  const errEl    = document.getElementById('loginError');
  const btn      = document.getElementById('loginBtn');
  errEl.style.display = 'none';
  if (!email || !password) { showLoginErr('Preencha e-mail e senha.'); return; }

  btn.disabled = true; btn.textContent = 'Verificando...';
  try {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      const msg = (error.message || '').toLowerCase().includes('confirm')
        ? 'Confirme seu e-mail antes de entrar.'
        : 'E-mail ou senha incorretos.';
      showLoginErr(msg);
      return;
    }

    // Handle "Remember me"
    const rememberMe = document.getElementById('rememberMe')?.checked;
    if (rememberMe) _saveRememberedCredentials(email, password);
    else _clearRememberedCredentials();

    await _loadCurrentUserContext();

    if (!currentUser?.family_id) {
      toast('Seu usuário ainda não está vinculado a uma família. Peça ao admin para associar.', 'warning');
    }

    onLoginSuccess();
  } catch(e) {
    showLoginErr('Erro: ' + (e?.message || e));
  } finally {
    btn.disabled = false; btn.textContent = 'Entrar';
  }
}
function showLoginErr(msg) {
  const el = document.getElementById('loginError');
  if (el) { el.textContent = msg; el.style.display = ''; }
}

// ── Change password (first login) ──
async function doChangePwd() {
  const p1 = document.getElementById('newPwd1').value;
  const p2 = document.getElementById('newPwd2').value;
  const errEl = document.getElementById('changePwdError');
  errEl.style.display = 'none';
  if (p1.length < 8) { errEl.textContent = 'A senha deve ter pelo menos 8 caracteres.'; errEl.style.display=''; return; }
  if (p1 !== p2)     { errEl.textContent = 'As senhas não coincidem.'; errEl.style.display=''; return; }
  try {
    // Supabase Auth password update
    const { error } = await sb.auth.updateUser({ password: p1 });
    if (error) throw error;
    onLoginSuccess();
  } catch(e) { errEl.textContent = 'Erro: ' + (e?.message || e); errEl.style.display=''; }
}

// ── Change my own password (from settings) ──
function showChangeMyPwd() {
  document.getElementById('changeMyPwd1').value = '';
  document.getElementById('changeMyPwd2').value = '';
  document.getElementById('changeMyPwdError').style.display = 'none';
  openModal('changeMyPwdModal');
  setTimeout(() => document.getElementById('changeMyPwd1')?.focus(), 150);
}

async function doChangeMyPwd() {
  const p1    = document.getElementById('changeMyPwd1').value;
  const p2    = document.getElementById('changeMyPwd2').value;
  const errEl = document.getElementById('changeMyPwdError');
  errEl.style.display = 'none';
  if (p1.length < 8) { errEl.textContent = 'A senha deve ter pelo menos 8 caracteres.'; errEl.style.display = ''; return; }
  if (p1 !== p2)     { errEl.textContent = 'As senhas não coincidem.';                  errEl.style.display = ''; return; }
  try {
    const { error } = await sb.auth.updateUser({ password: p1 });
    if (error) throw error;
    await sb.from('app_users').update({ must_change_pwd: false }).eq('email', currentUser?.email).catch(()=>{});
    toast('✓ Senha alterada com sucesso!', 'success');
    closeModal('changeMyPwdModal');
  } catch(e) { errEl.textContent = 'Erro: ' + (e?.message || e); errEl.style.display = ''; }
}

// ── On login success ──
function onLoginSuccess() {
  hideLoginScreen();
  updateUserUI();
  // Boot app if not already booted
  if (!sb) {
    toast('Configure o Supabase primeiro','error'); return;
  }
  bootApp();
}

// ── Update UI with current user ──
function updateUserUI() {
  if (!currentUser) return;
  const nameEl  = document.getElementById('currentUserName');
  const emailEl = document.getElementById('currentUserEmail');
  if (nameEl)  nameEl.textContent  = currentUser.name || currentUser.email;
  if (emailEl) {
    const roleLabel =
      currentUser.role === 'owner' ? 'Owner' :
      currentUser.role === 'admin' ? 'Administrador' :
      currentUser.role === 'viewer' ? 'Visualizador' : 'Usuário';
    const famLabel  = currentUser.family_id ? '' : ((currentUser.role==='admin' || currentUser.role==='owner') ? ' · Admin global' : '');
    emailEl.textContent = currentUser.email + ' · ' + roleLabel + famLabel;
  }

  // Show admin sections
  if (currentUser.can_admin) {
    document.getElementById('userMgmtSection')?.style && (document.getElementById('userMgmtSection').style.display = '');
    const sub = document.getElementById('userMgmtSub');
    if (sub) sub.textContent = `Controle de acesso · Perfil: ${currentUser.role === 'owner' ? 'Owner' : 'Admin'}`;
  }


  // Admin-only nav items
  const auditNav = document.getElementById('auditNav');
  const settingsNav = document.getElementById('settingsNav');
  if (auditNav) auditNav.style.display = currentUser.can_admin ? '' : 'none';
  if (settingsNav) settingsNav.style.display = currentUser.can_admin ? '' : 'none';

  // Show/hide admin-only topbar buttons
  const _auditNav    = document.getElementById('auditNav');
  const _settingsNav = document.getElementById('settingsNav');
  const _isAdmin     = currentUser.can_admin;
  if (_auditNav)    _auditNav.style.display    = _isAdmin ? 'flex' : 'none';
  if (_settingsNav) _settingsNav.style.display = _isAdmin ? 'flex' : 'none';
  if (_isAdmin) _checkPendingApprovals();

  // Family switcher (only when user has 2+ families)
  _renderFamilySwitcher();

  // Apply permission restrictions
  applyPermissions();
}

function applyPermissions() {
  if (!currentUser) return;
  const p = currentUser;
  // Hide delete buttons for non-delete users
  if (!p.can_delete) {
    document.querySelectorAll('[data-perm="delete"]').forEach(el => el.style.display='none');
  }
  if (!p.can_create) {
    document.querySelectorAll('[data-perm="create"]').forEach(el => el.style.display='none');
  }
  if (!p.can_edit) {
    document.querySelectorAll('[data-perm="edit"]').forEach(el => el.style.display='none');
  }
  if (!p.can_import) {
    const importNav = document.querySelector('.nav-item[onclick="navigate(\'import\')"]');
    if (importNav) importNav.style.display='none';
  }

// Hide admin-only screens for non-admin
if (!(p.role==='admin' || p.role==='owner' || p.can_admin)) {
  const settingsNav = document.querySelector('.nav-item[onclick="navigate(\'settings\')"]');
  if (settingsNav) settingsNav.style.display='none';
  const auditNav = document.getElementById('auditNav');
  if (auditNav) auditNav.style.display='none';
} else {
  const auditNav = document.getElementById('auditNav');
  if (auditNav) auditNav.style.display='';
}

}

// ── Logout ──
async function doLogout() {
  try { await sb?.auth?.signOut(); } catch(e) {}
  localStorage.removeItem('ft_session_token');
  localStorage.removeItem('ft_user_id');
  currentUser = null;
  // Reset charts
  Object.values(state.chartInstances||{}).forEach(c => c?.destroy?.());
  state.chartInstances = {};
  // Close any open modals/overlays before showing login
  document.querySelectorAll('.modal-overlay, .modal-backdrop, [id$="Modal"]').forEach(el => {
    el.style.display = 'none';
  });
  // Clear login form for security
  const emailEl = document.getElementById('loginEmail');
  const passEl = document.getElementById('loginPassword');
  if (emailEl) emailEl.value = '';
  if (passEl) passEl.value = '';
  // Reload the page for a completely clean state
  window.location.reload();
}

// ── Clear App Cache ──
async function clearAppCache() {
  if (!confirm('Limpar cache do aplicativo?\n\nIsso removerá dados temporários do navegador. Suas configurações e dados do banco permanecerão intactos.')) return;
  try {
    // Preserve essential connection keys
    const sbUrl = localStorage.getItem('sb_url');
    const sbKey  = localStorage.getItem('sb_key');
    const sessionToken = localStorage.getItem('ft_session_token'); // legacy
    const userId  = localStorage.getItem('ft_user_id'); // legacy
    const rememberMe = localStorage.getItem('ft_remember_me');
    localStorage.clear();
    // Restore essential keys
    if (sbUrl)        localStorage.setItem('sb_url', sbUrl);
    if (sbKey)        localStorage.setItem('sb_key', sbKey);
    // Keep legacy tokens only if they still exist (older deployments)
    if (sessionToken) localStorage.setItem('ft_session_token', sessionToken);
    if (userId)       localStorage.setItem('ft_user_id', userId);
    if (rememberMe)   localStorage.setItem('ft_remember_me', rememberMe);
    // Clear in-memory settings cache so next load re-fetches from DB
    _appSettingsCache = null;
    // Clear Service Worker caches (PWA cache)
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    // Clear sessionStorage
    sessionStorage.clear();
    toast('✓ Cache limpo com sucesso! Recarregando...', 'success');
    setTimeout(() => window.location.reload(), 1200);
  } catch(e) {
    toast('Erro ao limpar cache: ' + e.message, 'error');
  }
}

// ── Session restore on load ──
async function tryRestoreSession() {
  if (!sb) return false;
  try {
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
    if (!data?.session) return false;
    await _loadCurrentUserContext();
    return !!currentUser;
  } catch {
    return false;
  }
}

// ── Check if multi-user is enabled (app_users table exists) ──
async function isMultiUserEnabled() {
  // Legacy app_users mode is deprecated when using RLS.
  // Keep this for backward compatibility (when RLS is off).
  try {
    const { error } = await sb.from('app_users').select('id').limit(1);
    return !error;
  } catch {
    return false;
  }
}

// ── Show / hide register form ──
function showRegisterForm() {
  document.getElementById('loginFormArea').style.display = 'none';
  document.getElementById('registerFormArea').style.display = '';
  document.getElementById('pendingApprovalArea').style.display = 'none';
  setTimeout(() => document.getElementById('regName')?.focus(), 100);
}
function showLoginFormArea() {
  ['registerFormArea','pendingApprovalArea','changePwdArea','forgotPwdArea','recoveryPwdArea']
    .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  document.getElementById('loginFormArea').style.display = '';
  document.getElementById('loginError').style.display = 'none';
  document.getElementById('regError').style.display = 'none';
  setTimeout(() => document.getElementById('loginEmail')?.focus(), 100);
}

function showForgotPwdForm() {
  ['loginFormArea','registerFormArea','pendingApprovalArea','changePwdArea','recoveryPwdArea']
    .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  document.getElementById('forgotPwdArea').style.display = '';
  document.getElementById('forgotPwdError').style.display = 'none';
  document.getElementById('forgotPwdError').textContent = '';
  setTimeout(() => document.getElementById('forgotPwdEmail')?.focus(), 100);
}

async function doForgotPwd() {
  const email = (document.getElementById('forgotPwdEmail').value || '').trim().toLowerCase();
  const errEl = document.getElementById('forgotPwdError');
  const btn   = document.getElementById('forgotPwdBtn');
  errEl.style.display = 'none'; errEl.style.color = '#dc2626';
  if (!email) { errEl.textContent = 'Informe seu e-mail.'; errEl.style.display = ''; return; }
  btn.disabled = true; btn.textContent = '⏳ Enviando...';
  try {
    const redirectTo = window.location.origin + window.location.pathname;
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
    errEl.textContent = '✅ Se este e-mail estiver cadastrado, você receberá o link de recuperação em breve. Verifique também a pasta de spam.';
    errEl.style.color = '#2a6049'; errEl.style.display = '';
    btn.textContent = '✓ Enviado';
    setTimeout(() => showLoginFormArea(), 5000);
  } catch(e) {
    errEl.textContent = 'Erro: ' + (e.message || e); errEl.style.display = '';
    btn.disabled = false; btn.textContent = 'Enviar Link de Recuperação';
  }
}

// ── Register (self-register) ──
async function doRegister() {
  const name  = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim().toLowerCase();
  const pwd   = document.getElementById('regPassword').value;
  const pwd2  = document.getElementById('regPassword2').value;
  const errEl = document.getElementById('regError');
  errEl.style.display = 'none';

  if (!name)  { errEl.textContent='Informe seu nome.';         errEl.style.display=''; return; }
  if (!email) { errEl.textContent='Informe seu e-mail.';       errEl.style.display=''; return; }
  if (pwd.length < 8) { errEl.textContent='Senha mínima: 8 caracteres.'; errEl.style.display=''; return; }
  if (pwd !== pwd2)   { errEl.textContent='Senhas não conferem.';         errEl.style.display=''; return; }

  const btn = document.getElementById('regBtn');
  btn.disabled = true; btn.textContent = 'Enviando...';
  try {
    // Supabase Auth sign-up.
    // The DB trigger public.handle_new_user should create user_profiles + family_members.
    const { error } = await sb.auth.signUp({
      email,
      password: pwd,
      options: { data: { display_name: name } }
    });
    if (error) throw error;

    // Show pending/confirmation screen
    document.getElementById('registerFormArea').style.display = 'none';
    document.getElementById('pendingApprovalArea').style.display = '';
    const pending = document.getElementById('pendingApprovalArea');
    if (pending) {
      const p = pending.querySelector('p');
      if (p) p.textContent = 'Conta criada! Verifique seu e-mail para confirmar e depois faça login.';
    }
  } catch(e) {
    errEl.textContent = 'Erro: ' + (e?.message || e);
    errEl.style.display = '';
  } finally {
    btn.disabled = false; btn.textContent = 'Enviar Solicitação';
  }
}

/* ══════════════════════════════════════════════════════════════════
   USER & FAMILY ADMINISTRATION
══════════════════════════════════════════════════════════════════ */

let _families = []; // cached families list

async function openUserAdmin() {
  if (!(currentUser?.can_admin || currentUser?.role === 'owner' || currentUser?.role === 'admin')) { toast('Acesso restrito a administradores','error'); return; }
  await loadFamiliesList();
  // When using Supabase Auth + RLS, user management should happen in Supabase Dashboard.
  // Keep the Families tab usable, and make Users tab best-effort.
  try { await loadUsersList(); } catch(e) {
    console.warn('User admin (legacy) not available:', e?.message || e);
    toast('Gestão de usuários (criar/invitar) deve ser feita no Supabase Dashboard.','info');
  }
  openModal('userAdminModal');
}

function switchUATab(tab) {
  document.getElementById('uaUsers').style.display    = tab === 'users'    ? '' : 'none';
  document.getElementById('uaFamilies').style.display = tab === 'families' ? '' : 'none';
  document.getElementById('uaTabUsers').classList.toggle('active',    tab === 'users');
  document.getElementById('uaTabFamilies').classList.toggle('active', tab === 'families');
}

// ── FAMILIES ──────────────────────────────────────────────────────

async function loadFamiliesList() {
  let families = [];
  try {
    const { data, error } = await sb.from('families').select('*').order('name');
    if (error) throw error;
    families = data || [];
  } catch(e) {
    // families table may not exist yet — show migration hint
    const el = document.getElementById('familiesList');
    if (el) el.innerHTML = `<div style="background:var(--amber-lt);border:1px solid var(--amber);border-radius:8px;padding:14px;font-size:.82rem">
      ⚠️ <strong>Tabela "families" não encontrada.</strong><br>
      Execute o script <code>migration_families.sql</code> no Supabase SQL Editor para habilitar o suporte a múltiplas famílias.
    </div>`;
    return;
  }
  _families = families;

  // Populate family select in user form
  const sel = document.getElementById('uFamilyId');
  if (sel) {
    const cur = sel.value;
    sel.innerHTML = '<option value="">— Nenhuma (admin global) —</option>' +
      _families.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('');
    if (cur) sel.value = cur;
  }

  const el = document.getElementById('familiesList');
  if (!el) return;

  if (!_families.length) {
    el.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted)">Nenhuma família cadastrada. Clique em "+ Nova Família" para começar.</div>';
    return;
  }

  // For each family show its members
  const { data: allUsers } = await sb.from('app_users').select('id,name,email,role,active,family_id').order('name');
  const usersByFamily = {};
  (allUsers || []).forEach(u => {
    const fid = u.family_id || '__none__';
    if (!usersByFamily[fid]) usersByFamily[fid] = [];
    usersByFamily[fid].push(u);
  });

  el.innerHTML = _families.map(f => {
    const members = usersByFamily[f.id] || [];
    const membersHtml = members.length
      ? members.map(u => `
          <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:.82rem;flex:1"><strong>${esc(u.name||'—')}</strong> <span style="color:var(--muted);font-size:.75rem">${esc(u.email)}</span></span>
            <span class="badge ${(u.role==='admin'||u.role==='owner')?'badge-amber':'badge-muted'}" style="font-size:.7rem">${u.role}</span>
            <button class="btn-icon" title="Remover da família" onclick="removeUserFromFamily('${u.id}','${esc(u.name||u.email)}','${esc(f.name)}')">✕</button>
          </div>`).join('')
      : '<div style="font-size:.78rem;color:var(--muted);padding:8px 0">Nenhum membro</div>';

    // Users not yet in this family (for adding)
    const available = (allUsers||[]).filter(u => !u.family_id || u.family_id !== f.id);

    return `<div class="card" style="margin-bottom:12px">
      <div class="card-header">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:1.3rem">🏠</span>
          <div>
            <div style="font-weight:700">${esc(f.name)}</div>
            ${f.description ? `<div style="font-size:.75rem;color:var(--muted)">${esc(f.description)}</div>` : ''}
          </div>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" onclick="editFamily('${f.id}')" style="padding:3px 10px;font-size:.73rem">✏️ Editar</button>
          <button class="btn btn-ghost btn-sm" onclick="deleteFamily('${f.id}','${esc(f.name)}')" style="padding:3px 10px;font-size:.73rem;color:var(--red)">🗑️</button>
        </div>
      </div>
      <div style="padding:4px 0">
        <div style="font-size:.78rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">
          Membros (${members.length})
        </div>
        ${membersHtml}
        ${available.length ? `
        <div style="display:flex;gap:8px;align-items:center;margin-top:10px">
          <select id="addMemberSel-${f.id}" style="font-size:.8rem;flex:1">
            <option value="">— Selecionar usuário —</option>
            ${available.map(u => `<option value="${u.id}">${esc(u.name||u.email)}</option>`).join('')}
          </select>
          <button class="btn btn-primary btn-sm" onclick="addUserToFamily('${f.id}')" style="font-size:.78rem;white-space:nowrap">+ Adicionar</button>
        </div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function showFamilyForm(id='') {
  document.getElementById('editFamilyId').value = id;
  document.getElementById('fName').value = '';
  document.getElementById('fDesc').value = '';
  document.getElementById('familyFormTitle').textContent = id ? 'Editar Família' : 'Nova Família';
  document.getElementById('familyFormArea').style.display = '';
  if (id) {
    const f = _families.find(x => x.id === id);
    if (f) { document.getElementById('fName').value = f.name; document.getElementById('fDesc').value = f.description||''; }
  }
}

function editFamily(id) { showFamilyForm(id); document.getElementById('familyFormArea').scrollIntoView({behavior:'smooth'}); }

async function saveFamily() {
  const id   = document.getElementById('editFamilyId').value;
  const name = document.getElementById('fName').value.trim();
  const desc = document.getElementById('fDesc').value.trim();
  if (!name) { toast('Informe o nome da família','error'); return; }
  const data = { name, description: desc||null, updated_at: new Date().toISOString() };
  let error;
  if (id) { ({ error } = await sb.from('families').update(data).eq('id', id)); }
  else    { ({ error } = await sb.from('families').insert(data)); }
  if (error) { toast('Erro: '+error.message,'error'); return; }
  toast(id ? '✓ Família atualizada!' : '✓ Família criada!','success');
  document.getElementById('familyFormArea').style.display = 'none';
  await loadFamiliesList();
}

async function deleteFamily(id, name) {
  if (!confirm(`Excluir a família "${name}"?\n\nOs usuários vinculados ficarão sem família, mas seus dados não serão apagados.`)) return;
  const { error } = await sb.from('families').delete().eq('id', id);
  if (error) { toast('Erro: '+error.message,'error'); return; }
  toast('Família removida','success');
  await loadFamiliesList();
}

async function addUserToFamily(familyId) {
  const sel = document.getElementById(`addMemberSel-${familyId}`);
  const userId = sel?.value;
  if (!userId) { toast('Selecione um usuário','error'); return; }
  const { error } = await sb.from('app_users').update({ family_id: familyId }).eq('id', userId);
  if (error) { toast('Erro: '+error.message,'error'); return; }
  toast('✓ Usuário adicionado à família','success');
  await loadFamiliesList();
}

async function removeUserFromFamily(userId, userName, familyName) {
  if (!confirm(`Remover "${userName}" da família "${familyName}"?`)) return;
  const { error } = await sb.from('app_users').update({ family_id: null }).eq('id', userId);
  if (error) { toast('Erro: '+error.message,'error'); return; }
  toast('Usuário removido da família','success');
  await loadFamiliesList();
}

// ── USERS ─────────────────────────────────────────────────────────

async function loadUsersList() {
  const { data: users, error } = await sb.from('app_users').select('*').order('created_at');
  if (error) { toast('Erro: '+error.message,'error'); return; }
  const el = document.getElementById('usersList');
  const countEl = document.getElementById('userAdminCount');
  if (countEl) countEl.textContent = `${users?.length||0} usuários cadastrados`;
  if (!users?.length) { el.innerHTML='<div style="text-align:center;padding:20px;color:var(--muted)">Nenhum usuário.</div>'; return; }
  const pendingUsers = users.filter(u => !u.approved);
  const activeUsers  = users.filter(u => u.approved);

  // Build family name lookup
  const famById = {};
  _families.forEach(f => famById[f.id] = f.name);

  let html = '';

  if (pendingUsers.length) {
    html += `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:.82rem;color:#92400e">
      ⏳ <strong>${pendingUsers.length} solicitação(ões) aguardando aprovação</strong>
    </div>`;
    html += '<div class="table-wrap" style="margin-bottom:16px"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Solicitado</th><th>Ações</th></tr></thead><tbody>';
    html += pendingUsers.map(u => `<tr style="background:#fffbeb">
      <td><strong>${esc(u.name||'—')}</strong></td>
      <td style="font-size:.82rem">${esc(u.email)}</td>
      <td style="font-size:.75rem;color:var(--muted)">${new Date(u.created_at).toLocaleDateString('pt-BR')}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-primary btn-sm" onclick="approveUser('${u.id}','${esc(u.name||u.email)}')" style="padding:3px 10px;font-size:.73rem;background:#16a34a">✅ Aprovar</button>
        <button class="btn btn-ghost btn-sm" onclick="rejectUser('${u.id}','${esc(u.name||u.email)}')" style="padding:3px 10px;font-size:.73rem;color:#dc2626">🗑 Rejeitar</button>
      </td>
    </tr>`).join('');
    html += '</tbody></table></div>';
    html += '<div style="font-weight:600;font-size:.82rem;margin-bottom:8px;color:var(--muted)">Usuários ativos</div>';
  }

  if (!activeUsers.length) {
    html += '<div style="text-align:center;padding:20px;color:var(--muted)">Nenhum usuário ativo.</div>';
  } else {
    html += '<div class="table-wrap"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Família</th><th>Status</th><th>Ações</th></tr></thead><tbody>';
    html += activeUsers.map(u => `<tr>
      <td><strong>${esc(u.name||'—')}</strong></td>
      <td style="font-size:.82rem">${esc(u.email)}</td>
      <td><span class="badge badge-green" style="font-size:.7rem">${u.role==='owner'?'Owner':u.role==='admin'?'Admin':u.role==='viewer'?'Viewer':'Usuário'}</span></td>
      <td style="font-size:.78rem;color:var(--text2)">${u.family_id ? (famById[u.family_id]||'—') : '<span style="color:var(--muted)">—</span>'}</td>
      <td><span style="font-size:.75rem;color:${u.active?'var(--green)':'var(--red)'}">● ${u.active?'Ativo':'Inativo'}</span></td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost btn-sm" onclick="editUser('${u.id}')" style="padding:3px 8px;font-size:.73rem">✏️</button>
        ${u.id !== currentUser?.id ? `<button class="btn btn-ghost btn-sm" onclick="toggleUserActive('${u.id}',${u.active})" style="padding:3px 8px;font-size:.73rem">${u.active?'🚫':'✅'}</button>` : ''}
        ${u.id !== currentUser?.id ? `<button class="btn btn-ghost btn-sm" onclick="resetUserPwd('${u.id}','${esc(u.name||u.email)}')" style="padding:3px 8px;font-size:.73rem">🔑</button>` : ''}
      </td>
    </tr>`).join('');
    html += '</tbody></table></div>';
  }
  el.innerHTML = html;
}

function showNewUserForm() {
  document.getElementById('userFormTitle').textContent = 'Novo Usuário';
  document.getElementById('editUserId').value = '';
  document.getElementById('uName').value = '';
  document.getElementById('uEmail').value = '';
  document.getElementById('uPassword').value = '';
  document.getElementById('uRole').value = 'user';
  document.getElementById('uFamilyId').value = '';
  document.getElementById('pView').checked = true;
  document.getElementById('pCreate').checked = true;
  document.getElementById('pEdit').checked = true;
  document.getElementById('pDelete').checked = false;
  document.getElementById('pExport').checked = true;
  document.getElementById('pImport').checked = false;
  document.getElementById('pwdHint').textContent = '(mín. 8 chars)';
  document.getElementById('userFormArea').style.display = '';
}

async function editUser(userId) {
  const { data: u } = await sb.from('app_users').select('*').eq('id', userId).single();
  if (!u) return;
  document.getElementById('userFormTitle').textContent = 'Editar Usuário';
  document.getElementById('editUserId').value = u.id;
  document.getElementById('uName').value = u.name||'';
  document.getElementById('uEmail').value = u.email;
  document.getElementById('uPassword').value = '';
  document.getElementById('uRole').value = u.role;
  document.getElementById('uFamilyId').value = u.family_id||'';
  document.getElementById('pView').checked = u.can_view;
  document.getElementById('pCreate').checked = u.can_create;
  document.getElementById('pEdit').checked = u.can_edit;
  document.getElementById('pDelete').checked = u.can_delete;
  document.getElementById('pExport').checked = u.can_export;
  document.getElementById('pImport').checked = u.can_import;
  document.getElementById('pwdHint').textContent = '(deixe em branco para manter)';
  document.getElementById('userFormArea').style.display = '';
}

async function saveUser() {
  const userId    = document.getElementById('editUserId').value;
  const name      = document.getElementById('uName').value.trim();
  const email     = document.getElementById('uEmail').value.trim().toLowerCase();
  const pwd       = document.getElementById('uPassword').value;
  const role      = document.getElementById('uRole').value;
  const newFamId  = document.getElementById('uFamilyId').value || null;
  if (!name || !email) { toast('Preencha nome e e-mail','error'); return; }
  if (!userId && pwd.length < 8) { toast('Senha deve ter pelo menos 8 caracteres','error'); return; }
  if (userId && pwd && pwd.length < 8) { toast('Senha deve ter pelo menos 8 caracteres','error'); return; }

  const record = {
    name, email, role,
    family_id:  newFamId,
    can_view:   document.getElementById('pView').checked,
    can_create: document.getElementById('pCreate').checked,
    can_edit:   document.getElementById('pEdit').checked,
    can_delete: document.getElementById('pDelete').checked,
    can_export: document.getElementById('pExport').checked,
    can_import: document.getElementById('pImport').checked,
    can_admin:  role === 'admin' || role === 'owner',
  };
  if (pwd) record.password_hash = await sha256(pwd);
  if (!userId) { record.must_change_pwd = false; record.active = true; record.approved = true; record.created_by = currentUser?.id; }

  try {
    let error;
    if (userId) { ({ error } = await sb.from('app_users').update(record).eq('id', userId)); }
    else        { ({ error } = await sb.from('app_users').insert(record)); }
    if (error) throw error;
    toast(userId ? '✓ Usuário atualizado!' : '✓ Usuário criado!', 'success');
    document.getElementById('userFormArea').style.display = 'none';
    await loadUsersList();
    await loadFamiliesList();
  } catch(e) { toast('Erro: '+e.message,'error'); }
}

async function approveUser(userId, userName) {
  document.getElementById('approvalUserId').value = userId;
  document.getElementById('approvalUserName').textContent = userName;
  document.getElementById('approvalFamilyId').innerHTML =
    '<option value="">— Nenhuma (admin global) —</option>' +
    _families.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('');
  document.getElementById('approvalNewFamilyName').value = '';
  document.getElementById('approvalError').style.display = 'none';
  openModal('approvalModal');
}

async function doApproveUser() {
  const userId   = document.getElementById('approvalUserId').value;
  const userName = document.getElementById('approvalUserName').textContent;
  const famSel   = document.getElementById('approvalFamilyId').value;
  const newFamNm = document.getElementById('approvalNewFamilyName').value.trim();
  const errEl    = document.getElementById('approvalError');
  errEl.style.display = 'none';
  let familyId   = famSel || null;
  let familyName = _families.find(f => f.id === famSel)?.name || null;
  if (newFamNm) {
    const { data: nf, error: nfErr } = await sb.from('families').insert({ name: newFamNm }).select('id,name').single();
    if (nfErr) { errEl.textContent = 'Erro ao criar família: ' + nfErr.message; errEl.style.display = ''; return; }
    familyId = nf.id; familyName = nf.name;
    await loadFamiliesList();
  }
  const { data: userRow, error: uErr } = await sb.from('app_users')
    .update({ active: true, approved: true, family_id: familyId })
    .eq('id', userId).select('name,email').single();
  if (uErr) { errEl.textContent = 'Erro: ' + uErr.message; errEl.style.display = ''; return; }
  await sb.from('user_profiles').update({ active: true }).eq('email', userRow.email).catch(()=>{});
  if (familyId) {
    await sb.from('family_members').upsert(
      { user_id: userId, family_id: familyId, role: 'editor' },
      { onConflict: 'user_id,family_id' }
    ).catch(()=>{});
  }
  await _sendApprovalEmail(userRow.email, userRow.name || userName, familyName);
  toast(`✓ ${userName} aprovado!${familyName ? ' Família: ' + familyName : ''}`, 'success');
  closeModal('approvalModal');
  await loadUsersList();
  _checkPendingApprovals();
}

async function _sendApprovalEmail(email, name, familyName) {
  if (!EMAILJS_CONFIG.serviceId || !EMAILJS_CONFIG.publicKey) return;
  try {
    emailjs.init(EMAILJS_CONFIG.publicKey);
    const tplId = EMAILJS_CONFIG.scheduledTemplateId || EMAILJS_CONFIG.templateId;
    const famLine = familyName ? `\n\nVocê foi vinculado à família: ${familyName}` : '\n\nSeu acesso foi liberado como administrador global.';
    await emailjs.send(EMAILJS_CONFIG.serviceId, tplId, {
      to_email:       email,
      Subject:        'FinTrack — Acesso liberado!',
      month_year:     new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
      report_content: `Olá, ${name}!\n\nSua solicitação de acesso ao JF Family FinTrack foi aprovada.${famLine}\n\nAcesse o aplicativo e faça login com o e-mail e senha que você cadastrou.\n\nBem-vindo(a)!\n\nEquipe JF Family FinTrack`,
    });
  } catch(e) { console.warn('Approval email error:', e.message); }
}

async function rejectUser(userId, userName) {
  if (!confirm(`Rejeitar e excluir solicitação de ${userName}?`)) return;
  const { error } = await sb.from('app_users').delete().eq('id', userId);
  if (error) { toast('Erro: '+error.message,'error'); return; }
  toast(`Solicitação de ${userName} removida.`,'success');
  await loadUsersList();
}

async function toggleUserActive(userId, currentActive) {
  const { error } = await sb.from('app_users').update({ active: !currentActive }).eq('id', userId);
  if (error) { toast('Erro: '+error.message,'error'); return; }
  toast(currentActive ? 'Usuário desativado' : 'Usuário ativado', 'success');
  await loadUsersList();
}

async function resetUserPwd(userId, userName) {
  document.getElementById('resetPwdUserId').value = userId;
  document.getElementById('resetPwdUserName').textContent = userName;
  document.getElementById('resetPwdNew1').value = '';
  document.getElementById('resetPwdNew2').value = '';
  document.getElementById('resetPwdError').style.display = 'none';
  openModal('resetPwdModal');
}

async function doResetUserPwd() {
  const userId   = document.getElementById('resetPwdUserId').value;
  const userName = document.getElementById('resetPwdUserName').textContent;
  const pwd1     = document.getElementById('resetPwdNew1').value;
  const pwd2     = document.getElementById('resetPwdNew2').value;
  const errEl    = document.getElementById('resetPwdError');
  errEl.style.display = 'none';
  if (pwd1.length < 8) { errEl.textContent = 'A senha deve ter pelo menos 8 caracteres.'; errEl.style.display = ''; return; }
  if (pwd1 !== pwd2)   { errEl.textContent = 'As senhas não coincidem.';                  errEl.style.display = ''; return; }
  const hash = await sha256(pwd1);
  const { error } = await sb.from('app_users').update({ password_hash: hash, must_change_pwd: true }).eq('id', userId);
  if (error) { errEl.textContent = 'Erro: ' + error.message; errEl.style.display = ''; return; }
  toast(`✓ Senha de ${userName} redefinida. Usuário deverá trocar no próximo login.`, 'success');
  closeModal('resetPwdModal');
  await loadUsersList();
}

/* ══════════════════════════════════════════════════════════════════
   INIT: Master admin password setup on first run
   The SQL inserts a placeholder hash. On first actual login,
   the correct hash is set when the user changes their password.
   We need to set the REAL hash for '35zjxx2v' on first run.
══════════════════════════════════════════════════════════════════ */
async function ensureMasterAdmin() {
  // Check if master admin has the placeholder hash — if so, set real hash
  const INITIAL_PWD = '35zjxx2v';
  const MASTER_EMAIL = 'deciofranchini@gmail.com';
  try {
    const { data: users } = await sb.from('app_users').select('id,password_hash,must_change_pwd').eq('email', MASTER_EMAIL).limit(1);
    if (!users?.length) {
      // Insert master admin
      const hash = await sha256(INITIAL_PWD);
      await sb.from('app_users').insert({
        email: MASTER_EMAIL, password_hash: hash, name: 'Décio Franchini',
        role: 'admin', must_change_pwd: true, active: true,
        can_view:true, can_create:true, can_edit:true, can_delete:true,
        can_export:true, can_import:true, can_admin:true
      });
      console.log('Master admin created');
    } else if (users[0].password_hash.length < 20) {
      // Placeholder hash — set real one
      const hash = await sha256(INITIAL_PWD);
      await sb.from('app_users').update({ password_hash: hash, must_change_pwd: true }).eq('email', MASTER_EMAIL);
    }
  } catch(e) { console.warn('ensureMasterAdmin:', e.message); }
}

tryAutoConnect();

/* ══════════════════════════════════════════════════════════════════
   AUTO-REGISTER ENGINE — Transações Programadas Automáticas
══════════════════════════════════════════════════════════════════ */


// ── Password recovery token handler (Supabase reset email callback) ──────────
async function _handleRecoveryToken() {
  // Supabase JS v2 PKCE flow: recovery token arrives as URL hash fragment
  // #access_token=...&type=recovery  OR  via onAuthStateChange PASSWORD_RECOVERY event.
  // We handle both paths here.
  const hash = window.location.hash;
  const isHashRecovery = hash.includes('type=recovery') && hash.includes('access_token');

  if (!isHashRecovery) return false;

  try {
    // Parse fragment params
    const params = Object.fromEntries(
      hash.slice(1).split('&').map(p => {
        const eq = p.indexOf('=');
        return [decodeURIComponent(p.slice(0, eq)), decodeURIComponent(p.slice(eq + 1))];
      })
    );

    // Set the session from recovery token — this authenticates the user
    const { error } = await sb.auth.setSession({
      access_token:  params.access_token,
      refresh_token: params.refresh_token || '',
    });
    if (error) throw error;

    // Clean URL so token isn't reused on refresh
    history.replaceState(null, '', window.location.pathname);

    // Show the new-password form inside the login card
    _showRecoveryPwdForm();
    return true;
  } catch(e) {
    console.warn('Recovery token error:', e.message);
    return false;
  }
}

function _showRecoveryPwdForm() {
  const ls = document.getElementById('loginScreen');
  if (ls) ls.style.display = 'flex';
  ['loginFormArea','registerFormArea','pendingApprovalArea','forgotPwdArea','changePwdArea']
    .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  const area = document.getElementById('recoveryPwdArea');
  if (area) {
    area.style.display = '';
    document.getElementById('recoveryPwdError').style.display = 'none';
    document.getElementById('recoveryPwd1').value = '';
    document.getElementById('recoveryPwd2').value = '';
  }
  setTimeout(() => document.getElementById('recoveryPwd1')?.focus(), 150);
}

async function doRecoveryPwd() {
  const p1    = document.getElementById('recoveryPwd1').value;
  const p2    = document.getElementById('recoveryPwd2').value;
  const errEl = document.getElementById('recoveryPwdError');
  const btn   = document.getElementById('recoveryPwdBtn');
  errEl.style.display = 'none';

  if (p1.length < 8) {
    errEl.textContent = 'A senha deve ter pelo menos 8 caracteres.';
    errEl.style.display = '';
    return;
  }
  if (p1 !== p2) {
    errEl.textContent = 'As senhas não coincidem.';
    errEl.style.display = '';
    return;
  }

  btn.disabled = true;
  btn.textContent = '⏳ Salvando...';

  try {
    // Update password in Supabase Auth (user is already authenticated via recovery token)
    const { error } = await sb.auth.updateUser({ password: p1 });
    if (error) throw error;

    // Clear must_change_pwd flag in app_users table
    const { data: uRes } = await sb.auth.getUser();
    if (uRes?.user?.email) {
      await sb.from('app_users')
        .update({ must_change_pwd: false })
        .eq('email', uRes.user.email)
        .catch(() => {});
    }

    // Load user context and enter the app
    await _loadCurrentUserContext();
    document.getElementById('loginScreen').style.display = 'none';
    toast('✓ Senha redefinida com sucesso! Bem-vindo(a).', 'success');
    await bootApp();
  } catch(e) {
    errEl.textContent = 'Erro ao salvar senha: ' + (e?.message || e);
    errEl.style.display = '';
    btn.disabled = false;
    btn.textContent = 'Salvar Nova Senha';
  }
}


// ── Family switcher ──────────────────────────────────────────────────────────
function _renderFamilySwitcher() {
  const container = document.getElementById('familySwitcherWrap');
  if (!container) return;
  const families = currentUser?.families || [];
  if (families.length <= 1) { container.style.display = 'none'; return; }
  container.style.display = 'flex';
  const sel = document.getElementById('familySwitcherSelect');
  if (!sel) return;
  const prev = Array.from(sel.options).map(o => o.value).join(',');
  const next = families.map(f => f.id).join(',');
  if (prev !== next) {
    sel.innerHTML = families.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('');
  }
  sel.value = currentUser.family_id || '';
}

async function switchFamily(familyId) {
  if (!familyId || familyId === currentUser?.family_id) return;
  currentUser.family_id = familyId;
  localStorage.setItem('ft_active_family_' + currentUser.id, familyId);
  const fam = (currentUser.families || []).find(f => f.id === familyId);
  toast('Família: ' + (fam?.name || familyId), 'info');
  await Promise.all([
    loadAccounts().catch(()=>{}),
    loadCategories().catch(()=>{}),
    loadPayees().catch(()=>{}),
    loadAppSettings().catch(()=>{})
  ]);
  populateSelects();
  navigate(state.currentPage || 'dashboard');
}

// ── Pending approvals badge ───────────────────────────────────────────────────
async function _checkPendingApprovals() {
  try {
    const { data } = await sb.from('app_users').select('id').eq('approved', false);
    const count = data?.length || 0;

    // ── Topbar badge on the "Gerenciar" button ──
    const btn = document.getElementById('userMgmtBadgeBtn');
    if (btn) {
      btn.querySelector('.pending-badge')?.remove();
      if (count > 0) {
        const badge = document.createElement('span');
        badge.className = 'pending-badge';
        badge.textContent = count;
        badge.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;border-radius:999px;background:var(--red);color:#fff;font-size:.65rem;font-weight:700;padding:0 4px;margin-left:4px;vertical-align:middle';
        btn.appendChild(badge);
      }
    }

    // ── Settings page alert banner ──
    const alert = document.getElementById('pendingApprovalsAlert');
    if (alert) {
      if (count > 0) {
        const txt = document.getElementById('pendingApprovalsAlertText');
        if (txt) txt.textContent = count === 1
          ? '1 solicitação aguardando aprovação'
          : `${count} solicitações aguardando aprovação`;
        alert.style.display = 'flex';
      } else {
        alert.style.display = 'none';
      }
    }
  } catch(e) {}
}
