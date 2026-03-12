// ── backup.js — Backup local (JSON) + Backup no banco (Supabase) ───────────

const BACKUP_VERSION = '4.0';
const BACKUP_TABLES = [
  'families',
  'family_members',
  'account_groups',
  'accounts',
  'categories',
  'payees',
  'transactions',
  'budgets',
  'scheduled_transactions',
  'scheduled_occurrences',
  'scheduled_run_logs',
  'price_items',
  'price_stores',
  'price_history'
];

const BACKUP_RESTORE_ORDER = [
  'families',
  'family_members',
  'account_groups',
  'accounts',
  'categories',
  'payees',
  'budgets',
  'scheduled_transactions',
  'transactions',
  'scheduled_occurrences',
  'scheduled_run_logs',
  'price_items',
  'price_stores',
  'price_history'
];

const BACKUP_FK_RULES = {
  family_members: [
    { field: 'family_id', target: 'families' }
  ],
  account_groups: [
    { field: 'family_id', target: 'families' }
  ],
  accounts: [
    { field: 'family_id', target: 'families' },
    { field: 'group_id', target: 'account_groups' }
  ],
  categories: [
    { field: 'family_id', target: 'families' },
    { field: 'parent_id', target: 'categories' }
  ],
  payees: [
    { field: 'family_id', target: 'families' },
    { field: 'default_category_id', target: 'categories' }
  ],
  transactions: [
    { field: 'family_id', target: 'families' },
    { field: 'account_id', target: 'accounts' },
    { field: 'payee_id', target: 'payees' },
    { field: 'category_id', target: 'categories' },
    { field: 'transfer_to_account_id', target: 'accounts' },
    { field: 'linked_transfer_id', target: 'transactions' },
    { field: 'transfer_pair_id', target: 'transactions' }
  ],
  budgets: [
    { field: 'family_id', target: 'families' },
    { field: 'category_id', target: 'categories' }
  ],
  scheduled_transactions: [
    { field: 'family_id', target: 'families' },
    { field: 'account_id', target: 'accounts' },
    { field: 'payee_id', target: 'payees' },
    { field: 'category_id', target: 'categories' },
    { field: 'transfer_to_account_id', target: 'accounts' }
  ],
  scheduled_occurrences: [
    { field: 'scheduled_id', target: 'scheduled_transactions' },
    { field: 'transaction_id', target: 'transactions' }
  ],
  scheduled_run_logs: [
    { field: 'family_id', target: 'families' },
    { field: 'scheduled_id', target: 'scheduled_transactions' },
    { field: 'transaction_id', target: 'transactions' }
  ],
  price_items: [
    { field: 'family_id', target: 'families' },
    { field: 'category_id', target: 'categories' }
  ],
  price_stores: [
    { field: 'family_id', target: 'families' },
    { field: 'payee_id', target: 'payees' }
  ],
  price_history: [
    { field: 'family_id', target: 'families' },
    { field: 'item_id', target: 'price_items' },
    { field: 'store_id', target: 'price_stores' }
  ]
};

function _rowsFor(payload, table) {
  return payload?.[table] || [];
}

function _backupCounts(payload) {
  const counts = {};
  for (const t of BACKUP_TABLES) counts[t] = _rowsFor(payload, t).length;
  return counts;
}

async function _resolveActiveFamilyId() {
  const explicit = state?.currentFamilyId || currentUser?.preferred_family_id || currentUser?.family_id || null;
  if (explicit) return explicit;

  const userFamilies = currentUser?.families || [];
  if (userFamilies.length === 1) return userFamilies[0].id;

  const familyTables = ['accounts', 'categories', 'payees', 'transactions', 'budgets', 'scheduled_transactions', 'price_items', 'price_stores'];
  for (const table of familyTables) {
    try {
      const { data } = await sb.from(table).select('family_id').not('family_id', 'is', null).limit(1).maybeSingle();
      if (data?.family_id) return data.family_id;
    } catch (_) {}
  }

  try {
    const { data } = await sb.from('families').select('id').limit(1).maybeSingle();
    if (data?.id) return data.id;
  } catch (_) {}

  return null;
}

async function _fetchBackupPayload(fid) {
  const q = table => {
    if (table === 'families') return sb.from('families').select('*').eq('id', fid);
    if (table === 'family_members') return sb.from('family_members').select('*').eq('family_id', fid);
    return sb.from(table).select('*').eq('family_id', fid);
  };

  const results = await Promise.all(BACKUP_TABLES.map(async (table) => {
    const { data, error } = await q(table);
    if (error) throw new Error(`${table}: ${error.message}`);
    return [table, data || []];
  }));

  const payload = Object.fromEntries(results);
  return payload;
}

function _normalizePayload(backup) {
  const data = { ...(backup?.data || backup?.payload || {}) };
  if (data.scheduled && !data.scheduled_transactions) data.scheduled_transactions = data.scheduled;
  for (const t of BACKUP_TABLES) if (!Array.isArray(data[t])) data[t] = [];
  return data;
}

function _buildIdSets(payload) {
  const sets = {};
  for (const t of BACKUP_TABLES) {
    sets[t] = new Set((_rowsFor(payload, t)).map(r => r?.id).filter(Boolean));
  }
  return sets;
}

function _collectIntegrityIssues(payload) {
  const issues = [];
  const idSets = _buildIdSets(payload);

  for (const table of BACKUP_TABLES) {
    const rows = _rowsFor(payload, table);
    const seen = new Set();
    for (const row of rows) {
      if (!row?.id) {
        issues.push({ level: 'warning', table, message: `linha sem id em ${table}` });
        continue;
      }
      if (seen.has(row.id)) issues.push({ level: 'error', table, message: `id duplicado ${row.id}` });
      seen.add(row.id);
    }
  }

  for (const [table, rules] of Object.entries(BACKUP_FK_RULES)) {
    for (const row of _rowsFor(payload, table)) {
      for (const rule of rules) {
        const v = row?.[rule.field];
        if (!v) continue;
        if (!idSets[rule.target]?.has(v)) {
          issues.push({
            level: 'error',
            table,
            message: `${table}.${rule.field} referencia ${rule.target}.${v} inexistente no backup`,
            rowId: row?.id || null
          });
        }
      }
    }
  }

  return issues;
}

async function _loadExistingIdSet(table, ids, extraFilter) {
  const found = new Set();
  if (!ids?.length) return found;
  for (let i = 0; i < ids.length; i += 200) {
    let q = sb.from(table).select('id').in('id', ids.slice(i, i + 200));
    if (extraFilter?.field && extraFilter?.value) q = q.eq(extraFilter.field, extraFilter.value);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    (data || []).forEach(r => { if (r?.id) found.add(r.id); });
  }
  return found;
}

async function _buildDryRunReport(payload, fid) {
  const report = {
    family_id: fid,
    counts: _backupCounts(payload),
    integrity: _collectIntegrityIssues(payload),
    existing: {},
    criticalErrors: [],
    warnings: []
  };

  for (const t of BACKUP_TABLES) {
    const rows = _rowsFor(payload, t);
    if (!rows.length) {
      report.existing[t] = { incoming: 0, existingById: 0, newRows: 0 };
      continue;
    }
    const ids = rows.map(r => r?.id).filter(Boolean);
    const extraFilter = t === 'families' ? null : (rows[0]?.family_id || fid ? { field: 'family_id', value: rows[0]?.family_id || fid } : null);
    const existingSet = await _loadExistingIdSet(t, ids, extraFilter);
    report.existing[t] = {
      incoming: rows.length,
      existingById: existingSet.size,
      newRows: rows.length - existingSet.size
    };
  }

  report.criticalErrors = report.integrity.filter(x => x.level === 'error');
  report.warnings = report.integrity.filter(x => x.level !== 'error');
  return report;
}

function _reportSummary(report) {
  const totalIncoming = Object.values(report.counts || {}).reduce((a, b) => a + (b || 0), 0);
  const totalExisting = Object.values(report.existing || {}).reduce((a, b) => a + (b.existingById || 0), 0);
  const lines = [
    `Família: ${report.family_id || '—'}`,
    `Registros no backup: ${totalIncoming}`,
    `Registros que já existem por id: ${totalExisting}`,
    `Erros críticos: ${report.criticalErrors?.length || 0}`,
    `Alertas: ${report.warnings?.length || 0}`
  ];
  return lines.join('\n');
}

function _formatIssues(report, limit = 10) {
  const issues = [...(report.criticalErrors || []), ...(report.warnings || [])].slice(0, limit);
  if (!issues.length) return 'Nenhum problema estrutural detectado.';
  return issues.map(i => `• ${i.message}${i.rowId ? ` [row ${i.rowId}]` : ''}`).join('\n');
}

async function previewBackupDryRun(backupLike) {
  const payload = _normalizePayload(backupLike);
  const fid = backupLike?.family_id || payload?.families?.[0]?.id || await _resolveActiveFamilyId();
  const report = await _buildDryRunReport(payload, fid);
  alert(`Pré-validação do restore\n\n${_reportSummary(report)}\n\n${_formatIssues(report, 12)}`);
  return report;
}
window.previewBackupDryRun = previewBackupDryRun;

async function _safeUpsert(table, rows, opts = {}) {
  if (!rows?.length) return;
  const useFamilyFilter = table !== 'families' && table !== 'family_members' && table !== 'scheduled_occurrences';
  for (let i = 0; i < rows.length; i += 200) {
    let batch = rows.slice(i, i + 200);
    if (opts.filterExistingUsers && table === 'family_members') {
      const userIds = [...new Set(batch.map(r => r.user_id).filter(Boolean))];
      const validUsers = await _loadExistingIdSet('app_users', userIds);
      batch = batch.filter(r => validUsers.has(r.user_id));
      if (!batch.length) continue;
    }
    const { error } = await sb.from(table).upsert(batch, { ignoreDuplicates: false });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function _restorePayload(payload, statusEl) {
  const updateStatus = msg => { if (statusEl) statusEl.textContent = msg; };
  const d = _normalizePayload({ data: payload });

  // Families first
  await _safeUpsert('families', d.families || []);
  updateStatus('✓ families ok...');

  // family_members only where app_users exists
  await _safeUpsert('family_members', d.family_members || [], { filterExistingUsers: true });
  updateStatus('✓ family_members ok...');

  await _safeUpsert('account_groups', d.account_groups || []);
  updateStatus('✓ account_groups ok...');

  await _safeUpsert('accounts', d.accounts || []);
  updateStatus('✓ accounts ok...');

  // categories two-pass because of parent_id
  const categories = d.categories || [];
  if (categories.length) {
    const pass1 = categories.map(r => ({ ...r, parent_id: null }));
    await _safeUpsert('categories', pass1);
    await _safeUpsert('categories', categories);
  }
  updateStatus('✓ categories ok...');

  await _safeUpsert('payees', d.payees || []);
  updateStatus('✓ payees ok...');

  await _safeUpsert('budgets', d.budgets || []);
  updateStatus('✓ budgets ok...');

  await _safeUpsert('scheduled_transactions', d.scheduled_transactions || []);
  updateStatus('✓ scheduled_transactions ok...');

  // transactions two-pass because of self references
  const transactions = d.transactions || [];
  if (transactions.length) {
    const pass1 = transactions.map(r => ({ ...r, linked_transfer_id: null, transfer_pair_id: null }));
    await _safeUpsert('transactions', pass1);
    await _safeUpsert('transactions', transactions);
  }
  updateStatus('✓ transactions ok...');

  await _safeUpsert('scheduled_occurrences', d.scheduled_occurrences || []);
  updateStatus('✓ scheduled_occurrences ok...');

  await _safeUpsert('scheduled_run_logs', d.scheduled_run_logs || []);
  updateStatus('✓ scheduled_run_logs ok...');

  await _safeUpsert('price_items', d.price_items || []);
  updateStatus('✓ price_items ok...');

  await _safeUpsert('price_stores', d.price_stores || []);
  updateStatus('✓ price_stores ok...');

  await _safeUpsert('price_history', d.price_history || []);
  updateStatus('✓ price_history ok...');
}

async function _reloadAfterRestore() {
  const tasks = [
    typeof loadAccounts === 'function' ? loadAccounts() : Promise.resolve(),
    typeof loadCategories === 'function' ? loadCategories() : Promise.resolve(),
    typeof loadPayees === 'function' ? loadPayees() : Promise.resolve(),
    typeof loadTransactions === 'function' ? loadTransactions() : Promise.resolve(),
    typeof loadBudgets === 'function' ? loadBudgets() : Promise.resolve(),
    typeof loadScheduledTransactions === 'function' ? loadScheduledTransactions() : Promise.resolve(),
    typeof loadPriceItems === 'function' ? loadPriceItems() : Promise.resolve(),
    typeof loadPriceStores === 'function' ? loadPriceStores() : Promise.resolve(),
    typeof refreshDashboard === 'function' ? refreshDashboard() : Promise.resolve()
  ];
  await Promise.allSettled(tasks);
  try { populateSelects?.(); } catch (_) {}
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
    if (!fid) throw new Error('Não foi possível determinar a família ativa');
    const payload = await _fetchBackupPayload(fid);
    const counts = _backupCounts(payload);
    const backup = {
      version: BACKUP_VERSION,
      app: 'JF Family FinTrack',
      family_id: fid,
      exported_at: new Date().toISOString(),
      counts,
      data: payload,
    };
    const json = JSON.stringify(backup, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a2   = document.createElement('a');
    a2.href = url;
    a2.download = `FinTrack_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    a2.click();
    URL.revokeObjectURL(url);
    if (status) {
      status.textContent = `✓ ${Object.values(counts).reduce((a,b)=>a+b,0)} registros · ${(json.length / 1024).toFixed(0)} KB`;
      status.style.color = 'var(--green)';
    }
    toast('Backup exportado!', 'success');
  } catch (e) {
    if (status) { status.textContent = '✗ ' + e.message; status.style.color = 'var(--red)'; }
    toast('Erro ao exportar: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = origText; }
  }
}

async function restoreBackup(event) {
  const file = event.target.files[0];
  if (!file) return;
  const status = document.getElementById('restoreStatus');
  if (status) status.textContent = '⏳ Lendo arquivo...';
  try {
    const backup = JSON.parse(await file.text());
    const payload = _normalizePayload(backup);
    if (!backup.version || !payload) throw new Error('Arquivo de backup inválido');

    const report = await _buildDryRunReport(payload, backup.family_id);
    const ok = confirm(
      `Restaurar backup de ${backup.exported_at?.slice(0, 10) || '?'}?\n\n` +
      `${_reportSummary(report)}\n\n` +
      `${_formatIssues(report, 10)}\n\n` +
      `${report.criticalErrors.length ? 'Há erros críticos. Recomendado cancelar.' : 'Deseja continuar com o restore?'}`
    );
    if (!ok) { if (status) status.textContent = ''; return; }
    if (report.criticalErrors.length) throw new Error('Restore cancelado: backup com erros críticos de integridade.');

    if (status) status.textContent = '⏳ Restaurando...';
    await _restorePayload(payload, status);
    await _reloadAfterRestore();
    if (status) { status.textContent = '✓ Restaurado com sucesso!'; status.style.color = 'var(--green)'; }
    toast('Backup restaurado!', 'success');
  } catch (e) {
    if (status) { status.textContent = '✗ ' + e.message; status.style.color = 'var(--red)'; }
    toast('Erro: ' + e.message, 'error');
  }
  event.target.value = '';
}

// ══════════════════════════════════════════════════════════════════════════
//  SEÇÃO 2 — BACKUP NO BANCO (app_backups)
// ══════════════════════════════════════════════════════════════════════════

let _dbBackupList = [];

async function _checkBackupTable() {
  const { error } = await sb.from('app_backups').select('id').limit(1);
  return !error || !error.message?.includes('does not exist');
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
    if (!fid) {
      toast('Não foi possível determinar a família ativa. Recarregue a página e tente novamente.', 'error');
      return;
    }

    const payload = await _fetchBackupPayload(fid);
    const counts = _backupCounts(payload);

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

    toast('✅ Backup criado no banco!', 'success');
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
    let backupQuery = sb.from('app_backups')
      .select('id, label, created_at, created_by, counts, size_kb, backup_type, family_id')
      .order('created_at', { ascending: false })
      .limit(20);
    if (fid) backupQuery = backupQuery.eq('family_id', fid);

    const { data, error } = await backupQuery;
    if (error) throw error;

    _dbBackupList = data || [];
    document.getElementById('dbBackupMigrationHint')?.style && (document.getElementById('dbBackupMigrationHint').style.display = 'none');

    if (!_dbBackupList.length) {
      container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--muted);font-size:.83rem">
        <div style="font-size:1.8rem;margin-bottom:8px;opacity:.4">🗄️</div>
        Nenhum backup no banco ainda.<br>Clique em "Criar Snapshot" para começar.
      </div>`;
      return;
    }

    container.innerHTML = _dbBackupList.map(b => {
      const dt  = new Date(b.created_at);
      const ago = _timeAgo(dt);
      const typeIcon = b.backup_type === 'auto' ? '🤖' : '👤';
      const total = Object.values(b.counts || {}).reduce((a,b)=>a+(b||0),0);
      return `<div class="db-backup-row">
        <div class="db-backup-row-info">
          <div class="db-backup-row-label">${typeIcon} ${esc(b.label || 'Backup')}</div>
          <div class="db-backup-row-meta">
            ${dt.toLocaleDateString('pt-BR')} ${dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            · <span title="${ago}">${ago}</span>
            · por ${esc(b.created_by || '—')}
            · ${b.size_kb || '?'} KB
          </div>
          <div class="db-backup-row-counts">${total} registros · ${b.counts?.transactions || 0} txs · ${b.counts?.accounts || 0} contas</div>
        </div>
        <div class="db-backup-row-actions">
          <button class="btn btn-ghost btn-sm" onclick="downloadDbBackup('${b.id}')" title="Baixar JSON">⬇️</button>
          <button class="btn btn-ghost btn-sm" onclick="previewDbBackup('${b.id}')" title="Pré-validar restore">🔎</button>
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
      version: BACKUP_VERSION,
      app: 'JF Family FinTrack',
      family_id: data.family_id,
      exported_at: data.created_at,
      source: 'db_backup',
      label: data.label,
      counts: data.counts,
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
    toast('Backup baixado!', 'success');
  } catch (e) {
    toast('Erro ao baixar backup: ' + e.message, 'error');
  }
}

async function previewDbBackup(id) {
  try {
    const { data, error } = await sb.from('app_backups').select('payload,family_id,label').eq('id', id).single();
    if (error) throw error;
    const report = await _buildDryRunReport(_normalizePayload({ data: data.payload }), data.family_id);
    alert(`Pré-validação: ${data.label || 'backup'}\n\n${_reportSummary(report)}\n\n${_formatIssues(report, 12)}`);
  } catch (e) {
    toast('Erro ao pré-validar: ' + e.message, 'error');
  }
}

async function restoreDbBackup(id) {
  const backup = _dbBackupList.find(b => b.id === id);
  const label  = backup?.label || 'este backup';
  const btn = document.querySelector(`[onclick="restoreDbBackup('${id}')"]`);
  if (btn) { btn.disabled = true; btn.textContent = '⏳...'; }

  try {
    const { data, error } = await sb.from('app_backups').select('payload,family_id').eq('id', id).single();
    if (error) throw error;

    const payload = _normalizePayload({ data: data.payload });
    const report = await _buildDryRunReport(payload, data.family_id);
    const ok = confirm(
      `⚠️ Restaurar "${label}"?\n\n` +
      `${_reportSummary(report)}\n\n` +
      `${_formatIssues(report, 10)}\n\n` +
      `${report.criticalErrors.length ? 'Há erros críticos. Recomendado cancelar.' : 'Deseja continuar?'}`
    );
    if (!ok) return;
    if (report.criticalErrors.length) throw new Error('Restore cancelado: backup com erros críticos de integridade.');

    await _restorePayload(payload);
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
  toast('Backup excluído', 'success');
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
  if (diff < 60)     return 'agora mesmo';
  if (diff < 3600)   return `${Math.floor(diff / 60)} min atrás`;
  if (diff < 86400)  return `${Math.floor(diff / 3600)}h atrás`;
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
  if (pin !== getMasterPin()) { alert('❌ PIN incorreto. Operação cancelada.'); return; }
  executeClearDatabase();
}

async function executeClearDatabase() {
  const btn = document.querySelector('[onclick="confirmClearDatabase()"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Limpando...'; }
  try {
    if (!sb || typeof sb.from !== 'function') throw new Error('Supabase não conectado.');
    const tables = [
      'scheduled_occurrences', 'scheduled_transactions', 'transactions',
      'budgets', 'payees', 'categories', 'accounts',
    ];
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
    state.accounts = []; state.categories = []; state.payees = [];
    state.transactions = []; state.budgets = [];
    if (state.scheduled) state.scheduled = [];
    state.txTotal = 0; state.txPage = 0;
    populateSelects();
    if (failed.length > 0) {
      alert('⚠️ Limpeza parcial:\n\n• ' + failed.join('\n• '));
      toast('Limpeza parcial — veja detalhes', 'error');
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
