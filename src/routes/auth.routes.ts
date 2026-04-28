import { Router } from "express";
import { getAuthMe, postAuthLogin, postAuthLogout, postAuthRefresh } from "../controllers/auth.controller";
import { requireAuth } from "../middleware/auth";

export const authRoutes = Router();

authRoutes.post("/login", postAuthLogin);
authRoutes.post("/refresh", postAuthRefresh);
authRoutes.post("/logout", postAuthLogout);
authRoutes.get("/me", requireAuth, getAuthMe);
