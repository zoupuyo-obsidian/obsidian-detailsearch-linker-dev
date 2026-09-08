import type { ManifestStore } from '../cache/manifestStore';

/**
 * Return the highest generation that can safely be marked complete without
 * acknowledging any path whose read failed.
 */
export function generationBeforeFailures(
	manifest: ManifestStore,
	currentGeneration: number,
	previousGeneration: number,
	failedPaths: ReadonlySet<string>,
): number {
	let safeGeneration = currentGeneration;
	for (const path of failedPaths) {
		const entry = manifest.getEntry(path);
		if (!entry) {
			return previousGeneration;
		}
		safeGeneration = Math.min(
			safeGeneration,
			Math.max(previousGeneration, entry.lastChangedGeneration - 1),
		);
	}
	return safeGeneration;
}
