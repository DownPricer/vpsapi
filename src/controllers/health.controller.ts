import type { Request, Response } from "express";
import { prisma } from "../db/prisma";

export function getHealth(_req: Request, res: Response): void {
  res.status(200).json({
    status: "ok",
    service: "vtc-core-api",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    version: process.env.npm_package_version ?? "0.1.0",
  });
}

/** Readiness : sonde Postgres (`SELECT 1`). Pas de détail d'erreur dans la réponse. */
export async function getReady(_req: Request, res: Response): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: "ready" });
  } catch {
    res.status(503).json({ status: "not_ready" });
  }
}
