/**
 * Simule une sauvegarde admin (GET settings → PUT identique en UTF-8).
 */
import { collectEncodingCorruptionPaths } from "../utils/tenantSettingsEncoding";

const API = (process.env.RESTORE_API_URL ?? "https://api.sitereadyshd.fr").replace(/\/$/, "");
const TENANT = process.env.RESTORE_TENANT_ID ?? "default";
const EMAIL = process.env.RESTORE_EMAIL ?? "admin@sitereadyshd.fr";
const PASSWORD = process.env.RESTORE_PASSWORD ?? "AdminTest2026!";

async function main(): Promise<void> {
  const h: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "X-Tenant-ID": TENANT,
  };
  const login = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  }).then((r) => r.json());
  const token = (login as { data: { accessToken: string } }).data.accessToken;
  const auth = { ...h, Authorization: `Bearer ${token}` };

  const cur = await fetch(`${API}/api/pro/settings`, { headers: auth }).then((r) => r.json());
  const settings = (cur as { data: { settings: Record<string, unknown> } }).data.settings;

  const putRes = await fetch(`${API}/api/pro/settings`, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ settings }),
  });
  const putJson = (await putRes.json()) as { error?: { message?: string } };
  console.log("PUT", putRes.status, putRes.ok ? "OK" : putJson.error?.message ?? "FAIL");

  const pub = await fetch(`${API}/api/public/tenant-settings`, {
    headers: { "X-Tenant-ID": TENANT },
  }).then((r) => r.json());
  const s = (pub as { data: { settings: Record<string, unknown> } }).data.settings;
  const general = s.general as Record<string, string>;
  const home = s.home as Record<string, Record<string, string>>;
  const faq = s.faq as { items: { answer: string }[] };
  const pricing = s.pricing as { classicTrip: { approachPricePerKm: number } };

  console.log("tagline:", general.tagline);
  console.log("driver:", home.aboutPreview.driverDisplayName);
  console.log("faq[0]:", faq.items[0].answer.slice(0, 55));
  console.log("approachPricePerKm:", pricing.classicTrip.approachPricePerKm);
  console.log("corrupted fields:", collectEncodingCorruptionPaths(s).length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
