-- Retribuzioni di fatto (OROS: quanto si paga davvero per unità di lavoro a tempo
-- pieno, compresi straordinari, premi e arretrati) contro i prezzi, per trimestre.
-- Indice destagionalizzato, base 2021 = 100; deflatori = media del trimestre,
-- riportata a media 2021 = 100.

with oros as (
    select trimestre, settore, indice, provvisorio
    from {{ ref('stg_salari__di_fatto') }}
    where destagionalizzato
),

deflatori as (
    select date_trunc('quarter', mese)::date as trimestre, avg(nic) as nic, avg(ipca) as ipca, count(*) as mesi
    from {{ ref('int_salari__deflatori') }}
    group by 1
),

media_2021 as (
    select avg(nic) as nic, avg(ipca) as ipca from {{ ref('int_salari__deflatori') }} where year(mese) = 2021
)

select
    o.trimestre,
    o.settore,
    s.nome_breve,
    round(o.indice, 3) as indice,
    round(d.nic / m.nic * 100, 3) as nic,
    round(d.ipca / m.ipca * 100, 3) as ipca,
    round(o.indice / (d.nic / m.nic), 3) as reale_nic,
    round(o.indice / (d.ipca / m.ipca), 3) as reale_ipca,
    o.provvisorio
from oros as o
inner join deflatori as d using (trimestre)
cross join media_2021 as m
left join {{ ref('settori_salari') }} as s on s.codice = o.settore
where d.mesi = 3
order by o.settore, o.trimestre
