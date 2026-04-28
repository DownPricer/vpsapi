import { z } from "zod";

/** Bloc client attendu par les formulaires devis / réservation (aligné sur le template). */
export const clientBlockSchema = z.object({
  nom: z.string().min(1, "nom requis"),
  prenom: z.string().min(1, "prenom requis"),
  telephone: z.string().min(1, "telephone requis"),
  email: z.string().email("email invalide"),
  nomSociete: z.string().optional(),
  adresseSociete: z.string().optional(),
  organisation: z.string().optional(),
});

export type ClientBlock = z.infer<typeof clientBlockSchema>;

export function parseClientBlock(body: Record<string, unknown>): { ok: true; data: ClientBlock } | { ok: false; message: string } {
  const raw = body?.client;
  const parsed = clientBlockSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.flatten().fieldErrors;
    const msg = Object.entries(first)
      .map(([k, v]) => `${k}: ${(v as string[]).join(", ")}`)
      .join("; ");
    return { ok: false, message: msg || "Champs client invalides" };
  }
  return { ok: true, data: parsed.data };
}

export const contactBodySchema = z.object({
  client: clientBlockSchema,
  commentaires: z.string().optional(),
});
