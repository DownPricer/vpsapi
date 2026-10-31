import { Router } from "express";
import { postCalculerTarif } from "../controllers/calculerTarif.controller";
import { createPublicRouteRateLimiter } from "../middleware/publicRateLimit";

export const calculerTarifRoutes = Router();

calculerTarifRoutes.post("/", createPublicRouteRateLimiter("calculer-tarif", 60), postCalculerTarif);
