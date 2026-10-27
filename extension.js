// Context Outline: shows .context-outline/root.json as a tree in the side bar.
// Clicking an item opens its file and highlights its lines.
const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

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
  constructor(node, folder, parent) {
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    super(
      node.title || node.name || '(untitled)',
      hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
    );
    this.node = node;
    this.folder = folder;
    this.parent = parent;
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
      return (item.node.children || []).map((c) => new MapItem(c, item.folder, item));
    }
    // One root node per map: its name, with summary and basedOn on hover.
    return this.roots.map(({ folder, data }) => {
      const top = new MapItem(data, folder, undefined);
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

const MAP_REF = MAP_PATH.split(path.sep).join('/');

function selectFirst() {
  vscode.window.showInformationMessage('Context Outline: select an item first.');
}

// ---- Copy Context -------------------------------------------------------

// context mapping from @.context-outline/root.json
// item: "3. the title of the item"
function contextBlock(items) {
  const lines = items.map((item) => `item: "${item.label}"`);
  return `context mapping from @${MAP_REF}\n${lines.join('\n')}`;
}

async function copyContext(clicked, selected) {
  // Right-click on one of several selected items copies them all.
  let items = selected && selected.length ? selected : clicked ? [clicked] : [];
  if (clicked && !items.includes(clicked)) items = [clicked];
  if (!items.length) return selectFirst();
  await vscode.env.clipboard.writeText(contextBlock(items) + '\n');
  vscode.window.setStatusBarMessage(`Context Outline: copied ${items.length} item${items.length > 1 ? 's' : ''}`, 3000);
}

// ---- Build prompt -------------------------------------------------------

// Copies one of the bundled prompts (media/*.md) for an AI tool:
// build-prompt.md creates .context-outline/root.json, reindex-prompt.md updates it.
async function readPrompt(context, fileName) {
  const uri = vscode.Uri.joinPath(context.extensionUri, 'media', fileName);
  return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
}

async function copyPrompt(context, fileName) {
  await vscode.env.clipboard.writeText(await readPrompt(context, fileName));
  vscode.window.showInformationMessage('Context Outline: prompt copied. Paste it into Claude Code, Copilot or any AI tool opened on your project.');
}

// ---- AI CLIs in a terminal (Claude Code, Copilot) -----------------------

const TOOLS = {
  claude: {
    label: 'Claude Code',
    setting: 'claudeCodeTerminal',
    defaultOn: true,
    bin: 'claude',
    extraDirs: (home) => [path.join(home, '.claude', 'local')],
    args: (prompt) => [prompt],
  },
  copilot: {
    label: 'Copilot',
    setting: 'copilotTerminal',
    defaultOn: true,
    bin: 'copilot',
    extraDirs: () => [],
    // -i starts the interactive session and runs the prompt right away.
    args: (prompt) => ['-i', prompt],
  },
};

function toolEnabled(tool) {
  return vscode.workspace.getConfiguration('contextOutline').get(tool.setting, tool.defaultOn);
}

// VS Code's PATH often misses where CLIs live (e.g. ~/.local/bin is only
// added by the shell's rc files), so find the full path ourselves.
const cliPaths = {};
function findCli(tool) {
  const cached = cliPaths[tool.bin];
  if (cached && fs.existsSync(cached)) return cached;
  const names = process.platform === 'win32' ? [`${tool.bin}.exe`, `${tool.bin}.cmd`] : [tool.bin];
  const home = os.homedir();
  const dirs = [
    ...(process.env.PATH || '').split(path.delimiter),
    path.join(home, '.local', 'bin'),
    ...tool.extraDirs(home),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  for (const dir of dirs) {
    for (const name of names) {
      const p = dir && path.join(dir, name);
      if (p && fs.existsSync(p)) return (cliPaths[tool.bin] = p);
    }
  }
  // Last try: ask the user's login shell, which loads their PATH setup.
  if (process.platform !== 'win32') {
    try {
      const shell = process.env.SHELL || '/bin/zsh';
      const out = execFileSync(shell, ['-lic', `command -v ${tool.bin}`], { encoding: 'utf8', timeout: 5000 });
      const p = out.trim().split('\n').pop();
      if (p && fs.existsSync(p)) return (cliPaths[tool.bin] = p);
    } catch {
      // not found
    }
  }
  return undefined;
}

// Runs the CLI as the terminal's own process, so the prompt is passed as one
// argument with no shell quoting to worry about.
function runTool(tool, folder, prompt) {
  const cli = findCli(tool);
  if (!cli) {
    vscode.window.showErrorMessage(
      `Context Outline: could not find the \`${tool.bin}\` CLI. Install ${tool.label}, then try again.`
    );
    return;
  }
  const term = vscode.window.createTerminal({
    name: tool.label,
    cwd: folder.uri,
    shellPath: cli,
    shellArgs: tool.args(prompt),
  });
  term.show();
}

async function buildWith(context, tool) {
  if (!toolEnabled(tool)) return;
  const folders = vscode.workspace.workspaceFolders || [];
  if (!folders.length) {
    vscode.window.showInformationMessage('Context Outline: open a folder first.');
    return;
  }
  const folder = folders.length > 1 ? await vscode.window.showWorkspaceFolderPick() : folders[0];
  if (!folder) return;
  runTool(tool, folder, await readPrompt(context, 'build-prompt.md'));
}

// Titles from the top of the map down to this item: "A" > "B" > "C".
function itemPath(item) {
  const titles = [];
  for (let it = item; it; it = it.parent) titles.unshift(`"${it.node.title || it.node.name || it.label}"`);
  return titles.join(' > ');
}

async function detailWith(context, tool, item) {
  if (!toolEnabled(tool)) return;
  if (!item) return selectFirst();
  const { file, lines } = item.node;
  const where = file ? `Its code: ${file}${lines ? ':' + lines : ''}` : '';
  const prompt = (await readPrompt(context, 'detail-prompt.md'))
    .replace('{{PATH}}', itemPath(item))
    .replace('{{WHERE}}', where);
  runTool(tool, item.folder, prompt);
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
    vscode.commands.registerCommand('contextOutline.buildWithClaude', () => buildWith(context, TOOLS.claude)),
    vscode.commands.registerCommand('contextOutline.detailWithClaude', (clicked) =>
      detailWith(context, TOOLS.claude, clicked || view.selection[0])
    ),
    vscode.commands.registerCommand('contextOutline.buildWithCopilot', () => buildWith(context, TOOLS.copilot)),
    vscode.commands.registerCommand('contextOutline.detailWithCopilot', (clicked) =>
      detailWith(context, TOOLS.copilot, clicked || view.selection[0])
    ),
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
