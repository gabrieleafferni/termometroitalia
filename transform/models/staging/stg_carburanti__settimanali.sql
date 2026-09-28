-- Serie settimanale MASE: si usa solo l'ultimo snapshot pubblicato
-- (il MASE ripubblica sempre l'intera serie, eventualmente rivista).

with snapshot as (
    select *, max(filename) over () as ultimo_file
    from {{ source('carburanti_raw', 'settimanali') }}
)

select
    data,
    carburante,
    prezzo,
    prezzo_netto
from snapshot
where filename = ultimo_file
