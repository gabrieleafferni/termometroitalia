-- Una riga per mese, tipo, qualifica e settore; una per settore e anno di riferimento.
select 'reali_mensile' as mart, count(*) as n
from {{ ref('mart_salari__reali_mensile') }}
group by mese, tipo, qualifica, settore
having count(*) > 1

union all
select 'settori', count(*)
from {{ ref('mart_salari__settori') }}
group by anno_riferimento, qualifica, settore
having count(*) > 1

union all
select 'internazionale', count(*)
from {{ ref('mart_salari__internazionale') }}
group by anno, paese
having count(*) > 1

union all
select 'racli_province', count(*)
from {{ ref('mart_salari__racli_province') }}
group by anno, sigla, sesso
having count(*) > 1
