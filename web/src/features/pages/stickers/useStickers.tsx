import { useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "../../../i18n/i18n";
import type { MenuEntries } from "../../../ui/Menu";
import { openContextMenu } from "../../../ui/overlays";
import type { EditorHandle } from "../LegacyEditor";
import {
  addSticker, applyIn, classOf, effective, resetClass, bringForward, bringToFront, remove, sendBackward, sendToBack, setBehind, type Narrow, type Sticker,
} from "./model";
import { StickerLayer } from "./StickerLayer";
import { placementOf, resolvePlacement, type WrapSpec } from "./resolve";
import { StickerPicker, type Choice } from "./StickerPicker";
import { stickerStore, useStickerState } from "./store";
import { anchorTop, measure, refTop, textBoxOf } from "./measure";

/** The width a new sticker starts with, as a fraction of the column. */
const START_W = { emoji: 0.14, pack: 0.16, image: 0.24, gif: 0.24 } as const;
const MARGINS: [string, number][] = [["marginNone", 0], ["marginSmall", 0.3], ["marginMedium", 0.6], ["marginLarge", 1], ["marginXL", 1.6]];
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
  const { list, selected, preview } = useStickerState();
  const latest = useRef({ list, selected, layers });
  useEffect(() => { tNow.current = t; latest.current = { list, selected, layers }; });

  const select = (id: string | null) => stickerStore.set({ selected: id });
  const apply = (change: (l: Sticker[]) => Sticker[]) => { const h = handle(); if (h) h.setStickers(change(h.stickers() as Sticker[])); };

  type Mode = "page" | "block" | "word" | "start";

  /**
   * What to change to attach a sticker somewhere else without moving it on screen: to the page, to the paragraph under its middle, to the word under its
   * middle, or to the start of that paragraph (its left edge and top, so it stays there whatever the width). Null when there is nothing there.
   */
  const reanchorPatch = (eff: Sticker, mode: Mode): Partial<Sticker> | null => {
    const front = latest.current.layers?.front, h = handle();
    if (!front || !h) return null;
    const m = measure(front), a = refTop(front, eff, m.rect, h.lineTop) ?? 0, box = resolvePlacement(eff, { ...m, anchorTop: a, aspect: 1 });
    if (mode === "page") return { anchor: null, at: undefined, y: box.top / m.em };
    const b = h.blockAt(m.rect.left + (m.rtl ? m.width - box.start - box.width / 2 : box.start + box.width / 2), m.rect.top + box.top + box.height / 2);
    if (!b) return null;
    const blockTop = anchorTop(front, b.id, m.rect) ?? 0;
    if (mode === "start") {
      const tb = textBoxOf(front, b.id, m);
      return tb ? { anchor: b.id, at: undefined, x: tb.start / m.width, y: (tb.top - blockTop) / m.em } : null;
    }
    if (mode === "word" && b.at !== undefined) {
      const line = refTop(front, { anchor: b.id, at: b.at, wrap: undefined }, m.rect, h.lineTop) ?? blockTop;
      return { anchor: b.id, at: b.at, y: (box.top - line) / m.em };
    }
    return { anchor: b.id, at: undefined, y: (box.top - blockTop) / m.em };
  };

  /** Changes how text goes around a sticker. Text that wraps moves the lines of its block, so a wrapping sticker counts from the block's top, not from a word: it is converted without moving it. */
  const wrapPatch = (eff: Sticker, wrap: Sticker["wrap"]): Partial<Sticker> => {
    if (!wrap || wrap === "none" || eff.at === undefined) return { wrap };
    return { ...(reanchorPatch(eff, "block") ?? {}), wrap };
  };

  const front0 = () => latest.current.layers?.front;

  const entries = (id: string): MenuEntries => {
    const base = latest.current.list.find((x) => x.id === id), T = tNow.current;
    if (!base) return [];
    const cls = front0() ? classOf(measure(front0()!).width) : "wide";
    const s = effective(base, cls);   // what is shown in this size class
    const attach = (mode: Mode) => { const p = reanchorPatch(s, mode); if (p) apply((l) => l.map((x) => (x.id === id ? applyIn(x, cls, p) : x))); };
    const set = (p: Partial<Sticker>) => apply((l) => l.map((x) => (x.id === id ? applyIn(x, cls, p) : x)));
    const fit = (how: Narrow, label: Parameters<typeof T>[0]) => ({ label: T(label), checked: (s.narrow ?? "hug") === how, onclick: () => set({ narrow: how }) });
    return [
      { label: T("order"), icon: "layers", sub: () => [
        { label: T("layerFront"), onclick: () => apply((l) => bringToFront(l, id)) }, { label: T("layerForward"), onclick: () => apply((l) => bringForward(l, id)) },
        { label: T("layerBackward"), onclick: () => apply((l) => sendBackward(l, id)) }, { label: T("layerBack"), onclick: () => apply((l) => sendToBack(l, id)) }] },
      { label: s.behind ? T("inFrontOfText") : T("behindText"), icon: "layers", onclick: () => apply((l) => setBehind(l, id, !s.behind)) },
      { label: T("anchorMenu"), icon: "pin", sub: () => [
        { label: T("anchorPage"), checked: s.anchor === null, onclick: () => attach("page") },
        { label: T("anchorBlock"), checked: s.anchor !== null && s.at === undefined, onclick: () => attach("block") },
        { label: T("anchorWord"), checked: s.at !== undefined, disabled: !!s.wrap && s.wrap !== "none", onclick: () => attach("word") },
        "-",
        { label: T("anchorStart"), onclick: () => attach("start") }] },
      "-",
      { label: T("textWrap"), icon: "wrap", sub: () => (["none", "contour", "oval", "rect"] as const).map((w) => ({ label: T(("wrap_" + w) as "wrap_none"), checked: (s.wrap ?? "none") === w, disabled: !!s.behind || s.anchor === null, onclick: () => apply((l) => l.map((x) => (x.id === id ? applyIn(x, cls, wrapPatch(effective(x, cls), w)) : x))) })) },
      ...(s.wrap && s.wrap !== "none" ? [{ label: T("wrapMargin"), icon: "spacing", sub: () => MARGINS.map(([k, v]) => ({ label: T(k as "marginNone"), checked: Math.abs((s.wm ?? 0.6) - v) < 0.01, onclick: () => set({ wm: v }) })) }] : []),
      { label: T("stickerSize"), icon: "scale", sub: () => SIZES.map(([k, w]) => ({ label: T(k as "sizeSmall"), checked: Math.abs(s.w - w) < 0.005, onclick: () => set({ w }) })) },
      { label: T("flipSticker"), icon: "flip", checked: !!s.flip, onclick: () => set({ flip: !s.flip }) },
      { label: T("rotate90"), icon: "rotate", onclick: () => set({ rot: ((s.rot + 90 + 180) % 360) - 180 }) },
      { label: T("noRoom"), icon: "fit", sub: () => [fit("hug", "noRoomHug"), fit("shrink", "noRoomShrink"), fit("hide", "noRoomHide")] },
      "-",
      ...(cls !== "wide" && base.sizes?.[cls] ? [{ label: T("resetSize"), icon: "undo", onclick: () => apply((l) => l.map((x) => (x.id === id ? resetClass(x, cls) : x))) }] : []),
      { label: s.lock ? T("unlockSticker") : T("lockSticker"), icon: s.lock ? "unlock" : "lock", onclick: () => set({ lock: !s.lock }) },
      { label: s.hidden ? T("showSticker") : T("hideSticker"), icon: s.hidden ? "eye" : "eyeOff", onclick: () => set({ hidden: !s.hidden }) },
      { label: T("duplicateSticker"), icon: "copy", onclick: () => apply((l) => { const rest: Partial<Sticker> = { ...base }; delete rest.z; delete rest.id; delete rest.sizes; return addSticker(l, { ...(rest as Omit<Sticker, "z" | "id">), x: base.x + 0.03, y: base.y + 0.5 }); }) },
      "-",
      { label: T("deleteSticker"), icon: "trash", danger: true, onclick: () => { apply((l) => remove(l, id)); select(null); } },
    ];
  };

  // a long press can raise both the finger-hold and the browser's own context menu event; one menu is enough
  const lastMenu = useRef(0);
  const openMenu = (s: Sticker, x: number, y: number) => { if (Date.now() - lastMenu.current < 700) return; lastMenu.current = Date.now(); openContextMenu(x, y, entries(s.id)); };

  /** Makes the chosen sticker where the pointer was: attached to the block there, centred on the point. */
  const place = (c: Choice, at: { x: number; y: number }) => {
    const front = latest.current.layers?.front, h = handle();
    setPicker(null);
    if (!front || !h) return;
    const m = measure(front), b = h.blockAt(at.x, at.y), a = b ? refTop(front, { anchor: b.id, at: b.at, wrap: undefined }, m.rect, h.lineTop) ?? 0 : 0;
    const w = START_W[c.kind], width = Math.max(w * m.width, 56);
    const px = at.x - m.rect.left, start = (m.rtl ? m.width - px : px) - width / 2, top = at.y - m.rect.top - width / 2;
    const p = placementOf({ ...m, anchorTop: b ? a : 0, aspect: 1 }, { start, top, width });
    const next = addSticker(h.stickers() as Sticker[], { kind: c.kind, value: c.value, anchor: b?.id ?? null, ...(b?.at !== undefined ? { at: b.at } : {}), x: p.x, y: p.y, w: p.w, rot: 0 });
    h.setStickers(next);
    select(next[next.length - 1]!.id);
  };

  // a wider or narrower column to look at (and edit) another size class's layout without changing the window
  useEffect(() => {
    const col = layers?.front.closest<HTMLElement>(".page-col");
    if (!col) return;
    if (preview === "auto") col.removeAttribute("data-sticker-preview"); else col.setAttribute("data-sticker-preview", preview);
    return () => col.removeAttribute("data-sticker-preview");
  }, [layers, preview]);

  // what the sidebar's list can do
  useEffect(() => {
    const addAtCenter = () => {
      const front = latest.current.layers?.front;
      const sc = front?.closest<HTMLElement>(".page-scroll")?.getBoundingClientRect();
      if (sc) setPicker({ x: sc.left + sc.width / 2, y: sc.top + sc.height / 2 });
    };
    const sizeClass = () => (front0() ? classOf(measure(front0()!).width) : "wide");
    const setIn = (id: string, patch: Partial<Sticker>) => apply((l) => l.map((x) => (x.id === id ? applyIn(x, sizeClass(), patch) : x)));
    const control = {
      apply, addAtCenter, entries, sizeClass, set: setIn,
      attach: (id: string, mode: Mode) => { const base = latest.current.list.find((x) => x.id === id); const p = base && reanchorPatch(effective(base, sizeClass()), mode); if (p) setIn(id, p); },
      wrap: (id: string, w: Sticker["wrap"]) => apply((l) => l.map((x) => (x.id === id ? applyIn(x, sizeClass(), wrapPatch(effective(x, sizeClass()), w)) : x))),
      order: (id: string, op: "front" | "forward" | "backward" | "back") => apply((l) => (op === "front" ? bringToFront(l, id) : op === "forward" ? bringForward(l, id) : op === "backward" ? sendBackward(l, id) : sendToBack(l, id))),
    };
    stickerStore.set({ control, editable });
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

  const bridge = { blockAt: (x: number, y: number) => handle()?.blockAt(x, y) ?? null, lineTop: (id: string, at: number) => handle()?.lineTop(id, at) ?? null, setWraps: (list: WrapSpec[]) => handle()?.setWraps(list) };
  const view: ReactNode = (
    <>
      {layers && <StickerLayer back={layers.back} front={layers.front} bridge={bridge} list={list} selected={selected} editable={editable} select={select}
        change={(next) => apply(() => next)} openMenu={openMenu} onLayout={onLayout} />}
      {picker && <StickerPicker x={picker.x} y={picker.y} project={project} onClose={() => setPicker(null)} onPick={(c) => place(c, picker)} />}
    </>
  );
  return { options, view };
}
