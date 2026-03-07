// Auth context for the UI and data-layer helpers.
// With RLS enabled, the app MUST use Supabase Auth (auth.uid()) as the primary identity.
// currentUser is a lightweight projection used by the UI.
let currentUser = null;  // { id, email, name, role, family_id, can_* }

// Admin client (service_role key) — criado sob demanda, nunca exposto ao Supabase
let sbAdmin = null;

function initSbAdmin() {
  const serviceKey = localStorage.getItem('sb_service_key') || '';
  const url = localStorage.getItem('sb_url') || window.SUPABASE_URL || '';
  if (serviceKey && url && typeof supabase !== 'undefined') {
    sbAdmin = supabase.createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
  } else {
    sbAdmin = null;
  }
  return sbAdmin;
}

/* ══════════════════════════════════════════════════════════════════
   USER AVATAR — renderiza círculo com foto ou ícone por perfil
══════════════════════════════════════════════════════════════════ */

// Ícone SVG e cor por perfil
function _roleAvatarStyle(role) {
  switch (role) {
    case 'owner': return { bg: '#fef3c7', border: '#f59e0b', color: '#92400e', icon: '👑' };
    case 'admin': return { bg: '#fef9c3', border: '#eab308', color: '#713f12', icon: '🔧' };
    case 'viewer': return { bg: '#f0f9ff', border: '#38bdf8', color: '#0369a1', icon: '👁' };
    default:       return { bg: 'var(--accent-lt)', border: 'var(--accent)', color: 'var(--accent)', icon: '👤' };
  }
}

// Retorna HTML de um círculo avatar (com foto ou ícone)
function _userAvatarHtml(user, size = 32) {
  const s = size + 'px';
  const fs = Math.round(size * 0.38) + 'px';
  if (user.avatar_url) {
    return `<img src="${esc(user.avatar_url)}" alt="${esc(user.name||'')}"
      style="width:${s};height:${s};border-radius:50%;object-fit:cover;flex-shrink:0;border:2px solid var(--border)"
      onerror="this.replaceWith(_userAvatarFallback('${esc(user.role||'user')}','${esc(user.name||'')}',${size}))">`;
  }
  const style = _roleAvatarStyle(user.role);
  const initials = (user.name || user.email || '?').trim().split(/\s+/).map(w => w[0]||'').slice(0,2).join('').toUpperCase();
  return `<div style="width:${s};height:${s};border-radius:50%;background:${style.bg};border:2px solid ${style.border};
    color:${style.color};display:flex;align-items:center;justify-content:center;
    font-size:${fs};font-weight:700;flex-shrink:0;line-height:1">${initials||style.icon}</div>`;
}

// Fallback element para onerror em <img>
function _userAvatarFallback(role, name, size) {
  const div = document.createElement('div');
  const style = _roleAvatarStyle(role);
  const s = size + 'px';
  const fs = Math.round(size * 0.38) + 'px';
  const initials = (name||'?').trim().split(/\s+/).map(w=>w[0]||'').slice(0,2).join('').toUpperCase();
  div.style.cssText = `width:${s};height:${s};border-radius:50%;background:${style.bg};border:2px solid ${style.border};color:${style.color};display:flex;align-items:center;justify-content:center;font-size:${fs};font-weight:700;flex-shrink:0`;
  div.textContent = initials || style.icon;
  return div;
}

// Atualiza avatar no topbar e settings com o usuário atual
function _applyCurrentUserAvatar() {
  if (!currentUser) return;

  // --- Topbar: substituir o div .topbar-user-avatar por avatar real ---
  const topbarAvatar = document.getElementById('topbarUserAvatar');
  if (topbarAvatar) {
    const avatarEl = topbarAvatar.parentElement;
    if (avatarEl) {
      // Substituir o avatar interno
      const newHtml = _userAvatarHtml(currentUser, 28);
      const wrap = document.createElement('div');
      wrap.innerHTML = newHtml;
      topbarAvatar.replaceWith(wrap.firstChild);
    }
  }

  // --- Topbar: avatar antes do logout (btn id=topbarAvatarCircle) ---
  const logoutBtn = document.getElementById('logoutTopbarBtn');
  if (logoutBtn && !document.getElementById('topbarAvatarCircle')) {
    const avatarWrap = document.createElement('div');
    avatarWrap.id = 'topbarAvatarCircle';
    avatarWrap.style.cssText = 'display:flex;align-items:center;cursor:pointer';
    avatarWrap.title = currentUser.name || currentUser.email;
    avatarWrap.onclick = () => navigate('settings');
    avatarWrap.innerHTML = _userAvatarHtml(currentUser, 30);
    logoutBtn.before(avatarWrap);
  } else if (document.getElementById('topbarAvatarCircle')) {
    document.getElementById('topbarAvatarCircle').innerHTML = _userAvatarHtml(currentUser, 30);
  }

  // --- Settings: substituir ícone 👤 estático por avatar ---
  const settingsIcon = document.getElementById('settingsUserAvatarWrap');
  if (settingsIcon) {
    settingsIcon.innerHTML = _userAvatarHtml(currentUser, 40);
  }
}

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

  // app_users é a fonte de verdade: role, name, avatar_url, family_id
  // (user_profiles não existe neste schema — nunca lançar erro por ela)
  const { data: appUserRow } = await sb
    .from('app_users')
    .select('id, family_id, avatar_url, role, name')
    .eq('email', user.email)
    .maybeSingle();

  // family_members é opcional — ignorar erros se a tabela não existir ainda
  let fm = [];
  try {
    const { data: fmData } = await sb
      .from('family_members')
      .select('family_id,role,families(id,name)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });
    fm = fmData || [];
  } catch (_) { /* tabela opcional */ }

  // Role: app_users tem prioridade sobre family_members
  const famRow  = fm.length ? fm[0] : null;
  const appRole = appUserRow?.role || famRow?.role || 'viewer';

  // Lista de famílias disponíveis ao usuário
  let userFamilies = fm
    .filter(r => r.family_id)
    .map(r => ({ id: r.family_id, name: r.families?.name || r.family_id, role: r.role }));
  if (!userFamilies.length && appUserRow?.family_id) {
    userFamilies = [{ id: appUserRow.family_id, name: appUserRow.family_id, role: appRole }];
  }

  // Respeitar última família ativa escolhida pelo usuário
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
    id:         user.id,
    email:      user.email || '',
    name:       appUserRow?.name || user.email || 'Usuário',
    role:       appRole,
    family_id:  activeFamId,
    families:   userFamilies,
    avatar_url: appUserRow?.avatar_url || null,
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

    // Gate: check app_users approval status before entering the app
    const { data: appUser } = await sb
      .from('app_users').select('approved,active,must_change_pwd').eq('email', email).maybeSingle();

    if (appUser && !appUser.approved) {
      await sb.auth.signOut();
      showLoginErr('Sua conta ainda aguarda aprovação do administrador.');
      return;
    }
    if (appUser && !appUser.active) {
      await sb.auth.signOut();
      showLoginErr('Sua conta está inativa. Contate o administrador.');
      return;
    }

    // Show must_change_pwd screen if flagged
    if (appUser?.must_change_pwd) {
      document.getElementById('loginFormArea').style.display = 'none';
      document.getElementById('changePwdArea').style.display = '';
      return;
    }

    await _loadCurrentUserContext();

    if (!currentUser?.family_id) {
      toast('Usuário sem família vinculada. Peça ao admin para associar.', 'warning');
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

// ── Login method tab switcher ─────────────────────────────────────────────
function switchLoginTab(tab) {
  const isPassword = tab === 'password';
  document.getElementById('loginPanelPassword').style.display = isPassword ? '' : 'none';
  document.getElementById('loginPanelMagic').style.display    = isPassword ? 'none' : '';

  const tabPwd   = document.getElementById('loginTabPassword');
  const tabMagic = document.getElementById('loginTabMagic');
  const activeStyle   = 'background:linear-gradient(135deg,#1e5c42,#2a6049);color:#fff;';
  const inactiveStyle = 'background:transparent;color:#6b7280;';
  if (tabPwd)   tabPwd.style.cssText   += isPassword ? activeStyle : inactiveStyle;
  if (tabMagic) tabMagic.style.cssText += isPassword ? inactiveStyle : activeStyle;

  // Reset magic link state when switching away
  if (isPassword) {
    const sent = document.getElementById('magicLinkSent');
    const btn  = document.getElementById('magicLinkBtn');
    if (sent) sent.style.display = 'none';
    if (btn)  { btn.style.display = ''; btn.disabled = false; btn.textContent = '✉️ Enviar Link de Acesso'; }
  }
  document.getElementById('loginError').style.display = 'none';
}

// ── Passwordless / Magic Link login ──────────────────────────────────────
async function doMagicLink() {
  const email = (document.getElementById('magicEmail').value || '').trim().toLowerCase();
  const errEl = document.getElementById('loginError');
  const btn   = document.getElementById('magicLinkBtn');
  errEl.style.display = 'none';

  if (!email) {
    errEl.textContent = 'Informe seu e-mail.';
    errEl.style.display = '';
    return;
  }

  btn.disabled = true;
  btn.textContent = '⏳ Enviando...';

  try {
    // Verify the e-mail exists AND is approved in app_users before sending
    // the OTP — avoids leaking info about unknown e-mails via timing, and
    // prevents unapproved users from ever receiving an access link.
    const { data: appUser } = await sb
      .from('app_users')
      .select('approved,active')
      .eq('email', email)
      .maybeSingle();

    if (!appUser) {
      // Neutral message — do not confirm whether the e-mail is registered
      _showMagicLinkSent();
      return;
    }
    if (!appUser.approved) {
      errEl.textContent = 'Sua conta ainda aguarda aprovação do administrador.';
      errEl.style.display = '';
      btn.disabled = false;
      btn.textContent = '✉️ Enviar Link de Acesso';
      return;
    }
    if (!appUser.active) {
      errEl.textContent = 'Sua conta está inativa. Contate o administrador.';
      errEl.style.display = '';
      btn.disabled = false;
      btn.textContent = '✉️ Enviar Link de Acesso';
      return;
    }

    // Send the magic link via Supabase OTP
    const redirectTo = window.location.origin + window.location.pathname;
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
    });
    if (error) throw error;

    _showMagicLinkSent();

  } catch(e) {
    errEl.textContent = 'Erro: ' + (e.message || e);
    errEl.style.display = '';
    btn.disabled = false;
    btn.textContent = '✉️ Enviar Link de Acesso';
  }
}

function _showMagicLinkSent() {
  const btn  = document.getElementById('magicLinkBtn');
  const sent = document.getElementById('magicLinkSent');
  if (btn)  { btn.style.display = 'none'; }
  if (sent) { sent.style.display = ''; }
  // Wire resend button to reset state and re-enable
  const resend = document.getElementById('magicResendBtn');
  if (resend) {
    resend.onclick = () => {
      if (sent) sent.style.display = 'none';
      if (btn)  { btn.style.display = ''; btn.disabled = false; btn.textContent = '✉️ Enviar Link de Acesso'; }
    };
  }
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
    // Sync password_hash + clear must_change_pwd in app_users
    const { data: uRes } = await sb.auth.getUser();
    if (uRes?.user?.email) {
      const newHash = await sha256(p1);
      await sb.from('app_users')
        .update({ password_hash: newHash, must_change_pwd: false })
        .eq('email', uRes.user.email);
    }
    await _loadCurrentUserContext();
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
    // Keep app_users.password_hash in sync
    const newHash = await sha256(p1);
    await sb.from('app_users')
      .update({ password_hash: newHash, must_change_pwd: false })
      .eq('email', currentUser?.email);
    toast('✓ Senha alterada com sucesso!', 'success');
    closeModal('changeMyPwdModal');
  } catch(e) { errEl.textContent = 'Erro: ' + (e?.message || e); errEl.style.display = ''; }
}

// ── On login success ──
function onLoginSuccess() {
  hideLoginScreen();
  updateUserUI();
  if (!sb) {
    toast('Configure o Supabase primeiro','error'); return;
  }
  bootApp();
}

// ── Magic-link post-auth gate ─────────────────────────────────────────────
// Called by tryAutoConnect after normal boot to catch SIGNED_IN events that
// arrive via magic link (bypassing doLogin's approval gate).
function _registerMagicLinkGate() {
  if (!sb) return;
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event !== 'SIGNED_IN' || !session?.user?.email) return;

    // Do NOT interfere if the recovery password form is visible
    const recoveryArea = document.getElementById('recoveryPwdArea');
    if (recoveryArea && recoveryArea.style.display !== 'none') return;

    // Ignore if the app is already loaded (user was already logged in)
    const loginScreen = document.getElementById('loginScreen');
    if (!loginScreen || loginScreen.style.display === 'none') return;

    const email = session.user.email;
    try {
      const { data: appUser } = await sb
        .from('app_users')
        .select('approved,active,must_change_pwd')
        .eq('email', email)
        .maybeSingle();

      if (appUser && !appUser.approved) {
        await sb.auth.signOut();
        showLoginFormArea();
        switchLoginTab('magic');
        showLoginErr('Sua conta ainda aguarda aprovação do administrador.');
        return;
      }
      if (appUser && !appUser.active) {
        await sb.auth.signOut();
        showLoginFormArea();
        switchLoginTab('magic');
        showLoginErr('Sua conta está inativa. Contate o administrador.');
        return;
      }
      if (appUser?.must_change_pwd) {
        showLoginFormArea();
        document.getElementById('loginFormArea').style.display = 'none';
        document.getElementById('changePwdArea').style.display = '';
        return;
      }

      // All good — proceed into the app
      await _loadCurrentUserContext();
      onLoginSuccess();
    } catch(e) {
      console.error('Magic link gate error:', e);
    }
  });
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

  // Avatar in topbar and settings
  setTimeout(_applyCurrentUserAvatar, 50);

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
// Strategy: write ONLY to app_users with approved=false, active=false.
// No Supabase Auth account is created at this stage.
// When admin approves, doApproveUser() creates the Supabase Auth account
// via signUp (with emailRedirectTo disabled) and sends the welcome email.
async function doRegister() {
  const name  = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim().toLowerCase();
  const pwd   = document.getElementById('regPassword').value;
  const pwd2  = document.getElementById('regPassword2').value;
  const errEl = document.getElementById('regError');
  errEl.style.display = 'none';

  if (!name)            { errEl.textContent = 'Informe seu nome.';          errEl.style.display = ''; return; }
  if (!email)           { errEl.textContent = 'Informe seu e-mail.';        errEl.style.display = ''; return; }
  if (pwd.length < 8)   { errEl.textContent = 'Senha mínima: 8 caracteres.'; errEl.style.display = ''; return; }
  if (pwd !== pwd2)     { errEl.textContent = 'As senhas não conferem.';    errEl.style.display = ''; return; }

  const btn = document.getElementById('regBtn');
  btn.disabled = true; btn.textContent = 'Enviando...';

  try {
    // Check if e-mail already exists (app_users OR Supabase Auth duplicate prevention)
    const { data: existing } = await sb
      .from('app_users').select('id,approved,active').eq('email', email).maybeSingle();

    if (existing) {
      if (existing.approved) {
        errEl.textContent = 'Este e-mail já possui uma conta ativa. Faça login.';
      } else {
        errEl.textContent = 'Já existe uma solicitação pendente para este e-mail.';
      }
      errEl.style.display = '';
      return;
    }

    // Hash the password — stored in app_users for later Supabase Auth creation at approval time
    const pwdHash = await sha256(pwd);

    // Insert pending record — NOT approved, NOT active, no Supabase Auth account yet
    const { error: insErr } = await sb.from('app_users').insert({
      name,
      email,
      password_hash: pwdHash,
      role:          'viewer',
      approved:      false,
      active:        false,
      can_view:      true,
      can_create:    false,
      can_edit:      false,
      can_delete:    false,
      can_export:    false,
      can_import:    false,
      can_admin:     false,
      must_change_pwd: false,
    });
    if (insErr) throw insErr;

    // Notificar admin por e-mail via EmailJS (best-effort)
    await _notifyAdminNewRegistration(name, email).catch(e =>
      console.warn('[register] email admin falhou:', e.message)
    );

    // Show pending screen
    document.getElementById('registerFormArea').style.display = 'none';
    document.getElementById('pendingApprovalArea').style.display = '';

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
  openModal('userAdminModal');

  // Verificar se há pendentes para abrir direto na aba certa
  let pending = null;
  try { const { data: _p } = await sb.rpc('get_pending_users'); pending = _p; } catch {}
  const hasPending = (pending?.length || 0) > 0;

  if (hasPending) {
    switchUATab('pending');
    // Carregar lista de usuários em background para quando o admin trocar de aba
    loadUsersList().catch(e => console.warn('loadUsersList bg:', e));
  } else {
    switchUATab('users');
  }

  // Atualizar badge na aba pendentes
  const badge = document.getElementById('uaPendingBadge');
  if (badge) {
    badge.textContent = pending?.length || 0;
    badge.style.display = (pending?.length || 0) > 0 ? 'inline-block' : 'none';
  }
}

function switchUATab(tab) {
  ['pending','users','families'].forEach(t => {
    const panel = document.getElementById('uaTab' + t[0].toUpperCase() + t.slice(1));
    const pane  = document.getElementById('ua' + t[0].toUpperCase() + t.slice(1));
    if (panel) panel.classList.toggle('active', t === tab);
    if (pane)  pane.style.display = t === tab ? '' : 'none';
  });
  if (tab === 'pending') _renderPendingTab();
  if (tab === 'users')   loadUsersList().catch(e => console.warn('loadUsersList:', e));
  if (tab === 'families') loadFamiliesList().catch(e => console.warn('loadFamiliesList:', e));
}

async function _renderPendingTab() {
  const el = document.getElementById('uaPendingContent');
  if (!el) return;
  el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted)">⏳ Carregando...</div>';

  let pendingUsers = [];
  const { data: rpcData, error: rpcErr } = await sb.rpc('get_pending_users');
  if (!rpcErr && rpcData) {
    pendingUsers = rpcData;
  } else {
    const { data } = await sb.from('app_users')
      .select('*').eq('approved', false).order('created_at');
    pendingUsers = data || [];
  }

  const badge = document.getElementById('uaPendingBadge');
  if (badge) {
    badge.textContent = pendingUsers.length;
    badge.style.display = pendingUsers.length > 0 ? 'inline-block' : 'none';
  }

  if (!pendingUsers.length) {
    el.innerHTML = '<div style="text-align:center;padding:40px 20px">'
      + '<div style="font-size:2.5rem;margin-bottom:12px">✅</div>'
      + '<div style="font-size:.9rem;font-weight:600;color:var(--text)">Nenhuma solicitação pendente</div>'
      + '<div style="font-size:.78rem;color:var(--muted);margin-top:4px">Novos usuários aparecerão aqui</div>'
      + '</div>';
    return;
  }

  // Montar opções de família para o select inline
  const famOptions = '<option value="">— Nenhuma (admin global) —</option>'
    + (_families || []).map(f => '<option value="' + esc(f.id) + '">' + esc(f.name) + '</option>').join('');

  let html = '<div style="font-size:.82rem;color:var(--muted);margin-bottom:12px">'
    + pendingUsers.length + ' solicitação(ões) aguardando aprovação</div>'
    + '<div style="display:flex;flex-direction:column;gap:12px">';

  pendingUsers.forEach(u => {
    const daysAgo  = Math.floor((Date.now() - new Date(u.created_at)) / 86400000);
    const ageLabel = daysAgo === 0 ? 'Hoje' : daysAgo === 1 ? '1 dia' : daysAgo + ' dias';
    const ageColor = daysAgo >= 3 ? '#dc2626' : '#b45309';
    const parts    = (u.name || u.email || '?').trim().split(' ');
    const initials = (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
    const uid      = esc(u.id);
    const uname    = esc(u.name || u.email || '');

    html += '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:14px 16px">'
      // — Linha superior: avatar + nome + idade
      + '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">'
      + '<div style="width:40px;height:40px;border-radius:50%;background:#fef3c7;border:2px solid #f59e0b;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.82rem;color:#92400e;flex-shrink:0">' + initials + '</div>'
      + '<div style="flex:1;min-width:0">'
      + '<div style="font-size:.9rem;font-weight:700;color:var(--text)">' + esc(u.name || '—') + '</div>'
      + '<div style="font-size:.76rem;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(u.email) + '</div>'
      + '</div>'
      + '<span style="font-size:.74rem;color:' + ageColor + ';font-weight:600;flex-shrink:0">' + ageLabel + '</span>'
      + '</div>'
      // — Linha inferior: select família + botões
      + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
      + '<select id="pendingFam_' + uid + '" style="flex:1;min-width:140px;height:32px;font-size:.8rem;border:1px solid var(--border);border-radius:6px;padding:0 8px;background:var(--surface);color:var(--text)">'
      + famOptions
      + '</select>'
      + '<button class="btn btn-primary btn-sm" data-uid="' + uid + '" data-uname="' + uname + '" onclick="_inlineApprove(this.dataset.uid,this.dataset.uname)" style="background:#16a34a;height:32px;white-space:nowrap">&#9989; Aprovar</button>'
      + '<button class="btn btn-ghost btn-sm" data-uid="' + uid + '" data-uname="' + uname + '" onclick="_inlineReject(this.dataset.uid,this.dataset.uname)" style="color:#dc2626;height:32px">&#10005; Rejeitar</button>'
      + '</div>'
      + '</div>';
  });

  html += '</div>';
  el.innerHTML = html;
}

// Aprovação direta da aba Pendentes (sem abrir approvalModal)
async function _inlineApprove(userId, userName) {
  const famSel = document.getElementById('pendingFam_' + userId);
  const familyId   = famSel?.value || null;
  const familyName = _families?.find(f => f.id === familyId)?.name || null;

    document.querySelectorAll('[data-uid="' + userId + '"]').forEach(b => { b.disabled = true; });

  try {
    const { data: userRow, error: fetchErr } = await sb
      .from('app_users').select('name,email,approved').eq('id', userId).single();
    if (fetchErr) throw new Error('Erro ao buscar usuário: ' + fetchErr.message);
    if (!userRow)  throw new Error('Usuário não encontrado.');

    const userEmail   = userRow.email;
    const displayName = userRow.name || userName;

    // Aprovar no app_users
    const { error: updErr } = await sb.from('app_users').update({
      active: true, approved: true, family_id: familyId, must_change_pwd: true,
    }).eq('id', userId);
    if (updErr) throw new Error('Erro ao aprovar: ' + updErr.message);

    // family_members
    if (familyId) {
      const { error: fmErr } = await sb.from('family_members').upsert(
        { user_id: userId, family_id: familyId, role: 'editor' },
        { onConflict: 'user_id,family_id' }
      );
      if (fmErr) console.warn('[approve] family_members:', fmErr.message);
    }

    // RPC confirma email no Supabase Auth
    const { error: rpcApproveErr } = await sb.rpc('approve_user', { p_user_id: userId, p_family_id: familyId || null });
    if (rpcApproveErr) console.warn('[approve] RPC:', rpcApproveErr.message);

    // signUp se não existe no Auth
    const tempPwd = _randomPassword();
    const { error: signUpErr2 } = await sb.auth.signUp({ email: userEmail, password: tempPwd,
      options: { data: { display_name: displayName } } });
    if (signUpErr2) console.warn('[approve] signUp:', signUpErr2.message);

    // Email de boas-vindas
    await _sendApprovalEmail(userEmail, displayName, familyName);

    toast('✓ ' + displayName + ' aprovado!' + (familyName ? ' Família: ' + familyName : ''), 'success');
    await _checkPendingApprovals();
    await _renderPendingTab();

  } catch(e) {
    toast('Erro: ' + e.message, 'error');
    document.querySelectorAll('[data-uid="' + userId + '"]').forEach(b => { b.disabled = false; });
  }
}

async function _inlineReject(userId, userName) {
  if (!confirm('Rejeitar e excluir solicitação de ' + userName + '?')) return;
  const { error } = await sb.from('app_users').delete().eq('id', userId);
  if (error) { toast('Erro: ' + error.message, 'error'); return; }
  toast('Solicitação de ' + userName + ' removida.', 'info');
  await _checkPendingApprovals();
  await _renderPendingTab();
}


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
  const data = { name, description: desc||null }; // updated_at omitido — coluna não existe no schema
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
  // Usar RPC get_all_users() (SECURITY DEFINER) para evitar problemas de RLS.
  // Fallback para select direto se a função ainda não foi criada.
  let users, error;
  const { data: rpcData, error: rpcErr } = await sb.rpc('get_all_users');
  if (rpcErr) {
    console.warn('[loadUsersList] RPC get_all_users indisponível:', rpcErr.message);
    // Fallback: select direto — funciona se RLS permitir ou não estiver ativa
    ({ data: users, error } = await sb.from('app_users').select('*').order('created_at'));
    if (error) {
      const el = document.getElementById('usersList');
      if (el) el.innerHTML = '<div style="padding:16px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;font-size:.82rem;color:#991b1b">'
        + '<strong>⚠️ Não foi possível carregar a lista de usuários.</strong><br><br>'
        + 'Execute <code>migration_approval_rls.sql</code> no Supabase para habilitar o gerenciamento completo.<br><br>'
        + '<span style="color:#6b7280">Erro técnico: ' + error.message + '</span></div>';
      return;
    }
    // Se o fallback retornou só 1 usuário (próprio admin por RLS), avisar
    if (users && users.length <= 1) {
      const el = document.getElementById('usersList');
      if (el && users.length <= 1) {
        const hint = document.createElement('div');
        hint.style.cssText = 'padding:10px 14px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;font-size:.78rem;color:#c2410c;margin-bottom:12px';
        hint.innerHTML = '⚠️ Execute <code>migration_approval_rls.sql</code> no Supabase para exibir todos os usuários (RLS limitando visualização).';
        el.prepend(hint);
      }
    }
  } else {
    users = rpcData;
  }
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
    html += `<div style="background:linear-gradient(135deg,#fef3c7,#fef9e8);border:1.5px solid #f59e0b;border-radius:12px;padding:14px 18px;margin-bottom:16px;display:flex;align-items:flex-start;gap:12px">
      <div style="font-size:1.6rem;flex-shrink:0">⏳</div>
      <div style="flex:1">
        <div style="font-weight:700;font-size:.92rem;color:#92400e;margin-bottom:2px">${pendingUsers.length} solicitação(ões) aguardando aprovação</div>
        <div style="font-size:.78rem;color:#b45309">Novos usuários não têm acesso até você aprovar.</div>
      </div>
    </div>`;
    html += '<div class="table-wrap" style="margin-bottom:20px;border-radius:var(--r);overflow:hidden;border:1.5px solid #f59e0b"><table><thead><tr style="background:#fef3c7"><th>Solicitante</th><th>E-mail</th><th>Aguardando</th><th style="text-align:center">Ações</th></tr></thead><tbody>';
    html += pendingUsers.map(u => {
      const daysAgo = Math.floor((Date.now() - new Date(u.created_at)) / 86400000);
      const ageLabel = daysAgo === 0 ? 'Hoje' : daysAgo === 1 ? '1 dia' : (daysAgo + ' dias');
      const ageStyle = daysAgo >= 3 ? 'color:#dc2626;font-weight:600' : 'color:var(--muted)';
      const initials = (u.name || u.email || '?').slice(0, 2).toUpperCase();
      return '<tr style="background:#fffbeb">' +
        '<td><div style="display:flex;align-items:center;gap:10px">' +
        '<div style="width:32px;height:32px;border-radius:50%;background:#fef3c7;border:2px solid #f59e0b;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.75rem;color:#92400e;flex-shrink:0">' + initials + '</div>' +
        '<strong>' + esc(u.name||'—') + '</strong></div></td>' +
        '<td style="font-size:.82rem">' + esc(u.email) + '</td>' +
        '<td><span style="' + ageStyle + '">' + ageLabel + '</span></td>' +
        '<td style="text-align:center;white-space:nowrap">' +
        '<button class="btn btn-primary btn-sm" onclick="approveUser(' + "'" + u.id + "','" + esc(u.name||u.email) + "')" + ' style="background:#16a34a;margin-right:4px">✅ Aprovar</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="rejectUser(' + "'" + u.id + "','" + esc(u.name||u.email) + "')" + ' style="color:#dc2626">✕ Rejeitar</button>' +
        '</td></tr>';
    }).join('');
    html += '</tbody></table></div>';
    html += '<div style="font-weight:600;font-size:.82rem;margin-bottom:10px;color:var(--muted)">Usuários ativos</div>';
  }

  if (!activeUsers.length) {
    html += '<div style="text-align:center;padding:20px;color:var(--muted)">Nenhum usuário ativo.</div>';
  } else {
    html += '<div class="table-wrap"><table><thead><tr><th>Usuário</th><th>Perfil</th><th>Família</th><th>Status</th><th style="width:80px"></th></tr></thead><tbody>';
    html += activeUsers.map(u => {
      const avatarHtml = _userAvatarHtml(u, 34);
      const roleBadge = u.role==='owner'
        ? '<span class="badge" style="background:#fef3c7;color:#92400e;border:1px solid #f59e0b;font-size:.7rem">👑 Owner</span>'
        : u.role==='admin'
        ? '<span class="badge badge-amber" style="font-size:.7rem">🔧 Admin</span>'
        : u.role==='viewer'
        ? '<span class="badge badge-muted" style="font-size:.7rem">👁 Viewer</span>'
        : '<span class="badge badge-blue" style="font-size:.7rem">👤 Usuário</span>';
      return `<tr onclick="editUser('${u.id}')" style="cursor:pointer;transition:background .12s" onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background=''">
        <td>
          <div style="display:flex;align-items:center;gap:10px">
            ${avatarHtml}
            <div>
              <div style="font-weight:600;font-size:.875rem">${esc(u.name||'—')}</div>
              <div style="font-size:.72rem;color:var(--muted)">${esc(u.email)}</div>
            </div>
          </div>
        </td>
        <td>${roleBadge}</td>
        <td style="font-size:.78rem;color:var(--text2)">${u.family_id ? (famById[u.family_id]||'—') : '<span style="color:var(--muted)">—</span>'}</td>
        <td><span style="font-size:.75rem;color:${u.active?'var(--green)':'var(--red)'}">● ${u.active?'Ativo':'Inativo'}</span></td>
        <td style="white-space:nowrap" onclick="event.stopPropagation()">
          ${u.id !== currentUser?.id ? `<button class="btn btn-ghost btn-sm" onclick="toggleUserActive('${u.id}',${u.active})" style="padding:3px 8px;font-size:.73rem" title="${u.active?'Desativar':'Ativar'}">${u.active?'🚫':'✅'}</button>` : ''}
          ${u.id !== currentUser?.id ? `<button class="btn btn-ghost btn-sm" onclick="resetUserPwd('${u.id}','${esc(u.name||u.email)}')" style="padding:3px 8px;font-size:.73rem" title="Redefinir senha">🔑</button>` : ''}
        </td>
      </tr>`;
    }).join('');
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

  // Scroll form into view
  const formArea = document.getElementById('userFormArea');
  document.getElementById('userFormTitle').textContent = 'Editar Usuário';
  document.getElementById('editUserId').value = u.id;
  document.getElementById('uName').value = u.name||'';
  document.getElementById('uEmail').value = u.email;
  document.getElementById('uPassword').value = '';
  document.getElementById('uRole').value = u.role;
  document.getElementById('uFamilyId').value = u.family_id||'';
  document.getElementById('pView').checked   = u.can_view;
  document.getElementById('pCreate').checked = u.can_create;
  document.getElementById('pEdit').checked   = u.can_edit;
  document.getElementById('pDelete').checked = u.can_delete;
  document.getElementById('pExport').checked = u.can_export;
  document.getElementById('pImport').checked = u.can_import;
  document.getElementById('pwdHint').textContent = '(deixe em branco para manter)';

  // Show current avatar in form
  const avatarPreview = document.getElementById('uAvatarPreview');
  if (avatarPreview) {
    avatarPreview.innerHTML = _userAvatarHtml(u, 56);
    avatarPreview.dataset.currentUrl = u.avatar_url || '';
  }
  const removeBtn = document.getElementById('uAvatarRemoveBtn');
  if (removeBtn) removeBtn.style.display = u.avatar_url ? '' : 'none';

  formArea.style.display = '';
  setTimeout(() => formArea.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
}

// ── Avatar upload ─────────────────────────────────────────────────────────

function previewUserAvatar(input) {
  const file = input?.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('Selecione uma imagem', 'error'); return; }
  if (file.size > 2 * 1024 * 1024) { toast('Imagem muito grande (máx 2 MB)', 'error'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    const prev = document.getElementById('uAvatarPreview');
    if (prev) {
      prev.innerHTML = `<img src="${e.target.result}" style="width:56px;height:56px;border-radius:50%;object-fit:cover;border:2px solid var(--accent)">`;
    }
    const removeBtn = document.getElementById('uAvatarRemoveBtn');
    if (removeBtn) removeBtn.style.display = '';
  };
  reader.readAsDataURL(file);
}

async function _uploadUserAvatar(userId, file) {
  const ext = file.name.split('.').pop().toLowerCase() || 'jpg';
  const path = `user-${userId}.${ext}`;
  const client = sbAdmin || sb;
  const { error } = await client.storage.from('avatars').upload(path, file, {
    upsert: true, contentType: file.type
  });
  if (error) throw new Error('Upload falhou: ' + error.message);
  const { data } = client.storage.from('avatars').getPublicUrl(path);
  return data.publicUrl + '?t=' + Date.now(); // cache-bust
}

async function removeUserAvatar() {
  const preview = document.getElementById('uAvatarPreview');
  const userId  = document.getElementById('editUserId').value;
  if (preview) {
    // Show placeholder for current role
    const role = document.getElementById('uRole')?.value || 'user';
    const name = document.getElementById('uName')?.value || '';
    preview.innerHTML = _userAvatarHtml({ role, name, avatar_url: '' }, 56);
    preview.dataset.currentUrl = '';
  }
  const removeBtn = document.getElementById('uAvatarRemoveBtn');
  if (removeBtn) removeBtn.style.display = 'none';
  // Mark for removal
  const fileInput = document.getElementById('uAvatarFile');
  if (fileInput) fileInput.value = '';
  document.getElementById('uAvatarRemoveFlag').value = '1';
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

  // Handle avatar upload/removal
  let avatarUrl = undefined; // undefined = don't change
  const avatarFile   = document.getElementById('uAvatarFile')?.files?.[0];
  const avatarRemove = document.getElementById('uAvatarRemoveFlag')?.value === '1';
  if (avatarFile && userId) {
    try { avatarUrl = await _uploadUserAvatar(userId, avatarFile); }
    catch(e) { toast('Aviso: ' + e.message, 'warning'); }
  } else if (avatarRemove && userId) {
    avatarUrl = null; // set null to remove
  }

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
  if (avatarUrl !== undefined) record.avatar_url = avatarUrl;
  if (pwd) record.password_hash = await sha256(pwd);
  // Reset avatar flag
  const flagEl = document.getElementById('uAvatarRemoveFlag'); if (flagEl) flagEl.value = '';
  if (!userId) { record.must_change_pwd = false; record.active = true; record.approved = true; record.created_by = currentUser?.id; }

  try {
    let error;
    if (userId) { ({ error } = await sb.from('app_users').update(record).eq('id', userId)); }
    else        { ({ error } = await sb.from('app_users').insert(record)); }
    if (error) throw error;
    toast(userId ? '✓ Usuário atualizado!' : '✓ Usuário criado!', 'success');
    document.getElementById('userFormArea').style.display = 'none';
    // If editing current user, refresh avatar
    if (userId === currentUser?.id) { if (record.avatar_url !== undefined) currentUser.avatar_url = record.avatar_url; _applyCurrentUserAvatar(); }
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
  const approveBtn = document.querySelector('#approvalModal .btn-primary');
  errEl.style.display = 'none';
  if (approveBtn) { approveBtn.disabled = true; approveBtn.textContent = '⏳ Aprovando...'; }

  try {
    // ── 1. Criar ou selecionar família ──────────────────────────────────
    let familyId   = famSel || null;
    let familyName = _families.find(f => f.id === famSel)?.name || null;

    if (newFamNm) {
      const { data: nf, error: nfErr } = await sb.from('families')
        .insert({ name: newFamNm }).select('id,name').single();
      if (nfErr) throw new Error('Erro ao criar família: ' + nfErr.message);
      familyId = nf.id; familyName = nf.name;
      await loadFamiliesList();
    }

    // ── 2. Buscar dados do usuário pendente ──────────────────────────────
    const { data: userRow, error: fetchErr } = await sb
      .from('app_users').select('name,email,password_hash,approved').eq('id', userId).single();
    if (fetchErr) throw new Error('Erro ao buscar usuário: ' + fetchErr.message);
    if (!userRow)  throw new Error('Usuário não encontrado.');
    if (userRow.approved) throw new Error('Usuário já está aprovado.');

    const userEmail   = userRow.email;
    const displayName = userRow.name || userName;

    // ── 3. Aprovar no app_users PRIMEIRO ────────────────────────────────
    const { error: updErr } = await sb.from('app_users').update({
      active:          true,
      approved:        true,
      family_id:       familyId,
      must_change_pwd: true,
    }).eq('id', userId);
    if (updErr) throw new Error('Erro ao aprovar no banco: ' + updErr.message);

    // ── 4. Adicionar à family_members ────────────────────────────────────
    if (familyId) {
      const { error: fmErr } = await sb.from('family_members').upsert(
        { user_id: userId, family_id: familyId, role: 'editor' },
        { onConflict: 'user_id,family_id' }
      );
      if (fmErr) console.warn('[approve] family_members upsert:', fmErr.message);
    }

    // ── 5. Criar/confirmar conta no Supabase Auth ────────────────────────
    // 5a. RPC server-side — confirma email_confirmed_at no auth.users (SECURITY DEFINER)
    const { data: rpcResult, error: rpcErr } = await sb.rpc('approve_user', {
      p_user_id:   userId,
      p_family_id: familyId || null,
    });
    if (rpcErr)           console.warn('[approve] RPC approve_user:', rpcErr.message);
    if (rpcResult?.error) console.warn('[approve] RPC result error:', rpcResult.error);

    // 5b. Se o auth user não existe ainda, criar via signUp
    const authExists = rpcResult?.auth_exists === true;
    if (!authExists) {
      const tempPwd = _randomPassword();
      const { error: signUpErr } = await sb.auth.signUp({
        email:    userEmail,
        password: tempPwd,
        options:  { data: { display_name: displayName } }
      });
      const msg = (signUpErr?.message || '').toLowerCase();
      if (signUpErr && !msg.includes('already') && !msg.includes('registered') && !msg.includes('exists')) {
        console.warn('[approve] signUp (não fatal):', signUpErr.message);
      }
    }

    // ── 6. Enviar email de aprovação ─────────────────────────────────────
    await _sendApprovalEmail(userEmail, displayName, familyName);

    toast('✓ ' + displayName + ' aprovado!' + (familyName ? ' Família: ' + familyName : ''), 'success');
    closeModal('approvalModal');
    await loadUsersList();
    await _checkPendingApprovals();
    // Atualizar aba pendentes no modal se estiver aberto
    if (document.getElementById('uaPending')?.style.display !== 'none') _renderPendingTab();

  } catch(e) {
    console.error('[doApproveUser]', e);
    errEl.textContent = 'Erro: ' + (e.message || String(e));
    errEl.style.display = '';
  } finally {
    if (approveBtn) { approveBtn.disabled = false; approveBtn.textContent = '✅ Aprovar e Notificar'; }
  }
}
// Generates a cryptographically random 16-char password
function _randomPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => chars[b % chars.length]).join('');
}


// ── Notifica admin por email quando há novo cadastro pendente ────────────
async function _notifyAdminNewRegistration(userName, userEmail) {
  if (!EMAILJS_CONFIG.serviceId || !EMAILJS_CONFIG.publicKey) return;
  const tplId = EMAILJS_CONFIG.scheduledTemplateId || EMAILJS_CONFIG.templateId;
  if (!tplId) return;

  // Buscar email do admin: 1) config de automação, 2) role=owner no banco
  let adminEmail = '';
  try {
    const raw = localStorage.getItem('fintrack_auto_check_config');
    if (raw) adminEmail = JSON.parse(raw).emailDefault || '';
  } catch(e) {}

  if (!adminEmail) {
    try {
      // Tenta buscar o owner/admin com email no banco
      const { data } = await sb.from('app_users')
        .select('email').in('role', ['owner', 'admin'])
        .eq('active', true).limit(1).maybeSingle();
      adminEmail = data?.email || '';
    } catch(e) {}
  }

  if (!adminEmail) {
    console.warn('[approval] Sem email de admin configurado. Configure em Configurações → Automação → E-mail de Notificações.');
    return;
  }

  const now = new Date().toLocaleString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  const nameEsc  = (userName  || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
  const emailEsc = (userEmail || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));

  const body =
    '<div style="font-family:Arial,Helvetica,sans-serif;background:#f5f7fb;padding:24px">' +
    '<div style="max-width:540px;margin:0 auto;background:#ffffff;border:1px solid #e6e8f0;border-radius:12px;overflow:hidden">' +

    // Header
    '<div style="background:linear-gradient(135deg,#1e5c42,#2a6049);padding:22px 28px">' +
    '<div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.6);margin-bottom:4px">JF Family FinTrack</div>' +
    '<div style="font-size:20px;font-weight:700;color:#fff">&#128276; Nova solicitação de acesso</div>' +
    '</div>' +

    // Body
    '<div style="padding:24px 28px">' +
    '<p style="color:#374151;margin:0 0 20px;font-size:14px;line-height:1.6">' +
    'Um novo usuário se cadastrou e está <strong>aguardando sua aprovação</strong> para acessar o sistema.' +
    '</p>' +

    // User card
    '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:18px;margin-bottom:20px">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#374151;border-collapse:collapse">' +
    '<tr><td style="padding:7px 0;color:#6b7280;width:100px;font-weight:600">&#128100; Nome</td>' +
    '<td style="padding:7px 0;font-weight:700;color:#111827">' + nameEsc + '</td></tr>' +
    '<tr style="border-top:1px solid #e2e8f0"><td style="padding:7px 0;color:#6b7280;font-weight:600">&#128140; E-mail</td>' +
    '<td style="padding:7px 0;color:#111827">' + emailEsc + '</td></tr>' +
    '<tr style="border-top:1px solid #e2e8f0"><td style="padding:7px 0;color:#6b7280;font-weight:600">&#128197; Enviado</td>' +
    '<td style="padding:7px 0;color:#111827">' + now + '</td></tr>' +
    '</table>' +
    '</div>' +

    // Warning
    '<div style="background:#fef3c7;border-left:4px solid #f59e0b;border-radius:6px;padding:12px 16px;margin-bottom:20px">' +
    '<div style="font-size:13px;font-weight:700;color:#92400e;margin-bottom:3px">&#9888;&#65039; Acesso bloqueado</div>' +
    '<div style="font-size:12px;color:#b45309">O usuário <strong>' + nameEsc + '</strong> não tem acesso ao sistema até você aprovar ou rejeitar a solicitação.</div>' +
    '</div>' +

    // Action hint
    '<p style="font-size:13px;color:#6b7280;margin:0">Para aprovar: abra o app &#8594; <strong>Configurações</strong> &#8594; <strong>Gerenciar Usuários</strong>.</p>' +
    '</div>' +

    // Footer
    '<div style="padding:14px 28px;background:#f8fafc;border-top:1px solid #e2e8f0">' +
    '<div style="font-size:11px;color:#9ca3af">JF Family FinTrack &middot; Notificação automática &middot; Não responda este e-mail</div>' +
    '</div>' +

    '</div></div>';

  try {
    emailjs.init(EMAILJS_CONFIG.publicKey);
    await emailjs.send(EMAILJS_CONFIG.serviceId, tplId, {
      to_email:     adminEmail,
      Subject:      'FinTrack: Nova solicitacao de acesso — ' + (userName || userEmail),
      month_year:   now,
      report_content: body,
    });
    console.log('[approval] Email enviado para admin:', adminEmail);
  } catch(e) {
    console.warn('[approval] Falha ao enviar email para admin:', e.message || e);
  }
}

// ── Email de boas-vindas ao usuário aprovado ─────────────────────────────
async function _sendApprovalEmail(email, name, familyName) {
  if (!EMAILJS_CONFIG.serviceId || !EMAILJS_CONFIG.publicKey) return;

  // 1. Enviar link de redefinição de senha (Supabase) para o usuário definir a própria senha
  try {
    const redirectTo = window.location.origin + window.location.pathname;
    await sb.auth.resetPasswordForEmail(email, { redirectTo });
  } catch(e) { console.warn('[approval] resetPasswordForEmail:', e.message); }

  // 2. Email de boas-vindas via EmailJS
  const tplId = EMAILJS_CONFIG.scheduledTemplateId || EMAILJS_CONFIG.templateId;
  if (!tplId) return;

  const nameEsc  = (name  || 'Usuário').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
  const famEsc   = (familyName || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));

  const famBlock = familyName
    ? '<div style="background:#f0fdf4;border-left:4px solid #22c55e;border-radius:6px;padding:12px 16px;margin-bottom:20px">' +
      '<div style="font-size:13px;font-weight:700;color:#166534;margin-bottom:2px">&#128106; Família vinculada</div>' +
      '<div style="font-size:13px;color:#15803d">' + famEsc + '</div>' +
      '</div>'
    : '<div style="background:#f0f9ff;border-left:4px solid #38bdf8;border-radius:6px;padding:12px 16px;margin-bottom:20px">' +
      '<div style="font-size:13px;color:#0c4a6e">Acesso liberado como <strong>administrador global</strong>.</div>' +
      '</div>';

  const body =
    '<div style="font-family:Arial,Helvetica,sans-serif;background:#f5f7fb;padding:24px">' +
    '<div style="max-width:540px;margin:0 auto;background:#ffffff;border:1px solid #e6e8f0;border-radius:12px;overflow:hidden">' +

    '<div style="background:linear-gradient(135deg,#1e5c42,#2a6049);padding:22px 28px">' +
    '<div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.6);margin-bottom:4px">JF Family FinTrack</div>' +
    '<div style="font-size:22px;font-weight:700;color:#fff">&#127881; Acesso aprovado!</div>' +
    '</div>' +

    '<div style="padding:24px 28px">' +
    '<p style="font-size:15px;font-weight:600;color:#111827;margin:0 0 12px">Olá, ' + nameEsc + '!</p>' +
    '<p style="font-size:14px;color:#374151;margin:0 0 20px;line-height:1.6">' +
    'Sua solicitação de acesso ao <strong>JF Family FinTrack</strong> foi <strong>aprovada</strong>. ' +
    'Você já pode acessar o sistema.' +
    '</p>' +

    famBlock +

    '<div style="background:#fef9e8;border:1px solid #fcd34d;border-radius:8px;padding:14px 16px;margin-bottom:20px">' +
    '<div style="font-size:13px;font-weight:700;color:#92400e;margin-bottom:6px">&#128273; Definir sua senha</div>' +
    '<div style="font-size:13px;color:#78350f;line-height:1.6">' +
    'Você receberá um segundo e-mail do Supabase com um <strong>link para definir sua senha</strong>. ' +
    'Clique nesse link, defina uma senha segura e faça login normalmente.' +
    '</div>' +
    '</div>' +

    '<p style="font-size:12px;color:#9ca3af;margin:0">Se você não solicitou acesso a este sistema, ignore este e-mail.</p>' +
    '</div>' +

    '<div style="padding:14px 28px;background:#f8fafc;border-top:1px solid #e2e8f0">' +
    '<div style="font-size:11px;color:#9ca3af">JF Family FinTrack &middot; Bem-vindo(a)!</div>' +
    '</div>' +
    '</div></div>';

  try {
    emailjs.init(EMAILJS_CONFIG.publicKey);
    await emailjs.send(EMAILJS_CONFIG.serviceId, tplId, {
      to_email:     email,
      Subject:      'FinTrack — Acesso aprovado! Bem-vindo(a)',
      month_year:   new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
      report_content: body,
    });
  } catch(e) { console.warn('[approval] _sendApprovalEmail:', e.message); }
}

async function rejectUser(userId, userName) {
  if (!confirm(`Rejeitar e excluir solicitação de ${userName}?`)) return;
  const { error } = await sb.from('app_users').delete().eq('id', userId);
  if (error) { toast('Erro: '+error.message,'error'); return; }
  toast(`Solicitação de ${userName} removida.`,'success');
  await loadUsersList();
  await _checkPendingApprovals();
  if (document.getElementById('uaPending')?.style.display !== 'none') _renderPendingTab();
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
  const btn      = document.getElementById('resetPwdBtn');
  errEl.style.display = 'none';

  if (pwd1.length < 8) { errEl.textContent = 'A senha deve ter pelo menos 8 caracteres.'; errEl.style.display = ''; return; }
  if (pwd1 !== pwd2)   { errEl.textContent = 'As senhas não coincidem.'; errEl.style.display = ''; return; }

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Salvando...'; }
  try {
    // 1. Buscar email e auth_id do usuário alvo
    const { data: userRow, error: fetchErr } = await sb
      .from('app_users').select('email').eq('id', userId).maybeSingle();
    if (fetchErr || !userRow) throw new Error(fetchErr?.message || 'Usuário não encontrado.');
    const targetEmail = userRow.email;

    // 2. Tentar via Admin API (sbAdmin com service_role key)
    let authUpdated = false;
    const admin = sbAdmin || initSbAdmin();

    if (admin) {
      // Buscar auth.users.id pelo email via Admin API
      const { data: listData, error: listErr } = await admin.auth.admin.listUsers();
      if (!listErr && listData?.users) {
        const authUser = listData.users.find(u => u.email?.toLowerCase() === targetEmail.toLowerCase());
        if (authUser?.id) {
          const { error: updErr } = await admin.auth.admin.updateUserById(authUser.id, { password: pwd1 });
          if (updErr) throw new Error('Admin API: ' + updErr.message);
          authUpdated = true;
        } else {
          throw new Error('Usuário não encontrado no Supabase Auth: ' + targetEmail);
        }
      } else {
        throw new Error('Erro ao listar usuários: ' + (listErr?.message || 'desconhecido'));
      }
    }

    if (!authUpdated) {
      // Fallback: enviar link de redefinição por email
      const redirectTo = window.location.origin + window.location.pathname;
      const { error: resetErr } = await sb.auth.resetPasswordForEmail(targetEmail, { redirectTo });
      if (resetErr) throw new Error('Sem Service Role Key configurada. Vá em Configurações → Service Role Key.');
      // Sincronizar app_users mesmo assim
      const hash = await sha256(pwd1);
      await sb.from('app_users').update({ password_hash: hash, must_change_pwd: true }).eq('id', userId);
      toast(`📧 Link de redefinição enviado para ${targetEmail}. Configure a Service Role Key para definir senhas diretamente.`, 'warning');
      closeModal('resetPwdModal');
      await loadUsersList();
      return;
    }

    // 3. Sincronizar app_users
    const hash = await sha256(pwd1);
    await sb.from('app_users').update({ password_hash: hash, must_change_pwd: false }).eq('id', userId);

    toast(`✓ Senha de ${userName} redefinida. Pode fazer login com a nova senha imediatamente.`, 'success');
    closeModal('resetPwdModal');
    await loadUsersList();
  } catch(e) {
    errEl.textContent = 'Erro: ' + (e.message || e);
    errEl.style.display = '';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Salvar Nova Senha'; }
  }
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
  // Make sure the main app is hidden and login screen is on top
  const mainApp = document.getElementById('mainApp');
  const sidebar  = document.getElementById('sidebar');
  if (mainApp) mainApp.style.display = 'none';
  if (sidebar)  sidebar.style.display = 'none';

  const ls = document.getElementById('loginScreen');
  if (ls) ls.style.display = 'flex';

  // Hide every other panel inside the login card
  ['loginFormArea','registerFormArea','pendingApprovalArea',
   'forgotPwdArea','changePwdArea','recoveryPwdArea']
    .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });

  // Show only the recovery form
  const area = document.getElementById('recoveryPwdArea');
  if (area) {
    area.style.display = '';
    const err = document.getElementById('recoveryPwdError');
    if (err) err.style.display = 'none';
    const f1 = document.getElementById('recoveryPwd1');
    const f2 = document.getElementById('recoveryPwd2');
    if (f1) f1.value = '';
    if (f2) f2.value = '';
  }
  setTimeout(() => document.getElementById('recoveryPwd1')?.focus(), 200);
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
    // Verify there is an active session (recovery token must have been exchanged)
    const { data: sessionData } = await sb.auth.getSession();
    if (!sessionData?.session) {
      throw new Error('Sessão expirada. Solicite um novo link de recuperação.');
    }

    // Update password in Supabase Auth
    const { error } = await sb.auth.updateUser({ password: p1 });
    if (error) throw error;

    // Sync the new password_hash + clear must_change_pwd in app_users
    const userEmail = sessionData.session.user?.email;
    if (userEmail) {
      const newHash = await sha256(p1);
      await sb.from('app_users')
        .update({ password_hash: newHash, must_change_pwd: false })
        .eq('email', userEmail);
    }

    // Load context and enter the app
    await _loadCurrentUserContext();
    document.getElementById('loginScreen').style.display = 'none';
    toast('✓ Senha redefinida com sucesso! Bem-vindo(a).', 'success');
    await bootApp();
  } catch(e) {
    errEl.textContent = 'Erro: ' + (e?.message || e);
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
    // Usar RPC para evitar problemas de RLS (SECURITY DEFINER)
    let pendingUsers = [];
    const { data: rpcData, error: rpcErr } = await sb.rpc('get_pending_users');
    if (!rpcErr && rpcData) {
      pendingUsers = rpcData;
    } else {
      const { data } = await sb.from('app_users').select('*').eq('approved', false).order('created_at');
      pendingUsers = data || [];
    }
    const count = pendingUsers.length;

    // ── Badge no botão "Gerenciar" ──
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

    // ── Painel inline na settings page ──
    const alertEl = document.getElementById('pendingApprovalsAlert');
    const listEl  = document.getElementById('inlinePendingList');
    const txtEl   = document.getElementById('pendingApprovalsAlertText');

    if (alertEl) {
      if (count > 0) {
        if (txtEl) txtEl.textContent = count === 1
          ? '1 solicitação aguardando aprovação'
          : count + ' solicitações aguardando aprovação';

        if (listEl) {
          listEl.innerHTML = pendingUsers.map(function(u) {
            const daysAgo  = Math.floor((Date.now() - new Date(u.created_at)) / 86400000);
            const ageLabel = daysAgo === 0 ? 'Hoje' : daysAgo === 1 ? '1 dia' : daysAgo + ' dias';
            const ageColor = daysAgo >= 3 ? '#dc2626' : '#b45309';
            const parts    = (u.name || u.email || '?').trim().split(' ');
            const initials = (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
            // Use data-id/data-name to avoid quoting issues in onclick
            const uid  = esc(u.id);
            const uname = esc(u.name || u.email || '');
            return '<div style="display:flex;align-items:center;gap:10px;padding:9px 6px;border-bottom:1px solid #fde68a">'
              + '<div style="width:34px;height:34px;border-radius:50%;background:#fde68a;border:2px solid #f59e0b;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.75rem;color:#92400e;flex-shrink:0">' + initials + '</div>'
              + '<div style="flex:1;min-width:0">'
              + '<div style="font-size:.84rem;font-weight:600;color:#111827;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(u.name || '—') + '</div>'
              + '<div style="font-size:.73rem;color:#6b7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(u.email) + '</div>'
              + '</div>'
              + '<span style="font-size:.72rem;color:' + ageColor + ';font-weight:600;white-space:nowrap;flex-shrink:0;margin-right:4px">' + ageLabel + '</span>'
              + '<div style="display:flex;gap:5px;flex-shrink:0">'
              + '<button class="btn btn-primary btn-sm" data-uid="' + uid + '" data-uname="' + uname + '" onclick="approveUser(this.dataset.uid,this.dataset.uname)" style="background:#16a34a;font-size:.75rem;padding:4px 10px">&#9989; Aprovar</button>'
              + '<button class="btn btn-ghost btn-sm" data-uid="' + uid + '" data-uname="' + uname + '" onclick="rejectUser(this.dataset.uid,this.dataset.uname)" style="color:#dc2626;font-size:.75rem;padding:4px 8px">&#10005;</button>'
              + '</div></div>';
          }).join('');
        }
        alertEl.style.display = '';
      } else {
        alertEl.style.display = 'none';
      }
    }
  } catch(e) { console.warn('[_checkPendingApprovals]', e); }
}
