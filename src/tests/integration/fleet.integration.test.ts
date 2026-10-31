/**
 * Flotte, suppléments, disponibilités, concurrence — sur une base PostgreSQL JETABLE (jamais la production).
 * Lancer avec : TEST_DATABASE_URL=postgresql://… (toutes les migrations appliquées). Sans cette variable, la suite est ignorée.
 */
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

const TEST_DB = process.env.TEST_DATABASE_URL;
const UPLOADS = mkdtempSync(path.join(os.tmpdir(), "vtc-uploads-"));
if (TEST_DB) {
  process.env.DATABASE_URL = TEST_DB;
  process.env.UPLOADS_DIR = UPLOADS;
  process.env.STRIPE_SECRET_KEY = "sk_test_dummy_not_used_for_network";
  process.env.NODE_ENV = "test";
  process.env.DISTANCE_MATRIX_API_KEY = "test-key-distance-stubbed";
}

const suite = TEST_DB ? describe : describe.skip;

suite("flotte & disponibilités (PostgreSQL jetable)", () => {
  let prisma: typeof import("../../db/prisma").prisma;
  let V: typeof import("../../services/vehicle.service");
  let A: typeof import("../../services/vehicleAvailability.service");
  let L: typeof import("../../services/leadVehicle.service");
  let R: typeof import("../../services/request.service");
  let calc: typeof import("../../modules/pricing/calculator");
  let apply: typeof import("../../modules/pricing/vehicleSurchargeApply");
  let stripePay: typeof import("../../services/stripePayment.service");
  let sharp: typeof import("sharp").default;
  let server: import("node:http").Server;
  let base = "";
  let tokens: typeof import("../../modules/auth/tokens");

  const TA = "itest_fleet_a";
  const TB = "itest_fleet_b";
  const UA = "itest_user_a";
  let reqs: InstanceType<typeof import("../../services/request.service").RequestService>;
  let seq = 0;

  const png = async (w = 300, h = 200) =>
    sharp({ create: { width: w, height: h, channels: 3, background: { r: 30, g: 60, b: 120 } } }).png().toBuffer();

  const mkVehicle = (tenantId: string, name: string, extra: object = {}) =>
    V.createVehicle(tenantId, { name, passengerMax: 4, active: true, ...extra } as never);

  /** Demande en attente pour un véhicule à une date donnée (jours civils Europe/Paris). */
  async function seedLead(
    tenantId: string,
    vehicleId: string | null,
    start: string,
    end?: string,
    extra: Record<string, unknown> = {}
  ) {
    seq += 1;
    return prisma.leadRequest.create({
      data: {
        tenantId,
        kind: "devis",
        status: "pending",
        clientName: `Client ${seq}`,
        clientPhone: "0600000000",
        clientEmail: `c${seq}@example.test`,
        rawPayload: { trajetClassique: { TCpassagers: "2" } },
        flatPayload: { ResumeTrajet: "A → B", TarifTotal: "140.00" },
        pricingResult: { tarif: 140, vehicleBasis: { kmApplicable: true, billableKm: 80, kmAmount: 160 } },
        scheduledStart: new Date(start),
        scheduledEnd: new Date(end ?? new Date(new Date(start).getTime() + 90 * 60000).toISOString()),
        ...(vehicleId ? { vehicleId } : {}),
        ...extra,
      } as never,
    });
  }
  const accept = (tenantId: string, leadId: string, status = "accepted") =>
    reqs.updateStatus({ tenantId, leadId, nextStatus: status as never, changedByUserId: UA });
  const occupied = async (vehicleId: string) =>
    (await prisma.vehicleDayOccupation.findMany({ where: { vehicleId }, orderBy: { day: "asc" } })).map((o) =>
      o.day.toISOString().slice(0, 10)
    );

  before(async () => {
    prisma = (await import("../../db/prisma")).prisma;
    V = await import("../../services/vehicle.service");
    A = await import("../../services/vehicleAvailability.service");
    L = await import("../../services/leadVehicle.service");
    R = await import("../../services/request.service");
    calc = await import("../../modules/pricing/calculator");
    apply = await import("../../modules/pricing/vehicleSurchargeApply");
    stripePay = await import("../../services/stripePayment.service");
    tokens = await import("../../modules/auth/tokens");
    sharp = (await import("sharp")).default;
    reqs = new R.RequestService();

    await prisma.tenant.deleteMany({ where: { id: { in: [TA, TB] } } });
    await prisma.tenant.create({ data: { id: TA, name: "Fleet A", slug: "itest-fleet-a" } });
    await prisma.tenant.create({ data: { id: TB, name: "Fleet B", slug: "itest-fleet-b" } });
    await prisma.operatorUser.create({ data: { id: UA, tenantId: TA, email: "op@a.test", passwordHash: "x", role: "admin" } });

    const { createApp } = await import("../../app");
    server = createApp().listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    await prisma.tenant.deleteMany({ where: { id: { in: [TA, TB] } } });
    await prisma.$disconnect();
    try { rmSync(UPLOADS, { recursive: true, force: true }); } catch { /* fichiers encore ouverts (Windows) */ }
  });

  // -------------------------------------------------------------------------
  describe("véhicules & photos", () => {
    it("crée 1 puis 5 véhicules ; un seul est mis en avant", async () => {
      const first = await mkVehicle(TA, "Renault Espace 5");
      assert.equal(first.featured, true);
      for (const n of ["Mercedes Classe V", "Mercedes Classe E", "Tesla Model Y", "BMW Série 5"]) await mkVehicle(TA, n);
      const all = await V.listProVehicles(TA);
      assert.equal(all.length, 5);
      assert.equal(all.filter((v) => v.featured).length, 1);
      const classeV = all.find((v) => v.name === "Mercedes Classe V")!;
      await V.setFeaturedVehicle(TA, classeV.id);
      const again = await V.listProVehicles(TA);
      assert.equal(again.filter((v) => v.featured).length, 1);
      assert.equal(again.find((v) => v.featured)!.id, classeV.id);
    });

    it("5 photos max : la 6e est refusée proprement", async () => {
      const v = await mkVehicle(TA, "Photos test");
      for (let i = 0; i < 5; i++) await V.addVehiclePhoto(TA, v.id, await png(300 + i, 200), `photo ${i}`);
      const full = (await V.getProVehicle(TA, v.id))!;
      assert.equal(full.photoCount, 5);
      assert.deepEqual(full.photos.map((p) => p.position), [0, 1, 2, 3, 4]);
      await assert.rejects(V.addVehiclePhoto(TA, v.id, await png()), (e: { code?: string }) => e.code === "PHOTO_LIMIT");
      assert.equal((await V.getProVehicle(TA, v.id))!.photoCount, 5);
      // contrainte base : impossible d'insérer une 6e position même en contournant le service
      await assert.rejects(prisma.vehiclePhoto.create({ data: { tenantId: TA, vehicleId: v.id, url: "/x.png", position: 5 } }));
    });

    it("réorganise, change la couverture, supprime, remplace", async () => {
      const v = await mkVehicle(TA, "Photos order");
      for (let i = 0; i < 3; i++) await V.addVehiclePhoto(TA, v.id, await png(300 + i * 10, 200));
      let cur = (await V.getProVehicle(TA, v.id))!;
      const ids = cur.photos.map((p) => p.id);
      cur = await V.reorderVehiclePhotos(TA, v.id, [ids[2], ids[0], ids[1]]);
      assert.deepEqual(cur.photos.map((p) => p.id), [ids[2], ids[0], ids[1]]);
      cur = await V.setVehicleCoverPhoto(TA, v.id, ids[1]);
      assert.equal(cur.photos[0].id, ids[1]);
      await assert.rejects(V.reorderVehiclePhotos(TA, v.id, [ids[0], ids[1]]), (e: { code?: string }) => e.code === "VALIDATION_ERROR");
      const oldUrl = cur.photos[1].url;
      cur = await V.replaceVehiclePhoto(TA, v.id, cur.photos[1].id, await png(500, 300));
      assert.notEqual(cur.photos[1].url, oldUrl);
      cur = await V.removeVehiclePhoto(TA, v.id, cur.photos[0].id);
      assert.equal(cur.photoCount, 2);
      assert.deepEqual(cur.photos.map((p) => p.position), [0, 1]);
    });

    it("rejette un faux fichier image, un format non autorisé et un fichier trop lourd ; stocke du WebP sous le dossier du tenant", async () => {
      const v = await mkVehicle(TA, "Upload sécurité");
      await assert.rejects(V.addVehiclePhoto(TA, v.id, Buffer.from("<?php echo 1; ?>")), (e: { code?: string }) => e.code === "INVALID_IMAGE");
      const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } }).gif().toBuffer();
      await assert.rejects(V.addVehiclePhoto(TA, v.id, gif), (e: { code?: string }) => e.code === "UNSUPPORTED_FORMAT");
      await assert.rejects(V.addVehiclePhoto(TA, v.id, Buffer.alloc(9 * 1024 * 1024, 1)), (e: { code?: string }) => e.code === "FILE_TOO_LARGE");
      const out = await V.addVehiclePhoto(TA, v.id, await png(4000, 3000), "grande");
      const url = out.photos[0].url;
      assert.match(url, new RegExp(`^/media/vehicles/${TA}/[0-9a-f-]{36}\\.webp$`));
      assert.ok(existsSync(path.join(UPLOADS, "vehicles", TA, url.split("/").pop()!)));
      const meta = await sharp(path.join(UPLOADS, "vehicles", TA, url.split("/").pop()!)).metadata();
      assert.equal(meta.format, "webp");
      assert.ok(Math.max(meta.width!, meta.height!) <= 1800, "redimensionnée");
    });

    it("la suppression d'une photo conserve le fichier cité par un devis historique", async () => {
      const v = await mkVehicle(TA, "Photo historique");
      const withPhoto = await V.addVehiclePhoto(TA, v.id, await png());
      const photo = withPhoto.photos[0];
      await seedLead(TA, v.id, "2027-03-01T09:00:00Z", undefined, { vehicleSnapshot: { name: v.name, photoUrl: photo.url } });
      await V.removeVehiclePhoto(TA, v.id, photo.id);
      assert.ok(existsSync(path.join(UPLOADS, "vehicles", TA, photo.url.split("/").pop()!)), "fichier gardé pour l'historique");
      const v2 = await mkVehicle(TA, "Photo libre");
      const p2 = (await V.addVehiclePhoto(TA, v2.id, await png())).photos[0];
      await V.removeVehiclePhoto(TA, v2.id, p2.id);
      assert.equal(existsSync(path.join(UPLOADS, "vehicles", TA, p2.url.split("/").pop()!)), false, "fichier supprimé s'il n'est cité nulle part");
    });

    it("archive (jamais de suppression) ; refus s'il reste des réservations à venir", async () => {
      const v = await mkVehicle(TA, "À archiver");
      const lead = await seedLead(TA, v.id, "2099-05-10T08:00:00Z");
      await accept(TA, lead.id);
      await assert.rejects(V.archiveVehicle(TA, v.id), (e: { code?: string }) => e.code === "HAS_UPCOMING_BOOKINGS");
      // Annulation hors PATCH /status (route dédiée) : mise à jour directe pour libérer le véhicule en test.
      await prisma.leadRequest.update({
        where: { id: lead.id },
        data: { status: "cancelled", cancelledAt: new Date() },
      });
      await A.syncLeadOccupation(prisma, lead.id);
      const archived = await V.archiveVehicle(TA, v.id);
      assert.equal(archived.archived, true);
      assert.equal(archived.active, false);
      assert.equal(await prisma.vehicle.count({ where: { id: v.id } }), 1, "ligne conservée");
      assert.equal((await V.listProVehicles(TA)).some((x) => x.id === v.id), false);
      assert.equal((await V.listPublicVehicles(TA)).some((x) => x.id === v.id), false);
      assert.equal((await V.restoreVehicle(TA, v.id)).archived, false);
    });
  });

  // -------------------------------------------------------------------------
  describe("multi-tenant & sécurité", () => {
    it("un tenant ne voit, ne modifie ni ne sélectionne le véhicule d'un autre", async () => {
      const a = await mkVehicle(TA, "Véhicule privé A");
      assert.equal(await V.getProVehicle(TB, a.id), null);
      await assert.rejects(V.updateVehicle(TB, a.id, { name: "piraté" }), (e: { code?: string }) => e.code === "NOT_FOUND");
      await assert.rejects(V.addVehiclePhoto(TB, a.id, await png()), (e: { code?: string }) => e.code === "NOT_FOUND");
      await assert.rejects(V.archiveVehicle(TB, a.id), (e: { code?: string }) => e.code === "NOT_FOUND");
      await assert.rejects(
        A.createVehicleBlock({ tenantId: TB, vehicleId: a.id, startDay: "2027-01-01", endDay: "2027-01-02", reason: "leave" }),
        (e: { code?: string }) => e.code === "NOT_FOUND"
      );
      await assert.rejects(
        V.resolveVehicleForRequest(TB, { vehicleId: a.id }),
        (e: { code?: string }) => e.code === "VEHICLE_NOT_FOUND" || e.code === "VEHICLE_REQUIRED"
      );
      assert.equal((await V.listProVehicles(TB)).length, 0);
    });

    it("véhicule inexistant, désactivé, capacité insuffisante, id obligatoire si la flotte existe", async () => {
      await assert.rejects(V.resolveVehicleForRequest(TA, { vehicleId: "veh_inexistant" }), (e: { code?: string }) => e.code === "VEHICLE_NOT_FOUND");
      const off = await mkVehicle(TA, "Désactivé", { active: false });
      await assert.rejects(V.resolveVehicleForRequest(TA, { vehicleId: off.id }), (e: { code?: string }) => e.code === "VEHICLE_INACTIVE");
      const small = await mkVehicle(TA, "Petit", { passengerMax: 2, largeBags: 1 });
      await assert.rejects(
        V.resolveVehicleForRequest(TA, { vehicleId: small.id, trajetClassique: { TCpassagers: "3" } }),
        (e: { code?: string }) => e.code === "VEHICLE_CAPACITY"
      );
      await assert.rejects(
        V.resolveVehicleForRequest(TA, { vehicleId: small.id, transfertAeroport: { TApassagers: "2", TAbagagesaller: "3" } }),
        (e: { code?: string }) => e.code === "VEHICLE_CAPACITY"
      );
      await assert.rejects(V.resolveVehicleForRequest(TA, {}), (e: { code?: string }) => e.code === "VEHICLE_REQUIRED");
      assert.equal(await V.resolveVehicleForRequest(TB, {}), null, "tenant sans véhicule : comportement historique");
    });

    it("l'API publique n'expose ni immatriculation ni référence interne", async () => {
      const v = await mkVehicle(TA, "Avec secrets", { licensePlate: "AB-123-CD", internalRef: "FLOTTE-7" });
      const pub = JSON.stringify(await V.listPublicVehicles(TA));
      assert.ok(pub.includes("Avec secrets"));
      assert.ok(!pub.includes("AB-123-CD") && !pub.includes("FLOTTE-7") && !/licensePlate|internalRef/.test(pub));
      const pro = await V.getProVehicle(TA, v.id);
      assert.equal(pro!.licensePlate, "AB-123-CD");
    });
  });

  // -------------------------------------------------------------------------
  describe("tarif : prix final identique de bout en bout", () => {
    it("140 € + Classe V (+50 € fixe) = 190 € dans le résultat, le devis (pricingResult) et le montant Stripe", async () => {
      const { parsePricingEngineJson } = await import("../../config/tenants/engineSchema");
      const engineJson = (await import("../../config/tenants/engines/default.engine.json")).default;
      const engine = parsePricingEngineJson(engineJson) as import("../../modules/pricing/engineTypes").TenantPricingEngineConfig;
      const v = await mkVehicle(TA, "Mercedes Classe V tarif", { passengerMax: 7, surchargeMode: "fixed", surchargeValue: 50 });
      const sel = (await V.resolveVehicleForRequest(TA, { vehicleId: v.id, trajetClassique: { TCpassagers: "5" } }))!;
      const body = {
        general: { TypeService: "Trajet Classique" },
        trajetClassique: {
          TCtrajet: "Aller Simple",
          TCallerpriseencharge: "Satillieu",
          TCallerDestination: "Lyon",
          TCallerdate: "10/05/2026",
          TCallerheure: "14:30",
        },
      };
      const result = await calc.calculerTarif("classique", body, { aller: { approche: { km: 0 }, trajet: { km: 80 }, retourBase: { km: 0 } }, retour: { approche: {}, trajet: {}, retourBase: {} } }, engine);
      const base = result.tarif;
      const snap = apply.applyVehicleToResult(result, sel);
      assert.equal(result.tarif, base + 50);
      const lead = await seedLead(TA, v.id, "2027-05-10T12:30:00Z", undefined, {
        pricingResult: JSON.parse(JSON.stringify(result)),
        vehicleSnapshot: JSON.parse(JSON.stringify(snap)),
        flatPayload: { TarifTotal: result.tarif.toFixed(2) },
      });
      const stored = (await prisma.leadRequest.findUnique({ where: { id: lead.id } }))!;
      assert.equal(stripePay.resolveLeadTotalAmountCents(stored), Math.round((base + 50) * 100));
      assert.equal(((stored.pricingResult as Record<string, unknown>).vehicle as { surcharge: { amount: number } }).surcharge.amount, 50);
      assert.equal((stored.pricingResult as Record<string, unknown>).tarifBase, base);
    });

    it("changer le supplément du véhicule plus tard ne modifie pas un devis existant (snapshot)", async () => {
      const v = await mkVehicle(TA, "Snapshot test", { surchargeMode: "fixed", surchargeValue: 30 });
      const snap = apply.buildVehicleSnapshot(
        { id: v.id, name: v.name, passengerMax: 4, surchargeMode: "fixed", surchargeValue: 30 },
        100,
        null
      );
      const lead = await seedLead(TA, v.id, "2027-06-01T09:00:00Z", undefined, {
        pricingResult: { tarif: 130, tarifBase: 100, vehicle: snap },
        vehicleSnapshot: JSON.parse(JSON.stringify(snap)),
      });
      await V.updateVehicle(TA, v.id, { surchargeMode: "fixed", surchargeValue: 999 });
      const after = (await prisma.leadRequest.findUnique({ where: { id: lead.id } }))!;
      assert.equal((after.pricingResult as { tarif: number }).tarif, 130);
      assert.equal(stripePay.resolveLeadTotalAmountCents(after), 13000);
    });
  });

  // -------------------------------------------------------------------------
  describe("disponibilités", () => {
    it("scénario principal : accepter A bloque, B refusé, annuler A libère, B acceptable", async () => {
      const v = await mkVehicle(TA, "Mercedes Classe V dispo");
      const a = await seedLead(TA, v.id, "2026-11-15T09:00:00Z");
      const b = await seedLead(TA, v.id, "2026-11-15T16:00:00Z");
      // devis simplement demandés : ne bloquent pas
      assert.deepEqual(await occupied(v.id), []);

      await accept(TA, a.id);
      assert.deepEqual(await occupied(v.id), ["2026-11-15"]);

      await assert.rejects(accept(TA, b.id), (e: { code?: string; message?: string }) => {
        assert.equal(e.code, "VEHICLE_UNAVAILABLE");
        assert.match(e.message!, /déjà réservé pour cette date/);
        return true;
      });
      const bStill = (await prisma.leadRequest.findUnique({ where: { id: b.id } }))!;
      assert.equal(bStill.status, "pending", "statut inchangé après refus");
      assert.equal(await prisma.leadStatusHistory.count({ where: { leadId: b.id, newStatus: "accepted" } }), 0);

      await prisma.leadRequest.update({
        where: { id: a.id },
        data: { status: "cancelled", cancelledAt: new Date() },
      });
      await A.syncLeadOccupation(prisma, a.id);
      assert.deepEqual(await occupied(v.id), [], "véhicule libéré");
      assert.equal(await prisma.leadRequest.count({ where: { id: a.id } }), 1, "historique conservé");

      await accept(TA, b.id);
      assert.deepEqual(await occupied(v.id), ["2026-11-15"]);
    });

    it("une demande d'annulation client (non confirmée) ne libère pas le véhicule", async () => {
      const v = await mkVehicle(TA, "Annulation demandée");
      const a = await seedLead(TA, v.id, "2026-12-01T09:00:00Z");
      await accept(TA, a.id);
      await prisma.leadRequest.update({
        where: { id: a.id },
        data: { status: "cancellation_requested" },
      });
      await A.syncLeadOccupation(prisma, a.id);
      assert.deepEqual(await occupied(v.id), ["2026-12-01"]);
    });

    it("statuts non bloquants : pending, processed, refused, archived, expired ne réservent rien", async () => {
      const v = await mkVehicle(TA, "Statuts");
      for (const st of ["pending", "processed", "refused", "archived", "expired"]) {
        const l = await seedLead(TA, v.id, "2026-12-05T09:00:00Z");
        await accept(TA, l.id, st);
      }
      assert.deepEqual(await occupied(v.id), []);
    });

    it("deux véhicules différents le même jour : OK", async () => {
      const v1 = await mkVehicle(TA, "Véhicule 1 même jour");
      const v2 = await mkVehicle(TA, "Véhicule 2 même jour");
      await accept(TA, (await seedLead(TA, v1.id, "2026-12-10T09:00:00Z")).id);
      await accept(TA, (await seedLead(TA, v2.id, "2026-12-10T09:00:00Z")).id);
      assert.deepEqual(await occupied(v1.id), ["2026-12-10"]);
      assert.deepEqual(await occupied(v2.id), ["2026-12-10"]);
    });

    it("acceptations simultanées : une seule réussit, la contrainte base protège", async () => {
      for (let round = 0; round < 5; round++) {
        const v = await mkVehicle(TA, `Concurrence ${round}`);
        const leads = await Promise.all(Array.from({ length: 4 }, () => seedLead(TA, v.id, "2027-02-01T09:00:00Z")));
        const results = await Promise.allSettled(leads.map((l) => accept(TA, l.id)));
        const okCount = results.filter((r) => r.status === "fulfilled").length;
        assert.equal(okCount, 1, `round ${round}: exactement une acceptation`);
        for (const r of results) {
          if (r.status === "rejected") assert.equal((r.reason as { code?: string }).code, "VEHICLE_UNAVAILABLE");
        }
        assert.deepEqual(await occupied(v.id), ["2027-02-01"]);
        const accepted = await prisma.leadRequest.count({ where: { vehicleId: v.id, status: "accepted" } });
        assert.equal(accepted, 1);
      }
    });

    it("la base refuse elle-même une double occupation (aucune dépendance au code applicatif)", async () => {
      const v = await mkVehicle(TA, "Contrainte base");
      const l1 = await seedLead(TA, v.id, "2027-02-10T09:00:00Z");
      const l2 = await seedLead(TA, v.id, "2027-02-10T09:00:00Z");
      const day = new Date("2027-02-10T00:00:00Z");
      await prisma.vehicleDayOccupation.create({ data: { tenantId: TA, vehicleId: v.id, day, leadId: l1.id } });
      await assert.rejects(prisma.vehicleDayOccupation.create({ data: { tenantId: TA, vehicleId: v.id, day, leadId: l2.id } }));
    });

    it("course sur plusieurs jours : tous les jours sont bloqués ; les jours libres restent réservables", async () => {
      const v = await mkVehicle(TA, "Multi-jours");
      const trip = await seedLead(TA, v.id, "2027-03-10T08:00:00Z", "2027-03-12T18:00:00Z");
      await accept(TA, trip.id);
      assert.deepEqual(await occupied(v.id), ["2027-03-10", "2027-03-11", "2027-03-12"]);
      const mid = await seedLead(TA, v.id, "2027-03-11T10:00:00Z");
      await assert.rejects(accept(TA, mid.id), (e: { code?: string }) => e.code === "VEHICLE_UNAVAILABLE");
      const free = await seedLead(TA, v.id, "2027-03-13T10:00:00Z");
      await accept(TA, free.id);
    });

    it("fuseau Europe/Paris : 00h30 locale le 15 occupe le 15 (pas le 14 UTC) ; passage heure d'été sans décalage", async () => {
      const days = await import("../../modules/fleet/days");
      assert.deepEqual(days.localDaysBetween(new Date("2026-11-14T23:30:00Z"), null, "Europe/Paris"), ["2026-11-15"]);
      // nuit du changement d'heure (29 mars 2026) : 23h30 le 28 → 03h30 le 29
      assert.deepEqual(days.localDaysBetween(new Date("2026-03-28T22:30:00Z"), new Date("2026-03-29T01:30:00Z"), "Europe/Paris"), ["2026-03-28", "2026-03-29"]);
      // changement d'heure d'automne (25 oct 2026) : 3 jours civils consécutifs, aucun saut ni doublon
      assert.deepEqual(days.localDaysBetween(new Date("2026-10-24T10:00:00Z"), new Date("2026-10-26T10:00:00Z"), "Europe/Paris"), ["2026-10-24", "2026-10-25", "2026-10-26"]);

      const v = await mkVehicle(TA, "Fuseau");
      const l = await seedLead(TA, v.id, "2026-11-14T23:30:00Z", "2026-11-15T00:30:00Z");
      await accept(TA, l.id);
      assert.deepEqual(await occupied(v.id), ["2026-11-15"]);
    });

    it("blocage manuel : bloque, conflit avec réservation, suppression libère", async () => {
      const v = await mkVehicle(TA, "Entretien");
      const booked = await seedLead(TA, v.id, "2027-04-05T09:00:00Z");
      await accept(TA, booked.id);
      await assert.rejects(
        A.createVehicleBlock({ tenantId: TA, vehicleId: v.id, startDay: "2027-04-04", endDay: "2027-04-06", reason: "maintenance" }),
        (e: { code?: string }) => e.code === "VEHICLE_UNAVAILABLE"
      );
      assert.equal(await prisma.vehicleBlock.count({ where: { vehicleId: v.id } }), 0, "rien de créé en cas de conflit");
      const block = await A.createVehicleBlock({ tenantId: TA, vehicleId: v.id, startDay: "2027-04-07", endDay: "2027-04-09", reason: "repair", note: "freins" });
      assert.deepEqual(await occupied(v.id), ["2027-04-05", "2027-04-07", "2027-04-08", "2027-04-09"]);
      const blockedLead = await seedLead(TA, v.id, "2027-04-08T09:00:00Z");
      await assert.rejects(accept(TA, blockedLead.id), (e: { code?: string; message?: string }) => e.code === "VEHICLE_UNAVAILABLE");
      assert.equal(await A.deleteVehicleBlock(TA, block.id), true);
      await accept(TA, blockedLead.id);
      assert.equal(await A.deleteVehicleBlock(TB, block.id), false, "autre tenant : refusé");
    });

    it("anciennes réservations sans véhicule : acceptées sans occupation, ne bloquent aucun véhicule", async () => {
      const v = await mkVehicle(TA, "Historique");
      const legacy = await seedLead(TA, null, "2027-05-20T09:00:00Z");
      await accept(TA, legacy.id);
      assert.deepEqual(await occupied(v.id), []);
      assert.equal(await prisma.vehicleDayOccupation.count({ where: { leadId: legacy.id } }), 0);
      const next = await seedLead(TA, v.id, "2027-05-20T09:00:00Z");
      await accept(TA, next.id);
    });

    it("véhicule attribué mais date introuvable : l'acceptation est refusée explicitement", async () => {
      const v = await mkVehicle(TA, "Sans date");
      const l = await prisma.leadRequest.create({
        data: { tenantId: TA, kind: "devis", status: "pending", clientName: "x", clientPhone: "0", clientEmail: "x@x.test", rawPayload: {}, flatPayload: {}, vehicleId: v.id },
      });
      await assert.rejects(accept(TA, l.id), (e: { code?: string }) => e.code === "VEHICLE_SCHEDULE_MISSING");
    });

    it("disponibilité publique : véhicule réservé indiqué indisponible à cette date", async () => {
      const v = await mkVehicle(TA, "Dispo publique");
      await accept(TA, (await seedLead(TA, v.id, "2027-07-14T09:00:00Z")).id);
      const occ = await A.getOccupiedVehicleIds(TA, [v.id], ["2027-07-14", "2027-07-15"]);
      assert.equal(occ.get(v.id)!.length, 1);
      const none = await A.getOccupiedVehicleIds(TB, [v.id], ["2027-07-14"]);
      assert.equal(none.size, 0, "occupations d'un autre tenant invisibles");
    });
  });

  // -------------------------------------------------------------------------
  describe("changement de véhicule / de date", () => {
    it("change de véhicule : libère l'ancien, prend le nouveau, recalcule le supplément côté serveur", async () => {
      const a = await mkVehicle(TA, "Chg A");
      const b = await mkVehicle(TA, "Chg B", { surchargeMode: "per_km", surchargeValue: 0.5 });
      const lead = await seedLead(TA, a.id, "2027-08-01T09:00:00Z");
      await accept(TA, lead.id);
      const out = await L.changeLeadVehicle({ tenantId: TA, leadId: lead.id, vehicleId: b.id, actorUserId: UA });
      assert.equal(out.priceBefore, 140);
      assert.equal(out.priceAfter, 180, "140 + 80 km × 0,50 €");
      assert.deepEqual(await occupied(a.id), []);
      assert.deepEqual(await occupied(b.id), ["2027-08-01"]);
      const row = (await prisma.leadRequest.findUnique({ where: { id: lead.id } }))!;
      assert.equal(row.vehicleId, b.id);
      assert.equal((row.flatPayload as Record<string, string>).TarifTotal, "180.00");
      assert.equal(stripePay.resolveLeadTotalAmountCents(row), 18000);
      assert.equal(await prisma.leadVehicleChange.count({ where: { leadId: lead.id } }), 1);
    });

    it("changement vers un véhicule déjà pris : refusé, l'ancien reste attribué et occupé", async () => {
      const a = await mkVehicle(TA, "Chg conflit A");
      const b = await mkVehicle(TA, "Chg conflit B");
      const l1 = await seedLead(TA, a.id, "2027-08-10T09:00:00Z");
      const l2 = await seedLead(TA, b.id, "2027-08-10T14:00:00Z");
      await accept(TA, l1.id);
      await accept(TA, l2.id);
      await assert.rejects(L.changeLeadVehicle({ tenantId: TA, leadId: l1.id, vehicleId: b.id }), (e: { code?: string }) => e.code === "VEHICLE_UNAVAILABLE");
      assert.equal((await prisma.leadRequest.findUnique({ where: { id: l1.id } }))!.vehicleId, a.id);
      assert.deepEqual(await occupied(a.id), ["2027-08-10"]);
    });

    it("prix verrouillé quand un paiement est ouvert/encaissé et que le prix changerait", async () => {
      const a = await mkVehicle(TA, "Lock A");
      const b = await mkVehicle(TA, "Lock B", { surchargeMode: "fixed", surchargeValue: 50 });
      const same = await mkVehicle(TA, "Lock C");
      const lead = await seedLead(TA, a.id, "2027-08-20T09:00:00Z");
      await accept(TA, lead.id);
      await prisma.payment.create({
        data: {
          tenantId: TA, leadRequestId: lead.id, status: "PAID", mode: "FULL", amount: 14000, currency: "eur",
          applicationFeeAmount: 500, stripeAccountId: "acct_x",
        },
      });
      await assert.rejects(L.changeLeadVehicle({ tenantId: TA, leadId: lead.id, vehicleId: b.id }), (e: { code?: string }) => e.code === "PRICE_LOCKED");
      const ok = await L.changeLeadVehicle({ tenantId: TA, leadId: lead.id, vehicleId: same.id });
      assert.equal(ok.priceAfter, 140, "même prix : autorisé, paiement inchangé");
    });

    it("véhicule d'un autre tenant ou trop petit : refusé", async () => {
      const foreign = await mkVehicle(TB, "Étranger");
      const small = await mkVehicle(TA, "Trop petit", { passengerMax: 1 });
      const lead = await seedLead(TA, null, "2027-09-01T09:00:00Z");
      await assert.rejects(L.changeLeadVehicle({ tenantId: TA, leadId: lead.id, vehicleId: foreign.id }), (e: { code?: string }) => e.code === "VEHICLE_NOT_FOUND");
      await assert.rejects(L.changeLeadVehicle({ tenantId: TA, leadId: lead.id, vehicleId: small.id }), (e: { code?: string }) => e.code === "VEHICLE_CAPACITY");
    });

    it("changement de date : nouveaux jours pris, anciens libérés ; conflit → rien ne change", async () => {
      const v = await mkVehicle(TA, "Resched");
      const l1 = await seedLead(TA, v.id, "2027-10-01T09:00:00Z");
      const l2 = await seedLead(TA, v.id, "2027-10-05T09:00:00Z");
      await accept(TA, l1.id);
      await accept(TA, l2.id);
      await L.rescheduleLead({ tenantId: TA, leadId: l1.id, scheduledStart: new Date("2027-10-03T09:00:00Z"), scheduledEnd: new Date("2027-10-03T11:00:00Z") });
      assert.deepEqual(await occupied(v.id), ["2027-10-03", "2027-10-05"]);
      await assert.rejects(
        L.rescheduleLead({ tenantId: TA, leadId: l1.id, scheduledStart: new Date("2027-10-05T09:00:00Z") }),
        (e: { code?: string }) => e.code === "VEHICLE_UNAVAILABLE"
      );
      assert.deepEqual(await occupied(v.id), ["2027-10-03", "2027-10-05"]);
      assert.equal((await prisma.leadRequest.findUnique({ where: { id: l1.id } }))!.scheduledStart!.toISOString(), "2027-10-03T09:00:00.000Z");
    });
  });

  // -------------------------------------------------------------------------
  describe("parcours complet : calcul → devis → acceptation → paiement (distances simulées)", () => {
    const HA = "default";
    const HB = "client-demo";
    const UH2 = "itest_user_flow";
    const realFetch = globalThis.fetch;
    let v0: { id: string };
    let vFixed: { id: string };
    let vKm: { id: string };
    let vPct: { id: string };
    let vSmall: { id: string };
    let vOff: { id: string };

    const auth = () => ({
      authorization: `Bearer ${tokens.signAccessToken({ sub: UH2, tenantId: HA, email: "op@flow.test", role: "admin" })}`,
      "x-tenant-id": HA,
      "content-type": "application/json",
    });
    const post = async (route: string, body: unknown, tenant = HA) => {
      const res = await fetch(`${base}/api/${route}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-tenant-id": tenant },
        body: JSON.stringify(body),
      });
      return { status: res.status, json: (await res.json()) as Record<string, any> };
    };
    const trip = (extra: Record<string, unknown> = {}, date = "15/11/2027", pax = "2") => ({
      vtcBaseAddress: "Dépôt test, 76000 Rouen, France",
      client: { nom: "Dupont", prenom: "Jean", telephone: "0600000000", email: "jean@example.test", organisation: "Particulier" },
      general: { TypeService: "Trajet Classique", TypeTrajet: "Aller Simple" },
      trajetClassique: {
        TCtrajet: "Aller Simple",
        TCpassagers: pax,
        TCallerpriseencharge: "1 rue test, 76300 Bihorel, France",
        TCallerDestination: "5 avenue test, 76000 Rouen, France",
        TCallerdate: date,
        TCallerheure: "10:00",
        TCbagagesaller: "0",
        TCbagagesretour: "0",
      },
      ...extra,
    });

    before(async () => {
      // Service de distance simulé : 10 km entre deux adresses distinctes (aucun appel réseau réel).
      globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
        const url = String(typeof input === "object" && input && "url" in (input as Request) ? (input as Request).url : input);
        if (url.includes("api.distancematrix.ai")) {
          const u = new URL(url);
          const origins = (u.searchParams.get("origins") ?? "").split("|");
          const dests = (u.searchParams.get("destinations") ?? "").split("|");
          const rows = origins.map((o) => ({
            elements: dests.map((d) => ({ status: "OK", distance: { value: o === d ? 0 : 10000 }, duration: { value: o === d ? 0 : 900 } })),
          }));
          return new Response(JSON.stringify({ status: "OK", rows }), { status: 200 });
        }
        return realFetch(input as RequestInfo, init);
      }) as typeof fetch;

      for (const id of [HA, HB]) {
        await prisma.tenant.upsert({ where: { id }, update: {}, create: { id, name: id, slug: `itest-${id}` } });
        await prisma.vehicle.deleteMany({ where: { tenantId: id } });
      }
      await prisma.operatorUser.deleteMany({ where: { id: UH2 } });
      await prisma.operatorUser.create({ data: { id: UH2, tenantId: HA, email: "op@flow.test", passwordHash: "x", role: "admin" } });
      v0 = await mkVehicle(HA, "Standard", { passengerMax: 4 });
      vFixed = await mkVehicle(HA, "Classe V", { passengerMax: 7, surchargeMode: "fixed", surchargeValue: 50 });
      vKm = await mkVehicle(HA, "Tesla", { passengerMax: 4, surchargeMode: "per_km", surchargeValue: 0.5 });
      vPct = await mkVehicle(HA, "BMW", { passengerMax: 4, surchargeMode: "percent_km", surchargeValue: 20 });
      vSmall = await mkVehicle(HA, "Smart", { passengerMax: 2 });
      vOff = await mkVehicle(HA, "Hors service", { passengerMax: 4, active: false });
    });
    after(async () => {
      globalThis.fetch = realFetch;
      for (const id of [HA, HB]) {
        await prisma.leadRequest.deleteMany({ where: { tenantId: id, clientEmail: { endsWith: "@example.test" } } });
        await prisma.vehicle.deleteMany({ where: { tenantId: id } });
      }
      await prisma.operatorUser.deleteMany({ where: { id: UH2 } });
    });

    it("calcule le même tarif de base ; chaque mode ajoute exactement son supplément", async () => {
      const base = await post("calculer-tarif", trip({ vehicleId: v0.id }));
      assert.equal(base.status, 200, JSON.stringify(base.json));
      const baseTarif = base.json.data.tarif as number;
      assert.ok(baseTarif > 0);
      assert.equal(base.json.data.vehicle.surcharge.amount, 0);

      const fixed = await post("calculer-tarif", trip({ vehicleId: vFixed.id }));
      assert.equal(fixed.json.data.tarifBase, baseTarif, "tarif métier inchangé");
      assert.equal(fixed.json.data.tarif, baseTarif + 50);
      assert.equal(fixed.json.data.vehicle.surcharge.amount, 50);

      const km = await post("calculer-tarif", trip({ vehicleId: vKm.id }));
      const billableKm = km.json.data.vehicleBasis.billableKm as number;
      assert.ok(billableKm >= 10);
      assert.equal(km.json.data.tarif, baseTarif + Math.ceil(billableKm * 0.5 - 1e-9));

      const pct = await post("calculer-tarif", trip({ vehicleId: vPct.id }));
      const kmAmount = pct.json.data.vehicleBasis.kmAmount as number;
      assert.equal(pct.json.data.tarif, baseTarif + Math.ceil(Math.round(kmAmount * 0.2 * 100) / 100 - 1e-9));
    });

    it("le navigateur ne peut pas imposer le prix : champs tarifaires parasites ignorés", async () => {
      const clean = await post("calculer-tarif", trip({ vehicleId: vFixed.id }));
      const tampered = await post(
        "calculer-tarif",
        trip({ vehicleId: vFixed.id, vehicleSurcharge: 0, vehiclePercent: -100, vehicleFinalPrice: 1, tarif: 1, surchargeValue: -50, surchargeMode: "none" })
      );
      assert.equal(tampered.status, 200);
      assert.equal(tampered.json.data.tarif, clean.json.data.tarif);
      assert.equal(tampered.json.data.vehicle.surcharge.amount, 50);
    });

    it("refuse : véhicule absent, inconnu, d'un autre tenant, désactivé, trop petit", async () => {
      const none = await post("calculer-tarif", trip());
      assert.equal(none.status, 400);
      assert.equal(none.json.error.code, "VEHICLE_REQUIRED");
      assert.equal((await post("calculer-tarif", trip({ vehicleId: "veh_inexistant" }))).json.error.code, "VEHICLE_NOT_FOUND");
      const foreign = await mkVehicle(HB, "Étranger HB");
      assert.equal((await post("calculer-tarif", trip({ vehicleId: foreign.id }), HA)).json.error.code, "VEHICLE_NOT_FOUND");
      assert.equal((await post("calculer-tarif", trip({ vehicleId: vOff.id }))).json.error.code, "VEHICLE_INACTIVE");
      const small = await post("calculer-tarif", trip({ vehicleId: vSmall.id }, "15/11/2027", "3"));
      assert.equal(small.status, 422);
      assert.equal(small.json.error.code, "VEHICLE_CAPACITY");
    });

    it("devis → acceptation → blocage ; prix identique partout ; 2e acceptation refusée ; paiement = total", async () => {
      const date = "20/12/2027";
      const quote = await post("calculer-tarif", trip({ vehicleId: vFixed.id }, date));
      const total = quote.json.data.tarif as number;

      const d1 = await post("devis", trip({ vehicleId: vFixed.id }, date));
      assert.equal(d1.status, 200, JSON.stringify(d1.json));
      assert.equal(d1.json.data.tarif, total, "devis = calculateur");
      const d2 = await post("devis", trip({ vehicleId: vFixed.id }, date));
      assert.equal(d2.status, 200, "un devis simplement demandé ne bloque pas le véhicule");

      const lead1 = (await prisma.leadRequest.findUnique({ where: { id: d1.json.data.devisId } }))!;
      assert.equal(lead1.vehicleId, vFixed.id);
      assert.equal((lead1.pricingResult as { tarif: number }).tarif, total);
      assert.equal(Number((lead1.flatPayload as Record<string, string>).TarifTotal), total);
      assert.equal(Number((lead1.flatPayload as Record<string, string>).SupplementVehicule), 50);
      assert.equal((lead1.flatPayload as Record<string, string>).Vehicule, "Classe V");
      assert.equal((lead1.vehicleSnapshot as { name: string }).name, "Classe V");
      assert.equal(stripePay.resolveLeadTotalAmountCents(lead1), Math.round(total * 100), "Stripe demande le total, supplément inclus");

      const acc1 = await fetch(`${base}/api/requests/${lead1.id}/status`, { method: "PATCH", headers: auth(), body: JSON.stringify({ status: "accepted" }) });
      assert.equal(acc1.status, 200);
      assert.deepEqual(await occupied(vFixed.id), ["2027-12-20"]);

      const acc2 = await fetch(`${base}/api/requests/${d2.json.data.devisId}/status`, { method: "PATCH", headers: auth(), body: JSON.stringify({ status: "accepted" }) });
      assert.equal(acc2.status, 409);
      assert.equal(((await acc2.json()) as Record<string, any>).error.code, "VEHICLE_UNAVAILABLE");

      // nouvelle demande pour ce véhicule ce jour-là : refusée dès la création, autre véhicule accepté
      const d3 = await post("devis", trip({ vehicleId: vFixed.id }, date));
      assert.equal(d3.status, 409);
      assert.equal(d3.json.error.code, "VEHICLE_UNAVAILABLE");
      const d4 = await post("devis", trip({ vehicleId: v0.id }, date));
      assert.equal(d4.status, 200);

      // disponibilité publique
      const av = await fetch(`${base}/api/public/vehicle-availability?date=2027-12-20&passengers=2`, { headers: { "x-tenant-id": HA } });
      const avj = (await av.json()) as { data: Array<{ id: string; available: boolean }> };
      assert.equal(avj.data.find((v) => v.id === vFixed.id)!.available, false);
      assert.equal(avj.data.find((v) => v.id === v0.id)!.available, true);
    });

    it("réservation directe : même contrôles, même prix", async () => {
      const date = "05/01/2028";
      const quote = await post("calculer-tarif", trip({ vehicleId: vKm.id }, date));
      const r = await post("reservation", trip({ vehicleId: vKm.id }, date));
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.equal(r.json.data.tarif, quote.json.data.tarif);
      const lead = (await prisma.leadRequest.findUnique({ where: { id: r.json.data.reservationId } }))!;
      assert.equal(lead.kind, "reservation");
      assert.equal(lead.status, "pending");
      assert.equal(lead.vehicleId, vKm.id);
    });
  });

  // -------------------------------------------------------------------------
  describe("API HTTP", () => {
    // La résolution du tenant par en-tête n'accepte que les tenants du registre (default, client-demo).
    const HA = "default";
    const HB = "client-demo";
    const UH = "itest_user_http";
    before(async () => {
      for (const id of [HA, HB]) {
        await prisma.tenant.upsert({ where: { id }, update: {}, create: { id, name: id, slug: `itest-${id}` } });
        await prisma.vehicle.deleteMany({ where: { tenantId: id } });
      }
      await prisma.operatorUser.deleteMany({ where: { id: UH } });
      await prisma.operatorUser.create({ data: { id: UH, tenantId: HA, email: "op@http.test", passwordHash: "x", role: "admin" } });
    });
    after(async () => {
      for (const id of [HA, HB]) {
        await prisma.leadRequest.deleteMany({ where: { tenantId: id, clientEmail: { endsWith: "@example.test" } } });
        await prisma.vehicle.deleteMany({ where: { tenantId: id } });
      }
      await prisma.operatorUser.deleteMany({ where: { id: UH } });
    });
    const auth = (tenantId: string) => ({
      authorization: `Bearer ${tokens.signAccessToken({ sub: UH, tenantId, email: "op@a.test", role: "admin" })}`,
      "x-tenant-id": tenantId,
    });
    const call = async (method: string, url: string, tenantId: string | null, body?: unknown, extra: Record<string, string> = {}) => {
      const res = await fetch(base + url, {
        method,
        headers: {
          ...(tenantId ? auth(tenantId) : {}),
          ...(body && !(body instanceof FormData) ? { "content-type": "application/json" } : {}),
          ...extra,
        },
        body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let json: Record<string, any> = {};
      try { json = JSON.parse(text); } catch { /* binaire */ }
      return { status: res.status, json, headers: res.headers };
    };

    it("exige l'authentification et refuse un jeton d'un autre tenant", async () => {
      assert.equal((await call("GET", "/api/pro/vehicles", null, undefined, { "x-tenant-id": HA })).status, 401);
      const cross = await fetch(base + "/api/pro/vehicles", {
        headers: { authorization: auth(HB).authorization, "x-tenant-id": HA },
      });
      assert.equal(cross.status, 403);
    });

    it("CRUD véhicule + upload multipart + service du fichier /media", async () => {
      const created = await call("POST", "/api/pro/vehicles", HA, {
        name: "Tesla HTTP", passengerMax: 4, surchargeMode: "per_km", surchargeValue: 0.3, licensePlate: "ZZ-999-ZZ", active: true,
      });
      assert.equal(created.status, 200, JSON.stringify(created.json));
      const id = created.json.data.id as string;
      assert.equal(created.json.data.surchargeDescription, "Ce véhicule ajoute 0,3 € pour chaque kilomètre facturable.");

      const fd = new FormData();
      fd.append("file", new Blob([new Uint8Array(await png())], { type: "image/png" }), "../../evil name.png");
      const up = await call("POST", `/api/pro/vehicles/${id}/photos`, HA, fd);
      assert.equal(up.status, 200, JSON.stringify(up.json));
      const url = up.json.data.photos[0].url as string;
      assert.match(url, new RegExp(`^/media/vehicles/${HA}/`));
      const img = await fetch(base + url);
      assert.equal(img.status, 200);
      assert.equal(img.headers.get("content-type"), "image/webp");
      assert.equal(img.headers.get("x-content-type-options"), "nosniff");

      const bad = new FormData();
      bad.append("file", new Blob(["pas une image"], { type: "image/jpeg" }), "x.jpg");
      assert.equal((await call("POST", `/api/pro/vehicles/${id}/photos`, HA, bad)).status, 415);

      assert.equal((await call("GET", `/api/pro/vehicles/${id}`, HB)).status, 404, "tenant B ne le voit pas");
      assert.equal((await call("PATCH", `/api/pro/vehicles/${id}`, HB, { name: "x" })).status, 404);

      const invalid = await call("PATCH", `/api/pro/vehicles/${id}`, HA, { surchargeMode: "percent_km", surchargeValue: 150 });
      assert.equal(invalid.status, 400);

      const pub = await call("GET", "/api/public/vehicles", null, undefined, { "x-tenant-id": HA });
      assert.equal(pub.status, 200);
      assert.ok(!JSON.stringify(pub.json).includes("ZZ-999-ZZ"));
      assert.ok(pub.json.data.some((v: { id: string }) => v.id === id));
      const pubB = await call("GET", "/api/public/vehicles", null, undefined, { "x-tenant-id": HB });
      assert.ok(!JSON.stringify(pubB.json).includes(id));
    });

    it("le navigateur ne peut pas imposer de prix : seul vehicleId est accepté pour changer de véhicule", async () => {
      const v = await mkVehicle(HA, "HTTP changement");
      const lead = await seedLead(HA, null, "2027-11-01T09:00:00Z");
      const hacked = await call("PATCH", `/api/pro/demandes/${lead.id}/vehicle`, HA, {
        vehicleId: v.id, vehicleSurcharge: 0, vehiclePercent: -100, vehicleFinalPrice: 1,
      });
      assert.equal(hacked.status, 400);
      const fine = await call("PATCH", `/api/pro/demandes/${lead.id}/vehicle`, HA, { vehicleId: v.id });
      assert.equal(fine.status, 200, JSON.stringify(fine.json));
      assert.equal((await prisma.leadRequest.findUnique({ where: { id: lead.id } }))!.vehicleId, v.id);
      assert.equal((await call("PATCH", `/api/pro/demandes/${lead.id}/vehicle`, HB, { vehicleId: v.id })).status, 404);
    });

    it("acceptation HTTP d'un second devis sur un véhicule pris : 409 avec le message attendu", async () => {
      const v = await mkVehicle(HA, "HTTP 409");
      const l1 = await seedLead(HA, v.id, "2027-11-15T09:00:00Z");
      const l2 = await seedLead(HA, v.id, "2027-11-15T18:00:00Z");
      const ok1 = await call("PATCH", `/api/requests/${l1.id}/status`, HA, { status: "accepted" });
      assert.equal(ok1.status, 200, JSON.stringify(ok1.json));
      const ko = await call("PATCH", `/api/requests/${l2.id}/status`, HA, { status: "accepted" });
      assert.equal(ko.status, 409);
      assert.equal(ko.json.error.code, "VEHICLE_UNAVAILABLE");
      assert.equal(ko.json.error.message, "Ce véhicule est déjà réservé pour cette date. Choisissez un autre véhicule ou proposez une autre date.");
    });
  });
});
