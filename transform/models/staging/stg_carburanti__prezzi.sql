-- Una riga per impianto x carburante x modalità (self/servito) x giorno.
-- La data di riferimento viene dal nome del file (data di estrazione MIMIT).

with src as (
    select
        cast(regexp_extract(filename, 'prezzi_(\d{4}-\d{2}-\d{2})', 1) as date) as data,
        id_impianto,
        trim(carburante) as carburante_originale,
        prezzo,
        self,
        dt_comunicazione
    from {{ source('carburanti_raw', 'prezzi') }}
)

select
    data,
    id_impianto,
    carburante_originale,
    -- I quattro carburanti "base" usati dal MIMIT per i prezzi medi.
    -- Le varianti premium (Blue Diesel, HVO, Hi-Q...) restano come 'altro'.
    case lower(carburante_originale)
        when 'benzina' then 'benzina'
        when 'gasolio' then 'gasolio'
        when 'gpl' then 'gpl'
        when 'metano' then 'metano'
        else 'altro'
    end as carburante,
    case when self then 'self' else 'servito' end as modalita,
    prezzo,
    dt_comunicazione,
    date_diff('day', cast(dt_comunicazione as date), data) as giorni_da_comunicazione
from src
where prezzo > 0
