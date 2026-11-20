// SPDX-License-Identifier: Apache-2.0
/** What @madar/refs declares to editor.element (written to its kinds.json by the build). Only types are imported. */
import type { ElementKindDecl } from "@nuah/editor-core";

/** A mention of a page or a task: the stored `entityRef` inline node, which the server reads for backlinks. */
export const KINDS: ElementKindDecl[] = [{
  kind: "@madar/refs/mention", version: 1, shape: "content", placement: "inline", label: { en: "Link to a page or task", ar: "رابط إلى صفحة أو مهمة" },
  icon: "mention", group: "reference", keywords: "mention reference link page task", nodes: ["entityRef"],
}];
