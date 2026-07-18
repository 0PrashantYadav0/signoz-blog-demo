# signoz-blog-demo

Companion repo for the blog post **"The N+1 Bug That Logs Can't See: My SigNoz Flamegraph Warm-Up."**

It self-hosts SigNoz with Docker Compose and reproduces a classic SQLAlchemy
N+1 query bug (47 sequential `SELECT product_attributes` calls hiding behind
one ORM call) so you can see it in a trace flamegraph yourself.

## Quickstart

```bash
# 1. Bring up the full SigNoz stack (ClickHouse + ZooKeeper + OTel Collector + SigNoz UI)
docker compose up -d
# UI: http://localhost:8080  |  OTLP gRPC: 4317  |  OTLP HTTP: 4318

# 2. Emit the demo telemetry (stdlib-only, no pip installs needed)
python3 send-traces.py

# 3. Open http://localhost:8080 -> Services -> catalog-api
#    Look at the p99 vs p50, then Logs Explorer -> click the trace icon on a WARN row.
```

> Docker needs **6GB+ RAM** allocated (Settings -> Resources) or ClickHouse
> will die silently on first-boot migration.

## What's here

| File | Purpose |
|------|---------|
| `docker-compose.yaml` | Full SigNoz self-host stack |
| `config/` | OTel Collector, SigNoz, and ClickHouse config |
| `send-traces.py` | Stdlib-only OTLP generator — emits the same span shapes an auto-instrumented FastAPI + SQLAlchemy service would |
| `generate-traffic.sh` | Optional traffic driver |
| `blog-versions/` | Drafts + the final published post |
| `screenshots/` | Dashboard/trace/log captures used in the post |

## Note

The credentials in `config/` and the helper scripts are **local demo values
only** — do not reuse them for anything real.
