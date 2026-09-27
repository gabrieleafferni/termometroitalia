-- Strada vs autostrada: quanto costa fare il pieno in autostrada?

select
    data,
    tipo_impianto,
    carburante,
    round(avg(prezzo), 4) as media,
    round(median(prezzo), 4) as mediana,
    count(distinct id_impianto) as n_impianti
from {{ ref('int_carburanti__prezzi_validi') }}
where is_riferimento and is_recente and not is_outlier
  and tipo_impianto in ('Stradale', 'Autostradale')
group by all
order by data, carburante, tipo_impianto
