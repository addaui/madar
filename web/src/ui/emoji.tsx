import { useQuery } from "@tanstack/react-query";
import { createContext, use, useEffect, type ReactNode } from "react";
import { link } from "../api/link";
import { usePrefs } from "../api/session";

/** The code points the emoji font covers; the font only paints these, so text keeps its own font. */
const EMOJI_RANGE = "U+00A9,U+00AE,U+203C,U+2049,U+2122,U+2139,U+2194-21AA,U+231A-23FF,U+24C2,U+25AA-25FE,U+2600-27BF,U+2934,U+2935,U+2B05-2B55,U+3030,U+303D,U+3297,U+3299,U+FE0F,U+200D,U+20E3,U+1F000-1FAFF";

interface EmojiSet { id: string; kind: "font" | "images"; family?: string; asset?: string; url?: string }
const ImageUrlContext = createContext<string | null>(null);

const emojiCode = (ch: string) => Array.from(ch).map((c) => c.codePointAt(0)!.toString(16)).filter((c) => c !== "fe0f").join("-");

/**
 * Applies the emoji set the person chose (a plugin provides the sets): a font set puts its family in front of the text fonts for emoji code
 * points only (a shipped font is fetched through the Core; any other family is the device's own); an images set draws each emoji as a picture.
 */
export function EmojiProvider({ children }: { children: ReactNode }) {
  const prefs = usePrefs();
  const sets = useQuery({ queryKey: ["emoji.sets", {}], queryFn: () => link.call("emoji.sets", {}) as Promise<{ sets: EmojiSet[] }>, staleTime: Infinity });
  const id = prefs["emoji.set"] ?? "system";
  const set = sets.data?.sets.find((x) => x.id === id);
  const url = set?.kind === "images" && set.url ? set.url : null;

  useEffect(() => {
    const root = document.documentElement.style;
    let face: FontFace | null = null, gone = false;
    const apply = (f: FontFace) => { face = f; document.fonts.add(f); return f.load().then(() => { if (!gone) root.setProperty("--emoji-first", '"MadarEmoji"'); }); };
    if (set?.kind === "font" && set.asset) {
      link.call("emoji.asset", { id: set.asset } as never).then((a) => {
        const bin = atob((a as { data: string }).data), buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        return gone ? undefined : apply(new FontFace("MadarEmoji", buf.buffer, { unicodeRange: EMOJI_RANGE }));
      }).catch(() => root.removeProperty("--emoji-first"));
    } else if (set?.kind === "font" && set.family) {
      apply(new FontFace("MadarEmoji", `local("${set.family.replace(/"/g, "")}")`, { unicodeRange: EMOJI_RANGE })).catch(() => root.removeProperty("--emoji-first")); // not on this device: its own emoji stay
    } else root.removeProperty("--emoji-first");
    return () => { gone = true; if (face) { try { document.fonts.delete(face); } catch { /* gone */ } } };
  }, [set]);

  return <ImageUrlContext value={url}>{children}</ImageUrlContext>;
}

/** The ids of the sets whose font this device does not have: choosing one would change nothing, so the preferences say so instead of failing silently. */
export function useUnavailableEmojiSets(): ReadonlySet<string> {
  const sets = useQuery({ queryKey: ["emoji.sets", {}], queryFn: () => link.call("emoji.sets", {}) as Promise<{ sets: EmojiSet[] }>, staleTime: Infinity });
  const gone = useQuery({
    queryKey: ["emoji.unavailable", sets.data?.sets.map((x) => x.id)], enabled: !!sets.data, staleTime: Infinity,
    queryFn: async () => {
      const missing: string[] = [];
      for (const x of sets.data?.sets ?? []) {
        if (x.kind !== "font" || x.asset || !x.family) continue;   // the device's own, or shipped with the app
        try { await new FontFace("MadarEmojiProbe", `local("${x.family.replace(/"/g, "")}")`).load(); } catch { missing.push(x.id); }
      }
      return missing;
    },
  });
  return new Set(gone.data ?? []);
}

/** One emoji, in the chosen set. */
export function Emo({ ch, className }: { ch: string; className?: string }) {
  const url = use(ImageUrlContext);
  if (url) return <img className={className} src={url.replace("{code}", emojiCode(ch))} alt={ch} draggable={false} loading="lazy" width={20} height={20} />;
  return <span className={className}>{ch}</span>;
}
