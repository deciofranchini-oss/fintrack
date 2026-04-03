/* ════════════════════════════════════════════════════════════════════════════
   export_grid.js — Exportação de tabelas para CSV e Excel (XLSX nativo)
   Respeita filtros: só exporta linhas visíveis (display !== 'none').
   Sem dependências externas — XLSX gerado via XML Office Open.
   ════════════════════════════════════════════════════════════════════════════ */

// ── Utilitário: escape XML para células de string ────────────────────────────
function _exEscXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

// ── Detectar se célula é numérica (permite vírgula decimal pt-BR) ─────────
function _exIsNumber(s) {
  const clean = String(s).replace(/[R$\s]/g,'').replace(/\./g,'').replace(',','.');
  return !isNaN(parseFloat(clean)) && clean.trim() !== '';
}
function _exToNumber(s) {
  const clean = String(s).replace(/[R$\s]/g,'').replace(/\./g,'').replace(',','.');
  return parseFloat(clean);
}

// ── Extrai linhas visíveis de uma tabela ─────────────────────────────────────
// Aceita: tableId (string) ou elemento <table>/<tbody>
// Retorna: { headers: string[], rows: string[][] }
function _exExtractTable(source) {
  let table;
  if (typeof source === 'string') {
    // Pode ser um <table>, <tbody>, ou container com <table> dentro
    const el = document.getElementById(source);
    if (!el) return null;
    table = el.tagName === 'TABLE' ? el : (el.closest('table') || el.querySelector('table'));
  } else {
    table = source;
  }
  if (!table) return null;

  const headers = [];
  const rows    = [];

  // Cabeçalhos
  const thead = table.querySelector('thead');
  if (thead) {
    thead.querySelectorAll('tr').forEach(tr => {
      if (_exRowVisible(tr)) {
        tr.querySelectorAll('th, td').forEach(th => {
          if (_exCellVisible(th)) headers.push(th.innerText?.trim() || '');
        });
      }
    });
  }

  // Corpo — apenas linhas visíveis
  const tbodies = table.querySelectorAll('tbody');
  tbodies.forEach(tb => {
    tb.querySelectorAll('tr').forEach(tr => {
      if (!_exRowVisible(tr)) return;
      const row = [];
      tr.querySelectorAll('td').forEach(td => {
        if (_exCellVisible(td)) row.push(td.innerText?.trim() || '');
      });
      if (row.length && row.some(c => c !== '')) rows.push(row);
    });
  });

  return { headers, rows };
}

function _exRowVisible(tr) {
  if (!tr) return false;
  if (tr.style.display === 'none') return false;
  // Verificar ancestral imediato (tbody ou grupo colapsado)
  let p = tr.parentElement;
  while (p && p.tagName !== 'TABLE') {
    if (p.style.display === 'none') return false;
    if (p.style.maxHeight === '0px' || p.style.maxHeight === '0') return false;
    p = p.parentElement;
  }
  return true;
}
function _exCellVisible(td) {
  return !td.hidden && td.style.display !== 'none' && td.colSpan < 8;
}

// ── Gera e baixa um CSV ──────────────────────────────────────────────────────
function _exDownloadCSV(data, filename) {
  const { headers, rows } = data;
  const sep   = ';';
  const lines = [];
  if (headers.length) lines.push(headers.map(h => `"${h.replace(/"/g,'""')}"`).join(sep));
  rows.forEach(row => {
    lines.push(row.map(c => {
      const v = String(c).replace(/"/g,'""');
      return `"${v}"`;
    }).join(sep));
  });
  const bom  = '\uFEFF'; // BOM UTF-8 para Excel abrir corretamente
  const blob = new Blob([bom + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  _exTriggerDownload(blob, filename + '.csv');
}

// ── Gera e baixa um XLSX (Office Open XML, sem libs externas) ────────────────
function _exDownloadXLSX(data, filename) {
  const { headers, rows } = data;

  // Converte número de coluna para letra(s) Excel: 0→A, 25→Z, 26→AA…
  const colLetter = n => {
    let s = ''; n++;
    while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
    return s;
  };

  // Monta células de uma linha
  const buildRow = (cells, rowIdx, isHeader) => {
    const cellsXml = cells.map((val, ci) => {
      const ref  = colLetter(ci) + rowIdx;
      const sVal = _exEscXml(val);
      if (isHeader) {
        return `<c r="${ref}" s="1" t="inlineStr"><is><t>${sVal}</t></is></c>`;
      }
      if (_exIsNumber(val)) {
        const num = _exToNumber(val);
        return `<c r="${ref}"><v>${num}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr"><is><t>${sVal}</t></is></c>`;
    }).join('');
    return `<row r="${rowIdx}">${cellsXml}</row>`;
  };

  let sheetData = '';
  let ri = 1;
  if (headers.length) { sheetData += buildRow(headers, ri++, true); }
  rows.forEach(row  => { sheetData += buildRow(row, ri++, false); });

  // Estilos básicos: bold para cabeçalho (style id=1)
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts><font><sz val="11"/><name val="Calibri"/></font>
       <font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills><fill><patternFill patternType="none"/></fill>
       <fill><patternFill patternType="gray125"/></fill></fills>
<borders><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs>
  <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
  <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/>
</cellXfs>
</styleSheet>`;

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>${sheetData}</sheetData></worksheet>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Dados" sheetId="1" r:id="rId1"/></sheets></workbook>`;

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

  // Montar ZIP manualmente (PKZIP local file headers)
  const files = {
    '[Content_Types].xml':         ct,
    '_rels/.rels':                  pkgRels,
    'xl/workbook.xml':              wb,
    'xl/_rels/workbook.xml.rels':   rels,
    'xl/worksheets/sheet1.xml':     sheet,
    'xl/styles.xml':                styles,
  };

  const zip = _exBuildZip(files);
  _exTriggerDownload(new Blob([zip], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename + '.xlsx');
}

// ── Mini ZIP builder (sem dependências) ─────────────────────────────────────
function _exBuildZip(files) {
  const enc    = new TextEncoder();
  const parts  = [];
  const central = [];
  let   offset  = 0;

  const crc32 = data => {
    let crc = 0xFFFFFFFF;
    const table = _exCRC32Table();
    for (let i = 0; i < data.length; i++) crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xFF];
    return (crc ^ 0xFFFFFFFF) >>> 0;
  };

  for (const [name, content] of Object.entries(files)) {
    const nameBytes    = enc.encode(name);
    const contentBytes = enc.encode(content);
    const crc          = crc32(contentBytes);
    const size         = contentBytes.length;
    const date         = 0x5365, time = 0x0000; // fixed date

    // Local file header
    const lh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0,  0x04034B50, true); // signature
    lv.setUint16(4,  20, true);          // version needed
    lv.setUint16(6,  0, true);           // flags
    lv.setUint16(8,  0, true);           // compression: stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    lh.set(nameBytes, 30);
    parts.push(lh, contentBytes);

    // Central directory entry
    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0,  0x02014B50, true);
    cv.setUint16(4,  20, true); cv.setUint16(6,  20, true);
    cv.setUint16(8,  0, true);  cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true); cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true); cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true); cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true); cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    central.push(cd);

    offset += 30 + nameBytes.length + size;
  }

  const centralBytes = central.reduce((a, b) => { const c = new Uint8Array(a.length + b.length); c.set(a); c.set(b, a.length); return c; }, new Uint8Array(0));
  const eocd = new Uint8Array(22);
  const ev   = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054B50, true);
  ev.setUint16(4, 0, true); ev.setUint16(6, 0, true);
  ev.setUint16(8, central.length, true); ev.setUint16(10, central.length, true);
  ev.setUint32(12, centralBytes.length, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const allParts = [...parts, centralBytes, eocd];
  const total    = allParts.reduce((s, p) => s + p.length, 0);
  const result   = new Uint8Array(total);
  let   pos      = 0;
  allParts.forEach(p => { result.set(p, pos); pos += p.length; });
  return result;
}

let _crc32Table = null;
function _exCRC32Table() {
  if (_crc32Table) return _crc32Table;
  _crc32Table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    _crc32Table[i] = c;
  }
  return _crc32Table;
}

function _exTriggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href    = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

// ── API pública ──────────────────────────────────────────────────────────────
/**
 * Exporta uma tabela para CSV ou Excel.
 * @param {string|HTMLElement} source — ID da tabela ou elemento
 * @param {string} filename — nome do arquivo (sem extensão)
 * @param {'csv'|'xlsx'} format
 */
function exportGrid(source, filename, format = 'xlsx') {
  const data = _exExtractTable(source);
  if (!data || (!data.headers.length && !data.rows.length)) {
    toast('Nenhum dado visível para exportar.', 'warning'); return;
  }
  const label = format === 'csv' ? 'CSV' : 'Excel';
  if (format === 'csv') {
    _exDownloadCSV(data, filename);
  } else {
    _exDownloadXLSX(data, filename);
  }
  toast(`✅ ${data.rows.length} linha(s) exportadas para ${label}.`, 'success');
}
window.exportGrid = exportGrid;

/**
 * Renderiza um dropdown de exportação (CSV + Excel) ancorado a um botão.
 * Uso: <button onclick="showExportMenu(this,'txMainTable','transacoes')">⬇ Exportar</button>
 */
function showExportMenu(btn, tableId, filename) {
  // Remove menu anterior se existir
  document.getElementById('_exMenu')?.remove();

  const rect = btn.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.id = '_exMenu';
  menu.style.cssText = `position:fixed;z-index:9999;background:var(--surface);
    border:1.5px solid var(--border);border-radius:10px;padding:6px;
    box-shadow:0 8px 24px rgba(0,0,0,.15);min-width:160px;
    top:${rect.bottom + 6}px;left:${rect.left}px`;

  const items = [
    { label: '📊 Excel (.xlsx)', fmt: 'xlsx' },
    { label: '📄 CSV (.csv)',    fmt: 'csv'  },
  ];

  items.forEach(({ label, fmt }) => {
    const item = document.createElement('button');
    item.textContent = label;
    item.style.cssText = `display:flex;width:100%;padding:8px 12px;border:none;
      background:none;color:var(--text);font-family:var(--font-sans);
      font-size:.82rem;text-align:left;cursor:pointer;border-radius:7px;
      transition:background .12s;align-items:center;gap:8px`;
    item.onmouseover = () => { item.style.background = 'var(--surface2)'; };
    item.onmouseout  = () => { item.style.background = ''; };
    item.onclick = () => {
      exportGrid(tableId, filename, fmt);
      menu.remove();
    };
    menu.appendChild(item);
  });

  document.body.appendChild(menu);
  // Fechar ao clicar fora
  setTimeout(() => {
    document.addEventListener('click', function _close(e) {
      if (!menu.contains(e.target) && e.target !== btn) {
        menu.remove();
        document.removeEventListener('click', _close);
      }
    });
  }, 10);
}
window.showExportMenu = showExportMenu;
