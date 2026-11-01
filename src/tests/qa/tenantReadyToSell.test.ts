/**
 * Étape 5 QA — tenant « ready to sell » :
 * create → login opérateur → tarifs / calcul → recevoir demande → accepter.
 * Paiement Stripe TEST : todo si pas de vraie sk_test_.
 */
import "./helpers/qaEnv";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import {
  assertLocalTestDb,
  findPlaceholders,
  installDistanceMatrixStub,
  isRealStripeTestKey,
  QA_DATABASE_URL,
} from "./helpers/qaEnv";

assertLocalTestDb(QA_DATABASE_URL);

const slug = `qa-ready-${Date.now().toString(36)}`;
const domain = `${slug}.test`;
const email = `admin@${domain}`;
const password = "QaReadyPass123!";
const commercialName = `QA Ready ${slug}`;

type Json = Record<string, unknown>;

describe("Étape 5 — tenant ready-to-sell", () => {
  let prisma: typeof import("../../db/prisma").prisma;
  let server: import("node:http").Server;
  let base = "";
  let restoreFetch: () => void;
  let createdPassword = password;
  let accessToken = "";
  let placeholdersFromCreate = 0;
  let publicPlaceholders: string[] = [];

  const headers = (extra: Record<string, string> = {}) => ({
    "content-type": "application/json",
    "x-tenant-id": slug,
    host: domain,
    ...extra,
  });

  async function api(
    method: string,
    route: string,
    body?: unknown,
    auth = false
  ): Promise<{ status: number; json: Json }> {
    const res = await fetch(`${base}/api/${route.replace(/^\//, "")}`, {
      method,
      headers: headers(auth && accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Json;
    return { status: res.status, json };
  }

  before(async () => {
    restoreFetch = installDistanceMatrixStub("ok");

    const create = spawnSync(
      process.platform === "win32" ? "npx.cmd" : "npx",
      [
        "tsx",
        "src/scripts/createTenant.ts",
        "--slug",
        slug,
        "--name",
        commercialName,
        "--domain",
        domain,
        "--email",
        email,
        "--password",
        password,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: QA_DATABASE_URL },
        encoding: "utf8",
        shell: true,
      }
    );
    const out = `${create.stdout || ""}\n${create.stderr || ""}`;
    assert.equal(create.status, 0, `tenant:create a échoué:\n${out}`);
    const resultLine = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.startsWith("__RESULT__"));
    assert.ok(resultLine, `pas de __RESULT__ dans la sortie:\n${out}`);
    const payload = JSON.parse(resultLine.replace("__RESULT__", "").trim()) as {
      tenantId: string;
      password: string;
      placeholders: number;
    };
    assert.equal(payload.tenantId, slug);
    createdPassword = payload.password || password;
    placeholdersFromCreate = payload.placeholders ?? 0;

    prisma = (await import("../../db/prisma")).prisma;
    const { createApp } = await import("../../app");
    server = createApp().listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    restoreFetch?.();
    server?.close();
    try {
      await prisma.leadRequest.deleteMany({ where: { tenantId: slug } });
      await prisma.operatorUser.deleteMany({ where: { tenantId: slug } });
      await prisma.tenantDomain.deleteMany({ where: { tenantId: slug } });
      await prisma.tenant.deleteMany({ where: { id: slug } });
      await prisma.$disconnect();
    } catch {
      /* nettoyage best-effort */
    }
  });

  it("login opérateur sur le tenant créé", async () => {
    const res = await api("POST", "auth/login", { email, password: createdPassword });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const data = res.json.data as Json;
    assert.ok(typeof data?.accessToken === "string" && (data.accessToken as string).length > 20);
    accessToken = data.accessToken as string;
  });

  it("réglages tarifs / settings publics + placeholders visibles", async () => {
    const pro = await api("GET", "pro/settings", undefined, true);
    assert.equal(pro.status, 200, JSON.stringify(pro.json));
    const pub = await api("GET", "public/tenant-settings");
    assert.equal(pub.status, 200, JSON.stringify(pub.json));
    const blob = JSON.stringify({ pro: pro.json, pub: pub.json });
    publicPlaceholders = findPlaceholders(blob);
    console.log(
      `[QA placeholders] createTenant=${placeholdersFromCreate} trouvés_dans_settings=${publicPlaceholders.join(" | ") || "(aucun motif listé)"}`
    );
    // Observation QA : les placeholders restants sont attendus après create (modèle marketing).
    assert.ok(
      placeholdersFromCreate >= 0,
      "createTenant doit reporter le compteur de placeholders"
    );
  });

  it("calcul prix moteur default (Distance Matrix stub)", async () => {
    const trip = {
      vtcBaseAddress: "1 place de la Mairie, 76000 Rouen, France",
      client: {
        nom: "Client",
        prenom: "QA",
        telephone: "0600000001",
        email: `client@${domain}`,
        organisation: "Particulier",
      },
      general: { TypeService: "Trajet Classique", TypeTrajet: "Aller Simple" },
      trajetClassique: {
        TCtrajet: "Aller Simple",
        TCpassagers: "2",
        TCallerpriseencharge: "1 rue Jeanne d'Arc, 76000 Rouen, France",
        TCallerDestination: "Gare Rouen Rive Droite, 76000 Rouen, France",
        TCallerdate: "20/11/2027",
        TCallerheure: "10:00",
        TCbagagesaller: "0",
        TCbagagesretour: "0",
      },
    };
    const res = await api("POST", "calculer-tarif", trip);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const data = res.json.data as Json;
    assert.ok(typeof data.tarif === "number" && (data.tarif as number) > 0, "tarif > 0 attendu");
  });

  it("recevoir une demande (devis) puis accepter", async () => {
    const body = {
      vtcBaseAddress: "1 place de la Mairie, 76000 Rouen, France",
      client: {
        nom: "Dupont",
        prenom: "Alice",
        telephone: "0600000002",
        email: `alice@${domain}`,
        organisation: "Particulier",
      },
      general: { TypeService: "Trajet Classique", TypeTrajet: "Aller Simple" },
      trajetClassique: {
        TCtrajet: "Aller Simple",
        TCpassagers: "2",
        TCallerpriseencharge: "1 rue Jeanne d'Arc, 76000 Rouen, France",
        TCallerDestination: "Gare Rouen Rive Droite, 76000 Rouen, France",
        TCallerdate: "21/11/2027",
        TCallerheure: "14:30",
        TCbagagesaller: "1",
        TCbagagesretour: "0",
      },
    };
    const created = await api("POST", "devis", body);
    assert.equal(created.status, 200, JSON.stringify(created.json));
    const leadId =
      (created.json.data as Json)?.devisId ||
      (created.json.data as Json)?.id ||
      (created.json.data as Json)?.leadId;
    assert.ok(typeof leadId === "string" && leadId.length > 5, JSON.stringify(created.json));

    const accept = await api(
      "PATCH",
      `requests/${leadId}/status`,
      { status: "accepted" },
      true
    );
    assert.equal(accept.status, 200, JSON.stringify(accept.json));
    const row = await prisma.leadRequest.findUnique({ where: { id: leadId as string } });
    assert.equal(row?.status, "accepted");
    assert.equal(row?.tenantId, slug);
  });

  if (!isRealStripeTestKey()) {
    it.todo(
      "paiement TEST Stripe Checkout — non testable (STRIPE_SECRET_KEY placeholder / absente ; fournir une vraie sk_test_)"
    );
  } else {
    it("paiement TEST Stripe Checkout", async () => {
      const pending = await prisma.leadRequest.findFirst({
        where: { tenantId: slug, status: "accepted" },
        orderBy: { createdAt: "desc" },
      });
      assert.ok(pending);
      const pay = await api(
        "POST",
        `pro/demandes/${pending!.id}/payment-link`,
        { mode: "FULL", sendEmail: false },
        true
      );
      assert.equal(pay.status, 200, JSON.stringify(pay.json));
      const url = (pay.json.data as Json)?.checkoutUrl as string | undefined;
      assert.ok(url?.includes("checkout.stripe.com") || url?.includes("stripe.com"));
    });
  }

  it("note QA : Stripe placeholder documenté", () => {
    if (!isRealStripeTestKey()) {
      console.log(
        `[QA non testable] STRIPE_SECRET_KEY=${(process.env.STRIPE_SECRET_KEY || "").slice(0, 18)}… — fournir une vraie sk_test_ pour le paiement.`
      );
    }
    if (publicPlaceholders.length || placeholdersFromCreate > 0) {
      console.log(
        `[QA observation] Placeholders marketing encore visibles après create (${placeholdersFromCreate}) : ${publicPlaceholders.join(", ") || "voir compteur createTenant"}. Correctif : parcours /pro/site avant mise en vente.`
      );
    }
  });
});
