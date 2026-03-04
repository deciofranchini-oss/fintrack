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
  if(emEl)  emEl.value  = cfg.emailDefault;
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

  const today = new Date();
  const cutoffDate = new Date(today);
  cutoffDate.setDate(cutoffDate.getDate() + (cfg.daysAhead||0));
  const cutoff = cutoffDate.toISOString().slice(0,10);

  if(manual) toast('🔄 Verificando transações programadas...', 'info');

  try {
    // Load active scheduled transactions with auto_register=true
    const { data: schedList, error } = await sb.from('scheduled_transactions')
      .select('*, accounts(id,name,currency,balance), categories(id,name), payees(id,name)')
      .eq('status', 'active')
      .eq('auto_register', true);

    if(error) { if(manual) toast('Erro: ' + error.message, 'error'); return; }
    if(!schedList?.length) {
      if(manual) toast('Nenhuma transação com registro automático ativo', 'info');
      updateLastRunConfig(0);
      return;
    }

    let totalRegistered = 0;
    let totalNotified = 0;

    for(const sc of schedList) {
      const dates = getScheduledDates(sc, cutoff);
      for(const date of dates) {
        // Check if already registered
        const { data: existing } = await sb.from('scheduled_occurrences')
          .select('id')
          .eq('scheduled_id', sc.id)
          .eq('scheduled_date', date)
          .not('transaction_id', 'is', null)
          .maybeSingle();

        if(existing) continue; // already done

        // Create the transaction
        const isAutoTransfer = sc.type === 'transfer' || sc.type === 'card_payment';
        const txAmt = (sc.type === 'expense' || isAutoTransfer) ? -Math.abs(sc.amount) : Math.abs(sc.amount);
        const { data: newTx, error: txErr } = await sb.from('transactions').insert({ family_id: famId(),
          account_id:  sc.account_id,
          description: sc.description,
          amount:      txAmt,
          date:        date,
          category_id: sc.category_id || null,
          payee_id:    isAutoTransfer ? null : (sc.payee_id || null),
          memo:        sc.memo ? `[Auto] ${sc.memo}` : '[Registro automático]',
          is_transfer: isAutoTransfer,
          is_card_payment: sc.type === 'card_payment',
          transfer_to_account_id: isAutoTransfer ? sc.transfer_to_account_id : null,
        }).select().single();

        if(txErr) { console.error('[AutoReg] Tx error:', txErr.message); continue; }

        // Update account balance
        const newBal = (parseFloat(sc.accounts?.balance)||0) + txAmt;
        await sb.from('accounts').update({ balance: newBal }).eq('id', sc.account_id);

        // Mark occurrence as registered
        await sb.from('scheduled_occurrences').upsert({
          scheduled_id:  sc.id,
          scheduled_date: date,
          actual_date:   new Date().toISOString().slice(0,10),
          amount:        txAmt,
          transaction_id: newTx.id,
        }, { onConflict: 'scheduled_id,scheduled_date' });

        totalRegistered++;

        // Send email notification if configured
        if(sc.notify_email && (sc.notify_email_addr || cfg.emailDefault)) {
          const emailTo = sc.notify_email_addr || cfg.emailDefault;
          await sendScheduledNotification(sc, date, txAmt, emailTo);
          totalNotified++;
        }
      }

      // Send UPCOMING notifications (notify_days_before)
      if(sc.notify_email) {
        const daysBefore = sc.notify_days_before || 1;
        const upcoming = getScheduledDates(sc, new Date(Date.now() + daysBefore*86400000).toISOString().slice(0,10));
        const todayStr = new Date().toISOString().slice(0,10);
        for(const date of upcoming) {
          if(date > todayStr) {
            // Upcoming - send notification if not already sent
            const emailTo = sc.notify_email_addr || cfg.emailDefault;
            if(emailTo) await sendUpcomingNotification(sc, date, emailTo, daysBefore);
          }
        }
      }
    }

    // Update last run
    updateLastRunConfig(totalRegistered);
    await loadAccounts(); // refresh balances

    if(manual) {
      if(totalRegistered > 0) {
        toast(`✅ ${totalRegistered} transação(ões) registrada(s) automaticamente!`, 'success');
        if(state.currentPage === 'transactions') loadTransactions();
        if(state.currentPage === 'dashboard') loadDashboard();
      } else {
        toast('✅ Verificação concluída — nenhuma transação pendente', 'info');
      }
    } else if(totalRegistered > 0) {
      toast(`🤖 ${totalRegistered} transação(ões) registrada(s) automaticamente`, 'success');
    }

  } catch(e) {
    console.error('[AutoReg] Error:', e);
    if(manual) toast('Erro na verificação: ' + e.message, 'error');
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

/* ── Email Notifications ── */
async function sendScheduledNotification(sc, date, amount, emailTo) {
  if(!EMAILJS_CONFIG.serviceId || !EMAILJS_CONFIG.publicKey || !EMAILJS_CONFIG.templateId) return;
  try {
    emailjs.init(EMAILJS_CONFIG.publicKey);
    await emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, {
      to_email:    emailTo,
      subject:     `✅ Transação registrada: ${sc.description}`,
      message:     `A transação "${sc.description}" de ${fmt(Math.abs(amount))} foi registrada automaticamente em ${fmtDate(date)}.`,
      from_name:   'J.F. Family FinTrack',
      report_period: fmtDate(date),
      report_income: amount > 0 ? fmt(amount) : '—',
      report_expense: amount < 0 ? fmt(Math.abs(amount)) : '—',
      report_balance: fmt(amount),
      report_count: '1',
      report_view: 'Automático',
    });
  } catch(e) { console.warn('[AutoReg] Email error:', e.message); }
}

async function sendUpcomingNotification(sc, date, emailTo, daysBefore) {
  if(!EMAILJS_CONFIG.serviceId || !EMAILJS_CONFIG.publicKey || !EMAILJS_CONFIG.templateId) return;
  // Check if already sent (use localStorage to avoid duplicates)
  const sentKey = `notified_${sc.id}_${date}`;
  if(localStorage.getItem(sentKey)) return;
  try {
    emailjs.init(EMAILJS_CONFIG.publicKey);
    await emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, {
      to_email:    emailTo,
      subject:     `🔔 Transação programada em ${daysBefore > 0 ? daysBefore + ' dia(s)' : 'hoje'}: ${sc.description}`,
      message:     `Lembrete: a transação "${sc.description}" de ${fmt(Math.abs(sc.amount))} está programada para ${fmtDate(date)}.`,
      from_name:   'J.F. Family FinTrack — Lembrete',
      report_period: fmtDate(date),
      report_income: sc.amount > 0 ? fmt(sc.amount) : '—',
      report_expense: sc.amount < 0 ? fmt(Math.abs(sc.amount)) : '—',
      report_balance: fmt(sc.amount),
      report_count: '1',
      report_view: 'Lembrete',
    });
    localStorage.setItem(sentKey, '1');
  } catch(e) { console.warn('[AutoReg] Upcoming email error:', e.message); }
}

/* ══════════════════════════════════════════════════════════════════
   SQL MIGRATION — Fields for auto_register
   (run in Supabase SQL Editor)
══════════════════════════════════════════════════════════════════ */
const AUTO_REGISTER_SQL = `
-- Add auto-register columns to scheduled_transactions
ALTER TABLE scheduled_transactions
  ADD COLUMN IF NOT EXISTS auto_register      BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_email       BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_email_addr  TEXT,
  ADD COLUMN IF NOT EXISTS notify_days_before INTEGER DEFAULT 1;

-- Index for efficient auto-register queries
CREATE INDEX IF NOT EXISTS idx_scheduled_auto_register
  ON scheduled_transactions(status, auto_register)
  WHERE auto_register = true AND status = 'active';

-- Optional: pg_cron extension for server-side execution
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
`;


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
