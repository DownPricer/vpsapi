import type { TenantConfig } from "../../types/tenant";

/** Conservé pour les services non migrés — logique réelle : `distanceMatrix.ts` / `calculerDistances`. */
export class DistanceModule {
  computeDistances(_tenant: TenantConfig, _body: unknown): void {}
}
