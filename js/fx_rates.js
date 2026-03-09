/* ═══════════════════════════════════════════════════════════════════════════
   FX_RATES.JS — Cache de cotações de moedas estrangeiras → BRL
   ─────────────────────────────────────────────────────────────────────────
   • Cotações armazenadas em app_settings (TTL 4 h) + memória
   • Fonte: api.frankfurter.app (gratuita, sem chave)
   • Chamada única por sessão se cache válido; revalidação silenciosa
   ─────────────────────────────────────────────────────────────────────────
   API pública:
     await initFxRates()            carrega cache; busca API se necessário
     getFxRate(currency)            1 USD → 5.23 (retorna 1 se BRL)
     toBRL(amount, currency)        converte valor para BRL
     txToBRL(tx)                    usa tx.brl_amount se disponível
     fxRateAge()                    minutos desde última atualização
     await refreshFxRates()         força busca na API
═══════════════════════════════════════════════════════════════════════════ */

const _FX_CACHE_KEY   = 'fx_rates_cache';
const _FX_TS_KEY      = 'fx_rates_ts';
const _FX_TTL_MIN     = 240;              // 4 horas
const _FX_API         = 'https://api.frankfurter.app';

// Estado em memória
window._fxRates   = { BRL: 1 };
window._fxRatesTs = null;           // ISO timestamp da última busca
let _fxPromise    = null;           // deduplicador

// ─────────────────────────────────────────────────────────────────────────
// INIT — chamar uma vez no boot (idempotente, promessa deduplicada)
// ─────────────────────────────────────────────────────────────────────────
async function initFxRates() {
  if (_fxPromise) return _fxPromise;
  _fxPromise = _initFxRates();
  return _fxPromise;
}

async function _initFxRates() {
  // 1. Carrega cache persistido
  const ok = await _loadCached();

  // 2. Determina moedas em uso
  const needed = _usedCurrencies();
  if (!needed.length) return;   // só BRL, nada a fazer

  // 3. Busca se stale ou cobertura incompleta
  const stale    = !ok || _fxAgeMin() > _FX_TTL_MIN;
  const missing  = needed.some(c => !window._fxRates[c]);
  if (stale || missing) {
    await _fetchRates(needed).catch(e =>
      console.warn('[FX] falha ao buscar cotações:', e.message)
    );
  }
  _renderFxBadge();
}

// ─────────────────────────────────────────────────────────────────────────
// API PÚBLICA
// ─────────────────────────────────────────────────────────────────────────
function getFxRate(currency) {
  if (!currency || currency.toUpperCase() === 'BRL') return 1;
  return window._fxRates[currency.toUpperCase()] ?? 1;
}

function toBRL(amount, currency) {
  if (!currency || currency.toUpperCase() === 'BRL') return amount ?? 0;
  return (amount ?? 0) * getFxRate(currency);
}

/**
 * Converte uma transação para BRL.
 * Prefere brl_amount salvo; cai para conversão pelo câmbio atual.
 */
function txToBRL(tx) {
  if (tx.brl_amount != null) return tx.brl_amount;
  const cur = (tx.currency || tx.accounts?.currency || 'BRL').toUpperCase();
  return toBRL(tx.amount, cur);
}

function fxRateAge() { return _fxAgeMin(); }

async function refreshFxRates() {
  const currencies = _usedCurrencies();
  if (!currencies.length) { toast('Nenhuma moeda estrangeira cadastrada.', 'info'); return; }
  await _fetchRates(currencies);
  _renderFxBadge();
  toast('✓ Cotações atualizadas', 'success');
}

// ─────────────────────────────────────────────────────────────────────────
// INTERNOS
// ─────────────────────────────────────────────────────────────────────────
function _usedCurrencies() {
  return [...new Set(
    (state?.accounts || [])
      .map(a => (a.currency || 'BRL').toUpperCase())
      .filter(c => c !== 'BRL')
  )];
}

function _fxAgeMin() {
  if (!window._fxRatesTs) return Infinity;
  return (Date.now() - new Date(window._fxRatesTs).getTime()) / 60000;
}

async function _loadCached() {
  try {
    const rates = await getAppSetting(_FX_CACHE_KEY, null);
    const ts    = await getAppSetting(_FX_TS_KEY,    null);
    if (rates && typeof rates === 'object' && Object.keys(rates).length) {
      window._fxRates   = { BRL: 1, ...rates };
      window._fxRatesTs = ts || null;
      return true;
    }
  } catch(e) { console.warn('[FX] erro ao carregar cache:', e.message); }
  return false;
}

async function _fetchRates(currencies) {
  const newRates = { BRL: 1 };
  for (const cur of currencies) {
    try {
      const res  = await fetch(`${_FX_API}/latest?base=${cur}&symbols=BRL`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data?.rates?.BRL) newRates[cur] = data.rates.BRL;
    } catch(e) {
      console.warn(`[FX] ${cur}→BRL falhou:`, e.message);
      if (window._fxRates[cur]) newRates[cur] = window._fxRates[cur]; // mantém anterior
    }
  }
  window._fxRates   = newRates;
  window._fxRatesTs = new Date().toISOString();
  try {
    await saveAppSetting(_FX_CACHE_KEY, newRates);
    await saveAppSetting(_FX_TS_KEY,    window._fxRatesTs);
  } catch(e) { console.warn('[FX] erro ao persistir cache:', e.message); }
}

function _renderFxBadge() {
  const el       = document.getElementById('fxRatesBadge');
  const ratesEl  = document.getElementById('fxBarRates');
  const ageEl    = document.getElementById('fxBarAge');
  const refreshEl= document.getElementById('fxBarRefreshBtn');
  if (!el) return;

  const pairs = Object.entries(window._fxRates).filter(([c]) => c !== 'BRL');
  if (!pairs.length) { el.style.display = 'none'; return; }

  const age    = _fxAgeMin();
  const stale  = age > _FX_TTL_MIN;
  const ageRnd = Math.round(age);
  const ageStr = age === Infinity ? '' : age < 60 ? `há ${ageRnd}min` : `há ${Math.round(age/60)}h`;

  el.style.display = '';

  if (ratesEl) {
    ratesEl.innerHTML = pairs.map(([c, r]) =>
      `<span class="fx-chip${stale?' fx-chip-stale':''}" title="1 ${c} = ${r.toLocaleString('pt-BR',{minimumFractionDigits:4,maximumFractionDigits:4})} BRL">`
      + `<span class="fx-chip-cur">${c}</span>`
      + `<span class="fx-chip-sep">=</span>`
      + `<span class="fx-chip-val">${r.toLocaleString('pt-BR',{minimumFractionDigits:4,maximumFractionDigits:4})}</span>`
      + `</span>`
    ).join('');
  }

  if (ageEl)     ageEl.textContent   = ageStr;
  if (refreshEl) {
    refreshEl.textContent = stale ? '⚠️' : '🔄';
    refreshEl.title       = stale ? 'Cotações desatualizadas — clique para atualizar' : 'Atualizar cotações';
    refreshEl.classList.toggle('fx-bar-stale', stale);
  }
}
