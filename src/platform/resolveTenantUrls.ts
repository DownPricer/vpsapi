import { isTechnicalDomain, normalizeDomain } from "../tenancy/domainResolver";

function normUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

function safeString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
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

function extractHostname(url: string): string | null {
  try {
    const u = new URL(url);
    return u.hostname;
  } catch {
    return null;
  }
}

export type TenantResolvedUrls = {
  publicUrl: string | null;
  adminProUrl: string | null;
  calculatorUrl: string | null;
  apiUrl: string | null;
  domain: string | null;
};

export function resolveTenantUrls(params: {
  tenantId: string;
  settings: unknown | null;
  apiBaseUrl?: string | null;
  domain?: string | null;
}): TenantResolvedUrls {
  const candidates = [
    "branding.siteUrl",
    "branding.publicUrl",
    "urls.public",
    "urls.publicUrl",
    "meta.publicUrl",
    "meta.siteUrl",
    "publicUrl",
    "siteUrl",
  ];

  const domainFromDb = normalizeDomain(params.domain);
  let publicUrl: string | null = domainFromDb && !isTechnicalDomain(domainFromDb) ? `https://${domainFromDb}` : null;
  for (const p of candidates) {
    if (publicUrl) break;
    const v = safeString(getByPath(params.settings, p));
    if (v && (v.startsWith("http://") || v.startsWith("https://"))) {
      const hostname = extractHostname(v);
      if (hostname && !isTechnicalDomain(hostname)) {
        publicUrl = normUrl(v);
      }
      break;
    }
  }

  // Fallback minimal demandé pour `default`.
  if (!publicUrl && params.tenantId === "default") {
    publicUrl = "https://vtc.sitereadyshd.fr";
  }

  const adminProUrl = publicUrl ? `${publicUrl}/pro/login` : null;
  const calculatorUrl = publicUrl ? `${publicUrl}/calculateur` : null;
  const apiUrl = params.apiBaseUrl ? normUrl(params.apiBaseUrl) : null;
  const domain = publicUrl ? extractHostname(publicUrl) : null;

  return { publicUrl, adminProUrl, calculatorUrl, apiUrl, domain };
}

