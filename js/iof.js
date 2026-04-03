function toggleAccountIof() {
  const isBR = document.getElementById('accountIsBrazilian').checked;
  document.getElementById('accountIofRateGroup').style.display = isBR ? '' : 'none';
}

function onAccountTypeChange() {
  const type = document.getElementById('accountType').value;
  document.getElementById('accountIofConfig').style.display = type === 'cartao_credito' ? '' : 'none';
}

function checkAccountIofConfig(accountId, txCurrency) {
  const iofGroup = document.getElementById('txIofGroup');
  if(!iofGroup) return;
  if(!accountId) { iofGroup.style.display='none'; return; }
  const acct = state.accounts.find(a=>a.id===accountId);
  if(!acct) { iofGroup.style.display='none'; return; }

  const accountCurrency = acct.currency || 'BRL';
  const selectedTxCur = txCurrency || _getTxSelectedCurrency?.() || accountCurrency;
  const currenciesDiffer = selectedTxCur !== accountCurrency;

  // Show IOF when: cartão de crédito E (cartão brasileiro OU moedas diferentes)
  if(acct.type==='cartao_credito' && (acct.is_brazilian || currenciesDiffer)) {
    iofGroup.style.display = '';
    // Auto-marcar quando moedas diferem (Feature 2)
    const cb = document.getElementById('txIsInternational');
    if(cb && currenciesDiffer && !cb.checked) {
      cb.checked = true;
    }
    updateIofMirror();
  } else {
    iofGroup.style.display = 'none';
    const cb = document.getElementById('txIsInternational');
    if(cb) cb.checked = false;
    const info = document.getElementById('txIofMirrorInfo');
    if(info) info.classList.remove('visible');
  }
}

// Feature 3: busca ou sugere criação da categoria "Impostos"
async function _getOrSuggestImpostosCategory() {
  // Busca em state.categories
  const cat = (state.categories||[]).find(c =>
    c.name?.toLowerCase() === 'impostos' && !c.parent_id
  );
  if(cat) return cat.id;

  // Não existe — sugere criação
  const criar = confirm('Categoria "Impostos" não encontrada.\nDeseja criá-la agora para classificar o IOF?');
  if(!criar) return null;

  const {data, error} = await sb.from('categories').insert({
    name: 'Impostos',
    color: '#dc2626',
    icon: '🏛️',
    family_id: famId(),
    updated_at: new Date().toISOString()
  }).select().single();

  if(error) { toast('Erro ao criar categoria Impostos: '+error.message,'error'); return null; }
  // Atualiza state local
  state.categories = state.categories || [];
  state.categories.push(data);
  toast('Categoria "Impostos" criada!','success');
  return data.id;
}

function toggleIofIntl() {
  const cb = document.getElementById('txIsInternational');
  cb.checked = !cb.checked;
  updateIofMirror();
}

function updateIofMirror() {
  const cb = document.getElementById('txIsInternational');
  const info = document.getElementById('txIofMirrorInfo');
  if(!cb || !info) return;
  if(!cb.checked) { info.classList.remove('visible'); return; }

  const accountId = document.getElementById('txAccountId').value;
  const acct = state.accounts.find(a=>a.id===accountId);
  const rate = acct?.iof_rate || 3.38;

  // Usa brl_amount quando há conversão (moedas diferentes)
  const accountCurrency = acct?.currency || 'BRL';
  const txCur = _getTxSelectedCurrency?.() || accountCurrency;
  const currenciesDiffer = txCur !== accountCurrency;

  let baseAmount, baseLabel;
  if(currenciesDiffer) {
    // Base = valor já convertido para moeda da conta
    const fxRate = parseFloat(document.getElementById('txCurrencyRate')?.value?.replace(',','.'));
    const rawAmt = Math.abs(getAmtField('txAmount') || 0);
    baseAmount = (fxRate > 0) ? rawAmt * fxRate : rawAmt;
    baseLabel = `${fmt(rawAmt, txCur)} × câmbio = ${fmt(baseAmount, accountCurrency)}`;
  } else {
    baseAmount = Math.abs(getAmtField('txAmount') || 0);
    baseLabel = fmt(baseAmount, accountCurrency);
  }

  const iofVal = baseAmount * rate / 100;
  info.innerHTML = `
    <strong>🧾 IOF calculado automaticamente:</strong><br>
    Base: <strong>${baseLabel}</strong> × ${rate}% = IOF de <strong style="color:var(--amber)">${fmt(iofVal, accountCurrency)}</strong><br>
    Será criada uma transação adicional de <strong style="color:var(--red)">−${fmt(iofVal, accountCurrency)}</strong>
    com categoria <strong>Impostos</strong>.
  `;
  info.classList.add('visible');
}

async function createIofMirrorTx(originalData, originalTxId) {
  try {
    const accountId = originalData.account_id;
    const acct = state.accounts.find(a=>a.id===accountId);
    if (!accountId || !acct) throw new Error('Conta da transação original não encontrada.');
    const rate = Number(acct?.iof_rate || 3.38);

    // Base do IOF: se há brl_amount (moeda diferente), usa ele; senão usa amount
    const accountCurrency = acct.currency || 'BRL';
    const base = (originalData.brl_amount != null && Math.abs(Number(originalData.brl_amount)) > 0)
      ? Math.abs(Number(originalData.brl_amount))
      : Math.abs(Number(originalData.amount) || 0);
    const iofAmount = base * rate / 100;
    if (!iofAmount) return null;

    // Feature 3: busca categoria Impostos
    const iofCatId = await _getOrSuggestImpostosCategory();

    const iofData = {
      date: originalData.date,
      description: `IOF – ${originalData.description || 'compra internacional'}`,
      amount: -Math.abs(iofAmount),
      currency: accountCurrency,
      brl_amount: accountCurrency !== 'BRL' ? null : -Math.abs(iofAmount),
      account_id: accountId,
      payee_id: null,
      category_id: iofCatId || null,
      memo: `IOF ${rate}% sobre compra internacional: ${originalData.description || ''}. Tx original: ${originalTxId}`,
      tags: ['IOF','internacional'],
      is_transfer: false,
      is_card_payment: false,
      status: originalData.status || 'confirmed',
      updated_at: new Date().toISOString(),
      family_id: originalData.family_id || famId() || null,
    };
    const { data, error } = await sb.from('transactions').insert(iofData).select().single();
    if(error) throw error;
    toast(`IOF de ${fmt(iofAmount, accountCurrency)} lançado automaticamente!`, 'success');
    return data;
  } catch(e) {
    toast('Erro ao criar IOF: ' + e.message, 'error');
    return null;
  }
}

// Also wire amount/desc changes to update IOF preview
document.addEventListener('DOMContentLoaded', () => {
  ['txAmount','txDesc'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.addEventListener('input', ()=>{ if(document.getElementById('txIsInternational')?.checked) updateIofMirror(); });
  });
  // Wire account type change
  const accType = document.getElementById('accountType');
  if(accType) accType.addEventListener('change', onAccountTypeChange);
});

/* ═══════════════════════════════════════════════════════════════
   FORECAST REPORT
═══════════════════════════════════════════════════════════════ */
