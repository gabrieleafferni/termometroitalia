-- Dal barile alla pompa:
-- 1. una riga per settimana e carburante;
-- 2. il prezzo industriale non può stare sotto il costo del greggio per più di
--    10 centesimi, né sopra di oltre 1,5 €/l: fuori da qui c'è un errore di unità
--    (dollari invece di euro, barili invece di litri) o di allineamento delle date;
-- 3. la serie copre almeno l'80% delle settimane MASE (i buchi sono solo le
--    settimane senza quotazioni, come quella di Capodanno 2005).
select 'riga ripetuta' as problema, data, carburante
from {{ ref('mart_carburanti__barile_settimanale') }}
group by data, carburante
having count(*) > 1

union all

select 'differenza implausibile', data, carburante
from {{ ref('mart_carburanti__barile_settimanale') }}
where differenza < -0.10 or differenza > 1.5

union all

select 'copertura insufficiente', null, carburante
from (
    select s.carburante, count(b.data) as n_barile, count(*) as n_storico
    from {{ ref('mart_carburanti__storico_settimanale') }} as s
    left join {{ ref('mart_carburanti__barile_settimanale') }} as b
        on b.data = s.data and b.carburante = s.carburante
    where s.carburante in ('benzina', 'gasolio') and s.prezzo_netto is not null
    group by s.carburante
)
where n_barile < 0.8 * n_storico
