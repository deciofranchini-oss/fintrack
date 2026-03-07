
async function loadAuditLogs(){
  try{
    if(!sb){ toast('Sem conexão','error'); return; }
    const body = document.getElementById('auditBody');
    if(body) body.innerHTML = '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:18px">Carregando…</td></tr>';

    // Best-effort: table may not exist yet
    let q = famQ(sb.from('scheduled_run_logs').select('*').order('created_at', { ascending:false }).limit(200));
    const st = document.getElementById('auditStatusFilter')?.value || '';
    if(st) q = q.eq('status', st);

    const { data, error } = await q;
    if(error){ throw error; }

    if(!data || !data.length){
      if(body) body.innerHTML = '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:18px">Sem registros</td></tr>';
      return;
    }

    const rows = data.map(r=>{
      const st = (r.status||'confirmed');
      const badge = st==='pending'
        ? '<span class="badge" style="background:rgba(245,158,11,.16);color:var(--amber,#b45309);border:1px solid rgba(180,83,9,.18)">⏳ pendente</span>'
        : '<span class="badge" style="background:rgba(34,197,94,.14);color:var(--green,#166534);border:1px solid rgba(22,101,52,.18)">✅ confirmada</span>';
      const txLink = r.transaction_id ? `<button class="btn btn-ghost btn-sm" onclick="openTxDetail('${r.transaction_id}')" style="font-size:.75rem">Abrir</button>` : '—';
      return `<tr>
        <td class="text-muted" style="white-space:nowrap">${fmtDate(r.scheduled_date || r.created_at)}</td>
        <td>${esc(r.description||'—')}</td>
        <td>${badge}</td>
        <td style="text-align:right;white-space:nowrap" class="${(r.amount||0)>=0?'amount-pos':'amount-neg'}">${fmt(r.amount||0)}</td>
        <td>${txLink}</td>
      </tr>`;
    }).join('');

    if(body) body.innerHTML = rows;
  }catch(e){
    console.warn('[audit]', e.message);
    const body = document.getElementById('auditBody');
    if(body) body.innerHTML = '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:18px">Tabela de auditoria não encontrada. Rode a migração SQL.</td></tr>';
  }
}
