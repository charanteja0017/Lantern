# Strix Dashboard

Enterprise SaaS dashboard for the [Strix](../README.md) AI offensive-security agent.
Runs with full terminal-parity features (runs, agents, tools, findings, reports,
admin oversight) and includes a **Demo Mode** so you can explore the whole UI on
any laptop without spinning up the backend.

## Modes

| Mode        | How                                    | What happens                                                                         |
| ----------- | -------------------------------------- | ------------------------------------------------------------------------------------ |
| **Demo**    | `NEXT_PUBLIC_DEMO=true` (default)      | Seeded realistic data, simulated streaming, no backend calls. Great for design/demo. |
| **Live**    | `NEXT_PUBLIC_DEMO=false` + API URL     | Calls the Strix FastAPI backend. Requires Clerk or internal auth to be configured.   |

## Local development

```bash
cd frontend
cp .env.example .env.local   # keep NEXT_PUBLIC_DEMO=true for your first run
npm install
npm run dev                  # open http://localhost:3000
```

The app ships with a **Demo banner** at the top of every page so it is always
unambiguous whether you are looking at simulated or real data.

## Production

Use Docker (see [`../docker-compose.yml`](../docker-compose.yml)) or deploy the
image built from [`Dockerfile`](./Dockerfile):

```bash
docker build -t strix-dashboard .
docker run --rm -p 3000:3000 \
  -e NEXT_PUBLIC_DEMO=false \
  -e NEXT_PUBLIC_API_BASE_URL=https://api.example.com \
  -e NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_… \
  strix-dashboard
```

The container exposes a health endpoint at `GET /api/health` and includes a
Docker `HEALTHCHECK` so orchestrators can roll out safely.

## Security

- Strict security headers (`X-Frame-Options: DENY`, HSTS, `Permissions-Policy`,
  `X-Content-Type-Options: nosniff`).
- No sensitive data stored in `localStorage`.
- All backend calls go through a typed `StrixProvider` — the demo provider
  cannot accidentally hit the real backend.
- Docker image runs as a non-root `nextjs` user.
