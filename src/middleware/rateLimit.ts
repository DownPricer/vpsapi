import type { NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "crypto";

/**
 * Limiteur en mémoire pour endpoints sensibles.
 * Suffisant pour une instance unique ; derrière plusieurs instances, préférer Redis/proxy.
 *
 * IP de confiance (login / défaut) : uniquement `req.ip` (Express + `trust proxy = 1`
 * lit l’adresse ajoutée par Nginx, pas les en-têtes fournis par le client).
 *
 * IP visiteur BFF : `X-Client-Ip` n’est cru que si `X-BFF-Auth` égale `BFF_SHARED_SECRET`
 * (comparaison à temps constant). Voir `PUBLIC_RATE_LIMIT` (off | trusted | strict).
 */

const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^[0-9a-fA-F:]+$/;

export type PublicRateLimitMode = "off" | "trusted" | "strict";

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

/** IP vue par Express derrière Nginx (`trust proxy`) — ignore X-Client-Ip / X-Forwarded-For brut. */
export function resolveTrustedProxyIp(req: Request): string {
  const ip = (req.ip ?? "").trim();
  if (ip && isPlausibleIp(ip)) return ip;
  // IPv6 mappée / formes Express courantes
  if (ip) return ip;
  return "unknown";
}

/** @deprecated préférer resolveTrustedProxyIp pour le login ; conserve l’ancien nom pour imports. */
export function resolveRateLimitClientIp(req: Request): string {
  return resolveTrustedProxyIp(req);
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) {
    // Comparaison factice pour limiter les fuites de timing sur la longueur
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

export function isBffAuthValid(req: Request, sharedSecret: string | undefined): boolean {
  if (!sharedSecret || sharedSecret.length < 32) return false;
  const provided = req.header("x-bff-auth")?.trim() ?? "";
  if (!provided) return false;
  return timingSafeEqualString(provided, sharedSecret);
}

/**
 * IP pour les endpoints publics (contact/devis/…).
 * - secret BFF valide + X-Client-Ip plausible → IP visiteur
 * - sinon → req.ip (jamais l’en-tête client non authentifié)
 */
export function resolvePublicVisitorIp(
  req: Request,
  sharedSecret: string | undefined
): { ip: string; trustedVisitor: boolean } {
  if (isBffAuthValid(req, sharedSecret)) {
    const explicit = req.header("x-client-ip")?.trim();
    if (explicit && isPlausibleIp(explicit)) {
      return { ip: explicit, trustedVisitor: true };
    }
  }
  return { ip: resolveTrustedProxyIp(req), trustedVisitor: false };
}

export type RateLimiterOptions = {
  windowMs: number;
  max: number;
  key: string;
  /** Clé composite. Si null → pas de limitation sur cette requête. */
  keyFrom?: (req: Request) => string | null;
  /**
   * Source d’IP pour la clé par défaut.
   * - `req.ip` (défaut) : jamais d’en-têtes client
   * - `public` : logique BFF (nécessite `bffSharedSecret` / mode via factory)
   */
  ipSource?: "req.ip" | "public";
  bffSharedSecret?: string;
  publicRateLimitMode?: PublicRateLimitMode;
};

function sendRateLimited(res: Response, resetAt: number, now: number): void {
  res.setHeader("Retry-After", String(Math.ceil((resetAt - now) / 1000)));
  res.status(429).json({
    success: false,
    error: { code: "RATE_LIMITED", message: "Trop de tentatives. Réessayez dans quelques minutes." },
  });
}

export function createRateLimiter(opts: RateLimiterOptions) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const mode = opts.publicRateLimitMode ?? "trusted";

  return function rateLimit(req: Request, res: Response, next: NextFunction): void {
    if (opts.ipSource === "public") {
      if (mode === "off") {
        next();
        return;
      }
      if (mode === "trusted") {
        const authOk = isBffAuthValid(req, opts.bffSharedSecret);
        const visitor = req.header("x-client-ip")?.trim();
        // Sans secret valide : ne rien limiter (sites non mis à jour / appel direct non BFF).
        if (!authOk || !visitor || !isPlausibleIp(visitor)) {
          next();
          return;
        }
      }
      // mode strict : toujours limiter (clé = IP visiteur si secret OK, sinon req.ip)
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

    let id = custom;
    if (id === undefined) {
      if (opts.ipSource === "public") {
        const { ip } = resolvePublicVisitorIp(req, opts.bffSharedSecret);
        id = `${opts.key}:${ip}`;
      } else {
        id = `${opts.key}:${resolveTrustedProxyIp(req)}`;
      }
    }

    const entry = hits.get(id);
    if (!entry || entry.resetAt <= now) {
      hits.set(id, { count: 1, resetAt: now + opts.windowMs });
      next();
      return;
    }
    entry.count += 1;
    if (entry.count > opts.max) {
      sendRateLimited(res, entry.resetAt, now);
      return;
    }
    next();
  };
}

/** Enchaîne plusieurs limiteurs (ex. login IP+email puis email seul). */
export function combineRateLimiters(
  ...limiters: Array<(req: Request, res: Response, next: NextFunction) => void>
) {
  return function combined(req: Request, res: Response, next: NextFunction): void {
    let i = 0;
    const run = (err?: unknown): void => {
      if (err) {
        next(err);
        return;
      }
      const lim = limiters[i++];
      if (!lim) {
        next();
        return;
      }
      lim(req, res, run);
    };
    run();
  };
}
