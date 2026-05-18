export interface EditableLine {
	prefix: string;
	body: string;
}

export interface CorrectionDecision {
	shouldCorrect: boolean;
	reason?: string;
	editable: EditableLine;
}

export interface CorrectionValidation {
	accepted: boolean;
	corrected?: string;
	reason?: string;
}

const DEFAULT_MIN_LETTERS = 3;
const MAX_LENGTH_MULTIPLIER = 2.5;
const MAX_LENGTH_SLACK = 24;

export function splitEditableLine(line: string): EditableLine {
	const match = line.match(
		/^(\s*(?:(?:[-*+]\s+(?:\[[ xX]\]\s+)?)|(?:\d+[.)]\s+)|(?:>\s+))*)(.*)$/
	);

	return {
		prefix: match ? match[1] : "",
		body: match ? match[2] : line,
	};
}

export function shouldCorrectLine(line: string): CorrectionDecision {
	const editable = splitEditableLine(line);
	const body = editable.body.trim();

	if (!body) {
		return { shouldCorrect: false, reason: "empty", editable };
	}

	if (isProtectedMarkdownLine(line)) {
		return { shouldCorrect: false, reason: "protected-markdown", editable };
	}

	if (countLetters(body) < DEFAULT_MIN_LETTERS) {
		return { shouldCorrect: false, reason: "not-enough-letters", editable };
	}

	if (!/[A-Za-z]/.test(body)) {
		return { shouldCorrect: false, reason: "no-ascii-letters", editable };
	}

	if (/^[\W\d_]+$/.test(body)) {
		return { shouldCorrect: false, reason: "punctuation-or-numbers", editable };
	}

	if (isLikelyUrlOrEmail(body)) {
		return { shouldCorrect: false, reason: "url-or-email", editable };
	}

	return { shouldCorrect: true, editable };
}

export function buildCorrectionPrompt(text: string): string {
	return [
		"You are an autocorrect engine for a Markdown note editor.",
		"Correct only clear spelling mistakes in the input text.",
		"Preserve the user's wording, casing, punctuation, whitespace, Markdown meaning, and language.",
		"Do not add tags, hashtags, links, headings, bullets, frontmatter, code blocks, or new Markdown structure.",
		"Return only compact JSON in this exact shape: {\"corrected\":\"...\"}.",
		"",
		JSON.stringify({ text }),
	].join("\n");
}

export function parseCorrectionResponse(content: string): string | null {
	const parsedJson = parseJsonCorrection(content);
	if (parsedJson !== null) {
		return parsedJson;
	}

	const tagMatch = content.match(/<corrected_text>([\s\S]*?)<\/corrected_text>/i);
	if (tagMatch) {
		return tagMatch[1];
	}

	return content.trim() ? content.trim() : null;
}

export function validateCorrection(
	original: string,
	candidate: string | null
): CorrectionValidation {
	if (candidate === null) {
		return { accepted: false, reason: "missing-correction" };
	}

	if (/\r?\n/.test(candidate)) {
		return { accepted: false, reason: "added-newline" };
	}

	const corrected = candidate.replace(/\r?\n/g, " ").trim();
	const originalTrimmed = original.trim();

	if (!corrected) {
		return { accepted: false, reason: "empty-correction" };
	}

	if (corrected === original) {
		return { accepted: false, reason: "unchanged" };
	}

	if (corrected.length > original.length * MAX_LENGTH_MULTIPLIER + MAX_LENGTH_SLACK) {
		return { accepted: false, reason: "too-long" };
	}

	if (!original.includes("#") && corrected.includes("#")) {
		return { accepted: false, reason: "added-hashtag" };
	}

	if (!original.includes("[[") && corrected.includes("[[")) {
		return { accepted: false, reason: "added-wikilink" };
	}

	if (!original.includes("](") && /\[[^\]]+\]\([^)]+\)/.test(corrected)) {
		return { accepted: false, reason: "added-markdown-link" };
	}

	if (!originalTrimmed.startsWith("#") && corrected.trimStart().startsWith("#")) {
		return { accepted: false, reason: "added-heading" };
	}

	if (!original.includes("```") && corrected.includes("```")) {
		return { accepted: false, reason: "added-code-fence" };
	}

	return { accepted: true, corrected };
}

function parseJsonCorrection(content: string): string | null {
	const direct = parseJsonObject(content);
	if (direct !== null) {
		return direct;
	}

	const objectMatch = content.match(/\{[\s\S]*\}/);
	return objectMatch ? parseJsonObject(objectMatch[0]) : null;
}

function parseJsonObject(content: string): string | null {
	try {
		const parsed = JSON.parse(content) as { corrected?: unknown };
		return typeof parsed.corrected === "string" ? parsed.corrected : null;
	} catch {
		return null;
	}
}

function countLetters(text: string): number {
	const matches = text.match(/[A-Za-z]/g);
	return matches ? matches.length : 0;
}

function isProtectedMarkdownLine(line: string): boolean {
	const trimmed = line.trim();
	return (
		/^#{1,6}\s/.test(trimmed) ||
		/^```/.test(trimmed) ||
		/^---$/.test(trimmed) ||
		/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(trimmed) ||
		/^#\S+$/.test(trimmed)
	);
}

function isLikelyUrlOrEmail(text: string): boolean {
	return (
		/^https?:\/\//i.test(text) ||
		/^www\./i.test(text) ||
		/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)
	);
}
