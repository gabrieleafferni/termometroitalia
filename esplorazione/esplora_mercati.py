"""Esplorazione: Brent, quotazioni dei raffinati e cambio euro/dollaro.

Scarica le fonti candidate e scrive un riassunto (righe, primo e ultimo giorno,
ultimi valori) in esplorazione/mercati_log.txt.
"""
import csv
import io
import time
import urllib.request
from pathlib import Path

OUT = Path("esplorazione")
UA = "termometroitalia/1.0 (+https://github.com/gabrieleafferni/termometroitalia)"
FONTI = {
    "fred_brent.csv": "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DCOILBRENTEU&cosd=2005-01-01",
    "fred_diesel_nyh.csv": "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DDFUELNYH&cosd=2005-01-01",
    "fred_benzina_nyh.csv": "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGASNYH&cosd=2005-01-01",
    "bce_usd_eur.csv": "https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?format=csvdata&startPeriod=2005-01-01",
    "eia_brent.xls": "https://www.eia.gov/dnav/pet/hist_xls/RBRTEd.xls",
}
log = []


def scrivi(msg):
    print(msg, flush=True)
    log.append(msg)
    (OUT / "mercati_log.txt").write_text("\n".join(log) + "\n", encoding="utf-8")


for nome, url in FONTI.items():
    t0 = time.time()
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=120) as r:
            body = r.read()
            ctype = r.headers.get("Content-Type")
        (OUT / nome).write_bytes(body)
        scrivi(f"{nome}: {r.status} {len(body)} B {time.time()-t0:.1f}s {ctype}")
        if nome.endswith(".csv"):
            righe = list(csv.reader(io.StringIO(body.decode("utf-8-sig", errors="replace"))))
            scrivi(f"   intestazione: {righe[0][:12]}")
            scrivi(f"   righe: {len(righe)-1}; prima: {righe[1][:12] if len(righe) > 1 else '-'}")
            for r_ in righe[-4:]:
                scrivi(f"   ... {r_[:12]}")
    except Exception as e:
        scrivi(f"{nome}: ERRORE {type(e).__name__}: {e}")
