import bcrypt from "bcryptjs";
import type { OperatorUser } from "@prisma/client";
import { prisma } from "../db/prisma";
import {
  hashToken,
  refreshExpiresAt,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../modules/auth/tokens";

function sanitizeUser(user: OperatorUser) {
  return {
    id: user.id,
    tenantId: user.tenantId,
    email: user.email,
    role: user.role,
    active: user.active,
  };
}

export class AuthService {
  async login(params: {
    tenantId: string;
    email: string;
    password: string;
    ip?: string;
    userAgent?: string;
  }) {
    const email = params.email.trim().toLowerCase();
    const user = await prisma.operatorUser.findFirst({
      where: { tenantId: params.tenantId, email, active: true },
    });
    if (!user) throw new Error("Identifiants invalides");

    const ok = await bcrypt.compare(params.password, user.passwordHash);
    if (!ok) throw new Error("Identifiants invalides");

    const session = await prisma.authSession.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        refreshTokenHash: "pending",
        expiresAt: refreshExpiresAt(),
        ip: params.ip,
        userAgent: params.userAgent,
      },
    });

    const refreshToken = signRefreshToken({ sub: user.id, tenantId: user.tenantId, sid: session.id });
    await prisma.authSession.update({
      where: { id: session.id },
      data: { refreshTokenHash: hashToken(refreshToken) },
    });

    return {
      accessToken: signAccessToken({
        sub: user.id,
        tenantId: user.tenantId,
        email: user.email,
        role: user.role,
      }),
      refreshToken,
      user: sanitizeUser(user),
    };
  }

  async refresh(refreshToken: string) {
    const claims = verifyRefreshToken(refreshToken);
    const session = await prisma.authSession.findUnique({
      where: { id: claims.sid },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new Error("Session expirée");
    }
    if (session.userId !== claims.sub || session.tenantId !== claims.tenantId) {
      throw new Error("Session invalide");
    }
    if (session.refreshTokenHash !== hashToken(refreshToken)) {
      throw new Error("Session invalide");
    }
    if (!session.user.active) {
      throw new Error("Compte désactivé");
    }

    const rotated = await prisma.authSession.create({
      data: {
        tenantId: session.tenantId,
        userId: session.userId,
        refreshTokenHash: "pending",
        expiresAt: refreshExpiresAt(),
        ip: session.ip,
        userAgent: session.userAgent,
      },
    });

    await prisma.authSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), replacedById: rotated.id },
    });

    const nextRefresh = signRefreshToken({
      sub: session.userId,
      tenantId: session.tenantId,
      sid: rotated.id,
    });
    await prisma.authSession.update({
      where: { id: rotated.id },
      data: { refreshTokenHash: hashToken(nextRefresh) },
    });

    return {
      accessToken: signAccessToken({
        sub: session.userId,
        tenantId: session.tenantId,
        email: session.user.email,
        role: session.user.role,
      }),
      refreshToken: nextRefresh,
      user: sanitizeUser(session.user),
    };
  }

  async logout(refreshToken?: string): Promise<void> {
    if (!refreshToken) return;
    try {
      const claims = verifyRefreshToken(refreshToken);
      await prisma.authSession.updateMany({
        where: { id: claims.sid, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } catch {
      // noop
    }
  }
}
