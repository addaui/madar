import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { link } from "../../api/link";
import { useI18n } from "../../i18n/i18n";
import { BaseButton } from "../../ui/Button";
import { SearchField } from "../../ui/Field";
import { Emo } from "../../ui/emoji";
import { SkeletonLines } from "../../ui/Skeleton";

export type Item = [emoji: string, name: string, keywords: string, group: number];
interface Catalog { groups: { key: string; name: string }[]; items: Item[] }

const FALLBACK = "📄 📝 📓 📚 📌 🗂️ 📅 📊 💡 ⭐ 🔥 ✅ 🎯 🚀 🧭 🧪 🛠️ 💻 🔒 🔑 💬 🏠 🌍 🌱 ☕ 🎨 🎵 📷 🧠 ❤️ 🤝 📦 💰 ✈️ ⚙️ 🔍".split(" ");
const RECENT = "madar.emoji.recent";
const recent = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT) ?? "[]") as string[]; } catch { return []; } };
export const rememberEmoji = (e: string) => { try { localStorage.setItem(RECENT, JSON.stringify([e, ...recent().filter((x) => x !== e)].slice(0, 18))); } catch { /* not kept */ } };

/** A page icon is one emoji (the Core refuses a longer one), so what is typed or pasted is cut to its first character. */
export const firstEmoji = (s: string): string => {
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

/** Search, recents and the groups of the emoji catalog, in a scrolling area. One emoji is chosen with `onPick`. Used by the page icon and by stickers. */
export function EmojiGrid({ onPick, tall = false }: { onPick: (emoji: string) => void; tall?: boolean }) {
  const { t, lang } = useI18n();
  const [q, setQ] = useState("");
  const deferred = useDeferredValue(q.trim());
  const cat = useQuery({ queryKey: ["emoji.catalog", { lang }], queryFn: () => link.call("emoji.catalog" as never, { lang } as never) as Promise<Catalog>, staleTime: Infinity, retry: false });
  const data: Catalog = cat.data ?? { groups: [{ key: "all", name: "" }], items: FALLBACK.map((e) => [e, "", "", 0] as Item) };
  const typed = /^[^\p{L}\p{N}\s]/u.test(deferred) ? firstEmoji(deferred) : "";
  const found = deferred ? searchEmoji(data.items, deferred).slice(0, 120) : [];
  const pick = (e: string) => { rememberEmoji(e); onPick(e); };
  const cell = (e: string, name?: string) => <BaseButton key={e + (name ?? "")} aria-label={name || e} onPress={() => pick(e)} className="grid size-9 place-items-center rounded-md text-[22px] hoverable"><Emo ch={e} /></BaseButton>;
  return (
    <div>
      <SearchField autoFocus value={q} onChange={setQ} placeholder={t("searchEmoji")} label={t("searchEmoji")} maxLength={60} className="mb-2"
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const f = typed || found[0]?.[0]; if (f) pick(f); } }} />
      <div data-emoji-scroll className={tall ? "h-[300px] overflow-auto" : "max-h-[300px] min-h-[200px] overflow-auto"}>
        {cat.isPending ? <SkeletonLines rows={6} className="p-1" /> : deferred ? (
          <div className="flex flex-wrap">{typed && cell(typed)}{found.map((it) => cell(it[0], it[1]))}{!typed && found.length === 0 && <p className="p-2 text-muted">{t("noEmojiFound")}</p>}</div>
        ) : (
          <>
            {recent().length > 0 && <section><h4 className="m-0 px-1 py-1 text-xs font-semibold text-muted">{t("recentEmoji")}</h4><div className="flex flex-wrap">{recent().map((e) => cell(e))}</div></section>}
            {data.groups.map((g, i) => (
              <section key={g.key}>{g.name && <h4 className="m-0 px-1 py-1 text-xs font-semibold text-muted">{g.name}</h4>}<LazyCells count={data.items.filter((it) => (it[3] || 0) === i).length}>{data.items.filter((it) => (it[3] || 0) === i).map((it) => cell(it[0], it[1]))}</LazyCells></section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

const CELL = 36, PER_ROW = 8;

/** A group's emoji are made only when the group nears the scrolling window, so opening the picker draws the first screenful, not the whole catalog. Until then the group keeps its height, so the scrollbar does not jump. */
function LazyCells({ count, children }: { count: number; children: React.ReactNode }) {
  const [near, setNear] = useState(false);
  return (
    <div className="flex flex-wrap"
      ref={(el) => {
        if (!el || near) return;
        el.style.minHeight = Math.ceil(count / PER_ROW) * CELL + "px";
        const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { setNear(true); io.disconnect(); } }, { root: el.closest("[data-emoji-scroll]"), rootMargin: "240px" });
        io.observe(el);
        return () => io.disconnect();
      }}>
      {near ? children : null}
    </div>
  );
}
