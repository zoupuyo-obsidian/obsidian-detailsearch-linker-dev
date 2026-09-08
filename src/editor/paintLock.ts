/** CSS that shows plugin marks only on the editor bound to the current paint token. */
export function buildPaintLockCss(token: number): string {
	const n = String(token);
	return `
body[data-dsl-paint] .cm-editor:not([data-dsl-paint]) .cm-detailsearch-linker-mark,
body[data-dsl-paint="${n}"] .cm-editor[data-dsl-paint]:not([data-dsl-paint="${n}"]) .cm-detailsearch-linker-mark {
	background-color: transparent !important;
	color: inherit !important;
	font-weight: inherit !important;
	text-decoration: inherit !important;
}
body[data-dsl-paint] .cm-editor:not([data-dsl-paint]) .cm-detailsearch-linker-badge,
body[data-dsl-paint="${n}"] .cm-editor[data-dsl-paint]:not([data-dsl-paint="${n}"]) .cm-detailsearch-linker-badge {
	display: none !important;
}
`.trim();
}
