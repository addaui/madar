import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { link } from "../../../api/link";
import { useHasOp } from "../../../api/session";
import { useI18n } from "../../../i18n/i18n";
import { BaseButton, Button } from "../../../ui/Button";
import { SearchField } from "../../../ui/Field";
import { Icon } from "../../../ui/Icon";
import { fetchGifs, reportSent, type Descriptor, type Gif } from "./gifs";

const PAGE = 24;

/** The provider's descriptor (ADR 0072), or null when no provider is set up. Kept for an hour: it does not change while the page is open. */
export function useGifProvider(): Descriptor | null {
  const has = useHasOp("gifs.provider");
  const q = useQuery({ queryKey: ["gifs.provider"], enabled: has, staleTime: 3_600_000, retry: false,
    queryFn: () => link.call("gifs.provider", {}) as Promise<Descriptor> });
  return q.data?.configured ? q.data : null;
}

/** GIFs from the provider, searched from the browser as the provider's terms ask: trending when the box is empty, a search after typing stops. */
export function GifTab({ provider, variant = "gifs", onPick }: { provider: Descriptor; variant?: "gifs" | "stickers"; onPick: (g: Gif) => void }) {
  const { t, lang } = useI18n();
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => { const id = setTimeout(() => setQ(text.trim()), 450); return () => clearTimeout(id); }, [text]);
  // a beta key allows few calls an hour, so an answer is reused for five minutes
  const res = useInfiniteQuery({
    queryKey: ["gifs", provider.id, variant, q, lang], staleTime: 300_000, retry: false, initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => fetchGifs(provider, variant === "stickers" ? (q ? "sticker_search" : "sticker_trending") : (q ? "search" : "trending"), { q, limit: PAGE, offset: pageParam, lang }, signal),
    getNextPageParam: (last, all) => { const n = all.reduce((s, p) => s + p.items.length, 0); return last.items.length > 0 && n < last.total ? n : undefined; },
  });
  const items = res.data?.pages.flatMap((p) => p.items) ?? [];
  const seen = new Set<string>();
  const unique = items.filter((g) => !seen.has(g.id) && (seen.add(g.id), true));
  const choose = (g: Gif) => { reportSent(g); onPick(g); };
  return (
    <div className="grid gap-2">
      <SearchField value={text} onChange={setText} label={t(variant === "stickers" ? "gifStickerSearch" : "gifSearch")} placeholder={t(variant === "stickers" ? "gifStickerSearch" : "gifSearch")} maxLength={50} />
      {res.isError ? <p className="m-0 p-2 text-[13px] text-danger">{t("gifError")}</p>
        : res.isPending ? <p className="m-0 p-2 text-[13px] text-muted-foreground">…</p>
        : unique.length === 0 ? <p className="m-0 p-2 text-[13px] text-muted-foreground">{t("gifNone")}</p>
        : (
          <div className="columns-2 gap-1.5">
            {unique.map((g) => (
              <BaseButton key={g.id} aria-label={g.title || t("sticker")} onPress={() => choose(g)} className="mb-1.5 block w-full break-inside-avoid overflow-hidden rounded-md bg-sunken hoverable">
                <img src={g.preview} alt="" width={g.width} height={g.height} loading="lazy" draggable={false} referrerPolicy="no-referrer" className="block h-auto w-full" />
              </BaseButton>
            ))}
          </div>
        )}
      {res.hasNextPage && <Button size="sm" isPending={res.isFetchingNextPage} onPress={() => void res.fetchNextPage()}>{t("loadMore")}</Button>}
      <p className="m-0 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        {provider.attribution && <a href={provider.attribution.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-text"><Icon name="link" className="size-3" />{provider.attribution.text}</a>}
        <span>{t("gifPrivacy", { name: provider.name ?? "" })}</span>
      </p>
    </div>
  );
}
