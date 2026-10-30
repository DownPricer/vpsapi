import type { NextFunction, Request, Response } from "express";

/**
 * Limiteur en mémoire pour endpoints sensibles.
 * Suffisant pour une instance unique ; derrière plusieurs instances, préférer Redis/proxy.
 *
 * Clé client :
 * - `X-Client-Ip` (IP visiteur transmise explicitement par le BFF Next) si présente et plausible ;
 * - sinon premier hop `X-Forwarded-For` (Nginx → API, avec `trust proxy`) ;
 * - sinon `req.ip`.
 *
 * Les routes contact/devis/réservation/calculer-tarif passent aujourd'hui par le conteneur Next :
 * sans `X-Client-Ip`, toutes les requêtes partagent l'IP du BFF. Pour ces routes, utiliser
 * `requireClientIpHeader: true` afin de ne limiter que lorsque le front a transmis l'IP réelle
 * (évite de bloquer tout un site client).
 */

const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^[0-9a-fA-F:]+$/;

export function isPlausibleIp(raw: string): boolean {
  const s = raw.trim();
  if (!s || s.length > 45 || /\s/.test(s)) return false;
  if (IPV4_RE.test(s)) {
    return s.split(".").every((p) => {
      const n = Number(p);
      return Number.isInteger(n) && n >= 0 && n <= 255;
    });
  }
  if (s.includes(":") && IPV6_RE.test(s)) return true;
  return false;
}

/** IP utilisée pour le limiteur (jamais une valeur arbitraire non IP). */
export function resolveRateLimitClientIp(req: Request): string {
  const explicit = req.header("x-client-ip")?.trim();
  if (explicit && isPlausibleIp(explicit)) return explicit;

  const xff = req.header("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim() ?? "";
    if (isPlausibleIp(first)) return first;
  }

  const ip = (req.ip ?? "").trim();
  if (ip && isPlausibleIp(ip)) return ip;
  return "unknown";
}

export type RateLimiterOptions = {
  windowMs: number;
  max: number;
  key: string;
  /** Clé composite (ex. login + e-mail). Si null → pas de limitation sur cette requête. */
  keyFrom?: (req: Request) => string | null;
  /**
   * Si true : n'applique le quota que lorsque `X-Client-Ip` est fourni (IP visiteur BFF).
   * Sans ce header, laisse passer (évite de partager un bucket sur l'IP du conteneur Next).
   */
  requireClientIpHeader?: boolean;
};

export function createRateLimiter(opts: RateLimiterOptions) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return function rateLimit(req: Request, res: Response, next: NextFunction): void {
    if (opts.requireClientIpHeader) {
      const hdr = req.header("x-client-ip")?.trim();
      if (!hdr || !isPlausibleIp(hdr)) {
        next();
        return;
      }
    }

    const now = Date.now();
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    }

    const custom = opts.keyFrom?.(req);
    if (custom === null) {
      next();
      return;
    }
    const id = custom ?? `${opts.key}:${resolveRateLimitClientIp(req)}`;
    const entry = hits.get(id);
    if (!entry || entry.resetAt <= now) {
      hits.set(id, { count: 1, resetAt: now + opts.windowMs });
      next();
      return;
    }
    entry.count += 1;
    if (entry.count > opts.max) {
      res.setHeader("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      res.status(429).json({
        success: false,
        error: { code: "RATE_LIMITED", message: "Trop de tentatives. Réessayez dans quelques minutes." },
      });
      return;
    }
    next();
  };
}
