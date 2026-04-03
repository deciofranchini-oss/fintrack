/* ═══════════════════════════════════════════════════════════════
   ATTACHMENT UPLOAD — Supabase Storage
   Bucket: fintrack-attachments (must be PUBLIC)
   Path:   transactions/{txId}/{timestamp}.{ext}
═══════════════════════════════════════════════════════════════ */

// Pending file staged in memory until the transaction is saved
window._txPendingFile = null;
window._txPendingName = null;

// ── File chosen via click ─────────────────────────────────────────────────
function handleAttachSelect(file) {
  if (!file) return;
  const validTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (!validTypes.includes(file.type)) {
    toast('Formato inválido. Use PDF, JPG, PNG ou WebP', 'error');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    toast('Arquivo muito grande (máximo 10 MB)', 'error');
    return;
  }
  window._txPendingFile = file;
  window._txPendingName = file.name;
  _showAttachPreviewLocal(file);
}

// ── Drag-and-drop ─────────────────────────────────────────────────────────
function handleAttachDrop(e) {
  e.preventDefault();
  document.getElementById('txAttachArea').classList.remove('drag-active');
  const file = e.dataTransfer.files[0];
  if (file) handleAttachSelect(file);
}

// ── Show preview from a local File object (before upload) ─────────────────
function _showAttachPreviewLocal(file) {
  const isPdf = file.type === 'application/pdf';
  document.getElementById('txAttachIcon').textContent = isPdf ? '📄' : '🖼️';
  document.getElementById('txAttachName').textContent = file.name;
  document.getElementById('txAttachPreview').style.display = 'flex';
  document.getElementById('txAttachArea').style.display   = 'none';
  const oldThumb = document.getElementById('txAttachThumb');
  if (oldThumb) oldThumb.remove();
  if (!isPdf) {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = document.createElement('img');
      img.id = 'txAttachThumb';
      img.style.cssText = 'width:48px;height:48px;object-fit:cover;border-radius:4px;margin-left:8px;flex-shrink:0';
      img.src = ev.target.result;
      document.getElementById('txAttachPreview').appendChild(img);
    };
    reader.readAsDataURL(file);
  }
}

// ── Show preview from a saved URL (when editing an existing transaction) ───
function showAttachmentPreview(url, name) {
  if (!url) return;
  const isPdf = _isAttachPdf(url, name);
  document.getElementById('txAttachIcon').textContent = isPdf ? '📄' : '🖼️';
  document.getElementById('txAttachName').textContent = name || 'Anexo';
  document.getElementById('txAttachUrl').value        = url;
  document.getElementById('txAttachNameHidden').value = name || '';
  document.getElementById('txAttachPreview').style.display = 'flex';
  document.getElementById('txAttachArea').style.display   = 'none';
  const oldThumb = document.getElementById('txAttachThumb');
  if (oldThumb) oldThumb.remove();
  if (!isPdf) {
    const img = document.createElement('img');
    img.id = 'txAttachThumb';
    img.style.cssText = 'width:48px;height:48px;object-fit:cover;border-radius:4px;margin-left:8px;flex-shrink:0';
    img.src = url;
    document.getElementById('txAttachPreview').appendChild(img);
  }
}

// ── Remove attachment from form ────────────────────────────────────────────
function removeAttachment() {
  window._txPendingFile = null;
  window._txPendingName = null;
  document.getElementById('txAttachUrl').value        = '';
  document.getElementById('txAttachNameHidden').value = '';
  try { document.getElementById('txAttachFile').value = ''; } catch(e) {}
  document.getElementById('txAttachPreview').style.display = 'none';
  document.getElementById('txAttachArea').style.display   = '';
  const thumb = document.getElementById('txAttachThumb');
  if (thumb) thumb.remove();
}

// ── Upload to Supabase Storage, update the transaction row ─────────────────
// Returns the public URL on success, null on failure.
async function uploadTxAttachment(file, txId) {
  const BUCKET = 'fintrack-attachments';
  try {
    if (!sb)   throw new Error('Supabase não inicializado');
    if (!txId) throw new Error('ID da transação ausente');

    // Unique path prevents cache collisions when replacing a file
    const ext       = (file.name.split('.').pop() || 'bin').toLowerCase();
    const timestamp = Date.now();
    const path      = `transactions/${txId}/${timestamp}.${ext}`;

    // 1 — Upload
    const { error: upErr } = await sb.storage
      .from(BUCKET)
      .upload(path, file, { upsert: true, contentType: file.type });

    if (upErr) {
      const msg = (upErr.message || '').toLowerCase();
      if (msg.includes('bucket') || upErr.statusCode === 404 || msg.includes('not found')) {
        throw new Error(
          `Bucket "${BUCKET}" não encontrado. ` +
          `Crie-o em Supabase → Storage → New Bucket com nome "${BUCKET}" e visibilidade PÚBLICA.`
        );
      }
      if (upErr.statusCode === 400 || msg.includes('security') || msg.includes('policy') || msg.includes('denied')) {
        throw new Error(
          `Permissão negada no bucket "${BUCKET}". ` +
          `Execute o SQL em migration_attachments.sql para criar a policy de acesso.`
        );
      }
      throw upErr;
    }

    // 2 — Get public URL
    const { data: urlData } = sb.storage.from(BUCKET).getPublicUrl(path);
    const publicUrl = urlData?.publicUrl;
    if (!publicUrl) throw new Error('Não foi possível obter a URL pública do arquivo');

    // 3 — Persist URL + name to the transaction row
    const { error: dbErr } = await sb.from('transactions')
      .update({ attachment_url: publicUrl, attachment_name: file.name })
      .eq('id', txId);
    if (dbErr) throw dbErr;

    // 4 — Sync hidden form fields (modal may still be open in edit flow)
    const urlEl  = document.getElementById('txAttachUrl');
    const nameEl = document.getElementById('txAttachNameHidden');
    if (urlEl)  urlEl.value  = publicUrl;
    if (nameEl) nameEl.value = file.name;

    return publicUrl;

  } catch (err) {
    console.error('[uploadTxAttachment]', err);
    toast('❌ Anexo não salvo: ' + (err.message || String(err)), 'error');
    return null;
  }
}

// ── Delete attachment from storage + clear the transaction row ─────────────
async function deleteTxAttachment(txId, currentUrl) {
  const BUCKET = 'fintrack-attachments';
  try {
    if (currentUrl) {
      // Supabase public URLs look like: .../storage/v1/object/public/BUCKET/path/file.ext
      // We need just the path after the bucket name
      const marker = `/${BUCKET}/`;
      const idx = currentUrl.indexOf(marker);
      if (idx !== -1) {
        const storagePath = decodeURIComponent(
          currentUrl.slice(idx + marker.length).split('?')[0]
        );
        const { error: delErr } = await sb.storage.from(BUCKET).remove([storagePath]);
        if (delErr) console.warn('[deleteTxAttachment] storage remove warning:', delErr.message);
      }
    }
    await sb.from('transactions')
      .update({ attachment_url: null, attachment_name: null })
      .eq('id', txId);
    toast('Anexo removido', 'success');
  } catch (err) {
    console.error('[deleteTxAttachment]', err);
    toast('Erro ao remover anexo: ' + err.message, 'error');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────
function _isAttachPdf(url, name) {
  if (name && name.toLowerCase().endsWith('.pdf')) return true;
  if (url  && /\.pdf(\?|$|&)/i.test(url))          return true;
  return false;
}

function _isAttachImage(url, name) {
  const ext = ((name || '').split('.').pop() || '').toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return true;
  if (url && /\.(jpg|jpeg|png|gif|webp)(\?|$|&)/i.test(url)) return true;
  return false;
}
