/**
 * Crée un nouveau client (tenant) : tenant + réglages de départ + domaine actif + compte pro admin.
 *
 * Usage :
 *   npm run tenant:create -- --slug dupont-vtc --name "Dupont VTC" --domain dupont-vtc.fr --email contact@dupont-vtc.fr
 *
 * Options :
 *   --legal-name "SAS Dupont VTC"   raison sociale (défaut : --name)
 *   --password "..."                mot de passe initial (défaut : généré, affiché une seule fois)
 *   --template-tenant default       copie les réglages d'un tenant existant au lieu du modèle vierge
 *   --dry-run                       valide les paramètres sans rien écrire
 *
 * La dernière ligne de sortie est `__RESULT__ {json}` pour être lue par le script shell.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { normalizeDomain, withoutWww, isTechnicalDomain } from "../tenancy/domainResolver";
import marketingDefaults from "./data/tenant-marketing-defaults.json";

const TEMPLATE_COMMERCIAL_NAME = "Exemple VTC";
const TEMPLATE_LEGAL_NAME = "SAS Exemple VTC";

function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function fail(message: string): never {
  console.error(`Erreur : ${message}`);
  process.exit(1);
}

function str(args: Record<string, string | true>, key: string): string {
  const v = args[key];
  return typeof v === "string" ? v.trim() : "";
}

/** Remplace récursivement les noms du modèle dans toutes les chaînes des réglages. */
function replaceTemplateNames(node: unknown, commercialName: string, legalName: string): unknown {
  if (typeof node === "string") {
    return node.split(TEMPLATE_LEGAL_NAME).join(legalName).split(TEMPLATE_COMMERCIAL_NAME).join(commercialName);
  }
  if (Array.isArray(node)) return node.map((n) => replaceTemplateNames(n, commercialName, legalName));
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out[k] = replaceTemplateNames(v, commercialName, legalName);
    }
    return out;
  }
  return node;
}

function countPlaceholders(node: unknown): number {
  const text = JSON.stringify(node);
  return (text.match(/Adresse à compléter|Exemple/g) ?? []).length;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const slug = str(args, "slug").toLowerCase();
  const name = str(args, "name");
  const legalName = str(args, "legal-name") || name;
  const email = str(args, "email").toLowerCase();
  const domain = normalizeDomain(str(args, "domain"));
  const templateTenant = str(args, "template-tenant");
  const dryRun = args["dry-run"] === true;

  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) {
    fail("--slug requis : 3 à 40 caractères, minuscules, chiffres et tirets (ex. dupont-vtc).");
  }
  if (slug === (process.env.DEFAULT_TENANT_ID?.trim() || "default")) fail(`--slug ${slug} est réservé au tenant par défaut.`);
  if (!name) fail("--name requis (nom commercial).");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail("--email requis (adresse du compte pro).");
  if (!domain) fail("--domain requis (ex. dupont-vtc.fr).");
  if (isTechnicalDomain(domain)) fail(`--domain ${domain} est un domaine technique, pas un domaine client.`);

  const baseDomain = withoutWww(domain);
  const domains = [baseDomain, `www.${baseDomain}`];

  const [existingTenant, existingDomains] = await Promise.all([
    prisma.tenant.findFirst({ where: { OR: [{ id: slug }, { slug }] }, select: { id: true } }),
    prisma.tenantDomain.findMany({ where: { domain: { in: domains } }, select: { domain: true, tenantId: true } }),
  ]);
  if (existingTenant) fail(`le tenant "${slug}" existe déjà.`);
  if (existingDomains.length > 0) {
    fail(
      `domaine déjà enregistré : ${existingDomains.map((d) => `${d.domain} (tenant ${d.tenantId ?? "aucun"})`).join(", ")}. ` +
        "Supprimez-le ou associez-le depuis le super-admin."
    );
  }

  let baseSettings: unknown = marketingDefaults;
  if (templateTenant) {
    const tpl = await prisma.tenant.findUnique({ where: { id: templateTenant }, select: { settings: true } });
    if (!tpl?.settings) fail(`tenant modèle "${templateTenant}" introuvable ou sans réglages.`);
    baseSettings = tpl.settings;
  }

  const settings = replaceTemplateNames(baseSettings, name, legalName) as Record<string, unknown>;
  const general = (settings.general && typeof settings.general === "object" ? settings.general : {}) as Record<string, unknown>;
  general.commercialName = name;
  general.legalName = legalName;
  settings.general = general;

  const password = str(args, "password") || randomBytes(12).toString("base64url");
  const remaining = countPlaceholders(settings);

  if (dryRun) {
    console.log(`Dry-run OK : tenant ${slug}, domaines ${domains.join(", ")}, ${remaining} placeholder(s) à remplacer.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.$transaction(async (tx) => {
    await tx.tenant.create({
      data: {
        id: slug,
        name,
        slug,
        active: true,
        settings: settings as Prisma.InputJsonValue,
      },
    });
    for (const d of domains) {
      await tx.tenantDomain.create({
        data: {
          tenantId: slug,
          domain: d,
          canonicalDomain: d === baseDomain,
          status: "active",
          source: "manual",
        },
      });
    }
    await tx.operatorUser.create({
      data: { tenantId: slug, email, passwordHash, role: "admin", active: true },
    });
  });

  console.log(`Tenant créé : ${slug} (${name})`);
  console.log(`Domaines actifs : ${domains.join(", ")}`);
  console.log(`Compte pro : ${email}`);
  if (remaining > 0) {
    console.log(`À faire : ${remaining} texte(s) de démonstration restent dans les réglages (Exemple / Adresse à compléter) -> /pro/site.`);
  }
  console.log(`__RESULT__ ${JSON.stringify({ tenantId: slug, domain: baseDomain, email, password, placeholders: remaining })}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
