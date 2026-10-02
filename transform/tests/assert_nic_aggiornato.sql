-- L'indice NIC esce ogni mese: se l'ultimo dato ha più di 75 giorni, l'ingestion
-- ISTAT non sta funzionando (i prezzi reali restano calcolati, ma su un deflatore vecchio).
{{ config(severity = 'warn') }}

select max(mese) as ultimo_mese
from {{ ref('stg_istat__nic') }}
having max(mese) < current_date - interval 75 day
