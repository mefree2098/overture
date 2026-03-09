import { extractOutline } from "@/lib/spec-outline";

describe("extractOutline", () => {
  it("extracts markdown and bold headings", () => {
    const outline = extractOutline(`# Heading One

## Heading Two

**3) Bold Heading**
`);

    expect(outline).toEqual([
      { level: 1, title: "Heading One" },
      { level: 2, title: "Heading Two" },
      { level: 2, title: "3) Bold Heading" },
    ]);
  });
});
