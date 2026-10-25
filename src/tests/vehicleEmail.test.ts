import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LeadRequest } from "@prisma/client";
import { getTenantConfig } from "../config/tenants/registry";
import { buildOperatorEmail } from "../modules/email/formatLeadEmail";
import { buildDecisionSummaryLines } from "../modules/email/customerDecisionMail";
import { vehicleFlatFields, vehicleLabelFromFlat } from "../modules/leads/vehicleLead";
import { buildVehicleSnapshot } from "../modules/pricing/vehicleSurchargeApply";

const tenant = getTenantConfig("default")!;
const baseFlat = {
  LeadId: "clx_demo",
  TypeDemande: "devis",
  Statut: "pending",
  Prenom: "Jean",
  Nom: "Dupont",
  Telephone: "0600000000",
  Email: "jean@example.test",
  TypeService: "Trajet Classique",
  DateAller: "15/11/2026",
  HeureAller: "10:00",
  NombrePassagers: "5",
};

describe("e-mails : véhicule et supplément", () => {
  const snap = buildVehicleSnapshot(
    { id: "veh1", name: "Mercedes Classe V", passengerMax: 7, surchargeMode: "fixed", surchargeValue: 50 },
    140,
    null
  );

  it("l'e-mail opérateur affiche véhicule, tarif du trajet, supplément et total", () => {
    const flat = { ...baseFlat, ...vehicleFlatFields(snap), TarifTotal: "190.00" } as Record<string, string>;
    const mail = buildOperatorEmail({ tenant, type: "devis", subjectPrefix: "Nouveau devis", flat });
    for (const needle of ["Mercedes Classe V", "Supplément véhicule", "Tarif du trajet", "190", "140", "50"]) {
      assert.ok(mail.html.includes(needle), `html contient « ${needle} »`);
      assert.ok(mail.text.includes(needle), `texte contient « ${needle} »`);
    }
  });

  it("sans supplément : le véhicule est affiché, aucune ligne de supplément ni double tarif", () => {
    const none = buildVehicleSnapshot({ id: "veh0", name: "Renault Espace 5", passengerMax: 4, surchargeMode: "none", surchargeValue: 0 }, 100, null);
    const flat = { ...baseFlat, ...vehicleFlatFields(none), TarifTotal: "100.00" } as Record<string, string>;
    const mail = buildOperatorEmail({ tenant, type: "devis", subjectPrefix: "Nouveau devis", flat });
    assert.ok(mail.html.includes("Renault Espace 5"));
    assert.ok(!mail.html.includes("Supplément véhicule"));
    assert.ok(!mail.html.includes("Tarif du trajet"));
  });

  it("anciens e-mails (sans véhicule) : inchangés", () => {
    const mail = buildOperatorEmail({ tenant, type: "devis", subjectPrefix: "Nouveau devis", flat: { ...baseFlat, TarifTotal: "100.00" } });
    assert.ok(!mail.html.includes("Véhicule"));
    assert.equal(vehicleLabelFromFlat({}), "");
    assert.equal(vehicleLabelFromFlat({ Vehicule: "N/A" }), "");
  });

  it("l'accusé de décision cite le véhicule et son supplément", () => {
    const lead = {
      id: "clx_demo",
      flatPayload: { ...baseFlat, ...vehicleFlatFields(snap), RésuméTrajet: "Satillieu → Lyon" },
      pricingResult: { tarif: 190 },
    } as unknown as LeadRequest;
    const lines = buildDecisionSummaryLines(lead);
    assert.ok(lines.some((l) => l.includes("Véhicule : Mercedes Classe V") && l.includes("supplément 50")));
    assert.ok(lines.some((l) => l.includes("Tarif : 190")));
  });
});
