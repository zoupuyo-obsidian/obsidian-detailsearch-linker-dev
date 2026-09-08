import { covers, findProtectedSpans } from '../protectedSpans';
import type { QuerySource, SearchRequest } from './querySource';
import { findTermOccurrences } from '../search/termMatch';
import { trimSelectionRange, validateQuery } from './queryValidation';

export class SelectionQuerySource implements QuerySource {
	readonly kind = 'selection' as const;

	resolve(
		text: string,
		selectionFrom: number,
		selectionTo: number,
		caseSensitive: boolean,
	): SearchRequest | null {
		if (selectionFrom === selectionTo) {
			return null;
		}
		const trimmed = trimSelectionRange(text, selectionFrom, selectionTo);
		if (!trimmed) {
			return null;
		}
		if (validateQuery(trimmed.query)) {
			return null;
		}
		const protectedSpans = findProtectedSpans(text);
		if (covers(protectedSpans, trimmed.from, trimmed.to)) {
			return null;
		}
		return {
			query: trimmed.query,
			displayText: trimmed.displayText,
			source: 'selection',
			anchorFrom: trimmed.from,
			anchorTo: trimmed.to,
			caseSensitive,
			canLink: true,
		};
	}
}

export class ModalQuerySource implements QuerySource {
	constructor(private readonly query: string) {}

	readonly kind = 'selection' as const;

	resolve(
		text: string,
		_selectionFrom: number,
		_selectionTo: number,
		caseSensitive: boolean,
	): SearchRequest | null {
		const query = this.query.trim();
		if (!query || validateQuery(this.query)) {
			return null;
		}
		const protectedSpans = findProtectedSpans(text);
		const occurrences = findTermOccurrences(text, query, caseSensitive, protectedSpans);
		if (occurrences.length === 0) {
			return null;
		}
		const first = occurrences[0]!;
		return {
			query,
			displayText: first.text,
			source: 'selection',
			anchorFrom: first.from,
			anchorTo: first.to,
			caseSensitive,
			canLink: true,
		};
	}
}

export function buildAnchorSpots(
	text: string,
	request: SearchRequest,
): { from: number; to: number; text: string }[] {
	if (request.source === 'selection' && request.anchorFrom !== request.anchorTo) {
		return [
			{
				from: request.anchorFrom,
				to: request.anchorTo,
				text: text.slice(request.anchorFrom, request.anchorTo),
			},
		];
	}
	if (!request.canLink) {
		return [];
	}
	const protectedSpans = findProtectedSpans(text);
	return findTermOccurrences(text, request.query, request.caseSensitive, protectedSpans).map(
		(o) => ({ from: o.from, to: o.to, text: o.text }),
	);
}

/** Returns true when a modal query would abort before vault scan. */
export function modalQueryMissingInNote(
	text: string,
	query: string,
	caseSensitive: boolean,
): boolean {
	return new ModalQuerySource(query).resolve(text, 0, 0, caseSensitive) === null;
}
