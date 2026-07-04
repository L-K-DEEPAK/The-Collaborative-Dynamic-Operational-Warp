export default function ShipmentCard({ shipment, onDragStart, disabled }) {
  const { id, label, weight, priority, pending, snapBack, locked } = shipment;

  const classNames = [
    "shipment-card",
    priority ? `priority-${priority}` : "",
    pending ? "is-pending" : "",
    snapBack ? "is-snapback" : "",
    locked ? "is-locked" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classNames}
      draggable={!disabled}
      onDragStart={(e) => {
        if (disabled) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData("text/shipment-id", id);
        onDragStart?.(id);
      }}
    >
      <div className="shipment-card__top">
        <span className="shipment-card__id">{id}</span>
        <span className={`priority-dot priority-dot--${priority}`} title={`${priority} priority`} />
      </div>
      <div className="shipment-card__label">{label}</div>
      <div className="shipment-card__weight">{weight}kg</div>
      {locked && <div className="shipment-card__lockedTag">claimed elsewhere</div>}
      {pending && <div className="shipment-card__pendingTag">validating&hellip;</div>}
    </div>
  );
}
