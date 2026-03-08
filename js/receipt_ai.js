/* ═══════════════════════════════════════════════════════════════════════════
   RECEIPT AI — Leitura inteligente de recibos/notas com Claude API
   Suporta: fotos JPG/PNG/WebP + PDF (renderizado via pdf.js)
   Fluxo: arquivo → base64 → Claude Vision → JSON → preenche modal de transação
   Custo estimado: ~US$0,001–0,003 por leitura (Haiku)
═══════════════════════════════════════════════════════════════════════════ */

const RECEIPT_AI_KEY_SETTING = 'gemini_api_key';
const RECEIPT_AI_MODEL       = 'gemini-2.5-flash-lite';
const PDFJS_CDN_JS  = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_CDN_WK  = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// arquivo já preparado em base64 aguardando clique no botão de IA
window._receiptAiPending = null; // { base64, mediaType, fileName }

// ══════════════════════════════════════════════════════════════════════════
//  SEÇÃO 1 — CONFIGURAÇÃO DA API KEY
// ══════════════════════════════════════════════════════════════════════════

async function showAiConfig() {
  const val = await getAppSetting(RECEIPT_AI_KEY_SETTING, '');
  const inp = document.getElementById('anthropicApiKeyInput');
  if (inp) { inp.value = val || ''; inp.type = 'password'; }
  const tog = document.getElementById('aiKeyToggle');
  if (tog) tog.textContent = '👁';
  openModal('aiConfigModal');
}

async function saveAiConfig() {
  const inp = document.getElementById('anthropicApiKeyInput');
  const key = (inp?.value || '').trim();
  if (key && !key.startsWith('AIza')) {
    toast('Chave inválida — deve começar com AIza…', 'error');
    return;
  }
  await saveAppSetting(RECEIPT_AI_KEY_SETTING, key);
  _updateAiStatusBadge();
  closeModal('aiConfigModal');
  toast(key ? '✅ Chave Anthropic salva!' : 'Chave removida', key ? 'success' : 'info');
}

function toggleAiKeyVisibility() {
  const inp = document.getElementById('anthropicApiKeyInput');
  const btn = document.getElementById('aiKeyToggle');
  if (!inp) return;
  inp.type = (inp.type === 'password') ? 'text' : 'password';
  if (btn) btn.textContent = inp.type === 'password' ? '👁' : '🙈';
}

async function _updateAiStatusBadge() {
  const key = await getAppSetting(RECEIPT_AI_KEY_SETTING, '');
  const ok  = !!(key && key.startsWith('AIza'));
  const dot = document.getElementById('aiStatusDot');
  const sub = document.getElementById('aiSettingsSub');
  if (dot) {
    dot.style.cssText = `width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${ok ? 'var(--green,#22c55e)' : '#d1d5db'}`;
  }
  if (sub) sub.textContent = ok
    ? '✓ Configurado — leitura de recibos com IA ativa'
    : 'Configure para habilitar leitura automática de recibos';
}

// chamado por loadSettings()
function initAiSettings() { _updateAiStatusBadge(); }

// ══════════════════════════════════════════════════════════════════════════
//  SEÇÃO 2 — CAPTURA E CONVERSÃO DO ARQUIVO
// ══════════════════════════════════════════════════════════════════════════

// Chamado pelo botão "📷 Escanear Recibo" no modal de transação
function openReceiptScan() {
  document.getElementById('receiptScanInput')?.click();
}

async function onReceiptScanInput(inputEl) {
  const file = inputEl?.files?.[0];
  if (!file) return;
  inputEl.value = ''; // reset para permitir mesmo arquivo de novo

  // mostra no preview de anexo normalmente
  handleAttachSelect(file);

  // prepara base64 para IA em paralelo
  _showAiBtn('loading');
  try {
    await _prepareFileForAI(file);
    _showAiBtn('ready');
  } catch (e) {
    console.warn('[ReceiptAI] prepare error:', e.message);
    _showAiBtn('hidden');
  }
}

// Prepara o arquivo selecionado pelo picker de anexo existente (txAttachFile)
async function _onAttachFileSelectedForAI(file) {
  if (!file) { _showAiBtn('hidden'); return; }
  const validForAI = file.type === 'application/pdf' || file.type.startsWith('image/');
  if (!validForAI) { _showAiBtn('hidden'); return; }

  _showAiBtn('loading');
  try {
    await _prepareFileForAI(file);
    _showAiBtn('ready');
  } catch (e) {
    console.warn('[ReceiptAI] prepare from attach error:', e.message);
    _showAiBtn('hidden');
  }
}

async function _prepareFileForAI(file) {
  window._receiptAiPending = null;
  if (file.type === 'application/pdf') {
    const b64 = await _pdfPageToBase64(file);
    window._receiptAiPending = { base64: b64, mediaType: 'image/png', fileName: file.name };
  } else if (file.type.startsWith('image/')) {
    const b64 = await _fileToBase64(file);
    window._receiptAiPending = { base64: b64, mediaType: file.type, fileName: file.name };
  } else {
    throw new Error('Tipo de arquivo não suportado para IA');
  }
}

function _fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

async function _pdfPageToBase64(file) {
  // lazy-load pdf.js apenas quando necessário
  if (!window.pdfjsLib) {
    await new Promise((res, rej) => {
      const s  = document.createElement('script');
      s.src    = PDFJS_CDN_JS;
      s.onload = res;
      s.onerror = () => rej(new Error('Falha ao carregar pdf.js'));
      document.head.appendChild(s);
    });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_CDN_WK;
  }
  const buf     = await file.arrayBuffer();
  const pdf     = await window.pdfjsLib.getDocument({ data: buf }).promise;
  const page    = await pdf.getPage(1);
  const vp      = page.getViewport({ scale: 2.0 }); // alta resolução para OCR
  const canvas  = document.createElement('canvas');
  canvas.width  = vp.width;
  canvas.height = vp.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  return canvas.toDataURL('image/png').split(',')[1];
}

// ── Controle de visibilidade/estado do botão de IA ──────────────────────
function _showAiBtn(state) {
  // state: 'hidden' | 'loading' | 'ready'
  const btn = document.getElementById('receiptAiReadBtn');
  if (!btn) return;
  if (state === 'hidden') {
    btn.style.display = 'none';
  } else if (state === 'loading') {
    btn.style.display = 'flex';
    btn.disabled = true;
    btn.innerHTML = '<span class="ai-spin">⏳</span> Preparando...';
  } else {
    btn.style.display = 'flex';
    btn.disabled = false;
    btn.innerHTML = '🤖 Ler com IA';
  }
}

// Limpa estado quando o modal fecha
function resetReceiptAI() {
  window._receiptAiPending     = null;
  window._lastReceiptAiResult  = null;
  _showAiBtn('hidden');
  _renderAiResultPanel(null);
  const pricesBtn = document.getElementById('txRegisterPricesBtn');
  if (pricesBtn) pricesBtn.style.display = 'none';
}

// ══════════════════════════════════════════════════════════════════════════
//  SEÇÃO 3 — CHAMADA À API CLAUDE E PREENCHIMENTO DO FORMULÁRIO
// ══════════════════════════════════════════════════════════════════════════

async function readReceiptWithAI() {
  if (!window._receiptAiPending) {
    toast('Selecione uma imagem ou PDF primeiro', 'warning');
    return;
  }

  const apiKey = await getAppSetting(RECEIPT_AI_KEY_SETTING, '');
  if (!apiKey || !apiKey.startsWith('AIza')) {
    toast('Configure a chave Gemini em Configurações → IA', 'warning');
    showAiConfig();
    return;
  }

  const btn = document.getElementById('receiptAiReadBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="ai-spin">⏳</span> Analisando...'; }
  _renderAiResultPanel(null);

  try {
    const result = await _callClaudeVision(apiKey, window._receiptAiPending);
    _applyResultToForm(result);
    _renderAiResultPanel(result);
    window._lastReceiptAiResult = result; // used by Módulo de Preços
    toast('✅ Campos preenchidos! Revise e salve.', 'success');
    // Show "Registrar Preços" button if prices feature active for this family
    try {
      if (typeof isPricesEnabled === 'function' && await isPricesEnabled()) {
        const pricesBtn = document.getElementById('txRegisterPricesBtn');
        if (pricesBtn) pricesBtn.style.display = '';
      }
    } catch {}
  } catch (e) {
    toast('Erro na leitura com IA: ' + e.message, 'error');
    console.error('[ReceiptAI]', e);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '🤖 Ler com IA'; }
  }
}

async function _callClaudeVision(apiKey, pending) {
  // Contexto das listas reais do app para a IA escolher corretamente
  const catList = (state.categories || []).map(c => `${c.name}|${c.type}`).join(', ');
  const accList = (state.accounts   || []).map(a => `${a.name}|${a.currency}`).join(', ');
  const payList = (state.payees     || []).slice(0, 80).map(p => p.name).join(', ');
  const today   = new Date().toISOString().slice(0, 10);

  const prompt = `Você é especialista em leitura de recibos, notas fiscais e comprovantes financeiros brasileiros.
Analise a imagem e extraia as informações para preencher uma transação financeira.
Responda SOMENTE com JSON válido, sem markdown, sem texto antes ou depois.

CONTEXTO DO APP:
- Hoje: ${today}
- Categorias disponíveis (nome|tipo): ${catList || 'Alimentação|despesa, Transporte|despesa, Outros|despesa'}
- Contas disponíveis (nome|moeda): ${accList || 'Conta Corrente|BRL'}
- Beneficiários já cadastrados: ${payList || '(nenhum)'}

RETORNE EXATAMENTE ESTE JSON:
{
  "date": "YYYY-MM-DD",
  "amount": 0.00,
  "type": "expense",
  "description": "descrição curta e clara",
  "category": "nome exato da lista ou null",
  "account": "nome exato da lista ou null",
  "payee": "nome limpo do estabelecimento ou null",
  "memo": "itens comprados, número do pedido, CNPJ, endereço ou outros detalhes",
  "confidence": 0.9,
  "raw_total": "valor exato como aparece no documento (ex: R$ 45,90)"
}

REGRAS:
- amount: número positivo (ex: 45.90), sem símbolo de moeda
- type: "expense" para compras/pagamentos, "income" para depósitos/recebimentos
- date: se não encontrar, use ${today}
- category: escolha a MAIS PRÓXIMA da lista; null se muito incerto
- account: escolha a MAIS ADEQUADA da lista; null se incerto
- payee: apenas o nome do local (sem CNPJ, sem endereço)
- confidence: 0.0–1.0, sua confiança geral na extração
- Se não for documento financeiro: {"error": "não é um documento financeiro"}

Arquivo: ${pending.fileName}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${RECEIPT_AI_MODEL}:generateContent?key=${apiKey}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: pending.mediaType, data: pending.base64 } },
          { text: prompt },
        ],
      }],
      generationConfig: { maxOutputTokens: 800, temperature: 0.1 },
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    const msg = err?.error?.message || `HTTP ${resp.status}`;
    if (resp.status === 400 && msg.includes('API_KEY')) throw new Error('Chave API inválida. Verifique em Configurações.');
    if (resp.status === 429) throw new Error('Limite de requisições atingido. Aguarde alguns segundos.');
    throw new Error(msg);
  }

  const data  = await resp.json();
  const text  = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const clean = text.replace(/```json|```/g, '').trim();

  let parsed;
  try { parsed = JSON.parse(clean); }
  catch { throw new Error('Resposta inválida da IA: ' + text.slice(0, 100)); }

  if (parsed.error) throw new Error(parsed.error);
  return parsed;
}

// ── Aplica o JSON extraído aos campos do modal de transação ──────────────
function _applyResultToForm(r) {
  if (!r) return;

  // tipo (precisa ser primeiro — afeta visibilidade de outros campos)
  if (r.type === 'income') setTxType('income');
  else setTxType('expense');

  // data
  if (r.date) {
    const el = document.getElementById('txDate');
    if (el) el.value = r.date;
  }

  // valor — negativo para despesa, conforme padrão do app
  if (r.amount > 0) {
    setAmtField('txAmount', r.type === 'expense' ? -Math.abs(r.amount) : Math.abs(r.amount));
  }

  // descrição
  if (r.description) {
    const el = document.getElementById('txDesc');
    if (el) el.value = r.description;
  }

  // memo
  if (r.memo) {
    const el = document.getElementById('txMemo');
    if (el) el.value = r.memo;
  }

  // conta — match parcial tolerante
  if (r.account) {
    const needle = r.account.toLowerCase();
    const acct = (state.accounts || []).find(a =>
      a.name.toLowerCase().includes(needle) || needle.includes(a.name.toLowerCase())
    );
    if (acct) {
      const sel = document.getElementById('txAccountId');
      if (sel) { sel.value = acct.id; sel.dispatchEvent(new Event('change')); }
    }
  }

  // categoria — match parcial tolerante
  if (r.category) {
    const needle = r.category.toLowerCase();
    const cat = (state.categories || []).find(c =>
      c.name.toLowerCase().includes(needle) || needle.includes(c.name.toLowerCase())
    );
    if (cat) setCatPickerValue(cat.id);
  }

  // beneficiário — usa existente ou preenche texto para o usuário confirmar
  if (r.payee) {
    const needle = r.payee.toLowerCase();
    const existing = (state.payees || []).find(p =>
      p.name.toLowerCase().includes(needle) || needle.includes(p.name.toLowerCase())
    );
    if (existing) {
      setPayeeField(existing.id, 'tx');
    } else {
      // novo: preenche o campo de texto para o usuário criar o beneficiário
      const nameEl = document.getElementById('txPayeeName');
      if (nameEl) { nameEl.value = r.payee; nameEl.dispatchEvent(new Event('input')); }
    }
  }
}

// ── Painel de resumo dos dados extraídos ─────────────────────────────────
function _renderAiResultPanel(r) {
  const panel = document.getElementById('receiptAiResultPanel');
  if (!panel) return;
  if (!r) { panel.innerHTML = ''; panel.style.display = 'none'; return; }

  const pct   = Math.round((r.confidence || 0) * 100);
  const color = pct >= 80 ? 'var(--green,#22c55e)' : pct >= 50 ? 'var(--amber,#f59e0b)' : 'var(--red,#ef4444)';
  const row   = (lbl, val) => val
    ? `<div class="ai-res-row"><span class="ai-res-lbl">${lbl}</span><span class="ai-res-val">${esc(String(val))}</span></div>`
    : '';

  panel.style.display = '';
  panel.innerHTML = `
    <div class="ai-res-header">
      <span>✅ Campos extraídos pela IA</span>
      <span class="ai-res-conf" style="color:${color}">${pct}% confiança</span>
    </div>
    <div class="ai-res-body">
      ${row('Data',            r.date)}
      ${row('Valor',           r.raw_total || (r.amount ? 'R$ ' + r.amount : null))}
      ${row('Estabelecimento', r.payee)}
      ${row('Categoria',       r.category)}
      ${row('Conta',           r.account)}
    </div>
    <p class="ai-res-hint">⚠️ Revise todos os campos antes de salvar.</p>`;
}

// ══════════════════════════════════════════════════════════════════════════
//  SEÇÃO 4 — PATCH NO handleAttachSelect (integração com anexo existente)
//  Quando o usuário escolhe um arquivo no picker de anexo, aciona a IA
//  automaticamente sem alterar attachments.js
// ══════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    const orig = window.handleAttachSelect;
    if (typeof orig !== 'function') return;
    window.handleAttachSelect = function(file) {
      orig.call(this, file);
      if (file) _onAttachFileSelectedForAI(file);
    };
  }, 300);
});
