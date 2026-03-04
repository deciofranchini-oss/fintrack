/* ─── State ─── */
let importState = {
  section: 'all',
  sourcePreset: 'generic',
  rawRows: [],
  headers: [],
  headerRowIdx: 0,
  parsedData: null,
  fileLoaded: false,
  colMap: {},
  staging: { accounts:[], categories:[], payees:[], transactions:[] },
};

/* ─── Source presets ─── */
const SOURCE_PRESETS = {
  moneywiz: {
    label: 'MoneyWiz', isMoneywiz: true,
    fields: { account:'Conta', transfer_account:'Transferências', description:'Descrição',
              payee:'Beneficiário', category:'Categoria', date:'Data', time:'Hora',
              memo:'Memorando', amount:'Valor', currency:'Moeda', tags:'Tags', balance:'Saldo' },
  },
  generic: {
    label: 'CSV Genérico',
    fields: { date:'Data', description:'Descrição', amount:'Valor', account:'Conta',
              category:'Categoria', payee:'Beneficiário', memo:'Memo', currency:'Moeda' },
  },
  nubank: {
    label: 'Nubank',
    fields: { date:'date', description:'title', amount:'amount', category:'category' },
    accountName: 'Nubank', amountInvert: true,
  },
  inter: {
    label: 'Banco Inter',
    fields: { date:'Data Lançamento', description:'Histórico', amount:'Valor', type_col:'Tipo Transação' },
    accountName: 'Banco Inter',
  },
  itau: {
    label: 'Itaú',
    fields: { date:'Data', description:'Descrição', amount:'Valor' },
    accountName: 'Itaú', skipUntil: 'Data',
  },
  xp: {
    label: 'XP / Rico',
    fields: { date:'Data', description:'Descrição / Produto', amount:'Movimentação', type_col:'Tipo' },
    accountName: 'XP Investimentos',
  },
};

const FINTRACK_FIELDS = [
  { key:'date',             label:'Data',              required:true  },
  { key:'amount',           label:'Valor',             required:true  },
  { key:'description',      label:'Descrição',         required:false },
  { key:'account',          label:'Conta',             required:false },
  { key:'category',         label:'Categoria',         required:false },
  { key:'payee',            label:'Beneficiário',      required:false },
  { key:'memo',             label:'Memo/Obs',          required:false },
  { key:'currency',         label:'Moeda',             required:false },
  { key:'transfer_account', label:'Transferência para',required:false },
  { key:'amount_credit',    label:'Valor Crédito',     required:false },
  { key:'amount_debit',     label:'Valor Débito',      required:false },
  { key:'type_col',         label:'Tipo (C/D)',        required:false },
  { key:'parent_cat',       label:'Categoria Pai',     required:false },
  { key:'balance',          label:'Saldo Inicial',     required:false },
];

/* ─── Wizard navigation ─── */
function goToStep(n) {
  ['importStep1','colMapperScreen','fieldMapScreen','importProgress','importStagingArea'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  document.querySelectorAll('.import-wizard-step').forEach((el,i) => {
    el.classList.remove('active','done');
    if (i+1 < n) el.classList.add('done');
    else if (i+1 === n) el.classList.add('active');
  });
  if (n === 1) document.getElementById('importStep1').style.display = '';
  else if (n === 2) document.getElementById('colMapperScreen').style.display = '';
  else if (n === 3) {
    document.getElementById('importProgress').style.display = '';
    document.getElementById('importStagingArea').style.display = 'none';
  }
}

function selectImportSection(sec) {
  importState.section = sec;
  document.querySelectorAll('.import-section-card').forEach(el => el.classList.remove('active'));
  document.getElementById('isc-' + sec)?.classList.add('active');
}

function selectSourcePreset(preset) {
  importState.sourcePreset = preset;
  document.querySelectorAll('.source-chip').forEach(el => el.classList.remove('active'));
  document.getElementById('chip-' + preset)?.classList.add('active');
  if (importState.fileLoaded) buildColMapperUI();
}

/* ─── File handling ─── */
function importDragOver(e)  { e.preventDefault(); document.getElementById('importDropZone').classList.add('dragover'); }
function importDragLeave()  { document.getElementById('importDropZone').classList.remove('dragover'); }
function importDrop(e) { e.preventDefault(); importDragLeave(); const f = e.dataTransfer.files[0]; if (f) loadImportFile(f); }
function importFileSelected(e) { const f = e.target.files[0]; if (f) loadImportFile(f); }

function initImportPage() {
  const sel = document.getElementById('importAccountFilter');
  if (sel) {
    sel.innerHTML = '<option value="">— Detectar automaticamente —</option>' +
      (state.accounts||[]).map(a => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');
  }
  ['accounts','categories','payees','transactions'].forEach(s =>
    document.getElementById('isc-' + s)?.classList.remove('disabled'));
}

async function loadImportFile(file) {
  showImportProgress('Lendo arquivo...');
  importLogMsg('info', `📂 ${file.name} (${(file.size/1024).toFixed(0)} KB)`);
  try {
    let rows;
    const ext = file.name.toLowerCase();
    if (ext.endsWith('.csv') || file.type === 'text/csv') {
      const text = await file.text();
      rows = parseCsvToRows(text);
      importLogMsg('ok', `✓ ${rows.length} linhas (CSV)`);
    } else {
      const buf = await file.arrayBuffer();
      const wb  = XLSX.read(buf, { type:'array', raw:false });
      const wsn = wb.SheetNames.includes('report') ? 'report' : wb.SheetNames[0];
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wsn], { header:1, defval:null, raw:false });
      importLogMsg('ok', `✓ ${rows.length} linhas — aba "${wsn}"`);
    }
    importState.rawRows = rows;
    importState.fileLoaded = true;
    document.getElementById('importDropTitle').textContent = '✓ ' + file.name;
    document.getElementById('importDropSub').textContent = `${rows.length} linhas carregadas`;
    document.getElementById('importProgress').style.display = 'none';
    detectHeaderRow();
    buildColMapperUI();
    const preset = SOURCE_PRESETS[importState.sourcePreset] || SOURCE_PRESETS.generic;
    if (preset.isMoneywiz) {
      await proceedFromColMapper();
    } else {
      goToStep(2);
    }
  } catch(err) {
    importLogMsg('err', '✗ ' + err.message);
    console.error(err);
  }
}

/* ─── CSV Parser ─── */
function parseCsvToRows(text) {
  const lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
  const rows = [];
  let startLine = 0;
  if (lines[0] && lines[0].startsWith('sep=')) startLine = 1;
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { rows.push([]); continue; }
    rows.push(parseCsvLine(line));
  }
  return rows;
}
function parseCsvLine(line) {
  const result = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (inQ && line[i+1]==='"') { cur+='"'; i++; } else inQ=!inQ; }
    else if (c === ',' && !inQ) { result.push(cur||null); cur=''; }
    else cur += c;
  }
  result.push(cur||null);
  return result;
}

/* ─── Header detection ─── */
function detectHeaderRow() {
  const rows = importState.rawRows;
  let bestIdx = 0, bestScore = 0;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const r = rows[i];
    if (!r || r.length < 2) continue;
    const score = r.filter(c => c && typeof c === 'string' && c.length > 0 && c.length < 80 && !/^\d+[.,]?\d*$/.test(c.trim())).length;
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }
  importState.headerRowIdx = bestIdx;
  importState.headers = (rows[bestIdx] || []).map(c => c ? String(c).trim() : '');
}

/* ─── Auto column matching ─── */
function autoMatchColumns(headers, preset) {
  const colMap = {};
  const hLow = headers.map(h => h ? h.toLowerCase().replace(/\s+/g,' ').trim() : '');
  const fields = preset.fields || {};
  for (const [ftField, presetColName] of Object.entries(fields)) {
    if (!presetColName) continue;
    const target = presetColName.toLowerCase().replace(/\s+/g,' ').trim();
    let idx = hLow.findIndex(h => h === target);
    if (idx === -1) idx = hLow.findIndex(h => h.includes(target) || target.includes(h));
    if (idx >= 0) colMap[ftField] = idx;
  }
  const tryMatch = (ftField, keywords) => {
    if (colMap[ftField] !== undefined) return;
    for (const kw of keywords) {
      const idx = hLow.findIndex(h => h.includes(kw));
      if (idx >= 0) { colMap[ftField] = idx; return; }
    }
  };
  tryMatch('date',        ['data','date','dt ','dtpost','venciment']);
  tryMatch('description', ['descri','histór','memo','título','title','narrat','name']);
  tryMatch('amount',      ['valor','amount','vlr','montant','moviment','trnamt']);
  tryMatch('account',     ['conta','account','banco']);
  tryMatch('category',    ['categ','classif','grupo']);
  tryMatch('payee',       ['benefi','payee','credor','devedor']);
  tryMatch('memo',        ['obs','memo','complem','detalhe','note']);
  tryMatch('currency',    ['moeda','currency']);
  tryMatch('transfer_account', ['transfer','transf','destino']);
  tryMatch('amount_credit',    ['crédito','credit','entrada','créd']);
  tryMatch('amount_debit',     ['débito','debit','saída','déb']);
  tryMatch('type_col',         ['tipo','type','naturez','d/c','dc']);
  tryMatch('parent_cat',       ['categoria pai','parent cat']);
  tryMatch('balance',          ['saldo','balance']);
  return colMap;
}

/* ─── Column Mapper UI ─── */
function buildColMapperUI() {
  const preset  = SOURCE_PRESETS[importState.sourcePreset] || SOURCE_PRESETS.generic;
  const headers = importState.headers;
  const rows    = importState.rawRows;
  const hi      = importState.headerRowIdx;
  const sec     = importState.section;

  importState.colMap = autoMatchColumns(headers, preset);

  // Preview table
  const previewRows = rows.slice(hi, hi + 7);
  const colCount = Math.max(...previewRows.map(r => r ? r.length : 0), 1);
  document.getElementById('colPreviewInfo').textContent =
    `${rows.length} linhas · ${headers.length} colunas · cabeçalho na linha ${hi + 1}`;

  let headHtml = '<tr>';
  for (let c = 0; c < colCount; c++)
    headHtml += `<th id="previewTh-${c}">${esc(headers[c] || 'Col ' + (c+1))}</th>`;
  headHtml += '</tr>';

  let bodyHtml = '';
  previewRows.slice(1).forEach(r => {
    if (!r || r.every(v => !v)) return;
    bodyHtml += '<tr>';
    for (let c = 0; c < colCount; c++) {
      const v = r ? r[c] : null;
      bodyHtml += `<td>${(v !== null && v !== undefined && v !== '')
        ? esc(String(v).slice(0,50))
        : '<span style="color:var(--muted);font-size:.7em">—</span>'}</td>`;
    }
    bodyHtml += '</tr>';
  });
  document.getElementById('colPreviewHead').innerHTML = headHtml;
  document.getElementById('colPreviewBody').innerHTML = bodyHtml;

  const dataRows = rows.slice(hi + 1, hi + 7).filter(r => r && r.some(v => v));
  function getSamples(colIdx) {
    if (colIdx === undefined) return '';
    const vals = dataRows.map(r => r && r[colIdx] != null ? String(r[colIdx]).trim() : '').filter(Boolean);
    return vals.slice(0,3).join('  ·  ');
  }
  function makeSelOpts(fieldKey) {
    const cur = importState.colMap[fieldKey];
    let html = '<option value="">— Não mapeado —</option>';
    for (let i = 0; i < headers.length; i++) {
      const h = esc(headers[i] || `Col ${i+1}`);
      const sample = getSamples(i);
      const label  = sample ? `${h}  (ex: ${sample.slice(0,30)})` : h;
      html += `<option value="${i}"${cur === i ? ' selected' : ''}>${label}</option>`;
    }
    return html;
  }
  function makeField(key, label, hint, required=false, span2=false) {
    const isMapped = importState.colMap[key] !== undefined;
    const sample   = isMapped ? getSamples(importState.colMap[key]) : '';
    const reqStar  = required ? '<span class="req-star">*</span>' : '';
    const spanStyle = span2 ? ' style="grid-column:1/-1"' : '';
    return `<div class="col-mapper-row${required?' required-field':''}"${spanStyle}>
      <div class="col-mapper-label">${esc(label)}${reqStar}</div>
      ${hint ? `<div class="col-mapper-hint">${esc(hint)}</div>` : ''}
      <select class="col-mapper-select${isMapped?' mapped':''}" id="colsel-${key}"
              onchange="onColSelChange('${key}',this.value)">
        ${makeSelOpts(key)}
      </select>
      <div class="col-mapper-sample" id="colsample-${key}">${sample ? '📎 ' + esc(sample) : ''}</div>
    </div>`;
  }
  function makeGroup(icon, title, sub, fieldDefs) {
    return `<div class="cmap-group">
      <div class="cmap-group-header">
        <div class="cmap-group-icon">${icon}</div>
        <div><div class="cmap-group-title">${title}</div><div class="cmap-group-sub">${sub}</div></div>
      </div>
      <div class="cmap-group-body">${fieldDefs.join('')}</div>
    </div>`;
  }

  const secLabels = {
    all: 'Importação completa — Contas + Categorias + Beneficiários + Transações',
    accounts: 'Importar Contas', categories: 'Importar Categorias',
    payees: 'Importar Beneficiários', transactions: 'Importar Transações'
  };
  document.getElementById('cmapSubtitle').textContent =
    `${secLabels[sec]||sec} — Indique qual coluna do arquivo corresponde a cada campo.`;

  const hasTransactions = (sec === 'all' || sec === 'transactions');
  document.getElementById('importModeBar').style.display = hasTransactions ? '' : 'none';

  let html = '';
  if (sec === 'categories') {
    html += makeGroup('🏷️','Colunas para Categorias','Qual coluna tem o nome da categoria?',[
      makeField('category','Nome da Categoria','Ex: Alimentação, Transporte',true,true),
      makeField('parent_cat','Categoria Pai','Quando há subcategorias',false,true),
    ]);
  } else if (sec === 'payees') {
    html += makeGroup('👤','Colunas para Beneficiários','Qual coluna tem o nome do beneficiário?',[
      makeField('payee','Nome do Beneficiário','Ex: Supermercado, Amazon',true,true),
    ]);
  } else if (sec === 'accounts') {
    html += makeGroup('🏦','Colunas para Contas','Mapeie os dados das contas bancárias',[
      makeField('account','Nome da Conta','Ex: Nubank, Itaú',true,false),
      makeField('currency','Moeda','Ex: BRL, USD',false,false),
      makeField('balance','Saldo Inicial','Saldo no início da importação',false,false),
    ]);
  } else {
    html += makeGroup('💳','Dados Obrigatórios','Data e valor são indispensáveis',[
      makeField('date',   'Data',   'Ex: 01/01/2024, 2024-01-01',true,false),
      makeField('amount', 'Valor',  'Negativo = débito, Positivo = crédito',true,false),
      makeField('amount_credit','Valor Crédito (alternativo)','Coluna separada de entradas',false,false),
      makeField('amount_debit', 'Valor Débito (alternativo)', 'Coluna separada de saídas',false,false),
      makeField('type_col',     'Tipo C/D (alternativo)',     'Coluna que diz se é Crédito ou Débito',false,false),
    ]);
    html += makeGroup('📝','Detalhes da Transação','Informações complementares',[
      makeField('description','Descrição / Título','Nome ou motivo',false,false),
      makeField('memo','Memo / Observações','Notas extras',false,false),
    ]);
    html += makeGroup('🏦','Conta da Transação','Em qual conta cada transação foi realizada?',[
      makeField('account','Coluna com Nome da Conta','Ex: Nubank, Itaú',false,false),
      makeField('transfer_account','Conta Transferência','Conta destino em transferências',false,false),
      makeField('currency','Moeda','BRL, USD, EUR...',false,false),
    ]);
    html += makeGroup('🏷️','Categoria','Qual coluna indica a categoria?',[
      makeField('category','Categoria','Ex: Alimentação, Saúde/Farmácia',false,true),
    ]);
    html += makeGroup('👤','Beneficiário','Quem pagou ou recebeu?',[
      makeField('payee','Beneficiário / Fornecedor','Ex: Supermercado Extra',false,true),
    ]);
  }

  document.getElementById('colMapperGrid').innerHTML = html;

  const accSel = document.getElementById('importAccountFilter');
  if (accSel) {
    const prev = accSel.value;
    accSel.innerHTML = '<option value="">— Detectar automaticamente —</option>';
    (state.accounts||[]).forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.id; opt.textContent = a.name;
      if (a.id === prev) opt.selected = true;
      accSel.appendChild(opt);
    });
  }
  updatePreviewHighlights();
}

function onColSelChange(key, val) {
  if (val === '') delete importState.colMap[key];
  else importState.colMap[key] = parseInt(val);
  const sampleEl = document.getElementById(`colsample-${key}`);
  if (sampleEl) {
    const hi    = importState.headerRowIdx;
    const dRows = importState.rawRows.slice(hi+1, hi+7).filter(r => r && r.some(v => v));
    const colIdx = importState.colMap[key];
    if (colIdx !== undefined) {
      const vals = dRows.map(r => r && r[colIdx] != null ? String(r[colIdx]).trim() : '').filter(Boolean);
      sampleEl.textContent = vals.length ? '📎 ' + vals.slice(0,3).join('  ·  ') : '';
    } else sampleEl.textContent = '';
  }
  const sel = document.getElementById(`colsel-${key}`);
  if (sel) sel.classList.toggle('mapped', val !== '');
  updatePreviewHighlights();
}

function updatePreviewHighlights() {
  const mapped = new Set(Object.values(importState.colMap));
  document.querySelectorAll('[id^="previewTh-"]').forEach(th => {
    const idx = parseInt(th.id.replace('previewTh-',''));
    th.classList.toggle('col-mapped', mapped.has(idx));
  });
}

/* ─── Proceed from Column Mapper ─── */
async function proceedFromColMapper() {
  const sec    = importState.section;
  const colMap = importState.colMap;
  const preset = SOURCE_PRESETS[importState.sourcePreset] || SOURCE_PRESETS.generic;

  if (!preset.isMoneywiz) {
    if ((sec === 'all' || sec === 'transactions') && colMap.date === undefined) {
      toast('Mapeie a coluna "Data" antes de continuar.', 'warning'); return;
    }
    if ((sec === 'all' || sec === 'transactions') &&
        colMap.amount === undefined && colMap.amount_credit === undefined && colMap.amount_debit === undefined) {
      toast('Mapeie ao menos uma coluna de "Valor" antes de continuar.', 'warning'); return;
    }
    if (sec === 'categories' && colMap.category === undefined) {
      toast('Mapeie a coluna "Categoria" antes de continuar.', 'warning'); return;
    }
    if (sec === 'payees' && colMap.payee === undefined) {
      toast('Mapeie a coluna "Beneficiário" antes de continuar.', 'warning'); return;
    }
    if (sec === 'accounts' && colMap.account === undefined) {
      toast('Mapeie a coluna "Conta" antes de continuar.', 'warning'); return;
    }
  }

  showImportProgress('Analisando dados do arquivo...');
  goToStep(3);
  document.getElementById('importStagingArea').style.display = 'none';

  try {
    let parsedData;
    if (preset.isMoneywiz) {
      parsedData = parseMoneyWizRows(importState.rawRows);
    } else {
      parsedData = parseGenericRows(importState.rawRows, importState.headerRowIdx, colMap, preset);
    }
    importState.parsedData = parsedData;

    const accCnt = parsedData.accounts.length;
    const catCnt = parsedData.categories.size;
    const payCnt = parsedData.payees.size;
    const txCnt  = parsedData.transactions.length;
    importLogMsg('ok', `✓ ${accCnt} contas · ${catCnt} categorias · ${payCnt} beneficiários · ${txCnt} transações`);

    if (txCnt === 0 && catCnt === 0 && accCnt === 0 && payCnt === 0) {
      importLogMsg('warn', '⚠️ Nenhum dado foi reconhecido. Verifique o mapeamento de colunas.');
      goToStep(2);
      return;
    }

    setImportProgress(50, 'Preparando revisão...');
    showFieldMapScreen(parsedData);
    document.getElementById('importProgress').style.display = 'none';
    document.getElementById('fieldMapScreen').style.display = '';
    document.getElementById('importStagingArea').style.display = 'none';
    document.querySelectorAll('.import-wizard-step').forEach((el,i) => {
      el.classList.remove('active','done');
      if (i < 1) el.classList.add('done');
      else if (i === 1) el.classList.add('active');
    });
  } catch(err) {
    importLogMsg('err', '✗ ' + err.message);
    console.error(err);
    goToStep(2);
  }
}

/* ─── Generic row parser ─── */
function parseGenericRows(rows, headerIdx, colMap, preset) {
  const accounts = [], categories = new Set(), payees = new Set(), transactions = [];
  const transferAccounts = new Set();
  const accSet = new Set();

  const get = (row, field) => {
    const idx = colMap[field];
    if (idx === undefined || idx === null || idx >= row.length) return null;
    const v = row[idx];
    return (v !== null && v !== undefined) ? String(v).trim().replace(/\xa0/g,' ') : null;
  };

  const overrideAccName = preset.accountName || null;
  const filterAccId = document.getElementById('importAccountFilter')?.value || '';
  let filterAccName = null;
  if (filterAccId) {
    const fa = (state.accounts||[]).find(a => a.id === filterAccId);
    if (fa) filterAccName = fa.name;
  }

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0 || row.every(c => !c)) continue;

    const rawDate = get(row, 'date');
    if (!rawDate) continue;
    const date = parseImportDate(rawDate);
    if (!date) continue;

    // Resolve amount
    let amount = 0;
    if (colMap.amount !== undefined) {
      const rawAmt = get(row, 'amount');
      if (rawAmt) amount = parseImportAmt(rawAmt);
    }
    // Override with credit/debit columns if both mapped
    if (colMap.amount_credit !== undefined || colMap.amount_debit !== undefined) {
      const cred = parseImportAmt(get(row, 'amount_credit') || '0');
      const deb  = parseImportAmt(get(row, 'amount_debit')  || '0');
      if (Math.abs(cred) > 0 || Math.abs(deb) > 0) {
        amount = Math.abs(cred) - Math.abs(deb);
      }
    }
    // Apply type column (C/D)
    if (colMap.type_col !== undefined) {
      const typeVal = (get(row, 'type_col') || '').toLowerCase().trim();
      const isDebit  = /^d$|déb|deb|saíd|out/.test(typeVal);
      const isCredit = /^c$|créd|cred|entra|rec/.test(typeVal);
      if (isDebit && amount > 0) amount = -amount;
      if (isCredit && amount < 0) amount = -amount;
    }
    if (preset.amountInvert) amount = -amount;
    if (amount === 0) continue; // skip zero-amount rows

    const accRaw = get(row, 'account') || overrideAccName || 'Importação';
    if (filterAccName && accRaw.toLowerCase() !== filterAccName.toLowerCase()) continue;

    if (!accSet.has(accRaw.toLowerCase())) {
      accSet.add(accRaw.toLowerCase());
      accounts.push({ name: accRaw, balance: 0, currency: 'BRL', transactions: [] });
    }
    const acc = accounts.find(a => a.name.toLowerCase() === accRaw.toLowerCase());

    const cat       = get(row, 'category');
    const desc      = get(row, 'description') || get(row, 'memo') || '';
    const payeeName = get(row, 'payee') || (desc ? null : null);
    const currency  = get(row, 'currency') || 'BRL';
    const xfer      = get(row, 'transfer_account');
    const memo      = get(row, 'memo');

    if (cat) categories.add(cat);
    if (payeeName) payees.add(payeeName);
    if (xfer) transferAccounts.add(xfer);

    const tx = {
      account_name: accRaw, transfer_account: xfer||null,
      description: desc, payee_name: payeeName,
      category_path: cat||null, date, time: '12:00',
      memo: memo||null, amount, currency,
      is_transfer: !!xfer,
      import_key: `${accRaw}|${date}|${amount.toFixed(2)}|${desc}`,
    };
    transactions.push(tx);
    if (acc) { acc.transactions.push(tx); acc.balance += amount; }
  }

  return { accounts, categories, payees, transactions, transferAccounts };
}

/* ─── MoneyWiz parser ─── */
function parseMoneyWizRows(rows) {
  const accounts=[], categories=new Set(), payees=new Set(), transactions=[];
  const transferAccounts=new Set();

  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const r = rows[i];
    if (r && r[0] && (r[0]==='Nome' || r[0]==='Name')) { headerIdx = i; break; }
    if (r && r[1] && r[1]==='Saldo atual') { headerIdx = i; break; }
  }
  const startIdx = headerIdx >= 0 ? headerIdx + 1 : 2;
  const clean = s => s ? String(s).replace(/\xa0/g,' ').replace(/\u00a0/g,' ').trim() : '';
  const isCurrency = s => /^[A-Z]{2,4}$/.test(s);
  let currentAccount = null;

  for (let i = startIdx; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 3) continue;
    const c0=clean(r[0]), c2=clean(r[2]), c7=clean(r[7]);

    if (c0 && !c7 && (isCurrency(c2) || (!c2 && !clean(r[3])))) {
      const currency = isCurrency(c2) ? c2 : 'BRL';
      currentAccount = { name:c0, balance:parseImportAmt(clean(r[1])||'0'), currency, transactions:[] };
      accounts.push(currentAccount);
    } else if (!c0 && c2 && c7 && /\d/.test(c7)) {
      const accName = c2;
      const acc = accounts.find(a => a.name === accName) || currentAccount;
      if (!acc) continue;
      const cat=clean(r[6]), pay=clean(r[5]), desc=clean(r[4]);
      const dt=parseImportDate(c7), tm=clean(r[8])||'12:00';
      const amt=parseImportAmt(clean(r[10]));
      const xfer=clean(r[3]), curr=clean(r[11])||acc.currency||'BRL';
      if (!dt) continue;
      if (cat) categories.add(cat);
      if (pay) payees.add(pay);
      if (xfer) transferAccounts.add(xfer);
      const tx = {
        account_name:accName, transfer_account:xfer||null, description:desc,
        payee_name:pay||null, category_path:cat||null, date:dt, time:tm,
        memo:clean(r[9])||null, amount:amt, currency:curr, is_transfer:!!xfer,
        import_key:`${accName}|${dt}|${amt.toFixed(2)}|${desc}`,
      };
      transactions.push(tx);
      acc.transactions.push(tx);
      currentAccount = acc;
    }
  }
  accounts.forEach(a => { if (!a.balance) a.balance = a.transactions.reduce((s,t)=>s+(t.amount||0),0); });
  return { accounts, categories, payees, transactions, transferAccounts };
}

/* ─── Amount & Date parsers ─── */
function parseImportAmt(s) {
  if (s === null || s === undefined || s === '') return 0;
  const str = String(s).replace(/\xa0/g,' ').trim();
  const isNeg = str.startsWith('-') || str.endsWith('-') || (str.startsWith('(') && str.endsWith(')'));
  let clean = str.replace(/[()\-R$€£¥\s]/g,'');
  // BR format: 1.234,56 → detect by comma as decimal separator
  if (/,\d{1,2}$/.test(clean)) {
    clean = clean.replace(/\./g,'').replace(',','.');
  } else {
    clean = clean.replace(/,/g,'');
  }
  const v = parseFloat(clean);
  if (isNaN(v)) return 0;
  return isNeg ? -Math.abs(v) : v;
}

function parseImportDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  // ISO: 2024-01-31
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0,10);
  // DD/MM/YYYY (Brazilian format - day is always first in Brazil)
  let m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const [,d,mo,y] = m;
    return `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  // DD.MM.YYYY
  m = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) { const[,d,mo,y]=m; return `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`; }
  // YYYYMMDD (OFX)
  m = str.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) { const[,y,mo,d]=m; return `${y}-${mo}-${d}`; }
  // Excel serial date
  if (/^\d{4,6}$/.test(str)) {
    const serial = parseInt(str);
    if (serial > 40000 && serial < 60000) {
      const d = new Date((serial - 25569) * 86400 * 1000);
      return d.toISOString().slice(0,10);
    }
  }
  return null;
}

function inferAccType(name) {
  const n = name.toLowerCase();
  if (/mastercard|visa |click|azul|pão|porto seguro|nubank credit|cartão|credit card/.test(n)) return 'cartao_credito';
  if (/investimento|brasilprev|fgts|xp|rico|tesouro|fundo/.test(n)) return 'investimento';
  if (/dinheiro|espécie|cash/.test(n)) return 'dinheiro';
  return 'corrente';
}
function inferCatType(path) {
  return /salário|bônus|férias|plr|rendimento|juros|proventos|reembolso|cashback|pix crédito|atividade profissional|vendas|indeniz|restituição/i.test(path) ? 'receita' : 'despesa';
}

/* ─── Field Map Screen (entity review) ─── */
const fieldMap = { accounts:{}, transfers:{} };

function showFieldMapScreen(parsedData) {
  const d = parsedData;
  fieldMap.accounts = {}; fieldMap.transfers = {};

  const accTxCount={}, catTxCount={}, payTxCount={}, xferTxCount={};
  d.transactions.forEach(tx => {
    if(tx.account_name)     accTxCount[tx.account_name]      = (accTxCount[tx.account_name]||0)+1;
    if(tx.category_path)    catTxCount[tx.category_path]     = (catTxCount[tx.category_path]||0)+1;
    if(tx.payee_name)       payTxCount[tx.payee_name]        = (payTxCount[tx.payee_name]||0)+1;
    if(tx.transfer_account) xferTxCount[tx.transfer_account] = (xferTxCount[tx.transfer_account]||0)+1;
  });

  const exAcc={}, exCat={}, exPay={};
  (state.accounts||[]).forEach(a  => exAcc[a.name.toLowerCase()] = a);
  (state.categories||[]).forEach(c => exCat[c.name.toLowerCase()] = c);
  (state.payees||[]).forEach(p    => exPay[p.name.toLowerCase()] = p);

  const mkBadge = exists => exists
    ? `<span class="map-badge-exists">Existente</span>`
    : `<span class="map-badge-new">Novo</span>`;

  const accOptsList = '<option value="">— Criar automaticamente —</option>' +
    (state.accounts||[]).map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('');

  // Accounts
  let newAccN=0, accHtml='';
  d.accounts.forEach(a => {
    const ex = exAcc[a.name.toLowerCase()];
    if(!ex) newAccN++;
    const typeInferred = inferAccType(a.name);
    const typeLbl = {corrente:'Corrente',cartao_credito:'Crédito',investimento:'Invest.',dinheiro:'Dinheiro',outros:'Outros'}[typeInferred]||typeInferred;
    accHtml += `<tr>
      <td><strong>${esc(a.name)}</strong><br><span style="font-size:.7rem;color:var(--muted)">${typeLbl} · ${a.currency||'BRL'}</span></td>
      <td style="text-align:center">${accTxCount[a.name]||0}</td>
      <td class="${(a.balance||0)>=0?'amount-pos':'amount-neg'}" style="white-space:nowrap">${fmt(a.balance||0,a.currency||'BRL')}</td>
      <td>${mkBadge(ex)}</td>
      <td>${ex
        ? `<span style="font-size:.78rem;color:var(--accent);font-weight:600">✓ ${esc(ex.name)}</span>`
        : `<select class="map-select" onchange="setFieldMap('account','${esc(a.name)}',this.value)">${accOptsList}</select>`
      }</td></tr>`;
  });
  document.getElementById('fmAccountsBody').innerHTML = accHtml ||
    '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:20px">Nenhuma conta encontrada</td></tr>';
  document.getElementById('fmTabAccBadge').textContent = `(${d.accounts.length}, ${newAccN} nov.)`;

  // Categories
  let newCatN=0, catHtml='';
  [...d.categories].sort().forEach(path => {
    const parts = path.split('►').map(p=>p.trim());
    const leaf = parts[parts.length-1];
    const ex = exCat[leaf.toLowerCase()];
    const type = inferCatType(path);
    if(!ex) newCatN++;
    const hierarchy = parts.length>1 ? `<span style="color:var(--muted);font-size:.7rem">${parts.slice(0,-1).join(' › ')} › </span>` : '';
    catHtml += `<tr>
      <td>${'&nbsp;'.repeat((parts.length-1)*3)}${hierarchy}<strong>${esc(leaf)}</strong></td>
      <td><span class="badge ${type==='receita'?'badge-green':'badge-red'}" style="font-size:.65rem">${type}</span></td>
      <td style="text-align:center">${catTxCount[path]||0}</td>
      <td>${mkBadge(ex)}</td></tr>`;
  });
  document.getElementById('fmCategoriesBody').innerHTML = catHtml ||
    '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:20px">Nenhuma categoria</td></tr>';
  document.getElementById('fmTabCatBadge').textContent = `(${d.categories.size}, ${newCatN} nov.)`;

  // Payees
  let newPayN=0, payHtml='';
  [...d.payees].sort().forEach(name => {
    const ex = exPay[name.toLowerCase()];
    if(!ex) newPayN++;
    payHtml += `<tr>
      <td>${esc(name)}</td>
      <td style="text-align:center">${payTxCount[name]||0}</td>
      <td>${mkBadge(ex)}</td></tr>`;
  });
  document.getElementById('fmPayeesBody').innerHTML = payHtml ||
    '<tr><td colspan="3" style="text-align:center;color:var(--muted);padding:20px">Nenhum beneficiário</td></tr>';
  document.getElementById('fmTabPayBadge').textContent = `(${d.payees.size}, ${newPayN} nov.)`;

  // Transfers
  const xferSet = d.transferAccounts || new Set();
  let newXferN=0, xferHtml='';
  [...xferSet].sort().forEach(xname => {
    const exInApp = exAcc[xname.toLowerCase()];
    if(!exInApp) newXferN++;
    xferHtml += `<tr>
      <td><strong>${esc(xname)}</strong></td>
      <td style="text-align:center">${xferTxCount[xname]||0}</td>
      <td>${exInApp ? `<span class="map-badge-exists">Mapeada</span>` : `<span class="map-badge-new">Não existe</span>`}</td>
      <td><select class="map-select" onchange="setFieldMap('transfer','${esc(xname)}',this.value)">
        <option value="">— Ignorar —</option>
        ${(state.accounts||[]).map(a=>`<option value="${a.id}"${exInApp&&exInApp.id===a.id?' selected':''}>${esc(a.name)}</option>`).join('')}
      </select></td></tr>`;
  });
  document.getElementById('fmTransfersBody').innerHTML = xferHtml ||
    '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:20px">Nenhuma transferência</td></tr>';
  document.getElementById('fmTabXferBadge').textContent = `(${xferSet.size}, ${newXferN} sem conta)`;

  const totalNew = newAccN + newCatN + newPayN;
  const btn = document.getElementById('proceedImportBtn');
  if(btn) btn.textContent = totalNew > 0
    ? `Importar → (${totalNew} itens novos serão criados)`
    : 'Importar →';
}

function showFieldMapTab(tab) {
  document.querySelectorAll('.field-map-tab').forEach((t,i) => {
    const tabs = ['accounts','categories','payees','transfers'];
    t.classList.toggle('active', tabs[i] === tab);
  });
  document.querySelectorAll('.field-map-panel').forEach(p => {
    p.classList.toggle('active', p.id === 'fmpanel-' + tab);
  });
}
function setFieldMap(type, mwName, fintrackId) {
  if (type === 'account')  fieldMap.accounts[mwName]  = fintrackId || 'new';
  if (type === 'transfer') fieldMap.transfers[mwName] = fintrackId || 'new';
}

async function proceedFromFieldMap() {
  document.getElementById('fieldMapScreen').style.display = 'none';
  showImportProgress('Analisando...');
  goToStep(3);
  await analyzeAndStage();
}

/* ─── Analyze & Stage ─── */
async function analyzeAndStage() {
  const sec = importState.section, d = importState.parsedData;
  if (!d) { importLogMsg('err','Nenhum dado parseado.'); return; }
  setImportProgress(30, 'Verificando existentes...');
  showStagingArea(false);
  const s = { accounts:[], categories:[], payees:[], transactions:[] };
  importState.staging = s;

  if (sec === 'all' || sec === 'accounts') {
    const ex = new Set((state.accounts||[]).map(a => a.name.toLowerCase()));
    for (const acc of d.accounts)
      s.accounts.push({ ...acc, type: inferAccType(acc.name),
        action: ex.has(acc.name.toLowerCase()) ? 'skip' : 'insert' });
    importLogMsg('info', `Contas: ${s.accounts.filter(x=>x.action==='insert').length} novas`);
  }

  if (sec === 'all' || sec === 'categories') {
    setImportProgress(45, 'Categorias...');
    const ex = new Set((state.categories||[]).map(c => c.name.toLowerCase()));
    const seen = new Set();
    for (const path of d.categories) {
      const parts = path.split('►').map(p => p.trim());
      for (let depth = 0; depth < parts.length; depth++) {
        const name = parts[depth], key = name.toLowerCase();
        if (seen.has(key)) continue; seen.add(key);
        s.categories.push({ name, parentName: depth > 0 ? parts[depth-1] : null,
          full_path: path, type: inferCatType(path),
          action: ex.has(key) ? 'skip' : 'insert' });
      }
    }
    importLogMsg('info', `Categorias: ${s.categories.filter(x=>x.action==='insert').length} novas`);
  }

  if (sec === 'all' || sec === 'payees') {
    setImportProgress(55, 'Beneficiários...');
    const ex = new Set((state.payees||[]).map(p => p.name.toLowerCase()));
    for (const raw of d.payees) {
      const name = String(raw).replace(/\xa0/g,' ').trim(); if (!name) continue;
      s.payees.push({ name, action: ex.has(name.toLowerCase()) ? 'skip' : 'insert' });
    }
    importLogMsg('info', `Beneficiários: ${s.payees.filter(x=>x.action==='insert').length} novos`);
  }

  if (sec === 'all' || sec === 'transactions') {
    setImportProgress(65, 'Transações...');
    await stageTransactions(d.transactions, s.transactions);
  }

  setImportProgress(90, 'Montando visualização...');
  renderStaging(s);
  setImportProgress(100, '✓ Pronto para importar');
  showStagingArea(true);
}

async function stageTransactions(allTx, out) {
  const mode = document.querySelector('input[name="importMode"]:checked')?.value || 'new';
  let exKeys = new Set(), cutoffs = {};

  try {
    if (mode === 'new') {
      for (const acc of (state.accounts||[])) {
        const { data } = await sb.from('transactions').select('date')
          .eq('account_id', acc.id).order('date',{ascending:false}).limit(1);
        if (data?.length) cutoffs[acc.name.toLowerCase()] = data[0].date;
      }
    } else if (mode === 'update') {
      // Check if import_key column exists by trying to select it
      const { data, error } = await sb.from('transactions').select('import_key').limit(1);
      if (!error) {
        const { data: allKeys } = await sb.from('transactions').select('import_key').not('import_key','is',null);
        (allKeys||[]).forEach(r => exKeys.add(r.import_key));
      }
    }
  } catch(e) {
    importLogMsg('warn', '⚠️ Não foi possível verificar duplicatas: ' + e.message);
  }

  for (const tx of allTx) {
    if (!tx.date) continue;
    let action = 'insert', reason = null;
    if (mode === 'new') {
      const co = cutoffs[tx.account_name?.toLowerCase()];
      if (co && tx.date <= co) { action = 'skip'; reason = `Já existe após ${co}`; }
    } else if (mode === 'update') {
      if (exKeys.has(tx.import_key)) action = 'update';
    }
    out.push({ ...tx, action, conflict_reason: reason });
  }
  const ins = out.filter(t=>t.action==='insert').length;
  const upd = out.filter(t=>t.action==='update').length;
  const skp = out.filter(t=>t.action==='skip').length;
  importLogMsg('info', `Transações: ${ins} para criar · ${upd} para atualizar · ${skp} ignoradas`);
}

/* ─── Staging UI ─── */
function renderStaging(s) {
  const tabC = document.getElementById('stagingTabs');
  const tabs = [];
  if (s.accounts.length)     tabs.push({id:'accounts',     label:`🏦 Contas (${s.accounts.filter(x=>x.action!=='skip').length})`});
  if (s.categories.length)   tabs.push({id:'categories',   label:`🏷️ Cats (${s.categories.filter(x=>x.action!=='skip').length})`});
  if (s.payees.length)       tabs.push({id:'payees',       label:`👤 Benef. (${s.payees.filter(x=>x.action!=='skip').length})`});
  if (s.transactions.length) tabs.push({id:'transactions', label:`💳 Trans. (${s.transactions.filter(x=>x.action!=='skip').length})`});
  if (!tabs.length) {
    document.getElementById('stagingContent').innerHTML =
      '<div style="text-align:center;padding:40px;color:var(--muted)">Nenhum dado novo para importar.</div>';
    tabC.innerHTML = ''; return;
  }
  tabC.innerHTML = tabs.map(t =>
    `<button class="staging-tab ${t.id===tabs[0].id?'active':''}" onclick="showStagingTab('${t.id}')" id="stab-${t.id}">${t.label}</button>`
  ).join('');
  const totIns = s.accounts.filter(x=>x.action==='insert').length + s.categories.filter(x=>x.action==='insert').length +
                 s.payees.filter(x=>x.action==='insert').length + s.transactions.filter(x=>x.action==='insert').length;
  const totSkp = s.accounts.filter(x=>x.action==='skip').length + s.categories.filter(x=>x.action==='skip').length +
                 s.payees.filter(x=>x.action==='skip').length + s.transactions.filter(x=>x.action==='skip').length;
  document.getElementById('stagingSubtitle').textContent = `${totIns} para criar · ${totSkp} ignorados`;
  showStagingTab(tabs[0].id);
}

function showStagingTab(id) {
  document.querySelectorAll('.staging-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('stab-' + id)?.classList.add('active');
  const data = importState.staging[id] || [];
  const cont = document.getElementById('stagingContent');
  const MAX = 400;
  const bdg = a => `<span class="staging-action-badge badge-${a}">${a==='insert'?'Criar':a==='update'?'Atualizar':'Ignorar'}</span>`;
  let html = '<div class="table-wrap"><table><thead><tr>';
  if (id === 'accounts') {
    html += '<th>Ação</th><th>Nome</th><th>Tipo</th><th>Moeda</th><th>Saldo</th></tr></thead><tbody>';
    data.slice(0,MAX).forEach(a =>
      html += `<tr class="staging-row-${a.action}"><td>${bdg(a.action)}</td><td><strong>${esc(a.name)}</strong></td><td style="font-size:.78rem">${a.type||''}</td><td>${a.currency||'BRL'}</td><td class="${a.balance>=0?'amount-pos':'amount-neg'}">${fmt(a.balance||0,a.currency||'BRL')}</td></tr>`);
  } else if (id === 'categories') {
    html += '<th>Ação</th><th>Nome</th><th>Tipo</th><th>Hierarquia</th></tr></thead><tbody>';
    data.slice(0,MAX).forEach(c =>
      html += `<tr class="staging-row-${c.action}"><td>${bdg(c.action)}</td><td>${esc(c.name)}${c.parentName?` <span style="font-size:.72rem;color:var(--muted)">← ${esc(c.parentName)}</span>`:''}</td><td><span class="badge ${c.type==='receita'?'badge-green':'badge-red'}" style="font-size:.65rem">${c.type}</span></td><td style="font-size:.7rem;color:var(--muted)">${esc(c.full_path||'')}</td></tr>`);
  } else if (id === 'payees') {
    html += '<th>Ação</th><th>Nome</th></tr></thead><tbody>';
    data.slice(0,MAX).forEach(p =>
      html += `<tr class="staging-row-${p.action}"><td>${bdg(p.action)}</td><td>${esc(p.name)}</td></tr>`);
  } else {
    html += '<th>Ação</th><th>Data</th><th>Conta</th><th>Descrição</th><th>Categoria</th><th>Valor</th><th>Razão</th></tr></thead><tbody>';
    data.slice(0,MAX).forEach(t =>
      html += `<tr class="staging-row-${t.action}"><td>${bdg(t.action)}</td>
        <td style="white-space:nowrap;font-size:.78rem;color:var(--muted)">${t.date||''}</td>
        <td style="font-size:.78rem">${esc(t.account_name||'')}</td>
        <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(t.description||'')}">${esc(t.description||'')}</td>
        <td style="font-size:.7rem;color:var(--muted);max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.category_path||'')}</td>
        <td class="${(t.amount||0)>=0?'amount-pos':'amount-neg'}" style="font-weight:600;white-space:nowrap">${fmt(t.amount||0,t.currency||'BRL')}</td>
        <td style="font-size:.7rem;color:var(--muted)">${t.conflict_reason||''}</td>
      </tr>`);
    if (data.length > MAX) html += `<tr><td colspan="7" style="text-align:center;padding:10px;color:var(--muted);font-size:.78rem">… mais ${data.length-MAX} registros (${MAX} de ${data.length})</td></tr>`;
  }
  html += '</tbody></table></div>';
  cont.innerHTML = html;
}

/* ─── Commit ─── */
async function commitImport() {
  const btn = document.getElementById('commitImportBtn');
  btn.disabled = true; btn.textContent = '⏳ Importando...';
  showImportProgress('Importando...');
  try {
    const s = importState.staging, sec = importState.section;

    // 1. Create accounts
    if (sec === 'all' || sec === 'accounts') {
      setImportProgress(10, 'Criando contas...');
      for (const acc of s.accounts.filter(a => a.action === 'insert')) {
        const { error } = await sb.from('accounts').insert({ family_id: famId(),
          name: acc.name, type: acc.type || 'corrente',
          currency: acc.currency || 'BRL',
          balance: acc.balance || 0,
          color: '#2a6049', active: true,
        });
        if (error) importLogMsg('err', `Conta "${acc.name}": ${error.message}`);
        else importLogMsg('ok', `✓ Conta "${acc.name}" criada`);
      }
      await loadAccounts();
      populateSelects();
    }

    // 2. Create categories
    if (sec === 'all' || sec === 'categories') {
      setImportProgress(25, 'Criando categorias...');
      const toC = s.categories.filter(c => c.action === 'insert');
      const pIds = {};
      // First: top-level
      for (const cat of toC.filter(c => !c.parentName)) {
        const { data, error } = await sb.from('categories')
          .insert({ name: cat.name, type: cat.type || 'despesa', icon: '📦', color: '#2a6049' })
          .select('id,name').single();
        if (data) pIds[cat.name.toLowerCase()] = data.id;
        else if (error) importLogMsg('err', `Cat "${cat.name}": ${error.message}`);
      }
      await loadCategories();
      (state.categories||[]).forEach(c => { if (!c.parent_id) pIds[c.name.toLowerCase()] = c.id; });
      // Then: sub-categories
      for (const cat of toC.filter(c => c.parentName)) {
        const pid = pIds[cat.parentName.toLowerCase()];
        const { error } = await sb.from('categories').insert({ family_id: famId(),
          name: cat.name, type: cat.type || 'despesa',
          parent_id: pid || null, icon: '📦', color: '#94a3b8',
        });
        if (error) importLogMsg('err', `SubCat "${cat.name}": ${error.message}`);
      }
      importLogMsg('ok', `✓ ${toC.length} categorias criadas`);
      await loadCategories();
    }

    // 3. Create payees (batch)
    if (sec === 'all' || sec === 'payees') {
      setImportProgress(40, 'Criando beneficiários...');
      const toC = s.payees.filter(p => p.action === 'insert');
      for (let i = 0; i < toC.length; i += 100) {
        const batch = toC.slice(i, i+100).map(p => ({ name: p.name }));
        const { error } = await sb.from('payees').insert(batch.map(p=>({...p,family_id:famId()})));
        if (error) importLogMsg('err', `Payees batch ${i}: ${error.message}`);
      }
      importLogMsg('ok', `✓ ${toC.length} beneficiários criados`);
      await loadPayees();
    }

    // 4. Import transactions
    if (sec === 'all' || sec === 'transactions') {
      setImportProgress(55, 'Importando transações...');
      await commitTransactions(s.transactions);
    }

    // 5. Sync account balances (from file data)
    if ((sec === 'all' || sec === 'accounts') && importState.parsedData) {
      setImportProgress(90, 'Sincronizando saldos...');
      for (const pa of importState.parsedData.accounts) {
        if (!pa.balance && pa.balance !== 0) continue;
        const acc = (state.accounts||[]).find(a => a.name.toLowerCase() === pa.name.toLowerCase());
        if (acc) {
          const { error } = await sb.from('accounts').update({ balance: pa.balance }).eq('id', acc.id);
          if (error) importLogMsg('warn', `Saldo "${pa.name}": ${error.message}`);
        }
      }
      await loadAccounts();
      importLogMsg('ok', '✓ Saldos sincronizados');
    }

    setImportProgress(100, '✓ Importação concluída!');
    importLogMsg('ok', '🎉 Importação concluída com sucesso!');
    toast('Importação concluída!', 'success');
    setTimeout(() => cancelImport(), 3000);

  } catch(err) {
    importLogMsg('err', '✗ ' + err.message);
    toast('Erro: ' + err.message, 'error');
    console.error(err);
  } finally {
    btn.disabled = false; btn.textContent = '✓ Confirmar Importação';
  }
}

async function commitTransactions(txList) {
  // Reload fresh data for ID lookups
  await Promise.all([loadAccounts(), loadCategories(), loadPayees()]);

  const accMap = {}, catMap = {}, payMap = {};
  (state.accounts||[]).forEach(a   => accMap[a.name.toLowerCase()] = a);
  (state.categories||[]).forEach(c => catMap[c.name.toLowerCase()] = c);
  (state.payees||[]).forEach(p     => payMap[p.name.toLowerCase()] = p);

  // Check if import_key column exists
  let hasImportKey = false;
  try {
    const { error } = await sb.from('transactions').select('import_key').limit(1);
    if (!error) hasImportKey = true;
  } catch(e) { hasImportKey = false; }

  const toIns = txList.filter(t => t.action === 'insert');
  const toUpd = txList.filter(t => t.action === 'update');
  let created = 0, updated = 0, errors = 0, skipped = 0;

  // Insert in batches of 100
  for (let i = 0; i < toIns.length; i += 100) {
    setImportProgress(55 + Math.floor(i / Math.max(toIns.length,1) * 30),
      `Inserindo ${i}–${Math.min(i+100,toIns.length)} de ${toIns.length}…`);
    const batch = toIns.slice(i, i+100)
      .map(tx => buildTxRecord(tx, accMap, catMap, payMap, hasImportKey))
      .filter(Boolean);
    skipped += (toIns.slice(i, i+100).length - batch.length);
    if (!batch.length) continue;
    const { error } = await sb.from('transactions').insert(batch.map(t=>({...t,family_id:famId()})));
    if (error) {
      importLogMsg('err', `Batch ${i}: ${error.message}`);
      errors++;
      // If batch failed due to unknown column, try without import_key
      if (hasImportKey && (error.message.includes('import_key') || error.message.includes('column'))) {
        hasImportKey = false;
        const batchRetry = toIns.slice(i, i+100)
          .map(tx => buildTxRecord(tx, accMap, catMap, payMap, false))
          .filter(Boolean);
        const { error: err2 } = await sb.from('transactions').insert(batchRetry.map(t=>({...t,family_id:famId()})));
        if (!err2) { created += batchRetry.length; errors--; }
      }
    } else created += batch.length;
  }

  // Updates
  for (const tx of toUpd) {
    const rec = buildTxRecord(tx, accMap, catMap, payMap, hasImportKey);
    if (!rec) { skipped++; continue; }
    // Try to find existing transaction by key or date+account+amount
    const acc = accMap[tx.account_name?.toLowerCase()];
    if (!acc) { skipped++; continue; }
    const { error } = await sb.from('transactions').update(rec)
      .eq('account_id', acc.id).eq('date', tx.date).eq('amount', tx.amount)
      .eq('description', tx.description || '');
    if (error) { importLogMsg('warn', `Update: ${error.message}`); errors++; }
    else updated++;
  }

  if (skipped > 0) importLogMsg('warn', `⚠️ ${skipped} ignoradas — conta não encontrada ou inválida`);
  importLogMsg('ok', `✓ ${created} criadas · ${updated} atualizadas · ${errors} erros`);
}

function buildTxRecord(tx, accMap, catMap, payMap, includeImportKey=false) {
  const acc = accMap[tx.account_name?.toLowerCase()];
  if (!acc) {
    console.warn('[import] account not found:', tx.account_name);
    return null;
  }

  let cat = null;
  if (tx.category_path) {
    const separators = ['►', '>', '/', '\\'];
    let leaf = tx.category_path;
    for (const sep of separators) {
      if (tx.category_path.includes(sep)) { leaf = tx.category_path.split(sep).pop().trim(); break; }
    }
    cat = catMap[leaf.toLowerCase()] || catMap[tx.category_path.toLowerCase()] || null;
  }

  const pay = tx.payee_name ? (payMap[tx.payee_name.toLowerCase()] || null) : null;

  const rec = {
    account_id:  acc.id,
    description: tx.description || '',
    amount:      typeof tx.amount === 'number' ? tx.amount : parseFloat(tx.amount) || 0,
    date:        tx.date,
    category_id: cat?.id || null,
    payee_id:    pay?.id || null,
    memo:        tx.memo || null,
    is_transfer: tx.is_transfer || false,
    currency:    tx.currency || acc.currency || 'BRL',
  };

  if (includeImportKey && tx.import_key) {
    rec.import_key = tx.import_key;
  }

  return rec;
}

function cancelImport() {
  importState = {
    section: importState.section, sourcePreset: importState.sourcePreset,
    rawRows:[], headers:[], headerRowIdx:0, parsedData:null, fileLoaded:false,
    colMap:{}, staging:{ accounts:[], categories:[], payees:[], transactions:[] },
  };
  const fi = document.getElementById('importFileInput');
  if (fi) fi.value = '';
  document.getElementById('importDropTitle').textContent = 'Arraste o arquivo ou clique para selecionar';
  document.getElementById('importDropSub').textContent = 'Suporta CSV, XLSX, XLS — qualquer formato';
  document.getElementById('importProgress').style.display = 'none';
  const log = document.getElementById('importLog');
  if (log) log.innerHTML = '';
  showStagingArea(false);
  goToStep(1);
}

/* ─── Progress / Log helpers ─── */
function showImportProgress(msg) {
  const el = document.getElementById('importProgress'); if(el) el.style.display='';
  if(msg) { const t = document.getElementById('importProgressTitle'); if(t) t.textContent=msg; }
}
function setImportProgress(pct, msg) {
  const bar = document.getElementById('importProgressBar');
  const pEl = document.getElementById('importProgressPct');
  const tEl = document.getElementById('importProgressTitle');
  if(bar) bar.style.width = pct+'%';
  if(pEl) pEl.textContent = pct+'%';
  if(msg && tEl) tEl.textContent = msg;
}
function importLogMsg(type, msg) {
  const el = document.getElementById('importLog'); if(!el) return;
  const line = document.createElement('div');
  line.className = 'log-' + type; line.textContent = msg;
  el.appendChild(line); el.scrollTop = el.scrollHeight;
}
function showStagingArea(show) {
  const el = document.getElementById('importStagingArea'); if(el) el.style.display = show?'':'none';
}



/* ══════════════════════════════════════════════════════════════════
   BACKUP & RESTORE
══════════════════════════════════════════════════════════════════ */
