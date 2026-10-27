import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_SUBSCRIPTIONS_PER_USER,
  PushNotifier,
  buildPushPayload,
  readVapidConfig,
} from "../services/push/pushNotifier.service";
import type { PushEventKind, StoredPushSubscription } from "../services/push/push.types";
import { FakeSender, MemoryPushStore, TENANT_A, TENANT_B, makeEnv, makeKeys } from "./helpers/pushFakes";

const sub = (tenantId: string, userId: string, n: number) => ({
  tenantId,
  userId,
  endpoint: `https://push.example.com/${tenantId}/${userId}/${n}`,
  keys: makeKeys(n),
});

describe("contenu de la notification", () => {
  const kinds: PushEventKind[] = ["new_request", "payment_confirmed", "cancellation_request"];

  it("ne contient que titre générique, texte générique, lien profond et tag", () => {
    for (const kind of kinds) {
      const p = buildPushPayload(kind, "clx1abc2def");
      assert.deepEqual(Object.keys(p).sort(), ["body", "tag", "title", "url"]);
      assert.equal(p.url, "/pro/demandes/clx1abc2def");
      assert.equal(p.tag, `${kind}:clx1abc2def`);
      assert.ok(p.title.length > 0 && p.body.length > 0);
      // Aucun chiffre ni arobase : rien qui ressemble à un montant, un téléphone ou un e-mail.
      assert.doesNotMatch(`${p.title} ${p.body}`, /[0-9@€]/);
    }
  });

  it("refuse un identifiant suspect et retombe sur la liste des demandes", () => {
    for (const bad of ["../../etc", "a b", "x?y=1", "", "é", "a".repeat(80)]) {
      assert.equal(buildPushPayload("new_request", bad).url, "/pro/demandes");
    }
    assert.equal(buildPushPayload("new_request").url, "/pro/demandes");
    assert.equal(buildPushPayload("new_request", null).tag, "new_request");
  });
});

describe("configuration VAPID", () => {
  const ok = { VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:a@b.fr" };

  it("lit la configuration complète", () => {
    assert.deepEqual(readVapidConfig(ok), { subject: "mailto:a@b.fr", publicKey: "pub", privateKey: "priv" });
    assert.ok(readVapidConfig({ ...ok, VAPID_SUBJECT: "https://exemple.fr" }));
  });

  it("désactive le push si une variable manque ou si le sujet est invalide", () => {
    assert.equal(readVapidConfig({}), null);
    assert.equal(readVapidConfig({ ...ok, VAPID_PRIVATE_KEY: " " }), null);
    assert.equal(readVapidConfig({ ...ok, VAPID_PUBLIC_KEY: undefined }), null);
    assert.equal(readVapidConfig({ ...ok, VAPID_SUBJECT: "contact@b.fr" }), null);
    assert.equal(readVapidConfig({ ...ok, VAPID_SUBJECT: "http://exemple.fr" }), null);
  });

  it("sans clés : aucune clé publique et aucun envoi", async () => {
    const { notifier, store, sender } = makeEnv(null);
    await store.upsert({ ...sub(TENANT_A, "u1", 1), userAgent: null });
    assert.equal(notifier.isConfigured(), false);
    assert.equal(notifier.getPublicKey(), null);
    assert.deepEqual(await notifier.notifyTenant(TENANT_A, "new_request", "lead1"), { sent: 0, removed: 0, failed: 0 });
    assert.equal(sender.sent.length, 0);
  });

  it("avec clés : expose la clé publique uniquement", () => {
    const { notifier } = makeEnv();
    assert.equal(notifier.getPublicKey(), "test-public-key");
  });
});

describe("isolation par tenant", () => {
  it("notifie uniquement les abonnés du tenant concerné", async () => {
    const { notifier, store, sender } = makeEnv();
    await notifier.subscribe(sub(TENANT_A, "ua", 1));
    await notifier.subscribe(sub(TENANT_A, "ua2", 1));
    await notifier.subscribe(sub(TENANT_B, "ub", 1));

    const res = await notifier.notifyTenant(TENANT_A, "new_request", "lead1");

    assert.equal(res.sent, 2);
    assert.equal(sender.sent.length, 2);
    assert.ok(sender.sent.every((s) => s.endpoint.includes(`/${TENANT_A}/`)));
    assert.equal(store.endpoints(TENANT_B).length, 1);
    assert.deepEqual(store.touched.sort(), ["sub_1", "sub_2"]);
  });

  it("n'envoie jamais hors tenant même si le store renvoie une ligne étrangère", async () => {
    const foreign: StoredPushSubscription = {
      id: "x",
      tenantId: TENANT_B,
      userId: "ub",
      endpoint: "https://push.example.com/foreign",
      p256dh: "k",
      auth: "a",
    };
    const store = new MemoryPushStore();
    store.listForTenant = async () => [foreign];
    const sender = new FakeSender();
    const notifier = new PushNotifier(store, sender, { subject: "mailto:a@b.fr", publicKey: "p", privateKey: "q" });

    const res = await notifier.notifyTenant(TENANT_A, "payment_confirmed", "lead1");

    assert.equal(res.sent, 0);
    assert.equal(sender.sent.length, 0);
  });

  it("le désabonnement est borné au tenant et à l'utilisateur du jeton", async () => {
    const { notifier, store } = makeEnv();
    const mine = sub(TENANT_A, "ua", 1);
    await notifier.subscribe(mine);

    assert.equal(await notifier.unsubscribe({ tenantId: TENANT_B, userId: "ua", endpoint: mine.endpoint }), false);
    assert.equal(await notifier.unsubscribe({ tenantId: TENANT_A, userId: "autre", endpoint: mine.endpoint }), false);
    assert.equal(store.endpoints(TENANT_A).length, 1);

    assert.equal(await notifier.unsubscribe({ tenantId: TENANT_A, userId: "ua", endpoint: mine.endpoint }), true);
    assert.equal(store.endpoints(TENANT_A).length, 0);
  });
});

describe("envoi et nettoyage", () => {
  it("supprime les abonnements qui répondent 404 ou 410 et garde les autres", async () => {
    const { notifier, store, sender } = makeEnv();
    const a = sub(TENANT_A, "u", 1);
    const b = sub(TENANT_A, "u", 2);
    const c = sub(TENANT_A, "u", 3);
    const d = sub(TENANT_A, "u", 4);
    for (const s of [a, b, c, d]) await notifier.subscribe(s);
    sender.statusByEndpoint.set(a.endpoint, 404);
    sender.statusByEndpoint.set(b.endpoint, 410);
    sender.statusByEndpoint.set(c.endpoint, 500);

    const res = await notifier.notifyTenant(TENANT_A, "new_request", "lead1");

    assert.deepEqual(res, { sent: 1, removed: 2, failed: 1 });
    assert.deepEqual(store.endpoints(TENANT_A).sort(), [c.endpoint, d.endpoint].sort());
  });

  it("un échec réseau (sans statut) ne supprime rien et n'empêche pas les autres envois", async () => {
    const { notifier, store, sender } = makeEnv();
    const a = sub(TENANT_A, "u", 1);
    const b = sub(TENANT_A, "u", 2);
    await notifier.subscribe(a);
    await notifier.subscribe(b);
    sender.send = async (s) => {
      if (s.endpoint === a.endpoint) throw new Error("ECONNRESET");
      sender.sent.push({ endpoint: s.endpoint, payload: "" });
    };

    const res = await notifier.notifyTenant(TENANT_A, "cancellation_request", "lead1");

    assert.deepEqual(res, { sent: 1, removed: 0, failed: 1 });
    assert.equal(store.endpoints(TENANT_A).length, 2);
  });

  it("n'envoie que le contenu générique, sans donnée personnelle", async () => {
    const { notifier, sender } = makeEnv();
    await notifier.subscribe(sub(TENANT_A, "u", 1));

    await notifier.notifyTenant(TENANT_A, "payment_confirmed", "clx9lead");

    const body = JSON.parse(sender.sent[0].payload) as Record<string, string>;
    assert.deepEqual(body, {
      title: "Paiement reçu",
      body: "Un paiement vient d'être confirmé.",
      url: "/pro/demandes/clx9lead",
      tag: "payment_confirmed:clx9lead",
    });
  });

  it("ne lève jamais d'exception si le store est indisponible", async () => {
    const { notifier, store } = makeEnv();
    store.failList = true;
    const res = await notifier.notifyTenant(TENANT_A, "new_request", "lead1");
    assert.deepEqual(res, { sent: 0, removed: 0, failed: 0 });
  });
});

describe("souscription", () => {
  it("réaffecte un endpoint existant à l'utilisateur qui se connecte (appareil partagé)", async () => {
    const { notifier, store } = makeEnv();
    const first = sub(TENANT_A, "ancien", 1);
    await notifier.subscribe(first);

    await notifier.subscribe({ ...first, userId: "nouveau" });

    assert.equal(store.rows.size, 1);
    const row = [...store.rows.values()][0];
    assert.equal(row.userId, "nouveau");
    assert.equal(row.tenantId, TENANT_A);
  });

  it("un appareil réaffecté à un autre tenant ne reçoit plus les notifications de l'ancien", async () => {
    const { notifier, sender } = makeEnv();
    const device = sub(TENANT_A, "u", 1);
    await notifier.subscribe(device);
    await notifier.subscribe({ ...device, tenantId: TENANT_B, userId: "ub" });

    assert.equal((await notifier.notifyTenant(TENANT_A, "new_request", "l1")).sent, 0);
    assert.equal((await notifier.notifyTenant(TENANT_B, "new_request", "l2")).sent, 1);
    assert.equal(sender.sent.length, 1);
  });

  it("garde au plus 10 abonnements par utilisateur (les plus récents)", async () => {
    const { notifier, store } = makeEnv();
    for (let i = 1; i <= MAX_SUBSCRIPTIONS_PER_USER + 3; i += 1) {
      await notifier.subscribe(sub(TENANT_A, "u", i));
    }
    await notifier.subscribe(sub(TENANT_A, "autre", 1));

    const mine = store.endpoints(TENANT_A).filter((e) => e.includes("/u/"));
    assert.equal(mine.length, MAX_SUBSCRIPTIONS_PER_USER);
    assert.ok(mine.includes("https://push.example.com/tenant_a/u/13"));
    assert.ok(!mine.includes("https://push.example.com/tenant_a/u/1"));
    assert.equal(store.endpoints(TENANT_A).length, MAX_SUBSCRIPTIONS_PER_USER + 1);
  });

  it("tronque le user-agent stocké", async () => {
    let stored: string | null = null;
    const store = new MemoryPushStore();
    const origUpsert = store.upsert.bind(store);
    store.upsert = async (input) => {
      stored = input.userAgent;
      return origUpsert(input);
    };
    const n = new PushNotifier(store, new FakeSender(), { subject: "mailto:a@b.fr", publicKey: "p", privateKey: "q" });
    await n.subscribe({ ...sub(TENANT_A, "u", 1), userAgent: "x".repeat(900) });
    assert.equal(stored!.length, 300);
  });
});
