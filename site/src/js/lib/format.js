import { formatLocale, timeFormatLocale } from "d3";

// Formattazione all'italiana: virgola decimale, punto per le migliaia.
const num = formatLocale({ decimal: ",", thousands: ".", grouping: [3], currency: ["", " €"] });
const time = timeFormatLocale({
  dateTime: "%A %e %B %Y, %X",
  date: "%d/%m/%Y",
  time: "%H:%M:%S",
  periods: ["AM", "PM"],
  days: ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"],
  shortDays: ["dom", "lun", "mar", "mer", "gio", "ven", "sab"],
  months: ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"],
  shortMonths: ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"],
});

export const fmt = {
  prezzo: num.format(",.3f"), // 2,159
  prezzo2: num.format(",.2f"), // 2,16
  euro: (x) => num.format(",.2f")(x) + " €",
  intero: num.format(",d"),
  cent: (deltaEuro, digits = 1) => {
    const c = deltaEuro * 100;
    if (Math.abs(c) < 0.05) return "±0,0";
    return (c > 0 ? "+" : "−") + num.format(`,.${digits}f`)(Math.abs(c));
  },
  pct: num.format(",.1%"),
  giorno: time.format("%e %B"),
  giornoAnno: time.format("%e %B %Y"),
  giornoBreve: time.format("%e %b"),
  settimana: time.format("%a %e %b"),
};

export const parseDay = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export const NOMI = { benzina: "Benzina", gasolio: "Gasolio", gpl: "GPL", metano: "Metano" };
export const NOMI_RIF = { benzina: "Benzina self", gasolio: "Gasolio self", gpl: "GPL servito", metano: "Metano servito" };
export const UNITA = { benzina: "€/l", gasolio: "€/l", gpl: "€/l", metano: "€/kg" };
