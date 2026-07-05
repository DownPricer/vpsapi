import type { NextFunction, Request, Response } from "express";
import { loadEnv } from "../config/env";
import { PLATFORM_ADMIN_COOKIE_NAME, verifyPlatformAdminSession } from "./platformSession";
import { renderAdminAppPage, renderAdminLoginPage } from "./adminPages";

function hasValidAdminCookie(req: Request): boolean {
  const env = loadEnv();
  if (!env.platformAdminEnabled) return false;
  const token = (req.cookies?.[PLATFORM_ADMIN_COOKIE_NAME] as string | undefined) ?? "";
  if (!token) return false;
  try {
    verifyPlatformAdminSession(env, token);
    return true;
  } catch {
    return false;
  }
}

export async function getAdminLoginPage(req: Request, res: Response): Promise<void> {
  const env = loadEnv();
  if (!env.platformAdminEnabled) {
    res.status(404).send("Not found");
    return;
  }
  if (hasValidAdminCookie(req)) {
    res.redirect(302, "/admin");
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(renderAdminLoginPage(env));
}

export async function getAdminAppPage(req: Request, res: Response, _next: NextFunction): Promise<void> {
  const env = loadEnv();
  if (!env.platformAdminEnabled) {
    res.status(404).send("Not found");
    return;
  }
  if (!hasValidAdminCookie(req)) {
    res.redirect(302, "/admin/login");
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(renderAdminAppPage());
}

