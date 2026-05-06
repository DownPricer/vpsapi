/**
 * Point d’entrée types Stripe Connect / paiement (PR1).
 * Les définitions proviennent du schéma Prisma ; régénérer avec `npx prisma generate`.
 */
export type { Payment } from "@prisma/client";
export {
  LeadPaymentStatus,
  PaymentMode,
  PaymentProvider,
  PaymentStatus,
  StripeOnboardingStatus,
  TenantPaymentMode,
} from "@prisma/client";
