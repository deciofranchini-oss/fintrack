async function exportBackup() {
  const btn = event.target, orig = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳ Exportando...';
  const status = document.getElementById('backupStatus');
  try {
    const [a,c,p,t,b,s] = await Promise.all([
      sb.from('accounts').select('*'),
      sb.from('categories').select('*'),
      sb.from('payees').select('*'),
      sb.from('transactions').select('*'),
      sb.from('budgets').select('*'),
      famQ(sb.from('scheduled_transactions').select('*')).then(r=>r, () => ({ data:[] })),
    ]);
    const backup = {
      version: '2.0', app: "JF Family FinTrack",
      exported_at: new Date().toISOString(),
      counts: { accounts: a.data?.length||0, transactions: t.data?.length||0 },
      data: {
        accounts: a.data||[], categories: c.data||[], payees: p.data||[],
        transactions: t.data||[], budgets: b.data||[], scheduled: s.data||[],
      }
    };
    const json = JSON.stringify(backup, null, 2);
    const blob = new Blob([json], { type:'application/json' });
    const url  = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `FinTrack_Backup_${new Date().toISOString().slice(0,10)}.json`;
    anchor.click(); URL.revokeObjectURL(url);
    status.textContent = `✓ ${backup.counts.transactions} transações · ${(json.length/1024).toFixed(0)} KB`;
    status.style.color = 'var(--green)';
    toast('Backup exportado!', 'success');
  } catch(e) {
    status.textContent = '✗ ' + e.message; status.style.color = 'var(--red)';
    toast('Erro ao exportar: ' + e.message, 'error');
  } finally { btn.disabled = false; btn.textContent = orig; }
}

async function restoreBackup(event) {
  const file = event.target.files[0]; if (!file) return;
  const status = document.getElementById('restoreStatus');
  status.textContent = '⏳ Lendo arquivo...';
  try {
    const backup = JSON.parse(await file.text());
    if (!backup.version || !backup.data) throw new Error('Arquivo de backup inválido');
    const ok = confirm(
      `Restaurar backup de ${backup.exported_at?.slice(0,10) || '?'}?\n\n` +
      `${backup.counts?.transactions||0} transações · ${backup.counts?.accounts||0} contas\n\n` +
      `Dados existentes serão mantidos (upsert).`
    );
    if (!ok) { status.textContent = ''; return; }
    status.textContent = '⏳ Restaurando...';
    const d = backup.data;
    for (const [table, rows] of [
      ['accounts', d.accounts||[]], ['categories', d.categories||[]],
      ['payees', d.payees||[]], ['transactions', d.transactions||[]],
      ['budgets', d.budgets||[]]
    ]) {
      if (!rows.length) continue;
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await sb.from(table).upsert(rows.slice(i, i+200), { ignoreDuplicates: false });
        if (error) { status.textContent = `✗ ${table}: ${error.message}`; return; }
      }
      status.textContent = `✓ ${table} ok...`;
    }
    await Promise.all([loadAccounts(), loadCategories(), loadPayees()]);
    populateSelects();
    status.textContent = '✓ Restaurado com sucesso!';
    status.style.color = 'var(--green)';
    toast('Backup restaurado!', 'success');
  } catch(e) {
    status.textContent = '✗ ' + e.message; status.style.color = 'var(--red)';
    toast('Erro: ' + e.message, 'error');
  }
  event.target.value = '';
}

/* ══════════════════════════════════════════════════════════════════
   CLEAR DATABASE
══════════════════════════════════════════════════════════════════ */
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
    if (!sb || typeof sb.from !== 'function') {
      throw new Error('Supabase não está conectado. Vá em Configurações e conecte novamente.');
    }

    // Delete in strict dependency order (children first → parents last) to avoid FK constraint errors.
    // .not('id','is',null) is the most reliable way to match ALL rows in PostgREST/Supabase
    // (more reliable than .neq('id', dummyUUID) which can silently fail with RLS).
    const tablesInOrder = [
      'scheduled_occurrences',   // references scheduled_transactions
      'scheduled_transactions',  // references accounts, payees, categories
      'transactions',            // references accounts, payees, categories
      'budgets',                 // references categories
      'payees',                  // references categories
      'categories',              // self-referencing via parent_id — handled specially below
      'accounts'                 // parent of transactions
    ];

    const cleared = [];
    const skipped = [];
    const failed  = [];

    for (const t of tablesInOrder) {
      try {
        // Categories are self-referencing (parent_id), so we must null parent_id first
        if (t === 'categories') {
          try { await sb.from('categories').update({ parent_id: null }).not('id', 'is', null); } catch(e) {}
        }

        const { error } = await sb.from(t).delete().not('id', 'is', null);

        if (error) {
          const msg = (error.message || '').toLowerCase();
          // Table doesn't exist in this project yet — skip gracefully
          if (msg.includes('does not exist') || (msg.includes('relation') && msg.includes('does not exist'))) {
            skipped.push(t);
            continue;
          }
          failed.push(t + ': ' + error.message);
          continue;
        }
        cleared.push(t);
      } catch (tableErr) {
        failed.push(t + ': ' + (tableErr.message || tableErr));
      }
    }

    // Clear this user's sessions (will require re-login), but preserve app_users (login credentials)
    const token = localStorage.getItem('ft_session_token');
    if (token) {
      try { await sb.from('app_sessions').delete().not('id', 'is', null); } catch(e) {}
      localStorage.removeItem('ft_session_token');
      localStorage.removeItem('ft_user_id');
    }

    // Reset all in-memory state
    state.accounts = []; state.categories = []; state.payees = [];
    state.transactions = []; state.budgets = [];
    if (state.scheduled) state.scheduled = [];
    state.txTotal = 0; state.txPage = 0;

    populateSelects();

    if (failed.length > 0) {
      alert('⚠️ Limpeza parcial — erros encontrados:\n\n• ' + failed.join('\n• '));
      toast('Limpeza parcial — veja detalhes', 'error');
    } else {
      toast('✓ Base de dados limpa! (' + cleared.length + ' tabelas apagadas)', 'success');
    }

    // Re-login required since sessions were cleared
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('loginEmail').value = '';
    document.getElementById('loginPassword').value = '';

  } catch(e) {
    toast('Erro ao limpar dados: ' + (e?.message || e), 'error');
    console.error('executeClearDatabase error:', e);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⚠️ Limpar Tudo'; }
  }
}




/* ══════════════════════════════════════════════════════════════════
   MULTI-USER AUTH SYSTEM
   - Login via email/password (SHA-256 hash stored in app_users)
   - Session token in localStorage (expires 30 days)
   - Role: admin | user | viewer
   - First login for master admin forces password change
══════════════════════════════════════════════════════════════════ */
