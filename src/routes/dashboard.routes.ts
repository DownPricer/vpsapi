import { Router } from "express";
import { getCalendar, getDashboardSummary } from "../controllers/dashboard.controller";

export const dashboardRoutes = Router();

dashboardRoutes.get("/summary", getDashboardSummary);
dashboardRoutes.get("/calendar", getCalendar);
