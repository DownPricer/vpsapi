import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { getPushNotifier } from "../services/push";

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

const subscribeSchema = z
  .object({
    endpoint: z
      .string()
      .url()
      .max(2000)
      .refine((v) => v.startsWith("https://"), "L'endpoint doit être en HTTPS."),
    keys: z.object({
      p256dh: z.string().min(1).max(200).regex(BASE64URL),
      auth: z.string().min(1).max(100).regex(BASE64URL),
    }),
  })
  .strict();

const unsubscribeSchema = z.object({ endpoint: z.string().url().max(2000) }).strict();

function authOf(req: Request, res: Response): { tenantId: string; userId: string } | null {
  if (!req.authUser) {
    res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Authentification requise." } });
    return null;
  }
  return { tenantId: req.authUser.tenantId, userId: req.authUser.id };
}

function notConfigured(res: Response): void {
  res.status(503).json({
    success: false,
    error: { code: "PUSH_NOT_CONFIGURED", message: "Les notifications ne sont pas disponibles pour le moment." },
  });
}

function validationError(res: Response, flat: unknown): void {
  res.status(400).json({
    success: false,
    error: { code: "VALIDATION_ERROR", message: "Données invalides.", details: flat },
  });
}

/** GET /api/pro/push/public-key */
export function getPushPublicKey(req: Request, res: Response): void {
  if (!authOf(req, res)) return;
  const publicKey = getPushNotifier().getPublicKey();
  if (!publicKey) return notConfigured(res);
  res.json({ success: true, data: { publicKey } });
}

/** POST /api/pro/push/subscribe */
export async function postPushSubscribe(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = authOf(req, res);
  if (!auth) return;
  const notifier = getPushNotifier();
  if (!notifier.isConfigured()) return notConfigured(res);
  const parsed = subscribeSchema.safeParse(req.body ?? {});
  if (!parsed.success) return validationError(res, parsed.error.flatten());
  try {
    await notifier.subscribe({
      tenantId: auth.tenantId,
      userId: auth.userId,
      endpoint: parsed.data.endpoint,
      keys: parsed.data.keys,
      userAgent: req.get("user-agent") ?? null,
    });
    res.json({ success: true, data: { subscribed: true } });
  } catch (e) {
    next(e);
  }
}

/** DELETE /api/pro/push/subscribe */
export async function deletePushSubscribe(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = authOf(req, res);
  if (!auth) return;
  const parsed = unsubscribeSchema.safeParse(req.body ?? {});
  if (!parsed.success) return validationError(res, parsed.error.flatten());
  try {
    const removed = await getPushNotifier().unsubscribe({
      tenantId: auth.tenantId,
      userId: auth.userId,
      endpoint: parsed.data.endpoint,
    });
    res.json({ success: true, data: { removed } });
  } catch (e) {
    next(e);
  }
}
