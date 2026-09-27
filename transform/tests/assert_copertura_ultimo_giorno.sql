-- Nell'ultimo giorno ci devono essere prezzi validi per almeno 15.000 impianti
-- (su circa 22.000 attivi): sotto questa soglia la pubblicazione è incompleta.
select data, n_impianti
from {{ ref('mart_carburanti__nazionale_giornaliero') }}
where carburante = 'benzina' and modalita = 'self'
  and data = (select max(data) from {{ ref('mart_carburanti__nazionale_giornaliero') }})
  and n_impianti < 15000
