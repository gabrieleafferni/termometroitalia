-- Contratti scaduti: quota di dipendenti in attesa di rinnovo e mesi di attesa,
-- per comparto (totale, privato, PA, industria, servizi privati, agricoltura).
select
    mese,
    comparto,
    max(case when indicatore = 'quota_in_attesa' then valore end) / 100 as quota_in_attesa,
    max(case when indicatore = 'mesi_attesa_in_attesa' then valore end) as mesi_attesa_in_attesa,
    max(case when indicatore = 'mesi_attesa_tutti' then valore end) as mesi_attesa_tutti
from {{ ref('stg_salari__tensione') }}
group by mese, comparto
order by comparto, mese
