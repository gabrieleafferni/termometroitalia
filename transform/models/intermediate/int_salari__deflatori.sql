-- I due deflatori dei salari, mese per mese, entrambi in base 2025 = 100:
-- NIC (ISTAT, raccordato in int_istat__nic_concatenato) e IPCA (Eurostat).
-- Quando uno dei due non ha ancora il mese, vale l'ultimo disponibile
-- (deflatore_stimato = true), come per i prezzi reali dei carburanti.

with fine as (
    -- fino all'ultimo mese con un dato (deflatori o salari): niente date di oggi,
    -- così i mart restano identici finché i dati non cambiano
    select greatest(
        (select max(mese) from {{ ref('int_istat__nic_concatenato') }}),
        (select max(mese) from {{ ref('stg_salari__ipca') }}),
        (select max(mese) from {{ ref('stg_salari__contrattuali') }})
    ) as ultimo
),

mesi as (
    select unnest(generate_series(date '1996-01-01', (select ultimo from fine), interval 1 month))::date as mese
),

nic as (
    select mese, indice, provvisorio from {{ ref('int_istat__nic_concatenato') }}
),

ipca as (
    select mese, indice, provvisorio from {{ ref('stg_salari__ipca') }}
),

uniti as (
    select
        m.mese,
        n.indice as nic,
        i.indice as ipca,
        coalesce(n.provvisorio, false) as nic_provvisorio,
        coalesce(i.provvisorio, false) as ipca_provvisorio
    from mesi as m
    left join nic as n using (mese)
    left join ipca as i using (mese)
)

select
    mese,
    coalesce(nic, last_value(nic ignore nulls) over w) as nic,
    coalesce(ipca, last_value(ipca ignore nulls) over w) as ipca,
    nic is null as nic_stimato,
    ipca is null as ipca_stimato,
    nic_provvisorio,
    ipca_provvisorio
from uniti
window w as (order by mese rows between unbounded preceding and current row)
order by mese
