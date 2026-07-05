import { Router } from "express";
import { getAdminAppPage, getAdminLoginPage } from "./admin.controller";

export const adminRoutes = Router();

adminRoutes.get("/login", (req, res) => {
  void getAdminLoginPage(req, res);
});

adminRoutes.get("/", (req, res, next) => {
  void getAdminAppPage(req, res, next);
});

// Simple "catch-all" pour liens internes (V1 sans bundler)
adminRoutes.get("*", (req, res, next) => {
  void getAdminAppPage(req, res, next);
});

