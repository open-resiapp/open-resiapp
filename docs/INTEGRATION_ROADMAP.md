# Integration Features Roadmap

> **Status:** Planning
> **Phase A (completed):** Pairing API, external API endpoints, Settings UI (connections tab hidden in frontend)
> **This document:** Describes the dashboard features that external apps will populate through the integration API.

---

## Table of Contents

1. [Bytové družstvo (Housing cooperative)](#1-bytové-družstvo-housing-cooperative)
2. [Správca / Housekeeper (Property manager)](#2-správca--housekeeper-property-manager)
3. [Energetika / Energy company](#3-energetika--energy-company)
4. [Generic / Other](#4-generic--other)
5. [Shared Concepts](#5-shared-concepts)

---

## Existing Infrastructure (Phase A)

| Component | Status |
|-----------|--------|
| `external_connections` table | Done |
| `pairing_requests` table | Done |
| Pairing flow (`POST /api/external/v1/pair`) | Done |
| API key auth with permission levels (`read`, `read_write`, `full`) | Done |
| Read endpoints: building, stats, users, flats, votings, posts | Done |
| Settings UI — Connections tab | Done (hidden) |

---

## 1. Bytové družstvo (Housing cooperative)

Connection type: `housing_cooperative`

### 1.1 Invoices / Faktúry

**What the external app pushes:**
Monthly fee breakdowns per flat — items like repair fund contribution, operating costs, water advance, heating advance, with amounts and payment status.

**Dashboard card (Faktúry):**
- Title: "Mesačné poplatky" (Monthly fees)
- Shows: current month total, payment status (paid / unpaid / overdue), due date
- Badge: number of overdue invoices (admin view: across all flats; owner view: own flats)

**Detail view:**
- List of invoice line items grouped by month
- Filter by flat, date range, payment status
- Each line item: description, amount, paid/unpaid indicator
- Admin: overview table of all flats with payment status

**Scope:** Per flat (owners see their own; admin sees all)

**API direction:** External app → OpenResiApp (push)

**Required permission:** `read_write`

**New endpoints:**
```
POST   /api/external/v1/invoices          — bulk upsert invoices for a month
GET    /api/external/v1/invoices          — list invoices (for verification)
DELETE /api/external/v1/invoices/:id      — remove an invoice
```

**Request body (POST):**
```json
{
  "period": "2026-03",
  "invoices": [
    {
      "externalId": "INV-2026-03-101",
      "flatNumber": "101",
      "entranceAddress": "Hlavná 1",
      "dueDate": "2026-03-15",
      "totalAmount": 185.50,
      "status": "unpaid",
      "items": [
        { "description": "Fond opráv", "amount": 95.00 },
        { "description": "Prevádzkové náklady", "amount": 45.00 },
        { "description": "Záloha voda", "amount": 25.50 },
        { "description": "Záloha kúrenie", "amount": 20.00 }
      ]
    }
  ]
}
```

**DB tables:**
```
external_invoices
  id              UUID PK
  connection_id   UUID FK → external_connections.id
  external_id     VARCHAR(255) UNIQUE per connection
  flat_id         UUID FK → flats.id (nullable, matched by flat number + entrance)
  entrance_id     UUID FK → entrances.id (nullable)
  period          VARCHAR(7)   — "YYYY-MM"
  due_date        DATE
  total_amount    DECIMAL(10,2)
  status          ENUM('paid','unpaid','overdue','partial')
  items           JSONB        — array of {description, amount}
  created_at      TIMESTAMP
  updated_at      TIMESTAMP
```

---

### 1.2 Budget / Rozpočet

**What the external app pushes:**
Annual budget with fund balances — repair fund (fond opráv), operating fund (prevádzkový fond), reserve fund, and their current balances.

**Dashboard card (Rozpočet):**
- Title: "Rozpočet a fondy" (Budget & funds)
- Shows: current year, total budget amount, fund balances as a simple bar chart or list
- Visual indicator: on-track / over-budget

**Detail view:**
- Fund breakdown with current balance, planned contributions, actual contributions
- Budget categories with planned vs actual spending
- Year-over-year comparison (if historical data available)

**Scope:** Building-wide (single budget for the whole building)

**API direction:** External app → OpenResiApp (push)

**Required permission:** `read_write`

**New endpoints:**
```
POST /api/external/v1/budget           — upsert budget for a year
GET  /api/external/v1/budget           — get current budget
```

**Request body (POST):**
```json
{
  "year": 2026,
  "totalBudget": 48000.00,
  "funds": [
    { "name": "Fond opráv", "planned": 30000.00, "balance": 125430.50 },
    { "name": "Prevádzkový fond", "planned": 15000.00, "balance": 3200.00 },
    { "name": "Rezervný fond", "planned": 3000.00, "balance": 8750.00 }
  ],
  "categories": [
    { "name": "Údržba", "planned": 12000.00, "spent": 4500.00 },
    { "name": "Poistenie", "planned": 3500.00, "spent": 3500.00 },
    { "name": "Upratovanie", "planned": 6000.00, "spent": 2000.00 }
  ]
}
```

**DB tables:**
```
external_budgets
  id              UUID PK
  connection_id   UUID FK → external_connections.id
  year            INTEGER
  total_budget    DECIMAL(12,2)
  funds           JSONB        — array of {name, planned, balance}
  categories      JSONB        — array of {name, planned, spent}
  created_at      TIMESTAMP
  updated_at      TIMESTAMP
  UNIQUE(connection_id, year)
```

---

### 1.3 Transactions / Pohyby

**What the external app pushes:**
Financial transactions on the building's bank account — income (fees collected), expenses (repairs, services), transfers between funds.

**Dashboard card (Pohyby na účte):**
- Title: "Pohyby na účte" (Account transactions)
- Shows: last 5 transactions with date, description, amount (+/−), running balance
- Summary: current account balance

**Detail view:**
- Paginated transaction list with filters: date range, type (income/expense/transfer), amount range
- Monthly summary: total income, total expenses, net
- Export option (future)

**Scope:** Building-wide

**API direction:** External app → OpenResiApp (push)

**Required permission:** `read_write`

**New endpoints:**
```
POST /api/external/v1/transactions          — bulk push transactions
GET  /api/external/v1/transactions          — list transactions (verification)
```

**Request body (POST):**
```json
{
  "accountBalance": 45230.80,
  "transactions": [
    {
      "externalId": "TXN-20260301-001",
      "date": "2026-03-01",
      "type": "income",
      "amount": 185.50,
      "description": "Mesačný poplatok - byt 101",
      "category": "fees"
    }
  ]
}
```

**DB tables:**
```
external_transactions
  id              UUID PK
  connection_id   UUID FK → external_connections.id
  external_id     VARCHAR(255) UNIQUE per connection
  date            DATE
  type            ENUM('income','expense','transfer')
  amount          DECIMAL(12,2)
  description     TEXT
  category        VARCHAR(100)
  balance_after   DECIMAL(12,2) (nullable)
  created_at      TIMESTAMP
```

---

### 1.4 Utility Costs / Náklady

**What the external app pushes:**
Utility cost breakdowns — water, heating, electricity — with per-entrance or building-wide totals and per-flat allocations.

**Dashboard card (Náklady):**
- Title: "Náklady na energie" (Utility costs)
- Shows: current period totals for water, heating, electricity
- Small trend arrows (up/down vs previous period)

**Detail view:**
- Cost breakdown by utility type, by entrance (if multi-entrance building)
- Per-flat allocation table (admin only)
- Historical chart (last 12 months)

**Scope:** Per entrance or building-wide (configurable by external app)

**API direction:** External app → OpenResiApp (push)

**Required permission:** `read_write`

**New endpoints:**
```
POST /api/external/v1/utility-costs        — push cost data for a period
GET  /api/external/v1/utility-costs        — query cost data
```

**Request body (POST):**
```json
{
  "period": "2026-02",
  "scope": "entrance",
  "entranceAddress": "Hlavná 1",
  "costs": [
    { "type": "water", "amount": 1250.00, "unit": "m³", "consumption": 85.5 },
    { "type": "heating", "amount": 3400.00, "unit": "kWh", "consumption": 12500 },
    { "type": "electricity_common", "amount": 320.00, "unit": "kWh", "consumption": 800 }
  ],
  "perFlat": [
    { "flatNumber": "101", "water": 125.00, "heating": 340.00, "electricity": 32.00 }
  ]
}
```

**DB tables:**
```
external_utility_costs
  id              UUID PK
  connection_id   UUID FK → external_connections.id
  period          VARCHAR(7)
  entrance_id     UUID FK → entrances.id (nullable — null = building-wide)
  costs           JSONB        — array of {type, amount, unit, consumption}
  per_flat        JSONB        — array of {flatNumber, ...costs} (nullable)
  created_at      TIMESTAMP
  updated_at      TIMESTAMP
  UNIQUE(connection_id, period, entrance_id)
```

---

### 1.5 Planned Repairs / Plánované opravy

**What the external app pushes:**
Upcoming maintenance/repair projects funded by the cooperative — scope, estimated cost, timeline, funding source (which fund).

**Dashboard card (Plánované opravy):**
- Title: "Plánované opravy" (Planned repairs)
- Shows: next 3 upcoming repairs with name, estimated date, cost
- Progress indicator for active repairs

**Detail view:**
- Full list of planned and completed repairs
- Each entry: description, estimated/actual cost, start/end dates, status, funding source
- Filter by status (planned/in_progress/completed), year

**Scope:** Building-wide or per entrance

**API direction:** External app → OpenResiApp (push)

**Required permission:** `read_write`

**New endpoints:**
```
POST  /api/external/v1/repairs            — upsert repair records
GET   /api/external/v1/repairs            — list repairs
PATCH /api/external/v1/repairs/:id        — update status/progress
```

**Request body (POST):**
```json
{
  "repairs": [
    {
      "externalId": "REP-2026-001",
      "title": "Výmena výťahu",
      "description": "Kompletná modernizácia osobného výťahu vo vchode Hlavná 1",
      "entranceAddress": "Hlavná 1",
      "estimatedCost": 85000.00,
      "actualCost": null,
      "fundingSource": "Fond opráv",
      "status": "planned",
      "plannedStart": "2026-06-01",
      "plannedEnd": "2026-08-31"
    }
  ]
}
```

**DB tables:**
```
external_repairs
  id              UUID PK
  connection_id   UUID FK → external_connections.id
  external_id     VARCHAR(255) UNIQUE per connection
  entrance_id     UUID FK → entrances.id (nullable)
  title           VARCHAR(255)
  description     TEXT
  estimated_cost  DECIMAL(12,2)
  actual_cost     DECIMAL(12,2) (nullable)
  funding_source  VARCHAR(255)
  status          ENUM('planned','in_progress','completed','cancelled')
  planned_start   DATE
  planned_end     DATE
  actual_start    DATE (nullable)
  actual_end      DATE (nullable)
  created_at      TIMESTAMP
  updated_at      TIMESTAMP
```

---

## 2. Správca / Housekeeper (Property manager)

Connection type: `property_manager`

### 2.1 Maintenance Log / Údržba

**What the external app pushes:**
Completed and scheduled maintenance tasks — what was done, when, by whom, cost.

**Dashboard card (Údržba):**
- Title: "Údržba" (Maintenance)
- Shows: last 3 completed tasks, next scheduled task
- Badge: number of tasks completed this month

**Detail view:**
- Chronological log of all maintenance activities
- Filter by type (electrical, plumbing, general), date range, entrance
- Each entry: date, description, worker/company, cost, photos (future)

**Scope:** Per entrance or building-wide

**API direction:** External app → OpenResiApp (push)

**Required permission:** `read_write`

**New endpoints:**
```
POST /api/external/v1/maintenance          — push maintenance records
GET  /api/external/v1/maintenance          — list records
```

**Request body (POST):**
```json
{
  "records": [
    {
      "externalId": "MAINT-2026-042",
      "date": "2026-03-05",
      "type": "plumbing",
      "description": "Oprava prasknutého potrubia v suteréne",
      "entranceAddress": "Hlavná 1",
      "worker": "Ján Inštalatér s.r.o.",
      "cost": 450.00,
      "status": "completed"
    }
  ]
}
```

**DB tables:**
```
external_maintenance
  id              UUID PK
  connection_id   UUID FK → external_connections.id
  external_id     VARCHAR(255) UNIQUE per connection
  entrance_id     UUID FK → entrances.id (nullable)
  date            DATE
  type            VARCHAR(100)
  description     TEXT
  worker          VARCHAR(255)
  cost            DECIMAL(10,2) (nullable)
  status          ENUM('scheduled','in_progress','completed','cancelled')
  created_at      TIMESTAMP
  updated_at      TIMESTAMP
```

---

### 2.2 Work Orders / Pracovné príkazy

**What the external app pushes:**
Open work requests from residents or admin, with status tracking and worker assignment.

**Dashboard card (Pracovné príkazy):**
- Title: "Pracovné príkazy" (Work orders)
- Shows: number of open orders, number completed this month
- List: 3 most recent open orders with title and status

**Detail view:**
- Full list of work orders with status filter (open/assigned/in_progress/completed)
- Each order: title, description, reported by, assigned worker, priority, dates
- Status timeline (submitted → assigned → in progress → completed)

**Scope:** Per entrance or building-wide

**API direction:** Bidirectional — external app pushes status updates, OpenResiApp could create requests (future)

**Required permission:** `read_write`

**New endpoints:**
```
POST  /api/external/v1/work-orders         — push/update work orders
GET   /api/external/v1/work-orders         — list work orders
PATCH /api/external/v1/work-orders/:id     — update status
```

**Request body (POST):**
```json
{
  "orders": [
    {
      "externalId": "WO-2026-015",
      "title": "Nefunkčné svetlo na chodbe, 3. poschodie",
      "description": "Svetlo na chodbe pri byte 305 nesvieti už 3 dni",
      "entranceAddress": "Hlavná 1",
      "priority": "medium",
      "status": "assigned",
      "assignedTo": "Elektrikár Novák",
      "reportedAt": "2026-03-01",
      "dueDate": "2026-03-10"
    }
  ]
}
```

**DB tables:**
```
external_work_orders
  id              UUID PK
  connection_id   UUID FK → external_connections.id
  external_id     VARCHAR(255) UNIQUE per connection
  entrance_id     UUID FK → entrances.id (nullable)
  title           VARCHAR(255)
  description     TEXT
  priority        ENUM('low','medium','high','urgent')
  status          ENUM('open','assigned','in_progress','completed','cancelled')
  assigned_to     VARCHAR(255) (nullable)
  reported_at     DATE
  due_date        DATE (nullable)
  completed_at    TIMESTAMP (nullable)
  created_at      TIMESTAMP
  updated_at      TIMESTAMP
```

---

### 2.3 Inspections / Revízie

**What the external app pushes:**
Legally required inspections — fire safety, elevators, gas, electrical, lightning rods — with dates, results, and next due dates.

**Dashboard card (Revízie):**
- Title: "Revízie" (Inspections)
- Shows: next upcoming inspection with type and date
- Warning badge: overdue or due within 30 days (red/yellow)
- List: all inspection types with last/next dates

**Detail view:**
- Table of all inspection types with: last inspection date, result (pass/fail/conditional), next due date, inspector name
- Historical records per inspection type
- Document links (inspection reports — future integration with documents)

**Scope:** Per entrance (each entrance may have its own elevator, gas system, etc.)

**API direction:** External app → OpenResiApp (push)

**Required permission:** `read_write`

**New endpoints:**
```
POST /api/external/v1/inspections          — push inspection records
GET  /api/external/v1/inspections          — list inspections
```

**Request body (POST):**
```json
{
  "inspections": [
    {
      "externalId": "INSP-2026-ELV-01",
      "type": "elevator",
      "entranceAddress": "Hlavná 1",
      "inspectionDate": "2026-02-15",
      "result": "pass",
      "nextDueDate": "2027-02-15",
      "inspector": "TÜV SÜD Slovakia",
      "notes": "Výťah v dobrom technickom stave"
    }
  ]
}
```

**DB tables:**
```
external_inspections
  id              UUID PK
  connection_id   UUID FK → external_connections.id
  external_id     VARCHAR(255) UNIQUE per connection
  entrance_id     UUID FK → entrances.id (nullable)
  type            VARCHAR(100)   — elevator, fire_safety, gas, electrical, lightning_rod
  inspection_date DATE
  result          ENUM('pass','fail','conditional')
  next_due_date   DATE
  inspector       VARCHAR(255)
  notes           TEXT (nullable)
  created_at      TIMESTAMP
  updated_at      TIMESTAMP
```

---

### 2.4 Cleaning Schedule / Upratovanie

**What the external app pushes:**
Cleaning schedule and completion confirmations — regular cleaning of common areas.

**Dashboard card (Upratovanie):**
- Title: "Upratovanie" (Cleaning)
- Shows: last cleaning date, next scheduled date
- Status: completed on time / missed / upcoming

**Detail view:**
- Calendar view of cleaning schedule
- History of completed cleanings with date and confirmation
- Filter by entrance

**Scope:** Per entrance

**API direction:** External app → OpenResiApp (push)

**Required permission:** `read_write`

**New endpoints:**
```
POST /api/external/v1/cleaning             — push schedule and completions
GET  /api/external/v1/cleaning             — get schedule
```

**Request body (POST):**
```json
{
  "schedule": [
    {
      "externalId": "CLN-2026-W10-H1",
      "entranceAddress": "Hlavná 1",
      "scheduledDate": "2026-03-09",
      "type": "regular",
      "status": "completed",
      "completedAt": "2026-03-09T08:30:00Z"
    }
  ]
}
```

**DB tables:**
```
external_cleaning
  id              UUID PK
  connection_id   UUID FK → external_connections.id
  external_id     VARCHAR(255) UNIQUE per connection
  entrance_id     UUID FK → entrances.id (nullable)
  scheduled_date  DATE
  type            VARCHAR(50)    — regular, deep_clean, seasonal
  status          ENUM('scheduled','completed','missed','cancelled')
  completed_at    TIMESTAMP (nullable)
  created_at      TIMESTAMP
  updated_at      TIMESTAMP
```

---

## 3. Energetika / Energy company

Connection type: `energy_company`

### 3.1 Consumption / Spotreba

**What the external app pushes:**
Energy consumption data — electricity, gas, heat — with trends and comparisons.

**Dashboard card (Spotreba):**
- Title: "Spotreba energií" (Energy consumption)
- Shows: current month consumption per utility type
- Trend: comparison to same month last year (arrow + percentage)

**Detail view:**
- Line/bar charts: monthly consumption over the last 12–24 months
- Breakdown by utility type (electricity, gas, heat)
- Per-entrance comparison (if multi-entrance building)
- Table view with exact numbers

**Scope:** Per entrance or building-wide

**API direction:** External app → OpenResiApp (push)

**Required permission:** `read_write`

**New endpoints:**
```
POST /api/external/v1/consumption          — push consumption data
GET  /api/external/v1/consumption          — query consumption
```

**Request body (POST):**
```json
{
  "period": "2026-02",
  "scope": "entrance",
  "entranceAddress": "Hlavná 1",
  "readings": [
    { "type": "electricity", "value": 2450, "unit": "kWh" },
    { "type": "gas", "value": 850, "unit": "m³" },
    { "type": "heat", "value": 15200, "unit": "kWh" }
  ]
}
```

**DB tables:**
```
external_consumption
  id              UUID PK
  connection_id   UUID FK → external_connections.id
  period          VARCHAR(7)
  entrance_id     UUID FK → entrances.id (nullable)
  readings        JSONB        — array of {type, value, unit}
  created_at      TIMESTAMP
  updated_at      TIMESTAMP
  UNIQUE(connection_id, period, entrance_id)
```

---

### 3.2 Meter Readings / Odpočty

**What the external app pushes:**
Meter reading history — periodic readings from water, gas, heat, electricity meters.

**Dashboard card (Odpočty):**
- Title: "Odpočty meračov" (Meter readings)
- Shows: date of last reading, next scheduled reading
- Count of meters read vs total meters

**Detail view:**
- Table of all meters: location (entrance, flat), type, last reading value, date
- Reading history per meter
- Upcoming scheduled readings

**Scope:** Per entrance (meters are typically per entrance or per flat)

**API direction:** External app → OpenResiApp (push)

**Required permission:** `read_write`

**New endpoints:**
```
POST /api/external/v1/meter-readings       — push meter readings
GET  /api/external/v1/meter-readings       — query readings
```

**Request body (POST):**
```json
{
  "readings": [
    {
      "externalId": "MTR-H1-WATER-2026-03",
      "meterId": "WM-001",
      "meterType": "cold_water",
      "entranceAddress": "Hlavná 1",
      "flatNumber": "101",
      "readingDate": "2026-03-01",
      "value": 1234.56,
      "unit": "m³",
      "readingType": "regular"
    }
  ]
}
```

**DB tables:**
```
external_meter_readings
  id              UUID PK
  connection_id   UUID FK → external_connections.id
  external_id     VARCHAR(255) UNIQUE per connection
  meter_id        VARCHAR(100)
  meter_type      VARCHAR(50)    — cold_water, hot_water, gas, electricity, heat
  entrance_id     UUID FK → entrances.id (nullable)
  flat_id         UUID FK → flats.id (nullable)
  reading_date    DATE
  value           DECIMAL(12,3)
  unit            VARCHAR(20)
  reading_type    VARCHAR(50)    — regular, check, move_in, move_out
  created_at      TIMESTAMP
```

---

### 3.3 Billing / Vyúčtovanie

**What the external app pushes:**
Annual energy settlement statements — the final billing that shows actual vs advance payments per flat.

**Dashboard card (Vyúčtovanie):**
- Title: "Ročné vyúčtovanie" (Annual settlement)
- Shows: latest settlement year, result (overpayment/underpayment), amount
- Owner view: own flat result; Admin view: building summary

**Detail view:**
- Per-flat settlement table: advances paid, actual cost, difference (+ overpayment / − underpayment)
- Breakdown by cost type (water, heating, electricity)
- Historical comparison (last 3 years)

**Scope:** Per flat (individual billing), summarized per entrance/building

**API direction:** External app → OpenResiApp (push)

**Required permission:** `read_write`

**New endpoints:**
```
POST /api/external/v1/settlements          — push annual settlement data
GET  /api/external/v1/settlements          — query settlements
```

**Request body (POST):**
```json
{
  "year": 2025,
  "settlements": [
    {
      "externalId": "SETT-2025-101",
      "flatNumber": "101",
      "entranceAddress": "Hlavná 1",
      "totalAdvances": 2400.00,
      "totalActual": 2180.50,
      "difference": 219.50,
      "items": [
        { "type": "water", "advance": 600.00, "actual": 550.00, "difference": 50.00 },
        { "type": "heating", "advance": 1500.00, "actual": 1380.50, "difference": 119.50 },
        { "type": "electricity_common", "advance": 300.00, "actual": 250.00, "difference": 50.00 }
      ]
    }
  ]
}
```

**DB tables:**
```
external_settlements
  id              UUID PK
  connection_id   UUID FK → external_connections.id
  external_id     VARCHAR(255) UNIQUE per connection
  flat_id         UUID FK → flats.id (nullable)
  entrance_id     UUID FK → entrances.id (nullable)
  year            INTEGER
  total_advances  DECIMAL(10,2)
  total_actual    DECIMAL(10,2)
  difference      DECIMAL(10,2)
  items           JSONB        — array of {type, advance, actual, difference}
  created_at      TIMESTAMP
  updated_at      TIMESTAMP
  UNIQUE(connection_id, year, flat_id)
```

---

## 4. Generic / Other

Connection type: any (custom)

### 4.1 Custom Cards / Vlastné karty

**What the external app pushes:**
Informational cards that appear on the dashboard — any connected app can push these. Used for announcements from the cooperative, alerts from the property manager, or any data that doesn't fit the specific feature categories above.

**Dashboard card:**
- Rendered in a "Connected apps" section of the dashboard
- Each card shows: app icon/name, title, short content (max 200 chars), optional link
- Cards can have a priority (info / warning / urgent) which affects styling
- Cards can have an expiry date after which they disappear

**Detail view:**
- Click opens full content (supports basic markdown)
- Shows source app name and publication date
- Optional external link button

**Scope:** Building-wide or per entrance

**API direction:** External app → OpenResiApp (push)

**Required permission:** `read_write`

**New endpoints:**
```
POST   /api/external/v1/cards              — create/update cards
GET    /api/external/v1/cards              — list own cards
DELETE /api/external/v1/cards/:id          — remove a card
```

**Request body (POST):**
```json
{
  "cards": [
    {
      "externalId": "CARD-2026-001",
      "title": "Odstávka teplej vody",
      "content": "Dňa 15.3.2026 bude od 8:00 do 14:00 odstávka teplej vody z dôvodu údržby.",
      "fullContent": "## Plánovaná odstávka\n\nDňa **15.3.2026** bude...",
      "priority": "warning",
      "entranceAddress": null,
      "externalUrl": "https://example.com/notice/123",
      "expiresAt": "2026-03-16T00:00:00Z"
    }
  ]
}
```

**DB tables:**
```
external_cards
  id              UUID PK
  connection_id   UUID FK → external_connections.id
  external_id     VARCHAR(255) UNIQUE per connection
  entrance_id     UUID FK → entrances.id (nullable — null = building-wide)
  title           VARCHAR(255)
  content         VARCHAR(500)     — short summary for dashboard card
  full_content    TEXT (nullable)  — markdown, shown on detail view
  priority        ENUM('info','warning','urgent')  DEFAULT 'info'
  external_url    VARCHAR(2048) (nullable)
  expires_at      TIMESTAMP (nullable)
  created_at      TIMESTAMP
  updated_at      TIMESTAMP
```

---

## 5. Shared Concepts

### 5.1 Flat & Entrance Matching

External apps reference flats and entrances by address/number strings (e.g., `"entranceAddress": "Hlavná 1"`, `"flatNumber": "101"`). OpenResiApp resolves these to internal UUIDs during ingestion:

1. Match `entranceAddress` against `entrances.address`
2. Match `flatNumber` against `flats.number` within the matched entrance
3. If no match: store the record with `entrance_id = NULL` / `flat_id = NULL` and flag for admin review

Unmatched records should be visible in the admin Settings → Connections → Data issues tab (future).

### 5.2 Dashboard Layout

Integration cards appear in a dedicated section on the dashboard, below the core features (announcements, voting). Layout:

```
┌─────────────────────────────────────────────┐
│  Dashboard                                  │
├─────────────────────────────────────────────┤
│  [Announcements / Nástenka]                 │
│  [Active Votings / Hlasovania]              │
├─────────────────────────────────────────────┤
│  Connected: Bytové družstvo XY              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │ Faktúry  │ │ Rozpočet │ │ Pohyby   │    │
│  │ €185.50  │ │ €48,000  │ │ +€185.50 │    │
│  │ Unpaid:2 │ │ On track │ │ last txn │    │
│  └──────────┘ └──────────┘ └──────────┘    │
│  ┌──────────┐ ┌──────────┐                  │
│  │ Náklady  │ │ Opravy   │                  │
│  │ Water:€X │ │ Next: .. │                  │
│  └──────────┘ └──────────┘                  │
├─────────────────────────────────────────────┤
│  Connected: Správca ABC                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │ Údržba   │ │ Príkazy  │ │ Revízie  │    │
│  └──────────┘ └──────────┘ └──────────┘    │
└─────────────────────────────────────────────┘
```

Cards are grouped by connected app. Only features with actual data are shown.

### 5.3 Permission Model

The existing `api_key_permission` enum controls what external apps can do:

| Level | Can do |
|-------|--------|
| `read` | Read building data, users, flats, votings, posts (existing endpoints) |
| `read_write` | All of `read` + push data to integration endpoints (invoices, budget, etc.) |
| `full` | All of `read_write` + create posts, modify users (existing endpoints) |

All new integration push endpoints require `read_write` or `full`.

### 5.4 Data Lifecycle

- External apps push data; OpenResiApp does not modify it
- When a connection is deactivated, its data remains visible but is marked as "from disconnected app"
- When a connection is deleted, the admin chooses: keep data (orphaned) or delete all associated data
- Each record has `external_id` unique per connection — upserting the same `external_id` updates the record

### 5.5 New DB Tables Summary

| Table | Feature | Rows per |
|-------|---------|----------|
| `external_invoices` | Invoices | flat × month |
| `external_budgets` | Budget | year |
| `external_transactions` | Transactions | transaction |
| `external_utility_costs` | Utility costs | entrance × month |
| `external_repairs` | Planned repairs | repair project |
| `external_maintenance` | Maintenance log | maintenance event |
| `external_work_orders` | Work orders | work order |
| `external_inspections` | Inspections | inspection event |
| `external_cleaning` | Cleaning schedule | cleaning event |
| `external_consumption` | Energy consumption | entrance × month |
| `external_meter_readings` | Meter readings | meter × reading |
| `external_settlements` | Annual billing | flat × year |
| `external_cards` | Custom cards | card |

Total: **13 new tables** (all prefixed with `external_`).

### 5.6 Implementation Priority

Suggested order based on user value and complexity:

1. **Custom cards** — simplest, immediate value for any connection type
2. **Invoices** — highest demand from residents
3. **Inspections** — safety compliance, high admin value
4. **Budget & Transactions** — financial transparency
5. **Utility costs & Consumption** — energy management
6. **Maintenance & Work orders** — property management workflow
7. **Cleaning schedule** — low complexity, nice-to-have
8. **Meter readings & Settlements** — complex, annual cycle
9. **Planned repairs** — project-level tracking
