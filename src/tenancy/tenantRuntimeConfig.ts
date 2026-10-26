import { prisma } from "../db/prisma";
import { loadEnv } from "../config/env";
import { getTenantConfig } from "../config/tenants/registry";
import type { TenantConfig } from "../types/tenant";

/**
 * Tenants « base de données » : créés par `tenant:create`, ils n'ont pas de fichier dans `config/tenants/clients`.
 * Sans ce module, ils héritaient de l'identité du tenant par défaut (e-mail destinataire, nom, URL du site modèle).
 * Ici l'identité vient de la base : nom, e-mail de contact (ou 1er admin pro) et domaine canonique actif.
 */

const CACHE_TTL_MS = 60_000;

type Cached<T> = { value: T; at: number };
const baseUrlCache = new Map<string, Cached<string | null>>();
const runtimeCache = new Map<string, Cached<TenantConfig>>();

function fresh<T>(c: Cached<T> | undefined): c is Cached<T> {
  return Boolean(c && Date.now() - c.at < CACHE_TTL_MS);
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function isEmail(v: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
}

const knownCache = new Map<string, Cached<boolean>>();

/**
 * Un `X-Tenant-ID` est valide s'il désigne un tenant du registre OU un tenant actif en base
 * (les clients créés par `tenant:create` n'ont pas de fichier de config).
 */
export async function isKnownTenantId(tenantId: string): Promise<boolean> {
  if (getTenantConfig(tenantId)) return true;
  const hit = knownCache.get(tenantId);
  if (fresh(hit)) return hit.value;
  const row = await prisma.tenant.findFirst({ where: { id: tenantId, active: true }, select: { id: true } });
  if (knownCache.size > 500) knownCache.clear();
  knownCache.set(tenantId, { value: Boolean(row), at: Date.now() });
  return Boolean(row);
}

/** URL publique du tenant : domaine actif canonique en base, sinon `branding.siteUrl` du fichier de config. */
export async function resolveTenantBaseUrl(tenantId: string): Promise<string | null> {
  const hit = baseUrlCache.get(tenantId);
  if (fresh(hit)) return hit.value;

  const row = await prisma.tenantDomain.findFirst({
    where: { tenantId, status: "active" },
    orderBy: [{ canonicalDomain: "desc" }, { updatedAt: "desc" }],
    select: { domain: true },
  });
  let url: string | null = row ? `https://${row.domain}` : null;
  if (!url) {
    const fromConfig = getTenantConfig(tenantId)?.branding?.siteUrl?.trim().replace(/\/$/, "");
    if (fromConfig && fromConfig.startsWith("https://")) url = fromConfig;
  }
  baseUrlCache.set(tenantId, { value: url, at: Date.now() });
  return url;
}

/** Remplace l'origine (schéma + hôte) d'une URL par `base`, en gardant chemin, query et jetons `{...}`. */
export function rebaseUrl(raw: string, base: string): string {
  return raw.replace(/^https?:\/\/[^/?#]+/i, base.replace(/\/$/, ""));
}

/**
 * Config d'exécution d'un tenant : fichier du registre s'il existe (comportement historique inchangé),
 * sinon identité construite depuis la base sur le modèle du tenant par défaut. `undefined` si tenant inconnu.
 */
export async function resolveTenantConfig(tenantId: string): Promise<TenantConfig | undefined> {
  const fromRegistry = getTenantConfig(tenantId);
  if (fromRegistry) return fromRegistry;
  const fallback = getTenantConfig(loadEnv().defaultTenantId);
  if (!fallback) return undefined;
  return buildRuntimeTenantConfig(tenantId, fallback);
}

export async function buildRuntimeTenantConfig(tenantId: string, fallback: TenantConfig): Promise<TenantConfig> {
  const hit = runtimeCache.get(tenantId);
  if (fresh(hit)) return hit.value;

  const [row, admin, base] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, settings: true } }),
    prisma.operatorUser.findFirst({
      where: { tenantId, active: true, role: "admin" },
      orderBy: { createdAt: "asc" },
      select: { email: true },
    }),
    resolveTenantBaseUrl(tenantId),
  ]);

  // Tenant absent de la base : on garde l'ancien comportement (le reste de l'API répondra « introuvable »).
  if (!row) return { ...fallback, id: tenantId };

  const settings = (row.settings && typeof row.settings === "object" ? row.settings : {}) as Record<string, any>;
  const name = str(settings.general?.commercialName) || row.name || fallback.company.name;
  const legalName = str(settings.general?.legalName) || name;
  const publicEmail = str(settings.contact?.emailPublic);
  const toEmail = (isEmail(publicEmail) ? publicEmail : "") || admin?.email || "";

  const value: TenantConfig = {
    ...fallback,
    id: tenantId,
    company: { ...fallback.company, name, legalName },
    smtp: { ...fallback.smtp, toEmail, fromName: name },
    branding: { ...fallback.branding, siteUrl: base ?? undefined },
  };
  runtimeCache.set(tenantId, { value, at: Date.now() });
  return value;
}

/** Base des liens vers l'espace pro dans les e-mails : propre au tenant base de données, `DASHBOARD_BASE_URL` sinon. */
export function dashboardBaseFor(tenant: TenantConfig): string {
  const envBase = process.env.DASHBOARD_BASE_URL?.trim() || "https://app.sitereadyshd.fr";
  if (getTenantConfig(tenant.id)) return envBase;
  return tenant.branding?.siteUrl?.trim().replace(/\/$/, "") || envBase;
}
