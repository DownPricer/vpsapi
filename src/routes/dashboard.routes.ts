import { Router } from "express";
import { getCalendar, getDashboardSession, getDashboardSummary } from "../controllers/dashboard.controller";

export const dashboardRoutes = Router();

dashboardRoutes.get("/summary", getDashboardSummary);
dashboardRoutes.get("/session", getDashboardSession);
dashboardRoutes.get("/calendar", getCalendar);
