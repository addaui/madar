import { useI18n } from "../i18n/i18n";
import { usePrefs } from "../api/session";

/** Dates as the person wants to read them: Gregorian, Hijri, or both (the calendar preference), in their language. */
export function useDateFormat() {
  const { lang } = useI18n();
  const calendar = usePrefs().calendar ?? "gregory";
  const locale = lang === "ar" ? "ar" : "en";
  const fmt = (cal: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(`${locale}-u-ca-${cal}`, o);
  const text = (d: Date, o: Intl.DateTimeFormatOptions) =>
    calendar === "both" ? `${fmt("gregory", o).format(d)} · ${fmt("islamic-umalqura", o).format(d)}` : fmt(calendar === "hijri" ? "islamic-umalqura" : "gregory", o).format(d);
  return {
    date: (iso: string | null | undefined) => (iso ? text(new Date(iso + "T00:00:00"), { dateStyle: "full" }) : ""),
    short: (iso: string | null | undefined) => (iso ? text(new Date(iso + "T00:00:00"), { day: "numeric", month: "short" }) : ""),
    time: (ms: number) => text(new Date(ms), { dateStyle: "medium", timeStyle: "short" }),
    relative: (iso: string, today: string) => {
      const n = Math.round((Date.parse(iso) - Date.parse(today)) / 864e5);
      return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(n, "day");
    },
  };
}

/** Today's date where the person is, as "YYYY-MM-DD" (what a due date is written as). Not `toISOString`, which is the date in UTC and so says "yesterday" or "tomorrow" for hours of every day. */
export function todayLocal(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
