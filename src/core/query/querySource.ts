export type QuerySourceKind = 'selection' | 'autoExtract';

export interface SearchRequest {
	query: string;
	displayText: string;
	source: QuerySourceKind;
	anchorFrom: number;
	anchorTo: number;
	caseSensitive: boolean;
	/** When false, hits may be shown but wikilink insertion is blocked. */
	canLink: boolean;
}

export interface QuerySource {
	readonly kind: QuerySourceKind;
	resolve(
		text: string,
		selectionFrom: number,
		selectionTo: number,
		caseSensitive: boolean,
	): SearchRequest | null;
}
