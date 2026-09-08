# DetailSearch Linker

[日本語 README](README.ja.md)

DetailSearch Linker finds a phrase in **other note bodies**, highlights that phrase in the **note you are editing**, and lets you insert a heading link after you preview the destination.

Search starts only when you run a command or click the ribbon. The plugin does not index the vault at startup and does not send note contents anywhere.

Inserted links follow Obsidian's **Use Wikilinks** setting (wikilink or Markdown link).

## How this differs from Spot Linker

[Spot Linker](https://github.com/zoupuyo-obsidian/obsidian-spot-linker) and DetailSearch Linker can sit side by side. They answer different questions.

| | Spot Linker | DetailSearch Linker |
|--|-------------|---------------------|
| What is searched | The **open note** | **Other notes' bodies** |
| Where terms come from | File names, titles, aliases, optional title fragments | A **selection** in the open note, or terms **extracted from** the open note |
| What a match means | “This wording looks like another note’s name.” | “This wording also appears in another note’s body.” |
| Typical link | `[[Note name]]` to that note | A heading link toward the paragraph that matched |
| Ignore list | Hides that wording in the open note | Skips that wording in **auto-extract** only |

Use Spot Linker when a concept already has its own note (`認知負荷.md`) and you want the same words in a sentence to become a link to that note.

Use DetailSearch Linker when the destination is a passage inside another note, not the note’s title. A research log, a quote, or a meeting note can mention `認知負荷` without being named that.

The ignore lists are separate. Adding a term in one plugin does not change the other.

## What a successful run looks like

1. You run a search from the current note.
2. Phrases that appear in other note bodies are highlighted **here**.
3. You open the preview on one highlight, pick a destination, and create a link.
4. The highlighted phrase is replaced with a heading link. The rest of the sentence stays as it was.

A highlight appears only when at least one other note body matched. A term with zero hits is not decorated.

## Install

Requires Obsidian **1.13.0** or newer (desktop and mobile).

### Community plugins

After DetailSearch Linker is accepted into the Obsidian community directory:

1. Open **Settings -> Community plugins**.
2. Turn off **Restricted mode** if needed.
3. Browse community plugins, search for **DetailSearch Linker**, and install it.
4. Enable the plugin.

### GitHub release

1. Download the latest `main.js`, `manifest.json`, and `styles.css` from [GitHub Releases](https://github.com/zoupuyo-obsidian/obsidian-detailsearch-linker/releases).
2. Create `.obsidian/plugins/detailsearch-linker/` in your vault.
3. Copy the three files into that folder.
4. Enable **DetailSearch Linker** under **Settings -> Community plugins**.

## Basic operations

The command you will use most is **DetailSearch Linker: Find body link candidates in current note**. The ribbon search icon runs the same family of actions, with one extra rule for clearing highlights.

### Search a selection

1. Open a note and select the phrase you want to link, such as `cognitive load`.
2. Run **Find body link candidates in current note**, or click the ribbon while the selection is still active.
3. The plugin searches **other note bodies** for that phrase. It does not extract other terms from the note.
4. Every occurrence of the phrase in the current note is highlighted (except inside links, code, math, or frontmatter).
5. Hover the highlight on desktop, or tap it on mobile. The preview lists destination notes, the nearest heading, and a short excerpt.
6. Click **Create link** on the destination you want. The selected occurrence becomes a heading link.

Selection search always runs, even if the phrase is on the ignore list. Use this when you already know the wording and only want body matches for that wording.

The selection must appear in the current note outside a protected span. A selection that sits inside an existing link or a code block is rejected before any other note is read.

### Search without a selection (auto-extract)

1. Open a note and click so there is **no** selected text.
2. Run **Find body link candidates in current note**, or click the ribbon when nothing is highlighted yet.
3. The plugin extracts candidate phrases from the current note (headings, bold, highlights, and, depending on settings, ordinary sentences).
4. Each extracted phrase is searched in other note bodies.
5. Only phrases that hit at least one other note are highlighted. Each highlight belongs to **that phrase only**.
6. Open the preview on a highlight. You see destinations for that phrase, not a mix of every extracted term.
7. Click **Create link** to replace that occurrence.

Auto-extract does not open an input box. If you need to type a phrase that is not in the note, use the legacy selection command described below.

### Ribbon versus command palette

| Situation | Ribbon search icon | **Find body link candidates in current note** |
|-----------|--------------------|-----------------------------------------------|
| Text is selected | Search that selection | Search that selection |
| Nothing selected, highlights are already on | **Clear** the highlights | Run auto-extract again |
| Nothing selected, no highlights | Auto-extract | Auto-extract |

The ribbon is the faster “search or clear” control. **Find body link candidates in current note** is the faster “search again” control when highlights are already visible.

Clear highlights at any time with **DetailSearch Linker: Clear highlights**, the status bar label, or a ribbon click when nothing is selected.

### After the preview opens

- **Create link** inserts a heading link at the highlight. If the destination has no heading before the hit, the link points at the note itself.
- **Open note** opens the destination so you can read it. Returning to the source note keeps the highlights.
- **Ignore this term** is described in the next section.
- **Clear highlights** ends the current result set.

On desktop, the preview takes keyboard focus when it appears. Tab and arrow keys move inside it. Move the mouse off the highlight, or press Escape, to type in the note again. After you click the preview, it stays open until Escape or a click in the note.

### Keyboard commands

`Tab` and `Enter` still type in the editor while you are editing. To move between highlights without the mouse, assign hotkeys to:

- **Go to next highlight**
- **Go to previous highlight**
- **Open link candidates at cursor**

These work even when the candidate-count badge is hidden. They have no default hotkeys.

### Legacy commands

**Search selection in other note bodies** is the older selection command. If nothing is selected, it opens a modal. The typed phrase must already exist in the current note.

**Find body link candidates from current note** always auto-extracts and never looks at the selection.

Keep them for diagnostics. Day-to-day use is **Find body link candidates in current note** plus the ribbon.

### Mobile

Add **Find body link candidates in current note** to Obsidian’s **Mobile toolbar**. The ribbon icon, when available, follows the table above. Tap a highlight to open the preview.

## Ignore list and stop words

Two lists can hide wording. They are not interchangeable.

**Ignored terms** are phrases you removed on purpose. They apply to **auto-extract only**. The next auto-extract will not search them. Selecting the same phrase and running a search still works.

**Stop words** are common function words used while extracting (`the`, `and`, `の`, `は`). They reduce noise in automatic candidates. They do not block an explicit selection search.

From the preview, **Ignore this term** trims the phrase, adds it to **Ignored terms** in settings, and removes that phrase’s highlights from the current note. Other highlights stay.

Removing a term from settings does not rescan the current note. The next auto-extract can pick it up again.

## Settings and what they change

Settings fall into three groups: **which other notes are read**, **which phrases are taken from the current note**, and **how results look**.

Folder and scope settings never change what is extracted from the current note. They only change which other notes can become destinations.

### Which notes are searched

| Setting | If you change it |
|---------|------------------|
| **Include folders** | One folder per line. Empty means the whole vault minus excluded folders. Notes **outside** these folders are never destinations. |
| **Exclude folders** | Notes here are never read. Use this for templates, attachments, or raw exports. |
| **Search scope** | **All included notes**, **recently modified**, **recently opened (workset)**, or **recent + workset**. A smaller scope finishes faster and misses older notes. |
| **Recent days** | Used by the recent scopes. `0` means no date limit inside that scope. |
| **Workset size** | How many recently opened notes to remember. `0` means no cap. |
| **Max files** | Hard stop on how many notes are read in one run. Extra notes are skipped, not queued. |
| **Max file size** | Notes larger than this are skipped. Default is 512 KB. |

### Which phrases are extracted (auto-extract only)

| Setting | If you change it |
|---------|------------------|
| **Prefer headings and emphasis** | On (default): take phrases from ATX headings, bold, and `==highlights==`. Off: those sources are skipped. |
| **Extract phrases from ordinary prose** | On (default): also take longer words and phrases from sentences. Off: only headings and emphasis (when enabled). |
| **Broad n-gram extraction** | Off (default). On: cut overlapping short runs from continuous Japanese or similar text. More candidates, more weak matches. |
| **Minimum / maximum term length** | Discard extracted phrases outside this range. Raising the minimum removes short particles and two-character noise. |
| **N-gram min / max / span** | Used only when broad n-gram is on. Wider spans produce more fragments. |
| **Max auto candidates** | How many extracted phrases are actually searched. Default is 40. Extra phrases are dropped after priority ranking. Absolute ceiling is 200. |
| **Stop words** | Removed during extraction. |
| **Ignored terms** | Removed during extraction. Selection search still runs. |
| **Case sensitive** | Off (default): English matches ignore case. Japanese is largely unaffected. |

Priority when too many phrases are extracted: emphasis and highlights first, then headings, then prose, then n-grams.

### How results look and how far they go

| Setting | If you change it |
|---------|------------------|
| **Highlight style** | Invert, marker, text color, or underline in the current note. |
| **Candidate-count badge** | Shows how many destination notes that phrase has. Hide it if you prefer keyboard commands only. |
| **Clear highlights when switching notes** | On (default): leaving the note clears decorations. Off: they remain on that note only. Opening a destination with **Open note** still keeps the source highlights. |
| **Excerpt length** | How much destination text the preview shows. It is not stored in the on-disk cache. |
| **Max matches per note** | Caps hits inside one destination. You still get the note; later hits in that file are omitted. |
| **Max candidate notes** | Caps how many destination notes a phrase may collect. |
| **Cache** | **Persistent** (default) remembers queries, paths, headings, offsets, and mtimes in `data.json` so a repeat search can skip unchanged files. **Memory only** forgets the cache when Obsidian closes. Excerpts and full note bodies are not written to disk. |
| **Cache limit (MB)** | Oldest cached queries are dropped first when the limit is hit. |
| **UI language** | Plugin labels only. |

## Example setups

### Japanese concept notes, conservative

Use this when the current note is prose and you want links into other essays, not into daily logs.

- Include only the folders that hold finished notes.
- Exclude daily notes, templates, and clip dumps.
- Keep **Prefer headings and emphasis** and **Extract phrases from ordinary prose** on.
- Leave **Broad n-gram extraction** off.
- Keep **Minimum term length** at 3.
- Leave **Ignored terms** empty until a repeated false hit appears.

Run **Find body link candidates in current note** with no selection. Open a highlight, read the excerpt, then create the link. If `の` or a two-character fragment appears, raise the minimum length or add that fragment to **Ignored terms**.

### Selection-first drafting

Use this when you already know the phrase and do not want the plugin to guess.

- You can leave auto-extract settings at the defaults.
- Select the phrase, then run **Find body link candidates in current note** or click the ribbon.
- Keep **Case sensitive** off unless `API` and `api` must stay distinct.

Auto-extract is then a fallback for notes you have not annotated yet. The ignore list will not block these explicit searches.

### Recent research and meeting notes

Use this when the useful destinations are notes you touched this month.

- Set **Search scope** to **recently modified** or **recent + workset**.
- Set **Recent days** to 30 (default) or 14 if the vault is busy.
- Include the research or project folder.
- Raise **Max candidate notes** only if a common term is truncated too early.

A full-vault **All included notes** scope will also find older essays. It takes longer on the first run for each term.

### Large or mixed vault

An empty **Include folders** list reads every note that is not excluded, up to **Max files** (default 500). Configure folders before the first wide auto-extract.

- Put only destination folders in **Include folders**.
- Put archives, OCR dumps, and generated files in **Exclude folders**.
- Keep **Max files** at 200–500 until you know the cost.
- Keep **Broad n-gram extraction** off.
- Use **Memory only** cache if you do not want query history in `data.json`.

If a run reports skipped files, either the size cap or the file cap was hit. Those notes were not searched.

### Noisy auto-extract

Use this after the first auto-extract highlights words you will never link.

1. Open the preview on a bad highlight and click **Ignore this term**.
2. Add generic English tokens to **Stop words** if they keep appearing as candidates.
3. Turn **Extract phrases from ordinary prose** off so only headings and emphasis remain.
4. Raise **Minimum term length** to 4 if short Japanese fragments remain.

The current highlights for an ignored term disappear immediately. Other phrases stay. The next auto-extract will not bring the ignored term back.

## Protected text and rejected queries

The plugin does not search or extract inside existing Markdown links, wikilinks, code, math, or frontmatter. A selection that overlaps those regions is rejected with a notice.

Search phrases cannot contain `|`, `[`, or `]`. Ordinary Japanese punctuation such as `、` is allowed.

Links are heading links only. The plugin does not write block IDs into the destination.

A run is not guaranteed to see every note. Folder filters, scope, file caps, and size caps can skip files. There is no unlimited extraction mode.

## Privacy

Reads and caches stay on the device. The default persistent cache writes search queries and matching paths, headings, offsets, and mtimes next to settings in the plugin `data.json`. Excerpts and full note bodies are not stored. Use **Memory only** or **Clear search cache** if you do not want those details on disk.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
npm install
npm test
npm run build
npm run lint
```

After replacing a development build (including a vault junction or symlink), **disable and re-enable the plugin** or reload Obsidian. The loaded `main.js` stays in memory until you do.

`npm run verify:release` checks version metadata and writes `SHA256SUMS` for `main.js`, `manifest.json`, and `styles.css`.

## License

[0-BSD](LICENSE)
