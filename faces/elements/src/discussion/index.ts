// SPDX-License-Identifier: Apache-2.0
/**
 * @madar/discussion (ADR 0046, 0094): comments on a block, as a button in every block's margin with the number of threads. The counts and
 * the thread come from the Face (`api.service("comments")`); a page without comments (your own pages, drafts) has no button.
 */
import type { EditorApi } from "@nuah/editor-api";

type Comments = { counts(): Record<string, number>; open(blockId: string, anchor?: HTMLElement): void };

export default function register(api: EditorApi) {
  const comments = api.service<Comments>("comments");
  if (!comments) return;
  api.margin({
    id: "comments", icon: "comment", label: { en: "Comments", ar: "التعليقات" },
    count: (b) => comments.counts()[b.blockId] ?? 0,
    run: (b, anchor) => comments.open(b.blockId, anchor),
  });
}
