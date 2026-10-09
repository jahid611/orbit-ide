/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { spawn } from 'child_process';
import { AgentTracker } from './agentTracker';
import { ClaudeTerminals } from './claudeTerminals';
import { workspaceRoot } from './config';
import { renderWebview, webviewOptions } from './webview';
import { deliverToAgent } from './deliver';

const PACKAGE = 'com.orbit.bridge';

interface Bridge {
	port: number;
	token: string;
	pid: number;
	unity: string;
	project: string;
}

/** A Unity project has ProjectSettings/ProjectVersion.txt next to its Assets folder. */
export function unityProject(root = workspaceRoot()): string | undefined {
	return fs.existsSync(path.join(root, 'ProjectSettings', 'ProjectVersion.txt')) && fs.existsSync(path.join(root, 'Assets')) ? root : undefined;
}

let extensionPath = '';

/** Where the bridge package and the MCP server ship inside the extension. */
export function setUnityExtensionPath(value: string): void {
	extensionPath = value;
}

/**
 * Claude Code gets the `orbit-unity` tools in Unity projects: it can see the game, build the scene
 * and drive the editor. The server runs on Orbit's own runtime, so no separate Node install is needed.
 */
export function unityMcpConfig(root = workspaceRoot()): string | undefined {
	if (!unityProject(root) || !extensionPath) {
		return undefined;
	}
	const dir = path.join(os.homedir(), '.orbit', 'mcp');
	// Per project and per Orbit build: an installed Orbit and a dev build each point at their own script.
	const build = createHash('sha1').update(process.platform === 'win32' ? extensionPath.toLowerCase() : extensionPath).digest('hex').slice(0, 10);
	const file = path.join(dir, `unity-${createHash('sha1').update(root.toLowerCase()).digest('hex').slice(0, 12)}-${build}.json`);
	const config = JSON.stringify({
		mcpServers: {
			'orbit-unity': {
				type: 'stdio',
				command: process.execPath,
				args: [path.join(extensionPath, 'unity', 'unity-mcp.js')],
				env: { ELECTRON_RUN_AS_NODE: '1', ORBIT_UNITY_PROJECT: root },
			},
		},
	}, null, 2);
	try {
		fs.mkdirSync(dir, { recursive: true });
		if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== config) {
			fs.writeFileSync(file, config);
		}
		return file;
	} catch {
		return undefined;
	}
}

/**
 * Game studio: the Unity Editor seen and driven from Orbit. Live game and scene views, picking,
 * hierarchy, inspector, console, play controls, and Claude acting inside the editor.
 */
export class GameStudio implements vscode.Disposable {

	private panel: vscode.WebviewPanel | undefined;
	private timer: NodeJS.Timeout | undefined;
	private lastSent = '';
	private readonly disposables: vscode.Disposable[] = [];

	constructor(private readonly extensionUri: vscode.Uri, private readonly claude: ClaudeTerminals, private readonly tracker: AgentTracker) { }

	dispose(): void {
		clearInterval(this.timer);
		this.panel?.dispose();
		this.disposables.forEach(d => d.dispose());
	}

	async show(): Promise<void> {
		const root = unityProject();
		if (!root) {
			// No game open: NovaGame's tab offers the sandbox, the games, and the Unity setup.
			await vscode.commands.executeCommand('novagame.open');
			return;
		}
		if (this.panel) {
			this.panel.reveal();
			return;
		}
		this.panel = vscode.window.createWebviewPanel('orbit.unity', 'NovaGame', vscode.ViewColumn.Active, { ...webviewOptions(this.extensionUri), retainContextWhenHidden: true });
		this.panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'novagame.png');
		this.panel.webview.html = renderWebview(this.panel.webview, this.extensionUri, 'unity', { img: 'http://127.0.0.1:*', connect: 'http://127.0.0.1:*' });
		const listener = this.panel.webview.onDidReceiveMessage(msg => this.onMessage(msg, root).catch(err => {
			vscode.window.showErrorMessage(`Studio de jeu : ${err instanceof Error ? err.message : String(err)}`);
		}));
		this.panel.onDidDispose(() => {
			listener.dispose();
			this.panel = undefined;
			clearInterval(this.timer);
			this.lastSent = '';
		});
		this.timer = setInterval(() => this.sendBridge(root), 2000);
	}

	/** The bridge restarts on every script reload, sometimes on another port: keep the page pointed at it. */
	private sendBridge(root: string, force = false): void {
		const bridge = readBridge(root);
		const installed = fs.existsSync(path.join(root, 'Packages', PACKAGE, 'package.json'));
		const message = { type: 'bridge', installed, bridge: bridge && { base: `http://127.0.0.1:${bridge.port}`, token: bridge.token, unity: bridge.unity }, project: path.basename(root) };
		const text = JSON.stringify(message);
		if (force || text !== this.lastSent) {
			this.lastSent = text;
			this.panel?.webview.postMessage(message);
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private async onMessage(msg: any, root: string): Promise<void> {
		switch (msg.type) {
			case 'ready':
				this.sendBridge(root, true);
				break;
			case 'install':
				await installBridge(root);
				vscode.window.showInformationMessage('Pont Orbit ajouté au projet (Packages/com.orbit.bridge). Unity l\'importe dès que sa fenêtre reprend la main.');
				this.sendBridge(root, true);
				break;
			case 'openUnity':
				openInUnity(root);
				break;
			case 'openScript':
				await openScript(root, String(msg.file ?? ''), Number(msg.line) || 0, msg.className ? String(msg.className) : undefined);
				break;
			case 'ask':
				this.ask(String(msg.instruction ?? ''), msg.selection);
				break;
			case 'fix':
				this.fix(msg.log);
				break;
		}
	}

	/** Send a message to the current Claude, or start one with it as its first prompt. */
	private deliver(message: string): void {
		const terminal = deliverToAgent(this.claude, this.tracker, message);
		if (terminal) {
			this.panel?.webview.postMessage({ type: 'sent', terminal: terminal.name });
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private ask(instruction: string, selection: any): void {
		if (!instruction.trim()) {
			return;
		}
		const lines = ['Dans le projet Unity ouvert (Studio de jeu d\'Orbit) :'];
		if (selection) {
			lines.push(`- objet sélectionné : ${selection.path} (id ${selection.id})`);
			lines.push(`- composants : ${(selection.components ?? []).map((c: { type: string; script?: string }) => c.script ? `${c.type} (${c.script})` : c.type).join(', ')}`);
		}
		lines.push('', `Demande : ${instruction.trim()}`, '', 'Tu peux voir et modifier la scène avec les outils orbit-unity (unity_screenshot pour vérifier le résultat). Après avoir écrit un script C#, appelle unity_refresh puis vérifie unity_console.');
		this.deliver(lines.join('\n'));
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private fix(log: any): void {
		if (!log) {
			return;
		}
		const where = log.file ? `${log.file}${log.line ? `:${log.line}` : ''}` : 'inconnu';
		const message = [
			`Erreur dans le projet Unity${log.compile ? ' (compilation C#)' : ''} :`,
			String(log.message).slice(0, 1500),
			`- fichier : ${where}`,
			log.stack ? `- pile d'appels :\n${String(log.stack).split('\n').slice(0, 12).join('\n')}` : '',
			'',
			'Trouve la cause et corrige-la dans le code. Ensuite appelle unity_refresh et vérifie avec unity_console que l\'erreur a disparu.',
		].filter(Boolean).join('\n');
		this.deliver(message);
	}
}

function readBridge(root: string): Bridge | undefined {
	let bridge: Bridge;
	try {
		bridge = JSON.parse(fs.readFileSync(path.join(root, 'Library', 'OrbitBridge.json'), 'utf8')) as Bridge;
	} catch {
		return undefined;
	}
	try {
		process.kill(bridge.pid, 0); // throws when that Unity has quit
		return bridge;
	} catch (err) {
		// EPERM: the process exists, it just belongs to someone Orbit may not signal.
		return (err as NodeJS.ErrnoException).code === 'EPERM' ? bridge : undefined;
	}
}

async function installBridge(root: string): Promise<void> {
	const source = path.join(extensionPath, 'unity', PACKAGE);
	const target = path.join(root, 'Packages', PACKAGE);
	await fs.promises.cp(source, target, { recursive: true, force: true, filter: file => !file.endsWith('.meta') });
}

function openInUnity(root: string): void {
	const version = fs.readFileSync(path.join(root, 'ProjectSettings', 'ProjectVersion.txt'), 'utf8').match(/m_EditorVersion:\s*(\S+)/)?.[1];
	const candidates = process.platform === 'darwin'
		? [`/Applications/Unity/Hub/Editor/${version}/Unity.app/Contents/MacOS/Unity`]
		: process.platform === 'win32'
			? [`C:\\Program Files\\Unity\\Hub\\Editor\\${version}\\Editor\\Unity.exe`, path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Unity', 'Hub', 'Editor', version ?? '', 'Editor', 'Unity.exe')]
			: [path.join(os.homedir(), 'Unity', 'Hub', 'Editor', version ?? '', 'Editor', 'Unity')];
	const editor = candidates.find(c => fs.existsSync(c));
	if (!editor) {
		vscode.window.showWarningMessage(`Unity ${version ?? ''} introuvable : installe cette version avec Unity Hub, ou ouvre le projet depuis Unity Hub.`);
		return;
	}
	spawn(editor, ['-projectPath', root], { detached: true, stdio: 'ignore' }).unref();
	vscode.window.showInformationMessage(`Ouverture de Unity ${version}… Le Studio se connecte tout seul dès que l'éditeur est prêt.`);
}

async function openScript(root: string, file: string, line: number, className?: string): Promise<void> {
	const full = path.isAbsolute(file) ? file : path.join(root, file);
	if (!fs.existsSync(full)) {
		vscode.window.showWarningMessage(`Fichier introuvable : ${file}`);
		return;
	}
	let target = Math.max(1, line);
	if (!line && className) {
		// No line given: land on the class declaration.
		const pattern = new RegExp(`\\bclass\\s+${className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
		const index = fs.readFileSync(full, 'utf8').split(/\r?\n/).findIndex(l => pattern.test(l));
		target = index >= 0 ? index + 1 : 1;
	}
	const editor = await vscode.window.showTextDocument(vscode.Uri.file(full), { viewColumn: vscode.ViewColumn.Beside, preview: false });
	const position = new vscode.Position(target - 1, 0);
	editor.selection = new vscode.Selection(position, position);
	editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}
