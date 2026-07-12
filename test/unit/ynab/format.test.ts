import { describe, expect, it } from "vitest";
import { fromMilliunits, toMilliunits } from "../../../src/ynab/format.js";

describe("toMilliunits", () => {
  it("converts a positive dollar amount", () => {
    expect(toMilliunits(12.34)).toBe(12340);
  });

  it("converts a negative dollar amount", () => {
    expect(toMilliunits(-12.34)).toBe(-12340);
  });

  it("rounds to avoid floating point drift", () => {
    expect(toMilliunits(0.1 + 0.2)).toBe(300);
  });
});

describe("fromMilliunits", () => {
  it("converts milliunits back to a decimal amount", () => {
    expect(fromMilliunits(toMilliunits(12.34))).toBeCloseTo(12.34);
  });

  it("round-trips through toMilliunits", () => {
    expect(fromMilliunits(toMilliunits(50))).toBe(50);
  });
});
