import { useT } from "../../i18n/i18n";
import { Window } from "./Dialog";

const KEYS: [keys: string, label: "kSearch" | "kNewTask" | "kFocus" | "kHelp" | "kClose"][] = [
  ["/", "kSearch"], ["N", "kNewTask"], ["Ctrl + \\", "kFocus"], ["?", "kHelp"], ["Esc", "kClose"],
];

export function Shortcuts({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <Window title={t("kHelp")} onClose={onClose}>
      <dl className="m-0 grid gap-2">
        {KEYS.map(([k, l]) => <div key={k} className="flex items-center gap-3"><dt><kbd dir="ltr" className="rounded border border-line-strong bg-sunken px-2 py-0.5 text-[13px]">{k}</kbd></dt><dd className="m-0">{t(l)}</dd></div>)}
      </dl>
    </Window>
  );
}
