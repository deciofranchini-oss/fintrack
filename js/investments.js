/* ═══════════════════════════════════════════════════════════════════════
   INVESTMENTS MODULE — v1
   Tables: investment_positions, investment_transactions, investment_price_history
   Price API: brapi.dev (B3/FIIs/BDRs/Crypto) + Yahoo Finance fallback (US stocks)
   Activation: investments_enabled_{family_id} in app_settings
   Balance: account.balance += SUM(position.quantity × current_price_brl)
═══════════════════════════════════════════════════════════════════════ */

const ASSET_TYPES = [
  { value: 'acao_br',    label: 'Ação BR',       emoji: '🇧🇷', hint: 'Ex: PETR4, VALE3'    },
  { value: 'fii',        label: 'FII',           emoji: '🏢', hint: 'Ex: KNRI11, HGLG11'  },
  { value: 'etf_br',     label: 'ETF BR',        emoji: '📊', hint: 'Ex: BOVA11, IVVB11'  },
  { value: 'acao_us',    label: 'Ação US',       emoji: '🇺🇸', hint: 'Ex: AAPL, GOOGL'    },
  { value: 'etf_us',     label: 'ETF US',        emoji: '📈', hint: 'Ex: SPY, QQQ'        },
  { value: 'bdr',        label: 'BDR',           emoji: '🌐', hint: 'Ex: AAPL34, AMZO34'  },
  { value: 'crypto',     label: 'Criptomoeda',   emoji: '₿',  hint: 'Ex: BTC, ETH'        },
  { value: 'renda_fixa', label: 'Renda Fixa',    emoji: '💰', hint: 'CDB, LCI, Tesouro'   },
  { value: 'outro',      label: 'Outro',         emoji: '📌', hint: 'Qualquer ativo'       },
];

// Module state
const _inv = {
  positions:    [],   // investment_positions rows
  transactions: [],   // investment_transactions rows
  loaded:       false,
};

// ── Helpers ────────────────────────────────────────────────────────────────

function _invAccounts() {
  return (state.accounts || []).filter(a => a.type === 'investimento');
}

function _invBrlPrice(pos) {
  // Convert current_price to BRL using app FX rates
  if (!pos.current_price) return 0;
  if (!pos.currency || pos.currency === 'BRL') return +pos.current_price;
  return toBRL(+pos.current_price, pos.currency);
}

function _invMarketValue(pos) {
  return (+(pos.quantity) || 0) * _invBrlPrice(pos);
}

function _invCost(pos) {
  return (+(pos.quantity) || 0) * (+(pos.avg_cost) || 0);
}

function _invReturn(pos) {
  const mv   = _invMarketValue(pos);
  const cost = _invCost(pos);
  if (!cost) return 0;
  return (mv - cost) / cost * 100;
}

function _invAssetType(value) {
  return ASSET_TYPES.find(t => t.value === value) || ASSET_TYPES.at(-1);
}

// Total market value of all positions for a given account_id
function invAccountMarketValue(accountId) {
  return _inv.positions
    .filter(p => p.account_id === accountId && (+(p.quantity) || 0) > 0)
    .reduce((s, p) => s + _invMarketValue(p), 0);
}

// Total market value across ALL investment accounts for this family
function invTotalPortfolioValue() {
  return _inv.positions
    .filter(p => (+(p.quantity) || 0) > 0)
    .reduce((s, p) => s + _invMarketValue(p), 0);
}

// ── Data load ───────────────────────────────────────────────────────────────

async function loadInvestments(force = false) {
  if (!sb || !famId()) return;
  if (!force && _inv.loaded) return;

  try {
    const [posRes, txRes] = await Promise.all([
      famQ(sb.from('investment_positions')
        .select('*')
      ).order('ticker'),
      famQ(sb.from('investment_transactions')
        .select('*, investment_positions(ticker,name,asset_type)')
      ).order('date', { ascending: false }),
    ]);

    _inv.positions    = posRes.data    || [];
    _inv.transactions = txRes.data     || [];
    _inv.loaded       = true;

    // Augment account balances with market value
    _invAugmentAccountBalances();
  } catch (e) {
    console.warn('[investments] load error:', e.message);
  }
}

function _invAugmentAccountBalances() {
  // Called after loadInvestments() and after DB.accounts.load()
  // Adds market value of positions to each investment account's balance
  _invAccounts().forEach(acc => {
    const mv = invAccountMarketValue(acc.id);
    acc._investmentMarketValue = mv; // store separately for display
    // Don't double-add: subtract transaction amounts already counted
    // The transactions that bought assets already debited the cash from the account,
    // so we add back the current market value of those positions
    const invested = _inv.positions
      .filter(p => p.account_id === acc.id && (+(p.quantity) || 0) > 0)
      .reduce((s, p) => s + _invCost(p), 0);
    // balance = cash_balance + (market_value - cost_basis)  →  unrealised gain
    // cash_balance is initial_balance + sum(transactions) which already deducted the cost
    acc._unrealisedPnL = mv - invested;
    // The "true" balance the user sees = what's in cash + what positions are worth
    acc._totalPortfolioBalance = acc.balance + mv;
  });
}

// ── Page render ─────────────────────────────────────────────────────────────

async function loadInvestmentsPage() {
  if (!sb) return;
  await loadInvestments();
  _renderInvestmentsPage();
}

function _renderInvestmentsPage() {
  const container = document.getElementById('investmentsContent');
  if (!container) return;

  const invAccs = _invAccounts();
  if (!invAccs.length) {
    container.innerHTML = `
      <div class="empty-state" style="text-align:center;padding:48px 20px">
        <div style="font-size:3rem;margin-bottom:12px">📊</div>
        <div style="font-size:1.1rem;font-weight:700;color:var(--text)">Nenhuma conta de investimentos</div>
        <p style="font-size:.85rem;color:var(--muted);margin:8px 0 20px">
          Para usar o módulo de investimentos, crie uma conta do tipo <strong>Investimentos</strong>.
        </p>
        <button class="btn btn-primary" onclick="openAccountModal();closeModal&&closeModal('accountModal')">
          + Criar conta de investimentos
        </button>
      </div>`;
    return;
  }

  const totalMV     = invTotalPortfolioValue();
  const totalCost   = _inv.positions.reduce((s,p)=>(+(p.quantity)>0 ? s+_invCost(p) : s), 0);
  const totalReturn = totalCost ? (totalMV - totalCost) / totalCost * 100 : 0;
  const totalPnL    = totalMV - totalCost;

  container.innerHTML = `
    <!-- Summary header -->
    <div class="inv-summary-cards">
      <div class="inv-kpi-card">
        <div class="inv-kpi-label">Valor de Mercado</div>
        <div class="inv-kpi-value">${fmt(totalMV)}</div>
      </div>
      <div class="inv-kpi-card">
        <div class="inv-kpi-label">Custo Total</div>
        <div class="inv-kpi-value">${fmt(totalCost)}</div>
      </div>
      <div class="inv-kpi-card">
        <div class="inv-kpi-label">Resultado</div>
        <div class="inv-kpi-value ${totalPnL >= 0 ? 'amount-pos' : 'amount-neg'}">
          ${totalPnL >= 0 ? '+' : ''}${fmt(totalPnL)}
          <span style="font-size:.75rem;font-weight:500">(${totalReturn.toFixed(2)}%)</span>
        </div>
      </div>
    </div>

    <!-- Actions bar -->
    <div class="inv-actions-bar">
      <button class="btn btn-primary" onclick="openInvTransactionModal()">+ Registrar Movimentação</button>
      <button class="btn btn-ghost" id="invUpdatePricesBtn" onclick="updateAllPrices()">🔄 Atualizar Cotações</button>
      <span id="invPriceUpdateStatus" style="font-size:.75rem;color:var(--muted)"></span>
    </div>

    <!-- Per-account portfolios -->
    ${invAccs.map(acc => _renderPortfolioCard(acc)).join('')}
  `;
}

function _renderPortfolioCard(acc) {
  const positions = _inv.positions.filter(p => p.account_id === acc.id && (+(p.quantity) || 0) > 0);
  const mv        = invAccountMarketValue(acc.id);
  const cost      = positions.reduce((s,p) => s + _invCost(p), 0);
  const pnl       = mv - cost;
  const ret       = cost ? pnl / cost * 100 : 0;
  // Cash available = account balance (transactions already deducted purchases)
  const cash      = +(acc.balance) || 0;

  // Group by asset type
  const byType = {};
  positions.forEach(p => {
    const k = p.asset_type || 'outro';
    if (!byType[k]) byType[k] = [];
    byType[k].push(p);
  });

  const typeRows = Object.entries(byType).map(([type, ps]) => {
    const t = _invAssetType(type);
    const typeRows = ps.map(p => _renderPositionRow(p, mv)).join('');
    return `
      <div class="inv-type-group">
        <div class="inv-type-label">${t.emoji} ${t.label}</div>
        ${typeRows}
      </div>`;
  }).join('');

  return `
    <div class="card inv-portfolio-card">
      <div class="card-header">
        <span class="card-title">${esc(acc.name)}</span>
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
          <span style="font-size:.78rem;color:var(--muted)">
            Caixa: <strong>${fmt(cash, acc.currency)}</strong>
          </span>
          <span style="font-size:.78rem;color:var(--muted)">
            Mercado: <strong>${fmt(mv)}</strong>
          </span>
          <span style="font-size:.82rem;font-weight:700;color:${pnl>=0?'var(--green,#16a34a)':'var(--red)'}">
            ${pnl>=0?'+':''}${fmt(pnl)} (${ret.toFixed(2)}%)
          </span>
        </div>
      </div>
      ${positions.length === 0
        ? `<div style="text-align:center;padding:24px;color:var(--muted);font-size:.83rem">
             Sem posições abertas.
             <a href="#" onclick="event.preventDefault();openInvTransactionModal('${acc.id}')">Registrar compra</a>
           </div>`
        : `<div class="inv-positions-table">
             <div class="inv-pos-header">
               <span>Ativo</span><span>Qtd</span><span>Custo Médio</span>
               <span>Preço Atual</span><span>Valor</span><span>Retorno</span><span></span>
             </div>
             ${typeRows}
           </div>`
      }
    </div>`;
}

function _renderPositionRow(p, totalMV) {
  const mv   = _invMarketValue(p);
  const cost = +p.avg_cost || 0;
  const cur  = _invBrlPrice(p);
  const ret  = cost ? (cur - cost) / cost * 100 : 0;
  const pct  = totalMV ? mv / totalMV * 100 : 0;
  const t    = _invAssetType(p.asset_type);
  const stale= p.price_updated_at
    ? (Date.now() - new Date(p.price_updated_at).getTime()) > 24*60*60*1000
    : true;

  return `
    <div class="inv-pos-row" id="invPos-${p.id}">
      <div class="inv-pos-name">
        <span class="inv-pos-ticker">${esc(p.ticker)}</span>
        <span class="inv-pos-desc">${esc(p.name || '')} <span class="badge" style="font-size:.65rem">${t.emoji} ${t.label}</span></span>
      </div>
      <span>${(+(p.quantity)).toFixed(4).replace(/\.?0+$/, '') || '0'}</span>
      <span>${fmt(cost)}</span>
      <span class="${stale ? 'inv-price-stale' : ''}">
        ${cur ? fmt(cur, p.currency) : '—'}
        ${stale ? ' <span title="Cotação desatualizada">⚠️</span>' : ''}
      </span>
      <span>
        <div style="font-weight:600">${fmt(mv)}</div>
        <div style="font-size:.7rem;color:var(--muted)">${pct.toFixed(1)}%</div>
      </span>
      <span class="${ret >= 0 ? 'amount-pos' : 'amount-neg'}">
        ${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%
      </span>
      <span>
        <button class="btn-icon" onclick="openInvPositionDetail('${p.id}')" title="Histórico">📋</button>
        <button class="btn-icon" onclick="openInvTransactionModal(null,'${p.id}')" title="Nova movimentação">+</button>
      </span>
    </div>`;
}

// ── Price update ────────────────────────────────────────────────────────────

async function updateAllPrices() {
  const btn    = document.getElementById('invUpdatePricesBtn');
  const status = document.getElementById('invPriceUpdateStatus');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Atualizando…'; }

  const positions = _inv.positions.filter(p => +(p.quantity) > 0);
  if (!positions.length) {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Atualizar Cotações'; }
    return;
  }

  // Group by API to use
  const brapi   = positions.filter(p => ['acao_br','fii','etf_br','bdr'].includes(p.asset_type));
  const usStocks= positions.filter(p => ['acao_us','etf_us'].includes(p.asset_type));
  const crypto  = positions.filter(p => p.asset_type === 'crypto');
  const manual  = positions.filter(p => p.asset_type === 'renda_fixa' || p.asset_type === 'outro');

  let updated = 0, failed = 0;
  const today = new Date().toISOString().slice(0, 10);

  // 1 — B3 / FIIs / BDRs via brapi.dev
  if (brapi.length) {
    try {
      if (status) status.textContent = `Buscando B3 (${brapi.length} ativos)…`;
      const tickers = brapi.map(p => p.ticker).join(',');
      const res  = await fetch(`https://brapi.dev/api/quote/${encodeURIComponent(tickers)}?token=anonymous`);
      const json = await res.json();
      for (const q of (json.results || [])) {
        const pos = brapi.find(p => p.ticker.toUpperCase() === q.symbol?.toUpperCase());
        if (!pos || !q.regularMarketPrice) continue;
        await _invSavePrice(pos, q.regularMarketPrice, 'BRL', today, 'api');
        updated++;
      }
    } catch(e) { console.warn('[inv] brapi error:', e.message); failed += brapi.length; }
  }

  // 2 — US stocks / ETFs via Yahoo Finance (no auth, CORS-free endpoint)
  for (const pos of usStocks) {
    try {
      if (status) status.textContent = `Buscando ${pos.ticker}…`;
      const r = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(pos.ticker)}?interval=1d&range=1d`,
        { signal: AbortSignal.timeout(8000) }
      );
      const j = await r.json();
      const price = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (price) {
        await _invSavePrice(pos, price, 'USD', today, 'api');
        updated++;
      } else { failed++; }
    } catch(e) { console.warn(`[inv] yahoo ${pos.ticker}:`, e.message); failed++; }
  }

  // 3 — Crypto via CoinGecko free API
  if (crypto.length) {
    try {
      if (status) status.textContent = `Buscando cripto (${crypto.length} ativos)…`;
      // Build CoinGecko IDs from ticker
      const COIN_IDS = { BTC:'bitcoin',ETH:'ethereum',BNB:'binancecoin',SOL:'solana',
        ADA:'cardano',XRP:'ripple',MATIC:'matic-network',DOT:'polkadot',
        AVAX:'avalanche-2',LINK:'chainlink',LTC:'litecoin',DOGE:'dogecoin' };
      for (const pos of crypto) {
        const coinId = COIN_IDS[pos.ticker.toUpperCase()];
        if (!coinId) { failed++; continue; }
        const r = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=brl`,
          { signal: AbortSignal.timeout(8000) }
        );
        const j = await r.json();
        const price = j?.[coinId]?.brl;
        if (price) {
          await _invSavePrice(pos, price, 'BRL', today, 'api');
          updated++;
        } else { failed++; }
      }
    } catch(e) { console.warn('[inv] coingecko error:', e.message); failed += crypto.length; }
  }

  // 4 — Manual / renda fixa: show count
  if (manual.length) {
    if (status) status.textContent = `${manual.length} ativo(s) precisam de atualização manual.`;
  }

  // Persist to DB + reload
  await loadInvestments(true);
  _invAugmentAccountBalances();
  _renderInvestmentsPage();

  const msg = `✅ ${updated} cotação${updated!==1?'ões':''} atualizada${updated!==1?'s':''}`
    + (failed ? ` · ⚠️ ${failed} falha${failed!==1?'s':''}` : '');
  if (status) status.textContent = msg;
  toast(msg, failed ? 'warning' : 'success');

  if (btn) { btn.disabled = false; btn.textContent = '🔄 Atualizar Cotações'; }
}

async function _invSavePrice(pos, price, currency, date, source) {
  // Update position current_price
  await sb.from('investment_positions').update({
    current_price:    price,
    currency:         currency,
    price_updated_at: new Date().toISOString(),
    updated_at:       new Date().toISOString(),
  }).eq('id', pos.id);

  // Upsert price history
  await sb.from('investment_price_history').upsert({
    position_id: pos.id,
    family_id:   pos.family_id,
    date,
    price,
    currency,
    source,
  }, { onConflict: 'position_id,date' });

  // Update local state
  const local = _inv.positions.find(p => p.id === pos.id);
  if (local) { local.current_price = price; local.currency = currency; }
}

// ── Transaction modal (buy / sell) ──────────────────────────────────────────

function openInvTransactionModal(accountId = null, positionId = null) {
  document.getElementById('invTxModal')?.remove();

  const invAccs = _invAccounts();
  if (!invAccs.length) {
    toast('Crie uma conta do tipo Investimentos primeiro', 'error'); return;
  }

  const pos     = positionId ? _inv.positions.find(p => p.id === positionId) : null;
  const accOpts = invAccs.map(a =>
    `<option value="${a.id}" ${(accountId && a.id === accountId) || (!accountId && !pos) ? '' : ''}>
      ${esc(a.name)}</option>`
  ).join('');
  const typeOpts = ASSET_TYPES.map(t =>
    `<option value="${t.value}">${t.emoji} ${t.label} — ${t.hint}</option>`
  ).join('');

  const modal = document.createElement('div');
  modal.className = 'modal-overlay open';
  modal.id = 'invTxModal';
  modal.style.zIndex = '10010';
  modal.innerHTML = `
  <div class="modal" style="max-width:500px"><div class="modal-handle"></div>
    <div class="modal-header">
      <span class="modal-title" id="invTxModalTitle">Registrar Movimentação</span>
      <button class="modal-close" onclick="closeModal('invTxModal')">✕</button>
    </div>
    <div class="modal-body">
      <input type="hidden" id="invTxPositionId" value="${positionId || ''}">

      <!-- Buy / Sell tabs -->
      <div class="tab-bar mb-4">
        <button class="tab active" id="invTxBuyTab"  onclick="_invSetTxType('buy')">📥 Compra</button>
        <button class="tab"        id="invTxSellTab" onclick="_invSetTxType('sell')">📤 Venda</button>
      </div>
      <input type="hidden" id="invTxType" value="buy">

      <div class="form-grid">
        <div class="form-group">
          <label>Conta de Investimentos *</label>
          <select id="invTxAccount" onchange="_invOnAccountChange()">${accOpts}</select>
        </div>
        <div class="form-group">
          <label>Data *</label>
          <input type="date" id="invTxDate" value="${new Date().toISOString().slice(0,10)}">
        </div>
        <div class="form-group">
          <label>Código do Ativo *</label>
          <input type="text" id="invTxTicker" placeholder="Ex: PETR4, BTC, AAPL"
            value="${pos ? pos.ticker : ''}"
            oninput="this.value=this.value.toUpperCase()" style="text-transform:uppercase">
        </div>
        <div class="form-group" id="invTxTypeGroup" ${pos ? 'style="display:none"' : ''}>
          <label>Tipo de Ativo *</label>
          <select id="invTxAssetType">${typeOpts}</select>
        </div>
        <div class="form-group">
          <label>Nome / Descrição</label>
          <input type="text" id="invTxName" placeholder="Nome do ativo (opcional)"
            value="${pos ? esc(pos.name || '') : ''}">
        </div>
        <div class="form-group">
          <label>Quantidade *</label>
          <input type="text" id="invTxQty" inputmode="decimal" placeholder="0"
            oninput="_invCalcTotal()">
        </div>
        <div class="form-group">
          <label>Preço Unitário (BRL) *</label>
          <div class="amt-wrap">
            <input type="text" id="invTxPrice" inputmode="decimal" placeholder="0,00"
              oninput="_invCalcTotal()">
          </div>
        </div>
        <div class="form-group full">
          <div style="display:flex;justify-content:space-between;align-items:center;
            padding:10px 14px;background:var(--surface2);border-radius:var(--r-sm);border:1px solid var(--border)">
            <span style="font-size:.82rem;font-weight:600">Total da operação:</span>
            <span id="invTxTotal" style="font-size:1rem;font-weight:700;color:var(--accent)">R$ 0,00</span>
          </div>
          <div id="invTxCashWarning" style="display:none;font-size:.78rem;color:var(--amber,#b45309);margin-top:6px;
            padding:6px 10px;background:rgba(245,158,11,.1);border-radius:6px">
            ⚠️ Saldo em caixa insuficiente para esta compra.
          </div>
        </div>
        <div class="form-group full">
          <label>Observação</label>
          <input type="text" id="invTxNotes" placeholder="Corretora, estratégia…">
        </div>
      </div>
      <div id="invTxError" style="display:none;color:var(--red);font-size:.8rem;margin-top:8px;
        padding:8px 12px;background:#fff5f5;border:1px solid #fca5a5;border-radius:var(--r-sm)"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal('invTxModal')">Cancelar</button>
      <button class="btn btn-primary" id="invTxSaveBtn" onclick="saveInvTransaction()">
        💾 Registrar Compra
      </button>
    </div>
  </div>`;

  document.body.appendChild(modal);
  _renderInvGainLossChart(pos, history || []);
  if (accountId) document.getElementById('invTxAccount').value = accountId;
  if (pos) {
    document.getElementById('invTxAssetType').value = pos.asset_type || 'outro';
  }
}

function _invSetTxType(type) {
  document.getElementById('invTxType').value = type;
  document.getElementById('invTxBuyTab').classList.toggle('active', type === 'buy');
  document.getElementById('invTxSellTab').classList.toggle('active', type === 'sell');
  const btn = document.getElementById('invTxSaveBtn');
  if (btn) btn.textContent = type === 'buy' ? '💾 Registrar Compra' : '💾 Registrar Venda';
  _invCalcTotal();
}

function _invOnAccountChange() {
  _invCalcTotal();
}

function _invCalcTotal() {
  const qty   = parseFloat(document.getElementById('invTxQty')?.value?.replace(',','.')) || 0;
  const price = parseFloat(document.getElementById('invTxPrice')?.value?.replace(',','.')) || 0;
  const total = qty * price;
  const el    = document.getElementById('invTxTotal');
  if (el) el.textContent = fmt(total);

  // Cash warning for buys
  const type  = document.getElementById('invTxType')?.value;
  const accId = document.getElementById('invTxAccount')?.value;
  const warn  = document.getElementById('invTxCashWarning');
  if (warn && type === 'buy' && accId) {
    const acc   = _invAccounts().find(a => a.id === accId);
    const cash  = acc ? (+(acc.balance) || 0) : 0;
    warn.style.display = (total > 0 && cash < total) ? '' : 'none';
  }
}

async function saveInvTransaction() {
  const btn     = document.getElementById('invTxSaveBtn');
  const errEl   = document.getElementById('invTxError');
  const type    = document.getElementById('invTxType').value;
  const accId   = document.getElementById('invTxAccount').value;
  const date    = document.getElementById('invTxDate').value;
  const ticker  = document.getElementById('invTxTicker').value.trim().toUpperCase();
  const assetT  = document.getElementById('invTxAssetType').value;
  const name    = document.getElementById('invTxName').value.trim();
  const qtyRaw  = parseFloat(document.getElementById('invTxQty').value.replace(',','.'));
  const priceRaw= parseFloat(document.getElementById('invTxPrice').value.replace(',','.'));
  const notes   = document.getElementById('invTxNotes').value.trim();
  const posId   = document.getElementById('invTxPositionId').value;

  if (errEl) errEl.style.display = 'none';

  if (!accId)          { _invShowErr('Selecione a conta'); return; }
  if (!date)           { _invShowErr('Informe a data'); return; }
  if (!ticker)         { _invShowErr('Informe o código do ativo'); return; }
  if (!qtyRaw || qtyRaw <= 0)   { _invShowErr('Informe a quantidade'); return; }
  if (!priceRaw|| priceRaw <= 0){ _invShowErr('Informe o preço unitário'); return; }

  const total = qtyRaw * priceRaw;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Salvando…'; }

  try {
    // 1. Upsert position
    let position = posId
      ? _inv.positions.find(p => p.id === posId)
      : _inv.positions.find(p => p.account_id === accId && p.ticker === ticker);

    if (!position) {
      // New position
      const { data: newPos, error: posErr } = await sb.from('investment_positions').insert({
        family_id:   famId(),
        account_id:  accId,
        ticker,
        asset_type:  assetT,
        name:        name || ticker,
        quantity:    0,
        avg_cost:    0,
        currency:    ['acao_us','etf_us'].includes(assetT) ? 'USD' : 'BRL',
      }).select().single();
      if (posErr) throw posErr;
      position = newPos;
      _inv.positions.push(position);
    }

    // 2. Update avg_cost and quantity
    const oldQty   = +(position.quantity) || 0;
    const oldCost  = +(position.avg_cost)  || 0;
    let   newQty, newAvgCost;

    if (type === 'buy') {
      newQty     = oldQty + qtyRaw;
      // Weighted average cost
      newAvgCost = newQty > 0
        ? (oldQty * oldCost + qtyRaw * priceRaw) / newQty
        : priceRaw;
    } else {
      // Sell — reduce qty, avg_cost unchanged (FIFO/average cost same result)
      if (qtyRaw > oldQty + 0.00001) { _invShowErr(`Quantidade insuficiente (disponível: ${oldQty})`); return; }
      newQty     = Math.max(0, oldQty - qtyRaw);
      newAvgCost = oldCost; // avg_cost stays the same on sells
    }

    const { error: updErr } = await sb.from('investment_positions').update({
      quantity:   newQty,
      avg_cost:   newAvgCost,
      name:       name || position.name || ticker,
      asset_type: assetT || position.asset_type,
      updated_at: new Date().toISOString(),
    }).eq('id', position.id);
    if (updErr) throw updErr;

    // 3. Create financial transaction (debit for buy, credit for sell)
    const txAmount = type === 'buy' ? -total : total;
    const txDesc   = `${type === 'buy' ? 'Compra' : 'Venda'}: ${ticker} ${qtyRaw}x @ ${fmt(priceRaw)}`;
    const { data: txData, error: txErr } = await sb.from('transactions').insert({
      family_id:   famId(),
      account_id:  accId,
      date,
      description: txDesc,
      amount:      txAmount,
      category_id: null,
      memo:        notes || null,
      status:      'confirmed',
      is_transfer: false,
    }).select().single();
    if (txErr) throw txErr;

    // 4. Record investment transaction
    await sb.from('investment_transactions').insert({
      family_id:   famId(),
      position_id: position.id,
      account_id:  accId,
      tx_id:       txData.id,
      type,
      quantity:    qtyRaw,
      unit_price:  priceRaw,
      total_brl:   total,
      date,
      notes:       notes || null,
    });

    // 5. Record price in history
    const today = new Date().toISOString().slice(0, 10);
    await sb.from('investment_price_history').upsert({
      position_id: position.id,
      family_id:   famId(),
      date:        date || today,
      price:       priceRaw,
      currency:    position.currency || 'BRL',
      source:      'manual',
    }, { onConflict: 'position_id,date' });

    toast(`✅ ${type === 'buy' ? 'Compra' : 'Venda'} de ${ticker} registrada!`, 'success');
    closeModal('invTxModal');

    // Reload
    await loadInvestments(true);
    DB.accounts.bust();
    await DB.accounts.load(true);
    _invAugmentAccountBalances();
    _renderInvestmentsPage();
    if (state.currentPage === 'accounts') renderAccounts?.();
    if (state.currentPage === 'dashboard') loadDashboard?.();

  } catch(e) {
    _invShowErr(e.message || 'Erro ao salvar');
    if (btn) { btn.disabled = false; btn.textContent = type === 'buy' ? '💾 Registrar Compra' : '💾 Registrar Venda'; }
  }
}

function _invShowErr(msg) {
  const errEl = document.getElementById('invTxError');
  if (errEl) { errEl.textContent = msg; errEl.style.display = ''; }
}

// ── Position detail (history) ───────────────────────────────────────────────

async function openInvPositionDetail(positionId) {
  const pos = _inv.positions.find(p => p.id === positionId);
  if (!pos) return;

  const txs = _inv.transactions.filter(t => t.position_id === positionId);
  const { data: history } = await sb.from('investment_price_history')
    .select('*').eq('position_id', positionId)
    .order('date', { ascending: false }).limit(90);

  document.getElementById('invDetailModal')?.remove();

  const t = _invAssetType(pos.asset_type);
  const mv   = _invMarketValue(pos);
  const cost = _invCost(pos);
  const pnl  = mv - cost;
  const ret  = cost ? pnl / cost * 100 : 0;

  const txRows = txs.map(tx => `
    <tr>
      <td>${fmtDate(tx.date)}</td>
      <td><span class="badge" style="background:${tx.type==='buy'?'#dcfce7':'#fee2e2'};color:${tx.type==='buy'?'#15803d':'#b91c1c'}">${tx.type==='buy'?'Compra':'Venda'}</span></td>
      <td>${(+(tx.quantity)).toFixed(4)}</td>
      <td>${fmt(tx.unit_price)}</td>
      <td class="${tx.type==='buy'?'amount-neg':'amount-pos'}">${tx.type==='buy'?'-':'+'}${fmt(tx.total_brl)}</td>
    </tr>`).join('');

  const modal = document.createElement('div');
  modal.className = 'modal-overlay open';
  modal.id = 'invDetailModal';
  modal.style.zIndex = '10010';
  modal.innerHTML = `
  <div class="modal" style="max-width:560px"><div class="modal-handle"></div>
    <div class="modal-header">
      <span class="modal-title">${t.emoji} ${esc(pos.ticker)} — ${esc(pos.name || pos.ticker)}</span>
      <button class="modal-close" onclick="closeModal('invDetailModal')">✕</button>
    </div>
    <div class="modal-body">
      <!-- KPIs -->
      <div class="inv-summary-cards" style="margin-bottom:16px">
        <div class="inv-kpi-card"><div class="inv-kpi-label">Posição</div>
          <div class="inv-kpi-value">${(+(pos.quantity)).toFixed(4)} ${esc(pos.ticker)}</div></div>
        <div class="inv-kpi-card"><div class="inv-kpi-label">Custo Médio</div>
          <div class="inv-kpi-value">${fmt(+(pos.avg_cost))}</div></div>
        <div class="inv-kpi-card"><div class="inv-kpi-label">Cotação Atual</div>
          <div class="inv-kpi-value">${_invBrlPrice(pos) ? fmt(_invBrlPrice(pos)) : '—'}</div></div>
        <div class="inv-kpi-card"><div class="inv-kpi-label">Resultado</div>
          <div class="inv-kpi-value ${pnl>=0?'amount-pos':'amount-neg'}">
            ${pnl>=0?'+':''}${fmt(pnl)} (${ret.toFixed(2)}%)</div></div>
      </div>

      <!-- Manual price update for renda_fixa / outro -->
      ${['renda_fixa','outro'].includes(pos.asset_type) ? `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:16px;
        padding:10px 14px;background:var(--surface2);border-radius:var(--r-sm)">
        <span style="font-size:.82rem;font-weight:600;flex:1">Atualizar cotação manualmente:</span>
        <input type="text" id="invManualPrice" value="${pos.current_price || ''}"
          style="width:120px;padding:6px 10px" inputmode="decimal" placeholder="0,00">
        <button class="btn btn-primary btn-sm" onclick="updateManualPrice('${pos.id}')">Salvar</button>
      </div>` : ''}

      <!-- Gain/Loss Chart -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div style="font-size:.82rem;font-weight:700">Evolução do Investimento</div>
        <span id="invChartNoData" style="display:none;font-size:.73rem;color:var(--muted)">Sem histórico de preços</span>
      </div>
      <div style="position:relative;height:150px;margin-bottom:16px;background:var(--surface2);border-radius:var(--r-sm);overflow:hidden">
        <canvas id="invGainLossChart" style="width:100%;height:100%"></canvas>
      </div>
      <!-- Transaction history -->
      <div style="font-size:.82rem;font-weight:700;margin-bottom:8px">Histórico de Movimentações</div>
      ${txRows ? `<table style="width:100%;border-collapse:collapse;font-size:.82rem">
        <thead><tr style="background:var(--surface2)">
          <th style="padding:6px 8px;text-align:left">Data</th>
          <th>Tipo</th><th>Qtd</th><th>Preço</th><th>Total</th>
        </tr></thead>
        <tbody>${txRows}</tbody>
      </table>` : '<div style="color:var(--muted);font-size:.82rem">Nenhuma movimentação registrada.</div>'}
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal('invDetailModal')">Fechar</button>
      <button class="btn btn-primary" onclick="closeModal('invDetailModal');openInvTransactionModal(null,'${pos.id}')">
        + Nova Movimentação
      </button>
    </div>
  </div>`;
  document.body.appendChild(modal);
}

async function updateManualPrice(positionId) {
  const val = parseFloat(document.getElementById('invManualPrice')?.value?.replace(',','.'));
  if (!val || val <= 0) { toast('Preço inválido', 'error'); return; }
  const pos = _inv.positions.find(p => p.id === positionId);
  if (!pos) return;
  const today = new Date().toISOString().slice(0, 10);
  await _invSavePrice(pos, val, 'BRL', today, 'manual');
  await loadInvestments(true);
  _invAugmentAccountBalances();
  closeModal('invDetailModal');
  _renderInvestmentsPage();
  toast('Cotação atualizada', 'success');
}

// ── Module activation ───────────────────────────────────────────────────────

async function applyInvestmentsFeature() {
  const famId_ = famId();
  if (!famId_) return;
  const enabled = await getAppSetting('investments_enabled_' + famId_, false);
  const navEl   = document.getElementById('investmentsNav');
  const pageEl  = document.getElementById('page-investments');

  if (navEl)  navEl.style.display  = enabled ? '' : 'none';
  if (pageEl) pageEl.style.display = enabled ? '' : 'none'; // page hidden by CSS .page rule

  if (enabled) {
    await loadInvestments();
    _invAugmentAccountBalances();
  }
}

// Called from accounts.js after recalculating balances
function invPostBalanceHook() {
  if (_inv.loaded) _invAugmentAccountBalances();
}

function _renderInvGainLossChart(pos, history) {
  const cv=document.getElementById('invGainLossChart');
  const nd=document.getElementById('invChartNoData');
  if(!cv) return;
  const hist=[...history].sort((a,b)=>a.date.localeCompare(b.date));
  if(!hist.length){if(nd)nd.style.display='';cv.style.display='none';return;}
  if(nd)nd.style.display='none'; cv.style.display='';
  if(cv._ci){try{cv._ci.destroy();}catch(_){}}
  const cost=_invCost(pos), qty=+(pos.quantity)||0, cur=pos.currency||'BRL';
  const fC=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:cur,notation:'compact'}).format(v);
  const fF=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:cur}).format(v);
  const labels=hist.map(h=>{const d=new Date(h.date+'T12:00:00');return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'short'});});
  const mvData=hist.map(h=>+(h.price)*qty);
  const pnlData=mvData.map(mv=>mv-cost);
  const lp=pnlData[pnlData.length-1]??0;
  const G='rgba(22,163,74,.85)',R='rgba(192,57,43,.85)',GL='rgba(22,163,74,.15)',RL='rgba(192,57,43,.12)';
  cv._ci=new Chart(cv.getContext('2d'),{
    type:'line',
    data:{labels,datasets:[
      {label:'Valor Mercado',data:mvData,borderColor:G,backgroundColor:'transparent',borderWidth:2,pointRadius:hist.length>40?0:2,fill:false,tension:.35,order:1},
      {label:'Custo',data:hist.map(()=>cost),borderColor:'rgba(100,116,139,.6)',backgroundColor:'transparent',borderWidth:1.5,borderDash:[5,3],pointRadius:0,fill:false,order:2},
      {label:'Ganho/Perda',data:pnlData,borderColor:lp>=0?G:R,backgroundColor:lp>=0?GL:RL,borderWidth:1.5,pointRadius:0,fill:'origin',tension:.35,order:3},
    ]},
    options:{
      responsive:true,maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{display:true,position:'top',labels:{font:{size:10},boxWidth:10,padding:8}},
        tooltip:{callbacks:{label:c=>{const v=c.parsed.y;return ` ${c.dataset.label}: ${v>=0?'+':''}${fF(v)}`;}}}
      },
      scales:{
        x:{ticks:{font:{size:9},maxTicksLimit:8},grid:{display:false}},
        y:{ticks:{font:{size:9},callback:fC},grid:{color:'rgba(0,0,0,.05)'}}
      }
    }
  });
}
