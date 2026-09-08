function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '') || '';
}

export type ScopeMode = 'all' | 'recent' | 'workset' | 'recent-workset';

export interface ScopeFilterInput {
	includeFolders: string[];
	excludeFolders: string[];
	scopeMode: ScopeMode;
	recentDays: number;
	worksetPaths: string[];
	maxFiles: number;
	maxFileBytes: number;
}

export interface ScopedFile {
	path: string;
	statMtime: number;
	size: number;
}

export interface ScopeEnumerateResult {
	files: ScopedFile[];
	skippedBySize: number;
	skippedByLimit: number;
}

function normalizeFolder(raw: string): string {
	const n = normalizePath(raw.trim());
	if (!n || n === '/') {
		return '';
	}
	return n.replace(/\/+$/, '');
}

export function pathInFolders(
	filePath: string,
	includeFolders: string[],
	excludeFolders: string[],
): boolean {
	const normalized = normalizeFolder(filePath);
	for (const raw of excludeFolders) {
		const ex = normalizeFolder(raw);
		if (!ex) {
			continue;
		}
		if (normalized === ex || normalized.startsWith(`${ex}/`)) {
			return false;
		}
	}
	const includes = includeFolders.map(normalizeFolder).filter(Boolean);
	if (includes.length === 0) {
		return true;
	}
	return includes.some((inc) => normalized === inc || normalized.startsWith(`${inc}/`));
}

export function scopeFingerprint(input: ScopeFilterInput): string {
	return JSON.stringify({
		include: input.includeFolders.map(normalizeFolder).sort(),
		exclude: input.excludeFolders.map(normalizeFolder).sort(),
		mode: input.scopeMode,
		recentDays: input.recentDays,
		workset: [...input.worksetPaths].sort(),
		maxFiles: input.maxFiles,
		maxFileBytes: input.maxFileBytes,
	});
}

function isRecent(mtimeMs: number, recentDays: number, nowMs: number): boolean {
	if (recentDays <= 0) {
		return true;
	}
	const cutoff = nowMs - recentDays * 86_400_000;
	return mtimeMs >= cutoff;
}

export function filterScopeFiles(
	candidates: ScopedFile[],
	input: ScopeFilterInput,
	selfPath: string,
	nowMs = Date.now(),
): ScopeEnumerateResult {
	const workset = new Set(input.worksetPaths);
	let filtered = candidates.filter((f) => {
		if (f.path === selfPath) {
			return false;
		}
		if (!pathInFolders(f.path, input.includeFolders, input.excludeFolders)) {
			return false;
		}
		switch (input.scopeMode) {
			case 'all':
				return true;
			case 'recent':
				return isRecent(f.statMtime, input.recentDays, nowMs);
			case 'workset':
				return workset.has(f.path);
			case 'recent-workset':
				return workset.has(f.path) || isRecent(f.statMtime, input.recentDays, nowMs);
		}
	});

	filtered.sort((a, b) => b.statMtime - a.statMtime);

	let skippedBySize = 0;
	filtered = filtered.filter((f) => {
		if (f.size > input.maxFileBytes) {
			skippedBySize++;
			return false;
		}
		return true;
	});

	let skippedByLimit = 0;
	if (input.maxFiles > 0 && filtered.length > input.maxFiles) {
		skippedByLimit = filtered.length - input.maxFiles;
		filtered = filtered.slice(0, input.maxFiles);
	}

	return { files: filtered, skippedBySize, skippedByLimit };
}

export class WorksetTracker {
	private paths: string[] = [];

	constructor(private maxSize: number) {}

	touch(path: string): void {
		this.paths = this.paths.filter((p) => p !== path);
		this.paths.unshift(path);
		if (this.maxSize > 0 && this.paths.length > this.maxSize) {
			this.paths.length = this.maxSize;
		}
	}

	pathsSnapshot(): string[] {
		return [...this.paths];
	}

	setMaxSize(size: number): void {
		this.maxSize = size;
		if (this.maxSize > 0 && this.paths.length > this.maxSize) {
			this.paths.length = this.maxSize;
		}
	}
}

export function clampScopeValue(
	value: number,
	min: number,
	max: number,
	fallback: number,
): number {
	if (!Number.isFinite(value)) {
		return fallback;
	}
	return Math.min(max, Math.max(min, Math.floor(value)));
}
