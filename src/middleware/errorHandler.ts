import type { NextFunction, Request, Response } from "express";
import type { ApiFailureBody } from "../types/api";

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const message = err instanceof Error ? err.message : "Erreur interne";
  console.error("[vtc-core-api]", err);

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
