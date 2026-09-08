export interface HighlightRangeItem {
	from: number;
	to: number;
	kind: 'mark' | 'widget';
	sortOrder: number;
}

/** Sort: from asc, mark before widget at same point, to asc. */
export function sortHighlightRanges(items: HighlightRangeItem[]): HighlightRangeItem[] {
	return [...items].sort(
		(a, b) => a.from - b.from || a.sortOrder - b.sortOrder || a.to - b.to,
	);
}

/**
 * Drop overlapping marks (widgets may share boundaries). Keeps first mark in sorted order.
 */
export function filterNonOverlappingMarks(items: HighlightRangeItem[]): HighlightRangeItem[] {
	const sorted = sortHighlightRanges(items);
	const out: HighlightRangeItem[] = [];
	let lastMarkEnd = -1;
	for (const item of sorted) {
		if (item.kind === 'mark') {
			if (item.from < lastMarkEnd) {
				continue;
			}
			lastMarkEnd = item.to;
		}
		out.push(item);
	}
	return out;
}

/** Build sorted, non-overlapping mark ranges for RangeSetBuilder (throws if overlap remains). */
export function prepareHighlightRanges(items: HighlightRangeItem[]): HighlightRangeItem[] {
	return filterNonOverlappingMarks(items);
}
