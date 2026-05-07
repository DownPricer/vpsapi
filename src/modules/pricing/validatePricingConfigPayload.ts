import { z } from "zod";
import type { PricingConfigPayload } from "./payloadConfig.types";

export const PRICING_CONFIG_MAX_SERIALIZED_BYTES = 256 * 1024;

const FORBIDDEN_KEY_NAMES_LOWER = new Set([
  "password",
  "passwordhash",
  "secret",
  "apikey",
  "token",
  "smtp_pass",
  "jwt_access_secret",
  "jwt_refresh_secret",
  "distance_matrix_api_key",
]);

const MAX_ARRAY_ITEMS_DEFAULT = 200;
const MAX_ARRAY_ITEMS_RULES = 500;

const finiteNonNegative = z.number().finite().min(0);
const boundedPercent = z.number().finite().min(0).max(100);
const nonEmptyString = z.string().trim().min(1);

const distanceRuleSchema = z
  .object({
    id: nonEmptyString,
    label: nonEmptyString,
    fromKm: finiteNonNegative.optional(),
    toKm: finiteNonNegative.optional(),
    pricePerKm: finiteNonNegative.max(1000),
    minimumPrice: finiteNonNegative.max(100000).optional(),
    enabled: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.fromKm !== undefined && value.toKm !== undefined && value.fromKm > value.toKm) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "distanceRules: fromKm doit etre inferieur ou egal a toKm.",
      });
    }
  });

const zoneDistanceBandSchema = z
  .object({
    zoneId: nonEmptyString,
    label: nonEmptyString,
    minPrincipalDistanceKm: finiteNonNegative.max(100000),
    maxPrincipalDistanceKm: finiteNonNegative.max(100000).optional(),
    minimumPrice: finiteNonNegative.max(100000),
    enabled: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.maxPrincipalDistanceKm !== undefined && value.minPrincipalDistanceKm > value.maxPrincipalDistanceKm) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "zoneBands: minPrincipalDistanceKm doit etre inferieur ou egal a maxPrincipalDistanceKm.",
      });
    }
  });

const passengerBandSchema = z
  .object({
    passengerMin: z.number().int().min(1).max(99),
    passengerMax: z.number().int().min(1).max(99),
    pricePerKm: finiteNonNegative.max(1000),
    minimumPrice: finiteNonNegative.max(100000),
  })
  .superRefine((value, ctx) => {
    if (value.passengerMin > value.passengerMax) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "airportTransfers.rules: passengerMin doit etre inferieur ou egal a passengerMax.",
      });
    }
  });

const surchargeSchema = z.object({
  id: nonEmptyString,
  label: nonEmptyString,
  type: z.enum(["night", "evening", "weekend", "holiday", "custom"]),
  mode: z.enum(["fixed", "percent"]),
  value: finiteNonNegative.max(100000),
  minAmount: finiteNonNegative.max(100000).optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  enabled: z.boolean(),
}).superRefine((value, ctx) => {
  if (value.mode === "percent" && value.value > 100) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "surcharges[].value doit etre <= 100 lorsque mode=percent.",
    });
  }
});

const discountSchema = z.object({
  id: nonEmptyString,
  label: nonEmptyString,
  trigger: z.enum(["round_trip", "city", "custom"]),
  mode: z.enum(["fixed", "percent"]),
  value: finiteNonNegative.max(100000),
  enabled: z.boolean(),
}).superRefine((value, ctx) => {
  if (value.mode === "percent" && value.value > 100) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "discounts[].value doit etre <= 100 lorsque mode=percent.",
    });
  }
});

const airportBufferSchema = z.object({
  preFlightMin: z.number().finite().min(0).max(1440),
  arrivalMin: z.number().finite().min(0).max(1440),
  dropoffMarginMin: z.number().finite().min(0).max(1440),
});

const pricingConfigPayloadSchema = z
  .object({
    version: z.literal("v1"),
    currency: z.literal("EUR"),
    timezone: nonEmptyString,
    vtcBaseAddress: nonEmptyString,
    publicHolidays: z.array(nonEmptyString).max(MAX_ARRAY_ITEMS_RULES),
    airportBuffers: z.record(airportBufferSchema).optional(),
    classicTrip: z
      .object({
        enabled: z.boolean(),
        zoneBands: z.array(zoneDistanceBandSchema).max(MAX_ARRAY_ITEMS_RULES),
        distanceRulesOneWay: z.array(distanceRuleSchema).max(MAX_ARRAY_ITEMS_RULES),
        distanceRulesRoundTrip: z.array(distanceRuleSchema).max(MAX_ARRAY_ITEMS_RULES),
        approach: z.object({
          enabled: z.boolean(),
          mode: z.enum(["min_of_approach_or_return_base", "always_approach", "none"]),
          pricePerKm: finiteNonNegative.max(1000),
        }),
        returnToBase: z.object({
          enabled: z.boolean(),
          mode: z.enum(["min_of_approach_or_return_base", "always_return_base", "none"]),
          pricePerKm: finiteNonNegative.max(1000),
        }),
        outOfPrimaryZone: z.object({
          enabled: z.boolean(),
          mode: z.enum(["multiplier", "fixed_surcharge"]),
          value: finiteNonNegative.max(1000),
          primaryCities: z.array(nonEmptyString).max(MAX_ARRAY_ITEMS_RULES).optional(),
          zoneSetId: nonEmptyString.optional(),
        }),
        supplementShortDistance: z
          .object({
            enabled: z.boolean(),
            fromKm: finiteNonNegative.max(100000),
            toKm: finiteNonNegative.max(100000),
            addPricePerKm: finiteNonNegative.max(1000),
          })
          .superRefine((value, ctx) => {
            if (value.fromKm > value.toKm) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "classicTrip.supplementShortDistance: fromKm doit etre inferieur ou egal a toKm.",
              });
            }
          })
          .optional(),
      })
      .strict(),
    airportTransfers: z
      .object({
        enabled: z.boolean(),
        rules: z
          .array(
            z.object({
              id: nonEmptyString,
              code: nonEmptyString,
              name: nonEmptyString,
              aliases: z.array(nonEmptyString).max(MAX_ARRAY_ITEMS_DEFAULT),
              address: nonEmptyString,
              oneWay: z.array(passengerBandSchema).max(MAX_ARRAY_ITEMS_DEFAULT),
              roundTrip: z.array(passengerBandSchema).max(MAX_ARRAY_ITEMS_DEFAULT),
              enabled: z.boolean(),
            })
          )
          .max(MAX_ARRAY_ITEMS_RULES),
        fallbackAirportCode: nonEmptyString.optional(),
      })
      .strict(),
    hourlyHire: z
      .object({
        enabled: z.boolean(),
        minimumTotal: finiteNonNegative.max(100000).optional(),
        rateRules: z
          .array(
            z.object({
              id: nonEmptyString,
              label: nonEmptyString,
              startsAtHour: z.number().int().min(0).max(23).optional(),
              endsAtHour: z.number().int().min(0).max(23).optional(),
              appliesOnWeekend: z.boolean().optional(),
              appliesOnHoliday: z.boolean().optional(),
              hourlyRate: finiteNonNegative.max(100000),
              enabled: z.boolean(),
            })
          )
          .max(MAX_ARRAY_ITEMS_RULES),
      })
      .strict(),
    surcharges: z.array(surchargeSchema).max(MAX_ARRAY_ITEMS_RULES),
    discounts: z.array(discountSchema).max(MAX_ARRAY_ITEMS_RULES),
    cityRules: z
      .array(
        z
          .object({
            id: nonEmptyString,
            city: nonEmptyString,
            postalCode: z.string().trim().max(16).optional(),
            type: z.enum(["discount", "fixed_price", "surcharge", "excluded"]),
            value: finiteNonNegative.max(100000).optional(),
            note: z.string().max(500).optional(),
            enabled: z.boolean(),
          })
          .superRefine((value, ctx) => {
            if (value.type !== "excluded" && value.value === undefined) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "cityRules[].value est obligatoire sauf pour type=excluded.",
              });
            }
          })
      )
      .max(MAX_ARRAY_ITEMS_RULES),
    options: z
      .array(
        z.object({
          id: nonEmptyString,
          label: nonEmptyString,
          mode: z.enum(["fixed", "percent"]),
          value: finiteNonNegative.max(100000),
          per: z.enum(["booking", "passenger", "bag", "hour"]),
          enabled: z.boolean(),
        }).superRefine((value, ctx) => {
          if (value.mode === "percent" && value.value > 100) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "options[].value doit etre <= 100 lorsque mode=percent.",
            });
          }
        })
      )
      .max(MAX_ARRAY_ITEMS_RULES),
    passengerBagPolicy: z
      .object({
        minPassengers: z.number().int().min(1).max(99),
        maxPassengers: z.number().int().min(1).max(99),
        bagPricingEnabled: z.boolean(),
        includedBags: z.number().int().min(0).max(99).optional(),
        extraBagPrice: finiteNonNegative.max(100000).optional(),
      })
      .superRefine((value, ctx) => {
        if (value.minPassengers > value.maxPassengers) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "passengerBagPolicy.minPassengers doit etre inferieur ou egal a maxPassengers.",
          });
        }
      })
      .optional(),
    rounding: z
      .object({
        classic: z.enum(["ceil", "nearest", "ceil_to_5"]),
        airport: z.enum(["ceil", "nearest", "ceil_to_5"]),
        hourlyHire: z.enum(["ceil", "nearest", "ceil_to_5"]),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.airportBuffers && Object.keys(value.airportBuffers).length > MAX_ARRAY_ITEMS_DEFAULT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `airportBuffers ne doit pas depasser ${MAX_ARRAY_ITEMS_DEFAULT} entrees.`,
      });
    }
    if (!Intl.supportedValuesOf("timeZone").includes(value.timezone)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `timezone invalide: ${value.timezone}`,
      });
    }

    value.publicHolidays.forEach((date, index) => {
      if (!/^\d{2}\/\d{2}\/\d{4}$/.test(date)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `publicHolidays[${index}] doit suivre le format dd/MM/yyyy.`,
        });
      }
    });

    // Exigence explicite: pourcentages bornes raisonnablement.
    for (const field of [value.surcharges, value.discounts]) {
      for (const rule of field) {
        if (rule.mode === "percent" && !boundedPercent.safeParse(rule.value).success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Un pourcentage doit etre compris entre 0 et 100.",
          });
        }
      }
    }
  });

export class PricingConfigValidationError extends Error {
  readonly code = "VALIDATION_ERROR";
  readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = "PricingConfigValidationError";
    this.details = details;
  }
}

function collectForbiddenKeyPaths(obj: unknown, pathPrefix: string[]): string[] {
  const violations: string[] = [];
  const walk = (node: unknown, path: string[]) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, [...path, String(index)]));
      return;
    }
    const rec = node as Record<string, unknown>;
    for (const key of Object.keys(rec)) {
      if (FORBIDDEN_KEY_NAMES_LOWER.has(key.toLowerCase())) {
        violations.push([...path, key].join("."));
      }
      walk(rec[key], [...path, key]);
    }
  };
  walk(obj, pathPrefix);
  return violations;
}

export function validatePricingConfigPayload(input: unknown): PricingConfigPayload {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new PricingConfigValidationError(
      "Le champ pricingConfig doit etre un objet JSON (pas un tableau ni une valeur primitive)."
    );
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(input);
  } catch {
    throw new PricingConfigValidationError("Impossible de serialiser pricingConfig en JSON.");
  }

  const byteLength = Buffer.byteLength(serialized, "utf8");
  if (byteLength > PRICING_CONFIG_MAX_SERIALIZED_BYTES) {
    throw new PricingConfigValidationError(
      `pricingConfig depasse la taille maximale autorisee (${PRICING_CONFIG_MAX_SERIALIZED_BYTES} octets).`,
      { byteLength }
    );
  }

  const forbiddenPaths = collectForbiddenKeyPaths(input, []);
  if (forbiddenPaths.length > 0) {
    throw new PricingConfigValidationError(
      "Des cles interdites ont ete detectees dans pricingConfig.",
      { forbiddenPaths }
    );
  }

  const parsed = pricingConfigPayloadSchema.safeParse(input);
  if (!parsed.success) {
    throw new PricingConfigValidationError("pricingConfig invalide.", parsed.error.flatten());
  }
  return parsed.data as PricingConfigPayload;
}

