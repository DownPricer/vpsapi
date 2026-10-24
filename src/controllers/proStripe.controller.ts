import type { NextFunction, Request, Response } from "express";
import { StripeConnectService, StripeConnectServiceError } from "../services/stripeConnect.service";

const stripeConnectService = new StripeConnectService();

function unauthorized(res: Response): void {
  res.status(401).json({
    success: false,
    error: { code: "UNAUTHORIZED", message: "Authentification requise." },
  });
}

function handleStripeConnectError(res: Response, next: NextFunction, err: unknown): void {
  if (err instanceof StripeConnectServiceError) {
    res.status(err.httpStatus).json({
      success: false,
      error: { code: err.code, message: err.message },
    });
    return;
  }
  next(err);
}

export async function postProStripeConnect(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantId = req.authUser?.tenantId;
  if (!tenantId) {
    unauthorized(res);
    return;
  }
  try {
    const result = await stripeConnectService.ensureTenantStripeAccount(tenantId);
    res.status(200).json({
      success: true,
      data: {
        stripeAccountId: result.stripeAccountId,
        onboardingStatus: result.onboardingStatus,
      },
    });
  } catch (err) {
    handleStripeConnectError(res, next, err);
  }
}

export async function postProStripeOnboardingLink(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const tenantId = req.authUser?.tenantId;
  if (!tenantId) {
    unauthorized(res);
    return;
  }
  try {
    const result = await stripeConnectService.createTenantStripeOnboardingLink(tenantId);
    res.status(200).json({
      success: true,
      data: {
        stripeAccountId: result.stripeAccountId,
        url: result.url,
        expiresAt: result.expiresAt.toISOString(),
      },
    });
  } catch (err) {
    handleStripeConnectError(res, next, err);
  }
}

/** POST /api/pro/stripe/login-link — lien Dashboard Express à usage unique, jamais stocké ni mis en cache. */
export async function postProStripeLoginLink(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantId = req.authUser?.tenantId;
  if (!tenantId) {
    unauthorized(res);
    return;
  }
  try {
    const { url } = await stripeConnectService.createTenantExpressLoginLink(tenantId);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ success: true, data: { url } });
  } catch (err) {
    handleStripeConnectError(res, next, err);
  }
}

/** GET /api/pro/stripe/overview — statut réel du compte + derniers paiements / remboursements. */
export async function getProStripeOverview(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantId = req.authUser?.tenantId;
  if (!tenantId) {
    unauthorized(res);
    return;
  }
  try {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ success: true, data: await stripeConnectService.getTenantStripeOverview(tenantId) });
  } catch (err) {
    handleStripeConnectError(res, next, err);
  }
}

export async function getProStripeStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantId = req.authUser?.tenantId;
  if (!tenantId) {
    unauthorized(res);
    return;
  }
  try {
    const status = await stripeConnectService.refreshTenantStripeStatus(tenantId);
    res.status(200).json({
      success: true,
      data: status,
    });
  } catch (err) {
    handleStripeConnectError(res, next, err);
  }
}
