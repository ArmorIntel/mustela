import { observeScene } from "./scene-loop.js";
(() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)"),
    fine = matchMedia("(hover: hover) and (pointer: fine)"),
    instances = [];
  const chars = ".:+*#01",
    hex = "0123456789abcdef",
    count = 420;
  function make(canvas) {
    const ctx = canvas.getContext("2d"),
      kind = canvas.dataset.art;
    let w = 0,
      h = 0,
      paused = false,
      mode = kind === "detect" ? "IP" : kind === "act" ? "NOTE" : "SOURCES",
      oldMode = mode,
      progress = 1,
      time = 0;
    const mouse = {
      active: false,
      x: 0.5,
      y: 0.5,
      tx: 0.5,
      ty: 0.5,
      strength: 0,
    };
    const current = Array.from({ length: count }, (_, i) => noise(i)),
      from = current.map((p) => ({ ...p }));
    const pause = canvas.parentElement.querySelector(".art-pause");
    function noise(i) {
      return {
        x: 0.06 + (((i * 47) % 421) / 421) * 0.88,
        y: 0.13 + (((i * 73) % 419) / 419) * 0.74,
      };
    }
    function edge(a, b, t, bend = 0) {
      return {
        x: a[0] + (b[0] - a[0]) * t,
        y: a[1] + (b[1] - a[1]) * t + Math.sin(t * Math.PI) * bend,
      };
    }
    function box(i, cx, cy, rx, ry, n = 88) {
      const t = ((i % n) / n) * 4;
      return t < 1
        ? { x: cx - rx + t * 2 * rx, y: cy - ry }
        : t < 2
          ? { x: cx + rx, y: cy - ry + (t - 1) * 2 * ry }
          : t < 3
            ? { x: cx + rx - (t - 2) * 2 * rx, y: cy + ry }
            : { x: cx - rx, y: cy + ry - (t - 3) * 2 * ry };
    }
    function geometry(i, m) {
      if (kind === "detect" && m === "IP") {
        if (i < 352) {
          const group = Math.floor(i / 88);
          return box(i, 0.17 + group * 0.22, 0.43, 0.075, 0.1);
        }
        return { x: 0.16 + ((i - 352) / 67) * 0.68, y: 0.67 };
      }
      if (kind === "detect" && m === "DOMAIN") {
        const nodes = [
            [0.5, 0.15],
            [0.5, 0.42],
            [0.22, 0.72],
            [0.78, 0.72],
            [0.1, 0.9],
            [0.9, 0.9],
          ],
          pairs = [
            [0, 1],
            [1, 2],
            [1, 3],
            [2, 4],
            [3, 5],
          ],
          pair = pairs[Math.floor(i / 84)];
        return edge(nodes[pair[0]], nodes[pair[1]], (i % 84) / 83, 0.01);
      }
      if (kind === "detect" && m === "HASH")
        return {
          x: 0.08 + ((i % 28) / 27) * 0.84,
          y: 0.13 + (Math.floor(i / 28) / 14) * 0.74,
        };
      if (kind === "enrich") {
        if (i < 240) {
          const arm = Math.floor(i / 60),
            nodes = [
              [0.16, 0.22],
              [0.84, 0.22],
              [0.84, 0.8],
              [0.16, 0.8],
            ];
          return edge(
            nodes[arm],
            [0.5, 0.51],
            (i % 60) / 59,
            (arm % 2 ? 1 : -1) * 0.085,
          );
        }
        const a = ((i - 240) / 180) * Math.PI * 2;
        return { x: 0.5 + Math.cos(a) * 0.105, y: 0.51 + Math.sin(a) * 0.15 };
      }
      // A shared investigation moves into a note, serialized export, or MISP event.
      if (i < 60) return box(i, 0.16, 0.49, 0.085, 0.14, 60);
      if (i < 120)
        return edge([0.26, 0.49], [0.52, 0.49], (i - 60) / 59, 0.012);
      if (m === "NOTE" || m === "JSON") {
        if (i < 280) return box(i - 120, 0.72, 0.49, 0.19, 0.29, 160);
        const line = Math.floor((i - 280) / 28),
          u = ((i - 280) % 28) / 27;
        return {
          x: 0.57 + u * (m === "NOTE" ? 0.28 - line * 0.026 : 0.27),
          y: 0.31 + line * 0.09,
        };
      }
      if (i < 260) return box(i - 120, 0.73, 0.49, 0.19, 0.29, 140);
      if (i < 340) return box(i - 260, 0.73, 0.43, 0.13, 0.07, 80);
      return box(i - 340, 0.73, 0.63, 0.13, 0.07, 80);
    }
    function size() {
      const r = canvas.getBoundingClientRect();
      w = r.width;
      h = r.height;
      const d = Math.min(devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(w * d);
      canvas.height = Math.round(h * d);
      ctx.setTransform(d, 0, 0, d, 0, 0);
    }
    function plot(ch, p, alpha = 0.5, color = false) {
      let x = p.x * w,
        y = p.y * h,
        hit = 0;
      if (mouse.strength > 0.001) {
        const dx = x - mouse.x * w,
          dy = y - mouse.y * h,
          d = Math.hypot(dx, dy);
        hit = Math.max(0, 1 - d / 105) * mouse.strength;
        if (d > 1) {
          x += (dx / d) * hit * 13;
          y += (dy / d) * hit * 13;
        }
      }
      ctx.fillStyle = `rgba(${color ? "152,181,255" : "103,136,205"},${Math.min(1, alpha + hit * 0.4)})`;
      ctx.fillText(ch, x, y);
    }
    function label(text, x, y, alpha = 1) {
      if (alpha < 0.01) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `${w < 400 ? 11 : 12}px monospace`;
      const dx = (mouse.x - 0.5) * mouse.strength * 4,
        dy = (mouse.y - 0.5) * mouse.strength * 3;
      const width = ctx.measureText(text).width;
      ctx.fillStyle = "#080b11";
      ctx.fillRect(x * w - width / 2 - 7 + dx, y * h - 12 + dy, width + 14, 24);
      ctx.fillStyle = "#d1dfff";
      ctx.fillText(text, x * w + dx, y * h + 4 + dy);
      ctx.restore();
    }
    function labels(m, a) {
      if (kind === "detect") {
        if (m === "IP") {
          ["203", "0", "113", "42"].forEach((s, i) =>
            label(s, 0.17 + i * 0.22, 0.43, a),
          );
          label("203.0.113.42", 0.5, 0.78, a);
        } else if (m === "DOMAIN") {
          [
            ["org", 0.5, 0.13],
            ["example.org", 0.5, 0.42],
            ["update", 0.22, 0.72],
            ["mail", 0.78, 0.72],
          ].forEach((e) => label(...e, a));
        } else label("SHA256", 0.5, 0.5, a);
      } else if (kind === "enrich") {
        [
          ["VirusTotal", 0.16, 0.12],
          ["AbuseIPDB", 0.84, 0.12],
          ["Shodan", 0.84, 0.9],
          ["MISP", 0.16, 0.9],
          ["GLOBAL VERDICT", 0.5, 0.51],
        ].forEach((e) => label(...e, a));
      } else {
        label("IOC", 0.16, 0.49, a);
        if (m === "NOTE") {
          label("Analyst note", 0.72, 0.14, a);
          label("Correlate process", 0.72, 0.4, a);
          label("Confirm activity", 0.72, 0.59, a);
        } else if (m === "JSON") {
          label("investigation.json", 0.72, 0.14, a);
          label('{ "ioc":', 0.71, 0.34, a);
          label('"203.0.113.42",', 0.72, 0.49, a);
          label('"score": 92 }', 0.72, 0.67, a);
        } else {
          label("MISP event", 0.72, 0.14, a);
          label("event", 0.73, 0.42, a);
          label("ip-dst attribute", 0.73, 0.63, a);
        }
      }
    }
    function draw() {
      ctx.clearRect(0, 0, w, h);
      ctx.font = "9px monospace";
      ctx.textAlign = "center";
      const ease = reduce.matches ? 1 : 1 - Math.pow(1 - progress, 5);
      for (let i = 0; i < count; i++) {
        const dest = geometry(i, mode),
          a = from[i];
        current[i].x = a.x + (dest.x - a.x) * ease;
        current[i].y = a.y + (dest.y - a.y) * ease;
        const alpha =
          kind === "enrich" && i < 240 ? 0.13 : i % 11 < 3 ? 0.65 : 0.32;
        plot(
          kind === "detect" && mode === "HASH" ? hex[i % 16] : chars[i % 7],
          current[i],
          alpha,
        );
      }
      if (progress > 0.6 && !reduce.matches) {
        ctx.font = "10px monospace";
        if (kind === "enrich") {
          const starts = [
            [0.16, 0.22],
            [0.84, 0.22],
            [0.84, 0.8],
            [0.16, 0.8],
          ];
          for (let a = 0; a < 4; a++)
            for (let j = 0; j < 5; j++) {
              const t = (time * 0.17 + j / 5 + a * 0.13) % 1,
                fade = Math.sin(t * Math.PI) * 0.85;
              plot(
                "+:*"[j % 3],
                edge(starts[a], [0.5, 0.51], t, (a % 2 ? 1 : -1) * 0.085),
                fade,
                true,
              );
            }
        } else if (kind === "act") {
          for (let j = 0; j < 5; j++) {
            const t = (time * 0.25 + j / 5) % 1;
            plot(
              j % 2 ? "1" : "0",
              edge([0.26, 0.49], [0.53, 0.49], t, 0.012),
              Math.sin(t * Math.PI) * 0.9,
              true,
            );
          }
        }
      }
      if (oldMode !== mode) labels(oldMode, Math.max(0, 1 - progress * 3));
      labels(
        mode,
        oldMode === mode ? 1 : Math.max(0, Math.min(1, (progress - 0.1) / 0.7)),
      );
      canvas.dataset.variant = mode;
      canvas.dataset.progress = progress.toFixed(3);
      canvas.dataset.pointer = mouse.active ? "active" : "idle";
    }
    function stop() {
      lifecycle.refresh();
    }
    function tick(dt) {
      time += dt;
      progress = Math.min(1, progress + dt / 1.25);
      const blend = 1 - Math.exp(-dt * 9);
      mouse.x += (mouse.tx - mouse.x) * blend;
      mouse.y += (mouse.ty - mouse.y) * blend;
      mouse.strength += ((mouse.active ? 1 : 0) - mouse.strength) * blend;
      draw();
    }
    function wake() {
      lifecycle.refresh();
    }
    function change(next = mode, replay = false) {
      if (next === mode && !replay) return;
      oldMode = mode;
      mode = next;
      for (let i = 0; i < count; i++)
        from[i] = replay ? noise(i) : { ...current[i] };
      progress = reduce.matches ? 1 : 0;
      if (reduce.matches || paused) {
        progress = 1;
        draw();
      } else wake();
    }
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
    pause.addEventListener("click", () => {
      paused = !paused;
      pause.setAttribute("aria-pressed", String(paused));
      pause.textContent = paused ? "Resume motion" : "Pause motion";
      if (paused) stop();
      else wake();
    });
    canvas.parentElement
      .querySelector(".art-replay")
      .addEventListener("click", () => change(mode, true));
    const resize = new ResizeObserver(() => {
      size();
      draw();
    });
    resize.observe(canvas);
    function preference() {
      pause.disabled = reduce.matches;
      mouse.active = false;
      mouse.strength = 0;
      const saved = progress;
      if (reduce.matches) progress = 1;
      draw();
      progress = saved;
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
    pause.disabled = reduce.matches;
    size();
    draw();
    return { kind, change };
  }
  document
    .querySelectorAll("[data-art]")
    .forEach((c) => instances.push(make(c)));
  const typeDescriptions = {
    IP: "Four octets. One IPv4 indicator.",
    DOMAIN: "A domain name unfolds into a hierarchy. No live DNS lookup.",
    HASH: "Hashes assemble into a structured fingerprint.",
  };
  const descriptions = {
    NOTE: "Attach your rationale to the indicator, with an analyst note stored locally.",
    JSON: "Serialize the indicator, provider evidence and note into an investigation export.",
    MISP: "Add the IOC as an attribute in your configured MISP event, through an explicit action.",
  };
  function wire(selector, key, kind, descriptions, target) {
    document.querySelectorAll(selector).forEach((b) => {
      const select = () => {
        document
          .querySelectorAll(selector)
          .forEach((el) => el.setAttribute("aria-pressed", String(el === b)));
        document.querySelector(target).textContent =
          descriptions[b.dataset[key]];
        instances.find((i) => i.kind === kind).change(b.dataset[key]);
      };
      b.addEventListener("pointerenter", () => {
        if (fine.matches) select();
      });
      b.addEventListener("focus", select);
      b.addEventListener("click", select);
    });
  }
  wire("[data-type]", "type", "detect", typeDescriptions, "#type-description");
  wire("[data-action]", "action", "act", descriptions, "#action-description");
})();
