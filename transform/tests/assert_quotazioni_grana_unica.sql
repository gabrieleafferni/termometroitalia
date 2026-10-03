-- Una sola quotazione per giorno e serie (i file mensili non si sovrappongono)
select data, serie, count(*) as n
from {{ ref('stg_mercati__quotazioni') }}
group by all
having count(*) > 1
