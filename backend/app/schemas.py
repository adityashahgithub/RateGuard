from typing import Literal
from pydantic import BaseModel, Field


Identity = Literal["ip", "domain", "customer"]
Period = Literal["minute", "hour", "day"]


class RuleIn(BaseModel):
    identity_type: Identity
    identity_value: str = Field(min_length=1, max_length=255)
    period: Period
    limit: int = Field(gt=0, le=1_000_000)


class SimIn(BaseModel):
    identity_type: Identity
    identity_value: str = Field(min_length=1, max_length=255)
    count: int = Field(gt=0, le=100)


class CheckIn(BaseModel):
    identity_type: Identity
    identity_value: str = Field(min_length=1, max_length=255)


class BlockInfo(BaseModel):
    period: Period
    limit: int
    current_count: int
    retry_after: int


class CheckResult(BaseModel):
    allowed: bool
    status: int
    blocked_by: BlockInfo | None = None


class SimResultItem(BaseModel):
    request: int
    status: int
    allowed: bool
    blocked_by: BlockInfo | None = None


class UsageItem(BaseModel):
    rule_id: int
    period: Period
    limit: int
    current_count: int
    remaining: int
    window_key: str
    retry_after: int
