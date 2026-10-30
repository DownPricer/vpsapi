import { Router } from "express";
import { postCalculerTarif } from "../controllers/calculerTarif.controller";
import { createRateLimiter } from "../middleware/rateLimit";

export const calculerTarifRoutes = Router();

/** Actif seulement si le BFF envoie X-Client-Ip (sinon l'IP partagée du Next bloquerait tout le site). */
const calculerTarifLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 60,
  key: "calculer-tarif",
  requireClientIpHeader: true,
});

calculerTarifRoutes.post("/", calculerTarifLimiter, postCalculerTarif);
