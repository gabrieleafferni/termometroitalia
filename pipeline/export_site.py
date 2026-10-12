"""Esporta i mart in JSON compatti per il sito (site/public/data/).

I Parquet in data/marts sono il prodotto dati "ufficiale" e versionato;
questi JSON sono solo il formato di consegna al browser, rigenerati a ogni build.

Uso:  python -m pipeline.export_site
"""

from __future__ import annotations

import csv
import datetime as dt
import decimal
import json
import shutil
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[1]
MARTS = ROOT / "data" / "marts"
OUT = ROOT / "site" / "public" / "data"


def _default(o):
    if isinstance(o, (dt.date, dt.datetime)):
        return o.isoformat()
    if isinstance(o, decimal.Decimal):
        return float(o)
    raise TypeError(type(o))


def rows(sql: str) -> list[dict]:
    rel = duckdb.sql(sql)
    return [dict(zip(rel.columns, r)) for r in rel.fetchall()]


def columns(sql: str) -> dict[str, list]:
    """Formato colonnare: molto più compatto per migliaia di righe."""
    rel = duckdb.sql(sql)
    data = rel.fetchall()
    return {c: [r[i] for r in data] for i, c in enumerate(rel.columns)}


def write(name: str, payload) -> None:
    path = OUT / name
    path.write_text(json.dumps(payload, default=_default, ensure_ascii=False, separators=(",", ":")))
    print(f"  {name:36s} {path.stat().st_size / 1024:8.1f} KB")


def mart(name: str) -> str:
    return f"'{MARTS / (name + '.parquet')}'"


def distribuzione() -> dict:
    """Istogramma per giorno in forma compatta: per ogni carburante un asse fisso
    di fasce da 1 centesimo (uguale per tutti i giorni, così i cambiamenti si vedono)
    e, per ogni giorno, il numero di distributori in ogni fascia.
    L'asse va dallo 0,5° al 99,5° percentile di tutti i giorni insieme: i pochi
    prezzi fuori scala (Livigno, alcune autostrade) sono contati a parte."""
    src = mart("mart_carburanti__distribuzione_giornaliera")
    out = {}
    for c in ("benzina", "gasolio"):
        pool = rows(f"""
            select centesimo, sum(n_impianti) as n from {src}
            where carburante = '{c}' group by 1 order by 1
        """)
        tot = sum(r["n"] for r in pool)
        cum, da, a = 0, None, None
        for r in pool:
            cum += r["n"]
            if da is None and cum >= 0.005 * tot:
                da = r["centesimo"]
            if a is None and cum >= 0.995 * tot:
                a = r["centesimo"]
        date = [r["d"] for r in rows(f"select distinct data as d from {src} where carburante = '{c}' order by 1")]
        celle = rows(f"""
            select data as d, centesimo as k, n_impianti as n
            from {src} where carburante = '{c}'
        """)
        larghezza = a - da + 1
        idx = {d: i for i, d in enumerate(date)}
        conteggi = [[0] * larghezza for _ in date]
        sotto, sopra = [0] * len(date), [0] * len(date)
        for r in celle:
            i = idx[r["d"]]
            if r["k"] < da:
                sotto[i] += r["n"]
            elif r["k"] > a:
                sopra[i] += r["n"]
            else:
                conteggi[i][r["k"] - da] += r["n"]
        out[c] = {"da": da, "a": a, "date": date, "n": conteggi, "sotto": sotto, "sopra": sopra}
    return out


def salari() -> None:
    """Sezione salari: tre file.

    salari.json         serie mensili (indici nominali per settore e qualifica, NIC e IPCA
                        sullo stesso asse dei mesi: i salari reali si calcolano nel browser),
                        confronto per settore, retribuzioni di fatto, contratti scaduti
    salari_mondo.json   salari medi annui per paese (OCSE, Eurostat)
    salari_orari.json   retribuzione oraria RACLI: totali per sesso, settori, province
    """
    mensile = mart("mart_salari__reali_mensile")
    mesi = [r["mese"] for r in rows(f"select distinct mese from {mensile} order by mese")]
    defl = columns(f"""
        select mese, any_value(nic) as nic, any_value(ipca) as ipca,
               bool_or(nic_stimato) as nic_stimato, bool_or(ipca_stimato) as ipca_stimato
        from {mensile} group by mese order by mese
    """)
    pos = {m: i for i, m in enumerate(mesi)}
    serie: dict[str, list] = {}
    for r in rows(f"""
        select settore, qualifica, mese, indice from {mensile}
        where tipo = 'orario' and (qualifica = 'totale' or settore = '0010')
        order by settore, qualifica, mese
    """):
        chiave = f"{r['settore']}|{r['qualifica']}"
        serie.setdefault(chiave, [None] * len(mesi))[pos[r["mese"]]] = r["indice"]
    ultimo = rows(f"""
        select max(mese) as mese, bool_or(provvisorio) filter (where mese = (select max(mese) from {mensile})) as provvisorio
        from {mensile} where settore = '0010'
    """)[0]
    ultimo_nic = rows(f"select max(mese) as mese from {mensile} where not nic_stimato")[0]["mese"]
    ultimo_ipca = rows(f"select max(mese) as mese from {mensile} where not ipca_stimato")[0]["mese"]
    di_fatto = columns(f"""
        select trimestre as t, indice as i, nic, ipca
        from {mart('mart_salari__di_fatto_trimestrale')} where settore = '0037' order by trimestre
    """)
    tensione = rows(f"""
        select mese as m, comparto as c, quota_in_attesa as q, mesi_attesa_in_attesa as ma, mesi_attesa_tutti as mt
        from {mart('mart_salari__tensione')} where comparto in ('totale', 'privato', 'industria', 'servizi_privati', 'pa') order by comparto, mese
    """)
    write("salari.json", {
        "aggiornato": {"contrattuali": ultimo["mese"], "provvisorio": bool(ultimo["provvisorio"]),
                       "nic": ultimo_nic, "ipca": ultimo_ipca,
                       "di_fatto": max(di_fatto["t"]), "tensione": max(r["m"] for r in tensione)},
        "mesi": mesi,
        "nic": defl["nic"],
        "ipca": defl["ipca"],
        "serie": serie,
        "settori": rows(f"""
            select anno_riferimento as rif, qualifica as q, settore as s, nome, nome_breve as nb, livello as l,
                   padre as p, ordine as o, var_nominale as nom, var_prezzi_nic as pn, var_prezzi_ipca as pi,
                   var_reale_nic as rn, var_reale_ipca as ri, var_salari_tend as st
            from {mart('mart_salari__settori')} order by rif, q, o
        """),
        "di_fatto": di_fatto,
        "tensione": tensione,
    })
    write("salari_mondo.json", rows(f"""
        select anno as a, paese as p, nome as n, reale_ppa as ppa, indice_1991 as i, euro_correnti as e
        from {mart('mart_salari__internazionale')} order by paese, anno
    """))
    write("salari_orari.json", {
        "totale": rows(f"""
            select anno as a, sesso as s, decile_1 as d1, mediana as me, media as mm, decile_9 as d9
            from {mart('mart_salari__racli')} where settore = '0010' order by anno, sesso
        """),
        "settori": rows(f"""
            select anno as a, settore as c, nome_breve as n, sesso as s, decile_1 as d1, mediana as me, media as mm, decile_9 as d9
            from {mart('mart_salari__racli')}
            where length(settore) = 1 and anno = (select max(anno) from {mart('mart_salari__racli')})
            order by settore, sesso
        """),
        "province": rows(f"""
            select anno as a, sigla, provincia as n, regione as r, sesso as s,
                   decile_1 as d1, mediana as me, media as mm, decile_9 as d9
            from {mart('mart_salari__racli_province')}
            where anno = (select max(anno) from {mart('mart_salari__racli_province')})
            order by sigla, sesso
        """),
    })


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"Esporto in {OUT.relative_to(ROOT)}")

    write("carburanti_nazionale.json", rows(f"""
        select data as d, carburante as c, modalita as m, is_riferimento as rif,
               media, mediana, p10, p25, p75, p90, n_impianti as n
        from {mart('mart_carburanti__nazionale_giornaliero')}
        order by data, carburante, modalita
    """))

    write("carburanti_regionale.json", rows(f"""
        select data as d, regione as r, cod_regione as cod, carburante as c,
               media, scarto_vs_italia as scarto, n_impianti as n, posizione as pos
        from {mart('mart_carburanti__regionale_giornaliero')}
        order by data, carburante, posizione
    """))

    write("carburanti_province_oggi.json", rows(f"""
        select sigla, provincia, regione, carburante as c, media, scarto_vs_italia as scarto,
               n_impianti as n, posizione as pos
        from {mart('mart_carburanti__provinciale_giornaliero')}
        where data = (select max(data) from {mart('mart_carburanti__provinciale_giornaliero')})
        order by carburante, posizione
    """))

    write("carburanti_tipo.json", rows(f"""
        select data as d, tipo_impianto as t, carburante as c, media, n_impianti as n
        from {mart('mart_carburanti__tipo_impianto_giornaliero')}
        order by data, carburante, tipo_impianto
    """))

    write("carburanti_bandiere.json", rows(f"""
        select marchio, carburante as c, media, mediana, n_impianti as n
        from {mart('mart_carburanti__bandiere_oggi')}
        order by carburante, media desc
    """))

    write("carburanti_impianti.json", columns(f"""
        select id_impianto as id,
               round(lat, 4) as lat, round(lon, 4) as lon,
               benzina as b, gasolio as g, benzina_7g as b7, gasolio_7g as g7,
               nome, indirizzo as ind, bandiera, comune, sigla,
               case tipo_impianto when 'Autostradale' then 1 else 0 end as auto,
               -- ora dell'ultima comunicazione dei prezzi, in minuti dall'epoca Unix
               -- (ora italiana come la scrive il MIMIT, letta dal browser come UTC)
               cast(epoch(ultima_comunicazione) / 60 as integer) as ts
        from {mart('mart_carburanti__impianti_oggi')}
        order by id_impianto
    """))

    shutil.copy(MARTS / "novita.json", OUT / "novita.json")
    print(f"  {'novita.json':36s} {(OUT / 'novita.json').stat().st_size / 1024:8.1f} KB")

    write("carburanti_storico.json", columns(f"""
        select data as d, carburante as c, prezzo as p, prezzo_netto as n, tasse as t, massimo_precedente as mp,
               prezzo_reale as r
        from {mart('mart_carburanti__storico_settimanale')}
        where carburante in ('benzina', 'gasolio')
        order by carburante, data
    """))

    # dal barile alla pompa: settimane MASE con il Brent in euro al litro, più l'ultima quotazione
    barile = MARTS / "mart_carburanti__barile_settimanale.parquet"
    if barile.exists():
        write("carburanti_barile.json", {
            "settimane": columns(f"""
                select data as d, carburante as c, prezzo_netto as n, brent_eur_litro as b,
                       brent_usd_barile as bu, prezzo_netto_reale as nr, brent_eur_litro_reale as br
                from {mart('mart_carburanti__barile_settimanale')}
                order by carburante, data
            """),
            "ultimo": rows(f"""
                select data, brent_usd_barile, usd_per_eur, brent_eur_litro
                from {mart('mart_mercati__quotazioni_giornaliere')}
                where brent_usd_barile is not null
                order by data desc limit 1
            """)[0],
        })

    write("carburanti_marchi.json", rows(f"""
        select data as d, marchio as m, carburante as c, media, n_impianti as n,
               quota_entro_tetto_eni as q, tetto_eni as tetto,
               n_aggiornati_oggi as na, quota_entro_tetto_aggiornati as qa
        from {mart('mart_carburanti__marchi_giornaliero')}
        order by data, carburante, marchio
    """))

    write("carburanti_distribuzione.json", distribuzione())

    seed = ROOT / "transform" / "seeds" / "misure_prezzo.csv"
    with seed.open(encoding="utf-8") as f:
        write("misure.json", list(csv.DictReader(f)))

    if (MARTS / "mart_salari__reali_mensile.parquet").exists():
        salari()

    stato = json.loads((ROOT / "data/raw/carburanti/ultimo_aggiornamento.json").read_text())
    # prezzi reali: mese dei prezzi a cui sono riportati (ultimo indice NIC disponibile)
    nic = rows(f"""
        select max(mese_riferimento_reale) as mese, bool_or(riferimento_provvisorio) as provvisorio
        from {mart('mart_carburanti__storico_settimanale')}
    """)[0]
    write("meta.json", {
        "carburanti": {
            "aggiornato_al": stato["data_estrazione"],
            "fonte": stato["fonte"],
            "scaricato_il": stato["scaricato_il"],
            "impianti_attivi": stato["impianti_attivi"],
        },
        "prezzi_reali": {"mese_riferimento": nic["mese"], "provvisorio": nic["provvisorio"], "fonte": "ISTAT, indice NIC"},
        "build": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
    })
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
