/* ═══════════════════════════════════════════════════════════════════════════
   IMPORT AI — Detecção inteligente de formato + mapeamento de colunas
   Usa o mesmo mecanismo do receipt_ai.js (Gemini via Google AI API)

   Fluxo:
     1. Arquivo carregado → extrair amostra de texto (primeiras ~60 linhas)
     2. Enviar ao Gemini com prompt especializado em extratos/planilhas
     3. Gemini retorna JSON: { preset, headerRowIdx, colMap, bankName,
                               fileType, confidence, notes }
     4. Aplicar resultado → pular mapeamento manual se confiança alta
     5. Mostrar badge com resumo do que foi identificado
   ═══════════════════════════════════════════════════════════════════════════ */

const IMPORT_AI_MAX_ROWS   = 60;   // linhas enviadas para análise
const IMPORT_AI_MIN_CONF   = 0.70; // confiança mínima para auto-avançar
const IMPORT_AI_MODEL      = 'gemini-2.5-flash-lite';

// Estado da análise IA atual
window._importAiResult = null;

// ══════════════════════════════════════════════════════════════════════════
//  SEÇÃO 1 — PONTO DE ENTRADA: chamado após loadImportFile parsear as linhas
// ══════════════════════════════════════════════════════════════════════════

async function analyzeImportWithAI(file, rows) {
  const apiKey = await getAppSetting(RECEIPT_AI_KEY_SETTING, '');
  if (!apiKey || !apiKey.startsWith('AIza')) {
    // Sem IA configurada — fluxo normal
    _renderImportAiBadge(null);
    return null;
  }

  _renderImportAiBadge('loading');
  window._importAiResult = null;

  try {
    const sample  = _buildSampleText(file.name, rows);
    const result  = await _callGeminiForImport(apiKey, file.name, sample);
    window._importAiResult = result;
    _renderImportAiBadge(result);
    return result;
  } catch (e) {
    console.warn('[ImportAI] análise falhou:', e.message);
    _renderImportAiBadge({ error: e.message });
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════════════
//  SEÇÃO 2 — CONSTRUÇÃO DA AMOSTRA DE TEXTO
// ══════════════════════════════════════════════════════════════════════════

function _buildSampleText(fileName, rows) {
  const take = rows.slice(0, IMPORT_AI_MAX_ROWS);
  const lines = take.map((row, i) => {
    if (!row || row.length === 0) return `[linha ${i} vazia]`;
    return row.map(c => c == null ? '' : String(c)).join('\t');
  });
  return `ARQUIVO: ${fileName}\nLINHAS (${rows.length} total, mostrando ${take.length}):\n` + lines.join('\n');
}

// ══════════════════════════════════════════════════════════════════════════
//  SEÇÃO 3 — CHAMADA AO GEMINI
// ══════════════════════════════════════════════════════════════════════════

async function _callGeminiForImport(apiKey, fileName, sampleText) {
  const presetsDesc = Object.entries(SOURCE_PRESETS)
    .map(([k, v]) => `"${k}": ${v.label}`)
    .join(', ');

  const fintrackFieldsDesc = FINTRACK_FIELDS
    .map(f => `"${f.key}" (${f.label}${f.required ? ', obrigatório' : ''})`)
    .join(', ');

  const prompt = `Você é um especialista em análise de arquivos financeiros e extratos bancários brasileiros.
Analise o conteúdo do arquivo abaixo e identifique seu formato, estrutura e mapeamento de colunas.
Responda SOMENTE com JSON válido, sem markdown, sem texto antes ou depois.

PRESETS DISPONÍVEIS: ${presetsDesc}

CAMPOS DO SISTEMA (use as "keys" exatas): ${fintrackFieldsDesc}

CONTEÚDO DO ARQUIVO:
${sampleText}

RETORNE EXATAMENTE ESTE JSON:
{
  "preset": "moneywiz|generic|nubank|inter|itau|xp|ofx|bradesco|santander|bb|caixa|sicoob|c6bank|picpay|mercadopago|pagbank|outro",
  "bankName": "nome do banco/plataforma identificado ou null",
  "fileType": "extrato_bancario|cartao_credito|planilha_financeira|moneywiz_export|ofx|csv_generico",
  "headerRowIdx": 0,
  "colMap": {
    "date": <índice 0-based da coluna de data ou null>,
    "amount": <índice da coluna de valor total ou null>,
    "amount_credit": <índice da coluna de crédito/entrada ou null>,
    "amount_debit": <índice da coluna de débito/saída ou null>,
    "description": <índice da descrição/histórico ou null>,
    "payee": <índice do beneficiário/estabelecimento ou null>,
    "category": <índice da categoria ou null>,
    "account": <índice da conta ou null>,
    "memo": <índice do memo/observação ou null>,
    "currency": <índice da moeda ou null>,
    "type_col": <índice da coluna tipo C/D ou null>,
    "balance": <índice do saldo ou null>
  },
  "amountInvert": false,
  "confidence": 0.0,
  "notes": "observação curta sobre o formato identificado",
  "warnings": ["aviso1", "aviso2"]
}

REGRAS DE ANÁLISE:
- headerRowIdx: índice (0-based) da linha que contém os cabeçalhos das colunas
- colMap: use o índice numérico da coluna (0-based), null se não existir
- Para extratos com colunas separadas Débito/Crédito: use amount_credit e amount_debit (não amount)
- Para Itaú: colunas costumam ser Data, Lançamento, Valor; headerRowIdx pode não ser 0
- Para Nubank CSV: colunas são date, title, amount, category (valores positivos = despesa)
- Para Banco Inter: colunas Data Lançamento, Histórico, Tipo Transação, Valor
- Para Bradesco/Santander/BB/Caixa: normalmente têm linhas de cabeçalho antes dos dados
- Para MoneyWiz: preset="moneywiz", não precisa de colMap
- Para OFX: preset="ofx" se o arquivo for XML/SGML; se for CSV convertido use colMap
- amountInvert: true se valores de despesa aparecem como positivos (ex: Nubank CSV)
- confidence: 0.0–1.0, sua confiança no mapeamento. Use >0.85 apenas se tiver certeza total
- Se não conseguir identificar: preset="generic", confidence=0.3, notes explicando
- Arquivo: ${fileName}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${IMPORT_AI_MODEL}:generateContent?key=${apiKey}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 1200, temperature: 0.05 },
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    const msg = err?.error?.message || `HTTP ${resp.status}`;
    if (resp.status === 429) throw new Error('Limite de requisições atingido.');
    throw new Error(msg);
  }

  const data  = await resp.json();
  const text  = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const clean = text.replace(/```json|```/g, '').trim();

  let parsed;
  try { parsed = JSON.parse(clean); }
  catch { throw new Error('Resposta inválida da IA: ' + text.slice(0, 120)); }

  // Normalizar colMap: remover nulls, converter strings para int
  if (parsed.colMap) {
    const cm = {};
    for (const [k, v] of Object.entries(parsed.colMap)) {
      if (v !== null && v !== undefined && v !== '') {
        const n = parseInt(v);
        if (!isNaN(n)) cm[k] = n;
      }
    }
    parsed.colMap = cm;
  }

  return parsed;
}

// ══════════════════════════════════════════════════════════════════════════
//  SEÇÃO 4 — APLICAR RESULTADO AO ESTADO DO WIZARD
// ══════════════════════════════════════════════════════════════════════════

function applyImportAiResult(result) {
  if (!result || result.error) return false;

  // Aplicar preset
  const presetKey = _resolvePreset(result.preset);
  importState.sourcePreset = presetKey;
  document.querySelectorAll('.source-chip').forEach(el => el.classList.remove('active'));
  document.getElementById('chip-' + presetKey)?.classList.add('active');

  // Aplicar headerRowIdx
  if (typeof result.headerRowIdx === 'number') {
    importState.headerRowIdx = result.headerRowIdx;
    importState.headers = (importState.rawRows[result.headerRowIdx] || [])
      .map(c => c ? String(c).trim() : '');
  }

  // Aplicar colMap
  if (result.colMap && Object.keys(result.colMap).length > 0) {
    importState.colMap = { ...result.colMap };
  }

  // Aplicar amountInvert ao preset em memória
  const preset = SOURCE_PRESETS[presetKey];
  if (preset && result.amountInvert !== undefined) {
    preset.amountInvert = result.amountInvert;
  }

  return true;
}

function _resolvePreset(aiPreset) {
  // Se o preset existe no SOURCE_PRESETS, usa direto
  if (SOURCE_PRESETS[aiPreset]) return aiPreset;
  // Bancos não mapeados → generic
  return 'generic';
}

// ══════════════════════════════════════════════════════════════════════════
//  SEÇÃO 5 — UI: BADGE DE RESULTADO
// ══════════════════════════════════════════════════════════════════════════

function _renderImportAiBadge(result) {
  const container = document.getElementById('importAiBadge');
  if (!container) return;

  if (!result) {
    container.style.display = 'none';
    return;
  }

  if (result === 'loading') {
    container.style.display = '';
    container.innerHTML = `
      <div class="import-ai-badge import-ai-badge--loading">
        <span class="ai-spin">⏳</span>
        <span>Analisando arquivo com IA…</span>
      </div>`;
    return;
  }

  if (result.error) {
    container.style.display = '';
    container.innerHTML = `
      <div class="import-ai-badge import-ai-badge--warn">
        <span>⚠️</span>
        <span>IA indisponível — mapeie as colunas manualmente. <small style="opacity:.7">${esc(result.error)}</small></span>
      </div>`;
    return;
  }

  const pct       = Math.round((result.confidence || 0) * 100);
  const confColor = pct >= 85 ? 'var(--green)' : pct >= 60 ? 'var(--amber)' : 'var(--red)';
  const autoMsg   = result.confidence >= IMPORT_AI_MIN_CONF
    ? '✓ Mapeamento aplicado automaticamente'
    : '⚠️ Revise o mapeamento antes de continuar';

  const colCount  = Object.keys(result.colMap || {}).length;
  const bankLabel = result.bankName
    ? `<strong>${esc(result.bankName)}</strong>`
    : `<strong>${esc(result.preset || 'Genérico')}</strong>`;

  const warnings  = (result.warnings || []).length > 0
    ? `<div class="import-ai-warns">${result.warnings.map(w => `<span>⚠ ${esc(w)}</span>`).join('')}</div>`
    : '';

  container.style.display = '';
  container.innerHTML = `
    <div class="import-ai-badge import-ai-badge--${pct >= 70 ? 'ok' : 'warn'}">
      <div class="import-ai-badge-row">
        <span style="font-size:1.1rem">🤖</span>
        <div class="import-ai-badge-body">
          <div class="import-ai-badge-title">
            Arquivo identificado como ${bankLabel}
            <span class="import-ai-conf" style="color:${confColor}">${pct}%</span>
          </div>
          <div class="import-ai-badge-sub">
            ${esc(result.fileType || '')} · ${colCount} coluna${colCount !== 1 ? 's' : ''} mapeada${colCount !== 1 ? 's' : ''}
            ${result.notes ? ' · ' + esc(result.notes) : ''}
          </div>
          <div class="import-ai-badge-status">${autoMsg}</div>
          ${warnings}
        </div>
        <button class="import-ai-dismiss" onclick="dismissImportAiBadge()" title="Fechar">✕</button>
      </div>
    </div>`;
}

function dismissImportAiBadge() {
  const el = document.getElementById('importAiBadge');
  if (el) el.style.display = 'none';
}

// ══════════════════════════════════════════════════════════════════════════
//  SEÇÃO 6 — INTEGRAÇÃO COM loadImportFile (patch não-destrutivo)
// ══════════════════════════════════════════════════════════════════════════

// Esta função é chamada pelo loadImportFile DEPOIS de parsear as linhas.
// Retorna true se deve auto-avançar (confiança alta + moneywiz/preset conhecido).
async function runImportAIPipeline(file, rows) {
  const result = await analyzeImportWithAI(file, rows);
  if (!result || result.error) return false;

  const applied = applyImportAiResult(result);
  if (!applied) return false;

  // Reconstruir UI de mapeamento com os novos valores
  buildColMapperUI();

  // Auto-avançar se: MoneyWiz OU confiança >= threshold
  const preset = SOURCE_PRESETS[importState.sourcePreset];
  if (preset?.isMoneywiz) return true;
  if (result.confidence >= IMPORT_AI_MIN_CONF) return true;

  return false;
}
