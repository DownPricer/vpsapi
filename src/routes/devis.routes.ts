import { Router } from "express";
import { postDevis } from "../controllers/devis.controller";
import { createPublicRouteRateLimiter } from "../middleware/publicRateLimit";

export const devisRoutes = Router();

devisRoutes.post("/", createPublicRouteRateLimiter("devis", 15), postDevis);
