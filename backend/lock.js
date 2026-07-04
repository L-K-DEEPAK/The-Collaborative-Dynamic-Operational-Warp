class ContainerLock {
  constructor() {
    this.locks = new Map();
  }

  // Returns a lock handle if the container was free, or null if it was
  // already taken by someone else.
  tryAcquire(containerId) {
    const current = this.locks.get(containerId);
    if (current) {
      return null; // someone else got here first
    }

    const handle = {
      containerId,
      acquiredAtMs: Date.now(),
      acquiredAtHr: process.hrtime.bigint(),
    };

    this.locks.set(containerId, handle);
    return handle;
  }

  release(containerId) {
    this.locks.delete(containerId);
  }

  msSinceLocked(containerId) {
    const current = this.locks.get(containerId);
    if (!current) return null;
    const diffNs = process.hrtime.bigint() - current.acquiredAtHr;
    return Number(diffNs) / 1e6;
  }
}

module.exports = { ContainerLock };
