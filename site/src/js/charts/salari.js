import * as d3 from "d3";
import { tooltip, ttTitle, onResize } from "../lib/ui.js";

const pct1 = (x) => {
  const s = (Math.abs(x) * 100).toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return (x > 0.0005 ? "+" : x < -0.0005 ? "−" : "") + s + "%";
};

/** Accorcia un testo SVG con i puntini di sospensione finché non sta in maxW pixel. */
function adatta(nodo, maxW) {
  if (!nodo.getComputedTextLength || nodo.getComputedTextLength() <= maxW) return;
  const pieno = nodo.textContent;
  let n = pieno.length;
  while (n > 3 && nodo.getComputedTextLength() > maxW) nodo.textContent = pieno.slice(0, --n).trimEnd() + "…";
  const t = document.createElementNS("http://www.w3.org/2000/svg", "title");
  t.textContent = pieno;
  nodo.append(t);
}

/** Barra orizzontale con l'estremo "dato" arrotondato (4 px), ancorata allo zero. */
function barPath(x0, x1, yTop, h, r = 4) {
  const dir = x1 >= x0 ? 1 : -1;
  const len = Math.abs(x1 - x0);
  const rr = Math.min(r, len, h / 2);
  if (len < 0.5) return `M${x0},${yTop}h0v${h}h0Z`;
  const xe = x1 - dir * rr;
  return `M${x0},${yTop}H${xe}Q${x1},${yTop} ${x1},${yTop + rr}V${yTop + h - rr}Q${x1},${yTop + h} ${xe},${yTop + h}H${x0}Z`;
}

/**
 * Barre orizzontali con una linea verticale di riferimento (es. l'inflazione):
 * una barra che non arriva alla linea è una perdita di potere d'acquisto.
 * rows: [{ key, label, value, evidenza?, nota? }]   value in frazione (0,12 = +12%)
 * ref: { value, label }   opzionale
 * format: (v) => testo dell'etichetta a fine barra
 * tooltip: (row, t) => contenuto del tooltip
 */
export function refBars(container, { rows, ref = null, color, colorEvidenza = null, format = pct1, tooltip: tt, describe, rowH = 26, labelW = 200 }) {
  const tip = tooltip();

  function render() {
    d3.select(container).selectAll("svg").remove();
    const W = container.clientWidth;
    const lw = Math.min(labelW, W * 0.4);
    const m = { top: ref ? 34 : 14, right: 58, bottom: 8, left: lw + 10 };
    const w = Math.max(60, W - m.left - m.right);
    const H = m.top + rows.length * rowH + m.bottom;
    const lo = Math.min(0, d3.min(rows, (r) => r.value));
    const hi = Math.max(ref ? ref.value : 0, d3.max(rows, (r) => r.value));
    const x = d3.scaleLinear().domain([lo, hi]).range([0, w]).nice(4);
    const barH = Math.min(14, rowH - 10);

    const svg = d3.select(container).append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img")
      .attr("aria-label", describe || "Grafico a barre");
    const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);

    const ticks = x.ticks(W < 480 ? 3 : 5);
    g.append("g").attr("class", "grid").selectAll("line").data(ticks).join("line")
      .attr("x1", (d) => x(d)).attr("x2", (d) => x(d)).attr("y1", -4).attr("y2", rows.length * rowH);
    if (!ref) {
      g.append("g").selectAll("text").data(ticks).join("text").attr("class", "tick-label")
        .attr("x", (d) => x(d)).attr("y", -4).attr("text-anchor", "middle").text((d) => format(d));
    }

    const row = g.selectAll("g.row").data(rows).join("g").attr("class", "row")
      .attr("transform", (_, i) => `translate(0,${i * rowH})`);
    row.append("text").attr("class", "label-2").attr("x", -10).attr("y", rowH / 2).attr("dy", "0.35em")
      .attr("text-anchor", "end").style("fill", "var(--text)")
      .style("font-size", W < 480 ? "12px" : "13px").style("font-weight", (r) => (r.evidenza ? 600 : 400))
      .text((r) => r.label)
      .each(function () { adatta(this, lw - 4); });
    row.append("path").attr("d", (r) => barPath(x(0), x(r.value), (rowH - barH) / 2, barH))
      .attr("fill", (r) => (r.evidenza && colorEvidenza ? colorEvidenza : color))
      .attr("fill-opacity", (r) => (r.evidenza ? 1 : 0.85));
    row.append("text").attr("class", "tick-label").style("fill", "var(--text-2)")
      .attr("x", (r) => x(Math.max(r.value, 0)) + 6).attr("y", rowH / 2).attr("dy", "0.35em")
      .text((r) => format(r.value));
    g.append("line").attr("class", "zero").attr("x1", x(0)).attr("x2", x(0)).attr("y1", -4).attr("y2", rows.length * rowH);

    if (ref) {
      const rx = x(ref.value);
      g.append("line").attr("x1", rx).attr("x2", rx).attr("y1", -8).attr("y2", rows.length * rowH)
        .attr("stroke", "var(--text)").attr("stroke-width", 1.5).attr("stroke-dasharray", "4 3");
      const anchorEnd = rx > w * 0.6;
      g.append("text").attr("class", "label-2").style("fill", "var(--text)").style("font-size", "12px")
        .attr("x", rx + (anchorEnd ? -6 : 6)).attr("y", -14).attr("text-anchor", anchorEnd ? "end" : "start")
        .text(ref.label);
    }

    row.append("rect").attr("x", -m.left).attr("width", W).attr("height", rowH).attr("fill", "transparent")
      .on("pointermove", function (e, r) {
        d3.select(this.parentNode).select("path").attr("fill-opacity", 1).attr("stroke", "#fff").attr("stroke-width", 1);
        if (tt) tip.show((t) => tt(r, t), e.clientX, e.clientY);
      })
      .on("pointerleave", function (_, r) {
        d3.select(this.parentNode).select("path").attr("fill-opacity", r.evidenza ? 1 : 0.85).attr("stroke", null);
        tip.hide();
      });
  }

  render();
  onResize(container, render);
}

/**
 * Intervalli: per ogni riga una linea dal 1° al 9° decile, un punto sulla mediana
 * e una tacca sulla media.
 * rows: [{ key, label, d1, me, mm, d9, evidenza? }]   valori in euro all'ora
 */
export function rangeDots(container, { rows, color, describe, tooltip: tt, rowH = 26, labelW = 200 }) {
  const tip = tooltip();
  const euro = (v) => v.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function render() {
    d3.select(container).selectAll("svg").remove();
    const W = container.clientWidth;
    const lw = Math.min(labelW, W * 0.4);
    const m = { top: 22, right: 18, bottom: 8, left: lw + 10 };
    const w = Math.max(60, W - m.left - m.right);
    const H = m.top + rows.length * rowH + m.bottom;
    const x = d3.scaleLinear().domain([0, d3.max(rows, (r) => r.d9)]).range([0, w]).nice(5);

    const svg = d3.select(container).append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img")
      .attr("aria-label", describe || "Paga oraria per settore");
    const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);
    const ticks = x.ticks(W < 480 ? 3 : 6);
    g.append("g").attr("class", "grid").selectAll("line").data(ticks).join("line")
      .attr("x1", (d) => x(d)).attr("x2", (d) => x(d)).attr("y1", -4).attr("y2", rows.length * rowH);
    g.append("g").selectAll("text").data(ticks).join("text").attr("class", "tick-label")
      .attr("x", (d) => x(d)).attr("y", -8).attr("text-anchor", "middle").text((d) => `${d} €`);

    const row = g.selectAll("g.row").data(rows).join("g").attr("class", "row")
      .attr("transform", (_, i) => `translate(0,${i * rowH})`);
    row.append("text").attr("class", "label-2").attr("x", -10).attr("y", rowH / 2).attr("dy", "0.35em")
      .attr("text-anchor", "end").style("fill", "var(--text)").style("font-size", W < 480 ? "12px" : "13px")
      .style("font-weight", (r) => (r.evidenza ? 600 : 400)).text((r) => r.label)
      .each(function () { adatta(this, lw - 4); });
    const cy = rowH / 2;
    row.append("line").attr("x1", (r) => x(r.d1)).attr("x2", (r) => x(r.d9)).attr("y1", cy).attr("y2", cy)
      .attr("stroke", color).attr("stroke-opacity", 0.55).attr("stroke-width", 4).attr("stroke-linecap", "round");
    row.append("line").attr("x1", (r) => x(r.mm)).attr("x2", (r) => x(r.mm)).attr("y1", cy - 7).attr("y2", cy + 7)
      .attr("stroke", "var(--text)").attr("stroke-width", 1.5);
    row.append("circle").attr("cx", (r) => x(r.me)).attr("cy", cy).attr("r", 5)
      .attr("fill", color).attr("stroke", "var(--panel)").attr("stroke-width", 2);

    row.append("rect").attr("x", -m.left).attr("width", W).attr("height", rowH).attr("fill", "transparent")
      .on("pointermove", function (e, r) {
        d3.select(this.parentNode).select("circle").attr("r", 6.5);
        tip.show((t) => (tt ? tt(r, t) : ttTitle(t, r.label, `Mediana ${euro(r.me)} €`)), e.clientX, e.clientY);
      })
      .on("pointerleave", function () {
        d3.select(this.parentNode).select("circle").attr("r", 5);
        tip.hide();
      });
  }

  render();
  onResize(container, render);
}

/**
 * Mappa coropletica delle province a classi: ogni provincia prende il colore della
 * classe in cui cade il suo valore (es. lo scarto dalla mediana italiana); le
 * province senza dato restano in grigio scuro. La legenda elenca le classi con il
 * numero di province in ciascuna.
 * features: GeoJSON Feature[]; value(f) => numero o null
 * classi: [{ max, color, label }] in ordine crescente; l'ultima ha max = Infinity
 * tickFormat: etichetta dei confini tra le classi (legenda a barra, schermi stretti)
 * tooltip(f, t, classe)
 */
export function choropleth(container, { features, value, classi, describe, tooltip: tt, legendEl, legendTitle, tickFormat = String, height = 520 }) {
  const tip = tooltip();
  const classe = (v) => (v == null ? null : classi.find((c) => v < c.max) ?? classi.at(-1));
  const colore = (f) => classe(value(f))?.color ?? "#1b2440";
  let fissata = null; // classe scelta con un clic nella legenda

  function render() {
    d3.select(container).selectAll("svg").remove();
    const W = container.clientWidth;
    const H = Math.min(height, Math.round(W * 1.15));
    const fc = { type: "FeatureCollection", features };
    const proj = d3.geoMercator().fitExtent([[6, 6], [W - 6, H - 6]], fc);
    const path = d3.geoPath(proj);
    const svg = d3.select(container).append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img")
      .attr("aria-label", describe || "Mappa delle province");
    const prov = svg.append("g").selectAll("path").data(features).join("path")
      .attr("d", path)
      .attr("fill", colore)
      .attr("stroke", "var(--panel)").attr("stroke-width", 0.6)
      .on("pointermove", function (e, f) {
        d3.select(this).attr("stroke", "#fff").attr("stroke-width", 1.4).raise();
        if (tt) tip.show((t) => tt(f, t, classe(value(f))), e.clientX, e.clientY);
      })
      .on("pointerleave", function () {
        d3.select(this).attr("stroke", "var(--panel)").attr("stroke-width", 0.6);
        tip.hide();
      });
    // passando sopra una voce della legenda si accendono solo le sue province;
    // con un clic (o un tocco sul telefono) la scelta resta finché non si clicca di nuovo
    const accendi = (k) => prov.attr("fill-opacity", (f) => (k == null || classe(value(f)) === classi[k] ? 1 : 0.18));
    accendi(fissata);
    if (legendEl) {
      legendEl.querySelectorAll("[data-classe]").forEach((voce) => {
        const k = +voce.dataset.classe;
        voce.onpointerenter = (e) => { if (e.pointerType === "mouse") accendi(k); };
        voce.onpointerleave = (e) => { if (e.pointerType === "mouse") accendi(fissata); };
        const scegli = () => {
          fissata = fissata === k ? null : k;
          legendEl.querySelectorAll("[data-classe]").forEach((v) => v.setAttribute("aria-pressed", String(+v.dataset.classe === fissata)));
          accendi(fissata);
        };
        voce.onclick = scegli;
        voce.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); scegli(); } };
      });
    }
  }

  if (legendEl) {
    legendEl.replaceChildren();
    if (legendTitle) {
      const t = document.createElement("div");
      t.className = "map-classi-t";
      t.textContent = legendTitle;
      legendEl.append(t);
    }
    const conta = d3.rollup(features, (v) => v.length, (f) => classe(value(f)));
    const lista = document.createElement("div");
    lista.className = "map-classi-lista";
    // dalla classe più alta alla più bassa, come la lettura dall'alto in basso
    [...classi].reverse().forEach((c) => {
      const voce = document.createElement("div");
      voce.className = "map-classe";
      voce.dataset.classe = String(classi.indexOf(c));
      voce.setAttribute("role", "button");
      voce.setAttribute("aria-pressed", "false");
      voce.tabIndex = 0;
      const sw = document.createElement("span");
      sw.className = "sw";
      sw.style.background = c.color;
      const lab = document.createElement("span");
      lab.className = "lab";
      lab.textContent = c.label;
      const n = document.createElement("span");
      n.className = "n";
      n.textContent = String(conta.get(c) ?? 0);
      voce.title = `${c.label}: ${n.textContent} province`;
      voce.append(sw, lab, n);
      lista.append(voce);
    });
    // sotto la barra (schermi stretti) i confini tra le classi
    const ticks = document.createElement("div");
    ticks.className = "map-classi-ticks";
    ticks.setAttribute("aria-hidden", "true");
    classi.slice(0, -1).forEach((c, k) => {
      const t = document.createElement("span");
      t.style.left = `${((k + 1) / classi.length) * 100}%`;
      t.textContent = tickFormat(c.max);
      ticks.append(t);
    });
    legendEl.append(lista, ticks);
  }

  render();
  onResize(container, render);
}
