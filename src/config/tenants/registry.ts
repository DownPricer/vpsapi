import type { TenantConfig, TenantConfigFile } from "../../types/tenant";
import { buildPricingEngineForTenant } from "./engineLoader";
import { parseTenantFile } from "./schema";
import defaultTenant from "./clients/default.json";
import clientDemo from "./clients/client-demo.json";

const rawList = [defaultTenant, clientDemo] as const;

function finalizeTenant(file: TenantConfigFile): TenantConfig {
  const pricingEngine = buildPricingEngineForTenant(file);
  return {
    ...file,
    pricingEngine,
  };
}

const byId = new Map<string, TenantConfig>();

for (const raw of rawList) {
  const file = parseTenantFile(raw);
  const config = finalizeTenant(file);
  if (byId.has(config.id)) {
    throw new Error(`Configuration locataire en double : ${config.id}`);
  }
  byId.set(config.id, config);
}

export function getTenantConfig(tenantId: string): TenantConfig | undefined {
  return byId.get(tenantId);
}

export function listTenantIds(): string[] {
  return [...byId.keys()];
}

export function listTenantConfigs(): TenantConfig[] {
  return [...byId.values()];
}
