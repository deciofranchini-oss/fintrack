async function openUserAdmin() {
  if (currentUser?.role !== 'admin') { toast('Acesso restrito a administradores','error'); return; }
  await loadFamiliesList();
  await loadUsersList();
  openModal('userAdminModal');
}

function switchUATab(tab) {
  document.getElementById('uaUsers').style.display    = tab === 'users'    ? '' : 'none';
  document.getElementById('uaFamilies').style.display = tab === 'families' ? '' : 'none';
  document.getElementById('uaTabUsers').classList.toggle('active',    tab === 'users');
  document.getElementById('uaTabFamilies').classList.toggle('active', tab === 'families');
}

// ── FAMILIES ──────────────────────────────────────────────────────

async function loadFamiliesList() {
  let families = [];
  try {
    const { data, error } = await sb.from('families').select('*').order('name');
    if (error) throw error;
    families = data || [];
  } catch(e) {
    // families table may not exist yet — show migration hint
    const el = document.getElementById('familiesList');
    if (el) el.innerHTML = `<div style="background:var(--amber-lt);border:1px solid var(--amber);border-radius:8px;padding:14px;font-size:.82rem">
      ⚠️ <strong>Tabela "families" não encontrada.</strong><br>
      Execute o script <code>migration_families.sql</code> no Supabase SQL Editor para habilitar o suporte a múltiplas famílias.
    </div>`;
    return;
  }
  _families = families;

  // Populate family select in user form
  const sel = document.getElementById('uFamilyId');
  if (sel) {
    const cur = sel.value;
    sel.innerHTML = '<option value="">— Nenhuma (admin global) —</option>' +
      _families.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('');
    if (cur) sel.value = cur;
  }

  const el = document.getElementById('familiesList');
  if (!el) return;

  if (!_families.length) {
    el.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted)">Nenhuma família cadastrada. Clique em "+ Nova Família" para começar.</div>';
    return;
  }

  // For each family show its members
  const { data: allUsers } = await sb.from('app_users').select('id,name,email,role,active,family_id').order('name');
  const usersByFamily = {};
  (allUsers || []).forEach(u => {
    const fid = u.family_id || '__none__';
    if (!usersByFamily[fid]) usersByFamily[fid] = [];
    usersByFamily[fid].push(u);
  });

  el.innerHTML = _families.map(f => {
    const members = usersByFamily[f.id] || [];
    const membersHtml = members.length
      ? members.map(u => `
          <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:.82rem;flex:1"><strong>${esc(u.name||'—')}</strong> <span style="color:var(--muted);font-size:.75rem">${esc(u.email)}</span></span>
            <span class="badge ${u.role==='admin'?'badge-amber':'badge-muted'}" style="font-size:.7rem">${u.role}</span>
            <button class="btn-icon" title="Remover da família" onclick="removeUserFromFamily('${u.id}','${esc(u.name||u.email)}','${esc(f.name)}')">✕</button>
          </div>`).join('')
      : '<div style="font-size:.78rem;color:var(--muted);padding:8px 0">Nenhum membro</div>';

    // Users not yet in this family (for adding)
    const available = (allUsers||[]).filter(u => !u.family_id || u.family_id !== f.id);

    return `<div class="card" style="margin-bottom:12px">
      <div class="card-header">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:1.3rem">🏠</span>
          <div>
            <div style="font-weight:700">${esc(f.name)}</div>
            ${f.description ? `<div style="font-size:.75rem;color:var(--muted)">${esc(f.description)}</div>` : ''}
          </div>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" onclick="editFamily('${f.id}')" style="padding:3px 10px;font-size:.73rem">✏️ Editar</button>
          <button class="btn btn-ghost btn-sm" onclick="deleteFamily('${f.id}','${esc(f.name)}')" style="padding:3px 10px;font-size:.73rem;color:var(--red)">🗑️</button>
        </div>
      </div>
      <div style="padding:4px 0">
        <div style="font-size:.78rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">
          Membros (${members.length})
        </div>
        ${membersHtml}
        ${available.length ? `
        <div style="display:flex;gap:8px;align-items:center;margin-top:10px">
          <select id="addMemberSel-${f.id}" style="font-size:.8rem;flex:1">
            <option value="">— Selecionar usuário —</option>
            ${available.map(u => `<option value="${u.id}">${esc(u.name||u.email)}</option>`).join('')}
          </select>
          <button class="btn btn-primary btn-sm" onclick="addUserToFamily('${f.id}')" style="font-size:.78rem;white-space:nowrap">+ Adicionar</button>
        </div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function showFamilyForm(id='') {
  document.getElementById('editFamilyId').value = id;
  document.getElementById('fName').value = '';
  document.getElementById('fDesc').value = '';
  document.getElementById('familyFormTitle').textContent = id ? 'Editar Família' : 'Nova Família';
  document.getElementById('familyFormArea').style.display = '';
  if (id) {
    const f = _families.find(x => x.id === id);
    if (f) { document.getElementById('fName').value = f.name; document.getElementById('fDesc').value = f.description||''; }
  }
}

function editFamily(id) { showFamilyForm(id); document.getElementById('familyFormArea').scrollIntoView({behavior:'smooth'}); }

async function saveFamily() {
  const id   = document.getElementById('editFamilyId').value;
  const name = document.getElementById('fName').value.trim();
  const desc = document.getElementById('fDesc').value.trim();
  if (!name) { toast('Informe o nome da família','error'); return; }
  const data = { name, description: desc||null, updated_at: new Date().toISOString() };
  let error;
  if (id) { ({ error } = await sb.from('families').update(data).eq('id', id)); }
  else    { ({ error } = await sb.from('families').insert(data)); }
  if (error) { toast('Erro: '+error.message,'error'); return; }
  toast(id ? '✓ Família atualizada!' : '✓ Família criada!','success');
  document.getElementById('familyFormArea').style.display = 'none';
  await loadFamiliesList();
}

async function deleteFamily(id, name) {
  if (!confirm(`Excluir a família "${name}"?\n\nOs usuários vinculados ficarão sem família, mas seus dados não serão apagados.`)) return;
  const { error } = await sb.from('families').delete().eq('id', id);
  if (error) { toast('Erro: '+error.message,'error'); return; }
  toast('Família removida','success');
  await loadFamiliesList();
}

async function addUserToFamily(familyId) {
  const sel = document.getElementById(`addMemberSel-${familyId}`);
  const userId = sel?.value;
  if (!userId) { toast('Selecione um usuário','error'); return; }
  const { error } = await sb.from('app_users').update({ family_id: familyId }).eq('id', userId);
  if (error) { toast('Erro: '+error.message,'error'); return; }
  toast('✓ Usuário adicionado à família','success');
  await loadFamiliesList();
}

async function removeUserFromFamily(userId, userName, familyName) {
  if (!confirm(`Remover "${userName}" da família "${familyName}"?`)) return;
  const { error } = await sb.from('app_users').update({ family_id: null }).eq('id', userId);
  if (error) { toast('Erro: '+error.message,'error'); return; }
  toast('Usuário removido da família','success');
  await loadFamiliesList();
}

// ── USERS ─────────────────────────────────────────────────────────

async function loadUsersList() {
  const { data: users, error } = await sb.from('app_users').select('*').order('created_at');
  if (error) { toast('Erro: '+error.message,'error'); return; }
  const el = document.getElementById('usersList');
  const countEl = document.getElementById('userAdminCount');
  if (countEl) countEl.textContent = `${users?.length||0} usuários cadastrados`;
  if (!users?.length) { el.innerHTML='<div style="text-align:center;padding:20px;color:var(--muted)">Nenhum usuário.</div>'; return; }
  const pendingUsers = users.filter(u => !u.approved);
  const activeUsers  = users.filter(u => u.approved);

  // Build family name lookup
  const famById = {};
  _families.forEach(f => famById[f.id] = f.name);

  let html = '';

  if (pendingUsers.length) {
    html += `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:.82rem;color:#92400e">
      ⏳ <strong>${pendingUsers.length} solicitação(ões) aguardando aprovação</strong>
    </div>`;
    html += '<div class="table-wrap" style="margin-bottom:16px"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Solicitado</th><th>Ações</th></tr></thead><tbody>';
    html += pendingUsers.map(u => `<tr style="background:#fffbeb">
      <td><strong>${esc(u.name||'—')}</strong></td>
      <td style="font-size:.82rem">${esc(u.email)}</td>
      <td style="font-size:.75rem;color:var(--muted)">${new Date(u.created_at).toLocaleDateString('pt-BR')}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-primary btn-sm" onclick="approveUser('${u.id}','${esc(u.name||u.email)}')" style="padding:3px 10px;font-size:.73rem;background:#16a34a">✅ Aprovar</button>
        <button class="btn btn-ghost btn-sm" onclick="rejectUser('${u.id}','${esc(u.name||u.email)}')" style="padding:3px 10px;font-size:.73rem;color:#dc2626">🗑 Rejeitar</button>
      </td>
    </tr>`).join('');
    html += '</tbody></table></div>';
    html += '<div style="font-weight:600;font-size:.82rem;margin-bottom:8px;color:var(--muted)">Usuários ativos</div>';
  }

  if (!activeUsers.length) {
    html += '<div style="text-align:center;padding:20px;color:var(--muted)">Nenhum usuário ativo.</div>';
  } else {
    html += '<div class="table-wrap"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Família</th><th>Status</th><th>Ações</th></tr></thead><tbody>';
    html += activeUsers.map(u => `<tr>
      <td><strong>${esc(u.name||'—')}</strong></td>
      <td style="font-size:.82rem">${esc(u.email)}</td>
      <td><span class="badge badge-green" style="font-size:.7rem">${u.role==='admin'?'Admin':u.role==='viewer'?'Viewer':'Usuário'}</span></td>
      <td style="font-size:.78rem;color:var(--text2)">${u.family_id ? (famById[u.family_id]||'—') : '<span style="color:var(--muted)">—</span>'}</td>
      <td><span style="font-size:.75rem;color:${u.active?'var(--green)':'var(--red)'}">● ${u.active?'Ativo':'Inativo'}</span></td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost btn-sm" onclick="editUser('${u.id}')" style="padding:3px 8px;font-size:.73rem">✏️</button>
        ${u.id !== currentUser?.id ? `<button class="btn btn-ghost btn-sm" onclick="toggleUserActive('${u.id}',${u.active})" style="padding:3px 8px;font-size:.73rem">${u.active?'🚫':'✅'}</button>` : ''}
        ${u.id !== currentUser?.id ? `<button class="btn btn-ghost btn-sm" onclick="resetUserPwd('${u.id}','${esc(u.name||u.email)}')" style="padding:3px 8px;font-size:.73rem">🔑</button>` : ''}
      </td>
    </tr>`).join('');
    html += '</tbody></table></div>';
  }
  el.innerHTML = html;
}

function showNewUserForm() {
  document.getElementById('userFormTitle').textContent = 'Novo Usuário';
  document.getElementById('editUserId').value = '';
  document.getElementById('uName').value = '';
  document.getElementById('uEmail').value = '';
  document.getElementById('uPassword').value = '';
  document.getElementById('uRole').value = 'user';
  document.getElementById('uFamilyId').value = '';
  document.getElementById('pView').checked = true;
  document.getElementById('pCreate').checked = true;
  document.getElementById('pEdit').checked = true;
  document.getElementById('pDelete').checked = false;
  document.getElementById('pExport').checked = true;
  document.getElementById('pImport').checked = false;
  document.getElementById('pwdHint').textContent = '(mín. 8 chars)';
  document.getElementById('userFormArea').style.display = '';
}

async function editUser(userId) {
  const { data: u } = await sb.from('app_users').select('*').eq('id', userId).single();
  if (!u) return;
  document.getElementById('userFormTitle').textContent = 'Editar Usuário';
  document.getElementById('editUserId').value = u.id;
  document.getElementById('uName').value = u.name||'';
  document.getElementById('uEmail').value = u.email;
  document.getElementById('uPassword').value = '';
  document.getElementById('uRole').value = u.role;
  document.getElementById('uFamilyId').value = u.family_id||'';
  document.getElementById('pView').checked = u.can_view;
  document.getElementById('pCreate').checked = u.can_create;
  document.getElementById('pEdit').checked = u.can_edit;
  document.getElementById('pDelete').checked = u.can_delete;
  document.getElementById('pExport').checked = u.can_export;
  document.getElementById('pImport').checked = u.can_import;
  document.getElementById('pwdHint').textContent = '(deixe em branco para manter)';
  document.getElementById('userFormArea').style.display = '';
}

async function saveUser() {
  const userId    = document.getElementById('editUserId').value;
  const name      = document.getElementById('uName').value.trim();
  const email     = document.getElementById('uEmail').value.trim().toLowerCase();
  const pwd       = document.getElementById('uPassword').value;
  const role      = document.getElementById('uRole').value;
  const newFamId  = document.getElementById('uFamilyId').value || null;
  if (!name || !email) { toast('Preencha nome e e-mail','error'); return; }
  if (!userId && pwd.length < 8) { toast('Senha deve ter pelo menos 8 caracteres','error'); return; }
  if (userId && pwd && pwd.length < 8) { toast('Senha deve ter pelo menos 8 caracteres','error'); return; }

  const record = {
    name, email, role,
    family_id:  newFamId,
    can_view:   document.getElementById('pView').checked,
    can_create: document.getElementById('pCreate').checked,
    can_edit:   document.getElementById('pEdit').checked,
    can_delete: document.getElementById('pDelete').checked,
    can_export: document.getElementById('pExport').checked,
    can_import: document.getElementById('pImport').checked,
    can_admin:  role === 'admin',
  };
  if (pwd) record.password_hash = await sha256(pwd);
  if (!userId) { record.must_change_pwd = false; record.active = true; record.approved = true; record.created_by = currentUser?.id; }

  try {
    let error;
    if (userId) { ({ error } = await sb.from('app_users').update(record).eq('id', userId)); }
    else        { ({ error } = await sb.from('app_users').insert(record)); }
    if (error) throw error;
    toast(userId ? '✓ Usuário atualizado!' : '✓ Usuário criado!', 'success');
    document.getElementById('userFormArea').style.display = 'none';
    await loadUsersList();
    await loadFamiliesList();
  } catch(e) { toast('Erro: '+e.message,'error'); }
}

async function approveUser(userId, userName) {
  if (!confirm(`Aprovar acesso de ${userName}?`)) return;
  const { error } = await sb.from('app_users').update({
    active: true, approved: true
  }).eq('id', userId);
  if (error) { toast('Erro: '+error.message,'error'); return; }
  toast(`✓ ${userName} aprovado! Já pode fazer login.`,'success');
  await loadUsersList();
}

async function rejectUser(userId, userName) {
  if (!confirm(`Rejeitar e excluir solicitação de ${userName}?`)) return;
  const { error } = await sb.from('app_users').delete().eq('id', userId);
  if (error) { toast('Erro: '+error.message,'error'); return; }
  toast(`Solicitação de ${userName} removida.`,'success');
  await loadUsersList();
}

async function toggleUserActive(userId, currentActive) {
  const { error } = await sb.from('app_users').update({ active: !currentActive }).eq('id', userId);
  if (error) { toast('Erro: '+error.message,'error'); return; }
  toast(currentActive ? 'Usuário desativado' : 'Usuário ativado', 'success');
  await loadUsersList();
}

async function resetUserPwd(userId, userName) {
  const newPwd = prompt(`Nova senha para ${userName} (mín. 8 chars):`);
  if (!newPwd || newPwd.length < 8) { if(newPwd!==null) toast('Senha muito curta','error'); return; }
  const hash = await sha256(newPwd);
  const { error } = await sb.from('app_users').update({ password_hash: hash, must_change_pwd: true }).eq('id', userId);
  if (error) { toast('Erro: '+error.message,'error'); return; }
  toast(`✓ Senha de ${userName} redefinida. Usuário deve trocar no próximo login.`,'success');
  await loadUsersList();
}

/* ══════════════════════════════════════════════════════════════════
   INIT: Master admin password setup on first run
   The SQL inserts a placeholder hash. On first actual login,
   the correct hash is set when the user changes their password.
   We need to set the REAL hash for '35zjxx2v' on first run.
══════════════════════════════════════════════════════════════════ */
async function ensureMasterAdmin() {
  // Check if master admin has the placeholder hash — if so, set real hash
  const INITIAL_PWD = '35zjxx2v';
  const MASTER_EMAIL = 'deciofranchini@gmail.com';
  try {
    const { data: users } = await sb.from('app_users').select('id,password_hash,must_change_pwd').eq('email', MASTER_EMAIL).limit(1);
    if (!users?.length) {
      // Insert master admin
      const hash = await sha256(INITIAL_PWD);
      await sb.from('app_users').insert({
        email: MASTER_EMAIL, password_hash: hash, name: 'Décio Franchini',
        role: 'admin', must_change_pwd: true, active: true,
        can_view:true, can_create:true, can_edit:true, can_delete:true,
        can_export:true, can_import:true, can_admin:true
      });
      console.log('Master admin created');
    } else if (users[0].password_hash.length < 20) {
      // Placeholder hash — set real one
      const hash = await sha256(INITIAL_PWD);
      await sb.from('app_users').update({ password_hash: hash, must_change_pwd: true }).eq('email', MASTER_EMAIL);
    }
  } catch(e) { console.warn('ensureMasterAdmin:', e.message); }
}

tryAutoConnect();

/* ══════════════════════════════════════════════════════════════════
   AUTO-REGISTER ENGINE — Transações Programadas Automáticas
══════════════════════════════════════════════════════════════════ */

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

