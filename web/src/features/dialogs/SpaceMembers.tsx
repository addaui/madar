import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { link } from "../../api/link";
import { useRead } from "../../api/hooks";
import { usePersistedValue, spaceState } from "../../app/ui-state";
import { useI18n } from "../../i18n/i18n";
import { Avatar } from "../../ui/Avatar";
import { Button, IconButton } from "../../ui/Button";
import { TextField } from "../../ui/Field";
import { Select } from "../../ui/Select";
import { Window } from "./Dialog";

type Role = "admin" | "member" | "viewer";
const roleKey = { admin: "spaceAdmin", member: "spaceMember", viewer: "viewer" } as const;

/** Who is in the current Space and in what role; a Space admin adds, changes and removes people (ADR 0083). */
export function SpaceMembers({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const space = usePersistedValue(spaceState);
  const spaces = useRead("spaces.list").data.spaces;
  const cur = spaces.find((s) => s.id === space && !s.builtin);
  if (!cur) return <Window title={t("spaceMembers")} onClose={onClose}><p className="m-0 text-muted">{t("personalSpaceNote")}</p></Window>;
  return <Members id={cur.id} name={cur.name} admin={cur.role === "admin"} onClose={onClose} refresh={() => qc.invalidateQueries({ predicate: (q) => /^(spaces|projects)\./.test(String(q.queryKey[0])) })} />;
}

function Members({ id, name, admin, onClose, refresh }: { id: string; name: string; admin: boolean; onClose: () => void; refresh: () => Promise<unknown> }) {
  const { t } = useI18n();
  const members = useRead("spaces.members", { space: id }).data.members;
  const [error, setError] = useState<string | null>(null);
  const fail = (x: unknown) => setError(x instanceof Error ? x.message : t("offline"));
  return (
    <Window title={`${t("spaceMembers")} · ${name}`} onClose={onClose}>
      <ul className="m-0 grid list-none gap-1 p-0">
        {members.map((m) => (
          <li key={m.subject} className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
            <Avatar subject={m.subject} name={m.display ?? m.subject} />
            <span className="min-w-0 grow truncate" dir="auto">{m.display ?? m.subject}</span>
            {admin
              ? <Select label={t("accessLevel")} value={m.role} onChange={(role) => void link.call("spaces.share", { space: id, subject: m.subject, role: role as Role }).then(refresh).catch(fail)} options={(Object.keys(roleKey) as Role[]).map((r) => ({ value: r, label: t(roleKey[r]) }))} />
              : <span className="rounded-chip border border-line px-2 py-0.5 text-xs">{t(roleKey[m.role as Role])}</span>}
            {admin && <IconButton icon="close" label={t("remove")} size="sm" tone="danger" onPress={() => void link.call("spaces.unshare", { space: id, subject: m.subject }).then(refresh).catch(fail)} />}
          </li>
        ))}
      </ul>
      {admin && (
        <form className="mt-3 flex gap-2" onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget), who = String(f.get("name") ?? "").trim();
          if (!who) return;
          try { await link.call("spaces.share", { space: id, name: who, role: String(f.get("role")) as Role }); e.currentTarget.reset(); setError(null); await refresh(); } catch (x) { fail(x); }
        }}>
          <TextField name="name" dir="auto" placeholder={t("person")} label={t("person")} className="min-w-0 grow" />
          <Select name="role" label={t("accessLevel")} defaultValue="member" options={(Object.keys(roleKey) as Role[]).map((r) => ({ value: r, label: t(roleKey[r]) }))} />
          <Button kind="primary" type="submit">{t("share")}</Button>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-danger">{error}</p>}
    </Window>
  );
}
