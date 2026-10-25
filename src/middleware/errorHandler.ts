import type { NextFunction, Request, Response } from "express";
import type { ApiFailureBody } from "../types/api";
import { trackFromRequest } from "../platform/telemetry.service";
import { PhotoUploadError } from "../modules/fleet/photoStorage";
import { VehicleError, VehicleSelectionError } from "../services/vehicle.service";
import { VehicleScheduleMissingError, VehicleUnavailableError } from "../services/vehicleAvailability.service";

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const message = err instanceof Error ? err.message : "Erreur interne";

  // Erreurs métier de la flotte : réponse explicite (409 véhicule déjà réservé, 422 capacité, 413 photo trop lourde…).
  if (
    err instanceof VehicleUnavailableError ||
    err instanceof VehicleScheduleMissingError ||
    err instanceof VehicleSelectionError ||
    err instanceof VehicleError ||
    err instanceof PhotoUploadError
  ) {
    if (!res.headersSent) {
      res.status(err.status).json({
        success: false,
        error: {
          code: err.code,
          message: err.message,
          ...(err instanceof VehicleUnavailableError ? { details: { conflicts: err.conflicts } } : {}),
        },
      });
    }
    return;
  }
  console.error("[vtc-core-api]", err);

  const route = typeof req.originalUrl === "string" ? req.originalUrl : req.path;
  const isPlatform = route.startsWith("/api/platform") || route.startsWith("/admin");
  void trackFromRequest({
    tenantId: (req as any).tenantId ?? null,
    type: isPlatform ? "admin_error" : "api_error",
    category: "error",
    reqIp: req.ip,
    forwardedFor: typeof req.headers["x-forwarded-for"] === "string" ? req.headers["x-forwarded-for"] : undefined,
    userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
    path: route,
    referrer: typeof req.headers.referer === "string" ? req.headers.referer : undefined,
    metadata: {
      status: 500,
      message: (message || "Erreur interne").slice(0, 200),
    },
  });

  const body: ApiFailureBody = {
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message,
    },
  };
  if (!res.headersSent) {
    res.status(500).json(body);
  }
}
