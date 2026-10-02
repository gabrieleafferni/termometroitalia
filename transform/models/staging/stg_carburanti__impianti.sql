-- Anagrafica corrente degli impianti: ultima versione di ogni impianto nel
-- change log. Gli impianti chiusi restano (flag attivo = false) perché i loro
-- prezzi storici vanno comunque attribuiti a una provincia.

with sorgente as (
    select * from {{ source('carburanti_raw', 'impianti') }}
    -- l'indirizzo si salva dai file del 2/10/2026: con UNION BY NAME la colonna
    -- esiste comunque (vuota) anche quando si leggono solo file più vecchi
    union all by name
    select null::varchar as indirizzo where false
),

versioni as (
    select
        *,
        row_number() over (partition by id_impianto order by valido_dal desc) as rn
    from sorgente
),

ultima as (
    select * from versioni where rn = 1
),

-- per un impianto chiuso tengo gli attributi dell'ultima versione "viva"
ultima_viva as (
    select *
    from (
        select *, row_number() over (partition by id_impianto order by valido_dal desc) as rn2
        from versioni
        where azione <> 'chiusura'
    )
    where rn2 = 1
)

select
    u.id_impianto,
    coalesce(v.bandiera, u.bandiera) as bandiera,
    coalesce(v.tipo, u.tipo) as tipo_impianto,
    coalesce(v.nome, u.nome) as nome,
    coalesce(v.indirizzo, u.indirizzo) as indirizzo,
    coalesce(v.comune, u.comune) as comune,
    coalesce(v.provincia, u.provincia) as sigla_provincia,
    coalesce(v.lat, u.lat) as lat,
    coalesce(v.lon, u.lon) as lon,
    u.azione <> 'chiusura' as attivo,
    min_valido.primo_avvistamento
from ultima u
left join ultima_viva v using (id_impianto)
left join (
    select id_impianto, min(valido_dal) as primo_avvistamento
    from sorgente
    group by 1
) min_valido using (id_impianto)
