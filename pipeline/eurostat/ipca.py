"""Ingestion dell'IPCA (indice armonizzato dei prezzi al consumo) per l'Italia.

È il secondo deflatore dei salari, accanto al NIC: l'ISTAT lo usa nei comunicati
sulle retribuzioni contrattuali e la sua versione al netto dell'energia importata
guida i rinnovi dei contratti. Si scarica da Eurostat (l'IPCA italiano è calcolato
dall'ISTAT) perché lì è in un'unica base dal 1996: niente raccordi.

  Eurostat prc_hicp_minr (HICP, classificazione Ecoicop 2), M.I25.TOTAL.IT
  base 2025 = 100, indice generale, mensile dal gennaio 1996

Lo snapshot si archivia solo se la serie cambia:

  data/raw/eurostat/ipca/ipca_AAAA-MM.parquet     AAAA-MM = ultimo mese contenuto

Uso:
  python -m pipeline.eurostat.ipca
  python -m pipeline.eurostat.ipca --da-file ipca.csv   # SDMX-CSV già scaricato
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import logging
import sys
import urllib.request
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "data" / "raw" / "eurostat" / "ipca"
URL = ("https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1/data/prc_hicp_minr/"
       "M.I25.TOTAL.IT?format=SDMX-CSV&startPeriod=1996-01")
UA = "termometroitalia/1.0 (+https://github.com/gabrieleafferni/termometroitalia)"
MIN_MESI = 360

SCHEMA = pa.schema([
    ("mese", pa.date32()), ("base", pa.string()), ("indice", pa.float64()), ("provvisorio", pa.bool_()),
])
log = logging.getLogger("ingest.ipca")


def scarica(timeout: int = 180) -> str:
    req = urllib.request.Request(URL, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8-sig")


def parse(testo: str) -> pa.Table:
    reader = csv.DictReader(io.StringIO(testo.lstrip("﻿")))
    if not {"TIME_PERIOD", "OBS_VALUE", "geo", "unit"} <= set(reader.fieldnames or []):
        raise ValueError(f"Intestazione inattesa: {reader.fieldnames}")
    out = []
    for r in reader:
        if r["geo"] != "IT" or r["unit"] != "I25" or not (r["OBS_VALUE"] or "").strip():
            continue
        a, m = map(int, r["TIME_PERIOD"].split("-"))
        out.append({"mese": dt.date(a, m, 1), "base": "2025", "indice": float(r["OBS_VALUE"]),
                    "provvisorio": "p" in (r.get("OBS_FLAG") or "").lower()})
    out.sort(key=lambda x: x["mese"])
    if len(out) < MIN_MESI:
        raise ValueError(f"Solo {len(out)} mesi: risposta sospetta, non archiviata")
    if not all(30 < x["indice"] < 200 for x in out):
        raise ValueError("Indici fuori da un intervallo plausibile")
    if len({x["mese"] for x in out}) != len(out):
        raise ValueError("Mesi ripetuti")
    log.info("IPCA: %d mesi, dal %s al %s", len(out), out[0]["mese"], out[-1]["mese"])
    return pa.Table.from_pylist(out, schema=SCHEMA)


def archivia(t: pa.Table) -> Path | None:
    ultimo = max(t.column("mese").to_pylist())
    esistenti = sorted(OUT_DIR.glob("ipca_*.parquet"))
    if esistenti and pq.read_table(esistenti[-1]).to_pylist() == t.to_pylist():
        log.info("IPCA invariato (ultimo mese %s): niente da salvare", f"{ultimo:%Y-%m}")
        return None
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"ipca_{ultimo:%Y-%m}.parquet"
    pq.write_table(t, path, compression="zstd", compression_level=9)
    log.info("Salvato %s", path.relative_to(ROOT))
    return path


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--da-file", type=Path, help="risposta SDMX-CSV già scaricata")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    testo = args.da_file.read_text(encoding="utf-8-sig") if args.da_file else scarica()
    archivia(parse(testo))
    return 0


if __name__ == "__main__":
    sys.exit(main())
