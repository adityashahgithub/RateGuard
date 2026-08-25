# RateGuard
<<<<<<< HEAD
A full-stack API Rate Limiting and Monitoring Platform built with FastAPI, React, Redis, PostgreSQL, and Docker.
=======

API Rate Limiting & Monitoring Platform.

## Quick Start
1. Install Docker Desktop and start it.
2. Open a terminal in this folder.
3. Run `docker compose up --build`
4. Open `http://localhost:5173`
5. Backend API docs: `http://localhost:8000/docs`

Stop with Ctrl+C. Reset data with `docker compose down -v`.

## Demo
Create rule: customer / CUST-ALPHA-77 / minute / 3.
Then simulate 5 requests. First 3 should be allowed and the next requests should return 429.
>>>>>>> 003f671 (Initial commit - RateGuard API rate limiting platform)
