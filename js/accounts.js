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

  // Buscamos linked_transfer_id para distinguir transferências antigas (sem leg de crédito)
  // das novas (com leg de crédito separada já gravada no banco).
  const { data: txs } = await famQ(
    sb.from('transactions').select('id, account_id, amount, is_transfer, transfer_to_account_id, linked_transfer_id')
  );

  const txMap = {};

  (txs || []).forEach(t => {
    const amt = parseFloat(t.amount) || 0;

    // Soma o valor na conta da própria transação (pode ser débito ou crédito)
    if (t.account_id) {
      txMap[t.account_id] = (txMap[t.account_id] || 0) + amt;
    }

    // Transferências ANTIGAS (linked_transfer_id === null):
    //   Criadas antes da migration_v3 — têm apenas 1 lançamento (o débito).
    //   Precisamos creditar manualmente a conta destino.
    // Transferências NOVAS (linked_transfer_id preenchido):
    //   Têm 2 lançamentos. O crédito já é contado no branch acima via account_id.
    if (t.is_transfer && t.transfer_to_account_id && !t.linked_transfer_id) {
      txMap[t.transfer_to_account_id] = (txMap[t.transfer_to_account_id] || 0) + Math.abs(amt);
    }
  });

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
    const bar=document.getElementById('accountsGroupBar');
    if(!state.groups.length){
      if(bar)bar.style.display='none';
      renderAccountsFlat(accs,grid);return;
    }
    if(bar){
      bar.style.display='flex';
      bar.innerHTML=state.groups.map(g=>{
        const cnt=accs.filter(a=>a.group_id===g.id).length;
        return `<button class="group-bar-btn" onclick="scrollToGroup('${g.id}')">${g.emoji||'🗂️'} ${esc(g.name)} <span class="group-bar-count">${cnt}</span></button>`;
      }).join('')+'<button class="group-bar-btn" onclick="scrollToGroup(\'__none__\')">Sem grupo</button>';
    }
    renderAccountsGrouped(accs,grid);
  } else {
    const bar=document.getElementById('accountsGroupBar');
    if(bar)bar.style.display='none';
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
  if(!sections.length&&!ungrouped.length){grid.innerHTML='<div class="empty-state"><div class="es-icon">🗂️</div><p>Nenhum grupo criado ainda.</p></div>';return;}

  const groupHTML=sections.map(({g,accs:ga})=>{
    const bal=ga.reduce((s,a)=>s+a.balance,0);
    const color=g.color||'var(--accent)';
    const balClass=bal<0?'text-red':'text-accent';
    const countLabel=ga.length===1?'1 conta':`${ga.length} contas`;
    return `<div class="account-group-section" id="grp-${g.id}">
      <div class="account-group-header" style="border-left-color:${color}">
        <span class="account-group-emoji">${g.emoji||'🗂️'}</span>
        <span class="account-group-name">${esc(g.name)}</span>
        <div class="account-group-meta">
          <span class="account-group-count">${countLabel}</span>
          <span class="account-group-balance ${balClass}">${fmt(bal)}</span>
        </div>
      </div>
      <div class="account-group-grid">${ga.map(a=>accountCardHTML(a)).join('')}</div>
    </div>`;
  }).join('');

  const ungroupedHTML=ungrouped.length?`<div class="account-group-section" id="grp-__none__">
    <div class="account-group-header" style="border-left-color:var(--border2)">
      <span class="account-group-emoji">📂</span>
      <span class="account-group-name">Sem grupo</span>
      <div class="account-group-meta">
        <span class="account-group-count">${ungrouped.length===1?'1 conta':`${ungrouped.length} contas`}</span>
      </div>
    </div>
    <div class="account-group-grid">${ungrouped.map(a=>accountCardHTML(a)).join('')}</div>
  </div>`:'';

  grid.innerHTML=groupHTML+ungroupedHTML;
}

function scrollToGroup(id){const el=document.getElementById('grp-'+id);if(el)el.scrollIntoView({behavior:'smooth',block:'start'});}

function renderAccountsSummary(){
  const el=document.getElementById('accountsSummary');if(!el)return;
  const accs=state.accounts;
  const total=accs.reduce((s,a)=>s+a.balance,0);
  const pos=accs.filter(a=>a.balance>=0).reduce((s,a)=>s+a.balance,0);
  const neg=accs.filter(a=>a.balance<0).reduce((s,a)=>s+a.balance,0);
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

async function deleteAccount(id){
  if(!confirm('Excluir esta conta?'))return;
  const{error}=await sb.from('accounts').update({active:false}).eq('id',id);
  if(error){toast(error.message,'error');return;}
  toast('Conta removida','success');
  await loadAccounts();
  populateSelects();
  renderAccounts(_accountsViewMode);
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
    return `<div style="display:flex;align-items:center;gap:10px;padding:10px 10px;border:1px solid var(--border);border-radius:12px;background:var(--surface)">
      <span style="font-size:1.35rem">${g.emoji||'🗂️'}</span>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(g.name)}</span>
          <span style="width:10px;height:10px;border-radius:999px;background:${color};border:1px solid rgba(0,0,0,.08)"></span>
        </div>
        <div style="font-size:.75rem;color:var(--muted)">${count} conta${count!==1?'s':''}</div>
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