import { describe, expect, it } from "vitest";
import { decorationsFor, findMath, highestCloze } from "../editor/livePreview";

describe("findMath", () => {
  it("finds inline and display maths", () => {
    const spans = findMath("a $x^2$ b $$\\int f$$ c \\(y\\) d \\[z\\]");
    expect(spans.map((s) => [s.tex, s.display])).toEqual([
      ["x^2", false],
      ["\\int f", true],
      ["y", false],
      ["z", true],
    ]);
  });

  it("ignores prices and escaped dollars", () => {
    expect(findMath("It costs $5 and $6.")).toEqual([]);
    expect(findMath("\\$x$ not maths")).toEqual([]);
    expect(findMath("$ spaced $")).toEqual([]);
  });

  it("spans lines only for display maths", () => {
    expect(findMath("$a\nb$")).toEqual([]);
    expect(findMath("$$\na\n$$")[0].tex).toBe("\na\n");
  });

  it("skips code ranges", () => {
    const text = "`$x$` and $y$";
    expect(findMath(text, [[0, 5]]).map((s) => s.tex)).toEqual(["y"]);
  });
});

describe("live preview decorations", () => {
  const replaced = (doc: string, cursor: number | null) => {
    const out: string[] = [];
    const { decorations } = decorationsFor(doc, cursor);
    decorations.between(0, doc.length, (from, to, deco) => {
      if ((deco.spec as { widget?: unknown }).widget) out.push(doc.slice(from, to));
    });
    return out;
  };

  it("renders maths when the cursor is elsewhere", () => {
    expect(replaced("see $x^2$ here", null)).toContain("$x^2$");
  });

  it("shows the source when the cursor is inside", () => {
    expect(replaced("see $x^2$ here", 6)).not.toContain("$x^2$");
  });

  it("turns cloze openers into badges", () => {
    expect(replaced("{{c2::Paris}} is nice", null)).toContain("{{c2::");
  });
});

describe("highestCloze", () => {
  it("finds the largest cloze number", () => {
    expect(highestCloze("{{c1::a}} {{c12::b}} {{c3::c}}")).toBe(12);
    expect(highestCloze("none")).toBe(0);
  });
});
