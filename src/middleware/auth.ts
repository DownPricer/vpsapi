import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../modules/auth/tokens";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    res.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Authentification requise." },
    });
    return;
  }

  try {
    const claims = verifyAccessToken(token);
    if (claims.tenantId !== req.tenantId) {
      res.status(403).json({
        success: false,
        error: { code: "FORBIDDEN", message: "Accès refusé pour ce locataire." },
      });
      return;
    }
    req.authUser = {
      id: claims.sub,
      tenantId: claims.tenantId,
      email: claims.email,
      role: claims.role,
    };
    next();
  } catch {
    res.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Session invalide ou expirée." },
    });
  }
}
