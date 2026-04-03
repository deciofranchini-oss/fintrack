/* ═══════════════════════════════════════════════════════════════════════════
   FX_RATES.JS — Cache de cotações de moedas estrangeiras → BRL
   ─────────────────────────────────────────────────────────────────────────
   • Cotações armazenadas em app_settings (TTL 4 h) + memória
   • Fonte primária: api.frankfurter.dev/v1 (gratuita, sem chave)
   • Fallback: api.frankfurter.app (domínio legado)
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
const _FX_BAR_PINNED  = ['USD'];          // sempre exibir USD→BRL na barra

// URL primária (novo domínio oficial) e fallback (legado)
const _FX_API_PRIMARY  = 'https://api.frankfurter.dev/v1';
const _FX_API_FALLBACK = 'https://api.frankfurter.app';

// Expõe a URL base para transactions.js e scheduled.js usarem
// Eles sobrescrevem com FX_API_BASE se já declarado, senão usa a primária
window.FX_API_BASE = window.FX_API_BASE || _FX_API_PRIMARY;

// Estado em memória
window._fxRates   = { BRL: 1 };
window._fxRatesTs = null;           // ISO timestamp da última busca
let _fxPromise    = null;           // deduplicador

// ─────────────────────────────────────────────────────────────────────────
// INIT — chamar uma vez no boot (idempotente, promessa deduplicada)
// ─────────────────────────────────────────────────────────────────────────
async function initFxRates() {
  if (_fxPromise) return _fxPromise;
  _fxPromise = _initFxRates().finally(() => {
    // Reseta a promise após resolução para que próximas chamadas
    // (ex: ao navegar para outra página e voltar) reavaliem o TTL
    _fxPromise = null;
  });
  return _fxPromise;
}

// Auto-refresh a cada 30 minutos enquanto a app estiver aberta
let _fxAutoRefreshTimer = null;
function _startFxAutoRefresh() {
  if (_fxAutoRefreshTimer) return; // já iniciado
  _fxAutoRefreshTimer = setInterval(async () => {
    const currencies = _usedCurrencies();
    if (!currencies.length) return;
    // Só atualiza se o cache estiver stale (>= TTL)
    if (_fxAgeMin() >= _FX_TTL_MIN) {
      await _fetchRates(currencies).catch(e =>
        console.warn('[FX] auto-refresh falhou:', e.message)
      );
      _renderFxBadge();
      console.info('[FX] cotações atualizadas automaticamente');
    }
  }, 30 * 60 * 1000); // 30 minutos
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

  // 4. Inicia auto-refresh periódico (apenas uma vez por sessão)
  _startFxAutoRefresh();
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
  return [...new Set([
    ..._FX_BAR_PINNED,
    ...(state?.accounts || [])
      .map(a => (a.currency || 'BRL').toUpperCase())
      .filter(c => c !== 'BRL')
  ])].filter(c => c && c !== 'BRL');
}

function _fxAgeMin() {
  if (!window._fxRatesTs) return Infinity;
  return (Date.now() - new Date(window._fxRatesTs).getTime()) / 60000;
}

async function _loadCached() {
  try {
    // Uma única query para buscar ambas as chaves
    if (sb) {
      const { data } = await sb.from('app_settings')
        .select('key,value')
        .in('key', [_FX_CACHE_KEY, _FX_TS_KEY]);
      if (data && data.length) {
        const ratesRow = data.find(r => r.key === _FX_CACHE_KEY);
        const tsRow    = data.find(r => r.key === _FX_TS_KEY);
        const rates = ratesRow?.value;
        const ts    = tsRow?.value;
        if (rates && typeof rates === 'object' && Object.keys(rates).length) {
          window._fxRates   = { BRL: 1, ...rates };
          window._fxRatesTs = ts || null;
          return true;
        }
      }
    }
    // Fallback: localStorage
    try {
      const rates = JSON.parse(localStorage.getItem(_FX_CACHE_KEY) || 'null');
      const ts    = localStorage.getItem(_FX_TS_KEY);
      if (rates && typeof rates === 'object' && Object.keys(rates).length) {
        window._fxRates   = { BRL: 1, ...rates };
        window._fxRatesTs = ts || null;
        return true;
      }
    } catch {}
  } catch(e) { console.warn('[FX] erro ao carregar cache:', e.message); }
  return false;
}

async function _fetchOneCurrency(cur) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    // Tenta URL primária (frankfurter.dev/v1)
    let res = null;
    try {
      res = await fetch(
        `${_FX_API_PRIMARY}/latest?base=${cur}&to=BRL`,
        { signal: controller.signal }
      );
    } catch (_) {
      // Rede falhou na primária — tenta fallback
    }
    // Fallback para domínio legado se necessário
    if (!res || !res.ok) {
      res = await fetch(
        `${_FX_API_FALLBACK}/latest?base=${cur}&symbols=BRL`,
        { signal: controller.signal }
      );
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // Ambas as APIs retornam { rates: { BRL: ... } }
    return data?.rates?.BRL || null;
  } catch(e) {
    console.warn(`[FX] ${cur}→BRL falhou:`, e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function _fetchRates(currencies) {
  const newRates = { BRL: 1 };
  // Busca em paralelo com timeout — não bloqueia mais que 4 segundos no total
  const results = await Promise.all(currencies.map(async cur => {
    const rate = await _fetchOneCurrency(cur);
    return { cur, rate };
  }));
  results.forEach(({ cur, rate }) => {
    newRates[cur] = rate || window._fxRates?.[cur] || null;
    if (!newRates[cur]) delete newRates[cur]; // remove se não obteve taxa
  });
  window._fxRates   = newRates;
  window._fxRatesTs = new Date().toISOString();

  // Salvar no localStorage imediatamente como fallback offline
  try {
    localStorage.setItem(_FX_CACHE_KEY, JSON.stringify(newRates));
    localStorage.setItem(_FX_TS_KEY, window._fxRatesTs);
  } catch {}

  // Salvar no banco Supabase diretamente (upsert) — não usa saveAppSetting
  // que só escreve no localStorage/cache e nunca persiste no DB de forma confiável
  if (sb) {
    Promise.all([
      sb.from('app_settings').upsert({ key: _FX_CACHE_KEY, value: newRates },      { onConflict: 'key' }),
      sb.from('app_settings').upsert({ key: _FX_TS_KEY,    value: window._fxRatesTs }, { onConflict: 'key' }),
    ]).catch(e => console.warn('[FX] erro ao persistir cache no DB:', e.message));
  }
}

function _renderFxBadge() {
  const el       = document.getElementById('fxRatesBadge');
  const ratesEl  = document.getElementById('fxBarRates');
  const ageEl    = document.getElementById('fxBarAge');
  const refreshEl= document.getElementById('fxBarRefreshBtn');
  const familyEl = document.getElementById('fxBarFamily');
  const familyTextEl = document.getElementById('fxBarFamilyText');
  if (!el) return;

  try {
    const fid = currentUser?.family_id;
    const familyName = fid
      ? ((typeof _familyDisplayName === 'function' ? _familyDisplayName(fid, '') : '') || (currentUser?.families || []).find(f => String(f.id) === String(fid))?.name || '')
      : '';
    if (familyEl) familyEl.style.display = familyName ? '' : 'none';
    if (familyTextEl) familyTextEl.textContent = familyName || '';
  } catch (_) {}

  const wanted = _usedCurrencies();
  const pairs = wanted
    .map(c => [c, window._fxRates[c]])
    .filter(([, rate]) => rate != null);
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
