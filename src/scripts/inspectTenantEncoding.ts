import { collectEncodingCorruptionPaths } from "../utils/tenantSettingsEncoding";

const API = "https://api.sitereadyshd.fr";
const TENANT = "default";

function inspect(label: string, settings: Record<string, unknown> | null): void {
  const general = (settings?.general ?? {}) as Record<string, string>;
  const home = (settings?.home ?? {}) as Record<string, Record<string, string>>;
  const tagline = general.tagline ?? "";
  const driver = home.aboutPreview?.driverDisplayName ?? "";
  const privIdx = tagline.indexOf("priv");
  const slice = tagline.slice(privIdx, privIdx + 6);
  console.log(`${label} tagline slice: "${slice}" codes:`, [...slice].map((c) => c.charCodeAt(0)));
  console.log(`${label} driver:`, driver);
  console.log(`${label} corrupted:`, collectEncodingCorruptionPaths(settings).length);
}

async function main(): Promise<void> {
  const pub = await fetch(`${API}/api/public/tenant-settings`, {
    headers: { "X-Tenant-ID": TENANT },
  }).then((r) => r.json());
  inspect("public", (pub as { data: { settings: Record<string, unknown> } }).data.settings);

  const login = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", "X-Tenant-ID": TENANT },
    body: JSON.stringify({ email: "admin@sitereadyshd.fr", password: "AdminTest2026!" }),
  }).then((r) => r.json());
  const token = (login as { data: { accessToken: string } }).data.accessToken;
  const pro = await fetch(`${API}/api/pro/settings`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Tenant-ID": TENANT,
      Authorization: `Bearer ${token}`,
    },
  }).then((r) => r.json());
  inspect("pro", (pro as { data: { settings: Record<string, unknown> } }).data.settings);
}

main();
