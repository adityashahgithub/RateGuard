const BASE = "/api";

async function request<T>(path: string, options: RequestInit = {}, opts?: { allow429?: boolean }): Promise<T> {
  const res = await fetch(`${BASE}/${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !(opts?.allow429 && res.status === 429)) {
    const detail = typeof data.detail === "string" ? data.detail : "Request failed";
    throw new Error(detail);
  }
  return data as T;
}

export const api = {
  health: () => request<import("./types").Health>("health"),
  stats: () => request<import("./types").Stats>("admin/stats"),
  rules: () => request<import("./types").Rule[]>("admin/rules"),
  createRule: (body: Omit<import("./types").Rule, "id">) =>
    request("admin/rules", { method: "POST", body: JSON.stringify(body) }),
  deleteRule: (id: number) => request(`admin/rules/${id}`, { method: "DELETE" }),
  notifications: () => request<import("./types").Notice[]>("admin/notifications"),
  usage: (type: string, value: string) =>
    request<import("./types").UsageItem[]>(`admin/usage/${type}/${encodeURIComponent(value)}`),
  activity: () => request<import("./types").ActivityItem[]>("admin/activity"),
  simulate: (body: { identity_type: string; identity_value: string; count: number }) =>
    request<{ results: import("./types").SimResult[] }>("simulate", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  check: (body: { identity_type: string; identity_value: string }) =>
    request<{ allowed: boolean; status: number; blocked_by?: import("./types").SimResult["blocked_by"] }>(
      "check",
      { method: "POST", body: JSON.stringify(body) },
      { allow429: true },
    ),
  reset: () => request<{ message: string; counters_cleared: string }>("admin/reset", { method: "POST" }),
};
