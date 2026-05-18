import { describe, expect, it } from "vitest";
import {
	parseCorrectionResponse,
	shouldCorrectLine,
	splitEditableLine,
	validateCorrection,
} from "./correction";

describe("splitEditableLine", () => {
	it("preserves list and task prefixes outside the LLM input", () => {
		expect(splitEditableLine("\t- [ ] teh thing")).toEqual({
			prefix: "\t- [ ] ",
			body: "teh thing",
		});
	});

	it("preserves blockquote prefixes outside the LLM input", () => {
		expect(splitEditableLine("> teh thing")).toEqual({
			prefix: "> ",
			body: "teh thing",
		});
	});
});

describe("shouldCorrectLine", () => {
	it("corrects prose-like lines", () => {
		expect(shouldCorrectLine("This sentnce has a typo").shouldCorrect).toBe(true);
	});

	it("skips empty and punctuation-only lines", () => {
		expect(shouldCorrectLine("   ").shouldCorrect).toBe(false);
		expect(shouldCorrectLine("... 123 !!!").shouldCorrect).toBe(false);
	});

	it("skips markdown structures that are easy to corrupt", () => {
		expect(shouldCorrectLine("# Headng").shouldCorrect).toBe(false);
		expect(shouldCorrectLine("#tag").shouldCorrect).toBe(false);
		expect(shouldCorrectLine("| --- | --- |").shouldCorrect).toBe(false);
	});

	it("skips URLs and email addresses", () => {
		expect(shouldCorrectLine("https://example.com/thng").shouldCorrect).toBe(false);
		expect(shouldCorrectLine("person@example.com").shouldCorrect).toBe(false);
	});
});

describe("parseCorrectionResponse", () => {
	it("parses compact JSON responses", () => {
		expect(parseCorrectionResponse('{"corrected":"the thing"}')).toBe("the thing");
	});

	it("falls back to legacy corrected_text tags", () => {
		expect(parseCorrectionResponse("<corrected_text>the thing</corrected_text>")).toBe(
			"the thing"
		);
	});
});

describe("validateCorrection", () => {
	it("accepts straightforward spelling corrections", () => {
		expect(validateCorrection("teh thing", "the thing")).toEqual({
			accepted: true,
			corrected: "the thing",
		});
	});

	it("rejects markdown structure that was not present in the original", () => {
		expect(validateCorrection("important thing", "#important thing").accepted).toBe(
			false
		);
		expect(validateCorrection("important thing", "[[important thing]]").accepted).toBe(
			false
		);
	});

	it("rejects noisy rewrites", () => {
		expect(validateCorrection("teh thing", "the thing\n\nextra").accepted).toBe(
			false
		);
		expect(validateCorrection("short", "a very long rewrite that is not autocorrect").accepted).toBe(
			false
		);
	});
});
