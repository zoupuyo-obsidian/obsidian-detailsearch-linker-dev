export type UnifiedSearchBranch = 'selection' | 'auto';

export type RibbonAction = 'selection' | 'auto' | 'clear';

export function hasNonEmptySelection(selectionText: string): boolean {
	return selectionText.trim().length > 0;
}

/** Unified command: non-empty trimmed selection → selection search, else auto extract. */
export function resolveUnifiedCommandBranch(selectionText: string): UnifiedSearchBranch {
	return hasNonEmptySelection(selectionText) ? 'selection' : 'auto';
}

/**
 * Ribbon: selection → search (even if highlights exist); no selection + highlights → clear;
 * no selection + no highlights → auto extract.
 */
export function resolveRibbonAction(
	selectionText: string,
	hasActiveSession: boolean,
): RibbonAction {
	if (hasNonEmptySelection(selectionText)) {
		return 'selection';
	}
	if (hasActiveSession) {
		return 'clear';
	}
	return 'auto';
}
