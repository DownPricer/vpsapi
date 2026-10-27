import {
  PushSendError,
  type PushKeys,
  type PushSender,
  type PushStore,
  type StoredPushSubscription,
  type UpsertPushSubscriptionInput,
  type VapidConfig,
} from "../../services/push/push.types";
import { PushNotifier } from "../../services/push/pushNotifier.service";

export const TENANT_A = "tenant_a";
export const TENANT_B = "tenant_b";

export const VAPID: VapidConfig = {
  subject: "mailto:test@example.com",
  publicKey: "test-public-key",
  privateKey: "test-private-key",
};

type Row = StoredPushSubscription & { seq: number };

/** Store en mémoire : mêmes règles que PrismaPushStore (endpoint unique, tout borné par tenantId). */
export class MemoryPushStore implements PushStore {
  rows = new Map<string, Row>();
  touched: string[] = [];
  failList = false;
  private seq = 0;
  private idCounter = 0;

  async listForTenant(tenantId: string): Promise<StoredPushSubscription[]> {
    if (this.failList) throw new Error("db down");
    return [...this.rows.values()].filter((r) => r.tenantId === tenantId);
  }

  async upsert(input: UpsertPushSubscriptionInput): Promise<void> {
    const existing = [...this.rows.values()].find((r) => r.endpoint === input.endpoint);
    this.seq += 1;
    if (existing) {
      Object.assign(existing, {
        tenantId: input.tenantId,
        userId: input.userId,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        seq: this.seq,
      });
      return;
    }
    this.idCounter += 1;
    const id = `sub_${this.idCounter}`;
    this.rows.set(id, {
      id,
      tenantId: input.tenantId,
      userId: input.userId,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      seq: this.seq,
    });
  }

  async trimUser(tenantId: string, userId: string, keep: number): Promise<number> {
    const mine = [...this.rows.values()]
      .filter((r) => r.tenantId === tenantId && r.userId === userId)
      .sort((a, b) => b.seq - a.seq);
    const stale = mine.slice(keep);
    for (const r of stale) this.rows.delete(r.id);
    return stale.length;
  }

  async deleteForUser(tenantId: string, userId: string, endpoint: string): Promise<number> {
    let n = 0;
    for (const r of [...this.rows.values()]) {
      if (r.tenantId === tenantId && r.userId === userId && r.endpoint === endpoint) {
        this.rows.delete(r.id);
        n += 1;
      }
    }
    return n;
  }

  async deleteById(tenantId: string, id: string): Promise<void> {
    const r = this.rows.get(id);
    if (r && r.tenantId === tenantId) this.rows.delete(id);
  }

  async touch(tenantId: string, ids: string[]): Promise<void> {
    for (const id of ids) {
      if (this.rows.get(id)?.tenantId === tenantId) this.touched.push(id);
    }
  }

  endpoints(tenantId: string): string[] {
    return [...this.rows.values()].filter((r) => r.tenantId === tenantId).map((r) => r.endpoint);
  }
}

/** Expéditeur factice : statut par endpoint (absent = succès). */
export class FakeSender implements PushSender {
  sent: Array<{ endpoint: string; payload: string }> = [];
  statusByEndpoint = new Map<string, number>();

  async send(subscription: { endpoint: string; keys: PushKeys }, payload: string): Promise<void> {
    const status = this.statusByEndpoint.get(subscription.endpoint);
    if (status !== undefined) throw new PushSendError("Envoi push échoué", status);
    this.sent.push({ endpoint: subscription.endpoint, payload });
  }
}

export function makeKeys(n = 1): PushKeys {
  return { p256dh: `p256dh-${n}`, auth: `auth-${n}` };
}

export function makeEnv(vapid: VapidConfig | null = VAPID) {
  const store = new MemoryPushStore();
  const sender = new FakeSender();
  const notifier = new PushNotifier(store, sender, vapid);
  return { store, sender, notifier };
}
