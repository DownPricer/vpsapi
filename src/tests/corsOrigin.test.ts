import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../db/prisma";
import { isActiveTenantOrigin } from "../tenancy/corsOrigin";

test("origines CORS : seuls les domaines actifs (nu ou www, en https) sont acceptés", async () => {
  let calls = 0;
  (prisma.tenantDomain as any).findMany = async () => {
    calls += 1;
    return [{ domain: "exemple.sitereadyshd.fr" }, { domain: "www.dupont-vtc.fr" }];
  };

  assert.equal(await isActiveTenantOrigin("https://exemple.sitereadyshd.fr"), true);
  assert.equal(await isActiveTenantOrigin("https://www.exemple.sitereadyshd.fr"), true);
  assert.equal(await isActiveTenantOrigin("https://dupont-vtc.fr"), true);
  assert.equal(await isActiveTenantOrigin("https://inconnu.fr"), false);
  assert.equal(await isActiveTenantOrigin("https://exemple.sitereadyshd.fr.evil.com"), false);
  assert.equal(await isActiveTenantOrigin("http://exemple.sitereadyshd.fr"), false);
  assert.equal(await isActiveTenantOrigin("pas une url"), false);
  assert.equal(calls, 1, "la liste est mise en cache");
});
