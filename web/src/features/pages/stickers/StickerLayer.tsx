import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../../i18n/i18n";
import { applyIn, bringForward, classOf, effective, inOrder, ranks, remove, sendBackward, type Sticker } from "./model";
import { MAX_PX, MIN_PX, placementOf, resolvePlacement, wrapOf, wrapShapeOf, type Box, type Column, type WrapSpec } from "./resolve";
import { StickerArt } from "./StickerArt";
import { measure, refTop, textBoxOf, type Measured } from "./measure";

const SNAP = 6;

/** What the layer asks of the editor. */
export interface EditorBridge { blockAt: (x: number, y: number) => { id: string; at?: number } | null; lineTop: (id: string, at: number) => number | null; setWraps: (list: WrapSpec[]) => void }

type Mode = "move" | "resize" | "rotate";
/**
 * Draws a page's stickers in the editor's two layers (behind the text, in front of it) and lets them be moved, resized, rotated and ordered (ADR 0071).
 * Position comes from `resolvePlacement` and is written straight to the elements (never through React state), so a sticker follows its block in the same
 * frame the text reflows; a ResizeObserver and the editor's own updates ask for a new pass. While one is dragged, a draft of it stands in for the saved one,
 * and the saved one is replaced only when the pointer is let go.
 */
export function StickerLayer({ back, front, bridge, list, selected, editable, select, change, openMenu, onLayout }: {
  back: HTMLElement; front: HTMLElement; bridge: EditorBridge; list: Sticker[]; selected: string | null; editable: boolean;
  select: (id: string | null) => void; change: (next: Sticker[]) => void; openMenu: (s: Sticker, x: number, y: number) => void;
  /** Called with a function the editor can call when its content changed, so the stickers follow in the same frame. */
  onLayout: (again: (() => void) | null) => void;
}) {
  const t = useT();
  const els = useRef(new Map<string, HTMLElement>());
  const aspects = useRef(new Map<string, number>());
  const boxes = useRef(new Map<string, Box>());
  const draft = useRef<Sticker | null>(null);
  const latest = useRef({ list, selected });
  const frameEl = useRef<HTMLDivElement | null>(null), tetherH = useRef<HTMLDivElement | null>(null), tetherV = useRef<HTMLDivElement | null>(null), guideEl = useRef<HTMLDivElement | null>(null);
  // the block a dragged sticker would attach to is outlined by an element of the layer (a class on the block would be wiped by the editor's own updates)
  const targetId = useRef<string | null>(null), targetBox = useRef<HTMLDivElement | null>(null);
  const guide = useRef<number | null>(null), tether = useRef<{ edgeX: number; cornerX: number; cornerY: number; refY: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  // updated before the layout effect below runs (an ordinary effect would run after it, and the frame would be drawn for the sticker selected before)
  useLayoutEffect(() => { latest.current = { list, selected }; });

  const layout = () => {
    const m = measure(front);
    if (!m.rect.width) return;
    const { list: items, selected: sel } = latest.current;
    const rank = ranks(items), cls = classOf(m.width);
    const phys = (start: number, w: number) => (m.rtl ? m.width - start - w : start);   // for the tether and guide, which are drawn from the left
    boxes.current.clear();
    for (const s0 of items) {
      const s = draft.current?.id === s0.id ? draft.current : effective(s0, cls);
      const el = els.current.get(s.id);
      if (!el) continue;
      const a = refTop(front, s, m.rect, bridge.lineTop);
      const box = resolvePlacement(s, { ...m, anchorTop: a ?? 0, aspect: aspects.current.get(s.id) ?? 1 });
      if (a === null) box.hidden = true;
      boxes.current.set(s.id, box);
      const st = el.style;
      st.display = box.hidden ? "none" : "";
      st.insetInlineStart = box.start + "px"; st.top = box.top + "px"; st.width = box.width + "px"; st.height = box.height + "px";
      st.fontSize = box.width * 0.78 + "px";
      st.transform = `rotate(${box.rot}deg)${box.flip ? " scaleX(-1)" : ""}`;
      st.zIndex = String(rank.get(s.id) ?? 1);
    }
    // text goes around the stickers that ask for it
    const wraps: WrapSpec[] = [];
    for (const s0 of items) {
      const s = draft.current?.id === s0.id ? draft.current : effective(s0, cls), box = boxes.current.get(s.id);
      if (!box || !s.anchor || !s.wrap || s.wrap === "none") continue;
      const tb = textBoxOf(front, s.anchor, m);
      const w = tb && wrapOf(s, box, m.width, tb, m.em, m.rtl);
      if (w) wraps.push(w);
    }
    bridge.setWraps(wraps);
    const f = frameEl.current, sb = sel ? boxes.current.get(sel) : undefined;
    if (f) {
      if (!sb || sb.hidden) f.style.display = "none";
      else {
        const st = f.style;
        const se = items.find((x) => x.id === sel), eff = se && (draft.current?.id === sel ? draft.current : effective(se, cls)), shape = eff ? wrapShapeOf(eff) : "none";
        st.display = ""; st.insetInlineStart = sb.start + "px"; st.top = sb.top + "px"; st.width = sb.width + "px"; st.height = sb.height + "px";
        // while text wraps around it, the frame is the shape the text goes around (the wrap ignores a turn)
        st.transform = shape === "none" ? `rotate(${sb.rot}deg)` : "none";
        f.dataset.wrap = shape; st.setProperty("--wm", Math.round((eff?.wm ?? 0.6) * m.em) + "px");
      }
    }
    const g = guideEl.current;
    if (g) { g.style.display = guide.current === null ? "none" : ""; if (guide.current !== null) g.style.left = phys(guide.current, 0) + "px"; }
    const tbx = targetBox.current;
    if (tbx) {
      const el = targetId.current ? front.parentElement?.querySelector<HTMLElement>(`[data-bid="${CSS.escape(targetId.current)}"]`) : null, r = el?.getBoundingClientRect();
      tbx.style.display = r && r.height ? "" : "none";
      if (r) { tbx.style.insetInlineStart = (m.rtl ? m.rect.right - r.right : r.left - m.rect.left) + "px"; tbx.style.top = r.top - m.rect.top + "px"; tbx.style.width = r.width + "px"; tbx.style.height = r.height + "px"; }
    }
    // what it is attached to, shown as two lines meeting at the sticker's corner: one from the block's start edge (how far across), one from the line it counts from (how far down)
    const th = tetherH.current, tv = tetherV.current, tt = tether.current;
    if (th && tv) {
      th.style.display = tv.style.display = tt ? "" : "none";
      if (tt) {
        th.style.left = Math.min(tt.edgeX, tt.cornerX) + "px"; th.style.top = tt.cornerY + "px"; th.style.width = Math.abs(tt.cornerX - tt.edgeX) + "px";
        tv.style.left = tt.cornerX + "px"; tv.style.top = Math.min(tt.refY, tt.cornerY) + "px"; tv.style.height = Math.abs(tt.cornerY - tt.refY) + "px";
      }
    }
  };

  const raf = useRef(0);
  const layoutSoon = () => { cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(layout); };

  // a new list (saved, undone, or replaced from outside) ends any draft, then everything is placed again
  // `layout` only reads refs and the DOM, so it need not be listed
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { draft.current = null; layout(); }, [list, selected]);
  useEffect(() => {
    onLayout(layoutSoon);
    const ro = new ResizeObserver(layoutSoon);
    ro.observe(front);
    const content = front.parentElement?.querySelector(".ed-content");
    if (content) ro.observe(content);
    void document.fonts?.ready.then(layoutSoon);
    return () => { onLayout(null); ro.disconnect(); cancelAnimationFrame(raf.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [front]);

  // where each finger is, so a second finger on a selected sticker can resize and turn it (pinch)
  const touchPts = useRef(new Map<number, { x: number; y: number }>());
  useEffect(() => {
    const pts = touchPts.current;
    const set = (e: PointerEvent) => { if (e.pointerType === "touch") pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); };
    const del = (e: PointerEvent) => { pts.delete(e.pointerId); };
    window.addEventListener("pointerdown", set, true); window.addEventListener("pointermove", set, true);
    window.addEventListener("pointerup", del, true); window.addEventListener("pointercancel", del, true);
    return () => { window.removeEventListener("pointerdown", set, true); window.removeEventListener("pointermove", set, true); window.removeEventListener("pointerup", del, true); window.removeEventListener("pointercancel", del, true); };
  }, []);

  const aspectOf = (s: Sticker) => aspects.current.get(s.id) ?? 1;
  const colFor = (m: Measured, s: Sticker, aTop: number): Column => ({ ...m, anchorTop: aTop, aspect: aspectOf(s) });

  /** What the drag changed, written where the person was working: the sticker itself in a wide column, else only that size class's layout. */
  const commit = (base: Sticker, d: Sticker, cls: ReturnType<typeof classOf>): Sticker => {
    const eff = effective(base, cls), patch: Partial<Sticker> = {};
    for (const k of ["x", "y", "w", "rot"] as const) if (d[k] !== eff[k]) patch[k] = d[k];
    if (d.anchor !== eff.anchor || d.at !== eff.at) { patch.anchor = d.anchor; patch.at = d.at; }
    const out = applyIn(base, cls, patch);
    if (cls === "wide" && out.at === undefined) delete out.at;
    return out;
  };

  const begin = (e: React.PointerEvent<HTMLElement>, base: Sticker, mode: Mode) => {
    if (!editable || e.button > 0) return;
    e.preventDefault(); e.stopPropagation();
    select(base.id);
    (e.currentTarget.closest(".sticker-frame") as HTMLElement | null ?? e.currentTarget).focus({ preventScroll: true });
    if (base.lock) return;
    const m = measure(front), cls = classOf(m.width), s = effective(base, cls), a0 = refTop(front, s, m.rect, bridge.lineTop) ?? 0, box0 = resolvePlacement(s, colFor(m, s, a0));
    const from = { x: e.clientX, y: e.clientY };
    const centre = { x: m.rect.left + (m.rtl ? m.width - box0.start - box0.width / 2 : box0.start + box0.width / 2), y: m.rect.top + box0.top + box0.height / 2 };
    const angle0 = Math.atan2(from.y - centre.y, from.x - centre.x) * 180 / Math.PI - s.rot;
    let moved = false, cancelled = false, pinch0: { d: number; a: number } | null = null;
    // a finger held still on a sticker opens its menu
    const hold = e.pointerType === "touch" && mode === "move" ? setTimeout(() => { if (!moved && !cancelled) { cancelled = true; openMenu(base, from.x, from.y); } }, 500) : undefined;
    const move = (ev: PointerEvent) => {
      if (cancelled) return;
      const fingers = [...touchPts.current.values()];
      if (fingers.length >= 2) {
        const [p1, p2] = fingers as [{ x: number; y: number }, { x: number; y: number }];
        const d = Math.hypot(p2.x - p1.x, p2.y - p1.y), a = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;
        if (!pinch0) { pinch0 = { d: Math.max(d, 1), a }; if (!moved) { moved = true; setDragging(true); } clearTimeout(hold); return; }
        const w = Math.min(MAX_PX, Math.max(MIN_PX, box0.width * d / pinch0.d));
        let r = s.rot + (a - pinch0.a);
        r = ((r + 540) % 360) - 180;
        draft.current = { ...s, w: w / m.width, rot: Math.round(r * 10) / 10 };
        layout();
        return;
      }
      if (pinch0) return;   // one finger is left after a pinch: the gesture is over until it is lifted
      if (Math.hypot(ev.clientX - from.x, ev.clientY - from.y) > 8) clearTimeout(hold);
      const dx = (ev.clientX - from.x) * (m.rtl ? -1 : 1), dy = ev.clientY - from.y;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      if (!moved) { moved = true; setDragging(true); }
      if (mode === "resize") {
        const w = Math.min(MAX_PX, Math.max(MIN_PX, box0.width + dx));
        draft.current = { ...s, w: w / m.width };
      } else if (mode === "rotate") {
        let r = Math.atan2(ev.clientY - centre.y, ev.clientX - centre.x) * 180 / Math.PI - angle0;
        r = ((r + 540) % 360) - 180;
        if (ev.shiftKey) r = Math.round(r / 15) * 15;
        draft.current = { ...s, rot: Math.round(r * 10) / 10 };
      } else {
        let start = box0.start + dx;
        const top = box0.top + dy;
        guide.current = null;
        for (const [c, line] of [[0, 0], [(m.width - box0.width) / 2, m.width / 2], [m.width - box0.width, m.width]] as const) {
          if (Math.abs(start - c) < SNAP) { start = c; guide.current = line; break; }
        }
        // It attaches to the block its centre is over, so it changes block when the middle of it crosses into another (not when the pointer does);
        // in every size class alike. Shift pins it to the page, like Word's "fix position on page".
        let anchor = s.anchor, aTop = a0, at = s.at;
        const wraps = !!s.wrap && s.wrap !== "none";
        if (ev.shiftKey) { anchor = null; aTop = 0; at = undefined; }
        else {
          const cx = m.rtl ? m.width - (start + box0.width / 2) : start + box0.width / 2;
          const b = bridge.blockAt(m.rect.left + cx, m.rect.top + top + box0.height / 2);
          if (b) {
            anchor = b.id; at = wraps ? undefined : b.at;
            aTop = refTop(front, { anchor, at, wrap: s.wrap }, m.rect, bridge.lineTop) ?? a0;
          }
        }
        const p = placementOf(colFor(m, s, aTop), { start, top, width: box0.width });
        draft.current = { ...s, anchor, at, x: p.x, y: p.y };
        if (at === undefined) delete draft.current.at;
        // what it is attached to: the block is outlined and two lines run from its start edge and from the line it counts from (nothing while pinned to the page)
        const blockEl = anchor === null ? null : front.parentElement?.querySelector<HTMLElement>(`[data-bid="${CSS.escape(anchor)}"]`) ?? null;
        const br = blockEl?.getBoundingClientRect();
        tether.current = anchor === null || !br ? null : { edgeX: m.rtl ? br.right - m.rect.left : br.left - m.rect.left, cornerX: m.rtl ? m.width - start : start, cornerY: top, refY: aTop };
        targetId.current = anchor;
      }
      layout();
    };
    const up = () => {
      clearTimeout(hold);
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
      targetId.current = null;
      guide.current = null; tether.current = null; setDragging(false);
      const d = draft.current;
      if (cancelled || !moved || !d) { draft.current = null; layout(); return; }
      change(latest.current.list.map((x) => (x.id === d.id ? commit(x, d, cls) : x)));   // the draft stays until the saved list arrives, so it does not jump back
      layoutSoon();
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
  };

  const onKey = (e: React.KeyboardEvent, s: Sticker) => {
    if (!editable || e.target !== e.currentTarget) return;
    const step = e.shiftKey ? 5 : 1, m = measure(front), cls = classOf(m.width);
    const nudge = (dx: number, dy: number) => { if (s.lock) return; e.preventDefault(); change(latest.current.list.map((x) => { if (x.id !== s.id) return x; const f = effective(x, cls); return applyIn(x, cls, { x: f.x + dx * 0.005 * step * (m.rtl ? -1 : 1), y: f.y + dy * 0.25 * step }); })); };
    switch (e.key) {
      case "ArrowLeft": nudge(-1, 0); break;
      case "ArrowRight": nudge(1, 0); break;
      case "ArrowUp": nudge(0, -1); break;
      case "ArrowDown": nudge(0, 1); break;
      case "Delete": case "Backspace": if (!s.lock) { e.preventDefault(); change(remove(latest.current.list, s.id)); select(null); } break;
      case "Escape": select(null); break;
      case "]": e.preventDefault(); change(bringForward(latest.current.list, s.id)); break;
      case "[": e.preventDefault(); change(sendBackward(latest.current.list, s.id)); break;
      case "ContextMenu": { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); openMenu(s, r.left + r.width / 2, r.bottom); break; }
    }
  };

  // Alt-click selects the sticker under the one on top (also one behind the text, which the text hides from the pointer); a click on the text lets go
  useEffect(() => {
    const body = front.parentElement;
    if (!body) return;
    const down = (e: PointerEvent) => {
      const target = e.target as Element;
      if (target.closest(".ed-stickers")) return;
      if (e.altKey && e.button === 0 && editable) {
        const m = measure(front), px = e.clientX - m.rect.left, py = e.clientY - m.rect.top, x = m.rtl ? m.width - px : px;
        const under = inOrder(latest.current.list).reverse().filter((s) => { const b = boxes.current.get(s.id); return b && !b.hidden && x >= b.start && x <= b.start + b.width && py >= b.top && py <= b.top + b.height; });
        if (under.length) {
          const i = under.findIndex((s) => s.id === latest.current.selected);
          select(under[(i + 1) % under.length]!.id);
          e.preventDefault(); e.stopPropagation();
          return;
        }
      }
      if (latest.current.selected) select(null);
    };
    body.addEventListener("pointerdown", down, true);
    return () => body.removeEventListener("pointerdown", down, true);
  }, [front, editable, select]);

  const sel = list.find((s) => s.id === selected);
  const node = (s: Sticker) => (
    <div key={s.id} ref={(el) => { if (el) els.current.set(s.id, el); else els.current.delete(s.id); }}
      className="sticker" data-sticker={s.id} data-behind={s.behind ? "" : undefined} data-locked={s.lock ? "" : undefined} data-pinned={s.anchor === null ? "" : undefined}
      tabIndex={editable ? 0 : -1} role="img" aria-label={s.kind === "emoji" ? `${t("sticker")} ${s.value}` : t("sticker")}
      onPointerDown={editable ? (e) => begin(e, s, "move") : undefined}
      onContextMenu={editable ? (e) => { e.preventDefault(); e.stopPropagation(); select(s.id); openMenu(s, e.clientX, e.clientY); } : undefined}
      onFocus={editable ? () => select(s.id) : undefined} onKeyDown={editable ? (e) => onKey(e, s) : undefined}>
      <StickerArt s={s} onSize={(a) => { if (aspects.current.get(s.id) !== a) { aspects.current.set(s.id, a); layoutSoon(); } }} />
    </div>
  );

  return (
    <>
      {createPortal(list.filter((s) => s.behind).map(node), back)}
      {createPortal(
        <>
          {list.filter((s) => !s.behind).map(node)}
          {editable && (
            <div ref={frameEl} className="sticker-frame" data-locked={sel?.lock ? "" : undefined} tabIndex={-1} role="group" aria-label={t("sticker")} style={{ display: "none" }}
              onKeyDown={(e) => sel && onKey(e, sel)}
              onContextMenu={(e) => { if (sel) { e.preventDefault(); e.stopPropagation(); openMenu(sel, e.clientX, e.clientY); } }}>
              {sel && (
                <>
                  {sel.kind === "image" && <img className="sticker-outline" src={sel.value} alt="" draggable={false} />}
                  <div className="sticker-move" onPointerDown={(e) => begin(e, sel, "move")} />
                  {!sel.lock && <div className="sticker-handle sticker-resize" aria-label={t("resizeSticker")} onPointerDown={(e) => begin(e, sel, "resize")} />}
                  {!sel.lock && <div className="sticker-handle sticker-rotate" aria-label={t("rotateSticker")} onPointerDown={(e) => begin(e, sel, "rotate")} />}
                </>
              )}
            </div>
          )}
          <div ref={targetBox} className="sticker-target" style={{ display: "none" }} />
          <div ref={tetherH} className="sticker-tether-h" style={{ display: "none" }} />
          <div ref={tetherV} className="sticker-tether-v" style={{ display: "none" }} />
          <div ref={guideEl} className="sticker-guide" style={{ display: "none" }} />
          {dragging && <span className="sr-only" aria-live="polite">{t("moveSticker")}</span>}
        </>, front)}
    </>
  );
}
