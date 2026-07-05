import type { CookieOptions } from "express";
import jwt from "jsonwebtoken";
import type { PlatformAdminRole } from "@prisma/client";
import type { AppEnv } from "../config/env";

export const PLATFORM_ADMIN_COOKIE_NAME = "platform_admin_session";

export type PlatformAdminSessionClaims = {
  sub: string;
  email: string;
  role: PlatformAdminRole;
  name?: string | null;
};

export function platformCookieOptions(env: AppEnv, maxAgeSec: number): CookieOptions {
  return {
    httpOnly: true,
    secure: env.nodeEnv === "production",
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSec * 1000,
  };
}

export function signPlatformAdminSession(env: AppEnv, claims: PlatformAdminSessionClaims, ttlSec: number): string {
  if (!env.platformSessionSecret) {
    throw new Error("PLATFORM_SESSION_SECRET manquant.");
  }
  return jwt.sign(claims, env.platformSessionSecret, { expiresIn: ttlSec });
}

export function verifyPlatformAdminSession(env: AppEnv, token: string): PlatformAdminSessionClaims {
  if (!env.platformSessionSecret) {
    throw new Error("PLATFORM_SESSION_SECRET manquant.");
  }
  const decoded = jwt.verify(token, env.platformSessionSecret);
  if (!decoded || typeof decoded !== "object") {
    throw new Error("Session invalide.");
  }
  const o = decoded as Record<string, unknown>;
  const sub = typeof o.sub === "string" ? o.sub : "";
  const email = typeof o.email === "string" ? o.email : "";
  const role = typeof o.role === "string" ? (o.role as PlatformAdminRole) : null;
  const name = typeof o.name === "string" ? o.name : o.name === null ? null : undefined;
  if (!sub || !email || !role) {
    throw new Error("Session invalide.");
  }
  return { sub, email, role, ...(name !== undefined ? { name } : {}) };
}

