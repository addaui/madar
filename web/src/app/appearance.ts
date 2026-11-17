import { apply } from "@nuah/theme-engine";
import { useEffect, useSyncExternalStore } from "react";
import { themesOf, useDescribe, useOverrides, usePrefs } from "../api/session";
import type { Lang } from "../i18n/i18n";

export const DEFAULT_THEME = "shadcn";

const prefersDark = {
  subscribe(cb: () => void) { const m = matchMedia("(prefers-color-scheme: dark)"); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
  get: () => matchMedia("(prefers-color-scheme: dark)").matches,
};

/** The language the person chose (English unless they chose Arabic). */
export function useLang(): Lang {
  return usePrefs().language === "ar" ? "ar" : "en";
}

/** Writes the theme, density, language and direction onto <html>. It keeps something outside React (the document) in step with the person's choices. */
export function useApplyAppearance(): void {
  const describe = useDescribe();
  const prefs = usePrefs();
  const overrides = useOverrides();
  const lang = useLang();
  const dark = useSyncExternalStore(prefersDark.subscribe, prefersDark.get, () => false);
  const themes = themesOf(describe);
  const name = prefs.theme ?? DEFAULT_THEME;
  const preset = (themes.find((t) => t.id === "@nuah/theme-" + name || t.id === name) ?? themes.find((t) => t.id === "@nuah/theme-" + DEFAULT_THEME) ?? themes[0])?.tokens;

  useEffect(() => {
    if (preset) apply(preset, overrides, prefs.scheme, lang === "ar");
  }, [preset, overrides, prefs.scheme, lang, dark]);

  useEffect(() => {
    const root = document.documentElement;
    root.lang = lang;
    root.dir = lang === "ar" ? "rtl" : "ltr";
    root.dataset.density = prefs.density ?? "comfortable";
    if (prefs.avatar_color) root.style.setProperty("--avatar", prefs.avatar_color); else root.style.removeProperty("--avatar");
  }, [lang, prefs.density, prefs.avatar_color]);
}
