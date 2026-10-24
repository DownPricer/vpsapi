import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { getTenantConfig } from "../config/tenants/registry";
import {
  buildCancellationAcceptedCustomer,
  buildCancellationRefusedCustomer,
  buildCancellationRequestReceivedCustomer,
  buildCancellationRequestReceivedOperator,
  buildCancelledByDriverCustomer,
  buildRefundConfirmedCustomer,
  buildRefundFailedEmail,
  buildRefundInitiatedCustomer,
} from "../modules/email/formatCancellationEmails";

const tenant = getTenantConfig("default")!;
const common = {
  tenant,
  clientName: "Marie Dupont",
  reference: "clx9demo000reference",
  tripSummary: "Rouen → Aéroport CDG",
  rideDateLabel: "lundi 2 novembre 2026 à 10:30",
  vtcPhone: "06 00 00 00 00",
  vtcEmail: "contact@example.test",
};

const templates = {
  "01-demande-recue-client": buildCancellationRequestReceivedCustomer({ ...common, reason: "Vol reporté", amountPaidFormatted: "100,00 €", policy: [{ title: "Annulation gratuite", text: "Jusqu'à 1 jour avant le départ." }], manageUrl: "https://vtc.example.test/reservation/gerer?token=abc" }),
  "02-demande-recue-chauffeur": buildCancellationRequestReceivedOperator({ ...common, reason: "Vol reporté", amountPaidFormatted: "100,00 €", proUrl: "https://vtc.example.test/pro/demandes/x" }),
  "03-annulation-acceptee": buildCancellationAcceptedCustomer({ ...common, refundNote: "Un remboursement de 100,00 € est en cours de traitement." }),
  "04-demande-refusee": buildCancellationRefusedCustomer({ ...common, operatorNote: "Course dans moins de 2 h." }),
  "05-annulee-par-chauffeur": buildCancelledByDriverCustomer({ ...common, reason: "Véhicule indisponible", amountPaidFormatted: "100,00 €", refundNote: "Un remboursement de 100,00 € est en cours de traitement." }),
  "06-remboursement-initie": buildRefundInitiatedCustomer({ ...common, amountFormatted: "100,00 €", partial: false }),
  "07-remboursement-confirme": buildRefundConfirmedCustomer({ ...common, amountFormatted: "100,00 €", partial: false, receiptUrl: "https://pay.stripe.com/receipts/x" }),
  "08-remboursement-partiel": buildRefundConfirmedCustomer({ ...common, amountFormatted: "40,00 €", partial: true, totalRefundedFormatted: "40,00 €" }),
  "09-echec-chauffeur": buildRefundFailedEmail({ ...common, amountFormatted: "100,00 €", audience: "operator", proUrl: "https://vtc.example.test/pro/demandes/x", reasonLabel: "Solde du compte Stripe insuffisant" }),
  "10-echec-client": buildRefundFailedEmail({ ...common, amountFormatted: "100,00 €", audience: "customer" }),
};

describe("modèles e-mail annulation / remboursement", () => {
  for (const [name, pkg] of Object.entries(templates)) {
    it(`${name} : entreprise, référence, date, statut, sans donnée sensible`, () => {
      const all = `${pkg.subject}\n${pkg.html}\n${pkg.text}`;
      assert.ok(pkg.subject.length > 5);
      assert.ok(all.includes(tenant.company.name), "nom de l'entreprise VTC");
      assert.ok(pkg.html.includes("clx9demo000reference") || pkg.html.includes("clx9demo…"), "référence réservation (html)");
      assert.ok(pkg.text.includes("clx9demo000reference"), "référence réservation (texte)");
      assert.ok(pkg.text.includes("Date de la course : lundi 2 novembre 2026"), "date de la course");
      assert.match(pkg.text, /Statut : /);
      // Aucun identifiant Stripe interne, numéro de carte ni IBAN.
      assert.doesNotMatch(all, /\b(acct|pi|re|ch|fee|cs|evt)_[A-Za-z0-9]{6,}/);
      assert.doesNotMatch(all, /\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/);
      assert.doesNotMatch(all, /\bFR\d{2}[ ]?\d{4}/i);
      assert.doesNotMatch(all, /<script/i);
    });
  }

  it("les montants concernés apparaissent dans les e-mails de remboursement", () => {
    assert.match(templates["07-remboursement-confirme"].text, /Montant remboursé : 100,00 €/);
    assert.match(templates["08-remboursement-partiel"].text, /Montant remboursé : 40,00 €/);
    assert.match(templates["08-remboursement-partiel"].subject, /partiel/i);
    assert.match(templates["09-echec-chauffeur"].text, /Montant concerné : 100,00 €/);
  });

  it("échappe le HTML des saisies utilisateur (motif client, note chauffeur)", () => {
    const pkg = buildCancellationRequestReceivedOperator({ ...common, reason: "<img src=x onerror=alert(1)>", amountPaidFormatted: null, proUrl: null });
    assert.doesNotMatch(pkg.html, /<img src=x/);
    assert.match(pkg.html, /&lt;img src=x/);
  });

  // Aperçu visuel : EMAIL_PREVIEW_DIR=./email-verify-output npx tsx --test src/tests/emailTemplates.test.ts
  it("écrit les aperçus HTML si EMAIL_PREVIEW_DIR est défini", () => {
    const dir = process.env.EMAIL_PREVIEW_DIR;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    for (const [name, pkg] of Object.entries(templates)) writeFileSync(path.join(dir, `${name}.html`), pkg.html, "utf8");
  });
});
