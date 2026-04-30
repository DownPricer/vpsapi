import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { authRoutes } from "./auth.routes";
import { calculerTarifRoutes } from "./calculerTarif.routes";
import { contactRoutes } from "./contact.routes";
import { dashboardRoutes } from "./dashboard.routes";
import { devisRoutes } from "./devis.routes";
import { proRoutes } from "./pro.routes";
import { publicRoutes } from "./public.routes";
import { requestsRoutes } from "./requests.routes";
import { reservationRoutes } from "./reservation.routes";
import { smtpDebugRoutes } from "./smtpDebug.routes";

/**
 * Routes sous `/api` après résolution du locataire (sauf health, monté séparément).
 */
export function createTenantApiRouter(): Router {
  const router = Router();

  router.use("/auth", authRoutes);
  router.use("/public", publicRoutes);
  router.use("/calculer-tarif", calculerTarifRoutes);
  router.use("/devis", devisRoutes);
  router.use("/reservation", reservationRoutes);
  router.use("/contact", contactRoutes);
  router.use("/debug", smtpDebugRoutes);
  router.use("/requests", requireAuth, requestsRoutes);
  router.use("/dashboard", requireAuth, dashboardRoutes);
  router.use("/pro", requireAuth, proRoutes);

  return router;
}
