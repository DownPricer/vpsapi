import type { Response } from "express";
import type { ApiFailureBody, ApiSuccessBody } from "../types/api";

export function sendSuccess<T>(res: Response, data?: T, meta?: Record<string, unknown>): void {
  const body: ApiSuccessBody<T> = {
    success: true,
    ...(data !== undefined ? { data } : {}),
    ...(meta ? { meta } : {}),
  };
  res.status(200).json(body);
}

export function sendNotImplemented(
  res: Response,
  feature: string,
  tenantId: string
): void {
  const body: ApiFailureBody = {
    success: false,
    error: {
      code: "NOT_IMPLEMENTED",
      message: `Fonctionnalité « ${feature} » : migration depuis le template prévue — squelette uniquement.`,
    },
    meta: { tenantId },
  };
  res.status(501).json(body);
}

export function sendValidationError(res: Response, message: string, details?: unknown): void {
  const body: ApiFailureBody = {
    success: false,
    error: {
      code: "VALIDATION_ERROR",
      message,
      details,
    },
  };
  res.status(400).json(body);
}

export function sendTenantNotFound(res: Response, tenantId: string): void {
  const body: ApiFailureBody = {
    success: false,
    error: {
      code: "TENANT_NOT_FOUND",
      message: `Locataire inconnu : ${tenantId}`,
    },
  };
  res.status(404).json(body);
}
