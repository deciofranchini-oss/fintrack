
(function(){
  function _fmt(v){
    try { return (typeof fmt === 'function') ? fmt(v) : new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v||0)); }
    catch(e){ return String(v ?? 0); }
  }
  function _date(v){
    try { return (typeof fmtDate === 'function') ? fmtDate(v) : new Date(v + 'T12:00:00').toLocaleDateString('pt-BR'); }
    catch(e){ return v || ''; }
  }
  function _esc(s){
    try { return (typeof esc === 'function') ? esc(s) : String(s ?? '').replace(/[&<>\"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[m])); }
    catch(e){ return String(s ?? ''); }
  }

  function _currentFilter(){
    state.txFilter = state.txFilter || { search:'', month:'', account:'', type:'', status:'' };
    return {
      search: (document.getElementById('txSearch')?.value || '').trim(),
      month: document.getElementById('txMonth')?.value || '',
      account: document.getElementById('txAccount')?.value || '',
      type: document.getElementById('txType')?.value || '',
      status: document.getElementById('txStatusFilter')?.value || ''
    };
  }

  function _getOpeningBalance(accountId){
    if(!accountId) return 0;
    const acc = (state.accounts || []).find(a => a.id === accountId);
    return Number(acc?.initial_balance || 0);
  }

  function _computeRunningBalances(rows){
    const sorted = [...rows].sort((a,b)=>{
      const d = String(a.date||'').localeCompare(String(b.date||''));
      if(d !== 0) return d;
      return String(a.id||'').localeCompare(String(b.id||''));
    });

    const balances = {};
    const byAccount = new Map();

    for(const tx of sorted){
      const accountId = tx.account_id || '__none__';
      if(!byAccount.has(accountId)) byAccount.set(accountId, _getOpeningBalance(accountId));
      let bal = byAccount.get(accountId);
      bal += Number(tx.amount || 0);
      byAccount.set(accountId, bal);
      balances[tx.id] = bal;
    }
    return balances;
  }

  window.populateTxMonthFilter = function(){
    const el = document.getElementById('txMonth');
    if(!el) return;
    const current = el.value;
    const months = new Set();
    (state.transactions || []).forEach(t => {
      if(t.date && /^\d{4}-\d{2}/.test(t.date)) months.add(t.date.slice(0,7));
    });
    const ordered = Array.from(months).sort().reverse();
    el.innerHTML = '<option value="">Todos os períodos</option>' + ordered.map(m => `<option value="${m}">${m}</option>`).join('');
    if(current && ordered.includes(current)) el.value = current;
    else if(state.txFilter?.month) el.value = state.txFilter.month;
  };

  window.setTxView = function(view){
    state.txView = view || 'flat';
    document.getElementById('txFlatCard')?.style.setProperty('display', state.txView === 'group' ? 'none' : '');
    document.getElementById('txGroupContainer')?.style.setProperty('display', state.txView === 'group' ? '' : 'none');
    document.getElementById('viewBtnFlat')?.classList.toggle('active', state.txView !== 'group');
    document.getElementById('viewBtnGroup')?.classList.toggle('active', state.txView === 'group');
    loadTransactions();
  };

  window.sortTx = function(field){
    state.txSortField = field || 'date';
    state.txSortAsc = !state.txSortAsc;
    loadTransactions();
  };

  window.filterTransactions = function(){
    state.txPage = 0;
    state.txFilter = _currentFilter();
    loadTransactions();
  };

  window.loadTransactions = async function(){
    try{
      state.txFilter = _currentFilter();
      const res = await DB.transactions.load({
        filter: state.txFilter,
        page: state.txPage || 0,
        pageSize: state.txPageSize || 50,
        sortField: state.txSortField || 'date',
        sortAsc: !!state.txSortAsc,
        view: state.txView || 'flat'
      });
      state.transactions = res.data || [];
      state.txTotal = res.count || 0;
      populateTxMonthFilter();
      _renderTransactions();
      _renderTxPagination();
      _renderTxSummary();
    }catch(e){
      const body = document.getElementById('txBody');
      if(body) body.innerHTML = `<tr><td colspan="3" style="padding:24px;text-align:center;color:#b91c1c">${_esc(e.message || e)}</td></tr>`;
      if(typeof toast === 'function') toast('Erro ao carregar transações: ' + (e.message || e), 'error');
    }
  };

  function _renderTransactions(){
    if((state.txView || 'flat') === 'group') return _renderGroupView();
    const body = document.getElementById('txBody');
    if(!body) return;

    const rows = state.transactions || [];
    const balances = _computeRunningBalances(rows);

    if(!rows.length){
      body.innerHTML = '<tr><td colspan="3" style="padding:28px;text-align:center;color:var(--muted)">Nenhuma transação encontrada.</td></tr>';
      return;
    }

    body.innerHTML = rows.map(t => {
      const amount = Number(t.amount || 0);
      const pos = amount >= 0;
      const cat = t.categories?.name || t.category_name || '';
      const payee = t.payees?.name || t.payee_name || '';
      const balance = balances[t.id];
      return `
        <tr>
          <td class="tx-v2-td-date">${_date(t.date)}</td>
          <td class="tx-v2-td-body">
            <div class="tx-line-title">${_esc(t.description || '')}</div>
            ${cat ? `<div class="tx-line-category">${_esc(cat)}</div>` : ''}
            ${payee ? `<div class="tx-line-meta">${_esc(payee)}</div>` : ''}
            <div class="tx-line-balance" style="font-size:.77rem;color:var(--muted);margin-top:2px">Saldo: ${_fmt(balance)}</div>
          </td>
          <td class="tx-v2-td-right" style="font-weight:700;color:${pos ? 'var(--green,#15803d)' : 'var(--red,#b91c1c)'}">${_fmt(amount)}</td>
        </tr>
      `;
    }).join('');

    const countEl = document.getElementById('txCount');
    if(countEl) countEl.textContent = `${state.txTotal || rows.length} transações`;
  }

  function _renderGroupView(){
    const wrap = document.getElementById('txGroupContainer');
    if(!wrap) return;
    const rows = state.transactions || [];
    if(!rows.length){
      wrap.innerHTML = '<div class="card" style="padding:24px;text-align:center;color:var(--muted)">Nenhuma transação encontrada.</div>';
      return;
    }
    const map = new Map();
    rows.forEach(t => {
      const key = t.account_id || '__none__';
      if(!map.has(key)) map.set(key, []);
      map.get(key).push(t);
    });
    wrap.innerHTML = Array.from(map.entries()).map(([accountId, items]) => {
      const acc = (state.accounts || []).find(a => a.id === accountId);
      const balances = _computeRunningBalances(items);
      return `
        <div class="card" style="padding:14px;margin-bottom:12px">
          <div style="font-weight:800;margin-bottom:10px">${_esc(acc?.name || 'Sem conta')}</div>
          <div style="display:grid;gap:8px">
            ${items.map(t => `
              <div style="display:grid;grid-template-columns:92px 1fr auto;gap:10px;align-items:start;border-top:1px solid var(--border);padding-top:8px">
                <div style="font-size:.82rem;color:var(--muted)">${_date(t.date)}</div>
                <div>
                  <div style="font-weight:600">${_esc(t.description || '')}</div>
                  ${t.categories?.name ? `<div style="font-size:.76rem;color:var(--muted)">${_esc(t.categories.name)}</div>` : ''}
                  ${t.payees?.name ? `<div style="font-size:.76rem;color:var(--muted)">${_esc(t.payees.name)}</div>` : ''}
                  <div style="font-size:.76rem;color:var(--muted)">Saldo: ${_fmt(balances[t.id])}</div>
                </div>
                <div style="font-weight:700">${_fmt(t.amount)}</div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');
  }

  function _renderTxPagination(){
    const el = document.getElementById('txPagination');
    if(!el) return;
    const pageSize = state.txPageSize || 50;
    const total = state.txTotal || 0;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = state.txPage || 0;
    if(pages <= 1){
      el.innerHTML = '';
      return;
    }
    el.innerHTML = `
      <button class="btn btn-ghost btn-sm" ${page <= 0 ? 'disabled' : ''} onclick="state.txPage=Math.max(0,(state.txPage||0)-1);loadTransactions()">◀</button>
      <span style="padding:0 8px">Página ${page + 1} de ${pages}</span>
      <button class="btn btn-ghost btn-sm" ${page >= pages-1 ? 'disabled' : ''} onclick="state.txPage=Math.min(${pages-1},(state.txPage||0)+1);loadTransactions()">▶</button>
    `;
  }

  function _renderTxSummary(){
    const rows = state.transactions || [];
    const income = rows.filter(t => Number(t.amount||0) > 0).reduce((s,t)=>s+Number(t.amount||0),0);
    const expense = rows.filter(t => Number(t.amount||0) < 0).reduce((s,t)=>s+Number(t.amount||0),0);
    const incEl = document.getElementById('txTotalIncome');
    const expEl = document.getElementById('txTotalExpense');
    if(incEl) incEl.textContent = `Receitas ${_fmt(income)}`;
    if(expEl) expEl.textContent = `Despesas ${_fmt(expense)}`;
  }
})();
