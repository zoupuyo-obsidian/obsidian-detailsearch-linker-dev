export interface SearchRunSnapshot {
	runId: number;
	filePath: string;
	text: string;
}

export interface CurrentSearchContext extends SearchRunSnapshot {
	sameEditor: boolean;
}

export function searchRunIsCurrent(
	snapshot: SearchRunSnapshot,
	current: CurrentSearchContext,
): boolean {
	return (
		snapshot.runId === current.runId &&
		snapshot.filePath === current.filePath &&
		snapshot.text === current.text &&
		current.sameEditor
	);
}
