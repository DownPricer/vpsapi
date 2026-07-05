-- Baseline init pour permettre `migrate dev` (shadow DB vide).
-- Cette migration est idempotente et ne modifie pas une DB déjà initialisée.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OperatorRole') THEN
    CREATE TYPE "OperatorRole" AS ENUM ('admin', 'agent');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LeadKind') THEN
    CREATE TYPE "LeadKind" AS ENUM ('contact', 'devis', 'reservation');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LeadStatus') THEN
    CREATE TYPE "LeadStatus" AS ENUM ('new', 'pending', 'accepted', 'refused', 'processed', 'archived', 'scheduled', 'completed', 'cancelled', 'expired');
  END IF;
END $$;

-- Tenant (sans `settings` : ajouté par la migration suivante)
CREATE TABLE IF NOT EXISTS "Tenant" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "configRef" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Tenant_slug_key" ON "Tenant"("slug");

-- OperatorUser
CREATE TABLE IF NOT EXISTS "OperatorUser" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" "OperatorRole" NOT NULL DEFAULT 'agent',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OperatorUser_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OperatorUser_tenantId_email_key" ON "OperatorUser"("tenantId", "email");
CREATE INDEX IF NOT EXISTS "OperatorUser_tenantId_idx" ON "OperatorUser"("tenantId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OperatorUser_tenantId_fkey'
  ) THEN
    ALTER TABLE "OperatorUser"
      ADD CONSTRAINT "OperatorUser_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- LeadRequest (sans `paymentStatus`, sans `clientWantsOnlinePayment`)
CREATE TABLE IF NOT EXISTS "LeadRequest" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "kind" "LeadKind" NOT NULL,
  "status" "LeadStatus" NOT NULL,
  "clientName" TEXT NOT NULL,
  "clientPhone" TEXT NOT NULL,
  "clientEmail" TEXT NOT NULL,
  "rawPayload" JSONB NOT NULL,
  "flatPayload" JSONB NOT NULL,
  "pricingResult" JSONB,
  "sourceSite" TEXT,
  "scheduledStart" TIMESTAMP(3),
  "scheduledEnd" TIMESTAMP(3),
  "acceptedAt" TIMESTAMP(3),
  "refusedAt" TIMESTAMP(3),
  "operatorNote" TEXT,
  "emailSentAt" TIMESTAMP(3),
  "emailError" TEXT,
  "customerDecisionMailSentAt" TIMESTAMP(3),
  "customerDecisionMailLastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeadRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LeadRequest_tenantId_createdAt_idx" ON "LeadRequest"("tenantId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "LeadRequest_tenantId_kind_status_idx" ON "LeadRequest"("tenantId", "kind", "status");
CREATE INDEX IF NOT EXISTS "LeadRequest_tenantId_scheduledStart_idx" ON "LeadRequest"("tenantId", "scheduledStart");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'LeadRequest_tenantId_fkey'
  ) THEN
    ALTER TABLE "LeadRequest"
      ADD CONSTRAINT "LeadRequest_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- LeadStatusHistory
CREATE TABLE IF NOT EXISTS "LeadStatusHistory" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "previousStatus" "LeadStatus",
  "newStatus" "LeadStatus" NOT NULL,
  "changedByUserId" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadStatusHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LeadStatusHistory_tenantId_createdAt_idx" ON "LeadStatusHistory"("tenantId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "LeadStatusHistory_leadId_createdAt_idx" ON "LeadStatusHistory"("leadId", "createdAt" DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadStatusHistory_leadId_fkey') THEN
    ALTER TABLE "LeadStatusHistory"
      ADD CONSTRAINT "LeadStatusHistory_leadId_fkey"
      FOREIGN KEY ("leadId") REFERENCES "LeadRequest"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadStatusHistory_tenantId_fkey') THEN
    ALTER TABLE "LeadStatusHistory"
      ADD CONSTRAINT "LeadStatusHistory_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadStatusHistory_changedByUserId_fkey') THEN
    ALTER TABLE "LeadStatusHistory"
      ADD CONSTRAINT "LeadStatusHistory_changedByUserId_fkey"
      FOREIGN KEY ("changedByUserId") REFERENCES "OperatorUser"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AuthSession
CREATE TABLE IF NOT EXISTS "AuthSession" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "refreshTokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "replacedById" TEXT,
  "ip" TEXT,
  "userAgent" TEXT,
  CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AuthSession_tenantId_userId_idx" ON "AuthSession"("tenantId", "userId");
CREATE INDEX IF NOT EXISTS "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AuthSession_tenantId_fkey') THEN
    ALTER TABLE "AuthSession"
      ADD CONSTRAINT "AuthSession_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AuthSession_userId_fkey') THEN
    ALTER TABLE "AuthSession"
      ADD CONSTRAINT "AuthSession_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "OperatorUser"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

