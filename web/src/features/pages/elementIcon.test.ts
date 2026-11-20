import { describe, expect, it } from "vitest";
import { elementIcon } from "./elementIcon";

describe("icons for what plugins name", () => {
  it("draws_the_named_icon_and_a_plain_one_for_a_name_this_app_does_not_have", () => {
    expect((elementIcon("pen") as SVGElement).innerHTML).not.toBe("");
    expect((elementIcon("flow") as SVGElement).innerHTML).not.toBe("");
    const unknown = elementIcon("no-such-icon-anywhere") as SVGElement;
    expect(unknown.innerHTML).not.toBe("");
    expect(unknown.innerHTML).toBe((elementIcon("another-unknown") as SVGElement).innerHTML);
  });
});
