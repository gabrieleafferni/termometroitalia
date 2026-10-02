-- Fotografia dell'ultimo giorno disponibile: un impianto per riga, con il
-- prezzo self di benzina e gasolio e il confronto con 7 giorni prima.
-- Alimenta la mappa dei distributori.

with ultimo as (
    select max(data) as data from {{ ref('int_carburanti__prezzi_validi') }}
),

validi as (
    select *
    from {{ ref('int_carburanti__prezzi_validi') }}
    where is_riferimento and is_recente and not is_outlier
      and carburante in ('benzina', 'gasolio')
),

oggi as (
    select v.*
    from validi v
    join ultimo u on v.data = u.data
),

sette_giorni_fa as (
    -- l'ultimo prezzo disponibile a 7 o più giorni di distanza (gestisce i buchi)
    select v.id_impianto, v.carburante, v.prezzo
    from validi v, ultimo u
    where v.data <= u.data - interval 7 day
    qualify row_number() over (partition by v.id_impianto, v.carburante order by v.data desc) = 1
),

per_impianto as (
    select
        o.id_impianto,
        any_value(o.data) as data,
        any_value(o.nome) as nome,
        any_value(o.indirizzo) as indirizzo,
        any_value(o.bandiera) as bandiera,
        any_value(o.tipo_impianto) as tipo_impianto,
        any_value(o.comune) as comune,
        any_value(o.sigla_provincia) as sigla,
        any_value(o.regione) as regione,
        any_value(o.lat) as lat,
        any_value(o.lon) as lon,
        max(case when o.carburante = 'benzina' then o.prezzo end) as benzina,
        max(case when o.carburante = 'gasolio' then o.prezzo end) as gasolio,
        max(case when s.carburante = 'benzina' then s.prezzo end) as benzina_7g,
        max(case when s.carburante = 'gasolio' then s.prezzo end) as gasolio_7g,
        max(o.dt_comunicazione) as ultima_comunicazione
    from oggi o
    left join sette_giorni_fa s
        on s.id_impianto = o.id_impianto and s.carburante = o.carburante
    group by o.id_impianto
)

select *
from per_impianto
where lat is not null and lon is not null
order by id_impianto
