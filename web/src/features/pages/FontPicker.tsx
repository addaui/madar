import { useEffect, useRef, useState } from "react";
import type { Family } from "@nuah/font-engine";
import { familyIdOf, useFontChanges, useFontLibrary } from "../../api/fonts";
import { cn } from "../../lib/cn";
import { useT, type Key } from "../../i18n/i18n";
import { Icon } from "../../ui/Icon";
import { TextLink } from "../../ui/Link";
import { PopupButton } from "../../ui/Popup";
import { SearchList } from "../../ui/SearchList";
import { Segmented } from "../../ui/Segmented";
import { ToggleChip } from "../../ui/Toggle";
import { Tooltip } from "../../ui/Tooltip";

const CATEGORIES = ["sans", "serif", "mono", "display", "handwriting"] as const;
/** What a row draws: the family's name, or a few Arabic letters when the family has no Latin. */
const sampleOf = (f: Family) => (f.scripts.includes("latin") ? f.name : "أبجد هوز");
/** A few Arabic letters, drawn by a family that has them, so two Arabic fonts can be told apart. */
const ARABIC_SAMPLE = "أبجد هوز";

const DOT: Record<string, string> = {
  none: "border border-muted-foreground bg-transparent", server: "bg-muted-foreground", loading: "animate-pulse bg-muted-foreground motion-reduce:animate-none", ready: "bg-ok", failed: "bg-danger",
};

/** Whether an element is on screen (inside its scrolling list), so a row loads its font only when it is seen. */
function useSeen(): [React.RefObject<HTMLSpanElement | null>, boolean] {
  const ref = useRef<HTMLSpanElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

function Row({ f, on }: { f: Family; on: boolean }) {
  const t = useT();
  const lib = useFontLibrary();
  useFontChanges(lib);
  const [ref, seen] = useSeen();
  const name = sampleOf(f);
  const withArabic = f.scripts.includes("arabic");
  const sample = withArabic && f.scripts.includes("latin") ? name + ARABIC_SAMPLE : name;
  useEffect(() => { if (seen) void lib.ensure(f.id, { text: sample, preview: true, as: "Madar preview " + f.name }); }, [seen, lib, f.id, f.name, sample]);
  const state = lib.state(f.id, sample);
  const ready = lib.family(f.id) && seen && state === "ready";
  const arabic = !f.scripts.includes("latin");
  return (
    <span ref={ref} className="flex w-full min-w-0 items-center gap-2.5">
      <Tooltip label={t(("fontState_" + state) as Key)}>
        <span role="img" aria-label={t(("fontState_" + state) as Key)} className={cn("size-2 shrink-0 rounded-full", DOT[state])} />
      </Tooltip>
      <span className="min-w-0 grow">
        <span className={cn("block truncate text-[16px] leading-6", on && "font-semibold")} dir={arabic ? "rtl" : "ltr"} lang={arabic ? "ar" : "en"}
          ref={(el) => { if (el) el.style.fontFamily = ready ? `"Madar preview ${f.name}",var(--font-ui)` : "var(--font-ui)"; }}>{name}</span>
        <span className="block truncate text-xs text-muted-foreground">{t(("fontCat_" + f.category) as Key)}{f.variable ? " · " + t("fontVariable") : ""}{" · " + f.weights[0] + "–" + f.weights[1]}</span>
      </span>
      {withArabic && f.scripts.includes("latin") && <span className="shrink-0 text-[16px]" dir="rtl" lang="ar" ref={(el) => { if (el) el.style.fontFamily = ready ? `"Madar preview ${f.name}",var(--font-ui)` : "var(--font-ui)"; }}>{ARABIC_SAMPLE}</span>}
      {f.scripts.map((s) => <span key={s} className="shrink-0 rounded-chip border border-line px-1.5 text-[11px] text-muted-foreground">{t(("fontScriptShort_" + s) as Key)}</span>)}
      <Tooltip label={t("fontSource")}>
        <TextLink href={f.source.url} target="_blank" rel="noopener noreferrer" aria-label={t("fontSourceOf", { name: f.name })} onClick={(e) => e.stopPropagation()} className="grid size-6 shrink-0 place-items-center text-muted-foreground hover:text-text">
          <Icon name="info" className="size-4" />
        </TextLink>
      </Tooltip>
    </span>
  );
}

/** What a family offers, in a column of a fixed size beside the list, so the list never moves when the family under the pointer changes. */
function Details({ f }: { f: Family | undefined }) {
  const t = useT();
  return (
    <aside aria-live="polite" aria-label={t("fontDetails")} className="h-[26rem] w-56 shrink-0 overflow-auto border-e border-line pe-3 text-[13px] max-md:hidden">
      {!f ? <p className="m-0 text-muted-foreground">{t("fontDetailsHint")}</p> : (
        <div className="grid content-start gap-2.5">
          <b className="text-[15px]">{f.name}</b>
          <dl className="m-0 grid gap-2">
            <Fact label={t("fontScriptFilter")}>{f.scripts.map((s) => t(("fontScript_" + s) as Key)).join(" · ")}</Fact>
            <Fact label={t("fontCatFilter")}>{t(("fontCat_" + f.category) as Key)}</Fact>
            <Fact label={t("fontWeights")}>{f.variable ? t("fontVariableRange", { from: f.weights[0], to: f.weights[1] }) : t("fontWeightsRange", { from: f.weights[0], to: f.weights[1] })}{f.italic ? " · " + t("fontItalic") : ""}</Fact>
            <Fact label={t("fontFeatures")}>
              {f.features.length > 0
                ? <span className="flex flex-wrap gap-1">{f.features.map((x) => <span key={x.tag} className="rounded-sm bg-sunken px-1.5 text-xs" dir="ltr">{x.label}</span>)}</span>
                : <span className="text-muted-foreground">{t("fontNoFeatures")}</span>}
            </Fact>
            <Fact label={t("fontLicence")}><TextLink href={f.licence.url} target="_blank" rel="noopener noreferrer" className="underline" dir="ltr">{f.licence.spdx}</TextLink>{f.licence.credit ? " · " + t("fontCreditNeeded") : ""}</Fact>
            <Fact label={t("fontFrom")}><TextLink href={f.source.url} target="_blank" rel="noopener noreferrer" className="underline">{f.source.name}</TextLink></Fact>
          </dl>
        </div>
      )}
    </aside>
  );
}
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid gap-0.5"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="m-0">{children}</dd></div>;
}

/** The font of a page: a short list of the most used families, Arabic and English, to filter by script and kind, with what a family offers beside it (ADR 0090). */
export function FontPicker({ value, onChange, isDisabled }: { value: string | undefined; onChange: (id: string | undefined) => void; isDisabled?: boolean }) {
  const t = useT();
  const lib = useFontLibrary();
  useFontChanges(lib);
  const chosen = value && value !== "default" ? lib.family(familyIdOf(value)) : undefined;
  return (
    <PopupButton label={t("fontLbl")} width={680} buttonProps={{ isDisabled, className: "inline-flex max-w-[150px] items-center gap-1.5 rounded-sm border border-line bg-surface px-2.5 py-1 text-[13px] hoverable" }}
      trigger={<><span className="truncate" ref={(el) => { if (el) el.style.fontFamily = chosen ? `${lib.css(chosen)},var(--font-ui)` : ""; }}>{chosen ? chosen.name : t("fDefault")}</span><Icon name="chevron" className="size-3.5 shrink-0 rotate-90 text-muted-foreground" /></>}>
      {(close) => <List current={chosen?.id} onPick={(id) => { onChange(id); close(); }} />}
    </PopupButton>
  );
}

function List({ current, onPick }: { current: string | undefined; onPick: (id: string | undefined) => void }) {
  const t = useT();
  const lib = useFontLibrary();
  const [q, setQ] = useState("");
  const [script, setScript] = useState("all");
  const [cat, setCat] = useState<string | null>(null);
  const [active, setActive] = useState<string | undefined>(current);
  useEffect(() => { void lib.refresh().catch(() => undefined); }, [lib]);
  const shown = lib.families.filter((f) =>
    (script === "all" || f.scripts.includes(script as never)) && (!cat || f.category === cat) && (!q.trim() || f.name.toLowerCase().includes(q.trim().toLowerCase())));
  const items = [{ id: "default", text: t("fDefault") }, ...shown.map((f) => ({ id: f.id, text: f.name }))];
  const detail = active && active !== "default" ? lib.family(active) : undefined;
  return (
    <div className="flex gap-3">
      <Details f={detail} />
      <div className="grid min-w-0 flex-1 content-start gap-2.5">
        <Segmented label={t("fontScriptFilter")} value={script} onChange={setScript} className="w-full" itemClassName="flex-1 text-center"
          options={[{ value: "all", label: t("fontScriptAll") }, { value: "latin", label: t("fontScript_latin") }, { value: "arabic", label: t("fontScript_arabic") }]} />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("fontCatFilter")}>
          {CATEGORIES.map((c) => <ToggleChip key={c} isSelected={cat === c} onChange={(on) => setCat(on ? c : null)} className="px-2.5 py-1 text-xs">{t(("fontCat_" + c) as Key)}</ToggleChip>)}
        </div>
        <SearchList label={t("fontLbl")} placeholder={t("fontSearch")} value={q} onChange={setQ} items={items} listClassName="h-[17.5rem] max-h-none content-start" onActive={(i) => setActive(i.id)}
          onPick={(i) => onPick(i.id === "default" ? undefined : i.id)} empty={t("fontNone")}
          render={(i) => i.id === "default"
            ? <span className="flex min-h-9 w-full items-center gap-2.5"><span className="size-2 shrink-0" /><span className={cn(current === undefined && "font-semibold")}>{i.text}</span></span>
            : <Row f={lib.family(i.id)!} on={current === i.id} />} />
      </div>
    </div>
  );
}
