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


def pct(x: float, dec: int = 0) -> str:
    """'il 62%', 'l'8%', 'lo 0,8%': articolo corretto davanti a una percentuale."""
    s = euro(x * 100, dec)
    intero = s.split(",")[0]
    art = "lo" if intero == "0" else ("l'" if intero in ("1", "11") or intero.startswith("8") else "il")
    return f"{art}{'' if art.endswith(chr(39)) else ' '}{s}%"


def al_pct(x: float) -> str:
    """'al 62%', 'all'84%', 'all'11%'."""
    s = euro(x * 100, 0)
    return f"all'{s}%" if s in ("1", "11") or s.startswith("8") else f"al {s}%"


def mese_anno(d: dt.date) -> str:
    return f"{MESI[d.month - 1]} {d.year}"


def novita_storico() -> list[dict]:
    """Contesto lungo dalla serie settimanale MASE (dal 2005)."""
    path = MARTS / "mart_carburanti__storico_settimanale.parquet"
    if not path.exists():
        return []
    out = []
    rows = q(f"select data, carburante, prezzo, tasse, quota_tasse from '{path}' order by carburante, data")
    serie: dict[str, list[dict]] = {}
    for r in rows:
        serie.setdefault(r["carburante"], []).append(r)
    for carb in ("benzina", "gasolio"):
        s = serie.get(carb)
        if not s:
            continue
        ult = s[-1]
        inizio = s[0]["data"]
        superiori = [r for r in s[:-1] if r["prezzo"] >= ult["prezzo"]]
        nome = NOMI[carb].split()[0]
        if not superiori:
            testo = (f"{nome}: {euro(ult['prezzo'])} €/l nella settimana del {data_it(ult['data'])}, "
                     f"il prezzo settimanale più alto dall'inizio della serie MASE ({inizio.year}), in termini nominali.")
            rilev = 93
            titolo = "Record dal " + str(inizio.year)
        else:
            ultima = superiori[-1]
            testo = (f"{nome}: {euro(ult['prezzo'])} €/l nella settimana del {data_it(ult['data'])}, "
                     f"il livello più alto da {mese_anno(ultima['data'])} ({euro(ultima['prezzo'])} €/l).")
            anni = (ult["data"] - ultima["data"]).days / 365.25
            rilev = 70 + min(20, anni * 5)
            titolo = f"Il più alto da {mese_anno(ultima['data'])}"
        out.append({"id": f"storico_{carb}", "tema": "carburanti", "carburante": carb,
                    "titolo": titolo, "testo": testo, "rilevanza": rilev})
    b = serie.get("benzina")
    if b and b[-1]["tasse"] is not None:
        u = b[-1]
        out.append({
            "id": "tasse_benzina", "tema": "carburanti", "carburante": "benzina",
            "titolo": "Quanto pesano le tasse",
            "testo": f"Dei {euro(u['prezzo'])} €/l della benzina, {euro(u['tasse'])} sono accise e IVA "
                     f"({round(u['quota_tasse'] * 100)}%). Dato MASE, settimana del {data_it(u['data'])}.",
            "rilevanza": 58,
        })
    return out


def novita_tetto(ultimo: dt.date) -> list[dict]:
    """Monitoraggio del tetto ai prezzi Eni e delle mosse degli altri marchi."""
    seed = ROOT / "transform" / "seeds" / "misure_prezzo.csv"
    path = MARTS / "mart_carburanti__marchi_giornaliero.parquet"
    if not seed.exists() or not path.exists():
        return []
    import csv

    misure = [r for r in csv.DictReader(seed.open(encoding="utf-8")) if r["misura_id"] == "tetto_eni_2026"]
    if not misure:
        return []
    dal = dt.date.fromisoformat(misure[0]["valida_dal"])
    al = dt.date.fromisoformat(misure[0]["valida_al"])
    tetti = {m["carburante"]: float(m["prezzo_max"]) for m in misure}
    rows = q(f"select * from '{path}' order by data")
    per = {(r["data"], r["marchio"], r["carburante"]): r for r in rows}
    date = sorted({r["data"] for r in rows})
    out = []

    if ultimo < dal:
        eni = per.get((ultimo, "Agip Eni", "benzina"))
        base = f" Nell'ultima rilevazione ({data_it(ultimo)}) solo {pct(eni['quota_entro_tetto_eni'], 1)} dei distributori Eni fuori autostrada vendeva la benzina self a {euro(tetti['benzina'], 2)} € o meno." if eni else ""
        out.append({
            "id": "tetto_eni_attesa", "tema": "carburanti", "carburante": "benzina",
            "titolo": "Tetto Eni: in arrivo nei dati",
            "testo": f"Il tetto Eni (benzina {euro(tetti['benzina'], 2)}, gasolio {euro(tetti['gasolio'], 2)} €/l, self, fuori autostrada) "
                     f"vale dal {data_it(dal)}: i prezzi di quel giorno arrivano con la pubblicazione MIMIT successiva.{base}",
            "rilevanza": 91,
        })
        return out
    if ultimo > al:
        return out

    prec = [d for d in date if d < ultimo]
    ieri = prec[-1] if prec else None
    for carb in ("benzina", "gasolio"):
        e = per.get((ultimo, "Agip Eni", carb))
        if not e:
            continue
        e0 = per.get((ieri, "Agip Eni", carb)) if ieri else None
        confronto = f" (il giorno prima: {euro(e0['quota_entro_tetto_eni'] * 100, 0)}%)" if e0 else ""
        frase = pct(e["quota_entro_tetto_eni"])
        out.append({
            "id": f"tetto_eni_{carb}", "tema": "carburanti", "carburante": carb,
            "titolo": f"Tetto Eni · {NOMI[carb].split()[0].lower()}",
            "testo": f"{frase[0].upper() + frase[1:]} dei distributori Eni fuori autostrada vende {'la benzina' if carb == 'benzina' else 'il gasolio'} self "
                     f"a {euro(tetti[carb], 2)} €/l o meno{confronto}. Prezzo medio Eni: {euro(e['media'])} €/l."
                     + (f" Tra quelli che avevano già comunicato il prezzo del giorno alle 8:00 ({e['n_aggiornati_oggi']}), "
                        f"la quota sale {al_pct(e['quota_entro_tetto_aggiornati'])}."
                        if e.get("quota_entro_tetto_aggiornati") is not None and e["quota_entro_tetto_aggiornati"] > e["quota_entro_tetto_eni"] + 0.1 else ""),
            "rilevanza": 95 if carb == "benzina" else 94,
        })
        # chi segue? ribassi marcati degli altri marchi rispetto al giorno prima
        if ieri:
            for m in ("Api-Ip", "Q8", "Esso", "Tamoil", "Pompe Bianche"):
                a, b = per.get((ultimo, m, carb)), per.get((ieri, m, carb))
                if a and b and a["media"] - b["media"] <= -0.02:
                    out.append({
                        "id": f"ribasso_{m}_{carb}", "tema": "carburanti", "carburante": carb,
                        "titolo": f"{m} abbassa i prezzi",
                        "testo": f"{m}: {'benzina' if carb == 'benzina' else 'gasolio'} self {cent(a['media'] - b['media'])} in un giorno (media {euro(a['media'])} €/l); "
                                 f"entro il tetto Eni {pct(a['quota_entro_tetto_eni'])} dei suoi impianti.",
                        "rilevanza": 90,
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
    novita += novita_storico()
    novita += novita_tetto(ultimo)
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
