"""Stato dei dati sui salari, in un file pubblico: data/stato/salari.json.

Le fonti dei salari si controllano una volta al giorno (passo 1e del workflow), ma
l'esito resta nella cache di GitHub Actions, che da fuori non si vede. Questo file
lo rende leggibile a chiunque, in particolare al controllo giornaliero di Claude
che legge il file da raw.githubusercontent.com e avvisa Gabriele solo se qualcosa
non va. Contiene:

  controllato_il   ultimo giorno (ora italiana) in cui tutte le fonti hanno risposto
  ultimo_errore    l'ultimo controllo non riuscito, con le fonti che non hanno risposto
  periodi          il periodo più recente salvato per ogni serie, letto dai nomi dei file
  ritardi          le serie ferme oltre i tempi normali di pubblicazione, ognuna con
                   il giorno in cui il ritardo è stato notato la prima volta ("dal")

Il file viene salvato nel repository insieme agli altri dati, ma da solo non basta a
creare un commit: di fatto si aggiorna con i dati dei carburanti, cioè ogni mattina.

Uso (nel workflow):
  python -m pipeline.stato_salari --esito ok          # controllo riuscito o già fatto oggi
  python -m pipeline.stato_salari --esito errore --fonti "istat.retribuzioni"
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
STATO = ROOT / "data" / "stato" / "salari.json"

# serie → (cartella, regex sul nome del file, tipo di periodo)
SERIE = {
    "retribuzioni contrattuali (ISTAT)": ("istat/retribuzioni", r"^contrattuali_(\d{4}-\d{2})\.parquet$", "mese"),
    "contratti in attesa di rinnovo (ISTAT)": ("istat/retribuzioni", r"^tensione_(\d{4}-\d{2})\.parquet$", "mese"),
    "retribuzioni di fatto per ULA (ISTAT, OROS)": ("istat/retribuzioni", r"^oros_(\d{4}-T[1-4])\.parquet$", "trimestre"),
    "paga oraria per settore (ISTAT, RACLI)": ("istat/retribuzioni", r"^racli_(\d{4})\.parquet$", "anno"),
    "paga oraria per provincia (ISTAT, RACLI)": ("istat/retribuzioni", r"^racli_province_(\d{4})\.parquet$", "anno"),
    "prezzi al consumo NIC (ISTAT)": ("istat/nic", r"^nic_(\d{4}-\d{2})\.parquet$", "mese"),
    "prezzi al consumo IPCA (Eurostat)": ("eurostat/ipca", r"^ipca_(\d{4}-\d{2})\.parquet$", "mese"),
    "salari medi annui (OCSE)": ("ocse", r"^salari_medi_(\d{4})\.parquet$", "anno"),
    "salario medio a tempo pieno (Eurostat)": ("eurostat/salari", r"^salario_tempo_pieno_(\d{4})\.parquet$", "anno"),
}

# Oltre quanti giorni dalla fine del periodo una serie è "in ritardo". Valori larghi:
# il ritardo normale di pubblicazione è dentro la soglia, con margine. Mensili e IPCA
# come i test dbt (assert_salari_aggiornati, assert_nic_aggiornato).
SOGLIA_GIORNI = {
    "retribuzioni contrattuali (ISTAT)": 120,       # di solito il mese esce dopo 30-45 giorni
    "contratti in attesa di rinnovo (ISTAT)": 120,
    "retribuzioni di fatto per ULA (ISTAT, OROS)": 150,  # il trimestre esce dopo circa 75 giorni
    "paga oraria per settore (ISTAT, RACLI)": 1280,  # l'anno esce con circa 2 anni di ritardo, a data variabile
    "paga oraria per provincia (ISTAT, RACLI)": 1280,
    "prezzi al consumo NIC (ISTAT)": 50,             # il mese esce entro metà del mese dopo
    "prezzi al consumo IPCA (Eurostat)": 50,
    "salari medi annui (OCSE)": 550,                 # l'anno esce verso metà dell'anno dopo
    "salario medio a tempo pieno (Eurostat)": 900,
}


def fine_periodo(valore: str, tipo: str) -> dt.date:
    """Ultimo giorno del periodo: 2026-08 → 31/8, 2026-T2 → 30/6, 2025 → 31/12."""
    if tipo == "anno":
        return dt.date(int(valore), 12, 31)
    if tipo == "trimestre":
        anno, q = int(valore[:4]), int(valore[-1])
        mese = 3 * q
    else:
        anno, mese = int(valore[:4]), int(valore[5:7])
    primo_dopo = dt.date(anno + (mese == 12), mese % 12 + 1, 1)
    return primo_dopo - dt.timedelta(days=1)


def periodi() -> dict[str, str | None]:
    out = {}
    for nome, (cartella, regex, _) in SERIE.items():
        trovati = [m.group(1) for p in (RAW / cartella).glob("*.parquet") if (m := re.match(regex, p.name))]
        out[nome] = max(trovati) if trovati else None
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--esito", choices=["ok", "errore"], required=True)
    ap.add_argument("--fonti", default="", help="fonti che non hanno risposto, separate da virgole")
    args = ap.parse_args(argv)

    oggi = dt.datetime.now(ZoneInfo("Europe/Rome")).date()
    prima = json.loads(STATO.read_text()) if STATO.exists() else {}
    ritardi_prima = {r["serie"]: r.get("dal") for r in prima.get("ritardi", [])}

    stato = {
        "controllato_il": oggi.isoformat() if args.esito == "ok" else prima.get("controllato_il"),
        "ultimo_errore": prima.get("ultimo_errore"),
        "periodi": periodi(),
        "ritardi": [],
    }
    if args.esito == "errore":
        stato["ultimo_errore"] = {
            "il": oggi.isoformat(),
            "fonti": [f for f in args.fonti.split(",") if f] or ["non indicate"],
        }

    for nome, valore in stato["periodi"].items():
        if valore is None:
            continue
        giorni = (oggi - fine_periodo(valore, SERIE[nome][2])).days
        if giorni > SOGLIA_GIORNI[nome]:
            stato["ritardi"].append({
                "serie": nome,
                "ultimo_periodo": valore,
                "giorni_dalla_fine": giorni,
                "soglia_giorni": SOGLIA_GIORNI[nome],
                "dal": ritardi_prima.get(nome) or oggi.isoformat(),
            })

    STATO.parent.mkdir(parents=True, exist_ok=True)
    STATO.write_text(json.dumps(stato, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps(stato, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
