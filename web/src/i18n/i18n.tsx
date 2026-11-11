import { createContext, use, type ReactNode } from "react";
import { ar } from "./ar";
import { en } from "./en";

export type Lang = "en" | "ar";
export type Key = keyof typeof en;
export type Params = Record<string, string | number>;

const words: Record<Lang, Record<string, string>> = { en, ar };

/** "{actor} created {name}" with the parameters filled in. A missing word falls back to English, then to the key. */
export function translate(lang: Lang, key: string, params?: Params): string {
  const text = words[lang][key] ?? en[key as Key] ?? key;
  return params ? text.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`)) : text;
}

export interface I18n {
  lang: Lang;
  dir: "ltr" | "rtl";
  t: (key: Key, params?: Params) => string;
}

export const makeI18n = (lang: Lang): I18n => ({ lang, dir: lang === "ar" ? "rtl" : "ltr", t: (key, params) => translate(lang, key, params) });

const I18nContext = createContext<I18n>(makeI18n("en"));

export function I18nProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  return <I18nContext value={makeI18n(lang)}>{children}</I18nContext>;
}

/** The words and direction of the current language. */
export const useI18n = (): I18n => use(I18nContext);
export const useT = (): I18n["t"] => use(I18nContext).t;
