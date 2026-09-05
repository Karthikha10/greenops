# GreenOps — Phase 1 (Observability & Resource Intelligence Foundation)

This is a working implementation of Phase 1 from the GreenOps phased plan:
**"What is happening, across every resource type?"**

It covers, with zero external services required to run:

- 4 telemetry domains: **server, power, cooling, storage** (simulated, standing in for real monitoring APIs — see "Data Provenance" below)
- FastAPI ingestion with Pydantic validation
- SQLite database via SQLAlchemy (swap to PostgreSQL by changing one env var)
- Live-computed **PUE, WUE, energy, cost, carbon** — pure formulas, no ML needed
- **Rule-based flags**: idle servers, stale data, duplicate data, over-provisioned storage
- **Per-server-type idle thresholds**, statistically derived from the real dataset — not one flat number for every server (see "Per-Type Thresholds" below)
- Historical analytics endpoints
- **Two ML models trained on the real "Green AI Data Center Telemetry" dataset**: CPU estimation and power estimation, comparing **Linear Regression, Random Forest, and XGBoost** via MAE/RMSE/R²
- A **React dashboard** (Vite, react-router, recharts) covering: Overview, Servers, Server Detail, Storage Optimization, Analytics, Model Evaluation

**Not included** (this is Phase 2, by design): forecasting, what-if simulation, sustainability impact ranking, the recommendation engine, Preferences, ESG report export. See the phased plan document for that scope.

---

## 1. Setup — backend

Requires Python 3.10+.

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt

venv\Scripts\Activate.ps1
```

## 2. Compute per-type thresholds (one-time)

```bash
cd backend
python -m app.compute_thresholds
```

Reads `app/data/green_ai_datacenter.csv` and computes, per `server_type`, an idle CPU threshold (`mean - 1.5×std`, clamped to [5, 35]) and a severity weight (scaled to that type's average power draw). Saves to `app/data/type_thresholds.json`. This replaces the old flat "20% for everyone" rule — a GPU server and an Edge server now get different, statistically grounded cutoffs, and an idle GPU server is flagged as higher-priority waste than an idle Edge server at the same CPU%, since GPU hardware draws roughly 40% more power on average in the real dataset.

## 3. Train the CPU + power estimation models (one-time, ~15 seconds)

```bash
cd backend
python -m app.train_model
```

Trains **three candidate algorithms — Linear Regression, Random Forest, and XGBoost** — for both the CPU model and the power model, using the real dataset.

**Selection rule:** lowest MAE wins by default, but a more complex model (Random Forest / XGBoost) must beat Linear Regression by at least **5% relative MAE improvement** to be selected over it. This keeps the simpler, more explainable model unless the complexity genuinely earns its place — on this dataset, Linear Regression wins both targets, and the metrics endpoint states why.

**Honest result on the real data:** the CPU model performs well (R² ≈ 0.84), but the power model is noticeably weaker (R² ≈ 0.39–0.42 across all three algorithms) — a real finding from the dataset, not a bug. It means `power_consumption_kw` depends on factors beyond what these features explain as well as they explain CPU.

## 4. Start the backend API

```bash
cd backend
uvicorn app.main:app --reload
```

API docs: http://localhost:8000/docs

## 5. Start the simulators (each in its own terminal)

```bash
cd simulators
python server_monitor.py
python power_monitor.py
python cooling_monitor.py
python storage_monitor.py
```

Leave these running — S3 (GPU) and S5 (Edge) are biased toward idle CPU, and S4 toward messy storage, so the flags have something real to catch within a couple of minutes. Server types now match the real dataset's categories (Compute, Edge, GPU, Storage) so the per-type thresholds actually apply.

## 6. Start the React frontend

```bash
cd frontend
npm install
npm run dev
```

Open the URL Vite prints (typically http://localhost:5173). The frontend expects the API at `http://localhost:8000` (see `src/api.js` if you need to change this).

A static, no-build-step version of the old dashboard is kept in `frontend-static-legacy/` for reference, but the React app in `frontend/` is the primary UI going forward.


---

## Per-Type Idle Thresholds — why this replaces the flat 20% rule

A single global CPU threshold ignores that different server types have different normal operating ranges, and that the *cost* of being idle differs by type. The real dataset shows:

| Server type | Avg power draw | Idle threshold (dataset-derived) | Severity weight |
|---|---|---|---|
| GPU | 110.5 kW | 16.9% | 1.66x |
| Compute | 81.0 kW | 17.3% | 1.22x |
| Storage | 70.6 kW | 16.8% | 1.06x |
| Edge | 66.5 kW | 18.9% | 1.0x (baseline) |

An idle GPU server wastes roughly 66% more power than an idle Edge server at the same CPU% — so the rule engine flags it at higher severity, not identically. See `app/compute_thresholds.py` for the exact method and `GET /thresholds` for the live table.

---

## Data Provenance (important — read before a demo/panel)

**Live telemetry is simulated.** `server_monitor.py`, `power_monitor.py`, `cooling_monitor.py`, and `storage_monitor.py` generate realistic synthetic readings because production data-center access isn't available for this project. In a real deployment, these scripts would be replaced by real integrations — Prometheus node-exporter, hypervisor APIs, smart PDUs/BMS, and cloud storage metadata APIs (e.g. AWS S3 Storage Lens) — without changing anything in the FastAPI/database layer, since it only cares about receiving the same JSON shape.

**The ML models are trained on the real "Green AI Data Center Telemetry" dataset** (`backend/app/data/green_ai_datacenter.csv`, 10,000 rows), not on the live simulator output — because ML needs months/years of historical examples that a freshly-started simulator hasn't accumulated. This dataset is separate from the live simulators and connected to them only by matching schema (same column names/meanings). In a real deployment, this would be replaced by the organization's own historical telemetry exports.

**Water and carbon figures are estimates**, not measurements. There's no real facility water meter or live grid carbon-intensity feed wired in — `rules_engine.py` uses published industry-average WUE factors by cooling type, and `main.py` uses a placeholder carbon-intensity constant. Both are clearly labeled as such in the code and should be swapped for real regional data in a production deployment.

---

## Project structure

```
greenops_phase1/
├── backend/
│   ├── app/
│   │   ├── main.py                # FastAPI app, all endpoints
│   │   ├── models.py              # SQLAlchemy tables (4 telemetry + flags)
│   │   ├── schemas.py             # Pydantic validation schemas
│   │   ├── database.py            # DB connection (SQLite, swappable to Postgres)
│   │   ├── rules_engine.py        # Idle-server / storage rules, PUE/WUE math, per-type thresholds
│   │   ├── compute_thresholds.py  # Derives per-server-type idle thresholds from the dataset
│   │   ├── train_model.py         # ML training (Linear/RF/XGBoost, CPU + power models)
│   │   ├── data/
│   │   │   ├── green_ai_datacenter.csv   # Real dataset (10,000 rows)
│   │   │   └── type_thresholds.json      # Generated by compute_thresholds.py
│   │   └── ml_artifacts/          # Generated by train_model.py (models + metrics.json)
│   └── requirements.txt
├── simulators/
│   ├── server_monitor.py          # Types now match dataset: Compute, Edge, GPU, Storage
│   ├── power_monitor.py
│   ├── cooling_monitor.py
│   └── storage_monitor.py
├── frontend/                      # React app (Vite + react-router + recharts) — primary UI
│   ├── src/
│   │   ├── api.js
│   │   ├── App.jsx
│   │   ├── Layout.jsx
│   │   ├── index.css
│   │   └── pages/
│   │       ├── Overview.jsx
│   │       ├── Servers.jsx
│   │       ├── ServerDetail.jsx
│   │       ├── Storage.jsx
│   │       ├── Analytics.jsx
│   │       └── ModelEval.jsx
│   └── package.json
├── frontend-static-legacy/        # Old single-file HTML dashboard, kept for reference
└── README.md
```

## Swapping SQLite for PostgreSQL later

```bash
export DATABASE_URL="postgresql://user:password@localhost:5432/greenops"
```

No code changes needed — `database.py` reads this automatically.

## API quick reference

| Endpoint | Purpose |
|---|---|
| `POST /telemetry/server` | Ingest server telemetry |
| `POST /telemetry/power` | Ingest power telemetry |
| `POST /telemetry/cooling` | Ingest cooling telemetry |
| `POST /telemetry/storage` | Ingest storage telemetry |
| `GET /servers` | Current state of all servers |
| `GET /servers/{id}/history` | Historical telemetry for one server |
| `GET /servers/{id}/prediction` | ML CPU + power estimate vs measured |
| `GET /flags` | All active rule-based flags |
| `GET /storage/flags` | Storage-specific flags only |
| `GET /thresholds` | Per-server-type idle thresholds + severity weights |
| `GET /analytics/summary` | PUE, WUE, energy, cost, carbon overview |
| `GET /analytics/history` | Fleet-wide time series for charts |
| `GET /model/evaluation` | 3-model comparison metrics (CPU + power) |

