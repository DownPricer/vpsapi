import { Router } from "express";
import { postContact } from "../controllers/contact.controller";
import { createRateLimiter } from "../middleware/rateLimit";

export const contactRoutes = Router();

const contactLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 10,
  key: "contact",
  requireClientIpHeader: true,
});

contactRoutes.post("/", contactLimiter, postContact);
