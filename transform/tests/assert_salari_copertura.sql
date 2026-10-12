-- Copertura minima dei dati per la pagina:
-- - confronto OCSE: l'Italia ha l'indice 1991 = 100 e nell'ultimo anno ci sono
--   almeno 25 paesi con l'indice;
-- - RACLI: nell'ultimo anno almeno 100 province mappate sulle sigle, e nessun
--   codice provinciale (NUTS 3) senza sigla.
with ultimo_ocse as (
    select max(anno) as anno from {{ ref('mart_salari__internazionale') }} where indice_1991 is not null
)

select 'Italia senza indice OCSE' as problema, cast(u.anno as varchar) as dettaglio
from ultimo_ocse as u
where not exists (
    select 1 from {{ ref('mart_salari__internazionale') }} as i
    where i.paese = 'ITA' and i.anno = u.anno and i.indice_1991 is not null
)

union all
select 'meno di 25 paesi OCSE nell ultimo anno', cast(count(*) as varchar)
from {{ ref('mart_salari__internazionale') }} as i, ultimo_ocse as u
where i.anno = u.anno and i.indice_1991 is not null
having count(*) < 25

union all
select 'meno di 100 province RACLI', cast(count(distinct sigla) as varchar)
from {{ ref('mart_salari__racli_province') }}
where anno = (select max(anno) from {{ ref('mart_salari__racli_province') }})
having count(distinct sigla) < 100

union all
select 'codice provinciale RACLI senza sigla', territorio
from {{ ref('stg_salari__racli') }} as r
where fonte = 'province'
    and length(territorio) = 5
    and not exists (select 1 from {{ ref('province_nuts') }} as n where n.codice_nuts = r.territorio)
