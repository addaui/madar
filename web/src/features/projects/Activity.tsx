import { textOf } from "../pages/text";
import { useQueryClient } from "@tanstack/react-query";
import { startTransition } from "react";
import { link } from "../../api/link";
import { useRead } from "../../api/hooks";
import { useI18n } from "../../i18n/i18n";
import { useDateFormat } from "../../lib/format";
import { Button } from "../../ui/Button";
import { TextArea } from "../../ui/Field";

interface Item { id: string; kind: string; at: number; actor?: string; author?: string; author_display?: string; body?: unknown; text?: string }

/** The timeline of a task or page: what happened to it and the comments on it, newest first, with a box to add a comment. */
export function Activity({ project, target, writer }: { project: string; target: { type: "tasks.task" | "pages.page"; id: string }; writer: boolean }) {
  const { t } = useI18n();
  const f = useDateFormat();
  const qc = useQueryClient();
  const feed = useRead("timeline.feed", { project, target, limit: 30 }).data as { items: Item[] };
  const add = (text: string) => startTransition(async () => {
    const body = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
    await link.call("discussion.add", { project, [target.type === "tasks.task" ? "task" : "page"]: target.id, body } as never);
    await qc.invalidateQueries({ predicate: (q) => /^(timeline|discussion)\./.test(String(q.queryKey[0])) });
  });
  const textOf = (b: unknown): string => (textOf(b));
  return (
    <div>
      <h3 className="mb-2 text-[13px] font-semibold text-muted-foreground">{t("timeline")}</h3>
      {writer && (
        <form onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget, v = String(new FormData(form).get("c") ?? "").trim(); if (v) { add(v); form.reset(); } }} className="mb-3 grid gap-2">
          <TextArea name="c" rows={2} dir="auto" placeholder={t("write")} label={t("comments")} />
          <div><Button kind="primary" type="submit" size="sm">{t("post")}</Button></div>
        </form>
      )}
      <ul className="m-0 grid list-none gap-2 p-0">
        {feed.items.map((it) => (
          <li key={it.id} className="rounded-md border border-line p-2.5 text-[13px]">
            <div className="mb-0.5 flex items-center gap-2 text-muted-foreground"><b className="text-text">{it.author_display ?? it.actor ?? ""}</b><span>{f.time(it.at)}</span></div>
            <div dir="auto">{it.body ? textOf(it.body) : it.text ?? it.kind}</div>
          </li>
        ))}
        {feed.items.length === 0 && <li className="text-muted-foreground">{t("none")}</li>}
      </ul>
    </div>
  );
}
