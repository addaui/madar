import { twMerge } from "tailwind-merge";

/** Joins class names (falsy ones dropped) and lets the later utility win over an earlier conflicting one. */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return twMerge(parts.filter(Boolean).join(" "));
}
