-- Media per regione e giorno (solo prezzi di riferimento), con lo scarto
-- rispetto alla media nazionale dello stesso giorno.

with regioni as (
    select
        data,
        regione,
        cod_regione,
        carburante,
        avg(cast(prezzo as decimal(9, 4))) as media,
        median(prezzo) as mediana,
        count(distinct id_impianto) as n_impianti
    from {{ ref('int_carburanti__prezzi_validi') }}
    where is_riferimento and is_recente and not is_outlier and regione is not null
    group by all
),

italia as (
    select data, carburante, media as media_italia
    from {{ ref('mart_carburanti__nazionale_giornaliero') }}
    where is_riferimento
)

select
    r.data,
    r.regione,
    r.cod_regione,
    r.carburante,
    round(r.media, 4) as media,
    round(r.mediana, 4) as mediana,
    r.n_impianti,
    round(r.media - i.media_italia, 4) as scarto_vs_italia,
    rank() over (partition by r.data, r.carburante order by r.media desc, r.regione) as posizione
from regioni r
join italia i using (data, carburante)
order by r.data, r.carburante, posizione, r.regione
