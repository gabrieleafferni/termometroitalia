import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "../css/style.css";

import * as d3 from "d3";
import { feature } from "topojson-client";
import { load, loadGeo, fromColumns, novitaInEvidenza } from "./lib/data.js";
import { fmt, parseDay, NOMI_RIF, UNITA } from "./lib/format.js";
import { chrome, el, reveal, deltaSpan, countUp } from "./lib/ui.js";
import { glowMap } from "./charts/map.js";
import { sparkline } from "./charts/small.js";

const COLORE = { benzina: "#c98500", gasolio: "#8f6ff0", gpl: "#3ecf8e", metano: "#4c9df5" };

async function main() {
  const [meta, naz, imp, novita, topo, salari] = await Promise.all([
    load("meta.json"),
    load("carburanti_nazionale.json"),
    load("carburanti_impianti.json"),
    load("novita.json"),
    loadGeo("regioni.topo.json"),
    load("salari.json").catch(() => null), // sezione facoltativa
  ]);
  chrome("home", meta);

  const rif = naz.filter((r) => r.rif);
  rif.forEach((r) => (r.date = parseDay(r.d)));
  const byFuel = d3.group(rif, (r) => r.c);
  const last = (c) => byFuel.get(c).at(-1);
  const ago = (c, n) => {
    const s = byFuel.get(c);
    const target = d3.timeDay.offset(s.at(-1).date, -n);
    return [...s].reverse().find((r) => r.date <= target);
  };

  // ---------- mappa ambient ----------
  const stations = fromColumns(imp);
  const regions = feature(topo, topo.objects[Object.keys(topo.objects)[0]]);
  glowMap(document.getElementById("hero-map"), {
    stations,
    regions,
    value: (s) => s.b,
    reference: last("benzina").media,
    interactive: false,
    ambient: true,
    labels: false,
    ariaLabel: `Mappa di ${stations.length} distributori italiani colorati per prezzo della benzina rispetto alla media`,
  });
  const cap = document.getElementById("hero-caption");
  cap.append(
    el("b", null, `${fmt.intero(stations.length)} distributori`),
    document.createElement("br"),
    document.createTextNode("azzurro: benzina sotto la media · rosa: sopra")
  );

  // ---------- ticker ----------
  const ticker = document.getElementById("ticker");
  for (const c of ["benzina", "gasolio"]) {
    const it = el("div", "item");
    const v = el("div", "v", fmt.prezzo(last(c).media));
    const l = el("div", "l");
    const key = el("span");
    key.style.cssText = `width:12px;height:3px;border-radius:2px;background:${COLORE[c]}`;
    l.append(key, document.createTextNode(`${NOMI_RIF[c]} · ${UNITA[c]}`));
    const m = ago(c, 30);
    it.append(v, l);
    if (m) it.append(deltaSpan(last(c).media - m.media, " in 30 giorni"));
    ticker.append(it);
    countUp(v, last(c).media, fmt.prezzo);
  }
  const pieno = el("div", "item");
  const pv = el("div", "v", fmt.euro(last("benzina").media * 50));
  pieno.append(pv, el("div", "l", "Un pieno da 50 litri di benzina"));
  ticker.append(pieno);

  // ---------- novità ----------
  document.getElementById("novita-data").textContent = `Aggiornato al ${fmt.giornoAnno(parseDay(novita.aggiornato_al)).trim()}`;
  const nov = document.getElementById("novita");
  for (const n of novitaInEvidenza(novita.novita, 6)) {
    const card = el("article", "panel reveal");
    const t = el("div", "panel-title", n.titolo);
    const p = el("p", null, n.testo);
    p.style.cssText = "margin:10px 0 0;font-size:17px;line-height:1.45;color:var(--text)";
    card.append(t, p);
    const salari = n.tema === "salari";
    const a = el("a", null, salari ? "Vai ai salari →" : "Vai ai carburanti →");
    a.href = salari ? "salari.html" : "carburanti.html";
    a.style.cssText = "display:inline-block;margin-top:12px;font-size:13px";
    card.append(a);
    nov.append(card);
  }

  // ---------- temi ----------
  const temi = document.getElementById("temi");
  const live = el("a", "panel theme-card is-live reveal");
  live.href = "carburanti.html";
  live.append(el("span", "num", "01"), el("h3", null, "Carburanti"),
    el("p", null, "Prezzi di benzina, gasolio, GPL e metano in oltre 20.000 distributori."));
  const val = el("div", "val", `${fmt.prezzo(last("benzina").media)} €/l`);
  const sp = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  sp.classList.add("spark");
  sp.style.cssText = "width:100%;height:40px";
  sparkline(sp, byFuel.get("benzina").map((r) => r.media), COLORE.benzina);
  live.append(val, sp, el("span", "status", "Attivo · aggiornamento quotidiano"));
  temi.append(live);
  // salari: tema attivo, con il salario reale rispetto al 2021 e la sua linea
  if (salari) {
    const sal = el("a", "panel theme-card is-live reveal");
    sal.href = "salari.html";
    sal.append(el("span", "num", "02"), el("h3", null, "Salari reali"),
      el("p", null, "Retribuzioni contro inflazione, settore per settore; contratti scaduti; confronto con gli altri paesi."));
    // salari reali: media degli ultimi 12 mesi contro la media del 2021 (NIC), come nella pagina
    const w = salari.serie["0010|totale"], p = salari.nic;
    const i21 = salari.mesi.indexOf("2021-01-01");
    const media = (a, i0, i1) => d3.mean(d3.range(i0, i1 + 1), (i) => a[i]);
    const w21 = media(w, i21, i21 + 11), p21 = media(p, i21, i21 + 11);
    const reali = d3.range(i21 + 11, w.length).map((i) => (media(w, i - 11, i) / w21) / (media(p, i - 11, i) / p21) - 1);
    const ultimoReale = reali.at(-1);
    const testo = (ultimoReale < 0 ? "−" : "+") + Math.abs(ultimoReale * 100).toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
    const v = el("div", "val", testo);
    v.title = "Retribuzioni contrattuali al netto dell'inflazione NIC: media degli ultimi 12 mesi contro la media 2021";
    const sps = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    sps.classList.add("spark");
    sps.style.cssText = "width:100%;height:40px";
    sparkline(sps, reali, "#3987e5");
    const nota = el("div", null, "salari reali, ultimi 12 mesi contro il 2021");
    nota.style.cssText = "font-size:12.5px;color:var(--text-2);margin-top:-6px";
    sal.append(v, nota, sps, el("span", "status", "Attivo · dati ISTAT, OCSE ed Eurostat"));
    temi.append(sal);
  }
  const prossimi = [
    ...(salari ? [] : [["02", "Salari reali", "Retribuzioni contrattuali contro inflazione: il potere d'acquisto, mese per mese (ISTAT)."]]),
    ["03", "Immigrazione", "Sbarchi, nazionalità e accoglienza dal cruscotto giornaliero del Viminale."],
    ["04", "Verso le elezioni", "Sondaggi depositati, attività del Parlamento e voti in aula."],
  ];
  for (const [n, h, p] of prossimi) {
    const c = el("article", "panel theme-card is-soon reveal");
    c.append(el("span", "num", n), el("h3", null, h), el("p", null, p), el("span", "status", "In costruzione"));
    temi.append(c);
  }

  reveal();
}

main().catch((err) => console.error(err));
