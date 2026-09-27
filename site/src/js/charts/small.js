import * as d3 from "d3";
import { fmt } from "../lib/format.js";
import { tooltip, ttTitle, ttRow, onResize } from "../lib/ui.js";

const NS = "http://www.w3.org/2000/svg";

/** Sparkline: linea sottile, ultimo punto evidenziato. */
export function sparkline(svg, values, color) {
  const W = 200, H = 44;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  const x = d3.scaleLinear().domain([0, values.length - 1]).range([2, W - 6]);
  const ext = d3.extent(values);
  const y = d3.scaleLinear().domain(ext[0] === ext[1] ? [ext[0] - 1, ext[1] + 1] : ext).range([H - 4, 4]);
  const area = document.createElementNS(NS, "path");
  area.setAttribute("d", d3.area().x((_, i) => x(i)).y0(H).y1((v) => y(v)).curve(d3.curveMonotoneX)(values));
  area.setAttribute("fill", color);
  area.setAttribute("opacity", "0.10");
  const line = document.createElementNS(NS, "path");
  line.setAttribute("d", d3.line().x((_, i) => x(i)).y((v) => y(v)).curve(d3.curveMonotoneX)(values));
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", color);
  line.setAttribute("stroke-width", "1.6");
  line.setAttribute("vector-effect", "non-scaling-stroke");
  line.setAttribute("stroke-linejoin", "round");
  svg.append(area, line);
}

/** Percorso di una barra orizzontale con angoli arrotondati solo sul lato "dato". */
function barPath(x0, x1, yTop, h, r = 4) {
  const dir = x1 >= x0 ? 1 : -1;
  const len = Math.abs(x1 - x0);
  const rr = Math.min(r, len, h / 2);
  if (len < 0.5) return `M${x0},${yTop}h0v${h}h0Z`;
  const xe = x1 - dir * rr;
  return [
    `M${x0},${yTop}`,
    `H${xe}`,
    `Q${x1},${yTop} ${x1},${yTop + rr}`,
    `V${yTop + h - rr}`,
    `Q${x1},${yTop + h} ${xe},${yTop + h}`,
    `H${x0}`,
    "Z",
  ].join(" ");
}

/**
 * Barre divergenti: scarto dalla media italiana, in centesimi.
 * rows: [{ label, sub, value (€), media, n }]
 */
export function divergingBars(container, { rows, colors = ["#2de0e6", "#ff3d7f"], rowH = 26, describe }) {
  const tip = tooltip();

  function render() {
    d3.select(container).selectAll("svg").remove();
    const W = container.clientWidth;
    const labelW = Math.min(150, W * 0.34);
    const gutter = 40; // spazio per le etichette dei valori negativi
    const m = { top: 22, right: 46, bottom: 6, left: labelW + gutter };
    const w = W - m.left - m.right;
    const H = m.top + rows.length * rowH + m.bottom;
    const maxAbs = d3.max(rows, (r) => Math.abs(r.value)) || 0.01;
    const x = d3.scaleLinear().domain([-maxAbs, maxAbs]).range([0, w]).nice();
    const barH = Math.min(16, rowH - 8);

    const svg = d3.select(container).append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img")
      .attr("aria-label", describe || "Scarto dalla media italiana");
    const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);

    const ticks = x.ticks(4);
    g.append("g").attr("class", "grid").selectAll("line").data(ticks).join("line")
      .attr("x1", (d) => x(d)).attr("x2", (d) => x(d)).attr("y1", -4).attr("y2", rows.length * rowH);
    g.append("g").selectAll("text").data(ticks).join("text").attr("class", "tick-label")
      .attr("x", (d) => x(d)).attr("y", -10).attr("text-anchor", "middle")
      .text((d) => (d === 0 ? "media" : fmt.cent(d, 0)));

    const row = g.selectAll("g.row").data(rows).join("g").attr("class", "row")
      .attr("transform", (_, i) => `translate(0,${i * rowH})`);
    row.append("text").attr("class", "label-2").attr("x", -gutter - 4).attr("y", rowH / 2).attr("dy", "0.35em")
      .attr("text-anchor", "end").style("fill", "var(--text)").style("font-size", "13px")
      .text((r) => r.label);
    row.append("path").attr("d", (r) => barPath(x(0), x(r.value), (rowH - barH) / 2, barH))
      .attr("fill", (r) => (r.value >= 0 ? colors[1] : colors[0]))
      .attr("fill-opacity", 0.9);
    row.append("text").attr("class", "tick-label").style("fill", "var(--text-2)")
      .attr("x", (r) => x(r.value) + (r.value >= 0 ? 6 : -6)).attr("y", rowH / 2).attr("dy", "0.35em")
      .attr("text-anchor", (r) => (r.value >= 0 ? "start" : "end"))
      .text((r) => fmt.cent(r.value));
    g.append("line").attr("class", "zero").attr("x1", x(0)).attr("x2", x(0)).attr("y1", -4).attr("y2", rows.length * rowH);

    // bersaglio di hover: l'intera riga
    row.append("rect").attr("x", -m.left).attr("width", W).attr("height", rowH).attr("fill", "transparent")
      .on("pointermove", function (e, r) {
        d3.select(this.parentNode).select("path").attr("fill-opacity", 1).attr("stroke", "#fff").attr("stroke-width", 1);
        tip.show((t) => {
          ttTitle(t, r.label, r.sub);
          ttRow(t, null, "Prezzo medio", `${fmt.prezzo(r.media)} €/l`);
          ttRow(t, r.value >= 0 ? colors[1] : colors[0], "Rispetto all'Italia", `${fmt.cent(r.value)} cent`);
          if (r.n != null) ttRow(t, null, "Distributori", fmt.intero(r.n));
        }, e.clientX, e.clientY);
      })
      .on("pointerleave", function () {
        d3.select(this.parentNode).select("path").attr("fill-opacity", 0.9).attr("stroke", null);
        tip.hide();
      });
  }

  render();
  onResize(container, render);
}

/**
 * Istogramma della distribuzione dei prezzi (bin da 1 centesimo) con
 * riferimenti verticali etichettati.
 */
export function histogram(container, { values, color, markers = [], height = 260, binWidth = 0.01 }) {
  const tip = tooltip();

  function render() {
    d3.select(container).selectAll("svg").remove();
    const W = container.clientWidth;
    const m = { top: 34, right: 16, bottom: 30, left: 46 };
    const w = W - m.left - m.right, h = height - m.top - m.bottom;
    const lo = d3.quantile(values, 0.01), hi = d3.quantile(values, 0.995);
    const x0 = Math.floor(lo / binWidth) * binWidth, x1 = Math.ceil(hi / binWidth) * binWidth;
    const bins = d3.bin().domain([x0, x1]).thresholds(d3.range(x0, x1 + 1e-9, binWidth))(values.filter((v) => v >= x0 && v <= x1));
    const x = d3.scaleLinear().domain([x0, x1]).range([0, w]);
    const y = d3.scaleLinear().domain([0, d3.max(bins, (b) => b.length)]).nice(4).range([h, 0]);

    const svg = d3.select(container).append("svg").attr("viewBox", `0 0 ${W} ${height}`).attr("role", "img")
      .attr("aria-label", "Distribuzione dei prezzi tra i distributori");
    const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);
    const yt = y.ticks(4);
    g.append("g").attr("class", "grid").selectAll("line").data(yt).join("line")
      .attr("x1", 0).attr("x2", w).attr("y1", (d) => y(d)).attr("y2", (d) => y(d));
    g.append("g").selectAll("text").data(yt).join("text").attr("class", "tick-label")
      .attr("x", -10).attr("y", (d) => y(d)).attr("dy", "0.32em").attr("text-anchor", "end").text(fmt.intero);
    g.append("g").selectAll("text").data(x.ticks(Math.max(3, Math.floor(w / 90)))).join("text").attr("class", "tick-label")
      .attr("x", (d) => x(d)).attr("y", h + 20).attr("text-anchor", "middle").text(fmt.prezzo2);

    const gap = 2;
    g.selectAll("rect.bin").data(bins).join("rect").attr("class", "bin")
      .attr("x", (b) => x(b.x0) + gap / 2).attr("width", (b) => Math.max(1, x(b.x1) - x(b.x0) - gap))
      .attr("y", (b) => y(b.length)).attr("height", (b) => h - y(b.length))
      .attr("rx", 2).attr("fill", color).attr("fill-opacity", 0.85)
      .on("pointermove", function (e, b) {
        d3.select(this).attr("fill-opacity", 1);
        tip.show((t) => {
          ttTitle(t, `${fmt.prezzo(b.x0)} – ${fmt.prezzo(b.x1)} €/l`);
          ttRow(t, color, "Distributori", fmt.intero(b.length));
          ttRow(t, null, "Quota", fmt.pct(b.length / values.length));
        }, e.clientX, e.clientY);
      })
      .on("pointerleave", function () {
        d3.select(this).attr("fill-opacity", 0.85);
        tip.hide();
      });
    g.append("line").attr("x1", 0).attr("x2", w).attr("y1", h).attr("y2", h).attr("stroke", "var(--axis)");

    markers.forEach((mk, i) => {
      const mx = x(mk.value);
      if (mx < 0 || mx > w) return;
      g.append("line").attr("x1", mx).attr("x2", mx).attr("y1", -6 - i * 0).attr("y2", h).attr("stroke", mk.color || "var(--text)").attr("stroke-width", 1.5);
      const anchorEnd = mx > w * 0.7;
      g.append("text").attr("class", "label-2").style("fill", "var(--text)")
        .attr("x", mx + (anchorEnd ? -6 : 6)).attr("y", -14 + i * 16).attr("text-anchor", anchorEnd ? "end" : "start")
        .text(`${mk.label} ${fmt.prezzo(mk.value)}`);
    });
  }

  render();
  onResize(container, render);
}
