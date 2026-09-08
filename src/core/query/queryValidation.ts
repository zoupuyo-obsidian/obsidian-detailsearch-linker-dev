export const MAX_QUERY_LENGTH = 256;
export const MAX_FILE_BYTES = 2_000_000;

export type QueryValidationError = 'empty' | 'newline' | 'too_long' | 'link_syntax';

export function validateQuery(raw: string): QueryValidationError | null {
	const trimmed = raw.trim();
	if (!trimmed) {
		return 'empty';
	}
	if (/[\r\n]/.test(raw)) {
		return 'newline';
	}
	if (/[|[\]]/.test(trimmed)) {
		return 'link_syntax';
	}
	if (trimmed.length > MAX_QUERY_LENGTH) {
		return 'too_long';
	}
	return null;
}

export function trimSelectionRange(
	text: string,
	selectionFrom: number,
	selectionTo: number,
): { from: number; to: number; query: string; displayText: string } | null {
	const raw = text.slice(selectionFrom, selectionTo);
	const query = raw.trim();
	if (!query) {
		return null;
	}
	const leading = raw.length - raw.trimStart().length;
	const trailing = raw.length - raw.trimEnd().length;
	const from = selectionFrom + leading;
	const to = selectionTo - trailing;
	return { from, to, query, displayText: text.slice(from, to) };
}
