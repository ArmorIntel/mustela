// One frame handle per scene; suspension never resets narrative state.
export function createAnimationLoop({
  draw,
  request = requestAnimationFrame,
  cancel = cancelAnimationFrame,
  status = () => {},
}) {
  const state = {
    visible: false,
    hidden: false,
    reduced: false,
    paused: false,
  };
  let handle = null,
    last = null,
    disposed = false;
  const runnable = () =>
    !disposed &&
    state.visible &&
    !state.hidden &&
    !state.reduced &&
    !state.paused;
  function tick(now) {
    handle = null;
    if (!runnable()) return;
    const dt =
      last === null ? 0 : Math.min(Math.max(0, (now - last) / 1000), 0.033);
    last = now;
    draw(dt, now);
    if (runnable()) handle = request(tick);
  }
  function sync() {
    const running = runnable();
    if (!running) {
      if (handle !== null) cancel(handle);
      handle = null;
      last = null;
    } else if (handle === null) handle = request(tick);
    status(running);
  }
  return {
    conditions(next) {
      Object.assign(state, next);
      sync();
    },
    dispose() {
      disposed = true;
      sync();
    },
  };
}

export function observeScene(canvas, draw, paused, reducedDraw, motion) {
  let visible = false;
  const loop = createAnimationLoop({
    draw,
    status: (running) => {
      canvas.dataset.running = String(running);
    },
  });
  const refresh = () =>
    loop.conditions({
      visible,
      hidden: document.hidden,
      reduced: motion.matches,
      paused: paused(),
    });
  const preference = () => {
    reducedDraw();
    refresh();
  };
  const observer = new IntersectionObserver(
    (entries) => {
      visible = entries[0].isIntersecting;
      refresh();
    },
    { threshold: 0.1 },
  );
  observer.observe(canvas);
  document.addEventListener("visibilitychange", refresh);
  motion.addEventListener("change", preference);
  function pagehide(event) {
    // A cached document is suspended, not destroyed; keep observers for restore.
    if (event.persisted) {
      loop.conditions({ hidden: true });
      return;
    }
    loop.dispose();
    observer.disconnect();
    document.removeEventListener("visibilitychange", refresh);
    motion.removeEventListener("change", preference);
    window.removeEventListener("pagehide", pagehide);
    window.removeEventListener("pageshow", refresh);
  }
  window.addEventListener("pagehide", pagehide);
  window.addEventListener("pageshow", refresh);
  refresh();
  return { refresh };
}
