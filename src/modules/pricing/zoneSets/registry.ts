import { FR_76_COMMUNES } from "./fr-76";

const SETS: Record<string, ReadonlySet<string>> = {
  "fr-76": FR_76_COMMUNES,
};

export function getPrimaryServiceZoneCommunes(setId: string): ReadonlySet<string> | undefined {
  return SETS[setId];
}
