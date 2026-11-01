import type { Response } from "express";
import { DistanceUnavailableError } from "../modules/distance/distanceMatrix";

/** Répond 422 / 503 pour une erreur Distance Matrix (message FR, sans détail interne). */
export function sendDistanceUnavailable(res: Response, err: DistanceUnavailableError): void {
  const code =
    err.causeCode === "ADDRESS_NOT_FOUND" ? "ADDRESS_NOT_FOUND" : "DISTANCE_UNAVAILABLE";
  res.status(err.httpStatus).json({
    success: false,
    error: {
      code,
      message: err.message,
    },
  });
}

export function isDistanceUnavailableError(e: unknown): e is DistanceUnavailableError {
  return e instanceof DistanceUnavailableError;
}
