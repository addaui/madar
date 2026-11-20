// SPDX-License-Identifier: Apache-2.0
/** What @madar/task-block declares to editor.element (written to its kinds.json by the build). Only types are imported. */
import type { ElementKindDecl } from "@nuah/editor-core";

const L = (en: string, ar: string) => ({ en, ar });
/** A task with details inside a page (ADR 0075). `task` names the attributes that hold what Today shows; the pages plugin reads it. */
export const KINDS: (ElementKindDecl & { task: Record<string, string> })[] = [{
  kind: "@madar/task-block/task", version: 1, shape: "content", placement: "block", label: L("Task", "مهمة"), icon: "task", group: "list",
  keywords: "task todo due priority deadline", nodes: ["taskBlock"],
  options: [
    { id: "checked", type: "toggle", attr: "checked", label: L("Done", "منجزة"), default: false, pinned: true },
    { id: "due", type: "date" as never, attr: "due", label: L("Due date", "تاريخ الاستحقاق"), pinned: true },
    { id: "priority", type: "choice", attr: "priority", label: L("Priority", "الأولوية"), choices: [{ value: "low", label: L("Low", "منخفضة") }, { value: "medium", label: L("Medium", "متوسطة") }, { value: "high", label: L("High", "عالية") }] },
    { id: "details", type: "text", attr: "details", label: L("Notes", "ملاحظات") },
  ],
  task: { done: "checked", due: "due", priority: "priority", notes: "details" },
}];
