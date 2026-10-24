-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'REQUIRES_ACTION', 'SUCCEEDED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "RefundInitiator" AS ENUM ('OPERATOR', 'STRIPE_DASHBOARD', 'SYSTEM');

-- CreateEnum
CREATE TYPE "CancellationRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REFUSED', 'MANUAL');

-- AlterEnum
ALTER TYPE "LeadStatus" ADD VALUE 'cancellation_requested';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentStatus" ADD VALUE 'REFUND_PENDING';
ALTER TYPE "PaymentStatus" ADD VALUE 'PARTIALLY_REFUNDED';
ALTER TYPE "PaymentStatus" ADD VALUE 'REFUND_FAILED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LeadPaymentStatus" ADD VALUE 'REFUND_PENDING';
ALTER TYPE "LeadPaymentStatus" ADD VALUE 'PARTIALLY_REFUNDED';
ALTER TYPE "LeadPaymentStatus" ADD VALUE 'REFUND_FAILED';

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "cancellationPolicy" JSONB;

-- AlterTable
ALTER TABLE "LeadRequest" ADD COLUMN     "cancellationPolicySnapshot" JSONB,
ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "applicationFeeRefundedAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cancellationPolicySnapshot" JSONB,
ADD COLUMN     "refundedAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "refundsSyncedAt" TIMESTAMP(3),
ADD COLUMN     "stripeApplicationFeeId" TEXT,
ADD COLUMN     "stripeChargeId" TEXT;

-- AlterTable
ALTER TABLE "StripeWebhookEvent" ADD COLUMN     "stripeAccountId" TEXT;

-- CreateTable
CREATE TABLE "PaymentRefund" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "leadRequestId" TEXT NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "stripeRefundId" TEXT,
    "stripePaymentIntentId" TEXT,
    "stripeChargeId" TEXT,
    "stripeAccountId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "reasonNote" TEXT,
    "failureReason" TEXT,
    "initiatedBy" "RefundInitiator" NOT NULL DEFAULT 'OPERATOR',
    "initiatedByUserId" TEXT,
    "applicationFeeRefundExpected" INTEGER NOT NULL DEFAULT 0,
    "applicationFeeRefunded" INTEGER NOT NULL DEFAULT 0,
    "notifiedInitiatedAt" TIMESTAMP(3),
    "notifiedSucceededAt" TIMESTAMP(3),
    "notifiedFailedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CancellationRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadRequestId" TEXT NOT NULL,
    "status" "CancellationRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "previousLeadStatus" "LeadStatus" NOT NULL,
    "resolutionNote" TEXT,
    "resolvedByUserId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "CancellationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingAccessToken" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadRequestId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingAccessToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRefund_idempotencyKey_key" ON "PaymentRefund"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRefund_stripeRefundId_key" ON "PaymentRefund"("stripeRefundId");

-- CreateIndex
CREATE INDEX "PaymentRefund_tenantId_createdAt_idx" ON "PaymentRefund"("tenantId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "PaymentRefund_paymentId_idx" ON "PaymentRefund"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentRefund_tenantId_status_idx" ON "PaymentRefund"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRefund_paymentId_clientRequestId_key" ON "PaymentRefund"("paymentId", "clientRequestId");

-- CreateIndex
CREATE INDEX "CancellationRequest_tenantId_status_idx" ON "CancellationRequest"("tenantId", "status");

-- CreateIndex
CREATE INDEX "CancellationRequest_leadRequestId_idx" ON "CancellationRequest"("leadRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingAccessToken_tokenHash_key" ON "BookingAccessToken"("tokenHash");

-- CreateIndex
CREATE INDEX "BookingAccessToken_leadRequestId_idx" ON "BookingAccessToken"("leadRequestId");

-- CreateIndex
CREATE INDEX "BookingAccessToken_expiresAt_idx" ON "BookingAccessToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_leadRequestId_fkey" FOREIGN KEY ("leadRequestId") REFERENCES "LeadRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CancellationRequest" ADD CONSTRAINT "CancellationRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CancellationRequest" ADD CONSTRAINT "CancellationRequest_leadRequestId_fkey" FOREIGN KEY ("leadRequestId") REFERENCES "LeadRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingAccessToken" ADD CONSTRAINT "BookingAccessToken_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingAccessToken" ADD CONSTRAINT "BookingAccessToken_leadRequestId_fkey" FOREIGN KEY ("leadRequestId") REFERENCES "LeadRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

