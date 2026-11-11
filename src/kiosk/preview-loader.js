// Limit decoded previews in flight, publish once per paint, and release every
// bitmap belonging to the previous guest (including decodes finishing late).
export function createPreviewLoader({
  load, onChange, limit = 3,
  schedule = (callback) => requestAnimationFrame(callback),
  cancel = (id) => cancelAnimationFrame(id),
}) {
  const empty = (token) => ({ token, known: new Set(), map: new Map(), queue: [], frame: null, controller: new AbortController() });
  let state = empty(undefined), active = 0, closed = false;
  const release = (previous) => {
    previous.controller.abort();
    if (previous.frame !== null) cancel(previous.frame);
    previous.queue.length = 0;
    for (const image of previous.map.values()) image.close?.();
    previous.map.clear();
  };
  const publish = (current) => {
    if (current.frame !== null) return;
    current.frame = schedule(() => {
      current.frame = null;
      if (!closed && current === state) onChange(new Map(current.map), current.token);
    });
  };
  const pump = () => {
    while (!closed && active < limit && state.queue.length) {
      const current = state, shot = current.queue.shift();
      active++;
      Promise.resolve().then(() => load(shot, current.token, current.controller.signal)).then(
        (image) => {
          if (closed || current !== state) { image.close?.(); return; }
          current.map.set(shot.key, image);
          publish(current);
        },
        () => current.known.delete(shot.key),
      ).finally(() => { active--; pump(); });
    }
  };
  return {
    setShots(shots, token) {
      if (closed) return;
      if (state.token !== token || (!shots.length && state.known.size)) {
        release(state);
        state = empty(token);
        onChange(new Map(), token);
      }
      for (const shot of shots) {
        if (state.known.has(shot.key)) continue;
        state.known.add(shot.key);
        state.queue.push(shot);
      }
      pump();
    },
    close() {
      if (closed) return;
      closed = true;
      release(state);
    },
  };
}
