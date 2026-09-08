import { App, Modal, Notice, Setting } from 'obsidian';
import { t, tf } from '../i18n';
import type { UiLanguage } from '../settings';
import { MAX_QUERY_LENGTH, validateQuery, type QueryValidationError } from '../core/query/queryValidation';

function validationMessage(lang: UiLanguage, error: QueryValidationError): string {
	switch (error) {
		case 'empty':
			return t(lang, 'queryModalInvalidEmpty');
		case 'newline':
			return t(lang, 'queryModalInvalidNewline');
		case 'too_long':
			return tf(lang, 'queryModalInvalidTooLong', MAX_QUERY_LENGTH);
		case 'link_syntax':
			return t(lang, 'queryModalInvalidLinkSyntax');
	}
}

export class QueryInputModal extends Modal {
	private value = '';

	constructor(
		app: App,
		private readonly lang: UiLanguage,
		private readonly onSubmit: (query: string) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const lang = this.lang;
		this.setTitle(t(lang, 'queryModalTitle'));
		this.contentEl.createEl('p', { text: t(lang, 'queryModalDesc') });
		new Setting(this.contentEl)
			.setName(t(lang, 'queryModalLabel'))
			.addText((text) => {
				text.setPlaceholder(t(lang, 'queryModalPlaceholder'));
				text.inputEl.addEventListener('keydown', (evt: KeyboardEvent) => {
					if (evt.key === 'Enter') {
						evt.preventDefault();
						this.submit();
					}
				});
				text.onChange((v: string) => {
					this.value = v;
				});
				window.setTimeout(() => text.inputEl.focus(), 0);
			});
		new Setting(this.contentEl).addButton((btn) =>
			btn
				.setButtonText(t(lang, 'queryModalSearch'))
				.setCta()
				.onClick(() => this.submit()),
		);
	}

	private submit(): void {
		const error = validateQuery(this.value);
		if (error) {
			new Notice(validationMessage(this.lang, error));
			return;
		}
		const trimmed = this.value.trim();
		this.close();
		this.onSubmit(trimmed);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export function promptSearchQuery(
	app: App,
	lang: UiLanguage,
): Promise<string | null> {
	return new Promise((resolve) => {
		new QueryInputModal(app, lang, (query) => resolve(query)).open();
	});
}

export function noticeQueryValidation(lang: UiLanguage, error: QueryValidationError): void {
	new Notice(validationMessage(lang, error));
}
