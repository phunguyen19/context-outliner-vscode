# ctxdev

Shows a project's `.ctxdev/root.json` as a tree in the VS Code side bar. Click an item to open its file with the lines highlighted.

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
- **Install:** `npx @vscode/vsce package`, then in VS Code run "Extensions: Install from VSIX..." and pick `ctxdev-0.1.0.vsix`.
