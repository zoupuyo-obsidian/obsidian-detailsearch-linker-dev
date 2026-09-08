import { emptySession, type DetailSessionState } from './session';

/** Prefer the editor-mapped session; fall back to the painted session for the same note. */
export function preferSession(
	canonical: DetailSessionState,
	editorSession: DetailSessionState | null,
	activePath: string | undefined,
): DetailSessionState {
	if (editorSession?.filePath) {
		return editorSession;
	}
	return activePath === canonical.filePath ? canonical : emptySession();
}

/** Copy an editor-mapped session back only when it still belongs to the painted note. */
export function shouldAdoptEditorSession(
	canonical: DetailSessionState,
	live: DetailSessionState | null,
	documentMatches: boolean,
): live is DetailSessionState {
	return !!(
		live?.filePath &&
		live.filePath === canonical.filePath &&
		documentMatches
	);
}

/** Single owner of the painted session. Editor StateFields are mapped views of this. */
export class SessionController {
	private state: DetailSessionState = emptySession();

	get(): DetailSessionState {
		return this.state;
	}

	replace(next: DetailSessionState): DetailSessionState {
		this.state = next;
		return this.state;
	}

	update(
		patch: (current: DetailSessionState) => DetailSessionState,
	): DetailSessionState {
		this.state = patch(this.state);
		return this.state;
	}

	clear(): DetailSessionState {
		return this.replace(emptySession());
	}

	hasActive(): boolean {
		return !!this.state.filePath && this.state.anchors.length > 0;
	}

	prefer(
		editorSession: DetailSessionState | null,
		activePath: string | undefined,
	): DetailSessionState {
		return preferSession(this.state, editorSession, activePath);
	}

	adoptEditorSession(
		live: DetailSessionState | null,
		documentMatches: boolean,
	): boolean {
		if (!shouldAdoptEditorSession(this.state, live, documentMatches)) {
			return false;
		}
		this.state = live;
		return true;
	}
}
