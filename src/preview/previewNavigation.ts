export interface PreviewNavigationState {
	sourcePath: string;
	targetPath: string;
}

export type PreviewNavigationAction = 'preserve' | 'restore-source' | 'clear';

export interface PreviewNavigationTransition {
	state: PreviewNavigationState | null;
	action: PreviewNavigationAction;
}

export function beginPreviewNavigation(
	sourcePath: string,
	targetPath: string,
): PreviewNavigationState | null {
	if (!sourcePath || !targetPath || sourcePath === targetPath) {
		return null;
	}
	return { sourcePath, targetPath };
}

export type PreviewOpenStrategy =
	| { kind: 'existing'; leafIndex: number }
	| { kind: 'new-tab' };

/**
 * Open the target in its existing leaf or a new tab. Never reuse the source
 * editor — replacing that document remaps source anchors onto the target.
 */
export function resolvePreviewOpenStrategy(
	leaves: readonly { path: string }[],
	targetPath: string,
): PreviewOpenStrategy {
	const leafIndex = leaves.findIndex((leaf) => leaf.path === targetPath);
	return leafIndex >= 0 ? { kind: 'existing', leafIndex } : { kind: 'new-tab' };
}

/** `getLeaf('tab')` duplicates the current editor; wipe it before openFile. */
export function previewOpenNeedsDetachedEditor(
	strategy: PreviewOpenStrategy,
): boolean {
	return strategy.kind === 'new-tab';
}

export function shouldApplySessionToLeaf(input: {
	sessionFilePath: string;
	leafFilePath: string;
	previewTargetPath: string | null;
	leafIsPendingPreviewOpen: boolean;
	documentMatchesSession: boolean;
	openingPreview?: boolean;
	editorAlreadyAllowed?: boolean;
}): boolean {
	// A cloned tab still reports the source path until openFile finishes.
	// While preview navigation is active, only editors we already painted
	// may keep marks — never a newly created/cloned view.
	if (
		(input.openingPreview || input.previewTargetPath) &&
		!input.editorAlreadyAllowed
	) {
		return false;
	}
	if (input.leafIsPendingPreviewOpen) {
		return false;
	}
	if (input.previewTargetPath && input.leafFilePath === input.previewTargetPath) {
		return false;
	}
	if (!input.sessionFilePath || input.leafFilePath !== input.sessionFilePath) {
		return false;
	}
	return input.documentMatchesSession;
}

export function transitionPreviewNavigation(
	state: PreviewNavigationState,
	openedPath: string | null,
	openingPreview = false,
): PreviewNavigationTransition {
	if (openedPath === state.targetPath) {
		return { state, action: 'preserve' };
	}
	// getLeaf('tab') duplicates the source and fires file-open(source).
	// That is not the user returning to the source tab.
	if (openingPreview) {
		return { state, action: 'preserve' };
	}
	if (openedPath === state.sourcePath) {
		return { state: null, action: 'restore-source' };
	}
	return { state: null, action: 'clear' };
}
