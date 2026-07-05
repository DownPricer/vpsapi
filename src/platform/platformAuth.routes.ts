import { Router } from "express";
import { getPlatformAdminMe, postPlatformAdminLogin, postPlatformAdminLogout } from "./platformAuth.controller";
import { requirePlatformAdmin } from "./requirePlatformAdmin";

export const platformAuthRoutes = Router();

platformAuthRoutes.post("/login", (req, res, next) => {
  void postPlatformAdminLogin(req, res, next);
});

platformAuthRoutes.post("/logout", (req, res) => {
  void postPlatformAdminLogout(req, res);
});

platformAuthRoutes.get("/me", requirePlatformAdmin, (req, res) => {
  void getPlatformAdminMe(req, res);
});

