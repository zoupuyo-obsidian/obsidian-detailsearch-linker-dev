import {
	foldCase,
	foldCaseWithMapping,
	mapFoldedRange,
} from '../core/search/caseFold';

export interface HighlightSegment {
	text: string;
	highlighted: boolean;
}

/** Split excerpt text into plain/highlighted segments for a query. */
export function splitHighlightedText(
	excerpt: string,
	query: string,
	caseSensitive: boolean,
): HighlightSegment[] {
	if (!excerpt) {
		return [];
	}
	const trimmed = query.trim();
	if (!trimmed) {
		return [{ text: excerpt, highlighted: false }];
	}

	const folded = caseSensitive ? null : foldCaseWithMapping(excerpt);
	const needle = caseSensitive ? trimmed : foldCase(trimmed);
	const haystack = folded?.text ?? excerpt;
	if (!needle || haystack.length < needle.length) {
		return [{ text: excerpt, highlighted: false }];
	}

	const segments: HighlightSegment[] = [];
	let pos = 0;
	let sourcePos = 0;
	while (pos <= haystack.length - needle.length) {
		const idx = haystack.indexOf(needle, pos);
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
		if (mapped.start > sourcePos) {
			segments.push({
				text: excerpt.slice(sourcePos, mapped.start),
				highlighted: false,
			});
		}
		segments.push({
			text: excerpt.slice(mapped.start, mapped.end),
			highlighted: true,
		});
		sourcePos = mapped.end;
		pos = foldedEnd;
	}
	if (sourcePos < excerpt.length) {
		segments.push({ text: excerpt.slice(sourcePos), highlighted: false });
	}
	if (segments.length === 0) {
		return [{ text: excerpt, highlighted: false }];
	}
	return segments;
}

export function fillHighlightedExcerpt(
	container: HTMLElement,
	excerpt: string,
	query: string,
	caseSensitive: boolean,
	style: string,
): void {
	container.replaceChildren();
	container.addClass('detailsearch-linker-popover__excerpt');
	for (const segment of splitHighlightedText(excerpt, query, caseSensitive)) {
		if (segment.highlighted) {
			const span = container.createSpan({
				cls: `detailsearch-linker-popover__term is-${style}`,
			});
			span.textContent = segment.text;
		} else if (segment.text) {
			container.appendText(segment.text);
		}
	}
}
