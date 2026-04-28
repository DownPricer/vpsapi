import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import type { TenantConfig } from "../../types/tenant";

export type SmtpConnection = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
};

function parseBool(v: string | undefined, defaultFalse: boolean): boolean {
  if (v == null || v === "") return defaultFalse;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function isDevMode(): boolean {
  return process.env.NODE_ENV === "development";
}

function redactEmail(value: string | undefined): string {
  if (!value) return "(empty)";
  const at = value.indexOf("@");
  if (at <= 0) return "***";
  const domain = value.slice(at + 1) || "unknown";
  return `***@${domain}`;
}

/** Paramètres de connexion SMTP (serveur partagé, variables d’environnement). */
export function getSmtpConnectionFromEnv(): SmtpConnection | null {
  const host = process.env.SMTP_HOST?.trim();
  const portRaw = process.env.SMTP_PORT?.trim();
  if (!host || !portRaw) return null;

  const port = Number(portRaw);
  if (!Number.isFinite(port)) return null;

  const user = process.env.SMTP_USER?.trim() || "";
  const pass = process.env.SMTP_PASS?.trim() || "";
  const secure = parseBool(process.env.SMTP_SECURE, port === 465);

  return { host, port, secure, user, pass };
}

export function assertSmtpConnection(): SmtpConnection {
  const c = getSmtpConnectionFromEnv();
  if (!c) {
    throw new Error(
      "Configuration SMTP incomplète : définir SMTP_HOST et SMTP_PORT (et SMTP_USER / SMTP_PASS si authentification requise)."
    );
  }
  return c;
}

/** Expéditeur : variable globale ou, à défaut, `tenant.smtp.fromEmail`. */
export function resolveMailFrom(tenant: TenantConfig): string {
  const from = process.env.MAIL_FROM?.trim() || tenant.smtp.fromEmail?.trim();
  if (!from) {
    throw new Error(
      "Expéditeur manquant : définir MAIL_FROM ou smtp.fromEmail pour le locataire."
    );
  }
  return from;
}

export async function sendSmtpMessage(options: {
  connection: SmtpConnection;
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  bcc?: string;
  omitAutoBcc?: boolean;
}): Promise<void> {
  const { connection, from, to, subject, text, html, replyTo, bcc, omitAutoBcc } = options;
  const tlsRejectUnauthorized = parseBool(
    process.env.SMTP_TLS_REJECT_UNAUTHORIZED,
    true
  );

  const transporter = nodemailer.createTransport({
    host: connection.host,
    port: connection.port,
    secure: connection.secure,
    auth:
      connection.user || connection.pass
        ? { user: connection.user, pass: connection.pass }
        : undefined,
    tls: {
      rejectUnauthorized: tlsRejectUnauthorized,
      servername: connection.host,
    },
  });

  const envReply = process.env.MAIL_REPLY_TO?.trim();
  const envCopy = process.env.MAIL_TO_COPY?.trim();

  if (isDevMode()) {
    console.info(
      `[vtc-core-api][mail][dev] smtp connect start host=${connection.host} port=${connection.port} secure=${connection.secure} auth=${connection.user ? "yes" : "no"} tlsRejectUnauthorized=${tlsRejectUnauthorized}`
    );
  }

  try {
    await transporter.verify();
    if (isDevMode()) {
      console.info("[vtc-core-api][mail][dev] smtp connect ok (connection/auth)");
    }
  } catch (error) {
    if (isDevMode()) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[vtc-core-api][mail][dev] smtp connect failed: ${message}`);
    }
    throw error;
  }

  const mail: Mail.Options = {
    from,
    to,
    subject,
    text,
    html,
    replyTo: replyTo ?? envReply,
    bcc: omitAutoBcc ? bcc : bcc || envCopy,
  };
  if (isDevMode()) {
    console.info(
      `[vtc-core-api][mail][dev] smtp send start from=${redactEmail(from)} to=${redactEmail(
        to
      )} replyTo=${redactEmail(String(mail.replyTo || ""))} hasBcc=${mail.bcc ? "yes" : "no"} subjectLen=${
        subject.length
      }`
    );
  }

  try {
    const info = await transporter.sendMail(mail);
    if (isDevMode()) {
      const accepted = Array.isArray(info.accepted) ? info.accepted.length : 0;
      const rejected = Array.isArray(info.rejected) ? info.rejected.length : 0;
      const response = typeof info.response === "string" ? info.response : "";
      console.info(
        `[vtc-core-api][mail][dev] smtp send ok accepted=${accepted} rejected=${rejected} response=${response}`
      );
    }
  } catch (error) {
    if (isDevMode()) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[vtc-core-api][mail][dev] smtp send failed: ${message}`);
    }
    throw error;
  }
}


