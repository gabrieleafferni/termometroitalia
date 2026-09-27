import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "../css/style.css";

import * as d3 from "d3";
import { feature } from "topojson-client";
import { load, loadGeo, fromColumns } from "./lib/data.js";
import { fmt, parseDay, NOMI_RIF, UNITA } from "./lib/format.js";
import { chrome, el, tooltip, ttTitle, ttRow, tableView, countUp, reveal, deltaSpan } from "./lib/ui.js";
import { glowMap, colorScale, DIVERGING } from "./charts/map.js";
import { trendChart } from "./charts/trend.js";
import { sparkline, divergingBars, histogram } from "./charts/small.js";

const COLORE = { benzina: "#c98500", gasolio: "#8f6ff0", gpl: "#3ecf8e", metano: "#4c9df5" };
const CAMPO = { benzina: "b", gasolio: "g" };
const RANGE = 0.06; // ±6 cent: saturazione della scala colori della mappa

// Eventi di contesto annotati sul grafico storico (solo fatti verificati, con fonte)
const EVENTI = [
  { d: "2026-07-29", label: "Taglio delle accise sul gasolio", detail: "(ANSA, 28 luglio 2026)" },
];

const titleCase = (s) =>
  s.toLowerCase().replace(/(^|[\s'’\-(/])([a-zà-ÿ])/g, (m, p, c) => p + c.toUpperCase()).replace(/\b(Di|De|Del|Della|Dei|Delle|Degli|In|Sul|Sulla|Nel|Nell|Al|Alla|E)\b/g, (w) => w.toLowerCase());

async function main() {
  const [meta, naz, reg, prov, tipo, bandiere, imp, novita, topo] = await Promise.all([
    load("meta.json"),
    load("carburanti_nazionale.json"),
    load("carburanti_regionale.json"),
    load("carburanti_province_oggi.json"),
    load("carburanti_tipo.json"),
    load("carburanti_bandiere.json"),
    load("carburanti_impianti.json"),
    load("novita.json"),
    loadGeo("regioni.topo.json"),
  ]);
  chrome("carburanti", meta);

  const stations = fromColumns(imp);
  const regions = feature(topo, topo.objects[Object.keys(topo.objects)[0]]);
  naz.forEach((r) => (r.date = parseDay(r.d)));
  const rif = naz.filter((r) => r.rif);
  const byFuel = d3.group(rif, (r) => r.c);
  const oggi = d3.max(rif, (r) => r.date);
  const ultimo = (c) => byFuel.get(c).at(-1);
  const aGiorni = (c, n) => {
    const s = byFuel.get(c);
    const target = d3.timeDay.offset(s.at(-1).date, -n);
    return [...s].reverse().find((r) => r.date <= target);
  };

  // ---------- intestazione ----------
  const stamp = document.getElementById("stamp");
  stamp.append(
    el("strong", null, `Dati del ${fmt.giornoAnno(oggi).trim()}`),
    el("span", null, `${fmt.intero(stations.length)} distributori sulla mappa · storico dal ${fmt.giorno(byFuel.get("benzina")[0].date).trim()}`)
  );

  // ---------- KPI ----------
  const kpis = document.getElementById("kpis");
  for (const c of ["benzina", "gasolio", "gpl", "metano"]) {
    const u = ultimo(c), w = aGiorni(c, 7), m = aGiorni(c, 30);
    const card = el("article", `panel kpi reveal${c === "benzina" ? " kpi-hero" : ""}`);
    const lab = el("div", "kpi-label");
    const key = el("span", "key");
    key.style.background = COLORE[c];
    lab.append(key, el("span", null, NOMI_RIF[c]));
    const val = el("div", "kpi-value");
    const num = el("span", null, fmt.prezzo(u.media));
    val.append(num, el("span", "unit", UNITA[c]));
    const deltas = el("div", "deltas");
    if (w) deltas.append(deltaSpan(u.media - w.media, " in 7 giorni"));
    if (m) deltas.append(deltaSpan(u.media - m.media, " in 30 giorni"));
    const spark = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    spark.classList.add("spark");
    sparkline(spark, byFuel.get(c).map((r) => r.media), COLORE[c]);
    card.append(lab, val, deltas, spark);
    card.setAttribute("aria-label", `${NOMI_RIF[c]}: ${fmt.prezzo(u.media)} ${UNITA[c]}`);
    kpis.append(card);
    countUp(num, u.media, fmt.prezzo);
  }

  // ---------- stato: carburante selezionato ----------
  let fuel = "benzina";
  const refOggi = () => ultimo(fuel).media;
  const tip = tooltip();

  // ---------- mappa ----------
  const mapEl = document.getElementById("map");
  const map = glowMap(mapEl, {
    stations,
    regions,
    value: (s) => s[CAMPO[fuel]],
    reference: refOggi(),
    range: RANGE,
    onHover(s, x, y) {
      if (!s) return tip.hide();
      tip.show((t) => {
        ttTitle(t, s.nome ? titleCase(s.nome) : `Impianto ${s.id}`, `${s.bandiera ?? ""} · ${titleCase(s.comune ?? "")} (${s.sigla ?? ""})${s.auto ? " · autostrada" : ""}`);
        for (const c of ["benzina", "gasolio"]) {
          const v = s[CAMPO[c]];
          if (v == null) continue;
          ttRow(t, COLORE[c], NOMI_RIF[c], `${fmt.prezzo(v)} €/l`);
        }
        const v = s[CAMPO[fuel]], v7 = s[CAMPO[fuel] + "7"];
        if (v != null) {
          const note = el("div", "tt-note");
          const diff = v - refOggi();
          note.textContent = `${NOMI_RIF[fuel]}: ${fmt.cent(diff)} cent rispetto alla media italiana` + (v7 != null ? `, ${fmt.cent(v - v7)} cent in 7 giorni` : "");
          t.append(note);
        }
      }, x, y);
    },
  });

  const legend = document.getElementById("map-legend");
  function renderLegend() {
    legend.replaceChildren();
    legend.append(el("div", "t", `${NOMI_RIF[fuel]} · rispetto alla media (${fmt.prezzo(refOggi())} €/l)`));
    const ramp = el("div", "ramp");
    ramp.style.background = colorScale(RANGE).css;
    const ticks = el("div", "ticks");
    ticks.append(el("span", null, `−${RANGE * 100} cent`), el("span", null, "media"), el("span", null, `+${RANGE * 100} cent`));
    legend.append(ramp, ticks);
  }
  const mapCount = document.getElementById("map-count");
  function renderCount() {
    const n = stations.filter((s) => s[CAMPO[fuel]] != null).length;
    mapCount.replaceChildren(el("b", null, fmt.intero(n)), el("span", null, `distributori con prezzo ${fuel} self oggi`));
  }
  document.getElementById("map-reset").addEventListener("click", () => map.reset());
  document.getElementById("map-zoom-in").addEventListener("click", () => map.zoomBy(2));
  document.getElementById("map-zoom-out").addEventListener("click", () => map.zoomBy(0.5));

  // ---------- ricerca comune ----------
  const byComune = d3.group(stations, (s) => `${titleCase(s.comune ?? "")} (${s.sigla})`);
  const dl = document.getElementById("comuni");
  for (const k of [...byComune.keys()].sort((a, b) => a.localeCompare(b, "it"))) {
    const o = document.createElement("option");
    o.value = k;
    dl.append(o);
  }
  const input = document.getElementById("comune");
  let comuneScelto = null;
  function renderFinder() {
    const list = document.getElementById("finder-list");
    list.replaceChildren();
    if (!comuneScelto) return;
    const items = byComune.get(comuneScelto).filter((s) => s[CAMPO[fuel]] != null)
      .sort((a, b) => a[CAMPO[fuel]] - b[CAMPO[fuel]]);
    document.getElementById("finder-title").textContent = `${comuneScelto}`;
    const media = d3.mean(items, (s) => s[CAMPO[fuel]]);
    document.getElementById("finder-sub").textContent = items.length
      ? `${items.length} distributori con ${fuel} self · media del comune ${fmt.prezzo(media)} €/l (${fmt.cent(media - refOggi())} cent rispetto all'Italia)`
      : `Nessun prezzo ${fuel} self comunicato oggi in questo comune.`;
    for (const s of items.slice(0, 6)) {
      const li = el("li");
      const left = el("div");
      left.append(el("span", "n", s.nome ? titleCase(s.nome) : `Impianto ${s.id}`), el("span", "b", `${s.bandiera ?? ""}${s.auto ? " · autostrada" : ""}`));
      li.append(left, el("span", "p", `${fmt.prezzo(s[CAMPO[fuel]])} €`));
      li.tabIndex = 0;
      const go = () => {
        const i = map.indexOf(s);
        map.highlight([i]);
        map.focus([i]);
      };
      li.addEventListener("click", go);
      li.addEventListener("keydown", (e) => e.key === "Enter" && go());
      list.append(li);
    }
  }
  input.addEventListener("change", () => {
    const k = input.value.trim();
    if (!byComune.has(k)) return;
    comuneScelto = k;
    const idx = byComune.get(k).map((s) => map.indexOf(s));
    map.highlight(idx);
    map.focus(idx);
    renderFinder();
    document.getElementById("finder").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  // ---------- novità ----------
  const feed = document.getElementById("feed");
  for (const n of novita.novita.slice(0, 6)) {
    const li = el("li");
    const dot = el("span", "dot");
    if (n.carburante && COLORE[n.carburante]) {
      dot.style.background = COLORE[n.carburante];
      dot.style.boxShadow = `0 0 8px ${COLORE[n.carburante]}`;
    }
    const body = el("div");
    body.append(el("span", "t", n.titolo), document.createTextNode(n.testo));
    li.append(dot, body);
    feed.append(li);
  }

  // ---------- trend ----------
  const trendSeries = ["benzina", "gasolio"].map((c) => ({
    key: c,
    name: NOMI_RIF[c],
    color: COLORE[c],
    points: byFuel.get(c).map((r) => ({ date: r.date, v: r.media, lo: r.p10, hi: r.p90 })),
  }));
  const lg = document.getElementById("trend-legend");
  for (const s of trendSeries) {
    const sp = el("span");
    const k = el("span", "key-line");
    k.style.background = s.color;
    sp.append(k, document.createTextNode(s.name));
    lg.append(sp);
  }
  const band = el("span");
  const kb = el("span", "key-band");
  kb.style.background = "var(--text-2)";
  band.append(kb, document.createTextNode("80% dei distributori"));
  lg.append(band);
  const trendEl = document.getElementById("trend");
  trendChart(trendEl, { series: trendSeries, events: EVENTI.map((e) => ({ ...e, date: parseDay(e.d) })) });
  const b0 = byFuel.get("benzina")[0], g0 = byFuel.get("gasolio")[0];
  document.getElementById("trend-title").textContent =
    `Dal ${fmt.giorno(b0.date).trim()}: benzina ${fmt.cent(ultimo("benzina").media - b0.media)} cent, gasolio ${fmt.cent(ultimo("gasolio").media - g0.media)} cent`;
  tableView(trendEl.parentElement, [
    { key: "d", label: "Data" },
    { key: "b", label: "Benzina self (€/l)", num: true, format: fmt.prezzo },
    { key: "g", label: "Gasolio self (€/l)", num: true, format: fmt.prezzo },
    { key: "l", label: "GPL (€/l)", num: true, format: fmt.prezzo },
    { key: "m", label: "Metano (€/kg)", num: true, format: fmt.prezzo },
  ], () => {
    const by = d3.rollup(rif, (v) => Object.fromEntries(v.map((r) => [r.c, r.media])), (r) => r.d);
    return [...by].reverse().map(([d, o]) => ({ d, b: o.benzina, g: o.gasolio, l: o.gpl, m: o.metano }));
  });

  // ---------- pannelli che dipendono dal carburante ----------
  const regionsEl = document.getElementById("regions");
  const brandsEl = document.getElementById("brands");
  const histEl = document.getElementById("hist");
  const provEl = document.getElementById("provinces");
  const oggiISO = d3.max(reg, (r) => r.d);
  const tipoOggi = tipo.filter((r) => r.d === d3.max(tipo, (q) => q.d));

  function renderFuelPanels() {
    const regRows = reg.filter((r) => r.d === oggiISO && r.c === fuel)
      .map((r) => ({ label: r.r, value: r.scarto, media: r.media, n: r.n }))
      .sort((a, b) => b.value - a.value);
    regionsEl.replaceChildren();
    divergingBars(regionsEl, { rows: regRows, colors: [DIVERGING[0], DIVERGING[2]], describe: `Scarto delle regioni dalla media italiana, ${fuel} self` });
    tableView(regionsEl, [
      { key: "label", label: "Regione" },
      { key: "media", label: "€/l", num: true, format: fmt.prezzo },
      { key: "value", label: "vs Italia (cent)", num: true, format: (v) => fmt.cent(v) },
      { key: "n", label: "Distributori", num: true, format: fmt.intero },
    ], () => regRows);
    document.getElementById("reg-title").textContent = `${regRows[0].label} la più cara, ${regRows.at(-1).label} la meno cara`;

    const ref = refOggi();
    const bRows = bandiere.filter((r) => r.c === fuel)
      .map((r) => ({ label: r.marchio, value: r.media - ref, media: r.media, n: r.n }))
      .sort((a, b) => b.value - a.value);
    brandsEl.replaceChildren();
    divergingBars(brandsEl, { rows: bRows, colors: [DIVERGING[0], DIVERGING[2]], rowH: 24, describe: `Scarto dei marchi dalla media italiana, ${fuel} self` });

    const tStr = tipoOggi.find((r) => r.c === fuel && r.t === "Stradale");
    const tAuto = tipoOggi.find((r) => r.c === fuel && r.t === "Autostradale");
    if (tStr && tAuto) {
      const extra = (tAuto.media - tStr.media) * 50;
      const bs = document.getElementById("auto-stat");
      bs.replaceChildren(document.createTextNode(`+${fmt.euro(extra).replace(" €", "")} `), el("small", null, "€ a pieno"));
      document.getElementById("auto-sub").textContent =
        `Un pieno da 50 litri di ${fuel} in autostrada (${fmt.prezzo(tAuto.media)} €/l, ${fmt.intero(tAuto.n)} impianti) contro la rete stradale (${fmt.prezzo(tStr.media)} €/l).`;
    }

    // province: i 5 estremi
    provEl.replaceChildren();
    const pr = prov.filter((r) => r.c === fuel).sort((a, b) => b.media - a.media);
    const block = (titolo, rows, color, startPos) => {
      const h = el("div", "rank-head");
      const sw = el("span", "sw");
      sw.style.background = color;
      h.append(sw, document.createTextNode(titolo));
      const tbl = el("table", "rank");
      rows.forEach((r, i) => {
        const tr = el("tr");
        const name = el("td");
        name.append(document.createTextNode(r.provincia), el("span", "reg", r.regione));
        tr.append(el("td", "pos", String(startPos(i))), name, el("td", "num", `${fmt.prezzo(r.media)} €`), el("td", "num", ` ${fmt.cent(r.scarto)}`));
        tr.lastChild.style.color = "var(--text-2)";
        tr.lastChild.style.paddingLeft = "12px";
        tbl.append(tr);
      });
      provEl.append(h, tbl);
    };
    block("Le più care", pr.slice(0, 5), DIVERGING[2], (i) => i + 1);
    block("Le più economiche", pr.slice(-5).reverse(), DIVERGING[0], (i) => pr.length - i);
    tableView(provEl, [
      { key: "pos", label: "#", num: true },
      { key: "provincia", label: "Provincia" },
      { key: "regione", label: "Regione" },
      { key: "media", label: "€/l", num: true, format: fmt.prezzo },
      { key: "scarto", label: "vs Italia (cent)", num: true, format: (v) => fmt.cent(v) },
    ], () => pr.map((r, i) => ({ ...r, pos: i + 1 })), `Tutte le ${pr.length} province`);

    // istogramma
    histEl.replaceChildren();
    const vals = stations.map((s) => s[CAMPO[fuel]]).filter((v) => v != null).sort(d3.ascending);
    histogram(histEl, {
      values: vals,
      color: COLORE[fuel],
      markers: [
        { value: ref, label: "Media Italia", color: "#e6edf7" },
        ...(tAuto ? [{ value: tAuto.media, label: "Media autostrade", color: DIVERGING[2] }] : []),
      ],
    });
    const sotto = vals.filter((v) => v < ref - 0.05).length;
    document.getElementById("hist-title").textContent =
      `Metà dei distributori sta tra ${fmt.prezzo(d3.quantile(vals, 0.25))} e ${fmt.prezzo(d3.quantile(vals, 0.75))} €/l; ${fmt.intero(sotto)} sono almeno 5 cent sotto la media`;
    tableView(histEl, [
      { key: "q", label: "Percentile" },
      { key: "v", label: "€/l", num: true, format: fmt.prezzo },
    ], () => [0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99].map((q) => ({ q: `${Math.round(q * 100)}°`, v: d3.quantile(vals, q) })));

    document.getElementById("map-title").textContent =
      fuel === "benzina" ? "Dove la benzina costa di più (e di meno)" : "Dove il gasolio costa di più (e di meno)";
    renderLegend();
    renderCount();
    renderFinder();
  }

  renderFuelPanels();

  document.querySelectorAll("#fuel-toggle button").forEach((b) =>
    b.addEventListener("click", () => {
      if (b.dataset.fuel === fuel) return;
      fuel = b.dataset.fuel;
      document.querySelectorAll("#fuel-toggle button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      map.setValue((s) => s[CAMPO[fuel]], refOggi());
      renderFuelPanels();
    })
  );

  reveal();
}

main().catch((err) => {
  console.error(err);
  const p = document.createElement("p");
  p.className = "panel";
  p.textContent = "Non è stato possibile caricare i dati. Riprova tra qualche minuto.";
  document.querySelector("main")?.prepend(p);
});
