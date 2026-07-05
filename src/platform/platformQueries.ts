import { DateTime } from "luxon";

export type RangeKey = "24h" | "7d" | "30d" | "90d" | "all";

export function parseRangeKey(raw: unknown, fallback: RangeKey = "30d"): RangeKey {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (v === "24h" || v === "7d" || v === "30d" || v === "90d" || v === "all") return v;
  return fallback;
}

export function rangeToDates(range: RangeKey): { from: Date | null; to: Date } {
  const to = DateTime.utc();
  if (range === "all") return { from: null, to: to.toJSDate() };
  const from =
    range === "24h" ? to.minus({ hours: 24 }) :
    range === "7d" ? to.minus({ days: 7 }) :
    range === "30d" ? to.minus({ days: 30 }) :
    to.minus({ days: 90 });
  return { from: from.toJSDate(), to: to.toJSDate() };
}

