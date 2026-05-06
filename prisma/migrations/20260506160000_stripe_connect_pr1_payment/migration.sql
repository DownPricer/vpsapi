-- CreateEnum
CREATE TYPE "StripeOnboardingStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'RESTRICTED', 'COMPLETE');

-- CreateEnum
CREATE TYPE "TenantPaymentMode" AS ENUM ('FULL', 'DEPOSIT');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('STRIPE');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('FULL', 'DEPOSIT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'LINK_SENT', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LeadPaymentStatus" AS ENUM ('NONE', 'PENDING', 'LINK_SENT', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "stripeAccountId" TEXT,
ADD COLUMN "stripeChargesEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "stripePayoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "stripeDetailsSubmitted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "stripeOnboardingStatus" "StripeOnboardingStatus" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN "paymentOnlineEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "paymentMode" "TenantPaymentMode" NOT NULL DEFAULT 'FULL',
ADD COLUMN "depositPercent" INTEGER,
ADD COLUMN "depositFixedAmount" INTEGER,
ADD COLUMN "paymentCurrency" TEXT NOT NULL DEFAULT 'eur',
ADD COLUMN "platformApplicationFeeAmount" INTEGER NOT NULL DEFAULT 500;

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_stripeAccountId_key" ON "Tenant"("stripeAccountId");

-- AlterTable
ALTER TABLE "LeadRequest" ADD COLUMN "paymentStatus" "LeadPaymentStatus" NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadRequestId" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "provider" "PaymentProvider" NOT NULL DEFAULT 'STRIPE',
    "mode" "PaymentMode" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "applicationFeeAmount" INTEGER NOT NULL,
    "stripeAccountId" TEXT NOT NULL,
    "stripeCheckoutSessionId" TEXT,
    "stripePaymentIntentId" TEXT,
    "stripePaymentLinkUrl" TEXT,
    "checkoutExpiresAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripeCheckoutSessionId_key" ON "Payment"("stripeCheckoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripePaymentIntentId_key" ON "Payment"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "Payment_tenantId_leadRequestId_idx" ON "Payment"("tenantId", "leadRequestId");

-- CreateIndex
CREATE INDEX "Payment_tenantId_createdAt_idx" ON "Payment"("tenantId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_leadRequestId_fkey" FOREIGN KEY ("leadRequestId") REFERENCES "LeadRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
