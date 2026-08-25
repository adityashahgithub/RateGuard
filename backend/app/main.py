import os
from datetime import datetime, timezone
import redis
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import Literal
from sqlalchemy import create_engine, String, Integer, DateTime, UniqueConstraint, select, desc
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

DATABASE_URL=os.getenv("DATABASE_URL")
engine=create_engine(DATABASE_URL)
Session=sessionmaker(bind=engine)
REDIS=redis.Redis.from_url(os.getenv("REDIS_URL"),decode_responses=True)

class Base(DeclarativeBase): pass
class Rule(Base):
    __tablename__="rules"
    __table_args__=(UniqueConstraint("identity_type","identity_value","period"),)
    id:Mapped[int]=mapped_column(primary_key=True)
    identity_type:Mapped[str]=mapped_column(String(20))
    identity_value:Mapped[str]=mapped_column(String(255))
    period:Mapped[str]=mapped_column(String(20))
    limit:Mapped[int]=mapped_column(Integer)
class Notice(Base):
    __tablename__="notices"
    __table_args__=(UniqueConstraint("rule_id","window_key"),)
    id:Mapped[int]=mapped_column(primary_key=True)
    rule_id:Mapped[int]=mapped_column(Integer)
    identity_type:Mapped[str]=mapped_column(String(20))
    identity_value:Mapped[str]=mapped_column(String(255))
    period:Mapped[str]=mapped_column(String(20))
    window_key:Mapped[str]=mapped_column(String(100))
    message:Mapped[str]=mapped_column(String(500))
    created_at:Mapped[datetime]=mapped_column(DateTime,default=datetime.utcnow)
Base.metadata.create_all(engine)

Identity=Literal["ip","domain","customer"]
Period=Literal["minute","hour","day"]
class RuleIn(BaseModel):
    identity_type:Identity
    identity_value:str=Field(min_length=1)
    period:Period
    limit:int=Field(gt=0)
class SimIn(BaseModel):
    identity_type:Identity
    identity_value:str=Field(min_length=1)
    count:int=Field(gt=0,le=100)

app=FastAPI(title="RateGuard")

def window(period):
    now=datetime.now(timezone.utc)
    if period=="minute": start=now.replace(second=0,microsecond=0); seconds=60
    elif period=="hour": start=now.replace(minute=0,second=0,microsecond=0); seconds=3600
    else: start=now.replace(hour=0,minute=0,second=0,microsecond=0); seconds=86400
    return start.isoformat(),max(1,int(seconds-(now-start).total_seconds()))

@app.get("/health")
def health(): return {"status":"ok"}

@app.get("/admin/rules")
def rules():
    with Session() as db:
        return [{"id":r.id,"identity_type":r.identity_type,"identity_value":r.identity_value,"period":r.period,"limit":r.limit} for r in db.scalars(select(Rule).order_by(desc(Rule.id))).all()]

@app.post("/admin/rules",status_code=201)
def create_rule(x:RuleIn):
    with Session() as db:
        exists=db.scalar(select(Rule).where(Rule.identity_type==x.identity_type,Rule.identity_value==x.identity_value,Rule.period==x.period))
        if exists: raise HTTPException(409,"Duplicate rule")
        r=Rule(**x.model_dump());db.add(r);db.commit();db.refresh(r)
        return {"id":r.id,"message":"Rate limit rule created"}

@app.delete("/admin/rules/{rid}")
def delete_rule(rid:int):
    with Session() as db:
        r=db.get(Rule,rid)
        if not r: raise HTTPException(404,"Rule not found")
        db.delete(r);db.commit();return {"message":"Rule deleted"}

@app.get("/admin/notifications")
def notices():
    with Session() as db:
        return [{"id":n.id,"identity_type":n.identity_type,"identity_value":n.identity_value,"period":n.period,"message":n.message,"created_at":n.created_at.isoformat()} for n in db.scalars(select(Notice).order_by(desc(Notice.id))).all()]

@app.post("/simulate")
def simulate(x:SimIn):
    out=[]
    with Session() as db:
        rs=db.scalars(select(Rule).where(Rule.identity_type==x.identity_type,Rule.identity_value==x.identity_value)).all()
        for num in range(1,x.count+1):
            blocked=None
            for r in rs:
                wk,ttl=window(r.period);key=f"rate:{r.id}:{x.identity_value}:{wk}"
                c=REDIS.incr(key)
                if c==1: REDIS.expire(key,ttl)
                if c>r.limit:
                    blocked={"period":r.period,"limit":r.limit,"current_count":c,"retry_after":REDIS.ttl(key)}
                    n=Notice(rule_id=r.id,identity_type=r.identity_type,identity_value=x.identity_value,period=r.period,window_key=wk,message=f"Rate limit breached: {x.identity_type}={x.identity_value}, period={r.period}, limit={r.limit}")
                    db.add(n)
                    try: db.commit()
                    except Exception: db.rollback()
                    break
            out.append({"request":num,"status":429 if blocked else 200,"allowed":not bool(blocked),"blocked_by":blocked})
    return {"results":out}
