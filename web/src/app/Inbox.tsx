import { useQueryClient } from "@tanstack/react-query";
import { useRead } from "../api/hooks";
import { link } from "../api/link";
import { useT } from "../i18n/i18n";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";

/** The inbox popover: the newest messages, and mark all read. */
export function Inbox() {
  const t = useT();
  const qc = useQueryClient();
  const { messages, unread } = useRead("inbox.list", { limit: 30 }).data;
  return (
    <div>
      <div className="flex items-center gap-2 px-1.5 pb-2"><b className="grow">{t("inbox")}</b>
        {unread > 0 && <Button kind="ghost" size="sm" icon="check" onPress={async () => { await link.call("inbox.read", {}); await qc.invalidateQueries({ queryKey: ["inbox.list"] }); }}>{t("markRead")}</Button>}
      </div>
      {messages.length === 0 ? (
        <div className="grid place-items-center gap-1 py-6 text-center text-muted-foreground"><Icon name="inbox" className="size-6" /><b>{t("nothingNew")}</b><span>{t("nothingNewHint")}</span></div>
      ) : (
        <ul className="m-0 grid max-h-[60vh] list-none gap-0.5 overflow-auto p-0">
          {messages.map((m) => (
            <li key={m.id} className="flex items-start gap-2 rounded-sm px-2 py-1.5">
              {!m.read && <span aria-label={t("unread")} className="mt-2 size-2 shrink-0 rounded-full bg-brand" />}
              <span className="grow" dir="auto">{m.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
