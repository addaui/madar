import { describe, expect, it } from "vitest";
import { siteSubdomain } from "./host";

describe("a Space's website is told from the host name", () => {
  it("takes the first part of a name with three or more parts, and of name.localhost", () => {
    expect(siteSubdomain("team-docs.madar.example.com")).toBe("team-docs");
    expect(siteSubdomain("team-docs.localhost")).toBe("team-docs");
    expect(siteSubdomain("Team-Docs.Example.COM")).toBe("team-docs");
  });
  it("is null for the app's own addresses", () => {
    for (const h of ["localhost", "example.com", "127.0.0.1", "192.168.1.5", "[::1]", "www.example.com", "ab.example.com"]) expect(siteSubdomain(h), h).toBeNull();
  });
});
