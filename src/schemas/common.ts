import { z } from "zod";

export const budgetIdSchema = z
  .string()
  .min(1)
  .describe('YNAB budget id, or "last-used" for the most recently used budget');

export const milliunitsSchema = z
  .number()
  .int()
  .describe(
    "Amount in milliunits (1000 = 1.00 in the budget's currency). Positive = inflow, negative = outflow for transactions.",
  );

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("ISO 8601 date, e.g. 2026-07-01");

export const confirmSchema = z
  .literal(true)
  .describe("Must be explicitly set to true to confirm this destructive action");
