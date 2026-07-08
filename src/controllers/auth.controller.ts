import type { NextFunction, Request, Response } from "express";
import crypto from "crypto";
import { z } from "zod";
import { loadEnv } from "../config/env";
import { AuthService } from "../services/auth.service";
import { trackFromRequest } from "../platform/telemetry.service";

const env = loadEnv();
const authService = new AuthService();
const cookieName = "vtc_refresh_token";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function setRefreshCookie(res: Response, value: string): void {
  res.cookie(cookieName, value, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/api/auth",
    maxAge: env.refreshTokenTtlSec * 1000,
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(cookieName, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/api/auth",
  });
}

function hashEmailForLogs(email: string): string {
  return crypto.createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 16);
}

function maskEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  const [local, domain] = normalized.split("@");
  if (!local || !domain) return "invalid-email";
  return `${local.slice(0, 2)}***@${domain}`;
}

export async function postAuthLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const parsed = loginSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Email et mot de passe requis." },
    });
    return;
  }

  try {
    const emailHash = hashEmailForLogs(parsed.data.email);
    const result = await authService.login({
      tenantId: req.tenantId,
      email: parsed.data.email,
      password: parsed.data.password,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    setRefreshCookie(res, result.refreshToken);
    void trackFromRequest({
      tenantId: req.tenantId,
      type: "pro_login_success",
      category: "pro_auth",
      reqIp: req.ip,
      forwardedFor: typeof req.headers["x-forwarded-for"] === "string" ? req.headers["x-forwarded-for"] : undefined,
      userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
      path: "/api/auth/login",
      referrer: typeof req.headers.referer === "string" ? req.headers.referer : undefined,
      metadata: { userId: result.user.id, role: result.user.role },
    });
    console.info("[auth:pro] login success", {
      tenantId: req.tenantId,
      tenantResolution: req.tenantResolution?.source,
      origin: req.tenantResolution?.origin,
      observedDomain: req.tenantResolution?.observedDomain,
      matchedDomain: req.tenantResolution?.matchedDomain,
      domainStatus: req.tenantResolution?.domainStatus,
      emailHash,
    });
    res.json({ success: true, data: { accessToken: result.accessToken, user: result.user } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur login";
    const emailHash = hashEmailForLogs(parsed.data.email);
    console.warn("[auth:pro] login refused", {
      tenantId: req.tenantId,
      tenantResolution: req.tenantResolution?.source,
      origin: req.tenantResolution?.origin,
      observedDomain: req.tenantResolution?.observedDomain,
      matchedDomain: req.tenantResolution?.matchedDomain,
      domainStatus: req.tenantResolution?.domainStatus,
      emailHash,
      reason: message.slice(0, 120),
    });
    void trackFromRequest({
      tenantId: req.tenantId,
      type: "pro_login_failed",
      category: "pro_auth",
      reqIp: req.ip,
      forwardedFor: typeof req.headers["x-forwarded-for"] === "string" ? req.headers["x-forwarded-for"] : undefined,
      userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
      path: "/api/auth/login",
      referrer: typeof req.headers.referer === "string" ? req.headers.referer : undefined,
      metadata: { emailHash, emailMasked: maskEmail(parsed.data.email), reason: message.slice(0, 200) },
    });
    res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message } });
  }
}

export async function postAuthRefresh(req: Request, res: Response): Promise<void> {
  const refreshToken = req.cookies?.[cookieName];
  if (!refreshToken) {
    clearRefreshCookie(res);
    res.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Session absente." },
    });
    return;
  }

  try {
    const result = await authService.refresh(refreshToken);
    if (result.user.tenantId !== req.tenantId) {
      clearRefreshCookie(res);
      res.status(403).json({
        success: false,
        error: { code: "FORBIDDEN", message: "Session invalide pour ce locataire." },
      });
      return;
    }
    setRefreshCookie(res, result.refreshToken);
    res.json({ success: true, data: { accessToken: result.accessToken, user: result.user } });
  } catch {
    clearRefreshCookie(res);
    res.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Session expirée." },
    });
  }
}

export async function postAuthLogout(req: Request, res: Response): Promise<void> {
  const refreshToken = req.cookies?.[cookieName];
  await authService.logout(refreshToken);
  clearRefreshCookie(res);
  res.json({ success: true });
}

export function getAuthMe(req: Request, res: Response): void {
  if (!req.authUser) {
    res.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Authentification requise." },
    });
    return;
  }
  res.json({ success: true, data: { user: req.authUser } });
}
