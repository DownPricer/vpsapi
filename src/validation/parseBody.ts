import type { ZodSchema } from "zod";
import { ZodError } from "zod";

export type ParseResult<T> = { ok: true; data: T } | { ok: false; message: string; details: unknown };

export function parseBody<T>(schema: ZodSchema<T>, body: unknown): ParseResult<T> {
  try {
    const data = schema.parse(body);
    return { ok: true, data };
  } catch (e) {
    if (e instanceof ZodError) {
      return {
        ok: false,
        message: "Corps de requête invalide",
        details: e.flatten(),
      };
    }
    return { ok: false, message: "Corps de requête invalide", details: String(e) };
  }
}
