import type { TenantConfig } from "../../types/tenant";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function rowsHtml(data: Record<string, string>): string {
  return Object.entries(data)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 10px;border:1px solid #e5e5e5;font-weight:600;background:#f8f8f8">${esc(k)}</td><td style="padding:6px 10px;border:1px solid #e5e5e5">${esc(v)}</td></tr>`
    )
    .join("");
}

function rowsText(data: Record<string, string>): string {
  return Object.entries(data)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

function publicSiteUrl(tenant: TenantConfig): string {
  return (
    tenant.branding?.siteUrl?.trim() ||
    process.env.PUBLIC_SITE_URL?.trim() ||
    "https://localhost"
  );
}

function brandName(tenant: TenantConfig): string {
  return tenant.company.name.trim();
}

export function buildOperatorEmail(opts: {
  tenant: TenantConfig;
  type: "contact" | "devis" | "reservation";
  subjectPrefix: string;
  flat: Record<string, string>;
}): { subject: string; html: string; text: string } {
  const site = publicSiteUrl(opts.tenant);
  const brand = brandName(opts.tenant);
  const title =
    opts.type === "contact"
      ? "Nouvelle demande de contact"
      : opts.type === "devis"
        ? "Nouvelle demande de devis"
        : "Nouvelle réservation";
  const subject = `${opts.subjectPrefix}${title} — ${brand}`;
  const dashboardLink = opts.flat.DashboardLink && opts.flat.DashboardLink !== "N/A" ? opts.flat.DashboardLink : "";
  const text = `${title}\nSite: ${site}\n\n${rowsText(opts.flat)}\n`;
  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;font-size:14px;color:#111">
  <p><strong>${esc(title)}</strong><br/>${esc(brand)} — <a href="${esc(site)}">${esc(site)}</a></p>
  ${dashboardLink ? `<p style="margin:12px 0 16px"><a href="${esc(dashboardLink)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px;font-weight:600">Voir la demande</a></p>` : ""}
  <table style="border-collapse:collapse;width:100%;max-width:720px">${rowsHtml(opts.flat)}</table>
  </body></html>`;
  return { subject, html, text };
}

export function buildCustomerConfirmation(opts: {
  tenant: TenantConfig;
  type: "devis" | "reservation";
  recipientName: string;
  summaryLines: string[];
}): { subject: string; html: string; text: string } {
  const brand = brandName(opts.tenant);
  const site = publicSiteUrl(opts.tenant);
  const subject =
    opts.type === "devis"
      ? `${brand} — Accusé de réception de votre demande de devis`
      : `${brand} — Accusé de réception de votre réservation`;
  const bodyText = `Bonjour ${opts.recipientName},\n\nNous avons bien reçu votre ${opts.type === "devis" ? "demande de devis" : "demande de réservation"}.\nNotre équipe vous recontacte rapidement.\n\n${opts.summaryLines.join("\n")}\n\n— ${brand}\n${site}`;
  const linesHtml = opts.summaryLines.map((l) => `<li>${esc(l)}</li>`).join("");
  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;font-size:14px;color:#111">
  <p>Bonjour ${esc(opts.recipientName)},</p>
  <p>Nous avons bien reçu votre <strong>${opts.type === "devis" ? "demande de devis" : "demande de réservation"}</strong>.</p>
  <ul>${linesHtml}</ul>
  <p>— ${esc(brand)}<br/><a href="${esc(site)}">${esc(site)}</a></p>
  </body></html>`;
  return { subject, html, text: bodyText };
}
