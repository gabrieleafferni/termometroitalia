-- Vent'anni di prezzi: la serie settimanale nazionale del MASE dal 2005,
-- con la componente fiscale (accise + IVA) e il massimo storico "fino a quel
-- momento", per dire se un valore è un record.
--
-- Prezzi nominali e reali. Il prezzo reale è espresso ai prezzi dell'ultimo
-- mese con l'indice NIC disponibile (mese_riferimento_reale):
--   prezzo_reale = prezzo * NIC(mese di riferimento) / NIC(mese della settimana)
-- Le settimane dei mesi per cui l'ISTAT non ha ancora pubblicato l'indice usano
-- l'ultimo indice disponibile (deflatore_stimato = true): il loro prezzo reale
-- coincide con quello nominale.

with mase as (
    select * from {{ ref('stg_carburanti__settimanali') }}
),

nic as (
    select * from {{ ref('int_istat__nic_concatenato') }}
),

riferimento as (
    select
        max(mese) as mese_rif,
        arg_max(indice, mese) as nic_rif,
        arg_max(provvisorio, mese) as rif_provvisorio
    from nic
),

deflatore as (
    select
        m.*,
        r.mese_rif,
        r.nic_rif,
        r.rif_provvisorio,
        cast(date_trunc('month', m.data) as date) > r.mese_rif as deflatore_stimato,
        case
            when cast(date_trunc('month', m.data) as date) > r.mese_rif then r.nic_rif
            else n.indice
        end as nic_settimana
    from mase as m
    cross join riferimento as r
    left join nic as n
        on n.mese = cast(date_trunc('month', m.data) as date)
),

reali as (
    select
        *,
        prezzo * nic_rif / nic_settimana as prezzo_reale_esatto
    from deflatore
)

select
    data,
    carburante,
    round(prezzo, 4) as prezzo,
    round(prezzo_netto, 4) as prezzo_netto,
    round(prezzo - prezzo_netto, 4) as tasse,
    round((prezzo - prezzo_netto) / prezzo, 4) as quota_tasse,
    round(max(prezzo) over (
        partition by carburante order by data
        rows between unbounded preceding and 1 preceding
    ), 4) as massimo_precedente,
    round(prezzo_reale_esatto, 4) as prezzo_reale,
    round(max(prezzo_reale_esatto) over (
        partition by carburante order by data
        rows between unbounded preceding and 1 preceding
    ), 4) as massimo_reale_precedente,
    mese_rif as mese_riferimento_reale,
    rif_provvisorio as riferimento_provvisorio,
    deflatore_stimato
from reali
order by carburante, data
