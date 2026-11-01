/**
 * Bootstrap d'environnement QA (DB test localhost, Mailpit, Distance Matrix stub, Stripe).
 * À importer en premier dans chaque fichier de suite QA.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const ENV_TEST = path.join(ROOT, ".env.test");

function loadEnvTestFile(): void {
  if (!existsSync(ENV_TEST)) return;
  for (const line of readFileSync(ENV_TEST, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env) || process.env[key] === "") {
      process.env[key] = val;
    }
  }
}

loadEnvTestFile();

/** Force DB test — jamais la prod. */
const TEST_DB =
  process.env.TEST_DATABASE_URL?.trim() ||
  "postgresql://postgres:postgres@127.0.0.1:5433/vtc_qa_test?schema=public";

process.env.DATABASE_URL = TEST_DB;
process.env.TEST_DATABASE_URL = TEST_DB;
process.env.NODE_ENV = process.env.NODE_ENV || "test";

/** SMTP → Mailpit uniquement. */
process.env.SMTP_HOST = "127.0.0.1";
process.env.SMTP_PORT = "1025";
process.env.SMTP_SECURE = "false";
process.env.SMTP_USER = process.env.SMTP_USER ?? "";
process.env.SMTP_PASS = process.env.SMTP_PASS ?? "";
process.env.MAIL_FROM = process.env.MAIL_FROM || "qa-test@localhost.test";
process.env.SMTP_TLS_REJECT_UNAUTHORIZED = "0";

process.env.DISTANCE_MATRIX_API_KEY =
  process.env.DISTANCE_MATRIX_API_KEY || "test-key-distance-stubbed";

process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET || "qa-test-access-secret-min-32-chars-xx";
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || "qa-test-refresh-secret-min-32-chars-x";

export const QA_DATABASE_URL = TEST_DB;
export const MAILPIT_API = process.env.MAILPIT_API || "http://127.0.0.1:8025/api/v1";

/** Vrai sk_test_ utilisable (pas placeholder). */
export function isRealStripeTestKey(key = process.env.STRIPE_SECRET_KEY): boolean {
  const k = (key || "").trim();
  if (!/^sk_test_[A-Za-z0-9]{16,}$/.test(k)) return false;
  if (/REPLACE|dummy|xxx|your_|example|placeholder|not_used/i.test(k)) return false;
  return true;
}

export function assertLocalTestDb(url = process.env.DATABASE_URL): void {
  const u = (url || "").toLowerCase();
  if (!/127\.0\.0\.1|localhost/.test(u)) {
    throw new Error(`QA refuse une DB non-locale : ${url}`);
  }
  if (/5432\/|production|prod/.test(u) && !u.includes("vtc_qa_test") && !u.includes(":5433")) {
    throw new Error(`QA refuse une DB suspecte (prod?) : ${url}`);
  }
}

export type DistanceStubMode = "ok" | "fail";

/** Stub Distance Matrix via globalThis.fetch (aucun appel réseau réel). */
export function installDistanceMatrixStub(mode: DistanceStubMode = "ok"): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(
      typeof input === "object" && input && "url" in (input as Request)
        ? (input as Request).url
        : input
    );
    if (url.includes("api.distancematrix.ai")) {
      if (mode === "fail") {
        return new Response(JSON.stringify({ status: "REQUEST_DENIED", error_message: "QA stub fail" }), {
          status: 200,
        });
      }
      const u = new URL(url);
      const origins = decodeURIComponent(u.searchParams.get("origins") ?? "").split("|");
      const dests = decodeURIComponent(u.searchParams.get("destinations") ?? "").split("|");
      const rows = origins.map((o) => ({
        elements: dests.map((d) => ({
          status: "OK",
          distance: { value: o === d ? 0 : 12_000 },
          duration: { value: o === d ? 0 : 1_100 },
        })),
      }));
      return new Response(JSON.stringify({ status: "OK", rows }), { status: 200 });
    }
    return real(input as RequestInfo, init);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = real;
  };
}

export async function mailpitClear(): Promise<void> {
  await fetch(`${MAILPIT_API}/messages`, { method: "DELETE" });
}

export async function mailpitList(): Promise<{
  messages: Array<{
    ID: string;
    Subject: string;
    To: Array<{ Address: string }>;
    From?: { Address: string };
    Created?: string;
  }>;
  total: number;
}> {
  const res = await fetch(`${MAILPIT_API}/messages`);
  if (!res.ok) throw new Error(`Mailpit list ${res.status}`);
  return (await res.json()) as {
    messages: Array<{
      ID: string;
      Subject: string;
      To: Array<{ Address: string }>;
      From?: { Address: string };
      Created?: string;
    }>;
    total: number;
  };
}

export async function mailpitMessage(id: string): Promise<{
  Subject: string;
  Text: string;
  HTML: string;
  To: Array<{ Address: string }>;
}> {
  const res = await fetch(`${MAILPIT_API}/message/${id}`);
  if (!res.ok) throw new Error(`Mailpit message ${res.status}`);
  return (await res.json()) as {
    Subject: string;
    Text: string;
    HTML: string;
    To: Array<{ Address: string }>;
  };
}

export function findPlaceholders(text: string): string[] {
  const needles = [
    "Exemple VTC",
    "Adresse à compléter",
    "contact@example.com",
    "exemple@",
    "@example.",
  ];
  return needles.filter((n) => text.toLowerCase().includes(n.toLowerCase()));
}

export const BAD_RENDER_RE = /undefined|NaN|\[object Object\]/i;
