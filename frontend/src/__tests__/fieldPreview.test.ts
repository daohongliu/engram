import { describe, expect, it } from "vitest";
import { renderFieldPreview } from "../lib/fieldPreview";

describe("renderFieldPreview", () => {
  it("renders Markdown and hands maths on in Anki's delimiters", () => {
    expect(renderFieldPreview("**bold** and $x^2_1$")).toBe("<strong>bold</strong> and \\(x^2_1\\)");
  });

  it("keeps TeX away from Markdown", () => {
    // Underscores and asterisks inside maths are not emphasis.
    expect(renderFieldPreview("$a_1 * b_2 * c$")).toBe("\\(a_1 * b_2 * c\\)");
    expect(renderFieldPreview("$$\n\\sum_{i} a_i\n$$")).toBe("\\[\\sum_{i} a_i\\]");
    expect(renderFieldPreview("$a<b$")).toBe("\\(a&lt;b\\)");
  });

  it("leaves dollars in code alone", () => {
    expect(renderFieldPreview("`$x$`")).toBe("<code>$x$</code>");
  });

  it("highlights clozes, and shows them as plain text inside maths", () => {
    expect(renderFieldPreview("{{c1::Paris::city}} is $\\pi \\approx {{c2::3.14}}$")).toBe(
      '<span class="cloze">Paris</span> is \\(\\pi \\approx 3.14\\)',
    );
  });

  it("sizes images like the server", () => {
    expect(renderFieldPreview("![Cell|300](cell.png)")).toBe('<img src="cell.png" width="300" alt="Cell">');
  });

  it("keeps paragraphs when there are several", () => {
    expect(renderFieldPreview("one\n\ntwo")).toBe("<p>one</p>\n<p>two</p>");
  });
});
