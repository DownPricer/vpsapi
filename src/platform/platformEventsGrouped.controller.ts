import type { NextFunction, Request, Response } from "express";
import { DateTime } from "luxon";
import { prisma } from "../db/prisma";
import { parseRangeKey, rangeToDates } from "./platformQueries";

type GroupByKey = "day" | "hour";

function parseGroupBy(raw: unknown): GroupByKey {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (v === "hour") return "hour";
  return "day";
}

export async function getPlatformEventsGrouped(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantId = typeof req.query.tenantId === "string" ? req.query.tenantId.trim() : "";
  const type = typeof req.query.type === "string" ? req.query.type.trim() : "";
  const category = typeof req.query.category === "string" ? req.query.category.trim() : "";
  const range = parseRangeKey(req.query.range, "30d");
  const { from, to } = rangeToDates(range);
  const fromDate = from ?? DateTime.utc().minus({ days: 30 }).toJSDate();
  const by = parseGroupBy(req.query.by);

  const takeRaw = typeof req.query.take === "string" ? Number.parseInt(req.query.take, 10) : 200;
  const take = Number.isFinite(takeRaw) ? Math.max(10, Math.min(500, takeRaw)) : 200;

  try {
    // Groupement côté DB (évite de remonter des milliers d’events).
    const rows = await prisma.$queryRaw<Array<{
      bucket: string;
      tenantId: string | null;
      type: string;
      category: string | null;
      cnt: bigint;
      lastAt: Date;
    }>>`
      SELECT
        to_char(date_trunc(${by === "hour" ? "hour" : "day"}, "createdAt"), ${by === "hour" ? "YYYY-MM-DD HH24:00" : "YYYY-MM-DD"}) AS bucket,
        "tenantId" as "tenantId",
        "type" as "type",
        "category" as "category",
        count(*)::bigint as cnt,
        max("createdAt") as "lastAt"
      FROM "PlatformEvent"
      WHERE "createdAt" >= ${fromDate} AND "createdAt" <= ${to}
        AND (${tenantId || null}::text IS NULL OR "tenantId" = ${tenantId || null})
        AND (${type || null}::text IS NULL OR "type" = ${type || null})
        AND (${category || null}::text IS NULL OR "category" = ${category || null})
      GROUP BY 1, 2, 3, 4
      ORDER BY "lastAt" DESC
      LIMIT ${take}
    `;

    res.status(200).json({
      success: true,
      data: {
        range,
        by,
        count: rows.length,
        groups: rows.map((r) => ({
          bucket: r.bucket,
          tenantId: r.tenantId,
          type: r.type,
          category: r.category,
          count: Number(r.cnt),
          lastAt: r.lastAt,
        })),
      },
    });
  } catch (e) {
    next(e);
  }
}

