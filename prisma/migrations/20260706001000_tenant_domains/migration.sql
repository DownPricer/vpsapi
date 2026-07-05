DO $$ BEGIN
  CREATE TYPE "TenantDomainStatus" AS ENUM ('active', 'pending', 'rejected', 'archived');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "TenantDomainSource" AS ENUM ('manual', 'observed_origin', 'settings', 'env');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "TenantDomain" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT,
  "domain" TEXT NOT NULL,
  "canonicalDomain" BOOLEAN NOT NULL DEFAULT false,
  "status" "TenantDomainStatus" NOT NULL DEFAULT 'pending',
  "source" "TenantDomainSource" NOT NULL DEFAULT 'manual',
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TenantDomain_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TenantDomain_domain_key" ON "TenantDomain"("domain");
CREATE INDEX IF NOT EXISTS "TenantDomain_tenantId_idx" ON "TenantDomain"("tenantId");
CREATE INDEX IF NOT EXISTS "TenantDomain_status_lastSeenAt_idx" ON "TenantDomain"("status", "lastSeenAt" DESC);
CREATE INDEX IF NOT EXISTS "TenantDomain_domain_idx" ON "TenantDomain"("domain");

DO $$ BEGIN
  ALTER TABLE "TenantDomain"
    ADD CONSTRAINT "TenantDomain_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "PlatformEvent" ADD COLUMN IF NOT EXISTS "observedDomain" TEXT;
ALTER TABLE "PlatformEvent" ADD COLUMN IF NOT EXISTS "origin" TEXT;

CREATE INDEX IF NOT EXISTS "PlatformEvent_observedDomain_createdAt_idx" ON "PlatformEvent"("observedDomain", "createdAt" DESC);

INSERT INTO "TenantDomain" (
  "id",
  "tenantId",
  "domain",
  "canonicalDomain",
  "status",
  "source",
  "firstSeenAt",
  "lastSeenAt",
  "createdAt",
  "updatedAt"
)
SELECT
  'td_default_vtc_sitereadyshd_fr',
  'default',
  'vtc.sitereadyshd.fr',
  true,
  'active'::"TenantDomainStatus",
  'env'::"TenantDomainSource",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "Tenant" WHERE "id" = 'default')
ON CONFLICT ("domain") DO UPDATE SET
  "tenantId" = EXCLUDED."tenantId",
  "canonicalDomain" = true,
  "status" = 'active'::"TenantDomainStatus",
  "source" = 'env'::"TenantDomainSource",
  "lastSeenAt" = CURRENT_TIMESTAMP,
  "updatedAt" = CURRENT_TIMESTAMP;

