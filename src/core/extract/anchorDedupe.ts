import type { ExtractSource } from './queryExtractor';

export interface ScoredAnchorInput {
	from: number;
	to: number;
	text: string;
	score: number;
	groupKey: string;
	source: ExtractSource;
	stableIndex: number;
}

function rangesOverlap(a: { from: number; to: number }, b: { from: number; to: number }): boolean {
	return a.from < b.to && b.from < a.to;
}

/**
 * Greedy non-overlap selection across all auto candidates.
 * Priority: score desc → longer range → earlier from → stable index asc.
 */
export function dedupeOverlappingAnchors(anchors: ScoredAnchorInput[]): ScoredAnchorInput[] {
	const sorted = [...anchors].sort(
		(a, b) =>
			b.score - a.score ||
			b.to - b.from - (a.to - a.from) ||
			a.from - b.from ||
			a.stableIndex - b.stableIndex,
	);
	const kept: ScoredAnchorInput[] = [];
	for (const cand of sorted) {
		if (cand.to <= cand.from) {
			continue;
		}
		if (kept.some((k) => rangesOverlap(k, cand))) {
			continue;
		}
		kept.push(cand);
	}
	return kept.sort((a, b) => a.from - b.from || a.stableIndex - b.stableIndex);
}

export function anchorIdentity(from: number, to: number, groupKey: string): string {
	return `${groupKey}\0${from}\0${to}`;
}
