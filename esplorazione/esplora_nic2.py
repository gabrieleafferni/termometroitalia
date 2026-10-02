"""Esplorazione NIC, secondo giro: dati mirati invece di "all".

Dal primo giro: le richieste con chiave "all" vanno in timeout (troppe serie).
Qui si chiede solo Italia, dati mensili, numeri indice, indice generale, per
tutte le basi (1995, 2010, 2015, 2025). Massimo 8 richieste, 15 s di pausa.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

BASE = "https://esploradati.istat.it/SDMXWS/rest"
OUT = Path("esplorazione")
UA = "termometroitalia/1.0 (+https://github.com/gabrieleafferni/termometroitalia)"
NS = {
    "str": "http://www.sdmx.org/resources/sdmxml/schemas/v2_1/structure",
}
ACCEPT_STR = "application/vnd.sdmx.structure+xml;version=2.1"
ACCEPT_CSV = "application/vnd.sdmx.data+csv;version=1.0.0"

# DATA_TYPE: indice NIC, dati mensili, nelle quattro basi
DT = {"1": "base 1995", "9": "base 2010", "39": "base 2015", "85": "base 2025"}
MEASURE_INDICE = "4"  # numeri indici
richieste = 0
log: list[str] = []


def scrivi_log(msg: str) -> None:
    print(msg, flush=True)
    log.append(msg)
    (OUT / "nic2_log.txt").write_text("\n".join(log) + "\n", encoding="utf-8")


def get(url: str, accept: str, timeout: int = 300) -> tuple[int, bytes]:
    global richieste
    if richieste >= 8:
        raise RuntimeError("limite di richieste raggiunto")
    if richieste:
        time.sleep(15)
    richieste += 1
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            scrivi_log(f"[{richieste}] {r.status} {len(body):>9} B {time.time()-t0:5.1f}s {url}")
            return r.status, body
    except urllib.error.HTTPError as e:
        body = e.read()
        scrivi_log(f"[{richieste}] {e.code} {len(body):>9} B {time.time()-t0:5.1f}s {url}")
        return e.code, body
    except Exception as e:
        scrivi_log(f"[{richieste}] ERRORE {type(e).__name__}: {e} {url}")
        return 0, b""


def dimensioni(dsd: str) -> list[str]:
    status, body = get(f"{BASE}/datastructure/IT1/{dsd}/1.0", ACCEPT_STR)
    if status != 200:
        return []
    root = ET.fromstring(body)
    dims = []
    for dl in root.iter(f"{{{NS['str']}}}DimensionList"):
        for d in dl.findall("str:Dimension", NS):
            ref = d.find("str:LocalRepresentation/str:Enumeration/Ref", NS)
            dims.append((int(d.get("position") or 0), d.get("id"), ref.get("id") if ref is not None else None))
    dims.sort()
    (OUT / f"nic2_{dsd}_dimensioni.json").write_text(json.dumps(dims, indent=1), encoding="utf-8")
    scrivi_log(f"{dsd}: {[d[1] for d in dims]}")
    return [d[1] for d in dims]


def chiave(dims: list[str], data_type: str) -> str:
    valori = []
    for d in dims:
        if d == "FREQ":
            valori.append("M")
        elif d == "REF_AREA":
            valori.append("IT")
        elif d == "DATA_TYPE":
            valori.append(data_type)
        elif d == "MEASURE":
            valori.append(MEASURE_INDICE)
        elif "COICOP" in d.upper():
            valori.append("00")
        else:
            valori.append("")
    return ".".join(valori)


def scarica(flow: str, key: str, start: str, nome: str) -> bool:
    status, body = get(f"{BASE}/data/{flow}/{key}?startPeriod={start}", ACCEPT_CSV)
    if status == 200 and body.strip():
        (OUT / f"nic2_{nome}.csv").write_bytes(body)
        righe = body.decode("utf-8-sig", errors="replace").splitlines()
        scrivi_log(f"   {nome}: {len(righe) - 1} righe; prima: {righe[1][:160] if len(righe) > 1 else '-'}")
        return len(righe) > 1
    (OUT / f"nic2_{nome}_errore.txt").write_bytes(body[:20000])
    return False


def main() -> int:
    OUT.mkdir(exist_ok=True)
    dims25 = dimensioni("DCSP_NIC1B2025")
    if not dims25:
        dims25 = ["FREQ", "REF_AREA", "DATA_TYPE", "MEASURE", "COICOP_REV_ISTAT"]
        scrivi_log("DSD 2025 non letta: uso l'ordine della DSD 2010")
    tutte = "+".join(DT)
    # 1. tutte le basi in un colpo (dataflow "tutte le basi")
    ok = scarica("167_745_DF_DCSP_NIC1B2025_6", chiave(dims25, tutte), "1996-01", "tutte_le_basi")
    # 2. in ogni caso la base 2025 dal dataflow principale (è quello che si aggiorna ogni mese)
    scarica("167_745", chiave(dims25, "85"), "2026-01", "base2025")
    if not ok:
        # 3. ripiego: le basi precedenti dai rispettivi dataflow (DSD con lo stesso ordine del 2010)
        vecchie = ["FREQ", "REF_AREA", "DATA_TYPE", "MEASURE", "COICOP_REV_ISTAT"]
        scarica("167_744", chiave(vecchie, "39"), "2015-01", "base2015")
        scarica("167_33", chiave(vecchie, "9"), "2010-01", "base2010")
        scarica("140_180", chiave(vecchie, "1"), "1996-01", "base1995")
    scrivi_log(f"richieste ISTAT usate: {richieste}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
