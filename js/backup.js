// ── backup.js — Backup local (JSON) + Backup no banco (Supabase) ───────────

const BACKUP_VERSION = '5.0';

const BACKUP_TABLES = [
  // ── Core structure ─────────────────────────────────────────────────────
  'families',
  'family_preferences',
  'family_settings',
  'family_members',
  'family_composition',
  'family_member_restrictions',
  // ── Financial base ─────────────────────────────────────────────────────
  'account_groups',
  'accounts',
  'iof_settings',
  'categories',
  'payees',
  'financial_objectives',
  'transactions',
  'tx_reimbursements',
  'budgets',
  // ── Scheduled ──────────────────────────────────────────────────────────
  'scheduled_transactions',
  'scheduled_occurrences',
  'scheduled_run_logs',
  'scheduled_ar_records',
  // ── Prices & Grocery ───────────────────────────────────────────────────
  'price_items',
  'price_stores',
  'price_history',
  'grocery_lists',
  'grocery_items',
  // ── Debts ──────────────────────────────────────────────────────────────
  'debts',
  'debt_ledger',
  // ── Investments ────────────────────────────────────────────────────────
  'investment_positions',
  'investment_transactions',
  'investment_price_history',
  // ── Dreams ─────────────────────────────────────────────────────────────
  'dreams',
  'dream_items',
  'dream_contributions',
  // ── Loyalty ────────────────────────────────────────────────────────────
  'loyalty_programs',
  'loyalty_transactions',
  // ── AI ─────────────────────────────────────────────────────────────────
  'ai_insight_snapshots',
  'ai_insight_recommendations',
  'ai_insight_simulations',
  // ── Bot memory ─────────────────────────────────────────────────────────
  'user_behavior_memory',
  // ── Attachments ────────────────────────────────────────────────────────
  'attachments',
  // ── Investment portfolios/wallets ───────────────────────────────────────
  'investment_portfolios',
  'investment_wallets',
  'investment_wallet_positions',
  // ── Family invites ──────────────────────────────────────────────────────
  'family_invites',
  // ── Agent & chat ────────────────────────────────────────────────────────
  'agent_conversations',
  'chat_pending_actions',
  // ── Scheduled notifications ─────────────────────────────────────────────
  'scheduled_notification_logs',
];

const BACKUP_RELATIONS = [
  ['family_members', 'family_id', 'families'],
  ['account_groups', 'family_id', 'families'],
  ['accounts', 'family_id', 'families'],
  ['accounts', 'group_id', 'account_groups'],
  ['categories', 'family_id', 'families'],
  ['categories', 'parent_id', 'categories'],
  ['payees', 'family_id', 'families'],
  ['payees', 'default_category_id', 'categories'],
  ['transactions', 'family_id', 'families'],
  ['transactions', 'account_id', 'accounts'],
  ['transactions', 'payee_id', 'payees'],
  ['transactions', 'category_id', 'categories'],
  ['transactions', 'transfer_to_account_id', 'accounts'],
  ['transactions', 'linked_transfer_id', 'transactions'],
  ['transactions', 'transfer_pair_id', 'transactions'],
  ['budgets', 'family_id', 'families'],
  ['budgets', 'category_id', 'categories'],
  ['scheduled_transactions', 'family_id', 'families'],
  ['scheduled_transactions', 'account_id', 'accounts'],
  ['scheduled_transactions', 'payee_id', 'payees'],
  ['scheduled_transactions', 'category_id', 'categories'],
  ['scheduled_transactions', 'transfer_to_account_id', 'accounts'],
  ['scheduled_occurrences', 'scheduled_id', 'scheduled_transactions'],
  ['scheduled_occurrences', 'transaction_id', 'transactions'],
  ['scheduled_run_logs', 'family_id', 'families'],
  ['scheduled_run_logs', 'scheduled_id', 'scheduled_transactions'],
  ['scheduled_run_logs', 'transaction_id', 'transactions'],
  ['price_items', 'family_id', 'families'],
  ['price_items', 'category_id', 'categories'],
  ['price_stores', 'family_id', 'families'],
  ['price_stores', 'payee_id', 'payees'],
  ['price_history', 'family_id', 'families'],
  ['price_history', 'item_id', 'price_items'],
  ['price_history', 'store_id', 'price_stores'],
];

let _dbBackupList = [];

function _backupTableRows(d, table) { return Array.isArray(d?.[table]) ? d[table] : []; }
function _nonnull(v) { return v !== null && v !== undefined && v !== ''; }
function _arr(v) { return Array.isArray(v) ? v : []; }
function _chunk(arr, size = 200) { const out = []; for (let i=0;i<arr.length;i+=size) out.push(arr.slice(i, i+size)); return out; }
function _backupStatus(el, msg, color) { if (!el) return; el.textContent = msg || ''; if (color) el.style.color = color; }

async function _resolveActiveFamilyId() {
  let fid = famId?.() || currentUser?.preferred_family_id || currentUser?.family_id || null;
  if (fid) return fid;

  const familyCandidates = _arr(currentUser?.families || []);
  if (familyCandidates.length === 1) return familyCandidates[0].id;
  const preferred = familyCandidates.find(f => f.id === currentUser?.preferred_family_id);
  if (preferred) return preferred.id;

  const fromState =
    state?.accounts?.find(a => a.family_id)?.family_id ||
    state?.categories?.find(c => c.family_id)?.family_id ||
    state?.payees?.find(p => p.family_id)?.family_id ||
    state?.transactions?.find(t => t.family_id)?.family_id ||
    null;
  if (fromState) return fromState;

  try {
    const { data } = await sb.from('families').select('id').limit(1).maybeSingle();
    return data?.id || null;
  } catch (_) {
    return null;
  }
}

async function _collectFamilyBackupPayload(fid) {
  // qf: executes query and returns a real Promise (await resolves Supabase builder)
  const qf   = async (table) => { try { return await sb.from(table).select('*').eq('family_id', fid); } catch(_) { return { data: [] }; } };
  // safe: wraps any Supabase builder call (which may not be a real Promise) in try/catch
  const safe = async (p) => { try { return await p; } catch(_) { return { data: [] }; } };

  // ── Batch 1: Core tables (all use family_id) ─────────────────────────────
  const [
    familiesRes, familyPrefsRes, familySettingsRes, membersRes, compositionRes,
    memberRestrictionsRes, groupsRes, accountsRes, iofSettingsRes,
    categoriesRes, payeesRes, objectivesRes, txRes, budgetsRes, schedRes,
    priceItemsRes, priceStoresRes, debtsRes, groceryListsRes,
    invPositionsRes, dreamsRes, loyaltyProgramsRes, aiSnapshotsRes,
    invPortfoliosRes, invWalletsRes, familyInvitesRes,
    agentConvRes, chatPendingRes, schedNotifLogsRes,
  ] = await Promise.all([
    sb.from('families').select('*').eq('id', fid).limit(1),
    safe(sb.from('family_preferences').select('*').eq('family_id', fid)),
    safe(qf('family_settings')),
    sb.from('family_members').select('*').eq('family_id', fid),
    safe(qf('family_composition')),
    safe(qf('family_member_restrictions')),
    safe(qf('account_groups')),
    qf('accounts'),
    safe(sb.from('iof_settings').select('*').eq('family_id', fid)),
    qf('categories'),
    qf('payees'),
    safe(qf('financial_objectives')),
    qf('transactions'),
    qf('budgets'),
    qf('scheduled_transactions'),
    safe(qf('price_items')),
    safe(qf('price_stores')),
    safe(qf('debts')),
    safe(qf('grocery_lists')),
    safe(qf('investment_positions')),
    safe(qf('dreams')),
    safe(qf('loyalty_programs')),
    safe(qf('ai_insight_snapshots')),
    // Extra tables
    safe(qf('investment_portfolios')),
    safe(qf('investment_wallets')),
    safe(qf('family_invites')),
    safe(qf('agent_conversations')),
    safe(qf('chat_pending_actions')),
    safe(qf('scheduled_notification_logs')),
  ]);

  const scheduledIds    = _arr(schedRes.data).map(r => r.id);
  const transactionIds  = _arr(txRes.data).map(r => r.id);
  const priceItemIds    = _arr(priceItemsRes.data).map(r => r.id);
  const priceStoreIds   = _arr(priceStoresRes.data).map(r => r.id);
  const debtIds         = _arr(debtsRes.data).map(r => r.id);
  const groceryListIds  = _arr(groceryListsRes.data).map(r => r.id);
  const invPositionIds  = _arr(invPositionsRes.data).map(r => r.id);
  const invWalletIds    = _arr(invWalletsRes.data).map(r => r.id);
  const dreamIds        = _arr(dreamsRes.data).map(r => r.id);
  const loyaltyIds      = _arr(loyaltyProgramsRes.data).map(r => r.id);
  const aiSnapshotIds   = _arr(aiSnapshotsRes.data).map(r => r.id);

  // ── Batch 2: Secondary tables (depend on primary IDs) ────────────────────
  const inQ = (table, col, ids) => ids.length
    ? safe(sb.from(table).select('*').in(col, ids))
    : Promise.resolve({ data: [] });

  const [
    occRes, runLogRes, schedArRes,
    priceHistoryRes, debtLedgerRes,
    invTxRes, invPriceRes, groceryItemsRes,
    dreamItemsRes, dreamContribRes, loyaltyTxRes,
    aiRecsRes, aiSimsRes,
    txReimbRes, attachmentsRes,
    behaviorMemRes, invWalletPositionsRes,
  ] = await Promise.all([
    inQ('scheduled_occurrences',  'scheduled_id',  scheduledIds),
    safe(sb.from('scheduled_run_logs').select('*').eq('family_id', fid)),
    inQ('scheduled_ar_records',   'sc_id',         scheduledIds),
    safe(sb.from('price_history').select('*').eq('family_id', fid)),
    inQ('debt_ledger',            'debt_id',        debtIds),
    inQ('investment_transactions','position_id',    invPositionIds),
    inQ('investment_price_history','position_id',   invPositionIds),
    inQ('grocery_items',          'list_id',        groceryListIds),
    inQ('dream_items',            'dream_id',       dreamIds),
    inQ('dream_contributions',    'dream_id',       dreamIds),
    inQ('loyalty_transactions',   'program_id',     loyaltyIds),
    inQ('ai_insight_recommendations','snapshot_id', aiSnapshotIds),
    inQ('ai_insight_simulations', 'base_snapshot_id', aiSnapshotIds),
    safe(sb.from('tx_reimbursements').select('*').eq('family_id', fid)),
    safe(qf('attachments')),
    safe(sb.from('user_behavior_memory').select('*').eq('family_id', fid)),
    inQ('investment_wallet_positions', 'wallet_id', invWalletIds),
  ]);

  const payload = {
    // Core
    families:                   _arr(familiesRes.data),
    family_preferences:         _arr(familyPrefsRes.data),
    family_settings:            _arr(familySettingsRes.data),
    family_members:             _arr(membersRes.data),
    family_composition:         _arr(compositionRes.data),
    family_member_restrictions: _arr(memberRestrictionsRes.data),
    // Accounts
    account_groups:             _arr(groupsRes.data),
    accounts:                   _arr(accountsRes.data),
    iof_settings:               _arr(iofSettingsRes.data),
    // Finance
    categories:                 _arr(categoriesRes.data),
    payees:                     _arr(payeesRes.data),
    financial_objectives:       _arr(objectivesRes.data),
    transactions:               _arr(txRes.data),
    tx_reimbursements:          _arr(txReimbRes.data),
    budgets:                    _arr(budgetsRes.data),
    // Scheduled
    scheduled_transactions:     _arr(schedRes.data),
    scheduled_occurrences:      _arr(occRes.data),
    scheduled_run_logs:         _arr(runLogRes.data),
    scheduled_ar_records:       _arr(schedArRes.data),
    // Prices
    price_items:                _arr(priceItemsRes.data),
    price_stores:               _arr(priceStoresRes.data),
    price_history:              _arr(priceHistoryRes.data),
    grocery_lists:              _arr(groceryListsRes.data),
    grocery_items:              _arr(groceryItemsRes.data),
    // Debts
    debts:                      _arr(debtsRes.data),
    debt_ledger:                _arr(debtLedgerRes.data),
    // Investments
    investment_positions:       _arr(invPositionsRes.data),
    investment_transactions:    _arr(invTxRes.data),
    investment_price_history:   _arr(invPriceRes.data),
    // Dreams
    dreams:                     _arr(dreamsRes.data),
    dream_items:                _arr(dreamItemsRes.data),
    dream_contributions:        _arr(dreamContribRes.data),
    // Loyalty
    loyalty_programs:           _arr(loyaltyProgramsRes.data),
    loyalty_transactions:       _arr(loyaltyTxRes.data),
    // AI
    ai_insight_snapshots:       _arr(aiSnapshotsRes.data),
    ai_insight_recommendations: _arr(aiRecsRes.data),
    ai_insight_simulations:     _arr(aiSimsRes.data),
    // Bot memory
    user_behavior_memory:       _arr(behaviorMemRes.data),
    // Attachments
    attachments:                _arr(attachmentsRes.data),
    // Investment portfolios / wallets
    investment_portfolios:          _arr(invPortfoliosRes.data),
    investment_wallets:             _arr(invWalletsRes.data),
    investment_wallet_positions:    _arr(invWalletPositionsRes.data),
    // Family invites & agent
    family_invites:                 _arr(familyInvitesRes.data),
    agent_conversations:            _arr(agentConvRes.data),
    chat_pending_actions:           _arr(chatPendingRes.data),
    // Scheduled notifications
    scheduled_notification_logs:    _arr(schedNotifLogsRes.data),
  };

  const counts = {};
  BACKUP_TABLES.forEach(t => { counts[t] = payload[t]?.length || 0; });
  counts.scheduled = counts.scheduled_transactions || 0;
  counts.transactions = counts.transactions || 0;
  counts.accounts = counts.accounts || 0;
  counts.categories = counts.categories || 0;

  return { payload, counts };
}

function _backupHeader(fid, counts) {
  return {
    version: BACKUP_VERSION,
    app: 'JF Family FinTrack',
    family_id: fid,
    exported_at: new Date().toISOString(),
    counts,
  };
}


async function _analyzeBackupObject(backup) {
  const data = backup?.data || {};
  const report = {
    version: backup?.version || null,
    family_id: backup?.family_id || null,
    summary: {},
    errors: [],
    warnings: [],
    tableStats: [],
    relationIssues: [],
    duplicateIds: [],
  };

  if (!backup?.version || !backup?.data) report.errors.push('Arquivo de backup inválido ou incompleto.');

  const idMaps = {};
  BACKUP_TABLES.forEach(table => {
    const rows = _backupTableRows(data, table);
    const ids = new Set();
    let dupCount = 0;
    rows.forEach(row => {
      if (!_nonnull(row?.id)) return;
      if (ids.has(row.id)) dupCount++;
      ids.add(row.id);
    });
    idMaps[table] = ids;
    report.tableStats.push({ table, total: rows.length, duplicates: dupCount });
    if (dupCount) report.duplicateIds.push({ table, count: dupCount });
  });

  const families = _backupTableRows(data, 'families');
  const familyIdsInRows = new Set();
  BACKUP_TABLES.forEach(table => {
    _backupTableRows(data, table).forEach(row => {
      if (_nonnull(row?.family_id)) familyIdsInRows.add(row.family_id);
    });
  });

  if (!families.length) {
    report.warnings.push('O backup não contém a tabela families. A pré-validação vai usar o family_id do cabeçalho/linhas e o banco atual como referência.');
    if (_nonnull(backup?.family_id)) idMaps.families.add(backup.family_id);
    familyIdsInRows.forEach(fid => idMaps.families.add(fid));
  }
  if (!_backupTableRows(data, 'family_members').length) report.warnings.push('O backup não contém vínculos em family_members.');

  const existingCache = {};
  async function existingIdsFor(table, ids) {
    const cleanIds = [...new Set((ids || []).filter(_nonnull))];
    if (!cleanIds.length) return new Set();
    if (!existingCache[table]) existingCache[table] = new Set();
    const out = new Set();
    const missing = cleanIds.filter(id => !existingCache[table].has(id));
    if (missing.length) {
      try {
        for (const chunk of _chunk(missing, 200)) {
          const { data: found } = await sb.from(table).select('id').in('id', chunk);
          (found || []).forEach(r => existingCache[table].add(r.id));
        }
      } catch (_) {}
    }
    cleanIds.forEach(id => { if (existingCache[table].has(id)) out.add(id); });
    return out;
  }

  for (const [table, column, targetTable] of BACKUP_RELATIONS) {
    const rows = _backupTableRows(data, table);
    const refs = [...new Set(rows.map(row => row?.[column]).filter(_nonnull))];
    const existing = await existingIdsFor(targetTable, refs);
    let count = 0;
    const examples = [];
    rows.forEach(row => {
      const ref = row?.[column];
      if (!_nonnull(ref)) return;
      const okInBackup = idMaps[targetTable]?.has(ref);
      const okInDb = existing.has(ref);
      if (!okInBackup && !okInDb) {
        count++;
        if (examples.length < 5) examples.push(`${row.id || 'sem-id'} → ${ref}`);
      }
    });
    if (count) {
      const issue = { table, column, targetTable, count, examples };
      report.relationIssues.push(issue);
      const isLegacyFamilyGap = targetTable === 'families' && !families.length && familyIdsInRows.size <= 1;
      const isAuxLogGap = table === 'scheduled_run_logs' && (column === 'transaction_id' || column === 'scheduled_id');
      if (isLegacyFamilyGap || isAuxLogGap) {
        report.warnings.push(`${table}.${column} possui ${count} referência(s) sem destino em ${targetTable}.`);
      } else {
        report.errors.push(`${table}.${column} possui ${count} referência(s) sem destino em ${targetTable}.`);
      }
    }
  }

  report.summary.totalRows = report.tableStats.reduce((a, b) => a + b.total, 0);
  report.summary.totalTables = report.tableStats.filter(t => t.total > 0).length;
  report.summary.errorCount = report.errors.length;
  report.summary.warningCount = report.warnings.length;
  return report;
}
async function _estimateRestoreImpact(backup) {
  const data = backup?.data || {};
  const out = {};
  for (const table of BACKUP_TABLES) {
    const rows = _backupTableRows(data, table);
    if (!rows.length) { out[table] = { incoming: 0, existing: 0, newRows: 0 }; continue; }
    const ids = rows.map(r => r.id).filter(_nonnull);
    let existing = 0;
    if (ids.length) {
      try {
        for (const chunk of _chunk(ids, 200)) {
          const { data: found } = await sb.from(table).select('id').in('id', chunk);
          existing += (found || []).length;
        }
      } catch (_) {}
    }
    out[table] = { incoming: rows.length, existing, newRows: Math.max(0, rows.length - existing) };
  }
  return out;
}

function _renderBackupReportHtml(title, backup, report, impact) {
  const familyLabel = esc(backup?.family_id || '—');
  const tableRows = report.tableStats.map(s => {
    const imp = impact?.[s.table] || { incoming: s.total, existing: 0, newRows: s.total };
    return `<tr>
      <td>${esc(s.table)}</td>
      <td style="text-align:right">${s.total}</td>
      <td style="text-align:right">${imp.existing || 0}</td>
      <td style="text-align:right">${imp.newRows || 0}</td>
      <td style="text-align:right">${s.duplicates || 0}</td>
    </tr>`;
  }).join('');

  const errList = report.errors.length
    ? `<ul style="margin:8px 0 0 18px">${report.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>`
    : '<div style="color:var(--green);font-weight:700">✓ Nenhum erro crítico encontrado.</div>';

  const warnList = report.warnings.length
    ? `<ul style="margin:8px 0 0 18px">${report.warnings.map(e => `<li>${esc(e)}</li>`).join('')}</ul>`
    : '<div style="color:var(--muted)">Nenhum alerta adicional.</div>';

  const relRows = report.relationIssues.length
    ? `<div style="margin-top:10px;display:grid;gap:8px">
        ${report.relationIssues.map(i => `
          <div style="border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--surface)">
            <div style="font-weight:700">${esc(i.table)}.${esc(i.column)} → ${esc(i.targetTable)}</div>
            <div style="font-size:.84rem;color:var(--muted)">${i.count} referência(s) inválida(s)</div>
            ${i.examples?.length ? `<div style="margin-top:6px;font-size:.82rem;color:var(--muted)">Exemplos: ${esc(i.examples.join(' • '))}</div>` : ''}
          </div>
        `).join('')}
      </div>`
    : '<div style="color:var(--muted)">Sem inconsistências referenciais detectadas.</div>';

  return `
    <div style="display:grid;gap:14px">
      <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px">
        <div style="border:1px solid var(--border);border-radius:12px;padding:12px;background:var(--surface)">
          <div style="font-size:.76rem;color:var(--muted)">Família</div>
          <div style="font-weight:700;word-break:break-all">${familyLabel}</div>
        </div>
        <div style="border:1px solid var(--border);border-radius:12px;padding:12px;background:var(--surface)">
          <div style="font-size:.76rem;color:var(--muted)">Tabelas com dados</div>
          <div style="font-weight:700">${report.summary.totalTables}</div>
        </div>
        <div style="border:1px solid var(--border);border-radius:12px;padding:12px;background:var(--surface)">
          <div style="font-size:.76rem;color:var(--muted)">Registros</div>
          <div style="font-weight:700">${report.summary.totalRows}</div>
        </div>
        <div style="border:1px solid var(--border);border-radius:12px;padding:12px;background:var(--surface)">
          <div style="font-size:.76rem;color:var(--muted)">Validação</div>
          <div style="font-weight:700;color:${report.errors.length ? 'var(--red)' : 'var(--green)'}">${report.errors.length ? 'com bloqueios' : 'apta'}</div>
        </div>
      </div>

      <details open>
        <summary style="cursor:pointer;font-weight:700">Resumo por tabela</summary>
        <div style="overflow:auto;margin-top:8px">
          <table style="width:100%;border-collapse:collapse;font-size:.88rem">
            <thead>
              <tr>
                <th style="text-align:left;padding:8px;border-bottom:1px solid var(--border)">Tabela</th>
                <th style="text-align:right;padding:8px;border-bottom:1px solid var(--border)">No backup</th>
                <th style="text-align:right;padding:8px;border-bottom:1px solid var(--border)">Já existem</th>
                <th style="text-align:right;padding:8px;border-bottom:1px solid var(--border)">Novos</th>
                <th style="text-align:right;padding:8px;border-bottom:1px solid var(--border)">IDs duplicados</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
      </details>

      <details ${report.errors.length ? 'open' : ''}>
        <summary style="cursor:pointer;font-weight:700;color:${report.errors.length ? 'var(--red)' : 'inherit'}">Erros críticos (${report.errors.length})</summary>
        <div style="margin-top:8px">${errList}</div>
      </details>

      <details>
        <summary style="cursor:pointer;font-weight:700">Alertas (${report.warnings.length})</summary>
        <div style="margin-top:8px">${warnList}</div>
      </details>

      <details>
        <summary style="cursor:pointer;font-weight:700">Integridade referencial</summary>
        <div style="margin-top:8px">${relRows}</div>
      </details>
    </div>`;
}

function _showBackupReportModal({ title, html, canProceed = false, proceedLabel = 'Continuar' }) {
  return new Promise(resolve => {
    const old = document.getElementById('backupReportModal');
    old?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'backupReportModal';
    wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
    wrap.innerHTML = `
      <div style="width:min(980px,96vw);max-height:90vh;overflow:hidden;background:var(--card, #fff);color:var(--text, #111);border:1px solid var(--border, #ddd);border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.28);display:flex;flex-direction:column">
        <div style="padding:16px 18px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:12px">
          <div>
            <div style="font-size:1rem;font-weight:800">${esc(title)}</div>
            <div style="font-size:.82rem;color:var(--muted)">Pré-validação detalhada antes do restore</div>
          </div>
          <button id="backupReportCloseX" class="btn btn-ghost btn-sm">✕</button>
        </div>
        <div style="padding:18px;overflow:auto">${html}</div>
        <div style="padding:14px 18px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:10px">
          <button id="backupReportCancel" class="btn btn-ghost">Fechar</button>
          ${canProceed ? `<button id="backupReportProceed" class="btn btn-primary">${esc(proceedLabel)}</button>` : ''}
        </div>
      </div>`;
    document.body.appendChild(wrap);

    const close = (v) => { wrap.remove(); resolve(v); };
    wrap.querySelector('#backupReportCancel')?.addEventListener('click', () => close(false));
    wrap.querySelector('#backupReportCloseX')?.addEventListener('click', () => close(false));
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(false); });
    wrap.querySelector('#backupReportProceed')?.addEventListener('click', () => close(true));
  });
}

async function _validateBackupForRestore(backup, title = 'Pré-validar restore') {
  const report = await _analyzeBackupObject(backup);
  const impact = await _estimateRestoreImpact(backup);
  const html = _renderBackupReportHtml(title, backup, report, impact);
  const canProceed = report.errors.length === 0;
  const confirmed = await _showBackupReportModal({
    title,
    html,
    canProceed,
    proceedLabel: 'Prosseguir com o restore',
  });
  return { report, impact, confirmed, canProceed };
}


function _showRestoreSectionSelector(backup) {
  const data = backup?.data || {};
  const sections = [
    // Core
    ['families',                  '🏠 Família'],
    ['family_preferences',        '⚙️ Preferências da família'],
    ['family_settings',           '🔑 Configurações (Gemini, etc.)'],
    ['family_members',            '👥 Membros'],
    ['family_composition',        '👨‍👩‍👧 Composição familiar'],
    ['family_member_restrictions','🔐 Controle de acesso'],
    // Accounts
    ['account_groups',            '🗂️ Grupos de conta'],
    ['accounts',                  '🏦 Contas'],
    ['iof_settings',              '📋 Configurações de IOF'],
    // Finance
    ['categories',                '🏷️ Categorias'],
    ['payees',                    '🏪 Beneficiários'],
    ['financial_objectives',      '🎯 Objetivos financeiros'],
    ['transactions',              '💸 Transações'],
    ['tx_reimbursements',         '🔄 Reembolsos'],
    ['budgets',                   '📊 Orçamentos'],
    // Scheduled
    ['scheduled_transactions',    '🗓️ Programados'],
    ['scheduled_occurrences',     '🗓️ Ocorrências dos programados'],
    ['scheduled_run_logs',        '📋 Logs dos programados'],
    ['scheduled_ar_records',      '📬 Contas a receber (programados)'],
    // Prices & Grocery
    ['price_items',               '🏷️ Itens de preço'],
    ['price_stores',              '🏪 Lojas'],
    ['price_history',             '📈 Histórico de preços'],
    ['grocery_lists',             '🛒 Listas de mercado'],
    ['grocery_items',             '🛒 Itens de mercado'],
    // Debts
    ['debts',                     '💳 Dívidas'],
    ['debt_ledger',               '📒 Lançamentos de dívidas'],
    // Investments
    ['investment_positions',      '📈 Posições de investimento'],
    ['investment_transactions',   '📈 Movimentações de investimento'],
    ['investment_price_history',  '📈 Histórico de preços de ativos'],
    // Dreams
    ['dreams',                    '🌟 Sonhos e metas'],
    ['dream_items',               '🌟 Itens dos sonhos'],
    ['dream_contributions',       '🌟 Contribuições aos sonhos'],
    // Loyalty
    ['loyalty_programs',          '🎯 Programas de fidelidade'],
    ['loyalty_transactions',      '🎯 Transações de fidelidade'],
    // AI
    ['ai_insight_snapshots',      '🤖 Snapshots de IA'],
    ['ai_insight_recommendations','🤖 Recomendações de IA'],
    ['ai_insight_simulations',    '🤖 Simulações de IA'],
    // Bot
    ['user_behavior_memory',      '🧠 Memória do bot (Telegram)'],
    // Attachments
    ['attachments',               '📎 Anexos'],
  ];

  const available = sections.map(([key, label]) => ({
    key,
    label,
    count: _backupTableRows(data, key).length,
  })).filter(s => s.count > 0);

  if (!available.length) {
    // All sections enabled by default
    return Promise.resolve(Object.fromEntries([
      'families','family_preferences','family_settings',
      'family_members','family_composition','family_member_restrictions',
      'account_groups','accounts','iof_settings',
      'categories','payees','financial_objectives',
      'transactions','tx_reimbursements','budgets',
      'scheduled_transactions','scheduled_occurrences','scheduled_run_logs','scheduled_ar_records',
      'price_items','price_stores','price_history','grocery_lists','grocery_items',
      'debts','debt_ledger',
      'investment_positions','investment_transactions','investment_price_history',
      'dreams','dream_items','dream_contributions',
      'loyalty_programs','loyalty_transactions',
      'ai_insight_snapshots','ai_insight_recommendations','ai_insight_simulations',
      'user_behavior_memory','attachments',
    ].map(k => [k, true])));
  }

  return new Promise(resolve => {
    const old = document.getElementById('restoreSectionModal');
    old?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'restoreSectionModal';
    wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px';
    wrap.innerHTML = `
      <div style="width:min(720px,96vw);max-height:88vh;overflow:hidden;background:var(--card, #fff);color:var(--text, #111);border:1px solid var(--border, #ddd);border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.28);display:flex;flex-direction:column">
        <div style="padding:16px 18px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:12px">
          <div>
            <div style="font-size:1rem;font-weight:800">Escolher partes do backup</div>
            <div style="font-size:.82rem;color:var(--muted)">Selecione somente o que deseja restaurar.</div>
          </div>
          <button id="restoreSectionCloseX" class="btn btn-ghost btn-sm">✕</button>
        </div>
        <div style="padding:18px;overflow:auto;display:grid;gap:10px">
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" id="restoreSectionAll" class="btn btn-ghost btn-sm">Marcar tudo</button>
            <button type="button" id="restoreSectionCore" class="btn btn-ghost btn-sm">Estrutura básica</button>
            <button type="button" id="restoreSectionNone" class="btn btn-ghost btn-sm">Limpar seleção</button>
          </div>
          <div id="restoreSectionList" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px">
            ${available.map(s => `
              <label style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:12px;background:var(--surface)">
                <input type="checkbox" data-key="${s.key}" checked style="margin-top:2px">
                <span>
                  <div style="font-weight:700">${esc(s.label)}</div>
                  <div style="font-size:.82rem;color:var(--muted)">${s.count} registro(s)</div>
                </span>
              </label>
            `).join('')}
          </div>
          <div style="font-size:.82rem;color:var(--muted)">
            Dica: para restaurar somente a estrutura financeira, marque grupos de conta, contas, categorias e beneficiários.
          </div>
        </div>
        <div style="padding:14px 18px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:10px">
          <button id="restoreSectionCancel" class="btn btn-ghost">Cancelar</button>
          <button id="restoreSectionProceed" class="btn btn-primary">Restaurar selecionados</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    const boxes = () => Array.from(wrap.querySelectorAll('input[type="checkbox"][data-key]'));
    const setAll = (v) => boxes().forEach(cb => { cb.checked = v; });
    const setCore = () => {
      const core = new Set(['families','family_preferences','account_groups','accounts','categories','payees','financial_objectives']);
      boxes().forEach(cb => { cb.checked = core.has(cb.dataset.key); });
    };
    const close = (v) => { wrap.remove(); resolve(v); };

    wrap.querySelector('#restoreSectionAll')?.addEventListener('click', () => setAll(true));
    wrap.querySelector('#restoreSectionNone')?.addEventListener('click', () => setAll(false));
    wrap.querySelector('#restoreSectionCore')?.addEventListener('click', setCore);
    wrap.querySelector('#restoreSectionCancel')?.addEventListener('click', () => close(null));
    wrap.querySelector('#restoreSectionCloseX')?.addEventListener('click', () => close(null));
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(null); });
    wrap.querySelector('#restoreSectionProceed')?.addEventListener('click', () => {
      const selected = {};
      boxes().forEach(cb => { selected[cb.dataset.key] = !!cb.checked; });
      if (!Object.values(selected).some(Boolean)) {
        toast?.('Selecione ao menos uma parte do backup', 'error');
        return;
      }
      close(selected);
    });
  });
}

async function _restoreBackupData(d, statusEl, options = {}) {
  // Build a helper — opt(key) returns true unless explicitly set to false
  const opt = (k) => options[k] !== false;
  const st  = (m) => _backupStatus(statusEl, m, 'var(--muted)');
  const rows = (t) => opt(t) ? _backupTableRows(d, t) : [];

  // ────────────────────────────────────────────────────────────────────────
  // PHASE 1 — Families + config (no dependencies)
  // ────────────────────────────────────────────────────────────────────────
  const upsert = async (table, data, label) => {
    if (!data.length) return;
    for (const chunk of _chunk(data, 200)) {
      const { error } = await sb.from(table).upsert(chunk, { ignoreDuplicates: false });
      if (error) throw new Error(`${label ?? table}: ${error.message}`);
    }
    st(`✓ ${label ?? table} (${data.length})...`);
  };

  await upsert('families', rows('families'));
  await upsert('family_preferences', rows('family_preferences'));
  await upsert('family_settings',    rows('family_settings'));
  await upsert('iof_settings',       rows('iof_settings').map(r => ({ ...r })));

  // ────────────────────────────────────────────────────────────────────────
  // PHASE 2 — Accounts & Categories (independent)
  // ────────────────────────────────────────────────────────────────────────
  await upsert('account_groups', rows('account_groups'));
  await upsert('accounts',       rows('accounts'));

  // Categories: base first (parent_id = null), then restore links
  const catRows = rows('categories');
  const catBase    = catRows.map(r => ({ ...r, parent_id: null }));
  const catParents = catRows.filter(r => _nonnull(r.parent_id))
                           .map(r => ({ id: r.id, parent_id: r.parent_id, updated_at: r.updated_at || new Date().toISOString() }));
  await upsert('categories', catBase, 'categories (base)');
  if (catParents.length) {
    for (const item of catParents) {
      const { error } = await sb.from('categories').update({ parent_id: item.parent_id, updated_at: item.updated_at }).eq('id', item.id);
      if (error) throw new Error(`categories(parent_id): ${error.message}`);
    }
    st(`✓ categories parent links (${catParents.length})...`);
  }

  // ────────────────────────────────────────────────────────────────────────
  // PHASE 3 — Payees, Objectives, Financial (depend on accounts+categories)
  // ────────────────────────────────────────────────────────────────────────
  await upsert('payees',               rows('payees'));
  await upsert('financial_objectives', rows('financial_objectives'));

  // Transactions: base first (no self-references), then restore links
  const txRows = rows('transactions');
  const txBase  = txRows.map(r => ({ ...r, linked_transfer_id: null, transfer_pair_id: null }));
  const txLinks = txRows.filter(r => _nonnull(r.linked_transfer_id) || _nonnull(r.transfer_pair_id))
                        .map(r => ({ id: r.id, linked_transfer_id: r.linked_transfer_id || null, transfer_pair_id: r.transfer_pair_id || null, updated_at: r.updated_at || new Date().toISOString() }));
  await upsert('transactions', txBase, 'transactions (base)');
  if (txLinks.length) {
    for (const item of txLinks) {
      const { error } = await sb.from('transactions').update({ linked_transfer_id: item.linked_transfer_id, transfer_pair_id: item.transfer_pair_id, updated_at: item.updated_at }).eq('id', item.id);
      if (error) throw new Error(`transactions(links): ${error.message}`);
    }
    st(`✓ transactions transfer links (${txLinks.length})...`);
  }
  await upsert('tx_reimbursements', rows('tx_reimbursements'));
  await upsert('budgets',           rows('budgets'));

  // ────────────────────────────────────────────────────────────────────────
  // PHASE 4 — Scheduled
  // ────────────────────────────────────────────────────────────────────────
  await upsert('scheduled_transactions', rows('scheduled_transactions'));
  await upsert('scheduled_occurrences',  rows('scheduled_occurrences'));
  await upsert('scheduled_run_logs',     rows('scheduled_run_logs'));
  await upsert('scheduled_ar_records',   rows('scheduled_ar_records'));

  // ────────────────────────────────────────────────────────────────────────
  // PHASE 5 — Prices & Grocery
  // ────────────────────────────────────────────────────────────────────────
  await upsert('price_items',   rows('price_items'));
  await upsert('price_stores',  rows('price_stores'));
  await upsert('price_history', rows('price_history'));
  await upsert('grocery_lists', rows('grocery_lists'));
  await upsert('grocery_items', rows('grocery_items'));

  // ────────────────────────────────────────────────────────────────────────
  // PHASE 6 — Debts
  // ────────────────────────────────────────────────────────────────────────
  await upsert('debts',       rows('debts'));
  await upsert('debt_ledger', rows('debt_ledger'));

  // ────────────────────────────────────────────────────────────────────────
  // PHASE 7 — Investments
  // ────────────────────────────────────────────────────────────────────────
  await upsert('investment_positions',     rows('investment_positions'));
  await upsert('investment_transactions',  rows('investment_transactions'));
  await upsert('investment_price_history', rows('investment_price_history'));

  // ────────────────────────────────────────────────────────────────────────
  // PHASE 8 — Dreams
  // ────────────────────────────────────────────────────────────────────────
  await upsert('dreams',             rows('dreams'));
  await upsert('dream_items',        rows('dream_items'));
  await upsert('dream_contributions',rows('dream_contributions'));

  // ────────────────────────────────────────────────────────────────────────
  // PHASE 9 — Loyalty
  // ────────────────────────────────────────────────────────────────────────
  await upsert('loyalty_programs',    rows('loyalty_programs'));
  await upsert('loyalty_transactions',rows('loyalty_transactions'));

  // ────────────────────────────────────────────────────────────────────────
  // PHASE 10 — AI
  // ────────────────────────────────────────────────────────────────────────
  await upsert('ai_insight_snapshots',      rows('ai_insight_snapshots'));
  await upsert('ai_insight_recommendations',rows('ai_insight_recommendations'));
  await upsert('ai_insight_simulations',    rows('ai_insight_simulations'));

  // ────────────────────────────────────────────────────────────────────────
  // PHASE 11 — User-scoped (only for users that exist in this DB)
  // ────────────────────────────────────────────────────────────────────────
  const behaviorRows = rows('user_behavior_memory');
  if (behaviorRows.length) {
    const userIds = [...new Set(behaviorRows.map(r => r.user_id).filter(_nonnull))];
    const existingUserSet = new Set();
    for (const chunk of _chunk(userIds, 200)) {
      const { data: found } = await sb.from('app_users').select('id').in('id', chunk);
      (found || []).forEach(r => existingUserSet.add(r.id));
    }
    const safeBehavior = behaviorRows.filter(r => existingUserSet.has(r.user_id));
    await upsert('user_behavior_memory', safeBehavior, 'user_behavior_memory');
  }

  // ────────────────────────────────────────────────────────────────────────
  // PHASE 12 — Family members & access control (need user existence check)
  // ────────────────────────────────────────────────────────────────────────
  const memberRows = rows('family_members');
  if (memberRows.length) {
    const userIds = [...new Set(memberRows.map(r => r.user_id).filter(_nonnull))];
    const existingUserSet = new Set();
    for (const chunk of _chunk(userIds, 200)) {
      const { data: found } = await sb.from('app_users').select('id').in('id', chunk);
      (found || []).forEach(r => existingUserSet.add(r.id));
    }
    const safeMembers = memberRows.filter(r => existingUserSet.has(r.user_id));
    await upsert('family_members', safeMembers, 'family_members');
  }
  await upsert('family_composition', rows('family_composition'));
  await upsert('family_member_restrictions', rows('family_member_restrictions'));

  // ────────────────────────────────────────────────────────────────────────
  // PHASE 13 — Attachments
  // ────────────────────────────────────────────────────────────────────────
  await upsert('attachments', rows('attachments'));
}

async function _reloadAfterRestore() {
  // Bust TTL cache — dados restaurados devem ser relidos do banco
  if (typeof DB !== 'undefined' && typeof DB.bustAll === 'function') DB.bustAll();
  const tasks = [];
  if (typeof loadAccounts === 'function') tasks.push(loadAccounts(true));
  if (typeof loadCategories === 'function') tasks.push(loadCategories(true));
  if (typeof loadPayees === 'function') tasks.push(loadPayees(true));
  if (typeof loadTransactions === 'function') tasks.push(loadTransactions());
  if (typeof loadBudgets === 'function') tasks.push(loadBudgets());
  if (typeof loadScheduled === 'function') tasks.push(loadScheduled());
  if (typeof _loadPricesData === 'function') tasks.push(_loadPricesData());
  await Promise.allSettled(tasks);
  try { populateSelects?.(); } catch (_) {}
  try { if (state?.currentPage === 'dashboard') await loadDashboard?.(); } catch (_) {}
}

// ══════════════════════════════════════════════════════════════════════════
//  SEÇÃO 1 — BACKUP LOCAL (JSON download)
// ══════════════════════════════════════════════════════════════════════════

async function exportBackup() {
  const btn = event?.target;
  const origText = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Exportando...'; }
  const status = document.getElementById('backupStatus');
  try {
    const fid = await _resolveActiveFamilyId();
    if (!fid) throw new Error('Não foi possível determinar a família ativa para o backup.');
    const { payload, counts } = await _collectFamilyBackupPayload(fid);
    const backup = { ..._backupHeader(fid, counts), data: payload };
    const json = JSON.stringify(backup, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a2   = document.createElement('a');
    a2.href = url;
    a2.download = `FinTrack_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    a2.click();
    URL.revokeObjectURL(url);
    _backupStatus(status, `✓ ${backup.counts.transactions} transações · ${(json.length / 1024).toFixed(0)} KB`, 'var(--green)');
    toast('Backup exportado!', 'success');
  } catch (e) {
    _backupStatus(status, '✗ ' + e.message, 'var(--red)');
    toast('Erro ao exportar: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = origText; }
  }
}

async function restoreBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const status = document.getElementById('restoreStatus');
  _backupStatus(status, '⏳ Lendo arquivo...', 'var(--muted)');
  try {
    const backup = JSON.parse(await file.text());
    const review = await _validateBackupForRestore(backup, 'Pré-validar restore do arquivo');
    if (!review.canProceed) {
      _backupStatus(status, '✗ Restore bloqueado pela pré-validação.', 'var(--red)');
      return;
    }
    if (!review.confirmed) {
      _backupStatus(status, '', 'var(--muted)');
      return;
    }
    const restoreOptions = await _showRestoreSectionSelector(backup);
    if (!restoreOptions) {
      _backupStatus(status, '', 'var(--muted)');
      return;
    }
    _backupStatus(status, '⏳ Restaurando...', 'var(--muted)');
    await _restoreBackupData(backup.data, status, restoreOptions);
    await _reloadAfterRestore();
    _backupStatus(status, '✓ Restaurado com sucesso!', 'var(--green)');
    toast(t('toast.backup_restored'), 'success');
  } catch (e) {
    _backupStatus(status, '✗ ' + e.message, 'var(--red)');
    toast('Erro: ' + e.message, 'error');
  } finally {
    event.target.value = '';
  }
}

// ══════════════════════════════════════════════════════════════════════════
//  SEÇÃO 2 — BACKUP NO BANCO (app_backups)
// ══════════════════════════════════════════════════════════════════════════

async function _checkBackupTable() {
  const { error } = await sb.from('app_backups').select('id').limit(1);
  return !error || !error.message?.includes('does not exist');
}


async function createDbBackupForFamily(fid, familyName = '', label = '') {
  const btn = document.getElementById('dbBackupCreateBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Criando...'; }
  try {
    const hasTable = await _checkBackupTable();
    if (!hasTable) {
      toast('Tabela app_backups não existe. Execute a migration primeiro.', 'error');
      _showDbBackupMigrationHint();
      return;
    }
    if (!fid) throw new Error('Família não informada para o backup.');
    const { payload, counts } = await _collectFamilyBackupPayload(fid);
    const famRow = _backupTableRows(payload, 'families')[0] || null;
    const famName = _familyDisplayName?.(fid, familyName || famRow?.name || '') || familyName || famRow?.name || fid;
    const row = {
      family_id: fid,
      label: label || `Backup manual — ${famName} — ${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
      created_by: currentUser?.name || currentUser?.email || 'sistema',
      payload,
      counts,
      size_kb: Math.round(JSON.stringify(payload).length / 1024),
      backup_type: 'manual',
    };
    const { error } = await sb.from('app_backups').insert(row);
    if (error) throw error;
    toast(`✅ Backup da família "${famName}" criado!`, 'success');
    await loadDbBackups();
  } catch (e) {
    toast('Erro ao criar backup: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📸 Criar Snapshot'; }
  }
}

function openDbBackupCreateForFamily(fid, familyName) {
  const resolved = (_familyDisplayName?.(fid, familyName || '') || familyName || fid);
  const label = prompt('Nome/etiqueta para este backup (opcional):', `Backup — ${resolved} — ${new Date().toLocaleDateString('pt-BR')}`);
  if (label === null) return;
  createDbBackupForFamily(fid, resolved, label || '');
}

async function _fetchDbBackupsForFamily(fid, limit = 20) {
  const { data, error } = await sb.from('app_backups')
    .select('id, family_id, label, created_at, created_by, counts, size_kb, backup_type')
    .eq('family_id', fid)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

function _renderFamilyBackupsHtml(backups, fid, familyName) {
  if (!backups.length) {
    return `<div style="text-align:center;padding:20px;color:var(--muted);font-size:.83rem"><div style="font-size:1.8rem;margin-bottom:8px;opacity:.4">🗄️</div>Nenhum snapshot encontrado para <strong>${esc(familyName || _familyDisplayName?.(fid,'') || fid)}</strong>.</div>`;
  }
  return `<div style="display:grid;gap:10px">${backups.map(b => {
    const dt = new Date(b.created_at);
    const ago = _timeAgo(dt);
    const typeIcon = b.backup_type === 'auto' ? '🤖' : '👤';
    return `<div class="db-backup-row" style="border:1px solid var(--border);border-radius:12px;padding:12px;background:var(--surface)">
      <div class="db-backup-row-info">
        <div class="db-backup-row-label">${typeIcon} ${esc(b.label || 'Backup')}</div>
        <div class="db-backup-row-meta">${dt.toLocaleDateString('pt-BR')} ${dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · <span title="${ago}">${ago}</span> · por ${esc(b.created_by || '—')} · ${b.size_kb || '?'} KB</div>
        <div class="db-backup-row-counts">${b.counts?.transactions || 0} txs · ${b.counts?.accounts || 0} contas · ${b.counts?.categories || 0} categorias</div>
      </div>
      <div class="db-backup-row-actions" style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" onclick="downloadDbBackup('${b.id}')" title="Baixar JSON">⬇️</button>
        <button class="btn btn-ghost btn-sm" onclick="previewDbBackupRestore('${b.id}')" title="Pré-validar restore">🔎</button>
        <button class="btn btn-ghost btn-sm" onclick="restoreDbBackup('${b.id}')" title="Restaurar este snapshot">↩️ Restaurar</button>
        <button class="btn-icon" onclick="deleteDbBackup('${b.id}')" title="Excluir backup" style="color:var(--red)">🗑️</button>
      </div>
    </div>`;
  }).join('')}</div>`;
}

async function openFamilyBackupManager(fid, familyName = '') {
  try {
    const hasTable = await _checkBackupTable();
    if (!hasTable) {
      toast('Tabela app_backups não existe. Execute a migration primeiro.', 'error');
      _showDbBackupMigrationHint();
      return;
    }
    const resolved = _familyDisplayName?.(fid, familyName || '') || familyName || fid;
    const isMobile = window.innerWidth < 768 || ('ontouchstart' in window);

    // ── Build modal shell ──────────────────────────────────────────────────
    const old = document.getElementById('familyBackupManagerModal');
    old?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'familyBackupManagerModal';
    wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
    wrap.innerHTML = `
      <div style="width:min(980px,96vw);max-height:92vh;overflow:hidden;background:var(--card,#fff);color:var(--text,#111);border:1px solid var(--border,#ddd);border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.28);display:flex;flex-direction:column">
        <div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:12px;flex-shrink:0">
          <div>
            <div style="font-size:1rem;font-weight:800">Snapshots da família</div>
            <div style="font-size:.8rem;color:var(--muted)">Crie, pré-valide e restaure snapshots desta família específica.</div>
          </div>
          <button id="familyBackupManagerCloseX" class="btn btn-ghost btn-sm" style="flex-shrink:0">✕</button>
        </div>

        <!-- Header: nome + contador + botão criar -->
        <div style="padding:12px 16px;border-bottom:1px solid var(--border);flex-shrink:0">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
            <div>
              <div style="font-weight:700;font-size:.9rem">Família: ${esc(resolved)}</div>
              <div id="fbmCount" style="font-size:.78rem;color:var(--muted)">Carregando…</div>
            </div>
            <button class="btn btn-primary btn-sm" id="familyBackupCreateFromModal" style="white-space:nowrap">
              📸 Criar novo snapshot
            </button>
          </div>
          <!-- Label input — oculto por padrão, aparece ao clicar criar -->
          <div id="fbmLabelRow" style="display:none;margin-top:10px;display:none">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <input id="fbmLabelInput" type="text" class="form-control" placeholder="Nome do snapshot (opcional)"
                style="flex:1;min-width:160px;font-size:.84rem;padding:6px 10px;border-radius:8px;border:1px solid var(--border);background:var(--surface2);color:var(--text)">
              <button id="fbmLabelConfirm" class="btn btn-primary btn-sm">✓ Confirmar</button>
              <button id="fbmLabelCancel" class="btn btn-ghost btn-sm">Cancelar</button>
            </div>
          </div>
        </div>

        <!-- List -->
        <div id="fbmList" style="padding:14px 16px;overflow:auto;flex:1">
          <div style="text-align:center;padding:30px;color:var(--muted);font-size:.83rem">⏳ Carregando snapshots…</div>
        </div>

        <div style="padding:12px 16px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;flex-shrink:0">
          <button id="familyBackupManagerClose" class="btn btn-ghost btn-sm">Fechar</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    const close = () => wrap.remove();
    wrap.querySelector('#familyBackupManagerClose')?.addEventListener('click', close);
    wrap.querySelector('#familyBackupManagerCloseX')?.addEventListener('click', close);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });

    // ── Refresh list in-place ──────────────────────────────────────────────
    async function _refreshList() {
      const listEl  = wrap.querySelector('#fbmList');
      const countEl = wrap.querySelector('#fbmCount');
      if (!listEl) return;
      listEl.innerHTML = '<div style="text-align:center;padding:24px;color:var(--muted);font-size:.83rem">⏳ Carregando snapshots…</div>';
      try {
        const fresh = await _fetchDbBackupsForFamily(fid, 30);
        if (countEl) countEl.textContent = `${fresh.length} snapshot(s) encontrado(s).`;
        listEl.innerHTML = `<div style="display:grid;gap:10px">${_renderFamilyBackupsHtml(fresh, fid, resolved)}</div>`;
      } catch (err) {
        listEl.innerHTML = `<div style="color:var(--red);padding:16px">${esc(err.message)}</div>`;
      }
    }

    // ── Create button logic ────────────────────────────────────────────────
    const createBtn = wrap.querySelector('#familyBackupCreateFromModal');
    const labelRow  = wrap.querySelector('#fbmLabelRow');
    const labelInput = wrap.querySelector('#fbmLabelInput');
    const confirmBtn = wrap.querySelector('#fbmLabelConfirm');
    const cancelBtn  = wrap.querySelector('#fbmLabelCancel');

    const _defaultLabel = () => `Backup — ${resolved} — ${new Date().toLocaleDateString('pt-BR')}`;

    const _doCreate = async () => {
      const label = (labelInput?.value || '').trim() || _defaultLabel();
      // Show loading state
      createBtn.disabled = true;
      createBtn.textContent = '⏳ Criando…';
      if (isMobile) document.body.style.cursor = 'wait';
      if (labelRow) labelRow.style.display = 'none';
      try {
        const { payload, counts } = await _collectFamilyBackupPayload(fid);
        const famRow = _backupTableRows(payload, 'families')[0] || null;
        const famName = _familyDisplayName?.(fid, resolved || famRow?.name || '') || resolved || famRow?.name || fid;
        const row = {
          family_id: fid,
          label,
          created_by: currentUser?.name || currentUser?.email || 'sistema',
          payload,
          counts,
          size_kb: Math.round(JSON.stringify(payload).length / 1024),
          backup_type: 'manual',
        };
        const { error } = await sb.from('app_backups').insert(row);
        if (error) throw error;
        toast(`✅ Snapshot "${label}" criado!`, 'success');
        if (labelInput) labelInput.value = '';
        await _refreshList();
      } catch (e) {
        toast('Erro ao criar snapshot: ' + e.message, 'error');
      } finally {
        createBtn.disabled = false;
        createBtn.textContent = '📸 Criar novo snapshot';
        if (isMobile) document.body.style.cursor = '';
      }
    };

    createBtn?.addEventListener('click', () => {
      if (isMobile) {
        // Mobile: mostra input inline (sem prompt nativo)
        if (labelRow) {
          labelRow.style.display = labelRow.style.display === 'none' ? 'block' : 'none';
          if (labelRow.style.display === 'block') {
            if (labelInput) { labelInput.value = _defaultLabel(); labelInput.focus(); labelInput.select(); }
          }
        }
      } else {
        // Desktop: prompt nativo rápido
        const label = prompt('Nome/etiqueta para este snapshot (opcional):', _defaultLabel());
        if (label === null) return;
        if (labelInput) labelInput.value = label;
        _doCreate();
      }
    });

    confirmBtn?.addEventListener('click', _doCreate);
    cancelBtn?.addEventListener('click', () => { if (labelRow) labelRow.style.display = 'none'; });
    labelInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') _doCreate(); });

    // ── Initial load ───────────────────────────────────────────────────────
    await _refreshList();

  } catch (e) {
    toast('Erro ao abrir snapshots da família: ' + e.message, 'error');
  }
}

async function createDbBackup(label = '') {
  const btn = document.getElementById('dbBackupCreateBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Criando...'; }
  try {
    const hasTable = await _checkBackupTable();
    if (!hasTable) {
      toast('Tabela app_backups não existe. Execute a migration primeiro.', 'error');
      _showDbBackupMigrationHint();
      return;
    }
    const fid = await _resolveActiveFamilyId();
    if (!fid) throw new Error('Não foi possível determinar a família ativa.');
    return createDbBackupForFamily(fid, '', label);
  } catch (e) {
    toast('Erro ao criar backup: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📸 Criar Snapshot'; }
  }
}

async function _createDbBackup_legacy_unused(label = '') {
  const btn = document.getElementById('dbBackupCreateBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Criando...'; }
  try {
    const hasTable = await _checkBackupTable();
    if (!hasTable) {
      toast('Tabela app_backups não existe. Execute a migration primeiro.', 'error');
      _showDbBackupMigrationHint();
      return;
    }
    const fid = await _resolveActiveFamilyId();
    if (!fid) throw new Error('Não foi possível determinar a família ativa.');
    const { payload, counts } = await _collectFamilyBackupPayload(fid);
    const row = {
      family_id: fid,
      label: label || `Backup manual — ${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
      created_by: currentUser?.name || currentUser?.email || 'sistema',
      payload,
      counts,
      size_kb: Math.round(JSON.stringify(payload).length / 1024),
      backup_type: 'manual',
    };
    const { error } = await sb.from('app_backups').insert(row);
    if (error) throw error;
    toast(t('toast.backup_ok'), 'success');
    await loadDbBackups();
  } catch (e) {
    toast('Erro ao criar backup: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📸 Criar Snapshot'; }
  }
}

async function loadDbBackups() {
  const container = document.getElementById('dbBackupList');
  if (!container) return;
  container.innerHTML = '<div style="color:var(--muted);font-size:.83rem;padding:12px 0">⏳ Carregando...</div>';
  try {
    const hasTable = await _checkBackupTable();
    if (!hasTable) {
      _showDbBackupMigrationHint();
      container.innerHTML = '';
      return;
    }
    const fid = await _resolveActiveFamilyId();
    let query = sb.from('app_backups').select('id, family_id, label, created_at, created_by, counts, size_kb, backup_type').order('created_at', { ascending: false }).limit(20);
    if (fid) query = query.eq('family_id', fid);
    const { data, error } = await query;
    if (error) throw error;
    _dbBackupList = data || [];
    document.getElementById('dbBackupMigrationHint')?.style && (document.getElementById('dbBackupMigrationHint').style.display = 'none');
    if (!_dbBackupList.length) {
      container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--muted);font-size:.83rem"><div style="font-size:1.8rem;margin-bottom:8px;opacity:.4">🗄️</div>Nenhum backup no banco ainda.<br>Clique em "Criar Snapshot" para começar.</div>`;
      return;
    }
    container.innerHTML = _dbBackupList.map(b => {
      const dt = new Date(b.created_at);
      const ago = _timeAgo(dt);
      const typeIcon = b.backup_type === 'auto' ? '🤖' : '👤';
      return `<div class="db-backup-row">
        <div class="db-backup-row-info">
          <div class="db-backup-row-label">${typeIcon} ${esc(b.label || 'Backup')}</div>
          <div class="db-backup-row-meta">${dt.toLocaleDateString('pt-BR')} ${dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · <span title="${ago}">${ago}</span> · por ${esc(b.created_by || '—')} · ${b.size_kb || '?'} KB</div>
          <div class="db-backup-row-counts">${b.counts?.transactions || 0} txs · ${b.counts?.accounts || 0} contas · ${b.counts?.categories || 0} categorias</div>
        </div>
        <div class="db-backup-row-actions">
          <button class="btn btn-ghost btn-sm" onclick="downloadDbBackup('${b.id}')" title="Baixar JSON">⬇️</button>
          <button class="btn btn-ghost btn-sm" onclick="previewDbBackupRestore('${b.id}')" title="Pré-validar restore">🔎</button>
          <button class="btn btn-ghost btn-sm" onclick="restoreDbBackup('${b.id}')" title="Restaurar este snapshot">↩️ Restaurar</button>
          <button class="btn-icon" onclick="deleteDbBackup('${b.id}')" title="Excluir backup" style="color:var(--red)">🗑️</button>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    container.innerHTML = `<div style="color:var(--red);font-size:.83rem;padding:12px">${esc(e.message)}</div>`;
  }
}

async function downloadDbBackup(id) {
  try {
    const { data, error } = await sb.from('app_backups').select('*').eq('id', id).single();
    if (error) throw error;
    const exportObj = {
      ..._backupHeader(data.family_id, data.counts || {}),
      exported_at: data.created_at,
      source: 'db_backup',
      label: data.label,
      data: data.payload,
    };
    const json = JSON.stringify(exportObj, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `FinTrack_Backup_${data.created_at.slice(0, 10)}_${id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast(t('toast.backup_downloaded'), 'success');
  } catch (e) {
    toast('Erro ao baixar backup: ' + e.message, 'error');
  }
}

async function previewDbBackupRestore(id) {
  try {
    const { data, error } = await sb.from('app_backups').select('payload, family_id, created_at, label').eq('id', id).single();
    if (error) throw error;
    const backup = {
      version: BACKUP_VERSION,
      family_id: data.family_id,
      exported_at: data.created_at,
      label: data.label,
      data: data.payload,
    };
    await _validateBackupForRestore(backup, `Pré-validar snapshot: ${data.label || id.slice(0,8)}`);
  } catch (e) {
    toast('Erro ao pré-validar: ' + e.message, 'error');
  }
}

async function restoreDbBackup(id) {
  const backupMeta = _dbBackupList.find(b => b.id === id);
  const btn = document.querySelector(`[onclick="restoreDbBackup('${id}')"]`);
  if (btn) { btn.disabled = true; btn.textContent = '⏳...'; }
  try {
    const { data, error } = await sb.from('app_backups').select('payload, family_id, created_at, label').eq('id', id).single();
    if (error) throw error;
    const backup = {
      version: BACKUP_VERSION,
      family_id: data.family_id,
      exported_at: data.created_at,
      label: data.label,
      data: data.payload,
    };
    const review = await _validateBackupForRestore(backup, `Restore do snapshot: ${backupMeta?.label || data.label || id.slice(0,8)}`);
    if (!review.canProceed || !review.confirmed) return;
    const restoreOptions = await _showRestoreSectionSelector(backup);
    if (!restoreOptions) return;
    await _restoreBackupData(backup.data, null, restoreOptions);
    await _reloadAfterRestore();
    toast('✅ Snapshot restaurado com sucesso!', 'success');
  } catch (e) {
    toast('Erro ao restaurar: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↩️ Restaurar'; }
  }
}

async function deleteDbBackup(id) {
  if (!confirm('Excluir este backup?')) return;
  const { error } = await sb.from('app_backups').delete().eq('id', id);
  if (error) { toast(error.message, 'error'); return; }
  toast(t('toast.backup_deleted'), 'success');
  await loadDbBackups();
}

function openDbBackupCreate() {
  const label = prompt('Nome/etiqueta para este backup (opcional):', `Backup — ${new Date().toLocaleDateString('pt-BR')}`);
  if (label === null) return;
  createDbBackup(label || '');
}

function _showDbBackupMigrationHint() {
  const hint = document.getElementById('dbBackupMigrationHint');
  if (hint) hint.style.display = '';
}

function _timeAgo(dt) {
  const diff = (Date.now() - dt.getTime()) / 1000;
  if (diff < 60) return 'agora mesmo';
  if (diff < 3600) return `${Math.floor(diff / 60)} min atrás`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} dias atrás`;
  return dt.toLocaleDateString('pt-BR');
}

// ══════════════════════════════════════════════════════════════════════════
//  SEÇÃO 3 — CLEAR DATABASE
// ══════════════════════════════════════════════════════════════════════════

function confirmClearDatabase() {
  if (!confirm(
    '⚠️ ATENÇÃO: Esta ação irá apagar TODOS os dados!\n\n' +
    '• Todas as transações\n• Todas as contas\n• Todas as categorias\n' +
    '• Todos os beneficiários\n• Todos os orçamentos\n\n' +
    'Esta ação é IRREVERSÍVEL. Deseja continuar?'
  )) return;
  if (!confirm('⛔ SEGUNDA CONFIRMAÇÃO\n\nTODOS os dados serão permanentemente apagados.\nTem ABSOLUTA certeza?')) return;
  showClearDatabasePinConfirm();
}

function showClearDatabasePinConfirm() {
  const pin = prompt('🔐 Digite seu Masterpin para confirmar a limpeza:');
  if (pin === null) return;
  if (pin !== getMasterPin()) { toast('❌ PIN incorreto. Operação cancelada.', 'error'); return; }
  executeClearDatabase();
}

async function executeClearDatabase() {
  const btn = document.querySelector('[onclick="confirmClearDatabase()"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Limpando...'; }
  try {
    if (!sb || typeof sb.from !== 'function') throw new Error('Supabase não conectado.');
    const tables = ['scheduled_occurrences', 'scheduled_transactions', 'transactions', 'budgets', 'payees', 'categories', 'accounts'];
    const cleared = [], failed = [], skipped = [];
    for (const t of tables) {
      try {
        if (t === 'categories') {
          try { await sb.from('categories').update({ parent_id: null }).not('id', 'is', null); } catch {}
        }
        const { error } = await famQ(sb.from(t).delete()).not('id', 'is', null);
        if (error) {
          const msg = (error.message || '').toLowerCase();
          if (msg.includes('does not exist')) { skipped.push(t); continue; }
          failed.push(t + ': ' + error.message); continue;
        }
        cleared.push(t);
      } catch (e) { failed.push(t + ': ' + e.message); }
    }
    state.accounts = []; state.categories = []; state.payees = []; state.transactions = []; state.budgets = [];
    if (state.scheduled) state.scheduled = [];
    state.txTotal = 0; state.txPage = 0;
    if(typeof populateSelects==='function') populateSelects();
    if (failed.length > 0) {
      toast('⚠️ Limpeza parcial: ' + failed.join(', '), 'error');
    } else {
      toast('✓ Base de dados limpa! (' + cleared.length + ' tabelas)', 'success');
    }
    document.getElementById('loginScreen').style.display = 'flex';
  } catch (e) {
    toast('Erro ao limpar: ' + (e?.message || e), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⚠️ Limpar Tudo'; }
  }
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

/* ══════════════════════════════════════════════════════════════════
   EXPORTAÇÃO EXCEL + ZIP — Owner only
   Gera 1 planilha .xlsx por tabela principal e compacta em ZIP
   Usa SheetJS (xlsx) via CDN e JSZip via CDN
══════════════════════════════════════════════════════════════════ */

async function exportAllExcelZip() {
  // Verificar permissão: apenas owner
  if (currentUser?.role !== 'owner' && currentUser?.role !== 'admin') {
    toast('Apenas o Owner pode exportar todos os dados.', 'error');
    return;
  }

  const btn      = document.getElementById('exportExcelBtn');
  const progress = document.getElementById('exportExcelProgress');
  const status   = document.getElementById('exportExcelStatus');
  const pctEl    = document.getElementById('exportExcelPct');
  const barEl    = document.getElementById('exportExcelBar');

  const setProgress = (pct, msg) => {
    if (barEl)   barEl.style.width = pct + '%';
    if (pctEl)   pctEl.textContent = pct + '%';
    if (status)  status.textContent = msg;
  };

  if (btn)      { btn.disabled = true; btn.textContent = '⏳ Exportando…'; }
  if (progress) progress.style.display = '';
  setProgress(0, 'Carregando dependências…');

  try {
    // 1. Carregar SheetJS e JSZip dinamicamente
    if (!window.XLSX) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }
    if (!window.JSZip) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }

    setProgress(5, 'Iniciando exportação…');

    // 2. Definir tabelas a exportar
    const TABLES = [
      // Finance
      { key: 'transactions',              label: 'Transações',             select: '*, payees(name), categories(name,type), accounts(name,currency)' },
      { key: 'accounts',                  label: 'Contas',                 select: '*' },
      { key: 'account_groups',            label: 'Grupos de Conta',        select: '*' },
      { key: 'categories',                label: 'Categorias',             select: '*' },
      { key: 'payees',                    label: 'Beneficiários',          select: '*' },
      { key: 'budgets',                   label: 'Orçamentos',             select: '*, categories(name)' },
      { key: 'financial_objectives',      label: 'Objetivos',              select: '*' },
      { key: 'tx_reimbursements',         label: 'Reembolsos',             select: '*' },
      // Scheduled
      { key: 'scheduled_transactions',    label: 'Programados',            select: '*' },
      { key: 'scheduled_occurrences',     label: 'Ocorrências Programadas',select: '*' },
      { key: 'scheduled_ar_records',      label: 'A Receber',              select: '*' },
      // Prices & Grocery
      { key: 'price_items',               label: 'Itens Rastreados',       select: '*' },
      { key: 'price_stores',              label: 'Lojas de Preço',         select: '*' },
      { key: 'price_history',             label: 'Histórico de Preços',    select: '*' },
      { key: 'grocery_lists',             label: 'Listas de Mercado',      select: '*' },
      { key: 'grocery_items',             label: 'Itens de Mercado',       select: '*' },
      // Debts
      { key: 'debts',                     label: 'Dívidas',                select: '*' },
      { key: 'debt_ledger',               label: 'Lançamentos de Dívidas', select: '*' },
      // Investments
      { key: 'investment_positions',      label: 'Posições Investimento',  select: '*' },
      { key: 'investment_transactions',   label: 'Movim. Investimento',    select: '*' },
      { key: 'investment_price_history',  label: 'Histórico Ativos',       select: '*' },
      // Dreams
      { key: 'dreams',                    label: 'Sonhos e Metas',         select: '*' },
      { key: 'dream_items',               label: 'Itens dos Sonhos',       select: '*' },
      { key: 'dream_contributions',       label: 'Contribuições Sonhos',   select: '*' },
      // Loyalty
      { key: 'loyalty_programs',          label: 'Programas Fidelidade',   select: '*' },
      { key: 'loyalty_transactions',      label: 'Transações Fidelidade',  select: '*' },
      // Investment portfolios/wallets
      { key: 'investment_portfolios',     label: 'Carteiras Invest.',      select: '*' },
      { key: 'investment_wallets',        label: 'Wallets Invest.',        select: '*' },
      // investment_wallet_positions is a join table (no family_id) — skipped
      // Agent & chat
      { key: 'agent_conversations',       label: 'Conversas Bot',          select: '*' },
      { key: 'chat_pending_actions',      label: 'Chat Pendentes',         select: '*' },
      // Notifications
      { key: 'scheduled_notification_logs', label: 'Log Notificações',     select: '*' },
      // Family
      { key: 'family_invites',            label: 'Convites',               select: '*' },
      { key: 'family_composition',        label: 'Composição Familiar',    select: '*' },
      { key: 'family_member_restrictions', label: 'Restrições de Acesso',  select: '*' },
      { key: 'iof_settings',              label: 'Configurações IOF',      select: '*', noOrder: true },
      { key: 'ai_insight_snapshots',      label: 'IA Snapshots',           select: '*' },
      { key: 'ai_insight_recommendations', label: 'IA Recomendações',      select: '*' },
      { key: 'user_behavior_memory',      label: 'Memória Comportamental', select: '*' },
    ];

    const zip = new JSZip();
    const familyName = (currentUser?.families?.find(f => f.id === currentUser?.family_id)?.name || 'familia')
      .replace(/[^a-zA-Z0-9_\-]/g, '_');
    const dateStr = new Date().toISOString().slice(0,10);

    for (let i = 0; i < TABLES.length; i++) {
      const t = TABLES[i];
      const pct = Math.round(5 + (i / TABLES.length) * 90);
      setProgress(pct, `Exportando ${t.label}…`);

      try {
        let q = famQ(sb.from(t.key).select(t.select));
        if (!t.noOrder) {
          try { q = q.order('created_at', { ascending: false }); } catch(_) {}
        }
        const { data, error } = await q.limit(50000);

        if (error) { console.warn(`[export] ${t.key}:`, error.message); continue; }
        if (!data?.length) continue;

        // Aplanar objetos aninhados (ex: payees.name → payee_name)
        const flat = data.map(row => {
          const r = {};
          for (const [k, v] of Object.entries(row)) {
            if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
              for (const [sk, sv] of Object.entries(v)) {
                r[`${k}_${sk}`] = sv;
              }
            } else if (Array.isArray(v)) {
              r[k] = v.join(', ');
            } else {
              r[k] = v;
            }
          }
          return r;
        });

        const ws = XLSX.utils.json_to_sheet(flat);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, t.label.slice(0, 31));
        const xlsxBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
        zip.file(`${t.label}.xlsx`, xlsxBuffer);
      } catch(tErr) {
        console.warn(`[export] ${t.key} erro:`, tErr.message);
      }
    }

    setProgress(97, 'Compactando ZIP…');
    const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });

    setProgress(100, '✅ Exportação concluída!');

    // 3. Download automático
    const url  = URL.createObjectURL(zipBlob);
    const link = document.createElement('a');
    link.href     = url;
    link.download = `FinTrack_${familyName}_${dateStr}.zip`;
    link.click();
    URL.revokeObjectURL(url);

    toast('✅ Exportação concluída!', 'success');

    setTimeout(() => {
      if (progress) progress.style.display = 'none';
      setProgress(0, '');
    }, 3000);

  } catch(e) {
    setProgress(0, '');
    if (progress) progress.style.display = 'none';
    toast('Erro na exportação: ' + (e.message || e), 'error');
    console.error('[exportAllExcelZip]', e);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⬇️ Exportar'; }
  }
}
window.exportAllExcelZip = exportAllExcelZip;

// ── Expor funções públicas no window ──────────────────────────────────────────
window.loadDbBackups                       = loadDbBackups;
window.openDbBackupCreate                  = openDbBackupCreate;
window.openDbBackupCreateForFamily         = openDbBackupCreateForFamily;
window.openFamilyBackupManager             = openFamilyBackupManager;
