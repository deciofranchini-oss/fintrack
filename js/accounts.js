
(function(){
  function _fmt(v){
    try { return (typeof fmt === 'function') ? fmt(v) : new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v||0)); }
    catch(e){ return String(v ?? 0); }
  }
  function _esc(s){
    try { return (typeof esc === 'function') ? esc(s) : String(s ?? '').replace(/[&<>\"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[m])); }
    catch(e){ return String(s ?? ''); }
  }

  let _accountTypeFilter = '';

  window.filterAccounts = function(type){
    _accountTypeFilter = type || '';
    renderAccounts();
    try{
      document.querySelectorAll('#accountsTabBar .tab').forEach(btn => btn.classList.remove('active'));
      const match = Array.from(document.querySelectorAll('#accountsTabBar .tab')).find(btn => (btn.getAttribute('onclick')||'').includes(`'${type}'`));
      if(match) match.classList.add('active');
    }catch(e){}
  };

  window.renderAccounts = function(){
    const grid = document.getElementById('accountGrid');
    if(!grid) return;

    const accounts = Array.isArray(state.accounts) ? [...state.accounts] : [];
    const groups = state.groups || state.accountGroups || [];

    let list = accounts;
    if(_accountTypeFilter && _accountTypeFilter !== '__group__'){
      list = list.filter(a => a.type === _accountTypeFilter);
    }

    if(!list.length){
      grid.innerHTML = '<div class="card" style="padding:24px;text-align:center;color:var(--muted)">Nenhuma conta encontrada.</div>';
      return;
    }

    if(_accountTypeFilter === '__group__'){
      const byGroup = new Map();
      list.forEach(a=>{
        const gid = a.group_id || '__ungrouped__';
        if(!byGroup.has(gid)) byGroup.set(gid, []);
        byGroup.get(gid).push(a);
      });

      grid.innerHTML = Array.from(byGroup.entries()).map(([gid, items])=>{
        const g = groups.find(x => x.id === gid);
        const gname = g ? `${g.emoji || '🗂️'} ${_esc(g.name)}` : 'Sem grupo';
        return `
          <div class="card" style="padding:14px">
            <div style="font-weight:700;margin-bottom:10px">${gname}</div>
            <div style="display:grid;gap:10px">
              ${items.map(renderAccountCard).join('')}
            </div>
          </div>
        `;
      }).join('');
      return;
    }

    grid.innerHTML = list.map(renderAccountCard).join('');
  };

  function renderAccountCard(a){
    const group = (state.groups || state.accountGroups || []).find(g => g.id === a.group_id);
    const color = a.color || 'var(--accent)';
    const icon = a.icon || (a.type === 'cartao_credito' ? '💳' : a.type === 'investimento' ? '📈' : a.type === 'dinheiro' ? '💵' : '🏦');
    const balance = (a.balance != null ? a.balance : (Number(a.initial_balance||0)));
    const groupHtml = group ? `<div style="font-size:.78rem;color:var(--muted);margin-top:4px">${_esc(group.emoji || '🗂️')} ${_esc(group.name)}</div>` : '';
    return `
      <div class="card" style="padding:14px;border-left:4px solid ${_esc(color)}">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
          <div>
            <div style="font-weight:700">${icon} ${_esc(a.name)}</div>
            <div style="font-size:.82rem;color:var(--muted)">${_esc(a.currency || 'BRL')} • ${_esc(a.type || '')}</div>
            ${groupHtml}
          </div>
          <div style="text-align:right">
            <div style="font-weight:800">${_fmt(balance)}</div>
            <div style="font-size:.76rem;color:var(--muted)">Saldo atual</div>
          </div>
        </div>
      </div>
    `;
  }
})();
