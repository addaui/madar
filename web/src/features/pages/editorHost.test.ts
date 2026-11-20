import { describe, expect, it, vi, beforeEach } from "vitest";
import { enableFromPage, loadEditorHost, needsPluginFor, resetEditorHostForTests } from "./editorHost";

const describeWith = (browser: unknown[]) => async () => ({ browser }) as never;

describe("the editor host (face.editor@1)", () => {
  beforeEach(() => { resetEditorHostForTests(); delete (globalThis as { __nuahShared?: unknown }).__nuahShared; });

  it("host_loaded_from_describe_provider", async () => {
    const mod = { default: { version: "1.0.0", mount: vi.fn() } };
    const importer = vi.fn(async () => mod);
    const host = await loadEditorHost(describeWith([{ plugin: "@nuah/mermaid", point: "editor.element", url: "/plugins/nuah/mermaid/index.js?v=1" }, { plugin: "@nuah/editor", point: "face.editor", url: "/plugins/nuah/editor/host.js?v=abc" }]), importer, async () => ({}));
    expect(importer).toHaveBeenCalledWith("/plugins/nuah/editor/host.js?v=abc");
    expect(host).toBe(mod.default);
  });

  it("shared_table_set_before_import", async () => {
    let seen: Record<string, unknown> | undefined;
    const importer = async () => { seen = { ...((globalThis as { __nuahShared?: Record<string, unknown> }).__nuahShared ?? {}) }; return { default: { version: "1.0.0", mount: vi.fn() } }; };
    await loadEditorHost(describeWith([{ plugin: "@x/ed", point: "face.editor", url: "/plugins/x/ed/host.js" }]), importer, async () => ({ LoroDoc: class {} }));
    for (const n of ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "loro-crdt"]) expect(seen?.[n], n).toBeTruthy();
  });

  it("no_provider_shows_clear_error", async () => {
    await expect(loadEditorHost(describeWith([]), vi.fn(), async () => ({}))).rejects.toThrow("noEditor");
  });

  it("refuses_an_editor_of_another_major_version", async () => {
    await expect(loadEditorHost(describeWith([{ plugin: "@x/ed", point: "face.editor", url: "/h.js" }]), async () => ({ default: { version: "2.0.0", mount: vi.fn() } }), async () => ({}))).rejects.toThrow("editorVersion");
  });

  it("needs_plugin_enable_only_for_owner_and_admin", () => {
    const features = [{ id: "@nuah/excalidraw", class: "feature" }];
    expect(needsPluginFor(features, ["owner"], vi.fn())("@nuah/excalidraw")).toMatchObject({ known: true, canEnable: true });
    expect(needsPluginFor(features, ["admin"], vi.fn())("@nuah/excalidraw")).toMatchObject({ known: true, canEnable: true });
    expect(needsPluginFor(features, ["member"], vi.fn())("@nuah/excalidraw")).toMatchObject({ known: true, canEnable: false });
    expect(needsPluginFor(features, ["owner"], vi.fn())("@acme/unknown")).toMatchObject({ known: false, canEnable: false });
    expect(needsPluginFor([{ id: "@nuah/python", class: "platform" }], ["owner"], vi.fn())("@nuah/python")).toMatchObject({ known: true, canEnable: false });
  });
});

describe("enabling a plugin from a page", () => {
  it("asks_to_start_again_when_the_change_needs_it_and_starts_again_on_yes", async () => {
    const startAgain = vi.fn(async () => {});
    const ask = vi.fn(async () => true);
    await enableFromPage("@nuah/excalidraw", { enable: async () => ({ restart_required: true }), ask, startAgain, saved: vi.fn() });
    expect(ask).toHaveBeenCalled();
    expect(startAgain).toHaveBeenCalled();
  });

  it("only_says_saved_when_nothing_needs_starting_again_or_the_person_waits", async () => {
    const startAgain = vi.fn(async () => {});
    const saved = vi.fn();
    await enableFromPage("@x/y", { enable: async () => ({ restart_required: false }), ask: vi.fn(), startAgain, saved });
    await enableFromPage("@x/y", { enable: async () => ({ restart_required: true }), ask: async () => false, startAgain, saved });
    expect(startAgain).not.toHaveBeenCalled();
    expect(saved).toHaveBeenCalledTimes(2);
  });
});
