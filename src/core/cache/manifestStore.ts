export interface FileManifestEntry {
	mtime: number;
	lastChangedGeneration: number;
}

export interface VaultManifest {
	generation: number;
	files: Record<string, FileManifestEntry>;
}

export interface ScopedFileSnapshot {
	path: string;
	mtime: number;
}

export const MANIFEST_VERSION = 2;

export class ManifestStore {
	private files = new Map<string, FileManifestEntry>();
	private generation = 0;
	private readonly pendingDeletes = new Set<string>();
	private readonly pendingRenames: { oldPath: string; newPath: string; mtime: number }[] = [];

	getGeneration(): number {
		return this.generation;
	}

	getEntry(path: string): FileManifestEntry | undefined {
		return this.files.get(path);
	}

	load(data: VaultManifest | null | undefined): void {
		this.files.clear();
		this.pendingDeletes.clear();
		this.pendingRenames.length = 0;
		if (!data || typeof data.generation !== 'number') {
			this.generation = 0;
			return;
		}
		this.generation = data.generation;
		for (const [path, entry] of Object.entries(data.files ?? {})) {
			if (
				entry &&
				typeof entry.mtime === 'number' &&
				typeof entry.lastChangedGeneration === 'number'
			) {
				this.files.set(path, {
					mtime: entry.mtime,
					lastChangedGeneration: entry.lastChangedGeneration,
				});
			}
		}
	}

	exportData(): VaultManifest {
		const files: Record<string, FileManifestEntry> = {};
		for (const [path, entry] of this.files) {
			files[path] = { ...entry };
		}
		return { generation: this.generation, files };
	}

	private bumpPath(path: string, mtime: number): void {
		this.generation++;
		this.files.set(path, { mtime, lastChangedGeneration: this.generation });
	}

	noteChanged(path: string, mtime: number): void {
		const prev = this.files.get(path);
		if (prev?.mtime === mtime) {
			return;
		}
		this.bumpPath(path, mtime);
	}

	noteDeleted(path: string): void {
		this.pendingDeletes.add(path);
		if (this.files.delete(path)) {
			this.generation++;
		}
	}

	noteRenamed(oldPath: string, newPath: string, mtime: number): void {
		this.pendingRenames.push({ oldPath, newPath, mtime });
	}

	private flushPending(): void {
		for (const path of this.pendingDeletes) {
			if (this.files.delete(path)) {
				this.generation++;
			}
		}
		this.pendingDeletes.clear();

		for (const { oldPath, newPath, mtime } of this.pendingRenames) {
			if (this.files.delete(oldPath)) {
				this.generation++;
			}
			this.bumpPath(newPath, mtime);
		}
		this.pendingRenames.length = 0;
	}

	/**
	 * Sync manifest with the current scoped file set. Returns the current global generation.
	 * New, changed, pending delete/rename (including while Obsidian was stopped) bump path generation.
	 */
	reconcile(scoped: ScopedFileSnapshot[]): number {
		this.flushPending();
		for (const { path, mtime } of scoped) {
			const entry = this.files.get(path);
			if (!entry || entry.mtime !== mtime) {
				this.bumpPath(path, mtime);
			}
		}
		return this.generation;
	}

	pathsNeedingRescan(scopedPaths: readonly string[], scannedGeneration: number): string[] {
		const out: string[] = [];
		for (const path of scopedPaths) {
			const entry = this.files.get(path);
			if (!entry || entry.lastChangedGeneration > scannedGeneration) {
				out.push(path);
			}
		}
		return out;
	}
}
