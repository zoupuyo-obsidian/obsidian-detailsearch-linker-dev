import {
	foldCase,
	foldCaseWithMapping,
	mapFoldedRange,
} from './caseFold';

export const LATIN = /[A-Za-z0-9]/;
export const LATIN_LETTER = /[A-Za-z]/;
export const JAPANESE_OR_HAN =
	/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
export const UNICODE_WORD = /[\p{L}\p{M}\p{N}_]/u;

export function normalizeTerm(value: string, caseSensitive: boolean): string {
	return caseSensitive ? value.trim() : foldCase(value.trim());
}

function codePointBefore(text: string, index: number): string {
	if (index <= 0) {
		return '';
	}
	let start = index - 1;
	const last = text.charCodeAt(start);
	if (last >= 0xdc00 && last <= 0xdfff && start > 0) {
		const first = text.charCodeAt(start - 1);
		if (first >= 0xd800 && first <= 0xdbff) {
			start--;
		}
	}
	const point = text.codePointAt(start);
	return point === undefined ? '' : String.fromCodePoint(point);
}

function codePointAt(text: string, index: number): string {
	const point = text.codePointAt(index);
	return point === undefined ? '' : String.fromCodePoint(point);
}

export function hasLatinBoundary(text: string, start: number, end: number): boolean {
	if (start > 0) {
		const before = text[start - 1] ?? '';
		if (LATIN.test(before)) {
			return false;
		}
	}
	if (end < text.length) {
		const after = text[end] ?? '';
		if (LATIN.test(after)) {
			return false;
		}
	}
	return true;
}

export function hasUnicodeBoundary(text: string, start: number, end: number): boolean {
	if (UNICODE_WORD.test(codePointBefore(text, start))) {
		return false;
	}
	if (UNICODE_WORD.test(codePointAt(text, end))) {
		return false;
	}
	return true;
}

export function needsBoundaryCheck(term: string): boolean {
	return LATIN_LETTER.test(term) || !JAPANESE_OR_HAN.test(term);
}

export function hasTermBoundary(text: string, start: number, end: number, term: string): boolean {
	return LATIN_LETTER.test(term)
		? hasLatinBoundary(text, start, end)
		: hasUnicodeBoundary(text, start, end);
}

export interface TermOccurrence {
	from: number;
	to: number;
	text: string;
}

export function findTermOccurrences(
	text: string,
	term: string,
	caseSensitive: boolean,
	protectedSpans: { start: number; end: number }[],
): TermOccurrence[] {
	const trimmed = term.trim();
	if (!trimmed) {
		return [];
	}
	const folded = caseSensitive ? null : foldCaseWithMapping(text);
	const scan = folded?.text ?? text;
	const needle = caseSensitive ? trimmed : foldCase(trimmed);
	const out: TermOccurrence[] = [];
	let pos = 0;
	while (pos <= scan.length - needle.length) {
		const idx = scan.indexOf(needle, pos);
		if (idx === -1) {
			break;
		}
		const foldedEnd = idx + needle.length;
		const mapped = folded
			? mapFoldedRange(folded, idx, foldedEnd)
			: { start: idx, end: foldedEnd };
		if (!mapped) {
			pos = idx + 1;
			continue;
		}
		const { start, end } = mapped;
		let skip = false;
		for (const span of protectedSpans) {
			if (span.start >= end) {
				break;
			}
			if (start < span.end && end > span.start) {
				skip = true;
				break;
			}
		}
		if (
			!skip &&
			(!needsBoundaryCheck(trimmed) || hasTermBoundary(text, start, end, trimmed))
		) {
			out.push({ from: start, to: end, text: text.slice(start, end) });
		}
		pos = idx + 1;
	}
	return out;
}

export function anchorStillValid(
	text: string,
	from: number,
	to: number,
	expected: string,
	caseSensitive: boolean,
): boolean {
	if (from < 0 || to <= from || to > text.length) {
		return false;
	}
	const slice = text.slice(from, to);
	return normalizeTerm(slice, caseSensitive) === normalizeTerm(expected, caseSensitive);
}
