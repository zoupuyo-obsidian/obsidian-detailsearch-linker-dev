import {
	type ChangeDesc,
	type EditorState,
	Facet,
	RangeSetBuilder,
	StateEffect,
	StateField,
	type Extension,
} from '@codemirror/state';
import {
	Decoration,
	EditorView,
	ViewPlugin,
	WidgetType,
	type DecorationSet,
	type ViewUpdate,
} from '@codemirror/view';
import {
	emptySession,
	getGroup,
	groupCandidateCount,
	type DetailSessionState,
	type SessionAnchor,
} from '../session';
import { foldCase } from '../core/search/caseFold';
import { prepareHighlightRanges, type HighlightRangeItem } from './highlightRanges';

export const setDetailSessionEffect = StateEffect.define<DetailSessionState>();

class BadgeWidget extends WidgetType {
	constructor(
		private readonly count: number,
		private readonly anchorId: string,
		private readonly ariaLabel: string,
	) {
		super();
	}

	eq(other: BadgeWidget): boolean {
		return (
			this.count === other.count &&
			this.anchorId === other.anchorId &&
			this.ariaLabel === other.ariaLabel
		);
	}

	toDOM(view: EditorView): HTMLElement {
		const el = view.dom.ownerDocument.createElement('button');
		el.className = 'cm-detailsearch-linker-badge';
		el.dataset.anchorId = this.anchorId;
		el.textContent = String(this.count);
		el.type = 'button';
		el.setAttribute('aria-haspopup', 'dialog');
		el.setAttribute('aria-label', this.ariaLabel);
		return el;
	}

	ignoreEvent(): boolean {
		return false;
	}
}

interface PlannedRange {
	from: number;
	to: number;
	kind: 'mark' | 'widget';
	anchor: SessionAnchor;
}

export function planHighlightRanges(
	state: DetailSessionState,
	doc: string,
): HighlightRangeItem[] {
	const planned = collectPlannedRanges(state, doc);
	return prepareHighlightRanges(
		planned.map((p) => ({
			from: p.from,
			to: p.to,
			kind: p.kind,
			sortOrder: p.kind === 'mark' ? 0 : 1,
		})),
	);
}

function collectPlannedRanges(
	state: DetailSessionState,
	doc: string,
): PlannedRange[] {
	const planned: PlannedRange[] = [];
	for (const anchor of state.anchors) {
		if (
			anchor.to - anchor.from !== anchor.text.length ||
			!anchorTextMatches(doc, anchor, state.caseSensitive)
		) {
			continue;
		}
		planned.push({ from: anchor.from, to: anchor.to, kind: 'mark', anchor });
		const badgeCount = groupCandidateCount(state, anchor.groupKey);
		if (state.showBadge && badgeCount > 0) {
			planned.push({ from: anchor.to, to: anchor.to, kind: 'widget', anchor });
		}
	}
	return planned;
}

function buildDecorations(
	state: DetailSessionState,
	doc: string,
	badgeAriaLabel: (count: number) => string,
): DecorationSet {
	if (state.anchors.length === 0) {
		return Decoration.none;
	}
	const planned = collectPlannedRanges(state, doc);
	const plannedByRange = new Map<string, PlannedRange>();
	for (const range of planned) {
		const key = `${range.from}\0${range.to}\0${range.kind}`;
		if (!plannedByRange.has(key)) {
			plannedByRange.set(key, range);
		}
	}
	const safe = prepareHighlightRanges(
		planned.map((p) => ({
			from: p.from,
			to: p.to,
			kind: p.kind,
			sortOrder: p.kind === 'mark' ? 0 : 1,
		})),
	);
	const builder = new RangeSetBuilder<Decoration>();
	for (const item of safe) {
		const match = plannedByRange.get(`${item.from}\0${item.to}\0${item.kind}`);
		if (!match) {
			continue;
		}
		if (item.kind === 'mark') {
			builder.add(
				item.from,
				item.to,
				Decoration.mark({
					class: `cm-detailsearch-linker-mark is-${state.style}`,
					attributes: { 'data-anchor-id': match.anchor.id },
				}),
			);
		} else {
			const badgeCount = groupCandidateCount(state, match.anchor.groupKey);
			builder.add(
				item.from,
				item.to,
				Decoration.widget({
					widget: new BadgeWidget(
						badgeCount,
						match.anchor.id,
						badgeAriaLabel(badgeCount),
					),
					side: 1,
				}),
			);
		}
	}
	return builder.finish();
}

export const bindEditorFilePathEffect = StateEffect.define<string>();

export const editorBoundPathField = StateField.define<string>({
	create: () => '',
	update(value, tr) {
		for (const effect of tr.effects) {
			if (effect.is(bindEditorFilePathEffect)) {
				return effect.value;
			}
		}
		return value;
	},
});

export function readDetailSession(state: EditorState): DetailSessionState | null {
	return state.field(detailSessionField, false) ?? null;
}

export function readBoundEditorPath(state: EditorState): string {
	return state.field(editorBoundPathField, false) ?? '';
}

export function canPaintSession(
	session: DetailSessionState,
	boundPath: string,
	doc: string,
): boolean {
	return (
		!!session.filePath &&
		session.filePath === boundPath &&
		sessionMatchesDocument(session, doc)
	);
}

export function isFullDocumentReplacement(
	changes: ChangeDesc,
	oldDocLength: number,
): boolean {
	if (oldDocLength <= 0) {
		return false;
	}
	let coveredUntil = 0;
	let hasChangedContent = false;
	changes.iterChangedRanges((fromA, toA) => {
		if (fromA > coveredUntil || toA <= fromA) {
			return;
		}
		hasChangedContent = true;
		coveredUntil = Math.max(coveredUntil, toA);
	});
	// Obsidian file switches sometimes leave a trailing newline unreplaced.
	return hasChangedContent && coveredUntil >= Math.max(1, oldDocLength - 1);
}

function anchorTextMatches(
	doc: string,
	anchor: SessionAnchor,
	caseSensitive: boolean,
): boolean {
	if (anchor.from < 0 || anchor.to <= anchor.from || anchor.to > doc.length) {
		return false;
	}
	const current = doc.slice(anchor.from, anchor.to);
	return caseSensitive
		? current === anchor.text
		: foldCase(current) === foldCase(anchor.text);
}

/** True when at least one session anchor still sits on the same text in `doc`. */
export function sessionMatchesDocument(
	state: DetailSessionState,
	doc: string,
): boolean {
	return state.anchors.some(
		(anchor) =>
			anchor.to - anchor.from === anchor.text.length &&
			anchorTextMatches(doc, anchor, state.caseSensitive),
	);
}

export const detailSessionField = StateField.define<DetailSessionState>({
	create: () => emptySession(),
	update(value, tr) {
		// A reused EditorView can replace its whole document before file-open clears
		// the old file's session. Never map those anchors into the new note.
		if (
			tr.docChanged &&
			isFullDocumentReplacement(tr.changes, tr.startState.doc.length)
		) {
			return emptySession();
		}
		for (const effect of tr.effects) {
			if (effect.is(setDetailSessionEffect)) {
				return effect.value;
			}
		}
		if (!tr.docChanged || value.anchors.length === 0) {
			return value;
		}
		const mapped: SessionAnchor[] = [];
		const nextDoc = tr.newDoc.toString();
		for (const anchor of value.anchors) {
			let contentWasChanged = false;
			tr.changes.iterChangedRanges((fromA, toA) => {
				if (fromA < anchor.to && toA > anchor.from) {
					contentWasChanged = true;
				}
			});
			const from = tr.changes.mapPos(anchor.from, contentWasChanged ? -1 : 1);
			const to = tr.changes.mapPos(anchor.to, contentWasChanged ? 1 : -1);
			const next = { ...anchor, from, to };
			if (
				next.to - next.from === next.text.length &&
				anchorTextMatches(nextDoc, next, value.caseSensitive)
			) {
				mapped.push(next);
			}
		}
		return mapped.length > 0 ? { ...value, anchors: mapped } : emptySession();
	},
});

const badgeAriaLabelFacet = Facet.define<(count: number) => string>();

function buildViewDecorations(view: EditorView): DecorationSet {
	const session = readDetailSession(view.state);
	const doc = view.state.doc.toString();
	if (
		!session ||
		!canPaintSession(session, readBoundEditorPath(view.state), doc)
	) {
		return Decoration.none;
	}
	const label =
		view.state.facet(badgeAriaLabelFacet)[0] ??
		((count: number) => `${count} link candidates`);
	return buildDecorations(session, doc, label);
}

export function detailsearchLinkerEditorExtension(
	badgeAriaLabel: (count: number) => string = (count) =>
		`${count} link candidates`,
): Extension {
	return [
		detailSessionField,
		editorBoundPathField,
		badgeAriaLabelFacet.of(badgeAriaLabel),
		// Rebuild from the current session+doc on every update. A computed
		// DecorationSet is mapped through file-switch replacements and can
		// stretch source marks across the newly opened note.
		ViewPlugin.fromClass(
			class {
				decorations: DecorationSet;
				constructor(view: EditorView) {
					this.decorations = buildViewDecorations(view);
				}
				update(update: ViewUpdate) {
					this.decorations = buildViewDecorations(update.view);
				}
			},
			{ decorations: (plugin) => plugin.decorations },
		),
	];
}
export function findAnchorIdFromEventTarget(target: EventTarget | null): string | null {
	if (!(target instanceof Element)) {
		return null;
	}
	const el = target.closest('[data-anchor-id]');
	return el instanceof HTMLElement ? (el.dataset.anchorId ?? null) : null;
}

export { getGroup };
