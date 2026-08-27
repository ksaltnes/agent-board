# Agent Board

Minimal project tracker for **multiple agent bots** + a small human overview.

Designed for **low token use**: short field names, delta patches, one-shot context packs, notes capped at 140 chars.

## Quick start

```bash
npm start
# → http://127.0.0.1:3847
```

Data lives in [`data/board.json`](data/board.json) (file-backed; bots and humans share the same source of truth). Reset with `npm run seed`.

## Deploy on Fly.io

No ongoing free plan for new accounts. New orgs get a short **trial** (2 VM-hours or 7 days). After that, pay-as-you-go: the smallest always-on machine (`shared-cpu-1x` / 256 MB in `ams`) is about **$2/month** plus ~$0.15/month for a 1 GB volume. A card is required after the trial.

```bash
# 1. Install flyctl and log in: https://fly.io/docs/hands-on/install-flyctl/
fly auth login

# 2. Create the app (change the name if taken)
fly apps create agent-board-ksaltnes
# keep app = "agent-board-ksaltnes" in fly.toml in sync

# 3. Persistent board file
fly volumes create board_data --size 1 --region ams --yes

# 4. Write token (required in production)
fly secrets set BOARD_TOKEN="$(openssl rand -hex 16)"

# 5. Deploy
fly deploy
fly open
```

Bots (reads and writes need the same token):

```http
GET https://<app>.fly.dev/v1/ctx?a=builder
Authorization: Bearer $BOARD_TOKEN

POST https://<app>.fly.dev/v1/tickets/T2/claim
Authorization: Bearer $BOARD_TOKEN
{"a":"builder"}
```

UI: paste the same token in the header field and click **Åpne**. The token stays in the input for this tab only (not `localStorage`). Production refuses all board routes if `BOARD_TOKEN` is unset; only `GET /health` stays public. Do not put a real token in git, CI, or Fly config files — use `fly secrets set`.

CI: add repo secret `FLY_API_TOKEN` (`fly tokens create deploy`) so pushes to `main` deploy via [`.github/workflows/fly.yml`](.github/workflows/fly.yml).

## Bot workflow (minimal tokens)

1. **Pull context once**
   ```http
   GET /v1/ctx?a=builder
   Authorization: Bearer $BOARD_TOKEN
   ```
   Returns mandate (`m`), progress (`p`), open tickets, `mine`, and `claimable`.

2. **Claim**
   ```http
   POST /v1/tickets/T2/claim
   Authorization: Bearer $BOARD_TOKEN
   {"a":"builder"}
   ```

3. **Patch deltas only**
   ```http
   PATCH /v1/tickets/T2
   {"s":"blocked","n":"needs T4"}
   ```
   Response is only changed fields: `{"ok":1,"id":"T2","s":"blocked","n":"needs T4"}`.

4. **Done**
   ```http
   POST /v1/tickets/T2/done
   {"n":"shipped /ctx"}
   ```

5. **Create** (ack is tiny)
   ```http
   POST /v1/tickets
   {"t":"Add auth header","p":0,"d":["T2"]}
   → {"ok":1,"id":"T4","s":"todo"}
   ```

Field cheat-sheet: `t` title · `s` status · `a` agent · `p` priority · `d` deps · `n` note · `g` goal · `f` focus.

Statuses: `todo` | `doing` | `blocked` | `done`.

`GET /v1/help` prints the same cheat-sheet from the live server.

## Human UI

Open `/` and unlock with `BOARD_TOKEN` to see mandate, progress bar, kanban columns, and agent roster. Prefer the UI for overview; prefer `/v1/ctx` + PATCH for bots. The HTML shell loads without a token; board data does not.

## Why this shape

| Need | Mechanism |
|------|-----------|
| Shared mandate | `mandate` in board + `/v1/ctx` |
| Progress | Derived counts / `%` — no duplicate docs |
| Info sharing | One JSON file + compact `/ctx` |
| Low tokens on write | PATCH deltas, 140-char notes, minimal create/done acks |
| Multi-agent | Claim ownership; one active ticket per agent |

## API map

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/v1/ctx?a=` | Bot context pack |
| GET | `/v1/progress` | Counts + % |
| GET/PATCH | `/v1/mandate` | Read / delta-update mandate |
| GET/POST | `/v1/tickets` | List / create |
| GET/PATCH | `/v1/tickets/:id` | Read / delta-update |
| POST | `/v1/tickets/:id/claim` | Claim as agent |
| POST | `/v1/tickets/:id/done` | Mark done |
| GET | `/v1/board` | Full board (UI) |
| GET | `/v1/help` | Compact ops guide |
| GET | `/health` | Fly health check |
