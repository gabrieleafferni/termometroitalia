-- Una sola riga per settimana e carburante nella serie storica
select data, carburante, count(*) as n
from {{ ref('mart_carburanti__storico_settimanale') }}
group by all
having count(*) > 1
