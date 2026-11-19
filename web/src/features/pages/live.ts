// SPDX-License-Identifier: Apache-2.0
/**
 * Page bodies as Live documents (ADR 0093): one session per open page, shared by everything on the screen that shows it. The session lives in
 * @nuah/live-doc; this file connects it to the Link (the page's operations), to Pulse (body updates and Presence arrive as Signals), to the
 * browser's storage, and to the editor bundle's Loro (one WebAssembly instance for both).
 */
import { idbStore, LiveDoc, type LiveTransport } from "@nuah/live-doc";
import type { PulseSignal } from "@nuah/link-client";
import { NuahError } from "@nuah/link-client";
import { link } from "../../api/link";
import { loadEditorBundle } from "./LegacyEditor";
import { inputOf, opOf, type PageScope } from "./scope";

export const toB64 = (b: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
export const fromB64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

type Call = (op: string, input: object) => Promise<unknown>;
const linkCall: Call = (op, input) => link.call(op as never, input as never) as Promise<unknown>;

/** A page's operations as the session's transport. */
export function transportFor(scope: PageScope, id: string, call: Call = linkCall): LiveTransport {
  return {
    pull: async (since) => {
      const out = (await call(opOf(scope, "body.pull"), inputOf(scope, since ? { id, since: toB64(since) } : { id }))) as { update: string; version: string };
      return { update: fromB64(out.update), version: fromB64(out.version) };
    },
    push: async (update, client) => {
      const out = (await call(opOf(scope, "body.push"), inputOf(scope, { id, update: toB64(update), client }))) as { version: string };
      return { version: fromB64(out.version) };
    },
    presence: async (state) => { await call(opOf(scope, "presence"), inputOf(scope, { id, state: toB64(state) })); },
  };
}

/** What a Signal reaches: the open session of a page. */
interface Routed { receive(update: Uint8Array, client?: string): void; pullSoon(): void; receivePresence(bytes: Uint8Array): void; online?(): void }
const routed = new Map<string, Routed>();
export const registerLive = (page: string, s: Routed) => { routed.set(page, s); };
export const unregisterLive = (page: string) => { routed.delete(page); };

/** A Signal from Pulse: a body update (or "pull, it was too big") or someone's Presence, for a page that is open here. */
export function onLiveSignal(s: PulseSignal) {
  const d = (s.data ?? {}) as { page?: string; client?: string; update?: string; pull?: boolean; state?: string };
  const live = d.page ? routed.get(d.page) : undefined;
  if (!live) return;
  if (s.kind === "pages.body") {
    if (d.update) live.receive(fromB64(d.update), d.client);
    else if (d.pull) live.pullSoon();
  } else if (s.kind === "pages.presence" && d.state) live.receivePresence(fromB64(d.state));
}

/** Pulse is connected again (Signals sent meanwhile are gone): every open page catches up. */
export function liveOnline() { for (const s of routed.values()) s.online?.(); }

/** A person's colour for their cursor, the same on every screen. */
export function colorOf(subject: string): string {
  let h = 0;
  for (const c of subject) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 70% 42%)`;
}

const store = idbStore("madar-live");
const isRejection = (e: unknown) => e instanceof NuahError && (e.reason === "pages.body_rejected" || e.category === "invalid");

interface Open { live: LiveDoc; presence: { setLocal(s: object): void; getAll(): Record<string, { user?: { name: string; color: string } }>; subscribe(f: () => void): () => void }; users: number; refresh: ReturnType<typeof setInterval>; peer: string }
const sessions = new Map<string, Promise<Open>>();

/** The session of a page, opened on first use (from this browser's storage, then the server). Every `openLive` is paired with a `releaseLive`. */
export async function openLive(scope: PageScope, id: string, me: { subject: string; display: string }): Promise<Open> {
  let p = sessions.get(id);
  if (!p) {
    p = (async () => {
      await loadEditorBundle();
      const M = window.MadarEditor as unknown as { ready(url?: string): Promise<void>; loro: { LoroDoc: never; VersionVector: never; CursorEphemeralStore: new (peer: string, timeout?: number) => Open["presence"] } };
      await M.ready(import.meta.env.BASE_URL + "loro.wasm");
      const live = await LiveDoc.open(`${scope.project ?? "me"}:${id}`, { transport: transportFor(scope, id), store, loro: M.loro, isRejection });
      const peer = live.doc.peerIdStr;
      const presence = new M.loro.CursorEphemeralStore(peer, 30_000);
      live.setEphemeral(presence as never);
      const user = { name: me.display, color: colorOf(me.subject) };
      presence.setLocal({ user });
      // Presence fades after 30 s without news; say "still here" now and then
      const refresh = setInterval(() => { const cur = (presence as unknown as { getLocal(): object | undefined }).getLocal(); presence.setLocal({ ...(cur ?? {}), user }); }, 10_000);
      registerLive(id, live);
      return { live, presence, users: 0, refresh, peer };
    })();
    sessions.set(id, p);
    p.catch(() => sessions.delete(id));
  }
  const o = await p;
  o.users++;
  return o;
}

export async function releaseLive(id: string) {
  const p = sessions.get(id);
  if (!p) return;
  const o = await p.catch(() => null);
  if (!o || --o.users > 0) return;
  sessions.delete(id);
  unregisterLive(id);
  clearInterval(o.refresh);
  o.presence.setLocal({});
  await o.live.close();
}
