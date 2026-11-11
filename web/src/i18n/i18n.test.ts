import { describe, expect, it } from "vitest";
import { ar } from "./ar";
import { en } from "./en";
import { makeI18n, translate } from "./i18n";

describe("words", () => {
  it("fills parameters and falls back to English, then to the key", () => {
    expect(translate("en", "hProjects_created", { actor: "Sam", name: "Atlas" })).toContain("Sam");
    expect(translate("ar", "no.such.key")).toBe("no.such.key");
    expect(translate("ar", "today")).toBe(ar.today);
  });
  it("Arabic is right-to-left and has every English word", () => {
    expect(makeI18n("ar").dir).toBe("rtl");
    expect(makeI18n("en").dir).toBe("ltr");
    expect(Object.keys(en).filter((k) => !(k in ar))).toEqual([]);
  });
});
