import { describe, expect, it } from "vitest";
import { withYnabErrorHandling } from "../../../src/tools/helpers.js";

describe("withYnabErrorHandling", () => {
  it("appends retry guidance for a retryable (429) error", async () => {
    const result = await withYnabErrorHandling(async () => {
      throw { error: { id: "429", name: "too_many_requests", detail: "slow down" } };
    });
    expect(result.isError).toBe(true);
    const text = (result.content as { type: "text"; text: string }[])[0]?.text;
    expect(text).toMatch(/rate limit/);
    expect(text).toMatch(/wait before retrying/);
  });

  it("appends non-retry guidance for a non-retryable (401) error", async () => {
    const result = await withYnabErrorHandling(async () => {
      throw { error: { id: "401", name: "not_authorized", detail: "Unauthorized" } };
    });
    expect(result.isError).toBe(true);
    const text = (result.content as { type: "text"; text: string }[])[0]?.text;
    expect(text).toMatch(/YNAB_ACCESS_TOKEN/);
    expect(text).toMatch(/Retrying the same call will not help/);
  });

  it("passes through a successful result unchanged", async () => {
    const result = await withYnabErrorHandling(async () => ({
      content: [{ type: "text" as const, text: "ok" }],
    }));
    expect(result.isError).toBeUndefined();
    expect((result.content as { type: "text"; text: string }[])[0]?.text).toBe("ok");
  });
});
