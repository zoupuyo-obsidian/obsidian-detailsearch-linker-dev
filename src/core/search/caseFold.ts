export interface FoldedText {
	text: string;
	/** Maps valid folded-string boundaries back to UTF-16 offsets in the source. */
	sourceOffsetAtBoundary: readonly number[];
}

function foldCodePoint(point: string): string {
	// Default Unicode lowercasing distinguishes final sigma from sigma even though
	// they are the same letter for case-insensitive search.
	return point.toLowerCase().replace(/\u03c2/g, '\u03c3');
}

export function foldCase(value: string): string {
	let folded = '';
	for (const point of value) {
		folded += foldCodePoint(point);
	}
	return folded;
}

export function foldCaseWithMapping(value: string): FoldedText {
	let text = '';
	let sourceOffset = 0;
	const sourceOffsetAtBoundary: number[] = [0];

	for (const point of value) {
		const foldedPoint = foldCodePoint(point);
		const foldedStart = text.length;
		const sourceEnd = sourceOffset + point.length;
		text += foldedPoint;

		sourceOffsetAtBoundary[foldedStart] = sourceOffset;
		for (let i = foldedStart + 1; i < text.length; i++) {
			sourceOffsetAtBoundary[i] = -1;
		}
		sourceOffsetAtBoundary[text.length] = sourceEnd;
		sourceOffset = sourceEnd;
	}

	return { text, sourceOffsetAtBoundary };
}

export function mapFoldedRange(
	folded: FoldedText,
	start: number,
	end: number,
): { start: number; end: number } | null {
	const sourceStart = folded.sourceOffsetAtBoundary[start];
	const sourceEnd = folded.sourceOffsetAtBoundary[end];
	if (
		sourceStart === undefined ||
		sourceEnd === undefined ||
		sourceStart < 0 ||
		sourceEnd < sourceStart
	) {
		return null;
	}
	return { start: sourceStart, end: sourceEnd };
}
