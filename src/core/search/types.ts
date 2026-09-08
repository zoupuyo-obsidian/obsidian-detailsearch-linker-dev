export interface BodyHit {
	path: string;
	heading: string;
	offset: number;
	excerpt: string;
	mtime: number;
}

export interface ScanStats {
	filesRead: number;
	filesSkippedSize: number;
	filesSkippedLimit: number;
	hitsFound: number;
}

export interface CancelToken {
	readonly cancelled: boolean;
}

export const BODY_CHUNK_SIZE = 65536;

export function yieldToUi(): Promise<void> {
	return new Promise((resolve) => {
		if (typeof window !== 'undefined') {
			window.setTimeout(resolve, 0);
			return;
		}
		queueMicrotask(resolve);
	});
}
