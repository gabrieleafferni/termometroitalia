-- Media per provincia e giorno (solo prezzi di riferimento).

with province as (
    select
        data,
        sigla_provincia as sigla,
        provincia,
        regione,
        carburante,
        avg(prezzo) as media,
        count(distinct id_impianto) as n_impianti
    from {{ ref('int_carburanti__prezzi_validi') }}
    where is_riferimento and is_recente and not is_outlier and provincia is not null
    group by all
),

italia as (
    select data, carburante, media as media_italia
    from {{ ref('mart_carburanti__nazionale_giornaliero') }}
    where is_riferimento
)

select
    p.data,
    p.sigla,
    p.provincia,
    p.regione,
    p.carburante,
    round(p.media, 4) as media,
    p.n_impianti,
    round(p.media - i.media_italia, 4) as scarto_vs_italia,
    rank() over (partition by p.data, p.carburante order by p.media desc) as posizione
from province p
join italia i using (data, carburante)
order by p.data, p.carburante, posizione
