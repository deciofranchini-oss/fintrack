// ── audit.js — Log de auditoria (scheduled_run_logs) ─────────────────────

async function loadAuditLogs() {
  try {
    if (!sb) { toast('Sem conexão', 'error'); return; }
    const body = document.getElementById('auditBody');
    if (body) body.innerHTML = '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:24px">⏳ Carregando…</td></tr>';

    // Filtros da UI
    const statusVal = document.getElementById('auditStatusFilter')?.value || '';
    const typeVal   = document.getElementById('auditTypeFilter')?.value   || '';
    const searchVal = (document.getElementById('auditSearch')?.value || '').toLowerCase().trim();

    // Resolve family_id (owner pode ter null)
    const fid = famId()
      || state.accounts?.find(a => a.family_id)?.family_id
      || null;

    let q = sb.from('scheduled_run_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300);

    if (fid) q = q.eq('family_id', fid);
    if (statusVal) q = q.eq('status', statusVal);
    if (typeVal)   q = q.eq('run_type', typeVal);

    const { data, error } = await q;
    if (error) throw error;

    // Atualizar contadores no header
    _updateAuditCounters(data || []);

    let rows = data || [];
    if (searchVal) {
      rows = rows.filter(r =>
        (r.description || '').toLowerCase().includes(searchVal) ||
        (r.notes       || '').toLowerCase().includes(searchVal)
      );
    }

    if (!rows.length) {
      if (body) body.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:32px">
        <div style="font-size:2rem;margin-bottom:8px;opacity:.3">🧾</div>
        <div style="color:var(--muted);font-size:.85rem">Nenhum registro encontrado</div>
      </td></tr>`;
      return;
    }

    const html = rows.map(r => {
      const status = r.status || 'confirmed';
      const badge = {
        confirmed: '<span class="audit-badge audit-badge-ok">✅ confirmada</span>',
        pending:   '<span class="audit-badge audit-badge-pend">⏳ pendente</span>',
        skipped:   '<span class="audit-badge audit-badge-skip">⏭ ignorada</span>',
        error:     '<span class="audit-badge audit-badge-err">❌ erro</span>',
      }[status] || `<span class="audit-badge">${esc(status)}</span>`;

      const typeIcon = { auto: '🤖', manual: '👤', timer: '⏰' }[r.run_type || 'auto'] || '•';
      const txLink = r.transaction_id
        ? `<button class="btn btn-ghost btn-sm" onclick="openTxDetail('${r.transaction_id}')" style="font-size:.72rem;padding:2px 8px">Abrir ↗</button>`
        : '—';

      const dt  = new Date(r.created_at);
      const ago = _timeAgo(dt);

      return `<tr class="audit-row">
        <td style="white-space:nowrap">
          <div style="font-size:.83rem;font-weight:500">${dt.toLocaleDateString('pt-BR')}</div>
          <div style="font-size:.72rem;color:var(--muted)">${ago}</div>
        </td>
        <td>
          <div style="font-size:.85rem;font-weight:500">${esc(r.description || '—')}</div>
          ${r.notes ? `<div style="font-size:.72rem;color:var(--muted);margin-top:2px">${esc(r.notes)}</div>` : ''}
        </td>
        <td style="white-space:nowrap"><span style="font-size:.9rem">${typeIcon}</span></td>
        <td>${badge}</td>
        <td style="text-align:right;white-space:nowrap;font-weight:600" class="${(r.amount||0)>=0?'amount-pos':'amount-neg'}">${fmt(Math.abs(r.amount||0))}</td>
        <td>${txLink}</td>
      </tr>`;
    }).join('');

    if (body) body.innerHTML = html;

  } catch(e) {
    console.warn('[audit]', e.message);
    const body = document.getElementById('auditBody');
    if (body) body.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:32px">
      <div style="font-size:2rem;margin-bottom:8px;opacity:.3">⚠️</div>
      <div style="color:var(--red);font-size:.85rem">Tabela não encontrada.<br>
      Execute a migration <code>migration_scheduled_run_logs.sql</code> no Supabase.</div>
    </td></tr>`;
  }
}

function _updateAuditCounters(data) {
  const total     = data.length;
  const confirmed = data.filter(r => r.status === 'confirmed').length;
  const pending   = data.filter(r => r.status === 'pending').length;
  const errors    = data.filter(r => r.status === 'error').length;

  const el = id => document.getElementById(id);
  if (el('auditCountTotal'))     el('auditCountTotal').textContent     = total;
  if (el('auditCountConfirmed')) el('auditCountConfirmed').textContent = confirmed;
  if (el('auditCountPending'))   el('auditCountPending').textContent   = pending;
  if (el('auditCountErrors'))    el('auditCountErrors').textContent    = errors;
}

// ── Re-export _timeAgo se não definido globalmente ────────────────────────
if (typeof _timeAgo === 'undefined') {
  window._timeAgo = function(dt) {
    const diff = (Date.now() - dt.getTime()) / 1000;
    if (diff < 60)     return 'agora mesmo';
    if (diff < 3600)   return `${Math.floor(diff / 60)} min atrás`;
    if (diff < 86400)  return `${Math.floor(diff / 3600)}h atrás`;
    if (diff < 604800) return `${Math.floor(diff / 86400)} dias atrás`;
    return dt.toLocaleDateString('pt-BR');
  };
}
