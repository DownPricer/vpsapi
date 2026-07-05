import { prisma } from "../db/prisma";

const DEFAULT_TENANT_ID = "default";
const DEFAULT_DOMAIN = "vtc.sitereadyshd.fr";
const DEFAULT_SITE_URL = `https://${DEFAULT_DOMAIN}`;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { id: DEFAULT_TENANT_ID } });
  if (!tenant) {
    throw new Error(`Tenant ${DEFAULT_TENANT_ID} introuvable.`);
  }

  const settings = isObject(tenant.settings) ? { ...tenant.settings } : {};
  const branding = isObject(settings.branding) ? { ...settings.branding } : {};
  settings.branding = {
    ...branding,
    siteUrl: DEFAULT_SITE_URL,
    adminUrl: `${DEFAULT_SITE_URL}/pro/login`,
  };

  await prisma.$transaction([
    prisma.tenant.update({
      where: { id: DEFAULT_TENANT_ID },
      data: { settings },
    }),
    prisma.tenantDomain.upsert({
      where: { domain: DEFAULT_DOMAIN },
      create: {
        tenantId: DEFAULT_TENANT_ID,
        domain: DEFAULT_DOMAIN,
        canonicalDomain: true,
        status: "active",
        source: "env",
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
      update: {
        tenantId: DEFAULT_TENANT_ID,
        canonicalDomain: true,
        status: "active",
        source: "env",
        lastSeenAt: new Date(),
      },
    }),
  ]);

  console.log(`Domaine par défaut corrigé: ${DEFAULT_SITE_URL}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

