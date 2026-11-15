import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { link } from "../../../api/link";
import { useHasOp } from "../../../api/session";
import { useT } from "../../../i18n/i18n";
import { uploadFile } from "../../../lib/upload";
import { BaseButton } from "../../../ui/Button";
import { FileDrop } from "../../../ui/FileDrop";
import { Icon } from "../../../ui/Icon";
import { PointPopover } from "../../../ui/PointPopover";
import { Tabs } from "../../../ui/Tabs";
import { toast } from "../../../ui/overlays";
import { EmojiGrid } from "../EmojiGrid";
import type { StickerKind } from "./model";
import { PACK } from "./pack";
import { GifTab, useGifProvider } from "./GifTab";

export interface Choice { kind: StickerKind; value: string }
interface Upload { id: string; name: string; type: string; url: string }

const ACCEPT = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"];
type Tab = "emoji" | "stickers" | "gifs" | "upload";

/**
 * The sticker picker (ADR 0071), laid out like a chat's: Emoji, Stickers (the shapes made for Madar), GIFs and Upload. The last two show the pictures
 * uploaded in this space only, with a place to add one; a picture just uploaded is chosen at once.
 */
export function StickerPicker({ x, y, project, onPick, onClose }: { x: number; y: number; project?: string; onPick: (c: Choice) => void; onClose: () => void }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("emoji");
  const canList = useHasOp("files.list"), canUpload = useHasOp("files.upload");
  const qc = useQueryClient();
  const uploads = useQuery({ queryKey: ["files.list", { project: project ?? null }], enabled: canList && (tab === "gifs" || tab === "upload"), staleTime: 15_000,
    queryFn: () => link.call("files.list", { ...(project ? { project } : {}), limit: 100 }) as Promise<{ files: Upload[] }> });
  const provider = useGifProvider();
  const [busy, setBusy] = useState(false);
  const files = uploads.data?.files ?? [];

  const send = async (f: File) => {
    setBusy(true);
    try {
      const stored = await uploadFile(f, () => undefined, { project });
      void qc.invalidateQueries({ queryKey: ["files.list"] });
      onPick({ kind: "image", value: stored.url });
    } catch (e) { toast(e instanceof Error && e.message === "fileTooBig" ? t("fileTooBig") : t("uploadFailed")); }
    finally { setBusy(false); }
  };
  const tabs = [{ id: "emoji", label: t("tabEmoji") }, { id: "stickers", label: t("tabStickers") }, { id: "gifs", label: t("tabGifs") }, { id: "upload", label: t("tabUpload") }];
  const gifs = files.filter((f) => f.type === "image/gif");
  const grid = (items: Upload[], empty: string) => items.length === 0
    ? <p className="m-0 p-2 text-[13px] text-muted">{uploads.isPending && canList ? "…" : empty}</p>
    : <div className="grid grid-cols-4 gap-1.5">{items.map((f) => (
        <BaseButton key={f.id} aria-label={f.name} onPress={() => onPick({ kind: "image", value: f.url })} className="grid aspect-square place-items-center overflow-hidden rounded-md bg-sunken hoverable">
          <img src={f.url} alt="" draggable={false} loading="lazy" className="size-full object-contain" />
        </BaseButton>))}</div>;
  const drop = canUpload && (
    <FileDrop accept={ACCEPT} label={t("dropPicture")} isDisabled={busy} onFile={(f) => void send(f)} className="mb-2">
      <Icon name="upload" className="size-5" /><span className="text-[13px]">{busy ? t("sendingFile") : t("dropPicture")}</span>
    </FileDrop>
  );

  return (
    <PointPopover x={x} y={y + 6} onClose={onClose} dialogLabel={t("addSticker")} className="z-[80] w-[min(360px,94vw)] rounded-md border border-line-strong bg-surface p-2.5 shadow-2">
      <Tabs variant="compact" label={t("addSticker")} selected={tab} onSelect={(k) => setTab(k as Tab)} items={tabs} panelClassName="pt-2.5">
        <div className="h-[348px] overflow-auto">
          {tab === "emoji" && <EmojiGrid tall onPick={(e) => onPick({ kind: "emoji", value: e })} />}
          {tab === "stickers" && (
            <>
              {provider?.sticker_search && <GifTab provider={provider} variant="stickers" onPick={(g) => onPick({ kind: "gif", value: g.url })} />}
              <h4 className="m-0 px-1 pb-1.5 pt-2 text-xs font-semibold text-muted">{t("stickerPacks")}</h4>
              <div className="grid grid-cols-4 gap-1.5">{PACK.map((p) => (
                <BaseButton key={p.id} aria-label={p.label} onPress={() => onPick({ kind: "pack", value: p.id })} className="grid aspect-square place-items-center rounded-md p-2 hoverable">{p.draw()}</BaseButton>))}</div>
            </>
          )}
          {tab === "gifs" && (
            <>
              {provider && <GifTab provider={provider} onPick={(g) => onPick({ kind: "gif", value: g.url })} />}
              {(gifs.length > 0 || !provider) && <h4 className="m-0 px-1 pb-1.5 pt-2 text-xs font-semibold text-muted">{t("uploadedHere")}</h4>}
              {drop}{(gifs.length > 0 || !provider) && grid(gifs, t("noGifs"))}
            </>
          )}
          {tab === "upload" && <>{drop}<h4 className="m-0 px-1 pb-1.5 text-xs font-semibold text-muted">{t("uploadedHere")}</h4>{grid(files, t("noUploads"))}</>}
        </div>
      </Tabs>
    </PointPopover>
  );
}
