import type { NextFunction, Request, Response } from "express";
import { loadEnv } from "../config/env";
import { PLATFORM_ADMIN_COOKIE_NAME, verifyPlatformAdminSession } from "./platformSession";

export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction): void {
  const env = loadEnv();
  if (!env.platformAdminEnabled) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Route indisponible." },
    });
    return;
  }
  const token = (req.cookies?.[PLATFORM_ADMIN_COOKIE_NAME] as string | undefined) ?? "";
  if (!token) {
    res.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Authentification super-admin requise." },
    });
    return;
  }
  try {
    const claims = verifyPlatformAdminSession(env, token);
    req.platformAdmin = {
      id: claims.sub,
      email: claims.email,
      role: claims.role,
      ...(Object.prototype.hasOwnProperty.call(claims, "name") ? { name: claims.name ?? null } : {}),
    };
    next();
  } catch {
    res.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Session super-admin invalide ou expirée." },
    });
  }
}

