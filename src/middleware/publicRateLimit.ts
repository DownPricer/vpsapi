import { loadEnv } from "../config/env";
import { createRateLimiter } from "./rateLimit";

/**
 * Limiteurs des routes publiques BFF (contact, devis, réservation, calculer-tarif).
 * Mode lu une fois au chargement du module (redémarrer après changement d'env).
 */
const env = loadEnv();

export function createPublicRouteRateLimiter(key: string, max: number, windowMs = 10 * 60 * 1000) {
  return createRateLimiter({
    windowMs,
    max,
    key,
    ipSource: "public",
    bffSharedSecret: env.bffSharedSecret,
    publicRateLimitMode: env.publicRateLimit,
  });
}
