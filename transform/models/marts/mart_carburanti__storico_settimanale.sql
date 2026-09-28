-- Vent'anni di prezzi: la serie settimanale nazionale del MASE dal 2005,
-- con la componente fiscale (accise + IVA) e il massimo storico "fino a quel
-- momento", per dire se un valore è un record.
-- Prezzi nominali: non corretti per l'inflazione.

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
    ), 4) as massimo_precedente
from {{ ref('stg_carburanti__settimanali') }}
order by carburante, data
