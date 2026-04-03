/* ═══════════════════════════════════════════════════════════════════════════
   TELEMETRY — Rastreamento de uso, erros, IA e performance
   ─────────────────────────────────────────────────────────────────────────
   Design:
   • Zero impacto na UI — todas as gravações são fire-and-forget via queue
   • Batch flush a cada 30s ou quando a queue atinge 20 eventos
   • Falhas silenciosas (nunca propagam erro para o usuário)
   • Eventos são enriquecidos automaticamente com device/user/family context
   ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

// ── Estado interno ────────────────────────────────────────────────────────────
const _tel = {
  queue:        [],          // eventos pendentes
  flushing:     false,       // flush em progresso
  enabled:      true,        // pode ser desabilitado via app_settings
  sessionId:    _telGenId(), // ID único desta sessão
  pageStart:    null,        // {page, ts} para medir tempo em tela
  flushTimer:   null,
  BATCH_SIZE:   20,
  FLUSH_MS:     30_000,      // 30 segundos
  TABLE:        'app_telemetry',
};

// ── Gerador de ID curto ───────────────────────────────────────────────────────
function _telGenId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Device fingerprint (cached) ───────────────────────────────────────────────
let _telDevice = null;
function _telGetDevice() {
  if (_telDevice) return _telDevice;
  const ua = navigator.userAgent || '';
  const isMobile  = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const isTablet  = /iPad|Android(?!.*Mobile)/i.test(ua);
  const isIOS     = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  let browser = 'other';
  if (/Chrome\//.test(ua) && !/Edg\//.test(ua))  browser = 'chrome';
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'safari';
  else if (/Firefox\//.test(ua))  browser = 'firefox';
  else if (/Edg\//.test(ua))      browser = 'edge';
  let os = 'other';
  if (isIOS)           os = 'ios';
  else if (isAndroid)  os = 'android';
  else if (/Windows/.test(ua)) os = 'windows';
  else if (/Mac/.test(ua))     os = 'macos';
  else if (/Linux/.test(ua))   os = 'linux';
  _telDevice = {
    type:         isTablet ? 'tablet' : isMobile ? 'mobile' : 'desktop',
    os,
    browser,
    screen_w:     screen.width,
    screen_h:     screen.height,
    pwa:          window.matchMedia('(display-mode: standalone)').matches || !!navigator.standalone,
    lang:         navigator.language || 'pt-BR',
    tz:           Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    connection:   navigator.connection?.effectiveType || null,
  };
  return _telDevice;
}

// ── Contexto do usuário ───────────────────────────────────────────────────────
function _telCtx() {
  const u = typeof currentUser !== 'undefined' ? currentUser : null;
  return {
    user_id:    u?.id    || null,
    user_name:  u?.name  || null,
    user_email: u?.email || null,
    family_id:  u?.family_id || (typeof famId === 'function' ? famId() : null),
    user_role:  u?.role  || null,
  };
}

// ── Enqueue ───────────────────────────────────────────────────────────────────
function telTrack(event_type, payload = {}) {
  if (!_tel.enabled) return;
  try {
    const ctx = _telCtx();
    if (!ctx.user_id && !ctx.family_id) return; // não logado ainda
    _tel.queue.push({
      id:           _telGenId(),
      session_id:   _tel.sessionId,
      event_type,   // 'page_view' | 'operation' | 'error' | 'ai_call' | 'performance'
      page:         (typeof state !== 'undefined' ? state.currentPage : null) || null,
      ts:           new Date().toISOString(),
      device:       _telGetDevice(),
      ...ctx,
      payload: {
        ...(payload || {}),
        _u: { name: ctx.user_name, email: ctx.user_email },
      },
    });
    if (_tel.queue.length >= _tel.BATCH_SIZE) _telFlush();
  } catch (_) { /* silencioso */ }
}
window.telTrack = telTrack;

// ── Flush batch para o Supabase ───────────────────────────────────────────────
async function _telFlush() {
  if (_tel.flushing || !_tel.queue.length) return;
  if (typeof sb === 'undefined' || !sb) return;
  _tel.flushing = true;
  const batch = _tel.queue.splice(0, _tel.BATCH_SIZE);
  try {
    // Mapeia para o schema da tabela
    const rows = batch.map(e => ({
      id:           e.id,
      session_id:   e.session_id,
      event_type:   e.event_type,
      page:         e.page,
      ts:           e.ts,
      user_id:      e.user_id,
      family_id:    e.family_id,
      user_role:    e.user_role,
      device_type:  e.device?.type   || null,
      device_os:    e.device?.os     || null,
      device_browser: e.device?.browser || null,
      screen_w:     e.device?.screen_w || null,
      screen_h:     e.device?.screen_h || null,
      is_pwa:       e.device?.pwa    || false,
      lang:         e.device?.lang   || null,
      payload:      e.payload,
    }));
    const { error } = await sb.from(_tel.TABLE).insert(rows);
    if (error) {
      // Re-queue se tabela não existe ainda (migration pendente)
      if (error.code === '42P01') {
        _tel.enabled = false; // desabilita até próxima sessão
        console.info('[telemetry] tabela não existe — execute migration_telemetry.sql');
      } else if (error.code === '42501' || error.message?.includes('policy') || error.message?.includes('RLS') || error.message?.includes('permission')) {
        // RLS bloqueando INSERT — execute migration_telemetry_rls.sql no Supabase
        _tel.enabled = false;
        console.warn('[telemetry] INSERT bloqueado por RLS. Execute migration_telemetry_rls.sql no Supabase SQL Editor para corrigir.');
      }
      // outros erros: descarta silenciosamente (não re-queue para evitar acúmulo)
    }
  } catch (_) { /* silencioso */ }
  finally { _tel.flushing = false; }
}

// ── Timer de flush periódico ──────────────────────────────────────────────────
function _telStartTimer() {
  _tel.flushTimer = setInterval(() => _telFlush(), _tel.FLUSH_MS);
}

// ── Page view + tempo em tela ─────────────────────────────────────────────────
function _telOnNavigate(page) {
  try {
    const now = Date.now();
    // Registra tempo gasto na tela anterior
    if (_tel.pageStart) {
      const elapsed = Math.round((now - _tel.pageStart.ts) / 1000);
      if (elapsed >= 2) { // ignora flashes < 2s
        telTrack('page_time', { page: _tel.pageStart.page, seconds: elapsed });
      }
    }
    _tel.pageStart = { page, ts: now };
    telTrack('page_view', { page });
  } catch (_) {}
}

// ── Operações principais ──────────────────────────────────────────────────────
function telOp(operation, detail = {}) {
  telTrack('operation', { operation, ...detail });
}
window.telOp = telOp;

// ── Erros ─────────────────────────────────────────────────────────────────────
function telError(source, message, detail = {}) {
  telTrack('error', { source, message: String(message).slice(0, 500), ...detail });
}
window.telError = telError;

// ── Chamadas de IA (Gemini) ───────────────────────────────────────────────────
function telAI(model, feature, tokens_in, tokens_out, latency_ms, success = true, error_msg = null) {
  telTrack('ai_call', {
    model,
    feature,       // 'receipt_scan' | 'import_detect' | 'ai_insights'
    tokens_in:     tokens_in  || 0,
    tokens_out:    tokens_out || 0,
    tokens_total:  (tokens_in || 0) + (tokens_out || 0),
    latency_ms:    latency_ms || 0,
    success,
    error_msg:     error_msg ? String(error_msg).slice(0, 300) : null,
  });
}
window.telAI = telAI;

// ── Contagens de DB (backups, registros) ──────────────────────────────────────
function telCount(metric, value, detail = {}) {
  telTrack('metric', { metric, value, ...detail });
}
window.telCount = telCount;

// ── Erros globais não capturados ──────────────────────────────────────────────
function _telHookGlobalErrors() {
  window.addEventListener('error', (e) => {
    telError('uncaught', e.message, {
      file:   e.filename ? e.filename.split('/').pop() : null,
      line:   e.lineno || null,
      col:    e.colno  || null,
    });
  }, { passive: true });

  window.addEventListener('unhandledrejection', (e) => {
    const msg = e.reason?.message || String(e.reason || 'unhandled rejection').slice(0, 300);
    telError('unhandled_promise', msg, {});
  }, { passive: true });
}

// ── Intercepta navigate() do app para rastrear page views ────────────────────
function _telHookNavigate() {
  const _orig = window.navigate;
  if (typeof _orig !== 'function') return;
  window.navigate = function(page, ...args) {
    _telOnNavigate(page);
    return _orig.call(this, page, ...args);
  };
}

// ── Intercepta toast() para capturar erros exibidos ao usuário ───────────────
function _telHookToast() {
  const _orig = window.toast;
  if (typeof _orig !== 'function') return;
  window.toast = function(msg, type, ...args) {
    if (type === 'error') telError('toast', msg, {});
    return _orig.call(this, msg, type, ...args);
  };
}

// ── Intercepta fetch do Gemini para capturar tokens ──────────────────────────
function _telHookGeminiFetch() {
  const _origFetch = window.fetch;
  window.fetch = async function(input, init, ...rest) {
    const url = typeof input === 'string' ? input : input?.url || '';
    const isGemini = url.includes('generativelanguage.googleapis.com');
    if (!isGemini) return _origFetch.call(this, input, init, ...rest);

    const t0 = Date.now();
    // Extrai nome do modelo da URL (ex: models/gemini-2.5-flash-lite:generateContent)
    const modelMatch = url.match(/models\/([^/:?]+)/);
    const model = modelMatch ? modelMatch[1] : 'gemini-unknown';
    // Extrai feature do contexto (página atual)
    const page = (typeof state !== 'undefined' ? state.currentPage : '') || '';
    const feature = page === 'import' ? 'import_detect'
                  : page === 'transactions' ? 'receipt_scan'
                  : page === 'ai_insights' ? 'ai_insights'
                  : 'gemini_other';

    try {
      const resp = await _origFetch.call(this, input, init, ...rest);
      const latency = Date.now() - t0;

      // Clonar resposta para ler tokens sem consumir o body original
      const clone = resp.clone();
      clone.json().then(data => {
        const usage = data?.usageMetadata || {};
        telAI(
          model, feature,
          usage.promptTokenCount     || 0,
          usage.candidatesTokenCount || 0,
          latency,
          resp.ok,
          resp.ok ? null : `HTTP ${resp.status}`,
        );
      }).catch(() => {
        telAI(model, feature, 0, 0, latency, resp.ok, resp.ok ? null : `HTTP ${resp.status}`);
      });

      return resp;
    } catch (e) {
      telAI(model, feature, 0, 0, Date.now() - t0, false, e.message);
      throw e;
    }
  };
}

// ── Rastreia operações de CRUD principais via hook em sb ──────────────────────
function _telHookSupabaseOps() {
  if (typeof sb === 'undefined' || !sb?.from) return;
  const _origFrom = sb.from.bind(sb);
  const OPS_TABLES = new Set([
    'transactions','accounts','budgets','categories','payees',
    'scheduled_transactions','debts','app_backups','investments',
    'investment_positions','investment_transactions',
  ]);
  sb.from = function(table, ...args) {
    const builder = _origFrom(table, ...args);
    if (!OPS_TABLES.has(table)) return builder;

    // Wrap insert
    const _origInsert = builder.insert?.bind(builder);
    if (_origInsert) {
      builder.insert = function(data, ...iargs) {
        const count = Array.isArray(data) ? data.length : 1;
        telOp('insert', { table, count });
        return _origInsert(data, ...iargs);
      };
    }
    // Wrap delete
    const _origDelete = builder.delete?.bind(builder);
    if (_origDelete) {
      builder.delete = function(...dargs) {
        telOp('delete', { table });
        return _origDelete(...dargs);
      };
    }
    return builder;
  };
}

// ── Rastreia contagem de registros periodicamente ─────────────────────────────
async function _telSnapshotCounts() {
  if (!_tel.enabled || typeof sb === 'undefined') return;
  const ctx = _telCtx();
  if (!ctx.family_id) return;
  try {
    const tables = ['transactions','accounts','categories','budgets',
                    'scheduled_transactions','app_backups'];
    const results = await Promise.allSettled(
      tables.map(t =>
        Promise.resolve(
          sb.from(t).select('id', { count: 'exact', head: true }).eq('family_id', ctx.family_id)
        ).catch(() => ({ count: null }))
      )
    );
    const counts = {};
    tables.forEach((t, i) => {
      const r = results[i];
      counts[t] = (r.status === 'fulfilled' ? r.value?.count : null) ?? null;
    });
    telCount('db_snapshot', 1, counts);
  } catch (_) {}
}

// ── Init ──────────────────────────────────────────────────────────────────────
function initTelemetry() {
  try {
    _telHookGlobalErrors();
    _telHookToast();       // captura errors do toast
    // Hooks que dependem de sb/navigate — aguarda DOM ready
    const _hookDelayed = () => {
      _telHookNavigate();
      _telHookGeminiFetch();
      _telHookSupabaseOps();
      _telStartTimer();
      // Snapshot de contagens 60s após boot (evita competir com o carregamento inicial)
      setTimeout(_telSnapshotCounts, 60_000);
      // Re-snapshot a cada 6 horas (sessão longa)
      setInterval(_telSnapshotCounts, 6 * 60 * 60_000);
    };
    if (document.readyState === 'complete') {
      setTimeout(_hookDelayed, 1500); // aguarda sb e navigate estarem prontos
    } else {
      window.addEventListener('load', () => setTimeout(_hookDelayed, 1500), { once: true });
    }
    // Flush ao sair da página
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') _telFlush();
    }, { passive: true });
    window.addEventListener('pagehide', () => _telFlush(), { passive: true });
  } catch (_) {}
}

// Auto-init
initTelemetry();


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
