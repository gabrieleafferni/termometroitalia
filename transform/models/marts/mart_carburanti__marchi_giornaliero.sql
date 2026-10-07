-- Prezzo per marchio e giorno, solo rete stradale (le misure dei marchi
-- escludono l'autostrada), con la quota di impianti entro il tetto Eni:
-- serve a vedere se Eni applica il tetto e se gli altri marchi la seguono.

with prezzi as (
    select *
    from {{ ref('int_carburanti__prezzi_validi') }}
    where is_riferimento and is_recente and not is_outlier
      and carburante in ('benzina', 'gasolio')
      and tipo_impianto = 'Stradale'
),

marchi as (
    select
        *,
        case
            when bandiera in ('Agip Eni', 'Api-Ip', 'Q8', 'Esso', 'Tamoil', 'Pompe Bianche') then bandiera
            else 'Altri marchi'
        end as marchio
    from prezzi
),

-- Il prezzo massimo può cambiare mentre la misura è in vigore (gasolio: 2,19 €/l
-- fino al 5 ottobre, 2,25 dal 6 con la fine dello sconto sulle accise): ogni giorno
-- si confronta con quello in vigore quel giorno. Prima dell'inizio vale il primo
-- livello, dopo la fine l'ultimo, come riferimento.
tetto as (
    select
        carburante, prezzo_max, valida_dal, valida_al,
        min(valida_dal) over (partition by carburante) as inizio_misura,
        max(valida_al) over (partition by carburante) as fine_misura
    from {{ ref('misure_prezzo') }}
    where misura_id = 'tetto_eni_2026'
)

select
    m.data,
    m.marchio,
    m.carburante,
    count(distinct m.id_impianto) as n_impianti,
    round(avg(cast(m.prezzo as decimal(9, 4))), 4) as media,
    round(median(m.prezzo), 4) as mediana,
    t.prezzo_max as tetto_eni,
    round(avg(case when m.prezzo <= t.prezzo_max + 0.0005 then 1 else 0 end), 4) as quota_entro_tetto_eni,
    -- il file MIMIT fotografa i prezzi alle 8:00: chi non ha ancora comunicato un
    -- nuovo prezzo quel giorno risulta col prezzo precedente. Per leggere l'adesione
    -- a una misura appena partita conta anche la quota tra chi ha aggiornato.
    count(distinct case when cast(m.dt_comunicazione as date) = m.data then m.id_impianto end) as n_aggiornati_oggi,
    round(
        sum(case when cast(m.dt_comunicazione as date) = m.data and m.prezzo <= t.prezzo_max + 0.0005 then 1 else 0 end)
        / nullif(sum(case when cast(m.dt_comunicazione as date) = m.data then 1 else 0 end), 0),
    4) as quota_entro_tetto_aggiornati,
    m.data between t.inizio_misura and t.fine_misura as tetto_in_vigore
from marchi m
join tetto t
    on t.carburante = m.carburante
    and (
        m.data between t.valida_dal and t.valida_al
        or (m.data < t.inizio_misura and t.valida_dal = t.inizio_misura)
        or (m.data > t.fine_misura and t.valida_al = t.fine_misura)
    )
group by m.data, m.marchio, m.carburante, t.prezzo_max, t.inizio_misura, t.fine_misura
order by m.data, m.carburante, m.marchio
