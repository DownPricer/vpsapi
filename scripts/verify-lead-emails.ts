/**
 * Vérification locale du rendu HTML des e-mails leads (sans envoi SMTP).
 * Usage : npx tsx scripts/verify-lead-emails.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { TenantConfig } from "../src/types/tenant";
import { buildCustomerConfirmation, buildOperatorEmail } from "../src/modules/email/formatLeadEmail";

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
  company: { name: "VTC Démonstration" },
  baseAddress: { label: "Base opérationnelle" },
  serviceArea: { description: "Normandie" },
  pricing: {},
  airports: [],
  smtp: { toEmail: "operateur@demo.local", fromEmail: "noreply@demo.local" },
  branding: { siteUrl: "https://www.demo-vtc.fr" },
  pricingEngine: {} as TenantConfig["pricingEngine"],
} as TenantConfig;

/** Simule le spread réel + champs techniques qui ne doivent jamais apparaître dans le HTML. */
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
    Commentaires: "Bonjour, je souhaite un renseignement sur vos tarifs aéroport.",
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
    RésuméTrajet: "Le Havre → Rouen — Aller Simple",
    DateAller: "2026-05-02",
    HeureAller: "09:30",
    DateRetour: "N/A",
    HeureRetour: "N/A",
    AdresseDepart_1: "Le Havre, Gare routière",
    AdresseArrivee_1: "Rouen, centre-ville",
    AdresseDepart_2: "N/A",
    AdresseArrivee_2: "N/A",
    NombrePassagers: "2",
    BagagesAller: "2",
    BagagesRetour: "0",
    Commentaires: "Merci de prévoir une bouteille d'eau.",
    TarifTotal: "156.50",
    Statut: "pending",
    Payé: "Non",
    PaymentMethode: "N/A",
    LeadId: LEAD_DEVIS,
    TypeDemande: "devis",
    Options: "Siège enfant",
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
    TypeService: "Transfert Aéroport",
    TypeTrajet: "Aller Simple",
    RésuméTrajet: "Caen → CDG",
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
    Payé: "Non",
    PaymentMethode: "N/A",
    LeadId: LEAD_RES,
    TypeDemande: "reservation",
    Options: "aucun extra sélectionné",
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
  const m = html.match(
    /<a\s+[^>]*href="([^"]+)"[^>]*>\s*Voir la demande\s*<\/a>/i
  );
  return m?.[1] ?? null;
}

/** Mots techniques anglais à éviter dans le corps visible (hors « contact » / « devis » français). */
const ENGLISH_LEAK = /\b(null|undefined|pending)\b/i;

function assertNoForbiddenNoise(html: string, label: string): void {
  const lower = html.toLowerCase();
  if (lower.includes(">n/a<") || lower.includes("n/a</td>")) {
    throw new Error(`[${label}] Chaîne N/A visible dans le HTML`);
  }
  if (lower.includes(">null<") || lower.includes("undefined")) {
    throw new Error(`[${label}] null / undefined visible dans le HTML`);
  }
  const plain = stripTags(html);
  if (ENGLISH_LEAK.test(plain)) {
    const hit = plain.match(ENGLISH_LEAK);
    throw new Error(`[${label}] Mot anglais suspect dans le texte visible : ${hit?.[0]}`);
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
    {
      name: "contact",
      kind: "contact",
      flat: flatContact(),
      subjectPrefix: "",
    },
    {
      name: "devis",
      kind: "devis",
      flat: flatDevis(),
      subjectPrefix: "[DEVIS] ",
      customer: {
        type: "devis",
        lines: [
          `Référence : ${LEAD_DEVIS}`,
          `Tarif estimé : 156.5 €`,
          `Service : Trajet Classique`,
          `Trajet : Le Havre → Rouen`,
        ],
      },
    },
    {
      name: "reservation",
      kind: "reservation",
      flat: flatReservation(),
      subjectPrefix: "[RÉSERVATION] ",
      customer: {
        type: "reservation",
        lines: [
          `Référence : ${LEAD_RES}`,
          `Tarif : 189 €`,
          `Paiement : Non — N/A`,
          `Trajet : Caen → CDG`,
        ],
      },
    },
  ];

  console.log("=== Vérification e-mails leads ===\n");

  for (const c of cases) {
    const op = buildOperatorEmail({
      tenant: mockTenant,
      type: c.kind,
      subjectPrefix: c.subjectPrefix,
      flat: c.flat,
    });

    const expectedHref = `${DASHBOARD_BASE}/pro/demandes/${
      c.kind === "contact" ? LEAD_CONTACT : c.kind === "devis" ? LEAD_DEVIS : LEAD_RES
    }`;
    const href = extractPrimaryCtaHref(op.html);
    if (href !== expectedHref) {
      throw new Error(
        `[${c.name}] Bouton CTA : attendu ${expectedHref}, obtenu ${href}`
      );
    }

    assertNoForbiddenNoise(op.html, `${c.name} opérateur`);

    fs.writeFileSync(path.join(OUT_DIR, `${c.name}-operateur.html`), op.html, "utf8");
    fs.writeFileSync(path.join(OUT_DIR, `${c.name}-operateur.txt`), op.text, "utf8");

    console.log(`✓ ${c.name} — opérateur OK`);
    console.log(`  Sujet : ${op.subject}`);
    console.log(`  CTA href : ${href}`);

    if (c.customer) {
      const cust = buildCustomerConfirmation({
        tenant: mockTenant,
        type: c.customer.type,
        recipientName: "Prénom Nom",
        summaryLines: c.customer.lines,
      });
      assertNoForbiddenNoise(cust.html, `${c.name} client`);
      const plain = stripTags(cust.html);
      if (plain.includes("Paiement") && plain.includes("N/A")) {
        throw new Error(`[${c.name} client] Ligne paiement N/A encore présente`);
      }
      fs.writeFileSync(path.join(OUT_DIR, `${c.name}-client.html`), cust.html, "utf8");
      console.log(`✓ ${c.name} — client OK (${cust.subject})`);
    }
    console.log("");
  }

  console.log(`Fichiers HTML écrits dans : ${OUT_DIR}`);
  console.log("Toutes les assertions ont réussi.");
}

main();
