-- Distribuzione giornaliera dei prezzi self di benzina e gasolio tra i distributori,
-- in fasce di 1 centesimo. Alimenta l'istogramma del sito consultabile per data.
--
-- Fasce chiuse a destra: la fascia 200 contiene i prezzi da 1,991 a 2,000 €/l.
-- Così "prezzo fino a X,XX" coincide esattamente con le fasce fino alla X,XX.
-- Stessi filtri della media nazionale: la somma delle fasce di un giorno è il
-- numero di impianti del mart nazionale (lo verifica un test).

with prezzi as (
    select data, carburante, prezzo
    from {{ ref('int_carburanti__prezzi_validi') }}
    where is_riferimento and is_recente and not is_outlier
      and carburante in ('benzina', 'gasolio')
)

select
    data,
    carburante,
    -- prezzo in millesimi (3 decimali, come li comunica il MIMIT), poi fascia per eccesso
    cast(ceil(round(prezzo * 1000) / 10) as integer) as centesimo,
    count(*) as n_impianti
from prezzi
group by all
order by data, carburante, centesimo
