import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { Button as AriaButton, Dialog, DialogTrigger, Popover } from "react-aria-components";
import { link } from "../../api/link";
import { useI18n } from "../../i18n/i18n";
import { Emo } from "../../ui/emoji";
import { Button } from "../../ui/Button";

type Item = [emoji: string, name: string, keywords: string, group: number];
interface Catalog { groups: { key: string; name: string }[]; items: Item[] }

const FALLBACK = "📄 📝 📓 📚 📌 🗂️ 📅 📊 💡 ⭐ 🔥 ✅ 🎯 🚀 🧭 🧪 🛠️ 💻 🔒 🔑 💬 🏠 🌍 🌱 ☕ 🎨 🎵 📷 🧠 ❤️ 🤝 📦 💰 ✈️ ⚙️ 🔍".split(" ");
const RECENT = "madar.emoji.recent";
const recent = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT) ?? "[]") as string[]; } catch { return []; } };
const remember = (e: string) => { try { localStorage.setItem(RECENT, JSON.stringify([e, ...recent().filter((x) => x !== e)].slice(0, 18))); } catch { /* not kept */ } };

/** A page icon is one emoji (the Core refuses a longer one), so what is typed or pasted is cut to its first character. */
const firstEmoji = (s: string): string => {
  s = s.trim(); if (!s) return "";
  for (const g of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)) return g.segment;
  return "";
};

/** Every word typed must start a word of the emoji's name or keywords; names that start with the query come first. */
export function searchEmoji(items: Item[], q: string): Item[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return items
    .filter((it) => { const hay = (it[1] + " " + it[2]).toLowerCase().split(/\s+/); return words.every((w) => hay.some((h) => h.startsWith(w))); })
    .sort((a, b) => Number(!a[1].toLowerCase().startsWith(words[0]!)) - Number(!b[1].toLowerCase().startsWith(words[0]!)));
}

/** The icon of a page: a button that opens a picker with search, groups and recents. */
export function IconPicker({ icon, fallback, onPick, disabled }: { icon: string | null; fallback: string; onPick: (e: string | null) => void; disabled?: boolean }) {
  const { t, lang } = useI18n();
  const [q, setQ] = useState("");
  const deferred = useDeferredValue(q.trim());
  const cat = useQuery({ queryKey: ["emoji.catalog", { lang }], queryFn: () => link.call("emoji.catalog" as never, { lang } as never) as Promise<Catalog>, staleTime: Infinity, retry: false });
  const data: Catalog = cat.data ?? { groups: [{ key: "all", name: "" }], items: FALLBACK.map((e) => [e, "", "", 0] as Item) };
  const typed = /^[^\p{L}\p{N}\s]/u.test(deferred) ? firstEmoji(deferred) : "";
  const found = deferred ? searchEmoji(data.items, deferred).slice(0, 120) : [];
  const cell = (e: string, name?: string, close?: () => void) => <button key={e + (name ?? "")} type="button" title={name} aria-label={name || e} onClick={() => { remember(e); onPick(e); close?.(); }} className="grid size-9 place-items-center rounded-md text-[22px] hover:bg-hover"><Emo ch={e} /></button>;

  return (
    <DialogTrigger>
      <AriaButton isDisabled={disabled} aria-label={t("pickIcon")} className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-surface text-[21px] shadow-[0_0_0_1px_color-mix(in_srgb,var(--text)_14%,transparent)] outline-none hover:shadow-2 data-[focus-visible]:outline-2 data-[focus-visible]:outline-accent"><Emo ch={icon ?? fallback} /></AriaButton>
      <Popover placement="bottom start" className="w-[340px] rounded-md border border-line-strong bg-surface p-2.5 shadow-2">
        <Dialog aria-label={t("pickIcon")} className="outline-none">
          {({ close }) => (
            <div>
              <input autoFocus type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchEmoji")} aria-label={t("searchEmoji")} maxLength={60} autoComplete="off" className="field mb-2 w-full"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const f = typed || found[0]?.[0]; if (f) { remember(f); onPick(f); close(); } } }} />
              <div className="max-h-[300px] min-h-[200px] overflow-auto">
                {deferred ? (
                  <div className="flex flex-wrap">{typed && cell(typed, undefined, close)}{found.map((it) => cell(it[0], it[1], close))}{!typed && found.length === 0 && <p className="p-2 text-muted">{t("noEmojiFound")}</p>}</div>
                ) : (
                  <>
                    {recent().length > 0 && <section><h4 className="m-0 px-1 py-1 text-xs font-semibold text-muted">{t("recentEmoji")}</h4><div className="flex flex-wrap">{recent().map((e) => cell(e, undefined, close))}</div></section>}
                    {data.groups.map((g, i) => (
                      <section key={g.key}>{g.name && <h4 className="m-0 px-1 py-1 text-xs font-semibold text-muted">{g.name}</h4>}<div className="flex flex-wrap">{data.items.filter((it) => (it[3] || 0) === i).map((it) => cell(it[0], it[1], close))}</div></section>
                    ))}
                  </>
                )}
              </div>
              {icon && <div className="mt-2"><Button kind="ghost" size="sm" icon="trash" onClick={() => { onPick(null); close(); }}>{t("removeIcon")}</Button></div>}
            </div>
          )}
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}

