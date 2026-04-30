import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { TenantSettingsService } from "../services/tenantSettings.service";
import { sendValidationError } from "../utils/apiResponse";
import { validateTenantSettingsPayload } from "../validation/tenantSettingsPayload";

const putBodySchema = z.object({
  settings: z.unknown(),
});

const tenantSettingsService = new TenantSettingsService();

/**
 * GET /api/pro/settings
 * tenantId issu exclusivement du jeton (requireAuth + alignement X-Tenant-ID).
 */
export async function getProTenantSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantId = req.authUser?.tenantId;
  if (!tenantId) {
    res.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Authentification requise." },
    });
    return;
  }

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
        meta: {
          persisted: false,
          message:
            "Aucune configuration enregistrée pour ce tenant. Utilisez les valeurs par défaut côté application jusqu'à la première sauvegarde.",
        },
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: { settings: state.settings },
      meta: { persisted: true },
    });
  } catch (e) {
    next(e);
  }
}

/**
 * PUT ou PATCH /api/pro/settings — corps `{ settings: object }`.
 */
export async function putProTenantSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantId = req.authUser?.tenantId;
  if (!tenantId) {
    res.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Authentification requise." },
    });
    return;
  }

  const parsed = putBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    sendValidationError(res, 'Corps attendu : { "settings": <objet JSON> }.');
    return;
  }

  const validated = validateTenantSettingsPayload(parsed.data.settings);
  if (!validated.ok) {
    sendValidationError(res, validated.message, validated.details);
    return;
  }

  try {
    await tenantSettingsService.saveSettings(tenantId, validated.value as Prisma.InputJsonValue);
    res.status(200).json({
      success: true,
      data: { settings: validated.value },
      meta: { persisted: true },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Locataire introuvable en base." },
      });
      return;
    }
    next(e);
  }
}
