import {
	getLanguage,
	normalizePath,
	PluginSettingTab,
	type App,
	type SettingDefinitionItem,
	type SettingDefinitionRender,
} from 'obsidian';
import type DetailSearchLinkerPlugin from './main';
import { t, type I18nKey } from './i18n';
import { parseIgnoredTermsText } from './core/ignore/ignoredTerms';
import {
	INTEGER_SETTING_BOUNDS,
	migrateSettingsCore,
	repairOrderedPairAfterChange,
	type CacheMode,
	type DetailSearchLinkerSettings,
	type IntegerSettingKey,
	type OrderedPairSettingKey,
	type UiLanguage,
} from './core/settings/settingsSchema';
import type { ScopeMode } from './core/search/scopeFilter';

export {
	DEFAULT_SETTINGS,
	INTEGER_SETTING_BOUNDS,
	type CacheMode,
	type DetailSearchLinkerSettings,
	type HighlightStyle,
	type OrderedPairSettingKey,
	type UiLanguage,
} from './core/settings/settingsSchema';

export function defaultUiLanguage(): UiLanguage {
	return getLanguage() === 'ja' ? 'ja' : 'en';
}

function linesToList(value: string): string[] {
	return value
		.split(/\r?\n/)
		.map((s) => normalizePath(s.trim()))
		.filter(Boolean);
}

export function migrateSettings(raw: unknown): DetailSearchLinkerSettings {
	return migrateSettingsCore(raw, { defaultUiLanguage, normalizePath });
}

export class DetailSearchLinkerSettingTab extends PluginSettingTab {
	plugin: DetailSearchLinkerPlugin;

	constructor(app: App, plugin: DetailSearchLinkerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private lang(): UiLanguage {
		return this.plugin.settings.uiLanguage;
	}

	private L(key: I18nKey): string {
		return t(this.lang(), key);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			this.languageRow(),
			this.folderTextarea('settingsIncludeFolders', 'settingsIncludeFoldersDesc', 'includeFolders'),
			this.folderTextarea('settingsExcludeFolders', 'settingsExcludeFoldersDesc', 'excludeFolders'),
			this.scopeModeRow(),
			this.boundedSliderRow('settingsRecentDays', 'settingsRecentDaysDesc', 'recentDays'),
			this.boundedSliderRow('settingsWorksetSize', 'settingsWorksetSizeDesc', 'worksetSize'),
			this.boundedSliderRow('settingsMaxFiles', 'settingsMaxFilesDesc', 'maxFiles'),
			this.sliderRow(
				'settingsMaxFileBytes',
				'settingsMaxFileBytesDesc',
				'maxFileBytes',
				INTEGER_SETTING_BOUNDS.maxFileBytes.min,
				INTEGER_SETTING_BOUNDS.maxFileBytes.max,
				INTEGER_SETTING_BOUNDS.maxFileBytes.step,
				(v) => `${Math.round(v / 1024)} KB`,
			),
			this.toggleRow('settingsCaseSensitive', 'caseSensitive'),
			this.cacheModeRow(),
			this.boundedSliderRow('settingsCacheMaxMb', 'settingsCacheMaxMbDesc', 'cacheMaxMb', (v) => `${v} MB`),
			this.boundedSliderRow('settingsExcerptLength', 'settingsExcerptLengthDesc', 'excerptLength'),
			this.boundedSliderRow('settingsMaxHitsPerNote', 'settingsMaxHitsPerNoteDesc', 'maxHitsPerNote'),
			this.boundedSliderRow('settingsMaxCandidateNotes', 'settingsMaxCandidateNotesDesc', 'maxCandidateNotes'),
			{
				name: this.L('settingsHighlightStyle'),
				desc: this.L('settingsHighlightStyleDesc'),
				control: {
					type: 'dropdown',
					key: 'highlightStyle',
					defaultValue: 'invert',
					options: {
						invert: this.L('styleInvert'),
						marker: this.L('styleMarker'),
						color: this.L('styleColor'),
						underline: this.L('styleUnderline'),
					},
				},
			},
			this.toggleRow('settingsShowBadge', 'showBadge'),
			this.toggleRow('settingsClearOnFileChange', 'clearOnFileChange'),
			this.toggleRow('settingsFocusedExtraction', 'focusedExtraction'),
			this.toggleRow('settingsNormalProse', 'normalProsePhrases'),
			this.toggleRow('settingsBroadNgram', 'broadNgram'),
			this.boundedSliderRow('settingsAutoMinTerm', 'settingsAutoMinTermDesc', 'autoMinTermLength'),
			this.boundedSliderRow('settingsAutoMaxTerm', 'settingsAutoMaxTermDesc', 'autoMaxTermLength'),
			this.boundedSliderRow('settingsNgramMin', 'settingsNgramMinDesc', 'ngramMinLength'),
			this.boundedSliderRow('settingsNgramMax', 'settingsNgramMaxDesc', 'ngramMaxLength'),
			this.boundedSliderRow('settingsMaxAutoQueries', 'settingsMaxAutoQueriesDesc', 'maxAutoQueries'),
			this.boundedSliderRow('settingsNgramSpanLimit', 'settingsNgramSpanLimitDesc', 'ngramSpanLimit'),
			this.stopWordsRow(),
			this.ignoredTermsRow(),
			this.cacheInfoRow(),
		];
	}

	setControlValue(key: string, value: unknown): void | Promise<void> {
		let counterpartChanged = false;
		if (this.isOrderedPairSettingKey(key) && typeof value === 'number') {
			this.plugin.settings[key] = value;
			counterpartChanged = repairOrderedPairAfterChange(this.plugin.settings, key);
		}
		if (counterpartChanged) {
			const result = super.setControlValue(key, value);
			void Promise.resolve(result).then(() => this.update());
			return result;
		}
		if (key === 'highlightStyle' || key === 'showBadge') {
			const result = super.setControlValue(key, value);
			void Promise.resolve(result).then(() => this.plugin.refreshHighlightAppearance());
			return result;
		}
		if (
			key === 'cacheMode' ||
			key === 'cacheMaxMb' ||
			key === 'includeFolders' ||
			key === 'excludeFolders' ||
			key === 'scopeMode' ||
			key === 'recentDays' ||
			key === 'worksetSize' ||
			key === 'maxFiles' ||
			key === 'maxFileBytes' ||
			key === 'caseSensitive'
		) {
			const result = super.setControlValue(key, value);
			void Promise.resolve(result).then(() => {
				this.plugin.onScopeOrCacheSettingsChanged();
			});
			return result;
		}
		return super.setControlValue(key, value);
	}

	private languageRow(): SettingDefinitionRender {
		return {
			name: this.L('settingsLanguage'),
			desc: this.L('settingsLanguageDesc'),
			render: (setting) => {
				setting
					.setName(this.L('settingsLanguage'))
					.setDesc(this.L('settingsLanguageDesc'))
					.addDropdown((dropdown) =>
						dropdown
							.addOption('ja', '日本語')
							.addOption('en', 'English')
							.setValue(this.plugin.settings.uiLanguage)
							.onChange(async (value) => {
								this.plugin.settings.uiLanguage = value as UiLanguage;
								await this.plugin.saveSettings();
								this.update();
								this.plugin.applyUiLanguage();
							}),
					);
			},
		};
	}

	private folderTextarea(
		nameKey: I18nKey,
		descKey: I18nKey,
		field: 'includeFolders' | 'excludeFolders',
	): SettingDefinitionRender {
		return {
			name: this.L(nameKey),
			desc: this.L(descKey),
			render: (setting) => {
				setting
					.setName(this.L(nameKey))
					.setDesc(this.L(descKey))
					.addTextArea((area) => {
						area
							.setValue(this.plugin.settings[field].join('\n'))
							.onChange(async (value) => {
								this.plugin.settings[field] = linesToList(value);
								this.plugin.onScopeOrCacheSettingsChanged();
								await this.plugin.saveSettings();
							});
						area.inputEl.rows = 4;
						area.inputEl.addClass('detailsearch-linker-textarea');
					});
			},
		};
	}

	private scopeModeRow(): SettingDefinitionRender {
		return {
			name: this.L('settingsScopeMode'),
			desc: this.L('settingsScopeModeDesc'),
			render: (setting) => {
				setting
					.setName(this.L('settingsScopeMode'))
					.setDesc(this.L('settingsScopeModeDesc'))
					.addDropdown((dropdown) =>
						dropdown
							.addOption('all', this.L('scopeAll'))
							.addOption('recent', this.L('scopeRecent'))
							.addOption('workset', this.L('scopeWorkset'))
							.addOption('recent-workset', this.L('scopeRecentWorkset'))
							.setValue(this.plugin.settings.scopeMode)
							.onChange(async (value) => {
								this.plugin.settings.scopeMode = value as ScopeMode;
								this.plugin.onScopeOrCacheSettingsChanged();
								await this.plugin.saveSettings();
							}),
					);
			},
		};
	}

	private cacheModeRow(): SettingDefinitionRender {
		return {
			name: this.L('settingsCacheMode'),
			desc: this.L('settingsCacheModeDesc'),
			render: (setting) => {
				setting
					.setName(this.L('settingsCacheMode'))
					.setDesc(this.L('settingsCacheModeDesc'))
					.addDropdown((dropdown) =>
						dropdown
							.addOption('persistent', this.L('cachePersistent'))
							.addOption('memory', this.L('cacheMemory'))
							.setValue(this.plugin.settings.cacheMode)
							.onChange(async (value) => {
								this.plugin.settings.cacheMode = value as CacheMode;
								this.plugin.onScopeOrCacheSettingsChanged();
								await this.plugin.saveSettings();
							}),
					);
			},
		};
	}

	private stopWordsRow(): SettingDefinitionRender {
		return {
			name: this.L('settingsAutoStopWords'),
			desc: this.L('settingsAutoStopWordsDesc'),
			render: (setting) => {
				setting
					.setName(this.L('settingsAutoStopWords'))
					.setDesc(this.L('settingsAutoStopWordsDesc'))
					.addTextArea((area) => {
						area
							.setValue(this.plugin.settings.autoStopWords.join('\n'))
							.onChange(async (value) => {
								this.plugin.settings.autoStopWords = value
									.split(/\r?\n/)
									.map((s) => s.trim())
									.filter(Boolean);
								await this.plugin.saveSettings();
							});
						area.inputEl.rows = 4;
						area.inputEl.addClass('detailsearch-linker-textarea');
					});
			},
		};
	}

	private ignoredTermsRow(): SettingDefinitionRender {
		return {
			name: this.L('settingsIgnoredTerms'),
			desc: this.L('settingsIgnoredTermsDesc'),
			render: (setting) => {
				setting
					.setName(this.L('settingsIgnoredTerms'))
					.setDesc(this.L('settingsIgnoredTermsDesc'))
					.addTextArea((area) => {
						area
							.setValue(this.plugin.settings.ignoredTerms.join('\n'))
							.onChange(async (value) => {
								this.plugin.settings.ignoredTerms = parseIgnoredTermsText(
									value,
									this.plugin.settings.caseSensitive,
								);
								await this.plugin.saveSettings();
							});
						area.inputEl.rows = 4;
						area.inputEl.addClass('detailsearch-linker-textarea');
					});
			},
		};
	}

	private cacheInfoRow(): SettingDefinitionRender {
		return {
			name: this.L('settingsCacheInfo'),
			desc: this.L('settingsCacheInfoDesc'),
			render: (setting) => {
				setting
					.setName(this.L('settingsCacheInfo'))
					.setDesc(
						this.plugin.formatCacheSizeDescription(),
					)
					.addButton((btn) =>
						btn.setButtonText(this.L('cmdClearCache')).onClick(() => {
							void this.plugin.clearCache(true);
							this.update();
						}),
					);
			},
		};
	}

	private toggleRow(nameKey: I18nKey, field: keyof DetailSearchLinkerSettings): SettingDefinitionRender {
		const descKey = `${nameKey}Desc` as I18nKey;
		return {
			name: this.L(nameKey),
			desc: this.L(descKey),
			render: (setting) => {
				setting
					.setName(this.L(nameKey))
					.setDesc(this.L(descKey))
					.addToggle((toggle) =>
						toggle
							.setValue(this.plugin.settings[field] as boolean)
							.onChange(async (value) => {
								(this.plugin.settings[field] as boolean) = value;
								await this.plugin.saveSettings();
								if (field === 'showBadge') {
									this.plugin.refreshHighlightAppearance();
								}
								if (field === 'caseSensitive') {
									this.plugin.onScopeOrCacheSettingsChanged();
								}
							}),
					);
			},
		};
	}

	private sliderRow(
		nameKey: I18nKey,
		descKey: I18nKey,
		field: keyof DetailSearchLinkerSettings,
		min: number,
		max: number,
		step: number,
		display?: (v: number) => string,
	): SettingDefinitionRender {
		return {
			name: this.L(nameKey),
			desc: this.L(descKey),
			render: (setting) => {
				setting
					.setName(this.L(nameKey))
					.setDesc(this.L(descKey))
					.addSlider((slider) =>
						slider
							.setLimits(min, max, step)
							.setValue(this.plugin.settings[field] as number)
							.onChange(async (value) => {
								(this.plugin.settings[field] as number) = value;
								const counterpartChanged = repairOrderedPairAfterChange(
									this.plugin.settings,
									field,
								);
								await this.plugin.saveSettings();
								if (counterpartChanged) {
									this.update();
								}
							}),
					);
				if (display) {
					setting.descEl.setText(`${this.L(descKey)} (${display(this.plugin.settings[field] as number)})`);
				}
			},
		};
	}

	private boundedSliderRow(
		nameKey: I18nKey,
		descKey: I18nKey,
		field: IntegerSettingKey,
		display?: (v: number) => string,
	): SettingDefinitionRender {
		const { min, max, step } = INTEGER_SETTING_BOUNDS[field];
		return this.sliderRow(nameKey, descKey, field, min, max, step, display);
	}

	private isOrderedPairSettingKey(key: string): key is OrderedPairSettingKey {
		return key === 'autoMinTermLength'
			|| key === 'autoMaxTermLength'
			|| key === 'ngramMinLength'
			|| key === 'ngramMaxLength';
	}
}
