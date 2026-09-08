import { emptySession, type DetailSessionState } from '../../session';

import { groupKeyForQuery } from '../extract/queryExtractor';

export function resolveIgnoreGroupKey(
	query: string,
	groupKey: string,
	caseSensitive: boolean,
): string {
	const trimmedKey = groupKey.trim();
	if (trimmedKey) {
		return trimmedKey;
	}
	const trimmedQuery = query.trim();
	if (!trimmedQuery) {
		return '';
	}
	return groupKeyForQuery(trimmedQuery, caseSensitive);
}

export function removeGroupFromSession(
	session: DetailSessionState,
	groupKey: string,
): DetailSessionState {
	const groups = session.groups.filter((g) => g.key !== groupKey);
	const anchors = session.anchors.filter((a) => a.groupKey !== groupKey);
	if (groups.length === 0 || anchors.length === 0) {
		return emptySession();
	}
	return {
		...session,
		groups,
		anchors,
	};
}
