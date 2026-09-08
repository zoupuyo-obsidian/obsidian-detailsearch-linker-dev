# Contributing

Thank you for considering a contribution to DetailSearch Linker.

## Development setup

```bash
npm install
npm run check
```

The full check runs unit tests, lint, a production build, and release metadata verification.

Load the plugin in Obsidian by copying or symlinking the repository into your vault's `.obsidian/plugins/detailsearch-linker` folder, then enable it under **Settings -> Community plugins**.

## Pull requests

1. Fork the repository and create a feature branch.
2. Keep changes focused. Match the existing TypeScript style.
3. Add or update tests when behavior changes.
4. Run `npm run check` before opening a PR.
5. Describe what changed and why in the PR body.

CI runs the same check on Node 20/22 and Ubuntu/Windows, then uploads `main.js`, `manifest.json`, `styles.css`, and `SHA256SUMS`. Compare the checksum file with a local `npm run verify:release` after you rebuild.

## Manual Obsidian smoke test

After `npm run build`, **disable and re-enable the plugin** (Obsidian does not hot-reload `main.js`). Then:

1. Select a short term in a note and run **DetailSearch Linker: Find body link candidates in current note**. Only that term is highlighted in the current note.
2. Hover a highlight. The popover appears, takes keyboard focus, and Tab / arrow keys move inside it without a click. Moving the mouse off the highlight returns typing to the note.
3. Click **Open note**. The candidate opens in a new tab (or its existing tab). The opened note body is not invert-highlighted. The source tab keeps its highlights.
4. Return to the source tab. Highlights and the popover still work.
5. With the badge hidden, run **DetailSearch Linker: Go to next highlight**. The popover opens and accepts Tab / arrows. After Escape, `Tab` and `Enter` type in the editor again. **Open link candidates at cursor** also opens the popover.
6. Split the source note. Both panes show the same highlights.

## Reporting issues

Include your Obsidian version, DetailSearch Linker version, and steps to reproduce. Screenshots help when the problem is visual.

## Code of conduct

Be respectful in issues and pull requests. Maintainers may close contributions that are abusive or off-topic.
