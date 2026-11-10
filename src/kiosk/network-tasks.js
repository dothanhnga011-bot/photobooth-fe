import { isConnectivityError } from "../network.js";

// Keep a slow request in flight instead of starting it again on each timer tick.
// Callers share the running promise; missed ticks do not queue stale callbacks.
export function createSingleFlight() {
  let running = null;
  return {
    run(action) {
      if (running) return running;
      const task = Promise.resolve().then(action);
      const settled = task.finally(() => {
        if (running === settled) running = null;
      });
      running = settled;
      return settled;
    },
  };
}

export function sameKioskSession(left, right) {
  return Boolean(
    left && right &&
    left.accessToken === right.accessToken &&
    left.captureToken === right.captureToken,
  );
}

// A photo save replaces the session object. A state request that began earlier
// must not replace those newly confirmed photos with its older booking snapshot.
export function canApplyKioskState(started, current, { active, finishing }) {
  return active && !finishing && started === current &&
    sameKioskSession(started, current);
}

export function canApplyKioskPhoto(started, current, booking) {
  return sameKioskSession(started, current) &&
    !(current.booking.status === "completed" && booking.status !== "completed");
}

export function kioskPhotoPath(session, now = Date.now()) {
  if (session.booking.status === "completed")
    return `/albums/${session.accessToken}/photos`;
  // Let finish confirm the completed state before retrying the remaining rows.
  if (now >= new Date(session.booking.captureEndsAt).getTime()) return null;
  return "/kiosk/photo";
}

// Wake on new captures while earlier requests are still saving. Keep two
// requests in flight, await acknowledgements before deleting durable rows, and
// stop scheduling on errors/session changes while settling requests already sent.
export async function drainPendingPhotos({
  isActive, readPending, upload, onSaved, subscribe, concurrency = 2,
}) {
  const running = new Map(), attempted = new Set();
  const signal = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
  };
  let wake = signal(), error;
  const unsubscribe = subscribe?.(() => wake.resolve());
  try {
    while (isActive() && !error) {
      const changed = wake;
      const rows = await readPending();
      for (const row of rows) {
        if (!isActive() || error || running.size >= concurrency) break;
        if (attempted.has(row.id)) continue;
        attempted.add(row.id);
        const task = Promise.resolve().then(() => upload(row))
          .then(result => onSaved(row, result))
          .catch(failure => { error ||= failure; })
          .finally(() => { running.delete(row.id); wake.resolve(); });
        running.set(row.id, task);
      }
      if (!running.size) break;
      await changed.promise;
      if (wake === changed) wake = signal();
    }
  } catch (failure) {
    error ||= failure;
  } finally {
    await Promise.all(running.values());
    unsubscribe?.();
  }
  if (error) throw error;
}

// Let the current POST finish and remove only acknowledged rows. A new capture
// session takes priority over the remaining idle backlog; failed rows stay saved.
export async function flushPendingPhotos({
  isIdle, readPending, upload, removePending, onSaved,
}) {
  if (!isIdle()) return;
  let rows;
  try {
    rows = await readPending();
  } catch {
    // Storage can be temporarily unavailable; a shared gate must still settle
    // safely when an active sync joins this idle flush's running promise.
    return;
  }
  for (const row of rows) {
    if (!isIdle()) return;
    try {
      await upload(row);
      await removePending(row.id);
      onSaved(row);
    } catch {
      // Retain this row and its original idempotency key for the next retry.
    }
  }
}

// An unusable original must not hold every later photo/album behind it. Acknowledge
// before deleting; retain failures with a per-file retry time and try other rows.
export async function flushOriginalPhotos({
  isActive, readPending, upload, removePending, savePending,
  beforeNext = async () => {}, onError = () => {}, now = Date.now,
}) {
  const attempted = new Set();
  let retry = false;
  while (isActive()) {
    await beforeNext();
    if (!isActive()) break;
    const rows = (await readPending()).filter((row) => row.stage === "original");
    retry ||= rows.some((row) => row.originalRetryAt > now());
    const row = rows.filter((row) => !attempted.has(row.id) && !(row.originalRetryAt > now()))
      .sort((a, b) => (a.originalAt || 0) - (b.originalAt || 0))[0];
    if (!row) break;
    attempted.add(row.id);
    try {
      await upload(row);
      await removePending(row.id);
    } catch (error) {
      if (error.status === 410 || (error.status === 404 && now() - (row.originalAt || 0) > 86400000)) {
        await removePending(row.id);
        continue;
      }
      const originalFailures = Math.min(10, (row.originalFailures || 0) + 1);
      const delay = Math.max(error.retryAfterMs || 0, Math.min(300000, 20000 * 2 ** (originalFailures - 1)));
      await savePending({ ...row, originalFailures, originalRetryAt: now() + delay });
      retry = true;
      onError(row, error);
      // A real connection outage affects all files. Resume after recovery/backoff,
      // while a rejected file alone must not stop another guest's originals.
      if (isConnectivityError(error)) break;
    }
  }
  return retry;
}
