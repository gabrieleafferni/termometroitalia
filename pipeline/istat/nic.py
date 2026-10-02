"""Ingestion dell'indice dei prezzi al consumo NIC (ISTAT), indice generale.

Serve a deflazionare i prezzi: dire se un prezzo è un record anche al netto
dell'inflazione. Si scarica con una sola richiesta all'API SDMX dell'ISTAT la
serie mensile nazionale in tutte le basi pubblicate:

  base 1995=100   gennaio 1996 - dicembre 2010
  base 2010=100   gennaio 2011 - dicembre 2015
  base 2015=100   gennaio 2016 - dicembre 2025
  base 2025=100   da gennaio 2026

Le basi NON vengono concatenate qui: il raccordo si fa in dbt
(int_istat__nic_concatenato), dove è visibile e testato.

Lo snapshot si archivia solo se la serie cambia (nuovo mese, dato provvisorio
che diventa definitivo, revisione):

  data/raw/istat/nic/nic_AAAA-MM.parquet     AAAA-MM = ultimo mese contenuto

L'API ISTAT blocca l'IP per 1-2 giorni oltre 5 richieste al minuto: qui se ne
fa una sola, senza tentativi ravvicinati.

Uso:
  python -m pipeline.istat.nic
  python -m pipeline.istat.nic --da-file nic.csv     # file SDMX-CSV già scaricato
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import logging
import sys
import urllib.error
import urllib.request
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "data" / "raw" / "istat" / "nic"

# Dataflow "NIC - mensili - tutte le basi" (classificazione Ecoicop 2).
# Chiave: FREQ.REF_AREA.DATA_TYPE.MEASURE.ECOICOP_2
#   M = mensile, IT = Italia, MEASURE 4 = numeri indice, 00 = indice generale
#   DATA_TYPE: 1 = base 1995, 9 = base 2010, 39 = base 2015, 85 = base 2025
FLOW = "167_745_DF_DCSP_NIC1B2025_6"
BASI = {"1": "1995", "9": "2010", "39": "2015", "85": "2025"}
URL = (f"https://esploradati.istat.it/SDMXWS/rest/data/{FLOW}/"
       f"M.IT.{'+'.join(BASI)}.4.00?startPeriod=1996-01")
ACCEPT = "application/vnd.sdmx.data+csv;version=1.0.0"
UA = "termometroitalia/1.0 (+https://github.com/gabrieleafferni/termometroitalia)"

MIN_MESI = 360  # dal 1996: sotto questa soglia la risposta è troncata

SCHEMA = pa.schema(
    [
        ("mese", pa.date32()),  # primo giorno del mese
        ("base", pa.string()),  # anno base dell'indice (=100)
        ("indice", pa.float64()),
        ("provvisorio", pa.bool_()),  # stima provvisoria (OBS_STATUS = "p")
    ]
)

log = logging.getLogger("ingest.nic")


def scarica(timeout: int = 180) -> str:
    req = urllib.request.Request(URL, headers={"User-Agent": UA, "Accept": ACCEPT})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8-sig")


def parse(testo: str) -> pa.Table:
    reader = csv.DictReader(io.StringIO(testo.lstrip("﻿")))
    richieste = {"DATA_TYPE", "TIME_PERIOD", "OBS_VALUE"}
    if not richieste <= set(reader.fieldnames or []):
        raise ValueError(f"Intestazione inattesa: {reader.fieldnames}")
    righe = []
    for r in reader:
        if r.get("REF_AREA", "IT") != "IT" or r.get("ECOICOP_2", "00") != "00":
            raise ValueError(f"Serie inattesa nella risposta: {r}")
        base = BASI.get(r["DATA_TYPE"])
        if base is None or not r["OBS_VALUE"]:
            continue
        anno, mese = map(int, r["TIME_PERIOD"].split("-"))
        righe.append({
            "mese": dt.date(anno, mese, 1),
            "base": base,
            "indice": float(r["OBS_VALUE"]),
            "provvisorio": (r.get("OBS_STATUS") or "").strip().lower() == "p",
        })
    righe.sort(key=lambda x: (x["base"], x["mese"]))
    controlla(righe)
    return pa.Table.from_pylist(righe, schema=SCHEMA)


def controlla(righe: list[dict]) -> None:
    mesi = {r["mese"] for r in righe}
    if len(mesi) < MIN_MESI:
        raise ValueError(f"Solo {len(mesi)} mesi: risposta sospetta, non archiviata")
    if {r["base"] for r in righe} != set(BASI.values()):
        raise ValueError(f"Basi mancanti: {set(BASI.values()) - {r['base'] for r in righe}}")
    if not all(50 < r["indice"] < 200 for r in righe):
        raise ValueError("Indici fuori da un intervallo plausibile")
    doppi = len(righe) - len({(r["base"], r["mese"]) for r in righe})
    if doppi:
        raise ValueError(f"{doppi} mesi ripetuti nella stessa base")
    ultimo = max(mesi)
    log.info("NIC: %d mesi, dal %s al %s (%s)", len(mesi), min(mesi), ultimo,
             "provvisorio" if any(r["provvisorio"] for r in righe if r["mese"] == ultimo) else "definitivo")


def archivia(t: pa.Table) -> Path | None:
    ultimo = max(t.column("mese").to_pylist())
    path = OUT_DIR / f"nic_{ultimo:%Y-%m}.parquet"
    esistenti = sorted(OUT_DIR.glob("nic_*.parquet"))
    if esistenti and pq.read_table(esistenti[-1]).to_pylist() == t.to_pylist():
        log.info("Serie NIC invariata (ultimo mese %s): niente da salvare", f"{ultimo:%Y-%m}")
        return None
    OUT_DIR.mkdir(parents=True, exist_ok=True)
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
