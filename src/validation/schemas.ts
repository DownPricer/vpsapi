import { z } from "zod";

/** Corps JSON libre (migration progressive des champs métier). */
export const objectPayloadSchema = z.object({}).passthrough();

export type ObjectPayload = z.infer<typeof objectPayloadSchema>;
