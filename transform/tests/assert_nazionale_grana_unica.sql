-- Una sola riga per giorno x carburante x modalità
select data, carburante, modalita, count(*) as n
from {{ ref('mart_carburanti__nazionale_giornaliero') }}
group by all
having count(*) > 1
