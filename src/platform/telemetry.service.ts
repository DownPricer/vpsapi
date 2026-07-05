import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { loadEnv } from "../config/env";
import type { PlatformEventType } from "./telemetry.types";

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

function safeString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return truncate(t, max);
}

function hmacSha256Hex(secret: string, value: string): string {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function resolveClientIp(reqIp: string | undefined, forwardedFor: string | undefined): string | null {
  const xf = forwardedFor?.split(",")[0]?.trim();
  const ip = (xf && xf.length > 0 ? xf : reqIp)?.trim();
  if (!ip) return null;
  // IPv6 "mapped" IPv4 ::ffff:1.2.3.4
  const cleaned = ip.startsWith("::ffff:") ? ip.slice("::ffff:".length) : ip;
  return cleaned.length > 3 ? cleaned : null;
}

function simplifyUserAgent(uaRaw: string | null): string | null {
  if (!uaRaw) return null;
  return truncate(uaRaw.replace(/\s+/g, " ").trim(), 200);
}

const SENSITIVE_KEY_RE = /(pass(word)?|secret|token|api[_-]?key|stripe|smtp|database|jwt)/i;

function sanitizeMetadata(value: unknown, depth = 0): Prisma.InputJsonValue | null {
  if (depth > 5) return null;
  if (value === null) return null;
  const t = typeof value;
  if (t === "string") return truncate(value as string, 500);
  if (t === "number") return Number.isFinite(value as number) ? (value as number) : null;
  if (t === "boolean") return value as boolean;
  if (Array.isArray(value)) {
    return (value as unknown[]).slice(0, 50).map((v) => sanitizeMetadata(v, depth + 1)).filter((v) => v !== null) as unknown as Prisma.InputJsonValue;
  }
  if (t === "object") {
    const o = value as Record<string, unknown>;
    const out: Record<string, Prisma.InputJsonValue> = {};
    let count = 0;
    for (const [k, v] of Object.entries(o)) {
      if (count >= 50) break;
      if (SENSITIVE_KEY_RE.test(k)) continue;
      const sv = sanitizeMetadata(v, depth + 1);
      if (sv === null) continue;
      out[truncate(k, 80)] = sv;
      count += 1;
    }
    return out as unknown as Prisma.InputJsonValue;
  }
  return null;
}

export type TrackPlatformEventInput = {
  tenantId?: string | null;
  observedDomain?: string | null;
  origin?: string | null;
  type: PlatformEventType | string;
  category?: string | null;
  path?: string | null;
  referrer?: string | null;
  sessionId?: string | null;
  visitorId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: unknown;
};

export async function trackPlatformEvent(input: TrackPlatformEventInput): Promise<void> {
  const env = loadEnv();
  if (!env.telemetryEnabled) return;

  const secretForHash = env.platformSessionSecret || env.jwtAccessSecret || "telemetry";

  const ipHash = input.ip ? hmacSha256Hex(secretForHash, input.ip) : null;
  const ua = simplifyUserAgent(input.userAgent ?? null);
  const md = sanitizeMetadata(input.metadata);

  try {
    await prisma.platformEvent.create({
      data: {
        tenantId: input.tenantId ?? null,
        observedDomain: input.observedDomain ? truncate(input.observedDomain, 255) : null,
        origin: input.origin ? truncate(input.origin, 300) : null,
        type: truncate(String(input.type), 80),
        category: input.category ? truncate(input.category, 80) : null,
        path: input.path ? truncate(input.path, 300) : null,
        referrer: input.referrer ? truncate(input.referrer, 300) : null,
        sessionId: input.sessionId ? truncate(input.sessionId, 80) : null,
        visitorId: input.visitorId ? truncate(input.visitorId, 80) : null,
        ipHash,
        userAgent: ua,
        ...(md ? { metadata: md as Prisma.InputJsonValue } : {}),
      },
    });
  } catch {
    // Ne jamais bloquer le produit si la télémétrie échoue.
  }
}

export function trackFromRequest(params: {
  tenantId?: string | null;
  observedDomain?: string | null;
  origin?: string | null;
  type: PlatformEventType | string;
  category?: string | null;
  reqIp?: string;
  forwardedFor?: string;
  userAgent?: string;
  path?: string;
  referrer?: string;
  sessionId?: string | null;
  visitorId?: string | null;
  metadata?: unknown;
}): Promise<void> {
  const ip = resolveClientIp(params.reqIp, params.forwardedFor);
  return trackPlatformEvent({
    tenantId: params.tenantId ?? null,
    observedDomain: params.observedDomain ?? null,
    origin: params.origin ?? null,
    type: params.type,
    category: params.category ?? null,
    path: params.path ?? null,
    referrer: params.referrer ?? null,
    sessionId: params.sessionId ?? null,
    visitorId: params.visitorId ?? null,
    ip,
    userAgent: params.userAgent ?? null,
    metadata: params.metadata,
  });
}

