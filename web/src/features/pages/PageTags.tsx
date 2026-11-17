import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSuspending } from "../../api/hooks";
import { link } from "../../api/link";
import type { Page } from "../../api/types";
import { useT } from "../../i18n/i18n";
import { ComboBox } from "../../ui/ComboBox";
import { Tags } from "../../ui/Tags";
import { searchHref } from "../search/useSearch";
import { saverFor } from "./pageSaver";
import { keyOf, inputOf, opOf, type PageScope } from "./scope";

/** The tags of a page: add one by typing (Enter or a comma), remove one with its ×. Tags already in use are suggested; they are what search finds with `#tag`. */
export function PageTags({ page, scope, writer }: { page: Page; scope: PageScope; writer: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const tags = (page.tags ?? []) as string[];
  const known = useSuspending({ queryKey: keyOf(scope, "tags"), queryFn: () => link.call(opOf(scope, "tags") as never, inputOf(scope, {}) as never) as Promise<{ tags: { tag: string; pages: number }[] }> }).tags;

  const save = (next: string[]) => {
    qc.setQueryData(keyOf(scope, "get", { id: page.id }), { ...page, tags: next });
    void saverFor(qc, page, scope).save({ tags: next }).then(() => qc.invalidateQueries({ queryKey: keyOf(scope, "tags") }));
  };
  const add = (raw: string) => {
    const tag = raw.trim().replace(/^#/, "");
    setDraft("");
    if (!tag || tags.some((x) => x.toLowerCase() === tag.toLowerCase())) return;
    save([...tags, tag.slice(0, 40)]);
  };
  const suggestions = known.map((k) => k.tag).filter((k) => !tags.some((x) => x.toLowerCase() === k.toLowerCase()));

  return (
    <div className="grid gap-2">
      {(tags.length > 0 || !writer) && <Tags label={t("tags")} tags={tags} href={(tag) => searchHref("#" + tag)} onRemove={writer ? (tag) => save(tags.filter((x) => x !== tag)) : undefined} removeLabel={t("removeTag")} />}
      {writer && <ComboBox label={t("addTag")} placeholder={t("addTag")} maxLength={40} inputValue={draft} onInputChange={(v) => { if (v.endsWith(",")) add(v.slice(0, -1)); else setDraft(v); }} suggestions={suggestions.filter((x) => x.toLowerCase().includes(draft.trim().toLowerCase()))} onCommit={add} />}
      {!writer && tags.length === 0 && <p className="m-0 text-muted-foreground">{t("noTags")}</p>}
    </div>
  );
}
