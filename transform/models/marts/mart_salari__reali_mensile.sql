-- Retribuzioni contrattuali nominali e reali, mese per mese, dal 2005:
-- tipo (oraria, per dipendente) × qualifica (totale, operai, impiegati) × settore.
--
-- indice        retribuzione contrattuale, base dicembre 2021 = 100
-- reale_nic     indice al netto dell'inflazione NIC, base dicembre 2021 = 100
-- reale_ipca    lo stesso con l'IPCA
-- *_12m         medie mobili di 12 mesi: tolgono il sobbalzo delle una tantum
--               di dicembre e la stagionalità; sono la base dei confronti
-- var_*_tend    variazioni sullo stesso mese dell'anno prima

with salari as (
    select * from {{ ref('int_salari__contrattuali_concatenate') }}
),

deflatori as (
    select * from {{ ref('int_salari__deflatori') }}
),

riferimento as (
    select nic as nic_rif, ipca as ipca_rif from deflatori where mese = date '2021-12-01'
),

base as (
    select
        s.mese, s.tipo, s.qualifica, s.settore, s.indice, s.provvisorio,
        d.nic, d.ipca, d.nic_stimato, d.ipca_stimato,
        count(*) over w12 as mesi_finestra,
        avg(s.indice) over w12 as indice_12m,
        avg(d.nic) over w12 as nic_12m,
        avg(d.ipca) over w12 as ipca_12m,
        lag(s.indice, 12) over wserie as indice_anno_prima,
        lag(d.nic, 12) over wserie as nic_anno_prima,
        lag(d.ipca, 12) over wserie as ipca_anno_prima
    from salari as s
    inner join deflatori as d using (mese)
    window
        wserie as (partition by s.tipo, s.qualifica, s.settore order by s.mese),
        w12 as (partition by s.tipo, s.qualifica, s.settore order by s.mese rows between 11 preceding and current row)
)

select
    b.mese,
    b.tipo,
    b.qualifica,
    b.settore,
    round(b.indice, 3) as indice,
    round(b.nic, 3) as nic,
    round(b.ipca, 3) as ipca,
    round(b.indice / (b.nic / r.nic_rif), 3) as reale_nic,
    round(b.indice / (b.ipca / r.ipca_rif), 3) as reale_ipca,
    case when b.mesi_finestra = 12 then round(b.indice_12m, 3) end as indice_12m,
    case when b.mesi_finestra = 12 then round(b.indice_12m / (b.nic_12m / r.nic_rif), 3) end as reale_nic_12m,
    case when b.mesi_finestra = 12 then round(b.indice_12m / (b.ipca_12m / r.ipca_rif), 3) end as reale_ipca_12m,
    round(b.indice / b.indice_anno_prima - 1, 5) as var_salari_tend,
    round(b.nic / b.nic_anno_prima - 1, 5) as var_nic_tend,
    round(b.ipca / b.ipca_anno_prima - 1, 5) as var_ipca_tend,
    b.provvisorio,
    b.nic_stimato,
    b.ipca_stimato
from base as b
cross join riferimento as r
order by b.tipo, b.qualifica, b.settore, b.mese
