async function loadAccounts(force=false){
  try { await DB.accounts.load(force); }
  catch(e) { toast(e.message,'error'); }
}

async function recalcAccountBalances() {
  await DB.accounts.recalcBalances();
}

let _accountsViewMode='';
// ── Consolidar Saldo da Conta ──────────────────────────────────────────────
function openConsolidateModal(accountId) {
  const a = (state.accounts || []).find(x => x.id === accountId);
  if (!a) { toast(t('account.not_found'), 'error'); return; }
  document.getElementById('consolidateAccountId').value = accountId;
  document.getElementById('consolidateAccountName').textContent = a.name;
  const cur = a.currency || 'BRL';
  document.getElementById('consolidateCurrencyBadge').textContent = cur;
  const balEl = document.getElementById('consolidateCurrentBalance');
  balEl.textContent = fmt(a.balance, cur);
  balEl.style.color = a.balance >= 0 ? 'var(--accent)' : 'var(--red)';
  setAmtField('consolidateAmount', 0);
  document.getElementById('consolidateDate').value = new Date().toISOString().slice(0,10);
  document.getElementById('consolidateDesc').value = 'Consolidação de saldo';
  document.getElementById('consolidatePreview').style.display = 'none';
  document.getElementById('consolidateError').style.display = 'none';
  // Reset sign state to positive
  if (typeof _amtSignState !== 'undefined') _amtSignState['consolidateAmount'] = false;
  const signBtn = document.getElementById('consolidateAmountSignBtn');
  if (signBtn) { signBtn.textContent = '+'; signBtn.classList.remove('negative'); signBtn.classList.add('positive'); }
  openModal('consolidateModal');
  // Bind the same decimal money mask used in tx/sched modals
  setTimeout(() => {
    const amtEl = document.getElementById('consolidateAmount');
    if (amtEl && typeof bindMoneyInput === 'function') {
      amtEl._moneyBound = false; // force rebind in case of re-open
      bindMoneyInput(amtEl);
      amtEl.value = '0,00';
    }
  }, 60);
}

// ── Decimal auto-format for consolidate amount — handled by bindMoneyInput ──
// (see ui_helpers.js — consolidateAmount is in the initMoneyInputs list)

function _updateConsolidatePreview() {
  const accId = document.getElementById('consolidateAccountId')?.value;
  const a = (state.accounts||[]).find(x => x.id === accId);
  if (!a) return;
  const cur = a.currency || 'BRL';
  const target = getAmtField('consolidateAmount');
  const current = parseFloat(a.balance) || 0;
  const diff = target - current;
  const preview = document.getElementById('consolidatePreview');
  if (!preview) return;
  if (Math.abs(diff) < 0.005) {
    preview.style.display = '';
    preview.innerHTML = '<span style="color:var(--muted)">✓ Sem diferença — nenhum ajuste necessário.</span>';
    return;
  }
  const isPos = diff > 0;
  preview.style.display = '';
  preview.style.borderColor = isPos ? 'var(--green,#16a34a)' : 'var(--red)';
  preview.innerHTML = `<strong style="color:${isPos?'var(--green,#16a34a)':'var(--red)'}">${isPos?'+':''}${fmt(diff,cur)} de ajuste</strong><br><span style="font-size:.78rem;color:var(--muted)">Atual: ${fmt(current,cur)} → Novo: ${fmt(target,cur)}</span>`;
}

async function saveConsolidation() {
  const accId = document.getElementById('consolidateAccountId')?.value;
  const a = (state.accounts||[]).find(x => x.id === accId);
  if (!a) return;
  const cur = a.currency || 'BRL';
  const target = getAmtField('consolidateAmount');
  const current = parseFloat(a.balance) || 0;
  const diff = +(target - current).toFixed(10);
  const errEl = document.getElementById('consolidateError');
  errEl.style.display = 'none';
  if (Math.abs(diff) < 0.005) { toast(t('toast.no_diff'), 'info'); closeModal('consolidateModal'); return; }
  const date = document.getElementById('consolidateDate')?.value || new Date().toISOString().slice(0,10);
  const desc = document.getElementById('consolidateDesc')?.value?.trim() || 'Consolidação de saldo';
  const btn = document.getElementById('consolidateSaveBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Salvando...'; }
  try {
    const { error } = await sb.from('transactions').insert({
      account_id: accId, date, amount: diff, currency: cur,
      brl_amount: cur === 'BRL' ? diff : null,
      description: desc, status: 'confirmed',
      is_transfer: false, family_id: famId(),
    });
    if (error) throw error;
    DB.accounts.bust();
    try { await recalcAccountBalances(); } catch(_) {}
    toast(`✓ Ajuste de ${fmt(diff,cur)} criado!`, 'success');
    closeModal('consolidateModal');
    if (state.currentPage === 'accounts') renderAccounts();
    if (state.currentPage === 'transactions') loadTransactions();
    if (state.currentPage === 'dashboard') loadDashboard();
  } catch(e) {
    errEl.textContent = 'Erro: ' + e.message;
    errEl.style.display = '';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⚖️ Criar Ajuste'; }
  }
}


function renderAccounts(ft=''){
  _accountsViewMode=ft;
  const grid=document.getElementById('accountGrid');
  if(!grid) return;
  state.groups = state.groups || [];
  let accs=state.accounts || [];
  if(ft==='__group__'){
    if(!state.groups.length){ renderAccountsFlat(accs,grid); return; }
    renderAccountsGrouped(accs,grid);
  } else if(ft==='__fav__'){
    renderAccountsFlat(accs.filter(a=>a.is_favorite), grid);
  } else {
    renderAccountsFlat(ft?accs.filter(a=>a.type===ft):accs,grid);
  }
  renderAccountsSummary();
  // Sync active tab to current view mode
  _syncAccountsTab(ft);
  try { renderGroupManager(); } catch(e) {}
}

function _syncAccountsTab(ft) {
  document.querySelectorAll('#page-accounts .tab').forEach(t => t.classList.remove('active'));
  // Find the tab whose onclick matches the current ft
  const map = {
    '__fav__':         'accTabFav',
    '':                'accTabAll',
  };
  if (map[ft]) {
    document.getElementById(map[ft])?.classList.add('active');
  } else {
    // Type tabs — match by onclick text
    document.querySelectorAll('#accountsTabBar .tab').forEach(t => {
      if (t.getAttribute('onclick')?.includes(`'${ft}'`)) t.classList.add('active');
    });
  }
}


function renderAccountsFlat(accs,grid){
  if(!accs.length){grid.innerHTML=`<div class="empty-state" style="grid-column:1/-1"><div class="es-icon">🏦</div><p>${t('acct.empty')}</p></div>`;return;}
  // Favoritas no topo (Feature 7)
  const sorted = [...accs].sort((a,b)=>(b.is_favorite?1:0)-(a.is_favorite?1:0));
  grid.innerHTML=sorted.map(a=>accountCardHTML(a)).join('');
}

function renderAccountsGrouped(accs,grid){
  const sections=[];
  state.groups.forEach(g=>{
    const ga=accs.filter(a=>a.group_id===g.id);
    if(ga.length)sections.push({g,accs:ga});
  });
  const ungrouped=accs.filter(a=>!a.group_id);

  if(!sections.length&&!ungrouped.length){
    grid.innerHTML='<div class="empty-state"><div class="es-icon">🗂️</div><p>Nenhum grupo criado ainda.</p></div>';
    return;
  }

  const _collapsed = JSON.parse(sessionStorage.getItem('ft_grp_collapsed')||'{}');

  grid.innerHTML = sections.map(({g, accs:ga})=>{
    const currency = g.currency || 'BRL';
    // Converte contas em moeda estrangeira para a moeda do grupo (ou BRL) antes de somar
    const _toGrp = (a) => { const ac = a.currency||'BRL'; if(ac===currency) return a.balance; return toBRL(a.balance,ac) / (currency==='BRL'?1:getFxRate(currency)); };
    const bal = ga.reduce((s,a)=>s+_toGrp(a),0);
    const color = g.color||'var(--accent)';
    const isCollapsed = !!_collapsed[g.id];
    const pos = ga.filter(a=>_toGrp(a)>=0).reduce((s,a)=>s+_toGrp(a),0);
    const neg = ga.filter(a=>_toGrp(a)<0).reduce((s,a)=>s+_toGrp(a),0);

    return `<div class="account-group-section" id="grp-${g.id}" data-grp="${g.id}">
      <div class="account-group-header account-group-header--clickable"
           onclick="toggleGroupCollapse('${g.id}')"
           style="--grp-color:${color}">
        <span class="account-group-badge" style="background:${color}22;color:${color}">${g.emoji||'🗂️'}</span>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
            <span class="account-group-title">${esc(g.name)}</span>
            <span class="account-group-count">${ga.length} conta${ga.length!==1?'s':''}</span>
          </div>
          <div style="display:flex;align-items:center;gap:10px;margin-top:3px;flex-wrap:wrap">
            <span class="account-group-sum ${bal<0?'text-red':''}" style="color:${bal<0?'var(--red)':color}">${fmt(bal,currency)}</span>
            ${pos&&neg?`<span style="font-size:.72rem;color:var(--green,#16a34a)">+${fmt(pos,currency)}</span><span style="font-size:.72rem;color:var(--red)">${fmt(neg,currency)}</span>`:''}
          </div>
        </div>
        <div class="account-group-actions" onclick="event.stopPropagation()">
          <button class="btn-icon" onclick="openGroupModal('${g.id}')" title="Editar grupo" style="font-size:.8rem">✏️</button>
        </div>
        <span class="account-group-chevron ${isCollapsed?'':'expanded'}" style="color:${color}">▾</span>
      </div>
      <div class="account-group-body ${isCollapsed?'collapsed':''}">
        <div class="account-grid" style="margin-top:8px">${ga.map(a=>accountCardHTML(a)).join('')}</div>
      </div>
    </div>`;
  }).join('')+(ungrouped.length?`<div class="account-group-section" id="grp-__none__" data-grp="__none__">
    <div class="account-group-header account-group-header--clickable"
         onclick="toggleGroupCollapse('__none__')"
         style="--grp-color:var(--muted)">
      <span class="account-group-badge" style="background:var(--bg2)">📂</span>
      <div style="flex:1;min-width:0">
        <span class="account-group-title">${t('acct.no_group')}</span>
        <span class="account-group-count" style="margin-left:8px">${ungrouped.length} conta${ungrouped.length!==1?'s':''}</span>
      </div>
      <span class="account-group-chevron ${_collapsed['__none__']?'':'expanded'}">▾</span>
    </div>
    <div class="account-group-body ${_collapsed['__none__']?'collapsed':''}">
      <div class="account-grid" style="margin-top:8px">${ungrouped.map(a=>accountCardHTML(a)).join('')}</div>
    </div>
  </div>`:'');
}

function toggleGroupCollapse(id){
  const el = document.getElementById('grp-'+id);
  if(!el) return;
  const body = el.querySelector('.account-group-body');
  const chevron = el.querySelector('.account-group-chevron');
  const isNowCollapsed = body.classList.toggle('collapsed');
  chevron.classList.toggle('expanded', !isNowCollapsed);
  const saved = JSON.parse(sessionStorage.getItem('ft_grp_collapsed')||'{}');
  if(isNowCollapsed) saved[id]=1; else delete saved[id];
  sessionStorage.setItem('ft_grp_collapsed', JSON.stringify(saved));
}

function renderAccountsSummary(){
  const el=document.getElementById('accountsSummary');if(!el)return;
  const accs=state.accounts;
  const total=accs.reduce((s,a)=>s+toBRL(parseFloat(a.balance)||0,a.currency||'BRL'),0);
  const pos=accs.filter(a=>a.balance>=0).reduce((s,a)=>s+toBRL(parseFloat(a.balance)||0,a.currency||'BRL'),0);
  const neg=accs.filter(a=>a.balance<0).reduce((s,a)=>s+toBRL(parseFloat(a.balance)||0,a.currency||'BRL'),0);
  el.innerHTML=`<span class="summary-label">${t('acct.total')}</span><span class="summary-value ${total<0?'text-red':'text-accent'}">${fmt(total)}</span>${pos?`<span class="summary-sep">·</span><span class="summary-pos">+${fmt(pos)}</span>`:''}${neg?`<span class="summary-sep">·</span><span class="summary-neg">${fmt(neg)}</span>`:''}`;
}

function accountCardHTML(a){
  const favStar = `<span
    onclick="event.stopPropagation();toggleAccountFavorite('${a.id}',${!!a.is_favorite})"
    title="${a.is_favorite?'Remover dos favoritos':'Adicionar aos favoritos'}"
    style="position:absolute;top:6px;left:8px;font-size:.9rem;cursor:pointer;transition:transform .15s;z-index:2;user-select:none"
    onmouseover="this.style.transform='scale(1.25)'" onmouseout="this.style.transform=''"
    id="favStar-${a.id}">${a.is_favorite ? '⭐' : '<span style="opacity:.3;font-size:.8rem">☆</span>'}</span>`;
  const dueLine = (a.type==='cartao_credito' && a.due_day)
    ? `<div style="font-size:.68rem;color:var(--muted);margin-top:2px">Vence dia ${a.due_day}</div>` : '';
  return `<div class="account-card" onclick="goToAccountTransactions('${a.id}')" style="position:relative">
    ${favStar}
    <div class="account-card-stripe" style="background:${a.color||'var(--accent)'}"></div>
    <div class="account-actions"><button class="btn-icon" title="Consolidar saldo" onclick="event.stopPropagation();openConsolidateModal('${a.id}')">⚖️</button><button class="btn-icon" onclick="event.stopPropagation();openAccountModal('${a.id}')">✏️</button><button class="btn-icon" onclick="event.stopPropagation();deleteAccount('${a.id}')">🗑️</button></div>
    <div class="account-icon" style="font-size:1.6rem;margin-bottom:8px">${renderIconEl(a.icon,a.color,36)}</div>
    <div class="account-name">${esc(a.name)}</div>
    <div class="account-type">${accountTypeLabel(a.type)}</div>
    <div class="account-balance ${a.balance<0?'text-red':'text-accent'}">${fmt(a.balance,a.currency)}</div>
    <div class="account-currency">${a.currency}</div>
    ${dueLine}
  </div>`;
}

function goToAccountTransactions(accountId){
  state.txFilter.account=accountId;
  state.txFilter.month='';
  state.txPage=0;
  const el=document.getElementById('txAccount');if(el)el.value=accountId;
  const monthEl=document.getElementById('txMonth');if(monthEl)monthEl.value='';
  navigate('transactions');
}

function filterAccounts(type){
  renderAccounts(type);
}

function accountTypeLabel(t){
  return{corrente:'Conta Corrente',poupanca:'Poupança',cartao_credito:'Cartão de Crédito',investimento:'Investimentos',dinheiro:'Dinheiro',outros:'Outros'}[t]||t;
}

async function openAccountModal(id=''){
  const form={id:'',name:'',type:'corrente',currency:'BRL',initial_balance:0,icon:'',color:'#2a6049',is_brazilian:false,iof_rate:3.5,group_id:'',is_favorite:false,best_purchase_day:null,due_day:null};
  if(id){
    const a=state.accounts.find(x=>x.id===id);
    if(a){Object.assign(form,a);form.initial_balance=parseFloat(a.initial_balance)||0;}
  }
  document.getElementById('accountId').value=form.id;
  document.getElementById('accountName').value=form.name;
  document.getElementById('accountType').value=form.type;
  document.getElementById('accountCurrency').value=form.currency;
  setAmtField('accountBalance', form.initial_balance);
  document.getElementById('accountIcon').value=form.icon||'';
  document.getElementById('accountColor').value=form.color||'#2a6049';
  document.getElementById('accountModalTitle').textContent=id?'Editar Conta':'Nova Conta';
  const gSel=document.getElementById('accountGroupId');
  if(gSel){
    if(!state.groups||!state.groups.length){try{await loadGroups();}catch(_e){}}
    gSel.innerHTML='<option value="">— Sem grupo —</option>'+(state.groups||[]).map(g=>`<option value="${g.id}">${g.emoji||'🗂️'} ${esc(g.name)}</option>`).join('');
    gSel.value=form.group_id||'';
  }
  // Favorite (Feature 7)
  const favEl=document.getElementById('accountIsFavorite');
  if(favEl) favEl.checked=!!form.is_favorite;
  // Credit card config
  const isCC=form.type==='cartao_credito';
  const iofConfig=document.getElementById('accountIofConfig');
  if(iofConfig)iofConfig.style.display=isCC?'':'none';
  const cardDates=document.getElementById('accountCardDatesConfig');
  if(cardDates)cardDates.style.display=isCC?'':'none';
  const isBREl=document.getElementById('accountIsBrazilian');
  if(isBREl)isBREl.checked=!!form.is_brazilian;
  const iofRateEl=document.getElementById('accountIofRate');
  if(iofRateEl)iofRateEl.value=form.iof_rate||3.5;
  const iofRateGrp=document.getElementById('accountIofRateGroup');
  if(iofRateGrp)iofRateGrp.style.display=form.is_brazilian?'':'none';
  // Card dates (Feature 8)
  const bpdEl=document.getElementById('accountBestPurchaseDay');
  if(bpdEl) bpdEl.value=form.best_purchase_day||'';
  const ddEl=document.getElementById('accountDueDay');
  if(ddEl) ddEl.value=form.due_day||'';
  setTimeout(()=>syncIconPickerToValue(form.icon||'',form.color||'#2a6049'),50);
  openModal('accountModal');
}

async function saveAccount(){
  const id=document.getElementById('accountId').value;
  const isCC=document.getElementById('accountType').value==='cartao_credito';
  const isBREl=document.getElementById('accountIsBrazilian');
  const isBR=isCC&&isBREl&&isBREl.checked;
  const gSel=document.getElementById('accountGroupId');
  const gid=gSel?gSel.value||null:null;
  const iofRateEl=document.getElementById('accountIofRate');
  const favEl=document.getElementById('accountIsFavorite');
  const bpdEl=document.getElementById('accountBestPurchaseDay');
  const ddEl=document.getElementById('accountDueDay');
  const data={
    name:document.getElementById('accountName').value.trim(),
    type:document.getElementById('accountType').value,
    currency:document.getElementById('accountCurrency').value,
    initial_balance:getAmtField('accountBalance'),
    icon:document.getElementById('accountIcon').value||'',
    color:document.getElementById('accountColor').value,
    is_brazilian:isBR,
    iof_rate:isBR?(parseFloat(iofRateEl&&iofRateEl.value)||3.5):null,
    group_id:gid,
    is_favorite: favEl ? !!favEl.checked : false,
    best_purchase_day: isCC&&bpdEl&&bpdEl.value ? (parseInt(bpdEl.value)||null) : null,
    due_day: isCC&&ddEl&&ddEl.value ? (parseInt(ddEl.value)||null) : null,
    updated_at:new Date().toISOString()
  };
  if(!data.name){toast(t('toast.err_account_name'),'error');return;}
  if(!id) data.family_id=famId();
  let err;
  if(id){({error:err}=await sb.from('accounts').update(data).eq('id',id));}
  else{({error:err}=await sb.from('accounts').insert(data));}
  if(err){toast(err.message,'error');return;}
  toast(id?'Conta atualizada!':'Conta criada!','success');
  closeModal('accountModal');
  await loadAccounts();
  if(typeof populateSelects==='function') populateSelects();
  if(state.currentPage==='accounts')renderAccounts(_accountsViewMode);
  if(state.currentPage==='dashboard')loadDashboard();
}

/* ════════════════════════════════════════════════════
   DELETE ACCOUNT — modal flow
════════════════════════════════════════════════════ */
let _delAccId = null; // account being deleted

async function deleteAccount(id) {
  const acc = state.accounts.find(a => a.id === id);
  if (!acc) return;
  _delAccId = id;

  // Populate summary
  document.getElementById('delAccIcon').innerHTML =
    typeof renderIconEl === 'function'
      ? renderIconEl(acc.icon, acc.color, 28)
      : `<span style="font-size:1.3rem">${acc.icon || '🏦'}</span>`;
  document.getElementById('delAccName').textContent = acc.name;
  document.getElementById('delAccMeta').textContent =
    (accountTypeLabel ? accountTypeLabel(acc.type) : acc.type) + ' · ' + (acc.currency || 'BRL');
  const balEl = document.getElementById('delAccBalance');
  balEl.textContent = fmt(acc.balance, acc.currency);
  balEl.style.color = acc.balance < 0 ? 'var(--red)' : 'var(--accent)';

  // Count transactions + scheduled
  const [{ count: txCount }, { count: scCount }] = await Promise.all([
    famQ(sb.from('transactions').select('id', { count: 'exact', head: true })).eq('account_id', id),
    famQ(sb.from('scheduled_transactions').select('id', { count: 'exact', head: true })).eq('account_id', id),
  ]);
  const total = (txCount || 0) + (scCount || 0);

  const warnEl = document.getElementById('delAccWarning');
  const warnTx = document.getElementById('delAccWarningText');
  if (total > 0) {
    warnTx.textContent = ` Esta conta possui ${txCount || 0} transação(ões) e ${scCount || 0} transação(ões) programada(s).`;
    warnEl.style.display = '';
  } else {
    warnEl.style.display = 'none';
  }

  // Populate target account select (other active accounts)
  const sel = document.getElementById('delAccTargetSelect');
  sel.innerHTML = '<option value="">— Selecione a conta —</option>' +
    state.accounts
      .filter(a => a.id !== id && a.active !== false)
      .map(a => `<option value="${a.id}">${esc(a.name)} (${a.currency})</option>`)
      .join('');

  // Reset options
  document.querySelectorAll('input[name="delAccAction"]').forEach(r => r.checked = false);
  ['delAccTransferTarget','delAccNewAccountForm','delAccConfirmWrap'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
  document.getElementById('delAccNewName').value = '';
  document.getElementById('delAccConfirmInput').value = '';
  document.getElementById('delAccError').style.display = 'none';
  document.getElementById('delAccConfirmBtn').disabled = true;

  openModal('deleteAccountModal');
}

function onDelAccOptionChange() {
  const val = document.querySelector('input[name="delAccAction"]:checked')?.value;
  document.getElementById('delAccTransferTarget').style.display  = val === 'transfer'    ? '' : 'none';
  document.getElementById('delAccNewAccountForm').style.display  = val === 'new_account' ? '' : 'none';
  document.getElementById('delAccConfirmWrap').style.display     = val === 'delete_all'  ? '' : 'none';
  // Enable button for transfer/new, wait for confirm text for delete_all
  const btn = document.getElementById('delAccConfirmBtn');
  if (val === 'transfer' || val === 'new_account') btn.disabled = false;
  else if (val === 'delete_all') btn.disabled = true;
  else btn.disabled = true;
}

function onDelAccConfirmType() {
  const val = document.getElementById('delAccConfirmInput').value.trim().toUpperCase();
  document.getElementById('delAccConfirmBtn').disabled = val !== 'EXCLUIR';
}

async function confirmDeleteAccount() {
  const action  = document.querySelector('input[name="delAccAction"]:checked')?.value;
  const errEl   = document.getElementById('delAccError');
  const btn     = document.getElementById('delAccConfirmBtn');
  errEl.style.display = 'none';

  if (!action) {
    errEl.textContent = 'Selecione uma opção antes de continuar.';
    errEl.style.display = '';
    return;
  }
  if (!_delAccId) return;

  const showErr = (msg) => { errEl.textContent = msg; errEl.style.display = ''; };
  btn.disabled = true;
  btn.textContent = '⏳ Processando...';

  try {
    let targetAccountId = null;

    // ── Option A: Transfer to existing account ──────────────────────
    if (action === 'transfer') {
      targetAccountId = document.getElementById('delAccTargetSelect').value;
      if (!targetAccountId) { showErr('Selecione a conta destino.'); return; }
    }

    // ── Option B: Create new account ────────────────────────────────
    if (action === 'new_account') {
      const newName = document.getElementById('delAccNewName').value.trim();
      const newType = document.getElementById('delAccNewType').value;
      if (!newName) { showErr('Informe o nome da nova conta.'); return; }

      const srcAcc = state.accounts.find(a => a.id === _delAccId);
      const { data: newAcc, error: cErr } = await sb.from('accounts').insert({
        name:            newName,
        type:            newType,
        currency:        srcAcc?.currency || 'BRL',
        color:           srcAcc?.color    || '#6b7280',
        icon:            srcAcc?.icon     || null,
        initial_balance: 0,
        active:          true,
        family_id:       famId(),
      }).select().single();
      if (cErr) throw new Error('Erro ao criar conta: ' + cErr.message);
      targetAccountId = newAcc.id;
      toast(`✓ Conta "${newName}" criada`, 'success');
    }

    // ── Migrate / delete records ─────────────────────────────────────
    if (action === 'transfer' || action === 'new_account') {

      // 1. Move transactions (including their linked transfer pairs)
      const { data: txs, error: txErr } = await famQ(
        sb.from('transactions').select('id, linked_transfer_id, is_transfer')
      ).eq('account_id', _delAccId);
      if (txErr) throw new Error('Erro ao buscar transações: ' + txErr.message);

      if (txs?.length) {
        const { error: mvErr } = await sb.from('transactions')
          .update({ account_id: targetAccountId })
          .eq('account_id', _delAccId);
        if (mvErr) throw new Error('Erro ao mover transações: ' + mvErr.message);
      }

      // 2. Move scheduled_transactions (both account_id and transfer_to_account_id)
      const { error: scErr1 } = await famQ(
        sb.from('scheduled_transactions').update({ account_id: targetAccountId })
      ).eq('account_id', _delAccId);
      if (scErr1) throw new Error('Erro ao mover programadas: ' + scErr1.message);

      // Also update transfer_to_account_id references
      const { error: scErr2 } = await famQ(
        sb.from('scheduled_transactions').update({ transfer_to_account_id: targetAccountId })
      ).eq('transfer_to_account_id', _delAccId);
      if (scErr2) throw new Error('Erro ao mover destinos de transferência: ' + scErr2.message);

      toast(`✓ Registros transferidos para a conta destino`, 'success');

    } else if (action === 'delete_all') {

      // 1. Delete scheduled_occurrences for scheduled_transactions of this account
      const { data: scs } = await famQ(
        sb.from('scheduled_transactions').select('id')
      ).eq('account_id', _delAccId);
      const scIds = (scs || []).map(s => s.id);

      if (scIds.length) {
        // Delete occurrences first (FK constraint)
        for (let i = 0; i < scIds.length; i += 100) {
          await sb.from('scheduled_occurrences')
            .delete().in('scheduled_id', scIds.slice(i, i + 100));
        }
        // Delete scheduled_transactions
        const { error: scDelErr } = await famQ(
          sb.from('scheduled_transactions').delete()
        ).eq('account_id', _delAccId);
        if (scDelErr) throw new Error('Erro ao excluir programadas: ' + scDelErr.message);
      }

      // 2. Delete linked transfer pair transactions first
      const { data: txsToDelete } = await famQ(
        sb.from('transactions').select('id, linked_transfer_id')
      ).eq('account_id', _delAccId);

      const linkedIds = (txsToDelete || [])
        .map(t => t.linked_transfer_id).filter(Boolean);

      if (linkedIds.length) {
        // Detach occurrences referencing linked transactions
        for (let i = 0; i < linkedIds.length; i += 100) {
          await sb.from('scheduled_occurrences')
            .update({ transaction_id: null })
            .in('transaction_id', linkedIds.slice(i, i + 100));
        }
        // Delete the paired transfer transactions
        for (let i = 0; i < linkedIds.length; i += 100) {
          await sb.from('transactions')
            .delete().in('id', linkedIds.slice(i, i + 100));
        }
      }

      // 3. Delete attachments for transactions of this account
      const txIds = (txsToDelete || []).map(t => t.id);
      if (txIds.length) {
        for (let i = 0; i < txIds.length; i += 100) {
          await sb.from('attachments')
            .delete().in('transaction_id', txIds.slice(i, i + 100));
        }
      }

      // 4. Delete all transactions of this account
      const { error: txDelErr } = await famQ(
        sb.from('transactions').delete()
      ).eq('account_id', _delAccId);
      if (txDelErr) throw new Error('Erro ao excluir transações: ' + txDelErr.message);

      // 5. Also delete scheduled_transactions where this account is the transfer destination
      await famQ(
        sb.from('scheduled_transactions').delete()
      ).eq('transfer_to_account_id', _delAccId);

      toast(t('toast.all_deleted'), 'success');
    }

    // ── Finally: deactivate the account ─────────────────────────────
    const { error: deactErr } = await sb.from('accounts')
      .update({ active: false }).eq('id', _delAccId);
    if (deactErr) throw new Error('Erro ao desativar conta: ' + deactErr.message);

    closeModal('deleteAccountModal');
    toast(t('account.deleted'), 'success');
    _delAccId = null;

    await loadAccounts();
    if(typeof populateSelects==='function') populateSelects();
    renderAccounts(_accountsViewMode);
    if (state.currentPage === 'transactions') loadTransactions();

  } catch (e) {
    showErr('Erro: ' + (e.message || e));
    console.error('[deleteAccount]', e);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirmar Exclusão';
  }
}

// ── Account Groups ────────────────────────────────────────
async function loadGroups(){
  try{
    const{data,error}=await famQ(sb.from('account_groups').select('*')).order('name');
    if(error)throw error;
    state.groups=data||[];
    state.accountGroups = state.groups;
  }catch(e){state.groups=[]; state.accountGroups=[];}
}

function renderGroupManager(){
  const el=document.getElementById('groupList');
  if(!el) return;
  if(!state.groups.length){
    el.innerHTML='<div style="font-size:.85rem;color:var(--muted);text-align:center;padding:16px">Nenhum grupo criado ainda.</div>';
    return;
  }
  el.innerHTML=state.groups.map(g=>{
    const count=state.accounts.filter(a=>a.group_id===g.id).length;
    const color=g.color||'#2a6049';
    const cur=g.currency||'BRL';
    return `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:12px;background:var(--surface)">
      <span style="font-size:1.35rem">${g.emoji||'🗂️'}</span>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(g.name)}</span>
          <span style="width:9px;height:9px;border-radius:999px;background:${color};border:1px solid rgba(0,0,0,.08);flex-shrink:0"></span>
          <span style="font-size:.68rem;font-weight:700;color:var(--muted);background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:1px 5px;letter-spacing:.04em">${cur}</span>
        </div>
        <div style="font-size:.75rem;color:var(--muted);margin-top:2px">${count} conta${count!==1?'s':''}</div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="openGroupModal('${g.id}')" title="Editar">✏️</button>
      <button class="btn btn-ghost btn-sm" onclick="deleteGroup('${g.id}')" title="Excluir" style="color:var(--red)">🗑️</button>
    </div>`;
  }).join('');
}

async function deleteGroup(id){
  if(!confirm('Excluir grupo? As contas não serão excluídas.'))return;
  await sb.from('accounts').update({group_id:null}).eq('group_id',id);
  const{error}=await sb.from('account_groups').delete().eq('id',id);
  if(error){toast(error.message,'error');return;}
  toast(t('toast.group_removed'),'success');
  await loadGroups();
  renderGroupManager();
  await loadAccounts();
  renderAccounts(_accountsViewMode);
}

async function openGroupModal(id=''){
  if (!state.groups || !state.groups.length) { await loadGroups(); }
  document.getElementById('groupName').value='';
  document.getElementById('groupEmoji').value='';
  const colorEl=document.getElementById('groupColor');
  if(colorEl) colorEl.value='#2a6049';
  const currEl=document.getElementById('groupCurrency');
  if(currEl) currEl.value='BRL';
  document.getElementById('groupEditId').value='';
  if(id){
    const g=state.groups.find(x=>x.id===id);
    if(g){
      document.getElementById('groupName').value=g.name||'';
      document.getElementById('groupEmoji').value=g.emoji||'';
      if(colorEl) colorEl.value=g.color||'#2a6049';
      if(currEl)  currEl.value=g.currency||'BRL';
      document.getElementById('groupEditId').value=id;
    }
  }
  openModal('groupModal');
  renderGroupManager();
}
function cancelGroupEdit(){
  document.getElementById('groupName').value='';
  document.getElementById('groupEmoji').value='';
  const colorEl=document.getElementById('groupColor');
  if(colorEl)colorEl.value='#2a6049';
  document.getElementById('groupEditId').value='';
}

async function saveGroup(){
  const id=document.getElementById('groupEditId').value;
  const colorEl=document.getElementById('groupColor');
  const currEl=document.getElementById('groupCurrency');
  const data={
    name:document.getElementById('groupName').value.trim(),
    emoji:document.getElementById('groupEmoji').value||'🗂️',
    color:colorEl?colorEl.value:'#2a6049',
    currency:currEl?currEl.value:'BRL',
    updated_at:new Date().toISOString()
  };
  if(!data.name){toast(t('toast.err_group_name'),'error');return;}
  if(!id)data.family_id=famId();
  let err;
  if(id){({error:err}=await sb.from('account_groups').update(data).eq('id',id));}
  else{({error:err}=await sb.from('account_groups').insert(data));}
  if(err){toast(err.message,'error');return;}
  toast(t('toast.group_saved'),'success');
  cancelGroupEdit();
  await loadGroups();
  renderGroupManager();
  await loadAccounts();
  renderAccounts(_accountsViewMode);
}

function onAccountTypeChange(){
  const type=document.getElementById('accountType').value;
  const isCC=type==='cartao_credito';
  const iofConfig=document.getElementById('accountIofConfig');
  if(iofConfig)iofConfig.style.display=isCC?'':'none';
  const cardDates=document.getElementById('accountCardDatesConfig');
  if(cardDates)cardDates.style.display=isCC?'':'none';
}

async function checkAccountIofConfig(accountId){
  if(!accountId)return;
  const a=state.accounts.find(x=>x.id===accountId);
  const iofGroup=document.getElementById('txIofGroup');
  if(!iofGroup)return;
  if(a&&a.type==='cartao_credito'&&a.is_brazilian){
    iofGroup.style.display='';
    const mirrorInfo=document.getElementById('txIofMirrorInfo');
    if(mirrorInfo)mirrorInfo.classList.remove('visible');
  } else {
    iofGroup.style.display='none';
    const iofCb=document.getElementById('txIsInternational');
    if(iofCb)iofCb.checked=false;
    const mirrorInfo=document.getElementById('txIofMirrorInfo');
    if(mirrorInfo)mirrorInfo.classList.remove('visible');
  }
}

// Called by app.js navigate('accounts') instead of bare renderAccounts()
function initAccountsPage() {
  const hasFav = (state.accounts || []).some(a => a.is_favorite);
  const mode = hasFav ? '__fav__' : (_accountsViewMode || '');
  renderAccounts(mode);
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

// ── Optimistic UI: toggle favorite ────────────────────────────────────────
async function toggleAccountFavorite(accId, currentIsFav) {
  const newVal = !currentIsFav;
  const acc = (state.accounts || []).find(a => a.id === accId);
  if (!acc) return;

  // 1. Optimistic update in state
  acc.is_favorite = newVal;

  // 2. Update star icon immediately
  const starEl = document.getElementById('favStar-' + accId);
  if (starEl) {
    starEl.innerHTML = newVal ? '⭐' : '<span style="opacity:.3;font-size:.8rem">☆</span>';
    starEl.title = newVal ? 'Remover dos favoritos' : 'Adicionar aos favoritos';
    starEl.style.transform = 'scale(1.3)';
    setTimeout(() => { if (starEl) starEl.style.transform = ''; }, 200);
  }

  // 3. Re-render dashboard accounts section immediately
  if (typeof _renderDashAccounts === 'function') {
    try { _renderDashAccounts(); } catch(_) {}
  } else if (typeof loadDashboard === 'function' && state.currentPage === 'dashboard') {
    loadDashboard().catch(() => {});
  }

  // 4. Async DB sync with rollback on error
  try {
    const { error } = await sb.from('accounts').update({ is_favorite: newVal }).eq('id', accId);
    if (error) throw error;
    DB.accounts.bust();
    toast(newVal ? '⭐ Conta adicionada aos favoritos' : 'Removida dos favoritos', 'success');
  } catch(e) {
    // Rollback
    acc.is_favorite = currentIsFav;
    if (starEl) {
      starEl.innerHTML = currentIsFav ? '⭐' : '<span style="opacity:.3;font-size:.8rem">☆</span>';
    }
    if (typeof _renderDashAccounts === 'function') {
      try { _renderDashAccounts(); } catch(_) {}
    }
    toast('Erro ao atualizar: ' + e.message, 'error');
  }
}
window.toggleAccountFavorite = toggleAccountFavorite;

// ── AI icon suggestion for accounts ──────────────────────────────────────

// Map of known bank/institution names → icon picker data-icon values
const _BANK_ICON_MAP = {
  'itau': 'itau', 'itaú': 'itau',
  'inter': 'inter', 'banco inter': 'inter',
  'bradesco': 'bradesco',
  'nubank': 'nubank', 'nu': 'nubank',
  'bb': 'bb', 'banco do brasil': 'bb',
  'caixa': 'caixa', 'cef': 'caixa', 'caixa econômica': 'caixa',
  'santander': 'santander',
  'xp': 'xp', 'xp investimentos': 'xp',
  'c6': 'c6', 'c6 bank': 'c6',
  'neon': 'neon',
  'next': 'next',
  'picpay': 'picpay',
  'mercado pago': 'mercadopago', 'mercadopago': 'mercadopago',
  'sicoob': 'sicoob',
  'rico': 'rico',
  'will': 'will', 'will bank': 'will',
  'boursobank': 'boursobank', 'bourso': 'boursobank',
  'bnp': 'bnp', 'bnp paribas': 'bnp',
  'sg': 'sg', 'societe generale': 'sg', 'société générale': 'sg',
  'credit agricole': 'ca', 'crédit agricole': 'ca',
  'lcl': 'lcl',
  'la poste': 'laposte', 'banque postale': 'laposte',
  'cic': 'cic',
  'bred': 'bred',
  'revolut': 'revolut',
  'n26': 'n26',
  'wise': 'wise', 'transferwise': 'wise',
  'paypal': 'paypal',
  'visa': 'visa',
  'mastercard': 'mastercard', 'master': 'mastercard',
  'amex': 'amex', 'american express': 'amex',
  'elo': 'elo',
  'hipercard': 'hipercard',
  'diners': 'dinersclub', 'diners club': 'dinersclub',
  'sams': 'sams', "sam's club": 'sams',
  'porto': 'porto', 'porto seguro': 'porto',
};

window.accountAiSuggestIcon = async function() {
  const name     = (document.getElementById('accountName')?.value || '').trim();
  const type     = document.getElementById('accountType')?.value || '';
  const currency = document.getElementById('accountCurrency')?.value || 'BRL';
  if (!name) { toast('Informe o nome da conta primeiro', 'warning'); return; }

  const panel   = document.getElementById('accountAiSuggestPanel');
  const content = document.getElementById('accountAiSuggestContent');
  if (!panel || !content) return;
  panel.style.display = '';
  content.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:.8rem;padding:12px;width:100%">⏳ Buscando sugestões…</div>';

  // ── Step 1: try to match against known banks first ──────────────────
  const lname = name.toLowerCase();
  const matchedIconKey = Object.entries(_BANK_ICON_MAP).find(([k]) => lname.includes(k))?.[1];

  // Build bank-match chip if found
  let bankChipHtml = '';
  if (matchedIconKey) {
    const iconEl = document.querySelector(`.icon-option[data-icon="${matchedIconKey}"]`);
    if (iconEl) {
      const iconLabel = iconEl.querySelector('.icon-label')?.textContent || matchedIconKey;
      const iconColor = iconEl.dataset.color || '#2a6049';
      const iconInner = iconEl.querySelector('.bank-logo')?.outerHTML || iconEl.querySelector('span')?.outerHTML || '🏦';
      bankChipHtml = `
        <div onclick="accountSelectAiIcon('${matchedIconKey}','${iconColor}')"
          style="flex:1;min-width:88px;text-align:center;padding:10px 8px;border:2px solid var(--accent);
                 border-radius:10px;cursor:pointer;background:var(--accent-lt);transition:all .15s;position:relative"
          onmouseover="this.style.background='var(--accent)';this.querySelectorAll('div').forEach(d=>d.style.color='#fff')"
          onmouseout="this.style.background='var(--accent-lt)';this.querySelectorAll('div').forEach(d=>d.style.color='')">
          <div style="font-size:1.5rem;line-height:1.3;margin-bottom:4px">${iconInner}</div>
          <div style="font-size:.7rem;font-weight:800;color:var(--accent);margin-bottom:2px">${esc(iconLabel)}</div>
          <div style="font-size:.62rem;color:var(--muted)">Logotipo reconhecido ✓</div>
          <span style="position:absolute;top:-8px;right:6px;font-size:.58rem;font-weight:800;background:var(--accent);color:#fff;padding:1px 6px;border-radius:20px">MELHOR</span>
        </div>`;
    }
  }

  // ── Step 2: AI emoji suggestions ────────────────────────────────────
  try {
    const apiKey = await getAppSetting('gemini_api_key', '');
    if (!apiKey) {
      content.innerHTML = bankChipHtml ||
        '<div style="color:var(--red,#dc2626);font-size:.78rem;padding:8px">Configure a chave Gemini em Configurações → IA</div>';
      return;
    }

    const typeLabels = { corrente:'Conta Corrente', poupanca:'Poupança', cartao_credito:'Cartão de Crédito', investimento:'Investimentos', dinheiro:'Dinheiro', outros:'Outros' };
    const context = [
      `Nome da conta: ${name}`,
      `Tipo de conta: ${typeLabels[type] || type}`,
      currency !== 'BRL' ? `Moeda: ${currency}` : '',
    ].filter(Boolean).join('\n');

    const prompt = [
      'Você é um assistente de branding para um app financeiro.',
      'Com base nos dados de uma conta bancária, sugira 3 ícones/emoji para representá-la visualmente.',
      'Priorize o nome do banco como pista: se reconhecer o banco, sugira ícones que remetam à identidade visual (cor, inicial, símbolo) da instituição.',
      'Considere o tipo de conta (corrente, poupança, cartão) como contexto secundário.',
      'Responda APENAS com JSON válido: {"suggestions":[{"emoji":"💳","label":"Cartão","reason":"..."},{"emoji":"...","label":"...","reason":"..."},{"emoji":"...","label":"...","reason":"..."}]}',
      '',
      context
    ].join('\n');

    const models = ['gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-1.5-flash'];
    let parsed = null;
    for (const model of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 400, temperature: 0.3, responseMimeType: 'application/json' }
          })
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const text = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').replace(/```json|```/g,'').trim();
        parsed = JSON.parse(text);
        if (parsed?.suggestions?.length) break;
      } catch(_) {}
    }

    const sugs = parsed?.suggestions || [];
    const aiChips = sugs.map(s => {
      const emoji = String(s.emoji || '🏦').replace(/'/g, '&#39;');
      return `
        <div onclick="accountSelectAiIcon('emoji-${emoji}','')"
          style="flex:1;min-width:80px;text-align:center;padding:10px 8px;border:1.5px solid var(--border);
                 border-radius:10px;cursor:pointer;transition:all .15s;background:var(--surface)"
          onmouseover="this.style.borderColor='var(--accent)';this.style.background='var(--accent-lt)'"
          onmouseout="this.style.borderColor='var(--border)';this.style.background='var(--surface)'">
          <div style="font-size:2rem;line-height:1;margin-bottom:4px">${esc(s.emoji || '🏦')}</div>
          <div style="font-size:.7rem;font-weight:700;color:var(--text);margin-bottom:2px">${esc(s.label||'')}</div>
          <div style="font-size:.63rem;color:var(--muted);line-height:1.2">${esc(s.reason||'')}</div>
        </div>`;
    }).join('');

    content.innerHTML = (bankChipHtml + aiChips) ||
      '<div style="color:var(--muted);font-size:.8rem;padding:8px">Sem sugestões.</div>';

  } catch(e) {
    content.innerHTML = bankChipHtml ||
      `<div style="color:var(--red,#dc2626);font-size:.78rem;padding:8px">Erro: ${esc(e.message)}</div>`;
  }
};

window.accountSelectAiIcon = function(iconKeyOrEmoji, color) {
  // iconKeyOrEmoji: 'itau' | 'nubank' | 'emoji-💳'
  const panel = document.getElementById('accountAiSuggestPanel');

  if (iconKeyOrEmoji.startsWith('emoji-')) {
    // Emoji suggestion: set icon value as 'emoji-X' and preview
    const emoji = iconKeyOrEmoji.slice(6);
    const iconInput   = document.getElementById('accountIcon');
    const iconPreview = document.getElementById('accountIconPreview');
    if (iconInput)   iconInput.value = `emoji-${emoji}`;
    if (iconPreview) iconPreview.innerHTML = `<span style="font-size:1.4rem">${emoji}</span>`;
    // Also call syncIconPickerToValue if available
    if (typeof syncIconPickerToValue === 'function') {
      syncIconPickerToValue(`emoji-${emoji}`, color || document.getElementById('accountColor')?.value || '#2a6049');
    }
    toast('Ícone selecionado!', 'success');
  } else {
    // Bank icon: trigger the existing icon picker selection
    const iconEl = document.querySelector(`.icon-option[data-icon="${iconKeyOrEmoji}"]`);
    if (iconEl) {
      // Show its tab group first
      const gridEl = iconEl.closest('.icon-grid');
      if (gridEl) {
        document.querySelectorAll('.icon-grid').forEach(g => g.style.display = 'none');
        gridEl.style.display = '';
        // Activate the tab button
        const tabBtns = document.querySelectorAll('#accountIconPicker .icon-tab');
        tabBtns.forEach(b => {
          b.classList.toggle('active', b.getAttribute('onclick')?.includes(gridEl.id));
        });
      }
      if (typeof selectAccountIcon === 'function') selectAccountIcon(iconEl);
    }
    toast('Ícone do banco selecionado!', 'success');
  }
  if (panel) panel.style.display = 'none';
};
