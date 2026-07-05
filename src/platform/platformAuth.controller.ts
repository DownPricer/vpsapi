import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../db/prisma";
import { loadEnv } from "../config/env";
import { PLATFORM_ADMIN_COOKIE_NAME, platformCookieOptions, signPlatformAdminSession } from "./platformSession";
import { trackFromRequest } from "./telemetry.service";

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

const SESSION_TTL_SEC = 60 * 60 * 12; // 12h

export async function postPlatformAdminLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const env = loadEnv();
  if (!env.platformAdminEnabled) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Route indisponible." } });
    return;
  }
  if (!env.platformSessionSecret) {
    res.status(503).json({
      success: false,
      error: { code: "CONFIG_ERROR", message: "PLATFORM_SESSION_SECRET manquant." },
    });
    return;
  }

  const parsed = loginSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Email/mot de passe requis." },
    });
    return;
  }

  const email = parsed.data.email.toLowerCase();
  try {
    const user = await prisma.platformAdminUser.findUnique({ where: { email } });
    const ok = user ? await bcrypt.compare(parsed.data.password, user.passwordHash) : false;
    if (!ok || !user) {
      void trackFromRequest({
        tenantId: null,
        type: "platform_admin_login_failed",
        category: "platform_auth",
        reqIp: req.ip,
        forwardedFor: typeof req.headers["x-forwarded-for"] === "string" ? req.headers["x-forwarded-for"] : undefined,
        userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
        path: req.path,
        referrer: typeof req.headers.referer === "string" ? req.headers.referer : undefined,
        metadata: { email },
      });
      res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Identifiants invalides." },
      });
      return;
    }

    await prisma.platformAdminUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const token = signPlatformAdminSession(
      env,
      { sub: user.id, email: user.email, role: user.role, ...(user.name ? { name: user.name } : {}) },
      SESSION_TTL_SEC
    );
    res.cookie(PLATFORM_ADMIN_COOKIE_NAME, token, platformCookieOptions(env, SESSION_TTL_SEC));
    void trackFromRequest({
      tenantId: null,
      type: "platform_admin_login_success",
      category: "platform_auth",
      reqIp: req.ip,
      forwardedFor: typeof req.headers["x-forwarded-for"] === "string" ? req.headers["x-forwarded-for"] : undefined,
      userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
      path: req.path,
      referrer: typeof req.headers.referer === "string" ? req.headers.referer : undefined,
      metadata: { adminId: user.id, role: user.role },
    });
    res.status(200).json({
      success: true,
      data: { id: user.id, email: user.email, role: user.role, name: user.name },
    });
  } catch (e) {
    next(e);
  }
}

export async function postPlatformAdminLogout(req: Request, res: Response): Promise<void> {
  const env = loadEnv();
  if (!env.platformAdminEnabled) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Route indisponible." } });
    return;
  }
  res.clearCookie(PLATFORM_ADMIN_COOKIE_NAME, {
    httpOnly: true,
    secure: env.nodeEnv === "production",
    sameSite: "lax",
    path: "/",
  });
  res.status(200).json({ success: true });
}

export async function getPlatformAdminMe(req: Request, res: Response): Promise<void> {
  const env = loadEnv();
  if (!env.platformAdminEnabled) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Route indisponible." } });
    return;
  }
  if (!req.platformAdmin) {
    res.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Authentification super-admin requise." },
    });
    return;
  }
  res.status(200).json({ success: true, data: req.platformAdmin });
}

