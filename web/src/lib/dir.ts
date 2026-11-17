import { useState } from "react";

/** The direction of the page itself (set from the person's language). */
export const pageDir = (): "ltr" | "rtl" => (document.documentElement.dir === "rtl" ? "rtl" : "ltr");

/** Whether a text has a letter that says which way it reads. */
export const hasStrong = (s: string) => /\p{L}/u.test(s);

/**
 * `dir="auto"` reads the direction from the first letter, and an empty field has none, so its placeholder came out left to right on an Arabic page.
 * Until a letter is typed the field takes the page's direction; after that it follows its own text.
 */
export function useAutoDir(dir: "auto" | "ltr" | "rtl" | undefined, value: string | undefined, defaultValue: string | undefined) {
  const [own, setOwn] = useState(defaultValue ?? "");
  const text = value ?? own;
  return { dir: dir === "auto" && !hasStrong(text) ? pageDir() : dir, track: setOwn };
}
