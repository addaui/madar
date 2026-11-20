import { describe, expect, it, vi } from "vitest";
import register from "../src/discussion/index";

describe("block comments in the margin", () => {
  it("count_and_open_come_from_the_faces_comments", () => {
    const open = vi.fn();
    const comments = { counts: () => ({ b1: 3 }), open };
    let action: any;
    register({ margin: (a: any) => { action = a; }, service: (n: string) => (n === "comments" ? comments : undefined), lang: () => "ar" } as never);
    expect(action.id).toBe("comments");
    expect(action.label.ar).toBe("التعليقات");
    expect(action.count({ blockId: "b1" })).toBe(3);
    expect(action.count({ blockId: "b2" })).toBe(0);
    const anchor = document.createElement("button");
    action.run({ blockId: "b1" }, anchor);
    expect(open).toHaveBeenCalledWith("b1", anchor);
  });

  it("no_comments_service_no_action", () => {
    const margin = vi.fn();
    register({ margin, service: () => undefined, lang: () => "en" } as never);
    expect(margin).not.toHaveBeenCalled();
  });
});
