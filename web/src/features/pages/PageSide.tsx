import { Suspense, useState } from "react";
import { Skeleton } from "../../ui/Skeleton";
import { useMaybeRead, useRead } from "../../api/hooks";
import { useDescribe, useHasOp } from "../../api/session";
import { Button } from "../../ui/Button";
import { ShareDialog } from "../shares/ShareDialog";
import { Avatar } from "../../ui/Avatar";
import type { Page } from "../../api/types";
import { useI18n, type Key } from "../../i18n/i18n";
import { useDateFormat } from "../../lib/format";
import { Icon } from "../../ui/Icon";
import { Tabs } from "../../ui/Tabs";
import { PageStyleTab } from "./PageStyleTab";
import { ElementTab } from "./element/ElementTab";
import { PageElementDefaults } from "./element/PageElementDefaults";
import { useElementKind } from "./element/store";
import { usePrefs } from "../../api/session";
import { isDraftId } from "./draft";
import { PageTags } from "./PageTags";
import type { PageScope } from "./scope";

type Tab = "info" | "style" | "element";

/** The tabs, in order: what is selected first, then how the page looks, then its facts. */
export const sideTabs = (t: (k: never) => string, kindSuffix: string) => [{ id: "element", label: t("elementTab" as never) + kindSuffix }, { id: "style", label: t("styleTab" as never) }, { id: "info", label: t("infoTab" as never) }];

/** The side panel of a page: its facts and links (Info), and how it is shown (Page). It is a column of the frame, beside the header and the sheet. */
export function PageSide({ page, scope }: { page: Page; scope: PageScope }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("element");
  // the tab can name the kind of element in it (a preference under Appearance)
  const kind = useElementKind(), showKind = !!(usePrefs() as Record<string, unknown>)["editor.element_type_in_tab"];
  const f = useDateFormat();
  const draft = isDraftId(page.id);   // a page not stored yet has no links to it and cannot be shared
  const back = useMaybeRead(scope.project ? "refs.to" : "refs.mine", scope.project ? { project: scope.project, kind: "pages.page", id: page.id } as never : { kind: "pages.page", id: page.id }, !draft);
  const links = (back.data as { links?: { from: { type: string; id: string }; title?: string }[] } | undefined)?.links ?? [];
  const canShare = useHasOp("shares.create_page") && !draft;
  const [sharing, setSharing] = useState(false);
  return (
    <div className="flex h-full min-h-0 flex-col workspace:bg-transparent panels:rounded-lg panels:border panels:border-[var(--bc,transparent)] panels:bg-surface panels:shadow-1 flush:bg-surface">
      <Tabs variant="compact" label={t("toggleInfo")} selected={tab} onSelect={(k) => setTab(k as Tab)} items={sideTabs(t as never, showKind && kind ? " · " + t(("node_" + kind) as Key) : "")}
        className="flex min-h-0 flex-1 flex-col" panelClassName="min-h-0 flex-1 overflow-auto p-5">
        {tab === "info" ? (
          <>
            {canShare && <div className="mb-6"><Button icon="link" onPress={() => setSharing(true)}>{t("shareTitle")}</Button></div>}
            {sharing && <Suspense fallback={null}><ShareDialog page={{ id: page.id, title: page.title }} project={scope.project} onClose={() => setSharing(false)} /></Suspense>}
            <dl className="m-0 grid gap-3.5 text-[13px]">
              {page.created_by ? <Prop icon="user" label={t("createdBy")}>{scope.project ? <Suspense fallback={<Skeleton className="h-4 w-24" />}><ProjectCreator project={scope.project} subject={page.created_by} /></Suspense> : <Person subject={page.created_by} name={undefined} />}</Prop> : null}
              <Prop icon="calendar" label={t("created")}>{f.time(page.created_at ?? 0)}</Prop>
              <Prop icon="history" label={t("updatedAt")}>{f.time(page.updated_at ?? 0)}</Prop>
            </dl>
            <h3 className="mb-2.5 mt-8 flex items-center gap-2 text-[13px] font-semibold text-muted-foreground"><Icon name="tag" className="size-3.5" />{t("tags")}</h3>
            <Suspense fallback={<Skeleton className="h-7 w-full" />}><PageTags page={page} scope={scope} writer /></Suspense>
            <h3 className="mb-2.5 mt-8 flex items-center gap-2 text-[13px] font-semibold text-muted-foreground"><Icon name="link" className="size-3.5" />{t("linkedFrom")}</h3>
            {links.length === 0 ? <p className="m-0 text-muted-foreground">{t("noLinks")}</p> : (
              <ul className="m-0 grid list-none gap-1.5 p-0">{links.map((l) => <li key={l.from.id}><a href={`#/pages/${l.from.id}`} className="block rounded-sm px-2.5 py-1.5 hoverable">{l.title ?? l.from.id}</a></li>)}</ul>
            )}
          </>
        ) : tab === "element" ? <ElementTab page={page} scope={scope} writer /> : <><PageStyleTab page={page} scope={scope} writer /><PageElementDefaults page={page} scope={scope} writer /></>}
      </Tabs>
    </div>
  );
}

function Prop({ icon, label, children }: { icon: string; label: string; children: React.ReactNode }) {
  return <div className="grid min-h-8 grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] items-center gap-3"><dt className="flex items-center gap-2 text-muted-foreground"><Icon name={icon} className="size-3.5" />{label}</dt><dd className="m-0">{children}</dd></div>;
}

/** The creator of a project page, named from the project's members. */
function ProjectCreator({ project, subject }: { project: string; subject: string }) {
  const members = useRead("projects.members", { project }).data.members;
  return <Person subject={subject} name={members.find((m) => m.subject === subject)?.display ?? undefined} />;
}

/** A person: their avatar and name. You are named from your own sign-in; anyone else from the name given, else the subject itself. */
function Person({ subject, name }: { subject: string; name: string | undefined }) {
  const who = useDescribe().who;
  const shown = name ?? (who && who.subject === subject ? who.display : subject);
  return <span className="inline-flex items-center gap-1.5"><Avatar subject={subject} name={shown} size="sm" /><span dir="auto">{shown}</span></span>;
}
