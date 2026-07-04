import { useState } from "react";

export default function ContainerSlot({ container, items, onDropShipment, rateFlash }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const pct = Math.min(100, (container.used / container.capacity) * 100);

  let fillClass = "fill-ok";
  if (pct > 90) fillClass = "fill-critical";
  else if (pct > 70) fillClass = "fill-warn";

  return (
    <div
      className={`container-slot ${isDragOver ? "is-dragover" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        const shipmentId = e.dataTransfer.getData("text/shipment-id");
        if (shipmentId) onDropShipment(container.id, shipmentId);
      }}
    >
      <div className="container-slot__header">
        <div>
          <div className="container-slot__name">{container.name}</div>
          <div className="container-slot__id">{container.id}</div>
        </div>
        <div className={`container-slot__rate ${rateFlash ? "rate-flash" : ""}`}>
          ${container.costPerKg.toFixed(2)}<span>/kg</span>
        </div>
      </div>

      <div className="container-slot__bar">
        <div className={`container-slot__fill ${fillClass}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="container-slot__stats">
        <span>{container.used}kg / {container.capacity}kg</span>
        <span>{(container.capacity - container.used).toFixed(0)}kg free</span>
      </div>

      <div className="container-slot__items">
        {items.length === 0 && <div className="container-slot__empty">drop a shipment here</div>}
        {items.map((s) => (
          <div key={s.id} className="dropped-item">
            <span>{s.id} &middot; {s.label}</span>
            <span>{s.weight}kg</span>
          </div>
        ))}
      </div>
    </div>
  );
}
