import { ExpenseCategory } from "@prisma/client";

/** Persian labels for each expense category, used by every channel adapter. */
export const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  MATERIALS: "مصالح",
  WORKER_FOOD: "غذای کارگران",
  TRANSPORT: "حمل‌ونقل",
  WAGES: "دستمزد",
  TOOLS: "ابزار",
  OTHER: "سایر",
};

export const ALL_CATEGORIES = Object.keys(CATEGORY_LABELS) as ExpenseCategory[];

export function categoryLabel(category: ExpenseCategory): string {
  return CATEGORY_LABELS[category];
}

/** Accepts either the English enum key or the Persian label. */
export function parseCategory(input: string): ExpenseCategory | null {
  const normalized = input.trim();
  const byKey = ALL_CATEGORIES.find(
    (c) => c.toLowerCase() === normalized.toLowerCase(),
  );
  if (byKey) return byKey;

  const byLabel = ALL_CATEGORIES.find((c) => CATEGORY_LABELS[c] === normalized);
  return byLabel ?? null;
}