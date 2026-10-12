-- Settore per settore: quanto sono cambiate le retribuzioni contrattuali orarie
-- rispetto ai prezzi. Si confrontano medie di 12 mesi (ultimi 12 mesi contro
-- un anno di riferimento intero), così le una tantum non falsano il confronto.
-- Anni di riferimento: 2021 (prima dell'ondata di inflazione) e 2019 (prima del Covid).

with mensile as (
    select * from {{ ref('mart_salari__reali_mensile') }}
    where tipo = 'orario'
),

ultimo as (
    select max(mese) as ultimo_mese from mensile where settore = '0010' and qualifica = 'totale'
),

recenti as (
    select m.qualifica, m.settore, avg(m.indice) as indice, avg(m.nic) as nic, avg(m.ipca) as ipca, count(*) as mesi
    from mensile as m, ultimo as u
    where m.mese > u.ultimo_mese - interval 12 month and m.mese <= u.ultimo_mese
    group by all
),

riferimenti as (
    select year(mese) as anno_riferimento, qualifica, settore,
        avg(indice) as indice, avg(nic) as nic, avg(ipca) as ipca, count(*) as mesi
    from mensile
    where year(mese) in (2019, 2021)
    group by all
),

ultimo_mese as (
    select m.qualifica, m.settore, m.var_salari_tend, m.var_nic_tend, m.var_ipca_tend
    from mensile as m, ultimo as u
    where m.mese = u.ultimo_mese
)

select
    f.anno_riferimento,
    r.qualifica,
    r.settore,
    s.nome,
    s.nome_breve,
    s.livello,
    s.padre,
    s.ordine,
    u.ultimo_mese,
    round(r.indice / f.indice - 1, 5) as var_nominale,
    round(r.nic / f.nic - 1, 5) as var_prezzi_nic,
    round(r.ipca / f.ipca - 1, 5) as var_prezzi_ipca,
    round((r.indice / f.indice) / (r.nic / f.nic) - 1, 5) as var_reale_nic,
    round((r.indice / f.indice) / (r.ipca / f.ipca) - 1, 5) as var_reale_ipca,
    round(t.var_salari_tend, 5) as var_salari_tend,
    round(t.var_nic_tend, 5) as var_nic_tend,
    round(t.var_ipca_tend, 5) as var_ipca_tend
from recenti as r
inner join riferimenti as f using (qualifica, settore)
inner join {{ ref('settori_salari') }} as s on s.codice = r.settore
left join ultimo_mese as t using (qualifica, settore)
cross join ultimo as u
where r.mesi = 12 and f.mesi = 12
order by f.anno_riferimento, r.qualifica, s.ordine
