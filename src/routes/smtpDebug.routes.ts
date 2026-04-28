import { Router } from "express";
import {
  assertSmtpConnection,
  resolveMailFrom,
  sendSmtpMessage,
} from "../modules/email/smtp";

export const smtpDebugRoutes = Router();

/**
 * Route temporaire de diagnostic SMTP (dev local uniquement).
 * Permet de tester connexion/auth/envoi sans passer par les flux métier.
 */
smtpDebugRoutes.post("/smtp-test", async (req, res, next) => {
  if (process.env.NODE_ENV !== "development") {
    return res.status(404).json({ error: "Not found" });
  }

  try {
    const tenant = req.tenant;
    const connection = assertSmtpConnection();
    const from = resolveMailFrom(tenant);
    const fallbackTo = tenant.smtp.toEmail?.trim();
    const bodyTo = typeof req.body?.to === "string" ? req.body.to.trim() : "";
    const to = bodyTo || fallbackTo;

    if (!to) {
      throw new Error("Aucun destinataire SMTP : fournir body.to ou tenant.smtp.toEmail.");
    }

    const now = new Date().toISOString();
    await sendSmtpMessage({
      connection,
      from,
      to,
      subject: `[SMTP TEST] ${tenant.id} ${now}`,
      text: `Test SMTP direct API centrale\nTenant: ${tenant.id}\nTimestamp: ${now}`,
      html: `<p>Test SMTP direct API centrale</p><p>Tenant: ${tenant.id}</p><p>Timestamp: ${now}</p>`,
      omitAutoBcc: true,
    });

    return res.json({
      ok: true,
      step: "send_success",
      tenantId: tenant.id,
      target: to,
    });
  } catch (error) {
    return next(error);
  }
});
