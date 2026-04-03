/* ═══════════════════════════════════════════════════════════════════════════
   TRANSLATIONS ADMIN — Painel de gestão de traduções
   Acessível em Configurações → Traduções (apenas admin global)
   
   Funcionalidades:
     • Listar/buscar/filtrar todas as chaves
     • Editar traduções inline por idioma
     • Adicionar novas chaves
     • Adicionar novos idiomas (coluna dinâmica)
     • Exportar / Importar CSV
     • Forçar recarga do cache
═══════════════════════════════════════════════════════════════════════════ */

// ── Estado do painel ────────────────────────────────────────────────────────
const _tr = {
  all:         [],   // todos os registros carregados
  filtered:    [],   // após busca/filtro
  search:      '',
  section:     '',   // filtro por seção
  editingKey:  null, // chave sendo editada
  loading:     false,
};

// ── Colunas de idioma disponíveis ────────────────────────────────────────────
const TR_BASE_COLS = ['key_name', 'section', 'description', 'default_text'];
const TR_LANG_COLS = ['en', 'es', 'fr']; // colunas de tradução (pt = default_text)
const TR_LANG_LABELS = { default_text: '🇧🇷 PT', en: '🇺🇸 EN', es: '🇪🇸 ES', fr: '🇫🇷 FR' };

// ── Ponto de entrada ─────────────────────────────────────────────────────────

async function initTranslationsAdmin() {
  const wrap = document.getElementById('translationsAdminWrap');
  if (!wrap) return;

  if (currentUser?.role !== 'admin') {
    wrap.innerHTML = `<div style="padding:24px;color:var(--muted);text-align:center">Apenas administradores globais podem gerir traduções.</div>`;
    return;
  }

  wrap.innerHTML = _trBuildUI();
  _trBindEvents();
  await _trLoad();
}

// ── Build UI ─────────────────────────────────────────────────────────────────

function _trBuildUI() {
  return `
    <!-- Toolbar -->
    <div class="tr-toolbar">
      <input type="text" id="trSearch" placeholder="🔍 Buscar chave, texto..." class="tr-search"
        oninput="_trOnSearch(this.value)">
      <select id="trSectionFilter" onchange="_trOnSection(this.value)" class="tr-select">
        <option value="">Todas as seções</option>
      </select>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button class="btn btn-primary btn-sm" onclick="_trOpenNew()">+ Nova Chave</button>
        <button class="btn btn-ghost btn-sm"   onclick="_trExportCSV()">📥 CSV</button>
        <button class="btn btn-ghost btn-sm"   onclick="_trImportCSVDialog()">📤 Import</button>
        <button class="btn btn-ghost btn-sm"   onclick="_trReloadCache()" title="Recarregar cache de traduções">↺</button>
      </div>
    </div>

    <!-- Stats bar -->
    <div class="tr-stats" id="trStats">
      <span id="trTotalCount">—</span> chaves &nbsp;·&nbsp;
      <span id="trMissingCount" style="color:var(--amber)">—</span> incompletas
    </div>

    <!-- Table -->
    <div class="tr-table-wrap" id="trTableWrap">
      <div style="padding:40px;text-align:center;color:var(--muted)">
        <div class="ai-loading-spinner" style="margin:0 auto 12px"></div>
        Carregando traduções…
      </div>
    </div>

    <!-- Edit modal -->
    <div id="trEditModal" class="tr-edit-modal" style="display:none">
      <div class="tr-edit-card">
        <div class="tr-edit-header">
          <span id="trEditTitle" style="font-weight:700;font-size:.95rem">Nova Chave</span>
          <button onclick="_trCloseEdit()" style="background:none;border:none;color:var(--muted);font-size:1.1rem;cursor:pointer">✕</button>
        </div>
        <div class="tr-edit-body">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
            <div class="form-group" style="margin:0">
              <label style="font-size:.75rem">Chave (key) *</label>
              <input type="text" id="trEditKey" placeholder="ex: dashboard.total_expenses"
                style="font-family:monospace;font-size:.8rem" oninput="_trEditValidateKey(this)">
              <div id="trEditKeyError" style="color:var(--red);font-size:.7rem;display:none"></div>
            </div>
            <div class="form-group" style="margin:0">
              <label style="font-size:.75rem">Seção</label>
              <input type="text" id="trEditSection" placeholder="ex: dashboard"
                style="font-family:monospace;font-size:.8rem">
            </div>
          </div>
          <div class="form-group" style="margin-bottom:12px">
            <label style="font-size:.75rem">Descrição (contexto)</label>
            <input type="text" id="trEditDescription" placeholder="Onde esta string aparece?">
          </div>
          <div style="display:grid;gap:8px">
            ${[['default_text','🇧🇷 Português (padrão)'],['en','🇺🇸 English'],['es','🇪🇸 Español'],['fr','🇫🇷 Français']].map(([col, lbl]) => `
              <div class="form-group" style="margin:0">
                <label style="font-size:.75rem">${lbl}</label>
                <input type="text" id="trEditLang_${col}" placeholder="${lbl}…">
              </div>`).join('')}
          </div>
          <div id="trEditError" style="display:none;color:var(--red);font-size:.78rem;margin-top:10px;
            padding:7px 10px;background:#fef2f2;border-radius:8px;border:1px solid #fecaca"></div>
        </div>
        <div class="tr-edit-footer">
          <button class="btn btn-ghost btn-sm" onclick="_trCloseEdit()">Cancelar</button>
          <button id="trEditDelBtn" class="btn btn-ghost btn-sm" style="color:var(--red);display:none"
            onclick="_trDeleteCurrent()">🗑 Excluir</button>
          <button class="btn btn-primary btn-sm" onclick="_trSaveEdit()">💾 Salvar</button>
        </div>
      </div>
    </div>

    <!-- CSV import hidden input -->
    <input type="file" id="trImportFile" accept=".csv" style="display:none" onchange="_trImportCSV(this)">
  `;
}

// ── Events ───────────────────────────────────────────────────────────────────

function _trBindEvents() {
  // Close modal on outside click
  document.getElementById('trEditModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'trEditModal') _trCloseEdit();
  });
}

// ── Data loading ─────────────────────────────────────────────────────────────

async function _trLoad() {
  _tr.loading = true;
  try {
    _tr.all      = await i18nAdminLoadAll();
    _tr.filtered = [..._tr.all];

    // Build section filter
    const sections = [...new Set(_tr.all.map(r => r.section || '').filter(Boolean))].sort();
    const sel = document.getElementById('trSectionFilter');
    if (sel) {
      sel.innerHTML = '<option value="">Todas as seções</option>' +
        sections.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    }

    _trUpdateStats();
    _trRenderTable();
  } catch(e) {
    const wrap = document.getElementById('trTableWrap');
    if (wrap) wrap.innerHTML = `<div class="tr-error">Erro ao carregar: ${esc(e.message)}</div>`;
  }
  _tr.loading = false;
}

function _trOnSearch(val) {
  _tr.search = val.toLowerCase();
  _trApplyFilters();
}

function _trOnSection(val) {
  _tr.section = val;
  _trApplyFilters();
}

function _trApplyFilters() {
  let rows = _tr.all;
  if (_tr.search) {
    rows = rows.filter(r =>
      (r.key_name     || '').toLowerCase().includes(_tr.search) ||
      (r.default_text || '').toLowerCase().includes(_tr.search) ||
      (r.en           || '').toLowerCase().includes(_tr.search) ||
      (r.description  || '').toLowerCase().includes(_tr.search)
    );
  }
  if (_tr.section) {
    rows = rows.filter(r => (r.section || '') === _tr.section);
  }
  _tr.filtered = rows;
  _trUpdateStats();
  _trRenderTable();
}

function _trUpdateStats() {
  const total   = _tr.filtered.length;
  const missing = _tr.filtered.filter(r =>
    !r.en || !r.es || !r.fr
  ).length;

  const tc = document.getElementById('trTotalCount');
  const mc = document.getElementById('trMissingCount');
  if (tc) tc.textContent = total;
  if (mc) { mc.textContent = missing; mc.style.display = missing ? '' : 'none'; }
}

// ── Table rendering ───────────────────────────────────────────────────────────

function _trRenderTable() {
  const wrap = document.getElementById('trTableWrap');
  if (!wrap) return;

  if (!_tr.filtered.length) {
    wrap.innerHTML = `<div class="tr-empty">Nenhuma chave encontrada.</div>`;
    return;
  }

  const rows = _tr.filtered.slice(0, 200); // cap for performance

  wrap.innerHTML = `
    <table class="tr-table">
      <thead>
        <tr>
          <th style="min-width:200px">Chave</th>
          <th>Seção</th>
          <th style="min-width:160px">🇧🇷 PT</th>
          <th style="min-width:160px">🇺🇸 EN</th>
          <th style="min-width:160px">🇪🇸 ES</th>
          <th style="min-width:160px">🇫🇷 FR</th>
          <th style="width:50px"></th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => _trRenderRow(r)).join('')}
      </tbody>
    </table>
    ${_tr.filtered.length > 200 ? `<div class="tr-more">Mostrando 200 de ${_tr.filtered.length}. Use a busca para filtrar.</div>` : ''}
  `;
}

function _trRenderRow(r) {
  const missing = (!r.en || !r.es || !r.fr);
  const dot = missing ? '<span class="tr-missing-dot" title="Tradução incompleta">●</span>' : '';
  return `
    <tr class="tr-row${missing ? ' tr-row-missing' : ''}" onclick="_trOpenEdit('${esc(r.key_name)}')">
      <td class="tr-key-cell"><code>${esc(r.key_name)}</code>${dot}</td>
      <td class="tr-sec-cell"><span class="tr-sec-badge">${esc(r.section || '')}</span></td>
      <td class="tr-text-cell">${esc(r.default_text || '')}</td>
      <td class="tr-text-cell ${!r.en ? 'tr-cell-empty' : ''}">${esc(r.en || '—')}</td>
      <td class="tr-text-cell ${!r.es ? 'tr-cell-empty' : ''}">${esc(r.es || '—')}</td>
      <td class="tr-text-cell ${!r.fr ? 'tr-cell-empty' : ''}">${esc(r.fr || '—')}</td>
      <td><button class="tr-edit-btn" onclick="event.stopPropagation();_trOpenEdit('${esc(r.key_name)}')">✏️</button></td>
    </tr>`;
}

// ── Edit modal ────────────────────────────────────────────────────────────────

function _trOpenNew() {
  _tr.editingKey = null;
  document.getElementById('trEditTitle').textContent  = 'Nova Chave de Tradução';
  document.getElementById('trEditKey').value          = '';
  document.getElementById('trEditKey').readOnly       = false;
  document.getElementById('trEditSection').value      = '';
  document.getElementById('trEditDescription').value  = '';
  document.getElementById('trEditDelBtn').style.display = 'none';
  ['default_text','en','es','fr'].forEach(col =>
    _setVal('trEditLang_' + col, '')
  );
  _setVal('trEditError', '');
  document.getElementById('trEditError').style.display = 'none';
  document.getElementById('trEditModal').style.display = 'flex';
  document.getElementById('trEditKey').focus();
}

function _trOpenEdit(keyName) {
  const row = _tr.all.find(r => r.key_name === keyName);
  if (!row) return;

  _tr.editingKey = keyName;
  document.getElementById('trEditTitle').textContent  = 'Editar Tradução';
  document.getElementById('trEditKey').value          = row.key_name || '';
  document.getElementById('trEditKey').readOnly       = true; // key is immutable once created
  document.getElementById('trEditSection').value      = row.section || '';
  document.getElementById('trEditDescription').value  = row.description || '';
  document.getElementById('trEditDelBtn').style.display = '';
  ['default_text','en','es','fr'].forEach(col =>
    _setVal('trEditLang_' + col, row[col] || '')
  );
  document.getElementById('trEditError').style.display = 'none';
  document.getElementById('trEditModal').style.display = 'flex';
}

function _trCloseEdit() {
  document.getElementById('trEditModal').style.display = 'none';
  _tr.editingKey = null;
}

function _trEditValidateKey(input) {
  const errEl = document.getElementById('trEditKeyError');
  const val   = input.value.trim();
  if (!val) { errEl.textContent = ''; errEl.style.display = 'none'; return; }
  if (!/^[a-z][a-z0-9_.]+$/.test(val)) {
    errEl.textContent = 'Use apenas letras minúsculas, números, _ e .';
    errEl.style.display = '';
  } else {
    errEl.textContent = '';
    errEl.style.display = 'none';
  }
}

async function _trSaveEdit() {
  const errEl = document.getElementById('trEditError');
  errEl.style.display = 'none';

  const keyName     = document.getElementById('trEditKey').value.trim();
  const section     = document.getElementById('trEditSection').value.trim();
  const description = document.getElementById('trEditDescription').value.trim();

  if (!keyName) {
    errEl.textContent = 'A chave é obrigatória.';
    errEl.style.display = '';
    return;
  }
  if (!_tr.editingKey && !/^[a-z][a-z0-9_.]+$/.test(keyName)) {
    errEl.textContent = 'Chave inválida. Use apenas letras minúsculas, números, _ e .';
    errEl.style.display = '';
    return;
  }
  // Check duplicate (new key)
  if (!_tr.editingKey && _tr.all.find(r => r.key_name === keyName)) {
    errEl.textContent = 'Esta chave já existe.';
    errEl.style.display = '';
    return;
  }

  const row = {
    key_name:    keyName,
    section:     section || null,
    description: description || null,
    default_text: _getVal('trEditLang_default_text') || null,
    en:           _getVal('trEditLang_en')           || null,
    es:           _getVal('trEditLang_es')           || null,
    fr:           _getVal('trEditLang_fr')           || null,
  };

  try {
    await i18nAdminSave(row);
    toast(`✓ Tradução "${keyName}" salva!`, 'success');
    _trCloseEdit();
    await _trLoad();
    // Força recarga do dict ativo
    await i18nReload();
  } catch(e) {
    errEl.textContent = 'Erro: ' + e.message;
    errEl.style.display = '';
  }
}

async function _trDeleteCurrent() {
  if (!_tr.editingKey) return;
  if (!confirm(`Excluir a chave "${_tr.editingKey}"? Esta ação é irreversível.`)) return;
  try {
    await i18nAdminDelete(_tr.editingKey);
    toast('Chave removida', 'success');
    _trCloseEdit();
    await _trLoad();
  } catch(e) {
    toast('Erro: ' + e.message, 'error');
  }
}

// ── CSV export / import ───────────────────────────────────────────────────────

function _trExportCSV() {
  const header = ['key_name','section','description','default_text','en','es','fr'];
  const rows   = _tr.all.map(r =>
    header.map(col => `"${(r[col] || '').replace(/"/g, '""')}"`).join(',')
  );
  const csv  = [header.join(','), ...rows].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `fintrack-i18n-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  toast('📥 CSV exportado', 'success');
}

function _trImportCSVDialog() {
  document.getElementById('trImportFile')?.click();
}

async function _trImportCSV(input) {
  const file = input?.files?.[0];
  if (!file) return;
  input.value = '';

  try {
    const text = await file.text();
    const lines = text.split('\n').filter(l => l.trim());
    const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));

    let saved = 0, errors = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = _trParseCSVLine(lines[i]);
      if (cols.length < 2) continue;
      const row = {};
      header.forEach((h, idx) => { row[h] = cols[idx] || null; });
      if (!row.key_name) continue;
      try {
        await i18nAdminSave(row);
        saved++;
      } catch { errors++; }
    }

    toast(`✓ ${saved} chaves importadas${errors ? ` · ${errors} erros` : ''}`, 'success');
    await _trLoad();
    await i18nReload();
  } catch(e) {
    toast('Erro no import: ' + e.message, 'error');
  }
}

function _trParseCSVLine(line) {
  const result = [];
  let current  = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i+1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  result.push(current);
  return result;
}

// ── Cache reload ──────────────────────────────────────────────────────────────

async function _trReloadCache() {
  await i18nReload();
  toast('↺ Cache de traduções recarregado', 'success');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

function _getVal(id) {
  return (document.getElementById(id)?.value || '').trim();
}

// Expõe para uso inline no HTML
window.initTranslationsAdmin = initTranslationsAdmin;
window._trOnSearch    = _trOnSearch;
window._trOnSection   = _trOnSection;
window._trOpenNew     = _trOpenNew;
window._trOpenEdit    = _trOpenEdit;
window._trCloseEdit   = _trCloseEdit;
window._trSaveEdit    = _trSaveEdit;
window._trDeleteCurrent = _trDeleteCurrent;
window._trExportCSV   = _trExportCSV;
window._trImportCSVDialog = _trImportCSVDialog;
window._trImportCSV   = _trImportCSV;
window._trReloadCache = _trReloadCache;
window._trEditValidateKey = _trEditValidateKey;
