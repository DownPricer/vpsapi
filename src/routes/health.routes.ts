import { Router } from "express";
import { getHealth, getReady } from "../controllers/health.controller";

export const healthRoutes = Router();

healthRoutes.get("/", getHealth);
healthRoutes.get("/ready", getReady);
