import { milliunitsBrand, type Milliunits } from "./types.js";

export function toMilliunits(value: number): Milliunits {
  return milliunitsBrand.parse(Math.round(value * 1000));
}

export function fromMilliunits(value: Milliunits): number {
  return value / 1000;
}
