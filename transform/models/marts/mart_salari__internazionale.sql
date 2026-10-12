-- Salari medi annui nei paesi OCSE e UE.
-- reale_ppa     OCSE: dollari a parità di potere d'acquisto, prezzi costanti (anno base OCSE)
-- indice_1991   reale_ppa con 1991 = 100 (primo anno con quasi tutti i paesi principali)
-- euro_correnti Eurostat nama_10_fte: salario medio per dipendente a tempo pieno

with ocse as (
    select anno, paese, valore as reale_ppa
    from {{ ref('stg_salari__internazionali') }}
    where fonte = 'ocse' and unita = 'USD_PPP' and prezzi = 'costanti'
),

base_1991 as (
    select paese, reale_ppa as ppa_1991 from ocse where anno = 1991
),

eurostat as (
    select anno, p.codice as paese_ocse, e.paese as paese_ue, valore as euro_correnti
    from {{ ref('stg_salari__internazionali') }} as e
    left join {{ ref('paesi') }} as p on p.codice_ue = e.paese
    where fonte = 'eurostat'
),

chiavi as (
    select anno, paese from ocse
    union
    select anno, coalesce(paese_ocse, paese_ue) from eurostat
)

select
    c.anno,
    c.paese,
    coalesce(p.nome, pu.nome, c.paese) as nome,
    round(o.reale_ppa, 0) as reale_ppa,
    round(o.reale_ppa / b.ppa_1991 * 100, 2) as indice_1991,
    round(e.euro_correnti, 0) as euro_correnti
from chiavi as c
left join ocse as o on o.anno = c.anno and o.paese = c.paese
left join base_1991 as b on b.paese = c.paese
left join eurostat as e on e.anno = c.anno and coalesce(e.paese_ocse, e.paese_ue) = c.paese
left join {{ ref('paesi') }} as p on p.codice = c.paese
left join {{ ref('paesi') }} as pu on pu.codice_ue = c.paese and pu.codice is null
order by c.paese, c.anno
