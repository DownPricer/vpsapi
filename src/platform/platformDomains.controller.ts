import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db/prisma";
import { normalizeDomain, observeUnknownDomain, withoutWww } from "../tenancy/domainResolver";

function safeString(v: unknown, max = 200): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

function slugifyDomain(domain: string): string {
  return withoutWww(domain)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "tenant";
}

async function getEventStatsByDomain() {
  const rows = await prisma.$queryRaw<Array<{
    observedDomain: string;
    cnt: bigint;
    firstAt: Date;
    lastAt: Date;
    types: string[];
  }>>`
    SELECT
      "observedDomain" as "observedDomain",
      count(*)::bigint as cnt,
      min("createdAt") as "firstAt",
      max("createdAt") as "lastAt",
      array_remove(array_agg(DISTINCT "type"), NULL) as types
    FROM "PlatformEvent"
    WHERE "observedDomain" IS NOT NULL
    GROUP BY 1
  `;
  return new Map(rows.map((r) => [r.observedDomain, {
    eventsCount: Number(r.cnt),
    firstEventAt: r.firstAt,
    lastEventAt: r.lastAt,
    eventTypes: r.types ?? [],
  }]));
}

export async function getPlatformDomains(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const [domains, stats] = await Promise.all([
      prisma.tenantDomain.findMany({
        orderBy: [{ status: "asc" }, { lastSeenAt: "desc" }],
        include: { tenant: { select: { id: true, name: true, slug: true, active: true } } },
        take: 1000,
      }),
      getEventStatsByDomain(),
    ]);

    res.status(200).json({
      success: true,
      data: {
        domains: domains.map((d) => ({
          id: d.id,
          tenantId: d.tenantId,
          tenant: d.tenant,
          domain: d.domain,
          canonicalDomain: d.canonicalDomain,
          status: d.status,
          source: d.source,
          firstSeenAt: d.firstSeenAt,
          lastSeenAt: d.lastSeenAt,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
          ...(stats.get(d.domain) ?? { eventsCount: 0, firstEventAt: null, lastEventAt: null, eventTypes: [] }),
        })),
      },
    });
  } catch (e) {
    next(e);
  }
}

export async function confirmPlatformDomain(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantId = safeString(req.body?.tenantId, 80);
  const canonicalDomain = req.body?.canonicalDomain === true;
  if (!tenantId) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "tenantId requis." } });
    return;
  }

  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      res.status(404).json({ success: false, error: { code: "TENANT_NOT_FOUND", message: "Tenant introuvable." } });
      return;
    }
    const current = await prisma.tenantDomain.findUnique({ where: { id: req.params.id } });
    if (!current) {
      res.status(404).json({ success: false, error: { code: "DOMAIN_NOT_FOUND", message: "Domaine introuvable." } });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (canonicalDomain) {
        await tx.tenantDomain.updateMany({
          where: { tenantId, canonicalDomain: true, NOT: { id: current.id } },
          data: { canonicalDomain: false },
        });
      }
      const row = await tx.tenantDomain.update({
        where: { id: current.id },
        data: {
          tenantId,
          status: "active",
          canonicalDomain,
          source: current.source === "observed_origin" ? "manual" : current.source,
          lastSeenAt: new Date(),
        },
      });
      await tx.platformEvent.updateMany({
        where: { observedDomain: row.domain, tenantId: null },
        data: { tenantId },
      });
      return row;
    });

    res.status(200).json({ success: true, data: { domain: updated } });
  } catch (e) {
    next(e);
  }
}

export async function rejectPlatformDomain(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const updated = await prisma.tenantDomain.update({
      where: { id: req.params.id },
      data: { status: "rejected", lastSeenAt: new Date() },
    });
    res.status(200).json({ success: true, data: { domain: updated } });
  } catch (e) {
    next(e);
  }
}

export async function createTenantFromDomain(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const current = await prisma.tenantDomain.findUnique({ where: { id: req.params.id } });
    if (!current) {
      res.status(404).json({ success: false, error: { code: "DOMAIN_NOT_FOUND", message: "Domaine introuvable." } });
      return;
    }
    const base = slugifyDomain(current.domain);
    const tenantId = safeString(req.body?.tenantId, 80) ?? base;
    const name = safeString(req.body?.name, 120) ?? base.replace(/-/g, " ");
    const slug = safeString(req.body?.slug, 80) ?? base;

    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.upsert({
        where: { id: tenantId },
        create: {
          id: tenantId,
          name,
          slug,
          active: true,
          configRef: "default",
          settings: {
            general: { commercialName: name, legalName: name },
            branding: { siteUrl: `https://${current.domain}` },
          },
        },
        update: { name, slug, active: true },
      });
      const domain = await tx.tenantDomain.update({
        where: { id: current.id },
        data: { tenantId: tenant.id, status: "active", canonicalDomain: true, source: "manual", lastSeenAt: new Date() },
      });
      await tx.platformEvent.updateMany({
        where: { observedDomain: domain.domain, tenantId: null },
        data: { tenantId: tenant.id },
      });
      return { tenant, domain };
    });

    res.status(201).json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
}

export async function createPlatformTenant(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantId = safeString(req.body?.tenantId, 80);
  const name = safeString(req.body?.name, 120);
  if (!tenantId || !name) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "tenantId et name requis." } });
    return;
  }
  try {
    const slug = safeString(req.body?.slug, 80) ?? tenantId;
    const tenant = await prisma.tenant.create({
      data: { id: tenantId, name, slug, active: true, configRef: "default" },
    });
    res.status(201).json({ success: true, data: { tenant } });
  } catch (e) {
    next(e);
  }
}

export async function addTenantDomain(req: Request, res: Response, next: NextFunction): Promise<void> {
  const domain = normalizeDomain(req.body?.domain);
  const canonicalDomain = req.body?.canonicalDomain === true;
  if (!domain) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Domaine invalide." } });
    return;
  }
  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.params.tenantId } });
    if (!tenant) {
      res.status(404).json({ success: false, error: { code: "TENANT_NOT_FOUND", message: "Tenant introuvable." } });
      return;
    }
    await observeUnknownDomain(domain, "manual");
    const updated = await prisma.tenantDomain.update({
      where: { domain },
      data: { tenantId: tenant.id, status: "active", source: "manual", canonicalDomain, lastSeenAt: new Date() },
    });
    res.status(201).json({ success: true, data: { domain: updated } });
  } catch (e) {
    next(e);
  }
}

