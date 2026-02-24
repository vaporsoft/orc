import { describe, it, expect } from "vitest";
import { quoteCommentBody, containsQuotedComment } from "../src/utils/quoting.js";

describe("quoteCommentBody", () => {
  it("prefixes each line with '> '", () => {
    expect(quoteCommentBody("hello")).toBe("> hello");
  });

  it("handles multi-line bodies", () => {
    expect(quoteCommentBody("line 1\nline 2\nline 3")).toBe(
      "> line 1\n> line 2\n> line 3",
    );
  });

  it("handles empty strings", () => {
    expect(quoteCommentBody("")).toBe("> ");
  });

  it("handles lines with existing '>' prefixes", () => {
    expect(quoteCommentBody("> already quoted")).toBe("> > already quoted");
  });
});

describe("containsQuotedComment", () => {
  it("detects an exact quoted block in a reply", () => {
    const original = "This is the comment";
    const reply = `> This is the comment\n\nAddressed in abc1234.`;
    expect(containsQuotedComment(reply, original)).toBe(true);
  });

  it("detects a multi-line quoted block", () => {
    const original = "line 1\nline 2";
    const reply = `> line 1\n> line 2\n\nFixed.`;
    expect(containsQuotedComment(reply, original)).toBe(true);
  });

  it("returns false when the quote is not present", () => {
    const original = "This is the comment";
    const reply = "Some other reply without quoting";
    expect(containsQuotedComment(reply, original)).toBe(false);
  });

  it("returns false on partial match", () => {
    const original = "line 1\nline 2";
    const reply = "> line 1\n> different line";
    expect(containsQuotedComment(reply, original)).toBe(false);
  });

  it("handles quoted block in the middle of a reply", () => {
    const original = "the comment";
    const reply = `Preamble\n> the comment\n\nPostscript`;
    expect(containsQuotedComment(reply, original)).toBe(true);
  });

  it("handles empty original body", () => {
    const original = "";
    const reply = "> \n\nReplied.";
    expect(containsQuotedComment(reply, original)).toBe(true);
  });

  it("does not false-positive on substring matches", () => {
    const original = "short";
    // The reply has a longer line that contains "short" but isn't an exact quote
    const reply = "> short but longer\n\nDone.";
    expect(containsQuotedComment(reply, original)).toBe(false);
  });
});
