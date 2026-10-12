-- Retribuzione lorda oraria del settore privato (ISTAT, RACLI): ultimo snapshot
-- per settore (territorio = IT) e per provincia (settore = totale).
with settori as (
    select *, max(filename) over () as ultimo_file
    from {{ source('salari_raw', 'racli') }}
),

province as (
    select *, max(filename) over () as ultimo_file
    from {{ source('salari_raw', 'racli_province') }}
)

select anno, statistica, sesso, territorio, settore, euro_ora, 'settori' as fonte
from settori
where filename = ultimo_file

union all

select anno, statistica, sesso, territorio, settore, euro_ora, 'province' as fonte
from province
where filename = ultimo_file
