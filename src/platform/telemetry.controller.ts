import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { loadEnv } from "../config/env";
import { PLATFORM_EVENT_TYPES } from "./telemetry.types";
import { trackFromRequest } from "./telemetry.service";

const allowedTypes = new Set<string>(PLATFORM_EVENT_TYPES as readonly string[]);

const bodySchema = z.object({
  tenantId: z.string().trim().min(1).max(80).optional(),
  type: z.string().trim().min(1).max(80),
  category: z.string().trim().max(80).optional(),
  path: z.string().trim().max(300).optional(),
  referrer: z.string().trim().max(300).optional(),
  sessionId: z.string().trim().max(80).optional(),
  visitorId: z.string().trim().max(80).optional(),
  metadata: z.unknown().optional(),
  consentAnalytics: z.boolean().optional(),
});

function approximateJsonSizeBytes(v: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(v ?? null), "utf8");
  } catch {
    return 999999;
  }
}

export async function postTelemetryEvent(req: Request, res: Response, _next: NextFunction): Promise<void> {
  const env = loadEnv();
  if (!env.telemetryEnabled) {
    // Réponse neutre (ne pas casser le front).
    res.status(204).end();
    return;
  }

  const parsed = bodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Événement invalide." },
    });
    return;
  }

  if (!allowedTypes.has(parsed.data.type)) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Type d'événement non autorisé." },
    });
    return;
  }

  // RGPD: page_view uniquement si consentAnalytics=true côté front (si fourni).
  if (parsed.data.type === "page_view" && parsed.data.consentAnalytics !== true) {
    res.status(204).end();
    return;
  }

  const size = approximateJsonSizeBytes(parsed.data.metadata);
  if (size > 10_000) {
    res.status(400).json({
      success: false,
      error: { code: "PAYLOAD_TOO_LARGE", message: "metadata trop volumineux." },
    });
    return;
  }

  void trackFromRequest({
    tenantId: parsed.data.tenantId ?? null,
    type: parsed.data.type,
    category: parsed.data.category ?? "public",
    reqIp: req.ip,
    forwardedFor: typeof req.headers["x-forwarded-for"] === "string" ? req.headers["x-forwarded-for"] : undefined,
    userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
    path: parsed.data.path ?? req.path,
    referrer: parsed.data.referrer ?? (typeof req.headers.referer === "string" ? req.headers.referer : undefined),
    sessionId: parsed.data.sessionId ?? null,
    visitorId: parsed.data.visitorId ?? null,
    metadata: parsed.data.metadata,
  });

  res.status(204).end();
}

