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

  // --- Topbar: avatar circular clicável ---
  const topbarInner = document.getElementById('topbarUserAvatarInner');
  if (topbarInner) topbarInner.outerHTML = _userAvatarHtml(currentUser, 32);
  // fallback: se o elemento foi substituído, garantir que o wrap fica visível
  const topbarBtn = document.getElementById('topbarUserBtn');
  if (topbarBtn) topbarBtn.style.display = '';

  // --- Settings: avatar no wrap clicável ---
  const settingsWrap = document.getElementById('settingsUserAvatarWrap');
  if (settingsWrap) settingsWrap.innerHTML = _userAvatarHtml(currentUser, 52);

  // --- Sidebar user card: refresh avatar when photo changes ---
  _updateSidebarUserCard();
}

// ── Sidebar: populate user card ──────────────────────────────────────────────
function _updateSidebarUserCard() {
  const card    = document.getElementById('sbUserCard');
  const avatarEl = document.getElementById('sbUserAvatar');
  const nameEl  = document.getElementById('sbUserName');
  const roleEl  = document.getElementById('sbUserRole');
  if (!card || !currentUser) return;
  card.style.display = '';
  // Name
  if (nameEl) nameEl.textContent = currentUser.name || currentUser.email?.split('@')[0] || '—';
  // Role label
  const roleLabel =
    currentUser.role === 'owner' ? '👑 Owner' :
    currentUser.role === 'admin' ? '🛡️ Admin' :
    currentUser.role === 'viewer' ? '👁 Visualizador' : '👤 Usuário';
  if (roleEl) roleEl.textContent = roleLabel;
  // Avatar: photo or initials
  if (avatarEl) {
    if (currentUser.avatar_url) {
      avatarEl.innerHTML = `<img src="${esc(currentUser.avatar_url)}" alt="">`;
    } else {
      const initials = (currentUser.name || currentUser.email || '?')
        .split(/\s+/).slice(0,2).map(w => w[0]?.toUpperCase() || '').join('');
      avatarEl.textContent = initials || '?';
    }
  }
}

// Returns a Supabase query with family_id filter applied.
// With RLS enabled, the server will also enforce access.
function famQ(query) {
  // SEMPRE filtrar por family_id.
  // Se o usuário não tem família definida E não é admin/owner, bloquear com
  // um filtro impossível para não vazar dados de outras famílias.
  if (currentUser?.family_id) {
    return query.eq('family_id', currentUser.family_id);
  }
  // Admin/owner sem família = acesso global intencional (vê tudo)
  if (currentUser?.role === 'admin' || currentUser?.role === 'owner') {
    return query;
  }
  // Usuário sem família e sem role admin: retornar filtro impossível (sem dados)
  return query.eq('family_id', '00000000-0000-0000-0000-000000000000');
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

  // app_users: fonte de verdade para dados pessoais e role global
  const { data: appUserRow } = await sb
    .from('app_users')
    .select('id, family_id, avatar_url, role, name, preferred_family_id, show_school_link')
    .eq('email', user.email)
    .maybeSingle();

  // family_members: fonte de verdade para vínculos multi-família
  // Compatibilidade: alguns ambientes antigos podem ter salvo user_id como app_users.id
  // e outros como auth.uid(). Aqui lemos ambos para não perder vínculos.
  let fm = [];
  try {
    const candidateIds = [appUserRow?.id, user.id].filter(Boolean);
    if (candidateIds.length) {
      const { data: fmData } = await sb
        .from('family_members')
        .select('user_id, family_id, role, families(id,name)')
        .in('user_id', candidateIds)
        .order('created_at', { ascending: true });
      fm = fmData || [];
    }
  } catch (_) { /* tabela ainda não existe */ }

  // Role global: app_users tem prioridade (owner/admin global)
  const appRole = appUserRow?.role || 'viewer';

  // Monta lista de famílias disponíveis com o role específico em cada uma
  // Faz deduplicação por família e prioriza o papel mais forte.
  const roleRank = { owner: 4, admin: 3, user: 2, editor: 2, viewer: 1 };
  const byFamily = new Map();
  (fm || []).filter(r => r.family_id).forEach(r => {
    const item = { id: r.family_id, name: r.families?.name || null, role: r.role || 'user' };
    const prev = byFamily.get(item.id);
    if (!prev || (roleRank[item.role] || 0) > (roleRank[prev.role] || 0)) byFamily.set(item.id, item);
  });
  let userFamilies = Array.from(byFamily.values());

  // Completa nomes faltantes direto da tabela families para evitar exibir UUID na UI
  const missingNameIds = userFamilies.filter(f => !f.name || f.name === f.id).map(f => f.id);
  if (missingNameIds.length) {
    try {
      const { data: famRows } = await sb
        .from('families')
        .select('id,name')
        .in('id', missingNameIds);
      const famMap = new Map((famRows || []).map(r => [r.id, r.name]));
      userFamilies = userFamilies.map(f => ({
        ...f,
        name: famMap.get(f.id) || f.name || f.id
      }));
    } catch (_) {}
  }

  // Fallback: se family_members ainda não tem dados, usa app_users.family_id
  // mas tenta buscar o nome real da família para não exibir UUID na UI.
  if (!userFamilies.length && appUserRow?.family_id) {
    let famName = appUserRow.family_id;
    try {
      const { data: famRow } = await sb
        .from('families')
        .select('id,name')
        .eq('id', appUserRow.family_id)
        .maybeSingle();
      famName = famRow?.name || famName;
    } catch (_) {}

    // Admin/owner global mantém poder de gerenciar essa família legada.
    const fallbackRole = (appRole === 'admin' || appRole === 'owner') ? 'owner' : appRole;
    userFamilies = [{ id: appUserRow.family_id, name: famName, role: fallbackRole }];
  }

  // Prioridade: 1) preferência salva no banco, 2) última usada (localStorage), 3) primeira da lista
  const preferredFamId = appUserRow?.preferred_family_id || null;
  const savedFamilyId  = localStorage.getItem('ft_active_family_' + user.id);
  const activeFam =
    (preferredFamId && userFamilies.find(f => f.id === preferredFamId)) ||
    (savedFamilyId  && userFamilies.find(f => f.id === savedFamilyId))  ||
    userFamilies[0] || null;
  const activeFamId   = activeFam?.id || appUserRow?.family_id || null;

  // Role efetivo: admins/owners globais mantêm role global;
  // usuários comuns usam o role que têm na família ativa
  const isGlobal  = appRole === 'admin' || appRole === 'owner';
  const activeRole = isGlobal ? appRole : (activeFam?.role || appRole);

  const r = activeRole;
  const caps = {
    can_view:          true,
    can_create:        r !== 'viewer',
    can_edit:          r !== 'viewer',
    can_delete:        r === 'admin' || r === 'owner',
    can_export:        true,
    can_import:        r === 'admin' || r === 'owner',
    can_admin:         r === 'admin',          // apenas admin vê Configurações/Auditoria
    can_manage_family: r === 'admin' || r === 'owner', // owner gerencia sua família
  };

  currentUser = {
    id:                   user.id,
    email:                user.email || '',
    name:                 appUserRow?.name || user.email || 'Usuário',
    role:                 activeRole,
    family_id:            activeFamId,
    families:             userFamilies,
    avatar_url:           appUserRow?.avatar_url || null,
    preferred_family_id:  appUserRow?.preferred_family_id || null,
    show_school_link:     appUserRow?.show_school_link !== false, // default true
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
  // Topbar user name (hidden on mobile, visible on wider screens)
  const topbarName = document.getElementById('topbarUserName');
  if (topbarName) topbarName.textContent = (currentUser.name || currentUser.email || '').split(' ')[0];
  if (emailEl) {
    const roleLabel =
      currentUser.role === 'owner' ? 'Owner' :
      currentUser.role === 'admin' ? 'Administrador' :
      currentUser.role === 'viewer' ? 'Visualizador' : 'Usuário';
    const famLabel  = currentUser.family_id ? '' : ((currentUser.role==='admin' || currentUser.role==='owner') ? ' · Admin global' : '');
    emailEl.textContent = currentUser.email + ' · ' + roleLabel + famLabel;
  }

  // ── Sidebar user card ──────────────────────────────────────────────────
  _updateSidebarUserCard();

  // Painel de gerenciamento: admin e owner vêem; label diferente por papel
  const _canManage = currentUser.can_admin || currentUser.can_manage_family;
  const _mgmtSec   = document.getElementById('userMgmtSection');
  if (_mgmtSec) _mgmtSec.style.display = _canManage ? '' : 'none';
  if (_canManage) {
    const sub = document.getElementById('userMgmtSub');
    if (sub) sub.textContent = currentUser.can_admin
      ? 'Controle de acesso global · Admin'
      : 'Gerenciar minha família · Owner';
  }

  // Configurações e Auditoria: APENAS admin (sidebar + topbar)
  const auditNavEls    = document.querySelectorAll('#auditNav, #auditNavTopbar');
  const settingsNavEls = document.querySelectorAll('#settingsNav, #settingsNavTopbar');
  auditNavEls.forEach(el    => el.style.display = currentUser.can_admin ? 'flex' : 'none');
  settingsNavEls.forEach(el => el.style.display = currentUser.can_admin ? 'flex' : 'none');
  if (currentUser.can_admin) _checkPendingApprovals();

  // Family switcher (only when user has 2+ families)
  _renderFamilySwitcher();

  // Avatar in topbar, settings and sidebar
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
if (!p.can_admin) {
  const settingsNav = document.querySelector('.nav-item[onclick="navigate(\'settings\')"]');
  if (settingsNav) settingsNav.style.display='none';
  const auditNav = document.getElementById('auditNav');
  if (auditNav) auditNav.style.display='none';
} else {
  const auditNav = document.getElementById('auditNav');
  if (auditNav) auditNav.style.display='';
}

  // Módulo de preços: visibilidade depende de feature flag por família
  if (typeof applyPricesFeature === 'function') applyPricesFeature().catch(() => {});
}

/* ══════════════════════════════════════════════════════════════════
   USER MENU DROPDOWN (topbar avatar)
══════════════════════════════════════════════════════════════════ */

function toggleUserMenu(e) {
  e?.stopPropagation();
  const dd = document.getElementById('userMenuDropdown');
  if (!dd) return;
  const isOpen = dd.style.display !== 'none';
  if (isOpen) { closeUserMenu(); return; }

  // Populate header
  const nameEl  = document.getElementById('userMenuName');
  const emailEl = document.getElementById('userMenuEmail');
  const roleEl  = document.getElementById('userMenuRole');
  const bigEl   = document.getElementById('userMenuAvatarBig');
  if (nameEl)  nameEl.textContent  = currentUser?.name  || '';
  if (emailEl) emailEl.textContent = currentUser?.email || '';
  if (roleEl) {
    const labels = { owner:'👑 Owner', admin:'🔧 Administrador', viewer:'👁 Visualizador', user:'👤 Usuário' };
    const colors = { owner:'#92400e', admin:'#713f12', viewer:'#0369a1', user:'var(--accent)' };
    const r = currentUser?.role || 'user';
    roleEl.innerHTML = `<span style="font-size:.7rem;font-weight:600;color:${colors[r]||'var(--muted)'}">${labels[r]||r}</span>`;
  }
  if (bigEl) bigEl.innerHTML = _userAvatarHtml(currentUser, 44);

  // ── Family switcher inside menu ──
  _renderUserMenuFamilies();

  dd.style.display = '';

  // Close on outside click
  setTimeout(() => document.addEventListener('click', _closeUserMenuOutside), 10);
}

function _closeUserMenuOutside(e) {
  const dd  = document.getElementById('userMenuDropdown');
  const btn = document.getElementById('topbarUserBtn');
  if (dd && btn && !btn.contains(e.target)) {
    closeUserMenu();
  }
}

function closeUserMenu() {
  const dd = document.getElementById('userMenuDropdown');
  if (dd) dd.style.display = 'none';
  document.removeEventListener('click', _closeUserMenuOutside);
}

/* ══════════════════════════════════════════════════════════════════
   MY PROFILE MODAL — avatar + senha num único lugar
══════════════════════════════════════════════════════════════════ */

function openMyProfile() {
  closeUserMenu();
  if (!currentUser) return;

  // --- Avatar preview ---
  const wrap = document.getElementById('myProfileAvatarWrap');
  if (wrap) wrap.innerHTML = _userAvatarHtml(currentUser, 88);

  // --- Info ---
  const nameEl  = document.getElementById('myProfileName');
  const emailEl = document.getElementById('myProfileEmail');
  const roleEl  = document.getElementById('myProfileRoleBadge');
  if (nameEl)  nameEl.textContent  = currentUser.name  || '';
  if (emailEl) emailEl.textContent = currentUser.email || '';
  if (roleEl) {
    const labels = { owner:'👑 Owner', admin:'🔧 Admin', viewer:'👁 Visualizador', user:'👤 Usuário' };
    const bgs    = { owner:'#fef3c7', admin:'#fef9c3', viewer:'#f0f9ff', user:'var(--accent-lt)' };
    const colors = { owner:'#92400e', admin:'#713f12', viewer:'#0369a1', user:'var(--accent)' };
    const r = currentUser.role || 'user';
    roleEl.innerHTML = `<span style="font-size:.7rem;font-weight:700;padding:2px 8px;border-radius:20px;
      background:${bgs[r]||'var(--bg2)'};color:${colors[r]||'var(--text)'}">${labels[r]||r}</span>`;
  }

  // --- Avatar state ---
  const removeBtn = document.getElementById('myProfileRemoveAvatarBtn');
  if (removeBtn) removeBtn.style.display = currentUser.avatar_url ? '' : 'none';
  const fileInput = document.getElementById('myProfileAvatarFile');
  if (fileInput)  fileInput.value = '';
  const flagEl = document.getElementById('myProfileAvatarRemoveFlag');
  if (flagEl) flagEl.value = '';

  // --- Password fields ---
  ['myProfilePwd1','myProfilePwd2'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const bar  = document.getElementById('myProfilePwdBar');
  const hint = document.getElementById('myProfilePwdHint');
  if (bar)  { bar.style.width = '0'; bar.style.background = 'var(--border)'; }
  if (hint) hint.textContent = '';

  // --- Errors ---
  ['myProfileError','myProfileAvatarError'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  });

  // --- Família preferida ---
  const prefSel = document.getElementById('myProfilePreferredFamily');
  if (prefSel && (currentUser.families || []).length > 1) {
    const families = currentUser.families || [];
    prefSel.innerHTML = '<option value="">— Automática (última usada) —</option>' +
      families.map(f => `<option value="${f.id}">${esc(_familyDisplayName(f.id, f.name||''))}</option>`).join('');
    // Ler do banco (via app_users.preferred_family_id armazenado no currentUser)
    prefSel.value = currentUser.preferred_family_id || '';
    document.getElementById('myProfileFamilyRow')?.style.setProperty('display', '');
  } else {
    document.getElementById('myProfileFamilyRow')?.style.setProperty('display', 'none');
  }

  // Gerenciar Família — visível só para owners (e não para admins globais que já têm o painel completo)
  // Family mgmt btn: owner role only (admin has full panel)
  const isFamOwnerOnly = currentUser?.role === 'owner' && _currentUserIsFamilyOwner();
  const famMgmtBtn = document.getElementById('myProfileFamilyMgmtBtn');
  if (famMgmtBtn) famMgmtBtn.style.display = isFamOwnerOnly ? '' : 'none';

  openModal('myProfileModal');
  setTimeout(() => document.getElementById('myProfilePwd1')?.focus(), 200);
}

function previewMyProfileAvatar(input) {
  const file = input?.files?.[0];
  const errEl = document.getElementById('myProfileAvatarError');
  if (errEl) errEl.style.display = 'none';
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    if (errEl) { errEl.textContent = 'Selecione uma imagem (JPG, PNG ou GIF).'; errEl.style.display = ''; }
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    if (errEl) { errEl.textContent = 'Imagem muito grande. Máximo: 2 MB.'; errEl.style.display = ''; }
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    const wrap = document.getElementById('myProfileAvatarWrap');
    if (wrap) wrap.innerHTML = `<img src="${e.target.result}"
      style="width:88px;height:88px;border-radius:50%;object-fit:cover;display:block">`;
    const removeBtn = document.getElementById('myProfileRemoveAvatarBtn');
    if (removeBtn) removeBtn.style.display = '';
    // Clear remove flag
    const flagEl = document.getElementById('myProfileAvatarRemoveFlag');
    if (flagEl) flagEl.value = '';
  };
  reader.readAsDataURL(file);
}

function removeMyProfileAvatar() {
  const wrap = document.getElementById('myProfileAvatarWrap');
  if (wrap) wrap.innerHTML = _userAvatarHtml({ ...currentUser, avatar_url: null }, 88);
  const removeBtn = document.getElementById('myProfileRemoveAvatarBtn');
  if (removeBtn) removeBtn.style.display = 'none';
  const fileInput = document.getElementById('myProfileAvatarFile');
  if (fileInput) fileInput.value = '';
  const flagEl = document.getElementById('myProfileAvatarRemoveFlag');
  if (flagEl) flagEl.value = '1';
}

function updateMyProfilePwdStrength() {
  const pwd  = document.getElementById('myProfilePwd1')?.value || '';
  const bar  = document.getElementById('myProfilePwdBar');
  const hint = document.getElementById('myProfilePwdHint');
  if (!bar || !hint) return;
  if (!pwd) { bar.style.width = '0'; hint.textContent = ''; return; }
  let score = 0;
  if (pwd.length >= 8)  score++;
  if (pwd.length >= 12) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  const levels = [
    { w:'15%', bg:'#ef4444', label:'Muito fraca' },
    { w:'35%', bg:'#f97316', label:'Fraca' },
    { w:'55%', bg:'#eab308', label:'Razoável' },
    { w:'75%', bg:'#22c55e', label:'Boa' },
    { w:'100%',bg:'#16a34a', label:'Forte' },
  ];
  const lv = levels[Math.min(score, 4)];
  bar.style.width      = lv.w;
  bar.style.background = lv.bg;
  hint.style.color     = lv.bg;
  hint.textContent     = lv.label;
}

async function saveMyProfile() {
  const errEl   = document.getElementById('myProfileError');
  const saveBtn = document.getElementById('myProfileSaveBtn');
  if (errEl) errEl.style.display = 'none';

  const avatarFile   = document.getElementById('myProfileAvatarFile')?.files?.[0];
  const avatarRemove = document.getElementById('myProfileAvatarRemoveFlag')?.value === '1';
  const pwd1 = document.getElementById('myProfilePwd1')?.value || '';
  const pwd2 = document.getElementById('myProfilePwd2')?.value || '';

  // Validations
  if (pwd1 && pwd1.length < 8) {
    if (errEl) { errEl.textContent = 'A senha deve ter pelo menos 8 caracteres.'; errEl.style.display = ''; }
    return;
  }
  if (pwd1 && pwd1 !== pwd2) {
    if (errEl) { errEl.textContent = 'As senhas não coincidem.'; errEl.style.display = ''; }
    return;
  }
  const prefFamId = document.getElementById('myProfilePreferredFamily')?.value || null;
  const prefFamChanged = prefFamId !== (currentUser.preferred_family_id || null);

  if (!avatarFile && !avatarRemove && !pwd1 && !prefFamChanged) {
    closeModal('myProfileModal');
    return;
  }

  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ Salvando...'; }

  try {
    // 1. Avatar
    const { data: appRow } = await sb.from('app_users').select('id').eq('email', currentUser.email).maybeSingle();
    if (!appRow) throw new Error('Usuário não encontrado.');

    let newAvatarUrl = currentUser.avatar_url;
    if (avatarFile) {
      newAvatarUrl = await _uploadUserAvatar(appRow.id, avatarFile);
    } else if (avatarRemove) {
      newAvatarUrl = null;
    }

    // Build update payload (avatar + preferred family in one call)
    const updatePayload = {};
    if (newAvatarUrl !== currentUser.avatar_url) updatePayload.avatar_url = newAvatarUrl;
    if (prefFamChanged) updatePayload.preferred_family_id = prefFamId || null;

    if (Object.keys(updatePayload).length > 0) {
      const { error: avErr } = await sb.from('app_users').update(updatePayload).eq('id', appRow.id);
      if (avErr) throw new Error('Erro ao salvar perfil: ' + avErr.message);
      if ('avatar_url' in updatePayload) {
        currentUser.avatar_url = newAvatarUrl;
        _applyCurrentUserAvatar();
      }
      if ('preferred_family_id' in updatePayload) {
        currentUser.preferred_family_id = prefFamId || null;
        // Se escolheu uma família específica, já mudar agora
        if (prefFamId && prefFamId !== currentUser.family_id) {
          await switchFamily(prefFamId);
        }
      }
    }

    // 2. Password
    if (pwd1) {
      const { error: pwdErr } = await sb.auth.updateUser({ password: pwd1 });
      if (pwdErr) throw new Error('Erro ao alterar senha: ' + pwdErr.message);
      // Sync app_users
      const hash = await sha256(pwd1);
      await sb.from('app_users').update({ password_hash: hash, must_change_pwd: false }).eq('id', appRow.id);
    }

    toast('✓ Perfil atualizado!', 'success');
    closeModal('myProfileModal');
  } catch(e) {
    if (errEl) { errEl.textContent = 'Erro: ' + (e.message || e); errEl.style.display = ''; }
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 Salvar'; }
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
function _familyDisplayName(id, fallback='') {
  const fromCache = (_families || []).find(f => String(f.id) === String(id));
  if (fromCache?.name && fromCache.name !== fromCache.id) return fromCache.name;
  const fromUser = (currentUser?.families || []).find(f => String(f.id) === String(id));
  if (fromUser?.name && fromUser.name !== fromUser.id) return fromUser.name;
  return fallback || id || '';
}

async function openUserAdmin() {
  const isAdmin       = currentUser?.role === 'admin';       // acesso total
  const isFamilyOwner = _currentUserIsFamilyOwner();         // owner de ≥1 família
  if (!isAdmin && !isFamilyOwner) { toast('Acesso restrito','error'); return; }

  await loadFamiliesList();
  openModal('userAdminModal');

  // Abas Pendentes e Usuários: apenas admin global
  const tabPending = document.getElementById('uaTabPending');
  const tabUsers   = document.getElementById('uaTabUsers');
  if (tabPending) tabPending.style.display = isAdmin ? '' : 'none';
  if (tabUsers)   tabUsers.style.display   = isAdmin ? '' : 'none';

  if (isAdmin) {
    let pending = null;
    try { const { data: _p } = await sb.rpc('get_pending_users'); pending = _p; } catch {}
    const hasPending = (pending?.length || 0) > 0;
    if (hasPending) {
      switchUATab('pending');
      loadUsersList().catch(()=>{});
    } else {
      switchUATab('users');
      await loadUsersList().catch(()=>{});
    }
    const badge = document.getElementById('uaPendingBadge');
    if (badge) {
      badge.textContent   = pending?.length || 0;
      badge.style.display = (pending?.length || 0) > 0 ? 'inline-block' : 'none';
    }
  } else {
    // Owner: apenas aba Famílias
    switchUATab('families');
  }
}

/** Retorna true se o usuário logado é owner em pelo menos uma família */
function _currentUserIsFamilyOwner() {
  return (currentUser?.families || []).some(f => f.role === 'owner');
}

/** Retorna as famílias onde o usuário logado é owner */
function _ownedFamilies() {
  if (currentUser?.role === 'admin') return _families; // admin global vê tudo
  return (currentUser?.families || [])
    .filter(f => f.role === 'owner')
    .map(f => _families.find(ff => ff.id === f.id) || f);
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
        { user_id: userId, family_id: familyId, role: 'user' },
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
  // ── Carregar famílias ──────────────────────────────────────────────────────
  let families = [];
  try {
    const { data: rpcData, error: rpcErr } = await sb.rpc('get_manageable_families');
    if (!rpcErr && Array.isArray(rpcData)) {
      families = rpcData;
    } else {
      const { data, error } = await sb.from('families').select('*').order('name');
      if (error) throw error;
      families = data || [];
    }
  } catch(e) {
    const el = document.getElementById('familiesList');
    if (el) el.innerHTML = `<div style="background:var(--amber-lt);border:1px solid var(--amber);border-radius:8px;padding:14px;font-size:.82rem">
      ⚠️ <strong>Não foi possível carregar as famílias.</strong><br>
      Verifique as RPCs de gestão de família no Supabase.<br><br>
      <span style="color:var(--muted)">Erro técnico: ${esc(e?.message || 'desconhecido')}</span>
    </div>`;
    return;
  }
  _families = (families || []).map(f => ({
    ...f,
    name: (f?.name && f.name !== f.id) ? f.name : _familyDisplayName(f.id, f?.name || '')
  })).map(f => ({ ...f, name: _familyDisplayName(f.id, f.name || '') || f.id }));

  const el = document.getElementById('familiesList');
  if (!el) return;

  if (!_families.length) {
    el.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted)">Nenhuma família cadastrada. Clique em "+ Nova Família" para começar.</div>';
    return;
  }

  // ── Carregar membros via RPC SECURITY DEFINER (bypassa RLS) ──────────────
  let allMembers = [];
  try {
    const { data: rpcData, error: rpcErr } = await sb.rpc('get_all_family_members');
    if (!rpcErr && rpcData) {
      allMembers = rpcData;
    } else {
      // Fallback: join direto (funciona se RLS permitir)
      const { data: fmData } = await sb
        .from('family_members')
        .select('member_id:id, user_id, family_id, member_role:role, created_at, user_name:app_users(name), user_email:app_users(email), user_role:app_users(role), user_active:app_users(active), user_avatar:app_users(avatar_url)')
        .order('family_id');
      allMembers = (fmData || []).map(r => ({
        ...r,
        user_name:   r.user_name?.name   || '—',
        user_email:  r.user_email?.email || '—',
        user_role:   r.user_role?.role   || 'user',
        user_active: r.user_active?.active ?? true,
        user_avatar: r.user_avatar?.avatar_url || null,
      }));
    }
  } catch(_) {}

  // ── Carregar todos os usuários aprovados para o dropdown "Adicionar" ──────
  const { data: allUsers } = await sb
    .from('app_users')
    .select('id,name,email,role,active,approved')
    .eq('approved', true)
    .order('name');

  // Índice: family_id → membros
  const membersByFamily = {};
  allMembers.forEach(m => {
    if (!membersByFamily[m.family_id]) membersByFamily[m.family_id] = [];
    membersByFamily[m.family_id].push(m);
  });

  // Índice: user_id → set de family_ids (para saber se já é membro)
  const familiesByUser = {};
  allMembers.forEach(m => {
    if (!familiesByUser[m.user_id]) familiesByUser[m.user_id] = new Set();
    familiesByUser[m.user_id].add(m.family_id);
  });

  const roleBadgeClass = r =>
    r === 'owner' ? 'style="background:#fef3c7;color:#92400e;border:1px solid #f59e0b"'
    : r === 'admin' ? 'style="background:#fef3c7;color:#b45309"'
    : r === 'viewer' ? 'style="background:var(--bg2);color:var(--muted)"'
    : 'style="background:var(--accent-lt);color:var(--accent)"';

  const roleIcon = r => ({ owner:'👑', admin:'🔧', user:'👤', viewer:'👁' })[r] || '👤';
  const roleLabel = r => ({ owner:'Owner', admin:'Admin', user:'Usuário', viewer:'Visualizador' })[r] || r;

  const isGlobalAdmin = currentUser?.role === 'admin'; // owner vê só as suas famílias

  // If not global admin, show only families where user is owner
  const visibleFamilies = isGlobalAdmin ? _families : _ownedFamilies();

  if (!visibleFamilies.length && !isGlobalAdmin) {
    el.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted);font-size:.83rem">Você não é owner de nenhuma família.<br>Apenas owners podem gerenciar famílias.</div>';
    return;
  }

  // Show "+ Nova Família" button only to global admins and family owners
  const newFamBtn = document.querySelector('#uaFamilies .btn-primary');
  if (newFamBtn) newFamBtn.style.display = '';

  el.innerHTML = visibleFamilies.map(f => {
    const members = membersByFamily[f.id] || [];

    const membersHtml = members.length
      ? members.map(m => `
        <div class="fm-row" data-member-id="${m.member_id||''}" data-user-id="${m.user_id}" data-family-id="${f.id}">
          <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">
            ${_userAvatarHtml({ avatar_url: m.user_avatar, role: m.user_role, name: m.user_name }, 30)}
            <div style="min-width:0">
              <div style="font-size:.83rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(m.user_name||'—')}</div>
              <div style="font-size:.72rem;color:var(--muted)">${esc(m.user_email||'—')}</div>
            </div>
          </div>
          <select class="fm-role-sel" data-uid="${m.user_id}" data-fid="${f.id}"
                  style="font-size:.78rem;padding:3px 6px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);width:120px"
                  onchange="updateMemberRole(this)">
            <option value="owner"   ${m.member_role==='owner'   ? 'selected':''}>👑 Owner</option>
            <option value="admin"   ${m.member_role==='admin'   ? 'selected':''}>🔧 Admin</option>
            <option value="user"    ${m.member_role==='user'    ? 'selected':''}>👤 Usuário</option>
            <option value="viewer"  ${m.member_role==='viewer'  ? 'selected':''}>👁 Visualizador</option>
          </select>
          <button class="btn-icon" title="Remover da família"
                  onclick="removeUserFromFamily('${m.user_id}','${esc(m.user_name||m.user_email)}','${esc(_familyDisplayName(f.id, f.name||''))}','${f.id}')">✕</button>
        </div>`).join('')
      : '<div style="font-size:.78rem;color:var(--muted);padding:10px 0;text-align:center">Nenhum membro ainda</div>';

    // Usuários que ainda NÃO são membros desta família
    const available = (allUsers||[]).filter(u => !familiesByUser[u.id]?.has(f.id));

    return `<div class="card" style="margin-bottom:14px">
      <div class="card-header">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:38px;height:38px;border-radius:10px;background:var(--accent-lt);display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0">🏠</div>
          <div>
            <div style="font-weight:700;font-size:.95rem">${esc(_familyDisplayName(f.id, f.name||''))}</div>
            <div style="font-size:.74rem;color:var(--muted)">${members.length} membro${members.length!==1?'s':''} ${f.description ? '· ' + esc(f.description) : ''}</div>
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          <label style="display:flex;align-items:center;gap:5px;font-size:.75rem;cursor:pointer;user-select:none;padding:3px 8px;border:1px solid var(--border);border-radius:6px" title="Módulo de Gestão de Preços">
            <input type="checkbox" id="pricesFamToggle-${f.id}"
                   onchange="toggleFamilyPrices('${f.id}', this.checked)"
                   style="width:13px;height:13px;accent-color:var(--accent);cursor:pointer">
            🏷️ Preços
          </label>
          ${(isGlobalAdmin || membersByFamily[f.id]?.some(m => m.user_email === currentUser?.email && m.member_role === 'owner')) ? `
            <button class="btn btn-ghost btn-sm" onclick="editFamily('${f.id}')" style="padding:3px 10px;font-size:.73rem">✏️ Editar</button>
            <button class="btn btn-ghost btn-sm" id="wipeFamBtn-${f.id}" onclick="wipeFamilyData('${f.id}','${esc(f.name).replace(/'/g,"\\'")}')" style="padding:3px 10px;font-size:.73rem;color:var(--amber,#f59e0b)" title="Apagar todos os dados desta família">🗑️ Dados</button>
            <button class="btn btn-ghost btn-sm" onclick="deleteFamily('${f.id}','${esc(f.name).replace(/'/g,"\\'")}')" style="padding:3px 10px;font-size:.73rem;color:var(--red)" title="Excluir família">✕ Excluir</button>
          ` : ''}
        </div>
      </div>
      <div style="padding:4px 0">
        ${membersHtml}
        ${available.length ? `
        <div class="fm-add-row">
          <select id="addMemberSel-${f.id}" style="font-size:.8rem;flex:1">
            <option value="">— Adicionar usuário existente —</option>
            ${available.map(u => `<option value="${u.id}">${esc(u.name||u.email)}</option>`).join('')}
          </select>
          <select id="addMemberRole-${f.id}" style="font-size:.8rem;width:130px">
            <option value="user">👤 Usuário</option>
            <option value="admin">🔧 Admin</option>
            <option value="viewer">👁 Visualizador</option>
            <option value="owner">👑 Owner</option>
          </select>
          <button class="btn btn-primary btn-sm" onclick="addUserToFamily('${f.id}')"
                  style="font-size:.78rem;white-space:nowrap">+ Adicionar</button>
        </div>` : ''}
        <!-- Convidar novo usuário por e-mail -->
        <div class="fm-invite-row">
          <span style="font-size:.73rem;color:var(--muted);font-weight:600;white-space:nowrap">📨 Convidar por e-mail:</span>
          <input type="email" id="inviteEmail-${f.id}" placeholder="email@exemplo.com"
                 style="font-size:.8rem;flex:1;min-width:140px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text)"
                 onkeydown="if(event.key==='Enter')inviteToFamily('${f.id}','${esc(f.name).replace(/'/g,"\\'")}')" />
          <select id="inviteRole-${f.id}" style="font-size:.8rem;width:120px">
            <option value="user">👤 Usuário</option>
            <option value="admin">🔧 Admin</option>
            <option value="viewer">👁 Visualizador</option>
            <option value="owner">👑 Owner</option>
          </select>
          <button class="btn btn-primary btn-sm" id="inviteBtn-${f.id}"
                  onclick="inviteToFamily('${f.id}','${esc(f.name).replace(/'/g,"\\'")}')"
                  style="font-size:.78rem;white-space:nowrap">📨 Convidar</button>
        </div>
      </div>
    </div>`;
  }).join('');

  // Set prices toggle state for each visible family
  setTimeout(async () => {
    for (const f of visibleFamilies) {
      const cb = document.getElementById('pricesFamToggle-' + f.id);
      if (!cb) continue;
      try {
        const val = await getAppSetting('prices_enabled_' + f.id, false);
        cb.checked = val === true || val === 'true';
      } catch {}
    }
  }, 50);
}

function showFamilyForm(id='') {
  document.getElementById('editFamilyId').value = id;
  document.getElementById('fName').value = '';
  document.getElementById('fDesc').value = '';
  document.getElementById('familyFormTitle').textContent = id ? 'Editar Família' : 'Nova Família';
  document.getElementById('familyFormArea').style.display = '';
  if (id) {
    const f = _families.find(x => x.id === id) || (currentUser?.families || []).find(x => x.id === id);
    if (f) {
      document.getElementById('fName').value = _familyDisplayName(id, f.name || '');
      document.getElementById('fDesc').value = f.description||'';
    }
  }
}

function editFamily(id) { showFamilyForm(id); document.getElementById('familyFormArea').scrollIntoView({behavior:'smooth'}); }

async function saveFamily() {
  const id   = document.getElementById('editFamilyId').value;
  const name = document.getElementById('fName').value.trim();
  const desc = document.getElementById('fDesc').value.trim();
  if (!name) { toast('Informe o nome da família','error'); return; }

  const isGlobalAdmin = currentUser?.role === 'admin';
  const isFamOwner    = !id || (currentUser?.families||[]).some(f => f.id === id && f.role === 'owner');
  if (!isGlobalAdmin && !isFamOwner) { toast('Sem permissão para editar esta família','error'); return; }

  let error = null;
  try {
    if (id) {
      const rpc = await sb.rpc('update_family_as_owner', {
        p_family_id: id,
        p_name: name,
        p_description: desc || null
      });
      if (rpc.error) throw rpc.error;
    } else {
      const rpc = await sb.rpc('create_family_with_owner', {
        p_name: name,
        p_description: desc || null
      });
      if (rpc.error) throw rpc.error;
    }
  } catch (e) {
    error = e;
  }
  if (error) { toast('Erro: ' + error.message,'error'); return; }

  toast(id ? '✓ Família atualizada!' : '✓ Família criada! Você é o owner.','success');
  document.getElementById('familyFormArea').style.display = 'none';
  await _loadCurrentUserContext().catch(()=>{});
  await loadFamiliesList();
  updateUserUI();
  _renderFamilySwitcher();
}

async function deleteFamily(id, name) {
  const isGlobalAdmin = currentUser?.role === 'owner' || currentUser?.role === 'admin' || currentUser?.can_admin;
  const isFamOwner    = (currentUser?.families || []).some(f => f.id === id && f.role === 'owner');

  if (!isGlobalAdmin && !isFamOwner) { toast('Apenas admins ou o owner da família podem excluir','error'); return; }

  // Owner de família: não pode excluir se for a única que possui
  if (!isGlobalAdmin && isFamOwner) {
    const ownedCount = (currentUser?.families || []).filter(f => f.role === 'owner').length;
    if (ownedCount <= 1) {
      toast('Você não pode excluir sua única família. Crie outra primeiro.','warning');
      return;
    }
  }

  if (!confirm(`Excluir a família "${name}"?

Todos os registros relacionados a esta família serão excluídos do banco de dados.

Esta ação não pode ser desfeita.`)) return;
  const { error } = await sb.rpc('delete_family_cascade', { p_family_id: id });
  if (error) { toast('Erro: '+error.message,'error'); return; }
  toast('Família removida','success');
  await _loadCurrentUserContext().catch(()=>{});
  await loadFamiliesList();
  updateUserUI();
  _renderFamilySwitcher();
}

async function wipeFamilyData(id, name) {
  // Apaga TODOS os dados da família (transações, contas, etc.) mas mantém a família e membros
  const isFamOwner = (currentUser?.families || []).some(f => f.id === id && f.role === 'owner');
  const isGlobalAdmin = currentUser?.role === 'admin';
  if (!isGlobalAdmin && !isFamOwner) { toast('Apenas o owner da família pode limpar os dados','error'); return; }

  // Confirmação dupla
  const conf1 = confirm(`⚠️ ATENÇÃO: Você está prestes a APAGAR TODOS OS DADOS da família "${name}".\n\nIsso inclui: transações, contas, categorias, beneficiários, orçamentos, transações programadas e anexos.\n\nOs membros e a família em si serão mantidos.\n\nDeseja continuar?`);
  if (!conf1) return;
  const typed = window.prompt(`Para confirmar, digite exatamente o nome da família:\n"${name}"`);
  if (typed !== name) { toast('Nome incorreto — operação cancelada','warning'); return; }

  const btn = document.getElementById(`wipeFamBtn-${id}`);
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Limpando...'; }

  try {
    // Apagar na ordem correta (FK constraints)
    const tables = ['attachments','scheduled_transactions','budgets','transactions','accounts','payees','categories'];
    for (const table of tables) {
      const { error } = await sb.from(table).delete().eq('family_id', id);
      if (error) console.warn(`wipe ${table}:`, error.message);
    }
    toast(`✓ Dados da família "${name}" removidos com sucesso`, 'success');
    await loadFamiliesList();
  } catch(e) {
    toast('Erro ao limpar dados: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🗑️ Limpar Dados'; }
  }
}

async function inviteToFamily(familyId, familyName) {
  const emailEl = document.getElementById(`inviteEmail-${familyId}`);
  const roleEl  = document.getElementById(`inviteRole-${familyId}`);
  const email   = emailEl?.value.trim().toLowerCase();
  const role    = roleEl?.value || 'user';

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    toast('Informe um e-mail válido','error'); return;
  }

  const isFamOwner = (currentUser?.families || []).some(f => f.id === familyId && f.role === 'owner');
  const isGlobalAdmin = currentUser?.role === 'admin';
  if (!isGlobalAdmin && !isFamOwner) { toast('Apenas o owner pode convidar','error'); return; }

  const btn = document.getElementById(`inviteBtn-${familyId}`);
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Enviando...'; }

  try {
    // Verificar se já é usuário cadastrado
    const { data: existing } = await sb.from('app_users').select('id,name,approved,active').eq('email', email).maybeSingle();

    if (existing) {
      // Usuário já existe: adicionar diretamente à família
      const { error } = await sb.from('family_members').upsert(
        { user_id: existing.id, family_id: familyId, role },
        { onConflict: 'user_id,family_id' }
      );
      if (error) throw new Error(error.message);
      toast(`✓ ${email} adicionado à família como ${role}`, 'success');
    } else {
      // Usuário novo: criar registro pendente com vínculo à família
      const { data: newUser, error: insErr } = await sb.from('app_users').insert({
        email,
        name:       email.split('@')[0],
        role:       'user',
        approved:   false,
        active:     false,
        family_id:  familyId,
        must_change_pwd: true,
      }).select().single();
      if (insErr) throw new Error(insErr.message);

      // Adicionar em family_members com role escolhido
      await sb.from('family_members').insert({ user_id: newUser.id, family_id: familyId, role });

      // Enviar e-mail de convite via EmailJS
      await _sendInviteEmail(email, familyName, currentUser.name || currentUser.email);
      toast(`✓ Convite enviado para ${email}`, 'success');
    }

    if (emailEl) emailEl.value = '';
    await loadFamiliesList();
  } catch(e) {
    toast('Erro ao convidar: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📨 Convidar'; }
  }
}

async function _sendInviteEmail(toEmail, familyName, inviterName) {
  try {
    const { autoCheckConfig } = await _getAutoCheckConfig();
    const serviceId  = autoCheckConfig?.emailServiceId  || 'service_8e4rkde';
    const publicKey  = autoCheckConfig?.emailPublicKey  || 'wwnXjEFDaVY7K-qIjwX0H';
    const templateId = autoCheckConfig?.emailTemplateId || 'template_fla7gdi';
    const appUrl     = window.location.origin + window.location.pathname;

    await emailjs.send(serviceId, templateId, {
      to_email:    toEmail,
      subject:     `Convite para a família "${familyName}" no FinTrack`,
      message:     `Você foi convidado por ${inviterName} para participar da família "${familyName}" no FinTrack.\n\nAcesse ${appUrl} e solicite acesso com este e-mail (${toEmail}).\n\nSeu acesso será aprovado automaticamente após o login.`,
      family_name: familyName,
      inviter:     inviterName,
      app_url:     appUrl,
    }, publicKey);
  } catch(e) {
    console.warn('[InviteEmail]', e.message);
    // Não falhar o fluxo por erro de e-mail
  }
}

async function addUserToFamily(familyId) {
  const sel     = document.getElementById(`addMemberSel-${familyId}`);
  const roleSel = document.getElementById(`addMemberRole-${familyId}`);
  const userId  = sel?.value;
  const role    = roleSel?.value || 'user';
  if (!userId) { toast('Selecione um usuário','error'); return; }

  // Inserir em family_members (upsert para ser idempotente)
  const { error } = await sb.from('family_members').upsert(
    { user_id: userId, family_id: familyId, role },
    { onConflict: 'user_id,family_id' }
  );
  if (error) { toast('Erro: '+error.message,'error'); return; }

  // Manter app_users.family_id sincronizado (para compatibilidade com código legado)
  await sb.from('app_users').update({ family_id: familyId }).eq('id', userId);

  const roleLabel = { owner:'Owner', admin:'Admin', user:'Usuário', viewer:'Visualizador' }[role] || role;
  toast(`✓ Usuário adicionado como ${roleLabel}`, 'success');
  await loadFamiliesList();
}


// ── Preços: toggle por família (admin only) ───────────────────────────────
async function toggleFamilyPrices(familyId, enabled) {
  try {
    await saveAppSetting('prices_enabled_' + familyId, enabled);
    toast(enabled ? '✓ Gestão de Preços ativada' : 'Gestão de Preços desativada', 'success');
    try { if (typeof applyPricesFeature === 'function') await applyPricesFeature(); } catch {}
  } catch (e) {
    toast('Erro: ' + e.message, 'error');
  }
}
async function removeUserFromFamily(userId, userName, familyName, familyId) {
  if (!confirm(`Remover "${userName}" da família "${familyName}"?\n\nO usuário perderá acesso a esta família.`)) return;

  // Remover de family_members
  const { error } = await sb.from('family_members')
    .delete().eq('user_id', userId).eq('family_id', familyId);
  if (error) { toast('Erro: '+error.message,'error'); return; }

  // Se app_users.family_id aponta para esta família, limpar
  const { data: au } = await sb.from('app_users').select('family_id').eq('id', userId).maybeSingle();
  if (au?.family_id === familyId) {
    // Verificar se tem outra família em family_members para usar como fallback
    const { data: remaining } = await sb.from('family_members')
      .select('family_id').eq('user_id', userId).order('created_at').limit(1);
    const fallback = remaining?.[0]?.family_id || null;
    await sb.from('app_users').update({ family_id: fallback }).eq('id', userId);
  }

  toast('✓ Usuário removido da família', 'success');
  await loadFamiliesList();
}

async function updateMemberRole(selectEl) {
  const userId   = selectEl.dataset.uid;
  const familyId = selectEl.dataset.fid;
  const newRole  = selectEl.value;
  const { error } = await sb.from('family_members')
    .update({ role: newRole }).eq('user_id', userId).eq('family_id', familyId);
  if (error) {
    toast('Erro ao alterar perfil: '+error.message, 'error');
    // Revert select visually
    await loadFamiliesList();
    return;
  }
  const roleLabel = { owner:'Owner', admin:'Admin', user:'Usuário', viewer:'Visualizador' }[newRole] || newRole;
  toast(`✓ Perfil atualizado para ${roleLabel}`, 'success');
}

// ── USERS ─────────────────────────────────────────────────────────

async function loadUsersList() {
  if (currentUser?.role !== 'admin') return; // apenas admin lista todos os usuários
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

  // Load family memberships for all users
  let allMembers = [];
  try {
    const { data: rpcData } = await sb.rpc('get_all_family_members');
    allMembers = rpcData || [];
  } catch(_) {}

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
        <td style="font-size:.78rem;color:var(--text2)">
          ${(() => {
            const userFams = (allMembers||[]).filter(m => m.user_id === u.id);
            if (!userFams.length) return '<span style="color:var(--muted)">—</span>';
            return userFams.map(m => {
              const roleIcon = {owner:'👑',admin:'🔧',user:'👤',viewer:'👁'}[m.member_role]||'👤';
              return `<span style="display:inline-flex;align-items:center;gap:3px;background:var(--accent-lt);color:var(--accent);border-radius:4px;padding:1px 6px;font-size:.7rem;margin:1px">${roleIcon} ${esc(m.family_name||'—')}</span>`;
            }).join('');
          })()}
        </td>
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
  const initFamSel = document.getElementById('uInitFamilyId');
  if (initFamSel) { initFamSel.innerHTML = '<option value="">— Nenhuma (admin global) —</option>' + _families.map(f => `<option value="${f.id}">${esc(_familyDisplayName(f.id, f.name||''))}</option>`).join(''); initFamSel.value = ''; }
  const initRoleSel = document.getElementById('uInitFamilyRole'); if (initRoleSel) initRoleSel.value = 'user';
  document.getElementById('pView').checked = true;
  document.getElementById('pCreate').checked = true;
  document.getElementById('pEdit').checked = true;
  document.getElementById('pDelete').checked = false;
  document.getElementById('pExport').checked = true;
  document.getElementById('pImport').checked = false;
  document.getElementById('pwdHint').textContent = '(mín. 8 chars)';
  const pSchoolNew = document.getElementById('pSchoolLink');
  if (pSchoolNew) pSchoolNew.checked = true;
  const schoolCfgN = _getSchoolLinkConfig?.();
  const schoolRowN = document.getElementById('schoolLinkPermRow');
  if (schoolRowN) schoolRowN.style.display = (schoolCfgN?.enabled && schoolCfgN?.url) ? '' : 'none';
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
  // Multi-família: o vínculo é gerenciado na aba Famílias; campo inicial só aparece em novos usuários
  const initFamSelE = document.getElementById('uInitFamilyId'); if (initFamSelE) initFamSelE.style.display = 'none';
  const initRoleSelE = document.getElementById('uInitFamilyRole'); if (initRoleSelE) initRoleSelE.style.display = 'none';
  const initFamLabel = document.querySelector('label[for="uInitFamilyId"]');
  document.getElementById('pView').checked   = u.can_view;
  document.getElementById('pCreate').checked = u.can_create;
  document.getElementById('pEdit').checked   = u.can_edit;
  document.getElementById('pDelete').checked = u.can_delete;
  document.getElementById('pExport').checked = u.can_export;
  document.getElementById('pImport').checked = u.can_import;
  document.getElementById('pwdHint').textContent = '(deixe em branco para manter)';

  // Ícone da escola
  const schoolCfg = _getSchoolLinkConfig?.();
  const schoolRow = document.getElementById('schoolLinkPermRow');
  if (schoolRow) schoolRow.style.display = (schoolCfg?.enabled && schoolCfg?.url) ? '' : 'none';
  const pSchool = document.getElementById('pSchoolLink');
  if (pSchool) pSchool.checked = u.show_school_link !== false; // default true

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
  const userId = document.getElementById('editUserId').value;
  const name   = document.getElementById('uName').value.trim();
  const email  = document.getElementById('uEmail').value.trim().toLowerCase();
  const pwd    = document.getElementById('uPassword').value;
  const role   = document.getElementById('uRole').value;
  if (!name || !email) { toast('Preencha nome e e-mail','error'); return; }
  if (!userId && pwd.length < 8) { toast('Senha deve ter pelo menos 8 caracteres','error'); return; }
  if (userId && pwd && pwd.length < 8) { toast('Senha deve ter pelo menos 8 caracteres','error'); return; }

  // Handle avatar upload/removal
  let avatarUrl = undefined;
  const avatarFile   = document.getElementById('uAvatarFile')?.files?.[0];
  const avatarRemove = document.getElementById('uAvatarRemoveFlag')?.value === '1';
  if (avatarFile && userId) {
    try { avatarUrl = await _uploadUserAvatar(userId, avatarFile); }
    catch(e) { toast('Aviso: ' + e.message, 'warning'); }
  } else if (avatarRemove && userId) {
    avatarUrl = null;
  }

  // app_users record — sem family_id (gerenciado por family_members)
  const record = {
    name, email, role,
    can_view:        document.getElementById('pView').checked,
    can_create:      document.getElementById('pCreate').checked,
    can_edit:        document.getElementById('pEdit').checked,
    can_delete:      document.getElementById('pDelete').checked,
    can_export:      document.getElementById('pExport').checked,
    can_import:      document.getElementById('pImport').checked,
    can_admin:         role === 'admin',
    show_school_link: document.getElementById('pSchoolLink')?.checked ?? true,
  };
  if (avatarUrl !== undefined) record.avatar_url = avatarUrl;
  if (pwd) record.password_hash = await sha256(pwd);
  const flagEl = document.getElementById('uAvatarRemoveFlag'); if (flagEl) flagEl.value = '';
  if (!userId) {
    record.must_change_pwd = false;
    record.active          = true;
    record.approved        = true;
    record.created_by      = currentUser?.id;
  }

  try {
    let savedId = userId;
    let error;

    if (userId) {
      ({ error } = await sb.from('app_users').update(record).eq('id', userId));
    } else {
      const { data: ins, error: insErr } = await sb.from('app_users').insert(record).select('id').single();
      error = insErr;
      if (ins?.id) savedId = ins.id;
    }
    if (error) throw error;

    // Para novos usuários: vincular família inicial se informada
    if (!userId) {
      const initFam = document.getElementById('uInitFamilyId')?.value;
      const initRole = document.getElementById('uInitFamilyRole')?.value || 'user';
      if (initFam && savedId) {
        await sb.from('family_members').upsert(
          { user_id: savedId, family_id: initFam, role: initRole },
          { onConflict: 'user_id,family_id' }
        );
        await sb.from('app_users').update({ family_id: initFam }).eq('id', savedId);
      }
    }

    toast(userId ? '✓ Usuário atualizado!' : '✓ Usuário criado!', 'success');
    document.getElementById('userFormArea').style.display = 'none';
    if (userId === currentUser?.id) {
      if (record.avatar_url !== undefined) currentUser.avatar_url = record.avatar_url;
      _applyCurrentUserAvatar();
    }
    await loadUsersList();
    await loadFamiliesList();
  } catch(e) { toast('Erro: '+e.message,'error'); }
}

async function approveUser(userId, userName) {
  document.getElementById('approvalUserId').value = userId;
  document.getElementById('approvalUserName').textContent = userName;
  document.getElementById('approvalFamilyId').innerHTML =
    '<option value="">— Nenhuma (admin global) —</option>' +
    _families.map(f => `<option value="${f.id}">${esc(_familyDisplayName(f.id, f.name||''))}</option>`).join('');
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

    // 2. Atualizar senha via Admin API do Supabase
    // Estratégia em cascata:
    //   2a. SDK sbAdmin (service_role key) → updateUserById  [mais confiável]
    //   2b. RPC set_user_password (SECURITY DEFINER)         [fallback sem service key]
    let authUpdated = false;
    const admin = sbAdmin || initSbAdmin();

    if (admin) {
      // 2a. Buscar uid no auth via listUsers paginado (page 1, perPage 1000)
      // e filtrar localmente — evita o endpoint ?email= que o Supabase bloqueia
      try {
        const { data: listData, error: listErr } = await admin.auth.admin.listUsers({
          page: 1, perPage: 1000
        });
        if (listErr) throw listErr;
        const authUser = (listData?.users || []).find(
          u => u.email?.toLowerCase() === targetEmail.toLowerCase()
        );
        if (!authUser?.id) throw new Error('Usuário não encontrado no Auth: ' + targetEmail);
        const { error: updErr } = await admin.auth.admin.updateUserById(
          authUser.id, { password: pwd1 }
        );
        if (updErr) throw updErr;
        authUpdated = true;
      } catch(sdkErr) {
        console.warn('[resetPwd] SDK Admin falhou, tentando RPC:', sdkErr.message);
      }
    }

    if (!authUpdated) {
      // 2b. Fallback: RPC SECURITY DEFINER (requer migration_set_password.sql)
      const { data: rpcData, error: rpcErr } = await sb.rpc('set_user_password', {
        p_email:    targetEmail,
        p_password: pwd1
      });
      if (rpcErr) {
        if (rpcErr.code === '42883' || rpcErr.message?.includes('function')) {
          throw new Error(
            'Configure a Service Role Key em Configurações, ou execute migration_set_password.sql no Supabase.'
          );
        }
        throw new Error('RPC: ' + rpcErr.message);
      }
      if (rpcData?.error) throw new Error(rpcData.error);
      authUpdated = true;
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


// ── Family switcher — inside user menu dropdown ──────────────────────────────
function _renderFamilySwitcher() {
  // Mantido para compatibilidade — a lógica real está em _renderUserMenuFamilies()
  // chamada ao abrir o menu do usuário
}

function _renderUserMenuFamilies() {
  const families = currentUser?.families || [];
  const section  = document.getElementById('userMenuFamilySection');
  const list     = document.getElementById('userMenuFamilyList');
  if (!section || !list) return;

  // Botão "Gerenciar Família" para owners (mesmo que tenha só 1 família)
  const isFamOwner    = families.some(f => f.role === 'owner');
  const isGlobalAdmin = currentUser?.role === 'owner' || currentUser?.role === 'admin' || currentUser?.can_admin;
  const manageFamBtn  = document.getElementById('umManageFamilyBtn');
  if (manageFamBtn) {
    manageFamBtn.style.display = (isFamOwner || isGlobalAdmin) ? '' : 'none';
  }

  // Ocultar switcher se só tiver 0 ou 1 família
  if (families.length <= 1) { section.style.display = 'none'; return; }
  section.style.display = '';

  const roleIcon  = r => ({ owner:'👑', admin:'🔧', user:'👤', viewer:'👁' }[r] || '👤');
  const roleLabel = r => ({ owner:'Owner', admin:'Admin', user:'Usuário', viewer:'Visualizador' }[r] || r);
  const roleBg    = r => ({ owner:'#fef3c7', admin:'#fef9c3', user:'var(--accent-lt)', viewer:'var(--bg2)' }[r] || 'var(--bg2)');
  const roleColor = r => ({ owner:'#92400e', admin:'#b45309', user:'var(--accent)', viewer:'var(--muted)' }[r] || 'var(--muted)');

  list.innerHTML = families.map(f => {
    // Comparar como string para evitar falhas por tipo/espaço
    const isActive = String(f.id).trim() === String(currentUser.family_id || '').trim();
    return `
      <button class="um-family-item${isActive ? ' um-family-item--active' : ''}"
              onclick="_pickFamilyFromMenu('${f.id}')">
        <div class="um-family-icon" style="${isActive ? 'background:var(--accent);border-color:var(--accent)' : ''}">
          ${isActive
            ? '<span style="font-size:.9rem;line-height:1">🏠</span>'
            : '<span style="font-size:.9rem;line-height:1;opacity:.45">🏠</span>'
          }
        </div>
        <div class="um-family-body">
          <div class="um-family-name">${esc(_familyDisplayName(f.id, f.name||''))}</div>
          <div class="um-family-role" style="background:${roleBg(f.role)};color:${roleColor(f.role)}">
            ${roleIcon(f.role)} ${roleLabel(f.role)}
          </div>
        </div>
        ${isActive ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="3" style="flex-shrink:0"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
      </button>`;
  }).join('');
}

async function _pickFamilyFromMenu(familyId) {
  closeUserMenu();
  await switchFamily(familyId);
}

async function switchFamily(familyId) {
  if (!familyId || familyId === currentUser?.family_id) return;
  const fam = (currentUser.families || []).find(f => f.id === familyId);
  if (!fam) return;

  // (loading state handled by menu closing on click)

  currentUser.family_id = familyId;
  // Atualiza role para o perfil do usuário NESSA família
  if (currentUser.role !== 'admin' && currentUser.role !== 'owner') {
    currentUser.role = fam.role || 'user';
    const r = currentUser.role;
    currentUser.can_create = r !== 'viewer';
    currentUser.can_edit   = r !== 'viewer';
    currentUser.can_delete = r === 'admin' || r === 'owner';
    currentUser.can_import = r === 'admin' || r === 'owner';
    currentUser.can_admin         = r === 'admin';
    currentUser.can_manage_family = r === 'admin' || r === 'owner';
  }

  localStorage.setItem('ft_active_family_' + currentUser.id, familyId);

  try {
    await Promise.all([
      loadAccounts().catch(()=>{}),
      loadCategories().catch(()=>{}),
      loadPayees().catch(()=>{}),
      loadAppSettings().catch(()=>{})
    ]);
    populateSelects();
    navigate(state.currentPage || 'dashboard');
  } finally {
    // nothing to restore
  }

  const roleIcon = { owner:'👑', admin:'🔧', user:'👤', viewer:'👁' }[currentUser.role] || '👤';
  toast(roleIcon + ' ' + fam.name, 'success');
  updateUserUI();
  _renderFamilySwitcher();
}

function _roleLabel(role) {
  return { owner:'Owner', admin:'Admin', user:'Usuário', viewer:'Visualizador' }[role] || role;
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

// ══════════════════════════════════════════════════════════════════════════════
// FAMILY MANAGEMENT PANEL (owner) — openMyFamilyMgmt + helpers
// ══════════════════════════════════════════════════════════════════════════════

let _mfmActiveFamilyId = null;

async function openMyFamilyMgmt() {
  // Famílias onde o usuário é owner (pega do cache _families ou busca do banco)
  let ownedFams = (currentUser?.families || []).filter(f => f.role === 'owner');
  if (!ownedFams.length) { toast('Você não é owner de nenhuma família','warning'); return; }

  // Garantir que _families está populado (pode estar vazio se veio direto do perfil)
  if (!_families?.length) {
    try {
      const { data } = await sb.rpc('get_manageable_families');
      _families = (data || []).map(f => ({ ...f, name: _familyDisplayName(f.id, f.name || '') || f.id }));
    } catch(_) {}
  }

  _mfmActiveFamilyId = ownedFams[0].id;

  // Tabs de família (se owner de mais de uma)
  const tabsEl = document.getElementById('mfmFamilyTabs');
  if (tabsEl) {
    if (ownedFams.length > 1) {
      tabsEl.style.display = '';
      tabsEl.innerHTML = ownedFams.map(f =>
        `<button class="tab${f.id === _mfmActiveFamilyId ? ' active' : ''}"
                 id="mfmTab-${f.id}"
                 onclick="mfmSwitchFamily('${f.id}')"
                 style="padding:10px 14px;font-size:.82rem;white-space:nowrap">${esc(_familyDisplayName(f.id, f.name||''))}</button>`
      ).join('');
    } else {
      tabsEl.style.display = 'none';
    }
  }

  openModal('myFamilyMgmtModal');
  await _mfmRender();
}

function mfmSwitchFamily(famId) {
  _mfmActiveFamilyId = famId;
  // Update tab highlight
  document.querySelectorAll('[id^="mfmTab-"]').forEach(b => {
    b.classList.toggle('active', b.id === `mfmTab-${famId}`);
  });
  _mfmRender();
}

async function _mfmRender() {
  const famId = _mfmActiveFamilyId;
  if (!famId) return;

  const fam = _families.find(f => f.id === famId) ||
              (currentUser?.families || []).find(f => f.id === famId);

  const nameEl = document.getElementById('mfmFamilyName');
  const descEl = document.getElementById('mfmFamilyDesc');
  if (nameEl) nameEl.textContent = fam?.name || '';
  if (descEl) descEl.textContent = fam?.description || '';

  const listEl = document.getElementById('mfmMembersList');
  if (listEl) listEl.innerHTML = '<div style="color:var(--muted);font-size:.8rem;text-align:center;padding:12px">⏳ Carregando...</div>';

  // Buscar membros desta família
  let members = [];
  try {
    const { data: rpcData } = await sb.rpc('get_all_family_members');
    if (rpcData) members = rpcData.filter(m => m.family_id === famId);
  } catch(_) {}

  if (!members.length) {
    // Fallback direto
    try {
      const { data: fmData } = await sb
        .from('family_members')
        .select('user_id, role, app_users(id,name,email,avatar_url,role,active)')
        .eq('family_id', famId);
      members = (fmData || []).map(r => ({
        user_id:    r.user_id,
        member_role: r.role,
        user_name:  r.app_users?.name  || '—',
        user_email: r.app_users?.email || '—',
        user_avatar: r.app_users?.avatar_url || null,
        user_role:  r.app_users?.role  || 'user',
        user_active: r.app_users?.active ?? true,
        family_id:  famId,
      }));
    } catch(_) {}
  }

  const roleIcon  = r => ({ owner:'👑', admin:'🔧', user:'👤', viewer:'👁' }[r] || '👤');
  const roleLabel = r => ({ owner:'Owner', admin:'Admin', user:'Usuário', viewer:'Visualizador' }[r] || r);

  if (listEl) {
    if (!members.length) {
      listEl.innerHTML = '<div style="color:var(--muted);font-size:.8rem;text-align:center;padding:16px">Nenhum membro ainda.</div>';
    } else {
      listEl.innerHTML = members.map(m => `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface2);border-radius:8px;border:1px solid var(--border)">
          <div style="flex-shrink:0">${_userAvatarHtml({ avatar_url: m.user_avatar, role: m.user_role, name: m.user_name }, 32)}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:.83rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(m.user_name)}</div>
            <div style="font-size:.71rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(m.user_email)}</div>
          </div>
          <select style="font-size:.78rem;padding:3px 6px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);width:118px"
                  onchange="mfmChangeRole(this,'${m.user_id}','${famId}')">
            <option value="owner"  ${m.member_role==='owner'  ?'selected':''}>👑 Owner</option>
            <option value="admin"  ${m.member_role==='admin'  ?'selected':''}>🔧 Admin</option>
            <option value="user"   ${m.member_role==='user'   ?'selected':''}>👤 Usuário</option>
            <option value="viewer" ${m.member_role==='viewer' ?'selected':''}>👁 Visualizador</option>
          </select>
          <button class="btn-icon" title="Remover da família" style="color:var(--red);flex-shrink:0"
                  onclick="mfmRemoveMember('${m.user_id}','${esc(m.user_name)}','${famId}')">✕</button>
        </div>`).join('');
    }
  }

  // Populate "add existing user" dropdown — users not already in this family
  const memberIds = new Set(members.map(m => m.user_id));
  const addSel = document.getElementById('mfmAddUserSel');
  if (addSel) {
    try {
      const { data: allUsers } = await sb.from('app_users').select('id,name,email').eq('approved', true).order('name');
      const available = (allUsers || []).filter(u => !memberIds.has(u.id));
      addSel.innerHTML = '<option value="">— Selecionar usuário —</option>' +
        available.map(u => `<option value="${u.id}">${esc(u.name || u.email)}</option>`).join('');
      document.getElementById('mfmAddExistingRow').style.display = available.length ? '' : 'none';
    } catch(_) {}
  }

  // Clear invite field and message
  const inviteEl = document.getElementById('mfmInviteEmail');
  if (inviteEl) inviteEl.value = '';
  _mfmMsg('', '');
}

async function mfmChangeRole(sel, userId, famId) {
  const newRole = sel.value;
  const { error } = await sb.from('family_members')
    .update({ role: newRole }).eq('user_id', userId).eq('family_id', famId);
  if (error) { toast('Erro: ' + error.message, 'error'); return; }
  toast('✓ Perfil atualizado', 'success');
}

async function mfmRemoveMember(userId, userName, famId) {
  if (!confirm(`Remover "${userName}" desta família?\n\nO usuário perderá acesso a esta família.`)) return;
  const { error } = await sb.from('family_members')
    .delete().eq('user_id', userId).eq('family_id', famId);
  if (error) { toast('Erro: ' + error.message, 'error'); return; }
  toast('✓ Membro removido', 'success');
  await _mfmRender();
}

async function mfmAddExisting() {
  const sel    = document.getElementById('mfmAddUserSel');
  const roleSel = document.getElementById('mfmAddUserRole');
  const userId = sel?.value;
  const role   = roleSel?.value || 'user';
  const famId  = _mfmActiveFamilyId;
  if (!userId) { toast('Selecione um usuário', 'error'); return; }

  const { error } = await sb.from('family_members').upsert(
    { user_id: userId, family_id: famId, role },
    { onConflict: 'user_id,family_id' }
  );
  if (error) { toast('Erro: ' + error.message, 'error'); return; }
  await sb.from('app_users').update({ family_id: famId }).eq('id', userId).catch(()=>{});
  toast('✓ Usuário adicionado', 'success');
  await _mfmRender();
}

async function mfmInvite() {
  const famId    = _mfmActiveFamilyId;
  const fam      = _families.find(f => f.id === famId) || { name: famId };
  const emailEl  = document.getElementById('mfmInviteEmail');
  const roleEl   = document.getElementById('mfmInviteRole');
  const btn      = document.getElementById('mfmInviteBtn');
  const email    = emailEl?.value.trim().toLowerCase();
  const role     = roleEl?.value || 'user';

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    _mfmMsg('Informe um e-mail válido.', 'error'); return;
  }

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Enviando...'; }
  _mfmMsg('', '');

  try {
    // Check if user already exists
    const { data: existing } = await sb.from('app_users').select('id,name,approved,active').eq('email', email).maybeSingle();

    if (existing) {
      // Already registered — add directly to family
      const { error } = await sb.from('family_members').upsert(
        { user_id: existing.id, family_id: famId, role },
        { onConflict: 'user_id,family_id' }
      );
      if (error) throw new Error(error.message);
      _mfmMsg(`✓ ${email} já estava cadastrado e foi adicionado à família.`, 'success');
    } else {
      // New user — create pending record
      const { data: newUser, error: insErr } = await sb.from('app_users').insert({
        email,
        name:            email.split('@')[0],
        role:            'user',
        approved:        false,
        active:          false,
        family_id:       famId,
        must_change_pwd: true,
      }).select().single();
      if (insErr) throw new Error(insErr.message);

      await sb.from('family_members').insert({ user_id: newUser.id, family_id: famId, role }).catch(()=>{});
      await _sendInviteEmail(email, fam.name, currentUser.name || currentUser.email);
      _mfmMsg(`✓ Convite enviado para ${email}. O acesso será liberado após aprovação.`, 'success');
    }

    if (emailEl) emailEl.value = '';
    await _mfmRender();
  } catch(e) {
    _mfmMsg('Erro: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📨 Convidar'; }
  }
}

function _mfmMsg(text, type) {
  const el = document.getElementById('mfmMsg');
  if (!el) return;
  if (!text) { el.style.display = 'none'; return; }
  el.textContent = text;
  el.style.display = '';
  el.style.background = type === 'error' ? '#fef2f2' : type === 'success' ? '#f0fdf4' : '#fffbeb';
  el.style.color      = type === 'error' ? '#991b1b' : type === 'success' ? '#166534' : '#92400e';
  el.style.border     = '1px solid ' + (type === 'error' ? '#fecaca' : type === 'success' ? '#bbf7d0' : '#fde68a');
}
