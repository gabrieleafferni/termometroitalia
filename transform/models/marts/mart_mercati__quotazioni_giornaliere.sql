-- Quotazioni giornaliere in dollari e in euro al litro, una riga per giorno di mercato.
-- È la base per i modelli di previsione (Brent, raffinati e cambio -> prezzo netto).
--
-- Conversioni: 1 barile = 158,987294928 litri; 1 gallone USA = 3,785411784 litri.
-- Il cambio è quello di riferimento BCE dello stesso giorno o, se manca
-- (festività BCE), l'ultimo pubblicato prima (data_cambio).

with q as (
    select * from {{ ref('stg_mercati__quotazioni') }}
),

cambio as (
    select data, valore as usd_per_eur
    from q
    where serie = 'usd_per_eur'
),

prezzi as (
    select
        data,
        max(valore) filter (where serie = 'brent_usd_barile') as brent_usd_barile,
        max(valore) filter (where serie = 'gasolio_nyh_usd_gallone') as gasolio_nyh_usd_gallone,
        max(valore) filter (where serie = 'benzina_nyh_usd_gallone') as benzina_nyh_usd_gallone
    from q
    where serie <> 'usd_per_eur'
    group by data
)

select
    p.data,
    p.brent_usd_barile,
    p.gasolio_nyh_usd_gallone,
    p.benzina_nyh_usd_gallone,
    c.usd_per_eur,
    c.data as data_cambio,
    round(p.brent_usd_barile / c.usd_per_eur / 158.987294928, 5) as brent_eur_litro,
    round(p.gasolio_nyh_usd_gallone / c.usd_per_eur / 3.785411784, 5) as gasolio_nyh_eur_litro,
    round(p.benzina_nyh_usd_gallone / c.usd_per_eur / 3.785411784, 5) as benzina_nyh_eur_litro
from prezzi as p
asof left join cambio as c
    on p.data >= c.data
order by p.data
