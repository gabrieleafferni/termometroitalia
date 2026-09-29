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
import { sparkline, divergingBars, histogram, taxArea } from "./charts/small.js";

const COLORE = { benzina: "#c98500", gasolio: "#8f6ff0", gpl: "#3ecf8e", metano: "#4c9df5" };
// grafico dei marchi: forma "enfasi" (Eni e IP in evidenza, gli altri in grigio). Colori validati.
const COL_ENI = "#199fb5", COL_IP = "#9a7cf0", COL_ALTRI = "#56607a";
const NOME_MARCHIO = { "Agip Eni": "Eni", "Api-Ip": "IP" };
const FONTE_IP = "https://www.ansa.it/sito/notizie/economia/2026/09/28/parte-da-circa-300-distributori-limite-prezzi-ip-tetto-uguale-ad-eni_954645af-a337-4eab-ba58-a19e874b8bdc.html";
const CAMPO = { benzina: "b", gasolio: "g" };
const RANGE = 0.06; // ±6 cent: saturazione della scala colori della mappa

// Eventi di contesto annotati sul grafico storico (solo fatti verificati, con fonte)
const EVENTI = [
  { d: "2026-07-29", label: "Taglio delle accise sul gasolio", detail: "(ANSA, 28 luglio 2026)" },
];

const titleCase = (s) =>
  s.toLowerCase().replace(/(^|[\s'’\-(/])([a-zà-ÿ])/g, (m, p, c) => p + c.toUpperCase()).replace(/\b(Di|De|Del|Della|Dei|Delle|Degli|In|Sul|Sulla|Nel|Nell|Al|Alla|E)\b/g, (w) => w.toLowerCase());

async function main() {
  const [meta, naz, reg, prov, tipo, bandiere, imp, novita, topo, marchi, storico, misure] = await Promise.all([
    load("meta.json"),
    load("carburanti_nazionale.json"),
    load("carburanti_regionale.json"),
    load("carburanti_province_oggi.json"),
    load("carburanti_tipo.json"),
    load("carburanti_bandiere.json"),
    load("carburanti_impianti.json"),
    load("novita.json"),
    loadGeo("regioni.topo.json"),
    load("carburanti_marchi.json"),
    load("carburanti_storico.json"),
    load("misure.json"),
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
    el("strong", null, `Prezzi alle 8:00 del ${fmt.giornoAnno(oggi).trim()}`),
    el("span", null, `aggiornamento automatico ogni 2 ore · ${fmt.intero(stations.length)} distributori · storico giornaliero dal ${fmt.giorno(byFuel.get("benzina")[0].date).trim()}, settimanale dal 2005`)
  );
  stamp.title = "Il MIMIT pubblica i prezzi in vigore alle 8:00 di ogni giorno, di solito la mattina successiva.";

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

  // ---------- vent'anni di prezzi (serie settimanale MASE) ----------
  const sto = fromColumns(storico).map((r) => ({ ...r, date: parseDay(r.d) }));
  const stoBy = d3.group(sto, (r) => r.c);
  const storicoEl = document.getElementById("storico");
  const stoSeries = ["benzina", "gasolio"].map((c) => ({
    key: c,
    name: NOMI_RIF[c].split(" ")[0],
    color: COLORE[c],
    points: stoBy.get(c).map((r) => ({ date: r.date, v: r.p })),
  }));
  const slg = document.getElementById("storico-legend");
  for (const sr of stoSeries) {
    const sp = el("span");
    const k = el("span", "key-line");
    k.style.background = sr.color;
    sp.append(k, document.createTextNode(sr.name));
    slg.append(sp);
  }
  trendChart(storicoEl, {
    series: stoSeries,
    height: 360,
    xTicks: "anni",
    markMax: true,
    events: [{ date: new Date(2022, 1, 24), label: "Invasione russa dell'Ucraina" }],
    tooltipTitle: (d) => `Settimana del ${fmt.giornoAnno(d).trim()}`,
    ariaLabel: "Prezzi settimanali di benzina e gasolio dal 2005",
  });
  const contesto = (c) => {
    const s = stoBy.get(c), u = s.at(-1);
    const sopra = s.slice(0, -1).filter((r) => r.p >= u.p);
    return sopra.length ? { record: false, da: sopra.at(-1) } : { record: true };
  };
  const cg = contesto("gasolio"), cb = contesto("benzina");
  const meseIt = (d) => fmt.giornoAnno(d).trim().split(" ").slice(1).join(" ");
  document.getElementById("storico-title").textContent =
    `${cg.record ? "Gasolio al record dal 2005" : `Gasolio ai massimi da ${meseIt(cg.da.date)}`}, ` +
    `${cb.record ? "benzina al record dal 2005" : `benzina ai massimi da ${meseIt(cb.da.date)}`}`;
  tableView(storicoEl.parentElement, [
    { key: "d", label: "Settimana" },
    { key: "b", label: "Benzina (€/l)", num: true, format: fmt.prezzo },
    { key: "g", label: "Gasolio (€/l)", num: true, format: fmt.prezzo },
  ], () => {
    const by = d3.rollup(sto, (v) => Object.fromEntries(v.map((r) => [r.c, r.p])), (r) => r.d);
    return [...by].reverse().map(([d, o]) => ({ d, b: o.benzina, g: o.gasolio }));
  });

  const tasseEl = document.getElementById("tasse");
  function renderTasse() {
    const pts = stoBy.get(fuel).filter((r) => r.n != null).map((r) => ({ date: r.date, netto: r.n, tasse: r.t }));
    tasseEl.replaceChildren();
    taxArea(tasseEl, { points: pts, color: COLORE[fuel] });
    const u = pts.at(-1);
    document.getElementById("tasse-title").textContent =
      `${fmt.prezzo(u.tasse)} € su ${fmt.prezzo(u.netto + u.tasse)} sono accise e IVA`;
    document.getElementById("tasse-sub").textContent =
      `${NOMI_RIF[fuel].split(" ")[0]}, settimana del ${fmt.giornoAnno(u.date).trim()}: le tasse valgono il ${Math.round((u.tasse / (u.netto + u.tasse)) * 100)}% del prezzo. Negli shock di prezzo si muove soprattutto il prezzo industriale.`;
    const tl = document.getElementById("tasse-legend");
    tl.replaceChildren();
    for (const [c, t] of [[COLORE[fuel], "Prezzo industriale"], ["#56607a", "Accise e IVA"]]) {
      const sp = el("span");
      const k = el("span", "key-rect");
      k.style.background = c;
      sp.append(k, document.createTextNode(t));
      tl.append(sp);
    }
  }

  // ---------- tetto Eni e reazione degli altri marchi ----------
  marchi.forEach((r) => (r.date = parseDay(r.d)));
  const misura = misure.filter((m) => m.misura_id === "tetto_eni_2026");
  const tetto = Object.fromEntries(misura.map((m) => [m.carburante, +m.prezzo_max]));
  const tDal = parseDay(misura[0].valida_dal);
  const tAl = parseDay(misura[0].valida_al);
  const ultimoMarchi = d3.max(marchi, (r) => r.date);
  const marchiEl = document.getElementById("marchi-chart");

  function renderTetto() {
    const inVigore = ultimoMarchi >= tDal;
    const badge = el("span", `badge ${inVigore ? "on" : "wait"}`,
      inVigore ? `in vigore dal ${fmt.giorno(tDal).trim()} al ${fmt.giorno(tAl).trim()}` : `in vigore dal ${fmt.giorno(tDal).trim()} · dati in arrivo`);
    const sub = document.getElementById("tetto-sub");
    sub.replaceChildren(badge, el("br"), document.createTextNode(
      `Eni ha fissato un prezzo massimo self di ${fmt.prezzo2(tetto.benzina)} €/l per la benzina e ${fmt.prezzo2(tetto.gasolio)} €/l per il gasolio. ` +
      (inVigore
        ? `Qui misuriamo ogni giorno quanti distributori Eni lo rispettano davvero.`
        : `Il MIMIT pubblica i prezzi di ogni giorno la mattina successiva: la prima rilevazione con il tetto (${fmt.giorno(tDal).trim()}) comparirà qui con l'aggiornamento del ${fmt.giorno(d3.timeDay.offset(tDal, 1)).trim()}. Per ora vedi la situazione di partenza.`)
    ));

    const stats = document.getElementById("tetto-stats");
    stats.replaceChildren();
    for (const c of ["benzina", "gasolio"]) {
      const r = marchi.find((q) => +q.date === +ultimoMarchi && q.m === "Agip Eni" && q.c === c);
      if (!r) continue;
      const box = el("div", "tetto-stat");
      const l = el("div", "l");
      const key = el("span");
      key.style.cssText = `width:14px;height:3px;border-radius:2px;background:${COLORE[c]}`;
      l.append(key, document.createTextNode(`${NOMI_RIF[c]} ≤ ${fmt.prezzo2(tetto[c])} €/l`));
      const v = el("div", "v");
      const perc = r.q * 100;
      v.append(document.createTextNode(`${perc < 10 ? perc.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : fmt.intero(Math.round(perc))}%`), el("small", null, "dei distributori Eni"));
      const meter = el("div", "meter");
      const bar = el("span");
      bar.style.width = `${Math.max(1, r.q * 100)}%`;
      meter.append(bar);
      const d = el("div", "d", `${inVigore ? "Prezzi alle 8:00 del" : "Prima del tetto,"} ${fmt.giorno(ultimoMarchi).trim()} · ${fmt.intero(Math.round(r.q * r.n))} su ${fmt.intero(r.n)} impianti · media Eni ${fmt.prezzo(r.media)} €/l`);
      box.append(l, v, meter, d);
      // il file MIMIT fotografa le 8:00: chi non ha ancora aggiornato il prezzo quel giorno
      // conserva il prezzo vecchio. Tra chi ha aggiornato, l'adesione si legge meglio.
      if (inVigore && r.qa != null && r.qa > r.q + 0.1) {
        box.append(el("div", "d", `Tra i ${fmt.intero(r.na)} che alle 8:00 avevano già aggiornato il prezzo: ${fmt.intero(Math.round(r.qa * 100))}% entro il tetto`));
      }
      stats.append(box);
    }

    const note = document.getElementById("tetto-note");
    note.replaceChildren(
      document.createTextNode("Il tetto vale nei circa 3.000 impianti gestiti direttamente da Enilive (su circa 3.900 a marchio Eni) ed esclude l'autostrada: anche se applicato ovunque, la quota non arriverà al 100%. "),
      Object.assign(el("a", null, "Comunicato Eni"), { href: misura[0].fonte, target: "_blank", rel: "noopener" }),
      document.createTextNode(". I dati MIMIT sono i prezzi in vigore alle 8:00: nei primi giorni di una misura molti distributori non hanno ancora aggiornato il prezzo a quell'ora, quindi la quota cresce nei giorni successivi. Anche IP applica gli stessi prezzi massimi, per ora su circa 300 dei suoi impianti con estensione progressiva: lo seguiamo nel grafico a fianco ("),
      Object.assign(el("a", null, "fonte"), { href: FONTE_IP, target: "_blank", rel: "noopener" }),
      document.createTextNode(")."),
    );

    // grafico: prezzo medio per marchio, ultimi 30 giorni
    const inizio = d3.timeDay.offset(ultimoMarchi, -30);
    const righe = marchi.filter((r) => r.c === fuel && r.date >= inizio);
    const perMarchio = d3.group(righe, (r) => r.m);
    const ordine = ["Q8", "Esso", "Tamoil", "Pompe Bianche", "Altri marchi", "Api-Ip", "Agip Eni"];
    const series = ordine.filter((m) => perMarchio.has(m)).map((m) => ({
      key: m,
      name: NOME_MARCHIO[m] ?? m,
      color: m === "Agip Eni" ? COL_ENI : m === "Api-Ip" ? COL_IP : COL_ALTRI,
      width: m === "Agip Eni" || m === "Api-Ip" ? 2 : 1.25,
      label: m === "Agip Eni" || m === "Api-Ip",
      points: perMarchio.get(m).map((r) => ({ date: r.date, v: r.media })),
    }));
    marchiEl.replaceChildren();
    trendChart(marchiEl, {
      series,
      height: 320,
      refLines: [{ value: tetto[fuel], label: `Tetto Eni ${fmt.prezzo2(tetto[fuel])} €/l` }],
      events: [{ date: tDal, label: "Tetto Eni in vigore" }],
      tooltipNote: "Media self dei distributori fuori autostrada",
      ariaLabel: `Prezzo medio del ${fuel} self per marchio negli ultimi 30 giorni, con il tetto Eni`,
    });
    const ml = document.getElementById("marchi-legend");
    ml.replaceChildren();
    for (const [c, t] of [[COL_ENI, "Eni"], [COL_IP, "IP"], [COL_ALTRI, "Q8, Esso, Tamoil, pompe bianche, altri"]]) {
      const sp = el("span");
      const k = el("span", "key-line");
      k.style.background = c;
      sp.append(k, document.createTextNode(t));
      ml.append(sp);
    }
    document.getElementById("marchi-title").textContent = `${fuel === "benzina" ? "Benzina" : "Gasolio"} self per marchio, rete stradale`;
    marchiEl.parentElement.querySelector("details.table-view")?.remove();
    tableView(marchiEl.parentElement, [
      { key: "d", label: "Data" },
      { key: "m", label: "Marchio", format: (m) => NOME_MARCHIO[m] ?? m },
      { key: "media", label: "Media (€/l)", num: true, format: fmt.prezzo },
      { key: "q", label: `≤ ${fmt.prezzo2(tetto[fuel])} €/l`, num: true, format: (q) => fmt.pct(q) },
      { key: "n", label: "Impianti", num: true, format: fmt.intero },
    ], () => [...righe].sort((a, b) => d3.descending(a.d, b.d) || d3.ascending(a.media, b.media)));
  }

  // ---------- pannelli che dipendono dal carburante ----------
  const regionsEl = document.getElementById("regions");
  const brandsEl = document.getElementById("brands");
  const histEl = document.getElementById("hist");
  const provEl = document.getElementById("provinces");
  const oggiISO = d3.max(reg, (r) => r.d);
  const tipoOggi = tipo.filter((r) => r.d === d3.max(tipo, (q) => q.d));

  function renderFuelPanels() {
    renderTetto();
    renderTasse();
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
