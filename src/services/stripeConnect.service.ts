import { StripeOnboardingStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { rebaseUrl, resolveTenantBaseUrl } from "../tenancy/tenantRuntimeConfig";
import { getStripeClient } from "./stripe/stripeClient";
import {
  canOpenExpressDashboard,
  factsFromStripeAccount,
  isStripeHostedUrl,
  resolveOnboardingEnum,
  resolveStripeUiStatus,
  type StripeAccountFacts,
  type StripeUiStatus,
} from "./stripe/stripeAccountStatus";

export class StripeConnectServiceError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus: number) {
    super(message);
    this.name = "StripeConnectServiceError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export type TenantStripePublicStatus = {
  stripeAccountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  onboardingStatus: StripeOnboardingStatus;
  /** Statut d'affichage dérivé de l'état réel du compte (jamais de la simple redirection navigateur). */
  uiStatus: StripeUiStatus;
  verificationNeeded: boolean;
  dashboardAvailable: boolean;
  requirements: {
    currentlyDueCount: number;
    pastDueCount: number;
    pendingVerificationCount: number;
    disabledReason: string | null;
  };
};

function publicStatusFrom(accountId: string | null, facts: StripeAccountFacts): TenantStripePublicStatus {
  const uiStatus = resolveStripeUiStatus(facts);
  return {
    stripeAccountId: accountId,
    chargesEnabled: facts.chargesEnabled,
    payoutsEnabled: facts.payoutsEnabled,
    detailsSubmitted: facts.detailsSubmitted,
    onboardingStatus: resolveOnboardingEnum(facts),
    uiStatus,
    verificationNeeded: uiStatus === "VERIFICATION_NEEDED" || uiStatus === "ACTION_REQUIRED",
    dashboardAvailable: canOpenExpressDashboard(facts),
    requirements: {
      currentlyDueCount: facts.currentlyDueCount,
      pastDueCount: facts.pastDueCount,
      pendingVerificationCount: facts.pendingVerificationCount,
      disabledReason: facts.disabledReason,
    },
  };
}

const EMPTY_FACTS: StripeAccountFacts = {
  hasAccount: false,
  detailsSubmitted: false,
  chargesEnabled: false,
  payoutsEnabled: false,
  currentlyDueCount: 0,
  pastDueCount: 0,
  pendingVerificationCount: 0,
  disabledReason: null,
};

/**
 * URLs de retour / renouvellement d'onboarding : variables d'environnement si définies (comportement historique),
 * sinon le site public du tenant (`/pro/stripe?stripe=return|refresh`).
 */
export async function resolveConnectUrls(tenantId: string): Promise<{ refreshUrl: string; returnUrl: string } | null> {
  const refreshEnv = process.env.STRIPE_CONNECT_REFRESH_URL?.trim();
  const returnEnv = process.env.STRIPE_CONNECT_RETURN_URL?.trim();
  // Les variables d'environnement donnent le chemin ; l'origine est TOUJOURS celle du site du tenant
  // (sinon chaque client serait renvoyé vers le site modèle après l'onboarding Stripe).
  const base = await resolveTenantBaseUrl(tenantId);
  if (refreshEnv && returnEnv) {
    return base
      ? { refreshUrl: rebaseUrl(refreshEnv, base), returnUrl: rebaseUrl(returnEnv, base) }
      : { refreshUrl: refreshEnv, returnUrl: returnEnv };
  }
  if (base) {
    return { refreshUrl: `${base}/pro/stripe?stripe=refresh`, returnUrl: `${base}/pro/stripe?stripe=return` };
  }
  return null;
}

export class StripeConnectService {
  constructor(
    private readonly deps: {
      db: Pick<typeof prisma, "tenant" | "payment" | "paymentRefund">;
      getStripe: () => ReturnType<typeof getStripeClient>;
      resolveUrls: (
        tenantId: string
      ) => { refreshUrl: string; returnUrl: string } | null | Promise<{ refreshUrl: string; returnUrl: string } | null>;
    } = { db: prisma, getStripe: getStripeClient, resolveUrls: resolveConnectUrls }
  ) {}

  private get db() {
    return this.deps.db;
  }

  private stripe(): NonNullable<ReturnType<typeof getStripeClient>> {
    const stripe = this.deps.getStripe();
    if (!stripe) {
      throw new StripeConnectServiceError("STRIPE_NOT_CONFIGURED", "Stripe n'est pas configuré sur l'API.", 503);
    }
    return stripe;
  }

  async ensureTenantStripeAccount(tenantId: string): Promise<{
    stripeAccountId: string;
    onboardingStatus: StripeOnboardingStatus;
  }> {
    const tenant = await this.db.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, stripeAccountId: true, stripeOnboardingStatus: true },
    });
    if (!tenant) {
      throw new StripeConnectServiceError("TENANT_NOT_FOUND", "Locataire introuvable en base.", 404);
    }
    if (tenant.stripeAccountId) {
      return {
        stripeAccountId: tenant.stripeAccountId,
        onboardingStatus: tenant.stripeOnboardingStatus,
      };
    }

    const stripe = this.stripe();
    let accountId: string;
    try {
      // Clé d'idempotence par tenant : deux clics simultanés ne peuvent pas créer deux comptes Stripe.
      const account = await stripe.accounts.create(
        {
          type: "express",
          country: "FR",
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
          metadata: { tenantId },
        },
        { idempotencyKey: `vtc-connect-account-${tenantId}` }
      );
      accountId = account.id;
    } catch {
      throw new StripeConnectServiceError(
        "STRIPE_API_ERROR",
        "Impossible de créer le compte Stripe Connect.",
        502
      );
    }

    // N'écrit que si aucun compte n'a été associé entre-temps (ne jamais écraser un acct_ existant).
    const claimed = await this.db.tenant.updateMany({
      where: { id: tenantId, stripeAccountId: null },
      data: {
        stripeAccountId: accountId,
        stripeOnboardingStatus: StripeOnboardingStatus.PENDING,
      },
    });
    if (claimed.count === 0) {
      const current = await this.db.tenant.findUnique({
        where: { id: tenantId },
        select: { stripeAccountId: true, stripeOnboardingStatus: true },
      });
      if (current?.stripeAccountId) {
        return { stripeAccountId: current.stripeAccountId, onboardingStatus: current.stripeOnboardingStatus };
      }
    }

    return {
      stripeAccountId: accountId,
      onboardingStatus: StripeOnboardingStatus.PENDING,
    };
  }

  async createTenantStripeOnboardingLink(tenantId: string): Promise<{
    stripeAccountId: string;
    url: string;
    expiresAt: Date;
  }> {
    if (this.deps.getStripe() === null) {
      throw new StripeConnectServiceError(
        "STRIPE_NOT_CONFIGURED",
        "Stripe n'est pas configuré sur l'API.",
        503
      );
    }
    const urls = await this.deps.resolveUrls(tenantId);
    if (!urls) {
      throw new StripeConnectServiceError(
        "STRIPE_CONNECT_URLS_NOT_CONFIGURED",
        "URLs Stripe Connect manquantes côté API.",
        503
      );
    }

    const account = await this.ensureTenantStripeAccount(tenantId);
    const stripe = this.stripe();
    try {
      const link = await stripe.accountLinks.create({
        account: account.stripeAccountId,
        refresh_url: urls.refreshUrl,
        return_url: urls.returnUrl,
        type: "account_onboarding",
      });
      if (!isStripeHostedUrl(link.url)) {
        throw new Error("unexpected onboarding host");
      }
      return {
        stripeAccountId: account.stripeAccountId,
        url: link.url,
        expiresAt: new Date(link.expires_at * 1000),
      };
    } catch {
      throw new StripeConnectServiceError(
        "STRIPE_API_ERROR",
        "Impossible de créer le lien d'onboarding Stripe.",
        502
      );
    }
  }

  /**
   * Lien à usage unique vers le Dashboard Express du chauffeur.
   * Le compte provient exclusivement de la base (tenant authentifié) ; le lien n'est jamais stocké.
   */
  async createTenantExpressLoginLink(tenantId: string): Promise<{ url: string }> {
    const tenant = await this.db.tenant.findUnique({
      where: { id: tenantId },
      select: { stripeAccountId: true },
    });
    if (!tenant) {
      throw new StripeConnectServiceError("TENANT_NOT_FOUND", "Locataire introuvable en base.", 404);
    }
    if (!tenant.stripeAccountId) {
      throw new StripeConnectServiceError(
        "STRIPE_NOT_CONNECTED",
        "Aucun compte Stripe n'est connecté. Connectez d'abord votre compte.",
        409
      );
    }
    const stripe = this.stripe();
    try {
      const account = await stripe.accounts.retrieve(tenant.stripeAccountId);
      if (account.type !== "express") {
        throw new StripeConnectServiceError(
          "STRIPE_DASHBOARD_UNSUPPORTED",
          "Ce compte Stripe ne prend pas en charge le Dashboard Express.",
          409
        );
      }
      if (!canOpenExpressDashboard(factsFromStripeAccount(account))) {
        throw new StripeConnectServiceError(
          "STRIPE_ONBOARDING_INCOMPLETE",
          "Terminez d'abord la configuration de votre compte Stripe.",
          409
        );
      }
      const link = await stripe.accounts.createLoginLink(tenant.stripeAccountId);
      if (!isStripeHostedUrl(link.url)) {
        throw new StripeConnectServiceError("STRIPE_API_ERROR", "Lien Stripe inattendu.", 502);
      }
      return { url: link.url };
    } catch (e) {
      if (e instanceof StripeConnectServiceError) throw e;
      const err = e as { code?: string; statusCode?: number };
      if (err.code === "account_invalid" || err.code === "resource_missing" || err.statusCode === 403) {
        throw new StripeConnectServiceError(
          "STRIPE_ACCOUNT_UNREACHABLE",
          "Ce compte Stripe n'est plus accessible. Contactez le support.",
          409
        );
      }
      throw new StripeConnectServiceError(
        "STRIPE_API_ERROR",
        "Impossible d'ouvrir le Dashboard Stripe pour le moment. Réessayez dans un instant.",
        502
      );
    }
  }

  async refreshTenantStripeStatus(tenantId: string): Promise<TenantStripePublicStatus> {
    const tenant = await this.db.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        stripeAccountId: true,
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
        stripeDetailsSubmitted: true,
        stripeOnboardingStatus: true,
      },
    });
    if (!tenant) {
      throw new StripeConnectServiceError("TENANT_NOT_FOUND", "Locataire introuvable en base.", 404);
    }

    if (!tenant.stripeAccountId) {
      const onboardingStatus = StripeOnboardingStatus.NOT_STARTED;
      if (tenant.stripeOnboardingStatus !== onboardingStatus) {
        await this.db.tenant.update({
          where: { id: tenantId },
          data: {
            stripeChargesEnabled: false,
            stripePayoutsEnabled: false,
            stripeDetailsSubmitted: false,
            stripeOnboardingStatus: onboardingStatus,
          },
        });
      }
      return publicStatusFrom(null, EMPTY_FACTS);
    }

    const stripe = this.stripe();
    try {
      const account = await stripe.accounts.retrieve(tenant.stripeAccountId);
      const facts = factsFromStripeAccount(account);
      const status = publicStatusFrom(tenant.stripeAccountId, facts);

      await this.db.tenant.update({
        where: { id: tenantId },
        data: {
          stripeChargesEnabled: facts.chargesEnabled,
          stripePayoutsEnabled: facts.payoutsEnabled,
          stripeDetailsSubmitted: facts.detailsSubmitted,
          stripeOnboardingStatus: status.onboardingStatus,
        },
      });
      return status;
    } catch {
      throw new StripeConnectServiceError(
        "STRIPE_API_ERROR",
        "Impossible de rafraîchir le statut Stripe Connect.",
        502
      );
    }
  }

  /** Statut + derniers paiements/remboursements (données locales uniquement : aucun solde inventé). */
  async getTenantStripeOverview(tenantId: string) {
    let status: TenantStripePublicStatus;
    let statusSource: "stripe" | "cache" = "stripe";
    try {
      status = await this.refreshTenantStripeStatus(tenantId);
    } catch (e) {
      if (!(e instanceof StripeConnectServiceError) || e.code === "TENANT_NOT_FOUND") throw e;
      const t = await this.db.tenant.findUnique({
        where: { id: tenantId },
        select: {
          stripeAccountId: true,
          stripeChargesEnabled: true,
          stripePayoutsEnabled: true,
          stripeDetailsSubmitted: true,
        },
      });
      status = publicStatusFrom(t?.stripeAccountId ?? null, {
        ...EMPTY_FACTS,
        hasAccount: Boolean(t?.stripeAccountId),
        detailsSubmitted: Boolean(t?.stripeDetailsSubmitted),
        chargesEnabled: Boolean(t?.stripeChargesEnabled),
        payoutsEnabled: Boolean(t?.stripePayoutsEnabled),
      });
      statusSource = "cache";
    }

    const [payments, refunds] = await Promise.all([
      this.db.payment.findMany({
        where: { tenantId, paidAt: { not: null } },
        orderBy: { paidAt: "desc" },
        take: 5,
        select: {
          id: true,
          leadRequestId: true,
          status: true,
          amount: true,
          refundedAmount: true,
          currency: true,
          paidAt: true,
          leadRequest: { select: { clientName: true } },
        },
      }),
      this.db.paymentRefund.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          paymentId: true,
          leadRequestId: true,
          amount: true,
          currency: true,
          status: true,
          reason: true,
          createdAt: true,
          leadRequest: { select: { clientName: true } },
        },
      }),
    ]);

    return {
      status,
      statusSource,
      recentPayments: payments.map((p) => ({
        id: p.id,
        leadRequestId: p.leadRequestId,
        clientName: p.leadRequest?.clientName ?? "",
        status: p.status,
        amount: p.amount,
        refundedAmount: p.refundedAmount,
        currency: p.currency,
        paidAt: p.paidAt,
      })),
      recentRefunds: refunds.map((r) => ({
        id: r.id,
        paymentId: r.paymentId,
        leadRequestId: r.leadRequestId,
        clientName: r.leadRequest?.clientName ?? "",
        amount: r.amount,
        currency: r.currency,
        status: r.status,
        reason: r.reason,
        createdAt: r.createdAt,
      })),
    };
  }
}
