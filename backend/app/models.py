from datetime import datetime
from sqlalchemy import String, Integer, DateTime, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Rule(Base):
    __tablename__ = "rules"
    __table_args__ = (UniqueConstraint("identity_type", "identity_value", "period"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    identity_type: Mapped[str] = mapped_column(String(20))
    identity_value: Mapped[str] = mapped_column(String(255))
    period: Mapped[str] = mapped_column(String(20))
    limit: Mapped[int] = mapped_column(Integer)


class Notice(Base):
    __tablename__ = "notices"
    __table_args__ = (UniqueConstraint("rule_id", "window_key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    rule_id: Mapped[int] = mapped_column(Integer)
    identity_type: Mapped[str] = mapped_column(String(20))
    identity_value: Mapped[str] = mapped_column(String(255))
    period: Mapped[str] = mapped_column(String(20))
    window_key: Mapped[str] = mapped_column(String(100))
    message: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class RequestLog(Base):
    __tablename__ = "request_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    identity_type: Mapped[str] = mapped_column(String(20))
    identity_value: Mapped[str] = mapped_column(String(255))
    allowed: Mapped[int] = mapped_column(Integer)
    status_code: Mapped[int] = mapped_column(Integer)
    blocked_period: Mapped[str | None] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
