-- Ogni sigla di provincia presente nei dati deve essere nel seed province.csv
-- (se il MIMIT introduce nuove sigle, ad es. per riforme territoriali, lo vediamo qui).
{{ config(severity = 'warn') }}

select distinct i.sigla_provincia
from {{ ref('stg_carburanti__impianti') }} i
left join {{ ref('province') }} p on p.sigla = i.sigla_provincia
where i.attivo and p.sigla is null
