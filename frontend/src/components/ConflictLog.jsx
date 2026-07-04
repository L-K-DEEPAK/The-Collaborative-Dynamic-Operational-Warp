export default function ConflictLog({ entries }) {
  return (
    <div className="conflict-log">
      <div className="conflict-log__header">
        <span>COLLISION RECORDER</span>
        <span className="conflict-log__count">{entries.length}</span>
      </div>
      <div className="conflict-log__body">
        {entries.length === 0 && (
          <div className="conflict-log__empty">
            No collisions logged yet. Try dropping two shipments into the same bay from two browser tabs at once.
          </div>
        )}
        {entries.map((entry, i) => (
          <div key={`${entry.at}-${i}`} className="conflict-log__entry">
            <div className="conflict-log__line">
              <span className="conflict-log__tag">{entry.error || "REJECTED"}</span>
              <span className="conflict-log__ts">{new Date(entry.at).toLocaleTimeString([], { hour12: false })}.{String(entry.at % 1000).padStart(3, "0")}</span>
            </div>
            <div className="conflict-log__detail">
              {entry.shipmentId} &rarr; {entry.containerId}
            </div>
            {entry.computeWasteMs !== undefined && (
              <div className="conflict-log__metrics">
                <span>waste: {entry.computeWasteMs}ms</span>
                <span>missed: {entry.fractionalCapacityMissedPercent}%</span>
              </div>
            )}
            {entry.message && <div className="conflict-log__msg">{entry.message}</div>}
            {entry.insight && <div className="conflict-log__insight">{entry.insight}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
