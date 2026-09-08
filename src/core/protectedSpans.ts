export interface Span {
	start: number;
	end: number;
}

export function mergeSpans(spans: Span[]): Span[] {
	if (spans.length === 0) {
		return [];
	}
	const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
	const out: Span[] = [];
	let cur = { ...sorted[0]! };
	for (let i = 1; i < sorted.length; i++) {
		const next = sorted[i]!;
		if (next.start <= cur.end) {
			cur.end = Math.max(cur.end, next.end);
		} else {
			out.push(cur);
			cur = { ...next };
		}
	}
	out.push(cur);
	return out;
}

export function covers(spans: Span[], start: number, end: number): boolean {
	for (const span of spans) {
		if (span.start >= end) {
			return false;
		}
		if (start < span.end && end > span.start) {
			return true;
		}
	}
	return false;
}

function push(spans: Span[], start: number, end: number): void {
	if (end > start) {
		spans.push({ start, end });
	}
}

interface Line {
	start: number;
	contentEnd: number;
	end: number;
	content: string;
}

function readLine(text: string, start: number): Line {
	const newline = text.indexOf('\n', start);
	const end = newline === -1 ? text.length : newline + 1;
	let contentEnd = newline === -1 ? text.length : newline;
	if (contentEnd > start && text[contentEnd - 1] === '\r') {
		contentEnd--;
	}
	return { start, contentEnd, end, content: text.slice(start, contentEnd) };
}

function findBlockSpans(text: string): Span[] {
	const spans: Span[] = [];
	let offset = 0;

	const first = readLine(text, 0);
	if (first.content === '---') {
		let cursor = first.end;
		let closeEnd = -1;
		while (cursor < text.length) {
			const line = readLine(text, cursor);
			if (line.content === '---' || line.content === '...') {
				closeEnd = line.end;
				break;
			}
			cursor = line.end;
		}
		if (closeEnd !== -1) {
			push(spans, 0, closeEnd);
			offset = closeEnd;
		}
	}

	while (offset < text.length) {
		const line = readLine(text, offset);
		const fence = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line.content);
		if (fence && !(fence[2]![0] === '`' && fence[3]!.includes('`'))) {
			const marker = fence[2]![0]!;
			const openingLength = fence[2]!.length;
			let cursor = line.end;
			let closeEnd = -1;
			while (cursor < text.length) {
				const candidate = readLine(text, cursor);
				const close = /^( {0,3})(`+|~+)[ \t]*$/.exec(candidate.content);
				if (
					close &&
					close[2]![0] === marker &&
					close[2]!.length >= openingLength
				) {
					closeEnd = candidate.end;
					break;
				}
				cursor = candidate.end;
			}
			const end = closeEnd === -1 ? text.length : closeEnd;
			push(spans, line.start, end);
			offset = end;
			continue;
		}

		if (/^[ \t]*\$\$[ \t]*$/.test(line.content)) {
			let cursor = line.end;
			let closeEnd = -1;
			while (cursor < text.length) {
				const candidate = readLine(text, cursor);
				if (/^[ \t]*\$\$[ \t]*$/.test(candidate.content)) {
					closeEnd = candidate.end;
					break;
				}
				cursor = candidate.end;
			}
			const end = closeEnd === -1 ? text.length : closeEnd;
			push(spans, line.start, end);
			offset = end;
			continue;
		}
		offset = line.end;
	}
	return spans;
}

function isEscaped(text: string, position: number): boolean {
	let slashes = 0;
	for (let i = position - 1; i >= 0 && text[i] === '\\'; i--) {
		slashes++;
	}
	return slashes % 2 === 1;
}

interface InlineIndex {
	bracketClose: Map<number, number>;
	codeClose: Map<number, number>;
	codeRunLength: Map<number, number>;
	commentClose: Map<number, number>;
	wikiClose: Map<number, number>;
}

const MAX_MARKDOWN_DESTINATION_DEPTH = 32;
const MAX_MARKDOWN_DESTINATION_SCAN = 4096;

function buildInlineIndex(text: string, start: number, end: number): InlineIndex {
	const bracketClose = new Map<number, number>();
	const bracketStack: number[] = [];
	const codeClose = new Map<number, number>();
	const codeRunLength = new Map<number, number>();
	const pendingCode = new Map<number, number>();
	const commentClose = new Map<number, number>();
	const wikiClose = new Map<number, number>();
	let pendingComment = -1;
	let pendingWiki = -1;

	for (let i = start; i < end; ) {
		if (text.startsWith('<!--', i) && pendingComment === -1) {
			pendingComment = i;
			i += 4;
			continue;
		}
		if (text.startsWith('-->', i) && pendingComment !== -1) {
			commentClose.set(pendingComment, i + 3);
			pendingComment = -1;
			i += 3;
			continue;
		}
		if ((text.startsWith('[[', i) || text.startsWith('![[', i)) && pendingWiki === -1) {
			pendingWiki = text[i] === '!' ? i + 1 : i;
		}
		if (text.startsWith(']]', i) && !isEscaped(text, i) && pendingWiki !== -1) {
			wikiClose.set(pendingWiki, i + 2);
			pendingWiki = -1;
			i += 2;
			continue;
		}
		if (text[i] === '[' && !isEscaped(text, i)) {
			bracketStack.push(i);
		} else if (text[i] === ']' && !isEscaped(text, i)) {
			const open = bracketStack.pop();
			if (open !== undefined) {
				bracketClose.set(open, i);
			}
		}
		if (text[i] === '`') {
			let length = 1;
			while (i + length < end && text[i + length] === '`') {
				length++;
			}
			codeRunLength.set(i, length);
			const open = pendingCode.get(length);
			if (open === undefined) {
				pendingCode.set(length, i);
			} else {
				codeClose.set(open, i + length);
				pendingCode.delete(length);
			}
			i += length;
			continue;
		}
		i++;
	}
	return { bracketClose, codeClose, codeRunLength, commentClose, wikiClose };
}

function markdownLinkEnd(text: string, bracketStart: number, index: InlineIndex): number {
	const labelEnd = index.bracketClose.get(bracketStart) ?? -1;
	if (labelEnd === -1) {
		return -1;
	}
	const next = labelEnd + 1;
	if (text[next] === '[') {
		const referenceEnd = index.bracketClose.get(next) ?? -1;
		return referenceEnd === -1 ? -1 : referenceEnd + 1;
	}
	if (text[next] !== '(') {
		return -1;
	}

	let depth = 1;
	let quote = '';
	let inAngle = false;
	const scanEnd = Math.min(text.length, next + 1 + MAX_MARKDOWN_DESTINATION_SCAN);
	for (let i = next + 1; i < scanEnd; i++) {
		const char = text[i]!;
		if (char === '\n' || char === '\r') {
			return -1;
		}
		if (isEscaped(text, i)) {
			continue;
		}
		if (quote) {
			if (char === quote) {
				quote = '';
			}
			continue;
		}
		if (inAngle) {
			if (char === '>') {
				inAngle = false;
			}
			continue;
		}
		if (char === '<') {
			inAngle = true;
		} else if (char === '"' || char === "'") {
			quote = char;
		} else if (char === '(') {
			depth++;
			if (depth > MAX_MARKDOWN_DESTINATION_DEPTH) {
				return -1;
			}
		} else if (char === ')' && --depth === 0) {
			return i + 1;
		}
	}
	return -1;
}

function mathEnd(text: string, start: number, delimiterLength: number): number {
	const multiline = delimiterLength === 2;
	for (let i = start + delimiterLength; i < text.length; i++) {
		if (!multiline && (text[i] === '\n' || text[i] === '\r')) {
			return -1;
		}
		if (
			text[i] === '$' &&
			!isEscaped(text, i) &&
			(delimiterLength === 1 ? text[i + 1] !== '$' : text[i + 1] === '$')
		) {
			const before = text[i - 1];
			const after = text[i + delimiterLength];
			if (
				delimiterLength === 2 ||
				(before && !/\s/.test(before) && !/\d/.test(after ?? ''))
			) {
				return i + delimiterLength;
			}
		}
	}
	return -1;
}

const TAG_CHAR = /[\p{L}\p{N}_\-/]/u;

function codePointBefore(text: string, position: number): string | undefined {
	if (position === 0) {
		return undefined;
	}
	const previous = text.charCodeAt(position - 1);
	const start =
		previous >= 0xdc00 &&
		previous <= 0xdfff &&
		position >= 2 &&
		text.charCodeAt(position - 2) >= 0xd800 &&
		text.charCodeAt(position - 2) <= 0xdbff
			? position - 2
			: position - 1;
	return String.fromCodePoint(text.codePointAt(start)!);
}

function tagEnd(text: string, start: number): number {
	const previous = codePointBefore(text, start);
	if (
		isEscaped(text, start) ||
		(previous !== undefined && (TAG_CHAR.test(previous) || previous === '#' || previous === '/'))
	) {
		return -1;
	}
	const lineStart = text.lastIndexOf('\n', start - 1) + 1;
	const before = text.slice(lineStart, start);
	let markerEnd = start;
	while (text[markerEnd] === '#') {
		markerEnd++;
	}
	if (/^ {0,3}$/.test(before) && (markerEnd === text.length || /\s/.test(text[markerEnd]!))) {
		return -1;
	}
	let end = start + 1;
	while (end < text.length) {
		const codePoint = String.fromCodePoint(text.codePointAt(end)!);
		if (!TAG_CHAR.test(codePoint)) {
			break;
		}
		end += codePoint.length;
	}
	return end === start + 1 ? -1 : end;
}

function scanInlineSegment(text: string, start: number, end: number, spans: Span[]): void {
	const index = buildInlineIndex(text, start, end);
	for (let i = start; i < end; ) {
		let close = -1;
		if (text.startsWith('<!--', i)) {
			close = index.commentClose.get(i) ?? -1;
		} else if (text.startsWith('![[', i) || text.startsWith('[[', i)) {
			const open = text[i] === '!' ? i + 1 : i;
			close = index.wikiClose.get(open) ?? -1;
		} else if (text[i] === '`') {
			close = index.codeClose.get(i) ?? -1;
		} else if (
			(text[i] === '[' || (text[i] === '!' && text[i + 1] === '[')) &&
			!isEscaped(text, text[i] === '!' ? i + 1 : i)
		) {
			close = markdownLinkEnd(text, text[i] === '!' ? i + 1 : i, index);
			if (close > end) {
				close = -1;
			}
		} else if (text[i] === '$' && !isEscaped(text, i)) {
			const delimiterLength = text[i + 1] === '$' ? 2 : 1;
			const next = text[i + delimiterLength];
			if (
				next !== undefined &&
				(delimiterLength === 2 || (!/\s/.test(next) && !/\d/.test(next)))
			) {
				close = mathEnd(text, i, delimiterLength);
				if (close > end) {
					close = -1;
				}
			}
		} else if (text[i] === '#') {
			close = tagEnd(text, i);
		}
		if (close !== -1) {
			push(spans, i, close);
			i = close;
		} else {
			i += index.codeRunLength.get(i) ?? 1;
		}
	}
}

export function findProtectedSpans(text: string): Span[] {
	const blockSpans = findBlockSpans(text);
	const spans = [...blockSpans];
	let offset = 0;
	for (const block of blockSpans) {
		scanInlineSegment(text, offset, block.start, spans);
		offset = block.end;
	}
	scanInlineSegment(text, offset, text.length, spans);
	return mergeSpans(spans);
}
