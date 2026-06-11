# Bug report draft — post to https://forum.obsidian.md/c/bug-reports/

Title: Bases: "Failed to evaluate a filter: Cannot read properties of null (reading 'path')" when a file is deleted while a Bases view is in a background tab

## Steps to reproduce

1. Create a `.base` file with a folder filter, e.g.:
   ```yaml
   filters:
     and:
       - file.folder == "src"
   views:
     - type: list
       name: Test
   ```
2. Open this base in a tab so its query starts running.
3. In the same tab group, open a note that matches the filter (e.g. `src/B.md`) so the Bases tab goes to the background (hidden).
4. Edit the note (so it gets queued for re-evaluation), then delete it.
5. Switch back to the Bases tab.

## Expected result

The deleted note silently disappears from the Bases results.

## Actual result

A notice pops up: `Failed to evaluate a filter: Cannot read properties of null (reading 'path')`. The results themselves are correct; the error is cosmetic but appears every time.

## Environment

- Obsidian 1.12.7, macOS (Darwin 25.5.0)
- Reproduces in the Sandbox vault / with community plugins disabled

## Analysis (from reading app.js 1.12.7)

Two factors combine:

1. The `file.folder` property is implemented as `file.parent.path` with no null guard. After a file is deleted, its `TFile.parent` is `null`, so evaluating `file.folder` against it throws `Cannot read properties of null (reading 'path')`.

2. The Bases `runQuery` loop pauses mid-iteration while the view container is hidden (`isShown()` is false → it awaits `onNodeInserted`), holding the current file after it has already been pulled out of the queue. The vault-`delete` cleanup (`queue.remove(file)` + `removeResult(file)`) cannot reach a file that is already held by the paused iterator. When the tab is revealed again, the iterator resumes and evaluates the now-deleted file, hitting the null deref in (1).

Suggested fix: null-guard `file.folder` (`file.parent?.path ?? ""`), and/or skip files that are no longer in the vault when the runQuery loop resumes.
