import { useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "../../../i18n/i18n";
import type { MenuEntries } from "../../../ui/Menu";
import { openContextMenu } from "../../../ui/overlays";
import type { EditorHandle } from "../LegacyEditor";
import {
  addSticker, bringForward, bringToFront, remove, replace, sendBackward, sendToBack, setBehind, type Narrow, type Sticker,
} from "./model";
import { StickerLayer } from "./StickerLayer";
import { placementOf, resolvePlacement } from "./resolve";
import { StickerPicker, type Choice } from "./StickerPicker";
import { stickerStore, useStickerState } from "./store";
import { anchorTop, measure } from "./measure";

/** The width a new sticker starts with, as a fraction of the column. */
const START_W = { emoji: 0.14, pack: 0.16, image: 0.24 } as const;
const SIZES: [string, number][] = [["sizeSmall", 0.09], ["sizeMedium", 0.16], ["sizeLarge", 0.3]];

/**
 * Stickers on one page (ADR 0071): ties the editor (which keeps the list in the document and gives the two layers) to the layer that draws them, the
 * picker that makes them, and the store the sidebar's list reads. `editor` goes to the editor's options; `view` is rendered next to it.
 */
export function useStickers({ project, editable, handle }: { project?: string; editable: boolean; handle: () => EditorHandle | null }) {
  const t = useT();
  const tNow = useRef(t);
  const [layers, setLayers] = useState<{ back: HTMLElement; front: HTMLElement } | null>(null);
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const layoutFn = useRef<(() => void) | null>(null);
  const { list, selected } = useStickerState();
  const latest = useRef({ list, selected, layers });
  useEffect(() => { tNow.current = t; latest.current = { list, selected, layers }; });

  const select = (id: string | null) => stickerStore.set({ selected: id });
  const apply = (change: (l: Sticker[]) => Sticker[]) => { const h = handle(); if (h) h.setStickers(change(h.stickers() as Sticker[])); };

  /** A sticker's own position, moved to another anchor (a block, or the page) without moving it on screen. */
  const reanchor = (s: Sticker, to: "page" | "text"): Sticker => {
    const front = latest.current.layers?.front, h = handle();
    if (!front || !h) return s;
    const m = measure(front), a = anchorTop(front, s.anchor, m.rect) ?? 0, box = resolvePlacement(s, { ...m, anchorTop: a, aspect: 1 });
    if (to === "page") return { ...s, anchor: null, y: box.top / m.em };
    const b = h.blockAt(m.rect.left + (m.rtl ? m.width - box.start - box.width / 2 : box.start + box.width / 2), m.rect.top + box.top + box.height / 2);
    if (!b) return s;
    const na = anchorTop(front, b.id, m.rect) ?? 0;
    return { ...s, anchor: b.id, y: (box.top - na) / m.em };
  };

  const entries = (id: string): MenuEntries => {
    const s = latest.current.list.find((x) => x.id === id), T = tNow.current;
    if (!s) return [];
    const set = (p: Partial<Sticker>) => apply((l) => replace(l, id, p));
    const fit = (how: Narrow, label: Parameters<typeof T>[0]) => ({ label: T(label), checked: (s.narrow ?? "hug") === how, onclick: () => set({ narrow: how }) });
    return [
      { label: T("order"), icon: "layers", sub: () => [
        { label: T("layerFront"), onclick: () => apply((l) => bringToFront(l, id)) }, { label: T("layerForward"), onclick: () => apply((l) => bringForward(l, id)) },
        { label: T("layerBackward"), onclick: () => apply((l) => sendBackward(l, id)) }, { label: T("layerBack"), onclick: () => apply((l) => sendToBack(l, id)) }] },
      { label: s.behind ? T("inFrontOfText") : T("behindText"), icon: "layers", onclick: () => apply((l) => setBehind(l, id, !s.behind)) },
      { label: s.anchor === null ? T("attachToText") : T("pinToPage"), icon: "pin", onclick: () => apply((l) => l.map((x) => (x.id === id ? reanchor(x, s.anchor === null ? "text" : "page") : x))) },
      "-",
      { label: T("stickerSize"), icon: "scale", sub: () => SIZES.map(([k, w]) => ({ label: T(k as "sizeSmall"), checked: Math.abs(s.w - w) < 0.005, onclick: () => set({ w }) })) },
      { label: T("flipSticker"), icon: "flip", checked: !!s.flip, onclick: () => set({ flip: !s.flip }) },
      { label: T("rotate90"), icon: "rotate", onclick: () => set({ rot: ((s.rot + 90 + 180) % 360) - 180 }) },
      { label: T("noRoom"), icon: "fit", sub: () => [fit("hug", "noRoomHug"), fit("shrink", "noRoomShrink"), fit("hide", "noRoomHide")] },
      "-",
      { label: s.lock ? T("unlockSticker") : T("lockSticker"), icon: s.lock ? "unlock" : "lock", onclick: () => set({ lock: !s.lock }) },
      { label: s.hidden ? T("showSticker") : T("hideSticker"), icon: s.hidden ? "eye" : "eyeOff", onclick: () => set({ hidden: !s.hidden }) },
      { label: T("duplicateSticker"), icon: "copy", onclick: () => apply((l) => { const rest: Partial<Sticker> = { ...s }; delete rest.z; delete rest.id; return addSticker(l, { ...(rest as Omit<Sticker, "z" | "id">), x: s.x + 0.03, y: s.y + 0.5 }); }) },
      "-",
      { label: T("deleteSticker"), icon: "trash", danger: true, onclick: () => { apply((l) => remove(l, id)); select(null); } },
    ];
  };

  const openMenu = (s: Sticker, x: number, y: number) => openContextMenu(x, y, entries(s.id));

  /** Makes the chosen sticker where the pointer was: attached to the block there, centred on the point. */
  const place = (c: Choice, at: { x: number; y: number }) => {
    const front = latest.current.layers?.front, h = handle();
    setPicker(null);
    if (!front || !h) return;
    const m = measure(front), b = h.blockAt(at.x, at.y), a = b ? anchorTop(front, b.id, m.rect) ?? 0 : 0;
    const w = START_W[c.kind], width = Math.max(w * m.width, 56);
    const px = at.x - m.rect.left, start = (m.rtl ? m.width - px : px) - width / 2, top = at.y - m.rect.top - width / 2;
    const p = placementOf({ ...m, anchorTop: b ? a : 0, aspect: 1 }, { start, top, width });
    const next = addSticker(h.stickers() as Sticker[], { kind: c.kind, value: c.value, anchor: b?.id ?? null, x: p.x, y: p.y, w: p.w, rot: 0 });
    h.setStickers(next);
    select(next[next.length - 1]!.id);
  };

  // what the sidebar's list can do
  useEffect(() => {
    const addAtCenter = () => {
      const front = latest.current.layers?.front;
      const sc = front?.closest<HTMLElement>(".page-scroll")?.getBoundingClientRect();
      if (sc) setPicker({ x: sc.left + sc.width / 2, y: sc.top + sc.height / 2 });
    };
    stickerStore.set({ control: { apply, addAtCenter, entries }, editable });
    return () => stickerStore.set({ list: [], selected: null, control: null, editable: false });
    // `apply` and `entries` only read refs, so they need not be listed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable]);

  const options = {
    onList: (l: unknown[]) => stickerStore.set({ list: l as Sticker[] }),
    onLayers: (l: { back: HTMLElement; front: HTMLElement }) => setLayers(l),
    onLayout: () => layoutFn.current?.(),
    menu: (x: number, y: number) => (editable ? [{ label: tNow.current("addSticker"), icon: "sticker", onclick: () => setPicker({ x, y }) }] : []),
  };
  const onLayout = (again: (() => void) | null) => { layoutFn.current = again; };

  const bridge = { blockAt: (x: number, y: number) => handle()?.blockAt(x, y) ?? null };
  const view: ReactNode = (
    <>
      {layers && <StickerLayer back={layers.back} front={layers.front} bridge={bridge} list={list} selected={selected} editable={editable} select={select}
        change={(next) => apply(() => next)} openMenu={openMenu} onLayout={onLayout} />}
      {picker && <StickerPicker x={picker.x} y={picker.y} project={project} onClose={() => setPicker(null)} onPick={(c) => place(c, picker)} />}
    </>
  );
  return { options, view };
}
