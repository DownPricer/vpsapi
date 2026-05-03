import type { NextFunction, Request, Response } from "express";
import { QuoteService } from "../services/quote.service";
import { sendSuccess, sendValidationError } from "../utils/apiResponse";
import { isPricingDebugAuthorized } from "../utils/pricingDebugAuth";
import { parseBody } from "../validation/parseBody";
import { objectPayloadSchema } from "../validation/schemas";

const quoteService = new QuoteService();

export async function postDevis(req: Request, res: Response, next: NextFunction): Promise<void> {
  const parsed = parseBody(objectPayloadSchema, req.body ?? {});
  if (!parsed.ok) {
    sendValidationError(res, parsed.message, parsed.details);
    return;
  }

  try {
    const includeDebug = isPricingDebugAuthorized(req);
    const data = await quoteService.processDevis(req.tenant, parsed.data, includeDebug);
    const { pricingDebug, ...responseBody } = data;
    sendSuccess(res, responseBody, {
      tenantId: req.tenantId,
      ...(pricingDebug ? { pricingDebug } : {}),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (
      message.startsWith("Type de service inconnu") ||
      message.includes("nom") ||
      message.includes("prenom") ||
      message.includes("email") ||
      message.includes("telephone") ||
      message.includes("Champs client")
    ) {
      sendValidationError(res, message);
      return;
    }
    if (message.includes("DISTANCE_MATRIX_API_KEY")) {
      res.status(500).json({
        success: false,
        error: { code: "CONFIG_ERROR", message },
      });
      return;
    }
    if (message.includes("SMTP") || message.includes("MAIL_FROM") || message.includes("smtp.")) {
      res.status(503).json({
        success: false,
        error: { code: "MAIL_UNAVAILABLE", message },
      });
      return;
    }
    next(e);
  }
}
