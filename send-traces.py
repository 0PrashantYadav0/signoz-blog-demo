#!/usr/bin/env python3
"""
Pure-stdlib OTLP/HTTP trace + log generator for SigNoz demo.
No pip packages needed — uses only urllib and json.

Simulates a catalog-api service with:
  - Fast product list requests (~15ms)
  - Slow requests with N+1 DB pattern (~2800ms: 47 × 60ms queries)
  - Occasional 500 errors
  - Log records linked to each trace

Usage: python3 send-traces.py [--endpoint http://localhost:4318] [--count 100]
"""
import json
import time
import random
import argparse
import urllib.request
import urllib.error
from datetime import datetime, timezone

# ── Config (set at module level so all functions can access without globals) ───
_parser = argparse.ArgumentParser(add_help=False)
_parser.add_argument("--endpoint", default="http://localhost:4318")
_parser.add_argument("--count", type=int, default=0)
_parser.add_argument("--delay", type=float, default=0.5)
_args, _ = _parser.parse_known_args()

OTLP_ENDPOINT = _args.endpoint.rstrip("/")
COUNT         = _args.count
DELAY         = _args.delay
SERVICE_NAME  = "catalog-api"
ENV           = "production"

# ── Helpers ───────────────────────────────────────────────────────────────────
def rand_hex(n: int) -> str:
    return "".join(random.choices("0123456789abcdef", k=n))

def ns_now() -> int:
    return int(time.time_ns())

def ms_to_ns(ms: float) -> int:
    return int(ms * 1_000_000)

def post_json(url: str, payload: dict) -> bool:
    data = json.dumps(payload).encode()
    req  = urllib.request.Request(
        url,
        data    = data,
        headers = {"Content-Type": "application/json"},
        method  = "POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status in (200, 204)
    except urllib.error.URLError as e:
        print(f"  [!] POST failed: {e}")
        return False

# ── Resource (shared across all spans) ───────────────────────────────────────
RESOURCE = {
    "attributes": [
        {"key": "service.name",            "value": {"stringValue": SERVICE_NAME}},
        {"key": "deployment.environment",  "value": {"stringValue": ENV}},
        {"key": "service.version",         "value": {"stringValue": "1.2.0"}},
        {"key": "host.name",               "value": {"stringValue": "catalog-host-01"}},
        {"key": "os.type",                 "value": {"stringValue": "linux"}},
    ]
}

# ── Span builders ─────────────────────────────────────────────────────────────
SPAN_KIND_SERVER = 2
SPAN_KIND_CLIENT = 3
STATUS_OK    = {"code": 1}   # STATUS_CODE_OK
STATUS_ERROR = {"code": 2, "message": "Internal Server Error"}

def build_http_span(trace_id, span_id, name, route, method, status_code,
                    start_ns, end_ns, parent_span_id=None) -> dict:
    span = {
        "traceId":          trace_id,
        "spanId":           span_id,
        "name":             name,
        "kind":             SPAN_KIND_SERVER,
        "startTimeUnixNano": str(start_ns),
        "endTimeUnixNano":   str(end_ns),
        "status": STATUS_ERROR if status_code >= 500 else STATUS_OK,
        "attributes": [
            {"key": "http.method",      "value": {"stringValue": method}},
            {"key": "http.route",       "value": {"stringValue": route}},
            {"key": "http.status_code", "value": {"intValue":    status_code}},
            {"key": "http.url",         "value": {"stringValue": f"http://catalog-host-01:8000{route}"}},
            {"key": "http.scheme",      "value": {"stringValue": "http"}},
        ],
    }
    if parent_span_id:
        span["parentSpanId"] = parent_span_id
    return span

def build_db_span(trace_id, span_id, parent_span_id, table, sql,
                  start_ns, end_ns) -> dict:
    return {
        "traceId":           trace_id,
        "spanId":            span_id,
        "parentSpanId":      parent_span_id,
        "name":              f"SELECT {table}",
        "kind":              SPAN_KIND_CLIENT,
        "startTimeUnixNano": str(start_ns),
        "endTimeUnixNano":   str(end_ns),
        "status":            STATUS_OK,
        "attributes": [
            {"key": "db.system",     "value": {"stringValue": "postgresql"}},
            {"key": "db.name",       "value": {"stringValue": "catalog_db"}},
            {"key": "db.operation",  "value": {"stringValue": "SELECT"}},
            {"key": "db.sql.table",  "value": {"stringValue": table}},
            {"key": "db.statement",  "value": {"stringValue": sql}},
        ],
    }

def send_trace(spans: list) -> bool:
    payload = {
        "resourceSpans": [{
            "resource":   RESOURCE,
            "scopeSpans": [{
                "scope": {"name": "opentelemetry.instrumentation.fastapi", "version": "0.48b0"},
                "spans": spans,
            }],
        }]
    }
    return post_json(f"{OTLP_ENDPOINT}/v1/traces", payload)

def send_log(trace_id, span_id, severity, body, attrs=None) -> bool:
    payload = {
        "resourceLogs": [{
            "resource":  RESOURCE,
            "scopeLogs": [{
                "scope": {"name": "catalog_api.logger"},
                "logRecords": [{
                    "timeUnixNano":         str(ns_now()),
                    "severityNumber":       {"debug": 5, "info": 9, "warn": 13, "error": 17}[severity],
                    "severityText":         severity.upper(),
                    "body":                 {"stringValue": body},
                    "traceId":              trace_id,
                    "spanId":               span_id,
                    "attributes": (attrs or []) + [
                        {"key": "source", "value": {"stringValue": "catalog-api"}},
                    ],
                }],
            }],
        }]
    }
    return post_json(f"{OTLP_ENDPOINT}/v1/logs", payload)

# ── Scenario generators ───────────────────────────────────────────────────────

def fast_request(route="/api/products", n_db=1):
    """A fast request with a single DB query (~15ms total)."""
    trace_id  = rand_hex(32)
    root_id   = rand_hex(16)
    db_id     = rand_hex(16)
    start     = ns_now()
    db_start  = start + ms_to_ns(2)
    db_end    = db_start + ms_to_ns(11)
    end       = start + ms_to_ns(15)

    spans = [
        build_http_span(trace_id, root_id, f"GET {route}", route, "GET", 200, start, end),
        build_db_span(trace_id, db_id, root_id, "products",
                      "SELECT id, name, price, category FROM products LIMIT 20",
                      db_start, db_end),
    ]
    ok = send_trace(spans)
    send_log(trace_id, root_id, "info",
             f"GET {route} 200 OK — returned 20 products in 15ms",
             [{"key": "http.status_code", "value": {"intValue": 200}},
              {"key": "response_time_ms",  "value": {"intValue": 15}}])
    return ok

def slow_n_plus_1(n_queries=47):
    """Simulates the N+1 bug: 47 separate SELECT queries = ~2800ms."""
    route     = "/api/products"
    trace_id  = rand_hex(32)
    root_id   = rand_hex(16)
    start     = ns_now()
    query_ms  = 60          # each query ~60ms
    total_ms  = n_queries * query_ms + 20
    end       = start + ms_to_ns(total_ms)

    spans = [
        build_http_span(trace_id, root_id, f"GET {route}", route, "GET", 200,
                        start, end),
    ]
    # Batch fetch span (the parent SQLAlchemy call — appears as one call in logs)
    batch_id    = rand_hex(16)
    batch_start = start + ms_to_ns(5)
    batch_end   = start + ms_to_ns(total_ms - 5)
    spans.append(build_db_span(trace_id, batch_id, root_id, "products",
                               "SELECT id, name, price, category FROM products",
                               batch_start, batch_end))

    # N child attribute queries (the N+1 pattern)
    t = batch_start + ms_to_ns(2)
    for i in range(n_queries):
        sid   = rand_hex(16)
        s     = t
        e     = t + ms_to_ns(query_ms)
        spans.append(build_db_span(trace_id, sid, batch_id, "product_attributes",
                                   f"SELECT key, value FROM product_attributes WHERE product_id = {i+1}",
                                   s, e))
        t = e

    ok = send_trace(spans)
    send_log(trace_id, root_id, "warn",
             f"GET {route} 200 OK — slow: {total_ms}ms ({n_queries} DB queries detected)",
             [{"key": "http.status_code",    "value": {"intValue": 200}},
              {"key": "response_time_ms",     "value": {"intValue": total_ms}},
              {"key": "db.query_count",       "value": {"intValue": n_queries}},
              {"key": "alert",               "value": {"stringValue": "n+1_detected"}}])
    return ok

def fixed_request(route="/api/products"):
    """Same endpoint but after the N+1 fix: single JOIN query, ~110ms."""
    trace_id  = rand_hex(32)
    root_id   = rand_hex(16)
    db_id     = rand_hex(16)
    start     = ns_now()
    db_start  = start + ms_to_ns(5)
    db_end    = db_start + ms_to_ns(95)
    end       = start + ms_to_ns(110)

    spans = [
        build_http_span(trace_id, root_id, f"GET {route}", route, "GET", 200, start, end),
        build_db_span(trace_id, db_id, root_id, "products",
                      "SELECT p.*, pa.key, pa.value FROM products p "
                      "LEFT JOIN product_attributes pa ON pa.product_id = p.id",
                      db_start, db_end),
    ]
    ok = send_trace(spans)
    send_log(trace_id, root_id, "info",
             f"GET {route} 200 OK — 110ms (fixed: 1 JOIN query)",
             [{"key": "http.status_code", "value": {"intValue": 200}},
              {"key": "response_time_ms",  "value": {"intValue": 110}},
              {"key": "db.query_count",    "value": {"intValue": 1}}])
    return ok

def error_request():
    """A 500 Internal Server Error."""
    route    = "/api/products"
    trace_id = rand_hex(32)
    root_id  = rand_hex(16)
    start    = ns_now()
    end      = start + ms_to_ns(45)

    spans = [
        build_http_span(trace_id, root_id, f"GET {route}", route, "GET", 500, start, end),
    ]
    ok = send_trace(spans)
    send_log(trace_id, root_id, "error",
             "Unhandled exception: OperationalError: server closed the connection unexpectedly",
             [{"key": "exception.type",      "value": {"stringValue": "sqlalchemy.exc.OperationalError"}},
              {"key": "exception.stacktrace","value": {"stringValue":
               "Traceback (most recent call last):\n  File \"app/routers/products.py\", line 42, in get_products\n    results = db.query(Product).all()\n  File \"sqlalchemy/orm/query.py\", line 2349, in all\n    return self._iter().all()\nOperationalError: (psycopg2.OperationalError) server closed the connection unexpectedly"
              }}])
    return ok

def health_check():
    """Fast health endpoint."""
    route    = "/health"
    trace_id = rand_hex(32)
    root_id  = rand_hex(16)
    start    = ns_now()
    end      = start + ms_to_ns(2)
    spans    = [build_http_span(trace_id, root_id, f"GET {route}", route, "GET", 200, start, end)]
    return send_trace(spans)

# ── Main loop ─────────────────────────────────────────────────────────────────

SCENARIOS = [
    # (weight, function, label)
    (50, fast_request,     "fast   GET /api/products (~15ms)"),
    (10, slow_n_plus_1,    "SLOW   GET /api/products (N+1, ~2800ms)"),
    (30, fixed_request,    "fixed  GET /api/products (~110ms, post-fix)"),
    (5,  error_request,    "ERROR  GET /api/products (500)"),
    (5,  health_check,     "health GET /health (~2ms)"),
]
WEIGHTS   = [w for w, _, _ in SCENARIOS]
FUNCTIONS = [f for _, f, _ in SCENARIOS]
LABELS    = [l for _, _, l in SCENARIOS]

def main():
    print(f"Sending OTLP traces + logs to {OTLP_ENDPOINT}")
    print(f"Service: {SERVICE_NAME}  |  Environment: {ENV}")
    print(f"Open SigNoz at http://localhost:8080")
    print(f"{'─'*60}")

    sent = 0
    while COUNT == 0 or sent < COUNT:
        fn, lbl = random.choices(list(zip(FUNCTIONS, LABELS)), weights=WEIGHTS)[0]
        ok = fn()
        status = "✓" if ok else "✗"
        ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
        print(f"  [{ts}] {status} {lbl}")
        sent += 1
        time.sleep(max(0, DELAY + random.uniform(-0.1, 0.1)))

    print(f"\nDone — sent {sent} traces.")

if __name__ == "__main__":
    main()
