// Context Outline: shows .context-outline/root.json as a tree in the side bar.
// Clicking an item opens its file and highlights its lines.
const vscode = require('vscode');
const path = require('path');

const MAP_PATH = path.join('.context-outline', 'root.json');

// Parse "12-30" or "12" into zero-based start/end lines.
function parseLines(lines) {
  if (lines === undefined || lines === null || lines === '') return undefined;
  const [a, b] = String(lines).split('-').map((s) => parseInt(s.trim(), 10));
  if (Number.isNaN(a)) return undefined;
  const end = Number.isNaN(b) || b === undefined ? a : b;
  return { start: Math.max(a - 1, 0), end: Math.max(end - 1, 0) };
}

class MapItem extends vscode.TreeItem {
  constructor(node, folder, parent, jsonPath = []) {
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    super(
      node.title || node.name || '(untitled)',
      hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
    );
    this.node = node;
    this.folder = folder;
    this.parent = parent;
    this.jsonPath = jsonPath; // where this node sits in root.json, e.g. ['children', 2, 'children', 0]
    this.contextValue = 'contextOutlineItem';

    const where = node.file
      ? `${path.basename(node.file)}${node.lines ? ':' + node.lines : ''}`
      : '';
    this.description = where;

    const tip = new vscode.MarkdownString();
    tip.appendText(this.label);
    if (node.note) tip.appendMarkdown('\n\n').appendText(node.note);
    if (node.summary) tip.appendMarkdown('\n\n').appendText(node.summary);
    if (node.basedOn) tip.appendMarkdown('\n\n').appendText(`Based on ${node.basedOn}`);
    if (node.file) tip.appendMarkdown('\n\n').appendMarkdown('`' + node.file + (node.lines ? ':' + node.lines : '') + '`');
    this.tooltip = tip;

    if (node.file) {
      this.resourceUri = vscode.Uri.joinPath(folder.uri, node.file);
      this.iconPath = node.lines ? new vscode.ThemeIcon('symbol-method') : vscode.ThemeIcon.File;
      this.command = {
        command: 'contextOutline.open',
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
      vscode.window.showWarningMessage(`Context Outline: could not read root.json (${this.errors.join('; ')})`);
    }
    this._onDidChange.fire();
  }

  getTreeItem(item) {
    return item;
  }

  getChildren(item) {
    if (item) {
      return (item.node.children || []).map((c, i) => new MapItem(c, item.folder, item, [...item.jsonPath, 'children', i]));
    }
    // One root node per map: its name, with summary and basedOn on hover.
    return this.roots.map(({ folder, data }) => {
      const top = new MapItem(data, folder, undefined, []);
      if (!data.name) top.label = folder.name;
      top.contextValue = 'contextOutlineRoot';
      top.description = data.basedOn || '';
      top.iconPath = new vscode.ThemeIcon('book');
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
    vscode.window.showErrorMessage(`Context Outline: file not found: ${uri.fsPath}`);
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

// ---- Find an item in root.json ----------------------------------------

// Find where the value at `keys` (e.g. ['children', 2, 'children', 0]) starts
// and ends in the JSON text, so the editor can jump to it.
function locate(text, keys) {
  let i = 0;
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  const str = () => {
    const s = i++;
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    i++;
    return JSON.parse(text.slice(s, i));
  };
  const skip = () => {
    ws();
    const c = text[i];
    if (c === '"') return str();
    if (c === '{' || c === '[') {
      const close = c === '{' ? '}' : ']';
      i++;
      ws();
      if (text[i] === close) { i++; return; }
      for (;;) {
        if (c === '{') { ws(); str(); ws(); i++; } // key and ':'
        skip();
        ws();
        if (text[i] === ',') { i++; continue; }
        i++;
        return;
      }
    }
    while (i < text.length && !/[\s,}\]]/.test(text[i])) i++;
  };
  ws();
  for (const k of keys) {
    const c = text[i++];
    if (typeof k === 'number') {
      if (c !== '[') return undefined;
      for (let n = 0; ; n++) {
        ws();
        if (text[i] === ']' || i >= text.length) return undefined;
        if (n === k) break;
        skip();
        ws();
        if (text[i] === ',') i++;
      }
    } else {
      if (c !== '{') return undefined;
      for (;;) {
        ws();
        if (text[i] === '}' || i >= text.length) return undefined;
        const key = str();
        ws();
        i++; // ':'
        ws();
        if (key === k) break;
        skip();
        ws();
        if (text[i] === ',') i++;
      }
    }
  }
  const start = i;
  skip();
  return { start, end: i };
}

const MAP_REF = MAP_PATH.split(path.sep).join('/');

function mapUri(item) {
  return vscode.Uri.joinPath(item.folder.uri, MAP_PATH);
}

function safeLocate(text, jsonPath) {
  try {
    return locate(text, jsonPath);
  } catch {
    return undefined;
  }
}

function selectFirst() {
  vscode.window.showInformationMessage('Context Outline: select an item first.');
}

// ---- Copy Context -------------------------------------------------------

// Each item's text exactly as written in root.json (same formatting, with
// all sub-steps), under a "context, indexed in .context-outline/root.json" header.
async function contextBlock(items) {
  const texts = new Map(); // folder uri -> root.json text
  const blocks = [];
  for (const item of items) {
    const key = item.folder.uri.toString();
    if (!texts.has(key)) {
      texts.set(key, Buffer.from(await vscode.workspace.fs.readFile(mapUri(item))).toString('utf8'));
    }
    const text = texts.get(key);
    const loc = safeLocate(text, item.jsonPath);
    // Fall back to re-serialising the node if root.json changed under us.
    blocks.push(loc ? text.slice(loc.start, loc.end) : JSON.stringify(item.node, null, 2));
  }
  return `context, indexed in ${MAP_REF}\n${blocks.join('\n\n')}`;
}

async function copyContext(clicked, selected) {
  // Right-click on one of several selected items copies them all.
  let items = selected && selected.length ? selected : clicked ? [clicked] : [];
  if (clicked && !items.includes(clicked)) items = [clicked];
  if (!items.length) return selectFirst();
  await vscode.env.clipboard.writeText((await contextBlock(items)) + '\n');
  vscode.window.setStatusBarMessage(`Context Outline: copied ${items.length} item${items.length > 1 ? 's' : ''}`, 3000);
}

// ---- Build prompt -------------------------------------------------------

// Copies one of the bundled prompts (media/*.md) for an AI tool:
// build-prompt.md creates .context-outline/root.json, reindex-prompt.md updates it.
async function copyPrompt(context, fileName) {
  const uri = vscode.Uri.joinPath(context.extensionUri, 'media', fileName);
  const prompt = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
  await vscode.env.clipboard.writeText(prompt);
  vscode.window.showInformationMessage('Context Outline: prompt copied. Paste it into Claude Code, Copilot or any AI tool opened on your project.');
}

async function activate(context) {
  const provider = new MapProvider();
  const view = vscode.window.createTreeView('contextOutline.tree', {
    treeDataProvider: provider,
    showCollapseAll: true,
    canSelectMany: true,
  });

  context.subscriptions.push(
    view,
    highlight,
    vscode.commands.registerCommand('contextOutline.refresh', () => provider.load()),
    vscode.commands.registerCommand('contextOutline.open', openCode),
    vscode.commands.registerCommand('contextOutline.copyBuildPrompt', () => copyPrompt(context, 'build-prompt.md')),
    vscode.commands.registerCommand('contextOutline.copyReindexPrompt', () => copyPrompt(context, 'reindex-prompt.md')),
    // From the right-click menu VS Code passes (clicked, selected); from the
    // keybinding it passes nothing, so fall back to the view's selection.
    vscode.commands.registerCommand('contextOutline.copyContext', (clicked, selected) =>
      copyContext(clicked, selected || (clicked ? undefined : view.selection))
    ),
    vscode.commands.registerCommand('contextOutline.openMapFile', async () => {
      const first = provider.roots[0] || (vscode.workspace.workspaceFolders || []).map((folder) => ({ folder }))[0];
      if (!first) return;
      await vscode.window.showTextDocument(vscode.Uri.joinPath(first.folder.uri, MAP_PATH));
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.load())
  );

  // Reload automatically when root.json is edited, created or deleted.
  const watcher = vscode.workspace.createFileSystemWatcher('**/.context-outline/root.json');
  watcher.onDidChange(() => provider.load());
  watcher.onDidCreate(() => provider.load());
  watcher.onDidDelete(() => provider.load());
  context.subscriptions.push(watcher);

  await provider.load();
}

function deactivate() {}

module.exports = { activate, deactivate };
