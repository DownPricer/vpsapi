import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StripeOnboardingStatus } from "@prisma/client";
import { StripeConnectService, StripeConnectServiceError } from "../services/stripeConnect.service";
import {
  canOpenExpressDashboard,
  factsFromStripeAccount,
  isStripeHostedUrl,
  resolveOnboardingEnum,
  resolveStripeUiStatus,
} from "../services/stripe/stripeAccountStatus";

type TenantRow = {
  id: string;
  stripeAccountId: string | null;
  stripeOnboardingStatus: StripeOnboardingStatus;
  stripeChargesEnabled: boolean;
  stripePayoutsEnabled: boolean;
  stripeDetailsSubmitted: boolean;
};

function row(id: string, acct: string | null): TenantRow {
  return {
    id,
    stripeAccountId: acct,
    stripeOnboardingStatus: acct ? StripeOnboardingStatus.PENDING : StripeOnboardingStatus.NOT_STARTED,
    stripeChargesEnabled: false,
    stripePayoutsEnabled: false,
    stripeDetailsSubmitted: false,
  };
}

type FakeAccount = Record<string, unknown> & { id: string; type: string };

function makeService(opts: { tenants: TenantRow[]; accounts?: Record<string, FakeAccount>; loginUrl?: string }) {
  const tenants = new Map(opts.tenants.map((t) => [t.id, t]));
  const calls = { accountsCreate: 0, loginLink: [] as string[], onboarding: [] as string[], idempotencyKeys: [] as string[] };
  const accounts = opts.accounts ?? {};
  let counter = 0;

  const db = {
    tenant: {
      findUnique: async ({ where }: { where: { id: string } }) => tenants.get(where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<TenantRow> }) => {
        Object.assign(tenants.get(where.id)!, data);
        return tenants.get(where.id);
      },
      updateMany: async ({ where, data }: { where: { id: string; stripeAccountId: null }; data: Partial<TenantRow> }) => {
        const t = tenants.get(where.id);
        if (!t || t.stripeAccountId !== null) return { count: 0 };
        Object.assign(t, data);
        return { count: 1 };
      },
    },
    payment: {},
    paymentRefund: {},
  };

  const stripe = {
    accounts: {
      create: async (_p: unknown, o: { idempotencyKey: string }) => {
        calls.accountsCreate += 1;
        calls.idempotencyKeys.push(o.idempotencyKey);
        counter += 1;
        const id = `acct_new_${counter}`;
        accounts[id] = { id, type: "express", details_submitted: false };
        return { id };
      },
      retrieve: async (id: string) => {
        if (!accounts[id]) throw Object.assign(new Error("no account"), { code: "resource_missing", statusCode: 404 });
        return accounts[id];
      },
      createLoginLink: async (id: string) => {
        calls.loginLink.push(id);
        return { url: opts.loginUrl ?? `https://connect.stripe.com/express/${id}` };
      },
    },
    accountLinks: {
      create: async (p: { account: string }) => {
        calls.onboarding.push(p.account);
        return { url: `https://connect.stripe.com/setup/${p.account}`, expires_at: Math.floor(Date.now() / 1000) + 300 };
      },
    },
  };

  const service = new StripeConnectService({
    db: db as never,
    getStripe: () => stripe as never,
    resolveUrls: () => ({ refreshUrl: "https://a.example/pro/stripe?stripe=refresh", returnUrl: "https://a.example/pro/stripe?stripe=return" }),
  });
  return { service, tenants, calls, accounts };
}

describe("connexion Stripe depuis l'espace pro", () => {
  it("nouveau chauffeur sans compte : crée UN compte Express, avec clé d'idempotence par tenant", async () => {
    const { service, calls, tenants } = makeService({ tenants: [row("t1", null)] });
    const out = await service.ensureTenantStripeAccount("t1");
    assert.match(out.stripeAccountId, /^acct_new_/);
    assert.equal(calls.accountsCreate, 1);
    assert.equal(calls.idempotencyKeys[0], "vtc-connect-account-t1");
    assert.equal(tenants.get("t1")!.stripeAccountId, out.stripeAccountId);
    assert.equal(tenants.get("t1")!.stripeOnboardingStatus, StripeOnboardingStatus.PENDING);
  });

  it("compte déjà connecté : réutilisé, jamais de second compte", async () => {
    const { service, calls } = makeService({ tenants: [row("t1", "acct_existing")] });
    const a = await service.ensureTenantStripeAccount("t1");
    const link = await service.createTenantStripeOnboardingLink("t1");
    assert.equal(a.stripeAccountId, "acct_existing");
    assert.equal(link.stripeAccountId, "acct_existing");
    assert.equal(calls.accountsCreate, 0);
    assert.deepEqual(calls.onboarding, ["acct_existing"]);
  });

  it("deux clics simultanés : un seul compte rattaché au tenant", async () => {
    const { service, tenants } = makeService({ tenants: [row("t1", null)] });
    const [a, b] = await Promise.all([service.ensureTenantStripeAccount("t1"), service.ensureTenantStripeAccount("t1")]);
    assert.equal(a.stripeAccountId, b.stripeAccountId);
    assert.equal(tenants.get("t1")!.stripeAccountId, a.stripeAccountId);
  });

  it("lien d'onboarding : hébergé par Stripe, expiration fournie", async () => {
    const { service } = makeService({ tenants: [row("t1", null)] });
    const link = await service.createTenantStripeOnboardingLink("t1");
    assert.ok(isStripeHostedUrl(link.url));
    assert.ok(link.expiresAt.getTime() > Date.now());
  });
});

describe("statut réel du compte (jamais déduit de la redirection navigateur)", () => {
  const base = {
    id: "acct_1",
    type: "express",
    details_submitted: false,
    charges_enabled: false,
    payouts_enabled: false,
    requirements: { currently_due: [] as string[], past_due: [] as string[], pending_verification: [] as string[], disabled_reason: null as string | null },
  };

  it("onboarding interrompu → Configuration en cours, pas activé", async () => {
    const { service, tenants } = makeService({ tenants: [row("t1", "acct_1")], accounts: { acct_1: { ...base } } });
    const s = await service.refreshTenantStripeStatus("t1");
    assert.equal(s.uiStatus, "IN_PROGRESS");
    assert.equal(s.dashboardAvailable, false);
    assert.equal(tenants.get("t1")!.stripeChargesEnabled, false);
  });

  it("onboarding terminé et activé → Paiements activés", async () => {
    const { service, tenants } = makeService({
      tenants: [row("t1", "acct_1")],
      accounts: { acct_1: { ...base, details_submitted: true, charges_enabled: true, payouts_enabled: true } },
    });
    const s = await service.refreshTenantStripeStatus("t1");
    assert.equal(s.uiStatus, "ACTIVE");
    assert.equal(s.onboardingStatus, StripeOnboardingStatus.COMPLETE);
    assert.equal(tenants.get("t1")!.stripeChargesEnabled, true);
    assert.equal(tenants.get("t1")!.stripePayoutsEnabled, true);
  });

  it("détails soumis mais compte non activé (vérification Stripe) → Vérification Stripe nécessaire", () => {
    const s = resolveStripeUiStatus(
      factsFromStripeAccount({ ...base, details_submitted: true, requirements: { ...base.requirements, pending_verification: ["individual.id_number"] } })
    );
    assert.equal(s, "VERIFICATION_NEEDED");
  });

  it("paiements actifs mais virements désactivés → Versements suspendus", () => {
    assert.equal(
      resolveStripeUiStatus(factsFromStripeAccount({ ...base, details_submitted: true, charges_enabled: true, payouts_enabled: false })),
      "PAYOUTS_SUSPENDED"
    );
  });

  it("informations en retard / compte restreint → Action requise", () => {
    const facts = factsFromStripeAccount({
      ...base,
      details_submitted: true,
      charges_enabled: true,
      payouts_enabled: true,
      requirements: { ...base.requirements, past_due: ["external_account"], disabled_reason: "requirements.past_due" },
    });
    assert.equal(resolveStripeUiStatus(facts), "ACTION_REQUIRED");
    assert.equal(resolveOnboardingEnum(facts), StripeOnboardingStatus.COMPLETE);
  });

  it("aucun compte → Non connecté", async () => {
    const { service } = makeService({ tenants: [row("t1", null)] });
    const s = await service.refreshTenantStripeStatus("t1");
    assert.equal(s.uiStatus, "NOT_CONNECTED");
    assert.equal(s.stripeAccountId, null);
  });
});

describe("accès au Dashboard Stripe Express", () => {
  const ready = { id: "x", type: "express", details_submitted: true, charges_enabled: true, payouts_enabled: true };

  it("génère le lien du compte du BON tenant (issu de la base)", async () => {
    const { service, calls } = makeService({
      tenants: [row("t1", "acct_1"), row("t2", "acct_2")],
      accounts: { acct_1: { ...ready, id: "acct_1" }, acct_2: { ...ready, id: "acct_2" } },
    });
    const a = await service.createTenantExpressLoginLink("t1");
    const b = await service.createTenantExpressLoginLink("t2");
    assert.match(a.url, /acct_1$/);
    assert.match(b.url, /acct_2$/);
    assert.deepEqual(calls.loginLink, ["acct_1", "acct_2"]);
  });

  it("un tenant ne peut jamais obtenir le lien d'un autre : le seul identifiant d'entrée est le tenant authentifié", async () => {
    const { service, calls } = makeService({
      tenants: [row("t1", "acct_1"), row("t2", "acct_2")],
      accounts: { acct_1: { ...ready, id: "acct_1" }, acct_2: { ...ready, id: "acct_2" } },
    });
    assert.equal(service.createTenantExpressLoginLink.length, 1); // signature : (tenantId) uniquement
    await service.createTenantExpressLoginLink("t1");
    assert.ok(!calls.loginLink.includes("acct_2"));
  });

  it("chaque demande génère un nouveau lien (rien n'est mis en cache ni stocké)", async () => {
    const { service, calls } = makeService({ tenants: [row("t1", "acct_1")], accounts: { acct_1: { ...ready, id: "acct_1" } } });
    await service.createTenantExpressLoginLink("t1");
    await service.createTenantExpressLoginLink("t1");
    assert.equal(calls.loginLink.length, 2);
  });

  it("sans compte connecté : STRIPE_NOT_CONNECTED", async () => {
    const { service } = makeService({ tenants: [row("t1", null)] });
    await assert.rejects(service.createTenantExpressLoginLink("t1"), (e: unknown) => e instanceof StripeConnectServiceError && e.code === "STRIPE_NOT_CONNECTED");
  });

  it("onboarding non terminé : on propose de terminer la configuration (pas de lien)", async () => {
    const { service, calls } = makeService({
      tenants: [row("t1", "acct_1")],
      accounts: { acct_1: { id: "acct_1", type: "express", details_submitted: false } },
    });
    await assert.rejects(service.createTenantExpressLoginLink("t1"), (e: unknown) => e instanceof StripeConnectServiceError && e.code === "STRIPE_ONBOARDING_INCOMPLETE");
    assert.equal(calls.loginLink.length, 0);
  });

  it("compte non Express : refusé", async () => {
    const { service } = makeService({ tenants: [row("t1", "acct_1")], accounts: { acct_1: { ...ready, id: "acct_1", type: "standard" } } });
    await assert.rejects(service.createTenantExpressLoginLink("t1"), (e: unknown) => e instanceof StripeConnectServiceError && e.code === "STRIPE_DASHBOARD_UNSUPPORTED");
  });

  it("compte Stripe devenu inaccessible : message propre", async () => {
    const { service } = makeService({ tenants: [row("t1", "acct_gone")], accounts: {} });
    await assert.rejects(service.createTenantExpressLoginLink("t1"), (e: unknown) => e instanceof StripeConnectServiceError && e.code === "STRIPE_ACCOUNT_UNREACHABLE");
  });

  it("jamais de redirection vers un domaine arbitraire", async () => {
    const { service } = makeService({
      tenants: [row("t1", "acct_1")],
      accounts: { acct_1: { ...ready, id: "acct_1" } },
      loginUrl: "https://evil.example.com/stripe",
    });
    await assert.rejects(service.createTenantExpressLoginLink("t1"), (e: unknown) => e instanceof StripeConnectServiceError && e.code === "STRIPE_API_ERROR");
  });

  it("validation d'URL Stripe", () => {
    assert.equal(isStripeHostedUrl("https://connect.stripe.com/express/abc"), true);
    assert.equal(isStripeHostedUrl("https://dashboard.stripe.com/x"), true);
    assert.equal(isStripeHostedUrl("http://connect.stripe.com/x"), false);
    assert.equal(isStripeHostedUrl("https://stripe.com.evil.io/x"), false);
    assert.equal(isStripeHostedUrl("https://evilstripe.com/x"), false);
    assert.equal(isStripeHostedUrl("javascript:alert(1)"), false);
    assert.equal(canOpenExpressDashboard(factsFromStripeAccount({ details_submitted: false })), false);
  });
});
