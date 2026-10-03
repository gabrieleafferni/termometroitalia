-- Dal barile alla pompa: per ogni settimana della serie MASE, il prezzo industriale
-- (al netto di accise e IVA) di benzina e gasolio e il costo del petrolio Brent
-- in euro al litro.
--
-- Il Brent è la media dei giorni di mercato nei 7 giorni prima della rilevazione
-- MASE (che è del lunedì): la settimana precedente. Si tengono solo le settimane
-- con almeno 3 quotazioni, per non confrontare una settimana con un giorno solo.
-- La differenza comprende raffinazione, trasporto, scorte, distribuzione e margini
-- della filiera: non è un margine di guadagno.
-- I valori reali usano lo stesso deflatore NIC del mart storico (euro dell'ultimo
-- mese con l'indice disponibile).

with storico as (
    select
        data,
        carburante,
        prezzo,
        prezzo_netto,
        prezzo_reale / prezzo as fattore_reale,
        mese_riferimento_reale
    from {{ ref('mart_carburanti__storico_settimanale') }}
    where carburante in ('benzina', 'gasolio')
        and prezzo_netto is not null
),

brent as (
    select data, brent_usd_barile, usd_per_eur, brent_eur_litro
    from {{ ref('mart_mercati__quotazioni_giornaliere') }}
    where brent_eur_litro is not null
),

settimane as (
    select
        s.data,
        s.carburante,
        s.prezzo,
        s.prezzo_netto,
        s.fattore_reale,
        s.mese_riferimento_reale,
        avg(b.brent_usd_barile) as brent_usd_barile,
        avg(b.usd_per_eur) as usd_per_eur,
        avg(b.brent_eur_litro) as brent_eur_litro,
        count(*) as giorni_brent
    from storico as s
    inner join brent as b
        on b.data >= s.data - interval 7 day and b.data < s.data
    group by all
    having count(*) >= 3
)

select
    data,
    carburante,
    round(prezzo, 4) as prezzo,
    round(prezzo_netto, 4) as prezzo_netto,
    round(brent_usd_barile, 2) as brent_usd_barile,
    round(usd_per_eur, 4) as usd_per_eur,
    round(brent_eur_litro, 4) as brent_eur_litro,
    round(prezzo_netto - brent_eur_litro, 4) as differenza,
    round(prezzo_netto * fattore_reale, 4) as prezzo_netto_reale,
    round(brent_eur_litro * fattore_reale, 4) as brent_eur_litro_reale,
    round((prezzo_netto - brent_eur_litro) * fattore_reale, 4) as differenza_reale,
    round(max((prezzo_netto - brent_eur_litro) * fattore_reale) over (
        partition by carburante order by data
        rows between unbounded preceding and 1 preceding
    ), 4) as massimo_differenza_reale_precedente,
    mese_riferimento_reale,
    giorni_brent
from settimane
order by carburante, data
