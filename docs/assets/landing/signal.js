import { observeScene } from "./scene-loop.js";
(() => {
  const canvas = document.querySelector("#signal"),
    ctx = canvas.getContext("2d"),
    toggle = document.querySelector("#motion"),
    reduce = matchMedia("(prefers-reduced-motion: reduce)"),
    fine = matchMedia("(hover: hover) and (pointer: fine)");
  const points = [],
    glyphs = ".:+*#01",
    bright = [],
    dim = [];
  for (let i = 0; i < 24; i++) {
    bright.push(`rgba(118,155,255,${0.32 + i * 0.028})`);
    dim.push(`rgba(93,119,174,${0.16 + i * 0.024})`);
  }
  for (let i = 0; i < 140; i++) {
    const t = (i / 140) * Math.PI * 2,
      center = [
        (2 + Math.cos(3 * t)) * Math.cos(2 * t),
        (2 + Math.cos(3 * t)) * Math.sin(2 * t),
        Math.sin(3 * t),
      ];
    for (let j = 0; j < 11; j++) {
      const a = (j / 11) * Math.PI * 2;
      points.push({
        x: center[0] + 0.27 * Math.cos(a) * Math.cos(2 * t),
        y: center[1] + 0.27 * Math.cos(a) * Math.sin(2 * t),
        z: center[2] + 0.27 * Math.sin(a),
        g: glyphs[(i * 7 + j * 3) % glyphs.length],
        id: i * 11 + j,
        px: 0,
        py: 0,
        depth: 0,
        influence: 0,
      });
    }
  }
  const projected = points.slice();
  let width = 0,
    height = 0,
    paused = false,
    yaw = 0.2,
    speed = 0,
    leaveAt = 0;
  const pointer = { active: false, x: 0, y: 0, tx: 0, ty: 0, strength: 0 };
  const spring = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 };
  function measure() {
    const r = canvas.getBoundingClientRect();
    width = r.width;
    height = r.height;
    const d = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * d);
    canvas.height = Math.round(height * d);
    ctx.setTransform(d, 0, 0, d, 0, 0);
  }
  function draw() {
    ctx.clearRect(0, 0, width, height);
    const scale = Math.min(width, height) * 0.132,
      cx = width * 0.5,
      cy = height * 0.49,
      ax = 0.46 + spring.x,
      ay = yaw + spring.y,
      cxA = Math.cos(ax),
      sxA = Math.sin(ax),
      cyA = Math.cos(ay),
      syA = Math.sin(ay);
    for (const p of points) {
      const x = p.x * cyA + p.z * syA,
        z0 = -p.x * syA + p.z * cyA,
        y = p.y * cxA - z0 * sxA,
        z = p.y * sxA + z0 * cxA,
        f = 7 / (7 - z);
      p.px = cx + x * scale * f;
      p.py = cy + y * scale * f;
      p.depth = z;
      p.influence = 0;
      if (pointer.strength > 0.001 && !reduce.matches) {
        const dx = p.px - pointer.x,
          dy = p.py - pointer.y,
          d = Math.hypot(dx, dy);
        p.influence = Math.max(0, 1 - d / 140) * pointer.strength;
        if (d > 1) {
          const shift = p.influence * p.influence * 32;
          p.px += (dx / d) * shift;
          p.py += (dy / d) * shift;
        }
      }
    }
    projected.sort((a, b) => a.depth - b.depth);
    ctx.font = `${width < 400 ? 9 : 11}px monospace`;
    ctx.textAlign = "center";
    for (const p of projected) {
      const shade = Math.max(
        0,
        Math.min(
          23,
          Math.round(((p.depth + 3.3) / 6.6) * 23 + p.influence * 4),
        ),
      );
      ctx.fillStyle = (p.influence > 0.1 || p.id % 19 < 3 ? bright : dim)[
        shade
      ];
      ctx.fillText(p.g, p.px, p.py);
    }
  }
  function tick(dt, now) {
    // Time-based spring preserves velocity on pointer changes; idle spin ramps in.
    for (const axis of ["x", "y"]) {
      const v = "v" + axis,
        t = "t" + axis;
      spring[v] += (100 * (spring[t] - spring[axis]) - 20 * spring[v]) * dt;
      spring[axis] += spring[v] * dt;
    }
    const blend = 1 - Math.exp(-dt * 9);
    pointer.x += (pointer.tx - pointer.x) * blend;
    pointer.y += (pointer.ty - pointer.y) * blend;
    pointer.strength += ((pointer.active ? 1 : 0) - pointer.strength) * blend;
    const desired = pointer.active || now - leaveAt < 800 ? 0 : 0.045;
    speed += (desired - speed) * (1 - Math.exp(-dt * 2.5));
    yaw += speed * dt;
    canvas.dataset.motion = pointer.active
      ? "pointer"
      : speed > 0.005
        ? "idle"
        : "settling";
    draw();
  }
  function wake() {
    lifecycle.refresh();
  }
  function stop() {
    lifecycle.refresh();
  }
  canvas.addEventListener("pointermove", (e) => {
    if (!fine.matches || paused || reduce.matches) return;
    const r = canvas.getBoundingClientRect();
    pointer.tx = e.clientX - r.left;
    pointer.ty = e.clientY - r.top;
    if (!pointer.active) {
      pointer.x = pointer.tx;
      pointer.y = pointer.ty;
    }
    pointer.active = true;
    spring.tx = (pointer.ty / height - 0.5) * 0.85;
    spring.ty = (pointer.tx / width - 0.5) * 1.2;
    wake();
  });
  canvas.addEventListener("pointerleave", () => {
    pointer.active = false;
    spring.tx = 0;
    spring.ty = 0;
    leaveAt = performance.now();
    wake();
  });
  function sync() {
    toggle.disabled = reduce.matches;
    toggle.textContent = reduce.matches
      ? "Motion reduced"
      : paused
        ? "Resume animation"
        : "Pause animation";
    toggle.setAttribute("aria-pressed", String(paused));
  }
  toggle.addEventListener("click", () => {
    paused = !paused;
    sync();
    if (paused) stop();
    else wake();
  });
  function preference() {
    pointer.active = false;
    pointer.strength = 0;
    sync();
    draw();
  }
  const resize = new ResizeObserver(() => {
    measure();
    draw();
  });
  resize.observe(canvas);
  const lifecycle = observeScene(
    canvas,
    tick,
    () => paused,
    preference,
    reduce,
  );
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) resize.disconnect();
  });
  measure();
  draw();
  sync();
})();
