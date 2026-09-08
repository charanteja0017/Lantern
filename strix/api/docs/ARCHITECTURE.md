# Strix Web API — Architecture

```
┌────────────────────────────────────┐
│          Next.js dashboard         │
│  (SSR, live SSE stream, demo mode) │
└───────────────┬────────────────────┘
                │ /api/…
                ▼
┌────────────────────────────────────┐
│            FastAPI API             │   <- this package (strix/api)
│  ┌────────┐  ┌────────┐ ┌────────┐ │
│  │ routes │  │services│ │schemas │ │
│  └────────┘  └────────┘ └────────┘ │
└─────┬───────────────┬──────────────┘
      │               │
      ▼               ▼
┌────────────┐   ┌────────────┐   ┌───────────────────────────────┐
│   Redis    │   │  Postgres  │   │   strix_runs/<run>/           │
│ rate limits│   │ orgs,users,│   │   events.jsonl (truth source) │
│ pubsub,lock│   │ runs index │   │   penetration_test_report.md  │
└────────────┘   └────────────┘   │   vulnerabilities/*.md        │
                                  │   checkpoints/ckpt-*.json     │
                                  └──────────────┬────────────────┘
                                                 │
                                                 ▼
                                  ┌────────────────────────────┐
                                  │ Strix CLI / core runtime   │
                                  │ (unchanged — spawned by    │
                                  │  RunLauncher as subprocess)│
                                  └────────────────────────────┘
```

## Source of truth

The existing `Tracer` writes every lifecycle event to `strix_runs/<run>/events.jsonl`.
The API treats that file as the **source of truth** for runs, messages, tool
executions, and findings, and adds:

- `checkpoints/ckpt-<ts>.json` — crash-safe snapshots, written atomically
  (tempfile + `fsync` + `os.replace`). The latest one is loaded on resume.
- `_audit/audit.jsonl` — append-only log of admin actions (who, when, what).

When Postgres is configured, these artifacts are additionally indexed for
fast cross-tenant admin queries. When Postgres is off, the API still works
end-to-end for a single-node deployment.

## Reliability targets

| Property               | Target         | How                                                 |
| ---------------------- | -------------- | --------------------------------------------------- |
| Data loss on crash     | ≤ 5 seconds    | Checkpoints every `STRIX_CHECKPOINT_INTERVAL` (15s) |
| Resume after restart   | ≤ 10 seconds   | File-based checkpoint + replay from `events.jsonl`  |
| Cross-worker streaming | Linearizable   | SSE tails a single append-only file                 |
| 429 / TPM throttle     | Zero state loss | Governor queues; run stays `throttled`, not failed |

## Authentication

- Production: Clerk JWT via `Authorization: Bearer`, verified against JWKS.
  The claim's `org_id` and `role` are bound into the request `Principal`.
- Development: demo principal with admin role.
- Platform admins are elevated via `STRIX_ADMIN_EMAILS` (comma-separated).

## Authorization (RBAC)

| Role             | Scope              | Mutations                                     |
| ---------------- | ------------------ | --------------------------------------------- |
| viewer           | own org, read-only | none                                          |
| analyst          | own org            | create runs, send messages, stop agents/runs  |
| admin            | own org            | + settings, provider keys                     |
| platform-admin   | all orgs, read     | + admin console, audit, rate-limit snapshots  |

Every cross-tenant admin read is audit-logged.
