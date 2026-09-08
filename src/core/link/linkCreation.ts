export interface CachedHeading {
	heading: string;
	position: {
		start: {
			offset: number;
		};
	};
}

export type MarkdownLinkGenerator<T> = (
	file: T,
	sourcePath: string,
	subpath: string,
	alias: string,
) => string;

export function resolveHeadingAtOffset(
	headings: readonly CachedHeading[] | null,
	hitOffset: number,
	fallbackHeading: string,
): string {
	if (headings === null) {
		return fallbackHeading;
	}

	let nearest: CachedHeading | undefined;
	for (const heading of headings) {
		if (heading.position.start.offset > hitOffset) {
			continue;
		}
		if (
			!nearest ||
			heading.position.start.offset >= nearest.position.start.offset
		) {
			nearest = heading;
		}
	}
	return nearest?.heading ?? '';
}

export function targetMtimeMatches(hitMtime: number, targetMtime: number): boolean {
	return hitMtime === targetMtime;
}

export function sourceMatchesLiveSession(
	sourcePath: string,
	liveSessionFilePath: string,
): boolean {
	return sourcePath.length > 0 && sourcePath === liveSessionFilePath;
}

export function generateHeadingLink<T>(
	generateMarkdownLink: MarkdownLinkGenerator<T>,
	targetFile: T,
	sourcePath: string,
	heading: string,
	alias: string,
): string {
	const subpath = heading ? `#${heading}` : '';
	return generateMarkdownLink(targetFile, sourcePath, subpath, alias);
}
