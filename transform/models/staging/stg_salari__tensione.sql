-- Contratti in attesa di rinnovo (ISTAT, tensione contrattuale): ultimo snapshot.
with snapshot as (
    select *, max(filename) over () as ultimo_file
    from {{ source('salari_raw', 'tensione') }}
)

select mese, indicatore, comparto, valore
from snapshot
where filename = ultimo_file
