import { prisma } from "../db/prisma";
import { normalizeDomain, withoutWww } from "./domainResolver";

const CACHE_TTL_MS = 60_000;

let cache: { domains: Set<string>; loadedAt: number } | null = null;
let loading: Promise<Set<string>> | null = null;

/** Domaines actifs rattachés à un tenant (sans « www. »), rechargés au plus toutes les 60 s. */
async function loadActiveDomains(): Promise<Set<string>> {
  const rows = await prisma.tenantDomain.findMany({
    where: { status: "active", tenantId: { not: null } },
    select: { domain: true },
  });
  const domains = new Set<string>();
  for (const r of rows) {
    const d = normalizeDomain(r.domain);
    if (d) domains.add(withoutWww(d));
  }
  return domains;
}

async function getActiveDomains(): Promise<Set<string>> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.domains;
  if (!loading) {
    loading = loadActiveDomains()
      .then((domains) => {
        cache = { domains, loadedAt: Date.now() };
        return domains;
      })
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

/**
 * Une origine navigateur est autorisée si son domaine est un domaine ACTIF d'un tenant
 * (domaine nu ou « www. »). Les domaines « pending » / « rejected » / inconnus sont refusés.
 * En cas d'erreur de lecture en base, on garde le dernier cache connu, sinon on refuse.
 */
export async function isActiveTenantOrigin(origin: string): Promise<boolean> {
  let host: string | null = null;
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:") return false;
    host = normalizeDomain(u.hostname);
  } catch {
    return false;
  }
  if (!host) return false;

  try {
    return (await getActiveDomains()).has(withoutWww(host));
  } catch (e) {
    console.error("[cors] lecture des domaines actifs impossible", e);
    return cache ? cache.domains.has(withoutWww(host)) : false;
  }
}
