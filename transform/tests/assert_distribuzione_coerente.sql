-- L'istogramma deve contare gli stessi distributori della media nazionale:
-- per ogni giorno e carburante la somma delle fasce è uguale a n_impianti.
with fasce as (
    select data, carburante, sum(n_impianti) as n_fasce
    from {{ ref('mart_carburanti__distribuzione_giornaliera') }}
    group by all
)

select f.data, f.carburante, f.n_fasce, n.n_impianti
from fasce f
join {{ ref('mart_carburanti__nazionale_giornaliero') }} n
  on n.data = f.data and n.carburante = f.carburante and n.modalita = 'self'
where f.n_fasce <> n.n_impianti
