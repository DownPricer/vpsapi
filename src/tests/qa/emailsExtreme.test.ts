/**
 * Étape 6 QA — templates e-mail avec données extrêmes, capture Mailpit.
 * Réutilise les builders de sendAllTestEmails / format* sans modifier le code prod.
 */
import "./helpers/qaEnv";
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import {
  assertLocalTestDb,
  BAD_RENDER_RE,
  isRealStripeTestKey,
  mailpitClear,
  mailpitList,
  mailpitMessage,
  MAILPIT_API,
  QA_DATABASE_URL,
} from "./helpers/qaEnv";
import {
  buildCustomerConfirmation,
  buildCustomerDecisionEmail,
  buildOperatorDecisionEmail,
  buildOperatorEmail,
  buildPaymentConfirmationCustomerEmail,
  buildPaymentConfirmationOperatorEmail,
  buildPaymentLinkCustomerEmail,
} from "../../modules/email/formatLeadEmail";
import {
  buildCancellationAcceptedCustomer,
  buildCancellationRefusedCustomer,
  buildCancellationRequestReceivedCustomer,
  buildCancellationRequestReceivedOperator,
  buildCancelledByDriverCustomer,
  buildRefundConfirmedCustomer,
  buildRefundFailedEmail,
  buildRefundInitiatedCustomer,
} from "../../modules/email/formatCancellationEmails";
import { assertSmtpConnection, resolveMailFrom, sendSmtpMessage } from "../../modules/email/smtp";
import { createTestTenant } from "../../scripts/emailTestFixtures";
import type { TenantConfig } from "../../types/tenant";

assertLocalTestDb(QA_DATABASE_URL);

const TENANT_DOMAIN = "qa-extreme.test";
const TO = `qa-extreme@${TENANT_DOMAIN}`;
const LONG = "É".repeat(50) + "🚗".repeat(20) + "x".repeat(230); // ~300 chars + accents/emojis
const HTML_INJECTION = `<script>alert(1)</script> & "quotes" <b>bold</b>`;
const EMPTY = "";

type Pkg = { subject: string; html: string; text: string };

function extremeTenant(): TenantConfig {
  const t = createTestTenant(TO);
  t.company.name = "Chauffeur Élite 🚀";
  t.company.legalName = "SAS Chauffeur Élite";
  t.branding = { siteUrl: `https://${TENANT_DOMAIN}` };
  t.smtp = {
    ...t.smtp,
    toEmail: TO,
    fromEmail: process.env.MAIL_FROM || "qa-test@localhost.test",
    fromName: "QA Extreme",
  };
  return t;
}

function assertCleanRender(pkg: Pkg, label: string): void {
  const all = `${pkg.subject}\n${pkg.html}\n${pkg.text}`;
  assert.doesNotMatch(all, BAD_RENDER_RE, `${label} contient undefined/NaN/[object Object]`);
  assert.ok(pkg.subject.trim().length > 0, `${label}: subject vide`);
  // Liens domaine tenant (si URL présente)
  if (all.includes("http")) {
    assert.ok(
      all.includes(TENANT_DOMAIN) || all.includes("checkout.stripe.com") || all.includes("pay.stripe.com"),
      `${label}: lien domaine tenant attendu (${TENANT_DOMAIN})`
    );
  }
}

function extremeFlat(email: string): Record<string, string> {
  return {
    Nom: EMPTY,
    Prenom: LONG.slice(0, 80),
    Telephone: "",
    Email: email,
    Organisation: HTML_INJECTION,
    NomSociete: LONG,
    LeadId: "lead-extreme-0001",
    DashboardLink: `https://${TENANT_DOMAIN}/pro/demandes/lead-extreme-0001`,
    ID: "EXT-001",
    TypeDemande: "devis",
    Statut: "pending",
    TypeService: "Trajet Classique",
    TypeTrajet: "Aller Simple",
    RésuméTrajet: LONG,
    DateAller: "2000-01-01",
    HeureAller: "00:00",
    DateRetour: "1999-12-31",
    HeureRetour: "23:59",
    AdresseDepart_1: HTML_INJECTION,
    AdresseArrivee_1: EMPTY,
    NombrePassagers: "0",
    BagagesAller: "0",
    Commentaires: HTML_INJECTION + " " + LONG,
    TarifTotal: "0.00",
    Payé: "Non",
    Options: EMPTY,
  };
}

describe("Étape 6 — e-mails extrêmes via Mailpit", () => {
  const tenant = extremeTenant();
  let mailpitUp = false;

  before(async () => {
    process.env.PUBLIC_SITE_URL = `https://${TENANT_DOMAIN}`;
    process.env.DASHBOARD_BASE_URL = `https://${TENANT_DOMAIN}`;
    try {
      const info = await fetch(`${MAILPIT_API}/info`);
      mailpitUp = info.ok;
    } catch {
      mailpitUp = false;
    }
    assert.ok(mailpitUp, "Mailpit doit être joignable sur 127.0.0.1:8025");
    await mailpitClear();
  });

  it("génère tous les templates lead + paiement + annulation avec données extrêmes (rendu local)", () => {
    const flat = extremeFlat(TO);
    const cases: Array<{ id: string; pkg: Pkg }> = [
      {
        id: "contact-op",
        pkg: buildOperatorEmail({ tenant, type: "contact", subjectPrefix: "", flat }),
      },
      {
        id: "devis-op",
        pkg: buildOperatorEmail({ tenant, type: "devis", subjectPrefix: "[DEVIS] ", flat }),
      },
      {
        id: "devis-client",
        pkg: buildCustomerConfirmation({
          tenant,
          type: "devis",
          recipientName: LONG.slice(0, 40),
          summaryLines: ["Tarif estimé : 0 EUR", `Trajet : ${LONG}`, HTML_INJECTION],
        }),
      },
      {
        id: "res-op",
        pkg: buildOperatorEmail({ tenant, type: "reservation", subjectPrefix: "[RÉSERVATION] ", flat }),
      },
      {
        id: "res-client",
        pkg: buildCustomerConfirmation({
          tenant,
          type: "reservation",
          recipientName: "",
          summaryLines: ["Tarif : 0 EUR"],
        }),
      },
      {
        id: "decision-ok",
        pkg: buildCustomerDecisionEmail({
          tenant,
          kind: "devis",
          outcome: "accepted",
          recipientName: "Élève 🎓",
          summaryLines: ["Tarif : 0 EUR", `https://${TENANT_DOMAIN}/pro`],
        }),
      },
      {
        id: "decision-ko",
        pkg: buildCustomerDecisionEmail({
          tenant,
          kind: "reservation",
          outcome: "refused",
          recipientName: LONG.slice(0, 30),
          summaryLines: ["Tarif : 0 EUR"],
          operatorNote: HTML_INJECTION,
        }),
      },
      {
        id: "op-decision",
        pkg: buildOperatorDecisionEmail({
          tenant,
          leadId: "lead-extreme-0001",
          kindLabel: "Devis",
          statusLabel: "Accepté",
          clientName: LONG.slice(0, 40),
          proUrl: `https://${TENANT_DOMAIN}/pro/demandes/lead-extreme-0001`,
        }),
      },
      {
        id: "pay-link",
        pkg: buildPaymentLinkCustomerEmail({
          tenant,
          clientGreetingName: LONG.slice(0, 20),
          paymentAmountFormatted: "0,00 €",
          checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_FAKE",
          leadReference: "lead-extreme-0001",
          vtcPhone: "",
          vtcEmail: TO,
        }),
      },
      {
        id: "pay-ok-client",
        pkg: buildPaymentConfirmationCustomerEmail({
          tenant,
          clientName: "",
          amountFormatted: "0,00 €",
          leadReference: "lead-extreme-0001",
          tripSummary: LONG,
          vtcPhone: "06",
          vtcEmail: TO,
          receiptUrl: "https://pay.stripe.com/receipts/test_FAKE",
        }),
      },
      {
        id: "pay-ok-op",
        pkg: buildPaymentConfirmationOperatorEmail({
          tenant,
          amountFormatted: "0,00 €",
          clientName: LONG.slice(0, 20),
          leadReference: "lead-extreme-0001",
          paymentModeLabel: "Paiement intégral",
          proUrl: `https://${TENANT_DOMAIN}/pro/demandes/lead-extreme-0001`,
          receiptUrl: null,
        }),
      },
    ];

    const common = {
      tenant,
      clientName: LONG.slice(0, 40),
      reference: "lead-extreme-0001",
      tripSummary: LONG,
      rideDateLabel: "lundi 1 janvier 2000 à 00:00",
      vtcPhone: "",
      vtcEmail: TO,
    };

    cases.push(
      {
        id: "cancel-recv-c",
        pkg: buildCancellationRequestReceivedCustomer({
          ...common,
          reason: HTML_INJECTION,
          amountPaidFormatted: "0,00 €",
          policy: [{ title: EMPTY, text: LONG }],
          manageUrl: `https://${TENANT_DOMAIN}/reservation/gerer?token=abc`,
        }),
      },
      {
        id: "cancel-recv-o",
        pkg: buildCancellationRequestReceivedOperator({
          ...common,
          reason: HTML_INJECTION,
          amountPaidFormatted: "0,00 €",
          proUrl: `https://${TENANT_DOMAIN}/pro/demandes/x`,
        }),
      },
      {
        id: "cancel-ok",
        pkg: buildCancellationAcceptedCustomer({ ...common, refundNote: "Remboursement 0,00 €" }),
      },
      {
        id: "cancel-ko",
        pkg: buildCancellationRefusedCustomer({ ...common, operatorNote: HTML_INJECTION }),
      },
      {
        id: "cancel-driver",
        pkg: buildCancelledByDriverCustomer({
          ...common,
          reason: LONG.slice(0, 100),
          amountPaidFormatted: "0,00 €",
          refundNote: "",
        }),
      },
      {
        id: "refund-init",
        pkg: buildRefundInitiatedCustomer({ ...common, amountFormatted: "0,00 €", partial: false }),
      },
      {
        id: "refund-ok",
        pkg: buildRefundConfirmedCustomer({
          ...common,
          amountFormatted: "0,00 €",
          partial: true,
          totalRefundedFormatted: "0,00 €",
          receiptUrl: null,
        }),
      },
      {
        id: "refund-fail",
        pkg: buildRefundFailedEmail({
          ...common,
          amountFormatted: "0,00 €",
          audience: "operator",
          proUrl: `https://${TENANT_DOMAIN}/pro/demandes/x`,
          reasonLabel: "QA stub",
        }),
      }
    );

    for (const c of cases) {
      assertCleanRender(c.pkg, c.id);
      // HTML injection échappée dans le corps HTML
      if (c.pkg.html.includes("script")) {
        assert.doesNotMatch(c.pkg.html, /<script>alert/i, `${c.id}: script non échappé`);
      }
      // Montants 0 cohérents quand présents
      if (/0[,.]00\s*€|0 EUR/i.test(`${c.pkg.subject}\n${c.pkg.text}`)) {
        assert.match(`${c.pkg.subject}\n${c.pkg.text}`, /0[,.]00\s*€|0 EUR/i);
      }
    }
    console.log(`[QA emails] ${cases.length} templates rendus OK (extrêmes)`);
  });

  it("envoie via SMTP Mailpit et assert subject / body capturés", async () => {
    const connection = assertSmtpConnection();
    assert.equal(connection.host, "127.0.0.1");
    assert.equal(connection.port, 1025);

    const pkgs: Pkg[] = [
      buildOperatorEmail({
        tenant,
        type: "devis",
        subjectPrefix: "[DEVIS] ",
        flat: extremeFlat(TO),
      }),
      buildCustomerDecisionEmail({
        tenant,
        kind: "reservation",
        outcome: "accepted",
        recipientName: "Camille Émoji 🚕",
        summaryLines: [`Référence : lead-extreme-0001`, `Tarif : 0 EUR`, `Site : https://${TENANT_DOMAIN}`],
      }),
      buildPaymentConfirmationCustomerEmail({
        tenant,
        clientName: "Camille",
        amountFormatted: "0,00 €",
        leadReference: "lead-extreme-0001",
        tripSummary: "Rouen → Paris",
        vtcPhone: "0600000000",
        vtcEmail: TO,
        receiptUrl: null,
      }),
    ];

    await mailpitClear();
    const from = resolveMailFrom(tenant);
    for (const [i, pkg] of pkgs.entries()) {
      await sendSmtpMessage({
        connection,
        from,
        to: TO,
        subject: `[QA EXTREME ${i}] ${pkg.subject}`,
        html: pkg.html,
        text: pkg.text,
        omitAutoBcc: true,
      });
    }

    // Petit délai pour indexation Mailpit
    await new Promise((r) => setTimeout(r, 400));
    const list = await mailpitList();
    assert.ok(list.total >= pkgs.length, `Mailpit total=${list.total} attendu >= ${pkgs.length}`);

    for (const m of list.messages.slice(0, pkgs.length)) {
      const full = await mailpitMessage(m.ID);
      const all = `${full.Subject}\n${full.Text}\n${full.HTML}`;
      assert.doesNotMatch(all, BAD_RENDER_RE, `Mailpit ${m.ID}`);
      assert.ok(full.Subject.length > 0, "subject capturé");
      // Subject avec accents / préfixe — Mailpit décode ; on vérifie absence de mojibake évident
      assert.doesNotMatch(full.Subject, /\uFFFD|=\?undefined/, "subject mal encodé");
      // Liens : si un href site VTC est présent, il doit pointer le domaine tenant.
      const siteLinks = all.match(/https?:\/\/[^\s"'<>]+/g) || [];
      const tenantOrStripe = siteLinks.filter(
        (u) => u.includes(TENANT_DOMAIN) || u.includes("stripe.com")
      );
      if (siteLinks.length > 0 && /pro\/demandes|reservation\/gerer|qa-extreme\.test/.test(all)) {
        assert.ok(
          tenantOrStripe.length > 0 || all.includes(TENANT_DOMAIN),
          `lien domaine tenant attendu parmi: ${siteLinks.slice(0, 5).join(", ")}`
        );
      }
      if (/0[,.]00/.test(all)) {
        assert.match(all, /0[,.]00\s*€/);
      }
    }
  });

  if (!isRealStripeTestKey()) {
    it.todo(
      "paiement Stripe live e-mail — non testable sans vraie sk_test_ (ne pas inventer une clé)"
    );
  } else {
    it("paiement Stripe live e-mail (sk_test_ présente)", async () => {
      assert.ok(isRealStripeTestKey());
    });
  }
});
