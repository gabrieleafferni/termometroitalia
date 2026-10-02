import * as d3 from "d3";
import { fmt } from "../lib/format.js";
import { tooltip, ttTitle, ttRow, onResize, reducedMotion } from "../lib/ui.js";

/**
 * Istogramma dei prezzi consultabile per giorno.
 *
 * Gli assi sono FISSI per tutti i giorni (stesse fasce di prezzo, stessa scala dei
 * conteggi): solo così, spostandosi da un giorno all'altro, si vede davvero la
 * distribuzione cambiare invece degli assi che si riadattano.
 *
 * Ogni fascia è di 1 centesimo, chiusa a destra ("200" = da 1,991 a 2,000 €/l).
 * Un contorno opzionale mostra un giorno di confronto (per esempio 7 giorni prima).
 *
 * data: { da, a, date: [ISO], n: [[distributori per fascia]], sotto, sopra }
 */
export function histogramByDay(container, opts) {
  const { data, color, height = 300 } = opts;
  const tip = tooltip();
  const nBins = data.a - data.da + 1;
  const cent = (k) => (data.da + k) / 100; // estremo destro della fascia, in €/l
  const yMax = d3.max(data.n, (giorno) => d3.max(giorno));

  let day = data.date.length - 1;
  let ref = null; // indice del giorno di confronto (contorno)
  let markers = [];
  let svg, g, x, y, w, h, bars;
  const m = { top: 30, right: 16, bottom: 30, left: 50 };
  const GAP = 2; // filo tra una barra e l'altra

  function render() {
    d3.select(container).selectAll("svg").remove();
    const W = container.clientWidth;
    w = W - m.left - m.right;
    h = height - m.top - m.bottom;
    x = d3.scaleLinear().domain([data.da / 100 - 0.01, data.a / 100]).range([0, w]);
    y = d3.scaleLinear().domain([0, yMax]).nice(4).range([h, 0]);

    svg = d3.select(container).append("svg").attr("viewBox", `0 0 ${W} ${height}`).attr("role", "img");
    g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);
    const yt = y.ticks(4);
    g.append("g").attr("class", "grid").selectAll("line").data(yt).join("line")
      .attr("x1", 0).attr("x2", w).attr("y1", (d) => y(d)).attr("y2", (d) => y(d));
    g.append("g").selectAll("text").data(yt).join("text").attr("class", "tick-label")
      .attr("x", -10).attr("y", (d) => y(d)).attr("dy", "0.32em").attr("text-anchor", "end").text(fmt.intero);
    // tacche dell'asse sui centesimi "tondi" (ogni 5 o 10 cent, secondo lo spazio)
    const passo = w / nBins < 9 ? 10 : 5;
    const xt = d3.range(Math.ceil(data.da / passo) * passo, data.a + 1, passo);
    g.append("g").selectAll("text").data(xt).join("text").attr("class", "tick-label")
      .attr("x", (k) => x(k / 100 - 0.005)).attr("y", h + 20).attr("text-anchor", "middle").text((k) => fmt.prezzo2(k / 100));

    bars = g.append("g").attr("class", "bars").selectAll("rect").data(d3.range(nBins)).join("rect")
      .attr("rx", 2).attr("fill", color);
    g.append("g").attr("class", "ghost-layer");
    g.append("line").attr("x1", 0).attr("x2", w).attr("y1", h).attr("y2", h).attr("stroke", "var(--axis)");
    g.append("g").attr("class", "marker-layer");

    // bersagli di hover: tutta l'altezza della fascia, più facili da prendere della barra
    g.append("g").selectAll("rect").data(d3.range(nBins)).join("rect")
      .attr("x", (k) => x(cent(k) - 0.01)).attr("width", Math.max(1, w / nBins)).attr("y", -m.top + 4).attr("height", h + m.top - 4)
      .attr("fill", "transparent")
      .on("pointermove", (e, k) => {
        bars.attr("fill-opacity", (j) => (j === k ? 1 : 0.55));
        const n = data.n[day][k];
        const tot = d3.sum(data.n[day]) + data.sotto[day] + data.sopra[day];
        tip.show((t) => {
          ttTitle(t, `${fmt.prezzo(cent(k) - 0.009)} – ${fmt.prezzo(cent(k))} €/l`, opts.dateLabel(day));
          ttRow(t, color, "Distributori", `${fmt.intero(n)} (${fmt.pct(n / tot)})`);
          if (ref != null) ttRow(t, null, `Il ${opts.dateLabel(ref)}`, fmt.intero(data.n[ref][k]));
        }, e.clientX, e.clientY);
      })
      .on("pointerleave", () => {
        bars.attr("fill-opacity", 1);
        tip.hide();
      });

    update(0);
  }

  function update(duration) {
    if (!g) return;
    const dur = reducedMotion() ? 0 : duration;
    const bw = Math.max(1, w / nBins - GAP);
    const n = data.n[day];
    bars.attr("x", (k) => x(cent(k) - 0.01) + GAP / 2).attr("width", bw)
      .transition().duration(dur).ease(d3.easeCubicOut)
      .attr("y", (k) => y(n[k]))
      .attr("height", (k) => h - y(n[k]));

    // contorno del giorno di confronto: profilo a gradini
    const ghost = g.select(".ghost-layer");
    ghost.selectAll("*").remove();
    if (ref != null) {
      const pts = [];
      data.n[ref].forEach((v, k) => pts.push([x(cent(k) - 0.01), y(v)], [x(cent(k)), y(v)]));
      ghost.append("path").attr("d", d3.line()([[x(cent(0) - 0.01), h], ...pts, [x(cent(nBins - 1)), h]]))
        .attr("fill", "none").attr("stroke", "var(--text)").attr("stroke-opacity", 0.7)
        .attr("stroke-width", 1.5).attr("stroke-linejoin", "round").attr("stroke-dasharray", "4 3");
    }

    // linee di riferimento (es. la media del giorno), sul bordo destro della fascia che le contiene
    const ml = g.select(".marker-layer");
    ml.selectAll("*").remove();
    for (const mk of markers) {
      if (mk.value < x.domain()[0] || mk.value > x.domain()[1]) continue;
      const mx = x(Math.ceil(mk.value * 100 - 1e-6) / 100);
      ml.append("line").attr("x1", mx).attr("x2", mx).attr("y1", -8).attr("y2", h)
        .attr("stroke", mk.color || "var(--text)").attr("stroke-width", 1.5);
      const anchorEnd = mx > w * 0.72;
      ml.append("text").attr("class", "label-2").style("fill", "var(--text)")
        .attr("x", mx + (anchorEnd ? -6 : 6)).attr("y", -14).attr("text-anchor", anchorEnd ? "end" : "start")
        .text(mk.label);
    }
    svg.attr("aria-label", opts.ariaLabel(day));
  }

  render();
  onResize(container, render);

  return {
    setDay(i, { duration = 350, reference = null, markers: mks = [] } = {}) {
      day = i;
      ref = reference;
      markers = mks;
      update(duration);
    },
  };
}
