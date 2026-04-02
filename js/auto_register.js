const AUTO_CHECK_CONFIG_KEY = 'fintrack_auto_check_config';
let _autoCheckTimer = null;

// Default config
const AUTO_CHECK_DEFAULTS = {
  enabled: false,
  intervalMinutes: 60,
  daysAhead: 0,
  emailDefault: '',
  method: 'browser',
  lastRun: null,
  lastRunCount: 0,
};

function getAutoCheckConfig() {
  try {
    const raw = localStorage.getItem(AUTO_CHECK_CONFIG_KEY);
    return raw ? { ...AUTO_CHECK_DEFAULTS, ...JSON.parse(raw) } : { ...AUTO_CHECK_DEFAULTS };
  } catch { return { ...AUTO_CHECK_DEFAULTS }; }
}

async function saveAutoCheckConfig() {
  const cfg = {
    enabled: document.getElementById('autoCheckEnabled')?.checked || false,
    intervalMinutes: parseInt(document.getElementById('autoCheckInterval')?.value||'60'),
    daysAhead: parseInt(document.getElementById('autoCheckDaysAhead')?.value||'0'),
    emailDefault: document.getElementById('autoCheckEmailDefault')?.value.trim()||'',
    method: document.getElementById('autoCheckMethod')?.value||'browser',
  };
  // Preserve non-form fields
  const current = getAutoCheckConfig();
  const merged = { ...current, ...cfg };
  localStorage.setItem(AUTO_CHECK_CONFIG_KEY, JSON.stringify(merged));
  await saveAppSetting(AUTO_CHECK_CONFIG_KEY, merged);
  applyAutoCheckTimer(merged);
  updateAutoCheckUI(merged);
  toast('Configuração de automação salva', 'success');
}

function loadAutoCheckConfig() {
  const cfg = getAutoCheckConfig();
  const enEl = document.getElementById('autoCheckEnabled');
  const intEl = document.getElementById('autoCheckInterval');
  const dayEl = document.getElementById('autoCheckDaysAhead');
  const emEl  = document.getElementById('autoCheckEmailDefault');
  const mEl   = document.getElementById('autoCheckMethod');
  if(enEl) enEl.checked = cfg.enabled;
  if(intEl) intEl.value = cfg.intervalMinutes;
  if(dayEl) dayEl.value = cfg.daysAhead;
  // Pre-fill with currentUser email if not configured yet
  if(emEl)  emEl.value  = cfg.emailDefault || (typeof currentUser !== 'undefined' ? currentUser?.email || '' : '');
  if(mEl)   mEl.value   = cfg.method;
  updateAutoCheckUI(cfg);
  applyAutoCheckTimer(cfg);
}

function updateAutoCheckUI(cfg) {
  // Toggle visual
  const chk = document.getElementById('autoCheckEnabled');
  const tog = document.getElementById('autoCheckToggle');
  if(tog) {
    tog.style.background = cfg.enabled ? 'var(--accent)' : '#ccc';
    // Move knob
    const before = document.createElement('style');
    before.id = 'tog-style';
    document.getElementById('tog-style')?.remove();
    before.textContent = `#autoCheckToggle::before{transform:translateX(${cfg.enabled?20:0}px)}`;
    document.head.appendChild(before);
  }
  // Method info
  onAutoCheckMethodChange();
  // Last run
  const lrEl = document.getElementById('autoCheckLastRun');
  if(lrEl) {
    if(cfg.lastRun) {
      const d = new Date(cfg.lastRun);
      lrEl.textContent = `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})} — ${cfg.lastRunCount||0} transação(ões) registrada(s)`;
    } else {
      lrEl.textContent = 'Nunca executada';
    }
  }
}

function onAutoCheckMethodChange() {
  const method = document.getElementById('autoCheckMethod')?.value || 'browser';
  const infoEl = document.getElementById('autoCheckSupabaseInfo');
  const subEl  = document.getElementById('autoCheckMethodSub');
  const sqlEl  = document.getElementById('autoCheckSqlCode');

  const descriptions = {
    browser: 'O navegador executa a verificação periodicamente enquanto o app estiver aberto',
    supabase_cron: 'Supabase pg_cron — executa via banco de dados, mesmo com app fechado (requer extensão pg_cron)',
    supabase_edge: 'Supabase Edge Function — executa via função serverless, requer deploy manual',
  };
  if(subEl) subEl.textContent = descriptions[method] || '';

  if(infoEl) {
    infoEl.style.display = (method === 'browser') ? 'none' : '';
    if(method === 'supabase_cron' && sqlEl) {
      const intervalCfg = document.getElementById('autoCheckInterval')?.value || '60';
      const cronExpr = getCronExpression(parseInt(intervalCfg));
      sqlEl.textContent = getSupabaseCronSql(cronExpr);
    } else if(method === 'supabase_edge' && sqlEl) {
      sqlEl.textContent = getSupabaseEdgeSql();
    }
  }
}

function getCronExpression(minutes) {
  if(minutes < 60) return `*/${minutes} * * * *`;
  const hours = Math.floor(minutes/60);
  if(hours === 1) return '0 * * * *';
  if(hours < 24) return `0 */${hours} * * *`;
  return '0 8 * * *'; // daily at 8am
}

function getSupabaseCronSql(cronExpr) {
  return `-- Execute no SQL Editor do Supabase
-- Requer extensão pg_cron habilitada

-- 1. Habilitar extensão (se ainda não estiver)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Criar função que registra transações automáticas
CREATE OR REPLACE FUNCTION public.auto_register_scheduled_transactions()
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER := 0;
  v_sc RECORD;
  v_next_date DATE;
BEGIN
  -- Buscar todos os programados ativos com auto_register=true
  FOR v_sc IN
    SELECT st.*, a.id as acc_id
    FROM scheduled_transactions st
    JOIN accounts a ON a.id = st.account_id
    WHERE st.status = 'active'
      AND st.auto_register = true
  LOOP
    -- Calcular próximas datas até hoje
    v_next_date := v_sc.start_date;
    WHILE v_next_date <= CURRENT_DATE LOOP
      -- Verificar se já foi registrada
      IF NOT EXISTS (
        SELECT 1 FROM scheduled_occurrences
        WHERE scheduled_id = v_sc.id
          AND scheduled_date = v_next_date
          AND transaction_id IS NOT NULL
      ) THEN
        -- Registrar a transação
        INSERT INTO transactions (
          account_id, description, amount, date,
          category_id, payee_id, memo, is_transfer
        ) VALUES (
          v_sc.account_id, v_sc.description, v_sc.amount, v_next_date,
          v_sc.category_id, v_sc.payee_id, v_sc.memo, false
        );

        -- Marcar ocorrência como registrada
        INSERT INTO scheduled_occurrences
          (scheduled_id, scheduled_date, actual_date, amount, transaction_id)
        VALUES (
          v_sc.id, v_next_date, CURRENT_DATE, v_sc.amount,
          (SELECT id FROM transactions WHERE account_id=v_sc.account_id
           AND date=v_next_date AND description=v_sc.description
           ORDER BY created_at DESC LIMIT 1)
        );

        -- Atualizar saldo da conta
        UPDATE accounts SET balance = balance + v_sc.amount
        WHERE id = v_sc.account_id;

        v_count := v_count + 1;
      END IF;

      -- Calcular próxima data baseada na frequência
      v_next_date := CASE v_sc.frequency
        WHEN 'once'       THEN v_next_date + INTERVAL '99 years'
        WHEN 'weekly'     THEN v_next_date + INTERVAL '7 days'
        WHEN 'biweekly'   THEN v_next_date + INTERVAL '14 days'
        WHEN 'monthly'    THEN v_next_date + INTERVAL '1 month'
        WHEN 'bimonthly'  THEN v_next_date + INTERVAL '2 months'
        WHEN 'quarterly'  THEN v_next_date + INTERVAL '3 months'
        WHEN 'semiannual' THEN v_next_date + INTERVAL '6 months'
        WHEN 'annual'     THEN v_next_date + INTERVAL '1 year'
        ELSE v_next_date + INTERVAL '99 years'
      END;
    END LOOP;
  END LOOP;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- 3. Agendar execução com pg_cron
SELECT cron.schedule(
  'fintrack-auto-register',  -- nome do job
  '${cronExpr}',             -- expressão cron
  $$SELECT public.auto_register_scheduled_transactions()$$
);

-- 4. Verificar jobs agendados:
-- SELECT * FROM cron.job;

-- 5. Para remover o job:
-- SELECT cron.unschedule('fintrack-auto-register');`;
}

function getSupabaseEdgeSql() {
  return `/* Deploy esta Edge Function no Supabase:
supabase functions new auto-register
supabase functions deploy auto-register

Arquivo: supabase/functions/auto-register/index.ts */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std/http/server.ts'

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  const { data, error } = await supabase.rpc('auto_register_scheduled_transactions')
  return new Response(JSON.stringify({ registered: data, error }), {
    headers: { 'Content-Type': 'application/json' }
  })
})

/* Após deploy, configure um webhook/cron externo para chamar:
POST https://<project>.supabase.co/functions/v1/auto-register
Authorization: Bearer <anon-key> */`;
}

function copyAutoCheckSql() {
  const el = document.getElementById('autoCheckSqlCode');
  if(!el) return;
  navigator.clipboard.writeText(el.textContent).then(() => toast('SQL copiado!', 'success'));
}

function applyAutoCheckTimer(cfg) {
  // Clear existing timer
  if(_autoCheckTimer) { clearInterval(_autoCheckTimer); _autoCheckTimer = null; }
  if(cfg.enabled && cfg.method === 'browser') {
    const ms = (cfg.intervalMinutes||60) * 60 * 1000;
    _autoCheckTimer = setInterval(() => runAutoRegister(false), ms);
    console.log(`[AutoCheck] Timer set: every ${cfg.intervalMinutes} min`);
  }
}

/* ── Main auto-register runner ── */
async function runAutoRegister(manual=false) {
  const cfg = getAutoCheckConfig();
  if(!manual && !cfg.enabled) return;

  if(manual) toast('🔄 Verificando transações programadas...', 'info');

  try {
    if (typeof runScheduledAutoRegister === 'function') {
      const totalRegistered = await runScheduledAutoRegister();
      await runScheduledUpcomingNotifications();
      updateLastRunConfig(totalRegistered || 0);
      if(manual) {
        if(totalRegistered) toast(`✓ ${totalRegistered} transação(ões) programada(s) registrada(s)`, 'success');
        else toast('Nenhuma transação pendente para registrar', 'info');
      }
      return totalRegistered || 0;
    }

    if(manual) toast('Motor de programados não disponível no momento.', 'warning');
    updateLastRunConfig(0);
    return 0;
  } catch(err) {
    console.error('[AutoReg] Error:', err);
    if(manual) toast('Erro ao verificar programados: ' + (err.message || err), 'error');
    updateLastRunConfig(0);
    return 0;
  }
}

function updateLastRunConfig(count) {
  const cfg = getAutoCheckConfig();
  cfg.lastRun = new Date().toISOString();
  cfg.lastRunCount = count;
  localStorage.setItem(AUTO_CHECK_CONFIG_KEY, JSON.stringify(cfg));
  saveAppSetting(AUTO_CHECK_CONFIG_KEY, cfg).catch(()=>{});
  updateAutoCheckUI(cfg);
}

/* ── Calculate upcoming dates for a scheduled transaction ── */
function getScheduledDates(sc, upToCutoff) {
  const dates = [];
  if(!sc.start_date) return dates;
  let cur = sc.start_date;
  const maxIter = 500;
  let iter = 0;
  while(cur <= upToCutoff && iter++ < maxIter) {
    dates.push(cur);
    if(sc.frequency === 'once') break;
    cur = nextScheduledDate(cur, sc);
    if(!cur) break;
    // Check end conditions
    if(sc.end_date && cur > sc.end_date) break;
    if(sc.end_count && dates.length >= sc.end_count) break;
  }
  return dates;
}

function nextScheduledDate(dateStr, sc) {
  const d = new Date(dateStr + 'T12:00:00');
  switch(sc.frequency) {
    case 'weekly':     d.setDate(d.getDate()+7); break;
    case 'biweekly':   d.setDate(d.getDate()+14); break;
    case 'monthly':    d.setMonth(d.getMonth()+1); break;
    case 'bimonthly':  d.setMonth(d.getMonth()+2); break;
    case 'quarterly':  d.setMonth(d.getMonth()+3); break;
    case 'semiannual': d.setMonth(d.getMonth()+6); break;
    case 'annual':     d.setFullYear(d.getFullYear()+1); break;
    case 'custom': {
      const n = sc.custom_interval||1;
      const u = sc.custom_unit||'months';
      if(u==='days')   d.setDate(d.getDate()+n);
      else if(u==='weeks')  d.setDate(d.getDate()+7*n);
      else if(u==='months') d.setMonth(d.getMonth()+n);
      else if(u==='years')  d.setFullYear(d.getFullYear()+n);
      break;
    }
    default: return null;
  }
  return d.toISOString().slice(0,10);
}


/* ── Channel Notifications ── */
function _normalizeWhatsappNumber(raw) {
  const digits = String(raw || '').replace(/\D+/g, '');
  return digits || null;
}

async function invokeScheduledWhatsapp(payload) {
  if (!sb?.functions?.invoke) throw new Error('Supabase Edge Functions não disponíveis nesta sessão.');
  const { data, error } = await sb.functions.invoke('send-scheduled-whatsapp', { body: payload });
  if (error) throw error;
  return data || null;
}

async function sendScheduledWhatsappNotification(sc, date, amount, mode) {
  const number = _normalizeWhatsappNumber(sc?.notify_whatsapp_number || currentUser?.whatsapp_number);
  if (!number) return null;
  const payload = {
    scheduled_id: sc.id,
    occurrence_date: date,
    notification_type: mode === 'upcoming' ? 'upcoming' : 'processed',
    recipient: number,
    amount: amount,
    lang: sc?.notify_whatsapp_lang || 'pt_BR',
    template_name: mode === 'upcoming'
      ? (sc?.notify_whatsapp_template || 'scheduled_upcoming')
      : 'scheduled_processed',
  };
  try {
    return await invokeScheduledWhatsapp(payload);
  } catch (e) {
    console.warn('[AutoReg] WhatsApp error:', e?.message || e);
    return null;
  }
}

async function invokeScheduledTelegram(payload) {
  const chatId  = payload?.chat_id || '';
  const message = payload?.message || '';
  if (!chatId) throw new Error('chat_id ausente no payload do Telegram');
  // Use the same Edge Function + direct API fallback
  return await _sendTelegramWithFallback(chatId, message, payload);
}

async function sendScheduledTelegramNotification(sc, date, amount, mode) {
  const chatId = String(sc?.notify_telegram_chat_id || currentUser?.telegram_chat_id || '').trim();
  if (!chatId) return null;
  const amountLabel = typeof fmtBRL === 'function' ? fmtBRL(Math.abs(Number(amount || sc?.amount || 0))) : String(amount || sc?.amount || 0);
  const title = mode === 'upcoming' ? '📅 Lembrete FinTrack' : '✅ FinTrack registrou';
  const message = `${title}
${sc?.description || 'Transação programada'}
Data: ${date}
Valor: ${amountLabel}`;
  const payload = {
    scheduled_id: sc.id,
    occurrence_date: date,
    notification_type: mode === 'upcoming' ? 'upcoming' : 'processed',
    chat_id: chatId,
    message,
    amount
  };
  try {
    return await invokeScheduledTelegram(payload);
  } catch (e) {
    console.warn('[AutoReg] Telegram error:', e?.message || e);
    return null;
  }
}

async function runScheduledUpcomingNotifications() {
  try {
    if (!state.scheduled || !state.scheduled.length) return 0;
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    let sent = 0;
    for (const sc of state.scheduled) {
      if (sc.status !== 'active') continue;
      const upcomingWhatsappEnabled = !!(sc.notify_whatsapp && sc.notify_whatsapp_on_upcoming);
      const upcomingTelegramEnabled = !!(sc.notify_telegram && sc.notify_telegram_on_upcoming);
      const emailEnabled = !!sc.notify_email;
      if (!upcomingWhatsappEnabled && !upcomingTelegramEnabled && !emailEnabled) continue;
      const daysBefore = Math.max(
        Math.max(0, parseInt(sc.notify_whatsapp_days_before ?? sc.notify_days_before ?? 0, 10) || 0),
        Math.max(0, parseInt(sc.notify_telegram_days_before ?? sc.notify_days_before ?? 0, 10) || 0),
        Math.max(0, parseInt(sc.notify_days_before ?? 0, 10) || 0)
      );
      const cutoff = new Date(today.getTime() + daysBefore * 86400000).toISOString().slice(0,10);
      const occDates = getScheduledDates(sc, cutoff);
      for (const d of occDates) {
        if (d < todayStr) continue;
        const diffDays = Math.round((new Date(d + 'T00:00:00') - new Date(todayStr + 'T00:00:00')) / 86400000);
        if (diffDays !== daysBefore) continue;
        if (emailEnabled) {
          const cfg = getAutoCheckConfig ? getAutoCheckConfig() : {};
          const emailTo = sc.notify_email_addr || currentUser?.email || cfg.emailDefault;
          if (emailTo) await sendUpcomingNotification(sc, d, emailTo, daysBefore);
        }
        if (upcomingWhatsappEnabled) {
          const waLead = Math.max(0, parseInt(sc.notify_whatsapp_days_before ?? sc.notify_days_before ?? 0, 10) || 0);
          if (diffDays === waLead) {
            await sendScheduledWhatsappNotification(sc, d, sc.amount, 'upcoming');
            sent++;
          }
        }
        if (upcomingTelegramEnabled) {
          const tgLead = Math.max(0, parseInt(sc.notify_telegram_days_before ?? sc.notify_days_before ?? 0, 10) || 0);
          if (diffDays === tgLead) {
            await sendScheduledTelegramNotification(sc, d, sc.amount, 'upcoming');
            sent++;
          }
        }
      }
    }
    return sent;
  } catch (e) {
    console.warn('[AutoReg] upcoming notifications error:', e?.message || e);
    return 0;
  }
}

/* ── Email Notifications ── */
function _ejMonthYear(dateStr) {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  } catch { return dateStr; }
}

function _ejEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function buildScheduledEmailReportContent(sc, dateStr, amount, mode, daysBefore) {
  const desc = _ejEsc(sc.description || '');
  const type = _ejEsc(sc.type || '');
  const status = mode === 'upcoming' ? 'scheduled' : 'processed';
  const acc = _ejEsc(sc.accounts?.name || '-');
  const toAcc = _ejEsc(sc.transfer_to_account_name || '-');
  const cat = _ejEsc(sc.categories?.name || '-');
  const payee = _ejEsc(sc.payees?.name || '-');
  const cur = _ejEsc(sc.accounts?.currency || sc.currency || 'BRL');
  const amt = _ejEsc(fmt(Math.abs(amount)));
  const when = _ejEsc(fmtDate(dateStr));
  const hint = mode === 'upcoming'
    ? `Será processada ${daysBefore > 0 ? `em ${daysBefore} dia(s)` : 'hoje'}.`
    : 'Foi processada automaticamente.';

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f5f7fb;padding:14px">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e6e8f0;border-radius:12px;padding:16px">
      <div style="font-size:14px;color:#6b7280;margin-bottom:6px">${_ejEsc(hint)}</div>
      <div style="font-size:16px;font-weight:700;color:#111827;margin-bottom:2px">${desc}</div>
      <div style="font-size:22px;font-weight:800;color:#0f766e;margin-bottom:10px">${amt} <span style="font-size:12px;color:#6b7280;font-weight:700">${cur}</span></div>

      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;color:#374151">
        <tr><td style="padding:6px 0;color:#6b7280;width:38%">Data</td><td style="padding:6px 0;font-weight:600">${when}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Tipo</td><td style="padding:6px 0;font-weight:600">${type}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Conta</td><td style="padding:6px 0;font-weight:600">${acc}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Conta destino</td><td style="padding:6px 0;font-weight:600">${toAcc}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Categoria</td><td style="padding:6px 0;font-weight:600">${cat}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Beneficiário</td><td style="padding:6px 0;font-weight:600">${payee}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Status</td><td style="padding:6px 0;font-weight:600">${_ejEsc(status)}</td></tr>
      </table>
    </div>
  </div>`;
}

async function sendScheduledNotification(sc, date, amount, emailTo) {
  const tplId = EMAILJS_CONFIG.scheduledTemplateId || EMAILJS_CONFIG.templateId;
  if(!EMAILJS_CONFIG.serviceId || !EMAILJS_CONFIG.publicKey || !tplId) return;
  try {
    emailjs.init(EMAILJS_CONFIG.publicKey);
    const month_year = _ejMonthYear(date);
    await emailjs.send(EMAILJS_CONFIG.serviceId, tplId, {
      to_email:       emailTo,
      report_subject: `[Family FinTrack] Transação executada: ${sc.description || 'Transação programada'}`,
      Subject:        `[Family FinTrack] Transação executada: ${sc.description || 'Transação programada'}`,
      month_year,
      report_content: buildScheduledEmailReportContent(sc, date, amount, 'processed', 0),
    });
  } catch(e) { console.warn('[AutoReg] Email error:', e.message); }
}

async function sendUpcomingNotification(sc, date, emailTo, daysBefore) {
  const tplId = EMAILJS_CONFIG.scheduledTemplateId || EMAILJS_CONFIG.templateId;
  if(!EMAILJS_CONFIG.serviceId || !EMAILJS_CONFIG.publicKey || !tplId) return;
  // Check if already sent (use localStorage to avoid duplicates)
  const sentKey = `notified_${sc.id}_${date}`;
  if(localStorage.getItem(sentKey)) return;
  try {
    emailjs.init(EMAILJS_CONFIG.publicKey);
    const month_year = _ejMonthYear(date);
    await emailjs.send(EMAILJS_CONFIG.serviceId, tplId, {
      to_email:       emailTo,
      report_subject: `[Family FinTrack] Lembrete: ${sc.description || 'Transação programada'}`,
      Subject:        `[Family FinTrack] Lembrete: ${sc.description || 'Transação programada'}`,
      month_year,
      report_content: buildScheduledEmailReportContent(sc, date, sc.amount, 'upcoming', daysBefore || 0),
    });
    localStorage.setItem(sentKey, '1');
  } catch(e) { console.warn('[AutoReg] Upcoming email error:', e.message); }
}

/* AUTO_REGISTER_SQL declared in autocheck.js */


function showAuthMigration() {
  const sql = `-- FinTrack: Multi-User Auth Migration
-- Execute no Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.app_users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user','viewer')),
  active          BOOLEAN NOT NULL DEFAULT false,
  approved        BOOLEAN NOT NULL DEFAULT false,
  must_change_pwd BOOLEAN NOT NULL DEFAULT false,
  can_view        BOOLEAN NOT NULL DEFAULT true,
  can_create      BOOLEAN NOT NULL DEFAULT true,
  can_edit        BOOLEAN NOT NULL DEFAULT true,
  can_delete      BOOLEAN NOT NULL DEFAULT false,
  can_export      BOOLEAN NOT NULL DEFAULT true,
  can_import      BOOLEAN NOT NULL DEFAULT false,
  can_admin       BOOLEAN NOT NULL DEFAULT false,
  last_login      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES public.app_users(id)
);

CREATE TABLE IF NOT EXISTS public.app_sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_users_email    ON public.app_users(email);
CREATE INDEX IF NOT EXISTS idx_app_sessions_token ON public.app_sessions(token);

ALTER TABLE public.app_users    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_app_users"    ON public.app_users;
DROP POLICY IF EXISTS "allow_all_app_sessions" ON public.app_sessions;

CREATE POLICY "allow_all_app_users"
  ON public.app_users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_app_sessions"
  ON public.app_sessions FOR ALL USING (true) WITH CHECK (true);

-- Admin master inicial (senha será definida no primeiro login)
INSERT INTO public.app_users (
  email, name, password_hash, role,
  active, approved, must_change_pwd,
  can_view, can_create, can_edit, can_delete,
  can_export, can_import, can_admin
) VALUES (
  'deciofranchini@gmail.com', 'Décio Franchini',
  'placeholder_will_be_set_on_first_login', 'admin',
  true, true, true,
  true, true, true, true, true, true, true
) ON CONFLICT (email) DO NOTHING;`;
  const modal = document.getElementById('migrationModal') || createMigrationModal();
  document.getElementById('migrationTitle').textContent = 'SQL: Migração Multi-Usuário';
  document.getElementById('migrationCode').textContent = sql;
  openModal('migrationModal');
}

function showAutoRegisterMigration() {
  const sql = AUTO_REGISTER_SQL || `
-- Add auto-register columns to scheduled_transactions
ALTER TABLE scheduled_transactions
  ADD COLUMN IF NOT EXISTS auto_register      BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_email       BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_email_addr  TEXT,
  ADD COLUMN IF NOT EXISTS notify_days_before INTEGER DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_scheduled_auto_register
  ON scheduled_transactions(status, auto_register)
  WHERE auto_register = true AND status = 'active';`;

  const overlay = document.createElement('div');
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML = `<div style="background:var(--surface);border-radius:var(--r);padding:24px;max-width:700px;width:100%;max-height:80vh;overflow-y:auto">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <span style="font-family:var(--font-serif);font-size:1.1rem;font-weight:500">📋 SQL: Migração Auto-Registro</span>
      <button onclick="this.closest('[style]').remove()" style="border:none;background:none;cursor:pointer;font-size:1.2rem;color:var(--muted)">✕</button>
    </div>
    <p style="font-size:.82rem;color:var(--muted);margin-bottom:12px">Execute este SQL no <strong>Editor SQL do Supabase</strong> para adicionar suporte a registro automático e notificações nas transações programadas.</p>
    <pre style="font-size:.72rem;background:var(--bg2);padding:16px;border-radius:var(--r-sm);overflow-x:auto;color:var(--text1);border:1px solid var(--border);white-space:pre-wrap;word-break:break-all;max-height:400px;overflow-y:auto">${sql.trim()}</pre>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
      <button class="btn btn-ghost" onclick="navigator.clipboard.writeText(document.querySelector('[style*=pre]~pre')?.textContent||'').then(()=>toast('SQL copiado!','success'))">📋 Copiar</button>
      <button class="btn btn-primary" onclick="this.closest('[style]').remove()">Fechar</button>
    </div>
  </div>`;
  // Fix: use the actual sql variable
  overlay.querySelector('pre').textContent = sql.trim();
  overlay.querySelector('button[onclick*=clipboard]').onclick = () => {
    navigator.clipboard.writeText(sql.trim()).then(()=>toast('SQL copiado!','success'));
  };
  overlay.onclick = e => { if(e.target===overlay) overlay.remove(); };
  document.body.appendChild(overlay);
}



/* ── Telegram Bot Token helpers ───────────────────────────────────────────── */
// Chave única usada em TODOS os lugares — localStorage + getAppSetting/saveAppSetting
const _TG_BOT_KEY = 'telegram_bot_token';
// Chave legada (antes do fix) — migrada automaticamente na primeira leitura
const _TG_BOT_KEY_LEGACY = 'fintrack_telegram_bot_token';

function getTelegramBotToken() {
  try {
    // Lê chave principal
    let t = (localStorage.getItem(_TG_BOT_KEY) || '').trim();
    if (t) return t;
    // Migração automática da chave legada
    t = (localStorage.getItem(_TG_BOT_KEY_LEGACY) || '').trim();
    if (t) {
      try { localStorage.setItem(_TG_BOT_KEY, t); localStorage.removeItem(_TG_BOT_KEY_LEGACY); } catch {}
    }
    return t;
  } catch { return ''; }
}

async function ensureTelegramBotToken() {
  // 1 — localStorage (mais rápido, sem rede)
  let token = getTelegramBotToken();
  if (token) return token;

  // 2 — Banco Supabase (app_settings) — query direta, não usa getAppSetting() que só lê cache
  try {
    if (sb) {
      const { data } = await sb
        .from('app_settings')
        .select('value')
        .eq('key', _TG_BOT_KEY)
        .maybeSingle();
      token = String(data?.value || '').trim();
      if (token) {
        try { localStorage.setItem(_TG_BOT_KEY, token); } catch {}
        return token;
      }
    }
  } catch (e) {
    console.warn('[Telegram] Erro ao buscar token do banco:', e?.message || e);
  }

  return '';
}

/** Send via direct Telegram Bot API — no Edge Function needed */
async function _sendTelegramDirect(chatId, text, tokenOverride) {
  // tokenOverride allows the settings test to pass the token from the input
  // field directly, bypassing localStorage (which may be stale or empty)
  const token = tokenOverride || await ensureTelegramBotToken();
  if (!token) throw new Error('Bot token não configurado em Configurações → Conexão');
  const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
  const json = await resp.json();
  if (!json.ok) throw new Error(`Telegram API: ${json.description || 'erro desconhecido'} (code ${json.error_code})`);
  return json;
}

/** Try Edge Function first; fall back to direct API */
async function _sendTelegramWithFallback(chatId, message, extraBody = {}) {
  // Resolve token first — if we have it locally, prefer direct API (faster, no Edge Function needed)
  const localToken = await ensureTelegramBotToken();

  // 1 — Direct API if we have a local token (most reliable path)
  if (localToken) {
    try {
      const result = await _sendTelegramDirect(chatId, message, localToken);
      console.info('[Telegram] Direct API OK (local token)');
      return result;
    } catch (directErr) {
      console.warn('[Telegram] Direct API falhou:', directErr.message);
      // Fall through to Edge Function as last resort
    }
  }

  // 2 — Edge Function (bot token configured as Supabase secret server-side)
  try {
    if (sb && typeof sb.functions?.invoke === 'function') {
      const { data, error } = await sb.functions.invoke('send-scheduled-telegram', {
        body: { chat_id: chatId, message, ...extraBody },
      });
      if (error) throw new Error(error.message || JSON.stringify(error));
      console.info('[Telegram] Edge Function OK');
      return data;
    }
  } catch (efErr) {
    console.warn('[Telegram] Edge Function falhou:', efErr.message);
  }

  // 3 — Both failed
  throw new Error(
    localToken
      ? 'Telegram API: token inválido ou chat_id incorreto. Verifique o token em Configurações → Conexão.'
      : 'Bot token não encontrado. Configure em Configurações → Conexão e clique Salvar.'
  );
}

// ── Settings UI helpers (called from index.html) ──────────────────────────

window.saveTelegramBotToken = async function() {
  const input   = document.getElementById('telegramBotTokenInput');
  const statusEl = document.getElementById('tgBotStatus');
  const dot      = document.getElementById('tgBotStatusDot');
  const token    = (input?.value || '').trim();

  if (!token) {
    try { localStorage.removeItem(_TG_BOT_KEY); localStorage.removeItem(_TG_BOT_KEY_LEGACY); } catch {}
    try {
      if (sb) await sb.from('app_settings').delete().eq('key', _TG_BOT_KEY);
    } catch {}
    if (dot) dot.style.background = '#d1d5db';
    if (statusEl) { statusEl.style.color = 'var(--muted)'; statusEl.textContent = 'Token removido.'; }
    if (document.getElementById('tgBotTestBtn')) document.getElementById('tgBotTestBtn').style.display = 'none';
    return;
  }

  // Validate token format: must be digits:alphanumeric (e.g. 123456789:ABC-DEF...)
  // iOS Safari ignores autocomplete="off" on password fields and may inject a saved password
  const validFormat = /^\d{8,12}:[A-Za-z0-9_-]{30,50}$/.test(token);
  if (!validFormat) {
    if (dot) dot.style.background = '#f59e0b';
    if (statusEl) {
      statusEl.style.color = 'var(--danger)';
      statusEl.textContent = '⚠️ Formato inválido. O token do BotFather tem o formato: 123456789:ABC-DEFxyz… Verifique se o browser não preencheu automaticamente com outra senha.';
    }
    toast('⚠️ Token com formato inválido — cole o token correto do @BotFather', 'error');
    return; // Don't save invalid token
  }

  try { localStorage.setItem(_TG_BOT_KEY, token); } catch {}
  // Salva diretamente no Supabase (não usa saveAppSetting que só faz upsert local)
  try {
    if (sb) {
      await sb.from('app_settings').upsert({ key: _TG_BOT_KEY, value: token }, { onConflict: 'key' });
    }
  } catch(e) {
    console.warn('[Telegram] Erro ao salvar token no DB:', e?.message);
    // Continua — localStorage ainda funciona para a sessão atual
  }

  if (dot) dot.style.background = '#22c55e';
  if (statusEl) { statusEl.style.color = 'var(--green)'; statusEl.textContent = '✅ Token salvo! Informe o Chat ID abaixo e clique Testar.'; }
  // Show the test row with chat-id field
  const testRow = document.getElementById('tgBotTestRow');
  if (testRow) testRow.style.display = 'flex';
  // Pre-fill chat id from currentUser if available
  const chatIdInput = document.getElementById('tgBotTestChatId');
  if (chatIdInput && !chatIdInput.value) {
    const knownChatId = String(currentUser?.telegram_chat_id || '').trim();
    if (knownChatId) {
      chatIdInput.value = knownChatId;
      if (document.getElementById('tgBotTestBtn')) document.getElementById('tgBotTestBtn').style.display = '';
    }
  }
  toast('Token do Telegram salvo', 'success');
};

window.testTelegramBotToken = async function() {
  // Read token directly from the input field (not from localStorage which may be stale)
  const tokenInput = document.getElementById('telegramBotTokenInput');
  const token = (tokenInput?.value || getTelegramBotToken()).trim();

  // Priority for chat_id: dedicated settings field → profile modal field → currentUser
  const chatId = String(
    document.getElementById('tgBotTestChatId')?.value ||
    document.getElementById('myProfileTelegramChatId')?.value ||
    currentUser?.telegram_chat_id || ''
  ).trim();

  const statusEl = document.getElementById('tgBotStatus');
  const btn = document.getElementById('tgBotTestBtn');

  if (!token) {
    toast('Informe e salve o Bot Token primeiro', 'error');
    if (statusEl) { statusEl.style.color = 'var(--danger)'; statusEl.textContent = '⚠️ Token não encontrado. Digite o token e clique Salvar.'; }
    return;
  }
  if (!chatId) {
    toast('Informe o Chat ID no campo acima para testar', 'error');
    if (statusEl) { statusEl.style.color = 'var(--danger)'; statusEl.textContent = '⚠️ Informe o Chat ID no campo acima.'; }
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  try {
    // Pass token directly — bypasses localStorage to avoid stale/wrong value
    await _sendTelegramDirect(chatId,
      '✅ <b>FinTrack</b> — Teste de notificação Telegram!\nSe recebeu, as notificações estão funcionando corretamente.',
      token);
    if (statusEl) { statusEl.style.color = 'var(--green)'; statusEl.textContent = '✅ Mensagem enviada com sucesso para o Chat ID ' + chatId + '!'; }
    toast('✅ Telegram OK!', 'success');
  } catch (e) {
    if (statusEl) { statusEl.style.color = 'var(--danger)'; statusEl.textContent = '❌ ' + e.message; }
    toast('Erro Telegram: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🧪 Testar'; }
  }
};

window._tgBotTokenOnInput = function() {
  const dot    = document.getElementById('tgBotStatusDot');
  const input  = document.getElementById('telegramBotTokenInput');
  const testRow = document.getElementById('tgBotTestRow');
  const testBtn = document.getElementById('tgBotTestBtn');
  if (dot) dot.style.background = input?.value?.trim() ? '#f59e0b' : '#d1d5db';
  // Hide test button until token is saved — user must press Salvar first
  if (testBtn) testBtn.style.display = 'none';
  // But keep the test row visible if it was already showing
};

window._tgBotChatIdOnInput = function() {
  const chatIdInput = document.getElementById('tgBotTestChatId');
  const testBtn = document.getElementById('tgBotTestBtn');
  if (testBtn) testBtn.style.display = chatIdInput?.value?.trim() ? '' : 'none';
};

window.loadTelegramBotTokenUI = async function() {
  const input   = document.getElementById('telegramBotTokenInput');
  const dot     = document.getElementById('tgBotStatusDot');
  const testRow = document.getElementById('tgBotTestRow');
  const testBtn = document.getElementById('tgBotTestBtn');
  const chatIdInput = document.getElementById('tgBotTestChatId');
  if (!input) return;

  // ensureTelegramBotToken: lê localStorage → fallback Supabase DB
  const token = await ensureTelegramBotToken();
  if (token) {
    input.value = token;
    if (dot) dot.style.background = '#22c55e';
    if (testRow) testRow.style.display = 'flex';
    // Pre-fill Chat ID from currentUser if available
    if (chatIdInput && !chatIdInput.value) {
      const knownChatId = String(currentUser?.telegram_chat_id || '').trim();
      if (knownChatId) {
        chatIdInput.value = knownChatId;
        if (testBtn) testBtn.style.display = '';
      }
    }
  }
};

/* ── Notify on manual/auto transaction ────────────────────────────────────── */
async function notifyOnTransaction(tx, sc = null) {
  try {
    // Use currentUser but refresh notify flags from DB to avoid stale cache
    let user = typeof currentUser !== 'undefined' ? currentUser : null;
    if (!user) return;

    // Quick refresh of notification prefs from DB (non-blocking, best-effort)
    try {
      if (sb && user.id) {
        const { data: freshUser } = await sb
          .from('app_users')
          .select('notify_on_tx,notify_tx_email,notify_tx_wa,notify_tx_tg,telegram_chat_id,whatsapp_number,email')
          .eq('id', user.id)
          .single();
        if (freshUser) {
          user = { ...user, ...freshUser };
          if (typeof currentUser !== 'undefined' && currentUser) {
            currentUser.notify_on_tx     = freshUser.notify_on_tx;
            currentUser.notify_tx_email  = freshUser.notify_tx_email;
            currentUser.notify_tx_wa     = freshUser.notify_tx_wa;
            currentUser.notify_tx_tg     = freshUser.notify_tx_tg;
            currentUser.telegram_chat_id = freshUser.telegram_chat_id || currentUser.telegram_chat_id;
            currentUser.whatsapp_number  = freshUser.whatsapp_number  || currentUser.whatsapp_number;
          }
        }
      }
    } catch(refreshErr) {
      console.debug('[notifyTx] could not refresh user prefs:', refreshErr?.message);
    }

    if (!user?.notify_on_tx) return;

    // ── Buscar transação completa com joins para ter todos os nomes ──
    let fullTx = tx;
    if (tx?.id && sb) {
      try {
        const { data: fetched } = await sb
          .from('transactions')
          .select(`
            id, description, amount, currency, brl_amount, date, memo, status,
            is_transfer, is_card_payment, tags, check_number, balance_after,
            accounts:account_id(name, currency, icon),
            payees:payee_id(name),
            categories:category_id(name, icon, color),
            transfer_to:transfer_to_account_id(name),
            family_members_data:family_member_id(name, avatar_emoji)
          `)
          .eq('id', tx.id)
          .single();
        if (fetched) fullTx = { ...tx, ...fetched };
      } catch(e) {
        console.debug('[notifyTx] could not fetch full tx, using partial data:', e?.message);
      }
    }

    // ── Resolver nomes com fallback para state ──
    const desc     = fullTx?.description || sc?.description || 'Transação';
    const amount   = fullTx?.amount ?? 0;
    const currency = (fullTx?.currency || 'BRL').toUpperCase();
    const brl      = fullTx?.brl_amount;
    const date     = typeof fmtDate === 'function'
      ? fmtDate(fullTx?.date || new Date().toISOString().slice(0,10))
      : (fullTx?.date || '');
    const status   = (fullTx?.status || 'confirmed') === 'pending' ? '⏳ Pendente' : '✅ Confirmada';
    const memo     = fullTx?.memo || '';
    const tags     = Array.isArray(fullTx?.tags) ? fullTx.tags.join(', ') : (fullTx?.tags || '');
    const checkNum = fullTx?.check_number || '';
    const isTransfer    = !!(fullTx?.is_transfer);
    const isCardPayment = !!(fullTx?.is_card_payment);

    // Nomes resolvidos: joins > state > vazio
    const accName  = fullTx?.accounts?.name
      || (state?.accounts || []).find(a => a.id === fullTx?.account_id)?.name || '';
    const accIcon  = fullTx?.accounts?.icon || '🏦';
    const toAccName = fullTx?.transfer_to?.name
      || (state?.accounts || []).find(a => a.id === fullTx?.transfer_to_account_id)?.name || '';
    const payeeName = fullTx?.payees?.name
      || (state?.payees || []).find(p => p.id === fullTx?.payee_id)?.name || '';
    const catName   = fullTx?.categories?.name
      || (state?.categories || []).find(c => c.id === fullTx?.category_id)?.name || '';
    const catIcon   = fullTx?.categories?.icon || '';
    const memberName = fullTx?.family_members_data?.name || '';
    const memberEmoji = fullTx?.family_members_data?.avatar_emoji || '';

    // ── Tipo e sinal ──
    let typeEmoji, typeLabel;
    if (isCardPayment)       { typeEmoji = '💳'; typeLabel = 'Pgto. Cartão'; }
    else if (isTransfer)     { typeEmoji = '🔄'; typeLabel = 'Transferência'; }
    else if (amount >= 0)    { typeEmoji = '💰'; typeLabel = 'Receita'; }
    else                     { typeEmoji = '💸'; typeLabel = 'Despesa'; }

    const amtFmt = typeof fmt === 'function' ? fmt(Math.abs(amount), currency) : String(Math.abs(amount));
    const sign   = amount >= 0 && !isTransfer ? '+' : (isTransfer ? '' : '−');

    // ── Montar mensagem HTML para Telegram ──
    const lines = [
      `${typeEmoji} <b>${typeLabel}</b> — ${sign}${amtFmt}`,
      ...(currency !== 'BRL' && brl != null ? [`   <i>= ${typeof fmt === 'function' ? fmt(Math.abs(brl), 'BRL') : ''}  (BRL)</i>`] : []),
      ``,
      `📝 <b>${_tgEsc(desc)}</b>`,
      ...(memo        ? [`💬 ${_tgEsc(memo)}`] : []),
      ``,
      `📅 ${date}   ${status}`,
      ...(accName     ? [`🏦 ${_tgEsc(accName)}${isTransfer && toAccName ? ` → ${_tgEsc(toAccName)}` : ''}`] : []),
      ...(payeeName   ? [`👤 ${_tgEsc(payeeName)}`] : []),
      ...(catName     ? [`🏷️ ${catIcon ? catIcon + ' ' : ''}${_tgEsc(catName)}`] : []),
      ...(memberName  ? [`👨‍👩‍👧 ${memberEmoji ? memberEmoji + ' ' : ''}${_tgEsc(memberName)}`] : []),
      ...(tags        ? [`🔖 ${_tgEsc(tags)}`] : []),
      ...(checkNum    ? [`🔢 Cheque: ${_tgEsc(checkNum)}`] : []),
    ];
    const msg = `<b>FinTrack</b> · Nova Transação\n` + lines.join('\n');

    // Versão plain text para WhatsApp (sem tags HTML)
    const msgPlain = lines
      .map(l => l.replace(/<[^>]+>/g, ''))
      .join('\n')
      .trim();

    const promises = [];

    // Email
    if (user.notify_tx_email && user.email) {
      const tplId = (typeof EMAILJS_CONFIG !== 'undefined') ? (EMAILJS_CONFIG.scheduledTemplateId || EMAILJS_CONFIG.templateId) : null;
      if (tplId && EMAILJS_CONFIG.serviceId && EMAILJS_CONFIG.publicKey) {
        const htmlContent = `
          <div style="font-family:Arial,sans-serif;padding:16px;max-width:480px">
            <h3 style="margin:0 0 12px;color:#2a6049">${typeEmoji} ${typeLabel}: ${_tgEsc(desc)}</h3>
            <table style="width:100%;border-collapse:collapse;font-size:.9rem">
              <tr><td style="padding:5px 0;color:#666">Valor</td><td style="font-weight:700">${sign}${amtFmt}${currency !== 'BRL' && brl != null ? ` <small style="color:#888">(${typeof fmt === 'function' ? fmt(Math.abs(brl),'BRL') : ''})</small>` : ''}</td></tr>
              <tr><td style="padding:5px 0;color:#666">Data</td><td>${date}</td></tr>
              <tr><td style="padding:5px 0;color:#666">Status</td><td>${status}</td></tr>
              ${accName   ? `<tr><td style="padding:5px 0;color:#666">Conta</td><td>${_tgEsc(accName)}${isTransfer && toAccName ? ` → ${_tgEsc(toAccName)}` : ''}</td></tr>` : ''}
              ${payeeName ? `<tr><td style="padding:5px 0;color:#666">Beneficiário</td><td>${_tgEsc(payeeName)}</td></tr>` : ''}
              ${catName   ? `<tr><td style="padding:5px 0;color:#666">Categoria</td><td>${catIcon} ${_tgEsc(catName)}</td></tr>` : ''}
              ${memo      ? `<tr><td style="padding:5px 0;color:#666">Memo</td><td>${_tgEsc(memo)}</td></tr>` : ''}
              ${memberName? `<tr><td style="padding:5px 0;color:#666">Membro</td><td>${memberEmoji} ${_tgEsc(memberName)}</td></tr>` : ''}
              ${tags      ? `<tr><td style="padding:5px 0;color:#666">Tags</td><td>${_tgEsc(tags)}</td></tr>` : ''}
            </table>
          </div>`;
        promises.push(
          emailjs.send(EMAILJS_CONFIG.serviceId, tplId, {
            to_email:       user.email,
            report_subject: `[FinTrack] ${typeLabel}: ${desc}`,
            Subject:        `[FinTrack] ${typeLabel}: ${desc}`,
            month_year:     date,
            report_content: htmlContent,
          }).catch(e => console.warn('[notifyTx] email:', e.message))
        );
      }
    }

    // WhatsApp
    if (user.notify_tx_wa && user.whatsapp_number) {
      const number = String(user.whatsapp_number).replace(/\D+/g, '');
      if (number) {
        promises.push((async () => {
          try {
            const { error } = await sb.functions.invoke('send-scheduled-whatsapp', {
              body: { recipient: number, message: msgPlain, notification_type: 'tx_registered', amount: tx?.amount, lang: 'pt_BR' }
            });
            if (error) console.warn('[notifyTx] whatsapp error:', error.message || error);
          } catch(e) { console.warn('[notifyTx] whatsapp:', e.message); }
        })());
      }
    }

    // Telegram
    if (user.notify_tx_tg) {
      const chatId = String(user.telegram_chat_id || '').trim();
      if (chatId) {
        promises.push((async () => {
          try {
            await _sendTelegramWithFallback(chatId, msg, { notification_type: 'tx_registered', amount: tx?.amount });
            console.info('[notifyTx] telegram OK → chatId', chatId);
          } catch(e) {
            console.warn('[notifyTx] telegram failed:', e.message);
            if (state?.currentPage === 'transactions') {
              toast('⚠️ Notificação Telegram: ' + e.message, 'warning');
            }
          }
        })());
      } else {
        console.warn('[notifyTx] notify_tx_tg=true mas telegram_chat_id está vazio. Configure no perfil.');
      }
    }

    if (promises.length) await Promise.allSettled(promises);
  } catch(e) {
    console.warn('[notifyOnTransaction]', e.message);
  }
}

/** Escapa caracteres especiais para mensagens HTML do Telegram */
function _tgEsc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
window.notifyOnTransaction = notifyOnTransaction;

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

// ── Cross-module exports: scheduled.js calls these by typeof check ─────────
window.sendScheduledWhatsappNotification = sendScheduledWhatsappNotification;
window.sendScheduledTelegramNotification = sendScheduledTelegramNotification;
window.sendScheduledNotification         = typeof sendScheduledNotification === 'function'
  ? sendScheduledNotification : (window.sendScheduledNotification || null);
window.runScheduledUpcomingNotifications = runScheduledUpcomingNotifications;
