import type { NextFunction, Request, Response } from "express";
import { TenantSettingsService } from "../services/tenantSettings.service";
import { sanitizePublicTenantSettings } from "../utils/sanitizePublicTenantSettings";

const tenantSettingsService = new TenantSettingsService();

/**
 * GET /api/public/tenant-settings
 * Lecture seule, sans auth. Tenant résolu par le middleware (`X-Tenant-ID` ou tenant par défaut).
 */
export async function getPublicTenantSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantId = req.tenantId;

  try {
    const state = await tenantSettingsService.getSettingsState(tenantId);
    if (!state.tenantExists) {
      res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Locataire introuvable en base." },
      });
      return;
    }

    if (state.settings === null || typeof state.settings === "undefined") {
      res.status(200).json({
        success: true,
        data: { settings: null },
        meta: { persisted: false },
      });
      return;
    }

    const sanitized = sanitizePublicTenantSettings(state.settings);
    res.status(200).json({
      success: true,
      data: { settings: sanitized ?? {} },
      meta: { persisted: true },
    });
  } catch (e) {
    next(e);
  }
}
