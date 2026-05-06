-- AlterTable
ALTER TABLE "LeadRequest" ADD COLUMN "clientWantsOnlinePayment" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "stripeReceiptUrl" TEXT;
