import type { ExtractedCandidate } from '../extract/queryExtractor';
import { normalizeTerm } from '../search/termMatch';

export function normalizeIgnoredTerms(terms: readonly string[], caseSensitive: boolean): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of terms) {
		const trimmed = raw.trim();
		if (!trimmed) {
			continue;
		}
		const key = normalizeTerm(trimmed, caseSensitive);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		out.push(trimmed);
	}
	return out;
}

export function parseIgnoredTermsText(text: string, caseSensitive: boolean): string[] {
	return normalizeIgnoredTerms(
		text.split(/\r?\n/),
		caseSensitive,
	);
}

export function isIgnoredTerm(
	query: string,
	ignoredTerms: readonly string[],
	caseSensitive: boolean,
): boolean {
	const key = normalizeTerm(query, caseSensitive);
	if (!key) {
		return false;
	}
	return ignoredTerms.some((term) => normalizeTerm(term, caseSensitive) === key);
}

export function addIgnoredTerm(
	current: readonly string[],
	term: string,
	caseSensitive: boolean,
): string[] {
	const trimmed = term.trim();
	if (!trimmed) {
		return [...current];
	}
	return normalizeIgnoredTerms([...current, trimmed], caseSensitive);
}

export function filterIgnoredExtractedCandidates(
	candidates: readonly ExtractedCandidate[],
	ignoredTerms: readonly string[],
	caseSensitive: boolean,
): ExtractedCandidate[] {
	if (ignoredTerms.length === 0) {
		return [...candidates];
	}
	return candidates.filter((c) => !isIgnoredTerm(c.query, ignoredTerms, caseSensitive));
}
