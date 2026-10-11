/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as tls from 'tls';
import { AddressInfo } from 'net';
import { AgentTracker } from './agentTracker';
import { attention } from './attention';
import { ClaudeTerminals } from './claudeTerminals';
import { screenshot } from './community';
import { workspaceRoot } from './config';
import { renderWebview, webviewOptions } from './webview';

/** Ports dev servers usually pick: Vite, Next, CRA, Astro, Angular, Django, Flask, PHP... */
const COMMON_PORTS = [5173, 5174, 3000, 3001, 4321, 4200, 8080, 8000, 5000, 8888, 4000, 3333, 1234, 8081];
const SOURCE_GLOB = '**/*.{tsx,jsx,ts,js,mjs,vue,svelte,astro,html,htm,php,erb,hbs,njk,py,rb,md,mdx}';
const SOURCE_EXCLUDE = '**/{node_modules,dist,build,out,.next,.nuxt,.svelte-kit,.git,.orbit,coverage,.turbo}/**';
const INJECT = '<script src="/__orbit/inspector.js"></script>';

/** The phone or tablet the view shows, as the page of the view describes it. */
interface Device {
	id: string;
	name: string;
	kind: string;
	width: number;
	height: number;
	ratio: number;
}

/**
 * The device the application is answered as. A frame of the right size is not a phone: the
 * application still sees a computer (user agent, mouse, screen). The relay sends the device's
 * user agent with every request, and tells the page, before its scripts, what to report.
 */
let emulated: (Device & { userAgent: string; platform: string; vendor: string; mobile: boolean }) | undefined;

function describe(device: Device | undefined): typeof emulated {
	if (!device) {
		return undefined;
	}
	const phone = device.kind === 'mobile';
	if (/^iPhone/.test(device.name)) {
		return { ...device, mobile: true, platform: 'iPhone', vendor: 'Apple Computer, Inc.', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' };
	}
	if (/^iPad/.test(device.name)) {
		// An iPad says it is a Mac; only its touch screen tells them apart.
		return { ...device, mobile: false, platform: 'MacIntel', vendor: 'Apple Computer, Inc.', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15' };
	}
	return { ...device, mobile: phone, platform: 'Linux armv81', vendor: 'Google Inc.', userAgent: `Mozilla/5.0 (Linux; Android 15; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 ${phone ? 'Mobile ' : ''}Safari/537.36` };
}

interface Target {
	/** `http://localhost:5173` for a dev server, or a folder served as-is. */
	origin?: string;
	folder?: string;
	/** Page to open first, e.g. `/` or `/index.html`. */
	path: string;
	label: string;
}

/**
 * Opens an address in the computer's browser (or mail application). The user just clicked that
 * link in their own application: the editor's "open this external website?" question, asked
 * by `openExternal` for every unknown domain, would only stand in the way.
 */
function openInBrowser(address: string): void {
	const [program, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', address]]
		: process.platform === 'darwin' ? ['open', [address]] : ['xdg-open', [address]];
	execFile(program, args, { windowsHide: true }, error => {
		if (error) {
			vscode.env.openExternal(vscode.Uri.parse(address, true)).then(undefined, () => undefined);
		}
	});
}

const ROUTE_FILES = '**/{app,pages,routes}/**/*.{tsx,jsx,ts,js,vue,svelte,astro,md,mdx}';
const ROUTERS = ['react-router', 'react-router-dom', 'vue-router', '@tanstack/react-router', 'wouter'];

/**
 * The pages of the application, as far as the project's files tell: HTML files for a folder,
 * the route folders of Next, Nuxt, Astro and SvelteKit, and the paths a router declares.
 * Routes with a parameter ([id], :id) have no address to offer and are left out.
 */
async function sitePages(target: Target): Promise<string[]> {
	const root = workspaceRoot();
	const found = new Set<string>(['/']);
	const relative = (uri: vscode.Uri) => path.relative(root, uri.fsPath).split(path.sep).join('/');
	if (target.folder) {
		for (const uri of await vscode.workspace.findFiles('**/*.{html,htm}', SOURCE_EXCLUDE, 80)) {
			found.add('/' + encodeURI(relative(uri)));
		}
		found.delete('/');
	} else {
		const dependencies = new Set<string>();
		for (const uri of await vscode.workspace.findFiles('**/package.json', SOURCE_EXCLUDE, 20)) {
			try {
				const manifest = JSON.parse(await fs.promises.readFile(uri.fsPath, 'utf8'));
				Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).forEach(name => dependencies.add(name));
			} catch {
				// not a readable manifest
			}
		}
		const pagesFolder = ['next', 'nuxt', 'astro'].some(name => dependencies.has(name));
		const add = (route: string) => {
			const parts = route.split('/').filter(part => part && !/^\(.*\)$/.test(part));
			if (parts.every(part => !/^[\[@_]/.test(part))) {
				found.add('/' + parts.join('/'));
			}
		};
		for (const uri of await vscode.workspace.findFiles(ROUTE_FILES, SOURCE_EXCLUDE, 600)) {
			const file = relative(uri);
			const app = /(?:^|\/)app\/((?:.*\/)?)page\.(?:tsx|jsx|ts|js|mdx)$/.exec(file);
			const svelte = /(?:^|\/)routes\/((?:.*\/)?)\+page\.svelte$/.exec(file);
			const page = pagesFolder ? /(?:^|\/)pages\/(.+)\.(?:tsx|jsx|ts|js|vue|astro|md|mdx)$/.exec(file) : null;
			if (app && dependencies.has('next')) {
				add(app[1]);
			} else if (svelte) {
				add(svelte[1]);
			} else if (page && !page[1].startsWith('api/')) {
				add(page[1].replace(/(^|\/)index$/, ''));
			}
		}
		if (ROUTERS.some(name => dependencies.has(name))) {
			for (const uri of await vscode.workspace.findFiles('**/*.{tsx,jsx,ts,js,vue}', SOURCE_EXCLUDE, 400)) {
				const source = await fs.promises.readFile(uri.fsPath, 'utf8').catch(() => '');
				if (source.length < 300_000 && /Route\b|[rR]outer/.test(source)) {
					for (const match of source.matchAll(/\bpath\s*[:=]\s*\{?\s*["'`](\/[\w\-/.]*)["'`]/g)) {
						found.add(match[1].length > 1 ? match[1].replace(/\/$/, '') : '/');
					}
				}
			}
		}
	}
	return [...found].sort((a, b) => a.localeCompare(b)).slice(0, 80);
}

/** A runtime error reported by the inspector injected in the page. */
interface PageError {
	kind: string;
	message: string;
	source?: string;
	line?: number;
	stack?: string;
}

interface Selection {
	label: string;
	component?: string;
	tag: string;
	text: string;
	ownText: string;
	classes: string[];
	attributes: string[];
	selector: string;
	html: string;
	framework?: string;
	source?: { file?: string; line?: number; column?: number };
	stack?: string;
	annotated?: { path: string; line: number; column: number; exact: boolean };
	url: string;
}

interface Location {
	file: string;
	line: number;
	column: number;
	/** `exact` when the framework said so, `probable` when found by searching the code. */
	confidence: 'exact' | 'probable';
}

/**
 * Live view: shows the interface being built (a dev server or plain HTML files), lets the user
 * point at any element, then either ask Claude to change it or jump to the code that renders it.
 * Pages go through a small local relay that injects Orbit's inspector; the app itself is untouched.
 */
export class LivePreview implements vscode.Disposable {

	private panel: vscode.WebviewPanel | undefined;
	private server: http.Server | undefined;
	private target: Target | undefined;
	private readonly listeners = new Set<http.ServerResponse>();
	private readonly disposables: vscode.Disposable[] = [];
	private reloadTimer: NodeJS.Timeout | undefined;
	private port = 0;
	/** The event stream of the page shown: the agent's requests go down it. */
	private pageStream: http.ServerResponse | undefined;
	private readonly pageWaiters = new Set<() => void>();
	private readonly answers = new Map<number, (answer: { result?: unknown; error?: string }) => void>();
	private nextRequest = 1;
	private readonly flash = vscode.window.createTextEditorDecorationType({
		backgroundColor: 'rgba(139, 123, 255, .22)',
		isWholeLine: true,
		overviewRulerColor: '#8b7bff',
		overviewRulerLane: vscode.OverviewRulerLane.Full,
	});

	constructor(private readonly extensionUri: vscode.Uri, private readonly claude: ClaudeTerminals, private readonly tracker: AgentTracker) {
		const watcher = vscode.workspace.createFileSystemWatcher('**/*');
		const changed = (uri: vscode.Uri) => this.fileChanged(uri);
		this.disposables.push(watcher, watcher.onDidChange(changed), watcher.onDidCreate(changed), watcher.onDidDelete(changed));
	}

	dispose(): void {
		clearTimeout(this.reloadTimer);
		this.stopServer();
		this.panel?.dispose();
		this.flash.dispose();
		this.disposables.forEach(d => d.dispose());
	}

	/** Pick what to preview: a running dev server, an HTML file, or any address. */
	async show(address?: string): Promise<void> {
		if (typeof address === 'string' && /^https?:\/\/[^/]+/.test(address)) {
			const url = new URL(address);
			return this.open({ origin: url.origin, path: `${url.pathname}${url.search}`, label: url.host });
		}
		type Item = vscode.QuickPickItem & { target?: Target; other?: boolean };
		const items: Item[] = [];
		const [servers, pages] = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Recherche des serveurs de développement…' },
			() => Promise.all([detectServers(), vscode.workspace.findFiles('**/*.{html,htm}', SOURCE_EXCLUDE, 40)]));
		if (servers.length) {
			items.push({ label: 'Serveurs lancés', kind: vscode.QuickPickItemKind.Separator });
			items.push(...servers.map(s => ({ label: `$(globe) ${s.title || s.origin}`, description: s.origin, detail: 'Serveur de développement : les changements apparaissent en direct', target: { origin: s.origin, path: '/', label: s.title || s.origin } })));
		}
		if (pages.length) {
			const root = workspaceRoot();
			items.push({ label: 'Pages HTML du projet', kind: vscode.QuickPickItemKind.Separator });
			items.push(...pages.sort((a, b) => a.fsPath.length - b.fsPath.length).map(uri => {
				const relative = path.relative(root, uri.fsPath).split(path.sep).join('/');
				return { label: `$(file-code) ${relative}`, detail: 'Servie par Orbit, rechargée à chaque modification', target: { folder: root, path: `/${encodeURI(relative)}`, label: relative } };
			}));
		}
		items.push({ label: '', kind: vscode.QuickPickItemKind.Separator }, { label: '$(link) Autre adresse…', detail: 'Ex. : http://localhost:3000/dashboard', other: true });
		const pick = await vscode.window.showQuickPick(items, {
			title: 'Vue vivante',
			placeHolder: servers.length || pages.length ? 'Que veux-tu voir ?' : 'Aucun serveur ni page HTML trouvé : lance ton serveur de développement, ou saisis une adresse',
		});
		let target = pick?.target;
		if (pick?.other) {
			const address = await vscode.window.showInputBox({ title: 'Vue vivante', prompt: 'Adresse de ton application (serveur local)', value: 'http://localhost:3000/', validateInput: v => /^https?:\/\/[^/]+/.test(v) ? undefined : 'Une adresse http://…' });
			if (address) {
				const url = new URL(address);
				target = { origin: url.origin, path: `${url.pathname}${url.search}`, label: url.host };
			}
		}
		if (target) {
			await this.open(target);
		}
	}

	/** Resolves when a page connects its event stream (a new page after a navigation, or the first one). */
	private nextPage(ms: number): Promise<boolean> {
		return new Promise(resolve => {
			const waiter = () => {
				clearTimeout(timer);
				this.pageWaiters.delete(waiter);
				resolve(true);
			};
			const timer = setTimeout(() => {
				this.pageWaiters.delete(waiter);
				resolve(false);
			}, ms);
			this.pageWaiters.add(waiter);
		});
	}

	/**
	 * `preview_look` and `preview_act`: the agent reads the page shown in the live view and uses it
	 * as a person would. Acting is kept to what runs on this machine: a real site opened here is
	 * only read.
	 */
	async agent(command: Record<string, unknown>): Promise<unknown> {
		const target = this.target;
		if (!this.panel || !target) {
			throw new Error('La vue vivante n\'est pas ouverte. Ouvre d\'abord l\'application avec open_url (par exemple http://localhost:3000), puis réessaie.');
		}
		const local = !!target.folder || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|[\w.-]+\.localhost)(:\d+)?$/i.test(target.origin ?? '');
		if (command.action !== 'look' && !local) {
			throw new Error('Cette page n\'est pas servie par cette machine : tu peux la lire (preview_look), pas y agir.');
		}
		if (!this.pageStream && !await this.nextPage(10000)) {
			throw new Error('La page de la vue vivante ne répond pas (serveur arrêté, page en erreur ?). Vérifie que l\'application tourne, puis rouvre-la avec open_url.');
		}
		const stream = this.pageStream;
		if (!stream) {
			throw new Error('La page vient de se fermer. Réessaie.');
		}
		const id = this.nextRequest++;
		const answered = new Promise<{ result?: unknown; error?: string }>(resolve => this.answers.set(id, resolve));
		// A click that leaves the page never answers: the page that replaces it is read instead.
		const replaced = this.nextPage(45000);
		stream.write(`event: agent\ndata: ${JSON.stringify({ id, ...command })}\n\n`);
		const first = await Promise.race([answered, replaced]);
		this.answers.delete(id);
		if (first === true) {
			await new Promise(resolve => setTimeout(resolve, 700));
			const page = await this.agent({ action: 'look' });
			return { navigated: true, ...(page as object) };
		}
		if (first === false) {
			throw new Error('La page n\'a pas répondu en 45 s : une fenêtre de dialogue y est peut-être ouverte, ou elle est figée.');
		}
		if (first.error) {
			throw new Error(first.error);
		}
		return first.result;
	}

	/**
	 * `preview_screenshot`: a picture of the address shown, taken by a browser without a window.
	 * It is a fresh visit: not signed in, none of what was typed in the live view.
	 */
	async agentScreenshot(): Promise<unknown> {
		if (!this.panel || !this.target || !this.port) {
			throw new Error('La vue vivante n\'est pas ouverte. Ouvre d\'abord l\'application avec open_url.');
		}
		let address = this.target.path;
		try {
			address = String((await this.agent({ action: 'look' }) as { address?: string }).address || address);
		} catch {
			// the page does not answer: the address it was opened on
		}
		const folder = path.join(os.tmpdir(), 'orbit-preview');
		await fs.promises.mkdir(folder, { recursive: true });
		const file = path.join(folder, `capture-${Date.now()}.png`);
		if (!await screenshot(`http://127.0.0.1:${this.port}${address}`, file)) {
			throw new Error('Capture impossible : ni Edge ni Chrome trouvé sur cette machine.');
		}
		return { file, address, note: 'Lis ce fichier pour voir la page. C\'est une visite neuve de la même adresse : sans connexion, sans ce qui a été saisi dans la vue vivante.' };
	}

	/** Whether the large view maximized the editor area (undone when it closes). */
	private maximized = false;

	private async open(target: Target): Promise<void> {
		this.target = target;
		this.stopServer();
		const port = this.port = await this.startServer();
		const src = `http://127.0.0.1:${port}${target.path}`;
		if (!this.panel) {
			this.panel = vscode.window.createWebviewPanel('orbit.preview', 'Vue vivante', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false }, { ...webviewOptions(this.extensionUri), retainContextWhenHidden: true });
			this.panel.iconPath = new vscode.ThemeIcon('eye');
			this.panel.webview.html = renderWebview(this.panel.webview, this.extensionUri, 'preview', { frame: 'http://127.0.0.1:*' });
			const listener = this.panel.webview.onDidReceiveMessage(msg => this.onMessage(msg));
			this.restoring = false;
			this.panel.onDidDispose(() => {
				listener.dispose();
				this.panel = undefined;
				this.pip = false;
				emulated = undefined;
				attention.large = false;
				if (this.maximized) {
					this.maximized = false;
					vscode.commands.executeCommand('workbench.action.toggleMaximizeEditorGroup').then(undefined, () => undefined);
				}
				this.stopServer();
			});
		} else {
			this.panel.reveal();
		}
		this.panel.title = `Vue vivante · ${target.label}`;
		this.loaded = { type: 'load', src, label: target.label, base: `http://127.0.0.1:${port}` };
		this.panel.webview.postMessage({ ...this.loaded, pip: this.pip });
		this.sendPages(target);
	}

	/** The list offered under the address: the pages the project's files describe. */
	private sendPages(target: Target): void {
		sitePages(target).then(pages => {
			if (this.target === target) {
				this.panel?.webview.postMessage({ type: 'pages', pages });
			}
		}, () => undefined);
	}

	/** Whether the view sits in its own small window, kept above the others. */
	private pip = false;

	/**
	 * Mini window: the view leaves the editor area for a small window that stays on top, to be
	 * dragged anywhere while the agent works; the same button brings it back.
	 */
	private async togglePip(): Promise<void> {
		if (!this.panel) {
			return;
		}
		if (this.pip) {
			this.pip = false;
			await vscode.commands.executeCommand('workbench.action.restoreEditorsToMainWindow');
			return;
		}
		// The window commands act on the editor in front: wait until the view is that editor.
		this.panel.reveal(undefined, false);
		for (let i = 0; i < 20 && this.panel && !this.panel.active; i++) {
			await new Promise(resolve => setTimeout(resolve, 50));
		}
		if (!this.panel?.active) {
			return;
		}
		if (this.maximized) {
			this.maximized = attention.large = false;
			await vscode.commands.executeCommand('workbench.action.toggleMaximizeEditorGroup').then(undefined, () => undefined);
		}
		this.pip = true;
		// Orbit's own command makes the window small and keeps it above the others. Without it
		// (an Orbit whose core is older) the view only moves to an ordinary window: the stock
		// "always on top" command acts on whichever window is active, and would pin the main one.
		const sized = await vscode.commands.executeCommand('_orbit.pip').then(done => done === true, () => false);
		if (!sized) {
			await vscode.commands.executeCommand('workbench.action.moveEditorToNewWindow');
			await vscode.commands.executeCommand('workbench.action.enableCompactAuxiliaryWindow').then(undefined, () => undefined);
		}
	}

	/** What the view shows, sent again when its page reloads (the view moved to another window). */
	private loaded: { type: 'load'; src: string; label: string; base: string } | undefined;
	private restoring = false;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private async onMessage(msg: any): Promise<void> {
		switch (msg.type) {
			case 'ready':
				// A page of the view that just loaded shows the application without a device.
				emulated = undefined;
				// The first `ready` follows the `load` already sent; any later one is a reloaded page.
				if (this.restoring && this.loaded) {
					this.panel?.webview.postMessage({ ...this.loaded, restore: true, pip: this.pip });
					if (this.target) {
						this.sendPages(this.target);
					}
				}
				this.restoring = true;
				break;
			case 'pip':
				await this.togglePip();
				break;
			case 'device': {
				const before = emulated?.id;
				emulated = describe(msg.device as Device | undefined);
				this.panel?.webview.postMessage({ type: 'device', device: emulated, reload: before !== emulated?.id });
				break;
			}
			case 'pick':
				await this.show();
				break;
			case 'focus':
				// The large view floats over the whole window: give it the whole editor area.
				if (!!msg.on !== this.maximized) {
					this.maximized = attention.large = !!msg.on;
					await vscode.commands.executeCommand('workbench.action.toggleMaximizeEditorGroup').then(undefined, () => undefined);
				}
				break;
			case 'external':
				if (this.target?.origin) {
					vscode.env.openExternal(vscode.Uri.parse(`${this.target.origin}${String(msg.path ?? '/')}`));
				}
				break;
			case 'locate': {
				const location = await this.locate(msg.info as Selection);
				this.panel?.webview.postMessage({ type: 'located', location: location && { ...location, relative: vscode.workspace.asRelativePath(location.file, false) } });
				break;
			}
			case 'code': {
				const location = await this.locate(msg.info as Selection);
				if (location) {
					await this.reveal(location);
				} else {
					vscode.window.showInformationMessage('Impossible de retrouver le code de cet élément. Demande à Claude : il saura le trouver.');
				}
				break;
			}
			case 'ask':
				await this.ask(msg.info as Selection, String(msg.instruction ?? ''), Number(msg.width) || 0, Number(msg.height) || 0);
				break;
			case 'errors':
				this.sendErrors(msg.errors as PageError[], String(msg.path ?? '/'));
				break;
		}
	}

	/** Runtime errors of the previewed page, handed to Claude with what Orbit knows about them. */
	private sendErrors(errors: PageError[], pagePath: string): void {
		if (!errors?.length) {
			return;
		}
		const kinds: Record<string, string> = { error: 'Erreur JavaScript', promise: 'Promesse rejetée', console: 'console.error', network: 'Requête en échec', resource: 'Ressource introuvable' };
		const lines = errors.map(e => {
			const where = e.source ? ` (${String(e.source).replace(/^https?:\/\/[^/]+/, '')}${e.line ? `:${e.line}` : ''})` : '';
			const stack = e.stack ? `\n  ${e.stack.split('\n').slice(0, 5).map(l => l.replace(/https?:\/\/127\.0\.0\.1:\d+/g, '').trim()).join('\n  ')}` : '';
			return `- ${kinds[e.kind] ?? e.kind} : ${e.message}${where}${stack}`;
		});
		const text = `La page affichée dans la vue vivante d'Orbit (${this.target?.origin ?? 'fichiers du projet'}${pagePath}) lève ${errors.length > 1 ? `ces ${errors.length} erreurs` : 'cette erreur'} à l'exécution. Trouve la cause dans le code et corrige-la ; la vue se rechargera toute seule.\n\n${lines.join('\n')}`;
		const terminal = this.claude.current();
		if (terminal && this.tracker.get(this.claude.keyOf(terminal))?.status === 'waiting') {
			vscode.window.showWarningMessage(`${terminal.name} attend une autorisation : réponds-lui d'abord, puis renvoie les erreurs.`);
			return;
		}
		if (terminal) {
			this.claude.sendMessage(terminal, text);
		} else {
			this.claude.create({ flags: [text], preserveFocus: true });
		}
		this.panel?.webview.postMessage({ type: 'sent', terminal: terminal?.name ?? 'Claude' });
	}

	private async ask(info: Selection, instruction: string, width = 0, height = 0): Promise<void> {
		if (!instruction.trim()) {
			return;
		}
		const location = await this.locate(info);
		const terminal = this.claude.current();
		if (terminal && this.tracker.get(this.claude.keyOf(terminal))?.status === 'waiting') {
			vscode.window.showWarningMessage(`${terminal.name} attend une autorisation : réponds-lui d'abord, puis renvoie ta demande.`);
			return;
		}
		const where = location
			? `${vscode.workspace.asRelativePath(location.file, false)}:${location.line}${location.confidence === 'probable' ? ' (emplacement probable, à vérifier)' : ''}`
			: 'inconnu : retrouve-le dans le code';
		const lines = [
			`Dans l'interface affichée dans la vue vivante d'Orbit (${info.url}), j'ai sélectionné cet élément :`,
			`- élément : <${info.tag}${info.classes.length ? ` class="${info.classes.join(' ')}"` : ''}>${info.text ? ` « ${info.text.slice(0, 120)} »` : ''}`,
		];
		if (info.component) {
			lines.push(`- composant : ${info.component}${info.framework ? ` (${info.framework})` : ''}`);
		}
		lines.push(`- code : ${where}`, `- sélecteur CSS : ${info.selector}`);
		// What the user was looking at: the same element is often right on a computer and wrong on a phone.
		if (emulated) {
			const kind = emulated.kind === 'mobile' ? 'téléphone' : 'tablette';
			lines.push(`- affichage : ${kind} (${emulated.name}, ${emulated.width} × ${emulated.height} px, ${emulated.width > emulated.height ? 'paysage' : 'portrait'}, tactile). Ma demande porte sur cet affichage : règle-la pour cette largeur d'écran sans changer ce que l'on voit sur ordinateur, sauf si je le demande.`);
		} else if (width) {
			lines.push(`- affichage : ordinateur, page large de ${width} px (haute de ${height} px). Ma demande porte sur cet affichage : ne casse pas les affichages téléphone et tablette.`);
		}
		lines.push('', `Demande : ${instruction.trim()}`, '', 'Modifie le code source (pas le DOM) : la vue se met à jour toute seule.');
		const message = lines.join('\n');
		if (!terminal) {
			// A Claude still starting would drop typed text: the message is its first prompt.
			const created = this.claude.create({ preserveFocus: true, flags: [message] });
			this.panel?.webview.postMessage({ type: 'sent', terminal: created.name });
			return;
		}
		this.claude.sendMessage(terminal, message);
		this.panel?.webview.postMessage({ type: 'sent', terminal: terminal.name });
	}

	private async reveal(location: Location): Promise<void> {
		const editor = await vscode.window.showTextDocument(vscode.Uri.file(location.file), { viewColumn: vscode.ViewColumn.One, preview: false });
		const line = Math.max(0, Math.min(editor.document.lineCount - 1, location.line - 1));
		const position = new vscode.Position(line, Math.max(0, location.column - 1));
		editor.selection = new vscode.Selection(position, position);
		editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
		editor.setDecorations(this.flash, [new vscode.Range(line, 0, line, 0)]);
		setTimeout(() => editor.setDecorations(this.flash, []), 1600);
	}

	// --- where an element comes from

	private async locate(info: Selection): Promise<Location | undefined> {
		const root = workspaceRoot();
		// 1. Plain HTML served by Orbit: every tag carries its position.
		if (info.annotated && this.target?.folder) {
			const file = path.join(this.target.folder, decodeURIComponent(info.annotated.path).replace(/^\/+/, ''));
			const page = /\.html?$/i.test(file) ? file : path.join(file, 'index.html');
			if (fs.existsSync(page)) {
				return { file: page, line: info.annotated.line, column: info.annotated.column, confidence: info.annotated.exact ? 'exact' : 'probable' };
			}
		}
		// 2. Framework debug data with a file and a line (React up to 18, Svelte).
		if (info.source?.file && info.source.line) {
			const file = toWorkspaceFile(info.source.file, root);
			if (file) {
				return { file, line: info.source.line, column: info.source.column ?? 1, confidence: 'exact' };
			}
		}
		// 3. React 19: the element's creation stack, mapped back to the source through its source map.
		if (info.stack && this.target?.origin) {
			const mapped = await fromStack(info.stack, this.target.origin, root).catch(() => undefined);
			if (mapped) {
				return mapped;
			}
		}
		// 4. A component file without a line (Vue): look for the element inside it.
		const inFile = info.source?.file ? toWorkspaceFile(info.source.file, root) : undefined;
		return searchCode(info, inFile);
	}

	// --- local relay

	private startServer(): Promise<number> {
		const server = http.createServer((req, res) => this.handle(req, res).catch(err => {
			if (!res.headersSent) {
				res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' });
			}
			res.end(errorPage(this.target, err));
		}));
		server.on('upgrade', (req, socket, head) => this.upgrade(req, socket as net.Socket, head));
		this.server = server;
		return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
	}

	private stopServer(): void {
		for (const listener of this.listeners) {
			listener.end();
		}
		this.listeners.clear();
		this.server?.close();
		this.server?.closeAllConnections?.();
		this.server = undefined;
	}

	private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const url = req.url ?? '/';
		if (url === '/__orbit/inspector.js') {
			res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
			res.end(await fs.promises.readFile(vscode.Uri.joinPath(this.extensionUri, 'media', 'inspector.js').fsPath));
			return;
		}
		if (url === '/__orbit/external' && req.method === 'POST') {
			const chunks: Buffer[] = [];
			for await (const chunk of req) {
				chunks.push(chunk as Buffer);
			}
			let go: string | undefined;
			try {
				const address = new URL(String(JSON.parse(Buffer.concat(chunks).toString('utf8')).url));
				const own = this.target?.origin ? new URL(this.target.origin) : undefined;
				const local = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
				if (own && address.port === own.port && address.protocol === own.protocol && (address.hostname === own.hostname || local(address.hostname) && local(own.hostname))) {
					// The application's own address, written in full: stay in the view.
					go = `${address.pathname}${address.search}${address.hash}`;
				} else if (/^(https?|mailto|tel|sms):$/.test(address.protocol)) {
					openInBrowser(address.href);
				}
			} catch {
				// not an address
			}
			res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ go }));
			return;
		}
		if (url === '/__orbit/agent' && req.method === 'POST') {
			const chunks: Buffer[] = [];
			for await (const chunk of req) {
				chunks.push(chunk as Buffer);
			}
			try {
				const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { id: number; result?: unknown; error?: string };
				this.answers.get(body.id)?.(body);
				this.answers.delete(body.id);
			} catch {
				// not ours
			}
			res.writeHead(204).end();
			return;
		}
		if (url === '/__orbit/events' || url === '/__orbit/events?page=1') {
			res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'connection': 'keep-alive' });
			res.write(': orbit\n\n');
			this.listeners.add(res);
			if (url.endsWith('?page=1')) {
				this.pageStream = res;
				for (const waiter of [...this.pageWaiters]) {
					waiter();
				}
			}
			req.on('close', () => {
				this.listeners.delete(res);
				if (this.pageStream === res) {
					this.pageStream = undefined;
				}
			});
			return;
		}
		const target = this.target;
		if (target?.folder) {
			return serveStatic(target.folder, url, res);
		}
		if (target?.origin) {
			return proxy(target.origin, req, res);
		}
		res.writeHead(404).end();
	}

	/** Hot-reload sockets (Vite, Next, webpack) go straight through to the dev server. */
	private upgrade(req: http.IncomingMessage, socket: net.Socket, head: Buffer): void {
		const origin = this.target?.origin;
		if (!origin) {
			socket.destroy();
			return;
		}
		const upstream = new URL(origin);
		const secure = upstream.protocol === 'https:';
		const port = Number(upstream.port || (secure ? 443 : 80));
		const connected = () => {
			const lines = [`${req.method} ${req.url} HTTP/1.1`];
			for (let i = 0; i < req.rawHeaders.length; i += 2) {
				const name = req.rawHeaders[i];
				lines.push(`${name}: ${name.toLowerCase() === 'host' ? upstream.host : name.toLowerCase() === 'origin' ? upstream.origin : req.rawHeaders[i + 1]}`);
			}
			remote.write(lines.join('\r\n') + '\r\n\r\n');
			remote.write(head);
			socket.pipe(remote).pipe(socket);
		};
		// A local https server has a self-signed certificate: accept it, it never leaves the machine.
		const remote: net.Socket = secure
			? tls.connect({ host: upstream.hostname, port, servername: net.isIP(upstream.hostname) ? undefined : upstream.hostname, rejectUnauthorized: false }, connected)
			: net.connect(port, upstream.hostname, connected);
		remote.on('error', () => socket.destroy());
		socket.on('error', () => remote.destroy());
	}

	private fileChanged(uri: vscode.Uri): void {
		const folder = this.target?.folder;
		if (!folder || !this.listeners.size || !isInside(folder, uri.fsPath) ||/[\\/](node_modules|\.git|\.orbit)[\\/]/.test(uri.fsPath)) {
			return;
		}
		clearTimeout(this.reloadTimer);
		this.reloadTimer = setTimeout(() => {
			for (const listener of this.listeners) {
				listener.write('data: reload\n\n');
			}
		}, 120);
	}
}

// --- relay helpers

function proxy(origin: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
	const upstream = new URL(origin);
	return new Promise((resolve, reject) => {
		const headers: http.OutgoingHttpHeaders = { ...req.headers, host: upstream.host, 'accept-encoding': 'identity' };
		if (emulated) {
			headers['user-agent'] = emulated.userAgent;
			headers['sec-ch-ua-mobile'] = emulated.mobile ? '?1' : '?0';
			headers['sec-ch-ua-platform'] = /^iP/.test(emulated.name) ? '"iOS"' : '"Android"';
		}
		if (headers.origin) {
			headers.origin = upstream.origin;
		}
		if (typeof headers.referer === 'string') {
			headers.referer = headers.referer.replace(/^https?:\/\/[^/]+/, upstream.origin);
		}
		const secure = upstream.protocol === 'https:';
		// A local https server has a self-signed certificate: accept it, it never leaves the machine.
		const options: https.RequestOptions = { hostname: upstream.hostname, port: upstream.port || (secure ? 443 : 80), path: req.url, method: req.method, headers, rejectUnauthorized: false };
		const request: typeof https.request = secure ? https.request : http.request;
		const outgoing = request(options, incoming => {
			const out: http.OutgoingHttpHeaders = { ...incoming.headers };
			// The page lives in an IDE frame and runs Orbit's inspector: frame and script restrictions would block both.
			delete out['content-security-policy'];
			delete out['content-security-policy-report-only'];
			delete out['x-frame-options'];
			if (typeof out.location === 'string' && out.location.startsWith(upstream.origin)) {
				out.location = out.location.slice(upstream.origin.length) || '/';
			}
			if (String(incoming.headers['content-type'] ?? '').includes('text/html')) {
				const chunks: Buffer[] = [];
				incoming.on('data', chunk => chunks.push(chunk));
				incoming.on('end', () => {
					delete out['content-length'];
					delete out['etag'];
					res.writeHead(incoming.statusCode ?? 200, out);
					res.end(inject(Buffer.concat(chunks).toString('utf8')));
					resolve();
				});
				incoming.on('error', reject);
			} else {
				res.writeHead(incoming.statusCode ?? 200, out);
				incoming.pipe(res);
				incoming.on('end', resolve);
			}
		});
		outgoing.on('error', reject);
		req.pipe(outgoing);
	});
}

function inject(html: string): string {
	const added = emulated ? `<script>window.__orbitDevice=${JSON.stringify(emulated).replace(/</g, '\\u003c')}</script>${INJECT}` : INJECT;
	return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, match => `${match}${added}`) : `${added}${html}`;
}

const MIME: Record<string, string> = {
	'.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
	'.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.avif': 'image/avif', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
	'.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf',
};

async function serveStatic(folder: string, url: string, res: http.ServerResponse): Promise<void> {
	const pathname = decodeURIComponent(new URL(url, 'http://x').pathname);
	let file = path.normalize(path.join(folder, pathname));
	if (!isInside(folder, file)) {
		res.writeHead(403).end();
		return;
	}
	try {
		if ((await fs.promises.stat(file)).isDirectory()) {
			file = path.join(file, 'index.html');
		}
		const ext = path.extname(file).toLowerCase();
		const body = await fs.promises.readFile(file);
		res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': 'no-store' });
		res.end(ext === '.html' || ext === '.htm' ? inject(annotate(body.toString('utf8'))) : body);
	} catch {
		res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
		res.end(`<body style="font:14px system-ui;padding:24px;color:#888">Introuvable : ${escapeHtml(pathname)}</body>`);
	}
}

/** Whether `file` is `folder` or inside it (a shared prefix such as `proj-secret` is not). */
function isInside(folder: string, file: string): boolean {
	const relative = path.relative(path.resolve(folder), path.resolve(file));
	return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Stamp every element of a hand-written page with its line and column, so a click leads back to it. */
export function annotate(html: string): string {
	const skip = /^(html|head|meta|link|script|style|title|base|noscript|template|br|wbr)$/i;
	let out = '';
	let last = 0;
	const tag = /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<([a-zA-Z][\w:-]*)(?=[\s/>])/g;
	const lineStarts = [0];
	for (let i = 0; i < html.length; i++) {
		if (html.charCodeAt(i) === 10) {
			lineStarts.push(i + 1);
		}
	}
	const position = (index: number) => {
		let lo = 0;
		let hi = lineStarts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (lineStarts[mid] <= index) {
				lo = mid;
			} else {
				hi = mid - 1;
			}
		}
		return `${lo + 1}:${index - lineStarts[lo] + 1}`;
	};
	for (let match = tag.exec(html); match; match = tag.exec(html)) {
		const name = match[2];
		if (!name || skip.test(name)) {
			continue;
		}
		const end = match.index + match[0].length;
		out += html.slice(last, end) + ` data-orbit-loc="${position(match.index)}"`;
		last = end;
	}
	return out + html.slice(last);
}

export async function detectServers(): Promise<{ origin: string; title?: string }[]> {
	const results = await Promise.all(COMMON_PORTS.map(port => new Promise<{ origin: string; title?: string } | undefined>(resolve => {
		const req = http.get({ hostname: 'localhost', port, path: '/', timeout: 700, headers: { accept: 'text/html' } }, res => {
			let body = '';
			res.setEncoding('utf8');
			res.on('data', chunk => { body += chunk; if (body.length > 20000) { res.destroy(); } });
			const done = () => resolve({ origin: `http://localhost:${port}`, title: body.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() });
			res.on('end', done);
			res.on('close', done);
		});
		req.on('timeout', () => { req.destroy(); resolve(undefined); });
		req.on('error', () => resolve(undefined));
	})));
	return results.filter((r): r is { origin: string; title?: string } => !!r);
}

function errorPage(target: Target | undefined, err: unknown): string {
	return `<body style="font:14px/1.6 system-ui;padding:32px;color:#9aa0c7;background:#0a0918">
		<h2 style="color:#e4e6fb;font-weight:600">Rien à afficher pour l'instant</h2>
		<p>${target?.origin ? `Le serveur <b>${escapeHtml(target.origin)}</b> ne répond pas. Lance-le (par exemple <code>npm run dev</code>), puis recharge.` : 'Erreur de la vue vivante.'}</p>
		<p style="opacity:.6">${escapeHtml(String(err instanceof Error ? err.message : err))}</p></body>`;
}

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
}

// --- source resolution helpers

/** Turn a path from a bundler or a framework into a file of the workspace. */
function toWorkspaceFile(source: string, root: string): string | undefined {
	let candidate = source.replace(/^webpack:\/\/[^/]*\//, '').replace(/^file:\/\/\/?/, '').replace(/[?#].*$/, '');
	try {
		candidate = decodeURIComponent(candidate);
	} catch {
		// keep as is
	}
	const tries = [candidate, path.join(root, candidate.replace(/^\.?\/+/, '')), path.join(root, candidate.replace(/^\/?@fs\//, ''))];
	if (process.platform === 'win32' && /^\/[a-zA-Z]:\//.test(candidate)) {
		tries.unshift(candidate.slice(1));
	}
	return tries.map(p => path.normalize(p)).find(p => path.isAbsolute(p) && fs.existsSync(p) && fs.statSync(p).isFile());
}

/** React 19 keeps where each element was created as a stack trace: follow it back through the source map. */
async function fromStack(stack: string, origin: string, root: string): Promise<Location | undefined> {
	const frames = [...stack.matchAll(/\(?((?:https?:\/\/[^\s)]+?)):(\d+):(\d+)\)?/g)]
		.map(m => ({ url: m[1], line: Number(m[2]), column: Number(m[3]) }))
		.filter(f => !/node_modules|\/@vite\/|\/\.vite\/|react-dom|react\.development|jsx-dev-runtime|chunk-|\/_next\/static\/chunks\/(?!app|pages)/.test(f.url));
	for (const frame of frames.slice(0, 3)) {
		const generated = new URL(frame.url);
		const url = `${origin}${generated.pathname}${generated.search}`;
		const code = await fetchText(url);
		const map = await sourceMapOf(code, url);
		const original = map && originalPosition(map, frame.line, frame.column);
		if (original) {
			const file = toWorkspaceFile(original.source, root);
			if (file) {
				return { file, line: original.line, column: original.column, confidence: 'exact' };
			}
		}
		// No source map: the path itself may already be a source file (unbundled dev servers).
		const direct = toWorkspaceFile(generated.pathname, root);
		if (direct) {
			return { file: direct, line: frame.line, column: frame.column, confidence: 'probable' };
		}
	}
	return undefined;
}

interface SourceMap {
	sources: string[];
	sourceRoot?: string;
	mappings: string;
}

function fetchText(url: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const get: typeof https.get = url.startsWith('https:') ? https.get : http.get;
		get(url, { timeout: 4000, headers: { 'accept-encoding': 'identity' }, rejectUnauthorized: false }, res => {
			let body = '';
			res.setEncoding('utf8');
			res.on('data', chunk => body += chunk);
			res.on('end', () => resolve(body));
		}).on('error', reject).on('timeout', function (this: http.ClientRequest) { this.destroy(new Error('timeout')); });
	});
}

async function sourceMapOf(code: string, url: string): Promise<SourceMap | undefined> {
	const reference = code.match(/\/\/[#@] sourceMappingURL=(\S+)\s*$/m)?.[1];
	if (!reference) {
		return undefined;
	}
	const inline = reference.match(/^data:application\/json[^,]*;base64,(.+)$/);
	const text = inline ? Buffer.from(inline[1], 'base64').toString('utf8') : await fetchText(new URL(reference, url).toString());
	const map = JSON.parse(text) as SourceMap;
	// Relative sources are relative to the module (Vite writes `App.jsx` for `/src/App.jsx`).
	const base = map.sourceRoot ? new URL(map.sourceRoot.replace(/\/?$/, '/'), url).toString() : url;
	map.sources = map.sources.map(s => s.startsWith('/') || /^[a-z][\w+.-]*:/i.test(s) ? s : decodeURIComponent(new URL(s, base).pathname));
	return map;
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decode a source map's VLQ mappings just far enough to find one generated position (1-based in, 1-based out). */
function originalPosition(map: SourceMap, line: number, column: number): { source: string; line: number; column: number } | undefined {
	let source = 0;
	let originalLine = 0;
	let originalColumn = 0;
	let best: [number, number, number] | undefined;
	const lines = map.mappings.split(';');
	for (let l = 0; l < lines.length && l < line; l++) {
		let generatedColumn = 0;
		for (const segment of lines[l].split(',')) {
			if (!segment) {
				continue;
			}
			const values: number[] = [];
			let value = 0;
			let shift = 0;
			for (const char of segment) {
				const digit = BASE64.indexOf(char);
				value += (digit & 31) << shift;
				if (digit & 32) {
					shift += 5;
				} else {
					values.push(value & 1 ? -(value >> 1) : value >> 1);
					value = 0;
					shift = 0;
				}
			}
			generatedColumn += values[0];
			if (values.length >= 4) {
				source += values[1];
				originalLine += values[2];
				originalColumn += values[3];
				if (l === line - 1 && generatedColumn <= column - 1) {
					best = [source, originalLine, originalColumn];
				}
			}
		}
	}
	return best && { source: map.sources[best[0]], line: best[1] + 1, column: best[2] + 1 };
}

/** Last resort: find the element's text (or class) in the code. */
async function searchCode(info: Selection, preferred?: string): Promise<Location | undefined> {
	const needles = [info.ownText, info.text.length <= 60 ? info.text : '', ...info.attributes.map(a => a.replace(/^[\w-]+="|"$/g, '')), ...info.classes]
		.map(n => n.trim()).filter(n => n.length >= 3);
	if (!needles.length) {
		return undefined;
	}
	const files = preferred ? [vscode.Uri.file(preferred)] : await vscode.workspace.findFiles(SOURCE_GLOB, SOURCE_EXCLUDE, 1500);
	for (const needle of needles) {
		for (const uri of files) {
			let text: string;
			try {
				const stat = await fs.promises.stat(uri.fsPath);
				if (stat.size > 400 * 1024) {
					continue;
				}
				text = await fs.promises.readFile(uri.fsPath, 'utf8');
			} catch {
				continue;
			}
			const index = text.indexOf(needle);
			if (index >= 0) {
				const before = text.slice(0, index);
				const line = before.split('\n').length;
				return { file: uri.fsPath, line, column: index - before.lastIndexOf('\n'), confidence: 'probable' };
			}
		}
	}
	return preferred ? { file: preferred, line: 1, column: 1, confidence: 'probable' } : undefined;
}
