// ══════════════════════════════════════════════════════════════════════════════
// feedback.js — Sistema de Feedback / Bug Report do Family FinTrack
// ══════════════════════════════════════════════════════════════════════════════

'use strict';

// ── Estado do módulo ─────────────────────────────────────────────────────────
let _fbScreenBase64 = null; // base64 do screenshot (sem prefixo data:...)
let _fbScreenMime   = null; // 'image/png' | 'image/jpeg' | etc.
let _fbSubmitting   = false;

// ── Labels ───────────────────────────────────────────────────────────────────
const FB_TYPE_LABELS = {
  bug:         '🐛 Bug',
  error:       '⚠️ Erro',
  improvement: '✨ Melhoria',
  feature:     '🚀 Nova funcionalidade',
};
const FB_MODULE_LABELS = {
  dashboard: 'Dashboard', transactions: 'Transações', accounts: 'Contas',
  reports: 'Relatórios', budgets: 'Orçamentos', categories: 'Categorias',
  payees: 'Beneficiários', scheduled: 'Programados', investments: 'Investimentos',
  debts: 'Dívidas', prices: 'Preços / Mercado', ai_insights: 'AI Insights',
  settings: 'Configurações', import: 'Importar / Backup',
  landing: 'Landing Page', other: 'Outro / Geral',
};
const FB_STATUS_LABELS = {
  new:       { icon: '🔴', label: 'Novo' },
  backlog:   { icon: '📦', label: 'Backlog' },
  priority:  { icon: '⭐', label: 'Prioritário' },
  flagged:   { icon: '🚩', label: 'Flagado' },
  done:      { icon: '✅', label: 'Implementado' },
  irrelevant:{ icon: '🚫', label: 'Irrelevante' },
};

// ══════════════════════════════════════════════════════════════════════════════
// MODAL DE SUBMISSÃO (usuário)
// ══════════════════════════════════════════════════════════════════════════════

window.openFeedbackModal = function() {
  // Reset form
  document.querySelectorAll('input[name="feedbackType"]').forEach(r => r.checked = false);
  document.querySelectorAll('.feedback-type-opt').forEach(l => l.classList.remove('selected'));
  const mod = document.getElementById('feedbackModule');
  if (mod) mod.value = state.currentPage || '';
  const desc = document.getElementById('feedbackDesc');
  if (desc) desc.value = '';
  const err = document.getElementById('feedbackErr');
  if (err) { err.style.display = 'none'; err.textContent = ''; }
  feedbackClearFile();
  _fbSubmitting = false;
  const btn = document.getElementById('feedbackSubmitBtn');
  if (btn) btn.disabled = false;
  const txt = document.getElementById('feedbackSubmitTxt');
  if (txt) txt.textContent = '📤 Enviar report';

  // Wire radio visual state
  document.querySelectorAll('.feedback-type-opt').forEach(label => {
    label.onclick = function() {
      document.querySelectorAll('.feedback-type-opt').forEach(l => l.classList.remove('selected'));
      this.classList.add('selected');
    };
  });

  openModal('feedbackModal');
};

window.feedbackHandleFile = function(file) {
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    const err = document.getElementById('feedbackErr');
    if (err) { err.textContent = 'Imagem muito grande (máx 5 MB).'; err.style.display = ''; }
    return;
  }
  const reader = new FileReader();
  reader.onload = function(e) {
    const dataUrl = e.target.result;
    const comma   = dataUrl.indexOf(',');
    _fbScreenBase64 = dataUrl.slice(comma + 1);
    _fbScreenMime   = file.type || 'image/png';

    const preview = document.getElementById('feedbackScreenPreview');
    const label   = document.getElementById('feedbackScreenLabel');
    const img     = document.getElementById('feedbackScreenImg');
    const name    = document.getElementById('feedbackScreenName');
    if (img)     img.src = dataUrl;
    if (name)    name.textContent = file.name;
    if (preview) preview.style.display = '';
    if (label)   label.style.display   = 'none';
  };
  reader.readAsDataURL(file);
};

window.feedbackHandleDrop = function(e) {
  e.preventDefault();
  const zone = document.getElementById('feedbackScreenDropZone');
  if (zone) zone.style.borderColor = 'var(--border)';
  const file = e.dataTransfer?.files?.[0];
  if (file && file.type.startsWith('image/')) feedbackHandleFile(file);
};

window.feedbackClearFile = function() {
  _fbScreenBase64 = null;
  _fbScreenMime   = null;
  const preview = document.getElementById('feedbackScreenPreview');
  const label   = document.getElementById('feedbackScreenLabel');
  const img     = document.getElementById('feedbackScreenImg');
  const file    = document.getElementById('feedbackScreenFile');
  if (img)     img.src = '';
  if (preview) preview.style.display = 'none';
  if (label)   label.style.display   = '';
  if (file)    { try { file.value = ''; } catch(_) {} }
};

window.submitFeedback = async function() {
  if (_fbSubmitting) return;

  const typeEl = document.querySelector('input[name="feedbackType"]:checked');
  const modEl  = document.getElementById('feedbackModule');
  const descEl = document.getElementById('feedbackDesc');
  const errEl  = document.getElementById('feedbackErr');
  const btnEl  = document.getElementById('feedbackSubmitBtn');
  const txtEl  = document.getElementById('feedbackSubmitTxt');

  const showErr = msg => {
    if (errEl) { errEl.textContent = msg; errEl.style.display = ''; }
  };

  if (!typeEl?.value)        { showErr('Selecione o tipo do report.'); return; }
  if (!modEl?.value)         { showErr('Selecione o módulo.'); return; }
  if (!descEl?.value?.trim()){ showErr('Descreva o problema ou sugestão.'); return; }

  if (errEl) errEl.style.display = 'none';
  _fbSubmitting = true;
  if (btnEl) btnEl.disabled = true;
  if (txtEl) txtEl.textContent = '⏳ Enviando…';

  try {
    const payload = {
      user_id:     currentUser?.app_user_id || null,  // app_users.id — não auth.uid
      family_id:   famId?.()           || null,
      type:        typeEl.value,
      module:      modEl.value,
      description: descEl.value.trim(),
      screenshot_b64:  _fbScreenBase64 || null,
      screenshot_mime: _fbScreenMime   || null,
      status:      'new',
      priority:    0,
      created_at:  new Date().toISOString(),
    };

    const { error } = await sb.from('app_feedback').insert(payload);
    if (error) throw error;

    closeModal('feedbackModal');
    if (typeof toast === 'function') toast('Report enviado! Obrigado pelo feedback. ✅', 'success');

    // Notificar admins (badge topbar)
    await _checkNewFeedbackOnLogin();

  } catch(e) {
    showErr('Erro ao enviar: ' + (e.message || e));
    _fbSubmitting = false;
    if (btnEl) btnEl.disabled = false;
    if (txtEl) txtEl.textContent = '📤 Enviar report';
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// PAINEL ADMIN — Listagem e gerenciamento
// ══════════════════════════════════════════════════════════════════════════════

window.loadFeedbackReports = async function() {
  const el     = document.getElementById('uaFeedbackContent');
  const cntEl  = document.getElementById('uaFeedbackCount');
  const filter = document.getElementById('uaFeedbackFilter')?.value || 'new';
  if (!el) return;

  el.innerHTML = '<div style="text-align:center;padding:32px;color:var(--muted);font-size:.85rem">⏳ Carregando…</div>';

  try {
    let q = sb.from('app_feedback')
      .select('*, app_users(name, email)')
      .order('created_at', { ascending: false });

    if (filter !== 'all') q = q.eq('status', filter);

    const { data, error } = await q.limit(200);
    if (error) throw error;

    const total = (data||[]).length;
    if (cntEl) cntEl.textContent = total ? `${total} item${total !== 1 ? 's' : ''}` : '';

    if (!total) {
      const labels = { new:'Novos', backlog:'Backlog', priority:'Prioritários',
        flagged:'Flagados', done:'Implementados', irrelevant:'Irrelevantes', all:'Todos' };
      el.innerHTML = `<div style="text-align:center;padding:48px 24px;color:var(--muted)">
        <div style="font-size:2.5rem;margin-bottom:12px;opacity:.3">💬</div>
        <div style="font-size:.9rem;font-weight:600;color:var(--text2);margin-bottom:4px">Nenhum report</div>
        <div style="font-size:.8rem">Sem itens em <strong>${labels[filter]||filter}</strong></div>
      </div>`;
      return;
    }

    el.innerHTML = data.map(item => _fbAdminCard(item)).join('');
  } catch(e) {
    el.innerHTML = `<div style="color:var(--danger,#dc2626);padding:16px;font-size:.82rem;background:rgba(220,38,38,.06);border-radius:8px;margin:8px">⚠️ Erro: ${e.message}</div>`;
  }
};

function _fbAdminCard(item) {
  const st   = FB_STATUS_LABELS[item.status] || { icon: '❓', label: item.status };
  const typ  = FB_TYPE_LABELS[item.type]     || item.type;
  const mod  = FB_MODULE_LABELS[item.module] || item.module;
  const dt   = item.created_at
    ? new Date(item.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : '—';
  const user     = item.app_users?.name || item.app_users?.email || 'Usuário';
  const userId   = item.user_id || '';
  const userLink = userId
    ? `<span onclick="_fbOpenUserTelemetry('${userId}','${esc(user)}')"
         style="cursor:pointer;color:var(--accent);text-decoration:underline;text-decoration-style:dotted;font-weight:600;font-size:.78rem"
         title="Ver telemetria">👤 ${esc(user)}</span>`
    : `<span style="font-size:.78rem;color:var(--muted)">👤 ${esc(user)}</span>`;

  // Screenshot thumbnail
  const hasScreen = !!item.screenshot_b64;
  const screenHtml = hasScreen
    ? `<div style="margin:10px 0 6px">
        <img src="data:${item.screenshot_mime || 'image/png'};base64,${item.screenshot_b64}"
          style="max-width:100%;max-height:200px;border-radius:8px;border:1px solid var(--border);cursor:zoom-in;box-shadow:0 2px 8px rgba(0,0,0,.08)"
          onclick="_fbExpandScreen(this)" title="Clique para ampliar 🔍">
        <div style="font-size:.68rem;color:var(--muted);margin-top:4px">📸 Screenshot — clique para ampliar</div>
      </div>` : '';

  // Status pill color map
  const statusColors = {
    new:       { bg: '#fef2f2', border: '#fca5a5', text: '#dc2626' },
    backlog:   { bg: 'var(--surface2)', border: 'var(--border)', text: 'var(--text2)' },
    priority:  { bg: '#fffbeb', border: '#fcd34d', text: '#d97706' },
    flagged:   { bg: '#fff7ed', border: '#fdba74', text: '#ea580c' },
    done:      { bg: '#f0fdf4', border: '#86efac', text: '#16a34a' },
    irrelevant:{ bg: 'var(--surface2)', border: 'var(--border)', text: 'var(--muted)' },
  };
  const sc = statusColors[item.status] || statusColors.backlog;

  // Status action buttons — compact icon+label
  const statusBtns = Object.entries(FB_STATUS_LABELS).map(([val, s]) => {
    const isCur = item.status === val;
    return `<button onclick="_fbSetStatus('${item.id}','${val}',document.getElementById('fbcard_${item.id}'))"
      title="${s.label}"
      style="padding:5px 10px;font-size:.72rem;border-radius:8px;cursor:pointer;font-family:var(--font-sans);
             border:1.5px solid ${isCur ? 'var(--accent)' : 'var(--border)'};
             background:${isCur ? 'var(--accent-lt)' : 'var(--surface)'};
             color:${isCur ? 'var(--accent)' : 'var(--text2)'};
             font-weight:${isCur ? '700' : '500'};
             transition:all .15s"
      onmouseover="if(!${isCur})this.style.borderColor='var(--accent)',this.style.color='var(--accent)'"
      onmouseout="if(!${isCur})this.style.borderColor='var(--border)',this.style.color='var(--text2)'"
    >${s.icon} ${s.label}</button>`;
  }).join('');

  const commentVal = item.admin_comment || '';
  const hasComment = !!commentVal;

  return `<div id="fbcard_${item.id}"
    style="border:1px solid var(--border);border-radius:12px;background:var(--surface);
           overflow:hidden;transition:box-shadow .2s"
    onmouseover="this.style.boxShadow='0 4px 16px rgba(0,0,0,.08)'"
    onmouseout="this.style.boxShadow='none'">

    <!-- ── Card header ── -->
    <div style="padding:10px 14px;background:var(--surface2);border-bottom:1px solid var(--border);
                display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <!-- Tipo pill -->
      <span style="font-size:.72rem;font-weight:700;padding:3px 9px;border-radius:20px;
                   background:rgba(99,102,241,.1);color:#6366f1;border:1px solid rgba(99,102,241,.2)">
        ${typ}
      </span>
      <!-- Módulo -->
      <span style="font-size:.72rem;color:var(--muted);background:var(--surface);
                   padding:3px 8px;border-radius:20px;border:1px solid var(--border)">
        📂 ${mod}
      </span>
      <span style="flex:1"></span>
      <!-- Status badge -->
      <span style="font-size:.72rem;font-weight:700;padding:3px 9px;border-radius:20px;
                   background:${sc.bg};color:${sc.text};border:1px solid ${sc.border}">
        ${st.icon} ${st.label}
      </span>
    </div>

    <!-- ── Card body ── -->
    <div style="padding:14px">

      <!-- Meta row: user + date -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;gap:8px;flex-wrap:wrap">
        ${userLink}
        <span style="font-size:.72rem;color:var(--muted);flex-shrink:0">🕐 ${dt}</span>
      </div>

      <!-- Description -->
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;
                  padding:10px 12px;margin-bottom:12px;
                  font-size:.84rem;color:var(--text);line-height:1.65;white-space:pre-wrap;
                  max-height:200px;overflow-y:auto">
        ${esc(item.description)}
      </div>

      <!-- Screenshot -->
      ${screenHtml}

      <!-- ── Status actions ── -->
      <div style="margin-bottom:12px">
        <div style="font-size:.68rem;font-weight:700;color:var(--muted);text-transform:uppercase;
                    letter-spacing:.06em;margin-bottom:6px">Marcar como</div>
        <div style="display:flex;gap:5px;flex-wrap:wrap">${statusBtns}</div>
      </div>

      <!-- ── Admin comment ── -->
      <details ${hasComment ? 'open' : ''} style="border:1px solid var(--border);border-radius:8px;overflow:hidden">
        <summary style="padding:8px 12px;background:var(--surface2);cursor:pointer;font-size:.78rem;
                        font-weight:600;color:var(--text2);list-style:none;display:flex;
                        align-items:center;gap:6px;user-select:none">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
               stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          Comentário interno
          ${hasComment ? '<span style="font-size:.65rem;font-weight:700;padding:1px 6px;border-radius:10px;background:var(--accent-lt);color:var(--accent)">editado</span>' : ''}
        </summary>
        <div style="padding:10px 12px;display:flex;gap:8px;align-items:flex-end;background:var(--surface)">
          <textarea id="fbcmt_${item.id}" rows="3" placeholder="Notas internas, próximos passos, prioridade…"
            style="flex:1;padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;
                   font-family:var(--font-sans);font-size:.82rem;resize:vertical;
                   background:var(--bg2);color:var(--text);line-height:1.5;
                   transition:border-color .15s;outline:none"
            onfocus="this.style.borderColor='var(--accent)'"
            onblur="this.style.borderColor='var(--border)'"
          >${esc(commentVal)}</textarea>
          <button onclick="_fbSaveComment('${item.id}')"
            style="padding:8px 14px;font-size:.8rem;font-family:var(--font-sans);font-weight:600;
                   border:none;background:var(--accent);color:#fff;border-radius:8px;
                   cursor:pointer;white-space:nowrap;transition:opacity .15s;flex-shrink:0"
            onmouseover="this.style.opacity='.88'" onmouseout="this.style.opacity='1'">
            💾 Salvar
          </button>
          <button onclick="_fbDeleteFeedback('${item.id}', document.getElementById('fbcard_${item.id}'))"
            title="Excluir este feedback"
            style="padding:8px 10px;font-size:.8rem;font-family:var(--font-sans);font-weight:600;
                   border:1.5px solid rgba(220,38,38,.3);background:transparent;color:#dc2626;border-radius:8px;
                   cursor:pointer;white-space:nowrap;transition:all .15s;flex-shrink:0"
            onmouseover="this.style.background='#fef2f2'" onmouseout="this.style.background='transparent'">
            🗑
          </button>
        </div>
      </details>

    </div>
  </div>`;
}
window._fbDeleteFeedback = async function(id, card) {
  if (!confirm('Excluir este feedback permanentemente?')) return;
  try {
    const { error } = await sb.from('app_feedback').delete().eq('id', id);
    if (error) throw error;
    if (card) card.remove();
    _updateFeedbackBadge();
    // Update count
    const cntEl = document.getElementById('uaFeedbackCount');
    if (cntEl) {
      const cur = parseInt(cntEl.textContent) || 0;
      if (cur > 0) cntEl.textContent = (cur - 1) + ' item' + (cur - 1 !== 1 ? 's' : '');
    }
    if (typeof toast === 'function') toast('Feedback excluído', 'success');
  } catch(e) {
    if (typeof toast === 'function') toast('Erro: ' + e.message, 'error');
  }
};

window._fbSetStatus = async function(id, status, card) {
  try {
    const { error } = await sb.from('app_feedback').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    // Re-render just this card
    const { data } = await sb.from('app_feedback').select('*, app_users(name,email)').eq('id', id).single();
    if (data && card) card.outerHTML = _fbAdminCard(data);
    _updateFeedbackBadge();
  } catch(e) {
    if (typeof toast === 'function') toast('Erro: ' + e.message, 'error');
  }
};

window._fbSaveComment = async function(id) {
  const txt = document.getElementById('fbcmt_' + id)?.value || '';
  try {
    const { error } = await sb.from('app_feedback').update({ admin_comment: txt, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    if (typeof toast === 'function') toast('Comentário salvo.', 'success');
  } catch(e) {
    if (typeof toast === 'function') toast('Erro: ' + e.message, 'error');
  }
};

window._fbExpandScreen = function(img) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:29999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;padding:24px';
  const big = document.createElement('img');
  big.src = img.src;
  big.style.cssText = 'max-width:100%;max-height:90vh;border-radius:8px;box-shadow:0 0 60px rgba(0,0,0,.8)';
  overlay.appendChild(big);
  overlay.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
};

// ══════════════════════════════════════════════════════════════════════════════
// NOTIFICAÇÃO DE NOVOS FEEDBACKS — admin login
// ══════════════════════════════════════════════════════════════════════════════

async function _checkNewFeedbackOnLogin() {
  if (!currentUser?.role || !['admin','owner'].includes(currentUser.role)) return;

  try {
    const { count } = await sb.from('app_feedback')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'new');

    _updateFeedbackBadge(count || 0);

    if ((count || 0) > 0) _showFeedbackLoginNotif(count);
  } catch(e) {
    console.debug('[feedback badge]', e.message);
  }
}

function _updateFeedbackBadge(count) {
  // Topbar button badge (small dot — always red when > 0)
  const dot = document.getElementById('feedbackBadge');
  if (dot) dot.style.display = count > 0 ? '' : 'none';

  // Admin panel tab badge (modal)
  const tabBadge = document.getElementById('uaFeedbackBadge');
  if (tabBadge) {
    tabBadge.textContent = count > 0 ? count : '';
    tabBadge.style.display = count > 0 ? 'inline-block' : 'none';
  }

  // Settings page tab badge
  const cfgBadge = document.getElementById('cfgFeedbackBadge');
  if (cfgBadge) {
    cfgBadge.textContent = count > 0 ? (count > 99 ? '99+' : String(count)) : '';
    cfgBadge.style.display = count > 0 ? 'inline-block' : 'none';
  }
}

function _showFeedbackLoginNotif(count) {
  // Check if dismissed today
  try {
    const today = new Date().toISOString().slice(0,10);
    if (localStorage.getItem('notif_dismiss_fbLoginNotif') === today) return;
  } catch(_) {}
  // Don't stack multiple popups
  document.getElementById('fbLoginNotifPopup')?.remove();

  const popup = document.createElement('div');
  popup.id = 'fbLoginNotifPopup';
  popup.style.cssText = [
    'position:fixed;bottom:24px;left:24px;z-index:9999',
    'background:var(--surface);border:1.5px solid rgba(220,38,38,.25)',
    'border-radius:14px;padding:16px 18px;max-width:320px;width:calc(100% - 48px)',
    'box-shadow:0 12px 40px rgba(0,0,0,.18);animation:_fbPopIn .35s cubic-bezier(.175,.885,.32,1.275)',
  ].join(';');

  popup.innerHTML = `
    <style>@keyframes _fbPopIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}</style>
    <div style="display:flex;align-items:flex-start;gap:12px">
      <div style="font-size:1.5rem;flex-shrink:0">💬</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:.88rem;font-weight:700;color:var(--text);margin-bottom:4px">
          ${count} novo${count>1?'s':''} report${count>1?'s':''} de usuário${count>1?'s':''}
        </div>
        <div style="font-size:.77rem;color:var(--muted);line-height:1.5">
          ${count>1?'Existem':'Existe'} ${count} report${count>1?'s':''} aguardando revisão.
        </div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button onclick="document.getElementById('fbLoginNotifPopup')?.remove();navigate('settings');setTimeout(()=>{openUserAdmin();setTimeout(()=>{switchUATab('feedback')},350)},450)"
            style="flex:1;padding:7px;font-size:.78rem;font-weight:700;font-family:var(--font-sans);border:none;background:var(--accent);color:#fff;border-radius:8px;cursor:pointer">
            Ver reports
          </button>
          <button onclick="document.getElementById('fbLoginNotifPopup')?.remove()"
            style="padding:7px 12px;font-size:.78rem;font-family:var(--font-sans);border:1px solid var(--border);background:transparent;border-radius:8px;cursor:pointer;color:var(--text2)">
            Depois
          </button>
          <button onclick="(typeof _dismissNotifToday==='function'?_dismissNotifToday('fbLoginNotif'):localStorage.setItem('notif_dismiss_fbLoginNotif',new Date().toISOString().slice(0,10)));document.getElementById('fbLoginNotifPopup')?.remove()"
            style="padding:7px 12px;font-size:.78rem;font-family:var(--font-sans);border:1px solid var(--border);background:transparent;border-radius:8px;cursor:pointer;color:var(--muted)">
            Não hoje
          </button>
        </div>
      </div>
      <button onclick="document.getElementById('fbLoginNotifPopup')?.remove()"
        style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:1.1rem;padding:0;line-height:1;flex-shrink:0">✕</button>
    </div>`;

  document.body.appendChild(popup);
  setTimeout(() => popup?.remove(), 12000);
}

window._fbOpenUserTelemetry = function(userId, userName) {
  // Navigate to telemetry dashboard filtered by user
  // This reuses the existing telemetry page with a user filter
  if (!userId) return;
  navigate('telemetry');
  setTimeout(() => {
    // Try to apply user filter if telemetry supports it
    const filterEl = document.getElementById('telUserFilter');
    if (filterEl) {
      filterEl.value = userId;
      filterEl.dispatchEvent(new Event('change'));
    } else {
      // Open a simple telemetry modal showing user activity
      _fbShowUserTelemetryModal(userId, userName);
    }
  }, 600);
};

window._fbShowUserTelemetryModal = async function(userId, userName) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:19999;display:flex;align-items:center;justify-content:center;padding:16px';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:1.2rem;color:var(--muted);padding:4px';
  closeBtn.onclick = function() { overlay.remove(); };

  const contentDiv = document.createElement('div');
  contentDiv.id = '_fbTelContent';
  contentDiv.style.cssText = 'overflow-y:auto;padding:16px;flex:1';
  contentDiv.innerHTML = '<div style="text-align:center;padding:24px;color:var(--muted)">⏳ Carregando…</div>';

  const headerDiv = document.createElement('div');
  headerDiv.style.cssText = 'padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between';
  headerDiv.innerHTML = '<div><div style="font-size:.95rem;font-weight:700">📊 Telemetria — ' + esc(userName) + '</div><div style="font-size:.72rem;color:var(--muted);margin-top:2px">Últimos 30 dias de atividade</div></div>';
  headerDiv.appendChild(closeBtn);

  const modal = document.createElement('div');
  modal.style.cssText = 'background:var(--surface);border-radius:var(--r-lg);max-width:560px;width:100%;max-height:80vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(0,0,0,.35)';
  modal.appendChild(headerDiv);
  modal.appendChild(contentDiv);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  try {
    const since = new Date(); since.setDate(since.getDate() - 30);
    const { data: events } = await sb.from('app_telemetry')
      .select('event_type,page,created_at,meta')
      .eq('user_id', userId)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .limit(100);

    const el = document.getElementById('_fbTelContent');
    if (!el) return;

    if (!events || !events.length) {
      el.innerHTML = '<div style="text-align:center;padding:24px;color:var(--muted);font-size:.85rem">Nenhum evento nos últimos 30 dias.</div>';
      return;
    }

    const counts = {};
    events.forEach(function(e) { counts[e.event_type] = (counts[e.event_type] || 0) + 1; });
    const topEvents = Object.entries(counts).sort(function(a,b){ return b[1]-a[1]; }).slice(0,8);

    let html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;margin-bottom:16px">';
    topEvents.forEach(function(pair) {
      html += '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;text-align:center">'
            + '<div style="font-size:1.1rem;font-weight:700;color:var(--accent)">' + pair[1] + '</div>'
            + '<div style="font-size:.68rem;color:var(--muted);margin-top:2px;word-break:break-all">' + esc(pair[0]) + '</div>'
            + '</div>';
    });
    html += '</div>';
    html += '<div style="font-size:.75rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Eventos recentes</div>';
    events.slice(0,30).forEach(function(e) {
      const dt = new Date(e.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
      html += '<div style="display:flex;align-items:baseline;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);font-size:.78rem">'
            + '<span style="color:var(--muted);flex-shrink:0;width:100px">' + dt + '</span>'
            + '<span style="font-weight:600;color:var(--text);flex-shrink:0">' + esc(e.event_type) + '</span>'
            + '<span style="color:var(--muted)">' + esc(e.page || '') + '</span>'
            + '</div>';
    });
    el.innerHTML = html;
  } catch(err) {
    const el = document.getElementById('_fbTelContent');
    if (el) el.innerHTML = '<div style="color:var(--danger,#dc2626);padding:12px">Erro: ' + err.message + '</div>';
  }
};

window._checkNewFeedbackOnLogin = _checkNewFeedbackOnLogin;
window._updateFeedbackBadge     = _updateFeedbackBadge;

// ── Visibilidade do botão Feedback: oculto para admin/owner ──────────────────
window._updateFeedbackBtnVisibility = function() {
  const btn = document.getElementById('feedbackTopbarBtn');
  if (!btn) return;
  const user = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : window.currentUser;
  const role = String(user?.role || '').toLowerCase();
  const isAdmin = role === 'admin';
  btn.style.display = isAdmin ? 'none' : 'inline-flex';
};
