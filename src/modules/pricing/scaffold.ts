import type { TenantConfig } from "../../types/tenant";

/** Conservé pour les services non migrés (devis, etc.) — logique réelle : `calculator.ts` / `PricingService`. */
export class PricingModule {
  calculateTariff(_tenant: TenantConfig, _body: unknown): void {}
}
