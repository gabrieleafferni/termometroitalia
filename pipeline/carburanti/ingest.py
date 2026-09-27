"""Ingestion giornaliera dei prezzi carburanti (MIMIT - Osservaprezzi Carburanti).

Scarica i due open data giornalieri del MIMIT:
  - prezzo_alle_8.csv               prezzi praticati per impianto e carburante
  - anagrafica_impianti_attivi.csv  anagrafica e coordinate degli impianti

e li salva nel "data lake" del repo:

  data/raw/carburanti/prezzi/AAAA/prezzi_AAAA-MM-GG.parquet
      snapshot completo e immutabile dei prezzi (uno per data di estrazione)

  data/raw/carburanti/impianti/AAAA/impianti_AAAA-MM-GG.parquet
      change log dell'anagrafica (SCD tipo 2): solo impianti nuovi, modificati
      o chiusi rispetto allo stato precedente. L'anagrafica cambia di poche
      righe al giorno, quindi salvarla intera ogni giorno sarebbe uno spreco.

Lo script è idempotente: la data di riferimento è quella dichiarata nel file
("Estrazione del AAAA-MM-GG"), e una data già archiviata non viene riscritta.

Fonte primaria: MIMIT. Fallback: l'archivio pubblico LucaDDDD/benzina-data su
GitHub, che conserva le stesse pubblicazioni (usato anche per ricostruire lo
storico con --backfill-from).

Uso:
  python -m pipeline.carburanti.ingest                      # oggi
  python -m pipeline.carburanti.ingest --source mirror      # oggi, dal mirror
  python -m pipeline.carburanti.ingest --backfill-from 2026-07-28
"""

from __future__ import annotations

import argparse
import datetime as dt
import gzip
import io
import json
import logging
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = ROOT / "data" / "raw" / "carburanti"
PREZZI_DIR = RAW_DIR / "prezzi"
IMPIANTI_DIR = RAW_DIR / "impianti"
STATUS_FILE = RAW_DIR / "ultimo_aggiornamento.json"

MIMIT_URLS = {
    "prezzi": "https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv",
    "impianti": "https://www.mimit.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv",
}
MIRROR_BASE = "https://raw.githubusercontent.com/LucaDDDD/benzina-data/main/data"
MIRROR_NAMES = {"prezzi": "prezzo_alle_8", "impianti": "anagrafica_impianti_attivi"}

# Soglie minime di sanità: sotto queste la pubblicazione è considerata rotta
# e non viene archiviata (meglio un giorno mancante che un giorno sbagliato).
MIN_RIGHE_PREZZI = 50_000
MIN_RIGHE_IMPIANTI = 15_000

# Riquadro geografico che contiene l'Italia (Lampedusa e Vetta d'Italia comprese)
LAT_RANGE = (35.0, 47.2)
LON_RANGE = (6.5, 18.6)

log = logging.getLogger("ingest.carburanti")

PREZZI_SCHEMA = pa.schema(
    [
        ("id_impianto", pa.int32()),
        ("carburante", pa.string()),
        ("prezzo", pa.float64()),
        ("self", pa.bool_()),
        ("dt_comunicazione", pa.timestamp("s")),
    ]
)

IMPIANTI_COLS = ["id_impianto", "bandiera", "tipo", "nome", "comune", "provincia", "lat", "lon"]
IMPIANTI_SCHEMA = pa.schema(
    [
        ("id_impianto", pa.int32()),
        ("bandiera", pa.string()),
        ("tipo", pa.string()),
        ("nome", pa.string()),
        ("comune", pa.string()),
        ("provincia", pa.string()),
        ("lat", pa.float64()),
        ("lon", pa.float64()),
        ("valido_dal", pa.date32()),
        ("azione", pa.string()),  # inserimento | modifica | chiusura
    ]
)


# --------------------------------------------------------------------------- #
# Download
# --------------------------------------------------------------------------- #
def _http_get(url: str, retries: int = 4, timeout: int = 60) -> bytes:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "termometroitalia/1.0 (+https://github.com/gabrieleafferni/termometroitalia)"},
    )
    last_err: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except (urllib.error.URLError, TimeoutError, ConnectionError) as err:
            last_err = err
            if attempt == retries:
                log.warning("GET %s fallito (tentativo %d/%d): %s", url, attempt, retries, err)
                break
            wait = 5 * attempt
            log.warning("GET %s fallito (tentativo %d/%d): %s. Riprovo tra %ds", url, attempt, retries, err, wait)
            time.sleep(wait)
    raise RuntimeError(f"Download fallito dopo {retries} tentativi: {url}") from last_err


def _decode(payload: bytes) -> str:
    if payload[:2] == b"\x1f\x8b":
        payload = gzip.decompress(payload)
    for enc in ("utf-8", "cp1252"):
        try:
            return payload.decode(enc)
        except UnicodeDecodeError:
            continue
    return payload.decode("utf-8", errors="replace")


def fetch_mimit() -> dict[str, str]:
    return {k: _decode(_http_get(u)) for k, u in MIMIT_URLS.items()}


def mirror_url(kind: str, day: dt.date) -> str:
    return f"{MIRROR_BASE}/{day:%Y}/{day:%m}/{MIRROR_NAMES[kind]}-{day:%Y%m%d}.csv.gz"


def fetch_mirror(day: dt.date) -> dict[str, str]:
    return {k: _decode(_http_get(mirror_url(k, day))) for k in MIRROR_NAMES}


def mirror_last_date() -> dt.date:
    meta = json.loads(_http_get(f"{MIRROR_BASE}/last_update.json"))
    return dt.date.fromisoformat(meta["ultima_estrazione"])


# --------------------------------------------------------------------------- #
# Parsing (robusto: il separatore "|" compare a volte dentro i nomi impianto)
# --------------------------------------------------------------------------- #
_ESTRAZIONE_RE = re.compile(r"Estrazione del (\d{4}-\d{2}-\d{2})")


def data_estrazione(text: str) -> dt.date:
    first = text.lstrip("﻿").split("\n", 1)[0]
    m = _ESTRAZIONE_RE.search(first)
    if not m:
        raise ValueError(f"Intestazione inattesa: {first[:80]!r}")
    return dt.date.fromisoformat(m.group(1))


def _righe(text: str) -> list[str]:
    lines = text.lstrip("﻿").splitlines()
    # riga 1: "Estrazione del ...", riga 2: intestazione colonne
    return [l for l in lines[2:] if l.strip()]


def parse_prezzi(text: str) -> tuple[pa.Table, int]:
    cols: dict[str, list] = {n: [] for n in PREZZI_SCHEMA.names}
    scartate = 0
    for line in _righe(text):
        f = line.split("|")
        if len(f) != 5:
            scartate += 1
            continue
        try:
            riga = (
                int(f[0]),
                f[1].strip(),
                float(f[2].replace(",", ".")),
                f[3].strip() == "1",
                dt.datetime.strptime(f[4].strip(), "%d/%m/%Y %H:%M:%S"),
            )
        except ValueError:
            scartate += 1
            continue
        for nome, valore in zip(PREZZI_SCHEMA.names, riga):
            cols[nome].append(valore)
    return pa.table(cols, schema=PREZZI_SCHEMA), scartate


def _coord(x: str) -> float | None:
    x = x.strip().replace(",", ".")
    if x in ("", "NULL", "null"):
        return None
    try:
        return round(float(x), 5)
    except ValueError:
        return None


def parse_impianti(text: str) -> tuple[list[dict], int]:
    """Restituisce le righe dell'anagrafica.

    Il campo Gestore viene scartato di proposito: può contenere nomi di persone
    fisiche e non serve all'analisi. Anche l'indirizzo viene scartato.
    """
    out, scartate = [], 0
    for line in _righe(text):
        f = line.split("|")
        if len(f) < 10:
            scartate += 1
            continue
        try:
            id_imp = int(f[0])
        except ValueError:
            scartate += 1
            continue
        # prime 4 colonne fisse da sinistra, ultime 4 fisse da destra;
        # in mezzo Nome Impianto + Indirizzo (il nome può contenere "|")
        comune, prov, lat, lon = f[-4:]
        mezzo = f[4:-4]
        nome = " ".join("|".join(mezzo[:-1]).split())
        lat_f, lon_f = _coord(lat), _coord(lon)
        if lat_f is not None and not (LAT_RANGE[0] <= lat_f <= LAT_RANGE[1]):
            lat_f = None
        if lon_f is not None and not (LON_RANGE[0] <= lon_f <= LON_RANGE[1]):
            lon_f = None
        if lat_f is None or lon_f is None:
            lat_f = lon_f = None
        out.append(
            {
                "id_impianto": id_imp,
                "bandiera": " ".join(f[2].split()) or None,
                "tipo": f[3].strip() or None,
                "nome": nome or None,
                "comune": " ".join(comune.split()).upper() or None,
                "provincia": prov.strip().upper() or None,
                "lat": lat_f,
                "lon": lon_f,
            }
        )
    # alcuni file contengono id duplicati: tengo l'ultima occorrenza
    dedup = {r["id_impianto"]: r for r in out}
    return list(dedup.values()), scartate


# --------------------------------------------------------------------------- #
# Scrittura nel data lake
# --------------------------------------------------------------------------- #
def prezzi_path(day: dt.date) -> Path:
    return PREZZI_DIR / f"{day:%Y}" / f"prezzi_{day:%Y-%m-%d}.parquet"


def impianti_path(day: dt.date) -> Path:
    return IMPIANTI_DIR / f"{day:%Y}" / f"impianti_{day:%Y-%m-%d}.parquet"


def stato_impianti(fino_a: dt.date | None = None) -> dict[int, dict]:
    """Ricostruisce lo stato attuale dell'anagrafica rigiocando il change log."""
    files = sorted(IMPIANTI_DIR.glob("*/impianti_*.parquet"))
    if fino_a:
        files = [p for p in files if p.stem.split("_")[1] <= fino_a.isoformat()]
    if not files:
        return {}
    con = duckdb.connect()
    rows = con.execute(
        f"""
        select * exclude (rn) from (
          select *, row_number() over (partition by id_impianto order by valido_dal desc) rn
          from read_parquet({[str(p) for p in files]})
        ) where rn = 1 and azione <> 'chiusura'
        """
    ).fetch_arrow_table().to_pylist()
    return {r["id_impianto"]: {c: r[c] for c in IMPIANTI_COLS} for r in rows}


def ultima_data_impianti() -> dt.date | None:
    files = sorted(IMPIANTI_DIR.glob("*/impianti_*.parquet"))
    return dt.date.fromisoformat(files[-1].stem.split("_")[1]) if files else None


def scrivi_prezzi(day: dt.date, table: pa.Table) -> Path:
    path = prezzi_path(day)
    path.parent.mkdir(parents=True, exist_ok=True)
    table = table.sort_by([("id_impianto", "ascending"), ("carburante", "ascending"), ("self", "ascending")])
    pq.write_table(table, path, compression="zstd", compression_level=9)
    return path


def scrivi_change_log(day: dt.date, nuovi: list[dict]) -> tuple[Path | None, dict[str, int]]:
    ultima = ultima_data_impianti()
    if ultima and day <= ultima:
        log.info("Anagrafica del %s già nel change log (ultima: %s): salto", day, ultima)
        return None, {}
    prima = stato_impianti()
    adesso = {r["id_impianto"]: r for r in nuovi}
    cambi: list[dict] = []
    conteggi = {"inserimento": 0, "modifica": 0, "chiusura": 0}
    for id_imp, r in adesso.items():
        vecchio = prima.get(id_imp)
        if vecchio is None:
            cambi.append({**r, "valido_dal": day, "azione": "inserimento"})
            conteggi["inserimento"] += 1
        elif any(vecchio[c] != r[c] for c in IMPIANTI_COLS[1:]):
            cambi.append({**r, "valido_dal": day, "azione": "modifica"})
            conteggi["modifica"] += 1
    for id_imp, r in prima.items():
        if id_imp not in adesso:
            cambi.append({**r, "valido_dal": day, "azione": "chiusura"})
            conteggi["chiusura"] += 1
    path = impianti_path(day)
    path.parent.mkdir(parents=True, exist_ok=True)
    # anche a zero modifiche scrivo il file: certifica che il giorno è stato processato
    pq.write_table(pa.Table.from_pylist(cambi, schema=IMPIANTI_SCHEMA), path, compression="zstd", compression_level=9)
    return path, conteggi


def aggiorna_stato(info: dict) -> None:
    stato = {}
    if STATUS_FILE.exists():
        stato = json.loads(STATUS_FILE.read_text())
    if stato.get("data_estrazione", "") > info["data_estrazione"]:
        return  # un backfill non deve sovrascrivere lo stato più recente
    STATUS_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATUS_FILE.write_text(json.dumps(info, indent=2, ensure_ascii=False) + "\n")


# --------------------------------------------------------------------------- #
# Orchestrazione
# --------------------------------------------------------------------------- #
def archivia(testi: dict[str, str], fonte: str, force: bool = False) -> dt.date:
    day_p = data_estrazione(testi["prezzi"])
    day_i = data_estrazione(testi["impianti"])
    if day_p != day_i:
        log.warning("Date di estrazione diverse: prezzi %s, impianti %s", day_p, day_i)

    prezzi, scartate_p = parse_prezzi(testi["prezzi"])
    impianti, scartate_i = parse_impianti(testi["impianti"])
    if prezzi.num_rows < MIN_RIGHE_PREZZI:
        raise ValueError(f"Solo {prezzi.num_rows} righe di prezzi il {day_p}: file sospetto, non archiviato")
    if len(impianti) < MIN_RIGHE_IMPIANTI:
        raise ValueError(f"Solo {len(impianti)} impianti il {day_i}: file sospetto, non archiviato")

    if prezzi_path(day_p).exists() and not force:
        log.info("Prezzi del %s già archiviati: salto", day_p)
    else:
        path = scrivi_prezzi(day_p, prezzi)
        log.info("Prezzi %s: %d righe (%d scartate) -> %s", day_p, prezzi.num_rows, scartate_p, path.relative_to(ROOT))

    path_i, conteggi = scrivi_change_log(day_i, impianti)
    if path_i:
        log.info("Impianti %s: %d attivi (%d scartati), variazioni %s", day_i, len(impianti), scartate_i, conteggi)

    aggiorna_stato(
        {
            "data_estrazione": day_p.isoformat(),
            "fonte": fonte,
            "righe_prezzi": prezzi.num_rows,
            "impianti_attivi": len(impianti),
            "scaricato_il": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        }
    )
    return day_p


def run_oggi(source: str, force: bool) -> None:
    if source in ("auto", "mimit"):
        try:
            archivia(fetch_mimit(), "MIMIT", force)
            return
        except Exception as err:  # noqa: BLE001 - qualunque errore -> fallback
            if source == "mimit":
                raise
            log.warning("MIMIT non disponibile (%s): uso il mirror", err)
    day = mirror_last_date()
    archivia(fetch_mirror(day), "MIMIT via mirror benzina-data", force)


def run_backfill(start: dt.date, end: dt.date | None, force: bool) -> None:
    end = end or mirror_last_date()
    day = start
    while day <= end:
        try:
            archivia(fetch_mirror(day), "MIMIT via mirror benzina-data", force)
        except RuntimeError as err:
            log.warning("Giorno %s non disponibile nel mirror: %s", day, err)
        day += dt.timedelta(days=1)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", choices=["auto", "mimit", "mirror"], default="auto")
    ap.add_argument("--backfill-from", type=dt.date.fromisoformat)
    ap.add_argument("--backfill-to", type=dt.date.fromisoformat)
    ap.add_argument("--force", action="store_true", help="riscrive i prezzi anche se già presenti")
    args = ap.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if args.backfill_from:
        run_backfill(args.backfill_from, args.backfill_to, args.force)
    else:
        run_oggi(args.source, args.force)
    return 0


if __name__ == "__main__":
    sys.exit(main())
