import type { Request } from "express";
import { prisma } from "../db/prisma";
import { getTenantConfig } from "../config/tenants/registry";

const TECHNICAL_DOMAINS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "vercel.com",
  "www.vercel.com",
  "vercel.app",
  "api.sitereadyshd.fr",
]);

function safeString(v: unknown, max = 500): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

function getByPath(root: unknown, path: string): unknown {
  if (!root || typeof root !== "object") return undefined;
  const parts = path.split(".");
  let cur: any = root;
  for (const p of parts) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}

export function normalizeDomain(raw: unknown): string | null {
  const value = safeString(raw, 500);
  if (!value) return null;

  let input = value.toLowerCase();
  if (input.startsWith("//")) input = `https:${input}`;

  try {
    const urlish = input.includes("://") ? input : `https://${input}`;
    const u = new URL(urlish);
    input = u.hostname;
  } catch {
    input = input.split("/")[0] ?? input;
  }

  input = input.trim().replace(/\.$/, "");
  input = input.replace(/:\d+$/, "");
  if (!input) return null;
  return input;
}

export function withoutWww(domain: string): string {
  return domain.startsWith("www.") ? domain.slice(4) : domain;
}

export function isTechnicalDomain(domain: string | null | undefined): boolean {
  if (!domain) return true;
  const d = withoutWww(domain.toLowerCase());
  if (TECHNICAL_DOMAINS.has(d)) return true;
  if (d.endsWith(".vercel.app")) return true;
  if (d.endsWith(".localhost")) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(d)) return true;
  return false;
}

function firstHeader(req: Request, key: string): string | null {
  const raw = req.headers[key.toLowerCase()];
  if (Array.isArray(raw)) return safeString(raw[0]);
  return safeString(raw);
}

function extractMetadataDomain(metadata: unknown): string | null {
  const keys = ["siteDomain", "hostname", "origin", "href"];
  for (const key of keys) {
    const d = normalizeDomain(getByPath(metadata, key));
    if (d) return d;
  }
  return null;
}

export function extractObservedDomain(req: Request, metadata?: unknown): { domain: string | null; origin: string | null } {
  const origin = firstHeader(req, "origin");
  const referer = firstHeader(req, "referer") ?? firstHeader(req, "referrer");
  const siteDomain = firstHeader(req, "x-site-domain");
  const metaDomain = extractMetadataDomain(metadata);

  const candidates = [
    siteDomain,
    origin,
    referer,
    metaDomain,
    safeString((req as any).hostname, 300),
  ];

  for (const c of candidates) {
    const d = normalizeDomain(c);
    if (d && !isTechnicalDomain(d)) {
      return { domain: d, origin: origin ?? null };
    }
  }

  // On garde le domaine technique en metadata, mais il ne doit pas devenir site client.
  const technical = candidates.map((c) => normalizeDomain(c)).find(Boolean) ?? null;
  return { domain: technical && !isTechnicalDomain(technical) ? technical : null, origin: origin ?? null };
}

async function findDomain(domain: string) {
  const normalized = normalizeDomain(domain);
  if (!normalized) return null;
  const aliases = Array.from(new Set([normalized, withoutWww(normalized), `www.${withoutWww(normalized)}`]));
  return prisma.tenantDomain.findFirst({
    where: { domain: { in: aliases } },
    orderBy: [{ canonicalDomain: "desc" }, { updatedAt: "desc" }],
  });
}

export async function observeUnknownDomain(domain: string, source: "manual" | "observed_origin" | "settings" | "env" = "observed_origin") {
  const normalized = normalizeDomain(domain);
  if (!normalized || isTechnicalDomain(normalized)) return null;
  const existing = await findDomain(normalized);
  if (existing) {
    return prisma.tenantDomain.update({
      where: { id: existing.id },
      data: { lastSeenAt: new Date() },
    });
  }
  return prisma.tenantDomain.create({
    data: {
      domain: normalized,
      status: "pending",
      source,
      canonicalDomain: false,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    },
  });
}

export type ResolveTenantFromRequestOptions = {
  bodyTenantId?: string | null;
  metadata?: unknown;
  fallbackTenantId: string;
  allowPendingCreate?: boolean;
  telemetryMode?: boolean;
};

export type TenantRequestResolution = {
  tenantId: string | null;
  source: "domain_active" | "header" | "fallback_default" | "pending_domain" | "none";
  observedDomain: string | null;
  matchedDomain: string | null;
  domainStatus: "active" | "pending" | "rejected" | "archived" | null;
  origin: string | null;
};

export async function resolveTenantFromRequest(
  req: Request,
  options: ResolveTenantFromRequestOptions
): Promise<TenantRequestResolution> {
  const { domain: observedDomain, origin } = extractObservedDomain(req, options.metadata);

  if (observedDomain && !isTechnicalDomain(observedDomain)) {
    const row = await findDomain(observedDomain);
    if (row) {
      await prisma.tenantDomain.update({ where: { id: row.id }, data: { lastSeenAt: new Date() } });
      if (row.status === "active" && row.tenantId) {
        return {
          tenantId: row.tenantId,
          source: "domain_active",
          observedDomain,
          matchedDomain: row.domain,
          domainStatus: row.status,
          origin,
        };
      }
      return {
        tenantId: options.telemetryMode ? null : null,
        source: "pending_domain",
        observedDomain,
        matchedDomain: row.domain,
        domainStatus: row.status,
        origin,
      };
    }

    if (options.allowPendingCreate) {
      await observeUnknownDomain(observedDomain, "observed_origin");
      return {
        tenantId: options.telemetryMode ? null : null,
        source: "pending_domain",
        observedDomain,
        matchedDomain: null,
        domainStatus: "pending",
        origin,
      };
    }
  }

  const headerTenant = safeString(options.bodyTenantId ?? firstHeader(req, "x-tenant-id"), 80);
  if (headerTenant && getTenantConfig(headerTenant)) {
    return {
      tenantId: headerTenant,
      source: "header",
      observedDomain,
      matchedDomain: null,
      domainStatus: null,
      origin,
    };
  }

  if (process.env.NODE_ENV !== "production" && getTenantConfig(options.fallbackTenantId)) {
    return {
      tenantId: options.fallbackTenantId,
      source: "fallback_default",
      observedDomain,
      matchedDomain: null,
      domainStatus: null,
      origin,
    };
  }

  if (getTenantConfig(options.fallbackTenantId)) {
    return {
      tenantId: options.fallbackTenantId,
      source: "fallback_default",
      observedDomain,
      matchedDomain: null,
      domainStatus: null,
      origin,
    };
  }

  return {
    tenantId: null,
    source: "none",
    observedDomain,
    matchedDomain: null,
    domainStatus: null,
    origin,
  };
}

