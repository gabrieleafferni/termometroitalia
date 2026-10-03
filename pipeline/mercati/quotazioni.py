"""Ingestion delle quotazioni di mercato: petrolio Brent, prodotti raffinati e cambio.

Servono a confrontare i prezzi alla pompa con il costo della materia prima e,
più avanti, ai modelli di previsione (rockets and feathers):

  brent_usd_barile         Brent spot, dollari al barile           FRED DCOILBRENTEU (fonte EIA)
  gasolio_nyh_usd_gallone  gasolio (ULSD) New York Harbor, $/gal   FRED DDFUELNYH   (fonte EIA)
  benzina_nyh_usd_gallone  benzina convenzionale NY Harbor, $/gal  FRED DGASNYH     (fonte EIA)
  usd_per_eur              dollari per un euro, cambio di riferimento BCE (EXR D.USD.EUR.SP00.A)

Le serie si scaricano intere (sono piccole) e si archiviano per mese:

  data/raw/mercati/quotazioni/AAAA/quotazioni_AAAA-MM.parquet

Un file mensile si riscrive solo se cambia: ogni giorno cambia quello del mese
in corso (pochi KB), i mesi passati restano fermi salvo revisioni delle fonti.
Così il repository non cresce di una copia dell'intera serie al giorno.

Uso:
  python -m pipeline.mercati.quotazioni
  python -m pipeline.mercati.quotazioni --da-cartella esplorazione/   # file già scaricati
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import logging
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "data" / "raw" / "mercati" / "quotazioni"
UA = "termometroitalia/1.0 (+https://github.com/gabrieleafferni/termometroitalia)"
INIZIO = "2005-01-01"

FRED = {
    "brent_usd_barile": "DCOILBRENTEU",
    "gasolio_nyh_usd_gallone": "DDFUELNYH",
    "benzina_nyh_usd_gallone": "DGASNYH",
}
URL_FRED = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={id}&cosd=" + INIZIO
URL_BCE = ("https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A"
           "?format=csvdata&startPeriod=" + INIZIO)
# nomi dei file nella cartella dell'esplorazione (per i test in locale)
FILE_LOCALI = {
    "brent_usd_barile": "fred_brent.csv",
    "gasolio_nyh_usd_gallone": "fred_diesel_nyh.csv",
    "benzina_nyh_usd_gallone": "fred_benzina_nyh.csv",
    "usd_per_eur": "bce_usd_eur.csv",
}
FONTE = {
    "brent_usd_barile": "FRED DCOILBRENTEU (EIA)",
    "gasolio_nyh_usd_gallone": "FRED DDFUELNYH (EIA)",
    "benzina_nyh_usd_gallone": "FRED DGASNYH (EIA)",
    "usd_per_eur": "BCE EXR D.USD.EUR.SP00.A",
}
# intervalli plausibili: fuori da questi la serie è sospetta e non si archivia
PLAUSIBILE = {
    "brent_usd_barile": (5, 300),
    "gasolio_nyh_usd_gallone": (0.2, 10),
    "benzina_nyh_usd_gallone": (0.2, 10),
    "usd_per_eur": (0.7, 1.8),
}
MIN_OSSERVAZIONI = 4000  # dal 2005 sono oltre 5.000 giorni di mercato

SCHEMA = pa.schema(
    [
        ("data", pa.date32()),
        ("serie", pa.string()),
        ("valore", pa.float64()),
        ("fonte", pa.string()),
    ]
)

log = logging.getLogger("ingest.quotazioni")


def scarica(url: str, timeout: int = 120) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8-sig")


def parse_fred(testo: str, colonna: str) -> dict[dt.date, float]:
    out = {}
    reader = csv.DictReader(io.StringIO(testo))
    if colonna not in (reader.fieldnames or []):
        raise ValueError(f"Colonna {colonna} assente: {reader.fieldnames}")
    for r in reader:
        v = (r[colonna] or "").strip()
        if v in ("", "."):  # giorni senza quotazione (festività)
            continue
        out[dt.date.fromisoformat(r["observation_date"])] = float(v)
    return out


def parse_bce(testo: str) -> dict[dt.date, float]:
    out = {}
    for r in csv.DictReader(io.StringIO(testo)):
        if r.get("OBS_VALUE"):
            out[dt.date.fromisoformat(r["TIME_PERIOD"])] = float(r["OBS_VALUE"])
    return out


def raccogli(cartella: Path | None = None) -> dict[str, dict[dt.date, float]]:
    def testo(serie: str, url: str) -> str:
        return (cartella / FILE_LOCALI[serie]).read_text(encoding="utf-8-sig") if cartella else scarica(url)

    serie = {s: parse_fred(testo(s, URL_FRED.format(id=i)), i) for s, i in FRED.items()}
    serie["usd_per_eur"] = parse_bce(testo("usd_per_eur", URL_BCE))
    for nome, valori in serie.items():
        lo, hi = PLAUSIBILE[nome]
        if len(valori) < MIN_OSSERVAZIONI:
            raise ValueError(f"{nome}: solo {len(valori)} osservazioni, serie sospetta")
        fuori = [d for d, v in valori.items() if not lo <= v <= hi]
        if fuori:
            raise ValueError(f"{nome}: {len(fuori)} valori fuori da [{lo}, {hi}], es. {fuori[:3]}")
        log.info("%s: %d giorni, dal %s al %s (ultimo %.4f)", nome, len(valori), min(valori), max(valori),
                 valori[max(valori)])
    return serie


def archivia(serie: dict[str, dict[dt.date, float]]) -> list[Path]:
    per_mese: dict[str, list[dict]] = defaultdict(list)
    for nome, valori in serie.items():
        for d, v in valori.items():
            per_mese[f"{d:%Y-%m}"].append({"data": d, "serie": nome, "valore": v, "fonte": FONTE[nome]})
    scritti = []
    for mese, righe in sorted(per_mese.items()):
        righe.sort(key=lambda r: (r["serie"], r["data"]))
        t = pa.Table.from_pylist(righe, schema=SCHEMA)
        path = OUT_DIR / mese[:4] / f"quotazioni_{mese}.parquet"
        if path.exists() and pq.read_table(path).to_pylist() == t.to_pylist():
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        pq.write_table(t, path, compression="zstd", compression_level=9)
        scritti.append(path)
    if scritti:
        log.info("Quotazioni: %d mesi scritti (%s … %s)", len(scritti), scritti[0].stem, scritti[-1].stem)
    else:
        log.info("Quotazioni invariate: niente da salvare")
    return scritti


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--da-cartella", type=Path, help="cartella con i CSV già scaricati")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    archivia(raccogli(args.da_cartella))
    return 0


if __name__ == "__main__":
    sys.exit(main())
