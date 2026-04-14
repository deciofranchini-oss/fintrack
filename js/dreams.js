/**
 * dreams.js — Módulo Sonhos — FinTrack
 * ══════════════════════════════════════════════════════════════════════
 * GPS financeiro inteligente: transforma objetivos em metas estruturadas,
 * acompanháveis e impulsionadas por IA (Gemini).
 *
 * Tipos suportados (v1): viagem | automovel | imovel
 * Arquitetura preparada para expansão.
 *
 * Depende de: auth.js (famId, currentUser, famQ), settings.js
 *             (getAppSetting, saveAppSetting), utils.js (toast),
 *             receipt_ai.js (RECEIPT_AI_KEY_SETTING, RECEIPT_AI_MODEL)
 */

/* ── Estado interno ───────────────────────────────────────────────── */
const _drm = {
  loaded:  false,
  dreams:  [],       // cache local
  items:   {},       // dream_id → []
  wizard:  null,     // estado do wizard de criação
};

/* ── Feature flag ─────────────────────────────────────────────────── */

// ── BRL amount mask for Dreams fields (mirrors _amtFieldInput in utils.js) ──
function _drmAmtInput(el) {
  if (!el) return;
  const rawDigits = el.value.replace(/[^0-9]/g, '');
  if (!rawDigits) { el.dataset.cents = '0'; el.value = ''; return; }
  const cents = parseInt(rawDigits.slice(-13) || '0', 10);
  el.dataset.cents = String(cents);
  const reais = Math.floor(cents / 100);
  const centsOnly = cents % 100;
  el.value = reais.toLocaleString('pt-BR') + ',' + String(centsOnly).padStart(2, '0');
  try { el.setSelectionRange(el.value.length, el.value.length); } catch(_) {}
}
function _drmAmtBlur(el) {
  if (!el) return;
  let cents = parseInt(el.dataset.cents || '0', 10);
  if (!cents) {
    const raw = el.value.replace(/\./g, '').replace(',', '.');
    cents = Math.round(Math.abs(parseFloat(raw) || 0) * 100);
    el.dataset.cents = String(cents);
  }
  if (!cents) { el.value = ''; return; }
  const reais = Math.floor(cents / 100);
  const centsOnly = cents % 100;
  el.value = reais.toLocaleString('pt-BR') + ',' + String(centsOnly).padStart(2, '0');
}
// Auto-format all drm amount inputs in a container (call after injecting wizard HTML)
function _drmInitAllAmtFields(containerEl) {
  const el = containerEl || document;
  el.querySelectorAll('input[id^="wizAmount"],input[id^="wizEntrada"],input[id^="wizFgts"],input[id^="wizCusto"],input[id^="wizNewItemAmt"],input.drm-wiz-item-amt,input[id="contribAmount"]').forEach(inp => {
    if (inp.value) {
      const raw = (inp.value + '').replace(/\./g, '').replace(',', '.');
      const cents = Math.round(Math.abs(parseFloat(raw) || 0) * 100);
      if (cents) {
        inp.dataset.cents = String(cents);
        inp.value = Math.floor(cents/100).toLocaleString('pt-BR') + ',' + String(cents%100).padStart(2,'0');
      }
    }
  });
}
window._drmInitAllAmtFields = _drmInitAllAmtFields;

// Read numeric value from a drm amount field (returns float in BRL)
function _drmAmtVal(el) {
  if (!el) return 0;
  const cents = parseInt(el.dataset.cents || '0', 10);
  if (cents) return cents / 100;
  // Fallback: parse displayed value
  const raw = (el.value || '').replace(/\./g, '').replace(',', '.');
  return Math.abs(parseFloat(raw) || 0);
}

async function isDreamsEnabled() {
  const fid = typeof famId === 'function' ? famId() : null;
  if (!fid) return false;

  // 1. New system: family_preferences.module_dreams
  if (typeof getFamilyPreferences === 'function') {
    try {
      await getFamilyPreferences(); // populates _fpCache
      if (typeof isModuleEnabled === 'function') {
        if (typeof _fpCache !== 'undefined' && _fpCache !== null) {
          const enabled = isModuleEnabled('dreams');
          if (_fpCache.modules && 'dreams' in _fpCache.modules) {
            if (enabled) return true;
            // Flag is false — but DB default is false, so check if family has
            // existing dreams data. If yes, auto-enable so data is never hidden.
            try {
              const { count } = await sb.from('dreams')
                .select('id', { count: 'exact', head: true })
                .eq('family_id', fid);
              if (count > 0) {
                if (typeof updateFamilyPreferences === 'function') {
                  updateFamilyPreferences({ modules: { dreams: true } }).catch(() => {});
                }
                return true;
              }
            } catch(_) {}
            return false;
          }
        }
      }
    } catch(_) {}
  }

  // 2. Legacy system: app_settings key 'dreams_enabled_<famId>'
  const cacheKey = 'dreams_enabled_' + fid;
  if (window._familyFeaturesCache && cacheKey in window._familyFeaturesCache)
    return !!window._familyFeaturesCache[cacheKey];

  try {
    const raw = await getAppSetting(cacheKey, null);
    // Only trust explicit false — if not set at all, default to ENABLED
    if (raw === false || raw === 'false') {
      window._familyFeaturesCache = window._familyFeaturesCache || {};
      window._familyFeaturesCache[cacheKey] = false;
      return false;
    }
  } catch(_) {}

  // Default: ENABLED (module should show unless explicitly turned off)
  return true;
}

async function applyDreamsFeature() {
  const fid = famId();
  const navEl  = document.getElementById('dreamsNav');
  const pageEl = document.getElementById('page-dreams');
  if (!fid) {
    if (navEl) navEl.style.display = 'none';
    if (typeof _syncModulesSection === 'function') _syncModulesSection();
    return;
  }
  const on = await isDreamsEnabled();
  if (navEl) { navEl.style.display = on ? '' : 'none'; navEl.dataset.featureControlled = '1'; }
  if (pageEl) pageEl.style.display = on ? '' : 'none';
  if (typeof _syncModulesSection === 'function') _syncModulesSection();
  if (on && !_drm.loaded) await loadDreams().catch(() => {});

  // If module is ON, ensure nav item is always visible even if hidden by other code
  if (on && navEl && navEl.style.display === 'none') {
    navEl.style.display = '';
  }
}
window.applyDreamsFeature = applyDreamsFeature;

// Re-apply after a short delay to catch any race with bootApp / family prefs load
function _applyDreamsFeatureDelayed() {
  setTimeout(() => applyDreamsFeature().catch(() => {}), 1500);
  setTimeout(() => applyDreamsFeature().catch(() => {}), 4000);
}
window._applyDreamsFeatureDelayed = _applyDreamsFeatureDelayed;

async function toggleFamilyDreams(familyId, enabled) {
  // Save to legacy system
  await saveAppSetting('dreams_enabled_' + familyId, enabled);
  window._familyFeaturesCache = window._familyFeaturesCache || {};
  window._familyFeaturesCache['dreams_enabled_' + familyId] = enabled;

  // Sync to new family_preferences system
  if (typeof updateFamilyPreferences === 'function') {
    try {
      await updateFamilyPreferences({ modules: { dreams: enabled } });
    } catch(_) {}
  }

  applyDreamsFeature().catch(() => {});
  toast(enabled ? '✓ Sonhos ativado' : 'Sonhos desativado', 'success');
}
window.toggleFamilyDreams = toggleFamilyDreams;

/* ── Page init ────────────────────────────────────────────────────── */
async function initDreamsPage() {
  const container = document.getElementById('dreams-list-container');
  if (!await isDreamsEnabled()) {
    // Module disabled — show appropriate message instead of "Carregando sonhos…"
    if (container) {
      container.innerHTML = `<div class="drm-empty" style="padding:60px 20px;text-align:center;color:var(--muted)">
        <div style="font-size:2.5rem;margin-bottom:12px">⚙️</div>
        <div style="font-size:.95rem;font-weight:600;color:var(--text);margin-bottom:8px">Módulo Sonhos não ativado</div>
        <div style="font-size:.82rem;color:var(--muted);line-height:1.6">Ative o módulo em <strong>Gerenciar Família → Módulos</strong>.</div>
      </div>`;
    }
    return;
  }
  // Show loading state while fetching
  if (container && !_drm.loaded) {
    container.innerHTML = `<div class="drm-empty" style="padding:60px 20px;text-align:center;color:var(--muted)">
      <div style="font-size:2.5rem;margin-bottom:12px">⏳</div>
      <div style="font-size:.95rem;font-weight:600;color:var(--text)">Carregando sonhos…</div>
    </div>`;
  }
  // Always force-reload on page navigation (avoids stale cache from previous errors)
  await loadDreams(true);
  renderDreamsPage();
}
window.initDreamsPage = initDreamsPage;

/* ── Data loading ─────────────────────────────────────────────────── */
async function loadDreams(force = false) {
  if (_drm.loaded && !force) return;
  try {
    const fid2 = typeof famId === 'function' ? famId() : (typeof currentUser !== 'undefined' ? currentUser?.family_id : null);
    let data, error;
    if (fid2) {
      // Direct query with explicit family_id — avoids famQ() chain issues
      ({ data, error } = await sb.from('dreams').select('*')
        .eq('family_id', fid2)
        .order('priority', { ascending: true })
        .order('created_at', { ascending: false }));
    } else {
      // Fallback to famQ
      ({ data, error } = await famQ(
        sb.from('dreams').select('*')
      ).order('priority', { ascending: true }).order('created_at', { ascending: false }));
    }

    // Se a tabela não existe ainda (código 42P01), avisa no container
    if (error) {
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        const container = document.getElementById('dreams-list-container');
        if (container) {
          container.innerHTML = `
          <div class="drm-empty">
            <div class="drm-empty-icon">⚠️</div>
            <div class="drm-empty-title">Migração pendente</div>
            <div class="drm-empty-desc">As tabelas do módulo Sonhos ainda não foram criadas no banco de dados.<br>Execute a migração SQL no painel Supabase e recarregue a página.</div>
          </div>`;
        }
        _drm.loaded = true; // mark loaded so we don't retry on every navigation
        return;
      }
      throw error;
    }

    _drm.dreams = data || [];

    // Load items for all dreams
    if (_drm.dreams.length) {
      const ids = _drm.dreams.map(d => d.id);
      const { data: items } = await sb.from('dream_items')
        .select('*').in('dream_id', ids).order('estimated_amount', { ascending: false });
      _drm.items = {};
      (items || []).forEach(it => {
        if (!_drm.items[it.dream_id]) _drm.items[it.dream_id] = [];
        _drm.items[it.dream_id].push(it);
      });
    }

    // Load contributions
    if (_drm.dreams.length) {
      const ids = _drm.dreams.map(d => d.id);
      const { data: contribs } = await sb.from('dream_contributions')
        .select('*').in('dream_id', ids);
      (contribs || []).forEach(c => {
        const dream = _drm.dreams.find(d => d.id === c.dream_id);
        if (dream) {
          dream._contributions = dream._contributions || [];
          dream._contributions.push(c);
        }
      });
    }

    _drm.loaded = true;
  } catch (e) {
    console.warn('[Dreams] loadDreams error:', e?.message || e);
    _drm.dreams = [];
    _drm.loaded = false;  // Don't mark as loaded on error — allow retry on next navigation
  }
}

/* ── Computed helpers ─────────────────────────────────────────────── */
function _dreamAccumulated(dream) {
  const contribs = dream._contributions || [];
  return contribs.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);
}

function _dreamProgress(dream) {
  const target = parseFloat(dream.target_amount) || 0;
  if (!target) return 0;
  return Math.min(100, (_dreamAccumulated(dream) / target) * 100);
}

function _dreamMonthsLeft(dream) {
  if (!dream.target_date) return null;
  const now = new Date();
  const end = new Date(dream.target_date);
  const diff = (end.getFullYear() - now.getFullYear()) * 12 + (end.getMonth() - now.getMonth());
  return Math.max(0, diff);
}

function _dreamMonthlySaving(dream) {
  const months = _dreamMonthsLeft(dream);
  if (!months) return null;
  const remaining = (parseFloat(dream.target_amount) || 0) - _dreamAccumulated(dream);
  return Math.max(0, remaining / months);
}

function _fmtCurrency(val, currency = 'BRL') {
  if (isNaN(val)) return '—';
  try {
    return val.toLocaleString('pt-BR', { style: 'currency', currency: currency || 'BRL' });
  } catch {
    return 'R$ ' + val.toFixed(2).replace('.', ',');
  }
}

function _dreamTypeLabel(type) {
  const labels = {
    viagem:           '✈️ Viagem',
    automovel:        '🚗 Automóvel',
    imovel:           '🏠 Imóvel',
    cirurgia_plastica:'💉 Cirurgia Plástica',
    estudos:          '🎓 Estudos',
    outro:            '🌟 Outro Sonho',
  };
  return labels[type] || '🌟 Sonho';
}

function _dreamTypeEmoji(type) {
  const e = {
    viagem:           '✈️',
    automovel:        '🚗',
    imovel:           '🏠',
    cirurgia_plastica:'💉',
    estudos:          '🎓',
    outro:            '🌟',
  };
  return e[type] || '🌟';
}

function _dreamStatusLabel(status) {
  const s = { active: 'Ativo', paused: 'Pausado', achieved: '🏆 Conquistado', cancelled: 'Cancelado' };
  return s[status] || status;
}

function _dreamStatusColor(status) {
  const c = { active: 'var(--accent)', paused: 'var(--warning, #f39c12)', achieved: '#27ae60', cancelled: 'var(--muted)' };
  return c[status] || 'var(--muted)';
}

/* ── Main page render ─────────────────────────────────────────────── */
function _updateDreamsHero(active, achieved) {
  // Populate hero banner KPIs
  const kpiActive   = document.getElementById('drmKpiActive');
  const kpiTotal    = document.getElementById('drmKpiTotal');
  const kpiAcc      = document.getElementById('drmKpiAcc');
  const kpiAccSub   = document.getElementById('drmKpiAccSub');
  const kpiAchieved = document.getElementById('drmKpiAchieved');
  const progDiv     = document.getElementById('drmHeroProgress');
  const progFill    = document.getElementById('drmHeroProgressFill');
  const progPct     = document.getElementById('drmHeroProgressPct');
  const heroTitle   = document.getElementById('drmHeroTitle');

  const totalTarget = active.reduce((s, d) => s + (parseFloat(d.target_amount) || 0), 0);
  const totalAcc    = active.reduce((s, d) => s + _dreamAccumulated(d), 0);
  const pct         = totalTarget > 0 ? Math.min(100, Math.round((totalAcc / totalTarget) * 100)) : 0;

  if (kpiActive)   kpiActive.textContent   = active.length || '—';
  if (kpiTotal)    kpiTotal.textContent    = totalTarget > 0 ? _fmtCurrency(totalTarget) : '—';
  if (kpiAcc)      kpiAcc.textContent      = totalAcc > 0 ? _fmtCurrency(totalAcc) : '—';
  if (kpiAccSub)   kpiAccSub.textContent   = totalTarget > 0 ? pct + '% do total' : '';
  if (kpiAchieved) kpiAchieved.textContent = achieved.length || '0';

  // Show progress bar only when there are active dreams with targets
  if (progDiv) progDiv.style.display = (active.length && totalTarget > 0) ? '' : 'none';
  if (progFill) progFill.style.width = pct + '%';
  if (progPct)  progPct.textContent  = pct + '%';

  // Personalise title
  if (heroTitle) {
    if (!active.length && !achieved.length) {
      heroTitle.textContent = 'Objetivos & Realizações';
    } else if (achieved.length && !active.length) {
      heroTitle.textContent = achieved.length + (achieved.length === 1 ? ' sonho conquistado' : ' sonhos conquistados') + ' 🏆';
    } else {
      heroTitle.textContent = active.length + (active.length === 1 ? ' sonho ativo' : ' sonhos ativos');
    }
  }
}

function renderDreamsPage() {
  const container = document.getElementById('dreams-list-container');
  if (!container) return;

  const active   = _drm.dreams.filter(d => d.status === 'active');
  const achieved = _drm.dreams.filter(d => d.status === 'achieved');
  const paused   = _drm.dreams.filter(d => d.status === 'paused');
  const others   = _drm.dreams.filter(d => d.status === 'cancelled');

  // Update hero banner with live KPIs
  _updateDreamsHero(active, achieved);

  const allGroups = [
    { label: 'Ativos', dreams: active, emptyMsg: '' },
    { label: '🏆 Conquistados', dreams: achieved, emptyMsg: '' },
    { label: '⏸️ Pausados', dreams: paused, emptyMsg: '' },
    { label: 'Cancelados', dreams: others, emptyMsg: '' },
  ];

  if (!_drm.dreams.length) {
    container.innerHTML = _renderEmptyState();
    return;
  }

  let html = '';

  // Summary bar
  if (active.length) {
    const totalTarget = active.reduce((s, d) => s + (parseFloat(d.target_amount) || 0), 0);
    const totalAcc    = active.reduce((s, d) => s + _dreamAccumulated(d), 0);
    const pct         = totalTarget ? Math.round((totalAcc / totalTarget) * 100) : 0;
    html += `
    <div class="drm-summary-bar">
      <div class="drm-summary-item">
        <span class="drm-summary-label">Sonhos ativos</span>
        <span class="drm-summary-value">${active.length}</span>
      </div>
      <div class="drm-summary-item">
        <span class="drm-summary-label">Total planejado</span>
        <span class="drm-summary-value">${_fmtCurrency(totalTarget)}</span>
      </div>
      <div class="drm-summary-item">
        <span class="drm-summary-label">Acumulado</span>
        <span class="drm-summary-value accent">${_fmtCurrency(totalAcc)}</span>
      </div>
      <div class="drm-summary-item">
        <span class="drm-summary-label">Progresso geral</span>
        <span class="drm-summary-value">${pct}%</span>
      </div>
    </div>`;
  }

  for (const group of allGroups) {
    if (!group.dreams.length) continue;
    html += `<div class="drm-group-label">${group.label}</div>`;
    html += `<div class="drm-cards-grid">`;
    for (const d of group.dreams) {
      html += _renderDreamCard(d);
    }
    html += `</div>`;
  }

  container.innerHTML = html;
}

function _renderEmptyState() {
  return `
  <div class="drm-empty">
    <div class="drm-empty-icon">🌟</div>
    <div class="drm-empty-title">Seus sonhos começam aqui</div>
    <div class="drm-empty-desc">Transforme seus objetivos em metas financeiras estruturadas e acompanhe sua evolução com inteligência artificial.</div>
    <button class="btn btn-primary" onclick="openDreamWizard()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Criar meu primeiro sonho
    </button>
  </div>`;
}

function _renderDreamCard(d) {
  const acc     = _dreamAccumulated(d);
  const target  = parseFloat(d.target_amount) || 0;
  const pct     = _dreamProgress(d);
  const months  = _dreamMonthsLeft(d);
  const monthly = _dreamMonthlySaving(d);
  const items   = _drm.items[d.id] || [];
  const totalItems = items.reduce((s, it) => s + (parseFloat(it.estimated_amount) || 0), 0);
  const privacy = state.privacyMode;

  const progressColor = pct >= 100 ? '#27ae60' : pct >= 60 ? 'var(--accent)' : pct >= 30 ? 'var(--warning, #f39c12)' : 'var(--danger, #e74c3c)';

  return `
  <div class="drm-card drm-card--${d.dream_type}" onclick="openDreamDetail('${d.id}')">
    <div class="drm-card-header">
      <div class="drm-card-icon">${_dreamTypeEmoji(d.dream_type)}</div>
      <div class="drm-card-info">
        <div class="drm-card-title">${_esc(d.title)}</div>
        <div class="drm-card-type">${_dreamTypeLabel(d.dream_type)}</div>
      </div>
      <div class="drm-card-status" style="color:${_dreamStatusColor(d.status)}">${_dreamStatusLabel(d.status)}</div>
    </div>

    <div class="drm-card-progress-wrap">
      <div class="drm-card-progress-bar">
        <div class="drm-card-progress-fill" style="width:${pct}%;background:${progressColor}"></div>
      </div>
      <div class="drm-card-progress-labels">
        <span>${privacy ? '••••' : _fmtCurrency(acc, d.currency)}</span>
        <span style="font-weight:700;color:${progressColor}">${Math.round(pct)}%</span>
        <span>${privacy ? '••••' : _fmtCurrency(target, d.currency)}</span>
      </div>
    </div>

    <div class="drm-card-meta">
      ${months !== null ? `<span class="drm-meta-chip">📅 ${months > 0 ? months + ' meses' : 'Este mês!'}</span>` : ''}
      ${monthly !== null && monthly > 0 && !privacy ? `<span class="drm-meta-chip accent">💰 ${_fmtCurrency(monthly, d.currency)}/mês</span>` : ''}
      ${items.length ? `<span class="drm-meta-chip">${items.length} componentes</span>` : ''}
      ${d.target_date ? `<span class="drm-meta-chip">🎯 ${new Date(d.target_date).toLocaleDateString('pt-BR', {month:'short',year:'numeric'})}</span>` : ''}
    </div>

    ${d.description ? `<div class="drm-card-desc">${_esc(d.description).slice(0,90)}${d.description.length > 90 ? '…' : ''}</div>` : ''}

    <div class="drm-card-actions">
      <button class="drm-action-btn" onclick="event.stopPropagation();openDreamDetail('${d.id}')">Ver detalhes</button>
      <button class="drm-action-btn" onclick="event.stopPropagation();openContributeModal('${d.id}')">+ Aporte</button>
      <button class="drm-action-btn drm-action-btn--icon" onclick="event.stopPropagation();openDreamMenu('${d.id}', event)" title="Mais opções">⋯</button>
    </div>
  </div>`;
}

/* ── Dream detail modal ───────────────────────────────────────────── */
function openDreamDetail(dreamId) {
  const d = _drm.dreams.find(x => x.id === dreamId);
  if (!d) return;
  const items   = _drm.items[dreamId] || [];
  const acc     = _dreamAccumulated(d);
  const target  = parseFloat(d.target_amount) || 0;
  const pct     = _dreamProgress(d);
  const months  = _dreamMonthsLeft(d);
  const monthly = _dreamMonthlySaving(d);
  const privacy = state.privacyMode;

  // Scenario calculations
  const remaining = Math.max(0, target - acc);
  const conservative = remaining / Math.max(1, (months || 12) * 1.5);
  const balanced     = remaining / Math.max(1, months || 12);
  const aggressive   = remaining / Math.max(1, (months || 12) * 0.7);

  const simulation = d.simulation_json ? (typeof d.simulation_json === 'string' ? JSON.parse(d.simulation_json) : d.simulation_json) : null;
  const aiFields   = d.ai_generated_fields_json ? (typeof d.ai_generated_fields_json === 'string' ? JSON.parse(d.ai_generated_fields_json) : d.ai_generated_fields_json) : null;

  const html = `
  <div id="dreamDetailModal" class="modal-overlay open" onclick="if(event.target===this)closeDreamDetail()">
    <div class="modal drm-detail-modal" onclick="event.stopPropagation()">
      <div class="drm-detail-header">
        <div class="drm-detail-emoji">${_dreamTypeEmoji(d.dream_type)}</div>
        <div class="drm-detail-title-block">
          <h2 class="drm-detail-title">${_esc(d.title)}</h2>
          <div class="drm-detail-subtitle">${_dreamTypeLabel(d.dream_type)} · <span style="color:${_dreamStatusColor(d.status)}">${_dreamStatusLabel(d.status)}</span></div>
        </div>
        <button class="modal-close" onclick="closeDreamDetail()">✕</button>
      </div>

      <div class="drm-detail-body">

        <!-- Progress hero -->
        <div class="drm-detail-hero">
          <div class="drm-detail-hero-amounts">
            <div>
              <div class="drm-hero-label">Acumulado</div>
              <div class="drm-hero-value accent">${privacy ? '••••' : _fmtCurrency(acc, d.currency)}</div>
            </div>
            <div class="drm-hero-pct" style="color:${pct>=100?'#27ae60':pct>=60?'var(--accent)':'var(--warning,#f39c12)'}">
              ${Math.round(pct)}%
            </div>
            <div style="text-align:right">
              <div class="drm-hero-label">Meta</div>
              <div class="drm-hero-value">${privacy ? '••••' : _fmtCurrency(target, d.currency)}</div>
            </div>
          </div>
          <div class="drm-detail-progress-bar">
            <div class="drm-detail-progress-fill" style="width:${pct}%"></div>
          </div>
          ${months !== null ? `
          <div class="drm-hero-timeline">
            <span>📅 ${months > 0 ? months + ' meses restantes' : '🎯 Prazo este mês!'}</span>
            ${monthly !== null && monthly > 0 && !privacy ? `<span>Economia necessária: <strong>${_fmtCurrency(monthly, d.currency)}/mês</strong></span>` : ''}
          </div>` : ''}
        </div>

        <!-- Detalhes específicos por tipo -->
        ${aiFields && d.dream_type === 'cirurgia_plastica' ? `
        <div class="drm-detail-section">
          <div class="drm-section-title">💉 Detalhes da Cirurgia</div>
          <div class="drm-meta-grid">
            ${aiFields.tipo_cirurgia ? `<div class="drm-meta-item"><span class="drm-meta-label">Procedimento</span><span class="drm-meta-value">${_esc(aiFields.tipo_cirurgia)}</span></div>` : ''}
            ${aiFields.medico ? `<div class="drm-meta-item"><span class="drm-meta-label">Médico</span><span class="drm-meta-value">${_esc(aiFields.medico)}</span></div>` : ''}
            ${aiFields.clinica ? `<div class="drm-meta-item"><span class="drm-meta-label">Clínica</span><span class="drm-meta-value">${_esc(aiFields.clinica)}</span></div>` : ''}
            ${aiFields.protese ? `<div class="drm-meta-item"><span class="drm-meta-label">Prótese</span><span class="drm-meta-value">${_esc(aiFields.protese)}</span></div>` : ''}
            ${aiFields.custo_medico > 0 ? `<div class="drm-meta-item"><span class="drm-meta-label">Honorários</span><span class="drm-meta-value">${_fmtCurrency(aiFields.custo_medico)}</span></div>` : ''}
            ${aiFields.custo_anestesia > 0 ? `<div class="drm-meta-item"><span class="drm-meta-label">Anestesia</span><span class="drm-meta-value">${_fmtCurrency(aiFields.custo_anestesia)}</span></div>` : ''}
            ${aiFields.custo_hospital > 0 ? `<div class="drm-meta-item"><span class="drm-meta-label">Hospital</span><span class="drm-meta-value">${_fmtCurrency(aiFields.custo_hospital)}</span></div>` : ''}
            ${aiFields.custo_exames > 0 ? `<div class="drm-meta-item"><span class="drm-meta-label">Exames pré-op</span><span class="drm-meta-value">${_fmtCurrency(aiFields.custo_exames)}</span></div>` : ''}
          </div>
        </div>` : ''}

        ${aiFields && d.dream_type === 'estudos' ? `
        <div class="drm-detail-section">
          <div class="drm-section-title">🎓 Detalhes dos Estudos</div>
          <div class="drm-meta-grid">
            ${aiFields.tipo_estudo ? `<div class="drm-meta-item"><span class="drm-meta-label">Tipo</span><span class="drm-meta-value">${_esc(aiFields.tipo_estudo)}</span></div>` : ''}
            ${aiFields.instituicao ? `<div class="drm-meta-item"><span class="drm-meta-label">Instituição</span><span class="drm-meta-value">${_esc(aiFields.instituicao)}</span></div>` : ''}
            ${aiFields.pais ? `<div class="drm-meta-item"><span class="drm-meta-label">País</span><span class="drm-meta-value">${_esc(aiFields.pais)}</span></div>` : ''}
            ${aiFields.duracao_meses > 0 ? `<div class="drm-meta-item"><span class="drm-meta-label">Duração</span><span class="drm-meta-value">${aiFields.duracao_meses} meses</span></div>` : ''}
            ${aiFields.moeda && aiFields.moeda !== 'BRL' ? `<div class="drm-meta-item"><span class="drm-meta-label">Moeda</span><span class="drm-meta-value">${aiFields.moeda}</span></div>` : ''}
            ${aiFields.custo_mensalidade > 0 ? `<div class="drm-meta-item"><span class="drm-meta-label">Mensalidade</span><span class="drm-meta-value">${_fmtCurrency(aiFields.custo_mensalidade)}/mês</span></div>` : ''}
            ${aiFields.custo_moradia > 0 ? `<div class="drm-meta-item"><span class="drm-meta-label">Moradia</span><span class="drm-meta-value">${_fmtCurrency(aiFields.custo_moradia)}/mês</span></div>` : ''}
            ${aiFields.custo_passagem > 0 ? `<div class="drm-meta-item"><span class="drm-meta-label">Passagem</span><span class="drm-meta-value">${_fmtCurrency(aiFields.custo_passagem)}</span></div>` : ''}
          </div>
        </div>` : ''}

        ${aiFields && d.dream_type === 'outro' ? `
        <div class="drm-detail-section">
          <div class="drm-section-title">🌟 Detalhes do Objetivo</div>
          <div class="drm-meta-grid">
            ${aiFields.categoria ? `<div class="drm-meta-item"><span class="drm-meta-label">Categoria</span><span class="drm-meta-value">${_esc(aiFields.categoria)}</span></div>` : ''}
            ${aiFields.prazo_meses > 0 ? `<div class="drm-meta-item"><span class="drm-meta-label">Prazo desejado</span><span class="drm-meta-value">${aiFields.prazo_meses} meses</span></div>` : ''}
          </div>
          ${aiFields.detalhes ? `<div style="margin-top:8px;padding:10px 12px;background:var(--surface2);border-radius:8px;font-size:.85rem;color:var(--text2);line-height:1.5">${_esc(aiFields.detalhes)}</div>` : ''}
        </div>` : ''}

        <!-- Simulation scenarios -->
        ${!privacy && remaining > 0 ? `
        <div class="drm-detail-section">
          <div class="drm-section-title">📊 Simulação de cenários</div>
          <div class="drm-scenarios">
            <div class="drm-scenario drm-scenario--conservative">
              <div class="drm-scenario-label">Conservador</div>
              <div class="drm-scenario-desc">${_fmtCurrency(conservative, d.currency)}/mês</div>
              <div class="drm-scenario-period">${Math.round((months || 12) * 1.5)} meses</div>
            </div>
            <div class="drm-scenario drm-scenario--balanced">
              <div class="drm-scenario-label">Equilibrado</div>
              <div class="drm-scenario-desc">${_fmtCurrency(balanced, d.currency)}/mês</div>
              <div class="drm-scenario-period">${months || 12} meses</div>
            </div>
            <div class="drm-scenario drm-scenario--aggressive">
              <div class="drm-scenario-label">Acelerado</div>
              <div class="drm-scenario-desc">${_fmtCurrency(aggressive, d.currency)}/mês</div>
              <div class="drm-scenario-period">${Math.round((months || 12) * 0.7)} meses</div>
            </div>
          </div>
        </div>` : ''}

        <!-- Components -->
        ${items.length ? `
        <div class="drm-detail-section">
          <div class="drm-section-title">🧩 Componentes (${items.length})</div>
          <div class="drm-items-list">
            ${items.map(it => `
            <div class="drm-item-row">
              <div class="drm-item-name">
                ${it.is_ai_suggested ? '<span class="drm-ai-badge" title="Sugerido por IA">✨</span>' : ''}
                ${_esc(it.name)}
              </div>
              <div class="drm-item-amount">${privacy ? '••••' : _fmtCurrency(parseFloat(it.estimated_amount) || 0, d.currency)}</div>
            </div>`).join('')}
            <div class="drm-item-row drm-item-row--total">
              <div class="drm-item-name"><strong>Total componentes</strong></div>
              <div class="drm-item-amount"><strong>${privacy ? '••••' : _fmtCurrency(items.reduce((s,it)=>s+(parseFloat(it.estimated_amount)||0),0), d.currency)}</strong></div>
            </div>
          </div>
        </div>` : ''}

        <!-- AI Analysis -->
        <div class="drm-detail-section">
          <div class="drm-section-title">🤖 Análise por IA <span class="drm-ai-badge-sm">Gemini</span></div>
          <div id="dreamAiAnalysis-${d.id}" class="drm-ai-analysis-box">
            ${simulation?.ai_summary ? `<div class="drm-ai-text">${simulation.ai_summary}</div>` :
              `<div class="drm-ai-placeholder">
                <button class="btn btn-sm drm-btn-ai" onclick="runDreamAiAnalysis('${d.id}')">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                  Analisar viabilidade com IA
                </button>
                <p class="drm-ai-hint">A IA vai analisar seus dados financeiros reais e avaliar se este sonho é viável.</p>
              </div>`
            }
          </div>
        </div>

        <!-- Contributions history -->
        ${(d._contributions || []).length ? `
        <div class="drm-detail-section">
          <div class="drm-section-title">💰 Histórico de aportes</div>
          <div class="drm-contribs-list">
            ${(d._contributions || []).slice(-5).reverse().map(c => `
            <div class="drm-contrib-row">
              <span class="drm-contrib-date">${new Date(c.date || c.created_at).toLocaleDateString('pt-BR')}</span>
              <span class="drm-contrib-amount">${privacy ? '••••' : _fmtCurrency(parseFloat(c.amount)||0, d.currency)}</span>
              ${c.type === 'manual' ? '<span class="drm-contrib-badge">manual</span>' : '<span class="drm-contrib-badge drm-contrib-badge--tx">transação</span>'}
            </div>`).join('')}
          </div>
        </div>` : ''}

        ${d.description ? `
        <div class="drm-detail-section">
          <div class="drm-section-title">📝 Descrição</div>
          <p class="drm-desc-text">${_esc(d.description)}</p>
        </div>` : ''}

      </div><!-- /body -->

      <div class="drm-detail-footer">
        <button class="btn btn-secondary btn-sm" onclick="openContributeModal('${d.id}');closeDreamDetail()">+ Registrar aporte</button>
        <button class="btn btn-secondary btn-sm" onclick="openEditDreamModal('${d.id}');closeDreamDetail()">✏️ Editar</button>
        <button class="btn btn-danger btn-sm drm-btn-right" onclick="confirmDeleteDream('${d.id}')">🗑️</button>
      </div>
    </div>
  </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  // Auto-format pre-filled amount fields, then re-run sums
  requestAnimationFrame(() => {
    const body = document.getElementById('wizardBody');
    if (body) {
      _drmInitAllAmtFields(body);
      if (typeof _wizSomaCirurgia  === 'function') _wizSomaCirurgia();
      if (typeof _wizSomaEstudos   === 'function') _wizSomaEstudos();
      if (typeof _refreshItemsTotal === 'function') _refreshItemsTotal();
    }
  });
}
window.openDreamDetail = openDreamDetail;

function closeDreamDetail() {
  document.getElementById('dreamDetailModal')?.remove();
}
window.closeDreamDetail = closeDreamDetail;

/* ── Context menu ─────────────────────────────────────────────────── */
function openDreamMenu(dreamId, event) {
  event.stopPropagation();
  document.querySelectorAll('.drm-ctx-menu').forEach(m => m.remove());
  const d = _drm.dreams.find(x => x.id === dreamId);
  if (!d) return;

  const menu = document.createElement('div');
  menu.className = 'drm-ctx-menu';
  menu.style.cssText = `position:fixed;z-index:9999;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:6px;box-shadow:0 4px 20px rgba(0,0,0,.18);min-width:160px`;

  const statusOpts = d.status === 'active'
    ? `<div class="drm-ctx-item" onclick="changeDreamStatus('${dreamId}','paused');this.closest('.drm-ctx-menu').remove()">⏸️ Pausar</div>
       <div class="drm-ctx-item" onclick="changeDreamStatus('${dreamId}','achieved');this.closest('.drm-ctx-menu').remove()">🏆 Marcar conquistado</div>`
    : `<div class="drm-ctx-item" onclick="changeDreamStatus('${dreamId}','active');this.closest('.drm-ctx-menu').remove()">▶️ Reativar</div>`;

  menu.innerHTML = `
    <div class="drm-ctx-item" onclick="openEditDreamModal('${dreamId}');this.closest('.drm-ctx-menu').remove()">✏️ Editar sonho</div>
    <div class="drm-ctx-item" onclick="openContributeModal('${dreamId}');this.closest('.drm-ctx-menu').remove()">💰 Registrar aporte</div>
    <div class="drm-ctx-item" onclick="runDreamAiAnalysis('${dreamId}');this.closest('.drm-ctx-menu').remove()">🤖 Analisar com IA</div>
    ${statusOpts}
    <div class="drm-ctx-sep"></div>
    <div class="drm-ctx-item drm-ctx-item--danger" onclick="confirmDeleteDream('${dreamId}');this.closest('.drm-ctx-menu').remove()">🗑️ Excluir</div>`;

  const rect = event.target.getBoundingClientRect();
  menu.style.top  = (rect.bottom + 4) + 'px';
  menu.style.left = Math.min(rect.left, window.innerWidth - 175) + 'px';
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 10);
}
window.openDreamMenu = openDreamMenu;

async function changeDreamStatus(dreamId, newStatus) {
  try {
    const { error } = await sb.from('dreams').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', dreamId);
    if (error) throw error;
    const d = _drm.dreams.find(x => x.id === dreamId);
    if (d) d.status = newStatus;
    renderDreamsPage();
    toast('Status atualizado', 'success');
  } catch (e) { toast('Erro ao atualizar status', 'error'); }
}
window.changeDreamStatus = changeDreamStatus;

async function confirmDeleteDream(dreamId) {
  closeDreamDetail();
  const d = _drm.dreams.find(x => x.id === dreamId);
  if (!d) return;
  if (!confirm(`Excluir o sonho "${d.title}"? Esta ação não pode ser desfeita.`)) return;
  try {
    await sb.from('dream_items').delete().eq('dream_id', dreamId);
    await sb.from('dream_contributions').delete().eq('dream_id', dreamId);
    const { error } = await sb.from('dreams').delete().eq('id', dreamId);
    if (error) throw error;
    _drm.dreams = _drm.dreams.filter(x => x.id !== dreamId);
    delete _drm.items[dreamId];
    renderDreamsPage();
    toast('Sonho excluído', 'success');
  } catch (e) { toast('Erro ao excluir sonho', 'error'); }
}
window.confirmDeleteDream = confirmDeleteDream;

/* ── Contribute modal ─────────────────────────────────────────────── */
function openContributeModal(dreamId) {
  const d = _drm.dreams.find(x => x.id === dreamId);
  if (!d) return;
  document.querySelectorAll('#contributeModal').forEach(m => m.remove());
  const today = new Date().toISOString().slice(0, 10);

  const html = `
  <div id="contributeModal" class="modal-overlay open" onclick="if(event.target===this)document.getElementById('contributeModal').remove()">
    <div class="modal" style="max-width:380px" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h3>💰 Registrar aporte</h3>
        <button class="modal-close" onclick="document.getElementById('contributeModal').remove()">✕</button>
      </div>
      <div class="modal-body">
        <p style="color:var(--muted);font-size:.82rem;margin-bottom:12px">Sonho: <strong>${_esc(d.title)}</strong></p>
        <div class="form-group">
          <label class="form-label">Valor</label>
          <input type="text" inputmode="numeric" id="contribAmount" class="form-input" placeholder="0,00" oninput="_drmAmtInput(this)" onblur="_drmAmtBlur(this)">
        </div>
        <div class="form-group">
          <label class="form-label">Data</label>
          <input type="date" lang="pt-BR" id="contribDate" class="form-input" value="${today}">
        </div>
        <div class="form-group">
          <label class="form-label">Observação (opcional)</label>
          <input type="text" id="contribNote" class="form-input" placeholder="Ex: transferência mensal">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('contributeModal').remove()">Cancelar</button>
        <button class="btn btn-primary" onclick="saveContribution('${dreamId}')">Salvar aporte</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  setTimeout(() => document.getElementById('contribAmount')?.focus(), 100);
}
window.openContributeModal = openContributeModal;

async function saveContribution(dreamId) {
  const amount = _drmAmtVal(document.getElementById('contribAmount'));
  const date   = document.getElementById('contribDate')?.value;
  if (!amount || amount <= 0) { toast('Informe um valor válido', 'warning'); return; }
  if (!date) { toast('Informe a data', 'warning'); return; }

  const note = document.getElementById('contribNote')?.value || '';
  const fid  = famId();

  try {
    const { data, error } = await sb.from('dream_contributions').insert({
      dream_id: dreamId,
      family_id: fid,
      amount: amount,
      date: date,
      type: 'manual',
      notes: note || null,
      created_at: new Date().toISOString(),
    }).select().single();
    if (error) throw error;

    const d = _drm.dreams.find(x => x.id === dreamId);
    if (d) {
      d._contributions = d._contributions || [];
      d._contributions.push(data);
    }
    document.getElementById('contributeModal')?.remove();
    renderDreamsPage();
    toast('Aporte registrado! 🎉', 'success');
  } catch (e) { toast('Erro ao salvar aporte: ' + (e?.message || e), 'error'); }
}
window.saveContribution = saveContribution;

/* ── AI Analysis ──────────────────────────────────────────────────── */
async function runDreamAiAnalysis(dreamId) {
  const d = _drm.dreams.find(x => x.id === dreamId);
  if (!d) return;

  const apiKey = await getGeminiApiKey();
  if (!apiKey || !apiKey.startsWith('AIza')) {
    toast('Configure a chave Gemini em Configurações → IA para usar esta função', 'warning');
    return;
  }

  const box = document.getElementById(`dreamAiAnalysis-${dreamId}`);
  if (box) box.innerHTML = `<div class="drm-ai-loading"><div class="drm-ai-spinner"></div>Analisando com IA…</div>`;

  const acc      = _dreamAccumulated(d);
  const target   = parseFloat(d.target_amount) || 0;
  const months   = _dreamMonthsLeft(d);
  const monthly  = _dreamMonthlySaving(d);
  const items    = _drm.items[dreamId] || [];
  const otherDreams = _drm.dreams.filter(x => x.id !== dreamId && x.status === 'active');

  // Gather financial context
  const recentTx = (state.transactions || []).slice(0, 100);
  const income   = recentTx.filter(t => (parseFloat(t.amount)||0) > 0 && !t.is_transfer).reduce((s,t) => s+(parseFloat(t.amount)||0), 0);
  const expense  = recentTx.filter(t => (parseFloat(t.amount)||0) < 0 && !t.is_transfer).reduce((s,t) => s+(parseFloat(t.amount)||0), 0);

  const context = {
    sonho: {
      titulo: d.title,
      tipo: d.dream_type,
      descricao: d.description,
      valor_meta: target,
      valor_acumulado: acc,
      percentual_concluido: _dreamProgress(d),
      prazo_meses: months,
      data_prazo: d.target_date,
      economia_mensal_necessaria: monthly,
      moeda: d.currency || 'BRL',
      status: d.status,
      componentes: items.map(it => ({ nome: it.name, valor: it.estimated_amount, sugerido_ia: it.is_ai_suggested })),
    },
    outros_sonhos_ativos: otherDreams.map(x => ({
      titulo: x.title,
      valor_meta: x.target_amount,
      acumulado: _dreamAccumulated(x),
      prazo_meses: _dreamMonthsLeft(x),
    })),
    contexto_financeiro_recente: {
      receita_estimada_mensal: Math.abs(income / Math.max(1, recentTx.length > 0 ? 3 : 1)),
      despesa_estimada_mensal: Math.abs(expense / Math.max(1, recentTx.length > 0 ? 3 : 1)),
    },
  };

  const prompt = `Você é um consultor financeiro pessoal analisando a viabilidade de um sonho financeiro.
Responda SOMENTE com JSON válido, sem markdown, sem texto antes ou depois.

DADOS DO SONHO E CONTEXTO FINANCEIRO:
${JSON.stringify(context, null, 0)}

RETORNE EXATAMENTE ESTE JSON (em português brasileiro):
{
  "viabilidade": "alta|media|baixa",
  "resumo": "2 frases resumindo a análise de viabilidade",
  "pontos_positivos": ["ponto 1", "ponto 2"],
  "alertas": ["alerta 1"],
  "recomendacoes": ["recomendação 1", "recomendação 2"],
  "prazo_realista_meses": 12,
  "economia_sugerida_mensal": 500,
  "conflitos_outros_sonhos": "texto sobre conflitos ou null",
  "motivacao": "frase motivacional personalizada curta"
}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${RECEIPT_AI_MODEL}:generateContent?key=${apiKey}`;
    const _d1 = await geminiRetryFetch(url, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 1200 },
    });
    const result = _parseGeminiJSON(_d1);

    // Save to simulation_json
    const simData = { ai_summary: result.resumo, ai_full: result, generated_at: new Date().toISOString() };
    await sb.from('dreams').update({
      simulation_json: JSON.stringify(simData),
      updated_at: new Date().toISOString(),
    }).eq('id', dreamId);
    const dm = _drm.dreams.find(x => x.id === dreamId);
    if (dm) dm.simulation_json = simData;

    if (box) box.innerHTML = _renderAiResult(result, d.currency);
  } catch (e) {
    console.warn('[Dreams] AI analysis error:', e);
    if (box) box.innerHTML = `<div class="drm-ai-error">Erro ao analisar. Verifique a chave Gemini e tente novamente.<br><small>${e?.message||''}</small></div>`;
  }
}
window.runDreamAiAnalysis = runDreamAiAnalysis;

function _renderAiResult(result, currency) {
  const viabColor = result.viabilidade === 'alta' ? '#27ae60' : result.viabilidade === 'media' ? 'var(--warning,#f39c12)' : 'var(--danger,#e74c3c)';
  const viabLabel = result.viabilidade === 'alta' ? '✅ Alta viabilidade' : result.viabilidade === 'media' ? '⚠️ Viabilidade média' : '❌ Baixa viabilidade';

  return `
  <div class="drm-ai-result">
    <div class="drm-ai-viab" style="color:${viabColor};font-weight:700;margin-bottom:8px">${viabLabel}</div>
    <p class="drm-ai-text">${result.resumo}</p>
    ${result.pontos_positivos?.length ? `
    <div class="drm-ai-section"><strong>✅ Pontos positivos</strong>
      <ul>${result.pontos_positivos.map(p => `<li>${p}</li>`).join('')}</ul>
    </div>` : ''}
    ${result.alertas?.length ? `
    <div class="drm-ai-section"><strong>⚠️ Alertas</strong>
      <ul>${result.alertas.map(a => `<li>${a}</li>`).join('')}</ul>
    </div>` : ''}
    ${result.recomendacoes?.length ? `
    <div class="drm-ai-section"><strong>💡 Recomendações</strong>
      <ul>${result.recomendacoes.map(r => `<li>${r}</li>`).join('')}</ul>
    </div>` : ''}
    ${result.conflitos_outros_sonhos ? `<div class="drm-ai-section"><strong>⚖️ Conflitos com outros sonhos</strong><p>${result.conflitos_outros_sonhos}</p></div>` : ''}
    ${result.prazo_realista_meses ? `<div class="drm-ai-meta">Prazo realista sugerido: <strong>${result.prazo_realista_meses} meses</strong></div>` : ''}
    ${result.economia_sugerida_mensal ? `<div class="drm-ai-meta">Economia mensal sugerida: <strong>${_fmtCurrency(result.economia_sugerida_mensal, currency)}</strong></div>` : ''}
    ${result.motivacao ? `<div class="drm-ai-motivacao">✨ ${result.motivacao}</div>` : ''}
    <div class="drm-ai-footer">Gerado por IA · ${new Date().toLocaleDateString('pt-BR')}</div>
  </div>`;
}

/* ════════════════════════════════════════════════════════════════════
   WIZARD DE CRIAÇÃO DE SONHOS
════════════════════════════════════════════════════════════════════ */
function openDreamWizard(dreamId = null) {
  document.querySelectorAll('#dreamWizardModal').forEach(m => m.remove());

  _drm.wizard = {
    step: 1,
    dreamId: dreamId,         // null = novo
    type: null,
    data: {},
    items: [],
    aiLoading: false,
    editing: !!dreamId,
  };

  if (dreamId) {
    const d = _drm.dreams.find(x => x.id === dreamId);
    if (d) {
      _drm.wizard.type = d.dream_type;
      const dCopy = { ...d };
      // Always ensure ai_generated_fields_json is a plain object (may be stored as JSON string)
      if (typeof dCopy.ai_generated_fields_json === 'string') {
        try { dCopy.ai_generated_fields_json = JSON.parse(dCopy.ai_generated_fields_json); }
        catch(_) { dCopy.ai_generated_fields_json = {}; }
      }
      _drm.wizard.data  = dCopy;
      _drm.wizard.items = [...(_drm.items[dreamId] || [])];
      _drm.wizard.step  = 2; // jump to type step so fields show
    }
  }

  _renderWizardModal();
}
window.openDreamWizard = openDreamWizard;
window.openEditDreamModal = openDreamWizard;

function _renderWizardModal() {
  document.querySelectorAll('#dreamWizardModal').forEach(m => m.remove());
  const w = _drm.wizard;
  let bodyHtml = '';

  if (w.step === 1) bodyHtml = _wizStep1();
  else if (w.step === 2) bodyHtml = _wizStep2();
  else if (w.step === 3) bodyHtml = _wizStep3();
  else if (w.step === 4) bodyHtml = _wizStep4();

  const html = `
  <div id="dreamWizardModal" class="modal-overlay open" onclick="if(event.target===this)closeDreamWizard()">
    <div class="modal drm-wizard-modal" onclick="event.stopPropagation()">
      <div class="modal-header drm-wizard-header">
        <div>
          <h3>${w.editing ? 'Editar sonho' : '✨ Criar novo sonho'}</h3>
          <div class="drm-wizard-steps">
            ${[1,2,3,4].map(s => `<span class="drm-wizard-step${w.step===s?' active':w.step>s?' done':''}">${s}</span>`).join('')}
          </div>
        </div>
        <button class="modal-close" onclick="closeDreamWizard()">✕</button>
      </div>
      <div class="modal-body drm-wizard-body" id="wizardBody">
        ${bodyHtml}
      </div>
      <div class="modal-footer drm-wizard-footer">
        ${w.step > 1 ? `<button class="btn btn-secondary" onclick="wizardBack()">← Voltar</button>` : '<div></div>'}
        ${w.step < 4
          ? `<button class="btn btn-primary" onclick="wizardNext()">Continuar →</button>`
          : `<button class="btn btn-primary" id="wizSaveBtn" onclick="saveDream()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              Salvar sonho
            </button>`
        }
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

function closeDreamWizard() {
  document.getElementById('dreamWizardModal')?.remove();
  _drm.wizard = null;
}
window.closeDreamWizard = closeDreamWizard;

/* ── Step 1: Escolha do tipo ──────────────────────────────────────── */
function _wizStep1() {
  const types = [
    { key: 'viagem',            emoji: '✈️', label: 'Viagem',            desc: 'Destinos, passeios, hospedagem e mais' },
    { key: 'automovel',         emoji: '🚗', label: 'Automóvel',         desc: 'Compra à vista ou financiada' },
    { key: 'imovel',            emoji: '🏠', label: 'Imóvel',            desc: 'Apartamento, casa, praia ou campo' },
    { key: 'cirurgia_plastica', emoji: '💉', label: 'Cirurgia Plástica', desc: 'Médico, clínica, tipo de procedimento' },
    { key: 'estudos',           emoji: '🎓', label: 'Estudos',           desc: 'Faculdade, curso, intercâmbio no exterior' },
    { key: 'outro',             emoji: '🌟', label: 'Outro Sonho',       desc: 'Qualquer objetivo financeiro personalizado' },
  ];
  return `
  <div class="drm-wiz-step1">
    <div class="drm-wiz-headline">Que tipo de sonho você quer criar?</div>
    <p class="drm-wiz-subhead">A IA vai sugerir componentes e valores baseados no seu perfil financeiro.</p>
    <div class="drm-type-cards">
      ${types.map(t => `
      <button class="drm-type-card${_drm.wizard?.type===t.key?' selected':''}" onclick="selectDreamType('${t.key}')">
        <div class="drm-type-emoji">${t.emoji}</div>
        <div class="drm-type-label">${t.label}</div>
        <div class="drm-type-desc">${t.desc}</div>
      </button>`).join('')}
    </div>
    <div class="drm-wiz-divider">
      <span>ou descreva livremente</span>
    </div>
    <div class="drm-wiz-free-input">
      <input type="text" id="wizFreeInput" class="form-input" placeholder='Ex: "Quero viajar para Paris em 2026 com minha família"'
        onkeydown="if(event.key==='Enter')wizardAiInterpret()">
      <button class="btn drm-btn-ai" id="wizAiBtn" onclick="wizardAiInterpret()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
        Interpretar com IA
      </button>
    </div>
    <div id="wizAiInterpretResult" style="display:none" class="drm-wiz-ai-hint"></div>
  </div>`;
}

function selectDreamType(type) {
  if (!_drm.wizard) return;
  _drm.wizard.type = type;
  document.querySelectorAll('.drm-type-card').forEach(c => c.classList.remove('selected'));
  document.querySelector(`.drm-type-card[onclick*="${type}"]`)?.classList.add('selected');
}
window.selectDreamType = selectDreamType;

async function wizardAiInterpret() {
  const input = document.getElementById('wizFreeInput')?.value?.trim();
  if (!input) return;

  const apiKey = await getGeminiApiKey();
  if (!apiKey || !apiKey.startsWith('AIza')) {
    toast('Configure a chave Gemini para usar interpretação por IA', 'warning');
    return;
  }

  const btn = document.getElementById('wizAiBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Interpretando…'; }

  const prompt = `Interprete este objetivo financeiro e retorne JSON.
Objetivo: "${input}"

JSON esperado (sem markdown, sem texto adicional):
{
  "tipo": "viagem|automovel|imovel|cirurgia_plastica|estudos|outro",
  "titulo": "título conciso do sonho",
  "descricao": "descrição em 1 frase",
  "destino_ou_modelo": "destino ou modelo do bem",
  "valor_estimado": 15000,
  "prazo_meses_sugerido": 18
}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${RECEIPT_AI_MODEL}:generateContent?key=${apiKey}`;
    const _d2 = await geminiRetryFetch(url, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 300 },
    });
    const result = _parseGeminiJSON(_d2);

    if (_drm.wizard) {
      _drm.wizard.type = result.tipo;
      _drm.wizard.data = {
        title: result.titulo,
        description: result.descricao,
        target_amount: result.valor_estimado,
      };
      if (result.prazo_meses_sugerido) {
        const d = new Date();
        d.setMonth(d.getMonth() + result.prazo_meses_sugerido);
        _drm.wizard.data.target_date = d.toISOString().slice(0, 10);
      }
    }

    const resDiv = document.getElementById('wizAiInterpretResult');
    if (resDiv) {
      resDiv.style.display = '';
      resDiv.innerHTML = `✨ IA identificou: <strong>${result.titulo}</strong> (${result.tipo}) · valor estimado: <strong>${_fmtCurrency(result.valor_estimado)}</strong>`;
    }
    selectDreamType(result.tipo);
  } catch (e) {
    toast('Não foi possível interpretar. Tente selecionar o tipo manualmente.', 'warning');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> Interpretar com IA`; }
  }
}
window.wizardAiInterpret = wizardAiInterpret;

/* ── Step 2: Dados básicos + específicos ──────────────────────────── */
function _wizStep2() {
  const w = _drm.wizard;
  const d = w.data || {};
  const type = w.type;

  let specificFields = '';
  if (type === 'viagem') specificFields = _wizFieldsViagem(d);
  else if (type === 'automovel') specificFields = _wizFieldsAutomovel(d);
  else if (type === 'imovel') specificFields = _wizFieldsImovel(d);
  else if (type === 'cirurgia_plastica') specificFields = _wizFieldsCirurgia(d);
  else if (type === 'estudos') specificFields = _wizFieldsEstudos(d);
  else if (type === 'outro') specificFields = _wizFieldsOutro(d);

  return `
  <div class="drm-wiz-step2">
    <div class="drm-wiz-headline">${_dreamTypeEmoji(type)} Detalhes do sonho</div>
    <div class="drm-wiz-form">
      <div class="form-group">
        <label class="form-label">Nome do sonho *</label>
        <input type="text" id="wizTitle" class="form-input" placeholder='Ex: Férias em Bali' value="${_esc(d.title||'')}">
      </div>
      <div class="form-group">
        <label class="form-label">Descrição (opcional)</label>
        <textarea id="wizDesc" class="form-input" rows="2" placeholder="Descreva seu sonho…">${_esc(d.description||'')}</textarea>
      </div>
      <div class="drm-form-row">
        <div class="form-group">
          <label class="form-label">Valor total estimado *</label>
          <input type="text" inputmode="numeric" id="wizAmount" class="form-input" placeholder="0,00" value="${d.target_amount||''}" oninput="_drmAmtInput(this)" onblur="_drmAmtBlur(this)">
        </div>
        <div class="form-group">
          <label class="form-label">Prazo</label>
          <input type="date" lang="pt-BR" id="wizDate" class="form-input" value="${d.target_date||''}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Prioridade</label>
        <select id="wizPriority" class="form-input">
          <option value="1" ${(d.priority||1)==1?'selected':''}>⭐ Alta</option>
          <option value="2" ${(d.priority||1)==2?'selected':''}>Média</option>
          <option value="3" ${(d.priority||1)==3?'selected':''}>Baixa</option>
        </select>
      </div>
      ${specificFields}
    </div>
  </div>`;
}

function _wizFieldsViagem(d) {
  const meta = typeof d.ai_generated_fields_json === 'object' ? (d.ai_generated_fields_json||{}) : {};
  return `
  <div class="drm-wiz-section-title">✈️ Detalhes da viagem</div>
  <div class="drm-form-row">
    <div class="form-group">
      <label class="form-label">Destino</label>
      <input type="text" id="wizDestino" class="form-input" placeholder="Ex: Portugal" value="${_esc(meta.destino||'')}">
    </div>
    <div class="form-group">
      <label class="form-label">Nº de pessoas</label>
      <input type="number" id="wizPessoas" class="form-input" min="1" max="20" placeholder="2" value="${meta.pessoas||''}">
    </div>
  </div>`;
}

function _wizFieldsAutomovel(d) {
  const meta = typeof d.ai_generated_fields_json === 'object' ? (d.ai_generated_fields_json||{}) : {};
  return `
  <div class="drm-wiz-section-title">🚗 Detalhes do veículo</div>
  <div class="drm-form-row">
    <div class="form-group">
      <label class="form-label">Marca / Modelo</label>
      <input type="text" id="wizModelo" class="form-input" placeholder="Ex: Toyota Corolla" value="${_esc(meta.modelo||'')}">
    </div>
    <div class="form-group">
      <label class="form-label">Ano (opcional)</label>
      <input type="number" id="wizAno" class="form-input" min="2000" max="2035" placeholder="${new Date().getFullYear()+1}" value="${meta.ano||''}">
    </div>
  </div>
  <div class="form-group">
    <label class="form-label">Tipo de compra</label>
    <select id="wizTipoCompra" class="form-input" onchange="_toggleFinanciamentoFields()">
      <option value="avista" ${(meta.tipo_compra||'avista')==='avista'?'selected':''}>À vista</option>
      <option value="financiado" ${meta.tipo_compra==='financiado'?'selected':''}>Entrada + Financiamento</option>
    </select>
  </div>
  <div id="wizFinancFields" style="${meta.tipo_compra==='financiado'?'':'display:none'}">
    <div class="drm-form-row">
      <div class="form-group">
        <label class="form-label">Entrada</label>
        <input type="text" inputmode="numeric" id="wizEntrada" class="form-input" placeholder="0,00" value="${meta.entrada||''}" oninput="_drmAmtInput(this)" onblur="_drmAmtBlur(this)">
      </div>
      <div class="form-group">
        <label class="form-label">Taxa juros % a.m.</label>
        <input type="number" id="wizJuros" class="form-input" step="0.01" placeholder="1,99" value="${meta.taxa_juros||''}">
      </div>
    </div>
  </div>`;
}

function _wizFieldsImovel(d) {
  const meta = typeof d.ai_generated_fields_json === 'object' ? (d.ai_generated_fields_json||{}) : {};
  return `
  <div class="drm-wiz-section-title">🏠 Detalhes do imóvel</div>
  <div class="drm-form-row">
    <div class="form-group">
      <label class="form-label">Subtipo</label>
      <select id="wizSubtipo" class="form-input">
        <option value="apartamento" ${(meta.subtipo||'apartamento')==='apartamento'?'selected':''}>Apartamento</option>
        <option value="casa" ${meta.subtipo==='casa'?'selected':''}>Casa</option>
        <option value="praia" ${meta.subtipo==='praia'?'selected':''}>Casa de Praia</option>
        <option value="campo" ${meta.subtipo==='campo'?'selected':''}>Casa de Campo</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Cidade</label>
      <input type="text" id="wizCidade" class="form-input" placeholder="Ex: São Paulo" value="${_esc(meta.cidade||'')}">
    </div>
  </div>
  <div class="form-group">
    <label class="form-label">Tipo de aquisição</label>
    <select id="wizTipoCompra" class="form-input" onchange="_toggleFinanciamentoFields()">
      <option value="avista" ${(meta.tipo_compra||'avista')==='avista'?'selected':''}>À vista</option>
      <option value="financiado" ${meta.tipo_compra==='financiado'?'selected':''}>Entrada + Financiamento</option>
    </select>
  </div>
  <div id="wizFinancFields" style="${meta.tipo_compra==='financiado'?'':'display:none'}">
    <div class="drm-form-row">
      <div class="form-group">
        <label class="form-label">Entrada</label>
        <input type="text" inputmode="numeric" id="wizEntrada" class="form-input" placeholder="0,00" value="${meta.entrada||''}" oninput="_drmAmtInput(this)" onblur="_drmAmtBlur(this)">
      </div>
      <div class="form-group">
        <label class="form-label">FGTS (opcional)</label>
        <input type="text" inputmode="numeric" id="wizFgts" class="form-input" placeholder="0,00" value="${meta.fgts||''}" oninput="_drmAmtInput(this)" onblur="_drmAmtBlur(this)">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Taxa juros % a.m.</label>
      <input type="number" id="wizJuros" class="form-input" step="0.01" placeholder="0,75" value="${meta.taxa_juros||''}">
    </div>
  </div>`;
}

function _toggleFinanciamentoFields() {
  const sel = document.getElementById('wizTipoCompra')?.value;
  const fields = document.getElementById('wizFinancFields');
  if (fields) fields.style.display = sel === 'financiado' ? '' : 'none';
}
window._toggleFinanciamentoFields = _toggleFinanciamentoFields;

/* ── Step 3: Componentes ──────────────────────────────────────────── */
function _wizStep3() {
  const w = _drm.wizard;
  const items = w.items || [];

  return `
  <div class="drm-wiz-step3">
    <div class="drm-wiz-headline">🧩 Componentes do sonho</div>
    <p class="drm-wiz-subhead">Detalhe os custos. A IA pode sugerir automaticamente baseado no seu sonho.</p>

    <div class="drm-wiz-items-toolbar">
      <span class="drm-items-total-label">Total: <strong id="wizItemsTotal">${_fmtCurrency(items.reduce((s,it)=>{const v=it.estimated_amount;return s+(typeof v==='number'?v:(parseFloat(String(v||'').replace(/\.([^,])/g,'$1').replace(',','.'))||0));},0))}</strong></span>
      <button class="btn drm-btn-ai btn-sm" onclick="wizardAiSuggestItems()">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
        Sugerir com IA
      </button>
    </div>

    <div id="wizItemsList" class="drm-wizard-items">
      ${items.map((it, i) => _renderWizItem(it, i)).join('')}
    </div>

    <div class="drm-wiz-add-item">
      <input type="text" id="wizNewItemName" class="form-input" placeholder="Nome do componente"
        onkeydown="if(event.key==='Enter')addWizItem()">
      <input type="text" inputmode="numeric" id="wizNewItemAmt" class="form-input" placeholder="0,00"
        oninput="_drmAmtInput(this)" onblur="_drmAmtBlur(this)"
        onkeydown="if(event.key==='Enter')addWizItem()">
      <button class="btn btn-secondary btn-sm" onclick="addWizItem()">+ Adicionar</button>
    </div>

    <div id="wizAiItemsLoading" style="display:none" class="drm-ai-loading">
      <div class="drm-ai-spinner"></div>IA sugerindo componentes…
    </div>
  </div>`;
}

function _renderWizItem(it, i) {
  return `
  <div class="drm-wiz-item" id="wizItem-${i}">
    ${it.is_ai_suggested ? '<span class="drm-ai-badge" title="Sugerido por IA">✨</span>' : ''}
    <input type="text" class="form-input drm-wiz-item-name" value="${_esc(it.name||'')}"
      oninput="_updateWizItem(${i},'name',this.value)">
    <input type="text" inputmode="numeric" class="form-input drm-wiz-item-amt" value="${it.estimated_amount||''}"
      oninput="_drmAmtInput(this);_updateWizItem(${i},'estimated_amount',_drmAmtVal(this));_refreshItemsTotal()" onblur="_drmAmtBlur(this)">
    <button class="drm-item-del" onclick="_removeWizItem(${i})" title="Remover">✕</button>
  </div>`;
}

function addWizItem() {
  const name = document.getElementById('wizNewItemName')?.value?.trim();
  const amt  = _drmAmtVal(document.getElementById('wizNewItemAmt'));
  if (!name) { toast('Informe o nome do componente', 'warning'); return; }
  _drm.wizard.items.push({ name, estimated_amount: amt || 0, is_ai_suggested: false });
  _refreshWizItemsList();
  if (document.getElementById('wizNewItemName')) document.getElementById('wizNewItemName').value = '';
  if (document.getElementById('wizNewItemAmt')) document.getElementById('wizNewItemAmt').value = '';
  document.getElementById('wizNewItemName')?.focus();
}
window.addWizItem = addWizItem;

function _updateWizItem(i, field, value) {
  if (_drm.wizard?.items?.[i]) _drm.wizard.items[i][field] = field === 'estimated_amount' ? (parseFloat(value)||0) : value;
}
window._updateWizItem = _updateWizItem;

function _removeWizItem(i) {
  _drm.wizard.items.splice(i, 1);
  _refreshWizItemsList();
}
window._removeWizItem = _removeWizItem;

function _refreshWizItemsList() {
  const container = document.getElementById('wizItemsList');
  if (!container) return;
  container.innerHTML = (_drm.wizard?.items || []).map((it, i) => _renderWizItem(it, i)).join('');
  _refreshItemsTotal();
}

function _refreshItemsTotal() {
  const total = (_drm.wizard?.items || []).reduce((s, it) => {
    const v = it.estimated_amount;
    const n = typeof v === 'number' ? v
            : parseFloat(String(v||'').replace(/\./g,'').replace(',','.')) || 0;
    return s + n;
  }, 0);
  const el = document.getElementById('wizItemsTotal');
  if (el) el.innerHTML = _fmtCurrency(total);
}
window._refreshItemsTotal = _refreshItemsTotal;

async function wizardAiSuggestItems() {
  const w = _drm.wizard;
  if (!w) return;

  const apiKey = await getGeminiApiKey();
  if (!apiKey || !apiKey.startsWith('AIza')) {
    toast('Configure a chave Gemini para usar sugestões por IA', 'warning');
    return;
  }

  const loading = document.getElementById('wizAiItemsLoading');
  if (loading) loading.style.display = '';

  const title  = document.getElementById('wizTitle')?.value || w.data?.title || '';
  const amount = document.getElementById('wizAmount')?.value || w.data?.target_amount || 0;
  const type   = w.type;

  // Gather type-specific fields
  const extra = {};
  if (type === 'viagem') {
    extra.destino  = document.getElementById('wizDestino')?.value || '';
    extra.pessoas  = document.getElementById('wizPessoas')?.value || 2;
  } else if (type === 'automovel') {
    extra.modelo = document.getElementById('wizModelo')?.value || '';
    extra.tipo_compra = document.getElementById('wizTipoCompra')?.value || 'avista';
  } else if (type === 'imovel') {
    extra.subtipo  = document.getElementById('wizSubtipo')?.value || '';
    extra.cidade   = document.getElementById('wizCidade')?.value || '';
    extra.tipo_compra = document.getElementById('wizTipoCompra')?.value || 'avista';
  } else if (type === 'cirurgia_plastica') {
    extra.tipo_cirurgia = document.getElementById('wizTipoCirurgia')?.value || '';
    extra.medico        = document.getElementById('wizMedico')?.value || '';
    extra.clinica       = document.getElementById('wizClinica')?.value || '';
    extra.protese       = document.getElementById('wizProtese')?.value || '';
    extra.custo_anestesia = _drmAmtVal(document.getElementById('wizCustoAnestesia')) || 0;
    extra.custo_hospital  = _drmAmtVal(document.getElementById('wizCustoHospital')) || 0;
    extra.custo_exames    = _drmAmtVal(document.getElementById('wizCustoExames')) || 0;
  } else if (type === 'estudos') {
    extra.tipo_estudo   = document.getElementById('wizTipoEstudo')?.value || '';
    extra.instituicao   = document.getElementById('wizInstituicao')?.value || '';
    extra.pais          = document.getElementById('wizPaisEstudo')?.value || '';
    extra.duracao_meses = parseInt(document.getElementById('wizDuracaoEstudo')?.value) || 0;
    extra.custo_mensalidade = _drmAmtVal(document.getElementById('wizCustoMensalidade')) || 0;
    extra.custo_moradia = _drmAmtVal(document.getElementById('wizCustoMoradia')) || 0;
    extra.custo_passagem = _drmAmtVal(document.getElementById('wizCustoPassagem')) || 0;
    extra.moeda         = document.getElementById('wizMoedaEstudo')?.value || 'BRL';
  } else if (type === 'outro') {
    extra.categoria = document.getElementById('wizOutroCategoria')?.value || '';
    extra.prazo_meses = parseInt(document.getElementById('wizOutroPrazo')?.value) || 0;
    extra.detalhes  = document.getElementById('wizOutroDetalhes')?.value || '';
  }

  const prompt = `Tipo: ${type}
Título: ${title}
Valor total: R$ ${amount}
Contexto: ${JSON.stringify(extra)}

Retorne APENAS JSON sem markdown:
{
  "componentes": [
    { "nome": "Passagem aérea", "valor_estimado": 3000, "percentual": 25 },
    ...
  ]
}

Regras:
- Sugira 6-12 componentes relevantes para o tipo "${type}"
- A soma dos valores deve ser próxima ao valor total: R$ \${amount}
- Valores em BRL, realistas para o Brasil em 2025`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${RECEIPT_AI_MODEL}:generateContent?key=${apiKey}`;
    const _d3 = await geminiRetryFetch(url, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 800 },
    });
    const result = _parseGeminiJSON(_d3);

    const newItems = (result.componentes || []).map(c => ({
      name: c.nome,
      estimated_amount: c.valor_estimado || 0,
      is_ai_suggested: true,
    }));

    // Merge: keep manual items, replace AI items
    const manual = (w.items || []).filter(it => !it.is_ai_suggested);
    w.items = [...manual, ...newItems];
    _refreshWizItemsList();
    toast(`✨ IA sugeriu ${newItems.length} componentes`, 'success');
  } catch (e) {
    toast('Erro ao sugerir componentes. Tente novamente.', 'warning');
  } finally {
    if (loading) loading.style.display = 'none';
  }
}
window.wizardAiSuggestItems = wizardAiSuggestItems;

/* ── Step 4: Revisão ──────────────────────────────────────────────── */
function _wizStep4() {
  const w = _drm.wizard;
  const title    = document.getElementById('wizTitle')?.value || w.data?.title || '—';
  const amount   = (_drmAmtVal(document.getElementById('wizAmount')) || parseFloat(w.data?.target_amount) || 0);
  const date     = document.getElementById('wizDate')?.value || w.data?.target_date || '';
  const priority = parseInt(document.getElementById('wizPriority')?.value || w.data?.priority || 1);
  const items    = w.items || [];
  const totalItems = items.reduce((s, it) => s + (parseFloat(it.estimated_amount)||0), 0);
  const months   = date ? (() => {
    const now = new Date(), end = new Date(date);
    return Math.max(0, (end.getFullYear()-now.getFullYear())*12+(end.getMonth()-now.getMonth()));
  })() : null;
  const monthly  = months ? (amount / months) : null;
  const prioLabel = ['', '⭐ Alta', 'Média', 'Baixa'][priority] || '';

  return `
  <div class="drm-wiz-step4">
    <div class="drm-wiz-headline">📋 Revisão do sonho</div>
    <p class="drm-wiz-subhead">Confirme os dados antes de salvar. Você poderá editar a qualquer momento.</p>

    <div class="drm-review-card">
      <div class="drm-review-hero">
        <span class="drm-review-emoji">${_dreamTypeEmoji(w.type)}</span>
        <div>
          <div class="drm-review-title">${_esc(title)}</div>
          <div class="drm-review-type">${_dreamTypeLabel(w.type)} · Prioridade: ${prioLabel}</div>
        </div>
      </div>

      <div class="drm-review-grid">
        <div class="drm-review-item">
          <span class="drm-review-label">Valor meta</span>
          <span class="drm-review-value">${_fmtCurrency(amount)}</span>
        </div>
        ${date ? `<div class="drm-review-item">
          <span class="drm-review-label">Prazo</span>
          <span class="drm-review-value">${new Date(date).toLocaleDateString('pt-BR', {month:'long',year:'numeric'})}</span>
        </div>` : ''}
        ${months !== null ? `<div class="drm-review-item">
          <span class="drm-review-label">Meses</span>
          <span class="drm-review-value">${months} meses</span>
        </div>` : ''}
        ${monthly !== null ? `<div class="drm-review-item">
          <span class="drm-review-label">Economia/mês</span>
          <span class="drm-review-value accent">${_fmtCurrency(monthly)}</span>
        </div>` : ''}
        ${items.length ? `<div class="drm-review-item">
          <span class="drm-review-label">Componentes</span>
          <span class="drm-review-value">${items.length} itens · ${_fmtCurrency(totalItems)}</span>
        </div>` : ''}
      </div>

      ${items.length ? `
      <div class="drm-review-items-preview">
        ${items.slice(0,5).map(it => `
        <div class="drm-review-item-row">
          ${it.is_ai_suggested ? '<span class="drm-ai-badge">✨</span>' : ''}
          <span>${_esc(it.name)}</span>
          <span>${_fmtCurrency(parseFloat(it.estimated_amount)||0)}</span>
        </div>`).join('')}
        ${items.length > 5 ? `<div class="drm-review-more">+ ${items.length-5} mais…</div>` : ''}
      </div>` : ''}
    </div>

    <div class="drm-review-note">
      Após salvar, a IA pode analisar a viabilidade do sonho com base nos seus dados financeiros reais.
    </div>
  </div>`;
}

/* ── Wizard navigation ────────────────────────────────────────────── */
function wizardNext() {
  const w = _drm.wizard;
  if (!w) return;

  if (w.step === 1) {
    if (!w.type) { toast('Selecione um tipo de sonho', 'warning'); return; }
    w.step = 2;
  } else if (w.step === 2) {
    const title  = document.getElementById('wizTitle')?.value?.trim();
    const amount = _drmAmtVal(document.getElementById('wizAmount'));
    if (!title) { toast('Informe o nome do sonho', 'warning'); return; }
    if (!amount || amount <= 0) { toast('Informe o valor estimado', 'warning'); return; }
    // Persist step 2 data
    w.data.title = title;
    w.data.description = document.getElementById('wizDesc')?.value?.trim() || '';
    w.data.target_amount = amount;
    w.data.target_date   = document.getElementById('wizDate')?.value || null;
    w.data.priority      = parseInt(document.getElementById('wizPriority')?.value || 1);
    // Type-specific fields
    if (w.type === 'viagem') {
      w.data.ai_generated_fields_json = {
        destino:  document.getElementById('wizDestino')?.value || '',
        pessoas:  document.getElementById('wizPessoas')?.value || '',
      };
    } else if (w.type === 'automovel') {
      w.data.ai_generated_fields_json = {
        modelo:     document.getElementById('wizModelo')?.value || '',
        ano:        document.getElementById('wizAno')?.value || '',
        tipo_compra: document.getElementById('wizTipoCompra')?.value || 'avista',
        entrada:    _drmAmtVal(document.getElementById('wizEntrada')) || 0,
        taxa_juros: parseFloat(document.getElementById('wizJuros')?.value) || 0,
      };
    } else if (w.type === 'imovel') {
      w.data.ai_generated_fields_json = {
        subtipo:    document.getElementById('wizSubtipo')?.value || '',
        cidade:     document.getElementById('wizCidade')?.value || '',
        tipo_compra: document.getElementById('wizTipoCompra')?.value || 'avista',
        entrada:    _drmAmtVal(document.getElementById('wizEntrada')) || 0,
        fgts:       _drmAmtVal(document.getElementById('wizFgts')) || 0,
        taxa_juros: parseFloat(document.getElementById('wizJuros')?.value) || 0,
      };
    } else if (w.type === 'cirurgia_plastica') {
      w.data.ai_generated_fields_json = {
        tipo_cirurgia:   document.getElementById('wizTipoCirurgia')?.value || '',
        medico:          document.getElementById('wizMedico')?.value || '',
        clinica:         document.getElementById('wizClinica')?.value || '',
        protese:         document.getElementById('wizProtese')?.value || '',
        custo_medico:    _drmAmtVal(document.getElementById('wizCustoMedico')) || 0,
        custo_anestesia: _drmAmtVal(document.getElementById('wizCustoAnestesia')) || 0,
        custo_hospital:  _drmAmtVal(document.getElementById('wizCustoHospital')) || 0,
        custo_exames:    _drmAmtVal(document.getElementById('wizCustoExames')) || 0,
      };
    } else if (w.type === 'estudos') {
      w.data.ai_generated_fields_json = {
        tipo_estudo:      document.getElementById('wizTipoEstudo')?.value || '',
        instituicao:      document.getElementById('wizInstituicao')?.value || '',
        pais:             document.getElementById('wizPaisEstudo')?.value || '',
        duracao_meses:    parseInt(document.getElementById('wizDuracaoEstudo')?.value) || 0,
        custo_mensalidade: _drmAmtVal(document.getElementById('wizCustoMensalidade')) || 0,
        custo_moradia:    _drmAmtVal(document.getElementById('wizCustoMoradia')) || 0,
        custo_passagem:   _drmAmtVal(document.getElementById('wizCustoPassagem')) || 0,
        moeda:            document.getElementById('wizMoedaEstudo')?.value || 'BRL',
      };
    } else if (w.type === 'outro') {
      w.data.ai_generated_fields_json = {
        categoria:    document.getElementById('wizOutroCategoria')?.value || '',
        prazo_meses:  parseInt(document.getElementById('wizOutroPrazo')?.value) || 0,
        detalhes:     document.getElementById('wizOutroDetalhes')?.value || '',
      };
    }
    w.step = 3;
  } else if (w.step === 3) {
    // Sync items from DOM before moving
    const nameEls = document.querySelectorAll('.drm-wiz-item-name');
    const amtEls  = document.querySelectorAll('.drm-wiz-item-amt');
    w.items = Array.from(nameEls).map((el, i) => ({
      name: el.value,
      estimated_amount: _drmAmtVal(amtEls[i]) || 0,
      is_ai_suggested: w.items[i]?.is_ai_suggested || false,
    })).filter(it => it.name.trim());
    w.step = 4;
  }

  _renderWizardModal();
}
window.wizardNext = wizardNext;

function wizardBack() {
  if (_drm.wizard && _drm.wizard.step > 1) {
    _drm.wizard.step--;
    _renderWizardModal();
  }
}
window.wizardBack = wizardBack;

/* ── Save dream ───────────────────────────────────────────────────── */
// ── Campos específicos: Cirurgia Plástica ────────────────────────────────
function _wizFieldsCirurgia(d) {
  const meta = typeof d.ai_generated_fields_json === 'object' ? (d.ai_generated_fields_json || {}) : {};
  return `
  <div class="drm-wiz-section-title">💉 Detalhes da Cirurgia</div>
  <div class="drm-form-row">
    <div class="form-group">
      <label class="form-label">Tipo de Cirurgia</label>
      <select id="wizTipoCirurgia" class="form-input">
        <option value="">— Selecionar —</option>
        <option value="rinoplastia" ${meta.tipo_cirurgia==='rinoplastia'?'selected':''}>Rinoplastia</option>
        <option value="mastoplastia" ${meta.tipo_cirurgia==='mastoplastia'?'selected':''}>Mastoplastia (implante)</option>
        <option value="lipoaspiracao" ${meta.tipo_cirurgia==='lipoaspiracao'?'selected':''}>Lipoaspiração</option>
        <option value="abdominoplastia" ${meta.tipo_cirurgia==='abdominoplastia'?'selected':''}>Abdominoplastia</option>
        <option value="bichectomia" ${meta.tipo_cirurgia==='bichectomia'?'selected':''}>Bichectomia</option>
        <option value="otoplastia" ${meta.tipo_cirurgia==='otoplastia'?'selected':''}>Otoplastia</option>
        <option value="blefaroplastia" ${meta.tipo_cirurgia==='blefaroplastia'?'selected':''}>Blefaroplastia</option>
        <option value="ritidoplastia" ${meta.tipo_cirurgia==='ritidoplastia'?'selected':''}>Ritidoplastia (face)</option>
        <option value="outro" ${meta.tipo_cirurgia==='outro'?'selected':''}>Outro</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Médico / Cirurgião</label>
      <input type="text" id="wizMedico" class="form-input" placeholder="Dr(a). Nome" value="${_esc(meta.medico||'')}">
    </div>
  </div>
  <div class="drm-form-row">
    <div class="form-group">
      <label class="form-label">Clínica / Hospital</label>
      <input type="text" id="wizClinica" class="form-input" placeholder="Nome da clínica" value="${_esc(meta.clinica||'')}">
    </div>
    <div class="form-group">
      <label class="form-label">Prótese / Implante</label>
      <input type="text" id="wizProtese" class="form-input" placeholder="Marca e tamanho (ex: 300cc)" value="${_esc(meta.protese||'')}">
    </div>
  </div>
  <div class="drm-wiz-section-title" style="margin-top:10px">💰 Detalhamento de Custos</div>
  <div class="drm-form-row">
    <div class="form-group">
      <label class="form-label">Honorários do médico (R$)</label>
      <input type="text" inputmode="numeric" id="wizCustoMedico" class="form-input" placeholder="0,00" value="${meta.custo_medico||''}" oninput="_wizSomaCirurgia();_drmAmtInput(this)" onblur="_drmAmtBlur(this)">
    </div>
    <div class="form-group">
      <label class="form-label">Anestesia (R$)</label>
      <input type="text" inputmode="numeric" id="wizCustoAnestesia" class="form-input" placeholder="0,00" value="${meta.custo_anestesia||''}" oninput="_wizSomaCirurgia();_drmAmtInput(this)" onblur="_drmAmtBlur(this)">
    </div>
  </div>
  <div class="drm-form-row">
    <div class="form-group">
      <label class="form-label">Hospital / Clínica (R$)</label>
      <input type="text" inputmode="numeric" id="wizCustoHospital" class="form-input" placeholder="0,00" value="${meta.custo_hospital||''}" oninput="_wizSomaCirurgia();_drmAmtInput(this)" onblur="_drmAmtBlur(this)">
    </div>
    <div class="form-group">
      <label class="form-label">Exames pré-op (R$)</label>
      <input type="text" inputmode="numeric" id="wizCustoExames" class="form-input" placeholder="0,00" value="${meta.custo_exames||''}" oninput="_wizSomaCirurgia();_drmAmtInput(this)" onblur="_drmAmtBlur(this)">
    </div>
  </div>
  <div style="margin-top:6px;padding:8px 12px;background:var(--accent-lt);border-radius:8px;font-size:.8rem;color:var(--accent);font-weight:600" id="wizCirurgiaTotal" style="display:none"></div>`;
}

function _wizSomaCirurgia() {
  const ids = ['wizCustoMedico','wizCustoAnestesia','wizCustoHospital','wizCustoExames'];
  const total = ids.reduce((s,id) => s + (_drmAmtVal(document.getElementById(id)) || 0), 0);
  const el = document.getElementById('wizCirurgiaTotal');
  if (el) {
    el.textContent = total > 0
      ? '💰 Total estimado: ' + (typeof fmt === 'function' ? fmt(total) : 'R$ ' + total.toLocaleString('pt-BR',{minimumFractionDigits:2}))
      : '';
    el.style.display = total > 0 ? '' : 'none';
    // Sugerir preenchimento do valor total do sonho se ainda estiver vazio
    const amtEl = document.getElementById('wizAmount');
    if (amtEl && !amtEl.dataset.cents && !amtEl.value && total > 0) {
      const cents = Math.round(total * 100);
      amtEl.dataset.cents = String(cents);
      amtEl.value = Math.floor(cents/100).toLocaleString('pt-BR') + ',' + String(cents%100).padStart(2,'0');
    }
  }
}
window._wizSomaCirurgia = _wizSomaCirurgia;

// ── Campos específicos: Estudos ───────────────────────────────────────────
function _wizFieldsEstudos(d) {
  const meta = typeof d.ai_generated_fields_json === 'object' ? (d.ai_generated_fields_json || {}) : {};
  return `
  <div class="drm-wiz-section-title">🎓 Detalhes dos Estudos</div>
  <div class="drm-form-row">
    <div class="form-group">
      <label class="form-label">Tipo de Estudo</label>
      <select id="wizTipoEstudo" class="form-input">
        <option value="">— Selecionar —</option>
        <option value="graduacao" ${meta.tipo_estudo==='graduacao'?'selected':''}>Graduação</option>
        <option value="pos_graduacao" ${meta.tipo_estudo==='pos_graduacao'?'selected':''}>Pós-graduação / MBA</option>
        <option value="mestrado" ${meta.tipo_estudo==='mestrado'?'selected':''}>Mestrado</option>
        <option value="doutorado" ${meta.tipo_estudo==='doutorado'?'selected':''}>Doutorado</option>
        <option value="intercambio" ${meta.tipo_estudo==='intercambio'?'selected':''}>Intercâmbio</option>
        <option value="curso_tecnico" ${meta.tipo_estudo==='curso_tecnico'?'selected':''}>Curso Técnico</option>
        <option value="idiomas" ${meta.tipo_estudo==='idiomas'?'selected':''}>Idiomas</option>
        <option value="outro" ${meta.tipo_estudo==='outro'?'selected':''}>Outro</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Instituição</label>
      <input type="text" id="wizInstituicao" class="form-input" placeholder="Ex: USP, FGV, MIT…" value="${_esc(meta.instituicao||'')}">
    </div>
  </div>
  <div class="drm-form-row">
    <div class="form-group">
      <label class="form-label">País</label>
      <input type="text" id="wizPaisEstudo" class="form-input" placeholder="Ex: Brasil, EUA, Portugal" value="${_esc(meta.pais||'')}">
    </div>
    <div class="form-group">
      <label class="form-label">Moeda</label>
      <select id="wizMoedaEstudo" class="form-input">
        <option value="BRL" ${(meta.moeda||'BRL')==='BRL'?'selected':''}>BRL — Real</option>
        <option value="USD" ${meta.moeda==='USD'?'selected':''}>USD — Dólar</option>
        <option value="EUR" ${meta.moeda==='EUR'?'selected':''}>EUR — Euro</option>
        <option value="GBP" ${meta.moeda==='GBP'?'selected':''}>GBP — Libra</option>
        <option value="CAD" ${meta.moeda==='CAD'?'selected':''}>CAD — Dólar Canadense</option>
      </select>
    </div>
  </div>
  <div class="drm-form-row">
    <div class="form-group">
      <label class="form-label">Duração (meses)</label>
      <input type="number" id="wizDuracaoEstudo" class="form-input" placeholder="Ex: 24" min="1" max="120" value="${meta.duracao_meses||''}">
    </div>
    <div class="form-group">
      <label class="form-label">Mensalidade</label>
      <input type="text" inputmode="numeric" id="wizCustoMensalidade" class="form-input" placeholder="0,00" value="${meta.custo_mensalidade||''}" oninput="_wizSomaEstudos();_drmAmtInput(this)" onblur="_drmAmtBlur(this)">
    </div>
  </div>
  <div class="drm-wiz-section-title" style="margin-top:10px">✈️ Custos Adicionais</div>
  <div class="drm-form-row">
    <div class="form-group">
      <label class="form-label">Moradia (por mês)</label>
      <input type="text" inputmode="numeric" id="wizCustoMoradia" class="form-input" placeholder="0,00" value="${meta.custo_moradia||''}" oninput="_wizSomaEstudos();_drmAmtInput(this)" onblur="_drmAmtBlur(this)">
    </div>
    <div class="form-group">
      <label class="form-label">Passagem (total)</label>
      <input type="text" inputmode="numeric" id="wizCustoPassagem" class="form-input" placeholder="0,00" value="${meta.custo_passagem||''}" oninput="_wizSomaEstudos();_drmAmtInput(this)" onblur="_drmAmtBlur(this)">
    </div>
  </div>
  <div style="margin-top:6px;padding:8px 12px;background:var(--accent-lt);border-radius:8px;font-size:.8rem;color:var(--accent);font-weight:600" id="wizEstudosTotal"></div>`;
}

function _wizSomaEstudos() {
  const meses       = parseInt(document.getElementById('wizDuracaoEstudo')?.value) || 1;
  const mensalidade = _drmAmtVal(document.getElementById('wizCustoMensalidade')) || 0;
  const moradia     = _drmAmtVal(document.getElementById('wizCustoMoradia')) || 0;
  const passagem    = _drmAmtVal(document.getElementById('wizCustoPassagem')) || 0;
  const total = (mensalidade + moradia) * meses + passagem;
  const el = document.getElementById('wizEstudosTotal');
  if (el) {
    el.textContent = total > 0
      ? '💰 Total estimado: ' + (typeof fmt === 'function' ? fmt(total) : 'R$ ' + total.toFixed(2)) + ` (${meses} meses)`
      : '';
    const amtEl = document.getElementById('wizAmount');
    if (amtEl && !amtEl.dataset.cents && !amtEl.value && total > 0) {
      const cents = Math.round(total * 100);
      amtEl.dataset.cents = String(cents);
      amtEl.value = Math.floor(cents/100).toLocaleString('pt-BR') + ',' + String(cents%100).padStart(2,'0');
    }
  }
}
window._wizSomaEstudos = _wizSomaEstudos;

// ── Campos específicos: Outro Sonho ───────────────────────────────────────
function _wizFieldsOutro(d) {
  const meta = typeof d.ai_generated_fields_json === 'object' ? (d.ai_generated_fields_json || {}) : {};
  return `
  <div class="drm-wiz-section-title">🌟 Detalhes do Objetivo</div>
  <div class="drm-form-row">
    <div class="form-group">
      <label class="form-label">Categoria do Objetivo</label>
      <select id="wizOutroCategoria" class="form-input">
        <option value="">— Selecionar —</option>
        <option value="eletronico" ${meta.categoria==='eletronico'?'selected':''}>📱 Eletrônico / Gadget</option>
        <option value="movel" ${meta.categoria==='movel'?'selected':''}>🛋️ Móvel / Decoração</option>
        <option value="evento" ${meta.categoria==='evento'?'selected':''}>🎉 Evento / Celebração</option>
        <option value="negocio" ${meta.categoria==='negocio'?'selected':''}>💼 Negócio / Empreendimento</option>
        <option value="saude" ${meta.categoria==='saude'?'selected':''}>🏥 Saúde / Bem-estar</option>
        <option value="esporte" ${meta.categoria==='esporte'?'selected':''}>⚽ Esporte / Lazer</option>
        <option value="reserva" ${meta.categoria==='reserva'?'selected':''}>🏦 Reserva de Emergência</option>
        <option value="outro" ${meta.categoria==='outro'?'selected':''}>🌟 Outro</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Prazo desejado (meses)</label>
      <input type="number" id="wizOutroPrazo" class="form-input" placeholder="Ex: 12" min="1" max="600" value="${meta.prazo_meses||''}">
    </div>
  </div>
  <div class="form-group">
    <label class="form-label">Detalhes adicionais</label>
    <textarea id="wizOutroDetalhes" class="form-input" rows="3" placeholder="Descreva o que você quer alcançar…" style="resize:vertical">${_esc(meta.detalhes||'')}</textarea>
  </div>`;
}
window._wizFieldsOutro = _wizFieldsOutro;

async function saveDream() {
  const w = _drm.wizard;
  if (!w) return;

  const btn = document.getElementById('wizSaveBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando…'; }

  const fid = famId();

  // Ensure target_amount is a valid number
  const _finalAmount = parseFloat(w.data.target_amount) || 0;

  // Ensure ai_generated_fields_json is serialized (may already be object or string)
  let _aiJson = w.data.ai_generated_fields_json || null;
  if (_aiJson && typeof _aiJson === 'object') _aiJson = JSON.stringify(_aiJson);
  else if (_aiJson === '{}' || _aiJson === 'null') _aiJson = null;

  const dreamPayload = {
    family_id:   fid,
    title:       w.data.title,
    description: w.data.description || null,
    dream_type:  w.type,
    target_amount: _finalAmount,
    currency:    w.data.currency || 'BRL',
    target_date: w.data.target_date || null,
    priority:    w.data.priority || 1,
    status:      w.data.status || 'active',
    ai_generated_fields_json: _aiJson,
    simulation_json: w.data.simulation_json || null,
    updated_at:  new Date().toISOString(),
  };
  // Only set created_by on new dreams
  if (!w.editing) dreamPayload.created_by = currentUser?.app_user_id || currentUser?.id;

  try {
    let dreamId;
    if (w.editing && w.dreamId) {
      const { error } = await sb.from('dreams').update(dreamPayload).eq('id', w.dreamId);
      if (error) throw error;
      dreamId = w.dreamId;
      // Update local cache
      const idx = _drm.dreams.findIndex(d => d.id === dreamId);
      if (idx !== -1) Object.assign(_drm.dreams[idx], dreamPayload);
    } else {
      const { data, error } = await sb.from('dreams').insert({
        ...dreamPayload,
        created_at: new Date().toISOString(),
      }).select().single();
      if (error) throw error;
      dreamId = data.id;
      data._contributions = [];
      _drm.dreams.unshift(data);
    }

    // Save items
    if (w.items.length) {
      // On edit or create: delete all existing items then re-insert current list
      // This ensures any name/value changes to manual items are also persisted
      await sb.from('dream_items').delete().eq('dream_id', dreamId);
      const itemsPayload = w.items.filter(it => it.name?.trim()).map(it => ({
        dream_id: dreamId,
        family_id: fid,
        name: it.name.trim(),
        estimated_amount: typeof it.estimated_amount === 'number'
          ? it.estimated_amount
          : (parseFloat(String(it.estimated_amount || '').replace(/\./g,'').replace(',','.')) || 0),
        is_ai_suggested: !!it.is_ai_suggested,
        created_at: new Date().toISOString(),
      }));
      if (itemsPayload.length) {
        const { error: itemErr } = await sb.from('dream_items').insert(itemsPayload);
        if (itemErr) console.warn('[Dreams] items insert error:', itemErr.message);
        _drm.items[dreamId] = itemsPayload;
      }
    }

    closeDreamWizard();
    renderDreamsPage();
    toast(w.editing ? '✓ Sonho atualizado!' : '🌟 Sonho criado! Use a IA para analisar a viabilidade.', 'success');
  } catch (e) {
    toast('Erro ao salvar sonho: ' + (e?.message || e), 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Salvar sonho'; }
  }
}
window.saveDream = saveDream;

/* ── Utility ──────────────────────────────────────────────────────── */
function _esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Init on startup ──────────────────────────────────────────────── */
// Called after auth, matches pattern of other modules
(function _dreamsAutoApply() {
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    if (typeof famId === 'function' && famId()) applyDreamsFeature().catch(() => {});
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      if (typeof famId === 'function' && famId()) applyDreamsFeature().catch(() => {});
    });
  }
})();
