import { useI18n } from "../../../i18n/i18n";
import { ColorField } from "../../../ui/ColorField";
import { DateField } from "../../../ui/DateField";
import { NumberField, TextField } from "../../../ui/Field";
import { Checkbox } from "../../../ui/Check";
import { Segmented } from "../../../ui/Segmented";
import { Select } from "../../../ui/Select";
import type { Labelled, OptionDecl } from "./options";

/** The control for one declared option, drawn from its type; the value is whatever it resolves to. */
export function OptionControl({ opt, value, onChange, disabled }: { opt: OptionDecl; value: unknown; onChange: (v: string | number | boolean) => void; disabled?: boolean }) {
  const { lang } = useI18n();
  const text = (l: Labelled) => (lang === "ar" && l.ar) || l.en;
  const label = text(opt.label);
  if (opt.type === "choice") {
    const choices = opt.choices ?? [];
    const byKey = new Map(choices.map((c) => [String(c.value), c.value]));
    const short = choices.length <= 4 && choices.every((c) => text(c.label).length <= 9);
    const pick = (k: string) => onChange(byKey.get(k) ?? k);
    return short
      ? <Segmented label={label} value={String(value ?? "")} onChange={pick} isDisabled={disabled} options={choices.map((c) => ({ value: String(c.value), label: text(c.label) }))} />
      : <Select plain label={label} value={String(value ?? "")} onChange={pick} isDisabled={disabled} className="max-w-[150px]" options={choices.map((c) => ({ value: String(c.value), label: text(c.label) }))} />;
  }
  if (opt.type === "toggle") return <Checkbox aria-label={label} isSelected={!!value} isDisabled={disabled} onChange={(v) => onChange(v)} />;
  if (opt.type === "number") return <NumberField label={label} value={Number(value ?? opt.default ?? 0)} minValue={opt.min} maxValue={opt.max} step={opt.step} isDisabled={disabled} onChange={(v) => { if (Number.isFinite(v)) onChange(v); }} className="w-24" />;
  if (opt.type === "date") return <DateField label={label} value={String(value ?? "")} isDisabled={disabled} onChange={(v) => onChange(v)} className="w-40" />;
  if (opt.type === "color") return <ColorField label={label} value={String(value || "#000000")} onChange={(v) => onChange(v)} />;
  return <TextField label={label} defaultValue={String(value ?? "")} isDisabled={disabled} key={String(value ?? "")} onBlur={(e) => onChange((e.target as HTMLInputElement).value)} className="w-32" />;
}
