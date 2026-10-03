import { fmt, parseDay } from "./format.js";

const REPO = "https://github.com/gabrieleafferni/termometroitalia";

const LOGO = `
<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <rect x="9" y="2.5" width="6" height="13" rx="3" stroke="#3ee0f5" stroke-width="1.6"/>
  <circle cx="12" cy="18" r="3.6" stroke="#3ee0f5" stroke-width="1.6"/>
  <circle cx="12" cy="18" r="1.6" fill="#3ee0f5"/>
  <path d="M12 8.5v7.5" stroke="#3ee0f5" stroke-width="1.6" stroke-linecap="round"/>
</svg>`;

const VOCI = [
  { href: "index.html", label: "Panoramica", key: "home" },
  { href: "carburanti.html", label: "Carburanti", key: "carburanti" },
  { href: null, label: "Salari", key: "salari" },
  { href: null, label: "Immigrazione", key: "immigrazione" },
  { href: null, label: "Elezioni", key: "elezioni" },
  { href: "metodo.html", label: "Metodo", key: "metodo" },
];

/** Barra superiore e footer comuni a tutte le pagine. */
export function chrome(pagina, meta) {
  const top = document.createElement("header");
  top.className = "topbar";
  const nav = VOCI.map((v) =>
    v.href
      ? `<a href="${v.href}"${v.key === pagina ? ' aria-current="page"' : ""}>${v.label}</a>`
      : `<a class="soon" aria-disabled="true" title="In costruzione">${v.label}</a>`
  ).join("");
  const agg = meta?.carburanti?.aggiornato_al;
  top.innerHTML = `
    <div class="topbar-inner">
      <a class="brand" href="index.html">${LOGO}<span>Termometro Italia</span><small>v1 · dati aperti</small></a>
      <nav class="nav" aria-label="Sezioni">${nav}</nav>
      <div class="live" title="Ultima rilevazione disponibile">
        <span class="live-dot" aria-hidden="true"></span>
        <span><span class="long">dati del </span>${agg ? fmt.giornoAnno(parseDay(agg)).trim() : "—"}</span>
      </div>
    </div>`;
  document.body.prepend(top);

  const foot = document.createElement("footer");
  foot.className = "footer";
  foot.innerHTML = `
    <div class="footer-inner">
      <div>
        <h4>Il progetto</h4>
        <p><strong style="color:var(--text);font-weight:500">Termometro Italia</strong> misura ogni giorno i temi caldi dell'attualità italiana con dati pubblici e aperti.</p>
        <p>Un progetto di Gabriele Afferni · <a href="${REPO}">codice su GitHub</a></p>
      </div>
      <div>
        <h4>Fonti e licenze</h4>
        <p>MIMIT – Osservaprezzi Carburanti (IODL 2.0) · MASE · ISTAT (CC BY 4.0) · EIA via FRED · BCE · confini ISTAT via openpolis</p>
        <p>Codice <a href="${REPO}/blob/main/LICENSE">MIT</a> · elaborazioni <a href="https://creativecommons.org/licenses/by/4.0/deed.it">CC BY 4.0</a> · <a href="${REPO}/blob/main/data/LICENSE.md">dettagli</a></p>
        <p>Progetto indipendente: non è una fonte ufficiale.</p>
      </div>
      <div>
        <h4>Come è fatto</h4>
        <p>Python · DuckDB · dbt · GitHub Actions · D3</p>
        <p><a href="metodo.html">Metodologia e note sui dati</a></p>
      </div>
    </div>`;
  document.body.append(foot);
}

/* ---------- tooltip condiviso -------------------------------------------- */
let tipEl;
export function tooltip() {
  if (!tipEl) {
    tipEl = document.createElement("div");
    tipEl.className = "tooltip";
    tipEl.setAttribute("role", "status");
    document.body.append(tipEl);
  }
  return {
    show(build, x, y) {
      tipEl.replaceChildren();
      build(tipEl);
      tipEl.classList.add("show");
      const r = tipEl.getBoundingClientRect();
      let left = x + 16;
      let top = y + 16;
      if (left + r.width > window.innerWidth - 8) left = x - r.width - 16;
      if (top + r.height > window.innerHeight - 8) top = y - r.height - 16;
      tipEl.style.left = `${Math.max(8, left)}px`;
      tipEl.style.top = `${Math.max(8, top)}px`;
    },
    hide() {
      tipEl.classList.remove("show");
    },
  };
}

/** Elemento DOM con testo sicuro (mai innerHTML con dati esterni). */
export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function ttTitle(parent, title, sub) {
  parent.append(el("div", "tt-title", title));
  if (sub) parent.append(el("div", "tt-sub", sub));
}

export function ttRow(parent, color, label, value) {
  const row = el("div", "tt-row");
  const key = el("span", "tt-key");
  key.style.background = color || "transparent";
  row.append(key, el("span", null, label), el("span", "v", value));
  parent.append(row);
}

/* ---------- vista tabellare (accessibilità) ------------------------------ */
export function tableView(container, columns, rows, label = "Mostra i dati in tabella") {
  const det = el("details", "table-view");
  det.append(el("summary", null, label));
  const wrap = el("div", "table-scroll");
  const table = el("table", "data");
  const thead = el("thead");
  const trh = el("tr");
  for (const c of columns) {
    const th = el("th", c.num ? "num" : null, c.label);
    th.scope = "col";
    trh.append(th);
  }
  thead.append(trh);
  const tbody = el("tbody");
  det.addEventListener(
    "toggle",
    () => {
      if (!det.open || tbody.childElementCount) return;
      for (const r of rows()) {
        const tr = el("tr");
        for (const c of columns) tr.append(el("td", c.num ? "num" : null, c.format ? c.format(r[c.key], r) : r[c.key]));
        tbody.append(tr);
      }
    },
    { once: false }
  );
  table.append(thead, tbody);
  wrap.append(table);
  det.append(wrap);
  container.append(det);
  return det;
}

/* ---------- animazioni ---------------------------------------------------- */
export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function countUp(node, to, format, duration = 1200) {
  if (reducedMotion()) {
    node.textContent = format(to);
    return;
  }
  const from = to * 0.92;
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / duration);
    const e = 1 - Math.pow(1 - k, 3);
    node.textContent = format(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function reveal() {
  const els = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window) || reducedMotion()) {
    els.forEach((e) => e.classList.add("in"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (en.isIntersecting) {
          en.target.classList.add("in");
          io.unobserve(en.target);
        }
      }
    },
    { rootMargin: "0px 0px -8% 0px" }
  );
  els.forEach((e) => io.observe(e));
}

/** Richiama fn quando la larghezza del contenitore cambia. */
export function onResize(node, fn) {
  // un solo osservatore per nodo: se il grafico viene ricreato, il vecchio smette di ridisegnare
  node._ro?.disconnect();
  let w = node.clientWidth;
  const ro = new ResizeObserver(() => {
    if (Math.abs(node.clientWidth - w) > 2) {
      w = node.clientWidth;
      fn();
    }
  });
  ro.observe(node);
  node._ro = ro;
}

/** Frase di variazione con freccia (colore + simbolo, mai solo colore). */
export function deltaSpan(deltaEuro, periodo) {
  const s = el("span", "delta");
  const c = deltaEuro * 100;
  const dir = Math.abs(c) < 0.05 ? "flat" : c > 0 ? "up" : "down";
  s.classList.add(dir);
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "■";
  s.append(el("span", null, `${arrow} ${fmt.cent(deltaEuro)} cent`));
  if (periodo) s.append(el("span", "per", periodo));
  s.title = `${dir === "up" ? "Aumento" : dir === "down" ? "Calo" : "Stabile"} ${periodo || ""}`.trim();
  return s;
}
