"""Esplorazione per la sezione elezioni.

1. Il sito ufficiale dei sondaggi risponde da GitHub Actions? (lo scraper di
   #datiBeneComune dice che "tarpitta" gli IP dei runner GitHub)
2. Risultati ufficiali: politiche 2022 (Camera) ed europee 2024 da Eligendo/Viminale
3. Wikipedia: tabella dei sondaggi con campione e date di realizzazione
"""
import time
import urllib.request
from pathlib import Path

OUT = Path("esplorazione/elezioni")
OUT.mkdir(parents=True, exist_ok=True)
UA = "Mozilla/5.0 (termometroitalia; +https://github.com/gabrieleafferni/termometroitalia)"
FONTI = {
    "sondaggi_lista.html": "https://www.sondaggipoliticoelettorali.it/ListaSondaggi.aspx?st=SONDAGGI",
    "sondaggi_home.html": "https://www.sondaggipoliticoelettorali.it/Home.aspx?st=HOME",
    "eligendo_camera_2022.html": "https://elezionistorico.interno.gov.it/index.php?tpel=C&dtel=25/09/2022&tpa=I&tpe=I&lev0=0&levsut0=0&es0=S&ms=S",
    "eligendo_europee_2024.html": "https://elezionistorico.interno.gov.it/index.php?tpel=E&dtel=09/06/2024&tpa=I&tpe=I&lev0=0&levsut0=0&es0=S&ms=S",
    "dait_opendata.html": "https://dait.interno.gov.it/elezioni/open-data",
    "wikipedia_sondaggi.wiki": "https://en.wikipedia.org/w/index.php?title=Opinion_polling_for_the_next_Italian_general_election&action=raw",
    "wikipedia_sondaggi_it.wiki": "https://it.wikipedia.org/w/index.php?title=Sondaggi_elettorali_per_le_prossime_elezioni_politiche_in_Italia&action=raw",
}
log = []
for nome, url in FONTI.items():
    t0 = time.time()
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=40) as r:
            body = r.read()
        (OUT / nome).write_bytes(body)
        log.append(f"{nome}: {r.status} {len(body)} B {time.time()-t0:.1f}s")
    except Exception as e:
        log.append(f"{nome}: ERRORE dopo {time.time()-t0:.1f}s {type(e).__name__}: {e}")
    print(log[-1], flush=True)
(OUT / "log.txt").write_text("\n".join(log) + "\n", encoding="utf-8")
