import asyncio
import json
import os
from datetime import datetime, timezone
from typing import Any

import redis
from fastapi import FastAPI, HTTPException, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, delete, desc, func, select
from sqlalchemy.orm import sessionmaker

from .models import Base, Notice, RequestLog, Rule
from .rate_limiter import check_request, get_usage
from .schemas import CheckIn, RuleIn, SimIn

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+psycopg://rateguard:rateguard@localhost:5432/rateguard")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

engine = create_engine(DATABASE_URL)
Session = sessionmaker(bind=engine)
redis_client = redis.Redis.from_url(REDIS_URL, decode_responses=True)

Base.metadata.create_all(engine)

app = FastAPI(
    title="RateGuard",
    description="API Rate Limiting & Monitoring Platform",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class LiveHub:
    def __init__(self) -> None:
        self.connections: list[WebSocket] = []

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.connections.append(ws)

    def disconnect(self, ws: WebSocket) -> None:
        if ws in self.connections:
            self.connections.remove(ws)

    async def broadcast(self, event: dict[str, Any]) -> None:
        payload = json.dumps({**event, "ts": datetime.now(timezone.utc).isoformat()})
        dead: list[WebSocket] = []
        for ws in self.connections:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


hub = LiveHub()


def rule_dict(rule: Rule) -> dict[str, Any]:
    return {
        "id": rule.id,
        "identity_type": rule.identity_type,
        "identity_value": rule.identity_value,
        "period": rule.period,
        "limit": rule.limit,
    }


@app.get("/health")
def health() -> dict[str, Any]:
    redis_ok = False
    db_ok = False
    try:
        redis_ok = bool(redis_client.ping())
    except Exception:
        pass
    try:
        with Session() as db:
            db.scalar(select(func.count()).select_from(Rule))
            db_ok = True
    except Exception:
        pass
    return {
        "status": "ok" if redis_ok and db_ok else "degraded",
        "redis": redis_ok,
        "postgres": db_ok,
    }


@app.post("/admin/reset")
async def reset_counters() -> dict[str, str]:
    """Clear Redis counters and activity logs for a fresh demo run."""
    deleted = 0
    for key in redis_client.scan_iter("rate:*"):
        redis_client.delete(key)
        deleted += 1
    with Session() as db:
        db.execute(delete(RequestLog))
        db.execute(delete(Notice))
        db.commit()
    await hub.broadcast({"type": "demo_reset", "data": {"counters_cleared": deleted}})
    return {"message": "Counters and logs reset — rules preserved", "counters_cleared": str(deleted)}


@app.get("/admin/stats")
def stats() -> dict[str, Any]:
    with Session() as db:
        total_rules = db.scalar(select(func.count()).select_from(Rule)) or 0
        total_breaches = db.scalar(select(func.count()).select_from(Notice)) or 0
        total_requests = db.scalar(select(func.count()).select_from(RequestLog)) or 0
        allowed = db.scalar(
            select(func.count()).select_from(RequestLog).where(RequestLog.allowed == 1)
        ) or 0
        blocked = total_requests - allowed
        return {
            "total_rules": total_rules,
            "total_breaches": total_breaches,
            "total_requests": total_requests,
            "allowed_requests": allowed,
            "blocked_requests": blocked,
            "block_rate": round((blocked / total_requests * 100) if total_requests else 0, 1),
        }


@app.get("/admin/rules")
def list_rules() -> list[dict[str, Any]]:
    with Session() as db:
        rules = db.scalars(select(Rule).order_by(desc(Rule.id))).all()
        return [rule_dict(r) for r in rules]


@app.post("/admin/rules", status_code=201)
async def create_rule(body: RuleIn) -> dict[str, Any]:
    with Session() as db:
        exists = db.scalar(
            select(Rule).where(
                Rule.identity_type == body.identity_type,
                Rule.identity_value == body.identity_value,
                Rule.period == body.period,
            )
        )
        if exists:
            raise HTTPException(status_code=409, detail="Duplicate rule for this identity and period")
        rule = Rule(**body.model_dump())
        db.add(rule)
        db.commit()
        db.refresh(rule)
        payload = rule_dict(rule)
        await hub.broadcast({"type": "rule_created", "data": payload})
        return {"id": rule.id, "message": "Rate limit rule created", "rule": payload}


@app.delete("/admin/rules/{rule_id}")
async def delete_rule(rule_id: int) -> dict[str, str]:
    with Session() as db:
        rule = db.get(Rule, rule_id)
        if not rule:
            raise HTTPException(status_code=404, detail="Rule not found")
        payload = rule_dict(rule)
        db.delete(rule)
        db.commit()
        await hub.broadcast({"type": "rule_deleted", "data": payload})
        return {"message": "Rule deleted"}


@app.get("/admin/notifications")
def list_notifications() -> list[dict[str, Any]]:
    with Session() as db:
        notices = db.scalars(select(Notice).order_by(desc(Notice.id)).limit(100)).all()
        return [
            {
                "id": n.id,
                "identity_type": n.identity_type,
                "identity_value": n.identity_value,
                "period": n.period,
                "message": n.message,
                "created_at": n.created_at.isoformat(),
            }
            for n in notices
        ]


@app.get("/admin/usage/{identity_type}/{identity_value}")
def usage(identity_type: str, identity_value: str) -> list[dict[str, Any]]:
    with Session() as db:
        items = get_usage(db, redis_client, identity_type, identity_value)
        return [i.model_dump() for i in items]


@app.get("/admin/activity")
def activity(limit: int = 50) -> list[dict[str, Any]]:
    with Session() as db:
        logs = db.scalars(select(RequestLog).order_by(desc(RequestLog.id)).limit(min(limit, 200))).all()
        return [
            {
                "id": log.id,
                "identity_type": log.identity_type,
                "identity_value": log.identity_value,
                "allowed": bool(log.allowed),
                "status_code": log.status_code,
                "blocked_period": log.blocked_period,
                "created_at": log.created_at.isoformat(),
            }
            for log in logs
        ]


@app.post("/check")
async def check(body: CheckIn, response: Response) -> dict[str, Any]:
    with Session() as db:
        result = check_request(db, redis_client, body.identity_type, body.identity_value)
        if not result.allowed and result.blocked_by:
            response.status_code = 429
            response.headers["Retry-After"] = str(result.blocked_by.retry_after)
        payload = {
            "type": "request_checked",
            "data": {
                "identity_type": body.identity_type,
                "identity_value": body.identity_value,
                **result.model_dump(),
            },
        }
        await hub.broadcast(payload)
        if not result.allowed:
            await hub.broadcast({"type": "breach", "data": payload["data"]})
        return result.model_dump()


@app.post("/simulate")
async def simulate(body: SimIn) -> dict[str, Any]:
    results = []
    with Session() as db:
        for num in range(1, body.count + 1):
            result = check_request(db, redis_client, body.identity_type, body.identity_value)
            item = {
                "request": num,
                "status": result.status,
                "allowed": result.allowed,
                "blocked_by": result.blocked_by.model_dump() if result.blocked_by else None,
            }
            results.append(item)
            event = {
                "type": "simulation_request",
                "data": {
                    "identity_type": body.identity_type,
                    "identity_value": body.identity_value,
                    **item,
                },
            }
            await hub.broadcast(event)
            if not result.allowed:
                await hub.broadcast({"type": "breach", "data": event["data"]})
            await asyncio.sleep(0.05)
    return {"results": results}


@app.websocket("/ws/live")
async def live_feed(ws: WebSocket) -> None:
    await hub.connect(ws)
    try:
        await ws.send_text(
            json.dumps(
                {
                    "type": "connected",
                    "message": "RateGuard live feed connected",
                    "ts": datetime.now(timezone.utc).isoformat(),
                }
            )
        )
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        hub.disconnect(ws)
