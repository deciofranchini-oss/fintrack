// ════════════════════════════════════════════════════════════════════════════
// EXPORT_FAMILY.JS — Exportação completa da família em planilhas Excel
// Gera um ZIP com uma planilha XLSX por tabela, com barra de progresso.
// ════════════════════════════════════════════════════════════════════════════

const EXPORT_TABLES = [
  { id: 'transactions',          label: 'Transações',              icon: '💳', cols: ['id','date','description','amount','currency','category_id','payee_id','account_id','status','memo','tags','created_at'] },
  { id: 'accounts',              label: 'Contas',                  icon: '🏦', cols: ['id','name','type','currency','balance','initial_balance','color','active','group_id','created_at'] },
  { id: 'account_groups',        label: 'Grupos de Conta',         icon: '🗂️', cols: ['id','name','emoji','color','currency','created_at'] },
  { id: 'categories',            label: 'Categorias',              icon: '🏷️', cols: ['id','name','type','parent_id','color','icon','created_at'] },
  { id: 'payees',                label: 'Beneficiários',           icon: '👤', cols: ['id','name','type','city','state_uf','cnpj_cpf','phone','website','created_at'] },
  { id: 'budgets',               label: 'Orçamentos',              icon: '🎯', cols: ['id','category_id','month','amount','budget_type','auto_reset','paused','notes','created_at'] },
  { id: 'scheduled_transactions',label: 'Transações Programadas',  icon: '📅', cols: ['id','description','type','amount','currency','frequency','start_date','end_date','status','account_id','payee_id','category_id'] },
  { id: 'investment_positions',  label: 'Posições Investimentos',  icon: '📈', cols: ['id','ticker','name','asset_type','quantity','avg_cost','current_price','currency','account_id','price_updated_at'] },
  { id: 'investment_transactions',label:'Transações Investimentos', icon: '💹', cols: ['id','position_id','account_id','type','quantity','unit_price','total_brl','date','notes'] },
  { id: 'debts',                 label: 'Dívidas',                 icon: '💳', cols: ['id','name','creditor_payee_id','original_amount','current_balance','currency','start_date','status','adjustment_type','periodicity'] },
  { id: 'dreams',                label: 'Sonhos',                  icon: '🌟', cols: ['id','title','dream_type','dream_subtype','target_amount','currency','target_date','status','priority','description'] },
  { id: 'dream_contributions',   label: 'Contribuições Sonhos',    icon: '💰', cols: ['id','dream_id','amount','date','type','notes'] },
  { id: 'price_items',           label: 'Produtos (Preços)',        icon: '🏪', cols: ['id','name','unit','avg_price','last_price','record_count','category_id'] },
  { id: 'price_history',         label: 'Histórico de Preços',     icon: '📊', cols: ['id','item_id','store_id','unit_price','quantity','purchased_at'] },
  { id: 'price_stores',          label: 'Lojas',                   icon: '🏬', cols: ['id','name','address','city','state_uf','cnpj'] },
  { id: 'family_composition',    label: 'Composição Familiar',     icon: '👨‍👩‍👧', cols: ['id','name','member_type','family_relationship','birth_date','avatar_emoji'] },
];

// ── Open export modal ────────────────────────────────────────────────────────
function openFamilyExportModal() {
  let modal = document.getElementById('familyExportModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'familyExportModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal" style="max-width:480px"><div class="modal-handle"></div>
        <div class="modal-header">
          <span class="modal-title">📦 Exportar Dados da Família</span>
          <button class="modal-close" onclick="closeModal('familyExportModal')">✕</button>
        </div>
        <div class="modal-body" style="padding:20px">
          <p style="font-size:.84rem;color:var(--text2);margin-bottom:16px;line-height:1.6">
            Exporta todos os dados da sua família em planilhas Excel (.xlsx), uma por tabela, compactadas em um arquivo ZIP.
          </p>
          <!-- Table checklist -->
          <div style="font-size:.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">
            Tabelas a exportar
          </div>
          <div id="fexTableList" style="display:flex;flex-direction:column;gap:4px;max-height:240px;overflow-y:auto;margin-bottom:16px;padding:2px">
            ${EXPORT_TABLES.map(t => `
              <label style="display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:8px;background:var(--surface2);cursor:pointer;font-size:.82rem;border:1.5px solid var(--border);transition:border-color .15s"
                     onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
                <input type="checkbox" id="fexChk-${t.id}" checked style="width:15px;height:15px;accent-color:var(--accent)">
                <span style="font-size:1rem;flex-shrink:0">${t.icon}</span>
                <span style="color:var(--text);font-weight:500">${t.label}</span>
                <span style="margin-left:auto;font-size:.7rem;color:var(--muted)">${t.id}</span>
              </label>`).join('')}
          </div>
          <!-- Select all / none -->
          <div style="display:flex;gap:8px;margin-bottom:18px">
            <button class="btn btn-ghost btn-sm" onclick="_fexSelectAll(true)" style="font-size:.75rem">✅ Marcar tudo</button>
            <button class="btn btn-ghost btn-sm" onclick="_fexSelectAll(false)" style="font-size:.75rem">⬜ Desmarcar tudo</button>
          </div>
          <!-- Progress section (hidden initially) -->
          <div id="fexProgress" style="display:none">
            <div style="font-size:.78rem;font-weight:600;color:var(--text);margin-bottom:6px">Gerando planilhas…</div>
            <div style="height:8px;background:var(--border);border-radius:4px;overflow:hidden;margin-bottom:8px">
              <div id="fexProgressBar" style="height:100%;background:linear-gradient(90deg,var(--accent),var(--accent2,#3d8f5e));width:0%;border-radius:4px;transition:width .3s ease"></div>
            </div>
            <div id="fexProgressLabel" style="font-size:.74rem;color:var(--muted)">Iniciando…</div>
            <div id="fexLog" style="margin-top:10px;max-height:100px;overflow-y:auto;font-size:.7rem;color:var(--muted);line-height:1.6;font-family:monospace"></div>
          </div>
          <!-- Error -->
          <div id="fexError" style="display:none;color:var(--red);font-size:.8rem;padding:8px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;margin-bottom:12px"></div>
        </div>
        <div class="modal-footer" id="fexFooter">
          <button class="btn btn-ghost" onclick="closeModal('familyExportModal')">Cancelar</button>
          <button class="btn btn-primary" id="fexStartBtn" onclick="startFamilyExport()">
            ⬇️ Exportar ZIP
          </button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }
  // Reset state
  document.getElementById('fexProgress').style.display = 'none';
  document.getElementById('fexError').style.display = 'none';
  document.getElementById('fexLog').textContent = '';
  document.getElementById('fexProgressBar').style.width = '0%';
  const startBtn = document.getElementById('fexStartBtn');
  if (startBtn) { startBtn.disabled = false; startBtn.textContent = '⬇️ Exportar ZIP'; }
  document.getElementById('fexFooter').style.display = '';
  modal.classList.add('open');
}
window.openFamilyExportModal = openFamilyExportModal;

function _fexSelectAll(val) {
  EXPORT_TABLES.forEach(t => {
    const el = document.getElementById('fexChk-' + t.id);
    if (el) el.checked = val;
  });
}

// ── Main export function ─────────────────────────────────────────────────────
async function startFamilyExport() {
  const selected = EXPORT_TABLES.filter(t => document.getElementById('fexChk-' + t.id)?.checked);
  if (!selected.length) { toast('Selecione ao menos uma tabela', 'warning'); return; }

  const startBtn = document.getElementById('fexStartBtn');
  const progress = document.getElementById('fexProgress');
  const bar      = document.getElementById('fexProgressBar');
  const label    = document.getElementById('fexProgressLabel');
  const log      = document.getElementById('fexLog');
  const errEl    = document.getElementById('fexError');
  const footer   = document.getElementById('fexFooter');

  if (startBtn) { startBtn.disabled = true; startBtn.textContent = '⏳ Exportando…'; }
  if (progress) progress.style.display = '';
  if (errEl)    errEl.style.display = 'none';
  if (log)      log.textContent = '';

  const setProgress = (pct, msg) => {
    if (bar)   bar.style.width   = pct + '%';
    if (label) label.textContent = msg;
  };
  const addLog = (msg) => {
    if (log) {
      log.textContent += msg + '\n';
      log.scrollTop = log.scrollHeight;
    }
  };

  // Collect all xlsx file contents
  const zipFiles = {};
  const fid = typeof famId === 'function' ? famId() : null;
  const totalTables = selected.length;

  try {
    for (let i = 0; i < totalTables; i++) {
      const tbl = selected[i];
      const pct = Math.round(((i) / totalTables) * 85) + 5;
      setProgress(pct, `${tbl.icon} Exportando ${tbl.label}…`);
      addLog(`→ ${tbl.label}...`);

      let rows = [];
      try {
        let query = sb.from(tbl.id).select(tbl.cols.join(','));
        // Apply family filter if the table has family_id
        if (fid) {
          try { query = query.eq('family_id', fid); } catch(_) {}
        }
        const { data, error } = await query.limit(50000);
        if (error) throw error;
        rows = data || [];
        addLog(`   ✅ ${rows.length} registros`);
      } catch(e) {
        addLog(`   ⚠️ Erro: ${e.message}`);
        rows = [];
      }

      // Generate XLSX bytes
      const xlsxBytes = _fexGenerateXLSX(tbl.label, tbl.cols, rows);
      zipFiles[`${tbl.id}.xlsx`] = xlsxBytes;
    }

    setProgress(90, 'Compactando ZIP…');
    addLog('→ Gerando ZIP...');

    // Build README
    const readmeTxt = [
      'FAMILY FINTRACK — Exportação de Dados',
      '='.repeat(40),
      `Família: ${currentUser?.family_id || 'N/A'}`,
      `Gerado em: ${new Date().toLocaleString('pt-BR')}`,
      `Usuário: ${currentUser?.name || currentUser?.email || 'N/A'}`,
      '',
      'Arquivos incluídos:',
      ...selected.map(t => `  ${t.icon} ${t.id}.xlsx — ${t.label}`),
      '',
      'Cada arquivo contém os dados de uma tabela do banco de dados.',
      'A primeira linha é o cabeçalho com os nomes das colunas.',
    ].join('\n');
    zipFiles['LEIA-ME.txt'] = new TextEncoder().encode(readmeTxt);

    const zipBlob = _fexBuildZip(zipFiles);

    setProgress(98, 'Fazendo download…');
    addLog('→ Download...');

    const fileName = `fintrack_export_${new Date().toISOString().slice(0,10)}.zip`;
    const url = URL.createObjectURL(zipBlob);
    const a   = document.createElement('a');
    a.href = url; a.download = fileName; a.click();
    URL.revokeObjectURL(url);

    setProgress(100, `✅ Exportação concluída! ${totalTables} planilhas.`);
    if (bar) bar.style.background = 'var(--green,#16a34a)';
    addLog(`✅ ZIP gerado: ${fileName}`);
    if (startBtn) { startBtn.textContent = '✓ Concluído'; }

    toast(`✅ ${totalTables} planilhas exportadas com sucesso!`, 'success');

  } catch(e) {
    if (errEl) { errEl.textContent = 'Erro: ' + (e.message || e); errEl.style.display = ''; }
    if (bar)   bar.style.background = 'var(--red)';
    if (startBtn) { startBtn.disabled = false; startBtn.textContent = '⬇️ Tentar novamente'; }
    console.error('[fexExport]', e);
  }
}
window.startFamilyExport = startFamilyExport;

// ── Generate single XLSX file as Uint8Array ──────────────────────────────────
function _fexGenerateXLSX(sheetName, cols, rows) {
  const enc = new TextEncoder();

  const escXml = (v) => {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&apos;')
      .replace(/[\x00-\x1F\x7F]/g, '');
  };

  const colLetter = (n) => {
    let s = ''; n++;
    while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
    return s;
  };

  const isNumeric = (v) => v !== '' && !isNaN(Number(String(v).replace(',','.')));

  const buildRow = (cells, ri, isHeader) => {
    const xml = cells.map((val, ci) => {
      const ref = colLetter(ci) + ri;
      const s   = escXml(val);
      if (isHeader) return `<c r="${ref}" s="1" t="inlineStr"><is><t>${s}</t></is></c>`;
      if (isNumeric(val) && typeof val !== 'boolean') {
        return `<c r="${ref}"><v>${Number(String(val).replace(',','.'))}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr"><is><t>${s}</t></is></c>`;
    }).join('');
    return `<row r="${ri}">${xml}</row>`;
  };

  let sheetData = buildRow(cols, 1, true);
  rows.forEach((row, i) => {
    const cells = cols.map(c => {
      const v = row[c];
      if (v === null || v === undefined) return '';
      if (typeof v === 'object') return JSON.stringify(v);
      return v;
    });
    sheetData += buildRow(cells, i + 2, false);
  });

  // Column widths
  const colsXml = cols.map((c, i) => `<col min="${i+1}" max="${i+1}" width="18" bestFit="1"/>`).join('');

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<cols>${colsXml}</cols>
<sheetData>${sheetData}</sheetData>
<sheetView showGridLines="1" tabSelected="1" workbookViewId="0"><selection activeCell="A1"/></sheetView>
</worksheet>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts>
  <font><sz val="10"/><name val="Calibri"/></font>
  <font><b/><sz val="10"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font>
</fonts>
<fills>
  <fill><patternFill patternType="none"/></fill>
  <fill><patternFill patternType="gray125"/></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FF2A6049"/></patternFill></fill>
</fills>
<borders><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs>
  <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
  <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0"/>
</cellXfs>
</styleSheet>`;

  const safeSheetName = sheetName.slice(0,31).replace(/[\\\/\?\*\[\]]/g,'');
  const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${escXml(safeSheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const pkgRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const files = {
    '[Content_Types].xml':        enc.encode(ct),
    '_rels/.rels':                 enc.encode(pkgRels),
    'xl/workbook.xml':             enc.encode(wb),
    'xl/_rels/workbook.xml.rels':  enc.encode(rels),
    'xl/worksheets/sheet1.xml':    enc.encode(sheet),
    'xl/styles.xml':               enc.encode(styles),
  };

  return _fexBuildZipRaw(files);
}

// ── Build a ZIP Blob from { path: Uint8Array } ───────────────────────────────
function _fexBuildZip(files) {
  // files = { 'name.xlsx': Uint8Array, ... }
  // Convert all values to Uint8Array
  const normalized = {};
  for (const [k, v] of Object.entries(files)) {
    normalized[k] = v instanceof Uint8Array ? v : new TextEncoder().encode(v);
  }
  const raw = _fexBuildZipRaw(normalized);
  return new Blob([raw], { type: 'application/zip' });
}

// ── Low-level ZIP builder (PKZIP, no compression) ────────────────────────────
function _fexBuildZipRaw(files) {
  // Reuse _exBuildZip logic from export_grid.js if available
  if (typeof _exBuildZip === 'function') {
    // _exBuildZip expects { path: string } — encode to string first
    const strFiles = {};
    for (const [k, v] of Object.entries(files)) {
      strFiles[k] = typeof v === 'string' ? v : new TextDecoder('latin1').decode(v);
    }
    return _exBuildZip(strFiles);
  }

  // Standalone minimal ZIP implementation
  const enc    = v => v instanceof Uint8Array ? v : new TextEncoder().encode(v);
  const u32le  = n => new Uint8Array([n&0xFF,(n>>8)&0xFF,(n>>16)&0xFF,(n>>24)&0xFF]);
  const u16le  = n => new Uint8Array([n&0xFF,(n>>8)&0xFF]);

  const crc32 = (data) => {
    let crc = 0xFFFFFFFF;
    const table = [];
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[i] = c;
    }
    for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  };

  const parts = [];
  const central = [];
  let offset = 0;

  for (const [name, rawVal] of Object.entries(files)) {
    const data  = enc(rawVal);
    const fname = new TextEncoder().encode(name);
    const crc   = crc32(data);
    const size  = data.length;

    const local = new Uint8Array([
      0x50,0x4B,0x03,0x04, // sig
      20,0,                  // version needed
      0,0,                   // flags
      0,0,                   // compression: stored
      0,0, 0,0,              // mod time/date
      ...u32le(crc),
      ...u32le(size),
      ...u32le(size),
      ...u16le(fname.length),
      0,0,                   // extra length
    ]);

    const cdEntry = new Uint8Array([
      0x50,0x4B,0x01,0x02,
      20,0, 20,0, 0,0, 0,0, 0,0, 0,0,
      ...u32le(crc),
      ...u32le(size),
      ...u32le(size),
      ...u16le(fname.length),
      0,0, 0,0, 0,0, 0,0, 0,0,
      0,0,0,0,
      ...u32le(offset),
    ]);

    parts.push(local, fname, data);
    central.push(cdEntry, fname);
    offset += local.length + fname.length + data.length;
  }

  const cdStart  = offset;
  const cdSize   = central.reduce((s, b) => s + b.length, 0);
  const cdCount  = Object.keys(files).length;
  const eocdr    = new Uint8Array([
    0x50,0x4B,0x05,0x06,
    0,0, 0,0,
    ...u16le(cdCount), ...u16le(cdCount),
    ...u32le(cdSize),
    ...u32le(cdStart),
    0,0,
  ]);

  const allParts = [...parts, ...central, eocdr];
  const totalLen = allParts.reduce((s, b) => s + b.length, 0);
  const result   = new Uint8Array(totalLen);
  let pos = 0;
  for (const p of allParts) { result.set(p, pos); pos += p.length; }
  return result;
}

