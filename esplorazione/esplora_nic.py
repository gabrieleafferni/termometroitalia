"""Esplorazione temporanea: dove sta il NIC ISTAT nell'API SDMX e com'è fatto.

Gira su GitHub Actions (il workspace di Claude non raggiunge ISTAT).
ISTAT blocca l'IP per 1-2 giorni oltre 5 richieste al minuto: tra una
richiesta e l'altra si aspettano 15 secondi, e il totale resta sotto le 12.
Ogni passo salva quello che trova, così anche un errore a metà lascia
materiale utile per il giro successivo.
"""

from __future__ import annotations

import csv
import io
import json
import re
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

BASE = "https://esploradati.istat.it/SDMXWS/rest"
OUT = Path("esplorazione")
UA = "termometroitalia/1.0 (+https://github.com/gabrieleafferni/termometroitalia)"
PAUSA = 15
MAX_RICHIESTE = 12

NS = {
    "mes": "http://www.sdmx.org/resources/sdmxml/schemas/v2_1/message",
    "str": "http://www.sdmx.org/resources/sdmxml/schemas/v2_1/structure",
    "com": "http://www.sdmx.org/resources/sdmxml/schemas/v2_1/common",
}
XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"
ACCEPT_STR = "application/vnd.sdmx.structure+xml;version=2.1"
ACCEPT_CSV = "application/vnd.sdmx.data+csv;version=1.0.0"

richieste = 0
log: list[str] = []


def scrivi_log(msg: str) -> None:
    print(msg, flush=True)
    log.append(msg)
    (OUT / "nic_log.txt").write_text("\n".join(log) + "\n", encoding="utf-8")


def get(url: str, accept: str, timeout: int = 300) -> tuple[int, bytes]:
    global richieste
    if richieste >= MAX_RICHIESTE:
        raise RuntimeError("limite di richieste dell'esplorazione raggiunto")
    if richieste > 0:
        time.sleep(PAUSA)
    richieste += 1
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            scrivi_log(f"[{richieste}] {r.status} {len(body):>10} B {time.time()-t0:5.1f}s {url}")
            return r.status, body
    except urllib.error.HTTPError as e:
        body = e.read()
        scrivi_log(f"[{richieste}] {e.code} {len(body):>10} B {time.time()-t0:5.1f}s {url}")
        return e.code, body
    except Exception as e:  # timeout, rete
        scrivi_log(f"[{richieste}] ERRORE {type(e).__name__}: {e} {url}")
        return 0, b""


def nome(el: ET.Element, lang: str) -> str:
    for n in el.findall("com:Name", NS):
        if n.get(XML_LANG) == lang:
            return (n.text or "").strip()
    n = el.find("com:Name", NS)
    return (n.text or "").strip() if n is not None else ""


def elenco_dataflow() -> list[dict]:
    status, body = get(f"{BASE}/dataflow/IT1", ACCEPT_STR, timeout=600)
    if status != 200:
        (OUT / "istat_dataflow_errore.txt").write_bytes(body[:20000])
        return []
    root = ET.fromstring(body)
    righe = []
    for df in root.iter(f"{{{NS['str']}}}Dataflow"):
        ref = df.find("str:Structure/Ref", NS)
        righe.append({
            "id": df.get("id"),
            "version": df.get("version"),
            "nome_it": nome(df, "it"),
            "nome_en": nome(df, "en"),
            "dsd_id": ref.get("id") if ref is not None else "",
            "dsd_version": ref.get("version") if ref is not None else "",
            "dsd_agency": ref.get("agencyID") if ref is not None else "",
        })
    with open(OUT / "istat_dataflows.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(righe[0].keys()))
        w.writeheader()
        w.writerows(righe)
    scrivi_log(f"dataflow totali: {len(righe)}")
    return righe


def punteggio(df: dict) -> int:
    """Più alto = più probabile che sia il NIC mensile nazionale."""
    t = f"{df['nome_it']} {df['nome_en']} {df['id']} {df['dsd_id']}".lower()
    s = 0
    if "intera collettivit" in t or re.search(r"\bnic\b", t) or "nic" in df["dsd_id"].lower():
        s += 10
    if "mensil" in t or "monthly" in t:
        s += 3
    if "2015" in t or "2025" in t or "dal 2016" in t or "from 2016" in t:
        s += 2
    if "capoluog" in t or "region" in t or "territor" in t or "ripartiz" in t:
        s -= 3
    if "pesi" in t or "weight" in t or "contribut" in t:
        s -= 4
    return s


def struttura(df: dict) -> dict:
    """Dimensioni (in ordine) con i nomi dei codici, dalla DSD."""
    url = f"{BASE}/datastructure/{df['dsd_agency'] or 'IT1'}/{df['dsd_id']}/{df['dsd_version'] or 'latest'}?references=children"
    status, body = get(url, ACCEPT_STR, timeout=600)
    if status != 200:
        return {}
    root = ET.fromstring(body)
    codelist = {}
    for cl in root.iter(f"{{{NS['str']}}}Codelist"):
        codelist[cl.get("id")] = {c.get("id"): nome(c, "it") for c in cl.findall("str:Code", NS)}
    dims = []
    for d in root.iter(f"{{{NS['str']}}}Dimension"):
        ref = d.find("str:LocalRepresentation/str:Enumeration/Ref", NS)
        dims.append({
            "id": d.get("id"),
            "position": int(d.get("position") or 0),
            "codelist": ref.get("id") if ref is not None else None,
        })
    dims.sort(key=lambda x: x["position"])
    return {"dimensioni": dims, "codelist": codelist}


def chiavi_serie(df: dict) -> list[dict]:
    url = f"{BASE}/data/{df['id']}/all?lastNObservations=1"
    status, body = get(url, ACCEPT_CSV, timeout=600)
    if status != 200 or not body:
        # alcuni servizi non accettano lastNObservations: un solo mese recente
        status, body = get(f"{BASE}/data/{df['id']}/all?startPeriod=2026-06", ACCEPT_CSV, timeout=600)
    if status != 200 or not body:
        (OUT / f"nic_{df['id']}_chiavi_errore.txt").write_bytes(body[:20000])
        return []
    testo = body.decode("utf-8-sig", errors="replace")
    (OUT / f"nic_{df['id']}_ultime_oss_head.csv").write_text("\n".join(testo.splitlines()[:200]) + "\n", encoding="utf-8")
    return list(csv.DictReader(io.StringIO(testo)))


def riassunto(df: dict, strut: dict, righe: list[dict]) -> dict:
    dims = [d["id"] for d in strut.get("dimensioni", [])]
    valori = {}
    for col in (righe[0].keys() if righe else []):
        distinti = sorted({r[col] for r in righe})
        valori[col] = distinti[:80] + ([f"... altri {len(distinti)-80}"] if len(distinti) > 80 else [])
    nomi = {}
    for d in strut.get("dimensioni", []):
        cl = strut["codelist"].get(d["codelist"] or "", {})
        usati = set(valori.get(d["id"], [])) if valori else set(cl)
        nomi[d["id"]] = {c: cl.get(c, "") for c in sorted(usati) if c in cl}
    return {
        "dataflow": df,
        "ordine_dimensioni": dims,
        "n_serie": len(righe),
        "valori_osservati": valori,
        "nomi_codici": nomi,
    }


def scegli_chiave(strut: dict, valori: dict) -> str | None:
    """Chiave parziale: mensile, Italia, indice generale; il resto libero."""
    parti = []
    for d in strut.get("dimensioni", []):
        did = d["id"]
        cl = strut["codelist"].get(d["codelist"] or "", {})
        osservati = [v for v in valori.get(did, []) if not v.startswith("...")]
        scelta = ""
        if did == "FREQ" and "M" in osservati:
            scelta = "M"
        elif did == "REF_AREA" and "IT" in osservati:
            scelta = "IT"
        else:
            # la dimensione dei prodotti: un codice "00" o un nome "indice generale"
            gen = [c for c in osservati if c == "00" or "indice generale" in cl.get(c, "").lower()]
            if gen and len(osservati) > 5:
                scelta = gen[0]
        parti.append(scelta)
    return ".".join(parti) if parti else None


def eurostat_hicp() -> None:
    """Controllo indipendente: IPCA (HICP) Italia da Eurostat, una sola richiesta."""
    url = ("https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1/data/prc_hicp_midx/"
           "M..CP00.IT?format=SDMX-CSV&startPeriod=2005-01")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            body = r.read()
        (OUT / "eurostat_hicp_it.csv").write_bytes(body)
        scrivi_log(f"eurostat HICP: {len(body)} B")
    except Exception as e:
        scrivi_log(f"eurostat HICP ERRORE {e}")


def main() -> int:
    OUT.mkdir(exist_ok=True)
    eurostat_hicp()
    flussi = elenco_dataflow()
    if not flussi:
        return 0
    candidati = sorted((f for f in flussi if punteggio(f) >= 10), key=punteggio, reverse=True)
    with open(OUT / "nic_candidati.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(flussi[0].keys()) + ["punteggio"])
        w.writeheader()
        for c in candidati:
            w.writerow({**c, "punteggio": punteggio(c)})
    scrivi_log(f"candidati NIC: {len(candidati)}")
    for c in candidati[:15]:
        scrivi_log(f"  {punteggio(c):>3} {c['id']} | {c['nome_it']}")

    # Al massimo 3 candidati: struttura + chiavi (2 richieste ciascuno), poi i dati.
    riassunti = []
    for c in candidati[:3]:
        try:
            strut = struttura(c)
            righe = chiavi_serie(c)
            r = riassunto(c, strut, righe)
            r["chiave_proposta"] = scegli_chiave(strut, r["valori_osservati"])
            riassunti.append((c, strut, r))
            (OUT / f"nic_{c['id']}_riassunto.json").write_text(json.dumps(r, ensure_ascii=False, indent=1), encoding="utf-8")
        except Exception as e:
            scrivi_log(f"candidato {c['id']} ERRORE {type(e).__name__}: {e}")

    # Dati dal 2005 per il primo candidato con una chiave plausibile.
    for c, strut, r in riassunti:
        chiave = r.get("chiave_proposta")
        if not chiave or chiave.replace(".", "") == "":
            continue
        try:
            status, body = get(f"{BASE}/data/{c['id']}/{chiave}?startPeriod=2005-01", ACCEPT_CSV, timeout=600)
            if status == 200 and body:
                (OUT / f"nic_{c['id']}_dati.csv").write_bytes(body)
                break
        except Exception as e:
            scrivi_log(f"dati {c['id']} ERRORE {type(e).__name__}: {e}")
    scrivi_log(f"richieste ISTAT usate: {richieste}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
