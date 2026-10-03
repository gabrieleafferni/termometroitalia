import * as d3 from "d3";
import { fmt } from "../lib/format.js";
import { tooltip, ttTitle, ttRow, reducedMotion, onResize } from "../lib/ui.js";

/**
 * Serie temporali: fascia p10–p90 opzionale, etichette dirette a fine linea,
 * mirino verticale e tooltip con tutte le serie alla stessa data.
 *
 * series: [{ key, name, color, points: [{ date, v, lo, hi }], width?, label? }]
 *   width: spessore della linea (2 di default; le serie di contesto possono
 *          essere più sottili e grigie: forma "enfasi")
 *   label: false per non mettere l'etichetta a fine linea
 *   shortName: nome corto per l'etichetta a fine linea sugli schermi stretti
 * refLines: [{ value, label }]   linee orizzontali di riferimento (es. un tetto)
 * events:   [{ date, label, detail }]  eventi verificati, linee verticali
 * markMax:  evidenzia il massimo storico di ogni serie
 * xTicks:   "giorni" | "anni"
 * tooltipNote: testo fisso o funzione (data) => testo, sotto le righe del tooltip
 */
export function trendChart(container, opts) {
  const {
    series,
    height = 340,
    yFormat = fmt.prezzo2,
    valueFormat = fmt.prezzo,
    unit = "€/l",
    events = [],
    refLines = [],
    markMax = false,
    xTicks = "giorni",
    tooltipTitle = (d) => fmt.settimana(d),
    tooltipNote = null,
    ariaLabel = null,
  } = opts;
  const tip = tooltip();
  const root = d3.select(container);
  let animated = false;

  function render() {
    root.selectAll("svg").remove();
    const W = container.clientWidth;
    const narrow = W < 560;
    // sul telefono le etichette degli eventi salgono di una riga, per non toccare l'unità di misura
    const m = { top: events.length ? (narrow ? (events.length > 1 ? 66 : 52) : 40) : 26, right: narrow ? 74 : 130, bottom: 30, left: 46 };
    const w = W - m.left - m.right;
    const h = height - m.top - m.bottom;

    const all = series.flatMap((s) => s.points);
    const x = d3.scaleTime().domain(d3.extent(all, (p) => p.date)).range([0, w]);
    const values = all.flatMap((p) => [p.lo ?? p.v, p.hi ?? p.v]).concat(refLines.map((r) => r.value));
    const lo = d3.min(values), hi = d3.max(values);
    const pad = (hi - lo) * 0.08 || 0.01;
    // prezzi sempre positivi: l'asse non scende sotto lo zero solo per il margine
    const y = d3.scaleLinear().domain([lo >= 0 ? Math.max(0, lo - pad) : lo - pad, hi + pad]).nice(6).range([h, 0]);

    const svg = root.append("svg").attr("viewBox", `0 0 ${W} ${height}`).attr("role", "img")
      .attr("aria-label", ariaLabel || `Andamento: ${series.map((s) => s.name).join(", ")}`);
    const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);

    // griglia orizzontale e asse y (linee sottili, piene, recessive)
    const yt = y.ticks(narrow ? 4 : 6);
    g.append("g").attr("class", "grid").selectAll("line").data(yt).join("line")
      .attr("x1", 0).attr("x2", w).attr("y1", (d) => y(d)).attr("y2", (d) => y(d));
    g.append("g").selectAll("text").data(yt).join("text").attr("class", "tick-label")
      .attr("x", -10).attr("y", (d) => y(d)).attr("dy", "0.32em").attr("text-anchor", "end").text(yFormat);
    g.append("text").attr("class", "tick-label").attr("x", -10).attr("y", -16).attr("text-anchor", "end").text(unit);

    const xt = xTicks === "anni"
      ? x.ticks(d3.timeYear.every(narrow ? 5 : 2))
      : x.ticks(narrow ? 4 : 8);
    const xf = xTicks === "anni" ? d3.timeFormat("%Y") : (d) => fmt.giornoBreve(d).trim();
    g.append("g").selectAll("text").data(xt).join("text").attr("class", "tick-label")
      .attr("x", (d) => x(d)).attr("y", h + 20).attr("text-anchor", "middle").text(xf);
    g.append("line").attr("x1", 0).attr("x2", w).attr("y1", h).attr("y2", h).attr("stroke", "var(--axis)");

    // linee di riferimento orizzontali (es. il tetto al prezzo)
    for (const r of refLines) {
      const ry = y(r.value);
      g.append("line").attr("x1", 0).attr("x2", w).attr("y1", ry).attr("y2", ry)
        .attr("stroke", "var(--text)").attr("stroke-opacity", 0.7).attr("stroke-width", 1);
      g.append("text").attr("class", "label-2").style("fill", "var(--text)")
        .attr("x", w - 4).attr("y", ry + 16).attr("text-anchor", "end").text(r.label);
    }

    // eventi di contesto (fatti verificati che spiegano un movimento).
    // Se due etichette si toccherebbero (succede sul telefono), la seconda sale di una riga.
    const occupate = []; // [x0, x1, riga]
    for (const ev of events) {
      const ex = x(ev.date);
      if (ex < 0 || ex > w) continue;
      g.append("line").attr("x1", ex).attr("x2", ex).attr("y1", -8).attr("y2", h)
        .attr("stroke", "var(--text-2)").attr("stroke-opacity", 0.45).attr("stroke-width", 1);
      const anchorEnd = ex > w * 0.6;
      const lab = g.append("text").attr("class", "label-2").attr("x", ex + (anchorEnd ? -6 : 6))
        .attr("text-anchor", anchorEnd ? "end" : "start").style("font-size", "12px");
      lab.append("tspan").style("fill", "var(--text)").text(ev.label);
      if (ev.detail && !narrow) lab.append("tspan").text(`  ${ev.detail}`);
      const lw = lab.node().getComputedTextLength?.() || ev.label.length * 6.5;
      const x0 = anchorEnd ? ex - 6 - lw : ex + 6, x1 = x0 + lw;
      let riga = 0;
      while (occupate.some(([a0, a1, r]) => r === riga && x0 < a1 + 8 && x1 > a0 - 8)) riga++;
      occupate.push([x0, x1, riga]);
      lab.attr("y", (narrow ? -30 : -12) - riga * 14);
    }

    // fasce p10–p90 (lavaggio al 12%)
    for (const s of series) {
      if (s.points[0]?.lo == null) continue;
      g.append("path").datum(s.points).attr("fill", s.color).attr("opacity", 0.12)
        .attr("d", d3.area().x((p) => x(p.date)).y0((p) => y(p.lo)).y1((p) => y(p.hi)).curve(d3.curveMonotoneX));
    }

    // linee: le serie di contesto (sottili) sotto, quelle in evidenza sopra con alone neon
    const line = d3.line().x((p) => x(p.date)).y((p) => y(p.v)).curve(d3.curveMonotoneX);
    const lines = [];
    const ordered = [...series].sort((a, b) => (a.width ?? 2) - (b.width ?? 2));
    for (const s of ordered) {
      const width = s.width ?? 2;
      if (width >= 2) {
        g.append("path").datum(s.points).attr("fill", "none").attr("stroke", s.color).attr("stroke-width", 6)
          .attr("stroke-opacity", 0.14).attr("stroke-linecap", "round").attr("d", line);
      }
      const p = g.append("path").datum(s.points).attr("fill", "none").attr("stroke", s.color).attr("stroke-width", width)
        .attr("stroke-linejoin", "round").attr("stroke-linecap", "round").attr("d", line);
      lines.push(p);
    }

    // massimo storico di ogni serie. Se due massimi cadono quasi nello stesso punto
    // (es. benzina e gasolio nella stessa settimana) un'unica etichetta li elenca
    // dal più alto al più basso, con il nome della serie: niente scritte sovrapposte.
    if (markMax) {
      const tops = series.map((s) => ({ s, top: d3.greatest(s.points, (p) => p.v) }))
        .filter(({ s, top }) => top && +top.date !== +s.points.at(-1).date)
        .map((t) => ({ ...t, cx: x(t.top.date), cy: y(t.top.v) }))
        .sort((a, b) => a.cy - b.cy);
      const gruppi = [];
      for (const t of tops) {
        const gr = gruppi.find((gq) => gq.some((u) => Math.abs(u.cx - t.cx) < 70 && Math.abs(u.cy - t.cy) < 30));
        gr ? gr.push(t) : gruppi.push([t]);
      }
      for (const gr of gruppi) {
        for (const t of gr) {
          g.append("circle").attr("cx", t.cx).attr("cy", t.cy).attr("r", 4).attr("fill", t.s.color)
            .attr("stroke", "var(--panel)").attr("stroke-width", 2);
        }
        const [primo] = gr;
        const mese = d3.timeFormat("%m/%Y")(primo.top.date);
        if (gr.length === 1) {
          g.append("text").attr("class", "label-2").style("fill", "var(--text)")
            .attr("x", primo.cx).attr("y", primo.cy - 10).attr("text-anchor", "middle")
            .text(`${valueFormat(primo.top.v)} · ${mese}`);
          continue;
        }
        const txt = g.append("text").attr("class", "label-2").style("fill", "var(--text)")
          .attr("x", primo.cx).attr("y", primo.cy - 10 - 14 * gr.length).attr("text-anchor", "middle");
        txt.append("tspan").attr("x", primo.cx).attr("dy", 0).text(mese);
        for (const t of gr) {
          txt.append("tspan").attr("x", primo.cx).attr("dy", 14).text(`${t.s.name} ${valueFormat(t.top.v)}`);
        }
      }
    }

    // etichette dirette a fine linea (valore + nome), senza sovrapposizioni
    const ends = series.filter((s) => s.label !== false).map((s) => ({ s, p: s.points[s.points.length - 1] }));
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
      lab.append("text").attr("class", "label-2").attr("dy", "1.15em").text(narrow && e.s.shortName ? e.s.shortName : e.s.name);
    });

    // mirino + tooltip
    const cross = g.append("line").attr("class", "crosshair").attr("y1", 0).attr("y2", h).attr("opacity", 0);
    const dots = series.map((s) => g.append("circle").attr("r", 4).attr("fill", s.color)
      .attr("stroke", "var(--panel)").attr("stroke-width", 2).attr("opacity", 0));
    const dates = [...new Set(all.map((p) => +p.date))].sort(d3.ascending).map((t) => new Date(t));
    const bis = d3.bisector((d) => d).center;
    const byDate = series.map((s) => new Map(s.points.map((p) => [+p.date, p])));
    g.append("rect").attr("width", w).attr("height", h).attr("fill", "transparent")
      .on("pointermove", (e) => {
        const [mx] = d3.pointer(e);
        const d = dates[bis(dates, x.invert(mx))];
        cross.attr("x1", x(d)).attr("x2", x(d)).attr("opacity", 1);
        tip.show((t) => {
          ttTitle(t, tooltipTitle(d));
          const rows = series.map((s, i) => ({ s, i, p: byDate[i].get(+d) })).filter((r) => r.p);
          rows.sort((a, b) => b.p.v - a.p.v);
          series.forEach((_, i) => dots[i].attr("opacity", 0));
          for (const { s, i, p } of rows) {
            if ((s.width ?? 2) >= 2) dots[i].attr("opacity", 1).attr("cx", x(p.date)).attr("cy", y(p.v));
            ttRow(t, s.color, s.name, `${valueFormat(p.v)} ${unit}`);
          }
          const note = typeof tooltipNote === "function" ? tooltipNote(d)
            : tooltipNote ?? (series[0].points[0]?.lo != null ? "Fascia: 80% dei distributori (10°–90° percentile)" : null);
          if (note) {
            const n = document.createElement("div");
            n.className = "tt-note";
            n.textContent = note;
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
