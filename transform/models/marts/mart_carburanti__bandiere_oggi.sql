-- Confronto tra marchi (bandiere) nell'ultimo giorno disponibile.
-- Le bandiere minori vengono raggruppate in "Altri marchi".

with ultimo as (
    select max(data) as data from {{ ref('int_carburanti__prezzi_validi') }}
),

oggi as (
    select v.*
    from {{ ref('int_carburanti__prezzi_validi') }} v
    join ultimo u on v.data = u.data
    where v.is_riferimento and v.is_recente and not v.is_outlier
      and v.carburante in ('benzina', 'gasolio')
),

dimensioni as (
    select bandiera, count(distinct id_impianto) as n
    from oggi
    group by 1
),

gruppi as (
    select
        bandiera,
        case when row_number() over (order by n desc, bandiera) <= 8 then bandiera else 'Altri marchi' end as marchio
    from dimensioni
)

select
    any_value(o.data) as data,
    g.marchio,
    o.carburante,
    round(avg(cast(o.prezzo as decimal(9, 4))), 4) as media,
    round(median(o.prezzo), 4) as mediana,
    count(distinct o.id_impianto) as n_impianti
from oggi o
join gruppi g using (bandiera)
group by g.marchio, o.carburante
order by o.carburante, media desc, g.marchio
