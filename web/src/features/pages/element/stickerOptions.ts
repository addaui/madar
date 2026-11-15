import { effective, resetClass, setBehind, type Sticker } from "../stickers/model";
import type { StickerControl } from "../stickers/store";
import type { OptionDecl } from "./options";

/**
 * The options of a sticker, in the same form as a block's (ADR 0073), with how to read and write each. A sticker is not a node of the text, so its options
 * are declared here, in the Face, once.
 */
export interface StickerOption {
  decl: OptionDecl;
  read: (s: Sticker) => unknown;
  write: (c: StickerControl, id: string, v: string | number | boolean) => void;
  /** Whether the person changed it, and how to put it back; no `reset` means no arrow. */
  changed?: (s: Sticker) => boolean;
  reset?: (c: StickerControl, id: string) => void;
  /** Not offered now (a margin when nothing wraps). */
  hidden?: (s: Sticker) => boolean;
  disabled?: (s: Sticker) => boolean;
}

const L = (en: string, ar: string) => ({ en, ar });
const choices = (list: [string | number, string, string][]) => list.map(([value, en, ar]) => ({ value, label: L(en, ar) }));
const wrapping = (s: Sticker) => !!s.wrap && s.wrap !== "none";

export const STICKER_OPTIONS: StickerOption[] = [
  { decl: { id: "layer", type: "choice", label: L("Layer", "الطبقة"), choices: choices([["front", "In front", "أمام النص"], ["behind", "Behind", "خلف النص"]]) },
    read: (s) => (s.behind ? "behind" : "front"), write: (c, id, v) => c.apply((l) => setBehind(l, id, v === "behind")),
    changed: (s) => !!s.behind, reset: (c, id) => c.apply((l) => setBehind(l, id, false)) },
  { decl: { id: "wrap", type: "choice", label: L("Text wrap", "التفاف النص"), choices: choices([["none", "Over the text", "فوق النص"], ["contour", "Around the outline", "حول الحدود"], ["oval", "Around an oval", "حول شكل بيضوي"], ["rect", "Around a rectangle", "حول مستطيل"]]) },
    read: (s) => s.wrap ?? "none", write: (c, id, v) => c.wrap(id, v as Sticker["wrap"]), disabled: (s) => !!s.behind || s.anchor === null,
    changed: wrapping, reset: (c, id) => c.wrap(id, "none") },
  { decl: { id: "wm", type: "choice", label: L("Gap around it", "المسافة حوله"), choices: choices([[0, "None", "بلا"], [0.3, "Small", "صغيرة"], [0.6, "Medium", "متوسطة"], [1, "Large", "كبيرة"], [1.6, "Extra large", "كبيرة جدًا"]]) },
    read: (s) => s.wm ?? 0.6, write: (c, id, v) => c.set(id, { wm: Number(v) }), hidden: (s) => !wrapping(s),
    changed: (s) => s.wm !== undefined, reset: (c, id) => c.set(id, { wm: undefined }) },
  { decl: { id: "anchor", type: "choice", label: L("Attached to", "مرتبط بـ"), choices: choices([["page", "The page", "الصفحة"], ["block", "The paragraph", "الفقرة"], ["word", "The word", "الكلمة"]]) },
    read: (s) => (s.anchor === null ? "page" : s.at !== undefined ? "word" : "block"), write: (c, id, v) => c.attach(id, v as "page" | "block" | "word"),
  },
  { decl: { id: "w", type: "number", label: L("Width (% of the column)", "العرض (٪ من العمود)"), min: 4, max: 150, step: 1, unit: "%" },
    read: (s) => Math.round(s.w * 100), write: (c, id, v) => c.set(id, { w: Number(v) / 100 }) },
  { decl: { id: "rot", type: "number", label: L("Turn (degrees)", "التدوير (درجات)"), min: -180, max: 180, step: 5, unit: "°" },
    read: (s) => Math.round(s.rot), write: (c, id, v) => c.set(id, { rot: Number(v) }), changed: (s) => s.rot !== 0, reset: (c, id) => c.set(id, { rot: 0 }) },
  { decl: { id: "flip", type: "toggle", label: L("Flipped", "مقلوب") }, read: (s) => !!s.flip, write: (c, id, v) => c.set(id, { flip: !!v }),
    changed: (s) => !!s.flip, reset: (c, id) => c.set(id, { flip: false }) },
  { decl: { id: "narrow", type: "choice", label: L("When there is no room", "عند ضيق المساحة"), choices: choices([["hug", "Stay at the edge", "البقاء عند الحافة"], ["shrink", "Shrink", "تصغير"], ["hide", "Hide", "إخفاء"]]) },
    read: (s) => s.narrow ?? "hug", write: (c, id, v) => c.set(id, { narrow: v as Sticker["narrow"] }),
    changed: (s) => s.narrow !== undefined, reset: (c, id) => c.set(id, { narrow: undefined }) },
  { decl: { id: "lock", type: "toggle", label: L("Locked", "مقفل") }, read: (s) => !!s.lock, write: (c, id, v) => c.set(id, { lock: !!v }),
    changed: (s) => !!s.lock, reset: (c, id) => c.set(id, { lock: false }) },
  { decl: { id: "hidden", type: "toggle", label: L("Hidden", "مخفي") }, read: (s) => !!s.hidden, write: (c, id, v) => c.set(id, { hidden: !!v }),
    changed: (s) => !!s.hidden, reset: (c, id) => c.set(id, { hidden: false }) },
];

/** The sticker as the size class being shown has it (its own layout there, if it has one), and whether it has one. */
export const shownIn = (s: Sticker, cls: "narrow" | "medium" | "wide") => ({ eff: effective(s, cls), own: cls !== "wide" && !!s.sizes?.[cls], clear: () => resetClass(s, cls) });
