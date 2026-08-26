import pytest
from datetime import datetime, timezone
from unittest.mock import MagicMock

from app.rate_limiter import window_key, check_request, get_usage
from app.models import Rule


class FakeRedis:
    def __init__(self):
        self.store: dict[str, int] = {}
        self.ttls: dict[str, int] = {}

    def incr(self, key: str) -> int:
        self.store[key] = self.store.get(key, 0) + 1
        return self.store[key]

    def expire(self, key: str, ttl: int) -> None:
        self.ttls[key] = ttl

    def ttl(self, key: str) -> int:
        return self.ttls.get(key, 60)

    def get(self, key: str):
        return str(self.store[key]) if key in self.store else None


def make_db(rules=None):
    db = MagicMock()
    rules = rules or []

    def scalars(stmt):
        result = MagicMock()
        result.all.return_value = rules
        return result

    db.scalars = scalars
    db.add = MagicMock()
    db.commit = MagicMock()
    db.rollback = MagicMock()
    return db


def test_window_key_minute():
    wk, ttl = window_key("minute")
    assert ttl > 0
    assert "T" in wk


def test_no_matching_rule_allowed():
    db = make_db([])
    redis = FakeRedis()
    result = check_request(db, redis, "customer", "UNKNOWN", log=False)
    assert result.allowed is True
    assert result.status == 200


def test_below_limit_allowed():
    rule = Rule(id=1, identity_type="customer", identity_value="CUST-A", period="minute", limit=3)
    db = make_db([rule])
    redis = FakeRedis()
    for _ in range(2):
        result = check_request(db, redis, "customer", "CUST-A", log=False)
        assert result.allowed is True


def test_at_limit_allowed():
    rule = Rule(id=1, identity_type="customer", identity_value="CUST-A", period="minute", limit=3)
    db = make_db([rule])
    redis = FakeRedis()
    for _ in range(3):
        result = check_request(db, redis, "customer", "CUST-A", log=False)
        assert result.allowed is True


def test_above_limit_rejected():
    rule = Rule(id=1, identity_type="customer", identity_value="CUST-A", period="minute", limit=3)
    db = make_db([rule])
    redis = FakeRedis()
    for _ in range(3):
        check_request(db, redis, "customer", "CUST-A", log=False)
    result = check_request(db, redis, "customer", "CUST-A", log=False)
    assert result.allowed is False
    assert result.status == 429
    assert result.blocked_by is not None
    assert result.blocked_by.period == "minute"


def test_different_identities_independent():
    rule = Rule(id=1, identity_type="customer", identity_value="CUST-A", period="minute", limit=2)
    db_a = make_db([rule])
    db_b = make_db([rule])
    redis = FakeRedis()
    check_request(db_a, redis, "customer", "CUST-A", log=False)
    check_request(db_a, redis, "customer", "CUST-A", log=False)
    result = check_request(db_b, redis, "customer", "CUST-B", log=False)
    assert result.allowed is True


def test_multiple_periods_both_enforced():
    minute_rule = Rule(id=1, identity_type="customer", identity_value="CUST-A", period="minute", limit=2)
    hour_rule = Rule(id=2, identity_type="customer", identity_value="CUST-A", period="hour", limit=100)
    db = make_db([minute_rule, hour_rule])
    redis = FakeRedis()
    check_request(db, redis, "customer", "CUST-A", log=False)
    check_request(db, redis, "customer", "CUST-A", log=False)
    result = check_request(db, redis, "customer", "CUST-A", log=False)
    assert result.allowed is False
    assert result.blocked_by is not None
    assert result.blocked_by.period == "minute"


def test_breach_records_notice_once_per_window():
    rule = Rule(id=1, identity_type="customer", identity_value="CUST-A", period="minute", limit=1)
    db = make_db([rule])
    redis = FakeRedis()
    commits = {"n": 0}

    def commit_side_effect():
        commits["n"] += 1
        if commits["n"] > 1:
            raise Exception("duplicate notice")

    db.commit = MagicMock(side_effect=commit_side_effect)
    check_request(db, redis, "customer", "CUST-A", log=False)
    check_request(db, redis, "customer", "CUST-A", log=False)
    result = check_request(db, redis, "customer", "CUST-A", log=False)
    assert result.allowed is False
    assert db.rollback.called


def test_get_usage_empty_when_no_rules():
    db = make_db([])
    redis = FakeRedis()
    assert get_usage(db, redis, "customer", "UNKNOWN") == []


def test_usage_reflects_counters():
    rule = Rule(id=1, identity_type="ip", identity_value="1.2.3.4", period="hour", limit=10)
    db = make_db([rule])
    redis = FakeRedis()
    check_request(db, redis, "ip", "1.2.3.4", log=False)
    check_request(db, redis, "ip", "1.2.3.4", log=False)
    usage = get_usage(db, redis, "ip", "1.2.3.4")
    assert len(usage) == 1
    assert usage[0].current_count == 2
    assert usage[0].remaining == 8
