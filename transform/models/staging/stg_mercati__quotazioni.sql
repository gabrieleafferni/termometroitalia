-- Quotazioni giornaliere di mercato (Brent, raffinati NY Harbor, cambio BCE),
-- in formato lungo. I file sono uno per mese e si riscrivono quando cambiano:
-- non ci sono duplicati tra file (lo verifica assert_quotazioni_grana_unica).

select
    data,
    serie,
    valore,
    fonte
from {{ source('mercati_raw', 'quotazioni') }}
