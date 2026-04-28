import type { NextFunction, Request, Response } from "express";
import { ContactService } from "../services/contact.service";
import { sendSuccess, sendValidationError } from "../utils/apiResponse";
import { parseBody } from "../validation/parseBody";
import { objectPayloadSchema } from "../validation/schemas";

const contactService = new ContactService();

export async function postContact(req: Request, res: Response, next: NextFunction): Promise<void> {
  const parsed = parseBody(objectPayloadSchema, req.body ?? {});
  if (!parsed.ok) {
    sendValidationError(res, parsed.message, parsed.details);
    return;
  }

  try {
    const data = await contactService.processContact(req.tenant, parsed.data);
    sendSuccess(res, data, { tenantId: req.tenantId });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("invalides") || message.includes("Required")) {
      sendValidationError(res, message);
      return;
    }
    if (message.includes("SMTP") || message.includes("MAIL_FROM") || message.includes("smtp.")) {
      res.status(503).json({
        success: false,
        error: { code: "MAIL_UNAVAILABLE", message },
      });
      return;
    }
    next(e);
  }
}
