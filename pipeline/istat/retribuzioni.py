"""Ingestion dei dati ISTAT sui salari.

Quattro flussi, una richiesta ciascuno all'API SDMX dell'ISTAT:

  contrattuali   indici delle retribuzioni contrattuali, orarie e per dipendente,
                 base dicembre 2021 = 100, mensili, per settore Ateco e qualifica
                 (totale, operai, impiegati)                       155_358_DF_DCSC_RETRATECO1_7
  tensione       contratti in attesa di rinnovo: quota di dipendenti e mesi di
                 attesa, per comparto                              149_319_DF_DCSC_RETRCONTR1T_4
  oros           retribuzioni lorde di fatto per unità di lavoro a tempo pieno (Ula),
                 base 2021, trimestrali, grezze e destagionalizzate 155_374_DF_DCSC_RETRULAOROS_1_4
  racli          retribuzione lorda oraria del settore privato: media, mediana,
                 1° e 9° decile, per sesso e settore (annuale)     533_957_DF_DCSC_RACLI_17
                 e per sesso e provincia                           533_957_DF_DCSC_RACLI_8

Le basi precedenti delle retribuzioni contrattuali (2005, 2010, 2015) servono
per la serie dal 2005: non cambiano più e si scaricano una volta sola
(contrattuali_storico.parquet). Il raccordo tra le basi si fa in dbt.

Ogni flusso si archivia solo se cambia, con il periodo più recente nel nome:

  data/raw/istat/retribuzioni/contrattuali_AAAA-MM.parquet
  data/raw/istat/retribuzioni/tensione_AAAA-MM.parquet
  data/raw/istat/retribuzioni/oros_AAAA-Tn.parquet
  data/raw/istat/retribuzioni/racli_AAAA.parquet
  data/raw/istat/retribuzioni/racli_province_AAAA.parquet

L'API ISTAT blocca l'IP per 1-2 giorni oltre 5 richieste al minuto: qui le
richieste sono distanziate di 15 secondi (anche dalla richiesta del NIC, che
la precede nello stesso giro). Il workflow esegue questo passo una volta al giorno.

Uso:
  python -m pipeline.istat.retribuzioni                  # tutti i flussi
  python -m pipeline.istat.retribuzioni --solo racli     # uno solo
  python -m pipeline.istat.retribuzioni --uscita DIR     # prova, scrive altrove
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import logging
import sys
import time
import urllib.request
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "data" / "raw" / "istat" / "retribuzioni"
BASE_URL = "https://esploradati.istat.it/SDMXWS/rest/data"
ACCEPT = "application/vnd.sdmx.data+csv;version=1.0.0"
UA = "termometroitalia/1.0 (+https://github.com/gabrieleafferni/termometroitalia)"
PAUSA = 15  # secondi tra due richieste ISTAT

# settori delle retribuzioni contrattuali: totale, macrosettori, sezioni Ateco
# e sottosezioni di manifattura, informazione, attività professionali e sanità
SETTORI = (
    ["0010", "0011", "0012", "0013", "0015", "0020"]
    + list("ABCDEFGHIJKLMNOPQRS")
    + ["CA", "CB", "CC", "CD", "CE", "CF", "CG", "CH", "CI", "CJ", "CK", "CL", "CM",
       "JA", "JB", "JC", "MA", "MB", "MC", "QA", "QB"]
)
QUALIFICHE = {"10": "totale", "6": "operai", "23": "impiegati"}
# tipo di indice: orario o per dipendente, nelle quattro basi
TIPI = {
    "WAGE_H_2021": ("orario", "2021"), "WAGE_E_2021": ("per_dipendente", "2021"),
    "WAGE_H_2": ("orario", "2015"), "WAGE_E_2": ("per_dipendente", "2015"),
    "WAGE_H_1": ("orario", "2010"), "WAGE_E_1": ("per_dipendente", "2010"),
    "WAGE_H": ("orario", "2005"), "WAGE_E": ("per_dipendente", "2005"),
}
STORICO = {  # base: (dataflow, codici del tipo di indice)
    "2015": ("155_358_DF_DCSC_RETRATECO1_1", "WAGE_H_2+WAGE_E_2"),
    "2010": ("155_358_DF_DCSC_RETRATECO1_3", "WAGE_H_1+WAGE_E_1"),
    "2005": ("155_358_DF_DCSC_RETRATECO1_5", "WAGE_H+WAGE_E"),
}
RACLI_STAT = {
    "HOUWAG_ENTEMP_AV_MI": "media", "HOUWAG_ENTEMP_MED_MI": "mediana",
    "HOUWAG_ENTEMP_FIRD_MI": "decile_1", "HOUWAG_ENTEMP_NIND_MI": "decile_9",
}
SESSO = {"1": "uomini", "2": "donne", "9": "totale"}


def chiave_contrattuali(tipi: str) -> str:
    # FREQ.REF_AREA.DATA_TYPE.ADJUSTMENT.PROF_STATUS_EMP.ECON_ACTIVITY_NACE_2007
    return f"M.IT.{tipi}.N.{'+'.join(QUALIFICHE)}.{'+'.join(SETTORI)}"


FLUSSI = {
    "contrattuali": {
        "flow": "155_358_DF_DCSC_RETRATECO1_7",
        "chiave": chiave_contrattuali("WAGE_H_2021+WAGE_E_2021"),
        "inizio": "2019-01",
    },
    "tensione": {
        # FREQ.REF_AREA.DATA_TYPE.ADJUSTMENT.PROF_STATUS_EMP.MAIN_AGREEMENT_GROUP
        "flow": "149_319_DF_DCSC_RETRCONTR1T_4",
        "chiave": "M.IT..N.10.",
        "inizio": "2021-01",
    },
    "oros": {
        # FREQ.REF_AREA.DATA_TYPE.ADJUSTMENT.ECON_ACTIVITY_NACE_2007
        "flow": "155_374_DF_DCSC_RETRULAOROS_1_4",
        "chiave": "Q.IT.WAGE_FTE_3..",
        "inizio": "2015-Q1",
    },
    "racli": {
        # 15 dimensioni: si fissano frequenza, territorio e statistiche; il resto è "tutto"
        "flow": "533_957_DF_DCSC_RACLI_17",
        "chiave": "A.IT." + "+".join(RACLI_STAT) + "." + "." * 11,
        "inizio": "2014",
    },
    "racli_province": {
        "flow": "533_957_DF_DCSC_RACLI_8",
        "chiave": "A.." + "+".join(RACLI_STAT) + "." + "." * 11,
        "inizio": "2014",
    },
}

log = logging.getLogger("ingest.retribuzioni")
_ultima_richiesta = [0.0]


def scarica(flow: str, chiave: str, inizio: str, timeout: int = 300) -> str:
    attesa = PAUSA - (time.monotonic() - _ultima_richiesta[0])
    if attesa > 0:
        time.sleep(attesa)
    url = f"{BASE_URL}/{flow}/{chiave}?startPeriod={inizio}"
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": ACCEPT})
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            testo = r.read().decode("utf-8-sig")
    finally:
        _ultima_richiesta[0] = time.monotonic()
    log.info("%s: %d KB in %.0f s", flow, len(testo) // 1024, time.monotonic() - t0)
    return testo


def righe(testo: str, richieste: set[str]) -> list[dict]:
    reader = csv.DictReader(io.StringIO(testo.lstrip("﻿")))
    mancanti = richieste - set(reader.fieldnames or [])
    if mancanti:
        raise ValueError(f"Colonne mancanti nella risposta: {mancanti}")
    return [r for r in reader if (r.get("OBS_VALUE") or "").strip()]


def mese(s: str) -> dt.date:
    a, m = s.split("-")
    return dt.date(int(a), int(m), 1)


def trimestre(s: str) -> dt.date:
    a, q = s.split("-Q")
    return dt.date(int(a), 3 * int(q) - 2, 1)


def provvisorio(r: dict) -> bool:
    return (r.get("OBS_STATUS") or "").strip().lower() == "p"


# ---------- parser dei singoli flussi ----------

SCHEMA_CONTRATTUALI = pa.schema([
    ("mese", pa.date32()), ("base", pa.string()), ("tipo", pa.string()),
    ("qualifica", pa.string()), ("settore", pa.string()),
    ("indice", pa.float64()), ("provvisorio", pa.bool_()),
])


def parse_contrattuali(testo: str) -> pa.Table:
    out = []
    for r in righe(testo, {"DATA_TYPE", "PROF_STATUS_EMP", "ECON_ACTIVITY_NACE_2007", "TIME_PERIOD"}):
        if r["DATA_TYPE"] not in TIPI or r["PROF_STATUS_EMP"] not in QUALIFICHE:
            continue
        tipo, base = TIPI[r["DATA_TYPE"]]
        out.append({"mese": mese(r["TIME_PERIOD"]), "base": base, "tipo": tipo,
                    "qualifica": QUALIFICHE[r["PROF_STATUS_EMP"]], "settore": r["ECON_ACTIVITY_NACE_2007"],
                    "indice": float(r["OBS_VALUE"]), "provvisorio": provvisorio(r)})
    out.sort(key=lambda x: (x["base"], x["tipo"], x["qualifica"], x["settore"], x["mese"]))
    t = pa.Table.from_pylist(out, schema=SCHEMA_CONTRATTUALI)
    controlla_contrattuali(t)
    return t


def controlla_contrattuali(t: pa.Table) -> None:
    righe_ = t.to_pylist()
    if not righe_:
        raise ValueError("Nessun dato")
    totale = [r for r in righe_ if r["settore"] == "0010" and r["qualifica"] == "totale" and r["tipo"] == "orario"]
    if len(totale) < 24:
        raise ValueError(f"Serie del totale troppo corta ({len(totale)} mesi): risposta sospetta")
    if not all(30 < r["indice"] < 200 for r in righe_):
        raise ValueError("Indici fuori da un intervallo plausibile")
    settori = {r["settore"] for r in righe_}
    if len(settori) < 30:
        raise ValueError(f"Solo {len(settori)} settori nella risposta")
    doppi = len(righe_) - len({(r["base"], r["tipo"], r["qualifica"], r["settore"], r["mese"]) for r in righe_})
    if doppi:
        raise ValueError(f"{doppi} righe ripetute")


SCHEMA_TENSIONE = pa.schema([
    ("mese", pa.date32()), ("indicatore", pa.string()), ("comparto", pa.string()), ("valore", pa.float64()),
])
INDICATORI_TENSIONE = {"DIP_ATT_2021": "quota_in_attesa", "MES_ATT_2021": "mesi_attesa_in_attesa",
                       "MES_TOT_2021": "mesi_attesa_tutti"}
COMPARTI = {"Z3620": "totale", "Z2520": "privato", "Z2540": "pa", "Z0060": "industria",
            "Z1240": "servizi_privati", "Z0010": "agricoltura"}


def parse_tensione(testo: str) -> pa.Table:
    out = []
    for r in righe(testo, {"DATA_TYPE", "MAIN_AGREEMENT_GROUP", "TIME_PERIOD"}):
        if r["DATA_TYPE"] in INDICATORI_TENSIONE and r["MAIN_AGREEMENT_GROUP"] in COMPARTI:
            out.append({"mese": mese(r["TIME_PERIOD"]), "indicatore": INDICATORI_TENSIONE[r["DATA_TYPE"]],
                        "comparto": COMPARTI[r["MAIN_AGREEMENT_GROUP"]], "valore": float(r["OBS_VALUE"])})
    out.sort(key=lambda x: (x["indicatore"], x["comparto"], x["mese"]))
    if len({x["mese"] for x in out}) < 24:
        raise ValueError("Tensione contrattuale: meno di 24 mesi")
    if any(x["indicatore"] == "quota_in_attesa" and not 0 <= x["valore"] <= 100 for x in out):
        raise ValueError("Quota di dipendenti in attesa fuori da [0, 100]")
    return pa.Table.from_pylist(out, schema=SCHEMA_TENSIONE)


SCHEMA_OROS = pa.schema([
    ("trimestre", pa.date32()), ("destagionalizzato", pa.bool_()), ("settore", pa.string()),
    ("indice", pa.float64()), ("provvisorio", pa.bool_()),
])


def parse_oros(testo: str) -> pa.Table:
    out = []
    for r in righe(testo, {"ADJUSTMENT", "ECON_ACTIVITY_NACE_2007", "TIME_PERIOD"}):
        out.append({"trimestre": trimestre(r["TIME_PERIOD"]), "destagionalizzato": r["ADJUSTMENT"] == "Y",
                    "settore": r["ECON_ACTIVITY_NACE_2007"], "indice": float(r["OBS_VALUE"]),
                    "provvisorio": provvisorio(r)})
    out.sort(key=lambda x: (x["destagionalizzato"], x["settore"], x["trimestre"]))
    if len({x["trimestre"] for x in out}) < 20 or not all(30 < x["indice"] < 200 for x in out):
        raise ValueError("OROS: serie corta o indici non plausibili")
    return pa.Table.from_pylist(out, schema=SCHEMA_OROS)


SCHEMA_RACLI = pa.schema([
    ("anno", pa.int32()), ("statistica", pa.string()), ("sesso", pa.string()),
    ("territorio", pa.string()), ("settore", pa.string()), ("euro_ora", pa.float64()),
])


def parse_racli(testo: str) -> pa.Table:
    out = []
    for r in righe(testo, {"DATA_TYPE", "SEX", "REF_AREA", "ECON_ACTIVITY_NACE_2007", "TIME_PERIOD"}):
        if r["DATA_TYPE"] not in RACLI_STAT or r["SEX"] not in SESSO:
            continue
        # solo i totali delle altre dimensioni (età, titolo di studio, contratto...)
        altre = [r.get(k) for k in ("AGE", "TYPE_OF_CONTRACT", "FULL_PART_TIME", "EMPLOYESS_CLASS")]
        if any(v not in (None, "", "TOTAL", "9", "99") for v in altre):
            continue
        out.append({"anno": int(r["TIME_PERIOD"]), "statistica": RACLI_STAT[r["DATA_TYPE"]],
                    "sesso": SESSO[r["SEX"]], "territorio": r["REF_AREA"],
                    "settore": r["ECON_ACTIVITY_NACE_2007"], "euro_ora": float(r["OBS_VALUE"])})
    out.sort(key=lambda x: (x["anno"], x["territorio"], x["settore"], x["sesso"], x["statistica"]))
    if not out or not all(1 < x["euro_ora"] < 200 for x in out):
        raise ValueError("RACLI: nessun dato o valori non plausibili")
    chiavi = {(x["anno"], x["statistica"], x["sesso"], x["territorio"], x["settore"]) for x in out}
    if len(chiavi) != len(out):
        raise ValueError(f"RACLI: {len(out) - len(chiavi)} righe ripetute (dimensione non filtrata?)")
    return pa.Table.from_pylist(out, schema=SCHEMA_RACLI)


PARSER = {"contrattuali": parse_contrattuali, "tensione": parse_tensione, "oros": parse_oros,
          "racli": parse_racli, "racli_province": parse_racli}


def periodo(nome: str, t: pa.Table) -> str:
    if nome == "oros":
        u = max(t.column("trimestre").to_pylist())
        return f"{u.year}-T{(u.month - 1) // 3 + 1}"
    if nome.startswith("racli"):
        return str(max(t.column("anno").to_pylist()))
    return f"{max(t.column('mese').to_pylist()):%Y-%m}"


def archivia(nome: str, t: pa.Table, cartella: Path) -> Path | None:
    esistenti = sorted(p for p in cartella.glob(f"{nome}_*.parquet")
                       if p.stem[len(nome) + 1:][:1].isdigit())  # racli_2023, non racli_province_2023
    if esistenti and pq.read_table(esistenti[-1]).to_pylist() == t.to_pylist():
        log.info("%s invariato: niente da salvare", nome)
        return None
    cartella.mkdir(parents=True, exist_ok=True)
    path = cartella / f"{nome}_{periodo(nome, t)}.parquet"
    pq.write_table(t, path, compression="zstd", compression_level=9)
    log.info("Salvato %s (%d righe)", path.name, t.num_rows)
    return path


def storico(cartella: Path) -> Path | None:
    """Basi 2005, 2010 e 2015: si scaricano una volta sola."""
    path = cartella / "contrattuali_storico.parquet"
    if path.exists():
        return None
    tabelle = []
    for base, (flow, tipi) in STORICO.items():
        testo = scarica(flow, chiave_contrattuali(tipi), "2005-01")
        tabelle.append(parse_contrattuali(testo))
    t = pa.concat_tables(tabelle)
    cartella.mkdir(parents=True, exist_ok=True)
    pq.write_table(t, path, compression="zstd", compression_level=9)
    log.info("Salvato lo storico delle basi precedenti (%d righe)", t.num_rows)
    return path


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--solo", choices=[*FLUSSI, "storico"], help="un solo flusso")
    ap.add_argument("--uscita", type=Path, default=OUT_DIR, help="cartella di destinazione")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    # distanza dalla richiesta del NIC, fatta dal passo precedente del workflow
    _ultima_richiesta[0] = time.monotonic()
    errori = 0
    nomi = [args.solo] if args.solo else [*FLUSSI, "storico"]
    for nome in nomi:
        try:
            if nome == "storico":
                storico(args.uscita)
            else:
                f = FLUSSI[nome]
                archivia(nome, PARSER[nome](scarica(f["flow"], f["chiave"], f["inizio"])), args.uscita)
        except Exception as e:  # un flusso che non risponde non ferma gli altri
            errori += 1
            log.error("%s: %s: %s", nome, type(e).__name__, e)
    return 1 if errori else 0


if __name__ == "__main__":
    sys.exit(main())
