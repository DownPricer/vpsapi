import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../db/prisma";
import { getTenantConfig } from "../config/tenants/registry";
import { buildRuntimeTenantConfig, dashboardBaseFor, rebaseUrl } from "../tenancy/tenantRuntimeConfig";
import { resolveConnectUrls } from "../services/stripeConnect.service";
import { emptyFleetSettings } from "../services/vehicle.service";

function stubDb(tenantId: string, over: { domain?: string | null; settings?: unknown; adminEmail?: string | null } = {}) {
  (prisma.tenantDomain as any).findFirst = async () => (over.domain === null ? null : { domain: over.domain ?? `${tenantId}.fr` });
  (prisma.tenant as any).findUnique = async () => ({ name: "Dupont VTC", settings: over.settings ?? {} });
  (prisma.operatorUser as any).findFirst = async () => (over.adminEmail === null ? null : { email: over.adminEmail ?? "pro@dupont.fr" });
}

test("rebaseUrl : change l'origine, garde chemin, query et jeton Stripe", () => {
  assert.equal(
    rebaseUrl("https://vtc.sitereadyshd.fr/paiement/retour?session_id={CHECKOUT_SESSION_ID}", "https://dupont.fr"),
    "https://dupont.fr/paiement/retour?session_id={CHECKOUT_SESSION_ID}"
  );
  assert.equal(rebaseUrl("https://a.fr/pro/paiements?stripe=return", "https://b.fr/"), "https://b.fr/pro/paiements?stripe=return");
});

test("Stripe Connect : les URLs d'env sont ré-ancrées sur le site du tenant", async () => {
  stubDb("t-connect", { domain: "dupont-vtc.fr" });
  process.env.STRIPE_CONNECT_RETURN_URL = "https://vtc.sitereadyshd.fr/pro/paiements?stripe=return";
  process.env.STRIPE_CONNECT_REFRESH_URL = "https://vtc.sitereadyshd.fr/pro/paiements?stripe=refresh";
  const urls = await resolveConnectUrls("t-connect");
  assert.equal(urls?.returnUrl, "https://dupont-vtc.fr/pro/paiements?stripe=return");
  assert.equal(urls?.refreshUrl, "https://dupont-vtc.fr/pro/paiements?stripe=refresh");
});

test("tenant en base : identité (nom, e-mail, URL) issue de la base, jamais du tenant par défaut", async () => {
  stubDb("t-identity", { domain: "dupont-vtc.fr", settings: { general: { commercialName: "Dupont Chauffeur" } } });
  const base = getTenantConfig("default")!;
  const cfg = await buildRuntimeTenantConfig("t-identity", base);
  assert.equal(cfg.id, "t-identity");
  assert.equal(cfg.company.name, "Dupont Chauffeur");
  assert.equal(cfg.smtp.toEmail, "pro@dupont.fr");
  assert.notEqual(cfg.smtp.toEmail, base.smtp.toEmail, "les leads ne partent pas vers le destinataire du modèle");
  assert.equal(cfg.branding?.siteUrl, "https://dupont-vtc.fr");
  assert.equal(dashboardBaseFor(cfg), "https://dupont-vtc.fr");
});

test("tenant en base : l'e-mail public des réglages prime sur le compte admin", async () => {
  stubDb("t-email", { settings: { contact: { emailPublic: "reservation@dupont.fr" } } });
  const cfg = await buildRuntimeTenantConfig("t-email", getTenantConfig("default")!);
  assert.equal(cfg.smtp.toEmail, "reservation@dupont.fr");
});

test("flotte vide : aucun véhicule d'exemple", () => {
  const f = emptyFleetSettings() as { source: string; items: unknown[]; featured: { name: string; gallery: unknown[] } };
  assert.equal(f.source, "fleet");
  assert.deepEqual(f.items, []);
  assert.equal(f.featured.name, "");
  assert.deepEqual(f.featured.gallery, []);
});
