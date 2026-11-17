import { Suspense } from "react";
import { useSuspending } from "../../api/hooks";
import { link } from "../../api/link";
import type { Page, Project } from "../../api/types";
import type { ProjectSearch } from "../../app/router";
import { useT } from "../../i18n/i18n";
import { Explorer } from "../pages/Explorer";
import { ContextSidebar } from "../../app/regions";
import { PageBody } from "../pages/PageBody";
import { PageSide } from "../pages/PageSide";
import { DraftPage } from "../pages/PageScreen";
import { inputOf, keyOf, opOf, projectScope } from "../pages/scope";

/** A project's Knowledge: its own pages, in a tree beside the page. The same components as your Pages, over the knowledge.* operations. */
export function KnowledgeTab({ project, search, go }: { project: Project; search: ProjectSearch; go: (s: ProjectSearch) => void }) {
  const t = useT();
  const scope = projectScope(project.id);
  const id = search.page;
  return (
    <div className="grid h-full min-h-[60vh] grid-cols-[240px_minmax(0,1fr)] gap-3 max-md:grid-cols-1">
      <div className="min-h-0 overflow-auto">
        <Suspense fallback={null}>
          <Explorer scope={scope} nav={{ current: id ?? null, draft: id === "new", draftParent: search.parent,
            open: (pid) => go({ tab: "knowledge", page: pid }), newPage: (parent) => go({ tab: "knowledge", page: "new", ...(parent ? { parent } : {}) }), closed: () => go({ tab: "knowledge" }) }} />
        </Suspense>
      </div>
      <div className="panel min-h-0 overflow-hidden">
        <Suspense fallback={<div aria-busy="true" />}>
          {!id ? <div className="mx-auto mt-[8vh] grid max-w-md place-items-center gap-1 text-center text-muted-foreground"><b className="text-text">{t("pickPage")}</b><span>{t("pickPageHint")}</span></div>
            : id === "new" ? <DraftPage parent={search.parent} scope={scope} chrome={false} onCreated={(pid) => go({ tab: "knowledge", page: pid })} />
            : <KnowledgePage key={id} project={project} id={id} />}
        </Suspense>
      </div>
    </div>
  );
}

function KnowledgePage({ project, id }: { project: Project; id: string }) {
  const scope = projectScope(project.id);
  const page = useSuspending({ queryKey: keyOf(scope, "get", { id }), queryFn: () => link.call(opOf(scope, "get") as never, inputOf(scope, { id }) as never) as Promise<Page> });
  const t = useT();
  return (
    <div className="h-full min-h-0">
      <ContextSidebar label={t("toggleInfo")}><PageSide page={page} scope={scope} /></ContextSidebar>
      <PageBody page={page} scope={scope} onWords={() => undefined} onSave={() => undefined} />
    </div>
  );
}
