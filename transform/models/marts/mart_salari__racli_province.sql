-- Retribuzione lorda oraria del settore privato per provincia (RACLI):
-- media, mediana, 1° e 9° decile, per anno e sesso. Codici NUTS → sigle.
with r as (
    select * from {{ ref('stg_salari__racli') }} where fonte = 'province'
)

select
    r.anno,
    n.sigla,
    p.provincia,
    p.regione,
    r.sesso,
    max(case when statistica = 'decile_1' then euro_ora end) as decile_1,
    max(case when statistica = 'mediana' then euro_ora end) as mediana,
    max(case when statistica = 'media' then euro_ora end) as media,
    max(case when statistica = 'decile_9' then euro_ora end) as decile_9
from r
inner join {{ ref('province_nuts') }} as n on n.codice_nuts = r.territorio
left join {{ ref('province') }} as p on p.sigla = n.sigla
group by all
order by r.anno, n.sigla, r.sesso
