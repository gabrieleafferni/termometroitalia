-- Indice dei prezzi al consumo NIC (ISTAT), indice generale, nelle basi pubblicate.
-- Si usa solo l'ultimo snapshot: l'ISTAT ripubblica sempre la serie intera,
-- con le eventuali revisioni (per esempio il dato provvisorio che diventa definitivo).

with snapshot as (
    select *, max(filename) over () as ultimo_file
    from {{ source('istat_raw', 'nic') }}
)

select
    mese,
    base,
    indice,
    provvisorio
from snapshot
where filename = ultimo_file
