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
import { chrome, el, tooltip, ttTitle, ttRow, tableView, countUp, reveal, deltaSpan } from "./lib/ui.js";
import { glowMap, colorScale, DIVERGING } from "./charts/map.js";
import { trendChart } from "./charts/trend.js";
import { sparkline, divergingBars, taxArea } from "./charts/small.js";
import { histogramByDay } from "./charts/histday.js";

const COLORE = { benzina: "#c98500", gasolio: "#8f6ff0", gpl: "#3ecf8e", metano: "#4c9df5" };
// grafico dei marchi: tutti i marchi con lo stesso peso (linee grigie sottili),
// in evidenza solo la media della rete. Il racconto è l'andamento generale, non un marchio.
const COL_MARCHIO = "#56607a";
// petrolio Brent nel pannello "dal barile alla pompa": validato contro benzina e gasolio sul pannello scuro
const COL_BRENT = "#199fb5";
const NOME_MARCHIO = { "Agip Eni": "Eni", "Api-Ip": "IP" };
const FONTE_IP = "https://www.ansa.it/sito/notizie/economia/2026/09/28/parte-da-circa-300-distributori-limite-prezzi-ip-tetto-uguale-ad-eni_954645af-a337-4eab-ba58-a19e874b8bdc.html";
const CAMPO = { benzina: "b", gasolio: "g" };
const RANGE = 0.06; // ±6 cent: saturazione della scala colori della mappa

// Eventi di contesto annotati sul grafico storico (solo fatti verificati, con fonte)
const EVENTI = [
  { d: "2026-07-29", label: "Taglio delle accise sul gasolio", detail: "(ANSA, 28 luglio 2026)" },
  { d: "2026-09-28", label: "Prezzo massimo Eni", detail: "(comunicato Eni)" },
];

const titleCase = (s) =>
  s.toLowerCase().replace(/(^|[\s'’\-(/])([a-zà-ÿ])/g, (m, p, c) => p + c.toUpperCase()).replace(/\b(Di|De|Del|Della|Dei|Delle|Degli|In|Sul|Sulla|Nel|Nell|Al|Alla|E)\b/g, (w) => w.toLowerCase());
// indirizzi MIMIT (spesso tutti in maiuscolo): sigle di provincia e di strada restano maiuscole
const titleAddr = (s) =>
  titleCase(s).replace(/\((\w{2})\)/g, (m, p) => `(${p.toUpperCase()})`).replace(/\b(Ss|Sp|Sr|Sc|Sn|Snc|Sgc)(?=\d|\b)/g, (w) => w.toUpperCase());
const nomeImpianto = (s) => (s.nome ? titleCase(s.nome) : `Impianto ${s.id}`);
// ora della comunicazione: il MIMIT la scrive in ora italiana, l'export la conserva "come UTC"
const fmtComunicazione = new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
const indicazioni = (s) => `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}`;

async function main() {
  const [meta, naz, reg, prov, tipo, bandiere, imp, novita, topo, marchi, storico, misure, distrib, barile] = await Promise.all([
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
    load("carburanti_distribuzione.json"),
    load("carburanti_barile.json").catch(() => null), // pannello facoltativo
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
    el("span", null, `aggiornamento automatico ogni mattina · ${fmt.intero(stations.length)} distributori · storico giornaliero dal ${fmt.giorno(byFuel.get("benzina")[0].date).trim()}, settimanale dal 2005`)
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
        ttTitle(t, nomeImpianto(s), `${s.bandiera ?? ""}${s.auto ? " · autostrada" : ""} · ${s.ind ? titleAddr(s.ind) + ", " : ""}${titleCase(s.comune ?? "")} (${s.sigla ?? ""})`);
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
        t.append(el("div", "tt-note", "Clic per indirizzo e indicazioni stradali"));
      }, x, y);
    },
    onSelect(s) {
      tip.hide();
      showStation(s, { scroll: true });
    },
  });

  // ---------- scheda del distributore selezionato ----------
  const cardEl = document.getElementById("station-card");
  function showStation(s, { scroll = false } = {}) {
    cardEl.replaceChildren();
    cardEl.hidden = !s;
    if (!s) return;
    const head = el("div", "sc-head");
    const who = el("div");
    who.append(
      el("div", "sc-kicker", "Distributore selezionato"),
      el("div", "sc-name", nomeImpianto(s)),
      el("div", "sc-brand", `${s.bandiera ?? ""}${s.auto ? " · autostrada" : ""}`),
    );
    const close = el("button", "sc-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Chiudi la scheda del distributore");
    close.addEventListener("click", () => {
      showStation(null);
      map.select(-1);
    });
    head.append(who, close);
    const addr = el("p", "sc-addr");
    if (s.ind) addr.append(el("span", "sc-street", titleAddr(s.ind)));
    addr.append(el("span", null, `${titleCase(s.comune ?? "")} (${s.sigla ?? ""})`));
    const prices = el("div", "sc-prices");
    for (const c of ["benzina", "gasolio"]) {
      const v = s[CAMPO[c]];
      const box = el("div", "sc-price");
      const l = el("div", "l");
      const key = el("span", "key");
      key.style.background = COLORE[c];
      l.append(key, document.createTextNode(NOMI_RIF[c]));
      const val = el("div", "v");
      if (v != null) {
        val.append(document.createTextNode(fmt.prezzo(v)), el("small", null, "€/l"));
        box.append(l, val, deltaSpan(v - ultimo(c).media, " vs media"));
      } else {
        val.append(el("small", null, "non comunicato"));
        box.append(l, val);
      }
      prices.append(box);
    }
    cardEl.append(head, addr, prices);
    if (s.ts) {
      // i gestori devono comunicare ogni variazione: una comunicazione vecchia di
      // qualche giorno di solito vuol dire che il prezzo non è cambiato
      cardEl.append(el("p", "sc-time", `Ultima comunicazione del gestore: ${fmtComunicazione.format(new Date(s.ts * 60000))}`));
    }
    const actions = el("div", "sc-actions");
    const go = Object.assign(el("a", "btn btn-go", "Indicazioni stradali ↗"), { href: indicazioni(s), target: "_blank", rel: "noopener" });
    actions.append(go);
    cardEl.append(actions);
    if (scroll) {
      const r = cardEl.getBoundingClientRect();
      if (r.top < 60 || r.bottom > window.innerHeight) cardEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

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

  // ---------- trova il distributore: per comune o vicino a me ----------
  const byComune = d3.group(stations, (s) => `${titleCase(s.comune ?? "")} (${s.sigla})`);
  const dl = document.getElementById("comuni");
  for (const k of [...byComune.keys()].sort((a, b) => a.localeCompare(b, "it"))) {
    const o = document.createElement("option");
    o.value = k;
    dl.append(o);
  }
  const input = document.getElementById("comune");
  const raggiEl = document.getElementById("finder-raggi");
  const notaEl = document.getElementById("finder-nota");
  const RAGGI = [2, 5, 10, 20]; // km
  let comuneScelto = null;
  let posizione = null; // { lat, lon }: resta nel browser, non viene inviata né salvata
  let raggio = 5;

  // distanza in linea d'aria (formula dell'emisenoverso), in km
  const distanzaKm = (a, b) => {
    const r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
  };
  const fmtKm = (d) => (d < 1 ? `${fmt.intero(Math.round(d * 1000 / 50) * 50)} m` : `${d.toLocaleString("it-IT", { maximumFractionDigits: 1 })} km`);

  function voce(s, km) {
    const li = el("li");
    const left = el("div");
    left.append(el("span", "n", nomeImpianto(s)), el("span", "b", `${s.bandiera ?? ""}${s.auto ? " · autostrada" : ""}`));
    if (s.ind) left.append(el("span", "a", titleAddr(s.ind)));
    const right = el("div");
    right.append(el("span", "p", `${fmt.prezzo(s[CAMPO[fuel]])} €`));
    if (km != null) right.append(el("span", "d", fmtKm(km)));
    li.append(left, right);
    li.tabIndex = 0;
    const go = () => {
      const i = map.indexOf(s);
      map.highlight([i]);
      map.select(i);
      map.focus([i]);
      showStation(s);
    };
    li.addEventListener("click", go);
    li.addEventListener("keydown", (e) => e.key === "Enter" && go());
    return li;
  }

  function renderFinder() {
    const list = document.getElementById("finder-list");
    list.replaceChildren();
    raggiEl.hidden = true;
    notaEl.hidden = true;
    if (posizione && !comuneScelto) return renderVicino(list);
    if (!comuneScelto) return;
    const items = byComune.get(comuneScelto).filter((s) => s[CAMPO[fuel]] != null)
      .sort((a, b) => a[CAMPO[fuel]] - b[CAMPO[fuel]]);
    document.getElementById("finder-title").textContent = `${comuneScelto}`;
    const media = d3.mean(items, (s) => s[CAMPO[fuel]]);
    document.getElementById("finder-sub").textContent = items.length
      ? `${items.length} distributori con ${fuel} self · media del comune ${fmt.prezzo(media)} €/l (${fmt.cent(media - refOggi())} cent rispetto all'Italia)`
      : `Nessun prezzo ${fuel} self comunicato oggi in questo comune.`;
    for (const s of items.slice(0, 6)) list.append(voce(s));
  }

  function renderVicino(list, { muoviMappa = false } = {}) {
    const vicini = stations
      .filter((s) => s[CAMPO[fuel]] != null)
      .map((s) => ({ s, km: distanzaKm(posizione, s) }))
      .filter((v) => v.km <= RAGGI.at(-1));
    const entro = (r) => vicini.filter((v) => v.km <= r);
    const items = entro(raggio).sort((a, b) => a.s[CAMPO[fuel]] - b.s[CAMPO[fuel]] || a.km - b.km);
    document.getElementById("finder-title").textContent = "Vicino a te";
    const sub = document.getElementById("finder-sub");
    if (!vicini.length) {
      sub.textContent = `Nessun distributore con ${fuel} self nel raggio di ${RAGGI.at(-1)} km: la mappa copre solo l'Italia.`;
      return;
    }
    const media = d3.mean(items, (v) => v.s[CAMPO[fuel]]);
    sub.textContent = items.length
      ? `${items.length} distributori con ${fuel} self entro ${raggio} km in linea d'aria · media ${fmt.prezzo(media)} €/l (${fmt.cent(media - refOggi())} cent rispetto all'Italia). Ecco i più economici.`
      : `Nessun distributore con ${fuel} self entro ${raggio} km: prova un raggio più ampio.`;
    raggiEl.replaceChildren();
    for (const r of RAGGI) {
      const b = el("button", "chip", `${r} km · ${fmt.intero(entro(r).length)}`);
      b.type = "button";
      b.setAttribute("aria-pressed", String(r === raggio));
      b.addEventListener("click", () => {
        raggio = r;
        renderVicino(document.getElementById("finder-list"), { muoviMappa: true });
      });
      raggiEl.append(b);
    }
    raggiEl.hidden = false;
    list.replaceChildren();
    for (const v of items.slice(0, 8)) list.append(voce(v.s, v.km));
    notaEl.textContent = `Prezzi alle 8:00 del ${fmt.giornoAnno(oggi).trim()}, comunicati dai gestori al Ministero: alla pompa potrebbero essere cambiati. La tua posizione resta sul tuo dispositivo: il sito non la riceve e non la salva.`;
    notaEl.hidden = false;
    const idx = items.map((v) => map.indexOf(v.s));
    map.highlight(idx);
    if (muoviMappa) map.focus(idx, { conUtente: true });
  }

  input.addEventListener("change", () => {
    const k = input.value.trim();
    // se il comune è già quello scelto non ridisegno la lista: altrimenti il "change"
    // che parte quando la casella perde il fuoco sostituirebbe l'elemento appena cliccato
    if (!byComune.has(k) || k === comuneScelto) return;
    comuneScelto = k;
    const idx = byComune.get(k).map((s) => map.indexOf(s));
    map.highlight(idx);
    map.focus(idx);
    renderFinder();
    document.getElementById("finder").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  // posizione del dispositivo (Geolocation API): la chiede il browser, con il consenso di chi visita
  const locBtn = document.getElementById("locate");
  const locLabel = locBtn.querySelector("span");
  locBtn.addEventListener("click", () => {
    const sub = document.getElementById("finder-sub");
    const errore = (msg) => {
      document.getElementById("finder-title").textContent = "Posizione non disponibile";
      sub.textContent = msg;
      document.getElementById("finder").scrollIntoView({ behavior: "smooth", block: "nearest" });
    };
    if (!("geolocation" in navigator)) return errore("Questo browser non permette di rilevare la posizione. Puoi cercare il tuo comune nella barra qui sopra.");
    locBtn.setAttribute("aria-busy", "true");
    locLabel.textContent = "Cerco la tua posizione…";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        locBtn.removeAttribute("aria-busy");
        locLabel.textContent = "Vicino a me";
        posizione = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        comuneScelto = null;
        input.value = "";
        map.setUser(posizione.lon, posizione.lat);
        // raggio iniziale: il più piccolo con almeno 5 distributori
        const conPrezzo = stations.filter((s) => s[CAMPO[fuel]] != null);
        raggio = RAGGI.find((r) => conPrezzo.filter((s) => distanzaKm(posizione, s) <= r).length >= 5) ?? RAGGI.at(-1);
        renderVicino(document.getElementById("finder-list"), { muoviMappa: true });
        document.getElementById("map").scrollIntoView({ behavior: "smooth", block: "start" });
      },
      (err) => {
        locBtn.removeAttribute("aria-busy");
        locLabel.textContent = "Vicino a me";
        errore(err.code === err.PERMISSION_DENIED
          ? "Hai negato l'accesso alla posizione. Puoi riattivarlo dalle impostazioni del browser per questo sito, oppure cercare il tuo comune nella barra qui sopra."
          : "Non è stato possibile rilevare la posizione in questo momento. Riprova, oppure cerca il tuo comune nella barra qui sopra.");
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 5 * 60 * 1000 }
    );
  });

  // ---------- novità ----------
  const feed = document.getElementById("feed");
  for (const n of novitaInEvidenza(novita.novita, 6)) {
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
    shortName: NOMI_RIF[c].split(" ")[0],
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

  // ---------- vent'anni di prezzi (serie settimanale MASE), nominali o reali ----------
  const sto = fromColumns(storico).map((r) => ({ ...r, date: parseDay(r.d) }));
  const stoBy = d3.group(sto, (r) => r.c);
  const storicoEl = document.getElementById("storico");
  const reali = meta.prezzi_reali; // { mese_riferimento, provvisorio }: mese degli euro "di oggi"
  const meseRif = reali ? parseDay(reali.mese_riferimento) : null;
  const meseAnno = (d) => fmt.giornoAnno(d).trim().split(" ").slice(1).join(" "); // "settembre 2026"
  const slg = document.getElementById("storico-legend");
  for (const c of ["benzina", "gasolio"]) {
    const sp = el("span");
    const k = el("span", "key-line");
    k.style.background = COLORE[c];
    sp.append(k, document.createTextNode(NOMI_RIF[c].split(" ")[0]));
    slg.append(sp);
  }
  // l'ultimo valore è un record? altrimenti, da quando non si vedeva un livello così alto
  const contesto = (c, campo) => {
    const s = stoBy.get(c), u = s.at(-1);
    const sopra = s.slice(0, -1).filter((r) => r[campo] >= u[campo]);
    return sopra.length ? { record: false, da: sopra.at(-1) } : { record: true };
  };
  const picco = (c, campo) => d3.greatest(stoBy.get(c).slice(0, -1), (r) => r[campo]);
  const modoBtns = document.querySelectorAll("#storico-modo button");
  if (!reali) document.getElementById("storico-modo").hidden = true;

  function renderStorico(modo) {
    const campo = modo === "reale" ? "r" : "p";
    modoBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.modo === modo)));
    storicoEl.replaceChildren();
    trendChart(storicoEl, {
      series: ["benzina", "gasolio"].map((c) => ({
        key: c,
        name: NOMI_RIF[c].split(" ")[0],
        color: COLORE[c],
        points: stoBy.get(c).map((r) => ({ date: r.date, v: r[campo] })),
      })),
      height: 360,
      xTicks: "anni",
      markMax: true,
      events: [{ date: new Date(2022, 1, 24), label: "Invasione russa dell'Ucraina" }],
      tooltipTitle: (d) => `Settimana del ${fmt.giornoAnno(d).trim()}`,
      tooltipNote: modo === "reale" ? `Euro di ${meseAnno(meseRif)} (indice NIC ISTAT)` : null,
      ariaLabel: `Prezzi settimanali di benzina e gasolio dal 2005, ${modo === "reale" ? `al netto dell'inflazione, in euro di ${meseAnno(meseRif)}` : "in euro correnti"}`,
    });
    const sub = document.getElementById("storico-sub");
    const titolo = document.getElementById("storico-title");
    if (modo === "reale") {
      const pg = picco("gasolio", "r"), pb = picco("benzina", "r");
      const cg = contesto("gasolio", "r"), cb = contesto("benzina", "r");
      titolo.textContent = cg.record || cb.record
        ? `Al netto dell'inflazione: ${cg.record ? "gasolio al record dal 2005" : `gasolio sotto il picco di ${meseAnno(pg.date)}`}, ${cb.record ? "benzina al record dal 2005" : `benzina sotto il picco di ${meseAnno(pb.date)}`}`
        : `Al netto dell'inflazione, benzina e gasolio restano sotto i picchi del ${pg.date.getFullYear() === pb.date.getFullYear() ? pg.date.getFullYear() : `${pb.date.getFullYear()} e del ${pg.date.getFullYear()}`}`;
      sub.textContent = `Gli stessi prezzi MASE riportati in euro di ${meseAnno(meseRif)} con l'indice dei prezzi al consumo NIC dell'ISTAT${reali.provvisorio ? " (dato provvisorio)" : ""}: ` +
        `il picco della benzina (${meseAnno(pb.date)}) varrebbe oggi ${fmt.prezzo(pb.r)} €/l, quello del gasolio ${fmt.prezzo(pg.r)} €/l.`;
    } else {
      const cg = contesto("gasolio", "p"), cb = contesto("benzina", "p");
      titolo.textContent =
        `${cg.record ? "Gasolio al record dal 2005" : `Gasolio ai massimi da ${meseAnno(cg.da.date)}`}, ` +
        `${cb.record ? "benzina al record dal 2005" : `benzina ai massimi da ${meseAnno(cb.da.date)}`}`;
      sub.textContent = "Prezzo medio nazionale settimanale pubblicato dal Ministero dell'Ambiente (MASE). Valori nominali, cioè in euro dell'epoca: per confrontarli tra anni diversi passa a \"Al netto dell'inflazione\".";
    }
    storicoEl.parentElement.querySelector("details.table-view")?.remove();
    tableView(storicoEl.parentElement, [
      { key: "d", label: "Settimana" },
      { key: "b", label: "Benzina (€/l)", num: true, format: fmt.prezzo },
      { key: "g", label: "Gasolio (€/l)", num: true, format: fmt.prezzo },
      ...(reali ? [
        { key: "br", label: `Benzina, euro di ${meseAnno(meseRif)}`, num: true, format: fmt.prezzo },
        { key: "gr", label: `Gasolio, euro di ${meseAnno(meseRif)}`, num: true, format: fmt.prezzo },
      ] : []),
    ], () => {
      const by = d3.rollup(sto, (v) => Object.fromEntries(v.flatMap((r) => [[r.c, r.p], [r.c + "_r", r.r]])), (r) => r.d);
      return [...by].reverse().map(([d, o]) => ({ d, b: o.benzina, g: o.gasolio, br: o.benzina_r, gr: o.gasolio_r }));
    });
  }
  modoBtns.forEach((b) => b.addEventListener("click", () => renderStorico(b.dataset.modo)));
  renderStorico("nominale");

  // ---------- dal barile alla pompa: prezzo industriale contro Brent in euro al litro ----------
  const barileEl = document.getElementById("barile-chart");
  const bar = barile ? fromColumns(barile.settimane).map((r) => ({ ...r, date: parseDay(r.d) })) : [];
  const barBy = d3.group(bar, (r) => r.c);
  const barileBtns = document.querySelectorAll("#barile-modo button");
  let modoBarile = "nominale";
  barileBtns.forEach((b) => b.addEventListener("click", () => {
    modoBarile = b.dataset.modo;
    renderBarile();
  }));
  if (!reali) document.getElementById("barile-modo").hidden = true;

  function renderBarile() {
    const sezione = document.getElementById("barile");
    const s = barBy.get(fuel);
    sezione.hidden = !s?.length;
    if (!s?.length) return;
    const reale = modoBarile === "reale" && reali;
    barileBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.modo === modoBarile)));
    const netto = (r) => (reale ? r.nr : r.n);
    const brent = (r) => (reale ? r.br : r.b);
    const perData = new Map(s.map((r) => [+r.date, r]));
    const euroDi = reale ? ` in euro di ${meseAnno(meseRif)}` : "";

    barileEl.replaceChildren();
    trendChart(barileEl, {
      series: [
        // la fascia tra le due linee è la differenza (lavaggio del colore del carburante)
        { key: "netto", name: "Prezzo industriale", shortName: "Industriale", color: COLORE[fuel], points: s.map((r) => ({ date: r.date, v: netto(r), lo: brent(r), hi: netto(r) })) },
        { key: "brent", name: "Brent", color: COL_BRENT, points: s.map((r) => ({ date: r.date, v: brent(r) })) },
      ],
      height: 360,
      xTicks: "anni",
      events: [{ date: new Date(2022, 1, 24), label: "Invasione russa dell'Ucraina" }],
      tooltipTitle: (d) => `Settimana del ${fmt.giornoAnno(d).trim()}`,
      tooltipNote: (d) => {
        const r = perData.get(+d);
        return r ? `Differenza: ${fmt.prezzo(netto(r) - brent(r))} €/l${euroDi} · Brent ${fmt.intero(Math.round(r.bu))} $ al barile` : null;
      },
      ariaLabel: `Prezzo industriale del ${fuel} e petrolio Brent in euro al litro, settimana per settimana dal 2005${euroDi}`,
    });

    // numeri dell'ultima settimana e confronto con la media degli anni precedenti (in euro di oggi)
    const u = s.at(-1);
    const anno = u.date.getFullYear();
    const storia = s.filter((r) => r.date.getFullYear() < anno);
    const media = d3.mean(storia, (r) => r.nr - r.br);
    const periodo = `${s[0].date.getFullYear()}–${anno - 1}`;
    const diff = u.nr - u.br;
    const rapporto = diff / media;
    const confronto = rapporto >= 1.9 && rapporto < 2.15 ? "il doppio della media"
      : rapporto >= 1.25 ? `${rapporto.toLocaleString("it-IT", { maximumFractionDigits: 1 })} volte la media`
      : rapporto > 0.85 ? "in linea con la media" : "sotto la media";
    const nome = fuel === "benzina" ? "Benzina" : "Gasolio";
    document.getElementById("barile-title").textContent =
      `${nome}: tra prezzo industriale e greggio ${fmt.intero(Math.round(diff * 100))} centesimi al litro, ${confronto} ${periodo}`;
    document.getElementById("barile-sub").textContent =
      `Prezzo industriale (MASE, senza accise e IVA) e petrolio Brent convertito in euro al litro, media della settimana prima di ogni rilevazione. ` +
      (reale ? `Valori in euro di ${meseAnno(meseRif)}, con l'indice NIC dell'ISTAT.` : "Valori in euro correnti.") +
      ` La fascia colorata è la differenza tra i due.`;

    const stats = document.getElementById("barile-stats");
    stats.replaceChildren();
    const stat = (l, v, small, extra) => {
      const d = el("div", "hist-stat");
      const vv = el("div", "v", v);
      if (small) vv.append(el("small", null, small));
      d.append(el("div", "l", l), vv);
      if (extra) d.append(el("div", "hist-prima", extra));
      stats.append(d);
    };
    stat(`Brent, settimana prima del ${fmt.giorno(u.date).trim()}`, fmt.intero(Math.round(u.bu)), "$ al barile", `${fmt.prezzo(u.b)} € al litro`);
    stat("Prezzo industriale", fmt.prezzo(u.n), "€/l", `${NOMI_RIF[fuel].split(" ")[0]}, senza accise e IVA`);
    stat("Differenza", fmt.prezzo(u.n - u.b), "€/l", `media ${periodo}: ${fmt.prezzo(media)} in euro di oggi`);

    const lg = document.getElementById("barile-legend");
    lg.replaceChildren();
    for (const [cls, c, t] of [["key-line", COLORE[fuel], "Prezzo industriale, senza accise e IVA"], ["key-line", COL_BRENT, "Petrolio Brent in euro al litro"], ["key-band", COLORE[fuel], "Differenza"]]) {
      const sp = el("span");
      const k = el("span", cls);
      k.style.background = c;
      sp.append(k, document.createTextNode(t));
      lg.append(sp);
    }
    const ul = barile.ultimo;
    document.getElementById("barile-note").textContent =
      "La differenza non è un guadagno: comprende la raffinazione, il trasporto, le scorte obbligatorie, la distribuzione e i margini della filiera. " +
      `Ultima quotazione del Brent: ${fmt.intero(Math.round(ul.brent_usd_barile))} $ al barile il ${fmt.giorno(parseDay(ul.data)).trim()} ` +
      `(${fmt.prezzo(ul.brent_eur_litro)} €/l al cambio BCE di ${ul.usd_per_eur.toLocaleString("it-IT", { minimumFractionDigits: 4 })} dollari per euro). Fonti: EIA via FRED, BCE, MASE.`;

    barileEl.parentElement.querySelector("details.table-view")?.remove();
    tableView(barileEl.parentElement, [
      { key: "d", label: "Settimana" },
      { key: "n", label: `Prezzo industriale (€/l${euroDi})`, num: true, format: fmt.prezzo },
      { key: "b", label: `Brent (€/l${euroDi})`, num: true, format: fmt.prezzo },
      { key: "diff", label: "Differenza (€/l)", num: true, format: fmt.prezzo },
      { key: "bu", label: "Brent ($ al barile)", num: true, format: (v) => v.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
    ], () => [...s].reverse().map((r) => ({ d: r.d, n: netto(r), b: brent(r), diff: netto(r) - brent(r), bu: r.bu })));
  }

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

  // ---------- prezzi per marchio, con il tetto Eni come contesto ----------
  marchi.forEach((r) => (r.date = parseDay(r.d)));
  const misura = misure.filter((m) => m.misura_id === "tetto_eni_2026");
  const tetto = Object.fromEntries(misura.map((m) => [m.carburante, +m.prezzo_max]));
  const tDal = parseDay(misura[0].valida_dal);
  const tAl = parseDay(misura[0].valida_al);
  const ultimoMarchi = d3.max(marchi, (r) => r.date);
  const marchiEl = document.getElementById("marchi-chart");
  const centNum = (e) => (e * 100).toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  function renderMarchi() {
    const nome = fuel === "benzina" ? "Benzina" : "Gasolio";
    const inizio = d3.timeDay.offset(ultimoMarchi, -30);
    const righe = marchi.filter((r) => r.c === fuel && r.date >= inizio);
    const perMarchio = d3.group(righe, (r) => r.m);
    // i gruppi (marchi, pompe bianche, altri) coprono tutta la rete stradale:
    // la media pesata sul numero di impianti è la media della rete
    const perGiorno = d3.rollups(righe, (v) => ({
      v: d3.sum(v, (r) => r.media * r.n) / d3.sum(v, (r) => r.n),
      spread: v.length === perMarchio.size ? d3.max(v, (r) => r.media) - d3.min(v, (r) => r.media) : null,
    }), (r) => +r.date).sort((a, b) => a[0] - b[0]);
    // la misura è "di contesto" finché cade nella finestra del grafico
    const tettoNelGrafico = inizio <= tAl && ultimoMarchi >= d3.timeDay.offset(tDal, -7);

    const series = [...perMarchio.keys()].map((m) => ({
      key: m,
      name: NOME_MARCHIO[m] ?? m,
      color: COL_MARCHIO,
      width: 1.25,
      label: false,
      points: perMarchio.get(m).map((r) => ({ date: r.date, v: r.media })),
    }));
    series.push({
      key: "tutti",
      name: "Tutti i marchi",
      color: COLORE[fuel],
      width: 2,
      points: perGiorno.map(([t, o]) => ({ date: new Date(t), v: o.v })),
    });
    marchiEl.replaceChildren();
    trendChart(marchiEl, {
      series,
      height: 320,
      // etichetta corta: il nome della misura è già nella legenda e sulla linea verticale
      refLines: tettoNelGrafico ? [{ value: tetto[fuel], label: `${fmt.prezzo2(tetto[fuel])} €/l` }] : [],
      events: tettoNelGrafico ? [{ date: tDal, label: "Prezzo massimo Eni" }] : [],
      tooltipNote: "Media self dei distributori fuori autostrada",
      ariaLabel: `Prezzo medio del ${fuel} self per marchio negli ultimi 30 giorni`,
    });

    const ml = document.getElementById("marchi-legend");
    ml.replaceChildren();
    const voci = [[COLORE[fuel], "Tutti i marchi (media della rete stradale)"], [COL_MARCHIO, "Singoli marchi: Eni, IP, Q8, Esso, Tamoil, pompe bianche, altri"]];
    if (tettoNelGrafico) voci.push(["var(--text)", "Prezzo massimo applicato da Eni"]);
    for (const [c, t] of voci) {
      const sp = el("span");
      const k = el("span", "key-line");
      k.style.background = c;
      sp.append(k, document.createTextNode(t));
      ml.append(sp);
    }

    // titolo: quanto sono distanti i marchi oggi e all'inizio della finestra
    const p0 = perGiorno.find(([, o]) => o.spread != null), p1 = perGiorno.at(-1);
    document.getElementById("marchi-title").textContent = p0 && p1[1].spread != null && p0 !== p1
      ? `${nome} self: tra il marchio più caro e il più economico ${centNum(p1[1].spread)} cent, erano ${centNum(p0[1].spread)} il ${fmt.giorno(new Date(p0[0])).trim()}`
      : `${nome} self per marchio, ultimi 30 giorni`;

    marchiEl.parentElement.querySelector("details.table-view")?.remove();
    tableView(marchiEl.parentElement, [
      { key: "d", label: "Data" },
      { key: "m", label: "Marchio", format: (m) => NOME_MARCHIO[m] ?? m },
      { key: "media", label: "Media (€/l)", num: true, format: fmt.prezzo },
      { key: "q", label: `≤ ${fmt.prezzo2(tetto[fuel])} €/l`, num: true, format: (q) => fmt.pct(q) },
      { key: "n", label: "Impianti", num: true, format: fmt.intero },
    ], () => [...righe].sort((a, b) => d3.descending(a.d, b.d) || d3.ascending(a.media, b.media)));

    renderContesto(tettoNelGrafico);
  }

  // riquadro di contesto: la misura che in queste settimane pesa sui prezzi, con fonti
  function renderContesto(visibile) {
    const box = document.getElementById("tetto");
    box.hidden = !visibile;
    if (!visibile) return;
    const inVigore = ultimoMarchi >= tDal;
    document.getElementById("tetto-badge").replaceChildren(el("span", `badge ${inVigore ? "on" : "wait"}`,
      inVigore ? `in vigore dal ${fmt.giorno(tDal).trim()} al ${fmt.giorno(tAl).trim()}` : `dal ${fmt.giorno(tDal).trim()} · dati in arrivo`));
    document.getElementById("tetto-note").replaceChildren(
      document.createTextNode(`Dal ${fmt.giorno(tDal).trim()} Eni applica un prezzo massimo self di ${fmt.prezzo2(tetto.benzina)} €/l per la benzina e ${fmt.prezzo2(tetto.gasolio)} €/l per il gasolio, fuori autostrada, nei circa 3.000 impianti gestiti da Enilive (su circa 3.900 a marchio Eni). IP applica gli stessi prezzi su parte dei suoi impianti, con estensione progressiva. Fonti: `),
      Object.assign(el("a", null, "comunicato Eni"), { href: misura[0].fonte, target: "_blank", rel: "noopener" }),
      document.createTextNode(", "),
      Object.assign(el("a", null, "ANSA"), { href: FONTE_IP, target: "_blank", rel: "noopener" }),
      document.createTextNode("."),
    );
    const stats = document.getElementById("tetto-stats");
    stats.replaceChildren();
    if (!inVigore) return;
    stats.append(el("span", "l", `Distributori Eni entro il prezzo massimo, alle 8:00 del ${fmt.giorno(ultimoMarchi).trim()}:`));
    for (const c of ["benzina", "gasolio"]) {
      const r = marchi.find((q) => +q.date === +ultimoMarchi && q.m === "Agip Eni" && q.c === c);
      if (!r) continue;
      const sp = el("span", "s");
      const key = el("span", "key-line");
      key.style.background = COLORE[c];
      sp.append(key, document.createTextNode(`${c} `), el("b", null, `${fmt.intero(Math.round(r.q * 100))}%`));
      // il file MIMIT fotografa le 8:00: chi non ha ancora aggiornato il prezzo conserva quello vecchio
      if (r.qa != null && r.qa > r.q + 0.1) sp.append(document.createTextNode(` (${fmt.intero(Math.round(r.qa * 100))}% tra chi aveva già aggiornato il prezzo)`));
      stats.append(sp);
    }
  }

  // ---------- distribuzione dei prezzi, giorno per giorno ----------
  const histEl = document.getElementById("hist");
  const slider = document.getElementById("hist-day");
  const playBtn = document.getElementById("hist-play");
  const dateOut = document.getElementById("hist-date");
  const nazPer = d3.index(rif, (r) => r.c, (r) => r.d);
  let hist = null, histFuel = null, histDay = null, play = null;
  const CONFRONTO = 7; // il contorno mostra lo stesso grafico di 7 giorni prima

  function renderHist() {
    const D = distrib[fuel];
    const date = D.date.map(parseDay);
    const isoScelto = histDay != null ? distrib[histFuel].date[histDay] : null;
    histFuel = fuel;
    histEl.replaceChildren();
    hist = histogramByDay(histEl, {
      data: D,
      color: COLORE[fuel],
      dateLabel: (i) => fmt.giorno(date[i]).trim(),
      ariaLabel: (i) => `Distribuzione dei prezzi del ${fuel} self tra i distributori il ${fmt.giornoAnno(date[i]).trim()}`,
    });
    slider.max = String(D.date.length - 1);
    const totale = (i) => D.sotto[i] + D.sopra[i] + d3.sum(D.n[i]);
    // giorno di confronto: l'ultimo disponibile ad almeno 7 giorni di distanza (gestisce i buchi)
    const confronto = (i) => {
      const target = d3.timeDay.offset(date[i], -CONFRONTO);
      for (let j = i - 1; j >= 0; j--) if (date[j] <= target) return j;
      return null;
    };

    // tacche sotto il cursore: inizio di ogni mese, più gli eventi che hanno mosso i prezzi
    const ticks = document.getElementById("hist-ticks");
    ticks.replaceChildren();
    const pos = (i) => `calc(9px + (100% - 18px) * ${i / (D.date.length - 1)})`;
    const primoMese = date.findIndex((d) => d.getDate() === 1);
    date.forEach((d, i) => {
      // il primo giorno della serie ha la sua tacca, se non è troppo vicino all'inizio di un mese
      if (!(d.getDate() === 1 || (i === 0 && (primoMese < 0 || primoMese > 7)))) return;
      const s = el("span", null, fmt.giornoBreve(d).trim());
      s.style.left = pos(i);
      ticks.append(s);
    });
    const iTetto = D.date.indexOf(d3.timeFormat("%Y-%m-%d")(tDal));
    if (iTetto >= 0) {
      const s = el("span", "evt", "tetto Eni");
      s.title = "Dal 28 settembre Eni applica un prezzo massimo, seguita da altri distributori";
      s.style.left = pos(iTetto);
      ticks.append(s);
    }

    // scorciatoie
    const jumps = document.getElementById("hist-jumps");
    jumps.replaceChildren();
    const ultimoI = D.date.length - 1;
    const s1 = confronto(ultimoI), s2 = s1 != null ? confronto(s1) : null;
    const salti = [
      [0, `${fmt.giorno(date[0]).trim()} · inizio della serie`],
      s2 != null && [s2, `${fmt.giorno(date[s2]).trim()} · due settimane prima`],
      s1 != null && [s1, `${fmt.giorno(date[s1]).trim()} · una settimana prima`],
      [ultimoI, `${fmt.giorno(date[ultimoI]).trim()} · ultimo giorno`],
    ].filter(Boolean);
    for (const [i, label] of salti) {
      const b = el("button", "chip", label);
      b.type = "button";
      b.dataset.i = i;
      b.addEventListener("click", () => {
        stop();
        goTo(i, 600);
      });
      jumps.append(b);
    }

    function goTo(i, duration = 250) {
      histDay = i;
      const j = confronto(i);
      const r = nazPer.get(fuel)?.get(D.date[i]);
      const rj = j != null ? nazPer.get(fuel)?.get(D.date[j]) : null;
      slider.value = String(i);
      slider.setAttribute("aria-valuetext", fmt.giornoAnno(date[i]).trim());
      hist.setDay(i, {
        duration,
        reference: j,
        markers: r ? [{ value: r.media, label: `Media ${fmt.prezzo(r.media)}`, color: "#e6edf7" }] : [],
      });
      dateOut.textContent = `Prezzi alle 8:00 del ${fmt.giornoAnno(date[i]).trim()}`;
      jumps.querySelectorAll(".chip").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.i === i)));

      // legenda: barre del giorno scelto e contorno del giorno di confronto
      const legend = document.getElementById("hist-legend");
      legend.replaceChildren();
      const voce = (cls, c, label) => {
        const sp = el("span");
        const k = el("span", cls);
        if (c) k.style.background = c;
        sp.append(k, document.createTextNode(label));
        legend.append(sp);
      };
      voce("key-rect", COLORE[fuel], `Distributori, ${fmt.giorno(date[i]).trim()}`);
      if (j != null) voce("key-outline", null, `Contorno: ${fmt.giorno(date[j]).trim()}, una settimana prima`);

      // numeri del giorno, con il confronto a una settimana
      const stats = document.getElementById("hist-stats");
      stats.replaceChildren();
      const stat = (l, v, small, extra) => {
        const d = el("div", "hist-stat");
        const vv = el("div", "v", v);
        if (small) vv.append(el("small", null, small));
        d.append(el("div", "l", l), vv);
        if (extra) d.append(extra);
        stats.append(d);
      };
      if (r) {
        stat("Prezzo medio", fmt.prezzo(r.media), "€/l", rj ? deltaSpan(r.media - rj.media, " in una settimana") : null);
        stat("Metà dei distributori", `${fmt.prezzo2(r.p25)} – ${fmt.prezzo2(r.p75)}`, "€/l",
          rj ? el("div", "hist-prima", `una settimana prima ${fmt.prezzo2(rj.p25)} – ${fmt.prezzo2(rj.p75)}`) : null);
        stat("8 distributori su 10", `${fmt.prezzo2(r.p10)} – ${fmt.prezzo2(r.p90)}`, "€/l",
          rj ? el("div", "hist-prima", `una settimana prima ${fmt.prezzo2(rj.p10)} – ${fmt.prezzo2(rj.p90)}`) : null);
      }

      const nome = fuel === "benzina" ? "la benzina" : "il gasolio";
      document.getElementById("hist-title").textContent = r
        ? `Il ${fmt.giorno(date[i]).trim()} metà dei distributori vendeva ${nome} tra ${fmt.prezzo2(r.p25)} e ${fmt.prezzo2(r.p75)} €/l` +
          (rj ? `, una settimana prima tra ${fmt.prezzo2(rj.p25)} e ${fmt.prezzo2(rj.p75)}` : "")
        : "Come si distribuiscono i prezzi";

      const fuori = D.sotto[i] + D.sopra[i];
      document.getElementById("hist-note").textContent =
        `Fasce di 1 centesimo, chiuse a destra: la fascia di 2,00 contiene i prezzi da 1,991 a 2,000 €/l. ` +
        `Gli assi sono gli stessi per tutti i giorni, così i cambiamenti si vedono a colpo d'occhio. ` +
        `Restano fuori scala ${fmt.intero(fuori)} distributori su ${fmt.intero(totale(i))} (sotto ${fmt.prezzo2(D.da / 100 - 0.01)} o sopra ${fmt.prezzo2(D.a / 100)} €/l, per esempio Livigno e alcune autostrade). ` +
        `I picchi su prezzi "tondi" come 1,999 sono reali: molti gestori scelgono gli stessi prezzi. ` +
        `Dal 28 settembre il picco a ${fmt.prezzo2(tetto.benzina)} (benzina) e ${fmt.prezzo2(tetto.gasolio)} (gasolio) riflette il prezzo massimo applicato da Eni e poi da altri distributori.`;
    }

    slider.oninput = () => {
      stop();
      goTo(+slider.value, 120);
    };
    const passo = () => {
      const i = histDay + 1;
      if (i > ultimoI) return stop();
      goTo(i, 150);
    };
    function stop() {
      if (play) clearInterval(play);
      play = null;
      playBtn.textContent = "▶";
      playBtn.setAttribute("aria-label", "Riproduci i giorni in sequenza");
    }
    playBtn.onclick = () => {
      if (play) return stop();
      if (histDay >= ultimoI) goTo(0, 0);
      playBtn.textContent = "❚❚";
      playBtn.setAttribute("aria-label", "Metti in pausa");
      play = setInterval(passo, 170);
    };
    stop();
    const iniziale = isoScelto && D.date.includes(isoScelto) ? D.date.indexOf(isoScelto) : ultimoI;
    goTo(iniziale, 0);

    // tabella: riepilogo di tutti i giorni
    histEl.parentElement.querySelector("details.table-view")?.remove();
    tableView(histEl.parentElement, [
      { key: "d", label: "Giorno" },
      { key: "media", label: "Media (€/l)", num: true, format: fmt.prezzo },
      { key: "p10", label: "10° perc.", num: true, format: fmt.prezzo },
      { key: "p25", label: "25° perc.", num: true, format: fmt.prezzo },
      { key: "p75", label: "75° perc.", num: true, format: fmt.prezzo },
      { key: "p90", label: "90° perc.", num: true, format: fmt.prezzo },
      { key: "n", label: "Distributori", num: true, format: fmt.intero },
    ], () => D.date.map((d, i) => {
      const r = nazPer.get(fuel)?.get(d) ?? {};
      return { d, media: r.media, p10: r.p10, p25: r.p25, p75: r.p75, p90: r.p90, n: totale(i) };
    }).reverse(), "Mostra i numeri di ogni giorno");
  }

  // ---------- pannelli che dipendono dal carburante ----------
  const regionsEl = document.getElementById("regions");
  const brandsEl = document.getElementById("brands");
  const provEl = document.getElementById("provinces");
  const oggiISO = d3.max(reg, (r) => r.d);
  const tipoOggi = tipo.filter((r) => r.d === d3.max(tipo, (q) => q.d));

  function renderFuelPanels() {
    renderMarchi();
    renderTasse();
    renderBarile();
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

    renderHist();

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
