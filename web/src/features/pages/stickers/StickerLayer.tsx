import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../../i18n/i18n";
import { bringForward, inOrder, ranks, remove, sendBackward, type Sticker } from "./model";
import { MAX_PX, MIN_PX, placementOf, resolvePlacement, type Box, type Column } from "./resolve";
import { StickerArt } from "./StickerArt";
import { anchorTop, measure, type Measured } from "./measure";

const SNAP = 6;

/** What the layer asks of the editor. */
export interface EditorBridge { blockAt: (x: number, y: number) => { id: string } | null }

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
  const frameEl = useRef<HTMLDivElement | null>(null), tetherEl = useRef<HTMLDivElement | null>(null), guideEl = useRef<HTMLDivElement | null>(null);
  const targetEl = useRef<HTMLElement | null>(null);
  const guide = useRef<number | null>(null), tether = useRef<{ from: [number, number]; to: [number, number] } | null>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => { latest.current = { list, selected }; });

  const layout = () => {
    const m = measure(front);
    if (!m.rect.width) return;
    const { list: items, selected: sel } = latest.current;
    const rank = ranks(items);
    const phys = (start: number, w: number) => (m.rtl ? m.width - start - w : start);   // for the tether and guide, which are drawn from the left
    boxes.current.clear();
    for (const s0 of items) {
      const s = draft.current?.id === s0.id ? draft.current : s0;
      const el = els.current.get(s.id);
      if (!el) continue;
      const a = anchorTop(front, s.anchor, m.rect);
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
    const f = frameEl.current, sb = sel ? boxes.current.get(sel) : undefined;
    if (f) {
      if (!sb || sb.hidden) f.style.display = "none";
      else {
        const st = f.style;
        st.display = ""; st.insetInlineStart = sb.start + "px"; st.top = sb.top + "px"; st.width = sb.width + "px"; st.height = sb.height + "px"; st.transform = `rotate(${sb.rot}deg)`;
      }
    }
    const g = guideEl.current;
    if (g) { g.style.display = guide.current === null ? "none" : ""; if (guide.current !== null) g.style.left = phys(guide.current, 0) + "px"; }
    const th = tetherEl.current;
    if (th) {
      const tt = tether.current;
      th.style.display = tt ? "" : "none";
      if (tt) {
        const dx = tt.to[0] - tt.from[0], dy = tt.to[1] - tt.from[1];
        th.style.left = tt.from[0] + "px"; th.style.top = tt.from[1] + "px"; th.style.width = Math.hypot(dx, dy) + "px";
        th.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
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

  const aspectOf = (s: Sticker) => aspects.current.get(s.id) ?? 1;
  const colFor = (m: Measured, s: Sticker, aTop: number): Column => ({ ...m, anchorTop: aTop, aspect: aspectOf(s) });

  const begin = (e: React.PointerEvent<HTMLElement>, s: Sticker, mode: Mode) => {
    if (!editable || e.button > 0) return;
    e.preventDefault(); e.stopPropagation();
    select(s.id);
    (e.currentTarget.closest(".sticker-frame") as HTMLElement | null ?? e.currentTarget).focus({ preventScroll: true });
    if (s.lock) return;
    const m = measure(front), a0 = anchorTop(front, s.anchor, m.rect) ?? 0, box0 = resolvePlacement(s, colFor(m, s, a0));
    const from = { x: e.clientX, y: e.clientY };
    const centre = { x: m.rect.left + (m.rtl ? m.width - box0.start - box0.width / 2 : box0.start + box0.width / 2), y: m.rect.top + box0.top + box0.height / 2 };
    const angle0 = Math.atan2(from.y - centre.y, from.x - centre.x) * 180 / Math.PI - s.rot;
    let moved = false;
    const move = (ev: PointerEvent) => {
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
        let anchor = s.anchor, aTop = a0;
        if (ev.shiftKey) { anchor = null; aTop = 0; }   // Shift pins it to the page, like Word's "fix position on page"
        else { const b = bridge.blockAt(ev.clientX, ev.clientY); if (b) { anchor = b.id; aTop = anchorTop(front, b.id, m.rect) ?? a0; } }
        let start = box0.start + dx;
        const top = box0.top + dy;
        guide.current = null;
        for (const [c, line] of [[0, 0], [(m.width - box0.width) / 2, m.width / 2], [m.width - box0.width, m.width]] as const) {
          if (Math.abs(start - c) < SNAP) { start = c; guide.current = line; break; }
        }
        const p = placementOf(colFor(m, s, aTop), { start, top, width: box0.width });
        draft.current = { ...s, anchor, x: p.x, y: p.y };
        // the thread from the sticker to what it is attached to
        const x0 = m.rtl ? m.width - start : start;
        tether.current = anchor === null ? null : { from: [x0, top], to: [m.rtl ? m.width : 0, aTop] };
        if (targetEl.current) targetEl.current.classList.remove("sticker-target");
        targetEl.current = anchor === null ? null : front.parentElement?.querySelector<HTMLElement>(`[data-bid="${CSS.escape(anchor)}"]`) ?? null;
        targetEl.current?.classList.add("sticker-target");
      }
      layout();
    };
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
      targetEl.current?.classList.remove("sticker-target"); targetEl.current = null;
      guide.current = null; tether.current = null; setDragging(false);
      const d = draft.current;
      if (!moved || !d) { draft.current = null; layout(); return; }
      change(latest.current.list.map((x) => (x.id === d.id ? d : x)));   // the draft stays until the saved list arrives, so it does not jump back
      layoutSoon();
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
  };

  const onKey = (e: React.KeyboardEvent, s: Sticker) => {
    if (!editable || e.target !== e.currentTarget) return;
    const step = e.shiftKey ? 5 : 1, rtl = measure(front).rtl;
    const nudge = (dx: number, dy: number) => { if (s.lock) return; e.preventDefault(); change(latest.current.list.map((x) => (x.id === s.id ? { ...x, x: x.x + dx * 0.005 * step * (rtl ? -1 : 1), y: x.y + dy * 0.25 * step } : x))); };
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
                  <div className="sticker-move" onPointerDown={(e) => begin(e, sel, "move")} />
                  {!sel.lock && <div className="sticker-handle sticker-resize" aria-label={t("resizeSticker")} onPointerDown={(e) => begin(e, sel, "resize")} />}
                  {!sel.lock && <div className="sticker-handle sticker-rotate" aria-label={t("rotateSticker")} onPointerDown={(e) => begin(e, sel, "rotate")} />}
                </>
              )}
            </div>
          )}
          <div ref={tetherEl} className="sticker-tether" style={{ display: "none" }} />
          <div ref={guideEl} className="sticker-guide" style={{ display: "none" }} />
          {dragging && <span className="sr-only" aria-live="polite">{t("moveSticker")}</span>}
        </>, front)}
    </>
  );
}
