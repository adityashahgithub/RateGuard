export interface Health {
  status: "ok" | "degraded";
  redis: boolean;
  postgres: boolean;
}

export type Identity = "ip" | "domain" | "customer";
export type Period = "minute" | "hour" | "day";

export interface Rule {
  id: number;
  identity_type: Identity;
  identity_value: string;
  period: Period;
  limit: number;
}

export interface Stats {
  total_rules: number;
  total_breaches: number;
  total_requests: number;
  allowed_requests: number;
  blocked_requests: number;
  block_rate: number;
}

export interface Notice {
  id: number;
  identity_type: Identity;
  identity_value: string;
  period: Period;
  message: string;
  created_at: string;
}

export interface UsageItem {
  rule_id: number;
  period: Period;
  limit: number;
  current_count: number;
  remaining: number;
  window_key: string;
  retry_after: number;
}

export interface SimResult {
  request: number;
  status: number;
  allowed: boolean;
  blocked_by?: {
    period: Period;
    limit: number;
    current_count: number;
    retry_after: number;
  };
}

export interface ActivityItem {
  id: number;
  identity_type: Identity;
  identity_value: string;
  allowed: boolean;
  status_code: number;
  blocked_period: Period | null;
  created_at: string;
}

export interface LiveEvent {
  type: string;
  message?: string;
  ts?: string;
  data?: Record<string, unknown>;
}
