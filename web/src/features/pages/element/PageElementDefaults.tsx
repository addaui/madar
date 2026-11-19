import { useQueryClient } from "@tanstack/react-query";
import type { Page } from "../../../api/types";
import { useI18n, type Key } from "../../../i18n/i18n";
import { Disclosure } from "../../../ui/Disclosure";
import { Opt, Section } from "../OptionRow";
import { saverFor } from "../pageSaver";
import { keyOf, type PageScope } from "../scope";
import type { PageSettings } from "../style/settings";
import { OptionControl } from "./OptionControl";
import { blocksOf, optionsOf, withPageDefault, type OptionDecl, type PageDefaults } from "./options";
import { useKinds } from "./kinds";

const wide = (o: OptionDecl) => (o.type === "choice" && (o.choices?.length ?? 0) > 2 && (o.choices?.length ?? 0) <= 4 && (o.choices ?? []).every((c) => c.label.en.length <= 9)) || o.label.en.length > 16;

/**
 * The Page tab's "Elements" section (ADR 0073): for each kind of element that has options a page may set for all of its kind, a row that opens to those
 * options. A value set here is what every element of that kind on this page shows unless it has its own; the arrow puts one back.
 */
export function PageElementDefaults({ page, scope, writer }: { page: Page; scope: PageScope; writer: boolean }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const kinds = useKinds();
  const blocks = blocksOf(kinds);
  const labelOf = (node: string) => { const b = blocks.find((x) => x.node === node); return node.includes("/") && b ? (lang === "ar" && b.label.ar) || b.label.en : t(("node_" + node) as Key); };
  const settings = (page.settings ?? {}) as PageSettings;
  const nodes = [...new Set(blocks.map((b) => b.node))].filter((n) => optionsOf(blocks, n).some((o) => o.inherit));
  if (nodes.length === 0) return null;
  const put = (node: string, id: string, v: string | number | boolean | undefined) => {
    const elements = withPageDefault(settings.elements as PageDefaults | undefined, node, id, v);
    const next = { ...settings } as Record<string, unknown>;
    if (Object.keys(elements).length) next.elements = elements; else delete next.elements;
    qc.setQueryData(keyOf(scope, "get", { id: page.id }), { ...page, settings: next });
    void saverFor(qc, page, scope).save({ settings: next });
  };
  return (
    <Section title={t("elementsSection")}>
      {nodes.map((node) => {
        const opts = optionsOf(blocks, node).filter((o) => o.inherit), set = Object.keys(settings.elements?.[node] ?? {}).length;
        return (
          <Disclosure key={node} className="rounded-sm bg-sunken px-1" panelClassName="grid gap-1.5 pb-2 pt-1"
            title={<span className="flex min-w-0 grow items-center gap-2 text-[13px]"><span className="grow truncate">{labelOf(node)}</span>{set > 0 && <span className="shrink-0 text-xs font-normal text-muted-foreground">{t("elementsSet", { n: set })}</span>}</span>}>
            {opts.map((o) => {
              const v = settings.elements?.[node]?.[o.id];
              return (
                <Opt key={o.id} icon="type" label={(lang === "ar" && o.label.ar) || o.label.en} stacked={wide(o)} set={v !== undefined} writer={writer} revert={t("revertOption")} onRevert={() => put(node, o.id, undefined)}>
                  <OptionControl opt={o} value={v ?? o.default} disabled={!writer} onChange={(x) => put(node, o.id, x)} />
                </Opt>
              );
            })}
          </Disclosure>
        );
      })}
    </Section>
  );
}
