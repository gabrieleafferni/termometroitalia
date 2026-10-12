-- Retribuzioni lorde di fatto per unità di lavoro a tempo pieno (ISTAT, OROS),
-- base 2021 = 100, trimestrali: ultimo snapshot.
with snapshot as (
    select *, max(filename) over () as ultimo_file
    from {{ source('salari_raw', 'oros') }}
)

select trimestre, destagionalizzato, settore, indice, provvisorio
from snapshot
where filename = ultimo_file
