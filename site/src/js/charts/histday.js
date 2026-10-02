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
 * Ogni fascia (1 centesimo, chiusa a destra: "199" = da 1,981 a 1,990 €/l) è una
 * barra impilata: rete Eni in basso, altri marchi sopra, separati da un filo del
 * colore dello sfondo. Un contorno opzionale mostra un giorno di riferimento.
 *
 * data: { da, a, date: [ISO], eni: [[n per fascia]], altri: [[...]], sotto, sopra }
 */
export function histogramByDay(container, opts) {
  const { data, colors, height = 300 } = opts;
  const tip = tooltip();
  const nBins = data.a - data.da + 1;
  const cent = (k) => (data.da + k) / 100; // estremo destro della fascia, in €/l
  const totale = (i) => data.eni[i].map((e, k) => e + data.altri[i][k]);
  const yMax = d3.max(data.date, (_, i) => d3.max(totale(i)));

  let day = data.date.length - 1;
  let ref = null; // indice del giorno di riferimento (contorno)
  let markers = [];
  let svg, g, x, y, w, h, bars;
  const m = { top: 46, right: 16, bottom: 30, left: 50 };
  const GAP = 2; // filo tra barre e tra segmenti impilati

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

    g.append("g").attr("class", "ghost-layer");
    bars = g.append("g").attr("class", "bars").selectAll("g").data(d3.range(nBins)).join("g");
    bars.append("rect").attr("class", "seg-eni").attr("rx", 2).attr("fill", colors.eni);
    bars.append("rect").attr("class", "seg-altri").attr("rx", 2).attr("fill", colors.altri);
    g.append("line").attr("x1", 0).attr("x2", w).attr("y1", h).attr("y2", h).attr("stroke", "var(--axis)");
    g.append("g").attr("class", "marker-layer");

    // bersagli di hover: tutta l'altezza della fascia, più facili da prendere della barra
    g.append("g").selectAll("rect").data(d3.range(nBins)).join("rect")
      .attr("x", (k) => x(cent(k) - 0.01)).attr("width", Math.max(1, w / nBins)).attr("y", -m.top + 8).attr("height", h + m.top - 8)
      .attr("fill", "transparent")
      .on("pointermove", (e, k) => {
        bars.filter((j) => j === k).attr("opacity", 1);
        bars.filter((j) => j !== k).attr("opacity", 0.55);
        const eni = data.eni[day][k], altri = data.altri[day][k], tot = eni + altri;
        const n = d3.sum(totale(day)) + data.sotto[day] + data.sopra[day];
        tip.show((t) => {
          ttTitle(t, `${fmt.prezzo(cent(k) - 0.009)} – ${fmt.prezzo(cent(k))} €/l`, opts.dateLabel(day));
          ttRow(t, colors.eni, "Eni", fmt.intero(eni));
          ttRow(t, colors.altri, "Altri marchi", fmt.intero(altri));
          ttRow(t, null, "Totale", `${fmt.intero(tot)} (${fmt.pct(tot / n)})`);
          if (ref != null && day > ref) {
            ttRow(t, null, `Il ${opts.dateLabel(ref)}`, fmt.intero(data.eni[ref][k] + data.altri[ref][k]));
          }
        }, e.clientX, e.clientY);
      })
      .on("pointerleave", () => {
        bars.attr("opacity", 1);
        tip.hide();
      });

    update(0);
  }

  function update(duration) {
    if (!g) return;
    const dur = reducedMotion() ? 0 : duration;
    const bw = Math.max(1, w / nBins - GAP);
    const eni = data.eni[day], altri = data.altri[day];
    const t = d3.transition().duration(dur).ease(d3.easeCubicOut);
    bars.attr("transform", (k) => `translate(${x(cent(k) - 0.01) + GAP / 2},0)`);
    bars.select(".seg-eni").attr("width", bw).transition(t)
      .attr("y", (k) => y(eni[k]))
      .attr("height", (k) => h - y(eni[k]));
    bars.select(".seg-altri").attr("width", bw).transition(t)
      // sopra la parte Eni, staccata da un filo di 2px (solo se c'è una parte Eni)
      .attr("y", (k) => y(eni[k] + altri[k]) - (eni[k] > 0 && altri[k] > 0 ? GAP : 0))
      .attr("height", (k) => Math.max(0, y(eni[k]) - y(eni[k] + altri[k])));

    // contorno del giorno di riferimento: profilo a gradini dei totali
    const ghost = g.select(".ghost-layer");
    ghost.selectAll("*").remove();
    if (ref != null && day > ref) {
      const tot = totale(ref);
      const pts = [];
      tot.forEach((v, k) => {
        pts.push([x(cent(k) - 0.01), y(v)], [x(cent(k)), y(v)]);
      });
      ghost.append("path").attr("d", d3.line()([[x(cent(0) - 0.01), h], ...pts, [x(cent(nBins - 1)), h]]))
        .attr("fill", "none").attr("stroke", "var(--text)").attr("stroke-opacity", 0.7)
        .attr("stroke-width", 1.5).attr("stroke-linejoin", "round").attr("stroke-dasharray", "4 3");
    }

    // linee di riferimento (media del giorno, tetto ai prezzi...)
    const ml = g.select(".marker-layer");
    ml.selectAll("*").remove();
    const visibili = markers.filter((mk) => mk.value >= x.domain()[0] && mk.value <= x.domain()[1])
      .sort((a, b) => a.value - b.value);
    // le linee stanno sul bordo destro della fascia che contiene il valore
    const xs = visibili.map((mk) => x(Math.ceil(mk.value * 100 - 1e-6) / 100));
    visibili.forEach((mk, i) => {
      const mx = xs[i];
      ml.append("line").attr("x1", mx).attr("x2", mx).attr("y1", -8 - (i % 2) * 18).attr("y2", h)
        .attr("stroke", mk.color || "var(--text)").attr("stroke-width", 1.5)
        .attr("stroke-dasharray", mk.dashed ? "5 4" : null);
      // etichetta a sinistra della linea se un'altra linea è vicina a destra (o se siamo sul bordo)
      const vicinaDestra = i < xs.length - 1 && xs[i + 1] - mx < 150;
      const vicinaSinistra = i > 0 && mx - xs[i - 1] < 150;
      const anchorEnd = vicinaDestra ? true : vicinaSinistra ? false : mx > w * 0.72;
      ml.append("text").attr("class", "label-2").style("fill", "var(--text)")
        .attr("x", mx + (anchorEnd ? -6 : 6)).attr("y", -14 - (i % 2) * 18).attr("text-anchor", anchorEnd ? "end" : "start")
        .text(mk.label);
    });
    svg.attr("aria-label", opts.ariaLabel(day));
  }

  render();
  onResize(container, render);

  return {
    setDay(i, { duration = 350 } = {}) {
      day = i;
      update(duration);
    },
    setReference(i) {
      ref = i;
      update(0);
    },
    setMarkers(list) {
      markers = list;
      update(0);
    },
    get day() {
      return day;
    },
  };
}
