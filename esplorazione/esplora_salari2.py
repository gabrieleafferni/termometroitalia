"""Esplorazione salari, secondo giro: prova dei moduli della pipeline.

Esegue gli stessi scarica() e parse() che userà la pipeline, ma scrive in
esplorazione/salari2/ (parquet e log), così da verificare chiavi SDMX e formati
prima di attivarli nel giro quotidiano. Richieste ISTAT: 8, una ogni 15 s.
"""

from __future__ import annotations

import logging
import sys
import traceback
from pathlib import Path

import pyarrow.parquet as pq

sys.path.insert(0, ".")
from pipeline.eurostat import ipca  # noqa: E402
from pipeline.internazionale import salari as inter  # noqa: E402
from pipeline.istat import retribuzioni as R  # noqa: E402

OUT = Path("esplorazione/salari2")


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s",
                        handlers=[logging.FileHandler(OUT / "log.txt", mode="w"), logging.StreamHandler()])
    log = logging.getLogger("esplora")
    for nome, f in R.FLUSSI.items():
        try:
            testo = R.scarica(f["flow"], f["chiave"], f["inizio"])
            (OUT / f"{nome}_testa.csv").write_text("\n".join(testo.splitlines()[:30]), encoding="utf-8")
            t = R.PARSER[nome](testo)
            pq.write_table(t, OUT / f"{nome}.parquet")
            log.info("OK %s: %d righe, periodo %s", nome, t.num_rows, R.periodo(nome, t))
            if nome == "racli_province":
                terr = sorted(set(t.column("territorio").to_pylist()))
                log.info("territori (%d): %s", len(terr), terr[:200])
        except Exception:
            log.error("ERRORE %s\n%s", nome, traceback.format_exc())
    try:
        R.storico(OUT)
        log.info("OK storico")
    except Exception:
        log.error("ERRORE storico\n%s", traceback.format_exc())
    try:
        testo = ipca.scarica()
        (OUT / "ipca_testa.csv").write_text("\n".join(testo.splitlines()[:5] + testo.splitlines()[-5:]), encoding="utf-8")
        t = ipca.parse(testo)
        pq.write_table(t, OUT / "ipca.parquet")
        log.info("OK ipca: %d mesi, ultimo %s", t.num_rows, max(t.column("mese").to_pylist()))
    except Exception:
        log.error("ERRORE ipca\n%s", traceback.format_exc())
    for fonte, url, parser in [("ocse", inter.URL_OCSE, inter.parse_ocse),
                               ("eurostat", inter.URL_EUROSTAT, inter.parse_eurostat)]:
        try:
            testo = inter.scarica(url)
            (OUT / f"{fonte}_testa.csv").write_text("\n".join(testo.splitlines()[:5]), encoding="utf-8")
            t = parser(testo)
            pq.write_table(t, OUT / f"{fonte}.parquet")
            log.info("OK %s: %d righe, ultimo anno %s", fonte, t.num_rows, max(t.column("anno").to_pylist()))
        except Exception:
            log.error("ERRORE %s\n%s", fonte, traceback.format_exc())
    return 0


if __name__ == "__main__":
    sys.exit(main())
