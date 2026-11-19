import { textOf as bodyText } from "./text";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { link } from "../../api/link";
import { useDescribe } from "../../api/session";
import { useI18n } from "../../i18n/i18n";
import { useDateFormat } from "../../lib/format";
import { cn } from "../../lib/cn";
import { Avatar } from "../../ui/Avatar";
import { Button } from "../../ui/Button";
import { TextArea } from "../../ui/Field";
import { askConfirm } from "../../ui/overlays";
import { Window } from "../dialogs/Dialog";

interface Comment { id: string; author: string; author_display?: string | null; at: number; body: unknown; parent?: string | null }
const textOf = (b: unknown): string => (typeof b === "string" ? b : bodyText(b));

/** The comments on one block of a project page: in order, replies under their comment, one box to write in. */
export default function BlockThread({ project, page, block, manager, onClose }: { project: string; page: string; block: string; manager: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const f = useDateFormat();
  const qc = useQueryClient();
  const me = useDescribe().who?.subject;
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const key = ["discussion.list", { project, page, block }];
  const { data } = useQuery({ queryKey: key, queryFn: () => link.call("discussion.list", { project, page, block } as never) as Promise<{ comments: Comment[] }> });
  const rows = data?.comments ?? [];
  const refresh = () => qc.invalidateQueries({ predicate: (q) => /^discussion\./.test(String(q.queryKey[0])) });
  const add = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget, body = String(new FormData(form).get("body") ?? "").trim();
    if (!body) return;
    form.reset();
    await link.call("discussion.add", { project, page, block, body, parent: replyTo?.id ?? null } as never);
    setReplyTo(null);
    await refresh();
  };
  const remove = async (c: Comment) => { if (await askConfirm(t("sure"))) { await link.call("discussion.remove", { project, id: c.id } as never); await refresh(); } };
  const one = (c: Comment, reply: boolean) => (
    <div key={c.id} className={cn("rounded-md border border-line p-2.5 text-[13px]", reply && "ms-6")}>
      <div className="mb-1 flex items-center gap-2"><Avatar subject={c.author} name={c.author_display ?? c.author} size="sm" /><b dir="auto">{c.author_display ?? c.author}</b><small className="text-muted-foreground">{f.time(c.at)}</small></div>
      <div className="whitespace-pre-wrap" dir="auto">{textOf(c.body)}</div>
      <div className="mt-1 flex gap-1">
        {!reply && <Button size="sm" kind="ghost" onPress={() => setReplyTo(c)}>{t("reply")}</Button>}
        {(manager || c.author === me) && <Button size="sm" kind="ghost" onPress={() => void remove(c)}>{t("delete")}</Button>}
      </div>
    </div>
  );
  const roots = rows.filter((c) => !c.parent);
  return (
    <Window title={t("blockComments")} onClose={onClose}>
      <div className="grid max-h-[50vh] gap-2 overflow-auto">
        {roots.length === 0 ? <p className="m-0 text-muted-foreground">{t("noThread")}</p> : roots.flatMap((c) => [one(c, false), ...rows.filter((x) => x.parent === c.id).map((x) => one(x, true))])}
      </div>
      <form onSubmit={(e) => void add(e)} className="mt-3 grid gap-2">
        {replyTo && <div className="text-muted-foreground">{t("replyingTo")} {replyTo.author_display ?? replyTo.author} · <Button size="sm" kind="ghost" onPress={() => setReplyTo(null)}>{t("cancelReply")}</Button></div>}
        <TextArea name="body" rows={3} dir="auto" autoFocus placeholder={t("write")} label={t("write")} />
        <div><Button kind="primary" type="submit">{t("post")}</Button></div>
      </form>
    </Window>
  );
}
