import { Platform } from 'obsidian';
import type { BodyHit } from '../core/search/types';
import { getGroup, type DetailSessionState, type NoteCandidate, type ResultGroup, type SessionAnchor } from '../session';
import { t } from '../i18n';
import type { UiLanguage } from '../settings';
import { fillHighlightedExcerpt } from './splitHighlightedText';
import { findAnchorIdFromEventTarget } from '../editor/highlighter';
import {
	normalizePopoverFocus,
	resolveHoverSchedule,
	resolvePopoverActionTarget,
	shouldConsumeArmedKey,
	stepFocusableIndex,
} from './popoverState';

export interface PreviewHost {
	getLang: () => UiLanguage;
	getSession: () => DetailSessionState;
	createLink(anchor: SessionAnchor, candidatePath: string, hitIndex: number): void;
	openNote(path: string, heading: string): void;
	clearSession(): void;
	hasActiveSession(): boolean;
	ignoreTerm(query: string, groupKey: string): void;
	resolveExcerpt(hit: BodyHit, query: string): string | Promise<string>;
}

const SHOW_DELAY_MS = 280;
const HIDE_DELAY_MS = 200;

export class DetailHoverController {
	private popover: HTMLElement | null = null;
	private host: PreviewHost | null = null;
	private showTimer: number | null = null;
	private hideTimer: number | null = null;
	private scheduledAnchorId: string | null = null;
	private activeAnchorId: string | null = null;
	private focusedPath = '';
	private focusedHitIndex = 0;
	private cleanupDom: (() => void) | null = null;
	private suppressMouseUntil = 0;
	private opener: HTMLElement | null = null;
	private editorDom: HTMLElement | null = null;
	private keyboardArmed = false;
	private stickyOpen = false;

	attach(editorDom: HTMLElement, host: PreviewHost): void {
		this.detach();
		this.host = host;
		this.editorDom = editorDom;

		const onMove = (evt: MouseEvent): void => {
			if (Date.now() < this.suppressMouseUntil) {
				return;
			}
			if (Platform.isMobile) {
				return;
			}
			const id = findAnchorIdFromEventTarget(evt.target);
			if (!id) {
				if (this.popover && evt.target instanceof Node && this.popover.contains(evt.target)) {
					this.clearHide();
					return;
				}
				if (this.stickyOpen) {
					return;
				}
				this.scheduleHide();
				return;
			}
			this.scheduleShow(id, evt.clientX, evt.clientY);
		};
		const onLeave = (): void => {
			if (this.stickyOpen) {
				return;
			}
			this.scheduleHide();
		};

		const onClick = (evt: MouseEvent): void => {
			const id = findAnchorIdFromEventTarget(evt.target);
			if (!id) {
				return;
			}
			const badge =
				evt.target instanceof Element && evt.target.closest('.cm-detailsearch-linker-badge');
			if (!Platform.isMobile && !badge) {
				return;
			}
			evt.preventDefault();
			evt.stopPropagation();
			this.suppressMouseUntil = Date.now() + 500;
			const opener =
				evt.target instanceof Element
					? evt.target.closest<HTMLElement>('.cm-detailsearch-linker-badge')
					: null;
			const rect = opener?.getBoundingClientRect();
			const x = evt.clientX || rect?.left || 0;
			const y = evt.clientY || rect?.bottom || 0;
			this.keyboardArmed = true;
			this.stickyOpen = true;
			void this.show(id, x, y, opener);
		};

		const onKeyDown = (evt: KeyboardEvent): void => {
			this.handlePopoverKey(evt);
		};
		const onEditorPointerDown = (evt: PointerEvent): void => {
			if (findAnchorIdFromEventTarget(evt.target)) {
				return;
			}
			this.stickyOpen = false;
			this.keyboardArmed = false;
			if (this.popover) {
				this.hide({ restoreEditorFocus: false });
			}
		};

		editorDom.addEventListener('mousemove', onMove);
		editorDom.addEventListener('mouseleave', onLeave);
		editorDom.addEventListener('click', onClick, true);
		editorDom.addEventListener('pointerdown', onEditorPointerDown);
		editorDom.ownerDocument.addEventListener('keydown', onKeyDown, true);

		this.cleanupDom = () => {
			editorDom.removeEventListener('mousemove', onMove);
			editorDom.removeEventListener('mouseleave', onLeave);
			editorDom.removeEventListener('click', onClick, true);
			editorDom.removeEventListener('pointerdown', onEditorPointerDown);
			editorDom.ownerDocument.removeEventListener('keydown', onKeyDown, true);
		};
	}

	detach(): void {
		this.hide({ restoreEditorFocus: false });
		this.cleanupDom?.();
		this.cleanupDom = null;
		this.host = null;
		this.editorDom = null;
	}

	hide(options: { restoreEditorFocus?: boolean } = {}): void {
		const popover = this.popover;
		const active = popover?.ownerDocument.activeElement;
		const restoreEditorFocus =
			options.restoreEditorFocus !== false &&
			!!popover &&
			active instanceof Node &&
			popover.contains(active);
		this.clearShow();
		this.clearHide();
		popover?.remove();
		this.popover = null;
		this.activeAnchorId = null;
		this.focusedPath = '';
		this.focusedHitIndex = 0;
		this.opener = null;
		this.keyboardArmed = false;
		this.stickyOpen = false;
		this.suppressMouseUntil = 0;
		if (restoreEditorFocus) {
			this.focusEditor();
		}
	}

	hasOpenPopover(): boolean {
		return !!this.popover;
	}

	openAnchorNow(id: string): boolean {
		const host = this.host;
		const anchor = host?.getSession().anchors.find((item) => item.id === id);
		const anchorEl = this.findAnchorElement(id);
		if (!host || !anchor || !anchorEl) {
			return false;
		}
		const badge = anchorEl.matches('.cm-detailsearch-linker-badge')
			? anchorEl
			: this.findAnchorElement(id, '.cm-detailsearch-linker-badge');
		const rect = anchorEl.getBoundingClientRect();
		this.keyboardArmed = true;
		this.stickyOpen = true;
		void this.show(id, rect.left, rect.bottom, badge);
		return true;
	}

	private scheduleShow(id: string, x: number, y: number): void {
		this.clearHide();
		const action = resolveHoverSchedule(
			this.scheduledAnchorId,
			this.activeAnchorId,
			!!this.popover,
			id,
		);
		if (action === 'keep') {
			return;
		}
		if (action === 'cancel') {
			this.clearShow();
			return;
		}
		this.clearShow();
		this.scheduledAnchorId = id;
		this.showTimer = window.setTimeout(() => {
			this.showTimer = null;
			this.scheduledAnchorId = null;
			void this.show(id, x, y);
		}, SHOW_DELAY_MS);
	}

	private scheduleHide(): void {
		this.clearShow();
		this.clearHide();
		this.hideTimer = window.setTimeout(() => this.hide(), HIDE_DELAY_MS);
	}

	private clearShow(): void {
		if (this.showTimer !== null) {
			window.clearTimeout(this.showTimer);
			this.showTimer = null;
		}
		this.scheduledAnchorId = null;
	}

	private clearHide(): void {
		if (this.hideTimer !== null) {
			window.clearTimeout(this.hideTimer);
			this.hideTimer = null;
		}
	}

	private async show(
		id: string,
		x: number,
		y: number,
		opener: HTMLElement | null = null,
	): Promise<void> {
		const host = this.host;
		const session = host?.getSession();
		const anchor = session?.anchors.find((item) => item.id === id);
		if (!host || !anchor || !session) {
			return;
		}
		const group = getGroup(session, anchor.groupKey);
		if (!group) {
			return;
		}
		this.clearShow();
		this.clearHide();
		this.activeAnchorId = id;
		this.opener = opener;
		this.keyboardArmed = true;
		const focus = normalizePopoverFocus(group, {
			path: this.focusedPath,
			hitIndex: this.focusedHitIndex,
		});
		this.focusedPath = focus.path;
		this.focusedHitIndex = focus.hitIndex;
		await this.render(anchor, group, session, host, x, y);
	}

	private async render(
		anchor: SessionAnchor,
		group: ResultGroup,
		session: DetailSessionState,
		host: PreviewHost,
		x: number,
		y: number,
	): Promise<void> {
		this.popover?.remove();
		const doc = activeDocument;
		const pop = doc.body.createDiv({ cls: 'detailsearch-linker-popover' });
		pop.setAttr('role', 'dialog');
		pop.tabIndex = -1;
		this.popover = pop;

		pop.addEventListener('mouseenter', () => this.clearHide());
		pop.addEventListener('mouseleave', () => {
			if (this.stickyOpen) {
				return;
			}
			this.scheduleHide();
		});
		pop.addEventListener('pointerdown', () => {
			this.keyboardArmed = true;
			this.stickyOpen = true;
		});
		pop.addEventListener('focusin', (evt) => {
			this.keyboardArmed = true;
			if (evt.target instanceof HTMLElement) {
				this.syncSelectionFromElement(evt.target, true);
			}
		});
		pop.addEventListener('keydown', (evt) => this.handlePopoverKey(evt), true);

		const lang = host.getLang();
		pop.createDiv({ cls: 'detailsearch-linker-popover__match', text: anchor.text });

		if (!group.canLink) {
			pop.createDiv({
				cls: 'detailsearch-linker-popover__warn',
				text: t(lang, 'popoverNoAnchor'),
			});
		}

		const list = pop.createDiv({ cls: 'detailsearch-linker-popover__list' });
		for (const candidate of group.candidates) {
			const row = list.createEl('button', {
				cls: 'detailsearch-linker-popover__row',
				type: 'button',
			});
			row.dataset.candidatePath = candidate.path;
			if (candidate.path === this.focusedPath) {
				row.addClass('is-focused');
			}
			row.createSpan({
				cls: 'detailsearch-linker-popover__name',
				text: candidate.title || candidate.stem,
			});
			if (candidate.hits.length > 1) {
				row.createSpan({
					cls: 'detailsearch-linker-popover__hit-count',
					text: ` (${candidate.hits.length})`,
				});
			}
			row.addEventListener('click', () => {
				this.focusedPath = candidate.path;
				this.focusedHitIndex = 0;
				this.refreshPreviewInPlace();
			});
		}

		const previewBox = pop.createDiv({ cls: 'detailsearch-linker-popover__preview' });
		const focused = group.candidates.find((c) => c.path === this.focusedPath);
		if (focused) {
			this.renderHitPreview(
				previewBox,
				focused,
				this.focusedHitIndex,
				group,
				host,
				anchor.id,
			);
		}

		const actions = pop.createDiv({ cls: 'detailsearch-linker-popover__actions' });
		const linkBtn = actions.createEl('button', {
			cls: 'mod-cta',
			text: t(lang, 'createLink'),
		});
		linkBtn.dataset.action = 'create-link';
		linkBtn.disabled =
			!group.canLink ||
			!resolvePopoverActionTarget(
				session,
				anchor.id,
				this.focusedPath,
				this.focusedHitIndex,
			);
		linkBtn.addEventListener('click', () => {
			const target = resolvePopoverActionTarget(
				host.getSession(),
				anchor.id,
				this.focusedPath,
				this.focusedHitIndex,
			);
			if (!target?.group.canLink) {
				return;
			}
			this.hide();
			host.createLink(target.anchor, target.candidate.path, target.hitIndex);
		});
		const openBtn = actions.createEl('button', { text: t(lang, 'openNote') });
		openBtn.dataset.action = 'open-note';
		openBtn.disabled = !resolvePopoverActionTarget(
			session,
			anchor.id,
			this.focusedPath,
			this.focusedHitIndex,
		);
		openBtn.addEventListener('click', () => {
			const target = resolvePopoverActionTarget(
				host.getSession(),
				anchor.id,
				this.focusedPath,
				this.focusedHitIndex,
			);
			if (!target) {
				return;
			}
			host.openNote(target.candidate.path, target.hit.heading);
		});
		if (host.hasActiveSession()) {
			const clearBtn = actions.createEl('button', { text: t(lang, 'clearHighlights') });
			clearBtn.addEventListener('click', () => {
				this.hide();
				host.clearSession();
			});
		}
		const ignoreBtn = actions.createEl('button', { text: t(lang, 'ignoreTerm') });
		ignoreBtn.setAttr('title', t(lang, 'ignoreTermHint'));
		ignoreBtn.addEventListener('click', () => {
			this.hide();
			host.ignoreTerm(group.query, group.key);
		});

		this.position(pop, x, y);
		this.focusArmedControl();
	}

	private handlePopoverKey(evt: KeyboardEvent): void {
		if (!this.popover || evt.defaultPrevented) {
			return;
		}
		if (evt.key === 'Escape') {
			evt.preventDefault();
			evt.stopPropagation();
			this.hide();
			return;
		}
		const active = this.popover.ownerDocument.activeElement;
		const popoverHasFocus = active instanceof Node && this.popover.contains(active);
		if (!this.keyboardArmed && !popoverHasFocus) {
			return;
		}
		if (this.handleArmedKey(evt)) {
			evt.preventDefault();
			evt.stopPropagation();
		}
	}

	private handleArmedKey(evt: KeyboardEvent): boolean {
		if (evt.ctrlKey || evt.metaKey || evt.altKey) {
			return false;
		}
		const targetInsidePopover =
			evt.target instanceof Node && !!this.popover?.contains(evt.target);
		if (
			!shouldConsumeArmedKey(evt.key, {
				isComposing: evt.isComposing,
				targetInsidePopover,
			})
		) {
			return false;
		}
		if (
			evt.key === 'ArrowDown' ||
			evt.key === 'ArrowUp' ||
			evt.key === 'ArrowRight' ||
			evt.key === 'ArrowLeft'
		) {
			this.stepArmedFocusable(
				evt.key === 'ArrowDown' || evt.key === 'ArrowRight' ? 1 : -1,
			);
			return true;
		}
		if (evt.key === 'Tab') {
			this.stepArmedFocusable(evt.shiftKey ? -1 : 1);
			return true;
		}
		return true;
	}

	private focusEditor(): void {
		if (!this.editorDom?.isConnected) {
			return;
		}
		this.editorDom.querySelector<HTMLElement>('.cm-content')?.focus();
	}

	private stepArmedFocusable(direction: 1 | -1): void {
		this.clearHide();
		const items = this.popoverFocusables();
		const active = this.popover?.ownerDocument.activeElement;
		const current = items.findIndex((item) => item === active);
		const nextIndex = stepFocusableIndex(items.length, current, direction);
		const next = items[nextIndex];
		if (!next) {
			return;
		}
		next.focus();
		this.syncSelectionFromElement(next, true);
	}

	private popoverFocusables(): HTMLElement[] {
		return Array.from(
			this.popover?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [],
		);
	}

	private syncSelectionFromElement(
		element: HTMLElement,
		refreshWhenChanged: boolean,
	): void {
		const row = element.closest('.detailsearch-linker-popover__row');
		if (row instanceof HTMLElement && row.dataset.candidatePath) {
			const path = row.dataset.candidatePath;
			if (path !== this.focusedPath) {
				this.focusedPath = path;
				this.focusedHitIndex = 0;
				if (refreshWhenChanged) {
					this.refreshPreviewInPlace();
					this.focusCandidateRow(path);
				}
			}
			return;
		}
		const hitBtn = element.closest('.detailsearch-linker-popover__hits button');
		if (hitBtn instanceof HTMLElement && hitBtn.dataset.hitIndex !== undefined) {
			const hitIndex = Number(hitBtn.dataset.hitIndex);
			if (!Number.isNaN(hitIndex) && hitIndex !== this.focusedHitIndex) {
				this.focusedHitIndex = hitIndex;
				if (refreshWhenChanged) {
					this.refreshPreviewInPlace();
					this.focusHitButton(hitIndex);
				}
			}
		}
	}

	private refreshPreviewInPlace(): void {
		const pop = this.popover;
		const host = this.host;
		const session = host?.getSession();
		const anchor = session?.anchors.find((item) => item.id === this.activeAnchorId);
		const group = anchor && session ? getGroup(session, anchor.groupKey) : undefined;
		if (!pop || !host || !session || !anchor || !group) {
			return;
		}
		const focus = normalizePopoverFocus(group, {
			path: this.focusedPath,
			hitIndex: this.focusedHitIndex,
		});
		this.focusedPath = focus.path;
		this.focusedHitIndex = focus.hitIndex;
		const rows = Array.from(
			pop.querySelectorAll<HTMLElement>('.detailsearch-linker-popover__row'),
		);
		for (const row of rows) {
			row.classList.toggle('is-focused', row.dataset.candidatePath === this.focusedPath);
		}
		const focused = group.candidates.find((item) => item.path === this.focusedPath);
		const preview = pop.querySelector<HTMLElement>('.detailsearch-linker-popover__preview');
		if (preview && focused) {
			this.renderHitPreview(
				preview,
				focused,
				this.focusedHitIndex,
				group,
				host,
				anchor.id,
			);
		}
		const canAct = !!resolvePopoverActionTarget(
			session,
			anchor.id,
			this.focusedPath,
			this.focusedHitIndex,
		);
		const actions = pop.querySelector('.detailsearch-linker-popover__actions');
		const linkBtn = actions?.querySelector<HTMLButtonElement>(
			'button[data-action="create-link"]',
		);
		const openBtn = actions?.querySelector<HTMLButtonElement>(
			'button[data-action="open-note"]',
		);
		if (linkBtn) {
			linkBtn.disabled = !group.canLink || !canAct;
		}
		if (openBtn) {
			openBtn.disabled = !canAct;
		}
	}

	private focusCandidateRow(path: string): void {
		const rows = this.popover?.querySelectorAll<HTMLElement>(
			'.detailsearch-linker-popover__row',
		);
		const row = rows
			? Array.from(rows).find((item) => item.dataset.candidatePath === path)
			: undefined;
		row?.focus();
	}

	private focusHitButton(hitIndex: number): void {
		this.popover
			?.querySelector<HTMLElement>(
				`.detailsearch-linker-popover__hits button[data-hit-index="${hitIndex}"]`,
			)
			?.focus();
	}

	private focusArmedControl(): void {
		const focused =
			this.popover?.querySelector<HTMLElement>(
				'.detailsearch-linker-popover__row.is-focused',
			) ?? this.popover?.querySelector<HTMLElement>('button');
		focused?.focus();
		window.requestAnimationFrame(() => {
			if (!this.keyboardArmed || !this.popover) {
				return;
			}
			const still =
				this.popover.querySelector<HTMLElement>(
					'.detailsearch-linker-popover__row.is-focused',
				) ?? this.popover.querySelector<HTMLElement>('button');
			if (still && this.popover.ownerDocument.activeElement !== still) {
				still.focus();
			}
		});
	}

	private renderHitPreview(
		container: HTMLElement,
		candidate: NoteCandidate,
		hitIndex: number,
		group: ResultGroup,
		host: PreviewHost,
		anchorId: string,
	): void {
		container.empty();
		const hits = candidate.hits;
		if (hits.length > 1) {
			const tabs = container.createDiv({ cls: 'detailsearch-linker-popover__hits' });
			hits.forEach((hit, i) => {
				const btn = tabs.createEl('button', {
					text: hit.heading || `#${i + 1}`,
					type: 'button',
				});
				btn.dataset.hitIndex = String(i);
				if (i === hitIndex) {
					btn.addClass('is-active');
				}
				btn.addEventListener('click', () => {
					const freshSession = host.getSession();
					const target = resolvePopoverActionTarget(
						freshSession,
						anchorId,
						candidate.path,
						i,
					);
					if (!target) {
						return;
					}
					this.focusedPath = target.candidate.path;
					this.focusedHitIndex = target.hitIndex;
					this.refreshPreviewInPlace();
				});
			});
		}
		const hit = hits[hitIndex] ?? hits[0];
		if (!hit) {
			return;
		}
		if (hit.heading) {
			container.createDiv({
				cls: 'detailsearch-linker-popover__heading',
				text: hit.heading,
			});
		}
		const excerptEl = container.createDiv();
		const liveSession = host.getSession();
		const applyExcerpt = (excerpt: string): void => {
			if (this.activeAnchorId !== anchorId || !this.popover?.contains(excerptEl)) {
				return;
			}
			excerptEl.empty();
			fillHighlightedExcerpt(
				excerptEl,
				excerpt,
				group.query,
				liveSession.caseSensitive,
				liveSession.style,
			);
		};
		if (hit.excerpt) {
			applyExcerpt(hit.excerpt);
			return;
		}
		void Promise.resolve(host.resolveExcerpt(hit, group.query)).then(applyExcerpt);
	}

	private position(pop: HTMLElement, x: number, y: number): void {
		const margin = 8;
		const view = pop.ownerDocument.defaultView;
		const maxW = Math.min(420, (view?.innerWidth ?? 420) - margin * 2);
		pop.style.width = `${maxW}px`;
		const rect = pop.getBoundingClientRect();
		let top = y + 16;
		let left = x;
		const vh = view?.innerHeight ?? 800;
		const vw = view?.innerWidth ?? 800;
		if (top + rect.height > vh - margin) {
			top = Math.max(margin, y - rect.height - 12);
		}
		if (left + rect.width > vw - margin) {
			left = vw - rect.width - margin;
		}
		pop.style.top = `${Math.max(margin, top)}px`;
		pop.style.left = `${Math.max(margin, left)}px`;
	}

	private findAnchorElement(
		id: string,
		selector = '[data-anchor-id]',
	): HTMLElement | null {
		const elements = this.editorDom?.querySelectorAll<HTMLElement>(selector);
		return elements
			? (Array.from(elements).find((element) => element.dataset.anchorId === id) ?? null)
			: null;
	}
}
