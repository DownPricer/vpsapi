import type { Request } from "express";
import crypto from "node:crypto";

/**
 * Secret partagé pour activer le breakdown tarifaire en réponse (`meta.pricingDebug`).
 * Définir `PRICING_DEBUG_SECRET` sur le serveur et envoyer l’en-tête `X-Pricing-Debug-Secret` identique.
 * Sans variable : le mode debug est toujours désactivé.
 */
export function getPricingDebugSecret(): string {
  return process.env.PRICING_DEBUG_SECRET?.trim() ?? "";
}

export function isPricingDebugAuthorized(req: Request): boolean {
  const configured = getPricingDebugSecret();
  if (!configured) return false;
  const header = req.get("x-pricing-debug-secret")?.trim() ?? "";
  if (!header) return false;
  const a = Buffer.from(header, "utf8");
  const b = Buffer.from(configured, "utf8");
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
