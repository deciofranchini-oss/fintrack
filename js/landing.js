/* ═══════════════════════════════════════════════════════════════
   Family FinTrack — Landing Page JS
   Lista de espera · Convites por email · Redação com Gemini IA
═══════════════════════════════════════════════════════════════ */

const SUPA_URL = 'https://wkiytjwuztnytygpxooe.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndraXl0and1enRueXR5Z3B4b29lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyODc3NzUsImV4cCI6MjA4Nzg2Mzc3NX0.Z3fyYRDobzarCEdqkobTjQQd1J9HAUR2CCdnBbLC0QA';
const _sb  = supabase.createClient(SUPA_URL, SUPA_KEY);
const _ej  = { serviceId:'', templateId:'', publicKey:'' };
let   _geminiKey = '';
let   _senderName  = '';
let   _senderEmail = '';

const _dateUtils = window.FinTrackDateUtils || {
  getUserLocale: () => document?.documentElement?.lang || navigator.language || 'pt-BR',
  formatMonthYear: (dateInput = new Date(), options = {}) => new Intl.DateTimeFormat(
    document?.documentElement?.lang || navigator.language || 'pt-BR',
    { month:'long', year:'numeric', ...options }
  ).format(dateInput instanceof Date ? dateInput : new Date(dateInput)),
};

/* ── Landing Telemetry ──────────────────────────────────────────── */
const _lTelSession = Math.random().toString(36).slice(2,10);
const _lTelPageStart = Date.now();

function _lTelGetUtm() {
  const p = new URLSearchParams(location.search);
  const utm = {};
  ['utm_source','utm_medium','utm_campaign','utm_term','utm_content'].forEach(k => {
    if (p.get(k)) utm[k] = p.get(k);
  });
  return Object.keys(utm).length ? utm : undefined;
}

function _lTelTrack(event_type, payload = {}) {
  try {
    const utm = _lTelGetUtm();
    const row = {
      id:             'lnd_' + Date.now().toString(36) + Math.random().toString(36).slice(2,6),
      session_id:     _lTelSession,
      event_type,
      page:           'landing',
      ts:             new Date().toISOString(),
      device_type:    /Mobile|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
      device_browser: (navigator.userAgent.match(/(Chrome|Firefox|Safari|Edge|Opera)/i)||['unknown'])[0],
      device_os:      /Win/i.test(navigator.userAgent) ? 'windows' : /Mac/i.test(navigator.userAgent) ? 'macos' : /Android/i.test(navigator.userAgent) ? 'android' : /iPhone|iPad/i.test(navigator.userAgent) ? 'ios' : 'other',
      screen_w:       screen.width  || null,
      screen_h:       screen.height || null,
      is_pwa:         window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
      lang:           navigator.language || document.documentElement.lang || null,
      payload: {
        source:   'landing',
        url:      location.href,
        viewport: window.innerWidth + 'x' + window.innerHeight,
        ...(utm && { utm }),
        ...payload,
      },
    };
    _sb.from('app_telemetry').insert(row).then(() => {}).catch(() => {});
  } catch(_) {}
}

// Track page load immediately
_lTelTrack('page_view', { referrer: document.referrer || null });

// Track scroll depth milestones
let _telScrolled25 = false, _telScrolled50 = false, _telScrolled75 = false, _telScrolled100 = false;
window.addEventListener('scroll', () => {
  const pct = Math.min(100, (window.scrollY / Math.max(1, document.body.scrollHeight - window.innerHeight)) * 100);
  if (!_telScrolled25  && pct >= 25)  { _telScrolled25  = true; _lTelTrack('scroll_depth', { depth: 25 }); }
  if (!_telScrolled50  && pct >= 50)  { _telScrolled50  = true; _lTelTrack('scroll_depth', { depth: 50 }); }
  if (!_telScrolled75  && pct >= 75)  { _telScrolled75  = true; _lTelTrack('scroll_depth', { depth: 75 }); }
  if (!_telScrolled100 && pct >= 99)  { _telScrolled100 = true; _lTelTrack('scroll_depth', { depth: 100 }); }
}, { passive: true });

// Track time on page at unload
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    _lTelTrack('page_exit', { time_on_page_sec: Math.round((Date.now() - _lTelPageStart) / 1000) });
  }
});

// Track CTA clicks
document.addEventListener('DOMContentLoaded', () => {
  // Nav links
  document.querySelectorAll('a.nk').forEach(a => {
    a.addEventListener('click', () => _lTelTrack('cta_click', { element: 'nav_link', target: a.getAttribute('href') }));
  });
  // Hero / section CTA buttons
  document.querySelectorAll('a.ctp').forEach(a => {
    a.addEventListener('click', () => _lTelTrack('cta_click', { element: 'hero_cta', target: a.getAttribute('href') }));
  });
  // Waitlist form: track first field focus (intent signal)
  let _wlIntentTracked = false;
  document.querySelectorAll('#wlN,#wlE,#wlP,#wlR').forEach(el => {
    el.addEventListener('focus', () => {
      if (!_wlIntentTracked) { _wlIntentTracked = true; _lTelTrack('waitlist_intent', {}); }
    }, { once: true });
  });
  // Role select change
  const wlR = document.getElementById('wlR');
  if (wlR) wlR.addEventListener('change', () => _lTelTrack('waitlist_role_select', { role: wlR.value }));
});

/* ── Carrega EmailJS + Gemini key do Supabase ──────────────────── */
(async () => {
  try {
    const { data } = await _sb
      .from('app_settings')
      .select('key,value')
      .in('key', ['ej_service','ej_template','ej_sched_template','ej_key','gemini_api_key']);
    if (data) {
      data.forEach(r => {
        if (r.key === 'ej_service')                              _ej.serviceId  = String(r.value||'');
        if (r.key === 'ej_template' && !_ej.templateId)         _ej.templateId = String(r.value||'');
        if (r.key === 'ej_sched_template' && !_ej.templateId)   _ej.templateId = String(r.value||'');
        if (r.key === 'ej_key')                                  _ej.publicKey  = String(r.value||'');
        if (r.key === 'gemini_api_key')                          _geminiKey     = String(r.value||'');
      });
      if (_ej.publicKey) emailjs.init(_ej.publicKey);
    }
  } catch(e) { console.debug('[landing] config load:', e.message); }
})();

/* ── Partículas canvas ─────────────────────────────────────────── */
(function () {
  const canvas = document.getElementById('bgc');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, pts = [];
  const COLORS = ['rgba(45,106,68,','rgba(61,138,90,','rgba(125,194,66,','rgba(158,212,95,'];
  function resize() { W = canvas.width = innerWidth; H = canvas.height = innerHeight; }
  resize(); addEventListener('resize', resize, {passive:true});
  class P {
    reset(init) {
      this.x  = Math.random()*W; this.y = init ? Math.random()*H : H+8;
      this.r  = Math.random()*1.8+0.4;
      this.vx = (Math.random()-.5)*.22; this.vy = -(Math.random()*.45+.12);
      this.a  = 0; this.ta = Math.random()*.42+.06;
      this.c  = COLORS[Math.floor(Math.random()*COLORS.length)];
      this.l  = 0; this.ml = Math.random()*320+180;
    }
    constructor() { this.reset(true); }
    update() {
      this.x += this.vx; this.y += this.vy; this.l++;
      const t = this.l/this.ml;
      this.a = t<.15 ? this.ta*(t/.15) : t>.75 ? this.ta*(1-(t-.75)/.25) : this.ta;
      if (this.l>=this.ml) this.reset(false);
    }
    draw() { ctx.beginPath(); ctx.arc(this.x,this.y,this.r,0,Math.PI*2); ctx.fillStyle=this.c+this.a+')'; ctx.fill(); }
  }
  for (let i=0;i<90;i++) pts.push(new P());
  function loop() { ctx.clearRect(0,0,W,H); pts.forEach(p=>{p.update();p.draw();}); requestAnimationFrame(loop); }
  loop();
})();

/* ── Nav scroll ───────────────────────────────────────────────── */
addEventListener('scroll', () => {
  document.getElementById('nav')?.classList.toggle('sc', scrollY>60);
}, {passive:true});

/* ── Smooth scroll ────────────────────────────────────────────── */
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const t = document.querySelector(a.getAttribute('href'));
    if (t) { e.preventDefault(); t.scrollIntoView({behavior:'smooth',block:'start'}); }
  });
});

/* ── Scroll reveal ────────────────────────────────────────────── */
const ro = new IntersectionObserver(
  entries => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); ro.unobserve(e.target); } }),
  {threshold:.1}
);
document.querySelectorAll('.rv').forEach(el => ro.observe(el));

/* ── Feature cards stagger ────────────────────────────────────── */
const fgrid = document.querySelector('.feat-grid');
if (fgrid) {
  fgrid.querySelectorAll('.fc').forEach(c => {
    c.style.opacity='0'; c.style.transform='translateY(26px)';
    c.style.transition='opacity .65s ease,transform .65s ease,box-shadow .38s,border-color .38s';
  });
  new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (en.isIntersecting) {
        en.target.querySelectorAll('.fc').forEach((c,i) => {
          setTimeout(() => { c.style.opacity='1'; c.style.transform='translateY(0)'; }, i*65);
        });
        en.target._roUnobserve?.();
      }
    });
  },{threshold:.05}).observe(fgrid);
}

/* ══════════════════════════════════════════════════════════════
   LISTA DE ESPERA — Cadastro
══════════════════════════════════════════════════════════════ */
async function handleWl(e) {
  e.preventDefault();
  const name  = document.getElementById('wlN').value.trim();
  const email = document.getElementById('wlE').value.trim().toLowerCase();
  const phone = document.getElementById('wlP').value.trim();
  const role  = document.getElementById('wlR').value;
  const btn   = document.getElementById('wlBtn');
  const btnT  = document.getElementById('wlBT');
  const errEl = document.getElementById('wlErr');

  if (!name||!email) return;
  btn.disabled=true;
  btnT.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="animation:spin .8s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Cadastrando…';
  errEl.style.display='none';

  try {
    // 1. Inserir na lista de espera
    const {error:dbErr} = await _sb.from('waitlist').insert({
      name, email, whatsapp:phone||null, role,
      source:'landing', status:'pending',
      created_at: new Date().toISOString()
    });
    if (dbErr) {
      if (dbErr.code==='23505')
        throw new Error('Este e-mail já está na lista de espera! 🎉 Você já garantiu sua posição!');
      throw new Error(dbErr.message);
    }

    // 2. Guardar dados do remetente para uso nos convites
    _senderName  = name;
    _senderEmail = email;

    // 3. Track waitlist submission
    _lTelTrack('waitlist_submit', { role, has_whatsapp: !!phone });

    // 4. Pré-preencher textarea de convite com mensagem padrão
    const fn = name.split(' ')[0];
    const invMsg = document.getElementById('invMsg');
    if (invMsg && !invMsg.value) {
      invMsg.value = `Olá! Acabei de entrar na lista de espera do Family FinTrack e quero te indicar também.\n\nÉ um app de gestão financeira familiar com Inteligência Artificial — ajuda a família toda a ter controle e planejamento financeiro de verdade.\n\nO acesso ainda é restrito (beta exclusivo), mas você pode se cadastrar gratuitamente na lista de espera e garantir sua posição.\n\nAcesse e cadastre-se: ${location.origin}\n\n${fn}`;
    }

    // 4. Enviar email de confirmação
    const fn2 = name.split(' ')[0];
    if (_ej.serviceId && _ej.templateId && _ej.publicKey) {
      try {
        await emailjs.send(_ej.serviceId, _ej.templateId, {
          to_email:       email,
          report_subject: '[Family FinTrack] ✅ Você está na lista de espera!',
          Subject:        '[Family FinTrack] Posição garantida na lista de espera!',
          month_year:     _dateUtils.formatMonthYear(new Date()),
          report_content: buildWaitlistEmail(fn2, email, role),
        });
      } catch(ejErr) { console.warn('[landing] EmailJS:', ejErr.message); }
    }

    // 5. Mostrar tela de sucesso
    document.getElementById('sNm').textContent  = fn2;
    document.getElementById('sEm').textContent  = email;
    document.getElementById('wlFrm').style.display = 'none';
    const suc = document.getElementById('wlSuc');
    suc.style.display = 'flex';
    suc.scrollIntoView({behavior:'smooth', block:'center'});

  } catch(err) {
    errEl.textContent = '⚠️ '+(err.message||'Erro ao cadastrar. Tente novamente.');
    errEl.style.display='block';
    btn.disabled=false;
    btnT.innerHTML='📋 Entrar para a lista de espera';
  }
}

/* ══════════════════════════════════════════════════════════════
   ENVIO DE CONVITES POR EMAIL
══════════════════════════════════════════════════════════════ */
async function sendInvites() {
  const emailsEl = document.getElementById('invEmails');
  const msgEl    = document.getElementById('invMsg');
  const sendBtn  = document.getElementById('invSendBtn');
  const sendTxt  = document.getElementById('invSendTxt');
  const errEl    = document.getElementById('invErr');
  const okEl     = document.getElementById('invOk');

  errEl.style.display='none';
  okEl.style.display='none';

  // Parse e valida emails
  const rawEmails = (emailsEl?.value || '').split(/[,;\s]+/).map(e=>e.trim().toLowerCase()).filter(e=>e.includes('@'));
  if (!rawEmails.length) { showInviteErr('Informe pelo menos um e-mail de destino.'); return; }
  if (rawEmails.length > 5)  { showInviteErr('Máximo de 5 destinatários por vez.'); return; }

  const msg = (msgEl?.value||'').trim();
  if (!msg) { showInviteErr('Escreva uma mensagem de indicação para seus amigos.'); return; }

  if (!_ej.serviceId || !_ej.templateId || !_ej.publicKey) {
    showInviteErr('Sistema de email não configurado. Tente mais tarde.');
    return;
  }

  sendBtn.disabled=true;
  sendTxt.innerHTML='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="animation:spin .8s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Enviando…';

  const fn = (_senderName||'Seu amigo').split(' ')[0];
  let sent=0, failed=0;

  for (const recipientEmail of rawEmails) {
    try {
      const htmlBody = buildInviteEmail(fn, _senderEmail, recipientEmail, msg);
      await emailjs.send(_ej.serviceId, _ej.templateId, {
        to_email:       recipientEmail,
        report_subject: `${fn} te indicou para a lista de espera do Family FinTrack 💚`,
        Subject:        `${fn} te indicou para a lista de espera do Family FinTrack 💚`,
        month_year:     _dateUtils.formatMonthYear(new Date()),
        report_content: htmlBody,
      });
      sent++;
    } catch(e) {
      console.warn('[invite] failed for', recipientEmail, e.message);
      failed++;
    }
  }

  sendBtn.disabled=false;
  sendTxt.innerHTML='Enviar convites';

  if (sent>0) {
    _lTelTrack('invite_sent', { count: sent, failed });
    okEl.textContent = sent===rawEmails.length
      ? `✅ ${sent} indicação(ões) enviada(s) com sucesso!`
      : `✅ ${sent} enviado(s). ${failed} falhou — verifique os endereços.`;
    okEl.style.display='block';
    emailsEl.value='';
    msgEl.value='';
  } else {
    showInviteErr('Nenhum email foi enviado. Verifique os endereços e tente novamente.');
  }
}

function showInviteErr(msg) {
  const el = document.getElementById('invErr');
  if (el) { el.textContent=msg; el.style.display='block'; }
}

/* ══════════════════════════════════════════════════════════════
   TEMPLATES DE EMAIL
══════════════════════════════════════════════════════════════ */
function buildWaitlistEmail(firstName, email, role) {
  const roleLabel = {family:'Família com filhos',couple:'Casal',personal:'Uso individual',business:'Empreendedor'}[role]||role;
  return `
<div style="font-family:'Plus Jakarta Sans',Arial,sans-serif;background:#0a1e12;padding:0;margin:0">
<div style="max-width:580px;margin:0 auto;background:#0a1e12">

  <div style="background:linear-gradient(160deg,#0a1e12 0%,#1a3d27 50%,#0a1e12 100%);padding:52px 40px 44px;text-align:center;border-bottom:1px solid rgba(125,194,66,.2)">
    <div style="width:72px;height:72px;background:linear-gradient(135deg,#2d6a44,#7dc242);border-radius:20px;display:inline-flex;align-items:center;justify-content:center;font-size:2.2rem;margin-bottom:22px;box-shadow:0 8px 32px rgba(125,194,66,.25)">🛡️</div>
    <div style="font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,.3);margin-bottom:10px;font-weight:700">Family FinTrack · Lista de Espera Beta</div>
    <h1 style="font-family:Georgia,serif;font-size:28px;font-weight:700;color:#fff;margin:0;line-height:1.2">Posição garantida! 🎉</h1>
    <div style="width:48px;height:2px;background:linear-gradient(90deg,#7dc242,#9ed45f);border-radius:2px;margin:20px auto 0"></div>
  </div>

  <div style="background:#122a1a;padding:42px 40px;border-bottom:1px solid rgba(125,194,66,.12)">
    <p style="font-size:17px;color:rgba(255,255,255,.85);margin:0 0 18px;line-height:1.65;font-family:Georgia,serif">
      Olá, <strong style="color:#9ed45f">${firstName}</strong>! 👋
    </p>
    <p style="font-size:14px;color:rgba(255,255,255,.55);margin:0 0 28px;line-height:1.85">
      Você entrou na lista de espera do <strong style="color:#7dc242">Family FinTrack</strong>. 
      Sua posição está garantida e você será um dos primeiros a receber acesso quando seu convite for liberado.
    </p>

    <div style="background:linear-gradient(135deg,#0a1e12,#1a3d27);border:1px solid rgba(125,194,66,.28);border-radius:18px;padding:28px;text-align:center;margin-bottom:26px">
      <div style="font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.28);margin-bottom:10px;font-weight:700">Seu status</div>
      <div style="font-family:Georgia,serif;font-size:24px;font-weight:700;color:#7dc242;margin-bottom:8px">📋 Na Lista de Espera</div>
      <div style="font-size:12px;color:rgba(255,255,255,.32)">Acesso liberado em ordem de cadastro · Gratuito durante o beta</div>
    </div>

    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:28px">
      <div style="flex:1;min-width:160px;background:rgba(125,194,66,.07);border:1px solid rgba(125,194,66,.18);border-radius:12px;padding:14px 16px">
        <div style="font-size:9px;color:rgba(255,255,255,.28);font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px">Perfil</div>
        <div style="font-size:13px;color:rgba(255,255,255,.75);font-weight:700">${roleLabel}</div>
      </div>
      <div style="flex:1;min-width:160px;background:rgba(125,194,66,.07);border:1px solid rgba(125,194,66,.18);border-radius:12px;padding:14px 16px">
        <div style="font-size:9px;color:rgba(255,255,255,.28);font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px">Acesso</div>
        <div style="font-size:13px;color:rgba(255,255,255,.75);font-weight:700">Gratuito · Beta exclusivo</div>
      </div>
    </div>

    <div style="background:rgba(125,194,66,.07);border-left:3px solid #7dc242;border-radius:0 12px 12px 0;padding:18px 22px;margin-bottom:24px">
      <div style="font-size:13px;color:rgba(255,255,255,.65);line-height:1.8">
        💡 <strong style="color:#9ed45f">O que é o Family FinTrack?</strong> — O único app de gestão financeira familiar com Inteligência Artificial embarcada. Analisa padrões, prevê gastos e ajuda toda a família a prosperar financeiramente juntos.
      </div>
    </div>

    <p style="font-size:13px;color:rgba(255,255,255,.32);text-align:center;margin:0;line-height:1.75">
      Assim que seu acesso for liberado, você receberá um email<br>com todas as instruções. Até breve, <strong style="color:rgba(255,255,255,.6)">${firstName}</strong>! 🚀
    </p>
  </div>

  <div style="padding:24px 40px;text-align:center;background:#0a1e12">
    <div style="font-size:11px;color:rgba(255,255,255,.2);line-height:1.85">
      Family FinTrack · Beta Privado 2025<br>
      Família Inteligente, Finanças sob Controle<br>
      <span style="opacity:.6">Potencializado por Inteligência Artificial · Gemini · Supabase</span>
    </div>
  </div>
</div></div>`;
}

function buildInviteEmail(senderFirstName, senderEmail, recipientEmail, personalMessage) {
  // Escape HTML no texto personalizado
  const safeMsg = personalMessage
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\n/g,'<br>');
  const siteUrl = location.origin;

  return `
<div style="font-family:'Plus Jakarta Sans',Arial,sans-serif;background:#f4f8f2;padding:0;margin:0">
<div style="max-width:580px;margin:0 auto;background:#f4f8f2">

  <div style="background:linear-gradient(160deg,#0a1e12 0%,#1a3d27 60%,#235234 100%);padding:48px 40px 40px;text-align:center;border-radius:0 0 24px 24px">
    <div style="font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,.35);margin-bottom:14px;font-weight:700">Family FinTrack · Convite Exclusivo</div>
    <div style="font-size:2.8rem;margin-bottom:16px">🛡️</div>
    <h1 style="font-family:Georgia,serif;font-size:26px;font-weight:700;color:#fff;margin:0;line-height:1.25">
      <strong style="color:#9ed45f">${senderFirstName}</strong> te indicou para<br>a lista de espera do Family FinTrack
    </h1>
  </div>

  <div style="background:#fff;margin:24px 20px;border-radius:18px;padding:32px;box-shadow:0 4px 24px rgba(0,0,0,.06);border:1px solid rgba(0,0,0,.06)">
    <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#5a7a64;font-weight:700;margin-bottom:14px">Mensagem de ${senderFirstName}</div>
    <div style="font-size:15px;color:#1e3a2a;line-height:1.75;font-family:Georgia,serif;font-style:italic;padding:18px;background:#f4f8f2;border-left:3px solid #7dc242;border-radius:0 12px 12px 0">
      ${safeMsg}
    </div>
  </div>

  <div style="background:#fff;margin:0 20px 24px;border-radius:18px;padding:28px;box-shadow:0 4px 24px rgba(0,0,0,.06);border:1px solid rgba(0,0,0,.06)">
    <div style="font-size:13px;font-weight:700;color:#1a3d27;margin-bottom:18px">Por que você vai adorar:</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
      ${[
        ['🤖','IA Financeira','Análise inteligente dos gastos familiares com Gemini AI'],
        ['📅','Planejamento automático','Contas e recorrências com alertas no Telegram e WhatsApp'],
        ['👨‍👩‍👧‍👦','Toda a família','Perfis e permissões individuais para cada membro'],
        ['🔮','Visão do futuro','Previsão de fluxo de caixa 90 dias calculada por IA'],
      ].map(([ic,t,d])=>`<tr><td style="padding:10px 0;border-bottom:1px solid #e8f0e4;vertical-align:top;width:34px;font-size:1.2rem">${ic}</td><td style="padding:10px 10px 10px 6px;border-bottom:1px solid #e8f0e4"><div style="font-size:13px;font-weight:700;color:#1a3d27;margin-bottom:2px">${t}</div><div style="font-size:12px;color:#5a7a64">${d}</div></td></tr>`).join('')}
    </table>
  </div>

  <div style="text-align:center;padding:0 20px 24px">
    <div style="background:linear-gradient(135deg,#1a3d27,#235234);border-radius:18px;padding:28px">
      <div style="font-size:12px;color:rgba(255,255,255,.45);margin-bottom:14px;font-weight:600">Acesso gratuito · Lista de espera · Beta exclusivo</div>
      <a href="${siteUrl}" style="display:inline-block;font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:16px;font-weight:800;color:#0a1e12;background:linear-gradient(135deg,#7dc242,#9ed45f);border-radius:12px;padding:14px 36px;text-decoration:none;box-shadow:0 4px 20px rgba(125,194,66,.3)">
        Garantir minha posição →
      </a>
      <div style="font-size:11px;color:rgba(255,255,255,.3);margin-top:14px">${siteUrl}</div>
    </div>
  </div>

  <div style="padding:20px 40px;text-align:center">
    <div style="font-size:11px;color:#8aaa96;line-height:1.85">
      Você foi indicado por <strong>${senderFirstName}</strong>${senderEmail ? ` (${senderEmail})` : ''}<br>
      Family FinTrack · Família Inteligente, Finanças sob Controle<br>
      <span style="opacity:.65">Potencializado por Inteligência Artificial</span>
    </div>
  </div>
</div></div>`;
}
