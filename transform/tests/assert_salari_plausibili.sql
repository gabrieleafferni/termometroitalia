-- Controlli di plausibilità sui salari:
-- - variazione su un anno delle retribuzioni contrattuali (totale) tra -2% e +10%
--   nell'ultimo mese (i comunicati ISTAT del 2026 danno +2,4%);
-- - deflatori presenti per ogni mese dei salari;
-- - quote di dipendenti in attesa di rinnovo tra 0 e 1, mesi di attesa non negativi;
-- - RACLI: 1° decile <= mediana <= 9° decile e 1° decile <= media <= 9° decile.
with ultimo as (
    select * from {{ ref('mart_salari__reali_mensile') }}
    where tipo = 'orario' and qualifica = 'totale' and settore = '0010'
    qualify mese = max(mese) over ()
)

select 'variazione tendenziale anomala' as problema, cast(var_salari_tend as varchar) as dettaglio
from ultimo
where var_salari_tend not between -0.02 and 0.10

union all
select 'deflatore mancante', cast(mese as varchar)
from {{ ref('mart_salari__reali_mensile') }}
where nic is null or ipca is null

union all
select 'quota o mesi di attesa fuori scala', cast(mese as varchar) || ' ' || comparto
from {{ ref('mart_salari__tensione') }}
where quota_in_attesa not between 0 and 1 or mesi_attesa_in_attesa < 0 or mesi_attesa_tutti < 0

union all
select 'decili RACLI non ordinati', cast(anno as varchar) || ' ' || settore || ' ' || sesso
from {{ ref('mart_salari__racli') }}
where not (decile_1 <= mediana and mediana <= decile_9 and decile_1 <= media and media <= decile_9)

union all
select 'decili RACLI province non ordinati', cast(anno as varchar) || ' ' || sigla || ' ' || sesso
from {{ ref('mart_salari__racli_province') }}
where not (decile_1 <= mediana and mediana <= decile_9 and decile_1 <= media and media <= decile_9)
