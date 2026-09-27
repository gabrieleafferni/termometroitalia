"""Genera le "novità" del giorno a partire dai mart: frasi brevi e verificabili
che raccontano cosa è cambiato. Alimentano la home del sito (e in futuro
newsletter e canale Telegram).

Ogni novità ha un punteggio di rilevanza: le soglie sono statistiche (z-score
delle variazioni giornaliere, record sulla finestra disponibile), non a occhio.

Uso:  python -m pipeline.insights
Output: data/marts/novita.json
"""

from __future__ import annotations

import datetime as dt
import json
import math
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[1]
MARTS = ROOT / "data" / "marts"
OUT = MARTS / "novita.json"

MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio",
        "agosto", "settembre", "ottobre", "novembre", "dicembre"]
NOMI = {"benzina": "Benzina self", "gasolio": "Gasolio self", "gpl": "GPL", "metano": "Metano"}
UNITA = {"benzina": "€/l", "gasolio": "€/l", "gpl": "€/l", "metano": "€/kg"}


def euro(x: float, dec: int = 3) -> str:
    return f"{x:,.{dec}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def cent(delta_euro: float) -> str:
    c = delta_euro * 100
    segno = "+" if c > 0.05 else ("−" if c < -0.05 else "±")
    return f"{segno}{euro(abs(c), 1)} cent"


def data_it(d: dt.date) -> str:
    return f"{d.day} {MESI[d.month - 1]}"


def q(sql: str) -> list[dict]:
    rel = duckdb.sql(sql)
    cols = rel.columns
    return [dict(zip(cols, r)) for r in rel.fetchall()]


def serie_nazionale() -> dict[str, list[dict]]:
    rows = q(f"""
        select data, carburante, media
        from '{MARTS / "mart_carburanti__nazionale_giornaliero.parquet"}'
        where is_riferimento
        order by carburante, data
    """)
    out: dict[str, list[dict]] = {}
    for r in rows:
        out.setdefault(r["carburante"], []).append(r)
    return out


def valore_a(serie: list[dict], giorni: int) -> dict | None:
    """Ultimo punto disponibile ad almeno `giorni` giorni dall'ultimo."""
    ultimo = serie[-1]["data"]
    candidati = [r for r in serie if r["data"] <= ultimo - dt.timedelta(days=giorni)]
    return candidati[-1] if candidati else None


def novita_carburante(carb: str, serie: list[dict]) -> list[dict]:
    out = []
    oggi = serie[-1]
    nome, unita = NOMI[carb], UNITA[carb]
    inizio = serie[0]
    v7, v30 = valore_a(serie, 7), valore_a(serie, 30)

    # 1. Quadro del giorno
    pezzi = []
    if v7:
        pezzi.append(f"{cent(oggi['media'] - v7['media'])} in una settimana")
    if v30:
        pezzi.append(f"{cent(oggi['media'] - v30['media'])} in un mese")
    out.append({
        "id": f"{carb}_quadro",
        "tema": "carburanti",
        "carburante": carb,
        "titolo": nome,
        "valore": round(oggi["media"], 3),
        "unita": unita,
        "delta_7g": round(oggi["media"] - v7["media"], 4) if v7 else None,
        "delta_30g": round(oggi["media"] - v30["media"], 4) if v30 else None,
        "testo": f"{nome} a {euro(oggi['media'])} {unita}" + (f": {', '.join(pezzi)}." if pezzi else "."),
        "rilevanza": 50 + (min(40, abs(oggi["media"] - v30["media"]) * 400) if v30 else 0),
    })

    # 2. Record sulla finestra disponibile
    medie = [r["media"] for r in serie]
    if len(serie) >= 14:
        if oggi["media"] >= max(medie) - 1e-9:
            out.append({
                "id": f"{carb}_record_max", "tema": "carburanti", "carburante": carb,
                "titolo": "Nuovo massimo",
                "testo": f"{nome}: il prezzo medio più alto da quando lo monitoriamo ({data_it(inizio['data'])}).",
                "rilevanza": 85,
            })
        elif oggi["media"] <= min(medie) + 1e-9:
            out.append({
                "id": f"{carb}_record_min", "tema": "carburanti", "carburante": carb,
                "titolo": "Nuovo minimo",
                "testo": f"{nome}: il prezzo medio più basso da quando lo monitoriamo ({data_it(inizio['data'])}).",
                "rilevanza": 80,
            })

    # 3. Variazione giornaliera insolita (z-score sulle variazioni precedenti)
    diffs = [b["media"] - a["media"] for a, b in zip(serie, serie[1:])]
    if len(diffs) >= 15:
        storico, ultima = diffs[:-1], diffs[-1]
        mu = sum(storico) / len(storico)
        sd = math.sqrt(sum((d - mu) ** 2 for d in storico) / (len(storico) - 1))
        z = (ultima - mu) / sd if sd > 0 else 0
        if abs(z) >= 2.5:
            verso = "salita" if ultima > 0 else "discesa"
            out.append({
                "id": f"{carb}_scatto", "tema": "carburanti", "carburante": carb,
                "titolo": "Variazione insolita",
                "testo": f"{nome}: {verso} di {cent(ultima)} in un giorno, "
                         f"fuori dal normale (z = {euro(z, 1)}).",
                "rilevanza": 75 + min(20, abs(z) * 2),
            })

    # 4. Striscia di rialzi/ribassi consecutivi
    striscia = 0
    for d in reversed(diffs):
        if d > 0.0005 and striscia >= 0:
            striscia += 1
        elif d < -0.0005 and striscia <= 0:
            striscia -= 1
        else:
            break
    if abs(striscia) >= 4:
        verso = "rialzo" if striscia > 0 else "ribasso"
        out.append({
            "id": f"{carb}_striscia", "tema": "carburanti", "carburante": carb,
            "titolo": f"{abs(striscia)} giorni di {verso}",
            "testo": f"{nome}: {abs(striscia)} rilevazioni consecutive in {verso}.",
            "rilevanza": 60 + abs(striscia) * 2,
        })
    return out


def novita_territorio(ultimo: dt.date) -> list[dict]:
    out = []
    reg = q(f"""
        select regione, media from '{MARTS / "mart_carburanti__regionale_giornaliero.parquet"}'
        where data = '{ultimo}' and carburante = 'benzina' order by media desc
    """)
    if reg:
        caro, eco = reg[0], reg[-1]
        diff = caro["media"] - eco["media"]
        out.append({
            "id": "regioni_forbice", "tema": "carburanti", "carburante": "benzina",
            "titolo": "Divario tra regioni",
            "testo": f"Benzina self: {caro['regione']} è la regione più cara ({euro(caro['media'])} €/l), "
                     f"{eco['regione']} la più economica ({euro(eco['media'])}). Differenza: {euro(diff * 100, 1)} cent.",
            "rilevanza": 55,
        })
    tipo = {r["tipo_impianto"]: r["media"] for r in q(f"""
        select tipo_impianto, media from '{MARTS / "mart_carburanti__tipo_impianto_giornaliero.parquet"}'
        where data = '{ultimo}' and carburante = 'benzina'
    """)}
    if {"Autostradale", "Stradale"} <= tipo.keys():
        extra = (tipo["Autostradale"] - tipo["Stradale"]) * 50
        out.append({
            "id": "autostrada_pieno", "tema": "carburanti", "carburante": "benzina",
            "titolo": "Il pieno in autostrada",
            "testo": f"Un pieno di benzina da 50 litri costa in media {euro(extra, 2)} € in più in autostrada.",
            "valore": round(extra, 2), "unita": "€",
            "rilevanza": 50,
        })
    return out


def elenco(nomi: list[str]) -> str:
    return nomi[0] if len(nomi) == 1 else ", ".join(nomi[:-1]) + " e " + nomi[-1]


def accorpa_record(novita: list[dict], serie: dict) -> list[dict]:
    """Più record nello stesso giorno diventano una sola notizia."""
    out = [n for n in novita if not n["id"].endswith(("_record_max", "_record_min"))]
    inizio = data_it(min(r["data"] for s in serie.values() for r in s))
    for suff, parola, titolo in (("_record_max", "più alto", "Nuovo massimo"), ("_record_min", "più basso", "Nuovo minimo")):
        rec = [n for n in novita if n["id"].endswith(suff)]
        if not rec:
            continue
        nomi = [NOMI[n["carburante"]] for n in rec]
        soggetto = elenco([nomi[0]] + [x[0].lower() + x[1:] if x not in ("GPL",) else x for x in nomi[1:]])
        verbo = "tocca" if len(rec) == 1 else "toccano"
        out.append({
            "id": f"record{suff}",
            "tema": "carburanti",
            "carburante": rec[0]["carburante"],
            "carburanti": [n["carburante"] for n in rec],
            "titolo": titolo + ("" if len(rec) == 1 else f" per {len(rec)} carburanti"),
            "testo": f"{soggetto} {verbo} il prezzo medio {parola} da quando li monitoriamo ({inizio}).",
            "rilevanza": max(n["rilevanza"] for n in rec) + (7 if len(rec) > 1 else 5),
        })
    return out


def main() -> int:
    serie = serie_nazionale()
    ultimo = max(r["data"] for s in serie.values() for r in s)
    novita = []
    for carb in ("benzina", "gasolio", "gpl", "metano"):
        if carb in serie:
            novita += novita_carburante(carb, serie[carb])

    b, g = serie.get("benzina"), serie.get("gasolio")
    if b and g:
        gap = g[-1]["media"] - b[-1]["media"]
        if abs(gap) > 0.05:
            chi, altro = ("gasolio", "benzina") if gap > 0 else ("benzina", "gasolio")
            novita.append({
                "id": "gap_gasolio_benzina", "tema": "carburanti", "carburante": "gasolio",
                "titolo": "Gasolio contro benzina",
                "testo": f"Oggi il {chi} costa {euro(abs(gap) * 100, 1)} cent al litro più della {altro} (self).",
                "rilevanza": 65,
            })
        pieno_oggi = b[-1]["media"] * 50
        v30 = valore_a(b, 30)
        if v30:
            novita.append({
                "id": "pieno_benzina", "tema": "carburanti", "carburante": "benzina",
                "titolo": "Il costo di un pieno",
                "testo": f"Un pieno da 50 litri di benzina self costa {euro(pieno_oggi, 2)} €: "
                         f"{euro(abs(pieno_oggi - v30['media'] * 50), 2)} € "
                         f"{'in più' if pieno_oggi > v30['media'] * 50 else 'in meno'} di un mese fa.",
                "valore": round(pieno_oggi, 2), "unita": "€",
                "rilevanza": 70,
            })

    novita += novita_territorio(ultimo)
    novita = accorpa_record(novita, serie)
    novita.sort(key=lambda n: -n["rilevanza"])
    for n in novita:
        n["rilevanza"] = round(n["rilevanza"], 1)

    stato = json.loads((ROOT / "data/raw/carburanti/ultimo_aggiornamento.json").read_text())
    payload = {
        "aggiornato_al": ultimo.isoformat(),
        "generato_il": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "fonte": stato.get("fonte"),
        "inizio_serie": min(r["data"] for s in serie.values() for r in s).isoformat(),
        "novita": novita,
    }
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    print(f"{len(novita)} novità scritte in {OUT.relative_to(ROOT)}")
    for n in novita:
        print(f"  [{n['rilevanza']:5.1f}] {n['testo']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
