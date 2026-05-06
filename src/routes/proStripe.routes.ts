import { Router } from "express";
import {
  getProStripeStatus,
  postProStripeConnect,
  postProStripeOnboardingLink,
} from "../controllers/proStripe.controller";

export const proStripeRoutes = Router();

proStripeRoutes.post("/connect", postProStripeConnect);
proStripeRoutes.post("/onboarding-link", postProStripeOnboardingLink);
proStripeRoutes.get("/status", getProStripeStatus);
