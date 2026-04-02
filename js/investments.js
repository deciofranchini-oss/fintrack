/* ═══════════════════════════════════════════════════════════════════════
   INVESTMENTS MODULE — v2
   Tables: investment_positions, investment_transactions, investment_price_history
   Price API: brapi.dev (B3/FIIs/BDRs/Crypto) + Yahoo Finance fallback (US stocks)
             + B3/Tesouro Direto API + BCB (CDI/Selic)
   Activation: investments_enabled_{family_id} in app_settings
   Balance: account.balance += SUM(position.quantity × current_price_brl)
   Extended: Tesouro Direto (PU via B3 API) + Fundos CDI (auto-yield via BCB)
             Metadata stored in notes column as JSON — zero migration needed.
═══════════════════════════════════════════════════════════════════════ */

const ASSET_TYPES = [
  { value: 'acao_br',       label: 'Ação BR',            emoji: '🇧🇷', hint: 'Ex: PETR4, VALE3'       },
  { value: 'fii',           label: 'FII',                emoji: '🏢', hint: 'Ex: KNRI11, HGLG11'     },
  { value: 'etf_br',        label: 'ETF BR',             emoji: '📊', hint: 'Ex: BOVA11, IVVB11'     },
  { value: 'acao_us',       label: 'Ação US',            emoji: '🇺🇸', hint: 'Ex: AAPL, GOOGL'       },
  { value: 'etf_us',        label: 'ETF US',             emoji: '📈', hint: 'Ex: SPY, QQQ'           },
  { value: 'bdr',           label: 'BDR',                emoji: '🌐', hint: 'Ex: AAPL34, AMZO34'     },
  { value: 'crypto',        label: 'Criptomoeda',        emoji: '₿',  hint: 'Ex: BTC, ETH'           },
  { value: 'tesouro_direto',label: 'Tesouro Direto',     emoji: '🏛️', hint: 'Selic, IPCA+, Prefixado' },
  { value: 'fundo_investimento', label: 'Fundo de Investimento', emoji: '🏦', hint: 'CDI, Prefixado, IPCA' },
  { value: 'renda_fixa',    label: 'Renda Fixa',         emoji: '💰', hint: 'CDB, LCI, LCA'          },
  { value: 'outro',         label: 'Outro',              emoji: '📌', hint: 'Qualquer ativo'          },
];

// ── Tesouro Direto subtypes ──────────────────────────────────────────────────
const TD_SUBTYPES = [
  { value: 'LFT',     label: 'Tesouro Selic',              index: 'selic',    hint: 'Rende a taxa Selic Over' },
  { value: 'LTN',     label: 'Tesouro Prefixado',          index: 'prefixado', hint: 'Taxa definida na compra, sem juros semestrais' },
  { value: 'NTN-F',   label: 'Tesouro Prefixado c/ Juros', index: 'prefixado', hint: 'Taxa prefixada + juros semestrais' },
  { value: 'NTN-B',   label: 'Tesouro IPCA+',              index: 'ipca',     hint: 'IPCA + taxa prefixada, sem cupom' },
  { value: 'NTN-B_P', label: 'Tesouro IPCA+ c/ Juros',     index: 'ipca',     hint: 'IPCA + taxa prefixada + cupons semestrais' },
  { value: 'NTN-C',   label: 'Tesouro IGP-M+',             index: 'igpm',     hint: 'IGP-M + taxa prefixada' },
];

// ── Fundo indexers ───────────────────────────────────────────────────────────
const FUND_INDEXERS = [
  { value: 'cdi',       label: '% do CDI',        hint: 'Ex: 110% do CDI' },
  { value: 'prefixado', label: 'Prefixado (% a.a.)', hint: 'Ex: 12,5% a.a.' },
  { value: 'ipca',      label: 'IPCA + (% a.a.)', hint: 'Ex: IPCA + 5%' },
  { value: 'selic',     label: '% da Selic',      hint: 'Ex: 100% da Selic' },
];

// ── notes JSON helpers (zero-migration metadata storage) ────────────────────
function _invGetMeta(pos) {
  if (!pos?.notes) return {};
  try { return typeof pos.notes === 'object' ? pos.notes : JSON.parse(pos.notes); }
  catch(_) { return {}; }
}
function _invMetaStr(meta) {
  return JSON.stringify(meta);
}
function _invIsTD(pos)   { return pos?.asset_type === 'tesouro_direto'; }
function _invIsFund(pos) { return pos?.asset_type === 'fundo_investimento'; }
function _invIsAutoYield(pos) { return _invIsTD(pos) || _invIsFund(pos); }

// ── BCB/B3 API helpers ───────────────────────────────────────────────────────

/** Busca CDI anual atual via BCB (série 4389 = CDI Over anualizado) */
async function _fetchCDIAnual() {
  // Tenta série 4389 (CDI anualizado % a.a.)
  try {
    const r = await fetch(
      'https://api.bcb.gov.br/dados/serie/bcdata.sgs.4389/dados/ultimos/1?formato=json',
      { signal: AbortSignal.timeout(6000) }
    );
    if (r.ok) {
      const d = await r.json();
      const val = parseFloat((d[0]?.valor || '').replace(',', '.'));
      if (val > 0) return val;
    }
  } catch(_) {}
  // Fallback: série 12 (CDI diário) → anualizar
  try {
    const r = await fetch(
      'https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados/ultimos/1?formato=json',
      { signal: AbortSignal.timeout(6000) }
    );
    if (r.ok) {
      const d = await r.json();
      const daily = parseFloat((d[0]?.valor || '').replace(',', '.'));
      if (daily > 0) return (Math.pow(1 + daily / 100, 252) - 1) * 100;
    }
  } catch(_) {}
  // Fallback: brapi prime rate
  try {
    const r = await fetch('https://brapi.dev/api/v2/prime-rate?token=anonymous', { signal: AbortSignal.timeout(6000) });
    if (r.ok) {
      const d = await r.json();
      const selic = d?.prime_rate?.[0]?.value || d?.prime_rate?.value;
      if (selic) return parseFloat(selic);
    }
  } catch(_) {}
  return null;
}

/** Busca IPCA acumulado 12 meses via BCB (série 13522) */
async function _fetchIPCA12m() {
  try {
    const r = await fetch(
      'https://api.bcb.gov.br/dados/serie/bcdata.sgs.13522/dados/ultimos/12?formato=json',
      { signal: AbortSignal.timeout(6000) }
    );
    if (r.ok) {
      const d = await r.json();
      // Produto acumulado dos últimos 12 meses
      const acum = (d || []).reduce((acc, x) => {
        const v = parseFloat((x.valor || '0').replace(',', '.'));
        return acc * (1 + v / 100);
      }, 1);
      return (acum - 1) * 100;
    }
  } catch(_) {}
  return null;
}

/** Busca preços do Tesouro Direto via API oficial B3 */
async function _fetchTDPrices() {
  try {
    const r = await fetch(
      'https://www.tesourodireto.com.br/json/br/com/b3/tesourodireto/component/publicado/titulo/component.json',
      { signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    const list = d?.response?.TrsrBdTradgList || d?.Titulo || [];
    // Normaliza campos (a API usa campos aninhados no formato real)
    return list.map(item => {
      const t = item?.TrsrBd || item;
      return {
        name:       t?.nm || t?.TipoTitulo || '',
        maturity:   t?.mtrtyDt || t?.DataVencimento || '',
        buyPrice:   +(t?.minRedVal || t?.PUCompra  || 0),
        sellPrice:  +(t?.untrRedVal|| t?.PUVenda   || 0),
        basePrice:  +(t?.isinCd   || t?.PUBase     || 0),
        buyRate:    +(t?.anulInvstmtRate || t?.TaxaCompra || 0),
        sellRate:   +(t?.anulRedRate     || t?.TaxaVenda  || 0),
      };
    }).filter(t => t.name);
  } catch(e) {
    console.warn('[inv] TD API error:', e.message);
    return [];
  }
}

/** Compara dois nomes de título TD (tolerante a variações de escrita) */
function _tdMatchName(apiName, meta) {
  if (!apiName || !meta) return false;
  const n = apiName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const subtype = (meta.td_subtype || '').toLowerCase();
  const maturity = (meta.td_maturity || '').replace(/-/g, '/').slice(0, 7); // YYYY-MM
  // Match por código + vencimento aproximado
  const codeMap = { lft:'selic', ltn:'prefixado', 'ntn-f':'prefixado com juros', 'ntn-b':'ipca', 'ntn-b_p':'ipca com juros', 'ntn-c':'igpm' };
  const kw = codeMap[subtype] || subtype;
  return n.includes(kw.replace('-','').split(' ')[0]);
}

/** Calcula PU estimado para Tesouro Prefixado (LTN) */
function _calcLTNPrice(taxa, diasUteisPorVencer) {
  // PU = 1000 / (1 + taxa/100)^(du/252)
  return 1000 / Math.pow(1 + taxa / 100, diasUteisPorVencer / 252);
}

/** Dias corridos entre duas datas */
function _daysBetween(d1, d2) {
  return Math.round((new Date(d2) - new Date(d1)) / 86400000);
}

/** Dias úteis aproximados entre duas datas (252/ano) */
function _busyDays(d1, d2) {
  return Math.round(_daysBetween(d1, d2) * 252 / 365);
}

/**
 * Calcula rendimento estimado de um fundo/TD desde a última atualização.
 * Retorna { newPrice, gain, pct } onde newPrice é o novo current_price por unidade.
 */
function _calcFundYield(pos, cdiAnual) {
  const meta    = _invGetMeta(pos);
  const today   = new Date().toISOString().slice(0, 10);
  const lastUpd = meta.fund_last_update || pos.created_at?.slice(0, 10) || today;
  const dias    = Math.max(0, _daysBetween(lastUpd, today));
  if (dias === 0) return null;

  const currentPrice = +(pos.current_price) || +(pos.avg_cost) || 0;
  const qty          = +(pos.quantity) || 1;
  const currentValue = currentPrice * qty;

  let newValue = currentValue;

  if (meta.fund_index === 'cdi' || !meta.fund_index) {
    const pct = +(meta.fund_cdi_pct) || 100;
    const cdi = cdiAnual || +(meta.fund_last_cdi) || 10.5;
    const rateEfetivo = cdi * pct / 100;
    const dailyRate   = Math.pow(1 + rateEfetivo / 100, 1 / 252) - 1;
    newValue = currentValue * Math.pow(1 + dailyRate, dias);
  } else if (meta.fund_index === 'prefixado') {
    const rate      = +(meta.fund_rate) || 0;
    const dailyRate = Math.pow(1 + rate / 100, 1 / 252) - 1;
    newValue = currentValue * Math.pow(1 + dailyRate, dias);
  } else if (meta.fund_index === 'ipca') {
    const spread    = +(meta.fund_rate) || 0;
    const ipca      = +(meta.fund_last_ipca) || 4.5;
    const rate      = ipca + spread;
    const dailyRate = Math.pow(1 + rate / 100, 1 / 365) - 1;
    newValue = currentValue * Math.pow(1 + dailyRate, dias);
  } else if (meta.fund_index === 'selic') {
    const pct       = +(meta.fund_cdi_pct) || 100;
    const selic     = cdiAnual || +(meta.fund_last_cdi) || 10.5;
    const rate      = selic * pct / 100;
    const dailyRate = Math.pow(1 + rate / 100, 1 / 252) - 1;
    newValue = currentValue * Math.pow(1 + dailyRate, dias);
  }

  const gain     = newValue - currentValue;
  const newPrice = qty > 0 ? newValue / qty : newValue;
  const pct      = currentValue > 0 ? gain / currentValue * 100 : 0;
  return { newValue, newPrice, gain, pct, dias };
}

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
  const isPnLPos    = totalPnL >= 0;

  // Asset type distribution for mini bar
  const byType = {};
  _inv.positions.filter(p=>+(p.quantity)>0).forEach(p=>{
    const k = p.asset_type || 'outro';
    byType[k] = (byType[k]||0) + _invMarketValue(p);
  });
  const typeBar = totalMV > 0 ? Object.entries(byType)
    .sort((a,b)=>b[1]-a[1])
    .map(([k,v])=>{
      const t = _invAssetType(k);
      const pct = (v/totalMV*100).toFixed(1);
      const colors = {acao_br:'#2a6049',fii:'#7c3aed',etf_br:'#0891b2',acao_us:'#dc2626',etf_us:'#ea580c',bdr:'#d97706',crypto:'#f59e0b',renda_fixa:'#16a34a',tesouro_direto:'#1d4ed8',fundo_investimento:'#7e22ce',outro:'#94a3b8'};
      const col = colors[k]||'#94a3b8';
      return `<div title="${t.emoji} ${t.label}: ${pct}% (${fmt(v)})" style="flex:${pct};background:${col};min-width:3px"></div>`;
    }).join('') : '';

  container.innerHTML = `
    <!-- Portfolio hero header -->
    <div class="inv-hero">
      <div class="inv-hero-main">
        <div class="inv-hero-label">Valor de Mercado Total</div>
        <div class="inv-hero-value">${fmt(totalMV)}</div>
        <div class="inv-hero-pnl ${isPnLPos ? 'pos' : 'neg'}">
          ${isPnLPos ? '▲' : '▼'} ${isPnLPos ? '+' : ''}${fmt(totalPnL)}
          <span class="inv-hero-pct">(${isPnLPos?'+':''}${totalReturn.toFixed(2)}%)</span>
          <span class="inv-hero-cost">vs custo ${fmt(totalCost)}</span>
        </div>
      </div>
      <div class="inv-hero-kpis">
        <div class="inv-kpi-card">
          <div class="inv-kpi-label">Posições abertas</div>
          <div class="inv-kpi-value">${_inv.positions.filter(p=>+(p.quantity)>0).length}</div>
        </div>
        <div class="inv-kpi-card">
          <div class="inv-kpi-label">Contas</div>
          <div class="inv-kpi-value">${invAccs.length}</div>
        </div>
        <div class="inv-kpi-card">
          <div class="inv-kpi-label">Custo médio</div>
          <div class="inv-kpi-value">${fmt(totalCost)}</div>
        </div>
      </div>
      ${typeBar ? `
      <div class="inv-type-bar-wrap">
        <div class="inv-type-bar">${typeBar}</div>
        <div class="inv-type-bar-legend">
          ${Object.entries(byType).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>{
            const t = _invAssetType(k);
            const pct = (v/totalMV*100).toFixed(1);
            const colors = {acao_br:'#2a6049',fii:'#7c3aed',etf_br:'#0891b2',acao_us:'#dc2626',etf_us:'#ea580c',bdr:'#d97706',crypto:'#f59e0b',renda_fixa:'#16a34a',tesouro_direto:'#1d4ed8',fundo_investimento:'#7e22ce',outro:'#94a3b8'};
            return `<span class="inv-legend-item"><span style="background:${colors[k]||'#94a3b8'}"></span>${t.emoji} ${t.label} ${pct}%</span>`;
          }).join('')}
        </div>
      </div>` : ''}
    </div>

    <!-- Actions bar -->
    <div class="inv-actions-bar">
      <div class="inv-actions-left">
        <button class="btn btn-primary" onclick="openInvTransactionModal()">+ Movimentação</button>
      </div>
      <div class="inv-actions-right">
        <button class="btn btn-ghost" id="invUpdatePricesBtn" onclick="updateAllPrices()">🔄 Cotações</button>
        <span id="invPriceUpdateStatus" class="inv-price-update-status"></span>
      </div>
    </div>

    <!-- Performance charts section -->
    <div class="inv-charts-section">
      <div class="inv-chart-card" id="invPerfChartCard">
        <div class="inv-chart-header">
          <span class="inv-chart-title">📈 Evolução da Carteira</span>
          <span class="inv-chart-sub" id="invPerfChartPeriod"></span>
        </div>
        <div class="inv-chart-wrap" style="height:220px">
          <canvas id="invPortfolioChart"></canvas>
        </div>
      </div>
      <div class="inv-chart-card" id="invAllocChartCard">
        <div class="inv-chart-header">
          <span class="inv-chart-title">🥧 Alocação por Tipo de Ativo</span>
        </div>
        <div class="inv-chart-wrap" style="height:220px">
          <canvas id="invAllocationChart"></canvas>
        </div>
      </div>
    </div>

    <!-- Per-account portfolios -->
    ${invAccs.map(acc => _renderPortfolioCard(acc)).join('')}
  `;

  // Render charts asynchronously after DOM is ready
  requestAnimationFrame(() => {
    renderInvAllocationChart();
    renderInvPerformanceChart().catch(() => {});
  });
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
      <div class="inv-portfolio-header">
        <div class="inv-portfolio-header-left">
          <div class="inv-portfolio-account-name">${esc(acc.name)}</div>
          <div class="inv-portfolio-meta">
            <span class="inv-portfolio-meta-item">💵 Caixa: <strong>${fmt(cash, acc.currency)}</strong></span>
            <span class="inv-portfolio-meta-item">📊 Mercado: <strong>${fmt(mv)}</strong></span>
          </div>
        </div>
        <div class="inv-portfolio-pnl ${pnl>=0?'pos':'neg'}">
          <div class="inv-portfolio-pnl-amt">${pnl>=0?'+':''}${fmt(pnl)}</div>
          <div class="inv-portfolio-pnl-pct">${ret>=0?'+':''}${ret.toFixed(2)}%</div>
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
        <span class="inv-pos-desc">${esc(p.name || '')} <span class="inv-pos-type-badge">${t.emoji} ${t.label}</span></span>
      </div>
      <span class="inv-pos-cell">${(+(p.quantity)).toFixed(4).replace(/\.?0+$/, '') || '0'}</span>
      <span class="inv-pos-cell">${fmt(cost)}</span>
      <span class="inv-pos-cell ${stale ? 'inv-price-stale' : ''}">
        ${cur ? fmt(cur, p.currency) : '—'}${stale ? ' <span title="Cotação desatualizada" style="font-size:.8rem">⚠️</span>' : ''}
      </span>
      <span class="inv-pos-cell">
        <div style="font-weight:700">${fmt(mv)}</div>
        <div class="inv-pos-alloc-wrap"><div class="inv-pos-alloc-bar" style="width:${Math.min(pct,100).toFixed(1)}%"></div><span class="inv-pos-alloc-pct">${pct.toFixed(1)}%</span></div>
      </span>
      <span class="inv-pos-return ${ret >= 0 ? 'pos' : 'neg'}">
        ${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%
      </span>
      <span class="inv-pos-actions">
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
  const brapi    = positions.filter(p => ['acao_br','fii','etf_br','bdr'].includes(p.asset_type));
  const usStocks = positions.filter(p => ['acao_us','etf_us'].includes(p.asset_type));
  const crypto   = positions.filter(p => p.asset_type === 'crypto');
  const manual   = positions.filter(p => p.asset_type === 'renda_fixa' || p.asset_type === 'outro');
  // Tesouro Direto e Fundos: motor de auto-yield dedicado
  const autoYield = positions.filter(p => _invIsAutoYield(p));

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

  // 5 — Tesouro Direto & Fundos: motor de auto-yield
  if (autoYield.length) {
    if (status) status.textContent = `Atualizando ${autoYield.length} TD/Fundo(s)…`;
    try {
      await _invRunAutoYield(autoYield);
      updated += autoYield.length;
    } catch(e) {
      console.warn('[inv] auto-yield batch error:', e.message);
    }
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
            oninput="this.value=this.value.toUpperCase();_invOnTickerInput()" style="text-transform:uppercase">
        </div>
        <div class="form-group" id="invTxTypeGroup" ${pos ? 'style="display:none"' : ''}>
          <label>Tipo de Ativo *</label>
          <select id="invTxAssetType" onchange="_invOnAssetTypeChange()">${typeOpts}</select>
        </div>
        <div class="form-group">
          <label>Nome / Descrição</label>
          <input type="text" id="invTxName" placeholder="Nome do ativo (opcional)"
            value="${pos ? esc(pos.name || '') : ''}">
        </div>

        <!-- ── Tesouro Direto: campos extras ─────────────────────────── -->
        <div id="invTxTDFields" class="form-group full" style="display:none">
          <div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--r-sm);padding:14px;display:flex;flex-direction:column;gap:10px">
            <div style="font-size:.78rem;font-weight:700;color:var(--accent);margin-bottom:2px">🏛️ Dados do Tesouro Direto</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <div>
                <label style="font-size:.75rem">Tipo de Título *</label>
                <select id="invTxTDSubtype" onchange="_invOnTDSubtypeChange()" style="font-size:.82rem;width:100%">
                  ${TD_SUBTYPES.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}
                </select>
              </div>
              <div>
                <label style="font-size:.75rem">Vencimento *</label>
                <input type="date" id="invTxTDMaturity" style="font-size:.82rem;width:100%">
              </div>
              <div>
                <label style="font-size:.75rem" id="invTxTDRateLabel">Taxa Contratada (% a.a.)</label>
                <input type="text" id="invTxTDRate" inputmode="decimal" placeholder="Ex: 12,75"
                  style="font-size:.82rem;width:100%" oninput="_invCalcTDTotal()">
              </div>
              <div>
                <label style="font-size:.75rem">Preço por Título (R$)</label>
                <input type="text" id="invTxTDPurchasePrice" inputmode="decimal" placeholder="Preço unitário"
                  style="font-size:.82rem;width:100%" oninput="_invCalcTDTotal()">
                <div style="font-size:.68rem;color:var(--muted);margin-top:2px">Mínimo: 0,01 título</div>
              </div>
            </div>
            <div id="invTxTDRateHint" style="font-size:.72rem;color:var(--muted);padding:6px 8px;background:rgba(42,96,73,.07);border-radius:6px"></div>
            <div style="display:flex;align-items:center;gap:8px">
              <button type="button" class="btn btn-ghost btn-sm" style="font-size:.72rem" onclick="_invFetchTDPriceForForm()">
                🔄 Buscar PU Atual na B3
              </button>
              <span id="invTxTDFetchStatus" style="font-size:.72rem;color:var(--muted)"></span>
            </div>
          </div>
        </div>

        <!-- ── Fundo de Investimento: campos extras ───────────────────── -->
        <div id="invTxFundFields" class="form-group full" style="display:none">
          <div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--r-sm);padding:14px;display:flex;flex-direction:column;gap:10px">
            <div style="font-size:.78rem;font-weight:700;color:var(--accent);margin-bottom:2px">🏦 Parâmetros do Fundo</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <div class="form-group" style="margin:0">
                <label style="font-size:.75rem">Indexador *</label>
                <select id="invTxFundIndex" onchange="_invOnFundIndexChange()" style="font-size:.82rem;width:100%">
                  ${FUND_INDEXERS.map(f => `<option value="${f.value}">${f.label}</option>`).join('')}
                </select>
              </div>
              <div class="form-group" style="margin:0" id="invTxFundCdiPctGroup">
                <label style="font-size:.75rem" id="invTxFundRateLabel">% do CDI *</label>
                <input type="text" id="invTxFundRate" inputmode="decimal" placeholder="Ex: 110"
                  style="font-size:.82rem;width:100%">
              </div>
            </div>
            <div id="invTxFundHint" style="font-size:.72rem;color:var(--muted);padding:6px 8px;background:rgba(42,96,73,.07);border-radius:6px">
              A aplicação buscará o CDI via Banco Central e calculará o rendimento automaticamente.
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:.72rem;color:var(--muted)">CDI atual:</span>
              <span id="invTxCDIDisplay" style="font-size:.78rem;font-weight:700;color:var(--accent)">—</span>
              <button type="button" class="btn btn-ghost btn-sm" style="font-size:.72rem" onclick="_invFetchCDIForForm()">🔄 Atualizar</button>
            </div>
          </div>
        </div>

        <div class="form-group" id="invTxQtyGroup">
          <label id="invTxQtyLabel">Quantidade *</label>
          <input type="text" id="invTxQty" inputmode="decimal" placeholder="0"
            oninput="_invCalcTotal()">
        </div>
        <div class="form-group" id="invTxPriceGroup">
          <label id="invTxPriceLabel">Preço Unitário (BRL) *</label>
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
  // chart rendered in detail modal only
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

function _invOnTickerInput() {
  // Auto-select type when common patterns are detected
}

function _invOnAssetTypeChange() {
  const v = document.getElementById('invTxAssetType')?.value;
  const tdFields   = document.getElementById('invTxTDFields');
  const fundFields = document.getElementById('invTxFundFields');
  const qtyGroup   = document.getElementById('invTxQtyGroup');
  const priceGroup = document.getElementById('invTxPriceGroup');
  const qtyLabel   = document.getElementById('invTxQtyLabel');
  const priceLabel = document.getElementById('invTxPriceLabel');
  const ticker     = document.getElementById('invTxTicker');

  if (tdFields)   tdFields.style.display   = (v === 'tesouro_direto')      ? '' : 'none';
  if (fundFields) fundFields.style.display = (v === 'fundo_investimento')   ? '' : 'none';

  if (v === 'tesouro_direto') {
    if (ticker) { ticker.placeholder = 'Ex: TD-SELIC-2029'; }
    if (qtyLabel) qtyLabel.textContent = 'Quantidade de Títulos *';
    if (priceLabel) priceLabel.textContent = 'Preço por Título (R$) *';
    if (priceGroup) priceGroup.style.display = 'none'; // preço vem do campo TD
    _invOnTDSubtypeChange();
  } else if (v === 'fundo_investimento') {
    if (ticker) { ticker.placeholder = 'Nome/código do fundo'; }
    if (qtyLabel) qtyLabel.textContent = 'Valor Aplicado (R$) *';
    if (priceLabel) priceLabel.textContent = 'Cota Inicial (R$)';
    if (priceGroup) priceGroup.style.display = 'none'; // fundo usa 1 unidade = valor total
    if (qtyGroup) qtyGroup.style.display = ''; // mostra campo de valor
    _invOnFundIndexChange();
    _invFetchCDIForForm();
  } else {
    if (ticker) { ticker.placeholder = 'Ex: PETR4, BTC, AAPL'; }
    if (qtyLabel) qtyLabel.textContent = 'Quantidade *';
    if (priceLabel) priceLabel.textContent = 'Preço Unitário (BRL) *';
    if (priceGroup) priceGroup.style.display = '';
    if (qtyGroup) qtyGroup.style.display = '';
  }
}

function _invOnTDSubtypeChange() {
  const sub = document.getElementById('invTxTDSubtype')?.value;
  const hint = document.getElementById('invTxTDRateHint');
  const rateLabel = document.getElementById('invTxTDRateLabel');
  const t = TD_SUBTYPES.find(x => x.value === sub);
  if (!t) return;
  if (rateLabel) {
    rateLabel.textContent = sub === 'LFT'
      ? 'Spread sobre Selic (% a.a.) — normalmente 0'
      : 'Taxa Contratada (% a.a.) *';
  }
  if (hint) {
    const hints = {
      LFT:     '💡 Tesouro Selic: rende a Selic Over. O preço é atualizado automaticamente via API B3.',
      LTN:     '💡 Tesouro Prefixado: taxa definida na compra. Valor de face = R$ 1.000 no vencimento.',
      'NTN-F': '💡 Prefixado com juros semestrais. Cupons de 10% a.a. pagos a cada 6 meses.',
      'NTN-B': '💡 IPCA+ sem cupom. Acompanha IPCA + taxa contratada. Preço via API B3.',
      'NTN-B_P':'💡 IPCA+ com cupons semestrais de 6% a.a. + IPCA.',
      'NTN-C': '💡 IGP-M+ com cupons. Indexado ao IGP-M + taxa prefixada.',
    };
    hint.textContent = hints[sub] || '';
  }
}

function _invOnFundIndexChange() {
  const idx = document.getElementById('invTxFundIndex')?.value;
  const rateLabel = document.getElementById('invTxFundRateLabel');
  const hint = document.getElementById('invTxFundHint');
  const labels = {
    cdi:       '% do CDI *',
    prefixado: 'Taxa Prefixada (% a.a.) *',
    ipca:      'Spread sobre IPCA (% a.a.) *',
    selic:     '% da Selic *',
  };
  const hints = {
    cdi:       'O rendimento será calculado como X% do CDI anual. O CDI é buscado automaticamente no Banco Central.',
    prefixado: 'Rendimento prefixado. A aplicação crescerá à taxa informada, composta diariamente.',
    ipca:      'IPCA + spread prefixado. O IPCA dos últimos 12 meses é buscado no Banco Central.',
    selic:     'Rendimento como % da Selic Over. A Selic é buscada automaticamente.',
  };
  if (rateLabel) rateLabel.textContent = labels[idx] || '% *';
  if (hint) hint.textContent = hints[idx] || '';
}

async function _invFetchCDIForForm() {
  const display = document.getElementById('invTxCDIDisplay');
  if (display) display.textContent = '⏳';
  const cdi = await _fetchCDIAnual().catch(() => null);
  if (display) display.textContent = cdi ? cdi.toFixed(2) + '% a.a.' : 'Indisponível';
  window._invLastCDI = cdi;
  return cdi;
}

async function _invFetchTDPriceForForm() {
  const statusEl  = document.getElementById('invTxTDFetchStatus');
  const priceEl   = document.getElementById('invTxTDPurchasePrice');
  const sub       = document.getElementById('invTxTDSubtype')?.value;
  const maturity  = document.getElementById('invTxTDMaturity')?.value;
  if (statusEl) statusEl.textContent = '⏳ Buscando…';
  try {
    const list = await _fetchTDPrices();
    if (!list.length) throw new Error('API B3 indisponível');
    // Match pelo subtipo e vencimento
    const codeMap = { LFT:'selic', LTN:'prefixado', 'NTN-F':'prefixado', 'NTN-B':'ipca', 'NTN-B_P':'ipca', 'NTN-C':'igpm' };
    const kw = (codeMap[sub] || '').toLowerCase();
    let best = list.find(t => t.name.toLowerCase().includes(kw));
    if (!best && list.length) best = list[0];
    if (best?.buyPrice) {
      if (priceEl) priceEl.value = best.buyPrice.toFixed(2).replace('.', ',');
      const rateEl = document.getElementById('invTxTDRate');
      if (rateEl && !rateEl.value && best.buyRate) rateEl.value = best.buyRate.toFixed(2).replace('.', ',');
      if (statusEl) statusEl.textContent = '✅ PU ' + fmt(best.buyPrice);
      _invCalcTDTotal();
    } else {
      if (statusEl) statusEl.textContent = '⚠️ Título não encontrado na API';
    }
  } catch(e) {
    if (statusEl) statusEl.textContent = '❌ ' + e.message;
  }
}

function _invCalcTDTotal() {
  const qty   = parseFloat(document.getElementById('invTxQty')?.value?.replace(',', '.')) || 0;
  const price = parseFloat(document.getElementById('invTxTDPurchasePrice')?.value?.replace(',', '.')) || 0;
  const total = qty * price;
  const el = document.getElementById('invTxTotal');
  if (el) el.textContent = fmt(total);
  // Sync hidden price field
  const priceEl = document.getElementById('invTxPrice');
  if (priceEl) priceEl.value = price.toFixed(2).replace('.', ',');
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
  const btn    = document.getElementById('invTxSaveBtn');
  const errEl  = document.getElementById('invTxError');
  const type   = document.getElementById('invTxType').value;
  const accId  = document.getElementById('invTxAccount').value;
  const date   = document.getElementById('invTxDate').value;
  const assetT = document.getElementById('invTxAssetType').value;
  const name   = document.getElementById('invTxName').value.trim();
  const notes  = document.getElementById('invTxNotes').value.trim();
  const posId  = document.getElementById('invTxPositionId').value;

  if (errEl) errEl.style.display = 'none';
  if (!accId) { _invShowErr('Selecione a conta'); return; }
  if (!date)  { _invShowErr('Informe a data'); return; }

  // ── Coleta metadata de TD / Fundo ─────────────────────────────────────────
  let metaJson = {};

  if (assetT === 'tesouro_direto') {
    const sub      = document.getElementById('invTxTDSubtype')?.value || 'LFT';
    const maturity = document.getElementById('invTxTDMaturity')?.value || '';
    const tdRate   = parseFloat((document.getElementById('invTxTDRate')?.value || '').replace(',', '.')) || 0;
    const tdPrice  = parseFloat((document.getElementById('invTxTDPurchasePrice')?.value || '').replace(',', '.')) || 0;
    if (!maturity) { _invShowErr('Informe o vencimento do título'); return; }
    if (!tdPrice)  { _invShowErr('Informe o preço por título'); return; }
    const t = TD_SUBTYPES.find(x => x.value === sub);
    metaJson = { td_subtype: sub, td_maturity: maturity, td_rate: tdRate,
                 td_index: t?.index || 'selic', td_purchase_price: tdPrice, last_update: date };
    // Gera ticker padronizado: TD-SELIC-2029
    const yr = maturity.slice(0, 4);
    const codeLabel = { LFT:'SELIC', LTN:'PRE', 'NTN-F':'PREF', 'NTN-B':'IPCA', 'NTN-B_P':'IPCAJ', 'NTN-C':'IGPM' };
    const generatedTicker = 'TD-' + (codeLabel[sub] || sub) + '-' + yr;
    const tickerEl = document.getElementById('invTxTicker');
    if (tickerEl && !tickerEl.value.startsWith('TD-')) tickerEl.value = generatedTicker;
  }

  if (assetT === 'fundo_investimento') {
    const fundIdx  = document.getElementById('invTxFundIndex')?.value || 'cdi';
    const fundRate = parseFloat((document.getElementById('invTxFundRate')?.value || '').replace(',', '.')) || 0;
    if (!fundRate) { _invShowErr('Informe o ' + (fundIdx === 'cdi' ? '% do CDI' : 'taxa % a.a.')); return; }
    const cdiAtual = window._invLastCDI || null;
    metaJson = { fund_index: fundIdx,
                 fund_cdi_pct: fundIdx === 'cdi' ? fundRate : null,
                 fund_rate: fundIdx !== 'cdi' ? fundRate : null,
                 fund_last_cdi: cdiAtual, fund_last_update: date };
  }

  // ── Lê ticker final ────────────────────────────────────────────────────────
  const ticker = (document.getElementById('invTxTicker')?.value || '').trim().toUpperCase();
  if (!ticker) { _invShowErr('Informe o código do ativo'); return; }

  // ── Lê quantidade e preço por tipo de ativo ────────────────────────────────
  let qtyRaw, priceRaw;
  if (assetT === 'fundo_investimento') {
    qtyRaw   = parseFloat((document.getElementById('invTxQty')?.value || '').replace(',', '.')) || 0;
    priceRaw = 1;
    if (!qtyRaw || qtyRaw <= 0) { _invShowErr('Informe o valor aplicado'); return; }
  } else if (assetT === 'tesouro_direto') {
    qtyRaw   = parseFloat((document.getElementById('invTxQty')?.value || '').replace(',', '.')) || 0;
    priceRaw = parseFloat((document.getElementById('invTxTDPurchasePrice')?.value || '').replace(',', '.')) || 0;
    if (!qtyRaw || qtyRaw <= 0)    { _invShowErr('Informe a quantidade de títulos (mín: 0,01)'); return; }
    if (!priceRaw || priceRaw <= 0){ _invShowErr('Informe o preço por título'); return; }
  } else {
    qtyRaw   = parseFloat((document.getElementById('invTxQty')?.value || '').replace(',', '.')) || 0;
    priceRaw = parseFloat((document.getElementById('invTxPrice')?.value || '').replace(',', '.')) || 0;
    if (!qtyRaw || qtyRaw <= 0)    { _invShowErr('Informe a quantidade'); return; }
    if (!priceRaw || priceRaw <= 0){ _invShowErr('Informe o preço unitário'); return; }
  }

  const total    = qtyRaw * priceRaw;
  const notesStr = Object.keys(metaJson).length ? _invMetaStr(metaJson) : (notes || null);

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Salvando…'; }

  try {
    // 1. Upsert position
    let position = posId
      ? _inv.positions.find(p => p.id === posId)
      : _inv.positions.find(p => p.account_id === accId && p.ticker === ticker);

    if (!position) {
      const { data: newPos, error: posErr } = await sb.from('investment_positions').insert({
        family_id:     famId(),
        account_id:    accId,
        ticker,
        asset_type:    assetT,
        name:          name || ticker,
        quantity:      0,
        avg_cost:      0,
        current_price: priceRaw,
        currency:      ['acao_us','etf_us'].includes(assetT) ? 'USD' : 'BRL',
        notes:         notesStr,
      }).select().single();
      if (posErr) throw posErr;
      position = newPos;
      _inv.positions.push(position);
    } else if (Object.keys(metaJson).length) {
      await sb.from('investment_positions').update({ notes: notesStr }).eq('id', position.id);
      position.notes = notesStr;
    }

    // 2. Atualiza qty e avg_cost
    const oldQty  = +(position.quantity) || 0;
    const oldCost = +(position.avg_cost)  || 0;
    let newQty, newAvgCost;

    if (type === 'buy') {
      newQty     = oldQty + qtyRaw;
      newAvgCost = newQty > 0 ? (oldQty * oldCost + qtyRaw * priceRaw) / newQty : priceRaw;
    } else {
      if (qtyRaw > oldQty + 0.00001) { _invShowErr('Quantidade insuficiente (disponível: ' + oldQty + ')'); return; }
      newQty     = Math.max(0, oldQty - qtyRaw);
      newAvgCost = oldCost;
    }

    const { error: updErr } = await sb.from('investment_positions').update({
      quantity:      newQty,
      avg_cost:      newAvgCost,
      current_price: priceRaw,
      name:          name || position.name || ticker,
      asset_type:    assetT || position.asset_type,
      updated_at:    new Date().toISOString(),
    }).eq('id', position.id);
    if (updErr) throw updErr;
    Object.assign(position, { quantity: newQty, avg_cost: newAvgCost, current_price: priceRaw });

    // 3. Transação financeira na conta
    const txAmount = type === 'buy' ? -total : total;
    const txDesc   = assetT === 'tesouro_direto'
      ? (type==='buy' ? 'Compra TD: ' : 'Venda TD: ') + ticker + ' ' + qtyRaw + ' título(s) @ ' + fmt(priceRaw)
      : assetT === 'fundo_investimento'
      ? (type==='buy' ? 'Aplicação Fundo: ' : 'Resgate Fundo: ') + ticker
      : (type==='buy' ? 'Compra: ' : 'Venda: ') + ticker + ' ' + qtyRaw + 'x @ ' + fmt(priceRaw);

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

    // 4. Registro na investment_transactions
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
      notes:       notesStr,
    });

    // 5. Histórico de preço
    const today = new Date().toISOString().slice(0, 10);
    await sb.from('investment_price_history').upsert({
      position_id: position.id,
      family_id:   famId(),
      date:        date || today,
      price:       priceRaw,
      currency:    'BRL',
      source:      'manual',
    }, { onConflict: 'position_id,date' });

    const lbl = assetT==='fundo_investimento' ? (type==='buy'?'Aplicação':'Resgate')
              : assetT==='tesouro_direto' ? (type==='buy'?'Compra TD':'Venda TD')
              : (type==='buy'?'Compra':'Venda');
    toast('✅ ' + lbl + ' de ' + ticker + ' registrada!', 'success');
    closeModal('invTxModal');

    await loadInvestments(true);
    DB.accounts.bust();
    await DB.accounts.load(true);
    _invAugmentAccountBalances();
    _renderInvestmentsPage();
    if (state.currentPage === 'accounts') renderAccounts?.();
    if (state.currentPage === 'dashboard') loadDashboard?.();

  } catch(e) {
    _invShowErr(e.message || 'Erro ao salvar');
    if (btn) { btn.disabled = false; btn.textContent = type==='buy' ? '💾 Registrar Compra' : '💾 Registrar Venda'; }
  }
}

function _invShowErr(msg) {
  const errEl = document.getElementById('invTxError');
  if (errEl) { errEl.textContent = msg; errEl.style.display = ''; }
}


// ══════════════════════════════════════════════════════════════════════════════
// AUTO-YIELD ENGINE — Tesouro Direto & Fundos CDI
// Atualiza preços e registra movimentações de rendimento automaticamente.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Ponto de entrada do motor de rendimento.
 * Chamado no _invUpdatePrices para posições de TD e Fundos.
 */
async function _invRunAutoYield(positions) {
  const autoYield = positions.filter(p => _invIsAutoYield(p) && +(p.quantity) > 0);
  if (!autoYield.length) return;

  // Busca CDI e preços TD em paralelo
  const [cdiAnual, tdPrices] = await Promise.all([
    _fetchCDIAnual().catch(() => null),
    _fetchTDPrices().catch(() => []),
  ]);

  // Armazena CDI em cache de sessão para uso nos formulários
  if (cdiAnual) window._invLastCDI = cdiAnual;

  const today = new Date().toISOString().slice(0, 10);

  for (const pos of autoYield) {
    try {
      if (_invIsTD(pos)) {
        await _invUpdateTDPosition(pos, tdPrices, today);
      } else if (_invIsFund(pos)) {
        await _invUpdateFundPosition(pos, cdiAnual, today);
      }
    } catch(e) {
      console.warn('[inv] auto-yield error for', pos.ticker, ':', e.message);
    }
  }
}

/**
 * Atualiza posição de Tesouro Direto via API B3.
 * Se a API não retornar dados, calcula estimativa local.
 */
async function _invUpdateTDPosition(pos, tdPrices, today) {
  const meta    = _invGetMeta(pos);
  const lastUpd = meta.last_update || pos.created_at?.slice(0,10) || today;
  if (lastUpd === today) return; // já atualizado hoje

  const sub      = meta.td_subtype || 'LFT';
  const oldPrice = +(pos.current_price) || +(pos.avg_cost) || 0;
  let   newPrice = oldPrice;

  // Tenta achar o título na lista B3
  const codeMap  = { LFT:'selic', LTN:'prefixado', 'NTN-F':'prefixado', 'NTN-B':'ipca', 'NTN-B_P':'ipca', 'NTN-C':'igpm' };
  const kw       = (codeMap[sub] || '').toLowerCase();
  const matYear  = (meta.td_maturity || '').slice(0,4);
  const matched  = (tdPrices || []).find(t => {
    const n = t.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
    return n.includes(kw) && (!matYear || t.name.includes(matYear));
  });

  if (matched?.buyPrice && matched.buyPrice > 0) {
    newPrice = matched.buyPrice;
  } else if (sub === 'LTN' && meta.td_rate && meta.td_maturity) {
    // Estimativa local para Prefixado quando API indisponível
    const du = _busyDays(today, meta.td_maturity);
    if (du > 0) newPrice = _calcLTNPrice(meta.td_rate, du);
  }

  if (newPrice <= 0 || Math.abs(newPrice - oldPrice) < 0.001) return;

  const qty  = +(pos.quantity) || 0;
  const gain = (newPrice - oldPrice) * qty;

  await _invApplyYieldGain(pos, newPrice, gain, today, 'td_auto',
    'Rendimento TD: ' + pos.ticker + ' — PU ' + fmt(oldPrice) + ' → ' + fmt(newPrice));

  // Atualiza metadata com data de hoje
  const newMeta = { ...meta, last_update: today };
  await sb.from('investment_positions').update({ notes: _invMetaStr(newMeta) }).eq('id', pos.id);
  pos.notes = _invMetaStr(newMeta);
}

/**
 * Atualiza posição de Fundo de Investimento via CDI do BCB.
 */
async function _invUpdateFundPosition(pos, cdiAnual, today) {
  const meta    = _invGetMeta(pos);
  const lastUpd = meta.fund_last_update || pos.created_at?.slice(0,10) || today;
  if (lastUpd === today) return;

  const result = _calcFundYield(pos, cdiAnual);
  if (!result || result.gain === 0 || Math.abs(result.gain) < 0.01) return;

  const { newPrice, gain } = result;
  const indexLabel = { cdi:'CDI', prefixado:'Prefixado', ipca:'IPCA+', selic:'Selic' }[meta.fund_index] || 'CDI';
  const pctInfo = meta.fund_index === 'cdi'
    ? meta.fund_cdi_pct + '% do CDI (' + (cdiAnual||0).toFixed(2) + '% a.a.)'
    : meta.fund_rate + '% a.a. ' + indexLabel;

  await _invApplyYieldGain(pos, newPrice, gain, today, 'fund_cdi',
    'Rendimento Fundo: ' + pos.ticker + ' — ' + pctInfo + ' (' + result.dias + ' dias)');

  // Atualiza metadata
  const newMeta = { ...meta, fund_last_update: today, fund_last_cdi: cdiAnual || meta.fund_last_cdi };
  await sb.from('investment_positions').update({ notes: _invMetaStr(newMeta) }).eq('id', pos.id);
  pos.notes = _invMetaStr(newMeta);
}

/**
 * Aplica o ganho/perda: atualiza current_price, grava histórico e
 * registra movimentação de rendimento na investment_transactions e transactions.
 */
async function _invApplyYieldGain(pos, newPrice, gain, date, source, description) {
  if (!pos?.id) return;

  // 1. Atualiza current_price na posição
  await sb.from('investment_positions').update({
    current_price:    newPrice,
    price_updated_at: new Date().toISOString(),
    updated_at:       new Date().toISOString(),
  }).eq('id', pos.id);
  pos.current_price = newPrice;

  // 2. Grava histórico de preço
  await sb.from('investment_price_history').upsert({
    position_id: pos.id,
    family_id:   pos.family_id || famId(),
    date,
    price:       newPrice,
    currency:    'BRL',
    source,
  }, { onConflict: 'position_id,date' });

  // 3. Registra movimentação de rendimento na transactions principal
  const { data: txData } = await sb.from('transactions').insert({
    family_id:   pos.family_id || famId(),
    account_id:  pos.account_id,
    date,
    description,
    amount:      gain, // positivo = crédito na conta
    category_id: null,
    memo:        'Rendimento automático — ' + source,
    status:      'confirmed',
    is_transfer: false,
  }).select('id').single();

  // 4. Grava em investment_transactions com notes marcando como rendimento
  if (txData?.id) {
    await sb.from('investment_transactions').insert({
      family_id:   pos.family_id || famId(),
      position_id: pos.id,
      account_id:  pos.account_id,
      tx_id:       txData.id,
      type:        gain >= 0 ? 'buy' : 'sell', // buy = ganho (aumenta posição), sell = perda
      quantity:    0,  // rendimento não muda qty, apenas o preço
      unit_price:  newPrice,
      total_brl:   Math.abs(gain),
      date,
      notes:       _invMetaStr({ type: 'rendimento', source, gain }),
    });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PAINEL DE DETALHE ESTENDIDO para TD e Fundos
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Abre painel de atualização manual de rendimento para TD/Fundos.
 * Permite ao usuário corrigir o valor manualmente.
 */
function openInvYieldEditPanel(positionId) {
  const pos = _inv.positions.find(p => p.id === positionId);
  if (!pos || !_invIsAutoYield(pos)) return;

  document.getElementById('invYieldEditModal')?.remove();
  const meta     = _invGetMeta(pos);
  const isTD     = _invIsTD(pos);
  const isFund   = _invIsFund(pos);
  const curPrice = +(pos.current_price) || +(pos.avg_cost) || 0;
  const qty      = +(pos.quantity) || 0;
  const curValue = curPrice * qty;
  const cost     = +(pos.avg_cost) * qty;
  const pnl      = curValue - cost;

  // Informações do indexador atual
  let indexInfo = '';
  if (isTD) {
    const t = TD_SUBTYPES.find(x => x.value === meta.td_subtype) || {};
    indexInfo = (t.label || 'Tesouro') + (meta.td_maturity ? ' · Vence ' + fmtDate(meta.td_maturity) : '')
              + (meta.td_rate ? ' · ' + meta.td_rate + '% a.a.' : '');
  }
  if (isFund) {
    const idx = FUND_INDEXERS.find(x => x.value === meta.fund_index) || {};
    const rate = meta.fund_index === 'cdi' ? (meta.fund_cdi_pct + '% CDI') : (meta.fund_rate + '% a.a.');
    indexInfo = idx.label + ' · ' + rate + (meta.fund_last_cdi ? ' · CDI ref: ' + (+meta.fund_last_cdi).toFixed(2) + '%' : '');
  }

  const modal = document.createElement('div');
  modal.className = 'modal-overlay open';
  modal.id = 'invYieldEditModal';
  modal.style.zIndex = '10020';
  modal.innerHTML = `
  <div class="modal" style="max-width:480px"><div class="modal-handle"></div>
    <div class="modal-header">
      <span class="modal-title">✏️ Atualizar Rendimento — ${esc(pos.ticker)}</span>
      <button class="modal-close" onclick="closeModal('invYieldEditModal')">✕</button>
    </div>
    <div class="modal-body" style="display:flex;flex-direction:column;gap:14px">

      <!-- KPIs atuais -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        <div style="background:var(--surface2);border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:.68rem;color:var(--muted);margin-bottom:3px">Saldo Atual</div>
          <div style="font-size:.9rem;font-weight:700">${fmt(curValue)}</div>
        </div>
        <div style="background:var(--surface2);border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:.68rem;color:var(--muted);margin-bottom:3px">Custo Total</div>
          <div style="font-size:.9rem;font-weight:700">${fmt(cost)}</div>
        </div>
        <div style="background:var(--surface2);border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:.68rem;color:var(--muted);margin-bottom:3px">Resultado</div>
          <div style="font-size:.9rem;font-weight:700;color:${pnl>=0?'var(--green)':'var(--danger)'}">
            ${pnl>=0?'+':''}${fmt(pnl)}</div>
        </div>
      </div>

      <!-- Parâmetros do indexador -->
      <div style="font-size:.78rem;color:var(--muted);background:var(--surface2);border-radius:8px;padding:10px">
        📐 ${esc(indexInfo)}
      </div>

      <!-- CDI atual (somente fundos) -->
      ${isFund ? `
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:.82rem;flex:1">CDI atual (Banco Central):</span>
        <span id="invYieldCDIVal" style="font-weight:700;color:var(--accent)">
          ${window._invLastCDI ? (+window._invLastCDI).toFixed(2)+'% a.a.' : '—'}
        </span>
        <button type="button" class="btn btn-ghost btn-sm" style="font-size:.72rem"
          onclick="_invYieldRefreshCDI()">🔄</button>
      </div>` : ''}

      <!-- Tipo de atualização -->
      <div style="display:flex;flex-direction:column;gap:6px">
        <label style="font-size:.78rem;font-weight:600">Tipo de atualização</label>
        <div style="display:flex;gap:8px">
          <label style="display:flex;align-items:center;gap:6px;font-size:.82rem;cursor:pointer">
            <input type="radio" name="yieldUpdateType" value="auto" checked
              onchange="_invYieldToggleMode(this.value)"> Auto (calcular)
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-size:.82rem;cursor:pointer">
            <input type="radio" name="yieldUpdateType" value="manual"
              onchange="_invYieldToggleMode(this.value)"> Manual (informar valor)
          </label>
        </div>
      </div>

      <!-- Modo auto -->
      <div id="invYieldAutoMode">
        <div style="font-size:.82rem;color:var(--muted);padding:8px 12px;background:rgba(42,96,73,.07);border-radius:8px">
          🔄 Clique em <strong>Calcular e Aplicar</strong> para recalcular o rendimento
          desde <strong>${fmtDate(meta.fund_last_update || meta.last_update || 'hoje')}</strong> usando os índices atuais.
        </div>
        <div id="invYieldPreview" style="display:none;margin-top:8px;padding:10px 12px;
          background:var(--surface2);border-radius:8px;font-size:.82rem">
        </div>
      </div>

      <!-- Modo manual -->
      <div id="invYieldManualMode" style="display:none">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div class="form-group" style="margin:0">
            <label style="font-size:.75rem">Novo valor total (R$)</label>
            <input type="text" id="invYieldNewValue" inputmode="decimal"
              value="${curValue.toFixed(2).replace('.',',')}"
              style="font-size:.9rem;font-weight:600"
              oninput="_invYieldCalcManual()">
          </div>
          <div class="form-group" style="margin:0">
            <label style="font-size:.75rem">Ganho / Perda</label>
            <div id="invYieldGainDisplay" style="padding:8px 10px;border:1px solid var(--border);
              border-radius:var(--r-sm);font-size:.9rem;font-weight:700;color:var(--muted)">—</div>
          </div>
        </div>
      </div>

      <div id="invYieldError" style="display:none;color:var(--danger);font-size:.8rem;
        padding:8px;background:#fef2f2;border-radius:8px"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal('invYieldEditModal')">Cancelar</button>
      <button class="btn btn-primary" id="invYieldApplyBtn"
        onclick="applyInvYield('${positionId}')">
        🔄 Calcular e Aplicar
      </button>
    </div>
  </div>`;

  document.body.appendChild(modal);
  // Pré-calcula rendimento no modo auto
  _invYieldPreviewAuto(positionId);
}

window.openInvYieldEditPanel = openInvYieldEditPanel;

function _invYieldToggleMode(mode) {
  const autoEl   = document.getElementById('invYieldAutoMode');
  const manualEl = document.getElementById('invYieldManualMode');
  const btn      = document.getElementById('invYieldApplyBtn');
  if (autoEl)   autoEl.style.display   = mode === 'auto'   ? '' : 'none';
  if (manualEl) manualEl.style.display = mode === 'manual' ? '' : 'none';
  if (btn) btn.textContent = mode === 'auto' ? '🔄 Calcular e Aplicar' : '💾 Aplicar Valor Manual';
}

async function _invYieldRefreshCDI() {
  const cdi = await _fetchCDIAnual().catch(() => null);
  if (cdi) {
    window._invLastCDI = cdi;
    const el = document.getElementById('invYieldCDIVal');
    if (el) el.textContent = cdi.toFixed(2) + '% a.a.';
  }
}

async function _invYieldPreviewAuto(positionId) {
  const pos  = _inv.positions.find(p => p.id === positionId);
  if (!pos) return;
  const cdi  = window._invLastCDI || await _fetchCDIAnual().catch(() => null);
  const prev = document.getElementById('invYieldPreview');
  if (!prev) return;

  if (_invIsTD(pos)) {
    const meta = _invGetMeta(pos);
    const tdP  = await _fetchTDPrices().catch(() => []);
    const sub  = meta.td_subtype || 'LFT';
    const codeMap = { LFT:'selic',LTN:'prefixado','NTN-F':'prefixado','NTN-B':'ipca','NTN-B_P':'ipca','NTN-C':'igpm' };
    const kw   = (codeMap[sub]||'').toLowerCase();
    const mat  = (meta.td_maturity||'').slice(0,4);
    const m    = tdP.find(t => t.name.toLowerCase().includes(kw) && (!mat || t.name.includes(mat)));
    if (m?.buyPrice) {
      const qty   = +(pos.quantity) || 0;
      const oldP  = +(pos.current_price) || +(pos.avg_cost) || 0;
      const gain  = (m.buyPrice - oldP) * qty;
      prev.innerHTML = 'Novo PU: <strong>' + fmt(m.buyPrice) + '</strong> &nbsp;|&nbsp; Ganho: <strong style="color:' + (gain>=0?'var(--green)':'var(--danger)') + '">' + (gain>=0?'+':'') + fmt(gain) + '</strong>';
      prev.style.display = '';
    }
  } else if (_invIsFund(pos)) {
    const r = _calcFundYield(pos, cdi);
    if (r) {
      prev.innerHTML = 'Rendimento (' + r.dias + ' dias): <strong style="color:' + (r.gain>=0?'var(--green)':'var(--danger)') + '">' + (r.gain>=0?'+':'') + fmt(r.gain) + '</strong>'
        + ' &nbsp;|&nbsp; ' + r.pct.toFixed(3) + '% &nbsp;|&nbsp; Novo saldo: <strong>' + fmt(r.newValue) + '</strong>';
      prev.style.display = '';
    }
  }
}

function _invYieldCalcManual() {
  const pos = _inv.positions.find(p => document.getElementById('invYieldNewValue'));
  const newValEl = document.getElementById('invYieldNewValue');
  const gainEl   = document.getElementById('invYieldGainDisplay');
  if (!newValEl || !gainEl) return;
  // Find position from modal context — read positionId from apply button
  const applyBtn = document.getElementById('invYieldApplyBtn');
  const pid = applyBtn?.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
  const p   = pid ? _inv.positions.find(x => x.id === pid) : null;
  if (!p) return;
  const qty     = +(p.quantity) || 1;
  const curVal  = (+(p.current_price) || +(p.avg_cost) || 0) * qty;
  const newVal  = parseFloat(newValEl.value.replace(',','.')) || 0;
  const gain    = newVal - curVal;
  gainEl.textContent = (gain >= 0 ? '+' : '') + fmt(gain);
  gainEl.style.color = gain >= 0 ? 'var(--green)' : 'var(--danger)';
}

async function applyInvYield(positionId) {
  const pos    = _inv.positions.find(p => p.id === positionId);
  const errEl  = document.getElementById('invYieldError');
  const btn    = document.getElementById('invYieldApplyBtn');
  if (!pos) return;
  if (errEl) errEl.style.display = 'none';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Aplicando…'; }

  const mode  = document.querySelector('input[name="yieldUpdateType"]:checked')?.value || 'auto';
  const today = new Date().toISOString().slice(0, 10);
  const qty   = +(pos.quantity) || 1;

  try {
    if (mode === 'auto') {
      const cdi = window._invLastCDI || await _fetchCDIAnual().catch(() => null);

      if (_invIsTD(pos)) {
        const meta = _invGetMeta(pos);
        const tdP  = await _fetchTDPrices().catch(() => []);
        const sub  = meta.td_subtype || 'LFT';
        const codeMap = { LFT:'selic',LTN:'prefixado','NTN-F':'prefixado','NTN-B':'ipca','NTN-B_P':'ipca','NTN-C':'igpm' };
        const kw   = (codeMap[sub]||'').toLowerCase();
        const mat  = (meta.td_maturity||'').slice(0,4);
        const m    = tdP.find(t => t.name.toLowerCase().includes(kw) && (!mat || t.name.includes(mat)));
        if (!m?.buyPrice) throw new Error('Preço do título não encontrado na API B3. Tente novamente mais tarde ou use o modo Manual.');
        const gain = (m.buyPrice - (+(pos.current_price)||0)) * qty;
        await _invApplyYieldGain(pos, m.buyPrice, gain, today, 'td_auto',
          'Rendimento TD: ' + pos.ticker + ' — PU ' + fmt(pos.current_price) + ' → ' + fmt(m.buyPrice));
        const newMeta = { ..._invGetMeta(pos), last_update: today };
        await sb.from('investment_positions').update({ notes: _invMetaStr(newMeta) }).eq('id', pos.id);
        pos.notes = _invMetaStr(newMeta);

      } else if (_invIsFund(pos)) {
        const r = _calcFundYield(pos, cdi);
        if (!r || Math.abs(r.gain) < 0.01) throw new Error('Sem rendimento a aplicar (verificar datas ou taxa).');
        const meta = _invGetMeta(pos);
        const indexLabel = { cdi:'CDI', prefixado:'Prefixado', ipca:'IPCA+', selic:'Selic' }[meta.fund_index] || 'CDI';
        await _invApplyYieldGain(pos, r.newPrice, r.gain, today, 'fund_cdi',
          'Rendimento Fundo: ' + pos.ticker + ' — ' + (meta.fund_cdi_pct||meta.fund_rate) + '% ' + indexLabel + ' (' + r.dias + ' dias)');
        const newMeta = { ...meta, fund_last_update: today, fund_last_cdi: cdi || meta.fund_last_cdi };
        await sb.from('investment_positions').update({ notes: _invMetaStr(newMeta) }).eq('id', pos.id);
        pos.notes = _invMetaStr(newMeta);
      }

    } else {
      // Modo manual: usuário informa o novo valor total
      const newTotal = parseFloat((document.getElementById('invYieldNewValue')?.value || '').replace(',','.'));
      if (!newTotal || newTotal <= 0) throw new Error('Informe o novo valor total.');
      const curTotal = (+(pos.current_price) || +(pos.avg_cost) || 0) * qty;
      const gain     = newTotal - curTotal;
      const newPrice = qty > 0 ? newTotal / qty : newTotal;
      await _invApplyYieldGain(pos, newPrice, gain, today, 'manual',
        'Atualização manual: ' + pos.ticker + ' — novo saldo ' + fmt(newTotal));
      if (_invIsFund(pos)) {
        const meta    = _invGetMeta(pos);
        const newMeta = { ...meta, fund_last_update: today };
        await sb.from('investment_positions').update({ notes: _invMetaStr(newMeta) }).eq('id', pos.id);
        pos.notes = _invMetaStr(newMeta);
      }
    }

    toast('✅ Rendimento de ' + pos.ticker + ' atualizado!', 'success');
    closeModal('invYieldEditModal');
    closeModal('invDetailModal');
    await loadInvestments(true);
    DB.accounts.bust();
    await DB.accounts.load(true);
    _invAugmentAccountBalances();
    _renderInvestmentsPage();
    if (state.currentPage === 'dashboard') loadDashboard?.();

  } catch(e) {
    if (errEl) { errEl.textContent = '❌ ' + (e.message || 'Erro'); errEl.style.display = ''; }
    if (btn) { btn.disabled = false; btn.textContent = mode==='auto' ? '🔄 Calcular e Aplicar' : '💾 Aplicar Valor Manual'; }
  }
}
window.applyInvYield = applyInvYield;


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
      <div style="display:flex;gap:6px;align-items:center">
        <button onclick="deleteInvPosition('${positionId}')"
          style="font-family:var(--font-sans);font-size:.72rem;font-weight:700;color:var(--danger,#dc2626);background:rgba(220,38,38,.08);border:1px solid rgba(220,38,38,.2);border-radius:8px;padding:6px 12px;cursor:pointer;transition:all .2s"
          onmouseover="this.style.background='rgba(220,38,38,.15)'" onmouseout="this.style.background='rgba(220,38,38,.08)'">
          🗑️ Excluir
        </button>
        <button class="modal-close" onclick="closeModal('invDetailModal')">✕</button>
      </div>
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

      <!-- ── Painel de rendimento automático (TD e Fundos) ─────────────── -->
      ${_invIsAutoYield(pos) ? `
      <div style="background:linear-gradient(135deg,rgba(42,96,73,.08),rgba(42,96,73,.04));
        border:1px solid rgba(42,96,73,.25);border-radius:10px;padding:14px;margin-bottom:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div style="font-size:.82rem;font-weight:700;color:var(--accent)">
            ${_invIsTD(pos) ? '🏛️ Tesouro Direto' : '🏦 Fundo de Investimento'}
          </div>
          <button class="btn btn-primary btn-sm"
            style="font-size:.72rem;padding:5px 12px"
            onclick="openInvYieldEditPanel('${pos.id}')">
            🔄 Atualizar Rendimento
          </button>
        </div>
        ${(() => {
          const meta = _invGetMeta(pos);
          if (_invIsTD(pos)) {
            const t = TD_SUBTYPES.find(x => x.value === meta.td_subtype) || {};
            return '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:.78rem">'
              + '<div><div style="color:var(--muted);font-size:.68rem">Título</div><strong>' + esc(t.label||meta.td_subtype||'—') + '</strong></div>'
              + '<div><div style="color:var(--muted);font-size:.68rem">Vencimento</div><strong>' + (meta.td_maturity ? fmtDate(meta.td_maturity) : '—') + '</strong></div>'
              + '<div><div style="color:var(--muted);font-size:.68rem">Taxa</div><strong>' + (meta.td_rate ? meta.td_rate+'% a.a.' : '—') + '</strong></div>'
              + '</div>';
          } else {
            const idx = FUND_INDEXERS.find(x => x.value === meta.fund_index) || {};
            const rate = meta.fund_index === 'cdi' ? (meta.fund_cdi_pct + '% do CDI') : (meta.fund_rate + '% a.a.');
            const cdiRef = meta.fund_last_cdi ? 'CDI ref: ' + (+meta.fund_last_cdi).toFixed(2)+'%' : '';
            return '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:.78rem">'
              + '<div><div style="color:var(--muted);font-size:.68rem">Indexador</div><strong>' + esc(idx.label||meta.fund_index||'CDI') + '</strong></div>'
              + '<div><div style="color:var(--muted);font-size:.68rem">Taxa</div><strong>' + esc(rate) + '</strong></div>'
              + '<div><div style="color:var(--muted);font-size:.68rem">CDI Ref.</div><strong>' + esc(cdiRef||'—') + '</strong></div>'
              + '</div>';
          }
        })()}
        <div style="margin-top:8px;font-size:.7rem;color:var(--muted)">
          Última atualização: <strong>${fmtDate((_invGetMeta(pos).fund_last_update || _invGetMeta(pos).last_update || pos.updated_at?.slice(0,10) || '—'))}</strong>
        </div>
      </div>` : ''}

      <!-- Manual price update for renda_fixa / outro (mantido para compatibilidade) -->
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
  const navEl   = document.getElementById('investmentsNav');
  const pageEl  = document.getElementById('page-investments');

  if (!famId_) {
    if (navEl) navEl.style.display = 'none';
    if (pageEl) pageEl.style.display = 'none';
    if (typeof _syncModulesSection === 'function') _syncModulesSection();
    return;
  }

  let enabled = false;
  const cacheKey = 'investments_enabled_' + famId_;
  if (window._familyFeaturesCache && cacheKey in window._familyFeaturesCache) {
    enabled = !!window._familyFeaturesCache[cacheKey];
  } else {
    const raw = await getAppSetting(cacheKey, false);
    enabled = raw === true || raw === 'true';
    window._familyFeaturesCache = window._familyFeaturesCache || {};
    window._familyFeaturesCache[cacheKey] = enabled;
  }

  if (navEl) {
    navEl.style.display = enabled ? '' : 'none';
    navEl.dataset.featureControlled = '1';
  }
  if (pageEl) pageEl.style.display = enabled ? '' : 'none';
  if (typeof _syncModulesSection === 'function') _syncModulesSection();

  if (enabled) {
    await loadInvestments();
    _invAugmentAccountBalances();
    // Refresh dashboard investment card if on dashboard
    if (typeof _dashRenderInvestments === 'function') {
      setTimeout(() => _dashRenderInvestments().catch(() => {}), 300);
    }
  }
}

// Called from accounts.js after recalculating balances
function invPostBalanceHook() {
  if (_inv.loaded) _invAugmentAccountBalances();
}



// ── Portfolio performance chart (page-level) ────────────────────────────────
async function renderInvPerformanceChart() {
  const cvId = 'invPortfolioChart';
  const cv = document.getElementById(cvId);
  if (!cv) return;

  const positions = _inv.positions.filter(p => +(p.quantity) > 0);
  if (!positions.length) { cv.style.display = 'none'; return; }

  // Collect all price history for current positions
  let allHistory = [];
  try {
    const posIds = positions.map(p => p.id);
    // Fetch up to 90 days of price history across all positions
    const { data: hist } = await famQ(
      sb.from('investment_price_history')
        .select('position_id,date,price,currency')
    ).in('position_id', posIds)
      .order('date', { ascending: true })
      .limit(5000);
    allHistory = hist || [];
  } catch(e) {
    console.warn('[inv] perf chart history:', e.message);
    cv.style.display = 'none'; return;
  }

  if (!allHistory.length) { cv.style.display = 'none'; return; }

  // Group by date — compute total portfolio market value at each date
  const dateMap = {};
  allHistory.forEach(h => {
    const pos = positions.find(p => p.id === h.position_id);
    if (!pos) return;
    const qty = +(pos.quantity) || 0;
    const price = +(h.price) || 0;
    const mv = qty * price;
    if (!dateMap[h.date]) dateMap[h.date] = 0;
    dateMap[h.date] += mv;
  });

  const sortedDates = Object.keys(dateMap).sort();
  if (sortedDates.length < 2) { cv.style.display = 'none'; return; }

  const labels = sortedDates.map(d => {
    const dt = new Date(d + 'T12:00:00');
    return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  });
  const values = sortedDates.map(d => +dateMap[d].toFixed(2));

  const totalCost = positions.reduce((s, p) => s + _invCost(p), 0);
  const first = values[0];
  const last  = values[values.length - 1];
  const isPos = last >= totalCost;

  const G = '#22c55e', R = '#ef4444';
  const lineColor = isPos ? G : R;
  const fillColor = isPos ? 'rgba(34,197,94,.1)' : 'rgba(239,68,68,.1)';

  // Destroy existing
  if (cv._chart) { try { cv._chart.destroy(); } catch(_) {} }

  const fmt_ = v => 'R$ ' + (+v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  cv.style.display = '';
  cv._chart = new Chart(cv.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Valor de Mercado',
          data: values,
          borderColor: lineColor,
          backgroundColor: fillColor,
          borderWidth: 2.5,
          pointRadius: values.length > 30 ? 0 : 3,
          pointHoverRadius: 5,
          fill: 'origin',
          tension: 0.35,
        },
        {
          label: 'Custo Total',
          data: sortedDates.map(() => +totalCost.toFixed(2)),
          borderColor: 'rgba(100,116,139,.5)',
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          borderDash: [6, 3],
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { font: { size: 11 }, boxWidth: 12, padding: 10 },
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${fmt_(ctx.parsed.y)}`,
            afterBody: items => {
              const mv = items[0]?.parsed.y;
              if (mv == null) return;
              const diff = mv - totalCost;
              const pct  = totalCost ? (diff / totalCost * 100).toFixed(2) : '—';
              const sign = diff >= 0 ? '+' : '';
              return [``, ` P&L: ${sign}${fmt_(diff)} (${sign}${pct}%)`];
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { font: { size: 10 }, maxTicksLimit: 8 },
          grid: { display: false },
        },
        y: {
          ticks: {
            font: { size: 10 },
            callback: v => 'R$ ' + (+v).toLocaleString('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }),
          },
          grid: { color: 'rgba(0,0,0,.04)' },
        },
      },
    },
  });
}

// ── Allocation donut chart ───────────────────────────────────────────────────
function renderInvAllocationChart() {
  const cvId = 'invAllocationChart';
  const cv = document.getElementById(cvId);
  if (!cv) return;

  const positions = _inv.positions.filter(p => +(p.quantity) > 0);
  if (!positions.length) { cv.style.display = 'none'; return; }

  const COLORS = {
    acao_br: '#2a6049', fii: '#7c3aed', etf_br: '#0891b2',
    acao_us: '#dc2626', etf_us: '#ea580c', bdr: '#d97706',
    crypto: '#f59e0b', renda_fixa: '#16a34a', outro: '#94a3b8',
  };

  // Group by asset type
  const byType = {};
  const totalMV = positions.reduce((s, p) => s + _invMarketValue(p), 0);
  positions.forEach(p => {
    const k = p.asset_type || 'outro';
    byType[k] = (byType[k] || 0) + _invMarketValue(p);
  });

  const entries = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  const labels = entries.map(([k]) => _invAssetType(k).label);
  const data   = entries.map(([, v]) => +v.toFixed(2));
  const colors = entries.map(([k]) => COLORS[k] || '#94a3b8');

  if (cv._chart) { try { cv._chart.destroy(); } catch(_) {} }
  cv.style.display = '';

  const fmtShort = v => 'R$ ' + (+v).toLocaleString('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

  cv._chart = new Chart(cv.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderWidth: 2,
        borderColor: 'var(--surface, #fff)',
        hoverOffset: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: {
          position: 'right',
          labels: {
            font: { size: 11 },
            padding: 10,
            boxWidth: 12,
            generateLabels: chart => {
              const ds = chart.data.datasets[0];
              return chart.data.labels.map((label, i) => ({
                text: `${label} ${(data[i] / totalMV * 100).toFixed(1)}%`,
                fillStyle: ds.backgroundColor[i],
                strokeStyle: ds.backgroundColor[i],
                lineWidth: 0,
                index: i,
              }));
            },
          },
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: ${fmtShort(ctx.parsed)} (${(ctx.parsed / totalMV * 100).toFixed(1)}%)`,
          },
        },
      },
    },
  });
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

// ══════════════════════════════════════════════════════════════════════════════
// EXCLUIR POSIÇÃO DE INVESTIMENTO
// ══════════════════════════════════════════════════════════════════════════════
async function deleteInvPosition(positionId) {
  const pos = _inv.positions.find(p => p.id === positionId);
  if (!pos) { toast('Posição não encontrada', 'error'); return; }

  // Two-step confirmation — critical financial data
  const step1 = await new Promise(resolve => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10020;display:flex;align-items:center;justify-content:center;padding:24px';
    d.innerHTML = `
      <div style="background:var(--surface);border-radius:var(--r-lg);padding:28px 24px;max-width:380px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,.3)">
        <div style="font-size:1.5rem;text-align:center;margin-bottom:14px">⚠️</div>
        <div style="font-family:var(--font-serif);font-size:1.1rem;font-weight:600;color:var(--text);text-align:center;margin-bottom:10px">Excluir posição?</div>
        <div style="font-size:.85rem;color:var(--muted);text-align:center;margin-bottom:6px">
          <strong>${esc(pos.ticker)}</strong> — ${esc(pos.name || pos.ticker)}
        </div>
        <div style="font-size:.78rem;color:var(--danger,#dc2626);text-align:center;background:rgba(220,38,38,.06);border:1px solid rgba(220,38,38,.15);border-radius:8px;padding:10px;margin-bottom:20px">
          Isso também excluirá todas as transações e histórico de preços desta posição. Ação irreversível.
        </div>
        <div style="display:flex;gap:10px">
          <button onclick="this.closest('[style*=fixed]').remove();window._invDelResolve(false)"
            style="flex:1;padding:11px;border-radius:var(--r-sm);border:1px solid var(--border);background:var(--surface);font-family:var(--font-sans);font-size:.88rem;cursor:pointer">Cancelar</button>
          <button onclick="this.closest('[style*=fixed]').remove();window._invDelResolve(true)"
            style="flex:1;padding:11px;border-radius:var(--r-sm);border:none;background:var(--danger,#dc2626);color:#fff;font-family:var(--font-sans);font-size:.88rem;font-weight:700;cursor:pointer">Excluir</button>
        </div>
      </div>`;
    window._invDelResolve = resolve;
    document.body.appendChild(d);
  });
  delete window._invDelResolve;
  if (!step1) return;

  try {
    // Delete in order: price history → transactions → position
    await sb.from('investment_price_history').delete().eq('position_id', positionId);
    await sb.from('investment_transactions').delete().eq('position_id', positionId);
    const { error } = await sb.from('investment_positions').delete().eq('id', positionId);
    if (error) throw error;

    toast(`✓ Posição ${pos.ticker} excluída com sucesso.`, 'success');
    closeModal('invDetailModal');
    await loadInvestments(true);
    _renderInvestmentsPage();
  } catch(e) {
    toast('Erro ao excluir: ' + e.message, 'error');
  }
}
window.deleteInvPosition = deleteInvPosition;
