import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { RequestService } from "../services/request.service";

const requestService = new RequestService();

export async function getDashboardSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await requestService.dashboardSummary(req.tenantId);
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
}

const calendarQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

export async function getCalendar(req: Request, res: Response, next: NextFunction): Promise<void> {
  const parsed = calendarQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Paramètres invalides." } });
    return;
  }
  const now = new Date();
  const from = parsed.data.from ? new Date(parsed.data.from) : new Date(now.getFullYear(), now.getMonth(), 1);
  const to = parsed.data.to ? new Date(parsed.data.to) : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Dates invalides." } });
    return;
  }
  try {
    const data = await requestService.calendar(req.tenantId, from, to);
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
}
