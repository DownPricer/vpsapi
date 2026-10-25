-- CreateEnum
CREATE TYPE "VehicleSurchargeMode" AS ENUM ('none', 'fixed', 'per_km', 'percent_km');

-- CreateEnum
CREATE TYPE "VehicleBlockReason" AS ENUM ('maintenance', 'repair', 'leave', 'immobilized', 'other');

-- AlterTable
ALTER TABLE "LeadRequest" ADD COLUMN     "vehicleId" TEXT,
ADD COLUMN     "vehicleSnapshot" JSONB;

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "legacyId" TEXT,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "trim" TEXT,
    "year" INTEGER,
    "vehicleType" TEXT,
    "category" TEXT,
    "shortDescription" TEXT NOT NULL DEFAULT '',
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "passengerMax" INTEGER NOT NULL DEFAULT 4,
    "luggageLabel" TEXT,
    "largeBags" INTEGER,
    "airConditioning" BOOLEAN NOT NULL DEFAULT false,
    "wifi" BOOLEAN NOT NULL DEFAULT false,
    "usbChargers" BOOLEAN NOT NULL DEFAULT false,
    "babySeats" BOOLEAN NOT NULL DEFAULT false,
    "accessible" BOOLEAN NOT NULL DEFAULT false,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "paymentChips" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "internalRef" TEXT,
    "licensePlate" TEXT,
    "surchargeMode" "VehicleSurchargeMode" NOT NULL DEFAULT 'none',
    "surchargeValue" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehiclePhoto" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "alt" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehiclePhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleBlock" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "startDay" DATE NOT NULL,
    "endDay" DATE NOT NULL,
    "reason" "VehicleBlockReason" NOT NULL DEFAULT 'maintenance',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleDayOccupation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "leadId" TEXT,
    "blockId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleDayOccupation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadVehicleChange" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "fromVehicleId" TEXT,
    "toVehicleId" TEXT,
    "fromSnapshot" JSONB,
    "toSnapshot" JSONB,
    "priceBefore" DECIMAL(10,2),
    "priceAfter" DECIMAL(10,2),
    "changedByUserId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadVehicleChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Vehicle_tenantId_archivedAt_active_idx" ON "Vehicle"("tenantId", "archivedAt", "active");

-- CreateIndex
CREATE INDEX "Vehicle_tenantId_sortOrder_idx" ON "Vehicle"("tenantId", "sortOrder");

-- CreateIndex
CREATE INDEX "VehiclePhoto_tenantId_idx" ON "VehiclePhoto"("tenantId");

-- CreateIndex
CREATE INDEX "VehicleBlock_tenantId_vehicleId_startDay_idx" ON "VehicleBlock"("tenantId", "vehicleId", "startDay");

-- CreateIndex
CREATE INDEX "VehicleDayOccupation_tenantId_day_idx" ON "VehicleDayOccupation"("tenantId", "day");

-- CreateIndex
CREATE INDEX "VehicleDayOccupation_leadId_idx" ON "VehicleDayOccupation"("leadId");

-- CreateIndex
CREATE INDEX "VehicleDayOccupation_blockId_idx" ON "VehicleDayOccupation"("blockId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleDayOccupation_vehicleId_day_key" ON "VehicleDayOccupation"("vehicleId", "day");

-- CreateIndex
CREATE INDEX "LeadVehicleChange_tenantId_leadId_createdAt_idx" ON "LeadVehicleChange"("tenantId", "leadId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "LeadRequest_tenantId_vehicleId_scheduledStart_idx" ON "LeadRequest"("tenantId", "vehicleId", "scheduledStart");

-- AddForeignKey
ALTER TABLE "LeadRequest" ADD CONSTRAINT "LeadRequest_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehiclePhoto" ADD CONSTRAINT "VehiclePhoto_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleBlock" ADD CONSTRAINT "VehicleBlock_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleDayOccupation" ADD CONSTRAINT "VehicleDayOccupation_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleDayOccupation" ADD CONSTRAINT "VehicleDayOccupation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "LeadRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleDayOccupation" ADD CONSTRAINT "VehicleDayOccupation_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "VehicleBlock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadVehicleChange" ADD CONSTRAINT "LeadVehicleChange_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "LeadRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Contraintes métier non exprimables dans schema.prisma
-- ---------------------------------------------------------------------------

-- 5 photos max (positions 0..4) ; unicité différée pour permettre la réorganisation en une transaction.
ALTER TABLE "VehiclePhoto" ADD CONSTRAINT "VehiclePhoto_position_range" CHECK ("position" >= 0 AND "position" <= 4);
ALTER TABLE "VehiclePhoto" ADD CONSTRAINT "VehiclePhoto_vehicleId_position_key" UNIQUE ("vehicleId", "position") DEFERRABLE INITIALLY DEFERRED;

-- Une occupation provient soit d'une réservation, soit d'un blocage manuel (jamais les deux, jamais aucun).
ALTER TABLE "VehicleDayOccupation" ADD CONSTRAINT "VehicleDayOccupation_one_source" CHECK (("leadId" IS NOT NULL) <> ("blockId" IS NOT NULL));

ALTER TABLE "VehicleBlock" ADD CONSTRAINT "VehicleBlock_days_order" CHECK ("endDay" >= "startDay");

-- Supplément cohérent avec son mode.
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_surcharge_value_range" CHECK (
  "surchargeValue" >= 0 AND ("surchargeMode" <> 'percent_km' OR "surchargeValue" <= 100) AND ("surchargeMode" <> 'none' OR "surchargeValue" = 0)
);
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_passengerMax_positive" CHECK ("passengerMax" >= 1);

-- Un seul véhicule « mis en avant » par tenant.
CREATE UNIQUE INDEX "Vehicle_one_featured_per_tenant" ON "Vehicle"("tenantId") WHERE "featured" = true AND "archivedAt" IS NULL;

-- ---------------------------------------------------------------------------
-- Migration des données : Tenant.settings.vehicles.items[] -> table Vehicle / VehiclePhoto
-- Idempotente et non destructive : le JSON d'origine n'est PAS modifié (retour arrière possible).
-- Si `items` est vide, le véhicule `vehicles.featured` est repris (comportement de normalizeTenantVehicles).
-- Seules les 5 premières photos non vides sont reprises (limite produit) ; les suivantes restent dans le JSON d'origine.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE "_fleet_src" AS
SELECT
  t."id" AS tenant_id,
  v.ord AS ord,
  v.item AS item,
  'veh_' || substr(md5(t."id" || ':' || COALESCE(NULLIF(v.item->>'id', ''), v.ord::text)), 1, 24) AS vid,
  t.settings->'vehicles'->>'featuredVehicleId' AS featured_id
FROM "Tenant" t,
  LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(t.settings->'vehicles'->'items') = 'array' AND jsonb_array_length(t.settings->'vehicles'->'items') > 0
        THEN t.settings->'vehicles'->'items'
      WHEN jsonb_typeof(t.settings->'vehicles'->'featured') = 'object'
        THEN jsonb_build_array(t.settings->'vehicles'->'featured')
      ELSE '[]'::jsonb
    END
  ) WITH ORDINALITY AS v(item, ord)
WHERE jsonb_typeof(v.item) = 'object';

INSERT INTO "Vehicle" (
  "id", "tenantId", "legacyId", "name", "shortDescription", "description", "active", "featured", "sortOrder",
  "passengerMax", "luggageLabel", "features", "paymentChips", "updatedAt"
)
SELECT
  s.vid,
  s.tenant_id,
  NULLIF(s.item->>'id', ''),
  COALESCE(NULLIF(trim(s.item->>'name'), ''), 'Véhicule ' || s.ord),
  COALESCE(s.item->>'headline', ''),
  NULLIF(s.item->>'highlightText', ''),
  COALESCE((s.item->>'enabled')::boolean, true),
  false,
  (s.ord - 1)::int,
  GREATEST(1, COALESCE(floor(NULLIF(s.item->>'passengerMax', '')::numeric)::int, 4)),
  NULLIF(s.item->>'baggageLabel', ''),
  ARRAY[]::text[],
  CASE WHEN jsonb_typeof(s.item->'paymentChips') = 'array'
    THEN ARRAY(SELECT jsonb_array_elements_text(s.item->'paymentChips'))
    ELSE ARRAY[]::text[] END,
  now()
FROM "_fleet_src" s
ON CONFLICT ("id") DO NOTHING;

-- Véhicule mis en avant : celui désigné par featuredVehicleId s'il est actif, sinon le premier actif.
UPDATE "Vehicle" v SET "featured" = true
FROM "_fleet_src" s
WHERE v."id" = s.vid AND v."active" = true AND s.item->>'id' = s.featured_id;

UPDATE "Vehicle" v SET "featured" = true
WHERE v."id" IN (
  SELECT DISTINCT ON (x."tenantId") x."id" FROM "Vehicle" x
  WHERE x."active" = true AND x."archivedAt" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "Vehicle" y WHERE y."tenantId" = x."tenantId" AND y."featured" = true)
  ORDER BY x."tenantId", x."sortOrder"
);

INSERT INTO "VehiclePhoto" ("id", "tenantId", "vehicleId", "url", "alt", "position")
SELECT
  'vph_' || substr(md5(r.vid || ':' || r.gord), 1, 24), r.tenant_id, r.vid, r.src, r.alt, (r.rn - 1)::int
FROM (
  SELECT
    s.vid, s.tenant_id, g.ord AS gord, trim(g.photo->>'src') AS src, COALESCE(g.photo->>'alt', '') AS alt,
    row_number() OVER (PARTITION BY s.vid ORDER BY g.ord) AS rn
  FROM "_fleet_src" s,
    LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.item->'gallery') = 'array' THEN s.item->'gallery' ELSE '[]'::jsonb END)
      WITH ORDINALITY AS g(photo, ord)
  WHERE jsonb_typeof(g.photo) = 'object' AND COALESCE(trim(g.photo->>'src'), '') <> ''
) r
WHERE r.rn <= 5
  AND EXISTS (SELECT 1 FROM "Vehicle" v WHERE v."id" = r.vid)
  AND NOT EXISTS (SELECT 1 FROM "VehiclePhoto" x WHERE x."id" = 'vph_' || substr(md5(r.vid || ':' || r.gord), 1, 24));

DROP TABLE "_fleet_src";
