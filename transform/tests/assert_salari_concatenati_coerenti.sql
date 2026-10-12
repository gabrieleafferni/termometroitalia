-- Serie delle retribuzioni contrattuali raccordate tra le basi:
-- 1. nessun mese mancante tra l'inizio e la fine di ogni serie;
-- 2. ogni serie arriva all'ultimo mese pubblicato in base 2021;
-- 3. il totale (orario, tutti i dipendenti) parte dal gennaio 2005 e non salta
--    di oltre l'8% in un mese (le una tantum di dicembre arrivano al 5%).
with c as (
    select * from {{ ref('int_salari__contrattuali_concatenate') }}
),

serie as (
    select tipo, qualifica, settore, min(mese) as inizio, max(mese) as fine, count(*) as mesi
    from c group by all
),

ultimo as (
    select max(mese) as ultimo from {{ ref('stg_salari__contrattuali') }} where base = '2021'
),

salti as (
    select mese, indice / lag(indice) over (order by mese) - 1 as salto
    from c where tipo = 'orario' and qualifica = 'totale' and settore = '0010'
)

select 'mesi mancanti' as problema, settore || ' ' || qualifica || ' ' || tipo as dettaglio
from serie
where mesi != date_diff('month', inizio, fine) + 1

union all
select 'serie che non arriva all ultimo mese', settore || ' ' || qualifica || ' ' || tipo
from serie, ultimo
where fine < ultimo.ultimo

union all
select 'totale non parte dal 2005', cast(inizio as varchar)
from serie
where tipo = 'orario' and qualifica = 'totale' and settore = '0010' and inizio > date '2005-01-01'

union all
select 'salto mensile oltre l 8%', cast(mese as varchar) || ' ' || cast(round(salto * 100, 1) as varchar)
from salti
where abs(salto) > 0.08
