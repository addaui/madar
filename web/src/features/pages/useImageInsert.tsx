import { useState } from "react";
import { useHasOp } from "../../api/session";
import { link } from "../../api/link";
import { useT } from "../../i18n/i18n";
import { uploadFile } from "../../lib/upload";
import { Button } from "../../ui/Button";
import { FileDrop } from "../../ui/FileDrop";
import { TextField } from "../../ui/Field";
import { Icon } from "../../ui/Icon";
import { PointPopover } from "../../ui/PointPopover";
import { toast } from "../../ui/overlays";
import type { EditorHandle, Spot } from "./PageEditor";

type Open = { kind: "pick"; at: Spot; done: (src: string | null) => void } | { kind: "paste"; at: Spot; url: string } | null;

const bytesOf = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const IMAGES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"];
const popover = "z-[80] w-[min(340px,92vw)] rounded-md border border-line-strong bg-surface p-3 shadow-2";

/**
 * Pictures in a page (ADR 0068), in four ways that end the same: a picture pasted from the clipboard, one dropped on the page (the editor draws the line
 * where it lands), the Image block's popover (drop or click to upload, or an address), and an address, which the link analyzer says is a picture or not.
 * Whatever the way, the picture is uploaded to the Core, so the page keeps its own copy. The editor only reports what happened; the interface is here.
 */
export function useImageInsert({ project, editor }: { project?: string; editor: () => EditorHandle | null }) {
  const t = useT();
  const canUpload = useHasOp("files.upload"), canAnalyze = useHasOp("links.analyze"), canFetch = useHasOp("links.fetch");
  const [open, setOpen] = useState<Open>(null);

  const send = async (file: File) => (await uploadFile(file, () => undefined, { project })).url;
  const failure = (e: unknown) => toast(e instanceof Error ? (e.message === "fileTooBig" ? t("fileTooBig") : e.message === "notAnImage" ? t("notAnImage") : e.message) : t("uploadFailed"));

  /** A picture at an address: the analyzer says it is one, the Core fetches it, and it is stored like any upload. Without the analyzer the address is used as it is. */
  const fromAddress = async (url: string) => {
    if (canAnalyze && (await link.call("links.analyze", { url })).type !== "image") throw new Error("notAnImage");
    if (!canFetch) return url;
    const f = await link.call("links.fetch", { url });
    return send(new File([bytesOf(f.data)], f.name, { type: f.content_type }));
  };

  const impl = {
    pick: (at: Spot) => new Promise<string | null>((done) => setOpen({ kind: "pick", at, done })),
    files: async (files: File[], pos: number) => {
      toast(t("sendingFile"));
      const stored = await Promise.allSettled(files.map(send));
      // later pictures go in first, at the same place, so they end up in the order they were dropped
      for (const [i, r] of [...stored.entries()].reverse()) {
        if (r.status === "fulfilled") editor()?.insert({ type: "image", attrs: { src: r.value, alt: files[i]!.name } }, pos);
        else failure(r.reason);
      }
    },
    pasted: async (url: string, at: Spot) => {
      if (!canAnalyze) return;
      const found = await link.call("links.analyze", { url }).catch(() => null);
      if (found?.type === "image") setOpen({ kind: "paste", at, url });
    },
  };
  // what the editor is given: only what this Core can do; the editor is made once, so LegacyEditor calls these through a ref that is kept current
  const stable = {
    pickImage: canUpload ? impl.pick : undefined,
    onFiles: canUpload ? (files: File[], pos: number) => void impl.files(files, pos) : undefined,
    onPasteUrl: canAnalyze && canUpload ? (url: string, at: Spot) => void impl.pasted(url, at) : undefined,
  };

  const close = () => { if (open?.kind === "pick") open.done(null); setOpen(null); };
  const view = open && (
    <PointPopover x={open.at.left} y={open.at.bottom + 6} onClose={close} className={popover} dialogLabel={open.kind === "pick" ? t("insertImage") : t("pastedImage")}>
        {open.kind === "pick"
          ? <PickImage onFile={(f) => send(f).then((u) => { open.done(u); setOpen(null); }, failure)} onUrl={(u) => fromAddress(u).then((src) => { open.done(src); setOpen(null); }, failure)} />
          : <PasteChoice url={open.url} onImage={() => void fromAddress(open.url).then((src) => { editor()?.replaceUrl(open.url, { type: "image", attrs: { src } }); setOpen(null); }, (e) => { failure(e); setOpen(null); })}
              onLink={() => { editor()?.replaceUrl(open.url, { type: "paragraph", content: [{ type: "text", text: open.url, marks: [{ type: "link", attrs: { href: open.url } }] }] }); setOpen(null); }} />}
    </PointPopover>
  );
  return { ...stable, view };
}

/** The Image block's popover: a place to drop a picture or click to choose one, and a small button that reveals an address box. */
function PickImage({ onFile, onUrl }: { onFile: (f: File) => Promise<unknown>; onUrl: (u: string) => Promise<unknown> }) {
  const t = useT();
  const [byUrl, setByUrl] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = (p: Promise<unknown>) => { setBusy(true); void p.finally(() => setBusy(false)); };
  return (
    <div className="grid gap-2.5">
      <FileDrop accept={IMAGES} label={t("dropImage")} isDisabled={busy} onFile={(f) => run(onFile(f))}>
        <Icon name="upload" className="size-6" />
        <span>{busy ? t("sendingFile") : t("dropImage")}</span>
      </FileDrop>
      {!byUrl && <Button kind="ghost" size="sm" className="justify-self-start text-[13px]" onPress={() => setByUrl(true)}>{t("insertFromUrl")}</Button>}
      {byUrl && (
        <form className="flex items-start gap-2" onSubmit={(e) => { e.preventDefault(); const v = String(new FormData(e.currentTarget).get("url") ?? "").trim(); if (/^https?:\/\//i.test(v)) run(onUrl(v)); }}>
          <TextField name="url" type="url" autoFocus isRequired inputMode="url" autoComplete="off" spellCheck={false} placeholder={t("imageUrlPh")} label={t("imageAddress")} className="min-w-0 grow" />
          <Button kind="primary" type="submit" isPending={busy}>{t("insert")}</Button>
        </form>
      )}
    </div>
  );
}

/** A pasted address that is a picture: keep it as a picture, or as the link it was. */
function PasteChoice({ url, onImage, onLink }: { url: string; onImage: () => void; onLink: () => void }) {
  const t = useT();
  return (
    <div className="grid gap-2">
      <p className="m-0 truncate text-[13px] text-muted-foreground" dir="ltr" title={url}>{url}</p>
      <div className="flex gap-2"><Button kind="primary" icon="image" onPress={onImage} autoFocus>{t("insertAsImage")}</Button><Button icon="link" onPress={onLink}>{t("insertAsLink")}</Button></div>
    </div>
  );
}
