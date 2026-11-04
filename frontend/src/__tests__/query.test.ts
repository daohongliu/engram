import { describe, expect, it } from "vitest";
import { currentToken, describeToken, parseQuery, removeToken, suggest, toggleTerm } from "../lib/query";

describe("describing queries", () => {
  it("reads common terms as English", () => {
    expect(describeToken("#calculus").phrase).toBe("tagged calculus");
    expect(describeToken('"deck:Maths::Analysis"').phrase).toBe("in Maths › Analysis");
    expect(describeToken("is:due").phrase).toBe("due today");
    expect(describeToken("prop:ivl>=30").phrase).toBe("with interval ≥ 30 days");
    expect(describeToken("prop:d>0.7").phrase).toBe("with difficulty > 70%");
    expect(describeToken("rated:7:1").phrase).toBe("answered as again in the last 7 days");
    expect(describeToken("matrix").phrase).toBe("containing “matrix”");
  });

  it("handles negation and joiners", () => {
    const terms = parseQuery("-is:suspended or (#a #b)");
    expect(terms.map((t) => t.kind)).toEqual(["term", "or", "open", "term", "term", "close"]);
    expect(terms[0].negated).toBe(true);
  });
});

describe("editing queries", () => {
  it("removes a chip's token", () => {
    const q = "#a is:due matrix";
    const t = parseQuery(q)[1];
    expect(removeToken(q, t)).toBe("#a matrix");
  });

  it("toggles facet terms", () => {
    expect(toggleTerm("#a", "is:new")).toBe("#a is:new");
    expect(toggleTerm("#a is:new", "is:new")).toBe("#a");
  });

  it("finds the token under the caret", () => {
    expect(currentToken("is:due #li", 10).text).toBe("#li");
    expect(currentToken('@"linear al', 11).text).toBe('@"linear al');
  });
});

describe("suggestions", () => {
  const vocab = { decks: ["Maths", "Maths::Linear Algebra"], tags: ["linalg", "analysis"], notetypes: [{ name: "Basic" }] };
  it("completes tags and decks", () => {
    expect(suggest("#lin", vocab)[0].insert).toBe("#linalg");
    expect(suggest("@line", vocab)[0].insert).toBe('"deck:Maths::Linear Algebra"');
    expect(suggest("is:", vocab).some((s) => s.insert === "is:due")).toBe(true);
  });
});
