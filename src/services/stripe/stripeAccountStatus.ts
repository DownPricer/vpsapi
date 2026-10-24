import { StripeOnboardingStatus } from "@prisma/client";

/** Statut d'affichage destiné au chauffeur (dérivé de l'état réel du compte Stripe). */
export type StripeUiStatus =
  | "NOT_CONNECTED"
  | "IN_PROGRESS"
  | "VERIFICATION_NEEDED"
  | "ACTIVE"
  | "PAYOUTS_SUSPENDED"
  | "ACTION_REQUIRED";

export type StripeAccountFacts = {
  hasAccount: boolean;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  currentlyDueCount: number;
  pastDueCount: number;
  pendingVerificationCount: number;
  disabledReason: string | null;
};

export function resolveStripeUiStatus(f: StripeAccountFacts): StripeUiStatus {
  if (!f.hasAccount) return "NOT_CONNECTED";
  const inReview =
    f.disabledReason === "requirements.pending_verification" || f.disabledReason === "under_review";
  // past_due, rejected.*, listed, platform_paused, other… → le chauffeur (ou Stripe) doit agir.
  if (f.pastDueCount > 0 || (f.disabledReason && !inReview)) return "ACTION_REQUIRED";
  if (!f.detailsSubmitted) return "IN_PROGRESS";
  if (inReview || f.pendingVerificationCount > 0) return "VERIFICATION_NEEDED";
  if (f.chargesEnabled && f.payoutsEnabled) return f.currentlyDueCount > 0 ? "ACTION_REQUIRED" : "ACTIVE";
  if (f.chargesEnabled && !f.payoutsEnabled) return "PAYOUTS_SUSPENDED";
  return f.currentlyDueCount > 0 ? "ACTION_REQUIRED" : "VERIFICATION_NEEDED";
}

/** Valeur d'enum persistée (compatibilité avec l'existant). */
export function resolveOnboardingEnum(f: StripeAccountFacts): StripeOnboardingStatus {
  if (!f.hasAccount) return StripeOnboardingStatus.NOT_STARTED;
  if (f.detailsSubmitted && f.chargesEnabled) return StripeOnboardingStatus.COMPLETE;
  if (f.pastDueCount > 0 || Boolean(f.disabledReason)) return StripeOnboardingStatus.RESTRICTED;
  return StripeOnboardingStatus.PENDING;
}

type StripeAccountLike = {
  details_submitted?: boolean | null;
  charges_enabled?: boolean | null;
  payouts_enabled?: boolean | null;
  requirements?: {
    currently_due?: string[] | null;
    past_due?: string[] | null;
    pending_verification?: string[] | null;
    disabled_reason?: string | null;
  } | null;
};

export function factsFromStripeAccount(account: StripeAccountLike): StripeAccountFacts {
  return {
    hasAccount: true,
    detailsSubmitted: Boolean(account.details_submitted),
    chargesEnabled: Boolean(account.charges_enabled),
    payoutsEnabled: Boolean(account.payouts_enabled),
    currentlyDueCount: account.requirements?.currently_due?.length ?? 0,
    pastDueCount: account.requirements?.past_due?.length ?? 0,
    pendingVerificationCount: account.requirements?.pending_verification?.length ?? 0,
    disabledReason: account.requirements?.disabled_reason ?? null,
  };
}

/** Le lien Express n'est proposé que si l'onboarding a été soumis (sinon Stripe le refuse). */
export function canOpenExpressDashboard(f: StripeAccountFacts): boolean {
  return f.hasAccount && f.detailsSubmitted;
}

/** Les URLs renvoyées au navigateur doivent rester sur un domaine Stripe. */
export function isStripeHostedUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    return u.hostname === "stripe.com" || u.hostname.endsWith(".stripe.com");
  } catch {
    return false;
  }
}
