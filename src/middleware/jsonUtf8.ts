import type { NextFunction, Request, Response } from "express";

/**
 * Force les réponses JSON en UTF-8 explicite (évite les interprétations latin1 côté clients/proxies).
 */
export function jsonUtf8Middleware(_req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res);
  res.json = function jsonUtf8(body: unknown) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return originalJson(body);
  };
  next();
}
