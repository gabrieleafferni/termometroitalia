-- Salari medi annui per paese: OCSE (dollari PPA a prezzi costanti, euro) ed
-- Eurostat (euro correnti per dipendente a tempo pieno). Ultimo snapshot di ciascuno.
with ocse as (
    select *, max(filename) over () as ultimo_file
    from {{ source('salari_raw', 'salari_medi_ocse') }}
),

eurostat as (
    select *, max(filename) over () as ultimo_file
    from {{ source('salari_raw', 'salario_tempo_pieno') }}
)

select anno, paese, 'ocse' as fonte, unita, prezzi, valore
from ocse
where filename = ultimo_file

union all

select anno, paese, 'eurostat' as fonte, 'EUR' as unita, 'correnti' as prezzi, euro as valore
from eurostat
where filename = ultimo_file
