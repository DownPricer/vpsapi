import type { NextFunction, Request, Response } from "express";
import { PricingConfigRequestError } from "../modules/pricing";
import { PricingService } from "../services/pricing.service";
import { sendSuccess, sendValidationError } from "../utils/apiResponse";
import { isPricingDebugAuthorized } from "../utils/pricingDebugAuth";
import { parseBody } from "../validation/parseBody";
import { objectPayloadSchema } from "../validation/schemas";
import { trackFromRequest } from "../platform/telemetry.service";
import { resolveServiceTypeKey } from "../services/pricing.service";

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
    const includeDebug = isPricingDebugAuthorized(req);
    const { serialized, pricingDebug, pricingConfigSource, pricingConfigVersion } = await pricingService.computeTariffForRequest(
      req.tenant,
      parsed.data,
      { includeDebug }
    );
    void trackFromRequest({
      tenantId: req.tenantId,
      type: "calculator_quote_success",
      category: "calculator",
      reqIp: req.ip,
      forwardedFor: typeof req.headers["x-forwarded-for"] === "string" ? req.headers["x-forwarded-for"] : undefined,
      userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
      path: "/api/calculer-tarif",
      referrer: typeof req.headers.referer === "string" ? req.headers.referer : undefined,
      metadata: {
        serviceType: resolveServiceTypeKey(parsed.data) ?? "unknown",
        estimatedPrice: typeof (serialized as any)?.tarif === "number" ? (serialized as any).tarif : undefined,
        pricingConfigSource,
        pricingConfigVersion: pricingConfigVersion ?? undefined,
      },
    });
    sendSuccess(res, serialized, {
      tenantId: req.tenantId,
      ...(pricingDebug
        ? {
            pricingDebug: {
              ...pricingDebug,
              pricingConfigSource,
              ...(pricingConfigVersion ? { pricingConfigVersion } : {}),
            },
          }
        : {}),
    });
  } catch (e) {
    if (e instanceof PricingConfigRequestError) {
      void trackFromRequest({
        tenantId: req.tenantId,
        type: "calculator_quote_failed",
        category: "calculator",
        reqIp: req.ip,
        forwardedFor: typeof req.headers["x-forwarded-for"] === "string" ? req.headers["x-forwarded-for"] : undefined,
        userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
        path: "/api/calculer-tarif",
        referrer: typeof req.headers.referer === "string" ? req.headers.referer : undefined,
        metadata: {
          serviceType: resolveServiceTypeKey(parsed.data) ?? "unknown",
          reason: e.message,
        },
      });
      sendValidationError(
        res,
        e.message,
        process.env.NODE_ENV === "production" ? undefined : e.details
      );
      return;
    }
    const message = e instanceof Error ? e.message : String(e);
    if (message.startsWith("Type de service inconnu") || message.includes("Type de service")) {
      void trackFromRequest({
        tenantId: req.tenantId,
        type: "calculator_quote_failed",
        category: "calculator",
        reqIp: req.ip,
        forwardedFor: typeof req.headers["x-forwarded-for"] === "string" ? req.headers["x-forwarded-for"] : undefined,
        userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
        path: "/api/calculer-tarif",
        referrer: typeof req.headers.referer === "string" ? req.headers.referer : undefined,
        metadata: { reason: message },
      });
      sendValidationError(res, message);
      return;
    }
    if (message.includes("DISTANCE_MATRIX_API_KEY")) {
      void trackFromRequest({
        tenantId: req.tenantId,
        type: "api_error",
        category: "calculator",
        reqIp: req.ip,
        forwardedFor: typeof req.headers["x-forwarded-for"] === "string" ? req.headers["x-forwarded-for"] : undefined,
        userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
        path: "/api/calculer-tarif",
        referrer: typeof req.headers.referer === "string" ? req.headers.referer : undefined,
        metadata: { status: 500, message: "CONFIG_ERROR: DISTANCE_MATRIX_API_KEY" },
      });
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
