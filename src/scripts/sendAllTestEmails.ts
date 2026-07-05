/**
 * Envoi de tous les modèles d'e-mails VTC vers une adresse de test (fixtures uniquement).
 *
 * Usage :
 *   TEST_EMAIL_TO="monmail@example.com" npm run test:emails
 *   npm run test:emails -- --to monmail@example.com
 *   npm run test:emails -- --to monmail@example.com --preview-only
 *
 * Contraintes : aucun appel Stripe, aucune écriture en base, aucun vrai client contacté.
 */
import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  buildCustomerConfirmation,
  buildCustomerDecisionEmail,
  buildOperatorDecisionEmail,
  buildOperatorEmail,
  buildPaymentConfirmationCustomerEmail,
  buildPaymentConfirmationOperatorEmail,
  buildPaymentLinkCustomerEmail,
} from "../modules/email/formatLeadEmail";
import { assertSmtpConnection, resolveMailFrom, sendSmtpMessage } from "../modules/email/smtp";
import {
  createTestTenant,
  decisionSummaryLines,
  devisSummaryLines,
  FAKE_CHECKOUT_URL,
  FAKE_RECEIPT_URL,
  flatContact,
  flatDevis,
  flatReservation,
  reservationSummaryLines,
  TEST_AMOUNT_FORMATTED,
  TEST_CLIENT_NAME,
  TEST_DASHBOARD_BASE,
  TEST_LEAD_ID,
  TEST_OPERATOR_NOTE,
  TEST_PUBLIC_SITE,
  TEST_TRIP_SUMMARY,
} from "./emailTestFixtures";
import type { TenantConfig } from "../types/tenant";

const SUBJECT_PREFIX = "[TEST VTC] ";
const PREVIEW_DIR = path.join(process.cwd(), "tmp", "email-previews");

type EmailPackage = { subject: string; html: string; text: string };

type EmailCase = {
  id: string;
  label: string;
  build: (ctx: TestContext) => EmailPackage;
};

type TestContext = {
  tenant: TenantConfig;
  testEmailTo: string;
};

type SendResult = {
  id: string;
  label: string;
  subject: string;
  ok: boolean;
  error?: string;
  previewPath?: string;
  skipped?: boolean;
};

function parseArgs(): { testEmailTo: string; previewOnly: boolean } {
  const args = process.argv.slice(2);
  const previewOnly = args.includes("--preview-only");
  const toIdx = args.indexOf("--to");
  if (toIdx >= 0 && args[toIdx + 1]?.includes("@")) {
    return { testEmailTo: args[toIdx + 1].trim(), previewOnly };
  }
  const positional = args.find((a) => a.includes("@") && !a.startsWith("-"));
  if (positional) {
    return { testEmailTo: positional.trim(), previewOnly };
  }
  const env = process.env.TEST_EMAIL_TO?.trim();
  if (env?.includes("@")) {
    return { testEmailTo: env, previewOnly };
  }
  console.error("Adresse de test requise.");
  console.error("  TEST_EMAIL_TO=\"monmail@example.com\" npm run test:emails");
  console.error("  npm run test:emails -- --to monmail@example.com");
  process.exit(1);
}

function withTestSubject(subject: string): string {
  const trimmed = subject.trim();
  if (trimmed.startsWith(SUBJECT_PREFIX)) return trimmed;
  return `${SUBJECT_PREFIX}${trimmed}`;
}

function buildAllEmailCases(): EmailCase[] {
  return [
    {
      id: "01-contact-operateur",
      label: "Contact — notification opérateur",
      build: ({ tenant, testEmailTo }) =>
        buildOperatorEmail({
          tenant,
          type: "contact",
          subjectPrefix: "",
          flat: flatContact(testEmailTo),
        }),
    },
    {
      id: "02-devis-operateur",
      label: "Devis — notification opérateur",
      build: ({ tenant, testEmailTo }) =>
        buildOperatorEmail({
          tenant,
          type: "devis",
          subjectPrefix: "[DEVIS] ",
          flat: flatDevis(testEmailTo),
        }),
    },
    {
      id: "03-devis-client-confirmation",
      label: "Devis — accusé de réception client",
      build: ({ tenant }) =>
        buildCustomerConfirmation({
          tenant,
          type: "devis",
          recipientName: TEST_CLIENT_NAME,
          summaryLines: devisSummaryLines(),
        }),
    },
    {
      id: "04-reservation-operateur",
      label: "Réservation — notification opérateur",
      build: ({ tenant, testEmailTo }) =>
        buildOperatorEmail({
          tenant,
          type: "reservation",
          subjectPrefix: "[RÉSERVATION] ",
          flat: flatReservation(testEmailTo),
        }),
    },
    {
      id: "05-reservation-client-confirmation",
      label: "Réservation — accusé de réception client",
      build: ({ tenant }) =>
        buildCustomerConfirmation({
          tenant,
          type: "reservation",
          recipientName: TEST_CLIENT_NAME,
          summaryLines: reservationSummaryLines(),
        }),
    },
    {
      id: "06-devis-accepte-client",
      label: "Devis — accepté (client)",
      build: ({ tenant }) =>
        buildCustomerDecisionEmail({
          tenant,
          kind: "devis",
          outcome: "accepted",
          recipientName: TEST_CLIENT_NAME,
          summaryLines: decisionSummaryLines(),
        }),
    },
    {
      id: "07-devis-refuse-client",
      label: "Devis — refusé (client)",
      build: ({ tenant }) =>
        buildCustomerDecisionEmail({
          tenant,
          kind: "devis",
          outcome: "refused",
          recipientName: TEST_CLIENT_NAME,
          summaryLines: decisionSummaryLines(),
          operatorNote: TEST_OPERATOR_NOTE,
        }),
    },
    {
      id: "08-reservation-acceptee-client",
      label: "Réservation — acceptée (client)",
      build: ({ tenant }) =>
        buildCustomerDecisionEmail({
          tenant,
          kind: "reservation",
          outcome: "accepted",
          recipientName: TEST_CLIENT_NAME,
          summaryLines: decisionSummaryLines(),
        }),
    },
    {
      id: "09-reservation-refusee-client",
      label: "Réservation — refusée (client)",
      build: ({ tenant }) =>
        buildCustomerDecisionEmail({
          tenant,
          kind: "reservation",
          outcome: "refused",
          recipientName: TEST_CLIENT_NAME,
          summaryLines: decisionSummaryLines(),
          operatorNote: TEST_OPERATOR_NOTE,
        }),
    },
    {
      id: "10-decision-operateur-acceptee",
      label: "Décision pro — acceptée (opérateur)",
      build: ({ tenant }) =>
        buildOperatorDecisionEmail({
          tenant,
          leadId: TEST_LEAD_ID,
          kindLabel: "Devis",
          statusLabel: "Accepté",
          clientName: TEST_CLIENT_NAME,
          proUrl: `${TEST_DASHBOARD_BASE}/pro/demandes/${TEST_LEAD_ID}?preview=TEST`,
        }),
    },
    {
      id: "11-decision-operateur-refusee",
      label: "Décision pro — refusée (opérateur)",
      build: ({ tenant }) =>
        buildOperatorDecisionEmail({
          tenant,
          leadId: TEST_LEAD_ID,
          kindLabel: "Réservation",
          statusLabel: "Refusé",
          clientName: TEST_CLIENT_NAME,
          proUrl: `${TEST_DASHBOARD_BASE}/pro/demandes/${TEST_LEAD_ID}?preview=TEST`,
        }),
    },
    {
      id: "12-paiement-lien-client",
      label: "Paiement — lien Checkout (client)",
      build: ({ tenant, testEmailTo }) =>
        buildPaymentLinkCustomerEmail({
          tenant,
          clientGreetingName: TEST_CLIENT_NAME,
          paymentAmountFormatted: TEST_AMOUNT_FORMATTED,
          checkoutUrl: FAKE_CHECKOUT_URL,
          leadReference: TEST_LEAD_ID,
          vtcPhone: "0600000000",
          vtcEmail: testEmailTo,
        }),
    },
    {
      id: "13-paiement-confirme-client",
      label: "Paiement — confirmé (client)",
      build: ({ tenant, testEmailTo }) =>
        buildPaymentConfirmationCustomerEmail({
          tenant,
          clientName: TEST_CLIENT_NAME,
          amountFormatted: TEST_AMOUNT_FORMATTED,
          leadReference: TEST_LEAD_ID,
          tripSummary: TEST_TRIP_SUMMARY,
          vtcPhone: "0600000000",
          vtcEmail: testEmailTo,
          receiptUrl: FAKE_RECEIPT_URL,
        }),
    },
    {
      id: "14-paiement-confirme-operateur",
      label: "Paiement — confirmé (opérateur)",
      build: ({ tenant }) =>
        buildPaymentConfirmationOperatorEmail({
          tenant,
          amountFormatted: TEST_AMOUNT_FORMATTED,
          clientName: TEST_CLIENT_NAME,
          leadReference: TEST_LEAD_ID,
          paymentModeLabel: "Paiement intégral",
          proUrl: `${TEST_DASHBOARD_BASE}/pro/demandes/${TEST_LEAD_ID}?preview=TEST`,
          receiptUrl: FAKE_RECEIPT_URL,
        }),
    },
  ];
}

function savePreview(id: string, html: string, text: string): string {
  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
  const htmlPath = path.join(PREVIEW_DIR, `${id}.html`);
  const txtPath = path.join(PREVIEW_DIR, `${id}.txt`);
  fs.writeFileSync(htmlPath, html, "utf8");
  fs.writeFileSync(txtPath, text, "utf8");
  return htmlPath;
}

async function sendTestEmail(
  ctx: TestContext,
  pkg: EmailPackage,
  previewOnly: boolean
): Promise<void> {
  if (previewOnly) return;

  const connection = assertSmtpConnection();
  const from = resolveMailFrom(ctx.tenant);

  await sendSmtpMessage({
    connection,
    from,
    to: ctx.testEmailTo,
    subject: withTestSubject(pkg.subject),
    html: pkg.html,
    text: pkg.text,
    omitAutoBcc: true,
  });
}

async function main(): Promise<void> {
  const { testEmailTo, previewOnly } = parseArgs();

  process.env.PUBLIC_SITE_URL = TEST_PUBLIC_SITE;
  process.env.DASHBOARD_BASE_URL = TEST_DASHBOARD_BASE;

  const tenant = createTestTenant(testEmailTo);
  const ctx: TestContext = { tenant, testEmailTo };
  const cases = buildAllEmailCases();
  const results: SendResult[] = [];

  console.log("=== Test e-mails VTC (fixtures) ===\n");
  console.log(`Destinataire : ${testEmailTo}`);
  console.log(`Mode         : ${previewOnly ? "aperçu HTML uniquement" : "envoi SMTP + aperçu HTML"}`);
  console.log(`Entreprise   : ${tenant.company.name}`);
  console.log(`Aperçus      : ${PREVIEW_DIR}\n`);

  for (const emailCase of cases) {
    let subjectSent = "";
    try {
      const pkg = emailCase.build(ctx);
      subjectSent = withTestSubject(pkg.subject);
      const previewPath = savePreview(emailCase.id, pkg.html, pkg.text);
      await sendTestEmail(ctx, pkg, previewOnly);

      results.push({
        id: emailCase.id,
        label: emailCase.label,
        subject: subjectSent,
        ok: true,
        previewPath,
      });
      console.log(`OK  ${emailCase.label}`);
      console.log(`    sujet : ${subjectSent}`);
      console.log(`    fichier : ${previewPath}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        id: emailCase.id,
        label: emailCase.label,
        subject: subjectSent || emailCase.label,
        ok: false,
        error: message,
      });
      console.log(`KO  ${emailCase.label}`);
      if (subjectSent) console.log(`    sujet : ${subjectSent}`);
      console.log(`    erreur : ${message}\n`);
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  const koCount = results.filter((r) => !r.ok).length;

  console.log("=== Résumé ===");
  console.log(`Total  : ${results.length}`);
  console.log(`OK     : ${okCount}`);
  console.log(`KO     : ${koCount}`);

  const missingTemplates = [
    "Paiement échoué (template absent du code)",
    "Paiement expiré (template absent du code)",
  ];
  console.log("\nTemplates non trouvés dans le projet (non envoyés) :");
  for (const note of missingTemplates) {
    console.log(`  - ${note}`);
  }

  if (koCount > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
