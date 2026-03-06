
# FAMILY FINTRACK — FULL TECHNICAL ARCHITECTURE
Author: Décio Mattar Franchini

This document describes the complete architecture of the Family FinTrack application including:

• System architecture  
• Frontend architecture  
• Supabase integration  
• Security model  
• Row Level Security design  
• Database schema  
• Data flows  
• Module responsibilities  
• Query patterns  
• File dependency map  
• Deployment model  
• Performance considerations  
• Troubleshooting guide  
• Extension roadmap  

---------------------------------------------------------------------
# 1 SYSTEM OVERVIEW
---------------------------------------------------------------------

Family FinTrack is a **Progressive Web Application (PWA)** designed for family financial management.

Core principles:

• Multi‑user per family  
• Data isolation by family  
• Mobile first UX  
• No backend server required  
• Fully serverless architecture  
• Supabase as BaaS

Architecture:

Browser (PWA)
   ↓
Supabase JS Client
   ↓
Supabase Platform
   ↓
PostgreSQL Database

All business logic lives in the **frontend**.

Supabase provides:

• Authentication
• Database
• Storage
• Security (RLS)
• API layer (PostgREST)

---------------------------------------------------------------------
# 2 HIGH LEVEL ARCHITECTURE
---------------------------------------------------------------------

                +-----------------------+
                |      Browser (PWA)    |
                |  HTML / CSS / JS      |
                +----------+------------+
                           |
                           |
                           v
                +-----------------------+
                |    Supabase Client    |
                |   supabase-js SDK     |
                +----------+------------+
                           |
                           |
                           v
                +-----------------------+
                |    Supabase Platform  |
                |-----------------------|
                | Auth                  |
                | PostgREST API         |
                | PostgreSQL            |
                | Storage               |
                | Row Level Security    |
                +----------+------------+
                           |
                           v
                +-----------------------+
                |      PostgreSQL       |
                |   Application Data    |
                +-----------------------+

---------------------------------------------------------------------
# 3 TECHNOLOGY STACK
---------------------------------------------------------------------

Frontend

HTML5  
CSS3  
Vanilla JavaScript  
Chart.js (charts)  
html2canvas (screenshots)  
jsPDF (PDF generation)

Backend

Supabase  
PostgreSQL  
Supabase Auth  
Supabase Storage  

Infrastructure

GitHub Pages  
CDN libraries  

---------------------------------------------------------------------
# 4 APPLICATION MODULES
---------------------------------------------------------------------

Main modules:

app.js
Core application bootstrap.

auth.js
Authentication and user context.

dashboard.js
Financial overview calculations.

transactions.js
Transaction CRUD logic.

accounts.js
Account management.

categories.js
Category tree management.

payees.js
Payee directory.

budgets.js
Monthly budgets.

scheduled.js
Scheduled transaction engine.

admin.js
User management and roles.

settings.js
Application configuration.

email.js
Email notifications.

config.js
Supabase configuration.

---------------------------------------------------------------------
# 5 APPLICATION BOOT FLOW
---------------------------------------------------------------------

1 Browser loads index.html

2 app.js initializes

3 Supabase client created

4 Session restored

5 Membership loaded

6 currentUser context built

7 UI rendered

Boot diagram:

index.html
   ↓
app.js bootApp()
   ↓
initSupabase()
   ↓
restoreSession()
   ↓
loadMembership()
   ↓
build currentUser
   ↓
render navigation
   ↓
load dashboard

---------------------------------------------------------------------
# 6 USER CONTEXT OBJECT
---------------------------------------------------------------------

Core runtime object:

currentUser

Structure:

{
 id
 email
 role
 family_id
 can_admin
}

can_admin:

role == owner OR role == admin

Used for:

• settings access
• admin panel
• audit logs
• system configuration

---------------------------------------------------------------------
# 7 SECURITY MODEL
---------------------------------------------------------------------

Security layers:

1 Supabase Authentication
2 Family membership validation
3 Row Level Security
4 Frontend permission checks

Flow:

auth.uid()
   ↓
family_members
   ↓
family_id
   ↓
RLS validation
   ↓
data access granted

---------------------------------------------------------------------
# 8 ROLE MODEL
---------------------------------------------------------------------

Roles available:

owner
admin
member
viewer

Permissions:

OWNER
Full system control

ADMIN
Administrative permissions

MEMBER
Normal user

VIEWER
Read only

Permission matrix:

Feature | Owner | Admin | Member | Viewer
-----------------------------------------
Transactions | ✔ | ✔ | ✔ | View
Accounts | ✔ | ✔ | ✔ | View
Categories | ✔ | ✔ | ✔ | View
Budgets | ✔ | ✔ | ✔ | View
Users | ✔ | ✔ | ✖ | ✖
Settings | ✔ | ✔ | ✖ | ✖

---------------------------------------------------------------------
# 9 DATABASE ARCHITECTURE
---------------------------------------------------------------------

Core concept:

All data is scoped by **family_id**.

Isolation enforced via:

Row Level Security

Primary tables:

families
family_members
accounts
account_groups
categories
payees
transactions
budgets
scheduled_transactions
scheduled_occurrences
scheduled_run_logs
user_preferences

---------------------------------------------------------------------
# 10 DATABASE ENTITY RELATIONSHIP
---------------------------------------------------------------------

families
   │
   ├── family_members
   │       │
   │       └── auth.users
   │
   ├── accounts
   │      └── transactions
   │
   ├── categories
   │
   ├── payees
   │
   ├── budgets
   │
   └── scheduled_transactions
           └── scheduled_occurrences

---------------------------------------------------------------------
# 11 TABLE DEFINITIONS
---------------------------------------------------------------------

families

id UUID PRIMARY KEY  
name TEXT  
created_at TIMESTAMP

family_members

family_id UUID  
user_id UUID  
role TEXT  
created_at TIMESTAMP  

PRIMARY KEY (family_id, user_id)

accounts

id UUID  
family_id UUID  
name TEXT  
type TEXT  
currency TEXT  
initial_balance NUMERIC  
created_at TIMESTAMP

categories

id UUID  
family_id UUID  
name TEXT  
type TEXT  
parent_id UUID

payees

id UUID  
family_id UUID  
name TEXT  
type TEXT

transactions

id UUID  
family_id UUID  
account_id UUID  
category_id UUID  
payee_id UUID  
amount NUMERIC  
date DATE  
status TEXT  
memo TEXT

budgets

id UUID  
family_id UUID  
category_id UUID  
month DATE  
amount NUMERIC

scheduled_transactions

id UUID  
family_id UUID  
description TEXT  
account_id UUID  
category_id UUID  
amount NUMERIC  
frequency TEXT  
start_date DATE

scheduled_occurrences

id UUID  
scheduled_id UUID  
scheduled_date DATE  
transaction_id UUID

scheduled_run_logs

id UUID  
family_id UUID  
scheduled_id UUID  
status TEXT  
created_at TIMESTAMP

---------------------------------------------------------------------
# 12 ROW LEVEL SECURITY MODEL
---------------------------------------------------------------------

Central function:

is_family_member(fid uuid)

Implementation:

USING (
 EXISTS(
   SELECT 1
   FROM family_members
   WHERE
   family_members.family_id = fid
   AND family_members.user_id = auth.uid()
 )
)

Applied to:

accounts
transactions
categories
payees
budgets
scheduled tables

---------------------------------------------------------------------
# 13 DATA FLOW — TRANSACTIONS
---------------------------------------------------------------------

Create transaction

User input
   ↓
transactions.insert()
   ↓
RLS validation
   ↓
Database commit
   ↓
Dashboard recalculation

---------------------------------------------------------------------
# 14 SCHEDULED TRANSACTION ENGINE
---------------------------------------------------------------------

scheduled_transactions define recurrence.

Process:

scheduled_transactions
    ↓
generate occurrences
    ↓
scheduled_occurrences
    ↓
transactions created

Supports:

once
weekly
monthly
yearly

---------------------------------------------------------------------
# 15 STORAGE ARCHITECTURE
---------------------------------------------------------------------

Bucket:

fintrack-attachments

Used for:

receipt images
transaction attachments

Path structure:

family_id/
   transaction_id/
      file

---------------------------------------------------------------------
# 16 QUERY PATTERNS
---------------------------------------------------------------------

Load accounts

select * from accounts
where family_id = currentUser.family_id

Load transactions

select *
from transactions
where family_id = currentUser.family_id
order by date desc

Dashboard summary

sum income
sum expenses
calculate balance

---------------------------------------------------------------------
# 17 PERFORMANCE OPTIMIZATION
---------------------------------------------------------------------

Recommended indexes:

transactions(family_id, date)
accounts(family_id)
categories(family_id)
payees(family_id)
family_members(user_id, family_id)

Avoid:

full table scans
client‑side filtering

---------------------------------------------------------------------
# 18 DEPLOYMENT MODEL
---------------------------------------------------------------------

Developer workflow

Local development
   ↓
Git commit
   ↓
Push to GitHub
   ↓
GitHub Pages deploy
   ↓
Production PWA

Backend remains Supabase.

---------------------------------------------------------------------
# 19 TROUBLESHOOTING
---------------------------------------------------------------------

User cannot see data

Check membership

select * from family_members
where user_id = auth.uid()

User cannot see settings

Check role

select role
from family_members
where user_id = auth.uid()

Dashboard incorrect

Verify transactions aggregation.

---------------------------------------------------------------------
# 20 FUTURE ROADMAP
---------------------------------------------------------------------

Planned improvements:

• Multi‑family support
• Background job processor
• Audit logging
• Exchange rate service
• Offline sync
• Mobile optimization
• Advanced reports

---------------------------------------------------------------------
# 21 AI DEVELOPMENT GUIDELINES
---------------------------------------------------------------------

When modifying the system:

1 Never remove family_id filters
2 Maintain RLS policies
3 Avoid direct auth.users writes
4 Use supabase-js client
5 Preserve role model

Safe extension pattern:

add column
update RLS
update UI
test queries

---------------------------------------------------------------------
END OF DOCUMENT
