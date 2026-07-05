import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { loadEnv } from "../config/env";
import { PLATFORM_EVENT_TYPES } from "./telemetry.types";
import { trackFromRequest } from "./telemetry.service";
import { resolveTenantFromRequest } from "../tenancy/domainResolver";

const allowedTypes = new Set<string>(PLATFORM_EVENT_TYPES as readonly string[]);

const bodySchema = z.object({
  tenantId: z.string().trim().min(1).max(80).optional(),
  type: z.string().trim().min(1).max(80),
  category: z.string().trim().max(80).optional(),
  path: z.string().trim().max(300).optional(),
  siteDomain: z.string().trim().max(300).optional(),
  hostname: z.string().trim().max(300).optional(),
  origin: z.string().trim().max(300).optional(),
  href: z.string().trim().max(1000).optional(),
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

  const resolution = await resolveTenantFromRequest(req, {
    bodyTenantId: parsed.data.tenantId ?? null,
    fallbackTenantId: env.defaultTenantId,
    allowPendingCreate: true,
    telemetryMode: true,
    metadata: {
      ...(typeof parsed.data.metadata === "object" && parsed.data.metadata ? parsed.data.metadata : {}),
      siteDomain: parsed.data.siteDomain,
      hostname: parsed.data.hostname,
      origin: parsed.data.origin,
      href: parsed.data.href,
    },
  });

  void trackFromRequest({
    tenantId: resolution.tenantId,
    observedDomain: resolution.observedDomain,
    origin: parsed.data.origin ?? resolution.origin,
    type: parsed.data.type,
    category: parsed.data.category ?? "public",
    reqIp: req.ip,
    forwardedFor: typeof req.headers["x-forwarded-for"] === "string" ? req.headers["x-forwarded-for"] : undefined,
    userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
    path: parsed.data.path ?? req.path,
    referrer: parsed.data.referrer ?? (typeof req.headers.referer === "string" ? req.headers.referer : undefined),
    sessionId: parsed.data.sessionId ?? null,
    visitorId: parsed.data.visitorId ?? null,
    metadata: {
      ...(typeof parsed.data.metadata === "object" && parsed.data.metadata ? (parsed.data.metadata as Record<string, unknown>) : {}),
      siteDomain: parsed.data.siteDomain ?? undefined,
      hostname: parsed.data.hostname ?? undefined,
      href: parsed.data.href ?? undefined,
      tenantResolution: resolution.source,
      matchedDomain: resolution.matchedDomain ?? undefined,
      domainStatus: resolution.domainStatus ?? undefined,
    },
  });

  res.status(204).end();
}

