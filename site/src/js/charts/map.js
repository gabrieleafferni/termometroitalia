import * as d3 from "d3";
import { reducedMotion } from "../lib/ui.js";

/**
 * Mappa luminosa dei distributori: ogni punto è un impianto, il colore dice
 * quanto il suo prezzo si discosta dalla media nazionale del giorno.
 * Disegnata su <canvas> (20.000+ punti) con alone additivo, zoom e hover.
 */

export const DIVERGING = ["#2de0e6", "#56607a", "#ff3d7f"]; // economico · in media · caro
const N_BUCKETS = 25;
const CITTA = [
  ["Milano", 9.19, 45.464], ["Torino", 7.686, 45.07], ["Genova", 8.934, 44.405], ["Venezia", 12.316, 45.44],
  ["Bologna", 11.342, 44.494], ["Firenze", 11.256, 43.77], ["Roma", 12.496, 41.903], ["Napoli", 14.268, 40.852],
  ["Bari", 16.871, 41.117], ["Palermo", 13.361, 38.116], ["Cagliari", 9.11, 39.223], ["Reggio C.", 15.65, 38.11],
];

export function colorScale(range) {
  const interp = d3.piecewise(d3.interpolateRgb.gamma(1.6), DIVERGING);
  return {
    range,
    bucket(diff) {
      const t = Math.max(-1, Math.min(1, diff / range));
      return Math.round(((t + 1) / 2) * (N_BUCKETS - 1));
    },
    colors: d3.range(N_BUCKETS).map((i) => interp(i / (N_BUCKETS - 1))),
    css: `linear-gradient(90deg, ${DIVERGING[0]}, ${DIVERGING[1]} 50%, ${DIVERGING[2]})`,
  };
}

function haloSprite(color, size = 64) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const rgb = d3.rgb(color);
  grd.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},0.30)`);
  grd.addColorStop(0.3, `rgba(${rgb.r},${rgb.g},${rgb.b},0.08)`);
  grd.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return c;
}

export function glowMap(container, opts) {
  const {
    stations, // [{lat, lon, ...}]
    regions, // GeoJSON FeatureCollection
    value, // (s) => prezzo o null
    reference, // numero: media nazionale
    range = 0.06, // ±6 centesimi a saturazione
    interactive = true,
    ambient = false,
    labels = true,
    onHover = () => {},
    onSelect = null, // clic o tocco su un distributore (null = clic nel vuoto)
  } = opts;

  const canvas = document.createElement("canvas");
  const overlay = document.createElement("canvas");
  overlay.style.pointerEvents = "none";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", opts.ariaLabel || "Mappa dei distributori di carburante in Italia");
  container.append(canvas, overlay);
  const ctx = canvas.getContext("2d");
  const octx = overlay.getContext("2d");

  let W = 0, H = 0, dpr = 1;
  let projection, path, xs, ys, quadtree;
  let transform = d3.zoomIdentity;
  let scale = colorScale(range);
  let sprites = scale.colors.map((c) => haloSprite(c));
  let getValue = value, ref = reference;
  let buckets = new Int16Array(stations.length);
  let revealAt = new Float32Array(stations.length);
  let progress = reducedMotion() ? 1 : 0;
  let hovered = -1;
  let selected = -1;
  let highlighted = [];
  let baseImage = null; // per la modalità ambient

  const order = d3.shuffle(d3.range(stations.length));
  // l'Italia "si accende" da sud a nord, con un po' di casualità
  const latExt = d3.extent(stations, (s) => s.lat);
  stations.forEach((s, i) => {
    revealAt[i] = 0.78 * ((s.lat - latExt[0]) / (latExt[1] - latExt[0])) + 0.22 * Math.random();
  });

  function computeBuckets() {
    for (let i = 0; i < stations.length; i++) {
      const v = getValue(stations[i]);
      buckets[i] = v == null ? -1 : scale.bucket(v - ref);
    }
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = container.clientWidth;
    H = container.clientHeight;
    for (const c of [canvas, overlay]) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
      c.style.position = "absolute";
      c.style.inset = "0";
      c.style.width = `${W}px`;
      c.style.height = `${H}px`;
    }
    const pad = Math.max(12, Math.min(W, H) * 0.04);
    projection = d3.geoTransverseMercator().rotate([-12.5, -42]).fitExtent([[pad, pad], [W - pad, H - pad]], regions);
    path = d3.geoPath(projection);
    xs = new Float32Array(stations.length);
    ys = new Float32Array(stations.length);
    stations.forEach((s, i) => {
      const [x, y] = projection([s.lon, s.lat]);
      xs[i] = x;
      ys[i] = y;
    });
    quadtree = d3.quadtree(d3.range(stations.length), (i) => xs[i], (i) => ys[i]);
    if (zoom) {
      zoom.extent([[0, 0], [W, H]]).translateExtent([[-W * 0.1, -H * 0.1], [W * 1.1, H * 1.1]]);
    }
    baseImage = null;
    draw();
  }

  function drawRegions(g, t) {
    g.save();
    g.translate(t.x, t.y);
    g.scale(t.k, t.k);
    g.beginPath();
    d3.geoPath(projection, g)(regions);
    g.fillStyle = "rgba(22, 32, 66, 0.45)";
    g.fill();
    g.lineWidth = 0.7 / t.k;
    g.strokeStyle = "rgba(125, 150, 225, 0.28)";
    g.stroke();
    g.restore();
  }

  function draw() {
    if (!W) return;
    const t = transform;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawRegions(ctx, t);

    const zoomBoost = Math.log2(t.k);
    const core = Math.min(3.2, 0.95 + zoomBoost * 0.45);
    const R = Math.min(22, (Math.min(W, H) / 150) * (1 + zoomBoost * 0.35));

    // 1) aloni (additivi): è qui che nasce il "bagliore"
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = t.k > 6 ? 0.5 : 0.75;
    for (let j = 0; j < order.length; j++) {
      const i = order[j];
      const b = buckets[i];
      if (b < 0 || revealAt[i] > progress) continue;
      const x = t.x + xs[i] * t.k, y = t.y + ys[i] * t.k;
      if (x < -R || y < -R || x > W + R || y > H + R) continue;
      ctx.drawImage(sprites[b], x - R, y - R, 2 * R, 2 * R);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    // 2) nuclei, raggruppati per colore
    const byBucket = Array.from({ length: N_BUCKETS + 1 }, () => []);
    for (let i = 0; i < stations.length; i++) {
      if (revealAt[i] > progress) continue;
      byBucket[buckets[i] + 1].push(i);
    }
    for (let b = 0; b <= N_BUCKETS; b++) {
      const list = byBucket[b];
      if (!list.length) continue;
      ctx.fillStyle = b === 0 ? "rgba(125, 137, 163, 0.35)" : scale.colors[b - 1];
      ctx.beginPath();
      for (const i of list) {
        const x = t.x + xs[i] * t.k, y = t.y + ys[i] * t.k;
        if (x < -4 || y < -4 || x > W + 4 || y > H + 4) continue;
        ctx.moveTo(x + core, y);
        ctx.arc(x, y, core, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    if (labels && W >= 520) drawLabels(t);
    drawOverlay();
  }

  function drawLabels(t) {
    ctx.font = "500 11px 'JetBrains Mono', monospace";
    ctx.textBaseline = "middle";
    for (const [name, lon, lat] of CITTA) {
      const p = projection([lon, lat]);
      const x = t.x + p[0] * t.k, y = t.y + p[1] * t.k;
      if (x < 0 || y < 0 || x > W - 60 || y > H) continue;
      ctx.fillStyle = "rgba(5, 7, 15, 0.75)";
      const w = ctx.measureText(name).width;
      ctx.fillRect(x + 7, y - 8, w + 8, 16);
      ctx.fillStyle = "rgba(230, 237, 247, 0.82)";
      ctx.fillText(name, x + 11, y);
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function ring(g, i, color, r) {
    const t = transform;
    const x = t.x + xs[i] * t.k, y = t.y + ys[i] * t.k;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.lineWidth = 2;
    g.strokeStyle = "#05070f";
    g.stroke();
    g.beginPath();
    g.arc(x, y, r + 1.5, 0, Math.PI * 2);
    g.lineWidth = 1.5;
    g.strokeStyle = color;
    g.stroke();
  }

  function drawOverlay() {
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.clearRect(0, 0, W, H);
    for (const i of highlighted) ring(octx, i, "#e6edf7", 6);
    if (selected >= 0) {
      ring(octx, selected, "#ffffff", 9);
      ring(octx, selected, "#ffffff", 4);
    }
    if (hovered >= 0) ring(octx, hovered, "#ffffff", 8);
  }

  // ---------- interazione ----------
  let zoom = null;
  if (interactive) {
    zoom = d3
      .zoom()
      .scaleExtent([1, 80])
      // su touch: un dito scorre la pagina, due dita zoomano la mappa
      // la rotella da sola scorre la pagina: zoom con Ctrl/⌘ + rotella o pinch del trackpad
      .filter((e) => {
        if (e.type === "wheel") return e.ctrlKey || e.metaKey;
        if (e.type === "touchstart") return e.touches.length > 1;
        return !e.button;
      })
      .on("zoom", (e) => {
        transform = e.transform;
        draw();
      });
    d3.select(canvas).call(zoom);

    canvas.addEventListener("pointermove", (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const bx = (mx - transform.x) / transform.k, by = (my - transform.y) / transform.k;
      const i = quadtree.find(bx, by, 14 / transform.k);
      const idx = i === undefined ? -1 : i;
      if (idx !== hovered) {
        hovered = idx;
        drawOverlay();
      }
      onHover(idx >= 0 ? stations[idx] : null, e.clientX, e.clientY);
    });
    canvas.addEventListener("pointerleave", () => {
      hovered = -1;
      drawOverlay();
      onHover(null);
    });

    // clic (o tocco) su un punto: seleziona il distributore. d3.zoom non genera
    // il click dopo un trascinamento, quindi spostare la mappa non seleziona nulla.
    if (onSelect) {
      canvas.addEventListener("click", (e) => {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const bx = (mx - transform.x) / transform.k, by = (my - transform.y) / transform.k;
        // raggio più largo al tocco: il dito è meno preciso del mouse
        const r = (e.pointerType === "touch" ? 24 : 14) / transform.k;
        const i = quadtree.find(bx, by, r);
        const idx = i === undefined || buckets[i] < 0 ? -1 : i;
        selected = idx;
        drawOverlay();
        onSelect(idx >= 0 ? stations[idx] : null);
      });
    }
  }

  // ---------- modalità ambient (home): scintillio leggero ----------
  let raf = null;
  function ambientLoop() {
    const sparks = d3.range(90).map(() => ({ i: Math.floor(Math.random() * stations.length), t0: performance.now() + Math.random() * 3000 }));
    const tick = (now) => {
      if (!baseImage) {
        draw();
        baseImage = document.createElement("canvas");
        baseImage.width = canvas.width;
        baseImage.height = canvas.height;
        baseImage.getContext("2d").drawImage(canvas, 0, 0);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(baseImage, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = "lighter";
      for (const s of sparks) {
        const age = (now - s.t0) / 1600;
        if (age < 0) continue;
        if (age > 1) {
          s.i = Math.floor(Math.random() * stations.length);
          s.t0 = now + Math.random() * 1200;
          continue;
        }
        const b = buckets[s.i];
        if (b < 0) continue;
        const a = Math.sin(age * Math.PI);
        const R = (Math.min(W, H) / 60) * (0.6 + a);
        ctx.globalAlpha = a * 0.9;
        ctx.drawImage(sprites[b], xs[s.i] - R, ys[s.i] - R, 2 * R, 2 * R);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  function intro(done) {
    if (progress >= 1) return done();
    const t0 = performance.now();
    const dur = 2400;
    const step = (now) => {
      progress = Math.min(1, (now - t0) / dur);
      draw();
      if (progress < 1) requestAnimationFrame(step);
      else done();
    };
    requestAnimationFrame(step);
  }

  computeBuckets();
  resize();
  const ro = new ResizeObserver(() => {
    if (Math.abs(container.clientWidth - W) > 2 || Math.abs(container.clientHeight - H) > 2) resize();
  });
  ro.observe(container);

  // parte l'animazione quando la mappa entra nello schermo
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      io.disconnect();
      intro(() => {
        if (ambient && !reducedMotion()) ambientLoop();
      });
    }
  });
  io.observe(container);

  return {
    scale: () => scale,
    setValue(fn, reference2) {
      getValue = fn;
      ref = reference2;
      computeBuckets();
      baseImage = null;
      draw();
    },
    select(i) {
      selected = i ?? -1;
      drawOverlay();
    },
    highlight(indices) {
      highlighted = indices;
      drawOverlay();
    },
    focus(indices, { duration = 900 } = {}) {
      if (!zoom) return;
      if (!indices.length) return;
      // riquadro robusto: ignora eventuali coordinate sbagliate (5°–95° percentile)
      const qx = indices.map((i) => xs[i]).sort(d3.ascending), qy = indices.map((i) => ys[i]).sort(d3.ascending);
      const lo = indices.length >= 8 ? 0.05 : 0, hi = indices.length >= 8 ? 0.95 : 1;
      const ext = [[d3.quantile(qx, lo), d3.quantile(qx, hi)], [d3.quantile(qy, lo), d3.quantile(qy, hi)]];
      const dx = Math.max(ext[0][1] - ext[0][0], 6), dy = Math.max(ext[1][1] - ext[1][0], 6);
      const cx = (ext[0][0] + ext[0][1]) / 2, cy = (ext[1][0] + ext[1][1]) / 2;
      const k = Math.max(1, Math.min(60, 0.55 / Math.max(dx / W, dy / H)));
      const target = d3.zoomIdentity.translate(W / 2, H / 2).scale(k).translate(-cx, -cy);
      d3.select(canvas).transition().duration(reducedMotion() ? 0 : duration).call(zoom.transform, target);
    },
    zoomBy(k) {
      if (zoom) d3.select(canvas).transition().duration(reducedMotion() ? 0 : 350).call(zoom.scaleBy, k);
    },
    reset() {
      if (zoom) d3.select(canvas).transition().duration(reducedMotion() ? 0 : 700).call(zoom.transform, d3.zoomIdentity);
      highlighted = [];
      drawOverlay();
    },
    indexOf(s) {
      return stations.indexOf(s);
    },
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
    },
  };
}
