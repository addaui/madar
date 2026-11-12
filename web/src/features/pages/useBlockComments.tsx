import { useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useState, type ReactNode } from "react";
import { useMaybeRead } from "../../api/hooks";
import { useHasOp } from "../../api/session";
import type { LegacyEditorProps } from "./LegacyEditor";
import type { PageScope } from "./scope";

const BlockThread = lazy(() => import("./BlockThread"));

/**
 * The comments in the margin of a project page: the editor shows a count beside each block that has threads and opens one on click.
 * Returns what to hand the editor and the dialog to render. Pages of your own have no comments, nor do drafts.
 */
export function useBlockComments(scope: PageScope, page: string): { editor: Pick<LegacyEditorProps, "comments" | "commentsVersion">; dialog: ReactNode } {
  const project = scope.project;
  const on = useHasOp("discussion.block_counts") && !!project;
  const counts = useMaybeRead("discussion.block_counts", project ? { project, page } : undefined, on);
  const info = useMaybeRead("projects.get", project ? { project } : undefined, on);
  const [block, setBlock] = useState<string | null>(null);
  const qc = useQueryClient();
  const manager = ((info.data as { can?: string[] } | undefined)?.can ?? []).includes("projects.manage");
  if (!on || !project) return { editor: {}, dialog: null };
  // the counts are read when the editor draws, so they are never stale
  return {
    editor: { comments: { counts: () => (qc.getQueryData<{ counts?: Record<string, number> }>(["discussion.block_counts", { project, page }])?.counts ?? {}), open: (id) => setBlock(id) }, commentsVersion: counts.dataUpdatedAt },
    dialog: block ? <Suspense fallback={null}><BlockThread project={project} page={page} block={block} manager={manager} onClose={() => setBlock(null)} /></Suspense> : null,
  };
}
