const BASE = import.meta.env.BASE_URL;
const cache = new Map();

export function load(name) {
  if (!cache.has(name)) {
    cache.set(
      name,
      fetch(`${BASE}data/${name}`).then((r) => {
        if (!r.ok) throw new Error(`Impossibile caricare ${name}: ${r.status}`);
        return r.json();
      })
    );
  }
  return cache.get(name);
}

export function loadGeo(name) {
  return fetch(`${BASE}geo/${name}`).then((r) => r.json());
}

/** Converte il formato colonnare {col: [...]} in un array di oggetti. */
export function fromColumns(cols) {
  const keys = Object.keys(cols);
  const n = cols[keys[0]].length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = {};
    for (const k of keys) o[k] = cols[k][i];
    out[i] = o;
  }
  return out;
}
