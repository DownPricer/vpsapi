import { Router } from "express";
import { postDevis } from "../controllers/devis.controller";
import { createRateLimiter } from "../middleware/rateLimit";

export const devisRoutes = Router();

const devisLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 15,
  key: "devis",
  requireClientIpHeader: true,
});

devisRoutes.post("/", devisLimiter, postDevis);
