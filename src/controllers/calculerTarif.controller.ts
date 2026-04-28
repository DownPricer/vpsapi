import type { NextFunction, Request, Response } from "express";
import { PricingService } from "../services/pricing.service";
import { sendSuccess, sendValidationError } from "../utils/apiResponse";
import { parseBody } from "../validation/parseBody";
import { objectPayloadSchema } from "../validation/schemas";

const pricingService = new PricingService();

export async function postCalculerTarif(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const parsed = parseBody(objectPayloadSchema, req.body ?? {});
  if (!parsed.ok) {
    sendValidationError(res, parsed.message, parsed.details);
    return;
  }

  try {
    const data = await pricingService.computeTariffForRequest(req.tenant, parsed.data);
    sendSuccess(res, data, { tenantId: req.tenantId });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.startsWith("Type de service inconnu") || message.includes("Type de service")) {
      sendValidationError(res, message);
      return;
    }
    if (message.includes("DISTANCE_MATRIX_API_KEY")) {
      res.status(500).json({
        success: false,
        error: {
          code: "CONFIG_ERROR",
          message,
        },
      });
      return;
    }
    next(e);
  }
}
