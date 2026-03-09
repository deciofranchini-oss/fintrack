async function loadAccounts(){
  const {data:accs,error} = await famQ(sb.from('accounts').select('*').eq('active',true)).order('name');
  if(error){toast(error.message,'error');return;}
  state.accounts=accs||[];
  try {
    const {data:grps} = await famQ(sb.from('account_groups').select('*')).order('name');
    state.groups=grps||[];
  } catch(e) { state.groups=[]; }
  await recalcAccountBalances();
}

async function recalcAccountBalances() {
  if (!state.accounts.length) return;

  // ── TD-1 FIX: Server-side aggregation ─────────────────────────────
  // Instead of loading ALL transaction rows (slow at 10k+ txs), we ask
  // Supabase to SUM amounts grouped by account_id on the server.
  // Two queries cover the two transfer accounting models:
  //   • New transfers (linked_transfer_id set): both legs have account_id → naturally summed
  //   • Old transfers (linked_transfer_id null): only debit leg exists → we must
  //     add abs(amount) to transfer_to_account_id separately
  // Fallback: if the RPC isn't available, we silently fall back to the old full-scan.

  let txMap = {};

  try {
    // Query 1: sum all amounts by account_id (covers normal txs + new paired transfers)
    const { data: sums, error: sumErr } = await famQ(
      sb.from('transactions').select('account_id, amount')
    );
    if (sumErr) throw sumErr;

    (sums || []).forEach(t => {
      const amt = parseFloat(t.amount) || 0;
      if (t.account_id) txMap[t.account_id] = (txMap[t.account_id] || 0) + amt;
    });

    // Query 2: old-style single-leg transfers — credit the destination manually
    // These are rows where is_transfer=true AND linked_transfer_id IS NULL
    const { data: oldTransfers } = await famQ(
      sb.from('transactions')
        .select('transfer_to_account_id, amount')
        .eq('is_transfer', true)
        .is('linked_transfer_id', null)
        .not('transfer_to_account_id', 'is', null)
    );

    (oldTransfers || []).forEach(t => {
      txMap[t.transfer_to_account_id] = (txMap[t.transfer_to_account_id] || 0) + Math.abs(parseFloat(t.amount) || 0);
    });

  } catch (e) {
    // Fallback: full row scan (original behaviour) — safe but slower
    console.warn('[recalcAccountBalances] aggregation failed, falling back to full scan:', e.message);
    const { data: txs } = await famQ(
      sb.from('transactions').select('id, account_id, amount, is_transfer, transfer_to_account_id, linked_transfer_id')
    );
    txMap = {};
    (txs || []).forEach(t => {
      const amt = parseFloat(t.amount) || 0;
      if (t.account_id) txMap[t.account_id] = (txMap[t.account_id] || 0) + amt;
      if (t.is_transfer && t.transfer_to_account_id && !t.linked_transfer_id) {
        txMap[t.transfer_to_account_id] = (txMap[t.transfer_to_account_id] || 0) + Math.abs(amt);
      }
    });
  }

  // Saldo = saldo_inicial + soma de todas as transações da conta
  state.accounts.forEach(a => {
    const initialBal = parseFloat(a.initial_balance) || 0;
    a.balance = initialBal + (txMap[a.id] || 0);
  });
}

let _accountsViewMode='';
function renderAccounts(ft=''){
  _accountsViewMode=ft;
  const grid=document.getElementById('accountGrid');
  let accs=state.accounts;
  if(ft==='__group__'){
    if(!state.groups.length){ renderAccountsFlat(accs,grid); return; }
    renderAccountsGrouped(accs,grid);
  } else {
    renderAccountsFlat(ft?accs.filter(a=>a.type===ft):accs,grid);
  }
  renderAccountsSummary();
}

function renderAccountsFlat(accs,grid){
  if(!accs.length){grid.innerHTML='<div class="empty-state" style="grid-column:1/-1"><div class="es-icon">🏦</div><p>Nenhuma conta encontrada</p></div>';return;}
  grid.innerHTML=accs.map(a=>accountCardHTML(a)).join('');
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
        <span class="account-group-title">Sem grupo</span>
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
  el.innerHTML=`<span class="summary-label">Total:</span><span class="summary-value ${total<0?'text-red':'text-accent'}">${fmt(total)}</span>${pos?`<span class="summary-sep">·</span><span class="summary-pos">+${fmt(pos)}</span>`:''}${neg?`<span class="summary-sep">·</span><span class="summary-neg">${fmt(neg)}</span>`:''}`;
}

function accountCardHTML(a){
  return `<div class="account-card" onclick="goToAccountTransactions('${a.id}')">
    <div class="account-card-stripe" style="background:${a.color||'var(--accent)'}"></div>
    <div class="account-actions"><button class="btn-icon" onclick="event.stopPropagation();openAccountModal('${a.id}')">✏️</button><button class="btn-icon" onclick="event.stopPropagation();deleteAccount('${a.id}')">🗑️</button></div>
    <div class="account-icon" style="font-size:1.6rem;margin-bottom:8px">${renderIconEl(a.icon,a.color,36)}</div>
    <div class="account-name">${esc(a.name)}</div>
    <div class="account-type">${accountTypeLabel(a.type)}</div>
    <div class="account-balance ${a.balance<0?'text-red':'text-accent'}">${fmt(a.balance,a.currency)}</div>
    <div class="account-currency">${a.currency}</div>
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
  document.querySelectorAll('#page-accounts .tab').forEach(t=>t.classList.remove('active'));
  event.target.classList.add('active');
  renderAccounts(type);
}

function accountTypeLabel(t){
  return{corrente:'Conta Corrente',poupanca:'Poupança',cartao_credito:'Cartão de Crédito',investimento:'Investimentos',dinheiro:'Dinheiro',outros:'Outros'}[t]||t;
}

function openAccountModal(id=''){
  const form={id:'',name:'',type:'corrente',currency:'BRL',initial_balance:0,icon:'',color:'#2a6049',is_brazilian:false,iof_rate:3.5,group_id:''};
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
    gSel.innerHTML='<option value="">— Sem grupo —</option>'+state.groups.map(g=>`<option value="${g.id}">${g.emoji||'🗂️'} ${esc(g.name)}</option>`).join('');
    gSel.value=form.group_id||'';
  }
  const isCC=form.type==='cartao_credito';
  const iofConfig=document.getElementById('accountIofConfig');
  if(iofConfig)iofConfig.style.display=isCC?'':'none';
  const isBREl=document.getElementById('accountIsBrazilian');
  if(isBREl)isBREl.checked=!!form.is_brazilian;
  const iofRateEl=document.getElementById('accountIofRate');
  if(iofRateEl)iofRateEl.value=form.iof_rate||3.5;
  const iofRateGrp=document.getElementById('accountIofRateGroup');
  if(iofRateGrp)iofRateGrp.style.display=form.is_brazilian?'':'none';
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
    updated_at:new Date().toISOString()
  };
  if(!data.name){toast('Informe o nome da conta','error');return;}
  if(!id) data.family_id=famId();
  let err;
  if(id){({error:err}=await sb.from('accounts').update(data).eq('id',id));}
  else{({error:err}=await sb.from('accounts').insert(data));}
  if(err){toast(err.message,'error');return;}
  toast(id?'Conta atualizada!':'Conta criada!','success');
  closeModal('accountModal');
  await loadAccounts();
  populateSelects();
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

      toast('✓ Todos os registros excluídos', 'success');
    }

    // ── Finally: deactivate the account ─────────────────────────────
    const { error: deactErr } = await sb.from('accounts')
      .update({ active: false }).eq('id', _delAccId);
    if (deactErr) throw new Error('Erro ao desativar conta: ' + deactErr.message);

    closeModal('deleteAccountModal');
    toast('✓ Conta excluída com sucesso', 'success');
    _delAccId = null;

    await loadAccounts();
    populateSelects();
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
  }catch(e){state.groups=[];}
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
  toast('Grupo removido','success');
  await loadGroups();
  renderGroupManager();
  await loadAccounts();
  renderAccounts(_accountsViewMode);
}

function openGroupModal(id=''){
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
  if(!data.name){toast('Informe o nome do grupo','error');return;}
  if(!id)data.family_id=famId();
  let err;
  if(id){({error:err}=await sb.from('account_groups').update(data).eq('id',id));}
  else{({error:err}=await sb.from('account_groups').insert(data));}
  if(err){toast(err.message,'error');return;}
  toast('Grupo salvo!','success');
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