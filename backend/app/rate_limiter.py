from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.orm import Session
import redis

from .models import Rule, Notice, RequestLog
from .schemas import BlockInfo, CheckResult, UsageItem


def window_key(period: str) -> tuple[str, int]:
    now = datetime.now(timezone.utc)
    if period == "minute":
        start = now.replace(second=0, microsecond=0)
        seconds = 60
    elif period == "hour":
        start = now.replace(minute=0, second=0, microsecond=0)
        seconds = 3600
    else:
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        seconds = 86400
    ttl = max(1, int(seconds - (now - start).total_seconds()))
    return start.isoformat(), ttl


def counter_key(rule_id: int, identity_value: str, wk: str) -> str:
    return f"rate:{rule_id}:{identity_value}:{wk}"


def check_request(
    db: Session,
    redis_client: redis.Redis,
    identity_type: str,
    identity_value: str,
    *,
    log: bool = True,
) -> CheckResult:
    rules = db.scalars(
        select(Rule).where(
            Rule.identity_type == identity_type,
            Rule.identity_value == identity_value,
        )
    ).all()

    if not rules:
        if log:
            db.add(
                RequestLog(
                    identity_type=identity_type,
                    identity_value=identity_value,
                    allowed=1,
                    status_code=200,
                )
            )
            db.commit()
        return CheckResult(allowed=True, status=200)

    blocked: BlockInfo | None = None
    for rule in rules:
        wk, ttl = window_key(rule.period)
        key = counter_key(rule.id, identity_value, wk)
        count = redis_client.incr(key)
        if count == 1:
            redis_client.expire(key, ttl)
        if count > rule.limit:
            blocked = BlockInfo(
                period=rule.period,
                limit=rule.limit,
                current_count=count,
                retry_after=redis_client.ttl(key),
            )
            notice = Notice(
                rule_id=rule.id,
                identity_type=rule.identity_type,
                identity_value=identity_value,
                period=rule.period,
                window_key=wk,
                message=(
                    f"Rate limit breached: {identity_type}={identity_value}, "
                    f"period={rule.period}, limit={rule.limit}"
                ),
            )
            db.add(notice)
            try:
                db.commit()
            except Exception:
                db.rollback()
            break

    if log:
        db.add(
            RequestLog(
                identity_type=identity_type,
                identity_value=identity_value,
                allowed=0 if blocked else 1,
                status_code=429 if blocked else 200,
                blocked_period=blocked.period if blocked else None,
            )
        )
        db.commit()

    if blocked:
        return CheckResult(allowed=False, status=429, blocked_by=blocked)
    return CheckResult(allowed=True, status=200)


def get_usage(
    db: Session,
    redis_client: redis.Redis,
    identity_type: str,
    identity_value: str,
) -> list[UsageItem]:
    rules = db.scalars(
        select(Rule).where(
            Rule.identity_type == identity_type,
            Rule.identity_value == identity_value,
        )
    ).all()
    items: list[UsageItem] = []
    for rule in rules:
        wk, ttl = window_key(rule.period)
        key = counter_key(rule.id, identity_value, wk)
        raw = redis_client.get(key)
        count = int(raw) if raw else 0
        items.append(
            UsageItem(
                rule_id=rule.id,
                period=rule.period,
                limit=rule.limit,
                current_count=count,
                remaining=max(0, rule.limit - count),
                window_key=wk,
                retry_after=redis_client.ttl(key) if count else ttl,
            )
        )
    return items
