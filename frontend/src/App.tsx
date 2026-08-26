import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type {
  ActivityItem,
  Health,
  Identity,
  LiveEvent,
  Notice,
  Period,
  Rule,
  SimResult,
  Stats,
  UsageItem,
} from "./types";
import "./styles.css";
import { IdentityIcon, IconAlert } from "./icons";

const DEMO = {
  identity_type: "customer" as Identity,
  identity_value: "CUST-ALPHA-77",
  period: "minute" as Period,
  limit: 3,
  count: 5,
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function periodLabel(p: Period) {
  return p === "minute" ? "Per Minute" : p === "hour" ? "Per Hour" : "Per Day";
}

function identityLabel(t: Identity) {
  if (t === "ip") return "IP";
  if (t === "domain") return "Domain";
  return "Customer";
}

function liveEventLabel(ev: LiveEvent): string {
  const d = ev.data ?? {};
  switch (ev.type) {
    case "connected":
      return ev.message ?? "Connected to live feed";
    case "rule_created":
      return `Rule created — ${d.identity_type}=${d.identity_value} (${d.period}, limit ${d.limit})`;
    case "rule_deleted":
      return `Rule deleted — ${d.identity_value}`;
    case "breach":
      return `Rate limit breached — ${d.identity_value} → HTTP ${d.status ?? 429}`;
    case "simulation_request":
      return `Sim request #${d.request} — ${d.allowed ? "200 OK" : "429 Blocked"}`;
    case "request_checked":
      return `Check — ${d.identity_value} → ${d.status}`;
    case "demo_reset":
      return "Demo reset — counters cleared, rules preserved";
    default:
      return ev.type.replace(/_/g, " ");
  }
}

function formatCountdown(seconds: number) {
  if (seconds <= 0) return "resetting…";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [usage, setUsage] = useState<UsageItem[]>([]);
  const [simResults, setSimResults] = useState<SimResult[]>([]);
  const [toast, setToast] = useState("");
  const [wsStatus, setWsStatus] = useState<"connecting" | "live" | "offline">("connecting");
  const [demoRunning, setDemoRunning] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "rules" | "simulator" | "architecture">("overview");
  const [firing, setFiring] = useState(false);

  const [ruleForm, setRuleForm] = useState({
    identity_type: "customer" as Identity,
    identity_value: "CUST-ALPHA-77",
    period: "minute" as Period,
    limit: 3,
  });

  const [simForm, setSimForm] = useState({
    identity_type: "customer" as Identity,
    identity_value: "CUST-ALPHA-77",
    count: 5,
  });

  const feedRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [h, s, r, n, a] = await Promise.all([
        api.health(),
        api.stats(),
        api.rules(),
        api.notifications(),
        api.activity(),
      ]);
      setHealth(h);
      setStats(s);
      setRules(r);
      setNotices(n);
      setActivity(a);
      const u = await api.usage(simForm.identity_type, simForm.identity_value);
      setUsage(u);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to load data");
    }
  }, [simForm.identity_type, simForm.identity_value]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (activeTab !== "simulator") return;
    const id = setInterval(() => {
      api.usage(simForm.identity_type, simForm.identity_value).then(setUsage).catch(() => {});
    }, 1000);
    return () => clearInterval(id);
  }, [activeTab, simForm.identity_type, simForm.identity_value]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws/live`);

    ws.onopen = () => setWsStatus("live");
    ws.onclose = () => setWsStatus("offline");
    ws.onerror = () => setWsStatus("offline");
    ws.onmessage = (ev) => {
      try {
        const event: LiveEvent = JSON.parse(ev.data);
        setLiveEvents((prev) => [event, ...prev].slice(0, 40));
        if (event.type === "breach" || event.type === "rule_created" || event.type === "simulation_request") {
          refresh();
        }
      } catch {
        /* ignore */
      }
    };

    return () => ws.close();
  }, [refresh]);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = 0;
  }, [liveEvents]);

  const createRule = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createRule(ruleForm);
      setToast("Rate limit rule created successfully");
      refresh();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Failed to create rule");
    }
  };

  const deleteRule = async (id: number) => {
    try {
      await api.deleteRule(id);
      setToast("Rule deleted");
      refresh();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Failed to delete rule");
    }
  };

  const resetDemo = async () => {
    try {
      await api.reset();
      setSimResults([]);
      setToast("Counters reset — ready for a fresh demo run");
      refresh();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Reset failed");
    }
  };

  const fireSingle = async () => {
    setFiring(true);
    try {
      const result = await api.check({
        identity_type: simForm.identity_type,
        identity_value: simForm.identity_value,
      });
      setToast(
        result.allowed
          ? `Request allowed (HTTP ${result.status})`
          : `Rate limited (HTTP ${result.status}) — retry in ${result.blocked_by?.retry_after ?? "?"}s`,
      );
      refresh();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Request failed");
    } finally {
      setFiring(false);
    }
  };

  const runSimulation = async (e: React.FormEvent) => {
    e.preventDefault();
    setSimResults([]);
    try {
      const { results } = await api.simulate(simForm);
      setSimResults(results);
      setToast(`Simulation complete — ${results.filter((r) => r.allowed).length} allowed, ${results.filter((r) => !r.allowed).length} blocked`);
      refresh();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Simulation failed");
    }
  };

  const runGuidedDemo = async () => {
    setDemoRunning(true);
    setActiveTab("simulator");
    try {
      setRuleForm(DEMO);
      setSimForm({ identity_type: DEMO.identity_type, identity_value: DEMO.identity_value, count: DEMO.count });
      setToast("Step 1/3 — Creating demo rule (3 req/min for CUST-ALPHA-77)...");
      await api.createRule(DEMO).catch(() => {});
      await refresh();
      await new Promise((r) => setTimeout(r, 800));
      setToast("Step 2/3 — Firing 5 rapid requests...");
      const { results } = await api.simulate({
        identity_type: DEMO.identity_type,
        identity_value: DEMO.identity_value,
        count: DEMO.count,
      });
      setSimResults(results);
      await refresh();
      await new Promise((r) => setTimeout(r, 600));
      setToast("Step 3/3 — Demo complete! First 3 allowed, rest blocked with 429 + breach alert.");
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Demo failed");
    } finally {
      setDemoRunning(false);
    }
  };

  const allowedPct = stats ? (stats.total_requests ? (stats.allowed_requests / stats.total_requests) * 100 : 100) : 0;

  return (
    <div className="app">
      <div className="bg-grid" aria-hidden />

      <header className="topbar">
        <div className="brand">
          <div className="logo-mark">
            <svg viewBox="0 0 32 32" fill="none">
              <path d="M6 22 L16 6 L26 22 Z" stroke="currentColor" strokeWidth="2" fill="none" />
              <path d="M10 22 L22 22" stroke="currentColor" strokeWidth="2" />
              <circle cx="16" cy="18" r="2" fill="currentColor" />
            </svg>
          </div>
          <div>
            <div className="brand-row">
              <h1>RateGuard</h1>
              <span className="project-badge">Full-Stack Demo</span>
            </div>
            <p>API Rate Limiting &amp; Monitoring Platform</p>
            <div className="tech-tags">
              <span>React</span><span>FastAPI</span><span>Redis</span><span>PostgreSQL</span><span>WebSocket</span>
            </div>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="health-strip">
            <HealthPill label="API" ok={health?.status === "ok"} />
            <HealthPill label="Redis" ok={!!health?.redis} />
            <HealthPill label="Postgres" ok={!!health?.postgres} />
          </div>
          <span className={`ws-badge ${wsStatus}`}>
            <span className="pulse" />
            {wsStatus === "live" ? "Live Feed Active" : wsStatus === "connecting" ? "Connecting..." : "Offline"}
          </span>
          <button className="btn ghost" onClick={resetDemo}>Reset Counters</button>
          <button className="btn ghost" onClick={refresh}>Refresh</button>
          <button className="btn primary demo-btn" onClick={runGuidedDemo} disabled={demoRunning}>
            {demoRunning ? "Running Demo..." : "Run Interview Demo"}
          </button>
        </div>
      </header>

      {toast && <div className="toast">{toast}</div>}

      <nav className="tabs">
        {(["overview", "rules", "simulator", "architecture"] as const).map((tab) => (
          <button key={tab} className={activeTab === tab ? "active" : ""} onClick={() => setActiveTab(tab)}>
            {tab === "overview" ? "Dashboard" : tab === "rules" ? "Rules" : tab === "simulator" ? "Simulator" : "Architecture"}
          </button>
        ))}
      </nav>

      {activeTab === "overview" && (
        <>
          <section className="stats-grid">
            <StatCard label="Active Rules" value={stats?.total_rules ?? 0} accent="cyan" />
            <StatCard label="Total Requests" value={stats?.total_requests ?? 0} accent="blue" />
            <StatCard label="Allowed" value={stats?.allowed_requests ?? 0} accent="green" />
            <StatCard label="Blocked (429)" value={stats?.blocked_requests ?? 0} accent="red" />
            <StatCard label="Breach Alerts" value={stats?.total_breaches ?? 0} accent="amber" />
            <StatCard label="Block Rate" value={`${stats?.block_rate ?? 0}%`} accent="purple" />
          </section>

          <div className="panel-grid two-col">
            <section className="panel">
              <div className="panel-head">
                <h2>Traffic Overview</h2>
                <span className="chip">Real-time</span>
              </div>
              <div className="traffic-bar">
                <div className="traffic-allowed" style={{ width: `${allowedPct}%` }} />
                <div className="traffic-blocked" style={{ width: `${100 - allowedPct}%` }} />
              </div>
              <div className="traffic-legend">
                <span><i className="dot green" /> Allowed ({stats?.allowed_requests ?? 0})</span>
                <span><i className="dot red" /> Blocked ({stats?.blocked_requests ?? 0})</span>
              </div>
              <div className="activity-list">
                {activity.length === 0 && <p className="empty">No requests yet — run a simulation to see activity.</p>}
                {activity.slice(0, 12).map((a) => (
                  <div key={a.id} className={`activity-row ${a.allowed ? "ok" : "bad"}`}>
                    <span className="mono">{formatTime(a.created_at)}</span>
                    <span className="identity-chip"><IdentityIcon type={a.identity_type} /> {identityLabel(a.identity_type)}</span>
                    <span className="mono dim">{a.identity_value}</span>
                    <span className={`status-pill ${a.allowed ? "ok" : "bad"}`}>{a.status_code}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <h2>Live Event Stream</h2>
                <span className="chip live">WebSocket</span>
              </div>
              <div className="live-feed" ref={feedRef}>
                {liveEvents.length === 0 && (
                  <p className="empty">Waiting for live events... Run a simulation or create a rule.</p>
                )}
                {liveEvents.map((ev, i) => (
                  <div key={i} className={`live-item type-${ev.type}`}>
                    <span className="mono dim">{ev.ts ? formatTime(ev.ts) : "now"}</span>
                    <strong>{ev.type.replace(/_/g, " ")}</strong>
                    <span className="live-detail">{liveEventLabel(ev)}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="panel">
            <div className="panel-head">
              <h2>Breach Notifications</h2>
              <span className="chip warn">{notices.length} alerts</span>
            </div>
            {notices.length === 0 ? (
              <p className="empty">No breaches detected. Limits are holding steady.</p>
            ) : (
              <div className="notice-list">
                {notices.map((n) => (
                  <div key={n.id} className="notice-item">
                    <span className="notice-icon"><IconAlert /></span>
                    <div>
                      <p>{n.message}</p>
                      <span className="mono dim">{formatTime(n.created_at)} · {periodLabel(n.period)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {activeTab === "rules" && (
        <div className="panel-grid two-col">
          <section className="panel">
            <div className="panel-head"><h2>Create Rate Limit Rule</h2></div>
            <form className="form" onSubmit={createRule}>
              <label>
                Identity Type
                <select
                  value={ruleForm.identity_type}
                  onChange={(e) => setRuleForm({ ...ruleForm, identity_type: e.target.value as Identity })}
                >
                  <option value="ip">IP Address</option>
                  <option value="domain">Domain</option>
                  <option value="customer">Customer</option>
                </select>
              </label>
              <label>
                Identity Value
                <input
                  value={ruleForm.identity_value}
                  onChange={(e) => setRuleForm({ ...ruleForm, identity_value: e.target.value })}
                  placeholder="e.g. CUST-ALPHA-77 or 192.168.1.1"
                />
              </label>
              <label>
                Time Period
                <select
                  value={ruleForm.period}
                  onChange={(e) => setRuleForm({ ...ruleForm, period: e.target.value as Period })}
                >
                  <option value="minute">Minute</option>
                  <option value="hour">Hour</option>
                  <option value="day">Day</option>
                </select>
              </label>
              <label>
                Request Limit
                <input
                  type="number"
                  min={1}
                  value={ruleForm.limit}
                  onChange={(e) => setRuleForm({ ...ruleForm, limit: +e.target.value })}
                />
              </label>
              <button type="submit" className="btn primary full">Create Rule</button>
            </form>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Configured Rules</h2>
              <span className="chip">{rules.length} active</span>
            </div>
            {rules.length === 0 ? (
              <p className="empty">No rules yet. Create one or run the interview demo.</p>
            ) : (
              <div className="rules-list">
                {rules.map((r) => (
                  <div key={r.id} className="rule-card">
                    <div className="rule-icon"><IdentityIcon type={r.identity_type} /></div>
                    <div className="rule-body">
                      <strong className="mono">{r.identity_value}</strong>
                      <span className="rule-meta">
                        {r.identity_type} · {periodLabel(r.period)} · limit {r.limit}
                      </span>
                    </div>
                    <button className="btn danger sm" onClick={() => deleteRule(r.id)}>Delete</button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {activeTab === "simulator" && (
        <div className="panel-grid two-col">
          <section className="panel">
            <div className="panel-head"><h2>Request Simulator</h2></div>
            <p className="hint">
              Simulate rapid API calls against configured rules. When limits are exceeded, requests return HTTP 429 and trigger breach notifications.
            </p>
            <form className="form" onSubmit={runSimulation}>
              <label>
                Identity Type
                <select
                  value={simForm.identity_type}
                  onChange={(e) => setSimForm({ ...simForm, identity_type: e.target.value as Identity })}
                >
                  <option value="ip">IP Address</option>
                  <option value="domain">Domain</option>
                  <option value="customer">Customer</option>
                </select>
              </label>
              <label>
                Identity Value
                <input
                  value={simForm.identity_value}
                  onChange={(e) => setSimForm({ ...simForm, identity_value: e.target.value })}
                />
              </label>
              <label>
                Number of Requests
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={simForm.count}
                  onChange={(e) => setSimForm({ ...simForm, count: +e.target.value })}
                />
              </label>
              <button type="submit" className="btn primary full">Simulate Traffic</button>
              <button type="button" className="btn ghost full" onClick={fireSingle} disabled={firing}>
                {firing ? "Sending..." : "Fire Single Request"}
              </button>
            </form>

            {usage.length > 0 && (
              <div className="usage-section">
                <h3>Current Quota Usage</h3>
                {usage.map((u) => {
                  const pct = Math.min(100, (u.current_count / u.limit) * 100);
                  return (
                    <div key={u.rule_id} className="usage-meter">
                      <div className="usage-label">
                        <span>{periodLabel(u.period)}</span>
                        <span className="mono">{u.current_count}/{u.limit}</span>
                      </div>
                      <div className="meter-track">
                        <div className={`meter-fill ${pct >= 100 ? "full" : pct >= 75 ? "warn" : ""}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="mono dim">Resets in {formatCountdown(u.retry_after)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-head"><h2>Simulation Results</h2></div>
            {simResults.length === 0 ? (
              <p className="empty">Run a simulation to see the request timeline.</p>
            ) : (
              <>
                <div className="timeline">
                  {simResults.map((r) => (
                    <div key={r.request} className={`timeline-node ${r.allowed ? "ok" : "bad"}`}>
                      <div className="node-dot" />
                      <div className="node-body">
                        <strong>Request #{r.request}</strong>
                        <span className={`status-pill ${r.allowed ? "ok" : "bad"}`}>
                          {r.status} — {r.allowed ? "Allowed" : "Rate Limited"}
                        </span>
                        {r.blocked_by && (
                          <span className="mono dim">
                            Exceeded {r.blocked_by.period} limit ({r.blocked_by.current_count}/{r.blocked_by.limit}), retry in {r.blocked_by.retry_after}s
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="sim-summary">
                  <span className="chip green">{simResults.filter((r) => r.allowed).length} allowed</span>
                  <span className="chip red">{simResults.filter((r) => !r.allowed).length} blocked</span>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {activeTab === "architecture" && (
        <div className="panel-grid">
          <section className="panel arch-panel">
            <div className="panel-head">
              <h2>System Architecture</h2>
              <span className="chip">Interview-ready overview</span>
            </div>
            <p className="hint">
              RateGuard enforces configurable limits across three identity dimensions. Redis holds ephemeral counters;
              PostgreSQL stores durable rules and deduplicated breach alerts; WebSockets push live observability to the dashboard.
            </p>
            <div className="arch-diagram">
              <div className="arch-row">
                <div className="arch-node frontend">
                  <strong>React Dashboard</strong>
                  <span>Rules · Simulator · Live Feed</span>
                </div>
              </div>
              <div className="arch-arrow">↕ REST + WebSocket</div>
              <div className="arch-row">
                <div className="arch-node backend">
                  <strong>FastAPI Backend</strong>
                  <span>Rule CRUD · /check · /simulate</span>
                </div>
              </div>
              <div className="arch-split">
                <div className="arch-node redis">
                  <strong>Redis</strong>
                  <span>INCR + TTL counters</span>
                </div>
                <div className="arch-node postgres">
                  <strong>PostgreSQL</strong>
                  <span>Rules · Breaches · Logs</span>
                </div>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h2>Rate Limiting Flow</h2></div>
            <ol className="flow-list">
              <li><strong>Request arrives</strong> with identity (IP, domain, or customer)</li>
              <li><strong>Match rules</strong> — all applicable rules are evaluated</li>
              <li><strong>Redis INCR</strong> — atomic counter per rule + fixed window</li>
              <li><strong>Within limit?</strong> → HTTP 200; exceeded → HTTP 429 + Retry-After</li>
              <li><strong>Breach alert</strong> — deduplicated notification stored in PostgreSQL</li>
              <li><strong>Live broadcast</strong> — WebSocket pushes event to dashboard instantly</li>
            </ol>
            <div className="tech-stack">
              <span className="chip">Fixed Window</span>
              <span className="chip">Multi-Identity</span>
              <span className="chip">Atomic Counters</span>
              <span className="chip">Real-time Observability</span>
            </div>
          </section>
        </div>
      )}

      <footer className="footer">
        <span>RateGuard · Fixed-window rate limiting with Redis + PostgreSQL</span>
        <span className="mono dim">Built for production-grade API protection</span>
      </footer>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number | string; accent: string }) {
  return (
    <div className={`stat-card accent-${accent}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

function HealthPill({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className={`health-pill ${ok ? "ok" : "bad"}`}>
      <span className="pulse" />
      {label}
    </span>
  );
}
