import { describe, expect, it } from "vitest";
import { toPgArrayLiteral } from "./scope.js";

describe("toPgArrayLiteral", () => {
  it("formats a scopes list as a Postgres array literal", () => {
    expect(toPgArrayLiteral(["project.a", "project.b"])).toBe("{project.a,project.b}");
  });

  it("formats an empty list as the empty array (deny-all)", () => {
    expect(toPgArrayLiteral([])).toBe("{}");
  });

  it("accepts ids with dots, dashes, underscores", () => {
    expect(toPgArrayLiteral(["project.edullm-sat_rw"])).toBe("{project.edullm-sat_rw}");
  });

  it("throws on a scope id containing array metacharacters", () => {
    expect(() => toPgArrayLiteral(["project.a,project.b"])).toThrow();
    expect(() => toPgArrayLiteral(["project.{evil}"])).toThrow();
    expect(() => toPgArrayLiteral(['proj"x'])).toThrow();
  });
});
