// ── backup.js — Backup local (JSON) + Backup no banco (Supabase) ───────────

const BACKUP_VERSION = '4.0';
const BACKUP_APP_NAME = 'JF Family FinTrack';
const BACKUP_CORE_TABLES = [
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
  'price_history',
];
const BACKUP_OPTIONAL_TABLES = [
  'families',
  'family_members',
];
const BACKUP_BATCH_SIZE = 200;

function _backupTableCounts(data) {
  const counts = {};
  Object.entries(data || {}).forEach(([k, rows]) => { counts[k] = Array.isArray(rows) ? rows.length : 0; });
  return counts;
}

function _backupSummary(counts) {
  return [
    `${counts.transactions || 0} transações`,
    `${counts.accounts || 0} contas`,
    `${counts.categories || 0} categorias`,
    `${counts.payees || 0} beneficiários`,
    `${counts.scheduled_transactions || 0} programados`,
    `${counts.price_history || 0} históricos de preço`,
  ].join(' · ');
}

function _backupPayloadBytes(payload) {
  try { return JSON.stringify(payload).length; } catch (_) { return 0; }
}

async function _resolveBackupFamilyId() {
  if (currentUser?.family_id) return currentUser.family_id;
  if (currentUser?.preferred_family_id) return currentUser.preferred_family_id;
  if (Array.isArray(currentUser?.families) && currentUser.families.length) return currentUser.families[0].id || null;

  const probes = [
    () => sb.from('accounts').select('family_id').not('family_id', 'is', null).limit(1).maybeSingle(),
    () => sb.from('categories').select('family_id').not('family_id', 'is', null).limit(1).maybeSingle(),
    () => sb.from('families').select('id').limit(1).maybeSingle(),
  ];

  for (const probe of probes) {
    try {
      const { data } = await probe();
      const fid = data?.family_id || data?.id || null;
      if (fid) return fid;
    } catch (_) {}
  }

  return null;
}

async function _selectFamilyRows(table, familyId) {
  if (table === 'families') {
    return sb.from('families').select('*').eq('id', familyId);
  }
  if (table === 'family_members') {
    return sb.from('family_members').select('*').eq('family_id', familyId);
  }
  return sb.from(table).select('*').eq('family_id', familyId);
}

async function _buildBackupSnapshot(familyId) {
  const queries = BACKUP_CORE_TABLES.map(t => _selectFamilyRows(t, familyId));
  const results = await Promise.all(queries);
  const data = {};
  const errors = [];

  BACKUP_CORE_TABLES.forEach((table, idx) => {
    const res = results[idx] || {};
    if (res.error) {
      const isOptional = BACKUP_OPTIONAL_TABLES.includes(table);
      if (!isOptional) errors.push(`${table}: ${res.error.message}`);
      data[table] = [];
      return;
    }
    data[table] = res.data || [];
  });

  if (errors.length) throw new Error(`Falha ao montar backup: ${errors.join(' | ')}`);

  return {
    version: BACKUP_VERSION,
    app: BACKUP_APP_NAME,
    family_id: familyId,
    exported_at: new Date().toISOString(),
    counts: _backupTableCounts(data),
    data,
  };
}

function _normalizeBackupPayload(payload) {
  const data = payload?.data || payload || {};
  return {
    families: data.families || [],
    family_members: data.family_members || [],
    account_groups: data.account_groups || [],
    accounts: data.accounts || [],
    categories: data.categories || [],
    payees: data.payees || [],
    transactions: data.transactions || [],
    budgets: data.budgets || [],
    scheduled_transactions: data.scheduled_transactions || data.scheduled || [],
    scheduled_occurrences: data.scheduled_occurrences || [],
    scheduled_run_logs: data.scheduled_run_logs || [],
    price_items: data.price_items || [],
    price_stores: data.price_stores || [],
    price_history: data.price_history || [],
  };
}

function _chunk(arr, size = BACKUP_BATCH_SIZE) {
  const out = [];
  for (let i = 0; i < (arr?.length || 0); i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function _upsertRows(table, rows, options = {}) {
  if (!rows?.length) return;
  const upsertOptions = options.upsertOptions || { ignoreDuplicates: false };
  for (const part of _chunk(rows)) {
    const { error } = await sb.from(table).upsert(part, upsertOptions);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function _restoreFamiliesAndMembers(data, warnings) {
  const familyRows = data.families || [];
  const memberRows = data.family_members || [];

  if (familyRows.length) {
    try {
      await _upsertRows('families', familyRows, { upsertOptions: { ignoreDuplicates: false } });
    } catch (e) {
      warnings.push(`families: ${e.message}`);
    }
  }

  if (memberRows.length) {
    try {
      const userIds = [...new Set(memberRows.map(r => r.user_id).filter(Boolean))];
      let validIds = new Set();
      if (userIds.length) {
        const { data: users, error } = await sb.from('app_users').select('id').in('id', userIds);
        if (error) throw error;
        validIds = new Set((users || []).map(u => u.id));
      }
      const filtered = memberRows.filter(r => validIds.has(r.user_id));
      if (filtered.length) {
        await _upsertRows('family_members', filtered, { upsertOptions: { onConflict: 'user_id,family_id', ignoreDuplicates: false } });
      }
      const skipped = memberRows.length - filtered.length;
      if (skipped > 0) warnings.push(`family_members: ${skipped} vínculo(s) ignorado(s) porque o usuário não existe em app_users`);
    } catch (e) {
      warnings.push(`family_members: ${e.message}`);
    }
  }
}

async function _restoreCategories(rows) {
  if (!rows?.length) return;
  const base = rows.map(r => ({ ...r, parent_id: null }));
  await _upsertRows('categories', base);
  const withParent = rows.filter(r => r.parent_id);
  for (const part of _chunk(withParent)) {
    for (const row of part) {
      const { error } = await sb.from('categories').update({ parent_id: row.parent_id, updated_at: row.updated_at || new Date().toISOString() }).eq('id', row.id);
      if (error) throw new Error(`categories(parent): ${error.message}`);
    }
  }
}

async function _restoreTransactions(rows) {
  if (!rows?.length) return;
  const base = rows.map(r => ({ ...r, linked_transfer_id: null, transfer_pair_id: null }));
  await _upsertRows('transactions', base);
  const refs = rows.filter(r => r.linked_transfer_id || r.transfer_pair_id);
  for (const row of refs) {
    const patch = {};
    if (row.linked_transfer_id) patch.linked_transfer_id = row.linked_transfer_id;
    if (row.transfer_pair_id) patch.transfer_pair_id = row.transfer_pair_id;
    const { error } = await sb.from('transactions').update(patch).eq('id', row.id);
    if (error) throw new Error(`transactions(refs): ${error.message}`);
  }
}

async function _restoreAllBackupData(payload, onProgress) {
  const data = _normalizeBackupPayload(payload);
  const warnings = [];

  const progress = msg => { if (typeof onProgress === 'function') onProgress(msg); };

  progress('Restaurando família e vínculos...');
  await _restoreFamiliesAndMembers(data, warnings);

  const steps = [
    ['account_groups', data.account_groups, _upsertRows],
    ['accounts', data.accounts, _upsertRows],
    ['categories', data.categories, _restoreCategories],
    ['payees', data.payees, _upsertRows],
    ['budgets', data.budgets, _upsertRows],
    ['scheduled_transactions', data.scheduled_transactions, _upsertRows],
    ['transactions', data.transactions, _restoreTransactions],
    ['scheduled_occurrences', data.scheduled_occurrences, _upsertRows],
    ['scheduled_run_logs', data.scheduled_run_logs, _upsertRows],
    ['price_items', data.price_items, _upsertRows],
    ['price_stores', data.price_stores, _upsertRows],
    ['price_history', data.price_history, _upsertRows],
  ];

  for (const [table, rows, fn] of steps) {
    if (!rows?.length) continue;
    progress(`Restaurando ${table}...`);
    if (fn === _upsertRows) await fn(table, rows);
    else if (fn === _restoreCategories) await fn(rows);
    else if (fn === _restoreTransactions) await fn(rows);
  }

  progress('Recarregando a interface...');
  await _reloadAppDataAfterRestore();

  return { data, warnings };
}

async function _reloadAppDataAfterRestore() {
  try { if (typeof _loadCurrentUserContext === 'function') await _loadCurrentUserContext().catch(()=>{}); } catch (_) {}
  try { if (typeof loadAccounts === 'function') await loadAccounts(); } catch (_) {}
  try { if (typeof loadCategories === 'function') await loadCategories(); } catch (_) {}
  try { if (typeof loadPayees === 'function') await loadPayees(); } catch (_) {}
  try { if (typeof loadBudgets === 'function') await loadBudgets(); } catch (_) {}
  try { if (typeof loadScheduled === 'function') await loadScheduled(); } catch (_) {}
  try { if (typeof _loadPricesData === 'function') await _loadPricesData(); } catch (_) {}
  try { if (typeof populateSelects === 'function') populateSelects(); } catch (_) {}
  try { if (typeof loadTransactions === 'function' && state?.currentPage === 'transactions') await loadTransactions(); } catch (_) {}
  try { if (typeof loadDashboard === 'function' && state?.currentPage === 'dashboard') await loadDashboard(); } catch (_) {}
  try {
    if (typeof _populatePricesStoreFilter === 'function') _populatePricesStoreFilter();
    if (typeof _renderPricesPage === 'function' && state?.currentPage === 'prices') _renderPricesPage();
  } catch (_) {}
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
    const fid = await _resolveBackupFamilyId();
    if (!fid) throw new Error('Não foi possível determinar a família ativa.');
    const backup = await _buildBackupSnapshot(fid);
    const json = JSON.stringify(backup, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a2   = document.createElement('a');
    a2.href = url;
    a2.download = `FinTrack_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    a2.click();
    URL.revokeObjectURL(url);
    if (status) {
      status.textContent = `✓ ${_backupSummary(backup.counts)} · ${(json.length / 1024).toFixed(0)} KB`;
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
    if (!backup.version || !(backup.data || backup.payload)) throw new Error('Arquivo de backup inválido');

    const data = _normalizeBackupPayload(backup);
    const counts = _backupTableCounts(data);
    const ok = confirm(
      `Restaurar backup de ${backup.exported_at?.slice(0, 10) || '?'}?\n\n` +
      `${_backupSummary(counts)}\n\n` +
      `Dados existentes serão mantidos (upsert).`
    );
    if (!ok) { if (status) status.textContent = ''; return; }

    const result = await _restoreAllBackupData(backup, msg => { if (status) status.textContent = `⏳ ${msg}`; });
    if (status) {
      status.textContent = result.warnings.length
        ? `✓ Restaurado com avisos: ${result.warnings.join(' | ')}`
        : '✓ Restaurado com sucesso!';
      status.style.color = result.warnings.length ? 'var(--amber)' : 'var(--green)';
    }
    toast(result.warnings.length ? 'Backup restaurado com avisos' : 'Backup restaurado!', result.warnings.length ? 'warning' : 'success');
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

    const fid = await _resolveBackupFamilyId();
    if (!fid) {
      toast('Não foi possível determinar a família ativa. Recarregue a página e tente novamente.', 'error');
      return;
    }

    const snapshot = await _buildBackupSnapshot(fid);
    const row = {
      family_id: fid,
      label: label || `Backup manual — ${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
      created_by: currentUser?.name || currentUser?.email || 'sistema',
      payload: snapshot.data,
      counts: snapshot.counts,
      size_kb: Math.round(_backupPayloadBytes(snapshot.data) / 1024),
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

    const listFid = await _resolveBackupFamilyId();
    let backupQuery = sb.from('app_backups')
      .select('id, label, created_at, created_by, counts, size_kb, backup_type')
      .order('created_at', { ascending: false })
      .limit(20);
    if (listFid) backupQuery = backupQuery.eq('family_id', listFid);

    const { data, error } = await backupQuery;
    if (error) throw error;

    _dbBackupList = data || [];
    const hint = document.getElementById('dbBackupMigrationHint');
    if (hint?.style) hint.style.display = 'none';

    if (!_dbBackupList.length) {
      container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--muted);font-size:.83rem">
        <div style="font-size:1.8rem;margin-bottom:8px;opacity:.4">🗄️</div>
        Nenhum backup no banco ainda.<br>Clique em "Criar Snapshot" para começar.
      </div>`;
      return;
    }

    container.innerHTML = _dbBackupList.map(b => {
      const dt = new Date(b.created_at);
      const ago = _timeAgo(dt);
      const typeIcon = b.backup_type === 'auto' ? '🤖' : '👤';
      return `<div class="db-backup-row">
        <div class="db-backup-row-info">
          <div class="db-backup-row-label">${typeIcon} ${esc(b.label || 'Backup')}</div>
          <div class="db-backup-row-meta">
            ${dt.toLocaleDateString('pt-BR')} ${dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            · <span title="${ago}">${ago}</span>
            · por ${esc(b.created_by || '—')}
            · ${b.size_kb || '?'} KB
          </div>
          <div class="db-backup-row-counts">${esc(_backupSummary(b.counts || {}))}</div>
        </div>
        <div class="db-backup-row-actions">
          <button class="btn btn-ghost btn-sm" onclick="downloadDbBackup('${b.id}')" title="Baixar JSON">⬇️</button>
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
      app: BACKUP_APP_NAME,
      family_id: data.family_id || (await _resolveBackupFamilyId()),
      exported_at: data.created_at,
      source: 'db_backup',
      label: data.label,
      counts: data.counts,
      data: _normalizeBackupPayload(data.payload),
    };
    const json = JSON.stringify(exportObj, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `FinTrack_Backup_${String(data.created_at).slice(0, 10)}_${String(id).slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Backup baixado!', 'success');
  } catch (e) {
    toast('Erro ao baixar backup: ' + e.message, 'error');
  }
}

async function restoreDbBackup(id) {
  const backup = _dbBackupList.find(b => b.id === id);
  const label = backup?.label || 'este backup';
  if (!confirm(`⚠️ Restaurar "${label}"?\n\nOs dados atuais serão sobrescritos (upsert). Esta ação não pode ser desfeita.\n\nDeseja continuar?`)) return;

  const btn = document.querySelector(`[onclick="restoreDbBackup('${id}')"]`);
  if (btn) { btn.disabled = true; btn.textContent = '⏳...'; }

  try {
    const { data, error } = await sb.from('app_backups').select('payload').eq('id', id).single();
    if (error) throw error;
    const result = await _restoreAllBackupData({ data: data.payload }, msg => {
      if (btn) btn.textContent = `⏳ ${msg.slice(0, 14)}`;
    });
    toast(result.warnings.length ? '✅ Snapshot restaurado com avisos!' : '✅ Snapshot restaurado com sucesso!', result.warnings.length ? 'warning' : 'success');
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
