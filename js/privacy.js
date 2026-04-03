/* ═══════════════════════════════════════════════════════════════════════════
   PRIVACY — Política de Privacidade & Solicitação de Exclusão de Dados
   ─────────────────────────────────────────────────────────────────────────
   Funcionalidades:
   • Página de política de privacidade (HTML estático em index.html)
   • Formulário de solicitação de exclusão de dados (LGPD / GDPR)
   • Validação e envio via EmailJS ao administrador do sistema
   • Persistência da solicitação em app_settings para rastreamento
═══════════════════════════════════════════════════════════════════════════ */

'use strict';

// ── Init ──────────────────────────────────────────────────────────────────
function _prvInitPage() {
  _prvRestoreFormState();
}
window._prvInitPage = _prvInitPage;

// ── Validate & enable delete button ───────────────────────────────────────
function _privUpdateDeleteBtn() {
  const email   = document.getElementById('privDeleteEmail')?.value.trim() || '';
  const confirm = document.getElementById('privDeleteConfirm')?.value || '';
  const btn     = document.getElementById('privDeleteSubmit');
  if (!btn) return;
  const valid = email.includes('@') && confirm === 'EXCLUIR MEUS DADOS';
  btn.disabled = !valid;
}
window._privUpdateDeleteBtn = _privUpdateDeleteBtn;

// ── Check if a request was already sent ───────────────────────────────────
async function _prvRestoreFormState() {
  try {
    if (typeof getAppSetting !== 'function') return;
    const prev = await getAppSetting('data_deletion_request', null);
    if (prev) {
      _prvShowStatus(
        `✅ Solicitação de exclusão enviada em ${new Date(prev).toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' })}. Prazo: até 15 dias úteis.`,
        'success'
      );
      const btn = document.getElementById('privDeleteSubmit');
      if (btn) { btn.disabled = true; btn.textContent = '✅ Solicitação já enviada'; }
      const form = document.querySelector('.priv-delete-form');
      if (form) form.style.opacity = '.6';
    }
  } catch (_) {}
}

// ── Submit deletion request ────────────────────────────────────────────────
async function _privSubmitDeletion() {
  const emailEl   = document.getElementById('privDeleteEmail');
  const reasonEl  = document.getElementById('privDeleteReason');
  const confirmEl = document.getElementById('privDeleteConfirm');
  const btn       = document.getElementById('privDeleteSubmit');

  const email   = emailEl?.value.trim() || '';
  const reason  = reasonEl?.value || 'not_specified';
  const confirm = confirmEl?.value || '';

  if (!email || !email.includes('@')) {
    _prvShowStatus('⚠️ Informe um e-mail válido.', 'error');
    return;
  }
  if (confirm !== 'EXCLUIR MEUS DADOS') {
    _prvShowStatus('⚠️ Digite exatamente: EXCLUIR MEUS DADOS', 'error');
    return;
  }

  // Check logged-in user email matches
  const loggedEmail = currentUser?.email || '';
  if (loggedEmail && email.toLowerCase() !== loggedEmail.toLowerCase()) {
    _prvShowStatus(`⚠️ O e-mail informado não corresponde ao e-mail da conta logada (${loggedEmail}).`, 'error');
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Enviando…'; }

  try {
    const ts        = new Date().toISOString();
    const userName  = currentUser?.name || 'Usuário';
    const familyId  = typeof famId === 'function' ? famId() : (currentUser?.family_id || '');
    const familyName = currentUser?.families?.find(f => f.id === familyId)?.name || familyId;

    const REASON_LABELS = {
      no_longer_using: 'Não uso mais o app',
      privacy_concerns: 'Preocupações com privacidade',
      switching_app: 'Mudando para outro app',
      test_account: 'Era uma conta de teste',
      other: 'Outro motivo',
      not_specified: 'Não especificado',
    };
    const reasonLabel = REASON_LABELS[reason] || reason;

    // 1. Log request to app_settings for traceability
    if (typeof saveAppSetting === 'function') {
      await saveAppSetting('data_deletion_request', ts).catch(() => {});
      await saveAppSetting('data_deletion_email', email).catch(() => {});
      await saveAppSetting('data_deletion_reason', reason).catch(() => {});
    }

    // 2. Send email via EmailJS to the admin configured email
    let emailSent = false;
    try {
      const adminEmail = typeof autoCheckConfig !== 'undefined'
        ? (autoCheckConfig?.emailDefault || autoCheckConfig?.adminEmail || '')
        : '';

      if (adminEmail && typeof emailjs !== 'undefined' && EMAILJS_CONFIG?.serviceId) {
        emailjs.init(EMAILJS_CONFIG.publicKey);
        const appUrl = window.location.origin + window.location.pathname;
        await emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, {
          to_email:   adminEmail,
          subject:    `[Family FinTrack] Solicitação de Exclusão de Dados — ${email}`,
          from_name:  'Family FinTrack — Solicitação de Privacidade',
          message:    `Solicitação de exclusão recebida:\n\nUsuário: ${userName}\nE-mail: ${email}\nFamília: ${familyName} (${familyId})\nMotivo: ${reasonLabel}\nData: ${new Date(ts).toLocaleString('pt-BR')}\n\nPrazo LGPD: 15 dias úteis a partir desta data.\nPor favor, processe a exclusão completa dos dados desta família no banco Supabase.`,
          report_content: `
            <h2 style="color:#dc2626">⚠️ Solicitação de Exclusão de Dados (LGPD)</h2>
            <table style="border-collapse:collapse;width:100%;font-size:14px">
              <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">Usuário</td><td style="padding:8px;border:1px solid #e5e7eb">${userName}</td></tr>
              <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">E-mail</td><td style="padding:8px;border:1px solid #e5e7eb">${email}</td></tr>
              <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">Família</td><td style="padding:8px;border:1px solid #e5e7eb">${familyName}</td></tr>
              <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">Motivo</td><td style="padding:8px;border:1px solid #e5e7eb">${reasonLabel}</td></tr>
              <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">Data</td><td style="padding:8px;border:1px solid #e5e7eb">${new Date(ts).toLocaleString('pt-BR')}</td></tr>
              <tr style="background:#fef2f2"><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">Prazo LGPD</td><td style="padding:8px;border:1px solid #e5e7eb;color:#dc2626;font-weight:700">15 dias úteis a partir de ${new Date(ts).toLocaleDateString('pt-BR')}</td></tr>
            </table>
            <p style="margin-top:16px;color:#6b7280;font-size:12px">Esta solicitação foi registrada automaticamente pelo Family FinTrack em conformidade com a LGPD (Art. 18).</p>`,
        });
        emailSent = true;
      }
    } catch (emailErr) {
      console.warn('[Privacy] Email send failed:', emailErr.message);
    }

    // 3. Also record in app_telemetry for audit trail
    if (typeof telTrack === 'function') {
      telTrack('data_deletion_request', {
        email, reason, family_id: familyId, ts,
      });
    }

    const msg = emailSent
      ? `✅ Solicitação enviada com sucesso! O administrador foi notificado. Prazo de resposta: 15 dias úteis conforme a LGPD. Guarde o protocolo: <strong>${ts.slice(0,10)}-${(familyId||'').slice(0,8)}</strong>`
      : `✅ Solicitação registrada. Protocolo: <strong>${ts.slice(0,10)}-${(familyId||'').slice(0,8)}</strong>. Entre em contato com o administrador do seu sistema para processar a exclusão.`;

    _prvShowStatus(msg, 'success');
    if (btn) { btn.textContent = '✅ Solicitação enviada'; btn.disabled = true; }

  } catch (e) {
    console.error('[Privacy] Deletion request failed:', e);
    _prvShowStatus('❌ Erro ao registrar solicitação: ' + (e.message || 'desconhecido'), 'error');
    if (btn) { btn.disabled = false; btn.textContent = '🗑️ Enviar Solicitação de Exclusão'; }
  }
}
window._privSubmitDeletion = _privSubmitDeletion;

// ── Show status message ───────────────────────────────────────────────────
function _prvShowStatus(msg, type) {
  const el = document.getElementById('privDeleteStatus');
  if (!el) return;
  el.innerHTML = msg;
  el.style.display = '';
  el.style.background = type === 'success' ? '#f0fdf4' : '#fef2f2';
  el.style.border     = type === 'success' ? '1px solid #86efac' : '1px solid #fecaca';
  el.style.color      = type === 'success' ? '#14532d' : '#7f1d1d';
  el.style.borderRadius = '8px';
  el.style.padding = '10px 12px';
}
