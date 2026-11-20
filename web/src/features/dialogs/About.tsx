import { useDescribe } from "../../api/session";
import { useI18n } from "../../i18n/i18n";
import { Button } from "../../ui/Button";
import { toast } from "../../ui/overlays";

/** What the Core says this instance is built from (ADR 0100): the product, then the Nuah parts, each with its version and commit. */
interface Part { name: string; version: string | null; commit: string | null }
interface AboutData extends Part { components: Part[] }

const title = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

/** Settings, About: what to quote in a bug report. Shown to signed-in people only (the Core leaves it out for anyone else). */
export function About() {
  const { t } = useI18n();
  const about = (useDescribe() as { about?: AboutData }).about;
  if (!about) return null;
  const parts: Part[] = [{ ...about, name: title(about.name) }, ...(about.components ?? [])];
  const commitText = (c: string | null) => {
    if (!c) return t("aboutLocal");
    const [sha, changes] = c.split("+");
    return sha!.slice(0, 12) + (changes ? " " + t("aboutChanges") : "");
  };
  const report = parts.map((p) => `${p.name} ${p.version ?? ""} (${p.commit ?? t("aboutLocal")})`.replace("  ", " ")).join("\n");
  const copy = () => void navigator.clipboard?.writeText(report).then(() => toast(t("copied")), () => undefined);
  return (
    <section className="mb-4 rounded-md border border-line p-3" aria-labelledby="about-title">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 id="about-title" className="m-0 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{t("aboutTitle")}</h2>
        <Button size="sm" icon="copy" onPress={copy}>{t("aboutCopy")}</Button>
      </div>
      <dl className="m-0 grid grid-cols-[auto_auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {parts.map((p) => (
          <div key={p.name} className="contents">
            <dt className="font-medium">{p.name}</dt>
            <dd className="m-0 tabular-nums">{p.version ?? "?"}</dd>
            <dd className="m-0 font-mono text-xs text-muted-foreground" dir="ltr">{commitText(p.commit)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
