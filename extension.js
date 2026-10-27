// ctxdev: shows .ctxdev/root.json as a tree in the side bar.
// Clicking an item opens its file and highlights its lines.
const vscode = require('vscode');
const path = require('path');

const MAP_PATH = path.join('.ctxdev', 'root.json');

// Parse "12-30" or "12" into zero-based start/end lines.
function parseLines(lines) {
  if (lines === undefined || lines === null || lines === '') return undefined;
  const [a, b] = String(lines).split('-').map((s) => parseInt(s.trim(), 10));
  if (Number.isNaN(a)) return undefined;
  const end = Number.isNaN(b) || b === undefined ? a : b;
  return { start: Math.max(a - 1, 0), end: Math.max(end - 1, 0) };
}

class MapItem extends vscode.TreeItem {
  constructor(node, folder) {
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    super(
      node.title || node.name || '(untitled)',
      hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
    );
    this.node = node;
    this.folder = folder;

    const where = node.file
      ? `${path.basename(node.file)}${node.lines ? ':' + node.lines : ''}`
      : '';
    this.description = where;

    const tip = new vscode.MarkdownString();
    tip.appendText(this.label);
    if (node.note) tip.appendMarkdown('\n\n').appendText(node.note);
    if (node.summary) tip.appendMarkdown('\n\n').appendText(node.summary);
    if (node.file) tip.appendMarkdown('\n\n').appendMarkdown('`' + node.file + (node.lines ? ':' + node.lines : '') + '`');
    this.tooltip = tip;

    if (node.file) {
      this.resourceUri = vscode.Uri.joinPath(folder.uri, node.file);
      this.iconPath = node.lines ? new vscode.ThemeIcon('symbol-method') : vscode.ThemeIcon.File;
      this.command = {
        command: 'ctxdev.open',
        title: 'Open Code',
        arguments: [this.resourceUri, node.lines],
      };
    } else {
      this.iconPath = new vscode.ThemeIcon(hasChildren ? 'list-tree' : 'circle-small');
    }
  }
}

class MapProvider {
  constructor() {
    this._onDidChange = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChange.event;
    this.roots = []; // [{ folder, data }]
    this.errors = [];
  }

  async load() {
    this.roots = [];
    this.errors = [];
    for (const folder of vscode.workspace.workspaceFolders || []) {
      const uri = vscode.Uri.joinPath(folder.uri, MAP_PATH);
      let text;
      try {
        text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
      } catch {
        continue; // no map in this folder
      }
      if (!text.trim()) continue;
      try {
        this.roots.push({ folder, data: JSON.parse(text) });
      } catch (err) {
        this.errors.push(`${folder.name}: ${err.message}`);
      }
    }
    if (this.errors.length) {
      vscode.window.showWarningMessage(`ctxdev: could not read root.json (${this.errors.join('; ')})`);
    }
    this._onDidChange.fire();
  }

  getTreeItem(item) {
    return item;
  }

  getChildren(item) {
    if (item) {
      return (item.node.children || []).map((c) => new MapItem(c, item.folder));
    }
    // One map: show its sections directly. Several folders: one top item per folder.
    if (this.roots.length === 1) {
      const { folder, data } = this.roots[0];
      return (data.children || []).map((c) => new MapItem(c, folder));
    }
    return this.roots.map(({ folder, data }) => {
      const top = new MapItem({ ...data, title: data.name || folder.name }, folder);
      top.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
      return top;
    });
  }
}

const highlight = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: new vscode.ThemeColor('editor.rangeHighlightBackground'),
});

async function openCode(uri, lines) {
  let doc;
  try {
    doc = await vscode.workspace.openTextDocument(uri);
  } catch {
    vscode.window.showErrorMessage(`ctxdev: file not found: ${uri.fsPath}`);
    return;
  }
  const r = parseLines(lines);
  const last = doc.lineCount - 1;
  const options = { preview: true };
  let range;
  if (r) {
    const start = Math.min(r.start, last);
    const end = Math.min(r.end, last);
    range = new vscode.Range(start, 0, end, doc.lineAt(end).text.length);
    options.selection = new vscode.Range(start, 0, start, 0);
  }
  const editor = await vscode.window.showTextDocument(doc, options);
  if (range) {
    editor.revealRange(range, vscode.TextEditorRevealType.AtTop);
    editor.setDecorations(highlight, [range]);
  } else {
    editor.setDecorations(highlight, []);
  }
}

async function activate(context) {
  const provider = new MapProvider();
  const view = vscode.window.createTreeView('ctxdev.tree', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  context.subscriptions.push(
    view,
    highlight,
    vscode.commands.registerCommand('ctxdev.refresh', () => provider.load()),
    vscode.commands.registerCommand('ctxdev.open', openCode),
    vscode.commands.registerCommand('ctxdev.openMapFile', async () => {
      const first = provider.roots[0] || (vscode.workspace.workspaceFolders || []).map((folder) => ({ folder }))[0];
      if (!first) return;
      await vscode.window.showTextDocument(vscode.Uri.joinPath(first.folder.uri, MAP_PATH));
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.load())
  );

  // Reload automatically when root.json is edited, created or deleted.
  const watcher = vscode.workspace.createFileSystemWatcher('**/.ctxdev/root.json');
  watcher.onDidChange(() => provider.load());
  watcher.onDidCreate(() => provider.load());
  watcher.onDidDelete(() => provider.load());
  context.subscriptions.push(watcher);

  await provider.load();
}

function deactivate() {}

module.exports = { activate, deactivate };
