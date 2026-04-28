import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import type { OperatorRole } from "@prisma/client";
import { loadEnv } from "../../config/env";

const env = loadEnv();

type AccessClaims = {
  sub: string;
  tenantId: string;
  email: string;
  role: OperatorRole;
};

type RefreshClaims = {
  sub: string;
  tenantId: string;
  sid: string;
};

export function signAccessToken(claims: AccessClaims): string {
  return jwt.sign(claims, env.jwtAccessSecret, { expiresIn: env.accessTokenTtlSec });
}

export function signRefreshToken(claims: RefreshClaims): string {
  return jwt.sign(claims, env.jwtRefreshSecret, { expiresIn: env.refreshTokenTtlSec });
}

export function verifyAccessToken(token: string): AccessClaims {
  return jwt.verify(token, env.jwtAccessSecret) as AccessClaims;
}

export function verifyRefreshToken(token: string): RefreshClaims {
  return jwt.verify(token, env.jwtRefreshSecret) as RefreshClaims;
}

export function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function refreshExpiresAt(): Date {
  return new Date(Date.now() + env.refreshTokenTtlSec * 1000);
}
