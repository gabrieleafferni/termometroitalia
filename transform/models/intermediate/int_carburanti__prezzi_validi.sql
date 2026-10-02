-- Prezzi "puliti", arricchiti con geografia, con i flag che decidono cosa
-- entra nelle medie. Segue la metodologia MIMIT per i prezzi medi:
--   * solo Benzina, Gasolio, GPL, Metano
--   * prezzo comunicato da non più di N giorni (var giorni_validita_prezzo)
--   * riferimento: self per benzina e gasolio, servito per GPL e metano
-- In più escludo gli errori di digitazione grossolani: prezzi sotto il 60% o
-- sopra il 150% della mediana nazionale del giorno per quel prodotto.
-- Il filtro è volutamente largo: prezzi "anomali" ma veri (Livigno, zona
-- extradoganale; pompe bianche; autostrade) devono restare nei dati.

with prezzi as (
    -- se un impianto comunica due volte lo stesso prodotto, tengo l'ultima
    select *
    from {{ ref('stg_carburanti__prezzi') }}
    where carburante <> 'altro'
    qualify row_number() over (
        partition by data, id_impianto, carburante, modalita
        order by dt_comunicazione desc
    ) = 1
),

con_geo as (
    select
        p.*,
        i.nome,
        i.indirizzo,
        i.bandiera,
        i.tipo_impianto,
        i.comune,
        i.sigla_provincia,
        pr.provincia,
        pr.regione,
        pr.cod_regione,
        i.lat,
        i.lon
    from prezzi p
    left join {{ ref('stg_carburanti__impianti') }} i using (id_impianto)
    left join {{ ref('province') }} pr on pr.sigla = i.sigla_provincia
),

statistiche as (
    select
        data,
        carburante,
        modalita,
        median(prezzo) as mediana_giorno
    from con_geo
    where giorni_da_comunicazione between 0 and {{ var('giorni_validita_prezzo') }}
    group by all
)

select
    c.*,
    (c.carburante in ('benzina', 'gasolio') and c.modalita = 'self')
        or (c.carburante in ('gpl', 'metano') and c.modalita = 'servito') as is_riferimento,
    c.giorni_da_comunicazione between 0 and {{ var('giorni_validita_prezzo') }} as is_recente,
    c.prezzo < {{ var('soglia_outlier_bassa') }} * s.mediana_giorno
        or c.prezzo > {{ var('soglia_outlier_alta') }} * s.mediana_giorno as is_outlier
from con_geo c
left join statistiche s using (data, carburante, modalita)
