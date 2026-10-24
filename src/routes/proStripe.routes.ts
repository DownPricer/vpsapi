import { Router } from "express";
import {
  getProStripeOverview,
  getProStripeStatus,
  postProStripeConnect,
  postProStripeLoginLink,
  postProStripeOnboardingLink,
} from "../controllers/proStripe.controller";

export const proStripeRoutes = Router();

proStripeRoutes.post("/connect", postProStripeConnect);
proStripeRoutes.post("/onboarding-link", postProStripeOnboardingLink);
proStripeRoutes.post("/login-link", postProStripeLoginLink);
proStripeRoutes.get("/status", getProStripeStatus);
proStripeRoutes.get("/overview", getProStripeOverview);
