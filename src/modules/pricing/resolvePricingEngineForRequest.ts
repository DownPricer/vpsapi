import type { TenantConfig } from "../../types/tenant";
import type { TenantPricingEngineConfig } from "./engineTypes";
import { mapPricingConfigToEngine } from "./mapPricingConfigToEngine";
import { PricingConfigValidationError, validatePricingConfigPayload } from "./validatePricingConfigPayload";

export type PricingConfigSource = "tenant_engine" | "payload_pricing_config";

export class PricingConfigRequestError extends Error {
  readonly code = "VALIDATION_ERROR";
  readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = "PricingConfigRequestError";
    this.details = details;
  }
}

export function resolvePricingEngineForRequest(
  tenant: TenantConfig,
  body: Record<string, unknown>
): { engine: TenantPricingEngineConfig; source: PricingConfigSource; pricingConfigVersion?: string } {
  const rawPricingConfig = body.pricingConfig;
  if (rawPricingConfig === undefined) {
    return { engine: tenant.pricingEngine, source: "tenant_engine" };
  }
  try {
    const pricingConfig = validatePricingConfigPayload(rawPricingConfig);
    const engine = mapPricingConfigToEngine(pricingConfig);
    return {
      engine,
      source: "payload_pricing_config",
      pricingConfigVersion: pricingConfig.version,
    };
  } catch (error) {
    if (error instanceof PricingConfigValidationError) {
      throw new PricingConfigRequestError("Configuration tarifaire invalide.", error.details);
    }
    throw error;
  }
}

