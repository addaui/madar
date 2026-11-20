// SPDX-License-Identifier: Apache-2.0
/** What @madar/previews declares to editor.element (written to its kinds.json by the build). Only types are imported. */
import type { ElementKindDecl } from "@nuah/editor-core";

const L = (en: string, ar: string) => ({ en, ar });
export const KINDS: ElementKindDecl[] = [
  { kind: "@madar/previews/link-card", version: 1, shape: "content", placement: "block", label: L("Link preview", "معاينة رابط"), icon: "bookmark", group: "embed",
    keywords: "url bookmark link card", nodes: ["linkPreview"],
    options: [{ id: "mode", type: "choice", attr: "mode", pinned: true, default: "card", label: L("Layout", "التخطيط"), choices: ["card", "compact", "stack", "side"].map((v) => ({ value: v, label: { en: v } })) }] },
  { kind: "@madar/previews/youtube", version: 1, shape: "content", placement: "block", label: L("YouTube", "يوتيوب"), icon: "video", group: "embed",
    keywords: "video youtube", nodes: ["youtube"],
    options: [
      { id: "size", type: "choice", attr: "size", inherit: true, pinned: true, label: L("Size", "الحجم"), choices: ["small", "medium", "wide", "full"].map((v) => ({ value: v, label: { en: v } })) },
      { id: "ratio", type: "choice", attr: "ratio", inherit: true, label: L("Shape", "الشكل"), choices: ["16-9", "4-3", "1-1"].map((v) => ({ value: v, label: { en: v } })) },
      { id: "start", type: "number", attr: "start", min: 0, max: 86400, unit: "s", label: L("Starts at", "يبدأ عند"), default: 0 },
    ] },
];
