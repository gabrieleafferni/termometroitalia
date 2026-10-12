import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "../css/style.css";

import * as d3 from "d3";
import { feature } from "topojson-client";
import { load, loadGeo } from "./lib/data.js";
import { fmt, parseDay } from "./lib/format.js";
import { chrome, el, ttTitle, ttRow, tableView, countUp, reveal, reducedMotion } from "./lib/ui.js";
import { trendChart } from "./charts/trend.js";
import { sparkline } from "./charts/small.js";
import { refBars, rangeDots, choropleth } from "./charts/salari.js";

// Colori (validati con lo strumento dataviz sul pannello scuro #0b1122):
// salari = blu, prezzi = arancio, retribuzioni di fatto = acqua, quarto colore = giallo
const COL = { salari: "#3987e5", prezzi: "#d95926", fatto: "#199e70", giallo: "#c98500", grigio: "#56607a" };
const COL_TESTO = "#e6edf7";
const RAMPA = ["#184f95", "#2a78d6", "#5598e7", "#9ec5f4"]; // sequenziale blu, scuro = basso
const NOME_DEFL = { nic: "NIC", ipca: "IPCA" };
const PAESI_EVIDENZA = [
  { p: "ITA", c: COL.salari },
  { p: "DEU", c: COL.prezzi },
  { p: "FRA", c: COL.fatto },
  { p: "ESP", c: COL.giallo },
];

const pct = (x, dec = 1) => {
  const s = (Math.abs(x) * 100).toLocaleString("it-IT", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return (x > 0.00005 ? "+" : x < -0.00005 ? "−" : "") + s + "%";
};
const pctNoSign = (x, dec = 0) => (x * 100).toLocaleString("it-IT", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + "%";
const uno = (v) => v.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const euro2 = (v) => v.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const meseAnno = (d) => fmt.giornoAnno(d).trim().split(" ").slice(1).join(" ");
// "ad agosto 2026", "a settembre 2026"
const aMese = (d) => (meseAnno(d).startsWith("a") ? "ad " : "a ") + meseAnno(d);

async function main() {
  const [meta, S, mondo, orari, topo, novita] = await Promise.all([
    load("meta.json"),
    load("salari.json"),
    load("salari_mondo.json"),
    load("salari_orari.json"),
    loadGeo("province_2023.topo.json"),
    load("novita.json").catch(() => null), // le notizie sono facoltative: la pagina regge senza
  ]);
  chrome("salari", meta);

  const mesi = S.mesi.map(parseDay);
  const pos = new Map(mesi.map((d, i) => [+d, i]));
  const iMese = (y, m) => pos.get(+new Date(y, m - 1, 1));
  const ultimo = mesi.length - 1;
  const w = S.serie["0010|totale"];
  let defl = "nic";
  const P = () => S[defl];
  const iAnnoPrima = ultimo - 12;
  // I confronti usano medie: la base è la media di un anno intero (2021 o 2005) e
  // l'ultimo dato è la media degli ultimi 12 mesi. Così non pesano le una tantum
  // di dicembre né i saldi stagionali, che fanno oscillare l'IPCA (gennaio e luglio).
  const media = (arr, i0, i1) => d3.mean(d3.range(i0, i1 + 1), (i) => arr[i]);
  const mediaAnno = (arr, anno) => media(arr, iMese(anno, 1), iMese(anno, 12));
  const media12 = (arr, i) => media(arr, i - 11, i);
  // salario reale negli ultimi 12 mesi fino al mese i, rispetto alla media di un anno
  const reale12 = (i, anno) => (media12(w, i) / mediaAnno(w, anno)) / (media12(P(), i) / mediaAnno(P(), anno)) - 1;
  // salario reale di un singolo mese rispetto alla media di un anno (grafico e tooltip)
  const realeMese = (i, anno) => (w[i] / mediaAnno(w, anno)) / (P()[i] / mediaAnno(P(), anno)) - 1;
  const iDic21 = iMese(2021, 12);

  // ---------- intestazione ----------
  const stamp = document.getElementById("stamp");
  stamp.append(
    el("strong", null, `Retribuzioni contrattuali fino ${aMese(mesi[ultimo])}`),
    el("span", null, `ISTAT · prezzi NIC e IPCA · i dati si aggiornano da soli quando vengono pubblicati`)
  );

  // ---------- KPI ----------
  const kpis = document.getElementById("kpis");
  function kpi(label, color, value, unit, righe, hero = false) {
    const card = el("article", `panel kpi reveal${hero ? " kpi-hero kpi-salari" : ""}`);
    const lab = el("div", "kpi-label");
    if (color) {
      const key = el("span", "key");
      key.style.background = color;
      lab.append(key);
    }
    lab.append(el("span", null, label));
    const val = el("div", "kpi-value");
    const num = el("span", null, value);
    val.append(num);
    if (unit) val.append(el("span", "unit", unit));
    const sub = el("div", "kpi-sub");
    for (const r of righe) sub.append(el("div", null, r));
    card.append(lab, val, sub);
    kpis.append(card);
    return { card, num, sub };
  }
  const k1 = kpi("Salari reali rispetto al 2021", COL.salari, "", null, [], true);
  const spark = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  spark.classList.add("spark");
  k1.card.append(spark);
  const k2 = kpi("Salari in un anno", COL.salari, "", null, []);
  const tens = d3.group(S.tensione, (r) => r.c);
  const tTot = tens.get("totale").at(-1), tPriv = tens.get("privato").at(-1), tPa = tens.get("pa").at(-1);
  kpi(`Dipendenti in attesa di rinnovo · ${meseAnno(parseDay(tTot.m))}`, null, pctNoSign(tTot.q), null, [
    `${pctNoSign(tPriv.q)} nel privato, ${pctNoSign(tPa.q)} nella PA`,
    `attesa media ${fmt.intero(Math.round(tTot.ma))} mesi`,
  ]);
  const ita = mondo.filter((r) => r.p === "ITA" && r.i != null);
  const ocse = mondo.filter((r) => r.p === "OECD" && r.i != null);
  const uIta = ita.at(-1), uOcse = ocse.find((r) => r.a === uIta.a) ?? ocse.at(-1);
  kpi(`Salario medio reale dal 1991 · OCSE`, null, pct(uIta.i / 100 - 1, 0), null, [
    `Italia nel ${uIta.a}; media OCSE ${pct(uOcse.i / 100 - 1, 0)}`,
    "a prezzi costanti e parità di potere d'acquisto",
  ]);

  function aggiornaKpi() {
    const r = reale12(ultimo, 2021);
    k1.num.textContent = pct(r);
    countUp(k1.num, r, (v) => pct(v));
    // andamento e minimo delle medie di 12 mesi, dal dicembre 2021 (= media 2021)
    const curva = d3.range(iDic21, ultimo + 1).map((i) => ({ i, v: reale12(i, 2021) }));
    const minimo = d3.least(curva, (c) => c.v);
    k1.sub.replaceChildren(
      el("div", null, `ultimi 12 mesi (fino ${aMese(mesi[ultimo])}) contro la media 2021, al netto dell'inflazione ${NOME_DEFL[defl]}`),
      el("div", null, `minimo: ${pct(minimo.v)} nei 12 mesi fino ${aMese(mesi[minimo.i])}`)
    );
    spark.replaceChildren();
    sparkline(spark, curva.map((c) => c.v), COL.salari);

    const ws = w[ultimo] / w[iAnnoPrima] - 1, ps = P()[ultimo] / P()[iAnnoPrima] - 1;
    k2.num.textContent = pct(ws);
    k2.sub.replaceChildren(
      el("div", null, `prezzi ${pct(ps)} (${NOME_DEFL[defl]}) da ${meseAnno(mesi[iAnnoPrima])}`),
      el("div", null, ws >= ps ? "i salari crescono più dei prezzi" : "i prezzi crescono più dei salari")
    );
  }

  // ---------- le notizie dai dati ----------
  // frasi prodotte ogni giorno dalla pipeline (pipeline/insights.py, tema "salari"):
  // cambiano quando escono dati nuovi; ognuna rimanda al grafico che la mostra
  const notizie = (novita?.novita ?? []).filter((n) => n.tema === "salari")
    .sort((a, b) => b.rilevanza - a.rilevanza).slice(0, 6);
  if (notizie.length) {
    document.getElementById("notizie-head").hidden = false;
    const box = document.getElementById("notizie");
    notizie.forEach((n, i) => {
      const card = el("article", `panel notizia reveal${i === 0 ? " in-evidenza" : ""}`);
      if (n.periodo) card.append(el("span", "tag", n.periodo));
      card.append(el("h3", null, n.titolo), el("p", null, n.testo));
      if (n.ancora && document.getElementById(n.ancora)) {
        const a = el("a", null, "Vedi il grafico →");
        a.href = `#${n.ancora}`;
        card.append(a);
      }
      box.append(card);
    });
  }

  // ---------- spiegazione NIC / IPCA ----------
  const spiega = document.getElementById("spiega");
  const spiegaBtn = document.getElementById("spiega-btn");
  const apriSpiega = (aperta) => {
    spiega.hidden = !aperta;
    spiegaBtn.setAttribute("aria-expanded", String(aperta));
    if (aperta) spiega.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "nearest" });
  };
  spiegaBtn.addEventListener("click", () => apriSpiega(spiega.hidden));
  document.getElementById("spiega-chiudi").addEventListener("click", () => { apriSpiega(false); spiegaBtn.focus(); });
  for (const d of ["nic", "ipca"]) {
    const arr = S[d];
    const dal21 = media12(arr, ultimo) / mediaAnno(arr, 2021) - 1;
    const anno = arr[ultimo] / arr[iAnnoPrima] - 1;
    document.getElementById(`spiega-${d}`).textContent =
      `Dal 2021: ${pct(dal21)} · nell'ultimo anno: ${pct(anno)} (fino ${aMese(mesi[ultimo])})`;
  }

  // ---------- salari contro prezzi ----------
  const forbiceEl = document.getElementById("forbice-chart");
  let daAnno = 2021;
  function renderForbice() {
    const i0 = iMese(daAnno, 1);
    const bw = mediaAnno(w, daAnno), bp = mediaAnno(P(), daAnno);
    const pts = d3.range(i0, ultimo + 1);
    const sal = pts.map((i) => ({ date: mesi[i], v: (w[i] / bw) * 100 }));
    const pre = pts.map((i) => {
      const vs = (w[i] / bw) * 100, vp = (P()[i] / bp) * 100;
      // fascia arancio solo dove i prezzi superano i salari: la perdita di potere d'acquisto
      return { date: mesi[i], v: vp, lo: Math.min(vs, vp), hi: vp };
    });
    forbiceEl.replaceChildren();
    trendChart(forbiceEl, {
      series: [
        { key: "prezzi", name: `Prezzi (${NOME_DEFL[defl]})`, shortName: "Prezzi", color: COL.prezzi, points: pre },
        { key: "salari", name: "Salari contrattuali", shortName: "Salari", color: COL.salari, points: sal },
      ],
      height: 380,
      unit: "",
      yFormat: (v) => fmt.intero(v),
      valueFormat: uno,
      xTicks: daAnno === 2021 ? "anno" : "anni",
      tooltipTitle: (d) => meseAnno(d),
      tooltipNote: (d) => `Salari reali: ${pct(realeMese(pos.get(+d), daAnno))} rispetto alla media ${daAnno}`,
      ariaLabel: `Retribuzioni contrattuali orarie e prezzi al consumo (${NOME_DEFL[defl]}), media ${daAnno} = 100`,
    });
    const ws = media12(w, ultimo) / bw - 1, ps = media12(P(), ultimo) / bp - 1;
    document.getElementById("forbice-title").textContent =
      `Dal ${daAnno} i prezzi sono saliti del ${pct(ps).replace("+", "")}, i salari del ${pct(ws).replace("+", "")}`;
    document.getElementById("forbice-sub").textContent =
      `Retribuzioni contrattuali orarie (tutti i dipendenti, esclusi i dirigenti) e prezzi al consumo ${NOME_DEFL[defl]}, media ${daAnno} = 100. ` +
      `Le variazioni del titolo confrontano gli ultimi 12 mesi con la media del ${daAnno}. La fascia arancio è il potere d'acquisto perso: ` +
      (() => {
        const r = reale12(ultimo, daAnno);
        const v = pct(Math.abs(r)).replace("+", "");
        return Math.abs(r) < 0.0005 ? `al netto dell'inflazione i salari valgono quanto nel ${daAnno}.`
          : `al netto dell'inflazione i salari valgono il ${v} ${r < 0 ? "in meno" : "in più"} che nel ${daAnno}.`;
      })();
    document.getElementById("forbice-note").textContent =
      "I salari contrattuali sono quelli fissati dai contratti nazionali; i picchi di dicembre sono gli importi una tantum previsti da alcuni rinnovi. " +
      (defl === "ipca" ? "L'IPCA comprende i saldi di gennaio e luglio, che lo fanno oscillare nel corso dell'anno. " : "") +
      "Le retribuzioni di fatto, con straordinari e premi, sono nel grafico \"Potere d'acquisto\".";
    forbiceEl.parentElement.querySelector("details.table-view")?.remove();
    tableView(forbiceEl.parentElement, [
      { key: "m", label: "Mese" },
      { key: "s", label: "Salari (indice)", num: true, format: uno },
      { key: "p", label: `Prezzi ${NOME_DEFL[defl]} (indice)`, num: true, format: uno },
      { key: "r", label: "Salari reali", num: true, format: (v) => pct(v) },
    ], () => pts.map((i) => ({ m: meseAnno(mesi[i]), s: (w[i] / bw) * 100, p: (P()[i] / bp) * 100, r: realeMese(i, daAnno) })).reverse());
  }
  const legenda = (id, voci) => {
    const lg = document.getElementById(id);
    lg.replaceChildren();
    for (const [c, t] of voci) {
      const sp = el("span");
      const k = el("span", "key-line");
      k.style.background = c;
      sp.append(k, document.createTextNode(t));
      lg.append(sp);
    }
  };
  document.querySelectorAll("#forbice-da button").forEach((b) => b.addEventListener("click", () => {
    daAnno = +b.dataset.da;
    document.querySelectorAll("#forbice-da button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderForbice();
  }));

  // ---------- settore per settore ----------
  const settoriEl = document.getElementById("settori-chart");
  let rif = 2021, qual = "totale";
  function renderSettori() {
    const righe = S.settori.filter((r) => r.rif === rif && r.q === qual && (r.l === "sezione" || r.s === "0010"));
    const tot = righe.find((r) => r.s === "0010");
    const prezzi = defl === "nic" ? tot.pn : tot.pi;
    const rows = righe.map((r) => ({
      key: r.s, label: r.s === "0010" ? "Totale economia" : r.nb, value: r.nom, evidenza: r.s === "0010",
      reale: defl === "nic" ? r.rn : r.ri, nome: r.nome, tend: r.st,
    })).sort((a, b) => (b.evidenza - a.evidenza) || (b.value - a.value));
    settoriEl.replaceChildren();
    refBars(settoriEl, {
      rows,
      ref: { value: prezzi, label: `Prezzi ${pct(prezzi)}` },
      color: COL.salari,
      colorEvidenza: COL_TESTO,
      describe: `Aumento delle retribuzioni contrattuali orarie per settore dal ${rif} e aumento dei prezzi`,
      tooltip: (r, t) => {
        ttTitle(t, r.nome, qual === "totale" ? "Tutti i dipendenti" : qual[0].toUpperCase() + qual.slice(1));
        ttRow(t, COL.salari, `Salari dal ${rif}`, pct(r.value));
        ttRow(t, COL.prezzi, `Prezzi (${NOME_DEFL[defl]})`, pct(prezzi));
        ttRow(t, null, "Salari reali", pct(r.reale));
        if (r.tend != null) ttRow(t, null, "Salari, ultimo anno", pct(r.tend));
      },
    });
    const sopra = rows.filter((r) => !r.evidenza && r.value >= prezzi);
    const sez = rows.filter((r) => !r.evidenza);
    const peggio = d3.least(sez, (r) => r.reale), meglio = d3.greatest(sez, (r) => r.reale);
    document.getElementById("settori-title").textContent = sopra.length === 0
      ? `Nessun settore ha tenuto il passo dei prezzi dal ${rif}`
      : `${sopra.length} settori su ${sez.length} hanno tenuto il passo dei prezzi dal ${rif}`;
    document.getElementById("settori-sub").textContent =
      `Aumento delle retribuzioni contrattuali orarie: media degli ultimi 12 mesi contro la media del ${rif}. ` +
      `La linea tratteggiata è l'aumento dei prezzi (${NOME_DEFL[defl]}) nello stesso periodo: una barra che non ci arriva è potere d'acquisto perso. ` +
      `Al netto dell'inflazione va meglio ${meglio.label.toLowerCase()} (${pct(meglio.reale)}), peggio ${peggio.label.toLowerCase()} (${pct(peggio.reale)}).`;
    settoriEl.parentElement.querySelector("details.table-view")?.remove();
    tableView(settoriEl.parentElement, [
      { key: "label", label: "Settore" },
      { key: "value", label: `Salari dal ${rif}`, num: true, format: (v) => pct(v) },
      { key: "reale", label: `Reali (${NOME_DEFL[defl]})`, num: true, format: (v) => pct(v) },
    ], () => rows);
  }
  legenda("settori-legend", [[COL.salari, "Salari contrattuali"], [COL_TESTO, "Prezzi nello stesso periodo (linea tratteggiata)"]]);
  const segSettori = (sel, attr, set) => document.querySelectorAll(`${sel} button`).forEach((b) => b.addEventListener("click", () => {
    set(b.dataset[attr]);
    document.querySelectorAll(`${sel} button`).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderSettori();
  }));
  segSettori("#settori-rif", "rif", (v) => (rif = +v));
  segSettori("#settori-q", "q", (v) => (qual = v));

  // ---------- potere d'acquisto: contrattuali e di fatto, 2021 = 100 ----------
  const realeEl = document.getElementById("reale-chart");
  function renderReale() {
    const i15 = iMese(2015, 1);
    const anno21 = d3.range(iMese(2021, 1), iMese(2021, 12) + 1);
    const base = d3.mean(anno21, (i) => w[i] / P()[i]);
    const contr = d3.range(i15, ultimo + 1).map((i) => ({ date: mesi[i], v: (w[i] / P()[i]) / base * 100 }));
    const df = S.di_fatto;
    const prezzoTrim = defl === "nic" ? df.nic : df.ipca;
    const fatto = df.t.map((t, k) => {
      const d = parseDay(t);
      return { date: new Date(d.getFullYear(), d.getMonth() + 1, 1), v: df.i[k] / prezzoTrim[k] * 100 };
    });
    realeEl.replaceChildren();
    trendChart(realeEl, {
      series: [
        { key: "contr", name: "Contrattuali", color: COL.salari, points: contr },
        { key: "fatto", name: "Di fatto", color: COL.fatto, points: fatto },
      ],
      height: 400,
      unit: "",
      yFormat: (v) => fmt.intero(v),
      valueFormat: uno,
      xTicks: "anni",
      refLines: [{ value: 100, label: "media 2021" }],
      tooltipTitle: (d) => meseAnno(d),
      tooltipNote: `Al netto dell'inflazione ${NOME_DEFL[defl]}, media 2021 = 100`,
      ariaLabel: `Retribuzioni contrattuali e di fatto al netto dell'inflazione ${NOME_DEFL[defl]}, media 2021 = 100`,
    });
    const uc = contr.at(-1), uf = fatto.at(-1);
    document.getElementById("reale-title").textContent =
      `Al netto dell'inflazione, salari ${uc.v < 100 && uf.v < 100 ? "ancora sotto" : "di nuovo sopra"} il 2021`;
    document.getElementById("reale-sub").textContent =
      `Media 2021 = 100. Contrattuali: ${uno(uc.v)} ${aMese(uc.date)}. Di fatto (retribuzioni lorde per unità di lavoro a tempo pieno, ` +
      `con straordinari, premi e arretrati; industria e servizi esclusa la PA, dati destagionalizzati): ${uno(uf.v)} nel ${["primo", "secondo", "terzo", "quarto"][Math.floor(parseDay(df.t.at(-1)).getMonth() / 3)]} trimestre ${parseDay(df.t.at(-1)).getFullYear()}. ` +
      "Il picco del 2020 coincide con la pandemia e la cassa integrazione: in quei trimestri la media per unità di lavoro va letta con cautela.";
  }
  legenda("reale-legend", [[COL.salari, "Retribuzioni contrattuali (mensili)"], [COL.fatto, "Retribuzioni di fatto (trimestrali)"]]);

  // ---------- contratti scaduti ----------
  const rinnoviEl = document.getElementById("rinnovi-chart");
  const COMPARTI = [
    { c: "totale", n: "Totale", color: COL_TESTO },
    { c: "privato", n: "Privato", color: COL.fatto },
    { c: "pa", n: "PA", legenda: "Pubblica amministrazione (PA)", color: COL.giallo },
  ];
  trendChart(rinnoviEl, {
    series: COMPARTI.map(({ c, n, color }) => ({
      key: c, name: n, color,
      points: tens.get(c).map((r) => ({ date: parseDay(r.m), v: r.q * 100 })),
    })),
    height: 320,
    unit: "%",
    yDomain: [0, 100],
    xTicks: "anno",
    yFormat: (v) => `${fmt.intero(v)}%`,
    valueFormat: (v) => fmt.intero(Math.round(v)),
    tooltipTitle: (d) => meseAnno(d),
    tooltipNote: "Quota di dipendenti con il contratto nazionale scaduto",
    ariaLabel: "Quota di dipendenti in attesa di rinnovo del contratto, totale, privato e pubblica amministrazione",
  });
  legenda("rinnovi-legend", COMPARTI.map(({ n, legenda: l, color }) => [color, l ?? n]));
  const stats = document.getElementById("rinnovi-stats");
  const stat = (parent, l, v, small, extra) => {
    const d = el("div", "hist-stat");
    const vv = el("div", "v", v);
    if (small) vv.append(el("small", null, small));
    d.append(el("div", "l", l), vv);
    if (extra) d.append(el("div", "hist-prima", extra));
    parent.append(d);
  };
  stat(stats, `Totale · ${meseAnno(parseDay(tTot.m))}`, pctNoSign(tTot.q), "dei dipendenti", `attesa media ${fmt.intero(Math.round(tTot.ma))} mesi`);
  stat(stats, "Settore privato", pctNoSign(tPriv.q), "", `attesa media ${fmt.intero(Math.round(tPriv.ma))} mesi`);
  stat(stats, "Pubblica amministrazione", pctNoSign(tPa.q), "", tPa.q > 0 ? `attesa media ${fmt.intero(Math.round(tPa.ma))} mesi` : "");
  // PA: per quanti mesi di fila tutti i dipendenti pubblici hanno avuto il contratto scaduto
  const pa = tens.get("pa");
  const pieni = pa.filter((r) => r.q >= 0.999);
  if (pieni.length >= 12) {
    document.getElementById("rinnovi-chart").insertAdjacentElement("afterend", el("p", "note",
      `Nella pubblica amministrazione la quota è stata del 100% in ${pieni.length} mesi su ${pa.length}, ` +
      `da ${meseAnno(parseDay(pieni[0].m))} ${aMese(parseDay(pieni.at(-1).m))}: in tutti quei mesi ogni dipendente pubblico aveva il contratto nazionale scaduto.`));
  }
  const serieTot = tens.get("totale");
  const tAnnoPrima = serieTot.at(-13);
  const art = (q) => (/^(8|11)/.test(String(Math.round(q * 100))) ? "l'" : "il ");
  document.getElementById("rinnovi-title").textContent =
    `${aMese(parseDay(tTot.m)).replace(/^a/, "A")} aspetta il rinnovo ${art(tTot.q)}${pctNoSign(tTot.q)} dei dipendenti` +
    (tAnnoPrima ? `: un anno prima ${tAnnoPrima.q > tTot.q ? "erano" : "erano solo"} ${art(tAnnoPrima.q)}${pctNoSign(tAnnoPrima.q)}` : "");
  tableView(rinnoviEl.parentElement, [
    { key: "m", label: "Mese" },
    ...COMPARTI.map(({ c, n }) => ({ key: c, label: n, num: true, format: (v) => (v == null ? "" : pctNoSign(v)) })),
  ], () => {
    const by = d3.rollup(S.tensione, (v) => Object.fromEntries(v.map((r) => [r.c, r.q])), (r) => r.m);
    return [...by].map(([m, o]) => ({ m: meseAnno(parseDay(m)), ...o })).reverse();
  });

  // ---------- Italia nel mondo (OCSE) ----------
  const perPaese = d3.group(mondo.filter((r) => r.i != null), (r) => r.p);
  const evidenza = new Map(PAESI_EVIDENZA.map((x) => [x.p, x.c]));
  const mondoSeries = [];
  for (const [p, righe] of perPaese) {
    if (evidenza.has(p) || p === "OECD") continue;
    mondoSeries.push({ key: p, name: righe[0].n, color: "#2a3556", width: 1, label: false, tooltip: false,
      points: righe.map((r) => ({ date: new Date(r.a, 0, 1), v: r.i })) });
  }
  mondoSeries.push({ key: "OECD", name: "Media OCSE", shortName: "OCSE", color: COL_TESTO, width: 1.5,
    points: perPaese.get("OECD").map((r) => ({ date: new Date(r.a, 0, 1), v: r.i })) });
  for (const { p, c } of PAESI_EVIDENZA) {
    const righe = perPaese.get(p);
    // etichetta a fine linea solo per l'Italia (e la media OCSE): gli altri si leggono
    // dalla legenda e dal tooltip, così le etichette non si sovrappongono
    if (righe) mondoSeries.push({ key: p, name: righe[0].n, color: c, label: p === "ITA",
      points: righe.map((r) => ({ date: new Date(r.a, 0, 1), v: r.i })) });
  }
  trendChart(document.getElementById("mondo-chart"), {
    series: mondoSeries,
    height: 440,
    unit: "",
    yDomain: [60, 200],
    yFormat: (v) => fmt.intero(v),
    valueFormat: (v) => fmt.intero(Math.round(v)),
    xTicks: "anni",
    refLines: [{ value: 100, label: "" }],
    tooltipTitle: (d) => String(d.getFullYear()),
    tooltipNote: "Salario medio annuo reale, 1991 = 100",
    ariaLabel: "Salario medio annuo reale dal 1991 (1991 = 100): Italia, Germania, Francia, Spagna e media OCSE, con gli altri paesi OCSE in grigio",
  });
  legenda("mondo-legend", [...PAESI_EVIDENZA.map(({ p, c }) => [c, perPaese.get(p)?.[0].n ?? p]), [COL_TESTO, "Media OCSE"], ["#2a3556", "Altri paesi OCSE"]]);
  const ultimiAnno = [...perPaese.values()].map((r) => r.at(-1)).filter((r) => r.a === uIta.a && r.p !== "OECD").sort((a, b) => a.i - b.i);
  const posIta = ultimiAnno.findIndex((r) => r.p === "ITA") + 1;
  const fuoriScala = [...perPaese.values()].filter((r) => d3.max(r, (x) => x.i) > 200).map((r) => r[0].n).sort();
  document.getElementById("mondo-title").textContent =
    `Dal 1991 i salari reali sono cresciuti del ${pct(uOcse.i / 100 - 1, 0).replace("+", "")} nella media OCSE; in Italia sono ${uIta.i < 100 ? "scesi del " + pct(uIta.i / 100 - 1, 0).replace("−", "") : "saliti del " + pct(uIta.i / 100 - 1, 0).replace("+", "")}`;
  document.getElementById("mondo-sub").textContent =
    `Salario medio annuo per dipendente a tempo pieno, a prezzi costanti e a parità di potere d'acquisto (OCSE), 1991 = 100. ` +
    `Nel ${uIta.a} l'Italia è ${posIta === 1 ? "l'ultima" : `${posIta}ª dal basso`} tra i ${ultimiAnno.length} paesi con dati dal 1991. ` +
    `Scala fino a 200: ${fuoriScala.length ? fuoriScala.join(", ") + " la superano." : "nessun paese la supera."}`;
  tableView(document.getElementById("mondo"), [
    { key: "n", label: "Paese" },
    { key: "i", label: `${uIta.a} (1991 = 100)`, num: true, format: (v) => fmt.intero(Math.round(v)) },
  ], () => [...ultimiAnno].reverse().map((r) => ({ n: r.n, i: r.i })));

  // ---------- livelli in euro (Eurostat) ----------
  const LIVELLI = ["EU27_2020", "DEU", "FRA", "NLD", "ESP", "ITA", "POL", "PRT", "GRC"];
  const euroAnno = d3.max(mondo.filter((r) => r.e != null && r.p === "ITA"), (r) => r.a);
  const livelli = LIVELLI.map((p) => mondo.find((r) => r.p === p && r.a === euroAnno)).filter((r) => r?.e != null)
    .map((r) => ({ key: r.p, label: r.p === "EU27_2020" ? "Unione europea" : r.n, value: r.e, evidenza: r.p === "ITA" }))
    .sort((a, b) => b.value - a.value);
  const euroK = (v) => `${fmt.intero(Math.round(v))} €`;
  refBars(document.getElementById("livelli-chart"), {
    rows: livelli,
    color: COL.grigio,
    colorEvidenza: COL.salari,
    format: (v) => (Math.abs(v) >= 1000 ? `${fmt.intero(Math.round(v / 1000))} mila` : euroK(v)),
    labelW: 130,
    describe: `Salario medio annuo lordo per dipendente a tempo pieno nel ${euroAnno}, in euro`,
    tooltip: (r, t) => {
      ttTitle(t, r.label, `${euroAnno}, euro correnti`);
      ttRow(t, r.evidenza ? COL.salari : COL.grigio, "Salario medio annuo", euroK(r.value));
    },
  });
  const itaE = livelli.find((r) => r.key === "ITA"), ueE = livelli.find((r) => r.key === "EU27_2020");
  document.getElementById("livelli-title").textContent = `Nel ${euroAnno}: ${euroK(itaE.value)} in Italia, ${euroK(ueE.value)} nella media UE`;
  document.getElementById("livelli-sub").textContent =
    "Salario medio annuo lordo per dipendente, riportato a tempo pieno, in euro correnti (Eurostat). Non tiene conto del diverso costo della vita tra paesi: per quello c'è il confronto OCSE a parità di potere d'acquisto.";

  // ---------- quanto si guadagna all'ora (RACLI) ----------
  let sesso = "totale";
  const annoRacli = d3.max(orari.totale, (r) => r.a);
  const provFeat = feature(topo, topo.objects[Object.keys(topo.objects)[0]]).features;
  const sigla = (f) => f.properties.prov_acr;
  function renderOrari() {
    const tot = orari.totale.find((r) => r.a === annoRacli && r.s === sesso);
    const u = orari.totale.find((r) => r.a === annoRacli && r.s === "uomini");
    const d = orari.totale.find((r) => r.a === annoRacli && r.s === "donne");
    const st = document.getElementById("orari-stats");
    st.replaceChildren();
    stat(st, "Mediana", euro2(tot.me), "all'ora", "metà dei dipendenti guadagna meno");
    stat(st, "10% meno pagato", `sotto ${euro2(tot.d1)}`, "", "1° decile");
    stat(st, "10% più pagato", `sopra ${euro2(tot.d9)}`, "", "9° decile");
    stat(st, "Media", euro2(tot.mm), "", "tirata su dalle paghe più alte");
    stat(st, "Donne rispetto agli uomini", pct(d.me / u.me - 1), "sulla mediana", `${pct(d.mm / u.mm - 1)} sulla media`);

    const righe = orari.settori.filter((r) => r.s === sesso);
    const rows = [
      { key: "0010", label: "Totale", d1: tot.d1, me: tot.me, mm: tot.mm, d9: tot.d9, evidenza: true },
      ...righe.map((r) => ({ key: r.c, label: r.n ?? r.c, d1: r.d1, me: r.me, mm: r.mm, d9: r.d9 })).sort((a, b) => b.me - a.me),
    ];
    const settEl = document.getElementById("orari-settori");
    settEl.replaceChildren();
    rangeDots(settEl, {
      rows,
      color: COL.salari,
      describe: `Paga oraria lorda per settore nel ${annoRacli}: 1° decile, mediana, media e 9° decile`,
      tooltip: (r, t) => {
        ttTitle(t, r.label, `${annoRacli} · ${sesso === "totale" ? "tutti i dipendenti" : sesso}`);
        ttRow(t, null, "10% meno pagato, sotto", euro2(r.d1));
        ttRow(t, COL.salari, "Mediana", euro2(r.me));
        ttRow(t, COL_TESTO, "Media", euro2(r.mm));
        ttRow(t, null, "10% più pagato, sopra", euro2(r.d9));
      },
    });
    settEl.parentElement.querySelector("details.table-view")?.remove();
    tableView(settEl.parentElement, [
      { key: "label", label: "Settore" },
      { key: "d1", label: "1° decile", num: true, format: euro2 },
      { key: "me", label: "Mediana", num: true, format: euro2 },
      { key: "mm", label: "Media", num: true, format: euro2 },
      { key: "d9", label: "9° decile", num: true, format: euro2 },
    ], () => rows);

    const prov = new Map(orari.province.filter((r) => r.s === sesso).map((r) => [r.sigla, r]));
    const mapEl = document.getElementById("orari-mappa");
    mapEl.replaceChildren();
    choropleth(mapEl, {
      features: provFeat,
      value: (f) => prov.get(sigla(f))?.me ?? null,
      ramp: RAMPA,
      legendEl: document.getElementById("orari-mappa-legend"),
      legendFormat: euro2,
      describe: `Paga oraria lorda mediana per provincia nel ${annoRacli}`,
      tooltip: (f, t) => {
        const r = prov.get(sigla(f));
        ttTitle(t, f.properties.prov_name, f.properties.reg_name);
        if (!r) return ttRow(t, null, "Dato non disponibile", "");
        ttRow(t, COL.salari, "Mediana", euro2(r.me));
        ttRow(t, COL_TESTO, "Media", euro2(r.mm));
        ttRow(t, null, "1° e 9° decile", `${euro2(r.d1)} – ${euro2(r.d9)}`);
      },
    });
    const ordinate = [...prov.values()].sort((a, b) => b.me - a.me);
    document.getElementById("mappa-title").textContent =
      `Per provincia: paga oraria mediana, da ${euro2(ordinate.at(-1).me)} (${ordinate.at(-1).n}) a ${euro2(ordinate[0].me)} (${ordinate[0].n})`;
    mapEl.parentElement.querySelector("details.table-view")?.remove();
    tableView(mapEl.parentElement, [
      { key: "n", label: "Provincia" },
      { key: "me", label: "Mediana", num: true, format: euro2 },
      { key: "mm", label: "Media", num: true, format: euro2 },
      { key: "d1", label: "1° decile", num: true, format: euro2 },
      { key: "d9", label: "9° decile", num: true, format: euro2 },
    ], () => ordinate);
  }
  legenda("orari-legend", [[COL.salari, "Dal 10% meno pagato al 10% più pagato · il punto è la mediana"], [COL_TESTO, "Media (tacca)"]]);
  document.getElementById("orari-title").textContent = `Quanto si guadagna all'ora nel settore privato (${annoRacli})`;
  document.getElementById("orari-sub").textContent =
    `Retribuzione lorda per ora retribuita dei dipendenti del settore privato (ISTAT, registro RACLI), ${annoRacli}: è l'ultimo anno disponibile, i dati escono con circa due anni di ritardo. ` +
    "Il 10% meno pagato e il 10% più pagato sono il 1° e il 9° decile.";
  document.querySelectorAll("#orari-sesso button").forEach((b) => b.addEventListener("click", () => {
    sesso = b.dataset.s;
    document.querySelectorAll("#orari-sesso button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderOrari();
  }));

  // ---------- deflatore: ridisegna tutto ciò che dipende dai prezzi ----------
  function renderTutto() {
    aggiornaKpi();
    renderForbice();
    renderSettori();
    renderReale();
  }
  document.querySelectorAll("#deflatore button").forEach((b) => b.addEventListener("click", () => {
    defl = b.dataset.d;
    document.querySelectorAll("#deflatore button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderTutto();
  }));
  legenda("forbice-legend", [[COL.salari, "Retribuzioni contrattuali orarie"], [COL.prezzi, "Prezzi al consumo"]]);

  renderTutto();
  renderOrari();
  reveal();
}

main().catch((err) => console.error(err));
