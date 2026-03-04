let currentUser = null;  // { id, email, name, role, family_id, can_*, must_change_pwd }

// Returns a Supabase query with family_id filter applied (if user has a family)
// Admin with no family_id sees ALL data (superadmin mode)
function famQ(query) {
  if (currentUser?.family_id) return query.eq('family_id', currentUser.family_id);
  return query; // admin without family = see everything
}

// Returns the family_id to inject on inserts (null for admin without family)
function famId() {
  return currentUser?.family_id || null;
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
    if (typeof setAppLogo==='function') setAppLogo(getAppSetting ? (getAppSetting('app_logo_url','')||APP_LOGO_URL) : APP_LOGO_URL); else if (img) img.src = (APP_LOGO_URL||DEFAULT_LOGO_URL);
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
    const hash = await sha256(password);
    // First check if user exists at all
    const { data: anyUser, error: anyErr } = await sb.from('app_users')
      .select('id,email,active,approved,password_hash,role,must_change_pwd,name,family_id,can_view,can_create,can_edit,can_delete,can_export,can_import,can_admin,last_login,created_at')
      .eq('email', email).limit(1);
    if (anyErr) throw anyErr;

    if (!anyUser?.length) { showLoginErr('E-mail ou senha incorretos.'); return; }
    const user = anyUser[0];

    // Check password first
    if (user.password_hash !== hash && user.password_hash !== 'placeholder_will_be_set_on_first_login') {
      showLoginErr('E-mail ou senha incorretos.'); return;
    }

    // Check approval status
    if (!user.approved) {
      // User registered but not approved yet
      document.getElementById('loginFormArea').style.display = 'none';
      document.getElementById('pendingApprovalArea').style.display = '';
      btn.disabled = false; btn.textContent = 'Entrar';
      return;
    }

    // Check if active
    if (!user.active) {
      showLoginErr('Conta desativada. Contate o administrador.'); return;
    }

    const users = [user];
    if (!users?.length) { showLoginErr('E-mail ou senha incorretos.'); return; }

    // Success — set session
    currentUser = user;
    // Handle "Remember me"
    const rememberMe = document.getElementById('rememberMe')?.checked;
    if (rememberMe) {
      _saveRememberedCredentials(email, document.getElementById('loginPassword').value);
    } else {
      _clearRememberedCredentials();
    }
    await sb.from('app_users').update({ last_login: new Date().toISOString() }).eq('id', user.id);
    // Save session token
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b=>b.toString(16).padStart(2,'0')).join('');
    const expires = new Date(Date.now() + 30*24*60*60*1000).toISOString();
    await sb.from('app_sessions').insert({ user_id: user.id, token, expires_at: expires });
    localStorage.setItem('ft_session_token', token);
    localStorage.setItem('ft_user_id', user.id);

    if (user.must_change_pwd) {
      // Show password change form
      document.getElementById('loginFormArea').style.display = 'none';
      document.getElementById('changePwdArea').style.display = '';
    } else {
      onLoginSuccess();
    }
  } catch(e) {
    showLoginErr('Erro: ' + e.message);
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
    const hash = await sha256(p1);
    await sb.from('app_users').update({ password_hash: hash, must_change_pwd: false }).eq('id', currentUser.id);
    currentUser.must_change_pwd = false;
    onLoginSuccess();
  } catch(e) { errEl.textContent = 'Erro: ' + e.message; errEl.style.display=''; }
}

// ── Change my own password (from settings) ──
async function showChangeMyPwd() {
  const p1 = prompt('Nova senha (mínimo 8 caracteres):');
  if (!p1 || p1.length < 8) { if(p1 !== null) toast('Senha muito curta (mín. 8 chars)','error'); return; }
  const p2 = prompt('Confirme a nova senha:');
  if (p1 !== p2) { toast('Senhas não coincidem','error'); return; }
  try {
    const hash = await sha256(p1);
    await sb.from('app_users').update({ password_hash: hash }).eq('id', currentUser.id);
    toast('✓ Senha alterada com sucesso!','success');
  } catch(e) { toast('Erro: '+e.message,'error'); }
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
    const roleLabel = currentUser.role==='admin'?'Administrador':currentUser.role==='viewer'?'Visualizador':'Usuário';
    const famLabel  = currentUser.family_id ? '' : (currentUser.role==='admin' ? ' · Admin global' : '');
    emailEl.textContent = currentUser.email + ' · ' + roleLabel + famLabel;
  }

  // Show admin sections
  if (currentUser.role === 'admin') {
    document.getElementById('userMgmtSection')?.style && (document.getElementById('userMgmtSection').style.display = '');
    const sub = document.getElementById('userMgmtSub');
    if (sub) sub.textContent = 'Controle de acesso · Perfil: Admin';
  }


  // Admin-only nav items
  const auditNav = document.getElementById('auditNav');
  const settingsNav = document.getElementById('settingsNav');
  if (auditNav) auditNav.style.display = (currentUser.role === 'admin') ? '' : 'none';
  if (settingsNav) settingsNav.style.display = (currentUser.role === 'admin') ? '' : 'none';

  // Topbar icon shortcuts
  const topAuditBtn = document.getElementById('topAuditBtn');
  const topSettingsBtn = document.getElementById('topSettingsBtn');
  if (topAuditBtn) topAuditBtn.style.display = (currentUser.role === 'admin') ? '' : 'none';
  if (topSettingsBtn) topSettingsBtn.style.display = (currentUser.role === 'admin') ? '' : 'none';

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
if (!(p.role==='admin' || p.can_admin)) {
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
  const token = localStorage.getItem('ft_session_token');
  if (token) {
    try { await sb.from('app_sessions').delete().eq('token', token); } catch(e) {}
    localStorage.removeItem('ft_session_token');
    localStorage.removeItem('ft_user_id');
  }
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
    const sessionToken = localStorage.getItem('ft_session_token');
    const userId  = localStorage.getItem('ft_user_id');
    const rememberMe = localStorage.getItem('ft_remember_me');
    localStorage.clear();
    // Restore essential keys
    if (sbUrl)        localStorage.setItem('sb_url', sbUrl);
    if (sbKey)        localStorage.setItem('sb_key', sbKey);
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
  const token = localStorage.getItem('ft_session_token');
  if (!token || !sb) return false;
  try {
    const { data: sessions } = await sb.from('app_sessions')
      .select('*, app_users(*)')
      .eq('token', token)
      .gt('expires_at', new Date().toISOString())
      .limit(1);
    if (!sessions?.length) return false;
    currentUser = sessions[0].app_users;
    if (!currentUser?.active) return false;
    return true;
  } catch { return false; }
}

// ── Check if multi-user is enabled (app_users table exists) ──
async function isMultiUserEnabled() {
  try {
    const { error } = await sb.from('app_users').select('id').limit(1);
    if (error) {
      console.warn('app_users not found:', error.message);
      return false;
    }
    return true;
  } catch { return false; }
}

// ── Show / hide register form ──
function showRegisterForm() {
  document.getElementById('loginFormArea').style.display = 'none';
  document.getElementById('registerFormArea').style.display = '';
  document.getElementById('pendingApprovalArea').style.display = 'none';
  setTimeout(() => document.getElementById('regName')?.focus(), 100);
}
function showLoginFormArea() {
  document.getElementById('loginFormArea').style.display = '';
  document.getElementById('registerFormArea').style.display = 'none';
  document.getElementById('pendingApprovalArea').style.display = 'none';
  document.getElementById('changePwdArea').style.display = 'none';
  document.getElementById('loginError').style.display = 'none';
  document.getElementById('regError').style.display = 'none';
  setTimeout(() => document.getElementById('loginEmail')?.focus(), 100);
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
    // Check if email already exists
    const { data: exist } = await sb.from('app_users').select('id,active,approved').eq('email', email).limit(1);
    if (exist?.length) {
      const u = exist[0];
      if (!u.approved) {
        // Already registered, still pending
        document.getElementById('registerFormArea').style.display = 'none';
        document.getElementById('pendingApprovalArea').style.display = '';
        return;
      }
      errEl.textContent = 'E-mail já cadastrado. Faça login.';
      errEl.style.display = '';
      return;
    }

    const hash = await sha256(pwd);
    const { error } = await sb.from('app_users').insert({
      email, name,
      password_hash: hash,
      role: 'user',
      active: false,      // admin must activate
      approved: false,    // admin must approve
      must_change_pwd: false,
      can_view: true, can_create: true, can_edit: true,
      can_delete: false, can_export: true, can_import: false, can_admin: false
    });
    if (error) throw error;

    // Show pending screen
    document.getElementById('registerFormArea').style.display = 'none';
    document.getElementById('pendingApprovalArea').style.display = '';
  } catch(e) {
    errEl.textContent = 'Erro: ' + e.message;
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
  if (currentUser?.role !== 'admin') { toast('Acesso restrito a administradores','error'); return; }
  await loadFamiliesList();
  await loadUsersList();
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
            <span class="badge ${u.role==='admin'?'badge-amber':'badge-muted'}" style="font-size:.7rem">${u.role}</span>
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
      <td><span class="badge badge-green" style="font-size:.7rem">${u.role==='admin'?'Admin':u.role==='viewer'?'Viewer':'Usuário'}</span></td>
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
    can_admin:  role === 'admin',
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
  if (!confirm(`Aprovar acesso de ${userName}?`)) return;
  const { error } = await sb.from('app_users').update({
    active: true, approved: true
  }).eq('id', userId);
  if (error) { toast('Erro: '+error.message,'error'); return; }
  toast(`✓ ${userName} aprovado! Já pode fazer login.`,'success');
  await loadUsersList();
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
  const newPwd = prompt(`Nova senha para ${userName} (mín. 8 chars):`);
  if (!newPwd || newPwd.length < 8) { if(newPwd!==null) toast('Senha muito curta','error'); return; }
  const hash = await sha256(newPwd);
  const { error } = await sb.from('app_users').update({ password_hash: hash, must_change_pwd: true }).eq('id', userId);
  if (error) { toast('Erro: '+error.message,'error'); return; }
  toast(`✓ Senha de ${userName} redefinida. Usuário deve trocar no próximo login.`,'success');
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
