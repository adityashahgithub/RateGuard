#!/usr/bin/env bash
# RateGuard system test — run after: docker compose up --build
set -euo pipefail

BASE="${BASE_URL:-http://localhost:8000}"
API="${FRONTEND_API:-http://localhost:5173/api}"
PASS=0 FAIL=0

check() {
  local name="$1" cond="$2"
  if eval "$cond"; then echo "✅ $name"; PASS=$((PASS+1)); else echo "❌ $name"; FAIL=$((FAIL+1)); fi
}

echo "=== RateGuard System Test ==="
echo "Backend: $BASE | Frontend proxy: $API"
echo ""

H=$(curl -sf "$BASE/health")
check "Health OK" "echo '$H' | grep -q '\"status\":\"ok\"'"
check "Redis up" "echo '$H' | grep -q '\"redis\":true'"
check "Postgres up" "echo '$H' | grep -q '\"postgres\":true'"

curl -sf -X POST "$BASE/admin/reset" > /dev/null

R=$(curl -sf -X POST "$BASE/admin/rules" -H "Content-Type: application/json" \
  -d '{"identity_type":"customer","identity_value":"SYS-TEST-01","period":"minute","limit":3}')
check "Create rule" "echo '$R' | grep -q 'Rate limit rule created'"

DUP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/admin/rules" -H "Content-Type: application/json" \
  -d '{"identity_type":"customer","identity_value":"SYS-TEST-01","period":"minute","limit":3}')
check "Duplicate → 409" "[ '$DUP' = '409' ]"

curl -sf -X POST "$BASE/admin/reset" > /dev/null
NR=$(curl -sf -X POST "$BASE/check" -H "Content-Type: application/json" \
  -d '{"identity_type":"customer","identity_value":"NO-RULE-99"}')
check "No rule → allow" "echo '$NR' | grep -q '\"allowed\":true'"

curl -sf -X POST "$BASE/admin/rules" -H "Content-Type: application/json" \
  -d '{"identity_type":"customer","identity_value":"SYS-TEST-01","period":"minute","limit":3}' > /dev/null

for i in 1 2 3; do
  C=$(curl -sf -X POST "$BASE/check" -H "Content-Type: application/json" \
    -d '{"identity_type":"customer","identity_value":"SYS-TEST-01"}')
  check "Request $i → 200" "echo '$C' | grep -q '\"allowed\":true'"
done

BLOCK=$(curl -si -X POST "$BASE/check" -H "Content-Type: application/json" \
  -d '{"identity_type":"customer","identity_value":"SYS-TEST-01"}')
check "Request 4 → 429" "echo '$BLOCK' | head -1 | grep -q '429'"
check "Retry-After header" "echo '$BLOCK' | grep -qi 'retry-after'"

check "Simulate works" "curl -sf -X POST '$BASE/simulate' -H 'Content-Type: application/json' -d '{\"identity_type\":\"customer\",\"identity_value\":\"SYS-TEST-01\",\"count\":2}' | grep -q results"
check "Stats works" "curl -sf '$BASE/admin/stats' | grep -q total_requests"
check "Notifications" "curl -sf '$BASE/admin/notifications' | grep -q SYS-TEST-01"
check "Usage" "curl -sf '$BASE/admin/usage/customer/SYS-TEST-01' | grep -q current_count"
check "Activity" "curl -sf '$BASE/admin/activity' | grep -q SYS-TEST-01"
check "Frontend proxy" "curl -sf '$API/health' | grep -q ok"
check "Reset" "curl -sf -X POST '$BASE/admin/reset' | grep -q 'Counters and logs reset'"

echo ""
echo "=== $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
