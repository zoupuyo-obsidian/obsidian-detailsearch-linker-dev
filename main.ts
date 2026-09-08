import { EditorView } from '@codemirror/view';
import {
	MarkdownView,
	Notice,
	Plugin,
	TFile,
	type Command,
	type Editor,
	type WorkspaceLeaf,
} from 'obsidian';
import {
	QueryCache,
	saveQueryCacheSnapshot,
	type PersistentCachePayload,
} from './core/cache/queryCache';
import {
	reportSaveFailure,
	SaveCoordinator,
} from './core/persistence/saveCoordinator';
import {
	BUILD_ARTIFACT_MARKERS,
	COMMAND_DEFINITIONS,
} from './core/commands/commandRegistry';
import { resolveRibbonAction } from './core/commands/unifiedSearch';
import { addIgnoredTerm } from './core/ignore/ignoredTerms';
import { removeGroupFromSession, resolveIgnoreGroupKey } from './core/ignore/sessionIgnore';
import {
	extractQueryCandidates,
	groupKeyForQuery,
	type ExtractSettings,
} from './core/extract/queryExtractor';
import {
	generateHeadingLink,
	resolveHeadingAtOffset,
	sourceMatchesLiveSession,
	targetMtimeMatches,
} from './core/link/linkCreation';
import { buildAnchorSpots, ModalQuerySource, SelectionQuerySource } from './core/query/selectionSource';
import type { SearchRequest } from './core/query/querySource';
import { validateQuery, MAX_QUERY_LENGTH, trimSelectionRange, type QueryValidationError } from './core/query/queryValidation';
import { MultiSearchCoordinator } from './core/search/multiSearchCoordinator';
import { SearchCoordinator } from './core/search/searchCoordinator';
import { safeRead } from './core/search/safeRead';
import { searchRunIsCurrent as snapshotIsCurrent } from './core/search/searchRunGuard';
import {
	dedupeOverlappingAnchors,
} from './core/extract/anchorDedupe';
import {
	filterScopeFiles,
	scopeFingerprint,
	type ScopedFile,
	WorksetTracker,
} from './core/search/scopeFilter';
import { hydrateHitExcerpt } from './core/search/headingResolver';
import { anchorStillValid } from './core/search/termMatch';
import type { BodyHit, CancelToken } from './core/search/types';
import {
	bindEditorFilePathEffect,
	detailsearchLinkerEditorExtension,
	readBoundEditorPath,
	readDetailSession,
	sessionMatchesDocument,
	setDetailSessionEffect,
} from './editor/highlighter';
import { buildPaintLockCss } from './editor/paintLock';
import { t, tf } from './i18n';
import { DetailHoverController, type PreviewHost } from './preview/hoverPreview';
import {
	beginPreviewNavigation,
	previewOpenNeedsDetachedEditor,
	resolvePreviewOpenStrategy,
	shouldApplySessionToLeaf,
	transitionPreviewNavigation,
	type PreviewNavigationState,
} from './preview/previewNavigation';
import {
	resolveAdjacentAnchor,
	resolveAnchorAtPosition,
} from './preview/popoverState';
import {
	buildAutoSession,
	buildSelectionSession,
	emptySession,
	getGroup,
	groupHitsToCandidates,
	sessionStats,
	type DetailSessionState,
	type ResultGroup,
	type SessionAnchor,
} from './session';
import { SessionController } from './sessionController';
import {
	DetailSearchLinkerSettingTab,
	migrateSettings,
	type DetailSearchLinkerSettings,
} from './settings';
import { promptSearchQuery, noticeQueryValidation } from './ui/queryInputModal';

const SAVE_DEBOUNCE_MS = 400;
const SAVE_ERROR_NOTICE_COOLDOWN_MS = 10_000;
const SEARCH_PROGRESS_THRESHOLD = 50;

/** Ensures build markers stay in the bundle for post-build verification. */
void BUILD_ARTIFACT_MARKERS;

function editorView(editor: Editor | undefined): EditorView | null {
	if (!editor) {
		return null;
	}
	const cm = (editor as unknown as { cm?: EditorView }).cm;
	return cm ?? null;
}

class SearchCancelToken implements CancelToken {
	cancelled = false;
	cancel(): void {
		this.cancelled = true;
	}
}

export default class DetailSearchLinkerPlugin extends Plugin {
	settings!: DetailSearchLinkerSettings;
	private readonly sessions = new SessionController();
	private readonly cache: QueryCache;
	private readonly workset = new WorksetTracker(50);
	private statusEl: HTMLElement | null = null;
	private ribbonEl: HTMLElement | null = null;
	private clipboardRibbonEl: HTMLElement | null = null;
	private readonly hover = new DetailHoverController();
	private hoverAttachedTo: HTMLElement | null = null;
	private previewNavigation: PreviewNavigationState | null = null;
	private readonly pendingPreviewLeaves = new WeakSet<WorkspaceLeaf>();
	private allowedSessionViews = new WeakSet<EditorView>();
	private openingPreview = false;
	private previewSyncTimers: number[] = [];
	private paintToken = 0;
	private paintLockStyleEl: HTMLStyleElement | null = null;
	private searchBusy = false;
	private activeSearchToken: SearchCancelToken | null = null;
	private activeSearchEditor: EditorView | null = null;
	private activeSearchFilePath = '';
	private searchRunId = 0;
	private readonly saveCoordinator: SaveCoordinator;
	private lastSaveErrorNoticeAt = 0;
	private readonly localizedCommands: {
		command: Command;
		key: Parameters<typeof t>[1];
	}[] = [];

	constructor(app: import('obsidian').App, manifest: import('obsidian').PluginManifest) {
		super(app, manifest);
		this.cache = new QueryCache({ mode: 'persistent', maxBytes: 8 * 1024 * 1024 });
		this.saveCoordinator = new SaveCoordinator(
			() => this.performSave(),
			SAVE_DEBOUNCE_MS,
			{
				setTimeout: (callback, delay) => window.setTimeout(callback, delay),
				clearTimeout: (handle) => window.clearTimeout(handle as number),
			},
		);
	}

	async onload(): Promise<void> {
		const raw = (await this.loadData()) as
			| (Partial<DetailSearchLinkerSettings> & { cache?: PersistentCachePayload })
			| null;
		this.settings = migrateSettings(raw ?? {});
		if (raw?.cache && this.settings.cacheMode === 'persistent') {
			this.cache.load(raw.cache);
		}
		this.applyCacheOptions();

		this.registerEditorExtension([
			detailsearchLinkerEditorExtension((count) =>
				tf(this.settings.uiLanguage, 'badgeCandidates', count),
			),
			EditorView.updateListener.of((update) => {
				if (!update.docChanged) {
					return;
				}
				if (this.activeSearchEditor === update.view) {
					this.invalidateActiveSearch();
				}
				const live = readDetailSession(update.state);
				const doc = update.state.doc.toString();
				if (live?.filePath && !sessionMatchesDocument(live, doc)) {
					queueMicrotask(() => {
						const current = readDetailSession(update.view.state);
						const currentDoc = update.view.state.doc.toString();
						if (
							current?.filePath &&
							!sessionMatchesDocument(current, currentDoc)
						) {
							update.view.dispatch({
								effects: setDetailSessionEffect.of(emptySession()),
							});
						}
					});
					return;
				}
				this.sessions.adoptEditorSession(
					live,
					!!live?.filePath && sessionMatchesDocument(live, doc),
				);
			}),
		]);

		this.addSettingTab(new DetailSearchLinkerSettingTab(this.app, this));
		this.statusEl = this.addStatusBarItem();
		this.statusEl.addClass('detailsearch-linker-status');
		this.statusEl.hide();

		this.ribbonEl = this.addRibbonIcon(
			'search',
			t(this.settings.uiLanguage, 'ribbonTooltip'),
			() => {
				void this.onRibbonClick();
			},
		);
		this.statusEl.addClass('mod-clickable');
		this.statusEl.addEventListener('click', () => {
			if (this.hasActiveSession()) {
				this.clearSession(true);
			}
		});

		this.registerCommands();
		this.applyUiLanguage();

		this.registerVaultEvents();
		const syncWorkspaceViews = (): void => {
			this.applySessionToEditors();
			this.attachHoverToActive();
		};
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', syncWorkspaceViews),
		);
		this.registerEvent(this.app.workspace.on('layout-change', syncWorkspaceViews));
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				if (
					this.activeSearchToken &&
					file?.path !== this.activeSearchFilePath
				) {
					this.invalidateActiveSearch();
				}
				if (file instanceof TFile && file.extension === 'md') {
					this.workset.touch(file.path);
				}
				if (this.previewNavigation) {
					const transition = transitionPreviewNavigation(
						this.previewNavigation,
						file?.path ?? null,
						this.openingPreview,
					);
					this.previewNavigation = transition.state;
					if (
						transition.action === 'preserve' ||
						transition.action === 'restore-source'
					) {
						this.applySessionToEditors();
						this.attachHoverToActive();
						return;
					}
				}
				if (this.settings.clearOnFileChange && this.sessions.get().filePath) {
					if (!file || file.path !== this.sessions.get().filePath) {
						this.clearSession(false);
						return;
					}
				}
				this.applySessionToEditors();
				this.attachHoverToActive();
			}),
		);
		this.workset.setMaxSize(this.settings.worksetSize);
	}

	onunload(): void {
		// Obsidian does not await onunload; start an immediate best-effort flush.
		void this.flushCacheSave().catch(() => this.showSaveErrorNotice());
		this.activeSearchToken?.cancel();
		this.hover.detach();
		this.hoverAttachedTo = null;
		this.sessions.clear();
		this.allowedSessionViews = new WeakSet();
		this.clearPreviewSyncTimers();
		this.clearPaintLock();
		this.applySessionToEditors();
	}

	async saveSettings(): Promise<void> {
		await reportSaveFailure(
			this.saveCoordinator.request(),
			() => this.showSaveErrorNotice(),
		);
	}

	private settingsPayload(cache?: PersistentCachePayload): DetailSearchLinkerSettings & { cache?: PersistentCachePayload } {
		const payload: DetailSearchLinkerSettings & { cache?: PersistentCachePayload } = {
			...this.settings,
		};
		if (cache) {
			payload.cache = cache;
		}
		return payload;
	}

	private async performSave(): Promise<void> {
		if (this.settings.cacheMode === 'persistent') {
			await saveQueryCacheSnapshot(
				this.cache,
				(cache) => this.saveData(this.settingsPayload(cache)),
			);
		} else {
			await this.saveData(this.settingsPayload());
		}
	}

	private showSaveErrorNotice(): void {
		const now = Date.now();
		if (now - this.lastSaveErrorNoticeAt < SAVE_ERROR_NOTICE_COOLDOWN_MS) {
			return;
		}
		this.lastSaveErrorNoticeAt = now;
		new Notice(t(this.settings.uiLanguage, 'noticeSaveFailed'));
	}

	applyCacheOptions(): void {
		this.cache.setOptions({
			mode: this.settings.cacheMode,
			maxBytes: this.settings.cacheMaxMb * 1024 * 1024,
		});
		this.workset.setMaxSize(this.settings.worksetSize);
	}

	onScopeOrCacheSettingsChanged(): void {
		this.applyCacheOptions();
		this.scheduleCacheSave();
	}

	formatCacheSizeDescription(): string {
		const kb = Math.round(this.cache.estimateBytes() / 1024);
		return tf(this.settings.uiLanguage, 'noticeCacheSize', this.cache.entryCount(), kb);
	}

	async clearCache(notify: boolean): Promise<void> {
		this.cache.clear();
		this.cache.manifest.load(null);
		await this.saveSettings();
		if (notify) {
			new Notice(t(this.settings.uiLanguage, 'noticeCacheCleared'));
		}
	}

	applyUiLanguage(): void {
		this.updateCommandNames();
		this.refreshStatus();
		this.attachHoverToActive();
	}

	refreshHighlightAppearance(): void {
		if (!this.hasActiveSession()) {
			return;
		}
		this.sessions.update((current) => ({
			...current,
			style: this.settings.highlightStyle,
			showBadge: this.settings.showBadge,
		}));
		this.applySessionToEditors();
	}

	private registerCommands(): void {
		for (const def of COMMAND_DEFINITIONS) {
			const command = this.addCommand({
				id: def.id,
				name: t(this.settings.uiLanguage, def.i18nKey),
				icon: def.icon,
				callback: () => {
					this.runCommand(def.id);
				},
			});
			this.localizedCommands.push({ command, key: def.i18nKey });
		}
	}

	private runCommand(id: string): void {
		switch (id) {
			case 'search-current-note':
				void this.searchCurrentNoteCommand();
				break;
			case 'search-selection':
				void this.searchSelectionCommand();
				break;
			case 'search-auto':
				void this.searchAutoCommand();
				break;
			case 'search-clipboard':
				void this.searchClipboardCommand();
				break;
			case 'cancel-search':
				this.cancelSearch();
				break;
			case 'clear-highlights':
				this.clearSession(true);
				break;
			case 'clear-cache':
				void this.clearCache(true);
				break;
			case 'open-candidates-at-cursor':
				this.openCandidatesAtCursor();
				break;
			case 'go-to-next-highlight':
				this.goToAdjacentHighlight(1);
				break;
			case 'go-to-previous-highlight':
				this.goToAdjacentHighlight(-1);
				break;
			default:
				break;
		}
	}

	private updateCommandNames(): void {
		const lang = this.settings.uiLanguage;
		for (const { command, key } of this.localizedCommands) {
			command.name = t(lang, key);
		}
	}

	private registerVaultEvents(): void {
		const onUpsert = (file: TFile): void => {
			if (file.extension !== 'md') {
				return;
			}
			this.cache.manifest.noteChanged(file.path, file.stat.mtime);
			this.cache.markDirty();
			this.scheduleCacheSave();
		};
		this.registerEvent(
			this.app.vault.on('create', (file) => {
				if (file instanceof TFile) {
					onUpsert(file);
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (file instanceof TFile) {
					onUpsert(file);
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (file instanceof TFile && file.extension === 'md') {
					this.cache.manifest.noteDeleted(file.path);
					this.cache.markDirty();
					this.scheduleCacheSave();
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (file instanceof TFile && file.extension === 'md') {
					this.cache.manifest.noteRenamed(oldPath, file.path, file.stat.mtime);
					this.cache.markDirty();
					this.scheduleCacheSave();
				}
			}),
		);
	}

	private scheduleCacheSave(): void {
		if (this.settings.cacheMode !== 'persistent') {
			return;
		}
		void this.saveCoordinator.request().catch(() => this.showSaveErrorNotice());
	}

	private async flushCacheSave(): Promise<void> {
		// Always enqueue one current payload. It coalesces with a pending debounce,
		// or follows an in-flight write so unload observes the latest save result.
		const request = this.saveCoordinator.request();
		await this.saveCoordinator.flush();
		await request;
	}

	private scopeInput() {
		return {
			includeFolders: this.settings.includeFolders,
			excludeFolders: this.settings.excludeFolders,
			scopeMode: this.settings.scopeMode,
			recentDays: this.settings.recentDays,
			worksetPaths: this.workset.pathsSnapshot(),
			maxFiles: this.settings.maxFiles,
			maxFileBytes: this.settings.maxFileBytes,
		};
	}

	private extractSettings(): ExtractSettings {
		return {
			focusedExtraction: this.settings.focusedExtraction,
			normalProsePhrases: this.settings.normalProsePhrases,
			broadNgram: this.settings.broadNgram,
			minTermLength: this.settings.autoMinTermLength,
			maxTermLength: this.settings.autoMaxTermLength,
			ngramMinLength: this.settings.ngramMinLength,
			ngramMaxLength: this.settings.ngramMaxLength,
			maxAutoQueries: this.settings.maxAutoQueries,
			ngramSpanLimit: this.settings.ngramSpanLimit,
			stopWords: this.settings.autoStopWords,
			ignoredTerms: this.settings.ignoredTerms,
			caseSensitive: this.settings.caseSensitive,
		};
	}

	private collectScopedFiles(selfPath: string): {
		files: ScopedFile[];
		skippedBySize: number;
		skippedByLimit: number;
	} {
		const candidates: ScopedFile[] = [];
		for (const file of this.app.vault.getMarkdownFiles()) {
			candidates.push({
				path: file.path,
				statMtime: file.stat.mtime,
				size: file.stat.size,
			});
		}
		return filterScopeFiles(candidates, this.scopeInput(), selfPath);
	}

	private resolveMeta(path: string): { stem: string; title: string } {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			return { stem: path.split('/').pop()?.replace(/\.md$/, '') ?? path, title: path };
		}
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const stem = file.basename;
		const title =
			typeof fm?.title === 'string' && fm.title.trim() ? fm.title.trim() : stem;
		return { stem, title };
	}

	private readFileFn(onError: (path: string, error: unknown) => void) {
		return async (path: string) => {
			const tf = this.app.vault.getAbstractFileByPath(path);
			if (!(tf instanceof TFile)) {
				return null;
			}
			return safeRead(
				path,
				async () => {
					const content = await this.app.vault.cachedRead(tf);
					return { content, mtime: tf.stat.mtime };
				},
				onError,
			);
		};
	}

	private scanOptions(token: SearchCancelToken, onProgress?: (done: number, total: number) => void) {
		return {
			excerptLength: this.settings.excerptLength,
			maxHitsPerNote: this.settings.maxHitsPerNote,
			maxCandidateNotes: this.settings.maxCandidateNotes,
			readConcurrency: 2,
			maxContentBytes: this.settings.maxFileBytes,
			token,
			onProgress,
		};
	}

	private async searchCurrentNoteCommand(): Promise<void> {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = view?.file;
		const cm = editorView(view?.editor);
		const lang = this.settings.uiLanguage;
		if (!view || !cm || !file) {
			new Notice(t(lang, 'noticeNoEditor'));
			return;
		}

		const text = cm.state.doc.toString();
		const range = cm.state.selection.main;
		const sel = text.slice(range.from, range.to);
		if (sel.trim()) {
			await this.runSelectionFromEditor(file, cm, text, range.from, range.to);
		} else {
			await this.searchAutoCommand();
		}
	}

	private onRibbonClick(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = view?.file;
		const cm = editorView(view?.editor);
		const lang = this.settings.uiLanguage;
		if (!view || !cm || !file) {
			new Notice(t(lang, 'noticeNoEditor'));
			return;
		}

		const text = cm.state.doc.toString();
		const range = cm.state.selection.main;
		const sel = text.slice(range.from, range.to);
		const action = resolveRibbonAction(sel, this.hasActiveSession());
		switch (action) {
			case 'clear':
				this.clearSession(true);
				break;
			case 'selection':
				void this.runSelectionFromEditor(file, cm, text, range.from, range.to);
				break;
			case 'auto':
				void this.searchAutoCommand();
				break;
		}
	}

	private async runSelectionFromEditor(
		file: TFile,
		cm: EditorView,
		text: string,
		selectionFrom: number,
		selectionTo: number,
	): Promise<void> {
		const lang = this.settings.uiLanguage;
		const sel = text.slice(selectionFrom, selectionTo);
		const selError = validateQuery(sel);
		if (selError) {
			this.showQueryValidationNotice(lang, selError);
			return;
		}
		const request = new SelectionQuerySource().resolve(
			text,
			selectionFrom,
			selectionTo,
			this.settings.caseSensitive,
		);
		if (!request) {
			const trimmed = trimSelectionRange(text, selectionFrom, selectionTo);
			if (trimmed && !validateQuery(trimmed.query)) {
				new Notice(t(lang, 'noticeSelectionProtected'));
			}
			return;
		}
		await this.runSelectionSearch(file, cm, text, request);
	}

	private async searchSelectionCommand(): Promise<void> {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = view?.file;
		const cm = editorView(view?.editor);
		const lang = this.settings.uiLanguage;
		if (!view || !cm || !file) {
			new Notice(t(lang, 'noticeNoEditor'));
			return;
		}

		const text = cm.state.doc.toString();
		const range = cm.state.selection.main;
		const selectionFrom = range.from;
		const selectionTo = range.to;
		const sel = text.slice(selectionFrom, selectionTo);

		let request: SearchRequest | null;
		if (selectionFrom !== selectionTo && sel.trim()) {
			const selError = validateQuery(sel);
			if (selError) {
				this.showQueryValidationNotice(lang, selError);
				return;
			}
			request = new SelectionQuerySource().resolve(
				text,
				selectionFrom,
				selectionTo,
				this.settings.caseSensitive,
			);
			if (!request) {
				const trimmed = trimSelectionRange(text, selectionFrom, selectionTo);
				if (trimmed && !validateQuery(trimmed.query)) {
					new Notice(t(lang, 'noticeSelectionProtected'));
				}
				return;
			}
		} else {
			const query = await promptSearchQuery(this.app, lang);
			if (!query) {
				return;
			}
			const modalError = validateQuery(query);
			if (modalError) {
				this.showQueryValidationNotice(lang, modalError);
				return;
			}
			request = new ModalQuerySource(query).resolve(
				text,
				selectionFrom,
				selectionTo,
				this.settings.caseSensitive,
			);
			if (!request) {
				new Notice(t(lang, 'noticeModalTermNotInNote'));
				return;
			}
		}

		await this.runSelectionSearch(file, cm, text, request);
	}

	private async searchAutoCommand(): Promise<void> {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = view?.file;
		const cm = editorView(view?.editor);
		const lang = this.settings.uiLanguage;
		if (!view || !cm || !file) {
			new Notice(t(lang, 'noticeNoEditor'));
			return;
		}

		const text = cm.state.doc.toString();
		const extracted = extractQueryCandidates(text, this.extractSettings());
		if (extracted.length === 0) {
			new Notice(t(lang, 'noticeAutoNoTerms'));
			return;
		}

		new Notice(tf(lang, 'noticeAutoExtracting', extracted.length));
		await this.runAutoSearch(file, cm, text, extracted);
	}

	private async searchClipboardCommand(): Promise<void> {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = view?.file;
		const cm = editorView(view?.editor);
		const lang = this.settings.uiLanguage;
		if (!view || !cm || !file) {
			new Notice(t(lang, 'noticeNoEditor'));
			return;
		}

		let query: string;
		try {
			query = (await navigator.clipboard.readText()).trim();
		} catch {
			new Notice(t(lang, 'noticeClipboardUnavailable'));
			return;
		}
		const error = validateQuery(query);
		if (error) {
			this.showQueryValidationNotice(lang, error);
			return;
		}

		const text = cm.state.doc.toString();
		const range = cm.state.selection.main;
		const request = new ModalQuerySource(query).resolve(
			text,
			range.from,
			range.to,
			this.settings.caseSensitive,
		);
		this.clipboardRibbonEl = this.addRibbonIcon(
			'clipboard',
			t(this.settings.uiLanguage, 'cmdSearchClipboard'),
			() => {
				void this.searchClipboardCommand();
			},
		);
		if (!request) {
			new Notice(t(lang, 'noticeModalTermNotInNote'));
			return;
		}
		await this.runSelectionSearch(file, cm, text, request);
	}

	private showQueryValidationNotice(lang: import('./settings').UiLanguage, error: QueryValidationError): void {
		switch (error) {
			case 'empty':
				new Notice(t(lang, 'noticeInvalidQueryEmpty'));
				break;
			case 'newline':
				new Notice(t(lang, 'noticeInvalidQueryNewline'));
				break;
			case 'too_long':
				new Notice(tf(lang, 'noticeInvalidQueryTooLong', MAX_QUERY_LENGTH));
				break;
			case 'link_syntax':
				new Notice(t(lang, 'noticeInvalidQueryLinkSyntax'));
				break;
			default:
				noticeQueryValidation(lang, error);
		}
	}

	private cancelSearch(): void {
		if (this.activeSearchToken) {
			this.invalidateActiveSearch();
			new Notice(t(this.settings.uiLanguage, 'noticeCancelled'));
		}
	}

	private beginSearch(file: TFile, cm: EditorView, token: SearchCancelToken): number {
		const runId = ++this.searchRunId;
		this.activeSearchToken = token;
		this.activeSearchEditor = cm;
		this.activeSearchFilePath = file.path;
		this.searchBusy = true;
		return runId;
	}

	private invalidateActiveSearch(): void {
		if (!this.activeSearchToken) {
			return;
		}
		this.activeSearchToken.cancel();
		this.searchRunId++;
	}

	private searchRunIsCurrent(
		runId: number,
		file: TFile,
		cm: EditorView,
		startText: string,
	): boolean {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		return snapshotIsCurrent(
			{ runId, filePath: file.path, text: startText },
			{
				runId: this.searchRunId,
				filePath: activeView?.file?.path ?? '',
				text: cm.state.doc.toString(),
				sameEditor: !!activeView && editorView(activeView.editor) === cm,
			},
		);
	}

	private finishSearch(token: SearchCancelToken): void {
		if (this.activeSearchToken !== token) {
			return;
		}
		this.searchBusy = false;
		this.activeSearchToken = null;
		this.activeSearchEditor = null;
		this.activeSearchFilePath = '';
	}

	private async runSelectionSearch(
		file: TFile,
		cm: EditorView,
		text: string,
		request: SearchRequest,
	): Promise<void> {
		if (this.searchBusy) {
			new Notice(t(this.settings.uiLanguage, 'noticeSearchBusy'));
			return;
		}

		const lang = this.settings.uiLanguage;
		const scoped = this.collectScopedFiles(file.path);
		const token = new SearchCancelToken();
		const runId = this.beginSearch(file, cm, token);
		const readErrors = new Set<string>();
		let pinnedCacheKey: string | null = null;

		const progress =
			scoped.files.length >= SEARCH_PROGRESS_THRESHOLD
				? new Notice(tf(lang, 'noticeSearching', 0, scoped.files.length), 0)
				: null;

		try {
			const coordinator = new SearchCoordinator(
				this.cache,
				this.readFileFn((path) => readErrors.add(path)),
			);
			const cacheKey = this.cache.makeKey(
				request.query,
				request.caseSensitive,
				scopeFingerprint(this.scopeInput()),
			);
			pinnedCacheKey = cacheKey;
			this.cache.pinActive(cacheKey);

			const result = await coordinator.execute({
				request,
				scopeSettings: this.scopeInput(),
				scopedFiles: scoped.files,
				scanOptions: this.scanOptions(token, (done, total) => {
					progress?.setMessage(tf(lang, 'noticeSearching', done, total));
				}),
			});

			progress?.hide();

			if (
				token.cancelled ||
				!this.searchRunIsCurrent(runId, file, cm, text)
			) {
				return;
			}

			this.scheduleCacheSave();
			if (readErrors.size > 0) {
				new Notice(tf(lang, 'noticeSearchReadErrors', readErrors.size));
			}

			const hits = result.hits;
			const groupKey = groupKeyForQuery(request.query, request.caseSensitive);
			const spots = buildAnchorSpots(text, request);
			const anchors: SessionAnchor[] = spots.map((a, i) => ({
				id: `sel-${i}-${a.from}-${a.to}`,
				from: a.from,
				to: a.to,
				text: a.text,
				groupKey,
			}));
			const group: ResultGroup = {
				key: groupKey,
				query: request.query,
				displayText: request.displayText,
				canLink: request.canLink && anchors.length > 0,
				candidates: groupHitsToCandidates(hits, (p) => this.resolveMeta(p)),
			};

			this.beginPaintedSession(buildSelectionSession({
				filePath: file.path,
				group,
				anchors,
				style: this.settings.highlightStyle,
				showBadge: this.settings.showBadge,
				caseSensitive: request.caseSensitive,
			}));
			this.applySessionToEditors();
			this.attachHoverToActive();
			this.refreshStatus();

			if (scoped.skippedBySize > 0 || scoped.skippedByLimit > 0) {
				new Notice(
					tf(lang, 'noticeSkipped', scoped.skippedBySize, scoped.skippedByLimit),
				);
			}

			if (group.candidates.length === 0) {
				new Notice(t(lang, 'noticeNoHits'));
				return;
			}

			const totalHits = hits.length;
			if (result.warm && result.filesRead === 0) {
				new Notice(tf(lang, 'noticeSearchDoneWarm', group.candidates.length));
			} else {
				new Notice(tf(lang, 'noticeSearchDone', group.candidates.length, totalHits));
			}
		} catch {
			if (
				!token.cancelled &&
				this.searchRunIsCurrent(runId, file, cm, text)
			) {
				new Notice(t(lang, 'noticeSearchFailed'));
			}
		} finally {
			progress?.hide();
			this.finishSearch(token);
			if (pinnedCacheKey) {
				this.cache.unpinActive(pinnedCacheKey);
			}
		}
	}

	private async runAutoSearch(
		file: TFile,
		cm: EditorView,
		text: string,
		extracted: ReturnType<typeof extractQueryCandidates>,
	): Promise<void> {
		if (this.searchBusy) {
			new Notice(t(this.settings.uiLanguage, 'noticeSearchBusy'));
			return;
		}

		const lang = this.settings.uiLanguage;
		const scoped = this.collectScopedFiles(file.path);
		const token = new SearchCancelToken();
		const runId = this.beginSearch(file, cm, token);
		const readErrors = new Set<string>();

		const progress =
			scoped.files.length >= SEARCH_PROGRESS_THRESHOLD
				? new Notice(tf(lang, 'noticeSearching', 0, scoped.files.length), 0)
				: null;

		try {
			const terms = extracted.map((c) => ({
				key: groupKeyForQuery(c.query, this.settings.caseSensitive),
				query: c.query,
				caseSensitive: this.settings.caseSensitive,
			}));

			const coordinator = new MultiSearchCoordinator(
				this.cache,
				this.readFileFn((path) => readErrors.add(path)),
			);
			const result = await coordinator.execute({
				terms,
				scopeSettings: this.scopeInput(),
				scopedFiles: scoped.files,
				scanOptions: this.scanOptions(token, (done, total) => {
					progress?.setMessage(tf(lang, 'noticeSearching', done, total));
				}),
			});

			progress?.hide();

			if (
				token.cancelled ||
				!this.searchRunIsCurrent(runId, file, cm, text)
			) {
				return;
			}

			this.scheduleCacheSave();
			if (readErrors.size > 0) {
				new Notice(tf(lang, 'noticeSearchReadErrors', readErrors.size));
			}

			const scoredInputs: {
				from: number;
				to: number;
				text: string;
				score: number;
				groupKey: string;
				source: import('./core/extract/queryExtractor').ExtractSource;
				stableIndex: number;
				candidate: (typeof extracted)[number];
			}[] = [];
			let stableIndex = 0;

			const groupMeta = new Map<
				string,
				{ candidate: (typeof extracted)[number]; noteCandidates: ReturnType<typeof groupHitsToCandidates> }
			>();

			for (const candidate of extracted) {
				const key = groupKeyForQuery(candidate.query, this.settings.caseSensitive);
				const outcome = result.byTerm.get(key);
				if (!outcome || outcome.hits.length === 0) {
					continue;
				}
				const noteCandidates = groupHitsToCandidates(outcome.hits, (p) => this.resolveMeta(p));
				groupMeta.set(key, { candidate, noteCandidates });
				for (const a of candidate.anchors) {
					scoredInputs.push({
						from: a.from,
						to: a.to,
						text: a.text,
						score: candidate.score,
						groupKey: key,
						source: candidate.source,
						stableIndex: stableIndex++,
						candidate,
					});
				}
			}

			const kept = dedupeOverlappingAnchors(scoredInputs);
			const keptByGroupKey = new Map<string, typeof kept>();
			for (const anchor of kept) {
				const groupAnchors = keptByGroupKey.get(anchor.groupKey) ?? [];
				groupAnchors.push(anchor);
				keptByGroupKey.set(anchor.groupKey, groupAnchors);
			}

			const groups: ResultGroup[] = [];
			const anchors: SessionAnchor[] = [];
			let anchorIdx = 0;

			for (const [key, meta] of groupMeta) {
				const groupAnchors = keptByGroupKey.get(key) ?? [];
				if (groupAnchors.length === 0) {
					continue;
				}
				groups.push({
					key,
					query: meta.candidate.query,
					displayText: meta.candidate.displayText,
					canLink: true,
					candidates: meta.noteCandidates,
				});
				for (const a of groupAnchors) {
					anchors.push({
						id: `auto-${anchorIdx++}-${a.from}-${a.to}`,
						from: a.from,
						to: a.to,
						text: a.text,
						groupKey: key,
					});
				}
			}

			if (groups.length === 0) {
				new Notice(t(lang, 'noticeAutoNoHits'));
				return;
			}

			this.beginPaintedSession(buildAutoSession({
				filePath: file.path,
				groups,
				anchors,
				style: this.settings.highlightStyle,
				showBadge: this.settings.showBadge,
				caseSensitive: this.settings.caseSensitive,
			}));
			this.applySessionToEditors();
			this.attachHoverToActive();
			this.refreshStatus();

			if (scoped.skippedBySize > 0 || scoped.skippedByLimit > 0) {
				new Notice(
					tf(lang, 'noticeSkipped', scoped.skippedBySize, scoped.skippedByLimit),
				);
			}

			const cacheLabel = result.allWarm
				? t(lang, 'noticeCacheWarm')
				: result.anyPartial
					? t(lang, 'noticeCachePartial')
					: t(lang, 'noticeCacheCold');
			new Notice(
				tf(lang, 'noticeAutoSearchDone', groups.length, extracted.length, cacheLabel),
			);
		} catch {
			if (
				!token.cancelled &&
				this.searchRunIsCurrent(runId, file, cm, text)
			) {
				new Notice(t(lang, 'noticeSearchFailed'));
			}
		} finally {
			progress?.hide();
			this.finishSearch(token);
		}
	}

	private hasActiveSession(): boolean {
		return this.sessions.hasActive();
	}

	clearSession(notify: boolean): void {
		this.previewNavigation = null;
		this.beginPaintedSession(emptySession());
		this.clearPaintLock();
		this.applySessionToEditors();
		this.hover.detach();
		this.hoverAttachedTo = null;
		this.refreshStatus();
		if (notify) {
			new Notice(t(this.settings.uiLanguage, 'noticeCleared'));
		}
	}

	private beginPaintedSession(next: DetailSessionState): void {
		this.allowedSessionViews = new WeakSet();
		this.sessions.replace(next);
		if (next.filePath && next.anchors.length > 0) {
			this.bumpPaintToken();
		} else {
			this.clearPaintLock();
		}
	}

	private bumpPaintToken(): void {
		this.paintToken += 1;
		const token = this.paintToken;
		const doc = this.app.workspace.containerEl?.ownerDocument ?? activeDocument;
		if (!this.paintLockStyleEl) {
			this.paintLockStyleEl = doc.createElement('style');
			this.paintLockStyleEl.dataset.dslPaintLock = '1';
			doc.head.appendChild(this.paintLockStyleEl);
		}
		this.paintLockStyleEl.textContent = buildPaintLockCss(token);
		doc.body.dataset.dslPaint = String(token);
		this.syncPaintTokenOnEditors();
	}

	private clearPaintLock(): void {
		this.paintToken = 0;
		const doc = this.app.workspace.containerEl?.ownerDocument;
		if (doc?.body) {
			delete doc.body.dataset.dslPaint;
		}
		this.paintLockStyleEl?.remove();
		this.paintLockStyleEl = null;
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (!(leaf.view instanceof MarkdownView)) {
				return;
			}
			const cm = editorView(leaf.view.editor);
			if (cm) {
				delete cm.dom.dataset.dslPaint;
			}
		});
	}

	private syncPaintTokenOnEditors(): void {
		const token = this.paintToken > 0 ? String(this.paintToken) : '';
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (!(leaf.view instanceof MarkdownView)) {
				return;
			}
			const cm = editorView(leaf.view.editor);
			if (!cm) {
				return;
			}
			if (token && this.allowedSessionViews.has(cm)) {
				cm.dom.dataset.dslPaint = token;
			} else {
				delete cm.dom.dataset.dslPaint;
			}
		});
	}

	private clearPreviewSyncTimers(): void {
		for (const id of this.previewSyncTimers) {
			window.clearTimeout(id);
		}
		this.previewSyncTimers = [];
	}

	private schedulePreviewSessionSync(): void {
		this.clearPreviewSyncTimers();
		this.bumpPaintToken();
		this.clearSessionsExceptSource();
		for (const delay of [0, 50, 200]) {
			const id = window.setTimeout(() => {
				this.bumpPaintToken();
				this.clearSessionsExceptSource();
			}, delay);
			this.previewSyncTimers.push(id);
		}
	}

	private clearEditorSession(leaf: { view: unknown }): void {
		if (!(leaf.view instanceof MarkdownView)) {
			return;
		}
		const cm = editorView(leaf.view.editor);
		const current = cm ? readDetailSession(cm.state) : null;
		if (!cm || !current || (!current.filePath && current.anchors.length === 0)) {
			return;
		}
		cm.dispatch({ effects: setDetailSessionEffect.of(emptySession()) });
	}

	private clearSessionsExceptSource(): void {
		this.applySessionToEditors();
	}

	private applySessionToEditors(): void {
		const session = this.sessions.get();
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (!(leaf.view instanceof MarkdownView)) {
				leaf.view?.containerEl?.toggleClass('detailsearch-linker-hide-marks', true);
				return;
			}
			const cm = editorView(leaf.view.editor);
			if (!cm) {
				return;
			}
			const doc = cm.state.doc.toString();
			const boundPath = leaf.view.file?.path ?? '';
			const paint = shouldApplySessionToLeaf({
				sessionFilePath: session.filePath,
				leafFilePath: boundPath,
				previewTargetPath: this.previewNavigation?.targetPath ?? null,
				leafIsPendingPreviewOpen: this.pendingPreviewLeaves.has(leaf),
				documentMatchesSession: sessionMatchesDocument(session, doc),
				openingPreview: this.openingPreview,
				editorAlreadyAllowed: this.allowedSessionViews.has(cm),
			});
			const state = paint ? session : emptySession();
			leaf.view.containerEl.toggleClass('detailsearch-linker-hide-marks', !paint);
			if (paint && !this.openingPreview && !this.pendingPreviewLeaves.has(leaf)) {
				this.allowedSessionViews.add(cm);
			}
			// Obsidian can expose a leaf before its editor extensions are installed.
			const current = readDetailSession(cm.state);
			if (!current) {
				return;
			}
			const currentBound = readBoundEditorPath(cm.state);
			if (
				currentBound === boundPath &&
				(current === state ||
					(!current.filePath &&
						!state.filePath &&
						current.anchors.length === 0 &&
						state.anchors.length === 0))
			) {
				return;
			}
			cm.dispatch({
				effects: [
					bindEditorFilePathEffect.of(boundPath),
					setDetailSessionEffect.of(state),
				],
			});
		});
		this.syncPaintTokenOnEditors();
	}

	private attachHoverToActive(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const cm = editorView(view?.editor);
		const session = this.sessions.get();
		if (!cm || !session.filePath || view?.file?.path !== session.filePath) {
			if (this.hover.hasOpenPopover()) {
				return;
			}
			this.hover.detach();
			this.hoverAttachedTo = null;
			return;
		}
		const dom = cm.dom;
		if (this.hoverAttachedTo === dom) {
			return;
		}
		this.hover.attach(dom, this.previewHost());
		this.hoverAttachedTo = dom;
	}

	private previewHost(): PreviewHost {
		return {
			getLang: () => this.settings.uiLanguage,
			getSession: () => this.liveSession(),
			createLink: (anchor, candidatePath, hitIndex) => {
				this.createLink(anchor, candidatePath, hitIndex);
			},
			openNote: (path, heading) => {
				const targetFile = this.app.vault.getAbstractFileByPath(path);
				if (!(targetFile instanceof TFile)) {
					new Notice(t(this.settings.uiLanguage, 'noticeTargetMissing'));
					return;
				}
				const openState = heading
					? { eState: { subpath: `#${heading}` } }
					: undefined;
				this.previewNavigation = beginPreviewNavigation(
					this.liveSession().filePath,
					targetFile.path,
				);
				const markdownLeaves = this.app.workspace.getLeavesOfType('markdown');
				const openStrategy = resolvePreviewOpenStrategy(
					markdownLeaves.map((leaf) => ({
						path:
							leaf.view instanceof MarkdownView
								? (leaf.view.file?.path ?? '')
								: '',
					})),
					targetFile.path,
				);
				this.openingPreview = true;
				const targetLeaf =
					openStrategy.kind === 'existing'
						? markdownLeaves[openStrategy.leafIndex]
						: this.app.workspace.getLeaf('tab');
				if (!targetLeaf) {
					this.openingPreview = false;
					this.previewNavigation = null;
					return;
				}
				this.pendingPreviewLeaves.add(targetLeaf);
				this.clearEditorSession(targetLeaf);
				this.clearSessionsExceptSource();
				this.bumpPaintToken();
				const replaceClonedView = previewOpenNeedsDetachedEditor(openStrategy);
				void Promise.resolve()
					.then(async () => {
						if (replaceClonedView) {
							await targetLeaf.setViewState(
								{
									type: 'markdown',
									active: true,
									state: { file: targetFile.path },
								},
								openState?.eState,
							);
							return;
						}
						await targetLeaf.openFile(targetFile, openState);
					})
					.then(() => {
						this.pendingPreviewLeaves.delete(targetLeaf);
						this.bumpPaintToken();
						this.clearSessionsExceptSource();
						this.openingPreview = false;
						this.schedulePreviewSessionSync();
					})
					.catch(() => {
						this.pendingPreviewLeaves.delete(targetLeaf);
						this.previewNavigation = null;
						this.openingPreview = false;
						this.schedulePreviewSessionSync();
					});
			},
			clearSession: () => {
				this.clearSession(true);
			},
			hasActiveSession: () => this.hasActiveSession(),
			ignoreTerm: (query, groupKey) => {
				void this.ignoreTerm(query, groupKey);
			},
			resolveExcerpt: (hit, query) => this.resolveHitExcerpt(hit, query),
		};
	}

	private async resolveHitExcerpt(hit: BodyHit, query: string): Promise<string> {
		if (hit.excerpt) {
			return hit.excerpt;
		}
		const file = this.app.vault.getAbstractFileByPath(hit.path);
		if (!(file instanceof TFile)) {
			return '';
		}
		const content = await safeRead(
			hit.path,
			() => this.app.vault.cachedRead(file),
			() => undefined,
		);
		if (!content) {
			return '';
		}
		return hydrateHitExcerpt(
			content,
			hit.offset,
			query,
			this.liveSession().caseSensitive,
			this.settings.excerptLength,
		);
	}

	private goToAdjacentHighlight(direction: 1 | -1): void {
		const lang = this.settings.uiLanguage;
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const cm = editorView(view?.editor);
		if (!view?.file || !cm) {
			new Notice(t(lang, 'noticeNoEditor'));
			return;
		}
		const liveSession = readDetailSession(cm.state);
		if (
			!liveSession ||
			liveSession.filePath !== view.file.path ||
			liveSession.anchors.length === 0
		) {
			new Notice(t(lang, 'noticeNoHighlights'));
			return;
		}
		const anchor = resolveAdjacentAnchor(
			liveSession.anchors,
			cm.state.selection.main.head,
			direction,
		);
		if (!anchor) {
			new Notice(t(lang, 'noticeNoHighlights'));
			return;
		}
		cm.dispatch({
			selection: { anchor: anchor.from },
			scrollIntoView: true,
		});
		this.attachHoverToActive();
		if (this.hover.openAnchorNow(anchor.id)) {
			cm.contentDOM.blur();
		}
	}

	private openCandidatesAtCursor(): void {
		const lang = this.settings.uiLanguage;
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const cm = editorView(view?.editor);
		if (!view?.file || !cm) {
			new Notice(t(lang, 'noticeNoEditor'));
			return;
		}
		const liveSession = readDetailSession(cm.state);
		if (!liveSession || liveSession.filePath !== view.file.path) {
			new Notice(t(lang, 'noticeNoCandidatesAtCursor'));
			return;
		}
		const anchor = resolveAnchorAtPosition(
			liveSession.anchors,
			cm.state.selection.main.head,
		);
		if (!anchor) {
			new Notice(t(lang, 'noticeNoCandidatesAtCursor'));
			return;
		}
		this.attachHoverToActive();
		if (!this.hover.openAnchorNow(anchor.id)) {
			new Notice(t(lang, 'noticeNoCandidatesAtCursor'));
			return;
		}
		cm.contentDOM.blur();
	}

	async ignoreTerm(query: string, groupKey: string): Promise<void> {
		const lang = this.settings.uiLanguage;
		const trimmed = query.trim();
		if (!trimmed) {
			return;
		}
		const sessionGroupKey = resolveIgnoreGroupKey(
			trimmed,
			groupKey,
			this.settings.caseSensitive,
		);
		if (!sessionGroupKey) {
			return;
		}
		this.settings.ignoredTerms = addIgnoredTerm(
			this.settings.ignoredTerms,
			trimmed,
			this.settings.caseSensitive,
		);
		await this.saveSettings();
		this.sessions.replace(removeGroupFromSession(this.sessions.get(), sessionGroupKey));
		this.applySessionToEditors();
		this.hover.detach();
		this.hoverAttachedTo = null;
		if (this.hasActiveSession()) {
			this.attachHoverToActive();
		}
		this.refreshStatus();
		new Notice(t(lang, 'noticeTermIgnored'));
	}

	private liveSession(): DetailSessionState {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const cm = editorView(view?.editor);
		const live = cm ? readDetailSession(cm.state) : null;
		return this.sessions.prefer(live, view?.file?.path);
	}

	private createLink(anchor: SessionAnchor, candidatePath: string, hitIndex: number): void {
		const lang = this.settings.uiLanguage;
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const cm = editorView(view?.editor);
		const sourcePath = view?.file?.path ?? '';
		if (!cm) {
			return;
		}

		const liveSession = readDetailSession(cm.state);
		if (!liveSession || !sourceMatchesLiveSession(sourcePath, liveSession.filePath)) {
			return;
		}
		const live = liveSession.anchors.find((item) => item.id === anchor.id);
		if (!live) {
			new Notice(t(lang, 'noticeAnchorChanged'));
			return;
		}
		const group = getGroup(liveSession, live.groupKey);
		if (!group?.canLink) {
			return;
		}

		const docText = cm.state.doc.toString();
		if (
			!anchorStillValid(
				docText,
				live.from,
				live.to,
				group.displayText,
				liveSession.caseSensitive,
			)
		) {
			new Notice(t(lang, 'noticeAnchorChanged'));
			return;
		}

		const candidate = group.candidates.find((c) => c.path === candidatePath);
		const hit = candidate?.hits[hitIndex] ?? candidate?.hits[0];
		if (!hit) {
			return;
		}

		const targetFile = this.app.vault.getAbstractFileByPath(candidatePath);
		if (!(targetFile instanceof TFile)) {
			new Notice(t(lang, 'noticeTargetMissing'));
			return;
		}
		if (!targetMtimeMatches(hit.mtime, targetFile.stat.mtime)) {
			new Notice(t(lang, 'noticeTargetChanged'));
			return;
		}

		const cachedMetadata = this.app.metadataCache.getFileCache(targetFile);
		const heading = resolveHeadingAtOffset(
			cachedMetadata ? (cachedMetadata.headings ?? []) : null,
			hit.offset,
			hit.heading,
		);
		const insert = generateHeadingLink(
			(file, linkSourcePath, subpath, alias) =>
				this.app.fileManager.generateMarkdownLink(
					file,
					linkSourcePath,
					subpath,
					alias,
				),
			targetFile,
			sourcePath,
			heading,
			live.text,
		);

		cm.dispatch({
			changes: { from: live.from, to: live.to, insert },
		});

		const mappedSession = readDetailSession(cm.state);
		if (!mappedSession) {
			return;
		}
		this.sessions.replace({
			...mappedSession,
			anchors: mappedSession.anchors.filter((item) => item.id !== live.id),
		});
		this.applySessionToEditors();
		this.refreshStatus();
		if (this.sessions.get().anchors.length === 0) {
			this.hover.detach();
			this.hoverAttachedTo = null;
		}
	}

	private refreshStatus(): void {
		const lang = this.settings.uiLanguage;
		this.refreshRibbonTooltip();
		if (!this.statusEl) {
			return;
		}
		if (!this.hasActiveSession()) {
			this.statusEl.hide();
			return;
		}
		this.statusEl.setText(tf(lang, 'statusHits', sessionStats(this.sessions.get()).candidateNoteCount));
		this.statusEl.setAttr('title', t(lang, 'statusClearHint'));
		this.statusEl.show();
	}

	private refreshRibbonTooltip(): void {
		if (!this.ribbonEl) {
			return;
		}
		const lang = this.settings.uiLanguage;
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const cm = editorView(view?.editor);
		let hasSelection = false;
		if (cm) {
			const range = cm.state.selection.main;
			const text = cm.state.doc.toString();
			hasSelection = text.slice(range.from, range.to).trim().length > 0;
		}
		const label =
			!hasSelection && this.hasActiveSession()
				? t(lang, 'ribbonTooltipClear')
				: t(lang, 'ribbonTooltip');
		this.ribbonEl.setAttr('aria-label', label);
		this.clipboardRibbonEl?.setAttr('aria-label', t(lang, 'cmdSearchClipboard'));
	}
}
