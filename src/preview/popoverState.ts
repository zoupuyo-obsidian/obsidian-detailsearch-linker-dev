import type {
	DetailSessionState,
	NoteCandidate,
	ResultGroup,
	SessionAnchor,
} from '../session';
import type { BodyHit } from '../core/search/types';
import { getGroup } from '../session';

export interface PopoverFocus {
	path: string;
	hitIndex: number;
}

export interface PopoverActionTarget {
	anchor: SessionAnchor;
	group: ResultGroup;
	candidate: NoteCandidate;
	hit: BodyHit;
	hitIndex: number;
}

export type HoverScheduleAction = 'keep' | 'schedule' | 'cancel';

export function resolveHoverSchedule(
	scheduledAnchorId: string | null,
	activeAnchorId: string | null,
	hasPopover: boolean,
	targetAnchorId: string | null,
): HoverScheduleAction {
	if (!targetAnchorId) {
		return 'cancel';
	}
	if (targetAnchorId === scheduledAnchorId) {
		return 'keep';
	}
	if (hasPopover && targetAnchorId === activeAnchorId) {
		return 'cancel';
	}
	return 'schedule';
}

export function resolveAnchorAtPosition(
	anchors: readonly SessionAnchor[],
	position: number,
): SessionAnchor | null {
	const matches = anchors.filter(
		(anchor) => anchor.from <= position && position <= anchor.to,
	);
	matches.sort(
		(a, b) =>
			a.to - a.from - (b.to - b.from) ||
			a.from - b.from ||
			a.to - b.to ||
			a.id.localeCompare(b.id),
	);
	return matches[0] ?? null;
}

function sortAnchors(anchors: readonly SessionAnchor[]): SessionAnchor[] {
	return [...anchors].sort(
		(a, b) => a.from - b.from || a.to - b.to || a.id.localeCompare(b.id),
	);
}

/** Next/previous highlight in document order. Wraps. Independent of badges. */
export function resolveAdjacentAnchor(
	anchors: readonly SessionAnchor[],
	position: number,
	direction: 1 | -1,
): SessionAnchor | null {
	if (anchors.length === 0) {
		return null;
	}
	const ordered = sortAnchors(anchors);
	const current = resolveAnchorAtPosition(anchors, position);
	if (current) {
		const idx = ordered.findIndex((item) => item.id === current.id);
		if (idx < 0) {
			return ordered[0] ?? null;
		}
		return ordered[(idx + direction + ordered.length) % ordered.length] ?? null;
	}
	if (direction === 1) {
		return ordered.find((item) => item.from > position) ?? ordered[0] ?? null;
	}
	const earlier = [...ordered]
		.reverse()
		.find((item) => item.to < position);
	return earlier ?? ordered[ordered.length - 1] ?? null;
}

export function normalizePopoverFocus(
	group: ResultGroup,
	focus: PopoverFocus,
): PopoverFocus {
	const candidate = group.candidates.find((item) => item.path === focus.path);
	if (!candidate) {
		return group.candidates[0]
			? { path: group.candidates[0].path, hitIndex: 0 }
			: { path: '', hitIndex: 0 };
	}
	if (candidate.hits.length === 0) {
		return { path: candidate.path, hitIndex: 0 };
	}
	return {
		path: candidate.path,
		hitIndex:
			focus.hitIndex >= 0 && focus.hitIndex < candidate.hits.length
				? focus.hitIndex
				: 0,
	};
}

export function stepPopoverFocus(
	group: ResultGroup,
	focus: PopoverFocus,
	axis: 'candidate' | 'hit',
	direction: 1 | -1,
): PopoverFocus {
	const current = normalizePopoverFocus(group, focus);
	if (group.candidates.length === 0) {
		return current;
	}
	if (axis === 'candidate') {
		const idx = Math.max(
			0,
			group.candidates.findIndex((item) => item.path === current.path),
		);
		const next =
			group.candidates[
				(idx + direction + group.candidates.length) % group.candidates.length
			];
		return { path: next?.path ?? '', hitIndex: 0 };
	}
	const candidate = group.candidates.find((item) => item.path === current.path);
	if (!candidate || candidate.hits.length === 0) {
		return current;
	}
	const hitCount = candidate.hits.length;
	return {
		path: candidate.path,
		hitIndex: (current.hitIndex + direction + hitCount) % hitCount,
	};
}

/** Wrap among focusable popover controls. `current < 0` starts at an end. */
export function stepFocusableIndex(
	count: number,
	current: number,
	direction: 1 | -1,
): number {
	if (count <= 0) {
		return -1;
	}
	if (current < 0) {
		return direction === 1 ? 0 : count - 1;
	}
	return (current + direction + count) % count;
}

/** Keys that must not reach the note while the popover is keyboard-armed. */
export function shouldConsumeArmedKey(
	key: string,
	options: { isComposing?: boolean; targetInsidePopover?: boolean } = {},
): boolean {
	if (options.isComposing || key === 'Process') {
		return true;
	}
	if (
		key === 'ArrowDown' ||
		key === 'ArrowUp' ||
		key === 'ArrowLeft' ||
		key === 'ArrowRight'
	) {
		return true;
	}
	if (key === 'Tab') {
		return true;
	}
	if (key === 'Enter' || key === ' ') {
		return !options.targetInsidePopover;
	}
	return key.length === 1 || key === 'Backspace' || key === 'Delete';
}

export function resolvePopoverActionTarget(
	session: DetailSessionState,
	anchorId: string,
	candidatePath: string,
	hitIndex: number,
): PopoverActionTarget | null {
	const anchor = session.anchors.find((item) => item.id === anchorId);
	if (!anchor) {
		return null;
	}
	const group = getGroup(session, anchor.groupKey);
	const candidate = group?.candidates.find((item) => item.path === candidatePath);
	if (!group || !candidate) {
		return null;
	}
	const resolvedHitIndex =
		hitIndex >= 0 && hitIndex < candidate.hits.length ? hitIndex : 0;
	const hit = candidate.hits[resolvedHitIndex];
	if (!hit) {
		return null;
	}
	return { anchor, group, candidate, hit, hitIndex: resolvedHitIndex };
}
