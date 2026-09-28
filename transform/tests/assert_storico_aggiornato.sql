-- La serie settimanale non deve essere ferma da più di 3 settimane
-- (se lo è, la fonte MASE ha smesso di aggiornarsi o l'ingestion è rotta).
{{ config(severity = 'warn') }}

select max(data) as ultima_settimana
from {{ ref('mart_carburanti__storico_settimanale') }}
having max(data) < current_date - interval 21 day
