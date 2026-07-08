import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { prisma } from "../db/prisma";
import { stringLooksEncodingCorrupted } from "../utils/tenantSettingsEncoding";

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".css",
  ".html",
  ".env.example",
]);

const IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  ".next",
  ".git",
  "coverage",
  "backups",
  "tmp",
]);

const SOURCE_MOJIBAKE_RE = /�|Ã[a-zA-Z©¨ª«®´]|A�|r�servation|soir�e|priv�|A�roport|a�roport|v�hicule/;
const INTENTIONAL_PATTERN_FILES = [
  join("src", "platform", "auditTenantContent.ts"),
  join("src", "scripts", "auditUtf8.ts"),
  join("src", "utils", "tenantSettingsEncoding.ts"),
];

function shouldScanFile(path: string): boolean {
  if (path.endsWith("package-lock.json")) return false;
  if (INTENTIONAL_PATTERN_FILES.some((file) => path.endsWith(file))) return false;
  if (path.endsWith(".env.example")) return true;
  const idx = path.lastIndexOf(".");
  return idx >= 0 && SOURCE_EXTENSIONS.has(path.slice(idx));
}

function walkFiles(root: string, out: string[] = []): string[] {
  if (!existsSync(root)) return out;
  for (const entry of readdirSync(root)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(root, entry);
    const st = statSync(full);
    if (st.isDirectory()) walkFiles(full, out);
    else if (st.isFile() && shouldScanFile(full)) out.push(full);
  }
  return out;
}

function scanSourceText(value: string): boolean {
  return SOURCE_MOJIBAKE_RE.test(value);
}

function scanSettingsText(value: string): boolean {
  return SOURCE_MOJIBAKE_RE.test(value) || stringLooksEncodingCorrupted(value);
}

function scanFile(path: string): Array<{ file: string; line: number; sample: string }> {
  const text = readFileSync(path, "utf8");
  return text
    .split(/\r?\n/)
    .map((line, i) => ({ file: path, line: i + 1, sample: line.trim().slice(0, 180) }))
    .filter((row) => scanSourceText(row.sample));
}

function walkSettings(
  value: unknown,
  path: string,
  out: Array<{ path: string; sample: string }>
): void {
  if (typeof value === "string") {
    if (scanSettingsText(value)) out.push({ path, sample: value.slice(0, 180) });
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => walkSettings(item, `${path}[${i}]`, out));
    return;
  }
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    walkSettings(val, path ? `${path}.${key}` : key, out);
  }
}

async function main(): Promise<void> {
  const apiRoot = process.cwd();
  const frontRoot = join(apiRoot, "..", "vtc-template-front", "vtc76", "vtc76");
  const fileRoots = [apiRoot, frontRoot].filter(existsSync);
  const fileIssues = fileRoots.flatMap((root) => walkFiles(root).flatMap(scanFile));

  console.log(`Fichiers scannés: ${fileRoots.map((root) => relative(apiRoot, root) || ".").join(", ")}`);
  console.log(`Occurrences fichiers suspectes: ${fileIssues.length}`);
  for (const issue of fileIssues.slice(0, 80)) {
    console.log(`- ${relative(apiRoot, issue.file)}:${issue.line}: ${issue.sample}`);
  }

  try {
    const tenants = await prisma.tenant.findMany({ select: { id: true, settings: true } });
    let totalDbIssues = 0;
    for (const tenant of tenants) {
      const issues: Array<{ path: string; sample: string }> = [];
      walkSettings(tenant.settings, "", issues);
      totalDbIssues += issues.length;
      if (issues.length > 0) {
        console.log(`Tenant ${tenant.id}: ${issues.length} champ(s) suspect(s)`);
        for (const issue of issues.slice(0, 20)) {
          console.log(`  - ${issue.path}: ${issue.sample}`);
        }
      }
    }
    console.log(`Occurrences DB suspectes: ${totalDbIssues}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
