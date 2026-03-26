# Family FinTrack — Developer & AI Reference Guide

> **Purpose:** Complete technical, functional, and database reference for developers and AI assistants.
> **Version:** _45 · March 2026 | **Author:** Décio Mattar Franchini
> **Stack:** Vanilla JS PWA · Supabase (PostgreSQL + Auth + Storage) · GitHub Pages

---

## Table of Contents

1. [What this app is](#1-what-this-app-is)
2. [Architecture overview](#2-architecture-overview)
3. [Runtime boot flow](#3-runtime-boot-flow)
4. [Script load order](#4-script-load-order)
5. [Global contracts](#5-global-contracts)
6. [Auth and user management](#6-auth-and-user-management)
7. [Multi-tenant model](#7-multi-tenant-model)
8. [Module responsibilities](#8-module-responsibilities)
9. [Database schema](#9-database-schema)
10. [FX multi-currency](#10-fx-multi-currency)
11. [Transactions](#11-transactions)
12. [Reports and PDF export](#12-reports-and-pdf-export)
13. [Scheduled transactions engine](#13-scheduled-transactions-engine)
14. [Import pipeline](#14-import-pipeline)
15. [Optional modules](#15-optional-modules)
16. [Setup wizard](#16-setup-wizard)
17. [Config keys](#17-config-keys)
18. [Logo pipeline](#18-logo-pipeline)
19. [Deploy GitHub Pages](#19-deploy-github-pages)
20. [Regression checklist](#20-regression-checklist)
21. [Known pitfalls](#21-known-pitfalls)
22. [Changelog _37 to _45](#22-changelog-_37-to-_45)

---

## 1. What this app is

**Family FinTrack** is a Progressive Web Application (PWA) for personal and family financial management.
It runs entirely in the browser — no backend server, no build step. Supabase acts as BaaS.

Core capabilities:
- Multi-user per family, full data isolation by `family_id`
- Accounts + Groups (multi-currency, IOF, credit card: `best_purchase_day`, `due_day`)
- Categories (hierarchical, typed: `despesa` / `receita` / `transferencia`)
- Payees with contact data, CNPJ/CPF, and default category
- Transactions (expense / income / transfer / card payment; pending / confirmed; tags; attachments)
- Budgets (monthly / annual per category with `auto_reset`)
- Scheduled transactions + auto-register engine
- Foreign exchange rates via api.frankfurter.app (TTL 4h, cached in `app_settings`)
- Reports: grouped categories, tag filter, trend chart, PDF / XLSX / CSV export
- Import pipeline: CSV, OFX, Nubank, Inter, Itau, XP, MoneyWiz + AI mapping
- Backup/restore (full JSONB snapshot per family in `app_backups`)
- Grocery lists + price history (optional, feature-flagged per family)
- Investment portfolio: positions, transactions, market price history (feature-flagged)
- Family composition: members as business entities (not necessarily app users)
- AI receipt parsing via Google Gemini Vision -> price_history
- Orphan record scanner (19 referential integrity checks across all tables)
- Setup wizard for new families (manual trigger for admins in Settings)

---

## 2. Architecture overview

```
Browser (PWA / index.html)
       |  @supabase/supabase-js v2 (CDN)
Supabase Platform
  |-- Auth     (JWT sessions, password management)
  |-- PostgREST (auto-generated REST API)
  |-- PostgreSQL (RLS policies enforce tenant isolation)
  `-- Storage  (attachments, avatars)
```

All business logic is in the frontend. Supabase is used only for persistence and auth.
Navigation is SPA: `navigate(page)` shows/hides `div.page` elements.
No bundler, no build step. Classic script globals. **Load order is critical.**

External libs from CDN (loaded before app scripts):
Supabase JS v2, Chart.js 4, html2canvas, jsPDF + autotable, SheetJS xlsx, EmailJS.

---

## 3. Runtime boot flow

```
Page load -> scripts execute in order
  `-- state.js executes first -> window.state = {} initialized
  `-- auth.js (last to load) calls tryAutoConnect()       <- entry point
       |-- No credentials -> show setupScreen
       |-- URL has ?code= (password recovery) -> _showRecoveryPwdForm()
       `-- Credentials found -> sb = supabase.createClient(url, key)
             `-- tryRestoreSession()
                   |-- No session -> showLoginScreen()
                   `-- Session valid -> _loadCurrentUserContext()
                         |-- 1. sb.auth.getUser()
                         |-- 2. app_users query (role, name, family_id, avatar)
                         |-- 3. family_members query (all user families + roles)
                         |-- 4. families query (resolve names)
                         |-- Fallback 1: use app_users.family_id if family_members empty
                         |-- Fallback 2: fresh family_members query by auth.uid()
                         `-- currentUser set -> bootApp()
                               |-- DB.preload()             [accounts+categories+payees] awaited
                               |-- loadAppSettings()        [app_settings table] awaited, non-fatal
                               |-- loadScheduled()          [background]
                               |-- initFxRates()            [background]
                               |-- loadFamilyComposition()  [background]
                               |-- runScheduledAutoRegister() [background]
                               |-- populateSelects()
                               |-- applyPricesFeature()     [background]
                               |-- applyGroceryFeature()    [background]
                               |-- applyInvestmentsFeature() [background]
                               |-- initWizard()             [delayed 800ms]
                               `-- navigate('dashboard')
```

CRITICAL: `loadAppSettings()` uses `.catch()` — failure must never abort `DB.preload()`.

---

## 4. Script load order

| # | File | Lines | Fns | Key role |
|---|---|---|---|---|
| 1 | **state.js** | 73 | 0 | **Global `state{}` — MUST be the first local script** |
| 2 | cursor.js | 317 | 0 | Loading cursor widget (CSS-based, no top-level functions) |
| 3 | db.js | 405 | 9 | Data-access layer: `DB.*`, TTL cache, `dbPreload()` |
| 4 | settings.js | 1224 | 53 | `loadAppSettings()`, `saveAppSetting()`, `getAppSetting()` |
| 5 | config.js | 6 | 0 | CDN URL constants |
| 6 | app.js | 885 | 25 | Boot: `tryAutoConnect()`, `bootApp()`, `navigate()`, sidebar/nav |
| 7 | accounts.js | 640 | 27 | Account + group CRUD |
| 8 | categories.js | 578 | 27 | Hierarchical category tree CRUD + picker widget |
| 9 | payees.js | 786 | 31 | Payee CRUD + default category |
| 10 | transactions.js | 1763 | 57 | Transaction CRUD, FX panel, debounced filters |
| 11 | budgets.js | 608 | 19 | Budget CRUD + progress bars |
| 12 | fx_rates.js | 212 | 13 | `initFxRates()`, `getFxRate()`, `toBRL()`, `txToBRL()` |
| 13 | dashboard.js | 1075 | 23 | KPIs, cashflow chart, category doughnut, upcoming panel, member filter |
| 14 | reports.js | 1918 | 55 | Analysis + tag filter + trend chart + PDF/XLSX/CSV |
| 15 | payee_autocomplete.js | 276 | 21 | Transaction form autocomplete + similarity matcher |
| 16 | ui_helpers.js | 416 | 13 | `ICON_META`, `renderIconEl()`, `buildCatPicker()`, `setCatPickerValue()` |
| 17 | scheduled.js | 1685 | 54 | Scheduled transactions CRUD + occurrence generator + upcoming view |
| 18 | attachments.js | 192 | 9 | Supabase Storage upload |
| 19 | iof.js | 169 | 7 | IOF rate computation (3.38% default) |
| 20 | forecast.js | 297 | 5 | Balance forecast chart |
| 21 | email.js | 15 | 0 | EmailJS config constants |
| 22 | import.js | 1343 | 40 | Import wizard + staging commit + bank parsers |
| 23 | backup.js | 1120 | 37 | Full JSONB backup/restore per family |
| 24 | auth.js | 4169 | 114 | Auth + ALL admin/family/user management (largest file) |
| 25 | admin.js | 38 | 2 | **STUB ONLY**: `toggleFamilyFeature()`, `_loadFamilyFeatures()` |
| 26 | autocheck.js | 480 | 18 | Auto-check timer + migration SQL display |
| 27 | auto_register.js | 515 | 21 | Scheduled auto-register engine |
| 28 | audit.js | 160 | 6 | `scheduled_run_logs` audit log view |
| 29 | receipt_ai.js | 415 | 17 | Gemini Vision receipt -> price_history |
| 30 | prices.js | 1256 | 69 | Price history module (feature-flagged) |
| 31 | grocery.js | 714 | 21 | Grocery list module (feature-flagged) |
| 32 | import_ai.js | 306 | 8 | AI-assisted import column mapping |
| 33 | family_members_composition.js | 995 | 30 | Family members as business entities + multi-picker widget |
| 34 | investments.js | 867 | 27 | Investment portfolio (feature-flagged) |
| 35 | orphan.js | 729 | 9 | Orphan record scanner + bulk delete (19 integrity checks) |
| 36 | wizard.js | 813 | 46 | Setup wizard + `openWizardManual()` |

**WARNING: `state.js` MUST be the first local script** (before `cursor.js` and `db.js`).
`db.js` accesses `state.accounts`, `state.groups`, etc. at load time.

**WARNING: `admin.js` is a stub.** All admin/user management lives in `auth.js`.
Never add to `admin.js` a function that already exists in `auth.js` — it would silently override the correct version.

**WARNING: No duplicate `const`/`let` at global scope.**
`AUTO_REGISTER_SQL` is declared only in `autocheck.js`; `auto_register.js` references it without redeclaring.
Before adding any top-level `const`/`let`, grep all JS files for the name.

**WARNING: `utils.js` and `supabase.js` are in the repo but NOT loaded in `index.html`.**
- `utils.js` — unfinished refactor (duplicates `payee_autocomplete.js` + utility functions). Do NOT add to `index.html` without a deliberate migration.
- `supabase.js` — alternative Supabase bootstrap, not integrated. Do NOT add to `index.html`.

---

## 5. Global contracts

### Core globals

| Name | Where set | Purpose |
|---|---|---|
| `sb` | `app.js tryAutoConnect()` | Supabase client — all DB/auth queries |
| `state` | `state.js` | Runtime cache for all app data (see shape below) |
| `currentUser` | `auth.js _loadCurrentUserContext()` | Identity + permissions |
| `famQ(query)` | `auth.js` | Appends `.eq('family_id', currentUser.family_id)` to any query |
| `famId()` | `auth.js` | Returns `currentUser.family_id` for use in inserts |
| `DB` | `db.js` | Typed data-access layer with TTL cache |

### `currentUser` shape

```js
{
  id:                  string,   // = auth.uid()
  email:               string,
  name:                string,
  role:                'admin' | 'owner' | 'user' | 'viewer',
  family_id:           string | null,
  families:            [{ id, name, role }],
  avatar_url:          string | null,
  preferred_family_id: string | null,
  can_view:    true,
  can_create:  bool,
  can_edit:    bool,
  can_delete:  bool,   // admin/owner only
  can_export:  true,
  can_import:  bool,
  can_admin:   bool,   // true only for role='admin'
  can_manage_family: bool,
}
```

### `famQ()` behaviour

```js
famQ(sb.from('transactions').select('*'))
// Admin/owner with no family_id -> no filter (global access, intentional)
// User with no family_id -> filters by '00000000-...' (prevents data leak)
```

Always use `famQ()` for reads. Always include `family_id: famId()` in inserts.

### `DB` data-access layer

```js
await DB.preload()                          // boot: accounts + categories + payees
await DB.accounts.load(force?)              // TTL 2 min; populates state.accounts + state.groups
await DB.categories.load(force?)            // TTL 5 min; populates state.categories
await DB.payees.load(force?)                // TTL 2 min; populates state.payees
await DB.accounts.recalcBalances()          // recomputes account.balance from transactions
await DB.transactions.load(opts)            // paginated + filtered (not cached)
await DB.dashboard.loadKPIs(memberIds?)     // income/expense/total/pendingCount -- 1 query
await DB.dashboard.loadCashflow(acctId?, memberIds?) // 6-month aggregation -- 1 query
await DB.prices.saveReceipt(...)            // batched price_history insert
DB.accounts.bust()                          // invalidate accounts cache
DB.bustAll()                                // invalidate all caches
```

`DB.dashboard.loadKPIs()` returns zeros immediately if `currentUser.family_id` is null and user is not admin/owner.

### `state` object — full shape

```js
// Auth (legacy slots — use currentUser directly)
state.user                // null
state.profile             // null
state.familyId            // null

// Domain data — populated by DB / module loaders
state.accounts            // Account[] with computed .balance field
state.accountGroups       // account_groups[] (same ref as state.groups)
state.groups              // same array reference as state.accountGroups
state.categories          // Category[] flat list (hierarchical via parent_id)
state.payees              // Payee[]
state.transactions        // Tx[] — current page only
state.scheduled           // ScheduledTx[]
state.budgets             // Budget[]

// Pagination and sorting
state.txPage              // current page index (0-based)
state.txPageSize          // rows per page (default 50)
state.txTotal             // total rows matching filter (from Supabase count)
state.txSortField         // 'date' | 'amount' | etc.
state.txSortAsc           // bool
state.txFilter            // { search, month, account, type, status, memberIds? }
state.txView              // 'flat' | 'group'

// Navigation
state.currentPage         // active page string ('dashboard', 'transactions', ...)

// UI
state.chartInstances      // { canvasId: Chart } -- used by PDF export capture
state.privacyMode         // bool -- masks all monetary values when true

// Preferences and auxiliary caches
state.ui                  // { currentPage } (legacy slot)
state.prefs               // {}
state.lastCategoryByPayee // { payeeId: categoryId } -- used by autocomplete
state.cache               // generic module cache bucket
state.flags               // feature flag overrides
```

---

## 6. Auth and user management

### Two-table model

| Table | Role |
|---|---|
| `auth.users` | Supabase Auth — JWT sessions, hashed passwords |
| `app_users` | App metadata — name, role, permissions, approval status |
| `family_members` | **SOURCE OF TRUTH** for user-family links + per-family role |

### Self-registration flow

1. `doRegister()` -> inserts `app_users` (`approved=false`, `active=false`, `role='viewer'`)
2. Admin notified via EmailJS (`_notifyAdminNewRegistration()`)
3. Admin: Gerenciar Usuarios -> Pendentes -> Aprovar
4. `approveUser()` opens `approvalModal` (select/create family)
5. `doApproveUser()`: updates `app_users`, upserts `family_members`, calls RPC `approve_user` (SECURITY DEFINER), falls back to `sb.auth.signUp()`, sends welcome email + Supabase password reset link

### Admin-created user

`saveUser()` (new user):
1. Inserts `app_users` (`approved=true`, `active=true`)
2. Upserts `family_members` with role from `uInitFamilyRole`
3. `sb.auth.signUp()` with password
4. `_sendNewUserWelcomeEmail()` with temporary password

### Password reset (admin)

`resetUserPwd()` -> `resetPwdModal` -> `doResetUserPwd()`:
1. `sbAdmin.auth.admin.updateUserById()` — requires service role key in Settings
2. Fallback: RPC `set_user_password` — requires `migration_set_password.sql`
3. Fallback: `sb.auth.resetPasswordForEmail()`
4. Syncs `app_users.password_hash`, clears `must_change_pwd`

### My Family management modal (`openMyFamilyMgmt()`)

Allows non-admin users to manage their own family context:
- Switch between families the user belongs to
- View and change per-family role for other members
- Invite users by email (`mfmInvite()`) or add existing users (`mfmAddExisting()`)
- Toggle feature flags per family (`_mfmRenderFeatures()`)

### Roles and permissions

| Role | can_admin | can_delete | can_import | can_manage_family |
|---|---|---|---|---|
| admin | yes | yes | yes | yes |
| owner | no | yes | yes | yes |
| user | no | no | no | no |
| viewer | no | no | no | no |

---

## 7. Multi-tenant model

Every data table has `family_id`. All reads use `famQ()`. All inserts include `family_id: famId()`.

NOTE: `famQ()` is a frontend convenience filter only. Without Supabase RLS policies, any authenticated
user can bypass it from the browser console. **Enable RLS on all tables.**

Feature flags per family are stored in `app_settings` as `{feature}_enabled_{family_id}`.
Cached in `window._familyFeaturesCache` and `localStorage`.

---

## 8. Module responsibilities

### auth.js (4169 lines, 114 functions)

Session: `tryRestoreSession()`, `doLogin()`, `doLogout()`, `_loadCurrentUserContext()`
Registration: `doRegister()`, `approveUser()`, `doApproveUser()`, `rejectUser()`
User management: `loadUsersList()`, `saveUser()`, `editUser()`, `resetUserPwd()`, `doResetUserPwd()`, `toggleUserActive()`
Family management: `loadFamiliesList()`, `saveFamily()`, `deleteFamily()`, `wipeFamilyData()`,
  `addUserToFamily()`, `removeUserFromFamily()`, `updateMemberRole()`, `inviteToFamily()`,
  `openCopyFamilyModal()`, `executeCopyFamily()`
My Family modal: `openMyFamilyMgmt()`, `mfmSwitchFamily()`, `_mfmRender()`, `_mfmRenderFeatures()`,
  `mfmChangeRole()`, `mfmRemoveMember()`, `mfmAddExisting()`, `mfmInvite()`
Navigation: `famQ()`, `famId()`, `switchFamily()`, `_renderFamilySwitcher()`
Wizard: `_offerFamilyWizard()`, `_launchWizardForFamily()`
Email: `_sendApprovalEmail()`, `_sendNewUserWelcomeEmail()`, `_notifyAdminNewRegistration()`, `_sendInviteEmail()`
Avatar: `_userAvatarHtml()`, `_uploadUserAvatar()`, `removeUserAvatar()`, `previewUserAvatar()`
Profile: `openMyProfile()`, `saveMyProfile()`, `showChangeMyPwd()`, `doChangeMyPwd()`

### dashboard.js (1075 lines, 23 functions)

`loadDashboard()` — guard: exits if `!sb` or user has no `family_id`
`loadDashboardRecent(memberIds?)` — recent transactions panel
`renderCategoryChart()` — doughnut with `_catColor` + `usedSet`
`renderCashflowChart(memberIds?)` — 6-month bar+line via `DB.dashboard.loadCashflow()`
`renderDashboardUpcoming(memberIds?)` — upcoming scheduled transactions panel
`_renderDashFavCategories()` — favourite category chips with budget progress
`_getDashMemberIds()` / `_openDashMonthTx()` — member filter helpers
`openDashCustomModal()` / `_dashCustomSave()` — dashboard card visibility customisation
`_dashSavePrefs()` / `_syncDashPrefsFromServer()` — persist layout to `app_settings`

### transactions.js (1763 lines, 57 functions)

`filterTransactions(immediate?)` — debounced 280ms for typing, immediate for selects
`loadTransactions()` — paginated via `DB.transactions.load()`
`saveTransaction()` — handles FX, IOF, transfers, attachments
`openTxDetail(id)` — detail modal with edit/delete/duplicate/convert-to-scheduled
FX panel: `_updateTxCurrencyPanel()`, `fetchTxCurrencyRate()`, `updateTxCurrencyPreview()`
  - Shows for any non-BRL account (not only when currencies differ)
  - Fetches from api.frankfurter.app

### reports.js (1918 lines, 55 functions)

`fetchRptTransactions()` — all filters including tag (`.contains('tags', [tagV])`)
`loadReports()` — KPIs, 4 Chart.js charts, grouped category table, trend chart
`renderTrendChart(from, to)` — rolling line chart for custom date ranges
`_buildReportPDF()` — visibility fix + fresh render + canvas capture
`_ensureChartsRendered()` — always re-renders with container visible
Category table: 3 groups (Despesas / Receitas / Transferencias), % within group
Color dedup: `_catColor(color, idx, usedSet)` — 24-color palette, no repeats per chart

### scheduled.js (1685 lines, 54 functions)

`loadScheduled()` — loads `scheduled_transactions` + `scheduled_occurrences`
`processScheduledOccurrence(sc, opts)` — creates paired transfer legs, marks occurrence
`generateOccurrences(sc, limit)` — projects future dates for any frequency
`renderScheduled(list)` — card list with chip filters (active/paused/finished)
`renderUpcoming()` — timeline of next 30 days across all schedules

### family_members_composition.js (995 lines, 30 functions)

Manages `family_composition` table — members as business entities (may or may not be app users).
`loadFamilyComposition(force?)` — loads into `_fmc.members`, called at boot (background)
`populateFamilyMemberSelect(selectId, opts)` — fills any `<select>` with members
`renderFmcMultiPicker(containerId, opts)` — chip-based multi-select for member filtering
`getFamilyMembers()` / `getFamilyMemberById(id)` — read helpers
`refreshAllFamilyMemberSelects()` — updates all member selects after CRUD
Used by: transactions form, scheduled form, reports filter, dashboard member filter

### investments.js (867 lines, 27 functions)

Feature-flagged via `investments_enabled_{family_id}` in `app_settings`.
`loadInvestments(force?)` — loads `investment_positions` + `investment_transactions`
`loadInvestmentsPage()` / `_renderInvestmentsPage()` — portfolio UI
`_invAugmentAccountBalances()` — adds market value to account balances
  (called via `invPostBalanceHook` from `DB.accounts.recalcBalances()`)
`updateAllPrices()` — bulk fetch of current prices
Tables: `investment_positions`, `investment_transactions`, `investment_price_history`

### orphan.js (729 lines, 9 functions)

Admin-only tool to find and delete orphaned records across all tables.
`runOrphanScan()` — executes 19 referential integrity checks in parallel
`confirmOrphanDelete()` / `_doOrphanDelete(groups)` — soft preview then bulk delete
`scanOrphanAttachments()` / `fixOrphanAttachments()` — Storage bucket orphan scan
Checks cover: `app_users`, `family_members`, `families`, `accounts`, `account_groups`,
`categories`, `payees`, `transactions`, `budgets`, `scheduled_transactions`,
`scheduled_occurrences`, `price_items`, `price_history`, `grocery_lists`, `grocery_items`, `app_backups`

### wizard.js (813 lines, 46 functions)

Auto-triggers on boot when all true:
1. `currentUser.can_admin=true` OR `role='owner'`
2. `wizard_dismissed` flag is `false` in `app_settings`
3. Family has 0 transactions
4. Family has no accounts OR no categories

`openWizardManual()` — bypasses all guards, admin/owner only, from Settings panel
`_updateWizardSettingsStatus()` — shows status in Settings row

---

## 9. Database schema

### Core financial tables

```sql
families (id, name, description, active, created_at, updated_at)

account_groups (id, family_id, name, emoji, color, currency)

accounts (id, family_id, group_id, name, type, currency, balance, initial_balance,
          color, icon, active, is_favorite, is_brazilian, iof_rate,
          best_purchase_day, due_day)
-- type: corrente | poupanca | investimento | cartao_credito | carteira | outros

categories (id, family_id, parent_id, name, type, color, icon)
-- type: 'despesa' | 'receita' | 'transferencia'

payees (id, family_id, name, type, default_category_id, address, city,
        state_uf, zip_code, phone, whatsapp, website, cnpj_cpf)
-- type: 'beneficiario' | 'fonte_pagadora' | 'ambos'

transactions (id, family_id, account_id, payee_id, category_id,
              description, amount, currency, exchange_rate,
              brl_amount,        -- canonical BRL equivalent (USE THIS)
              amount_brl,        -- legacy alias; do not write, do not trust
              date, time, memo, tags TEXT[], check_number,
              is_transfer, transfer_to_account_id, transfer_pair_id, transfer_kind,
              linked_transfer_id, is_card_payment,
              status,            -- 'confirmed' | 'pending'
              reconciled, balance_after,
              attachment_url, attachment_name,
              family_member_id UUID, family_member_ids UUID[],
              moneywiz_key, import_session_id, created_at, updated_at)

budgets (id, family_id, category_id, month DATE, amount, budget_type, auto_reset,
         year, notes, family_member_id)
-- budget_type: 'monthly' | 'annual'
```

### Scheduled transaction tables

```sql
scheduled_transactions (id, family_id, description, type, amount, currency,
                         brl_amount, fx_mode, fx_rate,
                         account_id, transfer_to_account_id, transfer_kind,
                         payee_id, category_id, memo, tags, status,
                         start_date, frequency, custom_interval, custom_unit,
                         end_count, end_date, auto_register, auto_confirm,
                         notify_email, notify_email_addr, notify_days_before,
                         family_member_id UUID, family_member_ids UUID[])
-- frequency: once|weekly|biweekly|monthly|bimonthly|quarterly|semiannual|annual|custom
-- status: active | paused | finished

scheduled_occurrences (id, scheduled_id, scheduled_date, actual_date, amount, memo,
                        transaction_id, execution_status, execution_token,
                        executed_at, error_message)
-- execution_status: pending|processing|executed|failed|skipped

scheduled_run_logs (id, family_id, scheduled_id, scheduled_date, transaction_id,
                     status, amount, description, created_at)
```

### User and auth tables

```sql
app_users (id, email, name, password_hash, role, active, approved, must_change_pwd,
           can_view, can_create, can_edit, can_delete, can_export, can_import, can_admin,
           last_login, created_at, created_by, family_id, preferred_family_id,
           avatar_url, show_school_link)
-- role: owner | admin | editor | viewer | user | member

app_sessions (id, user_id, token, expires_at, created_at)

family_members (id, user_id, family_id, role, created_at)
-- SOURCE OF TRUTH for user-family relationships
-- role: owner | admin | user | viewer

family_composition (id, family_id, name, member_type, family_relationship, birth_date,
                    avatar_emoji, app_user_id, created_at)
-- Business entities: family members who may or may not be app users
-- member_type: adult | child | other

user_profiles (id, email, display_name, role, active)
-- Legacy mirror of auth.users; not actively used by app code
```

### System tables

```sql
app_settings (key TEXT PK, value JSONB, updated_at)
app_backups (id, family_id, label, backup_type, created_by, payload JSONB, counts JSONB, size_kb)
tags (id, name UNIQUE)  -- global, no family_id; NOT used (tags stored as TEXT[] in transactions)
```

### Import staging tables

```sql
import_sessions             (id TEXT, file_name, import_type, status, stats JSONB,
                              created_at, committed_at)
                            -- WARNING: no family_id (only isolation gap in schema)
import_staging_transactions (id, session_id, account_name, transfer_account, description,
                              payee_name, category_path, date, time, memo, amount, currency,
                              check_number, tags, running_balance, is_transfer,
                              action, conflict_reason)
import_staging_accounts     (id, session_id, name, type, currency, balance,
                              icon, color, source_data, status)
import_staging_categories   (id, session_id, name, type, parent_name, icon, color,
                              full_path, status)
import_staging_payees       (id, session_id, name, status)
```

### Price and grocery tables (optional modules)

```sql
price_items   (id, family_id, category_id, name, description, unit,
               avg_price, last_price, min_price, record_count)
price_stores  (id, family_id, payee_id, name, address, city, state_uf, phone, cnpj, zip_code)
price_history (id, family_id, item_id, store_id, unit_price, quantity, purchased_at, notes)
grocery_lists (id, family_id, name, status)  -- status: open | done
grocery_items (id, list_id, family_id, name, qty, unit, checked, price_item_id,
               suggested_price, suggested_store, needs_mapping)
```

### Investment tables (optional module)

```sql
investment_positions (id, family_id, account_id, ticker, name, asset_type,
                      quantity, avg_cost, current_price, last_price_update)
-- asset_type: stock | fii | bdr | etf | fixed | crypto | other

investment_transactions (id, family_id, account_id, position_id, type,
                          date, quantity, unit_price, total_amount, fees, transaction_id)
-- type: buy | sell
-- transaction_id FK to transactions (optional link to ledger)

investment_price_history (id, position_id, date, price, source, created_at)
```

### Entity relationship summary

```
families -< account_groups -< accounts -< transactions
         -< categories (self-ref: parent_id)
         -< payees
         -< budgets -> categories
         -< scheduled_transactions -< scheduled_occurrences -> transactions
         -< app_backups
         -< family_members >- app_users
         -< family_composition
         -< price_items -< price_history -> price_stores
         -< grocery_lists -< grocery_items -> price_items
         -< investment_positions -< investment_transactions
                                 -< investment_price_history
```

---

## 10. FX multi-currency

- FX rates fetched from api.frankfurter.app (free, no key required)
- Cached in `app_settings`: key `fx_rates_cache` + `fx_rates_ts`, TTL 4 hours
- `initFxRates()` is deduped with `_fxPromise` — safe to call multiple times
- `getFxRate(currency)` returns BRL multiplier (1 for BRL)
- `toBRL(amount, currency)` converts using cached rate
- `txToBRL(tx)` prefers `tx.brl_amount` if saved; falls back to `toBRL()`

FX panel in transaction form:
- Shown whenever account currency != BRL (not only when tx/account currencies differ)
- Same currency (e.g. USD tx on USD account): fetches `accountCur -> BRL`
- Different currency: fetches `txCurrency -> accountCurrency`
- `brl_amount` always saved when non-BRL account and rate provided

---

## 11. Transactions

### Types

| type | is_transfer | is_card_payment | Description |
|---|---|---|---|
| expense | false | false | Regular expense |
| income | false | false | Regular income |
| transfer | true | false | Inter-account transfer (2 rows) |
| card_payment | true | true | Credit card bill payment |

### Transfer pair model

A transfer creates **two** transaction rows:
- **Debit**: `account_id=source`, `amount` negative, `transfer_to_account_id=destination`
- **Credit**: `account_id=destination`, `amount` positive, `linked_transfer_id=debit.id`
- Both rows share `transfer_pair_id`

Legacy single-leg: only debit row, `linked_transfer_id` is null.
`DB.accounts.recalcBalances()` handles legacy credit separately (Step 2).

### Filter debounce

`filterTransactions(immediate?)`:
- `immediate=true` -> fires immediately (selects: account, month, type, status, member)
- `immediate=false` -> 280ms debounce (search text input)

### Member filter

Transactions and scheduled transactions support `family_member_id` (single UUID) and
`family_member_ids` (UUID array). The filter ORs across both fields:
```js
q.or(`family_member_id.eq.${id},family_member_ids.cs.{${id}}`)
```

---

## 12. Reports and PDF export

### Filters (`fetchRptTransactions`)

Period, Account, Type (expense/income), Category, Payee, Tag, Member

Tag filter: `.contains('tags', [tagV])` — PostgREST array-contains operator.
Tag dropdown populated from current results, refreshes after each fetch.

### Category table grouping

Three sections with own subtotals and % within group:
- **Despesas**: `amount < 0 AND NOT is_transfer`
- **Receitas**: `amount > 0 AND NOT is_transfer`
- **Transferencias**: `is_transfer = true`

### Trend chart

`renderTrendChart(from, to)` — rolling income vs. expense line chart for the selected date range.
Grouped by month. Uses the same `fetchRptTransactions` result.

### Color dedup (`_catColor`)

`_catColor(color, idx, usedSet)`:
- Uses category custom color if non-generic and not yet used
- Otherwise advances through `CAT_PALETTE` (24 colors) until unused
- Each chart creates its own `new Set()` -> zero repeats per chart

### PDF chart capture (definitive fix since _42)

`_buildReportPDF()`:
1. Makes `reportRegularView` visible (remove `display:none`)
2. Sets `visibility:hidden` on `page-reports` (invisible but layout calculated)
3. Calls `loadReports()` -> fresh Chart.js render at correct `devicePixelRatio`
4. Waits 2x `requestAnimationFrame` for browser to composite
5. Captures canvases with `toDataURL()`
6. Restores original visibility

---

## 13. Scheduled transactions engine

Flow:
```
scheduled_transactions (rule)
  `-- generate occurrences -> scheduled_occurrences
        `-- auto-register -> transactions (actual ledger entry)
                `-- logged in scheduled_run_logs
```

`auto_register.js` runs on boot and on configurable browser timer (`autocheck.js`):
1. Fetches `scheduled_transactions` where `auto_register=true`, `status='active'`
2. Computes next occurrence dates up to `daysAhead`
3. Creates transactions (including paired transfer legs via `_createPairedTransferLeg()`)
4. Marks occurrences `executed`, logs in `scheduled_run_logs`
5. Uses `execution_token` (UUID) to prevent double-execution in concurrent tabs

Frequencies: `once`, `weekly`, `biweekly`, `monthly`, `bimonthly`, `quarterly`, `semiannual`, `annual`, `custom`

---

## 14. Import pipeline

Staging flow:
1. Parse file -> insert `import_staging_*` (all linked by `session_id`)
2. User reviews conflicts and mappings
3. Commit -> insert into real tables

Supported formats: CSV, OFX, Nubank CSV, Inter CSV, Itau OFX, XP OFX, MoneyWiz CSV

AI-assisted mapping (`import_ai.js`): sends column headers to Google Gemini,
returns field mapping JSON, pre-fills the column mapping UI.

---

## 15. Optional modules

Enabled per family by admin in Settings -> Familia & Usuarios or family card checkboxes.

| Feature | Flag key | Module | Notes |
|---|---|---|---|
| Gestao de Precos | `prices_enabled_{family_id}` | prices.js | Receipt AI integration |
| Lista de Mercado | `grocery_enabled_{family_id}` | grocery.js | Linked to price_items |
| Backup/Snapshot | `backup_enabled_{family_id}` | backup.js | Full JSONB backup |
| Investimentos | `investments_enabled_{family_id}` | investments.js | Augments account balances |

---

## 16. Setup wizard

### Auto-trigger conditions (ALL must be true)

1. `currentUser.can_admin=true` OR `role='owner'`
2. `app_settings['wizard_dismissed']` != `true`
3. Family has 0 transactions
4. Family has no accounts OR no categories

Once dismissed: sets `wizard_dismissed=true`, never auto-shows again.

### Manual trigger

Settings -> Familia & Usuarios -> [▶ Iniciar] button (admin/owner only).
`openWizardManual()` bypasses all guards, clears `wizard_dismissed`.
Status sub-text shows: pending (amber) / completed / default.

### Also triggered after new family creation

`saveFamily()` creates new family -> `_offerFamilyWizard()` -> green banner
-> [Configurar agora] -> `_launchWizardForFamily()`.

### Wizard steps

1. Family name
2. Members (adults + children)
3. Invite adults by email
4. Main expense categories + budgets (skippable)
5. First account (opens `openAccountModal()`)
6. First transaction (opens transaction modal)
7. Complete

---

## 17. Config keys

### `app_settings` table

| Key | Purpose |
|---|---|
| `app_logo_url` | Overrides default logo URL everywhere |
| `wizard_dismissed` | `true` when wizard completed/dismissed |
| `ej_service` | EmailJS service ID |
| `ej_template` | EmailJS template ID |
| `ej_sched_template` | EmailJS template for scheduled notifications |
| `ej_key` | EmailJS public key |
| `masterPin` | Optional PIN lock |
| `fintrack_auto_check_config` | Auto-register timer config (JSON object) |
| `fx_rates_cache` | Cached FX rates JSON |
| `fx_rates_ts` | Timestamp of last FX fetch |
| `{feature}_enabled_{family_id}` | Feature flags per family |
| `menu_visibility` | Per-admin menu item visibility JSON |
| `dashboard_prefs_{user_id}` | Per-user dashboard card visibility preferences |

### `localStorage` keys

| Key | Purpose |
|---|---|
| `sb_url` | Supabase project URL |
| `sb_key` | Supabase anon key |
| `sb_service_key` | Service role key (for admin password reset) |
| `ft_active_family_{user_id}` | Last active family per user |
| `ft_remember_me` | Base64 encoded remember-me credentials |
| `bottomNavCollapsed` | Bottom nav collapsed state |
| `fintrack_auto_check_config` | Auto-register config (synced from DB) |

---

## 18. Logo pipeline

`setAppLogo(url)` updates all logo `<img>` elements by ID:
`sidebarLogoImg`, `settingsLogoImg`, `topbarLogoImg`, `loginLogoImg`, `authLogoImg`.

Default: `DEFAULT_LOGO_URL = 'logo_transparent.png'` (relative path, works on GH Pages)
Dark variant: `logo2.png` (filename with `2` appended before `.png`) for dark sidebar backgrounds.
Override via `app_settings['app_logo_url']` -> `saveAppLogo()` in `settings.js`.

**Do NOT rename these `img` IDs** — `setAppLogo()` targets them directly.

---

## 19. Deploy GitHub Pages

Static PWA. No build step. Push to `main` -> GitHub Pages serves from repo root.
Service Worker (`sw.js`) registered with `./sw.js` scope for GH Pages compatibility.

Windows browsers have stale SW registration issues — `tryAutoConnect()` automatically
unregisters all SW registrations and clears relevant caches on Windows (`isWindows` detection).

After deploy validation:
- Login works on desktop + mobile Safari
- Service worker registers (DevTools > Application > Service Workers)
- Dashboard loads with data and account balances
- Account icons render correctly (ui_helpers.js loaded before accounts.js)
- PDF export includes charts with correct vivid colors
- Tag filter appears in reports
- Wizard accessible from Settings

---

## 20. Regression checklist

**Boot:**
- Setup screen saves credentials and boots
- Session restore after reload
- Login: approved/pending/must-change-pwd flows
- Dashboard loads with data

**Admin:**
- + Novo Usuario opens form and saves
- Edit user (pencil button) opens form pre-filled
- Approve user: modal + family select + auth account created + email sent
- Reset password: modal with 2 fields, updates auth
- Family creation shows wizard banner

**Transactions:**
- Expense/income save correctly
- Transfer creates 2 rows, both balances update
- FX panel shows for non-BRL accounts
- Member filter narrows results

**Reports:**
- Category table shows 3 groups (Despesas/Receitas/Transferencias)
- PDF includes vivid charts (not faded)
- CSV has Tags column
- Tag filter works

**Wizard:**
- Auto-triggers for new empty family
- Manual trigger in Settings works

**Investments (if enabled):**
- Portfolio page loads positions
- Account balance augmented with market value

**Orphan scanner:**
- Runs 19 checks without JS errors
- Delete preview shows before confirmation

---

## 21. Known pitfalls

### Duplicate `const`/`let` at global scope crashes everything

`const X` in file A AND `const X` in file B -> SyntaxError at parse time -> entire app fails.
Before adding any top-level `const`/`let`, grep all JS files for the name.
Known: `AUTO_REGISTER_SQL` declared only in `autocheck.js`.

### `admin.js` overrides `auth.js`

`admin.js` loads after `auth.js`. Functions with the same name in `admin.js` silently override `auth.js`.
`admin.js` intentionally contains only 2 unique functions. Keep it that way.

### Chart colors faded in PDF

Caused by Chart.js rendering with canvas parent `display:none`.
Fixed by `_ensureChartsRendered()` which always re-renders with container visible.

### `famQ()` is not security

`famQ()` is a client-side convenience filter only. Enable Supabase RLS on all tables.

### `brl_amount` vs `amount_brl`

Both exist in `transactions`. `brl_amount` is current. `amount_brl` is legacy.
**Always write to `brl_amount`.** `txToBRL()` uses `brl_amount`.

### `import_sessions` has no `family_id`

Only table without tenant isolation. Staging data is transient but be aware.

### Investment balance augmentation timing

`_invAugmentAccountBalances()` is called as `invPostBalanceHook` from inside
`DB.accounts.recalcBalances()`. If `investments.js` has not loaded yet (feature disabled),
`invPostBalanceHook` is undefined and the hook is silently skipped — this is intentional.

### `state.js` must be loaded first

If any module (e.g. `db.js`) executes before `state.js`, `state` is undefined and the
first property access throws `ReferenceError`, crashing the entire boot.
`app.js` has defensive `??` guards as a last resort — correct load order is the primary safeguard.

---

## 22. Changelog _37 to _45

_38: Admin panel fixed (id mismatch uFamilyId->uInitFamilyId); switchUATab handles 3 tabs;
     saveUser creates family_members + auth account + welcome email; approveUser/resetUserPwd
     use proper modal flows; admin.js reduced to stub; saveFamily offers wizard banner;
     FX panel for non-BRL accounts; filterTransactions debounce; wizard after new family.

_39: SyntaxError duplicate AUTO_REGISTER_SQL fixed; loadAppSettings non-fatal in boot;
     loadDashboard guard for missing sb/family_id; DB.loadKPIs guard;
     _loadCurrentUserContext fallback2 for missing family link.

_40: Report category table grouped by Despesas/Receitas/Transferencias with % within group;
     PDF category table updated; HTML column Tipo removed.

_41: CAT_PALETTE expanded to 24 colors; _catColor(color,idx,usedSet) guarantees no repeats
     within each chart; reports use separate usedSet per chart; FB palette removed.

_42: PDF charts definitive fix: _buildReportPDF makes reportRegularView visible before render;
     _ensureChartsRendered always calls loadReports() fresh with visibility:hidden trick;
     waits 2x requestAnimationFrame for correct devicePixelRatio.

_43: Tag filter in reports: rptTag select, Supabase .contains on tags TEXT[],
     dynamic dropdown from current results, CSV Tags column, active filters label.

_44: openWizardManual() in wizard.js bypasses all auto-trigger guards;
     Settings -> Familia & Usuarios row with live status indicator;
     _updateWizardSettingsStatus() called on settings page load.

_45: Structural cleanup -- no functional changes.
     state.js promoted to single source of global state (var state, loaded before cursor.js);
     let state={} removed from app.js (was a redundant re-declaration);
     app.js now initialises pagination/UI fields with ?? guards over the existing state.
     Removed from repo: forecast_fix.js (renderForecastItem never called anywhere),
     icons.js (exact duplicate of ui_helpers.js already loaded), store.js / loaders.js /
     family-switch.js (ES modules incompatible with classic-script architecture),
     ui-config.js (placeholder URL could silently overwrite configured logo),
     supabase-config.js (placeholder credentials, was never loaded).
     README: version bump to _45; script load order updated to 36 entries with state.js at #1;
     family_members_composition.js, investments.js, orphan.js documented in full;
     dashboard.js, reports.js, auth.js, scheduled.js module sections updated to reflect
     actual line counts and function signatures; family_composition table added to schema;
     investment tables added to schema; state object full shape documented;
     dashboard_prefs config key added; new pitfall entries added (investments hook, state.js order).
