// SPDX-License-Identifier: Apache-2.0
/** What @madar/files declares to editor.element (written to its kinds.json by the build). Only types are imported. */
import type { ElementKindDecl } from "@nuah/editor-core";

const L = (en: string, ar: string) => ({ en, ar });
export const KINDS: ElementKindDecl[] = [{
  kind: "@madar/files/image", version: 1, shape: "content", placement: "block", label: L("Image", "صورة"), icon: "image", group: "media",
  keywords: "picture photo image", nodes: ["image"], accepts: ["image/png", "image/jpeg", "image/gif", "image/webp", ".png", ".jpg", ".jpeg", ".gif", ".webp"],
  options: [
    { id: "size", type: "choice", attr: "size", inherit: true, pinned: true, default: "auto", label: L("Size", "الحجم"), choices: ["auto", "small", "medium", "large", "full"].map((v) => ({ value: v, label: { en: v } })) },
    { id: "alt", type: "text", attr: "alt", label: L("Description", "الوصف") },
  ],
}];
