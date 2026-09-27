-- Serie storica nazionale: un punto per giorno, carburante e modalità.
-- "media" è confrontabile con i prezzi medi pubblicati dal MIMIT.

select
    data,
    carburante,
    modalita,
    is_riferimento,
    round(avg(cast(prezzo as decimal(9, 4))), 4) as media,
    round(median(prezzo), 4) as mediana,
    round(quantile_cont(prezzo, 0.10), 4) as p10,
    round(quantile_cont(prezzo, 0.25), 4) as p25,
    round(quantile_cont(prezzo, 0.75), 4) as p75,
    round(quantile_cont(prezzo, 0.90), 4) as p90,
    round(min(prezzo), 3) as minimo,
    round(max(prezzo), 3) as massimo,
    count(distinct id_impianto) as n_impianti
from {{ ref('int_carburanti__prezzi_validi') }}
where is_recente and not is_outlier
group by all
order by data, carburante, modalita
