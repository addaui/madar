import { useQueryClient } from "@tanstack/react-query";
import { startTransition, useState } from "react";
import { link } from "../../api/link";
import { useRead, useSuspending } from "../../api/hooks";
import { useHasOp } from "../../api/session";
import type { PageItem } from "../../api/types";
import { useT } from "../../i18n/i18n";
import { cn } from "../../lib/cn";
import { askConfirm, openContextMenu, openMenuFrom, toast, type MenuItems } from "../../ui/overlays";
import { BaseButton, Button, IconButton } from "../../ui/Button";
import { TextField } from "../../ui/Field";
import { PageGlyph } from "../../ui/PageGlyph";
import { Icon } from "../../ui/Icon";
import { collapsed, useCollapsed } from "./collapsed";
import { inputOf, keyOf, opOf, type PageScope } from "./scope";
import { childrenOf, descendants } from "./tree";


type Edit = { mode: "rename"; id: string } | { mode: "folder"; parent: string | null } | null;

/** What the explorer needs to know about where you are, and how to go somewhere: from the router for your own pages, from the address of a project for its Knowledge. */
export interface ExplorerNav { current: string | null; draft: boolean; draftParent?: string; open: (id: string) => void; newPage: (parent: string | null) => void; closed: () => void }

/** The page explorer: pages as a tree, with folders, inline rename, new page and new folder, and a draft where a new page will live. */
export function Explorer({ scope, nav }: { scope: PageScope; nav: ExplorerNav }) {
  const t = useT();
  const qc = useQueryClient();
  const list = useSuspending({ queryKey: keyOf(scope, "list", scope.project ? {} : { space: scope.space }), queryFn: () => link.call(opOf(scope, "list") as never, inputOf(scope, scope.project ? {} : { space: scope.space }) as never) as Promise<{ pages: PageItem[] }> }).pages;
  const { current, draft } = nav;
  const [edit, setEdit] = useState<Edit>(null);
  const closed = useCollapsed();
  const spaces = useRead("spaces.list").data.spaces;
  const canMove = useHasOp("pages.set_space") && !scope.project && spaces.length > 1;

  const refresh = () => qc.invalidateQueries({ predicate: (q) => /^(pages|knowledge)\.list/.test(String(q.queryKey[0])) });
  const run = (f: () => Promise<unknown>) => startTransition(async () => { await f(); await refresh(); });
  const call = (name: string, input: object) => link.call(opOf(scope, name) as never, inputOf(scope, input) as never);
  const open = nav.open;
  const newPage = (parent: string | null) => { if (parent) collapsed.expand(parent); nav.newPage(parent); };

  const rename = (id: string, title: string) => run(() => call("update", { id, title }));
  const createFolder = (parent: string | null, title: string) => run(() => call("create", { title, folder: true, parent, ...(scope.project ? {} : { space: scope.space }) }));
  const remove = async (pg: PageItem) => {
    if (!(await askConfirm(t("sure")))) return;
    await run(() => call("delete", { id: pg.id }));
    if (current === pg.id || descendants(list, pg.id).some((d) => d.id === current)) nav.closed();
  };
  const move = (id: string, parent: string | null, before: string | null) => run(() => call("move", { id, parent, before }));

  const moveToSpace = (id: string, space: string) => run(async () => { await link.call("pages.set_space", { id, space }); toast(t("movedToSpace")); });
  const items = (pg: PageItem): MenuItems => {
    const sibs = childrenOf(list, pg.parent ?? null);
    const i = sibs.findIndex((x) => x.id === pg.id);
    const prev = sibs[i - 1];
    const up = pg.parent ? list.find((x) => x.id === pg.parent) : undefined;
    const upSibs = up ? childrenOf(list, up.parent ?? null) : [];
    return [
      pg.folder ? { label: t("newPage"), icon: "filePlus", onclick: () => newPage(pg.id) } : null,
      pg.folder ? { label: t("newFolder"), icon: "folderPlus", onclick: () => { collapsed.expand(pg.id); setEdit({ mode: "folder", parent: pg.id }); } } : null,
      { label: t("rename"), icon: "edit", onclick: () => setEdit({ mode: "rename", id: pg.id }) },
      { label: t("pgUp"), icon: "up", disabled: i <= 0, onclick: () => move(pg.id, pg.parent ?? null, sibs[i - 1]!.id) },
      { label: t("pgDown"), icon: "down", disabled: i < 0 || i >= sibs.length - 1, onclick: () => move(pg.id, pg.parent ?? null, sibs[i + 2]?.id ?? null) },
      prev?.folder ? { label: t("pgIntoPrev"), icon: "folder", onclick: () => move(pg.id, prev.id, null) } : null,
      up ? { label: t("pgOutdent"), icon: "up", onclick: () => move(pg.id, up.parent ?? null, upSibs[upSibs.findIndex((x) => x.id === up.id) + 1]?.id ?? null) } : null,
      canMove ? { label: t("moveToSpace"), icon: "move", sub: () => spaces.filter((w) => w.id !== scope.space).map((w) => ({ label: w.builtin ? t("mySpace") : w.name, icon: "folder", onclick: () => void moveToSpace(pg.id, w.id) })) } : null,
      "-",
      { label: t("delete"), icon: "trash", danger: true, onclick: () => void remove(pg) },
    ];
  };

  const ctx: Ctx = { list, current, draft, draftParent: nav.draftParent, edit, setEdit, closed, items, open, rename, createFolder, newPageLabel: t("untitled") };

  return (
    <div role="tree" className="flex flex-col gap-px">
      <div className="mb-1 flex items-center gap-1.5">
        <Button kind="primary" size="sm" icon="filePlus" className="min-h-[var(--row)] flex-1 justify-center" onPress={() => newPage(null)}>{t("newPage")}</Button>
        <IconButton icon="folderPlus" label={t("newFolder")} onPress={() => setEdit({ mode: "folder", parent: null })} />
      </div>
      {childrenOf(list, null).map((p) => <Row key={p.id} pg={p} depth={0} ctx={ctx} />)}
      {edit?.mode === "folder" && edit.parent === null && <FolderRow depth={0} onDone={(v) => { setEdit(null); if (v) void createFolder(null, v); }} />}
      {draft && !nav.draftParent && <DraftRow depth={0} label={t("untitled")} />}
      {list.length === 0 && !draft && <p className="px-2.5 py-2 text-[13px] text-muted-foreground">{scope.project ? t("noPagesHint") : t("noPages")}</p>}
    </div>
  );

}

/** An inline name field: Enter keeps it, Escape or leaving the field drops it. */
function TreeInput({ initial, onDone }: { initial: string; onDone: (v: string | null) => void }) {
  const t = useT();
  return (
    <TextField autoFocus defaultValue={initial} dir="auto" label={t("rename")} className="min-w-0 flex-1" inputClassName="min-h-6 py-0.5"
      onFocus={(e) => (e.target as HTMLInputElement).select()}
      onKeyDown={(e) => { const v = (e.target as HTMLInputElement).value.trim() || null; if (e.key === "Enter") { e.preventDefault(); onDone(v); } else if (e.key === "Escape") onDone(null); }}
      onBlur={(e) => onDone((e.target as HTMLInputElement).value.trim() || null)} />
  );
}

interface Ctx {
  list: PageItem[]; current: string | null; draft: boolean; draftParent: string | undefined; edit: Edit; setEdit: (e: Edit) => void; closed: ReadonlySet<string>;
  items: (pg: PageItem) => MenuItems; open: (id: string) => void; rename: (id: string, title: string) => unknown; createFolder: (parent: string | null, title: string) => unknown; newPageLabel: string;
}

function Row({ pg, depth, ctx }: { pg: PageItem; depth: number; ctx: Ctx }) {
  const t = useT();
  const { list, current, draft, draftParent, edit, setEdit, closed, items, open, rename, createFolder } = ctx;
  const kids = childrenOf(list, pg.id);
  const isOpen = !closed.has("c:" + pg.id) || (edit?.mode === "folder" && edit.parent === pg.id) || (draft && draftParent === pg.id);
  const cur = !pg.folder && current === pg.id;
  const editing = edit?.mode === "rename" && edit.id === pg.id;
  return (
    <>
      <div role="treeitem" aria-selected={cur} aria-current={cur ? "page" : undefined} aria-expanded={pg.folder || kids.length ? isOpen : undefined} title={pg.title}
        onContextMenu={(e) => { e.preventDefault(); openContextMenu(e.clientX, e.clientY, items(pg)); }}
        onClick={() => { if (editing) return; if (pg.folder) collapsed.toggle(pg.id); else open(pg.id); }}
        style={{ paddingInlineStart: 4 + Math.min(depth, 6) * 12 }}
        className={cn("group/row flex min-h-[var(--row)] cursor-pointer items-center gap-1 rounded-sm pe-1 hoverable", cur && "bg-surface font-semibold shadow-[0_1px_2px_rgba(0,0,0,.08)]")}>
        {kids.length || pg.folder ? (
          <BaseButton excludeFromTabOrder aria-label={isOpen ? t("collapse") : t("expand")} onPress={() => collapsed.toggle(pg.id)} className="grid size-5 place-items-center text-muted-foreground">
            <Icon name="chevron" className={cn("size-3.5 transition-transform", isOpen && "rotate-90 rtl:-rotate-90")} />
          </BaseButton>
        ) : <span className="size-5" />}
        <span aria-hidden="true" className="grid w-5 place-items-center"><PageGlyph icon={pg.icon} folder={pg.folder} /></span>
        {editing ? <TreeInput initial={pg.title} onDone={(v) => { setEdit(null); if (v !== null && v !== pg.title) void rename(pg.id, v); }} /> : <span className="min-w-0 flex-1 truncate" dir="auto">{pg.title || t("untitled")}</span>}
        {!editing && (
          <span className="opacity-0 focus-within:opacity-100 group-hover/row:opacity-100">
            <IconButton icon="more" label={t("more")} size="sm" onPress={(e) => openMenuFrom(e.target, items(pg))} />
          </span>
        )}
      </div>
      {isOpen && (
        <>
          {kids.map((k) => <Row key={k.id} pg={k} depth={depth + 1} ctx={ctx} />)}
          {edit?.mode === "folder" && edit.parent === pg.id && <FolderRow depth={depth + 1} onDone={(v) => { setEdit(null); if (v) void createFolder(pg.id, v); }} />}
          {draft && draftParent === pg.id && <DraftRow depth={depth + 1} label={ctx.newPageLabel} />}
        </>
      )}
    </>
  );
}

function DraftRow({ depth, label }: { depth: number; label: string }) {
  const t = useT();
  return (
    <div role="treeitem" aria-selected aria-current="page" title={t("notSavedYet")} style={{ paddingInlineStart: 4 + Math.min(depth, 6) * 12 }} className="flex min-h-[var(--row)] items-center gap-1 rounded-sm bg-surface font-semibold shadow-[0_1px_2px_rgba(0,0,0,.08)]">
      <span className="size-5" /><span aria-hidden="true" className="grid w-5 place-items-center"><PageGlyph /></span><span className="truncate text-muted-foreground">{label}</span>
    </div>
  );
}

function FolderRow({ depth, onDone }: { depth: number; onDone: (v: string | null) => void }) {
  return (
    <div style={{ paddingInlineStart: 4 + Math.min(depth, 6) * 12 }} className="flex min-h-[var(--row)] items-center gap-1 rounded-sm">
      <span className="size-5" /><span aria-hidden="true" className="grid w-5 place-items-center"><PageGlyph folder /></span><TreeInput initial="" onDone={onDone} />
    </div>
  );
}
