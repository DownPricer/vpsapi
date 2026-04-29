/**
 * Verification locale du rendu HTML des e-mails leads (sans envoi SMTP).
 * Usage : npx tsx scripts/verify-lead-emails.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { TenantConfig } from "../src/types/tenant";
import {
  buildCustomerConfirmation,
  buildCustomerDecisionEmail,
  buildOperatorDecisionEmail,
  buildOperatorEmail,
} from "../src/modules/email/formatLeadEmail";

const OUT_DIR = path.join(__dirname, "..", "email-verify-output");

const DASHBOARD_BASE = "https://dashboard-test.example.org";
const LEAD_CONTACT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const LEAD_DEVIS = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const LEAD_RES = "cccccccc-cccc-cccc-cccc-cccccccccccc";

process.env.DASHBOARD_BASE_URL = DASHBOARD_BASE;
process.env.PUBLIC_SITE_URL = "https://www.demo-vtc.fr";

const mockTenant = {
  id: "demo",
  engineRef: "demo",
  company: { name: "VTC Demonstration" },
  baseAddress: { label: "Base operationnelle" },
  serviceArea: { description: "Normandie" },
  pricing: {},
  airports: [],
  smtp: { toEmail: "operateur@demo.local", fromEmail: "noreply@demo.local" },
  branding: { siteUrl: "https://www.demo-vtc.fr" },
  pricingEngine: {} as TenantConfig["pricingEngine"],
} as TenantConfig;

function flatContact(): Record<string, string> {
  return {
    DetailsMajorations: `[{"leg":"aller","montant":12}]`,
    GoogleCreneaux: "[]",
    Résumé: "json technique interne",
    ID: "CON280426-120000",
    Nom: "Dupont",
    Prenom: "Marie",
    Telephone: "+33 6 12 34 56 78",
    Email: "marie.dupont@email.fr",
    DateEnvoi: "28/04/2026 12:00",
    Etiquette: "CONTACT",
    Statut: "new",
    Commentaires: "Bonjour, je souhaite un renseignement sur vos tarifs aeroport.",
    TarifTotal: "0.00",
    TypeTrajet: "N/A",
    LeadId: LEAD_CONTACT,
    TypeDemande: "contact",
    Societe: "",
    NomSociete: "N/A",
    DashboardLink: `${DASHBOARD_BASE}/pro/demandes/${LEAD_CONTACT}`,
  };
}

function flatDevis(): Record<string, string> {
  return {
    DetailsMajorations: `[{"leg":"aller","montant":15}]`,
    GoogleCalendarUrl: "https://calendar.google.com/calendar/render?fake=1",
    ID: "DEV280426-143022",
    Nom: "Martin",
    Prenom: "Jean",
    Telephone: "0766778899",
    Email: "jean.martin@client.fr",
    Organisation: "Professionnel",
    NomSociete: "Agence LM",
    AdresseSociete: "12 rue du Port, Le Havre",
    TypeService: "Trajet Classique",
    TypeTrajet: "Aller Simple",
    RésuméTrajet: "Le Havre -> Rouen - Aller Simple",
    DateAller: "2026-05-02",
    HeureAller: "09:30",
    DateRetour: "N/A",
    HeureRetour: "N/A",
    AdresseDepart_1: "Le Havre, Gare routiere",
    AdresseArrivee_1: "Rouen, centre-ville",
    AdresseDepart_2: "N/A",
    AdresseArrivee_2: "N/A",
    NombrePassagers: "2",
    BagagesAller: "2",
    BagagesRetour: "0",
    Commentaires: "Merci de prevoir une bouteille d'eau.",
    TarifTotal: "156.50",
    Statut: "pending",
    "Payé": "Non",
    PaymentMethode: "N/A",
    LeadId: LEAD_DEVIS,
    TypeDemande: "devis",
    Options: "Siege enfant",
    DashboardLink: `${DASHBOARD_BASE}/pro/demandes/${LEAD_DEVIS}`,
  };
}

function flatReservation(): Record<string, string> {
  return {
    DistanceApprocheAllerKm: "12.50",
    TarifApprocheAller: "28.00",
    JSON_TECHNIQUE: '{"internal":true}',
    ID: "RES280426-150530",
    Nom: "Bernard",
    Prenom: "Luc",
    Telephone: "0611223344",
    Email: "luc.bernard@mail.fr",
    Organisation: "Particulier",
    NomSociete: "N/A",
    TypeService: "Transfert Aeroport",
    TypeTrajet: "Aller Simple",
    RésuméTrajet: "Caen -> CDG",
    DateAller: "2026-05-10",
    HeureAller: "05:15",
    AdresseDepart_1: "CAEN",
    AdresseArrivee_1: "Paris Roissy CDG",
    AllerNumeroVol: "AF1234",
    AllerHeureVol: "08:40",
    NombrePassagers: "3",
    BagagesAller: "4",
    Commentaires: "",
    Observations: "",
    TarifTotal: "189.00",
    Statut: "pending",
    "Payé": "Non",
    PaymentMethode: "N/A",
    LeadId: LEAD_RES,
    TypeDemande: "reservation",
    Options: "aucun extra selectionne",
    DashboardLink: `${DASHBOARD_BASE}/pro/demandes/${LEAD_RES}`,
  };
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPrimaryCtaHref(html: string): string | null {
  const match = html.match(/<a\s+[^>]*href="([^"]+)"[^>]*>\s*Voir la demande\s*<\/a>/i);
  return match?.[1] ?? null;
}

const ENGLISH_LEAK = /\b(null|undefined|pending)\b/i;

function assertNoForbiddenNoise(html: string, label: string): void {
  const lower = html.toLowerCase();
  if (lower.includes(">n/a<") || lower.includes("n/a</td>")) {
    throw new Error(`[${label}] Chaine N/A visible dans le HTML`);
  }
  if (lower.includes(">null<") || lower.includes("undefined")) {
    throw new Error(`[${label}] null / undefined visible dans le HTML`);
  }
  const plain = stripTags(html);
  if (ENGLISH_LEAK.test(plain)) {
    throw new Error(`[${label}] Mot anglais suspect dans le texte visible`);
  }
}

function main(): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const cases: Array<{
    name: string;
    kind: "contact" | "devis" | "reservation";
    flat: Record<string, string>;
    subjectPrefix: string;
    customer?: { type: "devis" | "reservation"; lines: string[] };
  }> = [
    { name: "contact", kind: "contact", flat: flatContact(), subjectPrefix: "" },
    {
      name: "devis",
      kind: "devis",
      flat: flatDevis(),
      subjectPrefix: "[DEVIS] ",
      customer: {
        type: "devis",
        lines: [
          `Reference : ${LEAD_DEVIS}`,
          "Tarif estime : 156.5 EUR",
          "Service : Trajet Classique",
          "Trajet : Le Havre -> Rouen",
        ],
      },
    },
    {
      name: "reservation",
      kind: "reservation",
      flat: flatReservation(),
      subjectPrefix: "[RESERVATION] ",
      customer: {
        type: "reservation",
        lines: [
          `Reference : ${LEAD_RES}`,
          "Tarif : 189 EUR",
          "Paiement : Non - N/A",
          "Trajet : Caen -> CDG",
        ],
      },
    },
  ];

  console.log("=== Verification e-mails leads ===\n");

  for (const current of cases) {
    const operator = buildOperatorEmail({
      tenant: mockTenant,
      type: current.kind,
      subjectPrefix: current.subjectPrefix,
      flat: current.flat,
    });

    const expectedHref = `${DASHBOARD_BASE}/pro/demandes/${
      current.kind === "contact" ? LEAD_CONTACT : current.kind === "devis" ? LEAD_DEVIS : LEAD_RES
    }`;
    const href = extractPrimaryCtaHref(operator.html);
    if (href !== expectedHref) {
      throw new Error(`[${current.name}] Bouton CTA attendu ${expectedHref}, obtenu ${href}`);
    }

    assertNoForbiddenNoise(operator.html, `${current.name} operateur`);
    fs.writeFileSync(path.join(OUT_DIR, `${current.name}-operateur.html`), operator.html, "utf8");
    fs.writeFileSync(path.join(OUT_DIR, `${current.name}-operateur.txt`), operator.text, "utf8");
    console.log(`OK ${current.name} operateur`);

    if (current.customer) {
      const customer = buildCustomerConfirmation({
        tenant: mockTenant,
        type: current.customer.type,
        recipientName: "Prenom Nom",
        summaryLines: current.customer.lines,
      });
      assertNoForbiddenNoise(customer.html, `${current.name} client`);
      fs.writeFileSync(path.join(OUT_DIR, `${current.name}-client.html`), customer.html, "utf8");
      console.log(`OK ${current.name} client`);
    }
  }

  const decisions = [
    { name: "devis-accepte", kind: "devis" as const, outcome: "accepted" as const },
    { name: "devis-refuse", kind: "devis" as const, outcome: "refused" as const },
    { name: "reservation-acceptee", kind: "reservation" as const, outcome: "accepted" as const },
    { name: "reservation-refusee", kind: "reservation" as const, outcome: "refused" as const },
  ];

  for (const decision of decisions) {
    const customerDecision = buildCustomerDecisionEmail({
      tenant: mockTenant,
      kind: decision.kind,
      outcome: decision.outcome,
      recipientName: "Prenom Nom",
      summaryLines: [
        `Reference : ${decision.kind === "devis" ? LEAD_DEVIS : LEAD_RES}`,
        `Trajet : ${decision.kind === "devis" ? "Le Havre -> Rouen" : "Caen -> CDG"}`,
        decision.outcome === "accepted" ? "Tarif : 189 EUR" : "Tarif : 0.00 EUR",
      ],
      operatorNote: decision.outcome === "refused" ? "Nous ne sommes plus disponibles sur ce creneau." : "",
    });
    assertNoForbiddenNoise(customerDecision.html, `${decision.name} client`);
    fs.writeFileSync(path.join(OUT_DIR, `${decision.name}.html`), customerDecision.html, "utf8");
    console.log(`OK ${decision.name}`);
  }

  const operatorDecision = buildOperatorDecisionEmail({
    tenant: mockTenant,
    leadId: LEAD_DEVIS,
    kindLabel: "Devis",
    statusLabel: "Accepte",
    clientName: "Jean Martin",
    proUrl: `${DASHBOARD_BASE}/pro/demandes/${LEAD_DEVIS}`,
  });
  assertNoForbiddenNoise(operatorDecision.html, "operateur decision");
  fs.writeFileSync(path.join(OUT_DIR, "decision-operateur.html"), operatorDecision.html, "utf8");
  console.log("OK operateur decision");

  console.log(`Fichiers HTML ecrits dans : ${OUT_DIR}`);
}

main();
