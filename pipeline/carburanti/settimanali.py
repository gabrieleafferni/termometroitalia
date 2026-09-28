"""Ingestion della serie storica settimanale dei prezzi dei carburanti (MASE).

Il Ministero dell'Ambiente e della Sicurezza Energetica pubblica ogni settimana
i prezzi medi nazionali dei carburanti dal 2005, sia al consumo sia al netto
delle tasse. Il file è sempre la serie completa: lo archiviamo come snapshot
Parquet solo quando compare una nuova settimana (o se la serie viene rivista).

  data/raw/carburanti/settimanali/mase_AAAA-MM-GG.parquet
      AAAA-MM-GG = ultima data di rilevazione contenuta nel file

Formato originale: CSV ISO-8859-1, separatore ",", numeri all'italiana
("1.115,75" = 1115,75) in euro per 1000 litri (per il metano 1000 kg).

Uso:
  python -m pipeline.carburanti.settimanali
  python -m pipeline.carburanti.settimanali --da-file prezzi.csv --netti-da-file netti.csv
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import logging
import sys
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from pipeline.carburanti.ingest import _decode, _http_get

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "data" / "raw" / "carburanti" / "settimanali"

BASE = "https://sisen.mase.gov.it/dgsaie/api/v1/weekly-prices/report/export"
URL_PREZZI = f"{BASE}?format=CSV&lang=it"
URL_NETTI = f"{BASE}?type=NET&format=CSV&lang=it"

COLONNE = {
    "BENZINA": "benzina",
    "GASOLIO_AUTO": "gasolio",
    "GPL": "gpl",
    "METANO": "metano",
}
MIN_SETTIMANE = 1000  # la serie parte dal 2005: sotto questa soglia il file è troncato

SCHEMA = pa.schema(
    [
        ("data", pa.date32()),
        ("carburante", pa.string()),
        ("prezzo", pa.float64()),  # €/l (metano €/kg), tasse incluse
        ("prezzo_netto", pa.float64()),  # €/l, al netto di accise e IVA
    ]
)

log = logging.getLogger("ingest.settimanali")


def numero_it(s: str) -> float | None:
    """'1.115,75' -> 1115.75 ; '1.088' -> 1088 ; '' -> None."""
    s = (s or "").strip()
    if not s:
        return None
    return float(s.replace(".", "").replace(",", "."))


def parse(testo: str) -> dict[tuple[dt.date, str], float]:
    reader = csv.DictReader(io.StringIO(testo.lstrip("﻿")))
    mancanti = [c for c in COLONNE if c not in (reader.fieldnames or [])]
    if "DATA_RILEVAZIONE" not in (reader.fieldnames or []) or mancanti:
        raise ValueError(f"Intestazione inattesa: {reader.fieldnames}")
    out: dict[tuple[dt.date, str], float] = {}
    for r in reader:
        d = dt.date.fromisoformat(r["DATA_RILEVAZIONE"].strip())
        for col, carb in COLONNE.items():
            v = numero_it(r[col])
            if v is not None:
                out[(d, carb)] = round(v / 1000, 5)  # euro per 1000 litri -> euro per litro
    return out


def costruisci(prezzi: dict, netti: dict) -> pa.Table:
    righe = [
        {"data": d, "carburante": c, "prezzo": p, "prezzo_netto": netti.get((d, c))}
        for (d, c), p in sorted(prezzi.items())
    ]
    t = pa.Table.from_pylist(righe, schema=SCHEMA)
    settimane = len({r["data"] for r in righe})
    if settimane < MIN_SETTIMANE:
        raise ValueError(f"Solo {settimane} settimane: file sospetto, non archiviato")
    ultimo = max(r["data"] for r in righe)
    bz = [r["prezzo"] for r in righe if r["carburante"] == "benzina"]
    if not all(0.5 < p < 4 for p in bz):
        raise ValueError("Prezzi della benzina fuori da un intervallo plausibile")
    log.info("Serie MASE: %d settimane, dal %s al %s", settimane, min(r["data"] for r in righe), ultimo)
    return t


def archivia(t: pa.Table) -> Path | None:
    ultimo = max(t.column("data").to_pylist())
    path = OUT_DIR / f"mase_{ultimo:%Y-%m-%d}.parquet"
    esistenti = sorted(OUT_DIR.glob("mase_*.parquet"))
    if esistenti:
        precedente = pq.read_table(esistenti[-1])
        if precedente.to_pylist() == t.to_pylist():
            log.info("Serie MASE invariata (ultima settimana %s): niente da salvare", ultimo)
            return None
        if path.exists():
            log.info("Serie del %s rivista dal MASE: sovrascrivo lo snapshot", ultimo)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    pq.write_table(t, path, compression="zstd", compression_level=9)
    log.info("Salvato %s", path.relative_to(ROOT))
    return path


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--da-file", type=Path, help="CSV dei prezzi al consumo già scaricato")
    ap.add_argument("--netti-da-file", type=Path, help="CSV dei prezzi netti già scaricato")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    testo = _decode(args.da_file.read_bytes()) if args.da_file else _decode(_http_get(URL_PREZZI))
    testo_netti = _decode(args.netti_da_file.read_bytes()) if args.netti_da_file else _decode(_http_get(URL_NETTI))
    archivia(costruisci(parse(testo), parse(testo_netti)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
