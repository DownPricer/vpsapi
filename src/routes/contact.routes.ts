import { Router } from "express";
import { postContact } from "../controllers/contact.controller";
import { createPublicRouteRateLimiter } from "../middleware/publicRateLimit";

export const contactRoutes = Router();

contactRoutes.post("/", createPublicRouteRateLimiter("contact", 10), postContact);
