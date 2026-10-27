# Context Outline

Shows a project's `.context-outline/root.json` as a tree in the VS Code side bar. Click an item to open its file with the lines highlighted.

## Build the map with AI

You don't write `root.json` by hand. Let an AI tool (Claude Code, Copilot, Cursor...) read the project and write it:

1. Click the sparkle icon at the top of the Context Outline panel, or run **Context Outline: Copy Prompt to Build the Map** from the Command Palette. It's also on the panel when no map exists yet.
2. Paste the prompt into your AI tool, opened on the project.
3. The tree appears as soon as `.context-outline/root.json` is saved.

When the code changes later, reindex instead of building again (next section).

<details>
<summary>The prompt (same text as <code>media/build-prompt.md</code>)</summary>

````markdown
Build a plain-English map of this codebase for the Context Outline VS Code extension and save it as `.context-outline/root.json` at the repo root (create the folder).

Read the code before writing. Every file path and line range in the map must be real.

## Format

{
  "name": "<repo name>",
  "summary": "<2-3 sentences: what the project does, in plain English>",
  "basedOn": "<branch> @ <short commit hash>",
  "children": [ <node>, ... ]
}

Each node:

{
  "title": "<plain-English step>",
  "note": "<optional: extra detail shown on hover>",
  "file": "<optional: path from the repo root>",
  "lines": "<optional: 1-based, like \"12-40\" or \"12\">",
  "children": [ <optional child nodes> ]
}

Only `title` is required.

## How to organise it

- Top level: numbered sections that follow how the program runs, for example "1. When the service starts up", "2. Customer API", "3. Background jobs". Common sections: startup, entry points (API, CLI, UI), background work (queues, jobs, timers), core logic, what's stored, other services it calls, helper tools, key domain types.
- Inside a section, list steps in the order they happen. Nest when a step has its own sub-steps. Keep it to about 4 levels deep.
- Titles are short, plain English, and say what happens, not function names. Good: "Skip if the asset isn't in the filter". Bad: "filterAssets()".
- Put important rules and edge cases in the title, for example "Deleting something already gone counts as success".
- Point `lines` at the smallest range that shows the step. A parent can point at the whole function.
- A grouping node with no file is fine, for example "Database writes".
- Use 2-space indentation. Write leaf nodes on one line: { "title": "...", "file": "...", "lines": "..." }
- Don't invent anything. If you're not sure, leave it out.

## Before you finish

Check that the JSON is valid, every `file` exists, and every `lines` range is inside its file.
````

</details>

## Reindex the map with AI

When the code changes, the map's line ranges drift. To bring it up to date:

1. Click the compare icon at the top of the Context Outline panel, or run **Context Outline: Copy Prompt to Reindex the Map**.
2. Paste the prompt into your AI tool, opened on the project.

The AI uses git to see what changed since the commit in `basedOn`, then fixes line ranges and files, adds new steps, and removes old ones. It keeps your titles, order and hand edits, and replies with a short list of what changed.

<details>
<summary>The prompt (same text as <code>media/reindex-prompt.md</code>)</summary>

````markdown
Bring this project's Context Outline map, `.context-outline/root.json`, up to date with the current code. Update the existing map; don't rebuild it from scratch.

## Find what changed

1. Read `basedOn` in `.context-outline/root.json` (like "main @ 12ef58a").
2. Run `git diff <that commit>..HEAD --stat`, then read the diffs of the changed files. If the commit can't be found, check every node against the current code instead.

## Update the map

- Fix `lines` for every node whose code moved, so the range covers the same code as before.
- Fix `file` for code that moved to another file.
- Add nodes for new behaviour, in the section and position where it happens. Match the style of nearby nodes: short plain-English titles that say what happens, with important rules and edge cases in the title.
- Change a title only when the behaviour it describes changed.
- Remove nodes whose code is gone.
- Keep everything else as it is: section order, titles, notes, nesting, and formatting (2-space indentation, leaf nodes on one line). Someone may have edited the map by hand.
- Set `basedOn` to "<current branch> @ <current short commit hash>".
- Don't invent anything. If you're not sure, leave it out.

## Before you finish

- Check that the JSON is valid, every `file` exists, and every `lines` range is inside its file and still points at the code its title describes.
- Reply with a short list of what you added, removed, renamed, and moved.
````

</details>

## root.json format

```json
{
  "name": "my-service",
  "summary": "One line about the project",
  "children": [
    {
      "title": "Plain-English step",
      "note": "optional detail (shown on hover)",
      "file": "path/from/repo/root.go",
      "lines": "12-40",
      "children": []
    }
  ]
}
```

- `file` and `lines` are optional. `lines` can be `"12"` or `"12-40"`.
- The tree reloads when `root.json` changes.

## Use

- **Try it:** open this folder in VS Code and press F5. A new window opens on webhook-notification-service.
- **Install:** `npx @vscode/vsce package`, then in VS Code run "Extensions: Install from VSIX..." and pick `context-outline-0.3.0.vsix`.

## The tree

The top node is the map itself: its `name`, with `basedOn` beside it and `summary` on hover. Every section lives under it.

## Copy Context (for Claude Code, Copilot, any AI chat)

Right-click an item and choose **Copy Context**. You can also use the copy icon on the item, or select it and press Cmd+C / Ctrl+C. The clipboard gets `context, indexed in .context-outline/root.json` on the first line, then the item's text exactly as written in `root.json`, including all its sub-steps.

Hold Cmd/Ctrl or Shift to select several items and copy them together (one after another, with a blank line between).
