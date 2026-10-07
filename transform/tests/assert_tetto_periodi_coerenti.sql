-- I periodi di una misura di prezzo non si sovrappongono e hanno inizio <= fine:
-- ogni giorno deve avere un solo prezzo massimo di riferimento per carburante.
with misure as (
    select * from {{ ref('misure_prezzo') }} where valida_al is not null
)
select a.misura_id, a.carburante, a.valida_dal, a.valida_al, 'periodo rovesciato' as problema
from misure a
where a.valida_dal > a.valida_al
union all
select a.misura_id, a.carburante, a.valida_dal, a.valida_al, 'periodi sovrapposti' as problema
from misure a
join misure b
    on a.misura_id = b.misura_id and a.carburante = b.carburante
    and a.valida_dal < b.valida_dal and a.valida_al >= b.valida_dal
