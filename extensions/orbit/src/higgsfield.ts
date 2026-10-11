/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { AgentTracker } from './agentTracker';
import { ClaudeTerminals } from './claudeTerminals';
import { assistantId } from './assistant';
import { runCodex } from './headless';
import { deliverToAgent } from './deliver';
import { claudeEnv, resolveClaudeExecutable, workspaceRoot } from './config';
import { signInTerminal } from './signIn';
import { renderWebview } from './webview';

const MEDIA = /\.(png|jpe?g|webp|gif|mp4|webm|mov|mp3|wav|m4a|ogg|glb|gltf|fbx|obj)$/i;
const MANIFEST = 'higgsfield.json';
const PENDING_TIMEOUT_MS = 20 * 60 * 1000;
const BALANCE_EVERY_MS = 60 * 1000;
/** The balance tool under both ways of having Higgsfield: the claude.ai connector, or the server added by hand. */
const SERVER_URL = 'https://mcp.higgsfield.ai/mcp';
const BALANCE_TOOLS = ['mcp__claude_ai_Higgsfield__balance', 'mcp__higgsfield__balance'];

type Kind = 'image' | 'video' | '3d' | 'audio';

interface Request {
	kind: Kind;
	prompt: string;
	format: string;
	count: number;
	style?: string;
	reference?: string;
}

interface ManifestEntry {
	file: string;
	prompt?: string;
	type?: string;
	model?: string;
	date?: string;
}

interface Pending {
	id: number;
	kind: Kind;
	prompt: string;
	count: number;
	at: number;
}

const KIND_LABELS: Record<Kind, string> = { image: 'image', video: 'vidéo', '3d': 'modèle 3D', audio: 'audio (voix, musique ou bruitage)' };
const KIND_TOOLS: Record<Kind, string> = { image: 'generate_image', video: 'generate_video', '3d': 'generate_3d', audio: 'generate_audio' };

/**
 * Higgsfield studio: the user's Higgsfield account, reached through the connector Claude Code
 * already has, driven from a page of the IDE. The page writes the request, Claude generates and
 * downloads into the project, and the gallery follows the folder: what is generated is at once a
 * file of the project, ready to drop in the code, in a montage or in a game.
 */
export class HiggsfieldStudio implements vscode.Disposable {

	private panel: vscode.WebviewPanel | undefined;
	private watcher: vscode.FileSystemWatcher | undefined;
	private connected: boolean | undefined;
	/** Higgsfield is known to Claude Code but the account is not linked yet. */
	private added = false;
	/** Higgsfield comes with the user's claude.ai account: only claude.ai can take it away. */
	private viaAccount = false;
	/** Names under which the assistant knows Higgsfield (its own connector, a server added by hand). */
	private names: string[] = [];
	/** A connection step running in the background, as the page words it. */
	private working: string | undefined;
	private credits: { value: number; plan?: string } | undefined;
	private creditsAt = 0;
	private creditsLoading = false;
	private pending: Pending[] = [];
	private known = new Set<string>();
	private nextId = 1;
	private reference: string | undefined;
	private preview: { file: string; data: string } | undefined;
	private refreshTimer: NodeJS.Timeout | undefined;
	private watchTimer: NodeJS.Timeout | undefined;
	private idleTimer: NodeJS.Timeout | undefined;
	private checkingNow = false;

	constructor(private readonly extensionUri: vscode.Uri, private readonly claude: ClaudeTerminals, private readonly tracker: AgentTracker) { }

	dispose(): void {
		clearTimeout(this.refreshTimer);
		clearInterval(this.watchTimer);
		clearInterval(this.idleTimer);
		this.watcher?.dispose();
		this.panel?.dispose();
	}

	/** Where generated files land, relative to the project. */
	private folder(): string {
		return (vscode.workspace.getConfiguration('orbit').get<string>('higgsfield.folder')?.trim() || 'assets/higgsfield').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
	}

	private dir(): string {
		return path.join(workspaceRoot(), this.folder());
	}

	/**
	 * The reference image as the page shows it. It may come from anywhere on the disk, where the
	 * page is not allowed to read: it is handed over as data instead of an address.
	 */
	private referencePreview(file: string): string {
		if (this.preview?.file !== file) {
			let data = '';
			try {
				const types: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.bmp': 'image/bmp', '.svg': 'image/svg+xml' };
				const type = types[path.extname(file).toLowerCase()];
				if (type && fs.statSync(file).size < 25 * 1024 * 1024) {
					data = `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;
				}
			} catch {
				// unreadable: the page shows the image's name only
			}
			this.preview = { file, data };
		}
		return this.preview.data;
	}

	/** Opens the studio; `reference` starts from an image of the project (animate it, vary it). */
	show(reference?: vscode.Uri, kind?: Kind): void {
		this.reference = reference?.fsPath;
		if (this.panel) {
			this.panel.reveal();
			this.send(kind);
			return;
		}
		const roots = [vscode.Uri.joinPath(this.extensionUri, 'media'), ...(vscode.workspace.workspaceFolders ?? []).map(f => f.uri)];
		this.panel = vscode.window.createWebviewPanel('orbit.higgsfield', 'Higgsfield', vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: roots, retainContextWhenHidden: true });
		this.panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'higgsfield.png');
		this.panel.webview.html = renderWebview(this.panel.webview, this.extensionUri, 'higgsfield', { img: 'blob:' });
		const listener = this.panel.webview.onDidReceiveMessage(msg => this.onMessage(msg).catch(err => {
			vscode.window.showErrorMessage(`Higgsfield : ${err instanceof Error ? err.message : String(err)}`);
		}));
		this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(workspaceRoot()), `${this.folder()}/**`));
		const changed = () => {
			clearTimeout(this.refreshTimer);
			this.refreshTimer = setTimeout(() => this.send(), 400);
		};
		this.watcher.onDidCreate(changed);
		this.watcher.onDidChange(changed);
		this.watcher.onDidDelete(changed);
		this.panel.onDidChangeViewState(e => {
			if (e.webviewPanel.visible && this.connected === false) {
				this.checkConnection();
			}
		});
		// Not connected: look again every few seconds, so the page moves on as soon as the user has
		// added or signed in to Higgsfield, wherever they did it.
		clearInterval(this.idleTimer);
		this.idleTimer = setInterval(() => {
			if (this.panel?.visible && this.connected === false && !this.checkingNow) {
				this.checkConnection();
			}
		}, 5000);
		this.panel.onDidDispose(() => {
			clearInterval(this.watchTimer);
			listener.dispose();
			this.watcher?.dispose();
			this.watcher = undefined;
			this.panel = undefined;
		});
		this.checkConnection();
	}

	/** One command of the assistant's own tool, run out of sight. */
	private cli(args: string[], timeout: number): Promise<{ ok: boolean; out: string }> {
		const program = resolveClaudeExecutable();
		const shell = process.platform === 'win32' && !/\.exe$/i.test(program);
		return new Promise(resolve => execFile(program, shell ? args.map(a => /\s/.test(a) ? `"${a}"` : a) : args, { timeout, windowsHide: true, env: claudeEnv(), shell, cwd: os.homedir() }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout ?? ''}\n${stderr ?? ''}` })));
	}

	/** A connection step run in the background: the page says what is going on, no terminal opens. */
	private async quiet(text: string, args: string[], timeout = 60000): Promise<boolean> {
		if (this.working) {
			return false;
		}
		this.working = text;
		this.send();
		const result = await this.cli(args, timeout);
		this.working = undefined;
		this.send();
		if (!result.ok && !/already exists/i.test(result.out)) {
			const last = result.out.split(/\r?\n/).map(l => l.trim()).filter(Boolean).pop();
			vscode.window.showErrorMessage(`Higgsfield : ${last ?? 'la commande a échoué.'}`);
			return false;
		}
		return true;
	}

	/** The assistant's tool opens Higgsfield's sign-in page in the browser and waits for the user there. */
	private async signIn(): Promise<void> {
		// The assistant's tool only signs in from a terminal; the page watches for the result.
		this.watchConnection();
		signInTerminal('higgsfield', 'Higgsfield');
	}

	/** Claude Code lists its connectors: Higgsfield is there once the user has linked the account. */
	private checkConnection(done?: () => void): void {
		if (this.checkingNow) {
			return;
		}
		this.checkingNow = true;
		setTimeout(() => { this.checkingNow = false; }, 46000);
		execFile(resolveClaudeExecutable(), ['mcp', 'list'], { timeout: 45000, windowsHide: true, env: claudeEnv(), shell: process.platform === 'win32' && !/\.exe$/i.test(resolveClaudeExecutable()) }, (err, stdout) => {
			let lines = String(stdout ?? '').split(/\r?\n/).filter(l => /higgsfield/i.test(l));
			if (this.simulated()) {
				// Pretend the account's own connector is not there: only a server added by hand counts.
				lines = lines.filter(l => !/claude\.ai/i.test(l));
			}
			this.checkingNow = false;
			if (err || !String(stdout ?? '').trim()) {
				// The listing itself failed (machine busy, no network for a moment): that says nothing
				// about the account. What was known stays; a first check is tried again shortly.
				if (this.connected === undefined) {
					setTimeout(() => this.panel && this.connected === undefined && this.checkConnection(), 5000);
				}
				return;
			}
			this.added = lines.length > 0;
			this.viaAccount = lines.some(l => /^claude\.ai\s/i.test(l));
			this.names = lines.map(l => assistantId() === 'chatgpt' ? l.trim().split(/\s+/)[0] : (l.match(/^(.+?):\s+\S/)?.[1] ?? '').trim()).filter(Boolean);
			this.connected = !this.off() && this.added && (assistantId() === 'chatgpt'
				? lines.some(l => !/not logged in|unsupported|needs/i.test(l))
				: lines.some(l => /connected/i.test(l) && !/needs|failed/i.test(l)));
			this.send();
			if (this.connected) {
				this.refreshCredits(false);
			}
			done?.();
		});
	}

	/**
	 * The user is adding or signing in to Higgsfield in a terminal or a browser: look again every
	 * few seconds until it is connected, so the page moves on by itself.
	 */
	private watchConnection(): void {
		clearInterval(this.watchTimer);
		const started = Date.now();
		this.watchTimer = setInterval(() => {
			if (this.connected || !this.panel || Date.now() - started > 5 * 60 * 1000) {
				clearInterval(this.watchTimer);
				return;
			}
			this.checkConnection();
		}, 4000);
	}

	/** Test mode: the page behaves as for someone who has never linked Higgsfield. */
	/** The user switched Higgsfield off in Orbit: the studio is closed and new agents start without its tools. */
	private off(): boolean {
		return vscode.workspace.getConfiguration('orbit').get<boolean>('higgsfield.enabled', true) === false;
	}

	private async switchOn(): Promise<void> {
		await vscode.workspace.getConfiguration('orbit').update('higgsfield.enabled', undefined, vscode.ConfigurationTarget.Global);
		this.connected = undefined;
		this.send();
		this.checkConnection();
	}

	private simulated(): boolean {
		return vscode.workspace.getConfiguration('orbit').get<boolean>('higgsfield.simulateDisconnected') === true;
	}

	/**
	 * Reads the credit balance through Claude Code, without a terminal: one short headless run
	 * that may call the balance tool and nothing else. Orbit never talks to Higgsfield itself.
	 */
	private refreshCredits(force: boolean): void {
		if (this.creditsLoading || !this.connected || (!force && Date.now() - this.creditsAt < BALANCE_EVERY_MS)) {
			return;
		}
		this.creditsLoading = true;
		this.send();
		const read = (answer: string) => {
			const found = answer.match(/\{[^{}]*"credits"[^{}]*\}/);
			const parsed = found ? JSON.parse(found[0]) as { credits?: number; plan?: string } : undefined;
			if (typeof parsed?.credits === 'number') {
				this.credits = { value: parsed.credits, plan: parsed.plan };
			}
		};
		if (assistantId() === 'chatgpt') {
			// Same question, asked to Codex: a short read-only run that calls the balance tool.
			runCodex('Appelle l\'outil balance du serveur MCP higgsfield puis réponds uniquement par un objet JSON {"credits": nombre, "plan": "texte"}, sans rien autour.', 'Tu réponds par un objet JSON, rien d\'autre.', os.homedir())
				.then(read, () => { /* keep the last known balance */ })
				.catch(() => { /* unreadable answer */ })
				.finally(() => {
					this.creditsLoading = false;
					this.creditsAt = Date.now();
					this.send();
				});
			return;
		}
		const prompt = 'Appelle l\'outil balance du connecteur Higgsfield puis réponds uniquement par un objet JSON {"credits": nombre, "plan": "texte"}, sans rien autour.';
		const child = execFile(resolveClaudeExecutable(), ['-p', prompt, '--model', 'haiku', '--allowedTools', ...BALANCE_TOOLS, '--output-format', 'json'], { timeout: 90000, windowsHide: true, env: claudeEnv(), cwd: os.homedir(), maxBuffer: 8 * 1024 * 1024 }, (_err, stdout) => {
			this.creditsLoading = false;
			this.creditsAt = Date.now();
			try {
				read(String(JSON.parse(String(stdout)).result ?? ''));
			} catch {
				// keep the last known balance
			}
			this.send();
		});
		child.stdin?.end();
	}

	private items(): { file: string; name: string; uri: string; kind: string; prompt?: string; model?: string; time: number; fresh: boolean }[] {
		const dir = this.dir();
		let names: string[] = [];
		try {
			names = fs.readdirSync(dir).filter(n => MEDIA.test(n));
		} catch {
			return [];
		}
		let manifest: ManifestEntry[] = [];
		try {
			const parsed = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8'));
			manifest = Array.isArray(parsed) ? parsed : [];
		} catch {
			// no manifest yet, or Claude is still writing it
		}
		const items = names.map(name => {
			const file = path.join(dir, name);
			const entry = manifest.find(m => m.file && path.basename(m.file) === name);
			const fresh = !this.known.has(name);
			return {
				file,
				name,
				uri: this.panel!.webview.asWebviewUri(vscode.Uri.file(file)).toString(),
				kind: /\.(mp4|webm|mov)$/i.test(name) ? 'video' : /\.(mp3|wav|m4a|ogg)$/i.test(name) ? 'audio' : /\.(glb|gltf|fbx|obj)$/i.test(name) ? '3d' : 'image',
				prompt: entry?.prompt,
				model: entry?.model,
				time: fs.statSync(file).mtimeMs,
				fresh,
			};
		}).sort((a, b) => b.time - a.time);
		// Each new file settles one waiting request.
		const arrived = items.filter(i => i.fresh).length;
		if (this.known.size || this.pending.length) {
			for (let i = 0; i < arrived && this.pending.length; i++) {
				const first = this.pending[0];
				first.count--;
				if (first.count <= 0) {
					this.pending.shift();
				}
			}
		}
		this.known = new Set(names);
		if (arrived && this.creditsAt) {
			this.creditsAt = 0;
			setTimeout(() => this.refreshCredits(false), 1500);
		}
		return items;
	}

	private send(kind?: Kind): void {
		if (!this.panel) {
			return;
		}
		this.pending = this.pending.filter(p => Date.now() - p.at < PENDING_TIMEOUT_MS);
		const hadKnown = this.known.size > 0 || this.pending.length > 0;
		const items = this.items();
		this.panel.webview.postMessage({
			type: 'state',
			connected: this.connected,
			added: this.added,
			working: this.working,
			simulated: this.simulated(),
			off: this.off(),
			credits: this.credits,
			creditsLoading: this.creditsLoading,
			project: path.basename(workspaceRoot()),
			folder: this.folder(),
			items: items.map(i => ({ ...i, fresh: hadKnown && i.fresh })),
			pending: this.pending,
			reference: this.reference && { file: this.reference, name: path.basename(this.reference), uri: this.referencePreview(this.reference) },
			kind,
		});
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private async onMessage(msg: any): Promise<void> {
		switch (msg.type) {
			case 'ready':
				this.send();
				break;
			case 'generate':
				this.generate(msg.request as Request);
				break;
			case 'balance':
				this.refreshCredits(true);
				break;
			case 'connect': {
				// One click does both: the server is added, then the sign-in page opens.
				const added = await this.quiet('Ajout de Higgsfield…', assistantId() === 'chatgpt' ? ['mcp', 'add', 'higgsfield', '--url', SERVER_URL] : ['mcp', 'add', '--transport', 'http', 'higgsfield', SERVER_URL]);
				if (added) {
					await this.signIn();
				}
				break;
			}
			case 'login':
				await this.signIn();
				break;
			case 'logout': {
				const leave = 'Me déconnecter';
				const site = 'Ouvrir claude.ai';
				const answer = this.viaAccount
					? await vscode.window.showWarningMessage('Se déconnecter de Higgsfield dans Orbit ?', { modal: true, detail: 'Ton compte Higgsfield est relié par ton compte claude.ai : Orbit ne peut pas le retirer de là. Il le coupe ici : le studio se ferme, et les agents lancés à partir de maintenant n\'ont plus les outils Higgsfield. Les agents déjà ouverts les gardent jusqu\'à leur fermeture.\n\nPour le retirer partout, c\'est dans claude.ai : Réglages, Connecteurs.' }, leave, site)
					: await vscode.window.showWarningMessage('Se déconnecter de Higgsfield ?', { modal: true, detail: 'Orbit ne pourra plus générer avec ton compte Higgsfield tant que tu ne te reconnectes pas. Tes créations déjà dans le projet restent là.' }, leave);
				if (answer === site) {
					vscode.env.openExternal(vscode.Uri.parse('https://claude.ai/settings/connectors'));
					break;
				}
				if (answer !== leave) {
					break;
				}
				this.working = 'Déconnexion…';
				this.send();
				// Servers added by hand are really signed out; the account's own connector is switched off in Orbit.
				for (const name of this.names.filter(n => !/^claude\.ai\s/i.test(n))) {
					await this.cli(['mcp', 'logout', name], 60000);
				}
				if (this.viaAccount) {
					await vscode.workspace.getConfiguration('orbit').update('higgsfield.enabled', false, vscode.ConfigurationTarget.Global);
				}
				this.working = undefined;
				this.credits = undefined;
				this.connected = undefined;
				this.send();
				this.checkConnection();
				break;
			}
			case 'switchOn':
				await this.switchOn();
				break;
			case 'recheck':
				this.connected = undefined;
				this.send();
				this.checkConnection();
				break;
			case 'pickReference': {
				const picked = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Utiliser comme référence', defaultUri: vscode.Uri.file(workspaceRoot()), filters: { 'Images': ['png', 'jpg', 'jpeg', 'webp'] } });
				if (picked?.[0]) {
					this.reference = picked[0].fsPath;
					this.send();
				}
				break;
			}
			case 'clearReference':
				this.reference = undefined;
				this.send();
				break;
			case 'action':
				await this.action(String(msg.action), String(msg.file));
				break;
		}
	}

	private generate(request: Request): void {
		const prompt = request.prompt?.trim();
		if (!prompt) {
			return;
		}
		const folder = this.folder();
		const count = Math.max(1, Math.min(4, Number(request.count) || 1));
		const reference = request.reference ?? this.reference;
		const lines = [
			`[Orbit · Higgsfield] Génère avec les outils du connecteur Higgsfield, sans me poser de question :`,
			`- type : ${KIND_LABELS[request.kind]}`,
			`- demande : « ${prompt} »`,
			request.style ? `- style : ${request.style}` : '',
			request.kind !== 'audio' && request.kind !== '3d' ? `- format : ${request.format}` : '',
			count > 1 ? `- quantité : ${count}` : '',
			reference ? `- image de référence : ${reference} (importe-la d'abord dans Higgsfield avec ses outils de médias)` : '',
			'',
			`Méthode : 1) choisis le modèle le mieux adapté avec models_explore (action recommend) ; 2) lance ${KIND_TOOLS[request.kind]} ; 3) attends la fin avec jobs_wait ; 4) télécharge chaque résultat dans « ${folder}/ » (crée le dossier) sous un nom court et parlant, sans espace ; 5) ajoute une entrée par fichier dans « ${folder}/${MANIFEST} », un tableau JSON d'objets { "file", "prompt", "type", "model", "date" } ; 6) réponds en une phrase avec les noms des fichiers. Si les crédits manquent, dis-le simplement avec le solde, sans rien lancer d'autre.`,
		].filter(l => l !== '');
		if (this.deliver(lines.join('\n'))) {
			this.pending.push({ id: this.nextId++, kind: request.kind, prompt, count, at: Date.now() });
			if (!this.known.size) {
				// Mark the gallery as started so the first files that arrive count as new.
				this.known = new Set(['']);
			}
			this.send();
		}
	}

	/** Send a message to the current Claude, or start one with it as its first prompt. */
	private deliver(message: string): boolean {
		const terminal = deliverToAgent(this.claude, this.tracker, message);
		if (terminal) {
			this.panel?.webview.postMessage({ type: 'sent', terminal: terminal.name });
		}
		return !!terminal;
	}

	private async action(action: string, file: string): Promise<void> {
		// Only files of the studio's own folder may be acted upon.
		if (path.relative(this.dir(), file).startsWith('..') || !fs.existsSync(file)) {
			return;
		}
		const uri = vscode.Uri.file(file);
		const relative = path.relative(workspaceRoot(), file).split(path.sep).join('/');
		switch (action) {
			case 'open':
				await vscode.commands.executeCommand('vscode.open', uri, { viewColumn: vscode.ViewColumn.Beside });
				break;
			case 'reveal':
				await vscode.commands.executeCommand('revealInExplorer', uri);
				break;
			case 'copy':
				await vscode.env.clipboard.writeText(relative);
				this.panel?.webview.postMessage({ type: 'toast', text: `Chemin copié : ${relative}` });
				break;
			case 'insert': {
				const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.scheme === 'file');
				if (!editor) {
					await vscode.env.clipboard.writeText(relative);
					this.panel?.webview.postMessage({ type: 'toast', text: 'Aucun fichier de code ouvert : le chemin est copié.' });
					return;
				}
				const from = path.dirname(editor.document.uri.fsPath);
				let link = path.relative(from, file).split(path.sep).join('/');
				if (!link.startsWith('.')) {
					link = `./${link}`;
				}
				await editor.edit(edit => editor.selections.forEach(selection => edit.replace(selection, link)));
				this.panel?.webview.postMessage({ type: 'toast', text: `Inséré dans ${path.basename(editor.document.uri.fsPath)}` });
				break;
			}
			case 'use':
				this.deliver(`Utilise le fichier ${relative} (généré avec Higgsfield) dans le projet, à l'endroit qui convient le mieux, et dis-moi où tu l'as mis.`);
				break;
			case 'animate':
				this.show(uri, 'video');
				break;
			case 'vary':
				this.show(uri, 'image');
				break;
			case 'montage':
				await vscode.commands.executeCommand('starcapture.openWith', uri);
				break;
		}
	}
}
