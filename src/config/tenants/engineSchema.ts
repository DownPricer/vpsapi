import { z } from "zod";
import type { TenantPricingEngineConfig } from "../../modules/pricing/engineTypes";

/**
 * Validation du JSON moteur (`*.engine.json`).
 * Les grilles `taTable` / `tcTable` restent typées largement pour éviter une duplication du schéma métier.
 */
export const tenantPricingEngineJsonSchema = z.object({
  timezone: z.string().min(1),
  depotAddress: z.string().optional(),
  publicHolidays: z.array(z.string()),
  airportBuffers: z.record(
    z.object({
      preFlightMin: z.number(),
      arrivalMin: z.number(),
      dropoffMarginMin: z.number(),
    })
  ),
  airports: z.record(
    z.object({
      names: z.array(z.string()),
      address: z.string(),
    })
  ),
  taTable: z.record(z.record(z.record(z.object({ tarifKm: z.number(), min: z.number() })))),
  tcTable: z.object({
    SIMPLE: z.object({
      ZONES: z.record(
        z.object({
          min: z.number(),
          tarifsKm: z.record(z.number()),
        })
      ),
      APPROCHE: z.number(),
    }),
    AR: z.object({
      ZONES: z.record(
        z.object({
          min: z.number(),
          tarifsKm: z.record(z.number()),
        })
      ),
      APPROCHE: z.number(),
    }),
  }),
  maj: z.object({
    pctNight: z.number(),
    pctEvening: z.number(),
    pctWE: z.number(),
    pctFerie: z.number(),
    minEuros: z.number(),
  }),
  applyArDiscount: z.boolean(),
  outOfPrimaryServiceZoneMultiplier: z.number(),
  primaryServiceZoneSetId: z.string().min(1),
  madHourlyRates: z.object({
    default: z.number(),
    eveningOrNight: z.number(),
    weekendOrHoliday: z.number(),
  }),
  madEventMinimumTotal: z.number(),
  calendarEventTitlePrefix: z.string(),
});

export function parsePricingEngineJson(raw: unknown): TenantPricingEngineConfig {
  return tenantPricingEngineJsonSchema.parse(raw) as TenantPricingEngineConfig;
}
