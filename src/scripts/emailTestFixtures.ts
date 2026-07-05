import type { TenantConfig } from "../types/tenant";

/** Identifiant fictif — aucune entité en base. */
export const TEST_LEAD_ID = "test-lead-00000000-0000-0000-0000-000000000001";

export const FAKE_CHECKOUT_URL =
  "https://checkout.stripe.com/c/pay/cs_test_FAKE_DO_NOT_USE?prefilled_email=test%40example.com";

export const FAKE_RECEIPT_URL =
  "https://pay.stripe.com/receipts/test_FAKE_DO_NOT_USE?session_id=cs_test_FAKE";

export const TEST_PUBLIC_SITE = "https://test-vtc.example.com";

export const TEST_DASHBOARD_BASE = "https://test-vtc.example.com";

export const TEST_AMOUNT_CENTS = 38_100;

export const TEST_AMOUNT_FORMATTED = "381,00 €";

export const TEST_TRIP_SUMMARY =
  "55 Le Petit Mayard, 07290 Satillieu → Lyon Part-Dieu — Aller simple";

export const TEST_CLIENT_NAME = "Jean Test";

export const TEST_CLIENT_PHONE = "0600000000";

export const TEST_VEHICLE = "Renault Espace 5 Initiale Paris";

export const TEST_OPERATOR_NOTE =
  "Désolé, nous ne sommes pas disponibles sur ce créneau. Merci de votre compréhension.";

export function createTestTenant(testEmailTo: string): TenantConfig {
  return {
    id: "test-email-fixture",
    engineRef: "test",
    company: {
      name: "Exemple cool",
      legalName: "Exemple cool VTC",
    },
    baseAddress: {
      label: "55 Le Petit Mayard, 07290 Satillieu",
      city: "Satillieu",
      postalCode: "07290",
      country: "France",
    },
    serviceArea: {
      description: "Rhône-Alpes — zone de test [TEST VTC]",
    },
    pricing: {},
    airports: [],
    smtp: {
      toEmail: testEmailTo,
      fromEmail: process.env.MAIL_FROM?.trim() || "noreply@test-vtc.example.com",
      fromName: "Votre équipe VTC",
      sendCustomerConfirmation: true,
    },
    branding: {
      siteUrl: TEST_PUBLIC_SITE,
    },
    pricingEngine: {} as TenantConfig["pricingEngine"],
  };
}

function dashboardLink(): string {
  return `${TEST_DASHBOARD_BASE}/pro/demandes/${TEST_LEAD_ID}?preview=TEST`;
}

function sharedClientFields(email: string): Record<string, string> {
  return {
    Nom: "Test",
    Prenom: "Jean",
    Telephone: TEST_CLIENT_PHONE,
    Email: email,
    Organisation: "Particulier",
    NomSociete: "Exemple cool",
    LeadId: TEST_LEAD_ID,
    DashboardLink: dashboardLink(),
  };
}

export function flatContact(email: string): Record<string, string> {
  return {
    ...sharedClientFields(email),
    ID: "CON-TEST-001",
    TypeDemande: "contact",
    Statut: "new",
    DateEnvoi: "05/07/2026 14:30",
    Etiquette: "CONTACT",
    Commentaires:
      "Bonjour, je souhaiterais des renseignements sur vos tarifs — merci de me rappeler rapidement.",
    TarifTotal: "0.00",
    TypeTrajet: "N/A",
    Societe: "",
  };
}

export function flatDevis(email: string): Record<string, string> {
  return {
    ...sharedClientFields(email),
    ID: "DEV-TEST-001",
    TypeDemande: "devis",
    Statut: "pending",
    TypeService: "Trajet Classique",
    TypeTrajet: "Aller Simple",
    RésuméTrajet: TEST_TRIP_SUMMARY,
    DateAller: "2026-07-15",
    HeureAller: "14:30",
    DateRetour: "N/A",
    HeureRetour: "N/A",
    AdresseDepart_1: "55 Le Petit Mayard, 07290 Satillieu",
    AdresseArrivee_1: "Lyon Part-Dieu",
    AdresseDepart_2: "N/A",
    AdresseArrivee_2: "N/A",
    NombrePassagers: "2",
    BagagesAller: "2",
    BagagesRetour: "0",
    Commentaires: "Merci de prévoir un siège enfant — c'est très important !",
    TarifTotal: "381.00",
    Payé: "Non",
    PaymentMethode: "N/A",
    Options: TEST_VEHICLE,
  };
}

export function flatReservation(email: string): Record<string, string> {
  return {
    ...sharedClientFields(email),
    ID: "RES-TEST-001",
    TypeDemande: "reservation",
    Statut: "pending",
    TypeService: "Trajet Classique",
    TypeTrajet: "Aller Simple",
    RésuméTrajet: TEST_TRIP_SUMMARY,
    DateAller: "2026-07-15",
    HeureAller: "14:30",
    AdresseDepart_1: "55 Le Petit Mayard, 07290 Satillieu",
    AdresseArrivee_1: "Lyon Part-Dieu",
    NombrePassagers: "2",
    BagagesAller: "2",
    Commentaires: "Réservation test — véhicule : " + TEST_VEHICLE,
    Observations: "",
    TarifTotal: "381.00",
    Payé: "Non",
    PaymentMethode: "N/A",
    Options: TEST_VEHICLE,
  };
}

export function devisSummaryLines(): string[] {
  return [
    `Référence : ${TEST_LEAD_ID}`,
    "Tarif estimé : 381 EUR",
    "Service : Trajet Classique",
    `Trajet : ${TEST_TRIP_SUMMARY}`,
    `Véhicule : ${TEST_VEHICLE}`,
  ];
}

export function reservationSummaryLines(): string[] {
  return [
    `Référence : ${TEST_LEAD_ID}`,
    "Tarif : 381 EUR",
    "Paiement : Non",
    `Trajet : ${TEST_TRIP_SUMMARY}`,
    `Véhicule : ${TEST_VEHICLE}`,
  ];
}

export function decisionSummaryLines(): string[] {
  return [
    `Référence : ${TEST_LEAD_ID}`,
    `Trajet : ${TEST_TRIP_SUMMARY}`,
    "Tarif : 381 EUR",
  ];
}
