{{ config(severity = 'warn') }}
-- Avviso (non blocca il sito): dati sui salari fermi da troppo tempo.
-- Le retribuzioni contrattuali escono ogni mese nel database ISTAT con circa un
-- mese di ritardo: oltre 150 giorni dall'ultimo mese qualcosa non va. L'IPCA
-- Eurostat esce a metà del mese successivo: oltre 75 giorni è fermo.
select 'retribuzioni contrattuali ferme' as problema, cast(max(mese) as varchar) as ultimo
from {{ ref('stg_salari__contrattuali') }}
where base = '2021'
having max(mese) < current_date - interval 150 day

union all
select 'IPCA fermo', cast(max(mese) as varchar)
from {{ ref('stg_salari__ipca') }}
having max(mese) < current_date - interval 75 day
