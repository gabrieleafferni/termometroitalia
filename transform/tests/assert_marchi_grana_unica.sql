select data, marchio, carburante, count(*) as n
from {{ ref('mart_carburanti__marchi_giornaliero') }}
group by all
having count(*) > 1
