# Licenze dei dati

Il **codice** di Termometro Italia (pipeline, modelli dbt, sito) è rilasciato con licenza MIT: vedi il file [`LICENSE`](../LICENSE) nella radice del repository. I **dati** hanno le licenze descritte qui sotto, cartella per cartella.

Termometro Italia è un progetto personale e indipendente di Gabriele Afferni. Non è una fonte ufficiale: le elaborazioni non sono prodotte né approvate dagli enti che pubblicano i dati originali.

## 1. Dati delle fonti (copie archiviate)

Queste cartelle contengono i dati delle fonti come sono stati scaricati, solo convertiti in Parquet. Restano soggetti alla licenza o alle condizioni della fonte.

| Cartella | Fonte | Licenza o condizioni |
|---|---|---|
| `raw/carburanti/prezzi/`, `raw/carburanti/impianti/`, `raw/carburanti/ultimo_aggiornamento.json` | Ministero delle Imprese e del Made in Italy (MIMIT), Osservaprezzi Carburanti. Lo storico dal 28/07/2026 è stato ricostruito dall'archivio pubblico [LucaDDDD/benzina-data](https://github.com/LucaDDDD/benzina-data) | [Italian Open Data License 2.0](https://www.dati.gov.it/content/italian-open-data-license-v20): citare la fonte e il licenziante, non presentare i dati come ufficiali o approvati dal MIMIT, non travisarli |
| `raw/carburanti/settimanali/` | Ministero dell'Ambiente e della Sicurezza Energetica (MASE), prezzi medi settimanali dei carburanti | Condizioni di riuso indicate dal MASE sul proprio sito; qui sono citati come fonte |
| `raw/istat/nic/` | ISTAT, indice dei prezzi al consumo per l'intera collettività (NIC), [esploradati.istat.it](https://esploradati.istat.it/) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.it) |
| `raw/mercati/quotazioni/` (Brent, benzina e gasolio NY Harbor) | U.S. Energy Information Administration (EIA), via [FRED](https://fred.stlouisfed.org/series/DCOILBRENTEU) | Pubblico dominio (dati del governo degli Stati Uniti); si chiede di citare la fonte |
| `raw/mercati/quotazioni/` (cambio euro/dollaro) | Banca Centrale Europea, tassi di cambio di riferimento ([data.ecb.europa.eu](https://data.ecb.europa.eu/)) | Riuso con citazione della fonte ("Fonte: BCE") |
| `../site/public/geo/` | Confini amministrativi ISTAT, via [openpolis/geojson-italy](https://github.com/openpolis/geojson-italy) | CC BY, come indicato da openpolis |

## 2. Elaborazioni di Termometro Italia sui carburanti e sui mercati

`marts/mart_carburanti__*`, `marts/mart_mercati__*`, `marts/novita.json` e i file JSON generati per il sito (`site/public/data/`, non versionati) sono rilasciati con licenza **[Creative Commons Attribuzione 4.0 Internazionale (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/deed.it)**.

Chi li riusa deve citare: *Termometro Italia (Gabriele Afferni), https://github.com/gabrieleafferni/termometroitalia*, insieme alle fonti originali elencate sopra (per i dati MIMIT nel rispetto delle condizioni della IODL 2.0).

## 3. Sezione elezioni (in costruzione)

I dati della sezione elezioni (`raw/elezioni/`, `marts/mart_elezioni__*`, i file `elezioni_*` generati per il sito) e i testi e i grafici della pagina elezioni saranno rilasciati con licenza **[Creative Commons Attribuzione – Condividi allo stesso modo 4.0 (CC BY-SA 4.0)](https://creativecommons.org/licenses/by-sa/4.0/deed.it)**, perché includono dati estratti dalla pagina di Wikipedia [Opinion polling for the next Italian general election](https://en.wikipedia.org/wiki/Opinion_polling_for_the_next_Italian_general_election) ([autori](https://en.wikipedia.org/w/index.php?title=Opinion_polling_for_the_next_Italian_general_election&action=history)), pubblicata con la stessa licenza.

Le fonti di quella sezione saranno citate per esteso: i sondaggi depositati su [sondaggipoliticoelettorali.it](https://www.sondaggipoliticoelettorali.it/) come raccolti dal progetto #datiBeneComune ([ruggsea/llm_italian_poll_scraper](https://github.com/ruggsea/llm_italian_poll_scraper), Ruggero Marino Lazzaroni, CC BY 4.0, e [onData](https://github.com/ondata/liberiamoli-tutti)), Wikipedia per campione e date di realizzazione, il Ministero dell'Interno (Eligendo) per i risultati delle elezioni. Le modifiche fatte (abbinamento delle fonti, normalizzazione dei nomi, esclusione dei sondaggi incoerenti) saranno descritte nella pagina Metodo.

Chi riusa questi dati deve citare Termometro Italia e le fonti e, se costruisce una propria banca dati con una parte sostanziale di questi dati, rilasciarla con la stessa licenza.
