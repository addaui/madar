import { Emo } from "../../../ui/emoji";
import type { Sticker } from "./model";
import { PACK } from "./pack";

/** What a sticker looks like: an emoji (sized by its box), one of the shapes made for Madar, or an uploaded picture or GIF. It fills whatever box it is given. */
export function StickerArt({ s, onSize }: { s: Pick<Sticker, "kind" | "value">; onSize?: (aspect: number) => void }) {
  if (s.kind === "emoji") return <span className="sticker-emoji"><Emo ch={s.value} /></span>;
  if (s.kind === "pack") return <>{PACK.find((p) => p.id === s.value)?.draw() ?? null}</>;
  return <img src={s.value} alt="" draggable={false} className="size-full object-contain" onLoad={(e) => { const i = e.currentTarget; if (onSize && i.naturalWidth) onSize(i.naturalHeight / i.naturalWidth); }} />;
}
