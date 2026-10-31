import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizePublicTenantSettings } from "../utils/sanitizePublicTenantSettings";

describe("sanitizePublicTenantSettings — e-mail interne opérateur", () => {
  it("retire operatorExtraRecipientEmail au premier niveau", () => {
    const out = sanitizePublicTenantSettings({
      companyName: "Demo",
      operatorExtraRecipientEmail: "secret@interne.example",
      publicPhone: "0102030405",
    });
    assert.ok(out);
    assert.equal(out.companyName, "Demo");
    assert.equal(out.publicPhone, "0102030405");
    assert.equal("operatorExtraRecipientEmail" in out, false);
    assert.equal(JSON.stringify(out).toLowerCase().includes("secret@interne"), false);
  });

  it("retire operatorExtraRecipientEmail imbriqué sous emails", () => {
    const out = sanitizePublicTenantSettings({
      emails: {
        fromName: "VTC",
        operatorExtraRecipientEmail: "copie@interne.example",
        contactFormTo: "public@example.com",
      },
      branding: { primaryColor: "#000" },
    });
    assert.ok(out);
    const emails = out.emails as Record<string, unknown>;
    assert.equal(emails.fromName, "VTC");
    assert.equal(emails.contactFormTo, "public@example.com");
    assert.equal("operatorExtraRecipientEmail" in emails, false);
    assert.equal(JSON.stringify(out).toLowerCase().includes("copie@interne"), false);
    assert.deepEqual(out.branding, { primaryColor: "#000" });
  });
});
