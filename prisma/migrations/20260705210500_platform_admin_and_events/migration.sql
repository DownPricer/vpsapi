-- CreateEnum
CREATE TYPE "PlatformAdminRole" AS ENUM ('OWNER', 'ADMIN', 'READONLY');

-- CreateTable
CREATE TABLE "PlatformAdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "role" "PlatformAdminRole" NOT NULL DEFAULT 'OWNER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "PlatformAdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "type" TEXT NOT NULL,
    "category" TEXT,
    "path" TEXT,
    "referrer" TEXT,
    "sessionId" TEXT,
    "visitorId" TEXT,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAdminUser_email_key" ON "PlatformAdminUser"("email");

-- CreateIndex
CREATE INDEX "PlatformAdminUser_role_idx" ON "PlatformAdminUser"("role");

-- CreateIndex
CREATE INDEX "PlatformAdminUser_createdAt_idx" ON "PlatformAdminUser"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "PlatformEvent_tenantId_createdAt_idx" ON "PlatformEvent"("tenantId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "PlatformEvent_type_createdAt_idx" ON "PlatformEvent"("type", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "PlatformEvent_createdAt_idx" ON "PlatformEvent"("createdAt" DESC);

