import { useCallback, useEffect, useState } from "react";
import ShipmentCard from "./components/ShipmentCard.jsx";
import ContainerSlot from "./components/ContainerSlot.jsx";
import ConflictLog from "./components/ConflictLog.jsx";
import { useSocket } from "./hooks/useSocket.js";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const WS_URL = API_BASE.replace(/^http/, "ws");

const EMPTY_ITEMS = { C1: [], C2: [], C3: [] };

export default function App() {
  const [shipments, setShipments] = useState([]);
  const [containers, setContainers] = useState({});
  const [assignedItems, setAssignedItems] = useState(EMPTY_ITEMS);
  const [conflictLog, setConflictLog] = useState([]);
  const [flashRate, setFlashRate] = useState({});
  const [connectionState, setConnectionState] = useState("connecting");

  useEffect(() => {
    fetch(`${API_BASE}/api/state`)
      .then((r) => r.json())
      .then((data) => {
        setShipments(data.shipments.filter((s) => !s.assignedTo));
        setContainers(data.containers);
        setConnectionState("live");
      })
      .catch(() => setConnectionState("offline"));
  }, []);

  const addItemToBay = useCallback((containerId, shipment) => {
    setAssignedItems((prev) => {
      const bay = prev[containerId] || [];
      if (bay.some((it) => it.id === shipment.id)) return prev;
      return { ...prev, [containerId]: [...bay, shipment] };
    });
  }, []);

  const removeItemFromBay = useCallback((containerId, shipmentId) => {
    setAssignedItems((prev) => ({
      ...prev,
      [containerId]: (prev[containerId] || []).filter((it) => it.id !== shipmentId),
    }));
  }, []);

  const handleSocketMessage = useCallback(
    (msg) => {
      if (msg.type === "hello") {
        setShipments((prev) => (prev.length ? prev : msg.shipments.filter((s) => !s.assignedTo)));
        setContainers(msg.containers);
        setConnectionState("live");
        return;
      }

      if (msg.type === "shipment_assigned") {
        setShipments((prev) =>
          prev.map((s) => (s.id === msg.shipmentId ? { ...s, locked: true, pending: false } : s))
        );
        setContainers((prev) => ({
          ...prev,
          [msg.containerId]: {
            ...prev[msg.containerId],
            used: msg.container.used,
            capacity: msg.container.capacity,
            costPerKg: msg.container.costPerKg,
          },
        }));
        if (msg.shipment) addItemToBay(msg.containerId, msg.shipment);

        setTimeout(() => {
          setShipments((prev) => prev.filter((s) => s.id !== msg.shipmentId));
        }, 450);
        return;
      }

      if (msg.type === "market_update") {
        setContainers((prev) => {
          const next = { ...prev };
          msg.rates.forEach((rate) => {
            if (!next[rate.id]) return;
            next[rate.id] = { ...next[rate.id], costPerKg: rate.costPerKg, capacity: rate.capacity };
          });
          return next;
        });

        const flashed = {};
        msg.rates.forEach((r) => (flashed[r.id] = true));
        setFlashRate(flashed);
        setTimeout(() => setFlashRate({}), 500);
        return;
      }

      if (msg.type === "full_reset") {
        setShipments(msg.shipments.filter((s) => !s.assignedTo));
        setContainers(msg.containers);
        setAssignedItems(EMPTY_ITEMS);
        setConflictLog([]);
      }
    },
    [addItemToBay]
  );

  useSocket(WS_URL, handleSocketMessage);

  const rollback = useCallback(
    (containerId, shipment, errData) => {
      setContainers((prev) => {
        const c = prev[containerId];
        if (!c) return prev;
        return { ...prev, [containerId]: { ...c, used: Math.max(0, c.used - shipment.weight) } };
      });

      removeItemFromBay(containerId, shipment.id);

      setShipments((prev) =>
        prev.map((s) => (s.id === shipment.id ? { ...s, pending: false, snapBack: true } : s))
      );

      const at = Date.now();
      const logEntry = { ...errData, shipmentId: shipment.id, containerId, at };
      setConflictLog((prev) => [logEntry, ...prev].slice(0, 30));

      setTimeout(() => {
        setShipments((prev) => prev.map((s) => (s.id === shipment.id ? { ...s, snapBack: false } : s)));
      }, 650);

      fetch(`${API_BASE}/api/insight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conflict: { ...errData, containerId } }),
      })
        .then((r) => r.json())
        .then((d) => {
          setConflictLog((prev) => prev.map((entry) => (entry.at === at ? { ...entry, insight: d.insight } : entry)));
        })
        .catch(() => {});
    },
    [removeItemFromBay]
  );

  const handleDropShipment = useCallback(
    (containerId, shipmentId) => {
      setShipments((prevShipments) => {
        const shipment = prevShipments.find((s) => s.id === shipmentId);
        if (!shipment || shipment.pending || shipment.locked) return prevShipments;

        // --- optimistic update: happens before we even hear back from the server ---
        setContainers((prevContainers) => {
          const c = prevContainers[containerId];
          if (!c) return prevContainers;
          return { ...prevContainers, [containerId]: { ...c, used: c.used + shipment.weight } };
        });
        addItemToBay(containerId, shipment);

        fetch(`${API_BASE}/api/assign`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shipmentId, containerId, clientTs: Date.now() }),
        })
          .then(async (res) => {
            const data = await res.json();
            if (res.ok) {
              setShipments((prev) => prev.filter((s) => s.id !== shipmentId));
            } else {
              rollback(containerId, shipment, data);
            }
          })
          .catch(() => {
            rollback(containerId, shipment, {
              error: "NETWORK_ERROR",
              message: "Could not reach the dispatch server.",
            });
          });

        return prevShipments.map((s) => (s.id === shipmentId ? { ...s, pending: true } : s));
      });
    },
    [rollback, addItemToBay]
  );

  const handleReset = () => {
    fetch(`${API_BASE}/api/reset`, { method: "POST" }).catch(() => {});
  };

  const containerList = Object.values(containers);

  return (
    <div className="warp-app">
      <header className="warp-header">
        <div>
          <h1>Dispatch Warp Console</h1>
          <p className="warp-subtitle">Collision-agile dynamic workspace &mdash; live dispatch grouping</p>
        </div>
        <div className="warp-header__right">
          <span className={`status-pill status-pill--${connectionState}`}>{connectionState}</span>
          <button className="reset-btn" onClick={handleReset}>reset demo</button>
        </div>
      </header>

      <main className="warp-main">
        <section className="shipments-panel">
          <h2>Available Shipments</h2>
          <div className="shipments-list">
            {shipments.map((s) => (
              <ShipmentCard key={s.id} shipment={s} disabled={s.locked} />
            ))}
            {shipments.length === 0 && <div className="shipments-empty">All shipments dispatched.</div>}
          </div>
        </section>

        <section className="containers-panel">
          {containerList.map((c) => (
            <ContainerSlot
              key={c.id}
              container={c}
              items={assignedItems[c.id] || []}
              onDropShipment={handleDropShipment}
              rateFlash={flashRate[c.id]}
            />
          ))}
        </section>

        <section className="log-panel">
          <ConflictLog entries={conflictLog} />
        </section>
      </main>
    </div>
  );
}
