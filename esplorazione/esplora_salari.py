"""Esplorazione fonti per la sezione salari reali.

ISTAT (massimo 5 richieste al minuto: qui una ogni 15 s, al massimo 16 in tutto):
  - struttura (DSD con codelist) dei dataflow sui salari;
  - dati: retribuzioni contrattuali per settore (basi 2021, 2015, 2010, 2005),
    per contratto (base 2021), tensione contrattuale (contratti scaduti),
    retribuzioni di fatto per ULA (OROS, trimestrali), retribuzioni orarie RACLI.
OCSE: salari medi annui (Average annual wages), tutti i paesi, dal 1990.
Eurostat: salario medio per dipendente a tempo pieno equivalente (nama_10_fte).

Tutto finisce in esplorazione/salari/ con un log.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

OUT = Path("esplorazione/salari")
UA = "termometroitalia/1.0 (+https://github.com/gabrieleafferni/termometroitalia)"
ISTAT = "https://esploradati.istat.it/SDMXWS/rest"
ACCEPT_STR = "application/vnd.sdmx.structure+xml;version=2.1"
ACCEPT_CSV = "application/vnd.sdmx.data+csv;version=1.0.0"
NS = {
    "mes": "http://www.sdmx.org/resources/sdmxml/schemas/v2_1/message",
    "str": "http://www.sdmx.org/resources/sdmxml/schemas/v2_1/structure",
    "com": "http://www.sdmx.org/resources/sdmxml/schemas/v2_1/common",
}
XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"

DSD = ["DCSC_RETRATECO1", "DCSC_RETRCONTR1C", "DCSC_RETRCONTR1T", "DCSC_RETRULAOROS_1", "DCSC_RACLI"]
# (dataflow, dsd, frequenza, inizio, nome file, dimensioni fissate)
DATI = [
    ("155_358_DF_DCSC_RETRATECO1_7", "DCSC_RETRATECO1", "M", "2019-01", "contrattuali_ateco_b2021", {}),
    ("149_319_DF_DCSC_RETRCONTR1T_4", "DCSC_RETRCONTR1T", "M", "2019-01", "tensione_b2021", {}),
    ("155_374_DF_DCSC_RETRULAOROS_1_4", "DCSC_RETRULAOROS_1", "Q", "2015-01", "oros_retribuzioni_ula_b2021", {}),
    ("155_318_DF_DCSC_RETRCONTR1C_4", "DCSC_RETRCONTR1C", "M", "2021-01", "contrattuali_ccnl_b2021", {}),
    ("155_358_DF_DCSC_RETRATECO1_1", "DCSC_RETRATECO1", "M", "2005-01", "contrattuali_ateco_b2015", {}),
    ("155_358_DF_DCSC_RETRATECO1_3", "DCSC_RETRATECO1", "M", "1990-01", "contrattuali_ateco_b2010", {}),
    ("155_358_DF_DCSC_RETRATECO1_5", "DCSC_RETRATECO1", "M", "1980-01", "contrattuali_ateco_b2005", {}),
    ("533_957_DF_DCSC_RACLI_17", "DCSC_RACLI", "A", "2014", "racli_sesso_2digit", {}),
]

OCSE = ("https://sdmx.oecd.org/public/rest/data/OECD.ELS.SAE,DSD_EARNINGS@AV_AN_WAGE,1.0/all"
        "?startPeriod=1990&dimensionAtObservation=AllDimensions&format=csvfilewithlabels")
EUROSTAT = ("https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/nama_10_fte"
            "?geo=IT&geo=DE&geo=FR&geo=ES&geo=EU27_2020&lang=EN")

richieste_istat = 0
righe_log: list[str] = []


def log(msg: str) -> None:
    print(msg, flush=True)
    righe_log.append(msg)
    (OUT / "log.txt").write_text("\n".join(righe_log) + "\n", encoding="utf-8")


def get(url: str, accept: str | None = None, timeout: int = 300, istat: bool = False) -> tuple[int, bytes]:
    global richieste_istat
    if istat:
        if richieste_istat >= 16:
            log(f"SALTATO (limite richieste ISTAT): {url}")
            return 0, b""
        if richieste_istat:
            time.sleep(15)
        richieste_istat += 1
    h = {"User-Agent": UA}
    if accept:
        h["Accept"] = accept
    t0 = time.time()
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
            body = r.read()
            log(f"{r.status} {len(body):>10} B {time.time() - t0:6.1f}s {url}")
            return r.status, body
    except urllib.error.HTTPError as e:
        body = e.read()
        log(f"{e.code} {len(body):>10} B {time.time() - t0:6.1f}s {url}")
        return e.code, body
    except Exception as e:  # timeout, connessione
        log(f"ERRORE {type(e).__name__}: {e} ({time.time() - t0:.1f}s) {url}")
        return 0, b""


def nome(el) -> str:
    nomi = {n.get(XML_LANG): (n.text or "") for n in el.findall("com:Name", NS)}
    return nomi.get("it") or nomi.get("en") or next(iter(nomi.values()), "")


def struttura(dsd: str) -> dict:
    status, body = get(f"{ISTAT}/datastructure/IT1/{dsd}/1.0?references=children", ACCEPT_STR, istat=True)
    if status != 200:
        (OUT / f"dsd_{dsd}_errore.txt").write_bytes(body[:20000])
        return {}
    root = ET.fromstring(body)
    codelist = {}
    for cl in root.iter(f"{{{NS['str']}}}Codelist"):
        codelist[cl.get("id")] = {c.get("id"): nome(c) for c in cl.findall("str:Code", NS)}
    dims = []
    for dl in root.iter(f"{{{NS['str']}}}DimensionList"):
        for d in list(dl):
            if not d.tag.endswith("Dimension"):
                continue
            ref = d.find("str:LocalRepresentation/str:Enumeration/Ref", NS)
            dims.append({"pos": int(d.get("position") or 0), "id": d.get("id"),
                         "codelist": ref.get("id") if ref is not None else None})
    dims.sort(key=lambda d: d["pos"])
    out = {"dsd": dsd, "dimensioni": dims,
           "codelist": {d["codelist"]: codelist.get(d["codelist"], {}) for d in dims if d["codelist"]}}
    (OUT / f"dsd_{dsd}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"  {dsd}: " + ", ".join(f"{d['id']}({len(out['codelist'].get(d['codelist'], {}))})" for d in dims))
    return out


def chiave(dims: list[dict], freq: str, fisse: dict) -> str:
    valori = []
    for d in dims:
        if d["id"] in fisse:
            valori.append(fisse[d["id"]])
        elif d["id"] == "FREQ":
            valori.append(freq)
        else:
            valori.append("")
    return ".".join(valori)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    strutture = {d: struttura(d) for d in DSD}
    for flow, dsd, freq, inizio, nomefile, fisse in DATI:
        dims = strutture.get(dsd, {}).get("dimensioni")
        if not dims:
            log(f"{nomefile}: DSD mancante, salto")
            continue
        k = chiave(dims, freq, fisse)
        status, body = get(f"{ISTAT}/data/{flow}/{k}?startPeriod={inizio}", ACCEPT_CSV, istat=True)
        if status == 200 and body.strip():
            (OUT / f"{nomefile}.csv").write_bytes(body)
            righe = body.decode("utf-8-sig", errors="replace").splitlines()
            log(f"  {nomefile}: {len(righe) - 1} righe; colonne: {righe[0][:300]}")
        else:
            (OUT / f"{nomefile}_errore.txt").write_bytes(body[:20000])
    status, body = get(OCSE, timeout=300)
    if status == 200:
        (OUT / "ocse_av_an_wage.csv").write_bytes(body)
    else:
        (OUT / "ocse_errore.txt").write_bytes(body[:20000])
    status, body = get(EUROSTAT, timeout=180)
    if status == 200:
        (OUT / "eurostat_nama_10_fte.json").write_bytes(body)
    else:
        (OUT / "eurostat_errore.txt").write_bytes(body[:20000])
    log(f"richieste ISTAT usate: {richieste_istat}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
