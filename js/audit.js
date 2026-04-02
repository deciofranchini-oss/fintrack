// ══════════════════════════════════════════════════════════════════════════
//  AUDIT.JS — Histórico de auto-registros de transações programadas
//  Tabela: scheduled_run_logs (preenchida por auto_register.js)
//  Visível para TODOS os usuários autenticados (não apenas admin)
// ══════════════════════════════════════════════════════════════════════════

const _auditState = {
  allRows:      [],
  filtered:     [],
  _lastStatus:  null,
  _lastMonth:   null,
  _monthsBuilt: false,
};

// ── Popula o select de meses ─────────────────────────────────────────────────
function _auditInitMonthFilter() {
  const sel = document.getElementById('auditMonthFilter');
  if (!sel || _auditState._monthsBuilt) return;
  _auditState._monthsBuilt = true;

  const now  = new Date();
  const opts = ['<option value="">Todos os meses</option>'];
  for (let i = 0; i < 13; i++) {
    const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const lbl = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    opts.push(`<option value="${val}"${i === 0 ? ' selected' : ''}>${lbl.charAt(0).toUpperCase() + lbl.slice(1)}</option>`);
  }
  sel.innerHTML = opts.join('');
  _auditState._lastMonth = sel.value;
}

// ── Entry point ──────────────────────────────────────────────────────────────
async function loadAuditLogs() {
  _auditInitMonthFilter();

  const body     = document.getElementById('auditBody');
  const cards    = document.getElementById('auditCards');
  const btn      = document.getElementById('auditRefreshBtn');
  const loading  = `<div style="text-align:center;padding:36px;color:var(--muted)">
    <div style="font-size:1.4rem;margin-bottom:8px">⏳</div>
    <div style="font-size:.85rem">Carregando registros…</div></div>`;

  if (btn)   btn.disabled = true;
  if (body)  body.innerHTML  = `<tr><td colspan="8" style="padding:0">${loading}</td></tr>`;
  if (cards) cards.innerHTML = loading;

  // FIX: ensure currentUser is available before calling famQ()
  if (!currentUser) {
    const noUser = `<div style="text-align:center;padding:36px;color:var(--muted)"><div style="font-size:1.4rem;margin-bottom:8px">🔐</div><div style="font-size:.85rem">Sessão não iniciada. Faça login novamente.</div></div>`;
    if (body)  body.innerHTML  = `<tr><td colspan="8" style="padding:0">${noUser}</td></tr>`;
    if (cards) cards.innerHTML = noUser;
    if (btn) btn.disabled = false;
    return;
  }

  try {
    if (!sb) { toast('Sem conexão com o banco', 'error'); return; }

    const { error: testErr } = await sb.from('scheduled_run_logs').select('id').limit(1);
    if (testErr) throw testErr;

    const statusFilter = document.getElementById('auditStatusFilter')?.value || '';
    const monthFilter  = document.getElementById('auditMonthFilter')?.value  || '';

    let q = famQ(
      sb.from('scheduled_run_logs')
        .select('id, family_id, scheduled_id, transaction_id, scheduled_date, status, amount, description, created_at')
        .order('created_at', { ascending: false })
        .limit(500)
    );

    if (statusFilter) q = q.eq('status', statusFilter);
    if (monthFilter) {
      const [y, m] = monthFilter.split('-');
      const last = new Date(+y, +m, 0).getDate();
      q = q.gte('scheduled_date', `${y}-${m}-01`)
           .lte('scheduled_date', `${y}-${m}-${String(last).padStart(2,'0')}`);
    }

    const { data, error } = await q;
    if (error) throw error;

    // Fetch scheduled_transactions separately to avoid FK schema cache issue (PGRST200)
    let rows = data || [];
    const schedIds = [...new Set(rows.map(r => r.scheduled_id).filter(Boolean))];
    if (schedIds.length > 0) {
      const { data: scData } = await sb
        .from('scheduled_transactions')
        .select('id, description, frequency, type, category_id, categories:category_id(name)')
        .in('id', schedIds);
      if (scData) {
        const scMap = Object.fromEntries(scData.map(s => [s.id, s]));
        rows = rows.map(r => ({ ...r, scheduled_transactions: scMap[r.scheduled_id] || null }));
      }
    }

    // Try to fetch notification columns (added in v48 migration — may not exist yet)
    const logIds = rows.map(r => r.id).filter(Boolean);
    if (logIds.length > 0) {
      try {
        const { data: notifData, error: notifErr } = await sb
          .from('scheduled_run_logs')
          .select('id, notif_email_sent, notif_wa_sent, notif_tg_sent, notif_email_addr, notif_wa_number, notif_tg_chat_id, notif_error')
          .in('id', logIds);
        if (!notifErr && notifData) {
          const notifMap = Object.fromEntries(notifData.map(n => [n.id, n]));
          rows = rows.map(r => ({ ...r, ...notifMap[r.id] }));
        }
        // If column doesn't exist yet (notifErr), rows keep null notif fields — _auditNotifBadge handles gracefully
      } catch(_) { /* notification columns not yet migrated — silently skip */ }
    }

    _auditState.allRows    = rows;
    _auditState._lastStatus = statusFilter;
    _auditState._lastMonth  = monthFilter;

    _updateAuditCounters(_auditState.allRows);
    _auditApplyLocalFilters();

  } catch (e) {
    console.warn('[audit]', e.message);
    const isTableMissing = /relation.*does not exist/i.test(e.message || '');
    const errHtml = isTableMissing
      ? `<div style="margin:12px;padding:18px 20px;background:var(--amber-lt);border:1.5px solid var(--amber);border-radius:var(--r);font-size:.85rem;line-height:1.7">
          <div style="font-weight:700;color:var(--amber);margin-bottom:10px">⚠️ Tabela <code>scheduled_run_logs</code> não encontrada</div>
          <div style="color:var(--text2);margin-bottom:12px">Execute o SQL abaixo no <strong>Supabase SQL Editor</strong> para criar a tabela:</div>
          <pre style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r-sm);padding:12px;font-size:.7rem;overflow-x:auto;white-space:pre;color:var(--text);user-select:all">${_auditMigrationSql()}</pre>
          <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
            <button class="btn btn-primary btn-sm" onclick="_copyAuditMigration()">📋 Copiar SQL</button>
            <button class="btn btn-ghost btn-sm" onclick="window.open('https://supabase.com/dashboard','_blank')">🔗 Supabase</button>
            <button class="btn btn-ghost btn-sm" onclick="loadAuditLogs()">↻ Tentar novamente</button>
          </div></div>`
      : `<div style="text-align:center;padding:28px;color:var(--danger);font-size:.85rem">
          ⚠️ Erro ao carregar auditoria: ${esc(e.message)}
          <br><button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="loadAuditLogs()">↻ Tentar novamente</button></div>`;

    if (body)  body.innerHTML  = `<tr><td colspan="8" style="padding:0">${errHtml}</td></tr>`;
    if (cards) cards.innerHTML = errHtml;
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Filtro local (busca por texto) ────────────────────────────────────────────
function _auditApplyLocalFilters() {
  const countEl  = document.getElementById('auditCount');
  const footerEl = document.getElementById('auditFooterCount');
  const search   = (document.getElementById('auditSearch')?.value || '').toLowerCase().trim();

  let rows = _auditState.allRows;
  if (search) {
    rows = rows.filter(r => {
      const desc  = (r.description || '').toLowerCase();
      const sched = (r.scheduled_transactions?.description || '').toLowerCase();
      const cat   = (r.scheduled_transactions?.categories?.name || '').toLowerCase();
      return desc.includes(search) || sched.includes(search) || cat.includes(search);
    });
  }
  _auditState.filtered = rows;

  const total = rows.length;
  if (countEl)  countEl.textContent  = total > 0 ? `${total} registro${total !== 1 ? 's' : ''}` : '';
  if (footerEl) footerEl.textContent = total > 0 ? `${total} de ${_auditState.allRows.length}` : '';

  const empty = (msg) => `
    <div style="text-align:center;padding:48px;color:var(--muted)">
      <div style="font-size:2rem;margin-bottom:10px">📋</div>
      <div style="font-size:.85rem">${msg}</div>
    </div>`;

  if (!total) {
    const msg = search || document.getElementById('auditStatusFilter')?.value || document.getElementById('auditMonthFilter')?.value
      ? 'Nenhum registro encontrado com esses filtros.'
      : 'Nenhum auto-registro ainda. Execute uma transação programada automática para ver os logs aqui.';
    const body  = document.getElementById('auditBody');
    const cards = document.getElementById('auditCards');
    if (body)  body.innerHTML  = `<tr><td colspan="8" style="padding:0">${empty(msg)}</td></tr>`;
    if (cards) cards.innerHTML = empty(msg);
    return;
  }

  // Renderiza tabela desktop
  const body = document.getElementById('auditBody');
  if (body) body.innerHTML = rows.map(r => _auditRowDesktop(r)).join('');

  // Renderiza cards mobile
  const cards = document.getElementById('auditCards');
  if (cards) cards.innerHTML = rows.map(r => _auditRowMobile(r)).join('');
}

// ── Clique nos KPI counters ───────────────────────────────────────────────────
function auditSetStatus(status) {
  const sel = document.getElementById('auditStatusFilter');
  if (sel) { sel.value = status; loadAuditLogs(); }
}
window.auditSetStatus = auditSetStatus;

// ── Atualiza contadores ───────────────────────────────────────────────────────
function _updateAuditCounters(data) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('auditCntTotal',     data.length);
  set('auditCntConfirmed', data.filter(r => r.status === 'confirmed').length);
  set('auditCntPending',   data.filter(r => r.status === 'pending').length);
  set('auditCntError',     data.filter(r => r.status === 'error').length);
}

// ── Helpers partilhados ───────────────────────────────────────────────────────
function _auditStatusBadge(status) {
  return {
    confirmed: `<span class="audit-status-badge audit-ok">✅ Confirmada</span>`,
    pending:   `<span class="audit-status-badge audit-pending">⏳ Pendente</span>`,
    error:     `<span class="audit-status-badge audit-error">❌ Erro</span>`,
  }[status || 'confirmed'] || `<span class="audit-status-badge audit-ok">✅ Confirmada</span>`;
}

function _auditFreqLabel(freq) {
  return { once:'Único', weekly:'Semanal', biweekly:'Quinzenal', monthly:'Mensal',
           bimonthly:'Bimestral', quarterly:'Trimestral', semiannual:'Semestral',
           annual:'Anual', custom:'Custom' }[freq] || freq || '—';
}

function _auditTxLink(txId) {
  return txId
    ? `<button class="btn btn-ghost btn-sm" onclick="openTxDetail('${txId}')"
        style="font-size:.72rem;padding:3px 8px" title="Ver transação">🔍 Ver</button>`
    : `<span style="color:var(--muted);font-size:.78rem">—</span>`;
}

// ── Notification badge helper ────────────────────────────────────────────────
function _auditNotifBadge(r) {
  const parts = [];
  // Email
  if (r.notif_email_sent) {
    const to = r.notif_email_addr ? ` → ${esc(r.notif_email_addr)}` : '';
    parts.push(`<span class="audit-notif-badge audit-notif-email" title="E-mail enviado${r.notif_email_addr?' para '+r.notif_email_addr:''}">✉️ Email${to}</span>`);
  }
  // WhatsApp
  if (r.notif_wa_sent !== undefined && r.notif_wa_sent !== null) {
    const to = r.notif_wa_number ? ` +${esc(r.notif_wa_number)}` : '';
    const ok = r.notif_wa_sent === true || r.notif_wa_sent === 'sent';
    const icon = ok ? '✅' : '❌';
    const cls  = ok ? 'audit-notif-wa-ok' : 'audit-notif-wa-err';
    parts.push(`<span class="audit-notif-badge ${cls}" title="WhatsApp${to}: ${ok?'enviado':'falhou'}">${icon} WA${to}</span>`);
  }
  // Telegram
  if (r.notif_tg_sent !== undefined && r.notif_tg_sent !== null) {
    const to = r.notif_tg_chat_id ? ` @${esc(r.notif_tg_chat_id)}` : '';
    const ok = r.notif_tg_sent === true || r.notif_tg_sent === 'sent';
    const icon = ok ? '✅' : '❌';
    const cls  = ok ? 'audit-notif-tg-ok' : 'audit-notif-tg-err';
    parts.push(`<span class="audit-notif-badge ${cls}" title="Telegram${to}: ${ok?'enviado':'falhou'}">${icon} TG${to}</span>`);
  }
  // No notification at all
  if (!parts.length) {
    return `<span class="audit-notif-badge audit-notif-none" title="Sem notificação configurada">— sem notificação</span>`;
  }
  return parts.join('');
}

// ── Linha da tabela desktop ───────────────────────────────────────────────────
function _auditRowDesktop(r) {
  const sc       = r.scheduled_transactions;
  const mainDesc = sc?.description || r.description || '—';
  const runDesc  = (r.description && r.description !== mainDesc) ? r.description : null;
  const catName  = sc?.categories?.name || null;
  const typeIcon = { expense:'💸', income:'💰', transfer:'↔️', card_payment:'💳' }[sc?.type || ''] || '';
  const amount   = r.amount ?? 0;
  const createdAt = r.created_at
    ? new Date(r.created_at).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' })
    : '—';

  return `<tr class="audit-tr-${r.status || 'confirmed'}">
    <td style="white-space:nowrap;font-size:.82rem;color:var(--text2)">${fmtDate(r.scheduled_date || r.created_at)}</td>
    <td style="max-width:220px">
      <div style="font-weight:600;font-size:.875rem;color:var(--text)">${typeIcon} ${esc(mainDesc)}</div>
      ${catName  ? `<div style="font-size:.72rem;color:var(--accent);margin-top:1px">📁 ${esc(catName)}</div>` : ''}
      ${runDesc  ? `<div style="font-size:.72rem;color:var(--muted);margin-top:1px">${esc(runDesc)}</div>` : ''}
    </td>
    <td style="font-size:.78rem;color:var(--muted);white-space:nowrap">${_auditFreqLabel(sc?.frequency)}</td>
    <td>${_auditStatusBadge(r.status)}</td>
    <td><div style="display:flex;flex-wrap:wrap;gap:3px;align-items:center">${_auditNotifBadge(r)}</div>${r.notif_error?`<div style="font-size:.68rem;color:var(--red);margin-top:2px" title="${esc(r.notif_error)}">⚠️ ${esc(r.notif_error.slice(0,40))}…</div>`:''}</td>
    <td style="text-align:right;white-space:nowrap;font-weight:700"
        class="${amount >= 0 ? 'amount-pos' : 'amount-neg'}">${fmt(amount)}</td>
    <td style="font-size:.74rem;color:var(--muted);white-space:nowrap">${createdAt}</td>
    <td style="text-align:center">${_auditTxLink(r.transaction_id)}</td>
  </tr>`;
}

// ── Card mobile ───────────────────────────────────────────────────────────────
function _auditRowMobile(r) {
  const sc       = r.scheduled_transactions;
  const mainDesc = sc?.description || r.description || '—';
  const catName  = sc?.categories?.name || null;
  const typeIcon = { expense:'💸', income:'💰', transfer:'↔️', card_payment:'💳' }[sc?.type || ''] || '';
  const amount   = r.amount ?? 0;
  const amtClass = amount >= 0 ? 'amount-pos' : 'amount-neg';
  const date     = fmtDate(r.scheduled_date || r.created_at);
  const statusCls = r.status === 'pending' ? 'aud-card-pending'
                  : r.status === 'error'   ? 'aud-card-error' : '';

  return `<div class="aud-card ${statusCls}">
    <div class="aud-card-head">
      <div class="aud-card-title">${typeIcon} ${esc(mainDesc)}</div>
      <div class="aud-card-amt ${amtClass}">${fmt(amount)}</div>
    </div>
    <div class="aud-card-meta">
      ${_auditStatusBadge(r.status)}
      <span>📅 ${date}</span>
      ${_auditFreqLabel(sc?.frequency) !== '—' ? `<span>🔁 ${_auditFreqLabel(sc?.frequency)}</span>` : ''}
      ${catName ? `<span class="aud-card-cat">📁 ${esc(catName)}</span>` : ''}
    </div>
    <div class="aud-card-notif">${_auditNotifBadge(r)}</div>
    <div class="aud-card-meta" style="margin-top:4px">
      <span style="margin-left:auto">${_auditTxLink(r.transaction_id)}</span>
    </div>
  </div>`;
}

// ── filterAuditLogs — chamado pela UI ─────────────────────────────────────────
function filterAuditLogs() {
  const status = document.getElementById('auditStatusFilter')?.value || '';
  const month  = document.getElementById('auditMonthFilter')?.value  || '';
  // Se status ou mês mudou precisa recarregar do servidor
  if (status !== _auditState._lastStatus || month !== _auditState._lastMonth) {
    _auditState._lastStatus = status;
    _auditState._lastMonth  = month;
    loadAuditLogs();
  } else {
    _auditApplyLocalFilters();
  }
}

// ── SQL migration ─────────────────────────────────────────────────────────────
function _auditMigrationSql() {
  return `CREATE TABLE IF NOT EXISTS public.scheduled_run_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id        UUID REFERENCES public.families(id) ON DELETE CASCADE,
  scheduled_id     UUID REFERENCES public.scheduled_transactions(id) ON DELETE SET NULL,
  transaction_id   UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  scheduled_date   DATE,
  status           TEXT NOT NULL DEFAULT 'confirmed'
                     CHECK (status IN ('confirmed','pending','error')),
  amount           NUMERIC(14,2),
  description      TEXT,
  notes            TEXT,
  notif_email_sent BOOLEAN,
  notif_wa_sent    TEXT,
  notif_tg_sent    TEXT,
  notif_email_addr TEXT,
  notif_wa_number  TEXT,
  notif_tg_chat_id TEXT,
  notif_error      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Adiciona colunas de notificação caso a tabela já exista sem elas
ALTER TABLE public.scheduled_run_logs ADD COLUMN IF NOT EXISTS notes            TEXT;
ALTER TABLE public.scheduled_run_logs ADD COLUMN IF NOT EXISTS notif_email_sent BOOLEAN;
ALTER TABLE public.scheduled_run_logs ADD COLUMN IF NOT EXISTS notif_wa_sent    TEXT;
ALTER TABLE public.scheduled_run_logs ADD COLUMN IF NOT EXISTS notif_tg_sent    TEXT;
ALTER TABLE public.scheduled_run_logs ADD COLUMN IF NOT EXISTS notif_email_addr TEXT;
ALTER TABLE public.scheduled_run_logs ADD COLUMN IF NOT EXISTS notif_wa_number  TEXT;
ALTER TABLE public.scheduled_run_logs ADD COLUMN IF NOT EXISTS notif_tg_chat_id TEXT;
ALTER TABLE public.scheduled_run_logs ADD COLUMN IF NOT EXISTS notif_error      TEXT;
-- Adiciona colunas de notificação em app_users (preferências de notificação por transação)
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS notify_on_tx    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS notify_tx_email BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS notify_tx_wa    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS notify_tx_tg    BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_srl_family  ON public.scheduled_run_logs(family_id);
CREATE INDEX IF NOT EXISTS idx_srl_created ON public.scheduled_run_logs(created_at DESC);
ALTER TABLE public.scheduled_run_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "srl_family_access" ON public.scheduled_run_logs;
CREATE POLICY "srl_family_access" ON public.scheduled_run_logs
  USING (
    family_id IN (SELECT family_id FROM public.family_members WHERE user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.app_users WHERE id = auth.uid() AND role IN ('admin','owner'))
  );`.replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _copyAuditMigration() {
  const sql = _auditMigrationSql().replace(/&lt;/g,'<').replace(/&gt;/g,'>');
  navigator.clipboard.writeText(sql)
    .then(() => toast('SQL copiado!', 'success'))
    .catch(() => toast('Selecione o texto acima e copie manualmente', 'info'));
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

window.loadAuditLogs = loadAuditLogs;
window.filterAuditLogs = filterAuditLogs;
