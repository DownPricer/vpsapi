import { z } from "zod";
import type { TenantConfigFile } from "../../types/tenant";

const coordinatesSchema = z.object({
  lat: z.number(),
  lng: z.number(),
});

const addressSchema = z.object({
  label: z.string(),
  city: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
  coordinates: coordinatesSchema.optional(),
});

const legalSchema = z
  .object({
    siret: z.string().optional(),
    tvaIntracom: z.string().optional(),
    rcs: z.string().optional(),
  })
  .optional();

const companySchema = z.object({
  name: z.string(),
  legalName: z.string().optional(),
  legal: legalSchema,
});

export const tenantFileSchema = z.object({
  id: z.string().min(1),
  engineRef: z.string().min(1),
  company: companySchema,
  baseAddress: addressSchema,
  serviceArea: z.object({
    description: z.string(),
    regions: z.array(z.string()).optional(),
  }),
  pricing: z.object({
    notes: z.string().optional(),
    strategyId: z.string().optional(),
  }),
  airports: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      notes: z.string().optional(),
    })
  ),
  smtp: z.object({
    toEmail: z.string().email(),
    fromName: z.string().optional(),
    fromEmail: z.string().email().optional(),
    sendCustomerConfirmation: z.boolean().optional(),
  }),
  branding: z
    .object({
      siteUrl: z.string().url().optional(),
      logoUrl: z.string().url().optional(),
    })
    .optional(),
});

export function parseTenantFile(raw: unknown): TenantConfigFile {
  return tenantFileSchema.parse(raw) as TenantConfigFile;
}
