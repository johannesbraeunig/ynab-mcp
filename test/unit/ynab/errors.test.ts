import { describe, expect, it } from "vitest";
import { mapYnabError, YnabToolError } from "../../../src/ynab/errors.js";

function ynabError(id: string, name: string, detail: string) {
  return { error: { id, name, detail } };
}

describe("mapYnabError", () => {
  it("maps 401 to an invalid-token message without leaking the raw detail", () => {
    const result = mapYnabError(ynabError("401", "not_authorized", "Unauthorized"));
    expect(result).toBeInstanceOf(YnabToolError);
    expect(result.code).toBe("401");
    expect(result.retryable).toBe(false);
    expect(result.message).toMatch(/YNAB_ACCESS_TOKEN/);
  });

  it("maps 404 to a not-found message", () => {
    const result = mapYnabError(ynabError("404", "not_found", "not found"));
    expect(result.code).toBe("404");
    expect(result.message).toMatch(/No budget\/account\/category\/transaction found/);
  });

  it("maps 429 to a rate-limit message and marks it retryable", () => {
    const result = mapYnabError(ynabError("429", "too_many_requests", "slow down"));
    expect(result.code).toBe("429");
    expect(result.retryable).toBe(true);
    expect(result.message).toMatch(/rate limit/);
  });

  it("passes through the detail for unmapped error ids", () => {
    const result = mapYnabError(ynabError("403", "forbidden", "subscription lapsed"));
    expect(result.message).toBe("subscription lapsed");
  });

  it("wraps a network Error", () => {
    const result = mapYnabError(new Error("fetch failed"));
    expect(result.code).toBe("network_error");
    expect(result.retryable).toBe(true);
    expect(result.message).toMatch(/fetch failed/);
  });

  it("falls back to a generic message for unknown thrown values", () => {
    const result = mapYnabError("not an object");
    expect(result.code).toBe("unknown_error");
  });

  it("falls back to a generic message rather than an empty one for a malformed error body", () => {
    const result = mapYnabError({ error: { id: "500", name: "server_error" } });
    expect(result.code).toBe("unknown_error");
    expect(result.message.length).toBeGreaterThan(0);
  });
});
