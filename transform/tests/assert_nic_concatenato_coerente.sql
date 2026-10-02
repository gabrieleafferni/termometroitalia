-- La serie NIC concatenata deve essere completa e senza salti artificiali:
-- 1. nessun mese mancante tra il primo e l'ultimo;
-- 2. arriva all'ultimo mese pubblicato dall'ISTAT (se no, c'è una base nuova
--    da aggiungere in int_istat__nic_concatenato);
-- 3. nessuna variazione mensile oltre il 5% (il massimo storico è circa +3,4%,
--    ottobre 2022): un raccordo sbagliato tra basi produrrebbe un salto.
with serie as (
    select
        mese,
        indice,
        lag(mese) over (order by mese) as mese_prima,
        lag(indice) over (order by mese) as indice_prima
    from {{ ref('int_istat__nic_concatenato') }}
)

select 'mese mancante' as problema, mese
from serie
where mese_prima is not null and mese_prima <> cast(mese - interval 1 month as date)

union all

select 'serie concatenata incompleta', (select max(mese) from {{ ref('int_istat__nic_concatenato') }})
where (select max(mese) from {{ ref('int_istat__nic_concatenato') }})
    <> (select max(mese) from {{ ref('stg_istat__nic') }})

union all

select 'salto anomalo', mese
from serie
where indice_prima is not null and abs(indice / indice_prima - 1) > 0.05
