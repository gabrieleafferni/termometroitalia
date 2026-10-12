-- Quanto si guadagna all'ora (settore privato, retribuzione lorda per ora
-- retribuita, RACLI): media, mediana, 1° e 9° decile per anno, sesso e settore.
with r as (
    select * from {{ ref('stg_salari__racli') }} where fonte = 'settori' and territorio = 'IT'
)

select
    r.anno,
    r.sesso,
    r.settore,
    s.nome_breve,
    s.livello,
    max(case when statistica = 'decile_1' then euro_ora end) as decile_1,
    max(case when statistica = 'mediana' then euro_ora end) as mediana,
    max(case when statistica = 'media' then euro_ora end) as media,
    max(case when statistica = 'decile_9' then euro_ora end) as decile_9
from r
left join {{ ref('settori_salari') }} as s on s.codice = r.settore
where r.settore in ('0010', '0011', '0020', '0038') or length(r.settore) = 1
group by all
order by r.anno, r.settore, r.sesso
