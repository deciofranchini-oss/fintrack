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


async function renderAccounts(ft=''){
  _accountsViewMode=ft;
  const grid=document.getElementById('accountGrid');
  if(!grid) return;
  state.groups = state.groups || [];

  // Always ensure loyalty programs are loaded before rendering cards
  // (window._loy may not exist yet due to script load order)
  if (typeof loadLoyaltyPrograms === 'function') {
    await loadLoyaltyPrograms().catch(() => {});
  }

  let accs=state.accounts || [];
  if(ft==='__group__'){
    if(!state.groups.length){ renderAccountsFlat(accs,grid); return; }
    renderAccountsGrouped(accs,grid);
  } else if(ft==='__fav__'){
    grid.style.gridTemplateColumns = '';
    grid.style.gap = '';
    renderAccountsFlat(accs.filter(a=>a.is_favorite), grid);
  } else {
    grid.style.gridTemplateColumns = '';
    grid.style.gap = '';
    renderAccountsFlat(ft?accs.filter(a=>a.type===ft):accs,grid);
  }
  // ── Render archived accounts section below active accounts ──────────────
  _renderArchivedSection(grid);
  renderAccountsSummary();
  // Sync active tab to current view mode
  _syncAccountsTab(ft);
  try { renderGroupManager(); } catch(e) {}
  // Render loyalty programs section (já carregado acima, só renderiza a seção)
  // Loyalty programs now on dedicated page (navigate to 'loyalty')
}

function _renderArchivedSection(grid) {
  // Remove previous archived section if any
  document.getElementById('archivedAccountsSection')?.remove();

  const archived = state.archivedAccounts || [];
  if (!archived.length) return;

  const section = document.createElement('div');
  section.id = 'archivedAccountsSection';
  section.style.cssText = 'grid-column:1/-1;margin-top:24px;';
  section.innerHTML = `
    <div class="archived-section-header" onclick="toggleArchivedSection()" style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 4px;border-top:1px solid var(--border);user-select:none">
      <span style="font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)">
        📦 Contas Arquivadas (${archived.length})
      </span>
      <svg id="archivedSectionArrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="color:var(--muted);transition:transform .22s"><polyline points="6 9 12 15 18 9"/></svg>
    </div>
    <div id="archivedGrid" class="account-grid" style="display:none;opacity:.75;margin-top:8px">
      ${archived.map(a => accountCardHTML(a, true)).join('')}
    </div>`;
  grid.appendChild(section);
}

function toggleArchivedSection() {
  const grid  = document.getElementById('archivedGrid');
  const arrow = document.getElementById('archivedSectionArrow');
  if (!grid) return;
  const isOpen = grid.style.display !== 'none';
  grid.style.display = isOpen ? 'none' : '';
  if (arrow) arrow.style.transform = isOpen ? '' : 'rotate(180deg)';
}
window.toggleArchivedSection = toggleArchivedSection;

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

  // Override grid to full-width stacked layout for group view
  grid.style.gridTemplateColumns = '1fr';
  grid.style.gap = '0';
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
        <div class="account-grid">${ga.map(a=>accountCardHTML(a)).join('')}</div>

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
      <div class="account-grid">${ungrouped.map(a=>accountCardHTML(a)).join('')}</div>
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

function accountCardHTML(a, isArchived=false){
  const color = a.color || 'var(--accent)';
  const bgAlpha = color.startsWith('#') ? color+'22' : 'rgba(42,96,73,.13)';

  const favStar = `<span class="account-fav-star"
    onclick="event.stopPropagation();toggleAccountFavorite('${a.id}',${!!a.is_favorite})"
    title="${a.is_favorite?'Remover dos favoritos':'Adicionar aos favoritos'}"
    id="favStar-${a.id}">${a.is_favorite ? '⭐' : '<span style="opacity:.25;font-size:.75rem">☆</span>'}</span>`;

  // Bank info line
  const bankParts=[];
  if(a.bank_name) bankParts.push(a.bank_name);
  if(a.agency) bankParts.push('Ag '+a.agency);
  if(a.account_number) bankParts.push(a.account_number);
  if(a.iban) bankParts.push('IBAN …'+a.iban.slice(-6));
  if(a.card_brand) bankParts.push(a.card_brand.charAt(0).toUpperCase()+a.card_brand.slice(1));
  const bankLine = bankParts.length
    ? `<div style="font-size:.67rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;opacity:.8;margin-top:2px">${esc(bankParts.join(' · '))}</div>`
    : '';

  // PIX
  const pixKeys=(Array.isArray(a.pix_keys)&&a.pix_keys.length)?a.pix_keys:(a.pix_key?[{type:'aleatoria',key:a.pix_key}]:[]);
  const pixLine = pixKeys.length
    ? `<div class="account-pix-badge"><span class="pix-label">PIX</span><span class="pix-key">${esc(pixKeys[0].key||'')}${pixKeys.length>1?' +'+( pixKeys.length-1):''}</span></div>`
    : '';

  // Due day
  const dueLine=(a.type==='cartao_credito'&&a.due_day)
    ? `<div style="font-size:.67rem;color:var(--muted);margin-top:3px">Vence dia ${a.due_day}</div>`:'' ;

  // Card limit chip
  const limitLine=(a.type==='cartao_credito'&&a.card_limit)
    ? `<div style="font-size:.67rem;color:var(--muted);margin-top:1px">Limite: ${fmt(a.card_limit,a.currency)}</div>`:'' ;

  // Action buttons
  const actions = isArchived ? `
    <button class="btn-icon" title="Desarquivar" onclick="event.stopPropagation();unarchiveAccount('${a.id}')">📤</button>
    <button class="btn-icon" title="Ver transações" onclick="event.stopPropagation();goToAccountTransactions('${a.id}')">📋</button>
  ` : `
    <button class="btn-icon" title="Nova transação" onclick="event.stopPropagation();state.txFilter={account:'${a.id}',month:'',type:'',status:'',categoryId:'',memberIds:[]};navigate('transactions');setTimeout(()=>{openTxModal();},350)">➕</button>
    <button class="btn-icon" title="Ver transações" onclick="event.stopPropagation();goToAccountTransactions('${a.id}')">📋</button>
    <button class="btn-icon" title="Consolidar saldo" onclick="event.stopPropagation();openConsolidateModal('${a.id}')">⚖️</button>
    <button class="btn-icon" title="Editar" onclick="event.stopPropagation();openAccountModal('${a.id}')">✏️</button>
    <button class="btn-icon" title="Excluir" onclick="event.stopPropagation();deleteAccount('${a.id}')">🗑️</button>
  `;

  // Loyalty points badge (shown for accounts linked to a loyalty program)
  const loyaltyBadge = (typeof getLoyaltyBadgeHtml === 'function')
    ? getLoyaltyBadgeHtml(a.id) : '';

  return `<div class="account-card${isArchived?' account-card--archived':''}${ a.type==='programa_fidelidade' ? ' account-card--loyalty' : ''}" onclick="${a.type==='programa_fidelidade' ? `event.stopPropagation();typeof openLoyaltyStatement==='function'?openLoyaltyStatement(null,'${a.id}'):null` : `goToAccountTransactions('${a.id}')`}" style="position:relative">
    <div class="account-card-stripe" style="background:${color}"></div>
    ${isArchived ? '<div class="archived-card-badge">📦 Arquivada</div>' : favStar}
    <div class="account-card-body">
      <div class="account-card-top">
        <div class="account-icon-wrap" style="background:${bgAlpha}">${renderIconEl(a.icon,a.color,36)}</div>
        <div style="flex:1;min-width:0">
          <div class="account-name">${esc(a.name)}</div>
          <div class="account-type">${accountTypeLabel(a.type)}</div>
        </div>
      </div>
      <div class="account-balance ${a.balance<0?'text-red':'text-accent'}">${fmt(a.balance,a.currency)}</div>
      ${a.currency&&a.currency!=='BRL'?`<div class="account-currency">${esc(a.currency)}</div>`:''}
      ${bankLine}${dueLine}${limitLine}${pixLine}${loyaltyBadge}
    </div>
    <div class="account-actions">${actions}</div>
  </div>`;
}

function goToAccountTransactions(accountId){
  state.txFilter.account=accountId;
  state.txFilter.month='';
  state.txPage=0;
  const el=document.getElementById('txAccount');if(el)el.value=accountId;
  const monthEl=document.getElementById('txMonth');if(monthEl)monthEl.value='';
  navigate('transactions');
  // Update filter badge after navigation (DOM needs to exist first)
  requestAnimationFrame(() => {
    if (typeof _txUpdateFilterBadge === 'function') _txUpdateFilterBadge();
    if (typeof loadTransactions === 'function') loadTransactions();
  });
}

function filterAccounts(type){
  renderAccounts(type);
}

function accountTypeLabel(t){
  return{
    corrente:             'Corrente',
    poupanca:             'Poupança',
    cartao_credito:       'Crédito',
    investimento:         'Investimentos',
    dinheiro:             'Dinheiro',
    outros:               'Outros',
    // Legacy value — DB may have this; display gracefully
    vale_refeicao:        'Vale Refeição',
    programa_fidelidade:  'Prog. Fidelidade',
  }[t] || t;
}

// Chamado ao mudar o tipo de conta no MODAL (não navega para transações)
function _onAccModalTypeChange() {
  const type  = document.getElementById('accountType')?.value || '';
  const isCC      = type === 'cartao_credito';
  const isVale    = type === 'vale_refeicao';
  const isLoyalty = type === 'programa_fidelidade';

  // Card tab: show/hide sections and notice
  const notice    = document.getElementById('acmCardNotice');
  const iofCfg    = document.getElementById('accountIofConfig');
  const cardData  = document.getElementById('accountCardDataSection');
  const valeData  = document.getElementById('accountValeDataSection');
  const loyData   = document.getElementById('accountLoyaltyDataSection');

  if (notice)   notice.style.display   = (isCC || isVale || isLoyalty) ? 'none' : '';
  if (iofCfg)   iofCfg.style.display   = isCC ? '' : 'none';
  if (cardData)  cardData.style.display  = isCC ? '' : 'none';
  if (valeData)  valeData.style.display  = isVale ? '' : 'none';
  if (loyData)   loyData.style.display   = isLoyalty ? '' : 'none';

  // Loyalty: currency irrelevant (points, not money) — hide/lock currency field
  const currencyField = document.getElementById('accountCurrency')?.closest('.acm-field');
  if (currencyField) currencyField.style.display = isLoyalty ? 'none' : '';

  const cardTab = document.getElementById('acmTabCard');
  if (cardTab) cardTab.style.display = (isCC || isVale || isLoyalty) ? '' : '';

  if (typeof acmLivePreview === 'function') acmLivePreview();
}
window._onAccModalTypeChange = _onAccModalTypeChange;

async function openAccountModal(id=''){
  const form={id:'',name:'',type:'corrente',currency:'BRL',initial_balance:0,icon:'',color:'#2a6049',is_brazilian:false,iof_rate:3.5,group_id:'',is_favorite:false,chat_enabled:true,best_purchase_day:null,due_day:null,bank_name:'',bank_code:'',agency:'',account_number:'',iban:'',routing_number:'',swift_bic:'',pix_key:'',pix_keys:[],card_brand:'',card_limit:null,card_type:'',card_issuer:'',linked_dream_id:null,notes:''};
  if(id){
    const a = state.accounts.find(x=>x.id===id)
           || (state.archivedAccounts||[]).find(x=>x.id===id);
    if(a){
      Object.assign(form,a);
      form.initial_balance=parseFloat(a.initial_balance)||0;
      // Remap legacy/invalid type values that aren't in the select
      const _validTypes=['corrente','poupanca','cartao_credito','investimento','dinheiro','outros'];
      if(!_validTypes.includes(form.type)) form.type='outros';
    }
  }
  document.getElementById('accountId').value=form.id;
  document.getElementById('accountName').value=form.name;
  document.getElementById('accountType').value=form.type;
  document.getElementById('accountCurrency').value=form.currency;
  setAmtField('accountBalance', form.initial_balance);
  document.getElementById('accountIcon').value=form.icon||'';
  document.getElementById('accountColor').value=form.color||'#2a6049';
  document.getElementById('accountModalTitle').textContent=id?'Editar Conta':'Nova Conta';
  const accSub = document.getElementById('accountModalSub');
  if (accSub) accSub.textContent = id ? 'Revise os dados da conta e salve quando terminar.' : 'Preencha os dados da nova conta e salve quando terminar.';
  const gSel=document.getElementById('accountGroupId');
  if(gSel){
    if(!state.groups||!state.groups.length){try{await loadGroups();}catch(_e){}}
    gSel.innerHTML='<option value="">— Sem grupo —</option>'+(state.groups||[]).map(g=>`<option value="${g.id}">${g.emoji||'🗂️'} ${esc(g.name)}</option>`).join('');
    gSel.value=form.group_id||'';
  }
  // Favorite (Feature 7)
  const favEl=document.getElementById('accountIsFavorite');
  if(favEl) favEl.checked=!!form.is_favorite;
  const chatEl=document.getElementById('accountChatEnabled');
  if(chatEl) chatEl.checked=form.chat_enabled !== false;  // default true if null
  // Credit card config
  const isCC=form.type==='cartao_credito';
  const iofConfig=document.getElementById('accountIofConfig');
  if(iofConfig)iofConfig.style.display=isCC?'':'none';
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
  // Novos campos bancários
  const _setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  _setVal('accountBankName',     form.bank_name);
  _setVal('accountBankCode',     form.bank_code);
  _setVal('accountAgency',       form.agency);
  _setVal('accountNumber',       form.account_number);
  _setVal('accountIban',         form.iban);
  _setVal('accountRoutingNumber',form.routing_number);
  _setVal('accountSwiftBic',     form.swift_bic);
  // Chaves PIX — suporte a múltiplas chaves (pix_keys JSONB) com fallback para pix_key legado
  (function _loadPixKeys() {
    // Normalizar: preferir pix_keys (array), fallback pix_key (string legada)
    let keys = [];
    if (Array.isArray(form.pix_keys) && form.pix_keys.length > 0) {
      keys = form.pix_keys;
    } else if (form.pix_key) {
      keys = [{ type: 'aleatoria', key: form.pix_key }];
    }
    _acmSetPixKeys(keys);
  })();
  // If account has bank data, remember so we can switch to the bank tab after open
  const _hasBankData = !!(form.bank_name || form.bank_code || form.agency ||
                           form.account_number || form.iban || form.routing_number || form.swift_bic);
  if (_hasBankData && id) {
    // Will be handled after openModal — switch to bank tab
    window._acmOpenOnTab = 'bank';
  } else if (isCC && id) {
    window._acmOpenOnTab = 'card';
  } else {
    window._acmOpenOnTab = 'basic';
  }
  // Observações
  const notesEl = document.getElementById('accountNotes');
  if (notesEl) notesEl.value = form.notes || '';
  // Cartão
  const cardDataSec = document.getElementById('accountCardDataSection');
  if (cardDataSec) cardDataSec.style.display = isCC ? '' : 'none';
  _setVal('accountCardBrand',  form.card_brand);
  _setVal('accountCardType',   form.card_type);
  _setVal('accountCardIssuer', form.card_issuer);
  const cardLimitEl = document.getElementById('accountCardLimit');
  if (cardLimitEl) cardLimitEl.value = form.card_limit != null ? form.card_limit : '';
  // Vincular sonho — popular select com sonhos ativos
  const dreamSel = document.getElementById('accountLinkedDreamId');
  if (dreamSel) {
    dreamSel.innerHTML = '<option value="">— Nenhum —</option>';
    try {
      const { data: dreams } = await famQ(
        sb.from('dreams').select('id,title,dream_type').eq('status','active').order('title')
      );
      (dreams || []).forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = (_dreamTypeEmoji?.(d.dream_type)||'🌟') + ' ' + (d.title || d.id);
        dreamSel.appendChild(opt);
      });
    } catch(_) {}
    dreamSel.value = form.linked_dream_id || '';
  }
  openModal('accountModal');
  // acmSwitchTab DEVE ser chamado APÓS openModal para garantir que o overlay
  // já recebeu .open (pointer-events:all) antes de manipular os panes.
  // 80ms é suficiente para a transição de opacity (.22s) iniciar e o CSS render.
  setTimeout(() => {
    syncIconPickerToValue(form.icon||'', form.color||'#2a6049');
    acmSwitchTab(window._acmOpenOnTab || 'basic');
    window._acmOpenOnTab = null;
    acmLivePreview();
    const body = document.querySelector('#accountModal .acm-body');
    if (body) body.scrollTop = 0;
    // ── Archive button visibility ──────────────────────────────────────
    _acmUpdateArchiveButton(id, form.is_archived);
  }, 80);
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
  const _gv = id => (document.getElementById(id)?.value || '').trim() || null;
  const data={
    name:document.getElementById('accountName').value.trim(),
    // Map any legacy/invalid enum values to 'outros' before saving
    // (prevents 'invalid input value for enum account_type' DB error)
    type:(()=>{
      const raw = document.getElementById('accountType').value;
      const validTypes = ['corrente','poupanca','cartao_credito','investimento','dinheiro','outros'];
      return validTypes.includes(raw) ? raw : 'outros';
    })(),
    currency:document.getElementById('accountCurrency').value,
    initial_balance:getAmtField('accountBalance'),
    icon:document.getElementById('accountIcon').value||'',
    color:document.getElementById('accountColor').value,
    is_brazilian:isBR,
    iof_rate:isBR?(parseFloat(iofRateEl&&iofRateEl.value)||3.5):null,
    group_id:gid,
    is_favorite: favEl ? !!favEl.checked : false,
    chat_enabled: document.getElementById('accountChatEnabled') ? !!document.getElementById('accountChatEnabled').checked : true,
    best_purchase_day: isCC&&bpdEl&&bpdEl.value ? (parseInt(bpdEl.value)||null) : null,
    due_day: isCC&&ddEl&&ddEl.value ? (parseInt(ddEl.value)||null) : null,
    // Dados bancários
    bank_name:       _gv('accountBankName'),
    bank_code:       _gv('accountBankCode'),
    agency:          _gv('accountAgency'),
    account_number:  _gv('accountNumber'),
    iban:            _gv('accountIban'),
    routing_number:  _gv('accountRoutingNumber'),
    swift_bic:       _gv('accountSwiftBic'),
    pix_keys:        _acmGetPixKeys(),
    // pix_key mantido como primeira chave para compatibilidade com código legado
    pix_key:         (_acmGetPixKeys()[0]?.key) || null,
    // Cartão
    card_brand:   isCC ? (_gv('accountCardBrand')  || null) : null,
    card_type:    isCC ? (_gv('accountCardType')   || null) : null,
    card_issuer:  isCC ? (_gv('accountCardIssuer') || null) : null,
    card_limit:   isCC ? (parseFloat(document.getElementById('accountCardLimit')?.value) || null) : null,
    // Vincular sonho
    linked_dream_id: _gv('accountLinkedDreamId') || null,
    // Observações
    notes: (document.getElementById('accountNotes')?.value || '').trim() || null,
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
      .filter(a => a.id !== id && a.active !== false && !a.is_archived)
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

const _GROUP_ICONS = [
  // ── Bandeiras: Américas
  '🇧🇷','🇺🇸','🇨🇦','🇲🇽','🇦🇷','🇨🇴','🇨🇱','🇵🇾','🇺🇾','🇵🇪','🇧🇴','🇻🇪',
  // ── Bandeiras: Europa
  '🇪🇺','🇬🇧','🇩🇪','🇫🇷','🇮🇹','🇪🇸','🇵🇹','🇨🇭','🇦🇹','🇧🇪','🇳🇱','🇸🇪','🇳🇴','🇩🇰','🇫🇮','🇵🇱','🇨🇿','🇷🇴','🇭🇺','🇬🇷','🇮🇪','🇭🇷',
  // ── Bandeiras: Ásia & Oceania
  '🇯🇵','🇨🇳','🇰🇷','🇮🇳','🇸🇬','🇭🇰','🇦🇪','🇸🇦','🇮🇱','🇹🇷','🇦🇺','🇳🇿',
  // ── Bandeiras: África
  '🇿🇦','🇳🇬','🇪🇬','🇰🇪','🇲🇦',
  // ── Finanças & Bancos
  '🏦','💳','💰','💵','💴','💶','💷','🪙','💎','📈','📉','📊','🏧','💹','🏪','💸','🤑','🏛️','💼',
  // ── Investimentos & Patrimônio
  '🏗️','🏢','🏠','🏡','🚗','✈️','🛳️','⚓','⛏️','🛢️','⚡','🌱',
  // ── Família & Pessoas
  '👨‍👩‍👧‍👦','👤','👥','🧑‍💼','👶','🤝','💑',
  // ── Categorias de gasto
  '🛒','🍔','🍕','☕','🎮','🎬','📚','🏋️','🎵','🎨','🏥','🚌','⛽','🔧','🛍️','🎁','🐾',
  // ── Genéricos
  '⭐','🌟','💫','✨','🎯','🏆','🥇','🗂️','📁','📦','🔒','🛡️','🌐','⚙️','📱',
];

function _populateGroupIconPicker(selectedEmoji) {
  const picker = document.getElementById('groupIconPicker');
  if (!picker) return;

  // Grouped icon sections for easier browsing
  const sections = [
    { label:'🌎 Américas',   icons:['🇧🇷','🇺🇸','🇨🇦','🇲🇽','🇦🇷','🇨🇴','🇨🇱','🇵🇾','🇺🇾','🇵🇪','🇧🇴','🇻🇪'] },
    { label:'🌍 Europa',     icons:['🇪🇺','🇬🇧','🇩🇪','🇫🇷','🇮🇹','🇪🇸','🇵🇹','🇨🇭','🇦🇹','🇧🇪','🇳🇱','🇸🇪','🇳🇴','🇩🇰','🇫🇮','🇵🇱','🇨🇿','🇷🇴','🇭🇺','🇬🇷','🇮🇪'] },
    { label:'🌏 Ásia & Oceania', icons:['🇯🇵','🇨🇳','🇰🇷','🇮🇳','🇸🇬','🇭🇰','🇦🇪','🇸🇦','🇮🇱','🇹🇷','🇦🇺','🇳🇿'] },
    { label:'🌍 África',     icons:['🇿🇦','🇳🇬','🇪🇬','🇰🇪','🇲🇦'] },
    { label:'🏦 Finanças',   icons:['🏦','💳','💰','💵','💴','💶','💷','🪙','💎','📈','📉','📊','🏧','💹','💸','🤑','🏛️','💼'] },
    { label:'🏠 Patrimônio', icons:['🏗️','🏢','🏠','🏡','🚗','✈️','🛳️','⚓','⛏️','🛢️','⚡','🌱'] },
    { label:'👥 Família',    icons:['👨‍👩‍👧‍👦','👤','👥','🧑‍💼','👶','🤝','💑'] },
    { label:'⭐ Outros',     icons:['⭐','🌟','💫','✨','🎯','🏆','🥇','🗂️','📁','📦','🔒','🛡️','🌐','⚙️','📱','🛒','🎮','📚','🎵','🎨'] },
  ];

  picker.innerHTML = sections.map(sec => {
    const btns = sec.icons.map(icon => {
      const sel = icon === selectedEmoji;
      return `<button type="button" title="${icon}" data-icon="${icon}"
        onclick="document.getElementById('groupEmoji').value='${icon}';document.getElementById('groupEmojiPreview').textContent='${icon}';document.querySelectorAll('#groupIconPicker button').forEach(b=>b.style.background='none');this.style.background='var(--accent)22';this.style.borderColor='var(--accent)'"
        style="width:34px;height:34px;border-radius:7px;font-size:1.1rem;border:1.5px solid ${sel ? 'var(--accent)' : 'transparent'};background:${sel ? 'var(--accent)22' : 'none'};cursor:pointer;transition:all .12s;display:flex;align-items:center;justify-content:center">${icon}</button>`;
    }).join('');
    return `<div style="margin-bottom:8px">
      <div style="font-size:.66rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:4px;padding:0 2px">${sec.label}</div>
      <div style="display:flex;flex-wrap:wrap;gap:3px">${btns}</div>
    </div>`;
  }).join('');
}window._populateGroupIconPicker = _populateGroupIconPicker;

function _selectGroupIcon(icon) {
  const input = document.getElementById('groupEmoji');
  const preview = document.getElementById('groupEmojiPreview');
  if (input) input.value = icon;
  if (preview) preview.textContent = icon;
  _populateGroupIconPicker(icon);
}
window._selectGroupIcon = _selectGroupIcon;

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
  // Populate icon picker
  _populateGroupIconPicker(document.getElementById('groupEmoji').value || '🗂️');
  // Sync preview
  const prev = document.getElementById('groupEmojiPreview');
  if (prev) prev.textContent = document.getElementById('groupEmoji').value || '🗂️';
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
    const apiKey = await getGeminiApiKey();
    if (!apiKey) {
      content.innerHTML = bankChipHtml ||
        '<div style="color:var(--red,#dc2626);font-size:.78rem;padding:8px">Configure a chave Gemini em Configurações → IA</div>';
      return;
    }

    const typeLabels = { corrente:'Conta Corrente', poupanca:'Poupança', cartao_credito:'Cartão de Crédito', vale_refeicao:'Vale Refeição/Alimentação', investimento:'Investimentos', dinheiro:'Dinheiro', outros:'Outros' };
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

    const _cfgModel = (typeof getGeminiModel === 'function') ? await getGeminiModel() : 'gemini-2.5-flash';
    // geminiRetryFetch: handles thinkingConfig, retry, and responseMimeType fallback automatically
    const _accUrl = `https://generativelanguage.googleapis.com/v1beta/models/${_cfgModel}:generateContent?key=${apiKey}`;
    const _accData = await geminiRetryFetch(_accUrl, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 400, temperature: 0.3, responseMimeType: 'application/json' },
    });
    const parsed = _parseGeminiJSON(_accData);

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
  // Update live preview and close flyout
  if (typeof acmLivePreview === 'function') acmLivePreview();
  const fp = document.getElementById('acmIconPickerFlyout');
  if (fp) setTimeout(() => { fp.style.display = 'none'; }, 300);
};

// ── Painel de detalhes da conta (acionado pelo dashboard) ─────────────────
function openAccountDetailPanel(accountId) {
  const a = (state.accounts || []).find(x => x.id === accountId);
  if (!a) { toast('Conta não encontrada', 'error'); return; }

  document.getElementById('accDetailPanel')?.remove();

  const typeLabel = accountTypeLabel(a.type) || a.type;
  const balColor  = a.balance < 0 ? 'var(--red)' : 'var(--accent)';
  const bankInfo  = [a.bank_name, a.agency && `Ag: ${a.agency}`, a.account_number && `CC: ${a.account_number}`]
    .filter(Boolean).join(' · ');
  const cardInfo  = a.type === 'cartao_credito'
    ? [a.card_brand, a.card_type, a.card_limit && `Limite: ${fmt(a.card_limit)}`].filter(Boolean).join(' · ')
    : '';
  const ibanInfo  = a.iban ? `IBAN: ${a.iban}` : (a.routing_number ? `Routing: ${a.routing_number}` : '');
  const swiftInfo = a.swift_bic ? `SWIFT: ${a.swift_bic}` : '';
  // PIX keys — suporte a pix_keys[] e legado pix_key
  const pixKeys = (Array.isArray(a.pix_keys) && a.pix_keys.length)
    ? a.pix_keys
    : (a.pix_key ? [{ type: 'aleatoria', key: a.pix_key }] : []);
  const PIX_TYPE_LABELS = { cpf:'CPF', cnpj:'CNPJ', email:'E-mail', phone:'Telefone', aleatoria:'Chave aleatória' };

  const panel = document.createElement('div');
  panel.id = 'accDetailPanel';
  panel.className = 'modal-overlay open';
  panel.style.zIndex = '10020';
  panel.onclick = e => { if (e.target === panel) { panel.classList.remove('open'); setTimeout(()=>panel.remove(),300); } };
  panel.innerHTML = `
  <div class="modal" style="max-width:400px"><div class="modal-handle"></div>
    <div class="modal-header">
      <span class="modal-title">${_dashRenderIcon ? '' : '🏦 '}${esc(a.name)}</span>
      <button class="modal-close" onclick="(()=>{const p=document.getElementById('accDetailPanel');if(p){p.classList.remove('open');setTimeout(()=>p.remove(),300);}})()">✕</button>
    </div>
    <div class="modal-body" style="padding:16px">
      <!-- Balance hero -->
      <div style="text-align:center;padding:16px;background:var(--surface2);border-radius:12px;margin-bottom:16px">
        <div style="font-size:.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">${esc(typeLabel)}</div>
        <div style="font-size:1.8rem;font-weight:800;font-family:var(--font-serif);color:${balColor}">${fmt(a.balance, a.currency)}</div>
        ${a.currency !== 'BRL' ? `<div style="font-size:.82rem;color:var(--muted);margin-top:2px">≈ ${fmt(toBRL ? toBRL(a.balance, a.currency) : a.balance, 'BRL')} BRL</div>` : ''}
      </div>

      <!-- Info rows -->
      <div style="display:flex;flex-direction:column;gap:8px;font-size:.85rem">
        ${a.group_id ? (() => { const g = (state.groups||[]).find(x=>x.id===a.group_id); return g ? `<div style="display:flex;justify-content:space-between"><span style="color:var(--muted)">Grupo</span><span>${esc(g.name)}</span></div>` : ''; })() : ''}
        ${a.currency !== 'BRL' ? `<div style="display:flex;justify-content:space-between"><span style="color:var(--muted)">Moeda</span><span>${esc(a.currency)}</span></div>` : ''}
        ${bankInfo ? `<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px"><span style="color:var(--muted)">Banco</span><span style="text-align:right">${esc(bankInfo)}</span></div>` : ''}
        ${cardInfo ? `<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px"><span style="color:var(--muted)">Cartão</span><span style="text-align:right">${esc(cardInfo)}</span></div>` : ''}
        ${ibanInfo ? `<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px"><span style="color:var(--muted)">IBAN / Routing</span><span style="font-family:monospace;font-size:.78rem;text-align:right">${esc(ibanInfo)}</span></div>` : ''}
        ${swiftInfo ? `<div style="display:flex;justify-content:space-between"><span style="color:var(--muted)">SWIFT/BIC</span><span style="font-family:monospace;font-size:.78rem">${esc(swiftInfo)}</span></div>` : ''}
        ${pixKeys.length ? `<div style="margin-top:6px;padding:8px 10px;background:rgba(0,180,216,.07);border:1px solid rgba(0,180,216,.2);border-radius:9px">
          <div style="font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#0369a1;margin-bottom:6px;display:flex;align-items:center;gap:5px"><span style="display:inline-flex;align-items:center;justify-content:center;background:#00b4d8;color:#fff;border-radius:4px;width:16px;height:16px;font-size:.6rem;font-weight:900">PIX</span> Chaves PIX</div>
          ${pixKeys.map(p => `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px;padding:5px 0;border-bottom:1px solid rgba(0,180,216,.1)">
            <span style="font-size:.72rem;color:#0369a1;font-weight:700;flex-shrink:0">${PIX_TYPE_LABELS[p.type]||p.type}</span>
            <span style="font-family:monospace;font-size:.79rem;color:var(--text);word-break:break-all;text-align:right">${esc(p.key)}</span>
            <button onclick="navigator.clipboard?.writeText('${p.key.replace(/'/g,"\'")}');toast('Chave copiada!','success')" title="Copiar chave" style="flex-shrink:0;background:none;border:none;cursor:pointer;font-size:.9rem;padding:2px 4px;color:#0369a1">⎘</button>
          </div>`).join('')}
        </div>` : ''}
        ${a.due_day ? `<div style="display:flex;justify-content:space-between"><span style="color:var(--muted)">Vencimento</span><span>Dia ${a.due_day}</span></div>` : ''}
        ${a.notes ? `<div style="margin-top:4px;padding:8px 10px;background:var(--surface2);border-radius:8px;color:var(--text2);font-size:.82rem;line-height:1.45">${esc(a.notes)}</div>` : ''}
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="(()=>{const p=document.getElementById('accDetailPanel');if(p){p.classList.remove('open');setTimeout(()=>p.remove(),300);}})()">Fechar</button>
      <button class="btn btn-primary" onclick="(()=>{const p=document.getElementById('accDetailPanel');if(p){p.classList.remove('open');setTimeout(()=>p.remove(),300);}})();openAccountModal('${a.id}')">✏️ Editar</button>
    </div>
  </div>`;
  document.body.appendChild(panel);
}
window.openAccountDetailPanel = openAccountDetailPanel;

// ══════════════════════════════════════════════════════════════════
// ACCOUNT MODAL — tab system + live preview
// ══════════════════════════════════════════════════════════════════

function acmSwitchTab(tab) {
  // Update tab buttons
  document.querySelectorAll('.acm-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  // Update panes
  document.querySelectorAll('.acm-pane').forEach(pane => {
    pane.classList.toggle('active', pane.id === `acmPane-${tab}`);
  });
  // Close icon picker if open
  const fp = document.getElementById('acmIconPickerFlyout');
  if (fp) fp.style.display = 'none';
  // Show/hide card notice
  if (tab === 'card') {
    const isCC = document.getElementById('accountType')?.value === 'cartao_credito';
    const notice = document.getElementById('acmCardNotice');
    if (notice) notice.style.display = isCC ? 'none' : '';
    const cardSections = document.getElementById('accountCardDataSection');
    const iofCfg = document.getElementById('accountIofConfig');
    if (cardSections) cardSections.style.display = isCC ? '' : 'none';
    if (iofCfg) iofCfg.style.display = isCC ? '' : 'none';
  }
}
window.acmSwitchTab = acmSwitchTab;

function acmToggleIconPicker() {
  const fp = document.getElementById('acmIconPickerFlyout');
  if (!fp) return;
  const isOpen = fp.style.display !== 'none';
  fp.style.display = isOpen ? 'none' : '';
  if (!isOpen) {
    // Close on next outside click
    const handler = (e) => {
      const sel = document.getElementById('acmIconSelector');
      if (!fp.contains(e.target) && sel !== e.target && !sel?.contains(e.target)) {
        fp.style.display = 'none';
        document.removeEventListener('click', handler, true);
      }
    };
    setTimeout(() => document.addEventListener('click', handler, true), 50);
  }
}
window.acmToggleIconPicker = acmToggleIconPicker;

function acmLivePreview() {
  const name   = document.getElementById('accountName')?.value || 'Nova Conta';
  const type   = document.getElementById('accountType')?.value || 'corrente';
  const color  = document.getElementById('accountColor')?.value || '#2a6049';
  const icon   = document.getElementById('accountIcon')?.value || '';
  const balRaw = (typeof getAmtField === 'function')
    ? (getAmtField('accountBalance') || 0)
    : (() => {
        const balEl = document.getElementById('accountBalance');
        const s = (balEl?.value||'0').replace(/[^\d,.-]/g,'');
        return parseFloat(s.includes(',') ? s.replace(/\./g,'').replace(',','.') : s) || 0;
      })();

  const typeLabels = {
    corrente:'Conta Corrente', poupanca:'Poupança',
    cartao_credito:'Cartão de Crédito', investimento:'Investimentos',
    dinheiro:'Dinheiro / Caixa', outros:'Outros'
  };

  // Name
  const pName = document.getElementById('acmPreviewName');
  if (pName) pName.textContent = name || 'Nova Conta';

  // Type
  const pType = document.getElementById('acmPreviewType');
  if (pType) pType.textContent = typeLabels[type] || type;

  // Balance
  const pBal = document.getElementById('acmPreviewBalance');
  if (pBal) {
    const fmt = typeof dashFmt === 'function'
      ? dashFmt(balRaw, document.getElementById('accountCurrency')?.value || 'BRL')
      : `R$ ${balRaw.toFixed(2)}`;
    pBal.textContent = fmt;
    pBal.style.color = balRaw < 0 ? '#fca5a5' : 'rgba(255,255,255,.85)';
  }

  // Icon
  const rendered = typeof renderIconEl === 'function' ? renderIconEl(icon, color, 22) : ((icon && icon.startsWith('emoji-')) ? icon.replace('emoji-','') : '🏦');
  const pIcon = document.getElementById('acmPreviewIcon');
  const sIcon = document.getElementById('acmIconSelectorPreview');
  if (pIcon) pIcon.innerHTML = rendered;
  if (sIcon) sIcon.innerHTML = rendered;

  // Hero bg color tint
  const heroBg = document.getElementById('acmHeroBg');
  if (heroBg) {
    const hex = color || '#2a6049';
    heroBg.style.background = `radial-gradient(ellipse 80% 90% at 90% -20%, ${hex}66 0%, transparent 60%), radial-gradient(ellipse 50% 60% at 10% 110%, ${hex}33 0%, transparent 65%)`;
  }

  // Dim card tab when account type is not credit card
  const cardTab = document.getElementById('acmTabCard');
  if (cardTab) {
    const isCC2 = type === 'cartao_credito';
    cardTab.style.opacity = isCC2 ? '1' : '0.45';
    cardTab.title = isCC2 ? '' : 'Disponível apenas para Cartão de Crédito';
  }

  // Update hero title
  const heroTitle = document.getElementById('accountModalTitle');
  if (heroTitle && !heroTitle.dataset.locked) {
    heroTitle.textContent = document.getElementById('accountId')?.value ? 'Editar Conta' : 'Nova Conta';
  }
}
window.acmLivePreview = acmLivePreview;

// Patch selectAccountIcon (defined in ui_helpers.js) to also update live preview
// We use DOMContentLoaded to ensure ui_helpers.js has already defined the function
document.addEventListener('DOMContentLoaded', function() {
  const _orig = window.selectAccountIcon || function(){};
  window.selectAccountIcon = function(el) {
    _orig.call(this, el);
    acmLivePreview();
    // Close icon picker flyout after selection
    const fp = document.getElementById('acmIconPickerFlyout');
    if (fp) setTimeout(() => { fp.style.display = 'none'; }, 180);
  };
});


function _acmUpdateArchiveButton(accountId, isArchived) {
  const wrap = document.getElementById('acmArchiveWrap');
  if (!wrap) return;
  if (!accountId) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  const btn = document.getElementById('acmArchiveBtn');
  if (!btn) return;
  if (isArchived) {
    btn.textContent = '📤 Desarquivar conta';
    btn.className   = 'acm-btn-unarchive';
    btn.onclick     = () => { closeModal('accountModal'); unarchiveAccount(accountId); };
  } else {
    btn.textContent = '📦 Arquivar conta';
    btn.className   = 'acm-btn-archive';
    btn.onclick     = () => archiveAccount(accountId);
  }
}


/* ════════════════════════════════════════════════════════════════════
   ARCHIVE / UNARCHIVE ACCOUNT
════════════════════════════════════════════════════════════════════ */
let _archiveAccId = null;

async function archiveAccount(id) {
  const acc = state.accounts.find(a => a.id === id);
  if (!acc) return;
  _archiveAccId = id;

  // ── Check for active/future scheduled transactions ─────────────────
  const today = new Date().toISOString().slice(0, 10);
  const { data: scData } = await famQ(
    sb.from('scheduled_transactions')
      .select('id,description,frequency,status,end_date,account_id,transfer_to_account_id')
  ).or(`account_id.eq.${id},transfer_to_account_id.eq.${id}`);

  const activeScheduled = (scData || []).filter(sc => {
    if (sc.status === 'finished') return false;
    if (sc.end_date && sc.end_date < today) return false;
    return true;
  });

  if (activeScheduled.length > 0) {
    const names = activeScheduled.slice(0, 5)
      .map(s => '• ' + (s.description || '(sem descrição)'))
      .join(', ');
    toast(
      '⚠️ Esta conta possui ' + activeScheduled.length + ' transação(ões) programada(s) ativa(s): ' +
      names + '. Altere a conta dessas transações antes de arquivar.',
      'error'
    );
    if (confirm(
      'Esta conta tem ' + activeScheduled.length + ' transação(ões) programada(s) ativa(s).\n\n' +
      'Você precisa alterar a conta dessas transações antes de arquivar.\n\n' +
      'Deseja ir para Programados agora?'
    )) {
      navigate('scheduled');
    }
    return;
  }

  // ── Confirm archival ───────────────────────────────────────────────
  // Populate the archive confirm modal
  const el = id => document.getElementById(id);
  if (el('archAccIcon')) {
    el('archAccIcon').innerHTML = typeof renderIconEl === 'function'
      ? renderIconEl(acc.icon, acc.color, 28)
      : `<span style="font-size:1.3rem">${acc.icon || '🏦'}</span>`;
  }
  if (el('archAccName'))    el('archAccName').textContent    = acc.name;
  if (el('archAccType'))    el('archAccType').textContent    = accountTypeLabel(acc.type) + ' · ' + (acc.currency || 'BRL');
  if (el('archAccBalance')) {
    el('archAccBalance').textContent = fmt(acc.balance, acc.currency);
    el('archAccBalance').style.color = acc.balance < 0 ? 'var(--red)' : 'var(--accent)';
  }
  if (el('archAccReason')) el('archAccReason').value = '';

  openModal('archiveAccountModal');
}

async function confirmArchiveAccount() {
  if (!_archiveAccId) return;
  const btn = document.getElementById('archAccConfirmBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Arquivando…'; }

  try {
    const reason = document.getElementById('archAccReason')?.value?.trim() || null;
    const { error } = await sb.from('accounts')
      .update({
        is_archived:    true,
        archived_at:    new Date().toISOString(),
        archive_reason: reason,
      })
      .eq('id', _archiveAccId);

    if (error) throw error;

    toast('📦 Conta arquivada com sucesso!', 'success');
    closeModal('archiveAccountModal');
    closeModal('accountModal');
    _archiveAccId = null;

    // Reload and re-render
    await loadAccounts();
    if (typeof populateSelects === 'function') populateSelects();
    renderAccounts(_accountsViewMode);
    if (state.currentPage === 'dashboard') loadDashboard?.();
  } catch(e) {
    toast('Erro ao arquivar: ' + (e.message || e), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📦 Confirmar Arquivamento'; }
  }
}

async function unarchiveAccount(id) {
  if (!confirm('Deseja desarquivar esta conta? Ela voltará a aparecer normalmente em todos os seletores e listagens.')) return;

  try {
    const { error } = await sb.from('accounts')
      .update({ is_archived: false, archived_at: null, archive_reason: null })
      .eq('id', id);

    if (error) throw error;

    toast('✅ Conta desarquivada!', 'success');
    await loadAccounts();
    if (typeof populateSelects === 'function') populateSelects();
    renderAccounts(_accountsViewMode);
    if (state.currentPage === 'dashboard') loadDashboard?.();
  } catch(e) {
    toast('Erro ao desarquivar: ' + (e.message || e), 'error');
  }
}

window.archiveAccount        = archiveAccount;
window.confirmArchiveAccount = confirmArchiveAccount;
window.unarchiveAccount      = unarchiveAccount;

// ── Expor funções públicas no window (necessário para onclick inline em HTML dinâmico) ──
window.openAccountModal        = openAccountModal;
window.saveAccount             = saveAccount;
window.deleteAccount           = deleteAccount;
window.confirmDeleteAccount    = confirmDeleteAccount;
window.onDelAccOptionChange    = onDelAccOptionChange;
window.onDelAccConfirmType     = onDelAccConfirmType;
window.openConsolidateModal    = openConsolidateModal;
window.saveConsolidation       = saveConsolidation;
window.goToAccountTransactions = goToAccountTransactions;
window.accountTypeLabel        = accountTypeLabel;
window.filterAccounts          = filterAccounts;
window.renderAccounts          = renderAccounts;
window.loadAccounts            = loadAccounts;
window.toggleGroupCollapse     = toggleGroupCollapse;
window.openGroupModal          = openGroupModal;
window.cancelGroupEdit         = cancelGroupEdit;
window.saveGroup               = saveGroup;
window.deleteGroup             = deleteGroup;
window.onAccountTypeChange     = onAccountTypeChange;
window.initAccountsPage        = initAccountsPage;


// ════════════════════════════════════════════════════════════════════════════
//  CHAVES PIX — Gerenciamento de até 3 chaves por conta
// ════════════════════════════════════════════════════════════════════════════

const _PIX_TYPES = [
  { value: 'cpf',       label: 'CPF',             placeholder: '000.000.000-00', inputmode: 'numeric' },
  { value: 'cnpj',      label: 'CNPJ',            placeholder: '00.000.000/0001-00', inputmode: 'numeric' },
  { value: 'email',     label: 'E-mail',           placeholder: 'seu@email.com', inputmode: 'email' },
  { value: 'phone',     label: 'Telefone',         placeholder: '+55 11 99999-9999', inputmode: 'tel' },
  { value: 'aleatoria', label: 'Chave aleatória',  placeholder: 'UUID gerado pelo banco', inputmode: 'text' },
];
const _PIX_MAX = 3;
let _acmPixSeq = 0; // sequência para IDs únicos de linhas

// ── Renderizar container de chaves ────────────────────────────────────────
function _acmRenderPixKeys() {
  const container = document.getElementById('accountPixKeysContainer');
  const addBtn    = document.getElementById('acmAddPixKeyBtn');
  if (!container) return;

  const rows = container.querySelectorAll('.acm-pix-row');
  const count = rows.length;

  if (addBtn) addBtn.disabled = count >= _PIX_MAX;

  if (count === 0) {
    container.innerHTML = `<div id="acmPixEmpty" style="padding:10px 12px;border:1.5px dashed var(--border);border-radius:9px;text-align:center;font-size:.78rem;color:var(--muted)">
      Nenhuma chave PIX. Clique em <strong>+ Adicionar</strong> para incluir.
    </div>`;
  } else {
    const empty = document.getElementById('acmPixEmpty');
    if (empty) empty.remove();
  }
}

// ── Adicionar nova linha de chave PIX ─────────────────────────────────────
function _acmAddPixKey(prefill) {
  const container = document.getElementById('accountPixKeysContainer');
  if (!container) return;

  const currentRows = container.querySelectorAll('.acm-pix-row').length;
  if (currentRows >= _PIX_MAX) {
    toast(`Máximo de ${_PIX_MAX} chaves PIX por conta.`, 'warning');
    return;
  }

  // Remove placeholder vazio
  const empty = document.getElementById('acmPixEmpty');
  if (empty) empty.remove();

  const rowId  = ++_acmPixSeq;
  const selVal = prefill?.type || 'cpf';
  const keyVal = prefill?.key  || '';

  const opts = _PIX_TYPES.map(t =>
    `<option value="${t.value}"${t.value === selVal ? ' selected' : ''}>${t.label}</option>`
  ).join('');

  const defPh = _PIX_TYPES.find(t => t.value === selVal)?.placeholder || '';
  const defIm = _PIX_TYPES.find(t => t.value === selVal)?.inputmode   || 'text';

  const row = document.createElement('div');
  row.className = 'acm-pix-row';
  row.id = `acmPixRow_${rowId}`;
  row.style.cssText = 'display:flex;gap:6px;align-items:stretch';
  row.innerHTML = `
    <select id="acmPixType_${rowId}"
      style="flex-shrink:0;width:130px;padding:8px 6px;background:var(--surface);border:1.5px solid var(--border);border-radius:9px;font-size:.78rem;color:var(--text);font-family:inherit;cursor:pointer"
      onchange="_acmUpdatePixPlaceholder(${rowId})">
      ${opts}
    </select>
    <input type="text" id="acmPixKey_${rowId}"
      class="acm-input"
      style="flex:1;font-family:monospace;font-size:.82rem"
      placeholder="${esc(defPh)}"
      inputmode="${defIm}"
      value="${esc(keyVal)}"
      autocomplete="off"
      autocorrect="off"
      spellcheck="false">
    <button type="button"
      onclick="_acmRemovePixKey(${rowId})"
      title="Remover chave"
      style="flex-shrink:0;padding:0 10px;background:transparent;border:1.5px solid var(--border);border-radius:9px;color:var(--muted);cursor:pointer;font-size:.9rem;transition:all .15s"
      onmouseover="this.style.background='var(--danger,#dc2626)';this.style.color='#fff';this.style.borderColor='var(--danger,#dc2626)'"
      onmouseout="this.style.background='transparent';this.style.color='var(--muted)';this.style.borderColor='var(--border)'">✕</button>`;

  container.appendChild(row);
  _acmRenderPixKeys();

  // Focus no campo de valor
  setTimeout(() => document.getElementById(`acmPixKey_${rowId}`)?.focus(), 50);
}
window._acmAddPixKey = _acmAddPixKey;

// ── Remover linha ─────────────────────────────────────────────────────────
function _acmRemovePixKey(rowId) {
  document.getElementById(`acmPixRow_${rowId}`)?.remove();
  _acmRenderPixKeys();
}
window._acmRemovePixKey = _acmRemovePixKey;

// ── Atualizar placeholder ao trocar tipo ──────────────────────────────────
function _acmUpdatePixPlaceholder(rowId) {
  const sel   = document.getElementById(`acmPixType_${rowId}`);
  const input = document.getElementById(`acmPixKey_${rowId}`);
  if (!sel || !input) return;
  const meta = _PIX_TYPES.find(t => t.value === sel.value);
  if (meta) {
    input.placeholder   = meta.placeholder;
    input.inputMode     = meta.inputmode;
  }
}
window._acmUpdatePixPlaceholder = _acmUpdatePixPlaceholder;

// ── Ler todas as chaves do DOM → array para salvar ────────────────────────
function _acmGetPixKeys() {
  const container = document.getElementById('accountPixKeysContainer');
  if (!container) return [];
  const result = [];
  container.querySelectorAll('.acm-pix-row').forEach(row => {
    const rowId = row.id.replace('acmPixRow_', '');
    const type  = document.getElementById(`acmPixType_${rowId}`)?.value?.trim() || 'aleatoria';
    const key   = (document.getElementById(`acmPixKey_${rowId}`)?.value || '').trim();
    if (key) result.push({ type, key });
  });
  return result;
}
window._acmGetPixKeys = _acmGetPixKeys;

// ── Carregar array de chaves → preencher DOM ──────────────────────────────
function _acmSetPixKeys(keys) {
  const container = document.getElementById('accountPixKeysContainer');
  if (!container) return;
  container.innerHTML = '';
  _acmPixSeq = 0;

  const arr = Array.isArray(keys) ? keys.slice(0, _PIX_MAX) : [];
  arr.forEach(k => _acmAddPixKey(k));

  if (!arr.length) _acmRenderPixKeys(); // mostra placeholder vazio
}
window._acmSetPixKeys = _acmSetPixKeys;
