-- Distribuzione giornaliera dei prezzi self di benzina e gasolio tra i distributori,
-- in fasce di 1 centesimo, con la rete Eni separata dagli altri marchi.
-- Alimenta l'istogramma del sito consultabile per data.
--
-- Fasce chiuse a destra: la fascia 199 contiene i prezzi da 1,981 a 1,990 €/l.
-- Così "prezzo fino a 1,99" coincide esattamente con le fasce fino alla 199,
-- e l'istogramma si legge senza ambiguità rispetto ai tetti ai prezzi.
-- Stessi filtri della media nazionale: la somma delle fasce di un giorno è il
-- numero di impianti del mart nazionale (lo verifica un test).

with prezzi as (
    select data, carburante, bandiera, prezzo
    from {{ ref('int_carburanti__prezzi_validi') }}
    where is_riferimento and is_recente and not is_outlier
      and carburante in ('benzina', 'gasolio')
)

select
    data,
    carburante,
    case when bandiera = 'Agip Eni' then 'eni' else 'altri' end as gruppo,
    -- prezzo in millesimi (3 decimali, come li comunica il MIMIT), poi fascia per eccesso
    cast(ceil(round(prezzo * 1000) / 10) as integer) as centesimo,
    count(*) as n_impianti
from prezzi
group by all
order by data, carburante, gruppo, centesimo
