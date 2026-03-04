function toggleAccountIof() {
  const isBR = document.getElementById('accountIsBrazilian').checked;
  document.getElementById('accountIofRateGroup').style.display = isBR ? '' : 'none';
}

function onAccountTypeChange() {
  const type = document.getElementById('accountType').value;
  document.getElementById('accountIofConfig').style.display = type === 'cartao_credito' ? '' : 'none';
}

function checkAccountIofConfig(accountId) {
  const iofGroup = document.getElementById('txIofGroup');
  if(!iofGroup) return;
  if(!accountId) { iofGroup.style.display='none'; return; }
  const acct = state.accounts.find(a=>a.id===accountId);
  if(acct && acct.type==='cartao_credito' && acct.is_brazilian) {
    iofGroup.style.display = '';
    updateIofMirror();
  } else {
    iofGroup.style.display = 'none';
    const cb = document.getElementById('txIsInternational');
    if(cb) cb.checked = false;
    document.getElementById('txIofMirrorInfo').classList.remove('visible');
  }
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
  const amount = getAmtField('txAmount');
  const accountId = document.getElementById('txAccountId').value;
  const acct = state.accounts.find(a=>a.id===accountId);
  const rate = acct?.iof_rate || 3.38;
  const iofVal = (amount * rate / 100);
  info.innerHTML = `
    <strong>🧾 IOF calculado automaticamente:</strong><br>
    Valor: <strong>${fmt(amount)}</strong> × ${rate}% = IOF de <strong style="color:var(--amber)">${fmt(iofVal)}</strong><br>
    Será criada uma transação adicional de <strong style="color:var(--red)">−${fmt(iofVal)}</strong> com descrição "IOF – ${document.getElementById('txDesc').value||'compra internacional'}".
  `;
  info.classList.add('visible');
}

async function createIofMirrorTx(originalData, originalTxId) {
  try {
    const accountId = originalData.account_id;
    const acct = state.accounts.find(a=>a.id===accountId);
    const rate = acct?.iof_rate || 3.38;
    const baseAmount = Math.abs(originalData.amount);
    const iofAmount = baseAmount * rate / 100;
    const iofData = {
      date: originalData.date,
      description: `IOF – ${originalData.description}`,
      amount: -iofAmount,  // always expense
      account_id: accountId,
      payee_id: null,
      category_id: null,
      memo: `IOF ${rate}% sobre compra internacional: ${originalData.description}. Tx original: ${originalTxId}`,
      tags: ['IOF', 'internacional'],
      is_transfer: false,
      updated_at: new Date().toISOString(),
    };
    iofData.family_id = famId(); const { error } = await sb.from('transactions').insert(iofData);
    if(error) throw error;
    toast(`IOF de ${fmt(iofAmount)} lançado automaticamente!`, 'success');
  } catch(e) {
    toast('Erro ao criar IOF: ' + e.message, 'error');
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
