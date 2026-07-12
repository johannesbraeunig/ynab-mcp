import { z } from "zod";

/**
 * Amounts in milliunits (1000 = 1.00 in the budget's currency). Branded via
 * zod so a raw dollar amount can't be passed where the YNAB API expects
 * milliunits without going through toMilliunits()/fromMilliunits() below.
 */
export const milliunitsBrand = z.number().int().brand<"Milliunits">();
export type Milliunits = z.infer<typeof milliunitsBrand>;
