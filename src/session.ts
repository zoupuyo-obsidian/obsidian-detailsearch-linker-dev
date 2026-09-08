import type { BodyHit } from './core/search/types';
import type { HighlightStyle } from './settings';

export type SessionMode = 'selection' | 'auto';

export interface SessionAnchor {
	id: string;
	from: number;
	to: number;
	text: string;
	groupKey: string;
}

export interface NoteCandidate {
	path: string;
	stem: string;
	title: string;
	hits: BodyHit[];
}

export interface ResultGroup {
	key: string;
	query: string;
	displayText: string;
	canLink: boolean;
	candidates: NoteCandidate[];
}

export interface DetailSessionState {
	filePath: string;
	mode: SessionMode;
	groups: ResultGroup[];
	anchors: SessionAnchor[];
	style: HighlightStyle;
	showBadge: boolean;
	caseSensitive: boolean;
}

export function emptySession(): DetailSessionState {
	return {
		filePath: '',
		mode: 'selection',
		groups: [],
		anchors: [],
		style: 'invert',
		showBadge: true,
		caseSensitive: false,
	};
}

export function getGroup(state: DetailSessionState, groupKey: string): ResultGroup | undefined {
	return state.groups.find((g) => g.key === groupKey);
}

export function groupCandidateCount(state: DetailSessionState, groupKey: string): number {
	return getGroup(state, groupKey)?.candidates.length ?? 0;
}

export function groupHitsToCandidates(
	hits: BodyHit[],
	resolveMeta: (path: string) => { stem: string; title: string },
): NoteCandidate[] {
	const byPath = new Map<string, BodyHit[]>();
	for (const hit of hits) {
		const list = byPath.get(hit.path) ?? [];
		list.push(hit);
		byPath.set(hit.path, list);
	}
	const out: NoteCandidate[] = [];
	for (const [path, pathHits] of byPath) {
		const meta = resolveMeta(path);
		out.push({
			path,
			stem: meta.stem,
			title: meta.title,
			hits: pathHits.sort((a, b) => a.offset - b.offset),
		});
	}
	out.sort((a, b) => a.path.localeCompare(b.path));
	return out;
}

export function sessionStats(state: DetailSessionState): {
	anchorCount: number;
	groupCount: number;
	linkedTermCount: number;
	candidateNoteCount: number;
} {
	const linkedKeys = new Set(
		state.groups.filter((g) => g.candidates.length > 0).map((g) => g.key),
	);
	const notePaths = new Set<string>();
	for (const group of state.groups) {
		for (const candidate of group.candidates) {
			notePaths.add(candidate.path);
		}
	}
	return {
		anchorCount: state.anchors.length,
		groupCount: state.groups.length,
		linkedTermCount: linkedKeys.size,
		candidateNoteCount: notePaths.size,
	};
}

export function buildSelectionSession(input: {
	filePath: string;
	group: ResultGroup;
	anchors: SessionAnchor[];
	style: HighlightStyle;
	showBadge: boolean;
	caseSensitive: boolean;
}): DetailSessionState {
	return {
		filePath: input.filePath,
		mode: 'selection',
		groups: [input.group],
		anchors: input.anchors,
		style: input.style,
		showBadge: input.showBadge,
		caseSensitive: input.caseSensitive,
	};
}

export function buildAutoSession(input: {
	filePath: string;
	groups: ResultGroup[];
	anchors: SessionAnchor[];
	style: HighlightStyle;
	showBadge: boolean;
	caseSensitive: boolean;
}): DetailSessionState {
	return {
		filePath: input.filePath,
		mode: 'auto',
		groups: input.groups,
		anchors: input.anchors,
		style: input.style,
		showBadge: input.showBadge,
		caseSensitive: input.caseSensitive,
	};
}
