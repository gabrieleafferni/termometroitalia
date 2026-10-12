-- Indici delle retribuzioni contrattuali (ISTAT) in tutte le basi: la base
-- dicembre 2021 dall'ultimo snapshot, le basi 2005, 2010 e 2015 dallo storico.
-- Il raccordo è in int_salari__contrattuali_concatenate.

with snapshot as (
    select *, max(filename) over () as ultimo_file
    from {{ source('salari_raw', 'contrattuali') }}
)

select mese, base, tipo, qualifica, settore, indice, provvisorio
from snapshot
where filename = ultimo_file

union all

select mese, base, tipo, qualifica, settore, indice, provvisorio
from {{ source('salari_raw', 'contrattuali_storico') }}
