import { describe, expect, it } from "vitest";
import { todayLocal } from "./format";

describe("todayLocal", () => { it("is the date where the person is, not in UTC", () => { expect(todayLocal(new Date(2026, 10, 15, 23, 59))).toBe("2026-11-15"); expect(todayLocal(new Date(2026, 0, 2, 0, 1))).toBe("2026-01-02"); }); });
