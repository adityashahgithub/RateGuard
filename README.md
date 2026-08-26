# RateGuard

**API Rate Limiting & Monitoring Platform** — a full-stack demo built for technical interviews.

Configure rate limits by **IP**, **domain**, or **customer** across **minute**, **hour**, and **day** windows. Exceeding a limit returns **HTTP 429** and triggers real-time breach notifications.

## What Makes This Stand Out

- **Live WebSocket event stream** — watch requests, breaches, and rule changes in real time
- **Guided interview demo** — one-click walkthrough (create rule → simulate 5 requests → see 429s)
- **Quota usage meters** — visual progress bars with countdown to window reset
- **Production-style stack** — React + FastAPI + Redis (atomic counters) + PostgreSQL (rules & alerts)
- **Fixed-window rate limiting** — simple, testable, and interview-friendly

## Quick Start

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and start it.
2. Open a terminal in this folder.
3. Run:

```bash
docker compose up --build
```

4. Open **http://localhost:5173**
5. Click **Run Interview Demo** to see the full flow instantly.
6. API docs: **http://localhost:8000/docs**

Stop with `Ctrl+C`. Reset all data with:

```bash
docker compose down -v
```

## Manual Demo Flow

1. Go to **Rules** → create: `customer` / `CUST-ALPHA-77` / `minute` / `3`
2. Go to **Simulator** → fire 5 requests for the same customer
3. First 3 return **200**, requests 4–5 return **429**
4. Check **Dashboard** for breach alerts and live event stream

## Architecture

| Layer      | Tech                          | Role                                      |
|------------|-------------------------------|-------------------------------------------|
| Frontend   | React + TypeScript + Vite     | Admin dashboard, simulator, live monitor  |
| Backend    | FastAPI                       | Rule CRUD, rate check, simulation         |
| Counters   | Redis                         | Atomic INCR + TTL per fixed window        |
| Persistence| PostgreSQL                    | Rules, breach notifications, request log  |
| Real-time  | WebSocket                     | Live event broadcast to dashboard         |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/admin/rules` | List all rules |
| POST | `/admin/rules` | Create a rule |
| DELETE | `/admin/rules/{id}` | Delete a rule |
| GET | `/admin/notifications` | Breach alerts |
| GET | `/admin/stats` | Dashboard statistics |
| GET | `/admin/activity` | Recent request log |
| GET | `/admin/usage/{type}/{value}` | Current quota usage |
| POST | `/admin/reset` | Reset counters & logs (keep rules) |
| POST | `/check` | Single request rate check |
| POST | `/simulate` | Batch request simulation |
| WS | `/ws/live` | Real-time event stream |

## Run Tests

```bash
cd backend && pip install -r requirements.txt && pytest -v
```

## Resume Talking Points

- Designed a **multi-identity rate limiting engine** (IP / domain / customer) with independent fixed-window counters
- Used **Redis INCR + EXPIRE** for atomic, TTL-backed counters; PostgreSQL for durable rules and deduplicated breach notifications
- Built a **real-time monitoring dashboard** with WebSocket live feed — not just CRUD, but observability
- Enforces **all matching rules**; returns 429 on any breach; no rule = allow

## Project Structure

```
RateGuard/
├── backend/app/          # FastAPI application
├── backend/tests/        # Unit tests
├── frontend/src/         # React dashboard
├── docs/                 # Requirements & approach
└── docker-compose.yml    # One-command startup
```
