-- Il Brent si aggiorna ogni giorno di mercato (su FRED con qualche giorno di
-- ritardo): oltre 14 giorni di silenzio vuol dire che l'ingestion non funziona.
{{ config(severity = 'warn') }}

select max(data) as ultimo_giorno
from {{ ref('stg_mercati__quotazioni') }}
where serie = 'brent_usd_barile'
having max(data) < current_date - interval 14 day
