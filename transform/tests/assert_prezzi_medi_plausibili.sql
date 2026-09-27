-- Le medie nazionali devono stare in un intervallo plausibile (€/litro, €/kg).
-- Se questo test fallisce, quasi certamente il file sorgente è cambiato formato.
select *
from {{ ref('mart_carburanti__nazionale_giornaliero') }}
where (carburante in ('benzina', 'gasolio') and media not between 1.0 and 4.0)
   or (carburante = 'gpl' and media not between 0.4 and 2.0)
   or (carburante = 'metano' and media not between 0.8 and 4.0)
