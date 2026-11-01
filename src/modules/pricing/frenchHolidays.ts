/**
 * Jours fériés français calculés (11 jours civils), fuseau Europe/Paris.
 * Pâques via algorithme de Meeus/Jones/Butcher (dimanche de Pâques).
 * Aucune dépendance externe.
 */

/** Dimanche de Pâques (année civile grégorienne). */
export function easterSunday(year: number): { year: number; month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { year, month, day };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatDdMmYyyy(year: number, month: number, day: number): string {
  return `${pad2(day)}/${pad2(month)}/${year}`;
}

/** Ajoute `days` à une date civile (sans fuseau) — suffisant pour dérivés de Pâques. */
function addDays(
  y: number,
  m: number,
  d: number,
  days: number
): { year: number; month: number; day: number } {
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return {
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth() + 1,
    day: dt.getUTCDate(),
  };
}

/**
 * Les 11 jours fériés français pour une année donnée, au format dd/MM/yyyy.
 * Ordre chronologique.
 */
export function frenchPublicHolidays(year: number): string[] {
  const easter = easterSunday(year);
  const easterMonday = addDays(easter.year, easter.month, easter.day, 1);
  const ascension = addDays(easter.year, easter.month, easter.day, 39);
  const pentecostMonday = addDays(easter.year, easter.month, easter.day, 50);

  return [
    formatDdMmYyyy(year, 1, 1),
    formatDdMmYyyy(easterMonday.year, easterMonday.month, easterMonday.day),
    formatDdMmYyyy(year, 5, 1),
    formatDdMmYyyy(year, 5, 8),
    formatDdMmYyyy(ascension.year, ascension.month, ascension.day),
    formatDdMmYyyy(pentecostMonday.year, pentecostMonday.month, pentecostMonday.day),
    formatDdMmYyyy(year, 7, 14),
    formatDdMmYyyy(year, 8, 15),
    formatDdMmYyyy(year, 11, 1),
    formatDdMmYyyy(year, 11, 11),
    formatDdMmYyyy(year, 12, 25),
  ];
}

/** Indique si `dd/MM/yyyy` est un férié français légal (calcul programmatique). */
export function isFrenchPublicHoliday(dateDdMmYyyy: string): boolean {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dateDdMmYyyy);
  if (!m) return false;
  const year = Number(m[3]);
  return frenchPublicHolidays(year).includes(dateDdMmYyyy);
}
