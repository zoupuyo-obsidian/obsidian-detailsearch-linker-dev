import { covers, findProtectedSpans } from '../protectedSpans';
import { findTermOccurrences } from './termMatch';

export interface Heading {
	level: number;
	text: string;
	offset: number;
}

const ATX_HEADING = /^( {0,3})(#{1,6})\s+(.+?)\s*#*\s*$/;
const SETEXT_UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/;
const SETEXT_TEXT = /^ {0,3}\S/;

export function findHeadings(text: string): Heading[] {
	const protectedSpans = findProtectedSpans(text);
	const headings: Heading[] = [];
	const lines = text.split('\n').map((raw) => (raw.endsWith('\r') ? raw.slice(0, -1) : raw));
	let offset = 0;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		const m = ATX_HEADING.exec(line);
		if (m) {
			const lineEnd = offset + line.length;
			if (!covers(protectedSpans, offset, lineEnd)) {
				headings.push({
					level: m[2]!.length,
					text: m[3]!.trim(),
					offset,
				});
			}
		} else if (SETEXT_TEXT.test(line)) {
			const next = lines[i + 1];
			const underline = next === undefined ? null : SETEXT_UNDERLINE.exec(next);
			if (underline) {
				const lineEnd = offset + line.length;
				const underlineStart = lineEnd + (text[lineEnd] === '\r' ? 2 : 1);
				const underlineEnd = underlineStart + next!.length;
				if (
					!covers(protectedSpans, offset, lineEnd) &&
					!covers(protectedSpans, underlineStart, underlineEnd)
				) {
					headings.push({
						level: underline[1]![0] === '=' ? 1 : 2,
						text: line.trim(),
						offset,
					});
				}
			}
		}
		offset += line.length + (text[offset + line.length] === '\r' ? 2 : 1);
	}
	return headings;
}

export function nearestHeading(headings: Heading[], position: number): Heading | null {
	let best: Heading | null = null;
	for (const h of headings) {
		if (h.offset <= position) {
			best = h;
		} else {
			break;
		}
	}
	return best;
}

export function buildExcerpt(
	text: string,
	hitStart: number,
	hitEnd: number,
	maxLen: number,
): string {
	const radius = Math.max(20, Math.floor((maxLen - (hitEnd - hitStart)) / 2));
	let start = Math.max(0, hitStart - radius);
	let end = Math.min(text.length, hitEnd + radius);
	if (end - start > maxLen) {
		end = start + maxLen;
	}
	let excerpt = text.slice(start, end).replace(/\s+/g, ' ').trim();
	if (start > 0) {
		excerpt = `…${excerpt}`;
	}
	if (end < text.length) {
		excerpt = `${excerpt}…`;
	}
	return excerpt;
}

/** Rebuild a preview excerpt from a cached hit that no longer stores text. */
export function hydrateHitExcerpt(
	text: string,
	offset: number,
	query: string,
	caseSensitive: boolean,
	maxLen: number,
): string {
	if (!text || offset < 0 || offset > text.length) {
		return '';
	}
	const occurrences = findTermOccurrences(text, query, caseSensitive, []);
	const match =
		occurrences.find((item) => item.from === offset) ??
		occurrences.find((item) => item.from <= offset && offset < item.to);
	const from = match?.from ?? offset;
	const to =
		match?.to ??
		Math.min(text.length, offset + Math.max(query.trim().length, 1));
	return buildExcerpt(text, from, to, maxLen);
}
