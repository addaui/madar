import type { Ops } from "./contract";

type Out<K extends keyof Ops> = Ops[K]["output"];

export type Project = Out<"projects.get">;
export type Task = Out<"tasks.get">;
export type Page = Out<"pages.get">;
export type PageItem = Out<"pages.list">["pages"][number];
export type Workspace = Out<"workspaces.list">["workspaces"][number];
export type InboxMessage = Out<"inbox.list">["messages"][number];
export type MyTask = Out<"tasks.my">["tasks"][number];
