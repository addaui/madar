/**
 * The editor this Face runs (ADR 0095): whichever enabled plugin provides `face.editor@1`, found in `describe` and loaded once. The Face
 * never names the editor plugin. Before loading it, the Face shares the libraries a host and its element plugins must not bundle again:
 * React (one React on the page) and Loro (one WebAssembly instance with the page's Live documents).
 */
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as JSXRuntime from "react/jsx-runtime";
import { setShared } from "@nuah/browser-kit";

export interface FaceEditorModule { version: string; mount(place: HTMLElement, hooks: unknown): Promise<unknown> }
interface Describe { browser?: { plugin: string; point: string; url: string }[] }

/** Loro's web build, started with the Face's own copy of its WebAssembly. */
export const loadLoro = async (): Promise<Record<string, unknown>> => {
  const m = await import("loro-crdt/web");
  await (m.default as unknown as (o: { module_or_path: string }) => Promise<unknown>)({ module_or_path: import.meta.env.BASE_URL + "loro.wasm" });
  return m as unknown as Record<string, unknown>;
};

let loroOnce: Promise<Record<string, unknown>> | null = null;
/** The page's Loro, shared: the Live documents and the editor use this one. */
export const sharedLoro = () => (loroOnce ??= loadLoro().then((m) => { setShared({ "loro-crdt": m }); return m; }));

let hostOnce: Promise<FaceEditorModule> | null = null;
export function resetEditorHostForTests() { hostOnce = null; loroOnce = null; }

export function loadEditorHost(
  describe: () => Promise<Describe>,
  importer: (url: string) => Promise<{ default?: unknown }> = (u) => import(/* @vite-ignore */ u),
  loro: () => Promise<Record<string, unknown>> = sharedLoro,
): Promise<FaceEditorModule> {
  hostOnce ??= (async () => {
    setShared({ react: React, "react-dom": ReactDOM, "react-dom/client": ReactDOMClient, "react/jsx-runtime": JSXRuntime });
    setShared({ "loro-crdt": await loro() });
    const d = await describe();
    const p = (d.browser ?? []).find((b) => b.point === "face.editor");
    if (!p) throw new Error("noEditor");
    const m = (await importer(p.url)).default as FaceEditorModule | undefined;
    if (!m || typeof m.mount !== "function") throw new Error("noEditor");
    if (!/^1\./.test(m.version ?? "")) throw new Error("editorVersion");
    return m;
  })();
  hostOnce.catch(() => { hostOnce = null; });
  return hostOnce;
}

/**
 * What the missing-plugin bar may offer (ADR 0094): a plugin the Core's catalog has is known; the Owner and admins may switch on a feature
 * plugin from the page; a platform plugin is the operator's (the console).
 */
export function needsPluginFor(features: { id: string; class?: string }[], roles: string[], enable: (id: string) => Promise<void>) {
  return (plugin: string) => {
    const f = features.find((x) => x.id === plugin);
    const allowed = roles.includes("owner") || roles.includes("admin");
    return { known: !!f, canEnable: !!f && allowed && f.class !== "platform", enable: () => enable(plugin) };
  };
}
