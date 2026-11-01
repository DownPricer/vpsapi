/**
 * Distance Matrix : jamais de 0 km inventé ; adresse identique → 0 km OK.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  DistanceUnavailableError,
  getDistancesBatch,
  getDistancesWithFallback,
} from "../modules/distance/distanceMatrix";

const KEY = "test-key";

function stubFetch(handler: (url: string) => Response | Promise<Response> | never): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    return handler(url);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = real;
  };
}

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

describe("getDistancesBatch / getDistancesWithFallback", () => {
  it("propage PROVIDER_ERROR si le top-level status n'est pas OK (plus de 0 km)", async () => {
    restore = stubFetch(() =>
      new Response(JSON.stringify({ status: "REQUEST_DENIED", error_message: "denied" }), {
        status: 200,
      })
    );
    await assert.rejects(
      () => getDistancesWithFallback(KEY, ["A"], ["B"]),
      (e: unknown) =>
        e instanceof DistanceUnavailableError && e.causeCode === "PROVIDER_ERROR" && e.httpStatus === 503
    );
  });

  it("propage ADDRESS_NOT_FOUND si un élément n'est pas OK", async () => {
    restore = stubFetch(() =>
      new Response(
        JSON.stringify({
          status: "OK",
          rows: [{ elements: [{ status: "NOT_FOUND" }] }],
        }),
        { status: 200 }
      )
    );
    await assert.rejects(
      () => getDistancesBatch(KEY, ["Rue inconnue"], ["75001 Paris"]),
      (e: unknown) =>
        e instanceof DistanceUnavailableError &&
        e.causeCode === "ADDRESS_NOT_FOUND" &&
        e.httpStatus === 422
    );
  });

  it("accepte 0 km quand origine = destination (OK)", async () => {
    restore = stubFetch(() =>
      new Response(
        JSON.stringify({
          status: "OK",
          rows: [
            {
              elements: [
                { status: "OK", distance: { value: 0 }, duration: { value: 0 } },
              ],
            },
          ],
        }),
        { status: 200 }
      )
    );
    const out = await getDistancesBatch(KEY, ["76000 Rouen"], ["76000 Rouen"]);
    assert.deepEqual(out["76000 Rouen->76000 Rouen"], { km: 0, duree: 0 });
  });

  it("accepte 0 km si origine = destination même si élément non OK", async () => {
    restore = stubFetch(() =>
      new Response(
        JSON.stringify({
          status: "OK",
          rows: [{ elements: [{ status: "ZERO_RESULTS" }] }],
        }),
        { status: 200 }
      )
    );
    const out = await getDistancesBatch(KEY, ["Same"], ["Same"]);
    assert.deepEqual(out["Same->Same"], { km: 0, duree: 0 });
  });

  it("propage PROVIDER_ERROR sur panne réseau", async () => {
    restore = stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    await assert.rejects(
      () => getDistancesBatch(KEY, ["A"], ["B"]),
      (e: unknown) => e instanceof DistanceUnavailableError && e.causeCode === "PROVIDER_ERROR"
    );
  });

  it("ne renvoie jamais un tarif inventé : getDistancesWithFallback ne catch plus en silence", async () => {
    restore = stubFetch(() => new Response("boom", { status: 500 }));
    await assert.rejects(() => getDistancesWithFallback(KEY, ["A"], ["B"]), DistanceUnavailableError);
  });
});
