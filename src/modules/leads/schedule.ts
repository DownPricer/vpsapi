import { DateTime } from "luxon";
import type { TenantPricingEngineConfig } from "../pricing/engineTypes";

export function inferScheduleRange(
  flat: Record<string, string>,
  engine: TenantPricingEngineConfig
): { start: Date | null; end: Date | null } {
  const rawStart = flat.GoogleCreneauDebut;
  const rawEnd = flat.GoogleCreneauFin;

  if (rawStart && rawStart !== "N/A" && rawEnd && rawEnd !== "N/A") {
    const start = DateTime.fromISO(rawStart);
    const end = DateTime.fromISO(rawEnd);
    if (start.isValid && end.isValid) {
      return { start: start.toJSDate(), end: end.toJSDate() };
    }
  }

  if (
    flat.DateAller &&
    flat.DateAller !== "N/A" &&
    flat.HeureAller &&
    flat.HeureAller !== "N/A"
  ) {
    const start = DateTime.fromFormat(
      `${flat.DateAller} ${flat.HeureAller}`,
      "dd/MM/yyyy HH:mm",
      { zone: engine.timezone }
    );
    if (start.isValid) {
      return { start: start.toJSDate(), end: start.plus({ minutes: 90 }).toJSDate() };
    }
  }
  return { start: null, end: null };
}
