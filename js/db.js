/**
 * db.js — Fintrack Data Access Layer
 * ════════════════════════════════════════════════════════════════════
 * Centralises all Supabase queries with:
 *  - TTL-based in-memory cache for stable data (accounts, categories, payees)
 *  - In-flight deduplication (no parallel identical fetches)
 *  - Batched inserts for prices
 *  - Single-query cashflow aggregation (replaces 6 sequential queries)
 *  - Automatic Cursor integration for every async operation
 *
 * Consumed by: accounts.js, categories.js, payees.js,
 *              transactions.js, dashboard.js, prices.js, app.js
 *
 * Every public method is backward-compatible with existing callers.
 */

/* ── TTL table ─────────────────────────────────────────────────── */
const _TTL = {
  accounts:   2 * 60 * 1000,   // 2 min
  categories: 5 * 60 * 1000,   // 5 min — rarely change
  payees:     2 * 60 * 1000,
};
const _stamps  = {};  // key → last fetch timestamp (ms)
const _inflight = {}; // key → Promise  (deduplication)

function _fresh(key) { return !!(_stamps[key] && Date.now() - _stamps[key] < _TTL[key]); }
function _touch(key) { _stamps[key] = Date.now(); }
function _bust(key)  { _stamps[key] = 0; }

function _once(key, fn) {
  if (_inflight[key]) return _inflight[key];
  _inflight[key] = fn().finally(() => { delete _inflight[key]; });
  return _inflight[key];
}

/* ── Cursor integration ─────────────────────────────────────────── */
function _show(label, mode) { if (window.Cursor) Cursor.show(label, mode); }
function _hide()            { if (window.Cursor) Cursor.hide(); }

async function _wrap(label, fn, mode = 'load') {
  _show(label, mode);
  try   { return await fn(); }
  finally { _hide(); }
}

/* ════════════════════════════════════════════════════════════════════
   ACCOUNTS
════════════════════════════════════════════════════════════════════ */
const _accounts = {

  async load(force = false) {
    if (!force && _fresh('accounts') && state.accounts.length) return;
    return _once('accounts', () => _wrap('Carregando contas…', async () => {
      const cols = 'id,name,type,currency,color,icon,initial_balance,group_id,family_id,' +
                   'active,is_favorite,best_purchase_day,due_day,iof_rate,is_brazilian';
      const [ar, gr] = await Promise.all([
        famQ(sb.from('accounts').select(cols).eq('active', true)).order('name'),
        famQ(sb.from('account_groups').select('id,name,emoji,color,currency')).order('name'),
      ]);
      if (ar.error) throw ar.error;
      if (gr.error) console.warn('[DB] account_groups:', gr.error.message);
      state.accounts      = ar.data || [];
      state.groups        = gr.data || [];
      state.accountGroups = state.groups;
      _touch('accounts');
      await _accounts.recalcBalances();
    }));
  },

  bust() { _bust('accounts'); },

  /**
   * Compute running balance per account.
   * Modern transfers have two linked legs (both with account_id set) — summing
   * account_id naturally gives the correct result for each account.
   * Legacy single-leg transfers only have the debit row; the destination must
   * be credited separately (only when linked_transfer_id IS NULL).
   */
  async recalcBalances() {
    if (!state.accounts.length) return;
    const txMap = {};
    try {
      // Step 1: sum every transaction by its owning account
      const { data: s1, error: e1 } = await famQ(
        sb.from('transactions').select('account_id,amount')
      );
      if (e1) throw e1;
      (s1 || []).forEach(t => {
        if (t.account_id) txMap[t.account_id] = (txMap[t.account_id] || 0) + (parseFloat(t.amount) || 0);
      });
      // Step 2: legacy single-leg transfers — credit destination only when no paired leg exists
      const { data: s2 } = await famQ(
        sb.from('transactions')
          .select('transfer_to_account_id,amount')
          .eq('is_transfer', true)
          .is('linked_transfer_id', null)
          .not('transfer_to_account_id', 'is', null)
      );
      (s2 || []).forEach(t => {
        const dest = t.transfer_to_account_id;
        if (dest) txMap[dest] = (txMap[dest] || 0) + Math.abs(parseFloat(t.amount) || 0);
      });
    } catch (e) {
      console.warn('[DB.accounts.recalcBalances] fallback:', e.message);
    }
    state.accounts.forEach(a => {
      a.balance = (parseFloat(a.initial_balance) || 0) + (txMap[a.id] || 0);
    });
    // Augment investment account balances with market value of positions
    if (typeof invPostBalanceHook === 'function') invPostBalanceHook();
  },
};

/* ════════════════════════════════════════════════════════════════════
   CATEGORIES
════════════════════════════════════════════════════════════════════ */
const _categories = {
  async load(force = false) {
    if (!force && _fresh('categories') && state.categories.length) return;
    return _once('categories', () => _wrap('Carregando categorias…', async () => {
      const { data, error } = await famQ(
        sb.from('categories').select('id,name,type,icon,color,parent_id,family_id')
      ).order('name');
      if (error) throw error;
      state.categories = data || [];
      _touch('categories');
    }));
  },
  bust() { _bust('categories'); },
};

/* ════════════════════════════════════════════════════════════════════
   PAYEES
════════════════════════════════════════════════════════════════════ */
const _payees = {
  async load(force = false) {
    if (!force && _fresh('payees') && state.payees.length) return;
    return _once('payees', () => _wrap('Carregando beneficiários…', async () => {
      const { data, error } = await famQ(
        sb.from('payees').select(
          'id,name,type,notes,default_category_id,address,city,state_uf,' +
          'zip_code,phone,whatsapp,website,cnpj_cpf,family_id,categories(name)'
        )
      ).order('name');
      if (error) throw error;
      state.payees = data || [];
      _touch('payees');
    }));
  },
  bust() { _bust('payees'); },
};

/* ════════════════════════════════════════════════════════════════════
   TRANSACTIONS
════════════════════════════════════════════════════════════════════ */
const _transactions = {
  async load(opts = {}) {
    const {
      filter    = {},
      page      = 0,
      pageSize  = 50,
      sortField = 'date',
      sortAsc   = false,
      view      = 'flat',
    } = opts;

    return _wrap('Carregando transações…', async () => {
      let q = famQ(
        sb.from('transactions').select(
          '*, accounts!transactions_account_id_fkey(name,currency,color,icon),' +
          'payees(name), categories(name,color,icon)',
          { count: 'exact' }
        )
      ).order('status', { ascending: false }).order(sortField, { ascending: sortAsc }).order('created_at', { ascending: sortAsc }).order('id', { ascending: sortAsc });

      if (view !== 'group') q = q.range(page * pageSize, (page + 1) * pageSize - 1);

      if (filter.month) {
        if (filter.month.startsWith('year:')) {
          const y = filter.month.split(':')[1];
          q = q.gte('date', `${y}-01-01`).lte('date', `${y}-12-31`);
        } else {
          const [y, m] = filter.month.split('-');
          const last = new Date(+y, +m, 0).getDate();
          q = q.gte('date', `${y}-${m}-01`).lte('date', `${y}-${m}-${String(last).padStart(2,'0')}`);
        }
      }
      if (filter.account) {
        q = q.or(
          `account_id.eq.${filter.account},and(is_transfer.eq.true,linked_transfer_id.is.null,transfer_to_account_id.eq.${filter.account})`
        );
      }
      if (filter.search)                 q = q.ilike('description', `%${filter.search}%`);
      if (filter.type === 'income')      q = q.gt('amount', 0).eq('is_transfer', false);
      else if (filter.type === 'expense')q = q.lt('amount', 0).eq('is_transfer', false);
      else if (filter.type === 'transfer')     q = q.eq('is_transfer', true).eq('is_card_payment', false);
      else if (filter.type === 'card_payment') q = q.eq('is_card_payment', true);
      if (filter.status === 'pending')         q = q.eq('status', 'pending');
      else if (filter.status === 'confirmed')  q = q.eq('status', 'confirmed');
      // Reconciliation filter
      if (filter.reconciled === 'done')        q = q.eq('is_reconciled', true);
      else if (filter.reconciled === 'pending') q = q.or('is_reconciled.is.null,is_reconciled.eq.false');
      // Category filter: includes selected category and all its children
      if (filter.categoryId) {
        const catIds = _resolveCategoryIds(filter.categoryId);
        if (catIds.length === 1) q = q.eq('category_id', catIds[0]);
        else                     q = q.in('category_id', catIds);
      }
      // Member filter: array of selected member IDs
      if (filter.memberIds && filter.memberIds.length > 0) {
        // Match transactions where any of the selected members appears
        // in either family_member_id (single) or family_member_ids (array)
        const orClauses = filter.memberIds.map(id =>
          `family_member_id.eq.${id},family_member_ids.cs.{${id}}`
        ).join(',');
        q = q.or(orClauses);
      }

      const { data, count, error } = await q;
      if (error) throw error;
      return { data: data || [], count: count || 0 };
    });
  },
};

/* ════════════════════════════════════════════════════════════════════
   DASHBOARD
════════════════════════════════════════════════════════════════════ */
const _dashboard = {

  /**
   * Load KPI numbers (income / expense / total / pendingCount)
   * with ONE month-transaction query + accounts from cache.
   */
  async loadKPIs(memberIds = null) {
    return _wrap('Carregando dashboard…', async () => {
      // Guard: sem family_id e sem role global → retorna zeros, não faz query
      const fid = typeof currentUser !== 'undefined' ? currentUser?.family_id : null;
      const isGlobal = typeof currentUser !== 'undefined' &&
        (currentUser?.role === 'admin' || currentUser?.role === 'owner');
      if (!fid && !isGlobal) {
        return { income: 0, expense: 0, total: 0, pendingCount: 0 };
      }

      // Accounts already in state from bootApp preload; refresh if stale
      await _accounts.load();

      const now = new Date();
      const y   = now.getFullYear();
      const m   = String(now.getMonth() + 1).padStart(2, '0');
      const last = new Date(y, now.getMonth() + 1, 0).getDate();

      // Build month query with optional member filter
      let monthQ = famQ(sb.from('transactions')
        .select('amount,brl_amount,currency,is_transfer')
      ).gte('date', `${y}-${m}-01`).lte('date', `${y}-${m}-${String(last).padStart(2,'0')}`)
        .eq('status', 'confirmed');
      if (memberIds && memberIds.length > 0) monthQ = monthQ.in('family_member_id', memberIds);

      const [monthRes, pendRes] = await Promise.all([
        monthQ,
        famQ(sb.from('transactions').select('id', { count: 'exact', head: true }))
          .eq('status', 'pending'),
      ]);

      let income = 0, expense = 0;
      (monthRes.data || []).filter(t => !t.is_transfer).forEach(t => {
        const brl = t.brl_amount != null ? t.brl_amount : toBRL(t.amount, t.currency || 'BRL');
        if (brl > 0) income += brl; else expense += Math.abs(brl);
      });

      // Patrimônio Total:
      //   + saldo de cada conta (cartão de crédito já entra negativo)
      //   + para contas de investimento: usa _totalPortfolioBalance (inclui market value das posições)
      //   - dívidas ativas (current_balance convertido em BRL)
      const accountTotal = state.accounts.reduce((s, a) => {
        const bal = (a.type === 'investimento' && a._totalPortfolioBalance != null)
          ? a._totalPortfolioBalance
          : (parseFloat(a.balance) || 0);
        return s + toBRL(bal, a.currency || 'BRL');
      }, 0);

      // Subtrair dívidas ativas (se módulo habilitado)
      let debtTotal = 0;
      try {
        const { data: debtsData } = await Promise.resolve(
          famQ(sb.from('debts').select('current_balance,original_amount,currency').eq('status', 'active'))
        ).catch(() => ({ data: [] }));
        if (debtsData?.length) {
          debtTotal = debtsData.reduce((s, d) =>
            s + toBRL(parseFloat(d.current_balance ?? d.original_amount) || 0, d.currency || 'BRL'), 0);
        }
      } catch (_) { /* tabela não existe — módulo desabilitado */ }

      const total = accountTotal - debtTotal;

      return { income, expense, total, pendingCount: pendRes.count || 0 };
    });
  },

  /**
   * ONE query for 6 months of cashflow data (replaces 6 serial queries).
   * Client-side aggregation in a single O(n) pass.
   */
  async loadCashflow(accountId = '', memberIds = null) {
    return _wrap('Carregando fluxo de caixa…', async () => {
      const months = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
        months.push({ y: d.getFullYear(), m: String(d.getMonth() + 1).padStart(2, '0') });
      }
      const first = months[0], last = months[months.length - 1];
      const lastDay = new Date(+last.y, +last.m, 0).getDate();

      let q = famQ(sb.from('transactions')
        .select('date,amount,brl_amount,currency,is_transfer')
      ).gte('date', `${first.y}-${first.m}-01`)
       .lte('date', `${last.y}-${last.m}-${String(lastDay).padStart(2,'0')}`)
       .eq('status', 'confirmed');
      if (accountId) q = q.eq('account_id', accountId);
      if (memberIds && memberIds.length > 0) q = q.in('family_member_id', memberIds);

      const { data } = await q;
      const agg = {}; // "YYYY-MM" → { inc, exp }
      (data || []).filter(t => !t.is_transfer).forEach(t => {
        const k = t.date.slice(0, 7);
        if (!agg[k]) agg[k] = { inc: 0, exp: 0 };
        const brl = t.brl_amount != null ? t.brl_amount : toBRL(t.amount, t.currency || 'BRL');
        if (brl > 0) agg[k].inc += brl; else agg[k].exp += Math.abs(brl);
      });

      const NAMES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
      return months.map(({ y, m }) => {
        const k = `${y}-${m}`, s = agg[k] || { inc: 0, exp: 0 };
        return {
          label:   `${NAMES[+m - 1]}/${String(y).slice(2)}`,
          income:  +s.inc.toFixed(2),
          expense: +s.exp.toFixed(2),
          balance: +(s.inc - s.exp).toFixed(2),
        };
      });
    });
  },
};

/* ════════════════════════════════════════════════════════════════════
   PRICES — batched save
════════════════════════════════════════════════════════════════════ */
const _prices = {
  /**
   * Save all receipt items with minimal round-trips:
   *  1. batch-insert new price_items  (1 query)
   *  2. batch-update existing items   (parallel, 1 query each)
   *  3. batch-insert price_history    (1 query)
   * Replaces the original N*3 sequential queries.
   *
   * @param {string} fid
   * @param {string} storeId
   * @param {string} date        ISO date
   * @param {Array}  items       [{desc, qty, price, catId, itemId}]
   */
  async saveReceipt(fid, storeId, date, items) {
    return _wrap('Salvando preços…', async () => {
      const valid = items.filter(i => i.desc && i.price > 0);
      if (!valid.length) return { saved: 0 };

      const toCreate = valid.filter(i => !i.itemId);
      const toUpdate = valid.filter(i => i.itemId && i.catId);

      // 1. Batch-insert new price_items
      let created = [];
      if (toCreate.length) {
        const { data, error } = await sb.from('price_items')
          .insert(toCreate.map(i => ({ family_id: fid, name: i.desc, category_id: i.catId || null })))
          .select('id');
        if (error) throw new Error('price_items insert: ' + error.message);
        created = data || [];
      }

      // 2. Assign IDs back
      let ci = 0;
      const historyRows = [];
      valid.forEach(i => {
        const itemId = i.itemId || created[ci++]?.id;
        if (!itemId) return;
        historyRows.push({ family_id: fid, item_id: itemId, store_id: storeId,
                           unit_price: i.price, quantity: i.qty, purchased_at: date });
      });

      // 3. Batch-update categories (parallel, one per distinct item)
      if (toUpdate.length) {
        await Promise.all(toUpdate.map(i =>
          sb.from('price_items').update({ category_id: i.catId }).eq('id', i.itemId)
        ));
      }

      // 4. Batch-insert price_history
      if (historyRows.length) {
        const { error } = await sb.from('price_history').insert(historyRows);
        if (error) throw new Error('price_history insert: ' + error.message);
      }

      // 5. Refresh stats (avg_price, last_price, record_count) for every affected item
      //    These are denormalised columns on price_items used by the list UI.
      //    We recalculate them here so they are always consistent after any insert.
      const affectedIds = [...new Set(historyRows.map(r => r.item_id).filter(Boolean))];
      if (affectedIds.length) {
        // Fetch all history for affected items in one query (cheaper than N queries)
        const { data: hist } = await sb.from('price_history')
          .select('item_id, unit_price, purchased_at')
          .in('item_id', affectedIds)
          .order('purchased_at', { ascending: false });

        const byItem = {};
        (hist || []).forEach(r => {
          if (!byItem[r.item_id]) byItem[r.item_id] = [];
          byItem[r.item_id].push(r.unit_price);
        });

        await Promise.all(affectedIds.map(id => {
          const prices = (byItem[id] || []).filter(v => v != null);
          if (!prices.length) {
            return sb.from('price_items')
              .update({ avg_price: null, last_price: null, record_count: 0 })
              .eq('id', id);
          }
          const avg  = prices.reduce((a, b) => a + b, 0) / prices.length;
          const last = prices[0]; // already sorted DESC by purchased_at
          return sb.from('price_items').update({
            avg_price:    Math.round(avg  * 100) / 100,
            last_price:   last,
            record_count: prices.length,
          }).eq('id', id);
        }));
      }

      return { saved: historyRows.length };
    });
  },
};

/* ════════════════════════════════════════════════════════════════════
   BOOT PRELOAD — replaces ad-hoc Promise.all in bootApp()
════════════════════════════════════════════════════════════════════ */
async function dbPreload() {
  return _wrap('Iniciando…', async () => {
    await Promise.all([
      _accounts.load(true),
      _categories.load(true),
      _payees.load(true),
    ]);
  });
}

/** Bust all caches (call after import or family switch) */
function dbBustAll() {
  ['accounts', 'categories', 'payees'].forEach(_bust);
}

/* ── Expose on window ──────────────────────────────────────────── */
window.DB = {
  accounts:     _accounts,
  categories:   _categories,
  payees:       _payees,
  transactions: _transactions,
  dashboard:    _dashboard,
  prices:       _prices,
  preload:      dbPreload,
  bustAll:      dbBustAll,
};

// Resolve a category ID to itself + all descendant IDs (for hierarchical filter)
function _resolveCategoryIds(rootId) {
  const all = state.categories || [];
  const result = [];
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift();
    result.push(id);
    all.filter(c => c.parent_id === id).forEach(c => queue.push(c.id));
  }
  return result;
}
