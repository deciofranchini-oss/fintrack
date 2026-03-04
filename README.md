# J.F. Family FinTrack

Personal finance PWA built with vanilla JS + Supabase.

## Project Structure

```
fintrack/
├── index.html                  # Main HTML shell (2 100 lines — no inline JS/CSS)
├── css/
│   └── style.css               # All styles (1 240 lines)
├── js/
│   ├── app.js                  # Core: init, Supabase, boot, navigation, UI toggles
│   ├── accounts.js             # Accounts & account groups CRUD
│   ├── categories.js           # Categories (hierarchical) CRUD
│   ├── payees.js               # Payees/beneficiaries + clipboard import
│   ├── transactions.js         # Transactions: list, CRUD, detail, clipboard import
│   ├── budgets.js              # Monthly budgets
│   ├── dashboard.js            # Dashboard summary + charts
│   ├── reports.js              # Full reports: charts, filters, PDF/CSV export
│   ├── payee_autocomplete.js   # Payee smart autocomplete + fuzzy matching
│   ├── ui_helpers.js           # Icon picker, category picker, shared UI utilities
│   ├── scheduled.js            # Scheduled / recurring transactions
│   ├── attachments.js          # File attachment upload (Supabase Storage)
│   ├── iof.js                  # IOF (Brazilian tax) auto-calculation
│   ├── forecast.js             # Cash-flow forecast report
│   ├── email.js                # Email report via EmailJS
│   ├── settings.js             # App settings, PIN, auto-lock
│   ├── import.js               # Import engine v3 (CSV, OFX, MoneyWiz, etc.)
│   ├── backup.js               # Backup / restore / clear database
│   ├── auth.js                 # Multi-user auth + family administration
│   └── auto_register.js        # Auto-register engine for scheduled transactions
└── migration_families.sql      # Supabase SQL: multi-family support migration
```

## Setup

1. Create a [Supabase](https://supabase.com) project.
2. Run the SQL schema from your Supabase dashboard (SQL Editor).
3. If upgrading to multi-family support, also run `migration_families.sql`.
4. Open `index.html` in a browser (or serve with any static file server).
5. On first launch, configure your Supabase URL + anon key in the settings screen.

## Serving locally

```bash
# Python
python3 -m http.server 8080

# Node
npx serve .
```

## GitHub Pages

Push this repo to GitHub and enable Pages on the `main` branch root.

## Tech stack

- Vanilla JS (no framework)
- Supabase (PostgreSQL + Auth + Storage)
- Chart.js (charts)
- EmailJS (email reports)
- jsPDF + html2canvas (PDF export)
- SheetJS (Excel import/export)
