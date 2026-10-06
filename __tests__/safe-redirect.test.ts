import { safeRedirectPath } from "@/lib/safe-redirect";

describe("safeRedirectPath", () => {
  it.each([
    ["/cases", "/cases"],
    ["/cases/12?x=1", "/cases/12?x=1"],
  ])("allows local path %s", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", undefined, 42])(
    "rejects %p and falls back to the dashboard",
    (input) => {
      expect(safeRedirectPath(input)).toBe("/dashboard");
    },
  );
});
