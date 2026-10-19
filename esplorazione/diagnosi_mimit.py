"""Diagnosi (19/10/2026): da GitHub Actions il MIMIT non risponde più dal 16/10.
Prova DNS, connessione TCP, TLS e HTTP su diversi indirizzi e scrive l'esito
in esplorazione/diagnosi_mimit.txt."""
import socket
import ssl
import subprocess
import time
import urllib.request
from pathlib import Path

OUT = Path(__file__).with_name("diagnosi_mimit.txt")
righe: list[str] = []


def scrivi(s: str = "") -> None:
    print(s, flush=True)
    righe.append(s)


UA_PROGETTO = "termometroitalia/1.0 (+https://github.com/gabrieleafferni/termometroitalia)"
UA_BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

HOSTS = ["www.mimit.gov.it", "mimit.gov.it", "www.mise.gov.it", "osservaprezzi.mise.gov.it", "carburanti.mise.gov.it",
         "www.istat.it", "www.google.com"]
URLS = [
    "https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv",
    "https://www.mimit.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv",
    "http://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv",
    "https://mimit.gov.it/images/exportCSV/prezzo_alle_8.csv",
    "https://www.mise.gov.it/images/exportCSV/prezzo_alle_8.csv",
    "https://www.mimit.gov.it/it/open-data/elenco-dataset/carburanti-prezzi-praticati-e-anagrafica-degli-impianti",
    "https://www.mimit.gov.it/robots.txt",
    "https://osservaprezzi.mise.gov.it/osservaprezzi-carburanti/comunicazioni",
    "https://carburanti.mise.gov.it/ospzSearch/",
]

scrivi(f"Ora UTC: {time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())}")
try:
    ip = urllib.request.urlopen("https://api.ipify.org", timeout=15).read().decode()
    scrivi(f"IP pubblico del runner: {ip}")
except Exception as e:  # noqa: BLE001
    scrivi(f"IP pubblico: errore {e!r}")

scrivi("\n== DNS e connessione TCP (porta 443, 10 s)")
for h in HOSTS:
    try:
        ips = sorted({ai[4][0] for ai in socket.getaddrinfo(h, 443, proto=socket.IPPROTO_TCP)})
    except Exception as e:  # noqa: BLE001
        scrivi(f"{h}: DNS errore {e!r}")
        continue
    for addr in ips:
        t0 = time.monotonic()
        try:
            fam = socket.AF_INET6 if ":" in addr else socket.AF_INET
            with socket.socket(fam, socket.SOCK_STREAM) as s:
                s.settimeout(10)
                s.connect((addr, 443))
                tcp = f"TCP ok in {time.monotonic() - t0:.2f}s"
                try:
                    ctx = ssl.create_default_context()
                    with ctx.wrap_socket(s, server_hostname=h) as t:
                        tls = f"TLS ok ({t.version()})"
                except Exception as e:  # noqa: BLE001
                    tls = f"TLS errore {e!r}"
            scrivi(f"{h} {addr}: {tcp}; {tls}")
        except Exception as e:  # noqa: BLE001
            scrivi(f"{h} {addr}: TCP errore dopo {time.monotonic() - t0:.1f}s: {e!r}")

scrivi("\n== HTTP GET (30 s), due user agent")
for url in URLS:
    for nome, ua in (("progetto", UA_PROGETTO), ("browser", UA_BROWSER)):
        t0 = time.monotonic()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=30) as r:
                corpo = r.read(400)
                scrivi(f"[{nome}] {url}\n   {r.status} in {time.monotonic() - t0:.1f}s · {r.headers.get('Content-Type')} · "
                       f"Content-Length {r.headers.get('Content-Length')} · Last-Modified {r.headers.get('Last-Modified')} · Server {r.headers.get('Server')}\n"
                       f"   inizio: {corpo[:200]!r}")
        except urllib.error.HTTPError as e:
            scrivi(f"[{nome}] {url}\n   HTTP {e.code} in {time.monotonic() - t0:.1f}s · Server {e.headers.get('Server')} · {e.read(200)!r}")
        except Exception as e:  # noqa: BLE001
            scrivi(f"[{nome}] {url}\n   errore dopo {time.monotonic() - t0:.1f}s: {e!r}")

scrivi("\n== curl -v sul file dei prezzi (IPv4, 40 s)")
p = subprocess.run(["curl", "-4", "-sS", "-v", "--max-time", "40", "-o", "/dev/null", "-A", UA_BROWSER,
                    "https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv"], capture_output=True, text=True)
scrivi("\n".join(l for l in p.stderr.splitlines() if not l.startswith("{") and not l.startswith("}"))[:4000])

OUT.write_text("\n".join(righe) + "\n", encoding="utf-8")
