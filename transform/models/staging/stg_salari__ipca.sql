-- IPCA Italia (indice armonizzato, Eurostat prc_hicp_minr), base 2025 = 100:
-- ultimo snapshot. Una sola base dal 1996: nessun raccordo.
with snapshot as (
    select *, max(filename) over () as ultimo_file
    from {{ source('salari_raw', 'ipca') }}
)

select mese, indice, provvisorio
from snapshot
where filename = ultimo_file
