require("dotenv").config();

const express = require("express");
const cors = require("cors");
const http = require("http");
const { WebSocketServer } = require("ws");

const { ContainerLock } = require("./lock");
const { explainConflict } = require("./groq");

const PORT = process.env.PORT || 4000;
const PROCESSING_DELAY_MS = 2500;

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ---------------------------------------------------------------------------
// In-memory state. No database on purpose -- this is a demo of the locking
// and sync mechanics, not a persistence layer.
// ---------------------------------------------------------------------------

const baseCapacity = { C1: 500, C2: 350, C3: 420 };

let containers = {
  C1: { id: "C1", name: "Bay 1 - Alpha", capacity: 500, used: 0, costPerKg: 4.2, items: [] },
  C2: { id: "C2", name: "Bay 2 - Bravo", capacity: 350, used: 0, costPerKg: 5.75, items: [] },
  C3: { id: "C3", name: "Bay 3 - Charlie", capacity: 420, used: 0, costPerKg: 3.9, items: [] },
};

let shipments = [
  { id: "S1", label: "Pallet - Electronics", weight: 120, priority: "high" },
  { id: "S2", label: "Crate - Auto Parts", weight: 95, priority: "medium" },
  { id: "S3", label: "Drum - Chemicals", weight: 60, priority: "high" },
  { id: "S4", label: "Pallet - Textiles", weight: 150, priority: "low" },
  { id: "S5", label: "Box Set - Medical Supplies", weight: 40, priority: "high" },
  { id: "S6", label: "Crate - Machine Parts", weight: 210, priority: "medium" },
  { id: "S7", label: "Pallet - Furniture", weight: 175, priority: "low" },
  { id: "S8", label: "Drum - Industrial Oil", weight: 85, priority: "medium" },
  { id: "S9", label: "Box Set - Perishables", weight: 55, priority: "high" },
  { id: "S10", label: "Crate - Spare Tires", weight: 130, priority: "low" },
];

const containerLock = new ContainerLock();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(msg);
  });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.get("/api/state", (req, res) => {
  res.json({ shipments, containers });
});

app.post("/api/assign", async (req, res) => {
  const requestReceivedHr = process.hrtime.bigint();
  const { shipmentId, containerId } = req.body || {};

  const shipment = shipments.find((s) => s.id === shipmentId);
  const container = containers[containerId];

  if (!shipment || !container) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "Unknown shipment or container." });
  }

  if (shipment.assignedTo) {
    return res.status(409).json({
      error: "ALREADY_ASSIGNED",
      message: `${shipment.label} was already locked into ${shipment.assignedTo}.`,
    });
  }

  // --- The collision gate -------------------------------------------------
  const lock = containerLock.tryAcquire(containerId);

  if (!lock) {
    // Someone else is already mid-transaction on this exact container.
    // Reject immediately -- don't queue behind them.
    const collisionAtMs = Date.now();
    const msSinceWinnerLocked = containerLock.msSinceLocked(containerId) ?? 0;
    const computeWasteMs = Number(process.hrtime.bigint() - requestReceivedHr) / 1e6;
    const remaining = container.capacity - container.used;
    const fractionalCapacityMissedPercent = ((shipment.weight / container.capacity) * 100).toFixed(2);

    const conflict = {
      error: "STATE_CONFLICT",
      containerId,
      shipmentId,
      collisionTimestamp: collisionAtMs,
      msAfterWinnerAcquiredLock: Number(msSinceWinnerLocked.toFixed(4)),
      computeWasteMs: Number(computeWasteMs.toFixed(4)),
      fractionalCapacityMissedPercent,
      remainingCapacityAtCollision: remaining,
      message: `${containerId} was already claimed ${msSinceWinnerLocked.toFixed(2)}ms earlier by another coordinator.`,
    };

    return res.status(409).json(conflict);
  }

  try {
    // Simulate the real validation work a production system would do:
    // fraud checks, weight recalculation, downstream ledger writes, etc.
    await sleep(PROCESSING_DELAY_MS);

    // Re-check truth *after* the delay -- state may have changed while we waited
    // on nothing but the clock (single-threaded, but still good hygiene).
    const freshShipment = shipments.find((s) => s.id === shipmentId);
    const freshContainer = containers[containerId];

    if (freshShipment.assignedTo) {
      return res.status(409).json({
        error: "ALREADY_ASSIGNED",
        message: `${freshShipment.label} was already locked into ${freshShipment.assignedTo}.`,
      });
    }

    const remaining = freshContainer.capacity - freshContainer.used;
    if (freshShipment.weight > remaining) {
      return res.status(422).json({
        error: "CAPACITY_EXCEEDED",
        remaining,
        needed: freshShipment.weight,
        message: `${freshContainer.name} only has ${remaining}kg left; ${freshShipment.label} needs ${freshShipment.weight}kg.`,
      });
    }

    freshContainer.used += freshShipment.weight;
    freshContainer.items.push(freshShipment.id);
    freshShipment.assignedTo = containerId;

    broadcast({
      type: "shipment_assigned",
      shipmentId: freshShipment.id,
      containerId,
      container: freshContainer,
      shipment: freshShipment,
    });

    return res.json({ success: true, container: freshContainer });
  } catch (err) {
    console.error("assign error:", err);
    return res.status(500).json({ error: "SERVER_ERROR", message: "Unexpected server error." });
  } finally {
    containerLock.release(containerId);
  }
});

app.post("/api/insight", async (req, res) => {
  const { conflict } = req.body || {};
  const result = await explainConflict(conflict || {});
  res.json(result);
});

// Reset endpoint, handy for demoing the challenge repeatedly without restarting node
app.post("/api/reset", (req, res) => {
  shipments = shipments.map((s) => ({ ...s, assignedTo: undefined }));
  containers = {
    C1: { id: "C1", name: "Bay 1 - Alpha", capacity: 500, used: 0, costPerKg: 4.2, items: [] },
    C2: { id: "C2", name: "Bay 2 - Bravo", capacity: 350, used: 0, costPerKg: 5.75, items: [] },
    C3: { id: "C3", name: "Bay 3 - Charlie", capacity: 420, used: 0, costPerKg: 3.9, items: [] },
  };
  broadcast({ type: "full_reset", shipments, containers });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// The "live network stream": every 3s the market shifts a little.
// Cost per kg drifts randomly. Capacity can flex slightly too (think:
// fuel surcharge changes how much a truck can actually carry) but it is
// never allowed to drop below what's already loaded -- can't invalidate
// cargo that's already locked in.
// ---------------------------------------------------------------------------

setInterval(() => {
  const rates = [];
  Object.values(containers).forEach((c) => {
    const costDrift = (Math.random() - 0.5) * 0.6;
    c.costPerKg = Math.max(1, Number((c.costPerKg + costDrift).toFixed(2)));

    const capacityDrift = (Math.random() - 0.5) * 20;
    const proposedCapacity = baseCapacity[c.id] + capacityDrift;
    c.capacity = Math.max(Math.round(proposedCapacity), c.used);

    rates.push({ id: c.id, costPerKg: c.costPerKg, capacity: c.capacity, used: c.used });
  });

  broadcast({ type: "market_update", rates, at: Date.now() });
}, 3000);

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "hello", shipments, containers }));
});

server.listen(PORT, () => {
  console.log(`warp dashboard backend listening on http://localhost:${PORT}`);
  console.log(`GROQ_API_KEY present: ${Boolean(process.env.GROQ_API_KEY)}`);
});
