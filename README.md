# Dispatch Warp Console

A small logistics dashboard built for the "Collision-Agile Dynamic Workspace"
challenge: drag shipments into container bays, optimistic UI, a hand-rolled
server-side lock for the multi-user race condition, and live sync over
WebSockets.

## Stack

- **Frontend:** React 18 + Vite. No drag-and-drop library — plain HTML5 drag
  events, because the assignment is about state correctness, not DnD tooling.
- **Backend:** Node + Express + `ws`. One in-memory store, no database.
- **Real-time:** native WebSocket, both directions.
- **Optional AI touch:** Groq's chat completions API turns a raw conflict
  payload into one plain-English sentence for the log. If `GROQ_API_KEY`
  isn't set (or Groq is down/slow), the backend falls back to a locally
  built sentence — the dashboard's core behaviour never depends on Groq
  being reachable.

## Why it's built this way

**Optimistic UI + rollback.** The drop handler updates React state the
instant a shipment lands on a bay, then fires the `POST /api/assign` call.
The server always takes 2.5s to respond (simulated with `setTimeout`), which
is long enough that "wait and then render" would feel broken. If the server
comes back with anything other than 200, the shipment count is subtracted
back out of the bay and the shipment card gets a `snapback` CSS animation
class for ~650ms before returning to normal — no page reload, no blocking.

**The lock.** `backend/lock.js` is a `Map<containerId, lockHandle>` with a
`tryAcquire`/`release` pair. It's deliberately not a queue. If a container is
already locked when a second request arrives, that second request is
rejected immediately with the exact millisecond of the collision, how much
of the container's capacity (as a %) the losing shipment needed, and how
many milliseconds of server compute were spent before the conflict was
detected (measured with `process.hrtime.bigint()` for sub-millisecond
precision). A plain object lock is enough here because Node runs single
-threaded — two `tryAcquire()` calls can never physically interleave — so
there's no need for anything heavier.

**Live market tick.** Every 3 seconds the backend nudges each container's
cost-per-kg by a small random amount and broadcasts it. Capacity is also
allowed to flex slightly (think: fuel/weather affecting how much a truck can
actually carry) but it's clamped so it can never drop below the weight
already loaded into that bay — you can't retroactively invalidate cargo
that's already locked in.

**Multi-tab sync.** When a shipment is successfully assigned, the backend
broadcasts it to every connected socket. Any other tab still showing that
shipment in the "Available" list immediately greys it out (locked, drag
disabled) and removes it entirely ~450ms later — so if User B is mid-drag
when User A wins the bay, B's drag target visibly dies under their cursor
instead of silently succeeding into a stale state.

## Running it locally

Requires Node 18+ (for native `fetch` on the backend).

```bash
# terminal 1
cd backend
npm install
cp .env.example .env      # optional: add GROQ_API_KEY if you have one
npm start                 # http://localhost:4000

# terminal 2
cd frontend
npm install
cp .env.example .env
npm run dev                # http://localhost:5173
```

Open `http://localhost:5173` in two separate browser tabs to see the sync
and collision behaviour.

## Demoing the race condition

The 2.5s processing delay makes this easy to trigger by hand:

1. Open two tabs side by side.
2. In both tabs, drag a shipment onto the **same** container bay within
   about a second of each other.
3. One request wins and the shipment locks in on both screens. The other
   gets bounced — watch it snap back in its own tab, and check the
   "Collision Recorder" panel for the exact timestamp, wasted compute, and
   missed capacity percentage.

## Endpoints

| Method | Path            | Purpose                                             |
|--------|-----------------|------------------------------------------------------|
| GET    | `/api/state`    | Initial shipments + container snapshot               |
| POST   | `/api/assign`   | Attempt to lock a shipment into a container           |
| POST   | `/api/insight`  | Turn a conflict payload into a one-line explanation   |
| POST   | `/api/reset`    | Reset all state (for re-running the demo)             |
| WS     | `/`             | `shipment_assigned`, `market_update`, `full_reset`    |

