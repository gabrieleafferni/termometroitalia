import * as d3 from "d3";
import { fmt } from "../lib/format.js";
import { tooltip, ttTitle, ttRow, reducedMotion, onResize } from "../lib/ui.js";

/**
 * Serie storiche con fascia p10–p90, etichette dirette a fine linea,
 * mirino verticale e tooltip con tutte le serie alla stessa data.
 * series: [{ key, name, color, points: [{ date, v, lo, hi }] }]
 */
export function trendChart(container, { series, height = 340, yFormat = fmt.prezzo2, valueFormat = fmt.prezzo, unit = "€/l", events = [] }) {
  const tip = tooltip();
  const svgNS = d3.select(container);
  let animated = false;

  function render() {
    svgNS.selectAll("svg").remove();
    const W = container.clientWidth;
    const narrow = W < 560;
    const m = { top: events.length ? 40 : 26, right: narrow ? 70 : 130, bottom: 30, left: 46 };
    const w = W - m.left - m.right;
    const h = height - m.top - m.bottom;

    const all = series.flatMap((s) => s.points);
    const x = d3.scaleTime().domain(d3.extent(all, (p) => p.date)).range([0, w]);
    const lo = d3.min(all, (p) => p.lo ?? p.v), hi = d3.max(all, (p) => p.hi ?? p.v);
    const pad = (hi - lo) * 0.08;
    const y = d3.scaleLinear().domain([lo - pad, hi + pad]).nice(6).range([h, 0]);

    const svg = svgNS.append("svg").attr("viewBox", `0 0 ${W} ${height}`).attr("role", "img")
      .attr("aria-label", `Andamento giornaliero: ${series.map((s) => s.name).join(", ")}`);
    const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);

    // griglia orizzontale e asse y (linee sottili, piene, recessive)
    const yt = y.ticks(narrow ? 4 : 6);
    g.append("g").attr("class", "grid").selectAll("line").data(yt).join("line")
      .attr("x1", 0).attr("x2", w).attr("y1", (d) => y(d)).attr("y2", (d) => y(d));
    g.append("g").selectAll("text").data(yt).join("text").attr("class", "tick-label")
      .attr("x", -10).attr("y", (d) => y(d)).attr("dy", "0.32em").attr("text-anchor", "end").text(yFormat);
    g.append("text").attr("class", "tick-label").attr("x", -10).attr("y", -16).attr("text-anchor", "end").text(unit);

    const xt = x.ticks(narrow ? 4 : 8);
    g.append("g").selectAll("text").data(xt).join("text").attr("class", "tick-label")
      .attr("x", (d) => x(d)).attr("y", h + 20).attr("text-anchor", "middle").text((d) => fmt.giornoBreve(d).trim());
    g.append("line").attr("class", "axis").attr("x1", 0).attr("x2", w).attr("y1", h).attr("y2", h)
      .attr("stroke", "var(--axis)");

    // eventi di contesto (fatti verificati che spiegano un movimento)
    for (const ev of events) {
      const ex = x(ev.date);
      if (ex < 0 || ex > w) continue;
      g.append("line").attr("x1", ex).attr("x2", ex).attr("y1", -8).attr("y2", h)
        .attr("stroke", "var(--text-2)").attr("stroke-opacity", 0.45).attr("stroke-width", 1);
      const lab = g.append("text").attr("class", "label-2").attr("x", ex + 6).attr("y", -12).style("font-size", "12px");
      lab.append("tspan").style("fill", "var(--text)").text(ev.label);
      if (ev.detail && !narrow) lab.append("tspan").text(`  ${ev.detail}`);
    }

    // fasce p10–p90 (lavaggio al 10%)
    for (const s of series) {
      if (s.points[0]?.lo == null) continue;
      g.append("path").datum(s.points).attr("fill", s.color).attr("opacity", 0.12)
        .attr("d", d3.area().x((p) => x(p.date)).y0((p) => y(p.lo)).y1((p) => y(p.hi)).curve(d3.curveMonotoneX));
    }

    // linee (2px) con alone tenue per l'effetto neon
    const line = d3.line().x((p) => x(p.date)).y((p) => y(p.v)).curve(d3.curveMonotoneX);
    const lines = [];
    for (const s of series) {
      g.append("path").datum(s.points).attr("fill", "none").attr("stroke", s.color).attr("stroke-width", 6)
        .attr("stroke-opacity", 0.14).attr("stroke-linecap", "round").attr("d", line);
      const p = g.append("path").datum(s.points).attr("fill", "none").attr("stroke", s.color).attr("stroke-width", 2)
        .attr("stroke-linejoin", "round").attr("stroke-linecap", "round").attr("d", line);
      lines.push(p);
    }

    // etichette dirette a fine linea (valore + nome), senza sovrapposizioni
    const ends = series.map((s) => ({ s, p: s.points[s.points.length - 1] }));
    const ly = ends.map((e) => y(e.p.v));
    const idx = d3.range(ends.length).sort((a, b) => ly[a] - ly[b]);
    for (let k = 1; k < idx.length; k++) {
      if (ly[idx[k]] - ly[idx[k - 1]] < 34) ly[idx[k]] = ly[idx[k - 1]] + 34;
    }
    ends.forEach((e, k) => {
      const cx = x(e.p.date), cy = y(e.p.v);
      g.append("circle").attr("cx", cx).attr("cy", cy).attr("r", 4).attr("fill", e.s.color)
        .attr("stroke", "var(--panel)").attr("stroke-width", 2);
      const lab = g.append("g").attr("transform", `translate(${cx + 12},${ly[k]})`);
      lab.append("text").attr("class", "label").attr("dy", "-0.1em").text(valueFormat(e.p.v));
      lab.append("text").attr("class", "label-2").attr("dy", "1.15em").text(e.s.name);
    });

    // mirino + tooltip
    const cross = g.append("line").attr("class", "crosshair").attr("y1", 0).attr("y2", h).attr("opacity", 0);
    const dots = series.map((s) => g.append("circle").attr("r", 4).attr("fill", s.color)
      .attr("stroke", "var(--panel)").attr("stroke-width", 2).attr("opacity", 0));
    const dates = series[0].points.map((p) => p.date);
    const bis = d3.bisector((d) => d).center;
    g.append("rect").attr("width", w).attr("height", h).attr("fill", "transparent")
      .on("pointermove", (e) => {
        const [mx] = d3.pointer(e);
        const d = dates[bis(dates, x.invert(mx))];
        cross.attr("x1", x(d)).attr("x2", x(d)).attr("opacity", 1);
        tip.show((t) => {
          ttTitle(t, fmt.settimana(d));
          series.forEach((s, i) => {
            const p = s.points.find((q) => +q.date === +d);
            dots[i].attr("opacity", p ? 1 : 0);
            if (p) {
              dots[i].attr("cx", x(p.date)).attr("cy", y(p.v));
              ttRow(t, s.color, s.name, `${valueFormat(p.v)} ${unit}`);
            }
          });
          if (series[0].points[0]?.lo != null) {
            const n = document.createElement("div");
            n.className = "tt-note";
            n.textContent = "Fascia: 80% dei distributori (10°–90° percentile)";
            t.append(n);
          }
        }, e.clientX, e.clientY);
      })
      .on("pointerleave", () => {
        cross.attr("opacity", 0);
        dots.forEach((d) => d.attr("opacity", 0));
        tip.hide();
      });

    // disegno progressivo delle linee alla prima comparsa
    if (!animated && !reducedMotion()) {
      animated = true;
      for (const p of lines) {
        const L = p.node().getTotalLength();
        p.attr("stroke-dasharray", `${L} ${L}`).attr("stroke-dashoffset", L)
          .transition().duration(1600).ease(d3.easeCubicOut).attr("stroke-dashoffset", 0)
          .on("end", () => p.attr("stroke-dasharray", null));
      }
    }
  }

  render();
  onResize(container, render);
}
