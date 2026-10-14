import type { ExpenseCategory } from "@prisma/client";
import { ALL_CATEGORIES, CATEGORY_LABELS } from "./categories";

/**
 * A one-line expense entry ("سعادت‌آباد مصالح ۱٬۲۵۰٬۰۰۰ خرید سیمان") is parsed
 * here, as a pure function with no Telegram (or any other adapter) imports, so
 * the rules can be unit-tested and reused. The bot only renders the result.
 *
 * The parser never guesses a project: a project is recognised only when its
 * name matches a run of tokens exactly after normalisation. Everything else is
 * left to the caller, which decides whether to fall back to a remembered
 * project or to ask.
 */

export type QuickProject = { id: string; name: string };

export type QuickEntryParse =
  | { kind: "empty" }
  | { kind: "invalid-amount" }
  | {
      kind: "parsed";
      /** Null when the text carried no usable amount. */
      amount: number | null;
      project: QuickProject | null;
      category: ExpenseCategory | null;
      /**
       * Whatever is left once the amount, category and project are removed.
       * Only meaningful when an amount was found; otherwise it is null so a
       * stray greeting is never turned into a description.
       */
      description: string | null;
    };

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** Matches the bot's ceiling so the two entry paths reject the same values. */
const MAX_AMOUNT = 1_000_000_000_000_000;

/** Thousands separators accepted inside a number, Western or Persian. */
const NUMBER_SEPARATORS = /[,،٬]/g;

/** Persian ۱۲۳ and Arabic-Indic ١٢٣ are what a Persian keyboard produces. */
export function normalizeDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)));
}

/**
 * Canonical form for matching: digits to ASCII, the two common letters unified
 * (Arabic ي/ك to Persian ی/ک), ZWNJ removed, whitespace collapsed. Names that
 * differ only in those ways therefore compare equal.
 */
export function normalizeQuickText(input: string): string {
  return normalizeDigits(input)
    .replace(/\u200c/g, "")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(input: string): string[] {
  const normalized = normalizeQuickText(input);
  return normalized.length === 0 ? [] : normalized.split(" ");
}

/**
 * A token that looks like a number attempt: an optional sign, digits, and the
 * accepted separators/decimals. A match that fails `parseAmountToken` is
 * reported as an invalid amount rather than being folded into the description.
 */
function isAmountLike(token: string): boolean {
  return /^[-−–]?[0-9][0-9,،٬.]*$/.test(token);
}

function parseAmountToken(token: string): number | null {
  if (/^[-−–]/.test(token)) return null;
  const bare = token.replace(NUMBER_SEPARATORS, "");
  if (!/^\d+$/.test(bare)) return null;
  const value = Number(bare);
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_AMOUNT) {
    return null;
  }
  return value;
}

/** First index at which `phrase` appears in `tokens`, or -1. Case-insensitive. */
function findPhrase(tokens: string[], phrase: string[]): number {
  if (phrase.length === 0 || phrase.length > tokens.length) return -1;
  outer: for (let i = 0; i + phrase.length <= tokens.length; i++) {
    for (let j = 0; j < phrase.length; j++) {
      if (tokens[i + j].toLowerCase() !== phrase[j].toLowerCase()) continue outer;
    }
    return i;
  }
  return -1;
}

/** Each category's accepted spellings, longest first, as token sequences. */
const CATEGORY_PHRASES: {
  category: ExpenseCategory;
  variants: string[][];
}[] = ALL_CATEGORIES.map((category) => ({
  category,
  variants: [CATEGORY_LABELS[category], category]
    .map((value) => normalizeQuickText(value).split(" "))
    .sort((a, b) => b.length - a.length),
}));

function matchCategory(
  tokens: string[],
): { category: ExpenseCategory; index: number; length: number } | null {
  let best: { category: ExpenseCategory; index: number; length: number } | null =
    null;
  for (const { category, variants } of CATEGORY_PHRASES) {
    for (const variant of variants) {
      const index = findPhrase(tokens, variant);
      if (index === -1) continue;
      if (!best || variant.length > best.length) {
        best = { category, index, length: variant.length };
      }
    }
  }
  return best;
}

function matchProject(
  tokens: string[],
  projects: QuickProject[],
): { project: QuickProject; index: number; length: number } | null {
  let best:
    | { project: QuickProject; index: number; length: number }
    | null = null;
  for (const project of projects) {
    const phrase = normalizeQuickText(project.name).split(" ");
    const index = findPhrase(tokens, phrase);
    if (index === -1) continue;
    if (!best || phrase.length > best.length) {
      best = { project, index, length: phrase.length };
    }
  }
  return best;
}

function remove(
  tokens: string[],
  index: number,
  length: number,
): string[] {
  return [...tokens.slice(0, index), ...tokens.slice(index + length)];
}

export function parseQuickEntry(
  input: string,
  projects: QuickProject[],
): QuickEntryParse {
  let tokens = tokenize(input);
  if (tokens.length === 0) return { kind: "empty" };

  const amountIndex = tokens.findIndex(isAmountLike);
  let amount: number | null = null;
  if (amountIndex !== -1) {
    amount = parseAmountToken(tokens[amountIndex]);
    if (amount === null) return { kind: "invalid-amount" };
    tokens = remove(tokens, amountIndex, 1);
  }

  const categoryMatch = matchCategory(tokens);
  if (categoryMatch) {
    tokens = remove(tokens, categoryMatch.index, categoryMatch.length);
  }

  const projectMatch = matchProject(tokens, projects);
  if (projectMatch) {
    tokens = remove(tokens, projectMatch.index, projectMatch.length);
  }

  const leftover = tokens.join(" ").trim();

  return {
    kind: "parsed",
    amount,
    project: projectMatch?.project ?? null,
    category: categoryMatch?.category ?? null,
    // A leftover only means something when an amount anchored the entry.
    description: amount !== null && leftover.length > 0 ? leftover : null,
  };
}
