/**
 * Démarre Postgres embarqué QA sur 127.0.0.1:5433 (base vtc_qa_test).
 * Usage: npx tsx src/tests/qa/helpers/startQaPg.ts
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

// embedded-postgres : résolution CommonJS (tsconfig moduleResolution=node)
const require = createRequire(path.join(process.cwd(), "package.json"));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const EmbeddedPostgres = require("embedded-postgres") as new (opts: Record<string, unknown>) => {
  initialise(): Promise<void>;
  start(): Promise<void>;
  createDatabase(name: string): Promise<void>;
};

async function main() {
  mkdirSync("./data/qa-pg", { recursive: true });
  const pg = new EmbeddedPostgres({
    databaseDir: "./data/qa-pg",
    user: "postgres",
    password: "postgres",
    port: 5433,
    persistent: true,
    autoRehydrateSymlinks: true,
  });
  if (!existsSync("./data/qa-pg/PG_VERSION")) {
    console.log("initialise cluster…");
    await pg.initialise();
  }
  console.log("start…");
  await pg.start();
  try {
    await pg.createDatabase("vtc_qa_test");
    console.log("created vtc_qa_test");
  } catch (e) {
    console.log("createDatabase:", (e as Error).message);
  }
  console.log("UP on 5433");
  await new Promise(() => undefined);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
