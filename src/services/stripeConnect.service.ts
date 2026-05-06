import { StripeOnboardingStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { getStripeClient, isStripeConfigured } from "./stripe/stripeClient";

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
  requirements: {
    currentlyDueCount: number;
    pastDueCount: number;
    disabledReason: string | null;
  };
};

function requireStripeClient() {
  const stripe = getStripeClient();
  if (!stripe) {
    throw new StripeConnectServiceError(
      "STRIPE_NOT_CONFIGURED",
      "Stripe n'est pas configuré sur l'API.",
      503
    );
  }
  return stripe;
}

function resolveOnboardingStatus(args: {
  stripeAccountId: string | null;
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
  pastDueCount: number;
  disabledReason: string | null;
}): StripeOnboardingStatus {
  if (!args.stripeAccountId) return StripeOnboardingStatus.NOT_STARTED;
  if (args.detailsSubmitted && args.chargesEnabled) return StripeOnboardingStatus.COMPLETE;
  if (args.pastDueCount > 0 || Boolean(args.disabledReason)) return StripeOnboardingStatus.RESTRICTED;
  return StripeOnboardingStatus.PENDING;
}

export class StripeConnectService {
  async ensureTenantStripeAccount(tenantId: string): Promise<{
    stripeAccountId: string;
    onboardingStatus: StripeOnboardingStatus;
  }> {
    const tenant = await prisma.tenant.findUnique({
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

    const stripe = requireStripeClient();
    let accountId: string;
    try {
      const account = await stripe.accounts.create({
        type: "express",
        country: "FR",
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: { tenantId },
      });
      accountId = account.id;
    } catch {
      throw new StripeConnectServiceError(
        "STRIPE_API_ERROR",
        "Impossible de créer le compte Stripe Connect.",
        502
      );
    }

    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        stripeAccountId: accountId,
        stripeOnboardingStatus: StripeOnboardingStatus.PENDING,
      },
    });

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
    if (!isStripeConfigured()) {
      throw new StripeConnectServiceError(
        "STRIPE_NOT_CONFIGURED",
        "Stripe n'est pas configuré sur l'API.",
        503
      );
    }
    const refreshUrl = process.env.STRIPE_CONNECT_REFRESH_URL?.trim();
    const returnUrl = process.env.STRIPE_CONNECT_RETURN_URL?.trim();
    if (!refreshUrl || !returnUrl) {
      throw new StripeConnectServiceError(
        "STRIPE_CONNECT_URLS_NOT_CONFIGURED",
        "URLs Stripe Connect manquantes côté API.",
        503
      );
    }

    const account = await this.ensureTenantStripeAccount(tenantId);
    const stripe = requireStripeClient();
    try {
      const link = await stripe.accountLinks.create({
        account: account.stripeAccountId,
        refresh_url: refreshUrl,
        return_url: returnUrl,
        type: "account_onboarding",
      });
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

  async refreshTenantStripeStatus(tenantId: string): Promise<TenantStripePublicStatus> {
    const tenant = await prisma.tenant.findUnique({
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
        await prisma.tenant.update({
          where: { id: tenantId },
          data: {
            stripeChargesEnabled: false,
            stripePayoutsEnabled: false,
            stripeDetailsSubmitted: false,
            stripeOnboardingStatus: onboardingStatus,
          },
        });
      }
      return {
        stripeAccountId: null,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        onboardingStatus,
        requirements: {
          currentlyDueCount: 0,
          pastDueCount: 0,
          disabledReason: null,
        },
      };
    }

    const stripe = requireStripeClient();
    try {
      const account = await stripe.accounts.retrieve(tenant.stripeAccountId);
      const currentlyDueCount = account.requirements?.currently_due?.length ?? 0;
      const pastDueCount = account.requirements?.past_due?.length ?? 0;
      const disabledReason = account.requirements?.disabled_reason ?? null;
      const chargesEnabled = Boolean(account.charges_enabled);
      const payoutsEnabled = Boolean(account.payouts_enabled);
      const detailsSubmitted = Boolean(account.details_submitted);
      const onboardingStatus = resolveOnboardingStatus({
        stripeAccountId: tenant.stripeAccountId,
        chargesEnabled,
        detailsSubmitted,
        pastDueCount,
        disabledReason,
      });

      await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          stripeChargesEnabled: chargesEnabled,
          stripePayoutsEnabled: payoutsEnabled,
          stripeDetailsSubmitted: detailsSubmitted,
          stripeOnboardingStatus: onboardingStatus,
        },
      });

      return {
        stripeAccountId: tenant.stripeAccountId,
        chargesEnabled,
        payoutsEnabled,
        detailsSubmitted,
        onboardingStatus,
        requirements: {
          currentlyDueCount,
          pastDueCount,
          disabledReason,
        },
      };
    } catch {
      throw new StripeConnectServiceError(
        "STRIPE_API_ERROR",
        "Impossible de rafraîchir le statut Stripe Connect.",
        502
      );
    }
  }
}
