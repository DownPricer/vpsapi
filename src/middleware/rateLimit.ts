import type { NextFunction, Request, Response } from "express";

/**
 * Limiteur en mémoire (par IP + clé) pour les endpoints publics sensibles (jetons de réservation).
 * Suffisant pour une instance unique ; derrière plusieurs instances, préférer un limiteur partagé (Redis/proxy).
 */
export function createRateLimiter(opts: { windowMs: number; max: number; key: string }) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return function rateLimit(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    }
    const id = `${opts.key}:${req.ip ?? "unknown"}`;
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
