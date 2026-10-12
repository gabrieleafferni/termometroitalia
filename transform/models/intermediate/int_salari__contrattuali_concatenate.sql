-- Retribuzioni contrattuali in un'unica serie dal gennaio 2005, in base
-- dicembre 2021 = 100, per tipo (oraria, per dipendente), qualifica e settore.
--
-- Gli indici hanno base dicembre (2005, 2010, 2015, 2021) e pesi diversi in ogni
-- base: sui mesi in comune le basi non sono proporzionali (base 2021 / base 2015
-- tra 0,949 e 0,955 nel 2019-2023). Si usa quindi ogni base dal dicembre del suo
-- anno base e la si raccorda alla successiva in quel dicembre: coefficiente =
-- indice della base nuova / indice della base vecchia nel dicembre della base nuova.
-- Con una nuova base va aggiunta una riga a "periodi": il test
-- assert_salari_concatenati_coerenti segnala buchi o salti.

with indici as (
    select * from {{ ref('stg_salari__contrattuali') }}
),

periodi as (
    select * from (values
        ('2005', date '2005-01-01', date '2010-11-01', date '2010-12-01', '2010'),
        ('2010', date '2010-12-01', date '2015-11-01', date '2015-12-01', '2015'),
        ('2015', date '2015-12-01', date '2021-11-01', date '2021-12-01', '2021'),
        ('2021', date '2021-12-01', date '9999-12-01', null, null)
    ) as t(base, dal, al, mese_raccordo, base_successiva)
),

raccordo as (
    -- coefficiente che porta la base vecchia nella successiva, serie per serie
    select
        p.base,
        v.tipo, v.qualifica, v.settore,
        n.indice / v.indice as coefficiente
    from periodi as p
    inner join indici as v
        on v.base = p.base and v.mese = p.mese_raccordo
    inner join indici as n
        on n.base = p.base_successiva and n.mese = p.mese_raccordo
        and n.tipo = v.tipo and n.qualifica = v.qualifica and n.settore = v.settore
),

moltiplicatori as (
    -- per portare una base in base 2021 si moltiplica per i coefficienti di tutte
    -- le basi da quella in poi; la base 2021 non ne ha (moltiplicatore 1).
    -- Una serie senza raccordo (settore assente in una base) si ferma lì.
    select
        p.base, s.tipo, s.qualifica, s.settore,
        coalesce(product(r.coefficiente), 1) as moltiplicatore,
        count(r.coefficiente) as raccordi
    from periodi as p
    cross join (select distinct tipo, qualifica, settore from indici where base = '2021') as s
    left join raccordo as r
        on cast(r.base as integer) >= cast(p.base as integer)
        and r.tipo = s.tipo and r.qualifica = s.qualifica and r.settore = s.settore
    group by p.base, s.tipo, s.qualifica, s.settore
),

basi_attese as (
    -- quante basi successive deve attraversare ogni base (2005: tre raccordi)
    select base, (select count(*) from periodi as q where cast(q.base as integer) > cast(p.base as integer)) as raccordi_attesi
    from periodi as p
)

select
    i.mese,
    i.tipo,
    i.qualifica,
    i.settore,
    round(i.indice * m.moltiplicatore, 4) as indice,
    i.indice as indice_originale,
    i.base as base_originale,
    i.provvisorio
from indici as i
inner join periodi as p
    on i.base = p.base and i.mese between p.dal and p.al
inner join moltiplicatori as m
    on m.base = i.base and m.tipo = i.tipo and m.qualifica = i.qualifica and m.settore = i.settore
inner join basi_attese as b
    on b.base = i.base and m.raccordi = b.raccordi_attesi
order by i.tipo, i.qualifica, i.settore, i.mese
