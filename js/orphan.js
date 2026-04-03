/* ═══════════════════════════════════════════════════════════════════════════
   ORPHAN.JS — Varredura e limpeza de registros órfãos no banco de dados
   ─────────────────────────────────────────────────────────────────────────
   Identifica registros sem vínculo válido e permite excluí-los após prévia.

   Checks realizados:
     1.  Usuários comuns sem família (app_users)
     2.  Membros sem usuário válido (family_members)
     3.  Membros sem família válida (family_members)
     4.  Famílias sem membros (families)
     5.  Contas com família inválida (accounts)
     6.  Grupos de conta com família inválida (account_groups)
     7.  Categorias com família inválida (categories)
     8.  Beneficiários com família inválida (payees)
     9.  Transações com conta inválida (transactions)
    10.  Transações com família inválida (transactions)
    11.  Orçamentos com categoria inválida (budgets)
    12.  Orçamentos com família inválida (budgets)
    13.  Transações programadas com conta inválida (scheduled_transactions)
    14.  Ocorrências sem programado pai (scheduled_occurrences)
    15.  Itens de preço com família inválida (price_items)
    16.  Histórico de preço sem item pai (price_history)
    17.  Listas de mercado com família inválida (grocery_lists)
    18.  Itens de lista sem lista pai (grocery_items)
    19.  Backups com família inválida (app_backups)
═══════════════════════════════════════════════════════════════════════════ */

// ── State ──────────────────────────────────────────────────────────────────
let _orphanResults = [];   // [{ checkId, label, table, ids, count, description, danger }]
let _orphanChecked = {};   // checkId → bool (checkbox state)

// ── Check definitions ──────────────────────────────────────────────────────
const _ORPHAN_CHECKS = [
  {
    id: 'users_no_family',
    label: 'Usuários sem família',
    table: 'app_users',
    description: 'Usuários com role diferente de admin/owner que não têm vínculo com nenhuma família.',
    danger: false,
    fetch: async () => {
      // Get all user_ids that have at least one family_members row
      const { data: members } = await sb.from('family_members').select('user_id');
      const memberedIds = new Set((members || []).map(m => m.user_id));
      const { data: users } = await sb.from('app_users')
        .select('id, name, email, role')
        .not('role', 'in', '("admin","owner")');
      return (users || []).filter(u => !memberedIds.has(u.id));
    },
    displayRow: u => `${u.name || '—'} (${u.email}) · role: ${u.role}`,
    delete: async (ids) => sb.from('app_users').delete().in('id', ids),
  },
  {
    id: 'members_invalid_user',
    label: 'Vínculos com usuário inexistente',
    table: 'family_members',
    description: 'Registros em family_members cujo user_id não existe mais em app_users.',
    danger: true,
    fetch: async () => {
      const { data: users } = await sb.from('app_users').select('id');
      const userIds = new Set((users || []).map(u => u.id));
      const { data: members } = await sb.from('family_members').select('id, user_id, family_id, role');
      return (members || []).filter(m => !userIds.has(m.user_id));
    },
    displayRow: m => `family_members.id=${m.id} · user_id=${m.user_id?.slice(0,8)}… · role=${m.role}`,
    delete: async (ids) => sb.from('family_members').delete().in('id', ids),
  },
  {
    id: 'members_invalid_family',
    label: 'Vínculos com família inexistente',
    table: 'family_members',
    description: 'Registros em family_members cujo family_id não existe mais em families.',
    danger: true,
    fetch: async () => {
      const { data: families } = await sb.from('families').select('id');
      const famIds = new Set((families || []).map(f => f.id));
      const { data: members } = await sb.from('family_members').select('id, user_id, family_id, role');
      return (members || []).filter(m => !famIds.has(m.family_id));
    },
    displayRow: m => `family_members.id=${m.id} · family_id=${m.family_id?.slice(0,8)}… · role=${m.role}`,
    delete: async (ids) => sb.from('family_members').delete().in('id', ids),
  },
  {
    id: 'families_no_members',
    label: 'Famílias sem membros',
    table: 'families',
    description: 'Famílias que não possuem nenhum usuário vinculado em family_members.',
    danger: false,
    fetch: async () => {
      const { data: members } = await sb.from('family_members').select('family_id');
      const famWithMembers = new Set((members || []).map(m => m.family_id));
      const { data: families } = await sb.from('families').select('id, name, created_at');
      return (families || []).filter(f => !famWithMembers.has(f.id));
    },
    displayRow: f => `${f.name} · criada em ${f.created_at?.slice(0,10)}`,
    delete: async (ids) => sb.from('families').delete().in('id', ids),
  },
  {
    id: 'accounts_invalid_family',
    label: 'Contas com família inválida',
    table: 'accounts',
    description: 'Contas cujo family_id não existe em families.',
    danger: true,
    fetch: async () => {
      const { data: families } = await sb.from('families').select('id');
      const famIds = new Set((families || []).map(f => f.id));
      const { data } = await sb.from('accounts').select('id, name, family_id');
      return (data || []).filter(r => !famIds.has(r.family_id));
    },
    displayRow: r => `${r.name} · family_id=${r.family_id?.slice(0,8)}…`,
    delete: async (ids) => sb.from('accounts').delete().in('id', ids),
  },
  {
    id: 'account_groups_invalid_family',
    label: 'Grupos de conta com família inválida',
    table: 'account_groups',
    description: 'Grupos de conta cujo family_id não existe em families.',
    danger: false,
    fetch: async () => {
      const { data: families } = await sb.from('families').select('id');
      const famIds = new Set((families || []).map(f => f.id));
      const { data } = await sb.from('account_groups').select('id, name, family_id');
      return (data || []).filter(r => !famIds.has(r.family_id));
    },
    displayRow: r => `${r.name} · family_id=${r.family_id?.slice(0,8)}…`,
    delete: async (ids) => sb.from('account_groups').delete().in('id', ids),
  },
  {
    id: 'categories_invalid_family',
    label: 'Categorias com família inválida',
    table: 'categories',
    description: 'Categorias cujo family_id não existe em families.',
    danger: true,
    fetch: async () => {
      const { data: families } = await sb.from('families').select('id');
      const famIds = new Set((families || []).map(f => f.id));
      const { data } = await sb.from('categories').select('id, name, family_id');
      return (data || []).filter(r => !famIds.has(r.family_id));
    },
    displayRow: r => `${r.name} · family_id=${r.family_id?.slice(0,8)}…`,
    delete: async (ids) => sb.from('categories').delete().in('id', ids),
  },
  {
    id: 'payees_invalid_family',
    label: 'Beneficiários com família inválida',
    table: 'payees',
    description: 'Beneficiários cujo family_id não existe em families.',
    danger: false,
    fetch: async () => {
      const { data: families } = await sb.from('families').select('id');
      const famIds = new Set((families || []).map(f => f.id));
      const { data } = await sb.from('payees').select('id, name, family_id');
      return (data || []).filter(r => !famIds.has(r.family_id));
    },
    displayRow: r => `${r.name} · family_id=${r.family_id?.slice(0,8)}…`,
    delete: async (ids) => sb.from('payees').delete().in('id', ids),
  },
  {
    id: 'transactions_invalid_account',
    label: 'Transações com conta inválida',
    table: 'transactions',
    description: 'Transações cujo account_id não existe em accounts.',
    danger: true,
    fetch: async () => {
      const { data: accounts } = await sb.from('accounts').select('id');
      const accIds = new Set((accounts || []).map(a => a.id));
      const { data } = await sb.from('transactions').select('id, description, account_id, date, amount');
      return (data || []).filter(r => !accIds.has(r.account_id));
    },
    displayRow: r => `${r.description || '—'} · ${r.date} · R$${r.amount} · account_id=${r.account_id?.slice(0,8)}…`,
    delete: async (ids) => sb.from('transactions').delete().in('id', ids),
  },
  {
    id: 'transactions_invalid_family',
    label: 'Transações com família inválida',
    table: 'transactions',
    description: 'Transações cujo family_id não existe em families.',
    danger: true,
    fetch: async () => {
      const { data: families } = await sb.from('families').select('id');
      const famIds = new Set((families || []).map(f => f.id));
      const { data } = await sb.from('transactions').select('id, description, family_id, date, amount');
      return (data || []).filter(r => !famIds.has(r.family_id));
    },
    displayRow: r => `${r.description || '—'} · ${r.date} · R$${r.amount} · family_id=${r.family_id?.slice(0,8)}…`,
    delete: async (ids) => sb.from('transactions').delete().in('id', ids),
  },
  {
    id: 'budgets_invalid_category',
    label: 'Orçamentos com categoria inválida',
    table: 'budgets',
    description: 'Orçamentos cujo category_id não existe em categories.',
    danger: false,
    fetch: async () => {
      const { data: cats } = await sb.from('categories').select('id');
      const catIds = new Set((cats || []).map(c => c.id));
      const { data } = await sb.from('budgets').select('id, category_id, month, amount, family_id');
      return (data || []).filter(r => !catIds.has(r.category_id));
    },
    displayRow: r => `Mês: ${r.month?.slice(0,7)} · R$${r.amount} · category_id=${r.category_id?.slice(0,8)}…`,
    delete: async (ids) => sb.from('budgets').delete().in('id', ids),
  },
  {
    id: 'budgets_invalid_family',
    label: 'Orçamentos com família inválida',
    table: 'budgets',
    description: 'Orçamentos cujo family_id não existe em families.',
    danger: false,
    fetch: async () => {
      const { data: families } = await sb.from('families').select('id');
      const famIds = new Set((families || []).map(f => f.id));
      const { data } = await sb.from('budgets').select('id, category_id, month, amount, family_id');
      return (data || []).filter(r => !famIds.has(r.family_id));
    },
    displayRow: r => `Mês: ${r.month?.slice(0,7)} · R$${r.amount} · family_id=${r.family_id?.slice(0,8)}…`,
    delete: async (ids) => sb.from('budgets').delete().in('id', ids),
  },
  {
    id: 'scheduled_invalid_account',
    label: 'Programados com conta inválida',
    table: 'scheduled_transactions',
    description: 'Transações programadas cujo account_id não existe em accounts.',
    danger: false,
    fetch: async () => {
      const { data: accounts } = await sb.from('accounts').select('id');
      const accIds = new Set((accounts || []).map(a => a.id));
      const { data } = await sb.from('scheduled_transactions')
        .select('id, description, account_id').not('account_id', 'is', null);
      return (data || []).filter(r => r.account_id && !accIds.has(r.account_id));
    },
    displayRow: r => `${r.description || '—'} · account_id=${r.account_id?.slice(0,8)}…`,
    delete: async (ids) => sb.from('scheduled_transactions').delete().in('id', ids),
  },
  {
    id: 'occurrences_invalid_scheduled',
    label: 'Ocorrências sem programado pai',
    table: 'scheduled_occurrences',
    description: 'Ocorrências em scheduled_occurrences cujo scheduled_id não existe.',
    danger: false,
    fetch: async () => {
      const { data: scheds } = await sb.from('scheduled_transactions').select('id');
      const schedIds = new Set((scheds || []).map(s => s.id));
      const { data } = await sb.from('scheduled_occurrences')
        .select('id, scheduled_id, scheduled_date, execution_status');
      return (data || []).filter(r => !schedIds.has(r.scheduled_id));
    },
    displayRow: r => `Data: ${r.scheduled_date} · status: ${r.execution_status} · scheduled_id=${r.scheduled_id?.slice(0,8)}…`,
    delete: async (ids) => sb.from('scheduled_occurrences').delete().in('id', ids),
  },
  {
    id: 'price_items_invalid_family',
    label: 'Itens de preço com família inválida',
    table: 'price_items',
    description: 'Itens de preço cujo family_id não existe em families.',
    danger: false,
    fetch: async () => {
      const { data: families } = await sb.from('families').select('id');
      const famIds = new Set((families || []).map(f => f.id));
      const { data } = await sb.from('price_items').select('id, name, family_id');
      return (data || []).filter(r => !famIds.has(r.family_id));
    },
    displayRow: r => `${r.name} · family_id=${r.family_id?.slice(0,8)}…`,
    delete: async (ids) => sb.from('price_items').delete().in('id', ids),
  },
  {
    id: 'price_history_invalid_item',
    label: 'Histórico de preço sem item pai',
    table: 'price_history',
    description: 'Registros em price_history cujo item_id não existe em price_items.',
    danger: false,
    fetch: async () => {
      const { data: items } = await sb.from('price_items').select('id');
      const itemIds = new Set((items || []).map(i => i.id));
      const { data } = await sb.from('price_history')
        .select('id, item_id, purchased_at, unit_price');
      return (data || []).filter(r => !itemIds.has(r.item_id));
    },
    displayRow: r => `Data: ${r.purchased_at} · R$${r.unit_price} · item_id=${r.item_id?.slice(0,8)}…`,
    delete: async (ids) => sb.from('price_history').delete().in('id', ids),
  },
  {
    id: 'grocery_lists_invalid_family',
    label: 'Listas de mercado com família inválida',
    table: 'grocery_lists',
    description: 'Listas de mercado cujo family_id não existe em families.',
    danger: false,
    fetch: async () => {
      const { data: families } = await sb.from('families').select('id');
      const famIds = new Set((families || []).map(f => f.id));
      const { data } = await sb.from('grocery_lists').select('id, name, family_id');
      return (data || []).filter(r => !famIds.has(r.family_id));
    },
    displayRow: r => `${r.name} · family_id=${r.family_id?.slice(0,8)}…`,
    delete: async (ids) => sb.from('grocery_lists').delete().in('id', ids),
  },
  {
    id: 'grocery_items_invalid_list',
    label: 'Itens de lista sem lista pai',
    table: 'grocery_items',
    description: 'Itens de lista cujo list_id não existe em grocery_lists.',
    danger: false,
    fetch: async () => {
      const { data: lists } = await sb.from('grocery_lists').select('id');
      const listIds = new Set((lists || []).map(l => l.id));
      const { data } = await sb.from('grocery_items').select('id, name, list_id');
      return (data || []).filter(r => !listIds.has(r.list_id));
    },
    displayRow: r => `${r.name} · list_id=${r.list_id?.slice(0,8)}…`,
    delete: async (ids) => sb.from('grocery_items').delete().in('id', ids),
  },
  {
    id: 'backups_invalid_family',
    label: 'Backups com família inválida',
    table: 'app_backups',
    description: 'Backups cujo family_id não existe em families.',
    danger: false,
    fetch: async () => {
      const { data: families } = await sb.from('families').select('id');
      const famIds = new Set((families || []).map(f => f.id));
      const { data } = await sb.from('app_backups')
        .select('id, label, family_id, created_at');
      return (data || []).filter(r => !famIds.has(r.family_id));
    },
    displayRow: r => `${r.label} · ${r.created_at?.slice(0,10)} · family_id=${r.family_id?.slice(0,8)}…`,
    delete: async (ids) => sb.from('app_backups').delete().in('id', ids),
  },
];

// ── Run scan ───────────────────────────────────────────────────────────────
async function runOrphanScan() {
  if (!currentUser?.can_admin) { toast('Acesso restrito a administradores', 'error'); return; }
  if (!sb) { toast('Sem conexão com o banco', 'error'); return; }

  const btn = document.getElementById('orphanScanBtn');
  const resultsEl = document.getElementById('orphanScanResults');
  const deleteBtn = document.getElementById('orphanDeleteBtn');

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Varrendo…'; }
  if (deleteBtn) deleteBtn.style.display = 'none';
  if (resultsEl) resultsEl.innerHTML = _orphanProgress(0, _ORPHAN_CHECKS.length);

  _orphanResults = [];
  _orphanChecked = {};

  let done = 0;
  for (const check of _ORPHAN_CHECKS) {
    try {
      const records = await check.fetch();
      if (records.length > 0) {
        const ids = records.map(r => r.id);
        _orphanResults.push({ ...check, records, ids, count: records.length });
        _orphanChecked[check.id] = true; // default: selected
      }
    } catch (e) {
      // Table may not exist (e.g. price_items if module not enabled) — skip silently
      console.warn(`[orphan] ${check.id}:`, e?.message || e);
    }
    done++;
    if (resultsEl) resultsEl.innerHTML = _orphanProgress(done, _ORPHAN_CHECKS.length);
  }

  if (btn) { btn.disabled = false; btn.textContent = '🔍 Re-executar Varredura'; }
  _renderOrphanResults();
}

function _orphanProgress(done, total) {
  const pct = total > 0 ? Math.round(done / total * 100) : 0;
  return `<div style="padding:16px 0">
    <div style="font-size:.82rem;color:var(--muted);margin-bottom:8px">
      Verificando ${done} de ${total} checks…
    </div>
    <div style="height:6px;background:var(--border);border-radius:100px;overflow:hidden">
      <div style="width:${pct}%;height:100%;background:var(--accent);border-radius:100px;transition:width .2s"></div>
    </div>
  </div>`;
}

// ── Render results ──────────────────────────────────────────────────────────
function _renderOrphanResults() {
  const el = document.getElementById('orphanScanResults');
  const deleteBtn = document.getElementById('orphanDeleteBtn');
  if (!el) return;

  const total = _orphanResults.reduce((s, r) => s + r.count, 0);

  if (!_orphanResults.length) {
    el.innerHTML = `
      <div style="text-align:center;padding:28px 0">
        <div style="font-size:2.5rem;margin-bottom:10px">✅</div>
        <div style="font-weight:700;font-size:.92rem;color:var(--text)">Nenhum registro órfão encontrado</div>
        <div style="font-size:.78rem;color:var(--muted);margin-top:4px">O banco de dados está íntegro.</div>
      </div>`;
    if (deleteBtn) deleteBtn.style.display = 'none';
    return;
  }

  if (deleteBtn) deleteBtn.style.display = '';

  const summaryColor = total > 0 ? '#dc2626' : 'var(--green)';
  let html = `
    <div style="display:flex;align-items:center;justify-content:space-between;
        padding:10px 14px;background:#fef2f2;border:1px solid #fecaca;
        border-radius:var(--r-sm);margin-bottom:12px">
      <span style="font-size:.85rem;font-weight:700;color:#991b1b">
        ⚠️ ${total} registro${total !== 1 ? 's' : ''} órfão${total !== 1 ? 's' : ''} encontrado${total !== 1 ? 's' : ''} em ${_orphanResults.length} tabela${_orphanResults.length !== 1 ? 's' : ''}
      </span>
      <label style="font-size:.78rem;cursor:pointer;display:flex;align-items:center;gap:5px;color:#991b1b">
        <input type="checkbox" id="orphanSelectAll" onchange="_orphanToggleAll(this.checked)"
          ${Object.values(_orphanChecked).every(Boolean) ? 'checked' : ''}>
        Selecionar todos
      </label>
    </div>`;

  for (const result of _orphanResults) {
    const isChecked = _orphanChecked[result.id];
    const dangerBg  = result.danger ? '#fef2f2' : '#fffbeb';
    const dangerBdr = result.danger ? '#fecaca' : '#fde68a';
    const dangerTxt = result.danger ? '#991b1b' : '#92400e';
    const dangerBadge = result.danger
      ? `<span style="font-size:.65rem;font-weight:700;padding:2px 6px;border-radius:4px;background:#fecaca;color:#991b1b;margin-left:6px">ALTO RISCO</span>`
      : '';

    // Show first 5 records, collapse the rest
    const visibleRows = result.records.slice(0, 5);
    const hiddenCount = result.records.length - 5;
    const rowsHtml = visibleRows.map(r => `
      <div style="font-size:.76rem;color:var(--text2);padding:4px 0;border-bottom:1px solid var(--border);
           font-family:var(--font-mono,'Courier New'),monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        ${esc(result.displayRow(r))}
      </div>`).join('');
    const moreHtml = hiddenCount > 0
      ? `<div style="font-size:.74rem;color:var(--muted);padding:4px 0;font-style:italic">
           … e mais ${hiddenCount} registro${hiddenCount !== 1 ? 's' : ''}
         </div>`
      : '';

    html += `
      <div style="border:1px solid ${dangerBdr};border-radius:var(--r-sm);margin-bottom:10px;overflow:hidden">
        <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:${dangerBg}">
          <input type="checkbox" id="orphanChk_${result.id}"
            ${isChecked ? 'checked' : ''}
            onchange="_orphanToggleCheck('${result.id}', this.checked)"
            style="flex-shrink:0;width:16px;height:16px;cursor:pointer">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">
              <span style="font-size:.84rem;font-weight:700;color:${dangerTxt}">${esc(result.label)}</span>
              ${dangerBadge}
            </div>
            <div style="font-size:.74rem;color:var(--muted);margin-top:2px">${esc(result.description)}</div>
          </div>
          <span style="font-size:.78rem;font-weight:700;color:${dangerTxt};flex-shrink:0;
               padding:3px 10px;border-radius:100px;background:rgba(0,0,0,.05)">
            ${result.count}
          </span>
        </div>
        <div style="padding:8px 14px;background:var(--surface2)">
          <div style="font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;
               color:var(--muted);margin-bottom:4px">tabela: ${result.table}</div>
          ${rowsHtml}${moreHtml}
        </div>
      </div>`;
  }

  el.innerHTML = html;
}

// ── Checkbox helpers ────────────────────────────────────────────────────────
function _orphanToggleCheck(checkId, checked) {
  _orphanChecked[checkId] = checked;
  // Update "select all" state
  const all = document.getElementById('orphanSelectAll');
  if (all) all.checked = Object.values(_orphanChecked).every(Boolean);
}

function _orphanToggleAll(checked) {
  for (const k of Object.keys(_orphanChecked)) _orphanChecked[k] = checked;
  // Sync all individual checkboxes
  for (const r of _orphanResults) {
    const el = document.getElementById(`orphanChk_${r.id}`);
    if (el) el.checked = checked;
  }
}

// ── Delete flow ────────────────────────────────────────────────────────────
async function confirmOrphanDelete() {
  const toDelete = _orphanResults.filter(r => _orphanChecked[r.id]);
  if (!toDelete.length) { toast('Nenhum grupo selecionado para exclusão', 'warning'); return; }

  const totalRecords = toDelete.reduce((s, r) => s + r.count, 0);
  const hasDanger = toDelete.some(r => r.danger);

  // Build confirmation message
  const summary = toDelete.map(r => `  • ${r.label}: ${r.count} registro${r.count !== 1 ? 's' : ''}`).join('\n');
  const dangerWarning = hasDanger ? '\n\n⚠️ ATENÇÃO: Alguns grupos marcados como ALTO RISCO incluem transações ou dados críticos.' : '';

  const confirmed = confirm(
    `Confirmar exclusão de ${totalRecords} registro${totalRecords !== 1 ? 's' : ''} órfão${totalRecords !== 1 ? 's' : ''}?\n\n` +
    `Grupos selecionados:\n${summary}${dangerWarning}\n\n` +
    `Esta ação é IRREVERSÍVEL. Faça um backup antes de continuar.`
  );
  if (!confirmed) return;

  // Double-confirm for dangerous checks
  if (hasDanger) {
    const confirmed2 = confirm(
      `⛔ CONFIRMAÇÃO FINAL\n\n` +
      `Você está prestes a excluir dados críticos (transações, contas ou categorias).\n` +
      `Digite "CONFIRMAR" na próxima caixa para prosseguir.`
    );
    if (!confirmed2) return;
    const typed = prompt('Digite CONFIRMAR para executar a exclusão:');
    if (typed !== 'CONFIRMAR') { toast('Exclusão cancelada — texto incorreto', 'warning'); return; }
  }

  await _doOrphanDelete(toDelete);
}

async function _doOrphanDelete(groups) {
  const btn = document.getElementById('orphanDeleteBtn');
  const scanBtn = document.getElementById('orphanScanBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Excluindo…'; }
  if (scanBtn) scanBtn.disabled = true;

  let totalDeleted = 0;
  const errors = [];

  for (const group of groups) {
    try {
      const { error } = await group.delete(group.ids);
      if (error) throw error;
      totalDeleted += group.count;
      toast(`✓ ${group.label}: ${group.count} excluído${group.count !== 1 ? 's' : ''}`, 'success');
    } catch (e) {
      errors.push(`${group.label}: ${e?.message || e}`);
    }
  }

  if (errors.length) {
    toast(`${errors.length} grupo(s) com erro. Verifique o console.`, 'error');
    errors.forEach(e => console.error('[orphan delete]', e));
  }

  if (totalDeleted > 0) {
    toast(`✓ ${totalDeleted} registro${totalDeleted !== 1 ? 's' : ''} excluído${totalDeleted !== 1 ? 's' : ''} com sucesso`, 'success');
    // Bust caches that may have orphan data
    if (typeof DB !== 'undefined') DB.bustAll();
  }

  if (btn) { btn.disabled = false; btn.textContent = '🗑 Excluir Selecionados'; }
  if (scanBtn) { scanBtn.disabled = false; scanBtn.textContent = '🔍 Re-executar Varredura'; }

  // Re-run scan to show updated state
  await runOrphanScan();
}

// ══════════════════════════════════════════════════════════════════════════════
//  ATTACHMENT ORPHAN SCANNER
// ══════════════════════════════════════════════════════════════════════════════

async function scanOrphanAttachments() {
  const btn = document.getElementById('attachScanBtn');
  const out = document.getElementById('attachScanResults');
  if (!btn || !out) return;
  if (!sb) { toast('Sem conexão', 'error'); return; }

  btn.disabled = true;
  btn.textContent = '⏳ Verificando…';
  out.innerHTML = '<div style="color:var(--muted);font-size:.82rem;padding:8px">Carregando…</div>';

  try {
    const BUCKET = 'fintrack-attachments';

    // 1. Fetch all transactions that have an attachment_url
    const { data: txRows, error: txErr } = await famQ(
      sb.from('transactions')
        .select('id, description, date, attachment_url, attachment_name, family_id')
    ).not('attachment_url', 'is', null);
    if (txErr) throw txErr;

    // 2. List all files in the bucket under transactions/
    const { data: storageList, error: stErr } = await sb.storage
      .from(BUCKET)
      .list('transactions', { limit: 1000, offset: 0 });
    // Note: this lists one level deep — each entry is a tx folder
    // We may not have enough permission for this; handle gracefully
    const storageBrowsable = !stErr && Array.isArray(storageList);

    // 3. Build a set of known storage paths from DB rows
    //    We can extract the path from the public URL:
    //    https://<proj>.supabase.co/storage/v1/object/public/BUCKET/path/file.ext
    function extractPath(url) {
      if (!url) return null;
      const marker = '/' + BUCKET + '/';
      const idx = url.indexOf(marker);
      if (idx === -1) return null;
      return decodeURIComponent(url.slice(idx + marker.length).split('?')[0]);
    }

    // 4. For each transaction with attachment_url, attempt a HEAD request to verify existence
    //    Supabase public URLs return 200 if file exists, 400/404 if not.
    const broken = [];
    const total  = (txRows || []).length;

    out.innerHTML = `<div style="color:var(--muted);font-size:.82rem;padding:8px">Verificando ${total} anexo${total !== 1 ? 's' : ''}…</div>`;

    for (let i = 0; i < (txRows || []).length; i++) {
      const tx = txRows[i];
      const url = tx.attachment_url;
      if (!url) continue;

      // Update progress every 10 items
      if (i % 10 === 0) {
        out.innerHTML = `<div style="color:var(--muted);font-size:.82rem;padding:8px">Verificando ${i + 1}/${total}…</div>`;
      }

      try {
        const res = await fetch(url, { method: 'HEAD' });
        if (!res.ok) {
          broken.push({ tx, path: extractPath(url), status: res.status });
        }
      } catch(e) {
        // Network error — treat as broken
        broken.push({ tx, path: extractPath(url), status: 'network-error' });
      }
    }

    // 5. Render results
    if (!broken.length) {
      out.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;padding:12px 14px;background:var(--accent-lt);border-radius:var(--r-sm);border:1px solid var(--accent)">
          <span style="font-size:1.1rem">✅</span>
          <span style="font-size:.84rem;color:var(--accent);font-weight:600">
            Todos os ${total} anexo${total !== 1 ? 's' : ''} verificado${total !== 1 ? 's' : ''} — nenhum órfão encontrado.
          </span>
        </div>`;
    } else {
      const rows = broken.map((b, i) => `
        <tr>
          <td style="padding:6px 8px">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
              <input type="checkbox" id="attachOrphan_${i}" checked style="width:14px;height:14px">
              <span style="font-size:.78rem;font-weight:600">${esc(b.tx.description || b.tx.id)}</span>
            </label>
            <div style="font-size:.7rem;color:var(--muted);margin-left:20px">
              ${b.tx.date} · ID: ${b.tx.id.slice(0,8)}…
              ${b.tx.attachment_name ? '· ' + esc(b.tx.attachment_name) : ''}
            </div>
            <div style="font-size:.7rem;color:var(--red);margin-left:20px;word-break:break-all">
              HTTP ${b.status} → ${esc(b.path || b.tx.attachment_url)}
            </div>
          </td>
        </tr>`).join('');

      out.innerHTML = `
        <div style="margin-bottom:10px;padding:10px 14px;background:#fff5f5;border:1px solid #fca5a5;border-radius:var(--r-sm)">
          <div style="font-size:.85rem;font-weight:700;color:var(--red);margin-bottom:4px">
            ⚠️ ${broken.length} anexo${broken.length !== 1 ? 's' : ''} órfão${broken.length !== 1 ? 's' : ''} detectado${broken.length !== 1 ? 's' : ''}
          </div>
          <div style="font-size:.75rem;color:var(--muted)">
            Estas transações têm <code>attachment_url</code> referenciando arquivos que não existem mais no Storage.
            Limpar os campos evita links quebrados na UI.
          </div>
        </div>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" onclick="fixOrphanAttachments(${JSON.stringify(broken.map((_,i)=>i))})">
            🔧 Limpar campos de anexo selecionados
          </button>
          <button class="btn btn-ghost btn-sm" onclick="
            document.querySelectorAll('[id^=attachOrphan_]').forEach(c=>c.checked=true)
          ">Selecionar todos</button>
          <button class="btn btn-ghost btn-sm" onclick="
            document.querySelectorAll('[id^=attachOrphan_]').forEach(c=>c.checked=false)
          ">Desmarcar todos</button>
        </div>`;
      // store for fix fn
      window._attachOrphanRows = broken;
    }

  } catch(e) {
    out.innerHTML = `<div style="color:var(--red);font-size:.82rem;padding:8px">Erro: ${esc(e.message || String(e))}</div>`;
    console.error('[scanOrphanAttachments]', e);
  } finally {
    btn.disabled = false;
    btn.textContent = '🔍 Verificar Anexos';
  }
}

async function fixOrphanAttachments(indices) {
  const rows = window._attachOrphanRows || [];
  // Only process checked ones
  const selected = indices.filter(i => {
    const el = document.getElementById(`attachOrphan_${i}`);
    return el?.checked;
  });
  if (!selected.length) { toast('Nenhum item selecionado', 'warning'); return; }

  const confirmed = confirm(
    `Limpar os campos attachment_url e attachment_name de ${selected.length} transação${selected.length !== 1 ? 'ões' : ''}?\n\n` +
    `Os registros de transação são mantidos. Apenas o link para o arquivo inexistente é removido.`
  );
  if (!confirmed) return;

  let fixed = 0;
  const errors = [];

  for (const i of selected) {
    const b = rows[i];
    if (!b) continue;
    try {
      const { error } = await sb.from('transactions')
        .update({ attachment_url: null, attachment_name: null })
        .eq('id', b.tx.id);
      if (error) throw error;
      fixed++;
    } catch(e) {
      errors.push(`${b.tx.id.slice(0,8)}: ${e.message}`);
    }
  }

  if (errors.length) {
    console.error('[fixOrphanAttachments] errors:', errors);
    toast(`${fixed} corrigido${fixed !== 1 ? 's' : ''}; ${errors.length} erro${errors.length !== 1 ? 's' : ''}`, 'warning');
  } else {
    toast(`✅ ${fixed} anexo${fixed !== 1 ? 's' : ''} órfão${fixed !== 1 ? 's' : ''} removido${fixed !== 1 ? 's' : ''}`, 'success');
  }

  // Re-run scan
  await scanOrphanAttachments();
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
