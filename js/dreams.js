/**
 * dreams.js — Módulo Sonhos v2 — FinTrack
 * Sistema completo de descoberta, estimativa, execução e acompanhamento
 * de objetivos financeiros pessoais.
 */

/* ── Estado interno ───────────────────────────────────────────────── */
const _drm = {
  loaded:   false,
  dreams:   [],
  items:    {},
  wizard:   null,
  goalData: {},
};

/* ── Helpers de formato ───────────────────────────────────────────── */
function _fmtCurrency(val, currency = 'BRL') {
  if (val == null || isNaN(val)) return '—';
  try { return Number(val).toLocaleString('pt-BR', { style: 'currency', currency: currency || 'BRL' }); }
  catch { return 'R$ ' + Number(val).toFixed(2).replace('.', ','); }
}
function _fmtDate(dateStr, opts) {
  if (!dateStr) return '—';
  try { return new Date(dateStr + (dateStr.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('pt-BR', opts || { month: 'long', year: 'numeric' }); }
  catch { return dateStr; }
}
function _esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── SQL de migração: adicionar tipo 'outro' ao CHECK constraint ────────────
// Execute no Supabase SQL Editor se a coluna ainda não aceitar 'outro':
const DREAMS_MIGRATION_SQL = `-- Adicionar tipo 'outro' ao dreams_dream_type_check
-- Execute no Supabase SQL Editor:
ALTER TABLE dreams DROP CONSTRAINT IF EXISTS dreams_dream_type_check;
ALTER TABLE dreams ADD CONSTRAINT dreams_dream_type_check
  CHECK (dream_type IN ('viagem', 'automovel', 'imovel', 'outro'));
-- Converter registros com tipo inválido para 'outro':
UPDATE dreams SET dream_type = 'outro'
  WHERE dream_type NOT IN ('viagem', 'automovel', 'imovel', 'outro');`;
window.DREAMS_MIGRATION_SQL = DREAMS_MIGRATION_SQL;

function _dreamTypeEmoji(t) { return { viagem:'✈️', automovel:'🚗', imovel:'🏠', cirurgia_plastica:'💆', estudos:'🎓', outro:'🌟' }[t] || '🌟'; }
function _dreamTypeLabel(t) { return { viagem:'✈️ Viagem', automovel:'🚗 Automóvel', imovel:'🏠 Imóvel', cirurgia_plastica:'💆 Cirurgia Plástica', estudos:'🎓 Estudos', outro:'🌟 Outro' }[t] || '🌟 Outro'; }
function _dreamStatusLabel(s) { return { active:'Ativo', paused:'Pausado', achieved:'🏆 Conquistado', cancelled:'Cancelado' }[s] || s; }
function _dreamStatusColor(s) { return { active:'var(--accent)', paused:'var(--warning, #f39c12)', achieved:'#27ae60', cancelled:'var(--muted)' }[s] || 'var(--muted)'; }

/* ── Feature flag ─────────────────────────────────────────────────── */
async function isDreamsEnabled() {
  const fid = famId();
  if (!fid) return false;

  // Fonte canônica atual: preferências da família.
  if (typeof isModuleEnabled === 'function') {
    try {
      const byPrefs = isModuleEnabled('dreams');
      if (byPrefs === true) return true;
    } catch (_) {}
  }

  // Fallback legado: app_settings / cache antigo.
  const ck = 'dreams_enabled_' + fid;
  if (window._familyFeaturesCache && ck in window._familyFeaturesCache) return !!window._familyFeaturesCache[ck];
  try {
    const raw = await getAppSetting(ck, false);
    const on = raw === true || raw === 'true';
    (window._familyFeaturesCache = window._familyFeaturesCache || {})[ck] = on;
    return on;
  } catch (_) {
    return false;
  }
}
async function applyDreamsFeature() {
  const fid = famId();
  const navEl = document.getElementById('dreamsNav'), pageEl = document.getElementById('page-dreams');
  if (!fid) { if (navEl) navEl.style.display='none'; if (typeof _syncModulesSection==='function') _syncModulesSection(); return; }
  const on = await isDreamsEnabled();
  if (navEl) { navEl.style.display = on?'':'none'; navEl.dataset.featureControlled='1'; }
  if (pageEl) pageEl.style.display = on?'':'none';
  if (typeof _syncModulesSection==='function') _syncModulesSection();
  if (on && !_drm.loaded) await loadDreams().catch(()=>{});
}
window.applyDreamsFeature = applyDreamsFeature;

async function toggleFamilyDreams(familyId, enabled) {
  await saveAppSetting('dreams_enabled_' + familyId, enabled);
  (window._familyFeaturesCache=window._familyFeaturesCache||{})['dreams_enabled_'+familyId] = enabled;
  applyDreamsFeature().catch(()=>{});
  toast(enabled ? '✓ Sonhos ativado' : 'Sonhos desativado', 'success');
}
window.toggleFamilyDreams = toggleFamilyDreams;

/* ── Page init ────────────────────────────────────────────────────── */
async function initDreamsPage() {
  const container = document.getElementById('dreams-list-container');
  const enabled = await isDreamsEnabled();
  if (!enabled) {
    if (container) {
      container.innerHTML = `
        <div class="drm-empty-state">
          <div class="drm-empty-icon">🌟</div>
          <div class="drm-empty-title">Módulo de sonhos desativado</div>
          <div class="drm-empty-text">Ative o módulo em Gestão da Família para voltar a usar esta área.</div>
        </div>`;
    }
    return;
  }
  await loadDreams(true);
  renderDreamsPage();
}
window.initDreamsPage = initDreamsPage;

/* ── Data loading ─────────────────────────────────────────────────── */
async function loadDreams(force=false) {
  if (_drm.loaded && !force) return;
  try {
    const { data, error } = await famQ(sb.from('dreams').select('*')).order('priority',{ascending:true}).order('created_at',{ascending:false});
    if (error) {
      if (error.code==='42P01'||error.message?.includes('does not exist')) {
        const c = document.getElementById('dreams-list-container');
        if (c) c.innerHTML=`<div class="drm-empty"><div class="drm-empty-icon">⚠️</div><div class="drm-empty-title">Migração pendente</div><div class="drm-empty-desc">Execute o script SQL v2 no Supabase.</div></div>`;
        return;
      }
      throw error;
    }
    _drm.dreams = data || [];
    if (_drm.dreams.length) {
      const ids = _drm.dreams.map(d=>d.id);
      const { data: items } = await sb.from('dream_items').select('*').in('dream_id',ids).order('estimated_amount',{ascending:false});
      _drm.items = {};
      (items||[]).forEach(it=>{ (_drm.items[it.dream_id]=_drm.items[it.dream_id]||[]).push(it); });
      const { data: contribs } = await sb.from('dream_contributions').select('*').in('dream_id',ids).order('date',{ascending:false});
      (contribs||[]).forEach(c=>{ const d=_drm.dreams.find(d=>d.id===c.dream_id); if(d){(d._contributions=d._contributions||[]).push(c);} });
    }
    _drm.loaded = true;
  } catch(e) { console.warn('[Dreams] loadDreams:',e?.message||e); _drm.dreams=[]; _drm.loaded=true; }
}

/* ── Goal Engine ──────────────────────────────────────────────────── */
async function _computeGoalData(dream) {
  const accs = state.accounts||[], buds=state.budgets||[], txAll=state.transactions||[];

  /* Conta vinculada */
  let linkedAccBalance=0, linkedAccName=null;
  const linkedAcc = dream.linked_account_id ? accs.find(a=>a.id===dream.linked_account_id) : null;
  if (linkedAcc) { linkedAccBalance=parseFloat(linkedAcc.balance)||0; linkedAccName=linkedAcc.name; }

  /* Contribuições manuais */
  const contribs = dream._contributions||[];
  const totalManual = contribs.reduce((s,c)=>s+(parseFloat(c.amount)||0),0);
  const currentSaved = dream.linked_account_id ? linkedAccBalance : totalManual;

  /* Orçamento vinculado */
  const linkedBudget = dream.linked_budget_id ? buds.find(b=>b.id===dream.linked_budget_id)||null : null;

  /* Aporte médio mensal real */
  let avgMonthlyContrib=0;
  if (contribs.length>=2) {
    const sorted=[...contribs].sort((a,b)=>new Date(a.date)-new Date(b.date));
    const months=Math.max(1,(new Date(sorted[sorted.length-1].date).getTime()-new Date(sorted[0].date).getTime())/(1000*60*60*24*30.5));
    avgMonthlyContrib = totalManual/months;
  } else if (contribs.length===1) avgMonthlyContrib = parseFloat(contribs[0].amount)||0;

  /* Meta e progresso */
  const target=parseFloat(dream.target_amount)||0;
  const remaining=Math.max(0,target-currentSaved);
  const pct = target>0 ? Math.min(100,(currentSaved/target)*100) : 0;

  /* Prazo */
  let targetMonths=null;
  if (dream.target_date) {
    const now=new Date(), end=new Date(dream.target_date+'T12:00:00');
    targetMonths=Math.max(1,(end.getFullYear()-now.getFullYear())*12+(end.getMonth()-now.getMonth()));
  }

  const budgetedMonthly = linkedBudget ? (parseFloat(linkedBudget.amount)||0) : 0;
  const recommendedMonthly = targetMonths ? Math.ceil(remaining/targetMonths) : 0;
  const effectiveMonthly = budgetedMonthly||avgMonthlyContrib||recommendedMonthly;

  /* Projeção */
  let projectedMonths=null, projectedDate=null;
  if (effectiveMonthly>0 && remaining>0) {
    projectedMonths = Math.ceil(remaining/effectiveMonthly);
    const pd=new Date(); pd.setMonth(pd.getMonth()+projectedMonths);
    projectedDate = pd.toISOString().slice(0,7);
  } else if (remaining<=0) { projectedMonths=0; projectedDate=new Date().toISOString().slice(0,7); }

  /* Sugestões de economia */
  const suggestions = _computeAccelerationSuggestions(txAll, remaining, projectedMonths);

  const gd = { currentSaved, linkedAccBalance, linkedAccName, linkedAcc, target, remaining, pct, targetMonths, recommendedMonthly, avgMonthlyContrib, budgetedMonthly, effectiveMonthly, projectedMonths, projectedDate, linkedBudget, suggestions };
  _drm.goalData[dream.id] = gd;
  return gd;
}

function _computeAccelerationSuggestions(txAll, remaining, projectedMonths) {
  if (!txAll.length || !remaining) return [];
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate()-90);
  const recent = txAll.filter(t=>!t.is_transfer&&!t.is_card_payment&&(parseFloat(t.amount)||0)<0&&new Date(t.date)>=cutoff);
  if (!recent.length) return [];
  const byCat={};
  for (const tx of recent) {
    const cn = tx._categoryName||tx.category_name||'Outros';
    if(!byCat[cn]) byCat[cn]={total:0,count:0};
    byCat[cn].total+=Math.abs(parseFloat(tx.amount)||0); byCat[cn].count+=1;
  }
  const elastic=['delivery','ifood','uber','lazer','entreten','assinatura','streaming','fastfood','bar','restaurante'];
  const suggestions=[];
  for (const [cat,data] of Object.entries(byCat)) {
    const monthly=data.total/3; const catLow=cat.toLowerCase();
    const isElastic=elastic.some(k=>catLow.includes(k));
    if (monthly<50) continue;
    const reduction=Math.round(monthly*(isElastic?.30:.15));
    if (reduction<30) continue;
    const monthsEarned = projectedMonths&&reduction>0 ? Math.max(1,Math.round(projectedMonths*reduction/(remaining/projectedMonths||1)*.1)) : null;
    suggestions.push({category:cat,monthlySpend:Math.round(monthly),reduction,monthsEarned,isElastic});
  }
  return suggestions.sort((a,b)=>b.reduction-a.reduction).slice(0,4);
}

/* ── Computed helpers simples ─────────────────────────────────────── */
function _dreamAccumulated(dream) { return (dream._contributions||[]).reduce((s,c)=>s+(parseFloat(c.amount)||0),0); }
function _dreamProgress(dream) { const t=parseFloat(dream.target_amount)||0; return t?Math.min(100,(_dreamAccumulated(dream)/t)*100):0; }
function _dreamMonthsLeft(dream) {
  if (!dream.target_date) return null;
  const now=new Date(), end=new Date(dream.target_date+'T12:00:00');
  return Math.max(0,(end.getFullYear()-now.getFullYear())*12+(end.getMonth()-now.getMonth()));
}
function _dreamMonthlySaving(dream) {
  const m=_dreamMonthsLeft(dream); if(!m) return null;
  return Math.max(0,((parseFloat(dream.target_amount)||0)-_dreamAccumulated(dream))/m);
}

/* ── Member helpers ───────────────────────────────────────────────── */
/**
 * Extrai os IDs de membros armazenados em ai_generated_fields_json.__members.
 * Retorna array vazio (= família geral) se não houver membros específicos.
 */
function _drmGetMemberIds(dream) {
  try {
    const f = dream.ai_generated_fields_json;
    const obj = typeof f === 'string' ? JSON.parse(f) : (f || {});
    const ids = obj.__members;
    return Array.isArray(ids) ? ids.filter(Boolean) : [];
  } catch { return []; }
}

/**
 * Retorna os objetos de membro para exibição.
 * Usa state.familyMembers (composição familiar carregada).
 */
function _drmGetMemberObjects(dream) {
  const ids = _drmGetMemberIds(dream);
  if (!ids.length) return []; // família geral
  const allMembers = (typeof getFamilyMembers === 'function' ? getFamilyMembers() : null)
    || (window._fmc && window._fmc.members) || [];
  return ids.map(id => allMembers.find(m => m.id === id)).filter(Boolean);
}

/**
 * Renderiza chips de membros (inline, compacto) para card e detail.
 * Se não houver membros → exibe chip "Família".
 */
function _drmRenderMemberChips(dream, opts = {}) {
  const members = _drmGetMemberObjects(dream);
  const cls = opts.small ? 'drm-member-chip drm-member-chip--sm' : 'drm-member-chip';
  if (!members.length) {
    return `<span class="${cls} drm-member-chip--all">👨‍👩‍👧 Família</span>`;
  }
  return members.map(m => {
    const emoji = m.avatar_emoji || '👤';
    return `<span class="${cls}" title="${_esc(m.name)}">${emoji} ${_esc(m.name)}</span>`;
  }).join('');
}

/* ── Main page render ─────────────────────────────────────────────── */
function renderDreamsPage() {
  const container=document.getElementById('dreams-list-container'); if(!container) return;
  if (!_drm.dreams.length) { container.innerHTML=_renderEmptyState(); return; }
  const groups=[
    {label:'Ativos',          dreams:_drm.dreams.filter(d=>d.status==='active')},
    {label:'🏆 Conquistados', dreams:_drm.dreams.filter(d=>d.status==='achieved')},
    {label:'⏸️ Pausados',     dreams:_drm.dreams.filter(d=>d.status==='paused')},
    {label:'Cancelados',      dreams:_drm.dreams.filter(d=>d.status==='cancelled')},
  ];
  const active=groups[0].dreams;
  let html='';
  if (active.length) {
    const totalTarget=active.reduce((s,d)=>s+(parseFloat(d.target_amount)||0),0);
    const totalAcc=active.reduce((s,d)=>s+_dreamAccumulated(d),0);
    const pct=totalTarget?Math.round((totalAcc/totalTarget)*100):0;
    html+=`<div class="drm-summary-bar">
      <div class="drm-summary-item"><span class="drm-summary-label">Sonhos ativos</span><span class="drm-summary-value">${active.length}</span></div>
      <div class="drm-summary-item"><span class="drm-summary-label">Total planejado</span><span class="drm-summary-value">${state.privacyMode?'••••':_fmtCurrency(totalTarget)}</span></div>
      <div class="drm-summary-item"><span class="drm-summary-label">Acumulado</span><span class="drm-summary-value accent">${state.privacyMode?'••••':_fmtCurrency(totalAcc)}</span></div>
      <div class="drm-summary-item"><span class="drm-summary-label">Progresso geral</span><span class="drm-summary-value">${pct}%</span></div>
    </div>`;
  }
  for (const g of groups) {
    if (!g.dreams.length) continue;
    html+=`<div class="drm-group-label">${g.label}</div><div class="drm-cards-grid">`;
    for (const d of g.dreams) html+=_renderDreamCard(d);
    html+=`</div>`;
  }
  container.innerHTML=html;
}

function _renderEmptyState() {
  return `<div class="drm-empty">
    <div class="drm-empty-icon">🌟</div>
    <div class="drm-empty-title">Seus sonhos começam aqui</div>
    <div class="drm-empty-desc">Transforme objetivos em metas financeiras reais. Crie contas dedicadas, defina aportes mensais e veja quando vai realizar cada sonho.</div>
    <button class="btn btn-primary" onclick="openDreamWizard()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Criar meu primeiro sonho
    </button>
  </div>`;
}

function _renderDreamCard(d) {
  const acc=_dreamAccumulated(d), target=parseFloat(d.target_amount)||0;
  const pct=target>0?Math.min(100,(acc/target)*100):0;
  const months=_dreamMonthsLeft(d), monthly=_dreamMonthlySaving(d);
  const items=_drm.items[d.id]||[], priv=state.privacyMode;
  const pc=pct>=100?'#27ae60':pct>=60?'var(--accent)':pct>=30?'var(--warning,#f39c12)':'var(--danger,#e74c3c)';
  return `<div class="drm-card drm-card--${d.dream_type}" onclick="openDreamDetail('${d.id}')">
    <div class="drm-card-header">
      <div class="drm-card-icon">${_dreamTypeEmoji(d.dream_type)}</div>
      <div class="drm-card-info">
        <div class="drm-card-title">${_esc(d.title)}</div>
        <div class="drm-card-type">${_dreamTypeLabel(d.dream_type)}</div>
      </div>
      <div class="drm-card-status" style="color:${_dreamStatusColor(d.status)}">${_dreamStatusLabel(d.status)}</div>
    </div>
    <div class="drm-card-progress-wrap">
      <div class="drm-card-progress-bar"><div class="drm-card-progress-fill" style="width:${pct}%;background:${pc}"></div></div>
      <div class="drm-card-progress-labels">
        <span>${priv?'••••':_fmtCurrency(acc,d.currency)}</span>
        <span style="font-weight:700;color:${pc}">${Math.round(pct)}%</span>
        <span>${priv?'••••':_fmtCurrency(target,d.currency)}</span>
      </div>
    </div>
    <div class="drm-card-meta">
      ${months!==null?`<span class="drm-meta-chip">📅 ${months>0?months+' meses':'Este mês!'}</span>`:''}
      ${monthly!==null&&monthly>0&&!priv?`<span class="drm-meta-chip accent">💰 ${_fmtCurrency(monthly,d.currency)}/mês</span>`:''}
      ${d.linked_account_id?`<span class="drm-meta-chip drm-meta-chip--linked">🏦 Conta</span>`:''}
      ${d.linked_budget_id?`<span class="drm-meta-chip drm-meta-chip--budget">📊 Orçamento</span>`:''}
      ${items.length?`<span class="drm-meta-chip">${items.length} itens</span>`:''}
    </div>
    <div class="drm-card-members">${_drmRenderMemberChips(d, {small:true})}</div>
    ${d.description?`<div class="drm-card-desc">${_esc(d.description).slice(0,90)}${d.description.length>90?'…':''}</div>`:''}
    <div class="drm-card-actions" onclick="event.stopPropagation()">
      <button class="drm-action-btn" onclick="openDreamDetail('${d.id}')">🎯 Ver plano</button>
      <button class="drm-action-btn" onclick="openContributeModal('${d.id}')">💰 Aporte</button>
      <button class="drm-action-btn drm-action-btn--icon" onclick="openDreamMenu('${d.id}',event)" title="Mais">⋯</button>
    </div>
  </div>`;
}

/* ── Dream detail modal ───────────────────────────────────────────── */
async function openDreamDetail(dreamId) {
  const d=_drm.dreams.find(x=>x.id===dreamId); if(!d) return;
  document.querySelectorAll('#dreamDetailModal').forEach(m=>m.remove());
  document.body.insertAdjacentHTML('beforeend',`
  <div id="dreamDetailModal" class="modal-overlay active" onclick="if(event.target===this)closeDreamDetail()">
    <div class="modal drm-detail-modal" onclick="event.stopPropagation()">
      <div class="drm-detail-header">
        <div class="drm-detail-emoji">${_dreamTypeEmoji(d.dream_type)}</div>
        <div class="drm-detail-title-block">
          <h2 class="drm-detail-title">${_esc(d.title)}</h2>
          <div class="drm-detail-subtitle">${_dreamTypeLabel(d.dream_type)} · <span style="color:${_dreamStatusColor(d.status)}">${_dreamStatusLabel(d.status)}</span></div>
        </div>
        <button class="modal-close" onclick="closeDreamDetail()">✕</button>
      </div>
      <div class="drm-detail-body" id="dreamDetailBody">
        <div class="drm-loading-skel"><div class="drm-skel-bar drm-skel-bar--tall"></div><div class="drm-skel-bar"></div><div class="drm-skel-bar drm-skel-bar--short"></div></div>
      </div>
      <div class="drm-detail-footer" id="dreamDetailFooter"><span style="color:var(--muted);font-size:.8rem">Carregando…</span></div>
    </div>
  </div>`);
  const gd = await _computeGoalData(d);
  _renderDetailBody(d,gd);
}
window.openDreamDetail = openDreamDetail;

function _renderDetailBody(d,gd) {
  const body=document.getElementById('dreamDetailBody'), footer=document.getElementById('dreamDetailFooter');
  if(!body) return;
  const items=_drm.items[d.id]||[], priv=state.privacyMode;
  const {currentSaved:acc,target,pct,remaining} = gd;
  const pc=pct>=100?'#27ae60':pct>=60?'var(--accent)':pct>=30?'var(--warning,#f39c12)':'var(--danger,#e74c3c)';
  const sim=d.simulation_json?(typeof d.simulation_json==='string'?JSON.parse(d.simulation_json):d.simulation_json):null;
  const months=gd.targetMonths;
  const cons=months?Math.ceil(remaining/(months*1.5)):null;
  const bal=months?Math.ceil(remaining/months):null;
  const agg=months?Math.ceil(remaining/Math.max(1,months*.7)):null;

  body.innerHTML=`
    <!-- Hero de progresso -->
    <div class="drm-detail-hero">
      <div class="drm-hero-top">
        <div>
          <div class="drm-hero-label">Acumulado</div>
          <div class="drm-hero-value accent">${priv?'••••':_fmtCurrency(acc,d.currency)}</div>
        </div>
        <div class="drm-hero-ring-wrap">
          <svg viewBox="0 0 36 36" width="72" height="72">
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--border)" stroke-width="3"/>
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="${pc}" stroke-width="3"
              stroke-dasharray="${((pct/100)*97.4).toFixed(1)} 97.4"
              stroke-dashoffset="24.35" stroke-linecap="round" transform="rotate(-90 18 18)"/>
          </svg>
          <span class="drm-ring-pct" style="color:${pc}">${Math.round(pct)}%</span>
        </div>
        <div style="text-align:right">
          <div class="drm-hero-label">Meta total</div>
          <div class="drm-hero-value">${priv?'••••':_fmtCurrency(target,d.currency)}</div>
        </div>
      </div>
      <div class="drm-detail-progress-bar" title="${Math.round(pct)}% atingido">
        <div class="drm-detail-progress-fill" style="width:${pct}%;background:${pc}"></div>
      </div>
      <div class="drm-hero-stats">
        <div class="drm-hero-stat"><span class="drm-hero-stat-label">Falta</span><span class="drm-hero-stat-val">${priv?'••••':_fmtCurrency(remaining,d.currency)}</span></div>
        ${months!==null?`<div class="drm-hero-stat"><span class="drm-hero-stat-label">Prazo</span><span class="drm-hero-stat-val">${months>0?months+' meses':'🎯 Este mês!'}</span></div>`:''}
        ${d.target_date?`<div class="drm-hero-stat"><span class="drm-hero-stat-label">Data alvo</span><span class="drm-hero-stat-val">${_fmtDate(d.target_date,{month:'short',year:'numeric'})}</span></div>`:''}
      </div>
    </div>

    <!-- Membros vinculados ao sonho -->
    <div class="drm-detail-section drm-members-section">
      <div class="drm-section-title">👥 Para quem é este sonho</div>
      <div class="drm-members-chips">${_drmRenderMemberChips(d)}</div>
    </div>

    <!-- Goal Engine: Plano de conquista -->
    ${_renderGoalEngine(d,gd,priv)}

    <!-- Recursos vinculados -->
    ${_renderLinkedResources(d,gd,priv)}

    <!-- Cenários -->
    ${months&&!priv&&remaining>0?`
    <div class="drm-detail-section">
      <div class="drm-section-title">📊 Cenários de aporte</div>
      <div class="drm-scenarios">
        <div class="drm-scenario drm-scenario--conservative">
          <div class="drm-scenario-label">Tranquilo</div>
          <div class="drm-scenario-desc">${cons?_fmtCurrency(cons,d.currency):'—'}</div>
          <div class="drm-scenario-period">${Math.round(months*1.5)} meses</div>
        </div>
        <div class="drm-scenario drm-scenario--balanced">
          <div class="drm-scenario-label">Equilibrado</div>
          <div class="drm-scenario-desc">${bal?_fmtCurrency(bal,d.currency):'—'}</div>
          <div class="drm-scenario-period">${months} meses</div>
        </div>
        <div class="drm-scenario drm-scenario--aggressive">
          <div class="drm-scenario-label">Acelerado</div>
          <div class="drm-scenario-desc">${agg?_fmtCurrency(agg,d.currency):'—'}</div>
          <div class="drm-scenario-period">${Math.round(months*.7)} meses</div>
        </div>
      </div>
    </div>`:''}

    <!-- Sugestões de aceleração -->
    ${_renderAccelSuggestions(gd,d.currency,priv)}

    <!-- Componentes -->
    ${items.length?`
    <div class="drm-detail-section">
      <div class="drm-section-title">🧩 Componentes (${items.length})</div>
      <div class="drm-items-list">
        ${items.map(it=>`<div class="drm-item-row">
          <div class="drm-item-name">${it.is_ai_suggested?'<span class="drm-ai-badge" title="IA">✨</span>':''} ${_esc(it.name)}</div>
          <div class="drm-item-amount">${priv?'••••':_fmtCurrency(parseFloat(it.estimated_amount)||0,d.currency)}</div>
        </div>`).join('')}
        <div class="drm-item-row drm-item-row--total">
          <div class="drm-item-name"><strong>Total</strong></div>
          <div class="drm-item-amount"><strong>${priv?'••••':_fmtCurrency(items.reduce((s,it)=>s+(parseFloat(it.estimated_amount)||0),0),d.currency)}</strong></div>
        </div>
      </div>
    </div>`:''}

    <!-- Análise IA -->
    <div class="drm-detail-section">
      <div class="drm-section-title">🤖 Análise por IA <span class="drm-ai-badge-sm">Gemini</span></div>
      <div id="dreamAiAnalysis-${d.id}" class="drm-ai-analysis-box">
        ${sim?.ai_summary?`<div class="drm-ai-text">${sim.ai_summary}</div>
          <button class="btn btn-sm drm-btn-ai" style="margin-top:8px" onclick="runDreamAiAnalysis('${d.id}')">🔄 Reanalisar</button>`
          :`<div class="drm-ai-placeholder">
            <button class="btn btn-sm drm-btn-ai" onclick="runDreamAiAnalysis('${d.id}')">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
              Analisar viabilidade com IA
            </button>
            <p class="drm-ai-hint">A IA analisa seus dados reais e avalia a viabilidade do sonho.</p>
          </div>`}
      </div>
    </div>

    <!-- Aportes -->
    ${(d._contributions||[]).length?`
    <div class="drm-detail-section">
      <div class="drm-section-title">💰 Últimos aportes</div>
      <div class="drm-contribs-list">
        ${(d._contributions||[]).slice(0,5).map(c=>`
        <div class="drm-contrib-row">
          <span class="drm-contrib-date">${new Date(c.date||c.created_at).toLocaleDateString('pt-BR')}</span>
          <span class="drm-contrib-amount">${priv?'••••':_fmtCurrency(parseFloat(c.amount)||0,d.currency)}</span>
          ${c.notes?`<span class="drm-contrib-note">${_esc(c.notes)}</span>`:''}
          <span class="drm-contrib-badge${c.type!=='manual'?' drm-contrib-badge--tx':''}">${c.type==='manual'?'manual':'transação'}</span>
        </div>`).join('')}
      </div>
    </div>`:''}

    ${d.description?`<div class="drm-detail-section"><div class="drm-section-title">📝 Descrição</div><p class="drm-desc-text">${_esc(d.description)}</p></div>`:''}
  `;

  if (footer) footer.innerHTML=`
    <button class="btn btn-secondary btn-sm" onclick="openContributeModal('${d.id}');closeDreamDetail()">💰 Aporte</button>
    ${!d.linked_account_id?`<button class="btn btn-secondary btn-sm" onclick="openLinkAccountModal('${d.id}')">🏦 Vincular conta</button>`:''}
    ${!d.linked_budget_id?`<button class="btn btn-secondary btn-sm" onclick="openLinkBudgetModal('${d.id}')">📊 Orçamento</button>`:''}
    <button class="btn btn-secondary btn-sm" onclick="openEditDreamModal('${d.id}');closeDreamDetail()">✏️ Editar</button>
    <button class="btn btn-danger btn-sm" style="margin-left:auto" onclick="confirmDeleteDream('${d.id}')">🗑️</button>
  `;
}

function _renderGoalEngine(d,gd,priv) {
  const {recommendedMonthly,avgMonthlyContrib,budgetedMonthly,projectedDate,projectedMonths,effectiveMonthly} = gd;
  if (!recommendedMonthly && !projectedDate) return '';
  return `<div class="drm-detail-section">
    <div class="drm-section-title">🎯 Plano de conquista</div>
    <div class="drm-goal-engine">
      ${recommendedMonthly>0?`<div class="drm-ge-row drm-ge-row--highlight">
        <div class="drm-ge-icon">💡</div>
        <div class="drm-ge-content">
          <div class="drm-ge-label">Guardar por mês para atingir o prazo</div>
          <div class="drm-ge-value accent">${priv?'••••':_fmtCurrency(recommendedMonthly,d.currency)}<span class="drm-ge-period">/mês</span></div>
          ${gd.targetMonths?`<div class="drm-ge-sub">Para atingir em ${gd.targetMonths} meses${d.target_date?' · '+_fmtDate(d.target_date,{month:'short',year:'numeric'}):''}</div>`:''}
        </div>
      </div>`:''}
      ${effectiveMonthly>0&&effectiveMonthly!==recommendedMonthly?`<div class="drm-ge-row">
        <div class="drm-ge-icon">📈</div>
        <div class="drm-ge-content">
          <div class="drm-ge-label">Ritmo atual</div>
          <div class="drm-ge-value">${priv?'••••':_fmtCurrency(effectiveMonthly,d.currency)}<span class="drm-ge-period">/mês</span></div>
          <div class="drm-ge-sub">${budgetedMonthly?'Orçamento planejado':avgMonthlyContrib>0?'Média dos aportes':'Estimativa'}</div>
        </div>
      </div>`:''}
      ${projectedDate?`<div class="drm-ge-row">
        <div class="drm-ge-icon">📅</div>
        <div class="drm-ge-content">
          <div class="drm-ge-label">Previsão de realização</div>
          <div class="drm-ge-value">${projectedMonths===0?'🎉 Meta atingida!':_fmtDate(projectedDate+'-01',{month:'long',year:'numeric'})}</div>
          ${projectedMonths>0?`<div class="drm-ge-sub">Aprox. ${projectedMonths} meses no ritmo atual</div>`:'' }
        </div>
      </div>`:''}
      ${budgetedMonthly>0?`<div class="drm-ge-row">
        <div class="drm-ge-icon">📊</div>
        <div class="drm-ge-content">
          <div class="drm-ge-label">Orçamento mensal planejado</div>
          <div class="drm-ge-value">${priv?'••••':_fmtCurrency(budgetedMonthly,d.currency)}<span class="drm-ge-period">/mês</span></div>
          ${recommendedMonthly&&budgetedMonthly<recommendedMonthly?`<div class="drm-ge-sub drm-ge-sub--warn">⚠️ Abaixo do necessário em ${_fmtCurrency(recommendedMonthly-budgetedMonthly)}/mês</div>`:''}
        </div>
      </div>`:''}
    </div>
  </div>`;
}

function _renderLinkedResources(d,gd,priv) {
  const linkedAcc=gd.linkedAcc;
  let html='';
  html+=`<div class="drm-detail-section">
    <div class="drm-section-title">🏦 Conta dedicada</div>
    ${linkedAcc?`<div class="drm-linked-card">
      <div class="drm-linked-icon">${linkedAcc.icon||'🏦'}</div>
      <div class="drm-linked-info">
        <div class="drm-linked-name">${_esc(linkedAcc.name)}</div>
        <div class="drm-linked-sub">Saldo: <strong>${priv?'••••':_fmtCurrency(parseFloat(linkedAcc.balance)||0)}</strong></div>
      </div>
      <button class="drm-linked-action" onclick="openContributeModal('${d.id}')">+ Aporte</button>
    </div>`:`<div class="drm-linked-empty">
      <p>Crie ou vincule uma conta para guardar dinheiro dedicado a este sonho.</p>
      <div class="drm-linked-ctas">
        <button class="btn btn-secondary btn-sm" onclick="openLinkAccountModal('${d.id}')">🏦 Vincular existente</button>
        <button class="btn btn-primary btn-sm" onclick="createDreamAccount('${d.id}')">✨ Criar conta dedicada</button>
      </div>
    </div>`}
  </div>`;
  if (!d.linked_budget_id) {
    html+=`<div class="drm-detail-section">
      <div class="drm-section-title">📊 Orçamento mensal</div>
      <div class="drm-linked-empty">
        <p>Defina um valor mensal a reservar para este sonho e acompanhe o cumprimento.</p>
        <button class="btn btn-secondary btn-sm" onclick="openLinkBudgetModal('${d.id}')">📊 Criar orçamento</button>
        ${gd.recommendedMonthly>0?`<p class="drm-linked-hint">💡 Sugestão: ${_fmtCurrency(gd.recommendedMonthly)}/mês para atingir no prazo.</p>`:''}
      </div>
    </div>`;
  } else if (gd.linkedBudget) {
    html+=`<div class="drm-detail-section">
      <div class="drm-section-title">📊 Orçamento mensal</div>
      <div class="drm-linked-card">
        <div class="drm-linked-icon">📊</div>
        <div class="drm-linked-info">
          <div class="drm-linked-name">Orçamento vinculado</div>
          <div class="drm-linked-sub">Planejado: <strong>${priv?'••••':_fmtCurrency(parseFloat(gd.linkedBudget.amount)||0)}/mês</strong></div>
        </div>
      </div>
    </div>`;
  }
  return html;
}

function _renderAccelSuggestions(gd,currency,priv) {
  if (!gd.suggestions||!gd.suggestions.length) return '';
  return `<div class="drm-detail-section">
    <div class="drm-section-title">⚡ Sugestões para acelerar</div>
    <p class="drm-accel-hint">Com base nos seus gastos reais dos últimos 90 dias:</p>
    <div class="drm-accel-list">
      ${gd.suggestions.map(s=>`<div class="drm-accel-item">
        <div class="drm-accel-icon">${s.isElastic?'✂️':'💡'}</div>
        <div class="drm-accel-info">
          <div class="drm-accel-cat">${_esc(s.category)}</div>
          <div class="drm-accel-desc">
            ${priv?'Potencial de economia mensal':`Média: ${_fmtCurrency(s.monthlySpend)}/mês · Reduzir <strong>${_fmtCurrency(s.reduction)}/mês</strong>`}
            ${s.monthsEarned?` → antecipa ~${s.monthsEarned} ${s.monthsEarned===1?'mês':'meses'}`:''}
          </div>
        </div>
      </div>`).join('')}
    </div>
  </div>`;
}

function closeDreamDetail() { document.getElementById('dreamDetailModal')?.remove(); }
window.closeDreamDetail = closeDreamDetail;

/* ── Vincular conta ───────────────────────────────────────────────── */
async function openLinkAccountModal(dreamId) {
  const d=_drm.dreams.find(x=>x.id===dreamId); if(!d) return;
  const accs=(state.accounts||[]).filter(a=>a.active!==false);
  document.querySelectorAll('#linkAccountModal').forEach(m=>m.remove());
  document.body.insertAdjacentHTML('beforeend',`
  <div id="linkAccountModal" class="modal-overlay active" onclick="if(event.target===this)document.getElementById('linkAccountModal').remove()">
    <div class="modal" style="max-width:400px" onclick="event.stopPropagation()">
      <div class="modal-header"><h3>🏦 Vincular conta ao sonho</h3><button class="modal-close" onclick="document.getElementById('linkAccountModal').remove()">✕</button></div>
      <div class="modal-body">
        <p class="drm-modal-hint">O saldo da conta vinculada será exibido como seu progresso neste sonho.</p>
        <div class="form-group">
          <label class="form-label">Conta</label>
          <select id="linkAccSelect" class="form-input">
            <option value="">Selecione uma conta…</option>
            ${accs.map(a=>`<option value="${a.id}">${a.icon||'🏦'} ${_esc(a.name)} — ${_fmtCurrency(a.balance||0,a.currency)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('linkAccountModal').remove()">Cancelar</button>
        <button class="btn btn-primary" onclick="saveLinkAccount('${dreamId}')">Vincular</button>
      </div>
    </div>
  </div>`);
}
window.openLinkAccountModal = openLinkAccountModal;

async function createDreamAccount(dreamId) {
  const d=_drm.dreams.find(x=>x.id===dreamId); if(!d) return;
  const name=`Sonho: ${d.title}`;
  if (!confirm(`Criar conta dedicada "${name}"?\nTipo: Poupança · Saldo inicial: R$ 0`)) return;
  try {
    const {data:acc,error}=await sb.from('accounts').insert({
      family_id:famId(), name, type:'poupanca', currency:'BRL', balance:0, initial_balance:0,
      color:'#3b82f6', icon:_dreamTypeEmoji(d.dream_type), active:true,
      created_at:new Date().toISOString(), updated_at:new Date().toISOString(),
    }).select().single();
    if(error) throw error;
    await sb.from('dreams').update({linked_account_id:acc.id,updated_at:new Date().toISOString()}).eq('id',dreamId);
    d.linked_account_id=acc.id;
    if(state.accounts) state.accounts.push(acc);
    delete _drm.goalData[dreamId];
    toast(`✓ Conta "${name}" criada e vinculada!`,'success');
    closeDreamDetail(); openDreamDetail(dreamId);
  } catch(e) { toast('Erro ao criar conta: '+(e?.message||e),'error'); }
}
window.createDreamAccount = createDreamAccount;

async function saveLinkAccount(dreamId) {
  const accId=document.getElementById('linkAccSelect')?.value;
  if(!accId){toast('Selecione uma conta','warning');return;}
  try {
    const {error}=await sb.from('dreams').update({linked_account_id:accId,updated_at:new Date().toISOString()}).eq('id',dreamId);
    if(error) throw error;
    const d=_drm.dreams.find(x=>x.id===dreamId); if(d) d.linked_account_id=accId;
    delete _drm.goalData[dreamId];
    document.getElementById('linkAccountModal')?.remove();
    toast('Conta vinculada!','success');
    closeDreamDetail(); openDreamDetail(dreamId);
  } catch(e){toast('Erro ao vincular conta','error');}
}
window.saveLinkAccount = saveLinkAccount;

/* ── Orçamento vinculado ──────────────────────────────────────────── */
async function openLinkBudgetModal(dreamId) {
  const d=_drm.dreams.find(x=>x.id===dreamId); if(!d) return;
  const gd=_drm.goalData[dreamId]||await _computeGoalData(d);
  const cats=(state.categories||[]).filter(c=>c.type==='despesa'&&!c.parent_id);
  const suggested=Math.max(0,gd.recommendedMonthly||0);
  document.querySelectorAll('#linkBudgetModal').forEach(m=>m.remove());
  document.body.insertAdjacentHTML('beforeend',`
  <div id="linkBudgetModal" class="modal-overlay active" onclick="if(event.target===this)document.getElementById('linkBudgetModal').remove()">
    <div class="modal" style="max-width:420px" onclick="event.stopPropagation()">
      <div class="modal-header"><h3>📊 Orçamento para o sonho</h3><button class="modal-close" onclick="document.getElementById('linkBudgetModal').remove()">✕</button></div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:14px">
        <div class="drm-budget-explain">
          <p>Um orçamento mensal dedicado ajuda a reservar dinheiro regularmente e acompanhar o cumprimento.</p>
          ${suggested>0?`<div class="drm-budget-suggestion">💡 Sugestão: <strong>${_fmtCurrency(suggested)}/mês</strong> para atingir no prazo.</div>`:''}
        </div>
        <div class="form-group">
          <label class="form-label">Valor mensal *</label>
          <input type="text" id="budgetDreamAmt" class="form-input drm-amt-field" inputmode="decimal" placeholder="0,00" data-cents="0" onfocus="_amtFieldFocus('budgetDreamAmt')" onkeydown="_amtFieldKeydown('budgetDreamAmt',event)" oninput="_amtFieldInput('budgetDreamAmt')" onblur="_drmAmtBlur('budgetDreamAmt')">
        </div>
        <div class="form-group">
          <label class="form-label">Categoria</label>
          <select id="budgetDreamCat" class="form-input">
            ${cats.map(c=>`<option value="${c.id}">${c.icon||'📦'} ${_esc(c.name)}</option>`).join('')}
          </select>
          <small style="color:var(--muted);margin-top:4px;display:block">O orçamento será vinculado a esta categoria.</small>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('linkBudgetModal').remove()">Cancelar</button>
        <button class="btn btn-primary" onclick="saveDreamBudget('${dreamId}')">Criar orçamento</button>
      </div>
    </div>
  </div>`);
  // Formatar o campo de valor sugerido após renderização
  requestAnimationFrame(() => {
    const m = document.getElementById('linkBudgetModal');
    if (m && typeof _drmInitAmtFields === 'function') _drmInitAmtFields(m);
  });
}
window.openLinkBudgetModal = openLinkBudgetModal;

async function saveDreamBudget(dreamId) {
  const amount=_drmReadAmt('budgetDreamAmt')||0;
  const catId=document.getElementById('budgetDreamCat')?.value;
  if(!amount||amount<=0){toast('Informe o valor','warning');return;}
  if(!catId){toast('Selecione uma categoria','warning');return;}
  const fid=famId();
  try {
    const {data:bud,error}=await sb.from('budgets').insert({
      family_id:fid, category_id:catId, month:new Date().toISOString().slice(0,7)+'-01',
      amount, budget_type:'monthly', auto_reset:true,
      notes:`Sonho: ${_drm.dreams.find(d=>d.id===dreamId)?.title||dreamId}`,
      created_at:new Date().toISOString(),
    }).select().single();
    if(error) throw error;
    await sb.from('dreams').update({linked_budget_id:bud.id,updated_at:new Date().toISOString()}).eq('id',dreamId);
    const d=_drm.dreams.find(x=>x.id===dreamId); if(d) d.linked_budget_id=bud.id;
    if(state.budgets) state.budgets.push(bud);
    delete _drm.goalData[dreamId];
    document.getElementById('linkBudgetModal')?.remove();
    toast('✓ Orçamento criado e vinculado!','success');
    closeDreamDetail(); openDreamDetail(dreamId);
  } catch(e){toast('Erro ao criar orçamento: '+(e?.message||e),'error');}
}
window.saveDreamBudget = saveDreamBudget;

/* ── Context menu ─────────────────────────────────────────────────── */
function openDreamMenu(dreamId,event) {
  event.stopPropagation();
  document.querySelectorAll('.drm-ctx-menu').forEach(m=>m.remove());
  const d=_drm.dreams.find(x=>x.id===dreamId); if(!d) return;
  const menu=document.createElement('div');
  menu.className='drm-ctx-menu';
  menu.style.cssText='position:fixed;z-index:9999;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:6px;box-shadow:0 4px 20px rgba(0,0,0,.18);min-width:165px';
  const statusOpts=d.status==='active'
    ?`<div class="drm-ctx-item" onclick="changeDreamStatus('${dreamId}','paused');this.closest('.drm-ctx-menu').remove()">⏸️ Pausar</div>
      <div class="drm-ctx-item" onclick="changeDreamStatus('${dreamId}','achieved');this.closest('.drm-ctx-menu').remove()">🏆 Marcar conquistado</div>`
    :`<div class="drm-ctx-item" onclick="changeDreamStatus('${dreamId}','active');this.closest('.drm-ctx-menu').remove()">▶️ Reativar</div>`;
  menu.innerHTML=`
    <div class="drm-ctx-item" onclick="openDreamDetail('${dreamId}');this.closest('.drm-ctx-menu').remove()">🎯 Ver plano</div>
    <div class="drm-ctx-item" onclick="openContributeModal('${dreamId}');this.closest('.drm-ctx-menu').remove()">💰 Registrar aporte</div>
    <div class="drm-ctx-item" onclick="openEditDreamModal('${dreamId}');this.closest('.drm-ctx-menu').remove()">✏️ Editar</div>
    <div class="drm-ctx-item" onclick="runDreamAiAnalysis('${dreamId}');this.closest('.drm-ctx-menu').remove()">🤖 Analisar com IA</div>
    ${!d.linked_account_id?`<div class="drm-ctx-item" onclick="openLinkAccountModal('${dreamId}');this.closest('.drm-ctx-menu').remove()">🏦 Vincular conta</div>`:''}
    ${!d.linked_budget_id?`<div class="drm-ctx-item" onclick="openLinkBudgetModal('${dreamId}');this.closest('.drm-ctx-menu').remove()">📊 Criar orçamento</div>`:''}
    ${statusOpts}
    <div class="drm-ctx-sep"></div>
    <div class="drm-ctx-item drm-ctx-item--danger" onclick="confirmDeleteDream('${dreamId}');this.closest('.drm-ctx-menu').remove()">🗑️ Excluir</div>`;
  const rect=event.target.getBoundingClientRect();
  menu.style.top=(rect.bottom+4)+'px';
  menu.style.left=Math.min(rect.left,window.innerWidth-175)+'px';
  document.body.appendChild(menu);
  setTimeout(()=>document.addEventListener('click',()=>menu.remove(),{once:true}),10);
}
window.openDreamMenu = openDreamMenu;

async function changeDreamStatus(dreamId,newStatus) {
  try {
    const {error}=await sb.from('dreams').update({status:newStatus,updated_at:new Date().toISOString()}).eq('id',dreamId);
    if(error) throw error;
    const d=_drm.dreams.find(x=>x.id===dreamId); if(d) d.status=newStatus;
    renderDreamsPage(); toast('Status atualizado','success');
  } catch(e){toast('Erro ao atualizar','error');}
}
window.changeDreamStatus = changeDreamStatus;

async function confirmDeleteDream(dreamId) {
  closeDreamDetail();
  const d=_drm.dreams.find(x=>x.id===dreamId); if(!d) return;
  if(!confirm(`Excluir "${d.title}"? Esta ação não pode ser desfeita.`)) return;
  try {
    await sb.from('dream_items').delete().eq('dream_id',dreamId);
    await sb.from('dream_contributions').delete().eq('dream_id',dreamId);
    const {error}=await sb.from('dreams').delete().eq('id',dreamId);
    if(error) throw error;
    _drm.dreams=_drm.dreams.filter(x=>x.id!==dreamId);
    delete _drm.items[dreamId]; delete _drm.goalData[dreamId];
    renderDreamsPage(); toast('Sonho excluído','success');
  } catch(e){toast('Erro ao excluir','error');}
}
window.confirmDeleteDream = confirmDeleteDream;

/* ── Contribute modal ─────────────────────────────────────────────── */
function openContributeModal(dreamId) {
  const d=_drm.dreams.find(x=>x.id===dreamId); if(!d) return;
  document.querySelectorAll('#contributeModal').forEach(m=>m.remove());
  const today=new Date().toISOString().slice(0,10);
  const acc=d.linked_account_id?(state.accounts||[]).find(a=>a.id===d.linked_account_id):null;
  document.body.insertAdjacentHTML('beforeend',`
  <div id="contributeModal" class="modal-overlay active" onclick="if(event.target===this)document.getElementById('contributeModal').remove()">
    <div class="modal" style="max-width:380px" onclick="event.stopPropagation()">
      <div class="modal-header"><h3>💰 Registrar aporte</h3><button class="modal-close" onclick="document.getElementById('contributeModal').remove()">✕</button></div>
      <div class="modal-body">
        <div class="drm-contrib-dream-label"><span>${_dreamTypeEmoji(d.dream_type)}</span><strong>${_esc(d.title)}</strong></div>
        ${acc?`<div class="drm-contrib-acc-hint">🏦 ${_esc(acc.name)} · Saldo: ${_fmtCurrency(acc.balance||0)}</div>`:''}
        <div class="form-group" style="margin-top:14px">
          <label class="form-label">Valor *</label>
          <input type="text" id="contribAmount" class="form-input drm-amt-field" inputmode="decimal" placeholder="0,00" data-cents="0" autofocus onfocus="_amtFieldFocus('contribAmount')" onkeydown="_amtFieldKeydown('contribAmount',event)" oninput="_amtFieldInput('contribAmount')" onblur="_drmAmtBlur('contribAmount')">
        </div>
        <div class="form-group">
          <label class="form-label">Data</label>
          <input type="date" id="contribDate" class="form-input" value="${today}">
        </div>
        <div class="form-group">
          <label class="form-label">Observação</label>
          <input type="text" id="contribNote" class="form-input" placeholder="Ex: transferência mensal">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('contributeModal').remove()">Cancelar</button>
        <button class="btn btn-primary" onclick="saveContribution('${dreamId}')">💰 Salvar aporte</button>
      </div>
    </div>
  </div>`);
  setTimeout(()=>{
    document.getElementById('contribAmount')?.focus();
    const m = document.getElementById('contributeModal');
    if (m && typeof _drmInitAmtFields === 'function') _drmInitAmtFields(m);
  },100);
}
window.openContributeModal = openContributeModal;

async function saveContribution(dreamId) {
  const amount=_drmReadAmt('contribAmount');
  const date=document.getElementById('contribDate')?.value;
  if(!amount||amount<=0){toast('Informe um valor válido','warning');return;}
  if(!date){toast('Informe a data','warning');return;}
  const note=document.getElementById('contribNote')?.value||'';
  try {
    const {data,error}=await sb.from('dream_contributions').insert({
      dream_id:dreamId, family_id:famId(), amount, date, type:'manual',
      notes:note||null, created_at:new Date().toISOString(),
    }).select().single();
    if(error) throw error;
    const d=_drm.dreams.find(x=>x.id===dreamId);
    if(d){(d._contributions=d._contributions||[]).unshift(data);}
    delete _drm.goalData[dreamId];
    document.getElementById('contributeModal')?.remove();
    renderDreamsPage(); toast('Aporte registrado! 🎉','success');
  } catch(e){toast('Erro: '+(e?.message||e),'error');}
}
window.saveContribution = saveContribution;

/* ── AI Analysis ──────────────────────────────────────────────────── */
async function runDreamAiAnalysis(dreamId) {
  const d=_drm.dreams.find(x=>x.id===dreamId); if(!d) return;
  const apiKey=await getAppSetting(RECEIPT_AI_KEY_SETTING,'');
  if(!apiKey||!apiKey.startsWith('AIza')){toast('Configure a chave Gemini em Configurações → IA','warning');return;}
  const box=document.getElementById(`dreamAiAnalysis-${dreamId}`);
  if(box) box.innerHTML=`<div class="drm-ai-loading"><div class="drm-ai-spinner"></div>Analisando com IA…</div>`;
  const gd=_drm.goalData[dreamId]||await _computeGoalData(d);
  const txAll=(state.transactions||[]).slice(0,200);
  const income=txAll.filter(t=>(parseFloat(t.amount)||0)>0&&!t.is_transfer).reduce((s,t)=>s+(parseFloat(t.amount)||0),0)/3;
  const expense=txAll.filter(t=>(parseFloat(t.amount)||0)<0&&!t.is_transfer).reduce((s,t)=>s+Math.abs(parseFloat(t.amount)||0),0)/3;
  const ctx={
    sonho:{titulo:d.title,tipo:d.dream_type,meta:gd.target,acumulado:gd.currentSaved,pct:Math.round(gd.pct),prazo_meses:gd.targetMonths},
    plano:{aporte_rec:gd.recommendedMonthly,aporte_real:gd.avgMonthlyContrib,orcamento:gd.budgetedMonthly,previsao:gd.projectedDate},
    financas:{receita_media:Math.round(income),despesa_media:Math.round(expense),sobra:Math.round(income-expense)},
    outros:_drm.dreams.filter(x=>x.id!==dreamId&&x.status==='active').map(x=>({titulo:x.title,meta:x.target_amount})),
    economia:gd.suggestions.map(s=>({cat:s.category,reducao:s.reduction})),
  };
  const prompt=`Consultor financeiro analisando sonho. Responda SOMENTE JSON válido (sem markdown).\n\nCONTEXTO:\n${JSON.stringify(ctx)}\n\nJSON:\n{"viabilidade":"alta|media|baixa","resumo":"2 frases","pontos_positivos":[""],"alertas":[""],"recomendacoes":[""],"prazo_realista_meses":12,"economia_sugerida_mensal":500,"conflitos_outros_sonhos":null,"motivacao":"frase curta"}`;
  try {
    const url=`https://generativelanguage.googleapis.com/v1beta/models/${RECEIPT_AI_MODEL}:generateContent?key=${apiKey}`;
    const resp=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:.4,maxOutputTokens:1200}})});
    if(!resp.ok) throw new Error('HTTP '+resp.status);
    const body=await resp.json();
    const result=JSON.parse((body?.candidates?.[0]?.content?.parts?.[0]?.text||'').replace(/```json|```/g,'').trim());
    const sim={ai_summary:result.resumo,ai_full:result,generated_at:new Date().toISOString()};
    await sb.from('dreams').update({simulation_json:JSON.stringify(sim),updated_at:new Date().toISOString()}).eq('id',dreamId);
    const dm=_drm.dreams.find(x=>x.id===dreamId); if(dm) dm.simulation_json=sim;
    if(box) box.innerHTML=_renderAiResult(result,d.currency);
  } catch(e) {
    console.warn('[Dreams] AI:',e);
    if(box) box.innerHTML=`<div class="drm-ai-error">Erro ao analisar.<br><small>${e?.message||''}</small></div>`;
  }
}
window.runDreamAiAnalysis = runDreamAiAnalysis;

function _renderAiResult(r,currency) {
  const vc=r.viabilidade==='alta'?'#27ae60':r.viabilidade==='media'?'var(--warning,#f39c12)':'var(--danger,#e74c3c)';
  const vl=r.viabilidade==='alta'?'✅ Alta viabilidade':r.viabilidade==='media'?'⚠️ Viabilidade média':'❌ Baixa viabilidade';
  return `<div class="drm-ai-result">
    <div class="drm-ai-viab" style="color:${vc}">${vl}</div>
    <p class="drm-ai-text">${r.resumo}</p>
    ${r.pontos_positivos?.length?`<div class="drm-ai-section"><strong>✅ Positivos</strong><ul>${r.pontos_positivos.map(p=>`<li>${p}</li>`).join('')}</ul></div>`:''}
    ${r.alertas?.length?`<div class="drm-ai-section"><strong>⚠️ Alertas</strong><ul>${r.alertas.map(a=>`<li>${a}</li>`).join('')}</ul></div>`:''}
    ${r.recomendacoes?.length?`<div class="drm-ai-section"><strong>💡 Recomendações</strong><ul>${r.recomendacoes.map(x=>`<li>${x}</li>`).join('')}</ul></div>`:''}
    ${r.prazo_realista_meses?`<div class="drm-ai-meta">Prazo realista: <strong>${r.prazo_realista_meses} meses</strong></div>`:''}
    ${r.economia_sugerida_mensal?`<div class="drm-ai-meta">Guardar: <strong>${_fmtCurrency(r.economia_sugerida_mensal,currency)}/mês</strong></div>`:''}
    ${r.motivacao?`<div class="drm-ai-motivacao">✨ ${r.motivacao}</div>`:''}
    <div class="drm-ai-footer">IA · ${new Date().toLocaleDateString('pt-BR')}</div>
  </div>`;
}

/* ════════════════════════════════════════════════════════════════════
   WIZARD
════════════════════════════════════════════════════════════════════ */
function openDreamWizard(dreamId=null) {
  document.querySelectorAll('#dreamWizardModal').forEach(m=>m.remove());
  _drm.wizard={step:1,dreamId,type:null,data:{},items:[],editing:!!dreamId};
  if (dreamId) {
    const d=_drm.dreams.find(x=>x.id===dreamId);
    if(d){
      _drm.wizard.type=d.dream_type;
      _drm.wizard.data={...d};
      // Restore member IDs from ai_generated_fields_json.__members for picker pre-selection
      _drm.wizard.data.__members = _drmGetMemberIds(d);
      _drm.wizard.items=[...(_drm.items[dreamId]||[])];
      _drm.wizard.step=2;
    }
  }
  _renderWizardModal();
}
window.openDreamWizard = openDreamWizard;
window.openEditDreamModal = openDreamWizard;

function _renderWizardModal() {
  document.querySelectorAll('#dreamWizardModal').forEach(m=>m.remove());
  const w=_drm.wizard;
  let body='';
  if(w.step===1) body=_wizStep1();
  else if(w.step===2) body=_wizStep2();
  else if(w.step===3) body=_wizStep3();
  else if(w.step===4) body=_wizStep4();
  const labels=['Tipo','Detalhes','Custos','Revisão'];
  document.body.insertAdjacentHTML('beforeend',`
  <div id="dreamWizardModal" class="modal-overlay open" onclick="if(event.target===this)closeDreamWizard()">
    <div class="modal drm-wizard-modal" onclick="event.stopPropagation()">
      <div class="modal-header drm-wizard-header-wrap">
        <div class="drm-wizard-header-content">
          <h3 class="drm-wizard-title">${w.editing?'✏️ Editar sonho':'✨ Criar novo sonho'}</h3>
          <div class="drm-wizard-stepper">
            ${[1,2,3,4].map((s,i)=>`
            <div class="drm-stepper-item${w.step===s?' active':w.step>s?' done':''}">
              <div class="drm-stepper-dot">${w.step>s?'✓':s}</div>
              <div class="drm-stepper-label">${labels[i]}</div>
            </div>
            ${s<4?`<div class="drm-stepper-line${w.step>s?' done':''}"></div>`:''}`).join('')}
          </div>
        </div>
        <button class="modal-close" onclick="closeDreamWizard()">✕</button>
      </div>
      <div class="modal-body drm-wizard-body" id="wizardBody">${body}</div>
      <div class="modal-footer drm-wizard-footer">
        ${w.step>1?`<button class="btn btn-secondary" onclick="wizardBack()">← Voltar</button>`:'<div></div>'}
        ${w.step<4
          ?`<button class="btn btn-primary" onclick="wizardNext()">Continuar →</button>`
          :`<button class="btn btn-primary" id="wizSaveBtn" onclick="saveDream()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              Salvar sonho
            </button>`}
      </div>
    </div>
  </div>`);
  // Inicializar campos de valor após renderização
  requestAnimationFrame(() => {
    const modal = document.getElementById('dreamWizardModal');
    if (modal && typeof _drmInitAmtFields === 'function') _drmInitAmtFields(modal);
  });
}

function closeDreamWizard() { document.getElementById('dreamWizardModal')?.remove(); _drm.wizard=null; }
window.closeDreamWizard = closeDreamWizard;

function _wizStep1() {
  const types=[
    {key:'viagem',            emoji:'✈️', label:'Viagem',            desc:'Destinos, passeios, hospedagem'},
    {key:'automovel',         emoji:'🚗', label:'Automóvel',          desc:'Compra à vista ou financiada'},
    {key:'imovel',            emoji:'🏠', label:'Imóvel',             desc:'Apartamento, casa, praia ou campo'},
    {key:'cirurgia_plastica', emoji:'💆', label:'Cirurgia Plástica',  desc:'Estética, saúde e bem-estar'},
    {key:'estudos',           emoji:'🎓', label:'Estudos',            desc:'Faculdade, pós-grad, intercâmbio, cursos'},
    {key:'outro',             emoji:'🌟', label:'Outro',              desc:'Saúde, educação, tecnologia…'},
  ];
  return `<div class="drm-wiz-step1">
    <div class="drm-wiz-headline">Que tipo de sonho você quer realizar?</div>
    <p class="drm-wiz-subhead">Escolha abaixo ou descreva livremente e a IA vai interpretar.</p>
    <div class="drm-type-cards">
      ${types.map(t=>`<button class="drm-type-card${_drm.wizard?.type===t.key?' selected':''}" onclick="selectDreamType('${t.key}')">
        <div class="drm-type-emoji">${t.emoji}</div><div class="drm-type-label">${t.label}</div><div class="drm-type-desc">${t.desc}</div>
      </button>`).join('')}
    </div>
    <div class="drm-wiz-divider"><span>ou descreva livremente</span></div>
    <div class="drm-wiz-free-input">
      <input type="text" id="wizFreeInput" class="form-input" placeholder='Ex: "Quero viajar para Paris em 2026"' onkeydown="if(event.key==='Enter')wizardAiInterpret()">
      <button class="btn drm-btn-ai" id="wizAiBtn" onclick="wizardAiInterpret()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
        Interpretar
      </button>
    </div>
    <div id="wizAiInterpretResult" style="display:none" class="drm-wiz-ai-hint"></div>
  </div>`;
}

function selectDreamType(type) {
  if(!_drm.wizard) return;
  _drm.wizard.type=type;
  document.querySelectorAll('.drm-type-card').forEach(c=>c.classList.remove('selected'));
  document.querySelector(`.drm-type-card[onclick*="'${type}'"]`)?.classList.add('selected');
}
window.selectDreamType = selectDreamType;

async function wizardAiInterpret() {
  const input=document.getElementById('wizFreeInput')?.value?.trim(); if(!input) return;
  const apiKey=await getAppSetting(RECEIPT_AI_KEY_SETTING,'');
  if(!apiKey||!apiKey.startsWith('AIza')){toast('Configure Gemini para usar IA','warning');return;}
  const btn=document.getElementById('wizAiBtn');
  if(btn){btn.disabled=true;btn.textContent='Interpretando…';}
  const prompt=`Interprete este objetivo financeiro, retorne SOMENTE JSON sem markdown.\nObjetivo: "${input}"\n{"tipo":"viagem|automovel|imovel|outro","titulo":"título conciso","descricao":"1 frase","valor_estimado":15000,"prazo_meses_sugerido":18}\nTipo DEVE ser exatamente um de: viagem, automovel, imovel, cirurgia_plastica, estudos, outro`;
  try {
    const url=`https://generativelanguage.googleapis.com/v1beta/models/${RECEIPT_AI_MODEL}:generateContent?key=${apiKey}`;
    const resp=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:.3,maxOutputTokens:300}})});
    const body=await resp.json();
    const result=JSON.parse((body?.candidates?.[0]?.content?.parts?.[0]?.text||'').replace(/```json|```/g,'').trim());
    if(_drm.wizard){
      _drm.wizard.type=result.tipo;
      _drm.wizard.data={title:result.titulo,description:result.descricao,target_amount:result.valor_estimado};
      // Formatar o campo de valor se já estiver no DOM
      setTimeout(()=>_drmSetAmt('wizAmount',result.valor_estimado||0),50);
      if(result.prazo_meses_sugerido){const d=new Date();d.setMonth(d.getMonth()+result.prazo_meses_sugerido);_drm.wizard.data.target_date=d.toISOString().slice(0,10);}
    }
    const res=document.getElementById('wizAiInterpretResult');
    if(res){res.style.display='';res.innerHTML=`✨ <strong>${result.titulo}</strong> · Estimativa: <strong>${_fmtCurrency(result.valor_estimado)}</strong>`;}
    selectDreamType(result.tipo);
  } catch(e){toast('Não foi possível interpretar. Selecione o tipo.','warning');}
  finally{if(btn){btn.disabled=false;btn.innerHTML=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> Interpretar`;}}
}
window.wizardAiInterpret = wizardAiInterpret;

function _wizStep2() {
  const w=_drm.wizard, d=w.data||{}, type=w.type;
  let sf='';
  if(type==='viagem') sf=_wizFieldsViagem(d);
  else if(type==='automovel') sf=_wizFieldsAutomovel(d);
  else if(type==='imovel') sf=_wizFieldsImovel(d);
  else if(type==='cirurgia_plastica') sf=_wizFieldsCirurgiaPlastica(d);
  else if(type==='estudos') sf=_wizFieldsEstudos(d);
  const html = `<div class="drm-wiz-step2">
    <div class="drm-wiz-headline">${_dreamTypeEmoji(type)} Detalhes do sonho</div>
    <p class="drm-wiz-subhead">Quanto mais detalhes, mais precisas serão as recomendações.</p>
    <div class="drm-wiz-form">
      <div class="form-group"><label class="form-label">Nome do sonho *</label><input type="text" id="wizTitle" class="form-input" placeholder="Ex: Férias em Bali" value="${_esc(d.title||'')}"></div>
      <div class="form-group"><label class="form-label">Descrição</label><textarea id="wizDesc" class="form-input" rows="2" placeholder="Descreva seu sonho…">${_esc(d.description||'')}</textarea></div>
      <div class="drm-form-row">
        <div class="form-group"><label class="form-label">Valor estimado *</label><input type="text" id="wizAmount" class="form-input drm-amt-field" inputmode="decimal" placeholder="0,00" data-cents="0" onfocus="_amtFieldFocus('wizAmount')" onkeydown="_amtFieldKeydown('wizAmount',event)" oninput="_amtFieldInput('wizAmount')" onblur="_drmAmtBlur('wizAmount')"></div>
        <div class="form-group"><label class="form-label">Prazo desejado</label><input type="date" id="wizDate" class="form-input" value="${d.target_date||''}"></div>
      </div>
      <div class="form-group"><label class="form-label">Prioridade</label><select id="wizPriority" class="form-input">
        <option value="1" ${(d.priority||1)==1?'selected':''}>⭐ Alta</option>
        <option value="2" ${(d.priority||1)==2?'selected':''}>Média</option>
        <option value="3" ${(d.priority||1)==3?'selected':''}>Baixa</option>
      </select></div>
      ${sf}
      <div style="margin-top:10px">
        <label class="form-label" style="margin-bottom:6px;display:block">👥 Membros deste sonho</label>
        <div id="wizFamilyMemberPicker" class="fmc-picker-container"><div style="font-size:.78rem;color:var(--muted);padding:4px 0">Carregando…</div></div>
      </div>
    </div>
  </div>`;
  // Inicializar picker de membros após o HTML ser injetado no DOM
  requestAnimationFrame(() => {
    if (typeof renderFmcMultiPicker === 'function') {
      // Use __members (our storage key in ai_generated_fields_json)
      const curSel = _drm.wizard?.data?.__members || [];
      renderFmcMultiPicker('wizFamilyMemberPicker', { selected: curSel, showAll: true });
    }
  });
  return html;
}

function _wizFieldsViagem(d) {
  const m=typeof d.ai_generated_fields_json==='object'?(d.ai_generated_fields_json||{}):{};
  return `<div class="drm-wiz-section-title">✈️ Viagem</div>
  <div class="drm-form-row">
    <div class="form-group"><label class="form-label">Destino</label><input type="text" id="wizDestino" class="form-input" placeholder="Ex: Portugal" value="${_esc(m.destino||'')}"></div>
    <div class="form-group"><label class="form-label">Nº pessoas</label><input type="number" id="wizPessoas" class="form-input" min="1" max="20" placeholder="2" value="${m.pessoas||''}"></div>
  </div>`;
}
function _wizFieldsAutomovel(d) {
  const m=typeof d.ai_generated_fields_json==='object'?(d.ai_generated_fields_json||{}):{};
  return `<div class="drm-wiz-section-title">🚗 Veículo</div>
  <div class="drm-form-row">
    <div class="form-group"><label class="form-label">Marca / Modelo</label><input type="text" id="wizModelo" class="form-input" placeholder="Ex: Toyota Corolla" value="${_esc(m.modelo||'')}"></div>
    <div class="form-group"><label class="form-label">Ano</label><input type="number" id="wizAno" class="form-input" min="2000" max="2035" placeholder="${new Date().getFullYear()+1}" value="${m.ano||''}"></div>
  </div>
  <div class="form-group"><label class="form-label">Tipo de compra</label>
    <select id="wizTipoCompra" class="form-input" onchange="_toggleFinanciamentoFields()">
      <option value="avista" ${(m.tipo_compra||'avista')==='avista'?'selected':''}>À vista</option>
      <option value="financiado" ${m.tipo_compra==='financiado'?'selected':''}>Entrada + Financiamento</option>
    </select>
  </div>
  <div id="wizFinancFields" style="${m.tipo_compra==='financiado'?'':'display:none'}">
    <div class="drm-form-row">
      <div class="form-group"><label class="form-label">Entrada</label><input type="text" id="wizEntrada" class="form-input drm-amt-field" inputmode="decimal" placeholder="0,00" data-cents="0" onfocus="_amtFieldFocus('wizEntrada')" onkeydown="_amtFieldKeydown('wizEntrada',event)" oninput="_amtFieldInput('wizEntrada')" onblur="_drmAmtBlur('wizEntrada')"></div>
      <div class="form-group"><label class="form-label">Juros % a.m.</label><input type="number" id="wizJuros" class="form-input" step="0.01" placeholder="1,99" value="${m.taxa_juros||''}"></div>
    </div>
  </div>`;
}
function _wizFieldsImovel(d) {
  const m=typeof d.ai_generated_fields_json==='object'?(d.ai_generated_fields_json||{}):{};
  return `<div class="drm-wiz-section-title">🏠 Imóvel</div>
  <div class="drm-form-row">
    <div class="form-group"><label class="form-label">Subtipo</label><select id="wizSubtipo" class="form-input">
      <option value="apartamento" ${(m.subtipo||'apartamento')==='apartamento'?'selected':''}>Apartamento</option>
      <option value="casa" ${m.subtipo==='casa'?'selected':''}>Casa</option>
      <option value="praia" ${m.subtipo==='praia'?'selected':''}>Casa de Praia</option>
      <option value="campo" ${m.subtipo==='campo'?'selected':''}>Casa de Campo</option>
    </select></div>
    <div class="form-group"><label class="form-label">Cidade</label><input type="text" id="wizCidade" class="form-input" placeholder="Ex: São Paulo" value="${_esc(m.cidade||'')}"></div>
  </div>
  <div class="form-group"><label class="form-label">Tipo de aquisição</label>
    <select id="wizTipoCompra" class="form-input" onchange="_toggleFinanciamentoFields()">
      <option value="avista" ${(m.tipo_compra||'avista')==='avista'?'selected':''}>À vista</option>
      <option value="financiado" ${m.tipo_compra==='financiado'?'selected':''}>Entrada + Financiamento</option>
    </select>
  </div>
  <div id="wizFinancFields" style="${m.tipo_compra==='financiado'?'':'display:none'}">
    <div class="drm-form-row">
      <div class="form-group"><label class="form-label">Entrada</label><input type="text" id="wizEntrada" class="form-input drm-amt-field" inputmode="decimal" placeholder="0,00" data-cents="0" onfocus="_amtFieldFocus('wizEntrada')" onkeydown="_amtFieldKeydown('wizEntrada',event)" oninput="_amtFieldInput('wizEntrada')" onblur="_drmAmtBlur('wizEntrada')"></div>
      <div class="form-group"><label class="form-label">FGTS</label><input type="text" id="wizFgts" class="form-input drm-amt-field" inputmode="decimal" placeholder="0,00" data-cents="0" onfocus="_amtFieldFocus('wizFgts')" onkeydown="_amtFieldKeydown('wizFgts',event)" oninput="_amtFieldInput('wizFgts')" onblur="_drmAmtBlur('wizFgts')"></div>
    </div>
    <div class="form-group"><label class="form-label">Juros % a.m.</label><input type="number" id="wizJuros" class="form-input" step="0.01" placeholder="0,75" value="${m.taxa_juros||''}"></div>
  </div>`;
}
function _wizFieldsCirurgiaPlastica(d) {
  const m=typeof d.ai_generated_fields_json==='object'?(d.ai_generated_fields_json||{}):{};
  return `<div class="drm-wiz-section-title">💆 Cirurgia Plástica</div>
  <div class="drm-form-row">
    <div class="form-group"><label class="form-label">Procedimento</label>
      <select id="wizProcedimento" class="form-input">
        <option value="rinoplastia" ${(m.procedimento||'')==='rinoplastia'?'selected':''}>Rinoplastia</option>
        <option value="mamoplastia" ${m.procedimento==='mamoplastia'?'selected':''}>Mamoplastia</option>
        <option value="lipoaspiracao" ${m.procedimento==='lipoaspiracao'?'selected':''}>Lipoaspiração</option>
        <option value="blefaroplastia" ${m.procedimento==='blefaroplastia'?'selected':''}>Blefaroplastia</option>
        <option value="abdominoplastia" ${m.procedimento==='abdominoplastia'?'selected':''}>Abdominoplastia</option>
        <option value="lifting" ${m.procedimento==='lifting'?'selected':''}>Lifting Facial</option>
        <option value="botox" ${m.procedimento==='botox'?'selected':''}>Botox/Preenchimento</option>
        <option value="outro" ${m.procedimento==='outro'?'selected':''}>Outro</option>
      </select>
    </div>
    <div class="form-group"><label class="form-label">Cidade / Clínica</label>
      <input type="text" id="wizClinica" class="form-input" placeholder="Ex: São Paulo — Dr. Silva" value="${_esc(m.clinica||'')}">
    </div>
  </div>
  <div class="drm-form-row">
    <div class="form-group"><label class="form-label">Tipo de cobertura</label>
      <select id="wizCobertura" class="form-input">
        <option value="particular" ${(m.cobertura||'particular')==='particular'?'selected':''}>Particular (sem plano)</option>
        <option value="plano_saude" ${m.cobertura==='plano_saude'?'selected':''}>Plano de Saúde</option>
        <option value="financiamento" ${m.cobertura==='financiamento'?'selected':''}>Financiamento médico</option>
      </select>
    </div>
    <div class="form-group"><label class="form-label">Nº de procedimentos</label>
      <input type="number" id="wizNumProcs" class="form-input" min="1" max="10" placeholder="1" value="${m.num_procedimentos||''}">
    </div>
  </div>
  <div class="form-group">
    <label class="form-label">Observações</label>
    <textarea id="wizObsCirurgia" class="form-input" rows="2" placeholder="Médico, data ideal, etc.">${_esc(m.observacoes||'')}</textarea>
  </div>`;
}

function _wizFieldsEstudos(d) {
  const m=typeof d.ai_generated_fields_json==='object'?(d.ai_generated_fields_json||{}):{};
  return `<div class="drm-wiz-section-title">🎓 Estudos</div>
  <div class="drm-form-row">
    <div class="form-group"><label class="form-label">Modalidade *</label>
      <select id="wizEstModalidade" class="form-input" onchange="_wizEstOnModalidadeChange()">
        <option value="graduacao"       ${(m.modalidade||'')==='graduacao'      ?'selected':''}>🎓 Graduação (Faculdade)</option>
        <option value="graduacao_ext"   ${m.modalidade==='graduacao_ext'        ?'selected':''}>🌍 Graduação no Exterior</option>
        <option value="pos_graduacao"   ${m.modalidade==='pos_graduacao'        ?'selected':''}>📜 Pós-Graduação / MBA</option>
        <option value="pos_ext"         ${m.modalidade==='pos_ext'              ?'selected':''}>🌐 Pós-Grad. no Exterior</option>
        <option value="mestrado"        ${m.modalidade==='mestrado'             ?'selected':''}>🔬 Mestrado</option>
        <option value="doutorado"       ${m.modalidade==='doutorado'            ?'selected':''}>🏛️ Doutorado</option>
        <option value="intercambio"     ${m.modalidade==='intercambio'          ?'selected':''}>✈️ Intercâmbio / Idiomas</option>
        <option value="tecnico"         ${m.modalidade==='tecnico'              ?'selected':''}>🔧 Curso Técnico</option>
        <option value="curso_livre"     ${m.modalidade==='curso_livre'          ?'selected':''}>📚 Curso Livre / Online</option>
        <option value="certificacao"    ${m.modalidade==='certificacao'         ?'selected':''}>🏆 Certificação Profissional</option>
      </select>
    </div>
    <div class="form-group"><label class="form-label">Curso / Área</label>
      <input type="text" id="wizEstCurso" class="form-input" placeholder="Ex: Engenharia, MBA, IELTS" value="${_esc(m.curso||'')}">
    </div>
  </div>
  <div class="drm-form-row">
    <div class="form-group"><label class="form-label">Instituição</label>
      <input type="text" id="wizEstInstituicao" class="form-input" placeholder="Ex: USP, FGV, Harvard, Duolingo" value="${_esc(m.instituicao||'')}">
    </div>
    <div class="form-group" id="wizEstPaisGroup">
      <label class="form-label">País de Destino</label>
      <input type="text" id="wizEstPais" class="form-input" placeholder="Ex: EUA, Canadá, Portugal" value="${_esc(m.pais_destino||'')}">
    </div>
  </div>
  <div class="drm-form-row">
    <div class="form-group"><label class="form-label">Duração (meses)</label>
      <input type="number" id="wizEstDuracao" class="form-input" min="1" max="120" placeholder="Ex: 48" value="${m.duracao_meses||''}">
    </div>
    <div class="form-group"><label class="form-label">Bolsa de estudos?</label>
      <select id="wizEstBolsa" class="form-input">
        <option value="nao"          ${(m.bolsa||'nao')==='nao'         ?'selected':''}>Sem bolsa (custeio próprio)</option>
        <option value="parcial"      ${m.bolsa==='parcial'               ?'selected':''}>Bolsa parcial</option>
        <option value="integral"     ${m.bolsa==='integral'              ?'selected':''}>Bolsa integral</option>
        <option value="fies"         ${m.bolsa==='fies'                  ?'selected':''}>FIES</option>
        <option value="prouni"       ${m.bolsa==='prouni'                ?'selected':''}>ProUni</option>
        <option value="financiamento"${m.bolsa==='financiamento'         ?'selected':''}>Financiamento estudantil</option>
      </select>
    </div>
  </div>
  <div style="display:flex;flex-direction:column;gap:8px;margin-top:2px">
    <label class="form-label" style="margin-bottom:4px">Custos incluídos além de mensalidades:</label>
    <div style="display:flex;flex-wrap:wrap;gap:10px">
      <label style="display:inline-flex;align-items:center;gap:6px;font-size:.82rem;cursor:pointer;font-weight:500">
        <input type="checkbox" id="wizEstMoradia" ${m.moradia?'checked':''} style="width:15px;height:15px">
        🏠 Moradia
      </label>
      <label style="display:inline-flex;align-items:center;gap:6px;font-size:.82rem;cursor:pointer;font-weight:500">
        <input type="checkbox" id="wizEstPassagem" ${m.passagem?'checked':''} style="width:15px;height:15px">
        ✈️ Passagens
      </label>
      <label style="display:inline-flex;align-items:center;gap:6px;font-size:.82rem;cursor:pointer;font-weight:500">
        <input type="checkbox" id="wizEstMaterial" ${m.material?'checked':''} style="width:15px;height:15px">
        📚 Material didático
      </label>
      <label style="display:inline-flex;align-items:center;gap:6px;font-size:.82rem;cursor:pointer;font-weight:500">
        <input type="checkbox" id="wizEstVisto" ${m.visto?'checked':''} style="width:15px;height:15px">
        📄 Visto / documentos
      </label>
    </div>
  </div>`;
}
window._wizFieldsEstudos = _wizFieldsEstudos;

function _wizEstOnModalidadeChange() {
  const v = document.getElementById('wizEstModalidade')?.value || '';
  const isExterior = ['graduacao_ext','pos_ext','intercambio'].includes(v);
  const paisGroup  = document.getElementById('wizEstPaisGroup');
  if (paisGroup) paisGroup.style.opacity = isExterior ? '1' : '.5';
}
window._wizEstOnModalidadeChange = _wizEstOnModalidadeChange;

function _toggleFinanciamentoFields() {
  const v=document.getElementById('wizTipoCompra')?.value;
  const f=document.getElementById('wizFinancFields');
  if(f) f.style.display=v==='financiado'?'':'none';
}
window._toggleFinanciamentoFields = _toggleFinanciamentoFields;

function _wizStep3() {
  const w=_drm.wizard, items=w.items||[];
  const total=items.reduce((s,it)=>s+(parseFloat(it.estimated_amount)||0),0);
  return `<div class="drm-wiz-step3">
    <div class="drm-wiz-headline">🧩 Componentes do sonho</div>
    <p class="drm-wiz-subhead">Detalhe os custos envolvidos. A IA pode sugerir automaticamente.</p>
    <div class="drm-wiz-items-toolbar">
      <span class="drm-items-total-label">Total: <strong id="wizItemsTotal">${_fmtCurrency(total)}</strong></span>
      <button class="btn drm-btn-ai btn-sm" onclick="wizardAiSuggestItems()">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> Sugerir IA
      </button>
    </div>
    <div id="wizItemsList" class="drm-wizard-items">${items.map((it,i)=>_renderWizItem(it,i)).join('')}</div>
    <div class="drm-wiz-add-item">
      <input type="text" id="wizNewItemName" class="form-input" placeholder="Nome do componente" onkeydown="if(event.key==='Enter')addWizItem()">
      <input type="text" id="wizNewItemAmt" class="form-input drm-amt-field" inputmode="decimal" placeholder="0,00" data-cents="0" onfocus="_amtFieldFocus('wizNewItemAmt')" onkeydown="_amtFieldKeydown('wizNewItemAmt',event);if(event.key==='Enter')addWizItem()" oninput="_amtFieldInput('wizNewItemAmt')" onblur="_drmAmtBlur('wizNewItemAmt')">
      <button class="btn btn-secondary btn-sm" onclick="addWizItem()">+ Add</button>
    </div>
    <div id="wizAiItemsLoading" style="display:none" class="drm-ai-loading"><div class="drm-ai-spinner"></div>Sugerindo…</div>
  </div>`;
}

function _renderWizItem(it,i) {
  return `<div class="drm-wiz-item" id="wizItem-${i}">
    ${it.is_ai_suggested?'<span class="drm-ai-badge" title="IA">✨</span>':''}
    <input type="text" class="form-input drm-wiz-item-name" value="${_esc(it.name||'')}" oninput="_updateWizItem(${i},'name',this.value)">
    <input type="text" class="form-input drm-amt-field drm-wiz-item-amt" inputmode="decimal" value="${it.estimated_amount ? it.estimated_amount.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}) : ''}" data-cents="${Math.round((it.estimated_amount||0)*100)}" onfocus="this.select()" onkeydown="_drmItemAmtKeydown(this,${i},event)" oninput="_drmItemAmtInput(this,${i})" onblur="_drmAmtBlur(null,this)">
    <button class="drm-item-del" onclick="_removeWizItem(${i})" title="Remover">✕</button>
  </div>`;
}
function addWizItem() {
  const name=document.getElementById('wizNewItemName')?.value?.trim();
  const amt=_drmReadAmt('wizNewItemAmt')||0;
  if(!name){toast('Informe o nome','warning');return;}
  _drm.wizard.items.push({name,estimated_amount:amt||0,is_ai_suggested:false});
  _refreshWizItemsList();
  document.getElementById('wizNewItemName').value='';
  document.getElementById('wizNewItemAmt').value='';
  document.getElementById('wizNewItemName')?.focus();
}
window.addWizItem = addWizItem;
function _updateWizItem(i,f,v) { if(_drm.wizard?.items?.[i]) _drm.wizard.items[i][f]=f==='estimated_amount'?(parseFloat(v)||0):v; }
window._updateWizItem = _updateWizItem;
function _removeWizItem(i) { _drm.wizard.items.splice(i,1); _refreshWizItemsList(); }
window._removeWizItem = _removeWizItem;
function _refreshWizItemsList() {
  const c=document.getElementById('wizItemsList'); if(!c) return;
  c.innerHTML=(_drm.wizard?.items||[]).map((it,i)=>_renderWizItem(it,i)).join('');
  _refreshItemsTotal();
}
function _refreshItemsTotal() {
  const t=(_drm.wizard?.items||[]).reduce((s,it)=>s+(parseFloat(it.estimated_amount)||0),0);
  const el=document.getElementById('wizItemsTotal'); if(el) el.textContent=_fmtCurrency(t);
}
window._refreshItemsTotal = _refreshItemsTotal;

async function wizardAiSuggestItems() {
  const w=_drm.wizard; if(!w) return;
  const loading=document.getElementById('wizAiItemsLoading'); if(loading) loading.style.display='';
  const title   = document.getElementById('wizTitle')?.value  || w.data?.title || '';
  const amount  = _drmReadAmt('wizAmount') || w.data?.target_amount || 0;
  const type    = w.type;
  const extra   = {};
  if(type==='viagem')    { extra.destino=document.getElementById('wizDestino')?.value||''; extra.pessoas=parseInt(document.getElementById('wizPessoas')?.value||2); }
  else if(type==='automovel') { extra.modelo=document.getElementById('wizModelo')?.value||''; extra.tipo_compra=document.getElementById('wizTipoCompra')?.value||'avista'; }
  else if(type==='imovel')    { extra.subtipo=document.getElementById('wizSubtipo')?.value||''; extra.cidade=document.getElementById('wizCidade')?.value||''; extra.tipo_compra=document.getElementById('wizTipoCompra')?.value||'avista'; }

  // ── 1. Tentar KB local primeiro (sem API, sem latência) ───────────────────
  let kbItems = [];
  try {
    if (type === 'viagem' && typeof drmKbGerarComponentesViagem === 'function') {
      kbItems = drmKbGerarComponentesViagem({
        destino: extra.destino, pessoas: extra.pessoas || 2,
        dias: 7, orcamento_total: amount,
      }).map(c => ({ name: c.nome, estimated_amount: c.valor_estimado, is_ai_suggested: true, _source: 'kb' }));
    } else if (type === 'automovel' && typeof drmKbGerarComponentesAutomovel === 'function') {
      kbItems = drmKbGerarComponentesAutomovel({
        valor_veiculo: amount || 120000,
        tipo_compra: extra.tipo_compra || 'avista',
      }).map(c => ({ name: c.nome, estimated_amount: c.valor_estimado, is_ai_suggested: true, _source: 'kb' }));
    } else if (type === 'imovel' && typeof drmKbGerarComponentesImovel === 'function') {
      kbItems = drmKbGerarComponentesImovel({
        valor_imovel: amount || 400000,
        tipo_compra: extra.tipo_compra || 'avista',
        incluir_reforma: true,
      }).map(c => ({ name: c.nome, estimated_amount: c.valor_estimado, is_ai_suggested: true, _source: 'kb' }));
    }
  } catch(e) { console.warn('[dreams-kb]', e); }

  if (kbItems.length >= 4) {
    // KB tem dados suficientes — usar diretamente, sem precisar da IA
    w.items = [...(w.items||[]).filter(it=>!it.is_ai_suggested), ...kbItems];
    _refreshWizItemsList();
    toast(`📚 ${kbItems.length} componentes sugeridos da base de referências`, 'success');
    if (loading) loading.style.display = 'none';

    // Tentar enriquecer com IA em background se disponível (não bloqueante)
    getAppSetting(RECEIPT_AI_KEY_SETTING,'').then(apiKey => {
      if (!apiKey || !apiKey.startsWith('AIza')) return;
      const prompt = `Você é um planejador financeiro. Complemente ou refine esta lista de custos para o sonho abaixo, mantendo os itens essenciais e adicionando apenas o que está faltando.\nTipo: ${type}\nTítulo: ${title}\nTotal: R$ ${amount}\nContexto: ${JSON.stringify(extra)}\nItens já sugeridos: ${JSON.stringify(kbItems.map(i=>i.name))}\n\nRetorne SOMENTE JSON com itens adicionais ou corrigidos:\n{"componentes":[{"nome":"item","valor_estimado":1000}]}\n\nRegras: máximo 4 itens novos, BRL Brasil 2025, não repetir os existentes.`;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${RECEIPT_AI_MODEL}:generateContent?key=${apiKey}`;
      fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:.3,maxOutputTokens:400}})})
        .then(r=>r.json())
        .then(body => {
          const result = JSON.parse((body?.candidates?.[0]?.content?.parts?.[0]?.text||'').replace(/```json|```/g,'').trim());
          const extras = (result.componentes||[]).map(c=>({name:c.nome,estimated_amount:c.valor_estimado||0,is_ai_suggested:true,_source:'ai'}));
          if (extras.length) {
            w.items = [...(w.items||[]).filter(it=>!it._source||it._source!=='ai'), ...extras];
            _refreshWizItemsList();
            toast(`✨ IA adicionou ${extras.length} itens extras`, 'info');
          }
        }).catch(()=>{});
    }).catch(()=>{});
    return;
  }

  // ── 2. Fallback: IA pura se KB não tem dados suficientes ─────────────────
  const apiKey = await getAppSetting(RECEIPT_AI_KEY_SETTING,'');
  if (!apiKey || !apiKey.startsWith('AIza')) {
    toast('Sem dados suficientes na base local. Configure Gemini para sugestões por IA.', 'warning');
    if (loading) loading.style.display = 'none';
    return;
  }
  const prompt = `Planejador financeiro: sugira custos para o sonho.\nTipo: ${type}\nTítulo: ${title}\nTotal: R$ ${amount}\nContexto: ${JSON.stringify(extra)}\n\nRetorne SOMENTE JSON:\n{"componentes":[{"nome":"item","valor_estimado":1000}]}\n\nRegras: 6-12 itens, soma ≈ R$ ${amount}, BRL Brasil 2025.`;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${RECEIPT_AI_MODEL}:generateContent?key=${apiKey}`;
    const resp = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:.4,maxOutputTokens:800}})});
    const body = await resp.json();
    const result = JSON.parse((body?.candidates?.[0]?.content?.parts?.[0]?.text||'').replace(/```json|```/g,'').trim());
    const newItems = (result.componentes||[]).map(c=>({name:c.nome,estimated_amount:c.valor_estimado||0,is_ai_suggested:true,_source:'ai'}));
    w.items = [...(w.items||[]).filter(it=>!it.is_ai_suggested), ...newItems];
    _refreshWizItemsList();
    toast(`✨ IA sugeriu ${newItems.length} componentes`, 'success');
  } catch(e) { toast('Erro ao sugerir.','warning'); }
  finally { if (loading) loading.style.display = 'none'; }
}
window.wizardAiSuggestItems = wizardAiSuggestItems;

function _wizStep4() {
  const w=_drm.wizard;
  const title=document.getElementById('wizTitle')?.value||w.data?.title||'—';
  const amount=_drmReadAmt('wizAmount')||w.data?.target_amount||0;
  const date=document.getElementById('wizDate')?.value||w.data?.target_date||'';
  const priority=parseInt(document.getElementById('wizPriority')?.value||w.data?.priority||1);
  const items=w.items||[];
  const totalItems=items.reduce((s,it)=>s+(parseFloat(it.estimated_amount)||0),0);
  const months=date?(()=>{const n=new Date(),e=new Date(date);return Math.max(0,(e.getFullYear()-n.getFullYear())*12+(e.getMonth()-n.getMonth()));})():null;
  const monthly=months?Math.ceil(amount/months):null;
  const prioLabel=['','⭐ Alta','Média','Baixa'][priority]||'';
  /* capacity hint usando dados reais */
  const txAll=state.transactions||[];
  const inc=txAll.filter(t=>(parseFloat(t.amount)||0)>0&&!t.is_transfer).slice(0,90).reduce((s,t)=>s+(parseFloat(t.amount)||0),0)/3;
  const exp=txAll.filter(t=>(parseFloat(t.amount)||0)<0&&!t.is_transfer).slice(0,90).reduce((s,t)=>s+Math.abs(parseFloat(t.amount)||0),0)/3;
  const cap=Math.max(0,inc-exp);
  const capHint=cap>0&&monthly?(monthly>cap?`<div class="drm-review-alert">⚠️ Aporte de ${_fmtCurrency(monthly)}/mês supera sua sobra estimada (${_fmtCurrency(cap)}/mês). Considere ajustar o prazo.</div>`:`<div class="drm-review-ok">✅ Aporte de ${_fmtCurrency(monthly)}/mês está dentro da sua capacidade estimada.</div>`):'';
  return `<div class="drm-wiz-step4">
    <div class="drm-wiz-headline">📋 Revisão</div>
    <p class="drm-wiz-subhead">Confirme e salve. Você vincular conta e orçamento após salvar.</p>
    <div class="drm-review-card">
      <div class="drm-review-hero">
        <span class="drm-review-emoji">${_dreamTypeEmoji(w.type)}</span>
        <div><div class="drm-review-title">${_esc(title)}</div><div class="drm-review-type">${_dreamTypeLabel(w.type)} · ${prioLabel}</div></div>
      </div>
      <div class="drm-review-grid">
        <div class="drm-review-item"><span class="drm-review-label">Meta</span><span class="drm-review-value">${_fmtCurrency(amount)}</span></div>
        ${date?`<div class="drm-review-item"><span class="drm-review-label">Prazo</span><span class="drm-review-value">${_fmtDate(date,{month:'long',year:'numeric'})}</span></div>`:''}
        ${months!==null?`<div class="drm-review-item"><span class="drm-review-label">Duração</span><span class="drm-review-value">${months} meses</span></div>`:''}
        ${monthly!==null?`<div class="drm-review-item"><span class="drm-review-label">Guardar/mês</span><span class="drm-review-value accent">${_fmtCurrency(monthly)}</span></div>`:''}
        ${items.length?`<div class="drm-review-item"><span class="drm-review-label">Componentes</span><span class="drm-review-value">${items.length} itens · ${_fmtCurrency(totalItems)}</span></div>`:''}
      </div>
      <div class="drm-review-members">
        <span class="drm-review-members-label">👥 Para quem:</span>
        ${(()=>{
          const selIds = w.data?.__members||[];
          const allM = (typeof getFamilyMembers==='function'?getFamilyMembers():null)||(window._fmc&&window._fmc.members)||[];
          if(!selIds.length) return '<span class="drm-member-chip drm-member-chip--all">👨‍👩‍👧 Família (todos)</span>';
          return selIds.map(id=>{const m=allM.find(x=>x.id===id);return m?`<span class="drm-member-chip">${m.avatar_emoji||'👤'} ${_esc(m.name)}</span>`:'';}).join('');
        })()}
      </div>
      ${capHint}
      ${items.length?`<div class="drm-review-items-preview">
        ${items.slice(0,5).map(it=>`<div class="drm-review-item-row">${it.is_ai_suggested?'<span class="drm-ai-badge">✨</span>':''}<span>${_esc(it.name)}</span><span>${_fmtCurrency(parseFloat(it.estimated_amount)||0)}</span></div>`).join('')}
        ${items.length>5?`<div class="drm-review-more">+ ${items.length-5} mais…</div>`:''}
      </div>`:''}
    </div>
    <div class="drm-review-note">💡 Após salvar, vincule uma conta dedicada e crie um orçamento mensal para acelerar este sonho.</div>
  </div>`;
}

function wizardNext() {
  const w=_drm.wizard; if(!w) return;
  if(w.step===1){
    if(!w.type){toast('Selecione um tipo','warning');return;}
    w.step=2;
  } else if(w.step===2){
    const title=document.getElementById('wizTitle')?.value?.trim();
    const amount=_drmReadAmt('wizAmount')||0;
    if(!title){toast('Informe o nome do sonho','warning');return;}
    if(!amount||amount<=0){toast('Informe o valor estimado','warning');return;}
    w.data.title=title; w.data.description=document.getElementById('wizDesc')?.value?.trim()||'';
    w.data.target_amount=amount; w.data.target_date=document.getElementById('wizDate')?.value||null;
    w.data.priority=parseInt(document.getElementById('wizPriority')?.value||1);
    // Captura membros selecionados no picker (array vazio = família geral)
    w.data.__members = typeof getFmcMultiPickerSelected === 'function'
      ? getFmcMultiPickerSelected('wizFamilyMemberPicker')
      : [];
    if(w.type==='viagem') w.data.ai_generated_fields_json={destino:document.getElementById('wizDestino')?.value||'',pessoas:document.getElementById('wizPessoas')?.value||''};
    else if(w.type==='automovel') w.data.ai_generated_fields_json={modelo:document.getElementById('wizModelo')?.value||'',ano:document.getElementById('wizAno')?.value||'',tipo_compra:document.getElementById('wizTipoCompra')?.value||'avista',entrada:_drmReadAmt('wizEntrada')||'',taxa_juros:document.getElementById('wizJuros')?.value||''};
    else if(w.type==='imovel') w.data.ai_generated_fields_json={subtipo:document.getElementById('wizSubtipo')?.value||'',cidade:document.getElementById('wizCidade')?.value||'',tipo_compra:document.getElementById('wizTipoCompra')?.value||'avista',entrada:_drmReadAmt('wizEntrada')||'',fgts:_drmReadAmt('wizFgts')||'',taxa_juros:document.getElementById('wizJuros')?.value||''};
    else if(w.type==='cirurgia_plastica') w.data.ai_generated_fields_json={procedimento:document.getElementById('wizProcedimento')?.value||'',clinica:document.getElementById('wizClinica')?.value||'',cobertura:document.getElementById('wizCobertura')?.value||'particular',num_procedimentos:document.getElementById('wizNumProcs')?.value||'1',observacoes:document.getElementById('wizObsCirurgia')?.value||''};
    else if(w.type==='estudos') w.data.ai_generated_fields_json={modalidade:document.getElementById('wizEstModalidade')?.value||'',curso:document.getElementById('wizEstCurso')?.value||'',instituicao:document.getElementById('wizEstInstituicao')?.value||'',pais_destino:document.getElementById('wizEstPais')?.value||'',duracao_meses:document.getElementById('wizEstDuracao')?.value||'',bolsa:document.getElementById('wizEstBolsa')?.value||'nao',moradia:document.getElementById('wizEstMoradia')?.checked||false,passagem:document.getElementById('wizEstPassagem')?.checked||false,material:document.getElementById('wizEstMaterial')?.checked||false,visto:document.getElementById('wizEstVisto')?.checked||false};
    w.step=3;
  } else if(w.step===3){
    const nameEls=document.querySelectorAll('.drm-wiz-item-name'), amtEls=document.querySelectorAll('.drm-wiz-item-amt');
    w.items=Array.from(nameEls).map((el,i)=>({name:el.value,estimated_amount:parseFloat(amtEls[i]?.value||0)||0,is_ai_suggested:w.items[i]?.is_ai_suggested||false})).filter(it=>it.name.trim());
    w.step=4;
  }
  _renderWizardModal();
}
window.wizardNext = wizardNext;

function wizardBack() { if(_drm.wizard&&_drm.wizard.step>1){_drm.wizard.step--;_renderWizardModal();} }
window.wizardBack = wizardBack;

async function saveDream() {
  const w=_drm.wizard; if(!w) return;
  const btn=document.getElementById('wizSaveBtn');
  if(btn){btn.disabled=true;btn.textContent='Salvando…';}
  const fid=famId();
  // Validar dream_type — o banco aceita apenas: viagem, automovel, imovel
  // (e 'outro' após executar DREAMS_MIGRATION_SQL no Supabase)
  // Mapeamento de tipos que a IA pode retornar para os aceitos pelo banco
  const TYPE_MAP = {
    viagem: 'viagem', travel: 'viagem', turismo: 'viagem',
    automovel: 'automovel', carro: 'automovel', veiculo: 'automovel', auto: 'automovel',
    imovel: 'imovel', casa: 'imovel', apartamento: 'imovel', imóvel: 'imovel',
    outro: 'outro', other: 'outro', saude: 'outro', educacao: 'outro',
    tecnologia: 'outro', lazer: 'outro', sonho: 'outro',
  };
  const DB_VALID = ['viagem', 'automovel', 'imovel', 'outro'];
  const rawType  = (w.type || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  let   safeType = TYPE_MAP[rawType] || (DB_VALID.includes(w.type) ? w.type : null);
  // Se ainda inválido, tentar salvar como 'outro' — se o banco rejeitar, fallback para 'viagem'
  if (!safeType) safeType = 'outro';

  // Merge __members into ai_generated_fields_json so they're persisted without
  // requiring a schema change. The dreams table has no family_member_ids column.
  const memberIds = w.data.__members || [];
  const _baseFields = w.data.ai_generated_fields_json || {};
  const _fieldsWithMembers = memberIds.length
    ? { ..._baseFields, __members: memberIds }
    : ((() => { const cp = { ..._baseFields }; delete cp.__members; return cp; })());
  const payload={family_id:fid,created_by:currentUser?.id,title:w.data.title,description:w.data.description||null,dream_type:safeType,target_amount:w.data.target_amount,currency:'BRL',target_date:w.data.target_date||null,priority:w.data.priority||1,status:w.data.status||'active',ai_generated_fields_json:Object.keys(_fieldsWithMembers).length?JSON.stringify(_fieldsWithMembers):null,updated_at:new Date().toISOString()};
  try {
    let dreamId;
    if(w.editing&&w.dreamId){
      const{error}=await sb.from('dreams').update(payload).eq('id',w.dreamId); if(error) throw error;
      dreamId=w.dreamId;
      const idx=_drm.dreams.findIndex(d=>d.id===dreamId);
      if(idx!==-1){
        Object.assign(_drm.dreams[idx],payload);
        // Parse back to object for in-memory use (payload stores as JSON string)
        try { _drm.dreams[idx].ai_generated_fields_json = _fieldsWithMembers; } catch(_){}
      }
    } else {
      let res = await sb.from('dreams').insert({...payload,created_at:new Date().toISOString()}).select().single();
      // Se banco rejeitou 'outro' (constraint antigo sem esse tipo), retentar com 'viagem'
      if (res.error && res.error.message?.includes('dreams_dream_type_check') && payload.dream_type === 'outro') {
        payload.dream_type = 'viagem';
        res = await sb.from('dreams').insert({...payload,created_at:new Date().toISOString()}).select().single();
      }
      if(res.error) throw res.error;
      dreamId=res.data.id; res.data._contributions=[]; _drm.dreams.unshift(res.data);
    }
    if(w.items.length){
      if(w.editing) await sb.from('dream_items').delete().eq('dream_id',dreamId).eq('is_ai_suggested',true);
      else await sb.from('dream_items').delete().eq('dream_id',dreamId);
      const ip=w.items.filter(it=>it.name?.trim()).map(it=>({dream_id:dreamId,family_id:fid,name:it.name.trim(),estimated_amount:parseFloat(it.estimated_amount)||0,is_ai_suggested:!!it.is_ai_suggested,created_at:new Date().toISOString()}));
      if(ip.length){const{error:ie}=await sb.from('dream_items').insert(ip);if(ie)console.warn('[Dreams] items:',ie.message);_drm.items[dreamId]=ip;}
    }
    closeDreamWizard(); renderDreamsPage();
    toast(w.editing?'✓ Sonho atualizado!':'🌟 Sonho criado! Vincule uma conta ou crie um orçamento.','success');
    if(!w.editing) setTimeout(()=>openDreamDetail(dreamId),400);
  } catch(e){toast('Erro: '+(e?.message||e),'error');if(btn){btn.disabled=false;btn.textContent='Salvar sonho';}}
}
window.saveDream = saveDream;

/* ── Init ─────────────────────────────────────────────────────────── */
(function(){
  if(document.readyState==='complete'||document.readyState==='interactive'){if(typeof famId==='function'&&famId())applyDreamsFeature().catch(()=>{});}
  else document.addEventListener('DOMContentLoaded',()=>{if(typeof famId==='function'&&famId())applyDreamsFeature().catch(()=>{});});
})();

// ════════════════════════════════════════════════════════════════════════════
// HELPERS DE FORMATAÇÃO DE VALORES — Módulo Sonhos
// Usa o sistema _amtField* do app (utils.js) para formatação consistente.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Lê o valor numérico de um campo de moeda do módulo de sonhos.
 * Aceita tanto o padrão novo (data-cents) quanto o antigo (type=number).
 */
function _drmReadAmt(fieldId, el) {
  const elem = el || document.getElementById(fieldId);
  if (!elem) return 0;
  // Novo padrão: data-cents em centavos
  if (elem.dataset && elem.dataset.cents !== undefined) {
    return parseInt(elem.dataset.cents || '0', 10) / 100;
  }
  // Fallback: parse do value (aceita BR 1.500,00 e EN 1500.00)
  const raw = (elem.value || '').trim();
  if (!raw) return 0;
  const clean = raw.replace(/\./g, '').replace(',', '.');
  return Math.abs(parseFloat(clean) || 0);
}
window._drmReadAmt = _drmReadAmt;

/**
 * Define o valor de um campo de moeda do módulo de sonhos.
 * Formata automaticamente com separador de milhar e 2 decimais.
 */
function _drmSetAmt(fieldId, value, el) {
  const elem = el || document.getElementById(fieldId);
  if (!elem) return;
  const num   = Math.abs(parseFloat(value) || 0);
  const cents = Math.round(num * 100);
  elem.dataset.cents = String(cents);
  if (cents === 0) {
    elem.value = '';
  } else {
    elem.value = num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
window._drmSetAmt = _drmSetAmt;

/**
 * onblur: formata o valor digitado como moeda BR.
 * Lida com campos que usam o padrão novo (data-cents) e antigo.
 */
function _drmAmtBlur(fieldId, el) {
  const elem = el || document.getElementById(fieldId);
  if (!elem) return;
  const raw = (elem.value || '').trim();
  if (!raw) { elem.dataset.cents = '0'; return; }
  // Parse lenientemente: 10500 / 10500,00 / 10.500,00 / 10500.00
  const clean = raw.replace(/\./g, '').replace(',', '.');
  const num   = Math.abs(parseFloat(clean) || 0);
  if (num === 0) { elem.value = ''; elem.dataset.cents = '0'; return; }
  const cents = Math.round(num * 100);
  elem.dataset.cents = String(cents);
  elem.value = num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
window._drmAmtBlur = _drmAmtBlur;

/**
 * onkeydown para campos de item do step 3 (referenciados pelo elemento, não pelo ID).
 */
function _drmItemAmtKeydown(el, itemIdx, e) {
  if (!el) return;
  // Garante que dataset.cents existe
  if (!el.dataset.cents) {
    const raw = (el.value || '').replace(/\./g, '').replace(',', '');
    el.dataset.cents = String(parseInt(raw.replace(/[^\d]/g, '') || '0', 10));
  }

  if (e.key === 'Backspace' || e.keyCode === 8) {
    e.preventDefault();
    const cents = Math.floor(parseInt(el.dataset.cents || '0', 10) / 10);
    el.dataset.cents = String(cents);
    _amtRender(el, cents);
    _drmSyncItemAmt(el, itemIdx);
    return;
  }
  if (e.key === 'Delete' || e.keyCode === 46) {
    e.preventDefault();
    el.dataset.cents = '0'; el.value = '';
    _drmSyncItemAmt(el, itemIdx); return;
  }
  if (e.key.length > 1 || e.ctrlKey || e.metaKey) return;
  if (!/[0-9]/.test(e.key)) { e.preventDefault(); return; }
  e.preventDefault();
  const prev  = el.dataset.cents || '0';
  const next  = prev + e.key;
  const cents = parseInt(next.slice(-13), 10);
  el.dataset.cents = String(cents);
  _amtRender(el, cents);
  _drmSyncItemAmt(el, itemIdx);
}
window._drmItemAmtKeydown = _drmItemAmtKeydown;

/**
 * oninput para campos de item do step 3 (paste, autofill, mobile).
 */
function _drmItemAmtInput(el, itemIdx) {
  if (!el) return;
  const rawDigits = el.value.replace(/[^0-9]/g, '');
  if (!rawDigits) { el.dataset.cents = '0'; el.value = ''; _drmSyncItemAmt(el, itemIdx); return; }
  const cents = parseInt(rawDigits.slice(-13) || '0', 10);
  el.dataset.cents = String(cents);
  _amtRender(el, cents);
  _drmSyncItemAmt(el, itemIdx);
}
window._drmItemAmtInput = _drmItemAmtInput;

/**
 * Sincroniza o valor do campo de item com o estado do wizard e atualiza o total.
 */
function _drmSyncItemAmt(el, itemIdx) {
  if (!_drm.wizard?.items?.[itemIdx]) return;
  const val = parseInt(el.dataset.cents || '0', 10) / 100;
  _drm.wizard.items[itemIdx].estimated_amount = val;
  _refreshItemsTotal();
}

/**
 * Inicializa os campos de valor de um modal de sonhos após renderização.
 * Formata os campos que já têm valor (ex: ao editar um sonho existente).
 */
function _drmInitAmtFields(containerEl) {
  const container = containerEl || document;
  container.querySelectorAll('.drm-amt-field').forEach(el => {
    const raw = (el.value || '').trim();
    if (!raw) return;
    // Se já está formatado (tem vírgula), apenas sincroniza data-cents
    if (raw.includes(',')) {
      const clean = raw.replace(/\./g, '').replace(',', '.');
      const num   = Math.abs(parseFloat(clean) || 0);
      el.dataset.cents = String(Math.round(num * 100));
    } else if (/^\d+(\.\d+)?$/.test(raw)) {
      // Número puro (vindo do value= no HTML)
      _drmSetAmt(null, parseFloat(raw) || 0, el);
    }
  });
}
window._drmInitAmtFields = _drmInitAmtFields;
