-- Serie NIC unica dal 1996, in base 2025 = 100.
--
-- Raccordo tra le basi come fa l'ISTAT: il coefficiente che porta una base nella
-- successiva è la media annua della base vecchia nell'anno che diventa la nuova
-- base, divisa per 100 (es. media 2025 dell'indice in base 2015 / 100).
-- Ogni base si usa solo nel periodo in cui è stata quella ufficiale.
-- Quando l'ISTAT introdurrà una nuova base, va aggiunta una riga a "periodi":
-- il test assert_nic_concatenato_coerente se ne accorge da solo.

with nic as (
    select * from {{ ref('stg_istat__nic') }}
),

periodi as (
    select * from (values
        ('1995', 1996, 2010, 2010),
        ('2010', 2011, 2015, 2015),
        ('2015', 2016, 2025, 2025),
        ('2025', 2026, 9999, null)
    ) as t(base, dal, al, anno_base_successiva)
),

raccordo as (
    select p.base, avg(n.indice) / 100 as coefficiente
    from periodi as p
    inner join nic as n
        on n.base = p.base and year(n.mese) = p.anno_base_successiva
    group by p.base
),

divisori as (
    -- per portare una base in base 2025 si divide per i coefficienti di tutte
    -- le basi da quella in poi (la 2025 non ne ha: divisore 1)
    select
        p.base,
        coalesce(product(r.coefficiente), 1) as divisore
    from periodi as p
    left join raccordo as r
        on cast(r.base as integer) >= cast(p.base as integer)
    group by p.base
)

select
    n.mese,
    round(n.indice / d.divisore, 6) as indice,
    n.indice as indice_originale,
    n.base as base_originale,
    round(d.divisore, 6) as divisore,
    n.provvisorio
from nic as n
inner join periodi as p
    on n.base = p.base and year(n.mese) between p.dal and p.al
inner join divisori as d
    on d.base = n.base
order by n.mese
