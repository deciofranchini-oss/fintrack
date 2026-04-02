// Auth context for the UI and data-layer helpers.
// With RLS enabled, the app MUST use Supabase Auth (auth.uid()) as the primary identity.
// currentUser is a lightweight projection used by the UI.
let currentUser = null;  // { id, email, name, role, family_id, can_* }

// Admin client (service_role key) — criado sob demanda, nunca exposto ao Supabase
let sbAdmin = null;

function initSbAdmin() {
  // SECURITY: Service Role Key must never be stored client-side.
  // Admin operations use RPC set_user_password (SECURITY DEFINER) or Edge Functions.
  localStorage.removeItem('sb_service_key');
  sbAdmin = null;
  return null;
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

// ── Sidebar: populate user card — removed from sidebar UI ──────────────────
function _updateSidebarUserCard() {
  // User name and family name removed from sidebar to maximize nav space.
  // Function kept as no-op to avoid errors from existing callers.
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

async function _loadCurrentUserContext(authCtx = null) {
  if (!sb) throw new Error('Supabase client não inicializado.');

  let user = authCtx?.user || authCtx?.session?.user || null;
  let session = authCtx?.session || null;

  if (!user) {
    try {
      const { data: sRes, error: sErr } = await sb.auth.getSession();
      if (sErr) throw sErr;
      session = sRes?.session || null;
      user = session?.user || null;
    } catch (_) {}
  }

  if (!user) {
    try {
      const { data: uRes, error: uErr } = await sb.auth.getUser();
      if (uErr) {
        const msg = String(uErr?.message || '');
        if (/auth session missing/i.test(msg)) return null;
        throw uErr;
      }
      user = uRes?.user || null;
    } catch (err) {
      const msg = String(err?.message || err || '');
      if (/auth session missing/i.test(msg)) return null;
      throw err;
    }
  }

  if (!user) return null;

  // app_users: fonte de verdade para dados pessoais e role global
  // Tenta primeiro por auth_uid (= auth.uid(), sempre funciona com RLS)
  // Fallback por email para usuários ainda sem auth_uid preenchido
  let appUserRow = null;
  {
    const { data: byUid } = await sb
      .from('app_users')
      .select('id, family_id, avatar_url, role, name, preferred_family_id, preferred_language, whatsapp_number, telegram_chat_id, preferred_form_mode, notify_on_tx, notify_tx_email, notify_tx_wa, notify_tx_tg')
      .eq('auth_uid', user.id)
      .maybeSingle();
    appUserRow = byUid || null;

    // Fallback: se auth_uid ainda não foi gravado, busca por email
    // E aproveita para gravar o auth_uid agora
    if (!appUserRow && user.email) {
      // Disable RLS for this fallback by using service key if available,
      // otherwise rely on app_users_own_row policy which also allows email match
      const { data: byEmail } = await sb
        .from('app_users')
        .select('id, family_id, avatar_url, role, name, preferred_family_id, preferred_language, whatsapp_number, telegram_chat_id, preferred_form_mode, notify_on_tx, notify_tx_email, notify_tx_wa, notify_tx_tg')
        .eq('email', user.email)
        .maybeSingle();
      appUserRow = byEmail || null;
      // Populate auth_uid for future logins
      if (appUserRow?.id && user.id) {
        sb.from('app_users').update({ auth_uid: user.id }).eq('id', appUserRow.id)
          .then(() => {}).catch(() => {});
      }
    }
  }

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
    // Se family_members.role é NULL e o usuário é owner/admin global na família primária,
    // herda o appRole (evita que owner fique com role='user' por dado inconsistente no banco)
    let memberRole = r.role;
    if (!memberRole && r.family_id === appUserRow?.family_id &&
        (appRole === 'owner' || appRole === 'admin')) {
      memberRole = appRole;
    }
    memberRole = memberRole || 'user';
    const item = { id: r.family_id, name: r.families?.name || null, role: memberRole };
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

  // Fallback 1: family_members vazio → usa app_users.family_id
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
    const fallbackRole = (appRole === 'admin' || appRole === 'owner') ? 'owner' : appRole;
    userFamilies = [{ id: appUserRow.family_id, name: famName, role: fallbackRole }];
  }

  // Fallback 2: ainda sem família → tenta a primeira família que existe no banco
  // (ocorre quando usuário foi aprovado mas family_id não foi gravado em app_users)
  if (!userFamilies.length && (appRole === 'admin' || appRole === 'owner')) {
    // Admin/owner global sem família: acesso amplo — não precisa de família
    // famQ() já retorna query sem filtro para admins
  } else if (!userFamilies.length) {
    try {
      const { data: anyFam } = await sb
        .from('family_members')
        .select('family_id, role, families(id,name)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (anyFam?.family_id) {
        userFamilies = [{ id: anyFam.family_id, name: anyFam.families?.name || anyFam.family_id, role: anyFam.role || 'user' }];
        console.warn('[auth] family_id recuperado via fallback2 para user:', user.email);
      }
    } catch (_) {}
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
    id:                   user.id,          // auth.uid — usado para auth Supabase
    app_user_id:          appUserRow?.id || null,  // app_users.id — usado para FKs internas
    email:                user.email || '',
    name:                 appUserRow?.name || user.email || 'Usuário',
    role:                 activeRole,
    app_role:             appRole,        // role global em app_users (não sofre override por família ativa)
    family_id:            activeFamId,
    families:             userFamilies,
    avatar_url:           appUserRow?.avatar_url || null,
    preferred_family_id:  appUserRow?.preferred_family_id || null,
    preferred_language:   appUserRow?.preferred_language  || 'pt',
    whatsapp_number:      appUserRow?.whatsapp_number || '',
    telegram_chat_id:     appUserRow?.telegram_chat_id || '',
    preferred_form_mode:  appUserRow?.preferred_form_mode || 'tabs',
    preferred_sc_view:    appUserRow?.preferred_sc_view   || null,
    notify_on_tx:         !!appUserRow?.notify_on_tx,
    notify_tx_email:      !!appUserRow?.notify_tx_email,
    notify_tx_wa:         !!appUserRow?.notify_tx_wa,
    notify_tx_tg:         !!appUserRow?.notify_tx_tg,
    ...caps
  };

  // Apply user language preference from DB (preferred_language column)
  // DB is authoritative — it was saved by saveMyProfile() / quickSetLang()
  const _langToApply = currentUser.preferred_language || 'pt';
  // Sync localStorage immediately so i18n.js reads correct lang on next load
  localStorage.setItem('fintrack_i18n_lang', _langToApply);
  // Sync form_mode preference from DB into localStorage
  try { const _fmKey = `pref_${currentUser.id}_global_form_mode`;
    localStorage.setItem(_fmKey, currentUser.preferred_form_mode || 'tabs'); } catch(e) {}
  // Apply to DOM now — await so everything renders in the correct language
  if (typeof i18nSetLanguage === 'function') {
    await i18nSetLanguage(_langToApply).catch(() => {});
  }

  return currentUser;
}

// ── Password hashing — PBKDF2 + salt (Web Crypto API) ──
// SECURITY: Replaces raw SHA-256 with PBKDF2 + random 16-byte salt.
// Stored format: 'pbkdf2:<saltHex>:<hashHex>'
async function sha256(str) {
  // Alias kept for compatibility — delegates to hashPassword
  return hashPassword(str);
}
async function hashPassword(password, saltHex) {
  const salt = saltHex ? _hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name:'PBKDF2', salt, iterations:100000, hash:'SHA-256' }, km, 256);
  return `pbkdf2:${_bytesToHex(salt)}:${_bytesToHex(new Uint8Array(bits))}`;
}
async function verifyPassword(password, stored) {
  if (!stored) return false;
  if (stored.startsWith('pbkdf2:')) {
    const [,saltHex,expected] = stored.split(':');
    const salt = _hexToBytes(saltHex);
    const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name:'PBKDF2', salt, iterations:100000, hash:'SHA-256' }, km, 256);
    return _bytesToHex(new Uint8Array(bits)) === expected;
  }
  // Legacy SHA-256 fallback (auto-upgrades on next login)
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('') === stored;
}
function _bytesToHex(b) { return Array.from(b).map(x=>x.toString(16).padStart(2,'0')).join(''); }
function _hexToBytes(h) { const a=new Uint8Array(h.length/2); for(let i=0;i<a.length;i++) a[i]=parseInt(h.slice(i*2,i*2+2),16); return a; }


function detectLoginPlatform() {
  try {
    const nav = window.navigator || {};
    const ua  = String(nav.userAgent || '').toLowerCase();
    const platform = String(nav.platform || '').toLowerCase();
    const uaDataPlatform = String(nav.userAgentData?.platform || '').toLowerCase();
    const touchPoints = Number(nav.maxTouchPoints || 0);

    const isAndroid = /android/.test(ua);
    const isIPhone = /iphone|ipod/.test(ua);
    const isIPad = /ipad/.test(ua) || (/mac/.test(uaDataPlatform || platform) && touchPoints > 1);
    const isIOS = isIPhone || isIPad;
    const isWindows = /windows/.test(ua) || /win/.test(platform) || /windows/.test(uaDataPlatform);

    let os = 'other';
    if (isWindows) os = 'windows';
    else if (isIOS) os = 'ios';
    else if (isAndroid) os = 'android';

    return {
      os,
      isWindows,
      isIOS,
      isAndroid,
      isMobile: isIOS || isAndroid,
      isDesktop: isWindows || (!isIOS && !isAndroid)
    };
  } catch (_) {
    return {
      os: 'other',
      isWindows: false,
      isIOS: false,
      isAndroid: false,
      isMobile: false,
      isDesktop: true
    };
  }
}

function applyLoginPlatformMode() {
  try {
    const info = detectLoginPlatform();
    window.__FT_LOGIN_PLATFORM__ = info;

    const html = document.documentElement;
    const body = document.body;
    const ls = document.getElementById('loginScreen');

    const classes = [
      'platform-windows','platform-ios','platform-android','platform-other',
      'ft-platform-windows','ft-platform-ios','ft-platform-android','ft-platform-other'
    ];
    classes.forEach(cls => {
      html?.classList.remove(cls);
      body?.classList.remove(cls);
      ls?.classList.remove(cls);
    });

    const cls = `platform-${info.os}`;
    const ftCls = `ft-platform-${info.os}`;
    html?.classList.add(cls, ftCls);
    body?.classList.add(cls, ftCls);
    ls?.classList.add(cls, ftCls);

    if (ls) {
      ls.dataset.platform = info.os;
      ls.dataset.loginMode = info.isWindows ? 'simple' : 'rich';
    }

    return info;
  } catch (_) {
    return detectLoginPlatform();
  }
}

window.detectLoginPlatform = detectLoginPlatform;
window.applyLoginPlatformMode = applyLoginPlatformMode;

function isWindowsLoginMode() {
  try {
    const info = window.__FT_LOGIN_PLATFORM__ || detectLoginPlatform();
    return !!info?.isWindows;
  } catch (_) {
    return false;
  }
}

function focusFieldSafely(elementId, delay = 100) {
  window.setTimeout(() => {
    try {
      if (isWindowsLoginMode()) return;
      const el = document.getElementById(elementId);
      if (el && typeof el.focus === 'function') el.focus({ preventScroll: true });
    } catch (_) {}
  }, delay);
}


// ── Show / hide login screen ──
function showLoginScreen() {
  // Ensure sb is initialized whenever login screen is shown —
  // guards against iOS/Safari timing issues where createClient failed silently
  if (!sb && typeof ensureSupabaseClient === 'function') {
    sb = ensureSupabaseClient();
  }
  // Hide main app
  const mainApp = document.getElementById('mainApp');
  const sidebar = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebarOverlay');
  if (mainApp) { mainApp.style.display = 'none'; mainApp.style.visibility = 'hidden'; mainApp.style.opacity = '0'; }
  if (sidebar) sidebar.style.display = 'none';
  if (sidebarOverlay) sidebarOverlay.style.display = 'none';

  const ls = document.getElementById('loginScreen');
  if (ls) {
    ls.style.display = 'flex';
    // Re-apply access request visibility every time login screen is shown
    _applyAccessRequestVisibilityFromLocalStorage();
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
    if (!isWindowsLoginMode()) {
      setTimeout(() => {
        try {
          const emailEl = document.getElementById('loginEmail');
          if (emailEl && !emailEl.value) emailEl.focus({ preventScroll: true });
          else document.getElementById('loginPassword')?.focus({ preventScroll: true });
        } catch (_) {}
      }, 100);
    }
  }
}
function _saveRememberedCredentials(email, _password) {
  try {
    // SECURITY: store only email — never the password
    localStorage.setItem('ft_remember_me', btoa(JSON.stringify({ email })));
  } catch(e) {}
}
function _loadRememberedCredentials() {
  try {
    const data = localStorage.getItem('ft_remember_me');
    if (!data) return null;
    const p = JSON.parse(atob(data));
    return { email: p.email || '', password: '' }; // password never returned
  } catch(e) { return null; }
}
function _clearRememberedCredentials() {
  localStorage.removeItem('ft_remember_me');
}
function hideLoginScreen() {
  const ls = document.getElementById('loginScreen');
  if (ls) {
    ls.style.transition = 'opacity .2s ease';
    ls.style.opacity = '0';
    setTimeout(() => { ls.style.display = 'none'; ls.style.opacity = ''; ls.style.transition = ''; }, 200);
  }
  const mainApp = document.getElementById('mainApp');
  const sidebar = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebarOverlay');
  if (mainApp) {
    mainApp.style.display = '';
    mainApp.style.visibility = 'visible';
    requestAnimationFrame(() => { mainApp.style.opacity = '1'; });
  }
  if (sidebar) sidebar.style.display = '';
  if (sidebarOverlay) sidebarOverlay.style.display = '';
}
document.addEventListener('DOMContentLoaded', () => {
  applyLoginPlatformMode();
  // 1. Apply immediately from localStorage (instant, no network)
  _applyAccessRequestVisibilityFromLocalStorage();
  // 2. Also fetch from Supabase anon (for mobile users who never set it locally)
  //    Uses a short timeout so it doesn't block anything
  _fetchAccessRequestSettingAnon();
});

async function _fetchAccessRequestSettingAnon() {
  try {
    // ── Step 1: Read localStorage immediately (set by admin, no network) ──
    // This is the primary mechanism — no flicker, no race condition.
    const lsVal = localStorage.getItem('ft_show_access_request');
    if (lsVal !== null) {
      _applyAccessRequestVisibility(lsVal !== 'false');
      return; // localStorage is authoritative — skip DB fetch
    }

    // ── Step 2: No localStorage → fetch from DB (first-ever load or cleared) ──
    let attempts = 0;
    while (!window.sb && attempts++ < 30) {
      await new Promise(r => setTimeout(r, 100));
    }
    if (!window.sb) {
      // No Supabase and no localStorage → show by default
      _applyAccessRequestVisibility(true);
      return;
    }

    let raw = null;
    let found = false;

    // Try 1: direct select (works if app_settings has anon SELECT policy)
    try {
      const { data, error } = await sb
        .from('app_settings')
        .select('value')
        .eq('key', 'show_access_request')
        .limit(1)
        .maybeSingle();
      if (!error && data !== null && data !== undefined) {
        raw = data?.value; found = true;
      }
    } catch(_) {}

    // Try 2: RPC get_public_app_setting (SECURITY DEFINER — bypasses RLS)
    if (!found) {
      try {
        const { data, error } = await sb.rpc('get_public_app_setting', { p_key: 'show_access_request' });
        if (!error && data !== null && data !== undefined) {
          raw = data; found = true;
        }
      } catch(_) {}
    }

    if (found) {
      let val = raw;
      if (typeof val === 'string') { try { val = JSON.parse(val); } catch(_) {} }
      const enabled = val === null || val === true || val === 'true' || val === 1 || val === '1';
      // Cache in localStorage for next visit
      try { localStorage.setItem('ft_show_access_request', enabled ? 'true' : 'false'); } catch(_) {}
      _applyAccessRequestVisibility(enabled);
    } else {
      // Not in DB and no localStorage → default: show (backwards compatible)
      _applyAccessRequestVisibility(true);
      try { localStorage.setItem('ft_show_access_request', 'true'); } catch(_) {}
    }
  } catch(_) {
    _applyAccessRequestVisibility(true);
  }
}


// ── Access request visibility — reads from DB only, never from localStorage ──
function _applyAccessRequestVisibility(enabled) {
  try {
    const wrap = document.getElementById('loginRequestAccessWrap');
    if (wrap) wrap.style.display = enabled ? '' : 'none';
  } catch(_) {}
}
// Alias kept for legacy callers — delegates to DB fetch
function _applyAccessRequestVisibilityFromLocalStorage() {
  // Instant: read from localStorage first (no async needed)
  try {
    const lsVal = localStorage.getItem('ft_show_access_request');
    if (lsVal !== null) {
      _applyAccessRequestVisibility(lsVal !== 'false');
      return; // Done — no async needed
    }
  } catch(_) {}
  // No localStorage entry → fall back to async DB fetch
  _fetchAccessRequestSettingAnon();
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
    if (!sb && typeof ensureSupabaseClient === 'function') sb = ensureSupabaseClient();
    if (!sb) { showLoginErr('Sem conexão com o servidor. Verifique a configuração.'); btn.disabled = false; btn.textContent = 'Entrar'; return; }
    const { data: authData, error } = await sb.auth.signInWithPassword({ email, password });
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

    // Upgrade legacy SHA-256 hash to PBKDF2 transparently on login
    try {
      const { data: _pwRow } = await sb.from('app_users')
        .select('id,password_hash').eq('email', email).maybeSingle();
      if (_pwRow?.password_hash && !_pwRow.password_hash.startsWith('pbkdf2:')) {
        const _newHash = await hashPassword(password);
        await sb.from('app_users').update({ password_hash: _newHash }).eq('id', _pwRow.id);
      }
    } catch(_) {}
    // Upgrade legacy SHA-256 hash to PBKDF2 transparently on login
    try {
      const { data: _pwRow } = await sb.from('app_users')
        .select('id,password_hash').eq('email', email).maybeSingle();
      if (_pwRow?.password_hash && !_pwRow.password_hash.startsWith('pbkdf2:')) {
        const _newHash = await hashPassword(password);
        await sb.from('app_users').update({ password_hash: _newHash }).eq('id', _pwRow.id);
      }
      // Store Supabase Auth UID in app_users for RLS policies
      // This is the critical bridge: app_users.auth_uid = auth.uid()
      if (_pwRow?.id && authData?.user?.id) {
        await sb.from('app_users')
          .update({ auth_uid: authData.user.id })
          .eq('id', _pwRow.id)
          .then(() => {})  // fire-and-forget, non-blocking
          .catch(() => {}); // ignore error if column doesn't exist yet
      }
    } catch(_) {} // non-blocking — upgrade is best-effort
    await _loadCurrentUserContext(authData);

    await onLoginSuccess();
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
    if (!sb && typeof ensureSupabaseClient === 'function') sb = ensureSupabaseClient();
    if (!sb) {
      errEl.textContent = 'Sem conexão com o servidor. Verifique a configuração.';
      errEl.style.display = '';
      btn.disabled = false; btn.textContent = '✉️ Enviar Link de Acesso';
      return;
    }
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
    const redirectTo = typeof getAppBaseUrl === 'function' ? getAppBaseUrl() : (window.location.origin + window.location.pathname);
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
    await onLoginSuccess();
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
    toast(t('toast.pwd_changed'), 'success');
    closeModal('changeMyPwdModal');
  } catch(e) { errEl.textContent = 'Erro: ' + (e?.message || e); errEl.style.display = ''; }
}

// ── On login success ──
async function onLoginSuccess() {
  updateUserUI();
  if (!sb) {
    toast('Configure o Supabase primeiro','error'); return;
  }

  const platformInfo = (typeof detectLoginPlatform === 'function') ? detectLoginPlatform() : { isWindows:false };
  const loginLogo = document.getElementById('loginLogoImg');
  if (loginLogo && !platformInfo.isWindows) loginLogo.classList.add('exiting');

  if (!platformInfo.isWindows) {
    await new Promise(r => setTimeout(r, 380));
    if (typeof Cursor !== 'undefined') Cursor.show('A carregar…');
  }

  hideLoginScreen();

  // Check for new feedback reports (admin only)
  if (typeof _checkNewFeedbackOnLogin === 'function') _checkNewFeedbackOnLogin().catch(()=>{});

  // Apply access request visibility based on admin setting
  if (typeof initAccessRequestVisibility === 'function') initAccessRequestVisibility().catch(()=>{});

  // If the user has no family_id and is not a global admin/owner,
  // launch the wizard so they can create their own family as Owner.
  if (!currentUser?.family_id &&
      currentUser?.role !== 'admin' &&
      currentUser?.role !== 'owner') {
    if (typeof enforceFirstLoginFamilyCreation === 'function') {
      await enforceFirstLoginFamilyCreation();
      return; // wizard's _wzFinish() calls bootApp() when done
    }
  }
  await bootApp();
  if (!platformInfo.isWindows && typeof Cursor !== 'undefined') Cursor.hide();
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
      await _loadCurrentUserContext({ session, user: session.user });
      await onLoginSuccess();
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

  // Configurações e Telemetria: APENAS admin (sidebar + topbar via data-nav)
  // Auditoria: visível para TODOS os usuários autenticados
  const isAdmin = !!currentUser.can_admin;
  ['settings', 'telemetry'].forEach(key => {
    document.querySelectorAll('[data-nav="' + key + '"]').forEach(el => {
      if (el.tagName === 'BUTTON' && el.id && el.id.includes('Topbar')) {
        el.classList.toggle('admin-visible', isAdmin);
      } else {
        el.style.display = isAdmin ? '' : 'none';
      }
    });
  });
  // Audit: sempre visível — apenas garante que não esteja escondido
  document.querySelectorAll('[data-nav="audit"]').forEach(el => {
    el.style.display = '';
  });
  const adminSec = document.getElementById('adminNavSection');
  if (adminSec) adminSec.style.display = isAdmin ? '' : 'none';
  if (isAdmin) {
    _checkPendingApprovals();
    _checkWaitlistOnLogin().catch(() => {});
    // Update feedback badge in settings panel
    setTimeout(() => {
      if (typeof _cfgUpdateFeedbackBadge === 'function') _cfgUpdateFeedbackBadge();
    }, 1500);
  }

  // Family switcher (only when user has 2+ families)
  _renderFamilySwitcher();

  // Avatar in topbar, settings and sidebar
  setTimeout(_applyCurrentUserAvatar, 50);

  // Sync topbar language badge with user's actual preference
  if (typeof _i18nUpdateTopbarLabel === 'function') _i18nUpdateTopbarLabel();

  // Show feedback button only for regular users (hidden for admin/owner)
  if (typeof _updateFeedbackBtnVisibility === 'function') _updateFeedbackBtnVisibility();

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
    // Hide all nav elements for 'import' (sidebar + topbar) via data-nav
    document.querySelectorAll('[data-nav="import"]').forEach(el => el.style.display='none');
  }

// Configurações e Telemetria: admin-only. Auditoria: todos os usuários.
['settings', 'telemetry'].forEach(key => {
  document.querySelectorAll('[data-nav="' + key + '"]').forEach(el => {
    if (el.tagName === 'BUTTON' && el.id && el.id.includes('Topbar')) {
      el.classList.toggle('admin-visible', !!p.can_admin);
    } else {
      el.style.display = p.can_admin ? '' : 'none';
    }
  });
});
// Audit sempre visível para todos os usuários autenticados
document.querySelectorAll('[data-nav="audit"]').forEach(el => { el.style.display = ''; });
if (!p.can_admin) {
  const adminSec = document.getElementById('adminNavSection');
  if (adminSec) adminSec.style.display = 'none';
} else {
  const adminSec = document.getElementById('adminNavSection');
  if (adminSec) adminSec.style.display = '';
}

  // Módulos por família: visibilidade depende de feature flag
  if (typeof applyPricesFeature === 'function') applyPricesFeature().catch(() => {});
  if (typeof applyGroceryFeature === 'function') applyGroceryFeature().catch(() => {});
  if (typeof applyAiInsightsFeature === 'function') applyAiInsightsFeature().catch(() => {});
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

  // ── Position dropdown relative to avatar button, safe for mobile ──
  const btn   = document.getElementById('topbarUserBtn');
  const rect  = btn ? btn.getBoundingClientRect() : { bottom: 56, right: window.innerWidth - 8 };
  const gap   = 8;
  const menuW = 240;
  const vw    = window.innerWidth;
  const vh    = window.innerHeight;

  // Show first (hidden) so we can read its height
  dd.style.display    = '';
  dd.style.visibility = 'hidden';
  const menuH = dd.offsetHeight;
  dd.style.visibility = '';

  // Prefer aligning right edge of menu to right edge of button
  let left = rect.right - menuW;
  // Clamp: don't go off left or right edge, keep 8px margin
  left = Math.max(8, Math.min(left, vw - menuW - 8));

  // Prefer opening downward; if not enough room, open upward
  let top = rect.bottom + gap;
  if (top + menuH > vh - 8) {
    top = rect.top - menuH - gap;
  }
  // Last resort: pin to top of viewport with margin
  if (top < 8) top = 8;

  dd.style.top  = top  + 'px';
  dd.style.left = left + 'px';

  // Close on outside click
  setTimeout(() => document.addEventListener('click', _closeUserMenuOutside), 10);
}

function _closeUserMenuOutside(e) {
  const dd  = document.getElementById('userMenuDropdown');
  const btn = document.getElementById('topbarUserBtn');
  // Dropdown is now in <body>; check both the avatar btn AND the dropdown itself
  if (dd && !dd.contains(e.target) && btn && !btn.contains(e.target)) {
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

function _toggleTxNotifChannels(show) {
  const ch = document.getElementById('myProfileNotifyOnTxChannels');
  if (ch) ch.style.display = show ? '' : 'none';
}

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
  // Also fill editable name input and email display in Conta tab
  const nameInputEl = document.getElementById('myProfileNameInput');
  const emailDispEl = document.getElementById('myProfileEmailDisplay');
  if (nameInputEl) nameInputEl.value = currentUser.name || '';
  if (emailDispEl) emailDispEl.textContent = currentUser.email || '';
  if (roleEl) {
    const labels = { owner:'👑 Owner', admin:'🔧 Admin', viewer:'👁 Visualizador', user:'👤 Usuário' };
    const bgs    = { owner:'#fef3c7', admin:'#fef9c3', viewer:'#f0f9ff', user:'var(--accent-lt)' };
    const colors = { owner:'#92400e', admin:'#713f12', viewer:'#0369a1', user:'var(--accent)' };
    const r = currentUser.role || 'user';
    roleEl.innerHTML = `<span style="font-size:.7rem;font-weight:700;padding:2px 8px;border-radius:20px;
      background:${bgs[r]||'var(--bg2)'};color:${colors[r]||'var(--text)'}">${labels[r]||r}</span>`;
  }

  // --- Notification defaults ---
  if (typeof loadFormModeIntoProfile === 'function') loadFormModeIntoProfile();
  const waEl = document.getElementById('myProfileWhatsappNumber');
  const tgEl = document.getElementById('myProfileTelegramChatId');
  if (waEl) waEl.value = currentUser?.whatsapp_number || '';
  if (tgEl) tgEl.value = currentUser?.telegram_chat_id || '';
  // tx notification prefs
  const notifyTxEl      = document.getElementById('myProfileNotifyOnTx');
  const notifyTxEmailEl = document.getElementById('myProfileNotifyTxEmail');
  const notifyTxWaEl    = document.getElementById('myProfileNotifyTxWa');
  const notifyTxTgEl    = document.getElementById('myProfileNotifyTxTg');
  if (notifyTxEl) {
    notifyTxEl.checked = !!(currentUser?.notify_on_tx);
    _toggleTxNotifChannels(notifyTxEl.checked);
    notifyTxEl.onchange = () => _toggleTxNotifChannels(notifyTxEl.checked);
  }
  if (notifyTxEmailEl) notifyTxEmailEl.checked = !!(currentUser?.notify_tx_email);
  if (notifyTxWaEl)    notifyTxWaEl.checked    = !!(currentUser?.notify_tx_wa);
  if (notifyTxTgEl)    notifyTxTgEl.checked    = !!(currentUser?.notify_tx_tg);

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

  // --- Language preference ---
  const langSel = document.getElementById('myProfileLanguage');
  if (langSel && typeof i18nGetAvailableLanguages === 'function') {
    const langs = i18nGetAvailableLanguages();
    langSel.innerHTML = langs.map(l =>
      `<option value="${l.code}">${l.flag} ${l.label}</option>`
    ).join('');
    langSel.value = currentUser.preferred_language || 'pt';
  }

  // Gerenciar Família: acessível via user menu (umManageFamilyBtn) — não mais no perfil modal

  // Language selector
  const savedLang = currentUser?.preferred_language ||
    (typeof i18nGetLanguage === 'function' ? i18nGetLanguage() : 'pt');
  if (typeof profileSelectLang === 'function') profileSelectLang(savedLang, true);

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


function _setMyProfileTestButtonState(channel, loading) {
  const btn = document.getElementById(channel === 'whatsapp' ? 'myProfileWhatsappTestBtn' : 'myProfileTelegramTestBtn');
  if (!btn) return;
  if (loading) {
    btn.dataset.prevLabel = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '⏳ Testando...';
  } else {
    btn.disabled = false;
    btn.innerHTML = btn.dataset.prevLabel || '🧪 Testar';
  }
}

async function testMyProfileNotification(channel) {
  const normalizedChannel = String(channel || '').toLowerCase();
  if (!['whatsapp','telegram'].includes(normalizedChannel)) {
    toast('Canal de teste inválido.', 'error');
    return;
  }
  if (!sb) {
    toast('Supabase não conectado.', 'error');
    return;
  }

  const waInput = document.getElementById('myProfileWhatsappNumber');
  const tgInput = document.getElementById('myProfileTelegramChatId');
  const rawValue = normalizedChannel === 'whatsapp'
    ? String(waInput?.value || currentUser?.whatsapp_number || '').replace(/\D+/g, '')
    : String(tgInput?.value || currentUser?.telegram_chat_id || '').trim();

  if (!rawValue) {
    toast(
      normalizedChannel === 'whatsapp'
        ? 'Informe um número de WhatsApp para testar.'
        : 'Informe um Chat ID do Telegram para testar.',
      'warning'
    );
    return;
  }

  const profileName = String(currentUser?.name || currentUser?.email || 'usuário').trim();
  _setMyProfileTestButtonState(normalizedChannel, true);

  try {
    const body = normalizedChannel === 'whatsapp'
      ? {
          channel: 'whatsapp',
          recipient: rawValue,
          user_name: profileName,
          user_email: String(currentUser?.email || '').trim(),
        }
      : {
          channel: 'telegram',
          chat_id: rawValue,
          user_name: profileName,
          user_email: String(currentUser?.email || '').trim(),
        };

    const { data, error } = await sb.functions.invoke('send-profile-notification-test', { body });

    if (error) {
      throw new Error(error.message || 'Falha ao chamar a Edge Function');
    }
    if (data?.ok === false) {
      throw new Error(
        data?.description ||
        data?.error ||
        data?.details?.description ||
        'Falha ao enviar mensagem de teste.'
      );
    }

    toast(
      normalizedChannel === 'whatsapp'
        ? 'Mensagem de teste enviada para o WhatsApp.'
        : 'Mensagem de teste enviada para o Telegram.',
      'success'
    );
  } catch (e) {
    console.warn('[profile] test notification error:', e?.message || e);
    toast('Erro ao enviar teste: ' + (e?.message || e), 'error');
  } finally {
    _setMyProfileTestButtonState(normalizedChannel, false);
  }
}
window.testMyProfileNotification = testMyProfileNotification;


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
  const newLang = document.getElementById('myProfileLanguage')?.value || 'pt';
  const langChanged = newLang !== (currentUser.preferred_language || 'pt');
  const whatsappNumber = (document.getElementById('myProfileWhatsappNumber')?.value || '').trim().replace(/\D+/g, '');
  const telegramChatId = (document.getElementById('myProfileTelegramChatId')?.value || '').trim();
  const waChanged = whatsappNumber !== String(currentUser.whatsapp_number || '').replace(/\D+/g, '');
  const tgChanged = telegramChatId !== String(currentUser.telegram_chat_id || '');

  const newName = (document.getElementById('myProfileNameInput')?.value || '').trim();
  const nameChanged = newName && newName !== (currentUser?.name || '');
  const newFormMode = document.getElementById('myProfileFormMode')?.value || 'tabs';
  const fmChanged = newFormMode !== (currentUser?.preferred_form_mode || 'tabs');
  const notifyOnTx      = !!(document.getElementById('myProfileNotifyOnTx')?.checked);
  const notifyTxEmail   = !!(document.getElementById('myProfileNotifyTxEmail')?.checked);
  const notifyTxWa      = !!(document.getElementById('myProfileNotifyTxWa')?.checked);
  const notifyTxTg      = !!(document.getElementById('myProfileNotifyTxTg')?.checked);
  const notifyChanged   = notifyOnTx      !== !!(currentUser?.notify_on_tx)
                       || notifyTxEmail   !== !!(currentUser?.notify_tx_email)
                       || notifyTxWa      !== !!(currentUser?.notify_tx_wa)
                       || notifyTxTg      !== !!(currentUser?.notify_tx_tg);
  if (!avatarFile && !avatarRemove && !pwd1 && !prefFamChanged && !langChanged && !waChanged && !tgChanged && !fmChanged && !nameChanged && !notifyChanged) {
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
    if (langChanged)    updatePayload.preferred_language  = newLang;
    if (waChanged)      updatePayload.whatsapp_number     = whatsappNumber || null;
    if (tgChanged)      updatePayload.telegram_chat_id    = telegramChatId || null;
    if (nameChanged)    updatePayload.name                = newName;
    if (fmChanged)      updatePayload.preferred_form_mode = newFormMode;
    if (notifyChanged) {
      updatePayload.notify_on_tx    = notifyOnTx;
      updatePayload.notify_tx_email = notifyTxEmail;
      updatePayload.notify_tx_wa    = notifyTxWa;
      updatePayload.notify_tx_tg    = notifyTxTg;
    }

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
      if ('preferred_language' in updatePayload) {
        currentUser.preferred_language = newLang;
        if (typeof i18nSetLanguage === 'function') await i18nSetLanguage(newLang);
        if (typeof _i18nUpdateTopbarLabel === 'function') _i18nUpdateTopbarLabel();
      }
      if ('whatsapp_number' in updatePayload) currentUser.whatsapp_number = whatsappNumber || '';
      if ('telegram_chat_id' in updatePayload) currentUser.telegram_chat_id = telegramChatId || '';
      if ('notify_on_tx'    in updatePayload) currentUser.notify_on_tx    = notifyOnTx;
      if ('notify_tx_email' in updatePayload) currentUser.notify_tx_email = notifyTxEmail;
      if ('notify_tx_wa'    in updatePayload) currentUser.notify_tx_wa    = notifyTxWa;
      if ('notify_tx_tg'    in updatePayload) currentUser.notify_tx_tg    = notifyTxTg;
      if ('name' in updatePayload) {
        currentUser.name = newName;
        // Refresh cover header name
        const coverName = document.getElementById('myProfileName');
        if (coverName) coverName.textContent = newName;
        // Refresh sidebar user name if visible
        document.querySelectorAll('.sb-family-name,.sb-user-name').forEach(el => {
          if (el.dataset.type === 'username') el.textContent = newName;
        });
      }
      if ('preferred_form_mode' in updatePayload) {
        currentUser.preferred_form_mode = newFormMode;
        try { localStorage.setItem(`pref_${currentUser.id}_global_form_mode`, newFormMode); } catch(e) {}
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

    toast(t('profile.updated'), 'success');
    if (typeof _saveFormModeFromProfile === 'function') _saveFormModeFromProfile();
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
    toast(t('toast.cache_cleared'), 'success');
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
    await _loadCurrentUserContext(data);
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
  focusFieldSafely('regName');
}
function showLoginFormArea() {
  ['registerFormArea','pendingApprovalArea','changePwdArea','forgotPwdArea','recoveryPwdArea']
    .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  document.getElementById('loginFormArea').style.display = '';
  document.getElementById('loginError').style.display = 'none';
  document.getElementById('regError').style.display = 'none';
  focusFieldSafely('loginEmail');
}

function showForgotPwdForm() {
  ['loginFormArea','registerFormArea','pendingApprovalArea','changePwdArea','recoveryPwdArea']
    .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  document.getElementById('forgotPwdArea').style.display = '';
  document.getElementById('forgotPwdError').style.display = 'none';
  document.getElementById('forgotPwdError').textContent = '';
  focusFieldSafely('forgotPwdEmail');
}

async function doForgotPwd() {
  const email = (document.getElementById('forgotPwdEmail').value || '').trim().toLowerCase();
  const errEl = document.getElementById('forgotPwdError');
  const btn   = document.getElementById('forgotPwdBtn');
  errEl.style.display = 'none'; errEl.style.color = '#dc2626';
  if (!email) { errEl.textContent = 'Informe seu e-mail.'; errEl.style.display = ''; return; }
  btn.disabled = true; btn.textContent = '⏳ Enviando...';
  try {
    // Ensure Supabase client is initialized — may be null if credentials failed to load
    if (!sb && typeof ensureSupabaseClient === 'function') {
      sb = ensureSupabaseClient();
    }
    if (!sb) {
      throw new Error('Conexão com o servidor não iniciada. Verifique a configuração do Supabase nas configurações do app.');
    }
    const redirectTo = typeof getAppBaseUrl === 'function' ? getAppBaseUrl() : (window.location.origin + window.location.pathname);
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

    // Capture preferred language from register form (if present)
    const regLang = document.getElementById('regLanguage')?.value || 'pt';

    // Insert pending record via SECURITY DEFINER RPC — bypasses RLS for anon users.
    // The direct sb.from('app_users').insert() fails with RLS when the user is not
    // authenticated yet. The RPC runs with definer privileges so anon can call it.
    const { error: insErr } = await sb.rpc('register_pending_user', {
      p_name:          name,
      p_email:         email,
      p_password_hash: pwdHash,
      p_lang:          regLang,
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

// ── Tab switch for family management panel ──────────────────────────────────
function _switchFamTab(familyId) {
  // Deactivate all tabs and panels
  document.querySelectorAll('.fam-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.fam-panel').forEach(p => p.classList.remove('active'));
  // Activate selected
  const tab   = document.getElementById('famTab-' + familyId);
  const panel = document.getElementById('famPanel-' + familyId);
  if (tab)   tab.classList.add('active');
  if (panel) panel.classList.add('active');
}


async function openUserAdmin() {
  // Refresh feedback badge when admin opens panel
  if (typeof _checkNewFeedbackOnLogin === 'function') _checkNewFeedbackOnLogin().catch(()=>{});
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

  // Wizard row: visible for owners (and admins) — family configuration tool
  const wizardRow = document.getElementById('uaWizardRow');
  if (wizardRow) wizardRow.style.display = (isAdmin || isFamilyOwner) ? '' : 'none';

  // Update wizard status sub-text
  if ((isAdmin || isFamilyOwner) && typeof _updateWizardSettingsStatus === 'function') {
    _updateWizardSettingsStatus().catch(() => {});
  }

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
    // Show waitlist tab only for admins; load badge count in background
    const wlTabBtn = document.getElementById('uaTabWaitlist');
    if (wlTabBtn) wlTabBtn.style.display = '';
    _updateWaitlistBadge().catch(()=>{});
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
  ['uaPending','uaUsers','uaFamilies','uaWaitlist'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.style.display = 'none'; }
  });
  ['uaTabPending','uaTabUsers','uaTabFamilies','uaTabWaitlist'].forEach(id => {
    document.getElementById(id)?.classList.remove('active');
  });
  const paneId = 'ua' + tab.charAt(0).toUpperCase() + tab.slice(1);
  const pane = document.getElementById(paneId);
  if (pane) { pane.style.display = 'flex'; pane.style.flexDirection = 'column'; }
  const tabId = 'uaTab' + tab.charAt(0).toUpperCase() + tab.slice(1);
  document.getElementById(tabId)?.classList.add('active');
  if (tab === 'pending')  { if (typeof loadPendingApprovals === 'function') loadPendingApprovals(); }
  if (tab === 'users')    { if (typeof loadUserAdmin === 'function') loadUserAdmin(); }
  if (tab === 'families') { if (typeof loadFamiliesAdmin === 'function') loadFamiliesAdmin(); }
  if (tab === 'waitlist') { if (typeof loadWaitlist === 'function') loadWaitlist(); }
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
  const famOptions = '<option value="" disabled selected style="color:var(--muted)">— Selecione uma família —</option>'
    + (_families || []).map(f => '<option value="' + esc(f.id) + '">' + esc(f.name) + '</option>').join('')
    + '<option value="__new_family__">➕ Criar nova família (será Owner)</option>';

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
      + '<div class="mfm-member-info">'
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
  const rawVal = famSel?.value || '';
  // Special value: user will create their own family after first login
  const createNewFamily = rawVal === '__new_family__';
  const familyId   = (rawVal && !createNewFamily) ? rawVal : null;
  const familyName = _families?.find(f => f.id === familyId)?.name || null;
  // Validate selection
  if (!rawVal) {
    toast('Selecione uma família ou escolha "Criar nova família".', 'warning');
    return;
  }

    document.querySelectorAll('[data-uid="' + userId + '"]').forEach(b => { b.disabled = true; });

  try {
    const { data: userRow, error: fetchErr } = await sb
      .from('app_users').select('name,email,approved').eq('id', userId).single();
    if (fetchErr) throw new Error('Erro ao buscar usuário: ' + fetchErr.message);
    if (!userRow)  throw new Error('Usuário não encontrado.');

    const userEmail   = userRow.email;
    const displayName = userRow.name || userName;

    // Aprovar no app_users
    // createNewFamily=true: aprovar sem family_id, wizard cria família no primeiro login
    const updatePayload = {
      active: true, approved: true, must_change_pwd: true,
      family_id: createNewFamily ? null : familyId,
      role: createNewFamily ? 'user' : undefined,
    };
    // Remove undefined keys
    Object.keys(updatePayload).forEach(k => updatePayload[k] === undefined && delete updatePayload[k]);
    const { error: updErr } = await sb.from('app_users').update(updatePayload).eq('id', userId);
    if (updErr) throw new Error('Erro ao aprovar: ' + updErr.message);

    // family_members — skip if user will create their own family
    if (familyId && !createNewFamily) {
      const { error: fmErr } = await sb.from('family_members').upsert(
        { user_id: userId, family_id: familyId, role: 'user' },
        { onConflict: 'user_id,family_id' }
      );
      if (fmErr) console.warn('[approve] family_members:', fmErr.message);
    }

    // RPC confirma email no Supabase Auth
    const { error: rpcApproveErr } = await sb.rpc('approve_user', { p_user_id: userId, p_family_id: createNewFamily ? null : (familyId || null) });
    if (rpcApproveErr) console.warn('[approve] RPC:', rpcApproveErr.message);

    // signUp se não existe no Auth
    const tempPwd = _randomPassword();
    const { error: signUpErr2 } = await sb.auth.signUp({ email: userEmail, password: tempPwd,
      options: { data: { display_name: displayName } } });
    if (signUpErr2) console.warn('[approve] signUp:', signUpErr2.message);

    // Email de boas-vindas
    await _sendApprovalEmail(userEmail, displayName, familyName);

    toast('✓ ' + displayName + ' aprovado!' + (createNewFamily ? ' Criará família no primeiro login.' : familyName ? ' Família: ' + familyName : ''), 'success');
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


// ══════════════════════════════════════════════════════════════════════════════
//  COPY FAMILY DATA — copies ALL data from source family → target family
//  Target family data is wiped first, then repopulated with remapped UUIDs.
//  Admin-only operation.
// ══════════════════════════════════════════════════════════════════════════════

function openCopyFamilyModal(srcId, srcName) {
  if (currentUser?.role !== 'admin') {
    toast('Apenas Administradores globais podem copiar dados de famílias', 'error');
    return;
  }

  // Remove any existing modal
  document.getElementById('copyFamilyModal')?.remove();

  // Build target family options (all families except source)
  const _targets = (_families || []).filter(f => f.id !== srcId);
  const targetOpts = _targets.length
    ? _targets.map(f => `<option value="${f.id}">${esc(f.name || f.id)}</option>`).join('')
    : '<option value="" disabled>Nenhuma outra família disponível</option>';

  const modal = document.createElement('div');
  modal.className = 'modal-overlay open';
  modal.id = 'copyFamilyModal';
  modal.style.zIndex = '10020';
  modal.innerHTML = `
    <div class="modal" style="max-width:460px"><div class="modal-handle"></div>
      <div class="modal-header">
        <span class="modal-title">📋 Copiar Dados de Família</span>
        <button class="modal-close" onclick="closeModal('copyFamilyModal')">✕</button>
      </div>
      <div class="modal-body">
        <div style="background:var(--amber-lt);border:1px solid var(--amber);border-radius:var(--r-sm);padding:12px 14px;margin-bottom:16px;font-size:.82rem;color:var(--amber,#b45309)">
          ⚠️ <strong>Atenção:</strong> Todos os dados da família de <strong>destino</strong> serão
          <u>substituídos permanentemente</u> pelos dados da família de <strong>origem</strong>.
          Esta operação não pode ser desfeita.
        </div>

        <div class="form-group" style="margin-bottom:12px">
          <label style="font-size:.82rem;font-weight:600">Origem (fonte)</label>
          <div style="padding:9px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--r-sm);font-size:.85rem;font-weight:600">
            🏠 ${esc(srcName)}
          </div>
        </div>

        <div class="form-group" style="margin-bottom:16px">
          <label style="font-size:.82rem;font-weight:600">Destino (será sobrescrito)</label>
          <select id="copyFamilyTarget" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--surface);color:var(--text);font-size:.85rem">
            <option value="">— Selecione a família de destino —</option>
            ${targetOpts}
          </select>
        </div>

        <div id="copyFamilyProgress" style="display:none;margin-bottom:12px">
          <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden;margin-bottom:8px">
            <div id="copyFamilyBar" style="height:100%;background:var(--accent);width:0%;transition:width .3s ease;border-radius:3px"></div>
          </div>
          <div id="copyFamilyStatus" style="font-size:.78rem;color:var(--muted);text-align:center"></div>
        </div>

        <div id="copyFamilyError" style="display:none;color:var(--red);font-size:.8rem;margin-bottom:12px;padding:8px 12px;background:#fff5f5;border:1px solid #fca5a5;border-radius:var(--r-sm)"></div>

        <div style="display:flex;gap:8px">
          <button id="copyFamilyBtn" class="btn btn-primary" style="flex:1"
            onclick="executeCopyFamily('${srcId}','${esc(srcName).replace(/'/g,"\\'")}')">
            📋 Copiar Dados
          </button>
          <button class="btn btn-ghost" onclick="closeModal('copyFamilyModal')">Cancelar</button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(modal);
}

async function executeCopyFamily(srcId, srcName) {
  const targetId = document.getElementById('copyFamilyTarget')?.value;
  if (!targetId) {
    const errEl = document.getElementById('copyFamilyError');
    if (errEl) { errEl.textContent = 'Selecione a família de destino.'; errEl.style.display = ''; }
    return;
  }

  const targetFamily = (_families || []).find(f => f.id === targetId);
  const targetName   = targetFamily?.name || targetId;

  // Triple confirmation
  const conf1 = confirm(
    `⚠️ CONFIRMAÇÃO NECESSÁRIA\n\n` +
    `Você está prestes a SUBSTITUIR TODOS OS DADOS de:\n` +
    `   Destino: "${targetName}"\n\n` +
    `Com os dados de:\n` +
    `   Origem: "${srcName}"\n\n` +
    `Isso inclui: transações, contas, categorias, beneficiários, orçamentos,\n` +
    `transações programadas, listas de compras, preços e membros da família.\n\n` +
    `Esta operação NÃO PODE ser desfeita. Deseja continuar?`
  );
  if (!conf1) return;

  const typed = window.prompt(
    `Para confirmar, digite exatamente o nome da família de DESTINO:\n"${targetName}"`
  );
  if (typed !== targetName) {
    toast('Nome incorreto — operação cancelada', 'warning');
    return;
  }

  const btn      = document.getElementById('copyFamilyBtn');
  const progress = document.getElementById('copyFamilyProgress');
  const bar      = document.getElementById('copyFamilyBar');
  const status   = document.getElementById('copyFamilyStatus');
  const errEl    = document.getElementById('copyFamilyError');

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Copiando...'; }
  if (progress) progress.style.display = '';
  if (errEl) errEl.style.display = 'none';

  function setProgress(pct, msg) {
    if (bar)    bar.style.width = pct + '%';
    if (status) status.textContent = msg;
  }

  try {
    // ── STEP 1: Fetch all source data ──────────────────────────────────────
    setProgress(5, 'Lendo dados da família de origem…');

    // Tables in dependency order (parents before children)
    const TABLES = [
      { name: 'account_groups',          fk: [] },
      { name: 'categories',              fk: ['parent_id→categories.id'] },
      { name: 'payees',                  fk: ['default_category_id→categories.id'] },
      { name: 'accounts',                fk: ['group_id→account_groups.id'] },
      { name: 'price_stores',            fk: ['payee_id→payees.id'] },
      { name: 'price_items',             fk: ['category_id→categories.id'] },
      { name: 'budgets',                 fk: ['category_id→categories.id'] },
      { name: 'scheduled_transactions',  fk: ['account_id→accounts.id','payee_id→payees.id','category_id→categories.id','transfer_to_account_id→accounts.id'] },
      { name: 'grocery_lists',           fk: [] },
      { name: 'family_composition',      fk: [] },
      { name: 'transactions',            fk: ['account_id→accounts.id','payee_id→payees.id','category_id→categories.id','transfer_to_account_id→accounts.id'] },
      { name: 'price_history',           fk: ['item_id→price_items.id','store_id→price_stores.id'] },
      { name: 'grocery_items',           fk: ['list_id→grocery_lists.id','price_item_id→price_items.id'] },
      { name: 'scheduled_occurrences',   fk: ['scheduled_id→scheduled_transactions.id','transaction_id→transactions.id'] },
    ];

    const srcData = {};
    for (let i = 0; i < TABLES.length; i++) {
      const t = TABLES[i];
      setProgress(5 + Math.round((i / TABLES.length) * 25), `Lendo ${t.name}…`);
      const { data, error } = await sb.from(t.name).select('*').eq('family_id', srcId);
      if (error && error.code !== 'PGRST116') {
        console.warn(`[copy] read ${t.name}:`, error.message);
      }
      srcData[t.name] = data || [];
    }

    // ── STEP 2: Build UUID remap ───────────────────────────────────────────
    setProgress(30, 'Gerando novos IDs…');

    // Create a new UUID for each row in each table
    const idMap = {}; // oldId → newId

    function newUUID() {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
    }

    // First pass: assign new IDs for every row
    for (const t of TABLES) {
      for (const row of srcData[t.name]) {
        idMap[row.id] = newUUID();
      }
    }

    // Remap a value: if it's a known old ID → return new ID, else return as-is
    function remap(val) {
      if (!val) return val;
      return idMap[val] ?? val;
    }

    // ── STEP 3: Wipe target family data ───────────────────────────────────
    setProgress(35, 'Limpando dados da família de destino…');

    // Delete in reverse order (children before parents)
    const wipeTables = [
      'scheduled_occurrences','grocery_items','price_history','transactions',
      'grocery_lists','family_composition','budgets','scheduled_transactions',
      'price_items','price_stores','accounts','payees','categories','account_groups',
    ];
    for (const tname of wipeTables) {
      const { error } = await sb.from(tname).delete().eq('family_id', targetId);
      if (error) console.warn(`[copy] wipe ${tname}:`, error.message);
    }

    // ── STEP 4: Insert remapped data ──────────────────────────────────────
    const insertBase = 40;
    const insertRange = 55;

    for (let i = 0; i < TABLES.length; i++) {
      const t    = TABLES[i];
      const rows = srcData[t.name];
      if (!rows.length) continue;

      setProgress(
        insertBase + Math.round((i / TABLES.length) * insertRange),
        `Copiando ${t.name} (${rows.length} registros)…`
      );

      const newRows = rows.map(row => {
        const r = { ...row };

        // Assign new ID
        r.id        = idMap[row.id];
        r.family_id = targetId;

        // Remap all FK columns
        // account_groups
        // categories
        if ('parent_id'              in r) r.parent_id              = remap(r.parent_id);
        // payees
        if ('default_category_id'    in r) r.default_category_id    = remap(r.default_category_id);
        // accounts
        if ('group_id'               in r) r.group_id               = remap(r.group_id);
        // price_stores
        if ('payee_id'               in r) r.payee_id               = remap(r.payee_id);
        // price_items
        if ('category_id'            in r) r.category_id            = remap(r.category_id);
        // budgets: family_member_id
        if ('family_member_id'       in r) r.family_member_id       = remap(r.family_member_id);
        // scheduled_transactions
        if ('account_id'             in r) r.account_id             = remap(r.account_id);
        if ('transfer_to_account_id' in r) r.transfer_to_account_id = remap(r.transfer_to_account_id);
        // transactions
        if ('transfer_pair_id'       in r) r.transfer_pair_id       = remap(r.transfer_pair_id);
        if ('linked_transfer_id'     in r) r.linked_transfer_id     = remap(r.linked_transfer_id);
        // price_history
        if ('item_id'                in r) r.item_id                = remap(r.item_id);
        if ('store_id'               in r) r.store_id               = remap(r.store_id);
        // grocery_items
        if ('list_id'                in r) r.list_id                = remap(r.list_id);
        if ('price_item_id'          in r) r.price_item_id          = remap(r.price_item_id);
        // scheduled_occurrences
        if ('scheduled_id'           in r) r.scheduled_id           = remap(r.scheduled_id);
        if ('transaction_id'         in r) r.transaction_id         = remap(r.transaction_id);
        // family_composition
        if ('app_user_id'            in r) r.app_user_id            = r.app_user_id; // keep as-is (links to app_users)
        // transactions family_member_ids (UUID array)
        if (r.family_member_ids && Array.isArray(r.family_member_ids)) {
          r.family_member_ids = r.family_member_ids.map(mid => remap(mid));
        }
        // Remove created_at so DB generates fresh timestamps
        // (keep for data integrity — don't remove)

        return r;
      });

      // Insert in chunks of 200 to avoid payload limits
      const CHUNK = 200;
      for (let c = 0; c < newRows.length; c += CHUNK) {
        const chunk = newRows.slice(c, c + CHUNK);
        const { error } = await sb.from(t.name).insert(chunk);
        if (error) {
          console.warn(`[copy] insert ${t.name} chunk:`, error.message, error.details);
          // Non-fatal: log and continue
        }
      }
    }

    // ── STEP 5: Done ──────────────────────────────────────────────────────
    setProgress(100, `✅ Cópia concluída! ${Object.values(srcData).reduce((s,a) => s + a.length, 0)} registros copiados.`);
    if (bar) bar.style.background = 'var(--green,#16a34a)';
    if (btn) { btn.textContent = '✓ Concluído'; }

    setTimeout(async () => {
      closeModal('copyFamilyModal');
      toast(`✓ Dados de "${srcName}" copiados para "${targetName}" com sucesso`, 'success');
      await loadFamiliesList();
    }, 1500);

  } catch(e) {
    if (errEl) {
      errEl.textContent = 'Erro durante a cópia: ' + (e.message || e);
      errEl.style.display = '';
    }
    if (btn) { btn.disabled = false; btn.textContent = '📋 Tentar Novamente'; }
    if (bar) bar.style.background = 'var(--red)';
    console.error('[copy family]', e);
  }
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

  // Pre-load feature flags so checkboxes show correct state
  if (!window._familyFeaturesCache) window._familyFeaturesCache = {};
  try {
    const flagKeys = visibleFamilies.flatMap(f =>
      ['grocery_enabled_','prices_enabled_','investments_enabled_'].map(p => p + f.id));
    const { data: flagRows } = await sb.from('app_settings')
      .select('key,value').in('key', flagKeys);
    (flagRows||[]).forEach(r => {
      window._familyFeaturesCache[r.key] = (r.value===true||r.value==='true');
    });
  } catch {}
  const _fc = window._familyFeaturesCache;

  // Show "+ Nova Família" button only to global admins and family owners
  const newFamBtn = document.querySelector('#uaFamilies .btn-primary');
  if (newFamBtn) newFamBtn.style.display = '';

  // ── Build tab strip + panels ─────────────────────────────────────────────
  // One tab per family; each tab shows that family's panel when clicked.
  // Mobile-first: tab strip scrolls horizontally, all panels stacked below tabs.

  const fmcEscape = s => String(s||'').replace(/'/g, "\\'").replace(/"/g, '&quot;');

  function _familyTab(f, isActive) {
    const members = membersByFamily[f.id] || [];
    const name    = esc(_familyDisplayName(f.id, f.name || ''));
    return `<button
      class="fam-tab${isActive ? ' active' : ''}"
      onclick="_switchFamTab('${f.id}')"
      id="famTab-${f.id}"
      title="${name}">
      <span class="fam-tab-icon">🏠</span>
      <span class="fam-tab-name">${name}</span>
      <span class="fam-tab-count">${members.length}</span>
    </button>`;
  }

  function _memberRow(m, fid) {
    const roleOpts = ['owner','admin','user','viewer'].map(r => {
      const icons = {owner:'👑',admin:'🔧',user:'👤',viewer:'👁'};
      const labels = {owner:'Owner',admin:'Admin',user:'Usuário',viewer:'Visualizador'};
      return `<option value="${r}" ${m.member_role===r?'selected':''}>${icons[r]} ${labels[r]}</option>`;
    }).join('');
    return `
      <div class="fam-member-row">
        <div class="fam-member-info">
          ${_userAvatarHtml({ avatar_url: m.user_avatar, role: m.user_role, name: m.user_name }, 32)}
          <div class="fam-member-text">
            <div class="fam-member-name">${esc(m.user_name||'—')}</div>
            <div class="fam-member-email">${esc(m.user_email||'—')}</div>
          </div>
        </div>
        <div class="fam-member-actions">
          <select class="fam-role-select" data-uid="${m.user_id}" data-fid="${fid}" onchange="updateMemberRole(this)">
            ${roleOpts}
          </select>
          <button class="fam-remove-btn" title="Remover"
            onclick="removeUserFromFamily('${m.user_id}','${fmcEscape(m.user_name||m.user_email)}','${fmcEscape(_familyDisplayName(fid, ''))}','${fid}')">✕</button>
        </div>
      </div>`;
  }

  function _familyPanel(f, members, available, isActive) {
    const fid   = f.id;
    const fname = _familyDisplayName(fid, f.name || '');
    const _groceryOn     = !!(_fc['grocery_enabled_'     + fid]);
    const _pricesOn      = !!(_fc['prices_enabled_'      + fid]);
    const _investmentsOn = !!(_fc['investments_enabled_' + fid]);
    const _aiInsightsOn  = !!(_fc['ai_insights_enabled_' + fid]);
    const isOwner    = isGlobalAdmin || members.some(m => m.user_id === currentUser?.id && m.member_role === 'owner');

    const membersHtml = members.length
      ? members.map(m => _memberRow(m, fid)).join('')
      : `<div class="fam-empty">Nenhum usuário vinculado ainda</div>`;

    const addRow = available.length ? `
      <div class="fam-section">
        <div class="fam-section-title">➕ Adicionar usuário existente</div>
        <div class="fam-add-form">
          <select id="addMemberSel-${fid}" class="fam-select">
            <option value="">— Selecionar usuário —</option>
            ${available.map(u => `<option value="${u.id}">${esc(u.name||u.email)}</option>`).join('')}
          </select>
          <select id="addMemberRole-${fid}" class="fam-select fam-select-role">
            <option value="user">Usuário</option>
            <option value="admin">Admin</option>
            <option value="viewer">Visualizador</option>
            <option value="owner">Owner</option>
          </select>
          <button class="btn btn-primary fam-btn-full" onclick="addUserToFamily('${fid}')">+ Adicionar</button>
        </div>
      </div>` : '';

    const inviteRow = `
      <div class="fam-section">
        <div class="fam-section-title">📨 Convidar por e-mail</div>
        <div class="fam-invite-form">
          <input type="email" id="inviteEmail-${fid}" placeholder="email@exemplo.com" class="fam-input"
            onkeydown="if(event.key==='Enter')inviteToFamily('${fid}','${fmcEscape(fname)}')">
          <select id="inviteRole-${fid}" class="fam-select fam-select-role">
            <option value="user">👤 Usuário</option>
            <option value="admin">🔧 Admin</option>
            <option value="viewer">👁 Visualizador</option>
            <option value="owner">👑 Owner</option>
          </select>
          <button class="btn btn-primary fam-btn-full" id="inviteBtn-${fid}"
            onclick="inviteToFamily('${fid}','${fmcEscape(fname)}')">📨 Convidar</button>
        </div>
      </div>`;

    const modulesRow = `
      <div class="fam-section">
        <div class="fam-section-title">🧩 Módulos</div>
        <div class="fam-modules">
          <button id="famGroceryBtn-${fid}"
            class="fam-mod-chip${_groceryOn?' active':''}"
            onclick="_famToggleModule('${fid}','grocery_enabled_','famGroceryBtn-${fid}','applyGroceryFeature')">
            🛒 Mercado <span class="fam-mod-dot">${_groceryOn?'●':'○'}</span>
          </button>
          <button id="famPricesBtn-${fid}"
            class="fam-mod-chip${_pricesOn?' active':''}"
            onclick="_famToggleModule('${fid}','prices_enabled_','famPricesBtn-${fid}','applyPricesFeature')">
            🏷️ Preços <span class="fam-mod-dot">${_pricesOn?'●':'○'}</span>
          </button>
          <button id="famInvestBtn-${fid}"
            class="fam-mod-chip${_investmentsOn?' active':''}"
            onclick="_famToggleModule('${fid}','investments_enabled_','famInvestBtn-${fid}','applyInvestmentsFeature')">
            📈 Investimentos <span class="fam-mod-dot">${_investmentsOn?'●':'○'}</span>
          </button>
          <button id="famAiInsightsBtn-${fid}"
            class="fam-mod-chip${_aiInsightsOn?' active':''}"
            onclick="_famToggleModule('${fid}','ai_insights_enabled_','famAiInsightsBtn-${fid}','applyAiInsightsFeature')">
            🤖 AI Insights <span class="fam-mod-dot">${_aiInsightsOn?'●':'○'}</span>
          </button>
        </div>
      </div>`;

    const adminActions = isOwner ? `
      <div class="fam-section fam-danger-zone">
        <div class="fam-section-title">⚙️ Ações</div>
        <div class="fam-action-grid">
          <button class="fam-action-btn" onclick="editFamily('${fid}')">✏️ Editar</button>
          <button class="fam-action-btn" onclick="openDbBackupCreateForFamily('${fid}','${fmcEscape(fname)}')">📸 Backup</button>
          <button class="fam-action-btn" onclick="openFamilyBackupManager('${fid}','${fmcEscape(fname)}')">🗂️ Snapshots</button>
          <button class="fam-action-btn fam-action-warn" id="wipeFamBtn-${fid}"
            onclick="wipeFamilyData('${fid}','${fmcEscape(f.name)}')">🗑️ Dados</button>
          <button class="fam-action-btn fam-action-danger"
            onclick="deleteFamily('${fid}','${fmcEscape(f.name)}')">✕ Excluir</button>
          <button class="fam-action-btn fam-action-copy"
            onclick="openCopyFamilyModal('${fid}','${fmcEscape(fname)}')"
            title="Copiar todos os dados desta família para outra família">📋 Copiar</button>
        </div>
      </div>` : '';

    const compositionSection = isOwner ? `
      <div class="fam-section">
        <div class="fam-section-header">
          <div class="fam-section-title">👨‍👩‍👧 Membros da Família
            <span id="fmcBadge-${fid}" class="fam-badge-muted">carregando…</span>
          </div>
          <button class="btn btn-primary btn-sm fam-btn-sm"
            onclick="openFamilyMemberFormForFamily('${fid}')">+ Membro</button>
        </div>
        <div id="fmcList-${fid}" class="fam-fmc-list">
          <div class="fam-loading">Carregando…</div>
        </div>
      </div>` : '';

    return `
      <div class="fam-panel${isActive ? ' active' : ''}" id="famPanel-${fid}">
        <!-- Header -->
        <div class="fam-panel-header">
          <div class="fam-panel-title">
            <span class="fam-panel-icon">🏠</span>
            <div>
              <div class="fam-panel-name">${esc(fname)}</div>
              <div class="fam-panel-meta">
                ${members.length} membro${members.length!==1?'s':''}${f.description ? ' · ' + esc(f.description) : ''}
              </div>
            </div>
          </div>
        </div>

        <!-- Modules -->
        ${modulesRow}

        <!-- Users -->
        <div class="fam-section">
          <div class="fam-section-title">👤 Usuários vinculados</div>
          <div class="fam-members-list">${membersHtml}</div>
        </div>

        ${addRow}
        ${inviteRow}
        ${compositionSection}
        ${adminActions}
      </div>`;
  }

  // Build tab strip
  const tabsHtml = `
    <div class="fam-tabs" id="famTabsStrip">
      ${visibleFamilies.map((f, i) => _familyTab(f, i === 0)).join('')}
    </div>`;

  // Build all panels
  const panelsHtml = visibleFamilies.map((f, i) => {
    const members  = membersByFamily[f.id] || [];
    const available = (allUsers||[]).filter(u => !familiesByUser[u.id]?.has(f.id));
    return _familyPanel(f, members, available, i === 0);
  }).join('');

  el.innerHTML = tabsHtml + `<div class="fam-panels">${panelsHtml}</div>`;

  // Load family composition (members) for each visible family where user is owner/admin
  setTimeout(async () => {
    for (const f of visibleFamilies) {
      const members_for_f = membersByFamily[f.id] || [];
      const isOwnerOfThis  = isGlobalAdmin ||
        members_for_f.some(m => m.user_id === currentUser?.id && m.member_role === 'owner');
      if (isOwnerOfThis && typeof _loadAndRenderFmcForFamily === 'function') {
        _loadAndRenderFmcForFamily(f.id).catch(() => {});
      }
    }
  }, 0);

  // Sync button states from cache (in case cache updated after render)
  setTimeout(() => {
    const fc = window._familyFeaturesCache || {};
    for (const f of visibleFamilies) {
      const gBtn = document.getElementById('famGroceryBtn-' + f.id);
      const pBtn = document.getElementById('famPricesBtn-'  + f.id);
      if (gBtn) {
        const on = !!fc['grocery_enabled_' + f.id];
        gBtn.classList.toggle('active', on);
        const dot = gBtn.querySelector('.fam-mod-dot');
        if (dot) dot.textContent = on ? '●' : '○';
      }
      if (pBtn) {
        const on = !!fc['prices_enabled_' + f.id];
        pBtn.classList.toggle('active', on);
        const dot = pBtn.querySelector('.fam-mod-dot');
        if (dot) dot.textContent = on ? '●' : '○';
      }
    }
  }, 100);
}

// ── Toggle módulo de família (Mercado / Preços) ──────────────────────────
async function _famToggleModule(famId, keyPrefix, btnId, applyFn) {
  const key = keyPrefix + famId;
  const btn = document.getElementById(btnId);
  if (!btn) return;

  const isOn = btn.classList.contains('active');
  const nowOn = !isOn;

  // UI imediato
  btn.classList.toggle('active', nowOn);
  const _dotEl = btn.querySelector('.fam-mod-dot'); if (_dotEl) _dotEl.textContent = nowOn ? '●' : '○';
  btn.disabled = true;

  // Caches locais
  if (!window._familyFeaturesCache) window._familyFeaturesCache = {};
  window._familyFeaturesCache[key] = nowOn;
  try { localStorage.setItem(key, String(nowOn)); } catch {}

  // Aplicar sidebar imediatamente
  try { if (applyFn && typeof window[applyFn]==='function') await window[applyFn](); } catch {}

  // Persistir no banco — RPC primeiro, depois upsert padrão
  let saved = false;
  if (sb) {
    try {
      const { error } = await sb.rpc('set_family_feature_flag',
        { p_family_id: famId, p_key: key, p_value: nowOn });
      if (!error) saved = true;
    } catch {}
    if (!saved) {
      try {
        const { error } = await sb.from('app_settings')
          .upsert({ key, value: nowOn }, { onConflict: 'key' });
        if (!error) saved = true;
      } catch {}
    }
  }

  btn.disabled = false;
  toast(nowOn ? '✓ Módulo ativado' : 'Módulo desativado', saved ? 'success' : 'warning');
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

  toast(id ? '✓ Família atualizada!' : '✓ Família criada! Iniciando configuração…','success');
  document.getElementById('familyFormArea').style.display = 'none';
  await _loadCurrentUserContext().catch(()=>{});
  await loadFamiliesList();
  updateUserUI();
  _renderFamilySwitcher();

  // For new families: offer to run the setup wizard
  if (!id) {
    // RPC may return new family id — try to extract it from families list
    const newFam = (_families || []).find(f => f.name === name);
    _offerFamilyWizard(name, newFam?.id || null);
  }
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

// ── Wizard offer after new family creation ────────────────────────────────
function _offerFamilyWizard(familyName, familyId) {
  const el = document.getElementById('familiesList');
  if (!el) return;
  // Remove previous banner if any
  document.getElementById('wizardOfferBanner')?.remove();
  const banner = document.createElement('div');
  banner.id = 'wizardOfferBanner';
  banner.style.cssText = 'background:var(--green-lt,#dcfce7);border:1px solid var(--green,#16a34a);border-radius:8px;padding:14px 16px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap';
  banner.innerHTML = `
    <div style="font-size:.85rem;color:#15803d">
      🎉 <strong>Família "${esc(familyName)}" criada!</strong><br>
      <span style="font-size:.78rem;color:#166534">Deseja configurá-la agora com o assistente de configuração?</span>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-primary btn-sm" onclick="_launchWizardForFamily('${familyId||''}','${esc(familyName)}')" style="background:#16a34a">🚀 Configurar agora</button>
      <button class="btn btn-ghost btn-sm" onclick="document.getElementById('wizardOfferBanner')?.remove()">Depois</button>
    </div>`;
  el.insertBefore(banner, el.firstChild);
}

async function _launchWizardForFamily(familyId, familyName) {
  document.getElementById('wizardOfferBanner')?.remove();
  closeModal('userAdminModal');
  if (familyId && typeof switchFamily === 'function') {
    try { await switchFamily(familyId); } catch(_) {}
  }
  if (typeof saveAppSetting === 'function') {
    await saveAppSetting('wizard_dismissed', false).catch(()=>{});
  }
  if (typeof _wzReset === 'function' && typeof _wzOpen === 'function') {
    _wzReset();
    _wz.familyName = familyName || '';
    _wzOpen();
  } else if (typeof initWizard === 'function') {
    await initWizard();
  }
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
    const appUrl     = typeof getAppBaseUrl === 'function' ? getAppBaseUrl() : (window.location.origin + window.location.pathname);

    await emailjs.send(serviceId, templateId, {
      to_email:       toEmail,
      report_subject: `[Family FinTrack] Convite para a família "${familyName}"`,
      subject:        `[Family FinTrack] Convite para a família "${familyName}"`,
      message:        `Você foi convidado por ${inviterName} para participar da família "${familyName}" no FinTrack.\n\nAcesse ${appUrl} e solicite acesso com este e-mail (${toEmail}).\n\nSeu acesso será aprovado automaticamente após o login.`,
      family_name:    familyName,
      inviter:        inviterName,
      app_url:        appUrl,
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
              const fName = m.family_name || famById[m.family_id] || m.family_id?.slice(0,8) || '—';
              return `<span style="display:inline-flex;align-items:center;gap:3px;background:var(--accent-lt);color:var(--accent);border-radius:4px;padding:1px 6px;font-size:.7rem;margin:1px">${roleIcon} ${esc(fName)}</span>`;
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
  const formArea = document.getElementById('userFormArea');
  document.getElementById('userFormTitle').textContent = 'Novo Usuário';

  // Clear form fields
  const _set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  _set('uName', ''); _set('uEmail', ''); _set('uPassword', '');
  // Target specifically the hidden field inside userFormArea (not legacy)
  const hiddenId = formArea?.querySelector('input[type="hidden"][id="editUserId"]')
                || formArea?.querySelector('input[type="hidden"]');
  if (hiddenId) hiddenId.value = '';

  const roleEl = document.getElementById('uRole'); if (roleEl) roleEl.value = 'user';

  // Show family selector for new users
  const initFamSel  = document.getElementById('uInitFamilyId');
  const initRoleSel = document.getElementById('uInitFamilyRole');
  const initFamLabel = formArea?.querySelector('label[for="uInitFamilyId"]');
  if (initFamSel) {
    initFamSel.style.display = '';
    initFamSel.innerHTML = '<option value="">— Nenhuma (admin global) —</option>' +
      _families.map(f => `<option value="${f.id}">${esc(_familyDisplayName(f.id, f.name||''))}</option>`).join('');
    initFamSel.value = '';
  }
  if (initRoleSel) { initRoleSel.style.display = ''; initRoleSel.value = 'user'; }
  if (initFamLabel) initFamLabel.style.display = '';

  const _chk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = v; };
  _chk('pView', true); _chk('pCreate', true); _chk('pEdit', true);
  _chk('pDelete', false); _chk('pExport', true); _chk('pImport', false);

  const pwdHint = document.getElementById('pwdHint'); if (pwdHint) pwdHint.textContent = '(mín. 8 chars)';

  // Reset avatar
  const avatarPreview = document.getElementById('uAvatarPreview');
  if (avatarPreview) { avatarPreview.innerHTML = ''; }
  const removeBtn = document.getElementById('uAvatarRemoveBtn');
  if (removeBtn) removeBtn.style.display = 'none';
  const removeFlag = document.getElementById('uAvatarRemoveFlag');
  if (removeFlag) removeFlag.value = '';

  formArea.style.display = '';

  // rAF: scroll after browser paints the form
  requestAnimationFrame(() => {
    const modal = document.getElementById('userAdminModal')?.querySelector('.modal');
    if (modal) modal.scrollTop = 0;
    setTimeout(() => document.getElementById('uName')?.focus(), 80);
  });
}

async function editUser(userId) {
  // Fetch user — use RPC if available to bypass RLS
  let u;
  try {
    const { data: rpcUsers } = await sb.rpc('get_all_users');
    u = (rpcUsers || []).find(x => x.id === userId);
  } catch(_) {}
  if (!u) {
    const { data: direct } = await sb.from('app_users').select('*').eq('id', userId).single();
    u = direct;
  }
  if (!u) { toast('Usuário não encontrado ou sem permissão', 'error'); return; }

  const formArea = document.getElementById('userFormArea');
  if (!formArea) return;

  // NOTE: no switchUATab here — it fires loadUsersList async which races with form display
  document.getElementById('userFormTitle').textContent = 'Editar Usuário';
  // Set the correct hidden field (inside userFormArea — second occurrence has id="editUserId")
  // We use querySelectorAll to target specifically the one inside userFormArea
  const hiddenId = formArea.querySelector('#editUserId') ||
                   formArea.querySelector('input[type="hidden"]');
  if (hiddenId) hiddenId.value = u.id;
  // Also set the first-in-DOM occurrence as fallback for saveUser()
  const firstHidden = document.getElementById('editUserId');
  if (firstHidden) firstHidden.value = u.id;

  document.getElementById('uName').value     = u.name  || '';
  document.getElementById('uEmail').value    = u.email || '';
  document.getElementById('uPassword').value = '';
  const roleEl = document.getElementById('uRole');
  if (roleEl) roleEl.value = u.role || 'user';

  // Hide family/role selectors — family links managed in Families tab
  const initFamSelE  = document.getElementById('uInitFamilyId');   if (initFamSelE)  initFamSelE.style.display  = 'none';
  const initRoleSelE = document.getElementById('uInitFamilyRole'); if (initRoleSelE) initRoleSelE.style.display = 'none';
  const initFamLabel = formArea.querySelector('label[for="uInitFamilyId"]');
  if (initFamLabel) initFamLabel.style.display = 'none';

  // Permissions
  const _chk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
  _chk('pView',   u.can_view);
  _chk('pCreate', u.can_create);
  _chk('pEdit',   u.can_edit);
  _chk('pDelete', u.can_delete);
  _chk('pExport', u.can_export);
  _chk('pImport', u.can_import);

  const pwdHint = document.getElementById('pwdHint');
  if (pwdHint) pwdHint.textContent = '(deixe em branco para manter)';

  // Avatar
  const avatarPreview = document.getElementById('uAvatarPreview');
  if (avatarPreview) {
    avatarPreview.innerHTML = _userAvatarHtml(u, 52);
    avatarPreview.dataset.currentUrl = u.avatar_url || '';
  }
  const removeBtn = document.getElementById('uAvatarRemoveBtn');
  if (removeBtn) removeBtn.style.display = u.avatar_url ? '' : 'none';
  const removeFlag = document.getElementById('uAvatarRemoveFlag');
  if (removeFlag) removeFlag.value = '';

  // Show form and scroll modal to top so form is visible
  formArea.style.display = '';
  requestAnimationFrame(() => {
    const modal = document.getElementById('userAdminModal')?.querySelector('.modal');
    if (modal) modal.scrollTop = 0;
    else formArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
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
  // Read userId from userFormArea's hidden field (editUserModal's was renamed to editUserIdLegacy)
  const formArea = document.getElementById('userFormArea');
  const hiddenEl = formArea?.querySelector('input[type="hidden"]') || document.getElementById('editUserId');
  const userId = hiddenEl?.value || '';
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
  };
  if (avatarUrl !== undefined) record.avatar_url = avatarUrl;
  if (pwd) record.password_hash = await sha256(pwd);
  const flagEl = document.getElementById('uAvatarRemoveFlag'); if (flagEl) flagEl.value = '';
  if (!userId) {
    record.must_change_pwd = false;
    record.active          = true;
    record.approved        = true;
    // created_by must reference app_users.id (the PK), NOT auth.uid (currentUser.id)
    const creatorAppId = currentUser?.app_user_id || null;
    if (creatorAppId) record.created_by = creatorAppId;
    // Do NOT set created_by if we can't resolve the app_users PK — avoids FK violation
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

    // Para novos usuários: vincular família + criar conta Auth + enviar e-mail
    if (!userId && savedId) {
      const initFam  = document.getElementById('uInitFamilyId')?.value;
      const initRole = document.getElementById('uInitFamilyRole')?.value || 'user';
      const famName  = _families.find(f => f.id === initFam)?.name || null;

      if (initFam) {
        await sb.from('family_members').upsert(
          { user_id: savedId, family_id: initFam, role: initRole },
          { onConflict: 'user_id,family_id' }
        );
        await sb.from('app_users').update({ family_id: initFam }).eq('id', savedId);
      }

      // Create Supabase Auth account so the user can actually log in
      try {
        const { error: signUpErr } = await sb.auth.signUp({
          email:    email,
          password: pwd,
          options:  { data: { display_name: name } }
        });
        const signUpMsg = (signUpErr?.message || '').toLowerCase();
        if (signUpErr && !signUpMsg.includes('already') && !signUpMsg.includes('registered') && !signUpMsg.includes('exists')) {
          console.warn('[saveUser] signUp warning:', signUpErr.message);
        }
      } catch(authErr) {
        console.warn('[saveUser] Auth creation warning:', authErr.message);
      }

      // Send welcome email
      try {
        await _sendNewUserWelcomeEmail(email, name, famName, pwd);
      } catch(emailErr) {
        console.warn('[saveUser] Welcome email warning:', emailErr.message);
      }
    }

    const successMsg = userId
      ? `✓ Usuário ${name} atualizado com sucesso!`
      : `✓ Usuário ${name} criado! E-mail de boas-vindas enviado.`;
    toast(successMsg, 'success');
    document.getElementById('userFormArea').style.display = 'none';
    if (userId === currentUser?.id) {
      if (record.avatar_url !== undefined) currentUser.avatar_url = record.avatar_url;
      _applyCurrentUserAvatar();
      try { updateUserUI(); } catch(_) {}
    }
    await loadUsersList();
    await loadFamiliesList();
  } catch(e) { toast('Erro: '+e.message,'error'); }
}

async function approveUser(userId, userName) {
  document.getElementById('approvalUserId').value = userId;
  document.getElementById('approvalUserName').textContent = userName;
  document.getElementById('approvalNewFamilyName').value = '';
  document.getElementById('approvalError').style.display = 'none';

  // Fetch user row to check if they were invited to a specific family
  let preselectedFamilyId = null;
  try {
    const { data: uRow } = await sb.from('app_users')
      .select('family_id, name, email')
      .eq('id', userId)
      .maybeSingle();
    if (uRow?.family_id) preselectedFamilyId = uRow.family_id;
  } catch(_) {}

  // Build family selector
  document.getElementById('approvalFamilyId').innerHTML =
    '<option value="">— Nenhuma (admin global) —</option>' +
    _families.map(f => `<option value="${f.id}" ${f.id === preselectedFamilyId ? 'selected' : ''}>` +
      `${esc(_familyDisplayName(f.id, f.name||''))}</option>`).join('');

  // Show / hide invite-origin notice
  const noticeEl = document.getElementById('approvalInviteNotice');
  if (noticeEl) {
    if (preselectedFamilyId) {
      const famName = _families.find(f => f.id === preselectedFamilyId)?.name || preselectedFamilyId;
      noticeEl.innerHTML = `📨 <strong>Convite de origem:</strong> Este utilizador foi convidado para
        <strong>${esc(_familyDisplayName(preselectedFamilyId, famName))}</strong>.
        A família foi pré-selecionada acima.`;
      noticeEl.style.display = '';
    } else {
      noticeEl.style.display = 'none';
    }
  }

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

    // Show success state in modal before closing
    const approvalBody = document.querySelector('#approvalModal .modal-body');
    if (approvalBody) {
      approvalBody.innerHTML = `
        <div style="text-align:center;padding:28px 20px">
          <div style="font-size:3rem;margin-bottom:12px">✅</div>
          <div style="font-size:1rem;font-weight:700;color:var(--green);margin-bottom:6px">${esc(displayName)} aprovado!</div>
          ${familyName ? `<div style="font-size:.85rem;color:var(--muted)">Família: <strong>${esc(familyName)}</strong></div>` : ''}
          <div style="font-size:.78rem;color:var(--muted);margin-top:10px">📧 E-mail de boas-vindas enviado.</div>
        </div>`;
    }
    toast('✓ ' + displayName + ' aprovado!' + (createNewFamily ? ' Criará família no primeiro login.' : familyName ? ' Família: ' + familyName : ''), 'success');
    await loadUsersList();
    await _checkPendingApprovals();
    if (document.getElementById('uaPending')?.style.display !== 'none') _renderPendingTab();
    setTimeout(() => closeModal('approvalModal'), 2000);

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

  // Coleta todos os emails de admin: 1) config de automação + 2) todos owner/admin ativos
  const adminEmails = new Set();
  try {
    const raw = localStorage.getItem('fintrack_auto_check_config');
    if (raw) {
      const cfg = JSON.parse(raw);
      if (cfg.emailDefault) adminEmails.add(cfg.emailDefault.trim().toLowerCase());
    }
  } catch(e) {}
  try {
    const { data } = await sb.from('app_users')
      .select('email').in('role', ['owner', 'admin']).eq('active', true);
    (data || []).forEach(u => { if (u.email) adminEmails.add(u.email.trim().toLowerCase()); });
  } catch(e) {}

  if (!adminEmails.size) {
    console.warn('[approval] Sem emails de admin. Configure em Configurações → Automação → E-mail de Notificações.');
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
    '<div style="background:linear-gradient(135deg,#1e5c42,#2a6049);padding:22px 28px">' +
    '<div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.6);margin-bottom:4px">JF Family FinTrack</div>' +
    '<div style="font-size:20px;font-weight:700;color:#fff">&#128276; Nova solicitação de acesso</div>' +
    '</div>' +
    '<div style="padding:24px 28px">' +
    '<p style="color:#374151;margin:0 0 20px;font-size:14px;line-height:1.6">Um novo usuário se cadastrou e está <strong>aguardando sua aprovação</strong> para acessar o sistema.</p>' +
    '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:18px;margin-bottom:20px">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#374151;border-collapse:collapse">' +
    '<tr><td style="padding:7px 0;color:#6b7280;width:100px;font-weight:600">&#128100; Nome</td><td style="padding:7px 0;font-weight:700;color:#111827">' + nameEsc + '</td></tr>' +
    '<tr style="border-top:1px solid #e2e8f0"><td style="padding:7px 0;color:#6b7280;font-weight:600">&#128140; E-mail</td><td style="padding:7px 0;color:#111827">' + emailEsc + '</td></tr>' +
    '<tr style="border-top:1px solid #e2e8f0"><td style="padding:7px 0;color:#6b7280;font-weight:600">&#128197; Enviado</td><td style="padding:7px 0;color:#111827">' + now + '</td></tr>' +
    '</table></div>' +
    '<div style="background:#fef3c7;border-left:4px solid #f59e0b;border-radius:6px;padding:12px 16px;margin-bottom:20px">' +
    '<div style="font-size:13px;font-weight:700;color:#92400e;margin-bottom:3px">&#9888;&#65039; Acesso bloqueado</div>' +
    '<div style="font-size:12px;color:#b45309">O usuário <strong>' + nameEsc + '</strong> não tem acesso até você aprovar a solicitação.</div>' +
    '</div>' +
    '<p style="font-size:13px;color:#6b7280;margin:0">Para aprovar: abra o app &#8594; <strong>Configurações</strong> &#8594; <strong>Gerenciar Usuários</strong>.</p>' +
    '</div>' +
    '<div style="padding:14px 28px;background:#f8fafc;border-top:1px solid #e2e8f0">' +
    '<div style="font-size:11px;color:#9ca3af">JF Family FinTrack &middot; Notificação automática &middot; Não responda este e-mail</div>' +
    '</div></div></div>';

  emailjs.init(EMAILJS_CONFIG.publicKey);
  let sentCount = 0;
  for (const adminEmail of adminEmails) {
    try {
      await emailjs.send(EMAILJS_CONFIG.serviceId, tplId, {
        to_email:       adminEmail,
        report_subject: '[Family FinTrack] Nova solicitação de acesso — ' + (userName || userEmail),
        Subject:        '[Family FinTrack] Nova solicitação de acesso — ' + (userName || userEmail),
        month_year:     now,
        report_content: body,
      });
      sentCount++;
      console.log('[approval] Email enviado para admin:', adminEmail);
    } catch(e) {
      console.warn('[approval] Falha ao enviar email para', adminEmail, ':', e.message || e);
    }
  }
  if (sentCount === 0) console.warn('[approval] Nenhum email de admin enviado.');
}
// ── Email de boas-vindas ao usuário aprovado ─────────────────────────────
async function _sendApprovalEmail(email, name, familyName) {
  if (!EMAILJS_CONFIG.serviceId || !EMAILJS_CONFIG.publicKey) return;

  // 1. Enviar link de redefinição de senha (Supabase) para o usuário definir a própria senha
  try {
    const redirectTo = typeof getAppBaseUrl === 'function' ? getAppBaseUrl() : (window.location.origin + window.location.pathname);
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
      to_email:       email,
      report_subject: '[Family FinTrack] Acesso aprovado — Bem-vindo(a)!',
      Subject:        '[Family FinTrack] Acesso aprovado — Bem-vindo(a)!',
      month_year:     new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
      report_content: body,
    });
  } catch(e) { console.warn('[approval] _sendApprovalEmail:', e.message); }
}


async function _sendNewUserWelcomeEmail(email, name, familyName, tempPassword) {
  if (!EMAILJS_CONFIG.serviceId || !EMAILJS_CONFIG.publicKey) return;
  const tplId = EMAILJS_CONFIG.scheduledTemplateId || EMAILJS_CONFIG.templateId;
  if (!tplId) return;

  const nameEsc = (name || 'Usuário').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
  const famEsc  = (familyName || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
  const appUrl  = typeof getAppBaseUrl === 'function' ? getAppBaseUrl() : (window.location.origin + window.location.pathname);

  const famBlock = familyName
    ? `<div style="background:#f0fdf4;border-left:4px solid #22c55e;border-radius:6px;padding:12px 16px;margin-bottom:20px">
        <div style="font-size:13px;font-weight:700;color:#166534;margin-bottom:2px">&#128106; Família vinculada</div>
        <div style="font-size:13px;color:#15803d">${famEsc}</div>
       </div>`
    : '';

  const body =
    '<div style="font-family:Arial,Helvetica,sans-serif;background:#f5f7fb;padding:24px">' +
    '<div style="max-width:540px;margin:0 auto;background:#fff;border:1px solid #e6e8f0;border-radius:12px;overflow:hidden">' +

    '<div style="background:linear-gradient(135deg,#1e5c42,#2a6049);padding:22px 28px">' +
    '<div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.6);margin-bottom:4px">Family FinTrack</div>' +
    '<div style="font-size:22px;font-weight:700;color:#fff">&#127881; Bem-vindo(a)!</div>' +
    '</div>' +

    '<div style="padding:24px 28px">' +
    `<p style="font-size:15px;font-weight:600;color:#111827;margin:0 0 12px">Olá, ${nameEsc}!</p>` +
    '<p style="font-size:14px;color:#374151;margin:0 0 20px;line-height:1.6">' +
    'Sua conta no <strong>Family FinTrack</strong> foi criada pelo administrador. Você já pode acessar o sistema.' +
    '</p>' +

    famBlock +

    '<div style="background:#fef9e8;border:1px solid #fcd34d;border-radius:8px;padding:14px 16px;margin-bottom:20px">' +
    '<div style="font-size:13px;font-weight:700;color:#92400e;margin-bottom:8px">&#128273; Seus dados de acesso</div>' +
    `<div style="font-size:13px;color:#374151;margin-bottom:4px"><strong>E-mail:</strong> ${email}</div>` +
    `<div style="font-size:13px;color:#374151;margin-bottom:12px"><strong>Senha temporária:</strong> <code style="background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:12px">${tempPassword}</code></div>` +
    '<div style="font-size:12px;color:#92400e">&#9888; Altere sua senha após o primeiro login em Configurações → Conta &amp; Segurança.</div>' +
    '</div>' +

    `<div style="text-align:center;margin-bottom:24px"><a href="${appUrl}" style="display:inline-block;background:#2a6049;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">Acessar o Family FinTrack →</a></div>` +

    '<p style="font-size:12px;color:#9ca3af;margin:0">Se você não esperava este e-mail, entre em contato com o administrador.</p>' +
    '</div>' +

    '<div style="padding:14px 28px;background:#f8fafc;border-top:1px solid #e2e8f0">' +
    '<div style="font-size:11px;color:#9ca3af">Family FinTrack &middot; Bem-vindo(a) à família!</div>' +
    '</div>' +
    '</div></div>';

  try {
    emailjs.init(EMAILJS_CONFIG.publicKey);
    await emailjs.send(EMAILJS_CONFIG.serviceId, tplId, {
      to_email:       email,
      report_subject: '[Family FinTrack] Sua conta foi criada!',
      Subject:        '[Family FinTrack] Sua conta foi criada!',
      month_year:     new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
      report_content: body,
    });
  } catch(e) { console.warn('[saveUser] emailjs send:', e.message); }
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
      const redirectTo = typeof getAppBaseUrl === 'function' ? getAppBaseUrl() : (window.location.origin + window.location.pathname);
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

  const targetPage = state.currentPage || 'dashboard';

  // ── 1. Limpar UI da família anterior ─────────────────────────────────────
  try { clearFamilyScopedUI?.(); } catch(e) {}

  // ── 2. Limpar caches de módulos específicos ───────────────────────────────
  try { DB.bustAll?.(); } catch(e) {}
  try { if (typeof fmcBust === 'function') fmcBust(); } catch(e) {}           // family_members_composition
  try { if (typeof _inv !== 'undefined') { _inv.loaded = false; _inv.positions = []; _inv.transactions = []; } } catch(e) {}  // investments
  try { if (typeof _catChartEntries !== 'undefined') _catChartEntries.length = 0; } catch(e) {}  // dashboard chart
  try { if (typeof rptState !== 'undefined') rptState.txData = []; } catch(e) {}  // reports
  try { if (typeof _destroyForecastChart === 'function') _destroyForecastChart(); } catch(e) {}

  // ── 3. Atualizar currentUser para nova família ────────────────────────────
  currentUser.family_id = familyId;
  if (currentUser.role !== 'admin' && currentUser.role !== 'owner') {
    currentUser.role = fam.role || 'user';
    const r = currentUser.role;
    currentUser.can_create        = r !== 'viewer';
    currentUser.can_edit          = r !== 'viewer';
    currentUser.can_delete        = r === 'admin' || r === 'owner';
    currentUser.can_import        = r === 'admin' || r === 'owner';
    currentUser.can_admin         = r === 'admin';
    currentUser.can_manage_family = r === 'admin' || r === 'owner';
  }
  localStorage.setItem('ft_active_family_' + currentUser.id, familyId);
  try { _renderFxBadge?.(); } catch(_) {}

  // ── 4. Recarregar dados essenciais (force=true para ignorar cache) ─────────
  try {
    await Promise.all([
      DB.accounts.load(true).catch(()=>{}),
      DB.categories.load(true).catch(()=>{}),
      DB.payees.load(true).catch(()=>{}),
      loadScheduled().catch(()=>{}),
      loadAppSettings().catch(()=>{}),
    ]);
  } catch(e) {}

  // ── 5. Recarregar módulos secundários em background ───────────────────────
  try { if (typeof loadFamilyComposition === 'function') loadFamilyComposition(true).catch(()=>{}); } catch(e) {}
  try { initFxRates().catch(()=>{}); } catch(e) {}

  // ── 6. Atualizar permissões e UI ──────────────────────────────────────────
  updateUserUI();           // atualiza sidebar (nome da família) e topbar
  _renderFamilySwitcher();
  applyPermissions?.();

  // ── 7. Atualizar módulos opcionais (feature flags da nova família) ─────────
  try { if (typeof applyPricesFeature === 'function')      await applyPricesFeature();      } catch(e) {}
  try { if (typeof applyGroceryFeature === 'function')     await applyGroceryFeature();     } catch(e) {}
  try { if (typeof applyInvestmentsFeature === 'function') await applyInvestmentsFeature(); } catch(e) {}
  try { if (typeof applyAiInsightsFeature === 'function')  await applyAiInsightsFeature();  } catch(e) {}

  // ── 8. Repopular todos os selects com dados da nova família ───────────────
  try { populateSelects(); } catch(e) {}

  // ── 9. Navegar para a página atual, forçando reload dos dados ─────────────
  // Usa navigate() diretamente — cada página tem seu próprio loader
  navigate(targetPage);

  const roleIcon = { owner:'👑', admin:'🔧', user:'👤', viewer:'👁' }[currentUser.role] || '👤';
  toast(roleIcon + ' ' + fam.name, 'success');
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

    // ── Popup de alerta quando chegou novo usuário ──
    const _prevCount = window._pendingApprovalLastCount ?? -1;
    window._pendingApprovalLastCount = count;
    if (count > 0 && count > _prevCount && _prevCount >= 0) {
      // Novo usuário chegou desde a última verificação
      _showPendingApprovalPopup(pendingUsers[pendingUsers.length - 1], count);
    } else if (count > 0 && _prevCount === -1) {
      // Primeira carga com pendentes — mostra popup
      _showPendingApprovalPopup(pendingUsers[0], count);
    }

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

// ── Popup de alerta para admin: novo usuário aguardando aprovação ─────────────
function _showPendingApprovalPopup(user, totalCount) {
  document.getElementById('pendingApprovalPopup')?.remove();
  const name  = user?.name  || 'Novo usuário';
  const email = user?.email || '';
  const uid   = user?.id    || '';
  const uname = (name + '').replace(/"/g, '&quot;');
  const countLabel = totalCount === 1
    ? '1 solicitação aguardando aprovação'
    : `${totalCount} solicitações aguardando aprovação`;
  const popup = document.createElement('div');
  popup.id = 'pendingApprovalPopup';
  popup.style.cssText = 'position:fixed;bottom:80px;right:16px;z-index:99999;max-width:320px;width:calc(100vw - 32px);background:var(--surface);border:1.5px solid var(--amber,#f59e0b);border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.18);overflow:hidden;animation:slideUpFadeIn .3s ease';
  popup.innerHTML = `
    <div style="background:linear-gradient(135deg,#b45309,#d97706);padding:12px 14px 10px;display:flex;align-items:center;gap:10px">
      <span style="font-size:1.3rem">🔔</span>
      <div style="flex:1;min-width:0">
        <div style="color:#fff;font-size:.82rem;font-weight:800;line-height:1.2">${countLabel}</div>
      </div>
      <button onclick="document.getElementById('pendingApprovalPopup')?.remove()"
        style="background:rgba(255,255,255,.2);border:none;color:#fff;width:24px;height:24px;border-radius:50%;cursor:pointer;font-size:.85rem;display:flex;align-items:center;justify-content:center;flex-shrink:0">✕</button>
    </div>
    <div style="padding:12px 14px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <div style="width:38px;height:38px;border-radius:50%;background:var(--amber-lt,#fef3c7);border:2px solid var(--amber,#f59e0b);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.8rem;color:#92400e;flex-shrink:0">
          ${(name[0]||'?').toUpperCase()}
        </div>
        <div style="min-width:0">
          <div style="font-size:.85rem;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name.replace(/</g,'&lt;')}</div>
          <div style="font-size:.72rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${email.replace(/</g,'&lt;')}</div>
        </div>
      </div>
      <div style="display:flex;gap:7px">
        <button onclick="document.getElementById('pendingApprovalPopup')?.remove();navigate('settings')"
          style="flex:1;padding:8px;border-radius:9px;border:1.5px solid var(--amber,#f59e0b);background:var(--amber-lt,#fef3c7);color:#92400e;font-size:.78rem;font-weight:700;cursor:pointer;font-family:var(--font-sans)">
          Ver solicitações
        </button>
        ${uid ? `<button data-uid="${uid}" data-uname="${uname}"
          onclick="document.getElementById('pendingApprovalPopup')?.remove();approveUser(this.dataset.uid,this.dataset.uname)"
          style="flex:1;padding:8px;border-radius:9px;border:none;background:#16a34a;color:#fff;font-size:.78rem;font-weight:700;cursor:pointer;font-family:var(--font-sans)">
          ✓ Aprovar
        </button>` : ''}
      </div>
    </div>`;
  document.body.appendChild(popup);
  setTimeout(() => popup?.remove(), 30000);
}
// Keyframe de animação para o popup
(function() {
  if (document.getElementById('_pendingPopupStyle')) return;
  const s = document.createElement('style');
  s.id = '_pendingPopupStyle';
  s.textContent = '@keyframes slideUpFadeIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}';
  document.head.appendChild(s);
})();

// ══════════════════════════════════════════════════════════════════════════════
// FAMILY MANAGEMENT PANEL (owner) — openMyFamilyMgmt + helpers
// ══════════════════════════════════════════════════════════════════════════════

let _mfmActiveFamilyId = null;

async function openMyFamilyMgmt() {
  const _isGlobalAdmin = currentUser?.role === 'admin' || currentUser?.can_admin;

  // Famílias onde o usuário é owner ou admin global
  let ownedFams = (currentUser?.families || []).filter(f =>
    f.role === 'owner' || f.role === 'admin' || _isGlobalAdmin
  );

  // Fallback: se currentUser.families está vazio mas o usuário tem family_id e role owner/admin,
  // cria uma entrada sintética para não bloquear desnecessariamente
  if (!ownedFams.length && currentUser?.family_id) {
    const isOwnerRole = currentUser?.role === 'owner' || currentUser?.role === 'admin' || _isGlobalAdmin;
    if (isOwnerRole) {
      ownedFams = [{ id: currentUser.family_id, name: '', role: currentUser.role }];
    }
  }

  // Fallback final: se ainda vazio mas currentUser.role indica owner/admin, confia
  if (!ownedFams.length && (currentUser?.role === 'owner' || currentUser?.role === 'admin' || currentUser?.can_manage_family)) {
    const fid = currentUser.family_id;
    if (fid) ownedFams = [{ id: fid, name: '', role: currentUser.role }];
  }

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
  document.querySelectorAll('[id^="mfmTab-"]').forEach(b => {
    b.classList.toggle('active', b.id === `mfmTab-${famId}`);
  });
  _mfmRender();
}

// ── Section tab switcher for the redesigned family modal ──────────────────
function mfmSwitchTab(tab) {
  const paneMap = { modulos:'mfmPaneModulos', membros:'mfmPaneMembros', integrantes:'mfmPaneIntegrantes', dados:'mfmPaneDados', nova:'mfmPaneNova' };
  const navMap  = { modulos:'mfmNavModulos',  membros:'mfmNavMembros',  integrantes:'mfmNavIntegrantes',  dados:'mfmNavDados',  nova:'mfmNavNova' };
  Object.keys(paneMap).forEach(t => {
    document.getElementById(paneMap[t])?.classList.toggle('active', t === tab);
    document.getElementById(navMap[t])?.classList.toggle('active', t === tab);
  });
  if (tab === 'membros')     _mfmRenderMembros();
  if (tab === 'integrantes') _mfmLoadIntegrantes();
  if (tab === 'dados')       _mfmRenderDataSection(_mfmActiveFamilyId);
}
window.mfmSwitchTab = mfmSwitchTab;

async function _mfmRenderMembros(famId) {
  famId = famId || _mfmActiveFamilyId;
  if (!famId) return;
  const listEl = document.getElementById('mfmMembersList');
  if (listEl) listEl.innerHTML = '<div style="color:var(--muted);font-size:.8rem;text-align:center;padding:24px">⏳ Carregando…</div>';
  let members = [];
  try {
    const { data: rpcData } = await sb.rpc('get_all_family_members');
    if (rpcData) members = rpcData.filter(m => m.family_id === famId);
  } catch(_) {}
  if (!members.length) {
    try {
      const { data: fmData } = await sb.from('family_members').select('user_id, role, app_users(id,name,email,avatar_url,role,active)').eq('family_id', famId);
      members = (fmData || []).map(r => ({ user_id: r.user_id, member_role: r.role, user_name: r.app_users?.name || '—', user_email: r.app_users?.email || '—', user_avatar: r.app_users?.avatar_url || null, user_role: r.app_users?.role || 'user', user_active: r.app_users?.active ?? true, family_id: famId }));
    } catch(_) {}
  }
  if (listEl) {
    listEl.innerHTML = !members.length
      ? '<div style="color:var(--muted);font-size:.8rem;text-align:center;padding:24px">Nenhum membro ainda.</div>'
      : members.map(m => `<div class="mfm2-member">
          <div class="mfm2-member-av">${_userAvatarHtml({ avatar_url: m.user_avatar, role: m.user_role, name: m.user_name }, 36)}</div>
          <div class="mfm2-member-info"><div class="mfm2-member-name">${esc(m.user_name)}</div><div class="mfm2-member-email">${esc(m.user_email)}</div></div>
          <select class="mfm2-role-sel" onchange="mfmChangeRole(this,'${m.user_id}','${famId}')">
            <option value="owner"  ${m.member_role==='owner'  ?'selected':''}>👑 Owner</option>
            <option value="admin"  ${m.member_role==='admin'  ?'selected':''}>🔧 Admin</option>
            <option value="user"   ${m.member_role==='user'   ?'selected':''}>👤 Usuário</option>
            <option value="viewer" ${m.member_role==='viewer' ?'selected':''}>👁 Visualizador</option>
          </select>
          <button class="mfm2-remove-btn" title="Remover" onclick="mfmRemoveMember('${m.user_id}','${esc(m.user_name)}','${famId}')">✕</button>
        </div>`).join('');
  }
  // Populate add-existing dropdown
  const memberIds = new Set(members.map(m => m.user_id));
  const addSel = document.getElementById('mfmAddUserSel');
  if (addSel) {
    try {
      const myFamilyIds = (currentUser?.families || []).map(f => f.id).filter(Boolean);
      let eligible = [];
      if (myFamilyIds.length) {
        const { data: myMembers } = await sb.from('family_members').select('user_id').in('family_id', myFamilyIds);
        const myIds = [...new Set((myMembers || []).map(m => m.user_id))];
        if (myIds.length) { const { data: u } = await sb.from('app_users').select('id,name,email').in('id', myIds).eq('approved', true).order('name'); eligible = u || []; }
      }
      const available = eligible.filter(u => !memberIds.has(u.id));
      addSel.innerHTML = '<option value="">— Selecionar —</option>' + available.map(u => `<option value="${u.id}">${esc(u.name || u.email)}</option>`).join('');
      const existRow = document.getElementById('mfmAddExistingRow');
      if (existRow) existRow.style.display = available.length ? '' : 'none';
    } catch(_) {}
  }
  const invEl = document.getElementById('mfmInviteEmail');
  if (invEl) invEl.value = '';
  _mfmMsg('', '');
}
window._mfmRenderMembros = _mfmRenderMembros;

function _mfmLoadIntegrantes() {
  const famId = _mfmActiveFamilyId;
  if (!famId) return;
  const el = document.getElementById('mfmFmcList');
  if (!el) return;
  if (typeof _loadAndRenderFmcForFamily === 'function') {
    _loadAndRenderFmcForFamily(famId, 'mfmFmcList').catch(() => {
      el.innerHTML = '<div style="color:var(--muted);font-size:.8rem;text-align:center;padding:16px">Nenhum integrante cadastrado.</div>';
    });
  }
}

// ── Add-member panel: switch between tabs ──────────────────────────────────
function mfmSwitchAddTab(tab) {
  const paneExist  = document.getElementById('mfmPaneExist');
  const paneInvite = document.getElementById('mfmPaneInvite');
  const tabExist   = document.getElementById('mfmTabExist');
  const tabInvite  = document.getElementById('mfmTabInvite');
  if (!paneExist || !paneInvite) return;

  const isExist = tab === 'exist';
  paneExist.style.display  = isExist ? '' : 'none';
  paneInvite.style.display = isExist ? 'none' : '';

  tabExist?.classList.toggle('active', isExist);
  tabInvite?.classList.toggle('active', !isExist);
}

// ── Toggle add-member panel ─────────────────────────────────────────────────
function mfmToggleAddPanel() {
  const panel = document.getElementById('mfmAddPanel');
  if (!panel) return;
  const isOpen = panel.style.display !== 'none' && panel.style.display !== '';
  panel.style.display = isOpen ? 'none' : '';
  if (!isOpen) { mfmSwitchAddTab('exist'); _mfmMsg('', ''); }
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

  // Default to Módulos tab; lazy-load others on click
  mfmSwitchTab('modulos');
  _mfmRenderFeatures(_mfmActiveFamilyId);
  // Pre-load membros in background
  _mfmRenderMembros(famId);
}

// ── Data management section: backup, snapshot, copy, delete ─────────────────
function _mfmRenderDataSection(famId) {
  const el = document.getElementById('mfmDataActions');
  if (!el || !famId) return;

  const fam = _families.find(f => f.id === famId) ||
              (currentUser?.families || []).find(f => f.id === famId);
  const famName = fam?.name || _familyDisplayName?.(famId, '') || '';

  const isOwner = currentUser?.role === 'admin' || currentUser?.role === 'owner' ||
    currentUser?.can_admin ||
    (currentUser?.families || []).some(f => String(f.id) === String(famId) &&
      (f.role === 'owner' || f.role === 'admin'));

  // Backup/Snapshot card — always available if module active
  const snapshotBtn = `
    <button class="mfm2-data-btn" onclick="closeModal('myFamilyMgmtModal');setTimeout(()=>openFamilyBackupManager('${famId}','${famName.replace(/'/g,"\'")}'),120)">
      <div class="mfm2-data-icon" style="background:#eff6ff;color:#2563eb">📸</div>
      <div class="mfm2-data-info">
        <span class="mfm2-data-label">Snapshots</span>
        <span class="mfm2-data-sub">Criar e restaurar backups</span>
      </div>
    </button>`;

  // Export JSON backup
  const exportBtn = `
    <button class="mfm2-data-btn" onclick="closeModal('myFamilyMgmtModal');setTimeout(exportBackup,120)">
      <div class="mfm2-data-icon" style="background:#f0fdf4;color:#16a34a">⬇️</div>
      <div class="mfm2-data-info">
        <span class="mfm2-data-label">Exportar JSON</span>
        <span class="mfm2-data-sub">Baixar backup completo</span>
      </div>
    </button>`;

  // Copy family — owners only
  const copyBtn = isOwner ? `
    <button class="mfm2-data-btn" onclick="closeModal('myFamilyMgmtModal');setTimeout(()=>openCopyFamilyModal('${famId}','${famName.replace(/'/g,"\'")}'),120)">
      <div class="mfm2-data-icon" style="background:#fef3c7;color:#d97706">📋</div>
      <div class="mfm2-data-info">
        <span class="mfm2-data-label">Copiar família</span>
        <span class="mfm2-data-sub">Duplicar dados para outra família</span>
      </div>
    </button>` : '';

  // Wipe data — owners only, dangerous
  const wipeBtn = isOwner ? `
    <button class="mfm2-data-btn warn" onclick="closeModal('myFamilyMgmtModal');setTimeout(()=>wipeFamilyData('${famId}','${famName.replace(/'/g,"\'")}'),200)">
      <div class="mfm2-data-icon" style="background:#fef3c7;color:#d97706">🗑️</div>
      <div class="mfm2-data-info">
        <span class="mfm2-data-label">Limpar dados</span>
        <span class="mfm2-data-sub">Remove transações e histórico</span>
      </div>
    </button>` : '';

  // Delete family — owners only, very dangerous
  const deleteBtn = isOwner ? `
    <button class="mfm2-data-btn danger" onclick="closeModal('myFamilyMgmtModal');setTimeout(()=>deleteFamily('${famId}','${famName.replace(/'/g,"\'")}'),200)">
      <div class="mfm2-data-icon" style="background:#fef2f2;color:#dc2626">⛔</div>
      <div class="mfm2-data-info">
        <span class="mfm2-data-label">Excluir família</span>
        <span class="mfm2-data-sub">Remove a família permanentemente</span>
      </div>
    </button>` : '';

  el.innerHTML = snapshotBtn + exportBtn + copyBtn + wipeBtn + deleteBtn;
}
window._mfmRenderDataSection = _mfmRenderDataSection;

function _mfmRenderFeatures(famId) {
  const container = document.getElementById('mfmFeatCards');
  if (!container || !famId) return;

  const MODULES = [
    { key: 'prices_enabled_'      + famId, label: 'Preços',       emoji: '🏷️', desc: 'Catálogo de preços',    applyFn: 'applyPricesFeature' },
    { key: 'grocery_enabled_'     + famId, label: 'Mercado',      emoji: '🛒', desc: 'Lista de compras',      applyFn: 'applyGroceryFeature' },
    { key: 'investments_enabled_' + famId, label: 'Investimentos',emoji: '📈', desc: 'Carteira de ativos',    applyFn: 'applyInvestmentsFeature' },
    { key: 'ai_insights_enabled_' + famId, label: 'AI Insights',  emoji: '🤖', desc: 'Análise com IA',        applyFn: 'applyAiInsightsFeature' },
    { key: 'debts_enabled_'       + famId, label: 'Dívidas',      emoji: '💳', desc: 'Controle de dívidas',   applyFn: 'applyDebtsFeature' },
    { key: 'backup_enabled_'      + famId, label: 'Backup',       emoji: '☁️', desc: 'Backup automático',     applyFn: null },
    { key: 'snapshot_enabled_'    + famId, label: 'Snapshot',     emoji: '📸', desc: 'Snapshots periódicos',  applyFn: null },
  ];

  function render() {
    const fc = window._familyFeaturesCache || {}; // always read live reference
    container.innerHTML = MODULES.map(({ key, label, emoji, applyFn, desc }) => {
      const on = fc[key] !== undefined ? !!fc[key] : (key.includes('backup') || key.includes('snapshot'));
      return `<button class="mfm2-module${on ? ' on' : ''}"
        onclick="_mfmToggleFeature('${key}','${famId}','${label}','${applyFn||''}')">
        <div class="mfm2-module-emoji">${emoji}</div>
        <div class="mfm2-module-label">${label}</div>
        ${desc ? `<div class="mfm2-module-desc">${desc}</div>` : ''}
        <div class="mfm2-module-toggle">
          <span class="mfm2-toggle-dot${on ? ' on' : ''}"></span>
        </div>
      </button>`;
    }).join('');
  }

  // Always re-fetch ALL module keys fresh (handles new modules added post-deploy)
  (async () => {
    if (!window._familyFeaturesCache) window._familyFeaturesCache = {};
    const allKeys = MODULES.map(m => m.key);
    try {
      const { data } = await sb.from('app_settings')
        .select('key,value')
        .in('key', allKeys);
      allKeys.forEach(k => {
        const row = (data || []).find(r => r.key === k);
        if (row) {
          window._familyFeaturesCache[k] = (row.value === true || row.value === 'true');
        } else {
          // Not in DB: check localStorage (user may have toggled but DB save failed)
          const local = localStorage.getItem(k);
          window._familyFeaturesCache[k] = local === 'true'
            ? true
            : (k.includes('backup') || k.includes('snapshot'));
        }
      });
    } catch(_) {}
    render();
  })();
}

/**
 * Verifica se o usuário atual pode gerenciar a família especificada.
 * Retorna true para: owner da família, admin global, ou owner global.
 * Usa currentUser.families[] (role por família) em vez de currentUser.role (role ativo global).
 */
function _canManageFamily(famId) {
  if (!window.currentUser) return false;
  const u = window.currentUser;

  // Nível 1: admin global ou can_admin — acesso irrestrito
  if (u.role === 'admin' || u.can_admin) return true;

  // Nível 2: role efetivo 'owner' — o usuário é owner da família ativa
  // currentUser.role já é o role efetivo calculado em _loadCurrentUserContext
  // Se chegou até aqui com role='owner', o acesso é legítimo
  if (u.role === 'owner') return true;

  // Nível 3: can_manage_family flag (derivado de role owner/admin na família ativa)
  if (u.can_manage_family) return true;

  // Nível 4: role global em app_users (owner/admin global independente de família ativa)
  // Cobre o caso onde app_users.role='owner' mas activeRole ficou 'user' por family_members.role=NULL
  if (u.app_role === 'owner' || u.app_role === 'admin') return true;

  // Nível 5: verifica explicitamente o role nessa família específica
  // (cobre multi-família onde o usuário pode ter roles diferentes por família)
  const fid = String(famId || '').trim();
  const familyEntry = (u.families || []).find(f => String(f.id).trim() === fid);
  if (familyEntry?.role === 'owner' || familyEntry?.role === 'admin') return true;

  return false;
}

async function _mfmToggleFeature(key, famId, label, applyFn) {
  // Nota de segurança: o acesso já foi validado em openMyFamilyMgmt().
  // Não repetimos o check aqui para evitar falsos negativos por dessincronia
  // entre currentUser (carregado no login) e o estado real da família.

  if (!window._familyFeaturesCache) window._familyFeaturesCache = {};
  const nowOn = !window._familyFeaturesCache[key];

  // ── Atualização síncrona de todos os caches antes de qualquer await ──────
  window._familyFeaturesCache[key] = nowOn;
  if (window._appSettingsCache) window._appSettingsCache[key] = nowOn;
  try { localStorage.setItem(key, String(nowOn)); } catch(_) {}

  // Aplica feature imediatamente (UI responsiva, sem aguardar DB)
  if (applyFn && typeof window[applyFn] === 'function') {
    window[applyFn]().catch(() => {});
  }
  toast(nowOn ? `✓ ${label} ativado` : `${label} desativado`, 'success');
  _mfmRenderFeatures(famId);

  // ── Persistência best-effort — 3 caminhos em cascata ────────────────────
  (async () => {
    const modKey = key.replace(/_enabled_.*$/, '');

    // 1. family_preferences (RLS owner-safe, tabela dedicada)
    if (typeof updateFamilyPreferences === 'function') {
      try { await updateFamilyPreferences({ modules: { [modKey]: nowOn } }); return; } catch(_) {}
    }

    // 2. families.settings JSONB (owner sempre pode escrever na própria família)
    if (famId && window.sb) {
      try {
        const { data: fRow } = await sb.from('families')
          .select('settings').eq('id', famId).maybeSingle();
        const cur  = (typeof fRow?.settings === 'object' && fRow?.settings) ? fRow.settings : {};
        const next = { ...cur, modules: { ...(cur.modules || {}), [modKey]: nowOn } };
        const { error } = await sb.from('families').update({ settings: next }).eq('id', famId);
        if (!error) return;
      } catch(_) {}
    }

    // 3. app_settings legado (pode falhar por RLS para owner — localStorage já garantiu)
    if (typeof saveAppSetting === 'function') {
      saveAppSetting(key, nowOn).catch(() => {});
    }
  })();
}

async function mfmChangeRole(sel, userId, famId) {
  const newRole = sel.value;
  const { error } = await sb.from('family_members')
    .update({ role: newRole }).eq('user_id', userId).eq('family_id', famId);
  if (error) { toast('Erro: ' + error.message, 'error'); return; }
  toast(t('profile.updated'), 'success');
}

async function mfmRemoveMember(userId, userName, famId) {
  if (!confirm(`Remover "${userName}" desta família?\n\nO usuário perderá acesso a esta família.`)) return;
  const { error } = await sb.from('family_members')
    .delete().eq('user_id', userId).eq('family_id', famId);
  if (error) { toast('Erro: ' + error.message, 'error'); return; }
  toast(t('toast.member_removed'), 'success');
  await _mfmRender();
}

// ── Nova família a partir do painel de gerenciamento ─────────────────────────

function mfmScrollToNewFamily() {
  mfmSwitchTab('nova');
  setTimeout(() => { document.getElementById('mfmNewFamName')?.focus(); }, 120);
}

function mfmToggleNewFamPanel() {
  const panel   = document.getElementById('mfmNewFamPanel');
  const trigger = document.getElementById('mfmNewFamTrigger');
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : '';
  if (!isOpen) {
    // Abre: foca o input e limpa estado anterior
    const inp = document.getElementById('mfmNewFamName');
    const err = document.getElementById('mfmNewFamError');
    const btn = document.getElementById('mfmNewFamBtn');
    if (inp) { inp.value = ''; setTimeout(() => inp.focus(), 80); }
    if (err) err.style.display = 'none';
    if (btn) { btn.disabled = false; btn.textContent = '🏠 Criar família'; }
    if (trigger) { trigger.style.borderColor = 'var(--accent)'; trigger.style.color = 'var(--accent)'; }
  } else {
    if (trigger) { trigger.style.borderColor = ''; trigger.style.color = ''; }
  }
}

async function mfmCreateNewFamily() {
  const inp    = document.getElementById('mfmNewFamName');
  const err    = document.getElementById('mfmNewFamError');
  const btn    = document.getElementById('mfmNewFamBtn');
  const name   = (inp?.value || '').trim();

  const showErr = (msg) => {
    if (err) { err.textContent = msg; err.style.display = ''; }
    if (btn) { btn.disabled = false; btn.textContent = '🏠 Criar família'; }
  };

  if (!name) { showErr('Informe o nome da família.'); inp?.focus(); return; }
  if (name.length < 2) { showErr('Nome deve ter pelo menos 2 caracteres.'); return; }

  if (err) err.style.display = 'none';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Criando...'; }

  try {
    // 1. Criar a família no banco
    const { data: newFam, error: famErr } = await sb
      .from('families')
      .insert({ name })
      .select('id, name')
      .single();
    if (famErr) throw new Error('Erro ao criar família: ' + famErr.message);

    const newFamId = newFam.id;

    // 2. Associar o usuário atual como owner
    const userId = currentUser?.id;
    if (userId) {
      const { error: memErr } = await sb
        .from('family_members')
        .upsert({ user_id: userId, family_id: newFamId, role: 'owner' },
                { onConflict: 'user_id,family_id' });
      if (memErr) console.warn('[mfmCreateNewFamily] family_members upsert:', memErr.message);
    }

    // 3. Atualizar currentUser.families localmente (evita reload completo)
    if (!currentUser.families) currentUser.families = [];
    currentUser.families.push({ id: newFamId, name, role: 'owner' });

    // 4. Atualizar cache global de famílias
    if (!window._families) window._families = [];
    window._families.push({ id: newFamId, name });

    // 5. Fechar painel de criação
    mfmSwitchTab('modulos');
    toast(`✓ Família "${esc(name)}" criada!`, 'success');

    // 6. Mudar para nova família automaticamente
    await switchFamily(newFamId);

    // 7. Reabrir o painel para mostrar a nova família
    // (pequeno delay para switchFamily terminar suas animações)
    setTimeout(() => openMyFamilyMgmt(), 600);

  } catch(e) {
    showErr(e.message || 'Erro ao criar família.');
  }
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
  try { await sb.from('app_users').update({ family_id: famId }).eq('id', userId); } catch (_) {}
  toast('✓ Usuário adicionado', 'success');
  await _mfmRenderMembros(famId);
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

      try { await sb.from('family_members').insert({ user_id: newUser.id, family_id: famId, role }); } catch (_) {}
      await _sendInviteEmail(email, fam.name, currentUser.name || currentUser.email);
      _mfmMsg(`✓ Convite enviado para ${email}. O acesso será liberado após aprovação.`, 'success');
    }

    if (emailEl) emailEl.value = '';
    await _mfmRenderMembros(_mfmActiveFamilyId);
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

// ══════════════════════════════════════════════════════════════════════════════
// LISTA DE ESPERA — Gerenciamento admin
// ══════════════════════════════════════════════════════════════════════════════

async function _updateWaitlistBadge() {
  try {
    const { count } = await sb.from('waitlist')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');
    const badge = document.getElementById('uaWaitlistBadge');
    if (badge) {
      badge.textContent   = count || 0;
      badge.style.display = (count || 0) > 0 ? 'inline-block' : 'none';
    }
  } catch(e) { console.debug('[waitlist badge]', e.message); }
}

async function loadWaitlist() {
  const el      = document.getElementById('uaWaitlistContent');
  const countEl = document.getElementById('uaWaitlistCount');
  if (!el) return;

  el.innerHTML = '<div style="text-align:center;padding:28px;color:var(--muted)">⏳ Carregando…</div>';

  const filter = document.getElementById('uaWlFilter')?.value || 'pending';

  try {
    let query = sb.from('waitlist')
      .select('*')
      .order('created_at', { ascending: true });

    if (filter === 'pending') query = query.eq('status', 'pending');
    else if (filter === 'invited') query = query.eq('status', 'invited');

    const { data, error } = await query;
    if (error) throw error;

    const rows = data || [];
    if (countEl) countEl.textContent = rows.length + ' registro(s)';
    _updateWaitlistBadge();

    if (!rows.length) {
      el.innerHTML = `
        <div style="text-align:center;padding:40px 20px">
          <div style="font-size:2.2rem;margin-bottom:12px">📋</div>
          <div style="font-size:.9rem;font-weight:600;color:var(--text)">Lista vazia</div>
          <div style="font-size:.78rem;color:var(--muted);margin-top:4px">
            ${filter === 'pending' ? 'Nenhum cadastro aguardando convite.' : 'Nenhum registro neste filtro.'}
          </div>
        </div>`;
      return;
    }

    el.innerHTML = rows.map(r => {
      const date     = r.created_at ? new Date(r.created_at).toLocaleDateString('pt-BR') : '—';
      const roleLabel = {family:'Família',couple:'Casal',personal:'Individual',business:'Empreendedor',curious:'Curioso IA'}[r.role] || r.role || '—';
      const initials  = (r.name||'?').trim().split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
      const isPending = r.status === 'pending';
      const isInvited = r.status === 'invited';
      const statusPill = isPending
        ? '<span style="font-size:.62rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;background:rgba(245,158,11,.12);color:#b45309;border:1px solid rgba(245,158,11,.25);border-radius:100px;padding:2px 8px">⏳ Aguardando</span>'
        : '<span style="font-size:.62rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;background:rgba(42,96,73,.1);color:var(--accent);border:1px solid rgba(42,96,73,.2);border-radius:100px;padding:2px 8px">✉️ Convidado</span>';

      const invBtn = isPending ? `
        <button
          data-id="${esc(r.id)}" data-name="${esc(r.name||'')}" data-email="${esc(r.email||'')}"
          onclick="inviteFromWaitlist(this.dataset.id, this.dataset.name, this.dataset.email)"
          style="font-family:var(--font-sans);font-size:.72rem;font-weight:700;color:#fff;background:var(--accent);border:none;border-radius:8px;padding:6px 14px;cursor:pointer;white-space:nowrap;transition:all .2s"
          onmouseover="this.style.background='var(--accent2)'" onmouseout="this.style.background='var(--accent)'">
          ✉️ Convidar
        </button>` : `
        <button
          data-id="${esc(r.id)}" data-name="${esc(r.name||'')}" data-email="${esc(r.email||'')}"
          onclick="inviteFromWaitlist(this.dataset.id, this.dataset.name, this.dataset.email)"
          title="Reenviar convite"
          style="font-family:var(--font-sans);font-size:.72rem;font-weight:600;color:var(--muted);background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:6px 12px;cursor:pointer;white-space:nowrap;transition:all .2s">
          ↩ Reenviar
        </button>`;

      const removeBtn = `
        <button
          data-id="${esc(r.id)}" data-name="${esc(r.name||r.email||'')}"
          onclick="removeFromWaitlist(this.dataset.id, this.dataset.name)"
          title="Remover da lista"
          style="font-family:var(--font-sans);font-size:.72rem;color:var(--muted);background:transparent;border:1px solid var(--border);border-radius:8px;padding:6px 8px;cursor:pointer;transition:all .2s"
          onmouseover="this.style.color='var(--danger)';this.style.borderColor='var(--danger)'"
          onmouseout="this.style.color='var(--muted)';this.style.borderColor='var(--border)'">
          ✕
        </button>`;

      return `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="width:36px;height:36px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.75rem;color:#fff;flex-shrink:0">${initials}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:.84rem;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.name||'—')}</div>
            <div style="font-size:.72rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.email||'')}</div>
            <div style="display:flex;align-items:center;gap:6px;margin-top:3px;flex-wrap:wrap">
              ${statusPill}
              <span style="font-size:.65rem;color:var(--muted2)">${roleLabel}</span>
              <span style="font-size:.65rem;color:var(--muted2)">${date}</span>
              ${r.whatsapp ? `<span style="font-size:.65rem;color:var(--muted2)">📱 ${esc(r.whatsapp)}</span>` : ''}
            </div>
          </div>
          <div style="display:flex;gap:5px;flex-shrink:0">
            ${invBtn}
            ${removeBtn}
          </div>
        </div>`;
    }).join('');

  } catch(e) {
    el.innerHTML = `<div style="color:var(--danger);font-size:.82rem;padding:16px">Erro: ${e.message}</div>`;
  }
}
window.loadWaitlist = loadWaitlist;

async function inviteFromWaitlist(wlId, name, email) {
  if (!wlId || !email) { toast('Dados inválidos', 'error'); return; }

  // Verificar se já é usuário
  const { data: existing } = await sb.from('app_users').select('id').eq('email', email).maybeSingle();
  if (existing) {
    toast(`${name || email} já é um usuário do sistema.`, 'warning');
    return;
  }

  // Abrir modal de confirmação/envio de convite
  _openWaitlistInviteModal(wlId, name, email);
}
window.inviteFromWaitlist = inviteFromWaitlist;

async function removeFromWaitlist(wlId, name) {
  if (!confirm(`Remover "${name}" da lista de espera?`)) return;
  try {
    const { error } = await sb.from('waitlist').delete().eq('id', wlId);
    if (error) throw error;
    toast(`✓ ${name} removido da lista de espera.`, 'success');
    loadWaitlist();
  } catch(e) {
    toast('Erro ao remover: ' + e.message, 'error');
  }
}
window.removeFromWaitlist = removeFromWaitlist;

// ── Modal de convite oficial ─────────────────────────────────────────────────
function _openWaitlistInviteModal(wlId, name, email) {
  let m = document.getElementById('wlInviteModal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'wlInviteModal';
    m.className = 'modal-overlay';
    m.innerHTML = `
      <div class="modal" style="max-width:480px">
        <div class="modal-header">
          <span class="modal-title">✉️ Enviar Convite Oficial</span>
          <button class="modal-close" onclick="closeModal('wlInviteModal')">✕</button>
        </div>
        <div style="padding:20px;display:flex;flex-direction:column;gap:14px">
          <div id="wlInvRecipient" style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--r-sm);padding:12px 14px;font-size:.84rem"></div>
          <div class="form-group">
            <label style="font-size:.72rem;font-weight:600;color:var(--text2)">Mensagem de boas-vindas</label>
            <textarea id="wlInvMsg" rows="5" style="width:100%;font-family:var(--font-sans);font-size:.84rem;resize:vertical;padding:10px;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--surface)"></textarea>
          </div>
          <div style="background:var(--accent-lt,var(--bg2));border:1px solid var(--border-green,var(--border));border-radius:var(--r-sm);padding:10px 14px;font-size:.76rem;color:var(--text2)">
            💡 O email conterá um link para o aplicativo e orientações de como se cadastrar como usuário.
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="btn btn-ghost" onclick="closeModal('wlInviteModal')">Cancelar</button>
            <button class="btn btn-primary" id="wlInvSendBtn" onclick="_sendOfficialInvite()">
              ✉️ Enviar Convite
            </button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(m);
  }

  // Preencher dados
  const fn = (name||'').split(' ')[0] || 'Olá';
  document.getElementById('wlInvRecipient').innerHTML =
    `<strong>${esc(name||'—')}</strong><br><span style="color:var(--muted);font-size:.78rem">${esc(email)}</span>`;
  document.getElementById('wlInvMsg').value =
    `Olá, ${fn}!\n\nSua vez chegou! 🎉 Você está sendo convidado(a) para acessar o Family FinTrack — o app de gestão financeira familiar com Inteligência Artificial.\n\nClique no link abaixo para se cadastrar e começar a usar:\n${location.origin}/app.html\n\nSeu acesso é gratuito durante o período beta.\n\nBem-vindo(a) à família!\n\nEquipe Family FinTrack`;

  // Guardar dados no modal para uso no envio
  m.dataset.wlId  = wlId;
  m.dataset.name  = name;
  m.dataset.email = email;

  openModal('wlInviteModal');
}

async function _sendOfficialInvite() {
  const m     = document.getElementById('wlInviteModal');
  const wlId  = m?.dataset.wlId;
  const name  = m?.dataset.name  || '';
  const email = m?.dataset.email || '';
  const msg   = document.getElementById('wlInvMsg')?.value?.trim() || '';
  const btn   = document.getElementById('wlInvSendBtn');

  if (!email || !msg) { toast('Preencha a mensagem', 'error'); return; }

  btn.disabled   = true;
  btn.textContent = '⏳ Enviando…';

  try {
    // 1. Enviar email via EmailJS
    if (EMAILJS_CONFIG.serviceId && EMAILJS_CONFIG.templateId && EMAILJS_CONFIG.publicKey) {
      const fn   = name.split(' ')[0] || 'Olá';
      const body = _buildOfficialInviteEmail(fn, email, msg);
      await emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, {
        to_email:       email,
        report_subject: '[Family FinTrack] 🎉 Seu convite chegou! Acesso liberado.',
        Subject:        '[Family FinTrack] Seu acesso ao Family FinTrack foi liberado!',
        month_year:     new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
        report_content: body,
      });
    } else {
      throw new Error('EmailJS não configurado. Configure em Configurações → Email.');
    }

    // 2. Marcar como 'invited' na lista de espera
    await sb.from('waitlist').update({
      status:     'invited',
      updated_at: new Date().toISOString(),
    }).eq('id', wlId);

    toast(`✅ Convite enviado para ${name || email}!`, 'success');
    closeModal('wlInviteModal');
    loadWaitlist();

  } catch(e) {
    toast('Erro ao enviar convite: ' + e.message, 'error');
    btn.disabled   = false;
    btn.textContent = '✉️ Enviar Convite';
  }
}
window._sendOfficialInvite = _sendOfficialInvite;

function _buildOfficialInviteEmail(firstName, email, personalMsg) {
  const safeMsg  = personalMsg.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
  const appUrl   = location.origin + '/app.html';
  const landUrl  = location.origin;

  return `
<div style="font-family:'Plus Jakarta Sans',Arial,sans-serif;background:#0a1e12;padding:0;margin:0">
<div style="max-width:580px;margin:0 auto">

  <div style="background:linear-gradient(160deg,#0a1e12 0%,#1a3d27 50%,#235234 100%);padding:52px 40px 44px;text-align:center;border-bottom:2px solid rgba(125,194,66,.3)">
    <div style="font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,.3);margin-bottom:14px;font-weight:700">Family FinTrack · Acesso Beta</div>
    <div style="width:80px;height:80px;background:linear-gradient(135deg,#2d6a44,#7dc242);border-radius:22px;display:inline-flex;align-items:center;justify-content:center;font-size:2.5rem;margin-bottom:20px;box-shadow:0 10px 40px rgba(125,194,66,.3)">🎉</div>
    <h1 style="font-family:Georgia,serif;font-size:30px;font-weight:700;color:#fff;margin:0;line-height:1.2">Seu acesso foi liberado!</h1>
    <div style="width:56px;height:3px;background:linear-gradient(90deg,#7dc242,#9ed45f);border-radius:100px;margin:22px auto 0"></div>
  </div>

  <div style="background:#122a1a;padding:42px 40px">
    <p style="font-family:Georgia,serif;font-size:17px;color:rgba(255,255,255,.88);margin:0 0 24px;line-height:1.65">
      Olá, <strong style="color:#9ed45f">${firstName}</strong>! 👋
    </p>

    <div style="background:rgba(125,194,66,.07);border-left:3px solid #7dc242;border-radius:0 14px 14px 0;padding:20px 22px;margin-bottom:28px;font-size:14px;color:rgba(255,255,255,.7);line-height:1.8;font-style:italic">
      ${safeMsg}
    </div>

    <div style="background:linear-gradient(135deg,#0a1e12,#1a3d27);border:1px solid rgba(125,194,66,.25);border-radius:18px;padding:28px;text-align:center;margin-bottom:28px">
      <div style="font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.28);margin-bottom:12px;font-weight:700">Sua situação</div>
      <div style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#7dc242;margin-bottom:8px">✅ Acesso Liberado</div>
      <div style="font-size:12px;color:rgba(255,255,255,.35)">Gratuito durante o período beta exclusivo</div>
    </div>

    <div style="text-align:center;margin-bottom:28px">
      <a href="${appUrl}" style="display:inline-block;font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:16px;font-weight:800;color:#0a1e12;background:linear-gradient(135deg,#7dc242,#9ed45f);border-radius:14px;padding:16px 44px;text-decoration:none;box-shadow:0 6px 28px rgba(125,194,66,.35)">
        Acessar o Family FinTrack →
      </a>
      <div style="font-size:11px;color:rgba(255,255,255,.25);margin-top:12px">${appUrl}</div>
    </div>

    <div style="border-top:1px solid rgba(125,194,66,.12);padding-top:22px">
      <div style="font-size:12px;color:rgba(255,255,255,.4);margin-bottom:14px;font-weight:600">Com o Family FinTrack você tem:</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
        ${[
          ['🤖','IA Financeira','Análise inteligente com Gemini AI, insights e previsões'],
          ['👨‍👩‍👧‍👦','Gestão familiar','Toda a família conectada com perfis individuais'],
          ['📅','Automação','Contas programadas com alertas no Telegram e WhatsApp'],
          ['🔮','Visão do futuro','Previsão de fluxo de caixa para 90 dias'],
        ].map(([ic,t,d])=>`<tr><td style="padding:8px 0;border-bottom:1px solid rgba(125,194,66,.08);vertical-align:top;width:30px;font-size:1.1rem">${ic}</td><td style="padding:8px 8px 8px 6px;border-bottom:1px solid rgba(125,194,66,.08)"><div style="font-size:12px;font-weight:700;color:rgba(255,255,255,.75);margin-bottom:1px">${t}</div><div style="font-size:11px;color:rgba(255,255,255,.38)">${d}</div></td></tr>`).join('')}
      </table>
    </div>
  </div>

  <div style="padding:22px 40px;text-align:center;background:#0a1e12;border-top:1px solid rgba(125,194,66,.1)">
    <div style="font-size:11px;color:rgba(255,255,255,.2);line-height:1.85">
      Family FinTrack · Beta Privado 2025<br>
      Família Inteligente, Finanças sob Controle<br>
      <span style="opacity:.6">Potencializado por Inteligência Artificial</span>
    </div>
  </div>
</div></div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// NOTIFICAÇÃO DE LOGIN — lista de espera + aprovações pendentes (admin)
// ══════════════════════════════════════════════════════════════════════════════

let _wlLastNotifiedCount = -1; // para evitar notificar na mesma sessão

async function _checkWaitlistOnLogin() {
  if (!currentUser?.can_admin || !sb) return;

  try {
    const { count } = await sb
      .from('waitlist')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    const n = count || 0;
    if (n === 0 || n === _wlLastNotifiedCount) return;
    _wlLastNotifiedCount = n;

    // Mostrar popup combinado se também houver aprovações pendentes
    _showAdminLoginNotification(n);
  } catch(e) {
    console.debug('[waitlist login check]', e.message);
  }
}


// ── Notification dismiss helpers ─────────────────────────────────────────────
function _dismissNotifToday(key) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    localStorage.setItem('notif_dismiss_' + key, today);
  } catch(_) {}
}
function _isNotifDismissedToday(key) {
  try {
    const stored = localStorage.getItem('notif_dismiss_' + key);
    return stored === new Date().toISOString().slice(0, 10);
  } catch(_) { return false; }
}
window._dismissNotifToday    = _dismissNotifToday;
window._isNotifDismissedToday = _isNotifDismissedToday;
function _showAdminLoginNotification(waitlistCount) {
  document.getElementById('adminLoginNotifPopup')?.remove();

  const popup = document.createElement('div');
  popup.id = 'adminLoginNotifPopup';
  popup.style.cssText = 'position:fixed;bottom:80px;right:16px;z-index:99998;max-width:300px;width:calc(100vw - 32px);background:var(--surface);border:1.5px solid var(--accent);border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.18);overflow:hidden;animation:slideUpFadeIn .3s ease';

  popup.innerHTML = `
    <div style="background:linear-gradient(135deg,#1e5c42,#2a6049);padding:12px 14px;display:flex;align-items:center;gap:10px">
      <span style="font-size:1.2rem">📋</span>
      <div style="flex:1;min-width:0">
        <div style="color:#fff;font-size:.82rem;font-weight:800;line-height:1.2">Atenção Admin</div>
      </div>
      <button onclick="document.getElementById('adminLoginNotifPopup')?.remove()"
        style="background:rgba(255,255,255,.18);border:none;color:#fff;width:22px;height:22px;border-radius:50%;cursor:pointer;font-size:.8rem;flex-shrink:0">✕</button>
    </div>
    <div style="padding:12px 14px;display:flex;flex-direction:column;gap:8px;font-size:.82rem">
      ${waitlistCount > 0 ? `<div style="display:flex;align-items:center;gap:8px;color:var(--text)">
        <span style="width:8px;height:8px;background:#f59e0b;border-radius:50%;flex-shrink:0;box-shadow:0 0 6px #f59e0b"></span>
        <span><strong>${waitlistCount}</strong> pessoa(s) na lista de espera aguardando convite</span>
      </div>` : ''}
      <div style="display:flex;gap:7px;margin-top:4px">
        <button onclick="document.getElementById('adminLoginNotifPopup')?.remove();navigate('settings');setTimeout(()=>{openUserAdmin();setTimeout(()=>{switchUATab('waitlist')},300)},400)"
          style="flex:1;padding:7px;border-radius:9px;border:1.5px solid var(--accent);background:var(--accent-lt,#e8f2ee);color:var(--accent);font-size:.75rem;font-weight:700;cursor:pointer;font-family:var(--font-sans)">
          Ver lista de espera
        </button>
        <button onclick="_dismissNotifToday('adminLoginNotif');document.getElementById('adminLoginNotifPopup')?.remove()"
          style="padding:7px 10px;border-radius:9px;border:1.5px solid var(--border);background:transparent;color:var(--muted);font-size:.75rem;font-weight:600;cursor:pointer;font-family:var(--font-sans);flex-shrink:0"
          title="Não mostrar hoje">
          Não hoje
        </button>
      </div>
    </div>`;

  document.body.appendChild(popup);
  // Auto-dismiss after 12s
  setTimeout(() => popup?.remove(), 12000);
}

// ══════════════════════════════════════════════════════════════════════════════
// NOTIFICAÇÕES DE LOGIN — Transações do dia + Saúde financeira
// ══════════════════════════════════════════════════════════════════════════════

async function _showUserLoginNotifications() {
  if (!currentUser || !sb) return;

  // Ensure animation keyframes exist (admin popup may not have run)
  if (!document.getElementById('_userNotifStyles')) {
    const s = document.createElement('style');
    s.id = '_userNotifStyles';
    s.textContent = '@keyframes slideUpFadeIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}';
    document.head.appendChild(s);
  }

  // Collect both notification sources in parallel
  const [todayItems, healthData] = await Promise.all([
    _getScheduledForToday(),
    _getFinancialHealthSnapshot(),
  ]);

  // Nothing to show — silent exit
  if (!todayItems.length && !healthData.alert) return;

  // Show notifications with slight cascade
  if (todayItems.length) {
    _showScheduledTodayNotif(todayItems);
  }

  if (healthData.alert) {
    const delay = todayItems.length ? 600 : 0;
    setTimeout(() => _showFinancialHealthNotif(healthData), delay);
  }
}
window._showUserLoginNotifications = _showUserLoginNotifications;

/* ── Collect today's scheduled transactions ──────────────────────────────── */
async function _getScheduledForToday() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const scheduled = state?.scheduled || [];
    if (!scheduled.length) return [];

    const todayItems = [];
    scheduled.forEach(sc => {
      if (sc.status === 'paused' || sc.status === 'finished') return;
      // Check generated occurrences
      if (typeof generateOccurrences === 'function') {
        // Use limit=60 to catch mid-sequence occurrences (e.g. monthly on day 15)
        const occs = generateOccurrences(sc, 60);
        if (occs.includes(today)) {
          // Check if not already executed today
          const alreadyDone = (sc.occurrences || []).some(
            o => o.scheduled_date === today &&
                 (o.execution_status === 'executed' || o.execution_status === 'processing')
          );
          if (!alreadyDone) {
            todayItems.push({
              desc:    sc.description || '—',
              amount:  sc.amount || 0,
              type:    sc.type || 'expense',
              account: sc.accounts?.name || '',
            });
          }
        }
      }
      // Also include explicit pending occurrences for today
      (sc.occurrences || []).forEach(o => {
        if (o.scheduled_date === today &&
            (o.execution_status === 'pending' || o.execution_status === 'skipped')) {
          // Avoid duplicate if already added via generateOccurrences
          if (!todayItems.find(i => i.desc === sc.description)) {
            todayItems.push({
              desc:    sc.description || '—',
              amount:  sc.amount || 0,
              type:    sc.type || 'expense',
              account: sc.accounts?.name || '',
            });
          }
        }
      });
    });
    return todayItems;
  } catch(e) {
    console.debug('[user notif] scheduled:', e.message);
    return [];
  }
}

/* ── Financial health snapshot ───────────────────────────────────────────── */
async function _getFinancialHealthSnapshot() {
  try {
    const accs = state?.accounts || [];
    if (!accs.length) return { alert: false };

    // Total liquid balance (exclude credit cards)
    const totalBRL = accs
      .filter(a => a.type !== 'cartao_credito')
      .reduce((s, a) => s + (typeof toBRL === 'function' ? toBRL(+(a.balance||0), a.currency||'BRL') : +(a.balance||0)), 0);

    // Negative accounts
    const negAccs = accs.filter(a => a.type !== 'cartao_credito' && +(a.balance||0) < 0);

    // Upcoming 10 days — net cash flow
    const today = new Date().toISOString().slice(0, 10);
    const limit = new Date(); limit.setDate(limit.getDate() + 10);
    const limitStr = limit.toISOString().slice(0, 10);

    let upcomingNet = 0;
    (state?.scheduled || []).forEach(sc => {
      if (sc.status === 'paused' || sc.status === 'finished') return;
      if (typeof generateOccurrences === 'function') {
        generateOccurrences(sc, 15).forEach(date => {
          if (date >= today && date <= limitStr) {
            const isExp = sc.type === 'expense' || sc.type === 'card_payment' || sc.type === 'transfer';
            upcomingNet += isExp ? -Math.abs(sc.amount || 0) : Math.abs(sc.amount || 0);
          }
        });
      }
    });

    // Credit card balance (debt)
    const creditCardDebt = accs
      .filter(a => a.type === 'cartao_credito')
      .reduce((s, a) => s + Math.abs(+(a.balance||0) < 0 ? +(a.balance||0) : 0), 0);

    // Determine alert level
    let alert = false;
    let level = 'info'; // 'warning' | 'danger' | 'info'
    let title = '';
    let messages = [];
    let icon = '💰';
    let color = 'var(--accent)';

    if (totalBRL < 0) {
      alert = true; level = 'danger';
      icon = '🚨'; color = 'var(--danger,#dc2626)';
      title = 'Saldo total negativo';
      messages.push(`Saldo líquido: <strong style="color:var(--danger,#dc2626)">${typeof fmt === 'function' ? fmt(totalBRL) : totalBRL.toFixed(2)}</strong>`);
    } else if (negAccs.length) {
      alert = true; level = 'warning';
      icon = '⚠️'; color = 'var(--amber,#f59e0b)';
      title = negAccs.length === 1 ? '1 conta com saldo negativo' : `${negAccs.length} contas com saldo negativo`;
      messages.push(negAccs.slice(0,2).map(a => `${a.name}: <strong>${typeof fmt==='function'?fmt(a.balance,a.currency):a.balance}</strong>`).join(' · '));
    } else if (upcomingNet < -1000) {
      alert = true; level = 'warning';
      icon = '📅'; color = 'var(--amber,#f59e0b)';
      title = 'Atenção com os próximos 10 dias';
      messages.push(`Saldo projetado: <strong>${typeof fmt==='function'?fmt(upcomingNet):'R$ '+upcomingNet.toFixed(2)}</strong> nos próximos 10 dias`);
    }

    if (creditCardDebt > 500 && level !== 'danger') {
      if (!alert) { alert = true; level = 'info'; icon = '💳'; color = 'var(--accent)'; title = 'Fatura de cartão em aberto'; }
      messages.push(`Cartões de crédito: <strong>${typeof fmt==='function'?fmt(creditCardDebt):'R$ '+creditCardDebt.toFixed(2)}</strong> em aberto`);
    }

    // All good?
    if (!alert && totalBRL > 0 && upcomingNet >= 0) {
      // Show positive health only occasionally (not every login — check last shown date)
      const lastShown = localStorage.getItem('_healthNotifDate');
      const today2 = new Date().toISOString().slice(0, 10);
      if (lastShown !== today2) {
        alert = true; level = 'good';
        icon = '✅'; color = 'var(--accent)';
        title = 'Saúde financeira estável';
        messages.push(`Saldo líquido: <strong style="color:var(--accent)">${typeof fmt==='function'?fmt(totalBRL):'R$ '+totalBRL.toFixed(2)}</strong>`);
        if (upcomingNet > 0) messages.push(`Próximos 10 dias: <strong>+${typeof fmt==='function'?fmt(upcomingNet):'R$ '+upcomingNet.toFixed(2)}</strong> projetado`);
        localStorage.setItem('_healthNotifDate', today2);
      }
    }

    return { alert, level, icon, color, title, messages, totalBRL, upcomingNet };
  } catch(e) {
    console.debug('[user notif] health:', e.message);
    return { alert: false };
  }
}

/* ── Popup: Transações do dia ────────────────────────────────────────────── */
function _showScheduledTodayNotif(items) {
  document.getElementById('userScheduledTodayPopup')?.remove();

  const fn = (currentUser?.name || '').split(' ')[0];
  const total = items.reduce((s, it) => {
    const isExp = it.type === 'expense' || it.type === 'card_payment' || it.type === 'transfer';
    return s + (isExp ? -Math.abs(it.amount) : Math.abs(it.amount));
  }, 0);
  const totalStr = typeof fmt === 'function' ? fmt(Math.abs(total)) : Math.abs(total).toFixed(2);
  const totalColor = total >= 0 ? 'var(--accent)' : 'var(--danger,#dc2626)';

  const popup = document.createElement('div');
  popup.id = 'userScheduledTodayPopup';
  popup.style.cssText = 'position:fixed;bottom:80px;right:16px;z-index:99997;max-width:320px;width:calc(100vw - 32px);background:var(--surface);border:1.5px solid var(--accent);border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.18);overflow:hidden;animation:slideUpFadeIn .35s ease';

  const itemRows = items.slice(0, 4).map(it => {
    const isExp = it.type === 'expense' || it.type === 'card_payment' || it.type === 'transfer';
    const typeIcon = it.type === 'transfer' ? '🔄' : isExp ? '💸' : '💰';
    const amtStr   = typeof fmt === 'function' ? fmt(Math.abs(it.amount)) : Math.abs(it.amount).toFixed(2);
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:.95rem;flex-shrink:0">${typeIcon}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:.8rem;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.desc)}</div>
        ${it.account ? `<div style="font-size:.68rem;color:var(--muted)">${esc(it.account)}</div>` : ''}
      </div>
      <span style="font-size:.8rem;font-weight:700;color:${isExp?'var(--danger,#dc2626)':'var(--accent)'};flex-shrink:0">${isExp?'−':'+'}${amtStr}</span>
    </div>`;
  }).join('');

  const moreNote = items.length > 4
    ? `<div style="font-size:.7rem;color:var(--muted);text-align:center;padding:4px 0">+${items.length - 4} mais hoje</div>`
    : '';

  popup.innerHTML = `
    <div style="background:linear-gradient(135deg,var(--accent),var(--accent2,#3d7a5e));padding:12px 14px;display:flex;align-items:center;gap:10px">
      <span style="font-size:1.25rem">📅</span>
      <div style="flex:1;min-width:0">
        <div style="color:#fff;font-size:.82rem;font-weight:800;line-height:1.2">
          ${fn ? `${fn}, hoje ` : 'Hoje '}você tem ${items.length} transação${items.length > 1 ? 'ões' : ''} programada${items.length > 1 ? 's' : ''}
        </div>
        <div style="color:rgba(255,255,255,.7);font-size:.7rem;margin-top:2px">
          Saldo do dia: <span style="color:#fff;font-weight:700">${total >= 0 ? '+' : '−'}${totalStr}</span>
        </div>
      </div>
      <button onclick="document.getElementById('userScheduledTodayPopup')?.remove()"
        style="background:rgba(255,255,255,.2);border:none;color:#fff;width:24px;height:24px;border-radius:50%;cursor:pointer;font-size:.85rem;flex-shrink:0;display:flex;align-items:center;justify-content:center">✕</button>
    </div>
    <div style="padding:10px 14px 4px">
      ${itemRows}
      ${moreNote}
    </div>
    <div style="padding:8px 14px 12px;display:flex;gap:7px">
      <button onclick="document.getElementById('userScheduledTodayPopup')?.remove();navigate('scheduled')"
        style="flex:1;padding:8px;border-radius:9px;border:1.5px solid var(--accent);background:var(--accent-lt,#e8f2ee);color:var(--accent);font-size:.76rem;font-weight:700;cursor:pointer;font-family:var(--font-sans)">
        Ver programados →
      </button>
    </div>`;

  document.body.appendChild(popup);
  setTimeout(() => popup?.remove(), 20000);
}

/* ── Popup: Saúde financeira ─────────────────────────────────────────────── */
function _showFinancialHealthNotif(data) {
  document.getElementById('userFinancialHealthPopup')?.remove();

  const popup = document.createElement('div');
  popup.id = 'userFinancialHealthPopup';
  const borderColor = data.level === 'danger' ? 'var(--danger,#dc2626)' : data.level === 'warning' ? 'var(--amber,#f59e0b)' : data.level === 'good' ? 'var(--accent)' : 'var(--border)';
  const headerBg   = data.level === 'danger' ? 'linear-gradient(135deg,#b91c1c,#dc2626)' : data.level === 'warning' ? 'linear-gradient(135deg,#b45309,#d97706)' : 'linear-gradient(135deg,var(--accent),var(--accent2,#3d7a5e))';

  popup.style.cssText = `position:fixed;bottom:80px;left:16px;z-index:99996;max-width:300px;width:calc(100vw - 32px);background:var(--surface);border:1.5px solid ${borderColor};border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.18);overflow:hidden;animation:slideUpFadeIn .35s .1s ease both`;

  const _hFn = (currentUser?.name || '').split(' ')[0];
  const _subtitle = data.level === 'good'
    ? (_hFn ? `Tudo certo, ${_hFn}! ` : '') + 'Finanças em dia.'
    : data.level === 'danger' ? 'Atenção necessária imediatamente'
    : data.level === 'warning' ? 'Fique de olho'
    : 'Resumo financeiro';

  popup.innerHTML = `
    <div style="background:${headerBg};padding:12px 14px;display:flex;align-items:center;gap:10px">
      <span style="font-size:1.3rem">${data.icon}</span>
      <div style="flex:1;min-width:0">
        <div style="color:#fff;font-size:.82rem;font-weight:800;line-height:1.2">${data.title}</div>
        <div style="color:rgba(255,255,255,.7);font-size:.68rem;margin-top:1px">${_subtitle}</div>
      </div>
      <button onclick="document.getElementById('userFinancialHealthPopup')?.remove()"
        style="background:rgba(255,255,255,.2);border:none;color:#fff;width:24px;height:24px;border-radius:50%;cursor:pointer;font-size:.85rem;flex-shrink:0;display:flex;align-items:center;justify-content:center">✕</button>
    </div>
    <div style="padding:12px 14px;display:flex;flex-direction:column;gap:6px">
      ${data.messages.map(m => `<div style="font-size:.8rem;color:var(--text2);line-height:1.55">${m}</div>`).join('')}
    </div>
    <div style="padding:0 14px 12px;display:flex;gap:7px">
      ${(data.level === 'danger' || data.level === 'warning') ? `
      <button onclick="document.getElementById('userFinancialHealthPopup')?.remove();navigate('accounts')"
        style="flex:1;padding:8px;border-radius:9px;border:1.5px solid ${borderColor};background:transparent;color:var(--text2);font-size:.75rem;font-weight:700;cursor:pointer;font-family:var(--font-sans)">
        Ver contas →
      </button>` : ''}
      <button onclick="document.getElementById('userFinancialHealthPopup')?.remove();navigate('dashboard')"
        style="flex:1;padding:8px;border-radius:9px;border:1.5px solid ${borderColor};background:var(--accent-lt,rgba(42,96,73,.08));color:var(--accent);font-size:.75rem;font-weight:700;cursor:pointer;font-family:var(--font-sans)">
        Ver dashboard →
      </button>
    </div>`;

  document.body.appendChild(popup);
  setTimeout(() => popup?.remove(), data.level === 'danger' ? 30000 : 15000);
}
