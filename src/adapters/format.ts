import { MAX_DESCRIPTION_LENGTH } from "@/core/expenses/schemas";

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** Well below Number.MAX_SAFE_INTEGER, so bigint conversion stays lossless. */
const MAX_AMOUNT = 1_000_000_000_000_000;

const THOUSANDS_SEPARATORS = /[,،٬\s ]/g;

/**
 * Persian-keyboard users type ۱۲۳ not 123, so every numeric string coming off a
 * keyboard is normalized before it is compared.
 */
export function normalizeDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)));
}

/**
 * Accepts free-form amount text and returns whole Toman, or null when the input
 * is not a positive integer. Thousands separators (",", "،", "٬", spaces) are
 * ignored; anything else — signs, decimals, words, empty — is rejected so the
 * user is re-prompted rather than silently rounded.
 */
export function parseAmount(input: string): number | null {
  const normalized = normalizeDigits(input).replace(THOUSANDS_SEPARATORS, "");
  if (!/^\d+$/.test(normalized)) return null;

  const value = Number(normalized);
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_AMOUNT) {
    return null;
  }
  return value;
}

/** `1250000` -> `1,250,000`, so confirmations match the paper invoice. */
export function formatAmount(value: number | bigint): string {
  return BigInt(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Accepts free-form description text and returns it trimmed, or null when it
 * is over the limit the core schema enforces. The limit is shared with
 * `createExpenseSchema` so the bot can re-prompt on an over-long note instead
 * of letting the write fail later on.
 *
 * An empty string is a valid answer and means "no description", which is what
 * the step produces when the user only sends whitespace.
 */
export function parseDescription(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length > MAX_DESCRIPTION_LENGTH) return null;
  return trimmed;
}
