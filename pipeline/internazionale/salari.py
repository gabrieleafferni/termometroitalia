"""Salari medi a confronto con gli altri paesi.

  OCSE      Average annual wages (OECD.ELS.SAE, DSD_EARNINGS@AV_AN_WAGE): salario
            medio annuo per dipendente a tempo pieno equivalente, dal 1990, a prezzi
            costanti in dollari a parità di potere d'acquisto (PPA) e in valuta
            nazionale. Citazione richiesta: OECD (anno), Average annual wages.
  Eurostat  nama_10_fte: salario medio annuo per dipendente a tempo pieno, in euro
            correnti, paesi UE e UE27, dal 1995.

File annuali riscritti solo se cambiano (nome = ultimo anno contenuto):

  data/raw/ocse/salari_medi_AAAA.parquet
  data/raw/eurostat/salari/salario_tempo_pieno_AAAA.parquet

Uso:
  python -m pipeline.internazionale.salari
  python -m pipeline.internazionale.salari --da-cartella DIR   # file già scaricati
"""

from __future__ import annotations

import argparse
import csv
import io
import logging
import sys
import urllib.request
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parents[2]
OUT_OCSE = ROOT / "data" / "raw" / "ocse"
OUT_EUROSTAT = ROOT / "data" / "raw" / "eurostat" / "salari"
UA = "termometroitalia/1.0 (+https://github.com/gabrieleafferni/termometroitalia)"
URL_OCSE = ("https://sdmx.oecd.org/public/rest/data/OECD.ELS.SAE,DSD_EARNINGS@AV_AN_WAGE,1.0/all"
            "?startPeriod=1990&dimensionAtObservation=AllDimensions&format=csvfilewithlabels")
URL_EUROSTAT = ("https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1/data/nama_10_fte/"
                "A.EUR.?format=SDMX-CSV&startPeriod=1995")
FILE_LOCALI = {"ocse": "ocse_av_an_wage.csv", "eurostat": "eurostat_nama_10_fte.csv"}

SCHEMA_OCSE = pa.schema([
    ("anno", pa.int32()), ("paese", pa.string()), ("nome_en", pa.string()), ("unita", pa.string()),
    ("prezzi", pa.string()), ("base", pa.string()), ("valore", pa.float64()),
])
SCHEMA_EUROSTAT = pa.schema([
    ("anno", pa.int32()), ("paese", pa.string()), ("euro", pa.float64()),
])
log = logging.getLogger("ingest.salari_internazionali")


def scarica(url: str, timeout: int = 180) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8-sig")


def parse_ocse(testo: str) -> pa.Table:
    reader = csv.DictReader(io.StringIO(testo.lstrip("﻿")))
    if not {"REF_AREA", "UNIT_MEASURE", "PRICE_BASE", "TIME_PERIOD", "OBS_VALUE"} <= set(reader.fieldnames or []):
        raise ValueError(f"OCSE: intestazione inattesa {reader.fieldnames}")
    out = []
    for r in reader:
        if not (r["OBS_VALUE"] or "").strip():
            continue
        # dollari PPA (confronto tra paesi) e euro (livelli per i paesi dell'euro)
        if r["UNIT_MEASURE"] not in ("USD_PPP", "EUR"):
            continue
        out.append({"anno": int(r["TIME_PERIOD"]), "paese": r["REF_AREA"], "nome_en": r.get("Reference area", ""),
                    "unita": r["UNIT_MEASURE"], "prezzi": "costanti" if r["PRICE_BASE"] == "Q" else "correnti",
                    "base": r.get("BASE_PER") or "", "valore": float(r["OBS_VALUE"])})
    out.sort(key=lambda x: (x["paese"], x["unita"], x["prezzi"], x["anno"]))
    paesi = {x["paese"] for x in out if x["unita"] == "USD_PPP"}
    if "ITA" not in paesi or len(paesi) < 25:
        raise ValueError(f"OCSE: solo {len(paesi)} paesi in dollari PPA")
    if len({(x["paese"], x["unita"], x["prezzi"], x["anno"]) for x in out}) != len(out):
        raise ValueError("OCSE: righe ripetute")
    return pa.Table.from_pylist(out, schema=SCHEMA_OCSE)


def parse_eurostat(testo: str) -> pa.Table:
    reader = csv.DictReader(io.StringIO(testo.lstrip("﻿")))
    if not {"geo", "unit", "TIME_PERIOD", "OBS_VALUE"} <= set(reader.fieldnames or []):
        raise ValueError(f"Eurostat: intestazione inattesa {reader.fieldnames}")
    out = [{"anno": int(r["TIME_PERIOD"]), "paese": r["geo"], "euro": float(r["OBS_VALUE"])}
           for r in reader if r["unit"] == "EUR" and (r["OBS_VALUE"] or "").strip()]
    out.sort(key=lambda x: (x["paese"], x["anno"]))
    if not any(x["paese"] == "IT" for x in out) or not all(1000 < x["euro"] < 200000 for x in out):
        raise ValueError("Eurostat: Italia assente o valori non plausibili")
    return pa.Table.from_pylist(out, schema=SCHEMA_EUROSTAT)


def archivia(t: pa.Table, cartella: Path, prefisso: str) -> Path | None:
    ultimo = max(t.column("anno").to_pylist())
    esistenti = sorted(cartella.glob(f"{prefisso}_*.parquet"))
    if esistenti and pq.read_table(esistenti[-1]).to_pylist() == t.to_pylist():
        log.info("%s invariato (ultimo anno %d)", prefisso, ultimo)
        return None
    cartella.mkdir(parents=True, exist_ok=True)
    path = cartella / f"{prefisso}_{ultimo}.parquet"
    pq.write_table(t, path, compression="zstd", compression_level=9)
    log.info("Salvato %s (%d righe)", path.relative_to(ROOT), t.num_rows)
    return path


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--da-cartella", type=Path, help="cartella con i file già scaricati")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    def testo(fonte: str, url: str) -> str:
        if args.da_cartella:
            return (args.da_cartella / FILE_LOCALI[fonte]).read_text(encoding="utf-8-sig")
        return scarica(url)

    errori = 0
    for fonte, url, parser, cartella, prefisso in [
        ("ocse", URL_OCSE, parse_ocse, OUT_OCSE, "salari_medi"),
        ("eurostat", URL_EUROSTAT, parse_eurostat, OUT_EUROSTAT, "salario_tempo_pieno"),
    ]:
        try:
            archivia(parser(testo(fonte, url)), cartella, prefisso)
        except Exception as e:  # una fonte che non risponde non ferma l'altra
            errori += 1
            log.error("%s: %s: %s", fonte, type(e).__name__, e)
    return 1 if errori else 0


if __name__ == "__main__":
    sys.exit(main())
