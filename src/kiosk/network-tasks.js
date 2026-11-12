import { isConnectivityError } from "../network.js";
import { serverNow } from "./server-clock.js";

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

// Share slots across large photo/video transfers, yielding them before the small
// commit request. FIFO keeps ready videos moving through the same upload queue.
export function createUploadPool(limit = 2) {
  let active = 0;
  const waiting = [];
  const pump = () => {
    while (active < limit && waiting.length) {
      const { task, resolve, reject } = waiting.shift();
      active++;
      Promise.resolve().then(task).then(resolve, reject).finally(() => {
        active--;
        pump();
      });
    }
  };
  return {
    run(task) {
      return new Promise((resolve, reject) => {
        waiting.push({ task, resolve, reject });
        pump();
      });
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

// Finish may answer after another photo upload. Keep the server's completed
// session/quota, but never drop later photos or revert an attached original.
export function mergeKioskFinish(current, response) {
  const photos = new Map(response.photos.map((photo) => [photo.id, photo]));
  for (const photo of current.photos) {
    const prior = photos.get(photo.id);
    if (!prior) photos.set(photo.id, photo);
    else if (prior.originalPending && !photo.originalPending) {
      const attached = { ...prior, ...photo, number: prior.number || photo.number };
      delete attached.originalPending;
      photos.set(photo.id, attached);
    }
  }
  return { ...response, photos: [...photos.values()].sort((a, b) => a.number - b.number) };
}

// now: giờ máy chủ (đã bù đồng hồ lệch của máy chụp — server-clock.js).
export function kioskPhotoPath(session, now = serverNow()) {
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
      await removePending(row.id, row);
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
  beforeNext = async () => {}, onError = () => {}, now = Date.now, concurrency = 1,
}) {
  const attempted = new Set();
  let retry = false, stopped = false, failure;
  const worker = async () => {
    try {
      while (!stopped && isActive()) {
        await beforeNext();
        if (stopped || !isActive()) break;
        const rows = (await readPending()).filter((row) => row.stage === "original");
        if (stopped || !isActive()) break;
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
          // A real connection outage affects all files. Already running requests
          // still settle before the caller releases its single-flight gate.
          if (isConnectivityError(error)) stopped = true;
        }
      }
    } catch (error) {
      stopped = true;
      failure ||= error;
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  if (failure) throw failure;
  return retry;
}
