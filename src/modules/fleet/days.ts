import { DateTime } from "luxon";

export const DEFAULT_TENANT_TIMEZONE = "Europe/Paris";
/** Garde-fou : une réservation n'occupe jamais plus que ce nombre de jours civils. */
export const MAX_OCCUPATION_DAYS = 31;

/**
 * Jours civils (`YYYY-MM-DD`) couverts par [start, end] dans le fuseau du tenant.
 * Toujours calculé en fuseau local (jamais en UTC) : une course à 00h30 Europe/Paris le 15 occupe le 15, pas le 14.
 * Le passage heure d'été/hiver ne décale aucun jour car on itère sur des dates civiles, pas sur des multiples de 24 h.
 */
export function localDaysBetween(start: Date, end: Date | null | undefined, timezone: string): string[] {
  const tz = timezone || DEFAULT_TENANT_TIMEZONE;
  const s = DateTime.fromJSDate(start, { zone: tz }).startOf("day");
  let e = end ? DateTime.fromJSDate(end, { zone: tz }).startOf("day") : s;
  if (!s.isValid) return [];
  if (!e.isValid || e < s) e = s;
  const days: string[] = [];
  let cursor = s;
  while (cursor <= e && days.length < MAX_OCCUPATION_DAYS) {
    days.push(cursor.toISODate()!);
    cursor = cursor.plus({ days: 1 });
  }
  return days;
}

/** `YYYY-MM-DD` → Date UTC minuit, valeur attendue par les colonnes `@db.Date` (aucun décalage de fuseau). */
export function dayKeyToDate(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

export function dateToDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isValidDayKey(key: unknown): key is string {
  return typeof key === "string" && /^\d{4}-\d{2}-\d{2}$/.test(key) && DateTime.fromISO(key).isValid;
}

export function eachDayKey(startKey: string, endKey: string): string[] {
  const out: string[] = [];
  let c = DateTime.fromISO(startKey, { zone: "utc" });
  const e = DateTime.fromISO(endKey, { zone: "utc" });
  while (c <= e && out.length < 366) {
    out.push(c.toISODate()!);
    c = c.plus({ days: 1 });
  }
  return out;
}
