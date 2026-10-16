import { observeScene } from "./scene-loop.js";
(() => {
  const canvas = document.querySelector("#thinking-orb"),
    ctx = canvas.getContext("2d"),
    pause = document.querySelector("#orb-pause"),
    replay = document.querySelector("#ai-example"),
    output = document.querySelector("#ai-output"),
    caption = document.querySelector("#ai-caption"),
    status = document.querySelector("#orb-state"),
    reduce = matchMedia("(prefers-reduced-motion: reduce)"),
    fine = matchMedia("(hover: hover) and (pointer: fine)");
  const glyphs = ".:+*#01",
    indicatorText = ["203.0.113.42", "update.example.org", "SHA256: a4c8…"],
    nodes = [
      [0.16, 0.2],
      [0.82, 0.2],
      [0.16, 0.82],
    ],
    points = [];
  for (let i = 0; i < 700; i++) {
    const y = 1 - (2 * (i + 0.5)) / 700,
      r = Math.sqrt(1 - y * y),
      a = i * 2.399963;
    points.push({
      x: Math.cos(a) * r,
      y,
      z: Math.sin(a) * r,
      g: glyphs[i % 7],
      px: 0,
      py: 0,
      depth: 0,
    });
  }
  const sorted = points.slice(),
    colors = Array.from(
      { length: 24 },
      (_, i) => `rgba(118,155,255,${0.12 + i * 0.035})`,
    );
  const mouse = {
    active: false,
    x: 0.5,
    y: 0.5,
    tx: 0.5,
    ty: 0.5,
    strength: 0,
  };
  let w = 0,
    h = 0,
    time = 0,
    elapsed = 0,
    paused = false,
    stage = "";
  const smooth = (t) => {
    const u = Math.max(0, Math.min(1, t));
    return u * u * (3 - 2 * u);
  };
  function size() {
    const r = canvas.getBoundingClientRect();
    w = r.width;
    h = r.height;
    const d = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(w * d);
    canvas.height = Math.round(h * d);
    ctx.setTransform(d, 0, 0, d, 0, 0);
  }
  function plot(ch, x, y, alpha = 0.5) {
    const dx = x - mouse.x * w,
      dy = y - mouse.y * h,
      d = Math.hypot(dx, dy),
      influence = mouse.strength * Math.max(0, 1 - d / 120);
    if (d > 1) {
      x += (dx / d) * influence * 13;
      y += (dy / d) * influence * 13;
    }
    ctx.fillStyle = `rgba(152,181,255,${Math.min(1, alpha + influence * 0.3)})`;
    ctx.fillText(ch, x, y);
  }
  function label(text, x, y, alpha = 1) {
    if (alpha < 0.01) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `${w < 400 ? 10 : 12}px monospace`;
    const width = ctx.measureText(text).width;
    ctx.fillStyle = "#080b11";
    ctx.fillRect(x - width / 2 - 6, y - 12, width + 12, 24);
    ctx.fillStyle = "#cbdcff";
    ctx.fillText(text, x, y + 4);
    ctx.restore();
  }
  function updateStage(next) {
    if (stage === next) return;
    stage = next;
    canvas.dataset.stage = next;
    const text = {
      link: "Connecting example indicators",
      absorb: "Bringing linked signals into context",
      mix: "Correlating the example evidence",
      emit: "Returning analyst next steps",
      ready: "Example correlation / ready",
    };
    status.textContent = text[next];
    caption.textContent =
      next === "ready" || next === "emit"
        ? "Illustrative next steps, subject to analyst validation."
        : "Example indicators connect, merge and become an analyst brief.";
    output.classList.toggle(
      "steps-visible",
      next === "emit" || next === "ready",
    );
    output.setAttribute(
      "aria-hidden",
      String(next !== "emit" && next !== "ready"),
    );
  }
  function draw() {
    const savedElapsed = elapsed;
    if (reduce.matches) elapsed = 9.4;
    ctx.clearRect(0, 0, w, h);
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    const next =
      elapsed < 1.5
        ? "link"
        : elapsed < 3.7
          ? "absorb"
          : elapsed < 6.4
            ? "mix"
            : elapsed < 8.8
              ? "emit"
              : "ready";
    updateStage(next);
    const absorb = smooth((elapsed - 1.5) / 2.2),
      mix = smooth((elapsed - 3.7) / 1.8),
      emit = smooth((elapsed - 6.4) / 2.4);
    const cx = w * (0.49 + (mouse.x - 0.5) * mouse.strength * 0.045),
      cy = h * (0.51 + (mouse.y - 0.5) * mouse.strength * 0.04);
    const radius =
      Math.min(w, h) *
      (0.075 + 0.14 * absorb + 0.07 * mix - 0.085 * emit) *
      (1 + Math.sin(time * 0.85) * 0.018);
    // Relationships appear first. Linked indicator fragments spiral into the core.
    for (let a = 0; a < 3; a++) {
      const n = nodes[a],
        nx = n[0] * w,
        ny = n[1] * h;
      if (elapsed < 3.7) {
        const b = nodes[(a + 1) % 3];
        for (let i = 0; i < 25; i++) {
          const t = i / 24;
          plot(
            ".",
            nx + (b[0] * w - nx) * t,
            ny + (b[1] * h - ny) * t,
            0.13 * (1 - absorb),
          );
        }
        label(indicatorText[a], nx, ny, 1 - absorb);
        for (let j = 0; j < 23; j++) {
          const t = absorb,
            s = absorb * Math.PI * 1.6 + a * 2.1,
            r = (1 - t) * Math.hypot(nx - cx, ny - cy),
            base = Math.atan2(ny - cy, nx - cx);
          const spread = (j - 11) * 2 * (1 - t);
          const x = cx + Math.cos(base + s * t) * r + spread,
            y = cy + Math.sin(base + s * t) * r + Math.sin(j) * spread * 0.25;
          plot(
            indicatorText[a][j % indicatorText[a].length],
            x,
            y,
            absorb > 0.03 ? 0.65 : 0.1,
          );
        }
      }
    }
    // A single growing orb mixes actual example indicator characters on its surface.
    const angle = time * 0.17 + (mouse.x - 0.5) * mouse.strength * 0.8,
      c = Math.cos(angle),
      s = Math.sin(angle),
      tilt = (mouse.y - 0.5) * mouse.strength * 0.55;
    for (const p of points) {
      const ripple =
        0.07 * Math.sin(p.y * 7 + time * (next === "mix" ? 1.6 : 0.65));
      const x = p.x * (1 + ripple),
        y = p.y * (1 + ripple),
        z = p.z;
      const rx = x * c + z * s,
        rz = -x * s + z * c;
      const ry = y * Math.cos(tilt) - rz * Math.sin(tilt),
        depth = 5 / (5 - rz);
      p.px = cx + rx * radius * depth;
      p.py = cy + ry * radius * depth;
      p.depth = rz;
    }
    sorted.sort((a, b) => a.depth - b.depth);
    ctx.font = "10px monospace";
    const merged = indicatorText.join("");
    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i],
        shade = Math.max(0, Math.min(23, Math.round(((p.depth + 1) / 2) * 23)));
      ctx.fillStyle = colors[shade];
      ctx.fillText(
        next === "mix" ? merged[i % merged.length] : p.g,
        p.px,
        p.py,
      );
    }
    // The output is a brief, not an autonomous response action.
    if (elapsed >= 6.4) {
      const ends = [
          [0.86, 0.28],
          [0.86, 0.52],
          [0.86, 0.77],
        ],
        verbs = ["VALIDATE", "CORRELATE", "ESCALATE"];
      ctx.font = "10px monospace";
      for (let a = 0; a < 3; a++) {
        const end = ends[a];
        for (let j = 0; j < 16; j++) {
          const t = (j / 15) * emit;
          plot(
            ".",
            cx + radius + (end[0] * w - cx - radius) * t,
            cy + (end[1] * h - cy) * t,
            0.12 * emit,
          );
        }
        for (let j = 0; j < 4; j++) {
          const t = (time * 0.22 + j / 4) % 1;
          plot(
            "+:01"[j],
            cx + radius + (end[0] * w - cx - radius) * t,
            cy + (end[1] * h - cy) * t,
            Math.sin(t * Math.PI) * 0.7 * emit,
          );
        }
        label(verbs[a], end[0] * w, end[1] * h, emit);
      }
    }
    canvas.dataset.pointer = mouse.active ? "active" : "idle";
    canvas.dataset.radius = radius.toFixed(2);
    canvas.dataset.progress = Math.min(1, elapsed / 8.8).toFixed(3);
    elapsed = savedElapsed;
  }
  function tick(dt) {
    time += dt;
    elapsed = Math.min(9.4, elapsed + dt);
    const b = 1 - Math.exp(-dt * 8);
    mouse.x += (mouse.tx - mouse.x) * b;
    mouse.y += (mouse.ty - mouse.y) * b;
    mouse.strength += ((mouse.active ? 1 : 0) - mouse.strength) * b;
    draw();
  }
  function wake() {
    lifecycle.refresh();
  }
  function stop() {
    lifecycle.refresh();
  }
  function sync() {
    pause.disabled = reduce.matches;
    pause.textContent = reduce.matches
      ? "Motion reduced"
      : paused
        ? "Resume correlation"
        : "Pause correlation";
    pause.setAttribute("aria-pressed", String(paused));
  }
  pause.addEventListener("click", () => {
    paused = !paused;
    sync();
    if (paused) stop();
    else wake();
  });
  replay.addEventListener("click", () => {
    elapsed = 0;
    stage = "";
    draw();
    wake();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!fine.matches || paused || reduce.matches) return;
    const r = canvas.getBoundingClientRect();
    mouse.tx = (e.clientX - r.left) / w;
    mouse.ty = (e.clientY - r.top) / h;
    mouse.active = true;
    wake();
  });
  canvas.addEventListener("pointerleave", () => {
    mouse.active = false;
    wake();
  });
  const resize = new ResizeObserver(() => {
    size();
    draw();
  });
  resize.observe(canvas);
  function preference() {
    mouse.active = false;
    mouse.strength = 0;
    sync();
    draw();
  }
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
  size();
  draw();
  sync();
})();
