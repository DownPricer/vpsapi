import { createHash, randomBytes } from "node:crypto";
import type { LeadRequest } from "@prisma/client";
import { prisma } from "../db/prisma";
import type { TenantConfig } from "../types/tenant";

const MIN_VALIDITY_MS = 7 * 24 * 3600 * 1000;
const MAX_VALIDITY_MS = 365 * 24 * 3600 * 1000;
const POST_RIDE_GRACE_MS = 48 * 3600 * 1000;

export function generateBookingToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Seul le hash est stocké : une fuite de la base ne permet pas d'ouvrir une réservation. */
export function hashBookingToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isPlausibleBookingToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{40,64}$/.test(token);
}

/** Expiration : 48 h après la course, au minimum 7 jours, au maximum 1 an. */
export function computeTokenExpiry(now: Date, scheduledStart: Date | null): Date {
  const base = scheduledStart ? scheduledStart.getTime() + POST_RIDE_GRACE_MS : now.getTime() + MIN_VALIDITY_MS;
  const bounded = Math.min(Math.max(base, now.getTime() + MIN_VALIDITY_MS), now.getTime() + MAX_VALIDITY_MS);
  return new Date(bounded);
}

export async function issueBookingAccessToken(lead: Pick<LeadRequest, "id" | "tenantId" | "scheduledStart">): Promise<string> {
  const token = generateBookingToken();
  await prisma.bookingAccessToken.create({
    data: {
      tenantId: lead.tenantId,
      leadRequestId: lead.id,
      tokenHash: hashBookingToken(token),
      expiresAt: computeTokenExpiry(new Date(), lead.scheduledStart),
    },
  });
  return token;
}

/** Lien de gestion public : le jeton est lié à UNE réservation et à UN tenant. */
export function buildBookingManageUrl(tenant: TenantConfig, token: string): string | null {
  const base = (tenant.branding?.siteUrl?.trim() || process.env.PUBLIC_SITE_URL?.trim() || "").replace(/\/$/, "");
  if (!base || !base.startsWith("https://")) return null;
  return `${base}/reservation/gerer?token=${encodeURIComponent(token)}`;
}

/** Meilleur effort : un échec de création du lien ne doit jamais bloquer l'envoi d'un e-mail. */
export async function tryBuildManageUrl(
  tenant: TenantConfig,
  lead: Pick<LeadRequest, "id" | "tenantId" | "scheduledStart">
): Promise<string | null> {
  try {
    const token = await issueBookingAccessToken(lead);
    return buildBookingManageUrl(tenant, token);
  } catch (e) {
    console.warn(`[booking-access] jeton non créé (lead=${lead.id}) : ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

export type ResolvedBookingAccess =
  | { ok: true; lead: LeadRequest; tokenId: string }
  | { ok: false; reason: "invalid" | "expired" };

export async function resolveBookingAccess(tenantId: string, token: unknown): Promise<ResolvedBookingAccess> {
  if (!isPlausibleBookingToken(token)) return { ok: false, reason: "invalid" };
  const row = await prisma.bookingAccessToken.findUnique({
    where: { tokenHash: hashBookingToken(token) },
    include: { leadRequest: true },
  });
  // Même réponse « invalid » pour jeton inconnu / autre tenant / révoqué : aucune information divulguée.
  if (!row || row.tenantId !== tenantId || row.leadRequest.tenantId !== tenantId || row.revokedAt) {
    return { ok: false, reason: "invalid" };
  }
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };
  await prisma.bookingAccessToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  return { ok: true, lead: row.leadRequest, tokenId: row.id };
}
