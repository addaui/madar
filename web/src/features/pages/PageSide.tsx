import { Suspense, useState } from "react";
import { Skeleton } from "../../ui/Skeleton";
import { useMaybeRead, useRead } from "../../api/hooks";
import { useDescribe } from "../../api/session";
import { Avatar } from "../../ui/Avatar";
import type { Page } from "../../api/types";
import { useI18n } from "../../i18n/i18n";
import { useDateFormat } from "../../lib/format";
import { cn } from "../../lib/cn";
import { Icon } from "../../ui/Icon";
import { PageStyleTab } from "./PageStyleTab";
import type { PageScope } from "./scope";

type Tab = "info" | "page";

/** The side panel of a page: its facts and links (Info), and how it is shown (Page). It is a column of the frame, beside the header and the sheet. */
export function PageSide({ page, scope }: { page: Page; scope: PageScope }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("info");
  const f = useDateFormat();
  const back = useMaybeRead(scope.project ? "refs.to" : "refs.mine", scope.project ? { project: scope.project, kind: "pages.page", id: page.id } as never : { kind: "pages.page", id: page.id });
  const links = (back.data as { links?: { from: { type: string; id: string }; title?: string }[] } | undefined)?.links ?? [];
  const tabs: Tab[] = ["info", "page"];
  return (
    <div className="flex h-full min-h-0 flex-col workspace:bg-transparent panels:rounded-lg panels:border panels:border-[var(--bc,transparent)] panels:bg-surface panels:shadow-1">
      <div role="tablist" className="flex gap-0.5 border-b border-line px-3">
        {tabs.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cn("border-b-2 border-transparent px-2.5 py-2.5 text-[13px] text-muted", tab === k && "border-accent font-semibold text-text")}>{t(k === "info" ? "infoTab" : "pageTab")}</button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {tab === "info" ? (
          <>
            <dl className="m-0 grid gap-2.5 text-[13px]">
              {page.created_by ? <Prop icon="user" label={t("createdBy")}>{scope.project ? <Suspense fallback={<Skeleton className="h-4 w-24" />}><ProjectCreator project={scope.project} subject={page.created_by} /></Suspense> : <Person subject={page.created_by} name={undefined} />}</Prop> : null}
              <Prop icon="calendar" label={t("created")}>{f.time(page.created_at ?? 0)}</Prop>
              <Prop icon="history" label={t("updatedAt")}>{f.time(page.updated_at ?? 0)}</Prop>
            </dl>
            <h3 className="mb-1.5 mt-5 flex items-center gap-1.5 text-[13px] font-semibold text-muted"><Icon name="link" className="size-3.5" />{t("linkedFrom")}</h3>
            {links.length === 0 ? <p className="m-0 text-muted">{t("noLinks")}</p> : (
              <ul className="m-0 grid list-none gap-1 p-0">{links.map((l) => <li key={l.from.id}><a href={`#/pages/${l.from.id}`} className="block rounded-sm px-2 py-1 hoverable">{l.title ?? l.from.id}</a></li>)}</ul>
            )}
          </>
        ) : <PageStyleTab page={page} scope={scope} writer />}
      </div>
    </div>
  );
}

function Prop({ icon, label, children }: { icon: string; label: string; children: React.ReactNode }) {
  return <div className="grid grid-cols-[112px_1fr] items-center gap-2.5"><dt className="flex items-center gap-2 text-muted"><Icon name={icon} className="size-3.5" />{label}</dt><dd className="m-0">{children}</dd></div>;
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
