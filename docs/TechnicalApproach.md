# Technical Approach

React provides the dashboard. FastAPI provides the backend. Redis stores atomic temporary counters with TTL. PostgreSQL stores persistent rules and breach notifications. Fixed windows are used because they are simple, testable, and suitable for this project. Any applicable breached rule rejects the request.
